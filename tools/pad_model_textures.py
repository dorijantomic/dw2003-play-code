#!/usr/bin/env python3
"""Repair and pad the HD battle model textures. (1) Used pixels within EDGE of an unused gap take the colour EDGE+1 inside (the upscaler blurred the gap into them). (2) every texel NO triangle uses, within PAD px of one that is used, takes the colour
(and alpha) of the nearest used texel. HD textures are sampled LINEAR, so a texel on a triangle's UV edge mixes in its
neighbour across the edge; when that neighbour is an unused gap holding a dark or see-through colour the edge shows a
line (Renamon m373rena: forehead seam on row v=80, gap rows 317-319 of the 1024 sheet at brightness 40-61 against 176,
user 2026-10-29). Used texels are never changed.

  python3 tools/pad_model_textures.py <backup_dir> <model folder>... | --all

UVs come from assets/battle/models/<folder>/anim.json (faces = [i0,i1,i2, u0,v0, u1,v1, u2,v2], 256-texel page;
V may run past 255 and wraps, like the GL REPEAT). The old file is copied to backup_dir first (once).
"""
import json, os, shutil, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

PAD = 6
EDGE = 2
W = os.path.expanduser("~/dw2003-play-integration/web")


def used_mask(folder, size):
    s = size / 256
    im = Image.new("L", (size, size), 0)
    dr = ImageDraw.Draw(im)
    for b in json.load(open(f"{W}/assets/battle/models/{folder}/anim.json"))["bones"]:
        for f in b.get("faces") or []:
            pts = [(f[3] * s, f[4] * s), (f[5] * s, f[6] * s), (f[7] * s, f[8] * s)]
            for dy in (-size, 0, size):          # wrapped V
                for dx in (-size, 0, size):
                    dr.polygon([(x + dx, y + dy) for x, y in pts], fill=255, outline=255)
    return np.asarray(im) > 0


PLACEMENT = json.load(open(f"{W}/assets/battle/model_placement.json"))["models"]


def patch_mask(folder, size):
    """Texture-animation rectangles (eyes, mouths: model_placement.json texture_anim, copied at run time by
    battle3d.js blitTexturePatch; x in 4-texel units, y in texels, like texturePatchRect). Their source pictures are
    not on any triangle, so they must never be changed."""
    s = size / 256
    m = np.zeros((size, size), bool)
    key = str(int(folder[1:4])) if folder[1:4].isdigit() else None
    for e in (PLACEMENT.get(key) or {}).get("texture_anim") or []:
        w, h = e["size"][0] * 4, e["size"][1]
        for x, y in list(e.get("src") or []) + [e["dst"]]:
            x0, y0 = int(x * 4 * s), int(y * s)
            m[y0:y0 + int(h * s), x0:x0 + int(w * s)] = True
    return m


def pad(folder, bak):
    path = f"{W}/assets-hd/battle/textures/{folder}.png"
    if not os.path.exists(path) or not os.path.exists(f"{W}/assets/battle/models/{folder}/anim.json"):
        return None
    os.makedirs(bak, exist_ok=True)
    if not os.path.exists(f"{bak}/{folder}.png"):
        shutil.copy(path, f"{bak}/{folder}.png")
    src = np.asarray(Image.open(f"{bak}/{folder}.png").convert("RGBA"))
    if src.shape[0] != src.shape[1]:
        return None
    prot = patch_mask(folder, src.shape[0])
    used = used_mask(folder, src.shape[0]) | prot
    out = src.copy()
    # 1. The upscaler blurred the gap's colour into the first used pixels (Renamon HD row 320: 134-148 where the
    #    original texel and the rows below are 177-178). Used pixels within EDGE of a gap take the colour of the
    #    nearest pixel EDGE+1 inside, which still lies in the same original texel (4 HD px wide).
    core = ndimage.binary_erosion(used, iterations=EDGE)
    dc, (cy, cx) = ndimage.distance_transform_edt(~core, return_indices=True)
    band = used & ~core & ~prot & (dc <= EDGE + 1)
    out[band] = src[cy[band], cx[band]]
    # 2. Unused pixels within PAD of a used one take its (repaired) colour, so LINEAR sampling at a UV edge reads it.
    dist, (iy, ix) = ndimage.distance_transform_edt(~used, return_indices=True)
    fill = (~used) & (dist <= PAD)
    out[fill] = out[iy[fill], ix[fill]]
    Image.fromarray(out, "RGBA").save(path)
    return int(used.sum()), int(band.sum()), int(fill.sum())


if __name__ == "__main__":
    bak, names = sys.argv[1], sys.argv[2:]
    if names == ["--all"]:
        names = sorted(n[:-4] for n in os.listdir(f"{W}/assets-hd/battle/textures") if n.endswith(".png"))
    for n in names:
        r = pad(n, bak)
        print(n, "skipped (no HD texture or model)" if r is None else f"used px {r[0]}, edge px repaired {r[1]}, gap px filled {r[2]}")
