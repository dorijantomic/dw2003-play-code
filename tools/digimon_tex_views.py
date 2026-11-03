#!/usr/bin/env python3
"""PHOTO METHOD for a battle Digimon's HD texture: render the whole posed model unlit from many views, let FIBO 2.0
Edit Turbo refine each render, bake every refined render back onto the texture (texel by texel, through the exact
UV of each pixel), keep the eye/mouth patch rectangles, pad like pad_model_textures.py.

  python3 tools/digimon_tex_views.py <model folder[,model...]|--all> [--prompt anime|refine|oneline|empty|none] [--size 1024|2048]
                                     [--poses idle,arms,mouth] [--views auto|all|parts] [--max-views 8] [--out base] [--render-only] [--no-colour-match] [--bake best|blend] [--bake-only] [--hd-src png] [--force]
  --bake-only = NO render files written, NO FIBO/ComfyUI: bake again from the existing views/fibo PNGs (needs --views all
  or the same views as the photos). Stops when a FIBO PNG is missing or a fresh render's silhouette differs from the saved
  render. Re-stitching = --bake-only (never --views auto, never --force: auto picks new views = new FIBO jobs).
  --hd-src = base texture instead of assets-hd/battle/textures/<model>.png (after an install that file is the OLD result;
  point it at the backup, e.g. ~/hd-backup/digimon-tex-<date>/<model>.png).
  --views auto (default) = tools/digimon_tex_viewpick.py picks the fewest views (<= --max-views, default 8) that cover the
  texture (greedy set cover, same bake scoring); all = the old fixed 27 views (14 idle + 9 arms + 4 mouth).
  --views parts (test) = idle pose only; every body part (bodies.json roles: head, torso, each arm/leg/wing side, tail,
  weapon, other) rendered ALONE (others hidden, no occlusion), camera fitted to the part, 4-6 directions per part by the
  same greedy scoring (digimon_tex_viewpick.pick_parts). Output goes to <out>/<model>-parts/views.
  --all skips models whose metrics.json + joined PNG exist (same size/prompt) unless --force; a failing model is
  logged and the run goes on.
  (run with node on PATH: wsl bash -ic "...")

Steps (any model, nothing model-specific):
 1. poses: tools/digimon_tex_views_mesh.mjs (the game's battle3d.js: loadSkeletalModel + buildBoneWorldMatrices +
    updateSkeletalVBO). idle = the battle idle (first frame of timeline[0]); arms = idle with the measured arm chains
    turned out (skipped when every limb stands on the floor); mouth = the played attack frame with the widest jaw
    (skipped when the head has no jaw part). Render space (x,-y,-z) like battle3d (forward = -Z, the facing law).
    Views: idle all 14 below; arms the 8 around + below; mouth the 3 head views + body front.
 2. 14 orthographic views fitted to the model's bounds: 8 around (every 45 deg, 10 deg above), top, below, one low
    front three-quarter (35 deg below; measured best 14th view on m003agum, +1.6% coverage), and 3 of the
    head (head = bone holding most triangles inside the eye patch rectangle, + its child bones; no patch: the bone
    highest/most forward). Unlit: texture colour only (HD page, bilinear, wrap), flat grey background, 896 px (0.8 MP).
    Passes per view (float16 npz on L:): u, v (256-texel page), facing |n.v|, depth, triangle id.
 3. FIBO (ComfyUI :8199, the prompt-test graph: 4 steps, cfg 1, euler/simple, seed 1234, empty negative, 1:1 size).
    Prompts = VGL JSON caption (model name from assets/battle/model_map.json, NO colour words: FIBO sees the photo).
    "anime" (default, the user's pick from the prompt test, vgl_anime): style "anime game texture", "cel-shaded, clean",
    edit_instruction "Render the image as a clean anime game texture with crisp cel shading.". "refine" (vgl_refine):
    "Refine the image to obtain increased clarity and sharpness.". "oneline", "empty" as in the prompt test.
    "none" = no FIBO, bake the plain renders (measures what the bake alone loses).
    One caption per view. Crash-safe: one int8 model per ComfyUI process (unloading one crashed 0xC0000005 in comfy_kitchen); custom
    node L:/fibo/ComfyUI/custom_nodes/dtv_cache.py. Per model: A (restart) TextEncodeFibo2 WITH the photo (the qwen3vl encoder sees
    the image, VAE encode -> reference latents) -> L:/fibo/work/cond/<model>_<view>_<key12>.pt; B (restart) UNet -> L:/fibo/work/lat/...pt;
    C (restart) VAE decode -> PNG = 3 restarts per model. key = sha1(render + prompt + seed): done files are reused.
    A failed job: restart + 1 retry. RULE: the conditioning is NEVER text only (fibo_mad 2-5 = only outlines).
 4. bake (--bake best = DEFAULT: each texel takes ONE best view = max facing x footprint among views where it is visible; no averaging,
    no colour match, only <= 1 px edge exclusion, 1-texel soft blend at region boundaries; --bake blend = the old weighted mean below).
    blend: every texel of the atlas is rasterised in UV space (texel centre, 0.5 texel tolerance, all overlapping
    triangles), projected into each view, kept when visible (depth), facing >= 0.35, and weighted by facing, pixel
    footprint (render px per atlas texel, capped 2) and distance from silhouette / depth / UV-seam edges in the render
    (0 at <= 1 px, full at >= 5 px). Each FIBO image is first colour-matched to its render (per-channel gain+offset,
    flat interior pixels). Views whose FIBO layout drifts > 1 px (phase correlation) are rejected. Texel = weighted
    mean, mixed with the current HD texel when total weight < 0.5. Eye/mouth patch rects = the HD page exactly.
 5. numbers -> views/metrics.json: coverage (per pose and combined), colour shift, edge correlation, seam jump before/after, drift per view.
Out: <out>/<model>/views/{render,fibo,joined}/ (joined/<model>.png, or <model>_2048.png), metrics.json, prompts.json;
passes and graphs in /mnt/l/fibo/work/<model>/. Writes no game file (install with tools/digimon_tex_install.py).
"""
import glob, hashlib, json, os, re, shutil, subprocess, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pad_model_textures as pad  # noqa: E402

