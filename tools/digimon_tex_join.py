#!/usr/bin/env python3
"""Put upscaled Digimon texture pieces (tools/digimon_tex_pieces.py) back into ONE atlas.

  python3 tools/digimon_tex_join.py <pieces_dir> [--size 1024] [--out file.png] [--base page.png]
                                    [--use-patches] [--no-edge-fix]

Pieces are found by name (<name>.png/.jpg/.jpeg/.webp), any returned size: the Gemini scale (returned / sent width) is
detected and printed, each piece is resized to the atlas scale (exact box average when it is a whole shrink, else Lanczos).
Atlas side = --size (default 1024, the HD page the game loads; 2048/4096 allowed, whole multiples of 1024). Only texels inside
the island mask are pasted (margin is context only, no bleed). Missing piece = the current HD page (resized to the size).
Eye/mouth patch rectangles stay as that page unless --use-patches. Then like pad_model_textures.py: used texels at an unused
gap are repaired from 3 px inside (only inside pasted islands; --no-edge-fix skips), unused texels within 6 px of a used one
take the nearest used colour (px counts scale with size/1024). A piece without alpha gets the page's alpha.
Default out: <pieces_dir>/joined/<model>.png. UVs are read exactly like the game
(battle3d.js: face[3+2c], face[4+2c] / 256) via pad_model_textures.used_mask.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

W = os.path.expanduser("~/dw2003-play-integration/web")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pad_model_textures as pad
EXT = (".png", ".jpg", ".jpeg", ".webp")


def find(d, name):
    for e in EXT:
        if os.path.exists(f"{d}/{name}{e}"):
            return f"{d}/{name}{e}"


def mask_of(p, crop):
    m = np.zeros((crop[3] - crop[1], crop[2] - crop[0]), bool)
    for y, a, b in p["mask_runs"]:
        m[y - crop[1], a - crop[0]:b - crop[0]] = True
    return m


def join(d, size=None, base_path=None, use_patches=False, edge_fix=True):
    """size = atlas side in px (default: the HD page size, 1024). Returns model, size, detected Gemini scale, atlas, ..."""
    meta = json.load(open(f"{d}/pieces.json"))
    model, hd = meta["model"], meta["page_size"][0]
    size = size or hd
    if size < hd or size % hd:
        sys.exit(f"--size must be {hd} or a whole multiple of it")
    T = size // hd                                # atlas px per HD page px
    found = {}
    for p in meta["pieces"]:
        f = find(d, p["name"])
        if f and (p["kind"] == "island" or use_patches):
            found[p["name"]] = Image.open(f)
    ratios = [found[p["name"]].size[0] / (p["crop"][2] - p["crop"][0]) for p in meta["pieces"] if p["name"] in found]
    gscale = float(np.median(ratios)) if ratios else None
    base = Image.open(base_path or f"{W}/assets-hd/battle/textures/{model}.png").convert("RGBA")
    if base.size != (size, size):
        base = base.resize((size, size), Image.LANCZOS)
    out = np.asarray(base).copy()
    pasted = np.zeros((size, size), bool)
    for p in meta["pieces"]:
        im = found.get(p["name"])
        if im is None:
            continue
        c = p["crop"]
        cw, ch = (c[2] - c[0]) * T, (c[3] - c[1]) * T
        has_a = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
        im = im.convert("RGBA")
        if im.size != (cw, ch):                   # exact integer shrink: box average (exact on x4 nearest copies)
            k = im.size[0] / cw
            flt = Image.BOX if k > 1 and k == int(k) and im.size[1] == ch * int(k) else Image.LANCZOS
            rgb, al = im.convert("RGB").resize((cw, ch), flt), im.getchannel("A").resize((cw, ch), flt)   # no premultiply
            rgb.putalpha(al)
            im = rgb
        a = np.asarray(im).copy()
        if not has_a:                             # no alpha returned: take the current page's alpha
            a[..., 3] = np.asarray(base.crop((c[0] * T, c[1] * T, c[2] * T, c[3] * T)))[..., 3]
        if p["kind"] == "island":
            m = mask_of(p, c)
        else:
            m = np.zeros((c[3] - c[1], c[2] - c[0]), bool)
            b = p["box"]
            m[b[1] - c[1]:b[3] - c[1], b[0] - c[0]:b[2] - c[0]] = True
        mS = np.kron(m, np.ones((T, T), bool))
        view = out[c[1] * T:c[3] * T, c[0] * T:c[2] * T]
        view[mS] = a[mS]
        pasted[c[1] * T:c[3] * T, c[0] * T:c[2] * T] |= mS
    k = max(1, size // 1024)
    prot = pad.patch_mask(model, size)
    used = pad.used_mask(model, size) | prot
    if edge_fix:
        core = ndimage.binary_erosion(used, iterations=pad.EDGE * k)
        dc, (cy, cx) = ndimage.distance_transform_edt(~core, return_indices=True)
        band = used & ~core & ~prot & (dc <= (pad.EDGE + 1) * k) & pasted
        out[band] = out[cy[band], cx[band]]
    dist, (iy, ix) = ndimage.distance_transform_edt(~used, return_indices=True)
    fill = (~used) & (dist <= pad.PAD * k)
    out[fill] = out[iy[fill], ix[fill]]
    return model, size, gscale, out, pasted, len(found), len(meta["pieces"])


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    opt = lambda k, dflt=None: a[a.index(k) + 1] if k in a else dflt
    d = a[0].rstrip("/")
    model, size, gs, out, pasted, nf, nt = join(d, int(opt("--size", 0)) or None, opt("--base"), "--use-patches" in a, "--no-edge-fix" not in a)
    dst = opt("--out", f"{d}/joined/{model}.png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    Image.fromarray(out, "RGBA").save(dst)
    print(f"{model}: {nf}/{nt} pieces found, Gemini scale seen {gs and round(gs, 2)}x, atlas {size}px, pasted px {int(pasted.sum())} -> {dst}")
