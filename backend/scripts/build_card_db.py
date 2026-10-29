"""Build the card hash DB from locally cached files (no network).

Run bash scripts/download_card_set.sh first — it caches card JSON into
data/cards/meta/ and images into data/cards/images/. This script hashes
them into data/cards/hashes.json (normal + 180° orientations), along with
the cards photographed into data/cards/own/ by the launcher's "Add a card".

(Downloading lives in the shell script because parallel curl with retries
survived a flaky link that a sequential urllib downloader did not.)
"""

import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.recognisers.card_matcher import OWN_DIR, hash_entry

ROOT = Path(__file__).resolve().parents[1]
META_DIR = ROOT / "data" / "cards" / "meta"
IMG_DIR = ROOT / "data" / "cards" / "images"
DB_PATH = ROOT / "data" / "cards" / "hashes.json"


def main() -> None:
    if not META_DIR.exists():
        raise SystemExit("no data/cards/meta/ — run: bash scripts/download_card_set.sh")

    set_id = "unknown"
    set_json = ROOT / "data" / "cards" / "set.json"
    if set_json.exists():
        set_id = json.loads(set_json.read_text(encoding="utf-8")).get("id", "unknown")

    cards_out, missing = [], 0
    for meta_path in sorted(META_DIR.glob("*.json")) + sorted(OWN_DIR.glob("*.json")):
        detail = json.loads(meta_path.read_text(encoding="utf-8"))
        cid = detail["id"]
        img_path = next(
            (
                p
                for p in (IMG_DIR / f"{cid}.webp", IMG_DIR / f"{cid}.png",
                          OWN_DIR / f"{cid}.webp")
                if p.exists() and p.stat().st_size > 0
            ),
            None,
        )
        if img_path is None:
            print(f"  {cid}: image missing")
            missing += 1
            continue
        try:
            img = Image.open(img_path).convert("RGB")
        except OSError as e:
            print(f"  {cid}: unreadable image ({e}) — re-run the download script")
            missing += 1
            continue
        cards_out.append(
            {
                "id": cid,
                "name": detail["name"],
                "dex_ids": detail.get("dexId") or [],
                **hash_entry(img),
            }
        )

    DB_PATH.write_text(
        json.dumps(
            {"set": set_id, "source": "TCGdex low.webp (245x337)", "cards": cards_out},
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"wrote {len(cards_out)} cards ({missing} missing) -> {DB_PATH}")


if __name__ == "__main__":
    main()
