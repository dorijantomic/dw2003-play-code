#!/usr/bin/env python3
"""Mine the overlays that drive a RUN of display slots from one stage object.

DECODE (original assembly, authority 2). The field's ambient decorations live in
one chain of 18-byte display slots whose head pointer is at RAM `0x80099D90`
(`docs/research/field/point-sprite-ambient-system.md` is its canonical
description; `tools/extract_point_sprites.py` already extracts it per stage and
`web/effects.js` is its reader).  Several stage overlays claim slots out of that
chain by their tag byte (record + 1) and then write each claimed slot's live flag
(byte + 0) and clip (byte + 4) every frame.

This tool mines the shape where ONE stage object claims a RUN of six CONSECUTIVE
tags and drives all six itself:

  wstag310.s file 0x3f0  lw $a0, -0x6270($v0)   # $a0 = [0x80099D90], the chain
  wstag310.s file 0x488  addiu $v0, -0x5        # tag - 5, six tags 5..10
  wstag310.s file 0x48c  sltiu $v0, 0x6
  wstag310.s file 0x4b0  addu $v0, $t2          # $t2 = the overlay base: the
  wstag310.s file 0x4b4  lw $v0, ($v0)          # six-entry claim table
  wstag310.s file 0x4bc  jr $v0
  wstag310.s file 0x4c4  sw $a0, 0x54($s2)      # the claim body: keep the record
  wstag310.s file 0x4c8  sh $zr, 0x58($s2)      # zero the clip cursor's index
  wstag310.s file 0x4d4  sh $v0, 0x5a($s2)      # seed the cursor's hold timer

and the one where six slots are driven each by its own phase of a six-phase pass
(the phase word is one byte at obj+0x50, and the phase walks the six slots in the
same order, so a slot's role is fixed):

  wstag310.s file 0x57c  lw $v1, 0x50($s2)      # the mode
  wstag310.s file 0x620  sltiu $v0, $s1, 0x6    # the mode-2 phase table
  wstag310.s file 0x62c  addiu $v0, 0x5df8
  wstag310.s file 0x638  lw $v0, ($v1)

Everything here is READ OUT of the overlay, never hand-listed: the object is
found by its own chain-head read, its registry id by its own constructor address
against the shipped FIELDSTG.PRO effect registry, and each phase's behaviour by
classifying that phase's own instructions.  A phase body this tool cannot
classify is REFUSED (`UnmodelledShape`) rather than shipped as a guess, so the
member list cannot grow a phase the engine does not implement.

Run:
  taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/extract_display_slot_ensembles.py --out web/assets/data/stage_slot_ensembles.json
  taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/extract_display_slot_ensembles.py --check
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WSTAG_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
FIELDSTG = ROOT / "web/assets/native/fieldstg.bin"
OUT = ROOT / "web/assets/data/stage_slot_ensembles.json"

BASE = 0x800A5DE0  # every wstag overlay's load address
CHAIN_HEAD = 0x80099D90  # `lui $v0,0x800a / lw $a0,-0x6270($v0)`
EFFECT_REGISTRY = 0x8009B3E8
FIELDSTG_BASE = 0x80082CB0
SLOT_COUNT = 6  # the phase count: `sltiu $v0, $s1, 0x6` in every phase band
CLIP_END = 255  # the stepper's end marker: `li $v0, 0xff`
STATE_OFFSET = 0x0C  # obj+0x0c: the resident allocator's state word
MODE_OFFSET = 0x50  # obj+0x50: the mode word the phase band reads

ALLOCATORS = {0x800143DC, 0x80014504}  # the two resident allocators

# Register numbers, so the field a store reads is named rather than guessed.
R_V0, R_A0, R_A1, R_A2 = 2, 4, 5, 6
R_S0, R_S1, R_S2, R_S4, R_S5 = 16, 17, 18, 20, 21
R_V1 = 3  # the mode word is loaded into $v1, which is register 3

FLASH_MODE = 3  # the only mode a SETANIM reaches besides the steady one


class UnmodelledShape(Exception):
    """A member this tool found and cannot describe. Reported, never guessed."""


def _op(w: int) -> int:
    return w >> 26


def _rs(w: int) -> int:
    return (w >> 21) & 31


def _rt(w: int) -> int:
    return (w >> 16) & 31


def _rd(w: int) -> int:
    return (w >> 11) & 31


def _imm(w: int) -> int:
    v = w & 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def _imm16(w: int) -> int:
    """The unsigned halfword: a hold timer is read with `lhu`."""
    return w & 0xFFFF


def _jal(w: int) -> int:
    return 0x80000000 + ((w & 0x03FFFFFF) << 2) if _op(w) == 0x03 else 0


def function_start(words: dict[int, int], off: int) -> int | None:
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


def next_return(words: dict[int, int], off: int, limit: int = 0x600) -> int:
    """The offset of the routine's own `jr $ra` + delay slot, bounded."""
    for o in range(off, min(off + limit, (max(words) if words else 0) + 8), 4):
        # `jr $ra` is opcode 0 with $ra in `rs` -- the whole word is 0x03e00008.
        # Testing the opcode for SPECIAL (0x0e) finds nothing at all.
        if words.get(o) == 0x03E00008:
            return o + 8
    return off + limit


