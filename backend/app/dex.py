"""Species -> spoken kiosk line, via a pluggable DexDataSource.

Storage-agnostic on purpose: this module only knows the protocol in
dex_source.py, never the backing store. Swap JsonDexSource for the team
database without touching anything here (see docs/INTERFACES.md).
"""

from app.dex_source import DexDataSource, DexEntry, JsonDexSource
from app.recognisers.base import Identification


class Dex:
    def __init__(self, source: DexDataSource | None = None):
        self.source: DexDataSource = source if source is not None else JsonDexSource()

    def entry(self, dex_id: int) -> DexEntry | None:
        return self.source.entry(dex_id)

    def line_for(self, ident: Identification | None) -> str:
        if ident is None or ident.kind == "none":
            return "I can't see a card. Place one flat in the tray."
        e = self.source.entry(ident.dex_id) if ident.dex_id else None
        if e is not None:
            return f"{e.name}. The {e.genus}. {e.flavor}"
        if ident.label and ident.kind == "card":
            # Matched a card with no species (Trainer/Energy) or missing data.
            return f"{ident.label}. That one isn't a Pokémon species, so it has no Pokédex entry."
        return "Hmm, I'm not sure. Try tilting the card toward the light."
