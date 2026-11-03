#!/usr/bin/env python3
"""Compose a Digimon HD texture from the ORIGINAL page and a FIBO (or other AI) result, offline only (installs nothing).
  python3 tools/digimon_tex_quest.py <model> --ai png[,png2,...] --out out.png [--orig png]
     [--agg median|mean]      several --ai files are combined per texel (median kills random streaks) before anything else
     [--match 1]              per island Lab mean/std match of the AI colours to the original (std ratio clamp 0.25..4)
     [--lf S]                 frequency split sigma (texels, masked gauss inside each island). out = LF + HF. 0 = off (plain AI)
     [--lfa A]                share of the AI low frequencies in LF (0 = LF fully from the original, default 0)
     [--hf G]                 gain of the AI high frequencies (default 1)
     [--hfo H]                share of the original's own high frequencies added (default 0)
     [--clip C]               AI HF clipped to +-C RGB units (0 = off)
     [--flat SS,SR]           masked bilateral (spatial SS texels, range SR RGB units) on the result: flattens grain, keeps strong edges
     [--sharp A]              luma unsharp mask (sigma 1.2) amount A on the result, applied after --flat
     [--hl M]                 luma clipped to the original island p99 + M (hue kept); off if omitted
     [--alpha-soft S]         alpha: gaussian(S) of the binary alpha, thresholded 0.5 with a smooth ramp, RGB bled outward 8 px
Defaults off -> output == AI image. orig default = digimon_tex_spaced.pick_src(model). Alpha = original unless --alpha-soft.
"""
import sys, os, json, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import digimon_tex_spaced as sp
import tex_quality as tq

def masked_gauss(img, mask, s):
    """gaussian inside mask only (normalised convolution), mask 2D bool, img HxWxC float"""
    w = mask.astype(float)
    num = np.stack([nd.gaussian_filter(img[..., c] * w, s) for c in range(img.shape[-1])], -1)
    den = nd.gaussian_filter(w, s)[..., None]
    return np.where(den > 1e-4, num / np.maximum(den, 1e-4), img)

def per_island(lab, fn, pad):
    for i, sl in enumerate(nd.find_objects(lab)):
        if sl is None: continue
        ys, xs = sl
        y0, y1 = max(ys.start - pad, 0), min(ys.stop + pad, lab.shape[0]); x0, x1 = max(xs.start - pad, 0), min(xs.stop + pad, lab.shape[1])
        fn(i + 1, (slice(y0, y1), slice(x0, x1)))

def lab_match(ai, org, lab, SM):
    out = ai.copy()
    la, lb = tq.to_lab(ai), tq.to_lab(org)
    res = la.copy()
    for i in np.unique(lab[SM]):
        m = SM & (lab == i)
        if m.sum() < 50:
            res[m] = la[m] - la[m].mean(0) + lb[m].mean(0); continue
        sa, sb = la[m].std(0), lb[m].std(0)
        r = np.clip(sb / np.maximum(sa, 1e-6), 0.25, 4)
        res[m] = (la[m] - la[m].mean(0)) * r + lb[m].mean(0)
    # back to RGB via inverse of tq.to_lab
    fy = (res[..., 0] + 16) / 116
    f = np.stack([fy + res[..., 1] / 500, fy, fy - res[..., 2] / 200], -1)
    t = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27))
    c = np.clip((t * tq.WP_) @ np.linalg.inv(tq.M_).T, 0, 1)
    c = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255
    out[SM] = c[SM]
    return out

