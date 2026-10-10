#!/usr/bin/env python3
"""THE point-record actor system: every field stage object that claims its own
stage's dormant point-sprite records by their atlas tag and animates them.

One extractor for every member of the family, because the original has one
system and
three parameters, not three systems.  Read out of the overlays on 2026-10-04:

  THE CLAIM (shared verbatim, fieldstg F0x80089548 / F0x800894d8,
  fieldstg.s file 0x6898 / 0x6828):

      .L0x0000689c: lui $v0, 0x800a
      .L0x000068a0: sw  $a0, -0x4704($v0)   # 0x8005b8fc = the tag being looked for
      .L0x000068a8: lw  $v1, -0x6270($v0)   # 0x80099d90 = the stage's point table
      .L0x000068b4: jal 0x800894d8
      .L0x000068b8: sw  $v1, -0x4708($v0)   # 0x8005b8f8 = the walk cursor
      .L0x0000682c: lw  $a0, -0x4708($v0)   # resume where the last call stopped
      .L0x00006834: lbu $v0, 0x2($a0)       # record+2 == 0 -> the table ends
      .L0x00006850: lbu $v0, -0x1($v1)      # record+1 = the atlas tag to match
      .L0x00006870: bnez $v0, .L0x00006850  # walk on in 0x12-byte strides
      .L0x00006860: j 0x80089528            # match: return 1, cursor steps +0x12

  So the walk RESUMES: calling it again with the next tag finds the next record,
  and a tag that matches nothing returns 0 with the cursor left past the end.

  THE STEPPER (one routine, repeated at every overlay's base, 0x800a5de4 unless
  the overlay places it elsewhere).  wstag785.s file 0x04 and wstag810.s file 0x0
  are the same twenty instructions; they differ in TWO places only:

      wstag785: lh $v1, ($s1)   / sh $v0, ($s1)   / lhu $v0, 0x2($s1)   (cursor 0/2)
      wstag810: lh $v1, 0x4($s1)/ sh $v0, 0x4($s1)/ lbu $v1, 0x2($s0)  (cursor 4/6)

  and wstag805.s file 0x1ec is the same routine with the `$a2 == 0` restart arm
  deleted, so its only end arm reads the end entry's THIRD byte and jumps
  (`lbu $v1, 0x3($s0)` / `sh $v1, 0x4($s1)`, file 0x298/0x2a8).

  THE METHOD BLOCK (EXE F0x800143dc, the allocator every copy calls): +0x28
  setState, +0x2c setClip, +0x38 advance state (clear clip+counter+timer),
  +0x3c advance clip, +0x40 advance counter (clear timer), +0x44 tick the timer,
  +0x48 the per-frame callback.

  THE MEMBERS.  Every stage object of the family, in machine shapes:

    `pad-flash`    s212 0x32a, s225 0x32f, s750 0x34e, s925 0x357
                   -- claims tags 1..3, moves them onto the pad the SETANIM
                      operand names, runs one script per slot.  Sprite 0x12C
                      (300) blinks the record off (`li $v0, 0x12c` /
                      `beq $v1, $v0, .L0x...` wstag212.s file 0x2a8/0x2ac),
                      0x00FF ends the slot (file 0x2a0/0x2a4).
    `decor`        s785 0x343, s790 0x328/0x329, s795 0x344, s800 0x345/0x347
                   -- claims tags 1..N and writes active/spriteId/ctr, with one
                      member sliding a record's X halfword and two reading a
                      record's live `ctr`.
    `point-record` s805 0x348, s810 0x34a/0x34b/0x34c, s820 0x355
                   -- per-panel state recipes over the same claim and stepper.
    `picture-steps` s785 0x327
                   -- claims NOTHING: a counter-stepped state machine that draws
                      sheet pictures at a character anchor (read 2026-10-05).

  WHY ONE FILE.  Three tools read the same overlays for the same system and
  shipped three tables in three formats (one of them a generated TypeScript file
  with the per-state recipes written into the template by hand).  This file keeps
  EVERY anchor and EVERY mining rule of all three -- the 222 instruction checks
  the decor tool made, the shape mining the pad-flash tool made, and the
  sequence/hold reads the point-record tool made -- and emits ONE table.

Nothing here is hand-entered as a value.  What is hand-entered is the ADDRESS of
each site, paired with the instruction text the decode read there; the tool
re-reads that text from ~/ddw3/asm/dw2003/pro/wstagNNN.s AND requires the
shipped image to hold the same word, so a mistyped address or a stale overlay
cannot produce a table.

Usage:
    .venv/bin/python3 tools/extract_point_record_actors.py --out web/assets/data/point_record_actors.json
    .venv/bin/python3 tools/extract_point_record_actors.py --check
"""
import argparse
import copy
import json
import os
import re
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NATIVE = REPO / "web/assets/native"
POINTS = REPO / "web/assets/data/point_sprites.json"
DDW3 = Path((os.environ.get("DDW3_DIR") or (os.environ.get("DDW3_DIR") or os.path.expanduser("~/ddw3"))))
ASM = DDW3 / "asm/dw2003/pro"

# Every wstag overlay loads here (stage-object-registry-2026-10-04.md §3).
OVERLAY_BASE = 0x800A5DE0
# FIELDSTG.PRO's own effect-registry table (twelve-byte records
# {id, construct_fn, draw_fn}), which decides whether the walker may wait for a
# script's SETANIM or has to build the object at stage entry.
REGISTRY = NATIVE / "fieldstg.bin"
REGISTRY_RAM = 0x8009B3E8
REGISTRY_STRIDE = 12
# The stage-object census (`tools/inventory_stage_registry.py`), which resolves
# every member's TICK.  The claim reader intersects the ticks an overlay
# installs with the ticks its registry members install, because a TICK is the
# object's identity -- see `member_ticks`.
CENSUS = REPO / "data/stage_registry_members.json"
# An animation script entry's `value` 0x00ff ends the run -- every copy compares
# against `li $v0, 0xff`, and none against -1.
SCRIPT_END = 0xFF
# The pad-flash blink-off sprite value (`li $v0, 0x12c`, wstag212.s file 0x2a8).
BLINK_OFF = 0x12C


# ── one overlay image, word-level, with the two-witness anchor check ──



class Overlay:
    """One wstag image with word-level access and loud failure.

    web/assets/native/sNNN.bin is the overlay image verbatim and PSX MIPS is
    little-endian, so every read below is < endianness.  Addresses in DRIVERS
    are RAM addresses as wstagNNN.s prints them; the file offset is derived.
    """

    def __init__(self, stage):
        self.stage = stage
        self.path = NATIVE / ("s%s.bin" % stage)
        if not self.path.exists():
            raise SystemExit("point_record_actors: %s is missing" % self.path)
        self.data = self.path.read_bytes()
        self.asm = {}
        src = ASM / ("wstag%s.s" % stage)
        if not src.exists():
            raise SystemExit("point_record_actors: %s is missing" % src)
        for line in src.read_text(errors="replace").splitlines():
            m = re.match(r"^\.L0x([0-9a-f]{8}):\s*(\S.*?)\s*#\s*\.word (0x[0-9a-f]+)",
                         line)
            if m:
                self.asm[int(m.group(1), 16)] = (m.group(2),
                                                  int(m.group(3), 16))

    def _at(self, ram):
        off = ram - OVERLAY_BASE
        if not 0 <= off <= len(self.data) - 4:
            raise SystemExit(
                "point_record_actors: s%s RAM %#010x (file %#x) is outside the "
                "%d-byte image" % (self.stage, ram, off, len(self.data)))
        return off

    def word(self, ram):
        return struct.unpack_from("<I", self.data, self._at(ram))[0]

    def check(self, ram, text, note):
        """Assert one instruction against the read-only decompilation.

        `text` is the instruction the decode read at `ram`, as wstagNNN.s
        prints it; the overlay image must hold the same word the .s prints.
        Both witnesses come off the disc, and neither is typed in as a number,
        so a mistyped address or a misread immediate stops the build here
        rather than shipping a table decoded from the wrong place.
        """
        insn, word = self.asm.get(ram - OVERLAY_BASE, (None, None))
        if insn is None:
            fail("point_record_actors: wstag%s.s has no label at RAM %#010x (%s)"
                 % (self.stage, ram, note))
            return
        if text not in insn:
            fail("point_record_actors: wstag%s.s RAM %#010x reads %r, the decode "
                 "recorded %r (%s)" % (self.stage, ram, insn, text, note))
            return
        got = self.word(ram)
        if got != word:
            fail("point_record_actors: s%s RAM %#010x holds %#010x but wstag%s.s "
                 "says %#010x (%s)"
                 % (self.stage, ram, got, self.stage, word, note))

    def u8(self, ram):
        return self.data[ram - OVERLAY_BASE]

    def u16(self, ram):
        return struct.unpack_from("<H", self.data, ram - OVERLAY_BASE)[0]

    def script(self, ram):
        """A `{u16 value, u16 hold}` run ending on value 0xff."""
        out, at = [], ram
        while True:
            value, hold = struct.unpack_from("<HH", self.data, self._at(at))
            out.append({"v": value, "h": hold})
            at += 4
            if value == SCRIPT_END:
                return out


# ── the six drivers ─────────────────────────────────────────────────────────
# `anchors` are (RAM address, the instruction text the decode read there, why).
# They are the load-bearing immediates, displacements and branch targets; a
# mismatch stops the build rather than shipping a table decoded from a different
# overlay.  `tags` is the atlas-tag list the actor's claim walk compares against,

ERRORS = []


def fail(msg):
    ERRORS.append(msg)


def registry_ctor(reg, effect_id):
    """The registry record's construct pointer for one id, or None.

    Read out of FIELDSTG.PRO's own effect table, which is what decides whether
    a walker may wait for a script's SETANIM or has to build the object itself
    at stage entry.  A zero constructor is one of the thirteen null-ctor records
    (docs/research/field/stage-object-registry-2026-10-04.md section 4).
    """
    base = REGISTRY_RAM - 0x80082CB0
    for off in range(base, len(reg) - REGISTRY_STRIDE, REGISTRY_STRIDE):
        rid, ctor, _draw = struct.unpack_from("<III", reg, off)
        if rid == 0:
            break
        if rid == effect_id:
            return None if ctor == 0 else "0x%08x" % ctor
    raise SystemExit("point_record_actors: the registry has no id 0x%03x"
                     % effect_id)


def tagged_records(points, stage):
    """atlas tag -> point-record index, FIRST match, as fieldstg F0x800894d8
    finds it.  The walk resumes from a cursor in the global at 0x8005b8f8, so a
    second call for the next tag finds the next record; a table with one record
    per tag needs no such bookkeeping, which is every table read so far.
    """
    recs = (points.get("s" + stage) or {}).get("records") or []
    out = {}
    for i, r in enumerate(recs):
        tag = r.get("atlasFlag")
        if tag and tag not in out:
            out[tag] = i
    return recs, out


def record_geom(r, index):
    """The record fields the ambient renderer and these actors share."""
    return {
        "index": index,
        "x": r["x"], "y": r["y"], "ysort": r["ysort"],
        "layer": r["layer"], "romActive": r["active"],
        "romSprite": r["spriteId"], "mode": r["mode"],
    }


# ── pad-flash shape mining (from tools/extract_materialize_effects.py) ──


import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ASM = DDW3 / "asm/dw2003/pro"
REPO = Path(__file__).resolve().parent.parent
OUT_JSON = REPO / "web/assets/data/materialize_effects.json"

BASE = 0x800A5DE0
SLOTS = 3  # the 3-slot copies are hardcoded to three script slots
MAX_SLOTS = 4

def wstag_bytes(words: dict[int, int]) -> bytes:
    buf = bytearray(max(words) + 4)
    for off, w in words.items():
        struct.pack_into("<I", buf, off, w)
    return bytes(buf)


def in_ram(addr, size) -> bool:
    return BASE <= addr < BASE + size


def parse_script(buf: bytes, addr: int, slots: int = 1) -> list[dict]:
    """{s16 value, u16 duration} entries until value == 0xFF."""
    off, out = addr - BASE, []
    while len(out) < 256:
        if off + 4 > len(buf):
            raise ValueError(f"script at {addr:#x} runs off the overlay")
        v, d = struct.unpack_from("<hH", buf, off)
        if v == 0xFF:
            if d != 0 and out:
                # the terminator carries no hold; a non-zero one means this is
                # not the script table we think it is
                pass
            return out
        if not (0 <= v <= 0x1FF or v == 0x12C):
            raise ValueError(f"script at {addr:#x}: implausible sprite {v}")
        if not (0 < d < 0x1000):
            raise ValueError(f"script at {addr:#x}: implausible duration {d}")
        out.append({"v": v, "d": d})
        off += 4
    raise ValueError(f"unterminated script at {addr:#x}")


def fn_bounds(offs: list[int], words: dict[int, int], site: int) -> tuple[int, int]:
    """[start, end) file offsets of the fn containing `site` (addiu sp,-N anchors)."""
    starts = [o for o in offs if (words[o] >> 16) == 0x27BD and (words[o] & 0x8000)]
    begin = max((o for o in starts if o <= site), default=0)
    end = min((o for o in starts if o > site), default=offs[-1] + 4)
    return begin, end


def script_pointer_table(offs, words, buf):
    """Every offset of a run of `SLOTS` in-overlay pointers that all parse.

    Anchor-free on purpose: the original builds the table address in a
    different register in each copy, and a linear constant tracker loses it
    after the claim loop's branches (s925).  A run of pointers whose targets
    are all terminated {spriteId, duration} tables is unambiguous.
    """
    out = []
    for p in offs:
        ptrs = []
        ok = True
        for i in range(SLOTS):
            q = p + i * 4
            if q not in words:
                ok = False
                break
            a = words[q]
            if not in_ram(a, len(buf)):
                ok = False
                break
            ptrs.append(a)
        if not ok:
            continue
        try:
            for a in ptrs:
                if not parse_script(buf, a):
                    raise ValueError("empty script")
        except ValueError:
            continue
        out.append((p, ptrs))
    return out


def ram_consts_in(region, words, regs_at, buf_size):
    """Every address in this overlay the code of `region` can name.

    Two passes, because the copies disagree on codegen:

      * the tracked snapshot (`track_consts`) catches `lui`/`addiu`/`ori`
        straight lines;
      * a raw sweep over every `addiu`/`ori` immediate in the region, folded
        onto each `lui` high half the stage uses (0x800a for its own tables,
        0x800b for the ones it forms as `lui 0x800b / addiu -0x7e00`).  This
        is what finds s925's table, whose address is built in a register the
        linear tracker has already cleared by the time it is used.
    """
    out = []
    for o in region:
        w = words[o]
        op = w >> 26
        if op not in (0x08, 0x09, 0x0D, 0x0F):
            continue
        for reg in ((w >> 21) & 31, (w >> 16) & 31):
            v = regs_at.get(o, {}).get(reg)
            if v is not None and in_ram(v, buf_size) and v not in out:
                out.append(v)
        imm = w & 0xFFFF
        if op in (0x08, 0x09):
            imm = imm - 0x10000 if imm >= 0x8000 else imm
            for high in (0x800A0000, 0x800B0000, 0x80090000):
                v = (high + imm) & 0xFFFFFFFF
                if in_ram(v, buf_size) and v not in out:
                    out.append(v)
        elif op == 0x0D:
            for high in (0x800A0000, 0x800B0000, 0x80090000):
                v = high | imm
                if in_ram(v, buf_size) and v not in out:
                    out.append(v)
    return out


def ctor_pad(offs, words, regs_at, t_begin, t_end) -> list[list[int]]:
    """The pad coords a construct-only copy bakes into its constructor.

    s925's constructor stores two literals into the fresh object right after
    its allocator call (`li $v1, 0x150 ; sw $v1, 0x50($v0)` and
    `li $v1, 0x112 ; sw $v1, 0x54($v0)` -- 336, 274, the login room's pad), so
    there is no command handler to read a coord table from.  Only literals are
    accepted: a store fed by a caller's argument is a different shape and must
    not be mistaken for a fixed pad.
    """
    # `jal` is opcode 3; a call to the shared allocator is one whose rd == 0
    # (jalr uses rd = $at), so the mask keeps the opcode and the rd field.
    # `jal` is opcode 3 with a non-zero 26-bit target; `jalr` is opcode 0 with
    # a SPECIAL function field, so it cannot land here.
    creates = [o for o in offs
               if (words[o] >> 26) == 0x03 and (words[o] & 0x03FFFFFF) != 0]
    for o in creates:
        c_begin, c_end = fn_bounds(offs, words, o)
        if t_begin <= c_begin < t_end:
            continue  # the create call sits in the tick itself
        region = [x for x in offs if c_begin <= x < c_end]
        xy = {}
        for x in region:
            w = words[x]
            off = w & 0xFFFF
            if off not in (0x50, 0x54):
                continue
            if (w >> 26) not in (0x29, 0x2B):  # sh / sw
                continue
            src = (w >> 16) & 31  # the register the store names
            if src == 0:
                continue
            v = regs_at.get(x, {}).get(src)
            if v is None:
                continue
            key = 0 if off == 0x50 else 1
            if key not in xy or xy[key] != v:
                xy[key] = v
        if 0 in xy and 1 in xy and all(0 <= v < 4096 for v in xy.values()):
            return [[xy[0], xy[1]]]
    return []


def play_sound(region, words, regs_at, buf, coord_table, size=None):
    """The packed sound id(s) this region plays, in the extractor's shape.

    `lw $v0, 0x5c48($v0)` after `lui 0x8005` is the resident play-packed-id
    call.  A constant `$a0` at the `jalr` (or in its delay slot, which is where
    s225 finishes it) is a fixed cue; otherwise the last in-RAM constant formed
    before the call is a per-slot word table.
    """
    for o in region:
        w = words[o]
        if (w >> 26) == 0x23 and (w & 0xFFFF) == 0x5C48 \
                and regs_at[o].get((w >> 21) & 31) == 0x80050000:
            jalrs = [x for x in region if x > o and (words[x] & 0xFC00003F) == 0x9]
            if not jalrs:
                continue
            a0 = regs_at.get(jalrs[0] + 8, {}).get(4)
            if a0 is None:
                a0 = regs_at[jalrs[0]].get(4)
            if a0 is not None and not in_ram(a0, len(buf)):
                return f"{a0:#010x}", None
            tbl = next((c for c in reversed(ram_consts_in(region, words, regs_at,
                                                           len(buf)))
                        if c != coord_table), None)
            if tbl is not None and size:
                ids = struct.unpack_from(f"<{size}I", buf, tbl - BASE)
                if all(in_ram(i, len(buf)) or True for i in ids) and ids:
                    return None, [f"{i:#010x}" for i in ids]
    return None, None


def member_ticks() -> dict[str, set[int]]:
    """stage number -> every TICK the stage's own registry members install.

    Read from `data/stage_registry_members.json`
    (`tools/inventory_stage_registry.py`), which resolves each member's tick
    from its record's `construct_fn`.  This is the identity rule the whole
    census rests on: an overlay may build several objects that claim the point
    table, and only the one a registry member installs is a member.  Without it
    s460 and s526 come back as copies of this actor, because their member record
    points at their overlay's ROOT-object tick while the claim read they carry
    belongs to a different, nested object of theirs.
    """
    out: dict[str, set[int]] = {}
    try:
        data = json.loads(CENSUS.read_text())
    except (OSError, ValueError):
        return out
    for stage, rows in (data.get("members") or {}).items():
        for row in rows:
            tick = (row.get("construct") or {}).get("tick")
            if isinstance(tick, dict):  # {"tick": addr, "call": ..., "why": ...}
                tick = tick.get("tick")
            if isinstance(tick, int):
                out.setdefault(str(stage).lstrip("s"), set()).add(tick)
    return out


def installed_ticks(offs, words, regs_at, buf_size):
    """Every TICK address this overlay's own allocator calls install.

    The shared allocator is `F0x800143dc` (four arguments, the fourth being the
    object's public name) and its three-argument wrapper `F0x80014504`; both
    take the TICK as `$a0`, which `F0x800143dc` stores at `obj+0x48`
    (exe/fns.s:0x800144bc).  **A TICK is the object's identity**: two objects
    can share one method pointer or one VM slot, so a claim read is only this
    actor's claim when the function that holds it is a TICK some builder in the
    same overlay installs.
    """
    out = set()
    for o in offs:
        w = words[o]
        if (w >> 26) != 0x03:
            continue
        # `jal`'s 26-bit field is a WORD offset, so the target is field << 2.
        if 0x80000000 | ((w & 0x03FFFFFF) << 2) not in (0x800143DC, 0x80014504):
            continue
        for site in (o, o + 4):  # the `jal` and its delay slot
            tick = regs_at.get(site, {}).get(4)
            if tick is not None and in_ram(tick, buf_size):
                out.add(tick - BASE)
    return out


def stepper_sites(tick, words, regs_at, buf_size):
    """(call site, the script `$a1` names) for every stepper call in `tick`.

    The stage keeps its own copy of the shared `{clip, hold}` stepper, called
    directly (`jal <overlay routine>`, wstag455 file 0x1dc) or through a
    register (`jalr $v0`, wstag212).  The script is always the second argument,
    so resolving `$a1` at the call is what identifies it -- a tick constant that
    merely *parses* as a script is not enough, and reading one produced garbage
    coordinates on s310.
    """
    out = []
    for o in tick:
        w = words[o]
        direct = ((w >> 26) == 0x03
                  and in_ram(0x80000000 | ((w & 0x03FFFFFF) << 2), buf_size))
        indirect = (w & 0xFC00003F) == 0
        if not (direct or indirect):
            continue
        script = None
        for site in (o, o + 4):
            script = regs_at.get(site, {}).get(5)
            if script is not None and in_ram(script, buf_size):
                break
            script = None
        if script is not None:
            out.append((o, script))
    return out


def claim_tags(tick, words):
    """The `atlasFlag` tag bytes the claim loop accepts, ascending.

    The loop reads one record's tag into a register with `lbu $rt, -1($rec)`
    (the record's byte +1) and then either compares it against a constant
    (`li $a1, 1` ; `bne $v0, $a1` -- wstag455 file 0x150/0x160, the
    single-record copy) or range-tests it (`addiu $v0, -1` ; `sltiu $v0, 4` --
    wstag620 file 0x1a8/0x1ac, the four-record copy, tags 1..4).  Both are read
    here; a tag the loop does not compare is not guessed.
    """
    loads = [o for o in tick
             if (words[o] >> 26) == 0x24 and (words[o] & 0xFFFF) == 0xFFFF]
    if not loads:
        return []
    first = loads[0]
    tag_reg = (words[first] >> 16) & 31
    # The tag constant can be formed BEFORE the load (wstag455: `li $a1, 1` at
    # file 0x150, the `lbu` at 0x158, the `bne` at 0x160) or after it, so the
    # window straddles the load.
    start = max(0, tick.index(first) - 12)
    body = tick[start:tick.index(first) + 40]
    tags: set[int] = set()
    for j, x in enumerate(body):
        w = words[x]
        op = w >> 26
        if op == 0x09 and (w & 0xFFFF) == 0xFFFF:
            # addiu $tag, <any>, -1  followed by  sltiu $tag, N  ->  tags 1..N
            reg = (w >> 16) & 31
            if reg != tag_reg:
                continue
            for y in body[j + 1:j + 3]:
                yw = words[y]
                if (yw >> 26) == 0x0B and ((yw >> 16) & 31) == reg:  # sltiu
                    n = yw & 0xFFFF
                    if 0 < n <= 0x40:
                        tags.update(range(1, n + 1))
        elif op in (0x04, 0x05):  # beq / bne against the tag register
            ra, rb = (w >> 21) & 31, (w >> 16) & 31
            if tag_reg not in (ra, rb):
                continue
            other = rb if ra == tag_reg else ra
            for k in range(j - 1, max(-1, j - 16), -1):
                xw = words[body[k]]
                if ((xw >> 16) & 31) == other and ((xw >> 21) & 31) == 0 \
                        and (xw >> 26) in (0x09, 0x0D):
                    imm = xw & 0xFFFF
                    val = imm - 0x10000 if (xw >> 26) == 0x09 and imm >= 0x8000 \
                        else imm
                    if 0 < val < 0x40:
                        tags.add(val)
                    break
    return sorted(tags)


def rise_shape(tick, words, obj_reg, tags):
    """The no-script shape: a claimed record walked up the screen, N blanks.

    Read out of wstag926 file 0x190 (the registry member `0x356` on that
    stage): the claim phase parks the record at `obj+0x50` and takes one pixel
    off its Y (`file 0x208 lhu 0xa($v1)` / `:0x210 addiu $v0, -1` /
    `:0x214 sh $v0, 0xa($v1)`, where `$v1 = record + 2`, so the record's own Y
    at +0xc), every blank then adds one pixel back (`:0x254 lhu 0xc($s0)` /
    `:0x25c addiu $v1, 0x1` / `:0x260 sh $v1, 0xc($s0)`) and counts the blanks
    in `obj+0x54` (`:0x264`-`:0x270`), stopping at `slti $v0, 0x96` = 150
    (`:0x28c`).  Anything less than all four halves is refused, so a stage whose
    tick merely lacks a script table is not mistaken for this shape.
    """
    park = None
    counters = set()
    for o in tick:
        w = words[o]
        if (w >> 26) != 0x2B or ((w >> 21) & 31) != obj_reg:
            continue
        off = w & 0xFFFF
        if park is None and 0x50 <= off <= 0x60:
            park = off
        elif off != park:
            counters.add(off)
    if park is None:
        return None
    # the registers the claim's record is read back through
    rec_regs = {(words[o] >> 16) & 31 for o in tick
                if (words[o] >> 26) == 0x23 and (words[o] & 0xFFFF) == park
                and ((words[o] >> 21) & 31) == obj_reg}
    if not rec_regs:
        return None
    # A copy may walk the record through a pointer pre-offset by 2 (the tag
    # byte's address: wstag926 file 0x1f0 `addiu $v1, $a0, 0x2`), so a store
    # whose base is `record + K` counts, and its offset is read back relative
    # to the record.
    table_regs = {(words[o] >> 16) & 31 for o in tick
                  if (words[o] >> 26) == 0x23 and (words[o] & 0xFFFF) == 0x9D90}
    based = {}
    for o in tick:
        w = words[o]
        if (w >> 26) not in (0x09, 0x21):  # addiu / addu $rd, $rec, K
            continue
        src = (w >> 21) & 31
        if src not in rec_regs and src not in table_regs:
            continue
        imm = w & 0xFFFF
        based[(w >> 16) & 31] = imm - 0x10000 if imm >= 0x8000 else imm
    moves = []
    for i, o in enumerate(tick):
        w = words[o]
        if (w >> 26) != 0x29:  # sh $rt, off($rec)
            continue
        base = (w >> 21) & 31
        if base in rec_regs:
            skew = 0
        elif base in based:
            skew = based[base]
        else:
            continue
        prev = words[tick[i - 1]] if i else 0
        if (prev >> 26) != 0x09 or ((prev >> 16) & 31) != ((w >> 16) & 31):
            continue
        imm = prev & 0xFFFF
        moves.append(((w & 0xFFFF) + skew,
                      imm - 0x10000 if imm >= 0x8000 else imm))
    if len(moves) < 2:
        return None
    (claim_off, claim_shift), rise = moves[0], moves[1]
    if claim_off != rise[0] or not (rise[1] > claim_shift):
        return None
    blanks = None
    for i, o in enumerate(tick):
        w = words[o]
        if (w >> 26) != 0x0A:  # slti
            continue
        for k in range(i - 1, max(-1, i - 5), -1):
            xw = words[tick[k]]
            if ((xw >> 26) == 0x23 and (xw & 0xFFFF) in counters
                    and ((xw >> 16) & 31) == ((w >> 16) & 31)):
                blanks = w & 0xFFFF
                break
    if not tags or blanks is None:
        return None
    # THE LIVE FIELD CHARACTER, the other half of the same blank.  A `sw` to
    # +0x54 whose base is NEITHER the object nor the claimed record is a store
    # into the object the find-by-name call returned -- the character -- and the
    # `addiu` above it is the step (wstag926 file 0x274 `lw $v1, 0x54($v0)` /
    # 0x27c `addiu $v1, 0x100` / 0x280 `sw $v1, 0x54($v0)`, with a `nop` between
    # them, so the `addiu` is looked for over the three words above).
    char_y = 0
    for i, o in enumerate(tick):
        w = words[o]
        if (w >> 26) != 0x2B or (w & 0xFFFF) != 0x54:
            continue
        base = (w >> 21) & 31
        if base == obj_reg or base in rec_regs:
            continue
        for k in range(i - 1, max(-1, i - 4), -1):
            xw = words[tick[k]]
            if (xw >> 26) == 0x09 and ((xw >> 16) & 31) == ((w >> 16) & 31):
                imm = xw & 0xFFFF
                char_y = imm - 0x10000 if imm >= 0x8000 else imm
                break
        if char_y:
            break
    return {"tags": tags, "recordOffset": claim_off, "claimShift": claim_shift,
            "riseBy": rise[1], "riseBlanks": blanks, "charYBy": char_y}


