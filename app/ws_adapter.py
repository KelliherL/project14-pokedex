"""Adapts recogniser `Identification` objects into the WebSocket JSON shape
the frontend contract expects (see frontend/docs.md's "Quad overlay contract"
and "OpenCV / recogniser owner" sections).

Pure functions, no I/O — keeps this unit-testable in isolation and keeps the
recognisers themselves transport-agnostic (docs/INTERFACES.md: "nothing in
the recognisers changes").
"""

from typing import Any

import numpy as np

from app.recognisers.base import Identification


def normalise_quad(quad_px, width: int, height: int) -> list[list[float]] | None:
    """Pixel-space quad -> normalised 0-1, clamped.

    card_fallback.py's perturbed candidates have no upper-bound rejection,
    and minAreaRect corners can also land outside the frame, so coordinates
    must be clamped after dividing, not just divided.
    """
    if quad_px is None:
        return None
    pts = np.asarray(quad_px, dtype=float)
    pts[:, 0] = np.clip(pts[:, 0] / width, 0.0, 1.0)
    pts[:, 1] = np.clip(pts[:, 1] / height, 0.0, 1.0)
    return pts.tolist()


def _phase(mode: str, live: Identification, locked: Identification | None) -> str:
    if locked is not None:
        return "locked"
    if mode == "figurine":
        # The stub has no vote/lock state machine and always returns a
        # canned answer, so it has no real "idle" case either.
        return "searching"
    return "idle" if live.kind == "none" else "searching"


def build_detection_message(
    frame_no: int,
    width: int,
    height: int,
    mode: str,
    live: Identification,
    locked: Identification | None,
) -> dict[str, Any]:
    """Build one frame's WS 'detection' message.

    `quad` always reflects the CURRENT frame's live detection, independent of
    `locked` — the lock only freezes label/dexId/confidence/sigma, so the
    overlay keeps tracking the card after lock-on instead of freezing with it.
    """
    sticky = locked if locked is not None else live
    return {
        "type": "detection",
        "frame": frame_no,
        "frameSize": [width, height],
        "phase": _phase(mode, live, locked),
        "dexId": sticky.dex_id,
        "confidence": sticky.confidence,
        "sigma": sticky.explanation.get("sigma"),
        "top5": sticky.explanation.get("top5"),
        "quad": normalise_quad(live.explanation.get("quad"), width, height),
    }
