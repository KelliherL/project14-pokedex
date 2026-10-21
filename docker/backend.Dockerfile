# Backend: capture thread + FastAPI on :8000. Needs the host webcam passed in
# as /dev/video0 and ./data mounted at /app/data (see docker-compose.yml) —
# Linux hosts only.
FROM python:3.12-slim

# opencv-python (not -headless) needs libGL even for import
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU wheels explicitly: the default index serves the CUDA build of torch
# (~2 GB). Installing it first satisfies the requirement for the main install.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
# data/ is not baked in: docker-compose.yml mounts ./data at /app/data

ENV MODE=card PYTHONUNBUFFERED=1
EXPOSE 8000

# shell form so $MODE expands
CMD python -m app.main --host 0.0.0.0 --port 8000 --camera 0 --mode "$MODE"
