#!/usr/bin/env python3
"""Numbers check of the Digimon texture pieces tools on one model (default m003agum), no real files changed.
  python3 tools/digimon_tex_selftest.py [model]
cut -> fake Gemini (pieces x4 nearest) -> join -> compare; install + restore round trip in a temp hd-root."""
import hashlib, json, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image

T = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, T)
import digimon_tex_pieces as P, digimon_tex_join as J, pad_model_textures as pad

model = sys.argv[1] if len(sys.argv) > 1 else "m003agum"
tmp = tempfile.mkdtemp(prefix="dtex")
n, isl = P.cut(model, tmp)
d = f"{tmp}/{model}"
meta = json.load(open(f"{d}/pieces.json"))
print("pieces", n, "islands", isl, "patches", n - isl)
for p in meta["pieces"]:
    f = f"{d}/{p['name']}.png"
    im = Image.open(f)
    im.resize((im.size[0] * 4, im.size[1] * 4), Image.NEAREST).save(f)
hd = f"{J.W}/assets-hd/battle/textures/{model}.png"
ref = np.asarray(Image.open(hd).convert("RGBA"))
for fix in (False, True):
    S, gs, out, pasted, nf, nt = J.join(d, edge_fix=fix)[1:7]
    isl_mask = np.zeros((1024, 1024), bool)
    for p in meta["pieces"]:
        if p["kind"] == "island":
            c = p["crop"]
            isl_mask[c[1]:c[3], c[0]:c[2]] |= J.mask_of(p, c)
    diff = np.abs(out.astype(int) - ref.astype(int)).max(-1)
    prot = pad.patch_mask(model, 1024)
    hdp = np.asarray(Image.open(hd).convert("RGBA"))
    used = pad.used_mask(model, 1024)
    used = pad.used_mask(model, 1024)
    cmp = isl_mask & used & ~prot            # texels a triangle really samples (the unused rim is re-padded on purpose)
    print(f"edge_fix={fix}: atlas {S}, gemini scale {gs}, found {nf}/{nt}; max diff inside islands {int(diff[cmp].max())}; "
          f"differing px {int((diff[cmp] > 0).sum())}; patch rects == current HD: {bool((out[prot] == hdp[prot]).all())}")
    if not fix:
        cover = used & ~prot
        print(f"coverage: UV texels (1024 raster) {int(used.sum())}, covered by island or patch {int((used & (isl_mask | prot)).sum())} "
              f"= {100 * (used & (isl_mask | prot)).sum() / used.sum():.2f} %; all pieces' pasted == island mask: {bool((pasted == isl_mask).all())}")
# install + restore round trip in a temp hd-root
root = f"{tmp}/hd"
os.makedirs(f"{root}/battle/textures")
shutil.copy(hd, f"{root}/battle/textures/{model}.png")
shutil.copy(f"{J.W}/assets-hd/manifest.json", f"{root}/manifest.json")
sh = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
h0, m0 = sh(f"{root}/battle/textures/{model}.png"), sh(f"{root}/manifest.json")
Image.fromarray(out, "RGBA").save(f"{tmp}/j.png")
run = lambda *a: subprocess.run([sys.executable, f"{T}/digimon_tex_install.py", *a, "--hd-root", root, "--backup", f"{tmp}/bak"], check=True, capture_output=True, text=True).stdout.strip()
run(model, f"{tmp}/j.png")
print("installed differs from original:", sh(f"{root}/battle/textures/{model}.png") != h0)
run("--restore", model)
print("restore byte-identical:", sh(f"{root}/battle/textures/{model}.png") == h0 and sh(f"{root}/manifest.json") == m0)
shutil.rmtree(tmp)
