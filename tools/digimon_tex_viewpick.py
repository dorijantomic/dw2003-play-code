#!/usr/bin/env python3
"""SMART PHOTO PICKING for tools/digimon_tex_views.py (`--views auto`, the default; `--views all` = the old fixed set).

  python3 tools/digimon_tex_viewpick.py <model[,model...]> [--size 1024]      (numbers only, no FIBO)

Method (nothing model-specific):
 1. Candidates per pose: the 14 old views (8 around at 10 deg, top, below, low, 3 head) + the 26 directions of a cube
    (6 axis, 12 edge, 8 corner; the ones the old set lacks) + 3 more head views. All rendered with the tool's own
    render_view (no FIBO). Poses: idle, arms, mouth (the ones the model has).
 2. Score: for every candidate the SAME rule as the bake: texel sample visible by depth, facing >= 0.35, weight
    = facing * pixel footprint (cap 2) * edge distance; a texel is "good" when its summed weight >= THR (0.5).
    The greedy gain is the clipped weight sum(min(S,THR)) / THR (submodular; texels needing two views still count).
 3. Greedy set cover over all candidates of all poses: take the one that turns the most texels good, then the one adding
    the most new good texels (summed weights across the picked views, like the bake). Stop when the next adds < 1% of
    the used texels or 8 views. Idle wins ties, so arms/mouth views enter only when they add >= 1%.
 4. Mirrors: a texel hit from the left and the right side (shared/mirrored UV islands) is simply covered once: coverage is
    counted per TEXEL, so a side whose texels are already good needs no view of its own. Asymmetric models (a `weapon` role
    bone, or different left/right bone counts in ~/dw3-knowledge/bodies.json) get the mirror yaw of every picked side view
    added (cap 8 + those mirrors).
Returns ({pose: [(short, kind, yaw, pitch), ...]}, stats); stats include the old-27 coverage with the same scoring.
The caller passes the digimon_tex_views module as V (no import cycle).
"""
import json, os, sys, time
import numpy as np

CAP = 8
MIN_GAIN = 0.01
BODIES = os.path.expanduser("~/dw3-knowledge/bodies.json")


def dirs26():
    return [(x, y, z) for x in (-1, 0, 1) for y in (-1, 0, 1) for z in (-1, 0, 1) if x or y or z]


def dir_to_view(d):
    """direction toward the camera (camera() convention: yaw 0 = (0,0,-1)) -> (yaw, pitch)."""
    x, y, z = np.array(d, float) / np.linalg.norm(d)
    if abs(x) < 1e-9 and abs(z) < 1e-9:
        return 0, 80 if y > 0 else -80
    yaw = int(round(np.degrees(np.arctan2(-x, -z)))) % 360
    pitch = int(round(np.degrees(np.arcsin(y))))
    return yaw, (10 if pitch == 0 else pitch)       # horizontal ones keep the old 10 deg


def candidates(V):
    cands = list(V.VIEWS)
    have = {(y, p) for (_, _, y, p) in cands}
    for d in dirs26():
        yaw, pitch = dir_to_view(d)
        if (yaw, pitch) not in have:
            have.add((yaw, pitch))
            cands.append(("c_y%03d_p%+03d" % (yaw, pitch), "body", yaw, pitch))
    for yaw, pitch in ((90, 15), (270, 15), (0, 50)):
        if (yaw, pitch) not in have:
            cands.append(("head_y%03d_p%+03d" % (yaw, pitch), "head", yaw, pitch))
    return cands


def words(yaw, pitch=0):
    a = min(yaw % 360, 360 - yaw % 360)
    w = "front" if a < 22.5 else "front three-quarter" if a < 67.5 else "side" if a < 112.5 else "back three-quarter" if a < 157.5 else "back"
    return w + (", seen from above" if 30 <= pitch <= 60 else ", seen from below" if -60 <= pitch <= -30 else "")


