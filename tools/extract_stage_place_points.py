#!/usr/bin/env python3
"""Extract the per-stage placePoints tables — the places system — from the wstag overlays.

WHAT IT IS.  A stage entered from a warp arrives with a "which way did you come in"
pair: GAME.place / GAME.placeArg (`D0x80048D34 +0x44/+0x46`), the two scalars the
route-pair system publishes on the transition.  On its first tick the stage's
updateStage copies the matching chain out of the overlay's `placePoints` table into
its first StageSlots (`copyPlacePoints`), so the stage's exits re-aim per entry place.
34 stage overlays carry the table (WS7 of
docs/research/scripting/field-script-engine-verified.md; ledger
`places-copy-place-points-family-2026-10-10`).

STRUCTURE (read from the assembly, not inferred).  `placePoints` is a
NULL-terminated array of pointers to 8-byte entry records:

    placePoints -> [ptr entry_0, ptr entry_1, ..., NULL]
    entry       = {s16 place; s16 placeArg; StagePoint *points}
    StagePoint  = {u16 screen; u16 place; u16 placeArg; u16 x; u16 y; u16 dir;
                   StagePoint *next}                          // 16 bytes

`copyPlacePoints(slots, placePoints, place, placeArg)` walks the array, matches
place AND placeArg exactly, then follows `points` -> `next` copying each point into
consecutive slots (slot+0xA <- screen, +0xC <- x, +0xE <- y, +0x10 <- dir,
+0x14 <- place, +0x16 <- placeArg).  The chain is laid out BACKWARD in the file
(each record's `next` points at a lower address), so the order the extractor emits
— `points` first, then following `next` — IS the copy order, and point i lands on
slot i.  Every table ends with a {0,0} default entry in 12 of the 34 overlays; the
other 22 have none, so an incoming pair the table does not describe leaves the
slots' static values standing (the disc returns without copying).

The table address is read mechanically from each overlay's updateStage: the `jal`
to the overlay's own copyPlacePoints has the placePoints address in its delay slot
(`addiu $a1, imm`, high half from `lui $a1, 0x800a`).  The `variant` field records
which of the three updateStage shapes (WS7) the call sits in, classified from the
same function: copy-first (25), nextState-first (7), tile-anims-first (2).

VALIDATION (`--check`):
  * structure: array terminated, entry/point fields in range, `next` strictly
    decreasing, dir in the maze four-way enum {0,1,3,5,7};
  * cross-check against web/assets/data/maze_sections.json (tools/extract_maze_exits.py):
    the same 34 stages, the same (key, companion) sections, the same point sets,
    with the copy order = the reverse of the section chain order;
  * cross-check against the rig capture web/assets/data/maze_exits.json: every
    captured exit sequence is one entry's chain, in order.

Usage:
  python3 tools/extract_stage_place_points.py --write    # emit the asset
  python3 tools/extract_stage_place_points.py --check    # validate
  python3 tools/extract_stage_place_points.py s835       # dump one stage
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_extract as W  # noqa: E402
import extract_maze_exits as ME  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/assets/data/stage_place_points.json"
SECTIONS = ROOT / "web/assets/data/maze_sections.json"
CAPTURE = ROOT / "web/assets/data/maze_exits.json"

BASE = 0x800A5DE0
# The copy body's first three words: lw $v1,($a1) / nop / beqz $v1 -> return.
COPY_SIG = (0x8CA30000, 0x00000000, 0x1060003B)
# The maze exit records' own four-way facing enum (see gen_scenes.MAZE_DIR_NAMES):
# 0 = a hole out (no facing), 1 = south, 3 = west, 5 = north, 7 = east.
MAZE_DIRS = (0, 1, 3, 5, 7)
# The maze enum's names (gen_scenes.MAZE_DIR_NAMES): 1 = south, 3 = west,
# 5 = north, 7 = east; 0 is a hole with no facing.
DIR_NAMES = {1: "down", 3: "left", 5: "up", 7: "right"}
DIR_INTS = {v: k for k, v in DIR_NAMES.items()}
# The three updateStage shapes of WS7, keyed by what runs first.
VARIANTS = ("copy-first", "next-first", "tile-anims-first")


def words(stage):
    """The overlay's raw word list (its .word annotations)."""
    path = W.ASM_DIR / f"wstag{stage}.s"
    ws = []
    for line in path.read_text().splitlines():
        m = re.search(r"\.word (0x[0-9a-f]+)", line)
        if m:
            ws.append(int(m.group(1), 16))
    return ws


def copy_entry(ws):
    """Word index of the overlay's copyPlacePoints body, or None."""
    for i in range(len(ws) - 2):
        if (ws[i], ws[i + 1], ws[i + 2]) == COPY_SIG:
            return i
    return None


def jal_target(w):
    return 0x80000000 | ((w & 0x3FFFFFF) << 2)


