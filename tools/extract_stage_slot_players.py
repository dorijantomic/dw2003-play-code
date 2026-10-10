#!/usr/bin/env python3
"""Inventory + extract the display-slot channel players: the stage overlays'
own writers into the field's 18-byte record chain.

WHAT THIS IS
------------
The field's ambient decorations live in one chain of 18-byte display slots whose
head pointer sits at RAM `0x80099D90` (`docs/research/field/point-sprite-ambient-system.md`,
canonical). `tools/extract_point_sprites.py` already extracts that chain per
stage into `web/assets/data/point_sprites.json`, and `web/effects.js` is its
reader. What is missing in ordinary play is a WRITER: a handful of stage-overlay
routines claim one slot by its tag byte and then write that slot's clip, palette
and live flag every frame. Those writers only existed as original machine code
behind `?nativeStages`, so every decoration they own stood switched off.

The single-channel shape, read out of wstag305 `F0x800a5eb8` (file 0xd8):

    wstag305.s .L0x00000110  lw $a0, -0x6270($v0)     # $a0 = [0x80099D90]
    wstag305.s .L0x00000134  lbu $v0, -0x1($v1)       # the slot's tag byte, +1
    wstag305.s .L0x0000013c  bne $v0, $a2, .L00..154  # $a2 = the tag this member claims
    wstag305.s .L0x00000144  sh $zero, 0x58($s1)      # the clip cursor's index
    wstag305.s .L0x0000014c  sw $a0, 0x54($s1)        # the slot it claimed
    wstag305.s .L0x00000150  sh $v0, 0x5a($s1)        # the cursor's hold timer
    wstag305.s .L0x0000015c  lbu $v0, ($v1)           # the terminator: slot +2 == size
    wstag305.s .L0x000001c0  jal D0x800a5de0          # the overlay's own clip stepper
    wstag305.s .L0x000001a4  sb $v0, 4($s0)           # slot +4 = the sprite
    wstag305.s .L0x000001ac  sb $v1, ($s0)            # slot +0 = live

The five marks have to hold together in one routine, and the tool reports every
overlay that satisfies them. The registry id is then read out of the shipped
fieldstg image: the 12-byte record at `0x8009B3E8` whose `construct_fn` word is
this overlay's builder.

Usage:
    python3 tools/extract_stage_slot_players.py                # summary
    python3 tools/extract_stage_slot_players.py --out web/assets/data/stage_slot_players.json
    python3 tools/extract_stage_slot_players.py --stage s305   # one overlay
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
import inventory_stage_registry as isr  # noqa: E402

OVERLAY_BASE = iso.OVERLAY_BASE
FIELDSTG_IMAGE = REPO / "web/assets/native/fieldstg.bin"
FIELDSTG_BASE = 0x80082CB0
REGISTRY_RAM = 0x8009B3E8
REGISTRY_STRIDE = 12
DEFAULT_OUT = REPO / "web/assets/data/stage_slot_players.json"

# The chain walk, as the overlay spells it.
CHAIN_LOAD = "0x6270($v0)"
CHAIN_HI = 0x800A
CHAIN_RAM = 0x80099D90
STRIDE = 0x12
# The cursor block this shape keeps in the object, and the counter it steps.
CURSOR_REC, CURSOR_INDEX, CURSOR_TIMER = 0x54, 0x58, 0x5A
COUNTER_OFFSET = 0x10
# Object state gate: state 1 draws, state 0 or >= 4 re-arms, 2 and 3 park.
DRAW_STATE = 1
MAX_SEQUENCE = 64
# The record fields this shape writes.
REC_ACTIVE, REC_CLIP = 0, 4


def parse(stage):
    ov = iso.parse_overlay(stage)
    if ov is None:
        return None, None
    ins = {}
    for off, text in ov["ins"].items():
        m = re.match(r"^([a-z._]+)\s*(.*)$", text)
        ins[off] = (m.group(1), m.group(2).strip()) if m else (text.strip(), "")
    return ins, ov["words"]


def imm(text, reg=None):
    m = re.match(r"^\$(\w+),\s*(-?0x[0-9a-fA-F]+)$", text.strip())
    if not m or (reg and m.group(1) != reg):
        return None
    return int(m.group(2) or "0", 0)


def routine_start(ins, off):
    """The first instruction of the routine containing `off`.

    The registry names a routine's ENTRY, not an instruction inside it, so the
    allocator call has to be reported as the builder that contains it. The split
    is on the routine's own `jr $ra`; that instruction owns the next word as its
    delay slot, so the next routine starts one word further on.
    """
    offs = sorted(ins)
    if off not in offs:
        return None
    i = offs.index(off)
    for j in range(i - 1, -1, -1):
        if ins[offs[j]][0] == "jr" and "$ra" in ins[offs[j]][1]:
            return offs[j + 2] if j + 2 <= i else off
    return off


def routine_end(ins, start, limit=0x400):
    """One past the routine's `jr $ra` (its delay slot owns the next word)."""
    off = start
    while off < start + limit:
        if off in ins and ins[off][0] == "jr" and "$ra" in ins[off][1]:
            return off + 8
        off += 4
    return start + limit


