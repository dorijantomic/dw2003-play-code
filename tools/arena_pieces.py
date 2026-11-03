#!/usr/bin/env python3
"""Cut an arena's texture sheets into PIECES and say what each piece is, from the arena's own triangles.

  python3 tools/arena_pieces.py <meftXXXX> <out_dir>

A piece = triangles of one page AND ONE CLUT (palette) whose texel footprints overlap (the copies of one picture, e.g. one
tree card placed 20 times) or that share an edge both in 3D and on the sheet (the two halves of a quad).
The picture of a piece is cut from the sheet of its OWN CLUT = the one the game draws it with (web/battle3d.js
arenaTextureFor, key page_c<col>_r<row>).
CLUT FIX 2026-11-03: before, pieces were merged across CLUTs and cut from the most common CLUT, so e.g. the meft1009 witch
(CLUT c48_r254) came out red (c16_r252). Pieces that read the same texels under another CLUT are now separate pieces;
"recolour_of" names the larger piece whose texels they mostly repeat.
Naming: a cluster of the old (CLUT-blind) numbering that was not split keeps its old name <page>_<nn>; a split one becomes
<page>_<nn>_c<col>_r<row> (+ _<k> for a 2nd piece of the same CLUT).
Per piece, measured:
  flat    share of its triangles facing up (|normal y| > 0.7)
  dist    median distance of its triangles from the fight centre (pack units)
  height  median height above the floor (pack units, up = -y)
  copies  most triangles that read one texel (1 = used once)
  joined  copies that touch in 3D (the picture is laid edge to edge, so its edges must join)
  clear   share of its texels that are see-through (alpha 0) on its own sheet
Type (only from those numbers): ground (flat > 0.7), cutout (upright, clear > 0.05), far (upright, dist > 20000:
the scenery ring; meft1013's sits at 29000-32500), wall (the rest).
Writes <out_dir>/<piece>.png (the HD picture of the piece; outside the piece and see-through = black), two messages per
piece (<piece>_prompt1.txt "what is shown", _prompt2.txt "paint it anew" + edges that join), LIST.txt and
pieces.json (for the tools, never for Gemini). pieces.json per piece also holds clut [col,row], cluster (old name),
split, recolour_of and tri_refs = [[group index, triangle index in that group of geometry.json], ...] = where the piece
stands in the arena (corners: geometry.json groups[g].pos[9*t : 9*t+9]).
"""
import json, os, sys
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw

WEB = os.path.expanduser("~/dw2003-play-integration/web")
# user 2026-10-29: "keep everything the same" made Gemini copy the picture; "redraw as the real thing" went photo-real.
# Two messages in one chat: (1) Gemini says what it sees (so the prompt never names it), (2) it paints that anew in the
# style the user chose: Digimon Adventure anime background art.
ASK = ("What is shown in this low-resolution {what} from a PlayStation 1 game? Describe each thing in it in a few "
       "words.")
PAINT = ("Now paint a new, high-resolution version of what you described, as a {what} for a modern game, in the style "
         "of the Digimon Adventure anime's background art. Keep the original colours and the same simple shapes. "
         "Not a photograph. Use the old picture as the guide for the outline, the position and the colours of each "
         "thing: everything stays where it is.")
WHAT = {"ground": "ground texture", "cutout": "cut-out picture", "wall": "wall texture",
        "far": "distant background strip"}
EXTRA = {"ground": "", "cutout": " The silhouette stays exactly the same and the black around it stays plain black.",
         "wall": " Black areas stay plain black.", "far": " Black areas stay plain black."}
PROMPTS = {t: PAINT.format(what=w) + EXTRA[t] for t, w in WHAT.items()}
JOIN = {"lr": " It repeats side by side in the game, so keep it seamless: the left edge must join the right edge.",
        "tb": " It repeats top to bottom in the game, so keep it seamless: the top edge must join the bottom edge.",
        "both": " It repeats in every direction in the game, so keep it seamless: the left edge must join the right edge"
                " and the top edge must join the bottom edge."}


class DSU:
    def __init__(s, n): s.p = list(range(n))
    def f(s, a):
        while s.p[a] != a: s.p[a] = s.p[s.p[a]]; a = s.p[a]
        return a
    def u(s, a, b): s.p[s.f(a)] = s.f(b)


