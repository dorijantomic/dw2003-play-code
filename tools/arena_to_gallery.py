#!/usr/bin/env python3
"""arena_to_gallery: arena(s) -> pieces -> separate bits -> FIBO "P5" picture -> TripoSR 3D mesh -> painted gallery object. In STAGES.

  WSL:      python3 ~/dw2003-play-integration/tools/arena_to_gallery.py <meft> [<meft> ...] [--stage 1,2,3] [--only <piece>[,<piece>]] [--all]
            python3 ~/dw2003-play-integration/tools/arena_to_gallery.py --full          (every arena of manifest.json byArena, meft1009 first, then ascending)
  Windows:  wsl.exe python3 ~/dw2003-play-integration/tools/arena_to_gallery.py ...

STAGES (each runs over ALL given arenas before the next starts; each skips what already exists, so a re-run resumes):
  1  cut pieces (tools/arena_pieces.py), split bits, make the FIBO P5 picture of every object. At its end: FIBO final check.
  2  TripoSR 3D model (I:\\triposr\\run.bat) of every object that has a picture.
  3  paint (tools/project_paint.mjs, front + mirrored back, camera fit) + tools/paint_check.mjs + gallery row in
     web/assets-lab/objects/objects.json (git-ignored). Backup of objects.json on I:\\arena-objects\\backup\\ first.
Default pieces: type cutout and wall (upright things). ground and far are skipped. --all = every piece.

SPLIT: in a piece picture (black = outside / see-through) the connected non-black islands (8-neighbour, after a small closing) are found.
  An island is kept when its area is >= ISLAND_MIN_TEXELS texels (40; = 640 px at the 4x HD sheets) AND >= ISLAND_MIN_SHARE of the piece's
  non-black area (2 %); at most MAX_ISLANDS (12) per piece, largest first. One kept island = object "<piece>", several = "<piece>_i<n>"
  (gallery name "<meft> <piece> #n"). Identical / near-identical objects (bbox equal within 3 %, mask IoU >= 0.9, mean colour difference <= 10/255)
  of the same arena are made only once (the first, larger one). Dropped / duplicate islands are logged.
FIBO P5 prompt (user-approved style P5, automatic colour words): see prompt_for(). Seed 1234, steps 4, input = <object>_in.png
  (original, not smoothed). ONE picture per ComfyUI start (tools/fibo_p5_one.py on Windows python): pre-kill, C: guard 2.5 GB, start, run,
  finally-kill, port 8199 listening=0 and FIBO python=0 checked after each picture; connection-closed errors retried up to 2 times; C: low ->
  wait until C: > 10 GB and retry once, then skip + log. TripoSR / FIBO only; TRELLIS is never used.
Work dir (disc-derived, outside git): I:\\arena-objects\\<meft>\\ : pieces/, objects/ (island pictures), objects.json, fibo/, mesh/, log.txt, results.json.
  Older (pre-P5) fibo/, mesh/, results.json are moved once to <meft>/old_pre_P5/. Log of every run: I:\\arena-objects\\overnight.log,
  summary: I:\\arena-objects\\SUMMARY.txt (written after every stage and at the end).
"""
import json, os, re, shutil, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.path.expanduser("~/.nvm/versions/node/v24.16.0/bin/node")
ROOT = "/mnt/i/arena-objects"
OVERNIGHT = f"{ROOT}/overnight.log"
SUMMARY = f"{ROOT}/SUMMARY.txt"
STATEF = f"{ROOT}/run_state.json"
HELPER = os.path.join(REPO, "tools", "fibo_p5_one.py")
FWINPY = "/mnt/l/fibo/venv/Scripts/python.exe"
PVER = "P5"
PAINT_SRC = f"arena_to_gallery {PVER} FIBO+TripoSR+project_paint"
ISLAND_MIN_TEXELS = 40
ISLAND_MIN_SHARE = 0.02
MAX_ISLANDS = 12
CATALOGUE = f"{REPO}/web/assets-lab/objects/objects.json"
GLBDIR = f"{REPO}/web/assets-lab/objects/glb"
T_START = time.time()


def wpath(p):  # /mnt/i/x -> I:\x
    m = re.match(r"/mnt/([a-z])/(.*)", p)
    return m.group(1).upper() + ":\\" + m.group(2).replace("/", "\\")


# ---------------------------------------------------------------- logging
_arena_log = [None]


def log(s):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + s
    print(line, flush=True)
    with open(OVERNIGHT, "a") as f:
        f.write(line + "\n")
    if _arena_log[0]:
        with open(_arena_log[0], "a") as f:
            f.write(line + "\n")


def wdir(meft):
    d = f"{ROOT}/{meft}"
    for s in ("pieces", "objects", "fibo", "mesh"):
        os.makedirs(f"{d}/{s}", exist_ok=True)
    _arena_log[0] = f"{d}/log.txt"
    return d


def load_res(W):
    f = f"{W}/results.json"
    return json.load(open(f)) if os.path.exists(f) else {}


def save_res(W, res):
    json.dump(res, open(f"{W}/results.json", "w"), indent=1)


