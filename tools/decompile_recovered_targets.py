#!/usr/bin/env python3
"""Decompile inventory-promoted DDW3 overlay targets into recovered/ddw3.

This is a generated structural lift, not a semantic claim.  Function selection
comes from ``extracted_called_function_pointer`` provenance in the recovered
inventory.  The raw evidence remains read-only under ``~/ddw3``.

Run under the repository overlay resource cap:

    taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/decompile_recovered_targets.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OVERLAY_TO_FNS = ROOT / "tools/exe_decomp/overlay_to_fns.py"
NORMALIZE = ROOT / "tools/exe_decomp/normalize_asm.py"
DECOMPILE = ROOT / "tools/exe_decomp/decompile_exe.py"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], env: dict[str, str]) -> None:
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def relative_source(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--inventory", type=Path,
        default=ROOT / "recovered/ddw3/function-inventory.json",
    )
    parser.add_argument(
        "--asm-root", type=Path,
        default=Path.home() / "ddw3/asm/dw2003",
    )
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "recovered/ddw3/decomp",
    )
    parser.add_argument(
        "--module", action="append", dest="modules",
        help="Restrict to a stable module id such as pro/stgtrain (repeatable).",
    )
    parser.add_argument(
        "--select", choices=("promoted", "established"), default="promoted",
        help=(
            "promoted (default): only extracted_called_function_pointer targets. "
            "established: every function with a recovered boundary in the selected "
            "modules, for lifting overlays that have no decompilation at all. "
            "Widening selection lifts more code but does not make any of it a "
            "semantic claim, and lower-confidence boundaries yield more failures."
        ),
    )
    args = parser.parse_args()

    if args.select == "established" and not args.modules:
        # Whole-corpus `established` would decompile thousands of functions in
        # one unbounded pass under a one-core cap. Force an explicit module list
        # so the run stays bounded and reviewable.
        raise SystemExit("--select established requires at least one --module")

    inventory_path = args.inventory.resolve()
    inventory = json.loads(inventory_path.read_text())
    selected: dict[str, list[dict[str, object]]] = {}
    # `--select established` widens selection for the named modules only, and
    # every other module still contributes its promoted targets. The manifest is
    # rewritten wholesale from this one run, so narrowing the run to the named
    # modules would silently drop every other module's already-lifted output
    # from it.
    established_modules = set(args.modules or []) if args.select == "established" else set()
    requested_modules = set(args.modules or []) - established_modules
    for module in inventory["modules"]:
        if requested_modules and module["id"] not in requested_modules:
            continue
        for function in module["functions"]:
            if module["id"] in established_modules:
                # Established entries only. `pointer_candidates` are held in a
                # separate inventory list and never reach this loop, so a word
                # that is really a switch destination is not lifted as if it
                # were a function. Discovered overlay entries are included but
                # their boundaries stay provisional, which is the main source of
                # failures and of empty bodies on shared epilogue labels.
                if function["boundary_status"] in {
                    "labeled", "provisional_discovered_entries",
                }:
                    selected.setdefault(module["id"], []).append(function)
            elif "extracted_called_function_pointer" in function["entry_evidence"]:
                selected.setdefault(module["id"], []).append(function)

    missing_modules = (requested_modules | established_modules) - set(selected)
    if missing_modules:
        raise SystemExit(
            "no promoted targets for module(s): " + ", ".join(sorted(missing_modules))
        )

    output_root = args.output.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    # Only the uv fallback in decompile_exe.run_m2c reads this. Point it at the
    # user cache rather than a /tmp directory a fresh machine will not have.
    env.setdefault("UV_CACHE_DIR", str(Path.home() / ".cache" / "uv"))
    manifest_modules: list[dict[str, object]] = []
    success_count = 0
    failure_count = 0

    with tempfile.TemporaryDirectory(prefix="ddw3-recovered-decomp-", dir="/tmp") as temp:
        temporary = Path(temp)
        for module_id, functions in sorted(selected.items()):
            overlay = module_id.removeprefix("pro/")
            source = args.asm_root / "pro" / f"{overlay}.s"
            if not source.is_file():
                raise SystemExit(f"missing original overlay assembly: {source}")
            work = temporary / overlay
            work.mkdir()
            adapted = work / f"{overlay}.fns.s"
            normalized = work / f"{overlay}.norm.s"
            entries_file = work / "entries.txt"
            entries = [function["original_name"] for function in functions]
            entries_file.write_text("\n".join(entries) + "\n")
            module_output = output_root / module_id
            module_output.mkdir(parents=True, exist_ok=True)
            expected = set(entries)
            for stale in module_output.glob("F0x*.c"):
                if stale.stem not in expected:
                    stale.unlink()
            assembly_output = module_output / "_asm"
            if assembly_output.exists():
                for stale in assembly_output.glob("F0x*.s"):
                    if stale.stem not in expected:
                        stale.unlink()

            run([
                sys.executable, str(OVERLAY_TO_FNS), str(source), str(adapted),
                "--inventory", str(inventory_path), "--module", module_id,
            ], env)
            run([sys.executable, str(NORMALIZE), str(adapted), str(normalized)], env)
            run([
                sys.executable, str(DECOMPILE), str(normalized), str(module_output),
                "--entries-file", str(entries_file),
            ], env)

            manifest_functions = []
            for function in functions:
                entry = function["original_name"]
                c_path = module_output / f"{entry}.c"
                asm_path = module_output / "_asm" / f"{entry}.s"
                text = c_path.read_text(errors="replace") if c_path.exists() else ""
                failed = (
                    not text.strip()
                    or "Decompilation failure" in text
                    or "/* TIMEOUT */" in text
                    or text.lstrip().startswith("Error")
                )
                if failed:
                    failure_count += 1
                else:
                    success_count += 1
                manifest_functions.append({
                    "id": function["id"],
                    "address": function["address"],
                    "original_source_line": function["source_line"],
                    "status": "failed" if failed else "decompiled",
                    "c_source": relative_source(c_path),
                    "closure_assembly": relative_source(asm_path),
                })
            manifest_modules.append({
                "id": module_id,
                "original_source": "~/ddw3/asm/dw2003/pro/" + source.name,
                "original_source_sha256": sha256_file(source),
                "functions": manifest_functions,
            })

    manifest = {
        "schema_version": 1,
        "method": "inventory-selected overlay labels -> normalized closure assembly -> m2c",
        "inventory": relative_source(inventory_path),
        "inventory_sha256": sha256_file(inventory_path),
        "selection_provenance": "extracted_called_function_pointer",
        "summary": {
            "modules": len(manifest_modules),
            "functions": success_count + failure_count,
            "decompiled": success_count,
            "failed": failure_count,
        },
        "modules": manifest_modules,
    }
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        f"modules={len(manifest_modules)} functions={success_count + failure_count} "
        f"decompiled={success_count} failed={failure_count} output={manifest_path}"
    )


if __name__ == "__main__":
    main()
