#!/usr/bin/env python3
"""Mine the overlays whose stage object builds a POOL OF CHILD OBJECTS.

DECODE (original assembly, authority 2). One family of stage overlays holds a
PARENT object whose state 0 spawns a fixed number of CHILD objects through the
resident child allocator (`jal F0x80014504`) and keeps the pointers in an array,
and whose state 1 runs a CLIP machine that pokes one child at a time. Three
overlays carry such a parent, and the registry names all three:

  shape   member      stage  tick         obj   children  child machine
  pads    848/0x350   s545   0x800a648c   0x60  5         the ported pad flash
  triple  830/0x33e   s460   0x800a5de0   0x50  10        a walk integrator
  triple  829/0x33d   s526   0x800a5de0   0x50  12        a walk integrator

The shape is found by the code, never by a hand list:

  * a BUILDER is a routine that calls one of the two resident allocators
    (`F0x800143dc` / `F0x80014504`, the same ALLOCATORS set the display-slot
    extractor uses);
  * a PARENT is a routine that calls a builder more than once -- with several
    `jal`s, or with one `jal` inside a loop whose bound is a `slti $sN, K` and
    whose back-edge branches below the `jal`;
  * a MAKER is a builder that also parks at least three words in the child it
    returned, and the offsets it parks them at are the SHAPE: `{+0x58, +0x50,
    +0x54}` is `pads` (each child claims the record carrying its own atlas tag
    and moves that record onto the coordinates the parent gave it), `{+0x52,
    +0x53, +0x54}` is `triple` (each child is stamped with a slot, a group and
    a kind and runs a machine of its own).

Each member's id comes from its own constructor address against the shipped
FIELDSTG.PRO effect registry, so membership is the registry and never the code
alone. A parent whose arms this tool cannot describe is REFUSED
(`UnmodelledShape`) rather than shipped as a guess.

DELAY SLOTS. A `j`'s delay slot always runs, and in the configure table it is
where the selector value actually comes from: every `li $v0, N` is followed by a
`j` whose delay slot loads the NEXT value, so an arm that reads `li $v0, 1` out
of the table stores 2. This tool takes the LAST `li` before the store.

Run:
  taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/extract_child_pool_parents.py --out web/assets/data/child_pool_parents.json
  taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/extract_child_pool_parents.py --check
"""

from __future__ import annotations
import os

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WSTAG_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
NATIVE = ROOT / "web/assets/native"
FIELDSTG = ROOT / "web/assets/native/fieldstg.bin"
POINT_SPRITES = ROOT / "web/assets/data/point_sprites.json"
OUT = ROOT / "web/assets/data/child_pool_parents.json"

BASE = 0x800A5DE0            # every wstag overlay's load address
CHAIN_HEAD = 0x80099D90      # `lui $v0,0x800a / lw $aY,-0x6270($v0)`
EFFECT_REGISTRY = 0x8009B3E8
FIELDSTG_BASE = 0x80082CB0
ALLOCATORS = {0x800143DC, 0x80014504}
SCRIPT_END = 0xFF
CLIP_COUNT = 6               # `sltiu $v0, $v1, 0x6` in every clip band

# Register numbers, so a field is named rather than guessed.
R_V0, R_V1, R_A0, R_A1, R_A2 = 2, 3, 4, 5, 6
R_S0, R_S1, R_S3 = 16, 17, 19

# The two triple layouts, by the offsets the maker stores them at IN ORDER. The
# order is part of the shape, not a detail: `s750`'s builder parks the same three
# offsets as `s545`'s but in a different order (`wstag750` file 0xc34-0xc3c stores
# `+0x54`, `+0x58`, `+0x50` where `wstag545` file 0x2a8-0x2b0 stores `+0x58`,
# `+0x50`, `+0x54`), which makes its children's fields mean something else. A
# builder whose order is neither of these is REFUSED, not folded in.
SHAPE_OFFSETS = {
    "pads": (0x58, 0x50, 0x54),
    "triple": (0x54, 0x53, 0x52),
}

# The master story ordinal, and the twelve-byte spawn table in FIELDSTG's own
# image that names one factory per extra-object id.  Both are read below, never
# typed in: `stage_load_gate` finds the ordinal compare in the overlay's own
# code, and `spawn_table_slot` finds the factory's row in FIELDSTG.PRO.
#
# The ordinal lives at RAM 0x8004b370, which `wstag460` file 0x1208 forms as
# `lui $v0, 0x8005` / `lw $v0, -0x4c90($v0)` -- the WHOLE pair is 0x8004b370,
# and the low half alone is not an address.
ORDINAL_GLOBAL = 0x8004B370
ORDINAL_HI = 0x8005            # lui high half
ORDINAL_LO = -0x4C90           # lw offset from it
# The spawn table: FIELDSTG file 0x17ca8 = RAM 0x8009a958, records of twelve
# bytes {factory, id, param}, read out of the shipped FIELDSTG image.
SPAWN_TABLE_FILE = 0x17CA8
SPAWN_TABLE_STRIDE = 12


class UnmodelledShape(Exception):
    """A shape this tool found and cannot describe. Reported, never guessed."""


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


def _jal(w: int) -> int:
    return 0x80000000 + ((w & 0x03FFFFFF) << 2) if _op(w) == 0x03 else 0


def _branch_target(w: int, at: int) -> int | None:
    """The file offset a conditional branch at `at` goes to, or None.

    `j`/`jal` do NOT use this: they carry a 26-bit word offset against the whole
    image segment, which lands a hundred kilobytes outside the overlay if it is
    read as a 16-bit halfword one. `_jump_file` is the rule for those.
    """
    if _op(w) in (0x04, 0x05, 0x06, 0x07):
        return (at + 4 + (_imm(w & 0xFFFF) << 2)) & 0xFFFFFFF
    return None


def _jump_file(w: int) -> int | None:
    """The file offset a `j`/`jal` goes to, or None.

    A jump's target is `segment_base | (word << 2)` with NO pc added, so the
    overlay's own load address has to come off afterwards.
    """
    if _op(w) not in (0x02, 0x03):
        return None
    return ((w & 0x03FFFFFF) << 2) - (BASE - 0x80000000)


def ram(off: int) -> str:
    return "0x%08x" % (BASE + off)


class Image:
    """One wstag overlay: the words, the bytes, and loud failure on a bad read."""

    def __init__(self, stage: str):
        self.stage = stage
        self.data = (NATIVE / ("s%s.bin" % stage)).read_bytes()
        self.words = ovs.load_words(WSTAG_DIR / ("wstag%s.s" % stage))
        self.top = max(self.words) + 4 if self.words else 0

    def word(self, off: int) -> int:
        if not 0 <= off <= len(self.data) - 4:
            raise UnmodelledShape("word at file %#x is outside s%s" % (off, self.stage))
        return struct.unpack_from("<I", self.data, off)[0]

    def half(self, off: int) -> int:
        if not 0 <= off <= len(self.data) - 2:
            raise UnmodelledShape("halfword at file %#x is outside s%s" % (off, self.stage))
        return struct.unpack_from("<H", self.data, off)[0]

    def byte(self, off: int) -> int:
        if not 0 <= off < len(self.data):
            raise UnmodelledShape("byte at file %#x is outside s%s" % (off, self.stage))
        return self.data[off]

    def signed_half(self, off: int) -> int:
        v = self.half(off)
        return v - 0x10000 if v & 0x8000 else v

    def script(self, off: int) -> list[list[int]]:
        """`{value, hold, next}` entries through the 0x00ff end marker."""
        out: list[list[int]] = []
        for _ in range(256):
            v = self.half(off)
            h = self.half(off + 2)
            out.append([v, h, 0])
            if v == SCRIPT_END:
                return out
            off += 4
        raise UnmodelledShape("the script at file %#x in s%s has no end marker"
                              % (off, self.stage))


def is_jr(w: int | None) -> bool:
    """`jr $rs` -- and nothing else.

    `jr` and `sll` share opcode 0 and funct 0x08, and `sll` is what a delay-slot
    nop disassembles to (`sll $zero, $zero, 2` at `wstag545` file 0x7c4 reads as
    0x400008 and would otherwise close the routine early). Every routine in
    these overlays ends in `jr $ra`, so the target register is what separates
    them.
    """
    return (w is not None and _op(w) == 0x00 and (w & 0x3F) == 0x08
            and _rt(w) == 0 and (w & 0x03E0) == 0 and _rs(w) == 31)


def is_prologue(w: int | None) -> bool:
    """`addiu $sp, -N`, the frame opener every routine in these overlays starts with.

    `addiu $sp, -N` encodes BOTH $rs and $rt as 29 -- the assembler writes the
    register pair, not a `move_` -- so the source field is 29 here, NOT zero.
    A `li` is `addiu $rX, $zr, imm`, whose source IS zero.
    """
    return (w is not None and _op(w) == 0x09 and _rs(w) == 29
            and _rt(w) == 29 and _imm(w & 0xFFFF) < 0)


def function_start(words: dict[int, int], off: int) -> int | None:
    """Walk back to the prologue `addiu $sp, -N` that opens the routine.

    The walk starts AT `off`, so file offset 0 -- which is how a parent whose
    tick IS the overlay base opens -- is a prologue like any other.
    """
    j = off
    while j >= 0:
        if is_prologue(words.get(j)):
            return j
        j -= 4
    return None


def function_bounds(words: dict[int, int], site: int) -> tuple[int, int] | None:
    """[start, end) of the routine containing `site`."""
    start = function_start(words, site)
    if start is None:
        return None
    for o in range(site + 4, min(site + 0x2000, max(words) + 4), 4):
        w = words.get(o)
        if w is None:
            break
        if is_jr(w):
            return start, o + 8
    return start, site + 0x2000


def routine_starts(words: dict[int, int]) -> list[int]:
    return sorted(o for o in words if is_prologue(words[o]))


