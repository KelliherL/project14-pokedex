"""Background capture thread: owns the camera, runs the identify -> vote ->
lock pipeline every frame, and publishes a snapshot that FastAPI route
handlers (app/server.py) read without ever touching `cv2.VideoCapture`
themselves.

The identify/vote/lock logic is the same pipeline that used to live inline
in app/main.py's loop; `lock_from` is moved here verbatim.
"""

import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import cv2

from app import ws_adapter
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

STREAM_JPEG_QUALITY = 80


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


@dataclass
class FrameSnapshot:
    """One frame's stream image and detection message, swapped in together so
    a reader can never observe one frame's image next to another frame's
    detection JSON."""

    frame_no: int
    jpeg_bytes: bytes
    width: int
    height: int
    ws_message: dict


class CaptureWorker:
    """Owns the camera and the recognition pipeline on one background thread.

    Routes only ever read `self.latest` / `self.last_crop()` — they never
    touch `cv2.VideoCapture`, which is not meant to be called concurrently.
    """

    def __init__(self, camera: int, mode: str = "card", mute: bool = False,
                 on_quit: Callable[[], None] | None = None):
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
        self.cap = cv2.VideoCapture(camera, backend)
        if not self.cap.isOpened():
            raise RuntimeError(f"cannot open camera {camera} (try --camera 1)")

        self.recognisers = {"card": CardMatcher(), "figurine": FigurineClassifierStub()}
        if not self.recognisers["card"].db:
            print("note: card DB missing — run scripts/build_card_db.py for real matching")
        self.dex = Dex()
        if not self.dex.source.species_ids():
            print("note: dex data missing — run scripts/fetch_dex_data.py for spoken entries")

        # Pass card names so reprints of one card cannot become each other's
        # runner-up in the accept rule.
        self.verifier = CardVerifier(names={e["id"]: e["name"] for e in self.recognisers["card"].db})

        self.mode = mode
        self.mute = mute
        self._on_quit = on_quit
        self._votes = VoteBuffer()
        self._locked: Identification | None = None
        self._live: Identification | None = None
        self._empty_streak = 0
        self._hard_streak = 0
        self._frame_no = 0

        self._lock = threading.Lock()
        self._snapshot: FrameSnapshot | None = None
        self._last_locked_crop_jpeg: bytes | None = None
        self._last_locked_dex_id: int | None = None

        self.stop_event = threading.Event()
        self._capture_thread = threading.Thread(target=self._run, daemon=True)
        self._key_thread = threading.Thread(target=self._listen_keys, daemon=True)

    def start(self) -> None:
        self._capture_thread.start()
        self._key_thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self._capture_thread.join(timeout=2)
        self.cap.release()

    @property
    def latest(self) -> FrameSnapshot | None:
        with self._lock:
            return self._snapshot

    def last_crop(self) -> tuple[bytes | None, int | None]:
        """The most recently LOCKED crop + its dexId, surviving unlock."""
        with self._lock:
            return self._last_locked_crop_jpeg, self._last_locked_dex_id

    def _run(self) -> None:
        while not self.stop_event.is_set():
            ok, frame = self.cap.read()
            if not ok:
                print("error: camera read failed")
                break
            self._frame_no += 1

            live = self._identify(frame)
            self._live = live
            self._update_lock_state(live)

            height, width = frame.shape[:2]
            ok_jpeg, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_QUALITY])
            message = ws_adapter.build_detection_message(
                self._frame_no, width, height, self.mode, live, self._locked
            )
            snapshot = FrameSnapshot(
                self._frame_no, buf.tobytes() if ok_jpeg else b"", width, height, message
            )
            with self._lock:
                self._snapshot = snapshot

    def _identify(self, frame) -> Identification:
        if self.mode != "card":
            return self.recognisers[self.mode].identify(frame)
        use_fallback = (self._hard_streak >= FALLBACK_AFTER_FRAMES
                        and self._frame_no % FALLBACK_EVERY == 0)
        ident = self.recognisers["card"].identify(frame, allow_fallback=use_fallback)
        self._hard_streak = 0 if ident.explanation.get("best_card") else self._hard_streak + 1
        return ident

    def _update_lock_state(self, live: Identification) -> None:
        if self.mode != "card" or not self.recognisers["card"].db:
            return
        if live.kind == "none":
            self._empty_streak += 1
            if self._empty_streak >= UNLOCK_AFTER_EMPTY_FRAMES:
                self._votes.reset()
                self._locked = None
            return

        self._empty_streak = 0
        if self._locked is not None:
            return

        winner = self._votes.add(live.explanation.get("best_card"))
        if not winner:
            return
        locked = lock_from(live, self.recognisers["card"], self.verifier, winner)
        if locked is None:
            self._votes.reset()  # verify abstained; keep watching
            return

        self._locked = locked
        crop = locked.explanation.get("rectified")
        if crop is not None:
            ok_jpeg, buf = cv2.imencode(".jpg", crop)
            with self._lock:
                self._last_locked_crop_jpeg = buf.tobytes() if ok_jpeg else None
                self._last_locked_dex_id = locked.dex_id

    def switch_mode(self) -> None:
        self.mode = "figurine" if self.mode == "card" else "card"
        self._votes.reset()
        self._locked = None
        self._hard_streak = 0
        print(f"[capture] mode -> {self.mode}")

    def speak_current(self) -> None:
        shown = self._locked if (self.mode == "card" and self._locked is not None) else self._live
        speak(self.dex.line_for(shown), mute=self.mute)

    def _listen_keys(self) -> None:
        """Headless console key listener so m/space/q keep working with no
        cv2 window open. Windows-only (msvcrt); --dev-window is the fallback
        for keyboard control on other platforms."""
        if sys.platform != "win32":
            print("note: headless key listener needs Windows (msvcrt); "
                  "use --dev-window for keyboard control on this platform")
            return
        import msvcrt

        print("[capture] keys: space = identify+speak · m = switch card/figurine · q = quit")
        while not self.stop_event.is_set():
            if msvcrt.kbhit():
                key = msvcrt.getch()
                if key == b" ":
                    self.speak_current()
                elif key in (b"m", b"M"):
                    self.switch_mode()
                elif key in (b"q", b"Q"):
                    self.stop_event.set()
                    if self._on_quit is not None:
                        self._on_quit()
                    break
            time.sleep(0.05)
