"""The original `cv2.imshow` dev loop — a visual harness for exercising the
recognition pipeline without a frontend, kept as an explicit opt-in
(`python -m app.main --dev-window`) now that the server is the default.

Deliberately single-threaded and separate from app/capture.py's
CaptureWorker: `cv2.imshow`/`cv2.waitKey` and a `uvicorn` asyncio event loop
are not meant to share a process, so this path never involves the server at
all.
"""

import sys

import cv2

from app import overlay
from app.capture import FALLBACK_AFTER_FRAMES, FALLBACK_EVERY, UNLOCK_AFTER_EMPTY_FRAMES, lock_from
from app.dex import Dex
from app.recognisers.base import Identification
from app.recognisers.card_matcher import CardMatcher
from app.recognisers.figurine_stub import FigurineClassifierStub
from app.recognisers.verify import CardVerifier
from app.recognisers.voting import VoteBuffer
from app.tts import speak


def run(camera: int, mode: str, mute: bool) -> int:
    recognisers = {"card": CardMatcher(), "figurine": FigurineClassifierStub()}
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
    locked: Identification | None = None
    empty_streak = 0

    hard_streak = 0
    frame_no = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            print("error: camera read failed")
            break
        frame_no += 1

        use_fallback = (mode == "card"
                        and hard_streak >= FALLBACK_AFTER_FRAMES
                        and frame_no % FALLBACK_EVERY == 0)
        if mode == "card":
            ident = recognisers["card"].identify(frame, allow_fallback=use_fallback)
            hard_streak = 0 if ident.explanation.get("best_card") else hard_streak + 1
        else:
            ident = recognisers[mode].identify(frame)

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

        shown = locked if (mode == "card" and locked is not None) else ident
        frame = overlay.draw(frame, shown, mode)
        cv2.imshow("Pokedex dev harness — COMPX374 P14", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("m"):
            mode = "figurine" if mode == "card" else "card"
            votes.reset()
            locked = None
            hard_streak = 0
        elif key == ord(" "):
            speak(dex.line_for(shown), mute=mute)

    cap.release()
    cv2.destroyAllWindows()
    return 0