def update_stage_call(ws, entry_idx):
    """(call index, placePoints address, variant) for the one updateStage call."""
    entry_addr = BASE + 4 * entry_idx
    calls = [i for i, w in enumerate(ws)
             if (w >> 26) == 3 and jal_target(w) == entry_addr]
    if len(calls) != 1:
        return None
    i = calls[0]
    delay = ws[i + 1] if i + 1 < len(ws) else 0
    if (delay >> 26) != 9 or ((delay >> 21) & 31) != 5:      # addiu $a1, imm
        return None
    addr = 0x800A0000 + (delay & 0xFFFF)
    return i, addr, classify_variant(ws, i, entry_idx)


def classify_variant(ws, call_idx, entry_idx):
    """Which WS7 shape the call sits in — from the enclosing updateStage's own words.

    The function is bounded by its prologue (`addiu $sp, $sp, -N`) and its
    `jr $ra`; the three shapes are told apart by what runs before the copy:
    a `jal` to a target below the copy entry (the overlay's createTileAnims),
    a `lw $vX, 0x38($sY)` (the task's nextState pointer), or nothing.
    """
    start = 0
    for i in range(call_idx, 0, -1):
        w = ws[i]
        if (w >> 26) == 9 and ((w >> 21) & 31) == 29 and ((w >> 16) & 31) == 29 \
                and (w & 0x8000) and (w & 0xFFFF) != 0:
            start = i
            break
    end = len(ws)
    for i in range(call_idx, len(ws)):
        if ws[i] == 0x03E00008:
            end = i
            break
    entry_addr = BASE + 4 * entry_idx
    idx_next = idx_tile = None
    for i in range(start, end):
        w = ws[i]
        if (w >> 26) == 0x23 and (w & 0xFFFF) == 0x38 and i < call_idx:   # lw vX,0x38(sY)
            idx_next = i
        if (w >> 26) == 3 and i < call_idx:
            tgt = jal_target(w)
            if BASE <= tgt < entry_addr:
                idx_tile = i
    if idx_tile is not None and (idx_next is None or idx_tile < idx_next):
        return "tile-anims-first"
    if idx_next is not None and idx_next < call_idx:
        return "next-first"
    return "copy-first"


def parse_table(data, addr):
    """The placePoints array at RAM `addr`, in copy order."""
    o = addr - BASE
    entries = []
    i = o
    while True:
        if i + 4 > len(data):
            raise ValueError("unterminated placePoints array")
        ptr = struct.unpack_from("<I", data, i)[0]
        if ptr == 0:
            break
        eo = ptr - BASE
        if not (0 <= eo <= len(data) - 8):
            raise ValueError(f"entry pointer {ptr:#x} outside the overlay")
        place, placeArg, points = struct.unpack_from("<hhI", data, eo)
        chain = []
        if points:
            po = points - BASE
            prev = None
            while True:
                if not (0 <= po <= len(data) - 16):
                    raise ValueError(f"point pointer {points:#x} outside the overlay")
                if prev is not None and po >= prev:
                    raise ValueError("chain `next` is not strictly decreasing")
                screen, key, comp, x, y, d, nxt = struct.unpack_from("<6HI", data, po)
                chain.append({"screen": screen, "place": key, "placeArg": comp,
                              "x": x, "y": y, "dir": d})
                prev = po
                if nxt == 0:
                    break
                po = nxt - BASE
        entries.append({"place": place, "placeArg": placeArg, "points": chain})
        i += 4
    return entries


def extract(stage):
    ws = words(stage)
    data = W.overlay_bytes(stage)
    if data is None:
        return None
    e = copy_entry(ws)
    if e is None:
        return None
    call = update_stage_call(ws, e)
    if call is None:
        return None
    _, addr, variant = call
    if not (BASE <= addr < BASE + len(data)):
        raise ValueError(f"s{stage}: placePoints {addr:#x} outside the overlay")
    return {"address": f"0x{addr:08x}", "variant": variant,
            "entries": parse_table(data, addr)}


def write(screens):
    stages = {}
    for stage in ME.MAZE_STAGES:
        got = extract(stage)
        if got is None:
            print(f"s{stage}: no placePoints table", file=sys.stderr)
            continue
        stages[stage] = got
    OUT.write_text(json.dumps({
        "_comment": (
            "The places system's per-stage placePoints tables, extracted by "
            "tools/extract_stage_place_points.py from the wstag overlays. Each "
            "stage's updateStage copies the entry matching GAME.place/GAME.placeArg "
            "(the route pair) into its first StageSlots (copyPlacePoints, WS7 of "
            "docs/research/scripting/field-script-engine-verified.md); the points "
            "are listed in COPY ORDER (point i -> slot i). `variant` is which of "
            "the three updateStage shapes the call sits in. Ledger: "
            "places-copy-place-points-family-2026-10-10, "
            "places-update-stage-variants-2026-10-10."),
        "stages": stages,
    }, indent=1) + "\n")
    total = sum(len(s["entries"]) for s in stages.values())
    points = sum(len(e["points"]) for s in stages.values() for e in s["entries"])
    print(f"wrote {OUT} ({len(stages)} stages, {total} entries, {points} points)")
    return 0


