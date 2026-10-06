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
from dataclasses import dataclass


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


@dataclass(frozen=True)
class FrameScore:
    """One frame's opinion, before any accept decision has been made."""

    answer: str        # what this frame would say, e.g. "Jolteon"
    similarity: float  # how close the nearest reference was
    margin: float      # how far ahead of the best DIFFERENT answer


class BurstGate:
    """Accept a figurine on the strength of a burst, not a single frame.

    Every figurine measurement until 2026-09-17 judged one frame at a time,
    but the kiosk watches ten and votes, exactly as the card lane does. That
    mattered more than it sounds: a per-frame gate has to be loose enough to
    fire on one unlucky frame, which is why the per-frame setting also accepted
    11.1% of other people's figurines.

    Two things came out of measuring the burst instead:

    * Burst voting alone names the right figurine on 97.8% of bursts across
      seven simulated session shifts, and 100% on the five that are not
      extreme. Identification was never the problem.
    * The gate was refusing answers the system had got right. Under a combined
      new-room shift, votes were 100% correct and only 80% accepted, because
      MIN_MARGIN is a DIFFERENCE of similarities and a global lighting change
      shrinks both sides together while the decision gets no harder.

    So the margin requirement is almost nothing and the work is done by
    agreement plus a LOOSE absolute similarity floor. That is not a
    contradiction of the earlier finding that absolute thresholds are brittle:
    a TIGHT floor at 0.873 rejected every correct answer under rotation, while
    0.70 sits far below any genuine match and far above the 0.52 that other
    people's figurines average.

    Measured against the per-frame rule it replaces: correct-and-accepted
    84.2% -> 95.4%, other people's figurines wrongly accepted 11.1% -> 0.7%,
    household objects 0.0% either way. Held out two-fold by figurine, 94.1%
    and 0.7%, with both folds independently choosing the 0.70 floor.
    """

    def __init__(self, window: int = 10, need: int = 6,
                 min_similarity: float = 0.70, min_margin: float = 0.01):
        self.window = window
        self.need = need
        self.min_similarity = min_similarity
        self.min_margin = min_margin
        self._frames: deque[FrameScore | None] = deque(maxlen=window)

    def add(self, score: FrameScore | None) -> str | None:
        """Record one frame. Returns the accepted answer, or None.

        `None` means the frame saw nothing worth voting on, which still
        occupies a slot in the window so a figurine that leaves the stand
        stops being reported.
        """
        self._frames.append(score)
        seen = [f for f in self._frames if f is not None]
        if not seen:
            return None

        answer, agreeing = Counter(f.answer for f in seen).most_common(1)[0]
        if agreeing < self.need:
            return None

        matching = [f for f in seen if f.answer == answer]
        mean_similarity = sum(f.similarity for f in matching) / len(matching)
        mean_margin = sum(f.margin for f in matching) / len(matching)
        if mean_similarity < self.min_similarity or mean_margin < self.min_margin:
            return None
        return answer

    def reset(self) -> None:
        self._frames.clear()
