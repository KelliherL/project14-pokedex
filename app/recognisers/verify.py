"""Geometric verification at lock-on: ORB keypoints + RANSAC homography
against the shortlisted reference cards.

The inlier count is both the accept gate and (later) the match-lines
display — the decision and the explanation are the same computation.
Accept rule calibrated on synthetic stress scenes 2026-08-07: correct
cards scored median 699 inliers (min 54 outside harsh glare) vs impostor
median ~20 (max 83); junk probes scored 0.
"""

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

IMG_DIR = Path(__file__).resolve().parents[2] / "data" / "cards" / "images"
MIN_INLIERS = 30   # floor for a real match
MIN_RATIO = 2.0    # best must double the runner-up
ORB_FEATURES = 1000
LOWE_RATIO = 0.75
RANSAC_PX = 5.0


@dataclass
class VerifyResult:
    available: bool                 # False = reference images not cached
    accepted: bool = False
    best_id: str | None = None
    inliers: int = 0
    second_inliers: int = 0
    per_candidate: dict[str, int] = field(default_factory=dict)


class CardVerifier:
    def __init__(self, img_dir: Path = IMG_DIR):
        self.img_dir = Path(img_dir)
        self._orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
        self._bf = cv2.BFMatcher(cv2.NORM_HAMMING)
        self._ref_cache: dict[str, tuple] = {}

    def _ref_features(self, card_id: str):
        if card_id not in self._ref_cache:
            feats = None
            for ext in (".webp", ".png"):
                p = self.img_dir / f"{card_id}{ext}"
                if p.exists():
                    img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
                    if img is not None:
                        feats = self._orb.detectAndCompute(img, None)
                    break
            self._ref_cache[card_id] = feats
        return self._ref_cache[card_id]

    def _inliers(self, qkp, qdes, card_id: str) -> int:
        ref = self._ref_features(card_id)
        if ref is None or qdes is None or ref[1] is None or len(qkp) < 4 or len(ref[0]) < 4:
            return 0
        good = [
            m
            for pair in self._bf.knnMatch(qdes, ref[1], k=2)
            if len(pair) == 2
            for m, n in [pair]
            if m.distance < LOWE_RATIO * n.distance
        ]
        if len(good) < 4:
            return 0
        src = np.float32([qkp[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([ref[0][m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_PX)
        return int(mask.sum()) if mask is not None else 0

    def verify(self, rectified_bgr: np.ndarray, candidate_ids: list[str]) -> VerifyResult:
        """Check the rectified crop against each shortlisted reference.
        Degrades gracefully when the local image cache is absent."""
        candidates = [c for c in candidate_ids if self._ref_features(c) is not None]
        if not candidates:
            return VerifyResult(available=False)
        gray = cv2.cvtColor(rectified_bgr, cv2.COLOR_BGR2GRAY)
        qkp, qdes = self._orb.detectAndCompute(gray, None)
        scores = {cid: self._inliers(qkp, qdes, cid) for cid in candidates}
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        best_id, inliers = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else 0
        accepted = inliers >= MIN_INLIERS and inliers >= MIN_RATIO * max(second, 1)
        return VerifyResult(
            available=True,
            accepted=accepted,
            best_id=best_id if accepted else None,
            inliers=inliers,
            second_inliers=second,
            per_candidate=scores,
        )
