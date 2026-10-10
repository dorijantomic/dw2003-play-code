#!/usr/bin/env python3
"""Who really reads a given struct field — by tracked base register, not proximity.

`audit_stage_coverage.py` reports a descriptor field as "unconsumed" when the
stage merely *stores* a pointer there. That says nothing about whether the
ORIGINAL reads it, and on 2026-08-05 the difference mattered twice:

* descriptor +0x20 was labelled a tile-anim block. It is the field-encounter
  table (eight slots picked by a masked random value on a randomized step
  countdown), and three shipping extractors already consume it. A renderer
  built against that label would have animated 173 stages from encounter data.
* a window-scan for `lw $v0, 0x28($a0)` near a descriptor materialization
  "found" a +0x28 reader that was really reading offset 0x28 of the enclosing
  function's argument, because $v0 had been reloaded two instructions earlier.

Proximity is not provenance. This walks the overlay's word stream with the same
constant tracker `descriptor_stores` uses, and reports a read only when the base
register demonstrably holds the struct address at that instruction.

Usage:
  python3 tools/descriptor_readers.py fieldstg
  python3 tools/descriptor_readers.py fieldstg --struct 0x80099d80 --offset 0x28
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs

SCENE_DESCRIPTOR = 0x80099D80

# op -> mnemonic, for the MIPS I load encodings that can address a struct field.
LOADS = {0x20: "lb", 0x21: "lh", 0x23: "lw", 0x24: "lbu", 0x25: "lhu"}


def reads(overlay: str, struct_addr: int) -> dict[int, list[tuple[int, str]]]:
    """{field offset: [(file offset, mnemonic), ...]} for tracked-base loads."""
    path, base = ovs.resolve_overlay(overlay)
    found: dict[int, list[tuple[int, str]]] = {}
    for off, word, regs in ovs.track_consts(sorted(ovs.load_words(path, base).items())):
        op = word >> 26
        if op not in LOADS:
            continue
        if regs.get((word >> 21) & 31) != struct_addr:
            continue
        imm = word & 0xFFFF
        field = imm - 0x10000 if imm >= 0x8000 else imm
        found.setdefault(field, []).append((off, LOADS[op]))
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("overlay")
    ap.add_argument("--struct", default=hex(SCENE_DESCRIPTOR),
                    help="struct base address (default: the scene descriptor)")
    ap.add_argument("--offset", default=None,
                    help="report only this field offset")
    args = ap.parse_args()

    found = reads(args.overlay, int(args.struct, 0))
    if args.offset is not None:
        want = int(args.offset, 0)
        sites = found.get(want, [])
        verb = "is READ" if sites else "is never read"
        print(f"{args.overlay}: +0x{want:02x} {verb} through a tracked base "
              f"({len(sites)} site(s))")
        for off, op in sites:
            print(f"  f0x{off:06x}  {op}")
        # An empty result is only evidence of absence for the words this overlay
        # actually carries encoding comments for; say so rather than implying more.
        if not sites:
            print(f"  scanned {len(ovs.load_words(*ovs.resolve_overlay(args.overlay)))} "
                  f"encoded words; absence holds only for those")
        return 0

    for field in sorted(found):
        sites = found[field]
        first, op = sites[0]
        print(f"+0x{field:02x}: {len(sites):3d} read(s)  e.g. f0x{first:06x} {op}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
