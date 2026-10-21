# Pokédex Kiosk Frontend: Decisions & Assumptions

## Decisions

### Architecture
- The backend owns the camera and pushes data to the frontend; the browser does no capture.
- The frontend is developed against a self-written mock backend (`mock_backend.py`, FastAPI). Its contract is handed to the backend owners.

### Data channels
| Channel | Transport | Content |
| --- | --- | --- |
| Live video | HTTP MJPEG (`GET /stream`) | Camera frames, `multipart/x-mixed-replace` |
| Detections | WebSocket (`/ws`) | Per-frame JSON "firehose" |

### Frontend (current state of `App.jsx`)
- The live video is shown in an `<img src={STREAM_URL}>` with `object-contain`, not drawn to a canvas.
  - The image can be sent of any resoltion. The assumption when overlaying the quad as mentioned below is that its normalised from 0 to 1 with regards to the image that is sent. This image is automatically scaled to fit the view area by the frontend, dynamically. 
- The quad is drawn as an SVG overlay on top of the `<img>`. The `viewBox` is the stream's natural pixel size (read from `naturalWidth`/`naturalHeight` in `onLoad`), the normalised quad is scaled by it, and `preserveAspectRatio="xMidYMid meet"` letterboxes the SVG exactly as `object-contain` letterboxes the image. This holds for any stream aspect ratio.
  - The frontend expects the coordinates from the backend to be from 0 to 1, where 0 is one corner of the image, 1 is the opposite on both the x and y axis. It then scales this to the image
- A separate full-screen `overlay-canvas` is reserved for the capture animation, this is related to frontend decisions only and does not affect backend.
- Detections are held in a `useDetection` hook (`useState`, one re-render per message) with a fixed 1 s reconnect.
- The confidence bar is driven by `sigma / 6`, not `confidence`.
  - If more statistics could be provided to the frontend in the json firehose then they can be displayed

### Capture flow
1. On pressing Capture, grab the current stream image (draw the `<img>` onto the overlay canvas) and the latest detection JSON, including `dexId`.
2. **At the same moment (or slightly before)**, request `GET /normalised`. This must happen at the press, not mid-animation. This gets the normalised frame of the card to be shown at the end of the animation
3. The animation runs on the overlay canvas. Meanwhile, request `GET /pokemon/{dexId}`. This is handled by the databse guy
4. After the animation, show the normalised image and the Pokémon info.

### Quad overlay contract
- `quad` is four `[x, y]` points, clockwise from top-left, with `x` divided by the streamed frame's width and `y` by its height. Normalisation is done by the **backend**, which knows the exact frame size; the frontend never converts pixels. This normalisation is to 0 to 1 scale as mentioned.
- Coordinates must be relative to the **same frame that is streamed** on `/stream`. If detection ever runs on a resized, cropped or rotated copy, the backend maps the quad back first.
  - The frontend assumes that all incoming data as part of the json is matched with the same frame but is not currently verified, so if a frame arrives late then the quad could become desynced. This was considered a possible non-issue for the current system as its all local/
- The backend clamps every coordinate to 0–1 before sending.
- The quad always describes the **current frame**, including while locked. The lock state is a separate field; it must not freeze the quad.
  - This means the backend has complete control over when, how, and what quad data it wants to send and when. This different to the image that is being sent, detection will be built in to detect when no frames have been sent regardless of quad data.
