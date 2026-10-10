#!/usr/bin/env python3
"""Report every field of an smdldata record that `pro/fightstg.s` actually reads.

`MDL-Q001` asks what each record field means. A field with no reader cannot be
named from behaviour, so the question "which offsets are read at all" has to be
answered mechanically rather than by eye.

Method: a conservative forward taint of the record pointer, intra-procedural.

Seeds -- every place a record pointer enters a register:
  * the return register after a call through the accessor cell `D0x800a4570`
    (`lookupByKey`), which is how eight of the ten call sites reach it;
  * the return register after `jal FIGHTSTG_F0x8009e994`, the one direct call;
  * every load of the cached record pointer at `0x800a4558+0x10` / `+0x14`.

Propagation: `move`, `addiu` (offset folded into the reported field), and `addu`
with one tainted operand (reported as an index-scaled access, since the camera
arrays are addressed that way). A register is dropped the moment anything else
writes it, and the walk stops at the next function label or `jr`.

The taint is conservative in the safe direction for a negative result: it can
only ever report FEWER accesses than exist, never more, so an offset it does not
report is an offset no straight-line path from a record pointer reads. Nothing
in the corpus passes a record pointer to another function, which is why an
intra-procedural walk is sufficient -- see the claim
`smdldata-record-0x12-0x14-0x16-have-no-reader-2026-08-18`.

Usage:
    .venv/bin/python3 tools/trace_smdldata_record_reads.py
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

DEFAULT_SRC = Path.home() / "ddw3/asm/dw2003/pro/fightstg.s"
ACCESSOR_CELL = "0x4570("          # D0x800a4570, the lookupByKey method cell
CACHE_BASE = "0x4558"              # the accessor object itself
CACHED_RECORD = (0x10, 0x14)       # its two record-pointer fields
DIRECT_CALL = "F0x8009e994"

INSN = re.compile(r"^\.L0x([0-9a-f]+):\s+(\S+)\s*(.*)$")
FUNC = re.compile(r"^FIGHTSTG_F0x[0-9a-f]+:")
MEM = re.compile(r"^\$(\w+),\s*(-?0x[0-9a-f]+|-?\d+)?\((\$\w+)\)$")
LOADS = {"lw", "lh", "lhu", "lb", "lbu", "lwl", "lwr"}
STORES = {"sw", "sh", "sb", "swl", "swr"}
CALL_CLOBBERED = ("$v0", "$v1", "$a0", "$a1", "$a2", "$a3", "$t0", "$t1")


def imm(text: str | None) -> int:
    if not text:
        return 0
    return int(text, 16) if text.startswith(("0x", "-0x")) else int(text)


def parse(path: Path) -> list[tuple[int | None, str, str]]:
    prog: list[tuple[int | None, str, str]] = []
    for raw in path.read_text(errors="replace").splitlines():
        text = raw.strip()
        if FUNC.match(text):
            prog.append((None, "FUNC", ""))
            continue
        match = INSN.match(text)
        if match:
            prog.append((int(match.group(1), 16), match.group(2),
                         match.group(3).split("#")[0].strip()))
    return prog


def seeds(prog) -> list[int]:
    found: set[int] = set()
    for i, (_addr, op, args) in enumerate(prog):
        if op == "jalr" and any(prog[j][1] == "lw" and ACCESSOR_CELL in prog[j][2]
                                for j in range(max(0, i - 4), i)):
            found.add(i)
        elif op == "jal" and DIRECT_CALL in args:
            found.add(i)
        elif op == "lw":
            mem = MEM.match(args)
            if mem and imm(mem.group(2)) in CACHED_RECORD and any(
                prog[j][1] == "addiu" and CACHE_BASE in prog[j][2]
                and prog[j][2].split(",")[0] == mem.group(3)
                for j in range(max(0, i - 6), i)
            ):
                found.add(i)
    return sorted(found)


def trace(prog, start: int) -> list[tuple[object, int, str, str]]:
    _addr, op, args = prog[start]
    if op in ("jal", "jalr"):
        first, cursor = "$v0", start + 2       # skip the delay slot
    else:
        first, cursor = "$" + MEM.match(args).group(1), start + 1
    off = {first: 0}
    scaled: set[str] = set()
    hits = []
    while cursor < len(prog) and off:
        addr, op, args = prog[cursor]
        parts = [x.strip() for x in args.split(",")]
        if op == "FUNC" or op == "jr":
            break
        if op in LOADS | STORES:
            mem = MEM.match(args)
            if mem and mem.group(3) in off:
                field = off[mem.group(3)] + imm(mem.group(2))
                hits.append(("index" if mem.group(3) in scaled else "fixed",
                             field, f"0x{addr:08x}", f"{op} {args}"))
            if mem and op in LOADS:
                off.pop("$" + mem.group(1), None)
                scaled.discard("$" + mem.group(1))
            cursor += 1
            continue
        if op in ("move_", "move") and parts[1] in off:
            off[parts[0]] = off[parts[1]]
            if parts[1] in scaled:
                scaled.add(parts[0])
        elif op == "addiu" and len(parts) == 3 and parts[1] in off:
            off[parts[0]] = off[parts[1]] + imm(parts[2])
            if parts[1] in scaled:
                scaled.add(parts[0])
        elif op == "addiu" and len(parts) == 2 and parts[0] in off:
            off[parts[0]] += imm(parts[1])
        elif op == "addu" and any(r in off for r in (parts[1:] if len(parts) == 3 else parts)):
            # `addu $d, $s, $t` writes $d; the two-operand form `addu $d, $t` is
            # $d = $d + $t, so $d is a source there as well as the destination.
            src = next(r for r in (parts[1:] if len(parts) == 3 else parts) if r in off)
            off[parts[0]] = off[src]
            scaled.add(parts[0])           # a variable index is now folded in
        else:
            if parts and parts[0] in off:
                off.pop(parts[0])
                scaled.discard(parts[0])
            if op in ("jal", "jalr"):
                for reg in CALL_CLOBBERED:
                    off.pop(reg, None)
                    scaled.discard(reg)
        cursor += 1
    return hits


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = parser.parse_args()

    prog = parse(args.src)
    starts = seeds(prog)
    fields: dict[tuple[str, int], list] = {}
    for start in starts:
        for kind, field, addr, text in trace(prog, start):
            fields.setdefault((kind, field), []).append((addr, text))

    print(f"{args.src}: {len(starts)} record-pointer seeds")
    for kind, field in sorted(fields, key=lambda k: (k[0] != "fixed", k[1])):
        sites = fields[(kind, field)]
        label = f"record+0x{field:02x}" if kind == "fixed" else f"record+idx+0x{field:02x}"
        print(f"  {label:20s} {len(sites):2d} access(es)  e.g. {sites[0][0]}: {sites[0][1]}")
    for field in (0x12, 0x14, 0x16):
        assert ("fixed", field) not in fields and ("index", field) not in fields
    print("  -- no access at +0x12, +0x14 or +0x16")


if __name__ == "__main__":
    main()
