#!/usr/bin/env python3
"""Inventory of the objects each stage overlay builds for itself.

Every `wstag*.s` overlay is one field stage's program: its event scripts, its
door/warp/NPC tables, and -- the part this tool reads -- the list of extra
objects the stage spawns for itself (falling rocks, geysers, moving platforms,
rotating fans, ...).

HOW A STAGE SPAWNS ONE OF ITS OWN OBJECTS
------------------------------------------
The stage calls the shared resident object allocator `F0x800143dc` (or its
three-argument wrapper `F0x80014504`, which is the same routine with the
fourth argument forced to 0) with the stage's OWN tick routine as the first
argument.  `F0x800143dc` stores that pointer at object+0x48
(`exe/fns.s:0x800143e4` `move_ $s4, $a0`, `:0x800144bc` `sw $s4, 0x48($s0)`),
and the object runner calls through it: `exe/fns.s:0x800181a8` `lw $v0, 0x48($s0)`
/ `:0x800181b0` `jalr $v0`.  So the tick is the object's identity: two create
calls with the same tick are the same kind of thing, whatever they are called.

s415's rockfall is the worked example (`~/ddw3/asm/dw2003/pro/wstag415.s`,
builder at file offset 0x450 = 0x800a6230):

    .L0x00000450: addiu $sp, -0x18                    # .word 0x27bdffe8
    .L0x00000454: move_ $a3, $a0                      # .word 0x00803821
    .L0x00000458: lui $a0, 0x800a                     # .word 0x3c04800a
    .L0x0000045c: addiu $a0, 0x5fa8                   # .word 0x24845fa8
    .L0x00000460: li $a1, 0x74                        # .word 0x24050074
    .L0x00000464: sw $ra, 0x10($sp)                   # .word 0xafbf0010
    .L0x00000468: jal F0x800143dc                     # .word 0x0c0050f7
    .L0x0000046c: move_ $a2, $zr                      # .word 0x00003021

$0x68 is the call, $0x6c is its delay slot, and the tick is $a0 = 0x800a5fa8
(`lui $a0, 0x800a` + `addiu $a0, 0x5fa8` -- the whole pair, not the low half).

WHAT THIS TOOL DOES
-------------------
For all 294 overlays:
  * find every `jal F0x800143dc` / `jal F0x80014504`;
  * resolve the tick each call attaches, reading BACKWARDS from the call so a
    argument store in the delay slot wins over an earlier one;
  * read the tick's own body, from its address to its own `jr $ra` (+ delay slot);
  * NORMALISE it: any constant that points into this overlay becomes `#OVL`, and
    any `jal`/`j` target inside the overlay becomes `#OVL`.  Resident `jal`
    targets are KEPT, because they say what the tick calls on the shared system;
  * group ticks by the hash of the normalised token stream.  One hash = one
    family = one kind of object, in however many stages.

Every overlay whose create calls could not be read is printed with the reason.
A count of zero is never treated as evidence here: an overlay with no create
call and an overlay whose create call could not be read are different lines in
the report.

Usage:
    python3 tools/inventory_stage_objects.py             # summary to stderr
    python3 tools/inventory_stage_objects.py --stats     # per-stage table
    python3 tools/inventory_stage_objects.py --unread    # only unread overlays
    python3 tools/inventory_stage_objects.py --out data/stage_object_families.json
    python3 tools/inventory_stage_objects.py --stage s415 --show-family HASH
"""

import os
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"

# Every stage overlay is loaded at this address (tools/wstag_extract.py
# `_OVERLAY_BASE`), which is why a file-relative `.L0x00000xxx` label in
# wstagNNN.s is 0x800A5DE0 + xxx.
OVERLAY_BASE = 0x800A5DE0

# The shared object allocator and its 3-argument wrapper.  Both take the tick
# as $a0 and put it at object+0x48.
CREATE_ROUTINES = {
    "F0x800143dc": 0x800143DC,
    "F0x80014504": 0x80014504,
}
CREATE_CALLS = {"jal " + name for name in CREATE_ROUTINES}

LINE_RE = re.compile(r"^\.L0x([0-9a-f]{8}):\s*(.*)$")
DATA_RE = re.compile(r"^\.word (0x[0-9a-fA-F]+)")

# Registers, in the canonical order, so a normalised token stream does not
# depend on the disassembler's spelling.
REGISTERS = (
    "$zero", "$at", "$v0", "$v1", "$a0", "$a1", "$a2", "$a3",
    "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
    "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
    "$t8", "$t9", "$k0", "$k1", "$gp", "$sp", "$fp", "$ra",
)
# How each mnemonic names the register it writes (index 0 = destination).
WRITES = {
    "lui": 0, "addiu": 0, "addi": 0, "ori": 0, "li": 0, "move_": 0,
    "addu": 0, "subu": 0, "and": 0, "andi": 0, "or": 0, "xori": 0,
    "sll": 0, "srl": 0, "sra": 0, "sllv": 0, "srlv": 0, "srav": 0,
    "mult": -1, "multu": -1, "div": -1, "divu": -1, "mflo": 0, "mfhi": 0,
    "lui": 0, "lb": 0, "lbu": 0, "lh": 0, "lhu": 0, "lw": 0, "lwl": 0, "lwr": 0,
    "sb": 0, "sh": 0, "sw": 0, "swl": 0, "swr": 0, "ll": 0, "sc": 0,
    "lwc2": 0, "swc2": 0, "lwc1": 0, "swc1": 0, "mtc1": 0, "mfc1": 0,
    "ctc1": 0, "cfc1": 0, "cache": 0,
}


