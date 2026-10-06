"""Mock backend for Pokedex kiosk frontend development.

Run:
    pip install fastapi "uvicorn[standard]" pillow
    python mock_backend.py

Endpoints:
    GET  /stream   MJPEG, solid red/green/blue frames, colour changes every 1s
    WS   /ws       JSON detection feed with a drifting normalised quad
    GET  /normalised          JPEG of the card in the current lock (245x337),
                              X-Dex-Id header. ?fail=1 returns 404 (no lock).
    GET  /pokemon/<dexId>    Static Pokedex entry (stand-in for the MongoDB lookup)
"""


import asyncio
import io
import json
import math
import time
from collections import OrderedDict

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from PIL import Image, ImageDraw, ImageFont

# The below are just placeholder and do not have to exist in the final version
FRAME_WIDTH = 640
FRAME_HEIGHT = 480
JPEG_QUALITY = 70
STREAM_FPS = 10
# set the below to 0.016 to get 60 fps
COLOUR_HOLD_SECONDS = 1.0
# set the below to 60 to simulate the 60 fps
DETECTION_HZ = 10
LOG_EVERY_N_DETECTIONS = 100
QUAD_HALF_WIDTH = 0.12
QUAD_HALF_HEIGHT = 0.12
DRIFT_PERIOD_SECONDS = 8.0
# Max drift of the quad centre from the middle, normalised. Clamped so the quad stays in frame.
DRIFT_RADIUS_X = 0.32
DRIFT_RADIUS_Y = 0.32
BOUNDARY = "frame"
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
CARD_SIZE = (500, 700)  # 5:7 trading-card ratio
MOCK_DEX_ID = 387
GRID_PX = 40  # square cells: if they render as rectangles, the image is stretched

# Stand-in for the MongoDB document. Field names are a proposal for the contract.
POKEDEX = {
    387: {
        "_id": 387,
        "generation": 4,
        "enName": "Turtwig",
        "typings": ["Grass"],  # one or two entries
        "classification": "Tiny Leaf Pokemon",
        "percentMale": 87.5,
        "percentFemale": 12.5,
        "heightM": 0.4,
        "weightKG": 10.2,
        "hp": 55,
        "attack": 68,
        "defense": 64,
        "spAttack": 45,
        "spDefense": 55,
        "speed": 31,
        "description": "Placeholder description text for layout testing. "
                       "Long enough to wrap across a couple of lines in the UI.",
    },
}


COLOURS = [
    ("red", (220, 60, 60)),
    ("green", (70, 170, 80)),
    ("blue", (60, 110, 210)),
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Dex-Id"],
)


def log(channel, message):
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] {channel:9} {message}", flush=True)


def encode_test_frame(rgb, size=(FRAME_WIDTH, FRAME_HEIGHT)):
    w, h = size
    image = Image.new("RGB", size, rgb)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=max(12, min(w, h) // 20))

    # Square grid: cells must look square on screen (catches stretching)
    for x in range(0, w, GRID_PX):
        draw.line([(x, 0), (x, h)], fill=(255, 255, 255), width=1)
    for y in range(0, h, GRID_PX):
        draw.line([(0, y), (w, y)], fill=(255, 255, 255), width=1)

    # Circle: must look round, not oval
    cx, cy, r = w // 2, h // 2, min(w, h) // 3
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 0, 0), width=4)

    # Border: all four edges must be visible (catches cropping)
    draw.rectangle([0, 0, w - 1, h - 1], outline=(255, 255, 0), width=4)

    # Corner labels: catch flips and rotation
    pad = 8
    for text, xy, anchor in (("TL", (pad, pad), "la"), ("TR", (w - pad, pad), "ra"),
                             ("BR", (w - pad, h - pad), "rd"), ("BL", (pad, h - pad), "ld")):
        draw.text(xy, text, fill=(0, 0, 0), font=font, anchor=anchor)
    draw.text((cx, cy), f"{w}x{h}", fill=(0, 0, 0), font=font, anchor="mm")

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()


FRAMES = [encode_test_frame(rgb) for _name, rgb in COLOURS]
NORMALISED_FRAMES = [encode_test_frame(rgb, CARD_SIZE) for _name, rgb in COLOURS]


