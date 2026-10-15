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
- Verify changes with `npx vite build` in `frontend/` (there's no visual test). `npx eslint` on
  this file fails to parse `??` (pre-existing config issue), so don't rely on it.

## Structure of `recognitionAnimation.js`

Top of file, in order:

1. **`TIMING`**: one entry in seconds per moving part *and* per pause. Each phase starts where the
   previous one ends via `span(start, len)`, so changing one value shifts everything after it.
   Derived phase constants (`CAM_IN`, `SHUTTER`, `EJECT`, `CAM_FADE`, `FLIP`, `CROP`, `CHAN_T`,
   `SPLIT`, `NORM`, `MERGE`, `DROP`/`LAND`, `STOPS[]`, `DESK_T`, `VOTE_CAM`, `COUNT`, `VOTE_END`,
   `RETURN`, `SCORES_T`, `BARS`, `RESULT`, `END`) are what the render code uses. `STEPS` holds the
   caption text per step.
2. **Scene constants**: photo/plane sizes (`PHOTO`, `PLANE`, `GROW`), colours (`LCOL` per station,
   `GUESS_COL` per top guess, which also colours the score bars), the instant camera, belt
   geometry (`FLOOR = -9`, the belt stage sits far below the photo), `STATION_X`, `START_X`,
   `DESK_X`, `SHEET_SCALES`, `STROKE_W`, belt camera (`CAM_EL`, `CAM_YAW`, `CAM_FOV`), vote camera
   (`CAM_VOTE_EL`, `VOTE_FRAME`), `FLOOR_FADE` / `FLOOR_FADE_SOFT` (oval floor fade), `SECTION_NAMES`,
   `LAMP_H`, `TAPE`, worker look (`WORKER_SCALE`, `SKIN`, `SHIRT`, `OVERALLS`, `HAT`).
3. **Helpers**: `cutout()` (flat alpha-to-coverage planes for the 2.5D workers), `makeWorker()`
   (detached body/head/hands/feet; the pencil hand is separate so it can reach the sheet; the
   foreman has a clipboard), `makeStrokes()` (the marks are derived from the captured image:
   Sobel edges, randomised curves, busy-region shapes, and parts boxes shared between guesses by
   score via `shareOut`).
4. **`playCaptureAnimation()`**: builds the DOM and scene, then `render(t)` sets everything for time
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

## The story, in order

Instant camera pops in → flash → photo slides out of the slot face down → camera fades → photo
flips into place → crop box → photo becomes three BGR dot planes that split apart → resize and
normalise (planes shrink to 60%, greyed, every other dot) → planes merge back → camera drops and
swings round to the 2.5D factory floor while the dots become the sheet → belt carries the sheet
through EDGES, CURVES, SHAPES and PARTS (four workers each; at PARTS each worker is one top guess,
with a pen in that guess's colour) → foreman counts the votes ("Right!", "1…" to "6…",
"…149, 150, 151!", "Gotta count 'em all!") → camera returns to the front → score bars → normalised
image rises up with its name.

## User preferences and working conventions

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
- The file is LF; the CSS is CRLF. Diffs that look identical are usually just line endings.

## Open items

- **Sheet shrinking**: the sheet shrinks at each station (`SHEET_SCALES`, 100% → 71%) to mirror
  feature maps getting smaller. The user called it "weird"; I asked whether to keep it, soften it
  or remove it, and that's still unanswered.
- **Hazard tape**: the stripe texture was just rewritten to be seamless (`TAPE_PX`, `BAND`, `SLANT`).
  The user hasn't seen it yet.
- **Recent untested changes**: the vote timing (votes wait for the camera, counts at 85% of each
  flight, `countLine` and `jokeLine`), and the cable and floor fade-out at the end of the return.
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