def chain_routines(ins):
    """Every routine that reads the display-slot chain head at 0x80099D90."""
    offs = sorted(ins)
    hits = []
    for i, off in enumerate(offs):
        if ins[off] != ("lw", "$a0, " + CHAIN_LOAD.replace("0x6270", "-0x6270")):
            continue
        # the `lui` that supplies 0x800a must be in the same basic block
        hi = None
        for j in range(i - 1, max(-1, i - 8), -1):
            if ins[offs[j]][0] == "lui":
                hi = imm(ins[offs[j]][1])
                break
            if ins[offs[j]][0] in ("jr", "j"):
                break
        if hi != CHAIN_HI:
            continue
        start = offs[0]
        for j in range(i, -1, -1):
            if ins[offs[j]][0] == "jr" and "$ra" in ins[offs[j]][1]:
                start = offs[j + 2] if j + 2 <= i else offs[i]
                break
        hits.append((start, routine_end(ins, start)))
    return hits


def _tag_compare(ins, lo, hi):
    """The tag byte this routine claims, from `li $aX, N` + `bne <tag>, $aX`.

    Returns `(tag, offset)` or None. Reading it off the compare rather than off
    a table means a stage cannot smuggle in a tag the code does not test.
    """
    offs = [o for o in sorted(ins) if lo <= o < hi]
    for i, off in enumerate(offs):
        mnem, text = ins[off]
        if mnem != "bne":
            continue
        m = re.match(r"^\$v0,\s*\$(\w+),\s*\.L", text)
        if not m:
            continue
        reg = m.group(1)
        # the tag byte is read one below the pointer the stride walk keeps
        if not any(ins[o] == ("lbu", "$v0, -0x1($v1)") for o in offs[max(0, i - 6):i]):
            continue
        for j in range(i - 1, max(-1, i - 8), -1):
            if ins[offs[j]][0] == "li" and imm(ins[offs[j]][1], reg) is not None:
                return imm(ins[offs[j]][1], reg), off
    return None


def _cursor_block(ins, lo, hi):
    """The obj offsets of `{slot, index, timer}`, from the three claim stores."""
    offs = [o for o in sorted(ins) if lo <= o < hi]
    rec = idx = tmr = None
    for off in offs:
        mnem, text = ins[off]
        m = re.match(r"^(\$\w+),\s*(?:(0x[0-9a-fA-F]+|\d+))?\(\$\w+\)$", text)
        if not m:
            continue
        src, dst = m.group(1), int(m.group(2) or "0", 0)
        if mnem == "sw" and dst == CURSOR_REC and src == "$a0":
            rec = dst
        elif mnem == "sh" and dst == CURSOR_INDEX and src in ("$zero", "$zr"):
            idx = dst
        elif mnem == "sh" and dst == CURSOR_TIMER:
            tmr = dst
    if rec is None or idx is None or tmr is None:
        return None
    return {"rec": rec, "index": idx, "timer": tmr}


def _constants(ins, lo, hi, dst="$a1"):
    """Every constant `dst` holds in the routine, as `(offset, value)`.

    The overlays build an address as `lui $v0, H` then `addiu $dst, $v0, L` --
    the pair is the WHOLE word, so both halves have to be tracked. `lui $dst, H`
    on its own also counts, because a few sites load the high half first.
    """
    out = []
    hi_half = 0
    for off in (o for o in sorted(ins) if lo <= o < hi):
        mnem, text = ins[off]
        m = re.match(r"^(\$\w+),\s*(0x[0-9a-fA-F]+)$", text) if mnem == "lui" else None
        if m:
            hi_half = int(m.group(2) or "0", 0) << 16
            if m.group(1) == dst:
                out.append((off, hi_half))
            continue
        m = (re.match(r"^(\$\w+),\s*(\$\w+),\s*(-?0x[0-9a-fA-F]+)$", text)
             if mnem == "addiu" else None)
        if m and m.group(1) == dst and m.group(2) == "$v0" and hi_half:
            out.append((off, hi_half + int(m.group(3), 0)))
            hi_half = 0
    return out


