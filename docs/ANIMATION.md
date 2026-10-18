# Capture animation: working notes

Handoff context for the "how the Pokédex recognises a Pokémon" animation that plays after the
Capture button is pressed. Written so a fresh session (or a teammate) can pick up the ongoing
polish work without re-reading the history.

## What it is, and what it isn't

- A **teaching animation of a generic convolutional image classifier**, not a depiction of our own
  recognisers. That was a deliberate decision: the card lane is perceptual hashing (no neural net)
  and the figurine lane is DINOv2 + nearest neighbour, neither of which matches the story. The
  goal is to explain vision models in general to a lay audience.
- Accuracy points we've kept on purpose:
  - Early layers don't guess. Only the last ("parts") station is tied to the top guesses; edges,
    curves and shapes stations use pattern colours.
  - A caption notes "we named the stations; the model has no names for them".
- Scores shown come from the live WebSocket `top5` at the moment of capture (empty if the card
  isn't detected in that frame and nothing is locked). The user is fine with that.

## Files

| File | Role |
|---|---|
| `frontend/src/capture/recognitionAnimation.js` | Everything: timeline, three.js scene, belt, workers, camera, DOM overlay. ~1,600 lines. |
| `frontend/src/capture/recognitionAnimation.css` | Overlay styles (`.cap-*`), including the `.cap-debug` frame counter. |
| `frontend/src/capture/CaptureAnimation.jsx` | React wrapper; mounts `playCaptureAnimation` when `capture` is set. |
| `frontend/src/App.jsx` → `capturePokemon()` | Grabs the stream frame, **awaits** `/normalised`, starts the animation; the dex info (`/Pokemon/{id}`, MongoDB) is passed as a **promise** so a slow DB doesn't delay the start. |

## Debugging workflow (how the user gives feedback)

- `DEBUG = true` near the top of `recognitionAnimation.js` shows a green counter
  (`frame N  t Xs  step N  paused`) over everything, and enables keys:
  **Space** pause/resume, **← / →** step one frame, **Shift + ← / →** step one second.
- Frame number = `t × 60`; playback is time-based and every visual is a pure function of `t`,
  so scrubbing backwards is exact. Keep it that way (no state accumulated across frames).
- The user screenshots paused frames, draws on them, and pastes them in. Map their frame/time
  to the timeline constants below. Set `DEBUG = false` before any demo.
- With `DEBUG` on, a **dither slider** sits under the counter and changes the dither live (copy
  the value you like into `DITHER`). Arrow keys move the slider, not the frame, while it's focused.
- Verify changes with `npx vite build` in `frontend/` (there's no visual test). `npx eslint` on
  this file fails to parse `??` (pre-existing config issue), so don't rely on it.
- **Visual checks are the user's job**: they said not to take screenshots to check work (17 Oct
  2026). Verify with `npx vite build` and hand over; they'll screenshot and annotate. Only if they
  ask for it, this recipe works: make a throwaway
  `frontend/preview-tmp/index.html` that imports `/src/capture/recognitionAnimation.js`, draws a
  stand-in photo on a canvas, calls `playCaptureAnimation(document.body, {frame, normalised: frame,
  scores: [...], onClose() {}})`, then on the next animation frame dispatches a Space keydown
  (pause) and N Shift+ArrowRight keydowns (step N seconds). Run `npx vite --port 5199` and
  screenshot with headless Chrome:
  `chrome.exe --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader
  --window-size=1280,720 --virtual-time-budget=5000 --screenshot=out.png
  "http://localhost:5199/preview-tmp/index.html?t=33"`.
  Then read the PNG. Stop the server and delete `preview-tmp` afterwards; never leave it in the repo.
  Web fonts may not have loaded in time for canvas text in these shots (they fall back to Atkinson).

## Structure of `recognitionAnimation.js`

Top of file, in order:

1. **`TIMING`**: one entry in seconds per moving part *and* per pause. Each phase starts where the
   previous one ends via `span(start, len)`, so changing one value shifts everything after it.
   Derived phase constants (`CAM_IN`, `SHUTTER`, `EJECT`, `CAM_FADE`, `FLIP`, `CROP`, `CHAN_T`,
   `SPLIT`, `NORM`, `MERGE`, `DROP`/`LAND`, `STOPS[]`, `DESK_T`, `VOTE_CAM`, `COUNT`, `VOTE_END`,
   `RETURN`, `SCORES_T`, `BARS`, `RESULT`, `END`) are what the render code uses. `STEPS` holds the
   caption text per step.
2. **Look** (see "Visual theme" below for the rules behind it):
   - `PAL`: the 32-colour palette (DawnBringer 32), by name. Every colour comes from here.
   - `ADJUSTED`: the only colours added on top of `PAL`, with the user's permission: darkened
     shades for the factory floor so the workers and belt stand out. Named after the `PAL` colour
     they come from (`seaDark`, …).
   - `PIXEL` (screen pixels per rendered pixel; 1 turns the pixel look off), `PALETTE_LOCK` (the
     post pass that snaps every pixel of the 3D scene to `PAL` + `ADJUSTED`) and `DITHER` (4×4
     ordered-dither strength for that snap). The user set `PIXEL = 2`, `DITHER = 0.05`.
   - `FONT`: the pixel font (Silkscreen) for text drawn into canvases in the scene. Canvas text
     goes through `textTexture()`, which redraws once the web font has loaded.
3. **Scene constants**: photo/plane sizes (`PHOTO`, `PLANE`, `GROW`), colours (`LCOL` per station,
   `GUESS_COL` per top guess, which also colours the score bars), the instant camera, belt
   geometry (`FLOOR = -9`, the belt stage sits far below the photo), `STATION_X`, `START_X`,
   `DESK_X`, `SHEET_SCALES`, `STROKE_W`, belt camera (`CAM_EL`, `CAM_YAW`, `CAM_FOV`), vote camera
   (`CAM_VOTE_EL`, `VOTE_FRAME`), `FLOOR_FADE` / `FLOOR_FADE_SOFT` (oval floor fade), `SECTION_NAMES`,
   `SECTION_FLOOR` / `SECTION_BADGE` / `FLOOR_GRID` / `TAPE_COL` (the dimmed floor colours),
   `LAMP_H`, `TAPE`, worker look (`WORKER_SCALE`, `SKIN`, `OUTFITS`, `HAT`,
   `FOREMAN_HAT`, `INK` for outlines, `WORKER_LIGHT` for how the lamps light them).
4. **Helpers**: `cutout()` (flat alpha-to-coverage planes for the 2.5D workers), `makeWorker()`
   (detached body/head/hands/feet; the pencil hand is separate so it can reach the sheet; the
   foreman has a clipboard), `makeStrokes()` (the marks are derived from the captured image:
   Sobel edges, randomised curves, busy-region shapes, and parts boxes shared between guesses by
   score via `shareOut`).
5. **`playCaptureAnimation()`**: builds the DOM and scene, then `render(t)` sets everything for time
   `t`. Key pieces inside:
   - `placeCamera(t, sheetX)`: blends front view → belt view (`k`, over `DROP`, back over
     `RETURN`) → vote close-up (`v`, over `VOTE_CAM`). The belt view is a narrow-FOV perspective
     to look near-orthographic.
   - `sheetAt(t)`: belt motion. The sheet crawls slowly through each station (`CRAWL`) and rushes
     between them (`TRAVEL`).
   - `drawSheet(t)`: redraws the sheet canvas (dots + partial strokes) from `t` each frame.
   - The section block: per-section floor tint, painted name, hazard tape (floor + both belt
     sides), belt seams with the edge rails broken to match, and overhead lamps (additive cones and
     light pools, `renderOrder 5`). Everything floor-level is in the `fading` list (fades in during
     the drop, out at the end of the return), and floor paint uses the `oval()` shader patch.
   - Votes: sprites flying from the parts boxes to just in front of the clipboard (`depthTest`
     off). The foreman's speech-bubble lines are in `lines` (timed to votes landing).
   - Palette pass: `sceneTarget` (low-res render target) → `palPass` (full-screen quad whose
     shader picks the nearest colour from `snapTo` = `PAL` + `ADJUSTED`, "redmean" distance, Bayer
     dither). `render(t)` ends by drawing the scene into the target, then the pass to the canvas.
     The canvas is stretched with CSS `image-rendering: pixelated` (`.pixelated` class).
   - `lampLit(mat)`: shader patch on every worker material (applied in `addWorker`). Brightness
     comes from the pixel's world position: near a lamp (`lampXZ`) and high up = bright.
   - `oval(mat)`: shader patch that fades floor paint out in an oval around the belt.

## The story, in order

Instant camera pops in → flash → photo slides out of the slot face down → camera fades → photo
flips into place → crop box → photo becomes three BGR dot planes that split apart → resize and
normalise (planes shrink to 60%, greyed, every other dot) → planes merge back → camera drops and
swings round to the 2.5D factory floor while the dots become the sheet → belt carries the sheet
through EDGES, CURVES, SHAPES and PARTS (four workers each; at PARTS each worker is one top guess,
with a pen in that guess's colour) → foreman counts the votes ("Right!", "1…" to "6…",
"…149, 150, 151!", "Gotta count 'em all!") → camera returns to the front → score bars → normalised
image rises up with its name.

## Visual theme (Pokémon / GBA retheme, October 2026)

The user asked for a Pokémon-inspired look on a dark background, limited to a palette they
supplied (DawnBringer 32, now `PAL`). Their mood board: type badges (pill shapes, outlined
spaced-out lettering), Game Boy controls, the FireRed/LeafGreen PC-box and summary screens (panels
with thick borders and title bars, HP bars), purple/indigo night pixel art, and the Haunter and
Snorlax posters (grid backgrounds; "it doesn't have to be all pixellated"). They like the
construction workers but said that's open to change.

What the retheme did, all as restyles of parts that already existed:

- Whole 3D scene rendered low-res and palette-locked with dithering (see Look above).
- Instant camera painted like a Poké Ball; the photo's back is a trading-card back with a Poké Ball.
- Square "pixel" dots on the channel planes and the sheet; sprite-style black outlines on marks,
  workers, votes and the speech bubble instead of glows.
- Workers: Poké Ball hard hats, Master Ball for the foreman, brown boots, palette skin and clothes.
  Lit by the lamps (`WORKER_LIGHT`; `top` above ~1.1 pushes brown skin to red).
- Floor: dimmed (`ADJUSTED`) so the belt and workers are the focus. Section names are painted as
  type badges (EDGES ice, CURVES grass, SHAPES electric, PARTS psychic, THE VOTE normal). Floor tape
  is dimmed; the tape up the belt sides stays full yellow on purpose.
- Speech bubble is a game dialog box (white, black/blue/black border, grey text with a shadow).
- Overlay (CSS): GBA menu panels with title bars, step progress as blocks, scores as HP bars,
  pill buttons after the type badges, "Show data" on a dark green handheld screen. Result name is
  on a name plate sprite (the old plain text was unreadable once pixelated).
- Fonts: Silkscreen for headings, labels, buttons and in-scene text; Atkinson Hyperlegible for
  body text and numbers. Pixelify Sans was tried and dropped: at caption size "C" read as "O",
  "5" as "S", and "fi" ligated into "A".

Rules for further theming work:

- **Only `PAL` colours.** New colours only with the user's say-so, and then go in `ADJUSTED`,
  named after their source colour. Anything not in `PAL` + `ADJUSTED` gets snapped away by the
  palette lock anyway (CSS isn't snapped, so keep CSS colours on-palette by hand, with a comment
  naming the colour).
- **Remix, don't add.** The user said not to add new steps or new elements, only restyle what's
  there, unless they ask.
- Watch readability after pixelation: small canvas text in the scene needs to be big or on a
  plate to survive `PIXEL`.
- **Snapping also affects the photo** and channel planes, so adding colours to `ADJUSTED` changes
  them slightly too.

## User preferences and working conventions

- Editing tool quirk: the Edit tool sometimes refuses exact matches in these CRLF files right after
  they've changed on disk. A small Python find-and-replace (read/write with `newline=''`, map `
`
  to the file's line ending, assert one match) works reliably.
- **Never commit** (the user said so explicitly for this work). Leave changes in the working tree;
  only provide a commit message if asked.

- **Ask instead of guessing** when a note is ambiguous. The user said so explicitly.
- The user tunes values themselves (they've edited `TIMING`, the foreman's lines and the tape
  colours). **Re-read the current values before editing**; don't overwrite their tweaks.
- Feedback arrives as annotated screenshots with frame numbers. Reply with what changed and which
  constant controls it.
- The user commits themselves. When asked, provide a commit message in their style: a short title
  line, then `- ` bullet lines in plain language (see `git log`).
- **IntelliJ caveat**: the file is usually open in the IDE. If the IDE warns about "file system vs
  memory", the user should *Load File System Changes*. Keeping the in-memory copy once wiped the
  file. After big edits, grep for a few markers to confirm the disk copy is whole.
- Line endings: the repo stores both files as LF (`text=auto`); the working copies are CRLF. Keep
  whatever the working copy has (the CSS was converted back to CRLF after a full rewrite). Diffs
  that look identical are usually just line endings.
- The user often edits the file in the IDE while a session is running ("file modified on disk"
  warnings). Re-read the area before every edit.

## Open items

- **Pokédex zoom (18 Oct 2026, uncommitted, not yet checked by the user)**: main's new UI mounts the
  animation inside the Pokédex `.screen`. `.cap-stage` is now `position: absolute` (fills the
  screen). On capture, `useScreenZoom` in `App.jsx` measures a 16:9 box centred in the
  camera feed (`.anim-slot`, where the animation plays; the confidence panel stays beside it) and
  scales and moves the `.shell` with a CSS transform until that box covers the window, over `ZOOM_SECONDS` (exported from
  `recognitionAnimation.js` = `CAM_FADE[1]`, the camera part of the animation), stays zoomed until
  close, then zooms out. Main's `.crt` scanlines sit above the animation (z-index 60) and scale
  with the zoom. While busy (capture pressed until the zoom-out ends) the foot buttons are
  `disabled` and the screens are `inert`. `layoutResult()` divides page measurements by the zoom.
  Everything in the animation, text included, appears enlarged by the zoom (about 1.6x); `PIXEL`
  may need retuning. The `max-aspect-ratio` media query in the CSS still looks at the window, not
  the screen.

- **Sheet shrinking**: the sheet shrinks at each station (`SHEET_SCALES`, 100% → 71%) to mirror
  feature maps getting smaller. The user called it "weird"; I asked whether to keep it, soften it
  or remove it, and that's still unanswered.
- **Hazard tape**: the stripe texture was just rewritten to be seamless (`TAPE_PX`, `BAND`, `SLANT`).
  The user hasn't seen it yet.
- **Recent untested changes**: the vote timing (votes wait for the camera, counts at 85% of each
  flight, `countLine` and `jokeLine`), and the cable and floor fade-out at the end of the return.
- **Retheme state**: committed by the user (`07cb801`, `30d59eb`). Offered but not taken up: making the floor tape match
  the belt-side tape (`sideTape` → `TAPE_COL`), and keeping the photo snapped to `PAL` only rather
  than `PAL` + `ADJUSTED`.
- **Fixes from the user's 17 Oct review, uncommitted and waiting for their check**:
  - Floor layers drew in the wrong order (grid over the tape and badges). Now fixed with
    `renderOrder`: section colour -1, grid 0, tape 1, badge 2, worker shadows 3, lamp light 5.
  - Uniforms: shirt and overall colours were mixed independently, giving orange on green and a
    "minion" yellow on blue. Now fixed pairs in `OUTFITS` (five, against four skin tones).
  - Result: the card starts rising `TIMING.resultAfterBars` (1s) after the bars start filling
    (was after they finished; replaces `beforeResult`). `END` waits for whichever finishes last.
  - Result layout: `layoutResult()` centres the card and name plate as one group in the free space
    (left of the scores panel, between caption and buttons; across the width when the panel is at
    the bottom), measured from the DOM on resize and on each step change. Replaces the fixed
    `stageX` guesses. `PLATE_GAP` = card top to plate middle. The plate is centred over the card.
  - Name plate: Silkscreen's `%` read oddly, so the `%` alone is drawn in Atkinson.
  - Scores panel: rows share one grid (`.cap-rows`, rows are `display: contents`) so the name
    column fits the longest name; panel widened to `min(400px, 40vw)`.
- The user mentioned "more things" planned after this core polish; nothing specific yet.

## Future idea: "How does it actually see?" FAQ page

A separate FAQ page with simple drawings, to sit alongside the animation. The animation stays a
general picture of vision models; the FAQ says how *our* recognisers really do it, and how big
general-purpose AI models do it, so nobody leaves thinking the belt is literally what runs.

Material to draw from, as of October 2026:

- **Our card lane** (`app/recognisers/card_matcher.py`): no neural network. It finds the card's
  outline, flattens it to a straight-on 245×337 image, turns it greyscale, and makes a 64-bit
  fingerprint of it two ways (pHash: coarse frequency pattern; dHash: is each pixel brighter than
  its neighbour). It then counts how many bits differ from every card in the database and picks
  the closest, accepted only if it's close enough and clearly ahead of the next card. Several
  frames vote, and a final SIFT keypoint check confirms the match.
- **Our figurine lane** (`app/recognisers/figurine_knn.py`): a frozen DINOv2 vision transformer,
  never trained on Pokémon, turns the cropped photo into 384 numbers. Those are compared against
  stored reference photos of the actual event figurines, and the nearest match wins. Adding a
  figurine means adding photos, not retraining.
- **Large AI models (Claude, ChatGPT and similar)**: generally transformer-based. The image is cut
  into small square patches that all "compare notes" with each other through attention, and the
  result is fed into a language model that can talk about it. That's a description of the field in
  general; exact details of any particular product aren't public, so the FAQ should keep it general.
- **The animation (classic CNN)**: small pattern-spotters slide over the image, layers build from
  edges to parts, and the last layer gives a score per answer.

Possible drawings: a "fingerprint matching" strip for cards, a "find the most similar photo" strip
for figurines, a "patches talking to each other" grid for transformers, and a pointer back to the
conveyor belt for CNNs.
