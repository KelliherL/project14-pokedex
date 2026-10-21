"""Picking a winner and an honest runner-up.

Every accept rule in this project compares the best score against the
runner-up: the card lane wants "at least twice the next card", the figurine
lane wants a margin over the next figurine. The rule is only meaningful if
the runner-up is a genuinely DIFFERENT ANSWER.

That sounds obvious and has been got wrong three separate times:

* The figurine gate compared a Jolteon print against the *other* Jolteon
  print, and refused a correct match at 0.97 similarity on a margin of 0.021,
  because the runner-up was the same answer wearing a different label.
* The card lane compares against the next row of the database. In a
  multi-set database, reprints and holo variants of one illustration sit
  adjacent, so the margin collapses to zero and correct matches get rejected.
* A measurement that scored several crops of one photograph and let the same
  card, reached through a different crop, become its own runner-up. Every
  ratio came out at 1.00 and a 2x rule rejected 97% of correct answers.

So the comparison lives here once, takes an explicit grouping, and is used by
both lanes rather than reimplemented per caller.
"""

from collections.abc import Callable, Hashable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Ranked:
    best_key: Hashable | None       # the winning candidate
    best_score: float               # its score
    runner_up_score: float          # best score among candidates of a DIFFERENT group
    runner_up_key: Hashable | None  # which candidate that was

    @property
    def ratio(self) -> float:
        """How many times better the winner is than the next different answer."""
        return self.best_score / max(self.runner_up_score, 1e-9)

    @property
    def margin(self) -> float:
        return self.best_score - self.runner_up_score


def rank(scores: Mapping[Hashable, float],
         group_of: Callable[[Hashable], Hashable] | None = None) -> Ranked:
    """Rank candidates, taking the runner-up from a different group.

    `group_of` maps a candidate to the ANSWER it represents. Two candidates in
    the same group are the same answer as far as a visitor is concerned, so
    they must not compete with each other. The default treats every candidate
    as its own answer, which is right only when candidates are already
    distinct answers.
    """
    if not scores:
        return Ranked(None, 0.0, 0.0, None)
    group = group_of or (lambda k: k)
    best_key = max(scores, key=lambda k: scores[k])
    best_group = group(best_key)

    runner_key, runner_score = None, 0.0
    for key, score in scores.items():
        if group(key) == best_group:
            continue
        if runner_key is None or score > runner_score:
            runner_key, runner_score = key, score
    return Ranked(best_key, float(scores[best_key]), float(runner_score), runner_key)