def _stepper_table(ins, lo, hi):
    """The overlay's own clip table: the $a1 the walk seeds the timer from AND
    the $a1 its clip stepper is called with.

    Both spellings must agree, so a routine that happens to read some other
    table cannot be mistaken for this shape.
    """
    offs = [o for o in sorted(ins) if lo <= o < hi]
    seed = None
    for i, off in enumerate(offs):
        if ins[off] != ("lhu", "$v0, 0x2($a1)"):
            continue
        for k, val in _constants(ins, lo, hi):
            if k < off and val > 0x80000000:
                seed = val
                break
        if seed is not None:
            break
    if seed is None:
        return None
    # the stepper call itself: `jal <an overlay address>` after $a1 was set
    for off in offs:
        if ins[off][0] != "jal":
            continue
        for k, val in _constants(ins, lo, hi):
            if k < off and val == seed:
                return seed
    return None



def _bands(ins, lo, hi, counter_offset):
    """What the slot shows for each value of the object's counter.

    The drawing band is small and it contains **two branches whose delay slots
    overwrite the very register the branch tests**. A PS1 runs a branch's delay
    slot BEFORE the branch resolves, so this pair is always taken whatever the
    test said:

        wstag305.s .L0x00000190  bnez $v0, .L0x000001a4     # $v0 = (counter < 2)
        wstag305.s .L0x00000194  li $v0, 0x5                # ... delay slot: $v0 = 5
        wstag305.s .L0x000001a4  sb $v0, 4($s0)             # so the clip is 5, always

    and it makes the `counter == 2` block below it unreachable, so the clip 10 at
        wstag305.s .L0x00000218  li $v0, 0xa
        wstag305.s .L0x00000220  sb $v0, 4($s0)
    is DEAD CODE on the console. Reading the band as ordinary flow invents a
    phase a player never sees.

    So the band is read the way it runs, and every claim is checked against the
    instruction it came from:

      * `runAt` is the counter value whose branch lands on the stepper block.
        The branch compares the counter against the register the state word was
        loaded into, and the band is only entered at state 1, so that value is
        the state word: 1.
      * every other counter value takes the always-taken branch and pins the
        literal its delay slot installed.
      * the unreachable `beq <counter>, N` block must be PRESENT, or this band is
        a shape the extractor does not model and the member is refused.

    Returns `(runAt, {counter: {active, clip}})`.
    """
    offs = [o for o in sorted(ins) if lo <= o < hi]
    index = {o: i for i, o in enumerate(offs)}
    creg, state_reg, entry = None, None, None
    for off in offs:
        mnem, text = ins[off]
        m = re.match(r"^(\$\w+),\s*(?:(0x[0-9a-fA-F]+|\d+))?\(\$\w+\)$", text)
        if mnem == "lw" and m:
            reg, o2 = m.group(1), int(m.group(2) or "0", 0)
            if o2 == counter_offset and creg is None:
                creg, entry = reg, off
            if o2 == 0x0C:
                state_reg = reg
    if not (creg and state_reg and entry is not None):
        return None
    # the run branch: `beq <counter>, <stateReg>, L` whose delay slot is the
    # `slti`, and whose target reaches the overlay's stepper call.
    run_at, run_branch, clip_off, step_call = None, None, None, None
    for i, off in enumerate(offs):
        if ins[off][0] != "beq":
            continue
        m = re.match(r"^(\$\w+),\s*(\$\w+),\s*\.L0x([0-9a-fA-F]+)$", ins[off][1])
        if not m or m.group(1) != creg or m.group(2) != state_reg:
            continue
        target = int(m.group(3), 16)
        if target not in index:
            continue
        run_branch, run_at = i, 1          # the band is entered at state 1 only
        for k in range(index[target], min(index[target] + 10, len(offs))):
            if ins[offs[k]][0] == "jal":
                step_call = offs[k]
                break
        break
    if run_branch is None or step_call is None:
        return None
    # the always-taken branch after it, and the literal in ITS delay slot
    nxt = run_branch + 2
    if nxt >= len(offs) or ins[offs[nxt]][0] not in ("bnez", "bne", "beqz", "beq"):
        return None
    br = ins[offs[nxt]]
    if br[0] not in ("bnez", "bne"):
        return None                       # a conditional zero test would not be always taken
    if nxt + 1 >= len(offs) or ins[offs[nxt + 1]][0] not in ("li", "addiu", "ori"):
        return None
    lit = imm(ins[offs[nxt + 1]][1])
    if lit is None:
        return None
    if imm(br[1]) is not None and br[1].split(",")[0].strip() == "$v0":
        return None                       # the test is not against the literal we read
    # the branch's own target is the block that stores the literal
    lm = re.match(r"^\$\w+,\s*\.L0x([0-9a-fA-F]+)$", br[1])
    if not lm or int(lm.group(1), 16) not in index:
        return None
    store = index[int(lm.group(1), 16)]
    sm = re.match(r"^\$\w+,\s*(?:(0x[0-9a-fA-F]+|\d+))?\(\$\w+\)$", ins[offs[store]][1])
    if ins[offs[store]][0] != "sb" or not sm or int(sm.group(1) or "0", 0) != REC_CLIP:
        return None
    clip_off = offs[store]
    # the active store, and the unreachable equals-branch that must be present:
    # it sits between the always-taken branch and the block it lands on.
    dead = any(ins[offs[k]][0] == "beq" and ins[offs[k]][1].startswith(creg + ",")
               for k in range(nxt + 2, store))
    # the live-flag store sits in the `j`'s delay slot right after the clip one
    active = None
    for k in range(store, min(store + 4, len(offs))):
        if ins[offs[k]][0] != "sb":
            continue
        m2 = re.match(r"^\$\w+,\s*(?:(0x[0-9a-fA-F]+|\d+))?\(\$\w+\)$", ins[offs[k]][1])
        if m2 and int(m2.group(1) or "0", 0) == REC_ACTIVE:
            active = 1
            break
    if active is None or not dead:
        return None
    out = {c: ({"runs": True} if c == run_at else {"active": active, "clip": lit})
           for c in range(0, 9)}
    return run_at, out, clip_off