WORD_COMMENT_RE = re.compile(r"^\s*([a-z][a-z0-9._]*\b.*)$")
MNEUMONIC_RE = re.compile(r"^[a-z][a-z0-9._]*$")


def parse_overlay(stage):
    """`{'ins': {off: text}, 'words': {off: int}, 'size': n, 'raw_words': bool}`.

    Data words (the tables) are kept apart from instructions: a `.word` line in
    this corpus carries a code-shaped comment (`# lb $t2, 0x6684($zr)`) that is
    the disassembler guessing, and treating it as an instruction is exactly how
    a table gets mistaken for a routine.

    17 of the 294 overlays come out of the disassembler with NO resolved
    mnemonic at all -- their whole body is `.word` lines whose trailing comment
    is the decoder's own text.  For those the comment IS the disassembly (same
    decoder, no symbol names resolved), so it is promoted to instruction text and
    the overlay is flagged `raw_words` in the report: a family found only in such
    an overlay rests on weaker text than one found in a resolved overlay.
    """
    path = ASM_DIR / ("wstag%s.s" % stage)
    if not path.exists():
        return None
    ins, words, comments = {}, {}, {}
    for raw in path.read_text().splitlines():
        m = LINE_RE.match(raw)
        if not m:
            continue
        off = int(m.group(1), 16)
        head, sep, tail = m.group(2).partition("#")
        body = head.strip()
        if not body:
            continue
        dw = DATA_RE.match(body)
        if dw:
            words[off] = int(dw.group(1), 16)
            if sep:
                cm = WORD_COMMENT_RE.match(tail)
                if cm:
                    comments[off] = cm.group(1).strip()
        else:
            ins[off] = body
    raw_words = False
    if not ins and comments:
        for off, text in sorted(comments.items()):
            head = text.split(" ", 1)[0].rstrip(",")
            if MNEUMONIC_RE.match(head):
                ins[off] = text
        raw_words = bool(ins)
    end = max(list(ins) + list(words)) + 4 if (ins or words) else 0
    return {"stage": stage, "ins": ins, "words": words, "size": end,
            "raw_words": raw_words}


def parse_operands(text):
    op, _, rest = text.partition(" ")
    rest = rest.strip()
    if not rest:
        return op, []
    return op, [a.strip() for a in rest.split(",")]


def imm_value(tok):
    """The integer a token denotes, or None.  Handles `0x74`, `-0x21f0`, `%hi(X)`."""
    t = tok.strip()
    if t.startswith("%hi(") or t.startswith("%lo(") or t.startswith("("):
        return None
    try:
        return int(t, 0)
    except ValueError:
        return None


def target_value(tok):
    """The absolute address a branch/jump/call token denotes, or None.

    `jal F0x800143dc` -> 0x800143DC, `jal 0x800a5fa8` -> 0x800a5fa8,
    `j .L0x00000210` -> the file offset (the disassembler only prints local
    labels for conditional branches, which are relative anyway).
    """
    t = tok.strip()
    if t.startswith("F0x"):
        return int(t[1:], 16)
    if re.match(r"^D[01]x[0-9a-fA-F]+$", t):
        # A data-symbol spelling of an address that is often CODE: `jal
        # D0x800a5de0` is the stage's own routine at overlay+0, because the word
        # at overlay+0 happens to equal the overlay base in that stage.  Reading
        # it numerically lets the in-overlay mask treat both spellings alike.
        return int(t[3:], 16)
    if t.startswith("0x"):
        return int(t, 16)
    m = re.match(r"^\.L0x([0-9a-f]{8})$", t)
    if m:
        return None
    return None


def _reg_written(op):
    """Which operand index a mnemonic writes, or None / -1 for "none"/"unknown"."""
    return WRITES.get(op, None)


def routine_start(ov, off):
    """Where the routine containing `off` starts.

    These overlays carry no function-start table, so the boundary is the
    previous routine's `jr $ra` plus its delay slot -- exact for the leaf
    builders this tool cares about, conservative otherwise.  Never returns
    after `off`.
    """
    start = 0
    for o in sorted(x for x in ov["ins"] if x < off):
        if ov["ins"][o].strip() == "jr $ra":
            # `jr $ra` + its delay slot = two words; the next routine starts
            # after both.  Starting at o+4 would swallow the delay slot (which
            # is usually the previous routine's `addiu $sp, N`).
            start = o + 8
    return start