# ---------------------------------------------------------------- colours -> words
def colour_name(rgb):
    import colorsys
    r, g, b = [c / 255 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    h *= 360
    if l < 0.10:
        return "near-black" if s < 0.25 else "near-black dark " + hue_name(h, l)
    if s < 0.10:
        return "black" if l < 0.15 else "dark grey" if l < 0.35 else "mid grey" if l < 0.6 else "light grey" if l < 0.85 else "off-white"
    light = "dark" if l < 0.28 else "" if l < 0.55 else "light" if l < 0.78 else "pale"
    sat = "muted grey-" if s < 0.25 else "muted " if s < 0.45 else "vivid " if s > 0.8 else ""
    return " ".join(x for x in (light, (sat + hue_name(h, l)).strip()) if x)


def hue_name(h, l):
    if h < 15 or h >= 345:
        return "pink" if l > 0.72 else "maroon" if l < 0.25 else "red"
    if h < 40:
        return "brown" if l < 0.40 else "orange"
    if h < 65:
        return "olive" if l < 0.35 else "yellow"
    if h < 90:
        return "olive green" if l < 0.4 else "yellow-green"
    if h < 160:
        return "green"
    if h < 190:
        return "teal"
    if h < 215:
        return "cyan"
    if h < 250:
        return "blue"
    if h < 275:
        return "indigo-violet"
    if h < 300:
        return "violet"
    if h < 330:
        return "magenta"
    return "pink" if l > 0.6 else "rose"


def prompt_for(page, main, hi):
    """P5 = approved P5 (I:\\fibo-prompt-test\\prompts.txt floor_02_P5)."""
    objw = "a wall piece of a dungeon, a tall upright slab" if page == "wall" else "a dungeon floor piece"
    return (f"A single game object: {objw}. Main colour {colour_name(main)} (RGB {main[0]}, {main[1]}, {main[2]}), "
            f"with highlights in {colour_name(hi)} (RGB {hi[0]}, {hi[1]}, {hi[2]}). "
            "Fine surface detail, smooth curved surfaces, solid 3D form, flat painted colours with crisp dark outlines, cel-shaded, clean shapes, no gradients. "
            "The object is centred on a plain white background, one object only, no ground, no floor, no shadow, no other objects. "
            "Style: anime cel-shaded, clean. "
            "Redraw this as a high-detail 3D object with smooth curved surfaces, painted as a clean anime game asset with crisp cel shading.")


# ---------------------------------------------------------------- CLUT fix helpers (2026-11-03)
OLDRUN = f"{ROOT}/backup/before_clut_fix/arenas"      # copy of the arena work dirs made before the CLUT fix
_FP = {}


def adopt_old_names(meft, out):
    """Objects whose picture is byte-identical to an object of the earlier run take its obj/name/n (so nothing of theirs is redone)."""
    import numpy as np
    from PIL import Image
    od = f"{OLDRUN}/{meft}"
    if not os.path.exists(f"{od}/objects.json"):
        return
    old = json.load(open(f"{od}/objects.json"))["objects"]
    pics = {}
    for r in old:
        f = f"{od}/objects/{r['obj']}.png"
        if os.path.exists(f):
            pics[r["obj"]] = np.asarray(Image.open(f).convert("RGB"))
    used = set()
    for o in out:
        for r in old:
            a = pics.get(r["obj"])
            if r["obj"] in used or a is None or a.shape != o["pic"].shape or not np.array_equal(a, o["pic"]):
                continue
            used.add(r["obj"])
            if o["obj"] != r["obj"]:
                o["natural"] = o["obj"]
            o["obj"], o["name"], o["n"], o["adopted"] = r["obj"], r["name"], r["n"], True
            break
    names = [o["obj"] for o in out]
    assert len(names) == len(set(names)), f"{meft}: object names not unique after adoption: {names}"


def _tri(geom, g, t):
    k = (id(geom), g, t)
    if k not in _FP:
        import numpy as np
        sys.path.insert(0, os.path.join(REPO, "tools"))
        from arena_pieces import footprint
        gr = geom["groups"][g]
        pos = np.array(gr["pos"][9 * t:9 * t + 9], float).reshape(3, 3)
        uv = np.rint(np.array(gr["uv"][6 * t:6 * t + 6], float).reshape(3, 2) * 256).astype(int)
        _FP[k] = (pos, uv, footprint(uv))
    return _FP[k]


def _polys(geom, c):
    """The arena polygons (quads where two triangles are the halves of one quad, else triangles) that draw candidate island c:
    group id, triangle ids, corners in geometry.json units (x, y, z as stored; up = -y), their UVs. A polygon belongs to the island
    when any triangle of it reads a texel of the island's picture."""
    import numpy as np
    p, s, mask = c["p"], c["s"], c["full"]
    x0, y0 = p["rect"][0], p["rect"][1]
    T = []
    for g, t in p["tri_refs"]:
        pos, uv, fp = _tri(geom, g, t)
        bel = any(mask[(y - y0) * s:(y - y0 + 1) * s, (x - x0) * s:(x - x0 + 1) * s].any() for y, x in fp)
        T.append(dict(g=g, t=t, pos=pos, uv=uv, bel=bel))
    edges = {}
    for i, a in enumerate(T):
        for e in ((0, 1), (1, 2), (2, 0)):
            k = frozenset([(tuple(np.round(a["pos"][e[0]])), tuple(a["uv"][e[0]])), (tuple(np.round(a["pos"][e[1]])), tuple(a["uv"][e[1]]))])
            edges.setdefault(k, []).append((i, e))
    partner = {}
    for k, lst in edges.items():
        if len(lst) == 2 and lst[0][0] != lst[1][0] and T[lst[0][0]]["g"] == T[lst[1][0]]["g"]:
            partner.setdefault(lst[0][0], []).append((lst[1][0], lst[0][1], lst[1][1]))
            partner.setdefault(lst[1][0], []).append((lst[0][0], lst[1][1], lst[0][1]))
    done, polys = set(), []
    for i, a in enumerate(T):
        if i in done:
            continue
        pr = partner.get(i, [])
        mate = None
        if len(pr) == 1 and len(partner.get(pr[0][0], [])) == 1 and partner[pr[0][0]][0][0] == i:
            mate = pr[0]
        if mate:
            j, ea, eb = mate
            b = T[j]
            ak = ({0, 1, 2} - set(ea)).pop(); bk = ({0, 1, 2} - set(eb)).pop()
            idx = [(a, ak), (a, ea[0]), (b, bk), (a, ea[1])]          # around the quad: apex of A, shared corner, apex of B, other shared corner
            done.update((i, j))
            polys.append(dict(kind="quad", group=a["g"], tris=[[a["g"], a["t"]], [b["g"], b["t"]]], bel=a["bel"] or b["bel"],
                              corners=[[int(round(v)) for v in x["pos"][k]] for x, k in idx], uv=[[int(v) for v in x["uv"][k]] for x, k in idx]))
        else:
            done.add(i)
            polys.append(dict(kind="tri", group=a["g"], tris=[[a["g"], a["t"]]], bel=a["bel"],
                              corners=[[int(round(v)) for v in q] for q in a["pos"]], uv=[[int(v) for v in q] for q in a["uv"]]))
    return [{k: v for k, v in q.items() if k != "bel"} for q in polys if q["bel"]]


def arena_instances(geom, o):
    """Per object: every place in the arena where its picture stands = its own island and the islands of the duplicates skipped for it."""
    out = []
    for c in [o] + o.get("dupes", []):
        out.append(dict(from_obj=c.get("natural") or c["obj"], piece=c["p"]["name"], clut=c["p"].get("clut"), polys=_polys(geom, c)))
    return dict(units="geometry.json pack units, x/y/z as stored (up = -y)", instances=out)


# ---------------------------------------------------------------- split into objects
def build_objects(meft, W, allp, only):
    import numpy as np
    from PIL import Image
    from scipy import ndimage as ndi
    pieces = json.load(open(f"{W}/pieces/pieces.json"))
    geom = json.load(open(f"{REPO}/web/assets/battle/arenas/{meft}/geometry.json"))
    sel = [p for p in pieces if (allp or p["type"] in ("cutout", "wall"))]
    out, dropped, dups = [], [], []
    cand = []
    for p in sel:
        a = np.asarray(Image.open(f"{W}/pieces/{p['name']}.png").convert("RGB"))
        mk = a.max(2) > 0
        s = max(1, a.shape[0] // max(1, p["rect"][3] - p["rect"][1]))
        tot = int(mk.sum())
        cl = ndi.binary_closing(mk, np.ones((3, 3)), iterations=max(1, s // 2)) | mk
        lab, n = ndi.label(cl, np.ones((3, 3)))
        isl = []
        for i in range(1, n + 1):
            reg = lab == i
            area = int((reg & mk).sum())
            ys, xs = np.nonzero(reg)
            isl.append(dict(reg=reg, area=area, texels=area / (s * s), bbox=[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]))
        isl.sort(key=lambda d: -d["area"])
        keep = []
        for d in isl:
            if d["texels"] >= ISLAND_MIN_TEXELS and d["area"] >= ISLAND_MIN_SHARE * tot and len(keep) < MAX_ISLANDS:
                keep.append(d)
            else:
                dropped.append(f"{p['name']}: island {d['area']} px ({d['texels']:.0f} texels, {100 * d['area'] / max(tot, 1):.1f} %) too small or over the cap")
        if not keep:
            dropped.append(f"{p['name']}: NO island big enough -> piece skipped")
        for k, d in enumerate(keep, 1):
            name = p["name"] if len(keep) == 1 else f"{p['name']}_i{k}"
            x0, y0, x1, y1 = d["bbox"]
            reg = d["reg"][y0:y1, x0:x1]
            pic = a[y0:y1, x0:x1].copy()
            pic[~reg] = 0
            cand.append(dict(obj=name, piece=p["name"], n=(k if len(keep) > 1 else None), page=p["page"], type=p["type"],
                             area=d["area"], texels=round(d["texels"]), bbox=d["bbox"], pic=pic, reg=reg, mk=(pic.max(2) > 0),
                             p=p, s=s, full=d["reg"] & mk, dupes=[]))
    # near-identical objects once
    def same(A, B):
        ha, wa = A["reg"].shape; hb, wb = B["reg"].shape
        if abs(ha - hb) > max(2, 0.03 * ha) or abs(wa - wb) > max(2, 0.03 * wa):
            return False
        rb = np.asarray(Image.fromarray(B["reg"].astype(np.uint8) * 255).resize((wa, ha), Image.NEAREST)) > 0
        iou = (A["reg"] & rb).sum() / max(1, (A["reg"] | rb).sum())
        if iou < 0.9:
            return False
        pb = np.asarray(Image.fromarray(B["pic"]).resize((wa, ha), Image.NEAREST)).astype(int)
        both = A["reg"] & rb
        return bool(np.abs(A["pic"].astype(int) - pb)[both].mean() <= 10)
    cand.sort(key=lambda d: -d["area"])
    for c in cand:
        d = next((k for k in out if same(k, c)), None)
        if d:
            dups.append(f"{c['obj']} = {d['obj']}")
            d["dupes"].append(c)
        else:
            out.append(c)
    order = {p["name"]: i for i, p in enumerate(pieces)}
    out.sort(key=lambda d: (order[d["piece"]], d["n"] or 0))
    # CLUT FIX 2026-11-03: an object whose picture is byte-identical to an object of the earlier run keeps that run's name/id, so its
    # fibo/mesh/glb/gallery row stay untouched (earlier run's copy: I:\\arena-objects\\backup\\before_clut_fix\\arenas\\<meft>).
    adopt_old_names(meft, out)
    rec = []
    for o in out:
        Image.fromarray(o["pic"], "RGB").save(f"{W}/objects/{o['obj']}.png")
        px = o["pic"][o["mk"]].astype(float)
        main = [int(v) for v in np.median(px, 0)]
        luma = px @ [0.299, 0.587, 0.114]
        top = px[np.argsort(luma)[-max(1, len(px) // 10):]]
        hi = [int(round(v)) for v in top.mean(0)]
        nm = o.get("name") or f"{meft} {o['piece']}" + (f" #{o['n']}" if o["n"] else "")
        rec.append(dict(obj=o["obj"], piece=o["piece"], n=o["n"], page=o["page"], type=o["type"], texels=o["texels"], bbox=o["bbox"], main=main, hi=hi,
                        clut=o["p"].get("clut"), recolour_of=o["p"].get("recolour_of"), adopted_old_name=o.get("adopted", False),
                        name=nm, id=f"{meft}_{o['obj']}",
                        arena=arena_instances(geom, o)))
    json.dump(dict(objects=rec, dropped=dropped, dups=dups, pieces_total=len(pieces), pieces_selected=len(sel)), open(f"{W}/objects.json", "w"), indent=1)
    return rec, dropped, dups, pieces


def make_in_picture(W, o):
    from PIL import Image
    import numpy as np
    pic = np.asarray(Image.open(f"{W}/objects/{o['obj']}.png").convert("RGB"))
    mk = pic.max(2) > 0   # same as the P5 inputs: black (outside / see-through) -> white, everything else keeps its colour
    out = np.full(pic.shape, 255, np.uint8)
    out[mk] = pic[mk]
    im = Image.fromarray(out)
    s = max(im.size)
    sq = Image.new("RGB", (s, s), "white")
    sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    sq.resize((1024, 1024), Image.LANCZOS).save(f"{W}/fibo/{o['obj']}_in.png")


# ---------------------------------------------------------------- helpers shared by stages
def helper(*a, timeout=None, resfile=None):
    """Run tools/fibo_p5_one.py on Windows python. HARD wall-clock timeout (default 120 s; a picture: 900 s). Output goes to a file (no pipe a stuck
    interop wrapper could hold open), cwd is a Windows path. The WSL<->Windows relay was seen NOT to return after the Windows helper had finished
    (2026-11-03), so: for a picture the helper writes <out>_result.json and we go on 5 s after it appears; for the short commands 10 s after the
    first output line. On a real timeout the process group is killed, FIBO killed + checked, and it is logged."""
    import signal
    os.makedirs(f"{ROOT}/_helper", exist_ok=True)
    shutil.copy(HELPER, f"{ROOT}/_helper/fibo_p5_one.py")   # Windows python cannot open a WSL-home path
    outf = f"/dev/shm/a2g_helper_{os.getpid()}_{a[0]}.out"
    limit = timeout or 120
    if resfile and os.path.exists(resfile):
        os.remove(resfile)
    def killgrp(p):
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(p.pid, sig)
            except ProcessLookupError:
                pass
            time.sleep(1)
    with open(outf, "w") as fo:
        p = subprocess.Popen([FWINPY, "-I", wpath(f"{ROOT}/_helper/fibo_p5_one.py"), *a], stdout=fo, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL, cwd=ROOT, start_new_session=True)
        t0, seen = time.time(), None
        while p.poll() is None:
            if time.time() - t0 > limit:
                killgrp(p)
                log(f"HELPER TIMEOUT after {limit} s: {a[0]} {a[1:2]}; process group killed")
                if a[0] != "kill":
                    log("  FIBO kill + check after timeout: " + (helper("kill").stdout.strip().splitlines() or ["?"])[-1])
                return subprocess.CompletedProcess(a, 3, (open(resfile).read() if resfile and os.path.exists(resfile) else open(outf).read()), "helper timeout")
            ready = (os.path.exists(resfile) and os.path.getsize(resfile) > 0) if resfile else (os.path.getsize(outf) > 0)
            if ready and seen is None:
                seen = time.time()
            if seen and time.time() - seen > (5 if resfile else 10):
                killgrp(p)       # the Windows side is done; only the relay was left waiting
                break
            time.sleep(1)
    txt = open(resfile).read() if resfile and os.path.exists(resfile) else open(outf).read()
    return subprocess.CompletedProcess(a, p.returncode if p.returncode is not None else 0, txt, "")


def c_free():
    r = helper("free")
    try:
        return float(r.stdout.strip().splitlines()[-1])
    except Exception:
        return 0.0


def fibo_check():
    r = helper("check")
    return (r.stdout.strip().splitlines() or ["check failed: " + r.stderr[-200:]])[-1]


def row(meft, obj):
    try:
        return next((r for r in json.load(open(CATALOGUE)) if r["id"] == f"{meft}_{obj}"), None)
    except Exception:
        return None


def painted(meft, obj):
    r = row(meft, obj)
    return bool(r) and PVER in r.get("source", "") and "project_paint" in r.get("source", "")


def selected(objs, only):
    if not only:
        return objs
    return [o for o in objs if o["piece"] in only or o["obj"] in only]


def setup_arena(meft, only, allp):
    """cut + split + archive older results. Returns (W, objects, dropped, dups, res) or None when the arena cannot be cut."""
    W = wdir(meft)
    pj = f"{W}/pieces/pieces.json"
    if os.path.exists(pj) and "tri_refs" not in json.load(open(pj))[0]:   # cut by the CLUT-blind cutter: cut again (the old copy is in OLDRUN)
        shutil.rmtree(f"{W}/pieces")
        log(f"{meft}: pieces of the CLUT-blind cutter removed, cut again")
    if not os.path.exists(f"{W}/pieces/pieces.json"):
        r = subprocess.run(["python3", "tools/arena_pieces.py", meft, f"{W}/pieces"], cwd=REPO, capture_output=True, text=True)
        if r.returncode:
            log(f"{meft}: arena_pieces CANNOT cut: " + (r.stdout + r.stderr)[-300:].replace("\n", " | "))
            return None
        log(f"{meft}: pieces cut")
    if not os.path.exists(f"{W}/.{PVER}"):   # older (other prompt) results: moved away once
        old = [x for x in ("fibo", "mesh", "results.json") if os.path.exists(f"{W}/{x}") and (not os.path.isdir(f"{W}/{x}") or os.listdir(f"{W}/{x}"))]
        if old:
            os.makedirs(f"{W}/old_pre_P5", exist_ok=True)
            for x in old:
                shutil.move(f"{W}/{x}", f"{W}/old_pre_P5/{x}")
            log(f"{meft}: older results moved to old_pre_P5: {old}")
        for s in ("fibo", "mesh"):
            os.makedirs(f"{W}/{s}", exist_ok=True)
        open(f"{W}/.{PVER}", "w").write(time.strftime("%Y-%m-%d %H:%M:%S"))
    objs, dropped, dups, pieces = build_objects(meft, W, allp, only)
    reconcile(meft, W, objs)
    res = load_res(W)
    by = {}
    for p in pieces:
        by[p["type"]] = by.get(p["type"], 0) + 1
    log(f"{meft}: pieces {len(pieces)} by type {by}; objects {len(objs)} (dropped islands {len(dropped)}, duplicates {len(dups)})")
    for d in dropped:
        log(f"  dropped {d}")
    for d in dups:
        log(f"  duplicate {d}")
    return W, objs, dropped, dups, res


# ---------------------------------------------------------------- stage 1
def stage1(meft, ctx, only):
    W, objs, _, _, res = ctx
    todo = []
    for o in selected(objs, only):
        r = res.setdefault(o["obj"], {})
        r.update(piece=o["piece"], type=o["type"], main=o["main"], hi=o["hi"], texels=o["texels"], clut=o.get("clut"),
                 recolour_of=o.get("recolour_of"), arena=o.get("arena"))
        if os.path.exists(f"{W}/fibo/{o['obj']}.png") or os.path.exists(f"{W}/mesh/{o['obj']}/mesh.obj") or painted(meft, o["obj"]):
            continue
        todo.append(o)
    save_res(W, res)
    log(f"{meft} stage 1: {len(todo)} FIBO pictures to make")
    for i, o in enumerate(todo, 1):
        n = o["obj"]; res.setdefault(n, {})
        make_in_picture(W, o)
        pr = prompt_for(o["page"], o["main"], o["hi"])
        open(f"{W}/fibo/{n}_prompt.txt", "w").write(pr + "\n")
        res[n]["prompt"] = pr
        out = f"{W}/fibo/{n}.png"
        ok = False
        for attempt in (1, 2):
            if c_free() < 2.5:
                helper("kill")
            r = helper("one", wpath(f"{W}/fibo/{n}_in.png"), wpath(out), wpath(f"{W}/fibo/{n}_prompt.txt"), "4", timeout=900, resfile=out[:-4] + "_result.json")
            try:
                o_ = json.loads(r.stdout.strip().splitlines()[-1])
            except Exception:
                o_ = dict(status="hang", err="helper gave no result (timeout/crash): " + (r.stdout + r.stderr)[-300:], secs=0, check="?")
            if o_["status"] == "ok" and os.path.exists(out):
                res[n]["fibo_s"] = o_["secs"]; res[n].pop("err1", None); ok = True
                log(f"{meft} FIBO {i}/{len(todo)} {n}: {o_['secs']} s; {o_['check']}")
                break
            if (o_["status"] == "hang" or "1455" in o_.get("err", "")) and attempt == 1:
                log(f"{meft} FIBO {n}: helper hung / crashed / out of commit ({o_['err'][-150:]}); FIBO check: {fibo_check()}; waiting 120 s, trying once more")
                time.sleep(120)
                continue
            if o_["status"] == "lowC":
                log(f"{meft} FIBO {n}: C: below 2.5 GB ({o_['err']}); FIBO killed ({o_['check']}); waiting until C: > 10 GB")
                t = time.time()
                while c_free() <= 10 and time.time() - t < 3600:
                    time.sleep(30)
                if attempt == 2 or c_free() <= 10:
                    res[n]["err1"] = "skipped: C: free below 2.5 GB twice / did not recover"
                    break
                continue
            res[n]["err1"] = "FIBO failed: " + o_["err"]
            log(f"{meft} FIBO {n} FAILED: {o_['err']}; {o_['check']}")
            break
        if not ok:
            log(f"{meft} FIBO {n}: SKIPPED/FAILED ({res[n].get('err1')})")
        save_res(W, res)
    return len(todo)


# ---------------------------------------------------------------- stage 2
def stage2(meft, ctx, only):
    W, objs, _, _, res = ctx
    made = 0
    for o in selected(objs, only):
        n = o["obj"]; res.setdefault(n, {})
        if painted(meft, n) or os.path.exists(f"{W}/mesh/{n}/mesh.obj"):
            continue
        if not os.path.exists(f"{W}/fibo/{n}.png"):
            res.setdefault(n, {})["err2"] = "no FIBO picture"; continue
        t = time.time()
        r = subprocess.run(["cmd.exe", "/c", "I:\\triposr\\run.bat", wpath(f"{W}/fibo/{n}.png"), "--device", "cuda:0", "--mc-resolution", "256"],
                           cwd="/mnt/i", capture_output=True, text=True)
        src = "/mnt/i/triposr/out/0"
        if r.returncode or not os.path.exists(f"{src}/mesh.obj") or os.path.getmtime(f"{src}/mesh.obj") < t - 1:
            res[n]["err2"] = f"TripoSR failed (rc {r.returncode}): " + (r.stdout + r.stderr)[-400:]
            log(f"{meft} {n}: {res[n]['err2']}"); save_res(W, res); continue
        shutil.rmtree(f"{W}/mesh/{n}", ignore_errors=True)
        shutil.move(src, f"{W}/mesh/{n}")
        res[n]["triposr_s"] = round(time.time() - t, 1); res[n].pop("err2", None); made += 1
        log(f"{meft} TripoSR {n}: {res[n]['triposr_s']} s")
        save_res(W, res)
    return made


# ---------------------------------------------------------------- stage 3
def stage3(meft, ctx, only):
    W, objs, _, _, res = ctx
    made = 0
    for o in selected(objs, only):
        n = o["obj"]; res.setdefault(n, {})
        if painted(meft, n):
            continue
        mesh = f"{W}/mesh/{n}/mesh.obj"
        inp = f"{W}/mesh/{n}/input.png"
        if not os.path.exists(mesh) or not os.path.exists(inp):
            res.setdefault(n, {})["err3"] = "no mesh / TripoSR input.png"; continue
        r = subprocess.run([NODE, "tools/project_paint.mjs", mesh, inp, "--name", o["name"], "--id", o["id"], "--category", meft,
                            "--kind", o["type"], "--source", PAINT_SRC, "--licence", "disc-derived"], cwd=REPO, capture_output=True, text=True)
        if r.returncode:
            res[n]["err3"] = "project_paint failed: " + (r.stdout + r.stderr)[-400:]; log(f"{meft} {n}: {res[n]['err3']}"); save_res(W, res); continue
        out = r.stdout
        fit = re.search(r"FITTED camera: .*IoU (\S+)", out) or re.search(r"stock fov \d+: silhouette IoU (\S+)", out)
        fc = re.search(r"front picture \d+ \((\S+)%\), back picture \d+ \((\S+)%\), vertex colour \d+ \((\S+)%\)", out)
        ck = subprocess.run([NODE, "tools/paint_check.mjs", f"{GLBDIR}/{o['id']}.glb"], cwd=REPO, capture_output=True, text=True)
        if ck.returncode or not fit or not fc:
            res[n]["err3"] = "paint check failed: " + (out + ck.stdout + ck.stderr)[-400:]; log(f"{meft} {n}: {res[n]['err3']}"); save_res(W, res); continue
        c = json.loads(ck.stdout.strip().splitlines()[-1]); iou = float(fit.group(1))
        flags = []
        if c["back"]["bgPct"] is not None and c["back"]["bgPct"] > c["front"]["bgPct"] + 5: flags.append("back background > front + 5")
        if c["front"]["sat"] and c["back"]["sat"] is not None and abs(c["back"]["sat"] - c["front"]["sat"]) > 0.25 * c["front"]["sat"]: flags.append("back saturation off > 25%")
        if iou < 0.85: flags.append("IoU < 0.85")
        res[n].update(painted=True, iou=iou, pct_front=float(fc.group(1)), pct_back=float(fc.group(2)), pct_vertex=float(fc.group(3)), check=c, flags=flags)
        res[n].pop("err3", None); made += 1; save_res(W, res)
        left = re.search(r"left raw (\d+)", out)
        rows = json.load(open(CATALOGUE)); at = next((i for i, x in enumerate(rows) if x["id"] == o["id"]), None)
        if at is not None:
            rows[at]["flags"] = flags
            rows[at]["paint"] = dict(iou=iou, front=float(fc.group(1)), back=float(fc.group(2)), vertex=float(fc.group(3)), left_raw=int(left.group(1)) if left else None)
            json.dump(rows, open(CATALOGUE, "w"), indent=1); open(CATALOGUE, "a").write("\n")
        log(f"{meft} paint {n}: IoU {iou} front/back/vertex {fc.group(1)}/{fc.group(2)}/{fc.group(3)} % check {json.dumps(c)} FLAGS {flags or 'none'}")
    return made


def clean_stale_1009(objs):
    """meft1009 only, full run only: rows/glbs of the pre-P5 run that are not objects of this run are removed (backed up on I:)."""
    keep = {o["id"] for o in objs}
    rows = json.load(open(CATALOGUE))
    stale = [r for r in rows if r["id"].startswith("meft1009_") and r["id"] not in keep and not re.search(r"_(10k|5k|2k5|sf3d)$", r["id"])]
    if not stale:
        return
    bk = f"{ROOT}/backup/old_glbs_meft1009"
    os.makedirs(bk, exist_ok=True)
    for r in stale:
        g = f"{GLBDIR}/{r['id']}.glb"
        if os.path.exists(g):
            shutil.move(g, f"{bk}/{r['id']}.glb")
    json.dump([r for r in rows if r not in stale], open(CATALOGUE, "w"), indent=1)
    log(f"meft1009: removed {len(stale)} stale pre-P5 rows (glbs backed up in {bk}): {[r['id'] for r in stale]}")


def reconcile(meft, W, objs):
    """CLUT FIX, once per arena: compare the new objects with the earlier run's (OLDRUN copy). unchanged = same name + same picture,
    changed = same name, other picture, gone = no longer exists, new = did not exist. changed + gone: their fibo/mesh/results entry, gallery
    row and glb are removed here (the originals stay in the backup), so the stages make them again. Writes <W>/clutfix_changes.json."""
    import numpy as np
    from PIL import Image
    od = f"{OLDRUN}/{meft}"
    mark = f"{W}/.clutfix"
    if os.path.exists(mark) or not os.path.exists(f"{od}/objects.json"):
        return
    old = {r["obj"]: r for r in json.load(open(f"{od}/objects.json"))["objects"]}
    ch = dict(unchanged=[], changed=[], gone=[], new=[])
    for o in objs:
        n = o["obj"]
        if n not in old:
            ch["new"].append(n); continue
        a = np.asarray(Image.open(f"{od}/objects/{n}.png").convert("RGB")); b = np.asarray(Image.open(f"{W}/objects/{n}.png").convert("RGB"))
        ch["unchanged" if a.shape == b.shape and np.array_equal(a, b) else "changed"].append(n)
    ch["gone"] = [n for n in old if n not in {o["obj"] for o in objs}]
    stale = ch["changed"] + ch["gone"]
    rows = json.load(open(CATALOGUE)); res = load_res(W)
    bk_glb = f"{ROOT}/backup/before_clut_fix/glb"
    for n in stale:
        oid = f"{meft}_{n}"
        g = f"{GLBDIR}/{oid}.glb"
        if os.path.exists(g):
            assert os.path.exists(f"{bk_glb}/{oid}.glb"), f"no backup of {oid}.glb"
            os.remove(g)
        rows = [r for r in rows if r["id"] != oid]
        for x in (f"{W}/fibo/{n}.png", f"{W}/fibo/{n}_in.png", f"{W}/fibo/{n}_prompt.txt"):
            if os.path.exists(x): os.remove(x)
        shutil.rmtree(f"{W}/mesh/{n}", ignore_errors=True)
        res.pop(n, None)
        if n in ch["gone"]:
            for x in (f"{W}/objects/{n}.png",):
                if os.path.exists(x): os.remove(x)
    json.dump(rows, open(CATALOGUE, "w"), indent=1); open(CATALOGUE, "a").write("\n")
    save_res(W, res)
    json.dump(ch, open(f"{W}/clutfix_changes.json", "w"), indent=1)
    open(mark, "w").write(time.strftime("%Y-%m-%d %H:%M:%S"))
    log(f"{meft} CLUT FIX reconcile: " + ", ".join(f"{k} {len(v)}" for k, v in ch.items()) + f"; removed rows/glbs/fibo/mesh of {len(stale)}")


def stage4(meft, ctx, only):
    """Shrink the glbs made in this CLUT-fix run (new + changed objects only) to 2,500 tris with tools/shrink_glb.mjs, same rules as
    I:\\arena-objects\\shrink_all_tmp\\shrink_all.py: kept full-size when inside-out, normals agree < 90 %, saturation of a face group
    off by > 25 % or background share up by > 5. Full-size copy first to backup/before_clut_fix/new_full_glb."""
    W, objs, _, _, res = ctx
    cf = f"{W}/clutfix_changes.json"
    if not os.path.exists(cf):
        return 0
    ch = json.load(open(cf)); todo = set(ch["new"] + ch["changed"])
    made = 0
    tmp = f"{ROOT}/shrink_clutfix"; os.makedirs(tmp, exist_ok=True)
    bk = f"{ROOT}/backup/before_clut_fix/new_full_glb"; os.makedirs(bk, exist_ok=True)
    def run(cmd):
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
        if p.returncode: raise RuntimeError((p.stdout + p.stderr)[-300:])
        return json.loads(p.stdout.strip().splitlines()[-1])
    for o in selected(objs, only):
        n = o["obj"]; oid = o["id"]
        if n not in todo or "shrink" in res.get(n, {}):
            continue
        rows = json.load(open(CATALOGUE)); row = next((r for r in rows if r["id"] == oid), None)
        g = f"{GLBDIR}/{oid}.glb"
        if not row or not os.path.exists(g) or not res.get(n, {}).get("painted"):
            continue
        full = f"{bk}/{oid}.glb"
        if not os.path.exists(full): shutil.copyfile(g, full)
        try:
            s = run(["node.exe", "tools/shrink_glb.mjs", wpath(full).replace("\\", "/"), "--tris", "2500", "--out", wpath(f"{tmp}/{oid}.glb").replace("\\", "/")])
            pb = run(["node.exe", "tools/paint_check.mjs", wpath(full).replace("\\", "/")])
            pa = run(["node.exe", "tools/paint_check.mjs", wpath(f"{tmp}/{oid}.glb").replace("\\", "/")])
        except Exception as e:
            res[n]["shrink"] = dict(status="failed", why="error: " + str(e)[-200:]); save_res(W, res); log(f"{meft} shrink {n}: {res[n]['shrink']}"); continue
        why = []
        io = s["insideOut"]
        if not io["sameVolumeSign"]: why.append("inside-out (volume sign)")
        if min(io["newNormalsAgreePct"], io["oldNormalsAgreePct"]) < 90: why.append(f"normals agree {io['newNormalsAgreePct']}/{io['oldNormalsAgreePct']}")
        for k in ("front", "back", "side"):
            b, a = pb[k], pa[k]
            if b["areaPct"] >= 1 and b["sat"]:
                if a["sat"] is None or abs(a["sat"] - b["sat"]) > 0.25 * b["sat"]: why.append(f"{k} sat {b['sat']}->{a['sat']}")
            if a["bgPct"] is not None and b["bgPct"] is not None and a["bgPct"] > b["bgPct"] + 5: why.append(f"{k} bg {b['bgPct']}->{a['bgPct']}")
        info = dict(status="failed" if why else "done", why="; ".join(why), tris_before=s["trisBefore"], tris=s["tris"], dist_max_pct=s["distMaxPct"], dist_mean_pct=s["distMeanPct"])
        if not why:
            shutil.copyfile(f"{tmp}/{oid}.glb", g)
            rows = json.load(open(CATALOGUE)); row = next(r for r in rows if r["id"] == oid)
            row["tris"] = s["tris"]; row["bytes"] = os.path.getsize(g)
            json.dump(rows, open(CATALOGUE, "w"), indent=1); open(CATALOGUE, "a").write("\n")
            made += 1
        res[n]["shrink"] = info; save_res(W, res)
        log(f"{meft} shrink {n}: {info['status']} {s['trisBefore']}>{s['tris']} dist max/mean {s['distMaxPct']}/{s['distMeanPct']} {info['why']}")
    return made


# ---------------------------------------------------------------- summary
def write_summary(arenas, state, final=False):
    L = [f"SUMMARY {time.strftime('%Y-%m-%d %H:%M:%S')}  prompt {PVER}  elapsed this run {round((time.time() - T_START) / 60)} min  {'FINAL' if final else '(stage report)'}", ""]
    for k, v in state.get("stages", {}).items():
        L.append(f"stage {k}: {v}")
    L.append("")
    tot = dict(obj=0, fibo=0, mesh=0, paint=0)
    for meft in arenas:
        W = f"{ROOT}/{meft}"
        if state.get("cannot_cut", {}).get(meft):
            L.append(f"{meft}: CANNOT CUT: {state['cannot_cut'][meft]}"); continue
        if not os.path.exists(f"{W}/objects.json"):
            L.append(f"{meft}: not processed yet"); continue
        oj = json.load(open(f"{W}/objects.json")); res = load_res(W)
        objs = oj["objects"]
        nf = sum(os.path.exists(f"{W}/fibo/{o['obj']}.png") for o in objs)
        nm = sum(os.path.exists(f"{W}/mesh/{o['obj']}/mesh.obj") for o in objs)
        npnt = sum(painted(meft, o["obj"]) for o in objs)
        tot["obj"] += len(objs); tot["fibo"] += nf; tot["mesh"] += nm; tot["paint"] += npnt
        L.append(f"{meft}: pieces {oj['pieces_total']} (selected {oj['pieces_selected']}), objects {len(objs)}, FIBO pictures {nf}, meshes {nm}, painted gallery objects {npnt}, "
                 f"duplicates skipped {len(oj['dups'])}, small islands dropped {len(oj['dropped'])}")
        for o in objs:
            r = res.get(o["obj"], {})
            bad = [f"{k}: {r[k][:160]}" for k in ("err1", "err2", "err3") if r.get(k)]
            fl = r.get("flags")
            if bad or fl:
                L.append(f"    {o['obj']}: " + "; ".join(bad) + (f" FLAGS {fl}" if fl else ""))
        for d in oj["dropped"]:
            if "NO island" in d:
                L.append(f"    skipped piece: {d}")
    L.append("")
    L.append(f"TOTAL objects {tot['obj']}, FIBO pictures {tot['fibo']}, meshes {tot['mesh']}, painted {tot['paint']}")
    open(SUMMARY, "w").write("\n".join(L) + "\n")


def main():
    argv = sys.argv[1:]
    only = None
    if "--only" in argv:
        i = argv.index("--only"); only = set(argv[i + 1].split(",")); del argv[i:i + 2]
    stages = (1, 2, 3)
    if "--stage" in argv:
        i = argv.index("--stage"); stages = tuple(int(x) for x in argv[i + 1].split(",")); del argv[i:i + 2]
    allp = "--all" in argv
    full = "--full" in argv
    arenas = [a for a in argv if not a.startswith("--")]
    if full:
        m = json.load(open(f"{REPO}/web/assets/battle/arenas/manifest.json"))["byArena"]
        arenas = sorted({v["pack"] for v in m.values()})
        arenas.sort(key=lambda a: (a != "meft1009", a))
    if not arenas:
        sys.exit("usage: arena_to_gallery.py <meft> [...] | --full  [--stage 1,2,3] [--only piece,piece] [--all]")
    os.makedirs(ROOT, exist_ok=True)
    state = json.load(open(STATEF)) if os.path.exists(STATEF) else {}
    state.setdefault("stages", {}); state.setdefault("cannot_cut", {})
    log(f"##### arena_to_gallery start: {len(arenas)} arenas {arenas}, stages {stages}, only {sorted(only) if only else None}, {'--all' if allp else 'cutout+wall'}, prompt {PVER}")
    ctx = {}
    allobjs_1009 = None
    for st in stages:
        t0 = time.time()
        log(f"=== STAGE {st} START")
        total = 0
        for meft in arenas:
            if meft not in ctx:
                c = setup_arena(meft, only, allp)
                if c is None:
                    state["cannot_cut"][meft] = "arena_pieces.py failed (see log)"
                    continue
                ctx[meft] = c
            _arena_log[0] = f"{ROOT}/{meft}/log.txt"
            if st == 3 and not os.path.exists(f"{ROOT}/backup/.done_{os.getpid()}"):
                os.makedirs(f"{ROOT}/backup", exist_ok=True)
                shutil.copy(CATALOGUE, f"{ROOT}/backup/objects.json.{time.strftime('%Y%m%d_%H%M%S')}")
                open(f"{ROOT}/backup/.done_{os.getpid()}", "w").write("x")
            try:
                total += {1: stage1, 2: stage2, 3: stage3, 4: stage4}[st](meft, ctx[meft], only)
            except Exception as e:
                import traceback
                log(f"{meft} stage {st} EXCEPTION {type(e).__name__}: {e} " + traceback.format_exc()[-400:].replace("\n", " | "))
        if st == 3 and not only and "meft1009" in ctx:
            clean_stale_1009(ctx["meft1009"][1])
        dt = round(time.time() - t0)
        state["stages"][str(st)] = f"{time.strftime('%Y-%m-%d %H:%M:%S')} done, {total} items, {dt // 60} min {dt % 60} s"
        json.dump(state, open(STATEF, "w"), indent=1)
        log(f"=== STAGE {st} END: {total} items made, {dt} s")
        if st == 1:
            log("FIBO final check (end of stage 1): " + fibo_check())
        write_summary(arenas, state)
    write_summary(arenas, state, final=True)
    log(f"##### done in {round(time.time() - T_START)} s, SUMMARY at {SUMMARY}")
    log("FIBO final check: " + fibo_check())


main()
