"""Mock backend for Pokedex kiosk frontend development.

Run:
    pip install fastapi uvicorn pillow
    python mock_backend.py

Endpoints:
    GET  /stream   MJPEG, solid red/green/blue frames, colour changes every 1s
    WS   /ws       JSON detection feed with a drifting normalised quad
"""

import asyncio
import io
import json
import math
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image

FRAME_WIDTH = 640
FRAME_HEIGHT = 480
JPEG_QUALITY = 70
STREAM_FPS = 10
COLOUR_HOLD_SECONDS = 1.0
DETECTION_HZ = 10
LOG_EVERY_N_DETECTIONS = 10
QUAD_HALF_WIDTH = 0.18
QUAD_HALF_HEIGHT = 0.26
DRIFT_PERIOD_SECONDS = 8.0
BOUNDARY = "frame"
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

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
)


def log(channel, message):
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] {channel:9} {message}", flush=True)


def encode_solid_frame(rgb):
    image = Image.new("RGB", (FRAME_WIDTH, FRAME_HEIGHT), rgb)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()


FRAMES = [encode_solid_frame(rgb) for _name, rgb in COLOURS]


def current_colour_index():
    return int(time.monotonic() / COLOUR_HOLD_SECONDS) % len(COLOURS)


def current_quad():
    """Four corners, normalised 0-1, clockwise from top-left. Drifts in a circle."""
    phase = (time.monotonic() / DRIFT_PERIOD_SECONDS) * 2 * math.pi
    centre_x = 0.5 + 0.12 * math.cos(phase)
    centre_y = 0.5 + 0.08 * math.sin(phase)
    left = centre_x - QUAD_HALF_WIDTH
    right = centre_x + QUAD_HALF_WIDTH
    top = centre_y - QUAD_HALF_HEIGHT
    bottom = centre_y + QUAD_HALF_HEIGHT
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