def asym_info(model):
    try:
        b = json.load(open(BODIES))["models"][model]
    except Exception:
        return dict(asymmetric=False, why="no bodies.json entry", sides={})
    bl = b.get("boneList") or []
    wp = [x["i"] for x in bl if x.get("r") == "weapon"]
    nl, nr = sum(x.get("s") == "L" for x in bl), sum(x.get("s") == "R" for x in bl)
    why = ([f"weapon bones {wp}"] if wp else []) + ([f"L/R bone counts {nl}/{nr}"] if nl != nr else [])
    return dict(asymmetric=bool(why), why="; ".join(why) or "symmetric", sides={x["i"]: x.get("s") for x in bl})


def view_weights(V, R, samples):
    """per-sample weight of one rendered view: the bake's rule, copied from digimon_tex_views.run."""
    ti, tt, tl, tw = samples
    sx = (tl * R["S2"][tt, :, 0]).sum(1)
    sy = (tl * R["S2"][tt, :, 1]).sum(1)
    sz = (tl * R["Z"][tt]).sum(1)
    ix, iy = np.floor(sx).astype(int), np.floor(sy).astype(int)
    inb = (ix >= 0) & (iy >= 0) & (ix < V.RES) & (iy < V.RES)
    ixc, iyc = np.clip(ix, 0, V.RES - 1), np.clip(iy, 0, V.RES - 1)
    fac = R["facing"][tt]
    vis = inb & R["mask"][iyc, ixc] & (sz >= R["zb"][iyc, ixc] - 3 * R["s"]) & (fac >= V.FACING_MIN)
    w = (np.clip((fac - V.FACING_MIN) / (1 - V.FACING_MIN), 0, 1) * np.clip(R["fp"][tt], 0, 2) * R["edge_w"][iyc, ixc] * tw * vis)
    return ti, w


def pick(V, model, N=1024, poses=("idle", "arms", "mouth"), log=print, cap=CAP, min_gain=MIN_GAIN):
    t0 = time.time()
    hd = np.asarray(V.Image.open(f"{V.W}/assets-hd/battle/textures/{model}.png").convert("RGBA"))
    prot = V.pad.patch_mask(model, N)
    used = (V.pad.used_mask(model, N) & ~prot).ravel()
    nused = int(used.sum())
    cands = candidates(V)
    old = {p: set(V.POSE_VIEWS[p]) for p in V.POSE_VIEWS}
    ai = asym_info(model)
    store = []                                    # (pose, view, texel idx, summed weight)
    samples, pose_ok, mirror_pct = None, [], None
    for pose in poses:
        m, P, UV, bone, parent = V.load_mesh(model, pose)
        if P is None:
            continue
        pose_ok.append(pose)
        if samples is None:
            samples = V.uv_samples(UV, N)
        hm, _, _ = V.head_tris(model, UV, bone, parent, P)
        allv, headv = P.reshape(-1, 3), P[hm].reshape(-1, 3)
        for v in cands:
            n, kind, yaw, pitch = v
            R = V.render_view(P, UV, hd, V.camera(yaw, pitch), headv if kind == "head" else allv, V.RES, N)
            ti, w = view_weights(V, R, samples)
            texw = np.bincount(ti, weights=w, minlength=N * N)
            idx = np.nonzero((texw > 0) & used)[0]
            store.append((pose, v, idx, texw[idx].astype(np.float32)))
        if pose == "idle":                        # texels hit by both a left and a right bone = shared/mirrored UV
            sd = np.array([{"L": 1, "R": 2}.get(ai["sides"].get(int(b)), 0) for b in bone], np.int8)[samples[1]]
            hit = np.zeros(N * N, np.int8)
            np.bitwise_or.at(hit, samples[0], sd)
            mirror_pct = round(100 * float((hit[used] == 3).mean()), 2)
    t_render = time.time() - t0
    t1 = time.time()

    def cov(sel):
        S = np.zeros(N * N, np.float32)
        for _, _, idx, val in sel:
            S[idx] += val
        return S

    def good(S):
        return 100 * float((S[used] >= V.THR).mean())
    oldsel = [s for s in store if s[1][0] in old[s[0]]]
    cov_old = good(cov(oldsel))
    S = np.zeros(N * N, np.float32)
    chosen, steps = [], []
    while len(chosen) < cap:
        best, bg, bs = None, 0.0, 0.0
        for k, (pose, v, idx, val) in enumerate(store):
            if k in chosen:
                continue
            s0 = S[idx]
            g = float((np.minimum(s0 + val, V.THR) - np.minimum(s0, V.THR)).sum()) / V.THR   # clipped weight: texels that need 2 views still count
            if g + (0.5 if pose == "idle" else 0) > bs:
                best, bg, bs = k, g, g + (0.5 if pose == "idle" else 0)
        if best is None or bg < min_gain * nused:
            break
        chosen.append(best)
        S[store[best][2]] += store[best][3]
        steps.append((f"{store[best][0]}_{store[best][1][0]}", round(100 * bg / nused, 2), round(good(S), 2)))
    mirrors = []
    if ai["asymmetric"]:                          # keep both sides: add the mirror yaw of every picked side view
        for k in list(chosen):
            pose, (n, kind, yaw, pitch), _, _ = store[k]
            if kind == "body" and abs(np.sin(np.radians(yaw))) > 0.3:
                my = (360 - yaw) % 360
                kk = next((j for j, s in enumerate(store) if s[0] == pose and s[1][1] == kind and s[1][2] == my and s[1][3] == pitch), None)
                if kk is not None and kk not in chosen:
                    chosen.append(kk)
                    mirrors.append(f"{pose}_{store[kk][1][0]}")
    cov_auto = good(cov([store[k] for k in chosen]))
    sel = {p: [] for p in pose_ok}
    for k in chosen:
        sel[store[k][0]].append(store[k][1])
    info = dict(model=model, picked=[f"{store[k][0]}_{store[k][1][0]}" for k in chosen], n=len(chosen), steps=steps,
                added_mirrors=mirrors, asym=ai["why"], mirror_shared_uv_pct=mirror_pct,
                coverage_good_auto=round(cov_auto, 2), coverage_good_old=round(cov_old, 2), old_views=len(oldsel),
                candidates=len(store), secs_render=round(t_render, 1), secs_pick=round(time.time() - t1, 1))
    log(json.dumps(info))
    return sel, info


