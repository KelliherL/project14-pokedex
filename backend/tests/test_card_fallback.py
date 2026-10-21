"""The candidate-crop fallback should find cards the single-threshold detector
cannot, and should stay out of the way otherwise.

The scene these tests build is the one measured on real photographs: a card
inside a sleeve, so the strongest card-shaped contour traces the SLEEVE and
the rectified view contains a border the reference scan does not have. The
primary detector has no way out of that; the fallback's job is to try a
smaller crop and let the match score decide.
"""

from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from app.recognisers.card_fallback import MAX_CANDIDATES, candidate_quads, perturb
from app.recognisers.card_matcher import ASPECT_MAX, ASPECT_MIN, CardMatcher

IMG_DIR = Path(__file__).resolve().parents[1] / "data" / "cards" / "images"


@pytest.fixture(scope="module")
def matcher():
    m = CardMatcher()
    if not m.db:
        pytest.skip("card DB not built")
    return m


@pytest.fixture(scope="module")
def reference_card():
    # CI runs pytest before the card-image cache step, so the directory may not
    # exist at all; iterdir() would raise before a skip could fire.
    if not IMG_DIR.is_dir():
        pytest.skip("reference images not cached")
    files = sorted(p for p in IMG_DIR.iterdir() if p.suffix in {".webp", ".png"})
    if not files:
        pytest.skip("reference images not cached")
    return files[0]


def sleeved_scene(card_path, border_frac=0.11, size=(900, 700)):
    """A card inside a patterned sleeve, on a plain background."""
    card = Image.open(card_path).convert("RGB").resize((300, 412))
    cw, ch = card.size
    bw, bh = int(cw * border_frac), int(ch * border_frac)
    sleeve = np.zeros((ch + 2 * bh, cw + 2 * bw, 3), np.uint8)
    sleeve[:] = (40, 40, 60)
    sleeve[::6, :] = (200, 200, 220)          # a visible chevron-ish pattern
    sleeve[bh:bh + ch, bw:bw + cw] = cv2.cvtColor(np.array(card), cv2.COLOR_RGB2BGR)

    rng = np.random.default_rng(0)
    frame = np.clip(np.full((size[1], size[0], 3), 190, np.int16)
                    + rng.integers(-8, 8, (size[1], size[0], 3)), 0, 255).astype(np.uint8)
    y0 = (size[1] - sleeve.shape[0]) // 2
    x0 = (size[0] - sleeve.shape[1]) // 2
    frame[y0:y0 + sleeve.shape[0], x0:x0 + sleeve.shape[1]] = sleeve
    return frame


def test_candidates_are_all_card_shaped_and_bounded(matcher, reference_card):
    quads = candidate_quads(sleeved_scene(reference_card))
    assert quads, "should propose at least one candidate"
    assert len(quads) <= MAX_CANDIDATES
    for q in quads:
        w = np.linalg.norm(q[1] - q[0])
        h = np.linalg.norm(q[3] - q[0])
        assert ASPECT_MIN <= min(w, h) / max(w, h) <= ASPECT_MAX


def test_perturb_includes_a_shrunken_variant():
    quad = np.array([[0, 0], [100, 0], [100, 140], [0, 140]], dtype=np.float32)
    variants = perturb(quad)
    areas = [cv2.contourArea(v) for v in variants]
    assert min(areas) < 0.7 * cv2.contourArea(quad), "must try recovering a card from a sleeve"
    assert any(abs(a - cv2.contourArea(quad)) < 1e-3 for a in areas), "must also try as-is"


def test_fallback_beats_the_primary_path_on_a_sleeved_card(matcher, reference_card):
    """The whole point: a sleeve defeats the single-threshold detector, and the
    candidate search recovers the card inside it."""
    frame = sleeved_scene(reference_card)
    plain = matcher.identify(frame)
    searched = matcher.identify(frame, allow_fallback=True)

    assert searched.explanation.get("best_card") is not None
    assert searched.explanation["best_distance"] <= plain.explanation.get("best_distance", 999)
    assert searched.explanation["best_card"] == reference_card.stem


def test_fallback_is_off_by_default(matcher, reference_card):
    """Cost control: nothing should invoke the expensive search unasked."""
    frame = sleeved_scene(reference_card)
    ident = matcher.identify(frame)
    assert "found_by" not in ident.explanation
    assert "candidates_scored" not in ident.explanation


def test_fallback_payload_matches_the_primary_shape(matcher, reference_card):
    """The frontend contract must not care which path found the card."""
    frame = sleeved_scene(reference_card)
    searched = matcher.identify(frame, allow_fallback=True)
    for key in ("quad", "rectified", "best_card", "best_distance", "second_card",
                "margin", "mean_distance", "sigma", "criterion", "shortlist"):
        assert key in searched.explanation, key
    assert len(searched.explanation["shortlist"]) == 5


def test_fallback_on_an_empty_scene_still_reports_nothing(matcher):
    rng = np.random.default_rng(1)
    frame = np.clip(np.full((480, 640, 3), 200, np.int16)
                    + rng.integers(-6, 6, (480, 640, 3)), 0, 255).astype(np.uint8)
    ident = matcher.identify(frame, allow_fallback=True)
    assert ident.label is None
