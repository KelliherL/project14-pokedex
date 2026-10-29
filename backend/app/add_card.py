"""Add a card to the recognition database from a photo taken with the kiosk camera.

The launcher's "Add a card" option runs `python -m app.main --mode add-card`:

1. Live view: hold the card up (a plain background helps the auto-detect).
   Space takes the photo.
2. Corner editor: the detected outline has a handle on each corner. Click a
   handle to open a zoom window and drag it onto the exact corner; the arrow
   keys nudge the selected corner one pixel. T turns the card a quarter if the
   preview is sideways. Enter accepts, Esc retakes.
3. Details, in the console: search the Pokémon by name in the same Mongo data
   the frontend reads, or add a new Pokémon there if it is missing.
4. Save: the straightened card goes into data/cards/own/ (committed, so every
   machine gets it) and into hashes.json. Then back to the launcher menu.

A reference photographed by the kiosk camera matches what the kiosk sees far
better than a downloaded scan, and covers cards no download has.
"""

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from pymongo.errors import PyMongoError

from app.capture import EXIT_RESTART, clear_console
from app.recognisers.card_matcher import (
    CARD_H,
    CARD_W,
    DB_PATH,
    OWN_DIR,
    detect_card_quad,
    hash_entry,
    rectify,
)

LIVE, EDIT, PREVIEW, ZOOM = "Add a card", "Line up the corners", "Straightened", "Zoom"
MAX_VIEW_W, MAX_VIEW_H = 1280, 720   # windows are scaled down to fit; editing is in frame pixels
HANDLE_PX = 18                       # how close a click must be to grab a corner, screen pixels
ZOOM_RADIUS, ZOOM_SCALE = 30, 8      # frame pixels shown either side of the corner, magnification

ENTER_KEYS = (10, 13)
ESC = 27
# cv2.waitKeyEx arrow codes: Windows, then GTK (Linux)
NUDGE = {2424832: (-1, 0), 2555904: (1, 0), 2490368: (0, -1), 2621440: (0, 1),
         65361: (-1, 0), 65363: (1, 0), 65362: (0, -1), 65364: (0, 1)}

TYPES = ("normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
         "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy")
GENERATIONS = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX")
# Six or more digits in a row (spaces or dashes allowed between them). No Pokémon
# field has one; card numbers, phone numbers and account numbers do.
DIGIT_RUN = re.compile(r"\d(?:[\s-]?\d){5,}")


class Cancelled(Exception):
    """The user typed x at a prompt: drop this card and retake the photo."""


# --- validation: everything typed here can end up in Mongo -----------------

def text(max_len: int):
    def parse(s: str) -> str:
        if len(s) > max_len:
            raise ValueError(f"at most {max_len} characters")
        if not s.isprintable():
            raise ValueError("only plain printable text")
        if DIGIT_RUN.search(s):
            raise ValueError("long runs of digits aren't allowed")
        return s
    return parse


def number(lo: float, hi: float, kind=float):
    def parse(s: str):
        try:
            v = kind(s)
        except ValueError:
            raise ValueError(f"enter a number from {lo} to {hi}") from None
        if not lo <= v <= hi:   # also rejects nan
            raise ValueError(f"enter a number from {lo} to {hi}")
        return v
    return parse


def types_list(s: str) -> list[str]:
    parts = [p.strip().lower() for p in s.split(",") if p.strip()]
    bad = [p for p in parts if p not in TYPES]
    if bad:
        raise ValueError(f"unknown type {', '.join(bad)} — use: {', '.join(TYPES)}")
    if not 1 <= len(parts) <= 2:
        raise ValueError("one or two types")
    return parts


def generation(s: str) -> str:
    if s.upper() not in GENERATIONS:
        raise ValueError(f"one of {', '.join(GENERATIONS)}")
    return s.upper()


