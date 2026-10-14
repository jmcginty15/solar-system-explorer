#!/usr/bin/env bash
# Start the FastAPI ephemeris server (spiceypy + full NAIF kernels).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/server"

# spiceypy lives in the project venv; fastapi may be in server/vendor (sandbox-friendly install).
export PYTHONPATH="${ROOT}/server/vendor:${PYTHONPATH:-}"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
else
  PY="python3"
fi

# Default port 8765 avoids clashing with Docker / other services on :8000.
PORT="${SSE_API_PORT:-8765}"

# Auto-restart on server code / catalog edits (disable with SSE_API_RELOAD=0).
# SPK *.bsp files are NOT watched here — they hot-reload in-process via kernel_watcher.
RELOAD_ARGS=()
if [[ "${SSE_API_RELOAD:-1}" != "0" ]]; then
  RELOAD_ARGS=(
    --reload
    --reload-dir "$ROOT/server"
    --reload-include "*.py"
    --reload-include "*.json"
    --reload-exclude "**/vendor/**"
    --reload-exclude "**/__pycache__/**"
    --reload-exclude "**/*.py[cod]"
  )
fi

exec "$PY" -m uvicorn app:app --host 127.0.0.1 --port "$PORT" "${RELOAD_ARGS[@]}"
