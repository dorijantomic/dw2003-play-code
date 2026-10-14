"""
Generates/updates scene JSONs from data extracted out of the game's per-stage
overlays (see wstag_extract.py), merging with existing hand-authored scenes.

- Door exits are auto-wired from warp records: a warp in stage A gives the
  destination stage plus the spawn point (in DEST-map pixels); the matching
  return warp in the destination gives the door's location in A. Exits are
  only emitted for destinations present in the walker's manifest, carry a
  "warp" tag so re-runs replace them, and "approx": true when several doors
  connect the same two stages (pairing is then a geometric guess).
- Manual wiring from web/wire.html (data/door_wiring.json, "door"-tagged
  exits) still applies and is independent of warp wiring.
- Hand-authored exits/zones/NPCs are preserved. "ext_*" NPCs from older
  runs are PURGED: they were warp records misread as NPCs (see
  wstag_extract.py docstring) -- their positions belong to other maps.

Usage:  python3 tools/gen_scenes.py s200 s210   |   --all
         [--out DIR]   write into DIR instead of web/assets/scenes
"""

import os
import json
import struct
import sys
from pathlib import Path

from wstag_extract import (ASM_DIR, DIR8, decode_ptrb_dialogues, extract,
                           load_screens, overlay_bytes, sig_records,
                           valid_triple_array)
from extract_story_steps import STEP, read_step_program

ROOT = Path(__file__).resolve().parent.parent
SCENES = ROOT / "web/assets/scenes"
STORY_STEPS = ROOT / "web/assets/data/story_steps.json"
STORY_GRIDS = ROOT / "web/assets/data/story_trigger_grids.json"
MAZE_EXITS = ROOT / "web/assets/data/maze_exits.json"
MAZE_SECTIONS = ROOT / "web/assets/data/maze_sections.json"
# The places system's per-stage placePoints tables (tools/extract_stage_place_points.py).
# The 34 stages that carry one re-aim their exits per the incoming place pair on
# entry (copyPlacePoints, WS7); the scene carries the table and one exit row per
# op-1 step (its StageSlot), so the runtime copy can aim point i at slot i.
PLACE_POINTS = ROOT / "web/assets/data/stage_place_points.json"
SPRITES_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "tim/dw2003/field/sprite"
DIALOGUE_DIR = ROOT / "web/assets/dialogue"
WSTAG_EVENTS = ROOT / "web/assets/events/wstag_events.json"
# Each stage overlay's own setup function writes its descriptor; field +0x4C is
# the RAM pointer to that stage's cast list (docs/generated/stage-descriptors.json,
# built by tools/extract_stage_descriptors.py).
DESCRIPTORS = ROOT / "docs/generated/stage-descriptors.json"
# The field-NPC text bank the talk handler indexes by ptrB triple id is the runtime
# NPC-text slot [0x80099dc4], which each stage refills with ITS area's estalk file
# (see §WS5). The per-stage bank is `data/stage_estalk_bank.json` (built by
# tools/build_estalk_bank.py); estalk00 is only the Asuka exterior bank, so it is the
# fallback for stages absent from the table (no NPC dialogue ids).
FIELD_NPC_BANK = "estalk00"
_STAGE_BANK_PATH = ROOT / "data/stage_estalk_bank.json"
_STAGE_BANK = (json.loads(_STAGE_BANK_PATH.read_text())
               if _STAGE_BANK_PATH.exists() else {})


def bank_for_stage(stage):
    """The estalk file this stage loads into [0x80099dc4]; Asuka-exterior fallback."""
    entry = _STAGE_BANK.get(f"s{stage}")
    return entry["bank"] if entry else FIELD_NPC_BANK

# The talk launcher starts a scene from the conversation's own on_close write into
# game-state bank 0x90: the EXE set_flag dispatcher (exe/fns.s:7113-7115) hands bank
# 0x90 to the resident fieldstg handler (pro/fieldstg.s:9412-9447), which reads this
# bit's event id out of the shared u16 table at 0x800978d8 (pro/fieldstg.s:9420-9432)
# and calls the same start_event(0x800853f8) (pro/fieldstg.s:9434) every other start
# site uses. An NPC that owns such a dialogue state is therefore a start site, and its
# cast record must exist in the scene whether or not an OnTalk row names it.
LAUNCH_BANK = 0x90
_launch_site_cache = {}


def launcher_site_npc_ids(stage_no):
    """npc ids in stage `stage_no` whose own ptrB program writes bank 0x90.

    Scans the overlay's 20-byte spawn records with the same shape test
    wstag_extract.find_puppet_records uses, then decodes each record's own ptrB
    triples: an NPC that owns a dialogue state writing bank 0x90 is a start site
    and needs an actor in the scene. Read from the overlay, not from the
    generated scene -- web/assets/data/talk_launch_bindings.json is itself built
    FROM web/assets/scenes (one row per dialogue state), so reading it here would
    make the scene build depend on its own output.
    """
    if stage_no in _launch_site_cache:
        return _launch_site_cache[stage_no]
    found = set()
    data = overlay_bytes(str(stage_no))
    if data:
        seen = set()
        for off in range(0, len(data) - 20, 4):
            _pA, pB, sid, _pos, n = struct.unpack_from("<IIIII", data, off)
            slot = (sid >> 16) & 0xFFFF
            nid = sid & 0xFFFF
            if not (4 <= slot <= 31 and 1 <= nid <= 405 and n < 256):
                continue
            if pB == 0 or pB in seen or not valid_triple_array(data, pB):
                continue
            seen.add(pB)
            if any(((w["id"] >> 8) & 0xFE) == LAUNCH_BANK
                   for triple in decode_ptrb_dialogues(data, pB)
                   for w in triple["on_close"]):
                found.add(nid)
    _launch_site_cache[stage_no] = found
    return found


_sprite_cache = {}


# The wrap-maze exit records (tools/extract_maze_exits.py, 16 bytes:
# {screen, key, companion, x, y, dir, script}) carry their OWN four-way facing
# enum -- 1 = south, 3 = west, 5 = north, 7 = east, 0 = none -- which is NOT
# char+0x60's 0-7 order: the Circuit Board's 534 internal moves split 267/267
# between "1 (south)" and "5 (north)" and its 76 holes all carry 0, which is
# what the published guide describes, and `extract_maze_exits.py --check`
# reproduces 33 of 33 rig-captured exits on (screen, x, y, dir) with exactly
# this reading. So the maze path keeps its own table and never borrows DIR8.
# docs/research/field/route-pair-underground-network-2026-07-27.md.
MAZE_DIR_NAMES = {1: "down", 3: "left", 5: "up", 7: "right"}
MAZE_DIR_TO_INT = {v: k for k, v in MAZE_DIR_NAMES.items()}

# Which records carry their raw facing word through as `nativeDir`: exactly the
# ones the old four-entry naming table could NOT name (0, 2, 4, 6), which is the
# set that has always shipped. DIR8 can name all eight, so the guard no longer
# means "unnameable" -- it is the shape `resolveMazeExit` (engine/dw3/maze.ts)
# selects wrap-maze hops with, and widening or narrowing it moves which hop a
# trigger takes. Kept as it stands until the maze trigger geometry is decoded.
_NATIVE_DIR_FACINGS = frozenset({1, 3, 5, 7})