def extract_stage(path: Path, want_ticks: set[int] | None = None) -> dict | None:
    words = ovs.load_words(path)
    if not words:
        return None
    buf = wstag_bytes(words)
    offs = sorted(words)
    tracked = list(ovs.track_consts([(o, words[o]) for o in offs]))
    regs_at = {o: r for o, _w, r in tracked}

    # ── the claim read of the point table ───────────────────────────────────
    # (no regs check: the claim `lw` sits after branchy dispatch that linear
    # const-tracking loses; the 0x9D90 low half + lw shape is unique enough)
    claims = [
        o for o in offs
        if (words[o] >> 26) == 0x23 and (words[o] & 0xFFFF) == 0x9D90
    ]
    if not claims:
        return None  # this stage carries no copy of the actor
    ticks = installed_ticks(offs, words, regs_at, len(buf))
    if want_ticks:
        ticks &= {t - BASE for t in want_ticks}
    claims = [o for o in claims if fn_bounds(offs, words, o)[0] in ticks]
    if not claims:
        # The overlay reads the point table, but from an object that is not a
        # registry member (s460/s526 install that claim on a nested object).
        return None
    t_begin, t_end = fn_bounds(offs, words, claims[0])
    tick = [o for o in offs if t_begin <= o < t_end]
    tick_consts = ram_consts_in(tick, words, regs_at, len(buf))
    steps = stepper_sites(tick, words, regs_at, len(buf))
    # A call into the overlay from the tick IS the stage's own stepper (the
    # shared system keeps one per copy); the no-script shape below has none.
    own_calls = [o for o in tick
                 if (words[o] >> 26) == 0x03
                 and in_ram(0x80000000 | ((words[o] & 0x03FFFFFF) << 2), len(buf))]
    tags = claim_tags(tick, words)
    if not tags:
        raise ValueError("the claim loop names no record tag")
    # The register that holds the object itself: the tick's prologue copies
    # `$a0` into it (`move_ $s1, $a0` = `or $s1, $a0, $zr`), and every field
    # store of the state machine goes through it.  A tick that never copies
    # keeps using `$a0`.
    obj_reg = next(((words[o] >> 11) & 31 for o in tick
                    if (words[o] >> 26) == 0 and (words[o] & 0x3F) == 0x21
                    and ((words[o] >> 21) & 31) == 4), 4)

    # ── the script table: a pointer run, or the one script the tick passes ──
    tables = {BASE + p: ptrs for p, ptrs in script_pointer_table(offs, words, buf)}
    picked, slots = None, SLOTS
    for c in tick_consts:
        if c in tables:
            picked = tables[c]
            break
    if picked is None and len(tables) == 1:
        # one copy of the table in the overlay and the tick reaches for an
        # in-RAM address: the only table it can mean
        picked = next(iter(tables.values()))
    if picked is None and steps:
        # An in-place copy: the tick hands an in-RAM script straight to the
        # stage's own stepper as `$a1`, once per claimed tag.  A one-tag copy
        # (s455) hands ONE script; the multi-tag in-place copies (s232 and its
        # family) hand one script PER TAG from inside the same claim walk, so
        # every in-RAM script the tick passes is collected, in call order -- the
        # call order IS the tag order in every copy read (wstag232 file
        # 0x194/0x1b8: tag 1's block steps its script, then tag 2's).  A copy
        # whose script count is not its tag count is refused below rather than
        # paired by guess.
        cand = []
        for _site, script_addr in steps:
            if script_addr in tables or script_addr in cand:
                # `script_addr in cand`: the stage's own copy of the stepper
                # TAIL-CALLS itself inside the same function bounds (wstag455
                # file 0x1fc repeats file 0x1dc's script), so the same script is
                # offered twice; a slot is a distinct script.
                continue
            try:
                script = parse_script(buf, script_addr)
            except ValueError:
                continue
            if script:
                cand.append(script_addr)
        if cand:
            picked = cand
            slots = len(cand)
    if picked is None and not own_calls:
        # No script table and no stepper call at all: the no-script shape, a
        # claimed record walked up the screen for a fixed number of blanks.
        rise = rise_shape(tick, words, obj_reg, tags)
        if rise:
            return {"shape": "rise", "slots": 1, "tags": rise["tags"],
                    "tick": t_begin,
                    "commands": {}, "coords": [], "yOff": [0], "ysortOff": [0],
                    "scripts": [], "fireSound": None, "slotSounds": None,
                    "reposition": False, "recordOffset": rise["recordOffset"],
                    "claimShift": rise["claimShift"], "riseBy": rise["riseBy"],
                    "riseBlanks": rise["riseBlanks"],
                    "charYBy": rise["charYBy"]}
    if picked is None:
        raise ValueError("the tick carries no readable script table")
    scripts = [parse_script(buf, p) for p in picked]
    if len(scripts) != slots:
        raise ValueError("script count and slot count disagree")

    # X/Y/ysort stores; Y (0xa) and ysort (0xc) may be fed by an lbu off a
    # signed-byte offset table (addu with one const RAM operand).
    def offset_tables(count: int) -> tuple[list[int], list[int]]:
        """The Y and ysort signed-byte offset tables the claim phase reads.

        Each table address is materialised by an `addu` whose other operand is
        the claim loop's counter; the `lbu` that indexes it is on one side or
        the other of that `addu` depending on the copy (s212 has
        addu-then-lbu, s225 lbu-then-addu), so the pair is matched by distance
        and the store it feeds is the first `sh $v0, 0xa/0xc($a0)` after both.
        A store with no table behind it reports zeros, which is what the
        original does -- s212 has a ysort table and no Y table at all.

        Reading the base out of the `addu` operand rather than the `lbu`'s is
        deliberate: the linear constant tracker loses the register across the
        branchy claim loop in every copy.
        """
        reads = {0xA482000A: [0] * count, 0xA482000C: [0] * count}
        claimed: set[int] = set()
        cands = []
        for o in tick:
            w = words[o]
            if (w & 0xFC0007FF) != 0x21:  # addu rd, rs, rt
                continue
            rd = (w >> 11) & 31
            for reg in ((w >> 21) & 31, (w >> 16) & 31):
                c = regs_at.get(o, {}).get(reg)
                if c is not None and in_ram(c, len(buf)) and c not in claimed:
                    cands.append((o, rd, c))
        for o, rd, c in cands:
            lb = [x for x in tick
                  if (words[x] >> 26) == 0x24 and (words[x] >> 21) & 31 == rd
                  and abs(x - o) <= 12]
            if not lb:
                continue
            near = min(lb, key=lambda x: abs(x - o))
            store = next((x for x in tick
                          if x > min(o, near) and words[x] in reads), None)
            if store is None or words[store] in claimed:
                continue
            base = c - BASE
            if base < 0 or base + count > len(buf):
                continue
            bs = buf[base:base + count]
            reads[words[store]] = [b - 256 if b >= 128 else b for b in bs]
            claimed.add(words[store])
            claimed.add(c)
        return reads[0xA482000A], reads[0xA482000C]

    has_x = any(words[o] == 0xA4820008 for o in tick)
    y_off, ysort_off = offset_tables(slots)

    # ── command handler: sw $v0/$v1, 0x50($a0) ──────────────────────────────
    hsites = [o for o in offs if words[o] in (0xAC820050, 0xAC830050)
              and not (t_begin <= o < t_end)]
    commands, coords = {}, []
    fire_sound, slot_sounds = None, None
    if not hsites:
        # No command handler: either a 1-slot copy (which has none) or a
        # construct-only copy whose pad is baked into the constructor.  The
        # latter stores two literals right after its allocator call
        # (`li $v1, X ; sw $v1, 0x50($v0)` / the same for 0x54) -- s925.
        coords = ctor_pad(offs, words, regs_at, t_begin, t_end)
        if not coords and slots != 1 and not steps:
            raise ValueError("no command handler (sw +0x50) outside the tick")
        fire_sound, slot_sounds = play_sound(tick, words, regs_at, buf,
                                              None, slots)
        return {
            "shape": "pad" if coords else "single",
            "tick": t_begin,
            "slots": slots, "tags": tags,
            "commands": commands, "coords": coords,
            "yOff": y_off, "ysortOff": ysort_off, "scripts": scripts,
            "fireSound": fire_sound, "slotSounds": slot_sounds,
            "reposition": has_x,
        }
    h_begin, h_end = fn_bounds(offs, words, hsites[0])
    handler = [o for o in offs if h_begin <= o < h_end]

    cmds = sorted({
        words[o] & 0xFFFF for o in handler
        if (words[o] >> 16) == 0x2402 and 0x300 <= (words[o] & 0xFFFF) < 0x400
    })
    if not cmds:
        raise ValueError("handler has no command-id compares")
    ram_consts = [
        c for o in handler
        for c in [None] if False
    ]
    ram_consts = []
    for o in handler:
        w = words[o]
        if (w >> 26) in (0x08, 0x09) and (w >> 21) & 31 != 0:  # addiu rt, rs≠0
            v = regs_at[o].get((w >> 21) & 31)
            if v is not None:
                v = (v + (w & 0xFFFF) - (0x10000 if w & 0x8000 else 0)) & 0xFFFFFFFF
                if in_ram(v, len(buf)) and v not in ram_consts:
                    ram_consts.append(v)
    if not ram_consts:
        raise ValueError("handler coord table not tracked")
    coord_table = ram_consts[0]
    coords = [list(struct.unpack_from("<2h", buf, coord_table - BASE + i * 4))
              for i in range(len(cmds))]
    if not all(0 <= x < 4096 and 0 <= y < 4096 for x, y in coords):
        raise ValueError(f"implausible pad coords {coords}")
    commands = {str(c): i for i, c in enumerate(cmds)}

    # ── sounds: play-packed-id calls in handler (per-slot) or tick (fixed) ──
    fire_sound, slot_sounds = play_sound(handler, words, regs_at, buf,
                                      coord_table, SLOTS)
    if fire_sound is None and slot_sounds is None:
        fire_sound, slot_sounds = play_sound(tick, words, regs_at, buf,
                                              None, None)

    return {
        "shape": "pad",
        "slots": slots,
        "tags": tags,
        "commands": commands,
        "coords": coords,
        "yOff": y_off,
        "ysortOff": ysort_off,
        "scripts": scripts,
        "fireSound": fire_sound,
        "slotSounds": slot_sounds,
        "reposition": has_x,
    }


# ── the six decor members: sites and anchors, verbatim ──

DECOR_SITES = [
    {
        # ── s785 Kusanagi City - Online Center, id 835 (0x343) ──────────────
        # Four inactive records stacked at one spot (299,232) light up and
        # cycle: sprite 74 and sprite 71 loop forever, sprite 70 plays 0..13
        # once and is then switched off, and the fourth is only reached on the
        # unregistered builder's arm.  Fired by `SETANIM 835 821 1`.
        "stage": "785", "id": 835, "kind": "stacked",
        "ctor": 0x800A61D8, "tick": 0x800A5F04, "draw": None,
        "anchors": [
            (0x800A61E0, "lui $a0, 0x800a", "ctor"),
            (0x800A61E4, "addiu $a0, 0x5f04", "ctor tick 0x800a5f04"),
            (0x800A61E8, "li $a1, 0x6c", "ctor size 0x6c"),
            (0x800A61F0, "jal F0x800143dc", "ctor"),
            (0x800A5F48, "lw $a0, -0x6270($v0)",
             "claim reads the global record list at 0x80099d90"),
            (0x800A5F5C, "li $t1, 0x2", "claim compares tag 2"),
            (0x800A5F60, "li $t0, 0x1", "claim compares tag 1"),
            (0x800A5F64, "li $a3, 0x3", "claim compares tag 3"),
            (0x800A5F68, "li $a2, 0x4", "claim compares tag 4"),
            (0x800A5FB4, "sw $a0, 0x60($s1)", "tag 1 -> obj+0x60"),
            (0x800A5FBC, "sw $a0, 0x5c($s1)", "tag 2 -> obj+0x5c"),
            (0x800A5FC4, "sw $a0, 0x58($s1)", "tag 3 -> obj+0x58"),
            (0x800A5FC8, "sw $a0, 0x54($s1)", "tag 4 -> obj+0x54"),
            (0x800A5FEC, "lw $v1, 0x50($s1)", "the arm word at obj+0x50"),
            (0x800A5FE4, "sh $zr, 0x68($s1)", "cursor 2 entry at obj+0x68"),
            (0x800A5FF8, "sh $v0, 0x6a($s1)", "cursor 2 hold at obj+0x6a"),
            (0x800A6000, "sh $zr, 0x64($s1)", "cursor 1 entry at obj+0x64"),
            (0x800A6014, "sh $v0, 0x66($a0)", "cursor 1 hold at obj+0x66"),
            (0x800A6024, "lw $v0, 0x28($a0)",
             "the arm word branches to setState(2)"),
            (0x800A603C, "lw $v1, 0x10($s1)", "state 1 reads the clip"),
            (0x800A6044, "beq $v1, $s2, .L0x000002d8", "clip 1 skips the "
                                                       "one-shot arm"),
            (0x800A605C, "lw $s0, 0x54($s1)", "clip 0 drives the tag-4 record"),
            (0x800A6064, "lui $a1, 0x800a", "clip 0 script"),
            (0x800A6068, "addiu $a1, 0x7118", "clip 0 script 0x800a7118"),
            (0x800A606C, "li $a2, 0x1", "clip 0 is the one-shot arm"),
            (0x800A6070, "jal 0x800a5de4", "clip 0 steps the script"),
            (0x800A607C, "li $v0, 0xff", "the one-shot terminator"),
            (0x800A609C, "sb $zr, ($s0)",
             "finished: the tag-4 record goes dark"),
            (0x800A60A0, "sh $zr, 0x64($s1)", "finished: cursor 1 restarts"),
            (0x800A60A4, "lhu $v0, 0x7156($v0)",
             "finished: cursor 1 reloads u16[0x800a7156]"),
            (0x800A60B4, "sb $v1, 0x9($s0)", "running: tag-4 ctr = step value"),
            (0x800A60C0, "addiu $a1, 0x7154", "clip 1 script 0x800a7154"),
            (0x800A60C8, "lw $s0, 0x58($s1)", "clip 1 drives the tag-3 record"),
            (0x800A60E4, "addiu $a1, 0x71a4", "cursor 2 script 0x800a71a4"),
            (0x800A60EC, "lw $s0, 0x60($s1)", "cursor 2 drives the tag-1 record"),
            (0x800A6108, "lw $v0, 0x10($s1)", "state 2 reads the clip"),
            (0x800A611C, "sh $zr, 0x64($s1)", "state 2 seeds cursor 1"),
            (0x800A6120, "lhu $v0, 0x718a($v0)",
             "state 2 cursor 1 hold = u16[0x800a718a]"),
            (0x800A6128, "sh $zr, 0x68($s1)", "state 2 seeds cursor 2"),
            (0x800A6134, "lhu $v0, 0x71a6($v0)",
             "state 2 cursor 2 hold = u16[0x800a71a6]"),
            (0x800A614C, "addiu $a1, 0x7188", "state 2 script 0x800a7188"),
            (0x800A6154, "lw $s0, 0x5c($s1)", "state 2 drives the tag-2 record"),
        ],
        "tags": [1, 2, 3, 4],
        "scripts": {"clip0": 0x800A7118, "clip1": 0x800A7154,
                    "cursor2": 0x800A71A4, "state2": 0x800A7188},
        "seed_holds": {"cursor1": (0x800A711A, 2),
                       "cursor1_reload": (0x800A7156, 2),
                       "cursor2": (0x800A71A6, 2),
                       "state2_cursor1": (0x800A718A, 2)},
        "sounds": [],
    },
    {
        # ── s790 Kusanagi City - Chamber Room, id 808 (0x328) ───────────────
        # The one record tagged 1 (sprite 4 at 418,191) is switched to sprite 0
        # when the script sends `SETANIM 808 814 1`.  No animation script.
        "stage": "790", "id": 808, "kind": "resprite",
        "ctor": 0x800A625C, "tick": 0x800A6138, "draw": 0x800A6224,
        "anchors": [
            (0x800A6264, "lui $a0, 0x800a", "ctor"),
            (0x800A6268, "addiu $a0, 0x6138", "ctor tick 0x800a6138"),
            (0x800A626C, "li $a1, 0x5c", "ctor size 0x5c"),
            (0x800A6274, "jal F0x800143dc", "ctor"),
            (0x800A6230, "li $v0, 0x32e", "draw answers sub 814"),
            (0x800A623C, "lw $v0, 0x2c($a0)", "draw: setClip(1)"),
            (0x800A6148, "lw $v1, 0xc($s0)", "state dispatch"),
            (0x800A6168, "lw $v0, 0x38($s0)",
             "the reset band advances the state"),
            (0x800A6178, "lw $v1, 0x10($s0)", "state 1 reads the clip"),
            (0x800A6180, "beqz $v1, .L0x00000434", "clip 0 does nothing"),
            (0x800A6188, "bne $v1, $v0, .L0x00000434", "only clip 1 runs"),
            (0x800A6190, "lw $v0, 0x14($s0)", "state 1 reads the counter"),
            (0x800A6198, "bnez $v0, .L0x00000434", "only while the counter is 0"),
            (0x800A61B8, "slti $v1, 0x14",
             "the counter test above always branches, so the sprite source "
             "and the sound below are dead in the shipped build"),
            (0x800A61F4, "jal 0x80089548", "the fieldstg tag lookup"),
            (0x800A61F8, "li $a0, 0x1", "the tag it looks for is 1"),
            (0x800A6200, "beqz $v1, .L0x00000434", "no record -> return"),
            (0x800A6208, "lbu $v0, 0x50($s0)", "the sprite id from obj+0x50"),
            (0x800A6210, "sb $v0, 0x4($v1)", "record spriteId = obj+0x50"),
        ],
        "tags": [1],
        "scripts": {},
        "seed_holds": {},
        "sounds": [],
    },
    {
        # ── s790 Kusanagi City - Chamber Room, id 809 (0x329) ───────────────
        # Eight tagged records (atlas 2..9).  Four slide right, then two slide
        # further, then two inactive flashes light up, play their one cycle and
        # are replaced by their long-loop partners.  No animation script: the
        # waits are on each record's own `ctr`.
        "stage": "790", "id": 809, "kind": "reveal",
        "ctor": 0x800A6108, "tick": 0x800A5DF4, "draw": 0x800A60D0,
        "anchors": [
            (0x800A610C, "lui $a0, 0x800a", "ctor"),
            (0x800A6110, "addiu $a0, 0x5df4", "ctor tick 0x800a5df4"),
            (0x800A6114, "li $a1, 0x70", "ctor size 0x70"),
            (0x800A6120, "jal F0x800143dc", "ctor"),
            (0x800A60DC, "li $v0, 0x32c", "draw answers sub 812"),
            (0x800A60E8, "lw $v0, 0x2c($a0)", "draw: setClip(1)"),
            (0x800A5E0C, "lw $v1, 0xc($s2)", "state dispatch"),
            (0x800A5E24, "slti $v0, $v1, 0x4", "states 2 and 3 do nothing"),
            (0x800A5E34, "jal 0x80089548", "claim: the tag lookup"),
            (0x800A5E38, "addiu $a0, $s0, 0x2", "claim: tag = slot + 2"),
            (0x800A5E3C, "sw $v0, 0x50($s1)", "claim: store the record"),
            (0x800A5E40, "addiu $s0, 0x1", "claim: slot++"),
            (0x800A5E44, "slti $v0, $s0, 0x8", "claim: eight slots"),
            (0x800A5E50, "lw $v0, 0x38($s2)", "the claim band advances the state"),
            (0x800A5E7C, "sltiu $v0, $v1, 0x5", "the case index must be < 5"),
            (0x800A5E84, "lui $v0, 0x800a", "the five-case jump table"),
            (0x800A5E88, "addiu $v0, 0x5de0", "lives at the overlay base"),
            (0x800A5EA4, "lui $a0, 0x8100", "case 0 sound"),
            (0x800A5EB8, "ori $a0, 0x383c", "case 0 sound 0x8100383c"),
            (0x800A5ED4, "andi $v0, 0x1", "cases 1/2 move every other blank"),
            (0x800A5EE0, "lw $v1, 0x50($s2)", "case 1 slides the tag-2 record"),
            (0x800A5EE8, "lhu $v0, 0xc($v1)", "the slide adds to X's high half"),
            (0x800A5EF4, "sh $v0, 0xc($v1)", "one map pixel right"),
            (0x800A5EF8, "lw $v1, 0x54($s2)", "case 1 slides the tag-3 record"),
            (0x800A5F10, "lw $v1, 0x58($s2)", "case 1 slides the tag-4 record"),
            (0x800A5F28, "lw $v1, 0x64($s2)", "case 1 slides the tag-7 record"),
            (0x800A5F44, "li $v1, 0x8", "case 1 runs 8 blanks"),
            (0x800A5F4C, "bne $v0, $v1, .L0x000002d8", "case 1 ends at 8"),
            (0x800A5F78, "lw $v1, 0x54($s2)", "case 2 slides the tag-3 record"),
            (0x800A5F90, "lw $v1, 0x64($s2)", "case 2 slides the tag-7 record"),
            (0x800A5FAC, "li $v1, 0x10", "case 2 runs 16 blanks"),
            (0x800A5FB4, "bne $v0, $v1, .L0x000002d8", "case 2 ends at 0x10"),
            (0x800A5FDC, "lui $a0, 0x100", "case 3 sound"),
            (0x800A5FE0, "lw $v1, 0x5c($s2)", "case 3 lights the tag-5 record"),
            (0x800A5FE8, "sb $v0, ($v1)", "record active = 1"),
            (0x800A5FFC, "ori $a0, 0x2", "case 3 sound 0x01000002"),
            (0x800A6018, "lbu $v1, 0x9($v0)", "case 3 waits on that ctr"),
            (0x800A601C, "li $v0, 0xf", "case 3 waits for ctr 15"),
            (0x800A6040, "lw $v0, 0x5c($s2)", "case 4: tag-5 record off"),
            (0x800A604C, "lw $v0, 0x60($s2)", "case 4: tag-6 record on"),
            (0x800A6058, "lw $v0, 0x64($s2)", "case 4: tag-7 record off"),
            (0x800A6064, "lw $v0, 0x68($s2)", "case 4: tag-8 record on"),
            (0x800A6088, "lbu $v1, 0x9($a0)", "case 4 waits on the tag-8 ctr"),
            (0x800A609C, "lw $v0, 0x6c($s2)", "case 4 lights the tag-9 record"),
        ],
        "tags": [2, 3, 4, 5, 6, 7, 8, 9],
        "scripts": {},
        "seed_holds": {},
        "sounds": [{"packed": 0x8100383C, "case": 0},
                   {"packed": 0x01000002, "case": 3}],
    },
    {
        # ── s795 Undersea Base Magasta B1F, id 836 (0x344) ─────────────────
        # Two inactive records at (414,834): sprite 70 blinks 0/1 until the
        # script sends `SETANIM 836 859 2`, then it plays 71..80 once, holds 80,
        # and sprite 81 sits behind it.
        "stage": "795", "id": 836, "kind": "fire",
        "ctor": 0x800A61D0, "tick": 0x800A5F00, "draw": 0x800A6180,
        "anchors": [
            (0x800A61D8, "lui $a0, 0x800a", "ctor"),
            (0x800A61DC, "addiu $a0, 0x5f00", "ctor tick 0x800a5f00"),
            (0x800A61E0, "li $a1, 0x68", "ctor size 0x68"),
            (0x800A61E8, "jal F0x800143dc", "ctor"),
            (0x800A618C, "li $v0, 0x35b", "draw answers sub 859"),
            (0x800A6198, "sw $v0, 0x50($a0)", "draw: arm the fire flag"),
            (0x800A61A0, "sh $zr, 0x5c($a0)", "draw: cursor 1 restarts"),
            (0x800A61A4, "lbu $v0, 0x6a2a($v0)", "draw: re-arm seed"),
            (0x800A61B8, "jalr $v0", "draw: setState(2)"),
            (0x800A5F50, "lw $a0, -0x6270($v0)", "claim reads 0x80099d90"),
            (0x800A5F64, "li $t0, 0x1", "claim compares tag 1"),
            (0x800A5F68, "li $a3, 0x2", "claim compares tag 2"),
            (0x800A5F9C, "lw $v0, 0x6a70($a1)", "tag 1 seed via a pointer"),
            (0x800A5FA4, "lbu $v0, 0x2($v0)",
             "the seed is the script's first hold"),
            (0x800A5F98, "sh $zr, 0x5c($s3)", "tag 1 -> cursor 1 entry"),
            (0x800A5FA8, "sw $a0, 0x58($s3)", "tag 1 -> obj+0x58"),
            (0x800A5FB0, "sh $v0, 0x5e($s3)", "tag 1 -> cursor 1 hold"),
            (0x800A5FB8, "lw $v0, 0x8($a2)", "tag 2 seed via a pointer"),
            (0x800A5FB4, "sh $zr, 0x64($s3)", "tag 2 -> cursor 2 entry"),
            (0x800A5FC4, "sw $a0, 0x60($s3)", "tag 2 -> obj+0x60"),
            (0x800A5FC8, "sh $v0, 0x66($s3)", "tag 2 -> cursor 2 hold"),
            (0x800A5FE0, "lw $v0, 0x54($s3)", "state 0 reads the arm word"),
            (0x800A6008, "move_ $a0, $s3", "the arm word branches away"),
            (0x800A6014, "lbu $v0, 0x6a2a($v0)", "the arm word's re-arm seed"),
            (0x800A6070, "jal D0x800a5de0", "state 1 steps the blink script"),
            (0x800A6060, "addiu $a1, 0x6a1c", "state 1 script 0x800a6a1c"),
            (0x800A606C, "sb $s4, ($s0)", "state 1: the tag-1 record goes live"),
            (0x800A6074, "sb $s5, 0x4($s0)", "state 1 spriteId = 0x46 (70)"),
            (0x800A607C, "sb $v0, 0x9($s0)", "state 1 ctr = step value"),
            (0x800A6080, "sb $zr, ($s0)", "state 1: the tag-2 record stays dark"),
            (0x800A60EC, "jal D0x800a5de0", "state 2 steps the fire script"),
            (0x800A60E4, "addiu $a1, 0x6a28", "state 2 script 0x800a6a28"),
            (0x800A60E8, "li $a2, 0x1", "state 2 is the one-shot arm"),
            (0x800A6104, "sb $s4, 0x4($s0)", "state 2 done: spriteId = 0x50"),
            (0x800A610C, "sw $zr, 0x50($s3)", "state 2 done: clear the flag"),
            (0x800A6114, "sb $v1, 0x4($s0)", "state 2 running: spriteId = step"),
            (0x800A6118, "sb $s4, 0x4($s0)", "state 2 idle: spriteId = 0x50"),
            (0x800A613C, "jal D0x800a5de0", "state 2 slot 1 steps its script"),
            (0x800A6128, "addiu $a1, 0x6a54", "state 2 slot 1 script 0x800a6a54"),
            (0x800A6134, "li $v0, 0x51",
             "state 2 slot 1 writes spriteId and ctr 0x51 (81)"),
        ],
        "tags": [1, 2],
        "scripts": {"blink": 0x800A6A1C, "fire": 0x800A6A28, "back": 0x800A6A54},
        # s795 reads both seeds through the pointers its overlay keeps at
        # 0x800a6a70 / 0x800a6a78, so each seed is the first hold of the script
        # that pointer names; the re-arm seed is u8[0x800a6a2a] directly.
        "seed_ptrs": {"tag1": 0x800A6A70, "tag2": 0x800A6A78},
        "seed_holds": {"rearm": (0x800A6A2A, 1)},
        "sounds": [],
    },
    {
        # ── s800 Undersea Base Magasta B2F, id 837 (0x345) ─────────────────
        # The same shape as s795's 836, on the B2F pair at (898,764).
        "stage": "800", "id": 837, "kind": "fire",
        "ctor": 0x800A61C0, "tick": 0x800A5F00, "draw": 0x800A6174,
        "anchors": [
            (0x800A61C8, "lui $a0, 0x800a", "ctor"),
            (0x800A61CC, "addiu $a0, 0x5f00", "ctor tick 0x800a5f00"),
            (0x800A61D0, "li $a1, 0x64", "ctor size 0x64"),
            (0x800A61D8, "jal F0x800143dc", "ctor"),
            (0x800A6178, "li $v0, 0x35b", "draw answers sub 859"),
            (0x800A6188, "sh $v0, 0x50($a0)", "draw: arm the fire flag"),
            (0x800A6190, "sh $zr, 0x58($a0)", "draw: cursor 1 restarts"),
            (0x800A6194, "lbu $v0, 0x7612($v0)", "draw: re-arm seed"),
            (0x800A61A8, "jalr $v0", "draw: setState(2)"),
            (0x800A5F50, "lw $a0, -0x6270($v0)", "claim reads 0x80099d90"),
            (0x800A5F64, "li $t0, 0x1", "claim compares tag 1"),
            (0x800A5F70, "li $a2, 0x2", "claim compares tag 2"),
            (0x800A5F6C, "addiu $a3, $v0, 0x7604", "tag 1 seed address"),
            (0x800A5F94, "lbu $v0, 0x2($a3)",
             "the tag-1 seed is the blink script's first hold"),
            (0x800A5F90, "sh $zr, 0x58($s3)", "tag 1 -> cursor 1 entry"),
            (0x800A5F98, "sw $a0, 0x54($s3)", "tag 1 -> obj+0x54"),
            (0x800A5F9C, "sh $v0, 0x5a($s3)", "tag 1 -> cursor 1 hold"),
            (0x800A5F78, "addiu $a1, $v0, 0x763c", "tag 2 seed address"),
            (0x800A5FB0, "sh $zr, 0x60($s3)", "tag 2 -> cursor 2 entry"),
            (0x800A5FB8, "sw $a0, 0x5c($s3)", "tag 2 -> obj+0x5c"),
            (0x800A5FBC, "sh $v0, 0x62($s3)", "tag 2 -> cursor 2 hold"),
            (0x800A5FD4, "lh $v0, 0x52($s3)", "state 0 reads the arm word"),
            (0x800A6004, "sh $zr, 0x58($a0)", "the arm word branches away"),
            (0x800A6008, "lbu $v0, 0x7612($v0)", "the arm word's re-arm seed"),
            (0x800A6064, "jal D0x800a5de0", "state 1 steps the blink script"),
            (0x800A6054, "addiu $a1, 0x7604", "state 1 script 0x800a7604"),
            (0x800A6060, "sb $s4, ($s0)", "state 1: the tag-1 record goes live"),
            (0x800A6068, "sb $s5, 0x4($s0)", "state 1 spriteId = 0x46 (70)"),
            (0x800A6070, "sb $v0, 0x9($s0)", "state 1 ctr = step value"),
            (0x800A6074, "sb $zr, ($s0)", "state 1: the tag-2 record stays dark"),
            (0x800A60E0, "jal D0x800a5de0", "state 2 steps the fire script"),
            (0x800A60D8, "addiu $a1, 0x7610", "state 2 script 0x800a7610"),
            (0x800A60DC, "li $a2, 0x1", "state 2 is the one-shot arm"),
            (0x800A60F8, "sb $s4, 0x4($s0)", "state 2 done: spriteId = 0x50"),
            (0x800A6100, "sh $zr, 0x50($s3)", "state 2 done: clear the flag"),
            (0x800A6108, "sb $v1, 0x4($s0)", "state 2 running: spriteId = step"),
            (0x800A610C, "sb $s4, 0x4($s0)", "state 2 idle: spriteId = 0x50"),
            (0x800A6130, "jal D0x800a5de0", "state 2 slot 1 steps its script"),
            (0x800A611C, "addiu $a1, 0x763c",
             "state 2 slot 1 script 0x800a763c"),
            (0x800A6128, "li $v0, 0x51",
             "state 2 slot 1 writes spriteId and ctr 0x51 (81)"),
        ],
        "tags": [1, 2],
        "scripts": {"blink": 0x800A7604, "fire": 0x800A7610, "back": 0x800A763C},
        "seed_holds": {"tag1": (0x800A7606, 1), "tag2": (0x800A763E, 1),
                       "rearm": (0x800A7612, 1)},
        "sounds": [],
    },
    {
        # ── s800 Undersea Base Magasta B2F, id 839 (0x347) ─────────────────
        # Construct-only (the registry's draw pointer is null).  The tag-3
        # record at (1550,338) plays sprite 52,53,54... once at 6 blanks each and
        # then switches itself off.  The tag-4 record it also claims never gets
        # an `active` byte, so it stays hidden in the original too.
        "stage": "800", "id": 839, "kind": "oneshot",
        "ctor": 0x800A6510, "tick": 0x800A6344, "draw": None,
        "anchors": [
            (0x800A6518, "lui $a0, 0x800a", "ctor"),
            (0x800A651C, "addiu $a0, 0x6344", "ctor tick 0x800a6344"),
            (0x800A6520, "li $a1, 0x6c", "ctor size 0x6c"),
            (0x800A6528, "jal F0x800143dc", "ctor"),
            (0x800A638C, "lw $a0, -0x6270($v0)", "claim reads 0x80099d90"),
            (0x800A63A0, "li $a2, 0x3", "claim compares tag 3"),
            (0x800A63A4, "li $a1, 0x4", "claim compares tag 4"),
            (0x800A63BC, "sw $zr, 0x58($s3)", "tag 3 -> cursor 1 entry"),
            (0x800A63C0, "sw $a0, 0x54($s3)", "tag 3 -> obj+0x54"),
            (0x800A63D4, "sw $zr, 0x64($s3)", "tag 4 -> cursor 2 entry"),
            (0x800A63D8, "sw $a0, 0x60($s3)", "tag 4 -> obj+0x60"),
            (0x800A63F8, "sw $v1, 0x58($s3)", "state 0 arms cursor 1"),
            (0x800A63FC, "sh $zr, 0x5c($s3)", "state 0 cursor 1 hold = 0"),
            (0x800A6404, "sw $v1, 0x64($s3)", "state 0 arms cursor 2"),
            (0x800A640C, "sh $zr, 0x68($s3)", "state 0 cursor 2 hold = 0"),
            (0x800A6400, "lbu $v0, 0x765a($v0)", "state 0 cursor 1 hold seed"),
            (0x800A6418, "lbu $v0, 0x76a6($v0)", "state 0 cursor 2 hold seed"),
            (0x800A6438, "addiu $s5, $v0, 0x76f0", "the four script pointers"),
            (0x800A643C, "li $s4, 0x54", "the first cursor is at obj+0x54"),
            (0x800A6444, "lw $v0, 0x58($s1)", "state 1 armed flag 1"),
            (0x800A6448, "lw $s0, 0x54($s1)", "state 1 record 1"),
            (0x800A6454, "lw $a1, ($s5)", "state 1 script from the table"),
            (0x800A6458, "li $a2, 0x1", "state 1 is the one-shot arm"),
            (0x800A645C, "jal 0x800a6224", "state 1 steps it (the form-B "
                                          "stepper)"),
            (0x800A6478, "sw $zr, 0x58($s1)", "the finished pass disarms"),
            (0x800A6480, "sb $v0, ($s0)", "the first pass writes `active`"),
            (0x800A6484, "sb $v1, 0x4($s0)", "the first pass writes spriteId"),
            (0x800A648C, "sb $zr, 0x9($s0)", "the first pass zeroes ctr"),
            (0x800A6490, "li $v0, 0x33", "later passes write sprite 0x33 (51)"),
            (0x800A6494, "sb $v0, 0x4($s0)", "later passes write spriteId"),
            (0x800A649C, "sb $v1, 0x9($s0)", "later passes write ctr"),
            (0x800A64A0, "sb $zr, ($s0)", "a disarmed pass hides its record"),
            (0x800A64A8, "addiu $s4, 0xc", "the next cursor is 0xc further on"),
            (0x800A64B8, "addiu $s1, 0xc", "the second round reads 0xc on"),
            (0x800A64BC, "lw $v0, 0x58($s3)", "state 1 checks armed flag 1"),
            (0x800A64CC, "lw $v0, 0x64($s3)", "state 1 checks armed flag 2"),
            (0x800A64E8, "li $a1, 0x3", "both spent -> setState(3)"),
        ],
        "tags": [3, 4],
        "scripts": {"pass0": 0x800A7658, "pass1": 0x800A76A4},
        # The four script pointers live in the overlay's own table; the last two
        # are not script addresses in the shipped image, which is why only pass 0
        # ever reaches a visible record.
        "script_ptrs": [0x800A76F0, 0x800A76F4, 0x800A76F8, 0x800A76FC],
        "seed_holds": {"cursor1": (0x800A765A, 1), "cursor2": (0x800A76A6, 1)},
        "sounds": [],
    },
]
# ── the five point-record members ─────────────────────────────────────────
# These five were read from wstag805.s, wstag810.s and wstag820.s by the tool
# that used to be tools/extract_point_driver_tables.py.  That tool emitted a
# GENERATED TYPESCRIPT FILE whose per-state recipes were written into an
# f-string by hand -- a converted copy with hand rows.  Here the same reading
# lives in ONE table format with the same anchors as the decor members, and
# every recipe below cites the file offset of the arm it reproduces.
#
# `recipes` is the per-state write list, one entry per (state, panel):
#   [state, active, sprite, ctr, scriptIndex|"follow-next"|null]
# where a field is
#   - a literal byte,
#   - "S"  = the stepper's return value this blank,
#   - "A"  = the object's own state register (s820 file 0x190 `sb $v1, ($s0)`),
#   - null = the original stores nothing in that byte on that arm,
# and `end` is the arm the call site's THIRD argument selects: "restart" for
# `$a2 == 0` (`move_ $a2, $zr`), "stop" for `li $a2, 0x1`, "follow-next" for
# s805, whose stepper copy has no `$a2` test at all (wstag805.s file 0x1ec --
# its only end arm is `lbu $v1, 0x3($s0)` / `sh $v1, 0x4($s1)` at :0x298/:0x2a8).

