"""The runner-up must be a different ANSWER.

This invariant has been got wrong three times in this project, each time
producing a rule that rejects correct matches:

* two prints of one Jolteon competing with each other,
* reprints of one card competing in a multi-set database,
* one card reached through two crops of the same photo becoming its own
  runner-up.

These tests pin the behaviour so it cannot regress a fourth time.
"""

from app.recognisers.scoring import rank


def test_runner_up_comes_from_a_different_group():
    """Two labels for one answer must not compete. This is the Jolteon case:
    a correct match at 0.97 was once refused because the other print of the
    same figurine was sitting right behind it."""
    scores = {"Jolteon-A": 0.97, "Jolteon-B": 0.92, "Vaporeon": 0.60}
    same_answer = {"Jolteon-A": "dex:135", "Jolteon-B": "dex:135", "Vaporeon": "Vaporeon"}
    r = rank(scores, group_of=same_answer.get)
    assert r.best_key == "Jolteon-A"
    assert r.runner_up_key == "Vaporeon"
    assert r.margin == 0.97 - 0.60
    assert r.ratio > 1.6


def test_without_grouping_the_sibling_would_have_won_the_runner_up_slot():
    """The failure this guards against, shown explicitly."""
    scores = {"Jolteon-A": 0.97, "Jolteon-B": 0.92, "Vaporeon": 0.60}
    naive = rank(scores)
    assert naive.runner_up_key == "Jolteon-B"
    assert naive.margin < 0.06, "this is the collapse that refuses a correct match"


def test_reprints_of_one_card_do_not_compete():
    """The card-lane version: one illustration printed in several sets."""
    scores = {"base1-4": 300, "base2-4": 280, "base1-15": 40}
    by_name = {"base1-4": "Charizard", "base2-4": "Charizard", "base1-15": "Beedrill"}
    r = rank(scores, group_of=by_name.get)
    assert r.best_key == "base1-4"
    assert r.runner_up_key == "base1-15"
    assert r.ratio == 300 / 40


def test_default_grouping_treats_each_candidate_as_its_own_answer():
    r = rank({"a": 10, "b": 4, "c": 1})
    assert r.best_key == "a"
    assert r.runner_up_key == "b"
    assert r.margin == 6


def test_single_candidate_has_no_runner_up():
    r = rank({"only": 5.0})
    assert r.best_key == "only"
    assert r.runner_up_score == 0.0
    assert r.runner_up_key is None


def test_all_candidates_in_one_group_have_no_runner_up():
    """Everything on the shortlist is the same answer, so nothing contradicts
    it and the margin is the whole score."""
    r = rank({"x": 9, "y": 8}, group_of=lambda k: "same")
    assert r.best_key == "x"
    assert r.runner_up_key is None
    assert r.margin == 9


def test_empty_input_is_safe():
    r = rank({})
    assert r.best_key is None
    assert r.margin == 0.0
    assert r.ratio == 0.0
