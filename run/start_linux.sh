#!/usr/bin/env bash
# Pokedex launcher (Linux). Run ./run/install_linux.sh once first.
#
# Starts mongo, the frontend and the backend (webcam passed through) as three
# containers. Frontend: http://localhost:5173  Backend: :8000
#
#   ./run/start_linux.sh          ask for mode + camera, then start (Ctrl+C stops)
#   ./run/start_linux.sh down     stop and remove the containers (DB data is kept)
#   ./run/start_linux.sh logs     follow logs

set -euo pipefail
cd "$(dirname "$0")/.."  # this file lives in run/; work from the repo root

if [ ! -f .env ]; then
  echo "[start] No .env found - run ./run/install_linux.sh first."
  exit 1
fi

DOCKER=(docker)
docker info >/dev/null 2>&1 || DOCKER=(sudo docker)
compose() { "${DOCKER[@]}" compose --profile backend "$@"; }

case "${1:-}" in
  down) compose down; exit ;;
  logs) compose logs -f; exit ;;
esac

# defaults for the prompts come from .env
set -a; . ./.env; set +a
MODE=${MODE:-card}
CAMERA_DEVICE=${CAMERA_DEVICE:-/dev/video0}

echo "============================================"
echo " Pokedex launcher"
echo "============================================"
echo "  1) card mode"
echo "  2) figurine mode"
default_choice=1; [ "$MODE" = figurine ] && default_choice=2
read -rp "Select a mode [$default_choice]: " choice
case "${choice:-$default_choice}" in
  2) MODE=figurine ;;
  *) MODE=card ;;
esac

echo "Cameras: $(ls /dev/video* 2>/dev/null | tr '\n' ' ')"
read -rp "Camera device [$CAMERA_DEVICE]: " camera
CAMERA_DEVICE=${camera:-$CAMERA_DEVICE}

if [ ! -e "$CAMERA_DEVICE" ]; then
  echo "[start] $CAMERA_DEVICE not found."
  exit 1
fi

echo
echo "[start] mode=$MODE camera=$CAMERA_DEVICE"
echo "[start] Open http://localhost:5173 once the backend is up. Ctrl+C stops."
echo
MODE=$MODE CAMERA_DEVICE=$CAMERA_DEVICE compose up
