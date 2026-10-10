#!/usr/bin/env python3
"""Emit the LAYER-2-ONLY split of each stage's map, so the renderer can rebuild
the ground band and put it back in front of the props/tunnel actor.

Why this exists
---------------
The field draws map-tile layer 2 at ordering-table depth 11, the ground at 7,
and a stage's point-sprite props carry their own depth: 8 or 10 for the ones at
issue here. Lower is nearer, so the console order is

    map layer 2  ->  these props  ->  the ground  ->  everything else

We ship the map as ONE flattened image, which cannot be both behind and in front
of the same prop. Measured with tools/audit_point_sprite_depth.py, that is not a
theoretical problem: of the 272,916 opaque texels those props place, 79,750 sit
over ground art (the console hides them there) and 81,400 sit over layer-2 art
(the console shows them there). Painting the props over the flattened map shows
all of them; painting them under it hides all of them. Both are wrong.

The renderer paints the flattened map, then the props, then the GROUND BAND --
the same map with the stage's LAYER-2-ONLY pixels erased -- which puts the ground
back in front of them. This tool emits those pixels, as inclusive horizontal runs
[x0,x1,y] in `web/assets/data/map_layer2_runs.json`, which is TRACKED: the
renderer rebuilds the band from the base map at load, so correctness travels with
the code instead of riding a gitignored per-stage PNG a browser can serve stale.

Layer 2 is seen only where the ground leaves a hole (`layer 2 & ~ground`): the
repair in section 7 of docs/research/field/map-tile-draw-semitransparency-2026-08-20.md
confirmed the ground is cut out under layer 2 on 46 of the 60 stages that carry
layer-2 art, and made the other 15 draw layer 2 behind the ground.

A stage whose STEP PROGRAM authors op 5 (the player actor's draw-layer word) needs
the band for a different reason: the actor draws at that bucket and must be hidden
under the GROUND but still SHOWN over layer-2 art (the tunnel opening's layer-0
cut-out). Those stages — the Protocol Ruins tunnel s375/s376/s949 and s261/s934 —
are derived from `story_steps.json`, never listed by hand. Every one of them
carries a layer-2 opening, so all five ship runs.
See docs/research/field/field-actor-draw-bucket-2026-10-07.md §7.

Run:
  .venv/bin/python3 tools/build_map_ground_over_props.py
  .venv/bin/python3 tools/build_map_ground_over_props.py --dry-run
  MAP_GROUND_PNG=1 .venv/bin/python3 tools/build_map_ground_over_props.py  # legacy _l0 PNGs
"""

import argparse
import json
import os
import sys
import tomllib
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restitch_map_stp import DDW3, MAPS, parse_entry, solidify  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
POINT_JSON = REPO / "web/assets/data/point_sprites.json"
STEPS_JSON = REPO / "web/assets/data/story_steps.json"
# Ordering-table bucket at or above which a prop draws behind the ground's 7.
UNDER_MAP_BUCKET = 8
SUFFIX = "_l0"
# Which stages ship an _l0.png, so the renderer requests it only where it
# exists. Mirrors extract_map_overlays.py's `{stageId: true}` index; without it
# the game fetches <stage>_l0.png for all 294 stages and logs a 404 for the ~267
# that have none.
OUT_INDEX = REPO / "web/assets/data/map_ground_index.json"
# The renderer no longer ships a per-stage ground-band PNG. It rebuilds the
# ground band at load from the base map plus this TRACKED split of the map's
# LAYER-2-ONLY pixels, so the bucket>=8 band is composited between layer 2 and
# the ground the way the disc does — and correctness no longer rides a
# gitignored, regenerable PNG that a browser can serve stale.
OUT_SOLID_INDEX = OUT_INDEX
OUT_RUNS = REPO / "web/assets/data/map_layer2_runs.json"


