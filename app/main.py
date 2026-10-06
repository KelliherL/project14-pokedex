"""Pokédex kiosk — COMPX374 Project 14.

Default: starts the real server (capture thread + FastAPI/`uvicorn`) that the
frontend talks to, per frontend/docs.md's contract (app/server.py,
app/capture.py). Everything a UI needs arrives as an Identification — that
boundary is documented in docs/INTERFACES.md.

`--dev-window` instead runs the original `cv2.imshow` visual harness
(app/dev_harness.py) with no server involved at all — useful for eyeballing
the recognition pipeline without a frontend running.

Run:    python -m app.main                     (server, from the repo root, venv active)
        python -m app.main --dev-window         (cv2 debug window instead)
Server console keys: space = identify + speak · m = switch card/figurine · q = quit
Run:  python -m app.main             (from the repo root, venv active)
Keys: space = identify + speak · m = switch card/figurine · q = quit
      b = capture the empty-stand background plate (figurine mode)

See README.md for what is real vs stubbed.
"""

import argparse
import os
import sys

import uvicorn
import cv2

from app import overlay
from app.dex import Dex
from app.recognisers.base import Identification
from app.recognisers.card_matcher import CardMatcher
from app.recognisers.figurine_knn import FigurineClassifier
from app.recognisers.figurine_stub import FigurineClassifierStub
from app.recognisers.verify import CardVerifier
from app.recognisers.voting import BurstGate, FrameScore, VoteBuffer
from app.tts import speak

UNLOCK_AFTER_EMPTY_FRAMES = 10
PLATE_FRAMES = 12

from app.capture import CaptureWorker
from app.server import create_app


def figurine_lock(ident: Identification, winner: str) -> Identification | None:
    """The burst gate accepted `winner`: present it.

    The decision has already been made across ten frames, so this does not
    re-gate on the single frame in hand. Judging one frame is what used to
    throw away correct answers: under a new-room lighting shift the vote was
    right 100% of the time and the per-frame gate accepted only 80%.
    """
    if ident.explanation.get("best_answer") != winner:
        return None
    return Identification(
        kind="figurine", label=winner,
        dex_id=ident.explanation.get("best_dex_id"),
        confidence=max(0.0, min(1.0, ident.explanation.get("margin", 0.0) / 0.25)),
        explanation={**ident.explanation, "locked": True},
    )


def build_figurine_recogniser():
    """The real classifier when an index is present, the labelled stub
    otherwise, so the demo still runs on a machine without one."""
    try:
        classifier = FigurineClassifier()
    except (ImportError, OSError, ValueError) as exc:
        print(f"note: figurine index unavailable ({exc}) — using the stub")
        return FigurineClassifierStub()
    if not classifier.available:
        print("note: no figurine index — run scripts/build_figurine_index.py; using the stub")
        return FigurineClassifierStub()
    print(f"figurine index: {len(classifier.index.classes)} figurines "
          f"({len(classifier.index.embeddings)} reference frames)")
    return classifier


def main() -> int:
    ap = argparse.ArgumentParser(description="Pokédex kiosk")
    ap.add_argument("--camera", type=int, default=0, help="webcam index")
    ap.add_argument("--mode", choices=["card", "figurine"], default="card")
    ap.add_argument("--mute", action="store_true", help="print instead of speaking")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--dev-window", action="store_true",
                     help="run the cv2.imshow visual harness instead of the server")
    args = ap.parse_args()

    if args.dev_window:
        from app.dev_harness import run
        return run(args.camera, args.mode, args.mute)
    recognisers = {"card": CardMatcher(), "figurine": build_figurine_recogniser()}
    if not recognisers["card"].db:
        print("note: card DB missing — run scripts/build_card_db.py for real matching")
    dex = Dex()
    if not dex.source.species_ids():
        print("note: dex data missing — run scripts/fetch_dex_data.py for spoken entries")

    try:
        worker = CaptureWorker(args.camera, mode=args.mode, mute=args.mute,
                                on_quit=lambda: os._exit(0))
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1

    worker.start()
    app = create_app(worker)
    try:
        uvicorn.run(app, host=args.host, port=args.port)
    finally:
        worker.stop()
    # Pass card names so reprints of one card cannot become each other's
    # runner-up in the accept rule. Harmless on a single set, necessary the
    # moment the database holds more than one.
    verifier = CardVerifier(
        names={e["id"]: e["name"] for e in recognisers["card"].db}
    )
    votes = VoteBuffer()
    burst = BurstGate()
    locked: Identification | None = None
    empty_streak = 0

    mode = args.mode
    hard_streak = 0
    frame_no = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            print("error: camera read failed")
            break
        frame_no += 1

        # Spend the expensive search only on frames the cheap path has given up
        # on, and only occasionally. A sleeved card in a stand, or one with a
        # highlight across its edge, is exactly what this recovers.
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
        elif key == ord("m"):
            mode = "figurine" if mode == "card" else "card"
            votes.reset()
            burst.reset()
            locked = None
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
            speak(dex.line_for(shown), mute=args.mute)

    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