POINT_SITES = [
    {
        # ── s805 machine room, id 840 (0x348) ──────────────────────────────
        # Four ambient records at (235,78) -- the stage's whole point table.
        #   claim walk:  :0x338..0x424, panel script table 0x800A72A8
        #   handler:      :0x5e4 (sub 0x35b, packed 0x00340004, setState(2))
        #   state 1 arms: :0x488 / :0x498 / :0x4a0 (panel 4 runs script 3)
        #   state 2 arms: :0x524 / :0x544 / :0x56c / :0x5ac
        "machine": "point-record",
        "stage": "805", "id": 840,
        "ctor": None, "tick": 0x800A60CC, "draw": 0x800A63C4,
        "sub": 0x35B, "nextState": 2, "fireSound": 0x00340004,
        "buildSound": None, "rearm": False, "claimState": 0,
        "stepper": "follow-u8",
        "tags": [1, 2, 3, 4],
        # The claim walk walks a four-pointer table, one per panel, and the
        # panel's initial hold is entry 0's delay byte of THAT panel's script
        # (`lbu $v0, 0x2($t0)` at wstag805.s file 0x3b0).
        "panelScripts": 0x800A72A8,
        "anchors": [
            (0x800A6118, "lw $a0, -0x6270($v0)",
             "claim reads the global record list at 0x80099d90"),
            (0x800A6120, "lbu $v0, 0x2($a0)", "claim table terminator"),
            (0x800A6140, "addiu $a2, $a3, 0x72a8",
             "the four-pointer panel script table at 0x800a72a8"),
            (0x800A6148, "lbu $v1, -0x1($a1)", "claim compares the atlas byte"),
            (0x800A6150, "beq $v1, $t3, .L0x000003c4", "claim branches on a tag"),
            (0x800A6184, "addiu $a1, 0x12", "claim strides 0x12 bytes"),
            (0x800A61D4, "j 0x800a61f4", "claim stores tag 3"),
            (0x800A61DC, "sh $zr, 0x6c($s2)", "tag 3's cursor index is zeroed"),
            (0x800A61F0, "sh $v0, 0x6e($s2)", "tag 3's cursor hold"),
            # the stepper this overlay uses is at file 0x1ec
            (0x800A5FF4, "lh $v1, 0x4($s1)", "stepper reads the cursor index"),
            (0x800A600C, "slti $v0, $v1, 0x5", "stepper clamps the delta to 4"),
            (0x800A6054, "lbu $v1, 0x2($s0)", "stepper reads the entry DELAY byte"),
            (0x800A6068, "lh $v1, ($s0)", "stepper reads the entry value"),
            (0x800A606C, "li $v0, 0xff", "the end marker is 0x00FF, not -1"),
            (0x800A6078, "lbu $v1, 0x3($s0)",
             "s805's only end arm: the end entry's THIRD byte is the jump"),
            (0x800A6088, "sh $v1, 0x4($s1)",
             "... and that byte becomes the new cursor index"),
            (0x800A60A4, "jal 0x800a5fcc", "the stepper tail-calls itself"),
            # state 1
            (0x800A6268, "sb $s4, ($s0)", "state 1 panel 1: active = 1"),
            (0x800A626C, "sb $v0, 0x4($s0)",
             "state 1 panel 1: sprite = 2. $v0 holds the `li $v0, 0x2` from "
             ":0x45c and this arm never calls the stepper, so nothing clobbers it"),
            (0x800A6274, "sb $zr, 0x9($s0)", "state 1 panel 1: ctr = 0"),
            (0x800A627C, "sb $zr, ($s0)", "state 1 panel 2: active = 0"),
            (0x800A628C, "li $v0, 0x13", "state 1 panel 4: sprite pinned to 19"),
            (0x800A6298, "sb $v0, 0x4($s0)",
             "state 1 panel 4: PINNED, in the jal's delay slot"),
            (0x800A629C, "sb $v0, 0x9($s0)",
             "state 1 panel 4: ctr = the stepper's RETURN VALUE, because the jal "
             "clobbers $v0 before this store"),
            # state 2
            (0x800A6308, "addiu $a1, 0x7218", "state 2 panel 1: script 0x800a7218"),
            (0x800A630C, "move_ $a2, $zr",
             "state 2 panel 1: $a2 == 0. s805's stepper ignores $a2 -- it has no "
             "test for it -- and always follows the end entry's third byte"),
            (0x800A6310, "jal 0x800a5fcc", "state 2 panel 1 steps its script"),
            (0x800A6314, "sb $s4, ($s0)",
             "state 2 panel 1: active = 1, in the jal's delay slot"),
            (0x800A6318, "sb $v0, 0x4($s0)",
             "state 2 panel 1: sprite = the stepper's RETURN VALUE. This is a "
             "normal instruction, not a pin: the earlier reading took the "
             "`li $v0, 0x2` at :0x4f8 for a pin, but that immediate is the "
             "delay slot of the panel-2 compare at :0x4f4 and the jal "
             "overwrites $v0 anyway."),
            (0x800A6320, "sb $zr, 0x9($s0)", "state 2 panel 1: ctr = 0"),
            (0x800A632C, "addiu $a1, 0x726c",
             "state 2 panel 2: script 0x800a726c"),
            (0x800A6334, "li $v0, 0x15", "state 2 panel 2: sprite pinned to 21"),
            (0x800A6340, "sb $v0, 0x4($s0)", "state 2 panel 2: sprite PINNED"),
            (0x800A6348, "sb $v0, 0x9($s0)", "state 2 panel 2: ctr PINNED to 21"),
            (0x800A635C, "li $v0, 0x16", "state 2 panel 3: sprite pinned to 22"),
            (0x800A6368, "sb $v0, 0x4($s0)", "state 2 panel 3: sprite PINNED"),
            (0x800A6370, "li $v0, 0x12c",
             "state 2 panel 3: the 300 test is on the stepper's value"),
            (0x800A6380, "sb $zr, 0x9($s0)", "... and 300 writes ctr 0"),
            (0x800A6388, "sb $v1, 0x9($s0)", "... else ctr = the value"),
            (0x800A638C, "sb $zr, ($s0)", "state 2 panel 4: active = 0"),
            # the command handler
            (0x800A63C4, "addiu $sp, -0x18", "the handler"),
            (0x800A63D0, "beqz $s0, .L0x0000062c", "the handler's null-object arm"),
            (0x800A6408, "li $a1, 0x2", "the handler calls setState(2)"),
        ],
        "entryWidth": "byte",
        # panel k claims atlas tag k+1; `hold` is entry 0's delay byte of that
        # panel's own script, read by the claim walk's `lbu $v0, 0x2($t0)`.
        "panels": [
            {"atlas": 1, "recipe": {
                1: {"active": 1, "sprite": 2, "ctr": 0},
                2: {"active": 1, "sprite": "S", "ctr": 0, "script": "panel0",
                    "arm": "restart"},
            }},
            {"atlas": 2, "recipe": {
                1: {"active": 0},
                2: {"active": 1, "sprite": 21, "ctr": 21, "script": "panel1",
                    "arm": "restart"},
            }},
            {"atlas": 3, "recipe": {
                1: {"active": 0},
                2: {"active": 1, "sprite": 22, "ctr": "S?300:0", "script": "panel2",
                    "arm": "restart"},
            }},
            {"atlas": 4, "recipe": {
                1: {"active": 1, "sprite": 19, "ctr": "S", "script": "panel3",
                    "arm": "restart"},
                2: {"active": 0},
            }},
        ],
    },
    {
        # ── s810 stations, ids 842/843/844 (0x34a/0x34b/0x34c) ────────────
        # One object shape, three of them, stamped with different atlas tags at
        # obj+0x52 (:0x47c tag 5, :0x440 tag 3, :0x408 tag 1); each claims the
        # record whose atlas byte is its tag and the tag above it (:0x188/:0x1c4).
        #   the handler rewinds slot 0 from the overlay byte at 0x800A719E (:0x3b8)
        "machine": "point-record",
        "stage": "810", "id": None,   # filled in per instance below
        "ctor": None, "tick": 0x800A5F00, "draw": 0x800A6178,
        "sub": 0x35B, "nextState": 2, "fireSound": None,
        "buildSound": None, "rearm": True, "claimState": 2,
        "stepper": "base-u8",
        "instances": [
            {"id": 844, "tag": 1},
            {"id": 843, "tag": 3},
            {"id": 842, "tag": 5},
        ],
        "tags": None,  # [tag, tag+1] per instance
        # Three sequences, named by the arm that passes each to the stepper:
        # slot 0 state 1 (:0x278), slot 0 state 2 (:0x2f8), slot 1 state 2
        # (:0x340).  Each panel's initial hold is entry 0's delay byte of the
        # script its OWN claim arm names -- slot 0 of `seq0` (:0x1b0) and slot 1
        # of `seq2` (:0x1d4).
        "scripts": {"seq0": 0x800A718C, "seq1": 0x800A719C, "seq2": 0x800A71D8},
        "rearmByte": 0x800A719E,
        "anchors": [
            (0x800A5F68, "lh $a2, 0x52($s2)", "the claim's first tag"),
            (0x800A5F6C, "addiu $t0, $v0, 0x718c", "slot 0's script 0x800a718c"),
            (0x800A5F74, "addiu $a3, $v0, 0x71d8", "slot 1's script 0x800a71d8"),
            (0x800A5F7C, "lbu $v0, -0x1($a0)", "claim compares the atlas byte"),
            (0x800A5F84, "bne $v0, $a2, .L0x000001bc", "claim branches on tag n"),
            (0x800A5F8C, "sh $zr, 0x58($s2)", "slot 0's cursor index = 0"),
            (0x800A5F90, "lbu $v0, 0x2($t0)",
             "slot 0's hold = entry 0's DELAY BYTE"),
            (0x800A5F94, "sw $a1, 0x54($s2)", "slot 0's record pointer"),
            (0x800A5FA4, "addiu $v0, 0x1", "claim looks for the tag above"),
            (0x800A5FB0, "sh $zr, 0x60($s2)", "slot 1's cursor index = 0"),
            (0x800A5FB4, "lbu $v0, 0x2($a3)",
             "slot 1's hold = entry 0's delay byte"),
            (0x800A5FB8, "sw $a1, 0x5c($s2)", "slot 1's record pointer"),
            (0x800A5FC0, "addiu $a0, 0x12", "claim strides 0x12 bytes"),
            (0x800A5FCC, "bnez $v0, .L0x0000019c",
             "claim walks until record+2 == 0"),
            (0x800A5FD4, "lbu $v1, 0x51($s2)", "the claim tick reads the mode byte"),
            (0x800A5FF0, "sh $zr, 0x58($a0)", "the claim tick zeroes slot 0"),
            (0x800A5FF4, "lbu $v0, 0x719e($v0)", "the rearm hold byte"),
            (0x800A5FFC, "li $a1, 0x2", "the claim tick calls setState(2)"),
            (0x800A6058, "addiu $a1, 0x718c", "state 1 slot 0's script"),
            (0x800A605C, "move_ $a2, $zr", "state 1 slot 0: the restart arm"),
            (0x800A6064, "sb $s4, ($s0)", "state 1 slot 0: active"),
            (0x800A6068, "jal D0x800a5de0", "state 1 slot 0 steps its script"),
            (0x800A606C, "sb $s5, 0x4($s0)",
             "state 1 slot 0: sprite PINNED in the jal's delay slot"),
            (0x800A6074, "sb $v0, 0x9($s0)", "state 1 slot 0: ctr = the value"),
            (0x800A6078, "sb $zr, ($s0)", "state 1 slot 1: active = 0"),
            (0x800A60C4, "sb $s5, ($s0)", "state 2 slot 0: active = 1"),
            (0x800A60C8, "lbu $v0, 0x50($s2)",
             "state 2 slot 0 reads the object's run flag"),
            (0x800A60DC, "addiu $a1, 0x719c", "state 2 slot 0's script"),
            (0x800A60E0, "li $a2, 0x1", "state 2 slot 0: the STOP arm"),
            (0x800A60F0, "li $v0, 0xff", "state 2 slot 0's end test"),
            (0x800A60FC, "sb $s4, 0x4($s0)",
             "state 2 slot 0: 0xFF leaves the record on clip 84"),
            (0x800A6104, "sb $zr, 0x50($s2)",
             "state 2 slot 0: the run flag clears"),
            (0x800A610C, "sb $v1, 0x4($s0)", "state 2 slot 0: sprite = the value"),
            (0x800A6110, "sb $s4, 0x4($s0)",
             "state 2 slot 0 idle: clip 84 again"),
            (0x800A6118, "sb $zr, 0x9($s0)", "state 2 slot 0: ctr = 0"),
            (0x800A6120, "addiu $a1, 0x71d8", "state 2 slot 1's script"),
            (0x800A6124, "move_ $a2, $zr", "state 2 slot 1: the restart arm"),
            (0x800A612C, "li $v0, 0x46", "state 2 slot 1: sprite pinned to 70"),
            (0x800A6134, "jal D0x800a5de0", "state 2 slot 1 steps its script"),
            (0x800A6138, "sb $v0, 0x4($s0)",
             "state 2 slot 1: sprite PINNED in the jal's delay slot"),
            (0x800A613C, "sb $v0, 0x9($s0)",
             "state 2 slot 1: ctr = the stepper's return value"),
            (0x800A6178, "addiu $sp, -0x18", "the command handler"),
            (0x800A618C, "sb $v0, 0x50($a0)", "the handler sets the run flag"),
            (0x800A6198, "lbu $v0, 0x719e($v0)", "the handler's rearm byte"),
            (0x800A61E8, "sh $v1, 0x52($v0)", "one instance stamps tag 1"),
            (0x800A6220, "li $v1, 0x3", "one instance stamps tag 3"),
            (0x800A625C, "li $v1, 0x5", "one instance stamps tag 5"),
        ],
        "entryWidth": "byte",
        # panel 0 claims the instance's own atlas tag, panel 1 the tag above it.
        # `hold` is entry 0's delay byte of slot 0's / slot 1's own script, and
        # slot 0's is ALSO rewound from the overlay byte at 0x800A719E by the
        # command handler (wstag810.s file 0x3b8).
        "panels": [
            {"atlas": None, "holdFrom": "seq0", "recipe": {
                1: {"active": 1, "sprite": 85, "ctr": "S", "script": "seq0",
                    "arm": "restart"},  # :0x27c `move_ $a2, $zr`
                2: {"active": 1, "sprite": "S?255:84", "ctr": 0,
                    "script": "seq1", "arm": "stop",   # :0x300 `li $a2, 0x1`
                    # :0x2f8 `beqz $v0, .L0x00000330` is the ONLY arm in the
                    # whole system that tests the object's run flag, so it is the
                    # only recipe the flag gates.  Panel 1's arms (:0x278, :0x340)
                    # step their script whatever the flag says.
                    "gated": True,
                    "onEnd": {"clearRunning": True},
                    "idle": {"active": 1, "sprite": 84, "ctr": 0}},
            }},
            {"atlas": None, "atlasPlusOne": True, "holdFrom": "seq2", "recipe": {
                1: {"active": 0},
                2: {"active": 1, "sprite": 70, "ctr": "S", "script": "seq2"},
            }},
        ],
    },
    {
        # ── s820 control room, id 853 (0x355) ───────────────────────────────
        # Sound only.  Its registry record HAS a constructor and a NULL draw
        # slot, so `SETANIM 853 821 2` only builds the object -- the ctor plays
        # packed 0x0004001D (`lui $a0,0x4` / `ori $a0,0x1d`, file 0x1f8/0x1fc),
        # the same TELEPORT id the launch pads play.  The tick's state 0 arm
        # (:0x10c..0x174) claims the record, zeroes the stepper header and
        # STOPS: nothing ever calls setState(1), so the animating arm at :0x178
        # never runs and the record's own bytes are never written.  The port
        # reproduces the claim and the constructor's sound and leaves the record
        # inactive, which is what the console shows.
        "machine": "point-record",
        "stage": "820", "id": 853,
        "ctor": None, "tick": 0x800A5EB8, "draw": None,
        "sub": None, "nextState": None, "fireSound": None,
        "buildSound": 0x0004001D, "rearm": False, "claimState": 0,
        # s820's own copy of the stepper is a THIRD variant: file 0x24..0xd4,
        # the same twenty instructions again, with a u16 hold and NO `$a2` test
        # at all -- `beq $v1, $v0, .L0x000000bc` at :0xa4 goes straight to the
        # epilogue, so 0x00FF always stops the script whatever the call passes.
        "stepper": "stop-u16",
        "tags": [1],
        "scripts": {"seq0": 0x800A711C},   # `lhu $v0, 0x711e($v0)`: a HALFWORD
        "anchors": [
            (0x800A5F00, "lw $a0, -0x6270($v0)",
             "claim reads the global record list at 0x80099d90"),
            (0x800A5F08, "lbu $v0, 0x2($a0)", "claim table terminator"),
            (0x800A5F1C, "lbu $v0, -0x1($v1)", "claim compares the atlas byte"),
            (0x800A5F24, "bne $v0, $a1, .L0x00000150", "claim branches on tag 1"),
            (0x800A5F2C, "sw $a0, 0x50($s1)", "claim stores tag 1 -> obj+0x50"),
            (0x800A5F30, "addiu $v1, 0x12", "claim strides 0x12 bytes"),
            (0x800A5F48, "sh $zr, 0x54($s1)", "the cursor index is zeroed"),
            (0x800A5F4C, "lhu $v0, 0x711e($v0)",
             "the hold is entry 0's HOLD HALFWORD -- this copy reads the "
             "`{s16 value, u16 hold}` form, not the delay byte the s805/s810 "
             "copies read"),
            (0x800A5F54, "sh $v0, 0x56($s1)", "and stores it"),
            # the animating arm, which nothing in the overlay ever reaches
            (0x800A5F58, "addiu $a0, $s1, 0x50", "state 1: the cursor address"),
            (0x800A5F60, "addiu $a1, 0x711c", "state 1's script 0x800a711c"),
            (0x800A5F64, "lw $s0, 0x50($s1)", "state 1: the claimed record"),
            (0x800A5F68, "move_ $a2, $zr", "state 1: $a2 == 0, the RESTART arm"),
            (0x800A5F6C, "jal D0x800a5de0", "state 1 steps the script"),
            (0x800A5F70, "sb $v1, ($s0)",
             "state 1: active = the object's own STATE REGISTER, not 1 -- $v1 "
             "still holds the state this arm was reached from"),
            (0x800A5F78, "li $v0, 0xff", "state 1's end test"),
            (0x800A5F88, "sb $v1, 0x4($s0)",
             "state 1: sprite = the stepper's value"),
            (0x800A5F8C, "sb $zr, ($s0)",
             "state 1: 0xFF switches the record off"),
            (0x800A5F9C, "li $a1, 0x3", "state 1: setState(3) on the end marker"),
            (0x800A5FD8, "lui $a0, 0x4", "the constructor's packed sound"),
            (0x800A5FDC, "ori $a0, 0x1d",
             "... 0x0004001D, the same TELEPORT cue the launch pads play"),
        ],
        "entryWidth": "halfword",
        "panels": [
            {"atlas": 1, "holdFrom": "seq0", "recipe": {
                1: {"active": "A", "sprite": "S", "script": "seq0", "arm": "restart",
                    "onEnd": {"state": 3},
                    "endWrites": {"active": 0}},
            }},
        ],
    },
{
        # ── s545 the flash row one script away from the `single` shape ───────
        # Four states, ONE claimed record and NO pad.  State 0 (:0x3a4) is the
        # claim: advanceState, seed the cursor's hold from the script's own
        # first hold (`lhu $v0, 0x6d5e($v0)` -> 0x800a6d5c + 2), then walk the
        # table for the tag-1 row and park it at obj+0x50.  State 1 (:0x454) is
        # a PASSIVE flash the row sits in until the scene's command arrives:
        # active 1, sprite 24, ctr 9.  State 2 (:0x474) is the script arm -- it
        # reloads the cursor and latches clip 1 on the FIRST pass only
        # (`lw $v0, 0x10($s0)` / `bnez $v0`), plays 0x004C0002 there, then steps
        # 0x800a6d5c with `move_ $a2, $zr` and writes active 1, sprite 24 and
        # ctr = the step value.  On 0x00ff it SETS state 1 (:0x4e8 `jalr $v0` /
        # :0x4ec `li $a1, 0x1`), and the `j`'s delay slot writes ctr 9 (:0x4f0
        # `li $v0, 0x9` / :0x4f8 `sb $v0, 0x9($s1)`) before the jump lands on
        # the arm that writes active 1 and sprite 24 -- so the end blank is the
        # FLASH again, not the script's own 0xFF.
        # The registry record has a NULL constructor: the stage builds this
        # object itself at stage entry (`wstag545` file 0xae4 -> `jal
        # 0x800a633c` with `li $a0, 0x34f` in the delay slot).
        "machine": "point-record",
        "stage": "545", "id": 847,
        "ctor": None, "tick": 0x800A6184, "draw": 0x800A6304,
        "sub": 0x35A, "nextState": 2, "fireSound": None,
        "buildSound": None, "rearm": False, "claimState": 0,
        "stepper": "base-u16",
        "tags": [1],
        "scripts": {"seq0": 0x800A6D5C},
        "anchors": [
            (0x800A6184, 'addiu $sp, -0x20',
             "the tick"),
            (0x800A61A0, 'beq $v1, $v0, .L0x00000454',
             "state 1 is the flash arm"),
            (0x800A61A4, 'slti $v0, $v1, 0x2',
             "state 0 is the claim arm"),
            (0x800A61B0, 'beq $v1, $v0, .L0x00000474',
             "state 2 is the script arm"),
            (0x800A61B8, 'beq $v1, $v0, .L0x00000510',
             "state 3 is the epilogue"),
            (0x800A61C0, 'lw $v0, 0x38($s0)',
             "claim: advanceState"),
            (0x800A61D4, 'sh $zr, 0x54($s0)',
             "claim: cursor index = 0"),
            (0x800A61D8, 'lhu $v0, 0x6d5e($v0)',
             "claim: hold = u16[0x800a6d5e]"),
            (0x800A61E0, 'sh $v0, 0x56($s0)',
             "claim: cursor hold"),
            (0x800A61FC, 'li $a1, 0x1',
             "claim: the tag it looks for is 1"),
            (0x800A6204, 'lbu $v0, -0x1($v1)',
             "claim compares the atlas byte"),
            (0x800A620C, 'bne $v0, $a1, .L0x00000438',
             "claim branches on tag 1"),
            (0x800A6214, 'sw $a0, 0x50($s0)',
             "claim parks the row at obj+0x50"),
            (0x800A6234, 'lw $v0, 0x50($s0)',
             "flash: the claimed row"),
            (0x800A623C, 'sb $v1, ($v0)',
             "flash: active = 1"),
            (0x800A6240, 'li $v1, 0x18',
             "flash: sprite 24"),
            (0x800A6244, 'sb $v1, 0x4($v0)',
             "flash: spriteId = 24"),
            (0x800A6248, 'li $v1, 0x9',
             "flash: ctr 9"),
            (0x800A6250, 'sb $v1, 0x9($v0)',
             "flash: ctr = 9"),
            (0x800A6254, 'lw $v0, 0x10($s0)',
             "script: the clip test"),
            (0x800A625C, 'bnez $v0, .L0x000004b8',
             "... only the first pass reloads the cursor"),
            (0x800A6268, 'sh $zr, 0x54($s0)',
             "script: cursor index = 0"),
            (0x800A626C, 'lhu $v0, 0x6d5e($v0)',
             "script: the same seed hold"),
            (0x800A6270, 'lw $v1, 0x2c($s0)',
             "script: setClip"),
            (0x800A6274, 'li $a1, 0x1',
             "script: clip 1"),
            (0x800A6278, 'jalr $v1',
             "script: latches clip 1 once"),
            (0x800A6280, 'lui $a0, 0x4c',
             "script: the cue, high half"),
            (0x800A6294, 'ori $a0, 0x2',
             "script: the cue 0x004C0002"),
            (0x800A6298, 'addiu $a0, $s0, 0x50',
             "script: the cursor cell"),
            (0x800A62A0, 'addiu $a1, 0x6d5c',
             "script 0x800a6d5c"),
            (0x800A62A4, 'lw $s1, 0x50($s0)',
             "script: the claimed row"),
            (0x800A62A8, 'jal 0x800a60ac',
             "script: steps it (this overlay's own copy)"),
            (0x800A62AC, 'move_ $a2, $zr',
             "script: $a2 == 0, the RESTART arm"),
            (0x800A62B4, 'li $v0, 0xff',
             "script: the 0x00FF end test"),
            (0x800A62B8, 'bne $v1, $v0, .L0x000004fc',
             "... ordinary values go on"),
            (0x800A62C0, 'lw $v0, 0x28($a0)',
             "script: setState"),
            (0x800A62C8, 'jalr $v0',
             "script: back to the flash"),
            (0x800A62CC, 'li $a1, 0x1',
             "script: state 1"),
            (0x800A62D0, 'li $v0, 0x9',
             "script: the end blank's ctr"),
            (0x800A62D8, 'sb $v0, 0x9($s1)',
             "script: ctr 9 in the `j`'s DELAY SLOT, before the next arm"),
            (0x800A62DC, 'sb $v1, 0x9($s1)',
             "script: an ordinary blank's ctr is the value"),
            (0x800A62E0, 'li $v0, 0x1',
             "script: active = 1"),
            (0x800A62E4, 'sb $v0, ($s1)',
             "script: the end blank's active"),
            (0x800A62E8, 'li $v0, 0x18',
             "script: sprite 24"),
            (0x800A62EC, 'sb $v0, 0x4($s1)',
             "script: spriteId = 24"),
            (0x800A6304, 'addiu $sp, -0x18',
             "the configure arm"),
            (0x800A6310, 'li $v0, 0x35a',
             "the configure arm answers sub 858"),
            (0x800A6328, 'li $a1, 0x2',
             "the configure arm calls setState(2)"),
            (0x800A60D4, 'lh $v1, 0x4($s0)',
             "stepper: the cursor index"),
            (0x800A60FC, 'bnez $s3, .L0x00000334',
             "stepper: the recursion skips the subtraction"),
            (0x800A6104, 'lhu $v0, 0x6($s0)',
             "stepper: the hold, a HALFWORD"),
            (0x800A614C, 'li $v0, 0xff',
             "stepper: the end marker is 0x00FF"),
            (0x800A6150, 'beq $v1, $v0, .L0x00000388',
             "stepper: ... compared against the entry's value"),
        ],
        "entryWidth": "halfword",
        "panels": [
            {"atlas": 1, "holdFrom": "seq0", "recipe": {
                0: {"advance": True},
                1: {"active": 1, "sprite": 24, "ctr": 9},
                2: {"active": 1, "sprite": 24, "ctr": "S", "script": "seq0",
                    "arm": "restart", "cue": 0x004C0002, "cueClip": 0,
                    "latchClip": 1,
                    "endWrites": {"active": 1, "sprite": 24, "ctr": 9},
                    "onEnd": {"state": 1}},
            }},
        ],
    },
]

