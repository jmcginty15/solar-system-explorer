#!/usr/bin/env python3
"""Download SPK (.bsp) kernels for maximum server-side coverage.

Sources:
  - JPL Horizons API: binary SPKs for asteroids/comets (catalog + numbered 1..N)
  - NAIF generic_kernels: planetary DE, satellite, and multi-asteroid kernels

Usage:
  python3 scripts/download-spk-kernels.py              # all defaults
  python3 scripts/download-spk-kernels.py --horizons-only
  python3 scripts/download-spk-kernels.py --naif-only
  python3 scripts/download-spk-kernels.py --asteroids-to 1000
  python3 scripts/download-spk-kernels.py --skip-existing
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPK_DIR = ROOT / "public" / "kernels" / "spk"
NAIF_IDS_PATH = ROOT / "server" / "naif_ids.py"

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
NAIF_BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk"

# Long span matching typical Horizons small-body releases.
DEFAULT_START = "1600-01-01"
DEFAULT_STOP = "2500-01-01"

# High-value NAIF kernels not produced by Horizons (planets/satellites/bulk asteroids).
NAIF_KERNELS: list[tuple[str, str]] = [
    ("planets/de442.bsp", "de442.bsp"),
    ("asteroids/codes_300ast_20100725.bsp", "codes_300ast_20100725.bsp"),
    ("satellites/sat441xl_part-1.bsp", "sat441xl_part-1.bsp"),
    ("satellites/sat441xl_part-2.bsp", "sat441xl_part-2.bsp"),
    ("satellites/ura116xl.bsp", "ura116xl.bsp"),
    ("satellites/nep101xl.bsp", "nep101xl.bsp"),
    ("satellites/nep101xl-802.bsp", "nep101xl-802.bsp"),
    ("satellites/nep097xl-801.bsp", "nep097xl-801.bsp"),
    ("satellites/nep097xl-899.bsp", "nep097xl-899.bsp"),
    ("satellites/ura111xl-701.bsp", "ura111xl-701.bsp"),
    ("satellites/ura111xl-702.bsp", "ura111xl-702.bsp"),
    ("satellites/ura111xl-703.bsp", "ura111xl-703.bsp"),
    ("satellites/ura111xl-704.bsp", "ura111xl-704.bsp"),
    ("satellites/ura111xl-705.bsp", "ura111xl-705.bsp"),
    ("satellites/ura111xl-799.bsp", "ura111xl-799.bsp"),
]


def load_naif_ids() -> dict[str, int]:
    ns: dict = {}
    exec(NAIF_IDS_PATH.read_text(encoding="utf-8").split("NAIF_FALLBACKS")[0], ns)
    return dict(ns["NAIF_ID"])


def is_small_body(naif_id: int) -> bool:
    """Asteroids/comets/TNOs that Horizons can (usually) emit as SPK."""
    return naif_id >= 1_000_000


def asteroid_number_from_naif(naif_id: int) -> int | None:
    """Map common NAIF small-body IDs to IAU asteroid numbers when possible."""
    # Modern Horizons SPK IDs: 20NNNNNN for numbered asteroids.
    if 20_000_001 <= naif_id <= 20_999_999:
        return naif_id - 20_000_000
    # Legacy 7-digit form still seen in some docs: 2NNNNNN
    if 2_000_001 <= naif_id <= 2_999_999:
        return naif_id - 2_000_000
    return None


def http_get_json(params: dict[str, str], timeout: float = 300.0) -> dict:
    url = HORIZONS_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "solar-system-explorer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def download_file(url: str, dest: Path, *, skip_existing: bool) -> str:
    if skip_existing and dest.exists() and dest.stat().st_size > 0:
        return "skip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".partial")
    req = urllib.request.Request(url, headers={"User-Agent": "solar-system-explorer/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(dest)
    return "ok"


def _collapse_err(data: dict) -> str:
    err = (data.get("error") or data.get("result") or "no spk in response").strip()
    return " | ".join(line.strip() for line in err.splitlines() if line.strip())[:240]


def pick_horizons_record(result_text: str) -> int | None:
    """From a Horizons small-body index search, pick the latest-epoch record #."""
    best: tuple[int, int] | None = None  # (epoch_yr, record)
    for line in result_text.splitlines():
        m = re.match(r"^\s*(\d+)\s+(-?\d+)\s+", line)
        if not m:
            continue
        record = int(m.group(1))
        epoch = int(m.group(2))
        # Prefer comet apparition records (9xxxxxxx) over asteroid name collisions.
        score = (1 if record >= 90_000_000 else 0, epoch, record)
        if best is None or score > (1 if best[1] >= 90_000_000 else 0, best[0], best[1]):
            best = (epoch, record)
    return best[1] if best else None


def horizons_spk(
    command: str,
    dest: Path,
    *,
    start: str,
    stop: str,
    skip_existing: bool,
    min_bytes: int = 1024,
    resolve_search: bool = True,
) -> str:
    if skip_existing and dest.exists() and dest.stat().st_size >= min_bytes:
        return "skip"
    params = {
        "format": "json",
        "COMMAND": command,
        "EPHEM_TYPE": "SPK",
        "START_TIME": start,
        "STOP_TIME": stop,
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
    }
    data = http_get_json(params)
    spk_b64 = data.get("spk")
    if not spk_b64:
        result = data.get("result") or ""
        if resolve_search and "Matching small-bodies" in result:
            record = pick_horizons_record(result)
            if record is not None:
                return horizons_spk(
                    f"{record};",
                    dest,
                    start=start,
                    stop=stop,
                    skip_existing=False,
                    min_bytes=min_bytes,
                    resolve_search=False,
                )
        return f"fail:{_collapse_err(data)}"
    raw = base64.b64decode(spk_b64)
    if len(raw) < min_bytes or not raw.startswith(b"DAF/SPK"):
        return "fail:invalid SPK payload"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".partial")
    tmp.write_bytes(raw)
    tmp.replace(dest)
    return "ok"


