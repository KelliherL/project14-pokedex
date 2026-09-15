"""Card recognition: contour detect -> perspective rectify -> perceptual
hash -> nearest neighbour against a locally cached card DB.

This is the REAL pipeline (single-frame; temporal voting comes later).
Match criterion: best candidate must sit >= 4 standard deviations below the
mean Hamming distance across the whole DB (tmikonen's criterion) — the same
statistic doubles as the explanation panel's confidence display.
"""

import json
from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image

from .base import Identification

# Canonical rectified size — matches the TCGdex "low" reference images the
# DB hashes were computed from.
CARD_W, CARD_H = 245, 337

# Accept criterion, calibrated 2026-07-29 on synthetic probes against the
# 102-card base1 DB: true matches scored best<=3 with margin>=16; blank-card
# and gradient-card junk scored best>=50 with margin<=2. (The literature's
# 4σ-below-mean rule under-separates at this DB size: junk reached 3.2σ,
# true matches dipped to 3.4σ.) Re-calibrate on real webcam frames in
# spike (a) — real captures will score worse than synthetic ones.
MAX_BEST_DISTANCE = 26
MIN_MARGIN = 8
DB_PATH = Path(__file__).resolve().parents[2] / "data" / "cards" / "hashes.json"

# Card aspect is 63:88 ≈ 0.72; accept a generous band (perspective skew).
ASPECT_MIN, ASPECT_MAX = 0.55, 0.90

# Upper bound on how much of the frame a card may occupy. Without one the
# detector can return the WHOLE FRAME as a card, because a 4:3 frame's own
# aspect is 0.750 — dead centre in the band above. Not hypothetical: on 70
# real card photos, 17 of 65 detections covered >85% of the frame (mostly
# glare shots, where the washed-out card edge loses to the background
# contour) and the pipeline hashed the entire scene. A 640x480 webcam frame
# is also 0.750, so this reaches the kiosk path. Synthetic scenes could not
# surface it: a card on a dark noisy backdrop always gives Otsu a clean
# card-shaped contour.
#
# 0.60 is derived, not tuned. All four corners must be in shot for rectify to
# work, so the limit is a card filling the frame's full height: at 63:88 that
# is 0.54 of a 4:3 frame and 0.40 of a 16:9 one. Measured on the real photos,
# correct detections occupy 0.25-0.34 of the frame and failures cluster at
# 0.85-0.90, so the bound sits in a wide empty gap.
MAX_AREA_FRAC = 0.60


def order_corners(pts: np.ndarray) -> np.ndarray:
    """(4,2) points in any order -> [top-left, top-right, bottom-right, bottom-left]."""
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()  # y - x
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def _card_quads(thresh: np.ndarray, frame_area: float):
    """Card-shaped quads among the white regions of a thresholded image,
    yielded as (quad, area)."""
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        if cv2.contourArea(c) < 0.03 * frame_area:
            break
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            quad = approx.reshape(4, 2).astype(np.float32)
        else:
            # Rounded corners often defeat approxPolyDP; fall back to the
            # minimum-area rectangle of the same contour.
            quad = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float32)
        quad = order_corners(quad)
        w = np.linalg.norm(quad[1] - quad[0])
        h = np.linalg.norm(quad[3] - quad[0])
        if h == 0 or w == 0:
            continue
        area = cv2.contourArea(quad)
        if area > MAX_AREA_FRAC * frame_area:
            continue        # the frame itself, not a card in it
        aspect = min(w, h) / max(w, h)
        if ASPECT_MIN <= aspect <= ASPECT_MAX:
            yield quad, area


