#!/usr/bin/env bash
# Start the mock backend. Creates .venv-mock and installs deps on first run.
set -euo pipefail

VENV_DIR=".venv-mock"
PORT="${PORT:-8000}"

cd "$(dirname "$0")"

if [ -d "$VENV_DIR/Scripts" ]; then
    PY="$VENV_DIR/Scripts/python"
else
    PY="$VENV_DIR/bin/python"
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "creating $VENV_DIR"
    python -m venv "$VENV_DIR"
    if [ -d "$VENV_DIR/Scripts" ]; then
        PY="$VENV_DIR/Scripts/python"
    else
        PY="$VENV_DIR/bin/python"
    fi
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet fastapi "uvicorn[standard]" pillow
fi

echo "stream  http://127.0.0.1:$PORT/stream"
echo "ws      ws://127.0.0.1:$PORT/ws"
exec "$PY" -m uvicorn mock_backend:app --host 127.0.0.1 --port "$PORT" --reload