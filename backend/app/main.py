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
Server console keys: space = identify + speak · m = switch card/figurine ·
                      b = capture the empty-stand background plate (figurine mode) ·
                      c = clear console · r = restart (exit code 3, back to the
                      launcher menu) · q = quit · x = force shutdown (exit code 9)

See README.md for what is real vs stubbed.
"""

import argparse
import os
import sys

import uvicorn

from app.capture import CaptureWorker
from app.server import create_app


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

    def exit_process(code: int) -> None:
        # Called from the key-listener thread: release the camera before the
        # launcher reopens it, then skip uvicorn's graceful shutdown.
        worker.stop()
        os._exit(code)

    try:
        worker = CaptureWorker(args.camera, mode=args.mode, mute=args.mute,
                                on_exit=exit_process)
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1

    worker.start()
    app = create_app(worker)
    try:
        uvicorn.run(app, host=args.host, port=args.port)
    finally:
        worker.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
