"""Figurine lane: crop, index, and the accept gate.

Every test here injects a fake embedder, so the suite exercises the decision
logic without downloading DINOv2 weights or importing torch. That is
deliberate: the gate is the part that decides what a visitor sees, and it
should be testable on any machine in milliseconds.
"""

import json

import numpy as np
import pytest

from app.recognisers.figurine_knn import (
    MIN_MARGIN,
    MIN_SIMILARITY,
    FigurineClassifier,
    FigurineIndex,
    background_plate,
    centre_crop,
    crop_for_embedding,
    foreground_bbox,
)


def unit(vec) -> np.ndarray:
    v = np.asarray(vec, dtype=np.float32)
    return v / np.linalg.norm(v)


@pytest.fixture
def toy_index(tmp_path):
    """Three figurines on orthogonal axes, each with a second reference offset
    symmetrically onto a shared fourth axis. Symmetry matters: it keeps a
    query placed between two classes genuinely equidistant, so the ambiguity
    test tests ambiguity rather than an accident of the fixture."""
    embs = np.stack([
        unit([1, 0, 0, 0]), unit([0.98, 0, 0, 0.2]),     # Pikachu
        unit([0, 1, 0, 0]), unit([0, 0.98, 0, 0.2]),     # Jolteon-A
        unit([0, 0, 1, 0]), unit([0, 0, 0.98, 0.2]),     # Jolteon-B
    ]).astype(np.float32)
    labels = np.array(["Pikachu", "Pikachu", "Jolteon-A", "Jolteon-A", "Jolteon-B", "Jolteon-B"])
    exemplars = np.array([f"exemplars/{label}_{i % 2:02d}.jpg" for i, label in enumerate(labels)])
    np.savez(tmp_path / "index.npz", embs=embs, labels=labels, exemplars=exemplars)
    (tmp_path / "labels.json").write_text(json.dumps({
        "Pikachu": {"display": "Pikachu", "dex_id": 25, "exemplar": "exemplars/Pikachu_00.jpg"},
        "Jolteon-A": {"display": "Jolteon", "dex_id": 135, "exemplar": "exemplars/Jolteon-A_00.jpg"},
        "Jolteon-B": {"display": "Jolteon", "dex_id": 135, "exemplar": "exemplars/Jolteon-B_00.jpg"},
    }), encoding="utf-8")
    return FigurineIndex(tmp_path / "index.npz", tmp_path / "labels.json")


def classifier_returning(index, vector):
    """A classifier whose embedder always answers with `vector`."""
    return FigurineClassifier(index=index, embedder=lambda imgs: np.stack([unit(vector)]))


FRAME = np.zeros((48, 64, 3), dtype=np.uint8)


# ---------- index ----------

def test_index_loads_classes_and_metadata(toy_index):
    assert toy_index
    assert toy_index.classes == ["Jolteon-A", "Jolteon-B", "Pikachu"]
    assert toy_index.meta["Jolteon-A"].dex_id == 135


def test_missing_index_is_falsy(tmp_path):
    index = FigurineIndex(tmp_path / "nope.npz", tmp_path / "nope.json")
    assert not index
    ident = FigurineClassifier(index=index, embedder=lambda imgs: np.zeros((1, 4))).identify(FRAME)
    assert ident.is_stub and ident.label is None


# ---------- the accept gate ----------

def test_clear_match_is_accepted(toy_index):
    ident = classifier_returning(toy_index, [1, 0, 0, 0]).identify(FRAME)
    assert ident.label == "Pikachu"
    assert ident.dex_id == 25
    assert ident.explanation["margin"] >= MIN_MARGIN
    assert not ident.is_stub


def test_ambiguous_match_is_refused(toy_index):
    """Equidistant between two figurines: the margin collapses, so the honest
    answer is None and the UI shows the retry prompt."""
    ident = classifier_returning(toy_index, [1, 1, 0, 0]).identify(FRAME)
    assert ident.label is None
    assert ident.explanation["margin"] < MIN_MARGIN


def test_out_of_domain_input_is_refused_by_the_floor(toy_index):
    """Something that is not a figurine at all sits far from every reference.
    This is the card-photo case, which measured 0.27 against 0.87 for real
    matches."""
    ident = classifier_returning(toy_index, [0, 0, 0, 1]).identify(FRAME)
    assert ident.label is None
    assert ident.explanation["best_similarity"] < MIN_SIMILARITY


def test_two_prints_of_one_species_share_a_dex_id(toy_index):
    """Recognition is per-object; the dex entry is per-species. Both Jolteon
    prints must speak as 'Jolteon' and look up dex 135."""
    for vector, label in (([0, 1, 0, 0], "Jolteon-A"), ([0, 0, 1, 0], "Jolteon-B")):
        ident = classifier_returning(toy_index, vector).identify(FRAME)
        assert ident.label == "Jolteon"
        assert ident.dex_id == 135
        assert ident.explanation["best_label"] == label


def test_explanation_carries_the_frontend_contract_keys(toy_index):
    ident = classifier_returning(toy_index, [1, 0, 0, 0]).identify(FRAME)
    for key in ("top5", "exemplars", "margin", "best_similarity", "criterion", "crop"):
        assert key in ident.explanation, key
    assert len(ident.explanation["exemplars"]) == 3
    assert ident.explanation["exemplars"][0]["similarity"] >= \
        ident.explanation["exemplars"][1]["similarity"]


# ---------- cropping ----------

def test_background_plate_isolates_a_moving_object():
    """A per-pixel median over frames where only a small patch moves must
    leave the background flat, so the patch is what gets cropped."""
    frames = []
    for i in range(9):
        f = np.full((60, 80, 3), 200, dtype=np.uint8)
        f[20:30, 10 + i : 20 + i] = 20          # a dark object drifting across
        frames.append(f)
    plate = background_plate(frames)
    assert plate.mean() > 180, "background should dominate the median"
    box = foreground_bbox(frames[0], plate)
    assert box is not None
    x, y, w, h = box
    assert 5 <= x <= 25 and 15 <= y <= 35
    assert w < 40 and h < 40, "crop must be the object, not the whole frame"


def test_crop_falls_back_to_centre_without_a_plate():
    frame = np.random.default_rng(0).integers(0, 255, (60, 80, 3), dtype=np.uint8)
    crop, box = crop_for_embedding(frame, None)
    assert box is None
    assert crop.shape[0] == crop.shape[1]


def test_centre_crop_is_square():
    assert centre_crop(np.zeros((40, 90, 3), dtype=np.uint8)).shape[:2] == \
        centre_crop(np.zeros((90, 40, 3), dtype=np.uint8)).shape[:2]


# ---------- the shipped index ----------

def test_shipped_index_is_present_and_consistent():
    """The index committed to the repo should load and agree with labels.json."""
    index = FigurineIndex()
    if not index:
        pytest.skip("no figurine index built")
    assert len(index.embeddings) == len(index.labels) == len(index.exemplars)
    assert set(index.classes) <= set(index.meta)
    norms = np.linalg.norm(index.embeddings, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-3), "embeddings must be L2-normalised"


def test_shipped_index_recognises_its_own_reference(tmp_path):
    """Feed a reference embedding straight back in: it must return that
    figurine and clear the gate. Exercises the real index without torch."""
    index = FigurineIndex()
    if not index:
        pytest.skip("no figurine index built")
    target = index.labels[0]
    clf = FigurineClassifier(index=index,
                             embedder=lambda imgs: index.embeddings[0:1].copy())
    ident = clf.identify(FRAME)
    assert ident.explanation["best_label"] == target
    assert ident.label is not None, "a reference frame must clear its own gate"
