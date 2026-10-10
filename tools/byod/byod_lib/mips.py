"""MIPS-I (R3000) word -> text, in the assembler dialect ddw3's asm/*.s files use.

Our own decoder (no third-party disassembler): ddw3's syntax is gas-like with a few
conventions of its own -- `$zr` for r0, 2-operand forms when rd == rs, `li` for
`addiu rt, $zr, imm`, `move_` for `addu rd, rs, $zr`, `(base)` for a zero offset,
absolute `jal`/`j` targets and `.L0x%08x` branch labels.
"""
from __future__ import annotations

REG = ["$zr", "$at", "$v0", "$v1", "$a0", "$a1", "$a2", "$a3",
       "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
       "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
       "$t8", "$t9", "$k0", "$k1", "$gp", "$sp", "$fp", "$ra"]


def shex(v: int) -> str:
    return f"-{-v:#x}" if v < 0 else f"{v:#x}"


def s16(v: int) -> int:
    return v - 0x10000 if v & 0x8000 else v


class Insn:
    """Decoded instruction. `text` is ddw3-dialect text with branch targets as
    `.L0x%08x` of `label_of(target)` and jumps as absolute hex."""
    __slots__ = ("word", "mn", "ops", "kind", "target", "rt", "rs", "rd", "imm")

    def __init__(self, word):
        self.word = word
        self.mn = None
        self.ops = []
        self.kind = None   # 'branch' | 'jump' | 'mem' | 'imm' | 'lui' | None
        self.target = None


def _mem(rt, imm, rs):
    off = "" if imm == 0 else shex(imm)
    return f"{rt}, {off}({rs})"


