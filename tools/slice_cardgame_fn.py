#!/usr/bin/env python3
"""Slice a cardgame-overlay routine out of the normalized assembly BY ADDRESS.

WHY THIS IS NEEDED. The duel's animation commands are reached only through a
method table the overlay builds at RUNTIME (F0x8009D310 assigns 51 constant
function pointers into the view object). Nothing `jal`s them, so the
disassembler's entry-point detection never marked them as functions: they have
no label in exe-decomp/cardgame.norm.s and no file in exe-decomp/cardgame_c/.
That is exactly why engine/systems/card-animation.ts records "no jal or
pointer-table entry in the original" — the table is there, it is just not static.

Every instruction IS in the assembly, addressed by its offset from the overlay
load base 0x80082CB0. This slices from a given address to the routine's
`jr $ra` and its delay slot.

Usage: slice_cardgame_fn.py ADDR [ADDR...]  [--asm PATH] [--max N]
"""

import argparse
import re

BASE = 0x80082CB0
ASM = "exe-decomp/cardgame.norm.s"


def index(path=ASM):
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    idx = {}
    for i, l in enumerate(lines):
        m = re.match(r"\.L0x([0-9a-f]{8}):", l.strip())
        if m:
            idx[int(m.group(1), 16)] = i
    return lines, idx


def slice_fn(lines, idx, addr, cap=400):
    """Instructions from `addr` up to and including the delay slot of jr $ra."""
    off = addr - BASE
    if off not in idx:
        return None
    out, i, seen_jr = [], idx[off], False
    while i < len(lines) and len(out) < cap:
        raw = lines[i].strip()
        i += 1
        if not raw or raw.startswith(".global") or re.match(r"^F0x[0-9a-f]+:$", raw):
            continue
        out.append(raw)
        if seen_jr:                      # we just took the delay slot
            break
        if re.search(r"\bjr\s+\$ra\b", raw):
            seen_jr = True
    return out


def calls(body):
    return re.findall(r"\bjal\s+(F0x[0-9a-f]{8})", "\n".join(body))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("addrs", nargs="+")
    ap.add_argument("--asm", default=ASM)
    ap.add_argument("--max", type=int, default=400)
    ap.add_argument("--summary", action="store_true",
                    help="one line per routine: length, calls, thunk?")
    a = ap.parse_args()

    lines, idx = index(a.asm)
    for s in a.addrs:
        addr = int(s, 16)
        body = slice_fn(lines, idx, addr, a.max)
        if body is None:
            print(f"F0x{addr:08x}: NOT IN ASSEMBLY")
            continue
        cs = calls(body)
        if a.summary:
            # A thunk is a stack frame, one call, and a return: it does nothing
            # of its own and its meaning is entirely its callee's.
            thunk = len(cs) == 1 and len(body) <= 12
            print(f"F0x{addr:08x}  {len(body):3d} insns  "
                  f"{'THUNK->' + cs[0] if thunk else ('calls ' + ','.join(cs) if cs else 'LEAF')}")
        else:
            print(f"\n=== F0x{addr:08x} ({len(body)} instructions) ===")
            for l in body:
                print("  " + l)


if __name__ == "__main__":
    main()
