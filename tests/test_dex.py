"""Unit tests for the dex seam.

The point of these tests is the FakeSource: Dex must work against *any*
DexDataSource, which is exactly how the team database plugs in later
(docs/INTERFACES.md). If these pass with an in-memory dict, they pass with
a real database adapter.
"""

from app.dex import Dex
from app.dex_source import DexDataSource, DexEntry, JsonDexSource
from app.recognisers.base import Identification

PIKACHU = DexEntry(
    dex_id=25,
    name="Pikachu",
    genus="Mouse Pokémon",
    flavor="It stores electricity in the pouches on its cheeks.",
)


class FakeSource:
    """In-memory stand-in for the team database."""

    def __init__(self, entries: list[DexEntry]):
        self._by_id = {e.dex_id: e for e in entries}

    def entry(self, dex_id: int) -> DexEntry | None:
        return self._by_id.get(dex_id)

    def species_ids(self) -> list[int]:
        return sorted(self._by_id)


def test_fake_source_satisfies_the_protocol():
    assert isinstance(FakeSource([]), DexDataSource)


def test_line_for_known_species_reads_from_the_source():
    dex = Dex(source=FakeSource([PIKACHU]))
    ident = Identification(kind="figurine", label="Pikachu", dex_id=25, confidence=0.9)
    assert dex.line_for(ident) == (
        "Pikachu. The Mouse Pokémon. It stores electricity in the pouches on its cheeks."
    )


def test_line_for_nothing_detected_prompts_gently():
    dex = Dex(source=FakeSource([PIKACHU]))
    assert "Place one flat" in dex.line_for(Identification(kind="none"))
    assert "Place one flat" in dex.line_for(None)


def test_line_for_card_without_species_explains_itself():
    # Trainer/Energy cards match but have no dex entry — never guess.
    dex = Dex(source=FakeSource([PIKACHU]))
    ident = Identification(kind="card", label="Switch", dex_id=None, confidence=0.8)
    assert "isn't a Pokémon species" in dex.line_for(ident)


def test_line_for_unknown_species_admits_unsure():
    dex = Dex(source=FakeSource([]))
    ident = Identification(kind="figurine", label=None, dex_id=None)
    assert "not sure" in dex.line_for(ident)


def test_json_source_loads_the_bundled_subset():
    src = JsonDexSource()
    ids = src.species_ids()
    assert len(ids) > 0, "bundled data/dex.json should ship with the repo"
    e = src.entry(ids[0])
    assert e is not None and e.name and e.flavor
