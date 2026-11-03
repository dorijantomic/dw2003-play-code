#!/usr/bin/env python3
"""SPACED ATLAS METHOD for a battle Digimon's HD texture: the UV islands of the ORIGINAL HD page are packed (same texel
scale, no rotation) on a flat key-colour sheet with gaps, FIBO 2.0 Edit Turbo refines the whole sheet once, and only the
island texels (mask shrunk 2 px) go back into the original page. Alpha and every other texel stay the original.

  python3 tools/digimon_tex_spaced.py <model> [--prompt A|B|"text"] [--tag spaced-A] [--src png] [--out base]
                                      [--metrics-only] [--keep-work] [--outdir dir] [--presmooth SS,SR] [--scale X]
  --prompt A = "Refine the image to obtain increased clarity and sharpness."  (default B)
           B = "Refine the image with crisp clean lines and clearer detail."
  --src     default = the earliest ~/hd-backup/digimon-tex-*/<model>.png (the page before the first FIBO install), else
            web/assets-hd/battle/textures/<model>.png when no FIBO install backup exists (install always backs up first).
  --metrics-only = recompute metrics from an existing out folder (sheets + packing_map.json), no FIBO; --metrics-file path
            writes them elsewhere (default <out>/metrics.json).
  Streak-test options (all default off; without them the behaviour is identical):
  --prompt "any text" = own prompt text (already worked: a key that is not A/B is the text). Give --tag too.
  --prompt-json FILE  = VGL JSON caption read from FILE, sent as one compact JSON string (fibo2.parse_prompt reads JSON). Default off.
  --outdir dir        = write the sheets/result/metrics exactly in dir instead of <out>/<model>-atlas/<tag>.
  --presmooth SS,SR   = the SHEET INPUT only is smoothed per island with a masked bilateral filter (spatial sigma SS texels,
                        radius 2*SS, range sigma SR in RGB units) before packing, to remove the 4-texel steps; the result is
                        still unpacked into the ORIGINAL page and MAD is vs the original.
  --deband SS,SR[,IT] = the SHEET INPUT only: per island, IT (default 2) rounds of the masked bilateral filter (spatial sigma SS texels,
                        range sigma SR RGB units; SR above the posterize step, below real edges) then +-0.5 level seeded dither, to turn
                        flat posterized bands into smooth gradients. Result still unpacked into the ORIGINAL page.
  --input-nearest P   = the SHEET INPUT is the 256 source P upscaled with NEAREST (pixel-sharp, no ramps) instead of the HD page.
                        Result still unpacked into the ORIGINAL HD page (MAD vs HD page).
  --input-page P      = the SHEET INPUT RGB is the same-size page P (e.g. an island-separated upscale) instead of the HD page.
                        Result still unpacked into the ORIGINAL HD page (src alpha and non-island texels), MAD vs that page. Default off.
  --seed N            = FIBO seed (default 1234).
  --denoise X         = FIBO sampler denoise X < 1 (img2img): the KSampler start latent is the VAE-encoded sheet instead of zeros.
                        Cache keys change. Default 1.0 = unchanged graph.
  --scale X           = pack the islands at X times their size (e.g. 2 or 1.5). Largest X' <= X (steps of 0.1) that fits on
                        <= 2 sheets of <= 1 MP is used and stored in packing_map.json (scale). Scales > 1 use the same
                        down()/up() resampling as the reduced-scale path.
  Run in WSL with node on PATH (wsl bash -ic "..."). Writes no game file.

Steps (nothing model-specific):
 1. islands = texels whose centre lies in a mesh UV triangle (digimon_tex_views.uv_samples, 0.5 texel tolerance),
    dilated 1 px, 4-connected components (scipy label), as in the m230gkwa spaced-B test.
 2. key colour = green (0,255,0); magenta (255,0,255) when > 1% of island texels (alpha > 0) have hue within +-30 deg
    of green (texels with saturation > 0.15 and value > 0.1). MaxRects best-short-side-fit, gap 24 (16 if it does not
    fit), largest sheet <= 1 MP, sides multiples of 16, aspect <= 1.6; 2 sheets if needed.
 3. FIBO: digimon_tex_views.fibo_batch (seed 1234, TextEncodeFibo2 WITH the sheet image, phases A/B/C with ComfyUI
    restarts, ComfyUI killed at the end). Plain-text prompt (ComfyUI wraps it as the edit instruction).
 4. unpack: per island, its sheet mask eroded 2 px; those texels take the FIBO RGB. Result = <model>_spaced_result_<N>.png.
 5. metrics.json (same formulas as the m230gkwa spaced-B report; SM = island texels with alpha > 0):
    mad_isl (result vs original, mean |dRGB| over islands), grow4 (% of island texels: sheet pixels outside islands,
    > 4 px away, differing from the key by > 60), blocks (64 px blocks, >= 60% island, std >= 5: phase-correlation
    shift > 2 px / tested), sat % and sharp (mean Sobel magnitude of luma) vs original, edge_corr (Sobel maps),
    green/key tint % (result and raw), inner 2 px ring luma (raw unpacked FIBO vs original), invented clusters
    (raw vs original luma > 60, > 3 px inside islands, connected clusters >= 30 texels), hue-family colour shifts.
 Temp files (L:/fibo/work/cond|lat/<model>-<tag>_*, ComfyUI input/output, work dir) are removed unless --keep-work.
"""
import glob, hashlib, json, os, shutil, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage as nd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digimon_tex_views as dtv

