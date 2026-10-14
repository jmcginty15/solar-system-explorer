"""Poll kernel + catalog files and hot-reload without restarting the process."""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from catalog import catalog_path, load_catalog
from spice_pool import default_kernels_root, get_pool

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL_S = 2.0
# Require the SPK fingerprint to stay unchanged for this many consecutive polls
# before reloading — avoids furnishing half-written downloads.
_DEFAULT_STABLE_POLLS = 2


def _spk_fingerprint(kernels_root: Path) -> tuple[tuple[str, int, int], ...]:
    """Stable snapshot of every loadable *.bsp (path, size, mtime_ns)."""
    spk_dir = kernels_root / "spk"
    if not spk_dir.is_dir():
        return ()
    rows: list[tuple[str, int, int]] = []
    for path in sorted(spk_dir.rglob("*.bsp")):
        if "runtime" in path.parts:
            continue
        try:
            st = path.stat()
        except OSError:
            continue
        rows.append((str(path), st.st_size, st.st_mtime_ns))
    return tuple(rows)


def _catalog_fingerprint() -> tuple[str, int, int] | None:
    path = catalog_path()
    try:
        st = path.stat()
    except OSError:
        return None
    return (str(path), st.st_size, st.st_mtime_ns)


class KernelWatcher:
    """Background poller that reloads SPICE kernels / catalog when files change."""

    def __init__(
        self,
        kernels_root: Path | None = None,
        interval_s: float | None = None,
        stable_polls: int | None = None,
    ) -> None:
        self.kernels_root = kernels_root or default_kernels_root()
        env_interval = os.environ.get("KERNEL_WATCH_INTERVAL_S")
        self.interval_s = (
            float(env_interval)
            if env_interval
            else (interval_s if interval_s is not None else _DEFAULT_INTERVAL_S)
        )
        env_stable = os.environ.get("KERNEL_WATCH_STABLE_POLLS")
        self.stable_polls = (
            int(env_stable)
            if env_stable
            else (
                stable_polls
                if stable_polls is not None
                else _DEFAULT_STABLE_POLLS
            )
        )
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._spk_fp = _spk_fingerprint(self.kernels_root)
        self._catalog_fp = _catalog_fingerprint()
        self._pending_spk_fp: tuple[tuple[str, int, int], ...] | None = None
        self._pending_spk_stable = 0
        self._pending_catalog_fp: tuple[str, int, int] | None = None
        self._pending_catalog_stable = 0

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="kernel-watcher",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "Watching %s for *.bsp changes (interval %.1fs, stable polls %d)",
            self.kernels_root / "spk",
            self.interval_s,
            self.stable_polls,
        )

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=self.interval_s + 1.0)
        self._thread = None

    def _run(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self._tick()
            except Exception:  # noqa: BLE001 — keep watcher alive
                logger.exception("Kernel watcher tick failed")

    def _tick(self) -> None:
        spk_fp = _spk_fingerprint(self.kernels_root)
        catalog_fp = _catalog_fingerprint()

        if spk_fp == self._spk_fp:
            self._pending_spk_fp = None
            self._pending_spk_stable = 0
        elif spk_fp == self._pending_spk_fp:
            self._pending_spk_stable += 1
            if self._pending_spk_stable >= self.stable_polls:
                logger.info(
                    "SPK set changed (%d → %d files); reloading kernels",
                    len(self._spk_fp),
                    len(spk_fp),
                )
                try:
                    get_pool().load()
                    self._spk_fp = spk_fp
                except Exception:  # noqa: BLE001 — retry next stable window
                    logger.exception("SPK reload failed; will retry")
                self._pending_spk_fp = None
                self._pending_spk_stable = 0
        else:
            # New or still-growing download — wait for a stable fingerprint.
            self._pending_spk_fp = spk_fp
            self._pending_spk_stable = 0

        if catalog_fp == self._catalog_fp:
            self._pending_catalog_fp = None
            self._pending_catalog_stable = 0
        elif catalog_fp == self._pending_catalog_fp:
            self._pending_catalog_stable += 1
            if self._pending_catalog_stable >= self.stable_polls:
                logger.info("Catalog JSON changed; reloading bodies")
                try:
                    load_catalog(force=True)
                    self._catalog_fp = catalog_fp
                except Exception:  # noqa: BLE001 — retry next stable window
                    logger.exception("Catalog reload failed; will retry")
                self._pending_catalog_fp = None
                self._pending_catalog_stable = 0
        elif catalog_fp is not None:
            self._pending_catalog_fp = catalog_fp
            self._pending_catalog_stable = 0


_watcher: KernelWatcher | None = None


def start_watcher(kernels_root: Path | None = None) -> KernelWatcher:
    global _watcher
    if _watcher is None:
        _watcher = KernelWatcher(kernels_root=kernels_root)
    _watcher.start()
    return _watcher


def stop_watcher() -> None:
    global _watcher
    if _watcher is not None:
        _watcher.stop()
        _watcher = None
