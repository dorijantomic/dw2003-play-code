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


_EXTRA = os.path.join(WEB, "extra_npcs.json")
_RESIDENTS = json.load(open(_EXTRA, encoding="utf-8")).get("residents", []) if os.path.exists(_EXTRA) else []


def _npcs_on(m):
    if m not in _scenes:
        p = os.path.join(A, "scenes", f"{m}.json")
        _scenes[m] = {n["npc_id"] for n in json.load(open(p, encoding="utf-8")).get("npcs", []) if (n.get("x") or n.get("y")) and not n.get("cutsceneOnly")} if os.path.exists(p) else set()
        _scenes[m] |= {r["npc_id"] for r in _RESIDENTS if r["map"] == m}      # the quests' own characters (tools/make_quest_sprites.py)
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


# ------------------------------------------------------------------ scene events (web/quest-scenes.js)
# The steps below need something the walking-and-talking vocabulary does not have: our own effect art, the screen, a
# fight, the player's own height, or another map. They are data like every other step; the game performs them
# (web/quest-fx.js), and a step it cannot run is skipped, never waited on. See docs/quests-fx-brief.md for the art.

def fx(name, at=None, sheet=None, clip=None, layer=None, near=None, dx=0, dy=0, fall=None, slide=None, rise=None, scale=None):
    """Place one of our own effect sheets (web/extra_fx/<sheet>.png) on the map.

    at     a world point [x, y], or near=<npc or "player"> with dx/dy to stand it relative to a character
    layer  "entity" (default: sorted with the people), "behind" (over the map, behind every person) or "front"
    scale  drawn that many times its cell (a giant is 3-4x a person's height); 1 = the sheet's own pixels
    fall   {"floor": y, "step": 0.75, "bounce": True} -- gravity with -v/3 bounces, settling on the floor
    slide  {"to": [x, y], "frames": 30}   rise  {"pixels": 60, "frames": 30}
    """
    step = {"fx": name}
    if sheet:
        step["sheet"] = sheet
    if scale is not None:
        step["scale"] = float(scale)
    if at is not None:
        step["at"] = [int(at[0]), int(at[1])]
    elif near is not None:
        step["at"] = {"near": near, "dx": dx, "dy": dy}
    if clip:
        step["clip"] = clip
    if layer:
        step["layer"] = layer
    for key, value in (("fall", fall), ("slide", slide), ("rise", rise)):
        if value:
            step[key] = value
    return step


def fx_play(name, clip, loop=None):
    """Switch a placed effect's clip (its sheet names the clips)."""
    step = {"fxplay": name, "clip": clip}
    if loop is not None:
        step["loop"] = bool(loop)
    return step


def fx_move(name, fall=None, slide=None, rise=None):
    """Start a motion on an effect that is already placed."""
    step = {"fxmove": name}
    for key, value in (("fall", fall), ("slide", slide), ("rise", rise)):
        if value:
            step[key] = value
    return step


def fx_wait(name):
    """Wait until that effect has arrived (or is gone): the scene goes on when it lands or fades out."""
    return {"fxwait": name}


def fx_remove(name, fade=None):
    """Take the effect off the map, optionally fading it out over that many frames."""
    step = {"fxremove": name}
    if fade is not None:
        step["fade"] = int(fade)
    return step


def pan(to, snap=False):
    """Point the camera: pan([x, y]) to a place, pan("player") or pan(npc) to follow someone again."""
    step = {"pan": to if isinstance(to, str) else ([int(to[0]), int(to[1])] if isinstance(to, (list, tuple)) else to)}
    if snap:
        step["snap"] = True
    return step


def drop(pixels, step_by=None):
    """Let the player fall that many pixels (the s680 floor collapse: the room scrolls, the camera follows)."""
    s = {"drop": int(pixels)}
    if step_by is not None:
        s["step"] = float(step_by)
    return s


def rise(pixels, step_by=None):
    """Lift the player that many pixels (a lift, a platform coming up)."""
    s = {"rise": int(pixels)}
    if step_by is not None:
        s["step"] = float(step_by)
    return s


def fade(to="out", frames=None):
    """The screen to black ("out"), back to the field ("in"), or at once ("black" / "clear")."""
    s = {"fade": to}
    if frames is not None:
        s["frames"] = int(frames)
    return s


def battle(screen):
    """Start that fight screen mid-scene; the scene goes on after a win (a loss sends the game to the title)."""
    return {"battle": int(screen)}


def warp(place, at, direction=0):
    """Move the player to another place and spot (the game's HANDOFF route). The scene ends at a warp: it is the last step."""
    return {"warp": {"map": canon(place), "at": [int(at[0]), int(at[1])], "dir": int(direction) % 8}}


# ------------------------------------------------------------------ props (web/quest-props.js)
def prop(place, sheet, at, clip=None, layer=None, after="done", solid=None):
    """Our own effect-sheet art left on a map because of the quest's state: the world the quest changed stays changed.

    place  the map (a night/story variant of a place counts as the place itself)
    sheet  web/extra_fx/<sheet>.png + .json -- ours, never game art
    at     world pixels of the prop's feet (the sheet's own anchor decides where that lands in the cell)
    clip   the clip to hold (the sheet's "default" when not named)
    layer  "entity" (default: sorted with the people), "behind" or "front"
    after  "done" (the default: once the quest is handed in) or "accepted" (from the moment it is taken)
    solid  True adds a small box at its feet the player bumps into, exactly like a standing character; default off
    """
    p = {"map": canon(place), "sheet": str(sheet), "at": [int(at[0]), int(at[1])]}
    if clip:
        p["clip"] = str(clip)
    if layer:
        p["layer"] = str(layer)
    if after and after != "done":
        p["after"] = str(after)
    if solid:
        p["solid"] = True
    return p


