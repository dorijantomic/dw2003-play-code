#!/usr/bin/env python3
"""General quality score of a Digimon HD texture page vs the ORIGINAL page. Numbers only, writes nothing (unless --json-out).
  python3 tools/tex_quality.py <model> <png> [<png> ...] [--orig png] [--json]
orig default = digimon_tex_spaced.pick_src(model). SM = island texels with alpha>0 (islands() of digimon_tex_spaced).
Sub-scores (separate, no total):
 FAITH  dE_isl   mean CIE Lab dE of per-island mean colour (texel-weighted)            lower better, 0 = same
        dE_pix   mean dE of sigma-4 blurred colours over SM                            lower better
        edge_r   Pearson r of Sobel-magnitude maps (sigma 1) result vs orig over SM    higher better, 1 = same
        hue_deg  mean abs hue shift (deg) on saturated blurred texels (S>0.25,V>0.2)   lower better
        sat_rat  mean saturation ratio result/orig                                     1 = same
 ART    streak_n / streak_p90  oriented line-retention (energy-normalised, p90) result / orig: pure directionality, independent of detail amount
        streak_amp  streak_metric streak_amp, and streak_rat = / orig streak_amp        ~1 = orig level
        hl_pct      % SM texels with luma > orig island p99 + 10                         orig ~1, lower better
        spec_pct    % SM texels low-sat(S<0.15)&bright(V>0.85) minus the same for orig   fake shine, ~0 good
        con_rat     median over islands(>=400) of luma std result / orig                 1 = same contrast (above 1 = too contrasty)
        levels      median distinct luma levels per island (posterization; low = banded)
        invent_pct  % SM texels where sigma-3 blurred luma differs from orig > 40       invented structure
 ART    runs_k / runs_k_orig  long straight strong-edge runs per 1000 texels (streak_metric), result and orig
 ART    add_vert / add_aniso  direction of the ADDED detail (result hp - orig hp): vertical-line share (0.5 none) and tensor anisotropy (0 none)
 CLEAN  flat_std / flat_std_orig  mean 3x3 luma std on flat texels (grain/noise in flat colour; lower = cleaner)
 DETAIL sharp_rat   mean Sobel magnitude of luma result / orig                           >1 more detail
        hf_rat      std of (L - gauss(L,1.5)) over SM result / orig
 ALPHA  a_soft      % of alpha values not 0/255 (0 = binary)
        a_block     share of 4x4 (best offset) blocks touching the alpha edge that are constant in binary alpha (1 = 4x nearest blocky)
        a_fringe    mean dE (Lab) of the 3 px band just inside the alpha edge vs orig (colour bleeding at the cut-out)
"""
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digimon_tex_spaced as sp
import streak_metric as sm

M_ = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
WP_ = np.array([0.95047, 1.0, 1.08883])
def to_lab(rgb):
    c = rgb / 255.
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    t = (c @ M_.T) / WP_
    f = np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
class mx: to_lab = staticmethod(to_lab)

def luma(a): return a[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])

def hsv(rgb):
    c = rgb / 255.
    v = c.max(-1); mn = c.min(-1); d = v - mn
    s = np.where(v > 0, d / np.maximum(v, 1e-9), 0)
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    h = np.where(d == 0, 0, np.where(v == r, ((g - b) / np.maximum(d, 1e-9)) % 6, np.where(v == g, (b - r) / np.maximum(d, 1e-9) + 2, (r - g) / np.maximum(d, 1e-9) + 4))) * 60
    return h, s, v

def blur(a, s): return np.stack([nd.gaussian_filter(a[..., i], s) for i in range(a.shape[-1])], -1)

def sob(L, s=1):
    Ls = nd.gaussian_filter(L, s)
    return np.hypot(nd.sobel(Ls, 1), nd.sobel(Ls, 0)) / 8

