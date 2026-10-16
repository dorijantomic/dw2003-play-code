"""Assemble tools/render_sprite_views.mjs pictures into reference sheets for an image generator.

usage: sprite_views_sheet.py <dir>
Reads <dir>/<n>_<direction>_<frame>.png (flat green background) and writes:
  <dir>/sheet.png               every direction, one row each, top to bottom: down, down-left, left, up-left, up
  <dir>/row_<n>_<direction>.png  one direction's frames in a row
Every picture is cut with the same box (the union over all of them) so size and ground line stay consistent.
"""
import glob
import os
import re
import sys

import numpy as np
from PIL import Image

d = sys.argv[1]
files = sorted(f for f in glob.glob(os.path.join(d, "*_*_*.png")) if re.match(r"\d_[a-z-]+_\d+\.png$", os.path.basename(f)))
if not files:
    sys.exit(f"no frames in {d}")
rows = {}
for f in files:
    n, direction, k = re.match(r"(\d)_([a-z-]+)_(\d+)\.png$", os.path.basename(f)).groups()
    rows.setdefault((int(n), direction), []).append((int(k), f))

ims = {f: Image.open(f).convert("RGB") for f in files}


def fg(im):
    a = np.asarray(im).astype(int)
    return ~((a[..., 1] > 200) & (a[..., 0] < 80) & (a[..., 2] < 80))


union = np.any(np.stack([fg(im) for im in ims.values()]), 0)
ys, xs = np.nonzero(union)
pad = 12
H, W = union.shape
box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1))
cw, ch = box[2] - box[0], box[3] - box[1]

sheet = Image.new("RGB", (cw * max(len(v) for v in rows.values()), ch * len(rows)), (0, 255, 0))
for r, key in enumerate(sorted(rows)):
    frames = [f for _, f in sorted(rows[key])]
    row = Image.new("RGB", (cw * len(frames), ch), (0, 255, 0))
    for i, f in enumerate(frames):
        cell = ims[f].crop(box)
        row.paste(cell, (i * cw, 0))
        sheet.paste(cell, (i * cw, r * ch))
    row.save(os.path.join(d, f"row_{key[0]}_{key[1]}.png"))
sheet.save(os.path.join(d, "sheet.png"))
print(f"{len(rows)} directions x {max(len(v) for v in rows.values())} frames, cell {cw}x{ch} -> {d}/sheet.png")
