"""FastAPI app: ephemeris states + body catalog."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from catalog import body_ids, list_bodies, load_catalog
from kernel_watcher import start_watcher, stop_watcher
from naif_ids import NAIF_ID
from spice_pool import get_pool, init_pool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        load_catalog()
    except FileNotFoundError as exc:
        logger.warning("%s — /api/bodies will be unavailable until export", exc)
    init_pool()
    start_watcher()
    try:
        yield
    finally:
        stop_watcher()


app = FastAPI(title="Solar System Explorer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        pool = get_pool()
    except RuntimeError as exc:
        return {
            "ready": False,
            "error": str(exc),
            "bodyCount": 0,
            "kernelCount": 0,
        }
    try:
        ids = body_ids()
    except FileNotFoundError:
        ids = list(NAIF_ID.keys())
    return {
        "ready": pool.ready,
        "error": pool.error,
        "bodyCount": len(ids),
        "kernelCount": len(pool.loaded_kernels),
        "kernelsRoot": str(pool.kernels_root),
    }


@app.get("/api/ephemeris/states")
def ephemeris_states(
    jd: float = Query(..., description="Julian Date (TT≈TDB, client convention)"),
    ids: str | None = Query(
        None,
        description="Optional comma-separated body ids (default: full catalog)",
    ),
) -> dict[str, Any]:
    try:
        pool = get_pool()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not pool.ready:
        raise HTTPException(
            status_code=503,
            detail=pool.error or "SPICE kernels are not loaded",
        )

    requested: list[str] | None = None
    if ids:
        requested = [part.strip() for part in ids.split(",") if part.strip()]
    else:
        try:
            requested = body_ids()
        except FileNotFoundError:
            requested = list(NAIF_ID.keys())

    states, missing = pool.states_at_jd(jd, requested)
    return {
        "jd": jd,
        "frame": "ICRF_J2000",
        "center": "SSB",
        "states": states,
        "missing": missing,
    }


@app.get("/api/bodies")
def bodies() -> dict[str, Any]:
    try:
        data = load_catalog()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "bodies": list_bodies(),
        "catalogOrder": data.get("catalogOrder")
        or [b["id"] for b in list_bodies()],
    }


@app.post("/api/reload")
def reload_kernels_and_catalog() -> dict[str, Any]:
    """Force-reload SPICE kernels and bodies.json (same as the file watcher)."""
    try:
        pool = get_pool()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        load_catalog(force=True)
    except FileNotFoundError as exc:
        logger.warning("%s", exc)
    pool.load()
    return {
        "ready": pool.ready,
        "error": pool.error,
        "kernelCount": len(pool.loaded_kernels),
        "bodyCount": len(body_ids()) if pool.ready else 0,
    }
