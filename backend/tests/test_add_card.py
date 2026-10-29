"""Add-a-card: input validation (all of it can reach Mongo) and the save round trip."""

import cv2
import numpy as np
import pytest
from PIL import Image

from app.add_card import number, save_card, text, types_list
from app.recognisers.card_matcher import CARD_H, CARD_W, CardMatcher
from app.recognisers.verify import CardVerifier


def test_text_rejects_digit_runs_but_keeps_real_names():
    parse = text(40)
    for ok in ("Porygon2", "Mr. Mime", "Nidoran♂", "Type: Null", "Sea Lion Pokémon"):
        assert parse(ok) == ok
    for bad in ("4111 1111 1111 1111", "card 4111-1111-1111", "0211234567"):
        with pytest.raises(ValueError):
            parse(bad)
    with pytest.raises(ValueError):
        parse("x" * 41)


def test_number_and_types_validate():
    stat = number(1, 255, int)
    assert stat("90") == 90
    for bad in ("0", "256", "1.5", "nan", "lots"):
        with pytest.raises(ValueError):
            stat(bad)
    with pytest.raises(ValueError):
        number(0, 100)("nan")
    assert types_list("Water, ICE") == ["water", "ice"]
    for bad in ("lava", "fire, water, grass", ""):
        with pytest.raises(ValueError):
            types_list(bad)


def test_saved_card_is_matched_and_verifiable(tmp_path):
    rng = np.random.default_rng(0)
    card = cv2.resize(rng.integers(0, 255, (34, 25, 3), dtype=np.uint8), (CARD_W, CARD_H),
                      interpolation=cv2.INTER_NEAREST)
    db_path = tmp_path / "hashes.json"
    cid = save_card(card, "Flying Pikachu", [25], own_dir=tmp_path, db_path=db_path)
    assert cid == "own-flying-pikachu-1"
    assert save_card(card, "Flying Pikachu", [25], own_dir=tmp_path,
                     db_path=db_path) == "own-flying-pikachu-2"

    matcher = CardMatcher(db_path)
    assert [e["id"] for e in matcher.db] == ["own-flying-pikachu-1", "own-flying-pikachu-2"]
    assert matcher.db[0]["dex_ids"] == [25]
    # the saved file is lossy webp, so the original crop lands near, not exactly on, its hash
    assert matcher._distances(Image.fromarray(cv2.cvtColor(card, cv2.COLOR_BGR2RGB))).min() <= 6
    assert CardVerifier(img_dir=tmp_path)._ref_features(cid) is not None
