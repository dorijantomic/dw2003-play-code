#!/usr/bin/env python3
"""
Extract the item-acquisition map (where/when each item is obtained) from the
decoded story events — NO decompilation required.

Source of truth:
  web/assets/data/scripted_battles.json  — every event's `on_complete_setflags`.
  ~/ddw3/rust/types/src/item_id.rs        — ItemId enum (id → name).

Mechanism (proven, see get-flag-banked-predicate-system.md §banks 0x80-0x8e):
  An event grants an item by writing a *collection-bank* flag on completion.
  A set_flag id whose bank ((id>>8)&0xfe) is in 0x80..0x9e is a collection write;
  the granted ItemId is the low 9 bits (id & 0x1ff). Validated against the real
  game: s420→SeiryuBadge(9)+SilverID(40), s421→BlueIDPass(22), s445→AgumonDDNA(6),
  s450→VeemonDDNA(35), s490→GuilmonDDNA(34)+KumamonDDNA(395), s270→FolderBag(402).

Output: web/assets/data/item_grants.json
  { "grants": [ {stage, entry, flag_id, item_id, item_name, key}, ... ] }
"""

import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SB = ROOT / "web/assets/data/scripted_battles.json"
OUT = ROOT / "web/assets/data/item_grants.json"

# ids 1..42 plus DDNA/Card/Pass/Badge/Egg/Mask/Trophy/Bag = story key items
KEY_RE = re.compile(r"DDNA|Card|Pass|Badge|Egg|DE(Sincerity|Knowledge)|Mask|"
                    r"Trophy|Pack|Suit|Herb|Mike|FolderBag|ID$|Mod")


def item_names() -> list[str]:
    src = (DDW3 / "rust/types/src/item_id.rs").read_text()
    return re.findall(r"^\t(\w+),", src, re.M)


def is_key(item_id: int, name: str) -> bool:
    return 1 <= item_id <= 42 or bool(KEY_RE.search(name))


def main() -> None:
    names = item_names()
    sb = json.loads(SB.read_text())
    grants = []
    for stage, v in sb.items():
        for e in v["events"]:
            for s in e.get("on_complete_setflags", []):
                fid = s["id"]
                bank = (fid >> 8) & 0xFE
                if not (0x80 <= bank <= 0x9E):
                    continue
                item_id = fid & 0x1FF
                name = names[item_id] if item_id < len(names) else f"item#{item_id}"
                grants.append({
                    "stage": stage,
                    "entry": e.get("esdmg_entry"),
                    "event_id": e["id"],
                    "flag_id": fid,
                    "item_id": item_id,
                    "item_name": name,
                    "key": is_key(item_id, name),
                })
    grants.sort(key=lambda g: (g["stage"], g["item_id"]))
    OUT.write_text(json.dumps({"grants": grants}, indent=2, ensure_ascii=False))
    keyn = sum(1 for g in grants if g["key"])
    print(f"Wrote {len(grants)} item grants ({keyn} key items) → {OUT}")
    for g in grants:
        tag = " [KEY]" if g["key"] else ""
        print(f"  {g['stage']:5} entry {str(g['entry']):>4}  "
              f"{g['item_name']} (#{g['item_id']}){tag}")


if __name__ == "__main__":
    main()
