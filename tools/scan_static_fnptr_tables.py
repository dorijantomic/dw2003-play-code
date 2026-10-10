#!/usr/bin/env python3
"""Enumerate STATIC function-pointer tables in the DDW3 data segment.

tools/scan_vtable_installers.py only finds tables an instruction stream builds
(`la_`/`sw` runs). The other half of the dispatch layer is initialised data:
consecutive `D0xADDR` words in the EXE's data segment that already hold function
addresses at load time. Those are the blocks that call sites reach by absolute
address (`la_ $r, D0xADDR` then `lw`/`jalr`), and they are invisible to the
installer scan.

The transcribed data segment lives in the read-only decompilation at
`~/ddw3/rust/dw2003_exe_data/src/data.rs` as typed statics of the form

    pub static mut D0x8004b7bc @ "0x8004b7bc": *const u32 =
        unsafe { ptr::addr_of!(F0x8001810c) };

A run of such statics at consecutive 4-byte addresses is one table.

Output is one JSON record per run: base address, slot count, and offset->target.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DATA_RS = Path.home() / "ddw3" / "rust" / "dw2003_exe_data" / "src" / "data.rs"

# A single-word static holding one function address.
PTR = re.compile(
    r'pub static mut D0x([0-9a-f]{8}) @ "0x[0-9a-f]{8}": \*const u32 = '
    r"unsafe \{ ptr::addr_of!\(F0x([0-9a-f]{8})\) \};"
)
# Any other single-word static breaks a run.
WORD = re.compile(r'pub static mut D0x([0-9a-f]{8}) @ "0x[0-9a-f]{8}"')

MIN_SLOTS = 3


def main() -> None:
    runs: list[dict] = []
    cur: dict | None = None

    def flush() -> None:
        nonlocal cur
        if cur and len(cur["slots"]) >= MIN_SLOTS:
            cur["size"] = len(cur["slots"])
            runs.append(cur)
        cur = None

    for line in DATA_RS.read_text(errors="replace").splitlines():
        line = line.strip()
        m = PTR.match(line)
        if m:
            addr, target = int(m.group(1), 16), m.group(2)
            if cur is not None and addr == cur["_next"]:
                cur["slots"][f"0x{addr - cur['base']:x}"] = f"F0x{target}"
                cur["_next"] = addr + 4
                continue
            flush()
            cur = {"base": addr, "_next": addr + 4, "slots": {"0x0": f"F0x{target}"}}
            continue
        if WORD.match(line):
            # A non-pointer word at any address terminates the current table.
            flush()

    flush()
    for r in runs:
        r.pop("_next", None)
        r["base"] = f"0x{r['base']:x}"
    runs.sort(key=lambda r: -r["size"])
    json.dump({"table_count": len(runs), "tables": runs}, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