PROMPTS = {"A": "Refine the image to obtain increased clarity and sharpness.",
           "B": "Refine the image with crisp clean lines and clearer detail."}
HOME = os.path.expanduser("~")


def pick_src(model):
    baks = sorted(glob.glob(f"{HOME}/hd-backup/digimon-tex-*/{model}.png"))
    return baks[0] if baks else f"{HOME}/dw2003-play-integration/web/assets-hd/battle/textures/{model}.png"


def islands(model, N):
    m, P, UV, _, _ = dtv.load_mesh(model)
    if UV is None:
        raise SystemExit(f"{model}: mesh skipped")
    idx = dtv.uv_samples(UV, N)[0]
    u = np.zeros(N * N, bool)
    u[idx] = True
    isl = nd.binary_dilation(u.reshape(N, N))
    lab, n = nd.label(isl)
    return lab, n


def hsv(x):
    x = x / 255.
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx, mn = x.max(-1), x.min(-1)
    c = mx - mn
    s = np.where(mx > 0, c / np.maximum(mx, 1e-9), 0)
    cz = np.maximum(c, 1e-9)
    h = np.where(mx == r, ((g - b) / cz) % 6, np.where(mx == g, (b - r) / cz + 2, (r - g) / cz + 4)) * 60
    return np.where(c > 0, h, 0), s, mx


def hue_near(x, centre, mask):
    h, s, v = hsv(x)
    d = np.abs((h - centre + 180) % 360 - 180)
    return float(100 * ((d <= 30) & (s > 0.15) & (v > 0.1))[mask].mean())


def bilateral(rgb, mask, ss, sr):
    """masked bilateral filter of rgb (H,W,3 float) over mask texels only; others unchanged"""
    r = int(round(2 * ss))
    H, W = mask.shape
    pad = lambda a: np.pad(a, ((r, r), (r, r)) + ((0, 0),) * (a.ndim - 2), mode="edge")
    P, M = pad(rgb), pad(mask.astype(np.float32))
    num = np.zeros_like(rgb)
    den = np.zeros(mask.shape, np.float32)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            ws = np.exp(-(dx * dx + dy * dy) / (2 * ss * ss))
            Q = P[r + dy:r + dy + H, r + dx:r + dx + W]
            wr = np.exp(-((Q - rgb) ** 2).sum(-1) / (2 * sr * sr * 3))
            w = ws * wr * M[r + dy:r + dy + H, r + dx:r + dx + W]
            num += w[..., None] * Q
            den += w
    out = num / np.maximum(den, 1e-6)[..., None]
    return np.where(mask[..., None], out, rgb)