def download_naif(*, skip_existing: bool) -> None:
    print("=== NAIF generic kernels ===")
    for rel, name in NAIF_KERNELS:
        dest = SPK_DIR / name
        url = f"{NAIF_BASE}/{rel}"
        print(f"  {name} ...", end=" ", flush=True)
        try:
            status = download_file(url, dest, skip_existing=skip_existing)
            if status == "skip":
                print(f"skip ({dest.stat().st_size:,} bytes)")
            else:
                print(f"ok ({dest.stat().st_size:,} bytes)")
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {exc}")


def download_horizons_catalog(
    *,
    start: str,
    stop: str,
    skip_existing: bool,
    sleep_s: float,
) -> None:
    print("=== Horizons SPK: catalog small bodies ===")
    ids = load_naif_ids()
    small = sorted(
        ((body_id, naif_id) for body_id, naif_id in ids.items() if is_small_body(naif_id)),
        key=lambda x: x[0],
    )
    ok = skip = fail = 0
    for body_id, naif_id in small:
        dest = SPK_DIR / f"{body_id}.bsp"
        # Prefer DES=NAIF lookup (works for asteroids + many comets).
        # Quote COMMAND so '=' is preserved by the Horizons API parser.
        commands = [f"'DES={naif_id};'"]
        num = asteroid_number_from_naif(naif_id)
        if num is not None:
            commands.append(f"{num};")

        print(f"  {body_id} ({naif_id}) ...", end=" ", flush=True)
        status = "fail:no command tried"
        for cmd in commands:
            try:
                status = horizons_spk(
                    cmd, dest, start=start, stop=stop, skip_existing=skip_existing
                )
            except urllib.error.HTTPError as exc:
                status = f"fail:HTTP {exc.code}"
            except Exception as exc:  # noqa: BLE001
                status = f"fail:{exc}"
            if status in ("ok", "skip"):
                break
            time.sleep(sleep_s)

        if status == "skip":
            skip += 1
            print(f"skip ({dest.stat().st_size:,} bytes)")
        elif status == "ok":
            ok += 1
            print(f"ok ({dest.stat().st_size:,} bytes)")
        else:
            fail += 1
            print(status)
        time.sleep(sleep_s)
    print(f"  catalog done: ok={ok} skip={skip} fail={fail}")


def download_horizons_numbered(
    *,
    asteroids_to: int,
    start: str,
    stop: str,
    skip_existing: bool,
    sleep_s: float,
) -> None:
    print(f"=== Horizons SPK: numbered asteroids 1..{asteroids_to} ===")
    ok = skip = fail = 0
    for n in range(1, asteroids_to + 1):
        # Stable filename by asteroid number; also covers bodies outside the app catalog.
        dest = SPK_DIR / "horizons" / f"a{n:06d}.bsp"
        print(f"  {n} ...", end=" ", flush=True)
        try:
            status = horizons_spk(
                f"{n};", dest, start=start, stop=stop, skip_existing=skip_existing
            )
        except Exception as exc:  # noqa: BLE001
            status = f"fail:{exc}"
        if status == "skip":
            skip += 1
            print("skip")
        elif status == "ok":
            ok += 1
            print(f"ok ({dest.stat().st_size:,} bytes)")
        else:
            fail += 1
            print(status)
        if n % 25 == 0:
            print(f"  … progress {n}/{asteroids_to} ok={ok} skip={skip} fail={fail}")
        time.sleep(sleep_s)
    print(f"  numbered done: ok={ok} skip={skip} fail={fail}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--horizons-only", action="store_true")
    p.add_argument("--naif-only", action="store_true")
    p.add_argument("--skip-existing", action="store_true", default=True,
                   help="Skip files that already exist (default: on)")
    p.add_argument("--force", action="store_true", help="Re-download even if file exists")
    p.add_argument("--asteroids-to", type=int, default=300,
                   help="Also download Horizons SPKs for numbered asteroids 1..N (default 300)")
    p.add_argument("--no-numbered", action="store_true", help="Skip bulk numbered-asteroid download")
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument("--stop", default=DEFAULT_STOP)
    p.add_argument("--sleep", type=float, default=0.35, help="Delay between Horizons calls")
    args = p.parse_args()
    skip_existing = not args.force

    SPK_DIR.mkdir(parents=True, exist_ok=True)

    if not args.horizons_only:
        download_naif(skip_existing=skip_existing)
    if not args.naif_only:
        download_horizons_catalog(
            start=args.start,
            stop=args.stop,
            skip_existing=skip_existing,
            sleep_s=args.sleep,
        )
        if not args.no_numbered and args.asteroids_to > 0:
            download_horizons_numbered(
                asteroids_to=args.asteroids_to,
                start=args.start,
                stop=args.stop,
                skip_existing=skip_existing,
                sleep_s=args.sleep,
            )
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
