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
import subprocess
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
# ---- props: our own art a quest's state leaves on a map (web/quest-props.js, docs/quests-fx-brief.md section 6)
variants = load(os.path.join(WEB, "map-variants.json")) if os.path.exists(os.path.join(WEB, "map-variants.json")) else {}
fx_dir = os.path.join(WEB, "extra_fx")
prop_sheets = {}


def prop_sheet(name):
    """web/extra_fx/<name>.{png,json} or None: both files must exist and the json must parse."""
    if name not in prop_sheets:
        png, meta = os.path.join(fx_dir, f"{name}.png"), os.path.join(fx_dir, f"{name}.json")
        prop_sheets[name] = load(meta) if os.path.exists(png) and os.path.exists(meta) else None
    return prop_sheets[name]


for q in quests:
    qid = q["id"]
    for i, p in enumerate(q.get("props") or []):
        where = f"props[{i}]"
        if not isinstance(p, dict):
            errors.append(f"{qid}: {where} is not an object")
            continue
        m = p.get("map")
        if not isinstance(m, str) or (m not in maps and variants.get(m) not in maps):
            errors.append(f"{qid}: {where} names unknown map {m!r}")
        else:
            info = map_info.get(m) or map_info.get(variants.get(m) or "") or {}
            at = p.get("at")
            if not (isinstance(at, list) and len(at) == 2 and all(isinstance(v, int) for v in at)):
                errors.append(f"{qid}: {where}.at must be two whole world pixels [x, y]")
            elif not (0 <= at[0] <= info.get("width", 0) and 0 <= at[1] <= info.get("height", 0)):
                errors.append(f"{qid}: {where}.at ({at[0]},{at[1]}) is outside {m} ({info.get('width')}x{info.get('height')})")
        name = p.get("sheet")
        meta = prop_sheet(name) if isinstance(name, str) and name else None
        if not isinstance(name, str) or not name:
            errors.append(f"{qid}: {where} needs a sheet name")
        elif meta is None:
            errors.append(f"{qid}: {where} sheet '{name}' is not web/extra_fx/{name}.png + .json")
        else:
            frame = meta.get("frame")
            if not (isinstance(frame, list) and len(frame) == 2 and all(isinstance(v, (int, float)) and v > 0 for v in frame)):
                errors.append(f"{qid}: {where} sheet '{name}' has no sane frame size")
            clips = meta.get("clips") or {}
            if p.get("clip") is not None and p["clip"] not in clips:
                errors.append(f"{qid}: {where} clip '{p['clip']}' is not in sheet '{name}' ({sorted(clips)})")
        if p.get("after") not in (None, "done", "accepted"):
            errors.append(f"{qid}: {where}.after is {p.get('after')!r}; use \"done\" or \"accepted\"")
        if p.get("layer") not in (None, "entity", "behind", "front"):
            errors.append(f"{qid}: {where}.layer is {p.get('layer')!r}; use \"entity\", \"behind\" or \"front\"")
        if "solid" in p and not isinstance(p["solid"], bool):
            errors.append(f"{qid}: {where}.solid must be true or false")
# ---- characters (NPCs) and unlock rules
import glob
scene_npcs = {}                      # (stage id, npc_id) -> set of (x, y) with a real position (0,0 = scripted/cutscene only)
for f in glob.glob(os.path.join(A, "scenes", "*.json")):
    sid = os.path.basename(f)[:-5]
    for n in load(f).get("npcs", []):
        if n.get("x") or n.get("y"):
            scene_npcs.setdefault((sid, n.get("npc_id")), set()).add((n["x"], n["y"]))
_extra = os.path.join(os.path.dirname(A), "extra_npcs.json")
if os.path.exists(_extra):                         # the quests' own characters stand where extra_npcs.json says
    for r in load(_extra).get("residents", []):
        scene_npcs.setdefault((r["map"], r["npc_id"]), set()).add((r["x"], r["y"]))
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

# ---- the objective types added with the large set, scenes, and wording
species_names = {d["name"] for d in load(os.path.join(A, "data/digimon.json"))["digimon"]}
extra_path = os.path.join(A, "data/extra_species.json")
if os.path.exists(extra_path):
    species_names |= {d["name"] for d in load(extra_path)["digimon"]}