def effect_registry() -> dict[str, int]:
    """ctor address (lower-case hex) -> effect id, from the shipped registry.

    fieldstg F0x8009243c walks 12-byte {id, ctor, draw} entries at 0x8009b3e8 and
    stops at the first zero id. Read out of FIELDSTG.PRO (authority 4) so the id
    pairing is read, not assumed.
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


def la_address(words: dict[int, int], off: int, base_op: int = 0x09) -> int | None:
    """The RAM address an `lui` plus a load on it materialises at `off`.

    The `lui` is not always the instruction right before the load -- the original
    interleaves stores between them (`wstag545` file 0x18c `lui $v0, 0x800a` /
    `:0x190 sh $zr, 0x60($s0)` / `:0x194 lhu $v0, 0x6d26($v0)`) -- so the search
    walks back up to eight instructions for the nearest `lui` whose destination
    is the load's BASE register.
    """
    w = words.get(off)
    if w is None or _op(w) != base_op:
        return None
    for k in range(1, 9):
        lui = words.get(off - k * 4)
        if lui is None:
            return None
        if _op(lui) == 0x0F and _rt(lui) == _rs(w):
            return (((lui & 0xFFFF) << 16) + _imm(w & 0xFFFF)) & 0xFFFFFFFF
        if _op(lui) == 0x0F:
            return None
    return None


def la_any(words: dict[int, int], off: int, base_op: int | None = None) -> int | None:
    """Like `la_address` but for any immediate-carrying op, load or arithmetic.

    `la_address` reads `lui` + `addiu`/`ori`, which is how the overlay names its
    OWN words.  The stepper's frame-delta pointer is reached the other way round
    -- `lui $v0, 0x8005` then `lw $v0, -0x2064($v0)` -- so the same search has to
    accept a load with a NEGATIVE offset, which is how 0x8004df9c is spelled.
    """
    w = words.get(off)
    if w is None:
        return None
    op = _op(w)
    if base_op is not None and op != base_op:
        return None
    if op not in (0x09, 0x0D, 0x23, 0x24, 0x25, 0x21):
        return None
    for k in range(1, 9):
        lui = words.get(off - k * 4)
        if lui is None:
            return None
        if _op(lui) == 0x0F and _rt(lui) == _rs(w):
            return (((lui & 0xFFFF) << 16) + _imm(w & 0xFFFF)) & 0xFFFFFFFF
        if _op(lui) == 0x0F:
            return None
    return None


# ── the stage-load creation gate ─────────────────────────────────────────────
#
# Each stage overlay that builds one of these parents FOR ITSELF does it in a
# one-shot poller: an object whose first tick asks its own `+0x38` (advanceState,
# so it only ever runs once) and then builds the parent if the master story
# ordinal is still below the stage's own bound.  `wstag460` file 0x1208-0x1228:
#
#   lui   $v0, 0x8005
#   lw    $v0, -0x4c90($v0)      ; [0x8004b370], the master story ordinal
#   slti  $v0, 0xf                ; the SHORT form: slti $v0, $v0, 0xf
#   beqz  $v0, .L0x0000122c       ; at or above the bound: build nothing
#   jal   0x800a5fc8             ; the member's own registry constructor
#   li    $a0, 0x33e              ; IN THE DELAY SLOT, so it always runs
#   sw    $v0, ($s0)              ; also in a delay slot: the handle out
#
# The two delay slots are why the rule below reads the `jal`'s OWN next word and
# never the branch it falls through from.

def spawn_table_slot(factory: int) -> dict | None:
    """The FIELDSTG spawn-table row that names `factory`, read from the image.

    The table is a union over every stage: its factory column points into
    whichever overlay is loaded at 0x800A5DE0, which is why a row's id is the
    only stage-independent thing about it.  Returns None when no row names the
    factory, which is itself the answer the document needs.
    """
    try:
        blob = FIELDSTG.read_bytes()
    except OSError:
        return None
    off = SPAWN_TABLE_FILE
    while off + SPAWN_TABLE_STRIDE <= len(blob):
        f, eid, param = struct.unpack_from("<III", blob, off)
        if not (BASE <= f < BASE + 0x20000):
            return None
        if f == factory:
            return {"factory": "0x%08x" % f, "id": eid, "param": param,
                    "file": "0x%x" % off,
                    "ram": "0x%08x" % (FIELDSTG_BASE + off)}
        off += SPAWN_TABLE_STRIDE
    return None


def _builds(words: dict[int, int], at: int, ctor: int, eid: int) -> bool:
    """The `jal` at `at` calls `ctor` with `eid` in its own delay slot."""
    if _jal(words.get(at, 0)) != ctor:
        return False
    slot = words.get(at + 4)
    return (slot is not None and _op(slot) == 0x09 and _rs(slot) == 0
            and _rt(slot) == R_A0 and _imm(slot & 0xFFFF) == eid)


def stage_load_gate(img: "Image", entry: dict) -> dict | None:
    """The ordinal gate this member's stage builds it under, read from its code.

    Returns None when the overlay has no such gate for this member, which is
    the answer for a member no stage code creates at load.
    """
    words = img.words
    ctor = int(entry["ctor"], 16)
    eid = int(entry["id"])
    for start in routine_starts(words):
        bounds = function_bounds(words, start)
        if bounds is None:
            continue
        _, end = bounds
        for o in range(start, end - 8, 4):
            # 1. the ordinal read: `lui $r, 0x8005` + `lw $r, -0x4c90($r)`
            if _op(words.get(o, 0)) != 0x0F or (words[o] & 0xFFFF) != ORDINAL_HI:
                continue
            reg = _rt(words[o])
            ld = words.get(o + 4)
            if ld is None or _op(ld) != 0x23 or _rs(ld) != reg:
                continue
            if _rt(ld) != reg or _imm(ld & 0xFFFF) != ORDINAL_LO:
                continue
            # 2. the compare, then the branch that skips the build
            for k in (1, 2, 3):
                cmp_off = o + 4 + k * 4
                cmp_w = words.get(cmp_off)
                if cmp_w is None or _op(cmp_w) != 0x0A:
                    continue
                if _rs(cmp_w) != reg or _rt(cmp_w) != reg:
                    continue
                bound = _imm(cmp_w & 0xFFFF)
                br_off = cmp_off + 4
                br = words.get(br_off)
                if br is None or _op(br) not in (0x04, 0x05):
                    continue
                if _rs(br) != _rt(cmp_w) and _rt(br) != _rt(cmp_w):
                    continue
                # 3. the build the branch guards
                for j in range(br_off + 4, min(br_off + 0x40, end), 4):
                    if _builds(words, j, ctor, eid):
                        factory = _poller_factory(img, start)
                        return {
                            "ordinal": "0x%08x" % ORDINAL_GLOBAL,
                            "below": bound,
                            "pollerTick": ram(start),
                            "gateAt": ram(cmp_off),
                            "branchAt": ram(br_off),
                            "buildAt": ram(j),
                            "pollerFactory": factory["ram"] if factory else None,
                            "spawnSlot": spawn_table_slot(factory["off"]) if factory else None,
                        }
    return None


def _poller_factory(img: "Image", tick: int) -> dict | None:
    """The routine that allocates the poller whose tick is `tick`.

    `F0x80014504`/`F0x800143dc` take the tick as their first argument, so the
    factory is the routine whose allocator call forms this exact address.
    """
    words = img.words
    want = BASE + tick
    for start in routine_starts(words):
        bounds = function_bounds(words, start)
        if bounds is None:
            continue
        for o in range(bounds[0], bounds[1] - 4, 4):
            if _jal(words.get(o, 0)) not in ALLOCATORS:
                continue
            if la_address(words, o - 0x10, base_op=0x09) == want or \
               la_address(words, o - 0x14, base_op=0x09) == want or \
               la_address(words, o - 0x0c, base_op=0x09) == want:
                return {"off": BASE + start, "ram": ram(start),
                        "allocAt": ram(o)}
    return None


# ── builders, makers, parents ────────────────────────────────────────────────

def allocator_site(words: dict[int, int], start: int, end: int) -> tuple[int, int] | None:
    """(offset of the `jal`, object size) for the allocator this routine calls."""
    for o in range(start, end - 4, 4):
        if _jal(words.get(o, 0)) not in ALLOCATORS:
            continue
        size = None
        for k in range(o - 0x14, o, 4):
            w = words.get(k)
            if w is not None and _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_A1:
                size = _imm(w & 0xFFFF)
        if size is not None:
            return o, size
    return None


def maker_stores(words: dict[int, int], call: int, end: int) -> list[int]:
    """The child-object offsets a builder parks data in, after its allocator call.

    `sw $s0, 0x54($v0)` is opcode 0x2b with the child pointer in `rs`; `sb` is
    0x28 and `sh` 0x29. The allocator's `jal` leaves the child in $v0 and a store
    can sit in that `jal`'s DELAY SLOT, so the scan starts AT the call.
    """
    out: list[int] = []
    for o in range(call, min(call + 0x40, end), 4):
        w = words.get(o)
        if w is None or _op(w) not in (0x28, 0x29, 0x2B):
            continue
        if _rs(w) != R_V0:
            continue
        off = _imm(w & 0xFFFF)
        if 0 < off <= 0x7F and off not in out:
            out.append(off)
    return out


def classify_shape(stores: list[int]) -> str | None:
    for name, want in SHAPE_OFFSETS.items():
        if tuple(stores[:3]) == want:
            return name
    return None


def builders_of(words: dict[int, int]) -> tuple[dict[int, str | None], dict[int, list[int]]]:
    """file offset -> shape name, for every routine that calls an allocator.

    The second return value is every builder's stored offsets, so a PARENT that
    calls one whose order is neither shape can say so instead of staying quiet.
    """
    out: dict[int, str | None] = {}
    stores_of: dict[int, list[int]] = {}
    for s in routine_starts(words):
        end = function_bounds(words, s)
        if end is None:
            continue
        site = allocator_site(words, s, end[1])
        if site is None:
            continue
        stores = maker_stores(words, site[0], end[1])
        shape = classify_shape(stores) if len(stores) >= 3 else None
        out[s] = shape
        stores_of[s] = stores
    return out, stores_of


def loop_bound(words: dict[int, int], start: int, call: int) -> int:
    """How many times the `jal` at `call` runs: the back-edge loop, or once.

    The loop is FORWARD of the `jal` -- `slti $sN, K` then `bnez $v0, HEAD`
    where HEAD is below the `jal` (`wstag545` file 0x774/0x778, head 0x758,
    `jal` 0x768) -- so the walk starts at the `jal` and looks forward for the
    first conditional branch whose target is inside the routine and below the
    `jal`. The bound is the `slti $sX, K` (opcode 0x0a) between the head and the
    branch, on the register the branch reads.
    """
    for o in range(call + 4, min(call + 0x60, max(words) + 4), 4):
        w = words.get(o)
        if w is None:
            break
        if _op(w) != 0x05:
            continue
        tgt = _branch_target(w, o)
        if tgt is None or not (start <= tgt <= call - 4):
            continue
        reg = _rs(w)
        for k in range(tgt, o, 4):
            b = words.get(k)
            if b is None:
                break
            # `slti $vX, $sY, K` puts its RESULT in `rt`, which is the register
            # the branch then reads; its source field is the compared register.
            if _op(b) == 0x0A and _rt(b) == reg:
                return _imm(b & 0xFFFF)
        return 1
    return 1


def child_calls(words: dict[int, int], start: int, end: int,
                builders: dict[int, str | None]) -> list[dict]:
    """Every `jal builder` in the routine, with the count of children it makes."""
    out: list[dict] = []
    for o in range(start, end - 4, 4):
        target = _jal(words.get(o, 0)) - BASE
        if target not in builders:
            continue
        out.append({"call": o, "builder": target,
                    "count": loop_bound(words, start, o),
                    "shape": builders[target]})
    return out


# ── the parent's own clip machine ────────────────────────────────────────────

def chain_reads(words: dict[int, int], start: int, end: int) -> list[int]:
    """The offsets in the routine where it reads the display-chain head."""
    hits = []
    for off in range(start, end - 4, 4):
        w = words.get(off)
        nxt = words.get(off + 4)
        if w is None or nxt is None or _op(w) != 0x0F or _op(nxt) != 0x23:
            continue
        if _rs(nxt) != _rt(w):
            continue
        if ((((w & 0xFFFF) << 16) + _imm(nxt & 0xFFFF)) & 0xFFFFFFFF) != CHAIN_HEAD:
            continue
        hits.append(off)
    return hits


def dispatch_tables(words: dict[int, int], start: int, end: int) -> list[int]:
    """Every jump table the routine dispatches through, as file offsets.

    The shape is `lw $vX, ($vY)` / `nop` / `jr $vX`, walked BACKWARDS to the
    `addiu` that materialises the table base -- the forward distance is not
    fixed. `addu` is a SPECIAL (destination in `rd`) and `jr` names its target in
    `rs`, which is what the two field reads below are for.
    """
    out: list[int] = []
    for o in range(start, end - 12, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x23 or (w & 0xFFFF) != 0 or words.get(o + 4) != 0:
            continue
        jr = words.get(o + 8)
        if jr is None or _op(jr) != 0x00 or _rs(jr) != _rt(w):
            continue
        reg, base = _rt(w), _rs(w)
        for k in range(1, 25):
            a = words.get(o - k * 4)
            if a is None:
                break
            if _op(a) != 0x00 or (a & 0x3F) != 0x21 or _rd(a) not in (reg, base):
                continue
            addr = None
            for m in range(k + 1, k + 56):
                b = words.get(o - m * 4)
                if b is None:
                    break
                if _op(b) == 0x09 and _rt(b) == _rt(a):
                    hi = 0
                    if _rs(b) != 0:
                        for j in range(o - k * 4 - 4, o - k * 4 - 320, -4):
                            c = words.get(j)
                            if c is None:
                                break
                            if _op(c) == 0x0F and _rt(c) == _rs(b):
                                hi = (c & 0xFFFF) << 16
                                break
                    addr = (hi + _imm(b & 0xFFFF)) & 0xFFFFFFFF
                    break
            if addr is not None and BASE <= addr < BASE + 0x10000 \
                    and addr - BASE not in out:
                out.append(addr - BASE)
            break
    return out


def claim_tag(words: dict[int, int], start: int, end: int) -> int | None:
    """The atlas tag the parent's OWN row is claimed by.

    Read from the walk itself: the record's tag byte is loaded into `$v0` by
    `lbu $v0, -1($vX)`, and the NEXT conditional branch that reads `$v0` compares
    it against a register whose current value is a literal the routine loaded
    with `li`. Which register that is varies (`$t0` on s545's sibling copies, `$a2`
    on s545 itself, `wstag545` file 0x704/0x710/0x718), so the value is tracked
    rather than the register.
    """
    lit: dict[int, int] = {}
    seen_tagbyte = False
    for o in range(start, end - 4, 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x09 and _rs(w) == 0:
            lit[_rt(w)] = _imm(w & 0xFFFF)
        elif _op(w) == 0x24 and _rt(w) == R_V0:  # lbu $v0, imm($vX)
            seen_tagbyte = True
        elif seen_tagbyte and _op(w) in (0x04, 0x05):
            other = _rt(w) if _rs(w) == R_V0 else _rs(w)
            if _rs(w) == R_V0 or _rt(w) == R_V0:
                if other in lit:
                    return lit[other]
    return None


def clip_bodies(img: Image, table: int) -> list[int] | None:
    """The six arm file offsets of a clip table, or None when it is not one."""
    out = []
    for i in range(CLIP_COUNT):
        w = img.word(table + i * 4)
        body = w - BASE
        if not 0 <= body < img.top:
            return None
        out.append(body)
    return out


def _overlay_load(words: dict[int, int], off: int) -> int | None:
    """The overlay address a `lw $rX, LO($vY)` at `off` reads, or None.

    The pair is a `lui` one instruction earlier followed by the `lw` itself
    (`wstag545` file 0x894 `lui $v0, 0x800a` / `:0x898 lw $a1, 0x6dec($v0)`), so
    the `lw` carries the offset and the `lui` the high half. The `addiu` spelling
    works the same way and is accepted too.
    """
    w = words.get(off)
    lui = words.get(off - 4)
    if w is None or lui is None or _op(lui) != 0x0F:
        return None
    if _op(w) not in (0x09, 0x23, 0x24, 0x25) or _rs(w) not in (0, _rt(lui)):
        return None
    return (((lui & 0xFFFF) << 16) + _imm(w & 0xFFFF)) & 0xFFFFFFFF


def arm_flags(img: Image, words: dict[int, int], body: int,
              successor: int, index_of: dict[int, int]) -> dict:
    """What one arm of the parent's clip table does, read out of its own words.

    An arm may do several things and the table's arms OVERLAP: clip 0 stores zero
    into its own row and then jumps into clip 2's body, so the flags are not one
    `kind` each. Recognised here:

      hidesOwnRow  `sb $zr, ($s0)` on the claimed record -- the base register is
                   in `rs`, not `rt`, which is the whole difference between
                   finding it and not;
      pokesChild   a `jalr` whose DELAY SLOT is `li $a1, 2`: the parent pushes a
                   child into its state 2;
      script       `lw $a1, LO($lui)` out of the overlay's own pointer table, i.e.
                   the run this arm steps;
      endSprite    the sprite written on the 0x00ff blank;
      endClip      the clip the arm SETS itself to on that blank;
      cue          the packed sound an `jalr` through `[0x80055c48]` plays, built
                   by a `lui` and an `ori` in the `jalr`'s own delay slot.

    A window with none of these is REFUSED.
    """
    # The window is the arm's OWN code: it ends at the next arm body in file
    # order, because the arms OVERLAP (clip 0 jumps into clip 2's body) and a
    # fixed window would read the next arm's script as this one's.
    end = successor
    out: dict = {"hidesOwnRow": False, "pokesChild": False}
    script_at: int | None = None
    end_sprite: int | None = None
    end_clip: int | None = None
    cue_hi: int | None = None
    last_li_v0: int | None = None
    cue_hi: dict[int, int] = {}
    src_off: dict[int, int] = {}
    arm_arg: int | None = None
    o = body
    while o < end:
        w = words.get(o)
        if w is None:
            break
        nxt = words.get(o + 4)
        # `sb $zr, off($s0)` -- the store's BASE is in `rs`.
        if _op(w) == 0x28 and _rt(w) == 0 and _rs(w) == R_S0:
            out["hidesOwnRow"] = True
        # `sb $vX, off($s0)` -- the BASE register is in `rs` and the VALUE in
        # `rt`, which is the other way round from `sw`'s operand order in the
        # disassembly's own notation.
        if _op(w) == 0x28 and _rs(w) == R_S0 and _rt(w) == R_V0 \
                and _imm(w & 0xFFFF) == 4 and last_li_v0 is not None:
            end_sprite = last_li_v0
        if _op(w) == 0x23:
            src_off[_rt(w)] = _imm(w & 0xFFFF)
        if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_V0:
            last_li_v0 = _imm(w & 0xFFFF)
        # What the arm passes as the stepper's THIRD argument: `li $a2, 1`
        # STOPS on the 0x00ff marker and `move_ $a2, $zr` RESTARTS at entry 0, so
        # the two are different arms of the same copy and an arm that loops has
        # the restart one (wstag545 file 0x930 `move_ $a2, $zr` in clip 5 against
        # :0x80c `li $a2, 1` in clip 1).
        if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_A2:
            arm_arg = _imm(w & 0xFFFF)
        elif _op(w) == 0x00 and (w & 0x3F) == 0x21 and _rs(w) == 0 \
                and _rt(w) == 0 and _rd(w) == R_A2:
            arm_arg = 0
        if _op(w) == 0x0F and _rt(w) == R_A0:
            cue_hi[_rt(w)] = _imm(w & 0xFFFF) << 16
        if _op(w) == 0x23 and _rt(w) == R_A1:
            addr = _overlay_load(words, o)
            if addr is not None and BASE <= addr < BASE + img.top:
                script_at = addr - BASE
        if nxt is not None:
            if _op(w) == 0x00 and (w & 0x3F) == 0x09 and _rs(w) != 0:  # jalr
                target = _rs(w)
                if _op(nxt) == 0x09 and _rs(nxt) == 0 and _rt(nxt) == R_A1:
                    # `+0x28` is the object's setState and `+0x2c` its setClip;
                    # which one a `jalr` is calling is read from the offset its
                    # target register was loaded at, not from the sub number.
                    if src_off.get(target) == 0x28 and _imm(nxt & 0xFFFF) == 2:
                        out["pokesChild"] = True
                    elif src_off.get(target) == 0x2C:
                        end_clip = _imm(nxt & 0xFFFF)
                if src_off.get(target) == 0x5C48 and _op(nxt) == 0x0D \
                        and _rt(nxt) == R_A0 and R_A0 in cue_hi:
                    out["cue"] = "0x%08x" % (cue_hi[R_A0] + _imm(nxt & 0xFFFF))
        o += 4
    for o in range(body, end, 4):
        tgt = _jump_file(words.get(o, 0))
        if tgt is not None and tgt in index_of:
            out["fallsInto"] = index_of[tgt]
    if script_at is not None:
        head = img.word(script_at)
        if not (BASE <= head < BASE + img.top):
            raise UnmodelledShape("clip arm at %#x names a script outside the overlay"
                                  % (BASE + body))
        out["scriptHeader"] = ram(script_at)
        out["script"] = ram(head - BASE)
    if script_at is not None and arm_arg is not None:
        out["arm"] = "stop" if arm_arg != 0 else "restart"
    if end_sprite is not None:
        out["endSprite"] = end_sprite
    if end_clip is not None:
        out["endClip"] = end_clip
    if not (out["hidesOwnRow"] or out["pokesChild"] or script_at is not None
            or "cue" in out):
        raise UnmodelledShape("clip arm at %#x is none of the three shapes"
                              % (BASE + body))
    return out


def configure_subs(img: Image, words: dict[int, int], cfg: int) -> dict[str, dict]:
    """The registry draw word's jump table: sub id -> what its arm writes.

    The table is keyed on `sub - BASE` and each arm is either a `setClip` call
    (`jalr` through obj+0x2c with `li $a1, N` in the delay slot) or a store of a
    selector into obj+0x50. The selector is the LAST `li $v0, N` before that
    store, because every arm here reaches it through a `j` whose delay slot
    carries the next value.
    """
    for o in range(cfg, min(cfg + 0x80, img.top), 4):
        w = words.get(o)
        nxt = words.get(o + 4)
        if w is None or nxt is None or _op(w) != 0x09 or _rs(w) != R_S1:
            continue
        if _op(nxt) != 0x0B:
            continue
        base_sub = -_imm(w & 0xFFFF)
        count = nxt & 0xFFFF
        table = None
        for m in range(1, 12):
            if words.get(o + m * 4) is None:
                break
            addr = la_address(words, o + m * 4)
            if addr is not None and BASE <= addr < BASE + img.top:
                table = addr - BASE
                break
        if table is None:
            raise UnmodelledShape("the configure handler has no jump table")

        arms = [img.word(table + i * 4) - BASE for i in range(count)]
        order = sorted(set(arms))
        nxt = {b: (order[k + 1] if k + 1 < len(order) else b + 0x40)
               for k, b in enumerate(order)}
        out: dict[str, dict] = {}
        for i, arm in enumerate(arms):
            out[str(base_sub + i)] = configure_arm(words, arm, nxt[arm])
        return out
    # A handler that answers ONE sub command carries no table: it compares the
    # operand with a literal and calls straight through (`wstag460` file 0x1bc
    # `li $v0, 0x34c` / `:0x1c0 bne $a1, $v0`). Read the literal the same way.
    for o in range(cfg, min(cfg + 0x80, img.top), 4):
        w = words.get(o)
        nxt = words.get(o + 4)
        if w is None or nxt is None or _op(w) != 0x09 or _rs(w) != 0:
            continue
        if _rt(w) != R_A0:
            continue
        later = words.get(o + 8)
        if later is not None and _op(later) == 0x05 and _rs(later) == R_A1 \
                and _rt(later) == R_V0:
            tail = words.get(o + 12)
            if tail is not None and _op(tail) == 0x09 and _rs(tail) == 0 \
                    and _rt(tail) == R_A1:
                return {"all": {"setClip": _imm(tail & 0xFFFF)}}
    return {}


def configure_arm(words: dict[int, int], arm: int, successor: int) -> dict:
    """One arm of the configure jump table.

    The arms OVERLAP, and for a reason: every selector arm is one `li` and one
    `j`, and the `j`'s DELAY SLOT is where the value that arm actually stores
    comes from (`wstag545` file 0xa64 `li $v0, 1` / `:0xa68 j 0x800a6868` /
    `:0xa6c li $v0, 2` -- the store is 2, not 1). So the window runs from the
    arm's body to the instruction after its own `j`, including that delay slot,
    and an arm that ends in a `j` is read at the jump's TARGET -- the shared tail
    that does the storing.
    """
    if not 0 <= arm < 0x4000:
        raise UnmodelledShape("a configure arm at %#x is outside the overlay"
                              % (BASE + arm))
    stop = min(arm + 0x40, successor) if successor > arm else arm + 0x40
    window: list[int] = []
    o = arm
    jump_to: int | None = None
    while o < stop and o in words:
        window.append(o)
        if _op(words[o]) == 0x02:
            jump_to = _jump_file(words[o])
            if o + 4 in words:
                window.append(o + 4)
            break
        o += 4
    selector = None
    last_li_v0 = None
    set_clip = None
    for o in window:
        w = words[o]
        nxt = words.get(o + 4)
        if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_V0:
            last_li_v0 = _imm(w & 0xFFFF)
        # What the arm passes as the stepper's THIRD argument: `li $a2, 1`
        # STOPS on the 0x00ff marker and `move_ $a2, $zr` RESTARTS at entry 0, so
        # the two are different arms of the same copy and an arm that loops has
        # the restart one (wstag545 file 0x930 `move_ $a2, $zr` in clip 5 against
        # :0x80c `li $a2, 1` in clip 1).
        if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_A2:
            arm_arg = _imm(w & 0xFFFF)
        elif _op(w) == 0x00 and (w & 0x3F) == 0x21 and _rs(w) == 0 \
                and _rt(w) == 0 and _rd(w) == R_A2:
            arm_arg = 0
        if nxt is not None and _op(w) == 0x00 and (w & 0x3F) == 0x09 \
                and _rs(w) != 0 and _op(nxt) == 0x09 and _rs(nxt) == 0 \
                and _rt(nxt) == R_A1:
            set_clip = _imm(nxt & 0xFFFF)
    # Two spellings of the same store: inside the arm (the last table entry has
    # no jump at all) and in the shared tail every other selector arm jumps to.
    for o in window:
        w = words[o]
        if _op(w) == 0x2B and _rs(w) == R_S0 and _imm(w & 0xFFFF) == 0x50 \
                and last_li_v0 is not None:
            selector = last_li_v0
    if selector is None and jump_to is not None and last_li_v0 is not None:
        tail = words.get(jump_to)
        if tail is not None and _op(tail) == 0x2B and _rs(tail) == R_S0 \
                and _imm(tail & 0xFFFF) == 0x50:
            selector = last_li_v0
    if selector is None and set_clip is None:
        raise UnmodelledShape("a configure arm at %#x is neither setClip nor a selector"
                              % (BASE + arm))
    return {"setClip": set_clip, "selector": selector}


def img_top(words: dict[int, int]) -> int:
    return max(words) + 4


# ── the per-child argument rows ──────────────────────────────────────────────

def argument_rows(img: Image, words: dict[int, int], start: int, end: int,
                  shape: str, calls: list[dict]) -> list[dict]:
    """The triples the parent hands each child, in the order it builds them.

    Two shapes of call site, both read from the code:
      * a loop over a table -- an `addiu $sX, TABLE` seeds a table base, the same
        register with a second `addiu` steps it, and three `lw` read +0, +4 and
        +8 into $a0/$a1/$a2 before the `jal`;
      * straight-line sites -- three `li $aN, imm` before each `jal` (`wstag460`
        file 0x50-0x5c and its seven siblings, `wstag526` file 0x58-0x64 and its
        eight).

    Either way the rows are read per CALL SITE in the overlay's own order, and a
    site this tool cannot read is refused rather than guessed. A builder that
    parks no triple into its child takes no arguments at all -- the parent calls
    it bare (`wstag460` file 0x40 `jal 0x800a6358` with nothing set) and the
    child's own tables drive it -- so those sites contribute no row and are
    listed in `builders` instead.
    """
    rows: list[dict] = []
    for c in calls:
        if c["shape"] is None:
            continue
        count = c["count"]
        table = _table_base(words, c["call"], count)
        if table is not None:
            for i in range(count):
                rows.append(_row(img, table + i * 12, i, shape))
            continue
        lit = _literal_triple(words, c["call"])
        if lit is None:
            raise UnmodelledShape(
                "the call at file %#x has neither a table nor three literals"
                % c["call"])
        rows.append(_row_lit(lit, len(rows), shape))
    return rows


def _table_base(words: dict[int, int], call: int, count: int) -> int | None:
    """The file offset of the argument table a call site walks, or None.

    The shape is a `lw $aX, off($sY)` whose BASE register was last written by an
    `addiu $sY, $vZ, TABLE` standing on a `lui`, plus a second `addiu` on the
    same register carrying the stride (`wstag545` file 0x750/0x754/0x758/0x764).
    """
    for k in range(call - 0x28, call - 4, 4):
        w = words.get(k)
        if w is None or _op(w) != 0x23 or _imm(w & 0xFFFF) == 0:
            continue
        base_reg = _rs(w)
        addr = None
        for j in range(k - 4, max(k - 0x20, 0) - 4, -4):
            b = words.get(j)
            if b is None or _op(b) != 0x09 or _rt(b) != base_reg or _rs(b) == 0:
                continue
            # `la_address` reads the `lui` + THIS `addiu` pair, so it is handed
            # the `addiu`'s own offset, not the one before it.
            addr = la_address(words, j)
            if addr is not None and not (BASE <= addr < BASE + 0x10000):
                addr = None
            break
        if addr is None:
            continue
        for m in range(k + 4, k + 20, 4):
            b = words.get(m)
            if b is None or _op(b) != 0x09 or _rs(b) != base_reg or _rt(b) == 0:
                continue
            if _imm(b & 0xFFFF) == 12:
                return addr - BASE
    return None


def _literal_triple(words: dict[int, int], call: int) -> tuple[int, int, int] | None:
    """The $a0/$a1/$a2 values in front of a straight-line call site.

    Three shapes write them and all three count, because a delay slot runs:
      * `li $rX, imm`  -- `addiu $rX, $zr, imm`, so the source field is zero;
      * `move_ $rX, $zr` -- `or $rX, $zr, $zr`, which is a literal zero;
      * `move_ $rN, $rM` -- `or $rN, $rM, $rM`, which COPIES a value already set
        (`wstag460` file 0x54/0x58 set $a1 and $a2 that way before the `jal`).
    The scan runs FORWARD so a later write wins, which is the rule the delay slot
    obeys.
    """
    val: dict[int, int] = {}
    for o in range(max(call - 0x2c, 0), call + 4, 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) in (R_A0, R_A1, R_A2):
            val[_rt(w)] = _imm(w & 0xFFFF)
        elif _op(w) == 0x00 and (w & 0x3F) in (0x21, 0x25):
            # `move_ $rd, $rs` is `addu $rd, $rs, $zr`, so the DESTINATION is in
            # `rd` and the source in `rs`; the `addu $rd,$rs,$rs` spelling of the
            # same copy puts the source in `rt`.
            rd, rs, rt = _rd(w), _rs(w), _rt(w)
            if rt == 0 and rs == 0:
                val[rd] = 0
            elif rt == 0 and rs in val:
                val[rd] = val[rs]
            elif rs == rt and rs in val:
                val[rd] = val[rs]
    if all(r in val for r in (R_A0, R_A1, R_A2)):
        return (val[R_A0], val[R_A1], val[R_A2])
    return None


def _row(img: Image, off: int, index: int, shape: str) -> dict:
    if shape == "pads":
        # The `pads` table row is {X, Y, tag} at +0, +4 and +8, read by the
        # parent's three `lw`s in that order -- `lw $a0, 8($s0)` FIRST, because
        # the maker stores its three arguments into the child at +0x58, +0x50 and
        # +0x54 and the tag is the one that goes to +0x58
        # (wstag545 file 0x758/0x75c/0x760 against :0x2a8-0x2b0).
        return {"index": index, "atlas": img.word(off + 8) & 0xFF,
                "x": img.signed_half(off), "y": img.signed_half(off + 4)}
    word = img.word(off)
    return {"index": index, "slot": word & 0xFF,
            "group": (word >> 8) & 0xFF, "kind": word >> 16}


def _row_lit(lit: tuple[int, int, int], index: int, shape: str) -> dict:
    if shape == "pads":
        return {"index": index, "atlas": lit[0], "x": lit[1], "y": lit[2]}
    return {"index": index, "slot": lit[0], "group": lit[1], "kind": lit[2]}


# ── the child's own machine (the `pads` shape) ───────────────────────────────

def pads_child_machine(img: Image, words: dict[int, int], maker: int) -> dict:
    """Everything the `pads` child needs, read out of the builder and its tick.

    The child is the same actor the pad-flash members already use: it claims the
    point record carrying the tag the parent gave it, moves that record onto the
    coordinates the parent gave it, and in its state 2 steps ONE script. What has
    to be read is:
      * the tick and object size its own builder allocates with;
      * the field the tag comes from -- the parent parks its third word at
        `+0x58` and the child reads that offset back in its claim walk;
      * the two record offsets it parks X and Y in (`sh $vX, K($record + 2)`);
      * the script base (`lui $a1, 0x800a` + `addiu` right before the stepper's
        `jal`) and the hold its claim seeds (`lhu` of the same offset + 2);
      * which copy of the stepper it calls -- a `lhu`/`sh` at `+6` is the u16
        hold and `lbu`/`sb` the u8 one -- and what its call site passes as the
        stepper's THIRD argument (`move_ $a2, $zr` restarts, `li $a2, 1` stops).
    """
    bounds = function_bounds(words, maker)
    if bounds is None:
        raise UnmodelledShape("the child builder at %#x has no bounds" % (BASE + maker))
    site = allocator_site(words, maker, bounds[1])
    if site is None:
        raise UnmodelledShape("the child builder at %#x allocates nothing" % (BASE + maker))
    tick = None
    for o in range(maker, site[0] - 8, 4):
        addr = la_address(words, o)
        if addr is not None and BASE <= addr < BASE + 0x10000:
            tick = addr
            break
    if tick is None:
        raise UnmodelledShape("the child builder at %#x passes no tick"
                              % (BASE + maker))
    tb = function_bounds(words, tick - BASE)
    if tb is None:
        raise UnmodelledShape("the child's tick %#x is not a routine" % tick)
    cend = tb[1]
    tag_field = None
    for o in range(tb[0], cend - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x23:
            continue
        if _rs(w) == R_S0 and 0x50 <= _imm(w & 0xFFFF) <= 0x5F:
            tag_field = _imm(w & 0xFFFF)
            break
    if tag_field is None:
        raise UnmodelledShape("the child at %#x reads no tag field" % tick)
    script = None
    stepper_call = None
    for o in range(tb[0], cend - 4, 4):
        w = words.get(o)
        nxt = words.get(o + 4)
        if w is None or nxt is None:
            continue
        if _op(w) == 0x0F and _rt(w) == R_A1 and _op(nxt) == 0x09 \
                and _rs(nxt) == R_A1:
            addr = (((w & 0xFFFF) << 16) + _imm(nxt & 0xFFFF)) & 0xFFFFFFFF
            if BASE <= addr < BASE + img.top:
                script = addr - BASE
                # The stepper's `jal` is a few instructions further on: the
                # child re-reads its own record pointer and sets the stepper's
                # THIRD argument in between (`wstag545` file 0x244/0x248/0x24c/
                # 0x250/0x254).
                for k in range(o + 4, o + 24, 4):
                    if _jal(words.get(k, 0)):
                        stepper_call = k
                        break
                break
    if script is None:
        raise UnmodelledShape("the child at %#x names no script" % tick)
    # The claim's hold seed is `lhu` of the script's SECOND halfword -- the first
    # entry's own hold -- and the address is built off a `lui`, so it is compared
    # as a RAM address and not as the `lhu` displacement.
    seed_at = None
    for o in range(tb[0], cend - 4, 4):
        if _op(words.get(o, 0)) != 0x25:
            continue
        if la_address(words, o, 0x25) == BASE + script + 2:
            seed_at = o
            break
    if seed_at is None:
        raise UnmodelledShape("the child at %#x seeds no hold" % tick)
    variant = "base-u16"
    sb = function_bounds(words, _jal(words[stepper_call]) - BASE) if stepper_call else None
    if sb is not None:
        for o in range(sb[0], sb[1] - 4, 4):
            w = words.get(o)
            if w is None:
                continue
            if _op(w) == 0x25 and _imm(w & 0xFFFF) == 6:
                variant = "base-u16"
            elif _op(w) == 0x24 and _imm(w & 0xFFFF) == 6:
                variant = "base-u8"
    arm = "restart"
    delay = words.get(stepper_call + 4) if stepper_call else None
    if delay is not None and _op(delay) == 0x09 and _rs(delay) == 0 \
            and _rt(delay) == R_A2:
        arm = "stop" if _imm(delay & 0xFFFF) != 0 else "restart"
    return {
        "tick": ram(tick - BASE),
        "size": site[1],
        "tagField": tag_field,
        "script": ram(script),
        "hold": img.half(script + 2),
        "seedLhu": ram(seed_at),
        "stepper": ram(_jal(words[stepper_call]) - BASE) if stepper_call else None,
        "stepperVariant": variant,
        "stepperArm": arm,
    }


# ── one member ───────────────────────────────────────────────────────────────

def find_allocator_owner(words: dict[int, int], tick: int) -> tuple[int, int, int | None] | None:
    """(constructor file offset, object size, child slots) for the builder of `tick`."""
    for s in routine_starts(words):
        end = function_bounds(words, s)
        if end is None:
            continue
        site = allocator_site(words, s, end[1])
        if site is None:
            continue
        for o in range(s, end[1] - 8, 4):
            if la_address(words, o) != tick:
                continue
            slots = None
            for k in range(site[0], site[0] + 8, 4):
                w = words.get(k)
                if w is not None and _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == R_A2:
                    slots = _imm(w & 0xFFFF)
            return s, site[1], slots
    return None


def extract(stage: str, reg: dict[str, int],
            near: list[dict] | None = None) -> list[dict]:
    path = NATIVE / ("s%s.bin" % stage)
    if not path.exists():
        return []
    img = Image(stage)
    words = img.words
    if not words:
        return []
    builders, builder_stores = builders_of(words)
    out: list[dict] = []
    for start in routine_starts(words):
        end = function_bounds(words, start)
        if end is None:
            continue
        calls = child_calls(words, start, end[1], builders)
        if not calls:
            continue
        total = sum(c["count"] for c in calls)
        if total < 2:
            # One builder, once: this is a CONSTRUCTOR that makes the parent, not
            # a parent of its own (s460 file 0x11cc, the registry draw word).
            continue
        if near is not None:
            for c in calls:
                got = builder_stores.get(c["builder"], [])
                if c["shape"] is None and len(got) >= 3:
                    near.append({"stage": stage, "parent": ram(start),
                                 "builder": ram(c["builder"]),
                                 "stores": got[:4],
                                 "why": ("the three offsets are parked in an order "
                                         "that is neither shape's, so this tool "
                                         "does not know what the child's fields mean")})
        shapes = {c["shape"] for c in calls} - {None}
        if not shapes:
            # A routine that allocates several objects without parking anything
            # into them is not a parent of this shape: the children carry their
            # own data and their own tables (`wstag805` file 0x5de4 calls the one
            # builder 27 times).
            continue
        if len(shapes) != 1:
            raise UnmodelledShape(
                "the parent at %#x builds children of %d different shapes"
                % (BASE + start, len(shapes)))
        shape = shapes.pop()
        owner = find_allocator_owner(words, BASE + start)
        if owner is None:
            continue
        ctor, size, slots = owner
        eid = reg.get(ram(ctor))
        if eid is None:
            # The shape is there but no effect record builds it, so it is not a
            # member of this system -- membership is the registry.
            continue
        draw = reg.get(f"{ram(ctor)}#draw") or 0
        rows = argument_rows(img, words, start, end[1], shape, calls)
        entry = {
            "id": eid,
            "idHex": "0x%03x" % eid,
            "stage": stage,
            "shape": shape,
            "tick": ram(start),
            "ctor": ram(ctor),
            "size": size,
            "childSlots": slots,
            "children": total,
            "childMachine": "pad-flash" if shape == "pads" else "unmodelled",
            "claimsOwnRow": bool(chain_reads(words, start, end[1])),
            "builders": [{"file": ram(c["builder"]), "makes": c["count"],
                          "shape": c["shape"]} for c in calls],
            "rows": rows,
        }
        if shape == "triple":
            entry.update(triple_member(img, words, start, end[1], calls))
        entry.update(describe(img, words, start, end[1], shape, draw, calls, rows))
        if shape == "triple":
            member = triple_row(img, entry, words)
            raw = dict(entry)
            raw.pop("member", None)
            out.append({**member, "decode": raw})
            continue
        if shape == "pads":
            # The engine-shaped row is the top level, so the browser loads this
            # table with no second step; the raw decode of every field the row was
            # read from is kept under `decode` for the tests and the document.
            member = member_of(img, entry, words)
            raw = dict(entry)
            raw.pop("member", None)
            out.append({**member, "decode": raw})
            continue
        out.append({**entry, "member": None, "ported": False,
                    "why": ("the children's own machine is not described by this "
                            "tool, so the member is not ported")})
    return out


def member_of(img: Image, entry: dict, words: dict[int, int]) -> dict:
    """The engine-shaped row for `engine/systems/point-record-actor.ts`.

    Same table shape the `point-record` members carry, so ONE loader and ONE
    machine switch serve both: `machine: "parent"`, one panel for the row the
    parent claims, the child array the parent's state 0 builds, its six-arm clip
    table and the configure handler's jump table.
    """
    specs = []
    scripts: dict[str, list[list[int]]] = dict(entry.get("scripts", {}))
    for i, kid in enumerate(entry["childMachines"]):
        name = "child%d" % i
        scripts[name] = img.script(int(kid["script"], 16) - BASE)
        # One maker, ONE script, N positions: every child this maker builds runs
        # the same run and only differs in the row it claims and where it puts it.
        for row in kid["rows"]:
            specs.append({
                "atlas": row["atlas"],
                "x": row["x"],
                "y": row["y"],
                "script": name,
                "hold": kid["hold"],
                "stepper": kid["stepperVariant"],
                "arm": kid["stepperArm"],
            })
        # One child maker, ONE script, N positions: the rows must name N
        # DIFFERENT atlas tags or two children would claim the same record.
        seen = [r["atlas"] for r in kid["rows"]]
        if len(set(seen)) != len(seen) or len(seen) != kid["makes"]:
            raise UnmodelledShape(
                "s%s: %d child rows for %d children, tags %s"
                % (entry["stage"], len(seen), kid["makes"], seen))
    # The chain index each tag claims, out of the SAME per-stage point table the
    # other point-record members read (`tools/extract_point_sprites.py`), so the
    # record a child claims is found the way the original's walk finds it and not
    # by counting.
    table = point_table(entry["stage"])
    tags = {}
    for tag in [entry["ownRow"]["atlas"]] + [c["atlas"] for c in specs]:
        rows = [i for i, r in enumerate(table) if r.get("atlasFlag") == tag]
        if len(rows) != 1:
            raise UnmodelledShape(
                "s%s: %d records carry atlas tag %d, so the claim walk's own "
                "result is not a single row" % (entry["stage"], len(rows), tag))
        tags[str(tag)] = {"atlas": tag, "index": rows[0]}
    clips = []
    for clip in entry["clips"]:
        out = {k: v for k, v in clip.items() if v is not None}
        out["clip"] = clip["clip"]
        clips.append(out)
    subs = {}
    for key, arm in (entry.get("configureSubs") or {}).items():
        subs[key] = {"setClip": arm.get("setClip"),
                     "selector": arm.get("selector")}
    for key in ("all",):
        if key in (entry.get("configureSubs") or {}):
            raise UnmodelledShape(
                "s%s: the parent answers every sub id, which is not this shape"
                % entry["stage"])
    # The claim seeds the cursor hold from the FIRST script any clip names, which
    # is the same halfword the overlay reads with `lhu` (wstag545 file 0x724).
    seeded = next((c for c in entry["clips"] if c.get("script")), None)
    hold = scripts[seeded["script"]][0][1] if seeded else 0
    return {
        "stage": entry["stage"],
        "id": entry["id"],
        "idHex": entry["idHex"],
        "machine": "parent",
        "tick": entry["tick"],
        "ctor": entry["ctor"],
        "draw": entry["configure"],
        "stepper": entry["childMachines"][0]["stepperVariant"],
        "tags": tags,
        "scripts": scripts,
        "panels": [{"atlas": entry["ownRow"]["atlas"], "hold": hold,
                    "recipe": {}}],
        "children": specs,
        "clips": clips,
        "configureSubs": subs,
        "configureCue": configure_cue(words, int(entry["configure"], 16) - BASE),
        "childObject": entry["childMachines"][0]["tick"],
        "childSize": entry["childMachines"][0]["size"],
    }


def triple_row(img: "Image", entry: dict, words: dict[int, int]) -> dict:
    """The `triple` member as `engine/systems/point-record-actor.ts` reads it.

    One parent, its child MACHINES (one per maker, however many children that
    maker builds) and one SLOT per maker call -- the parent's own state 0 stores
    the i-th pointer in the i-th array slot and its state 2 pokes the i-th slot,
    so the slot list is the parent's own build order and the walker's order.
    """
    table = point_table(entry["stage"])
    machines = []
    for m in entry["machines"]:
        stepper = None
        for key in ("restart", "stop"):
            if m[key].get("stepper"):
                stepper = m[key]["stepper"]
        if not stepper:
            raise refuse("the child at %s names no stepper" % m["tick"])
        rows = []
        for r in m["rows"]:
            row = {"tagSource": r["tag"], "at": r["at"], "copies": r["copies"]}
            rows.append(row)
        machine = {
            "tick": m["tick"],
            "size": m["size"],
            "stepper": stepper,
            "makes": m["makes"],
            "rows": rows,
            "selector": m["selector"],
            "restart": {k: v for k, v in m["restart"].items() if k != "stepper"},
            "stop": {k: v for k, v in m["stop"].items() if k != "stepper"},
            "walks": m["walks"],
            "seed": m["seed"],
        }
        if m["walk"]:
            machine["walk"] = m["walk"]
            machine["speeds"] = None   # filled in once the groups are known
        machines.append(machine)
    # ONE row per claimed tag, resolved against the SAME per-stage point table
    # every other member reads, so a child claims the row the original's walk
    # finds rather than one this tool counted.
    tags: dict[str, int] = {}
    children = []
    group_max = 0
    for slot in entry["slots"]:
        machine = machines[slot["machine"]]
        args = _resolve_args(slot)
        rows = []
        for r in machine["rows"]:
            tag = r["tagSource"]
            if "const" in tag:
                want = tag["const"]
            else:
                stamped = args["a1"]
                if not isinstance(stamped, int):
                    raise refuse(
                        "s%s: a walking child is stamped from a register this tool "
                        "cannot read (%r)" % (entry["stage"], stamped))
                want = stamped + tag["stampedDelta"]
            rows.append(_row_index(entry["stage"], table, tags, want))
        if isinstance(args.get("a2"), int):
            group_max = max(group_max, args["a2"])
        children.append({"machine": slot["machine"], "arraySlot": len(children),
                         "args": args, "rows": rows, "poke": slot["poke"]})
    scripts = entry["scripts"]
    for m in machines:
        for key in ("restart", "stop"):
            name = m[key].get("script")
            if name and name not in scripts:
                raise refuse("s%s: a child names the script %r, which the table does "
                             "not carry" % (entry["stage"], name))
    byte_tables: dict[str, list[int]] = {}
    for m in machines:
        for key in ("restart", "stop"):
            clip = m[key].get("clip")
            if isinstance(clip, dict) and "byteTable" in clip:
                # the table is indexed by the ROW LOOP's own counter, so its
                # length is the number of rows the claim parked -- never a scan
                # for a terminator, because the word after the table is data.
                # the whole table is read once, as long as the largest index any
                # arm touches; each arm keeps its own `offset` into it.
                want = m[key]["rows"] + clip.get("offset", 0)
                table = _byte_table(img, {**clip, "offset": 0}, want)
                if len(byte_tables.get(clip["byteTable"], [])) < want:
                    byte_tables[clip["byteTable"]] = table
    for m in machines:
        if m.get("walk"):
            m["speeds"] = _half_table(img, m["seed"]["speed"], group_max + 1)
    sub = triple_configure(words, int(entry["configure"], 16) - BASE)
    gate = stage_load_gate(img, entry)
    if gate is None:
        raise refuse("s%s: no ordinal gate in the overlay builds this parent, so "
                     "the stage-load path cannot be described"
                     % entry["stage"])
    return {
        "stage": entry["stage"],
        "id": entry["id"],
        "idHex": entry["idHex"],
        "machine": "triple",
        "stageLoadGate": gate,
        "triple": {
            "draw": int(min(int(k) for k in sub)),
            "configureSubs": sub,
            "childSlots": entry["childSlots"],
            "machines": machines,
            "children": children,
            "byteTables": byte_tables,
        },
        "tick": entry["tick"],
        "ctor": entry["ctor"],
        "draw": int(min(int(k) for k in sub)),
        "childSlots": entry["childSlots"],
        "configureSubs": sub,
        "scripts": scripts,
        "byteTables": byte_tables,
        "machines": machines,
        "children": children,
    }


def _row_index(stage: str, table: list[dict], tags: dict[str, int],
               want: int) -> dict:
    """The one record a claim walk naming `want` stops at, or `null`.

    NO record carrying the tag is not a refusal and not a guess: it is what the
    original's own walk finds, and s460's fourth child is exactly that -- the
    stage's table has no row tagged 4, so that child claims nothing and its arm
    writes through whatever the allocator left in the slot.  The engine leaves
    such a child alone, which is the only behaviour that cannot be wrong about
    memory the disc never wrote.
    """
    rows = [i for i, r in enumerate(table) if r.get("atlasFlag") == want]
    if len(rows) > 1:
        raise refuse("s%s: %d records carry atlas tag %d, so the claim walk's own "
                     "result is not a single row" % (stage, len(rows), want))
    if not rows:
        return {"tag": want, "index": None}
    tags[str(want)] = rows[0]
    return {"tag": want, "index": rows[0]}


def _half_table(img: "Image", spec: dict, count: int) -> list[int]:
    """The speed table a walking child reads: `count` halfwords, stride `shift`.

    The count is the number of distinct GROUP values the parent's own calls
    stamp, not a scan for a terminator -- the words after the table are the
    sine data, and reading past them would invent speeds.
    """
    if "halfAt" not in spec:
        raise refuse("the walking child's speed names no table")
    off = int(spec["halfAt"], 16) - BASE
    # `sll $v0, S` scales the stamped BYTE, and each entry is a halfword, so the
    # stride in bytes is S * 2 (wstag460 file 0xf44 `sll $v0, 0x1` / 0xf4c `lhu`).
    shift = (spec.get("shift", 1) or 1) * 2
    return [img.half(off + i * shift) for i in range(count)]


def _byte_table(img: "Image", clip: dict, count: int) -> list[int]:
    """`count` bytes out of a clip table, at the arm's own `offset`."""
    off = int(clip["byteTable"], 16) - BASE + clip.get("offset", 0)
    return [img.byte(off + i) for i in range(count)]


