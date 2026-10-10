#!/usr/bin/env python3
"""Disassemble a PS1 RAM image and search it (the "resident exe" too).

The DW2003 battle command/action library lives at 0x80088xxx-0x8009xxxx. The
decomp `.s` files never covered it, but it is present in any battle RAM image, so
we disassemble it ourselves. capstone's `disasm()` HALTS on the first undecodable
word, so we resync (+4) past data — that is the whole trick.

Run it with capstone available, e.g.:
    ~/.local/bin/uv run --with capstone python3 tools/diag_disasm_ram.py <ram.bin> <cmd> ...

Get a RAM image from a savestate:
    tools/diag_sstate_diff.py extract 1 /tmp/ram1.bin
or use a dump: ~/vm-spike/dumps/bl_s1.bin

Commands:
    show  <lo> <hi>              # linear disassembly of [lo,hi)
    refs  <lo> <hi>             # every code site that materializes an address in [lo,hi)
                                 #   (tracks lui[+addiu/ori] and load/store offsets)
    stores <lo> <hi>           # absolute stores whose target lands in [lo,hi)
    find  <lo> <hi> <a> [b]    # in code window [lo,hi), abs loads+stores hitting [a,b)
"""
import sys
try:
    import capstone
except ImportError:
    sys.exit("need capstone: run via  ~/.local/bin/uv run --with capstone python3 ...")

BASE = 0x80000000
md = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS32 + capstone.CS_MODE_LITTLE_ENDIAN)

def load(path):
    return open(path, "rb").read()

def disasm_all(ram, lo, hi):
    """Yield instructions over [lo,hi), resyncing +4 past undecodable words."""
    a = lo
    while a < hi:
        n = 0
        last = a
        for ins in md.disasm(ram[a - BASE:hi - BASE], a):
            if ins.address >= hi:
                break
            yield ins
            last = ins.address
            n += 1
        a = a + 4 if n == 0 else last + 4

def _track(ram, lo, hi):
    """Generator of (ins, materialized_target_or_None) tracking lui/addiu/ori
    and resolving load/store effective addresses when the base reg is known."""
    upper = {}
    for ins in disasm_all(ram, lo, hi):
        m, ops = ins.mnemonic, ins.op_str
        p = [x.strip() for x in ops.split(",")]
        tgt = None
        if m == "lui" and len(p) == 2:
            try: upper[p[0]] = int(p[1], 0) << 16
            except ValueError: pass
        elif m in ("addiu", "addi", "ori") and len(p) == 3 and p[1] in upper:
            try:
                imm = int(p[2], 0)
                if m != "ori" and imm >= 0x8000: imm -= 0x10000
                upper[p[0]] = tgt = (upper[p[1]] + imm) & 0xffffffff
            except ValueError: pass
        elif m in ("sw","sh","sb","lw","lh","lhu","lb","lbu") and ", " in ops and "(" in ops:
            try:
                _, mem = ops.split(", ", 1)
                offv, breg = mem.split("("); breg = breg.rstrip(")")
                if breg in upper:
                    tgt = (upper[breg] + int(offv, 0)) & 0xffffffff
            except ValueError: pass
        elif p and p[0] in upper and m not in ("lui","addiu","addi","ori"):
            upper.pop(p[0], None)  # clobbered
        yield ins, tgt

def main():
    if len(sys.argv) < 3:
        print(__doc__); return
    ram = load(sys.argv[1]); cmd = sys.argv[2]
    A = lambda i: int(sys.argv[i], 0)
    if cmd == "show":
        for ins in disasm_all(ram, A(3), A(4)):
            print(f"  {hex(ins.address)}: {ins.mnemonic:8} {ins.op_str}")
    elif cmd in ("refs", "stores"):
        lo, hi = A(3), A(4)
        n = 0
        for ins, tgt in _track(ram, 0x80010000, 0x800c0000):
            if tgt is not None and lo <= tgt < hi:
                if cmd == "stores" and ins.mnemonic[0] != "s": continue
                print(f"  {hex(ins.address)}: ->{hex(tgt)}  {ins.mnemonic} {ins.op_str}")
                n += 1
        print(f"# {n} hits")
    elif cmd == "find":
        clo, chi, a = A(3), A(4), A(5)
        b = A(6) if len(sys.argv) > 6 else a + 1
        for ins, tgt in _track(ram, clo, chi):
            if tgt is not None and a <= tgt < b:
                kind = "STORE" if ins.mnemonic[0] == "s" else "load "
                print(f"  {hex(ins.address)} [{kind}] ->{hex(tgt)}  {ins.mnemonic} {ins.op_str}")
    else:
        print(__doc__)

if __name__ == "__main__":
    main()