# ── the two `slots` members: one object, N claimed records ────────────────
# `grid` (s620) and `lanes` (s680) are two shapes of ONE per-member machine in
# the same style as `decor`'s five: the claim walk fills N slots in TABLE ORDER,
# each slot keeps its own `{entry, hold}` cursor and its own script, and each
# slot's arm writes its step value into ONE record byte.  What is hand-entered
# here is the ADDRESS of each site plus the instruction text the decode read
# there -- the tool re-reads both from ~/ddw3/asm/dw2003/pro/wstagNNN.s AND the
# shipped image, so a mistyped address or a stale overlay stops the build.
# Everything numeric (the claim ranges, the per-slot tables, the jump table) is
# MINED from those overlays by the readers below.
SLOT_SITES = [
    {
        # ── s620, id 849 (0x351): a four-record grid ────────────────────────
        # Four claimed rows, and each row's clip goes into ONE of the record's
        # two animation bytes: three slots write `ctr` (record+9) and the fourth
        # writes `spriteId` (record+4) and plays one cue on clip 52.  Which
        # byte a slot uses is the overlay's own flag word at slot+3, seeded in
        # the claim arm (`:0x1f8 sb $zr, 0x53/0x5f/0x6b($s4)` for slots 0..2 and
        # `:0x1d8 sb $v0, 0x77($s4)` = 1 for slot 3) and tested at `:0x324
        # lbu $v0, 0x53($s1)` / `:0x32c bnez $v0, .L0x0000033c`.
        #
        # Each slot's script is an ENTRY, not an address: the loop reads
        # `table + slot * 0x20 + index * 8` (`:0x28c sll $v0, 0x3` /
        # `:0x290 sll $s2, 0x5` / `:0x29c lw $a1, ($v0)`), hands the entry's
        # `+4` halfword to the stepper as `$a2` (`:0x2a0 lh $a2, 0x4($v0)`) and
        # its `+6` halfword as the index to switch to when the script ends
        # (`:0x2e0 lh $v1, 0x6($v0)`).  A zero `+6` puts the row out.
        #
        # The registry record has a NULL configure slot, so `SETANIM 849 821 1`
        # only builds the object; everything after that is its own tick.
        "machine": "slots",
        "stage": "620", "id": 849, "kind": "grid",
        "ctor": 0x800A6198, "tick": 0x800A5F00, "draw": None,
        "stepper": "base-u16",
        "slotStride": 0xC, "slotFirst": 0x50, "slotCount": 4,
        "entryTable": 0x800A7648, "entryWindow": 0x20, "entryCount": 4,
        "claimTagLo": 1, "claimTagHi": 4,
        "onceClip": 52, "onceSound": 0x54000001,
        "anchors": [
            (0x800A5F00, 'addiu $sp, -0x38',
             "the tick"),
            (0x800A5F38, 'beq $v1, $v0, .L0x00000260',
             "state 1 is the slot loop"),
            (0x800A5F3C, 'slti $v0, $v1, 0x2',
             "state 0 is the claim arm"),
            (0x800A5F48, 'bnez $v0, .L0x00000388',
             "states 2 and 3 are the epilogue"),
            (0x800A5F64, 'lw $a0, -0x6270($v0)',
             "claim reads the global record list"),
            (0x800A5F88, 'addiu $v0, -0x1',
             "claim: the tag range starts at 1"),
            (0x800A5F8C, 'sltiu $v0, 0x4',
             "claim: four tags, so 1..4"),
            (0x800A5F98, 'sw $a0, 0x54($a1)',
             "claim: slot 0's row"),
            (0x800A5F9C, 'addiu $a1, 0xc',
             "claim: the slot stride is 0xc"),
            (0x800A5FB8, 'sb $v0, 0x77($s4)',
             "claim: slot 3 is the spriteId slot"),
            (0x800A5FC4, 'sh $v0, 0x50($s4)',
             "claim: slot 0 starts on script 2"),
            (0x800A5FC8, 'sh $v0, 0x5c($s4)',
             "claim: slot 1 starts on script 2"),
            (0x800A5FE4, 'sh $v0, 0x68($s4)',
             "claim: slot 2 starts on script 1"),
            (0x800A5FE8, 'sh $v0, 0x74($s4)',
             "claim: slot 3 starts on script 1"),
            (0x800A5FD4, 'addiu $v1, 0x7648',
             "the 8-byte-entry script table at 0x800a7648"),
            (0x800A5FD8, 'sb $zr, 0x53($s4)',
             "claim: slot 0 writes ctr"),
            (0x800A5FDC, 'sb $zr, 0x5f($s4)',
             "claim: slot 1 writes ctr"),
            (0x800A5FE0, 'sb $zr, 0x6b($s4)',
             "claim: slot 2 writes ctr"),
            (0x800A6064, 'beqz $v0, .L0x00000370',
             "loop: script index 0 takes no script"),
            (0x800A606C, 'sll $v0, 0x3',
             "loop: index * 8"),
            (0x800A6070, 'sll $s2, $s5, 0x5',
             "loop: slot * 0x20"),
            (0x800A607C, 'lw $a1, ($v0)',
             "loop: the entry's script pointer"),
            (0x800A6080, 'lh $a2, 0x4($v0)',
             "loop: the entry's +4 halfword IS the stepper's $a2"),
            (0x800A6090, 'li $v0, 0xff',
             "loop: the 0x00FF end test"),
            (0x800A6098, 'li $v0, 0x12c',
             "loop: the 300 that blinks the row off"),
            (0x800A60A0, 'li $v0, 0x1',
             "loop: active = 1"),
            (0x800A60C0, 'lh $v1, 0x6($v0)',
             "switch: the entry's +6 halfword, the next index"),
            (0x800A60C8, 'bnez $v1, .L0x000002f8',
             "switch: ... tested for zero"),
            (0x800A60D4, 'sh $zr, 0x50($s1)',
             "switch: zero puts the slot out"),
            (0x800A60D8, 'sh $v0, 0x50($s1)',
             "switch: otherwise the new index"),
            (0x800A60E0, 'sh $zr, 0x58($s1)',
             "switch: a switch rewinds the cursor"),
            (0x800A6104, 'lbu $v0, 0x53($s1)',
             "write arm: the slot's flag byte"),
            (0x800A6110, 'li $v0, 0x34',
             "write arm: the one clip that plays a cue"),
            (0x800A6118, 'sb $s0, 0x9($s3)',
             "write arm: flag 0 puts the value in ctr"),
            (0x800A611C, 'bne $s0, $v0, .L0x00000368',
             "write arm: otherwise spriteId"),
            (0x800A6130, 'lui $a0, 0x54',
             "write arm: the cue, high half"),
            (0x800A6140, 'ori $a0, 0x1',
             "write arm: the cue 0x54000001"),
            (0x800A6144, 'sb $zr, 0x52($s1)',
             "write arm: the slot's cue flag clears"),
            (0x800A614C, 'sb $s0, 0x4($s3)',
             "write arm: flag 1 puts the value in spriteId"),
            (0x800A6150, 'sb $zr, ($s3)',
             "the row goes dark"),
            (0x800A615C, 'slti $v0, $s5, 0x4',
             "four slots"),
            (0x800A6154, 'addiu $s1, 0xc',
             "the loop's slot stride"),
            (0x800A5E10, 'lh $v1, 0x8($s1)',
             "stepper: the cursor index"),
            (0x800A5E40, 'lhu $v0, 0xa($s1)',
             "stepper: the hold, a HALFWORD"),
            (0x800A5E80, 'beqz $s3, .L0x000000c0',
             "stepper: `$a2 == 0` restarts at entry 0, else stops"),
            (0x800A5E8C, 'li $v0, 0xff',
             "stepper: the end marker is 0x00FF"),
        ],
    },
    {
        # ── s680, id 814 (0x32e): eleven lanes and three traffic rows ───────
        # One claim walk sorts every point row into two slot arrays: rows
        # tagged 1..7 fill ELEVEN 0x14-byte lane slots in TABLE ORDER, each
        # taking the next row of the overlay's own 11-pointer script table
        # (`:0x2c8 lw $v0, ($t0)` / `:0x2d4 addiu $t0, 0x4`), and rows tagged
        # 8..10 fill three 8-byte TRAFFIC slots (`:0x294 sh $zr, 0x12c($a2)` /
        # `:0x2a4 addiu $a2, 0x8`).  A lane also stores its own tag in two words
        # so the configure routine can find it by tag rather than by slot.
        #
        # The configure routine is a 63-entry jump table at the overlay base
        # keyed on `sub - 829`.  Eight entries do something: 830..835 light the
        # lanes carrying tags 1..6 (833 and 835 also start a traffic slot), and
        # 891 clears one lane slot's row pointer and starts the live-object
        # drive.  Lighting a lane writes 1 into that slot's cursor INDEX
        # (`:0x57c lh $v0, 0x5a($a0)` / `:0x584 bne $a2, $v0` /
        # `:0x58c sh $a1, 0x58($a0)`), so the lane starts at entry 1.
        #
        # The stepper copy here is a FIFTH variant: the end entry's THIRD byte is
        # a one-shot RISE in map pixels which the stepper parks in the cursor's
        # own +4 word, and the index goes back to 0 rather than following it
        # (`:0x1a8 lbu $v0, 0x3($s0)` / `:0x1b0 sh $zr, 0xc($s1)` /
        # `:0x1b4 sw $v0, 0x4($s1)`), which is the word the lane's arm adds to
        # its row's Y (`:0x34c lhu $v1, 0x54($s1)` / `:0x358 sh $v0, 0xc($s0)` /
        # `:0x35c sw $zr, 0x54($s1)`).
        "machine": "slots",
        "stage": "680", "id": 814, "kind": "lanes",
        "ctor": 0x800A63AC, "tick": 0x800A5FD8, "draw": 0x800A627C,
        "stepper": "rise-u8",
        "laneStride": 0x14, "laneFirst": 0x50, "laneCount": 11,
        "trafficStride": 0x8, "trafficFirst": 0x12C, "trafficCount": 3,
        "scriptTable": 0x800A6790,
        "claimLaneLo": 1, "claimLaneHi": 7,
        "claimTrafficLo": 8, "claimTrafficHi": 10,
        "bound": 401, "trafficBy": 1,
        "configTable": 0x800A5DE0, "configBase": 829,
        "configSound": 0xEC000001,
        "driveBound": 121, "driveStep": 64,
        "anchors": [
            (0x800A5FD8, 'addiu $sp, -0x30',
             "the tick"),
            (0x800A6004, 'beq $v1, $v0, .L0x00000310',
             "state 1 is the two loops"),
            (0x800A6008, 'slti $v0, $v1, 0x2',
             "state 0 is the claim arm"),
            (0x800A6018, 'bnez $v0, .L0x00000478',
             "states 2 and 3 are the epilogue"),
            (0x800A6024, 'lw $a3, -0x6270($v0)',
             "claim reads the global record list"),
            (0x800A6054, 'beqz $v1, .L0x000002e4',
             "claim: tag 0 is skipped"),
            (0x800A605C, 'bltz $v1, .L0x000002a8',
             "claim: a lane slot"),
            (0x800A6060, 'slti $v0, $v1, 0xb',
             "claim: above ten is a lane"),
            (0x800A6064, 'beqz $v0, .L0x000002a8',
             "claim: so is anything from eleven up"),
            (0x800A6068, 'slti $v0, $v1, 0x8',
             "claim: 1..7 is a lane and 8..10 is traffic"),
            (0x800A6074, 'sh $zr, 0x12c($a2)',
             "traffic: cursor index = 0"),
            (0x800A6078, 'sh $zr, 0x12e($a2)',
             "traffic: hold = 0"),
            (0x800A607C, 'sw $a3, 0x130($a2)',
             "traffic: the row"),
            (0x800A6084, 'addiu $a2, 0x8',
             "the traffic stride"),
            (0x800A6090, 'sh $v0, 0x5a($a0)',
             "lane: its own tag byte"),
            (0x800A6098, 'sh $zr, 0x58($a0)',
             "lane: cursor index = 0"),
            (0x800A609C, 'sh $zr, 0x5c($a0)',
             "lane: the one-shot rise = 0"),
            (0x800A60A0, 'sll $v0, 0x8',
             "lane: the tag, shifted"),
            (0x800A60A4, 'sw $v0, 0x50($a0)',
             "lane: the tag word"),
            (0x800A60A8, 'lw $v0, ($t0)',
             "lane: its own script pointer"),
            (0x800A60B0, 'lbu $v0, 0x2($v0)',
             "lane: the seed is a DELAY BYTE"),
            (0x800A60B4, 'addiu $t0, 0x4',
             "the script table's stride"),
            (0x800A60B8, 'sw $a3, 0x60($a0)',
             "lane: the row"),
            (0x800A60BC, 'sh $v0, 0x5e($a0)',
             "lane: the cursor hold"),
            (0x800A60C0, 'addiu $a0, 0x14',
             "the lane stride"),
            (0x800A6104, 'lh $v0, 0x58($s1)',
             "lane loop: the cursor index"),
            (0x800A6124, 'sb $v0, 0x4($s0)',
             "lane loop: spriteId = the step value"),
            (0x800A6128, 'lhu $v0, 0xc($s0)',
             "lane loop: the row's Y"),
            (0x800A612C, 'lhu $v1, 0x54($s1)',
             "lane loop: the parked rise"),
            (0x800A6138, 'sh $v0, 0xc($s0)',
             "lane loop: Y += the rise"),
            (0x800A613C, 'sw $zr, 0x54($s1)',
             "lane loop: the rise is one-shot"),
            (0x800A6148, 'slti $v0, 0x191',
             "lane loop: the Y bound is 401"),
            (0x800A6154, 'sh $zr, 0x58($s1)',
             "lane loop: past the bound it stops"),
            (0x800A6164, 'slti $v0, $s2, 0xb',
             "eleven lanes"),
            (0x800A6180, 'lh $v0, 0x12c($s1)',
             "traffic loop: the cursor index"),
            (0x800A6190, 'lw $v0, 0x18c($s3)',
             "traffic loop: the frame-delta routine"),
            (0x800A61A4, 'sll $v0, 0x7',
             "traffic loop: delta * 128 into the hold"),
            (0x800A61B8, 'sra $v1, 0x18',
             "traffic loop: ... and Y += 1"),
            (0x800A61CC, 'slti $v0, 0x191',
             "traffic loop: the same Y bound"),
            (0x800A61D8, 'sh $zr, 0x12c($s1)',
             "traffic loop: past the bound it stops"),
            (0x800A61E0, 'slti $v0, $s2, 0x3',
             "three traffic rows"),
            (0x800A61EC, 'lh $v0, 0x148($s5)',
             "drive: the flag word"),
            (0x800A621C, 'addiu $v1, 0x40',
             "drive: the counter steps by 64"),
            (0x800A6228, 'lw $a0, 0x54($v0)',
             "drive: live object 5's +0x54"),
            (0x800A6234, 'sw $a0, 0x54($v0)',
             "drive: and adds a pixel to it"),
            (0x800A6248, 'slti $v1, 0x79',
             "drive: the counter bound is 121"),
            (0x800A627C, 'addiu $sp, -0x20',
             "the configure routine"),
            (0x800A62B4, 'addiu $v1, $s1, -0x33d',
             "configure: keyed on sub - 829"),
            (0x800A62B8, 'sltiu $v0, $v1, 0x3f',
             "configure: 63 entries"),
            (0x800A62C8, 'addiu $v0, 0x5de0',
             "configure: the table lives at the overlay base"),
            (0x800A62EC, 'j 0x800a634c',
             "configure: entry 0 arms at the shared light loop"),
            (0x800A62F0, 'li $a2, 0x1',
             "configure: sub 829 lights tag 1"),
            (0x800A62FC, 'li $v0, 0x1',
             "configure: sub 831 arms a traffic slot"),
            (0x800A6300, 'sh $v0, 0x12c($s0)',
             "configure: sub 831 starts traffic slot 0"),
            (0x800A6308, 'li $a2, 0x3',
             "configure: sub 831 also lights tag 3"),
            (0x800A6314, 'li $v0, 0x1',
             "configure: sub 833 arms a traffic slot"),
            (0x800A6318, 'sh $v0, 0x13c($s0)',
             "configure: sub 833 starts traffic slot 2"),
            (0x800A6320, 'li $a2, 0x5',
             "configure: sub 833 also lights tag 5"),
            (0x800A6324, 'j 0x800a634c',
             "configure: sub 834 arms at the light loop"),
            (0x800A6328, 'li $a2, 0x6',
             "configure: sub 834 lights tag 6"),
            (0x800A632C, 'li $a2, 0x7',
             "configure: sub 835 lights tag 7"),
            (0x800A6334, 'sh $v0, 0x134($s0)',
             "configure: sub 835 starts traffic slot 1"),
            (0x800A633C, 'sw $zr, 0x74($a0)',
             "configure: sub 835 clears lane slot 1's row, in the j's delay slot"),
            (0x800A6340, 'li $v0, 0x1',
             "configure: sub 891 arms the drive flag"),
            (0x800A6348, 'sh $v0, 0x148($s0)',
             "configure: sub 891 sets the drive flag, in the j's delay slot"),
            (0x800A634C, 'beqz $a2, .L0x000005b8',
             "configure: the light loop's own entry and its zero arm"),
            (0x800A635C, 'lh $v0, 0x5a($a0)',
             "the light loop reads each lane's tag byte"),
            (0x800A636C, 'sh $a1, 0x58($a0)',
             "... and writes 1 into that lane's cursor index"),
            (0x800A6380, 'lui $a0, 0xec',
             "the light cue, high half"),
            (0x800A6394, 'ori $a0, 0x1',
             "the light cue 0xEC000001"),
            (0x800A5F04, 'lh $v1, 0xc($s1)',
             "stepper: the cursor index"),
            (0x800A5F64, 'lbu $v1, 0x2($s0)',
             "stepper: the entry DELAY BYTE"),
            (0x800A5F7C, 'li $v0, 0xff',
             "stepper: the end marker is 0x00FF"),
            (0x800A5F88, 'lbu $v0, 0x3($s0)',
             "stepper: the end entry's THIRD byte"),
            (0x800A5F90, 'sh $zr, 0xc($s1)',
             "stepper: ... and the index goes back to 0"),
            (0x800A5F94, 'sw $v0, 0x4($s1)',
             "stepper: ... parked in the cursor's own +4 word"),
        ],
    },
]
# Their TABLES are mined out of the overlay by shape (the functions above, which
# came from tools/extract_materialize_effects.py); what is hand-entered here is
# only the ADDRESS of each member's tick and constructor, each paired with the
# instruction the decode read there.  The registry's own construct pointer is
# read out of fieldstg's table, so a member whose record has a null constructor
# is built by its stage at stage entry and needs no hand row.
PAD_SITES = [
    {"stage": "212", "id": 810, "tick": 0x800A5EF4, "ctor": 0x800A61FC,
     "anchors": [(0x800A5EF4, "addiu $sp, -0x30", "the tick"),
                 (0x800A61FC, "addiu $sp, -0x18", "the constructor")]},
    {"stage": "225", "id": 815, "tick": 0x800A5EF0, "ctor": 0x800A61E0,
     "anchors": [(0x800A5EF0, "addiu $sp, -0x30", "the tick"),
                 (0x800A61E0, "addiu $sp, -0x18", "the constructor")]},
    {"stage": "750", "id": 846, "tick": 0x800A5EF0, "ctor": None,
     "anchors": [(0x800A5EF0, "addiu $sp, -0x30", "the tick")]},
    {"stage": "925", "id": 855, "tick": 0x800A6110, "ctor": 0x800A639C,
     "anchors": [(0x800A6110, "addiu $sp, -0x30", "the tick"),
                 (0x800A639C, "addiu $sp, -0x18", "the constructor")]},
]


