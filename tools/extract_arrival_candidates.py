#!/usr/bin/env python3
"""Extract every stage's ARRIVAL DISPATCHER chain as data.

A wstag overlay allocates its own entry object and hands the shared allocator
(F0x80014504 / F0x800143DC) the ADDRESS OF ITS OWN TICK -- that address, not a
shared method pointer or a VM slot, is the object's identity. When that tick's
routine calls `start_event` (jal 0x800853f8) it is the stage's arrival
dispatcher: the routine that decides WHICH event this place starts when you walk
in.

The chain is traced by symbolic execution of the routine: the master story
ordinal is read from [0x8004B370], a literal is compared with it, one or more
`get_flag` (0x80048ACC / 0x80048ABC+0x10) expectations are tested, and the
winning candidate's event id is loaded into $a0 in the deciding branch's DELAY
SLOT (which MIPS executes before the transfer) before the single shared
`jal start_event`. Every ordinal re-read is kept -- it is the same single linear
value, so a re-read repeats the same test and never opens a second dimension.

Output: web/assets/data/scene/arrival_candidates.json
    { stage : { tick, dispatcher{citation}, phase_gate, candidates:[...],
                also:[...], notes } }

Each candidate carries the conjunction that must hold, in chain order, with the
file + label + line of every site that produced it. `order` is the position in
the chain, so "first whole match wins, at most one start per pass" is
expressible directly from this file.

Run: .venv/bin/python3 tools/extract_arrival_candidates.py [--check]
"""
from __future__ import annotations
import os

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OUT = ROOT / "web/assets/data/scene/arrival_candidates.json"
OVERLAY_BASE = 0x800A5DE0

JAL_START_EVENT = 0x0C0214FE        # jal 0x800853f8  (fieldstg start_event)
ALLOCATORS = {0x0C005141: "F0x80014504", 0x0C0050F7: "F0x800143dc"}
ALLOC_ID = 0x0C0050F7
ALLOC_ANY = 0x0C005141
ORDINAL_ABS = 0x8004B370            # the master story ordinal
GETFLAG_ABS = 0x80048ACC            # get_flag function pointer cell
FNBASE_ABS = 0x80048ABC             # flag API table (some overlays index +0x10)
MAX_EVENT_ID = 0xFFF                # plausible event-id ceiling (above = a flag id).
                                    # 0 counts: pro/wstag780.s .L0x1740 really does
                                    # `j start_event` with $a0 = 0 on its no-match arm.
MAX_STATES = 400000                 # path-explosion guard, per dispatcher
MAX_ORDINAL = 0x200                 # plausible story ordinal