def read_sequence(words, addr, limit=MAX_SEQUENCE):
    """4-byte `{s16 clip, u16 hold}` records up to and including clip 255."""
    off = addr - OVERLAY_BASE
    out = []
    for i in range(limit):
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
    """`{construct_fn: id}` and `{draw_fn: id}` over the shipped registry image.

    Both words matter. A member whose record carries a constructor is named by
    its `construct_fn`; a member the stage builds itself has `construct_fn == 0`
    and is named by its `draw_fn`, which for this shape is the configure handler
    the registry calls with the SETANIM sub-command.
    """
    data = FIELDSTG_IMAGE.read_bytes()
    by_ctor, by_draw = {}, {}
    i = REGISTRY_RAM - FIELDSTG_BASE
    while i + REGISTRY_STRIDE <= len(data):
        rid, ctor, draw = struct.unpack_from("<III", data, i)
        if rid == 0:
            break
        if ctor:
            by_ctor.setdefault(ctor, rid)
        if draw:
            by_draw.setdefault(draw, []).append(rid)
        i += REGISTRY_STRIDE
    return by_ctor, by_draw


def builders(ins):
    """`F0x800143dc(tick, size, 0, id)` wrappers, with their tick address."""
    out = []
    offs = sorted(ins)
    for i, off in enumerate(offs):
        if ins[off] != ("jal", "F0x800143dc"):
            continue
        win = [(ins[o][0], ins[o][1]) for o in offs[max(0, i - 10):i + 1]]
        size = next((v for m, t in win if m == "li" and (v := imm(t, "a1")) is not None), None)
        hi = next((h for m, t in win if m == "lui" and (h := imm(t)) is not None), 0)
        lo = next((v for m, t in win if m == "addiu" and (v := imm(t, "a0")) is not None), None)
        if lo is None:
            continue
        tick = (hi << 16) + lo
        start = offs[i]
        for j in range(i, -1, -1):
            if ins[offs[j]][0] == "jr" and "$ra" in ins[offs[j]][1]:
                start = offs[j + 2] if j + 2 <= i else offs[i]
                break
        out.append({"builder": OVERLAY_BASE + start, "tick": tick, "size": size})
    return out


