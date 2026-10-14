"""Thread-safe spiceypy kernel pool for SSB-centered state lookups."""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

import spiceypy as sp

from naif_ids import NAIF_FALLBACKS, NAIF_ID

logger = logging.getLogger(__name__)

JD_J2000 = 2451545.0
S_PER_DAY = 86_400.0
KM_TO_M = 1_000.0


def julian_date_to_et(jd: float) -> float:
    """Julian Date (TT≈TDB, matching the client) → SPICE ET seconds past J2000."""
    return (jd - JD_J2000) * S_PER_DAY


@dataclass
class SpicePool:
    kernels_root: Path
    ready: bool = False
    error: str | None = None
    loaded_kernels: list[str] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def load(self) -> None:
        """Clear and furnish LSK + every SPK under kernels_root/spk (except runtime/)."""
        with self._lock:
            previous = list(self.loaded_kernels)
            try:
                lsk = self.kernels_root / "lsk" / "naif0012.tls"
                bundled_lsk = Path(__file__).resolve().parent / "bundled-kernels" / "lsk" / "naif0012.tls"
                if not lsk.is_file():
                    if bundled_lsk.is_file():
                        lsk = bundled_lsk
                        logger.warning("Using bundled LSK (volume missing %s)", self.kernels_root / "lsk" / "naif0012.tls")
                    else:
                        raise FileNotFoundError(f"Missing LSK: {lsk}")

                spk_dir = self.kernels_root / "spk"
                if not spk_dir.is_dir():
                    raise FileNotFoundError(f"Missing SPK directory: {spk_dir}")

                spk_paths = [
                    path
                    for path in sorted(spk_dir.rglob("*.bsp"))
                    # Skip the old browser runtime Type-9 aggregate.
                    if "runtime" not in path.parts
                ]
                if not spk_paths:
                    raise FileNotFoundError(f"No .bsp files under {spk_dir}")

                sp.kclear()
                loaded: list[str] = []

                sp.furnsh(str(lsk))
                # Record a stable relative name even when using the bundled LSK.
                loaded.append("lsk/naif0012.tls")

                skipped = 0
                for path in spk_paths:
                    try:
                        sp.furnsh(str(path))
                    except Exception:  # noqa: BLE001 — one bad/partial SPK must not wipe the pool
                        skipped += 1
                        logger.exception("Skipping unloadable SPK %s", path)
                        continue
                    loaded.append(str(path.relative_to(self.kernels_root)))

                self.loaded_kernels = loaded
                self.ready = True
                self.error = None
                logger.info(
                    "Loaded %d kernels from %s%s",
                    len(self.loaded_kernels),
                    self.kernels_root,
                    f" (skipped {skipped})" if skipped else "",
                )
            except Exception as exc:  # noqa: BLE001 — surface via /api/health; do not kill the process
                self.ready = False
                self.error = str(exc)
                logger.exception("Failed to load SPICE kernels")
                # Best-effort restore so a failed reload doesn't leave SPICE empty.
                if previous:
                    try:
                        sp.kclear()
                        for rel in previous:
                            sp.furnsh(str(self.kernels_root / rel))
                        self.loaded_kernels = previous
                        self.ready = True
                        self.error = None
                        logger.warning(
                            "Restored previous kernel set (%d files) after load failure",
                            len(previous),
                        )
                    except Exception:  # noqa: BLE001
                        logger.exception("Failed to restore previous kernel set")
                        self.loaded_kernels = []
                # Leave ready=False so the app can still boot (e.g. empty Fly volume)
                # and accept SSH / POST /api/reload once kernels are copied in.

    def states_at_jd(
        self,
        jd: float,
        body_ids: list[str] | None = None,
    ) -> tuple[dict[str, dict], list[str]]:
        """
        Return (states, missing) for the requested bodies at Julian date `jd`.

        Each state is ICRF/J2000 relative to SSB, SI units (m, m/s).
        """
        if not self.ready:
            raise RuntimeError(self.error or "SPICE kernels are not loaded")

        targets = body_ids if body_ids is not None else list(NAIF_ID.keys())
        et = julian_date_to_et(jd)
        states: dict[str, dict] = {}
        missing: list[str] = []

        with self._lock:
            for body_id in targets:
                naif = NAIF_ID.get(body_id)
                if naif is None:
                    missing.append(body_id)
                    continue
                ids_to_try = [naif]
                fallback = NAIF_FALLBACKS.get(body_id)
                if fallback is not None:
                    ids_to_try.append(fallback)

                got = None
                last_err: Exception | None = None
                for target in ids_to_try:
                    try:
                        state, _ = sp.spkgeo(target, et, "J2000", 0)
                        got = state
                        break
                    except Exception as exc:  # noqa: BLE001 — per-body soft fail
                        last_err = exc
                if got is None:
                    logger.warning(
                        "SPK state failed for %s (NAIF %s): %s",
                        body_id,
                        naif,
                        last_err,
                    )
                    missing.append(body_id)
                    continue

                states[body_id] = {
                    "positionM": {
                        "x": float(got[0]) * KM_TO_M,
                        "y": float(got[1]) * KM_TO_M,
                        "z": float(got[2]) * KM_TO_M,
                    },
                    "velocityMS": {
                        "x": float(got[3]) * KM_TO_M,
                        "y": float(got[4]) * KM_TO_M,
                        "z": float(got[5]) * KM_TO_M,
                    },
                }

        return states, missing


_pool: SpicePool | None = None


def default_kernels_root() -> Path:
    env = os.environ.get("KERNELS_ROOT")
    if env:
        return Path(env).expanduser().resolve()
    # server/ → repo root → public/kernels
    return Path(__file__).resolve().parents[1] / "public" / "kernels"


def get_pool() -> SpicePool:
    global _pool
    if _pool is None:
        raise RuntimeError("SpicePool has not been initialized")
    return _pool


def init_pool(kernels_root: Path | None = None) -> SpicePool:
    global _pool
    root = kernels_root or default_kernels_root()
    pool = SpicePool(kernels_root=root)
    pool.load()
    _pool = pool
    return pool
