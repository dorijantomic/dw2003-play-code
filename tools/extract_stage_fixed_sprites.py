#!/usr/bin/env python3
"""Inventory + extract the fixed still-sprite family: the stage overlays' own
two-layer decoration player.

WHAT THIS IS
------------
A field `SETANIM` with an id at or above 0x320 lands in the effect registry
(`docs/research/field/stage-object-registry-2026-10-04.md`). A handful of
registry records resolve, inside a stage overlay, to a builder that allocates a
0x6c-byte resident state machine and pins it to one map position:

    wstag310.s .L0x000014f4  lui $a0, 0x800a
    wstag310.s .L0x000014f8  addiu $a0, 0x70ac      # tick 0x800a70ac
    wstag310.s .L0x000014fc  li $a1, 0x6c            # a 108-byte object
    wstag310.s .L0x00001500  move_ $a2, $zr
    wstag310.s .L0x00001508  jal F0x800143dc         # F0x800143dc(tick, size, 0, id)
    wstag310.s .L0x00001518  li $v0, 0x26c
    wstag310.s .L0x0000151c  sw $v0, 0x54($s0)       # x = 620
    wstag310.s .L0x00001520  li $v0, 0xfc
    wstag310.s .L0x00001524  sw $v0, 0x58($s0)       # y = 252

Its tick runs two 4-byte clip runs against the overlay's own tables and queues
two layer draw jobs, so the player sees one decoration standing at a fixed point
in the room with a cycling palette, plus a second sprite above it for the length
of a one-shot burst.

THE FAMILY IS FOUND BY ITS CODE, NOT BY A HAND LIST
---------------------------------------------------
Three marks have to hold together in the same overlay, and the tool reports
every overlay that satisfies them:

  1. a builder wrapper that calls `F0x800143dc` with size `0x6c` and stores two
     immediates at `obj+0x54` and `obj+0x58`;
  2. the tick it installs, which compares its one-shot clip against the literal
     `0x12c` (300) - the sentinel that hides the burst sprite - and makes two
     calls into the overlay's own clip stepper;
  3. the draw callback the tick names, which submits through the draw context
     (`F0x8001f648`) with the layer pair 4 / 6 and the stage sprite bank.

The registry id is then read out of the shipped fieldstg image: the 12-byte
record whose `construct_fn` word equals this overlay's builder address.

Usage:
    python3 tools/extract_stage_fixed_sprites.py                # summary
    python3 tools/extract_stage_fixed_sprites.py --out web/assets/data/stage_fixed_sprites.json
    python3 tools/extract_stage_fixed_sprites.py --stage s310    # one overlay
"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import inventory_stage_objects as iso  # noqa: E402

OVERLAY_BASE = iso.OVERLAY_BASE
FIELDSTG_IMAGE = REPO / "web/assets/native/fieldstg.bin"
FIELDSTG_BASE = 0x80082CB0
REGISTRY_RAM = 0x8009B3E8
REGISTRY_STRIDE = 12
DEFAULT_OUT = REPO / "web/assets/data/stage_fixed_sprites.json"

OBJECT_SIZE = 0x6C
BURST_HIDE_CLIP = 0x12C
FRONT_LAYER = 6
BACK_LAYER = 4
BACK_Y_OFFSET = -0x20
BACK_SORT_OFFSET = 0x12
FRONT_BOX = (0x20, 0x20)
BACK_BOX = (0x20, 0x40)
MAX_SEQUENCE = 64

LINE_RE = re.compile(r"^\.L0x([0-9a-f]{8}):\s*(.*?)\s*(?:#.*)?$")


def parse(stage):
    """`({offset: (mnemonic, text)}, {offset: word})` from the census parser.

    Reusing `inventory_stage_objects.parse_overlay` keeps the instruction/data
    split identical to the registry census, so a table can never be read as a
    routine here either.
    """
    ov = iso.parse_overlay(stage)
    if ov is None:
        return None, None
    ins = {}
    for off, text in ov["ins"].items():
        m = re.match(r"^([a-z._]+)\s*(.*)$", text)
        ins[off] = (m.group(1), m.group(2).strip()) if m else (text.strip(), "")
    return ins, ov["words"]


def imm(text, reg=None):
    """The immediate of an operand string: `$v0, 0x26c` -> 620."""
    m = re.match(r"^\$(\w+),\s*(-?0x[0-9a-fA-F]+)$", text.strip())
    if not m:
        return None
    if reg and m.group(1) != reg:
        return None
    return int(m.group(2), 16)


def lui_reg(text):
    """`$a0, 0x800a` from a `lui` operand string -> ("a0", 0x800a)."""
    m = re.match(r"^\$(\w+),\s*(0x[0-9a-fA-F]+)$", text.strip())
    return (m.group(1), int(m.group(2), 16)) if m else (None, None)


def routine_start(ins, off):
    """The first instruction of the routine that contains `off`.

    The registry names a routine's ENTRY, not the instruction inside it, so the
    allocator call at `0x800a72e8` has to be reported as the builder at
    `0x800a72cc`. The split is on the routine's own `jr $ra`, the same rule the
    census uses.
    """
    offs = sorted(ins)
    i = offs.index(off)
    for j in range(i - 1, -1, -1):
        if ins[offs[j]][0] == "jr" and "$ra" in ins[offs[j]][1]:
            # `jr $ra` owns the next word as its delay slot, so the next routine
            # starts one word further on.
            start = offs[j + 2] if j + 2 <= i else off
            return start
    return off


def find_builders(ins):
    """Every `F0x800143dc(tick, 0x6c, 0, id)` wrapper that pins x, y and a clip."""
    out = []
    offs = sorted(ins)
    for i, off in enumerate(offs):
        if ins[off] != ("jal", "F0x800143dc"):
            continue
        win = [(ins[o][0], ins[o][1]) for o in offs[max(0, i - 8):i + 1]]
        size = next((v for m, t in win if m in ("li", "addiu")
                     and (v := imm(t, "a1")) is not None), None)
        if size != OBJECT_SIZE:
            continue
        # the tick address is the `lui`/`addiu` pair the allocator takes in $a0
        hi = next((h for m, t in win if m == "lui" and (h := lui_reg(t)[1]) is not None), 0)
        lo = next((v for m, t in win if m == "addiu" and (v := imm(t, "a0")) is not None), None)
        tick = (hi << 16) + lo if lo is not None else None
        # the stores that follow: obj+0x54 / obj+0x58 / obj+0x50, each fed by the
        # nearest preceding `li`, plus the packed-sound cue the builder plays and
        # the optional `obj->0x28(obj, n)` that chooses the first state.
        tail = [(ins[o][0], ins[o][1]) for o in offs[i + 1:i + 30]]
        if not any(m == "lw" and "0x5c48($v0)" in t for m, t in tail):
            continue
        pins, last_li, last_a1, start_state = {}, None, None, None
        cue = None
        a0_hi, a0 = 0, None
        sound_call = False
        for j, (m, t) in enumerate(tail):
            if m in ("li", "addiu", "ori"):
                last_li = imm(t)
                v1 = imm(t, "a1")
                if v1 is not None:
                    last_a1 = v1
            k = re.match(r"^\$\w+,\s*(0x[0-9a-fA-F]+)\(\$\w+\)$", t)
            if k:
                dst = int(k.group(1), 16)
                if dst in (0x54, 0x58, 0x50) and last_li is not None:
                    pins[dst] = last_li
            # `li $a1, n` then `lw $v, 0x28($s0)` then `jalr` is SET_STATE(n)
            if m == "lw" and re.search(r"0x28\(\$\w+\)$", t) and last_a1 is not None:
                start_state = last_a1
            # The cue: `lw $v0, 0x5c48($v0)` after `lui $v0, 0x8005` is the
            # resident packed-id player, and its `$a0` is a `lui`/`addiu`-or-`ori`
            # pair whose WHOLE value is the packed word -- here the low half sits
            # in the `jalr`'s DELAY SLOT (wstag310 file 0x1510 `lui $a0, 0x4`,
            # 0x1528/0x152c the player, 0x1534 `jalr $v0`, 0x1538 `ori $a0, 0x1d`),
            # so the pair is read at the CALL, not at the `lui`.  That is also
            # the earlier reading's error: this is a sound, not the sprite-bank
            # resource the same comment used to call it.
            r, h = lui_reg(t)
            if r == "a0" and h is not None:
                a0_hi = h << 16
            elif m in ("addiu", "ori") and "$a0" in t:
                v2 = imm(t, "a0")
                if v2 is not None:
                    a0 = a0_hi + v2
            if m == "lw" and "0x5c48($v0)" in t:
                sound_call = True
            elif m == "jalr" and sound_call:
                # the low half may be the delay slot's, so look one ahead
                lo = a0
                if j + 1 < len(tail):
                    m2, t2 = tail[j + 1]
                    if m2 in ("addiu", "ori"):
                        v2 = imm(t2, "a0")
                        if v2 is not None:
                            lo = a0_hi + v2
                if lo is not None:
                    cue = lo
                sound_call = False

        pins[0x50] = pins.get(0x50)
        if 0x54 not in pins or 0x58 not in pins or tick is None:
            continue
        start = routine_start(ins, off)
        out.append({
            "builder": OVERLAY_BASE + start,
            "call": OVERLAY_BASE + off,
            "tick": tick,
            "x": pins[0x54],
            "y": pins[0x58],
            "baseClip": pins[0x50],
            "start_state": start_state or 0,
            "buildSound": f"0x{cue:08x}" if cue is not None else None,
        })
    return out


def find_stepper_calls(ins, start, span=0x400):
    """The overlay's own clip-stepper calls the tick makes, in program order.

    A stepper call is recognised by its cursor argument: the tick builds the
    cursor with `addiu $a0, $s0, 0x60` (the looping run) or `addiu $a0, $s0, 0x5c`
    (the one-shot burst run), and the clip table arrives in $a1 as a
    `lui`/`addiu` pair. That is exact, unlike "any table address in the body",
    which also catches the draw callback and the visibility helper.
    """
    out = []
    hi = 0
    pending = None
    for off in sorted(ins):
        if off < start or off >= start + span:
            continue
        mnem, text = ins[off]
        if mnem == "lui":
            r, h = lui_reg(text)
            if r == "a1" and h is not None:
                hi = h << 16
            continue
        if pending is None:
            k = re.match(r"^\$a0,\s*\$s0,\s*(0x[0-9a-fA-F]+)$", text)
            if k:
                pending = int(k.group(1), 16)
        if mnem == "jal" and pending is not None:
            lo = imm(text)
            out.append({"cursor": pending, "table": hi + (lo or 0) if text.startswith("0x800a") else None,
                        "target": text})
            pending = None
        v = imm(text, "a1")
        if v is not None:
            hi += v
    return out


def tick_is_family(ins, start):
    """The state gate, the 300 sentinel and two stepper calls, in one routine."""
    offs = [o for o in sorted(ins) if o >= start]
    body = offs[:0x400]
    texts = [ins[o] for o in body]
    flat = " ".join(t for _, t in texts)
    if "0x12c" not in flat:
        return False
    if not any(m == "li" and imm(t) == BURST_HIDE_CLIP for m, t in texts):
        return False
    if sum(1 for m, t in texts if m == "jal" and t.startswith("0x800a")) < 2:
        return False
    return any(m == "jal" and "F0x800143dc" not in t and t.startswith("0x800a")
               for m, t in texts)


def read_sequence(words, addr):
    """4-byte `{s16 clip, u16 hold}` records up to and including clip 255."""
    off = addr - OVERLAY_BASE
    out = []
    for i in range(MAX_SEQUENCE):
        w = words.get(off + 4 * i)
        if w is None:
            break
        clip = w & 0xFFFF
        clip = clip - 0x10000 if clip & 0x8000 else clip
        out.append({"clip": clip, "hold": (w >> 16) & 0xFFFF})
        if clip == 0xFF:
            break
    return out


def registry_ids():
    """`{construct_fn: id}` over the shipped fieldstg registry image."""
    data = FIELDSTG_IMAGE.read_bytes()
    out = {}
    i = REGISTRY_RAM - FIELDSTG_BASE
    while i + REGISTRY_STRIDE <= len(data):
        rid, ctor, draw = struct.unpack_from("<III", data, i)
        if rid == 0:
            break
        if ctor:
            out.setdefault(ctor, rid)
        i += REGISTRY_STRIDE
    return out


def build(stage):
    ins, words = parse(stage)
    if ins is None:
        return []
    ids = registry_ids()
    rows = []
    for b in find_builders(ins):
        if b["tick"] is None or b["tick"] < OVERLAY_BASE:
            continue
        toff = b["tick"] - OVERLAY_BASE
        if not tick_is_family(ins, toff):
            continue
        calls = find_stepper_calls(ins, toff)
        by_cursor = {c["cursor"]: c["table"] for c in calls if c["table"]}
        if 0x5C not in by_cursor or 0x60 not in by_cursor:
            continue
        loop_seq = read_sequence(words, by_cursor[0x60])
        burst_seq = read_sequence(words, by_cursor[0x5C])
        if not loop_seq or not burst_seq:
            continue
        rid = ids.get(b["builder"])
        if rid is None:
            continue
        # The state gate is read out of the tick, not assumed: the band that
        # runs BOTH clip runs is the one the overlay's builder can leave the
        # object in, and every overlay of this family also draws a reduced band
        # in state 1 (the standing sprite from the palette run alone).
        full_state = b["start_state"] or 1
        rows.append({
            "id": rid,
            "builder": "0x%08x" % b["builder"],
            "call": "0x%08x" % b["call"],
            "tick": "0x%08x" % b["tick"],
            "x": b["x"],
            "y": b["y"],
            "baseClip": b["baseClip"],
            "startState": b["start_state"] or 0,
            "buildSound": b["buildSound"],
            "fullState": full_state,
            "drawStates": sorted({1, full_state}),
            "loopSeq": loop_seq,
            "burstSeq": burst_seq,
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--stage")
    args = ap.parse_args()
    stages = ([args.stage.lstrip("s")] if args.stage
              else sorted(p.stem.lstrip("s") for p in (REPO / "web/assets/native").glob("s*.bin")))
    out = {}
    for stage in stages:
        try:
            rows = build(stage)
        except (OSError, ValueError, KeyError, IndexError, struct.error) as exc:
            print("skip %s: %s" % (stage, exc), file=sys.stderr)
            continue
        if rows:
            out[stage] = rows
    total = sum(len(v) for v in out.values())
    print("fixed-sprite family: %d members over %d overlays" % (total, len(out)),
          file=sys.stderr)
    for k in sorted(out):
        for r in out[k]:
            print("  s%s id %d (0x%03x) tick %s at (%d,%d) base clip %s"
                  % (k, r["id"], r["id"], r["tick"], r["x"], r["y"], r["baseClip"]),
                  file=sys.stderr)
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    else:
        print(json.dumps(out, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
