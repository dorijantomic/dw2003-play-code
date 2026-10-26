#!/usr/bin/env python3
"""Assemble a GIANT's walk sheet for the quest scenes (web/extra_fx/<name>.png + .json) from battle-model views.

    tools/giant-fx.sh <model> <name> [frames]        # renders with tools/render_sprite_views.mjs, then this
    python3 tools/make_giant_fx.py <dir> <name> [--height N] [--frames N]

<dir> holds the five direction rows tools/render_sprite_views.mjs writes on flat green: 1_down, 2_down-left,
3_left, 4_up-left, 5_up, each with <n>_<direction>_<k>.png. This cuts them out, scales every cell by one factor so
the giant stands --height pixels tall (default 152: a little over three of the player's 48), mirrors the three
directions the game itself mirrors, and writes ONE strip in the fx-sheet format web/quest-fx.js reads:

    { "name", "frame": [w, h], "anchor": [0.5, 1.0],
      "clips": { "walk-left": { "frames": [..], "hold": 6, "loop": true }, ... }, "default": "walk-left" }

The art is made from the game's own battle models, so it is DISC-DERIVED: never commit the two files (see
.gitignore); tools/giant-fx.sh writes them for a local checkout only, and a quest scene that names a sheet which is
not there simply skips that step (web/quest-fx.js).
"""
import argparse
import glob
import json
import os
import re

import numpy as np
from PIL import Image, ImageOps

DRAWN = ["down", "down-left", "left", "up-left", "up"]
# The eight field directions, in the game's own order (web/quest-scenes.js DIRS); a mirrored entry is drawn from its
# counterpart and flipped, exactly as the field sprite set does.
DIRS = ["down", "down-left", "left", "right", "up-left", "up", "down-right", "up-right"]
MIRROR = {"right": "left", "down-right": "down-left", "up-right": "up-left"}

ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("name")
ap.add_argument("--height", type=int, default=152)
ap.add_argument("--frames", type=int, default=0, help="frames per direction (default: as many as the render has)")
ap.add_argument("--hold", type=int, default=6, help="field blanks per frame (6 = 10 frames a second)")
ap.add_argument("--key", choices=["green", "magenta"], default="green")
ap.add_argument("--out", default="", help="output dir (default web/extra_fx)")
a = ap.parse_args()

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = a.out or os.path.join(ROOT, "web", "extra_fx")


def keyed(path):
    """The picture's foreground mask and RGBA pixels, with the flat background keyed away."""
    im = Image.open(path).convert("RGB")
    px = np.asarray(im).astype(int)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    if a.key == "magenta":
        bg = (r > 200) & (b > 200) & (g < 80)
    else:
        bg = (g > 120) & (g > r + 45) & (g > b + 45)
    fg = ~bg
    rgba = np.dstack([px.clip(0, 255), np.where(fg, 255, 0)]).astype(np.uint8)
    if a.key != "magenta":                              # pull the green spill off the edges
        spill = (g > r) & (g > b) & fg
        rgba[spill, 1] = np.maximum(r, b)[spill].astype(np.uint8)
    return Image.fromarray(rgba, "RGBA"), fg


rows = {}
for n, d in enumerate(DRAWN, start=1):
    files = sorted(glob.glob(os.path.join(a.dir, f"{n}_{d}_*.png")),
                   key=lambda f: int(re.search(r"_(\d+)\.png$", f).group(1)))
    if not files:
        raise SystemExit(f"no {n}_{d}_*.png in {a.dir}")
    rows[d] = files
count = a.frames or min(len(v) for v in rows.values())
count = max(1, min(count, min(len(v) for v in rows.values())))

# One box for every cell of a direction: the frames move inside a fixed camera, so the body must keep its place.
cells = {}
tallest = 0
for d, files in rows.items():
    pics = []
    union = None
    for f in files[:count]:
        im, fgm = keyed(f)
        union = fgm if union is None else (union | fgm)
        pics.append(im)
    ys, xs = np.nonzero(union)
    if not len(xs):
        raise SystemExit(f"{d}: nothing on the green (blank render)")
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    tallest = max(tallest, box[3] - box[1])
    cells[d] = (pics, box)
scale = a.height / tallest
frame_w = max(int(round((b[2] - b[0]) * scale)) for _, b in cells.values()) + 2
frame_h = max(int(round((b[3] - b[1]) * scale)) for _, b in cells.values()) + 2

sheet = Image.new("RGBA", (frame_w * count * len(DIRS), frame_h), (0, 0, 0, 0))
clips = {}
for ri, d in enumerate(DIRS):
    src = MIRROR.get(d, d)
    pics, box = cells[src]
    frames = []
    for i, im in enumerate(pics):
        piece = im.crop(box)
        w = max(1, int(round(piece.width * scale)))
        h = max(1, int(round(piece.height * scale)))
        small = piece.resize((w, h), Image.LANCZOS)
        al = np.asarray(small)[..., 3]
        small.putalpha(Image.fromarray(np.where(al >= 128, 255, 0).astype(np.uint8)))
        if d in MIRROR:
            small = ImageOps.mirror(small)
        cell = ri * count + i
        # feet on the cell's bottom line, centred
        sheet.alpha_composite(small, (cell * frame_w + (frame_w - small.width) // 2, frame_h - small.height))
        frames.append(cell)
    clips[f"walk-{d}"] = {"frames": frames, "hold": a.hold, "loop": True}

os.makedirs(OUT, exist_ok=True)
png = os.path.join(OUT, f"{a.name}.png")
sheet.save(png)
meta = {"name": a.name, "frame": [frame_w, frame_h], "anchor": [0.5, 1.0], "clips": clips, "default": "walk-left"}
with open(os.path.join(OUT, f"{a.name}.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)
    f.write("\n")
print(f"wrote {png} ({sheet.width}x{sheet.height}, {count} frames x {len(DIRS)} directions, cell {frame_w}x{frame_h})")
print(f"      {os.path.join(OUT, a.name + '.json')} ({', '.join(clips)})")