def check(screens):
    fails = []
    stages = {}
    for stage in ME.MAZE_STAGES:
        try:
            stages[stage] = extract(stage)
        except ValueError as exc:
            fails.append(f"s{stage}: {exc}")
    if len(stages) != len(ME.MAZE_STAGES):
        fails.append(f"{len(stages)} of {len(ME.MAZE_STAGES)} stages extracted")
    for stage, got in stages.items():
        if got is None:
            fails.append(f"s{stage}: no table")
            continue
        if got["variant"] not in VARIANTS:
            fails.append(f"s{stage}: bad variant {got['variant']}")
        for e in got["entries"]:
            if not (0 <= e["place"] < 64 and 0 <= e["placeArg"] < 64):
                fails.append(f"s{stage}: entry ({e['place']},{e['placeArg']}) out of range")
            if not e["points"]:
                fails.append(f"s{stage}: entry ({e['place']},{e['placeArg']}) has no points")
            for p in e["points"]:
                if p["screen"] not in screens:
                    fails.append(f"s{stage}: screen {p['screen']} not in the table")
                if p["dir"] not in MAZE_DIRS:
                    fails.append(f"s{stage}: dir {p['dir']} not a maze facing")
                if not (0 < p["x"] < 4096 and 0 < p["y"] < 4096):
                    fails.append(f"s{stage}: point ({p['x']},{p['y']}) out of range")
    # ── cross-check 1: the section graph (maze_sections.json) ──
    if SECTIONS.exists():
        secs = json.loads(SECTIONS.read_text())["stages"]
        for stage, got in stages.items():
            if got is None:
                continue
            entries = [e for e in got["entries"] if (e["place"], e["placeArg"]) != (0, 0)]
            by_pair = {(e["place"], e["placeArg"]): e for e in entries}
            graph = {(s["key"], s["companion"]): s for s in secs.get(stage, [])}
            if set(by_pair) != set(graph):
                fails.append(f"s{stage}: entry pairs != section pairs")
                continue
            for pair, e in by_pair.items():
                mine = sorted((p["screen"], p["x"], p["y"], p["dir"]) for p in e["points"])
                theirs = sorted((x["screen"], x["x"], x["y"], x["dir"]) for x in graph[pair]["exits"])
                if mine != theirs:
                    fails.append(f"s{stage} {pair}: point set != section exit set")
                # The section chain is the copy chain read backward (head has
                # next == 0); the copy order is what the engine consumes.
                rev = [(x["screen"], x["x"], x["y"], x["dir"]) for x in reversed(graph[pair]["exits"])]
                fwd = [(p["screen"], p["x"], p["y"], p["dir"]) for p in e["points"]]
                if rev != fwd:
                    fails.append(f"s{stage} {pair}: copy order != reversed section chain")
        missing = set(ME.MAZE_STAGES) - set(secs)
        if missing:
            fails.append(f"maze_sections.json lacks {sorted(missing)}")
    else:
        fails.append("maze_sections.json missing")
    # ── cross-check 2: the rig capture (maze_exits.json) ──
    if CAPTURE.exists():
        cap = json.loads(CAPTURE.read_text())["stages"]
        for stage, exits in cap.items():
            got = stages.get(stage)
            if got is None:
                fails.append(f"s{stage}: captured but no table")
                continue
            want = []
            for ex in exits:
                d = ex["dir"]
                if isinstance(d, str):
                    d = DIR_INTS.get(d, 0)
                want.append((ex["screen"], ex["spawnX"], ex["spawnY"], d))
            default = next((e for e in got["entries"]
                            if (e["place"], e["placeArg"]) == (0, 0)), None)
            if default is not None:
                # With a (0,0) default present the rig's entry published (0,0),
                # so the capture must be exactly that entry's chain.
                seq = [(p["screen"], p["x"], p["y"], p["dir"]) for p in default["points"]]
                if seq != want:
                    fails.append(f"s{stage}: capture != the (0,0) default chain")
            elif not any([(p["screen"], p["x"], p["y"], p["dir"]) for p in e["points"]] == want
                         for e in got["entries"]):
                fails.append(f"s{stage}: captured exit sequence matches no entry chain")
    else:
        fails.append("maze_exits.json missing")
    for f in fails:
        print("  FAIL", f)
    n = sum(1 for s in stages.values() if s)
    print(f"check: {len(ME.MAZE_STAGES)} stages extracted, {n} parsed; "
          f"{len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    screens = {int(k) for k in W.load_screens()}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--check" in sys.argv:
        sys.exit(check(screens))
    if "--write" in sys.argv:
        sys.exit(write(screens))
    stages = [a.lstrip("s") for a in args] or ME.MAZE_STAGES
    for stage in stages:
        got = extract(stage)
        if got is None:
            print(f"s{stage}: no placePoints table")
            continue
        print(f"s{stage}: placePoints at {got['address']} ({got['variant']}), "
              f"{len(got['entries'])} entries")
        for e in got["entries"]:
            chain = ", ".join(
                f"({p['screen']},{p['x']},{p['y']},d{p['dir']},k{p['place']},c{p['placeArg']})"
                for p in e["points"])
            print(f"    place={e['place']:3d} placeArg={e['placeArg']} -> {chain}")


if __name__ == "__main__":
    main()
