"""
Extracts door, warp, and NPC spawn data from the ddw3 repo's per-stage
overlay disassemblies.

Each stage sNNN has an event-script overlay WSTAGNNN.PRO, disassembled at
~/ddw3/asm/dw2003/pro/wstagNNN.s. The overlay is mostly data; this tool
reconstructs its raw bytes from the `.word 0x...` annotations and decodes
three structures (verified live in the emulator, see
docs/research/wstag-vm-notes.md):

- Door/trigger records: 18-byte records (1, 0x044X, idx, 0, 0, x, y1, y2, 0)
  -- a vertical trigger segment at x spanning y1..y2 (sits across doorway
  openings), in THIS map's pixels.
- Warp records: 8-byte signature ff ff 00 00 ff ff 00 00 + 6 u16
  (active, screen_id, spawn_x, spawn_y, dir, param). active==1 and
  screen_id resolving in data/screen_table.json (tools/screen_table.py)
  means a warp; spawn is in DESTINATION-map pixels. param is a door tag
  (0 or 100+k), pairing the warp with one of this stage's triggers.
  Records with active==0 terminate a list; active 2..14 are other,
  undecoded record types sharing the signature.
- NPC spawn records: contiguous 20-byte records {ptrA, ptrB, slot<<16|id,
  y<<16|x, n} where ptrB is always a valid overlay pointer and ptrA (if
  nonzero) points to a talk-pair table. Multiple records with the same
  (slot, x, y) are story-state variants; the first occurrence is used.
  Talk IDs encode file and index: file_num = id >> 12 (0-9 -> estalk00-09),
  local_idx = id & 0xfff. NPC entity id maps to sprite folder p{id:03d}*.

HISTORICAL NOTE: earlier revisions extracted the warp signature records as
"NPCs" with (sprite_slot, x, y, dir, talk) -- that was wrong. The ids are
destination screen ids, the coords are dest-map spawn points, and "talk"
was the door-tag param (its 100..104 values collided with real estalk00
indices, which made the misread look verified).

Usage:
  python tools/wstag_extract.py s200 s202        # JSON to stdout
  python tools/wstag_extract.py --all --stats    # coverage table, all stages
"""

import os
import json
import re
import struct
import sys
from pathlib import Path

ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
SIG = bytes.fromhex("ffff0000ffff0000")

# A door/warp/step record's facing word -- `params[3]` -- is char+0x60, the
# field actor's 0-7 facing index, with no translation anywhere on the way:
#
#   * the handoff 0x8008B6D4 (fieldstg.s:0x8aa0) stores the record's word at
#     scene_obj+0x6c, and the arriving actor's spawn copies 0x6c straight into
#     char+0x60 (fieldstg.s:0xe758 `lw $v0,0x6c($v0)` / :0xe760 `sw $v0,0x60($s2)`)
#     -- the two position words beside it are the only ones `sra 8`-ed back;
#   * char+0x60 is the column index of the trigger cone the step driver reads at
#     fieldstg.s:0x5688-0x569c and of the direction-scale table at 0x8009b724
#     (docs/research/field/player-party-movement.md "Projected direction and
#     terrain vectors"), whose row 0 is this exact order.
#
# This is the SAME table engine/systems/field-movement.ts `fieldDirectionFromIndex`
# holds, and the same one `gen_scenes._b_to_dir` already used for NPC spawn
# facings. It replaces a four-entry table that named only 1/3/5/7, mapped every
# one of them a step clockwise (1->down, 3->left, 5->up, 7->right) and read
# 0/2/4/6 as "down": 617 door arrivals came out facing the wrong way.
#
# The wrap-maze exit records are NOT in this space -- they carry their own
# four-way enum (1=south, 3=west, 5=north, 7=east, 0=no facing), which is why
# `gen_scenes.py` keeps that one separate.
DIR8 = {
    0: "down", 1: "down-left", 2: "left", 3: "up-left",
    4: "up", 5: "up-right", 6: "right", 7: "down-right",
}