def _resolve_args(slot: dict) -> dict[str, object]:
    """The three call arguments as numbers, following the parent's own copies.

    A straight-line site sets its third argument with `move_ $a2, $a1`, which the
    caller reads as the name of the register it copies; the machine has to
    follow it to the number the parent actually put there, and refuses a copy
    this tool cannot resolve.
    """
    out: dict[str, object] = {}
    for name in ("a1", "a2", "a3"):
        seen = set()
        v = slot.get(name)
        while isinstance(v, str):
            if v in seen or v not in slot:
                raise refuse("the parent copies %s from %s, which this tool cannot "
                             "resolve" % (name, v))
            seen.add(v)
            v = slot.get(v)
        out[name] = v
    return out


def point_table(stage: str) -> list[dict]:
    """The stage's own point records, as `tools/extract_point_sprites.py` wrote them."""
    try:
        doc = json.loads(POINT_SPRITES.read_text())
    except (OSError, ValueError):
        return []
    return ((doc.get("s" + stage) or {}).get("records")) or []


def configure_cue(words: dict[int, int], cfg: int) -> str | None:
    """The packed sound the configure handler plays, read off its own `jalr`.

    The shape is a `jalr` whose target register came from `lw $vX, 0x5c48($vY)` --
    the packed-sound entry -- with the argument built by a `lui` and an `ori` in
    that `jalr`'s DELAY SLOT. No `jalr` of that shape means no cue.
    """
    src_off: dict[int, int] = {}
    lui_a0: int | None = None
    for o in range(cfg, min(cfg + 0x80, 0x4000), 4):
        w = words.get(o)
        nxt = words.get(o + 4)
        if w is None:
            break
        if _op(w) == 0x23:
            src_off[_rt(w)] = _imm(w & 0xFFFF)
        if _op(w) == 0x0F and _rt(w) == R_A0:
            # `lui` carries the high half UNSIGNED: `lui $a0, 0x8004` is
            # 0x80040000, so the pair with `ori $a0, 0x474a` is 0x8004474A.
            lui_a0 = (w & 0xFFFF) << 16
        if nxt is not None and _op(w) == 0x00 and (w & 0x3F) == 0x09 \
                and _rs(w) != 0 and src_off.get(_rs(w)) == 0x5C48 \
                and _op(nxt) == 0x0D and lui_a0 is not None:
            return "0x%08x" % (lui_a0 + _imm(nxt & 0xFFFF))
    return None