def stage_for_screen(screens, screen, alias_world=False):
    """Resolve a screen id through the normal or final-ordinal shadow table."""
    entry = screens.get(str(screen))
    if not entry:
        return None
    if alias_world and entry.get("alt", {}).get("stage") is not None:
        return entry["alt"]["stage"]
    return entry.get("stage")


def _b_to_dir(b):
    """A SETANIM b value, or a door record's params[3] — both are char+0x60."""
    return DIR8.get(b, "down")


# Real disasm default: the FIELDSTG entity constructor (fieldstg.s file 0xe61c-e62c)
# unconditionally sets `entity+0x60` (facing) = 1 = "down-left" for every spawned entity,
# before any per-type/cutscene override. Used when no SETANIM ground truth exists for an
# NPC (see docs/research/field/npc-decode.md "NPC facing from SETANIM b-values" — the
# per-type override function itself remains undecoded, but this generic baseline is
# disasm-verified and replaces the old unverified "down" placeholder).
DEFAULT_FACING = "down-left"


def build_npc_facing(wstag_events):
    """Return {stage_int: {npc_id: dir_string}} from wstag_events.json data.

    For each stage, iterates events in ascending event id order and records
    the first SETANIM b value per NPC actor (actors 3-799 = NPC ids).
    """
    result = {}
    for stage_key, evlist in wstag_events.items():
        stage_int = int(stage_key[1:])
        actor_b = {}
        for ev in sorted(evlist, key=lambda e: e["id"]):
            for op in ev.get("disasm", []):
                if not op.startswith("SETANIM "):
                    continue
                parts = op.split()
                actor = int(parts[1])
                b_val = int(parts[3])
                if 3 <= actor < 800 and actor not in actor_b:
                    actor_b[actor] = _b_to_dir(b_val)
        result[stage_int] = actor_b
    return result


_NPC_SPRITES = None


def _npc_sprite_table():
    """Global npc_id -> sprite map the game actually uses (see gen_npc_sprites.py).

    The engine resolves sprites with a flat table lookup, NOT `p{id}` -- that
    guess only coincidentally matches for npc_id 1..11. Falls back to the old
    guess only if the table file is missing (so the build still runs)."""
    global _NPC_SPRITES
    if _NPC_SPRITES is None:
        f = ROOT / "web/assets/npc_sprites.json"
        _NPC_SPRITES = json.loads(f.read_text()) if f.exists() else {}
    return _NPC_SPRITES


def _sprite_for_npc_id(npc_id):
    """Return sprite folder name for a numeric NPC id via the engine's table."""
    if npc_id in _sprite_cache:
        return _sprite_cache[npc_id]
    result = _npc_sprite_table().get(str(npc_id))
    # A table miss means the FIELDSTG global table maps this npc_id to handle 0 —
    # i.e. NO sprite: the entity is an invisible marker in the real game (verified
    # against savestate slot-5 RAM: npc 63/112/113/198 all = handle 0). The old
    # `p{id}` fallback (the falsified pNNN guess) fabricated a wrong VISIBLE sprite
    # here — e.g. npc 112 -> p112hand (a dark mech that read as "HiAndromon"). So on
    # a miss we return None; apply_npc_spawns then SKIPS the NPC (stays invisible).
    _sprite_cache[npc_id] = result
    return result


def _talk_valid(entry):
    """Return True if a {file, index} talk entry has real dialogue."""
    if not entry:
        return False
    dlg_file = DIALOGUE_DIR / f"{entry['file']}.json"
    if not dlg_file.exists():
        return False
    dlg = json.loads(dlg_file.read_text())
    return str(entry["index"]) in dlg

TRIGGER_SNAP = 64   # px: snap exit rect to a door trigger this close
EDGE_RECT = 32      # px: exit rect size when no trigger is nearby


def purge_ext_npcs(scene):
    out = {**scene}
    out["npcs"] = [n for n in scene.get("npcs", [])
                   if not n["id"].startswith("ext_")]
    return out


def purge_real_npcs(scene):
    """Remove previously generated 'real_*' NPCs so re-runs replace them."""
    out = {**scene}
    out["npcs"] = [n for n in scene.get("npcs", [])
                   if not n.get("id", "").startswith("real_")]
    return out


def apply_npc_spawns(scene, stage_npcs, known_sprites,
                     npc_facing=None, stage=None):
    """Add game-data NPC spawns tagged 'real_*'. NPCs whose sprite isn't in
    the manifest render as nothing (sprite omitted; drawEntitySprite's caller
    already no-ops when npcMeta/npcSheet is missing) but are still emitted so
    their dialogue-state machine (ptrB) still fires -- this is how the game's
    own INVISIBLE actors work: entity id resolves to sprite handle 0 in the
    real FIELDSTG table (verified: npc 63/112/113/198 = handle 0), so the
    original game never draws them either, yet they are still talkable. npc
    63 in particular is the decoded "repeat-examine search point" (Asuka Inn
    shelf s235, docs/research/field/repeat-examine-search-points-2026-07-26.md
    "STATIC BREAKTHROUGH -- 2026-07-26c"): dropping the whole record (the old
    behavior) silently deleted every such hidden find game-wide. known_sprites
    is the set of sprite folder names present in the manifest.

    Each story-state variant gets its own entry (same slot, different n/pos).
    game.js picks the highest-n-≤-chapter entry per slot at display time."""
    out = {**scene}
    new_npcs = list(out.get("npcs", []))
    id_counts = {}
    for npc in stage_npcs:
        sprite = _sprite_for_npc_id(npc["id"])
        if sprite is not None and sprite not in known_sprites:
            continue  # sheet not built -- genuinely missing art, not an invisible actor
        # Dialogue = estalk00[id] for each ptrB triple, gated by the triple's flag list
        # and advancing via on_close (talk handler F0x80090afc, §WS5). ptrA is spawn_flags
        # (NOT dialogue) so it no longer feeds text. A triple whose id lands on an "a"/empty
        # estalk00 slot is silent at that state (faithful, not garbage).
        dialogue_states = []
        npc_bank = bank_for_stage(stage)
        for triple in npc.get("ptrb_dialogues", []):
            dlg = {"file": npc_bank, "index": triple["id"]}
            # Preserve every ordered state: text availability cannot remove a gate.
            st = {"dialogue": dlg}
            if triple.get("gate"):
                st["gate"] = triple["gate"]
            if triple.get("on_close"):
                st["on_close"] = triple["on_close"]
            dialogue_states.append(st)
        base_id = f"real_{npc['slot']}_{npc['n']}_{npc['x']}_{npc['y']}"
        # Mutually-exclusive story variants can share (slot,n,x,y) but differ by
        # spawn_flags (§WS4.9). Suffix duplicates so ids stay unique; the first
        # variant keeps the bare id, so existing slot-based selection is unchanged.
        seq = id_counts.get(base_id, 0)
        id_counts[base_id] = seq + 1
        npc_id_str = base_id if seq == 0 else f"{base_id}#{seq}"
        entry = {
            "id": npc_id_str,
        }
        if sprite is not None:
            entry["sprite"] = sprite
        else:
            # No sprite handle in the real FIELDSTG table -- an invisible actor
            # (verified: npc_id 63/112/113/198 = handle 0). Rendered as nothing,
            # but still talkable (that's how "repeat-examine" hidden finds work).
            entry["invisible"] = True
        entry.update({
            "npc_id": npc["id"],
            "slot": npc["slot"],
            "x": npc["x"],
            "y": npc["y"],
            # FACING = the record's `n` (record+0x10), which the field spawner reads
            # as a signed halfword and stores to char+0x60 (pro/fieldstg.s:8487-8489)
            # = the field-display facing (0-7
            # enum, same as SETANIM b / the ladder-climb +0x60 decode). This is the
            # decoded ground truth and is PER-RECORD (per story-state), so an NPC can
            # face differently in different states. Supersedes the old SETANIM-b proxy
            # + "down-left" DEFAULT_FACING guess (facing_map), which collapsed to one
            # value per npc_id and was wrong for the 82.5% of NPCs with no cutscene
            # SETANIM — e.g. s200 Mika (n=5 up-right) now faces Patamon (n=1 down-left)
            # instead of both defaulting to down-left. See docs/research/field/npc-decode.md.
            "dir": _b_to_dir(npc["n"] & 7),
            "n": npc["n"],
        })
        # The verified spawn gate: spawn iff get_flag(id)==expected for ALL pairs
        # (F0x80016924). Carried for the future faithful-spawn pass; current
        # rendering still uses chapter/slot selection.
        if npc.get("spawn_flags"):
            entry["spawn_flags"] = npc["spawn_flags"]
        if "ptrB" in npc:
            entry["ptrB"] = npc["ptrB"]
        # The verified dialogue states (estalk00[id] gated by flags). The runtime picks
        # the first state whose `gate` passes against the live flag store, shows it, and
        # applies its `on_close` set_flags when the box closes (§WS5). `dialogue` = the
        # first state, kept as the fallback for the textbox / ifFlag / manual-NPC paths.
        # An actor with NO ptrB program gets neither key: `dialogue_states: []` is not
        # "an installed program with no lines", and engine/dw3/npc-manager.ts:177 reads
        # `!== undefined` as exactly that, which would drop a hand-authored fallback.
        if dialogue_states:
            entry["dialogue_states"] = dialogue_states
            entry["dialogue"] = dialogue_states[0]["dialogue"]
        if npc.get("cutsceneOnly"):
            entry["cutsceneOnly"] = True
        elif npc["x"] == 0 and npc["y"] == 0:
            # A record whose spawn cell is (0,0) is not in the world at stage load:
            # the cutscene's SETPOS opcodes place it (docs/research/field/
            # npc-decode.md "Cutscene-only spawn records", confirmed on s780).
            # The stage having an event table says nothing about that, so this
            # rule does not consult it -- 18 cast records on the 18 stages with
            # no wstag_events entry (the Mobius Desert floors, the alias
            # underground) are the same script-positioned actors, and gating on
            # the event table left them standing in the map corner at (0,0).
            entry["cutsceneOnly"] = True
        new_npcs.append(entry)
    out["npcs"] = new_npcs
    return out


