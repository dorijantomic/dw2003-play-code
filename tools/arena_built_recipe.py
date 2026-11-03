#!/usr/bin/env python3
"""Recipe for the BUILT look of an arena (Arena Viewer, look=built): where each kind of thing stands, from the arena's
own triangles, so web/arena-built.js can build it anew with three.js (trees, ground, bank, sky) in the same places.

  python3 tools/arena_built_recipe.py <meftXXXX> <kinds> [out.json]
    kinds: piece=kind,... (piece names as tools/arena_pieces.py prints them; what each piece IS, e.g. from asking
           Gemini "what does each picture show"). Kinds: grass, bank, soil, pine, tree, treeline, sky, haze,
           cypress_wall, cypress_grove, mushroom, fringe (the meft1008 card kinds), far_pines and rock (meft1008's
           painted far treeline and its boulder piles: cards + colours + ring from the triangles above y 0 only,
           far_pines also the colour of each picture row), and the beach kinds sand, shore, water, sea, gulls, spire
           (see BEACH_KINDS below; meft1002).
    out:   default web/assets-hd/battle/built/<meft>.json (git-ignored: it is made from the disc's arena).

Everything is in RENDER space (pack (x, -y, -z) x MODEL_SCALE 0.35, floor at y 0, up = +y), the space the battle
camera and the fighters use. Per piece: its triangles (ground, bank), or its cards (cut-outs: one upright card per
3D-connected group of triangles, base centre + width + height), or its ring (sky, haze: radius and heights), and
its measured colours (median of the piece's own HD pixels, split into green-ish and the rest).
"""
import json, os, sys
from collections import defaultdict
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from arena_pieces import DSU, footprint, WEB   # same piece grouping as the pieces tool

S = 140 / 400   # MODEL_SCALE


def pieces_of(arena):
    g = json.load(open(f"{WEB}/assets/battle/arenas/{arena}/geometry.json"))
    tris = []
    for gr in g["groups"]:
        clut = gr.get("clut") or [0, 255]
        P = np.array(gr["pos"], float).reshape(-1, 3, 3)
        UV = np.rint(np.array(gr["uv"], float).reshape(-1, 3, 2) * 256).astype(int)
        for p, uv in zip(P, UV):
            n = np.cross(p[1] - p[0], p[2] - p[0])
            if np.linalg.norm(n) == 0: continue
            tris.append(dict(page=gr.get("page", "wall"), clut=f"c{clut[0]}_r{clut[1]}", p=p, uv=uv, fp=footprint(uv)))
    out = {}
    for page in sorted({t["page"] for t in tris}):
        T = [t for t in tris if t["page"] == page]
        d = DSU(len(T))
        owner = defaultdict(list)
        for i, t in enumerate(T):
            for px in t["fp"]: owner[px].append(i)
        for lst in owner.values():
            for j in lst[1:]: d.u(lst[0], j)
        edge = {}
        for i, t in enumerate(T):
            for a, b in ((0, 1), (1, 2), (2, 0)):
                k = frozenset([(tuple(np.round(t["p"][a])), tuple(t["uv"][a])),
                               (tuple(np.round(t["p"][b])), tuple(t["uv"][b]))])
                if k in edge: d.u(edge[k], i)
                else: edge[k] = i
        groups = defaultdict(list)
        for i in range(len(T)): groups[d.f(i)].append(i)
        for n, idx in enumerate(sorted(groups.values(), key=lambda x: min(min(T[i]["fp"]) for i in x))):
            out[f"{page}_{n:02d}"] = [T[i] for i in idx]
    return out


def render(p):   # pack -> render space
    return np.stack([p[..., 0] * S, -p[..., 1] * S, -p[..., 2] * S], -1)