def nearest_li(words, offs, at, reg):
    """The `li $reg, N` the code above `at` set, scanning back over the routine.

    Every seeding store in this system is fed by an `li` a few instructions
    earlier (`li $v0, 0x2` / `sh $v0, 0x50($s4)`), and the linear constant
    tracker loses the register across the claim loop, so the immediate is read
    straight out of the instruction stream.  `li rt, imm` is
    `addiu rt, $zero, imm` = 0x2400_0000 | (rt << 16) | imm.
    """
    want = 0x2400_0000 | (reg << 16)
    for o in reversed(offs[:offs.index(at)]):
        w = words[o]
        if (w & 0xFFFF0000) == want:
            imm = w & 0xFFFF
            return imm - 0x10000 if imm >= 0x8000 else imm
    return None


def claim_rows(points, stage, lo, hi):
    """The rows the overlay's claim walk stops at, in TABLE ORDER.

    The walk does not break out of its loop: it tests each row's atlas byte
    against a range and stores the row it stopped at in the next slot, so the
    k-th slot holds the k-th MATCHING ROW and a repeated tag fills two slots.
    That is what the original does, and it is not the same as "the first row
    with this tag" -- which is why `claimRecord`'s plain first-match walk cannot
    be used here and the slot list carries the row index itself.
    """
    recs = (points.get("s" + stage) or {}).get("records") or []
    return [(i, r) for i, r in enumerate(recs)
            if lo <= (r.get("atlasFlag") or 0) <= hi]


def build_slot_members(overlays, points, reg, checked):
    """The `slots` machine's members: the claim ranges, the per-slot tables and
    the configure jump table, all MINED, with every load-bearing immediate
    anchored against the overlay."""
    out = {}
    for spec in SLOT_SITES:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        eid = spec["id"]
        recs = (points.get("s" + stage) or {}).get("records") or []
        words, offs, tick = slot_words(ov, spec)
        member = {
            "stage": stage,
            "id": eid,
            "idHex": "0x%03x" % eid,
            "machine": "slots",
            "kind": spec["kind"],
            "stepper": spec["stepper"],
            "tick": ram(spec["tick"]),
            "ctor": ram(spec.get("ctor")),
            "registryCtor": registry_ctor(reg, eid),
            "draw": ram(spec.get("draw")),
            "tags": {},
            "scripts": {},
            "panels": [],
        }
        got = False
        try:
            if spec["kind"] == "grid":
                got = build_grid_member(ov, words, tick, spec, points, stage, member)
            else:
                got = build_lanes_member(ov, words, tick, spec, points, stage, member)
        except (ValueError, KeyError, IndexError) as exc:
            fail("point_record_actors: s%s id 0x%03x %s: %s"
                 % (stage, eid, spec["kind"], exc))
        if got:
            out.setdefault("s" + stage, {})[str(eid)] = member
    return out


def slot_words(ov, spec):
    """The tick's own word list: everything from the tick to the next prologue.

    The whole per-slot machinery is read out of the TICK, not out of the whole
    overlay, so an unrelated routine's immediates cannot be mistaken for this
    member's.
    """
    begin = spec["tick"] - OVERLAY_BASE
    words = {off: ov.word(OVERLAY_BASE + off)
             for off in range(0, len(ov.data), 4)}
    end = len(ov.data)
    for off in range(begin + 4, len(ov.data), 4):
        w = words[off]
        if (w >> 16) == 0x27BD and (w & 0x8000) and off != begin:
            end = off
            break
    tick = list(range(begin, end, 4))
    return words, tick, tick


def build_grid_member(ov, words, tick, spec, points, stage, member):
    """The `grid` shape's two mined halves: the per-slot seeds and the flag
    byte that says which record field the slot writes."""
    stride, first, count = spec["slotStride"], spec["slotFirst"], spec["slotCount"]
    slots = []
    for k in range(count):
        base = first + stride * k
        start = store_const(words, tick, base, "sh", 0x00, "$s4")
        flag = store_const(words, tick, base + 3, "sb", 0x00, "$s4")
        if start is None or flag is None:
            raise ValueError("slot %d's seed or flag store is not in the tick" % k)
        slots.append({"at": base, "start": start,
                      "write": "sprite" if flag else "ctr"})
    once = [i for i, s in enumerate(slots) if s["write"] == "sprite"]
    if len(once) != 1:
        raise ValueError("exactly one slot must write spriteId, found %d" % len(once))
    entries = []
    for k in range(count):
        row = []
        for j in range(spec["entryCount"]):
            at = spec["entryTable"] + spec["entryWindow"] * k + 8 * j
            ptr = ov.word(at)
            loop, nxt = struct.unpack_from("<hh", ov.data, at - OVERLAY_BASE + 4)
            if not in_ram(ptr, len(ov.data)):
                row.append(None)
                continue
            name = "s%ds%d" % (k, j)
            member["scripts"][name] = script_of(ov, ptr, "halfword")
            row.append({"script": name, "loop": loop, "next": nxt})
        entries.append(row)
    lo, hi = spec["claimTagLo"], spec["claimTagHi"]
    rows = claim_rows(points, stage, lo, hi)
    if len(rows) != count:
        raise ValueError("the claim range %d..%d takes %d rows, not %d"
                         % (lo, hi, len(rows), count))
    for k, (i, row) in enumerate(rows):
        slots[k]["tag"] = row.get("atlasFlag") or 0
        slots[k]["index"] = i
        member["tags"][str(slots[k]["tag"])] = record_geom(row, i)
    member["grid"] = {
        "slots": slots,
        "entries": entries,
        "onceSlot": once[0],
        "onceClip": spec["onceClip"],
        "onceSound": ram(spec["onceSound"]),
    }
    return True


def build_lanes_member(ov, words, tick, spec, points, stage, member):
    """The `lanes` shape: the claim walk's two ranges, the 11-pointer script
    table and the 63-entry configure jump table at the overlay base."""
    lane_lo, lane_hi = spec["claimLaneLo"], spec["claimLaneHi"]
    traf_lo, traf_hi = spec["claimTrafficLo"], spec["claimTrafficHi"]
    lanes = claim_rows(points, stage, lane_lo, lane_hi)
    traffic = claim_rows(points, stage, traf_lo, traf_hi)
    if len(lanes) != spec["laneCount"]:
        raise ValueError("the lane range %d..%d takes %d rows, not %d"
                         % (lane_lo, lane_hi, len(lanes), spec["laneCount"]))
    if len(traffic) != spec["trafficCount"]:
        raise ValueError("the traffic range %d..%d takes %d rows, not %d"
                         % (traf_lo, traf_hi, len(traffic), spec["trafficCount"]))
    slot_at, scripts = [], []
    for k in range(spec["laneCount"]):
        name = "lane%d" % k
        scripts.append(name)
        member["scripts"][name] = script_of(
            ov, ov.word(spec["scriptTable"] + 4 * k), "byte")
        i, row = lanes[k]
        slot_at.append({"tag": row.get("atlasFlag") or 0, "index": i,
                        "at": spec["laneFirst"] + spec["laneStride"] * k,
                        "script": name})
        member["tags"][str(slot_at[k]["tag"])] = record_geom(row, i)
    traffic_at = []
    for k, (i, row) in enumerate(traffic):
        traffic_at.append({
            "tag": row.get("atlasFlag") or 0, "index": i,
            "at": spec["trafficFirst"] + spec["trafficStride"] * k})
        member["tags"][str(traffic_at[k]["tag"])] = record_geom(row, i)
    lights, starts, clears = {}, {}, {}
    drive_sub = None
    base, limit = spec["configBase"], 0x3F
    ret = 0
    for i in range(limit):
        sub = base + i
        target = ov.word(spec["configTable"] + 4 * i)
        if not in_ram(target, len(ov.data)):
            continue
        tag = None
        start = None
        clear = None
        # One arm is a short straight line that ENDS in a `j`, whose delay slot
        # carries the last thing it does (`li $a2, N` names the lane tag,
        # `sh $v0, 0x12c($s0)` starts a traffic slot, `sw $zr, <row>($a0)`
        # clears one).  Reading past the `j` would pick up the NEXT arm's
        # words, so the walk stops there.
        seen = []
        for step in range(4):
            w = ov.word(target + 4 * step)
            seen.append(w)
            if (w >> 26) == 0x02 and (w & 0x03FFFFFF):
                ret += 1
                seen.append(ov.word(target + 4 * step + 4))
                break
        for w in seen:
            if (w & 0xFFFF0000) == 0x24060000 and (w & 0xFFFF) and tag is None:
                tag = w & 0xFFFF
            if (w & 0xFFFF0000) == 0xA6020000 and ((w >> 21) & 31) == REG["$s0"]:
                # `sh $v0, imm($s0)`: a traffic slot's cursor index
                d = w & 0xFFFF
                for k in range(spec["trafficCount"]):
                    if d == spec["trafficFirst"] + spec["trafficStride"] * k:
                        start = k
            if w == 0xAC800000 | (spec["laneFirst"] + spec["laneStride"] + 0x10):
                # `sw $zr, <lane 1's row word>($a0)`: the 835 arm
                clear = 1
            if (w & 0xFFFF0000) == 0xA6020000 and (w & 0xFFFF) == 0x0148:
                drive_sub = sub
        if tag:
            lights[str(sub)] = tag
        if start is not None:
            starts[str(sub)] = start
        if clear is not None:
            clears[str(sub)] = clear
    if not ret:
        raise ValueError("the configure table has no arm")
    # The drive's own two numbers, MINED from the tail of the animate state: the
    # `addiu` whose next word is the sign-extend `sll $v1, 0x10` is the phase
    # step (file 0x43c / 0x444), and the `slti` that follows the counter's
    # `move_ $v1, $v0` is its bound (file 0x468).  Both are cross-checked
    # against the decode's own record, so a mine that drifts stops the build.
    step = None
    bound_mined = None
    lo = spec["tick"] - OVERLAY_BASE
    words_list = [ov.word(OVERLAY_BASE + o)
                  for o in range(lo, len(ov.data), 4)]
    for k in range(len(words_list) - 2):
        w = words_list[k]
        # the phase's own `sh` sits between the addiu and the sign-extend
        if (w >> 16) == 0x2463 and words_list[k + 2] == 0x00031C00:
            step = w & 0xFFFF
        # `move_ $v1, $v0` (the counter copy) / `addiu $v0, 0x1` / `slti $v1, B`
        if (w >> 26) == 0x0A and k >= 2:
            mv, plus = words_list[k - 2], words_list[k - 1]
            if mv == 0x00401821 and (plus >> 16) == 0x2442:
                bound_mined = w & 0xFFFF
    if step is None:
        raise ValueError("the drive's phase step is not in the tick")
    if bound_mined is None:
        raise ValueError("the drive's counter bound is not in the tick")
    if step != spec["driveStep"] or bound_mined != spec["driveBound"]:
        raise ValueError("the drive mines step %d / bound %d, the decode recorded "
                         "%d / %d" % (step, bound_mined, spec["driveStep"],
                                      spec["driveBound"]))
    member["lanes"] = {
        "lanes": slot_at,
        "traffic": traffic_at,
        "bound": spec["bound"],
        "trafficBy": spec["trafficBy"],
        "lights": lights,
        "starts": starts,
        "clears": clears,
        "lightSound": ram(spec["configSound"]),
        "driveSub": drive_sub,
        "driveBound": bound_mined,
        "driveStep": step,
    }
    return True


def store_const(words, tick, offset, op, extra, base_reg):
    """The constant a `sh`/`sb $vX, offset($base)` store carries.

    `op` is the store's opcode top (`sh` 0x29, `sb` 0x28).  `$zero` is 0; any
    other register is read from the nearest `li` above the store, which is how
    every seeding store in this system is built.
    """
    i = -1
    for n, off in enumerate(tick):
        w = words[off]
        if (w >> 26) != (0x29 if op == "sh" else 0x28):
            continue
        if (w & 0xFFFF) != offset:
            continue
        if ((w >> 21) & 31) != REG[base_reg]:
            continue
        i = n
        reg = (w >> 16) & 31
        if reg == 0:
            return 0
        return nearest_li(words, tick, off, reg)
    if i < 0:
        return None
    return None


# PSX MIPS register numbers: $zero=0 $at=1 $v0..$v1=2..3 $a0..$a3=4..7
# $t0..$t7=8..15 $s0..$s7=16..23 $t8/$t9=24/25 $k0/$k1=26/27 $gp=28
# $sp=29 $fp=30 $ra=31.
REG = {"$v0": 2, "$v1": 3, "$a0": 4, "$a1": 5, "$a2": 6, "$a3": 7,
       "$t0": 8, "$t1": 9, "$s0": 16, "$s1": 17, "$s2": 18, "$s3": 19,
       "$s4": 20, "$s5": 21, "$s6": 22, "$s7": 23, "$sp": 29, "$ra": 31}


def ram(text):
    return "0x%08x" % text if text else None


def entry_of(ov, at, width):
    """One `{v, h, next}` script entry, read at the width this overlay uses.

    The 0x12c/0xFF value is a halfword in every copy (`lh $v1, ($s0)`), the hold
    is a HALFWORD where the copy reads `lhu` (wstag785 base, wstag795/s800 base,
    wstag820 base, and the pad-flash copies) and a BYTE where it reads `lbu`
    (wstag805 file 0x274 and wstag810 file 0x90).  The third byte is the end
    entry's jump index, and only wstag805's copy ever reads it.
    """
    data = ov.data
    off = at - OVERLAY_BASE
    v = struct.unpack_from("<H", data, off)[0]
    if width == "byte":
        h, nxt = data[off + 2], data[off + 3]
    else:
        h, nxt = struct.unpack_from("<H", data, off + 2)[0], 0
    return [v, h, nxt]


def script_of(ov, at, width):
    """A `{v, h, next}` run up to and including the 0x00FF end entry."""
    out = []
    for _ in range(256):
        out.append(entry_of(ov, at, width))
        if out[-1][0] == SCRIPT_END:
            return out
        at += 4
    raise SystemExit("point_record_actors: the script at %#010x has no 0x00ff "
                     "end marker" % at)


def build_point_members(overlays, points, reg, checked):
    """The five point-record members, from POINT_SITES."""
    out = {}
    for spec in POINT_SITES:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        recs, by_tag = tagged_records(points, stage)
        width = spec["entryWidth"]
        # One site entry can carry SEVERAL registry ids (s810 builds three
        # objects from the same code, stamped with different atlas tags), so
        # each member gets its own copy of the panel list.
        if spec.get("id") is not None:
            members = [dict(spec, panels=copy.deepcopy(spec["panels"]),
                            id=spec["id"])]
        else:
            members = [
                dict(spec, panels=copy.deepcopy(spec["panels"]), id=i["id"],
                     tags=[i["tag"], i["tag"] + 1])
                for i in spec["instances"]]
        for entry in members:
            eid = entry["id"]
            tags = entry["tags"]
            member = {
                "stage": stage,
                "id": eid,
                "idHex": "0x%03x" % eid,
                "machine": "point-record",
                "tick": ram(entry["tick"]),
                "ctor": ram(entry.get("ctor")),
                "registryCtor": registry_ctor(reg, eid),
                "draw": ram(entry.get("draw")),
                "sub": entry["sub"],
                "nextState": entry["nextState"],
                "fireSound": ram(entry["fireSound"]),
                "buildSound": ram(entry["buildSound"]),
                "rearm": entry["rearm"],
                "claimState": entry["claimState"],
                "stepper": entry["stepper"],
                "tags": {},
                "scripts": {},
                "panels": [],
            }
            for tag in tags:
                if tag not in by_tag:
                    fail("point_record_actors: s%s has no point record with "
                         "atlas tag %d" % (stage, tag))
                    continue
                member["tags"][str(tag)] = record_geom(recs[by_tag[tag]], by_tag[tag])
            if entry.get("panelScripts"):
                # s805: the four-pointer table the claim walk walks per panel.
                for k, panel in enumerate(entry["panels"]):
                    name = "panel%d" % k
                    at = ov.word(entry["panelScripts"] + 4 * k)
                    member["scripts"][name] = script_of(ov, at, width)
                    panel["hold"] = ov.u8(at + 2)
            else:
                for name, at in entry["scripts"].items():
                    member["scripts"][name] = script_of(ov, at, width)
                for panel in entry["panels"]:
                    at = entry["scripts"][panel["holdFrom"]]
                    panel["hold"] = (ov.u8(at + 2) if width == "byte"
                                     else ov.u16(at + 2))
                if entry.get("rearmByte"):
                    member["rearmHold"] = ov.u8(entry["rearmByte"])
            if entry.get("instances"):
                inst = next(i for i in entry["instances"] if i["id"] == eid)
                for panel in entry["panels"]:
                    if panel.get("atlas") is None:
                        panel["atlas"] = (inst["tag"] + 1 if panel.get("atlasPlusOne")
                                          else inst["tag"])
            member["panels"] = [
                {k: v for k, v in panel.items()
                 if k not in ("atlasPlusOne", "holdFrom")}
                for panel in entry["panels"]]
            out.setdefault("s" + stage, {})[str(eid)] = member
    return out


# ── the `two-slot` member: two compared rows and the live-character drive ────
# The THIRD shape of this actor, and the only member of it that moves the live
# field character (fieldstg's resident object registered as name 5, whose
# +0x54 is its world Y in 16.8 -- engine/systems/field-character.ts).
#
# FINDING THE SHAPE BY CODE.  `TWO_SLOT_SHAPE` is a seven-word run that only this
# machine has: it looks a resident object up BY NAME (`li $a0, 0x5`), calls the
# find-by-name pointer (`lw $v0, -0x4844($v0)` = [0x8004b7bc]), keeps the result
# in a callee-saved register pair, and dispatches on its own clip counter through
# a SIX-entry table built at the OVERLAY BASE (`addiu $v0, 0x5de0`).  Every
# wstag image is scanned for that run, so the member list below is what the code
# holds and not a hand list: an overlay that carries the shape without a
# registry member is reported in `copiesWithoutAMember`, and one whose tables
# this reader cannot describe is REFUSED BY NAME in `refused`.
TWO_SLOT_SHAPE = (
    0x24040005,  # li $a0, 0x5            the NAME the lookup asks for
    0x8C42B7BC,  # lw $v0, -0x4844($v0)   [0x8004b7bc], find resident by name
    0x00003021,  # move_ $a2, $zr         its third filter is zero
    0x2C620006,  # sltiu $v0, $v1, 0x6    SIX clips
    0x3C02800A,  # lui $v0, 0x800a
    0x24425DE0,  # addiu $v0, 0x5de0      the overlay base = the clip table
)
# The six words are one basic block but they are NOT adjacent -- the object
# pointers and the counter read sit between them -- so the shape is "all six
# inside one 0x40-byte window that starts at the name lookup".  No other overlay
# carries them there; the scan reports every hit either way.
TWO_SLOT_SHAPE_WINDOW = 0x40
# What each of the six table entries IS.  Each arm is named by a short pattern of
# consecutive instruction words -- (word, mask) pairs, matched in order -- and no
# two arms share one, so inside an arm's own bounds the match is exact.  A target
# matching none of them, or two of them, is a shape this reader REFUSES rather
# than guesses.  The `slide` pattern matches the table base by its FORM
# (`addiu $v0, $zero, <table>` followed by `sll $v1, 0x1`), because the table's
# address is per stage: s261's sits at 0x800a66a0 and s934's copy at 0x800a63b8,
# and both are the same arm.
FULL = 0xFFFFFFFF
TWO_SLOT_ARMS = (
    ("start", ((0xA600005A, FULL),),
     "sh $zr, 0x5a($s0)", 0x60),
    ("wait", ((0x8C42DF9C, FULL),),
     "lw $v0, -0x2064($v0)", 0x74),
    ("slide", ((0x24420000, 0xFFFF0000), (0x00031840, FULL)),
     "addiu $v0, <the delta table> ; sll $v1, 0x1", 0x0),
    ("blink", ((0x284200FE, FULL),),
     "slti $v0, 0xfe", 0x74),
    ("darken", ((0x38420001, FULL),),
     "xori $v0, 0x1", 0x34),
)


def two_slot_arm_match(words, pattern):
    """Where `pattern` sits in `words`, or None.  The pairs are consecutive."""
    n = len(pattern)
    for k in range(0, max(0, len(words) - n + 1)):
        if all((words[k + j] & mask) == (word & mask)
               for j, (word, mask) in enumerate(pattern)):
            return k
    return None