# ── overlay image ───────────────────────────────────────────────────────────────────────────────
def load_image(path: Path):
    """Reconstruct the overlay words and every word's .s line number."""
    words: dict[int, int] = {}
    lines: dict[int, int] = {}
    for no, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        m = re.match(r"^\.L0x([0-9a-f]{8}):\s*(.*)$", line)
        if not m:
            continue
        off = int(m.group(1), 16)
        body = m.group(2)
        w = re.search(r"#\s*\.word\s+0x([0-9a-fA-F]{8})", body)
        if not w:
            w = re.match(r"^\.word\s+0x([0-9a-fA-F]{8})", body)
        if w:
            words[off] = int(w.group(1), 16)
            lines[off] = no
    if not words:
        return [], {}
    img = [0] * ((max(words) + 4) // 4)
    for off, w in words.items():
        img[off // 4] = w
    return img, lines


def lab(lines: dict[int, int], idx: int) -> str:
    return ".L0x%08x" % (idx * 4)


def cite(lines: dict[int, int], stage_file: str, idx: int, key: str | None = None) -> dict:
    d = {"file": stage_file, "label": lab(lines, idx)}
    n = lines.get(idx * 4)
    if n:
        d["line"] = n
    if key:
        d[key] = d["label"]
    return d


# ── instruction decode (only the fields the arrival-dispatcher idiom uses) ──────────────────────
def op(w):    return w >> 26
def rs(w):    return (w >> 21) & 0x1F
def rt(w):    return (w >> 16) & 0x1F
def rd(w):    return (w >> 11) & 0x1F
def fn(w):    return w & 0x3F
def imm(w):   return w & 0xFFFF
def simm(w):  i = w & 0xFFFF; return i - 0x10000 if i & 0x8000 else i


def decode(w: int):
    """Small tagged tuple for the instructions this tracer needs."""
    o = op(w)
    if w == JAL_START_EVENT:                             return ("start_event",)
    if w in ALLOCATORS:                                  return ("alloc", ALLOCATORS[w])
    if o == 0x0F:                                        return ("lui", rt(w), imm(w) << 16)
    if o == 0x09:                                        return ("addiu", rt(w), rs(w), simm(w))
    if o == 0x0D:                                        return ("ori", rt(w), rs(w), imm(w))
    if o in (0x23, 0x21, 0x25, 0x20, 0x24):              return ("load", rt(w), rs(w), simm(w))
    if o in (0x2B, 0x29, 0x28):                          return ("store", rt(w), rs(w), simm(w))
    if o == 0x0A:                                        return ("slti", rt(w), simm(w))   # short form
    if o == 0x0B:                                        return ("sltiu", rt(w), simm(w))
    if o == 0x03:   # the .s words carry an absolute target: imm26<<2 | 0x80000000
        return ("jal", 0x80000000 | ((w & 0x03FFFFFF) << 2))
    if o == 0x02:                                        return ("j", 0x80000000 | ((w & 0x03FFFFFF) << 2))
    if o == 0x00 and fn(w) == 0x09:                      return ("jalr", rs(w))
    if o == 0x00 and fn(w) == 0x08:                      return ("jr", rs(w))
    if o == 0x00 and fn(w) in (0x21, 0x25, 0x20):         return ("move", rd(w), rs(w), rt(w))
    if o == 0x04:                                        return ("beq", rs(w), rt(w), simm(w))
    if o == 0x05:                                        return ("bne", rs(w), rt(w), simm(w))
    if o == 0x01:                                        return ("regimm", rt(w), rs(w), simm(w))
    return ("other",)


def is_event(v) -> bool:
    """A literal that could be an event id. 0 is included: pro/wstag780.s:1499-1500
    jumps into the shared start block with $a0 = 0 when no candidate holds, which
    binds no record (fieldstg.s:2536-2540) and so plays nothing."""
    return v is not None and v[0] == "imm" and 0 <= v[1] <= 0xFFF


def is_literal(v) -> bool:
    """Any 16-bit literal: an event id (small) or a flag id (up to 0xFFFF)."""
    return v is not None and v[0] == "imm" and 0 <= v[1] <= 0xFFFF


# value: ("imm", n) | ("addr", a) | ("ord",) | ("getflag_fn",) | ("gf", flag, exp) | None
def apply(ws, i, regs):
    """Apply instruction i's register effects in place."""
    d = decode(ws[i])
    k = d[0]
    if k == "move":
        _, dst, sa, sb = d
        src = sa if sb == 0 else (sb if sa == 0 else None)
        if dst:
            regs[dst] = ("imm", 0) if src == 0 else regs.get(src)
    elif k == "lui":
        if d[1]:
            regs[d[1]] = ("addr", d[2])
    elif k in ("addiu", "ori"):
        _, dst, src, val = d
        if src == 0:
            # a bare `li` literal: the dispatcher uses these as event ids and as
            # UNSIGNED flag ids (0x800E = a collection-bank predicate), so keep the
            # raw 16-bit value rather than the sign-extended one.
            if dst:
                regs[dst] = ("imm", val & 0xFFFF)
        else:
            base = regs.get(src)
            if dst:
                regs[dst] = ("addr", (base[1] + val) & 0xFFFFFFFF) if base and base[0] == "addr" else None
    elif k == "load":
        _, dst, src, off = d
        base = regs.get(src)
        addr = (base[1] + off) & 0xFFFFFFFF if base and base[0] == "addr" else None
        if addr == ORDINAL_ABS:
            regs[dst] = ("ord",)
        elif addr in (GETFLAG_ABS, FNBASE_ABS + 0x10):
            regs[dst] = ("getflag_fn",)
        else:
            regs[dst] = None
    elif k == "store":
        pass                                    # a side store feeds nothing in the chain
    elif k in ("slti", "sltiu"):
        if d[1]:
            regs[d[1]] = None
    elif k == "jalr":
        regs[2] = regs[3] = None
    elif k == "jal":
        regs[2] = regs[3] = None
    return regs


def branch_leaves(d, regs):
    """(taken_leaf, fall_leaf) for a conditional branch, or (None, None).

    A leaf is ("ord", n, exp) or ("flag", id, exp): the value the tested operand must
    HAVE for the branch to go that way. get_flag returns nonzero iff flag == expected,
    so a nonzero result asserts the expectation and a zero result denies it."""
    if d[0] == "regimm":
        rt_, rs_ = d[1], d[2]
        v = regs.get(rs_)
        if rt_ == 0x01 and v and v[0] == "ord":        # bgez (REGIMM rt=1)
            return ("ord", 0, 1), ("ord", 0, 0)
        return None, None
    a, b = d[1], d[2]
    ra, rb = regs.get(a), regs.get(b)
    # get_flag returns nonzero iff flag == expected, so a `beqz` taken means the
    # predicate is FALSE (taken = expected^1) and a `bnez` taken means it is TRUE.
    if b == 0 and ra is not None and ra[0] == "gf":
        t = ("flag", ra[1], ra[2])
        return (t, ("flag", ra[1], ra[2] ^ 1)) if d[0] == "bne" else (("flag", ra[1], ra[2] ^ 1), t)
    if a == 0 and rb is not None and rb[0] == "gf":
        t = ("flag", rb[1], rb[2])
        return (t, ("flag", rb[1], rb[2] ^ 1)) if d[0] == "bne" else (("flag", rb[1], rb[2] ^ 1), t)
    # ordinal against a literal
    for x, y in ((ra, rb), (rb, ra)):
        if x and x[0] == "ord" and y and y[0] == "imm" and 0 <= y[1] < MAX_ORDINAL:
            pos, neg = ("ord", y[1], 1), ("ord", y[1], 0)
            return (pos, neg) if d[0] == "beq" else (neg, pos)
    # ordinal against $zero: "is the story step still 0?" (pro/wstag780.s:1496-1500
    # sends a fresh game to start_event(0) and an old one into the chain)
    for x, zero in ((ra, b), (rb, a)):
        if x and x[0] == "ord" and zero == 0:
            pos, neg = ("ord", 0, 1), ("ord", 0, 0)
            return (pos, neg) if d[0] == "beq" else (neg, pos)
    return None, None


def consistent(guards, leaf) -> bool:
    """Prune a path the disc cannot take.

    The ordinal is ONE linear value, so ord==n & ord==m (n!=m), or ord==n & ord!=n,
    cannot both hold. A flag expectation is a boolean test of one word, so
    flag==e & flag==(e^1) cannot both hold either -- the chain re-reads the same flag
    with the opposite expectation on the other side of a branch, and the branch that
    separates them is compared against a SAVED ordinal copy, which contributes no
    leaf of its own."""
    if leaf is None:
        return True
    for g in guards:
        if g[0] == "ord" and leaf[0] == "ord":
            if (leaf[2] == 1 and g[2] == 1 and g[1] != leaf[1]) or \
               (leaf[2] == 1 and g[2] == 0 and g[1] == leaf[1]) or \
               (leaf[2] == 0 and g[2] == 1 and g[1] == leaf[1]):
                return False
        if g[0] == "flag" and leaf[0] == "flag" and g[1] == leaf[1] and g[2] != leaf[2]:
            return False
    return True


# ── the trace ──────────────────────────────────────────────────────────────────────────────────
def routine_end(ws, entry):
    for i in range(entry, len(ws)):
        d = decode(ws[i])
        if d[0] == "jr" and d[1] == 31:
            return i + 2
    return len(ws)


def trace(ws, entry, end, stage_file, lines):
    """Symbolic DFS of one arrival dispatcher.

    `guards` accumulates the conjunction; at the shared `jal start_event` the live
    $a0 is the candidate's event id, and the address of the `li $a0, id` that put it
    there (its branch's delay slot) plus the address of that branch give the chain
    ORDER -- the fall-through path of a branch comes after its taken path, exactly as
    the CPU runs it."""
    seen = set()
    state = {"n": 0}
    cand: dict[tuple, dict] = {}
    also: dict[int, dict] = {}
    notes: set[str] = set()

    def note(msg):
        notes.add(msg)

    def order_key(via, a0load):
        # a taken branch enters the start block; the fall-through of that same branch
        # (the next instruction) must sort after it, so the key is (branch, load).
        return (via if via is not None else 1 << 30,
                a0load if a0load is not None else 1 << 30)

    def record(idx, regs, guards, via, a0load):
        state["n"] += 1
        if state["n"] > MAX_STATES:
            note("state-explosion-guard")
            return
        v = regs.get(4)
        if not is_event(v):
            note("start_event-with-non-literal-id@%s" % lab(lines, idx))
            return
        # a negative ordinal leaf that sits beside a positive one is implied by it
        # (the ordinal is one value), so it carries no information the chain order
        # does not already carry. Keep a lone ord!=N: it is then the real condition.
        pos_ord = {g[1] for g in guards if g[0] == "ord" and g[2] == 1}
        conds = []
        for g in guards:
            if g[0] == "ord" and g[2] == 0 and pos_ord:
                continue
            leaf = [(0x6000 | g[1]) if g[0] == "ord" else g[1], g[2]]
            if leaf not in conds:
                conds.append(leaf)
        key = order_key(via, a0load)
        got = cand.get(key)
        if got is not None and got["event"] != v[1]:
            # two different event ids behind one (branch, load) pair: keep both, ordered
            # by the load address, and say so rather than dropping one.
            note("two-event-ids-behind-one-branch@%s"
                 % (lab(lines, via) if via is not None else "?"))
            key = (key[0], key[1], v[1])
            got = cand.get(key)
        row = {
            "event": v[1],
            "ordinal": next((g[1] for g in guards if g[0] == "ord" and g[2] == 1), None),
            "flags": [{"id": g[1], "expect": g[2]} for g in guards if g[0] == "flag"],
            "conds": conds,
            "paths": [conds],
            "cite": {"call": cite(lines, stage_file, idx, "label")},
        }
        if a0load is not None:
            row["cite"]["load"] = cite(lines, stage_file, a0load, "label")
        if via is not None:
            row["cite"]["branch"] = cite(lines, stage_file, via, "label")
        if got is None:
            cand[key] = row
        elif conds not in got["paths"]:
            # two paths reach the same candidate (the original reaches it if EITHER
            # holds); the chain order of the EARLIER candidates decides the overlap.
            got["paths"].append(conds)

    def run(idx, regs, guards, via, a0load, depth):
        pending = []
        while True:
            if idx < entry or idx >= end or depth > 3000:
                break
            key = (idx, tuple(sorted(map(str, guards))), str(regs.get(4)), str(regs.get(5)), via, a0load)
            if key in seen:
                break
            seen.add(key)
            d = decode(ws[idx])
            k = d[0]

            if k == "start_event":
                # the event id can live in the jal's OWN delay slot
                regs2 = dict(regs)
                apply(ws, idx + 1, regs2)
                if is_event(regs2.get(4)):
                    a0load = idx + 1
                record(idx, regs2, guards, via, a0load)
                regs2[4] = regs2[2]              # $a0 = event id is consumed by the call
                regs2[2] = None
                idx += 2
                regs = regs2
                continue

            if k == "j":
                # An unconditional jump into the shared start block, with the event id
                # in the jump's own delay slot (pro/wstag306.s .L0x334/.L0x338: the
                # ord==37 arm jumps past the ord==39 arm's `li`). Forking here would
                # invent a fall-through the CPU never takes.
                regs2 = dict(regs)
                apply(ws, idx + 1, regs2)
                here = idx
                idx, regs = (d[1] - OVERLAY_BASE) // 4, regs2
                if is_event(regs.get(4)):
                    a0load = here + 1
                continue

            if k in ("beq", "bne", "regimm"):
                ra, rb = regs.get(d[1]), regs.get(d[2])
                if d[0] in ("beq", "bne") and d[1] == 0 and d[2] == 0:   # `b` = always
                    regs2 = dict(regs)
                    apply(ws, idx + 1, regs2)
                    idx, regs, via, a0load = idx + 1 + d[3], regs2, idx, a0load
                    continue
                if (ra and ra[0] == "ord") and (rb and rb[0] == "ord"):
                    # Two re-reads of the SAME single value: the comparison is settled
                    # before it runs. `beq` always transfers, `bne` never does, so the
                    # other side of the branch is a path the disc cannot take (its
                    # missing flag tests would otherwise look like a second route).
                    regs2 = dict(regs)
                    apply(ws, idx + 1, regs2)
                    if d[0] == "beq":
                        idx, regs, via = idx + 1 + d[3], regs2, idx
                        continue
                    idx, regs = idx + 2, regs2
                    continue
                target = idx + 1 + d[3]
                regs2 = dict(regs)
                apply(ws, idx + 1, regs2)
                nxt_a0load = idx + 1 if is_event(regs2.get(4)) else a0load
                taken, fall = branch_leaves(d, regs)
                if consistent(guards, taken):
                    pending.append((target, dict(regs2), guards + ([taken] if taken else []), idx, nxt_a0load))
                if not consistent(guards, fall):
                    break                        # the fall-through cannot hold; stop this walk
                idx += 2
                regs = regs2
                guards = guards + ([fall] if fall else [])
                via, a0load = idx, nxt_a0load
                continue

            if k == "jalr":
                regs2 = dict(regs)
                apply(ws, idx + 1, regs2)
                tag = regs.get(d[1])
                if tag and tag[0] == "getflag_fn" and is_literal(regs2.get(4)) \
                        and regs2.get(5) and regs2[5][0] == "imm":
                    regs2[2] = ("gf", regs2[4][1], regs2[5][1])
                else:
                    regs2[2] = regs2[3] = None
                    if tag and tag[0] == "getflag_fn":
                        note("get_flag-with-non-literal-argument@%s" % lab(lines, idx))
                idx += 2
                regs = regs2
                continue

            if k in ("alloc", "jal"):
                regs2 = dict(regs)
                apply(ws, idx + 1, regs2)
                target = None if k == "alloc" else d[1]
                inside = target is not None and OVERLAY_BASE <= target < OVERLAY_BASE + len(ws) * 4
                also.setdefault(idx, {
                    "call": ("alloc" if k == "alloc" else "jal"),
                    "target": None if k == "alloc" else "0x%08x" % target,
                    "in_overlay": bool(inside),
                    "tick_arg": regs2.get(4)[1] if k == "alloc" and regs2.get(4) and regs2[4][0] == "addr" else None,
                    "size": regs2.get(5)[1] if k == "alloc" and regs2.get(5) and regs2[5][0] == "imm" else None,
                    "arg": regs2.get(4)[1] if is_event(regs2.get(4)) else None,
                    "cite": cite(lines, stage_file, idx, "label"),
                })
                idx += 2
                regs = regs2
                continue

            if k == "jr":
                break

            apply(ws, idx, regs)
            if decode(ws[idx])[0] in ("addiu", "ori", "move") and is_event(regs.get(4)):
                a0load = idx
            idx += 1

        for t in reversed(pending):
            run(t[0], t[1], t[2], t[3], t[4], depth + 1)

    run(entry, {}, [], None, None, 0)
    return {
        "candidates": [cand[k] for k in sorted(cand)],
        "also": [also[k] for k in sorted(also)],
        "notes": sorted(notes),
        "states": state["n"],
    }


def phase_gate_reset_band(ws, entry, end, lines, stage_file):
    """The RESET band: `lw $vX,0xc($self)` then beqz -> run, bltz -> run,
    slti $vX,0x4 / bnez -> RETURN. 76 overlays ship this shape (s200, s305, ...)."""
    for i in range(entry, end - 3):
        d = decode(ws[i])
        if d[0] != "load" or d[3] != 0x0C:
            continue
        seq = [decode(ws[j]) for j in range(i + 1, min(i + 8, end))]
        kinds = [x[0] for x in seq]
        if "beq" in kinds and "regimm" in kinds and "bne" in kinds:
            beq = next(x for x in seq if x[0] == "beq")
            regimm = next(x for x in seq if x[0] == "regimm")
            bne = next(x for x in seq if x[0] == "bne")
            if beq[2] != 0 or regimm[1] != 0 or bne[2] != 0:
                continue
            return {"phase_offset": 0x0C,
                    "band": "reset",
                    "runs_on": ["phase == 0", "phase < 0", "phase >= 4"],
                    "returns_on": ["phase == 1", "phase == 2", "phase == 3"],
                    "cite": {"read": cite(lines, stage_file, i, "label"),
                             "beq": cite(lines, stage_file, i + 1 + beq[3], "label"),
                             "bltz": cite(lines, stage_file, i + 1 + regimm[3], "label"),
                             "slti": cite(lines, stage_file, i + 3, "label")}}
    return None


def phase_gate_phase1_band(ws, entry, end, lines, stage_file):
    """The PHASE-1 band, the second shape the disc ships (s795, s800).

        lw   $v1, 0xc($self)
        li   $v0, 1
        beq  $v1, $v0, .Lchain        # phase == 1 -> run the chain
        slti $v0, $v1, 2 / bnez  ret  # phase < 2   -> RETURN
        slti $v0, $v1, 4 / beqz  ret  # phase >= 4  -> RETURN
        j    .Lother                  # phases 2..3  -> a different shared routine

    The object therefore reaches its band on its SECOND turn: a freshly allocated
    object's phase word is 0, the phase-0 arm returns through the object's own
    `vt+0x38` (= exe/fns.s:8955-8963 F0x800142ac, `phase = phase + 1`), and the turn
    after that is the one that decides. Its exit path advances the phase again, which
    is the latch: the chain can decide exactly once per field load, exactly like the
    reset band's.
    """
    for i in range(entry, end - 5):
        d = decode(ws[i])
        if d[0] != "load" or d[3] != 0x0C:
            continue
        # `li $vX,1` immediately after the read
        ld = decode(ws[i + 1])
        if ld[0] != "addiu" or ld[2] != 0 or ld[3] != 1:
            continue
        beq = decode(ws[i + 2])
        if beq[0] != "beq" or beq[2] != ld[1]:
            continue
        # slti <2 / bnez, then slti <4 / beqz
        s1 = decode(ws[i + 4]); b1 = decode(ws[i + 5])
        s2 = decode(ws[i + 6]); b2 = decode(ws[i + 7])
        if not (s1[0] == "slti" and s1[2] == 2 and b1[0] == "bne" and b1[2] == 0):
            continue
        if not (s2[0] == "slti" and s2[2] == 4 and b2[0] == "beq" and b2[2] == 0):
            continue
        return {"phase_offset": 0x0C,
                "band": "phase1",
                "runs_on": ["phase == 1"],
                "returns_on": ["phase == 0", "phase == 2", "phase == 3", "phase >= 4"],
                "cite": {"read": cite(lines, stage_file, i, "label"),
                         "beq": cite(lines, stage_file, i + 2 + beq[3], "label"),
                         "slti2": cite(lines, stage_file, i + 4, "label"),
                         "slti4": cite(lines, stage_file, i + 6, "label")}}
    return None


def phase_gate_of(ws, entry, end, lines, stage_file):
    """The per-place gate object's own phase gate. Two band shapes ship; the whole
    family is these two (tools/measure_scene_parts.py's census, and the
    tests/lane-b/scene-arrival.test.js oracle over every recognised routine)."""
    return (phase_gate_reset_band(ws, entry, end, lines, stage_file)
            or phase_gate_phase1_band(ws, entry, end, lines, stage_file))


def find_ticks(ws):
    """Every tick address this overlay hands the shared allocator."""
    out = []
    for i, w in enumerate(ws):
        if w not in ALLOCATORS:
            continue
        # `addiu $a0,$a0,imm` is the two-operand (accumulator) form, so scanning
        # backwards finds the addiu BEFORE its lui: remember the offset, then wait
        # for the lui that supplies the page.
        imm_off = None
        a0 = None
        for j in range(i - 1, max(i - 10, -1), -1):
            d = decode(ws[j])
            if d[0] == "lui" and d[1] == 4:
                if imm_off is None:
                    break
                a0 = (d[2] + imm_off) & 0xFFFFFFFF
                break
            if d[0] in ("addiu", "ori") and d[1] == 4 and d[2] in (4, 2, 0):
                imm_off = d[3]
            elif d[0] == "move" and d[1] == 4:
                break
        if a0 is not None and OVERLAY_BASE <= a0 < OVERLAY_BASE + len(ws) * 4:
            out.append((i, a0 - OVERLAY_BASE, ALLOCATORS[w]))
    return out


def main(check=False):
    stages, ungated = {}, {}
    total, total_routines = 0, 0
    for path in sorted(ASM_DIR.glob("wstag*.s")):
        num = path.stem[len("wstag"):]
        ws, lines = load_image(path)
        if not ws:
            continue
        stage_file = "pro/wstag%s.s" % num
        sid = "s%s" % num
        rows = []
        for site, off, alloc in find_ticks(ws):
            idx = off // 4
            end = routine_end(ws, idx)
            if JAL_START_EVENT not in ws[idx:end]:
                continue
            pg = phase_gate_of(ws, idx, end, lines, stage_file)
            # A tick that also calls start_event is NOT automatically the arrival
            # dispatcher: an overlay installs other per-place objects (ambient scenery,
            # a patrol loop) whose tick calls start_event from somewhere else entirely.
            # The arrival dispatcher is the one that reads the object's phase word at
            # +0xc and only runs the chain on the reset band. Anything else is listed
            # under `ticks_without_phase_gate` rather than guessed at.
            if pg is None:
                ungated.setdefault(sid, []).append(
                    {"tick": "0x%08x" % (OVERLAY_BASE + off), "file": stage_file,
                     "offset": "0x%04x" % off, "line": lines.get(off),
                     "instructions": end - idx,
                     "allocator_site": cite(lines, stage_file, site, "label"),
                     "start_event_calls": [lab(lines, j) for j in range(idx, end)
                                           if ws[j] == JAL_START_EVENT]})
                continue
            tr = trace(ws, idx, end, stage_file, lines)
            total += len(tr["candidates"])
            total_routines += 1
            rows.append({
                "tick": "0x%08x" % (OVERLAY_BASE + off),
                "allocator": alloc,
                "allocator_site": cite(lines, stage_file, site, "label"),
                "dispatcher": {"file": stage_file, "offset": "0x%04x" % off,
                               "label": lab(lines, idx),
                               "line": lines.get(off), "instructions": end - idx},
                "phase_gate": pg,
                "candidates": [dict(c, order=n) for n, c in enumerate(tr["candidates"])],
                "also": tr["also"],
                "notes": tr["notes"],
                "states": tr["states"],
            })
        if rows:
            stages[sid] = rows[0] if len(rows) == 1 else rows

    doc = {
        "ticks_without_phase_gate": ungated,
        "_comment": ("Per-place arrival-dispatcher chains, read from each overlay's own entry-object "
                     "tick (the address it hands F0x80014504/F0x800143dc). Generated by "
                     "tools/extract_arrival_candidates.py; see that file for the method. "
                     "`candidates` is the ORDERED chain: the first candidate whose whole conjunction "
                     "holds starts its event, and at most one event is started per pass."),
        "stages": stages,
    }
    text = json.dumps(doc, indent=1) + "\n"
    if check:
        cur = OUT.read_text() if OUT.exists() else ""
        print("arrival_candidates: %s" % ("unchanged" if cur == text else "STALE"))
        return 0 if cur == text else 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    multi = [k for k, v in stages.items() if isinstance(v, list)]
    nogate = [k for k, v in stages.items()
              if (v if isinstance(v, dict) else v[0])["phase_gate"] is None]
    noted = [(k, (v if isinstance(v, dict) else v[0])["notes"]) for k, v in stages.items()
             if (v if isinstance(v, dict) else v[0])["notes"]]
    ng = sum(len(v) for v in ungated.values())
    print("arrival dispatchers: %d routines over %d stages, candidates: %d"
          % (total_routines + ng, len(stages), total))
    print("  phase-gated (the arrival dispatchers): %d routines" % total_routines)
    print("  ticks that call start_event but read no phase word: %d routines" % ng)
    for k, v in sorted(ungated.items()):
        for r in v:
            print("    %s tick %s %s:%d (%d insn) start_event at %s"
                  % (k, r["tick"], r["file"], r["line"] or 0, r["instructions"],
                     ",".join(r["start_event_calls"])))
    if multi:
        print("MORE THAN ONE dispatcher: %s" % ", ".join(multi))
    if nogate:
        print("NO recognised phase gate: %s" % ", ".join(nogate))
    for k, n in noted:
        print("  %s notes: %s" % (k, "; ".join(n)))
    return 0


if __name__ == "__main__":
    sys.exit(main(check="--check" in sys.argv))