def compose(model, ai_paths, orig_path=None, agg='median', match=False, lf=0., lfa=0., hf=1., hfo=0., clip=0., hl=None, alpha_soft=0., flat=None, sharp=0.):
    org = np.asarray(Image.open(orig_path or sp.pick_src(model)).convert('RGBA')).astype(float)
    N = org.shape[0]
    ais = [np.asarray(Image.open(p).convert('RGBA').resize((N, N), Image.BICUBIC) if Image.open(p).size[0] != N else Image.open(p).convert('RGBA')).astype(float) for p in ai_paths]
    ai = np.median(ais, 0) if (len(ais) > 1 and agg == 'median') else np.mean(ais, 0)
    lab = sp.islands(model, N)[0]
    SM = (lab > 0) & (org[..., 3] > 0)
    A = ai[..., :3]; O = org[..., :3]
    if match: A = lab_match(A, O, lab, SM)
    out = A.copy()
    if lf > 0:
        out = A.copy()
        pad = int(4 * lf) + 2
        def fn(i, sl):
            m = SM[sl] & (lab[sl] == i)
            a, o = A[sl], O[sl]
            la_, lo_ = masked_gauss(a, m, lf), masked_gauss(o, m, lf)
            LFc = (1 - lfa) * lo_ + lfa * la_
            HF = a - la_
            if clip > 0: HF = np.clip(HF, -clip, clip)
            r = LFc + hf * HF + hfo * (o - lo_)
            out[sl][m] = r[m]
        per_island(lab, fn, pad)
    if flat:
        ss, sr = flat
        out = sp.bilateral(out.astype(np.float32), SM, ss, sr).astype(float)
    if sharp > 0:
        Lc = tq.luma(out); d = Lc - nd.gaussian_filter(Lc, 1.2)
        out = np.where(SM[..., None], out + sharp * d[..., None], out)
    if hl is not None:
        Lo = tq.luma(O); Lc = tq.luma(out)
        for i in np.unique(lab[SM]):
            m = SM & (lab == i)
            if m.sum() < 50: continue
            cap = np.percentile(Lo[m], 99) + hl
            k = m & (Lc > cap)
            if k.any(): out[k] = out[k] * (cap / np.maximum(Lc[k], 1))[:, None]
    out = np.clip(out, 0, 255)
    res = np.concatenate([out, org[..., 3:4]], -1)
    res[~SM, :3] = O[~SM] if True else res[~SM, :3]
    if alpha_soft > 0:
        B = (org[..., 3] > 127).astype(float)
        g = nd.gaussian_filter(B, alpha_soft)
        a = np.clip((g - 0.5) * 2.5 + 0.5, 0, 1); a = a * a * (3 - 2 * a)
        # bleed colour outward from opaque (alpha>127 or SM) texels
        src = SM | (B > 0)
        idx = nd.distance_transform_edt(~src, return_distances=False, return_indices=True)
        d = nd.distance_transform_edt(~src)
        col = res[..., :3][idx[0], idx[1]]
        use = (~src) & (d <= 8)
        res[..., :3] = np.where(use[..., None], col, res[..., :3])
        res[..., 3] = np.where(a > 0.01, a * 255, 0)
    return np.clip(np.rint(res), 0, 255).astype(np.uint8)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('model'); p.add_argument('--ai', required=True); p.add_argument('--out', required=True); p.add_argument('--orig')
    p.add_argument('--agg', default='median'); p.add_argument('--match', type=int, default=0); p.add_argument('--lf', type=float, default=0)
    p.add_argument('--lfa', type=float, default=0); p.add_argument('--hf', type=float, default=1); p.add_argument('--hfo', type=float, default=0)
    p.add_argument('--clip', type=float, default=0); p.add_argument('--hl', type=float); p.add_argument('--alpha-soft', type=float, default=0); p.add_argument('--flat'); p.add_argument('--sharp', type=float, default=0)
    a = p.parse_args()
    r = compose(a.model, a.ai.split(','), a.orig, a.agg, bool(a.match), a.lf, a.lfa, a.hf, a.hfo, a.clip, a.hl, a.alpha_soft, tuple(float(x) for x in a.flat.split(',')) if a.flat else None, a.sharp)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    Image.fromarray(r, 'RGBA').save(a.out)
