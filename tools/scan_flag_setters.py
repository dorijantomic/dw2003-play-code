#!/usr/bin/env python3
"""scan_flag_setters.py — build the verified set_flag producer index from disasm.

The story-progression generator only knew flag producers from step-program
`on_complete` sets (98 stages). But MOST flags are set by `set_flag` *immediates*
inside the per-stage wstag overlays and the resident EXE — invisible to that
extractor. This tool scans the WHOLE disassembly for every `set_flag(id, val)`
callsite and emits the producer index.

set_flag = F0x800165ac. Two calling conventions in the disasm:
  • overlays: indirect through the resident func-ptr at 0x80048ac8 —
        lui  $v0, 0x8005
        li   $a0, <flag_id>
        lw   $v0, -0x7538($v0)   # 0x80048ac8 = set_flag   (-0x7534 = get_flag, ignored)
        jalr $v0
        li   $a1, <value>        # delay slot = value
  • EXE (fns.s): direct  jal F0x800165ac  with $a0/$a1 set nearby.

Only IMMEDIATE ids (`li $a0, imm`) are captured — verified airtight: a tree-wide
scan found ZERO computed-id set_flag callsites, so this index is complete for the
script/overlay path. Flags with no entry here are set (if at all) only via the
table applier F0x80016988 (no resolvable caller) or a gameplay subsystem.

Output: web/assets/data/flag_setters.json
    { "0x4049": [ {"overlay": "wstag646", "val": 1, "line": 51}, ... ], ... }
"""
import os
import re, glob, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm" / "dw2003"
OUT = ROOT / "web/assets/data/flag_setters.json"

SET_PTR = "lw $v0, -0x7538($v0)"   # 0x80048ac8 = set_flag
LI_A0 = re.compile(r"li \$a0, (0x[0-9a-f]+)")
LI_A1 = re.compile(r"li \$a1, (0x[0-9a-f]+)")

# THE SAME POINTER IS REACHED TWO WAYS, and matching only the first form hid
# most of the index. When a routine makes several consecutive `set_flag` calls
# the compiler materialises the OBJECT base 0x80048abc once, keeps it in a
# saved register, and reads the pointer as a field of it:
#
#     addiu $s0, -0x7544        # $s0 = 0x80048abc
#     li    $a0, 0x707e
#     lw    $v0, 0xc($s0)       # 0x80048abc + 0xc == 0x80048ac8 == set_flag
#     jalr  $v0
#     li    $a1, 0x1
#
# `SET_PTR` is a literal string, so it can never match `lw $v0, 0xc($s0)`.
# Measured 2026-08-12 over ~/ddw3/asm/dw2003: the displacement form yields 127
# ids / 130 callsites, the base-relative form yields 210 ids / 272 callsites in
# 65 modules, and 188 of those ids appear ONLY in the base-relative form. The
# fieldstg block at L14916 sets 0x707e, 0x8b19 and 0x400 off one base register
# and was entirely invisible.
#
# Do not widen this to `0x10($base)`: that is 0x80048acc == get_flag, which
# reads a flag and is branched on. The two differ by one displacement.
BASE_MAT  = re.compile(r"addiu \$(\w+), (?:\$\w+, )?-0x7544\b")
BASE_LOAD = re.compile(r"^lw \$(\w+), 0xc\(\$(\w+)\)$")


def mnem(line):
    m = re.match(r"\.L0x[0-9a-f]+:\s*(.*?)\s*(#.*)?$", line)
    return m.group(1) if m else line.strip()


def _delay_slot_value(insns, jalr_i):
    """`set_flag`'s second argument, written in the branch delay slot."""
    if jalr_i + 1 >= len(insns):
        return None
    nxt = insns[jalr_i + 1]
    m = LI_A1.search(nxt)
    if m:
        return int(m.group(1), 16)
    # `move_ $a1, $zr` is a written 0, not an unknown value.
    return 0 if "move_ $a1, $zr" in nxt else None


def scan_overlay(path):
    """Yield (flag_id, val, line_no) for indirect set_flag immediate callsites.

    Both calling forms are matched -- see the note beside `BASE_MAT`.
    """
    insns = [mnem(l) for l in path.read_text(errors="replace").splitlines()]
    last_a0, last_a0_i = None, -99
    base_regs = {}
    for i, ins in enumerate(insns):
        m = BASE_MAT.search(ins)
        if m:
            base_regs[m.group(1)] = i
        m = LI_A0.search(ins)
        if m:
            last_a0, last_a0_i = int(m.group(1), 16), i
            continue
        if last_a0 is None or i - last_a0_i > 8:
            continue

        if SET_PTR in ins:
            for j in range(i + 1, min(len(insns), i + 3)):
                if "jalr $v0" in insns[j]:
                    yield last_a0, _delay_slot_value(insns, j), i + 1
                    break
            continue

        # base-relative form: `lw $dst, 0xc($base)` where $base holds 0x80048abc
        m = BASE_LOAD.match(ins)
        if not m:
            continue
        dst, base = m.group(1), m.group(2)
        # The base register must still be the one we saw materialised. A window
        # keeps a later, unrelated `0xc($s0)` in a long function from pairing
        # with a stale `li $a0`.
        if base not in base_regs or i - base_regs[base] > 12:
            continue
        for j in range(i + 1, min(len(insns), i + 3)):
            if insns[j].strip() == f"jalr ${dst}":
                yield last_a0, _delay_slot_value(insns, j), i + 1
                break


def scan_exe(path):
    """Yield (flag_id, val, line_no) for direct `jal F0x800165ac` callsites."""
    insns = [mnem(l) for l in path.read_text(errors="replace").splitlines()]
    for i, ins in enumerate(insns):
        if "jal F0x800165ac" not in ins:
            continue
        a0 = a1 = None
        for j in range(i, max(0, i - 8), -1):
            m = LI_A0.search(insns[j])
            if m:
                a0 = int(m.group(1), 16)
                break
        for j in range(max(0, i - 4), min(len(insns), i + 2)):
            m = LI_A1.search(insns[j])
            if m:
                a1 = int(m.group(1), 16)
        if a0 is not None:
            yield a0, a1, i + 1


def main():
    if not ASM.exists():
        raise SystemExit(f"disasm not found at {ASM} (expected the markisha64/ddw3 repo)")
    idx = {}

    def add(fid, overlay, val, line):
        idx.setdefault(fid, []).append({"overlay": overlay, "val": val, "line": line})

    for f in sorted(ASM.glob("pro/**/*.s")):
        for fid, val, ln in scan_overlay(f):
            add(fid, f.stem, val, ln)
    fns = ASM / "exe" / "fns.s"
    for fid, val, ln in scan_exe(fns):
        add(fid, "exe/fns", val, ln)

    out = {f"0x{k:x}": v for k, v in sorted(idx.items())}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    n_sites = sum(len(v) for v in out.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} flags, {n_sites} set_flag callsites")


if __name__ == "__main__":
    main()
