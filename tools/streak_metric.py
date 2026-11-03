#!/usr/bin/env python3
"""Streak (long parallel line) metric for a Digimon HD texture page, per UV island. Numbers only, writes nothing.
  python3 tools/streak_metric.py <model> <png> [<png> ...] [--lowres path256.png] [--json]
Per texel set SM = island texels with alpha>0 (islands() of digimon_tex_spaced).
  coh   = energy-weighted mean local structure-tensor coherence (Sobel of luma, gaussian window sigma 6) over SM texels with
          window energy > 25 (1 = all gradients one direction, like brushed metal). coh_isl = same but tensor summed per island
          (dominant/orthogonal orientation energy ratio, mean over islands >= 400 texels, weighted by energy) as ratio1/ratio2.
  runs  = connected strong-edge components (Sobel mag > 40 inside SM, 8-conn) with PCA elongation > 8 and length (major axis
          extent) >= 40 px: count and total texels. runs_per_ktex = per 1000 SM texels.
  grid4 = banding: best of 16 offsets, share of aligned 4x4 blocks inside SM with luma range <= 3 (flat blocks of the 4x upscale);
          step4 = mean |dx|+|dy| luma step on the block boundaries / same inside blocks (>1 = steps sit on the 4-grid).
  levels= distinct luma levels (rounded) per island, median over islands >= 400 texels.
  streak = oriented line-retention (see streak()); streak_amp = same but not energy-normalised: mean over SM of (max-mean ratio)*detail energy = visible directional detail strength.
  sharp = mean Sobel magnitude of luma over SM.
"""
import sys, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digimon_tex_spaced as sp

def luma(a): return a[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])

def line_kernel(th, n=25):
    k = np.zeros((n, n)); c = n // 2
    for t in np.linspace(-c, c, 4 * n):
        k[int(round(c + t * np.sin(th))), int(round(c + t * np.cos(th)))] = 1
    return k / k.sum()

def streak(L, SM):
    """oriented line-retention: detail D = clip(L - gauss(L,2), +-20); for 8 orientations th the energy of D averaged along a
    25 px line, relative to the energy of D (both gauss(4) smoothed). streak = max_th - mean_th of that ratio, energy weighted
    over SM texels with energy > 4. Isotropic noise ~0, parallel lines (brushed metal) high. Also returns p90 of it."""
    from scipy.signal import fftconvolve
    D = np.clip(L - nd.gaussian_filter(L, 2), -20, 20)
    E0 = nd.gaussian_filter(D * D, 4)
    R = np.stack([nd.gaussian_filter(fftconvolve(D, line_kernel(np.pi * k / 8), mode='same') ** 2, 4) / np.maximum(E0, 1e-6) for k in range(8)])
    sc = R.max(0) - R.mean(0)
    m = SM & (E0 > 4)
    return float((sc * E0)[m].sum() / E0[m].sum()), float(np.percentile(sc[m], 90)), float((sc * E0)[m].sum() / SM.sum())

def measure(model, path, lab=None):
    img = np.asarray(Image.open(path).convert('RGBA'))
    N = img.shape[0]
    if lab is None: lab = sp.islands(model, N)[0]
    SM = (lab > 0) & (img[..., 3] > 0)
    L = luma(img)
    gx, gy = nd.sobel(L, 1) / 8, nd.sobel(L, 0) / 8
    mag = np.hypot(gx, gy) * 2
    g = lambda a: nd.gaussian_filter(a, 6)
    jxx, jyy, jxy = g(gx * gx), g(gy * gy), g(gx * gy)
    tr = jxx + jyy
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / np.maximum(tr, 1e-9)
    sel = SM & (tr > 25)
    cohm = float((coh * tr)[sel].sum() / tr[sel].sum()) if sel.any() else 0.
    # per island tensor
    rs, ws = [], []
    ids = np.unique(lab[SM])
    for i in ids:
        m = SM & (lab == i)
        if m.sum() < 400: continue
        a, b, c = (gx * gx)[m].sum(), (gy * gy)[m].sum(), (gx * gy)[m].sum()
        t = a + b
        if t <= 0: continue
        d = np.hypot(a - b, 2 * c)
        l1, l2 = (t + d) / 2, (t - d) / 2
        rs.append(l1 / max(l2, 1e-9)); ws.append(t)
    ratio = float(np.average(rs, weights=ws)) if rs else 0.
    ratio_med = float(np.median(rs)) if rs else 0.
    # long straight runs
    E = SM & (mag > 40)
    cl, n = nd.label(E, structure=np.ones((3, 3)))
    cnt = tot = 0
    for k, sl in enumerate(nd.find_objects(cl)):
        if sl is None: continue
        ys, xs = np.nonzero(cl[sl] == k + 1)
        if len(ys) < 40: continue
        P = np.stack([xs, ys], 1).astype(float); P -= P.mean(0)
        ev, evec = np.linalg.eigh(np.cov(P.T))
        pr = P @ evec[:, 1]; length = pr.max() - pr.min()
        el = np.sqrt(ev[1] / max(ev[0], 1e-9))
        if length >= 40 and el > 8: cnt += 1; tot += len(ys)
    # grid4
    best = 0
    for oy in range(4):
        for ox in range(4):
            h = (N - oy) // 4 * 4; w = (N - ox) // 4 * 4
            B = L[oy:oy + h, ox:ox + w].reshape(h // 4, 4, w // 4, 4)
            M = SM[oy:oy + h, ox:ox + w].reshape(h // 4, 4, w // 4, 4).all((1, 3))
            rng = B.max((1, 3)) - B.min((1, 3))
            if M.sum(): best = max(best, float((rng[M] <= 3).mean()))
    dx = np.abs(np.diff(L, axis=1)); mx = (SM[:, 1:] & SM[:, :-1])
    stp = []
    for o in range(4):
        cols = (np.arange(N - 1) % 4) == o
        stp.append(float(dx[:, cols][mx[:, cols]].mean()))
    step4 = max(stp) / max(np.mean([s for s in stp if s != max(stp)] or [1e-9]), 1e-9)
    lv = [len(np.unique(np.rint(L[SM & (lab == i)]))) for i in ids if (SM & (lab == i)).sum() >= 400]
    st, st90, amp = streak(L, SM)
    return dict(file=os.path.basename(path), streak=round(st, 4), streak_p90=round(st90, 3), streak_amp=round(amp, 2), coh=round(cohm, 4), isl_ratio_w=round(ratio, 2), isl_ratio_med=round(ratio_med, 2),
                runs=cnt, run_texels=int(tot), runs_per_ktex=round(1000 * cnt / SM.sum(), 3), grid4_flat=round(best, 3), step4=round(step4, 2),
                levels_med=int(np.median(lv)) if lv else 0, sharp=round(float(4*mag[SM].mean()), 1), sm=int(SM.sum()))

if __name__ == '__main__':
    a = sys.argv[1:]
    model = a[0]; files = [x for x in a[1:] if not x.startswith('--')]
    lab = None
    for f in files:
        N = Image.open(f).size[0]
        if lab is None or lab.shape[0] != N: lab = sp.islands(model, N)[0]
        print(json.dumps(measure(model, f, lab)), flush=True)
