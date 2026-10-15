"""The quest authoring language (docs/quests-bible.md section 5 and 7).

A pack (pack_*.py) is a list of quests built with `quest(...)` and the goal helpers below. `tools/build_quests.py` turns the packs
into web/quests.json. The helpers fill in everything that is the same for every quest (the name tab from characters.json, the
places a giver stands in, the `met` unlock, the walking scene) so a pack only holds what is unique: the words, the goal, the pay.

    quest("beg_pest_gizamon", "Swamp pest control", who=57, place="s330",
          text="...", goal=[kill("Kunemon", 3, ["s330"])], pay=pay(300, ("Antidote Disk", 1)),
          offer=["...", "...", "Will you?"], remind=["...", "..."], done=["...", "..."], lvl=3)

Text may only use letters, digits, space and . , ' - : " ! ? (the game's own text format has no code for anything else); the
builder refuses anything else rather than letting the game silently drop it.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
WEB = os.path.join(ROOT, "web")
A = os.path.join(WEB, "assets")

PERSONA = json.load(open(os.path.join(HERE, "characters.json"), encoding="utf-8"))["by_npc_id"]
VARIANTS = json.load(open(os.path.join(WEB, "map-variants.json"), encoding="utf-8"))      # variant map -> canonical map
_GROUP = {}
for _v, _c in VARIANTS.items():
    _GROUP.setdefault(_c, [_c]).append(_v)

# characters behind a counter or a desk: they do not walk, so their quests are spoken in place
STAY = {20, 120, 121, 22, 23, 24, 183, 30, 255, 32, 36, 25, 26}

_scenes = {}


class BuildError(Exception):
    pass


PROBLEMS = []          # every authoring mistake found while the packs load; tools/build_quests.py prints them all and fails


def problem(msg):
    PROBLEMS.append(msg)


def canon(m):
    return VARIANTS.get(m, m)


def group(m):
    return _GROUP.get(canon(m), [canon(m)])


def _npcs_on(m):
    if m not in _scenes:
        p = os.path.join(A, "scenes", f"{m}.json")
        _scenes[m] = {n["npc_id"] for n in json.load(open(p, encoding="utf-8")).get("npcs", []) if (n.get("x") or n.get("y")) and not n.get("cutsceneOnly")} if os.path.exists(p) else set()
    return _scenes[m]


def maps_for(npc, place):
    """Every map of this place (the place and its variants) where that character really stands."""
    got = [m for m in group(place) if npc in _npcs_on(m)]
    if not got:
        problem(f"npc {npc} does not stand on {place} or its variants")
        return [canon(place)]
    return got


def name_of(npc):
    return PERSONA[str(npc)]["name"]


# ------------------------------------------------------------------ text
_OK = re.compile(r"^[A-Za-z0-9 .,'\-:\"!?]*$")


def lint(qid, what, text):
    if not _OK.match(text):
        bad = sorted(set(re.sub(r"[A-Za-z0-9 .,'\-:\"!?]", "", text)))
        problem(f"{qid}: {what} has characters the game text cannot show: {bad} in {text[:60]!r}")
    if len(text) > 260:
        problem(f"{qid}: {what} is {len(text)} characters; keep a line under 260 (it is read a page at a time)")


# ------------------------------------------------------------------ scenes
def _say(npc, name, text):
    return {"say": npc, "name": name, "text": text}


def _comes(npc, gap=40):
    return [{"walk": npc, "to": {"near": "player", "gap": gap}}, {"arrive": npc}]


def _home(npc):
    return [{"wait": 12}, {"walk": npc, "to": "origin"}, {"arrive": npc}]


def scene(npc, lines, ask=None, options=("I will do it", "Not now"), walk=True):
    """He comes over, says the first line, walks with the player and says the rest, asks, and both walk back."""
    if npc in STAY:
        return None
    name = name_of(npc)
    s = _comes(npc) + [_say(npc, name, lines[0])]
    if walk and len(lines) > 1:
        s.append({"together": npc, "dist": 130})
    s += [_say(npc, name, l) for l in lines[1:]]
    if ask:
        s.append({"ask": ask, "options": list(options)})
    if walk and len(lines) > 1:
        s.append({"apart": npc})
    return s + _home(npc)


# ------------------------------------------------------------------ goals
def kill(species, n, maps):
    sp = [species] if isinstance(species, str) else list(species)
    return {"type": "defeat", "species": sp, "count": n, "maps": [x for m in maps for x in group(m)]}


def go(place, label=None):
    o = {"type": "visit", "map": canon(place)}
    if label:
        o["label"] = label
    return o


def tour(places, n=None, label=None):
    ps = [canon(p) for p in places]
    o = {"type": "visitSet", "maps": ps, "count": n or len(ps)}
    if label:
        o["label"] = label
    return o


def fight(screens, at, label, scale=None, hp=None):
    sc = [screens] if isinstance(screens, int) else list(screens)
    o = {"type": "challenge", "screens": sc, "startAt": [x for m in at for x in group(m)], "label": label}
    if scale:
        o["scale"] = scale
    if hp:
        o["hpMult"] = hp
    return o


def duel(n):
    return {"type": "duelWin", "count": n}


def talk(npc, place, lines, label=None):
    """Speak to a character. Their reply is a walking scene unless they stand at a counter."""
    o = {"type": "talk", "npc": npc, "name": name_of(npc), "maps": maps_for(npc, place), "lines": list(lines), "_place": canon(place)}
    sc = scene(npc, lines)
    if sc:
        o["scene"] = sc
    if label:
        o["label"] = label
    return o


def bring(item, n=1, label=None):
    o = {"type": "bring", "item": item, "count": n}
    if label:
        o["label"] = label
    return o


def level(n, label=None):
    o = {"type": "level", "level": n}
    if label:
        o["label"] = label
    return o


def form(species, label=None):
    o = {"type": "ownForm", "species": species}
    if label:
        o["label"] = label
    return o


def pay(bits=0, *items):
    r = {}
    if bits:
        r["bits"] = bits
    if items:
        r["items"] = [{"name": i[0], "count": i[1] if len(i) > 1 else 1} if isinstance(i, tuple) else {"name": i, "count": 1} for i in items]
    return r


def _short(title):
    if len(title) <= 14:
        return title
    out = ""
    for w in title.split():
        if len(out) + len(w) + (1 if out else 0) > 14:
            break
        out += (" " if out else "") + w
    return out or title[:14]


# ------------------------------------------------------------------ the quest
def quest(id, title, who, place, text, goal, pay, offer, remind, done, ask="Take the job?", options=("I will do it", "Not now"),
          lvl=None, after=None, short=None, flag=None, seen=None, ordered=False, plain=False):
    """One quest handed out by character `who` standing in `place` (a map id; its night/story variants are found automatically).

    offer  the lines the giver says; the last one is the question
    remind what the giver says while the job is open (never the ordinary chat)
    done   what the giver says when it is handed in
    lvl    the party must have reached this level; after: another quest id that must be done first
    seen   place ids of which the player must have visited any one; flag: a read-only story flag (see the bible)
    plain  say the lines in place, no walking scene
    """
    name = name_of(who)
    maps = maps_for(who, place)
    if not isinstance(goal, list):
        goal = [goal]
    for what, lines in (("offer", offer), ("remind", remind), ("done", done)):
        if not lines:
            problem(f"{id}: needs {what} lines")
            continue
        for l in lines:
            lint(id, what, l)
    lint(id, "text", text)
    lint(id, "title", title)
    if len(title) > 32:
        problem(f"{id}: title {title!r} is over 32 characters (the pause list cuts it)")
    unlock = {"met": [{"npc": who, "map": canon(place)}]}
    for o in goal:                                       # never send the player to someone they have not seen yet
        if o["type"] == "talk":
            ref = {"npc": o["npc"], "map": o.pop("_place")}
            if ref not in unlock["met"]:
                unlock["met"].append(ref)
    if lvl:
        unlock["level"] = lvl
    if after:
        unlock["done"] = after
    if seen:
        unlock["visited"] = [canon(m) for m in seen]
    if flag:
        unlock["flag"] = flag
    q = {
        "id": id, "title": title, "giver": name, "short": short or _short(title), "text": text,
        "objectives": goal, "reward": pay,
        "unlock": unlock,
        "offer": {"npc": who, "name": name, "maps": maps, "lines": list(offer), "doneLines": list(done), "remindLines": list(remind)},
    }
    if len(q["short"]) > 14:
        problem(f"{id}: short title {q['short']!r} is {len(q['short'])} characters, the pause list shows 14")
    if ask and ask != "Take the job?":
        q["offer"]["ask"] = ask
    if after:
        q["requires"] = {"done": after}
    if ordered:
        q["ordered"] = True
    if not plain:
        sc = scene(who, offer, ask=ask, options=options)
        if sc:
            q["offer"]["scene"] = sc
        ds = scene(who, done, walk=False)
        if ds:
            q["doneScene"] = ds
    return q