def arg_at(ov, reg, stop):
    """The value of `reg` at `stop` (exclusive) and how it was built.

    A forward constant fold over the enclosing routine.  Only literal-building
    instructions produce a value; every other write CLEARS the destination, so
    an unknown write can never masquerade as a known constant, and a value that
    survives to the call is a value the call really passed.
    """
    start = routine_start(ov, stop)
    state = {"$zero": (0, "hardwired")}
    for off in sorted(o for o in ov["ins"] if start <= o < stop):
        op, args = parse_operands(ov["ins"][off])
        dst = _reg_written(op)
        if dst is None or dst == -1 or dst >= len(args):
            continue
        r = args[dst]
        if r not in REGISTERS:
            continue

        def val(name):
            return state.get(name, (None, None))[0]

        def why(name):
            return state.get(name, (None, None))[1]

        if op == "lui":
            v = imm_value(args[1]) if len(args) > 1 else None
            state[r] = (None, None) if v is None else ((v << 16) & 0xFFFFFFFF,
                                                        "lui high half")
            continue
        if op in ("addiu", "addi"):
            if len(args) >= 3 and args[2] == "$zero":
                state[r] = (val(args[1]), why(args[1]))
                continue
            if len(args) >= 3:
                base, src = val(args[1]), why(args[1])
                iv = imm_value(args[-1])
            else:
                base, src = val(r), why(r)
                iv = imm_value(args[-1])
            if iv is None or not isinstance(base, int):
                state[r] = (None, None)
            else:
                state[r] = ((base + iv) & 0xFFFFFFFF, src)
            continue
        if op == "ori":
            iv = imm_value(args[-1])
            if len(args) >= 3 and args[2] == "$zero":
                state[r] = (val(args[1]), why(args[1]))
            elif len(args) >= 3:
                base = val(args[1])
                state[r] = (iv, "ori immediate") if iv is not None and isinstance(base, int) \
                    else (None, None)
            else:
                state[r] = (iv, "ori immediate")
            continue
        if op == "li":
            v = imm_value(args[-1]) if args else None
            state[r] = (v, "li immediate 0x%x" % v if v is not None else None)
            continue
        if op == "move_":
            src = args[-1]
            state[r] = (val(src), why(src))
            continue
        state[r] = (None, None)
    return state.get(reg, (None, None))


def resolve_tick(ov, call_off):
    """The tick pointer the create call at `call_off` attaches, or a reason.

    The value is read as of the call's DELAY SLOT, because an argument store can
    live there (`wstag415.s:0x800a624c` `move_ $a2, $zr` is the delay slot of the
    `jal` at :0x800a6248).  A tick is accepted only when the folded $a0 lands
    inside this overlay; anything computed from a table, or handed in by the
    caller's own argument, is reported unread with the reason, never dropped.
    """
    lo = OVERLAY_BASE
    hi = OVERLAY_BASE + ov["size"]
    v, why = arg_at(ov, "$a0", call_off + 8)
    if v is not None and lo <= v < hi:
        return v, why or "literal overlay address"
    src = ov["ins"].get(call_off + 4, "")
    tail = "delay slot `%s`" % src if src else "no delay-slot store"
    if v is not None:
        return None, ("$a0 folds to 0x%08x, outside this overlay (%s)"
                      % (v, tail))
    return None, "$a0 is not a literal overlay address at the call (%s)" % tail


def read_routine(ov, tick_off):
    """[(off, text)] for the WHOLE routine that contains `tick_off`.

    Not from `tick_off`: a tick the allocator stores at object+0x48 is often a
    label in the middle of a bigger routine -- wstag232.s:0x800a5f64 opens with
    `li $v0, 0x2` and no frame of its own, and the object runner can only enter
    at a routine's start (its real prologue is :0x800a5ed4).  Reading from the
    tick address would fingerprint a tail and could call two different objects
    one family, so the body starts at the enclosing routine's start.
    """
    start = routine_start(ov, tick_off)
    body = []
    for off in sorted(o for o in ov["ins"] if o >= start):
        body.append((off, ov["ins"][off]))
        op, args = parse_operands(ov["ins"][off])
        if op == "jr" and args and args[0] == "$ra":
            if off + 4 in ov["ins"]:
                body.append((off + 4, ov["ins"][off + 4]))
            return body, True
        if len(body) > 4000:
            return body, False
    return body, False