def colours(arena, ts):
    page = ts[0]["page"]
    base = max({t["clut"] for t in ts}, key=lambda c: sum(t["clut"] == c for t in ts))
    sheet = f"{WEB}/assets-hd/battle/arenas/{arena}/{page}_{base}.png"
    if not os.path.exists(sheet): sheet = f"{WEB}/assets/battle/arenas/{arena}/{page}_{base}.png"
    im = np.asarray(Image.open(sheet).convert("RGBA")).astype(float)
    s = im.shape[0] // 256
    fp = set().union(*[t["fp"] for t in ts])
    ys = np.array([y for y, _ in fp]); xs = np.array([x for _, x in fp])
    y0, y1 = ys.min(), ys.max()
    px = im[ys * s + s // 2, xs * s + s // 2]
    keep = (px[:, 3] > 0) & (px[:, :3].max(1) > 12)
    px, rows = px[keep, :3], ((ys[keep] - y0) / max(1, y1 - y0))
    green = px[:, 1] > px[:, 0]
    med = lambda a: [int(v) for v in np.median(a, 0)] if len(a) else None
    return dict(all=med(px), p10=[int(v) for v in np.percentile(px, 10, 0)], p90=[int(v) for v in np.percentile(px, 90, 0)],
                green=med(px[green]), other=med(px[~green]),
                top=med(px[rows < 0.25]), bottom=med(px[rows > 0.75]))


def cards(ts):
    """One upright card per set of triangles joined by a shared 3D EDGE (the two halves of a quad; cards laid side by
    side share only corners... and an edge with the next card, so a card also stops where its texels start over)."""
    d = DSU(len(ts)); at = {}
    for i, t in enumerate(ts):
        for a, b in ((0, 1), (1, 2), (2, 0)):
            k = frozenset([(tuple(np.round(t["p"][a])), tuple(t["uv"][a])), (tuple(np.round(t["p"][b])), tuple(t["uv"][b]))])
            if k in at: d.u(at[k], i)
            else: at[k] = i
    g = defaultdict(list)
    for i in range(len(ts)): g[d.f(i)].append(i)
    res = []
    u0 = min(int(t["uv"][:, 0].min()) for t in ts)
    for idx in g.values():
        # copies of the picture on this card: one ground spot (x, z) of the picture's left edge per copy (the edge's
        # corners stack above each other there; meft1013 cuts each picture into a top and a bottom half = 3 corners)
        left = {(round(v[0]), round(v[2])) for i in idx for v, uv in zip(ts[i]["p"], ts[i]["uv"]) if uv[0] <= u0}
        copies = max(1, len(left))
        P = render(np.concatenate([ts[i]["p"] for i in idx]))
        lo, hi = P.min(0), P.max(0)
        c = (lo + hi) / 2
        xz = P[:, [0, 2]] - P[:, [0, 2]].mean(0)       # the card's own sideways direction (largest spread)
        dx, dz = np.linalg.svd(xz, full_matrices=False)[2][0]
        res.append(dict(base=[round(float(c[0]), 1), round(float(lo[1]), 1), round(float(c[2]), 1)],
                        dir=[round(float(dx), 3), round(float(dz), 3)], copies=copies,
                        w=round(float(np.hypot(hi[0] - lo[0], hi[2] - lo[2])), 1), h=round(float(hi[1] - lo[1]), 1)))
    return res


# ---------------- beach kinds (meft1002 South Cape / Shell Beach, 2026-10-29) ----------------
# sand    ground the fighters stand on: triangles + edge (per azimuth: how far out it reaches)
# shore   ground band sand -> grass: triangles + per-vertex picture row (uvr) + colour per picture row (rows)
# water   turquoise water strips: triangles, ring, edge, uvr/rows, upright cards
# sea     the far sea (turquoise near -> deep blue far): triangles, ring, edge, uvr/rows
# gulls   seagull cut-outs: upright cards + ring
# spire   giant rock spires with trees: triangles, upright cards, ring
# Everything that is not meft1013's own kinds goes through this branch only, so meft1013's recipe is unchanged.
BEACH_KINDS = ("sand", "shore", "water", "sea", "gulls", "spire")
# near tree ring of meft1008 (forest + lake): cypress_wall = a closed band of tall narrow trees, cypress_grove = shrubs
# at the foot with taller trees above. Cards + tex like pine/tree/treeline, but only from the triangles above y 0.
RING_TREE_KINDS = ("cypress_wall", "cypress_grove")
# Painted pieces of meft1008 that stand on/above the floor, cards + colours + their ring, again from the triangles above
# y 0 only (each has its own lake copy in another group: wall_01 / wall_04, other kinds):
#   far_pines  the far treeline (wall_00): a closed band at r 27.78 m, y 0..7.41 m. Also carries the picture's colour
#              per ROW (8 rows = MEASURE.md 2c's 8 x 0.925 m band rows; row 0 = the picture's top), which web/built/
#              trees.js builds the band's hard value bands from.
#   rock       boulder piles (wall_03): cards (from triangles with y >= -1), colours, ring. web/built/boulders.js.
BAND_KINDS = ("far_pines",)
PILE_KINDS = ("rock", "boulder")
UP_KINDS = BAND_KINDS + PILE_KINDS
EDGE_BINS = 36       # azimuth bins of 10 deg for "edge" (PICKED)
ROW_BINS = 8         # picture-row bins for "rows" (PICKED)
SAMPLES = 6          # barycentric steps per triangle side when sampling a piece's surface for "edge" (PICKED)


def ring_of(flat, r):
    """rmin/rmax/ymin/ymax + [height, radius] profile, exactly as the sky/haze branch makes them."""
    e = dict(rmin=round(float(r.min()), 1), rmax=round(float(r.max()), 1),
             ymin=round(float(flat[:, 1].min()), 1), ymax=round(float(flat[:, 1].max()), 1))
    rows = []
    for y, rr in sorted(zip(flat[:, 1].tolist(), r.tolist())):
        if rows and y - rows[-1][0][-1] < 5: rows[-1][0].append(y); rows[-1][1].append(rr)
        else: rows.append(([y], [rr]))
    e["profile"] = [[round(float(np.mean(ys)), 1), round(float(np.mean(rs)), 1)] for ys, rs in rows]
    return e


def edge_of(P):
    """Per 10 deg of azimuth (az = atan2(x, z) in deg; bin k covers [-180 + 10k, -170 + 10k)): the nearest and
    farthest radius of the piece's surface there and its mean height, from points sampled on every triangle.
    null = the piece has nothing in that bin."""
    pts = []
    for tri in P:
        for i in range(SAMPLES + 1):
            for j in range(SAMPLES + 1 - i):
                a, b = i / SAMPLES, j / SAMPLES
                pts.append(tri[0] * (1 - a - b) + tri[1] * a + tri[2] * b)
    pts = np.array(pts)
    az = np.degrees(np.arctan2(pts[:, 0], pts[:, 2])); rr = np.hypot(pts[:, 0], pts[:, 2])
    k = np.clip(((az + 180) // (360 / EDGE_BINS)).astype(int), 0, EDGE_BINS - 1)
    out = []
    for b in range(EDGE_BINS):
        m = k == b
        out.append([round(float(rr[m].min()), 1), round(float(rr[m].max()), 1), round(float(pts[m, 1].mean()), 1)] if m.any() else None)
    return out


def rows_of(arena, ts):
    """The piece's measured colour per picture row (ROW_BINS bins, row 0 = the picture's top): median RGB and the share
    of green-ish texels (g > r), sampled as colours() does. Plus per triangle vertex its row fraction (uvr, same order
    as pos), so a builder knows which colour each vertex carries (where the shore turns green, where the sea deepens)."""
    page = ts[0]["page"]
    base = max({t["clut"] for t in ts}, key=lambda c: sum(t["clut"] == c for t in ts))
    sheet = f"{WEB}/assets-hd/battle/arenas/{arena}/{page}_{base}.png"
    if not os.path.exists(sheet): sheet = f"{WEB}/assets/battle/arenas/{arena}/{page}_{base}.png"
    im = np.asarray(Image.open(sheet).convert("RGBA")).astype(float)
    s = im.shape[0] // 256
    fp = set().union(*[t["fp"] for t in ts])
    ys = np.array([y for y, _ in fp]); xs = np.array([x for _, x in fp])
    y0, y1 = ys.min(), ys.max()
    px = im[ys * s + s // 2, xs * s + s // 2]
    keep = (px[:, 3] > 0) & (px[:, :3].max(1) > 12)
    px, fr = px[keep, :3], ((ys[keep] - y0) / max(1, y1 - y0))
    rows = []
    for b in range(ROW_BINS):
        m = (fr >= b / ROW_BINS) & ((fr < (b + 1) / ROW_BINS) if b < ROW_BINS - 1 else (fr <= 1))
        rows.append(dict(rgb=[int(v) for v in np.median(px[m], 0)], green=round(float((px[m, 1] > px[m, 0]).mean()), 3)) if m.any() else None)
    uvr = [round(float(min(1.0, max(0.0, (uv[1] - y0) / max(1, y1 - y0)))), 3) for t in ts for uv in t["uv"]]
    return rows, uvr


def beach_piece(arena, e, ts, P, flat, r):
    kind = e["kind"]
    if kind in ("sand", "shore", "water", "sea", "spire"):
        e["pos"] = [round(float(v), 1) for v in P.reshape(-1)]
    if kind in ("water", "sea", "gulls", "spire"):
        e.update(ring_of(flat, r))
    if kind in ("sand", "shore", "water", "sea"):
        e["edge"] = edge_of(P)
    if kind in ("shore", "water", "sea"):
        e["rows"], e["uvr"] = rows_of(arena, ts)
    if kind in ("water", "gulls", "spire"):
        e["cards"] = cards(ts)
        fp = set().union(*[t["fp"] for t in ts])
        e["tex"] = [max(x for _, x in fp) - min(x for _, x in fp) + 1, max(y for y, _ in fp) - min(y for y, _ in fp) + 1]


def beach_summary(pieces):
    """Where the beach's bands are, per 10 deg of azimuth (same bins as edge): [sand rmin, sand rmax, shore rmin,
    shore rmax, nearest water r, nearest sea r] (null where the kind has nothing in that bin), plus the medians
    over the bins and each kind's height range. The shore line (where the sand meets the water) is read from these."""
    by = defaultdict(list)
    for p in pieces: by[p["kind"]].append(p)
    def merged(kind, i, f):
        out = []
        for b in range(EDGE_BINS):
            v = [p["edge"][b][i] for p in by.get(kind, []) if p.get("edge") and p["edge"][b] is not None]
            out.append(f(v) if v else None)
        return out
    cols = [merged("sand", 0, min), merged("sand", 1, max), merged("shore", 0, min), merged("shore", 1, max),
            merged("water", 0, min), merged("sea", 0, min)]
    bins = [[c[b] for c in cols] for b in range(EDGE_BINS)]
    med = lambda i: (round(float(np.median([x for x in cols[i] if x is not None])), 1) if any(x is not None for x in cols[i]) else None)
    heights = {k: [min(min(p["pos"][1::3]) for p in v if "pos" in p), max(max(p["pos"][1::3]) for p in v if "pos" in p)]
               for k, v in by.items() if any("pos" in p for p in v)}
    return dict(columns=["sandRmin", "sandRmax", "shoreRmin", "shoreRmax", "waterRmin", "seaRmin"], bins=bins,
                summary=dict(sandRmin=med(0), sandRmax=med(1), shoreRmin=med(2), shoreRmax=med(3), waterRmin=med(4),
                             seaRmin=med(5), heights=heights))


def main(arena, kinds, out):
    kinds = dict(kv.split("=") for kv in kinds.split(","))
    pcs = pieces_of(arena)
    man = json.load(open(f"{WEB}/assets/battle/arenas/manifest.json"))
    bg = next((v.get("bg") for v in man["byArena"].values() if v["pack"] == arena), None)
    rec = dict(arena=arena, bg=bg, pieces=[])
    for name, kind in kinds.items():
        ts = pcs[name]
        P = render(np.stack([t["p"] for t in ts]))          # (n, 3, 3)
        flat = P.reshape(-1, 3)
        r = np.hypot(flat[:, 0], flat[:, 2])
        e = dict(name=name, kind=kind, tris=len(ts), colours=colours(arena, ts))
        if kind in ("grass", "bank", "soil"):   # soil: meft1008 forest floor (web/built/soil.js)
            e["pos"] = [round(float(v), 1) for v in P.reshape(-1)]
        elif kind in RING_TREE_KINDS:
            # meft1008's tree ring (web/built/trees.js): each floor piece holds the upright cards AND their upside-down
            # lake copies (same picture, other palette). Only the triangles standing on or above the floor (every
            # corner y >= 0) are cards and colours here, so a card is not merged with its own reflection.
            up = [t for t, p in zip(ts, P) if p[:, 1].min() >= -1.0]
            e["tris"] = len(up)
            e["colours"] = colours(arena, up)
            e["cards"] = cards(up)
            fp = set().union(*[t["fp"] for t in up])
            e["tex"] = [max(x for _, x in fp) - min(x for _, x in fp) + 1, max(y for y, _ in fp) - min(y for y, _ in fp) + 1]
        elif kind in UP_KINDS:
            # meft1008's painted far treeline (wall_00, kind far_pines) and its boulder piles (wall_03, kind rock):
            # cards, colours and the ring come from the triangles standing on or above the floor only, so neither
            # picks up its own lake copy (wall_01 / wall_04 are separate groups with their own kinds).
            up = [t for t, p in zip(ts, P) if p[:, 1].min() >= -1.0]
            Pup = np.stack([t["p"] for t in up])
            e["tris"] = len(up)
            e["colours"] = colours(arena, up)
            e["cards"] = cards(up)
            fp = set().union(*[t["fp"] for t in up])
            e["tex"] = [max(x for _, x in fp) - min(x for _, x in fp) + 1, max(y for y, _ in fp) - min(y for y, _ in fp) + 1]
            Pfl = render(Pup).reshape(-1, 3)
            e.update(ring_of(Pfl, np.hypot(Pfl[:, 0], Pfl[:, 2])))
            if kind in BAND_KINDS:
                e["rows"], e["uvr"] = rows_of(arena, up)   # per picture row (8 rows top -> bottom)
        # mushroom (wall_06 clusters) and fringe (wall_07 reeds) are upright cards like pine/tree/treeline: same
        # branch, so their modules get base/dir/w/h per card (meft1008: 5 + 5). Old kinds untouched.
        elif kind in ("pine", "tree", "treeline", "mushroom", "fringe"):
            e["cards"] = cards(ts)
            fp = set().union(*[t["fp"] for t in ts])   # the picture's own size in texels (its width : height)
            e["tex"] = [max(x for _, x in fp) - min(x for _, x in fp) + 1, max(y for y, _ in fp) - min(y for y, _ in fp) + 1]
        elif kind in BEACH_KINDS:
            beach_piece(arena, e, ts, P, flat, r)
        else:   # sky, haze: a ring
            e.update(rmin=round(float(r.min()), 1), rmax=round(float(r.max()), 1),
                     ymin=round(float(flat[:, 1].min()), 1), ymax=round(float(flat[:, 1].max()), 1))
            # the ring's own shape: [height, radius] at each height its corners stand at (corners less than 5 units
            # apart in height are one row), so the built sky knows where a view ray meets the ring (web/built/sky.js)
            rows = []
            for y, rr in sorted(zip(flat[:, 1].tolist(), r.tolist())):
                if rows and y - rows[-1][0][-1] < 5: rows[-1][0].append(y); rows[-1][1].append(rr)
                else: rows.append(([y], [rr]))
            e["profile"] = [[round(float(np.mean(ys)), 1), round(float(np.mean(rs)), 1)] for ys, rs in rows]
        rec["pieces"].append(e)
        print(name, kind, len(ts), "tris", f"r {r.min():.0f}-{r.max():.0f}", f"y {flat[:, 1].min():.0f}-{flat[:, 1].max():.0f}",
              f"cards {len(e['cards'])}" if "cards" in e else "", "colour", e["colours"]["all"])
    if any(p["kind"] in BEACH_KINDS for p in rec["pieces"]):
        rec["beach"] = beach_summary(rec["pieces"])
        print("beach", json.dumps(rec["beach"]["summary"]))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(rec, open(out, "w"))
    print("->", out)


if __name__ == "__main__":
    a = sys.argv[1]
    main(a, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else f"{WEB}/assets-hd/battle/built/{a}.json")
