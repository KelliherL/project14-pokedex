"""Guided card mode: read the card from the guide box, refuse an empty box."""

import cv2
import numpy as np

from app.recognisers.card_matcher import CARD_H, CARD_W, OWN_DIR, CardMatcher, guide_quad

CARD = "own-seel-1"   # a committed photo, so this runs without the downloaded images


def _scene(offset=(0.0, 0.0), size=(1080, 1920)):
    """A light wall with the card placed on the guide box, shifted by `offset`
    (fractions of the box size) to stand in for a visitor's imperfect aim."""
    frame = np.full((*size, 3), 205, np.uint8)
    card = cv2.imread(str(OWN_DIR / f"{CARD}.webp"))
    box = guide_quad(frame.shape)
    box += np.array(offset) * (box[2] - box[0])
    src = np.float32([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]])
    m = cv2.getPerspectiveTransform(src, box.astype(np.float32))
    warped = cv2.warpPerspective(card, m, (size[1], size[0]))
    mask = cv2.warpPerspective(np.full(card.shape[:2], 255, np.uint8), m, (size[1], size[0]))
    frame[mask > 0] = warped[mask > 0]
    return frame


def test_card_in_the_guide_box_is_identified_even_a_little_off():
    matcher = CardMatcher(guided=True)
    for offset in ((0, 0), (0.07, -0.05), (-0.08, 0.06)):
        ident = matcher.identify(_scene(offset))
        assert ident.kind == "card"
        assert ident.explanation["best_card"] == CARD
        assert ident.explanation["found_by"] == "guide box"


def test_empty_guide_box_is_none_so_votes_stop_and_the_lock_can_release():
    ident = CardMatcher(guided=True).identify(np.full((1080, 1920, 3), 205, np.uint8))
    assert ident.kind == "none"


def test_guide_box_is_card_shaped_and_centred_at_any_resolution():
    for h, w in ((480, 640), (1080, 1920), (1920, 1080)):
        box = guide_quad((h, w))
        assert np.allclose(box.mean(axis=0), (w / 2, h / 2))
        assert abs((box[1, 0] - box[0, 0]) / (box[3, 1] - box[0, 1]) - CARD_W / CARD_H) < 1e-6
