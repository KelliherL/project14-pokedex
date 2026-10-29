"""Geometric verification at lock-on: SIFT keypoints + RANSAC homography
against the shortlisted reference cards.

The inlier count is both the accept gate and the match-lines display — the
decision and the explanation are the same computation.

**Why SIFT and not ORB.** The original implementation used ORB, calibrated on
synthetic stress scenes where correct cards scored a median of 699 inliers
against impostors at ~20. On real photographs that separation does not
survive: the median inlier count for the CORRECT card falls to 2. ORB's binary
descriptors degrade badly under the smooth intensity ramps that glare and card
gloss produce, and the synthetic harness supplied neither. Measured on 807
photographs of Base Set cards taken by strangers, swapping to SIFT takes
correct identification from 0.554 to 0.708.

**Why two views of each card.** Matching the whole card and matching only the
illustration fail in different places, and neither dominates:

    photo quality (hard -> easy)   whole card   illustration only
    hardest                             0.333               0.467
    cleanest                            0.960               0.800

On a clean photograph the text and borders are extra evidence; on a degraded
one they are illegible noise while the illustration survives. Scoring both and
letting the stronger one speak for each card reaches 0.803, against 0.853 if
an oracle always picked the right view. It also handles foreign-language
printings for free, since those share an illustration and differ in text.

Accept rule, calibrated on those photographs: at least MIN_INLIERS inliers and
at least MIN_RATIO times the best DIFFERENT card, giving 0.952 precision.
"Different card" rather than "next row" matters — see scoring.rank.
"""

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .card_matcher import OWN_DIR
from .scoring import rank

IMG_DIR = Path(__file__).resolve().parents[2] / "data" / "cards" / "images"

MIN_INLIERS = 40   # floor for a real match
MIN_RATIO = 1.5    # best must beat the next different card by this much
SIFT_FEATURES = 900
LOWE_RATIO = 0.78
RANSAC_PX = 6.0

# The illustration, as a fraction of the rectified card. Generous on purpose:
# layouts move between eras and a full-art card uses the whole face.
ART_WINDOW = (0.06, 0.10, 0.94, 0.58)


@dataclass
class VerifyResult:
    available: bool                 # False = reference images not cached
    accepted: bool = False
    best_id: str | None = None
    inliers: int = 0
    second_inliers: int = 0
    per_candidate: dict[str, int] = field(default_factory=dict)


def artwork(card: np.ndarray) -> np.ndarray:
    """Crop a rectified card to its illustration."""
    h, w = card.shape[:2]
    x0, y0, x1, y1 = ART_WINDOW
    return card[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]


class CardVerifier:
    def __init__(self, img_dir: Path = IMG_DIR, names: dict[str, str] | None = None):
        """`names` maps card id -> card name. Supplied, it stops reprints of one
        card becoming each other's runner-up; omitted, every id is its own
        answer, which is correct for a single-set database."""
        self.img_dir = Path(img_dir)
        self._sift = cv2.SIFT_create(nfeatures=SIFT_FEATURES)
        self._matcher = cv2.BFMatcher()
        self._names = names or {}
        self._ref_cache: dict[str, tuple | None] = {}

    def _ref_features(self, card_id: str):
        """SIFT features for the whole card and for its illustration."""
        if card_id not in self._ref_cache:
            feats = None
            paths = [d / f"{card_id}{ext}" for d in (self.img_dir, OWN_DIR)
                     for ext in (".webp", ".png")]
            p = next((p for p in paths if p.exists()), None)
            if p is not None:
                img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    feats = (self._sift.detectAndCompute(img, None),
                             self._sift.detectAndCompute(artwork(img), None))
            self._ref_cache[card_id] = feats
        return self._ref_cache[card_id]

    def _inliers(self, qkp, qdes, rkp, rdes) -> int:
        if qdes is None or rdes is None or len(qkp) < 8 or len(rkp) < 8:
            return 0
        good = [pair[0] for pair in self._matcher.knnMatch(qdes, rdes, k=2)
                if len(pair) == 2 and pair[0].distance < LOWE_RATIO * pair[1].distance]
        if len(good) < 8:
            return 0
        src = np.float32([qkp[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([rkp[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_PX)
        return int(mask.sum()) if mask is not None else 0

    def verify(self, rectified_bgr: np.ndarray, candidate_ids: list[str]) -> VerifyResult:
        """Check the rectified crop against each shortlisted reference.
        Degrades gracefully when the local image cache is absent."""
        candidates = [c for c in candidate_ids if self._ref_features(c) is not None]
        if not candidates:
            return VerifyResult(available=False)

        gray = cv2.cvtColor(rectified_bgr, cv2.COLOR_BGR2GRAY)
        query = (self._sift.detectAndCompute(gray, None),
                 self._sift.detectAndCompute(artwork(gray), None))

        # Best of the two views per card: whole-card and illustration-only fail
        # in different places, so the stronger one speaks for that card.
        scores: dict[str, int] = {}
        for cid in candidates:
            ref_whole, ref_art = self._ref_features(cid)
            scores[cid] = max(self._inliers(*query[0], *ref_whole),
                              self._inliers(*query[1], *ref_art))

        ranked = rank(scores, group_of=lambda cid: self._names.get(cid, cid))
        accepted = (ranked.best_score >= MIN_INLIERS
                    and ranked.best_score >= MIN_RATIO * max(ranked.runner_up_score, 1.0))
        return VerifyResult(
            available=True,
            accepted=accepted,
            best_id=str(ranked.best_key) if accepted else None,
            inliers=int(ranked.best_score),
            second_inliers=int(ranked.runner_up_score),
            per_candidate=scores,
        )