def maxrects(items, SW, SH, g):
    free = [(g, g, SW - g, SH - g)]
    place = {}
    for (i, y, x, h, w) in sorted(items, key=lambda r: (-max(r[3], r[4]), -r[3] * r[4])):
        best = None
        for (fx, fy, fw, fh) in free:
            if w + g <= fw and h + g <= fh:
                sc = (min(fw - w, fh - h), max(fw - w, fh - h))
                if best is None or sc < best[0]:
                    best = (sc, fx, fy)
        if best is None:
            return None
        _, px, py = best
        place[i] = (px, py)
        ow, oh = w + g, h + g
        nf = []
        for (fx, fy, fw, fh) in free:
            if px >= fx + fw or px + ow <= fx or py >= fy + fh or py + oh <= fy:
                nf.append((fx, fy, fw, fh))
                continue
            if px > fx: nf.append((fx, fy, px - fx, fh))
            if px + ow < fx + fw: nf.append((px + ow, fy, fx + fw - px - ow, fh))
            if py > fy: nf.append((fx, fy, fw, py - fy))
            if py + oh < fy + fh: nf.append((fx, py + oh, fw, fy + fh - py - oh))
        nf = [a for a in nf if a[2] > 0 and a[3] > 0]
        free = [a for k, a in enumerate(nf) if not any(k != j and b[0] <= a[0] and b[1] <= a[1] and b[0] + b[2] >= a[0] + a[2]
                and b[1] + b[3] >= a[1] + a[3] and (b != a or j < k) for j, b in enumerate(nf))]
    return place


def pack(rects):
    sizes = sorted({(w, h) for w in range(512, 1601, 16) for h in range(512, 1601, 16) if w * h <= 1_000_000 and max(w, h) / min(w, h) <= 1.6},
                   key=lambda s: -s[0] * s[1])
    for g in (24, 16):
        for (SW, SH) in sizes:
            p = maxrects(rects, SW, SH, g)
            if p:
                return g, SW, SH, [p]
    for g in (24, 16):
        for (SW, SH) in sizes:
            s1, s2 = [], []
            for r in sorted(rects, key=lambda r: -r[3] * r[4]):
                (s1 if maxrects(s1 + [r], SW, SH, g) else s2).append(r)
            if not s2 or maxrects(s2, SW, SH, g):
                return g, SW, SH, [maxrects(s1, SW, SH, g)] + ([maxrects(s2, SW, SH, g)] if s2 else [])
    raise SystemExit("islands do not fit on 2 sheets of <= 1 MP")


def small(r, sc):
    """island rect (id,y,x,h,w) at reduced scale sc (only used when islands do not fit at scale 1)"""
    return (r[0], r[1], r[2], int(np.ceil(r[3] * sc)), int(np.ceil(r[4] * sc)))


def pack_down(rects):
    """Fallback when pack() fails: same packing on islands reduced by sc (0.5, 0.45, ...); returns (sc,) + pack() result."""
    for sc in [round(0.5 - 0.05 * k, 2) for k in range(9)]:
        try:
            return (sc,) + pack([small(r, sc) for r in rects])
        except SystemExit:
            pass
    raise SystemExit("islands do not fit on 2 sheets of <= 1 MP even at scale 0.1")


def rs(a, w, h):
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((w, h), Image.BICUBIC))


def down(rgb, mk, w2, h2):
    """island pixels to (h2, w2): masked (normalised) bicubic, so no key/transparent colour bleeds in. Returns rgb uint8, mask bool."""
    m = mk.astype(np.float32)
    den = rs(m, w2, h2)
    out = np.stack([rs(rgb[..., c] * m, w2, h2) for c in range(3)], -1) / np.maximum(den, 1e-3)[..., None]
    return np.clip(out, 0, 255).astype(np.uint8), den >= 0.5


def up(rgb2, m2, w, h):
    """inverse of down(): sheet pixels (h2, w2) back to (h, w); returns float rgb and full-size mask (bilinear >= 0.5)."""
    m = m2.astype(np.float32)
    den = rs(m, w, h)
    out = np.stack([rs(rgb2[..., c].astype(np.float32) * m, w, h) for c in range(3)], -1) / np.maximum(den, 1e-3)[..., None]
    return np.clip(out, 0, 255), den >= 0.5


