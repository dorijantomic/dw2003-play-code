"""
Per-stage encounter sweep — keys the authentic encounter table by stage, as the
8-slot zone pools the field engine actually rolls over.

`extract_field_encounters.py` produces the *global* `field_encounters.json`:
screen_id (1..334) -> enemy party. But the field never references a screen_id
directly; each stage overlay (WSTAGNNN) carries **encounter zone blocks**, and the
random-encounter driver picks from them. This tool sweeps every wstag overlay and
emits a stage-keyed index of those pools, which the game joins against
`field_encounters.json` to resolve parties.

## The selection algorithm — DECODED from fieldstg disasm (live-keystone verified)

The per-frame random-encounter driver `fn 0x80092664` (fieldstg file `0xf9b4`) gates
on free-roam scene state, decrements a step counter, and on expiry calls the selector
`fn 0x800925a8` (file `0xf8f8`). The selector is the whole answer:

    player = get_object(5)                       ; the player actor
    zone   = zonecheck(player.x, player.y) & 0xff ; 1-based geographic zone (0 = none)
    index  = zone - 1
    block  = *(scene_ctx[0x80099da0] + index*4 + 0xc)   ; that zone's record block
    slot   = rand() & 7                          ; *** uniform over EIGHT slots ***
    record = *(block + slot*4 + 4)               ; block = rate level + 8-pointer array
    battle_setup(record.screen_id)               ; record.screen_id @+0

So encounter choice is two levels: **(a) geographic zone** — the player's (x,y) selects
which of the map's zone blocks is live; **(b) uniform `rand()&7`** over that zone's 8
slots.

## The step counter — DECODED 2026-07-25 (ENCOUNTER-Q001)

The block's leading word (long documented here as a "pad word") is the zone's
**encounter rate level**, and it is the missing half of the system:

    F0x8008fd74 (file 0xd0c4, the player move handler, 3 call sites):
        if (moving && (actor->+0x18 & 7) == 0 && encountersEnabled) driver();
        actor->+0x18 += 1;              ; => driver runs once per 8 ticks of MOVEMENT
    F0x80092664 (driver):  counter -= RATE[block[0]]; if (counter <= 0) { select(); reset(); }
    F0x8009252c (reset):   r = rand() % 0x900;  counter = r < 0x100 ? r : (r + 0x100)/2
    RATE = {2000, 3, 4, 6, 9, 18} @ RAM 0x8009b6ac (file 0x189fc)

Counter range is therefore 0..1279, so levels 1-5 give roughly 71..426 driver runs
(568..3408 ticks of walking) between rolls. Level 0's 2000 would expire on the first
step; it marks blocks the zone check never selects (all 164 of them; the 151
grid-reachable blocks are all level 1-5) — those are the scripted-trigger path's
(fn 0x800927a0) blocks, which never touch this counter.

Consequences that this tool encodes faithfully:
  - a zone block is exactly **8 slots**; `screen_id == 0` = "no encounter this roll", so
    empties set the encounter *probability* ((8 - empties)/8) and a repeated screen_id is
    a higher-*weight* member of the pool. (s320 zone = [85,85,85,85,86,86,86,86] =
    50/50 Raremon/Cyclonemon, never a miss.)
  - the same screen_id can be both a wild pool member and a scripted story battle: e.g.
    s200 zone = [188, 200, 272, 0,0,0,0,0]; screen 200 = Kuwagamon is *also* the scripted
    Genji fight (a separate path, `fn 0x800927a0`, fired by the wstag script with a fixed
    index into `scene_ctx+0x18`). This sweep is the **random** pools.

## Layout (cross-checked 3 ways)

Each wstag overlay (reconstructed from `~/ddw3/asm/dw2003/pro/wstagNNN.s`, RAM base
0x800A5DE0 — same source `wstag_extract.py` uses) holds zone blocks of 8 records of 12
bytes `{ screen_id:u16@0, 0, param:u16@4, 0, tag:u32@8 }`, each block followed by a pad
word + an 8-entry pointer array (the `block + slot*4 + 4` indexing above). `tag` is always
`0x60xx0000` (high nibble 6 = the battle sentinel, cf. selector `0x600`); empty slots =
`0x60040000`. Verified: 1791 blocks are exactly 8 records; the 8-pointer array reproduces
record file-order in all 604 active blocks (0 mismatches); `rand()&7` matches the slot
count; s200 reproduces the live-read Genji table. `param`/`tag` are battle-context fields
copied to the descriptor (`+0xc`/`+0x14`); semantics unconfirmed, omitted here.

## Zone GROUPS — the scene_struct+0x20 record (decoded 2026-07-27)

`zones[]` is NOT a flat zone-indexed array. The selector reads
`block = *(scene_ctx[0x80099da0] + (zone-1)*4 + 0xc)`, and `0x80099da0` is
`scene_struct + 0x20` — a pointer to **one selector record**:

    struct SelectorRecord { u32 tag; u32 key; u32 zero; ZoneBlock *zone[4]; }  // 0x1c

Every wstag overlay carries N such records (N >= 1) and its init code stores ONE of
them to `scene_struct + 0x20`. Each record owns exactly 4 zone blocks, so the flat
overlay-order block list is **group-major / zone-minor**:

    flat block index = group*4 + (zone - 1)

Structural cross-check over all 203 stages with zone blocks: `len(blocks) == 4 *
len(records)` and every record's four pointers are the contiguous run
`[4g, 4g+1, 4g+2, 4g+3]` — 0 exceptions.

Which record is stored comes in two families, both re-derived here from the overlay's
own MIPS (see `progress_selector()`):

* **`progress_ordinal`** (12 stages) — the init loads the master story-progress ordinal
  `[0x8004b370]` and runs an `slti` chain, then `sw $v0, 0x20($s1)`.
* **`runtime_key`** (27 stages, the Seabed/Circuit self-warp mazes s825-s895 and the
  s96x endgame maps) — the init does `lhu $a1, [0x80048d78]`, then calls the fieldstg
  helper at `scene_struct + 0x7c` with `a0` = the record table, and stores its return
  value. The helper returns the record whose `key` matches. `0x80048d78` is the
  **bank-0x7E** scalar (exe `F0x800163b0`, bank `0x7E` -> `F0x800160a8`, which compares
  it for predicate index < 0x1e and `0x80048d7a` above that). **Nothing in the original
  assembly writes `0x80048d78` through a `%hi/%lo` symbol reference** (`code-search
  "80048d78" --corpus original`: 3 hits, all `lhu` reads in `F0x800160a8`), so its
  producer is UNIDENTIFIED. This tool therefore records the family, the key address and
  each group's `key`, and leaves selection unresolved; consumers must fall back to the
  first record (the walker's pre-2026-07-27 behaviour).

## Output — `web/assets/data/stage_encounters.json`

    { "stages": { "200": { "zones": [
        { "slots": [188, 200, 272, 0, 0, 0, 0, 0] } ] } } }

`slots` is the literal 8-slot pool (0 = miss). Join each nonzero `slot` against
`field_encounters.json` for the party. To approximate the in-game wild pool for a whole
stage (the walker has no live zone geometry), merge every zone's slots into one bag and
weight by count.

Stages with more than one selector record additionally carry:

    "groups":   [ { "tag": 2, "key": 0, "blocks": [0,1,2,3] }, ... ]
    "selector": { "family": "progress_ordinal", "var": "0x8004b370",
                  "site": "0x1d0", "thresholds": [11, 24], "groups": [0,1,2] }

`selector.thresholds` are the literal `slti` constants in code order; evaluation is
`for i, t in enumerate(thresholds): if ordinal < t: return groups[i]` else `groups[-1]`.
Single-record stages carry neither key — their entries are byte-identical to before.

Usage:
  python3 tools/extract_stage_encounters.py            # writes the json
  python3 tools/extract_stage_encounters.py --print    # resolved pools to stdout
"""