def decode(word: int, pc: int):
    """Return (mnemonic, operand-string, info) or None when the word is not a valid insn.
    `pc` is the RAM address of the word (for branch targets)."""
    op = word >> 26
    rs = (word >> 21) & 31
    rt = (word >> 16) & 31
    rd = (word >> 11) & 31
    sa = (word >> 6) & 31
    fn = word & 63
    imm = word & 0xFFFF
    simm = s16(imm)
    R = REG
    if op == 0:
        if word == 0:
            return ("nop", "", None)
        if fn == 0 and rs == 0:  # sll
            return _shift("sll", rd, rt, sa)
        if fn == 2 and rs == 0:
            return _shift("srl", rd, rt, sa)
        if fn == 3 and rs == 0:
            return _shift("sra", rd, rt, sa)
        if fn in (4, 6, 7) and sa == 0:
            mn = {4: "sllv", 6: "srlv", 7: "srav"}[fn]
            return (mn, f"{R[rd]}, {R[rt]}, {R[rs]}", None)
        if fn == 8 and rt == 0 and rd == 0 and sa == 0:
            return ("jr", R[rs], None)
        if fn == 9 and rt == 0 and sa == 0:
            if rd == 31:
                return ("jalr", R[rs], None)
            return ("jalr", f"{R[rd]}, {R[rs]}", None)
        if fn == 12:
            code = (word >> 6) & 0xFFFFF
            return ("syscall", "" if code == 0 else f"{code:#x}", None)
        if fn == 13:
            code = (word >> 6) & 0xFFFFF
            return ("break", "" if code == 0 else f"{code:#x}", None)
        if fn in (16, 18) and rs == 0 and rt == 0 and sa == 0:
            return ({16: "mfhi", 18: "mflo"}[fn], R[rd], None)
        if fn in (17, 19) and rt == 0 and rd == 0 and sa == 0:
            return ({17: "mthi", 19: "mtlo"}[fn], R[rs], None)
        if fn in (24, 25, 26, 27) and rd == 0 and sa == 0:
            mn = {24: "mult", 25: "multu", 26: "div", 27: "divu"}[fn]
            if mn in ("div", "divu"):
                return (mn, f"$zr, {R[rs]}, {R[rt]}", None)
            return (mn, f"{R[rs]}, {R[rt]}", None)
        if 32 <= fn <= 43 and sa == 0 and fn not in (40, 41):
            mn = {32: "add", 33: "addu", 34: "sub", 35: "subu", 36: "and", 37: "or",
                  38: "xor", 39: "nor", 42: "slt", 43: "sltu"}[fn]
            if mn == "addu" and rt == 0:
                return ("move_", f"{R[rd]}, {R[rs]}", None)
            if mn == "addu" and rs == 0:
                return ("move_", f"{R[rd]}, {R[rt]}", None)
            if mn in ("subu", "sub") and rs == 0:
                n = "negu" if mn == "subu" else "neg"
                return (n, R[rd] if rd == rt else f"{R[rd]}, {R[rt]}", None)
            if rd == rs and mn != "nor":
                return (mn, f"{R[rd]}, {R[rt]}", None)
            return (mn, f"{R[rd]}, {R[rs]}, {R[rt]}", None)
        return None
    if op == 1:
        mn = {0: "bltz", 1: "bgez", 16: "bltzal", 17: "bgezal"}.get(rt)
        if mn is None:
            return None
        t = (pc + 4 + (simm << 2)) & 0xFFFFFFFF
        return (mn, f"{R[rs]}, @{t:08x}", ("branch", t))
    if op in (2, 3):
        t = ((pc + 4) & 0xF0000000) | ((word & 0x3FFFFFF) << 2)
        return ("j" if op == 2 else "jal", f"{t:#x}", ("jump", t))
    if op in (4, 5):
        t = (pc + 4 + (simm << 2)) & 0xFFFFFFFF
        mn = "beq" if op == 4 else "bne"
        if rt == 0:
            return (mn + "z", f"{R[rs]}, @{t:08x}", ("branch", t))
        return (mn, f"{R[rs]}, {R[rt]}, @{t:08x}", ("branch", t))
    if op in (6, 7):
        if rt != 0:
            return None
        t = (pc + 4 + (simm << 2)) & 0xFFFFFFFF
        return ("blez" if op == 6 else "bgtz", f"{R[rs]}, @{t:08x}", ("branch", t))
    if 8 <= op <= 14:
        mn = {8: "addi", 9: "addiu", 10: "slti", 11: "sltiu", 12: "andi", 13: "ori", 14: "xori"}[op]
        val = simm if op <= 11 else imm
        if mn == "addiu" and rs == 0:
            return ("li", f"{R[rt]}, {shex(val)}", ("imm", val))
        if rs == rt:
            return (mn, f"{R[rt]}, {shex(val)}", ("imm", val))
        return (mn, f"{R[rt]}, {R[rs]}, {shex(val)}", ("imm", val))
    if op == 15:
        if rs != 0:
            return None
        return ("lui", f"{R[rt]}, {imm:#x}", ("lui", imm))
    if op == 16 or op == 18:  # cop0 / cop2
        cop = op - 16
        sub = rs
        if word & (1 << 25):
            return (f"cop{cop}", f"{word & 0x1FFFFFF:#x}", None)
        names = {0: "mfc", 2: "cfc", 4: "mtc", 6: "ctc"}
        if sub in names and (word & 0x7FF) == 0:
            return (f"{names[sub]}{cop}", f"{R[rt]}, ${rd}", None)
        return None
    if op in (32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 46):
        mn = {32: "lb", 33: "lh", 34: "lwl", 35: "lw", 36: "lbu", 37: "lhu", 38: "lwr",
              40: "sb", 41: "sh", 42: "swl", 43: "sw", 46: "swr"}[op]
        return (mn, _mem(R[rt], simm, R[rs]), ("mem", simm))
    if op in (50, 58):
        mn = "lwc2" if op == 50 else "swc2"
        return (mn, _mem(f"${rt}", simm, R[rs]), ("mem", simm))
    return None


def _shift(mn, rd, rt, sa):
    if rd == rt:
        return (mn, f"{REG[rd]}, {sa:#x}", None)
    return (mn, f"{REG[rd]}, {REG[rt]}, {sa:#x}", None)


def text(word: int, pc: int, label=lambda t: f".L0x{t:08x}") -> str | None:
    d = decode(word, pc)
    if d is None:
        return None
    mn, ops, info = d
    if info and info[0] == "branch":
        ops = ops.replace(f"@{info[1]:08x}", label(info[1]))
    return f"{mn} {ops}" if ops else mn
