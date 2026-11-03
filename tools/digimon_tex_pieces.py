#!/usr/bin/env python3
"""Cut a battle Digimon's texture page into PIECES for Gemini (the model version of arena_pieces.py).

  python3 tools/digimon_tex_pieces.py <model folder|--all> [out_base]      (default out_base: ~/../Downloads/gemini-digimon)

Writes out_base/<model>/ : <model>_p0_<nn>.png (island = triangles connected in UV space, boxes that overlap/touch merged,
box + MARGIN px, cut from the HD page the game loads (assets-hd/battle/textures, 1024 px = 4x the 256 UV page; islands found on the 256 grid, boxes x4), <name>_prompt.txt, patch pieces <model>_p0_k<nn>.png (eye/mouth
texture_anim rectangles, flagged keep_native), LIST.txt and pieces.json (for the tools, never for Gemini).
UVs: web/assets/battle/models/<model>/anim.json faces [i0,i1,i2,u0,v0,u1,v1,u2,v2] (texels of the 256 page, wrap).
Put the upscaled pieces back with tools/digimon_tex_join.py.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

W = os.path.expanduser("~/dw2003-play-integration/web")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pad_model_textures as pad
MARGIN = 4          # native texels; the crop margin is MARGIN * HD scale px
SCALE = 4
DEFAULT_OUT = "/mnt/c/Users/dorij/Downloads/gemini-digimon"
PROMPT = ("Upscale this game texture piece 4x, to exactly {w}x{h} px. Keep the exact layout: every shape, "
          "outline and position stays where it is, nothing cropped, moved or rotated. Same colours. Add no new details "
          "outside the shapes. Keep the background (transparent or flat colour) as it is. Return one PNG.")


def native_used(folder):
    """Native-page mask of texels any triangle touches (conservative) plus whatever the 4x raster of pad touches."""
    im = Image.new("L", (256, 256), 0)
    dr = ImageDraw.Draw(im)
    for b in json.load(open(f"{W}/assets/battle/models/{folder}/anim.json"))["bones"]:
        for f in b.get("faces") or []:
            pts = [(f[3], f[4]), (f[5], f[6]), (f[7], f[8])]
            for dy in (-256, 0, 256):
                for dx in (-256, 0, 256):
                    dr.polygon([(x + dx, y + dy) for x, y in pts], fill=255, outline=255)
    m = np.asarray(im) > 0
    hd = pad.used_mask(folder, 256 * SCALE).reshape(256, SCALE, 256, SCALE).any((1, 3))
    return m | hd


def islands(mask):
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        boxes.append([sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, {i}])
    ch = True
    while ch:                                   # merge boxes that overlap or touch
        ch = False
        for a in range(len(boxes)):
            for b in range(a + 1, len(boxes)):
                A, B = boxes[a], boxes[b]
                if A[0] <= B[2] and B[0] <= A[2] and A[1] <= B[3] and B[1] <= A[3]:
                    boxes[a] = [min(A[0], B[0]), min(A[1], B[1]), max(A[2], B[2]), max(A[3], B[3]), A[4] | B[4]]
                    del boxes[b]
                    ch = True
                    break
            if ch:
                break
    out = []
    for x0, y0, x1, y1, ids in sorted(boxes, key=lambda b: (b[1], b[0])):
        out.append(((x0, y0, x1, y1), np.isin(lab, list(ids))))
    return out


def runs(mask, box):
    x0, y0, x1, y1 = box
    r = []
    for y in range(y0, y1):
        row = mask[y, x0:x1].astype(np.int8)
        d = np.diff(np.concatenate(([0], row, [0])))
        for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            r.append([y, x0 + int(s), x0 + int(e)])
    return r


def patches(folder):
    key = str(int(folder[1:4])) if folder[1:4].isdigit() else None
    out = []
    for e in (pad.PLACEMENT.get(key) or {}).get("texture_anim") or []:
        w, h = e["size"][0] * 4, e["size"][1]
        for role, (x, y) in [("dst", e["dst"])] + [("src", s) for s in e.get("src") or []]:
            out.append((role, e["slot"], [x * 4, y, x * 4 + w, y + h]))
    return out


def cut(folder, base):
    d = f"{base}/{folder}"
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):                      # replace an old pieces folder
        if f.startswith(folder) or f in ("LIST.txt", "pieces.json"):
            os.remove(f"{d}/{f}")
    page = Image.open(f"{W}/assets-hd/battle/textures/{folder}.png").convert("RGBA")
    size = page.size[0]
    S = size // 256                               # HD pixels per UV texel
    prot = pad.patch_mask(folder, 256)
    used = native_used(folder)
    pieces, lines = [], []

    def save(name, box, kind, extra):             # box in native texels
        hb = [v * S for v in box]
        m = MARGIN * S
        c = [max(0, hb[0] - m), max(0, hb[1] - m), min(size, hb[2] + m), min(size, hb[3] + m)]
        page.crop(tuple(c)).save(f"{d}/{name}.png")
        w, h = c[2] - c[0], c[3] - c[1]
        open(f"{d}/{name}_prompt.txt", "w").write(PROMPT.format(w=w * SCALE, h=h * SCALE) + "\n")
        p = dict(name=name, kind=kind, box=hb, crop=c, expect_size=[w * SCALE, h * SCALE])
        p.update(extra)
        pieces.append(p)
        lines.append(f"{name}.png  {kind}  HD box {hb}  send {w}x{h}, expect {w * SCALE}x{h * SCALE}"
                     + ("  KEEP NATIVE unless asked" if kind == "patch" else ""))

    for n, (box, m) in enumerate(islands(used & ~prot), 1):
        hm = np.kron(m, np.ones((S, S), bool))
        save(f"{folder}_p0_{n:02d}", box, "island", dict(mask_runs=runs(hm, [v * S for v in box]), texels=int(hm.sum())))
    for n, (role, slot, box) in enumerate(patches(folder), 1):
        save(f"{folder}_p0_k{n:02d}", box, "patch", dict(role=role, slot=slot, keep_native=True))
    meta = dict(model=folder, page="p0", source="assets-hd page", page_size=[size, size], hd_scale=S, scale=SCALE,
                margin=MARGIN * S, used_texels=int(used.sum()) * S * S, pieces=pieces)
    json.dump(meta, open(f"{d}/pieces.json", "w"))
    open(f"{d}/LIST.txt", "w").write(f"{folder}: {len(pieces)} pieces (cut from the {size}px HD page). Give each PNG with its "
                                     f"_prompt.txt to Gemini; save the answer under the SAME name.\n" + "\n".join(lines) + "\n")
    return len(pieces), sum(p["kind"] == "island" for p in pieces)


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    base = a[1] if len(a) > 1 else DEFAULT_OUT
    names = sorted(n for n in os.listdir(f"{W}/assets/battle/models") if os.path.exists(f"{W}/assets/battle/textures/{n}.png")) if a[0] == "--all" else [a[0]]
    for n in names:
        t, i = cut(n, base)
        print(n, f"{t} pieces ({i} islands, {t - i} eye/mouth patches) -> {base}/{n}")
