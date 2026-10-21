"""List the cameras the OS exposes, numbered by the index `--camera` expects.

Used by run/backend_launch.bat to show a camera menu. On Windows the backend opens
cameras through DirectShow (cv2.CAP_DSHOW), so the names come from the same
DirectShow enumeration (via pygrabber) and the printed index is exactly the
one cv2 will open. Without pygrabber (or off Windows) it falls back to probing
indices with cv2, which finds cameras but cannot name them.

Exit code = number of cameras found (capped at 10, the launcher's 0-9 keys),
so the batch file can read the count from %errorlevel%.

Run:    python scripts/list_cameras.py
"""

import os
import sys

MAX_CAMERAS = 10


def directshow_names() -> list[str] | None:
    if sys.platform != "win32":
        return None
    try:
        from pygrabber.dshow_graph import FilterGraph
    except ImportError:
        return None
    try:
        return FilterGraph().get_input_devices()
    # COM failures shouldn't kill the launcher; comtypes raises its own error types
    except Exception:  # noqa: BLE001
        return None


def probe_indices() -> list[str]:
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")  # silence failed-open spam
    import cv2

    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    found = []
    for index in range(MAX_CAMERAS):
        cap = cv2.VideoCapture(index, backend)
        if not cap.isOpened():
            break
        found.append(f"Camera {index} (name unavailable - install pygrabber)")
        cap.release()
    return found


def main() -> int:
    names = directshow_names()
    if names is None:
        names = probe_indices()
    names = names[:MAX_CAMERAS]

    if not names:
        print("  (no cameras found)")
    for index, name in enumerate(names):
        print(f"  {index}) {name}")
    return len(names)


if __name__ == "__main__":
    sys.exit(main())
