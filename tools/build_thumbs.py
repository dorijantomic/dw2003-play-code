"""
Stitches every stage in the ddw3 repo and writes downscaled thumbnails to
web/assets/thumbs/sNNN.png plus an index.json with real map dimensions
(needed to translate thumbnail clicks back to map pixels).

Used by the door-wiring tool (web/wire.html). Thumbs are regenerable and
gitignored. Run: /tmp/ddw3game-venv/bin/python tools/build_thumbs.py
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

# The extracted ddw3 data tree. Override with DDW3_DIR; defaults to ~/ddw3.
DDW3 = Path(os.environ.get("DDW3_DIR") or (os.environ.get("DDW3_DIR") or (os.environ.get("DDW3_DIR") or os.path.expanduser("~/ddw3"))))
OUT = Path(__file__).resolve().parent.parent / "web/assets/thumbs"
THUMB_W = 320

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    packs = sorted(DDW3.glob("map/dw2003/z_stage/s*pack.toml"))
    for i, pack in enumerate(packs):
        sid = pack.stem[:-4]  # s200pack -> s200
        thumb_path = OUT / f"{sid}.png"
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_png = str(Path(tmpdir) / "map.png")
            r = subprocess.run(
                [sys.executable, "tools/stitch-map.py", pack.relative_to(DDW3).as_posix(),
                 "-o", tmp_png],
                cwd=DDW3, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"{sid}: stitch failed ({r.stderr.strip().splitlines()[-1] if r.stderr else '?'})")
                continue
            img = Image.open(tmp_png)
            w, h = img.size
            scale = THUMB_W / w
            img.resize((THUMB_W, max(1, round(h * scale)))).save(thumb_path)
            index[sid] = {"w": w, "h": h}
        if (i + 1) % 25 == 0:
            print(f"{i+1}/{len(packs)} done")
    (OUT / "index.json").write_text(json.dumps(index, indent=0))
    print(f"wrote {len(index)} thumbs + index.json")

if __name__ == "__main__":
    main()