def overlay_bytes(stage):
    path = ASM_DIR / f"wstag{stage}.s"
    if not path.exists():
        return None
    words = re.findall(r"\.word (0x[0-9a-f]+)", path.read_text())
    return b"".join(struct.pack("<I", int(w, 16)) for w in words)


def sig_records(data):
    """All (offset, active, id, x, y, dir, param) signature records."""
    recs = []
    i = 0
    while True:
        i = data.find(SIG, i)
        if i < 0:
            break
        recs.append((i,) + struct.unpack_from("<6H", data, i + 8))
        i += 8
    return recs


def extract_doors(data):
    doors = []
    for i in range(2, len(data) - 14, 2):
        tag, idx = struct.unpack_from("<2H", data, i)
        if 0x0440 <= tag <= 0x044F and idx < 16:
            prev = struct.unpack_from("<H", data, i - 2)[0]
            x, y1, y2, pad = struct.unpack_from("<4H", data, i + 8)
            if prev == 1 and pad == 0 and x < 4096 and y1 <= y2 < 4096:
                doors.append({"idx": idx, "x": x, "y1": y1, "y2": y2})
    return doors


def extract_warps(data, screens):
    """Active signature records whose id is a known screen id."""
    warps = []
    for off, active, sid, x, y, d, param in sig_records(data):
        entry = screens.get(str(sid))
        if active == 1 and entry is not None:
            warps.append({"screen": sid, "stage": entry["stage"],
                          "spawnX": x, "spawnY": y,
                          "dir": DIR8.get(d, d), "param": param})
    return warps


def load_screens():
    path = Path(__file__).resolve().parent.parent / "data/screen_table.json"
    return json.loads(path.read_text())


_OVERLAY_BASE = 0x800A5DE0

# The four player-candidate ids the cast rebuild's player loop tests (fieldstg.s
# 0x8218-0x8250: 0x6a, 1, and the [0x146, 0x148) window). The general actor loop
# skips exactly these; every other record is an actor. See
# tools/extract_cast_lists.py for the full decode.
PLAYER_CAST_IDS = (1, 0x6A, 0x146, 0x147)


def _is_overlay_ptr(w, data):
    return _OVERLAY_BASE <= w < _OVERLAY_BASE + len(data)


