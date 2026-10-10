#!/usr/bin/env python3
"""Do the props that draw between the ground and map layer 2 actually overlap them?

The field submits map-tile layer 0 (ground) at ordering-table bucket 7 and map
layer 2 at bucket 11, and each point-sprite record carries its own bucket in its
layer byte -- see docs/research/field/map-tile-draw-semitransparency-2026-08-20.md
section 8 (frontier WORLD-Q008). Lower bucket = nearer the camera, so a record at
bucket 8 or 10 draws BEHIND the ground and IN FRONT of layer 2.

The browser build paints every record at bucket 6 or above over its flattened
map, which is right for 6 and wrong for 8/10. This tool measures whether that is
visible: for each record it rasterises the opaque texels of its base sprite frame
into world coordinates and intersects them with the opaque texels of map layer 0
and of map layer 2.

Bucket 6 is measured alongside as a control -- on hardware it really does draw
over the ground, so its overlap is the amount the walker gets right for free.

Run: .venv/bin/python3 tools/audit_point_sprite_depth.py [stage ...]
     (no arguments = every stage that has any record at bucket 6, 8 or 10)
"""

import os
import json
import sys
import tomllib
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restitch_map_stp import parse_entry, solidify  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
MAP_TOML_DIR = DDW3 / "map/dw2003/z_stage"
TILE_CFG_DIR = DDW3 / "map-tile/dw2003/z_stage"
TILE_PNG_DIR = DDW3 / "tim/dw2003/z_stage"
POINT_JSON = REPO / "web/assets/data/point_sprites.json"
SHEET_DIR = REPO / "web/assets/effects"

# Buckets strictly between the ground's 7 and layer 2's 11, plus the control.
MID_BUCKETS = (8, 9, 10)
CONTROL_BUCKET = 6


def layer_mask(stage, layer_idx, shape):
    """Boolean array of the opaque texels one map-tile layer places, in world
    coordinates. Returns None when the stage has no object on that layer.

    This must place each object exactly where the stitcher does: an object's
    `world_offset` is relative to ITS OWN 128x128 map CELL, so the cell origin
    (128*col, 128*row) has to be added. Reading world_offset as an absolute
    coordinate compares the props against the wrong part of the map and answers
    a question nobody asked -- it reported a clean zero here on 2026-08-21.

    Alpha comes through restitch_map_stp.solidify, the same half-alpha repair
    the shipped map is built with, so a texel counts as opaque here exactly when
    it is opaque in web/assets/maps/<stage>.png.
    """
    map_toml = MAP_TOML_DIR / f"{stage}pack.toml"
    if not map_toml.exists():
        return None
    cfg = tomllib.loads(map_toml.read_text(encoding="utf-8"))
    cells_w = cfg["width"]
    mask = np.zeros(shape, dtype=bool)
    found = False
    for idx, entry in enumerate(cfg["entries"]):
        img_path, layers = parse_entry(entry)
        if img_path is None or layer_idx >= len(layers) or not layers[layer_idx]:
            continue
        tile, _ = solidify(Image.open(img_path).convert("RGBA"))
        alpha = np.array(tile)[:, :, 3] > 0
        ox, oy = 128 * (idx % cells_w), 128 * (idx // cells_w)
        for world, off, size in layers[layer_idx]:
            sub = alpha[off[1]:off[1] + size[1], off[0]:off[0] + size[0]]
            if sub.size == 0:
                continue
            ty, tx = oy + world[1], ox + world[0]
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
            found = True
    return mask if found else None


def sprite_mask(sheet_alpha, layers, x, y, shape):
    """Boolean array of the opaque texels one record's base frame places."""
    mask = np.zeros(shape, dtype=bool)
    for l in layers:
        sub = sheet_alpha[l["y"]:l["y"] + l["h"], l["x"]:l["x"] + l["w"]]
        if sub.size == 0:
            continue
        ty, tx = y + l["dy"], x + l["dx"]
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


def stage_rows(stage, entry):
    records = entry.get("records", [])
    sprites = entry.get("sprites", {})
    wanted = [r for r in records
              if r.get("active") and r["layer"] in MID_BUCKETS + (CONTROL_BUCKET,)]
    if not wanted:
        return []
    sheet_path = SHEET_DIR / f"{stage}.png"
    if not sheet_path.exists():
        return []
    sheet_alpha = np.array(Image.open(sheet_path).convert("RGBA"))[:, :, 3] > 0

    map_toml = MAP_TOML_DIR / f"{stage}pack.toml"
    if not map_toml.exists():
        return []
    cfg = tomllib.loads(map_toml.read_text(encoding="utf-8"))
    shape = (128 * cfg["height"], 128 * cfg["width"])  # the stitched map's size

    ground = layer_mask(stage, 0, shape)
    layer2 = layer_mask(stage, 2, shape)
    if ground is None and layer2 is None:
        return []

    rows = []
    for r in wanted:
        layers = sprites.get(str(r["spriteId"]))
        if not layers:
            continue
        m = sprite_mask(sheet_alpha, layers, r["x"], r["y"], shape)
        n = int(m.sum())
        if not n:
            continue
        rows.append({
            "stage": stage,
            "bucket": r["layer"],
            "sprite": r["spriteId"],
            "x": r["x"], "y": r["y"],
            "texels": n,
            "over_ground": int((m & ground).sum()) if ground is not None else 0,
            "over_layer2": int((m & layer2).sum()) if layer2 is not None else 0,
        })
    return rows


def main(argv):
    data = json.loads(POINT_JSON.read_text())
    stages = argv[1:] or sorted(data)
    verbose = len(stages) == 1
    all_rows = []
    for stage in stages:
        entry = data.get(stage)
        if not entry:
            continue
        rows = stage_rows(stage, entry)
        all_rows.extend(rows)
        if verbose:
            for row in rows:
                print(f"  bucket {row['bucket']:2d} sprite {row['sprite']:4d} "
                      f"at ({row['x']},{row['y']}): texels={row['texels']:6d} "
                      f"over ground={row['over_ground']:6d} "
                      f"over layer2={row['over_layer2']:6d}")

    for bucket_label, buckets in (("mid (8/9/10)", MID_BUCKETS),
                                  ("control (6)", (CONTROL_BUCKET,))):
        rows = [r for r in all_rows if r["bucket"] in buckets]
        if not rows:
            continue
        texels = sum(r["texels"] for r in rows)
        ground = sum(r["over_ground"] for r in rows)
        layer2 = sum(r["over_layer2"] for r in rows)
        hit_g = [r for r in rows if r["over_ground"]]
        hit_2 = [r for r in rows if r["over_layer2"]]
        print(f"{bucket_label}: {len(rows)} records over "
              f"{len({r['stage'] for r in rows})} stages, {texels} opaque texels")
        print(f"  over ground art: {ground} texels "
              f"({100 * ground / texels if texels else 0:.2f}%) "
              f"in {len(hit_g)} records / {len({r['stage'] for r in hit_g})} stages")
        print(f"  over layer-2 art: {layer2} texels "
              f"({100 * layer2 / texels if texels else 0:.2f}%) "
              f"in {len(hit_2)} records / {len({r['stage'] for r in hit_2})} stages")
        if bucket_label.startswith("mid") and hit_g:
            worst = sorted(hit_g, key=lambda r: -r["over_ground"])[:12]
            print("  worst records (these are the ones the walker draws too near):")
            for r in worst:
                print(f"    {r['stage']} sprite {r['sprite']} at "
                      f"({r['x']},{r['y']}): {r['over_ground']} of {r['texels']} "
                      f"texels behind ground art")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
