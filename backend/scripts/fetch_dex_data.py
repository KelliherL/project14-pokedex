"""Cache Pokédex entries from PokeAPI into data/dex.json.

Species list = every dex id the recognisers can actually return: those
referenced by data/cards/hashes.json (run build_card_db.py first) unioned
with those in data/figurines/labels.json (run build_figurine_index.py). A
recogniser that can name a species the dex cannot answer for produces a
figurine the kiosk identifies correctly and then refuses to talk about,
which is worse than not recognising it.

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
FIGURINES = ROOT / "data" / "figurines" / "labels.json"
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
    wanted: set[int] = set()
    if HASHES.exists():
        cards = json.loads(HASHES.read_text(encoding="utf-8"))["cards"]
        from_cards = {d for c in cards for d in c["dex_ids"]}
        wanted |= from_cards
        print(f"{len(from_cards)} species referenced by the card DB")
    if FIGURINES.exists():
        from_figurines = {e["dex_id"] for e in
                          json.loads(FIGURINES.read_text(encoding="utf-8")).values()}
        new = from_figurines - wanted
        wanted |= from_figurines
        print(f"{len(from_figurines)} species referenced by the figurine index "
              f"({len(new)} not already covered)")
    if not wanted:
        wanted = set(DEFAULT_IDS)
        print("no recogniser data found — using default favourites list")
    ids = sorted(wanted)
    print(f"{len(ids)} species to fetch")

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
