#!/usr/bin/env bash
# Pokedex installer (Linux). Run once, then ./run/start_linux.sh.
#
# Makes sure Docker is installed (asks first), creates .env, downloads the
# card reference images and figurine model weights, builds the images and
# seeds the database. Safe to re-run: finished steps are skipped.

set -euo pipefail
cd "$(dirname "$0")/.."  # this file lives in run/; work from the repo root

say() { echo "[install] $*"; }

ask_yes() {  # ask_yes "question" -> 0 on y/Y
  local reply
  read -rp "$1 [y/N]: " reply
  [[ "$reply" == [yY]* ]]
}

# --- Docker ------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Docker (with the compose plugin) is not installed."
  if ! ask_yes "Install Docker now using the official get.docker.com script (needs sudo)?"; then
    say "Docker is required. Install it yourself (https://docs.docker.com/engine/install/) and re-run."
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    say "curl is needed to fetch the Docker installer - install curl and re-run."
    exit 1
  fi
  curl -fsSL https://get.docker.com | sudo sh
  sudo systemctl enable --now docker 2>/dev/null || true
fi

# Without docker-group membership every docker call needs sudo.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    say "Using sudo for docker. To drop it: sudo usermod -aG docker \$USER, then log out and back in."
  else
    say "The Docker engine isn't running. Start it (sudo systemctl start docker) and re-run."
    exit 1
  fi
fi
compose() { "${DOCKER[@]}" compose "$@"; }

# --- Settings ----------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example."
fi

if ! ls /dev/video* >/dev/null 2>&1; then
  say "WARNING: no webcam found (/dev/video*). Install continues; plug one in before starting."
fi

# --- Data, images, database --------------------------------------------------
say "Downloading card reference images..."
compose --profile setup run --rm cards

say "Building images (the first build takes several minutes)..."
compose --profile backend build

say "Downloading figurine model weights..."
compose --profile setup run --rm weights

say "Seeding the database..."
compose --profile seed run --rm seed
compose stop mongo

echo
say "Done. Start the Pokedex with: ./run/start_linux.sh"
