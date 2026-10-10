# tools/seed_collision.py — rough first pass: blocks cells whose 16px region
# is near-black (the void outside walkways on these isometric maps).
# Run with /tmp/ddw3game-venv/bin/python from the repo root.
#
# Per-map EXTRA_RULES: optional dict mapping map stem -> predicate
#   predicate(mean_r, mean_g, mean_b) -> bool
# returning True means "also block this cell".
import json
from pathlib import Path

from PIL import Image

CELL = 16


def is_s500_water(r, g, b):
    """Block teal ocean water on s500 (Red Village, dock village on ocean).

    The ocean is a distinctive teal: green channel roughly 2x the red channel,
    blue channel ~1.3x red, and green at least 50.  Brown dock planks and red
    buildings all have R >= G, so the G/R > 2.0 guard is conservative —
    it leaves borderline cells walkable rather than blocking dock edges.
    Sampled water: R≈47 G≈103 B≈77 (G/R≈2.18, B/R≈1.63).
    """
    if r < 1:  # avoid division by zero; teal water always has some red
        return False
    return g / r > 2.0 and b / r > 1.3 and g > 50


EXTRA_RULES = {
    "s500": is_s500_water,
}

for map_png in sorted(Path("web/assets/maps").glob("*.png")):
    img = Image.open(map_png).convert("RGB")
    cols, rows = -(-img.width // CELL), -(-img.height // CELL)
    extra_rule = EXTRA_RULES.get(map_png.stem)
    blocked = []
    for r in range(rows):
        row = ""
        for c in range(cols):
            tile = img.crop((c*CELL, r*CELL, min((c+1)*CELL, img.width), min((r+1)*CELL, img.height)))
            px = list(tile.getdata())
            mr = sum(p[0] for p in px) / len(px)
            mg = sum(p[1] for p in px) / len(px)
            mb = sum(p[2] for p in px) / len(px)
            mean = (mr + mg + mb) / 3
            is_blocked = mean < 8
            if not is_blocked and extra_rule is not None:
                is_blocked = extra_rule(mr, mg, mb)
            row += "1" if is_blocked else "0"
        blocked.append(row)
    out = Path("web/assets/collision") / (map_png.stem + ".json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"cell": CELL, "cols": cols, "rows": rows, "blocked": blocked}))
    print(out, f"{sum(r.count('1') for r in blocked)}/{cols*rows} blocked")
