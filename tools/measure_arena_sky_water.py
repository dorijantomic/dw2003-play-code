#!/usr/bin/env python3
"""Battle arenas: where is the SKY and where is WATER, from each pack's own triangles and textures (numbers only).

For every arena pack (web/assets/battle/arenas/meft10NN): every triangle is sampled at 10 points (barycentric grid),
each sample weighted by the triangle's area; the texel is read from the group's own palette texture
({page}_c{col}_r{row}.png, as battle3d.js arenaTextureFor). Render space = (x, -y, -z) of the pack coordinates.

  floor  = triangles lying flat (|normal.y| > 0.85) with all three corners near ground height (|y| < GROUND)
  ring   = everything else above the horizon (all corners y > HORIZON): the wall ring / backdrop
  water  = a floor sample whose colour is water-like (hue 170-250 deg, saturation > 0.25, value > 0.2)
  sky    = a ring sample whose colour is sky-like (hue 185-255 deg, saturation > 0.15, value > 0.35) or near white
           with a blue cast (clouds: value > 0.75, saturation < 0.2, b >= r)

Prints per pack: floor area share that is water, ring share that is sky, the mean water / sky colour, and, with
--json, writes the numbers. Run from the repo root:  python3 tools/measure_arena_sky_water.py [--json out.json]
"""
import colorsys, json, math, os, sys
from PIL import Image

ROOT = "web/assets/battle/arenas"
GROUND, HORIZON = 300, 600
BARY = [(a / 3, b / 3, 1 - a / 3 - b / 3) for a in range(4) for b in range(4) if a + b <= 3]   # 10 points


def tex_for(pack, g, cache):
    col, row = (g.get("clut") or [0, 255])[:2]
    f = os.path.join(ROOT, pack, f"{g.get('page') or 'wall'}_c{col}_r{row}.png")
    if f not in cache:
        cache[f] = Image.open(f).convert("RGBA") if os.path.exists(f) else None
    return cache[f]


def classify(rgb):
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h *= 360
    water = 170 <= h <= 250 and s > 0.25 and v > 0.2
    sky = (185 <= h <= 255 and s > 0.15 and v > 0.35) or (v > 0.75 and s < 0.2 and b >= r)
    return water, sky


def measure(pack):
    geo = json.load(open(os.path.join(ROOT, pack, "geometry.json")))
    cache = {}
    acc = {"floor": 0.0, "water": 0.0, "ring": 0.0, "sky": 0.0, "wcol": [0, 0, 0], "scol": [0, 0, 0]}
    for g in geo["groups"]:
        im = tex_for(pack, g, cache)
        if im is None:
            continue
        W, H = im.size
        px = im.load()
        pos, uv = g["pos"], g["uv"]
        for t in range(len(pos) // 9):
            P = [(pos[t * 9 + k * 3], -pos[t * 9 + k * 3 + 1], -pos[t * 9 + k * 3 + 2]) for k in range(3)]
            U = [(uv[t * 6 + k * 2], uv[t * 6 + k * 2 + 1]) for k in range(3)]
            e1 = [P[1][i] - P[0][i] for i in range(3)]
            e2 = [P[2][i] - P[0][i] for i in range(3)]
            n = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
            area = math.hypot(*n) / 2
            if area <= 0:
                continue
            ys = [p[1] for p in P]
            floor = abs(n[1]) / (2 * area) > 0.85 and max(abs(y) for y in ys) < GROUND
            ring = not floor and min(ys) > HORIZON
            if not (floor or ring):
                continue
            w = area / len(BARY)
            for a, b, c in BARY:
                u = a * U[0][0] + b * U[1][0] + c * U[2][0]
                v = a * U[0][1] + b * U[1][1] + c * U[2][1]
                rgba = px[min(W - 1, max(0, int(u * W))), min(H - 1, max(0, int(v * H)))]
                if rgba[3] < 128:
                    continue
                water, sky = classify(rgba[:3])
                if floor:
                    acc["floor"] += w
                    if water:
                        acc["water"] += w
                        acc["wcol"] = [acc["wcol"][i] + rgba[i] * w for i in range(3)]
                else:
                    acc["ring"] += w
                    if sky:
                        acc["sky"] += w
                        acc["scol"] = [acc["scol"][i] + rgba[i] * w for i in range(3)]
    out = {
        "water": acc["water"] / acc["floor"] if acc["floor"] else 0,
        "sky": acc["sky"] / acc["ring"] if acc["ring"] else 0,
        "waterRGB": [round(c / acc["water"]) for c in acc["wcol"]] if acc["water"] else None,
        "skyRGB": [round(c / acc["sky"]) for c in acc["scol"]] if acc["sky"] else None,
        "floorArea": acc["floor"], "ringArea": acc["ring"],
    }
    return out


def main():
    res = {}
    for pack in sorted(os.listdir(ROOT)):
        if not os.path.exists(os.path.join(ROOT, pack, "geometry.json")):
            continue
        res[pack] = m = measure(pack)
        print(f"{pack}  water on floor {m['water'] * 100:5.1f}%  {m['waterRGB']}   sky on ring {m['sky'] * 100:5.1f}%  {m['skyRGB']}"
              f"   (floor {m['floorArea']:.3g}, ring {m['ringArea']:.3g})")
    if "--json" in sys.argv:
        json.dump(res, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()