_PROP_AFTER = ("done", "accepted")
_PROP_LAYER = ("entity", "behind", "front")


def _lint_prop(qid, index, p):
    """A prop names a real map, a sheet that exists in web/extra_fx, and a state that can hold. Bad data stops the build."""
    where = f"{qid}: props[{index}]"
    if not isinstance(p, dict):
        problem(f"{where} must be a dict from prop(...)")
        return
    m = p.get("map")
    if not isinstance(m, str) or not os.path.exists(os.path.join(A, "scenes", f"{m}.json")):
        problem(f"{where} names map {m!r}, which has no scene file")
    sheet = p.get("sheet")
    if not isinstance(sheet, str) or not sheet:
        problem(f"{where} needs a sheet name")
    elif not os.path.exists(os.path.join(WEB, "extra_fx", f"{sheet}.png")):
        problem(f"{where}: web/extra_fx/{sheet}.png does not exist (tools/make_quest_fx.py draws the placeholders)")
    at = p.get("at")
    if not (isinstance(at, (list, tuple)) and len(at) == 2 and all(isinstance(v, int) for v in at)):
        problem(f"{where}.at must be two whole world pixels [x, y]")
    if p.get("after") is not None and p["after"] not in _PROP_AFTER:
        problem(f"{where}.after is {p['after']!r}; use \"done\" or \"accepted\"")
    if p.get("layer") is not None and p["layer"] not in _PROP_LAYER:
        problem(f"{where}.layer is {p['layer']!r}; use \"entity\", \"behind\" or \"front\"")
    if p.get("solid") not in (None, True, False):
        problem(f"{where}.solid is {p['solid']!r}; use True or leave it out")


def shake(amp, frames=None, decay=None, every=None, times=None):
    """Shake the field by up to `amp` px (the text box and menus stay put).

    frames  how long one shake lasts (60 = a second); decay=False keeps the amplitude instead of dying out
    every/times  a row of thuds, one every `every` frames (a giant's footsteps); the scene waits for the last one
    """
    s = {"shake": int(amp)}
    if frames is not None:
        s["frames"] = int(frames)
    if decay is False:
        s["decay"] = False
    if times is not None:
        s["times"] = int(times)
    if every is not None:
        s["every"] = int(every)
    return s


def weather(kind, strength=None, frames=None, force=False):
    """Any Effects-panel weather on ANY map: "fog", "rain", "storm" (rain + lightning), "snow", "blizzard", "sand",
    "leaves", "fireflies" or "clear". It fades in over `frames`. The player's own panel switch is respected unless
    force=True. Lasts until the scene ends (or another weather step)."""
    s = {"weather": kind}
    if strength is not None:
        s["strength"] = float(strength)
    if frames is not None:
        s["frames"] = int(frames)
    if force:
        s["force"] = True
    return s


def tod(kind, frames=None, force=False):
    """The time of day, indoors too: "day", "golden", "dusk" or "night". The day slides there over `frames`, then
    stays for the rest of the scene. Respects the panel's Time switch unless force=True."""
    s = {"time": kind}
    if frames is not None:
        s["frames"] = int(frames)
    if force:
        s["force"] = True
    return s


def lightning(n=1, force=False):
    """One flash on cue (or `n` of them); thunder follows when weather sound is on."""
    s = {"lightning": int(n)}
    if force:
        s["force"] = True
    return s


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
          lvl=None, after=None, short=None, flag=None, seen=None, ordered=False, plain=False,
          verdict=None, props=None):
    """One quest handed out by character `who` standing in `place` (a map id; its night/story variants are found automatically).

    offer  the lines the giver says; the last one is the question
    remind what the giver says while the job is open (never the ordinary chat)
    done   what the giver says when it is handed in
    lvl    the party must have reached this level; after: another quest id that must be done first
    seen   place ids of which the player must have visited any one; flag: a read-only story flag (see the bible)
    plain  say the lines in place, no walking scene
    verdict  a choice made when the job is handed in: {"ask": "question", "options": [a, b], "pay": [pay(..), pay(..)],
             "after": [[lines said after choice a], [lines after choice b]]}; the pay replaces `pay` (which then only
             needs to be what both give), and nothing here ever touches a story flag
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
    if verdict:
        opts = verdict["options"]
        if not (len(opts) == len(verdict["pay"]) == len(verdict["after"]) >= 2):
            problem(f"{id}: verdict needs the same number (2 or more) of options, pays and after-lines")
        for ls in verdict["after"]:
            for l in ls:
                lint(id, "verdict line", l)
        for o in opts:
            lint(id, "verdict option", o)
            if len(o) > 28:
                problem(f"{id}: verdict option {o!r} is over 28 characters")
        q["verdict"] = {"ask": verdict["ask"], "options": list(opts), "pay": verdict["pay"], "after": verdict["after"]}
    if not plain:
        sc = scene(who, offer, ask=ask, options=options)
        if sc:
            q["offer"]["scene"] = sc
        ds = scene(who, done, walk=False)
        if ds:
            q["doneScene"] = ds
    if props:                                        # the world the quest leaves changed (web/quest-props.js)
        q["props"] = list(props)
        for i, p in enumerate(q["props"]):
            _lint_prop(id, i, p)
    return q
