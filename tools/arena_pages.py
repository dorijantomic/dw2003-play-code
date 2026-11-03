#!/usr/bin/env python3
"""One picture per texture PAGE of an arena (floor, wall), for Gemini to remaster.

  python3 tools/arena_pages.py <meftXXXX> <out_dir>

An arena uses its 2 pages through many palettes (meft1007: 37 sheets, every used wall pixel in 2+ palettes). Per used
pixel the BASE palette = the one with most triangles on it; the page picture is the HD sheet of that palette there,
black where no triangle samples. Writes <out_dir>/<arena>_<page>.png (1024 px, like the HD sheets) and
<arena>_pages.json (per page: base sheet per 4x4 pixel block, the sheets used).
"""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw

arena, out = sys.argv[1], sys.argv[2]
W = os.path.expanduser("~/dw2003-play-integration/web")
g = json.load(open(f"{W}/assets/battle/arenas/{arena}/geometry.json"))
os.makedirs(out, exist_ok=True)
meta = {}
for page in ("floor", "wall"):
    sheets, cover = [], []
    for x in g["groups"]:
        if (x.get("page") or "wall") != page or not x.get("uv"): continue
        col, row = x["clut"] if x.get("clut") else (0, 255)
        key = f"{page}_c{col}_r{row}"
        m = Image.new("L", (256, 256), 0); d = ImageDraw.Draw(m)
        for t in np.array(x["uv"], float).reshape(-1, 3, 2) * 256: d.polygon([tuple(p) for p in t], fill=1)
        n = len(x["pos"]) // 9
        if key in sheets: cover[sheets.index(key)] += np.asarray(m) * n
        else: sheets.append(key); cover.append(np.asarray(m).astype(np.int64) * n)
    if not sheets: continue
    cover = np.stack(cover)                       # sheets x 256 x 256, weight = triangles of that sheet
    used = cover.max(0) > 0
    base = np.where(used, cover.argmax(0), -1)
    pic = np.zeros((1024, 1024, 3), np.uint8)
    big = np.kron(base, np.ones((4, 4), int))
    for i, k in enumerate(sheets):
        hd = np.asarray(Image.open(f"{W}/assets-hd/battle/arenas/{arena}/{k}.png").convert("RGB").resize((1024, 1024)))
        pic[big == i] = hd[big == i]
    Image.fromarray(pic).save(f"{out}/{arena}_{page}.png")
    meta[page] = {"sheets": sheets, "base": base.tolist()}
    print(page, len(sheets), "sheets, used share", round(float(used.mean()), 3))
json.dump(meta, open(f"{out}/{arena}_pages.json", "w"))
