#!/usr/bin/env python3
"""Per-item obtain-path index — the item-side authenticity audit.

Joins every decoded item SOURCE into "how do you get ItemId N" for all 403 items,
and names the items with NO known source (like story_robot names unwired gates):

  cutscene   web/assets/data/item_grants.json          (wstag bytecode on_complete_setflags)
  native     web/assets/data/native_item_grants.json   (wstag native on_complete: raw-MIPS
                                                          set_flag(collection-bank, 1) calls the
                                                          event-VM path can't see; see
                                                          tools/extract_native_item_grants.py)
  talk       web/assets/data/talk_item_grants.json     (NPC on_close collection writes)
  shop       merchant_shops.json x shops.json          (bank-0x7a merchants; stock by shop_id)
  drop       enemies.json drop_item/drop_rate          (also the steal target, same field)

Output: web/assets/data/item_obtain_index.json
        {"items": {id: {name, sources: [{kind, ...}]}}, "unobtainable": [...]}

Run with --report for the human summary.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web/assets/data"
OUT = DATA / "item_obtain_index.json"


def load(name):
    return json.loads((DATA / name).read_text())


def main() -> int:
    effects = load("item_effects.json")["items"]  # id, name (decomp), category, prices
    by_id = {i["id"]: i for i in effects}
    name_to_id = {i["name"]: i["id"] for i in effects}

    sources = defaultdict(list)

    for g in load("item_grants.json")["grants"]:
        sources[g["item_id"]].append(
            {"kind": "cutscene", "stage": g["stage"], "event_id": g["event_id"]})

    for g in load("native_item_grants.json")["grants"]:
        if g.get("event_id") is None:
            continue  # unattributed native call site -- not a proven producer, see `ambiguous`
        sources[g["item_id"]].append(
            {"kind": "native", "stage": g["stage"], "event_id": g["event_id"], "offset": g["offset"]})

    for g in load("talk_item_grants.json")["grants"]:
        sources[g["item_id"]].append(
            {"kind": "talk", "stage": g["stage"], "npc_id": g["npc_id"]})

    shops = {s["shop_id"]: s for s in load("shops.json")["shops"]}
    shop_stages = defaultdict(list)
    for m in load("merchant_shops.json")["merchants"]:
        if m.get("kind") == "item_shop":
            shop_stages[m["shop_id"]].append(m["stage"])
    for sid, shop in shops.items():
        stages = sorted(set(shop_stages.get(sid, [])))
        for it in shop["items"]:
            sources[it["id"]].append(
                {"kind": "shop", "shop_id": sid, "stages": stages})

    enemies = load("enemies.json")
    enemies = enemies if isinstance(enemies, list) else enemies["enemies"]
    for e in enemies:
        drop = e.get("drop_item")
        if not drop or drop == "Null":
            continue
        iid = name_to_id.get(drop)
        if iid is None:
            print(f"WARN: enemy {e['enemy_id']} drops unknown item {drop!r}",
                  file=sys.stderr)
            continue
        sources[iid].append(
            {"kind": "drop", "enemy": e["enemy_id"], "rate": e.get("drop_rate")})

    items, unobtainable = {}, []
    for iid in sorted(by_id):
        rec = by_id[iid]
        srcs = sources.get(iid, [])
        items[str(iid)] = {"name": rec["name"], "category": rec["category"],
                           "sources": srcs}
        if not srcs:
            unobtainable.append({"id": iid, "name": rec["name"],
                                 "category": rec["category"]})

    OUT.write_text(json.dumps({"items": items, "unobtainable": unobtainable},
                              indent=1))
    kinds = defaultdict(int)
    for srcs in sources.values():
        for s in srcs:
            kinds[s["kind"]] += 1
    covered = sum(1 for i in by_id if sources.get(i))
    print(f"{len(by_id)} items: {covered} obtainable, {len(unobtainable)} without "
          f"a decoded source -> {OUT}")
    print("source records:", dict(kinds))

    if "--report" in sys.argv:
        by_cat = defaultdict(list)
        for u in unobtainable:
            by_cat[u["category"]].append(u["name"])
        for cat, names in sorted(by_cat.items()):
            print(f"\n[{cat}] {len(names)} unobtainable:")
            print("  " + ", ".join(names))
    return 0


if __name__ == "__main__":
    sys.exit(main())