def _propagate(ov, body):
    """Constant value per register after each instruction, plus its source.

    Returns `(values, lui_offsets_in_overlay)`:
      * `values[i]` is `{reg: int|None}` after instruction `i`;
      * `lui_offsets_in_overlay` holds the offsets of the `lui` instructions whose
        high half is completed by an `addiu`/`addi`/`ori` landing INSIDE this
        overlay.  Both halves have to be masked or the same code in two stages
        hashes two different families, because the low half of the pair is a
        different number in each overlay.
    """
    lo, hi = OVERLAY_BASE, OVERLAY_BASE + ov["size"]
    regval = {"$zero": 0}
    src_of = {"$zero": None}
    values, masked_lui = [], set()
    for off, text in body:
        op, args = parse_operands(text)
        dst = _reg_written(op)
        if dst is None or dst == -1 or dst >= len(args):
            values.append(dict(regval))
            continue
        r = args[dst]
        if r not in REGISTERS:
            values.append(dict(regval))
            continue
        base, base_off = regval.get(r), src_of.get(r)

        def carry(value, offset):
            regval[r] = value
            src_of[r] = offset
            if (isinstance(value, int) and lo <= value < hi
                    and offset is not None and offset != off):
                masked_lui.add(offset)

        if op == "lui" and len(args) > 1:
            v = imm_value(args[1])
            carry(None if v is None else (v << 16) & 0xFFFFFFFF, off)
        elif op in ("addiu", "addi") and len(args) >= 3 and args[2] == "$zero":
            regval[r] = regval.get(args[1])
            src_of[r] = src_of.get(args[1])
        elif op in ("addiu", "addi") and len(args) >= 2:
            src_reg = args[1] if len(args) >= 3 else r
            v = imm_value(args[-1])
            b = regval.get(src_reg)
            b_off = src_of.get(src_reg) if src_reg != r else base_off
            if v is None or not isinstance(b, int):
                regval[r] = None
                src_of[r] = None
            else:
                carry((b + v) & 0xFFFFFFFF, b_off)
        elif op == "ori" and len(args) == 2:
            v = imm_value(args[1])
            carry(v, off)
        elif op == "ori" and len(args) >= 3 and args[2] == "$zero":
            regval[r] = regval.get(args[1])
            src_of[r] = src_of.get(args[1])
        elif op == "li":
            v = imm_value(args[-1]) if args else None
            carry(v, off)
        elif op == "move_":
            regval[r] = regval.get(args[-1])
            src_of[r] = src_of.get(args[-1])
        else:
            regval[r] = None
            src_of[r] = None
        values.append(dict(regval))
    return values, masked_lui


def normalise(ov, body):
    """Token stream with everything that names this overlay masked out.

    Masks, all three needed or one code in two stages hashes two families:
      * an immediate that IS an overlay address;
      * the low half of a `lui`+`addiu`/`ori` pair that together make one (both
        halves are masked -- the high half is the same `0x800a` everywhere and
        the low half is the stage's own table offset);
      * a `jal`/`j`/branch target inside the overlay, in either its numeric or
        its `D0x` data-symbol spelling.
    Keeps: mnemonics, register names, small constants, and every `jal` target
    OUTSIDE the overlay, because those say what the tick calls on shared code.
    """
    lo = OVERLAY_BASE
    hi = OVERLAY_BASE + ov["size"]
    _, masked_lui = _propagate(ov, body)
    tokens = []
    for off, text in body:
        op, args = parse_operands(text)
        out_args = []
        for a in args:
            t = a.strip()
            v = imm_value(t)
            if v is not None and lo <= v < hi:
                t = "#OVL"
            elif off in masked_lui and op == "lui":
                t = "#OVL"
            elif op in ("jal", "j", "b", "beq", "bne", "bgtz", "bltz", "bgez",
                        "blez", "bgtzu", "blezu", "beqz", "bnez", "beql", "bnel",
                        "bal", "bc", "bcz"):
                tv = target_value(t)
                if tv is not None and lo <= tv < hi:
                    t = "#OVL"
            if t.startswith(".L0x"):
                # A local label is a file offset, so it moves whenever the stage
                # program's layout moves. It says nothing about the behaviour.
                t = "#LBL"
            out_args.append(t)
        tokens.append("%s %s" % (op, ", ".join(out_args)) if out_args else op)
    return tokens


def family_hash(tokens):
    return hashlib.sha1("\n".join(tokens).encode("ascii", "replace")).hexdigest()[:12]


def raw_hash(body):
    """Hash of the tick's instructions with NOTHING masked.

    Reported beside the family hash so a reader can see how many genuinely
    distinct code texts a family covers.  The 167-stage family is 7 distinct
    texts that differ only in local-label offsets; a family of per-stage copies
    of one system is 1 text per stage.
    """
    return hashlib.sha1("\n".join(t for _, t in body).encode("ascii", "replace")
                        ).hexdigest()[:12]


def globals_in(body):
    """The resident globals (D0x/D1x symbols) a body reads."""
    names = set()
    for _, text in body:
        for m in re.finditer(r"%hi\((D[01]x[0-9a-f]+)\)|%lo\((D[01]x[0-9a-f]+)\)", text):
            names.add(m.group(1) or m.group(2))
    return sorted(names)


_OWNER_CACHE = None


