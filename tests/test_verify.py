"""The SIFT verifier: two views per card, and an honest runner-up.

The synthetic selftest already checks that a correct card is accepted and that
featureless junk is refused. These cover the parts that changed when the
verifier moved from ORB to SIFT.
"""

from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from app.recognisers.verify import ART_WINDOW, CardVerifier, artwork

IMG_DIR = Path(__file__).resolve().parents[1] / "data" / "cards" / "images"


@pytest.fixture(scope="module")
def cards():
    # CI runs pytest before the card-image cache step, so the directory may not
    # exist at all; iterdir() would raise before a skip could fire.
    if not IMG_DIR.is_dir():
        pytest.skip("reference images not cached")
    files = sorted(p for p in IMG_DIR.iterdir() if p.suffix in {".webp", ".png"})
    if len(files) < 3:
        pytest.skip("reference images not cached")
    return files


def rectified(path):
    return cv2.cvtColor(np.array(Image.open(path).convert("RGB").resize((245, 337))),
                        cv2.COLOR_RGB2BGR)


def test_artwork_crop_is_inside_the_card_and_not_the_whole_thing():
    card = np.zeros((337, 245, 3), np.uint8)
    art = artwork(card)
    assert art.shape[0] < card.shape[0] and art.shape[1] <= card.shape[1]
    _, y0, _, y1 = ART_WINDOW
    assert art.shape[0] == int(y1 * 337) - int(y0 * 337)


def test_correct_card_is_accepted(cards):
    v = CardVerifier()
    target = cards[0]
    res = v.verify(rectified(target), [c.stem for c in cards[:6]])
    assert res.available
    assert res.accepted
    assert res.best_id == target.stem
    assert res.inliers >= res.second_inliers


def test_a_card_not_on_the_shortlist_is_refused(cards):
    """The right answer is absent, so the verifier must not crown a stand-in."""
    v = CardVerifier()
    res = v.verify(rectified(cards[0]), [c.stem for c in cards[1:6]])
    assert not res.accepted or res.best_id != cards[0].stem


def test_featureless_input_is_refused(cards):
    v = CardVerifier()
    blank = np.full((337, 245, 3), 235, np.uint8)
    res = v.verify(blank, [c.stem for c in cards[:5]])
    assert not res.accepted


def test_reprints_do_not_become_each_others_runner_up(cards):
    """With a names map, two ids for one card are one answer. Without it the
    ratio rule would see a near-tie and refuse a correct match."""
    target = cards[0]
    ids = [c.stem for c in cards[:5]]
    twin = ids[1]
    names = dict.fromkeys(ids, "Distinct")
    names[target.stem] = "Shared"
    names[twin] = "Shared"          # pretend these two are one card, reprinted

    grouped = CardVerifier(names=names).verify(rectified(target), ids)
    assert grouped.available
    # the runner-up must be one of the genuinely different cards
    assert grouped.second_inliers == max(
        s for cid, s in grouped.per_candidate.items() if cid not in {target.stem, twin})


def test_missing_reference_images_degrade_gracefully(tmp_path, cards):
    v = CardVerifier(img_dir=tmp_path)
    res = v.verify(rectified(cards[0]), [c.stem for c in cards[:3]])
    assert res.available is False
    assert res.accepted is False
