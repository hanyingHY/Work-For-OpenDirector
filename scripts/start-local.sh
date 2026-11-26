#!/usr/bin/env bash
# One-command local launcher for OpenDirector v0.5 Studio (macOS / Linux).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

API_PORT="${OPENDIRECTOR_API_PORT:-8000}"
WEB_PORT="${OPENDIRECTOR_WEB_PORT:-5173}"

echo ""
echo "=== OpenDirector v0.5 Studio · Local Launcher ==="

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 (3.11+) is required." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: Node.js / npm (22+) is required." >&2
  exit 1
fi

VENV_PY="$REPO_ROOT/.venv/bin/python"
if [ ! -x "$VENV_PY" ]; then
  echo "[1/4] Creating Python virtual environment (.venv)..."
  python3 -m venv .venv
fi

echo "[2/4] Verifying Python backend dependencies..."
if ! "$VENV_PY" -c "import fastapi, uvicorn, pydantic" >/dev/null 2>&1; then
  echo "      Installing backend packages (first run only)..."
  "$VENV_PY" -m pip install --upgrade pip
  [ -f requirements.txt ] && "$VENV_PY" -m pip install -r requirements.txt
  "$VENV_PY" -m pip install -e packages/core -e apps/api
fi

if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x "$HOME/bin/ffmpeg" ]; then
  if ! "$VENV_PY" -c "import imageio_ffmpeg" >/dev/null 2>&1; then
    echo "      FFmpeg not found on PATH — installing imageio-ffmpeg automatically..."
    "$VENV_PY" -m pip install imageio-ffmpeg
  fi
fi

if [ ! -d "$REPO_ROOT/node_modules" ]; then
  echo "[3/4] Installing frontend dependencies (npm install)..."
  npm install
else
  echo "[3/4] Frontend node_modules ready."
fi

export PYTHONPATH="$REPO_ROOT/packages/core/src:$REPO_ROOT/apps/api/src"
export PATH="$HOME/bin:$PATH"

echo "[4/4] Starting API server on http://127.0.0.1:$API_PORT and Studio on http://127.0.0.1:$WEB_PORT ..."
"$VENV_PY" -m opendirector_api.server --port "$API_PORT" &
API_PID=$!

cleanup() {
  echo ""
  echo "Stopping OpenDirector API server (PID $API_PID)..."
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Error: API server exited unexpectedly." >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:$API_PORT/api/desktop/runtime-health" >/dev/null 2>&1; then
    echo "      API healthy on http://127.0.0.1:$API_PORT"
    break
  fi
  sleep 0.5
done

echo ""
echo "OpenDirector v0.5 Studio is running -> http://127.0.0.1:$WEB_PORT"
echo "Press Ctrl+C to stop both frontend and backend."
echo ""

npm run dev -- --host 127.0.0.1 --port "$WEB_PORT"
