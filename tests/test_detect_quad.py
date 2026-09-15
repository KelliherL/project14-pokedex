"""Card detection: the quad must be a card in the frame, not the frame.

Regression cover for a bug found on real photographs (spike a2-cards,
2026-09-15). detect_card_quad walked contours largest-first and returned the
first whose aspect landed in the card band, with no upper bound on size. A
4:3 frame has its own aspect of 0.750 — dead centre in that band — so
whenever the background contour beat the card's own, the whole frame came
back as a card and the pipeline hashed the entire scene. 17 of 65 real
detections did exactly that.

These cases are built at 640x480 deliberately: that is both a standard webcam
resolution and exactly the aspect that triggers the bug.
"""

import cv2
import numpy as np

from app.recognisers.card_matcher import ASPECT_MAX, ASPECT_MIN, MAX_AREA_FRAC, detect_card_quad

W, H = 640, 480


def frame_aspect_is_in_the_card_band():
    return ASPECT_MIN <= (H / W) <= ASPECT_MAX


def scene(card_w=180, card_h=250, bg=235, card=40):
    """A card-shaped patch on a plain bright background — the shape of a real
    photo, where the background is light rather than the synthetic harness's
    dark noisy backdrop."""
    img = np.full((H, W, 3), bg, dtype=np.uint8)
    rng = np.random.default_rng(0)
    img = np.clip(img.astype(np.int16) + rng.integers(-6, 6, img.shape), 0, 255).astype(np.uint8)
    x0, y0 = (W - card_w) // 2, (H - card_h) // 2
    img[y0 : y0 + card_h, x0 : x0 + card_w] = card
    return img


def test_the_frame_itself_sits_in_the_card_aspect_band():
    """The precondition for the bug. If this ever fails the band changed and
    the reasoning in these tests needs revisiting."""
    assert frame_aspect_is_in_the_card_band()


def test_detects_the_card_not_the_frame():
    quad = detect_card_quad(scene())
    assert quad is not None
    area = cv2.contourArea(quad.astype(np.float32))
    assert area < MAX_AREA_FRAC * W * H
    assert area < 0.5 * W * H, "should be the card patch, not most of the frame"


def test_empty_scene_returns_none_rather_than_the_whole_frame():
    """No card present. The honest answer is None — the unsure state is a
    first-class screen — never a quad covering the frame."""
    rng = np.random.default_rng(1)
    img = np.clip(np.full((H, W, 3), 225, dtype=np.int16)
                  + rng.integers(-6, 6, (H, W, 3)), 0, 255).astype(np.uint8)
    quad = detect_card_quad(img)
    if quad is not None:
        assert cv2.contourArea(quad.astype(np.float32)) <= MAX_AREA_FRAC * W * H


def test_card_touching_most_of_the_frame_is_still_rejected():
    """A near-full-frame quad is the failure signature, whatever produced it."""
    img = np.full((H, W, 3), 10, dtype=np.uint8)
    img[2 : H - 2, 2 : W - 2] = 240          # almost the entire frame
    quad = detect_card_quad(img)
    if quad is not None:
        assert cv2.contourArea(quad.astype(np.float32)) <= MAX_AREA_FRAC * W * H


def test_still_finds_a_card_on_the_dark_backdrop_the_selftest_uses():
    """The synthetic path must keep working — that is the demo-readiness gate."""
    img = np.full((H, W, 3), 32, dtype=np.uint8)
    img[100:350, 220:400] = 200
    quad = detect_card_quad(img)
    assert quad is not None
    area = cv2.contourArea(quad.astype(np.float32))
    assert 0.05 * W * H < area < 0.5 * W * H
