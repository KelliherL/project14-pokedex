"""Pluggable Pokédex data access — the database seam.

The kiosk never touches storage directly: everything reads through the
DexDataSource protocol so the backing store can change without touching the
app. JsonDexSource (the bundled data/dex.json subset) is the default and the
reference implementation; the team database replaces it by implementing the
same two methods. Contract details and field semantics: docs/INTERFACES.md.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "dex.json"


@dataclass(frozen=True)
class DexEntry:
    dex_id: int  # National Dex number
    name: str    # display name, e.g. "Pikachu"
    genus: str   # e.g. "Mouse Pokémon"
    flavor: str  # one Pokédex entry, plain TTS-safe text (kid-safe curation upstream)


@runtime_checkable
class DexDataSource(Protocol):
    """What any dex backend must provide. Read-only; must work offline."""

    def entry(self, dex_id: int) -> DexEntry | None: ...

    def species_ids(self) -> list[int]: ...


class JsonDexSource:
    """Bundled-JSON backend (data/dex.json, built by scripts/fetch_dex_data.py)."""

    def __init__(self, path: Path = DATA_PATH):
        self._by_id: dict[int, DexEntry] = {}
        if Path(path).exists():
            for e in json.loads(Path(path).read_text(encoding="utf-8"))["species"]:
                self._by_id[e["dex_id"]] = DexEntry(
                    dex_id=e["dex_id"], name=e["name"], genus=e["genus"], flavor=e["flavor"]
                )

    def entry(self, dex_id: int) -> DexEntry | None:
        return self._by_id.get(dex_id)

    def species_ids(self) -> list[int]:
        return sorted(self._by_id)
