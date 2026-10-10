"""
Decodes bug-maze trap pads and writes them into the per-stage scene JSON.

Mechanism (decoded 2026-06-28):
- A bug-maze stage (e.g. s745/s746, the "Bug Maze Pit") has act-13 sig-warp
  records in its wstag overlay that ALL share one destination -- the maze
  reset point. Stepping on a "bugged" floor tile bounces the player there.
- The bugged tiles are marked in the TMPK walkmesh's elevated layer, whose
  leaf bytes are TILE-TYPE codes (not just walkable/blocked). The trap tiles
  form a contiguous run of tile-type values whose length equals the number of
  act-13 records. (s745: values 6..23 = 18 pads = 18 records; s746: 5..23 = 19.)

This tool finds that run, rasterises the trap tiles to an 8px-cell mask, and
adds a "trapPads" block to web/assets/scenes/<id>.json:

  "trapPads": {"reset": {"x", "y", "dir"}, "cell", "cols", "rows",
               "mask": ["0101...", ...]}   # '1' = trap cell

Stages whose act-13 records have multiple distinct destinations (true teleport
mazes like s810) or no matching tile-type run are left undecoded and skipped.

Run: python3 tools/gen_trap_pads.py            (all stages)
     python3 tools/gen_trap_pads.py s745       (specific stages)
     python3 tools/gen_trap_pads.py --out DIR  (write into DIR, not web/assets/scenes)
"""

import json
import sys
from pathlib import Path

import wstag_extract
from tmpk_collision import (CELL, THRESHOLD, decode_layer_pixels, find_layers)

ROOT = Path(__file__).resolve().parent.parent
SCENES = ROOT / "web/assets/scenes"
# An act-13 record's 4th payload word is `params[3]`, the same char+0x60 facing
# index a door/warp record carries: the handoff at fieldstg.s file 0x8a24 stores it
# at scene_obj+0x6c and the arriving actor's spawn copies that straight into
# char+0x60 (fieldstg.s:0xe758 / :0xe760, no mask, no table). So it is named
# through the same single 0-7 table as every other arrival
# (wstag_extract.DIR8) -- NOT the wrap-maze exit records' own four-way enum
# (gen_scenes.MAZE_DIR_NAMES: 1=south, 3=west, 5=north, 7=east), which is a
# different structure read from a rig capture.
DIRS = wstag_extract.DIR8


def reset_dir(word):
    """An act-13 record's facing word -> the name web/game.js puts in state.dir."""
    return DIRS.get(word, "down")


def act13_reset(stage):
    """Return (x, y, dir) of the single trap reset, or None if not a single-
    destination trap maze (no act-13 records, or several distinct dests)."""
    data = wstag_extract.overlay_bytes(stage[1:] if stage.startswith("s") else stage)
    if not data:
        return None, 0
    recs = [r for r in wstag_extract.sig_records(data) if r[1] == 13]
    if not recs:
        return None, 0
    dests = {(r[3], r[4], r[5]) for r in recs}
    if len(dests) != 1:
        return None, len(recs)            # multi-dest teleport maze: undecoded
    x, y, d = next(iter(dests))
    return {"x": x, "y": y, "dir": reset_dir(d)}, len(recs)


def _longest_runs(values):
    """Contiguous runs in a sorted set of ints, as [(lo, hi, length), ...]."""
    vals = sorted(values)
    runs, start = [], None
    for i, v in enumerate(vals):
        if start is None:
            start = v
        if i + 1 == len(vals) or vals[i + 1] != v + 1:
            runs.append((start, v, v - start + 1))
            start = None
    return runs


def pad_values_for(typed_layers, n_records):
    """The set of tile-type values that are trap pads: the contiguous run whose
    length matches the act-13 record count. Returns (values, layer) or (None,
    None) if no layer has such a run."""
    for layer in typed_layers:
        present = {v for row in layer for v in row if v}
        for lo, hi, length in _longest_runs(present):
            if length == n_records:
                return set(range(lo, hi + 1)), layer
    return None, None


def trap_mask(layer, pad_values, width, height):
    """8px-cell mask string list: '1' where the cell is majority trap-pad."""
    cols, rows = -(-width // CELL), -(-height // CELL)
    gh, gw = len(layer), len(layer[0]) if layer else 0
    mask = []
    for r in range(rows):
        line = []
        for c in range(cols):
            count = 0
            for py in range(r * CELL, min((r + 1) * CELL, gh)):
                row = layer[py]
                for px in range(c * CELL, min((c + 1) * CELL, gw)):
                    if row[px] in pad_values:
                        count += 1
            line.append("1" if count >= THRESHOLD else "0")
        mask.append("".join(line))
    return {"cell": CELL, "cols": cols, "rows": rows, "mask": mask}


def build_stage(stage, manifest):
    reset, n = act13_reset(stage)
    if reset is None:
        return None
    dims = next((m for m in manifest["maps"] if m["id"] == stage), None)
    if not dims:
        return None
    gw, gh = dims["width"] // 128, dims["height"] // 128
    bins_layers = find_layers(stage, gw, gh)
    typed = [decode_layer_pixels(b, gw, gh, typed=True) for b in bins_layers]
    pad_values, layer = pad_values_for(typed, n)
    if pad_values is None:
        return None
    block = trap_mask(layer, pad_values, dims["width"], dims["height"])
    block["reset"] = reset
    return block


def main():
    global SCENES
    args = sys.argv[1:]
    if "--out" in args:
        i = args.index("--out")
        SCENES = Path(args[i + 1])
        if not SCENES.is_absolute():
            SCENES = ROOT / SCENES
        del args[i:i + 2]
    manifest = json.loads((ROOT / "web/assets/manifest.json").read_text())
    ids = {m["id"] for m in manifest["maps"]}
    wanted = {s if s.startswith("s") else f"s{s}" for s in args}
    stages = sorted(wanted or ids)
    wrote = []
    for stage in stages:
        scene_path = SCENES / f"{stage}.json"
        if not scene_path.exists():
            continue
        block = build_stage(stage, manifest)
        scene = json.loads(scene_path.read_text())
        if block is None:
            scene.pop("trapPads", None)          # idempotent: clear stale data
            continue
        scene["trapPads"] = block
        # indent=1 like the other in-place scene writer (gen_scenes.py:1091).
        # A bare json.dumps() re-collapses the whole file,
        # so re-running this tool buries the one field it owns under a
        # thousand-line reformat.
        scene_path.write_text(json.dumps(scene, indent=1))
        wrote.append(stage)
    print(f"wrote trapPads for {len(wrote)} stage(s): {', '.join(wrote) or '-'}")


if __name__ == "__main__":
    main()
