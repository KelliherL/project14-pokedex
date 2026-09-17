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
from app.recognisers.base import Identification
from app.recognisers.card_matcher import CardMatcher
from app.recognisers.figurine_stub import FigurineClassifierStub
from app.recognisers.verify import CardVerifier
from app.recognisers.voting import VoteBuffer
from app.tts import speak

UNLOCK_AFTER_EMPTY_FRAMES = 10

# The candidate-crop search costs ~99 ms against a few ms for the normal path,
# so it runs only once the normal path has been failing for a while, and then
# no more often than every FALLBACK_EVERY frames. At 15 fps that is roughly
# "after a second of getting nowhere, spend one frame looking harder".
FALLBACK_AFTER_FRAMES = 12
FALLBACK_EVERY = 8


def lock_from(ident: Identification, matcher: CardMatcher, verifier: CardVerifier,
              winner: str) -> Identification | None:
    """Vote converged on `winner`: geometrically verify it against the
    frame's shortlist. Returns the locked Identification, or None (abstain)."""
    shortlist = [s["id"] for s in ident.explanation.get("shortlist", [])]
    if winner not in shortlist:
        shortlist.insert(0, winner)
    result = verifier.verify(ident.explanation["rectified"], shortlist)
    if result.available and not (result.accepted and result.best_id == winner):
        return None
    entry = next((e for e in matcher.db if e["id"] == winner), None)
    if entry is None:
        return None
    explanation = {
        **ident.explanation,
        "locked": True,
        "verified": result.available,
        "verified_inliers": result.inliers,
        "verified_second": result.second_inliers,
    }
    if not result.available:
        explanation["verify_note"] = "verify skipped — reference images not cached"
    return Identification(
        kind="card",
        label=entry["name"],
        dex_id=(entry.get("dex_ids") or [None])[0],
        confidence=max(0.0, 1.0 - ident.explanation["best_distance"] / 32.0),
        explanation=explanation,
    )


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

    verifier = CardVerifier()
    votes = VoteBuffer()
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
            speak(dex.line_for(shown), mute=args.mute)

    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    sys.exit(main())
