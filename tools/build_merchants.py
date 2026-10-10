#!/usr/bin/env python3
"""
Build the MERCHANT model from the decoded shop inventories.

DW3 reuses a small set of merchant NPCs across every city; each references an
*inventory id* (one of the 31 STITSHOP shops, tools/extract_shops.py) that scales
with city / server / story progress. So the faithful model is merchant TYPE →
ordered inventory tiers, not a per-city hardcode.

This classifies each of the 31 shops into a merchant type by its dominant item
category (item catalog `type` + battle-system.md id ranges) and emits the tier
lists. Sprite→type binding + per-city tier selection layer on top (merchant NPC
placement); this file is the inventory backbone.

Output: web/assets/data/merchants.json
  { "merchants": { "<type>": { "npc": "<digimon>", "service": "...",
                               "inventories": [shop_id, ...] }, ... },
    "shop_type": { "<shop_id>": "<type>" } }
"""

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
CAT = {c["id"]: c for c in json.loads((ROOT / "web/assets/data/items.json").read_text())["catalog"]}
SHOPS = json.loads((ROOT / "web/assets/data/shops.json").read_text())["shops"]

# merchant types reused across the world (NPC ↔ service, per the DW3 merchant model)
MERCHANTS = {
    "item":      {"npc": "Wizardmon", "service": "Item Shop (healing/battle/status items)"},
    "armory":    {"npc": "Gargomon",  "service": "Armory (weapons & armor)"},
    "accessory": {"npc": "Gomamon",   "service": "Pawn Shop (rings, gems, accessories)"},
    "chip":      {"npc": "Wizardmon", "service": "Chip Shop (permanent stat/elem chips)"},
    "special":   {"npc": "—",         "service": "Special / all-items (story/debug)"},
}


def refine(iid: int, t: str) -> str:
    if t == "equipment":
        if 97 <= iid <= 212:  return "weapon"
        if 213 <= iid <= 296: return "armor"
        if 297 <= iid <= 345: return "accessory"
    return t


def classify(items: list[dict]) -> str:
    from collections import Counter
    c = Counter(refine(it["id"], CAT.get(it["id"], {}).get("type", "?")) for it in items)
    weap_armor = c["weapon"] + c["armor"]
    acc = c["accessory"]
    chips = c["chip"]
    items_n = c["equipment"] + c["consumable"] + c["disk"]  # 43–96 group = item-shop goods
    keys = c["key"]
    if keys >= max(weap_armor, acc, chips, items_n):       return "special"
    if chips >= max(weap_armor, acc, items_n):             return "chip"
    if acc >= max(weap_armor, items_n):                    return "accessory"
    if weap_armor >= items_n:                              return "armory"
    return "item"


def main() -> None:
    shop_type = {}
    inv = {k: [] for k in MERCHANTS}
    for s in SHOPS:
        t = classify(s["items"])
        shop_type[s["shop_id"]] = t
        inv[t].append(s["shop_id"])

    merchants = {k: {**MERCHANTS[k], "inventories": inv[k]} for k in MERCHANTS}
    out = {"merchants": merchants, "shop_type": {str(k): v for k, v in shop_type.items()}}
    (ROOT / "web/assets/data/merchants.json").write_text(json.dumps(out, indent=2))
    for k, m in merchants.items():
        print(f"  {k:9} ({m['npc']}): {len(m['inventories'])} tiers → {m['inventories']}")


if __name__ == "__main__":
    main()
