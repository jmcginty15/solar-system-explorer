"""Body catalog loader (server-owned JSON)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DATA_PATH = Path(__file__).resolve().parent / "data" / "bodies.json"

_catalog: dict[str, Any] | None = None


def catalog_path() -> Path:
    return _DATA_PATH


def load_catalog(force: bool = False) -> dict[str, Any]:
    """Load bodies.json once. Shape: { bodies: {id: BodyData}, catalogOrder: [id] }."""
    global _catalog
    if _catalog is not None and not force:
        return _catalog
    if not _DATA_PATH.is_file():
        raise FileNotFoundError(
            f"Missing catalog {_DATA_PATH}. Run: npm run export:bodies"
        )
    with _DATA_PATH.open(encoding="utf-8") as fh:
        _catalog = json.load(fh)
    return _catalog


def list_bodies() -> list[dict[str, Any]]:
    data = load_catalog()
    bodies: dict[str, Any] = data["bodies"]
    order: list[str] = data.get("catalogOrder") or list(bodies.keys())
    return [bodies[body_id] for body_id in order if body_id in bodies]


def body_ids() -> list[str]:
    data = load_catalog()
    order: list[str] = data.get("catalogOrder") or list(data["bodies"].keys())
    return list(order)
