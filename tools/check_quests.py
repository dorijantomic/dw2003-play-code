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
map_info = {m["id"]: m for m in load(os.path.join(A, "manifest.json"))["maps"]}
maps = set(map_info)
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
        elif o["type"] == "challenge":
            for scr in o.get("screens", [o.get("screen")]):
                party = fe.get(str(scr))
                if not party:
                    errors.append(f"{qid}: challenge screen {scr} is not a real encounter screen")
                else:
                    for p in party:
                        if p["name"] not in enemies:
                            errors.append(f"{qid}: screen {scr} holds unknown enemy '{p['name']}'")
            if o.get("scale", 16) < 8 or o.get("scale", 16) > 40:
                errors.append(f"{qid}: scale {o.get('scale')} is outside a sane range (16 = normal)")
            if not (0.25 <= o.get("hpMult", 1) <= 4):
                errors.append(f"{qid}: hpMult {o.get('hpMult')} is outside a sane range")
            for m in o.get("startAt", []):
                if m not in maps:
                    errors.append(f"{qid}: startAt names unknown map '{m}'")
        elif o["type"] == "visitSet":
            for m in o["maps"]:
                if m not in maps:
                    errors.append(f"{qid}: visitSet names unknown map '{m}'")
            if not (1 <= o["count"] <= len(set(o["maps"]))):
                errors.append(f"{qid}: visitSet count {o['count']} must be between 1 and the number of distinct maps")
        elif o["type"] == "duelWin":
            if not isinstance(o.get("count"), int) or o["count"] < 1:
                errors.append(f"{qid}: duelWin needs a positive integer count")
        elif o["type"] == "reach":
            m = map_info.get(o["map"])
            if not m:
                errors.append(f"{qid}: unknown map '{o['map']}'")
            else:
                for end in ("from", "to"):
                    pt = o[end]
                    if not (0 <= pt["x"] <= m["width"] and 0 <= pt["y"] <= m["height"]):
                        errors.append(f"{qid}: reach '{end}' ({pt['x']},{pt['y']}) is outside {o['map']} ({m['width']}x{m['height']})")
                    if pt["r"] <= 0:
                        errors.append(f"{qid}: reach '{end}' radius must be positive")
    for m in q.get("acceptAt", []):
        if m not in maps:
            errors.append(f"{qid}: acceptAt names unknown map '{m}'")
    for it in q.get("reward", {}).get("items", []):
        if it["name"] not in item_names:
            errors.append(f"{qid}: reward item '{it['name']}' is not in the in-game item table")
# ---- characters (NPCs) and unlock rules
import glob
scene_npcs = {}                      # (stage id, npc_id) -> set of (x, y) with a real position (0,0 = scripted/cutscene only)
for f in glob.glob(os.path.join(A, "scenes", "*.json")):
    sid = os.path.basename(f)[:-5]
    for n in load(f).get("npcs", []):
        if n.get("x") or n.get("y"):
            scene_npcs.setdefault((sid, n.get("npc_id")), set()).add((n["x"], n["y"]))
char_ids = {c["id"] for c in load(os.path.join(A, "manifest.json")).get("characters", [])}

def check_npc(qid, what, ref):
    for m in ref["maps"]:
        if m not in maps:
            errors.append(f"{qid}: {what} names unknown map '{m}'")
    if not any((m, ref["npc"]) in scene_npcs for m in ref["maps"]):
        errors.append(f"{qid}: {what}: npc {ref['npc']} has no field position on any of {ref['maps']}")

for q in quests:
    qid = q["id"]
    for o in q["objectives"]:
        if o["type"] == "talk":
            check_npc(qid, "talk objective", o)
    for key in ("offer", "turnIn"):
        if key in q:
            check_npc(qid, key, q[key])
            if not q[key].get("name"):
                errors.append(f"{qid}: {key} needs a name")
    if "offer" in q and not q["offer"].get("lines"):
        errors.append(f"{qid}: offer needs lines")
    u = q.get("unlock", {})
    for m in u.get("visited", []):
        if m not in maps:
            errors.append(f"{qid}: unlock.visited names unknown map '{m}'")
    if u.get("done") and u["done"] not in ids:
        errors.append(f"{qid}: unlock.done names unknown quest '{u['done']}'")
    for r in u.get("met", []):
        if r["map"] not in maps or (r["map"], r["npc"]) not in scene_npcs:
            errors.append(f"{qid}: unlock.met: npc {r['npc']} has no field position on '{r['map']}'")
    if u.get("partner") and u["partner"] not in char_ids:
        errors.append(f"{qid}: unlock.partner '{u['partner']}' is not a character in the manifest")

known_flags = {r["flag"] for r in load(os.path.join(A, "data/chapter_progression.json"))["ladder"]}
for q in quests:
    r = q.get("requires", {}).get("done")
    if r and r not in ids:
        errors.append(f"{q['id']}: requires unknown quest '{r}'")
    fl = q.get("requires", {}).get("flag")
    if fl is not None and fl not in known_flags:
        errors.append(f"{q['id']}: requires flag {fl}, which is not one of the decoded story-beat flags {sorted(known_flags)}")

print(f"{len(quests)} quest(s) checked against {len(enemies)} enemies, {len(maps)} maps, {len(item_names)} item names")
for e in errors:
    print("  PROBLEM:", e)
print("OK" if not errors else f"{len(errors)} problem(s)")
sys.exit(1 if errors else 0)
