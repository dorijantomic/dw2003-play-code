#!/usr/bin/env python3
"""Enumerate method-table installers across the original assembly corpus.

A DDW3 "dispatch table" is installed by a constructor as a run of
`la_ $r, F0xADDR` / `sw $r, 0xOFF($base)` pairs. Finding those runs enumerates
every object type whose slots the indirect-call inventory reports as
`struct_function_slot`, instead of chasing one hot slot offset at a time.

Output is one JSON record per installer run:
  file, function, base_register, slots {offset: target}, size

Run through the mandatory cap, e.g.
  taskset -c 0 prlimit --as=4294967296 -- python3 tools/scan_vtable_installers.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ASM = Path.home() / "ddw3" / "asm" / "dw2003"

LA = re.compile(r"^\.L0x([0-9a-f]{8}):\s+la_\s+\$(\w+),\s+(F0x[0-9a-f]+)")
# `la_ $r, D0xADDR` makes $r a STATIC GLOBAL base. A run against such a base is a
# global handler array reached by absolute address, not a per-instance vtable, so
# it explains none of the `struct_function_slot` receiver-relative call sites.
LA_DATA = re.compile(r"^\.L0x([0-9a-f]{8}):\s+la_\s+\$(\w+),\s+(D0x[0-9a-f]+)")
SW = re.compile(r"^\.L0x([0-9a-f]{8}):\s+sw\s+\$(\w+),\s+(-?0x[0-9a-f]+)\((\$\w+)\)")
FUNC = re.compile(r"^(F0x[0-9a-f]+):")

# A run this short is an ordinary field assignment, not a dispatch table.
MIN_SLOTS = 3


def scan(path: Path):
    fn = "?"
    pending: dict[str, str] = {}
    global_base: dict[str, str] = {}
    runs: list[dict] = []
    cur: dict | None = None

    def flush():
        nonlocal cur
        if cur and len(cur["slots"]) >= MIN_SLOTS:
            cur["size"] = len(cur["slots"])
            runs.append(cur)
        cur = None

    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        m = FUNC.match(line)
        if m:
            flush()
            fn = m.group(1)
            pending.clear()
            global_base.clear()
            continue
        m = LA_DATA.match(line)
        if m:
            global_base[m.group(2)] = m.group(3)
            continue
        m = LA.match(line)
        if m:
            pending[m.group(2)] = m.group(3)
            global_base.pop(m.group(2), None)
            continue
        m = SW.match(line)
        if m:
            reg, off, base = m.group(2), int(m.group(3), 16), m.group(4)
            target = pending.pop(reg, None)
            if target is None:
                # A non-pointer store breaks a run only if it is inside one.
                continue
            if cur is None or cur["base"] != base or cur["function"] != fn:
                flush()
                sym = global_base.get(base.lstrip("$"))
                cur = {
                    "file": str(path.relative_to(ASM)),
                    "function": fn,
                    "base": base,
                    "base_kind": "static_global" if sym else "instance",
                    "base_symbol": sym,
                    "slots": {},
                }
            cur["slots"][f"0x{off:x}"] = target
            continue
    flush()
    return runs


def main() -> None:
    out = []
    for path in sorted(ASM.rglob("*.s")):
        try:
            out.extend(scan(path))
        except MemoryError:
            print(f"MemoryError on {path}", file=sys.stderr)
            raise
    out.sort(key=lambda r: -r["size"])
    json.dump({"installer_count": len(out), "installers": out}, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