import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_extract as W  # overlay_bytes() + ASM_DIR — the same disasm source

ROOT = Path(__file__).resolve().parent.parent
FIELD_ENC = ROOT / "web/assets/data/field_encounters.json"
OUT = ROOT / "web/assets/data/stage_encounters.json"

RECORD = 12       # 12-byte record
ZONE_SLOTS = 8    # rand()&7 -> 8 slots per zone block

# Step-counter decrement per zone rate level. Literal words at fieldstg RAM
# 0x8009b6ac (overlay base 0x80082cb0, file offset 0x189fc), read as
# RATE[block[0]] by the driver fn 0x80092664. Level 0's 2000 exceeds the
# counter's 1279 maximum -> "not a walkable encounter zone" sentinel.
RATE_TABLE = (2000, 3, 4, 6, 9, 18)


def _is_record(w0, w1, w2):
    """A 12-byte trigger record: screen/param are u16, tag = 0x60xx0000."""
    return w0 < 0x10000 and w1 < 0x10000 and (w2 & 0xFFFF) == 0 and (w2 >> 28) == 6


def zone_blocks(data, valid_screens):
    """The 8-slot zone pools in one overlay, file order.

    A zone block is a contiguous run of exactly 8 records (the engine's `rand()&7`
    domain). We drop any record whose screen is neither 0 nor a real encounter screen
    (rare coincidental tag matches glued to a real block) before chunking, then keep
    only runs that resolve to whole 8-slot blocks. Returns [[s0..s7], ...] with each
    si a valid screen_id or 0 (miss).

    Every block is emitted, including one whose eight slots are all 0. The engine
    indexes `zoneArray[zone-1]` positionally, so dropping an all-empty block would
    renumber every block after it (confirmed against live RAM: s330 has four blocks,
    the third all-empty — see the runtime note in the encounter research doc)."""
    out = []
    i, n = 0, len(data)
    while i + RECORD <= n:
        w = struct.unpack_from("<III", data, i)
        if not _is_record(*w):
            i += 4
            continue
        # walk the contiguous record run
        run, j = [], i
        while j + RECORD <= n:
            ww = struct.unpack_from("<III", data, j)
            if not _is_record(*ww):
                break
            run.append(ww[0])  # screen_id
            j += RECORD
        i = j
        # normalise: a slot is a real encounter screen, else 0 (empty/miss); a value
        # that is neither (coincidental match) is dropped so blocks stay 8-aligned.
        slots = [s for s in run if s == 0 or s in valid_screens]
        if len(slots) % ZONE_SLOTS != 0:
            continue  # not a clean block boundary — skip rather than emit garbage
        for k in range(0, len(slots), ZONE_SLOTS):
            out.append(slots[k:k + ZONE_SLOTS])
    return out


