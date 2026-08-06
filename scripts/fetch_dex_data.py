"""Cache Pokédex entries from PokeAPI into data/dex.json.

Species list = every dex id referenced by data/cards/hashes.json (run
build_card_db.py first), or a default favourites list if no card DB exists.

Cleans the control characters PokeAPI flavor text is known to contain
(page-break \\x0c, soft hyphens, embedded newlines) so text is TTS-safe.
NOTE: entries are taken latest-first with no kid-safety curation yet — the
event build whitelists entries (client sign-off item).
"""

import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HASHES = ROOT / "data" / "cards" / "hashes.json"
OUT = ROOT / "data" / "dex.json"
HEADERS = {"User-Agent": "compx374-pokedex-stub (university outreach project)"}

DEFAULT_IDS = [1, 4, 6, 7, 9, 25, 39, 52, 54, 94, 133, 143, 150, 151]


def get_json(url: str, attempts: int = 3) -> dict:
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (TimeoutError, OSError):
            if attempt == attempts:
                raise
            print(f"  retry {attempt} after timeout: {url}")
            time.sleep(2 * attempt)
    raise RuntimeError("unreachable")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\x0c", " ").replace("\xad", "")).strip()


def main() -> None:
    if HASHES.exists():
        cards = json.loads(HASHES.read_text(encoding="utf-8"))["cards"]
        ids = sorted({d for c in cards for d in c["dex_ids"]})
        print(f"{len(ids)} species referenced by the card DB")
    else:
        ids = DEFAULT_IDS
        print("no card DB found — using default favourites list")

    species = []
    for i in ids:
        d = get_json(f"https://pokeapi.co/api/v2/pokemon-species/{i}/")
        english = [f for f in d["flavor_text_entries"] if f["language"]["name"] == "en"]
        genus = next(
            (g["genus"] for g in d["genera"] if g["language"]["name"] == "en"),
            "Pokémon",
        )
        flavor = clean(english[-1]["flavor_text"]) if english else ""
        species.append(
            {"dex_id": i, "name": d["name"].capitalize(), "genus": genus, "flavor": flavor}
        )
        print(f"  #{i} {d['name']}")
        time.sleep(0.05)  # PokeAPI fair-use: gentle + we cache the result

    OUT.write_text(
        json.dumps({"source": "PokeAPI pokemon-species (latest EN entry)", "species": species}, indent=1),
        encoding="utf-8",
    )
    print(f"\nwrote {len(species)} species -> {OUT}")


if __name__ == "__main__":
    main()
