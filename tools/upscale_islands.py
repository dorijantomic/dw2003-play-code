#!/usr/bin/env python3
"""Island-separated ESRGAN/CUGAN upscale of a Digimon's ORIGINAL 256 texture into a 1024 page. Writes no game file.
  1) WSL:     python3 tools/upscale_islands.py --dump-labs <model> <dir>      (writes <dir>/<model>_lab256.npy, _lab1024.npy)
  2) Windows: L:/fibo/venv/Scripts/python.exe tools/upscale_islands.py <model> <src256.png> <base1024.png> <out.png> <chain> --labs <dir> [--pad 16]
  chain = comma list of model files in L:/upscale/models (e.g. 1x-DitherDeleterV3-Smooth,4x-Loyaldk-Kororo). Total scale must be 4.
Per 256 UV island (islands() of digimon_tex_spaced, 4-connected) the crop is padded by edge extension (nearest island texel), run
through the chain (spandrel, fp32), cropped; it replaces only 1024 texels that are inside a 1024 island AND inside that 256 island
(nearest 4x4 block). Everything else, and the alpha channel, stay as base1024.png. Needs spandrel in the venv (uv pip install spandrel).
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def dump_labs(model, d):
    """WSL step (needs node): island labels at 256 and 1024 -> <d>/<model>_lab<N>.npy"""
    import digimon_tex_spaced as sp
    for n in (256, 1024):
        np.save(f"{d}/{model}_lab{n}.npy", sp.islands(model, n)[0])

def main():
    a = sys.argv[1:]
    if a[0] == "--dump-labs":
        return dump_labs(a[1], a[2])
    model, src_p, base_p, out_p, chain = a[:5]
    pad = int(a[a.index("--pad") + 1]) if "--pad" in a else 16
    import torch
    from spandrel import ModelLoader
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    nets = []
    for c in chain.split(","):
        m = ModelLoader().load_from_file(f"{os.environ.get('UPSCALE_MODELS', 'L:/upscale/models')}/{c}.pth").to(dev).eval()
        nets.append(m)
    assert int(np.prod([m.scale for m in nets])) == 4
    src = np.asarray(Image.open(src_p).convert("RGBA"))
    base = np.asarray(Image.open(base_p).convert("RGBA")).copy()
    n0, N = src.shape[0], base.shape[0]
    labd = os.path.dirname(os.path.abspath(out_p)) if "--labs" not in a else a[a.index("--labs") + 1]
    lab0 = np.load(f"{labd}/{model}_lab{n0}.npy")
    lab1 = np.load(f"{labd}/{model}_lab{N}.npy")
    out = base.copy()
    objs = nd.find_objects(lab0)
    H, W = lab0.shape
    for i, sl in enumerate(objs):
        if sl is None: continue
        y0, y1 = max(sl[0].start - pad, 0), min(sl[0].stop + pad, H)
        x0, x1 = max(sl[1].start - pad, 0), min(sl[1].stop + pad, W)
        m = lab0[y0:y1, x0:x1] == i + 1
        rgb = src[y0:y1, x0:x1, :3]
        idx = nd.distance_transform_edt(~m, return_distances=False, return_indices=True)
        ext = rgb[idx[0], idx[1]]
        x = torch.from_numpy(ext.astype(np.float32) / 255).permute(2, 0, 1)[None].to(dev)
        with torch.no_grad():
            for net in nets:
                x = net(x).clamp(0, 1)
                x = torch.round(x * 255) / 255
        up = (x[0].permute(1, 2, 0).cpu().numpy() * 255 + 0.5).astype(np.uint8)
        k = 4
        mm = np.kron(m, np.ones((k, k), bool))
        full = np.zeros((N, N), bool); upf = np.zeros((N, N, 3), np.uint8)
        full[y0 * k:y1 * k, x0 * k:x1 * k] = mm
        upf[y0 * k:y1 * k, x0 * k:x1 * k] = up
        sel = full & (lab1 > 0)
        out[sel, :3] = upf[sel]
    out[..., 3] = base[..., 3]
    Image.fromarray(out).save(out_p)
    print("wrote", out_p)

if __name__ == "__main__":
    main()