def configure_subcommand(ins, tick_off):  # noqa: C901
    """The sub-command the overlay's configure handler answers to, and the
    packed sound it plays.

    The handler is a separate routine reached from the registry's own record, so
    it is found by its shape: `li $aX, N` + `bne $a1, $aX` guards everything, and
    the body plays one packed sound through `[0x80055c48]` (`lui $a0, H` +
    `ori $a0, L` is the WHOLE id).
    """
    offs = sorted(ins)
    for off in offs:
        if off <= tick_off:
            continue
        mnem, text = ins[off]
        if mnem != "li":
            continue
        sub = imm(text)
        if sub is None or sub < 0x100:
            continue
        nxt = off + 4
        if nxt not in ins or ins[nxt][0] != "bne" or "$a1" not in ins[nxt][1]:
            continue
        end = routine_end(ins, off)
        hi = 0
        for o in offs:
            if not (off <= o < end):
                continue
            m, tx = ins[o]
            if m == "lui" and imm(tx, "a0") is not None:
                hi = imm(tx, "a0") << 16
            elif m == "ori" and imm(tx, "a0") is not None and hi:
                return {"handler": OVERLAY_BASE + (routine_start(ins, off) or off),
                        "sub": sub,
                        "sound": "0x%08x" % (hi + imm(tx, "a0"))}
    return None


# The stage's own recovered bytecode: which ids THIS stage's scripts fire.
try:
    SCRIPTS, _STAGES = isr.read_scripts()
except Exception:                                    # pragma: no cover
    SCRIPTS = {}


def _own_id(stage, handler, builder, by_ctor, by_draw, fired):
    """The registry id this stage owns, for a member the stage builds itself.

    Every wstag overlay loads at 0x800a5de0, so wstag305's configure handler and
    wstag306's are the SAME address and the registry table lists BOTH ids against
    it. The tie is broken with the stage's own recovered bytecode: the id the
    stage's own scripts fire is the id the stage owns. Falling back to the
    builder word, and then to a single candidate, keeps a stage whose event
    table was never recovered from being dropped.
    """
    for rid in by_draw.get(handler, []):
        if rid in fired:
            return rid
    cands = by_draw.get(handler, [])
    if len(cands) == 1:
        return cands[0]
    return by_ctor.get(builder)


def build(stage):
    ins, words = parse(stage)
    if ins is None:
        return []
    by_ctor, by_draw = registry_ids()
    by_tick = {b["tick"]: b for b in builders(ins)}
    fired = SCRIPTS.get(stage, {})
    rows = []
    for lo, hi in chain_routines(ins):
        tag_hit = _tag_compare(ins, lo, hi)
        cursor = _cursor_block(ins, lo, hi)
        table = _stepper_table(ins, lo, hi)
        if not (tag_hit and cursor and table):
            continue
        tag, _cmp = tag_hit
        # the cursor block and the counter are the offsets the stores named
        if (cursor["rec"], cursor["index"], cursor["timer"]) != (
                CURSOR_REC, CURSOR_INDEX, CURSOR_TIMER):
            continue
        seq = read_sequence(words, table)
        if len(seq) < 2 or seq[-1]["clip"] != 0xFF:
            continue
        b = by_tick.get(OVERLAY_BASE + lo)
        if b is None:
            continue
        cfg = configure_subcommand(ins, lo) or {}
        rid = _own_id(stage, cfg.get("handler"), b["builder"], by_ctor, by_draw, fired)
        if rid is None:
            continue
        band = _bands(ins, lo, hi, COUNTER_OFFSET)
        if band is None:
            continue
        runs_at, phases, _clip_store = band
        rows.append({
            "id": rid,
            "builder": "0x%08x" % b["builder"],
            "tick": "0x%08x" % (OVERLAY_BASE + lo),
            "tag": tag,
            "table": "0x%08x" % table,
            "clips": seq,
            "runAt": runs_at,
            "phases": phases,
            "subCommand": cfg.get("sub"),
            "sound": cfg.get("sound"),
            "cursor": cursor,
            "counterOffset": COUNTER_OFFSET,
            "drawState": DRAW_STATE,
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
    print("display-slot channel players: %d members over %d overlays"
          % (total, len(out)), file=sys.stderr)
    for k in sorted(out):
        for r in out[k]:
            print("  s%s id %d (0x%03x) tick %s tag %d table %s sound %s"
                  % (k, r["id"], r["id"], r["tick"], r["tag"], r["table"], r["sound"]),
                  file=sys.stderr)
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    else:
        print(json.dumps(out, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
