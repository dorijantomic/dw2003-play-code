#!/usr/bin/env python3
"""Check web/quests.json against the game's own data, so a quest can never name a species, map or item
that does not exist.

  * defeat objectives: every species must be a real enemy (assets/data/enemies.json) and, when the
    objective names maps, the species must actually roam on at least one of them
    (stage_encounters.json zones with a rate above zero -> field_encounters.json one-member parties);
  * visit objectives and defeat maps must be real stage ids (assets/manifest.json);
  * reward items must be in the in-game item name table (assets/data/battlecmd/esitmnam.json);
  * ids are unique and every `requires.done` points at a real quest.

Usage: python3 tools/check_quests.py        (exit status 1 if anything is wrong)
"""
import collections
import json
import os
import sys

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
A = os.path.join(WEB, "assets")
load = lambda p: json.load(open(p, encoding="utf-8"))

quests = load(os.path.join(WEB, "quests.json"))["quests"]
enemies = {e["enemy_id"] for e in load(os.path.join(A, "data/enemies.json"))["enemies"]}
maps = {m["id"] for m in load(os.path.join(A, "manifest.json"))["maps"]}
fe = load(os.path.join(A, "data/field_encounters.json"))["screens"]
se = load(os.path.join(A, "data/stage_encounters.json"))["stages"]
item_names = load(os.path.join(A, "data/battlecmd/esitmnam.json"))
if isinstance(item_names, dict):
    item_names = [v for v in item_names.values() if isinstance(v, str)] or [x for v in item_names.values() if isinstance(v, list) for x in v if isinstance(x, str)]
item_names = set(item_names)

roams = collections.defaultdict(set)           # species -> stages where it is rolled while walking
for stage, v in se.items():
    for z in v["zones"]:
        if z.get("rate_level", 0) <= 0:
            continue
        for scr in z["slots"]:
            party = fe.get(str(scr)) if scr else None
            if party and len(party) == 1:
                roams[party[0]["name"]].add("s" + stage)

errors, ids = [], set()
for q in quests:
    qid = q.get("id", "?")
    if qid in ids:
        errors.append(f"{qid}: duplicate id")
    ids.add(qid)
    for o in q.get("objectives", []):
        if o["type"] == "defeat":
            for sp in o["species"]:
                if sp not in enemies:
                    errors.append(f"{qid}: unknown enemy '{sp}'")
                elif o.get("maps") and not (roams[sp] & set(o["maps"])):
                    errors.append(f"{qid}: '{sp}' does not roam on {o['maps']} (it roams on {sorted(roams[sp])[:6]})")
            for m in o.get("maps", []):
                if m not in maps:
                    errors.append(f"{qid}: unknown map '{m}'")
        elif o["type"] == "visit":
            if o["map"] not in maps:
                errors.append(f"{qid}: unknown map '{o['map']}'")
    for it in q.get("reward", {}).get("items", []):
        if it["name"] not in item_names:
            errors.append(f"{qid}: reward item '{it['name']}' is not in the in-game item table")
for q in quests:
    r = q.get("requires", {}).get("done")
    if r and r not in ids:
        errors.append(f"{q['id']}: requires unknown quest '{r}'")

print(f"{len(quests)} quest(s) checked against {len(enemies)} enemies, {len(maps)} maps, {len(item_names)} item names")
for e in errors:
    print("  PROBLEM:", e)
print("OK" if not errors else f"{len(errors)} problem(s)")
sys.exit(1 if errors else 0)
