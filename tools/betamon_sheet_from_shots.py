"""Cut the five Betamon walk screenshots (five frames each on white) into a make_partner_sprites sheet.

usage: betamon_sheet_from_shots.py <out sheet.png> [<dir holding betamon_*.png>]

rows: down, down-left, left, up-left (mirrored up_right), up; 20 columns: idle 0-8 (frame 0 breathing),
walk 9-13, stop 14-19; magenta background (Betamon is green). Then:
  make_partner_sprites.py <sheet> x194beta --key magenta --height 30 --colors 32 --ground --sink 2 \
    --clips "1=0-8@6;4=9-13@6/4/4/6/4;5=9-13@4/2/2/4/4;6=14-19@4/4/4/4/6/6"
"""
import sys
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

OUT = sys.argv[1]
SRC = (sys.argv[2] if len(sys.argv) > 2 else "/mnt/c/Users/dorij/Documents/ShareX/Screenshots/2026-10").rstrip("/") + "/"
ROWS = [("down", "betamon_down", False), ("down-left", "betamon_down_left", False), ("left", "betamon_left", False),
        ("up-left", "betamon_up_right", True), ("up", "betamon_up", False)]
IDLE = [0] * 9
WALK = [0, 1, 2, 3, 4]
STOP = [3, 4, 0, 0, 0, 0]

def frames(path, mirror):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    white = (a.min(axis=2) > 200) & ((a.max(axis=2) - a.min(axis=2)) < 40)
    fg = ~white
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    keep = [i + 1 for i in np.argsort(sizes)[::-1][:5]]
    boxes = sorted((ndimage.find_objects(lab)[k - 1], k) for k in keep)
    boxes.sort(key=lambda t: t[0][1].start)
    out = []
    for (sy, sx), k in boxes:
        m = (lab[sy, sx] == k) & fg[sy, sx]
        crop = np.asarray(im)[sy, sx].copy()
        rgba = np.dstack([crop, (m * 255).astype(np.uint8)])
        f = Image.fromarray(rgba, "RGBA")
        out.append(ImageOps.mirror(f) if mirror else f)
    print(path.split("/")[-1], [f.size for f in out])
    return out

rows = [(d, frames(SRC + f + ".png", m)) for d, f, m in ROWS]
cw = max(f.size[0] for _, fr in rows for f in fr) + 16
ch = max(f.size[1] for _, fr in rows for f in fr) + 16
order = IDLE + WALK + STOP
# idle: frame 0 breathing - a slow squash (shorter, a touch wider) and back, feet kept on the ground
SQUASH = [0, 1, 2, 3, 4, 3, 2, 1, 0]
def breathe(f, k):
    h = round(f.size[1] * (1 - 0.018 * k))
    w = round(f.size[0] * (1 + 0.008 * k))
    g = f.resize((w, h), Image.NEAREST)
    return g
sheet = Image.new("RGB", (cw * len(order), ch * len(rows)), (255, 0, 255))
for r, (d, fr) in enumerate(rows):
    for c, k in enumerate(order):
        f = breathe(fr[0], SQUASH[c]) if c < len(IDLE) else fr[k]
        sheet.paste(f, (c * cw + (cw - f.size[0]) // 2, r * ch + ch - 8 - f.size[1]), f)
sheet.save(OUT)
print("sheet", sheet.size)