def effect_registry() -> dict[str, int]:
    """ctor address (lower-case hex) -> effect id, from the shipped registry.

    fieldstg F0x8009243c walks 12-byte {id, ctor, draw} entries at 0x8009b3e8 and
    stops at the first zero id. Read out of FIELDSTG.PRO (authority 4) so the
    id pairing is read, not assumed.
    """
    try:
        blob = FIELDSTG.read_bytes()
    except OSError:
        return {}
    out: dict[str, int] = {}
    off = EFFECT_REGISTRY - FIELDSTG_BASE
    while off + 12 <= len(blob):
        eid, ctor, draw = struct.unpack_from("<III", blob, off)
        if eid == 0:
            break
        out.setdefault(f"0x{ctor:08x}", eid)
        out[f"0x{ctor:08x}#draw"] = draw
        off += 12
    return out


# ── the shape ────────────────────────────────────────────────────────────────

def find_chain_reads(words: dict[int, int]) -> list[int]:
    """Every `lui $vX, HI / lw $aY, LO($vX)` whose address is the chain head.

    `lui` carries its register in the DESTINATION field, so the pair is joined on
    `_rt(lui) == _rs(lw)`, and the address is the `lui`'s immediate as a base --
    `lui $v0,0x800a` + `addiu/lw $a0,-0x6270($v0)` is 0x800A0000 - 0x6270, the
    chain head 0x80099D90, NOT base-relative.
    """
    hits = []
    for off in sorted(words):
        w = words[off]
        if _op(w) != 0x0F:
            continue
        hi = (w & 0xFFFF) << 16
        nxt = words.get(off + 4)
        if nxt is None or _op(nxt) != 0x23:
            continue
        if _rs(nxt) != _rt(w) or _rt(nxt) != 4:
            continue
        if (hi + _imm(nxt)) & 0xFFFFFFFF != CHAIN_HEAD:
            continue
        hits.append(off)
    return hits


