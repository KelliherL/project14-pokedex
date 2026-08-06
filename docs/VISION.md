# Vision — Pokédex AI Outreach Activity

> **Status: PRELIMINARY** — written 2026-07-29 from the project brief and the
> team's scoping research, *before* the first client meeting. Everything here
> is a proposal to react to, not a commitment. Companion docs:
> [ARCHITECTURE.md](ARCHITECTURE.md) · [TECH-STACK.md](TECH-STACK.md) ·
> [client questions](CLIENT-QUESTIONS.md) ·
> [research note](research/2026-07-29-pokedex-outreach-cv.md).

## The pitch

A working Pokédex. You hold a Pokémon card or figurine up to the camera; the
machine recognises it, tells you — out loud, in the classic robotic Pokédex
voice — what it is and what the Pokédex says about it, and **shows you how it
knew**: where the AI looked, what it matched, and how sure it was.

The last part is the point. Nerdfest is a computer-science outreach event;
the Pokémon are the hook, but the deliverable is the *"ohhh, that's how it
sees"* moment. The explainability display is a first-class feature, not a
debug view.

## The 30-second visitor loop

1. Visitor picks a card from the tray (or a figurine from the shelf) and
   places it in front of the camera.
2. Live screen shows the camera feed with the AI's working drawn over it —
   the detected card outline, the "as the AI sees it" rectified view, match
   confidence building.
3. Lock-on: the screen flashes the identification, official artwork appears,
   and the Pokédex voice reads the entry aloud (captions on screen).
4. The explanation panel lingers: *these* points matched, *this* is the
   confidence, *this* is what the heatmap looked at.
5. Reset for the next visitor. Target cycle: well under 30 seconds.

## Audience

Families and kids at Nerdfest 2026 (late October), general public, zero
assumed technical background. Design floor: a 7-year-old can use it alone;
a staffed helper can use the explanation panel to teach.

## Goals (what success looks like)

1. **It feels like magic that explains itself.** Recognition is fast
   (< a few seconds end-to-end) and the "how" display is legible to a child.
2. **Reliable on the curated set.** On the cards/figurines *we bring*,
   identification is near-flawless. When unsure, it says so gracefully
   ("Hmm — try tilting the card toward the light") rather than guessing.
3. **Survives the event.** Runs offline all day, recovers from restarts,
   no crash a visitor can trigger.
4. **Teaches something true.** The visuals show what the system actually
   computes (real match distances, real heatmaps) — no theatre.

## Non-goals (deliberate)

- **Not an open-set recogniser.** We do not promise to identify any of the
  ~1,300 Pokémon from any object a visitor brings. We promise the curated
  event set, flawlessly. (Visitor-brought cards may well work — the card
  matcher covers whole sets cheaply — but that's a bonus, not the bar.)
- **Not a card-collection/pricing app.** Species only; exact printing and
  market value are out of scope.
- **Not dependent on venue internet.** Everything runs locally.
- **Not a data collector.** Frames are processed live and never stored; no
  photos of visitors are kept. (Privacy stance to be confirmed with the
  client/University.)

## Constraints and flags

- **Hard deadline:** Nerdfest 2026, late October. Dress rehearsal under
  event-like conditions is on the critical path.
- **Physical conditions are part of the system:** lighting, backdrop, and a
  fixed card tray/figurine stand are engineering, not decoration — the known
  failure modes (holo-card glare, plush toys, occluded card edges) are
  managed physically first.
- **IP:** Pokémon names/art/entries are The Pokémon Company/Nintendo IP.
  Free, non-commercial, university-run use matches broad fan-tool practice,
  but sign-off is a client-meeting item, not our call.
- **Privacy:** a camera pointed at children at a public event needs
  University sign-off (signage, no storage). We can honestly promise
  nothing-is-recorded; someone must own saying so.

## Success criteria we'd propose measuring at the event

- ≥ 95% correct identification on the curated set, first attempt, in situ.
- Median place-to-speech time ≤ 5 s.
- Zero unrecovered crashes across the event.
- A staffed observer tally of the "explained it to someone" moments — the
  outreach metric the client actually cares about.
