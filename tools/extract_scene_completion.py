#!/usr/bin/env python3
"""Extract every event's SCENE-COMPLETION routine as data — the writes a finished
scene makes to the story.

A scene ends by handing its `on_complete_fn` back to fieldstg, and that routine is
the whole of what the beat advances: a handful of writes into the story flag banks
through the flag API (`set_flag` = the function-pointer cell at 0x80048AC8 =
flagAPI+0xc) and/or one 32-bit store of the master story ordinal ([0x8004B370]).
There is no other effect: every one of the 246 routines across the 294 overlays is
a straight-line leaf that writes and returns.

This tool reads each routine by SYMBOLIC EXECUTION of its own words (the overlay
image is reconstructed from the `.s` files' `# .word` annotations, as
tools/build_native_overlays.py does) and records the WRITES IN ORDER. The ordered
write list IS the shape: the five shapes the disc ships —

    A  two or more set_flag calls                 (the common one)
    B  one set_flag call
    C  the ordinal alone
    D  the ordinal, then one set_flag call
    E  three set_flag calls

— are five points in one space, not five code paths, so the port is a single
ordered-write interpreter and each place supplies only its list. That is why the
11 routines that no two of the five shapes share a masked body with are NOT a sixth
shape: they are A/B/C/D with more writes, or with a CLEAR (`set_flag(id,0)`, built
as `addu $a1,$zr,$zr`) instead of a set. The `shape` field keeps the five-way
census so a regression in either direction is visible.

Output: web/assets/data/scene/scene_completion.json
    { "stages": { "s200": { "events": { "50": { writes: [...], shape, cite } } } },
      "shapes": {"A": n, ...}, "residue": [ ... routines outside A-E ... ] }

Run: .venv/bin/python3 tools/extract_scene_completion.py [--check]
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
EVENTS = ROOT / "web/assets/events/wstag_events.json"
OUT = ROOT / "web/assets/data/scene/scene_completion.json"

OVERLAY_BASE = 0x800A5DE0
SET_FLAG_CELL = 0x80048AC8     # flagAPI+0xc — the set_flag function-pointer cell
FLAG_API = 0x80048ABC          # the flag table some overlays index with +0xc
ORDINAL_ABS = 0x8004B370       # the master story ordinal [0x8004b370]
MAX_WORDS = 256                # per routine: these are leaves; the largest is 34

# ── overlay image + line numbers ────────────────────────────────────────────────────────────────
WORD_RE = re.compile(r"^\.L0x([0-9a-f]{8}):\s*(.*)$")


def load_image(path: Path):
    """The overlay's words and each word's .s line, keyed by file offset."""
    words: dict[int, int] = {}
    lines: dict[int, int] = {}
    for no, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        m = WORD_RE.match(line)
        if not m:
            continue
        off = int(m.group(1), 16)
        body = m.group(2)
        w = re.search(r"#\s*\.word\s+0x([0-9a-fA-F]{8})", body) or \
            re.match(r"^\.word\s+0x([0-9a-fA-F]{8})", body)
        if w:
            words[off] = int(w.group(1), 16)
            lines[off] = no
    if not words:
        return [], {}
    img = [0] * ((max(words) + 4) // 4)
    for off, w in words.items():
        img[off // 4] = w
    return img, lines


# ── instruction decode (the fields these leaves use) ─────────────────────────────────────────────
def op(w):    return w >> 26
def rs(w):    return (w >> 21) & 0x1F
def rt(w):    return (w >> 16) & 0x1F
def rd(w):    return (w >> 11) & 0x1F
def fn(w):    return w & 0x3F
def simm(w):  i = w & 0xFFFF; return i - 0x10000 if i & 0x8000 else i


def decode(w: int):
    o = op(w)
    if o == 0x0F:                                   return ("lui", rt(w), (w & 0xFFFF) << 16)
    if o in (0x09, 0x0D):                           # addiu / ori
        return ("addiu" if o == 0x09 else "ori", rt(w), rs(w), (simm(w) if o == 0x09 else (w & 0xFFFF)))
    if o == 0x23:                                   return ("lw", rt(w), rs(w), simm(w))
    if o in (0x2B, 0x29):                           return ("sw", rt(w), rs(w), simm(w))
    if o == 0x03:   return ("jal", 0x80000000 | ((w & 0x03FFFFFF) << 2))
    if o == 0x02:   return ("j", 0x80000000 | ((w & 0x03FFFFFF) << 2))
    if o == 0x00 and fn(w) == 0x09:                 return ("jalr", rs(w))
    if o == 0x00 and fn(w) == 0x08:                 return ("jr", rs(w))
    if o == 0x00 and fn(w) in (0x21, 0x25, 0x20):   return ("addu", rd(w), rs(w), rt(w))
    if o in (0x04, 0x05):                           return ("beq" if o == 0x04 else "bne", rs(w), rt(w), simm(w))
    if o in (0x06, 0x07):                           return ("blez" if o == 0x06 else "bgtz", rs(w), simm(w))
    if o == 0x01:                                   return ("regimm", rt(w), rs(w), simm(w))
    return ("other", w)


class Val:
    """A register's tracked value: an immediate, or a constant address."""
    __slots__ = ("imm", "addr")

    def __init__(self, imm=None, addr=None):
        self.imm = imm
        self.addr = addr


