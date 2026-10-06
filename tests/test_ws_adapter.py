"""ws_adapter: pixel->normalised quad conversion and the WS message shape.

Regression cover for two frontend/docs.md requirements: out-of-frame quads
(card_fallback.py's perturbed candidates have no upper-bound rejection, and
minAreaRect corners can land outside the frame) must be clamped to 0-1 rather
than sent raw; and the quad must come from the LIVE frame even while an
identification is locked, so the overlay keeps tracking the card instead of
freezing with the lock.
"""

from app.recognisers.base import Identification
from app.ws_adapter import build_detection_message, normalise_quad

W, H = 640, 480


def test_in_frame_quad_normalises_to_0_1():
    quad = [[64, 48], [576, 48], [576, 432], [64, 432]]
    assert normalise_quad(quad, W, H) == [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]


def test_out_of_bounds_quad_is_clamped():
    quad = [[-100, -50], [W + 100, -50], [W + 100, H + 50], [-100, H + 50]]
    assert normalise_quad(quad, W, H) == [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]


def test_none_quad_passes_through():
    assert normalise_quad(None, W, H) is None


def _ident(kind="card", quad=None, dex_id=None, top5=None):
    explanation = {}
    if quad is not None:
        explanation["quad"] = quad
    if top5 is not None:
        explanation["top5"] = top5
    return Identification(kind=kind, dex_id=dex_id, explanation=explanation)


def test_kind_none_has_no_quad_and_is_idle():
    live = _ident(kind="none")
    msg = build_detection_message(1, W, H, "card", live, None)
    assert msg["quad"] is None
    assert msg["phase"] == "idle"


def test_card_visible_but_unlocked_is_searching():
    live = _ident(kind="card", quad=[[0, 0], [10, 0], [10, 10], [0, 10]])
    msg = build_detection_message(1, W, H, "card", live, None)
    assert msg["phase"] == "searching"
    assert msg["quad"] is not None


def test_figurine_has_no_quad_key_and_is_always_searching():
    top5 = [{"name": "Pikachu", "confidence": 0.42}]
    live = Identification(kind="figurine", confidence=0.42, explanation={"top5": top5, "note": "stub"})
    msg = build_detection_message(1, W, H, "figurine", live, None)
    assert msg["quad"] is None
    assert msg["phase"] == "searching"
    assert msg["top5"] == top5


def test_locked_sources_dexid_and_top5_from_lock_but_quad_from_live():
    live = _ident(kind="card", quad=[[100, 100], [200, 100], [200, 200], [100, 200]])
    top5 = [{"name": "Turtwig", "confidence": 0.9}, {"name": "Chimchar", "confidence": 0.3}]
    locked = _ident(kind="card", dex_id=387, top5=top5)
    msg = build_detection_message(42, W, H, "card", live, locked)
    assert msg["phase"] == "locked"
    assert msg["dexId"] == 387
    assert msg["top5"] == top5
    assert msg["quad"] == normalise_quad(live.explanation["quad"], W, H)


def test_message_has_exactly_the_agreed_fields():
    """Locks in the trimmed contract: confidence/sigma are deliberately not
    sent -- top5's per-candidate confidence (sigma-scored, not the old
    saturating distance/32 formula) replaces them."""
    live = _ident(kind="card", quad=[[0, 0], [10, 0], [10, 10], [0, 10]])
    msg = build_detection_message(1, W, H, "card", live, None)
    assert set(msg) == {"type", "frame", "frameSize", "phase", "dexId", "top5", "quad"}


def test_no_top5_available_reports_null_not_a_missing_key():
    live = _ident(kind="card", quad=[[0, 0], [10, 0], [10, 10], [0, 10]])
    msg = build_detection_message(1, W, H, "card", live, None)
    assert msg["top5"] is None


def test_dex_id_none_passes_through_for_trainer_or_energy_cards():
    live = _ident(kind="card", dex_id=None)
    msg = build_detection_message(1, W, H, "card", live, None)
    assert msg["dexId"] is None


def test_frame_and_frame_size_are_carried_through():
    live = _ident(kind="none")
    msg = build_detection_message(99, W, H, "card", live, None)
    assert msg["frame"] == 99
    assert msg["frameSize"] == [W, H]