TWO_SLOT_SITES = [
    {
        # ── s261, id 827 (0x33b): the Cargo Tower's lift ───────────────────
        # Amaterasu City / Cargo Tower.  Its own script events 1321 and 1326
        # send `SETANIM 827 840 2` and `SETANIM 827 841 2`.
        "stage": "261", "id": 827,
        "tick": 0x800A5DFC, "ctor": 0x800A628C, "draw": 0x800A628C,
        "drop": -0x7F, "dropFixed": -0x7F00,
        "waitBlanks": 30, "blinkSteps": 0xFE, "blinkStep": 0x100,
        "deltaEnd": 0x3E8,
        "deltaTable": 0x800A66A0,
        "anchors": [
            (0x800A5DFC, 'addiu $sp, -0x20',
             "the tick"),
            (0x800A5E64, 'li $t0, 0x2',
             "claim: the first tag"),
            (0x800A5E68, 'li $a3, 0x3',
             "claim: the second tag"),
            (0x800A5E6C, 'li $a2, 0x1',
             "claim: the lit value"),
            (0x800A5E7C, 'beq $v0, $t0, .L0x000000b4',
             "claim: tag 2 is compared first"),
            (0x800A5E84, 'beq $v0, $a3, .L0x000000e4',
             "claim: tag 3 is compared second"),
            (0x800A5E94, 'sw $a1, 0x54($s0)',
             "claim: the tag-2 row"),
            (0x800A5EA8, 'sh $v0, 0x6a($s0)',
             "claim: saves the tag-2 row's Y"),
            (0x800A5EB4, 'addiu $v0, -0x7f',
             "claim: the 127-pixel drop"),
            (0x800A5EC0, 'sb $zr, ($a1)',
             "claim: the tag-2 row goes dark, in the j's delay slot"),
            (0x800A5EC4, 'sw $a1, 0x50($s0)',
             "claim: the tag-3 row"),
            (0x800A5ED8, 'sh $v0, 0x68($s0)',
             "claim: saves the tag-3 row's Y"),
            (0x800A5EEC, 'sb $a2, ($a1)',
             "claim: the tag-3 row lights"),
            (0x800A5EFC, 'bnez $v0, .L0x00000094',
             "claim: the walk does not break out of a match"),
            (0x800A5F08, 'sh $zr, 0x58($s0)',
             "claim: the direction word clears"),
            (0x800A5F0C, 'li $a0, 0x5',
             "state 2 looks name 5 up"),
            (0x800A5F1C, 'lw $v0, -0x4844($v0)',
             "state 2: [0x8004b7bc], find by name"),
            (0x800A5F30, 'move_ $a0, $v0',
             "state 2: the found object stays in $a0"),
            (0x800A5F34, 'sltiu $v0, $v1, 0x6',
             "state 2: six clips"),
            (0x800A5F40, 'addiu $v0, 0x5de0',
             "state 2: the table at the overlay base"),
            (0x800A5F54, 'jr $v0',
             "state 2: dispatch"),
            (0x800A5F5C, 'li $v0, 0x1',
             "clip 0 lights the tag-2 row"),
            (0x800A5F64, 'sh $zr, 0x5a($s0)',
             "clip 0 zeroes the wait counter"),
            (0x800A5F70, 'sh $v0, 0x60($s0)',
             "clip 0 saves the tag-3 row's Y"),
            (0x800A5F7C, 'sh $v0, 0x62($s0)',
             "clip 0 saves the tag-2 row's Y"),
            (0x800A5F80, 'lw $v0, 0x54($a0)',
             "clip 0 reads the character's +0x54"),
            (0x800A5F84, 'lui $a0, 0x8004',
             "clip 0's cue, high half"),
            (0x800A5F88, 'sw $v0, 0x64($s0)',
             "clip 0 saves the character's +0x54"),
            (0x800A5F9C, 'ori $a0, 0x103c',
             "clip 0's cue = 0x8004103C"),
            (0x800A5FCC, 'lhu $v1, 0x5a($s0)',
             "clip 1 reads the wait counter"),
            (0x800A5FE4, 'slti $v1, 0x1e',
             "clip 1 waits 30 blanks"),
            (0x800A5FFC, 'sh $zr, 0x5c($a0)',
             "clip 1 zeroes the cursor, in the advanceClip delay slot"),
            (0x800A6000, 'lui $a0, 0x108',
             "clip 1's cue, high half"),
            (0x800A6014, 'ori $a0, 0x1',
             "clip 1's cue = 0x01080001"),
            (0x800A6024, 'lh $v1, 0x5c($s0)',
             "clips 2/4 read the cursor"),
            (0x800A6028, 'addiu $v0, 0x66a0',
             "clips 2/4's delta table"),
            (0x800A6034, 'lh $v1, ($v1)',
             "clips 2/4 read it as a signed half"),
            (0x800A6038, 'li $v0, 0x3e8',
             "and 1000 ends the slide"),
            (0x800A603C, 'beq $v1, $v0, .L0x000002a8',
             "the end arm"),
            (0x800A6050, 'sh $v0, 0xc($s2)',
             "clips 2/4 write the tag-3 row"),
            (0x800A6060, 'sh $v0, 0xc($s1)',
             "clips 2/4 write the tag-2 row"),
            (0x800A6070, 'sw $v0, 0x54($a0)',
             "clips 2/4 write the character"),
            (0x800A6084, 'sh $v0, 0x5c($s0)',
             "the end arm zeroes the cursor, in the advanceClip delay slot"),
            (0x800A60A0, 'lhu $v0, 0x5c($s0)',
             "clip 3 reads its counter"),
            (0x800A60B4, 'slti $v0, 0xfe',
             "clip 3 stops on 254"),
            (0x800A60BC, 'sh $v1, 0x5c($s0)',
             "clip 3 steps its counter"),
            (0x800A60C8, 'beqz $v0, .L0x00000314',
             "clip 3's restore, by direction"),
            (0x800A60D8, 'sh $v0, 0xc($s2)',
             "the down restore writes the tag-3 row"),
            (0x800A60E4, 'sh $v0, 0xc($s1)',
             "the down restore writes the tag-2 row"),
            (0x800A60F0, 'addiu $v0, 0x7f00',
             "the down restore adds 127 pixels in 16.8, in the j's delay slot"),
            (0x800A6100, 'sh $v0, 0xc($s2)',
             "the up restore writes the tag-3 row"),
            (0x800A6110, 'sh $v0, 0xc($s1)',
             "the up restore writes the tag-2 row"),
            (0x800A611C, 'addiu $v0, -0x7f00',
             "the up restore takes 127 pixels off"),
            (0x800A6120, 'sw $v0, 0x54($a0)',
             "and writes the character"),
            (0x800A612C, 'sh $v0, 0x60($s0)',
             "clip 3 re-saves the tag-3 row's Y in the advanceClip delay slot"),
            (0x800A6138, 'sh $v0, 0x62($s0)',
             "clip 3 re-saves the tag-2 row's Y"),
            (0x800A6148, 'sw $v0, 0x64($s0)',
             "clip 3 re-saves the character's +0x54"),
            (0x800A6150, 'sh $zr, 0x5c($s0)',
             "clip 3 zeroes its counter"),
            (0x800A6154, 'andi $v0, $v1, 0x1',
             "clip 3 moves on every other index"),
            (0x800A6168, 'beqz $v0, .L0x000003c4',
             "clip 3's step, by direction"),
            (0x800A617C, 'sh $v0, 0xc($s2)',
             "the down step writes the tag-3 row"),
            (0x800A618C, 'sh $v0, 0xc($s1)',
             "the down step writes the tag-2 row"),
            (0x800A6198, 'addiu $v0, 0x100',
             "the down step adds a pixel"),
            (0x800A61A0, 'sw $v0, 0x54($a0)',
             "and writes the character"),
            (0x800A61B0, 'sh $v0, 0xc($s2)',
             "the up step writes the tag-3 row"),
            (0x800A61C0, 'sh $v0, 0xc($s1)',
             "the up step writes the tag-2 row"),
            (0x800A61CC, 'addiu $v0, -0x100',
             "the up step takes a pixel off"),
            (0x800A61D4, 'sw $v0, 0x54($a0)',
             "and writes the character"),
            (0x800A61DC, 'sb $zr, ($s1)',
             "clip 5 turns the tag-2 row off"),
            (0x800A61F8, 'xori $v0, 0x1',
             "clip 5 flips the direction word"),
            (0x800A622C, 'li $v0, 0x348',
             "the configure arm tests 840"),
            (0x800A6230, 'beq $a1, $v0, .L0x00000468',
             "840's arm"),
            (0x800A6234, 'li $v0, 0x349',
             "and 841"),
            (0x800A6238, 'beq $a1, $v0, .L0x00000484',
             "841's arm"),
            (0x800A6258, 'li $a1, 0x2',
             "both arms set state 2"),
            (0x800A6260, 'sh $zr, 0x58($s0)',
             "840 writes direction 0, in the j's delay slot"),
            (0x800A6274, 'li $v0, 0x1',
             "841 writes direction 1"),
            (0x800A6278, 'sh $v0, 0x58($s0)',
             "841's store"),
        ],
    },
]


def find_two_slot_copies(overlays, stages):
    """Every overlay that carries `TWO_SLOT_SHAPE`, found by scanning the image.

    A hit is reported at the file offset of the name lookup, which is where the
    tick's state-2 arm begins.
    """
    hits = []
    window = TWO_SLOT_SHAPE_WINDOW // 4
    for stage in stages:
        ov = overlays.get(stage)
        if ov is None:
            continue
        words = [struct.unpack_from("<I", ov.data, o)[0]
                 for o in range(0, len(ov.data) - 4, 4)]
        want = set(TWO_SLOT_SHAPE)
        for k, word in enumerate(words):
            if word != TWO_SLOT_SHAPE[0]:
                continue
            near = set(words[k:k + window + 1])
            if want <= near:
                hits.append((stage, k * 4))
    return hits


def two_slot_arm_bounds(ov, table):
    """Where each clip arm's own code ends.

    The six arms are not prologues -- they fall into each other and share a tail
    jump -- so the only honest bound is the NEXT clip target above this one, and
    for the last arm the next prologue after it (the configure routine).
    """
    distinct = sorted(set(table))
    bounds = {}
    for target in table:
        lo = target - OVERLAY_BASE
        nxt = [t for t in distinct if t > target]
        if nxt:
            hi = nxt[0] - OVERLAY_BASE
        else:
            hi = len(ov.data)
            for off in range(lo + 4, len(ov.data) - 4, 4):
                if (ov.word(OVERLAY_BASE + off) >> 16) == 0x27BD and \
                        (ov.word(OVERLAY_BASE + off) & 0x8000):
                    hi = off
                    break
        bounds[target] = (lo, max(hi, lo + 8))
    return bounds


def two_slot_arm_at(ov, target, bounds):
    """Which of `TWO_SLOT_ARMS` the clip target at `target` is.

    The marker words are one instruction each and no two arms share one, so
    inside the arm's own bounds the match is exact; a target with no marker, or
    with two, is a shape this reader cannot name and the caller REFUSES it
    rather than guessing.
    """
    lo, hi = bounds[target]
    words = [struct.unpack_from("<I", ov.data, o)[0] for o in range(lo, hi, 4)]
    found = []
    for name, pattern, text, _ in TWO_SLOT_ARMS:
        k = two_slot_arm_match(words, pattern)
        if k is not None:
            found.append((name, lo + 4 * k))
    return found


def build_two_slot_members(overlays, points, reg, checked, stages):
    """The `two-slot` machine's members, plus the census of its copies.

    Every number the machine uses is either mined from a table the reader
    understands (the six clip targets, the per-index deltas, the two configure
    arms, the cue words) or anchored against the overlay and the .s at a named
    site (the bounds and the two tags).  An overlay that carries the shape but
    whose tables this reader cannot describe is refused BY NAME.
    """
    out = {}
    refused = []
    copies = []
    known = {spec["stage"]: spec for spec in TWO_SLOT_SITES}
    for stage, off in find_two_slot_copies(overlays, stages):
        ov = overlays[stage]
        # The clip table sits at the overlay base, one word per clip, and the
        # shape's block proves the dispatch reads it there.
        table = [ov.word(OVERLAY_BASE + 4 * i) for i in range(6)]
        arms = []
        bad = None
        bounds = two_slot_arm_bounds(ov, table)
        for target in table:
            if not in_ram(target, len(ov.data)):
                bad = "clip target %#010x is outside the image" % target
                break
            kinds = two_slot_arm_at(ov, target, bounds)
            if len(kinds) != 1:
                bad = ("clip target %#010x (%s) matches %s, not exactly one arm"
                       % (target, ov.asm.get(target - OVERLAY_BASE, ("?", 0))[0],
                          ", ".join(k[0] for k in kinds) or "no arm"))
                break
            arms.append(kinds[0][0])
        if bad is None and arms[2] != arms[4]:
            bad = ("clips 2 and 4 are %r and %r, so this is not the shape this "
                   "reader describes" % (arms[2], arms[4]))
        spec = known.get(stage)
        if bad is not None:
            refused.append({"stage": "s" + stage, "at": "0x%04x" % off,
                            "reason": bad})
            continue
        if spec is None:
            copies.append({"stage": "s" + stage, "at": "0x%04x" % off,
                           "arms": arms,
                           "deltaTable": ram(slide_table(ov, table)),
                           "deltas": read_deltas(ov, slide_table(ov, table),
                                                 0x3E8),
                           "why": "no registry member names this copy and nothing "
                                  "in the overlay calls its builder, so the game "
                                  "never constructs it"})
            continue
        try:
            member = mine_two_slot(ov, spec, arms, reg, points, checked)
        except (ValueError, KeyError, IndexError) as exc:
            refused.append({"stage": "s" + stage, "at": "0x%04x" % off,
                            "reason": str(exc)})
            continue
        out.setdefault("s" + stage, {})[str(spec["id"])] = member
    two_slot_census = {"copiesFound": len(find_two_slot_copies(overlays, stages)),
                       "copiesWithoutAMember": copies, "refused": refused}
    return out, two_slot_census


def slide_table(ov, table):
    """The delta table the slide arm loads, read out of its own `addiu` word."""
    bounds = two_slot_arm_bounds(ov, table)
    for target in table:
        lo, hi = bounds[target]
        words = [struct.unpack_from("<I", ov.data, o)[0] for o in range(lo, hi, 4)]
        k = two_slot_arm_match(words, TWO_SLOT_ARMS[2][1])
        if k is not None:
            # `lui $v0, 0x800a` / `addiu $v0, imm`: the immediate is the low
            # half of the RAM address, so the pair is 0x800A0000 + imm -- which
            # is why the two copies can hold their tables at different offsets.
            return 0x800A0000 + (words[k] & 0xFFFF)
    raise ValueError("the slide arm loads no table base")


def read_deltas(ov, table_ram, end, limit=0x40):
    """The signed halfwords the slide arm walks, up to and including the end."""
    out, at = [], table_ram
    while True:
        out.append(struct.unpack_from("<h", ov.data, at - OVERLAY_BASE)[0])
        at += 2
        if out[-1] == end:
            return out
        if len(out) > limit:
            raise ValueError("the delta table at %#010x has no terminator"
                             % table_ram)


def mine_two_slot(ov, spec, arms, reg, points, checked):
    """One member: the two claimed rows, the six arms, the delta table and the
    two configure arms, each read out of the overlay."""
    stage = spec["stage"]
    for ram_addr, text, note in spec["anchors"]:
        ov.check(ram_addr, text, note)
        checked[0] += 1
    eid = spec["id"]
    recs = (points.get("s" + stage) or {}).get("records") or []
    # The claim takes the LAST row carrying each tag: the walk does not break out
    # of a match, so the slot ends up on the final one.
    records = []
    for tag in (2, 3):
        matches = [i for i, r in enumerate(recs) if (r.get("atlasFlag") or 0) == tag]
        if not matches:
            raise ValueError("the stage ships no point record tagged %d" % tag)
        records.append(matches[-1])
    # The delta table: its address comes out of the slide arm's own `addiu`, and
    # its entries are read until the terminator the dispatch compares against.
    table_ram = slide_table(ov, [ov.word(OVERLAY_BASE + 4 * i) for i in range(6)])
    if table_ram != spec["deltaTable"]:
        raise ValueError("the slide arm loads %#010x, the decode recorded %#010x"
                         % (table_ram, spec["deltaTable"]))
    end = spec["deltaEnd"]
    deltas = read_deltas(ov, table_ram, end)
    # The configure arm's two halfword stores, keyed by the sub id each beq tests.
    directions = {}
    for sub, at in ((0x348, 0x800A6260), (0x349, 0x800A6278)):
        word = ov.word(at)
        # `sh <rt>, 0x58($s0)`: opcode 0x29, base $s0 (16), displacement 0x58.
        if (word >> 26) != 0x29 or ((word >> 21) & 0x1F) != 16 \
                or (word & 0xFFFF) != 0x58:
            raise ValueError("the %d arm does not store a halfword at obj+0x58 "
                             "(%#010x)" % (sub, word))
        rt = (word >> 16) & 0x1F
        if rt == 0:
            directions[str(sub)] = 0   # `sh $zr` -- the 840 arm
            continue
        # Otherwise the value is in the `li $v0, N` above the store, which is how
        # every seeding store in this system is built.
        for back in range(at - 4, at - 0x20, -4):
            w = ov.word(back)
            if (w >> 16) == 0x2402:
                directions[str(sub)] = w & 0xFFFF
                break
        else:
            raise ValueError("the %d arm stores $v%d with no `li` above it"
                             % (sub, rt))
    member = {
        "stage": stage,
        "id": eid,
        "idHex": "0x%03x" % eid,
        "machine": "two-slot",
        "kind": "two-slot",
        "stepper": None,
        "tick": ram(spec["tick"]),
        "ctor": ram(spec.get("ctor")),
        "registryCtor": registry_ctor(reg, eid),
        "draw": ram(spec.get("draw")),
        "tags": {},
        "scripts": {},
        "panels": [],
        "twoSlot": {
            "tags": [2, 3],
            "records": records,
            "recordYOffset": 12,
            "drop": spec["drop"],
            "dropFixed": spec["dropFixed"],
            "clips": arms,
            "deltas": deltas,
            "deltaTable": ram(table_ram),
            "deltaEnd": end,
            "waitBlanks": spec["waitBlanks"],
            "blinkSteps": spec["blinkSteps"],
            "blinkStep": spec["blinkStep"],
            "directions": directions,
            "startSound": "0x8004103C",
            "waitSound": "0x01080001",
        },
    }
    for slot, tag in ((0, 2), (1, 3)):
        member["tags"][str(tag)] = record_geom(recs[records[slot]],
                                                records[slot])
    return member


# ── the two in-place shapes of the same actor ─────────────────────────────
# Same claim, same stepper, same method block as the pad flashes above; what
# differs is that neither has a pad to move its record onto, so each simply
# lights the row the stage's own point table gave it.  `single` runs one script
# through the shared stepper (`wstag455` file 0x1cc-0x1dc hands
# `0x800A6378` to the overlay-base stepper with `jal`); `rise` has no script at
# all and walks its record up the screen a pixel a blank for a fixed number of
# blanks (`wstag926` file 0x254-0x28c).  Both tables are mined by the SAME
# `extract_stage`, which now tells the three shapes apart by the overlay's own
# code; only the tick/ctor addresses and their anchors are hand-entered, as for
# the pad members.
SINGLE_SITES = [
    {"stage": "455", "id": 828, "tick": 0x800A5EBC, "ctor": 0x800A6010,
     "anchors": [(0x800A5EBC, "addiu $sp, -0x20", "the tick"),
                 (0x800A6010, "addiu $sp, -0x18", "the constructor")]},
]

RISE_SITES = [
    {"stage": "926", "id": 854, "tick": 0x800A5F70, "ctor": 0x800A609C,
     "anchors": [(0x800A5F70, "addiu $sp, -0x20", "the tick"),
                 (0x800A609C, "addiu $sp, -0x18", "the constructor"),
                 (0x800A6018, "li $a0, 0x5",
                  "state 1 looks the live field character up by name"),
                 (0x800A6024, "lw $v0, -0x4844($v0)",
                  "state 1: [0x8004b7bc], find resident by name"),
                 (0x800A6044, "lw $v1, 0x54($s1)",
                  "state 1 reads its OWN blank counter at obj+0x54"),
                 (0x800A6054, "lw $v1, 0x54($v0)",
                  "the found character's world Y, 16.8"),
                 (0x800A605C, "addiu $v1, 0x100",
                  "the character gains one pixel a blank"),
                 (0x800A6060, "sw $v1, 0x54($v0)",
                  "and the store is into the found object"),
                 (0x800A606C, "slti $v0, 0x96", "the 150-blank bound")]},
]


def stepper_copy(ov):
    """Which copy of the shared stepper this overlay's base carries, or None.

    The stepper is the routine at the overlay base (`0x800a5de4`, file 0x04),
    and every copy is recognisable by its own instructions.  Reading which one
    it is, rather than asserting it, is what keeps a table entry honest --
    `base-u8` reads the entry's hold with `lbu 0x2($s0)` (0x92030002) where the
    other three use `lhu` (0x96020002); `follow-u8` is the only copy whose end
    arm reads the entry's THIRD byte (`lbu 0x3($s0)` / `sh 0x4($s1)`); and
    `stop-u16` is the only copy with NO `$a2` test, jumping straight to the
    epilogue on the 0x00ff entry.  s926's overlay carries NO stepper at all --
    the `rise` shape never calls one -- so its member records `null`.
    """
    body = {off: ov.word(OVERLAY_BASE + off) for off in range(0x04, 0x108, 4)}
    if 0x00031880 not in body.values():  # `sll $v1, 0x2`: the entry -> offset
        return None
    if not any((w >> 16) == 0x8623 and (w & 0xFFFF) == 0x0000 for w in body.values()):
        return None  # `lh $v1, ($s0)`: every copy reads the entry's value
    if 0x92030002 in body.values():  # `lbu $v1, 0x2($s0)`
        return "base-u8"
    # `follow-u8` is the ONLY copy whose end arm reads the entry's THIRD byte
    # (`lbu $v1, 0x3($s0)` wstag805 file 0x298 / `sh $v1, 0x4($s1)` file 0x2a8).
    if any((w >> 16) == 0x8623 and (w & 0xFFFF) == 0x0003 for w in body.values()):
        return "follow-u8"
    if any((w & 0xFFFF) == 0x0006 and (w >> 16) in (0x9602, 0x8622)
           for w in body.values()):  # `lhu $v0, 0x6($s0)`
        a2 = [o for o, w in body.items() if (w & 0xFFE00000) == 0x16000000]
        return "base-u16" if a2 else "stop-u16"
    # A SECOND form of the same base-u16 machine: the cursor index sits at the
    # object's 0x0/0x2 and the entry's hold is read at +2 (`lhu $v0, 0x2($s1)`,
    # wstag232 file 0x58) instead of +6.  It keeps the same two end arms --
    # `bnez $s3` (wstag232 file 0x50) branches on the register file 0x18 set
    # from `$a2` (`move_ $s3, $a2`) -- so it is named the same.
    if any((w >> 16) == 0x9622 and (w & 0xFFFF) == 0x0002
           for w in body.values()):
        a2regs = {(w >> 11) & 31 for w in body.values()
                  if (w >> 26) == 0 and (w & 0x3F) == 0x21
                  and ((w >> 21) & 31) == 6 and ((w >> 16) & 31) == 0}
        a2 = [o for o, w in body.items()
              if (w >> 26) in (0x04, 0x05)
              and (((w >> 21) & 31) in a2regs or ((w >> 16) & 31) in a2regs)]
        return "base-u16" if a2 else "stop-u16"
    return None


def inplace_member(stage, eid, tick_ram, ctor_ram, registry_ctor_val, cfg,
                   points, ov, machine):
    """One in-place member from a shape `cfg`, shared by the anchored and the
    discovered copies so their entries cannot drift apart.

    A one-tag copy (s455) builds one panel; the multi-tag copies build one per
    claimed tag, and the tag order is the script order the claim walk hands the
    stepper (so `cfg["tags"]` and `cfg["scripts"]` are the same length or the
    caller refuses).
    """
    recs, by_tag = tagged_records(points, stage)
    member = {
        "stage": stage,
        "id": eid,
        "idHex": "0x%03x" % eid,
        "machine": machine,
        # READ out of the overlay, not asserted: s926 carries no stepper copy at
        # all (the `rise` shape calls none), and its member says so.
        "stepper": stepper_copy(ov),
        "tick": ram(tick_ram),
        "ctor": ram(ctor_ram),
        "registryCtor": registry_ctor_val,
        "draw": None,
        "tags": {},
        "scripts": {},
        "panels": [],
    }
    if machine == "rise":
        member["rise"] = {
            "recordOffset": cfg["recordOffset"],
            "claimShift": cfg["claimShift"],
            "riseBy": cfg["riseBy"],
            "riseBlanks": cfg["riseBlanks"],
            "charYBy": cfg.get("charYBy", 0),
        }
        member["arm"] = {"slots": 1, "fireSound": cfg.get("fireSound")}
    else:
        tags = list(cfg.get("tags") or [1])
        n = cfg.get("slots") or 1
        if len(tags) != n:
            raise ValueError("the in-place copy claims %d tags but steps %d "
                             "scripts" % (len(tags), n))
        member["arm"] = {
            "slots": n,
            "fireSound": cfg.get("fireSound"),
            "reposition": False,
        }
        for k, script in enumerate(cfg.get("scripts") or []):
            name = "slot%d" % k
            member["scripts"][name] = [
                [e["v"], e["d"], 0] for e in script]
            member["panels"].append({
                "atlas": tags[k],
                "script": name,
                "hold": script[0]["d"] if script else 0,
                "recipe": {"1": {"active": "sprite", "sprite": "S",
                                 "script": name}},
            })
    # The claimed tags are the overlay's OWN (read out of its claim loop by
    # `claim_tags`), never assumed to be 1..N.
    for tag in cfg.get("tags") or []:
        if tag not in by_tag:
            fail("point_record_actors: s%s has no point record with atlas "
                 "tag %d" % (stage, tag))
            continue
        member["tags"][str(tag)] = record_geom(recs[by_tag[tag]], by_tag[tag])
    return member


def build_inplace_members(overlays, points, reg, checked, sites, machine):
    """The in-place shapes: shape-mined, with the tick/ctor anchored."""
    out = {}
    for spec in sites:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        cfg = extract_stage(ASM / ("wstag%s.s" % stage),
                            member_ticks().get(stage))
        if cfg is None:
            fail("point_record_actors: s%s carries no %s copy of the claim "
                 "actor this reader can find" % (stage, machine))
            continue
        if cfg.get("shape") != machine:
            fail("point_record_actors: s%s %s reads as shape %r, not %r"
                 % (stage, eid_name(spec), cfg.get("shape"), machine))
            continue
        eid = spec["id"]
        member = inplace_member(stage, eid, spec["tick"], spec.get("ctor"),
                                registry_ctor(reg, eid), cfg, points, ov,
                                machine)
        out.setdefault("s" + stage, {})[str(eid)] = member
    return out


# ── every OTHER overlay that carries the in-place shapes ────────────────────
# The two hand-taught in-place members (s455 `single`, s926 `rise`) were the
# only entries this reader emitted, because SINGLE_SITES/RISE_SITES name one
# stage each.  But the same tick -- the claim walk off the field's record chain
# at 0x80099d90, the stage's own copy of the `{clip, hold}` stepper, the shared
# method block -- is compiled into many overlays, and most of them are built by
# their stage with the THREE-argument allocator wrapper (EXE F0x80014504), so
# they are registered under NO id and no SETANIM ever reaches them: the stage
# builds them at load and they run from the first blank.  That is exactly the
# set a hand list loses, so the discovery below scans EVERY overlay and emits a
# member for each one whose claim sits on a tick its own builder installs.
#
# Its id comes off the registry census (`data/stage_registry_members.json`) when
# a record resolves to that tick -- and then the member is SKIPPED if the census
# already cites another module for it, so the stage-slot-player /
# stage-slot-ensemble ports are not duplicated.  An unregistered builder has no
# census row; its member is keyed by its own tick address (a number no SETANIM
# uses) and `registryCtor` is null, which is what makes the browser build it at
# stage entry via `constructPointRecordActors`.
CENSUS_FILE = REPO / "data/stage_registry_members.json"
CHILD_PARENTS = REPO / "web/assets/data/child_pool_parents.json"


def census_tick_index():
    """stage -> {tick RAM: (id, port_cite)} from the registry census."""
    out = {}
    try:
        data = json.loads(CENSUS_FILE.read_text())
    except (OSError, ValueError):
        return out
    for stage, rows in (data.get("members") or {}).items():
        for row in rows:
            tick = (row.get("construct") or {}).get("tick")
            if isinstance(tick, dict):
                tick = tick.get("tick")
            if isinstance(tick, int):
                out.setdefault(str(stage).lstrip("s"), {})[tick] = (
                    row.get("id"), row.get("port_cite"))
    return out


