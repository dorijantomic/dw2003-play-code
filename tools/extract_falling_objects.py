#!/usr/bin/env python3
"""Extract the per-stage falling-object actor (the rockfall) to walker assets.

System decoded 2026-10-04 (see docs/research/field/s415-deeper-crevice-ride-decode.md
§RESOLVED and §"Boulders use the layer-job draw path", and ledger
STAGE-SWEEP-E20 / EV-S415-ROCKFALL-2026-10-04).

A falling/bouncing rock is NOT a fieldstg system: a stage overlay builds it for
itself, exactly like the type-0x17 launch pads. The shape (wstag415, overlay
base 0x800a5de0) is

    tick (wstag415 0x800a5fa8, whole-function copy count over the 294 wstag
          overlays: 1 -- s415 is the only stage that carries it):

      state = obj->0xc            (F0x800143dc's state word, +0x28..+0x44 method block)
      state 0  -> load record 16 bytes from TABLE indexed by obj->0x4 * 16
      state 1  -> fall
      state >=2 -> return

    record (TABLE + slot*16):
      +0x0 u32  animation-sequence pointer (into the same overlay)
      +0x4 s16  start x,   8.8 fixed  (<<8 into obj+0x5c)
      +0x6 s16  start y,   8.8 fixed  (<<8 into obj+0x60)
      +0x8 s16  bounce y threshold   (pixels)
      +0xa s16  per-frame x step     (8.8)
      +0xc u16  per-frame fall accel (velocity added each frame)
      +0xe u16  bounce divisor (0 = this rock never bounces)

    sequence entry (seq + n*4): s16 clip, u16 hold-frames. The end marker is
      clip == 255 (0xff), not -1: wstag415 0x800a5db4 loads `li $v0, 0xff`
      and branches on `bne`, so a halfword of +255 ends the run and loops. The
      stage's own stepper (wstag415 0x800a5df4) walks the sequence.

    draw (wstag415 0x800a5ee8): submits obj+0x50 (the clip the stepper just
      returned) at obj+0x54 / obj+0x58 through the resident draw-context
      drawSprite EXE F0x8001ed6c, and only while state == 1.

The table lives at a different offset in each overlay and every record's
sequence pointer points back into its own overlay, so both are read per stage.
Membership is decided by a 12-instruction signature at the state-0 path with
only the table immediate free, so a stage that ships this actor is found by its
code rather than by a hand list.

Output: web/assets/data/falling_objects.json (needs web/assets/native/fieldstg.bin
for the id -> slot pairing; it is built from the disc by build_all's native stage)

    { "415": { "tick": "0x800a5fa8", "draw": "0x800a5ee8",
               "stepper": "0x800a5df4", "table": "0x800a7350",
               "stride": 16, "slots": 10, "despawnY": 581,
               "sound": "0x00040012",
               "sequences": { "0x800a7328": [[70,8], ..., [255,0]] },
               "builders":  [{"slot":0,"ctor":"0x800a5dd0","effectId":816}, ...],
               "records": [ {"seq":"0x800a7328","x":-32,"y":230,
                             "bounceY":0,"xStep":0,"accel":88,
                             "divisor":0}, ... ] }, ... }

Fail-soft: a stage whose signature or table does not parse is reported and
skipped; the tool always exits 0 so build_all never blocks on one overlay.
"""

import os
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs

WSTAG_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/falling_objects.json"
FIELDSTG = REPO / "web/assets/native/fieldstg.bin"
FIELDSTG_BASE = 0x80082CB0
EFFECT_REGISTRY = 0x8009B3E8

BASE = 0x800A5DE0  # every wstag overlay's load address
OVERLAY_SPAN = 0x10000  # overlays are a 0x20000-byte image; a pointer inside is data