for q in quests:
    qid = q["id"]
    for o in q["objectives"]:
        if o["type"] == "bring":
            if o["item"] not in item_names:
                errors.append(f"{qid}: bring item '{o['item']}' is not in the in-game item table")
            if not (1 <= o.get("count", 0) <= 99):
                errors.append(f"{qid}: bring count must be 1..99")
        elif o["type"] == "level":
            if not (2 <= o.get("level", 0) <= 99):
                errors.append(f"{qid}: level objective must be 2..99")
        elif o["type"] == "ownForm":
            if o["species"] not in species_names:
                errors.append(f"{qid}: ownForm species '{o['species']}' is not a known Digimon (digimon.json or extra_species.json)")
    if q.get("offer"):
        if not q["offer"].get("remindLines"):
            errors.append(f"{qid}: offer has no remindLines (the giver would fall back to ordinary chat mid-quest)")
        if not q["offer"].get("doneLines"):
            errors.append(f"{qid}: offer has no doneLines")
    # a scene may only move or speak as characters that stand on the giver's map (otherwise it is skipped and the plain lines are used)
    for where, sc, home in ([("offer.scene", q["offer"].get("scene"), q["offer"]["maps"])] if q.get("offer") else []) + \
            ([("doneScene", q.get("doneScene"), q["offer"]["maps"])] if q.get("offer") else []) + \
            [(f"objective {i + 1} scene", o.get("scene"), o.get("maps", [])) for i, o in enumerate(q["objectives"])]:
        if not sc:
            continue
        cast = set()
        for st in sc:
            for k in ("walk", "arrive", "face", "put", "look", "say", "together", "apart"):
                if isinstance(st.get(k), int):
                    cast.add(st[k])
        for npc in cast:
            if not any((m, npc) in scene_npcs for m in home):
                errors.append(f"{qid}: {where} uses npc {npc}, who does not stand on {home}")
    r = q.get("reward", {})
    if r.get("bits", 0) > 20000:
        errors.append(f"{qid}: reward of {r['bits']} bits is not sane")

known_flags = {r["flag"] for r in load(os.path.join(A, "data/chapter_progression.json"))["ladder"]}
for q in quests:
    fl = q.get("unlock", {}).get("flag")
    if fl is not None and fl not in known_flags:
        errors.append(f"{q['id']}: unlock.flag {fl} is not one of the decoded story-beat flags {sorted(known_flags)}")
for q in quests:
    r = q.get("requires", {}).get("done")
    if r and r not in ids:
        errors.append(f"{q['id']}: requires unknown quest '{r}'")
    fl = q.get("requires", {}).get("flag")
    if fl is not None and fl not in known_flags:
        errors.append(f"{q['id']}: requires flag {fl}, which is not one of the decoded story-beat flags {sorted(known_flags)}")

# ---- walkable ground: a scene never walks a character onto, or through, a wall
# The geometry lives in web/quest-walk.js (the module the game itself routes scripted walks with) and the check in
# tools/check_quest_walks.mjs, so the build and the runtime agree on what walkable means. A step whose place depends on
# where the PLAYER stands cannot be resolved without the game running: those are counted as skipped there, not failed.
walk_note = ""
try:
    walk = subprocess.run(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_quest_walks.mjs"), "--json"],
                          capture_output=True, text=True, timeout=600)
    data = json.loads(walk.stdout or "{}")
    problems = data.get("problems") or []
    hard = [p for p in problems if p.get("severity") == "fail"]
    for p in hard:
        where = f"{p['where']} step {p['step']}" if p.get("step") else p["where"]
        errors.append(f"{p['quest']}: {where} ({p['kind']}) on {p['map']} at ({p['x']},{p['y']}): {p['what']}")
    walk_note = (f"; walks: {data.get('checked', 0)} place(s) checked, {data.get('skipped', 0)} skipped "
                 f"(they depend on where the player stands), {len(problems) - len(hard)} note(s)")
except (OSError, ValueError, subprocess.SubprocessError) as e:
    walk_note = f"; walks: NOT CHECKED ({e})"

print(f"{len(quests)} quest(s) checked against {len(enemies)} enemies, {len(maps)} maps, {len(item_names)} item names{walk_note}")
for e in errors:
    print("  PROBLEM:", e)
print("OK" if not errors else f"{len(errors)} problem(s)")
sys.exit(1 if errors else 0)