def footprint(uv):
    """Texels a triangle reads (PS1 UVs are whole texels and inclusive)."""
    im = Image.new("L", (256, 256), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in uv], fill=1, outline=1)
    ys, xs = np.nonzero(np.asarray(im))
    return set(zip(ys.tolist(), xs.tolist()))


def cluster(T, by_clut):
    """Union-find over the triangles T of one page. by_clut=False is the OLD CLUT-blind clustering (kept only for the piece numbers)."""
    d = DSU(len(T))
    owner = defaultdict(list)                       # texel (+ CLUT) -> triangles reading it
    for i, t in enumerate(T):
        for px in t["fp"]: owner[(t["clut"] if by_clut else None,) + px].append(i)
    for lst in owner.values():
        for j in lst[1:]: d.u(lst[0], j)
    edge = {}                                       # quad halves: same edge in 3D and on the sheet
    for i, t in enumerate(T):
        for a, b in ((0, 1), (1, 2), (2, 0)):
            k = (t["clut"] if by_clut else None,
                 frozenset([(tuple(np.round(t["p"][a])), tuple(t["uv"][a])), (tuple(np.round(t["p"][b])), tuple(t["uv"][b]))]))
            if k in edge: d.u(edge[k], i)
            else: edge[k] = i
    groups = defaultdict(list)
    for i in range(len(T)): groups[d.f(i)].append(i)
    return list(groups.values())


