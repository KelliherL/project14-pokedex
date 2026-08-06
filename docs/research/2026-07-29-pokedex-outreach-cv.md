# Pokédex AI Outreach Activity — existing methods, resources, and a recommended architecture

> Researched 2026-07-29 for **the decision: what recognition approach and stack
> the COMPX374 team should propose for Project 14 (Pokédex AI Outreach
> Activity, client Awhi Goodall, University of Waikato), and what a stubbed
> demo should be built on.** Claims tagged [Ran] / [Verified] / [Consensus] /
> [Thin]. Companion deep-dives (full citations live there):
>
> - [Card recognition + card-image APIs](2026-07-29-pokedex-deepdive-cards.md)
> - [Figurine classification, datasets, prior-art builds](2026-07-29-pokedex-deepdive-figurines.md)
> - [Explainability viz, TTS, Pokédex data, IP](2026-07-29-pokedex-deepdive-explainability-tts-data.md)
> - Client-facing: [first-meeting questions](../CLIENT-QUESTIONS.md)

## The brief (from the COMPX374-26B projects list, row 14)

Visitors hold a Pokémon **card or figurine** in front of a camera; the app
**identifies** the Pokémon, **reads its Pokédex entry aloud**, and **shows a
visual representation of how the AI recognised it**. Deliverable: a working
activity at **Nerdfest 2026, late October**. Technical environment: TBC.
Equipment: TBC. No IP/open-source restrictions recorded.

## Headline findings

1. **This has been built before, at least twice** — a GPT-4V-powered 3D-printed
   Pokédex (Abe's Projects, 2024: "flawless" on accurate figurines, fails on
   plush) and `iraldir/pokedex` (RPi + Gemini + ElevenLabs + PokéAPI, handles
   "toy, plush, card, figurine", 2–5 s/identification). Also a University of
   Bologna student build (Poke-Pi-Dex, custom CNN) and the canonical
   PyImageSearch tutorial. We are assembling known parts, not inventing.
   [Verified — figurines note §4–5]
2. **Cards and figurines are two different recognition problems.**
   Cards: a *matching* problem, solved with classical CV — contour-detect →
   perspective-rectify → perceptual hash → nearest neighbour, **7–26 ms/frame
   on laptop CPU** (hj3yoo/mtg_card_detector; every open-source scanner
   converges on this). Figurines: a *classification* problem with **no public
   photo dataset in existence** — all public datasets are artwork/sprites; the
   models trained on them (1,025-class ViTs, ~92% on artwork) are unproven on
   photos of toys. [Verified — cards note §1, figurines note §1–2]
3. **The consensus fix for figurines is to close the set**: photograph the
   actual event figurines from many angles on the actual camera, then
   fine-tune a checkpoint or run embedding nearest-neighbour over those
   photos. Plush toys are the consistently-reported worst case; lighting
   matters enough that prior builds retrofitted LEDs. [Consensus — figurines
   note §6]
4. **Everything needed for offline operation exists**: PokéAPI's official
   static JSON dump (`PokeAPI/api-data`), bulk card JSON + images
   (pokemontcg.io / TCGdex), local neural TTS (Piper) or pre-generated audio,
   local models. A venue-Wi-Fi dependency is a choice, not a necessity — and
   the vision-LLM route (accurate but 2–5 s, online, "flaky", per its own
   builders) should at most be a fallback, not the kiosk primary.
   [Verified — explainability note §3–4, figurines note §4]
5. **The explainability requirement is satisfiable in real time**, verified
   against a published laptop benchmark: Grad-CAM/LayerCAM ≈ 25–40 ms/frame
   CPU (plus forward pass → ~8–15 FPS CPU, 30+ on GPU); EigenCAM/CAM
   effectively free; ScoreCAM-class methods are NOT real-time (0.3–7 s). For
   the card matcher, `cv2.drawMatches` keypoint lines are webcam-rate and the
   most honest "the AI matched these dots" display. Gene Kogan's "What Neural
   Networks See" exhibit proves live layer visualisation lands with the
   public. [Verified — explainability note §1]
6. **Time-sensitive:** pokemontcg.io is now "part of Scrydex" (commercial,
   credit-quota API). The free v2 API still answered unauthenticated queries
   today, but the community expects the free tier to wind down.
   **Bulk-cache the card JSON + images early in the project.**
   [Verified transition; Thin on timeline — cards note §3.1]

## Our own live evidence ([Ran], 2026-07-29, this machine)

- `GET https://pokeapi.co/api/v2/pokemon-species/25/` → HTTP 200; **147
  flavor-text entries, 33 English, 11 languages**; latest English entry
  (Legends: Arceus) is clean, kid-readable text. [Ran]
- `GET https://api.tcgdex.net/v2/en/cards/base1-4` (no key) → HTTP 200; Base
  Set Charizard with image asset URL, holo/1st-ed variant flags, **and
  `dexId: [6]`** — TCGdex card JSON carries the National Dex number directly,
  so card-match → species → PokéAPI flavor text is a free join. [Ran]
- `GET https://api.tcgdex.net/v2/en/sets` → 218 sets, cardCount totals
  summing to 23,746. [Ran]
- `GET https://api.pokemontcg.io/v2/cards?q=name:charizard&pageSize=1`
  **without an API key** → HTTP 200, totalCount 108, small + hi-res image
  URLs. (Docs: keyless = 1,000 req/day; free key = 20,000/day.) [Ran]
