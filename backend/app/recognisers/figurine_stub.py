"""STUB figurine recogniser — canned output, no model.

Placeholder for the closed-set figurine backend. Spike (b) in
ARCHITECTURE.md replaces this with the winner of CLIP-embedding-kNN vs
fine-tuned ViT, both over self-collected photos of the actual event
figurines. Until then this exists so the full loop (identify -> explain ->
speak) can be demonstrated end to end.
"""

import numpy as np

from .base import Identification

STUB_TOP5 = [
    ("Pikachu", 0.42),
    ("Raichu", 0.21),
    ("Eevee", 0.14),
    ("Jolteon", 0.09),
    ("Meowth", 0.05),
]


class FigurineClassifierStub:
    def identify(self, frame: np.ndarray) -> Identification:
        return Identification(
            kind="figurine",
            label=STUB_TOP5[0][0],
            dex_id=25,
            confidence=STUB_TOP5[0][1],
            is_stub=True,
            explanation={
                # Same {name, confidence} shape as CardMatcher's top5, so the
                # frontend renders both recognisers' "what it could be" list
                # identically regardless of which one ran.
                "top5": [{"name": name, "confidence": p} for name, p in STUB_TOP5],
                "note": "STUB — canned output; heatmap panel arrives with the real model",
            },
        )
