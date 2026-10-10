#!/usr/bin/env python3
"""Mechanical .s generation for the byod tree.

Ports ddw3's tools/objdump_pro.py (the 2023 disassembler that produced every
mechanical file under asm/dw2003/pro; recovered from ddw3 git history) and runs
it with a mipsel objdump. One compatibility shim: binutils >= 2.4x prints
undecodable words as `.word 0x...` in the mnemonic column where the 2023
toolchain printed the bare `0x...`; the raw text is normalized back first.

Usage:
  gen_asm.py --staging <tree>/_disc --objdump-bin <mipsel-objdump> --out <tree> \
             [--compare ~/ddw3/asm/dw2003] [--only a,b,c]
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REGS = ["at", "v0", "v1", "a0", "a1", "a2", "a3", "t0", "t1", "t2", "t3", "t4",
        "t5", "t6", "t7", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "t8",
        "t9", "k0", "k1", "gp", "sp", "s8", "fp", "ra"]


def clean_arg(arg: str):
    if "(" in arg:
        [prefix, arg] = arg.split("(", 1)
        [arg, suffix] = arg.split(")", 1)
        if prefix == "0":
            prefix = ""
        else:
            prefix = hex(int(prefix))
        arg = clean_arg(arg)
        return f"{prefix}({arg}){suffix}"
    if arg == "zero":
        return "$zr"
    if arg in REGS:
        return f"${arg}"
    try:
        return hex(int(arg, 10))
    except ValueError:
        pass
    return arg


def clean_inst(inst: str) -> str:
    if inst in ["move", "b"]:
        return f"{inst}_"
    return inst


def clean_inst_args(inst: str, args):
    inst = clean_inst(inst)
    args = list(map(clean_arg, args))
    if inst.startswith("b") and inst not in ["break"]:
        args[-1] = f".L0x{int(args[-1], 0):08x}"
    if inst.startswith("j"):
        try:
            args[-1] = f"0x{int(args[-1], 0) | 0x80000000:08x}"
        except ValueError:
            pass
    if (inst not in ["sllv", "srlv", "srav", "mult", "multu", "div", "divu"]
            and len(args) >= 2):
        if args[0] == args[1]:
            del args[1]
    if inst == "jalr" and args == ["$zr"]:
        return "jalr_zr", []
    return inst, args


@dataclass
class Line:
    addr: int
    data: int
    inst: str
    args: list

    @staticmethod
    def parse(line: str):
        [addr, rest] = line.split(":\t", 1)
        [data, inst] = rest.split("\t", 1)
        [inst, *args] = inst.split("\t", 1)
        args = "" if len(args) == 0 else args[0]
        args = args.split(",")
        if args == [""]:
            del args[0]
        addr = int(addr.strip(), 16)
        data = int(data.strip(), 16)
        inst = inst.strip()
        args = list(map(str.strip, args))
        inst, args = clean_inst_args(inst, args)
        return Line(addr, data, inst, args)

    def to_data(self) -> str:
        return f".word 0x{self.data:08x}"

    def to_inst(self) -> str:
        arg_prefix = "" if len(self.args) == 0 else " "
        return f"{self.inst}{arg_prefix}{', '.join(self.args)}"


def find_index(predicate, it):
    for idx, value in enumerate(it):
        if predicate(value):
            return idx
    return None


def disassemble(objdump_bin: str, input_path: str, adjust_vma: str) -> str:
    out = subprocess.check_output([
        objdump_bin, "--disassemble-all", "--target=binary",
        "--architecture=mips:3000", f"--adjust-vma={adjust_vma}",
        "--endian=little", "--disassemble-zeroes", input_path,
    ]).decode("utf-8")
    # `.word\t0x2458` (new binutils) -> `0x2458` (2023 toolchain form)
    out = re.sub(r"\t\.word\t(0x[0-9a-f]+)$", lambda m: "\t" + m.group(1), out, flags=re.M)
    return out


def render(objdump_bin: str, input_path: str, name: str, adjust_vma: str = "0x00000000",
           section: str | None = None) -> str:
    output = disassemble(objdump_bin, input_path, adjust_vma)
    output = output.split("\n")[7:]
    output = [line for line in output if len(line) != 0]
    remaining_addr = remaining_bytes = None
    if "is out of bounds." in output[-1]:
        input_bytes = open(input_path, "rb").read()
        remaining_addr = len(input_bytes) - (len(input_bytes) % 4)
        remaining_bytes = input_bytes[remaining_addr:]
        del output[-1]
    lines = list(map(Line.parse, output))
    data_inst_split = find_index(lambda l: l.data >> 0x18 not in [0x00, 0x80], lines)
    if data_inst_split is None:
        raise SystemExit(f"{name}: no data/code split found")
    inst_data_split = data_inst_split + find_index(
        lambda l: len(l.inst) == 0 or l.inst.startswith("0x"), lines[data_inst_split:])
    if inst_data_split is None:
        raise SystemExit(f"{name}: no code/data split found")
    buf = []
    buf.append(f'.include "macros.s"\n')
    buf.append(f'\n.section "{section or ("section_" + name)}"\n')
    buf.append(f".global {name}\n{name}:\n")
    for line in lines[:data_inst_split]:
        buf.append(f".L0x{line.addr:08x}: {line.to_data()} # {line.to_inst()}\n")
    buf.append("# Start of code\n")
    for line in lines[data_inst_split:inst_data_split]:
        buf.append(f".L0x{line.addr:08x}: {line.to_inst(): <35} # {line.to_data()}\n")
    buf.append("# End of code\n")
    for line in lines[inst_data_split:]:
        buf.append(f".L0x{line.addr:08x}: {line.to_data()} # {line.to_inst()}\n")
    if remaining_bytes is not None:
        for i, b in enumerate(remaining_bytes):
            buf.append(f".L0x{remaining_addr + 0x4 * i:08x}: .byte 0x{b:x}\n")
    return "".join(buf)


def pro_targets(staging: Path):
    """committed pro .s stem -> disc .PRO path (get.sh mapping, case-insensitive)."""
    pro_dir = staging / "AAA" / "PRO"
    return {p.stem.lower(): p for p in pro_dir.glob("*.PRO")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--staging", required=True, help="tree _disc staging dir")
    ap.add_argument("--objdump-bin", required=True)
    ap.add_argument("--out", required=True, help="tree dir (asm/ written under it)")
    ap.add_argument("--compare", default=None, help="ddw3 asm/dw2003 dir to diff against")
    ap.add_argument("--only", default=None)
    a = ap.parse_args()

    staging = Path(a.staging).expanduser().resolve()
    out = Path(a.out).expanduser().resolve() / "asm" / "dw2003" / "pro"
    out.mkdir(parents=True, exist_ok=True)
    pro = pro_targets(staging)
    only = set(a.only.split(",")) if a.only else None

    n_ok = n_diff = 0
    for stem in sorted(pro):
        if only and stem not in only:
            continue
        src = pro[stem]
        dst = out / f"{stem}.s"
        text = render(a.objdump_bin, str(src), stem.upper(), section=f"section_{stem.upper()}")
        dst.write_text(text)
        if a.compare:
            ref = Path(a.compare).expanduser() / "pro" / f"{stem}.s"
            if ref.exists():
                same = ref.read_text() == text
                if same:
                    n_ok += 1
                else:
                    n_diff += 1
                    if only or n_diff <= 8:
                        print(f"DIFF {stem}")
    print(f"pro: {len(pro)} inputs; byte-identical={n_ok} differing={n_diff}")


if __name__ == "__main__":
    main()