# wstag415 0x800a5fa8 +0x5c .. +0x80, the state-0 record load. Only the table
# immediate (marked None) may differ; everything else must match exactly.
SIGNATURE = [
    0x3C04800A,  # lui   $a0, 0x800a
    None,        # addiu $a0, TABLE
    0x8E020004,  # lw    $v0, 0x4($s0)      -- slot index
    0x8E030004,  # lw    $v1, 0x4($s0)
    0x00021100,  # sll   $v0, 0x4            -- *16
    0x00441021,  # addu  $v0, $a0
    0x00031900,  # sll   $v1, 0x4
    0x84420004,  # lh    $v0, 0x4($v0)       -- start x
    0x00641821,  # addu  $v1, $a0
    0x00021200,  # sll   $v0, 0x8            -- 8.8 fixed
    0xAE02005C,  # sw    $v0, 0x5c($s0)
    0x84630006,  # lh    $v1, 0x6($v1)       -- start y
]

# wstag415 0x800a5ee8 +0x4c: the three object fields the draw hands to the
# resident drawSprite (the middle instruction is the stack draw-context read).
# Pins the draw function without depending on its offset.
DRAW_ARGS = [0x8E050050, None, 0x8E060054, 0x8E070058]  # $a1=+0x50 / $a2=+0x54 / $a3=+0x58

# wstag415 0x800a5fa8 +0x1f4: the despawn compare. `slti $v0, 0x245` is the
# short form of `slt $v0, $v0, 0x245`, i.e. y < 581 -> keep falling.
DESPAWN_SEQ = [0x28420245, 0x14400005]  # slti $v0,0x245 / bnez -> epilogue

# wstag415 0x800a5fa8 +0x1d4: the bounce sound. `lui $v0,0x8005` +
# `lw $v0,0x5c48($v0)` reads the packed-sound cell [0x80055c48] and `ori $a0,
# IMM` completes the word -- IMM is part of the word, so read it, do not guess.
SOUND_CELL = [0x3C028005, 0x8C425C48]

STRIDE = 16
MAX_SLOTS = 64
MAX_SEQ = 64
SEQ_END = 255  # wstag415 0x800a5db4: li $v0, 0xff / bne -> end of run


def _op(w):
    return w >> 26


def _rs(w):
    return (w >> 21) & 31


def _rt(w):
    return (w >> 16) & 31


def _imm(w):
    v = w & 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def match_at(words, offs, pattern):
    """Offset where `pattern` (None = any word) matches, else None."""
    for start in offs:
        for i, want in enumerate(pattern):
            got = words.get(start + i * 4)
            if got is None:
                break
            if want is not None and got != want:
                break
        else:
            return start
    return None


def function_start(words, off):
    """Walk back to the prologue `addiu $sp, -N` that opens the routine."""
    j = off
    while j > 0:
        w = words.get(j)
        if w is None:
            return None
        if _op(w) == 0x09 and _rt(w) == 29:  # addiu $sp, $zr, -N
            return j
        j -= 4
    return None


def find_tick(words):
    """(file offset of the tick, record-table RAM address) or (None, None)."""
    offs = sorted(words)
    site = match_at(words, offs, SIGNATURE)
    if site is None:
        return None, None
    start = function_start(words, site)
    if start is None:
        return None, None
    # `site` is the lui; the addiu carrying the table's low half is next.
    lo = words.get(site + 4)
    if lo is None or _op(lo) != 0x09 or _rt(lo) != 4:
        return None, None
    return start, 0x800A0000 + _imm(lo)


def find_draw(words, tick_start):
    """File offset of the falling object's draw callback."""
    offs = sorted(words)
    # Search backwards from the tick: the draw sits earlier in the overlay.
    order = [o for o in offs if o < tick_start]
    order.reverse()
    hit = match_at(words, order, DRAW_ARGS)
    if hit is None:
        return None
    return function_start(words, hit)