def _owner_index():
    """file -> (min absolute label, max absolute label), for every non-stage .s.

    Stage overlays are EXCLUDED: their labels are file-relative (`wstag_extract.py`
    `_OVERLAY_BASE`), so their labels would look like a range at 0x00000000.
    """
    global _OWNER_CACHE
    if _OWNER_CACHE is not None:
        return _OWNER_CACHE
    index = {}
    paths = list(ASM_DIR.glob("*.s"))
    paths.append(ASM_DIR.parent / "exe" / "fns.s")
    for p in paths:
        if p.stem.startswith("wstag"):
            continue
        lo = hi = None
        try:
            with p.open() as fh:
                for line in fh:
                    m = LINE_RE.match(line)
                    if not m:
                        continue
                    a = int(m.group(1), 16)
                    if lo is None or a < lo:
                        lo = a
                    if hi is None or a > hi:
                        hi = a
        except OSError:
            continue
        if lo is not None:
            index[p.stem] = (lo, hi)
    _OWNER_CACHE = index
    return index


def owner_of(addr):
    """Which source file a numeric address belongs to, or None."""
    for name, (lo, hi) in _owner_index().items():
        if lo <= addr <= hi:
            return name
    return None


def name_target(tok):
    """`jal F0x800143dc` stays as it is; a numeric target gets its owner."""
    t = tok.strip()
    if not t.startswith("0x"):
        return t
    a = int(t, 16)
    return "%s+%s" % (owner_of(a) or "?", t)


def resident_calls(body, lo, hi):
    """`{'jal': [targets outside this overlay], 'jalr': n, 'self': n}` for a tick.

    `self` counts a call the tick loads out of the object it was handed, which is
    how a stage's own object calls its own method rather than a shared service.
    """
    jal, jalr, selfcalls = [], 0, 0
    pending = None
    for _, text in body:
        op, args = parse_operands(text)
        if op in ("lw", "lhu", "lbu", "lh", "lb"):
            pending = args[1] if len(args) > 1 else None
            continue
        if op == "jalr":
            jalr += 1
            if pending and pending.startswith("0x") and pending.endswith("($a0)"):
                selfcalls += 1
            pending = None
            continue
        # Only a write or a control transfer can invalidate the load we saw.
        if _reg_written(op) is not None or op in ("j", "jr", "jal", "b", "beq",
                                                  "bne", "beqz", "bnez", "bgtz",
                                                  "bltz", "bgez", "blez"):
            pending = None
        if op == "jal" and args:
            tv = target_value(args[0])
            if tv is not None and not (lo <= tv < hi):
                jal.append(name_target(args[0]))
    return {"jal": sorted(set(jal)), "jalr": jalr, "self": selfcalls}


# ── "does the walker already port this?" ──────────────────────────────────
# The mark is a CITATION search, not a proof of behaviour, and it is recorded
# with the file that justifies it so a reader can check it:
#   ported  -- a file that ships game logic (engine/**, web/*.js|ts|mjs,
#              web/vendor/engine.js) names one of this family's tick addresses
#              as a whole token ON A LINE THAT CALLS IT A TICK (`tick`, `TICK`,
#              `handler`, `routine`, `entry`, `callback`, `call`, `dispatch`)
#              or assigns it to a named constant;
#   partial -- nothing shipped names a tick address, but something shipped names
#              the family hash, i.e. the family is tracked by name in code;
#   none    -- neither.
# Addresses within NEAR_BASE of the overlay load base are EXCLUDED from the
# citation test: `0x800A5DE0` is the load base every stage overlay shares
# (tools/wstag_extract.py `_OVERLAY_BASE`), so `0x800A5DE4` appearing in
# engine/dw3/ui/native/help-menu-launcher.ts is that constant, not a citation of
# this family's tick.  Generated/derived data (web/system-status.json) is not
# evidence of anything and is skipped.
SHIP_DIRS = ["engine", "web"]
SKIP_SUFFIX = ("system-status.json",)
SKIP_DIR_PARTS = ("node_modules", "assets", "assets-hd", "captures", "docs",
                  "fixtures", "testdata")
MAX_BYTES = 4 * 1024 * 1024
NEAR_BASE = 0x20
# A bare address is not a citation of the tick.  The line must BIND the address
# to a name that says it is the tick: `HELP_TICK_S210 = 0x800a5e74`,
# `tick: 0x800a5e74`.  A line that merely mentions the address next to something
# else -- `jumpTable: 0x800a5e40`, `foldTickCell: 0x800aa090` -- is recorded in
# `address_hits_not_naming_a_tick` and does NOT count, because those cells are
# not the routine the allocator stores at object+0x48.
# `address` is on this list on evidence, not on taste:
# engine/dw3/ui/native/help-menu-launcher.ts:163 binds
# `{ module: "pro/wstag210", address: 0x800a5e74, ... }` and :58 binds
# `export const HELP_TICK_S210 = 0x800a5e74;` -- the same address for the same
# stage, so a row's `address` IS the tick the allocator installs.
TICK_BINDING_RE = re.compile(
    r"(?i)\b(?:[A-Za-z_$][\w$]*)?(?:tick|handler|routine|callback|dispatch"
    r"|update|entry|address|task)[\w$]*\s*[:=]\s*(0x[0-9a-f]+)")


