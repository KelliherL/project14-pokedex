"""The packed hash search must agree with the obvious implementation exactly.

`CardMatcher._distances` replaces a Python loop over the database with two
array operations. That is only worth doing if the answers are identical, so
these tests compare it against the straightforward version it replaced rather
than against a remembered set of numbers.
"""

import numpy as np
import pytest
from PIL import Image

from app.recognisers.card_matcher import CardMatcher


def reference_distances(matcher, pil):
    """The original implementation: compare ImageHash objects one at a time."""
    import imagehash

    ph, dh = imagehash.phash(pil), imagehash.dhash(pil)
    return np.array(
        [
            min(ph - p for p in e["phash"]) + min(dh - d for d in e["dhash"])
            for e in matcher.db
        ],
        dtype=np.float64,
    )


@pytest.fixture(scope="module")
def matcher():
    m = CardMatcher()
    if not m.db:
        pytest.skip("card DB not built")
    return m


def probes():
    rng = np.random.default_rng(0)
    yield Image.fromarray(rng.integers(0, 255, (337, 245, 3), dtype=np.uint8))
    yield Image.new("RGB", (245, 337), (235, 235, 235))
    grad = np.tile(np.linspace(0, 255, 245, dtype=np.uint8), (337, 1))
    yield Image.fromarray(np.dstack([grad] * 3))


def test_packed_search_matches_the_loop_exactly(matcher):
    for pil in probes():
        np.testing.assert_array_equal(matcher._distances(pil), reference_distances(matcher, pil))


def test_packed_search_matches_on_a_real_reference_card(matcher):
    """A genuine card should score near zero against itself, by both paths."""
    from pathlib import Path

    img_dir = Path(__file__).resolve().parents[1] / "data" / "cards" / "images"
    files = sorted(p for p in img_dir.iterdir() if p.suffix in {".webp", ".png"})
    if not files:
        pytest.skip("reference images not cached")
    pil = Image.open(files[0]).convert("RGB").resize((245, 337))
    packed = matcher._distances(pil)
    np.testing.assert_array_equal(packed, reference_distances(matcher, pil))
    assert packed.min() <= 4, "a reference card should match itself closely"


def test_pack_shapes_line_up_with_the_database(matcher):
    cards = len(matcher.db)
    assert matcher._phash_bits.shape == (cards, len(matcher.db[0]["phash"]), 64)
    assert matcher._dhash_bits.shape == (cards, len(matcher.db[0]["dhash"]), 64)


def test_empty_database_does_not_explode(tmp_path):
    empty = CardMatcher(db_path=tmp_path / "missing.json")
    assert empty.db == []
    assert empty._phash_bits.shape[0] == 0