def peek_args(w: int, a0, a1):
    """Apply a delay-slot argument load (`li $a0/$a1, imm`, `move $a1,$zr`) to the
    pending call arguments. Returns them; None means the word sets neither."""
    d = decode(w)
    if d[0] in ("addiu", "ori") and d[2] == 0:
        if d[1] == 4:
            a0 = d[3] & 0xFFFF
        elif d[1] == 5:
            a1 = d[3] & 0xFFFF
    elif d[0] == "addu" and d[2] == 0 and d[3] == 0:
        if d[1] == 4:
            a0 = 0
        elif d[1] == 5:
            a1 = 0
    return a0, a1


def walk(img, entry, lines, stage_file):
    """Symbolic execution of one leaf: collect the WRITES in program order.

    Branching is followed on both edges (these leaves do not branch today, and a
    leaf that did would have its two write lists reported separately rather than
    merged). Execution stops at the routine's own `jr $ra` (its delay slot runs
    first — a store in a delay slot stores the register it names, not a base)."""
    regs: dict[int, Val] = {}
    writes: list[dict] = []
    others: list[dict] = []
    seen: set[int] = set()
    queue = [entry]
    a0 = a1 = None
    fnp: set[int] = set()
    steps = 0
    ends: int | None = None

    def reg(v):
        return regs.get(v)

    while queue:
        i = queue.pop(0)
        steps += 1
        if steps > MAX_WORDS * 8:
            others.append({"kind": "step_guard"})
            break
        if i < 0 or i >= len(img) or i in seen:
            continue
        if ends is not None and i > ends:
            break
        seen.add(i)
        d = decode(img[i])
        k = d[0]
        fall = True                     # every instruction but a taken transfer falls through
        if k == "lui":
            regs[d[1]] = Val(addr=d[2])
        elif k in ("addiu", "ori"):
            _, dst, src, val = d
            if src == 0:
                # `li rd, imm`. When rd holds a bare `lui` this is the second half of
                # a constant (lui $s0,0x8005 / addiu $s0,-0x7544 = 0x80048ABC), so the
                # address folds; the literal itself is kept for the flag id / value.
                if dst == 4:
                    a0 = val & 0xFFFF
                elif dst == 5:
                    a1 = val & 0xFFFF
                prev = regs.get(dst)
                folded = None
                if prev is not None and prev.addr is not None and prev.imm is None:
                    folded = ((prev.addr + val) & 0xFFFFFFFF) if k == "addiu" \
                        else (prev.addr | val) & 0xFFFFFFFF
                regs[dst] = Val(imm=val & 0xFFFF, addr=folded)
            else:
                b = reg(src)
                if b is not None and b.addr is not None:
                    regs[dst] = Val(addr=(b.addr + val) & 0xFFFFFFFF)
                else:
                    regs[dst] = Val()
        elif k == "addu":
            _, dst, s1, s2 = d
            if s1 == 0 and s2 == 0:
                if dst == 5:
                    a1 = 0
                elif dst == 4:
                    a0 = 0
                regs[dst] = Val(imm=0)
            elif s1 == 0:
                regs[dst] = reg(s2) or Val()
            elif s2 == 0:
                regs[dst] = reg(s1) or Val()
            else:
                regs[dst] = Val()
        elif k == "lw":
            _, dst, src, off = d
            b = reg(src)
            addr = (b.addr + off) & 0xFFFFFFFF if b is not None and b.addr is not None else None
            if addr == SET_FLAG_CELL or addr == FLAG_API + 0xC:
                fnp.add(dst)
                regs[dst] = Val()
            else:
                fnp.discard(dst)
                regs[dst] = Val()
            if addr is not None and addr not in (SET_FLAG_CELL, FLAG_API + 0xC, FLAG_API + 0x10):
                others.append({"kind": "load", "addr": "0x%08x" % addr,
                               "cite": cite(lines, stage_file, i)})
        elif k == "sw":
            _, src, base, off = d
            b = reg(base)
            addr = (b.addr + off) & 0xFFFFFFFF if b is not None and b.addr is not None else None
            if addr == ORDINAL_ABS:
                # $zr stores zero (pro/wstag780.s .L0x0000182c: `sw $zr,-0x4c90`).
                v = reg(src) if src != 0 else Val(imm=0)
                writes.append({"op": "set_ordinal", "value": (v.imm if v is not None else None),
                               "cite": cite(lines, stage_file, i)})
            elif addr is not None:
                others.append({"kind": "store", "addr": "0x%08x" % addr,
                               "cite": cite(lines, stage_file, i)})
        elif k == "jalr":
            if d[1] in fnp:
                # The argument's `li` often sits in the branch DELAY SLOT, which runs
                # BEFORE the transfer. Peek at it so the call's arguments are the ones
                # the CPU actually passes (the slot is then re-executed harmlessly).
                if i + 1 < len(img):
                    a0, a1 = peek_args(img[i + 1], a0, a1)
                if a0 is not None:
                    writes.append({"op": "set_flag", "flag": a0, "value": a1,
                                   "cite": cite(lines, stage_file, i)})
                else:
                    others.append({"kind": "set_flag_without_id", "cite": cite(lines, stage_file, i)})
            else:
                others.append({"kind": "indirect_call", "cite": cite(lines, stage_file, i)})
            a0 = a1 = None
            for r in (4, 5):
                regs.pop(r, None)
            # jalr returns: it falls through
        elif k == "jr":
            fall = False
            if d[1] == 31:
                # the delay slot runs first, and the routine ends after it. A store in
                # a delay slot stores the register it NAMES, not a base register
                # (pro/wstag200.s .L0x00000144: `jr $ra` / `sw $v0,-0x4c90($v1)`).
                queue.append(i + 1)
                ends = i + 1
        elif k == "jal":
            others.append({"kind": "call", "target": "0x%08x" % d[1],
                           "cite": cite(lines, stage_file, i)})
            a0 = a1 = None
            for r in (4, 5):
                regs.pop(r, None)
            fall = False                               # no fall-through
        elif k == "j":
            queue.append((d[1] - OVERLAY_BASE) // 4)
            fall = False
        elif k in ("beq", "bne", "blez", "bgtz", "regimm"):
            # simm is always the last field; both edges are followed.
            queue.append(i + 1 + d[-1] // 4)
            if k in ("beq", "bne"):
                queue.append(i + 1)
        if fall:
            queue.append(i + 1)
    return writes, others


def cite(lines, stage_file, idx):
    d = {"file": stage_file, "label": ".L0x%08x" % (idx * 4)}
    n = lines.get(idx * 4)
    if n:
        d["line"] = n
    return d


def shape_of(writes):
    """The disc's five shapes (sceneengine-report.md §2.3), counted as (n_flag_writes,
    has_ordinal). Anything else is residue and is listed separately rather than
    forced into a shape: five flags in one routine is A with more of the same, but
    the census must show it as not-A so the two counts never drift apart."""
    n = sum(1 for w in writes if w["op"] == "set_flag")
    o = sum(1 for w in writes if w["op"] == "set_ordinal")
    if o == 0:
        return {1: "B", 2: "A", 3: "E"}.get(n)
    if o == 1 and n == 0:
        return "C"
    if o == 1 and n == 1:
        return "D"
    return None


def main() -> None:
    ev = json.loads(EVENTS.read_text())
    out = {"stages": {}, "shapes": {}, "residue": []}
    shape_n: dict[str, int] = {}
    residue = []
    total = 0
    for sid, evs in sorted(ev.items()):
        st = sid[1:]
        path = ASM_DIR / ("wstag%s.s" % st)
        if not path.exists():
            continue
        img, lines = load_image(path)
        rows = {}
        for e in evs:
            off = e.get("on_complete_fn") or 0
            if not off or off % 4:
                continue
            writes, others = walk(img, off // 4, lines, "pro/wstag%s.s" % st)
            sh = shape_of(writes)
            row = {
                "writes": writes,
                "shape": sh,
                "cite": {"file": "pro/wstag%s.s" % st, "label": ".L0x%08x" % off},
            }
            if lines.get(off):
                row["cite"]["line"] = lines[off]
            if others:
                row["other_effects"] = others
            rows[str(e["id"])] = row
            total += 1
            if sh:
                shape_n[sh] = shape_n.get(sh, 0) + 1
            else:
                residue.append({"stage": sid, "event": e["id"], "label": row["cite"]["label"],
                                "writes": len(writes)})
        if rows:
            out["stages"][sid] = {"events": rows}
    out["shapes"] = shape_n
    out["residue"] = residue
    out["routines"] = total
    if "--check" in sys.argv:
        old = json.loads(OUT.read_text()) if OUT.exists() else None
        if old == out:
            print("scene_completion.json unchanged (%d routines, shapes %s)" % (total, shape_n))
            return
        print("scene_completion.json CHANGED: shapes %s vs %s" % (shape_n, old and old.get("shapes")))
        sys.exit(1)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print("wrote %s: %d completion routines, shapes %s, residue %d"
          % (OUT.name, total, shape_n, len(residue)))


if __name__ == "__main__":
    main()
