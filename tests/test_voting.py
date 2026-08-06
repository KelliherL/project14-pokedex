"""VoteBuffer: lock on 6-of-10 raw top-1 votes; None frames never vote."""

from app.recognisers.voting import VoteBuffer


def test_locks_after_six_matching_votes():
    v = VoteBuffer(window=10, need=6)
    for _ in range(5):
        assert v.add("base1-4") is None
    assert v.add("base1-4") == "base1-4"


def test_none_frames_do_not_vote_but_occupy_window():
    v = VoteBuffer(window=10, need=6)
    seq = ["base1-4", None, "base1-4", None, "base1-4", "base1-4", "base1-4"]
    assert all(v.add(s) is None for s in seq)
    assert v.add("base1-4") == "base1-4"


def test_split_vote_does_not_lock():
    v = VoteBuffer(window=10, need=6)
    for _ in range(5):
        assert v.add("base1-4") is None
        assert v.add("base1-58") is None


def test_window_evicts_stale_votes():
    v = VoteBuffer(window=10, need=6)
    for _ in range(5):
        v.add("base1-4")
    for _ in range(5):
        assert v.add("base1-58") is None  # 5 vs 5 inside the window
    assert v.add("base1-58") == "base1-58"  # evicts a base1-4 -> 6 of 10


def test_reset_clears_votes():
    v = VoteBuffer(window=10, need=6)
    for _ in range(5):
        v.add("base1-4")
    v.reset()
    for _ in range(5):
        assert v.add("base1-4") is None
    assert v.add("base1-4") == "base1-4"
