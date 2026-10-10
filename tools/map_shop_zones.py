#!/usr/bin/env python3
"""
Assign each scene shop-zone its real STITSHOP shop by stock overlap (idempotent).

The walker's shop zones carry a hand-authored `stock` list; the original game opens
one of the 31 decoded shops (tools/extract_shops.py). The field→shop index isn't in
our decoded scene data, so we map each zone to the real shop whose stock best matches
the hand list (Jaccard overlap) and stamp `shop_id` on the zone. game.js then draws
the real stock (falling back to the hand list if unmatched).
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
SCENES = ROOT / "web/assets/scenes"
SHOPS = json.loads((ROOT / "web/assets/data/shops.json").read_text())["shops"]


def best_shop(stock: list[int]) -> tuple[int, float]:
    want = set(stock)
    best_id, best_j = -1, 0.0
    for s in SHOPS:
        have = {i["id"] for i in s["items"]}
        if not have:
            continue
        j = len(want & have) / len(want | have)
        if j > best_j:
            best_id, best_j = s["shop_id"], j
    return best_id, best_j


def main() -> None:
    changed = 0
    for path in sorted(SCENES.glob("s*.json")):
        scene = json.loads(path.read_text())
        dirty = False
        for z in scene.get("zones", []):
            if isinstance(z, dict) and z.get("type") == "shop" and "stock" in z:
                sid, j = best_shop(z["stock"])
                if sid >= 0 and z.get("shop_id") != sid:
                    z["shop_id"] = sid
                    dirty = True
                    print(f"{path.stem}: zone → shop {sid} (overlap {j:.0%})")
        if dirty:
            path.write_text(json.dumps(scene, indent=1))
            changed += 1
    print(f"Stamped shop_id on {changed} scene(s)")


if __name__ == "__main__":
    main()