def main(arena, out):
    g = json.load(open(f"{WEB}/assets/battle/arenas/{arena}/geometry.json"))
    tris = []
    for gi, gr in enumerate(g["groups"]):
        clut = gr.get("clut") or [0, 255]
        P = np.array(gr["pos"], float).reshape(-1, 3, 3)
        UV = np.rint(np.array(gr["uv"], float).reshape(-1, 3, 2) * 256).astype(int)
        for ti, (p, uv) in enumerate(zip(P, UV)):
            n = np.cross(p[1] - p[0], p[2] - p[0]); L = np.linalg.norm(n)
            if L == 0: continue
            tris.append(dict(page=gr.get("page", "wall"), clut=f"c{clut[0]}_r{clut[1]}", clutrc=[int(clut[0]), int(clut[1])],
                             g=gi, ti=ti, p=p, uv=uv, up=abs(n[1]) / L, fp=footprint(uv)))
    os.makedirs(out, exist_ok=True)
    allp, listing, fps = [], [], {}
    for page in sorted({t["page"] for t in tris}):
        T = [t for t in tris if t["page"] == page]
        key = lambda x: min(min(T[i]["fp"]) for i in x)
        old_groups = sorted(cluster(T, False), key=key)     # the old pieces: their order is the old piece number
        owner_old = {i: n for n, grp in enumerate(old_groups) for i in grp}
        sub = defaultdict(list)
        for grp in cluster(T, True): sub[owner_old[grp[0]]].append(grp)
        plan = []                                           # (piece name, old cluster name, split?, triangle indexes)
        for n, grp in enumerate(old_groups):
            subs = sorted(sub[n], key=lambda x: (T[x[0]]["clut"], key(x)))
            seen = defaultdict(int)
            for x in subs:
                cl = T[x[0]]["clut"]; seen[cl] += 1
                nm = f"{page}_{n:02d}" if len(subs) == 1 else f"{page}_{n:02d}_{cl}" + (f"_{seen[cl]}" if seen[cl] > 1 else "")
                plan.append((nm, f"{page}_{n:02d}", len(subs) > 1, x))
        for name, clname, split, idx in plan:
            ts = [T[i] for i in idx]
            fp = set().union(*[t["fp"] for t in ts])
            ys = [y for y, _ in fp]; xs = [x for _, x in fp]
            y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs)
            cov = defaultdict(int)
            for t in ts:
                for px in t["fp"]: cov[px] += 1
            copies = max(cov.values())
            # copies that touch in 3D: two triangles reading the same texels and sharing a 3D vertex
            # joined: one 3D corner read at the piece's left edge by one triangle and at its right edge by another
            # (or top and bottom) = the picture continues across that edge in the game, so it must be seamless.
            uvs_at = defaultdict(set)
            for t in ts:
                for v, uv in zip(t["p"], t["uv"]): uvs_at[tuple(np.round(v))].add(tuple(uv))
            W_, H_ = x1 - x0, y1 - y0
            joined_u = joined_v = False
            for uvs in uvs_at.values():
                us = {u for u, _ in uvs}; vs = {v for _, v in uvs}
                if W_ >= 4 and min(us) <= x0 + 1 and max(us) >= x1 - 1: joined_u = True
                if H_ >= 4 and min(vs) <= y0 + 1 and max(vs) >= y1 - 1: joined_v = True
            joined = joined_u or joined_v
            cen = np.array([t["p"].mean(0) for t in ts])
            dist = float(np.median(np.hypot(cen[:, 0], cen[:, 2])))
            height = float(np.median(-cen[:, 1]))
            flat = float(np.mean([t["up"] > 0.7 for t in ts]))
            base = ts[0]["clut"]
            assert all(t["clut"] == base for t in ts), name          # one piece = one CLUT, always
            sheet = f"{WEB}/assets-hd/battle/arenas/{arena}/{page}_{base}.png"
            if not os.path.exists(sheet): sheet = f"{WEB}/assets/battle/arenas/{arena}/{page}_{base}.png"
            im = np.asarray(Image.open(sheet).convert("RGBA"))
            s = im.shape[0] // 256
            crop = im[y0 * s:(y1 + 1) * s, x0 * s:(x1 + 1) * s].copy()
            m = np.zeros((y1 - y0 + 1, x1 - x0 + 1), bool)
            for y, x in fp: m[y - y0, x - x0] = True
            clear = float(np.mean(crop[..., 3][np.kron(m, np.ones((s, s), bool))] == 0))
            m = np.kron(m, np.ones((s, s), bool)) & (crop[..., 3] > 0)
            rgb = crop[..., :3].copy(); rgb[~m] = 0
            typ = "ground" if flat > 0.7 else "cutout" if clear > 0.05 else "far" if dist > 20000 else "wall"
            Image.fromarray(rgb, "RGB").save(f"{out}/{name}.png")
            prompt = PROMPTS[typ] + (JOIN["both"] if joined_u and joined_v else JOIN["lr"] if joined_u
                                     else JOIN["tb"] if joined_v else "")
            open(f"{out}/{name}_prompt1.txt", "w").write(ASK.format(what=WHAT[typ]) + "\n")
            open(f"{out}/{name}_prompt2.txt", "w").write(prompt + "\n")
            fps[name] = fp
            allp.append(dict(name=name, page=page, base=base, clut=ts[0]["clutrc"], cluster=clname, split=split, recolour_of=None,
                             rect=[x0, y0, x1 + 1, y1 + 1], tris=len(ts), cluts=[base], flat=round(flat, 2), dist=round(dist),
                             height=round(height), copies=copies, joined=joined, joined_lr=joined_u, joined_tb=joined_v, clear=round(clear, 3),
                             type=typ, prompt=prompt, tri_refs=sorted([t["g"], t["ti"]] for t in ts)))
            listing.append(f"{name}.png  {typ:6s}{(' joins ' + ('L-R' if joined_u else '') + (' T-B' if joined_v else '')) if joined else ''}  "
                           f"{x1 - x0 + 1}x{y1 - y0 + 1} texels, {len(ts)} tris, copies {copies}, "
                           f"flat {flat:.2f}, dist {dist:.0f}, height {height:.0f}, clear {clear:.2f}, {base}")
    # recolour_of: a piece whose texels are mostly read by a LARGER piece of the same page under another CLUT = the same picture, other palette
    for p in allp:
        best = None
        for q in allp:
            if q is p or q["page"] != p["page"] or q["clut"] == p["clut"]: continue
            a, b = fps[p["name"]], fps[q["name"]]
            sh = len(a & b)
            if sh >= 0.5 * min(len(a), len(b)) and (len(b), q["name"]) > (len(a), p["name"]) and (best is None or sh > best[0]):
                best = (sh, q["name"])
        p["recolour_of"] = best[1] if best else None
    json.dump(allp, open(f"{out}/pieces.json", "w"), indent=1)
    with open(f"{out}/LIST.txt", "w") as f:
        f.write("One NEW Gemini chat per piece: attach <name>.png with <name>_prompt1.txt, wait for the answer,\n"
                "then send <name>_prompt2.txt. Save the picture next to it as <name>_remaster.png.\n\n")
        f.write("\n".join(listing) + "\n")
    print("\n".join(listing))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
