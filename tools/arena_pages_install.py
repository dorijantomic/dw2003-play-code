#!/usr/bin/env python3
"""Put a Gemini-remastered texture PAGE (tools/arena_pages.py) back into every HD sheet of that page.

  python3 tools/arena_pages_install.py <meftXXXX> <page> <remaster.png|jpg> <pages.json> <backup_dir>

Per used pixel the remaster replaces the BASE palette's sheet; every other palette's sheet gets the remaster times the
measured colour ratio (that sheet / the base sheet, both the current HD sheets, blurred 9 px so the ratio follows the
lighting, not the detail). Pixels no triangle samples keep the old HD sheet. Old sheets are copied to backup_dir first.
"""
import json, sys, os, shutil
import numpy as np
from PIL import Image, ImageFilter

arena, page, rem, pj, bak = sys.argv[1:6]
W = os.path.expanduser("~/dw2003-play-integration/web")
meta = json.load(open(pj))[page]
sheets, base = meta["sheets"], np.array(meta["base"])
big = np.kron(base, np.ones((4, 4), int)); used = big >= 0
R = np.asarray(Image.open(rem).convert("RGB").resize((1024, 1024), Image.LANCZOS)).astype(float)
os.makedirs(bak, exist_ok=True)
path = lambda k: f"{W}/assets-hd/battle/arenas/{arena}/{k}.png"
old = {}
for k in sheets:
    if not os.path.exists(f"{bak}/{k}.png"): shutil.copy(path(k), f"{bak}/{k}.png")
    old[k] = Image.open(f"{bak}/{k}.png").convert("RGBA").resize((1024, 1024))
blur = lambda im: np.asarray(im.convert("RGB").filter(ImageFilter.BoxBlur(4))).astype(float)
ob = {k: blur(old[k]) for k in sheets}
baseBlur = np.zeros((1024, 1024, 3))
for i, k in enumerate(sheets): baseBlur[big == i] = ob[k][big == i]
for k in sheets:
    ratio = np.clip((ob[k] + 2) / (baseBlur + 2), 0, 4)
    o = np.asarray(old[k]).astype(float).copy()
    o[..., :3][used] = np.clip(R[used] * ratio[used], 0, 255)
    Image.fromarray(o.round().astype(np.uint8), "RGBA").save(path(k))
print(page, len(sheets), "sheets written; used px", int(used.sum()), "; backup", bak)
