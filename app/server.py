"""FastAPI server exposing the recognition pipeline to the frontend, per the
contract in frontend/docs.md. Routes only ever read the CaptureWorker's
published snapshot (app/capture.py) — never the camera directly.
"""

import asyncio
import json

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

from app.capture import CaptureWorker

ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
BOUNDARY = "frame"
POLL_SECONDS = 0.01


def create_app(worker: CaptureWorker) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Dex-Id"],
    )

    async def mjpeg_frames():
        last_frame_no = None
        while True:
            snap = worker.latest
            if snap is not None and snap.frame_no != last_frame_no:
                last_frame_no = snap.frame_no
                yield (
                    f"--{BOUNDARY}\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(snap.jpeg_bytes)}\r\n\r\n"
                ).encode() + snap.jpeg_bytes + b"\r\n"
            await asyncio.sleep(POLL_SECONDS)

    @app.get("/stream")
    def stream():
        return StreamingResponse(
            mjpeg_frames(),
            media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        )

    @app.get("/normalised")
    def normalised():
        """The crop from the most recent lock, surviving unlock. 404 when
        nothing has ever locked yet, or in figurine mode (no crop concept)."""
        crop_jpeg, dex_id = worker.last_crop()
        if worker.mode == "figurine" or crop_jpeg is None:
            raise HTTPException(status_code=404, detail="No card locked")
        headers = {"X-Dex-Id": str(dex_id)} if dex_id is not None else {}
        return Response(content=crop_jpeg, media_type="image/jpeg", headers=headers)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await websocket.accept()
        last_frame_no = None
        try:
            while True:
                snap = worker.latest
                if snap is not None and snap.frame_no != last_frame_no:
                    last_frame_no = snap.frame_no
                    await websocket.send_text(json.dumps(snap.ws_message))
                await asyncio.sleep(POLL_SECONDS)
        except (WebSocketDisconnect, RuntimeError):
            # This handler only ever pushes (no receive loop to detect a
            # disconnect cooperatively), so a client closing mid-send can
            # surface as a RuntimeError ("... after sending 'websocket.close'")
            # instead of WebSocketDisconnect, depending on timing. Either one
            # means the same thing here: stop pushing to a dead connection.
            return

    return app