def read_records(words, table):
    """The 16-byte records at `table`, plus every sequence they name."""
    base = table - BASE
    records, seqs = [], {}
    for slot in range(MAX_SLOTS):
        off = base + slot * STRIDE
        head = [words.get(off + i * 4) for i in range(4)]
        if any(w is None for w in head):
            break
        seq = head[0]
        # A record's word 0 is an animation-sequence pointer inside THIS
        # overlay (s415 keeps its sequences just below the record table, so
        # "after the table" is NOT a valid membership test); anything outside
        # the overlay image means the table has ended.
        if not (BASE <= seq < BASE + OVERLAY_SPAN):
            break
        x, y = _imm(head[1] & 0xFFFF), _imm(head[1] >> 16)
        bounce_y, x_step = _imm(head[2] & 0xFFFF), _imm(head[2] >> 16)
        accel, divisor = head[3] & 0xFFFF, head[3] >> 16
        records.append({
            "seq": f"0x{seq:08x}",
            "x": x,
            "y": y,
            "bounceY": bounce_y,
            "xStep": x_step,
            "accel": accel,
            "divisor": divisor,
        })
        if seq not in seqs:
            seqs[seq] = read_sequence(words, seq)
    return records, seqs


def read_sequence(words, seq):
    """4-byte {s16 clip, u16 hold} entries, ending at the first clip == 255."""
    base = seq - BASE
    entries = []
    for i in range(MAX_SEQ):
        off = base + i * 4
        w = words.get(off)
        if w is None:
            break
        clip = _imm(w & 0xFFFF)
        entries.append([clip, w >> 16])
        if clip == SEQ_END:
            break
    return entries


