"""Explanation panel drawn over the live feed — the 'how the AI saw it'
display is a first-class deliverable, so even the stub renders real data
where it exists (detected quad, rectified view, sigma score) and labels
anything canned as STUB."""

import cv2
import numpy as np

from app.recognisers.base import Identification

FONT = cv2.FONT_HERSHEY_SIMPLEX
THUMB_W, THUMB_H = 123, 169


def draw(frame: np.ndarray, ident: Identification | None, mode: str) -> np.ndarray:
    h, w = frame.shape[:2]

    cv2.rectangle(frame, (0, 0), (w, 34), (32, 32, 32), -1)
    keys = "[space] identify+speak   [m] switch mode   [q] quit"
    if mode == "figurine":
        keys = "[space] speak   [b] capture empty stand   [m] switch   [q] quit"
    cv2.putText(frame, f"MODE: {mode.upper()}   {keys}",
                (10, 23), FONT, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    if ident is None:
        return frame

    ex = ident.explanation

    if "quad" in ex:
        pts = np.array(ex["quad"], dtype=np.int32)
        cv2.polylines(frame, [pts], True, (0, 220, 0), 2)

    rectified = ex.get("rectified")
    if isinstance(rectified, np.ndarray) and h > 60 + THUMB_H and w > 20 + THUMB_W:
        thumb = cv2.resize(rectified, (THUMB_W, THUMB_H))
        frame[44 : 44 + THUMB_H, w - 10 - THUMB_W : w - 10] = thumb
        cv2.putText(frame, "as the AI sees it", (w - 10 - THUMB_W, 44 + THUMB_H + 16),
                    FONT, 0.4, (200, 200, 200), 1, cv2.LINE_AA)

    if "top5" in ex:
        for i, (name, p) in enumerate(ex["top5"]):
            y = 60 + i * 26
            cv2.rectangle(frame, (10, y), (10 + int(240 * p), y + 16), (200, 120, 0), -1)
            cv2.putText(frame, f"{name} {p:.2f}", (258, y + 13),
                        FONT, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

    # Figurine lane: the margin IS the accept decision, so show it.
    if "margin" in ex:
        cv2.putText(
            frame,
            f"nearest reference: {ex['best_similarity']:.3f}"
            f"   next different answer: {ex['runner_up_similarity']:.3f}"
            f"   ->  margin {ex['margin']:.3f}",
            (10, h - 40), FONT, 0.45, (180, 220, 180), 1, cv2.LINE_AA,
        )
        if ex.get("bbox") is None:
            cv2.putText(
                frame,
                "no background plate - press [b] with the stand empty for a reliable crop",
                (10, h - 88), FONT, 0.45, (0, 180, 255), 1, cv2.LINE_AA,
            )
        elif ex.get("bbox"):
            x, y, bw, bh = ex["bbox"]
            cv2.rectangle(frame, (x, y), (x + bw, y + bh), (0, 220, 0), 2)

    if "sigma" in ex:
        cv2.putText(
            frame,
            f"hash match: best={ex['best_distance']} vs mean={ex['mean_distance']}"
            f"  ->  {ex['sigma']} sigma  ({ex['criterion']})",
            (10, h - 40), FONT, 0.45, (180, 220, 180), 1, cv2.LINE_AA,
        )

    if ex.get("locked"):
        if "margin" in ex:
            text = f"LOCKED: {ex['margin']:.3f} margin over the next different answer"
        elif ex.get("verified"):
            text = (f"LOCKED + VERIFIED: {ex['verified_inliers']} matched points"
                    f" (runner-up {ex['verified_second']})")
        else:
            text = f"LOCKED ({ex.get('verify_note', 'unverified')})"
        cv2.putText(frame, text, (10, h - 66), FONT, 0.5, (0, 255, 0), 1, cv2.LINE_AA)

    label = ident.label if ident.label else "…"
    cv2.putText(frame, f"{label}   confidence {ident.confidence:.2f}",
                (10, h - 14), FONT, 0.7, (0, 255, 255), 2, cv2.LINE_AA)

    if ident.is_stub:
        cv2.putText(frame, "STUB", (w // 2 - 70, h // 2), FONT, 2.0, (0, 0, 255), 3, cv2.LINE_AA)

    return frame
