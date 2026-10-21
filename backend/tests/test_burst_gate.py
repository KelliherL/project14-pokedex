"""The burst gate: decide on ten frames, not one.

These pin the behaviour that took correct-and-accepted from 84.2% to 95.4%
while cutting wrongly-accepted strangers' figurines from 11.1% to 0.7%.
"""

import pytest

from app.recognisers.voting import BurstGate, FrameScore


def frames(gate, answer, n, similarity=0.90, margin=0.10):
    """Feed n identical frames, returning whatever the gate last said."""
    out = None
    for _ in range(n):
        out = gate.add(FrameScore(answer=answer, similarity=similarity, margin=margin))
    return out


def test_a_consistent_burst_is_accepted():
    gate = BurstGate()
    assert frames(gate, "Pikachu", 6) == "Pikachu"


def test_too_few_agreeing_frames_is_refused():
    gate = BurstGate(need=6)
    assert frames(gate, "Pikachu", 5) is None


def test_a_flickering_burst_is_refused():
    """An object the index does not hold tends to flicker between neighbours.
    No answer reaches the agreement threshold, so nothing is accepted."""
    gate = BurstGate()
    got = None
    for answer in ["Pikachu", "Eevee", "Vulpix", "Mewtwo", "Pikachu",
                   "Eevee", "Vulpix", "Mewtwo", "Pikachu", "Eevee"]:
        got = gate.add(FrameScore(answer=answer, similarity=0.92, margin=0.09))
    assert got is None


def test_agreement_alone_is_not_enough():
    """Agreement measures consistency, not correctness. A held-out figurine
    maps to the SAME wrong neighbour on every frame, which is why the
    similarity floor has to be there too."""
    gate = BurstGate()
    assert frames(gate, "Vaporeon", 10, similarity=0.55) is None


def test_the_similarity_floor_is_loose_enough_to_survive_a_lighting_shift():
    """0.70, not 0.873. A tight floor calibrated on clean frames rejected
    every correct answer under a 15 degree rotation."""
    gate = BurstGate()
    assert frames(gate, "Mewtwo", 8, similarity=0.74, margin=0.04) == "Mewtwo"


def test_a_vanishing_margin_is_still_refused():
    """Two answers neck and neck is the genuinely ambiguous case."""
    gate = BurstGate()
    assert frames(gate, "Jolteon", 10, similarity=0.95, margin=0.0) is None


def test_empty_frames_occupy_the_window():
    """A figurine taken off the stand must stop being reported, so frames that
    saw nothing still take up a slot."""
    gate = BurstGate(window=10, need=6)
    assert frames(gate, "Eevee", 6) == "Eevee"
    for _ in range(5):
        gate.add(None)
    assert gate.add(None) is None


def test_averaging_tolerates_a_single_bad_frame():
    """One dim or blurred frame in ten should not veto the burst."""
    gate = BurstGate()
    for _ in range(9):
        gate.add(FrameScore(answer="Vulpix", similarity=0.93, margin=0.12))
    assert gate.add(FrameScore(answer="Vulpix", similarity=0.40, margin=0.01)) == "Vulpix"


def test_reset_clears_the_window():
    gate = BurstGate()
    frames(gate, "Pikachu", 6)
    gate.reset()
    assert frames(gate, "Pikachu", 3) is None


@pytest.mark.parametrize("need", [6, 8, 10])
def test_need_is_respected(need):
    gate = BurstGate(need=need)
    assert frames(gate, "Flareon", need - 1) is None
    assert gate.add(FrameScore(answer="Flareon", similarity=0.9, margin=0.1)) == "Flareon"