def detect_card_quad(frame: np.ndarray) -> np.ndarray | None:
    """Find the largest card-shaped quadrilateral, or None.

    Both threshold polarities are searched. findContours traces WHITE regions,
    so a plain Otsu threshold only finds a card brighter than its surroundings
    — which is the synthetic harness's world (bright card, dark backdrop) but
    often not a real one. Photographed on a light table, a card is darker than
    its background, so it is a hole rather than a contour and the only thing
    the detector can find is the frame. Searching the inverse as well covers
    both, and the area bound above stops the frame-sized candidate winning.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    frame_area = frame.shape[0] * frame.shape[1]

    best_quad, best_area = None, 0.0
    for mode in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
        _, thresh = cv2.threshold(blur, 0, 255, mode + cv2.THRESH_OTSU)
        for quad, area in _card_quads(thresh, frame_area):
            if area > best_area:
                best_quad, best_area = quad, area
    return best_quad


def rectify(frame: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Perspective-warp the detected quad to the canonical flat-scan view."""
    dst = np.array(
        [[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(quad, dst)
    return cv2.warpPerspective(frame, m, (CARD_W, CARD_H))


def rectify_candidates(frame: np.ndarray, quad: np.ndarray) -> list[np.ndarray]:
    """Aspect-aware rectify: portrait quads warp straight to the canonical
    view; landscape quads (card at ~90°) warp to a landscape canvas first,
    then rotate both ways — warping landscape content into the portrait
    canvas squashes it ~1.38x and no amount of hash orientation recovers
    that (measured 2026-08-07: 0/15 squashed vs 15/15 with this path)."""
    w = np.linalg.norm(quad[1] - quad[0])
    h = np.linalg.norm(quad[3] - quad[0])
    if h >= w:
        return [rectify(frame, quad)]
    dst = np.array(
        [[0, 0], [CARD_H - 1, 0], [CARD_H - 1, CARD_W - 1], [0, CARD_W - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(quad, dst)
    land = cv2.warpPerspective(frame, m, (CARD_H, CARD_W))
    return [
        cv2.rotate(land, cv2.ROTATE_90_CLOCKWISE),
        cv2.rotate(land, cv2.ROTATE_90_COUNTERCLOCKWISE),
    ]


class CardMatcher:
    def __init__(self, db_path: Path = DB_PATH):
        self.db: list[dict] = []
        if Path(db_path).exists():
            raw = json.loads(Path(db_path).read_text(encoding="utf-8"))
            for entry in raw["cards"]:
                self.db.append(
                    {
                        **entry,
                        "phash": [imagehash.hex_to_hash(h) for h in entry["phash"]],
                        "dhash": [imagehash.hex_to_hash(h) for h in entry["dhash"]],
                    }
                )

    def identify(self, frame: np.ndarray) -> Identification:
        quad = detect_card_quad(frame)
        if quad is None:
            return Identification(kind="none", explanation={"reason": "no card-shaped contour"})

        candidates = rectify_candidates(frame, quad)

        if not self.db:
            return Identification(
                kind="card",
                label="card DB not built — run scripts/build_card_db.py",
                is_stub=True,
                explanation={"quad": quad.tolist(), "rectified": candidates[0]},
            )

        # Hash every rectification candidate; the true orientation scores
        # far lower than a squashed/mis-rotated one, so min wins.
        warped, dists = None, None
        for cand in candidates:
            pil = Image.fromarray(cv2.cvtColor(cand, cv2.COLOR_BGR2RGB))
            ph, dh = imagehash.phash(pil), imagehash.dhash(pil)
            d = np.array(
                [
                    min(ph - p for p in e["phash"]) + min(dh - d_ for d_ in e["dhash"])
                    for e in self.db
                ],
                dtype=np.float64,
            )
            if dists is None or d.min() < dists.min():
                warped, dists = cand, d
        order = np.argsort(dists)
        best, second = int(order[0]), int(order[1])
        margin = float(dists[second] - dists[best])
        mean = float(dists.mean())
        std = float(dists.std()) or 1.0
        sigma = (mean - float(dists[best])) / std  # σ below the mean (display stat)
        matched = dists[best] <= MAX_BEST_DISTANCE and margin >= MIN_MARGIN
        e = self.db[best]

        return Identification(
            kind="card",
            label=e["name"] if matched else None,
            dex_id=(e.get("dex_ids") or [None])[0] if matched else None,
            confidence=max(0.0, 1.0 - float(dists[best]) / 32.0) if matched else 0.0,
            explanation={
                "quad": quad.tolist(),
                "rectified": warped,
                "best_card": e["id"],
                "best_distance": int(dists[best]),
                "second_card": self.db[second]["id"],
                "margin": int(margin),
                "mean_distance": round(mean, 1),
                "sigma": round(sigma, 2),
                "criterion": f"match iff distance <= {MAX_BEST_DISTANCE} and margin >= {MIN_MARGIN}",
                # top-5 shortlist for the lock-on verify stage (verify.py)
                "shortlist": [
                    {"id": self.db[int(i)]["id"], "distance": int(dists[int(i)])}
                    for i in order[:5]
                ],
            },
        )
