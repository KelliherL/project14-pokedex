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

    print(f"\n{'ALL PASS' if failures == 0 else f'{failures} FAILURE(S)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