def pointer_blocks(data, valid_screens):
    """The same zone blocks, found by their POINTER-ARRAY header instead of the tag run.

    The engine never scans records; it indexes `zoneArray[zone-1]` (scene object +0xc)
    and that pointer lands on a 9-word block header:

        struct ZoneBlock { u32 rate_level; ZoneRecord *slot[8]; }

    F0x800925a8 (selector) reads `block[slot+1]` = the record pointer; F0x80092664
    (driver) reads `*block` = `block[0]` = the **encounter rate level**, an index into
    the 6-word rate table at fieldstg RAM 0x8009b6ac. Returns
    [(file_offset, rate_level, [s0..s7])] in file order — the same order and content as
    `zone_blocks()`, asserted by caller. All-empty blocks are kept so the list index equals
    the engine's `zone - 1` **within the live selector record** (see "Zone GROUPS" above).
    """
    n = len(data)
    rec_screen = {}
    i = 0
    while i + RECORD <= n:
        w = struct.unpack_from("<III", data, i)
        if _is_record(*w):
            rec_screen[i] = w[0]
        i += 4
    out = []
    i = 0
    while i + 4 * 9 <= n:
        words = struct.unpack_from("<9I", data, i)
        level, ptrs = words[0], words[1:]
        offs = [p - W._OVERLAY_BASE for p in ptrs]
        if all(0 <= o < n and o in rec_screen for o in offs):
            slots = [rec_screen[o] for o in offs]
            out.append((i, level, [s if (s == 0 or s in valid_screens) else 0 for s in slots]))
            i += 4 * 9
        else:
            i += 4
    return out


# ---------------------------------------------------------------------------
# Zone GROUPS — the selector records and the init code that picks one of them.
# ---------------------------------------------------------------------------

SELECTOR_RECORD = 0x1C     # { u32 tag; u32 key; u32 zero; ZoneBlock *zone[4]; }
ZONES_PER_RECORD = 4       # the record's pointer array; `zone` is 1..4
SCENE_STRUCT = 0x80099D80  # fieldstg scene object; +0x20 = the live selector record
SCENE_SELECTOR_OFF = 0x20
STORY_ORDINAL = 0x8004B370  # master story-progress ordinal (progress_ordinal.json)
RUNTIME_KEY = 0x80048D78    # bank-0x7E scalar the `runtime_key` family matches on


