#!/usr/bin/env bash
# Run FastAPI ephemeris server + Vite frontend together.
# API auto-reload (code/JSON) and SPK hot-reload come from server/run.sh +
# kernel_watcher — this script just supervises both processes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash server/run.sh &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait until the API answers (kernels can take a bit to furnsh).
PORT="${SSE_API_PORT:-8765}"
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

npm run dev
