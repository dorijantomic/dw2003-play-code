#!/usr/bin/env python3
"""Install a joined Digimon texture atlas as the game's HD model texture, with backup; or restore.

  python3 tools/digimon_tex_install.py <model> <joined.png> [--backup dir] [--hd-root dir]
  python3 tools/digimon_tex_install.py --restore <model> [--backup dir] [--hd-root dir]

The game loads web/assets-hd/battle/textures/<model>.png (listed in assets-hd/manifest.json). Backup default
~/hd-backup/digimon-tex-<YYYY-MM-DD>/ (the first copy of the day is kept, never overwritten). The manifest is only touched
(and backed up as manifest.json) when it has no entry for the file yet. --restore with no --backup uses the newest
digimon-tex-* folder holding the model. The atlas must be square, a power of two, 1024..4096 (the game reads scale = width/256 from the image).
"""
import datetime, glob, json, os, shutil, sys

HOME = os.path.expanduser("~")
a = sys.argv[1:]
opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
if not a:
    sys.exit(__doc__)
root = opt("--hd-root", f"{HOME}/dw2003-play-integration/web/assets-hd")
restore = "--restore" in a
pos = [x for i, x in enumerate(a) if not x.startswith("--") and (i == 0 or a[i - 1] not in ("--backup", "--hd-root"))]
model = pos[0]
rel = f"battle/textures/{model}.png"
dst, man = f"{root}/{rel}", f"{root}/manifest.json"
if restore:
    bak = opt("--backup") or next(iter(sorted((d for d in glob.glob(f"{HOME}/hd-backup/digimon-tex-*") if os.path.exists(f"{d}/{model}.png")), reverse=True)), None)
    if not bak:
        sys.exit("no backup found")
    shutil.copyfile(f"{bak}/{model}.png", dst)
    if os.path.exists(f"{bak}/manifest.json"):
        shutil.copyfile(f"{bak}/manifest.json", man)
    print(f"{model}: restored from {bak}")
    sys.exit(0)
from PIL import Image
src = pos[1]
w, h = Image.open(src).size
if w != h or w not in (1024, 2048, 4096):
    sys.exit(f"atlas is {w}x{h}: must be 1024, 2048 or 4096 square")
bak = opt("--backup", f"{HOME}/hd-backup/digimon-tex-{datetime.date.today().isoformat()}")
os.makedirs(bak, exist_ok=True)
if os.path.exists(dst) and not os.path.exists(f"{bak}/{model}.png"):
    shutil.copyfile(dst, f"{bak}/{model}.png")
os.makedirs(os.path.dirname(dst), exist_ok=True)
shutil.copyfile(src, dst)
m = json.load(open(man))
if not any(e.get("path") == rel and not e.get("native") for e in m["assets"]):
    if not os.path.exists(f"{bak}/manifest.json"):
        shutil.copyfile(man, f"{bak}/manifest.json")
    m["assets"] = [e for e in m["assets"] if e.get("path") != rel] + [dict(path=rel, sourceSize=[256, 256], scale=4,
        processing=dict(assetClass="medium-prerendered", method="gemini-pieces"), alphaMode="binary")]
    m["assets"].sort(key=lambda e: e["path"])
    json.dump(m, open(man, "w"), indent=1)
    print("manifest entry added")
print(f"{model}: installed {src} -> {dst}; backup {bak}")