def describe(img: Image, words: dict[int, int], start: int, end: int,
             shape: str, draw: int, calls: list[dict], rows: list[dict]) -> dict:
    """The member's own claim, clip machine and configure handler."""
    out: dict = {}
    tables = dispatch_tables(words, start, end)
    clip: dict | None = None
    for t in tables:
        bodies = clip_bodies(img, t)
        if not bodies:
            continue
        order = sorted(set(bodies))
        successor = {}
        for k, b in enumerate(order):
            if k + 1 < len(order):
                successor[b] = order[k + 1]
                continue
            # The LAST arm in file order runs to its own `jr $ra`; anything past
            # that is the next routine, and reading it would invent a cue the arm
            # does not play.
            close = b
            for o in range(b, img.top, 4):
                if is_jr(words.get(o)):
                    close = o + 8
                    break
            successor[b] = close
        # `index_of` keeps the FIRST table index for a body, because clips 2
        # and 4 are the same code and the tail an arm jumps to is clip 2's.
        index_of: dict[int, int] = {}
        for i, b in enumerate(bodies):
            index_of.setdefault(b, i)
        try:
            arms = [arm_flags(img, words, b, successor[b], index_of)
                    for b in bodies]
        except UnmodelledShape:
            continue
        if clip is None and any(a.get("script") for a in arms):
            clip = {"table": ram(t), "arms": arms}
    if shape == "pads":
        tag = claim_tag(words, start, end)
        if tag is None:
            raise UnmodelledShape("the parent's own row has no literal tag")
        if clip is None:
            raise UnmodelledShape("the parent's clip table is not six script arms")
        out["ownRow"] = {"atlas": tag}
        # Each child maker gets ONE spec and the rows it is fed, paired by index:
        # the parent's own row order IS the children's order.
        kids = []
        taken = 0
        for call in calls:
            if call["shape"] is None:
                continue
            spec = pads_child_machine(img, words, call["builder"])
            mine = rows[taken:taken + call["count"]]
            taken += call["count"]
            kids.append(dict(spec, makes=call["count"], file=ram(call["builder"]),
                             rows=mine))
        if taken != len(rows):
            raise UnmodelledShape("%d child rows for %d children" % (len(rows), taken))
        out["childMachines"] = kids
        out["clipTable"] = clip["table"]
        out["clips"] = [{"clip": i, **a} for i, a in enumerate(clip["arms"])]
        out["scripts"] = {}
        for arm in out["clips"]:
            if not arm.get("script"):
                continue
            name = "seq%d" % arm["clip"]
            out["scripts"][name] = img.script(int(arm["script"], 16) - BASE)
            arm["script"] = name
    if draw:
        out["configure"] = ram(draw - BASE)
        out["configureSubs"] = configure_subs(img, words, draw - BASE)
    return out