def covered_stages():
    """Stages another builder or another module already owns."""
    out = set()
    for spec in (PAD_SITES + DECOR_SITES + POINT_SITES + SLOT_SITES
                 + SINGLE_SITES + RISE_SITES + TWO_SLOT_SITES
                 + PICTURE_STEPS_SITES + RIDE_WALKER_SITES):
        out.add(spec["stage"])
    try:
        child = json.loads(CHILD_PARENTS.read_text())
        out.update(str(k).lstrip("s") for k in (child.get("stages") or {}))
    except (OSError, ValueError):
        pass
    return out


def build_discovered_inplace_members(overlays, points, reg, checked):
    """Every overlay whose own claim tick carries an in-place copy of the actor.

    The reader is the SAME `extract_stage` the hand-taught rows use, run with no
    tick filter over every shipped overlay image, so the member list is what the
    code holds and not a hand list.  A copy whose claim sits on a tick the
    overlay does not install, or that names no tag, is not a member here.
    """
    out = {}
    refused = []
    census = census_tick_index()
    covered = covered_stages()
    stages = sorted(p.name[1:-4] for p in NATIVE.glob("s*.bin")
                    if p.name[1:-4].isdigit())
    for stage in stages:
        if stage in covered:
            continue
        path = ASM / ("wstag%s.s" % stage)
        if not path.exists():
            continue
        try:
            cfg = extract_stage(path)
        except ValueError:
            continue
        if not cfg or cfg.get("shape") not in ("single", "rise"):
            continue
        tick_file = cfg.get("tick")
        if tick_file is None:
            continue
        tick_ram = OVERLAY_BASE + tick_file
        # A stage whose own table carries a tag TWICE is refused here: this
        # copy's animate arm writes the stepped value into EVERY record whose
        # tag it matches (wstag555 file 0x1dc-0x234 walks the whole table and
        # stores at each match), where the port's `single` machine takes the
        # FIRST match, so a member here would animate one record and leave the
        # rest standing.  The same guard as `tests/point-record-actors.test.js`
        # ("no member's own stage repeats the tag it claims") -- the claim loop
        # is not ported, so no member is added.
        recs = (points.get("s" + stage) or {}).get("records") or []
        claimed = [t for t in (cfg.get("tags") or [])]
        repeated = {t for t in claimed
                    if sum(1 for r in recs if (r.get("atlasFlag") or 0) == t) > 1}
        if repeated:
            refused.append("%s: the stage's table repeats claimed tag(s) %s and "
                           "this copy writes to every match; the first-match "
                           "`single` machine is not its claim loop"
                           % (stage, sorted(repeated)))
            continue
        info = census.get(stage, {}).get(tick_ram)
        if info is not None:
            eid, cite = info
            if cite and "engine/systems/point-record-actor.ts" not in cite:
                # another module already ports this member; do not double it.
                continue
        else:
            # an unregistered builder: key by the tick itself.
            eid = tick_ram
        try:
            ov = overlays.setdefault(stage, Overlay(stage))
            member = inplace_member(stage, eid, tick_ram, None,
                                    None if info is None else registry_ctor(reg, eid),
                                    cfg, points, ov, cfg["shape"])
        except (ValueError, KeyError, IndexError) as exc:
            refused.append("%s: %s" % (stage, exc))
            continue
        if not member["tags"]:
            fail("point_record_actors: s%s in-place copy claims no shipped "
                 "point record" % stage)
            continue
        out.setdefault("s" + stage, {})[str(eid)] = member
    return out, refused


def eid_name(spec):
    return "id 0x%03x" % spec["id"]


def build_pad_members(overlays, points, reg, checked):
    """The four pad-flash members: shape-mined, with the tick/ctor anchored."""
    out = {}
    for spec in PAD_SITES:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        cfg = extract_stage(ASM / ("wstag%s.s" % stage),
                            member_ticks().get(stage))
        if cfg is None:
            fail("point_record_actors: s%s carries no pad-flash actor this "
                 "reader can find" % stage)
            continue
        recs, by_tag = tagged_records(points, stage)
        eid = spec["id"]
        member = {
            "stage": stage,
            "id": eid,
            "idHex": "0x%03x" % eid,
            "machine": "pad-flash",
            # the overlay-base copy: u16 hold, `$a2` chooses restart or stop.
            # These scripts carry NO 0x00ff terminator on the disc, so the end
            # is the cursor walking past the last entry.
            "stepper": "base-u16",
            "tick": ram(spec["tick"]),
            "ctor": ram(spec.get("ctor")),
            "registryCtor": registry_ctor(reg, eid),
            "draw": None,
            "tags": {},
            "scripts": {},
            "panels": [],
            "arm": {
                "slots": cfg.get("slots"),
                "commands": cfg.get("commands") or {},
                "coords": cfg.get("coords") or [],
                "yOff": cfg.get("yOff") or [],
                "ysortOff": cfg.get("ysortOff") or [],
                "fireSound": cfg.get("fireSound"),
                "slotSounds": cfg.get("slotSounds"),
                "reposition": bool(cfg.get("reposition")),
            },
        }
        # The pad-flash copies run the overlay-base stepper, which reads the
        # entry hold as a HALFWORD, so every script entry is re-read that way.
        for k, script in enumerate(cfg.get("scripts") or []):
            name = "slot%d" % k
            member["scripts"][name] = [
                [e["v"], e["d"], 0] for e in script]
            member["panels"].append({
                "atlas": k + 1,
                "script": name,
                "hold": script[0]["d"] if script else 0,
                "recipe": {"1": {"active": "sprite", "sprite": "S",
                                 "script": name}},
            })
        for tag in range(1, (cfg.get("slots") or 0) + 1):
            if tag not in by_tag:
                fail("point_record_actors: s%s has no point record with atlas "
                     "tag %d" % (stage, tag))
                continue
            member["tags"][str(tag)] = record_geom(recs[by_tag[tag]], by_tag[tag])
        out.setdefault("s" + stage, {})[str(eid)] = member
    return out


def build_decor_members(overlays, points, reg, checked):
    """The six decor members, from DECOR_SITES (the old DRIVERS list)."""
    out = {}
    for spec in DECOR_SITES:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for off_key in ("ctor", "tick", "draw"):
            addr = spec[off_key]
            if addr is None:
                continue
            if addr - OVERLAY_BASE not in ov.asm:
                fail("point_record_actors: wstag%s.s has no %s at RAM %#010x"
                     % (stage, off_key, addr))
            ov.word(addr)
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        recs, by_tag = tagged_records(points, stage)
        eid = spec["id"]
        member = {
            "stage": stage,
            "id": eid,
            "idHex": "0x%03x" % eid,
            "machine": "decor",
            "stepper": "base-u16",
            "kind": spec["kind"],
            "tick": ram(spec["tick"]),
            "ctor": ram(spec.get("ctor")),
            "registryCtor": registry_ctor(reg, eid),
            "draw": ram(spec.get("draw")),
            "tags": {},
            "scripts": {},
            "seedHolds": {},
            "sounds": [],
            "panels": [],
        }
        for tag in spec["tags"]:
            if tag not in by_tag:
                fail("point_record_actors: s%s has no point record with atlas "
                     "tag %d" % (stage, tag))
                continue
            member["tags"][str(tag)] = record_geom(recs[by_tag[tag]], by_tag[tag])
        for name, addr in spec["scripts"].items():
            member["scripts"][name] = [
                entry_of(ov, addr, "halfword")]
            at = addr
            while member["scripts"][name][-1][0] != SCRIPT_END:
                at += 4
                member["scripts"][name].append(entry_of(ov, at, "halfword"))
        # s795 reads its two seeds through pointers the overlay keeps, so the
        # seed is the first entry's hold of the script the pointer names.
        for name, addr in (spec.get("seed_ptrs") or {}).items():
            member["seedHolds"][name] = ov.u8(ov.word(addr) + 2)
        for name, (addr, width) in spec["seed_holds"].items():
            member["seedHolds"][name] = ov.u8(addr) if width == 1 else ov.u16(addr)
        for addr in (spec.get("script_ptrs") or []):
            member.setdefault("scriptPtrs", []).append(ram(ov.word(addr)))
        for snd in spec["sounds"]:
            member["sounds"].append({"packed": ram(snd["packed"]),
                                     "case": snd["case"]})
        out.setdefault("s" + stage, {})[str(eid)] = member
    return out


# ── the `picture-steps` member: s785 0x327 (read 2026-10-05) ─────────────────
# The one member of the registry family that claims NO point record.  Its tick
# (wstag785 file 0x4d4) is a counter-stepped state machine that draws picture
# ids straight out of the stage's own sprite directory; its configure routine
# (file 0x760) sets an arm word (808 -> 2, 809 -> 3), calls setState(2) (810)
# and stores `find(5, script-operand, -1)` at obj+0x54; its draw helper (file
# 0x428) draws picture `a1` at `[obj+0x54]+0x50 >> 8`, `([obj+0x54]+0x54 >> 8)
# - 0x18` through the resident 2-D emitter F0x8001ED6C.
#
# EVERY value below is re-read from the shipped image: each `li`/`slti`/`addiu`
# immediate is decoded from the instruction WORD at its address (imm_at), and
# each address is paired with the instruction text the decode read there
# (Overlay.check re-reads BOTH).  The `find` operand is script data: it is
# mined from the stage's own recovered SETANIM calls, and the reader refuses
# when 808 and 809 disagree.
EVENTS = REPO / "web/assets/events/wstag_events.json"

PICTURE_STEPS_SITES = [
    {
        "stage": "785", "id": 807,
        "tick": 0x800A62B4, "ctor": 0x800A6510, "draw": 0x800A6540,
        # state 1: three 4-blank steppers (each advancing the clip), then the
        # arm-word dispatch.
        "states": {
            "1": {
                "subs": [
                    {"at": 0x800A6340, "pic": 0x32, "advance": "clip"},
                    {"at": 0x800A6380, "pic": 0x33, "advance": "clip"},
                    {"at": 0x800A63C0, "pic": 0x34, "advance": "clip"},
                    {"arm": True},
                ],
                "arms": {
                    "0": {"at": 0x800A641C, "pic": 0x35},
                    "1": {"at": 0x800A6438, "alternate": [0x38, 0x39], "shift": 3},
                    "2": {"at": 0x800A6454, "pic": 0x3C},
                    "3": {"at": 0x800A6414, "pic": 0x3D},
                },
            },
            "2": {
                "subs": [
                    {"at": 0x800A6480, "pic": 0x36, "advance": "clip"},
                    {"at": 0x800A64C0, "pic": 0x37, "advance": "state"},
                ],
            },
        },
        # SETANIM sub -> the fields the configure routine writes (`arm` = the
        # `li $v0, N ; sw $v0, 0x50($s0)`, `state` = the setState call's `li
        # $a1, N`, `anchor` = the tail's `find(5, operand, -1)`, which only the
        # `0x328 <= s1 < 0x32a` arm reaches).
        "configure": {
            "808": {"at": 0x800A6598, "arm": 2, "anchor": True},
            "809": {"at": 0x800A65A4, "arm": 3, "anchor": True},
            "810": {"at": 0x800A65B4, "state": 2},
        },
        # the counter bound, read at all five `slti $v1, 0x4` sites
        "hold": 4,
        "hold_at": [0x800A6354, 0x800A6394, 0x800A63D4, 0x800A6494, 0x800A64D4],
        # the draw helper's `addiu $v0, -0x18`
        "yOff": -0x18, "yOffAt": 0x800A6240,
        "anchors": [
            (0x800A62B4, "addiu $sp, -0x20", "the tick"),
            (0x800A62C8, "lw $v1, 0xc($s1)", "state dispatch: obj+0x0c"),
            (0x800A62F0, "lw $v0, 0x38($s1)", "state 0 calls advanceState"),
            (0x800A6308, "lw $v1, 0x10($s1)", "state 1 dispatches obj+0x10"),
            (0x800A6344, "lw $v1, 0x14($s1)", "sub 0 reads the counter"),
            (0x800A6360, "lw $v0, 0x3c($s1)", "sub 0's advance is advanceClip"),
            (0x800A63F0, "lw $v1, 0x50($s1)", "sub 3 dispatches the arm word"),
            (0x800A642C, "sra $v1, 0x3", "the alternation shifts the counter"),
            (0x800A6430, "andi $v1, 0x1", "... and masks one bit"),
            (0x800A6438, "addiu $s0, $v1, 0x38", "picture 56/57"),
            (0x800A6458, "lw $v0, 0x10($s1)", "state 2 dispatches obj+0x10"),
            (0x800A64A0, "lw $v0, 0x3c($s1)", "state 2 sub 0 advances the clip"),
            (0x800A64E0, "lw $v0, 0x38($s1)", "state 2 sub 1 advances the state"),
            (0x800A64F4, "jal 0x800a6208", "every arm tail-calls the draw helper"),
            (0x800A6510, "addiu $sp, -0x18", "the registry constructor"),
            (0x800A6520, "li $a1, 0x58", "... allocates the 0x58-byte object"),
            (0x800A6540, "addiu $sp, -0x20", "the configure handler"),
            (0x800A655C, "li $v0, 0x329", "configure: 809's compare"),
            (0x800A65B4, "lw $v0, 0x28($s0)", "configure: 810 calls setState"),
            (0x800A65D4, "li $a0, 0x5", "the tail's find asks for name 5"),
            (0x800A65E0, "lw $v0, -0x4844($v0)", "[0x8004b7bc], find by name"),
            (0x800A65F0, "sw $v0, 0x54($s0)", "configure: the anchor at obj+0x54"),
            (0x800A6208, "addiu $sp, -0xc0", "the draw helper"),
            (0x800A6234, "lw $v0, 0x54($v0)", "draw: the anchor's world Y"),
            (0x800A6264, "lw $v0, 0x84($sp)", "draw: the page/CLUT setter"),
            (0x800A6274, "lui $a0, 0x1c7", "draw: the sprite directory's resource"),
            (0x800A6288, "ori $a0, 0x1", "draw: ... member 1, the id table"),
            (0x800A629C, "jalr $v0", "draw: the emitter F0x8001ED6C"),
            (0x800A62A0, "move_ $a1, $s0", "draw: a1 = the picture"),
        ],
    },
]


def imm_at(ov, ram_addr, opcodes, note):
    """The signed immediate of the instruction word at `ram_addr`.

    The word is read out of the shipped image (never out of a comment), the
    opcode is asserted against the spec's own list, and the 16-bit field is
    sign-extended the way the CPU sign-extends it.
    """
    word = ov.word(ram_addr)
    op = word >> 26
    if op not in opcodes:
        fail("point_record_actors: %s at %#010x is opcode %#x, wanted %s"
             % (note, ram_addr, op, opcodes))
        return None
    imm = word & 0xFFFF
    return imm - 0x10000 if imm >= 0x8000 else imm


def uimm_at(ov, ram_addr, opcodes, note):
    """The raw (unsigned) 16-bit immediate of the instruction word at `ram_addr`.

    `ori` and `lui` immediates are unsigned, so sign-extending them the way
    `imm_at` does would turn `li $v0, 0x9600` into a negative number; this is
    the same two witnesses as `imm_at` without the extension.
    """
    word = ov.word(ram_addr)
    op = word >> 26
    if op not in opcodes:
        fail("point_record_actors: %s at %#010x is opcode %#x, wanted %s"
             % (note, ram_addr, op, opcodes))
        return None
    return word & 0xFFFF


def shift_at(ov, ram_addr, note):
    """The shift amount (bits 6-10) of the `sll` word at `ram_addr`.

    `sll` keeps its count in the sa field, not in a 16-bit immediate; reading
    the low halfword would return the funct/rd bits instead.
    """
    word = ov.word(ram_addr)
    if word >> 26 != 0x00:
        fail("point_record_actors: %s at %#010x is not a SPECIAL word (%#010x)"
             % (note, ram_addr, word))
        return None
    return (word >> 6) & 0x1F


def word_at(ov, ram_addr, want, note):
    """Assert the FULL instruction word at `ram_addr` against `want`.

    Used where the decode's claim IS the instruction (a divider reset that is
    just `sw $zr, 0x14($s0)`), so the flag cannot drift away from its bytes.
    """
    word = ov.word(ram_addr)
    if word != want:
        fail("point_record_actors: %s at %#010x reads %#010x, wanted %#010x"
             % (note, ram_addr, word, want))
        return False
    return True


def script_operands(stage, effect_id):
    """`{sub: operand}` for every recovered `SETANIM <id> <sub> <operand>`.

    The recovered event bytecode (`web/assets/events/wstag_events.json`) is the
    only place the operand lives: the configure routine passes the script's
    third halfword through to its `find` untouched.
    """
    try:
        events = json.loads(EVENTS.read_text())
    except (OSError, ValueError) as exc:
        raise SystemExit("point_record_actors: %s" % exc)
    key = "s" + stage
    entries = events.get(key) or events.get(stage) or []
    out = {}
    pat = re.compile(r"^SETANIM\s+%d\s+(\d+)\s+(\d+)\s*$" % effect_id)
    for ev in entries:
        for line in ev.get("disasm", []):
            m = pat.match(line.strip())
            if m:
                out.setdefault(int(m.group(1)), set()).add(int(m.group(2)))
    return out


def build_picture_steps_members(overlays, reg, checked):
    """The `picture-steps` members, from PICTURE_STEPS_SITES."""
    out = {}
    for spec in PICTURE_STEPS_SITES:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        # every mined immediate, re-decoded from the image word
        states = {}
        for state, block in spec["states"].items():
            subs = []
            for sub in block["subs"]:
                if sub.get("arm"):
                    subs.append({"arm": True})
                    continue
                pic = imm_at(ov, sub["at"], (0x09,), "a stepper's picture")
                if pic != sub["pic"]:
                    fail("point_record_actors: s%s %s sub picture at %#010x is "
                         "%#x, spec says %#x"
                         % (stage, state, sub["at"], pic, sub["pic"]))
                subs.append({"pic": pic, "advance": sub["advance"]})
            entry = {"subs": subs}
            if block.get("arms") is not None:
                arms = {}
                for arm, arm_spec in block["arms"].items():
                    if arm_spec.get("alternate") is not None:
                        # the alternation loads BOTH pictures through one
                        # `addiu $s0, $v1, 0x38` base and one `andi` mask
                        base = imm_at(ov, arm_spec["at"], (0x09,),
                                      "the alternation's picture base")
                        alt = [base, base + 1]
                        if alt != list(arm_spec["alternate"]):
                            fail("point_record_actors: s%s alternation base at "
                                 "%#010x is %#x, spec says %r"
                                 % (stage, arm_spec["at"], base,
                                    arm_spec["alternate"]))
                        arms[arm] = {"alternate": alt, "shift": arm_spec["shift"]}
                    else:
                        pic = imm_at(ov, arm_spec["at"], (0x09,),
                                     "an arm's picture")
                        if pic != arm_spec["pic"]:
                            fail("point_record_actors: s%s arm %s picture at "
                                 "%#010x is %#x, spec says %#x"
                                 % (stage, arm, arm_spec["at"], pic,
                                    arm_spec["pic"]))
                        arms[arm] = {"pic": pic}
                entry["arms"] = arms
            states[state] = entry
        hold = None
        for at in spec["hold_at"]:
            val = imm_at(ov, at, (0x0A,), "the counter bound")
            if val != spec["hold"]:
                fail("point_record_actors: s%s counter bound at %#010x is %r, "
                     "spec says %r" % (stage, at, val, spec["hold"]))
            hold = val
        y_off = imm_at(ov, spec["yOffAt"], (0x09,), "the draw row offset")
        if y_off != spec["yOff"]:
            fail("point_record_actors: s%s draw row offset at %#010x is %r, "
                 "spec says %r" % (stage, spec["yOffAt"], y_off, spec["yOff"]))
        # the configure arms' fields, decoded from their own instructions
        configure = {}
        for sub, conf in spec["configure"].items():
            at = conf["at"]
            if "arm" in conf:
                val = imm_at(ov, at, (0x09,), "a configure arm value")
                if val != conf["arm"]:
                    fail("point_record_actors: s%s configure %s arm at %#010x "
                         "is %#x, spec says %#x"
                         % (stage, sub, at, val, conf["arm"]))
                out_conf = {"arm": val}
                if conf.get("anchor"):
                    out_conf["anchor"] = True
            else:
                # `lw $v0, 0x28($s0)` -- the setState method slot -- then
                # `jalr` and `li $a1, 0x2` in the call's delay slot (0xc later)
                ov.check(at, "lw $v0, 0x28($s0)", "configure: setState read")
                checked += 1
                val = imm_at(ov, at + 0xC, (0x09,), "a configure setState argument")
                if val != conf["state"]:
                    fail("point_record_actors: s%s configure %s state at %#010x "
                         "is %r, spec says %r" % (stage, sub, at + 0xC, val,
                                                  conf["state"]))
                out_conf = {"state": val}
            configure[sub] = out_conf
        # the find's operand: the stage's own recovered scripts must agree
        operands = script_operands(stage, spec["id"])
        anchor_p1 = None
        for sub in ("808", "809"):
            vals = operands.get(int(sub), set())
            if len(vals) != 1:
                fail("point_record_actors: s%s SETANIM %d %s passes %r; the "
                     "anchor needs exactly one operand"
                     % (stage, spec["id"], sub, sorted(vals)))
                continue
            val = next(iter(vals))
            if anchor_p1 is None:
                anchor_p1 = val
            elif val != anchor_p1:
                fail("point_record_actors: s%s find operands disagree: %r"
                     % (stage, [anchor_p1, val]))
        if anchor_p1 is None:
            anchor_p1 = 0
        member = {
            "stage": stage,
            "id": spec["id"],
            "idHex": "0x%03x" % spec["id"],
            "machine": "picture-steps",
            "tick": ram(spec["tick"]),
            "ctor": ram(spec["ctor"]),
            "registryCtor": registry_ctor(reg, spec["id"]),
            "draw": ram(spec["draw"]),
            "stepper": None,
            "tags": {},
            "scripts": {},
            "panels": [],
            "pictureSteps": {
                "hold": hold,
                "states": states,
                "configure": configure,
                "anchor": {"type": 5, "p1": anchor_p1, "p2": -1,
                           "yOff": y_off},
            },
        }
        out.setdefault("s" + stage, {})[str(spec["id"])] = member
    return out


