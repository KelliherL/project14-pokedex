"""Headless end-to-end verification — no webcam needed, CI-able.

Composites known reference cards into synthetic scenes (dark noisy backdrop,
card scaled + rotated), runs the REAL card pipeline on them, and asserts the
matcher identifies the right card. Then exercises the dex lookup, the speech
line, and the figurine stub. Exit code 0 = all pass.
"""

import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.dex import Dex
from app.recognisers.card_matcher import CardMatcher
from app.recognisers.figurine_knn import (
    MIN_SIMILARITY,
    FigurineClassifier,
    FigurineIndex,
)
from app.recognisers.figurine_stub import FigurineClassifierStub
from app.recognisers.verify import CardVerifier

IMG_DIR = Path(__file__).resolve().parents[1] / "data" / "cards" / "images"


def synth_frame(card: Image.Image, angle: float, size=(1280, 720)) -> np.ndarray:
    """A webcam-ish scene: dark noisy backdrop, card pasted at an angle."""
    rng = np.random.default_rng(0)
    bg = rng.integers(28, 44, (size[1], size[0], 3), dtype=np.uint8)
    card_rgba = card.convert("RGBA").resize((330, 454))
    rotated = card_rgba.rotate(angle, expand=True, resample=Image.BICUBIC)
    scene = Image.fromarray(bg, "RGB")
    pos = ((size[0] - rotated.width) // 2, (size[1] - rotated.height) // 2)
    scene.paste(rotated, pos, rotated)
    return cv2.cvtColor(np.array(scene), cv2.COLOR_RGB2BGR)


def figurine_gates(dex: Dex) -> int:
    """Figurine lane gates.

    These run against the shipped index with the embedder stubbed out, so
    they need neither torch nor a weights download: feeding a reference
    embedding back in must return that figurine and clear the accept gate,
    and a far-away embedding must be refused. That covers the decision logic,
    which is the part that changes what a visitor sees.
    """
    index = FigurineIndex()
    if not index:
        print("SKIP: no figurine index — run scripts/build_figurine_index.py")
        return 0

    failures = 0
    frame = np.zeros((540, 960, 3), np.uint8)

    # every reference class must recognise its own reference frame
    wrong = []
    for label in index.classes:
        row = int(np.where(index.labels == label)[0][0])
        clf = FigurineClassifier(index=index,
                                 embedder=lambda imgs, r=row: index.embeddings[r : r + 1].copy())
        ident = clf.identify(frame)
        if ident.explanation["best_label"] != label or ident.label is None:
            wrong.append(label)
    ok = not wrong
    print(f"{'PASS' if ok else 'FAIL'}: figurine index self-recognition "
          f"({len(index.classes)} figurines, {len(index.embeddings)} references)"
          + ("" if ok else f" — failed {wrong}"))
    failures += 0 if ok else 1

    # every figurine the index can name must have a dex entry to speak
    missing = sorted({ref.dex_id for ref in index.meta.values()}
                     - set(dex.source.species_ids()))
    okd = not missing
    print(f"{'PASS' if okd else 'FAIL'}: every figurine has a dex entry"
          + ("" if okd else f" — missing {missing}; re-run scripts/fetch_dex_data.py"))
    failures += 0 if okd else 1

    # Out-of-domain input must be refused by the similarity floor. A random
    # vector is NOT far from the index - 240 unit vectors in 384 dimensions
    # are heavily correlated, and a naive projection scored 0.896. Take the
    # orthogonal complement of the reference span properly, via SVD.
    rng = np.random.default_rng(0)
    q = rng.standard_normal(index.embeddings.shape[1]).astype(np.float32)
    _, sv, vt = np.linalg.svd(index.embeddings, full_matrices=False)
    basis = vt[sv > 1e-5]
    q -= basis.T @ (basis @ q)
    q /= np.linalg.norm(q)
    oo = FigurineClassifier(index=index,
                            embedder=lambda imgs: q[None, :].copy()).identify(frame)
    oko = oo.label is None and oo.explanation["best_similarity"] < MIN_SIMILARITY
    print(f"{'PASS' if oko else 'FAIL'}: out-of-domain query refused "
          f"(similarity {oo.explanation['best_similarity']:.3f}, floor {MIN_SIMILARITY})")
    failures += 0 if oko else 1

    # An ambiguous view - halfway between two figurines that give different
    # answers - must be refused rather than guessed. This is the unsure state
    # the UI treats as a first-class screen.
    answers = {index.answer_for(lbl): lbl for lbl in index.classes}
    if len(answers) >= 2:
        (_, a), (_, b) = list(answers.items())[:2]
        ia = int(np.where(index.labels == a)[0][0])
        ib = int(np.where(index.labels == b)[0][0])
        mid = index.embeddings[ia] + index.embeddings[ib]
        mid = (mid / np.linalg.norm(mid)).astype(np.float32)
        amb = FigurineClassifier(index=index,
                                 embedder=lambda imgs: mid[None, :].copy()).identify(frame)
        oka = amb.label is None
        print(f"{'PASS' if oka else 'FAIL'}: ambiguous view between {a} and {b} refused "
              f"(margin {amb.explanation['margin']:.3f})")
        failures += 0 if oka else 1

    return failures


def main() -> int:
    matcher = CardMatcher()
    if not matcher.db:
        print("FAIL: card DB missing — run scripts/build_card_db.py first")
        return 1
    images = sorted(p for p in IMG_DIR.iterdir() if p.suffix in {".png", ".webp"})
    if len(images) < 3:
        print("FAIL: reference images missing — run scripts/build_card_db.py first")
        return 1

    dex = Dex()
    picks = random.Random(42).sample(images, 5)
    angles = [0, 8, -12, 15, -6]
    failures = 0

    for path, angle in zip(picks, angles):
        ident = matcher.identify(synth_frame(Image.open(path), angle))
        expected = path.stem
        got = ident.explanation.get("best_card")
        ok = got == expected and ident.label is not None
        status = "PASS" if ok else "FAIL"
        print(
            f"{status}: {expected} @ {angle:+}deg -> {ident.label!r} "
            f"(best={got}, sigma={ident.explanation.get('sigma')})"
        )
        if ok:
            print(f"      speak: {dex.line_for(ident)}")
        else:
            failures += 1

    # 90° presentation — aspect-aware rectify must recover it
    path90 = picks[0]
    ident90 = matcher.identify(synth_frame(Image.open(path90), 90))
    ok90 = ident90.explanation.get("best_card") == path90.stem and ident90.label is not None
    print(f"{'PASS' if ok90 else 'FAIL'}: {path90.stem} @ 90deg -> {ident90.label!r}")
    failures += 0 if ok90 else 1

    # verify stage — correct card accepted with clear inliers
    verifier = CardVerifier()
    identv = matcher.identify(synth_frame(Image.open(picks[1]), 5))
    res = verifier.verify(
        identv.explanation["rectified"],
        [s["id"] for s in identv.explanation["shortlist"]],
    )
    okv = res.available and res.accepted and res.best_id == picks[1].stem
    print(
        f"{'PASS' if okv else 'FAIL'}: verify {picks[1].stem} -> "
        f"{res.best_id!r} ({res.inliers} inliers vs {res.second_inliers})"
    )
    failures += 0 if okv else 1

    # verify stage — featureless junk must be rejected
    junk = matcher.identify(synth_frame(Image.new("RGB", (245, 337), (235, 235, 235)), 0))
    if junk.kind == "card" and "shortlist" in junk.explanation:
        resj = verifier.verify(
            junk.explanation["rectified"],
            [s["id"] for s in junk.explanation["shortlist"]],
        )
        okj = not resj.accepted
        print(f"{'PASS' if okj else 'FAIL'}: junk card rejected by verify (inliers={resj.inliers})")
        failures += 0 if okj else 1

    stub = FigurineClassifierStub().identify(np.zeros((720, 1280, 3), np.uint8))
    print(f"PASS: figurine stub -> {stub.label} (is_stub={stub.is_stub})")
    print(f"      speak: {dex.line_for(stub)}")

    failures += figurine_gates(dex)

    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
