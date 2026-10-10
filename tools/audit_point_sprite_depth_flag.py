"""Does the prop's depth flag agree with the art, on every stage?

The stitched base map carries deliberate transparent cut-outs; each is filled by
one scenery prop. Art that is physically contiguous must be drawn in the same
pass. So for every prop that fills a cut-out, look at the tile art ringing that
cut-out:

  ring is tile FOREGROUND (`_fg.png`, drawn over characters) => the prop is
  foreground; ring is base-only => the prop is background.

Then ask whether the depth flag predicts it. This is the whole population, not a
sample: every stage, every fixed-pass prop with opaque art.
"""
import json, os
import numpy as np
from PIL import Image

ROOT = "/home/dorij/ddw3-walker"
data = json.load(open(f"{ROOT}/web/assets/data/point_sprites.json"))

def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

rows, stages_seen = [], 0
for stage in sorted(data):
    mp, fp = f"{ROOT}/web/assets/maps/{stage}.png", f"{ROOT}/web/assets/maps/{stage}_fg.png"
    spp = f"{ROOT}/web/assets/effects/{stage}.png"
    if not (os.path.exists(mp) and os.path.exists(spp)):
        continue
    base = np.array(Image.open(mp).convert("RGBA"))[:, :, 3] > 0
    if os.path.exists(fp):
        fg = np.array(Image.open(fp).convert("RGBA"))[:, :, 3] > 0
        if fg.shape != base.shape:
            continue
    else:
        fg = np.zeros_like(base)
    stages_seen += 1
    sheet = Image.open(spp).convert("RGBA")
    H, W = base.shape
    hole = ~base
    d = data[stage]
    for r in d["records"]:
        if r.get("ysort") or not r.get("active") or r.get("atlas") != "stage":
            continue
        layers = d["sprites"].get(str(r["spriteId"]))
        if not layers:
            continue
        c = Image.new("RGBA", (W, H))
        for l in layers:
            if l["semi"] >= 0:
                continue
            c.alpha_composite(
                sheet.crop((l["x"], l["y"], l["x"] + l["w"], l["y"] + l["h"])),
                (r["x"] + l["dx"], r["y"] + l["dy"]))
        m = np.array(c)[:, :, 3] > 0
        fill = m & hole
        if fill.sum() < 150:
            continue
        ring = dilate(fill, 2) & ~m & ~hole
        nf, nb = int((ring & fg).sum()), int((ring & ~fg).sum())
        if nf + nb < 100:
            continue
        rows.append((nf / (nf + nb), r["layer"], stage, r["spriteId"], r["x"], r["y"]))

print(f"{stages_seen} stages scanned, {len(rows)} cut-out-filling props measured\n")

# A prop is EMBEDDED IN FOREGROUND ART when most of the tile art it abuts is
# drawn over characters. That is the only case where the art forces an answer;
# a prop standing on open ground abuts ground either way and proves nothing.
EMB = 0.35
emb = [r for r in rows if r[0] >= EMB]
print(f"props embedded in tile FOREGROUND art (ring >= {EMB}): {len(emb)}")
byl = {}
for r in emb:
    byl.setdefault(r[1], []).append(r)
for l in sorted(byl):
    print(f"   depth flag {l}: {len(byl[l])}")
print()
print("  new rule says foreground for flag < 4; old rule said foreground for flag >= 6")
new_ok = sum(1 for r in emb if r[1] < 4)
old_ok = sum(1 for r in emb if r[1] >= 6)
print(f"  agreeing with the art -> new rule {new_ok}/{len(emb)}, old rule {old_ok}/{len(emb)}")
print("\nevery embedded prop:")
for r in sorted(emb, reverse=True):
    print(f"  ring-fg={r[0]:.2f} flag={r[1]:<3} {r[2]} sprite{r[3]} @({r[4]},{r[5]})")
