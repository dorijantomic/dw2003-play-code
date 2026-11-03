#!/usr/bin/env python3
"""HD Remaster test: repaint ONE battle-arena texture sheet with Gemini, keep every piece where it is, check by numbers.

  python3 tools/gemini_arena.py meft1001 wall_c16_r255 [--model gemini-3-pro-image] [--tries 1]

Input: the HD sheet web/assets-hd/battle/arenas/<pack>/<sheet>.png (git-ignored, 1024 x 1024).
Output (git-ignored, never committed: made from disc art): web/assets-lab/gemini-arenas/<pack>/<sheet>.png and
<sheet>.json with the numbers. Nothing in assets-hd is changed.

  used   = texels the arena's own triangles cover (the group's UVs for this page + palette, rasterised, grown 3 px)
  result = Gemini's picture inside `used`, the HD sheet outside it, the HD sheet's alpha everywhere
  checks, inside `used`, the new sheet vs the HD sheet:
    shift      the (dx, dy) in -8..8 px that best lines up their edge maps (must be 0, 0: pieces did not move)
    edgeCorr   correlation of the edge maps at 0, 0 (outlines kept)
    colourDiff mean |difference| of the 16 px blurred colours, 0..255 (overall colours kept)
The key is read from GEMINI_API_KEY or ~/.config/dw2003/gemini_key, never printed.
"""
import argparse, base64, io, json, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HD = "web/assets-hd/battle/arenas"
OUT = "web/assets-lab/gemini-arenas"
PROMPT = (
    "This image is a texture atlas from a 1990s 3D game battle arena (sky, clouds, distant mountains, rock). "
    "Repaint it as a high-detail, clean, hand-painted remaster of the SAME atlas. Strict rules: keep the exact same "
    "layout - every region, edge, horizon line and shape stays at exactly the same pixel position and size; keep the "
    "same colours and lighting; do not add, remove, move or mirror anything; no text, no borders, no new objects; "
    "areas that are flat colour stay flat colour. Output the same square image size."
)


def key():
    k = os.environ.get("GEMINI_API_KEY") or open(os.path.expanduser("~/.config/dw2003/gemini_key")).read().strip()
    return k


def used_mask(pack, sheet, size):
    page, rest = sheet.split("_c", 1)
    col, row = (int(x) for x in rest.split("_r"))
    geo = json.load(open(f"web/assets/battle/arenas/{pack}/geometry.json"))
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    W, H = size
    for g in geo["groups"]:
        if (g.get("page") or "wall") != page or list((g.get("clut") or [0, 255])[:2]) != [col, row]:
            continue
        uv = g["uv"]
        for t in range(len(uv) // 6):
            d.polygon([(uv[t * 6 + k * 2] * W, uv[t * 6 + k * 2 + 1] * H) for k in range(3)], fill=255)
    return m.filter(ImageFilter.MaxFilter(7))   # grown 3 px: bilinear sampling reaches past the triangle edge


def call_gemini(img, model):
    buf = io.BytesIO(); img.convert("RGB").save(buf, "PNG")
    body = {
        "contents": [{"parts": [{"text": PROMPT}, {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(buf.getvalue()).decode()}}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1"}},
    }
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key()})
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.load(r)
    for part in res.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        data = (part.get("inlineData") or part.get("inline_data") or {}).get("data")
        if data:
            return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")
    raise SystemExit("no image in the reply: " + json.dumps(res)[:400])


def edges(a):
    g = a.mean(axis=2)
    gx = np.zeros_like(g); gy = np.zeros_like(g)
    gx[:, 1:-1] = g[:, 2:] - g[:, :-2]; gy[1:-1, :] = g[2:, :] - g[:-2, :]
    return np.hypot(gx, gy)


def corr(a, b, m):
    a = a[m]; b = b[m]
    a = a - a.mean(); b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def check(orig, new, mask):
    o = np.asarray(orig.convert("RGB"), dtype=np.float32); n = np.asarray(new, dtype=np.float32)
    m = np.asarray(mask) > 0
    eo, en = edges(o), edges(n)
    best = (-2, 0, 0)
    inner = m.copy(); inner[:8, :] = inner[-8:, :] = False; inner[:, :8] = inner[:, -8:] = False
    for dy in range(-8, 9, 2):
        for dx in range(-8, 9, 2):
            c = corr(eo, np.roll(np.roll(en, dy, 0), dx, 1), inner)
            if c > best[0]: best = (c, dx, dy)
    bo = np.asarray(orig.convert("RGB").filter(ImageFilter.BoxBlur(8)), dtype=np.float32)
    bn = np.asarray(new.filter(ImageFilter.BoxBlur(8)), dtype=np.float32)
    return {"shift": [best[1], best[2]], "edgeCorrAtBestShift": round(best[0], 3), "edgeCorr": round(corr(eo, en, inner), 3),
            "colourDiff": round(float(np.abs(bo - bn)[m].mean()), 1), "usedShare": round(float(m.mean()), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack"); ap.add_argument("sheet")
    ap.add_argument("--model", default="gemini-3-pro-image")
    a = ap.parse_args()
    src = f"{HD}/{a.pack}/{a.sheet}.png"
    orig = Image.open(src).convert("RGBA")
    mask = used_mask(a.pack, a.sheet, orig.size)
    raw = call_gemini(orig, a.model)
    os.makedirs(f"{OUT}/{a.pack}", exist_ok=True)
    raw.save(f"{OUT}/{a.pack}/{a.sheet}.raw.png")
    new = raw.resize(orig.size, Image.LANCZOS) if raw.size != orig.size else raw
    res = {"model": a.model, "rawSize": list(raw.size), **check(orig, new, mask)}
    out = orig.copy()
    rgb = Image.composite(new.convert("RGBA"), orig, mask)
    out = Image.merge("RGBA", (*rgb.split()[:3], orig.split()[3]))
    out.save(f"{OUT}/{a.pack}/{a.sheet}.png")
    json.dump(res, open(f"{OUT}/{a.pack}/{a.sheet}.json", "w"), indent=1)
    print(json.dumps(res))


if __name__ == "__main__":
    main()
