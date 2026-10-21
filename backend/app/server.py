"""FastAPI server exposing the recognition pipeline to the frontend, per the
contract in frontend/docs.md. Routes only ever read the CaptureWorker's
published snapshot (app/capture.py) — never the camera directly.
"""

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app.capture import CaptureWorker

ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
BOUNDARY = "frame"
POLL_SECONDS = 0.01

# Native runs read the repo's .env; in docker-compose MONGO_URL is already set
# (to the mongo service) and load_dotenv leaves existing variables alone.
# Optional so venvs made before python-dotenv was added keep working.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")  # repo root, above backend/
except ImportError:
    pass
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017/")

try:
    client = MongoClient(MONGO_URL)
    database = client.get_database("PokeVision")
except PyMongoError as e:
    print("An error occurred when connecting to the database")
    print(e)

def pokemonbyid(id: int):
    try:
        collection = database.get_collection("TestingDatabase")
        # the document itself (None if there's no such id); FastAPI turns it into JSON. Returning
        # json.dumps(...) here made the endpoint send a JSON string inside JSON
        return collection.find_one({"_id": id})
    except PyMongoError as e:
        print(e)
        return 0


def create_app(worker: CaptureWorker) -> FastAPI:
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["X-Dex-Id"], )

    async def mjpeg_frames():
        last_frame_no = None
        while True:
            snap = worker.latest
            if snap is not None and snap.frame_no != last_frame_no:
                last_frame_no = snap.frame_no
                yield (f"--{BOUNDARY}\r\n"
                       f"Content-Type: image/jpeg\r\n"
                       f"Content-Length: {len(snap.jpeg_bytes)}\r\n\r\n").encode() + snap.jpeg_bytes + b"\r\n"
            await asyncio.sleep(POLL_SECONDS)

    @app.get("/stream")
    def stream():
        return StreamingResponse(mjpeg_frames(), media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}", )

    @app.get("/normalised")
    def normalised():
        """The crop from the most recent lock, surviving unlock. 404 when
        nothing has ever locked yet, or in figurine mode (no crop concept)."""
        crop_jpeg, dex_id = worker.last_crop()
        if worker.mode == "figurine" or crop_jpeg is None:
            raise HTTPException(status_code=404, detail="No card locked")
        headers = {"X-Dex-Id": str(dex_id)} if dex_id is not None else {}
        return Response(content=crop_jpeg, media_type="image/jpeg", headers=headers)

    @app.get("/Pokemon/{pokemon_id}")
    def read_root(pokemon_id: int):
        pokemon = pokemonbyid(pokemon_id)
        # check the lookup's result, not the id from the url
        if pokemon is None:
            raise HTTPException(status_code=404, detail="The requested item could not be found.")
        elif pokemon == 0:
            raise HTTPException(status_code=500, detail="The server failed to execute the request.")
        else:
            return pokemon

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