- Hugging Face model search → pretrained Pokémon classifiers exist today:
  `skshmjn/Pokemon-classifier-gen9-1025` (1,025 classes),
  `keremberke/yolov8m-pokemon-classification`,
  `imzynoxprince/pokemons-image-classifier-gen1-gen9` (1,027 classes), and
  `Matthieu68857/pokemon-cards-detection` (card object-detection). [Ran]

## Recommended architecture (proposal for the team, not a decision)

One kiosk app, **two recognition backends behind one interface**, everything
offline-capable:

```
webcam frame ──► which mode? (card tray vs figurine stand)
   │
   ├─ CARDS: OpenCV contour quad → perspective rectify → pHash+dHash
   │         (multi-orientation) → Hamming NN vs local card DB
   │         → temporal voting over frames → card → dexId
   │         explainability: ORB drawMatches lines + hash-distance
   │         distribution (tmikonen's 4σ confidence criterion)
   │
   ├─ FIGURINES: closed set (the N event figurines, self-photographed)
   │         option A: fine-tuned checkpoint (1,025-class ViT or YOLO-cls)
   │         option B: CLIP/SigLIP embedding kNN over reference photos
   │         → bench A vs B in week 1; explainability: EigenCAM/Grad-CAM
   │         heatmap + Teachable-Machine-style top-5 confidence bars
   │
   └─ species id ──► local JSON (PokeAPI/api-data subset, curated
                     kid-friendly English entries, control chars stripped)
                 ──► pre-generated audio (Piper voice; robotic = thematic)
                 ──► official artwork (PokeAPI/sprites) on screen
```

- **Platform**: laptop + decent webcam as the baseline target (Python,
  PyTorch, OpenCV); a Raspberry-Pi-in-a-3D-printed-shell variant is proven
  possible (iraldir, Poke-Pi-Dex) but is a stretch goal to raise with the
  client, not the base plan.
- **Physical station design is part of the engineering**: diffuse lighting /
  small ring light, matte contrasting backdrop, card tray at fixed distance —
  the known failure modes (holo glare, occluded card edges, plush) are
  managed physically, not just in software. [Consensus — cards note §4]
- Reprint ambiguity (same artwork across sets) is harmless here: we need the
  species, not the exact printing. A deliberate, defensible simplification.

## What surprised me

- The **hash-distance distribution doubles as the explainability display**
  for cards — the statistical confidence trick (4σ from the mean distance) is
  both the matcher's accept/reject criterion and a showable visual.

  > ⚠️ CORRECTION (2026-07-29, same day, [Ran]): built and probed in the
  > stub — at a 102-card DB the 4σ rule **under-separates**: adversarial
  > junk (blank/gradient card shapes) reached 3.2σ while true matches dipped
  > to 3.4σ. The clean separators are absolute best distance (true ≤3,
  > junk ≥50 of 128) and **margin to the second-best candidate** (true ≥16,
  > junk ≤2). The stub accepts on distance ≤26 AND margin ≥8; σ is kept as a
  > display statistic only. tmikonen's criterion may hold at his DB
  > size/setup — ours is the measurement that matters here.
- **No figurine photo dataset exists anywhere** — the "customish CV harness"
  instinct isn't just valid, it's forced: self-collected photos of the event
  figurines are the only route to reliable figurine ID.
- **The robotic OS voice is thematically correct** for a Pokédex — the cheap
  option and the right option coincide.
- PokéAPI `flavor_text` contains embedded control characters (`\f`,
  soft-hyphens) that must be stripped before TTS. [Consensus]
- Even Hugging Face datasets get **DMCA'd by The Pokémon Company**
  (`lambdalabs/pokemon-blip-captions` was taken down) — the IP question is
  real, not theoretical, though free non-commercial fan tools operate
  unmolested at scale. [Verified]

## Open questions

Client-side (full list in the [questions doc](../CLIENT-QUESTIONS.md)):
venue internet; staffed vs unattended; the exact figurine/card set and early
access to it; hardware ownership; camera-and-children privacy sign-off; IP
sign-off; how deep the explainability display should go.

Technical, to settle by running (week-1 spikes):
1. **CLIP zero-shot / embedding-kNN accuracy on photos of real figurines is
   unmeasured anywhere** — benchmark it against a fine-tuned checkpoint on
   ~5 figurines photographed at home. (Testable, not tested: needs torch +
   weights downloaded, ~2 GB.)
2. Grad-CAM live-loop FPS on our actual laptops (published benchmark is a
   different machine).
3. Chrome `speechSynthesis` user-gesture requirement and offline voice
   quality on the kiosk machine (testable only in-browser at build time).
4. pokemontcg.io free-tier lifespan (Scrydex transition) — assume hostile,
   cache early.
5. Motion blur handling — no primary source quantifies it; the observed
   practice is per-frame recognition + temporal voting, adopt that.

## Verdict

**Adopt**: offline-first, two-backend design (hash-matching for cards,
closed-set classifier/embedding for figurines), physical station design as a
first-class concern, pre-generated audio, local Pokédex JSON, laptop target
with Pi shell as stretch. **Avoid**: vision-LLM as the primary identifier for
a live kiosk (latency, internet, flakiness — its own builders say so);
training on artwork datasets and hoping it transfers to toys; depending on
any live API at event time.

**Next step**: stubbed demo — card pipeline against one cached set + a
5-figurine closed-set bench (CLIP kNN vs fine-tune) + a live Grad-CAM loop,
each a falsifiable week-1 spike matching Lachlan's research → verify → build
rule.

## Sources

Primary sources are cited inline in the three companion deep-dives (fetched
2026-07-29). Live API evidence above was produced by direct requests from
this machine on 2026-07-29 (script + raw output preserved in the session
scratchpad; re-runnable in minutes).