W = pad.W
OUT_BASE = "/mnt/c/Users/dorij/Downloads/gemini-digimon"
WORK = "/mnt/l/fibo/work"
COMFY = "/mnt/l/fibo/ComfyUI"
WINPY = "/mnt/l/fibo/venv/Scripts/python.exe"
ONLY = set(os.environ.get("DTV_ONLY", "").split(",")) - {""}   # test: only these views, e.g. idle_body_y000
RES = 896          # render side: 0.80 MP
FACING_MIN = 0.35
THR = 0.5
DRIFT_MAX = 1.0
SEED = 1234
DENOISE = 1.0   # < 1 only by digimon_tex_spaced --denoise: KSampler starts from the VAE-encoded input (img2img), default graph unchanged
BG = 127
UP = np.array([0., 1., 0.])
FWD = np.array([0., 0., -1.])
VIEWS = ([("body_y%03d" % y, "body", y, 10) for y in range(0, 360, 45)]
         + [("body_top", "body", 0, 80), ("body_below", "body", 0, -80), ("body_y045_low", "body", 45, -35),
            ("head_front", "head", 0, 10), ("head_y040", "head", 40, 15), ("head_y320", "head", 320, 15)])
VIEW_WORDS = {0: "front", 45: "front three-quarter", 90: "side", 135: "back three-quarter", 180: "back",
              225: "back three-quarter", 270: "side", 315: "front three-quarter", 40: "front three-quarter",
              320: "front three-quarter"}


# ---------------------------------------------------------------- mesh, names, colours
POSE_VIEWS = {"idle": [v[0] for v in VIEWS],
              "arms": ["body_y%03d" % y for y in range(0, 360, 45)] + ["body_below"],
              "mouth": ["head_front", "head_y040", "head_y320", "body_y000"]}


def load_mesh(model, pose="idle"):
    d = f"{WORK}/{model}"
    os.makedirs(d, exist_ok=True)
    cmd = [os.environ.get("NODE") or shutil.which("node") or (sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin/node"))) or ["node"])[-1], f"{HERE}/digimon_tex_views_mesh.mjs", model, f"{d}/mesh_{pose}.json", pose]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    m = json.load(open(f"{d}/mesh_{pose}.json"))
    if m.get("skipped"):
        return m, None, None, None, None
    P = np.array(m["pos"], float).reshape(-1, 3, 3) * [1, -1, -1]
    UV = np.array(m["uv"], float).reshape(-1, 3, 2)
    return m, P, UV, np.array(m["bone"]), m["parent"]


def name_of(model):
    try:
        mm = json.load(open(f"{W}/assets/battle/model_map.json"))
    except Exception:
        return None
    names = sorted((k for k, v in mm.items() if v == model), key=lambda s: (bool(re.search(r"\d$", s)), len(s)))
    return re.sub(r"\d+$", "", names[0]) if names else None


def colour_words(rgb):
    """Top colour names of the used texels (share >= 12%), measured."""
    c = rgb.astype(float) / 255
    mx, mn = c.max(1), c.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = c.T
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    lab = np.full(len(c), "", object)
    lab[mx < 0.2] = "black"
    gr = (mx >= 0.2) & (sat < 0.18)
    lab[gr & (mx > 0.8)] = "white"
    lab[gr & (mx <= 0.8)] = "grey"
    col = (mx >= 0.2) & (sat >= 0.18)
    for name, lo, hi in [("red", 345, 360), ("red", 0, 15), ("orange", 15, 40), ("yellow", 40, 70), ("green", 70, 160),
                         ("blue", 160, 250), ("purple", 250, 300), ("pink", 300, 345)]:
        lab[col & (h >= lo) & (h < hi)] = name
    lab[col & np.isin(lab, ["orange", "red"]) & (mx < 0.55)] = "brown"
    names, cnt = np.unique(lab[lab != ""], return_counts=True)
    order = np.argsort(-cnt)
    top = [str(names[i]) for i in order[:3] if cnt[i] >= 0.12 * cnt.sum()]
    return top or ["colourful"]


def head_tris(model, UV, bone, parent, P):
    key = str(int(model[1:4])) if model[1:4].isdigit() else None
    rects = []
    for e in (pad.PLACEMENT.get(key) or {}).get("texture_anim") or []:
        x, y = e["dst"]
        rects.append((x * 4, y, x * 4 + e["size"][0] * 4, y + e["size"][1]))
    c = UV.mean(1) % 256
    hb, how = None, ""
    if rects:
        inr = np.zeros(len(c), bool)
        for x0, y0, x1, y1 in rects:
            inr |= (c[:, 0] >= x0) & (c[:, 0] < x1) & (c[:, 1] >= y0) & (c[:, 1] < y1)
        if inr.any():
            hb, how = int(np.bincount(bone[inr]).argmax()), "eye patch"
    if hb is None:                                # highest + most forward bone (by bbox units) with >= 3% of the triangles
        lo, hi = P.reshape(-1, 3).min(0), P.reshape(-1, 3).max(0)
        best = -1e9
        for b in np.unique(bone):
            m = bone == b
            if m.sum() < 0.03 * len(bone):
                continue
            q = P[m].reshape(-1, 3).mean(0)
            s = (q[1] - lo[1]) / (hi[1] - lo[1] + 1e-6) + 0.5 * (-(q[2] - hi[2])) / (hi[2] - lo[2] + 1e-6)
            if s > best:
                best, hb = s, int(b)
        how = "highest/forward bone"
    sel = {hb}
    for _ in range(len(parent)):                  # + child bones (jaw)
        sel |= {i for i, p in enumerate(parent) if p in sel}
    return np.isin(bone, list(sel)), hb, how


# ---------------------------------------------------------------- camera + raster
def camera(yaw, pitch):
    t, p = np.radians(yaw), np.radians(pitch)
    hz = np.array([-np.sin(t), 0, -np.cos(t)])
    w = np.cos(p) * hz + np.sin(p) * UP           # toward the camera
    upref = (FWD if pitch > 0 else -FWD) if abs(pitch) > 60 else UP
    r = np.cross(upref, w)
    r /= np.linalg.norm(r)
    return r, np.cross(w, r), w


def project(P, cam, fit_pts, N):
    r, u, w = cam
    fx, fy = fit_pts @ r, fit_pts @ u
    half = max(fx.max() - fx.min(), fy.max() - fy.min()) / 2 * 1.04
    cx, cy = (fx.max() + fx.min()) / 2, (fy.max() + fy.min()) / 2
    s = 2 * half / N                              # world units per pixel
    X = (P @ r - cx + half) / s
    Y = (half - (P @ u - cy)) / s
    return np.stack([X, Y], -1), P @ w, s


def raster(S2, Z, N):
    zb = np.full((N, N), -np.inf)
    tid = np.full((N, N), -1, np.int32)
    B = np.zeros((N, N, 2))
    for t in range(len(S2)):
        (x0, y0), (x1, y1), (x2, y2) = S2[t]
        area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        if abs(area) < 1e-9:
            continue
        xa, xb = max(int(np.floor(min(x0, x1, x2))), 0), min(int(np.ceil(max(x0, x1, x2))), N - 1)
        ya, yb = max(int(np.floor(min(y0, y1, y2))), 0), min(int(np.ceil(max(y0, y1, y2))), N - 1)
        if xa > xb or ya > yb:
            continue
        px, py = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        l1 = ((px - x0) * (y2 - y0) - (py - y0) * (x2 - x0)) / area
        l2 = ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) / area
        l0 = 1 - l1 - l2
        z = l0 * Z[t, 0] + l1 * Z[t, 1] + l2 * Z[t, 2]
        sub = zb[ya:yb + 1, xa:xb + 1]
        up = (l0 >= -1e-7) & (l1 >= -1e-7) & (l2 >= -1e-7) & (z > sub)
        sub[up] = z[up]
        tid[ya:yb + 1, xa:xb + 1][up] = t
        B[ya:yb + 1, xa:xb + 1][up] = np.stack([l1, l2], -1)[up]
    return zb, tid, B


def uv_samples(UV, N):
    """Every atlas texel (centre) inside each triangle in UV space (0.5 texel tolerance). Returns flat texel index,
    triangle, barycentrics (clamped), and 1 inside / 0.25 in the tolerance band."""
    T = UV * (N / 256.0)
    out = [[], [], [], []]
    for t in range(len(T)):
        (x0, y0), (x1, y1), (x2, y2) = T[t]
        area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        if abs(area) < 1e-6:
            continue
        xa, xb = int(np.floor(min(x0, x1, x2) - 1)), int(np.ceil(max(x0, x1, x2) + 1))
        ya, yb = int(np.floor(min(y0, y1, y2) - 1)), int(np.ceil(max(y0, y1, y2) + 1))
        px, py = np.meshgrid(np.arange(xa, xb) + 0.5, np.arange(ya, yb) + 0.5)
        l1 = ((px - x0) * (y2 - y0) - (py - y0) * (x2 - x0)) / area
        l2 = ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) / area
        l0 = 1 - l1 - l2
        e = [np.hypot(x2 - x1, y2 - y1), np.hypot(x2 - x0, y2 - y0), np.hypot(x1 - x0, y1 - y0)]
        tol = [-0.5 * e[i] / abs(area) for i in range(3)]
        keep = (l0 >= tol[0]) & (l1 >= tol[1]) & (l2 >= tol[2])
        if not keep.any():
            continue
        L = np.clip(np.stack([l0[keep], l1[keep], l2[keep]], -1), 0, None)
        L /= L.sum(1, keepdims=True)
        inside = (l0[keep] >= -1e-7) & (l1[keep] >= -1e-7) & (l2[keep] >= -1e-7)
        ix, iy = (px[keep] - 0.5).astype(int) % N, (py[keep] - 0.5).astype(int) % N
        out[0].append(iy * N + ix)
        out[1].append(np.full(len(ix), t, np.int32))
        out[2].append(L)
        out[3].append(np.where(inside, 1.0, 0.25))
    return np.concatenate(out[0]), np.concatenate(out[1]), np.concatenate(out[2]), np.concatenate(out[3])