# Every field the seeded Mongo records have, with a validator. Only the first
# two are required; Enter leaves the rest out.
SPECIES_FIELDS = [
    ("_id", "Pokédex number", number(1, 99999, int)),
    ("enName", "English name", text(40)),
    ("jpName", "Japanese name (romanised)", text(40)),
    ("generation", "Generation (I to IX)", generation),
    ("typings", "Types, comma separated (e.g. water, ice)", types_list),
    ("classification", "Category (e.g. Sea Lion Pokémon)", text(40)),
    ("percentMale", "% male (0 to 100)", number(0, 100)),
    ("percentFemale", "% female (0 to 100)", number(0, 100)),
    ("heightM", "Height in metres", number(0.01, 100)),
    ("weightKG", "Weight in kg", number(0.01, 10000)),
    ("hp", "HP stat (1 to 255)", number(1, 255, int)),
    ("attack", "Attack stat", number(1, 255, int)),
    ("defense", "Defense stat", number(1, 255, int)),
    ("spAttack", "Sp. Attack stat", number(1, 255, int)),
    ("spDefense", "Sp. Defense stat", number(1, 255, int)),
    ("speed", "Speed stat", number(1, 255, int)),
    ("description", "Pokédex description", text(300)),
]
REQUIRED = {"_id", "enName"}


# --- saving --------------------------------------------------------------

def save_card(card_bgr: np.ndarray, name: str, dex_ids: list[int],
              own_dir: Path = OWN_DIR, db_path: Path = DB_PATH) -> str:
    """Write the card into own_dir and append it to hashes.json. Returns its id."""
    own_dir.mkdir(parents=True, exist_ok=True)
    base = "own-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "card")
    n = 1
    while (own_dir / f"{base}-{n}.json").exists():
        n += 1
    cid = f"{base}-{n}"

    img_path = own_dir / f"{cid}.webp"
    if not cv2.imwrite(str(img_path), card_bgr, [cv2.IMWRITE_WEBP_QUALITY, 95]):
        raise OSError(f"could not write {img_path}")
    (own_dir / f"{cid}.json").write_text(
        json.dumps({"id": cid, "name": name, "dexId": dex_ids, "source": "own photo"}, indent=1),
        encoding="utf-8")

    db = (json.loads(db_path.read_text(encoding="utf-8")) if db_path.exists()
          else {"set": "own", "cards": []})
    # hash the saved file, exactly as scripts/build_card_db.py will on a rebuild
    with Image.open(img_path) as img:
        entry = {"id": cid, "name": name, "dex_ids": dex_ids, **hash_entry(img.convert("RGB"))}
    db["cards"].append(entry)
    db_path.write_text(json.dumps(db, indent=1), encoding="utf-8")
    return cid


# --- camera windows ------------------------------------------------------

def _scale(frame: np.ndarray) -> float:
    h, w = frame.shape[:2]
    return min(1.0, MAX_VIEW_W / w, MAX_VIEW_H / h)