# ---------------------------------------------------------------- --views parts: one photo set per body part
ROLE_GROUP = {"head": "head", "neck": "head", "jaw": "head", "horn": "head", "mane": "head",
              "torso": "torso", "hips": "torso", "root": "torso", "body": "torso",
              "shoulder": "arm", "upper-arm": "arm", "forearm": "arm", "hand": "arm",
              "thigh": "leg", "shin": "leg", "foot": "leg", "toe": "leg",
              "wing-root": "wing", "wing-seg": "wing", "wing-tip": "wing",
              "tail-base": "tail", "tail-seg": "tail", "tail-tip": "tail", "weapon": "weapon"}
SIDED = {"arm", "leg", "wing", "weapon"}
# hub, ornament, shell, cape, marker, tentacle: take the group of the nearest mapped ancestor (torso, else "other")


def part_groups(model, bone, parent):
    """{part name: (triangle mask, label)} from ~/dw3-knowledge/bodies.json roles (nothing model-specific).
    No bodies.json entry: one part 'body'."""
    try:
        bl = {x["i"]: x for x in json.load(open(BODIES))["models"][model]["boneList"]}
    except Exception:
        return {"body": (np.ones(len(bone), bool), "whole body")}, {}

    def grp(i):
        x = bl.get(i)
        if x is None:
            return "other"
        r = x.get("r")
        if r in ("fx", "fx-hub"):
            return "other"
        g = ROLE_GROUP.get(r)
        if g is None:                             # inherit from the nearest mapped ancestor
            p = parent[i] if i < len(parent) else -1
            return grp(p) if p is not None and p >= 0 else "torso"
        if g in SIDED and x.get("s") in ("L", "R"):
            g += "_" + x["s"]
        return g
    bg = {i: grp(i) for i in bl}
    parts = {}
    for b in np.unique(bone):
        parts.setdefault(bg.get(int(b), "other"), []).append(int(b))
    out = {}
    for g, bones in parts.items():
        base, _, s = g.partition("_")
        n_end = sum(bl[b].get("r") in ("hand", "foot", "wing-tip", "weapon") for b in bones if b in bl)
        noun = {"head": "head", "torso": "torso and body", "arm": "arm", "leg": "leg", "wing": "wing", "tail": "tail",
                "weapon": "weapon", "other": "other parts", "body": "whole body"}.get(base, base)
        if base in ("arm", "leg", "wing") and n_end > 1:
            noun += "s"
        label = ({"L": "left ", "R": "right "}.get(s, "")) + noun
        out[g] = (np.isin(bone, bones), label)
    return out, {g: sorted(b) for g, b in parts.items()}