def bilinear(img, x, y, wrap=False):
    H, Wd = img.shape[:2]
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    if wrap:
        X0, X1, Y0, Y1 = x0 % Wd, (x0 + 1) % Wd, y0 % H, (y0 + 1) % H
    else:
        X0, X1, Y0, Y1 = np.clip(x0, 0, Wd - 1), np.clip(x0 + 1, 0, Wd - 1), np.clip(y0, 0, H - 1), np.clip(y0 + 1, 0, H - 1)
    a = img.astype(float)
    return ((a[Y0, X0] * (1 - fx) + a[Y0, X1] * fx) * (1 - fy) + (a[Y1, X0] * (1 - fx) + a[Y1, X1] * fx) * fy)


def phase_shift(a, b):
    """shift of b relative to a (px), Hann window, sub-pixel by parabola (as prompt-test metrics.py)."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    A, B = np.fft.fft2((a - a.mean()) * win), np.fft.fft2((b - b.mean()) * win)
    R = A.conj() * B
    r = np.fft.ifft2(R / np.maximum(np.abs(R), 1e-12)).real
    iy, ix = np.unravel_index(np.argmax(r), r.shape)

    def sub(c, i, n):
        l, m0, rr = c[(i - 1) % n], c[i], c[(i + 1) % n]
        den = l - 2 * m0 + rr
        return i + (0.5 * (l - rr) / den if den != 0 else 0)
    dy, dx = sub(r[:, ix], iy, h), sub(r[iy, :], ix, w)
    if dy > h / 2:
        dy -= h
    if dx > w / 2:
        dx -= w
    return float(dx), float(dy)


def lum(a):
    return a[..., :3].astype(float) @ [0.299, 0.587, 0.114]


# ---------------------------------------------------------------- one view
def render_view(P, UV, tex, cam, fit, N, Nout):
    S2, Z, s = project(P, cam, fit, N)
    zb, tid, B = raster(S2, Z, N)
    m = tid >= 0
    t = np.where(m, tid, 0)
    l1, l2 = B[..., 0], B[..., 1]
    l0 = 1 - l1 - l2
    uv = l0[..., None] * UV[t, 0] + l1[..., None] * UV[t, 1] + l2[..., None] * UV[t, 2]
    Sh = tex.shape[0] / 256.0
    rgb = bilinear(tex[..., :3], uv[..., 0] * Sh - 0.5, uv[..., 1] * Sh - 0.5, wrap=True)
    img = np.where(m[..., None], np.clip(np.round(rgb), 0, 255), BG).astype(np.uint8)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    nl = np.linalg.norm(n, axis=1)
    facing_t = np.abs(n @ cam[2]) / np.maximum(nl, 1e-9)
    sa = np.abs((S2[:, 1, 0] - S2[:, 0, 0]) * (S2[:, 2, 1] - S2[:, 0, 1]) - (S2[:, 1, 1] - S2[:, 0, 1]) * (S2[:, 2, 0] - S2[:, 0, 0]))
    T = UV * (Nout / 256.0)
    ua = np.abs((T[:, 1, 0] - T[:, 0, 0]) * (T[:, 2, 1] - T[:, 0, 1]) - (T[:, 1, 1] - T[:, 0, 1]) * (T[:, 2, 0] - T[:, 0, 0]))
    fp_t = np.sqrt(sa / np.maximum(ua, 1e-9))    # render px per atlas texel (linear)
    # edges: silhouette, depth jump, UV jump bigger than the surface's own step
    fpm = np.where(m, fp_t[t], 1.0)
    uvo = uv * (Nout / 256.0)
    edge = np.zeros((N, N), bool)
    for ax in (0, 1):
        a = (slice(None, -1), slice(None)) if ax == 0 else (slice(None), slice(None, -1))
        b = (slice(1, None), slice(None)) if ax == 0 else (slice(None), slice(1, None))
        both = m[a] & m[b]
        duv = np.hypot(*(uvo[a] - uvo[b]).transpose(2, 0, 1))
        step = 1.0 / np.maximum(np.minimum(fpm[a], fpm[b]), 1e-3)
        with np.errstate(invalid="ignore"):
            e = (m[a] != m[b]) | (both & ((np.abs(zb[a] - zb[b]) > 4 * s) | (duv > 2.5 * step + 1.5)))
        edge[a] |= e
        edge[b] |= e
    dist = ndimage.distance_transform_edt(~edge)
    edge_w = np.clip((dist - 1) / 4, 0, 1) * m
    passes = dict(u=np.where(m, uv[..., 0] % 256 / 256, -1).astype(np.float16), v=np.where(m, uv[..., 1] % 256 / 256, -1).astype(np.float16),
                  facing=np.where(m, facing_t[t], 0).astype(np.float16), depth=np.where(m, zb, np.nan).astype(np.float32),
                  tri=tid.astype(np.int16 if len(P) < 32767 else np.int32))
    return dict(img=img, S2=S2, Z=Z, s=s, zb=zb, tid=tid, mask=m, facing=facing_t, fp=fp_t, edge_w=edge_w, passes=passes)


# ---------------------------------------------------------------- FIBO
STYLE = {"anime": ("anime game texture", "cel-shaded, clean", "Render the image as a clean anime game texture with crisp cel shading."),
         "refine": ("digital illustration, game texture", "clean, crisp, flat", "Refine the image to obtain increased clarity and sharpness.")}


def caption(name, what, view_words, mode):
    if mode == "oneline":
        return "Increase the clarity and resolution."
    if mode == "empty":
        return ""
    if mode not in STYLE:                         # "none": the text is only recorded
        mode = "anime"
    who = f"{name}, Digimon" if name else "Digimon game character"     # NEVER the Digimon's colours (FIBO sees the photo)
    return json.dumps({
        "short_description": f"{who}, game character texture render: an unlit orthographic render of the 3D game model, "
                             f"{what}, seen from the {view_words}, on a plain flat grey background. Flat painted texture colours "
                             f"with crisp dark outlines, no lighting and no shadows.",
        "objects": [{"description": f"{who}, {what}", "location": "center", "relative_size": "large within frame",
                     "shape_and_color": "flat painted shapes", "texture": "smooth, flat painted",
                     "appearance_details": "crisp dark outlines, clean flat colour areas", "relationship": "a single character",
                     "orientation": f"seen from the {view_words}"}],
        "background_setting": "plain flat grey background",
        "lighting": {"conditions": "flat even unlit render", "direction": "none, unlit", "shadows": "only the shading painted into the texture"},
        "aesthetics": {"composition": "the character fills the frame", "color_scheme": "", "mood_atmosphere": "clean, crisp"},
        "photographic_characteristics": {"depth_of_field": "deep", "focus": "sharp focus everywhere",
                                         "camera_angle": f"orthographic, {view_words} view", "lens_focal_length": "orthographic, no distortion"},
        "style_medium": STYLE[mode][0],
        "artistic_style": STYLE[mode][1],
        "context": "This is an unlit render of a 3D video game character model, used to improve its texture.",
        "edit_instruction": STYLE[mode][2],
    }, ensure_ascii=False)


MODELS = {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "fibo2_edit_turbo_int8_convrot.safetensors", "weight_dtype": "default"}},
          "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_int8_convrot.safetensors", "type": "fibo2", "device": "default"}},
          "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}}}


def graphs(img, w, h, cond, lat, prefix, seed=SEED):
    """The prompt-test graph (4 steps, cfg 1, euler/simple, empty negative) cut in runs at disk caches (dtv_cache.py), so a
    ComfyUI process never holds two int8 models and never unloads one (0xC0000005 in comfy_kitchen _handle_to).
    A = TextEncodeFibo2 with the photo (images.image_1 + vae) -> cond file; B = cond -> UNet sampling -> latent file;
    C = VAE decode -> PNG. Same node inputs as the perfect Renamon graph (m373rena idle_body_y000 PNG metadata)."""
    def A(prompt):
        return {"2": MODELS["2"], "3": MODELS["3"], "10": {"class_type": "LoadImage", "inputs": {"image": img}},
                "4": {"class_type": "TextEncodeFibo2", "inputs": {"clip": ["2", 0], "prompt": prompt, "negative_prompt": "", "vae": ["3", 0],
                      "images.image_1": ["10", 0], "width": w, "height": h, "batch_size": 1}},
                "20": {"class_type": "DTVSaveCond", "inputs": {"positive": ["4", 0], "negative": ["4", 1], "latent": ["4", 2] if DENOISE >= 1 else ["11", 0], "path": cond}},
                **({} if DENOISE >= 1 else {"11": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}}})}
    B = {"1": MODELS["1"], "21": {"class_type": "DTVLoadCond", "inputs": {"path": cond}},
         "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["21", 0], "negative": ["21", 1], "latent_image": ["21", 2],
               "seed": seed, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": DENOISE}},
         "22": {"class_type": "DTVSaveLatent", "inputs": {"samples": ["5", 0], "path": lat}}}
    C = {"3": MODELS["3"], "23": {"class_type": "DTVLoadLatent", "inputs": {"path": lat}},
         "6": {"class_type": "VAEDecode", "inputs": {"samples": ["23", 0], "vae": ["3", 0]}},
         "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}}}
    return A, B, C


def winpath(p):
    return subprocess.run(["wslpath", "-w", p], capture_output=True, text=True, check=True).stdout.strip()


CLIENT = None


def comfy(*args, timeout=None):
    global CLIENT
    CLIENT = CLIENT or winpath(f"{HERE}/digimon_tex_views_comfy.py")
    try:
        return subprocess.run([WINPY, "-I", CLIENT, *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 3, "", "client timeout")


def comfy_restart():
    comfy("kill")
    r = comfy("start", winpath(f"{WORK}/comfy.log"))
    if r.returncode:
        raise RuntimeError("ComfyUI did not start: " + r.stderr[-300:])


def fibo_key(render_png, prompt):
    return hashlib.sha1(open(render_png, "rb").read() + prompt.encode() + str(SEED).encode() + b"|cond-with-photo" + (b"" if DENOISE >= 1 else b"|dn%g" % DENOISE)).hexdigest()   # salt: lat/out caches of text-only runs are never reused


def fibo_batch(model, jobs, work, log):
    """jobs: list of dict(vname, render, prompt, out). Phase A: encode each view WITH its photo (cond/<model>_<view>_<key12>.pt).
    Then restart, B (UNet) for all, restart, C (VAE decode) for all. A failed job: restart + 1 retry; failing twice it is
    left out (reported)."""
    info = {j["vname"]: {} for j in jobs}
    if not jobs:
        return info
    for d in ("cond", "lat"):
        os.makedirs(f"{WORK}/{d}", exist_ok=True)
    os.makedirs(f"{work}/graphs", exist_ok=True)
    for j in jobs:
        j["key"] = fibo_key(j["render"], j["prompt"])
        tag = f"{model}_{j['vname']}_{j['key'][:12]}"
        j["cond"] = f"{WORK}/cond/{tag}.pt"
        j["lat"] = f"{WORK}/lat/{tag}.pt"
        j["img"] = f"dtv_{tag}.png"
        shutil.copy(j["render"], f"{COMFY}/input/{j['img']}")
        w, h = Image.open(j["render"]).size
        j["graphs"] = graphs(j["img"], w, h, winpath(j["cond"]), winpath(j["lat"]), f"texviews/{model}/{j['vname']}")
    restarts = 0

    def cond_done(j):
        return os.path.exists(j["cond"])

    def lat_done(j):
        return os.path.exists(j["lat"])

    def out_done(j):
        jp = j["out"][:-4] + ".json"
        return os.path.exists(jp) and os.path.exists(j["out"]) and json.load(open(jp)).get("key") == j["key"]

    for ph, (done, limit) in enumerate([(cond_done, 600), (lat_done, 600), (out_done, 300)]):
        todo = [j for j in jobs if not done(j) and not info[j["vname"]].get("failed")]
        if not todo:
            continue
        t0 = time.time()
        comfy_restart()
        restarts += 1
        for j in todo:
            g = f"{work}/graphs/{j['vname']}_{'ABC'[ph]}.json"
            gr = j["graphs"][ph]
            json.dump(gr(j["prompt"]) if ph == 0 else gr, open(g, "w"))
            for attempt in (1, 2):
                r = comfy("run", winpath(g), str(limit), timeout=limit + 60)
                if r.returncode == 0 and (ph == 2 or [cond_done, lat_done][ph](j)):
                    break
                msg = (r.stderr.strip().splitlines() or [""])[-1][:200]
                print(f"  FIBO phase {'ABC'[ph]} failed on {j['vname']} (attempt {attempt}): {msg}", flush=True)
                log.append(dict(view=j["vname"], phase="ABC"[ph], attempt=attempt, error=msg))
                comfy_restart()
                restarts += 1
            else:
                info[j["vname"]]["failed"] = "ABC"[ph]
                continue
            secs = json.loads(r.stdout.strip().splitlines()[-1]).get("secs") if r.stdout.strip() else None
            info[j["vname"]]["secs_" + "ABC"[ph]] = secs
            if ph == 2:
                o = json.loads(r.stdout.strip().splitlines()[-1])
                im = Image.open(os.path.join(COMFY, "output", o["subfolder"].replace("\\", "/"), o["filename"])).convert("RGB")
                if im.size != Image.open(j["render"]).size:
                    info[j["vname"]]["failed"] = f"size {im.size}"
                    continue
                im.save(j["out"])
                json.dump(dict(key=j["key"]), open(j["out"][:-4] + ".json", "w"))
        print(f"  FIBO phase {'ABC'[ph]}: {len(todo)} views in {time.time() - t0:.0f} s", flush=True)
    comfy("kill")
    info["_restarts"] = restarts
    return info


def seam_pairs(P, UV):
    edges = {}
    for t in range(len(P)):
        for i, j in ((0, 1), (1, 2), (2, 0)):
            a, b = tuple(np.round(P[t, i], 1)), tuple(np.round(P[t, j], 1))
            if a == b:
                continue
            k, fwd = ((a, b), True) if a < b else ((b, a), False)
            edges.setdefault(k, []).append((t, i, j, fwd))
    pairs = []
    for l in edges.values():
        if len(l) != 2:
            continue
        sides = []
        for t, i, j, f in l:
            e0, e1 = (UV[t, i], UV[t, j]) if f else (UV[t, j], UV[t, i])
            sides.append((t, e0, e1))
        (t1, a0, a1), (t2, b0, b1) = sides
        if max(np.abs(a0 - b0).max(), np.abs(a1 - b1).max()) > 0.5:
            pairs.append((t1, a0, a1, t2, b0, b1))
    return pairs


def seam_jump(img, pairs, UV, N):
    if not pairs:
        return None
    off = 1.5 * 256.0 / N
    s = np.linspace(0.1, 0.9, 8)[:, None]
    A, Bp = [], []
    for t1, a0, a1, t2, b0, b1 in pairs:
        for t, e0, e1, acc in ((t1, a0, a1, A), (t2, b0, b1, Bp)):
            p = e0 + s * (e1 - e0)
            d = UV[t].mean(0) - p
            d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
            acc.append(p + d * off)
    A, Bp = np.concatenate(A) * (N / 256.0) - 0.5, np.concatenate(Bp) * (N / 256.0) - 0.5
    ca = bilinear(img[..., :3], A[:, 0], A[:, 1], wrap=True)
    cb = bilinear(img[..., :3], Bp[:, 0], Bp[:, 1], wrap=True)
    return float(np.abs(ca - cb).mean())


def edge_corr(a, b, m):
    ga = np.hypot(ndimage.sobel(lum(a), 0), ndimage.sobel(lum(a), 1))[m]
    gb = np.hypot(ndimage.sobel(lum(b), 0), ndimage.sobel(lum(b), 1))[m]
    return float(np.corrcoef(ga, gb)[0, 1])


# ---------------------------------------------------------------- main
def run(model, mode="anime", size=1024, out_base=OUT_BASE, render_only=False, colour_match=True, poses=("idle", "arms", "mouth"), views="auto", max_views=8, bake="best", bake_only=False, hd_src=None):
    t_start = time.time()
    if views == "parts":                          # test mode: each body part photographed alone, idle pose only
        poses = ("idle",)
    vd = f"{out_base}/{model}{'-parts' if views == 'parts' else ''}/views"
    work = f"{WORK}/{model}"
    for d in ("render", "fibo", "joined"):
        os.makedirs(f"{vd}/{d}", exist_ok=True)
    os.makedirs(f"{work}/passes", exist_ok=True)
    hd = np.asarray(Image.open(hd_src or f"{W}/assets-hd/battle/textures/{model}.png").convert("RGBA"))
    H = hd.shape[0]
    N = size
    base = hd if N == H else np.asarray(Image.fromarray(hd).resize((N, N), Image.LANCZOS))
    prot = pad.patch_mask(model, N)
    if N != H:                                    # patch rects exactly the HD page (nearest copies)
        near = np.asarray(Image.fromarray(hd).resize((N, N), Image.NEAREST))
        base = base.copy()
        base[prot] = near[prot]
    used_raw = pad.used_mask(model, N)
    used = used_raw & ~prot
    name = name_of(model)
    sumW = np.zeros(N * N)
    sumC = np.zeros((N * N, 3))
    best_fp = np.zeros(N * N)
    bScore = np.zeros(N * N)                      # --bake best: score, colour, view id and visible fraction of the single best view
    bCol = np.zeros((N * N, 3))
    bId = np.full(N * N, -1)
    bVf = np.zeros(N * N)
    vcount = 0
    jobs, fibo_log, fibo_info = [], [], {}
    prompts, per_view, pose_info, pose_cov = {}, {}, {}, {}
    samples = None
    part_samples = {}
    P_idle = UV_idle = None
    vdef = {v[0]: v for v in VIEWS}
    import digimon_tex_viewpick as vp             # --views auto: fewest views covering the texture (tools/digimon_tex_viewpick.py)
    pv, pick_info = POSE_VIEWS, None
    if views == "auto":
        sel, pick_info = vp.pick(sys.modules[__name__], model, N, poses, cap=max_views)
        pv = {p: [v[0] for v in vs] for p, vs in sel.items()}
        vdef.update({v[0]: v for vs in sel.values() for v in vs})
    part_of, part_groups = {}, {}
    if views == "parts":
        _, P0, UV0, bone0, parent0 = load_mesh(model, "idle")
        sel, part_groups, pick_info = vp.pick_parts(sys.modules[__name__], model, P0, UV0, bone0, parent0, hd, N)
        pv = {"idle": [v[0] for vs in sel.values() for v in vs]}
        for g, vs in sel.items():
            for v in vs:
                vdef[v[0]] = v
                part_of[v[0]] = g
    if bake_only and (views == "auto" or mode == "none" or render_only):
        raise SystemExit("--bake-only needs --views all, a FIBO prompt mode and no --render-only")
    stages = ["bake"] if bake_only else ["render"] + ([] if render_only else ["bake"])
    for stage in stages:   # render all views, FIBO them in 3 phases, then bake (--bake-only: bake only, never FIBO)
        if stage == "bake" and jobs and not bake_only:
            fibo_info = fibo_batch(model, jobs, work, fibo_log)
        for pose in poses:
            m, P, UV, bone, parent = load_mesh(model, pose)
            if P is None:
                pose_info[pose] = dict(skipped=True, refused=m.get("refused"))
                if stage == "render":
                    print(f"  pose {pose}: skipped ({'; '.join(m.get('refused') or [])})", flush=True)
                continue
            if samples is None:
                samples = uv_samples(UV, N)
            ti, tt, tl, tw = samples
            if pose == "idle":
                P_idle, UV_idle = P, UV
            hm, hb, how = head_tris(model, UV, bone, parent, P)
            pose_info[pose] = dict(m.get("info") or {}, frame=m["frame"], views_head_bone=hb, views_head_by=how)
            allv, headv = P.reshape(-1, 3), P[hm].reshape(-1, 3)
            poseW = np.zeros(N * N)
            for short in pv.get(pose, []):
                _, kind, yaw, pitch = vdef[short]
                vname = f"{pose}_{short}"
                if ONLY and vname not in ONLY:
                    continue
                cam = camera(yaw, pitch)
                if kind == "part":                # only this part's triangles: others hidden (no occlusion), camera fitted to it
                    pm = part_groups[part_of[short]][0]
                    Pv, UVv = P[pm], UV[pm]
                    ti, tt, tl, tw = part_samples.setdefault(part_of[short], uv_samples(UVv, N))
                    R = render_view(Pv, UVv, hd, cam, Pv.reshape(-1, 3), RES, N)
                else:
                    ti, tt, tl, tw = samples
                    R = render_view(P, UV, hd, cam, headv if kind == "head" else allv, RES, N)
                rp = f"{vd}/render/{vname}.png"
                if stage == "render":
                    Image.fromarray(R["img"]).save(rp)
                    np.savez_compressed(f"{work}/passes/{vname}.npz", **R["passes"])
                what = ("head and face close-up" if kind == "head" else
                        f"close-up of only the {part_groups[part_of[short]][1]}" if kind == "part" else "full body")
                if pose == "mouth":
                    what += " with the mouth open"
                vw = "top" if pitch > 60 else "underside" if pitch < -60 else (VIEW_WORDS[yaw] if yaw in VIEW_WORDS and abs(pitch) <= 15 else vp.words(yaw, pitch))
                prompts[vname] = caption(name, what, vw, mode)
                info = dict(pose=pose, kind=kind, yaw=yaw, pitch=pitch, px_per_world=round(1 / R["s"], 4))
                if kind == "part":
                    info["part"] = part_of[short]
                if stage == "render":
                    if render_only:
                        per_view[vname] = info
                    elif mode != "none":
                        jobs.append(dict(vname=vname, render=rp, prompt=prompts[vname], out=f"{vd}/fibo/{vname}.png"))
                    continue
                if mode == "none":
                    gen = R["img"].astype(float)
                else:
                    fo = f"{vd}/fibo/{vname}.png"
                    info.update(fibo_info.get(vname, {}))
                    if info.get("failed") or not os.path.exists(fo):
                        if bake_only:
                            raise SystemExit(f"--bake-only: no FIBO photo {fo}, stop (bake-only never makes new photos)")
                        info["rejected"] = True
                        per_view[vname] = info
                        print(f"  {vname}: no FIBO image (failed phase {info.get('failed')}), left out", flush=True)
                        continue
                    gen = np.asarray(Image.open(fo).convert("RGB")).astype(float)
                if bake_only:                     # the photo must belong to this exact view: same silhouette as the saved render
                    if not os.path.exists(rp):
                        raise SystemExit(f"--bake-only: no saved render {rp}, stop")
                    old = (np.asarray(Image.open(rp).convert("RGB")) != BG).any(2)
                    xor = int((old ^ (R["img"] != BG).any(2)).sum())
                    info["silhouette_xor_px"] = xor
                    if xor > 0.001 * max(int(old.sum()), 1):
                        raise SystemExit(f"--bake-only: {vname} silhouette differs from the saved render by {xor} px, stop")
                dx, dy = phase_shift(lum(R["img"]), lum(gen))
                info["drift_px"] = round(float(np.hypot(dx, dy)), 3)
                info["drift_dxdy"] = [round(dx, 3), round(dy, 3)]
                inner = R["mask"] & (R["edge_w"] >= 1)
                info["fibo_shift_rgb"] = [round(float(v), 2) for v in (gen[inner] - R["img"][inner]).mean(0)]
                info["fibo_mad"] = round(float(np.abs(gen[inner] - R["img"][inner]).mean()), 2)
                if bake == "blend" and colour_match and mode != "none" and inner.sum() > 100:
                    g2 = gen.copy()
                    for c in range(3):
                        x, y = gen[inner][:, c], R["img"][inner][:, c].astype(float)
                        a = np.clip(np.cov(x, y)[0, 1] / max(np.var(x), 1e-6), 0.8, 1.25)
                        g2[..., c] = a * gen[..., c] + (y.mean() - a * x.mean())
                    gen = np.clip(g2, 0, 255)
                info["rejected"] = bool(info["drift_px"] > DRIFT_MAX)
                # bake: project every texel sample into this view
                sx = (tl * R["S2"][tt, :, 0]).sum(1)
                sy = (tl * R["S2"][tt, :, 1]).sum(1)
                sz = (tl * R["Z"][tt]).sum(1)
                ix, iy = np.floor(sx).astype(int), np.floor(sy).astype(int)
                inb = (ix >= 0) & (iy >= 0) & (ix < RES) & (iy < RES)
                ixc, iyc = np.clip(ix, 0, RES - 1), np.clip(iy, 0, RES - 1)
                fac = R["facing"][tt]
                vis = inb & R["mask"][iyc, ixc] & (sz >= R["zb"][iyc, ixc] - 3 * R["s"]) & (fac >= FACING_MIN)
                w = (np.clip((fac - FACING_MIN) / (1 - FACING_MIN), 0, 1) * np.clip(R["fp"][tt], 0, 2) * R["edge_w"][iyc, ixc] * tw * vis)
                texw = np.bincount(ti, weights=w, minlength=N * N)
                info["texels_weighted"] = int(((texw > 0) & used.ravel()).sum())
                if not info["rejected"] and bake == "best":
                    okp = vis & (R["edge_w"][iyc, ixc] > 0)           # only <= 1 px at silhouette/depth/seam edges excluded
                    w1 = (np.clip((fac - FACING_MIN) / (1 - FACING_MIN), 0, 1) * np.clip(R["fp"][tt], 0, 2) * tw * okp)
                    sc = np.bincount(ti, weights=w1, minlength=N * N)
                    vf = np.bincount(ti, weights=tw * okp, minlength=N * N) / np.maximum(np.bincount(ti, weights=tw, minlength=N * N), 1e-9)
                    col1 = bilinear(gen, sx - 0.5, sy - 0.5)
                    cm = np.stack([np.bincount(ti, weights=w1 * col1[:, c], minlength=N * N) for c in range(3)], 1) / np.maximum(sc, 1e-9)[:, None]
                    upd = (sc > bScore) & (vf >= 0.25)
                    bScore[upd], bCol[upd], bVf[upd], bId[upd] = sc[upd], cm[upd], vf[upd], vcount
                    vcount += 1
                    good = w > 0
                    np.maximum.at(best_fp, ti[good], R["fp"][tt][good])
                    sumW += texw
                    poseW += texw
                elif not info["rejected"]:
                    good = w > 0
                    np.maximum.at(best_fp, ti[good], R["fp"][tt][good])
                    col = bilinear(gen, sx - 0.5, sy - 0.5)
                    sumW += texw
                    poseW += texw
                    for c in range(3):
                        sumC[:, c] += np.bincount(ti, weights=w * col[:, c], minlength=N * N)
                per_view[vname] = info
                print(f"  {vname}: drift {info['drift_px']} px{' REJECTED' if info['rejected'] else ''}, "
                      f"texels {info['texels_weighted']}, FIBO MAD {info['fibo_mad']}", flush=True)
            if stage == "bake":
                pw = poseW.reshape(N, N)
                pose_cov[pose] = round(100 * float((pw[used] >= THR).mean()), 2)
    if not bake_only:
        json.dump(prompts, open(f"{vd}/prompts.json", "w"), indent=1, ensure_ascii=False)
    if render_only:
        json.dump(dict(model=model, poses=pose_info, views=per_view), open(f"{vd}/metrics.json", "w"), indent=1)
        print(f"{model}: {len(per_view)} renders -> {vd}/render")
        return
    sumW, sumC, best_fp = sumW.reshape(N, N), sumC.reshape(N, N, 3), best_fp.reshape(N, N)
    fibo_pct = None
    if bake == "best":
        bid = bId.reshape(N, N)
        col = bCol.reshape(N, N, 3).copy()
        has = bid >= 0
        a = np.clip(bVf.reshape(N, N) / 0.5, 0, 1)[..., None] * has[..., None]
        # soft seam: 1 texel each side of a boundary between two views' regions gets a 3x3 mean of the texels that have a view
        mx = ndimage.maximum_filter(np.where(has, bid, -1), 3)
        mn = ndimage.minimum_filter(np.where(has, bid, 10 ** 9), 3)
        bnd = has & (mx != mn)
        hf = has.astype(float)
        den = ndimage.uniform_filter(hf, 3)
        for c in range(3):
            sm = ndimage.uniform_filter(col[..., c] * hf, 3) / np.maximum(den, 1e-9)
            col[..., c] = np.where(bnd, sm, col[..., c])
        mean = col
        fibo_pct = dict(texels_from_fibo_pct=round(100 * float((has & used).sum() / used.sum()), 2),
                        texels_fully_fibo_pct=round(100 * float(((a[..., 0] >= 1) & used).sum() / used.sum()), 2),
                        texels_upscale_only_pct=round(100 * float((~has & used).sum() / used.sum()), 2),
                        seam_blend_texels=int((bnd & used).sum()), views_used=int(len(np.unique(bid[has & used]))))
    else:
        a = np.clip(sumW / THR, 0, 1)[..., None]
        mean = sumC / np.maximum(sumW, 1e-9)[..., None]
    out = base.copy()
    rgb = a * mean + (1 - a) * base[..., :3]
    out[..., :3] = np.where(used[..., None], np.clip(np.round(rgb), 0, 255), base[..., :3]).astype(np.uint8)
    out[prot] = base[prot]
    k = max(1, N // 1024)                          # pad like pad_model_textures.py
    usedp = used_raw | prot
    dist, (iy, ix) = ndimage.distance_transform_edt(~usedp, return_indices=True)
    fill = (~usedp) & (dist <= pad.PAD * k)
    out[fill] = out[iy[fill], ix[fill]]
    sfx = "" if mode != "none" else "_none"
    dst = f"{vd}/joined/{model}{sfx}.png" if N == 1024 else f"{vd}/joined/{model}{sfx}_{N}.png"
    Image.fromarray(out, "RGBA").save(dst)
    pairs = seam_pairs(P_idle, UV_idle) if P_idle is not None else []
    bf = best_fp[used & (best_fp > 0)]
    met = dict(model=model, name=name, mode=mode, views_mode=views, views_pick=pick_info, size=N, bake=bake, bake_only=bake_only, hd_src=hd_src, fibo_share=fibo_pct, colour_match=colour_match, poses=pose_info,
               used_texels=int(used.sum()), patch_texels=int(prot.sum()),
               coverage_good_pct_by_pose=pose_cov,
               coverage_good_pct=round(100 * float((sumW[used] >= THR).mean()), 2),
               coverage_any_pct=round(100 * float((sumW[used] > 0).mean()), 2),
               px_per_native_texel_median=round(float(np.median(bf)) * N / 256, 2) if len(bf) else None,
               px_per_atlas_texel_median=round(float(np.median(bf)), 3) if len(bf) else None,
               colour_shift_rgb=[round(float(v), 2) for v in (out[used][:, :3].astype(float) - base[used][:, :3]).mean(0)],
               mad_vs_hd=round(float(np.abs(out[used][:, :3].astype(float) - base[used][:, :3]).mean()), 2),
               edge_corr_vs_hd=round(edge_corr(out, base, used), 4),
               seam_edges=len(pairs),
               seam_jump_before=round(seam_jump(base, pairs, UV_idle, N) or 0, 2),
               seam_jump_after=round(seam_jump(out, pairs, UV_idle, N) or 0, 2),
               patch_rects_identical=bool((out[prot] == base[prot]).all()),
               views_rejected=[v for v, i in per_view.items() if i.get("rejected")],
               drift_px_max=max((i["drift_px"] for i in per_view.values() if "drift_px" in i), default=None),
               fibo_failed=[v for v, i in per_view.items() if i.get("failed")],
               fibo_comfy_restarts=fibo_info.get("_restarts", 0), fibo_errors=fibo_log,
               secs=round(time.time() - t_start, 1), out=dst, views=per_view)
    json.dump(met, open(f"{vd}/metrics{sfx}.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in met.items() if k != "views"}))
    return met


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    mode = opt("--prompt", "anime")
    if mode not in ("anime", "refine", "oneline", "empty", "none"):
        sys.exit("--prompt anime|refine|oneline|empty|none")
    size = int(opt("--size", 1024))
    if size not in (1024, 2048):
        sys.exit("--size 1024|2048")
    poses = tuple(opt("--poses", "idle,arms,mouth").split(","))
    if not set(poses) <= set(POSE_VIEWS):
        sys.exit("--poses from idle,arms,mouth")
    views = opt("--views", "auto")
    if views not in ("auto", "all", "parts"):
        sys.exit("--views auto|all|parts")
    max_views = int(opt("--max-views", 8))
    bake = opt("--bake", "best")
    if bake not in ("best", "blend"):
        sys.exit("--bake best|blend")
    bake_only = "--bake-only" in a
    hd_src = opt("--hd-src")
    if bake_only and (views not in ("all", "parts") or "--force" in a or "--render-only" in a or mode == "none"):
        sys.exit("--bake-only needs --views all, no --force, no --render-only, a FIBO prompt mode")
    if hd_src and not os.path.exists(hd_src):
        sys.exit("--hd-src not found: " + hd_src)
    names = (sorted(n for n in os.listdir(f"{W}/assets-hd/battle/textures") if n.endswith(".png"))
             if a[0] == "--all" else [os.path.basename(x.rstrip("/")) for x in a[0].split(",")])
    for n in names:
        n = n[:-4] if n.endswith(".png") else n
        if not os.path.exists(f"{W}/assets/battle/models/{n}/anim.json"):
            print(n, "skipped (no model)")
            continue
        out_base = opt("--out", OUT_BASE)
        sfx = "" if mode != "none" else "_none"
        mp = f"{out_base}/{n}{'-parts' if views == 'parts' else ''}/views/metrics{sfx}.json"
        if "--force" not in a and "--render-only" not in a and not bake_only and os.path.exists(mp):      # skip models already done
            try:
                old = json.load(open(mp))
                if old.get("out") and os.path.exists(old["out"]) and old.get("size") == size and old.get("mode") == mode and old.get("bake", "blend") == bake:
                    print(n, "skipped (done:", old["out"] + ")", flush=True)
                    continue
            except Exception:
                pass
        print(n, flush=True)
        try:
            run(n, mode, size, out_base, "--render-only" in a, "--no-colour-match" not in a, poses, views, max_views, bake, bake_only, hd_src)
        except Exception as e:                    # overnight --all: note it, make sure ComfyUI is down, go on
            import traceback
            traceback.print_exc()
            print(n, "FAILED:", repr(e)[:300], flush=True)
            if mode != "none" and "--render-only" not in a and not bake_only:
                comfy("kill")
