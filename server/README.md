# Solar System Explorer API

FastAPI + spiceypy service that evaluates bulk ICRF initial states from full
downloaded NAIF kernels and serves the body catalog JSON.

## Endpoints

| Method | Path                        | Description                                       |
| ------ | --------------------------- | ------------------------------------------------- |
| GET    | `/api/health`               | Kernel load status                                |
| GET    | `/api/ephemeris/states?jd=` | Bulk SSB states (m, m/s, ICRF/J2000)              |
| GET    | `/api/bodies`               | Body catalog (texture fields are asset basenames) |

## Local development

From the repo root:

```bash
# once: Python deps (venv recommended)
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt

# once: refresh catalog JSON from src/data/bodies.ts (if you still edit TS)
npm run export:bodies

# start API (default kernels: public/kernels)
npm run dev:api
# or: bash server/run.sh
```

`npm run dev:all` / `dev:api` start the API with uvicorn `--reload` on `server/`
(Python + JSON; `vendor/` ignored). Edits to `naif_ids.py`, `app.py`,
`bodies.json`, etc. restart the process automatically. Set `SSE_API_RELOAD=0`
to disable. New/changed `public/kernels/spk/**/*.bsp` files hot-reload
in-process via the kernel watcher (no process restart; waits until the file
size is stable).

In another terminal:

```bash
npm run dev
```

Or both:

```bash
npm run dev:all
```

Vite proxies `/api` → `http://127.0.0.1:8765` (avoids clashing with anything already on `:8000`). For a remote API set
`VITE_API_BASE_URL` when building the SPA.

## Kernels

- Default root: `public/kernels` (override with `KERNELS_ROOT`).
- At startup the server furnishes `lsk/naif0012.tls` and every `spk/**/*.bsp`
  except anything under `spk/runtime/` (legacy browser aggregate, no longer used).
- A background watcher polls the SPK directory (~2s) and **hot-reloads** kernels
  when `.bsp` files are added/changed/removed — no process restart required.
  It waits until the SPK set is stable across polls so in-progress downloads are
  not furnished half-written. It also reloads `server/data/bodies.json` when
  that file changes.
- Manual reload: `POST /api/reload`
- Do **not** commit multi-GB kernels; mount them as a volume in production.

New bodies still need entries in `server/data/bodies.json` and `server/naif_ids.py`
(and matching client `BodyId` / catalog sync). With `--reload` enabled, those
Python/catalog edits restart the API; the kernel watcher only hot-reloads SPKs.

## Docker

```bash
docker build -f server/Dockerfile -t sse-api .
docker run --rm -p 8000:8000 \
  -e KERNELS_ROOT=/kernels \
  -v /absolute/path/to/kernels:/kernels:ro \
  sse-api
```

The image does not bake kernels in; always mount `KERNELS_ROOT`.