def find_sound(words, tick_start):
    """The packed-sound word the bounce plays.

    The word reaches the packed-sound cell [0x80055c48] in $a0, and the original
    builds $a0 as a `lui`/`ori` PAIR that is NOT adjacent: in wstag415 the
    `lui $a0, 0x4` sits at 0x800a61d0 and the `ori $a0, 0x12` is the delay slot
    of the call at 0x800a61e4. Reading either half alone gives 4 or 0x12; the
    word is 0x00040012. So: take the last `lui $a0` before the call and the
    first $a0 low half at or after the call's delay slot.
    """
    end = tick_start + 0x400
    offs = sorted(o for o in words if tick_start <= o < end)
    cell = match_at(words, offs, SOUND_CELL)
    if cell is None:
        return None
    hi = None
    for o in offs:
        w = words[o]
        if o > cell:
            break
        if _op(w) == 0x0F and _rt(w) == 4:  # lui $a0, hi
            hi = (w & 0xFFFF) << 16
    if hi is None:
        return None
    # lui $v0 / lw $v0 / nop / jalr $v0 / delay-slot: the argument is in the
    # slot after the jump, so scan from there forward a few instructions.
    for o in range(cell + 0x10, min(cell + 0x30, end), 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x0D and _rt(w) == 4:  # ori $a0, lo
            return hi | (w & 0xFFFF)
        if _op(w) == 0x09 and _rt(w) == 4:  # addiu $a0, rX, lo
            return hi | (w & 0xFFFF)
    return None


def find_stepper(words, tick_start):
    """The overlay's own animation-sequence stepper the tick calls."""
    for o in range(tick_start, tick_start + 0x200, 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x03:  # jal: target = 0x80000000 + (field << 2)
            return 0x80000000 + ((w & 0x03FFFFFF) << 2)
    return None


def find_despawn(words, tick_start):
    """The y at or above which the actor switches to its dead state."""
    offs = sorted(o for o in words if tick_start <= o < tick_start + 0x400)
    hit = match_at(words, offs, DESPAWN_SEQ)
    if hit is None:
        return None
    return _imm(DESPAWN_SEQ[0] & 0xFFFF)


def find_builders(words, tick_addr):
    """The overlay's own builders: [{slot, addr}] for this actor's callback.

    Each wrapper does `lui $a0, TICK / li $a1, 0x74 / jal F0x800143dc` and
    stores a constant to the new object's +4 (its table slot). The overlay keeps
    them in the order the resident effect registry hands out ids, so pairing them
    with the registry (below) yields id -> slot without a hand list.
    """
    out = []
    for off in sorted(words):
        w = words[off]
        if _op(w) != 0x0F or _rt(w) != 4:  # lui $a0, hi
            continue
        # The next line is `addiu $a0, 0xLO` off that same $a0, so its rs is $a0
        # too -- not the zero-register form `addiu $a0, $zero, LO` would be.
        nxt = words.get(off + 4)
        if nxt is None or _op(nxt) != 0x09 or _rt(nxt) != 4 or _rs(nxt) != 4:
            continue
        if (nxt & 0xFFFF) != (tick_addr & 0xFFFF):
            continue
        site = off + 8
        while site < off + 0x20:
            w2 = words.get(site)
            if w2 is None:
                break
            if _op(w2) == 0x03:  # jal F0x800143dc
                break
            site += 4
        else:
            continue
        if _op(words.get(site, 0)) != 0x03:
            continue
        start = function_start(words, off)
        if start is None:
            continue
        slot = None
        for o in range(site, min(site + 0x10, max(words) + 4), 4):
            w3 = words.get(o)
            if w3 is None:
                break
            # li $v?, N (addiu $v?, $zero, N) then sw $v?, 0x4($v0)
            if _op(w3) == 0x09 and _rs(w3) == 0:
                slot = _imm(w3 & 0xFFFF)
                break
            if w3 == 0xAC400004:  # sw $zr, 0x4($v0)
                slot = 0
                break
        if slot is not None:
            out.append({"slot": slot, "addr": f"0x{BASE + start:08x}"})
    return out


def effect_registry():
    """id -> ctor address, from the resident fieldstg effect registry.

    fieldstg F0x8009243c walks 12-byte {id, ctor, draw} entries at 0x8009b3e8 and
    stops at the first zero id; F0x80092484 constructs through +4 and
    F0x800924c8 configures through +8. Read out of the shipped FIELDSTG.PRO
    image (authority 4) so the id -> slot pairing is read, not assumed.
    """
    try:
        blob = FIELDSTG.read_bytes()
    except OSError:
        return {}
    out = {}
    off = EFFECT_REGISTRY - FIELDSTG_BASE
    while off + 12 <= len(blob):
        eid, ctor = struct.unpack_from("<II", blob, off)
        if eid == 0:
            break
        out[f"0x{ctor:08x}"] = eid
        off += 12
    return out


def extract(stage):
    words = ovs.load_words(WSTAG_DIR / f"wstag{stage}.s")
    if not words:
        return None
    tick, table = find_tick(words)
    if tick is None:
        return None
    records, seqs = read_records(words, table)
    if not records:
        raise ValueError(f"s{stage}: falling-object table at 0x{table:08x} read no records")
    draw = find_draw(words, tick)
    entry = {
        "tick": f"0x{BASE + tick:08x}",
        "table": f"0x{table:08x}",
        "stride": STRIDE,
        "slots": len(records),
        "records": records,
        "sequences": {f"0x{addr:08x}": seqs[addr] for addr in sorted(seqs)},
    }
    if draw is not None:
        entry["draw"] = f"0x{BASE + draw:08x}"
    stepper = find_stepper(words, tick)
    if stepper is not None:
        entry["stepper"] = f"0x{stepper:08x}"
    despawn = find_despawn(words, tick)
    if despawn is not None:
        entry["despawnY"] = despawn
    sound = find_sound(words, tick)
    if sound is not None:
        entry["sound"] = f"0x{sound:08x}"
    builders = find_builders(words, BASE + tick)
    if builders:
        reg = effect_registry()
        entry["builders"] = [
            {"slot": b["slot"], "ctor": b["addr"],
             "effectId": reg.get(b["addr"].lower(), reg.get(b["addr"]))}
            for b in sorted(builders, key=lambda b: b["slot"])
        ]
    return entry


def main():
    out, skipped = {}, []
    for path in sorted(WSTAG_DIR.glob("wstag*.s")):
        stage = path.stem[len("wstag"):]
        try:
            got = extract(stage)
        except ValueError as exc:  # fail-soft: report, keep going
            skipped.append(str(exc))
            continue
        if got:
            out[stage] = got

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    total = sum(len(v["records"]) for v in out.values())
    print(f"falling objects: {len(out)} stages, {total} slots -> {OUT}")
    for line in skipped:
        print(f"  skipped: {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())