def selector_records(data, block_offsets):
    """The `{tag, key, 0, ZoneBlock*[4]}` records, file order.

    `block_offsets` is the file offset of every zone block header, in the same order
    `pointer_blocks()` emits them, so the returned `blocks` are indices into `zones[]`.
    """
    index = {W._OVERLAY_BASE + off: i for i, off in enumerate(block_offsets)}
    out, i, n = [], 0, len(data)
    while i + SELECTOR_RECORD <= n:
        w = struct.unpack_from("<7I", data, i)
        if w[2] == 0 and all(p in index for p in w[3:7]):
            out.append({"offset": i, "tag": w[0], "key": w[1],
                        "blocks": [index[p] for p in w[3:7]]})
            i += SELECTOR_RECORD
        else:
            i += 4
    return out


# --- a hair-thin MIPS R3000 interpreter, just enough for a stage-init prologue ------
# Only what wstag init code uses: lui/addiu/ori/addu/or/slt(i)(u)/lw/lhu/lbu/sw/sh/sb/
# beq/bne/j/jal/jr/jalr/nop. Anything else leaves its destination UNKNOWN (None), and a
# branch on an UNKNOWN condition aborts — we never guess a path.
_CALLER_SAVED = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 31)


def _s32(v):
    v &= 0xFFFFFFFF
    return v - 0x100000000 if v & 0x80000000 else v


class _Abort(Exception):
    pass


def _run_init(data, start, ordinal, limit=8000):
    """Interpret the init from file offset `start` with `[0x8004b370] == ordinal`.

    Returns the RAM address last stored to `scene_struct + 0x20`, or None.
    Raises `_Abort` when the path depends on a value this interpreter cannot know.
    """
    reg = [None] * 32
    reg[0] = 0
    pc, n, result, steps = start, len(data), None, 0

    def word(off):
        if off < 0 or off + 4 > n:
            raise _Abort("pc out of overlay")
        return struct.unpack_from("<I", data, off)[0]

    def step(w):
        """Execute one instruction; return a jump target file offset, "end", or None."""
        nonlocal result
        op = w >> 26
        rs, rt, rd = (w >> 21) & 31, (w >> 16) & 31, (w >> 11) & 31
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm & 0x8000 else imm

        def setr(i, v):
            if i:
                reg[i] = None if v is None else v & 0xFFFFFFFF

        if op == 0x00:                                   # SPECIAL
            funct = w & 0x3F
            if funct == 0x08:                            # jr
                return "end" if rs == 31 else "abort"
            if funct == 0x09:                            # jalr
                for r in _CALLER_SAVED:
                    reg[r] = None
                return "call"
            if funct in (0x21, 0x20):                    # addu / add (move)
                a, b = reg[rs], reg[rt]
                setr(rd, None if a is None or b is None else a + b)
            elif funct == 0x25:                          # or
                a, b = reg[rs], reg[rt]
                setr(rd, None if a is None or b is None else a | b)
            elif funct in (0x2A, 0x2B):                  # slt / sltu
                a, b = reg[rs], reg[rt]
                if a is None or b is None:
                    setr(rd, None)
                elif funct == 0x2A:
                    setr(rd, 1 if _s32(a) < _s32(b) else 0)
                else:
                    setr(rd, 1 if a < b else 0)
            else:
                setr(rd, None)
            return None
        if op == 0x02:                                   # j
            return ("jump", ((w & 0x3FFFFFF) << 2 | 0x80000000) - W._OVERLAY_BASE)
        if op == 0x03:                                   # jal
            for r in _CALLER_SAVED:
                reg[r] = None
            return "call"
        if op in (0x04, 0x05):                           # beq / bne
            a, b = reg[rs], reg[rt]
            if a is None or b is None:
                raise _Abort("branch on unknown")
            taken = (a == b) if op == 0x04 else (a != b)
            return ("jump", pc + 4 + simm * 4) if taken else ("fall",)
        if op == 0x09:                                   # addiu
            a = reg[rs]
            setr(rt, None if a is None else a + simm)
        elif op == 0x0A:                                 # slti
            a = reg[rs]
            setr(rt, None if a is None else (1 if _s32(a) < simm else 0))
        elif op == 0x0B:                                 # sltiu
            a = reg[rs]
            setr(rt, None if a is None else (1 if a < (simm & 0xFFFFFFFF) else 0))
        elif op == 0x0C:                                 # andi
            a = reg[rs]
            setr(rt, None if a is None else a & imm)
        elif op == 0x0D:                                 # ori
            a = reg[rs]
            setr(rt, None if a is None else a | imm)
        elif op == 0x0F:                                 # lui
            setr(rt, imm << 16)
        elif op in (0x20, 0x24, 0x21, 0x25, 0x23):       # lb/lbu/lh/lhu/lw
            a = reg[rs]
            addr = None if a is None else (a + simm) & 0xFFFFFFFF
            setr(rt, ordinal if addr == STORY_ORDINAL else None)
        elif op == 0x2B:                                 # sw
            if simm == SCENE_SELECTOR_OFF and reg[rs] == SCENE_STRUCT:
                result = reg[rt]
        elif op in (0x22, 0x26, 0x28, 0x29, 0x2A, 0x2E):  # lwl/lwr/sb/sh/swl/swr
            if op in (0x22, 0x26):
                setr(rt, None)
        else:
            setr(rt, None)
        return None

    while steps < limit:
        steps += 1
        act = step(word(pc))
        if act == "abort":
            raise _Abort("jr through a non-$ra register")
        if act in ("end", "call") or (isinstance(act, tuple) and act[0] in ("jump", "fall")):
            delay = word(pc + 4)
            d = step(delay)
            if isinstance(d, tuple) or d in ("end", "call", "abort"):
                raise _Abort("branch in a delay slot")
            if act == "end":
                return result
            if isinstance(act, tuple) and act[0] == "jump":
                pc = act[1]
            else:
                pc = pc + 8
        else:
            pc += 4
    raise _Abort("instruction budget exhausted")


