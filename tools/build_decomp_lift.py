#!/usr/bin/env python3
"""Lift the ddw3 assembly to C with the vendored m2c into exe-decomp/.

Runs tools/exe_decomp/lift_overlays.py (overlay_to_fns -> normalize_asm -> m2c)
over every overlay in $DDW3/asm/dw2003/pro and the resident EXE, in parallel.
Several extractors read constants and tables out of these lifted functions
(stage descriptors, the screen-UI layout extractors). The lift is mechanical:
a function m2c cannot lift is recorded in the module's _failures.txt and the
rest of the module still lands.
"""
from __future__ import annotations

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
OUT = ROOT / "exe-decomp"
LIFT = ROOT / "tools/exe_decomp/lift_overlays.py"


def run(args: list[str]) -> int:
    return subprocess.run([sys.executable, str(LIFT), "--keep-going", "--out", str(OUT), *args],
                          cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def main() -> int:
    modules = sorted(p.stem for p in (DDW3 / "asm/dw2003/pro").glob("*.s"))
    if not modules:
        raise SystemExit(f"no overlays under {DDW3}/asm/dw2003/pro")
    OUT.mkdir(parents=True, exist_ok=True)
    # biggest first so the long ones overlap with the many small stage overlays
    modules.sort(key=lambda m: -(DDW3 / f"asm/dw2003/pro/{m}.s").stat().st_size)
    jobs = [["--exe"]] + [[m] for m in modules]
    with ThreadPoolExecutor(max_workers=max(1, min(8, os.cpu_count() or 1))) as pool:
        list(pool.map(run, jobs))
    lifted = [m for m in modules if (OUT / f"{m}_c").is_dir()]
    print(f"lifted {len(lifted)}/{len(modules)} overlays + exe={'yes' if (OUT / 'c').is_dir() else 'NO'} into {OUT}")
    missing = sorted(set(modules) - set(lifted))
    if missing:
        print(f"no lifted functions for: {', '.join(missing)}")
    if not (OUT / "c").is_dir():
        raise SystemExit("the resident EXE lift produced no output")
    return 0


if __name__ == "__main__":
    sys.exit(main())