def shipped_files():
    out = []
    for d in SHIP_DIRS:
        root = REPO / d
        if not root.is_dir():
            continue
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.is_symlink():
                continue
            rel = p.relative_to(REPO).as_posix()
            if rel in SKIP_SUFFIX or p.name in SKIP_SUFFIX:
                continue
            if any(part in SKIP_DIR_PARTS for part in p.relative_to(REPO).parts):
                continue
            if p.suffix not in (".ts", ".js", ".mjs", ".tsx"):
                continue
            try:
                if p.stat().st_size > MAX_BYTES:
                    continue
                out.append((rel, p.read_text(errors="replace")))
            except OSError:
                continue
    return out


def addr_forms(addr):
    """Whole-token spellings of an address, for a citation search."""
    forms = set()
    for text in ("0x%08x" % addr, "0x%08X" % addr, "0x%x" % addr, "0x%X" % addr):
        forms.add(re.escape(text))
    return sorted(forms)


ADDR_TOKEN_RE = re.compile(r"(?<![0-9a-z])(0x[0-9a-f]{6,8})(?![0-9a-z])", re.I)
STAGE_TOKEN_RE = re.compile(r"(?<![0-9a-z])(?:wstag|s)?0*(\d+)(?![0-9a-z])", re.I)


def port_marks(families, ship):
    """Attach `ported` / `partial` / `none` plus the citing files, per family.

    ONE pass over the shipped tree.  Every address-shaped token on every line is
    looked up in a set of the families' tick addresses; only the lines that hit
    are then examined for a tick binding and a stage name.  (The naive version --
    every tick against every file -- is 432 x 2000 file scans and does not
    finish.)
    """
    wanted, owner = set(), {}
    for fam in families:
        for mem in fam["create_calls"]:
            key = "0x%08x" % mem["tick"]
            wanted.add(key)
            owner.setdefault(key, set()).add((fam["hash"], mem["stage"]))
    hits = {}
    for rel, text in ship:
        for lineno, line in enumerate(text.splitlines(), 1):
            for tok in ADDR_TOKEN_RE.findall(line):
                key = "0x%08x" % int(tok, 16)
                if key in wanted:
                    hits.setdefault((rel, key), []).append((lineno, line))
    for fam in families:
        by_addr, lines, loose = {}, {}, []
        for mem in fam["create_calls"]:
            tick = mem["tick"]
            if abs(tick - OVERLAY_BASE) < NEAR_BASE:
                continue
            key = "0x%08x" % tick
            for (rel, k), found in hits.items():
                if k != key:
                    continue
                for lineno, line in found:
                    bound = {m.group(1).lower()
                             for m in TICK_BINDING_RE.finditer(line)}
                    named = any(
                        int(s) == int(mem["stage"])
                        for s in STAGE_TOKEN_RE.findall(line))
                    if bound & {key, "0x%x" % tick} and named:
                        by_addr.setdefault(rel, set()).add(key)
                        lines.setdefault(rel, set()).add(
                            "%d: %s" % (lineno, line.strip()[:150]))
                    else:
                        loose.append([rel, "s%s" % mem["stage"], key,
                                      "%d: %s" % (lineno, line.strip()[:110])])
        by_hash = set(rel for rel, text in ship if fam["hash"].lower() in text.lower())
        suppressed = sum(1 for m in fam["create_calls"]
                         if abs(m["tick"] - OVERLAY_BASE) < NEAR_BASE)
        fam["cited_by_address"] = {k: sorted(v) for k, v in sorted(by_addr.items())}
        fam["citation_lines"] = {k: sorted(v)[:3] for k, v in sorted(lines.items())}
        fam["cited_by_family_hash"] = sorted(by_hash)
        fam["ticks_suppressed_as_load_base"] = suppressed
        fam["address_hits_not_naming_a_tick"] = sorted(set(map(tuple, loose)))[:8]
        if by_addr:
            fam["ported"] = "ported"
            fam["mark_basis"] = ("a shipped file binds this tick address to a "
                                 "stage-named tick/handler/address field: "
                                 + ", ".join("%s %s" % (k, sorted(v))
                                             for k, v in sorted(by_addr.items())))
        elif by_hash:
            fam["ported"] = "partial"
            fam["mark_basis"] = ("no tick address cited; the family hash appears in "
                                 + ", ".join(sorted(by_hash)))
        else:
            fam["ported"] = "none"
            fam["mark_basis"] = ("no shipped file under engine/ or web/ binds a tick "
                                 "address of this family to its own stage, and no "
                                 "shipped file names the family hash")
    return families