_LOAD_OPS = {0x20: "lb", 0x21: "lh", 0x23: "lw", 0x24: "lbu", 0x25: "lhu"}


def load_sites(data, addr):
    """File offsets of every `lb/lh/lw/lbu/lhu rt, lo(addr)(rs)` after its matching lui.

    `dw3-research references` and `overlay_scan refs` both MISS these: the former never
    reads assembly, the latter only pairs `lui` with `addiu`. A null result from either
    is not evidence that an overlay does not read a global.
    """
    sites, n, hi = [], len(data), {}
    for i in range(0, n - 3, 4):
        w = struct.unpack_from("<I", data, i)[0]
        op, rs, rt = w >> 26, (w >> 21) & 31, (w >> 16) & 31
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm & 0x8000 else imm
        if op == 0x0F:
            hi[rt] = imm << 16
            continue
        if op in _LOAD_OPS and hi.get(rs) is not None:
            if (hi[rs] + simm) & 0xFFFFFFFF == addr:
                sites.append(i)
        if op == 0x09 and hi.get(rs) is not None and rt != rs:
            hi[rt] = (hi[rs] + simm) & 0xFFFFFFFF
    return sites


def _function_start(data, offset):
    """Nearest preceding `addiu $sp, $sp, -N` (the prologue), else 0."""
    for i in range(offset & ~3, -4, -4):
        w = struct.unpack_from("<I", data, i)[0]
        if (w >> 26) == 0x09 and ((w >> 21) & 31) == 29 and ((w >> 16) & 31) == 29 \
                and (w & 0x8000):
            return i
    return 0


ORDINAL_DOMAIN = 64  # [0x8004b370] is 1..45 in progress_ordinal.json; scan well past it