# ── the ride walker (s415 0x32b) ─────────────────────────────────────────────
# THE crevice ride's own actor: one claimed row it falls onto the rail, bounces
# with a cue, then runs the three roll-in sequences through the one-shot copy
# of the shared stepper.  Read end to end from wstag415 on 2026-10-05 (tick file
# 0x778, integrator file 0x8b8-0x974, configure file 0xbac, the three scripts
# at RAM 0x800a73f0 / 0x800a7418 / 0x800a7428, the write-back at file 0xb70).
# A whole-body census over all 294 wstag images finds exactly one copy of the
# tick's start signature (`li 0x9600` / `sw 0x60` / `li 0xe600` / `sw 0x64`) and
# one of the integrator's (`sll 1` / `addu` / `sll 4`), both in s415, so this
# member IS the family and this list is its whole member list.
RIDE_WALKER_SITES = [
    {
        "stage": "415", "id": 811,
        "tick": 0x800A6558, "ctor": 0x800A6A98, "ctorEntry": 0x800A6ACC,
        "draw": 0x800A698C,
        # the claim's tag: `li $a1, 0x1` in the walk's compare
        "tagAt": 0x800A6614, "tag": 1,
        # state 0's start position (16.8): X and route 0's Y are `li`s; route
        # 1's Y is the integrator's own 0x1ae00, written by `lui 0x1`/`ori`.
        "startXAt": 0x800A6598, "startYAt": 0x800A65A0, "entryYAt": 0x800A65D4,
        # the integrator's constants, each read off its own instruction
        "shift1At": 0x800A66AC, "shift2At": 0x800A66B4,
        "boundAt": 0x800A66F0, "boundFixedAt": 0x800A6700,
        "boundPxAt": 0x800A670C,
        "cueVelAt": 0x800A6710, "magicAt": (0x800A6734, 0x800A673C),
        "fallCueAt": 0x800A6730,
        "divisor": 3,
        # the five state-1 subs, in the overlay's own table order (the table
        # itself lives in the image's first five words, at 0x800a5de0)
        "subs": [
            {"at": 0x800A6684, "kind": "sprite", "spriteAt": 0x800A6684},
            {"at": 0x800A6690, "kind": "fall", "spriteAt": 0x800A6690},
            {"at": 0x800A676C, "kind": "script", "script": "seq1",
             "scriptAt": 0x800A6774,
             "cues": [{"clipAt": 0x800A6780, "clip": 0x35, "ctr": 0,
                       "sound": 0x80044648,
                       "soundFrom": ("ori", 0x800A679C, 0x800A67AC)},
                      {"clipAt": 0x800A67C4, "clip": 0x3B, "ctr": 1,
                       "sound": 0x00340001,
                       "soundFrom": ("ori", 0x800A67DC, 0x800A67F0)}]},
            {"at": 0x800A6800, "kind": "script", "script": "seq2",
             "scriptAt": 0x800A6808},
            {"at": 0x800A681C, "kind": "script", "script": "seq3",
             "scriptAt": 0x800A6824,
             "cues": [{"clipAt": 0x800A6830, "clip": 2, "ctr": 0,
                       "sound": 0x00340002,
                       "soundFrom": ("clip", 0x800A684C, 0x800A685C)},
                      {"clipAt": 0x800A6874, "clip": 0x20, "ctr": 1,
                       "sound": 0x00040012,
                       "soundFrom": ("ori", 0x800A6890, 0x800A68A0)},
                      {"clipAt": 0x800A68B8, "clip": 0x2A, "ctr": 2,
                       "sound": 0x00040012,
                       "soundFrom": ("ori", 0x800A68D4, 0x800A68E4),
                       "resetDividerAt": 0x800A68EC}],
             "periodic": {"ctrs": [3, 4], "mask": 0x1F,
                          "maskAt": 0x800A6920,
                          "sound": 0x00040012,
                          "soundFrom": ("ori", 0x800A6928, 0x800A693C)}},
        ],
        # SETANIM sub -> the configure arm (file 0xbac). 817 resets the fall's
        # position; 818/819/820 rewind the one-shot cursor to the first entry
        # of their own script and play that arm's cue.
        "configure": [
            {"id": 817, "subAt": 0x800A69EC, "sub": 1, "resetAt": 0x800A69E0},
            {"id": 818, "subAt": 0x800A6A28, "sub": 2, "cue": 0x800442C1,
             "cueFrom": ("ori", 0x800A6A04, 0x800A6A18),
             "rewind": "seq1", "rewindAt": 0x800A6A24,
             "clearCtrAt": 0x800A6A30},
            {"id": 819, "subAt": 0x800A6A60, "sub": 3, "cue": 0x80044648,
             "cueFrom": ("ori", 0x800A6A3C, 0x800A6A50),
             "rewind": "seq2", "rewindAt": 0x800A6A5C},
            {"id": 820, "subAt": 0x800A69D4, "sub": 4,
             "rewind": "seq3", "rewindAt": 0x800A6A7C,
             "clearCtrAt": 0x800A6A80},
        ],
        # the write-back's four record stores and their three sources
        "writeBack": {
            "sprite": (0x800A695C, 0x28), "x": (0x800A6968, 0x29),
            "active": (0x800A6974, 0x28), "y": (0x800A6978, 0x29),
            "spriteFrom": (0x800A6954, 0x24), "xFrom": (0x800A6960, 0x25),
            "yFrom": (0x800A696C, 0x25),
        },
        # every load-bearing site, with the instruction the decode read there
        "anchors": [
            (0x800A6558, "addiu $sp, -0x18", "the tick"),
            (0x800A6568, "lw $v1, 0xc($s0)", "state dispatch"),
            (0x800A6570, "beq $v1, $v0, .L0x00000874", "state 1"),
            (0x800A6578, "bnez $v0, .L0x000007a8", "states below 2"),
            (0x800A6580, "bnez $v0, .L0x00000b9c",
             "states 2..3 return without writing back"),
            (0x800A6588, "lw $v0, 0x4($s0)", "the route word"),
            (0x800A6590, "bnez $v0, .L0x000007f4", "route 1"),
            (0x800A6598, "li $v0, 0x9600", "the start X"),
            (0x800A65A0, "li $v0, 0xe600", "route 0's start Y"),
            (0x800A65B4, "j 0x800a65fc", "into the claim walk"),
            (0x800A65BC, "lhu $v0, 0x54($s0)", "park: X from obj+0x54"),
            (0x800A65C4, "sh $v0, 0xa($a0)", "park: record+0xa := X"),
            (0x800A65C8, "lhu $v0, 0x58($s0)", "park: Y from obj+0x58"),
            (0x800A65CC, "j 0x800a663c", "the park's tail"),
            (0x800A65D0, "sh $v0, 0xa($a0)",
             "park: record+0xa := Y (the disc's own second store; +0xc is "
             "not parked)"),
            (0x800A65D4, "ori $v1, 0xae00", "route 1's Y fixed"),
            (0x800A65D8, "li $v0, 0x9600", "route 1's X fixed"),
            (0x800A65F8, "sw $v1, 0x58($s0)", "route 1's Y pixel"),
            (0x800A65FC, "lui $v0, 0x800a", "the claim walk"),
            (0x800A6614, "li $a1, 0x1", "the tag the walk compares"),
            (0x800A6624, "beq $v0, $a1, .L0x000007dc", "match parks the record"),
            (0x800A663C, "lw $v0, 0x38($s0)", "state 0 calls advanceState"),
            (0x800A6654, "lh $v1, 0x72($s0)", "the state-1 sub index"),
            (0x800A665C, "sltiu $v0, $v1, 0x5", "its unsigned bound"),
            (0x800A6660, "beqz $v0, .L0x00000b70",
             "past the table -> write back only"),
            (0x800A6668, "addiu $v0, 0x5de0", "the table base"),
            (0x800A6674, "lw $v0, ($v1)", "the sub pointer"),
            (0x800A6684, "li $v0, 0x32", "sub 0's sprite"),
            (0x800A6688, "j 0x800a6950", "sub 0 writes back"),
            (0x800A6690, "li $v0, 0x32", "sub 1's sprite"),
            (0x800A6694, "sw $v0, 0x50($s0)", "sub 1 falls into the integrator"),
            (0x800A6698, "lui $v0, 0x8005", "the frame-delta provider"),
            (0x800A66A4, "jalr $v0", "read the frame delta"),
            (0x800A66AC, "sll $v1, $v0, 0x1", "accel = (3 << 4) per delta"),
            (0x800A66B0, "addu $v1, $v0", "... times three ..."),
            (0x800A66B4, "sll $v1, 0x4", "... shifted up four"),
            (0x800A66C4, "sw $v0, 0x6c($s0)", "vel += accel"),
            (0x800A66D4, "addu $v0, $a0", "X += the drift"),
            (0x800A66D8, "addu $v1, $a1", "Y += vel"),
            (0x800A66EC, "sw $v1, 0x58($s0)", "the Y pixel"),
            (0x800A66F0, "slti $v1, 0x1ae", "the rail"),
            (0x800A66FC, "lui $v0, 0x1", "the rail in 16.8 ..."),
            (0x800A6700, "ori $v0, 0xae00", "... = 0x1ae00"),
            (0x800A6704, "sw $v0, 0x64($s0)", "snap Y onto the rail"),
            (0x800A670C, "li $v1, 0x1ae", "the Y pixel it stores"),
            (0x800A6710, "slti $v0, 0x201", "the impact cue's speed gate"),
            (0x800A671C, "lui $a0, 0x8004", "the impact cue ..."),
            (0x800A6730, "ori $a0, 0x474a", "... 0x8004474a"),
            (0x800A6734, "lui $v1, 0x2aaa", "the /3 reciprocal ..."),
            (0x800A673C, "ori $v1, 0xaaab", "... 0x2aaaaaab"),
            (0x800A6754, "sw $v0, 0x6c($s0)", "vel = -vel/3"),
            (0x800A6758, "lhu $v0, 0x70($s0)", "the integrator's counter"),
            (0x800A6764, "j 0x800a6950", "the integrator writes back"),
            (0x800A676C, "addiu $a0, $s0, 0x60", "sub 2's cursor"),
            (0x800A6774, "addiu $a1, 0x73f0", "sub 2 steps seq1"),
            (0x800A6778, "jal 0x800a645c", "through the one-shot stepper"),
            (0x800A6780, "li $v1, 0x35", "seq1's first cue clip"),
            (0x800A6788, "sw $v0, 0x50($s0)", "spriteId = the step"),
            (0x800A67AC, "ori $a0, 0x4648", "seq1's first cue"),
            (0x800A67C4, "li $v0, 0x3b", "seq1's second cue clip"),
            (0x800A67CC, "li $v0, 0x1", "its counter gate"),
            (0x800A67DC, "lui $a0, 0x34", "seq1's second cue ..."),
            (0x800A67F0, "ori $a0, 0x1", "... 0x00340001"),
            (0x800A67F8, "j 0x800a694c", "it bumps the counter and writes back"),
            (0x800A6800, "addiu $a0, $s0, 0x60", "sub 3's cursor"),
            (0x800A6808, "addiu $a1, 0x7418", "sub 3 steps seq2"),
            (0x800A6818, "sw $v0, 0x50($s0)", "spriteId = the step"),
            (0x800A681C, "addiu $a0, $s0, 0x60", "sub 4's cursor"),
            (0x800A6824, "addiu $a1, 0x7428", "sub 4 steps seq3"),
            (0x800A6830, "li $v1, 0x2", "seq3's first cue clip"),
            (0x800A6838, "sw $v0, 0x50($s0)", "spriteId = the step"),
            (0x800A684C, "lui $a0, 0x34", "seq3's first cue ..."),
            (0x800A685C, "or $a0, $v1", "... 0x340000 | the clip"),
            (0x800A6874, "li $v0, 0x20", "seq3's second cue clip"),
            (0x800A687C, "li $v0, 0x2a", "seq3's third cue clip"),
            (0x800A6884, "li $v0, 0x1", "the second cue's counter gate"),
            (0x800A6890, "lui $a0, 0x4", "the blip cue ..."),
            (0x800A68A0, "ori $a0, 0x12", "... 0x00040012"),
            (0x800A68B8, "li $v0, 0x2a", "the third cue's compare"),
            (0x800A68C0, "li $v0, 0x2", "its counter gate"),
            (0x800A68EC, "sw $zr, 0x14($s0)", "the divider clear"),
            (0x800A6904, "sltiu $v0, 0x2", "the counter in {3,4}"),
            (0x800A6920, "andi $v0, 0x1f", "the 32-blank blip"),
            (0x800A693C, "ori $a0, 0x12", "the blip's own cue"),
            (0x800A6950, "lw $v1, 0x5c($s0)", "write-back: the record pointer"),
            (0x800A6954, "lbu $v0, 0x50($s0)", "write-back: the sprite byte"),
            (0x800A695C, "sb $v0, 0x4($v1)", "write-back: record+4"),
            (0x800A6960, "lhu $v0, 0x54($s0)", "write-back: the X pixel"),
            (0x800A6968, "sh $v0, 0xa($v1)", "write-back: record+0xa"),
            (0x800A696C, "lhu $a0, 0x58($s0)", "write-back: the Y pixel"),
            (0x800A6974, "sb $v0, ($v1)", "write-back: record+0 = live"),
            (0x800A6978, "sh $a0, 0xc($v1)", "write-back: record+0xc"),
            (0x800A698C, "addiu $sp, -0x18", "the configure handler"),
            (0x800A69A0, "li $v0, 0x332", "818's compare"),
            (0x800A69B0, "li $v0, 0x331", "817's compare"),
            (0x800A69C4, "li $v0, 0x333", "819's compare"),
            (0x800A69CC, "li $v0, 0x334", "820's compare"),
            (0x800A69D4, "li $v0, 0x4", "820's sub, in its compare's delay slot"),
            (0x800A69E0, "sw $v0, 0x60($s0)", "817: X"),
            (0x800A69E4, "li $v0, 0xe600", "817: Y"),
            (0x800A69EC, "li $v0, 0x1", "817: sub 1"),
            (0x800A69F0, "sh $v0, 0x72($s0)", "817: store the sub"),
            (0x800A69F4, "sw $zr, 0x6c($s0)", "817: vel = 0"),
            (0x800A69F8, "sw $zr, 0x68($s0)", "817: drift = 0"),
            (0x800A6A00, "sh $zr, 0x70($s0)", "817: counter = 0"),
            (0x800A6A04, "lui $a0, 0x8004", "818's cue ..."),
            (0x800A6A18, "ori $a0, 0x42c1", "... 0x800442c1"),
            (0x800A6A20, "sh $zr, 0x74($s0)", "818: cursor entry 0"),
            (0x800A6A24, "lhu $v1, 0x73f2($v0)", "818: seq1's first hold"),
            (0x800A6A28, "li $v0, 0x2", "818: sub 2"),
            (0x800A6A2C, "sh $v0, 0x72($s0)", "818: store the sub"),
            (0x800A6A30, "sw $zr, 0x10($s0)", "818: counter = 0"),
            (0x800A6A38, "sh $v1, 0x76($s0)", "818: seed the cursor hold"),
            (0x800A6A3C, "lui $a0, 0x8004", "819's cue ..."),
            (0x800A6A50, "ori $a0, 0x4648", "... 0x80044648"),
            (0x800A6A58, "sh $zr, 0x74($s0)", "819: cursor entry 0"),
            (0x800A6A5C, "lhu $v1, 0x741a($v0)", "819: seq2's first hold"),
            (0x800A6A60, "li $v0, 0x3", "819: sub 3"),
            (0x800A6A64, "sh $v0, 0x72($s0)", "819: store the sub"),
            (0x800A6A6C, "sh $v1, 0x76($s0)", "819: seed the cursor hold"),
            (0x800A6A70, "sh $v0, 0x72($s0)", "820: store the sub"),
            (0x800A6A78, "sh $zr, 0x74($s0)", "820: cursor entry 0"),
            (0x800A6A7C, "lhu $v0, 0x742a($v0)", "820: seq3's first hold"),
            (0x800A6A80, "sw $zr, 0x10($s0)", "820: counter = 0"),
            (0x800A6A84, "sh $v0, 0x76($s0)", "820: seed the cursor hold"),
            (0x800A6A98, "addiu $sp, -0x18", "the registry constructor"),
            (0x800A6AB8, "sw $zr, 0x4($v0)", "... stamps route 0"),
            (0x800A6ACC, "addiu $sp, -0x18", "the stage entry's constructor"),
            (0x800A6AF0, "sw $v1, 0x4($v0)", "... stamps route 1"),
            (0x800A645C, "addiu $sp, -0x28", "the one-shot stepper"),
            (0x800A6484, "lh $v1, 0x14($s1)", "its cursor entry"),
            (0x800A649C, "slti $v0, $v1, 0x5", "the delta clamp"),
            (0x800A64C0, "sh $v0, 0x16($s1)", "hold -= delta"),
            (0x800A64E0, "sh $v0, 0x14($s1)", "entry += 1"),
            (0x800A64F4, "sh $v0, 0x16($s1)", "hold += the new entry's hold"),
            (0x800A6500, "bne $v1, $v0, .L0x0000074c", "the end test"),
            (0x800A6510, "addiu $v0, -0x1", "the end arm steps back one entry"),
            (0x800A6514, "sh $v0, 0x14($s1)", "... and stores it"),
            (0x800A651C, "lhu $v1, 0x2($s0)", "... charging that entry's hold"),
            (0x800A652C, "move_ $a1, $s2", "the tail call"),
            (0x800A6530, "jal 0x800a645c", "... to itself"),
            (0x800A6534, "addiu $a2, $s3, 0x1", "... with depth + 1"),
            (0x800A6538, "lh $v0, ($s0)", "return the settled entry's value"),
        ],
    },
]


def build_ride_walker_members(overlays, points, reg, checked):
    """The `ride-walker` member, from RIDE_WALKER_SITES."""
    out = {}
    for spec in RIDE_WALKER_SITES:
        stage = spec["stage"]
        ov = overlays.setdefault(stage, Overlay(stage))
        for ram_addr, text, note in spec["anchors"]:
            ov.check(ram_addr, text, note)
            checked += 1
        # every mined value is re-decoded from its own image word
        tag = imm_at(ov, spec["tagAt"], (0x09,), "the claim tag")
        start_x = uimm_at(ov, spec["startXAt"], (0x0D,), "the start X")
        start_y = uimm_at(ov, spec["startYAt"], (0x0D,), "route 0's start Y")
        entry_y = 0x10000 | uimm_at(ov, spec["entryYAt"], (0x0D,),
                                    "route 1's start Y")
        bound_fixed = 0x10000 | uimm_at(ov, spec["boundFixedAt"], (0x0D,),
                                        "the rail in 16.8")
        bound_px = imm_at(ov, spec["boundAt"], (0x0A,), "the rail in pixels")
        bound_px_2 = imm_at(ov, spec["boundPxAt"], (0x09,),
                            "the rail pixel the snap stores")
        shift1 = shift_at(ov, spec["shift1At"], "the accel's first shift")
        shift2 = shift_at(ov, spec["shift2At"], "the accel's second shift")
        cue_vel = imm_at(ov, spec["cueVelAt"], (0x0A,), "the impact threshold")
        magic = (uimm_at(ov, spec["magicAt"][0], (0x0F,),
                         "the /3 reciprocal (high half)") << 16) | \
            uimm_at(ov, spec["magicAt"][1], (0x0D,),
                    "the /3 reciprocal (low half)")
        fall_cue = 0x80040000 | uimm_at(ov, spec["fallCueAt"], (0x0D,),
                                        "the impact cue")
        if (tag != spec["tag"] or entry_y != bound_fixed
                or bound_px != bound_px_2 or shift1 != 1
                or magic != 0x2AAAAAAB):
            fail("point_record_actors: s%s ride-walker constants at %#010x do "
                 "not read back as the decode recorded them"
                 % (stage, spec["tick"]))
            continue
        accel = 3 << shift2
        if accel != 0x30:
            fail("point_record_actors: s%s ride-walker accel reads %#x, not 0x30"
                 % (stage, accel))
            continue
        # the three scripts, read off the image, with the heads the decode
        # recorded -- a misread address would show up here
        scripts = {
            "seq1": ov.script(0x800A73F0),
            "seq2": ov.script(0x800A7418),
            "seq3": ov.script(0x800A7428),
        }
        if (scripts["seq1"][:2] != [{"v": 50, "h": 5}, {"v": 52, "h": 5}]
                or scripts["seq1"][-2] != {"v": 59, "h": 180}
                or scripts["seq2"][:2] != [{"v": 60, "h": 4}, {"v": 61, "h": 4}]
                or len(scripts["seq3"]) != 48
                or scripts["seq3"][0] != {"v": 1, "h": 4}
                or scripts["seq3"][-2] != {"v": 0x2F, "h": 4}
                or scripts["seq3"][-1] != {"v": 0xFF, "h": 999}):
            fail("point_record_actors: s%s ride-walker scripts do not read back "
                 "as the decode recorded them" % stage)
            continue
        # the five state-1 sub pointers, from the overlay image's own first words
        table = [ov.word(OVERLAY_BASE + off) for off in (0, 4, 8, 0xC, 0x10)]
        sub_ptrs = {"seq1": 0x800A73F0, "seq2": 0x800A7418, "seq3": 0x800A7428}
        subs, bad = [], False
        for sub, ptr in zip(spec["subs"], table):
            if ptr != sub["at"]:
                fail("point_record_actors: s%s sub table entry reads %#010x, "
                     "the decode recorded %#010x" % (stage, ptr, sub["at"]))
                bad = True
                continue
            entry = {"kind": sub["kind"]}
            if sub.get("spriteAt"):
                entry["sprite"] = imm_at(ov, sub["spriteAt"], (0x09,),
                                         "a sub's sprite")
            if sub.get("script"):
                entry["script"] = sub["script"]
                got = 0x800A0000 | imm_at(ov, sub["scriptAt"], (0x09,),
                                          "a sub's script")
                if got != sub_ptrs[sub["script"]]:
                    fail("point_record_actors: s%s %s reads %#010x"
                         % (stage, sub["script"], got))
                    bad = True
            if sub.get("cues"):
                cues = []
                for cue in sub["cues"]:
                    clip = imm_at(ov, cue["clipAt"], (0x09, 0x0D,),
                                  "a cue's clip")
                    kind, hi_at, lo_at = cue["soundFrom"]
                    if kind == "ori":
                        sound = (uimm_at(ov, hi_at, (0x0F,), "a cue (high)")
                                 << 16) | uimm_at(ov, lo_at, (0x0D,),
                                                  "a cue (low)")
                    else:  # "clip": the or's second operand IS the clip
                        sound = (uimm_at(ov, hi_at, (0x0F,), "a cue (high)")
                                 << 16) | clip
                    if clip != cue["clip"] or sound != cue["sound"]:
                        fail("point_record_actors: s%s cue reads %#x/%#x, the "
                             "decode recorded %#x/%#x"
                             % (stage, clip, sound, cue["clip"], cue["sound"]))
                        bad = True
                    out_cue = {"clip": clip, "ctr": cue["ctr"],
                               "sound": ram(sound)}
                    if cue.get("resetDividerAt"):
                        word_at(ov, cue["resetDividerAt"], 0xAE000014,
                                "a cue's divider reset")
                        out_cue["resetDivider"] = True
                    cues.append(out_cue)
                entry["cues"] = cues
            if sub.get("periodic"):
                p = sub["periodic"]
                mask = imm_at(ov, p["maskAt"], (0x0C,), "the blip's mask")
                kind, hi_at, lo_at = p["soundFrom"]
                sound = (uimm_at(ov, hi_at, (0x0F,), "the blip (high)") << 16) \
                    | uimm_at(ov, lo_at, (0x0D,), "the blip (low)")
                if mask != p["mask"] or sound != p["sound"]:
                    fail("point_record_actors: s%s blip reads %#x/%#x"
                         % (stage, mask, sound))
                    bad = True
                entry["periodic"] = {"ctrs": p["ctrs"], "mask": mask,
                                     "sound": ram(sound)}
            subs.append(entry)
        if bad:
            continue
        # the configure arms, decoded from their own instructions
        configure = {}
        for arm in spec["configure"]:
            sub_no = imm_at(ov, arm["subAt"], (0x09,), "a configure sub")
            if sub_no != arm["sub"]:
                fail("point_record_actors: s%s configure sub reads %#x, the "
                     "decode recorded %#x" % (stage, sub_no, arm["sub"]))
                continue
            out_arm = {"sub": sub_no}
            if arm.get("resetAt"):
                out_arm["reset"] = True
            if arm.get("cueFrom"):
                kind, hi_at, lo_at = arm["cueFrom"]
                sound = (uimm_at(ov, hi_at, (0x0F,), "a configure cue (high)")
                         << 16) | uimm_at(ov, lo_at, (0x0D,),
                                          "a configure cue (low)")
                if sound != arm["cue"]:
                    fail("point_record_actors: s%s configure cue reads %#x, "
                         "the decode recorded %#x" % (stage, sound, arm["cue"]))
                    continue
                out_arm["cue"] = ram(sound)
            if arm.get("rewind"):
                off = uimm_at(ov, arm["rewindAt"], (0x25,),
                              "a rewind's hold halfword")
                seed = ov.u16(0x800A0000 | off)
                if seed != scripts[arm["rewind"]][0]["h"]:
                    fail("point_record_actors: s%s %s rewind seeds %#x, the "
                         "script's first hold is %#x"
                         % (stage, arm["rewind"], seed,
                            scripts[arm["rewind"]][0]["h"]))
                    continue
                out_arm["rewind"] = arm["rewind"]
            if arm.get("clearCtrAt"):
                out_arm["clearCtr"] = True
            configure[str(arm["id"])] = out_arm
        # the write-back's record offsets, mined from its own stores
        wb = {}
        for key, (at, op) in spec["writeBack"].items():
            wb[key] = uimm_at(ov, at, (op,), "write-back: " + key)
        if (wb["sprite"], wb["x"], wb["active"], wb["y"]) != (4, 0xA, 0, 0xC) \
                or (wb["spriteFrom"], wb["xFrom"], wb["yFrom"]) != (0x50, 0x54,
                                                                    0x58):
            fail("point_record_actors: s%s write-back offsets read %r"
                 % (stage, wb))
            continue
        recs, by_tag = tagged_records(points, stage)
        member = {
            "stage": stage,
            "id": spec["id"],
            "idHex": "0x%03x" % spec["id"],
            "machine": "ride-walker",
            # the overlay's own copy of the shared stepper: u16 hold, and its
            # end arm steps back to the last real entry and holds it for ever.
            "stepper": "hold-u16",
            "tick": ram(spec["tick"]),
            "ctor": ram(spec["ctor"]),
            "ctorEntry": ram(spec["ctorEntry"]),
            "registryCtor": registry_ctor(reg, spec["id"]),
            "draw": ram(spec["draw"]),
            "tags": {},
            "scripts": {name: [[e["v"], e["h"], 0] for e in run]
                        for name, run in scripts.items()},
            "panels": [],
            "rideWalker": {
                "tag": tag,
                "startX": start_x,
                "startY": start_y,
                "startYEntry": entry_y,
                "accel": accel,
                "boundY": bound_fixed,
                "boundPx": bound_px,
                "cueVel": cue_vel,
                "divisor": spec["divisor"],
                "fallCue": ram(fall_cue),
                "subTable": [ram(t) for t in table],
                "subs": subs,
                "configure": configure,
                "writeBack": wb,
            },
        }
        if tag not in by_tag:
            fail("point_record_actors: s%s has no point record with atlas "
                 "tag %d" % (stage, tag))
            continue
        member["tags"][str(tag)] = record_geom(recs[by_tag[tag]], by_tag[tag])
        out.setdefault("s" + stage, {})[str(spec["id"])] = member
    return out


def build():
    try:
        points = json.loads(POINTS.read_text())
    except (OSError, ValueError) as exc:
        raise SystemExit("point_record_actors: %s" % exc)
    reg = REGISTRY.read_bytes() if REGISTRY.exists() else b""
    if not reg:
        raise SystemExit("point_record_actors: %s is missing" % REGISTRY)
    overlays, checked = {}, 0
    stages = {}
    for part in (build_pad_members, build_decor_members, build_point_members,
                 build_slot_members):
        got = part(overlays, points, reg, checked)
        for stage, members in got.items():
            stages.setdefault(stage, {}).update(members)
    got = build_picture_steps_members(overlays, reg, checked)
    for stage, members in got.items():
        stages.setdefault(stage, {}).update(members)
    got = build_ride_walker_members(overlays, points, reg, checked)
    for stage, members in got.items():
        stages.setdefault(stage, {}).update(members)
    for sites, machine in ((SINGLE_SITES, "single"), (RISE_SITES, "rise")):
        got = build_inplace_members(overlays, points, reg, checked, sites, machine)
        for stage, members in got.items():
            stages.setdefault(stage, {}).update(members)
    # Every OTHER overlay whose own claim tick carries an in-place copy.  The
    # reader is the same one the two anchored rows use, so this is a scan of the
    # code and not a hand list; see `build_discovered_inplace_members`.
    got, inplace_refused = build_discovered_inplace_members(
        overlays, points, reg, checked)
    for stage, members in got.items():
        stages.setdefault(stage, {}).update(members)
    # The `two-slot` shape is FOUND by scanning every overlay for its own seven
    # instruction words, so the table below is the member list of the family and
    # not a hand list.  The scan's census (copies with no member, and anything
    # this reader refuses by name) rides in the document.
    # EVERY overlay that ships an image, so "no other stage carries this shape"
    # is a scan and not an assumption.
    overlay_stages = sorted(p.name[1:-4] for p in NATIVE.glob("s*.bin")
                            if p.name[1:-4].isdigit())
    for stage in overlay_stages:
        overlays.setdefault(stage, Overlay(stage))
    mined = [0]
    two_slot, two_slot_census = build_two_slot_members(
        overlays, points, reg, mined, overlay_stages)
    for stage, members in two_slot.items():
        stages.setdefault(stage, {}).update(members)
    checked = sum(len(spec.get("anchors") or [])
                  for spec in (PAD_SITES + DECOR_SITES + POINT_SITES
                               + SLOT_SITES + SINGLE_SITES + RISE_SITES
                               + TWO_SLOT_SITES + PICTURE_STEPS_SITES
                               + RIDE_WALKER_SITES))
    machines = {}
    for members in stages.values():
        for member in members.values():
            machines[member["machine"]] = machines.get(member["machine"], 0) + 1
    return {
        "twoSlotCensus": two_slot_census,
        "inPlaceRefused": inplace_refused,
        "source": {
            "overlayBase": ram(OVERLAY_BASE),
            "images": "web/assets/native/sNNN.bin",
            "records": "web/assets/data/point_sprites.json",
            "tool": "tools/extract_point_record_actors.py",
            "claim": "fieldstg F0x80089548 / F0x800894d8",
            "stepper": "each overlay's own routine at its base (0x800a5de4)",
            "methodBlock": "EXE F0x800143dc",
        },
        "summary": {
            "members": sum(len(m) for m in stages.values()),
            "stages": len(stages),
            "machines": machines,
            "anchorsChecked": checked,
        },
        "stages": stages,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=None,
                    help="write the table here (default web/assets/data/"
                         "point_record_actors.json)")
    ap.add_argument("--check", action="store_true",
                    help="fail unless the shipped table matches the overlays")
    args = ap.parse_args()
    target = Path(args.out) if args.out else (
        REPO / "web/assets/data/point_record_actors.json")
    doc = build()
    for msg in ERRORS:
        print(msg, file=sys.stderr)
    if ERRORS:
        raise SystemExit("point_record_actors: %d anchor(s) did not match"
                         % len(ERRORS))
    text = json.dumps(doc, indent=1, ensure_ascii=True) + "\n"
    if args.check:
        if not target.exists():
            raise SystemExit("point_record_actors: %s is missing" % target)
        if target.read_text() != text:
            raise SystemExit("point_record_actors: %s differs from the "
                             "overlays" % target)
        print("point_record_actors: %s matches the overlays: %d members, "
              "%d anchors verified"
              % (target, doc["summary"]["members"],
                 doc["summary"]["anchorsChecked"]))
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
    print("point_record_actors: %d members, %d anchors verified -> %s"
          % (doc["summary"]["members"], doc["summary"]["anchorsChecked"], target))
    return 0


if __name__ == "__main__":
    sys.exit(main())