def scan(stages):
    per_stage, unread, fams = {}, [], {}
    mid_routine_ticks = []
    for stage in stages:
        ov = parse_overlay(stage)
        if ov is None:
            unread.append({"stage": stage, "reason": "no wstag%s.s on disk" % stage,
                           "calls": 0, "unread_calls": 0})
            continue
        calls = []
        reasons = []
        for off in sorted(ov["ins"]):
            if ov["ins"][off] not in CREATE_CALLS:
                continue
            tick, why = resolve_tick(ov, off)
            size, _ = arg_at(ov, "$a1", off + 8)
            rec = {"stage": stage, "call": OVERLAY_BASE + off,
                   "routine": ov["ins"][off].split(" ", 1)[1],
                   "tick": tick, "object_size": size, "why": why,
                   "raw_words_overlay": ov["raw_words"]}
            if tick is not None and not ov["raw_words"] \
                    and (tick - OVERLAY_BASE) in ov["words"]:
                rec["ok"] = False
                reasons.append("tick 0x%08x lands on a table word, not code" % tick)
            elif tick is None:
                rec["ok"] = False
                reasons.append(why)
            else:
                body, closed = read_routine(ov, tick - OVERLAY_BASE)
                mid = (tick - OVERLAY_BASE) != routine_start(
                    ov, tick - OVERLAY_BASE)
                if mid:
                    mid_routine_ticks.append((stage, "0x%08x" % tick))
                if not body:
                    rec["ok"] = False
                    reasons.append("tick 0x%08x has no readable body" % tick)
                else:
                    tokens = normalise(ov, body)
                    h = family_hash(tokens)
                    lo, hi = OVERLAY_BASE, OVERLAY_BASE + ov["size"]
                    fam = fams.setdefault(h, {
                        "hash": h, "members": [], "instructions": len(tokens),
                        "unterminated": 0,
                        "resident": {"jal": set(), "jalr": 0, "self": 0},
                        "globals": set(), "raw": set()})
                    fam["raw"].add(raw_hash(body))
                    if not closed:
                        fam["unterminated"] += 1
                    rc = resident_calls(body, lo, hi)
                    fam["resident"]["jal"].update(rc["jal"])
                    fam["resident"]["jalr"] += rc["jalr"]
                    fam["resident"]["self"] += rc["self"]
                    fam["globals"].update(globals_in(body))
                    fam["members"].append({
                        "stage": stage, "tick": tick, "call": rec["call"],
                        "routine": rec["routine"], "object_size": size,
                        "body_instructions": len(body)})
                    rec["ok"] = True
                    rec["family"] = h
            calls.append(rec)
        per_stage[stage] = calls
        if reasons:
            unread.append({"stage": stage, "reason": reasons[0],
                           "calls": len(calls), "unread_calls": len(reasons)})
    return per_stage, unread, fams, mid_routine_ticks