def sheet_masks(mp, lab):
    SW, SH = mp["sheet_size"]
    sc = mp.get("scale", 1)
    pm = {s["index"]: np.zeros((SH, SW), np.int32) for s in mp["sheets"]}
    for it in mp["islands"]:
        r, p, i = it["src_rect"], it["sheet_pos"], it["id"]
        mk = lab[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"]] == i
        if sc != 1:
            h2, w2 = small((0, 0, 0, r["h"], r["w"]), sc)[3:]
            mk = down(np.zeros(mk.shape + (3,), np.uint8), mk, w2, h2)[1]
            pm[it["sheet"]][p["y"]:p["y"] + h2, p["x"]:p["x"] + w2][mk] = i
            continue
        pm[it["sheet"]][p["y"]:p["y"] + r["h"], p["x"]:p["x"] + r["w"]][mk] = i
    return pm


def unpack(mp, lab, src, out_dir, erode=2):
    sheets = {s["index"]: np.asarray(Image.open(f"{out_dir}/{s['file'].replace('_in_', '_fibo_')}").convert("RGB")) for s in mp["sheets"]}
    pm = sheet_masks(mp, lab)
    raw = src[..., :3].copy()
    keep = np.zeros(lab.shape, bool)
    for it in mp["islands"]:
        r, p, i = it["src_rect"], it["sheet_pos"], it["id"]
        ys, xs = slice(r["y"], r["y"] + r["h"]), slice(r["x"], r["x"] + r["w"])
        sy, sx = slice(p["y"], p["y"] + r["h"]), slice(p["x"], p["x"] + r["w"])
        mk = lab[ys, xs] == i
        if mp.get("scale", 1) != 1:
            h2, w2 = small((0, 0, 0, r["h"], r["w"]), mp["scale"])[3:]
            sy, sx = slice(p["y"], p["y"] + h2), slice(p["x"], p["x"] + w2)
            col, mfull = up(sheets[it["sheet"]][sy, sx], pm[it["sheet"]][sy, sx] == i, r["w"], r["h"])
            ok = mk & mfull
            raw[ys, xs][ok] = np.rint(col[ok]).astype(np.uint8)
            kk = nd.binary_erosion(mfull, iterations=erode) if erode else mfull
            keep[ys, xs] |= kk & ok
            continue
        raw[ys, xs][mk] = sheets[it["sheet"]][sy, sx][mk]
        m = pm[it["sheet"]] == i
        m = nd.binary_erosion(m, iterations=erode) if erode else m
        keep[ys, xs] |= m[sy, sx]
    keep &= lab > 0
    res = src.copy()
    res[keep, :3] = raw[keep]
    return raw, keep, res, sheets, pm


luma = lambda x: x @ np.array([0.299, 0.587, 0.114])
sob = lambda L: np.hypot(nd.sobel(L, 0), nd.sobel(L, 1))


def tint(x, key):
    x = x / 255.
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx, mn = x.max(-1), x.min(-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
    if key == "green":
        return (g >= r) & (g >= b) & (s > 0.15) & ((g - np.maximum(r, b)) > 0.05)
    return (r >= g) & (b >= g) & (s > 0.15) & ((np.minimum(r, b) - g) > 0.05)


def metrics(mp, lab, src, raw, res, sheets, pm, keyname, key):
    N = lab.shape[0]
    orig = src[..., :3].astype(np.float64)
    res = res[..., :3].astype(np.float64)
    raw = raw.astype(np.float64)
    isl = lab > 0
    SM = isl & (src[..., 3] > 0)
    Lo, Lr, Lraw = luma(orig), luma(res), luma(raw)
    din = nd.distance_transform_edt(isl)
    ring, ring34 = SM & (din <= 2), SM & (din > 2) & (din <= 4)
    _, so, _ = hsv(orig)
    gtot = 0
    for k, sh in sheets.items():
        m = pm[k] > 0
        g = np.abs(sh.astype(float) - key).max(-1)
        gtot += ((~m) & (g > 60) & (nd.distance_transform_edt(~m) > 4)).sum()
    shifts = []
    wn = np.outer(np.hanning(64), np.hanning(64))
    for y in range(0, N - 63, 64):
        for x in range(0, N - 63, 64):
            if isl[y:y + 64, x:x + 64].mean() < 0.6: continue
            a, b = Lo[y:y + 64, x:x + 64], Lr[y:y + 64, x:x + 64]
            if a.std() < 5: continue
            R = np.fft.fft2((a - a.mean()) * wn).conj() * np.fft.fft2((b - b.mean()) * wn)
            c = np.fft.ifft2(R / np.maximum(np.abs(R), 1e-12)).real
            j, i = np.unravel_index(c.argmax(), c.shape)
            shifts.append(np.hypot(i if i < 32 else i - 64, j if j < 32 else j - 64))
    shifts = np.array(shifts)
    d = np.abs(Lraw - Lo)
    bm = SM & (din > 3) & (d > 60)
    bl, bn = nd.label(bm)
    bsz = nd.sum(bm, bl, range(1, bn + 1)) if bn else np.array([])
    big = [i + 1 for i in np.nonzero(bsz >= 30)[0]]
    clusters = []
    for i in sorted(big, key=lambda i: -bsz[i - 1])[:12]:
        ys, xs = np.nonzero(bl == i)
        mm = bl == i
        clusters.append(dict(texels=int(bsz[i - 1]), bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                             rgb_orig=orig[mm].mean(0).round().astype(int).tolist(), rgb_raw=raw[mm].mean(0).round().astype(int).tolist()))
    # hue families of the original (sat > 0.25, value > 0.15), 30 deg bins: mean RGB / hue / sat / value before and after
    ho, so2, vo = hsv(orig)
    hr, sr, vr = hsv(res)
    fam = []
    names = ["red", "orange", "yellow", "yellow-green", "green", "green-cyan", "cyan", "azure", "blue", "violet", "magenta", "rose"]
    col = SM & (so2 > 0.25) & (vo > 0.15)
    bins = (((ho + 15) % 360) // 30).astype(int)
    for k in range(12):
        m = col & (bins == k)
        if m.sum() < 0.01 * SM.sum(): continue
        dh = ((hr[m] - ho[m] + 180) % 360 - 180)
        fam.append(dict(family=names[k], share_pct=round(100 * m.sum() / SM.sum(), 1), rgb_orig=orig[m].mean(0).round().astype(int).tolist(),
                        rgb_res=res[m].mean(0).round().astype(int).tolist(), hue_shift_deg=round(float(np.median(dh)), 1),
                        sat_orig=round(float(so2[m].mean()), 3), sat_res=round(float(sr[m].mean()), 3),
                        val_orig=round(float(vo[m].mean()), 3), val_res=round(float(vr[m].mean()), 3),
                        moved_out_pct=round(100 * float(((np.abs(dh) > 15) | (sr[m] < 0.25)).mean()), 1)))
    grey = SM & (so2 < 0.1)
    return dict(
        island_texels=int(isl.sum()), sm_texels=int(SM.sum()),
        mad_isl=round(float(np.abs(res - orig).mean(-1)[isl].mean()), 2), mad_isl_raw=round(float(np.abs(raw - orig).mean(-1)[isl].mean()), 2),
        grow4=round(100 * gtot / sum((pm[k] > 0).sum() for k in pm), 2),
        blocks_shift_gt2=int((shifts > 2).sum()), blocks_tested=len(shifts),
        sat_orig=round(100 * float(so[SM].mean()), 1), sat=round(100 * float(hsv(res)[1][SM].mean()), 1),
        sharp_orig=round(float(sob(Lo)[SM].mean()), 1), sharp=round(float(sob(Lr)[SM].mean()), 1),
        edge_corr=round(float(np.corrcoef(sob(Lo)[SM], sob(Lr)[SM])[0, 1]), 3),
        key=keyname, green_orig=round(100 * float(tint(orig, "green")[SM].mean()), 2), green=round(100 * float(tint(res, "green")[SM].mean()), 2),
        green_raw=round(100 * float(tint(raw, "green")[SM].mean()), 2),
        magenta_orig=round(100 * float(tint(orig, "magenta")[SM].mean()), 2), magenta=round(100 * float(tint(res, "magenta")[SM].mean()), 2),
        ring2_orig=round(float(Lo[ring].mean()), 1), ring2_raw=round(float(Lraw[ring].mean()), 1), ring2_res=round(float(Lr[ring].mean()), 1),
        ring34_orig=round(float(Lo[ring34].mean()), 1), ring34_raw=round(float(Lraw[ring34].mean()), 1),
        clusters=len(big), cluster_pct=round(100 * float(bm.sum() / SM.sum()), 2), cluster_top=clusters,
        grey_orig=dict(texels=int(grey.sum()), rgb_orig=orig[grey].mean(0).round().astype(int).tolist(), rgb_res=res[grey].mean(0).round().astype(int).tolist(),
                       sat_res=round(float(hsv(res)[1][grey].mean()), 3)),
        hue_families=fam)


def sha1(p):
    return hashlib.sha1(open(p, "rb").read()).hexdigest()


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    model = a[0]
    pk = opt("--prompt", "B")
    prompt = PROMPTS.get(pk, pk)
    if opt("--prompt-json"):  # opt-in: structured VGL caption from a JSON file, sent as ONE compact JSON string
        prompt = json.dumps(json.load(open(opt("--prompt-json"))), separators=(",", ":"), ensure_ascii=False)
        pk = "json"
    tag = opt("--tag", f"spaced-{pk}" if pk in PROMPTS else "spaced")
    src_p = opt("--src") or pick_src(model)
    out = opt("--outdir") or f"{opt('--out', dtv.OUT_BASE)}/{model}-atlas/{tag}"
    wtag = f"{model}-{tag}"
    work = f"{dtv.WORK}/{wtag}"
    os.makedirs(out, exist_ok=True)
    os.makedirs(work, exist_ok=True)
    src = np.asarray(Image.open(src_p).convert("RGBA"))
    N = src.shape[0]
    lab, n = islands(model, N)
    isl = lab > 0
    A = src[..., 3] > 0
    srcinfo = dict(path=src_p, sha1=sha1(src_p), mtime=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(src_p))), size=[N, N])
    print(json.dumps(dict(model=model, tag=tag, src=srcinfo, islands=n, island_texels=int(isl.sum()))), flush=True)
    if "--metrics-only" in a:
        mp = json.load(open(f"{out}/packing_map.json"))
        keyname = mp.get("key", "green")
        secs = None
        objs = nd.find_objects(lab)
        for it in mp["islands"]:
            sl = objs[it["id"] - 1]
            r = it["src_rect"]
            assert (sl[0].start, sl[1].start, sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) == (r["y"], r["x"], r["h"], r["w"]), f"island {it['id']} differs from packing_map"
        assert len(mp["islands"]) == n, (len(mp["islands"]), n)
    else:
        gpct = hue_near(src[..., :3].astype(float), 120, isl & A)
        mpct = hue_near(src[..., :3].astype(float), 300, isl & A)
        keyname = "green" if gpct <= 1.0 else "magenta"
        key = np.array([0, 255, 0] if keyname == "green" else [255, 0, 255], np.uint8)
        objs = nd.find_objects(lab)
        rects = [(i + 1, s[0].start, s[1].start, s[0].stop - s[0].start, s[1].stop - s[1].start) for i, s in enumerate(objs)]
        sc = 1
        want = float(opt("--scale", 1))
        src_sheet = src
        if opt("--presmooth"):
            ss, sr = [float(v) for v in opt("--presmooth").split(",")]
            sm_rgb = bilateral(src[..., :3].astype(np.float32), isl & A, ss, sr)
            src_sheet = src.copy()
            src_sheet[..., :3] = np.clip(sm_rgb, 0, 255).astype(np.uint8)
            print(f"presmooth bilateral ss={ss} sr={sr}: mean |change| on SM {np.abs(sm_rgb - src[..., :3]).mean(-1)[isl & A].mean():.2f}", flush=True)
        if opt("--input-nearest"):
            lo = Image.open(opt("--input-nearest")).convert("RGB")
            nn = np.asarray(lo.resize((N, N), Image.NEAREST))
            src_sheet = src.copy()
            src_sheet[..., :3] = nn
            print(f"input-nearest {lo.size}->{N}: mean |diff| to HD page on SM {np.abs(nn.astype(float) - src[..., :3]).mean(-1)[isl & A].mean():.2f}", flush=True)
        if opt("--input-page"):
            ip = np.asarray(Image.open(opt("--input-page")).convert("RGB"))
            assert ip.shape[:2] == (N, N), (ip.shape, N)
            src_sheet = src.copy()
            src_sheet[..., :3] = ip
            print(f"input-page {opt('--input-page')}: mean |diff| to HD page on SM {np.abs(ip.astype(float) - src[..., :3]).mean(-1)[isl & A].mean():.2f}", flush=True)
        if opt("--deband"):
            dp = opt("--deband").split(",")
            ss, sr = float(dp[0]), float(dp[1])
            it = int(dp[2]) if len(dp) > 2 else 2
            cur = src_sheet[..., :3].astype(np.float32)
            for _ in range(it):
                cur = bilateral(cur, isl & A, ss, sr)
            cur = cur + np.random.default_rng(1234).uniform(-0.5, 0.5, cur.shape[:2])[..., None].astype(np.float32)
            src_sheet = src_sheet.copy()
            src_sheet[..., :3] = np.clip(np.rint(cur), 0, 255).astype(np.uint8)
            print(f"deband ss={ss} sr={sr} it={it}: mean |change| on SM {np.abs(src_sheet[..., :3].astype(float) - src[..., :3]).mean(-1)[isl & A].mean():.2f}", flush=True)
            Image.fromarray(src_sheet[..., :3]).save(f"{out}/{model}_sheet_input_page.png")
        try:
            if want > 1:
                for w2 in [round(want - 0.1 * k, 2) for k in range(int(round((want - 1) * 10)) + 1)]:
                    try:
                        g, SW, SH, pages = pack([small(r, w2) for r in rects]); sc = w2
                        break
                    except SystemExit:
                        pass
                else:
                    raise SystemExit("no scale > 1 fits")
                print(f"packing at scale {sc} (asked {want})", flush=True)
            else:
                g, SW, SH, pages = pack(rects)
        except SystemExit:
            sc, g, SW, SH, pages = pack_down(rects)   # islands do not fit at scale 1: pack reduced, upscale back on unpack
            print(f"packing at scale {sc}", flush=True)
        R = {r[0]: r for r in rects}
        mp = dict(source=f"{os.path.basename(src_p)} {N}x{N}", source_info=srcinfo, gap=g, sheet_size=[SW, SH], rotation="none", scale=sc,
                  key=keyname, key_rgb=key.tolist(), island_green_hue_pct=round(gpct, 3), island_magenta_hue_pct=round(mpct, 3), islands=[], sheets=[])
        for si, pg in enumerate(pages):
            sh = np.zeros((SH, SW, 3), np.uint8)
            sh[:] = key
            pm = np.zeros((SH, SW), np.int32)
            for i, (px, py) in pg.items():
                _, y, x, h, w = R[i]
                mk = lab[y:y + h, x:x + w] == i
                if sc != 1:
                    h2, w2 = small(R[i], sc)[3:]
                    rgb2, mk2 = down(src_sheet[y:y + h, x:x + w, :3].astype(np.float32), mk, w2, h2)
                    assert not pm[py:py + h2, px:px + w2][mk2].any()
                    pm[py:py + h2, px:px + w2][mk2] = i
                    sh[py:py + h2, px:px + w2][mk2] = rgb2[mk2]
                else:
                    assert not pm[py:py + h, px:px + w][mk].any()
                    pm[py:py + h, px:px + w][mk] = i
                    sh[py:py + h, px:px + w][mk] = src_sheet[y:y + h, x:x + w, :3][mk]
                mp["islands"].append(dict(id=int(i), sheet=si, src_rect=dict(x=int(x), y=int(y), w=int(w), h=int(h)), sheet_pos=dict(x=int(px), y=int(py)), texels=int(mk.sum())))
            md = 1e9
            for i in pg:
                o = (pm > 0) & (pm != i)
                if o.any():
                    md = min(md, nd.distance_transform_edt(pm != i)[o].min())
            ys, xs = np.nonzero(pm)
            edge = min(xs.min(), ys.min(), SW - 1 - xs.max(), SH - 1 - ys.max())
            f = f"{model}_spaced_sheet{si}_in_{SW}x{SH}.png"
            Image.fromarray(sh).save(f"{out}/{f}")
            mp["sheets"].append(dict(index=si, file=f, islands=len(pg), min_texel_gap=float(md - 1), min_edge_gap=int(edge), fill_pct=round(100 * float((pm > 0).mean()), 1)))
            print(f"sheet {si}: {SW}x{SH} islands {len(pg)} min gap {md - 1:.1f} edge {edge}", flush=True)
        json.dump(mp, open(f"{out}/packing_map.json", "w"), indent=1)
        assert dtv.SEED == 1234
        if opt("--seed"):   # opt-in: other FIBO seed (cache key includes it); default 1234 unchanged
            import functools
            dtv.SEED = int(opt("--seed"))
            dtv.graphs = functools.partial(dtv.graphs, seed=dtv.SEED)
        if opt("--denoise"):
            dtv.DENOISE = float(opt("--denoise"))
        jobs = [dict(vname=f"s{s['index']}", render=f"{out}/{s['file']}", prompt=prompt, out=f"{out}/{s['file'].replace('_in_', '_fibo_')}") for s in mp["sheets"]]
        json.dump(dict(seed=dtv.SEED, size=mp["sheet_size"], prompt=prompt, prompt_key=pk, denoise=dtv.DENOISE, background=key.tolist(), key=keyname, sheets=len(jobs), src=srcinfo,
                       note="plain text; ComfyUI wraps it as {\"image\": <image>, \"edit_instruction\": text}; encoded WITH the image (TextEncodeFibo2 images.image_1)"),
                  open(f"{out}/prompt.json", "w"), indent=1)
        t0 = time.time()
        log = []
        info = dtv.fibo_batch(wtag, jobs, work, log)
        secs = round(time.time() - t0, 1)
        print(json.dumps(dict(fibo=info, log=log, secs=secs)), flush=True)
        if any(v.get("failed") for k, v in info.items() if not k.startswith("_")):
            sys.exit(f"FIBO failed: {info}")
        if "--keep-work" not in a:
            for j in jobs:
                for p in (j["cond"], j["lat"], f"{dtv.COMFY}/input/{j['img']}"):
                    if os.path.exists(p): os.remove(p)
            shutil.rmtree(f"{dtv.COMFY}/output/texviews/{wtag}", ignore_errors=True)
            shutil.rmtree(work, ignore_errors=True)
    key = np.array(mp.get("key_rgb", [0, 255, 0]), float)
    raw, keep, res, sheets, pm = unpack(mp, lab, src, out)
    rp = f"{out}/{model}_spaced_result_{N}.png"
    if "--metrics-only" not in a or not os.path.exists(rp):
        Image.fromarray(res, "RGBA").save(rp)
    chk = np.asarray(Image.open(rp).convert("RGBA"))
    M = metrics(mp, lab, src, raw, chk, sheets, pm, keyname, key)
    M.update(model=model, tag=tag, prompt=prompt, src=srcinfo, fibo_secs=secs, fibo_texels=int(keep.sum()), kept_original_in_islands=int((isl & ~keep).sum()),
             alpha_same=bool((chk[..., 3] == src[..., 3]).all()), outside_keep_same=bool((chk[~keep] == src[~keep]).all()),
             result=rp, result_sha1=sha1(rp))
    if secs is None and os.path.exists(f"{out}/metrics.json"):
        M["fibo_secs"] = json.load(open(f"{out}/metrics.json")).get("fibo_secs")
    json.dump(M, open(opt("--metrics-file", f"{out}/metrics.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in M.items() if k not in ("hue_families", "cluster_top", "grey_orig")}))


if __name__ == "__main__":
    main()