def _axis_key(points):
    """Sort key along the axis with the larger spread."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    horizontal = (max(xs) - min(xs)) >= (max(ys) - min(ys))
    return (lambda p: p[0]) if horizontal else (lambda p: p[1])


def _pair_warps(outs, backs):
    """Match A->B warps with B->A return warps.

    Unique pair: trivial. Multiple doors between the same two stages:
    sort both sides along their dominant axis and zip -- a guess, flagged
    approx by the caller. Extra unmatched records are dropped.
    """
    if len(outs) == 1 and len(backs) == 1:
        return [(outs[0], backs[0])], False
    okey = _axis_key([(w["spawnX"], w["spawnY"]) for w in outs])
    bkey = _axis_key([(v["spawnX"], v["spawnY"]) for v in backs])
    outs = sorted(outs, key=lambda w: okey((w["spawnX"], w["spawnY"])))
    backs = sorted(backs, key=lambda v: bkey((v["spawnX"], v["spawnY"])))
    return list(zip(outs, backs)), True


def _trigger_dist(d, x, y):
    dy = max(d["y1"] - y, 0, y - d["y2"])
    return (abs(d["x"] - x) ** 2 + dy ** 2) ** 0.5


def _assign_rects(points, doors):
    """Exit rect for each door location (x, y).

    Locations snap to a trigger segment within TRIGGER_SNAP px, but each
    trigger backs at most one exit (assignment by ascending distance);
    leftovers get an EDGE_RECT square around the raw location.
    """
    cands = sorted((_trigger_dist(d, x, y), pi, di)
                   for pi, (x, y) in enumerate(points)
                   for di, d in enumerate(doors))
    rects, used = {}, set()
    for dist, pi, di in cands:
        if dist > TRIGGER_SNAP or pi in rects or di in used:
            continue
        d = doors[di]
        rects[pi] = {"x": d["x"] - 12, "y": d["y1"],
                     "w": 24, "h": d["y2"] - d["y1"]}
        used.add(di)
    for pi, (x, y) in enumerate(points):
        if pi not in rects:
            rects[pi] = {"x": x - EDGE_RECT // 2, "y": y - EDGE_RECT // 2,
                         "w": EDGE_RECT, "h": EDGE_RECT}
    return [rects[i] for i in range(len(points))]


def _trigger_for_param(param, doors):
    """Return door trigger whose idx == param-100, or None if not found.

    warp param encodes door trigger idx as (100 + trigger_idx); param=0
    means a single door or no trigger record exists for this exit.
    """
    if param >= 100:
        idx = param - 100
        for d in doors:
            if d["idx"] == idx:
                return d
    return None


def _door_for_rect(rect, doors):
    for d in doors:
        if d["x"] - 12 == rect["x"] and d["y1"] == rect["y"]:
            return d
    return None


def _gate_of(w):
    """{flag,eq[,flag_b,eq_b]} for a flag-gated warp, else None (cond 0xffff = always).

    Carried onto the exit as metadata; the browser's active-exit lookup evaluates it
    through the shared banked get_flag adapter before interaction or transition.
    """
    gate = {}
    if w.get("gate_a", 0xffff) != 0xffff:
        gate["flag"] = w["gate_a"]
        gate["eq"] = w.get("arg_a", 0)
    if w.get("gate_b", 0xffff) != 0xffff:
        gate["flag_b"] = w["gate_b"]
        gate["eq_b"] = w.get("arg_b", 0)
    return gate or None


def tail_step_program(stage, screens):
    """Reconstruct the tail step-program for a stage that has no `story_steps`
    entry, so `grid_warp_exits` can place its exits from the type-7 grid.

    `story_steps.json` only covers the 98 stages that have a `wstag_events` entry
    (`extract_story_steps` anchors the program via the adjacent event table). But
    every stage carries the SAME 24-byte step program at the overlay tail — the
    event-less stages (e.g. the Lamb Chop shops s255/s256) just have no event table
    to anchor on. Without their program `grid_warp_exits` early-returns and the warps
    fall to the proximity fallback, which piles overlapping exits onto adjacent door
    segments (two Lamb Chop exits landed on doors idx0/idx1, 8px apart).

    We anchor on the stage's unconditional sig-warp offsets (a warp's
    `ffff0000ffff0000` prefix IS a step record's cond_a/arg_a/cond_b/arg_b), walk in
    24-byte strides to the op==0 terminator, and read the program back. Returns
    `{"steps": [...]}` in the shape `grid_warp_exits` expects, or None. Rejected
    (returns None) if any op-1 payload is not among the signature records, so a
    mis-anchored/garbage run never yields a bogus program. Opcodes 9/10 are the
    endgame circuit/seabed entry controllers and carry the same screen/spawn
    payload shape, but their gated records do not have the unconditional signature.

    NOTE: intentionally scene-gen-local — it does NOT write `story_steps.json`, whose
    op==8 start_event steps would reference event tables these stages lack and could
    perturb the story engine/`story_robot`. Placement is the only consumer here.
    """
    data = overlay_bytes(str(stage))
    if data is None:
        return None
    valid = {int(k) for k in screens}
    sig_payloads = {(sid, x, y, param)
                    for (_o, active, sid, x, y, _d, param) in sig_records(data)
                    if active == 1 and sid in valid}
    sig_offs = [o for (o, active, sid, *_r) in sig_records(data)
                if active in (1, 9, 10) and sid in valid]
    if not sig_offs:
        return None
    o = max(sig_offs)
    while o + STEP <= len(data):
        if struct.unpack_from("<H", data, o + 8)[0] == 0:      # op==0 terminator
            break
        o += STEP
    else:
        return None
    prog = read_step_program(data, o + STEP)
    if not prog:
        return None
    for (_ca, _aa, _cb, _ab, op, p) in prog:
        if op == 1 and (p[0], p[1], p[2], p[4]) not in sig_payloads:
            return None                                        # not the warp program
    return {"steps": [{"cond_a": ca, "arg_a": aa, "cond_b": cb, "arg_b": ab,
                       "op": op, "params": p}
                      for (ca, aa, cb, ab, op, p) in prog]}


def ice_slide_regions(grid, steps):
    """Export the Ice Dungeon's slippery floor from the type-7 trigger grid.

    Same cell encoding every other grid trigger uses (fieldstg 0x800882d0):
    low 5 bits index the step program, high 3 bits are the opcode's argument.
    A cell whose step is op 11 starts the forced glide and its high bits ARE the
    glide facing (only the four diagonals occur); a cell whose step is op 12 ends
    it. Those two opcodes exist nowhere in the game outside s735/s736.

    Returns `{"cell": px, "start": [[tx,ty,dir],…], "stop": [[tx,ty],…]}` in tile
    coordinates, or None when the stage has no slide. See engine/systems/
    ice-slide.ts and docs/research/field/player-party-movement.md.
    """
    if not grid or not steps or "grid" not in grid:
        return None
    prog = steps.get("steps", [])
    cell, w, cells = grid["cell"], grid["w"], grid["grid"]
    start, stop = [], []
    for i, b in enumerate(cells):
        if not b:
            continue
        idx = b & 0x1f
        if idx >= len(prog):
            continue
        op = prog[idx].get("op")
        if op == 11:
            start.append([i % w, i // w, b >> 5])
        elif op == 12:
            stop.append([i % w, i // w])
    if not start and not stop:
        return None
    return {"cell": cell, "start": start, "stop": stop}


def _cell_clusters(coords, cell):
    """Split trigger cells into 4-connected clusters, one pixel rect each."""
    todo = set(coords)
    rects = []
    while todo:
        seed = todo.pop()
        group, stack = [seed], [seed]
        while stack:
            cx, cy = stack.pop()
            for n in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if n in todo:
                    todo.remove(n)
                    group.append(n)
                    stack.append(n)
        xs = [c[0] for c in group]
        ys = [c[1] for c in group]
        rects.append((min(xs) * cell, min(ys) * cell,
                      (max(xs) - min(xs) + 1) * cell,
                      (max(ys) - min(ys) + 1) * cell))
    return sorted(rects)


def _single_dest_trap_maze(prog):
    """True when every op-13 step in `prog` shares one destination — the bug-maze
    reset warp handled by tools/gen_trap_pads.py, not a launch pad."""
    dests = {tuple(st["params"][:4]) for st in prog if st.get("op") == 13}
    return len(dests) == 1


def grid_warp_exits(stage, grid, steps, screens, manifest_ids, map_size=None):
    """Place exits from the type-7 story-trigger grid — the game's ACTUAL warp
    zonecheck and the source the field UI reads to draw the door indicator.

    The player warps by standing on a grid cell whose byte's low 5 bits index the
    step program; an op=1 step is a warp/arrow carrying the destination, while
    op=9/10 are the decoded endgame circuit/seabed entry controllers with the same
    destination payload
    (`params=[screen, spawnX, spawnY, dir, param, …]`). So the grid cells ARE the
    door's trigger volume — placing the exit rect there makes the blue hit-rect
    coincide with the overhead indicator (previously the rect came from the 0x044N
    door-trigger geometry + proximity, which drifts far from the real trigger, e.g.
    s200's s220 door was ~730px off).

    Returns `(exits, covered)` where `covered` is the set of `(dest_stage, spawnX,
    spawnY, param)` warp keys placed here, so `apply_warp_wiring` skips them and only
    proximity-places the warps the grid doesn't cover (uniform grids / stepless).
    """
    exits, covered = [], set()
    if not grid or not steps:
        return exits, covered
    prog = steps.get("steps", [])
    bounds, clusters = {}, {}
    if "grid" in grid:
        cell, w, cells = grid["cell"], grid["w"], grid["grid"]
        by_idx = {}
        for i, b in enumerate(cells):
            if b:
                by_idx.setdefault(b & 0x1f, []).append((i % w, i // w))
        for idx, coords in by_idx.items():
            # A launch-pad (op 13) step index is shared by SEVERAL separate pads
            # scattered across the map -- one rect per pad, never one bounding
            # box over all of them (that would arm the whole floor).
            if idx < len(prog) and prog[idx].get("op") == 13:
                clusters[idx] = _cell_clusters(coords, cell)
        for idx, coords in by_idx.items():
            xs = [c[0] for c in coords]
            ys = [c[1] for c in coords]
            bounds[idx] = (min(xs) * cell, min(ys) * cell,
                           (max(xs) - min(xs) + 1) * cell,
                           (max(ys) - min(ys) + 1) * cell)
    elif (960 <= stage <= 974 and grid.get("uniform")
          and map_size is not None):
        # The three uniform alias-underground grids (s967/s970/s971) really do
        # return one non-zero step byte over the whole map. Their op-1 action is
        # still confirm-edge gated by the native step runner, so a full-map
        # prompt region does not auto-loop.
        bounds[grid["uniform"] & 0x1f] = (0, 0, map_size[0], map_size[1])
    else:
        return exits, covered
    for idx in sorted(bounds):
        if idx >= len(prog):
            continue
        st = prog[idx]
        if st.get("op") not in (1, 9, 10, 13):
            continue
        p = st["params"]
        entry = screens.get(str(p[0]))
        if entry is None:
            continue
        b = stage_for_screen(screens, p[0], alias_world=stage >= 920)
        if b is None:
            continue
        # op 13 = LAUNCH PAD / reset warp. Decoded 2026-07-28 (runtime, s735):
        # the actor method F0x8008f44c installs handler F0x8008eef0, raises the
        # scene lock and builds the F0x8008c130 controller, which walks the
        # leader onto the nearest type-0x17 pad, plays the pad's state-2
        # animation, then flies the leader to the record's destination on a
        # quarter-sine ease. Every shipped op-13 record targets its OWN screen,
        # so the "same stage" filter below must not eat it.
        # See docs/research/field/door-warp-decode.md and
        # captures/ice-teleport-op13-state1-2026-07-28.txt.
        launch = st["op"] == 13
        if launch and _single_dest_trap_maze(prog):
            # Single-destination act-13 stages are the bug-maze RESET pads
            # (s745/s746/s820); tools/gen_trap_pads.py already rasterises those
            # from the TMPK tile-type layer. Only multi-destination stages
            # (s735/s736 ice launch pads, s800) are launch pads.
            continue
        self_warp = b == stage and 960 <= stage <= 974
        if (b == stage and not (self_warp or launch)) or f"s{b}" not in manifest_ids:
            continue
        spawnX, spawnY, d, param = p[1], p[2], p[3], p[4]
        if isinstance(d, str):
            resolved_dir = d
        else:
            # params[3] is char+0x60 (wstag_extract.DIR8) on every op that carries
            # an arrival facing -- the alias-world self-warps included, which had
            # their own rotated copy of the same wrong four-entry table here.
            resolved_dir = DIR8.get(d, "down")
        x, y, width, height = bounds[idx]
        ex = {"warp": f"s{b}:{param}",
              "x": x, "y": y, "w": width, "h": height,
              "to": f"s{b}", "spawnX": spawnX, "spawnY": spawnY,
              "dir": resolved_dir,
              "grid": True}
        if self_warp:
            ex["selfWarp"] = True
            ex["transition"] = "wrap"
            if not isinstance(d, str) and d not in _NATIVE_DIR_FACINGS:
                ex["nativeDir"] = d
        if st["op"] in (9, 10):
            # Destination/spawn and trigger geometry are authoritative. The
            # original's actor-vtable transition animation is not yet modelled.
            ex["stepOp"] = st["op"]
            ex["transition"] = "dive"
        if launch:
            # No screen change and no fade: the leader is walked onto the pad
            # and then flown to (spawnX, spawnY) on the same map.
            ex["stepOp"] = 13
            ex["transition"] = "launch"
            ex["launchPad"] = True
        # params[5] sits at step-record offset +0x14 -- the field the fieldstg step
        # VM stores into [0x80048d78], which the destination stage's init matches
        # against its selector records' `key` word. Which door you enter by selects
        # the live encounter zone-group on runtime_key stages.
        #
        # Emitted for op 1, 9 and 10: those are the THREE opcodes that write the
        # pair (op 1 at the case's convergence point RAM 0x800886b8; ops 9/10
        # through the field-character vtable slot +0x124, which reaches the same
        # record fields). Ops 2-8 and 11-14 write nothing. Restricting this to
        # 9/10 dropped four real op-1 keyed warps -- the Mobius Desert entries
        # s630/s631 -> s635/s636 (key 1, companion 1) and s645/s646 (key 1,
        # companion 6). Ledger: encounter-zone-group-key-written-on-map-transition.
        #
        # params[6] (+0x16) is stored to [0x80048d7a] by the SAME two sites, in
        # the same unconditional pair. It is the second ROUTE COORDINATE, not an
        # encounter input: the bank-0x7E reader F0x800160a8 splits one predicate
        # space across the two scalars -- index < 0x1e tests d78 == index+1
        # (domain 1..30), index >= 0x1e tests d7a == index-0x1d (domain 1..8).
        # Family-B NPCs are gated on the PAIR, so the companion must ship too.
        # Ledger: encounter-companion-scalar-is-second-route-coordinate.
        if st["op"] in (1, 9, 10) and st["params"][5]:
            ex["entryKey"] = st["params"][5]
            if st["params"][6]:
                ex["entryCompanion"] = st["params"][6]
            if not isinstance(d, str) and d not in _NATIVE_DIR_FACINGS:
                ex["nativeDir"] = d
        gate = _gate_of({"gate_a": st["cond_a"], "arg_a": st["arg_a"],
                         "gate_b": st["cond_b"], "arg_b": st["arg_b"]})
        if gate:
            ex["gate"] = gate
        for (rx, ry, rw, rh) in (clusters.get(idx) or [bounds[idx]]):
            exits.append({**ex, "x": rx, "y": ry, "w": rw, "h": rh})
        covered.add((b, spawnX, spawnY, param))
    return exits, covered


def apply_warp_wiring(scene, stage, data, manifest_ids, grid=None, steps=None,
                      screens=None, map_size=None):
    """Adds warp-derived exits for stage (int) using game-wide `data`
    ({stage int: {"doors", "warps"}}). Replaces previously generated
    ("warp"-tagged) exits; hand exits and "door"-tagged manual wiring
    are left alone.

    Placement is authoritative from the type-7 story-trigger grid when available
    (`grid_warp_exits`, matching the door indicator). Warps the grid doesn't cover
    fall back to the 0x044N door-trigger binding: the warp's param (100 + trigger_idx)
    when a matching door trigger exists, else nearest-trigger proximity snap.
    """
    out = {**scene}
    kept = [e for e in scene.get("exits", []) if "warp" not in e]
    me = data.get(stage)
    my_doors = me.get("doors", [])
    grid_exits, covered = ([], set())
    if screens is not None:
        grid_exits, covered = grid_warp_exits(stage, grid, steps, screens,
                                              manifest_ids, map_size=map_size)

    def _uncovered(warps):
        return [w for w in warps
                if (w["stage"], w["spawnX"], w["spawnY"], w["param"]) not in covered]

    all_pairs = []
    oneway = []   # forward warps with no reciprocal back-warp
    dests = sorted({w["stage"] for w in _uncovered(me["warps"]) if w["stage"] != stage})
    for b in dests:
        if f"s{b}" not in manifest_ids:
            continue
        outs = [w for w in _uncovered(me["warps"]) if w["stage"] == b]
        backs = [v for v in data.get(b, {"warps": []})["warps"]
                 if v["stage"] == stage]
        if not backs:
            # One-way door (e.g. s202->s260): the destination never warps back
            # here, so there is no reciprocal record to locate the trigger by
            # proximity. The forward warp already carries the destination spawn;
            # we still place it when a source trigger can be pinned (below).
            oneway += [(b, w) for w in outs]
            continue
        pairs, approx = _pair_warps(outs, backs)
        all_pairs += [(b, w, v, approx) for w, v in pairs]

    # First pass: assign exits that have an exact param->trigger binding.
    used_trigger_idxs = set()
    exact_exits = []
    fallback_pairs = []
    for b, w, v, approx in all_pairs:
        trigger = _trigger_for_param(w["param"], my_doors)
        if trigger and trigger["idx"] not in used_trigger_idxs:
            used_trigger_idxs.add(trigger["idx"])
            rect = {"x": trigger["x"] - 12, "y": trigger["y1"],
                    "w": 24, "h": trigger["y2"] - trigger["y1"]}
            ex = {"warp": f"s{b}:{w['param']}", **rect,
                  "to": f"s{b}", "spawnX": w["spawnX"], "spawnY": w["spawnY"],
                  "dir": w["dir"] if isinstance(w["dir"], str) else "down"}
            gate = _gate_of(w)
            if gate:
                ex["gate"] = gate
            exact_exits.append(ex)
        else:
            fallback_pairs.append((b, w, v, approx))

    # Second pass: proximity snap for remaining exits using unclaimed triggers.
    remaining_doors = [d for d in my_doors if d["idx"] not in used_trigger_idxs]
    fallback_rects = _assign_rects(
        [(v["spawnX"], v["spawnY"]) for _, _, v, _ in fallback_pairs],
        remaining_doors,
    )
    fallback_exits = []
    for (b, w, v, approx), rect in zip(fallback_pairs, fallback_rects):
        ex = {"warp": f"s{b}:{w['param']}", **rect,
              "to": f"s{b}", "spawnX": w["spawnX"], "spawnY": w["spawnY"],
              "dir": w["dir"] if isinstance(w["dir"], str) else "down"}
        if approx:
            ex["approx"] = True
        matched_door = _door_for_rect(rect, remaining_doors)
        gate = _gate_of(w)
        if gate:
            ex["gate"] = gate
        fallback_exits.append(ex)
        # Record the door this proximity rect consumed so one-way binding below
        # does not reuse it.
        if matched_door:
            used_trigger_idxs.add(matched_door["idx"])

    # One-way exits: bind by param->trigger, else the single remaining door.
    # If several candidate doors remain it would be a guess, so skip and warn.
    oneway_exits = []
    for b, w in oneway:
        trigger = _trigger_for_param(w["param"], my_doors)
        if not (trigger and trigger["idx"] not in used_trigger_idxs):
            free = [d for d in my_doors if d["idx"] not in used_trigger_idxs]
            trigger = free[0] if len(free) == 1 else None
        if trigger is None:
            print(f"  s{stage}: one-way exit ->s{b} (param {w['param']}) has no "
                  f"pinnable source door; left for manual wiring", file=sys.stderr)
            continue
        used_trigger_idxs.add(trigger["idx"])
        rect = {"x": trigger["x"] - 12, "y": trigger["y1"],
                "w": 24, "h": trigger["y2"] - trigger["y1"]}
        ex = {
            "warp": f"s{b}:{w['param']}", **rect, "to": f"s{b}",
            "spawnX": w["spawnX"], "spawnY": w["spawnY"],
            "dir": w["dir"] if isinstance(w["dir"], str) else "down",
            "oneway": True,
        }
        gate = _gate_of(w)
        if gate:
            ex["gate"] = gate
        oneway_exits.append(ex)

    out["exits"] = kept + grid_exits + exact_exits + fallback_exits + oneway_exits
    return out


def apply_wiring(scene, doors, wiring):
    """Manual wiring from web/wire.html: door idx (str) -> exit."""
    out = {**scene}
    kept = [e for e in scene.get("exits", []) if "door" not in e]
    wired = []
    for door in doors:
        w = wiring.get(str(door["idx"]))
        if not w:
            continue
        wired.append({
            "door": door["idx"],
            "x": door["x"] - 12, "y": door["y1"],
            "w": 24, "h": door["y2"] - door["y1"],
            "to": w["to"], "spawnX": w["spawnX"], "spawnY": w["spawnY"],
            "dir": w["dir"],
        })
    out["exits"] = kept + wired
    return out


def merge_gated_warps(data, screens, steps=None):
    """Add flag-gated warps that `wstag_extract` drops.

    The per-stage 24-byte warp/story-step table stores each warp as
    `{cond_a,arg_a,cond_b,arg_b, op(=1 warp), params:[screen,spawnX,spawnY,dir,param,...]}`.
    `wstag_extract.sig_records` only matches the `ffff0000ffff0000` prefix
    (cond_a==cond_b==0xffff, i.e. UNCONDITIONAL), so gated warps (e.g. the Asuka
    City<->Bridge link, cond_a=0x7007) have no signature and never get wired.

    `story_steps.json` op=1 is the fully-parsed table and a proven strict superset
    of the sig-warps, so we append its records that aren't already present (keyed by
    screen+spawn+param). The gate is carried through so `apply_warp_wiring` can tag
    the exit; the browser evaluates that predicate through the shared banked flag
    adapter before exposing the exit for interaction.
    """
    if steps is None:
        if not STORY_STEPS.exists():
            return
        steps = json.loads(STORY_STEPS.read_text()).get("stages", {})
    for stage_key, prog in steps.items():
        stage = int(stage_key)
        me = data.get(stage)
        if me is None:
            continue
        warps = me["warps"]
        seen = {(w["screen"], w["spawnX"], w["spawnY"], w["param"]) for w in warps}
        for step in prog.get("steps", []):
            if step.get("op") != 1:
                continue
            p = step["params"]
            sid, sx, sy, d, param = p[0], p[1], p[2], p[3], p[4]
            entry = screens.get(str(sid))
            if entry is None or (sid, sx, sy, param) in seen:
                continue
            dest = stage_for_screen(screens, sid, alias_world=stage >= 920)
            if dest is None:
                continue
            seen.add((sid, sx, sy, param))
            warps.append({
                "screen": sid, "stage": dest,
                "spawnX": sx, "spawnY": sy,
                "dir": DIR8.get(d, d), "param": param,
                "gate_a": step["cond_a"], "arg_a": step["arg_a"],
                "gate_b": step["cond_b"], "arg_b": step["arg_b"],
            })


def merge_compiled_warps(data, screens):
    """Recover warps for a stage whose overlay is a PURE-DATA compiled program — no
    sig-warp records, no clean 24-byte step table, no type-7 grid resource. s260
    (Asuka Cargo Tower) is the only such stage game-wide: wstag260 is entirely
    compiled zonecheck/step bytecode (section base 0x80000000, all `.word`), so all
    three normal extractors find nothing and the tower is unexitable.

    The warp DESTINATION is still stored inline as a `{screen, spawnX, spawnY, dir,
    param}` payload. We scan for warp-shaped payloads (valid screen; x,y < 4096;
    dir in {1,3,5,7}; param < 256) and accept one ONLY when the destination stage has
    a RECIPROCAL warp back to this stage — independent data proving the link and
    rejecting coincidental byte matches. Across the 16 zero-warp stages game-wide only
    s260 corroborates (→s275, 31 identical copies — the exact mirror of s261→s276), so
    this is tightly self-limiting. The trigger LOCATION is VM-derived and not decoded,
    so placement falls to `apply_warp_wiring`'s reciprocal-arrival fallback, exactly
    like the 28 other single-exit interior rooms.
    """
    dirs_ok = {1, 3, 5, 7}
    valid = {int(k) for k in screens}
    # recip[T] = {S : data[S] has a warp to T}; "dest warps back to st" == dest in recip[st].
    recip = {}
    for st, me in data.items():
        for w in me.get("warps", []):
            recip.setdefault(w["stage"], set()).add(st)
    for st, me in data.items():
        if me.get("warps"):
            continue
        b = overlay_bytes(str(st))
        if b is None:
            continue
        seen = set()
        for i in range(0, len(b) - 9, 2):     # need 10 bytes: last start = len-10
            screen, x, y, d, param = struct.unpack_from("<5H", b, i)
            if (screen not in valid or x >= 4096 or y >= 4096
                    or d not in dirs_ok or param >= 256):
                continue
            dest = screens[str(screen)]["stage"]
            if dest == st or dest not in recip.get(st, ()):
                continue                      # require reciprocal warp dest -> st
            key = (screen, x, y, param)
            if key in seen:
                continue
            seen.add(key)
            me["warps"].append({"screen": screen, "stage": dest,
                                "spawnX": x, "spawnY": y,
                                "dir": DIR8.get(d, d), "param": param})


def merge_maze_exits(data, story_grids, screens):
    """Wire the Mobius Desert self-warp stages from runtime-captured exit tables.

    The `wstag*.s` warp records for these stages are stale placeholders (self-warps
    to their own screen), so `wstag_extract` yields exits==[] and the stages ship
    dead. The real disc overlay loads inter-map neighbour warps into the field exit
    buffer; those were captured live on the rig (`web/assets/data/maze_exits.json`,
    verified entry- and state-independent). This:

      1. replaces `data[stage]["warps"]` with the real neighbour warps, and
      2. returns a synthetic per-stage step program so the existing
         `grid_warp_exits` places each exit at its type-7 grid wedge (wedge code =
         (dir<<5)|step, so the wedge whose high-3 dir matches the exit's dir is the
         trigger). Reuses the normal grid-exit path — no self-warp/teleport model.

    Returns `maze_steps` = {str(stage): {"steps": [...]}} keyed by grid step index.
    """
    if not MAZE_EXITS.exists():
        return {}
    spec = json.loads(MAZE_EXITS.read_text()).get("stages", {})
    maze_steps = {}
    for sid, exits in spec.items():
        stage = int(sid)
        if stage not in data:
            continue
        grid = story_grids.get(sid)
        if not grid:
            continue
        # dir(int) -> grid step index (low 5 bits of the wedge whose high-3 == dir)
        # -- the desert fallback; seabed entries carry an explicit "step" instead
        # (harvest order = step order; live dir 0 maps to wedge dir 4, so dir
        # matching can't key those).
        dir_to_step = {}
        for b in set(grid.get("grid", [])):
            if b:
                dir_to_step[b >> 5] = b & 0x1f
        real_warps = []
        prog = []
        for ex in exits:
            # dir may be a name ("up") or a raw live int (0 = non-cardinal)
            di = MAZE_DIR_TO_INT.get(ex["dir"],
                                     ex["dir"] if isinstance(ex["dir"], int) else None)
            real_warps.append({"screen": ex["screen"],
                               "stage": screens[str(ex["screen"])]["stage"],
                               "spawnX": ex["spawnX"], "spawnY": ex["spawnY"],
                               "dir": ex["dir"], "param": 0})
            step = ex["step"] if "step" in ex else dir_to_step.get(di)
            if step is None:
                continue
            while len(prog) <= step:
                prog.append({"op": 0, "params": [0] * 7,
                             "cond_a": 0xffff, "arg_a": 0,
                             "cond_b": 0xffff, "arg_b": 0})
            # The record's facing travels as the NAME the maze enum gives it
            # (MAZE_DIR_NAMES), not as a char+0x60 index: this is not a step
            # record, it is a maze exit record wearing one so the shared
            # grid_warp_exits placement can find the trigger cell. Handing over the
            # raw int would make grid_warp_exits name it with DIR8, which reads 5 as
            # "up-right" -- one step out of true for a word that means north.
            prog[step] = {"op": 1,
                          "params": [ex["screen"], ex["spawnX"], ex["spawnY"],
                                     ex["dir"], 0, 0, 0],
                          "cond_a": 0xffff, "arg_a": 0,
                          "cond_b": 0xffff, "arg_b": 0}
        data[stage]["warps"] = real_warps
        maze_steps[sid] = {"steps": prog}
    return maze_steps


def _wedge_bounds(grid):
    """step index -> the bounding rect of the type-7 grid cells naming it.

    The same math `grid_warp_exits` places its exits with: a cell's low 5 bits
    index the step program, so the cells naming step i are that step's trigger.
    """
    if not grid or "grid" not in grid:
        return {}
    cell, w, cells = grid["cell"], grid["w"], grid["grid"]
    by_idx = {}
    for i, b in enumerate(cells):
        if b:
            by_idx.setdefault(b & 0x1F, []).append((i % w, i // w))
    bounds = {}
    for idx, coords in by_idx.items():
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        bounds[idx] = (min(xs) * cell, min(ys) * cell,
                       (max(xs) - min(xs) + 1) * cell,
                       (max(ys) - min(ys) + 1) * cell)
    return bounds


def apply_place_points(scene, stage, place_points, screens, manifest_ids,
                       story_grids, story_steps):
    """Rebuild a places stage's exits as its own StageSlots, and attach the table.

    The 34 stages that carry a `placePoints` table re-aim their exits per the place
    they are entered from: updateStage copies the entry matching the incoming route
    pair into the stage's first StageSlots (`copyPlacePoints`, WS7 of
    docs/research/scripting/field-script-engine-verified.md), and the slot IS the
    stage's type-7 step record — the walker's exit row. So:

      * the rows are rebuilt from the STATIC step program (one per op-1 step, at
        its own grid wedge) with `slot` = the step index. Their values are the
        static record's own — a self-warp placeholder on the maze stages, which is
        what the disc's un-copied slots hold;
      * the table rides on the scene as `placePoints`, each point carrying the
        destination stage resolved from its screen id (the base table; the runtime
        re-resolves through the ported screen router so the post-game shadow
        records still win) and its facing name (the maze enum: 1 = south,
        3 = west, 5 = north, 7 = east; 0 = a hole out, arriving "down" like every
        other facing-0 record).

    The runtime copy (engine/systems/place-points.ts) then aims point i at slot i
    on every arrival, from the scene's own base rows.
    """
    table = place_points.get(str(stage))
    if not table:
        return scene
    out = {**scene}
    kept = [e for e in scene.get("exits", []) if "warp" not in e]
    prog = (story_steps.get(str(stage)) or {}).get("steps", [])
    bounds = _wedge_bounds(story_grids.get(str(stage)))
    rows = []
    for i, st in enumerate(prog):
        if st.get("op") != 1:
            continue
        rect = bounds.get(i)
        if rect is None:
            continue                       # no wedge names this step: no trigger
        p = st.get("params") or []
        dest = stage_for_screen(screens, p[0], alias_world=stage >= 920)
        if dest is None or f"s{dest}" not in manifest_ids:
            continue
        row = {"warp": f"s{dest}:{p[4] if len(p) > 4 else 0}",
               "x": rect[0], "y": rect[1], "w": rect[2], "h": rect[3],
               "to": f"s{dest}", "spawnX": p[1], "spawnY": p[2],
               "dir": DIR8.get(p[3], "down"), "grid": True, "slot": i}
        if dest == stage:
            row["selfWarp"] = True
            row["transition"] = "wrap"
            if not isinstance(p[3], str) and p[3] not in _NATIVE_DIR_FACINGS:
                row["nativeDir"] = p[3]
        rows.append(row)
    out["exits"] = kept + rows
    entries = []
    for e in table["entries"]:
        points = []
        for pt in e["points"]:
            dest = stage_for_screen(screens, pt["screen"])
            points.append({
                "screen": pt["screen"],
                "to": (f"s{dest}" if dest is not None and f"s{dest}" in manifest_ids
                       else None),
                "x": pt["x"], "y": pt["y"], "dir": pt["dir"],
                "dirName": MAZE_DIR_NAMES.get(pt["dir"]) or "down",
                "place": pt["place"], "placeArg": pt["placeArg"],
            })
        entries.append({"place": e["place"], "placeArg": e["placeArg"],
                        "points": points})
    out["placePoints"] = {"entries": entries, "variant": table.get("variant")}
    return out


def main():
    manifest = json.loads((ROOT / "web/assets/manifest.json").read_text())
    manifest_ids = {m["id"] for m in manifest["maps"]}
    known_sprites = {n["id"] for n in manifest.get("npcs", []) + manifest.get("characters", [])}
    global SCENES
    args = sys.argv[1:]
    out_dir = None
    if "--out" in args:
        i = args.index("--out")
        out_dir = args[i + 1]
        del args[i:i + 2]
    if out_dir is not None:
        SCENES = Path(out_dir)
        if not SCENES.is_absolute():
            SCENES = ROOT / SCENES
    if "--all" in args:
        stages = sorted(manifest_ids)
    else:
        stages = ["s" + s.lstrip("s") for s in args if not s.startswith("--")]
    if not stages:
        sys.exit(__doc__)

    screens = load_screens()

    # Cast-list + talk-event wiring: `extract` gains the descriptor's +0x4C cast
    # records for the npc ids this stage's OnTalk events address but the base
    # run-scan did not surface. Small and additive (see wstag_extract.extract).
    cast_ptr_by_stage = {}
    if DESCRIPTORS.exists():
        for entry in json.loads(DESCRIPTORS.read_text()):
            stage_name = str(entry.get("stage", ""))
            raw = str(entry.get("fields", {}).get("4C", ""))
            if stage_name.startswith("wstag") and raw.startswith("0x") and len(raw) == 10:
                try:
                    cast_ptr_by_stage[int(stage_name[5:])] = int(raw, 16)
                except ValueError:
                    pass
    data = {}
    for p in ASM_DIR.glob("wstag*.s"):
        stage_no = int(p.stem[5:])
        r = extract(p.stem[5:], screens,
                    cast_ptr=cast_ptr_by_stage.get(stage_no))
        if r:
            # At ordinal 0x2d the loader resolves matching screen ids through
            # the s9xx shadow records. Keep alias-world exits inside that world.
            if int(r["stage"]) >= 920:
                for warp in r.get("warps", []):
                    alt_stage = stage_for_screen(
                        screens, warp["screen"], alias_world=True
                    )
                    if alt_stage is not None:
                        warp["stage"] = alt_stage
            data[int(r["stage"])] = r
    merge_gated_warps(data, screens)
    merge_compiled_warps(data, screens)

    story_steps = (json.loads(STORY_STEPS.read_text()).get("stages", {})
                   if STORY_STEPS.exists() else {})
    story_grids = (json.loads(STORY_GRIDS.read_text()).get("stages", {})
                   if STORY_GRIDS.exists() else {})
    maze_steps = merge_maze_exits(data, story_grids, screens)

    wstag_raw = (json.loads(WSTAG_EVENTS.read_text())
                 if WSTAG_EVENTS.exists() else {})
    npc_facing = build_npc_facing(wstag_raw)

    wiring_path = ROOT / "data/door_wiring.json"
    all_wiring = (json.loads(wiring_path.read_text())
                  if wiring_path.exists() else {})
    maze_sections = (json.loads(MAZE_SECTIONS.read_text()).get("stages", {})
                     if MAZE_SECTIONS.exists() else {})
    place_points = (json.loads(PLACE_POINTS.read_text()).get("stages", {})
                    if PLACE_POINTS.exists() else {})
    for sid in stages:
        stage = int(sid.lstrip("s"))
        if stage not in data:
            print(f"{sid}: no overlay, skipped")
            continue
        path = SCENES / f"{sid}.json"
        scene = (json.loads(path.read_text()) if path.exists()
                 else {"npcs": [], "exits": [], "zones": []})
        scene = purge_ext_npcs(scene)
        scene = purge_real_npcs(scene)
        scene = apply_npc_spawns(scene, data[stage]["npcs"], known_sprites,
                                 npc_facing=npc_facing.get(stage, {}),
                                 stage=stage)
        scene = apply_wiring(scene, data[stage]["doors"],
                             all_wiring.get(sid, {}))
        steps = maze_steps.get(str(stage)) or story_steps.get(str(stage))
        if steps is None:
            # Event-less stage: reconstruct the tail step-program so grid placement
            # works (else exits fall to overlapping proximity fallbacks). See
            # tail_step_program.
            steps = tail_step_program(stage, screens)
        scene = apply_warp_wiring(scene, stage, data, manifest_ids,
                                  grid=story_grids.get(str(stage)),
                                  steps=steps,
                                  screens=screens)
        # The places system, when this stage carries a placePoints table: the exits
        # become the stage's own StageSlots (one row per op-1 step, with `slot`),
        # and the table rides on the scene so the runtime copy can re-aim them per
        # the incoming place pair. See apply_place_points and
        # engine/systems/place-points.ts.
        scene = apply_place_points(scene, stage, place_points, screens,
                                   manifest_ids, story_grids, story_steps)
        # The wrap-maze GRAPH, when this stage has one. Each entry is one maze
        # section -- one (key, companion) route pair -- with its exits. The walker
        # resolves a wrap trigger through this instead of the stale placeholder
        # self-warp, so the Circuit Board's seven pattern screens become the
        # 294-section maze they are in the original rather than seven dead rooms.
        # Extracted by tools/extract_maze_exits.py; ledger maze-exit-record-table.
        secs = maze_sections.get(str(stage))
        if secs:
            # Resolve each exit's screen id to a walker stage id and its native
            # dir to a name here, so the browser reads one shared definition
            # instead of carrying its own screen and direction tables.
            enriched = []
            for sec in secs:
                exits = []
                for e in sec["exits"]:
                    dest = stage_for_screen(screens, e["screen"])
                    if dest is None or f"s{dest}" not in manifest_ids:
                        continue
                    exits.append({**e, "to": f"s{dest}",
                                  "dirName": MAZE_DIR_NAMES.get(e["dir"])})
                if exits:
                    enriched.append({"key": sec["key"],
                                     "companion": sec["companion"],
                                     "exits": exits})
            if enriched:
                scene["mazeSections"] = enriched
            elif "mazeSections" in scene:
                del scene["mazeSections"]
        elif "mazeSections" in scene:
            del scene["mazeSections"]
        slides = ice_slide_regions(story_grids.get(str(stage)), steps)
        if slides:
            scene["iceSlide"] = slides
        elif "iceSlide" in scene:
            del scene["iceSlide"]
        scene["doors"] = data[stage]["doors"]
        scene["warps"] = data[stage]["warps"]
        scene["ladders"] = data[stage]["ladders"]
        path.write_text(json.dumps(scene, indent=1))
        auto = [e for e in scene["exits"] if "warp" in e]
        real_npcs = [n for n in scene["npcs"] if n.get("id", "").startswith("real_")]
        print(f"{sid}: {len(scene['npcs'])} npcs ({len(real_npcs)} real), "
              f"{len(scene['exits'])} exits "
              f"({len(auto)} warp-wired: "
              f"{', '.join(e['to'] for e in auto) or '-'})")


if __name__ == "__main__":
    main()
