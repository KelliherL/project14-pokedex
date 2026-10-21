"""The contract every recogniser backend fulfils.

The UI, speech, and dex layers depend only on this shape — swapping the
figurine stub for the real classifier must not touch them.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Identification:
    kind: str                    # "card" | "figurine" | "none"
    label: str | None = None     # card name or species name; None = unsure
    dex_id: int | None = None    # National Dex number, when known
    confidence: float = 0.0      # 0..1, display-friendly
    is_stub: bool = False        # True while the backend is canned output
    # Extra payload for the explanation panel: quads, rectified views,
    # distances, top-5 lists — whatever the backend can honestly show.
    explanation: dict[str, Any] = field(default_factory=dict)
