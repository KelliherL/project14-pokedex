"""Pokédex kiosk — COMPX374 Project 14 walking skeleton.

The OpenCV window here is the DEV HARNESS, not the event UI: it exists so the
recognition pipeline can be exercised end to end while the real front-end is
designed. Everything a UI needs arrives as an Identification — that boundary
is documented in docs/INTERFACES.md.

Run:  python -m app.main             (from the repo root, venv active)
Keys: space = identify + speak · m = switch card/figurine · q = quit

See README.md for what is real vs stubbed.
"""

import argparse
import sys

import cv2

from app import overlay
from app.dex import Dex
from app.recognisers.card_matcher import CardMatcher
from app.recognisers.figurine_stub import FigurineClassifierStub
from app.tts import speak


def main() -> int:
    ap = argparse.ArgumentParser(description="Pokédex kiosk stub")
    ap.add_argument("--camera", type=int, default=0, help="webcam index")
    ap.add_argument("--mode", choices=["card", "figurine"], default="card")
    ap.add_argument("--mute", action="store_true", help="print instead of speaking")
    args = ap.parse_args()

    recognisers = {"card": CardMatcher(), "figurine": FigurineClassifierStub()}
    if not recognisers["card"].db:
        print("note: card DB missing — run scripts/build_card_db.py for real matching")
    dex = Dex()
    if not dex.source.species_ids():
        print("note: dex data missing — run scripts/fetch_dex_data.py for spoken entries")

    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(args.camera, backend)
    if not cap.isOpened():
        print(f"error: cannot open camera {args.camera} (try --camera 1)")
        return 1

    mode = args.mode
    while True:
        ok, frame = cap.read()
        if not ok:
            print("error: camera read failed")
            break
        ident = recognisers[mode].identify(frame)
        frame = overlay.draw(frame, ident, mode)
        cv2.imshow("Pokedex dev harness — COMPX374 P14", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("m"):
            mode = "figurine" if mode == "card" else "card"
        elif key == ord(" "):
            speak(dex.line_for(ident), mute=args.mute)

    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
