# Research: TCG card recognition from camera images + card-image databases/APIs

Slice for the COMPX374 Pokédex outreach project (webcam identifies a Pokémon TCG card, reads Pokédex entry, shows recognition visualisation). Researched 2026-07-29. Every claim graded: [Verified] = primary source read/queried directly by me (URL cited); [Consensus] = multiple independent practitioners agree; [Thin] = single or untraceable/secondary source, or search-snippet only.

---

## 1. How production/hobby card scanners work

### The standard pipeline

[Consensus] Across every open-source scanner examined (MTG and Pokémon), the pipeline is the same one hypothesised in the task brief:

1. **Detect the card quadrilateral** — threshold/edge the frame, extract contours, filter for card-shaped (rounded-rectangle, ~63x88 mm aspect) quads. Some projects use a neural detector (YOLO) instead, but two of them *abandoned* neural detection for classical contours (speed, robustness — see hj3yoo below).
2. **Perspective-rectify** — 4-point perspective transform to a canonical "flat scan" view.
3. **Fingerprint** — perceptual hash (pHash/dHash/aHash/wHash) of the rectified card, OR local features (SIFT → ORB), OR OCR of the name line, OR CNN embedding.
4. **Nearest-neighbour match** against a pre-computed database of fingerprints built from official card-image APIs (Scryfall/Gatherer for MTG; pokemontcg.io / pkmncards.com for Pokémon).

Perceptual hashing is by far the most common choice in open-source scanners; OCR-based approaches are the main alternative (and the main commercial-adjacent one, since they generalise to new sets without a rebuilt hash DB).

### Best-documented MTG examples (the richest writeups are MTG, and transfer directly)

**tmikonen/magic_card_detector** (Python, MIT, 125 stars / 51 forks; deps confirmed current for Python 3.13 as of Dec 2025) — https://github.com/tmikonen/magic_card_detector with a detailed writeup at https://tmikonen.github.io/quantitatively/2020-01-01-magic-card-detector/

- [Verified] Pipeline: image → threshold to binary → contours → convex hull → simplified → minimum-area bounding quadrilateral → 4-point perspective transform ("bird's-eye view") → **pHash** against a pre-calculated hash DB (ships with Limited Edition Alpha + Swedish old-school 93/94 reference hashes).
- [Verified] Match/reject criterion: a candidate is "recognised" when its hash distance to the best match is **more than 4 standard deviations from the mean** of distances to all reference cards — a nice statistical confidence trick worth stealing for the "how the AI recognised it" visualisation.
- [Verified] No hard accuracy/FPS numbers published; tested qualitatively on ~100 photos. Reported working on sleeved cards, textured backgrounds, tilted cards, imperfect lighting; fails on partially overlapping/occluded cards and poor light. Author notes pHash is "quite sensitive to segmentation" — too much or too little border around the rectified card breaks matching.

**hj3yoo/mtg_card_detector** (Python, 137 stars / 24 forks, 988 commits) — https://github.com/hj3yoo/mtg_card_detector

- [Verified] Originally trained YOLO on ~40,000 synthetic composited card images (noise/dropout/lighting augmentation); reached "88% validation accuracy on the generated test set" but **failed in real conditions**: obscured cards, "glaring or light variations", skewed cards. YOLO inference cost 50–60 ms/frame — too slow.
- [Verified] Final design: classical contour detection + **pHash** lookup against an MTG card DB, comparing against every DB hash. Optimised from 65–115 ms/frame down to **7–26 ms/frame (~20–25 fps) on CPU, no GPU** — realistic target numbers for a live webcam kiosk.
- [Verified] Limitation of the contour approach: "the entire card must be shown without obstruction nor cropping."

**TrifectaIII/MTG-Card-Reader** (Python/PyQt5/OpenCV, 48 stars, archived June 2022) — https://github.com/TrifectaIII/MTG-Card-Reader