- Each detection carries `frame` (matching a frame counter on the stream, for later sync) and `frameSize` (`[width, height]`, for checking the frontend's `naturalWidth`/`naturalHeight`).
- `<img object-position>` and the SVG's `preserveAspectRatio` alignment must always match (default: centred / `xMidYMid`).
- Example of expected json can be seen below (the color field should not be implemented and is only there for testing purposes)

```
{"type": "detection", "frame": 363, "phase": "searching", "dexId": 387, "confidence": 0.122, "sigma": 2.89, "quad": [[0.09009484221289812, 0.3722096199573173], [0.27009484221289815, 0.3722096199573173], [0.27009484221289815, 0.6122096199573173], [0.09009484221289812, 0.6122096199573173]], "colour": "green"}
{"type": "detection", "frame": 364, "phase": "searching", "dexId": 387, "confidence": 0.111, "sigma": 2.99, "quad": [[0.09154088746496972, 0.34863451509380233], [0.27154088746496974, 0.34863451509380233], [0.27154088746496974, 0.5886345150938024], [0.09154088746496972, 0.5886345150938024]], "colour": "green"}
{"type": "detection", "frame": 365, "phase": "searching", "dexId": 387, "confidence": 0.103, "sigma": 3.1, "quad": [[0.09538900656302926, 0.3215198939073949], [0.2753890065630292, 0.3215198939073949], [0.2753890065630292, 0.5615198939073949], [0.09538900656302926, 0.5615198939073949]], "colour": "green"}
{"type": "detection", "frame": 366, "phase": "searching", "dexId": 387, "confidence": 0.1, "sigma": 3.22, "quad": [[0.10154143828326487, 0.29483359991379765], [0.28154143828326483, 0.29483359991379765], [0.28154143828326483, 0.5348335999137976], [0.10154143828326487, 0.5348335999137976]], "colour": "green"}
{"type": "detection", "frame": 367, "phase": "searching", "dexId": 387, "confidence": 0.102, "sigma": 3.35, "quad": [[0.11137451755640801, 0.2650094732800483], [0.291374517556408, 0.2650094732800483], [0.291374517556408, 0.5050094732800483], [0.11137451755640801, 0.5050094732800483]], "colour": "green"}

```

### Normalised image
- It is the crop from the recogniser's current lock (`locked.explanation["rectified"]`, 245×337 BGR).
- `GET /normalised` takes no ID and returns whatever the current lock holds.
- Nothing is saved to disk.
- The response carries `X-Dex-Id`; the frontend can compare it with the captured JSON.

### Mock backend (applied)
- `GET /normalised` returns a 245×337 JPEG with an `X-Dex-Id: 387` header. `?fail=1` returns 404.
- `GET /pokemon/{dexId}` returns a static #387 entry and 404 for any other ID.
- The WebSocket sends `dexId: 387` on every message. `colour` is test data only.
- The quad is built from `QUAD_HALF_WIDTH`/`QUAD_HALF_HEIGHT`, both expressed as fractions of the frame **height**, so equal values give a square in pixels at any resolution.
- The quad shrinks uniformly if it can't fit, and the drift (`DRIFT_RADIUS_X`/`_Y`) is clamped so the quad never leaves 0–1. Checked at 640×480, 1920×1080, 1280×1280, 400×1000, 100×1000 and 3000×200.
  - Clamping has been put in place to ensure that the quad does not exceed the image that is displayed. The current implementation would not stop the backend from forcing the quad out of bounds as the backend trusts the data that is sent.

## Assumptions
- The lock race is negligible when `/normalised` is requested at the press: a new lock needs about 10 empty frames plus 6 votes, roughly 1 s.
  - There is a potential race condition here where the user presses the button and then the backend loses the lock, this needs to be tested.
- The captured stream image and the normalised crop do not need to be the same frame; only the `dexId` ↔ crop pairing must be exact.
- A crop taken at lock time is acceptable, because the card sits still in a tray.
- Stream ↔ detection timing drift (about 0–100 ms, bounded) is acceptable for the quad overlay. At 60 fps with fast card movement the box may visibly trail; `frame` exists so this can be fixed later.
- The stream resolution does not change mid-session.

## Known issues in `App.jsx`
- **Stream size is read once.** `onLoad` on an MJPEG `<img>` fires on the first frame only, so a mid-stream resolution change misaligns the overlay until reload. Could be fixed by using `frameSize` from the detection.
- **No clipping to the image.** A quad outside 0–1 draws over the letterbox bars. The real backend's fallback search can produce such quads (see below), so add a `<clipPath>` of `0 0 width height` to the polygon as a guard, even though the backend is required to clamp.
- **Tainted canvas.** The `<img>` has no `crossOrigin`, so drawing it onto the overlay canvas taints it. `getImageData`, `toDataURL` and WebGL use would then throw. Set `crossOrigin="anonymous"` (the CORS headers already exist).
- **Unclosed stream.** The stream is not closed on unmount (set `src` to `''`), so StrictMode can leave an extra connection open.

---

Below are suggested actions based on my understanding of what needs to be done.

## OpenCV / recogniser owner
- Restructure `main.py` from a `cv2.imshow` loop into a server: a capture thread plus FastAPI, served with `uvicorn[standard]`.
- `GET /stream`: MJPEG of the camera frames.
- `/ws`: detection JSON per frame. The fields need agreeing:
    - `type`, `frame`, `frameSize`, `phase` (and its possible values), `confidence`, `sigma`, `quad` (normalised 0–1, clockwise from top-left, or `null`), `dexId`.
    - Drop `colour`.
- `dexId` is `null` for Trainer and Energy cards (empty `dex_ids`). The frontend needs to handle this.
- Quad: changes needed to meet the [quad overlay contract](#quad-overlay-contract). Findings from reading `backend/app/` on `main` (no server code exists on any branch yet):
    - **Pixels, not 0–1.** `card_matcher.py` emits `quad.tolist()` in camera pixels. Divide `x` by `frame.shape[1]` and `y` by `frame.shape[0]` in the adapter.
    - **Out-of-frame quads.** `card_fallback.perturb` scales and shifts candidates; `best_crop` only rejects quads past `-0.25 × max(frame.shape)` on the low side and has no upper bound. `minAreaRect` corners can also fall outside the image. Clamp to 0–1 after normalising.
    - **Frozen quad when locked.** `lock_from` copies the explanation from the locking frame and `main.py` displays `locked` until 10 empty frames, so the quad stops following the card. Send the live frame's quad alongside the lock state.
    - **Payload shape.** `quad` and `sigma` live inside `Identification.explanation`; the WebSocket message has them at the top level. `rectified` is an `np.ndarray` and must not go over the WebSocket (it is served by `GET /normalised`).
      - If there are more statistics that can be displayed please let the frontend know so we can add more fields, the fields are just confidence at the moment which feels bare. 
    - Already correct: corner order (`order_corners` returns TL, TR, BR, BL) and detection runs on the full, unresized captured frame, so normalising by that frame's size is exact provided the same frame is streamed. `kind == "none"` has no `quad`; send `quad: null`.
    - Add `frame` and `frameSize` to each message.
- `GET /normalised`:
    - Return `cv2.imencode('.jpg', crop)` of the last locked crop.
    - Keep that crop in a variable that **survives unlock**, because `locked` clears after 10 empty frames.
    - Add an `X-Dex-Id` header and list it in CORS `expose_headers`.
    - Return 404 when nothing has locked yet, and in figurine mode (which has no crop).
- CORS: allow the frontend origins (`localhost:5173`, `127.0.0.1:5173`).