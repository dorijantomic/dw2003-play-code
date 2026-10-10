#!/usr/bin/env python3
"""Build the optional 2010 Xros Wars Greymon fan model from m005grey.

The original skeletal animation, action scripts, and UV layout remain intact.
Extra armor is rigidly attached to existing bones, so it follows every clip.
"""

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "web/assets/battle/models/m005grey/anim.json"
TARGET = ROOT / "web/assets/battle/models/m005xros/anim.json"
TEXTURE = ROOT / "web/assets/battle/textures/m005xros.png"
GENERATED = ROOT / "data/custom/m005xros-paint.png"


def add_fin(bone, base, tip, uv=((106, 44), (127, 44), (117, 68))):
    """Add a closed triangular armor fin, attached to this animated bone."""
    start = len(bone["verts"])
    bone["verts"].extend([list(p) for p in (*base, tip)])
    triangles = ((0, 1, 3), (1, 2, 3), (2, 0, 3), (0, 2, 1))
    for tri in triangles:
        bone["faces"].append([
            *(start + i for i in tri),
            *(v for i in tri for v in uv[i % 3]),
        ])


def main():
    model = json.loads(BASE.read_text())
    model["folder"] = "m005xros"
    model["custom_variant"] = "Greymon (2010 Xros Wars fan model)"
    body, head = model["bones"][0], model["bones"][2]

    # The original horn vertices are already part of the animated head mesh.
    # Extend them instead of adding disconnected horns that would float in poses.
    head["verts"][46] = [0, -970, -1210]
    head["verts"][33] = [-1020, -670, 25]
    head["verts"][35] = [1020, -670, 25]

    # Silver shoulder shields and a row of dorsal fins follow the torso bone.
    for side in (-1, 1):
        add_fin(body, [
            (side * 220, -240, -80),
            (side * 340, -150, 20),
            (side * 280, -300, 100),
        ], (side * 610, -530, -100))
    for z, height, width in ((-210, -540, 115), (10, -600, 135), (220, -520, 105)):
        add_fin(body, [
            (-width, -240, z - 55),
            (width, -240, z - 55),
            (0, -180, z + 95),
        ], (0, height, z + 20))

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(model, separators=(",", ":")))

    # Image generation gives the paint; the exact old mask keeps all UV islands
    # fixed and keeps the empty part of the page genuinely transparent.
    paint = Image.open(GENERATED).convert("RGBA").resize((1024, 1024), Image.Resampling.LANCZOS)
    mask = Image.open(ROOT / "web/assets/battle/textures/m005grey.png").convert("RGBA").getchannel("A")
    paint.putalpha(mask)
    paint.save(TEXTURE)

    index_path = ROOT / "web/assets/battle/models/index.json"
    index = json.loads(index_path.read_text())
    if "m005xros" not in index:
        index.insert(index.index("m005grey") + 1, "m005xros")
        index_path.write_text(json.dumps(index))

    map_path = ROOT / "web/assets/battle/model_map.json"
    model_map = json.loads(map_path.read_text())
    # Keep the existing game model until the distinct silhouette is validated.
    model_map["Greymon2010"] = "m005xros"
    map_path.write_text(json.dumps(model_map, indent=2) + "\n")
    print(f"Built {TARGET.relative_to(ROOT)} and {TEXTURE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
