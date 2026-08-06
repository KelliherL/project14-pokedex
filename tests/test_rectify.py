"""Aspect-aware rectify: a card presented at 90° must be recoverable.

Runs without the card image cache — builds a synthetic patterned card
in memory and composites it into a webcam-ish scene. The regression this
guards: warping a landscape quad into the portrait canvas aspect-squashes
the content ~1.38x, which no hash orientation can undo (found 2026-08-07).
"""

import cv2
import imagehash
import numpy as np
from PIL import Image, ImageDraw

from app.recognisers.card_matcher import detect_card_quad, rectify, rectify_candidates

RNG = np.random.default_rng(3)


def make_card(w=245, h=337) -> Image.Image:
    """Bright asymmetric block pattern — hash-distinct in every orientation."""
    img = Image.new("RGB", (w, h), (200, 190, 60))
    d = ImageDraw.Draw(img)
    for i in range(6):
        x0, y0 = int(RNG.uniform(0, w * 0.7)), int(RNG.uniform(0, h * 0.7))
        d.rectangle(
            [x0, y0, x0 + int(RNG.uniform(30, 90)), y0 + int(RNG.uniform(30, 90))],
            fill=tuple(int(c) for c in RNG.integers(60, 255, 3)),
        )
    d.rectangle([10, 10, 70, 40], fill=(250, 250, 250))  # break symmetry
    return img


def compose(card: Image.Image, angle: float) -> np.ndarray:
    bg = np.full((720, 1280, 3), 35, dtype=np.uint8)
    rotated = card.convert("RGBA").resize((330, 454)).rotate(angle, expand=True)
    scene = Image.fromarray(bg, "RGB")
    scene.paste(rotated, ((1280 - rotated.width) // 2, (720 - rotated.height) // 2), rotated)
    return cv2.cvtColor(np.array(scene), cv2.COLOR_RGB2BGR)


def phash_dist(bgr: np.ndarray, ref: Image.Image) -> int:
    return imagehash.phash(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))) - imagehash.phash(ref)


def test_portrait_quad_yields_single_faithful_candidate():
    card = make_card()
    frame = compose(card, 0)
    quad = detect_card_quad(frame)
    assert quad is not None
    cands = rectify_candidates(frame, quad)
    assert len(cands) == 1
    assert phash_dist(cands[0], card) <= 10


def test_landscape_quad_yields_rotations_and_recovers_content():
    card = make_card()
    frame = compose(card, 90)
    quad = detect_card_quad(frame)
    assert quad is not None
    cands = rectify_candidates(frame, quad)
    assert len(cands) == 2
    best = min(phash_dist(c, card) for c in cands)
    assert best <= 10
    # the old portrait-canvas squash is measurably worse — the regression
    squashed = phash_dist(rectify(frame, quad), card)
    assert squashed > best
