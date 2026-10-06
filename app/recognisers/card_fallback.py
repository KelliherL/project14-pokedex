"""Fallback card detection: propose several crops, let retrieval choose.

`detect_card_quad` finds a card by thresholding once and taking the largest
card-shaped contour. That works when the card has a clean edge against its
background, and fails when it does not. Two failures were measured on real
photographs rather than imagined:

* A specular highlight cuts the card's own edge into fragments, so the
  largest remaining card-shaped contour is a piece of the card, or the
  furniture around it.
* A card presented in a sleeve or a display stand is never a fully visible
  quadrilateral at all, because the holder covers one edge.

In both cases the matcher is then handed a picture of a table and asked which
card it is. Measured on 807 photographs of Base Set cards taken by strangers,
the primary path produces a crop overlapping the real card by only 0.41 IoU
and identifies 21.3% of them correctly.

So stop relying on one threshold. Propose candidates from several
segmentations, perturb each to recover a card from a sleeve-shaped quad, and
score every candidate by **how well it retrieves**, keeping the best. The lane
already believes in this idea: its accept rule is the verify stage's match
score, so letting the match score arbitrate the crop is the same argument one
stage earlier. On the same 807 photographs this lifts crop IoU to 0.69 and
correct identification to 55.4%.

Cost is why this is a fallback and not the default: about 99 ms on a
640 px-wide frame, against a few milliseconds for the primary path. It is
meant to run when the cheap path has come back with nothing, not on every
frame. The search is also the reason `CardMatcher` packs its hash database:
scoring a hundred-odd crops with a Python-loop lookup costs 1.6 s.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from .card_matcher import (
    ASPECT_MAX,
    ASPECT_MIN,
    CARD_H,
    CARD_W,
    MAX_AREA_FRAC,
    order_corners,
)

MIN_AREA_FRAC = 0.02
MAX_CANDIDATES = 12
# Scale factors recover a card from a quad that actually traced its sleeve;
# vertical offsets compensate for a display stand hiding the bottom edge.
SCALES = (0.78, 0.85, 0.92, 1.0)
SHIFTS = (-0.06, 0.0, 0.06)


@dataclass
class FallbackCrop:
    crop: np.ndarray        # rectified card-sized view
    quad: np.ndarray        # where it came from, in frame coordinates
    distances: np.ndarray   # hash distance to every card in the DB
    candidates: int         # how many crops were scored to find this one


def _segmentations(gray: np.ndarray, sat: np.ndarray):
    """Several views of "where are the edges", so that a highlight which
    destroys one does not destroy them all."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    otsu, first = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield first
    yield cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    # Glare drags the global threshold upward, so cuts either side of Otsu can
    # still separate card from background when Otsu itself cannot.
    for shift in (-40, -20, 20):
        level = int(np.clip(otsu + shift, 5, 250))
        yield cv2.threshold(blur, level, 255, cv2.THRESH_BINARY)[1]
        yield cv2.threshold(blur, level, 255, cv2.THRESH_BINARY_INV)[1]
    # A generous close bridges an edge broken by a highlight.
    yield cv2.morphologyEx(cv2.Canny(blur, 40, 130), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    # A card is colourful; a table usually is not.
    yield cv2.threshold(cv2.GaussianBlur(sat, (5, 5), 0), 0, 255,
                        cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]


def candidate_quads(frame: np.ndarray) -> list[np.ndarray]:
    """Every plausible card quad across all segmentations, deduplicated."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)[:, :, 1]
    frame_area = frame.shape[0] * frame.shape[1]

    found: list[tuple[np.ndarray, float]] = []
    for mask in _segmentations(gray, sat):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:6]:
            if cv2.contourArea(c) < MIN_AREA_FRAC * frame_area:
                break
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                quad = approx.reshape(4, 2).astype(np.float32)
            else:
                quad = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float32)
            quad = order_corners(quad)
            w = np.linalg.norm(quad[1] - quad[0])
            h = np.linalg.norm(quad[3] - quad[0])
            if w == 0 or h == 0:
                continue
            area = cv2.contourArea(quad)
            if not (MIN_AREA_FRAC * frame_area <= area <= MAX_AREA_FRAC * frame_area):
                continue
            aspect = min(w, h) / max(w, h)
            if not (ASPECT_MIN <= aspect <= ASPECT_MAX):
                continue
            centre = quad.mean(axis=0)
            if any(np.linalg.norm(centre - q.mean(axis=0)) < 0.03 * max(frame.shape)
                   and abs(area - a) < 0.15 * a for q, a in found):
                continue
            found.append((quad, area))
    found.sort(key=lambda qa: -qa[1])
    return [q for q, _ in found[:MAX_CANDIDATES]]


def perturb(quad: np.ndarray) -> list[np.ndarray]:
    """Scale and vertical-shift variants of a candidate quad.

    Nothing here has to be right in advance; retrieval scores the variants, so
    a correct crop only has to be among the options.
    """
    centre = quad.mean(axis=0)
    height = np.linalg.norm(quad[3] - quad[0])
    out = []
    for scale in SCALES:
        scaled = centre + (quad - centre) * scale
        for shift in SHIFTS:
            out.append((scaled + np.array([0.0, shift * height], np.float32)).astype(np.float32))
    return out


def _warp(frame: np.ndarray, quad: np.ndarray) -> np.ndarray:
    dst = np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]],
                   dtype=np.float32)
    return cv2.warpPerspective(frame, cv2.getPerspectiveTransform(quad.astype(np.float32), dst),
                               (CARD_W, CARD_H))


def best_crop(frame: np.ndarray, matcher) -> FallbackCrop | None:
    """Score every candidate crop against the card database, return the best.

    `matcher` is a CardMatcher; only its packed hash lookup is used.
    """
    if not matcher.db:
        return None
    from PIL import Image  # local: keeps module import cheap for the card lane

    best: FallbackCrop | None = None
    scored = 0
    limit = -0.25 * max(frame.shape)
    for base in candidate_quads(frame):
        for quad in perturb(base):
            if quad.min() < limit:
                continue
            crop = _warp(frame, quad)
            dists = matcher._distances(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)))
            scored += 1
            if best is None or dists.min() < best.distances.min():
                best = FallbackCrop(crop=crop, quad=quad, distances=dists, candidates=scored)
    if best is not None:
        best.candidates = scored
    return best