def alpha_scores(A, res, org):
    soft = float(((A > 0) & (A < 255)).sum() / max((A > 0).sum(), 1) * 100)
    B = A > 127
    E = B & ~nd.binary_erosion(B, border_value=1)
    N = A.shape[0]; best = 0
    for oy in range(4):
        for ox in range(4):
            h = (N - oy) // 4 * 4; w = (N - ox) // 4 * 4
            b = B[oy:oy + h, ox:ox + w].reshape(h // 4, 4, w // 4, 4)
            e = E[oy:oy + h, ox:ox + w].reshape(h // 4, 4, w // 4, 4).any((1, 3))
            con = b.all((1, 3)) | (~b).all((1, 3))
            if e.sum(): best = max(best, float(con[e].mean()))
    band = B & ~nd.binary_erosion(B, iterations=3, border_value=1)
    la, lb = mx.to_lab(res[..., :3].astype(float)), mx.to_lab(org[..., :3].astype(float))
    fr = float(np.sqrt(((la - lb) ** 2).sum(-1))[band].mean()) if band.any() else 0.
    return soft, best, fr

def measure(model, path, orig=None, lab=None, cache={}):
    res = np.asarray(Image.open(path).convert('RGBA'))
    N = res.shape[0]
    if orig is None: orig = sp.pick_src(model)
    org = np.asarray(Image.open(orig).convert('RGBA'))
    if org.shape[0] != N: org = np.asarray(Image.fromarray(org).resize((N, N), Image.BICUBIC))
    if lab is None: lab = sp.islands(model, N)[0]
    SM = (lab > 0) & (org[..., 3] > 0)
    Lr, Lo = luma(res), luma(org)
    out = {}
    # faithfulness
    la, lb = mx.to_lab(res[..., :3].astype(float)), mx.to_lab(org[..., :3].astype(float))
    ids = np.unique(lab[SM]); de = []; w = []
    for i in ids:
        m = SM & (lab == i)
        if m.sum() < 30: continue
        de.append(np.sqrt(((la[m].mean(0) - lb[m].mean(0)) ** 2).sum())); w.append(m.sum())
    out['dE_isl'] = float(np.average(de, weights=w))
    lba, lbb = blur(la, 4), blur(lb, 4)
    out['dE_pix'] = float(np.sqrt(((lba - lbb) ** 2).sum(-1))[SM].mean())
    er, eo = sob(Lr)[SM], sob(Lo)[SM]
    out['edge_r'] = float(np.corrcoef(er, eo)[0, 1])
    hr, sr, vr = hsv(blur(res[..., :3].astype(float), 3)); ho, so, vo = hsv(blur(org[..., :3].astype(float), 3))
    mk = SM & (so > .25) & (vo > .2) & (sr > .1)
    dh = np.abs((hr - ho + 180) % 360 - 180)
    out['hue_deg'] = float(dh[mk].mean()) if mk.any() else 0.
    out['sat_rat'] = float(sr[SM].mean() / max(so[SM].mean(), 1e-9))
    # artifacts
    sr_ = sm.streak(Lr, SM); s_r = sr_[2]
    key = ('so', orig)
    if key not in cache: cache[key] = sm.streak(Lo, SM)[2]
    so_ = sm.streak(Lo, SM)
    out['streak_n'] = sr_[0] / max(so_[0], 1e-9); out['streak_p90'] = sr_[1] / max(so_[1], 1e-9)
    out['streak_amp'] = s_r; out['streak_rat'] = s_r / max(cache[key], 1e-9)
    hl = 0; cnt = 0; con = []; lv = []
    for i in ids:
        m = SM & (lab == i)
        if m.sum() < 400: continue
        hl += (Lr[m] > np.percentile(Lo[m], 99) + 10).sum(); cnt += m.sum()
        con.append(Lr[m].std() / max(Lo[m].std(), 1e-6))
        lv.append(len(np.unique(np.rint(Lr[m]))))
    out['hl_pct'] = float(100 * hl / max(cnt, 1))
    h2, s2, v2 = hsv(res[..., :3].astype(float))
    spec = lambda s, v: float(((s < .15) & (v > .85))[SM].mean() * 100)
    out['spec_pct'] = spec(s2, v2) - spec(so, vo) if False else spec(s2, v2) - spec(*hsv(org[..., :3].astype(float))[1:])
    out['con_rat'] = float(np.median(con)) if con else 1.
    out['levels'] = int(np.median(lv)) if lv else 0
    out['invent_pct'] = float((np.abs(nd.gaussian_filter(Lr, 3) - nd.gaussian_filter(Lo, 3)) > 40)[SM].mean() * 100)
    # long straight line runs (streak_metric 'runs'): per 1000 SM texels, result vs orig
    rr = sm.measure(model, path, lab)['runs_per_ktex']; ko = ('ro', orig)
    if ko not in cache: cache[ko] = sm.measure(model, orig, lab)['runs_per_ktex']
    out['runs_k'] = rr; out['runs_k_orig'] = cache[ko]
    # direction of the ADDED detail D = hp(result) - hp(orig), hp = L - gauss(L,2): vert = share of its gradient energy from d/dx (= vertical
    # lines, 0.5 = no preference); aniso = energy weighted mean over islands>=400 of (l1-l2)/(l1+l2) of its structure tensor
    D = (Lr - nd.gaussian_filter(Lr, 2)) - (Lo - nd.gaussian_filter(Lo, 2))
    gx, gy = nd.sobel(D, 1), nd.sobel(D, 0)
    out['add_vert'] = float((gx * gx)[SM].sum() / max((gx * gx + gy * gy)[SM].sum(), 1e-9))
    an = []; aw = []
    for i in ids:
        m = SM & (lab == i)
        if m.sum() < 400: continue
        a_, b_, c_ = (gx * gx)[m].sum(), (gy * gy)[m].sum(), (gx * gy)[m].sum(); t_ = a_ + b_
        if t_ > 0: an.append(np.hypot(a_ - b_, 2 * c_) / t_); aw.append(t_)
    out['add_aniso'] = float(np.average(an, weights=aw)) if an else 0.
    # cleanliness: mean local luma std (3x3 window) over FLAT texels (sigma-1.5 gradient < 3/texel) = noise / grain in flat colour areas
    Lb = nd.gaussian_filter(Lr, 1.5); gm = np.hypot(nd.sobel(Lb, 1), nd.sobel(Lb, 0)) / 8
    flat = SM & (gm < 3)
    mu = nd.uniform_filter(Lr, 3); sd = np.sqrt(np.maximum(nd.uniform_filter(Lr * Lr, 3) - mu * mu, 0))
    out['flat_std'] = float(sd[flat].mean()) if flat.any() else 0.
    Lb = nd.gaussian_filter(Lo, 1.5); gm = np.hypot(nd.sobel(Lb, 1), nd.sobel(Lb, 0)) / 8
    flat = SM & (gm < 3); mu = nd.uniform_filter(Lo, 3); sd = np.sqrt(np.maximum(nd.uniform_filter(Lo * Lo, 3) - mu * mu, 0))
    out['flat_std_orig'] = float(sd[flat].mean()) if flat.any() else 0.
    # detail
    out['sharp_rat'] = float(sob(Lr, 0.01)[SM].mean() / max(sob(Lo, 0.01)[SM].mean(), 1e-9))
    hf = lambda L: (L - nd.gaussian_filter(L, 1.5))[SM].std()
    out['hf_rat'] = float(hf(Lr) / max(hf(Lo), 1e-9))
    # alpha
    out['a_soft'], out['a_block'], out['a_fringe'] = alpha_scores(res[..., 3], res, org)
    return {k: round(v, 3) if isinstance(v, float) else v for k, v in out.items()}

if __name__ == '__main__':
    a = sys.argv[1:]; model = a[0]; orig = None; files = []
    i = 1
    while i < len(a):
        if a[i] == '--orig': orig = a[i + 1]; i += 2
        elif a[i].startswith('--'): i += 1
        else: files.append(a[i]); i += 1
    lab = None
    for f in files:
        N = Image.open(f).size[0]
        if lab is None or lab.shape[0] != N: lab = sp.islands(model, N)[0]
        r = measure(model, f, orig, lab)
        print(json.dumps(dict(file=f, **r)), flush=True)