def layer_masks(stage, shape):
    """(ground, layer2) boolean arrays in the stitched map's coordinates."""
    pack = DDW3 / f"map/dw2003/z_stage/{stage}pack.toml"
    cfg = tomllib.loads(pack.read_text(encoding="utf-8"))
    cells_w = cfg["width"]
    out = [np.zeros(shape, dtype=bool), np.zeros(shape, dtype=bool)]
    for idx, entry in enumerate(cfg["entries"]):
        img_path, layers = parse_entry(entry)
        if img_path is None:
            continue
        tile, _ = solidify(Image.open(img_path).convert("RGBA"))
        alpha = np.array(tile)[:, :, 3] > 0
        ox, oy = 128 * (idx % cells_w), 128 * (idx // cells_w)
        for slot, layer_index in enumerate((0, 2)):
            if layer_index >= len(layers):
                continue
            for world, off, size in layers[layer_index]:
                sub = alpha[off[1]:off[1] + size[1], off[0]:off[0] + size[0]]
                ty, tx = oy + world[1], ox + world[0]
                h = min(sub.shape[0], shape[0] - ty)
                w = min(sub.shape[1], shape[1] - tx)
                if h <= 0 or w <= 0 or ty < 0 or tx < 0:
                    continue
                out[slot][ty:ty + h, tx:tx + w] |= sub[:h, :w]
    return out


def frames(entry, record):
    """Every sprite layer any frame of this record can draw."""
    ids = ([str(i) for i in range(record["min"], record["max"] + 1)]
           if record.get("mode") == 1 and record.get("max") else
           [str(record["spriteId"])])
    out = []
    for key, layers in entry["sprites"].items():
        base = key.split("@", 1)[0]
        if base in ids or base == str(record["spriteId"]):
            out.extend(layers)
    return out


def prop_footprint(stage, entry, shape):
    """Every texel the stage's under-map props paint, in map coordinates."""
    sheet_path = REPO / f"web/assets/effects/{stage}.png"
    if not sheet_path.exists():
        return None
    alpha = np.array(Image.open(sheet_path).convert("RGBA"))[:, :, 3] > 0
    mask = np.zeros(shape, dtype=bool)
    for r in entry.get("records", []):
        if not r.get("active") or r["layer"] < UNDER_MAP_BUCKET:
            continue
        # Every frame the record can show, not just its first: a mode-1 record
        # loops sprite ids min..max and modes 2/3 cycle palette variants, and a
        # later frame with a wider silhouette would otherwise poke out from
        # under the cover. A generous footprint is safe -- the cover only ever
        # repaints pixels it copied from the map in the first place.
        for l in frames(entry, r):
            sub = alpha[l["y"]:l["y"] + l["h"], l["x"]:l["x"] + l["w"]]
            ty, tx = r["y"] + l["dy"], r["x"] + l["dx"]
            sy = sx = 0
            if ty < 0:
                sy, ty = -ty, 0
            if tx < 0:
                sx, tx = -tx, 0
            h = min(sub.shape[0] - sy, shape[0] - ty)
            w = min(sub.shape[1] - sx, shape[1] - tx)
            if h <= 0 or w <= 0:
                continue
            mask[ty:ty + h, tx:tx + w] |= sub[sy:sy + h, sx:sx + w]
    return mask


def stages_authoring_op5():
    """Stages whose step program writes the player actor's draw-layer word (op 5).

    The field actor (and, through the follower copy, the whole party) draws at
    the bucket op 5 names — 8 = behind the ground for the Protocol Ruins tunnel.
    The disc puts a bucket-8 actor ABOVE map layer 2 (11) and BELOW the ground
    (7), so it is hidden under opaque ground and still SHOWN through the
    layer-2 art at a tunnel opening (the layer-0 cut-out). The flattened base map
    cannot express that split, so these stages need a ground-band cover exactly
    like an under-map prop does (docs/research/field/field-actor-draw-bucket-2026-10-07.md §7).
    """
    data = json.loads(STEPS_JSON.read_text())
    out = set()
    for stage, entry in data.get("stages", {}).items():
        if any(r.get("op") == 5 for r in entry.get("steps", [])):
            out.add(f"s{stage}")
    return out


def stages_needing_cover():
    """Stages with a prop that draws behind the ground, OR an op-5 leader."""
    data = json.loads(POINT_JSON.read_text())
    out = set()
    for stage, entry in sorted(data.items()):
        if not any(r.get("active") and r["layer"] >= UNDER_MAP_BUCKET
                   for r in entry.get("records", [])):
            continue
        if not (DDW3 / f"map/dw2003/z_stage/{stage}pack.toml").exists():
            continue          # s9xx capture stages have no map-tile pack at all
        if (MAPS / f"{stage}.png").exists():
            out.add(stage)
    for stage in stages_authoring_op5():
        if not (DDW3 / f"map/dw2003/z_stage/{stage}pack.toml").exists():
            continue
        if (MAPS / f"{stage}.png").exists():
            out.add(stage)
    return sorted(out)


def build(stage, dry_run):
    src = MAPS / f"{stage}.png"
    out_path = MAPS / f"{stage}{SUFFIX}.png"
    im = Image.open(src).convert("RGBA")
    arr = np.array(im)
    shape = arr.shape[:2]
    ground, layer2 = layer_masks(stage, shape)
    opaque = arr[:, :, 3] > 0
    # An op-5 stage covers its WHOLE ground band: the actor can stand anywhere.
    # A prop stage only needs the pixels a prop actually reaches (small).
    if stage in stages_authoring_op5():
        keep = opaque & ground
        kept = int(keep.sum())
        hole = 0
    else:
        props = prop_footprint(stage, json.loads(POINT_JSON.read_text())[stage], shape)
        if props is None:
            return stage, 0, 0
        # Layer-2-only pixels are the ones the props must stay in front of, and only
        # pixels a prop actually reaches need covering at all.
        keep = opaque & ~(layer2 & ~ground) & props
        kept = int(keep.sum())
        hole = int((props & opaque).sum()) - kept
    if not kept:
        return stage, 0, 0
    # Zero the colour outside the kept pixels too: an RGBA PNG stores colour
    # even where alpha is 0, and leaving the map's colours there made a mostly
    # transparent image compress to the size of the whole map.
    arr[~keep] = 0
    if not dry_run:
        Image.fromarray(arr).save(out_path)
    return stage, kept, hole


def layer2_only_runs(stage, shape):
    """Horizontal runs [x0, x1, y] (inclusive) of the map's LAYER-2-ONLY pixels.

    Layer 2 draws at OT[11], the ground at OT[7], so layer 2 is seen only where
    the ground leaves a hole (map-tile-draw-semitransparency §6). A thing that
    draws between them (a bucket-8/10 prop, a bucket-8 field actor) is hidden
    where the ground covers it and shown over these pixels. The renderer rebuilds
    the ground band by erasing exactly these pixels from the base map, so the
    split must be EXACT and must travel with the code: hence a tracked JSON of
    runs, not a regenerable PNG.
    """
    ground, layer2 = layer_masks(stage, shape)
    only2 = layer2 & ~ground
    out = []
    for y in range(shape[0]):
        row = only2[y]
        if not row.any():
            continue
        x = 0
        n = shape[1]
        while x < n:
            if row[x]:
                x0 = x
                while x < n and row[x]:
                    x += 1
                out.append([x0, x - 1, y])
            else:
                x += 1
    return out


def needs_cover_stages():
    """The stage list the index carries: every stage that ships a layer split."""
    index = json.loads(OUT_SOLID_INDEX.read_text()) if OUT_SOLID_INDEX.exists() else {}
    return sorted(index)


def main_runs(argv=None):
    """Emit web/assets/data/map_layer2_runs.json (the LAYER-2-ONLY split) for
    every stage that draws an under-map prop or authors op 5, and keep
    map_ground_index.json as the list of those stages."""
    ap = argparse.ArgumentParser()
    ap.add_argument("stages", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    stages = args.stages or stages_needing_cover()
    out = {}
    for stage in stages:
        src = MAPS / f"{stage}.png"
        if not src.exists():
            continue
        shape = Image.open(src).size[::-1]
        runs = layer2_only_runs(stage, shape)
        if runs:
            out[stage] = runs
        print(f"{stage}: {len(runs)} layer-2-only run(s)")
    data = {
        "_comment": ("map_layer2_runs.json — the LAYER-2-ONLY pixels of each stage, "
                     "as inclusive horizontal runs [x0,x1,y]. Layer 2 draws at "
                     "OT[11] and the ground at OT[7] (fieldstg.s L4230-4236, slot "
                     "0x138); the renderer erases these pixels from the base map to "
                     "rebuild the ground band, so a bucket>=8 prop or actor is "
                     "composited between layer 2 and the ground. Derived from the "
                     "stage map packs by tools/build_map_ground_over_props.py."),
        "stages": dict(sorted(out.items())),
    }
    if args.dry_run:
        print(f"(dry run) {len(out)} stages")
        return 0
    OUT_RUNS.parent.mkdir(parents=True, exist_ok=True)
    OUT_RUNS.write_text(json.dumps(data))
    OUT_SOLID_INDEX.write_text(json.dumps({s: True for s in out}))
    print(f"{len(out)} stages; index: {OUT_SOLID_INDEX.name}; runs: {OUT_RUNS.name}")
    return 0


def main_png(argv=None):
    """Legacy path: write the per-stage `_l0` ground-band PNGs (MAP_GROUND_PNG=1)."""
    ap = argparse.ArgumentParser()
    ap.add_argument("stages", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    stages = args.stages or stages_needing_cover()
    total_kept = total_hole = 0
    index = json.loads(OUT_INDEX.read_text()) if OUT_INDEX.exists() else {}
    for stage in stages:
        stage, kept, hole = build(stage, args.dry_run)
        if args.dry_run:
            pass
        elif (MAPS / f"{stage}{SUFFIX}.png").exists():
            index[stage] = True
        else:
            index.pop(stage, None)
        total_kept += kept
        total_hole += hole
        print(f"{stage}: ground covers {kept} prop px, "
              f"layer-2-only leaves {hole} prop px visible")
    if not args.dry_run:
        OUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
        OUT_INDEX.write_text(json.dumps(dict(sorted(index.items()))))
    print(f"{len(stages)} stage(s), {total_kept} covered prop px, "
          f"{total_hole} visible prop px")
    return 0


def main(argv=None):
    if os.environ.get("MAP_GROUND_PNG") == "1":
        return main_png(argv)
    return main_runs(argv)



if __name__ == "__main__":
    sys.exit(main())