def pick_parts(V, model, P, UV, bone, parent, tex, N=1024, cap=6, min_views=4, min_gain=MIN_GAIN, log=print):
    """Per part: render ONLY that part (others hidden, no occlusion), camera fitted to the part's bounds, from the
    candidate directions (8 around, top, below, low + cube directions); greedy set cover with the bake's own weights
    on the part's texels: at least min_views (while a view adds anything), at most cap, stop below min_gain.
    Returns ({part: [(short, 'part', yaw, pitch)]}, {part: (tri mask, label)}, stats)."""
    t0 = time.time()
    prot = V.pad.patch_mask(model, N)
    used = (V.pad.used_mask(model, N) & ~prot).ravel()
    groups, gbones = part_groups(model, bone, parent)
    cands = [c for c in candidates(V) if c[1] == "body"]
    sel, stats = {}, {}
    for g, (mask, label) in groups.items():
        Pp, UVp = P[mask], UV[mask]
        smp = V.uv_samples(UVp, N)
        pused = np.zeros(N * N, bool)
        pused[smp[0]] = True
        pused &= used
        npu = int(pused.sum())
        if npu == 0:
            stats[g] = dict(label=label, bones=gbones.get(g), tris=int(mask.sum()), texels=0, picked=[])
            continue
        store = []
        for (short, _, yaw, pitch) in cands:
            R = V.render_view(Pp, UVp, tex, V.camera(yaw, pitch), Pp.reshape(-1, 3), V.RES, N)
            ti, w = view_weights(V, R, smp)
            texw = np.bincount(ti, weights=w, minlength=N * N)
            idx = np.nonzero((texw > 0) & pused)[0]
            store.append(((yaw, pitch), idx, texw[idx].astype(np.float32)))
        S = np.zeros(N * N, np.float32)
        chosen, steps = [], []
        while len(chosen) < cap:
            best, bg = None, 0.0
            for k, (_, idx, val) in enumerate(store):
                if k in chosen:
                    continue
                s0 = S[idx]
                gg = float((np.minimum(s0 + val, V.THR) - np.minimum(s0, V.THR)).sum()) / V.THR
                if gg > bg:
                    best, bg = k, gg
            if best is None or bg <= 0 or (len(chosen) >= min_views and bg < min_gain * npu):
                break
            chosen.append(best)
            S[store[best][1]] += store[best][2]
            steps.append(round(100 * bg / npu, 2))
        sel[g] = [("%s_y%03d_p%+03d" % (g, store[k][0][0], store[k][0][1]), "part", store[k][0][0], store[k][0][1]) for k in chosen]
        stats[g] = dict(label=label, bones=gbones.get(g), tris=int(mask.sum()), texels=npu, picked=[v[0] for v in sel[g]],
                        gain_pct=steps, coverage_good_pct=round(100 * float((S[pused] >= V.THR).mean()), 2))
    info = dict(model=model, parts=len(sel), photos=sum(len(v) for v in sel.values()), per_part=stats, secs=round(time.time() - t0, 1))
    log(json.dumps(info))
    return sel, groups, info


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import digimon_tex_views as V
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    size = int(a[a.index("--size") + 1]) if "--size" in a else 1024
    for mdl in a[0].split(","):
        pick(V, mdl, size, cap=int(os.environ.get('VP_CAP', CAP)), min_gain=float(os.environ.get('VP_MIN', MIN_GAIN)))
