"""Temporal voting: lock an identification only when the same candidate
tops the hash lane in enough recent frames.

Vote on RAW per-frame top-1, not threshold-accepted frames — under heavy
glare the accept rule rejects most frames (correctly), but the top-1 is
still right ~3/4 of the time, so votes converge fast while single-frame
acceptance starves (measured 2026-08-07: raw-vote locked 10/10 correct
under harsh synthetic glare; accepted-only voting locked 1/10).
The accept decision belongs to the verify stage, not to the vote.
"""

from collections import Counter, deque


class VoteBuffer:
    def __init__(self, window: int = 10, need: int = 6):
        self.window = window
        self.need = need
        self._votes: deque[str | None] = deque(maxlen=window)

    def add(self, label: str | None) -> str | None:
        """Record one frame's top-1 (None = nothing detected).
        Returns the winning label the moment it reaches `need` votes."""
        self._votes.append(label)
        counts = Counter(v for v in self._votes if v is not None)
        if counts:
            label_, n = counts.most_common(1)[0]
            if n >= self.need:
                return label_
        return None

    def reset(self) -> None:
        self._votes.clear()
