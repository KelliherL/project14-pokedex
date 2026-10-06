"""Figurine recognition: frozen DINOv2 embeddings + cosine nearest neighbour
against reference photos of the actual event figurines.

Nothing is trained. The "model" is a reference index: embed turntable frames
of each figurine once, L2-normalise, and let cosine similarity classify.
Adding a figurine is dropping its photos in a folder and re-running
scripts/build_figurine_index.py — no retraining, no labels to curate, and the
distances themselves are the explanation the UI shows.

Two decisions here were measured, not assumed (spike b-figurines,
2026-09-15, on nine 3D-printed figurines shot on a turntable):

* **The accept gate is relative, not absolute.** An absolute cosine
  threshold calibrated in one room does not survive a different one. Under a
  brightness shift the engine still ranked the right figurine first 95% of
  the time while an absolute threshold accepted only 18% of those answers;
  under a 15 degree rotation it ranked correctly 94% of the time and the
  absolute threshold accepted *none* of it. The margin between the best
  match and the best differently-labelled match survived both (84% and 74%),
  because both similarities move together when the whole image changes. A
  loose absolute floor is kept only to reject input that is not a figurine
  at all — card photos score 0.27 against known matches at 0.87.

* **Recognition is per-object, not per-species.** An unseen print of a known
  species does not match it (measured across two different Jolteon prints:
  6% and 42%). So the index recognises the exact figurines it has been shown.
  Two prints of the same species are two reference classes sharing a dex id.

The margin is measured against the best match that gives a DIFFERENT ANSWER,
not merely a different reference class. Two prints of the same Pokemon are
different classes but the same answer, so letting them compete would make the
gate refuse a figurine for looking too much like itself. Observed before the
fix: a Jolteon frame scored 0.97 similarity and was refused on a margin of
0.021, because the other Jolteon print was the runner-up.

The heavy dependency is imported lazily: the app still starts, and the card
lane still runs, on a machine with no torch and no index.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .base import Identification

INDEX_PATH = Path(__file__).resolve().parents[2] / "data" / "figurines" / "index.npz"
LABELS_PATH = Path(__file__).resolve().parents[2] / "data" / "figurines" / "labels.json"

# Accept rule, recalibrated 2026-09-17 against a burst rather than a frame,
# and against 1896 photographs of figurines the index has never seen.
#
# The margin requirement is deliberately almost nothing. It began at 0.05, the
# 5th percentile of the clean margin distribution, and that turned out to
# refuse answers the system had got right: a margin is a DIFFERENCE of
# similarities, so a global lighting change shrinks both sides together and
# the difference falls while the decision gets no harder. Median margin runs
# 0.120 clean against 0.075 under a combined new-room shift.
#
# The work is done instead by a LOOSE absolute similarity floor. That is not a
# contradiction of the finding that absolute thresholds are brittle: a TIGHT
# floor at 0.873 rejected every correct answer under a 15 degree rotation,
# while 0.70 sits far below any genuine match and far above the 0.52 that
# other people's figurines average. Both folds of a held-out check chose 0.70
# independently.
#
# Paired with BurstGate (voting.py): 84.2% -> 95.4% correct-and-accepted,
# 11.1% -> 0.7% of other people's figurines wrongly accepted.
MIN_MARGIN = 0.01
MIN_SIMILARITY = 0.70
ACCEPT_CRITERION = (
    f"match iff best-vs-next-different-answer margin >= {MIN_MARGIN} "
    f"and similarity >= {MIN_SIMILARITY}"
)

# Background-subtraction crop. The kiosk captures a plate of the empty stand
# at startup; without one we fall back to a centre crop.
DIFF_THRESH = 34
MIN_AREA_FRAC = 0.002
CROP_MARGIN = 0.16
CROP_SIZE = 336
EMBED_DIM = 384


# ---------- cropping (shared with the index builder) ----------

def background_plate(frames: list[np.ndarray]) -> np.ndarray:
    """Per-pixel temporal median of a static scene.

    Per-pixel, not a single median colour: a global median marks every pixel
    unlike the average as foreground, which on a light turntable means the
    turntable itself (measured: 40% of frame, versus 5-25% done properly).
    """
    return np.median(np.stack(frames).astype(np.float32), axis=0)


def foreground_bbox(frame: np.ndarray, plate: np.ndarray) -> tuple[int, int, int, int] | None:
    """Largest region differing from the plate, as (x, y, w, h)."""
    diff = np.linalg.norm(frame.astype(np.float32) - plate, axis=2)
    mask = (diff > DIFF_THRESH).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count < 2:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, area = stats[i]
    if area < MIN_AREA_FRAC * frame.shape[0] * frame.shape[1]:
        return None
    return int(x), int(y), int(w), int(h)


def square_crop(frame: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """Pad a bbox to a square with margin, clamp to the frame, resize."""
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    side = max(w, h) * (1 + 2 * CROP_MARGIN)
    frame_h, frame_w = frame.shape[:2]
    side = min(side, frame_w, frame_h)
    x0 = int(max(0, min(cx - side / 2, frame_w - side)))
    y0 = int(max(0, min(cy - side / 2, frame_h - side)))
    side = int(min(side, frame_w - x0, frame_h - y0))
    crop = frame[y0 : y0 + side, x0 : x0 + side]
    return cv2.resize(crop, (CROP_SIZE, CROP_SIZE), interpolation=cv2.INTER_AREA)


def centre_crop(frame: np.ndarray) -> np.ndarray:
    h, w = frame.shape[:2]
    side = min(h, w)
    y0, x0 = (h - side) // 2, (w - side) // 2
    return cv2.resize(frame[y0 : y0 + side, x0 : x0 + side], (CROP_SIZE, CROP_SIZE),
                      interpolation=cv2.INTER_AREA)


def crop_for_embedding(frame: np.ndarray, plate: np.ndarray | None):
    """Returns (crop, bbox or None). bbox None means the centre-crop fallback."""
    if plate is not None and plate.shape == frame.shape:
        box = foreground_bbox(frame, plate)
        if box is not None:
            return square_crop(frame, box), box
    return centre_crop(frame), None


# ---------- embedding ----------

class Dinov2Embedder:
    """Frozen DINOv2 ViT-S/14 with registers. torch is imported on first use
    so the rest of the app runs without it."""

    def __init__(self) -> None:
        self._model = None
        self._torch = None

    def _load(self):
        if self._model is None:
            import torch

            self._torch = torch
            self._model = torch.hub.load(
                "facebookresearch/dinov2", "dinov2_vits14_reg", verbose=False
            ).eval()
        return self._torch, self._model

    def __call__(self, images: list[np.ndarray]) -> np.ndarray:
        """BGR images in, L2-normalised (N, 384) embeddings out."""
        torch, model = self._load()
        mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
        batch = []
        for img in images:
            rgb = cv2.cvtColor(cv2.resize(img, (224, 224), interpolation=cv2.INTER_AREA),
                               cv2.COLOR_BGR2RGB)
            t = torch.from_numpy(np.ascontiguousarray(rgb)).permute(2, 0, 1).float() / 255.0
            batch.append((t - mean) / std)
        with torch.inference_mode():
            feats = model(torch.stack(batch))
            return torch.nn.functional.normalize(feats, dim=1).numpy().astype(np.float32)


# ---------- the index ----------

@dataclass(frozen=True)
class FigurineRef:
    label: str        # reference class, e.g. "Jolteon-A"
    display: str      # what the visitor is told, e.g. "Jolteon"
    dex_id: int
    exemplar: str     # relative path to a thumbnail, for the exemplar strip


class FigurineIndex:
    """Reference embeddings plus the label metadata that goes with them."""

    def __init__(self, index_path: Path = INDEX_PATH, labels_path: Path = LABELS_PATH):
        self.embeddings = np.zeros((0, EMBED_DIM), dtype=np.float32)
        self.labels = np.array([], dtype=object)
        self.exemplars = np.array([], dtype=object)
        self.answers = np.array([], dtype=object)
        self.meta: dict[str, FigurineRef] = {}
        index_path, labels_path = Path(index_path), Path(labels_path)
        if not (index_path.exists() and labels_path.exists()):
            return
        data = np.load(index_path, allow_pickle=True)
        self.embeddings = data["embs"].astype(np.float32)
        self.labels = data["labels"]
        self.exemplars = data["exemplars"]
        for label, entry in json.loads(labels_path.read_text(encoding="utf-8")).items():
            self.meta[label] = FigurineRef(
                label=label, display=entry["display"], dex_id=entry["dex_id"],
                exemplar=entry.get("exemplar", ""),
            )
        self.answers = np.array([self.answer_for(label) for label in self.labels], dtype=object)

    def answer_for(self, label: str) -> str:
        """What the visitor is actually told. Reference classes that resolve to
        the same species are the same answer, so they never compete."""
        ref = self.meta.get(str(label))
        return f"dex:{ref.dex_id}" if ref else str(label)

    def __bool__(self) -> bool:
        return len(self.embeddings) > 0

    @property
    def classes(self) -> list[str]:
        return sorted(set(self.labels.tolist()))


# ---------- the recogniser ----------

class FigurineClassifier:
    """Closed-set figurine recogniser over the shipped reference index."""

    def __init__(self, index: FigurineIndex | None = None, embedder=None):
        self.index = index if index is not None else FigurineIndex()
        self._embedder = embedder if embedder is not None else Dinov2Embedder()
        self.plate: np.ndarray | None = None

    @property
    def available(self) -> bool:
        return bool(self.index)

    def set_background(self, frames: list[np.ndarray]) -> None:
        """Operator step: capture the empty stand so the crop can isolate the
        figurine. Without it the classifier falls back to a centre crop."""
        self.plate = background_plate(frames) if frames else None

    def identify(self, frame: np.ndarray) -> Identification:
        if not self.index:
            return Identification(
                kind="figurine", is_stub=True,
                explanation={"reason": "no figurine index — run scripts/build_figurine_index.py"},
            )

        crop, bbox = crop_for_embedding(frame, self.plate)
        query = self._embedder([crop])[0]
        sims = self.index.embeddings @ query

        best = int(np.argmax(sims))
        best_label = str(self.index.labels[best])
        best_sim = float(sims[best])

        best_answer = self.index.answer_for(best_label)
        different = sims[self.index.answers != best_answer]
        runner_up = float(different.max()) if different.size else -1.0
        margin = best_sim - runner_up

        accepted = margin >= MIN_MARGIN and best_sim >= MIN_SIMILARITY
        ref = self.index.meta.get(best_label)

        # Per-class best similarity, which is what the confidence bars show.
        per_class = {}
        for label in self.index.classes:
            per_class[label] = float(sims[self.index.labels == label].max())
        top5 = sorted(per_class.items(), key=lambda kv: kv[1], reverse=True)[:5]
        # Same {name, confidence} shape as CardMatcher/FigurineClassifierStub's
        # top5, so the frontend renders "what it could be" identically
        # regardless of which recogniser ran.
        top5_display = [
            {"name": self.index.meta[label].display if label in self.index.meta else label,
             "confidence": round(s, 4)}
            for label, s in top5
        ]

        # Exemplars: the actual nearest reference frames, which is the honest
        # version of "why" — these are the images the decision was made from.
        order = np.argsort(-sims)[:3]
        exemplars = [
            {"label": str(self.index.labels[i]),
             "image": str(self.index.exemplars[i]),
             "similarity": round(float(sims[i]), 4)}
            for i in order
        ]

        return Identification(
            kind="figurine",
            label=(ref.display if ref else best_label) if accepted else None,
            dex_id=ref.dex_id if (accepted and ref) else None,
            confidence=max(0.0, min(1.0, margin / 0.25)) if accepted else 0.0,
            is_stub=False,
            explanation={
                "top5": top5_display,
                "exemplars": exemplars,
                "best_label": best_label,
                # What the visitor would be told, and its dex id, regardless of
                # whether this single frame cleared the gate. The burst gate
                # votes on these: two prints of one species are one answer.
                "best_answer": ref.display if ref else best_label,
                "best_dex_id": ref.dex_id if ref else None,
                "best_similarity": round(best_sim, 4),
                "runner_up_similarity": round(runner_up, 4),
                "margin": round(margin, 4),
                "criterion": ACCEPT_CRITERION,
                "crop": crop,
                "bbox": list(bbox) if bbox else None,
                "cropped_by": "background plate" if bbox else "centre crop (no plate captured)",
            },
        )
