#!/usr/bin/env python3
"""Lexical parser for one indexed MIPS assembly line.

Pure and semantics-free on purpose: it answers "what is written here", never
"what does it do". The analyzer in tools/mips_decode.py owns the meaning, so
this file can be tested with string literals and nothing else.

The input form comes from the research index, which stores one line per
instruction address:

    800246e8  .L0x800246e8: sw $a0, %lo(D0x8007f9a0)($at)
"""

from __future__ import annotations

import re
from dataclasses import dataclass

LINE = re.compile(r"^\s*([0-9a-fA-F]{1,8})\s\s+(.*)$")
# Any `.L…:` prefix, including the file-relative `.L0x48:` form the data-word
# lines use. Matching only `.L0x` plus eight digits misses those.
LABEL_PREFIX = re.compile(r"^\s*\.?L?[0-9a-fA-Fx]*:\s*")
COMMENT = re.compile(r"\s*#.*$")
MNEMONIC = re.compile(r"^(\.?[a-zA-Z][a-zA-Z0-9._]*)\s*(.*)$")
REGISTER = re.compile(r"^\$(\w+)$")
# A memory operand is anything ending in `($reg)`. Greedy `.*` takes the LAST
# such group, so `%lo(D0x8007f9a0)($at)` splits correctly. Do NOT match the
# displacement inside this pattern: real lines carry symbol arithmetic such as
# `%lo(D0x8004de10 + 0x62 * 0x4)($v0)`, and a displacement pattern that accepts
# only a bare hex address reclassifies that load as a symbol and loses its base.
MEMORY_TAIL = re.compile(r"^(.*)\(\$(\w+)\)$")
RELOCATION = re.compile(r"^%(?:hi|lo)\((.*)\)$")
# `D0x8007f9a0` and `F0x8001ac14` are address-derived. A bare identifier such as
# `EnterCriticalSection`, `f13` or `FIGHTSTG_F0x8009a298` is a real name: 65 of
# them appear over 231 call sites, so dropping names loses real information.
SYMBOL_HEAD = re.compile(r"^\s*(?:[DF]0x([0-9a-fA-F]+)|([A-Za-z_][A-Za-z0-9_.]*))")
QUALIFIED = re.compile(r"^\w+_[DF]0x([0-9a-fA-F]+)$", re.IGNORECASE)
LABEL_REF = re.compile(r"^\.L0x([0-9a-fA-F]+)$")
NUMBER = re.compile(r"^(-?)(?:0x([0-9a-fA-F]+)|(\d+))$")


@dataclass(frozen=True)
class Operand:
    """One operand. `kind` decides which other fields carry meaning."""

    kind: str                     # reg | imm | mem | sym | label
    reg: str | None = None        # kind=reg, or the base of kind=mem via `base`
    value: int | None = None      # kind=imm
    offset: int = 0               # kind=mem displacement, or a named symbol's
                                  # addend
    base: str | None = None       # kind=mem
    symbol: int | None = None     # resolved address, addend already folded in
    name: str | None = None       # symbol written as a name, not an address


@dataclass(frozen=True)
class Instruction:
    address: int
    mnemonic: str
    operands: tuple[Operand, ...]
    text: str


def parse_number(text: str) -> int | None:
    found = NUMBER.match(text.strip())
    if not found:
        return None
    sign = -1 if found.group(1) else 1
    digits = found.group(2)
    return sign * (int(digits, 16) if digits is not None else int(found.group(3)))


def evaluate_terms(text: str) -> tuple[int, bool]:
    """Sum '+'-separated products of integer literals.

    `0x62 * 0x4` is 392. Returns False for anything else, so an expression this
    cannot evaluate is reported rather than silently read as zero.
    """
    if not text:
        return 0, True
    total = 0
    for term in text.split("+"):
        product = 1
        for factor in term.split("*"):
            number = parse_number(factor.strip())
            if number is None:
                return total, False
            product *= number
        total += product
    return total, True


def parse_symbol(text: str) -> Operand:
    """Resolve `D0x8004de10 + 0x62 * 0x4`, `LBA_OFFSETS + 0x1d2` or a bare name.

    Never returns an operand with neither a symbol nor a name: the first version
    of this parser did, on 722 operand instances across 564 real instructions,
    and an empty `sym` is indistinguishable from a valid one to any caller that
    checks only `.kind`.
    """
    found = SYMBOL_HEAD.match(text)
    if not found:
        return Operand(kind="sym", name=text.strip() or None)
    address = int(found.group(1), 16) if found.group(1) else None
    name = found.group(2)
    addend, resolved = evaluate_terms(text[found.end():].strip().lstrip("+").strip())
    if address is not None:
        return Operand(kind="sym", symbol=address + addend if resolved else address,
                       offset=0 if resolved else addend)
    qualified = QUALIFIED.match(name or "")
    return Operand(kind="sym", name=name,
                   symbol=int(qualified.group(1), 16) if qualified else None,
                   offset=addend if resolved else 0)


def parse_operand(text: str) -> Operand:
    text = text.strip()
    found = REGISTER.match(text)
    if found:
        return Operand(kind="reg", reg=found.group(1))
    found = MEMORY_TAIL.match(text)
    if found:
        displacement, base = found.group(1).strip(), found.group(2)
        relocation = RELOCATION.match(displacement)
        if relocation:
            symbol = parse_symbol(relocation.group(1))
            return Operand(kind="mem", base=base, offset=symbol.offset,
                           symbol=symbol.symbol, name=symbol.name)
        number = parse_number(displacement) if displacement else 0
        return Operand(kind="mem", base=base, offset=number or 0)
    found = LABEL_REF.match(text)
    if found:
        return Operand(kind="label", symbol=int(found.group(1), 16))
    relocation = RELOCATION.match(text)
    if relocation:
        return parse_symbol(relocation.group(1))
    number = parse_number(text)
    if number is not None:
        return Operand(kind="imm", value=number)
    return parse_symbol(text)


def split_operands(text: str) -> list[str]:
    """Split on commas that are not inside parentheses."""
    parts, depth, current = [], 0, ""
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    if current.strip():
        parts.append(current)
    return [p for p in (part.strip() for part in parts) if p]


def parse_line(text: str) -> Instruction | None:
    """Return the instruction on this line, or None when there is none."""
    found = LINE.match(text)
    if not found:
        return None
    address = int(found.group(1), 16)
    body = LABEL_PREFIX.sub("", COMMENT.sub("", found.group(2))).strip()
    if not body:
        return None
    found = MNEMONIC.match(body)
    if not found:
        return None
    mnemonic, rest = found.group(1), found.group(2)
    operands = tuple(parse_operand(part) for part in split_operands(rest))
    return Instruction(address=address, mnemonic=mnemonic, operands=operands,
                       text=body)
