"""The original `cv2.imshow` dev loop — a visual harness for exercising the
recognition pipeline without a frontend, kept as an explicit opt-in
(`python -m app.main --dev-window`) now that the server is the default.

Deliberately single-threaded and separate from app/capture.py's
CaptureWorker: `cv2.imshow`/`cv2.waitKey` and a `uvicorn` asyncio event loop
are not meant to share a process, so this path never involves the server at
all. The identify -> vote/burst -> lock pipeline is the same one
CaptureWorker runs; the shared constants/functions are imported from there
rather than duplicated.
"""

import os
import sys

import cv2

from app import overlay
from app.capture import (
    EXIT_FORCE,
    EXIT_QUIT,
    EXIT_RESTART,
    FALLBACK_AFTER_FRAMES,
    FALLBACK_EVERY,
    PLATE_FRAMES,
    UNLOCK_AFTER_EMPTY_FRAMES,
    build_figurine_recogniser,
    clear_console,
    figurine_lock,
    lock_from,
)
from app.dex import Dex
from app.recognisers.base import Identification
from app.recognisers.card_matcher import CardMatcher
from app.recognisers.figurine_knn import FigurineClassifier
from app.recognisers.verify import CardVerifier
from app.recognisers.voting import BurstGate, FrameScore, VoteBuffer
from app.tts import speak


def run(camera: int, mode: str, mute: bool) -> int:
    recognisers = {"card": CardMatcher(), "figurine": build_figurine_recogniser()}
    if not recognisers["card"].db:
        print("note: card DB missing — run scripts/build_card_db.py for real matching")
    dex = Dex()
    if not dex.source.species_ids():
        print("note: dex data missing — run scripts/fetch_dex_data.py for spoken entries")

    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(camera, backend)
    if not cap.isOpened():
        print(f"error: cannot open camera {camera} (try --camera 1)")
        return 1

    verifier = CardVerifier(names={e["id"]: e["name"] for e in recognisers["card"].db})
    votes = VoteBuffer()
    burst = BurstGate()
    locked: Identification | None = None
    empty_streak = 0

    hard_streak = 0
    frame_no = 0
    exit_code = EXIT_QUIT
    while True:
        ok, frame = cap.read()
        if not ok:
            print("error: camera read failed")
            break
        frame_no += 1

        # Spend the expensive search only on frames the cheap path has given
        # up on, and only occasionally.
        use_fallback = (mode == "card"
                        and hard_streak >= FALLBACK_AFTER_FRAMES
                        and frame_no % FALLBACK_EVERY == 0)
        if mode == "card":
            ident = recognisers["card"].identify(frame, allow_fallback=use_fallback)
            hard_streak = 0 if ident.explanation.get("best_card") else hard_streak + 1
        else:
            ident = recognisers[mode].identify(frame)

        # Figurine mode runs the same shape: embed per frame -> burst vote ->
        # margin gate at lock-on.
        if mode == "figurine" and isinstance(recognisers["figurine"], FigurineClassifier):
            answer = ident.explanation.get("best_answer")
            score = None if answer is None else FrameScore(
                answer=answer,
                similarity=ident.explanation.get("best_similarity", 0.0),
                margin=ident.explanation.get("margin", 0.0),
            )
            if answer is None:
                empty_streak += 1
                if empty_streak >= UNLOCK_AFTER_EMPTY_FRAMES:
                    burst.reset()
                    locked = None
            else:
                empty_streak = 0
            if locked is None:
                winner = burst.add(score)
                if winner:
                    locked = figurine_lock(ident, winner)

        # Card mode runs the full lane: hash per frame -> vote -> verify once.
        if mode == "card" and recognisers["card"].db:
            if ident.kind == "none":
                empty_streak += 1
                if empty_streak >= UNLOCK_AFTER_EMPTY_FRAMES:
                    votes.reset()
                    locked = None
            else:
                empty_streak = 0
                if locked is None:
                    winner = votes.add(ident.explanation.get("best_card"))
                    if winner:
                        locked = lock_from(ident, recognisers["card"], verifier, winner)
                        if locked is None:
                            votes.reset()  # verify abstained; keep watching

        shown = locked if locked is not None else ident
        frame = overlay.draw(frame, shown, mode)
        cv2.imshow("Pokedex dev harness — COMPX374 P14", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            exit_code = EXIT_RESTART
            break
        elif key == ord("x"):
            print("force shutdown")
            os._exit(EXIT_FORCE)
        elif key == ord("c"):
            clear_console()
        elif key == ord("m"):
            mode = "figurine" if mode == "card" else "card"
            votes.reset()
            burst.reset()
            locked = None
            hard_streak = 0
        elif key == ord("b") and isinstance(recognisers["figurine"], FigurineClassifier):
            plate = []
            for _ in range(PLATE_FRAMES):
                got, f = cap.read()
                if got:
                    plate.append(f)
            recognisers["figurine"].set_background(plate)
            print(f"background plate captured from {len(plate)} frames "
                  "— remove the figurine before pressing b")
        elif key == ord(" "):
            speak(dex.line_for(shown), mute=mute)

    cap.release()
    cv2.destroyAllWindows()
    return exit_code
