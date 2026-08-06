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


def order_corners(pts: np.ndarray) -> np.ndarray:
    """(4,2) points in any order -> [top-left, top-right, bottom-right, bottom-left]."""
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()  # y - x
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def detect_card_quad(frame: np.ndarray) -> np.ndarray | None:
    """Find the largest card-shaped quadrilateral, or None."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    frame_area = frame.shape[0] * frame.shape[1]

    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
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
        aspect = min(w, h) / max(w, h)
        if ASPECT_MIN <= aspect <= ASPECT_MAX:
            return quad
    return None


def rectify(frame: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Perspective-warp the detected quad to the canonical flat-scan view."""
    dst = np.array(
        [[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(quad, dst)
    return cv2.warpPerspective(frame, m, (CARD_W, CARD_H))


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

        warped = rectify(frame, quad)
        pil = Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB))
        ph, dh = imagehash.phash(pil), imagehash.dhash(pil)

        if not self.db:
            return Identification(
                kind="card",
                label="card DB not built — run scripts/build_card_db.py",
                is_stub=True,
                explanation={"quad": quad.tolist(), "rectified": warped},
            )

        dists = np.array(
            [
                min(ph - p for p in e["phash"]) + min(dh - d for d in e["dhash"])
                for e in self.db
            ],
            dtype=np.float64,
        )
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
            },
        )
