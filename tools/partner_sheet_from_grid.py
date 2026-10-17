"""A walk sheet drawn as rows of frames on white (one direction per row) -> a make_partner_sprites sheet.

usage: partner_sheet_from_grid.py <image> <out sheet.png> <map> [--key-out magenta|green]

<map> names the source row (0 = top) for each of the five directions the game draws, 'm' to mirror it:
  "down=5,down-left=2,left=0m,up-left=1,up=4"
Frames are found as figures (rows may touch); the first five of a row are the walk. The output has
20 columns per row: idle 0-8 (frame 0 breathing: a slow squash, feet kept down), walk 9-13, stop 14-19,
on a flat key colour (magenta by default, so green Digimon survive). Then, for example:
  make_partner_sprites.py <sheet> <charId> --key magenta --height 32 --colors 32 --ground --sink 2 \
    --clips "1=0-8@6;4=9-13@6/4/4/6/4;5=9-13@4/2/2/4/4;6=14-19@4/4/4/4/6/6"
"""
import argparse

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("image")
ap.add_argument("out")
ap.add_argument("map")
ap.add_argument("--key-out", choices=["magenta", "green"], default="magenta")
a = ap.parse_args()

DRAWN = ["down", "down-left", "left", "up-left", "up"]
SQUASH = [0, 1, 2, 3, 4, 3, 2, 1, 0]
STOP = [3, 4, 0, 0, 0, 0]
want = {}
for part in a.map.split(","):
    d, src = part.split("=")
    want[d.strip()] = (int(src.rstrip("m")), src.endswith("m"))
if set(want) != set(DRAWN):
    raise SystemExit(f"map needs exactly {DRAWN}")

im = Image.open(a.image).convert("RGB")
px = np.asarray(im).astype(int)
fg = ~((px.min(axis=2) > 200) & ((px.max(axis=2) - px.min(axis=2)) < 40))
# drop JPEG specks: keep only blobs of a real size
lab, n = ndimage.label(fg)
sizes = ndimage.sum(fg, lab, range(1, n + 1))
fg = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 40])


# Frames are found as figures, not by gaps: one row's hair can reach into the row above's feet, so rows need
# not be separated by white. Each big blob is a frame; small blobs (a detached club, a spark) join the frame
# whose box they sit nearest; frames are grouped into rows by their centre height.
lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
objs = ndimage.find_objects(lab)
area = ndimage.sum(fg, lab, range(1, n + 1))
big_cut = 0.2 * float(np.median(sorted(area)[-max(1, n // 2):]))
boxes = [[s[1].start, s[0].start, s[1].stop, s[0].stop, [i + 1]] for i, s in enumerate(objs) if area[i] >= big_cut]
for i, s in enumerate(objs):
    if area[i] >= big_cut:
        continue
    cx, cy = (s[1].start + s[1].stop) / 2, (s[0].start + s[0].stop) / 2
    near = min(boxes, key=lambda b: max(b[0] - cx, 0, cx - b[2]) + max(b[1] - cy, 0, cy - b[3]))
    if max(near[0] - cx, 0, cx - near[2]) + max(near[1] - cy, 0, cy - near[3]) < 12:
        near[0], near[1] = min(near[0], s[1].start), min(near[1], s[0].start)
        near[2], near[3] = max(near[2], s[1].stop), max(near[3], s[0].stop)
        near[4].append(i + 1)
med_h = float(np.median([b[3] - b[1] for b in boxes]))
boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
rows = []
for b in boxes:
    cy = (b[1] + b[3]) / 2
    if rows and cy - rows[-1][-1][5] < med_h * 0.5:
        rows[-1].append(b + [cy])
    else:
        rows.append([b + [cy]])
cut = []
for row in rows:
    frames = []
    for bx0, by0, bx1, by1, ids, _ in sorted(row, key=lambda b: b[0]):
        m = np.isin(lab[by0:by1, bx0:bx1], ids) & fg[by0:by1, bx0:bx1]
        rgba = np.dstack([px[by0:by1, bx0:bx1], m * 255]).astype(np.uint8)
        frames.append(Image.fromarray(rgba, "RGBA"))
    cut.append(frames)
print("frames per row:", [len(f) for f in cut])


def breathe(f, k):
    return f.resize((round(f.width * (1 + 0.008 * k)), round(f.height * (1 - 0.018 * k))), Image.NEAREST)


picked = []
for d in DRAWN:
    r, mirror = want[d]
    fr = cut[r][:5]
    while len(fr) < 5:  # a short row: walk back through what it has
        fr.append(fr[len(fr) % max(1, len(cut[r][:5]))])
    picked.append([ImageOps.mirror(f) if mirror else f for f in fr])

cw = max(f.width for fr in picked for f in fr) + 16
ch = max(f.height for fr in picked for f in fr) + 16
key = (255, 0, 255) if a.key_out == "magenta" else (0, 255, 0)
sheet = Image.new("RGB", (cw * 20, ch * len(DRAWN)), key)
for ri, fr in enumerate(picked):
    cells = [breathe(fr[0], k) for k in SQUASH] + fr + [fr[k] for k in STOP]
    for c, f in enumerate(cells):
        sheet.paste(f, (c * cw + (cw - f.width) // 2, ri * ch + ch - 8 - f.height), f)
sheet.save(a.out)
print("sheet", sheet.size)