def _decode_flaglist(data, offset):
    """Decode the flag-condition list at byte `offset` (record+0x0 target).

    The engine (`F0x80016924`, the get_flag twin of the F0x80016988 set_flag applier,
    exe/fns.s:7184-7211) walks `{u16 flag_id, u16 expected}` pairs four bytes at a
    time until the id word reads 0xFFFF (`exe/fns.s:7202 bne $a0, $s1` back to the
    loop head at :7195), comparing every `get_flag(id)` with `expected` and returning 0
    at the FIRST mismatch (`exe/fns.s:7198 beqz $v0`). So the list is 0xFFFF-terminated
    and unbounded -- the engine keeps no entry count -- and one failing condition fails
    the gate. Returns [{"id", "expected"}, ...], or [] when the run never reaches
    a terminator before the overlay ends: a pointer that walks off into unrelated data
    is not a list, and emitting the words it happened to cross is how a misread record
    grew junk predicates (s805's one word-past-the-table record, whose ptrA lands in the
    stage's data; that record is now dropped whole, see extract_npcs). Measured over all
    294 overlays, no real list is unterminated and the longest is 15 pairs, so this
    branch only ever fires on a bad pointer. See
    docs/research/scripting/field-script-engine-verified.md §WS4.9.
    """
    out = []
    for i in range((len(data) - offset) // 4):
        off = offset + i * 4
        if off + 2 > len(data):
            return []
        fid = struct.unpack_from("<H", data, off)[0]
        if fid == 0xFFFF:
            return out
        if off + 4 > len(data):
            return []
        expected = struct.unpack_from("<H", data, off + 2)[0]
        out.append({"id": fid, "expected": expected})
    return []


def decode_ptrb_dialogues(data, ptrb):
    """Decode the per-NPC DIALOGUE STATE MACHINE at a ptrB pointer.

    ptrB → list of 12-byte triples {ptr1:u32, ptr2:u32, id:u32} terminated by (0,0,0).
    Decoded from the field talk handler (`fieldstg` F0x80090afc, reached on talk via
    F0x8008e2cc):
      ptr1 → flag-condition GATE list (`F0x80016924`, the {id,expected} AND-list) — the
             NPC shows this state iff every gate condition holds; the handler picks the
             FIRST triple whose gate passes.
      id   → the estalk00 line index shown for that state (`F0x80088d38(speaker, id)`
             indexes the field-NPC text bank `[0x80099dc4]` = estalk00).
      ptr2 → a set_flag table applied when the dialogue CLOSES (`F0x80016988`), so talking
             advances state.
    Returns [{"id": K, "gate": [{id,expected}...], "on_close": [{id,expected}...]}].

    ⚠️ SUPERSEDES the old "talk-word lists + story counter" reading: ptr1/ptr2 are flag
    lists, NOT estalk talk_ids (a {flag_id,expected} pair is byte-identical to a fabricated
    (hi<<16|talk_id) word, which is why the old decode produced garbage estalk lines).
    See docs/research/scripting/field-script-engine-verified.md §WS5."""
    off = ptrb - _OVERLAY_BASE
    if off < 0 or off + 12 > len(data):
        return []
    triples = []
    for i in range((len(data) - off) // 12):
        triple_off = off + i * 12
        if triple_off + 12 > len(data):
            break
        p1, p2, ident = struct.unpack_from("<III", data, triple_off)
        if p1 == 0 and p2 == 0 and ident == 0:
            break
        gate = _decode_flaglist(data, p1 - _OVERLAY_BASE) if p1 and _is_overlay_ptr(p1, data) else []
        on_close = _decode_flaglist(data, p2 - _OVERLAY_BASE) if p2 and _is_overlay_ptr(p2, data) else []
        triples.append({"id": ident, "gate": gate, "on_close": on_close})
    return triples


# ── structural validators (admit event/puppet spawn records that live in SEPARATE
#    mini-tables, beyond the main contiguous NPC table, without admitting garbage:
#    a real record's ptrB must resolve to a well-formed dialogue-triple array, which
#    random overlay bytes effectively never do). These let extract_npcs surface the
#    high-nid quest NPCs (e.g. s420 npc369, the Seiryu-Tower "Trickster Guilmon"
#    reveal Guilmon; s385 npc296, the fake-card giver) that the old `nid<=200` cap +
#    single-best-run scan dropped — and the `extract_npc_flag_sets.py` flag scanner
#    reuses the same predicates. ──
def valid_flaglist(data, off):
    """True iff `off` is a `{u16 id, u16 expected}` AND-list, 0xffff-terminated
    inside the overlay, with >=1 plausible entry (bank<=0x9e).

    The bound is the overlay end, the same one `_decode_flaglist` walks: a
    validator window the decoder does not share lets the two disagree about the
    same bytes, which is how the 64-entry window let one junk run through while the
    decoder kept crossing words (`exe/fns.s:7202` reads until 0xFFFF). Measured over
    all 294 overlays the longest real list is 15 pairs, so matching the window to the
    decoder admits nothing new -- it only stops the two from disagreeing.

    NOTE: flag id 0x0000 IS a legitimate id (bank 0x00 bit 0 -- e.g. the
    "repeat-examine search point" unary counter's first bit, verified live
    at s235's Asuka Inn shelf, docs/research/field/repeat-examine-search-points-2026-07-26.md
    §"STATIC BREAKTHROUGH -- 2026-07-26c"). An earlier revision excluded
    fid==0 as presumed garbage, which silently dropped every search-point
    record (their gate/on_close lists all chain through flag id 0x0000)."""
    if off < 0 or off + 2 > len(data):
        return False
    n = 0
    for i in range((len(data) - off) // 4):
        o = off + i * 4
        if o + 2 > len(data):
            return False
        fid = struct.unpack_from("<H", data, o)[0]
        if fid == 0xFFFF:
            return n >= 1
        if o + 4 > len(data) or ((fid >> 8) & 0xFE) > 0x9E:
            return False
        n += 1
    return False


def valid_triple_array(data, ptr):
    """True iff `ptr` is a 12-byte `{gate_ptr, set_ptr, id}` array, (0,0,0)-terminated
    within the overlay, with >=1 triple, every non-null gate/set a valid flag-list,
    and ids < 0x1000.

    A triple may be a plain single line `{0, 0, id}` — no internal gate/on_close
    pointer. Requiring an internal gate/set here (the old `nontrivial` guard) wrongly
    rejected such arrays, dropping high-nid puppets whose whole dialogue is one
    ungated line (e.g. s200 Agumon npc365->estalk00[21], Patamon npc371->estalk00[20],
    both spawn-gated only via the RECORD's ptrA flag list). The anti-false-positive
    defense lives in find_puppet_records' record wrapper (slot/nid/coord/ptrA-flaglist
    validation) plus the terminator + id<0x1000 checks here — an internal pointer is
    not required."""
    off = ptr - _OVERLAY_BASE
    if off < 0 or off + 12 > len(data):
        return False
    for i in range((len(data) - off) // 12):
        o = off + i * 12
        if o + 12 > len(data):
            return False
        p1, p2, ident = struct.unpack_from("<III", data, o)
        if p1 == 0 and p2 == 0 and ident == 0:
            return i >= 1
        if (p1 and not _is_overlay_ptr(p1, data)) or (p2 and not _is_overlay_ptr(p2, data)) or ident >= 0x1000:
            return False
        if p1 and not valid_flaglist(data, p1 - _OVERLAY_BASE):
            return False
        if p2 and not valid_flaglist(data, p2 - _OVERLAY_BASE):
            return False
    return False


def find_puppet_records(data):
    """Strictly-validated 20-byte spawn records carrying a dialogue array, found
    ANYWHERE in the overlay (not just the single longest contiguous run). nid runs
    the full sprite-table range (1..405); the ptrB triple-array validation is what
    keeps random data out. Yields records in extract_npcs' shape (with ptrB set)."""
    seen_pb = set()
    for off in range(0, len(data) - 20, 4):
        pA, pB, sid, pos, n = struct.unpack_from("<IIIII", data, off)
        slot = (sid >> 16) & 0xFFFF
        nid = sid & 0xFFFF
        x = pos & 0xFFFF
        y = (pos >> 16) & 0xFFFF
        if not (4 <= slot <= 31 and 1 <= nid <= 405 and x < 10000 and y < 10000 and n < 256):
            continue
        if pB == 0 or not _is_overlay_ptr(pB, data) or not valid_triple_array(data, pB):
            continue
        if pA != 0 and not (_is_overlay_ptr(pA, data) and valid_flaglist(data, pA - _OVERLAY_BASE)):
            continue
        if pB in seen_pb:                 # same actor across story-state variants
            continue
        seen_pb.add(pB)
        yield {"ptrA": pA, "ptrB": pB, "slot": slot, "id": nid, "x": x, "y": y, "n": n,
               "spawn_flags": _decode_flaglist(data, pA - _OVERLAY_BASE) if pA else []}


def extract_npcs(data):
    """Find and decode the NPC spawn table from overlay bytes.

    Returns ALL records per slot (one entry per story-state variant), so
    callers can implement chapter-accurate display. Records at pos (0,0) are
    invisible placeholders and are skipped. Slots where every record is (0,0)
    are omitted entirely.

    Spawn record format: {ptrA, ptrB, slot<<16|npc_id, y<<16|x, n}
    - ptrA: talk-pair table pointer (0 = no dialogue)
    - ptrB: behavior/wander pointer (0 = no wander behavior — allowed)
    - n: story-state threshold (1=early game, 3/5/6/7=later chapters)
    - Multiple records per slot = sequential dialogue states or story variants

    HISTORICAL NOTE: earlier code required ptrB != 0 (broke on pB=0) and
    deduplicated by (x,y) instead of slot. Both were bugs; this version
    groups by slot and allows pB=0.
    """
    best_start, best_recs = None, []
    for start in range(0, len(data) - 20, 4):
        recs = []
        off = start
        while off + 20 <= len(data):
            pA, pB, sid, pos, n = struct.unpack_from("<IIIII", data, off)
            slot = (sid >> 16) & 0xFFFF
            nid = sid & 0xFFFF
            x = pos & 0xFFFF
            y = (pos >> 16) & 0xFFFF
            # pB=0 is valid (no wander behavior); pB non-zero must be overlay ptr
            if pB != 0 and not _is_overlay_ptr(pB, data):
                break
            if pA != 0 and not _is_overlay_ptr(pA, data):
                break
            # Slots start at 4; nid=0 is not a real NPC; nid>200 is never real
            if slot < 4 or slot > 31 or nid < 1 or nid > 200:
                break
            # record+0x10 is the arriving actor's own facing field: the spawner reads it
            # as a SIGNED halfword (`lh $v0, 0x10($s0)`, pro/fieldstg.s:8487) and stores
            # it straight into char+0x60 (pro/fieldstg.s:8489) -- no mask, no table --
            # so it is the 0-7 DIR8 enum, and the run-scan must hold it to the same bound
            # find_puppet_records already used (`n < 256`). It did not, and one overlay
            # word past the end of s805's NPC table (file 0x14d0) is a pointer, not a
            # record: its "facing" 0x4002a is npc real_4_262186_0_0, and the engine would
            # read it as the negative -32718. Across all 294 overlays every admitted
            # record's n is one of 0,1,2,3,5,6,7 (3306 records) and this one word is the
            # only value >= 256.
            if n >= 256:
                break
            if x > 10000 or y > 10000:
                break
            rec = {"ptrA": pA, "slot": slot, "id": nid, "x": x, "y": y, "n": n,
                   "spawn_flags": _decode_flaglist(data, pA - _OVERLAY_BASE) if pA else []}
            if pB != 0:
                rec["ptrB"] = pB
            recs.append(rec)
            off += 20
        if len(recs) > len(best_recs):
            best_start, best_recs = start, recs

    # The best-run captures the main contiguous NPC table (incl. ptrB==0 plain NPCs).
    # Event/quest puppets live in SEPARATE mini-tables it discards; merge them in via
    # the strict ptrB-validated scan (high-nid actors the old nid<=200 cap dropped).
    existing_pb = {r.get("ptrB") for r in best_recs if r.get("ptrB")}
    for pr in find_puppet_records(data):
        if pr["ptrB"] in existing_pb:
            continue
        existing_pb.add(pr["ptrB"])
        best_recs.append(pr)

    if not best_recs:
        return []

    # Group by slot; emit all non-(0,0) records. Skip slots that are entirely (0,0).
    by_slot = {}
    for r in best_recs:
        s = r["slot"]
        if s not in by_slot:
            by_slot[s] = []
        by_slot[s].append(r)

    result = []
    for slot_recs in by_slot.values():
        all_zero = all(r["x"] == 0 and r["y"] == 0 for r in slot_recs)
        recs_to_emit = slot_recs if all_zero else [r for r in slot_recs if r["x"] != 0 or r["y"] != 0]
        # De-dup by (slot, x, y, n, ptrA): same position+chapter+flag-list = dialogue
        # rotation, keep first. ptrA (the spawn-gate flag-list pointer, §WS4.9) is part
        # of the key so genuinely mutually-exclusive story variants — same slot/pos/n but
        # different flag conditions — are NOT collapsed (e.g. s200 slot6/npc47 has two
        # records differing only by flaglist 0x7018 vs 0x7019).
        # For cutscene-only slots (all x=0,y=0), slot differentiates records so no
        # collapsing occurs (e.g. s780 actors 11/12/16 are in distinct slots 5/6/7).
        seen = set()
        for r in recs_to_emit:
            key = (r["slot"], r["x"], r["y"], r["n"], r["ptrA"])
            if key in seen:
                continue
            seen.add(key)
            # ptrA (record+0x0) is the spawn-gate flag list (-> spawn_flags), NOT dialogue.
            # Dialogue is ptrB's triple ids (§WS5); the old ptrA `talk` field was garbage.
            entry = {
                "id": r["id"],
                "slot": r["slot"],
                "x": r["x"],
                "y": r["y"],
                "n": r["n"],
                "spawn_flags": r["spawn_flags"],
            }
            if all_zero:
                entry["cutsceneOnly"] = True
            if r.get("ptrB"):
                entry["ptrB"] = r["ptrB"]
                ptrb_dlg = decode_ptrb_dialogues(data, r["ptrB"])
                if ptrb_dlg:
                    entry["ptrb_dialogues"] = ptrb_dlg
            result.append(entry)
    return result


def extract_cast(data, cast_ptr):
    """Decode the scene descriptor's +0x4C cast list into NPC-spawn records.

    The cast list is an array of 0-terminated pointers to 20-byte spawn records
    `{ptrA, ptrB, slot<<16|id, y<<16|x, n}` — the same record shape as the NPC
    spawn table `extract_npcs` scans for, but keyed by the descriptor pointer so
    records the contiguous-run scan drops are still reachable. The run scan stops
    at `nid > 200` and the puppet fallback requires a ptrB triple array; a cast
    record may be high-nid with ptrB=0 (e.g. s820's npc 213, the Spy Satellite
    boss: slot 5, id 213, x=336 y=232, spawn when flag 0x6029 == 1). The cast
    pointer is authority-4 extraction from each stage overlay's own setup
    function (docs/generated/stage-descriptors.json field 4C).

    Constants: pointer array walked at `f0x008210`, each record's `lh +0x8` is
    the entity type/id, optional predicate at record+0x0, instantiated via
    F0x8009116c (docs/research/field/scene-descriptor-field-map-2026-08-05.md
    §"+0x4c — the stage cast list"). Callers that need only the actors their
    stage's events reference should pass `need_ids` to `extract`.
    """
    out: list[dict] = []
    arr = cast_ptr - _OVERLAY_BASE
    if arr < 0 or arr + 4 > len(data):
        return out
    for i in range((len(data) - arr) // 4):
        o = arr + 4 * i
        if o + 4 > len(data):
            break
        record_ptr = struct.unpack_from("<I", data, o)[0]
        if record_ptr == 0:
            break
        if not _is_overlay_ptr(record_ptr, data):
            break
        off = record_ptr - _OVERLAY_BASE
        if off < 0 or off + 20 > len(data):
            break
        pA, pB, sid, pos, n = struct.unpack_from("<IIIII", data, off)
        slot = (sid >> 16) & 0xFFFF
        nid = sid & 0xFFFF
        x = pos & 0xFFFF
        y = (pos >> 16) & 0xFFFF
        if not (4 <= slot <= 31 and 1 <= nid <= 405 and x < 10000 and y < 10000 and n < 256):
            continue
        if pA and not _is_overlay_ptr(pA, data):
            continue
        if pB and not _is_overlay_ptr(pB, data):
            continue
        rec = {"id": nid, "slot": slot, "x": x, "y": y, "n": n,
               "spawn_flags": _decode_flaglist(data, pA - _OVERLAY_BASE) if pA else []}
        if pB:
            rec["ptrB"] = pB
            dlg = decode_ptrb_dialogues(data, pB)
            if dlg:
                rec["ptrb_dialogues"] = dlg
        out.append(rec)
    return out


def extract_ladders(data):
    """Vertical traversal links (ladders / drops) from the sig-record table.

    These come as 1:1 paired records: act==2 is the BOTTOM endpoint, act==3 the
    TOP endpoint, sharing the same id field and emitted consecutively (2,3,2,3).
    Both endpoints sit on walkable floor with blocked cells between them, so the
    link is the only way across the vertical gap. Returns
    [{"id", "bottom": {"x","y"}, "top": {"x","y"}}, ...].

    (Decoded 2026-06-28: 216 pairs across 107 stages, 100% vertical. The act-2/3
    pairing the door-warp doc flagged as LOW-confidence "lift/stair endpoints".)
    """
    bottoms, tops = {}, {}          # id -> [(x, y), ...] in file order
    for off, act, sid, x, y, d, param in sig_records(data):
        if act == 2:
            bottoms.setdefault(sid, []).append((x, y))
        elif act == 3:
            tops.setdefault(sid, []).append((x, y))
    ladders = []
    for sid, bots in bottoms.items():
        for (bx, by), (tx, ty) in zip(bots, tops.get(sid, [])):
            ladders.append({"id": sid, "bottom": {"x": bx, "y": by},
                            "top": {"x": tx, "y": ty}})
    return ladders


def extract(stage, screens=None, cast_ptr=None):
    """Door/warp/ladder/NPC data for one stage overlay.

    `cast_ptr` (the descriptor +0x4C RAM pointer) additionally decodes the stage
    cast list and merges it by the cast rebuild's OWN general loop (fieldstg.s
    0x83b4-0x849c): every record that is not one of the four player ids
    (1, 0x6a, 0x146, 0x147) and whose gate passes is an actor, whether or not
    the contiguous run scan surfaced it. Records the run scan already produced
    are not duplicated. Both are optional, so the historical callers are
    unchanged.
    """
    data = overlay_bytes(stage)
    if data is None:
        return None
    if screens is None:
        screens = load_screens()
    npcs = extract_npcs(data)
    if cast_ptr is not None:
        # The merge key is the record's own decoded content, so a record the run
        # scan already found is not duplicated while a story variant that
        # differs by position, facing or gate is kept -- the same rule the run
        # scan's own de-dup uses.
        def cast_key(r):
            return (r["slot"], r["id"], r["x"], r["y"], r["n"],
                    tuple((c["id"], c["expected"]) for c in r.get("spawn_flags") or []))
        have = {cast_key(r) for r in npcs}
        for r in extract_cast(data, cast_ptr):
            if r["id"] in PLAYER_CAST_IDS:
                continue
            key = cast_key(r)
            if key in have:
                continue
            npcs.append(r)
            have.add(key)
    return {"stage": stage, "doors": extract_doors(data),
            "warps": extract_warps(data, screens),
            "ladders": extract_ladders(data),
            "npcs": npcs}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_path = None
    if "--out" in sys.argv:
        out_path = Path(sys.argv[sys.argv.index("--out") + 1])
    if "--all" in sys.argv:
        stages = sorted(p.stem[5:] for p in ASM_DIR.glob("wstag*.s"))
    else:
        stages = [s.lstrip("s") for s in args]
    if not stages:
        sys.exit(__doc__)

    screens = load_screens()
    if "--stats" in sys.argv:
        total_door = total_warp = total_npc = 0
        for s in stages:
            r = extract(s, screens)
            if r is None:
                continue
            dests = ",".join(f"s{w['stage']}" for w in r["warps"])
            total_door += len(r["doors"])
            total_warp += len(r["warps"])
            total_npc += len(r["npcs"])
            print(f"s{s}: {len(r['doors']):2d} doors, "
                  f"{len(r['warps']):2d} warps, "
                  f"{len(r['npcs']):2d} npcs -> {dests}")
        print(f"\n{len(stages)} stages; {total_door} doors, "
              f"{total_warp} warps, {total_npc} npcs")
    else:
        out = [extract(s, screens) for s in stages]
        text = json.dumps(out, indent=1) + "\n"
        if out_path:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(text)
            print(f"wrote {out_path} ({len(out)} stages)")
        else:
            sys.stdout.write(text)


if __name__ == "__main__":
    main()