def _banner(view: np.ndarray, msg: str) -> None:
    cv2.rectangle(view, (0, 0), (view.shape[1], 30), (0, 0, 0), -1)
    cv2.putText(view, msg, (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1,
                cv2.LINE_AA)


def _closed(window: str) -> bool:
    return cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1


def take_photo(cap) -> np.ndarray | None:
    """Live view until Space (the frame) or Esc / Q / closing the window (None)."""
    cv2.namedWindow(LIVE)
    while True:
        ok, frame = cap.read()
        if not ok:
            print("error: camera read failed")
            return None
        s = _scale(frame)
        view = cv2.resize(frame, None, fx=s, fy=s)
        quad = detect_card_quad(frame)
        if quad is not None:
            cv2.polylines(view, [(quad * s).astype(np.int32)], True, (0, 255, 0), 2)
        _banner(view, "Space = take photo    Esc = back to the menu")
        cv2.imshow(LIVE, view)
        key = cv2.waitKey(1) & 0xFF
        if key == ord(" "):
            return frame
        if key in (ESC, ord("q")) or _closed(LIVE):
            return None


def _default_quad(frame: np.ndarray) -> np.ndarray:
    """A card-shaped box in the middle of the frame, when nothing was detected."""
    h, w = frame.shape[:2]
    ch = 0.6 * h
    cw = ch * CARD_W / CARD_H
    x0, y0 = (w - cw) / 2, (h - ch) / 2
    return np.array([[x0, y0], [x0 + cw, y0], [x0 + cw, y0 + ch], [x0, y0 + ch]], np.float32)


class CornerEditor:
    """Drag four corner handles onto the card; returns the quad in frame pixels."""

    def __init__(self, frame: np.ndarray):
        self.frame = frame
        self.s = _scale(frame)
        self.quad = self._detect()
        self.selected: int | None = None
        self.dragging = False
        self.zoom_open = False

    def _detect(self) -> np.ndarray:
        quad = detect_card_quad(self.frame)
        return quad if quad is not None else _default_quad(self.frame)

    def _on_mouse(self, event, x, y, _flags, _param) -> None:
        h, w = self.frame.shape[:2]
        p = np.clip(np.array([x, y], np.float32) / self.s, 0, (w - 1, h - 1))
        if event == cv2.EVENT_LBUTTONDOWN:
            d = np.linalg.norm(self.quad - p, axis=1) * self.s
            self.selected = int(d.argmin()) if d.min() <= HANDLE_PX else None
            self.dragging = self.selected is not None
        elif event == cv2.EVENT_MOUSEMOVE and self.dragging:
            self.quad[self.selected] = p
        elif event == cv2.EVENT_LBUTTONUP:
            self.dragging = False

    def _zoom(self, centre: np.ndarray) -> np.ndarray:
        """The frame around one corner, magnified with whole pixels visible."""
        r = ZOOM_RADIUS
        padded = cv2.copyMakeBorder(self.frame, r, r, r, r, cv2.BORDER_CONSTANT)
        x, y = (round(float(v)) for v in centre)
        big = cv2.resize(padded[y:y + 2 * r + 1, x:x + 2 * r + 1], None,
                         fx=ZOOM_SCALE, fy=ZOOM_SCALE, interpolation=cv2.INTER_NEAREST)
        c = r * ZOOM_SCALE + ZOOM_SCALE // 2
        cv2.line(big, (c, 0), (c, big.shape[0]), (0, 0, 255), 1)
        cv2.line(big, (0, c), (big.shape[1], c), (0, 0, 255), 1)
        return big

    def _draw(self) -> None:
        view = cv2.resize(self.frame, None, fx=self.s, fy=self.s)
        pts = self.quad * self.s
        cv2.polylines(view, [pts.astype(np.int32)], True, (0, 255, 0), 1, cv2.LINE_AA)
        for i, (x, y) in enumerate(pts):
            colour = (0, 0, 255) if i == self.selected else (0, 255, 0)
            cv2.circle(view, (int(x), int(y)), HANDLE_PX // 2, colour, 2)
        _banner(view, "drag corners | arrows nudge | T turn | R re-detect | "
                      "Enter accept | Esc retake")
        cv2.imshow(EDIT, view)
        cv2.imshow(PREVIEW, rectify(self.frame, self.quad))
        if self.selected is not None:
            cv2.imshow(ZOOM, self._zoom(self.quad[self.selected]))
            self.zoom_open = True
        elif self.zoom_open:
            cv2.destroyWindow(ZOOM)
            self.zoom_open = False

    def run(self) -> np.ndarray | None:
        cv2.namedWindow(EDIT)
        cv2.setMouseCallback(EDIT, self._on_mouse)
        while True:
            self._draw()
            key = cv2.waitKeyEx(15)
            if key in ENTER_KEYS:
                return self.quad.copy()
            if key == ESC or _closed(EDIT):
                return None
            if key in (ord("t"), ord("T")):
                # which detected corner is "top-left" decides which way up the card comes out
                self.quad = np.roll(self.quad, -1, axis=0)
                self.selected = None
            elif key in (ord("r"), ord("R")):
                self.quad, self.selected = self._detect(), None
            elif key in NUDGE and self.selected is not None:
                self.quad[self.selected] += NUDGE[key]


# --- console screens -----------------------------------------------------

def _screen(step: str) -> None:
    clear_console()
    print("=" * 60)
    print(f" Add a card  -  {step}")
    print("=" * 60)
    print(" (type x at any prompt to drop this card and retake the photo)\n")


PLAIN_TEXT = text(60)


def ask(prompt: str, parse=PLAIN_TEXT, required: bool = False):
    while True:
        raw = input(f"  {prompt}: ").strip()
        if raw.lower() == "x":
            raise Cancelled
        if not raw:
            if not required:
                return None
            print("    ! this one is required")
            continue
        try:
            return parse(raw)
        except ValueError as e:
            print(f"    ! {e}")


def _yes(prompt: str, default: bool) -> bool:
    answer = ask(f"{prompt} [{'Y/n' if default else 'y/N'}]")
    return default if answer is None else answer.lower().startswith("y")


def _search(collection, query: str) -> list[dict]:
    if query.isdigit():
        doc = collection.find_one({"_id": int(query)})
        return [doc] if doc else []
    pattern = {"$regex": re.escape(query), "$options": "i"}
    return list(collection.find({"enName": pattern}).sort("_id", 1).limit(20))


def _describe(doc: dict) -> str:
    types = ", ".join(doc.get("typings") or [])
    return f"#{doc['_id']:<5} {doc.get('enName', '?')}" + (f"  ({types})" if types else "")


def choose_pokemon(collection) -> dict | None:
    """The Mongo record of the Pokémon on the card, or None for a Trainer / Energy card."""
    while True:
        _screen("step 1 of 2: which Pokémon is it?")
        print("  Type part of its name, or its Pokédex number if you know it.")
        print("  Leave it blank if the card isn't a Pokémon (a Trainer or Energy card).\n")
        query = ask("Search", text(40))
        if query is None:
            return None
        try:
            hits = _search(collection, query)
        except PyMongoError as e:
            print(f"\n  ! can't reach the Pokémon database - is Docker running? ({e})")
            input("  Press Enter to try again...")
            continue

        print()
        for i, doc in enumerate(hits, 1):
            print(f"   {i:2d})  {_describe(doc)}")
        if not hits:
            print("   nothing matches that")
        print("    N)  It isn't listed - add a new Pokémon to the database")
        print("    S)  Search again\n")
        pick = ask("Choose", text(5), required=True).lower()
        if pick.isdigit() and 1 <= int(pick) <= len(hits):
            return hits[int(pick) - 1]
        if pick == "n":
            doc = new_pokemon(collection)
            if doc is not None:
                return doc


def new_pokemon(collection) -> dict | None:
    """Fill in and insert a Mongo record. None if the user backs out at the end."""
    _screen("new Pokémon for the database")
    print("  Press Enter to leave a field out (only the first two are needed).\n")
    doc = {}
    for key, label, parse in SPECIES_FIELDS:
        while True:
            value = ask(label, parse, required=key in REQUIRED)
            taken = collection.find_one({"_id": value}) if key == "_id" else None
            if taken is None:
                break
            print(f"    ! #{value} is already {taken.get('enName', 'taken')}")
        if value is not None:
            doc[key] = value

    print("\n  About to add:")
    for key, label, _ in SPECIES_FIELDS:
        if key in doc:
            print(f"    {label}: {doc[key]}")
    if not _yes("\n  Add this Pokémon to the database?", True):
        return None
    collection.insert_one(doc)
    return doc


def enter_details(collection) -> tuple[str, list[int]] | None:
    """(card name, dex ids) from the console, or None to drop the card."""
    pokemon = choose_pokemon(collection)
    _screen("step 2 of 2: the card")
    if pokemon is None:
        name = ask("Card name (e.g. Professor Oak, Water Energy)", required=True)
        dex_ids = []
    else:
        default = pokemon.get("enName", "")
        print(f"  Pokémon: {_describe(pokemon)}")
        name = ask(f"Card name, if it differs (Enter for {default})") or default
        dex_ids = [int(pokemon["_id"])]
    print(f"\n  Card: {name}" + (f"   Pokédex #{dex_ids[0]}" if dex_ids else "   (not a Pokémon)"))
    return (name, dex_ids) if _yes("  Save this card?", True) else None


# --- the mode ------------------------------------------------------------

def run(camera: int) -> int:
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(camera, backend)
    if not cap.isOpened():
        print(f"error: cannot open camera {camera}")
        return 1
    from app.server import database  # the connection the frontend's /Pokemon route reads
    collection = database.get_collection("TestingDatabase")

    try:
        while True:
            frame = take_photo(cap)
            if frame is None:
                return EXIT_RESTART
            quad = CornerEditor(frame).run()
            cv2.destroyAllWindows()
            if quad is None:
                continue
            card = rectify(frame, quad)

            print("\n  Click this console window to type.")
            try:
                details = enter_details(collection)
                if details is None:
                    continue
                cid = save_card(card, *details)
                print(f"\n  Saved {cid}. It is recognised from the next backend start.")
                if not _yes("  Add another card?", False):
                    return EXIT_RESTART
            except Cancelled:
                continue
            except PyMongoError as e:
                print(f"\n  ! the Pokémon database failed ({e}); nothing was saved.")
                input("  Press Enter to retake the photo...")
    finally:
        cap.release()
        cv2.destroyAllWindows()