def progress_selector(data, records):
    """Derive the `progress_ordinal` selector by interpreting the stage's own init.

    Runs the init once per candidate ordinal and records which selector record lands in
    `scene_struct + 0x20`, then compresses the ordinal->record map back into the literal
    `slti` threshold bands. Returns None when the stage has no ordinal-driven store
    (the `runtime_key` family, or a single-record stage that stores unconditionally).
    """
    addr_to_group = {W._OVERLAY_BASE + r["offset"]: g for g, r in enumerate(records)}
    for site in load_sites(data, STORY_ORDINAL):
        start = _function_start(data, site)
        try:
            chosen = [_run_init(data, start, o) for o in range(ORDINAL_DOMAIN)]
        except _Abort:
            continue
        if any(c not in addr_to_group for c in chosen):
            continue
        groups = [addr_to_group[c] for c in chosen]
        if len(set(groups)) < 2:
            continue  # this load does not steer the record choice
        # Compress to `slti` bands: the map must be a step function of the ordinal.
        thresholds, bands = [], [groups[0]]
        for o in range(1, ORDINAL_DOMAIN):
            if groups[o] != groups[o - 1]:
                thresholds.append(o)
                bands.append(groups[o])
        rebuilt = [bands[next((i for i, t in enumerate(thresholds) if o < t), len(bands) - 1)]
                   for o in range(ORDINAL_DOMAIN)]
        assert rebuilt == groups, "ordinal->group map is not a threshold step function"
        return {"family": "progress_ordinal", "var": hex(STORY_ORDINAL),
                "site": hex(site), "thresholds": thresholds, "groups": bands}
    return None


def stage_list():
    return sorted(int(m.group(1)) for p in W.ASM_DIR.glob("wstag*.s")
                  if (m := re.fullmatch(r"wstag(\d+)", p.stem)))


def extract(field_enc):
    valid = {int(k) for k in field_enc["screens"]}
    stages = {}
    for st in stage_list():
        data = W.overlay_bytes(str(st))
        if data is None:
            continue
        zones = zone_blocks(data, valid)
        if not zones:
            continue
        # Cross-check: the pointer-array walk (what the engine actually indexes) must
        # reproduce the tag-scan blocks exactly, in order. It also carries the rate
        # level, which the tag scan cannot see. A divergence means the layout moved.
        ptr_blocks = pointer_blocks(data, valid)
        assert [b for _, _, b in ptr_blocks] == zones, (
            f"s{st}: pointer-array blocks disagree with the tag scan\n"
            f"  ptr: {[b for _, _, b in ptr_blocks]}\n  tag: {zones}")
        entry = {"zones": [{"slots": b, "rate_level": lvl}
                           for _, lvl, b in ptr_blocks]}

        # Zone GROUPS. Each selector record owns 4 blocks; the flat list must be exactly
        # the records' pointer runs, group-major. A stage that fails this is a layout
        # change, not something to paper over.
        records = selector_records(data, [off for off, _, _ in ptr_blocks])
        expected = [[g * ZONES_PER_RECORD + k for k in range(ZONES_PER_RECORD)]
                    for g in range(len(records))]
        assert [r["blocks"] for r in records] == expected and \
            len(ptr_blocks) == len(records) * ZONES_PER_RECORD, (
                f"s{st}: {len(ptr_blocks)} zone blocks do not partition into "
                f"{len(records)} group-major selector records: "
                f"{[r['blocks'] for r in records]}")

        if len(records) > 1:
            entry["groups"] = [{"tag": r["tag"], "key": r["key"], "blocks": r["blocks"]}
                               for r in records]
            sel = progress_selector(data, records)
            if sel is None:
                # `lhu $a1, [0x80048d78]` then `jalr [scene_struct+0x7c]` with
                # a0 = the record table; the helper returns the record whose `key`
                # matches and the init stores it to scene_struct+0x20. 0x80048d78 is
                # the bank-0x7E scalar (exe F0x800163b0 bank 0x7E -> F0x800160a8
                # compares it), and NOTHING in the original assembly writes it by a
                # %hi/%lo symbol reference — its producer is UNIDENTIFIED, so
                # selection stays unresolved and consumers fall back to record 0.
                sites = load_sites(data, RUNTIME_KEY)
                assert sites, "runtime_key stage with no load of 0x80048d78"
                sel = {"family": "runtime_key", "var": hex(RUNTIME_KEY),
                       "site": hex(sites[0]), "unresolved": True,
                       "note": ("record chosen at runtime by the scene_struct+0x7c helper "
                                "matching `key` against [0x80048d78] (bank 0x7E); that "
                                "scalar's writer is not identified")}
            entry["selector"] = sel
        stages[st] = entry
    return stages


