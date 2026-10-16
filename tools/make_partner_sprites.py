"""A generated walking sheet for a new partner -> its field sprite (web/extra_partners/<charId>.png + the
record in web/extra_partners.json).

usage: make_partner_sprites.py <sheet image> <charId> [--height N] [--colors N]

The sheet: rows top to bottom down, down-left, left, up-left, up (the five directions the game draws; it
mirrors the other three), any number of frames per row, on a flat green background - the layout
tools/sprite-views.sh hands to the image generator. Rows and frames are found from the green gaps (frames
that touch are split at their thinnest column). Every frame is scaled by ONE factor so the tallest is
--height pixels (default 28; the disc's partners are ~24-28 px in a 32 px frame), centred, and stood on one
ground line.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageOps

ap = argparse.ArgumentParser()
ap.add_argument("sheet")
ap.add_argument("charId")
ap.add_argument("--height", type=int, default=28)
ap.add_argument("--colors", type=int, default=24)
ap.add_argument("--duration", default="6", help="ticks per frame (60 a second); a list like 2,1 repeats across the frames")
ap.add_argument("--clips", default="",
                help="the rows are ONE loop (e.g. one wing beat): also write field clips, each playing that loop "
                     "in the given ticks, e.g. 1=18,4=24,5=16,6=28 (idle, walk, run, stop - Patamon's beat)")
a = ap.parse_args()
ticks = [int(t) for t in a.duration.split(",")]

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DRAWN = ["down", "down-left", "left", "up-left", "up"]
DIRS = ["down", "down-left", "left", "right", "up-left", "up", "down-right", "up-right"]
MIRROR = {"right": "left", "down-right": "down-left", "up-right": "up-left"}

img = Image.open(a.sheet).convert("RGB")
px = np.asarray(img).astype(int)
r, g, b = px[..., 0], px[..., 1], px[..., 2]
green = (g > 120) & (g > r + 45) & (g > b + 45)
fg = ~green


def runs(on, min_gap, min_len):
    segs, x, n = [], 0, len(on)
    while x < n:
        if on[x]:
            s = x
            while x < n and on[x]:
                x += 1
            segs.append([s, x])
        x += 1
    out = []
    for s in segs:
        if out and s[0] - out[-1][1] < min_gap:
            out[-1][1] = s[1]
        else:
            out.append(s)
    return [s for s in out if s[1] - s[0] >= min_len]


H, W = fg.shape
rows = runs(fg.sum(1) > 2, max(4, H // 200), max(10, H // 40))
if len(rows) != len(DRAWN):
    raise SystemExit(f"found {len(rows)} rows, expected {len(DRAWN)} (down, down-left, left, up-left, up)")

cells = []  # per row: list of (box)
for y0, y1 in rows:
    band = fg[y0:y1]
    cols = runs(band.sum(0) > 1, max(3, W // 400), max(8, W // 100))
    typical = float(np.median([c1 - c0 for c0, c1 in cols]))
    row = []
    for c0, c1 in cols:
        k = max(1, round((c1 - c0) / typical))
        prof = band[:, c0:c1].sum(0)
        cuts = [c0]
        for j in range(1, k):
            c = (c1 - c0) * j // k
            lo, hi = max(0, c - int(typical * 0.3)), min(c1 - c0, c + int(typical * 0.3))
            cuts.append(c0 + lo + int(np.argmin(prof[lo:hi])))
        cuts.append(c1)
        for i in range(k):
            x0, x1 = cuts[i], cuts[i + 1]
            ys, xs = np.nonzero(fg[y0:y1, x0:x1])
            row.append((x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1))
    cells.append(row)
nframes = min(len(row) for row in cells)
print("frames per row:", [len(row) for row in cells], "-> using", nframes)

# cut out: RGBA with the green keyed away (and a little green spill pulled off the edges)
rgba = np.dstack([px.clip(0, 255), np.where(fg, 255, 0)]).astype(np.uint8)
spill = (g > r) & (g > b) & fg
rgba[spill, 1] = np.maximum(r, b)[spill].astype(np.uint8)
src = Image.fromarray(rgba, "RGBA")

tallest = max(y1 - y0 for row in cells for (_, y0, _, y1) in row[:nframes])
scale = a.height / tallest
frames = {}
for d, row in zip(DRAWN, cells):
    out = []
    for box in row[:nframes]:
        piece = src.crop(box)
        w = max(1, round(piece.width * scale))
        h = max(1, round(piece.height * scale))
        small = piece.resize((w, h), Image.LANCZOS)
        al = np.asarray(small)[..., 3]
        small.putalpha(Image.fromarray(np.where(al >= 128, 255, 0).astype(np.uint8)))
        out.append(small)
    frames[d] = out

fw = max(f.width for fs in frames.values() for f in fs) + 2
fh = max(32, max(f.height for fs in frames.values() for f in fs) + 2)
fw += fw % 2
sheet = Image.new("RGBA", (fw * nframes, fh * len(DIRS)), (0, 0, 0, 0))
for ri, d in enumerate(DIRS):
    for i, f in enumerate(frames[MIRROR.get(d, d)]):
        if d in MIRROR:
            f = ImageOps.mirror(f)
        sheet.alpha_composite(f, (i * fw + (fw - f.width) // 2, ri * fh + fh - 1 - f.height))

# one small palette across the whole sheet, like the disc's 4-bit sprites
alpha = sheet.getchannel("A")
q = sheet.convert("RGB").quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT).convert("RGB")
q.putalpha(alpha)
os.makedirs(os.path.join(ROOT, "web/extra_partners"), exist_ok=True)
rel = f"extra_partners/{a.charId}.png"
q.save(os.path.join(ROOT, "web", rel))

path = os.path.join(ROOT, "web/extra_partners.json")
doc = json.load(open(path))
rec = next((c for c in doc["characters"] if c["id"] == a.charId), None)
if rec is None:
    raise SystemExit(f"{a.charId} is not in web/extra_partners.json")
rec.update({
    "sheet": rel, "frameW": fw, "frameH": fh,
    "frameCounts": {d: nframes for d in DIRS},
    "frameDurations": {d: [ticks[i % len(ticks)] for i in range(nframes)] for d in DIRS},
    "frameBottomShift": {d: [0] * nframes for d in DIRS},
    "art": True,
})
for k in ("clipSheet", "clipFrameW", "clipFrameH", "clips"):
    rec.pop(k, None)
if a.clips:
    # The field's clip strip: the five drawn directions' frames in one row (the game mirrors the rest), and
    # per clip a pick of them spread evenly over the loop, two ticks a frame, the loop taking the given ticks.
    strip = Image.new("RGBA", (fw * nframes * len(DRAWN), fh), (0, 0, 0, 0))
    for di, d in enumerate(DRAWN):
        strip.paste(q.crop((0, DIRS.index(d) * fh, fw * nframes, (DIRS.index(d) + 1) * fh)), (di * fw * nframes, 0))
    crel = f"extra_partners/{a.charId}_clips.png"
    strip.save(os.path.join(ROOT, "web", crel))
    clips = {}
    for spec in a.clips.split(","):
        cid, total = (int(v) for v in spec.split("="))
        n = max(1, total // 2)
        durs = [total // n + (1 if i < total % n else 0) for i in range(n)]
        pick = [round(i * nframes / n) % nframes for i in range(n)]
        clips[str(cid)] = {d: {"cols": [di * nframes + p for p in pick], "durations": durs, "bottoms": [0] * n}
                           for di, d in enumerate(DRAWN)}
    rec.update({"clipSheet": crel, "clipFrameW": fw, "clipFrameH": fh, "clips": clips})
    print("clips:", {c: sum(v["down"]["durations"]) for c, v in clips.items()}, "ticks ->", f"web/{crel}")
open(path, "w").write(json.dumps(doc, indent=1) + "\n")
print(f"{a.charId}: {nframes} frames x {len(DIRS)} directions, frame {fw}x{fh} -> web/{rel}")
