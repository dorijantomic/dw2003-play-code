#!/usr/bin/env python3
"""Shared register-tracked zone-registration parser.

Recovers, per stage, every `set_resource(type, id)` registration the overlay
performs by linearly simulating MIPS register writes and watching for a call
through `zonemgr+0x40` (the registrar cell). Unlike the fixed-window matchers
in `extract_zone_grids.zone_id_for_stage` (type 4) and
`extract_story_trigger_grids.type7_id` (type 7) — which assume the id-load,
registrar-load, and call sit in one small instruction window — this walks the
whole overlay instruction-by-instruction, so it also finds registrations whose
setup and call are far apart or route through different registers (e.g. the
type-0 registration in wstag350, where setup is ~40 instructions before the
call and the registrar goes through `$v1`, not `$v0`).

At any `jal`/non-registrar `jalr` the MIPS caller-saved registers are
invalidated, which is what makes this immune to stale-register false
positives that a naive scan would report as phantom extra registrations.

Usage:
  python3 tools/zone_registration.py <stage> [type_val]   # report
"""
import os
import sys
from functools import lru_cache

sys.path.insert(0, os.path.dirname(__file__))
from extract_zone_grids import WSTAG_DIR, wstag_words  # noqa: E402

ZONEMGR = 0x8009B6C4
# $at, $v0-$v1, $a0-$a3, $t0-$t9, $ra
CALLER_SAVED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 31]


def _s16(v):
    """Sign-extend a 16-bit immediate."""
    return v - 0x10000 if v & 0x8000 else v


@lru_cache(maxsize=None)
def registrations(stage):
    """(word_index, a0_type, a1_id) for each call through zonemgr+0x40.

    Cached: parsing an overlay costs a full re-read and re-simulation, and
    callers ask for several types per stage (type_id/type0_id each go through
    here). The result is an immutable tuple so the cache cannot be mutated.
    """
    path = f"{WSTAG_DIR}/wstag{stage}.s"
    if not os.path.exists(path):
        return ()
    words = wstag_words(path)

    reg = {i: None for i in range(32)}
    reg[0] = 0
    isreg = set()  # registers currently holding zonemgr+0x40 (the registrar)
    out = []

    def apply(w):
        if w is None:
            reg.update({r: None for r in range(1, 32)})
            isreg.clear()
            return
        op = w >> 26
        rs, rt, rd = (w >> 21) & 31, (w >> 16) & 31, (w >> 11) & 31
        imm = w & 0xFFFF

        def setr(r, v):
            if r == 0:
                return
            reg[r] = v
            isreg.discard(r)

        if op == 0x00:
            f = w & 0x3F
            if f in (0x20, 0x21):                       # add / addu
                a, b = reg[rs], reg[rt]
                setr(rd, (a + b) & 0xFFFFFFFF if a is not None and b is not None else None)
            elif f == 0x25:                             # or
                a, b = reg[rs], reg[rt]
                setr(rd, (a | b) & 0xFFFFFFFF if a is not None and b is not None else None)
            elif f == 0x08:                             # jr
                pass
            elif f == 0x09:                             # jalr, handled in the loop
                pass
            else:
                setr(rd, None)
        elif op == 0x0F:                                # lui
            setr(rt, imm << 16)
        elif op in (0x08, 0x09):                        # addi / addiu
            a = reg[rs]
            setr(rt, (a + _s16(imm)) & 0xFFFFFFFF if a is not None else None)
        elif op == 0x0D:                                # ori
            a = reg[rs]
            setr(rt, (a | imm) if a is not None else None)
        elif op in (0x0A, 0x0B, 0x0C, 0x0E):            # slti/sltiu/andi/xori
            setr(rt, None)
        elif op in (0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26):   # loads
            # Only a full `lw` (0x23) can pull the registrar function pointer
            # out of the zone manager's +0x40 cell. lb/lh/lbu/lhu/lwl/lwr of
            # the same address yield a fragment or a partial merge, never a
            # callable pointer, so they must not mark the destination as the
            # registrar.
            if op == 0x23 and imm == 0x40 and reg[rs] == ZONEMGR:
                reg[rt] = None
                if rt != 0:
                    isreg.add(rt)
            else:
                setr(rt, None)
        elif op in (0x10, 0x11, 0x12, 0x13):            # COP
            setr(rt, None)
        # stores / branches / j: no GPR write

    i = 0
    n = len(words)
    skip = -1
    while i < n:
        if i == skip:
            i += 1
            continue
        w = words[i]
        if w is not None:
            op, f, rs = w >> 26, w & 0x3F, (w >> 21) & 31
            if op == 0x00 and f == 0x09:                # jalr rs
                apply(words[i + 1] if i + 1 < n else None)
                if rs in isreg:
                    out.append((i, reg[4], reg[5]))
                for r in CALLER_SAVED:
                    reg[r] = None
                isreg.clear()
                skip = i + 1
                i += 1
                continue
            if op == 0x03:                              # jal
                apply(words[i + 1] if i + 1 < n else None)
                for r in CALLER_SAVED:
                    reg[r] = None
                isreg.clear()
                skip = i + 1
                i += 1
                continue
            apply(w)
        else:
            apply(None)
        i += 1
    return tuple(out)


def type_id(stage, type_val):
    """(file#, sub) for the first registration of type_val, or None."""
    for _, a0, a1 in registrations(stage):
        if a0 == type_val and a1 is not None:
            return a1 >> 16, a1 & 0xFFFF
    return None


def type0_id(stage):
    """(file#, sub) for the stage's type-0 registration, or None."""
    return type_id(stage, 0)


def registration_files(stage):
    """The set of distinct pack file numbers this stage registers."""
    return {a1 >> 16 for _, _, a1 in registrations(stage) if a1 is not None}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    st = sys.argv[1]
    if len(sys.argv) >= 3:
        tv = int(sys.argv[2])
        print(type_id(st, tv))
    else:
        for idx, a0, a1 in registrations(st):
            fn = a1 >> 16 if a1 is not None else None
            sub = a1 & 0xFFFF if a1 is not None else None
            print(f"word {idx}: type={a0} id={a1!r} -> file#={fn} sub={sub}")
