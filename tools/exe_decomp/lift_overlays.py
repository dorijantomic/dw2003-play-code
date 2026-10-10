#!/usr/bin/env python3
"""Re-run the overlay lift (overlay_to_fns -> normalize_asm -> m2c) for a module.

The `exe-decomp/` tree was previously produced by invoking the three stages by
hand, so a pipeline change could not be re-applied or measured.  This driver
makes the lift reproducible and lets a change be scored against the committed
baseline:

    python3 tools/exe_decomp/lift_overlays.py --out /tmp/lift --all
    python3 tools/triage_lift_failures.py --root /tmp/lift summary

Run it under the repository overlay resource cap:

    taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/exe_decomp/lift_overlays.py --all

This is a mechanical lift of read-only assembly.  Nothing it emits is a
semantic claim about original behavior.
"""

from __future__ import annotations
import os

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGE_DIR = ROOT / "tools/exe_decomp"
ORIGINAL_PRO = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"

# `pro/ststatus` was normalized under a different file name before this driver
# existed, and `triage_lift_failures.norm_asm_for` still resolves it there.
NORM_NAME = {"ststatus": "ststatus_c_norm.s"}

INVENTORY = ROOT / "recovered/ddw3/function-inventory.json"
_INVENTORY_MODULES: set[str] | None = None


def inventory_has(module: str) -> bool:
    global _INVENTORY_MODULES
    if _INVENTORY_MODULES is None:
        import json

        _INVENTORY_MODULES = {
            entry["id"] for entry in json.loads(INVENTORY.read_text())["modules"]
        } if INVENTORY.exists() else set()
    return f"pro/{module}" in _INVENTORY_MODULES


def modules_with_output(out: Path) -> list[str]:
    modules = sorted(p.name.removesuffix("_c") for p in out.glob("*_c") if p.is_dir())
    if (out / "c").is_dir():
        modules.insert(0, "exe")
    return modules


def inventory_entries(module_id: str, out: Path, name: str) -> Path | None:
    """Write the labels the inventory knows for one module, for `--also-entries`.

    Same defect as the EXE had, and it reaches the overlays too: entry selection
    is derived from the assembly alone, so a function the inventory already has
    a boundary for is never handed to m2c and ends up with no body at all.
    `--also-entries` is a union and drops anything the normalizer gated out as
    data, so this cannot resurrect a switch case as a function.
    """
    inventory_path = ROOT / "recovered/ddw3/function-inventory.json"
    if not inventory_path.is_file():
        return None
    inventory = json.loads(inventory_path.read_text())
    labels = sorted(
        function["id"].split(":", 1)[1]
        for module in inventory["modules"] if module["id"] == module_id
        for function in module["functions"]
        if function.get("boundary_status") in {"labeled",
                                               "provisional_discovered_entries"}
    )
    if not labels:
        return None
    path = out / name
    path.write_text("\n".join(labels) + "\n")
    return path


def inventory_exe_entries(out: Path) -> Path | None:
    """Write the EXE labels the inventory knows about, for `--also-entries`.

    `decompile_exe.real_entries()` derives entries from the assembly alone, and
    it misses functions the recovered inventory has already established a
    boundary for: measured 2026-08-12, 195 `exe/fns` functions with an
    `original_label` boundary had never been handed to m2c at all, so no body
    existed for them and they read as the largest block of wholly unknown code
    in the program. Feeding the inventory's labels back in lifts 141 of them.

    `--also-entries` is a union, and `decompile_exe` drops any label that the
    normalizer gated out as data, so this cannot resurrect a switch case as if
    it were a function.
    """
    return inventory_entries("exe/fns", out, "fns.inventory-entries.txt")


def lift_exe(out: Path, context: Path | None) -> int:
    """Lift the resident EXE. It needs no `overlay_to_fns` adaptation: its
    assembly already carries `F0x`/`D0x` labels and section directives."""
    source = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/exe/fns.s"
    if not source.is_file():
        raise SystemExit(f"missing original EXE assembly: {source}")
    normalized = out / "fns.norm.s"
    module_out = out / "c"
    module_out.mkdir(parents=True, exist_ok=True)
    for stale in module_out.glob("F0x*.c"):
        stale.unlink()
    also = inventory_exe_entries(out)
    stages = [
        [sys.executable, str(STAGE_DIR / "normalize_asm.py"), str(source), str(normalized)],
        [sys.executable, str(STAGE_DIR / "decompile_exe.py"), str(normalized), str(module_out)]
        + (["--context", str(context)] if context else [])
        + (["--also-entries", str(also)] if also else []),
    ]
    for stage in stages:
        result = subprocess.run(stage, cwd=ROOT)
        if result.returncode != 0:
            print(f"!! exe: stage failed: {' '.join(stage)}", file=sys.stderr)
            return result.returncode
    return 0


