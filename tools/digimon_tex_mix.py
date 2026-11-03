#!/usr/bin/env python3
"""Mix the ORIGINAL HD texture back into a FIBO result (offline files only, installs nothing).

  python3 tools/digimon_tex_mix.py <model> --mix 0.3[,0.5,0.7] [--fibo png] [--orig png] [--margin 4] [--out dir]

Per UV island (same islands() as digimon_tex_spaced): the FIBO colours are matched to the original's per-channel mean and
std in CIE Lab (std ratio clamped 0.25..4, islands < 50 texels mean only), then blended (1-mix)*FIBO + mix*original,
then luma is clipped to the original island's 99th percentile luma + margin (RGB scaled, hue kept). Alpha = FIBO's, exact.
Defaults: fibo = ~/digimon-atlas-B/<model>/<model>_spaced_result_1024.png, orig = earliest ~/hd-backup/digimon-tex-*/<model>.png,
out = ~/digimon-atlas-B/<model>/mix/<model>_mix<NN>.png. Prints metrics over island texels with alpha>0 and writes mix/metrics.json.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digimon_tex_spaced as sp

HOME = os.path.expanduser("~")
M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
WP = np.array([0.95047, 1.0, 1.08883])


def to_lab(rgb):
    c = rgb / 255.
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    t = (c @ M.T) / WP
    f = np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def from_lab(lab):
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], -1)
    t = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27))
    c = (t * WP) @ np.linalg.inv(M).T
    c = np.clip(c, 0, 1)
    c = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
    return c * 255.


def luma(x):
    return x @ np.array([0.299, 0.587, 0.114])


def sob(L):
    return np.hypot(nd.sobel(L, 0), nd.sobel(L, 1))


def mix_one(O, F, lab, mix, margin):
    Ol, Fl = to_lab(O), to_lab(F)
    Fm = Fl.copy()
    for i in range(1, int(lab.max()) + 1):
        m = (lab == i) & A
        n = int(m.sum())
        if n < 8:
            continue
        for c in range(3):
            mo, mf = Ol[..., c][m].mean(), Fl[..., c][m].mean()
            if n >= 50:
                so, sf = Ol[..., c][m].std(), Fl[..., c][m].std()
                r = np.clip(so / sf, 0.25, 4) if sf > 1e-6 else 1.0
            else:
                r = 1.0
            Fm[..., c][m] = (Fl[..., c][m] - mf) * r + mo
    out = (1 - mix) * from_lab(Fm) + mix * O
    L = luma(out)
    cap = np.full(L.shape, 255.)
    for i in range(1, int(lab.max()) + 1):
        m = (lab == i) & A
        if m.sum() >= 8:
            cap[lab == i] = np.percentile(luma(O)[m], 99) + margin
    k = np.where(L > cap, cap / np.maximum(L, 1e-6), 1.0)
    return np.clip(out * k[..., None], 0, 255)


def report(name, X, O, SM):
    Lo, Lx = luma(O), luma(X)
    p99 = np.percentile(Lo[SM], 99)
    return dict(name=name, sharp=round(float(sob(Lx)[SM].mean()), 1), luma_std=round(float(Lx[SM].std()), 1),
                pct_above_orig_p99=round(float((Lx[SM] > p99).mean() * 100), 2),
                mad_to_orig=round(float(np.abs(X - O).mean(-1)[SM].mean()), 2))


a = sys.argv[1:]
if not a:
    sys.exit(__doc__)
opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
model = a[0]
mixes = [float(x) for x in opt("--mix", "0.3,0.5,0.7").split(",")]
fp = opt("--fibo", f"{HOME}/digimon-atlas-B/{model}/{model}_spaced_result_1024.png")
op = opt("--orig") or sp.pick_src(model)
out = opt("--out", f"{HOME}/digimon-atlas-B/{model}/mix")
margin = float(opt("--margin", 4))
os.makedirs(out, exist_ok=True)
Fi = np.asarray(Image.open(fp).convert("RGBA"))
Oi = np.asarray(Image.open(op).convert("RGBA"))
assert Fi.shape == Oi.shape, (Fi.shape, Oi.shape)
N = Fi.shape[0]
lab, n = sp.islands(model, N)
A = Fi[..., 3] > 0
SM = (lab > 0) & A
O, F = Oi[..., :3].astype(np.float64), Fi[..., :3].astype(np.float64)
rows = [report("original", O, O, SM), report("fibo", F, O, SM)]
for mx in mixes:
    X = mix_one(O, F, lab, mx, margin)
    # outside alpha keep FIBO's installed pixels untouched
    X = np.where(A[..., None], X, F)
    img = np.dstack([np.round(X).astype(np.uint8), Fi[..., 3]])
    p = f"{out}/{model}_mix{int(round(mx * 100)):02d}.png"
    Image.fromarray(img, "RGBA").save(p)
    rows.append(report(f"mix{mx}", img[..., :3].astype(np.float64), O, SM))
    print("wrote", p)
for r in rows:
    print(r)
json.dump(dict(model=model, orig=op, fibo=fp, margin=margin, island_texels_alpha=int(SM.sum()), rows=rows), open(f"{out}/metrics.json", "w"), indent=1)