def build(stages, ship=None):
    per_stage, unread, fams, mid_routine_ticks = scan(stages)
    families = []
    for h, fam in fams.items():
        members = sorted(fam["members"], key=lambda m: (m["stage"], m["tick"]))
        fam_stages = sorted({m["stage"] for m in members})
        examples = {}
        for m in members:
            examples.setdefault(m["stage"], m["tick"])
        families.append({
            "hash": h,
            "members": len(members),
            "stages": fam_stages,
            "stage_count": len(fam_stages),
            "tick_instructions": fam["instructions"],
            "distinct_raw_tick_bodies": len(fam["raw"]),
            "object_sizes": sorted({m["object_size"] for m in members
                                    if isinstance(m.get("object_size"), int)}),
            "ticks_without_jr_ra": fam["unterminated"],
            "resident_jal": sorted(fam["resident"]["jal"]),
            "resident_jalr_calls": fam["resident"]["jalr"],
            "self_method_calls": fam["resident"]["self"],
            "globals": sorted(fam["globals"]),
            "example_tick_per_stage": {k: "0x%08x" % v for k, v in
                                       sorted(examples.items(), key=lambda kv: int(kv[0]))},
            "all_ticks": sorted({"0x%08x" % m["tick"] for m in members}),
            # The normalised token stream itself is NOT stored per family: it is
            # 200 KB x 222 families.  `--family <hash>` prints it, and
            # `tick_sha1` is the same hash, so any body can be reproduced.
            "create_calls": members,
        })
    families.sort(key=lambda f: (-f["stage_count"], -f["members"], f["hash"]))
    if ship is None:
        ship = shipped_files()
    families = port_marks(families, ship)
    summary = {
        "generated_by": "tools/inventory_stage_objects.py",
        "overlay_base": "0x%08X" % OVERLAY_BASE,
        "create_routines": {k: "0x%08X" % v for k, v in CREATE_ROUTINES.items()},
        "tick_argument": "$a0, stored at object+0x48 by F0x800143dc "
                         "(exe/fns.s:0x800143e4, :0x800144bc) and called by the "
                         "object runner (exe/fns.s:0x800181a8, :0x800181b0)",
        "overlays_scanned": len(stages),
        "overlays_with_create_calls": sum(1 for s in per_stage.values() if s),
        "overlays_with_no_create_call": sorted(
            int(s) for s, c in per_stage.items() if not c),
        "create_calls_total": sum(len(c) for c in per_stage.values()),
        "create_calls_read": sum(1 for c in per_stage.values() for r in c if r["ok"]),
        "ticks_that_are_a_label_inside_a_bigger_routine": len(mid_routine_ticks),
        "mid_routine_ticks": sorted(mid_routine_ticks)[:40],
        "families": len(families),
        "unread_overlays": sorted(unread, key=lambda u: int(u["stage"])),
    }
    return summary, families, per_stage


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=None,
                    help="write the family JSON here")
    ap.add_argument("--stats", action="store_true", help="per-stage table")
    ap.add_argument("--unread", action="store_true",
                    help="only the overlays whose create calls were unread")
    ap.add_argument("--stage", default=None, help="show one stage's create calls")
    ap.add_argument("--family", default=None, help="show one family's tick body")
    ap.add_argument("--doc-table", action="store_true",
                    help="print the markdown family table for the research doc")
    ap.add_argument("--no-ship", action="store_true",
                    help="skip the engine/web port scan (faster)")
    args = ap.parse_args(argv)

    stages = sorted((p.stem[5:] for p in ASM_DIR.glob("wstag*.s")), key=int)
    ship = [] if args.no_ship else shipped_files()
    summary, families, per_stage = build(stages, ship)

    if args.unread:
        for u in summary["unread_overlays"]:
            print("s%s: %d create call(s), %d unread -- %s" % (
                u["stage"], u["calls"], u["unread_calls"], u["reason"]))
        return 0

    if args.doc_table:
        # The family table for the research document, in the same order the JSON
        # carries, so the two can be diffed by eye.
        print("| family | stages | create calls | tick insns | distinct raw bodies "
              "| ported | stages |")
        print("|---|---|---|---|---|---|---|")
        for fam in families:
            print("| `%s` | %d | %d | %d | %d | %s | %s |" % (
                fam["hash"], fam["stage_count"], fam["members"],
                fam["tick_instructions"], fam["distinct_raw_tick_bodies"],
                fam["ported"], " ".join("s%s" % s for s in fam["stages"])))
        return 0

    if args.stage:
        stage = args.stage.lstrip("s")
        for rec in per_stage.get(stage, []):
            print("0x%08x %s tick=%s %s" % (
                rec["call"], rec["routine"],
                "0x%08x" % rec["tick"] if rec["tick"] else "?",
                rec["why"]))
        return 0

    if args.family:
        for fam in families:
            if fam["hash"] != args.family:
                continue
            print("family %s  members=%d  stages=%d  %s" % (
                fam["hash"], fam["members"], fam["stage_count"], fam["ported"]))
            print("resident jal: %s" % ", ".join(fam["resident_jal"]))
            print("-- normalised tick --")
            for mem in fam["create_calls"]:
                ov = parse_overlay(mem["stage"])
                body, _ = read_routine(ov, mem["tick"] - OVERLAY_BASE)
                for off, text in body:
                    print("   0x%08x %s" % (OVERLAY_BASE + off, text))
                break
            return 0
        print("no such family", file=sys.stderr)
        return 1

    if args.stats:
        for stage in stages:
            calls = per_stage.get(stage, [])
            if not calls:
                print("s%-4s no create call" % stage)
                continue
            fams_here = sorted({r.get("family") for r in calls if r["ok"]})
            print("s%-4s %2d create call(s), families %s%s" % (
                stage, len(calls), ",".join(fams_here),
                "" if all(r["ok"] for r in calls)
                else "  [%d unread]" % sum(1 for r in calls if not r["ok"])))
        return 0

    print("overlays scanned      : %d" % summary["overlays_scanned"], file=sys.stderr)
    print("with create calls     : %d" % summary["overlays_with_create_calls"],
          file=sys.stderr)
    print("without create calls  : %d  %s" % (
        len(summary["overlays_with_no_create_call"]),
        " ".join("s%d" % s for s in summary["overlays_with_no_create_call"])),
        file=sys.stderr)
    print("create calls          : %d (read %d)" % (
        summary["create_calls_total"], summary["create_calls_read"]), file=sys.stderr)
    print("families              : %d" % summary["families"], file=sys.stderr)
    print("overlays with unread calls: %d" % len(summary["unread_overlays"]),
          file=sys.stderr)
    print("family table (stage_count, members, ported, resident jal):",
          file=sys.stderr)
    for fam in families[:80]:
        print("  %s  stages=%-3d members=%-3d %-7s %s" % (
            fam["hash"], fam["stage_count"], fam["members"], fam["ported"],
            ",".join(fam["resident_jal"][:4])), file=sys.stderr)
    if len(families) > 80:
        print("  ... %d more families" % (len(families) - 80), file=sys.stderr)

    if args.out:
        payload = dict(summary)
        payload["families"] = families
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=1) + "\n")
        print("wrote %s" % args.out, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())