# ── the `triple` shape: the parent and its FOUR-STATE row children ───────────
#
# A `triple` parent is NOT the `pads` parent of s545.  Its state 0 is
# straight-line code that calls SEVERAL makers and parks one child pointer per
# slot, and its state 2 POKES each child through the child's own configure
# routine.  Each child is a FOUR-STATE actor -- claim / walk-and-restart / stop /
# epilogue -- with its own claim walk, its own copy of the shared script stepper
# and, for two of the makers, its own heading-and-speed walk integrator.
#
# Everything below is mined from the CHILD'S OWN tick routine -- the one the
# maker's own allocator call names, because the first argument to either
# allocator is the tick -- so a child whose machine is not this shape is REFUSED
# rather than half-described.  The pointers are stored in the DELAY SLOT of the
# NEXT maker call, so slot i holds the result of call i: see `slot_stores`.

DELTA_FN = 0x8004DF9C      # `lui $v0, 0x8005 / lw $v0, -0x2064($v0)`
RAND_FN = 0x8004DC0C       # `lui $v0, 0x8005 / lw $v0, -0x23f4($v0)`
RSIN_FN = 0x8002ABCC       # PsyQ rsin, the game's one sine (engine/dw3/rsin.ts)
RCOS_FN = 0x8002AC9C       # PsyQ rcos, the even member of the same pair

# The display chain's records: 18 bytes each, tag byte at +1, active at +2.
REC_SIZE = 0x12
REC_TAG = -1               # `lbu $vX, -1($a0+2)` reads the byte before +2
CHAIN_HEAD_OFF = -0x6270   # `lui $v0, 0x800a / lw $a0, -0x6270($v0)`


def refuse(why: str) -> "UnmodelledShape":
    return UnmodelledShape(why)


def is_stepper(words: dict[int, int], target: int) -> bool:
    """The shared script stepper, recognised by its own five instructions.

    `lh $vX, 0x4($sY)` is the cursor index, a load of the frame-delta pointer at
    `0x8004df9c` is the blank that advances it and a shift by two is the 4-byte
    entry stride.  EVERY overlay carries its own copy of this routine -- and the
    copies differ in their frame size, which is why the stride is read from the
    body and not assumed -- so it is recognised by that body and never by its
    address; the walker's `stepPointRecordCursor` is the port of all of them.
    """
    if target < 0 or target not in words:
        return False
    bounds = function_bounds(words, target)
    if bounds is None:
        return False
    # The walk integrator a child also calls is laid out straight after this
    # routine, so `function_bounds` hands back BOTH bodies for either address.
    # The routine's OWN prologue is the boundary: a target that is not a
    # prologue belongs to the routine that starts at the next one.
    start = target
    while not is_prologue(words.get(start)) and start < bounds[1] - 4:
        start += 4
    if not is_prologue(words.get(start)) or bounds[1] - start < 0x60:
        return False
    has_index = has_delta = has_stride = False
    for o in range(start, bounds[1] - 4, 4):
        w = words.get(o)
        if w is None:
            continue
        # `lh $vX, 0x4($sY)` is the cursor index; the frame is 0x28 bytes, so the
        # same load with 0x28 is the frame size and both are checked.
        if _op(w) == 0x21 and _imm(w & 0xFFFF) == 4:
            has_index = True
        if la_any(words, o) == DELTA_FN:
            has_delta = True
        # `sll $vX, 2` is SPECIAL/SLL with a non-zero shift amount, so the shift
        # is in bits 6..10 and NOT in the immediate field.
        if _op(w) == 0x00 and (w & 0x3F) == 0x00 and ((w >> 6) & 0x1F) != 0:
            has_stride = True
    return has_index and has_delta and has_stride


def stepper_calls(words: dict[int, int], lo: int, hi: int) -> list[tuple[int, int]]:
    """Every `(site, target)` in the arm where the child calls the shared stepper.

    The stepper is recognised by its own body (`is_stepper`), never by the
    address of one particular overlay copy, because every overlay carries its
    own copy of the same routine.
    """
    out: list[tuple[int, int]] = []
    for o in range(lo, hi - 4, 4):
        t = _jal(words.get(o, 0)) - BASE
        if t >= 0 and t in words and is_stepper(words, t):
            out.append((o, t))
    return out


