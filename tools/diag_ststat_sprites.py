#!/usr/bin/env python3
"""Scratch: list every `jal F0x8001ae38` (UI-sprite create: a0=id, a1=kind,
a2=x, a3=y) in a st* overlay with const-tracked args, to map which sprite ids
(and from which kind/bank) the status menu creates — hunting the stat/element
icon ids. Reuses overlay_scan's const propagation."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from overlay_scan import load_words, resolve_overlay, track_consts

TARGET = 0x8001AE38


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else "ststatus"
    path, base = resolve_overlay(name)
    words = load_words(path)
    snap = list(track_consts(sorted(words.items())))
    n = 0
    for i, (off, w, regs) in enumerate(snap):
        if (w >> 26) == 3 and ((w & 0x3FFFFFF) << 2) | 0x80000000 == TARGET:
            # args as of AFTER the delay slot
            regs2 = snap[i + 2][2] if i + 2 < len(snap) else regs
            a = [regs2.get(r) for r in (4, 5, 6, 7)]
            fmt = ["?" if v is None else f"{v:#x}" for v in a]
            print(f"file 0x{off:06x} RAM 0x{base + off:08x}: "
                  f"id={fmt[0]} kind={fmt[1]} x={fmt[2]} y={fmt[3]}")
            n += 1
    print(f"total {n} call sites")
    return 0


if __name__ == "__main__":
    sys.exit(main())
