#!/usr/bin/env python3
"""Measure whether map-tile layer 2 art ever sits over layer 0 art.

Background: the field draws the three map-tile layers at ordering-table depths
7 (layer 0, ground), 3 (layer 1, foreground over sprites) and 11 (layer 2) --
see docs/research/field/map-layer-draw-depths (frontier WORLD-Q008). Depth 11
is BEHIND layer 0's depth 7, so a layer-2 pixel that sits over opaque layer-0
art would be invisible on the console. This tool measures that overlap from the
extracted map-tile configs and their tile images.

For each map cell it rasterises the opaque (alpha > 0) pixels of every layer-0
and layer-2 object into the cell's own 0..width/height coordinate space, using
each object's world_offset/img_offset/size, and intersects the two sets.

Run: .venv/bin/python3 tools/audit_map_layer_overlap.py [stage ...]
     (no arguments = every stage that has a map pack)
"""

import sys
import tomllib
from pathlib import Path

from PIL import Image

DDW3 = Path.home() / "ddw3"
MAP_TOML_DIR = DDW3 / "map/dw2003/z_stage"
TILE_CFG_DIR = DDW3 / "map-tile/dw2003/z_stage"
TILE_PNG_DIR = DDW3 / "tim/dw2003/z_stage"


def opaque_pixels(im, objs):
    """Cell-space coordinates of every opaque texel these objects place."""
    out = set()
    for o in objs:
        wx, wy = o["world_offset"]
        ix, iy = o["img_offset"]
        sw, sh = o["size"]
        for y in range(sh):
            py = iy + y
            if py >= im.height:
                continue
            for x in range(sw):
                px = ix + x
                if px >= im.width:
                    continue
                if im.getpixel((px, py))[3] == 0:
                    continue
                out.add((wx + x, wy + y))
    return out


def stage_overlap(stage):
    """Returns (layer2_px, overlapping_px, per-cell rows) for one stage."""
    map_toml = MAP_TOML_DIR / f"{stage}pack.toml"
    if not map_toml.exists():
        return None
    cfg = tomllib.loads(map_toml.read_text())
    width = cfg["width"]
    rows = []
    l2_total = 0
    hit_total = 0
    for idx, _entry in enumerate(cfg["entries"]):
        tile_toml = TILE_CFG_DIR / f"{stage}pack" / f"{idx}.toml"
        if not tile_toml.exists():
            continue
        tile_cfg = tomllib.loads(tile_toml.read_text())
        layers = tile_cfg["layers"]
        if len(layers) < 3 or not layers[2].get("objs"):
            continue
        tile_png = TILE_PNG_DIR / f"{stage}pack" / f"{idx}.png"
        if not tile_png.exists():
            print(f"  {stage} tile {idx}: layer-2 objs but png missing")
            continue
        im = Image.open(tile_png).convert("RGBA")
        m0 = opaque_pixels(im, layers[0].get("objs", []))
        m2 = opaque_pixels(im, layers[2].get("objs", []))
        hit = m0 & m2
        l2_total += len(m2)
        hit_total += len(hit)
        rows.append((idx, idx % width, idx // width, len(m0), len(m2), len(hit)))
    return l2_total, hit_total, rows


def main(argv):
    stages = argv[1:]
    if not stages:
        stages = sorted(p.name[: -len("pack.toml")]
                        for p in MAP_TOML_DIR.glob("*pack.toml"))
    verbose = len(stages) == 1
    grand_l2 = grand_hit = 0
    stages_with_overlap = []
    for stage in stages:
        res = stage_overlap(stage)
        if res is None:
            print(f"{stage}: no map pack")
            continue
        l2_total, hit_total, rows = res
        if not rows:
            continue
        if verbose:
            for idx, col, row, n0, n2, nhit in rows:
                pct = 100 * nhit / n2 if n2 else 0.0
                print(f"  cell {idx:3d} (col {col}, row {row}): "
                      f"layer0 opaque={n0:6d} layer2 opaque={n2:6d} "
                      f"layer2-over-layer0={nhit:6d} ({pct:5.1f}%)")
        pct = 100 * hit_total / l2_total if l2_total else 0.0
        print(f"{stage}: layer2 opaque px={l2_total} over layer0 art={hit_total} "
              f"({pct:.1f}%) in {len(rows)} cells")
        grand_l2 += l2_total
        grand_hit += hit_total
        if hit_total:
            stages_with_overlap.append(stage)
    if len(stages) > 1:
        pct = 100 * grand_hit / grand_l2 if grand_l2 else 0.0
        print(f"TOTAL layer2 opaque px={grand_l2} over layer0 art={grand_hit} "
              f"({pct:.2f}%)")
        print(f"stages with any overlap: {len(stages_with_overlap)}"
              + (": " + " ".join(stages_with_overlap) if stages_with_overlap else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