def lift(module: str, out: Path, keep_going: bool, context: Path | None = None) -> int:
    if module == "exe":
        return lift_exe(out, context)
    source = ORIGINAL_PRO / f"{module}.s"
    if not source.is_file():
        raise SystemExit(f"missing original overlay assembly: {source}")
    adapted = out / f"{module}.fns.s"
    normalized = out / NORM_NAME.get(module, f"{module}.norm.s")
    module_out = out / f"{module}_c"
    module_out.mkdir(parents=True, exist_ok=True)
    # A pipeline change alters which labels are entries, so stale artifacts from
    # the previous run would otherwise be counted as this run's output.
    for stale in module_out.glob("F0x*.c"):
        stale.unlink()
    entries = out / f"{module}.entries.txt"
    adapt = [sys.executable, str(STAGE_DIR / "overlay_to_fns.py"), str(source),
             str(adapted), "--entries-out", str(entries)]
    if inventory_has(module):
        # The recovered inventory is the repository's authority on function
        # boundaries; without it, entries reached only from another module are
        # never labeled and their bodies are never lifted.
        adapt += ["--inventory", str(INVENTORY), "--module", f"pro/{module}"]
    stages = [
        adapt,
        [sys.executable, str(STAGE_DIR / "normalize_asm.py"), str(adapted), str(normalized)],
        [sys.executable, str(STAGE_DIR / "decompile_exe.py"), str(normalized), str(module_out),
         "--also-entries", str(entries)]
        + (["--context", str(context)] if context else []),
    ]
    for stage in stages:
        result = subprocess.run(stage, cwd=ROOT)
        if result.returncode != 0:
            print(f"!! {module}: stage failed: {' '.join(stage)}", file=sys.stderr)
            if not keep_going:
                return result.returncode
            return result.returncode
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("modules", nargs="*", help="overlay names, e.g. stagslct")
    parser.add_argument("--out", type=Path, default=ROOT / "exe-decomp")
    parser.add_argument(
        "--all", action="store_true",
        help="re-lift every overlay that already has an output directory under --out",
    )
    parser.add_argument(
        "--every", action="store_true",
        help="lift every overlay under ~/ddw3/asm/dw2003/pro, largest first, "
             "including the 302 that have never been decompiled at all",
    )
    parser.add_argument(
        "--exe", action="store_true",
        help="lift the resident EXE (~/ddw3/asm/dw2003/exe/fns.s) into <out>/c. "
             "`lift_exe` existed but no flag reached it, so the EXE lift was "
             "not reproducible through this driver at all.",
    )
    parser.add_argument("--limit", type=int, help="stop after this many modules")
    parser.add_argument("--keep-going", action="store_true")
    parser.add_argument(
        "--context", type=Path,
        help="m2c context file, e.g. the one tools/build_m2c_context.py writes.",
    )
    args = parser.parse_args()

    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules = list(args.modules)
    if args.all:
        modules += [m for m in modules_with_output(out) if m not in modules]
    if args.every:
        # Biggest first, so a run that is cut short has still covered the most
        # code rather than the alphabetically earliest stage scripts.
        by_size = sorted(
            ORIGINAL_PRO.glob("*.s"), key=lambda p: p.stat().st_size, reverse=True
        )
        modules += [p.stem for p in by_size if p.stem not in modules]
    if args.limit:
        modules = modules[: args.limit]
    if not modules and not args.exe:
        raise SystemExit("no modules selected: pass names, --all or --exe")

    if args.exe:
        print("== exe/fns", file=sys.stderr)
        if lift_exe(out, args.context) != 0 and not args.keep_going:
            raise SystemExit("stage failure in exe/fns")

    failures = []
    for module in modules:
        print(f"== {module}", file=sys.stderr)
        if lift(module, out, args.keep_going, args.context) != 0:
            failures.append(module)
            if not args.keep_going:
                raise SystemExit(f"stage failure in {module}")
    print(f"lifted {len(modules) - len(failures)}/{len(modules)} modules", file=sys.stderr)
    if failures:
        print("failed: " + ", ".join(failures), file=sys.stderr)


if __name__ == "__main__":
    main()