def main(argv=None):
    do_print = "--print" in (argv if argv is not None else sys.argv[1:])
    if not FIELD_ENC.exists():
        print(f"missing {FIELD_ENC.relative_to(ROOT)} — run extract_field_encounters.py first",
              file=sys.stderr)
        return 1
    field_enc = json.loads(FIELD_ENC.read_text())
    screens = field_enc["screens"]
    stages = extract(field_enc)
    if not stages:
        print("no zone blocks found — table layout changed?", file=sys.stderr)
        return 1

    # Keystone: s200's live-read Genji zone is exactly [188, 200, 272, 0,0,0,0,0] and
    # screen 200 resolves to Kuwagamon (the Genji fight). Asserted every run.
    s200 = [z["slots"] for z in stages[200]["zones"]]
    assert [188, 200, 272, 0, 0, 0, 0, 0] in s200, f"s200 keystone zone changed: {s200}"
    assert screens["200"][0]["name"] == "Kuwagamon", \
        f"screen 200 keystone enemy changed: {screens['200']}"

    # Keystone: every rate level is a valid index into the 6-entry rate table.
    levels = sorted({z["rate_level"] for s in stages.values() for z in s["zones"]})
    assert levels and levels[0] >= 0 and levels[-1] < len(RATE_TABLE), \
        f"rate levels outside the 6-entry table: {levels}"

    n_zones = sum(len(s["zones"]) for s in stages.values())
    payload = {
        "_comment": ("Per-stage encounter pools swept from each WSTAGNNN overlay. Each zone "
                     "is the engine's 8-slot rand()&7 pool: join each nonzero `slot` against "
                     "field_encounters.json for the party; 0 = no encounter that roll (so "
                     "empties = miss chance, repeats = weight). Selection = geographic zone "
                     "then rand()&7 (fieldstg fn 0x800925a8). `rate_level` is the block's "
                     "leading word, an index into `rate_table`: the driver (fn 0x80092664) "
                     "subtracts that many points from the step counter once per 8 field "
                     "ticks of movement and rolls when it reaches 0. Level 0 (2000 > the "
                     "counter's 1279 max) marks a block reachable only by the scripted "
                     "trigger path, never by walking. See "
                     "docs/research/battle-invocation.md (encounter selection) and "
                     "docs/research/field/encounter-step-counter-decoded-2026-07-25.md."),
        "rate_table": list(RATE_TABLE),
        "stages": {str(st): stages[st] for st in sorted(stages)},
    }
    if do_print:
        for st in sorted(stages):
            print(f"s{st}:")
            for z in stages[st]["zones"]:
                pool = {}
                for s in z["slots"]:
                    pool[s] = pool.get(s, 0) + 1
                parts = []
                for s, w in pool.items():
                    if s == 0:
                        parts.append(f"miss x{w}")
                    else:
                        nm = ", ".join(e["name"] for e in screens.get(str(s), [])) or "?"
                        parts.append(f"{s}={nm} x{w}")
                print(f"   [{'; '.join(parts)}]")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(_dump(payload))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(stages)} stages, {n_zones} zones")
    return 0


def _dump(payload):
    """Tidy, diff-friendly JSON: one compact line per zone, stages indented."""
    lines = ["{", f'  "_comment": {json.dumps(payload["_comment"])},',
             f'  "rate_table": {json.dumps(payload["rate_table"])},', '  "stages": {']
    stages = payload["stages"]
    for si, (st, body) in enumerate(stages.items()):
        zones = body["zones"]
        lines.append(f'    "{st}": {{ "zones": [')
        for zi, z in enumerate(zones):
            comma = "," if zi < len(zones) - 1 else ""
            lines.append(f"      {json.dumps(z, separators=(', ', ': '))}{comma}")
        tail = "    ]"
        if "groups" in body:
            lines.append(tail + ", \"groups\": [")
            groups = body["groups"]
            for gi, g in enumerate(groups):
                comma = "," if gi < len(groups) - 1 else ""
                lines.append(f"      {json.dumps(g, separators=(', ', ': '))}{comma}")
            lines.append("    ], \"selector\": "
                         + json.dumps(body["selector"], separators=(", ", ": ")))
            tail = "    "
        lines.append(tail + "}" + ("," if si < len(stages) - 1 else ""))
    lines += ["  }", "}", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
