#!/usr/bin/env python3
"""Build web/assets/data/items.json as a projection of the disc-extracted item table.

ONE OWNER PER NUMBER. The disc's item numbers live in exactly one shipped file,
`web/assets/data/item_effects.json`, written by `tools/extract_item_effects.py`
from the master item table (D0x80041844) and consumable-effect table
(D0x8005cb54); `tests/item-effect-code-census.test.js` pins it to the disc bytes
in `web/assets/native/screens/resident.bin`. This script no longer writes its own
numbers — the previous version hand-authored them (PowerCharge 200 HP, chips +5,
prices off a rarity guess table) and drifted away from the disc. `items.json` is
now a pure projection of `item_effects.json`, so the two cannot disagree.

`web/assets/data/items.json` is not fetched by any browser JS; the runtime item
table is `engine/dw3/item-data.ts`, generated from item_effects.json by
`tools/build_item_data.py`. This file is kept for the tools/tests that read its
`catalog` and `items` (extract_dri_tables, build_merchants, cardmon-booster test,
verify_battle_ailment).

The `items` array carries the items that HAVE a use-effect — the disc's
`consumable` and `booster` records. Key items and gear/accessories are named in
`catalog` only; their numbers live in their own extracts (equipment.json /
engine/dw3/equipment.ts), not here.

Sources:
  ~/ddw3/rust/types/src/item_id.rs   — the 403 ItemId variant names (id = index)
  web/assets/data/item_effects.json  — the disc's per-item records (the numbers)
"""
import os

import json
import re
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ROOT = Path(__file__).parent.parent
EFFECTS = ROOT / "web" / "assets" / "data" / "item_effects.json"
OUT = ROOT / "web" / "assets" / "data" / "items.json"

STAT_LABEL = {"hp": "HP", "mp": "MP", "str": "STR", "def": "DEF", "spt": "SPT",
              "wis": "WIS", "spd": "SPD", "chr": "CHR"}


def parse_item_ids() -> list[str]:
    """The ItemId variant names, index = item id."""
    src = (DDW3 / "rust/types/src/item_id.rs").read_text()
    return [v.strip() for v in re.findall(r"^\t(.+),", src, re.MULTILINE)]


# ids 1-42 are the contiguous story/key-item block; late-story DDNA/Card/Pass/
# Badge/Egg/Mask/ID/Trophy names are key items too. Membership only — no numbers.
KEY_ITEM_NAME_RE = re.compile(
    r"DDNA|Card|Pass|Badge|Egg|DE(Sincerity|Knowledge)|Mask|Trophy|"
    r"Pack|Suit|Herb|Mike|FolderBag|TNTChip|ElDoradoID|RedSnapper|"
    r"FishingPole|TreeBoots|(Silver|Gold|Platinum|Koc)(ID|Card|Trophy)|"
    r"^(Silver|Gold|Platinum)ID$|CronyID",
)


def is_key_item(item_id: int, name: str) -> bool:
    if 1 <= item_id <= 42:
        return True
    return bool(KEY_ITEM_NAME_RE.search(name))


def describe(effect: str | None, value: int) -> str | None:
    """A one-line description derived from the disc's own effect code and value."""
    if effect == "hp":
        return f"Restores {value} HP."
    if effect == "mp":
        return f"Restores {value} MP."
    if effect in ("stat_hp", "stat_mp"):
        return f"Permanently raises max {STAT_LABEL[effect[5:]]} by {value}."
    if effect and effect.startswith("stat_"):
        return f"Permanently raises {STAT_LABEL[effect[5:]]} by {value}."
    if effect and effect.startswith("elem_"):
        return f"Permanently raises {effect[5:]} tolerance by {value}."
    if effect == "tp":
        return f"Grants {value} TP."
    if effect == "battle":
        return "Battle item."
    if effect == "booster":
        return "Opens a card booster pack."
    return None


def main() -> None:
    names = parse_item_ids()
    disc = json.loads(EFFECTS.read_text())["items"]
    by_id = {r["id"]: r for r in disc}

    items = []
    name_to_id = {}
    for row in disc:
        if row["category"] not in ("consumable", "booster"):
            continue  # key/equipment/accessory numbers live in their own extracts
        entry = {"id": row["id"], "name": row["name"], "category": row["category"]}
        if "effect" in row:
            entry["effect"] = row["effect"]
            entry["value"] = row.get("value", 0)
        entry["price"] = row["buy"]   # the disc's buy price (master record f1)
        entry["sell"] = row["sell"]   # the disc's sell price (master record f2)
        desc = describe(row.get("effect"), row.get("value", 0))
        if desc:
            entry["desc"] = desc
        items.append(entry)
        name_to_id[row["name"]] = row["id"]

    catalog = []
    for item_id, name in enumerate(names):
        if item_id == 0 or not name:  # skip Null
            continue
        jp = "\u00c1" in name  # untranslated (elemental tag) names keep their raw bytes
        rec = by_id.get(item_id)
        key = bool(rec and rec["category"] == "key") or is_key_item(item_id, name)
        if key:
            kind = "key"
        elif jp:
            kind = "equipment"
        elif rec and rec["category"] == "booster":
            kind = "booster"
        elif rec and rec["category"] == "consumable":
            eff = rec.get("effect")
            kind = "chip" if eff and (eff.startswith("stat_") or eff.startswith("elem_")
                                      or eff == "tp") else ("battle" if eff == "battle" else "consumable")
        else:
            kind = "equipment"
        row = {"id": item_id, "name": name, "type": kind, "key": key}
        if jp:
            row["untranslated"] = True
        catalog.append(row)

    OUT.write_text(json.dumps(
        {"items": items, "name_to_id": name_to_id, "catalog": catalog}, indent=2))
    print(f"Wrote {len(items)} items + {len(catalog)} catalog entries -> {OUT}")


if __name__ == "__main__":
    main()