def _arg_literals(words: dict[int, int], lo: int, hi: int,
                  reg: int) -> int | None:
    """The literal `$reg` is given in the arm up to and including `hi`, or None.

    The reach includes the instruction immediately before the call site, because
    that is where the third argument lives: `li $a2, 1` sits at `site - 4`, and a
    scan stopping one instruction short of it reports the call as passing nothing.
    """
    val = None
    for o in range(lo, hi + 4, 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x09 and _rs(w) == 0 and _rt(w) == reg:
            val = _imm(w & 0xFFFF)
        elif _op(w) == 0x00 and (w & 0x3F) == 0x21 and _rs(w) == 0 and _rd(w) == reg:
            val = 0
    return val


def _arg_pointer(words: dict[int, int], lo: int, hi: int, reg: int) -> int | None:
    """A `$reg` loaded with `lui`/`addiu`/`ori` naming a word inside the overlay."""
    for o in range(lo, hi + 4, 4):
        w = words.get(o)
        if w is None or _rt(w) != reg:
            continue
        addr = la_address(words, o)
        if addr is not None and BASE <= addr < BASE + 0x10000:
            return addr
    return None


def _arg_from_object(words: dict[int, int], lo: int, hi: int,
                     reg: int) -> int | None:
    """`addu $aX, $obj, K` -- the argument is a pointer INTO the child object."""
    obj_reg = None
    for o in range(lo, min(lo + 0x20, hi - 4), 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x23 and _imm(w & 0xFFFF) == 0x0C:
            obj_reg = _rs(w)
            break
    if obj_reg is None:
        return None
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x21 and _rs(w) == obj_reg and _rt(w) == reg:
            return _imm(w & 0xFFFF)
    return None


def _call_script(words: dict[int, int], lo: int, hi: int,
                 call: int) -> tuple[str, int | None]:
    """What the child hands the stepper as its script: `(kind, address)`.

    Two forms occur.  A plain `lui $a1` / `addiu $a1` names the script itself; a
    `lw $a1, ($sN)` names a POINTER TABLE the row loop walks by four, one pointer
    per row, and the loop's own bound says how many rows there are.  The two are
    told apart by the instruction that fills `$a1`, never by the address it lands
    on, because a table entry and a script both sit inside the overlay.
    """
    at = _arg_pointer(words, lo, call + 4, R_A1)
    if at is not None:
        return "at", at
    # The `lw $a1, ($sN)` can sit in the call's own DELAY SLOT region -- the
    # overlay puts it at `call - 4` -- so the scan reaches past the call itself.
    for o in range(lo, call + 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x23 or _rt(w) != R_A1 or _imm(w & 0xFFFF) != 0:
            continue
        holder = _rs(w)
        # walk back for the `addiu $sN, $vX, K` / `lui $vX` pair that built it
        for k in range(o - 4, max(lo - 4, o - 0x60) - 4, -4):
            b = words.get(k)
            if b is None:
                continue
            if _op(b) == 0x0F:
                break
            if _op(b) == 0x09 and _rt(b) == holder:
                addr = la_any(words, k)
                if addr is not None and BASE <= addr < BASE + 0x10000:
                    return "table", addr
        return "none", None
    return "none", None


def _row_fields(words: dict[int, int], lo: int, hi: int, call: int,
                counter: int | None, pro: int, obj_reg: int,
                state: int) -> dict[int, object]:
    """What the row's `+0`, `+4` (clip) and `+9` (palette) bytes are each set to.

    A forward scan, because every one of the three is decided by what last
    happened to the register the store names -- and the stores sit in DELAY
    SLOTS, which ALWAYS run, so a `sb` two instructions after the stepper call
    still sees the call's RETURN value in `$v0`.  That is the whole difference
    between "the clip is the step value" and "the clip is a byte out of a table":
    `sb $v0, 4($s0)` in the call's own delay slot takes the return, while the same
    store after an `lbu $v0, ($v0)` takes the table byte.  Any other shape is
    refused rather than guessed at.
    """
    val: dict[int, object] = {}
    fields: dict[int, object] = {}
    writes: dict[int, list[tuple[int, object]]] = {}
    base_reg: dict[int, int] = {}
    obj_words: dict[int, int] = {}
    # The one and zero these arms park live in the PROLOGUE (`li $s2, 1` above
    # the dispatch), so the literal table is seeded from the routine's own start
    # and the arm continues it -- otherwise every store of `$s2` is unnamed.
    val[0] = {"const": 0}                 # `sb $zr, ($row)` reads register zero
    step_from = -1                        # where the stepper's return becomes live
    for o in range(pro, lo - 4, 4):
        b = words.get(o)
        if b is None:
            continue
        if _op(b) == 0x09 and _rs(b) == 0:
            val[_rt(b)] = {"const": _imm(b & 0xFFFF)}
        elif _op(b) == 0x00 and (b & 0x3F) == 0x21 and _rs(b) == 0:
            val[_rd(b)] = {"const": 0}
        elif _op(b) == 0x23 and _imm(b & 0xFFFF) == 0x0C and _rs(b) == obj_reg:
            # `lw $sS, 0xc($obj)` -- the STATE word itself, held in a saved
            # register for the whole routine.  A store out of it carries this
            # arm's own state number, and this tool refuses the arm unless that
            # number is the one it is decoding (see `_show_byte`).
            val[_rt(b)] = {"const": state}
    for o in range(lo, hi, 4):
        w = words.get(o)
        if w is None:
            continue
        op, rs, rt, im = _op(w), _rs(w), _rt(w), _imm(w & 0xFFFF)
        rd_ = _rd(w)
        if o == step_from:
            val[R_V0] = "step"      # the call has returned by now
        if _jal(w) and is_stepper(words, _jal(w) - BASE):
            # The call's own DELAY SLOT runs BEFORE the return, so a store in it
            # still sees the register the call site last wrote.  The return only
            # becomes visible two instructions later.
            step_from = o + 8
            continue
        if op == 0x09 and rs == 0:
            val[rt] = {"const": im}
        elif op == 0x00 and (w & 0x3F) == 0x21:
            # `move_ $rd, $zr`      -- `addu $rd, $zr, $zr`, a literal zero
            # `move_ $rd, $rs`      -- `addu $rd, $rs, $zr`, a copy
            # `addu $rd, $i, $base` -- the row loop's index plus a table base,
            #                         which the following `lbu` reads
            if rs == 0 and rt == 0:
                val[rd_] = {"const": 0}
            elif rt == 0:
                val[rd_] = val.get(rs, {"staleSaved": rs})
                if counter is not None and rs == counter and rs in base_reg:
                    base_reg[rd_] = base_reg[rs]
            elif rs == rt:
                val[rd_] = val.get(rs, {"staleSaved": rs})
            elif rt in base_reg:
                # `addu $vX, $counter, $base` -- the row loop's own index added to
                # a table base.  The following `lbu $vX, ($vX)` reads the entry.
                base_reg[rd_] = base_reg[rt]
                val.pop(rd_, None)
            else:
                val[rd_] = {"staleSaved": rd_}
        elif op == 0x09 and rs != 0:
            # `lui $vX, 0x800a` / `addiu $s6, $vX, 0x73d8` -- a base register
            # pointing into the overlay, which the row loop then indexes.
            addr = la_any(words, o)
            if addr is not None and BASE <= addr < BASE + 0x10000:
                base_reg[rt] = addr
            val.pop(rt, None)
        elif op == 0x23 and rt in base_reg:
            val[rt] = {"wordTable": ram(base_reg[rt] - BASE), "index": "row",
                       "offset": 0}
        elif op == 0x24 and rs in base_reg:
            val[rt] = {"byteTable": ram(base_reg[rs] - BASE), "index": "row",
                       "offset": im}
        elif op in (0x21, 0x25) and rs == obj_reg:
            obj_words[rs] = im
            val[rt] = {"objectHalf": im}
        elif op in (0x28, 0x29) and im in (0, 4, 9, 0xA, 0xC):
            # An arm writes the active byte on EVERY path through it -- show,
            # hide-on-the-end-marker, hide-on-the-selector -- so first or last does
            # not identify the run's own value.  The writes are collected with
            # their offsets and the one that belongs to the run is chosen by its
            # PROXIMITY to the clip and palette writes, which only the show path
            # has.  s526's copy of this machine parks that byte out of `$s2`
            # (file 0x474 / 0x560) and NEVER loads `$s2`, because the register was
            # renamed when the selector was added; that is a stale callee-saved
            # register, so it is recorded as one rather than given a value this
            # tool cannot read.
            writes.setdefault(im, []).append(
                (o, val.get(rt, {"staleSaved": rt})))
    if not writes:
        return {}
    anchor = min((k for k in (4, 0xA) if k in writes), default=None)
    for off, seen in writes.items():
        if off == 0:
            fields[0] = _show_byte(seen, state)
            continue
        if anchor is None:
            fields[off] = seen[-1][1]
            continue
        near = [v for k, v in seen if abs(k - anchor) <= 8]
        fields[off] = near[-1] if near else seen[0][1]
    return fields


def _show_byte(seen: list[tuple[int, object]], state: int) -> dict:
    """The value the arm stores into the record's `active` byte.

    Every arm writes that byte on all three of its paths -- show, hide on the end
    marker, hide on the selector -- so the run's own value is the ONE write whose
    value is a literal 1, and it is the only one that can be: a run either lights
    the record or it does not, and the two hide arms store a register zero, which
    this tool reads as `{"const": 0}`.  A state other than 1 has no literal to
    find, and s526's copies park the STATE word there instead (see
    `_row_fields`), so the arm is refused rather than guessed at.
    """
    lit = [v for _, v in seen if isinstance(v, dict) and v.get("const") == 1]
    if lit:
        return {"const": 1}
    statew = [v for _, v in seen if isinstance(v, dict) and v.get("const") == state]
    if statew and state == 1:
        return {"const": 1}
    raise refuse("the arm parks no literal 1 into the record's active byte "
                 "(saw %s)" % ", ".join(str(v) for _, v in seen))


def clip_source(fields: dict[int, object], lo: int = 0) -> object:
    """The row's clip byte, the row's POSITION, or a refusal.

    A child that does not walk parks a clip into the record's `+4`.  A child that
    does walk parks no clip at all: it writes the record's own `+0xa` and `+0xc`,
    which in the 18-byte record are the row's x and y in whole pixels, from the
    two words its integrator keeps current (`lh 0x6c` / `lh 0x6e`).  Reading that
    as a missing clip is how a moving row ends up pinned to the map.
    """
    got = fields.get(4)
    if got is not None:
        if isinstance(got, dict) and "const" in got:
            return {"const": got["const"]}
        return got
    x, y = fields.get(0xA), fields.get(0xC)
    if isinstance(x, dict) and "objectHalf" in x and isinstance(y, dict) \
            and "objectHalf" in y:
        return {"movesRow": True, "x": x["objectHalf"], "y": y["objectHalf"]}
    raise refuse("the arm at %#x parks neither a clip byte nor a row position"
                 % (BASE + lo))


def palette_source(fields: dict[int, object]) -> object:
    """The row's palette byte: the step value, a constant, a stale register."""
    got = fields.get(9)
    if got is None:
        return None
    if got == "step":
        return "step"
    return got


def row_loop(words: dict[int, int], lo: int, hi: int) -> tuple[int, int | None]:
    """(iterations, the index register) of the arm's own per-record loop.

    The loop is `HEAD: ... slti $v0, $sN, K / bnez $v0, HEAD` with the stepper
    call inside it, so the bound is the `slti` on the register that counter and
    the index register is the one the counter itself starts at zero.
    """
    calls = stepper_calls(words, lo, hi)
    if len(calls) != 1:
        return (1, None) if not calls else (-1, None)
    call = calls[0][0]
    for o in range(call + 8, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x05:
            continue
        tgt = _branch_target(w, o)
        if tgt is None or not lo <= tgt <= call - 4:
            continue
        for k in range(tgt, o, 4):
            b = words.get(k)
            if b is not None and _op(b) == 0x0A and _rt(b) == _rs(w):
                # the counter's own register is the `slti`'s SOURCE
                return _imm(b & 0xFFFF), _rs(b)
    # No back edge: this arm steps ONE record and the claim parked one.  A
    # two-row child always has the loop (s460 file 0x82c / 0x830), so a missing
    # one is a single-row arm rather than an unrecognised loop.
    return 1, None


def object_register(words: dict[int, int], start: int, end: int) -> int | None:
    """The register holding the object, from the dispatch's own `lw $vX, 0xc($reg)`.

    The dispatch is in the routine's PROLOGUE, above the first state arm, so the
    arm alone cannot name the object register every store in it is written
    through.  It is read once from the routine and passed to every reader.
    """
    for o in range(start, min(start + 0x60, end - 4), 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x23 and _imm(w & 0xFFFF) == 0x0C:
            return _rs(w)
    return None


def _tag_bases(words: dict[int, int], lo: int, hi: int,
               rec_reg: int) -> dict[int, int]:
    """`{register: byte offset it adds to the record}`, for the tag reads.

    Every copy walks the chain with `addiu $vX, $a0, 2` and then reads the tag
    with `lbu $vY, -1($vX)`, so the register that holds the tag byte is the
    record PLUS TWO, and the tag byte is the record's own `+1`.  Child G does it
    with `$a0` instead of `$vX`, which is why the register is tracked and not
    assumed.
    """
    out: dict[int, int] = {}
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x09 or _rs(w) != rec_reg:
            continue
        im = _imm(w & 0xFFFF)
        if im in (1, 2):
            out[_rt(w)] = im
    return out


def claim_rows(words: dict[int, int], lo: int, hi: int,
               obj_reg: int) -> list[dict]:
    """Every record the claim walk parks, where it parks it and what it copies.

    The walk compares the record's tag byte against a literal the arm loaded with
    `li` or against the byte the parent stamped at `obj+0x52` (`lbu $aY, 0x52($obj)`,
    sometimes `addiu`-ed by a constant), and on a match stores the record pointer
    into the object.  WHERE the store is depends on the branch's own form and both
    forms occur: a `beq` JUMPS to the match path, so its store is at the branch's
    target and, when the target is itself a `j`, in that `j`'s delay slot -- which
    ALWAYS runs; a `bne` SKIPS the match, so its store is the fall-through, two
    instructions on.  Reading either one as the other is how a claim walks onto the
    wrong row.
    """
    lit: dict[int, tuple[str, int]] = {}
    stamped: dict[int, tuple[int, int]] = {}
    rec_reg = None
    rows: list[dict] = []
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x23 and _imm(w & 0xFFFF) == CHAIN_HEAD_OFF:
            rec_reg = _rt(w)
    if rec_reg is None:
        raise refuse("the claim arm reads no display chain at %#x" % (BASE + lo))
    bases = _tag_bases(words, lo, hi, rec_reg)
    tag_bases = set(bases)
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None:
            continue
        op, rs, rt, im = _op(w), _rs(w), _rt(w), _imm(w & 0xFFFF)
        if op == 0x09 and rs == 0:
            lit[rt] = ("const", im)
        elif op == 0x24 and rs == obj_reg and 0x50 <= im <= 0x5F:
            stamped[rt] = (im, 0)
        elif op == 0x09 and rs != 0 and rt in stamped:
            field, delta = stamped[rt]
            if _op(words.get(o - 4, 0)) != 0x21:      # not a halfword read of obj
                stamped[rs] = (field, delta + im)
        if op not in (0x04, 0x05):
            continue
        tag_reg = None
        for k in range(max(lo, o - 0x40), o, 4):
            b = words.get(k)
            if b is None or _op(b) != 0x24 or _imm(b & 0xFFFF) != REC_TAG:
                continue
            if _rs(b) in tag_bases:
                tag_reg = _rt(b)
                break
        if tag_reg is None:
            continue
        other = rt if rs == tag_reg else rs if rt == tag_reg else None
        if other is None:
            continue
        site = _branch_target(w, o) if op == 0x04 else o + 8
        if site is None:
            continue
        store = words.get(site)
        if store is None or _op(store) != 0x2B:
            store = words.get(site + 4)      # a `j` whose delay slot parks
        if store is None or _op(store) != 0x2B or _rs(store) != obj_reg:
            continue
        if other in lit:
            tag: object = {"const": lit[other][1]}
        elif other in stamped:
            tag = {"stampedAt": stamped[other][0], "stampedDelta": stamped[other][1]}
        else:
            raise refuse("the claim at %#x compares a tag this tool cannot name"
                         % (BASE + o))
        row = {"tag": tag, "at": _imm(store & 0xFFFF), "copies": []}
        rows.append(row)
        # the copies a walking child makes right after the store: the record's own
        # signed x and y, then the same pair shifted up eight bits into 16.8.
        seen: set[tuple[int, int, int]] = set()
        for k in range(site, min(site + 0x60, hi), 4):
            b = words.get(k)
            if b is None or _op(b) != 0x2B or _rs(b) != obj_reg:
                continue
            # A STORE names its value in `rt` and its base in `rs` -- the
            # opposite way round from a load -- so the copy's source register is
            # the store's `rt`, not its `rs`.
            value = _rt(b)
            src = None
            for m in range(k - 4, max(site, k - 0x20) - 4, -4):
                c = words.get(m)
                if c is None or _op(c) != 0x21 or _rt(c) != value:
                    continue
                if _rs(c) in bases:
                    src = (_imm(c & 0xFFFF) + bases[_rs(c)], _rs(c))
                    break
            if src is None:
                continue
            # `sll $vX, 8` is SPECIAL with funct 0 and the shift AMOUNT in bits
            # 10..6 -- not funct 4, which is SLLV -- and it is what turns the
            # claimed row's whole-pixel x/y into the integrator's 16.8 words
            # (wstag460 file 0xefc/0xf00 and 0xf08/0xf0c).
            prev = words.get(k - 4)
            shift = 8 if prev is not None and _op(prev) == 0x00 \
                and (prev & 0x3F) == 0x00 and ((prev >> 6) & 0x1F) == 8 else 0
            key = (src[0], _imm(b & 0xFFFF), shift)
            if key in seen:
                continue
            seen.add(key)
            row["copies"].append({"record": src[0], "object": _imm(b & 0xFFFF),
                                  "shift": shift})
    if not rows:
        raise refuse("the claim arm parks no record")
    return rows


def _seed_words(words: dict[int, int], lo: int, hi: int, obj_reg: int) -> dict[str, object]:
    """The object's own words the claim arm parks BEFORE it walks the chain.

    These are the per-member constants: the selector, the two cleared cursor
    halves and the two halfwords read straight out of the overlay with `lhu`.
    """
    out: dict[str, object] = {}
    lit: dict[int, int] = {}
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None:
            continue
        op, rs, rt, im = _op(w), _rs(w), _rt(w), _imm(w & 0xFFFF)
        if op == 0x09 and rs == 0:
            lit[rt] = im
        if op == 0x29 and rs == obj_reg and rt == 0 and 0x50 < im < 0x80:
            out["%#x" % im] = 0
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x29 or _rs(w) != obj_reg:
            continue
        off = _imm(w & 0xFFFF)
        if off in (0x58, 0x60) or off not in (0x5A, 0x62):
            continue
        src = _rt(w)
        for k in range(o - 4, max(lo - 4, o - 0x30) - 4, -4):
            b = words.get(k)
            if b is None:
                continue
            if _op(b) == 0x25 and _rt(b) == src:
                addr = la_address(words, k)
                if addr is None:
                    reg = src
                    for m in range(k - 4, max(lo - 4, k - 0x10) - 4, -4):
                        c = words.get(m)
                        if c is not None and _op(c) == 0x23 and _rt(c) == reg:
                            addr = la_address(words, m)
                if addr is not None and BASE <= addr < BASE + 0x10000:
                    out["%#x" % off] = {"halfAt": ram(addr - BASE)}
                break
            if _op(b) == 0x09 and _rs(b) == 0 and _rt(b) == src:
                out["%#x" % off] = {"const": _imm(b & 0xFFFF)}
                break
    return out


def wander_seed(words: dict[int, int], lo: int, hi: int, obj_reg: int) -> dict:
    """The three words a WALKING child parks in its claim arm, read by pattern.

    Only the walking shape has them and only the walking shape needs them, so
    each is matched against the ONE instruction that produces it and refused
    otherwise -- this is the object integrator's own state, not a table:

      * `obj+0x72`, the step PERIOD, is a literal the claim arm stores
        (`li $v0, 0x28` / `sh $v0, 0x72($s0)`, wstag460 file 0xf2c/0xf30);
      * `obj+0x70`, the blank COUNTER, is the child's own stamped word copied in
        (`lhu $v1, 0x54($s0)` / `sh $v1, 0x70($s0)`, file 0xf28/0xf38);
      * `obj+0x74`, the SPEED, is a halfword out of an overlay table indexed by
        the child's own stamped BYTE (`lbu $v0, 0x53($s0)` / `sll $v0, 0x1` /
        `addu $v0, $v1` / `lhu $v0, ($v0)` with `$v1` the table base, file
        0xf34/0xf44/0xf48/0xf4c).
    """
    out: dict[str, object] = {}
    want = {0x70: "counter", 0x72: "period", 0x74: "speed"}
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x29 or _rs(w) != obj_reg:
            continue
        off = _imm(w & 0xFFFF)
        if off not in want:
            continue
        src = _rt(w)
        found = None
        if off == 0x74:
            # the SPEED: find the `lbu` of the child's own stamped byte, which is
            # the root of the chain, and follow the table read forward from it
            for k in range(o - 4, max(lo - 4, o - 0x40) - 4, -4):
                b = words.get(k)
                if b is None:
                    break
                if _op(b) == 0x24 and _rt(b) == src and _rs(b) == obj_reg:
                    found = _byte_table_value(words, k, src)
                    break
        else:
            floor = max(lo - 4, o - 0x40)
            for k in range(o - 4, floor - 4, -4):
                b = words.get(k)
                if b is None:
                    break
                if _define_rt(b) != src:
                    continue
                if _op(b) == 0x09 and _rs(b) == 0:
                    found = {"const": _imm(b & 0xFFFF)}
                elif _op(b) == 0x25 and _rs(b) == obj_reg:
                    found = {"copyWord": _imm(b & 0xFFFF)}
                break
        if found is None:
            raise refuse("the walking claim arm's store to obj+%#x is set by an "
                         "instruction this tool cannot read" % off)
        out[want[off]] = found
    for name in ("counter", "period", "speed"):
        if name not in out:
            raise refuse("the walking claim arm parks no %s" % name)
    return out


def _define_rt(w: int) -> int:
    """The register the instruction WRITES, or -1 when it writes none.

    `li $r, imm` writes `$rt`; `move_ $rd, $rs` and `addu $rd, ...` write `$rd`;
    a load writes `$rt`.  Everything else (a branch, a store, a compare) writes
    no register at all, and the walk has to step over it.
    """
    op = _op(w)
    if op in (0x09, 0x0F, 0x23, 0x24, 0x25, 0x21, 0x20, 0x2B):
        return _rt(w)
    if op == 0x00:
        funct = w & 0x3F
        if funct in (0x21, 0x25):
            return _rd(w)
        if funct == 0x00 and ((w >> 6) & 0x1F) != 0:
            return _rd(w)
    return -1


def _byte_table_value(words: dict[int, int], at: int, src: int) -> dict | None:
    """`lbu $r, off($obj)` then `sll $r, S` / `addu $r, $base` / `lhu $r, ($r)`.

    The speed the walking children move at is a halfword out of an overlay table
    indexed by the child's own stamped byte, and the table base is named by a
    `lui`/`addiu` pair a few instructions above the read
    (wstag460 file 0xf34/0xf44/0xf48/0xf4c against 0xf3c/0xf40).
    """
    byte_off = _imm(words[at] & 0xFFFF)
    for m in range(at + 4, at + 0x20, 4):
        c = words.get(m)
        if c is None:
            break
        # `lhu $vX, ($vX)` is the read; `lw` is the same shape on the copies that
        # take a word, and both are the last link of the chain.
        if _op(c) in (0x23, 0x25) and _rt(c) == src and _imm(c & 0xFFFF) == 0:
            addr = None
            for j in range(m - 4, at - 4, -4):
                d = words.get(j)
                if d is None:
                    break
                if _op(d) == 0x0F:
                    break
                if _op(d) == 0x09 and _rs(d) != 0:
                    addr = la_any(words, j)
                    break
            if addr is not None and BASE <= addr < BASE + 0x10000:
                return {"halfAt": ram(addr - BASE), "fromByte": byte_off, "shift": 1}
            return None
    return None


def selector_source(words: dict[int, int], lo: int, hi: int, pro: int) -> dict:
    """What the claim arm parks into `obj+0x50`, the child's selector.

    Every copy either parks a literal or the caller's SECOND argument (`sh $a1,
    0x50`), which is how s526's nine-times maker gives each child its own
    selector.  Both are read from the store's own value register.  The literal
    scan starts at the routine's PROLOGUE, not at the arm: every copy loads its
    `1` with `li $s2, 1` above the dispatch, so an arm-only scan reports no
    selector at all.
    """
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x29 or _imm(w & 0xFFFF) != 0x50:
            continue
        src = _rt(w)
        # A literal wins: the copies that park their caller's `$a0` also `li` it
        # to 1 first, and that literal is the value they write.
        for k in range(o - 4, max(pro - 4, o - 0x80) - 4, -4):
            b = words.get(k)
            if b is None:
                continue
            if _op(b) == 0x09 and _rs(b) == 0 and _rt(b) == src:
                return {"const": _imm(b & 0xFFFF)}
            if _op(b) == 0x00 and (b & 0x3F) == 0x21 and _rs(b) == 0 and _rd(b) == src:
                return {"const": 0}
        if src in (R_A0, R_A1, R_A2):
            return {"from": "arg%d" % (src - R_A0 + 1)}
    raise refuse("the claim arm parks no selector at obj+0x50")


def walk_step(img: "Image", words: dict[int, int], lo: int, hi: int) -> dict | None:
    """The heading-and-speed integrator, when the arm calls one with the child.

    Every word it works on is NAMED by how the routine reaches it, not by its
    number: the phase is the halfword the frame delta is added into, the period
    is the halfword that phase is compared against, the speed is the halfword
    multiplied by the sine pair's return, the seed is the halfword handed to the
    sine, the pixel pair is the two halfwords STORED at the end, and the 16.8
    pair is the two words stored just before them.  `rsin` and `rcos` are the
    resident PsyQ pair (`engine/dw3/rsin.ts`), not overlay code, so they are
    named by address and the engine's own sine serves them.
    """
    call = None
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        nxt = words.get(o + 4)
        if w is None or nxt is None or _jal(w) == 0:
            continue
        if _op(nxt) == 0x00 and (nxt & 0x3F) == 0x21 and _rd(nxt) == R_A0 \
                and _rs(nxt) in (R_S0, R_S1):
            call = o
            break
    if call is None:
        return None
    target = _jal(words[call]) - BASE
    bounds = function_bounds(words, target)
    if bounds is None:
        raise refuse("the walk integrator at %#x has no bounds" % (BASE + target))
    # `function_bounds` walks to the next prologue, so when the integrator is laid
    # out straight after the stepper it hands back BOTH.  The integrator's own
    # `addiu $sp, -K` is the boundary.
    st = target
    while not is_prologue(words.get(st)) and st < bounds[1] - 4:
        st += 4
    if not is_prologue(words.get(st)):
        raise refuse("the walk integrator at %#x has no prologue" % (BASE + target))
    en = bounds[1]
    for o in range(st + 8, bounds[1] - 4, 4):
        if is_jr(words.get(o)) and _op(words.get(o - 4, 0)) == 0x2B \
                and _rt(words[o - 4]) == 31:
            en = o + 8
            break
    # The integrator takes the CHILD as `$a0` and keeps it in a saved register.
    obj_reg = None
    for o in range(st, st + 0x40, 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x00 and (w & 0x3F) == 0x21 and _rs(w) == R_A0:
            obj_reg = _rd(w)
            break
    if obj_reg is None:
        raise refuse("the walk integrator keeps no argument register")
    rsin_at = rcos_at = None
    phase = period = speed = seed = None
    pixels: list[int] = []
    fixed: list[int] = []
    targets: list[int] = []
    reads_rand = False
    reads: dict[int, int] = {}
    radius = None
    delta = None
    for o in range(st, en - 4, 4):
        w = words.get(o)
        if w is None:
            continue
        op, rs, rt, im = _op(w), _rs(w), _rt(w), _imm(w & 0xFFFF)
        if _jal(w) == RSIN_FN:
            rsin_at = o
        elif _jal(w) == RCOS_FN:
            rcos_at = o
        elif _jal(w) and words.get(o + 4) is not None \
                and _op(words[o + 4]) == 0x09 and _rt(words[o + 4]) == R_A1 \
                and _rs(words[o + 4]) == 0:
            radius = _imm(words[o + 4] & 0xFFFF)
        elif op == 0x23 and la_any(words, o) == DELTA_FN:
            delta = o
        elif op == 0x23 and la_any(words, o) == RAND_FN:
            reads_rand = True
        if rs != obj_reg:
            continue
        if op == 0x29:
            pixels.append(im)
        elif op == 0x2B:
            fixed.append(im)
        elif op == 0x21 or op == 0x25:
            reads.setdefault(rt, im)
        elif op == 0x23 and 0x50 < im < 0x70:
            targets.append(im)
    # `slt $vX, $acc, $period` is the period gate, and BOTH of its operands are
    # object halfwords read just above it: the accumulator it added the frame
    # delta into, and the period it compares against.  `slt $v0, $v1` is the
    # short form of `slt $v0, $v0, $v1`, so the period is in the compare's `rs`
    # (which is also its `rd`) and the accumulator in its `rt`.
    for o in range(st, en - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x00 or (w & 0x3F) != 0x2A:
            continue
        period = reads.get(_rs(w))
        phase = reads.get(_rt(w))
        break
    if rsin_at is None or rcos_at is None or not reads_rand:
        raise refuse("the walk integrator is not the heading-and-speed shape")
    if phase is None or period is None:
        raise refuse("the walk integrator names no phase accumulator or no period")
    # the speed is the halfword the `mult` pair carries: `mult` is SPECIAL with
    # funct 0x18, so the opcode field is ZERO and the function is the low word.
    for o in range(st, en - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x00 or (w & 0x3F) != 0x18:
            continue
        for k in range(max(st, o - 0x18), o, 4):
            b = words.get(k)
            if b is not None and _op(b) == 0x21 and _rt(b) == _rt(w) and _rs(b) == obj_reg:
                speed = _imm(b & 0xFFFF)
    for at in (rsin_at, rcos_at):
        for k in range(max(st, at - 0x18), at, 4):
            b = words.get(k)
            if b is not None and _op(b) == 0x21 and _rt(b) == R_A0 and _rs(b) == obj_reg:
                seed = _imm(b & 0xFFFF)
    if speed is None or seed is None:
        raise refuse("the walk integrator names no speed or no heading seed")
    if radius is None:
        raise refuse("the walk integrator re-aims inside no radius")
    if len(pixels) < 2 or len(fixed) < 2:
        raise refuse("the walk integrator writes no position pair")
    return {
        "file": ram(st),
        "phase": phase,
        "period": period,
        "speed": speed,
        "seed": seed,
        "xFixed": sorted(set(fixed))[0],
        "yFixed": sorted(set(fixed))[1],
        "xPixel": sorted(set(pixels))[0],
        "yPixel": sorted(set(pixels))[1],
        "targetX": sorted(set(targets))[0],
        "targetY": sorted(set(targets))[1],
        "radius": radius,
        "rsin": "0x8002abcc",
        "rcos": "0x8002ac9c",
        "quarterTurn": 0x1000,
        "reset": 7,
        "jitterMask": 0xF,
    }


def animate_arm(img: "Image", words: dict[int, int], lo: int, hi: int,
                rows: list[dict], mover: dict | None, pro: int,
                obj_reg: int, state: int) -> dict:
    """One of the child's two animate states: what it steps and what it writes.

    The stepper's THIRD argument is the difference between the two: state 1
    passes zero and RESTARTS its script, state 2 passes one and STOPS on the
    `0x00ff` marker.  Both are read off the call site's own `li`/`move_`.
    """
    count, index = row_loop(words, lo, hi)
    if count != len(rows):
        raise refuse("the arm at %#x walks %d records but the claim parked %d"
                     % (BASE + lo, count, len(rows)))
    calls = stepper_calls(words, lo, hi)
    if not calls:
        # A child with no stepper here parks a CONSTANT clip instead -- s526's
        # child at 0x800a693c holds one picture for its whole run and never
        # animates in state 1 at all.
        fields = _row_fields(words, lo, hi, hi, index, pro, obj_reg, state)
        got = clip_source(fields, lo)
        if not (isinstance(got, dict) and "const" in got):
            raise refuse("the arm at %#x steps no script and parks no constant clip"
                         % (BASE + lo))
        return {"rows": count, "mode": "constant", "active": fields.get(0, {"const": 1}),
                "clip": got, "palette": palette_source(fields)}
    if len(calls) != 1:
        raise refuse("the arm at %#x calls the stepper %d times"
                     % (BASE + lo, len(calls)))
    site, target = calls[0]
    third = _arg_literals(words, lo, site, R_A2)
    if third is None:
        raise refuse("the stepper call at %#x passes no third argument"
                     % (BASE + site))
    kind, addr = _call_script(words, lo, hi, site)
    if kind == "none":
        raise refuse("the stepper call at %#x names no script" % (BASE + site))
    fields = _row_fields(words, lo, hi, site, index, pro, obj_reg, state)
    return {
        "rows": count,
        "mode": "stepper",
        "arm": "stop" if third else "restart",
        "stepper": ram(target),
        "script": ram(addr - BASE) if kind == "at" else {"table": ram(addr - BASE)},
        "active": fields.get(0, {"const": 1}),
        "clip": clip_source(fields, lo),
        "palette": palette_source(fields),
    }


def _palette_source(words: dict[int, int], lo: int, hi: int, call: int,
                    index: int | None) -> object:
    """What the row's palette byte at +9 is, read off the call's own store."""
    for o in (call + 4, call + 8):
        w = words.get(o)
        if w is None or _op(w) != 0x28 or _imm(w & 0xFFFF) != 9:
            continue
        src = _rt(w)
        if src == R_V0:
            return "step"
        for k in range(o - 4, max(lo - 4, o - 0x30) - 4, -4):
            b = words.get(k)
            if b is not None and _op(b) == 0x09 and _rs(b) == 0 and _rt(b) == src:
                return {"const": _imm(b & 0xFFFF)}
            if b is not None and _op(b) == 0x00 and (b & 0x3F) == 0x21 \
                    and _rs(b) == 0 and _rd(b) == src:
                return {"const": 0}
    return None


def stop_markers(words: dict[int, int], lo: int, hi: int) -> dict[str, int] | None:
    """The two values the stop arm compares the stepper's return against.

    `beq $v1, $v0, STOP` after `li $v0, K` is the marker that ends the run and
    sends the child back to state 1; the `bne` below it against a second `li` is
    the marker that only hides the row.  Both are read off their own literal.
    """
    hits: dict[str, int] = {}
    lit: dict[int, int] = {}
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x09 and _rs(w) == 0:
            lit[_rt(w)] = _imm(w & 0xFFFF)
        if _op(w) == 0x04 and _rs(w) == R_V0:
            other = _rt(w)
            if other in lit and lit[other] not in hits.values():
                hits.setdefault("stop", lit[other])
        if _op(w) == 0x05 and _rs(w) == R_V0:
            other = _rt(w)
            if other in lit and lit[other] not in hits.values():
                hits.setdefault("end", lit[other])
    if "stop" not in hits or "end" not in hits:
        return None
    return hits


def hold_gate(words: dict[int, int], lo: int, hi: int,
               obj_reg: int) -> dict | None:
    """The arm's own countdown: which word, by how much, and the test it runs.

    Two forms occur and both are read from the arm's own instructions: a halfword
    decremented by one and tested for its low bit (`sll $v0, 0x10` / `bgtz` --
    go on while it is odd), and a halfword decremented by four and compared with
    `slti $vX, $v0, K` after a sign extend.
    """
    loads: list[tuple[int, int]] = []
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x25 or _rs(w) != obj_reg:
            continue
        off = _imm(w & 0xFFFF)
        step = None
        for k in range(o, min(o + 0x10, hi - 4), 4):
            b = words.get(k)
            if b is not None and _op(b) == 0x09 and _rs(b) == _rt(w) and _rs(b) != 0:
                step = _imm(b & 0xFFFF)
        if step is None or off in (0x50, 0x54):
            continue
        loads.append((off, step))
    for off, step in loads:
        for o in range(lo, hi - 4, 4):
            w = words.get(o)
            if w is not None and _op(w) == 0x00 and (w & 0x3F) == 0x00 \
                    and ((w >> 6) & 0x1F) == 16 and _rs(w) != 0:
                return {"field": off, "step": step, "op": "even"}
        for o in range(lo, hi - 4, 4):
            w = words.get(o)
            nxt = words.get(o + 4)
            if w is not None and _op(w) == 0x0A and _rt(w) == 2 and nxt is not None \
                    and _op(nxt) == 0x0B and ((nxt >> 16) & 0xFFFF) == 0x10 \
                    and _rs(nxt) == _rs(w):
                return {"field": off, "step": step, "op": "lt",
                        "value": _imm(nxt & 0xFFFF)}
    return None


def wait_gate(words: dict[int, int], lo: int, hi: int,
               obj_reg: int) -> dict | None:
    """The arm's own countdown on the poke's word, when it also has one."""
    for o in range(lo, hi - 4, 4):
        w, nxt = words.get(o), words.get(o + 4)
        if w is None or nxt is None or _op(w) != 0x2B or _rs(w) != obj_reg:
            continue
        if _op(nxt) == 0x06 and _rs(nxt) == 0 and _rt(nxt) == _rs(w):
            return {"field": _imm(w & 0xFFFF), "step": -1, "op": "positive"}
    return None


def speed_table(img: "Image", words: dict[int, int], lo: int, hi: int,
                 obj_reg: int) -> dict | None:
    """The halfword table a walking child reads its SPEED out of.

    `lbu $vX, K($obj)` names the group byte the parent stamped, `sll $v0, 0x1`
    doubles it and `lhu $v0, ($v0)` indexes a table whose address came from
    `lui`/`addiu`.  All four are read; nothing is transcribed.
    """
    group_reg = None
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x24 and _rs(w) == obj_reg \
                and _imm(w & 0xFFFF) == 0x53:
            group_reg = _rt(w)
    if group_reg is None:
        return None
    table = None
    dest = None
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is None or _op(w) != 0x25:
            continue
        addr = la_address(words, o - 4)
        if addr is not None and BASE <= addr < BASE + 0x10000:
            table = addr
    for o in range(lo, hi - 4, 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x29 and _rs(w) == obj_reg \
                and _imm(w & 0xFFFF) == 0x74:
            dest = _rt(w)
    if table is None or dest is None:
        return None
    return {"at": ram(table - BASE), "groupByte": 0x53, "into": 0x74,
            "stride": 2, "values": [img.half(table - BASE + i * 2) for i in range(8)]}


def child_tick(img: "Image", words: dict[int, int], maker: int) -> dict:
    """The child's own tick, from the maker's OWN allocator call.

    The first argument to either allocator is the tick, so the tick is read off
    the `lui`/`addiu` pair that feeds `$a0` at the maker's call -- never from a
    name and never from the overlay base.
    """
    bounds = function_bounds(words, maker)
    if bounds is None:
        raise refuse("the child builder at %#x has no bounds" % (BASE + maker))
    site = allocator_site(words, maker, bounds[1])
    if site is None:
        raise refuse("the child builder at %#x allocates nothing" % (BASE + maker))
    tick = _arg_pointer(words, maker, site[0], R_A0)
    if tick is None:
        raise refuse("the child builder at %#x passes no tick" % (BASE + maker))
    return {"tick": ram(tick - BASE), "size": site[1], "builder": ram(maker)}


def triple_child_machine(img: "Image", words: dict[int, int], maker: int,
                          makes: int, poke: dict) -> dict:
    """One child machine, described ALL the way from its own tick routine."""
    spec = child_tick(img, words, maker)
    tb = function_bounds(words, int(spec["tick"], 16) - BASE)
    if tb is None:
        raise refuse("%s is not a routine" % spec["tick"])
    arms = state_arms(words, tb[0], tb[1])
    for st in (0, 1, 2):
        if st not in arms:
            raise refuse("the child at %s dispatches on %d states, not four"
                         % (spec["tick"], len(arms)))
    obj_reg = object_register(words, tb[0], tb[1])
    if obj_reg is None:
        raise refuse("the child at %s names no object register" % spec["tick"])
    rows = claim_rows(words, *arms[0], obj_reg=obj_reg)
    mover = walk_step(img, words, *arms[1])
    first = animate_arm(img, words, *arms[1], rows=rows, mover=mover,
                        pro=tb[0], obj_reg=obj_reg, state=1)
    second = animate_arm(img, words, *arms[2], rows=rows, mover=mover,
                         pro=tb[0], obj_reg=obj_reg, state=2)
    markers = stop_markers(words, *arms[2])
    if markers and second["mode"] == "stepper":
        second["stop"] = markers["stop"]
        second["end"] = markers["end"]
    out = {
        **spec,
        "makes": makes,
        "rows": rows,
        "selector": selector_source(words, *arms[0], tb[0]),
        "seed": (wander_seed(words, *arms[0], obj_reg=obj_reg)
                 if mover is not None else
                 _seed_words(words, *arms[0], obj_reg)),
        "restart": first,
        "stop": second,
        "gate": hold_gate(words, *arms[1], obj_reg),
        "wait": wait_gate(words, *arms[1], obj_reg),
        "walks": mover is not None,
        "walk": mover,
        "speeds": speed_table(img, words, *arms[0], obj_reg) if mover is not None else None,
        "poke": poke,
        "stepper": first.get("stepper") or second.get("stepper"),
    }
    if mover is not None:
        # a walking child's claim copies the record's x/y into the words the
        # integrator reads as its target, so the copies are required, not optional
        if not rows[0]["copies"]:
            raise refuse("the walking child at %s copies no target position"
                         % spec["tick"])
    return out


def state_arms(words: dict[int, int], start: int, end: int) -> dict[int, tuple[int, int]]:
    """`{state: (arm begin, next state arm)}` for a four-state dispatch.

    The shape is `lw $vX, 0xc($obj)` then one compare per state: `beq` for 1, 2
    and 3, and `slti $vX, $sS, 2` / `bnez $vX, ARM0` for zero.  The arms are in
    the order they are tested, so the previous arm's target is the current arm's
    end -- which is what the table records.
    """
    obj_reg = None
    st_reg = None
    for o in range(start, min(start + 0x40, end), 4):
        w = words.get(o)
        if w is not None and _op(w) == 0x23 and _imm(w & 0xFFFF) == 0x0C:
            obj_reg, st_reg = _rs(w), _rt(w)
            break
    if st_reg is None:
        raise refuse("the object at %#x reads no state word at +0x0c" % (BASE + start))
    lit: dict[int, int] = {}
    hits: list[tuple[int, int]] = []
    for o in range(start, min(start + 0x60, end), 4):
        w = words.get(o)
        if w is None:
            continue
        if _op(w) == 0x09 and _rs(w) == 0:
            lit[_rt(w)] = _imm(w & 0xFFFF)
        if _op(w) == 0x0A and _rs(w) == st_reg:
            nxt = words.get(o + 4)
            if nxt is not None and _op(nxt) == 0x05 and _rs(nxt) == _rt(w):
                tgt = _branch_target(nxt, o + 4)
                if tgt is not None:
                    hits.append((0, tgt))
        if _op(w) == 0x04 and _rs(w) == st_reg:
            other = _rt(w)
            if other in lit:
                tgt = _branch_target(w, o)
                if tgt is not None:
                    hits.append((lit[other], tgt))
    if sorted(n for n, _ in hits) != [0, 1, 2, 3]:
        raise refuse("the object at %#x dispatches on %d states, not four"
                     % (BASE + start, len(hits)))
    targets = sorted({t for _, t in hits})
    ends: dict[int, int] = {}
    for k, t in enumerate(targets):
        if k + 1 < len(targets):
            ends[t] = targets[k + 1]
            continue
        for o in range(t, end, 4):
            if is_jr(words.get(o)):
                ends[t] = o + 8
                break
        else:
            ends[t] = end
    return {state: (t, ends[t]) for state, t in hits}


def parent_pokes(words: dict[int, int], arms: dict[int, tuple[int, int]],
                 end: int) -> list[int]:
    """The file offsets the parent's own state 2 calls, in slot order.

    The i-th maker call and the i-th `jal` in state 2 are the same child, because
    the parent parks the i-th pointer in the i-th slot and pokes the i-th slot.
    """
    if 2 not in arms:
        return []
    lo, hi = arms[2]
    out = []
    for o in range(lo, hi - 4, 4):
        t = _jal(words.get(o, 0)) - BASE
        if t > 0 and t in words:
            out.append(t)
    return out


def poke_arm(words: dict[int, int], cfg: int) -> dict:
    """What the parent's state 2 stores into one child: its selector and hold."""
    out: dict[str, object] = {}
    for o in range(cfg, cfg + 0x20, 4):
        w = words.get(o)
        if w is None or _op(w) not in (0x29, 0x2B):
            continue
        off = _imm(w & 0xFFFF)
        name = {0x50: "selector", 0x52: "hold", 0x58: "wait"}.get(off)
        if name is None:
            continue
        lit = None
        for k in range(cfg, o, 4):
            b = words.get(k)
            if b is not None and _op(b) == 0x09 and _rs(b) == 0 and _rt(b) == _rt(w):
                lit = _imm(b & 0xFFFF)
        if lit is not None:
            out[name] = lit
    if "selector" not in out:
        raise refuse("the child's poke at %#x stores no selector" % (BASE + cfg))
    return out


def child_arguments(words: dict[int, int], start: int, end: int,
                    calls: list[dict]) -> list[dict]:
    """Each maker call's own three arguments, in slot order.

    They are read off the `li`/`move_` instructions between the previous call and
    this one, so a value the parent left in a register (`move_ $a2, $a1`) is
    reported as the register it copies rather than as a number this tool guessed.
    """
    out: list[dict] = []
    prev = start
    for call in calls:
        args: dict[str, object] = {}
        for o in range(prev, call["call"] + 4, 4):
            w = words.get(o)
            if w is None:
                continue
            if _op(w) == 0x09 and _rs(w) == 0 and R_A0 <= _rt(w) <= R_A2:
                args["a%d" % (_rt(w) - R_A0 + 1)] = _imm(w & 0xFFFF)
            elif _op(w) == 0x00 and (w & 0x3F) == 0x21 and _rs(w) == 0 \
                    and R_A0 <= _rd(w) <= R_A2:
                args["a%d" % (_rd(w) - R_A0 + 1)] = 0
            elif _op(w) == 0x00 and (w & 0x3F) == 0x21 and _rs(w) != 0 \
                    and _rs(w) < _rd(w) and R_A0 <= _rs(w) <= R_A2 \
                    and R_A0 <= _rd(w) <= R_A2:
                args["a%d" % (_rd(w) - R_A0 + 1)] = "a%d" % (_rs(w) - R_A0 + 1)
        out.append(args)
        prev = call["call"] + 8
    return out


def triple_configure(words: dict[int, int], cfg: int) -> dict[str, dict]:
    """The `triple` parent's own draw handler: one sub id, and one `setState`.

    The shape is `beqz $a0` / `li $vX, K` / `bne $a1, $vX, END` and then the
    object's own `+0x28` called with the literal in the `jalr`'s DELAY SLOT
    (wstag460 file 0x1b4-0x1d4, sub id 844; wstag526 file 0x214-0x234, 843).  A
    handler with a jump table, or one that stores anything of its own, is a
    different shape and is refused rather than read as this one.
    """
    out: dict[str, dict] = {}
    for o in range(cfg, cfg + 0x30, 4):
        w = words.get(o)
        if w is None:
            break
        if _op(w) != 0x09 or _rs(w) != 0:
            continue
        key = _rt(w)
        nxt = words.get(o + 4)
        if nxt is None or _op(nxt) != 0x05 or _rs(nxt) != R_A1 or _rt(nxt) != key:
            continue
        # the arm runs from the branch to its own `jr $ra`: find the object
        # method call inside it and read the argument out of its DELAY SLOT.
        for k in range(o + 8, min(cfg + 0x40, img_top(words)) - 4, 4):
            c = words.get(k)
            if c is None:
                break
            if _op(c) == 0x00 and (c & 0x3F) == 0x09 and _rs(c) != 0:
                d = words.get(k + 4)
                if d is None:
                    break
                if _op(d) == 0x09 and _rs(d) == 0 and _rt(d) == R_A1:
                    out[str(_imm(w & 0xFFFF))] = {"setState": _imm(d & 0xFFFF)}
                break
    if not out:
        raise refuse("the parent at %#x answers no sub id this tool can read"
                     % (BASE + cfg))
    return out


def img_top(words: dict[int, int]) -> int:
    return (max(words) + 4) if words else 0


def triple_member(img: "Image", words: dict[int, int], start: int, end: int,
                  calls: list[dict]) -> dict:
    """The whole `triple` shape: one parent, its machines, its per-slot calls."""
    arms = state_arms(words, start, end)
    for st in (0, 2):
        if st not in arms:
            raise refuse("the parent at %#x is not the four-state shape" % (BASE + start))
    pokes = parent_pokes(words, arms, end)
    if len(pokes) != len(calls):
        raise refuse("the parent at %#x pokes %d of its %d children"
                     % (BASE + start, len(pokes), len(calls)))
    args = child_arguments(words, start, end, calls)
    machines: list[dict] = []
    slots: list[dict] = []
    for i, call in enumerate(calls):
        poke = poke_arm(words, pokes[i])
        got = None
        for m in machines:
            if m["builder"] == ram(call["builder"]):
                got = m
                break
        if got is None:
            try:
                got = triple_child_machine(img, words, call["builder"], call["count"], poke)
            except UnmodelledShape as exc:
                raise UnmodelledShape("slot %d, builder %s: %s"
                                      % (i, ram(call["builder"]), exc)) from None
            machines.append(got)
        slots.append({"machine": machines.index(got), "poke": poke, **args[i]})
    # ONE machine per maker is the point: children built by one maker are the same
    # machine, so the machine is described once and the slots carry the arguments.
    # How MANY a maker builds is counted from the slots, not from `loop_bound`:
    # this parent calls its nine-times maker nine times in STRAIGHT-LINE code, so
    # each call site looks like a single iteration to the loop finder and only the
    # slot list knows the real count.
    for i, m in enumerate(machines):
        used = sum(1 for s in slots if s["machine"] == i)
        if used == 0:
            raise refuse("the machine at %s has no slot" % m["builder"])
        m["makes"] = used
        if m["makes"] < len(m["rows"]) and m["walks"]:
            raise refuse("the walking machine at %s claims %d rows for %d children"
                         % (m["builder"], len(m["rows"]), m["makes"]))
    scripts: dict[str, list[list[int]]] = {}
    for m in machines:
        for key in ("restart", "stop"):
            arm = m[key]
            if arm.get("mode") != "stepper":
                continue
            src = arm["script"]
            off = int(src, 16) - BASE if isinstance(src, str) \
                else int(src["table"], 16) - BASE
            name = "%s_%s" % (key, m["builder"].replace("0x", ""))
            if isinstance(src, str):
                scripts[name] = img.script(off)
            else:
                # a pointer table the row loop walks by four: every entry is its
                # own script, and the walk's own bound says how many there are
                count = m[key]["rows"]
                table = []
                for i in range(count):
                    ptr = img.word(off + i * 4)
                    if not BASE <= ptr < BASE + img.top:
                        raise refuse("the script table at %s entry %d points outside "
                                     "the overlay" % (name, i))
                    table.append(img.script(ptr - BASE))
                scripts[name] = table
            arm["script"] = name
    return {"slots": slots, "machines": machines, "scripts": scripts}


# ── self-check and output ────────────────────────────────────────────────────

def check(out: dict[str, list[dict]]) -> None:
    """Every member this tool ships must be described ALL the way down.

    The engine-shaped row and the raw decode are checked separately, because a
    half-described member would otherwise pass by having only one of them.
    """
    for stage, members in out.items():
        ids = [m["id"] for m in members]
        if len(set(ids)) != len(ids):
            raise UnmodelledShape("s%s: two members share a registry id" % stage)
        for m in members:
            raw = m.get("decode") or m
            if raw["children"] < 2:
                raise UnmodelledShape("s%s: a parent with %d children"
                                      % (stage, raw["children"]))
            if raw["shape"] == "pads":
                if len(raw["rows"]) != raw["children"]:
                    raise UnmodelledShape("s%s: %d children but %d rows"
                                          % (stage, raw["children"], len(raw["rows"])))
                if len(raw["clips"]) != CLIP_COUNT:
                    raise UnmodelledShape("s%s: the clip table is not six arms" % stage)
                if raw["childMachine"] != "pad-flash":
                    raise UnmodelledShape("s%s: the pads children are not ported" % stage)
                if m.get("machine") != "parent":
                    raise UnmodelledShape("s%s: the pads member has no engine row"
                                          % stage)
                if len(m.get("children") or []) != raw["children"]:
                    raise UnmodelledShape(
                        "s%s: the engine row has %d children for %d built"
                        % (stage, len(m.get("children") or []), raw["children"]))
                for clip in m.get("clips") or []:
                    if clip.get("script") and clip["script"] not in m["scripts"]:
                        raise UnmodelledShape(
                            "s%s: clip %d names a script the table does not carry"
                            % (stage, clip["clip"]))
                for spec in m.get("children") or []:
                    if spec["script"] not in m["scripts"]:
                        raise UnmodelledShape(
                            "s%s: a child names a script the table does not carry"
                            % stage)
                    if str(spec["atlas"]) not in m["tags"]:
                        raise UnmodelledShape(
                            "s%s: a child claims a tag the table does not carry"
                            % stage)
            else:
                if not raw["rows"]:
                    raise UnmodelledShape("s%s: a triple parent with no argument rows"
                                          % stage)
                if raw.get("clips"):
                    raise UnmodelledShape("s%s: the triple shape has no clip table"
                                          % stage)
                subs = m.get("configureSubs") or {}
                if len(subs) != 1 or next(iter(subs.values())).get("setState") != 2:
                    raise UnmodelledShape(
                        "s%s %s: the parent answers %d sub ids, not the one "
                        "setState(2) arm" % (stage, m["idHex"], len(subs)))
                machines = m.get("machines") or []
                slots = m.get("children") or []
                if len(slots) != raw["children"]:
                    raise UnmodelledShape(
                        "s%s %s: %d child slots for %d built children"
                        % (stage, m["idHex"], len(slots), raw["children"]))
                claimed = 0
                for slot in slots:
                    if not 0 <= slot["machine"] < len(machines):
                        raise UnmodelledShape("s%s %s: a child names no machine"
                                              % (stage, m["idHex"]))
                    if slot["poke"].get("selector") is None:
                        raise UnmodelledShape("s%s %s: a child's poke names no selector"
                                              % (stage, m["idHex"]))
                    claimed += len(slot["rows"])
                for mach in machines:
                    for key in ("restart", "stop"):
                        arm = mach[key]
                        if arm.get("mode") != "stepper" and key == "stop":
                            raise UnmodelledShape(
                                "s%s %s: a child's state 2 steps no script"
                                % (stage, m["idHex"]))
                        name = arm.get("script")
                        if name and name not in m.get("scripts", {}):
                            raise UnmodelledShape(
                                "s%s %s: an arm names the script %r, which the "
                                "table does not carry" % (stage, m["idHex"], name))
                        if arm.get("mode") == "stepper" and not name:
                            raise UnmodelledShape(
                                "s%s %s: an arm steps a script it does not name"
                                % (stage, m["idHex"]))
                    if mach["rows"] and not any(r["index"] is not None
                                               for r in slots[0]["rows"]):
                        pass
                if not claimed:
                    raise UnmodelledShape("s%s %s: no child claims a row"
                                          % (stage, m["idHex"]))
                # every machine's rows must be exactly the count its arms walk
                for mach in machines:
                    n = len(mach["rows"])
                    for key in ("restart", "stop"):
                        if mach[key].get("rows") != n:
                            raise UnmodelledShape(
                                "s%s %s: an arm walks %s records and the claim "
                                "parked %d" % (stage, m["idHex"],
                                               mach[key].get("rows"), n))
                    if mach["walks"] and not mach.get("speeds"):
                        raise UnmodelledShape(
                            "s%s %s: a walking child names no speed table"
                            % (stage, m["idHex"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    reg = effect_registry()
    found: dict[str, list[dict]] = {}
    refused: list[str] = []
    near: list[dict] = []
    for path in sorted(WSTAG_DIR.glob("wstag*.s")):
        stage = path.stem[len("wstag"):]
        try:
            got = extract(stage, reg, near)
        except (UnmodelledShape, ValueError, OSError) as exc:
            refused.append("s%s: %s" % (stage, exc))
            continue
        if got:
            found[f"s{stage}"] = got
    check(found)
    shapes: dict[str, int] = {}
    for members in found.values():
        for m in members:
            shape = (m.get("decode") or m)["shape"]
            shapes[shape] = shapes.get(shape, 0) + 1
    doc = {
        "source": {
            "overlayBase": "0x800a5de0",
            "assembly": "~/ddw3/asm/dw2003/pro/wstagNNN.s",
            "images": "web/assets/native/sNNN.bin",
            "registry": "web/assets/native/fieldstg.bin at 0x8009b3e8",
            "chain": "the field's 18-byte display chain, head at [0x80099d90]",
            "tool": "tools/extract_child_pool_parents.py",
            "methodBlock": "EXE F0x800143dc / F0x80014504",
        },
        "summary": {
            "members": sum(len(v) for v in found.values()),
            "stages": len(found),
            "shapes": shapes,
            "buildersRefusedForAnotherTripleOrder": near,
        },
        # `sNNN` keys, like the table this one feeds: the members land in the SAME
        # registry as the point-record actors, so they must be keyed the same way.
        "stages": {k: {m["idHex"]: m for m in v} for k, v in found.items()},
    }
    if args.check:
        print(json.dumps(doc["summary"], indent=1))
        for stage, members in found.items():
            for m in members:
                raw = m.get("decode") or m
                print(stage, m["idHex"], raw["shape"], m["tick"], "obj", raw["size"],
                      "children", raw["children"],
                      "clips", [(a["clip"], a["hidesOwnRow"], a["pokesChild"],
                                 a.get("script"), a.get("endSprite"),
                                 a.get("endClip"))
                                for a in raw.get("clips", [])],
                      "subs", raw.get("configureSubs"))
        for n in near:
            print("REFUSED: a builder at", n["builder"], "parks",
                  n["stores"], "-- neither shape's order", file=sys.stderr)
        for line in refused:
            print("REFUSED:", line, file=sys.stderr)
        return 0
    args.out.write_text(json.dumps(doc, indent=1, ensure_ascii=True) + "\n")
    print("stages %d -> %s" % (len(found), args.out))
    for line in refused:
        print("REFUSED:", line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())