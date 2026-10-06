"""Build the figurine reference index from turntable captures.

This is what "training the figurine model" amounts to: embed reference frames
of each figurine once with a frozen backbone and store them. There is no
training step, no checkpoint, and no labels to curate beyond naming the
folder. Adding a figurine to the exhibit means adding it to
data/figurines/sources.json and re-running this.

Two input shapes, both reproducible from what is in the repo:

  video  — a turntable clip per figurine (Models/*.mov). The camera is static
           and only the figurine moves, so a per-pixel temporal median of the
           clip is a background plate; subtracting it isolates the figurine
           and gives a tight crop for free.
  images — a folder of photos per figurine, for anyone adding one without
           filming a clip. Centre-cropped, since there is no plate to build.

Writes data/figurines/index.npz (embeddings), labels.json (display name and
dex id per reference class) and exemplars/ (small thumbnails, so the UI can
show the actual reference frames a decision was made from).

  python scripts/build_figurine_index.py
  python scripts/build_figurine_index.py --refs 24
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.recognisers.figurine_knn import (
    Dinov2Embedder,
    background_plate,
    centre_crop,
    foreground_bbox,
    square_crop,
)

OUT_DIR = ROOT / "data" / "figurines"
SOURCES = OUT_DIR / "sources.json"
EXEMPLAR_DIR = OUT_DIR / "exemplars"
EXEMPLAR_PX = 128
SAMPLE_FPS = 5.0
DEFAULT_REFS = 24   # 10-20 measured as sufficient on a controlled stand


def decode(path: Path, fps: float, width: int = 960) -> list[np.ndarray]:
    """Decode a clip to BGR frames via ffmpeg."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    w0, h0 = int(probe[0]), int(probe[1])
    height = round(h0 * width / w0 / 2) * 2
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={fps},scale={width}:{height}",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True, check=True,
    ).stdout
    n = len(raw) // (width * height * 3)
    arr = np.frombuffer(raw[: n * width * height * 3], np.uint8).reshape(n, height, width, 3)
    return [a.copy() for a in arr]


def crops_from_video(path: Path) -> list[np.ndarray]:
    frames = decode(path, SAMPLE_FPS)
    if not frames:
        return []
    plate = background_plate(frames)
    out = []
    for f in frames:
        box = foreground_bbox(f, plate)
        if box is not None:
            out.append(square_crop(f, box))
    return out


def crops_from_images(folder: Path) -> list[np.ndarray]:
    out = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        img = cv2.imread(str(p))
        if img is not None:
            out.append(centre_crop(img))
    return out


def evenly(items: list, n: int) -> list:
    """Even spread, so references cover the whole rotation rather than an arc."""
    if len(items) <= n:
        return items
    return [items[int(i)] for i in np.linspace(0, len(items) - 1, n)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Build the figurine reference index")
    ap.add_argument("--refs", type=int, default=DEFAULT_REFS,
                    help=f"reference frames per figurine (default {DEFAULT_REFS})")
    args = ap.parse_args()

    if not SOURCES.exists():
        print(f"error: {SOURCES.relative_to(ROOT)} not found")
        return 1
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))["figurines"]

    EXEMPLAR_DIR.mkdir(parents=True, exist_ok=True)
    embedder = Dinov2Embedder()

    all_crops, all_labels, all_exemplars = [], [], []
    labels_out = {}

    for entry in sources:
        label = entry["label"]
        src = ROOT / entry["source"]
        if not src.exists():
            print(f"  {label:<14} SKIP — {entry['source']} not found")
            continue
        crops = crops_from_video(src) if src.is_file() else crops_from_images(src)
        if not crops:
            print(f"  {label:<14} SKIP — no usable frames")
            continue
        crops = evenly(crops, args.refs)

        paths = []
        for i, c in enumerate(crops):
            rel = f"exemplars/{label}_{i:02d}.jpg"
            thumb = cv2.resize(c, (EXEMPLAR_PX, EXEMPLAR_PX), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(OUT_DIR / rel), thumb, [cv2.IMWRITE_JPEG_QUALITY, 85])
            paths.append(rel)

        all_crops.extend(crops)
        all_labels.extend([label] * len(crops))
        all_exemplars.extend(paths)
        labels_out[label] = {
            "display": entry["display"], "dex_id": entry["dex_id"],
            "exemplar": paths[0], "references": len(crops), "source": entry["source"],
        }
        print(f"  {label:<14} {len(crops)} references from {entry['source']}")

    if not all_crops:
        print("error: nothing to index")
        return 1

    print(f"\nembedding {len(all_crops)} reference frames ...")
    embs = np.zeros((len(all_crops), 384), dtype=np.float32)
    for s in range(0, len(all_crops), 16):
        embs[s : s + 16] = embedder(all_crops[s : s + 16])
        print(f"  {min(s + 16, len(all_crops))}/{len(all_crops)}")

    np.savez_compressed(
        OUT_DIR / "index.npz",
        embs=embs,
        labels=np.array(all_labels),
        exemplars=np.array(all_exemplars),
    )
    (OUT_DIR / "labels.json").write_text(json.dumps(labels_out, indent=1), encoding="utf-8")

    size = (OUT_DIR / "index.npz").stat().st_size / 1024
    print(f"\nwrote index.npz ({embs.shape}, {size:.0f} KB) and labels.json "
          f"for {len(labels_out)} figurines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