- [Verified] Webcam → feature matching, originally SIFT, swapped to **ORB** (to drop the opencv-contrib dependency); card data from MTGJSON; caches downloaded card images per set ("5 minutes or more" initial set load). No accuracy metrics.

**fortierq/mtgscan** — https://github.com/fortierq/mtgscan, writeup https://fortierq.github.io/mtgscan-ocr-azure-flask-celery-socketio/

- [Thin — repo self-description + search snippet, not fetched in full] OCR-based: detects text (Azure Read/OCR), then fuzzy-matches recognised names against a card-name dictionary. Represents the OCR family of scanners.

**Gleeber/MTG-Card-Scanner** — https://github.com/Gleeber/MTG-Card-Scanner

- [Thin — search snippet only] Builds **64-bit dHash** fingerprints from Gatherer card images and matches camera frames against them.

**LauriHursti/visions** (Python/C++, 3 stars) — https://github.com/LauriHursti/visions

- [Verified] The heavyweight OCR pipeline: FASText component detection → CNN text/noise classifier → DBSCAN clustering into text lines → LSTM RNN OCR → SymSpell correction against the known card-name lexicon. Only handles black-text name frames; no published accuracy. Interesting as an architecture reference, not as a base.

### Commercial scanners (closed source — little verifiable detail)

**Delver Lens** (MTG; Android/iOS) — https://www.delverlab.com/ , https://delver.app/ , Play Store https://play.google.com/store/apps/details?id=delverlab.delverlens