def current_colour_index():
    return int(time.monotonic() / COLOUR_HOLD_SECONDS) % len(COLOURS)


def current_quad():
    """Four corners, normalised 0-1, clockwise from top-left. Drifts in a circle.

    QUAD_HALF_WIDTH and QUAD_HALF_HEIGHT are both fractions of the frame height,
    so equal values give a square in pixels whatever the frame's aspect ratio.
    """
    phase = (time.monotonic() / DRIFT_PERIOD_SECONDS) * 2 * math.pi
    centre_x = 0.5 + 0.12 * math.cos(phase)
    centre_y = 0.5 + 0.08 * math.sin(phase)
    # x is normalised by width, so rescale the half width into width units
    half_width = QUAD_HALF_WIDTH * FRAME_HEIGHT / FRAME_WIDTH
    half_height = QUAD_HALF_HEIGHT
    # Shrink both sides by the same factor if either won't fit, keeping the shape
    fit = min(1.0, 0.5 / half_width, 0.5 / half_height)
    half_width *= fit
    half_height *= fit
    # Only drift as far as the quad can go without leaving the frame
    centre_x = 0.5 + min(DRIFT_RADIUS_X, 0.5 - half_width) * math.cos(phase)
    centre_y = 0.5 + min(DRIFT_RADIUS_Y, 0.5 - half_height) * math.sin(phase)
    left = centre_x - half_width
    right = centre_x + half_width
    top = centre_y - half_height
    bottom = centre_y + half_height
    return [[left, top], [right, top], [right, bottom], [left, bottom]]


async def mjpeg_frames():
    frame_interval = 1 / STREAM_FPS
    last_colour = None
    log("stream", "client connected")
    try:
        while True:
            index = current_colour_index()
            if index != last_colour:
                log("stream", f"colour -> {COLOURS[index][0]}")
                last_colour = index
            payload = FRAMES[index]
            yield (
                f"--{BOUNDARY}\r\n"
                f"Content-Type: image/jpeg\r\n"
                f"Content-Length: {len(payload)}\r\n\r\n"
            ).encode() + payload + b"\r\n"
            await asyncio.sleep(frame_interval)
    except asyncio.CancelledError:
        log("stream", "client disconnected")
        raise


@app.get("/stream")
def stream():
    return StreamingResponse(
        mjpeg_frames(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
    )


@app.get("/normalised")
def normalised(fail: bool = False):
    """Stand-in for the recogniser's current lock crop."""
    if fail:
        raise HTTPException(status_code=404, detail="No card locked")
    index = current_colour_index()
    log("normalised", f"dexId {MOCK_DEX_ID} ({COLOURS[index][0]})")
    return Response(
        content=NORMALISED_FRAMES[index],
        media_type="image/jpeg",
        headers={"X-Dex-Id": str(MOCK_DEX_ID)},
    )


@app.get("/pokemon/{dex_id}")
def pokemon(dex_id: int):
    entry = POKEDEX.get(dex_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No Pokemon with dexId {dex_id}")
    return entry


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    log("ws", "client connected")
    detection_interval = 1 / DETECTION_HZ
    frame_number = 0

    try:
        while True:
            frame_number += 1
            colour_name = COLOURS[current_colour_index()][0]
            # TODO colour in this response is for TESTING DATA ONLY, remove when transferring to prod
            message = {
                "type": "detection",
                "frame": frame_number,
                "phase": "searching",
                "dexId": MOCK_DEX_ID,
                "confidence": round(0.5 + 0.4 * math.sin(time.monotonic()), 3),
                "sigma": round(3.0 + 1.5 * math.sin(time.monotonic() * 0.7), 2),
                "quad": current_quad(),
                "colour": colour_name,
            }
            await websocket.send_text(json.dumps(message))
            # Every message would be DETECTION_HZ lines a second of noise.
            if frame_number % LOG_EVERY_N_DETECTIONS == 1:
                log("ws", json.dumps(message))
            await asyncio.sleep(detection_interval)
    except WebSocketDisconnect:
        log("ws", f"client disconnected after {frame_number} messages")
        return


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