def dispatch_tables(words: dict[int, int], start: int, end: int) -> list[int]:
    """Every jump table the routine dispatches through, as overlay file offsets.

    Parsed BACKWARDS from the dispatch itself, because the forward distance from
    the `addiu` that materialises the table base to the `jr` that uses it is not
    fixed: `wstag310` file 0x458 (`addiu $t2, $v0, 0x5de0`) and file 0x4bc
    (`jr $v0`) are 0x64 bytes apart, and in the phase band 0x62c..0x640 is 0x14.
    The shape is `lw $vX, ($vY)` / `nop` / `jr $vX`, then `addu` whose
    destination is $Y, then `addiu` whose destination is the `addu`'s other
    source.  Three field-reading traps, each of which silently finds nothing:

      - `addu` is a SPECIAL: its destination is in `rd`, not `rt`.
      - `jr` carries the register it jumps to in `rs`, not `rt`.
      - the `addu`'s destination is sometimes the `lw`'s DATA register (the claim
        dispatch, `addu $v0, $t2` + `lw $v0, ($v0)`) and sometimes its BASE
        register (the phase dispatch, `addu $v1, $v0` + `lw $v0, ($v1)`).

    The `addiu`'s immediate is relative to the `lui` that built ITS source
    register -- or is the whole offset when the source is `$zr` -- and the `lui`
    must be the nearest one at a LOWER address: several `lui $v0, 0x800b` pairs
    sit between the pair, and taking the wrong one moves the table by 0x10000.
    """
    out: list[int] = []
    for o in range(start, end - 12, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x23 or (w & 0xFFFF) != 0:  # lw $vX, ($vY)
            continue
        nop = words.get(o + 4)
        jr = words.get(o + 8)
        if nop != 0 or jr is None or _op(jr) != 0x00 or _rs(jr) != _rt(w):
            continue
        reg = _rt(w)  # the `lw`'s data register
        base = _rs(w)  # the `lw`'s base register
        for k in range(1, 25):
            a = words.get(o - k * 4)
            if a is None:
                break
            if _op(a) != 0x00 or (a & 0x3F) != 0x21 or _rd(a) not in (reg, base):
                continue
            addiu = addiu_m = None
            for m in range(k + 1, k + 56):
                b = words.get(o - m * 4)
                if b is None:
                    break
                if _op(b) == 0x09 and _rt(b) == _rt(a):
                    addiu, addiu_m = b, m
                    break
            if addiu is None:
                break
            hi = 0
            if _rs(addiu) != 0:  # `addiu $vX, $zr, imm`: the immediate IS it
                for m in range(addiu_m + 1, addiu_m + 80):
                    b = words.get(o - m * 4)
                    if b is None:
                        break
                    if _op(b) == 0x0F and _rt(b) == _rs(addiu):
                        hi = (b & 0xFFFF) << 16
                        break
            ram = (hi + _imm(addiu & 0xFFFF)) & 0xFFFFFFFF
            if BASE <= ram < BASE + 0x10000:
                cand = ram - BASE
                if cand not in out:
                    out.append(cand)
            break
    return out


def read_table(words: dict[int, int], file_off: int, count: int) -> list[int]:
    """`count` absolute addresses from a jump table at `file_off`."""
    out = []
    for i in range(count):
        w = words.get(file_off + i * 4)
        if w is None:
            return []
        out.append(w)
    return out


def _slot_tail(words: dict[int, int], start: int, end: int) -> int:
    """The `addiu $s5, K` that steps to the next slot: the band's shared tail.

    `li $s5, BASE` and `addiu $s5, K` are the same opcode and destination; only
    the source tells them apart ($zr seeds, $s5 advances).
    """
    for o in range(start, min(start + 0x200, end), 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x09 and _rt(w) == R_S5 and _rs(w) == R_S5:
            return o
    return start + 0x80


def _phase_window(entries: list[int], i: int, words: dict[int, int],
                  end: int) -> list[int]:
    """The instructions one phase entry owns, in execution order.

    A phase body runs from its table entry to the next entry at a HIGHER address
    -- the table is not sorted: `wstag310` file 0x18 is
    {0x738, 0x738, 0x648, 0x664, 0x690, 0x698} -- and where no entry is higher
    it runs to the shared tail.  The block is then cut at the first `j` that
    LEAVES it (its delay slot stays, because that is where the original puts the
    store's value), and only a block with neither a stepper call nor a store of
    its own follows the jump: file 0x65c `j 0x67c` reaches phase 3's stepper
    call, so phase 2 has to be given that block, while phase 5's `j` at 0x6a4
    reaches the phase-advance code and must not drag mode 3's band in with it.
    """
    entry = entries[i]
    higher = [e for e in entries if e > entry]
    limit = min(higher) if higher else _slot_tail(words, entry, end)
    raw = [o for o in range(entry, max(limit, entry + 4), 4)
           if words.get(o) is not None]
    jumped = None
    for k, o in enumerate(raw):
        w = words[o]
        if _op(w) != 0x02:  # j
            continue
        # `j` carries a WORD offset with no 0x80000000 base, so the target is
        # `(field << 2) | 0x80000000`; every offset in this tool is a FILE
        # offset, so BASE comes off after that.
        tgt = (0x80000000 + ((w & 0x03FFFFFF) << 2)) - BASE
        if entry <= tgt < limit:
            continue
        raw = raw[:k + 2]
        jumped = tgt
        break
    has_call = any(_op(words[o]) == 0x03 and _jal(words[o]) not in ALLOCATORS
                   for o in raw)
    has_store = any(_op(words[o]) == 0x28 and _rs(words[o]) == R_S0
                    for o in raw)
    if jumped is None or has_call or has_store:
        return raw
    tail = _slot_tail(words, jumped, end)
    return raw + [t for t in range(jumped, max(tail, jumped + 4), 4)
                  if words.get(t) is not None]


def classify_phase(words: dict[int, int], entries: list[int], i: int,
                   end: int) -> dict:
    """One phase -> what it writes into its slot.

    Three shapes exist and all three are implemented by
    engine/systems/stage-slot-ensemble.ts:

      off      -- `sb $zr, ($s0)`: the slot's live flag and nothing else.
      literal  -- `sb $s4, ($s0)` then `sb $v0, 4($s0)`; the clip is the last
                  `li $v0, N` before that first store, because the literal
                  reaches the store through a `j`'s delay slot.
      run      -- ONE call to the overlay's own clip stepper; its return becomes
                  the slot's clip (byte + 4) and its ctr (byte + 9), and the live
                  flag is set to 1.  The table is the `lui`/`addiu` pair in $a1.

    A store's SOURCE register is in `rt` and its BASE register in `rs`; reading
    the source out of `rd` finds only `$zr` stores.  More than one stepper call
    in a phase, or a write this tool does not model, raises: it refuses rather
    than inventing a phase.
    """
    body = _phase_window(entries, i, words, end)
    if not body:
        raise UnmodelledShape(f"phase entry 0x{BASE + entries[i]:08x} is empty")
    calls = [o for o in body
             if _op(words[o]) == 0x03 and _jal(words[o]) not in ALLOCATORS]
    if len(calls) > 1:
        raise UnmodelledShape(
            f"phase entry 0x{BASE + entries[i]:08x} makes {len(calls)} stepper calls"
        )
    if calls:
        at = body.index(calls[0])
        hi = lo = None
        one_shot = False
        for o in body[:at]:
            w = words[o]
            if _op(w) == 0x0F and _rt(w) == R_A1:
                hi = (w & 0xFFFF) << 16
            if _op(w) == 0x09 and _rt(w) == R_A1 and _rs(w) == R_A1:
                lo = _imm(w & 0xFFFF)
            if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_A2:
                one_shot = _imm(w & 0xFFFF) != 0
        if hi is None or lo is None:
            raise UnmodelledShape(
                f"phase entry 0x{BASE + entries[i]:08x} has no lui/addiu table pair"
            )
        whole = list(body)
        for o in body:
            w = words[o]
            if _op(w) == 0x09 and _rt(w) == R_S5 and _rs(w) == R_S5:
                whole = body[:body.index(o)]
                break
        stores = {_imm(words[o] & 0xFFFF) for o in whole
                  if _op(words[o]) == 0x28 and _rs(words[o]) == R_S0}
        # A $zr store into the CLIP byte is the END marker clearing it; a $zr
        # store into the LIVE byte is the ordinary "light it up", and reading
        # the two as one shape gives every looping run an end behaviour it does
        # not have.
        zero_clip = any(_op(words[o]) == 0x28 and _rs(words[o]) == R_S0
                        and _rt(words[o]) == 0 and _imm(words[o] & 0xFFFF) == 4
                        for o in whole)
        return {
            "kind": "run",
            "table": f"0x{(hi + lo) & 0xFFFFFFFF:08x}",
            "oneShot": one_shot,
            "writesClip": 4 in stores,
            "writesCtr": 9 in stores,
            # A one-shot run's END marker clears the clip instead of writing it
            # (`wstag310` file 0x730 `addiu $s3, 1` / `sb $zr, 4($s0)`), so the
            # flag says the caller must clear rather than store.
            "endClearsClip": zero_clip,
        }

    store = None
    for o in body:
        w = words[o]
        if _op(w) == 0x28 and _rs(w) == R_S0 and (w & 0xFFFF) in (0, 4, 9):
            store = o
            break
    if store is None:
        raise UnmodelledShape(
            f"phase entry 0x{BASE + entries[i]:08x} writes nothing this tool models"
        )
    src = _rt(words[store])
    if src == 0:
        return {"kind": "off"}
    if src == R_S4:
        lit = None
        for o in body:
            if o >= store:
                break
            w = words[o]
            if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_V0:
                lit = _imm(w & 0xFFFF)
        if lit is None:
            raise UnmodelledShape(
                f"phase entry 0x{BASE + entries[i]:08x} has no `li` for its clip"
            )
        return {"kind": "literal", "clip": lit}
    raise UnmodelledShape(
        f"phase entry 0x{BASE + entries[i]:08x} stores from ${src}"
    )


def read_halfword(words: dict[int, int], addr: int) -> int | None:
    """The unsigned halfword at `addr`, which may not be word-aligned.

    `lhu` reads at any even address and the re-seed holds are two bytes into a
    table (`0x800a8392` is `0x800a8390` + 2), so the word map has to be opened up
    rather than the halfword treated as missing.
    """
    off = addr - BASE
    word = words.get(off & ~3)
    if word is None:
        return None
    return ((word >> 16) if off & 2 else word) & 0xFFFF


def read_clip_table(words: dict[int, int], addr: int, limit: int = 64) -> list[list[int]]:
    """The `{s16 clip, u16 hold}` entries at `addr`, through the END marker.

    The end marker is a halfword of 255 (`li $v0, 0xff` in the stepper), NOT -1,
    so a table whose last entry is `{255, 999}` is complete and the hold beside
    the marker is data, not a value to read past.
    """
    base = addr - BASE
    out: list[list[int]] = []
    for i in range(limit):
        w = words.get(base + i * 4)
        if w is None:
            break
        clip = _imm(w & 0xFFFF)
        out.append([clip, (w >> 16) & 0xFFFF])
        if clip == CLIP_END:
            break
    return out


def seed_tables(words: dict[int, int], start: int, end: int) -> dict[int, str]:
    """Register -> the table address `lui $vX, HI` + `addiu $tY, $vX, LO` builds.

    The pair's two halves are NOT into the same register: the corpus puts the
    high half in $v0 and the low half in the temporary that ends up holding the
    address (`wstag310` file 0x45c/0x460), so the join is on the `addiu`'s SOURCE
    against the `lui`'s DESTINATION.

    The map is SCOPED to one routine, because $t1..$t7 are scratch: s310's two
    members both bind $t1, to 0x800a82e0 in the first and 0x800a83f8 in the
    second, and an overlay-wide map reads whichever binding came last.
    """
    out: dict[int, str] = {}
    for off in sorted(o for o in words if start <= o < end):
        w = words[off]
        if _op(w) != 0x0F:
            continue
        nxt = words.get(off + 4)
        if nxt is None or _op(nxt) != 0x09 or _rs(nxt) != _rt(w):
            continue
        out[_rt(nxt)] = f"0x{((w & 0xFFFF) << 16) + _imm(nxt & 0xFFFF) & 0xFFFFFFFF:08x}"
    return out


def cursor_layout(words: dict[int, int], claim_bodies: list[int],
                  scan_end: int, routine_end: int) -> list[dict]:
    """Each claim body -> {rec, index, timer, seed} offsets and its seed table.

    A body is `sw $a0, REC($s2)` / `sh $zr, REC+4($s2)` /
    `lhu $v0, 2($tX)` / `sh $v0, REC+6($s2)`, so all three offsets are read and
    the seed table is the one `$tX` was loaded with before the claim loop.  A body
    with no `lhu` -- the first and last slot of both members -- seeds nothing,
    which is a fact about the object and not a failure, so `seed` stays null.
    The window is the next claim entry, because the bodies are five instructions
    long and a fixed-size window swallows the next one.
    """
    seeds = seed_tables(words, 0, routine_end)

    out = []
    for i, body in enumerate(claim_bodies):
        higher = [b for b in claim_bodies if b > body]
        limit = min(higher) if higher else body + 0x20
        rec = index = timer = None
        seed = None
        for o in range(body, min(limit, scan_end), 4):
            w = words.get(o)
            if w is None:
                break
            if _op(w) == 0x2B and _rs(w) == R_S2 and _rt(w) == R_A0:
                rec = _imm(w & 0xFFFF)
            elif _op(w) == 0x29 and _rs(w) == R_S2 and rec is not None:
                off_ = _imm(w & 0xFFFF)
                # The gap between the record word and the cursor is PER MEMBER,
                # not fixed: s310's 0x33f keeps {rec, index, timer} four bytes
                # apart (`sh $zr, 0x58` after `sw $a0, 0x54`) and its 0x340
                # keeps them eight apart.  What is fixed is that the timer sits
                # two bytes after the index.
                if _rt(w) == 0 and index is None and off_ is not None \
                        and rec is not None and off_ > rec:
                    index = off_
                elif index is not None and off_ == index + 2 and _rt(w) in (0, R_V0):
                    timer = off_
            elif _op(w) == 0x25 and _imm(w & 0xFFFF) == 2:
                # The register is a TEMPORARY, not necessarily $t0..$t7: s310
                # seeds its four cursors from $t1, $t0, $a3 and $a2, so a
                # range test on the register number loses two of the four.
                seed = seeds.get(_rs(w))
        if rec is None or index is None:
            raise UnmodelledShape(
                f"claim body at 0x{BASE + body:08x} does not store rec/index"
            )
        out.append({"rec": rec, "index": index, "timer": timer, "seed": seed})
    return out


def branch_target(w: int, at: int) -> int:
    """A `beq`/`bne` word at file offset `at` -> the file offset it branches to.

    A branch's displacement is a SIGNED 16-bit WORD count relative to the
    instruction AFTER the branch: `beq $v1, $v0, .L0x00000620` at file 0x5a4 is
    `0x001e`, so the target is 0x5a4 + 4 + (0x1e << 2) = 0x620.  Reading the
    26-bit J-format field instead gives a target 0x8000 above the overlay.
    """
    return at + 4 + (_imm(w & 0xFFFF) << 2)


def mode_of_arm(words: dict[int, int], start: int, end: int) -> dict[int, int]:
    """Arm entry offset -> the mode word that reaches it.

    The mode dispatch is a chain of branches on the mode word `$v1`
    (`wstag310` file 0x584/0x594/0x5a4/0x5ac), and each arm then opens with
    `beq $s1, $s4` -- the phase test against 1.  Matching an arm marker to the
    mode branch that TARGETS it is what tells mode 1 from mode 3: both arms run
    one-shot runs over slots 0 and 1 and differ only in their tables, and mode 1
    is never SET, so reading the wrong one ships the wrong pictures.
    """
    modes: dict[int, int] = {}
    for o in range(start, end, 4):
        w = words.get(o)
        if w is None or _op(w) not in (0x04, 0x05) or _rs(w) != R_V1:
            continue
        rt = _rt(w)
        if rt == 0:
            mode = 0  # beqz / bnez $v1
        elif rt == R_S4:
            mode = 1
        else:
            mode = None
            for p in range(o - 4, max(start, o - 0x20) - 1, -4):
                x = words.get(p)
                if x is None or _op(x) != 0x09 or _rs(x) != 0 or _rt(x) != rt:
                    continue
                mode = _imm(x & 0xFFFF)
                break
            if mode is None:
                raise UnmodelledShape(
                    f"mode branch at 0x{BASE + o:08x} compares an unset register"
                )
        modes.setdefault(branch_target(w, o), mode)
    # An arm's ENTRY is the mode branch's target, and the arm opens with the
    # phase test `beq $s1, $s4`.  So the marker is looked for AT the target, not
    # read off the branch: the marker at file 0x5bc branches to 0x5f8, which is
    # inside the arm, not the entry the mode-1 branch points at.
    arms: dict[int, int] = {}
    for tgt, mode in modes.items():
        w = words.get(tgt)
        if w is None or _op(w) != 0x04 or _rs(w) != R_S1 or _rt(w) != R_S4:
            continue
        arms[tgt] = mode
    return arms


def mode_bands(words: dict[int, int], start: int, end: int,
               covered: set[int], cursor_base: int, stride: int) -> list[dict]:
    """The flash band (mode 3) -> one entry per slot it drives.

    The flash arm is NOT a jump table -- it is a `beq $s1, 1` / `slti` chain --
    so it cannot be found by table.  It is found instead by SUBTRACTION: every
    call to the overlay's clip stepper inside the object that is not inside a
    steady phase's window is a flash call.  Each one is paired with the cursor its
    `addiu $a0, $s2, K` names and the table its `lui`/`addiu $a1` pair builds.
    """
    arms = mode_of_arm(words, start, end)
    out: list[dict] = []
    seen: set[int] = set()
    for at in range(start, end, 4):
        w = words.get(at)
        if w is None or _op(w) != 0x03 or _jal(w) in ALLOCATORS or at in covered:
            continue
        cursor = None
        table = None
        hi = lo = None
        one_shot = False
        arm = None
        for o, m in arms.items():
            if o < at and (arm is None or o > arm[0]):
                arm = (o, m)
        if arm is None or arm[1] != FLASH_MODE:
            continue
        # The scan back STOPS at the cursor: the flash block is
        # `addiu $a0, $s2, K` ... `lui $a1` / `addiu $a1, LO` / `li $a2, 1` /
        # `jal stepper`, and without the stop the pair is picked up from the
        # PREVIOUS phase -- `wstag310` file 0x5d4 is mode 1's table, 0x60 bytes
        # above mode 3's own.
        # DESCENDING: the cursor comes FIRST in address order, so an
        # ascending scan stops on it before it has read the pair above it.
        for o in range(at - 4, max(start, at - 0x60) - 1, -4):
            x = words.get(o)
            if x is None:
                continue
            if _op(x) == 0x09 and _rt(x) == R_A0 and _rs(x) == R_S2:
                cursor = _imm(x & 0xFFFF)
                break
            if _op(x) == 0x0F and _rt(x) == R_A1:
                hi = (x & 0xFFFF) << 16
            if _op(x) == 0x09 and _rt(x) == R_A1 and _rs(x) == R_A1:
                lo = _imm(x & 0xFFFF)
            if _op(x) == 0x09 and _rs(x) == 0 and _rt(x) == R_A2:
                one_shot = _imm(x & 0xFFFF) != 0
        if cursor is None or hi is None or lo is None:
            raise UnmodelledShape(
                f"flash call at 0x{BASE + at:08x} has no cursor/table pair"
            )
        slot = (cursor - cursor_base) // stride
        if slot in seen:
            continue
        seen.add(slot)
        out.append({
            "slot": slot,
            "kind": "run",
            "table": f"0x{(hi + lo) & 0xFFFFFFFF:08x}",
            "oneShot": one_shot,
            "writesClip": True,
            "writesCtr": False,
            "endClearsClip": True,
        })
    return sorted(out, key=lambda m: m["slot"])


def reseeds(words: dict[int, int], start: int, end: int) -> list[dict]:
    """The configure handler's cursor re-seeds: {index, timer, hold, holdAddr}.

    The handler answers one sub-command, and for each cursor it zeroes the index
    (`sh $zr, K($a0)`) and writes the timer two bytes later from a hold read out
    of a table (`lhu $vY, LO` off a `lui $vX, HI`).  The two cursors INTERLEAVE:
    `wstag310` file 0x7c8/0x7cc/0x7d0/0x7d4 is "zero cursor 0, read a hold, zero
    cursor 1, write cursor 0's timer", so the zeroed offsets are collected first
    and each timer store is then matched against them.  The hold is the halfword
    AT the read address -- for both members that address is two bytes into the
    flash table, i.e. its entry 0's own hold -- so the value is read, not guessed.
    """
    zeros: set[int] = set()
    for o in range(start, end, 4):
        w = words.get(o)
        if w is None:
            break
        if _op(w) == 0x29 and _rs(w) == R_A0 and _rt(w) == 0:
            zeros.add(_imm(w & 0xFFFF))
    out: list[dict] = []
    for o in range(start, end, 4):
        w = words.get(o)
        if w is None:
            break
        if _op(w) != 0x29 or _rs(w) != R_A0:
            continue
        timer = _imm(w & 0xFFFF)
        if timer - 2 not in zeros:
            continue
        dest = _rt(w)
        hi = lo = None
        for p in range(o - 4, max(start, o - 0x20) - 1, -4):
            x = words.get(p)
            if x is None:
                continue
            if _op(x) == 0x25 and _rt(x) == dest:  # lhu $dest, LO($vX)
                for q in range(p - 4, max(start, p - 0x20) - 1, -4):
                    y = words.get(q)
                    if y is not None and _op(y) == 0x0F and _rt(y) == _rs(x):
                        hi = (y & 0xFFFF) << 16
                        break
                lo = _imm(x & 0xFFFF)
                break
        if hi is None or lo is None:
            raise UnmodelledShape(
                f"re-seed at 0x{BASE + o:08x} has no lui/lhu hold pair"
            )
        addr = (hi + lo) & 0xFFFFFFFF
        hold = read_halfword(words, addr)
        if hold is None:
            raise UnmodelledShape(
                f"re-seed hold at 0x{addr:08x} is outside the overlay"
            )
        out.append({
            "index": timer - 2,
            "timer": timer,
            "holdAddr": f"0x{addr:08x}",
            "hold": hold,
        })
    return out


def find_allocator_owner(words: dict[int, int], tick: int) -> tuple[int, int] | None:
    """(constructor file offset, object size) for the routine that builds `tick`.

    The builder is the routine that puts the tick in $a0 and calls one of the two
    resident allocators; nothing here is keyed on a stage.
    """
    for off in sorted(words):
        w = words[off]
        if _op(w) != 0x0F or _rt(w) != 4:
            continue
        nxt = words.get(off + 4)
        if nxt is None or _op(nxt) != 0x09 or _rt(nxt) != 4 or _rs(nxt) != 4:
            continue
        if ((w & 0xFFFF) << 16) + _imm(nxt & 0xFFFF) != tick:
            continue
        site = off + 8
        while site < off + 0x20:
            w2 = words.get(site)
            if w2 is None:
                break
            if _jal(w2) in ALLOCATORS:
                break
            site += 4
        else:
            continue
        if _jal(words.get(site, 0)) not in ALLOCATORS:
            continue
        size = None
        for o in range(site - 0x10, site + 4, 4):
            w3 = words.get(o)
            if w3 is None:
                continue
            if _op(w3) == 0x09 and _rs(w3) == 0 and _rt(w3) == 5:
                size = _imm(w3 & 0xFFFF)
        start = function_start(words, off)
        if start is None:
            continue
        return start, size
    return None


def extract(stage: str, reg: dict[str, int]) -> list[dict]:
    words = ovs.load_words(WSTAG_DIR / f"wstag{stage}.s")
    if not words:
        return []
    out: list[dict] = []
    top = max(words) + 4
    for chain in find_chain_reads(words):
        tick = function_start(words, chain)
        if tick is None:
            continue
        end = next_return(words, tick)
        # The tag range test: `addiu $vX, -BASE` then `sltiu $vY, 6`.
        # The tag range test: `addiu $vX, -TAGBASE` then `sltiu $vY, 6`.
        # `sltiu` is opcode 0x0b, and it is the short form of
        # `sltiu $vY, $vY, 6` -- the .s text does not show the register.
        tag_base = None
        for o in range(tick, end, 4):
            w = words.get(o)
            nxt = words.get(o + 4)
            if w is None or nxt is None:
                continue
            if _op(w) == 0x09 and _rs(w) != 0 and _op(nxt) == 0x0B \
                    and _imm16(nxt) == SLOT_COUNT:
                tag_base = -_imm(w & 0xFFFF)
                break
        if tag_base is None:
            continue
        # The cursor walk: `li $s5, BASE` seeds the slot offset and
        # `addiu $s5, K` advances it, so the two are DIFFERENT instructions with
        # the same opcode and destination -- `li` has $zr as its source.
        stride = None
        cursor_base = None
        for o in range(tick, end, 4):
            w = words.get(o)
            if w is None or _op(w) != 0x09 or _rt(w) != 21:
                continue
            if _rs(w) == 0 and _imm(w & 0xFFFF) > 0 and cursor_base is None:
                cursor_base = _imm(w & 0xFFFF)
            if _rs(w) == 21 and _imm(w & 0xFFFF) > 0 and stride is None:
                stride = _imm(w & 0xFFFF)
        if stride is None or cursor_base is None:
            continue

        tables = dispatch_tables(words, tick, end)
        claim = None
        phases = None
        for t in tables:
            entries = read_table(words, t, SLOT_COUNT)
            if not entries:
                continue
            bodies = [e - BASE for e in entries]
            if not all(0 <= b < top for b in bodies):
                continue
            # The two tables answer to different classifiers, and each one
            # REFUSES the other's shape -- so a layout failure must fall through
            # to the band attempt, not skip the entry.
            try:
                layout = cursor_layout(words, bodies, top, end)
            except UnmodelledShape:
                layout = None
            if claim is None and layout and all(l["rec"] is not None for l in layout):
                claim = {"file": t, "bodies": bodies, "layout": layout}
                continue
            try:
                band = [classify_phase(words, bodies, k, end)
                        for k in range(len(bodies))]
            except UnmodelledShape:
                continue
            if phases is None and any(b["kind"] != "off" for b in band):
                phases = {"file": t, "bodies": bodies, "band": band}
        if claim is None or phases is None:
            continue

        owner = find_allocator_owner(words, BASE + tick)
        if owner is None:
            continue
        ctor, size = owner
        ctor_addr = f"0x{BASE + ctor:08x}"
        eid = reg.get(ctor_addr)
        if eid is None:
            # The shape is there but no effect record builds it, so it is not a
            # member of this system -- s311 carries a display-chain walk with no
            # registry constructor behind it. Membership is the registry, never
            # the code alone.
            continue
        draw = reg.get(f"{ctor_addr}#draw") or 0

        covered: set[int] = set()
        for k in range(len(phases["bodies"])):
            covered.update(_phase_window(phases["bodies"], k, words, end))
        flash = mode_bands(words, tick, end, covered, cursor_base, stride)
        entry = {
            "id": eid,
            "idHex": f"0x{eid:03x}",
            "stage": stage,
            "tick": f"0x{BASE + tick:08x}",
            "ctor": ctor_addr,
            "size": size,
            "draw": f"0x{draw:08x}" if draw else None,
            "tagBase": tag_base,
            "slots": SLOT_COUNT,
            "cursorBase": cursor_base if cursor_base is not None else 0x54,
            "cursorStride": stride,
            "claimTable": f"0x{BASE + claim['file']:08x}",
            "phaseTable": f"0x{BASE + phases['file']:08x}",
            "stateOffset": STATE_OFFSET,
            "modeOffset": MODE_OFFSET,
            "cursors": claim["layout"],
            "steady": phases["band"],
        }
        if flash:
            entry["flash"] = flash
        if draw:
            cfg = (draw - BASE)
            entry["configure"] = f"0x{draw:08x}"
            entry["configureSub"] = None
            for o in range(cfg, min(cfg + 0x80, top), 4):
                w = words.get(o)
                if w is None:
                    break
                if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_V0:
                    nxt = words.get(o + 4)
                    if nxt is not None and _op(nxt) in (0x04, 0x05) and _rt(nxt) == R_V0:
                        entry["configureSub"] = _imm(w & 0xFFFF)
                        break
            entry["reseeds"] = reseeds(words, cfg, min(cfg + 0x80, top))
        # Every table this member names, with its entries, so the browser needs
        # no overlay at run time.
        addrs = [c["seed"] for c in claim["layout"] if c["seed"]]
        addrs += [p["table"] for p in phases["band"] if p["kind"] == "run"]
        addrs += [f["table"] for f in flash]
        tables: dict[str, list[list[int]]] = {}
        for a in addrs:
            num = int(a, 16)
            if a not in tables:
                tables[a] = read_clip_table(words, num)
        entry["tables"] = tables
        out.append(entry)
    return out


def check(out: dict[str, list[dict]]) -> None:
    """The tool controls itself: every member it ships must be fully described."""
    for stage, members in out.items():
        for m in members:
            for slot in m["cursors"]:
                if slot["rec"] is None:
                    raise UnmodelledShape(f"{stage}: a claim body has no record offset")
            if len(m["cursors"]) != SLOT_COUNT:
                raise UnmodelledShape(f"{stage}: the claim table is not six slots")
            if len(m["steady"]) != SLOT_COUNT:
                raise UnmodelledShape(f"{stage}: the phase band is not six phases")
            seen = {p["kind"] for p in m["steady"]}
            if not seen <= {"off", "literal", "run"}:
                raise UnmodelledShape(f"{stage}: unknown phase kinds {seen}")
            ids = [x["id"] for x in members]
            if len(set(ids)) != len(ids):
                raise UnmodelledShape(f"{stage}: two members share a registry id")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true",
                    help="report what would be written and stop")
    args = ap.parse_args()
    reg = effect_registry()
    found: dict[str, list[dict]] = {}
    refused: list[str] = []
    for path in sorted(WSTAG_DIR.glob("wstag*.s")):
        stage = path.stem[len("wstag"):]
        try:
            got = extract(stage, reg)
        except (UnmodelledShape, ValueError) as exc:
            refused.append(str(exc))
            continue
        if got:
            found[f"s{stage}"] = got
    out = found
    check(out)
    doc = {
        "source": {
            "overlayBase": "0x800a5de0",
            "assembly": "~/ddw3/asm/dw2003/pro/wstagNNN.s",
            "registry": "web/assets/native/fieldstg.bin at 0x8009b3e8",
            "chain": "the field's 18-byte display chain, head at [0x80099d90]",
            "tool": "tools/extract_display_slot_ensembles.py",
            "stepper": "each overlay's own clip stepper, the port of 0x800a60b0",
            "methodBlock": "EXE F0x800143dc / F0x80014504",
        },
        "summary": {
            "members": sum(len(v) for v in out.values()),
            "stages": len(out),
            "slotsPerMember": SLOT_COUNT,
        },
        "stages": {k.lstrip("s"): {m["idHex"]: m for m in v} for k, v in out.items()},
    }
    if args.check:
        print(json.dumps(doc["summary"], indent=1))
        for stage, members in out.items():
            for v in members:
                print(stage, v["idHex"], v["tick"], "tags", v["tagBase"],
                      "stride", v["cursorStride"],
                      "steady", [p["kind"] for p in v["steady"]])
        for line in refused:
            print("REFUSED:", line, file=sys.stderr)
        return 0
    args.out.write_text(json.dumps(doc, indent=1, ensure_ascii=True) + "\n")
    print("stages %d -> %s" % (len(out), args.out))
    for line in refused:
        print("REFUSED:", line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