- [Thin] Built by Cassio Santos (masters in AI); uses a proprietary recognition model referred to as **"lambda"** (a faster variant used in Delver X); works **fully offline** (implies an on-device model + local card DB, i.e. embedding/hash NN lookup rather than server OCR).
- [Thin — vendor guidance via reviews/FAQ] Scans the full card and needs the card border visible; vendor guidance stresses good lighting, no glare/shadows, high contrast between card and surface. Review site (https://www.scanyourmtg.com/review/delver-lens/) says "with decent lighting and a white background the app works almost flawlessly."

**Dragon Shield scanners** (separate MTG / Pokémon / Yu-Gi-Oh / FaB apps) — e.g. Poké TCG Scanner: https://apps.apple.com/us/app/pok%C3%A9-tcg-scanner-dragon-shield/id1199495742 , https://play.google.com/store/apps/details?id=pt.tscg.pokemanager

- [Thin — marketing copy] "Advanced image recognition", recognises cards "in any language", newer "Pro Scanner" mode claims to detect correct card **set and version**. No technical disclosure.
- [Thin — user reports via aggregators] Non-standard-border and **foiled cards can fail** or recognise slowly.

**TCGplayer app scanner** — official scanning-tips page (primary source, fetched): https://help.tcgplayer.com/hc/en-us/articles/115009674788-Tips-for-Accurate-Scanning

- [Verified] Official guidance, quoted: "A patternless surface—like a blank sheet of printer paper—works best. The color should contrast with the card border." / "Scan the Entire Card. Avoid camera edges, and remove obstructions. If the card is sleeved, make sure it's centered in its sleeve." / "Reduce Glare: Scan cards at a 45° angle or press the flash symbol to improve the lighting." / Foil type, condition and language are **set manually by the user**, i.e. even TCGplayer's production scanner does not auto-detect foil vs non-foil.

### Takeaway for our project

[Consensus] Contour-detect → rectify → pHash/dHash → Hamming-distance NN against pokemontcg.io images is the proven, CPU-real-time (20+ fps) recipe. The distance distribution (tmikonen's 4-sigma criterion) doubles as a natural, explainable confidence visualisation. OCR of the card name is the robust fallback but is slower and needs a text pipeline; hybrid (hash first, OCR tiebreak, set-symbol template match — see hugopeixoto) covers reprints of the same artwork.

---

## 2. Open-source Pokémon-card-specific recognisers on GitHub

Best five (physical-card focus first):

### 2.1 hugopeixoto/ptcg-detection — Rust, 69 stars, AGPL-3.0
https://github.com/hugopeixoto/ptcg-detection

- [Verified] Two-stage matcher: "The base algorithm uses a **perceptual hash** to compare images", plus a second stage that **extracts and template-matches the set symbol** to disambiguate near-identical reprints across sets — the most Pokémon-specific insight found (same artwork recurs across sets; the set symbol is the discriminator).
- [Verified] Dataset: card scans from pkmncards.com or pokemontcg.io at 600x825 JPG; hashes cached; binaries for photo and video detection.
- [Verified] Caveats: author states it is "not structured to run on computers other than my own" (hardcoded paths); no accuracy metrics in README. Conference talk: "Identifying Pokémon Cards", RustConf 2021 — https://www.youtube.com/watch?v=BLy_YF4nmqQ (talk content unwatched — [Thin] for anything beyond its existence).

### 2.2 NolanAmblard/Pokemon-Card-Scanner — Python/OpenCV/MySQL, 63 stars / 19 forks
https://github.com/NolanAmblard/Pokemon-Card-Scanner

- [Verified] Classic pipeline spelled out: OpenCV edge detection → largest rectangular contour → corner extraction and reordering → perspective transform → **four hash types (aHash, wHash, pHash, dHash)** via the Python ImageHash library, each stored in **4 orientations** (normal, mirrored, upside-down, both) → distance-with-cutoff match against a MySQL DB.
- [Verified] Covers the *Evolutions* set only; 9 commits, low activity; no accuracy figures.

### 2.3 1vcian/Pokemon-TCGP-Card-Scanner — 62 stars / 9 forks
https://github.com/1vcian/Pokemon-TCGP-Card-Scanner

- [Verified] Scans **TCG Pocket app screenshots, not physical cards** — but the architecture is instructive for us: **YOLO11-nano OBB** (oriented bounding box) model finds cards + orientation, then **24-bit RGB perceptual hash** matches against a DB, hashes cached in IndexedDB (runs in-browser). Trained on **10,000 synthetic augmented images** (rotation, scaling, perspective distortion, noise). Author pitch: hash matching means no retraining when new cards release — only new reference images. No accuracy metrics.

### 2.4 prateekt/pokemon-card-recognizer — Python, 28 stars / 10 forks, 278 commits
https://github.com/prateekt/pokemon-card-recognizer

- [Verified] **OCR-based** (easy_ocr default, or PyTesseract) + classification against reference builds constructed from the pokemontcg.io API (needs the free API key); ships "pre-bundled with pre-rebuilt references for all major Pokémon card sets" (e.g. base1, jungle). Handles single images, directories, video, and booster-pull video modes. "MUCH (~5x-10x) faster on NVIDIA GPU." Benchmarks exist but only as a linked Google Slides deck ([Thin] on the actual numbers — not retrieved).

### 2.5 em4go/PokeCard-TCG-detector — Python/Flask, 12 stars / 8 forks
https://github.com/em4go/PokeCard-TCG-detector

- [Verified] OpenCV contour/edge detection; identification quote from README: "I used imagehash to compare the card image with the images from the API. I used the perceptual hash, difference hash and wavelet hash algorithms." Reference images/metadata from the Pokémon TCG API, stored as JSON/msgpack/CSV/pickle; Flask real-time scanning UI. No accuracy metrics.

### Also seen (not fully investigated)

- [Thin] iFan13/Pokemon_TCG_Scanner — https://github.com/iFan13/Pokemon_TCG_Scanner — TensorFlow object detection + OCR, card scanner & price checker prototype.
- [Thin] ZeeshanGeoPk/pokemon-card-detection — https://github.com/ZeeshanGeoPk/pokemon-card-detection — OpenCV + PyTorch, detects cards in streamers' pack-opening videos.
- [Thin] luisquint/Pokemon-Card-Detector — https://github.com/luisquint/Pokemon-Card-Detector — OpenCV detect + identify.

**Pattern across all of them** [Consensus]: nobody ships a CNN-embedding matcher; everyone uses ImageHash-style perceptual hashes (sometimes several at once, sometimes multi-orientation) or OCR, against images pulled from pokemontcg.io / pkmncards.com. Reported weak spots are always segmentation quality and glare, never hash lookup speed.

---

## 3. Card image databases / APIs

### 3.1 Pokémon TCG API (pokemontcg.io) — the default choice, with a big caveat

Docs: https://docs.pokemontcg.io/ (rate-limits page: https://docs.pokemontcg.io/getting-started/rate-limits/ , auth page: https://docs.pokemontcg.io/getting-started/authentication/)

- [Verified — docs fetched] **API key optional.** "API requests without authentication won't fail, but your rate limits are drastically reduced." Auth via `X-Api-Key` header; free key from https://dev.pokemontcg.io.
- [Verified — docs fetched, quoted] Rate limits: "By default, requests are limited to 20,000/day" with a key; "If you aren't using an API key, you are rate limited to 1000 requests a day, and a maximum of 30 per minute."
- [Verified — API queried directly 2026-07-29, no key] `GET https://api.pokemontcg.io/v2/cards?pageSize=1` → `"totalCount": 20479` cards; `/v2/sets` → `"totalCount": 174` sets. API is live and answering unauthenticated requests as of today.
- [Verified — PNG headers downloaded and measured] Image resolutions: `images.small` = **245x342 PNG**, `images.large` (`*_hires.png`) = **734x1024 PNG** (e.g. https://images.pokemontcg.io/hgss4/1.png / 1_hires.png). Card JSON also carries set `symbol`/`logo` PNGs, full game data (attacks, rarity, `nationalPokedexNumbers` — handy for the Pokédex read-out), flavor text, and live TCGplayer + Cardmarket prices.
- **CAVEAT — Scrydex transition.** [Verified] https://pokemontcg.io/ now titles itself "Pokémon TCG API - Now part of Scrydex" and links to https://scrydex.com. [Verified — docs fetched] Scrydex is a commercial multi-game API (Pokémon, MTG, Lorcana, Gundam; One Piece/Riftbound beta) requiring API keys with a **credit/quota system** (https://scrydex.com/docs). [Thin — secondary reports] Community chatter says the free pokemontcg.io v2 tier is expected to be wound down in favour of Scrydex (e.g. https://cardgrader.ai/blog/tcgplayer-api-alternatives ; a GitHub issue titled "Pre-Scrydex pokemontcg.io catalog warm — build a comprehensive English-card cache while it's still free", https://github.com/mgzwarrior/mgz-pkmn/issues/368). No official shutdown date found. **Recommendation: bulk-download the card JSON + images we need early in the project, don't depend on the live API at event time.**
- Bulk data: [Verified — repo fetched] https://github.com/PokemonTCG/pokemon-tcg-data (838 stars / 326 forks) = the raw JSON behind the API (`cards/en`, `sets`, decks). JSON only, no image files in the repo. [Thin — not opened file-by-file] The card JSON is the same schema as the API so it should carry the `images.small/large` URLs; verify before relying on it (verification attempt was cut short).

### 3.2 TCGdex (api.tcgdex.net) — the no-key, multilingual alternative

Docs: https://tcgdex.dev/ ; data source repo: https://github.com/tcgdex/cards-database

- [Verified — docs fetched] REST + GraphQL; docs' getting-started makes **no mention of any API key, authentication, or rate limits** ("Every request MUST be GET requests"; JSON responses). Effectively: no key needed. (Absence-of-statement, so treat as [Verified-by-absence]; no rate-limit guarantee exists either.)
- [Verified — API queried directly 2026-07-29] English card catalogue: `GET https://api.tcgdex.net/v2/en/cards` returned **18,826 cards**. Card objects include set info, variants (normal/reverse/holo/1st-ed flags — useful metadata for the holo problem), and TCGplayer+Cardmarket pricing.
- [Verified — homepage fetched] Multilingual: "more than 10 languages" (EN, FR, ES, IT, PT-BR, DE, JA, ZH-Hant, ID, TH listed; search snippets say 14 [Thin]).
- [Verified — assets docs fetched, https://tcgdex.dev/assets] Image URL scheme: card JSON gives an extensionless base URL (e.g. `https://assets.tcgdex.net/en/swsh/swsh3/136`), append `/{quality}.{ext}`: quality `high` = **600x825**, `low` = **245x337**; formats `png` (transparent), `webp` (recommended), `jpg` (black background, "not recommended"). I measured `high.png` at exactly 600x825.
- Note: 600x825 (TCGdex high) vs 734x1024 (pokemontcg.io hires) — both are plenty for perceptual hashing (hashes are computed at 32x32 or smaller); pokemontcg.io is slightly better if we also want to display crisp card art on screen.

### 3.3 Bulk-download options

- [Verified] `PokemonTCG/pokemon-tcg-data` (above) for JSON; images then fetched once from `images.pokemontcg.io` URLs (~20k images; at ~30/min unauthenticated that's slow — get the free key, or download only the sets we'll support at the event).
- [Verified — repo exists] `tcgdex/cards-database` — the entire TCGdex DB is open source on GitHub; assets served from assets.tcgdex.net.
- [Thin] TCGCSV — https://tcgcsv.com/ — daily CSV/JSON dumps of TCGplayer's catalogue (Pokémon = categoryId 3; groups = sets; products carry extendedData with card text/rarity/number). Oriented at pricing/catalogue, not high-res images.
- [Thin] Kaggle dataset "Pokemon TCG - All Card Images" — https://www.kaggle.com/datasets/ellimaaac/pokemon-tcg-all-image-cards — one-shot image dump ("all sets since the beginning"); contents/quality unverified.
- [Thin] PokeFiles — https://pokefiles.com/ — free per-set card image downloads; unverified.

### 3.4 Legal / ToS notes

- [Verified — site footer fetched] pokemontcg.io itself carries the standard fan-project disclaimer: "This website is not produced, endorsed, supported, or affiliated with Nintendo or The Pokémon Company." Its docs impose rate limits but were not observed to grant or restrict downstream *image* rights — the API cannot grant rights it doesn't own.
- [Verified — pokemon.com ToU exists at https://www.pokemon.com/us/legal/terms-of-use] All card artwork is copyright The Pokémon Company/Nintendo; [Thin — search snippet of https://press.pokemon.com/en/Assets-Use-Terms] official press assets are licensed for informational/editorial, non-commercial use only.
- Practical read (analysis, not legal advice): using card images as an **internal matching database** plus on-screen display at a free university outreach event is the same posture as hundreds of fan tools (TCGdex, pkmncards, every scanner above) and low-risk, but the images remain TPC copyright — don't redistribute the image dump publicly, credit "Pokémon and Pokémon TCG are trademarks of Nintendo/Creatures/GAME FREAK/The Pokémon Company", and keep the project non-commercial. [Consensus on community practice; the underlying rights position is [Verified] copyright law basics.]

---

## 4. Robustness under real conditions (live-event relevant)

- **Glare / holo / foil cards are the #1 reported failure mode.** [Verified] TCGplayer's official fix is procedural: tilt the card ~45° to the light or toggle flash — and foil type is *user-selected*, not detected (https://help.tcgplayer.com/hc/en-us/articles/115009674788-Tips-for-Accurate-Scanning). [Verified] hj3yoo's YOLO model failed on "glaring or light variations". [Thin] Dragon Shield users report foils failing/slow. [Thin] Ludex (sports-card scanner) blog: dim/uneven lighting and glare flatten reflective finishes and hurt accuracy (https://www.ludex.com/blog/trading-card-university/how-lighting-affects-trading-card-scan-accuracy-in-ludex/). For Nerdfest: many desirable Pokémon cards are holo — plan diffuse, indirect lighting (light tent / angled LED panel), matte dark backdrop, and let users tilt the card.
- **Background contrast matters more than resolution.** [Verified] TCGplayer: patternless surface contrasting with the card border. [Verified] tmikonen's contour detector nevertheless coped with textured backgrounds; the binarisation threshold is the sensitive part.
- **Sleeves are mostly fine.** [Verified] tmikonen reports sleeved cards work with pHash; [Verified] TCGplayer only asks that the card be centred in its sleeve; [Thin] darker sleeves reportedly scan better than patterned ones.
- **Full card must be visible; occlusion/overlap breaks contour pipelines.** [Verified] hj3yoo ("entire card must be shown without obstruction nor cropping") and tmikonen (overlapping cards fail) — relevant because visitors will hold cards with fingers over edges. Mitigations: a card stand/tray at fixed distance, or a detector tolerant to partial occlusion (YOLO-style), or matching on the artwork window only.
- **Segmentation precision drives hash accuracy.** [Verified] tmikonen: pHash fails if the rectified crop includes too much or too little border. Fix the camera geometry (stand/tray) and this largely disappears.
- **Motion blur:** no primary source found that quantifies it ([Thin] — gap in the research, ran out of time). Standard practice in the video-mode repos (prateekt, hugopeixoto video-detect) is per-frame recognition + temporal voting across frames, which also masks single-frame blur/glare failures. [Consensus by observed design]
- **Speed reality check:** [Verified] contour+pHash runs 7–26 ms/frame on CPU (hj3yoo); YOLO detection alone was 50–60 ms/frame. A live kiosk loop at 15–30 fps with per-frame hashing and multi-frame voting is comfortably achievable on a laptop.
- **Reprint ambiguity (Pokémon-specific):** [Verified] identical artwork recurs across sets; hugopeixoto adds set-symbol template matching as a second stage. For our use case (we only need the *Pokémon*, not the exact printing, to read a Pokédex entry) this ambiguity is actually harmless — a deliberate simplification worth stating in the design doc.

---

## Unverified / cut short

- pokemon-tcg-data JSON confirmed to include `images` URLs — verification request was interrupted; check `cards/en/base1.json` in that repo. [Thin]
- prateekt's benchmark numbers (Google Slides link in its README) not retrieved. [Thin]
- Hugo Peixoto's slides (hugopeixoto.net/talks/identifying-pokemon/slides.pdf → 404) and RustConf talk not watched; any accuracy numbers from the talk unknown. [Thin]
- Scrydex free-tier existence/limits: docs confirm key+credits model; pricing page not fetched. [Thin]
- Delver Lens internals beyond "lambda model, offline": no primary technical disclosure exists publicly. [Thin]

## Headline recommendations for the project

1. Build the matcher as: contour quad detect → perspective rectify → pHash (ImageHash, plus dHash as tiebreak) → Hamming NN over a locally cached image DB; add multi-frame voting. This is the [Consensus] architecture and runs real-time on CPU.
2. Download card JSON + images from **pokemontcg.io v2 now** (free key, 20k req/day; 734x1024 hires) and keep **TCGdex** (no key, 600x825, open-source DB) as fallback — pokemontcg.io's free tier may not outlive the Scrydex transition.
3. Design the physical station around the known failure modes: diffuse lighting, matte contrasting backdrop, card tray at fixed distance, expect holo glare and handle it with temporal voting + a "tilt the card" prompt.
4. The hash-distance distribution (tmikonen's 4-sigma confidence) is itself the seed for the "how the AI recognised it" visualisation.
