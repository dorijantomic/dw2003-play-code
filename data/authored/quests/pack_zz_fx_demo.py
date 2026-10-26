"""DEMO, NOT SHIPPED (ids zz_fx_demo and zz_fx_all, deliberately absent from shipped.txt).

TWO demos, both Cipher (the security unit on the Asuka Bridge, npc 1005) and both draft quests the quest lab can play.

1. zz_fx_demo, "Cipher's field test" -- the FIRST half of the scene vocabulary, on its own, small enough to watch: a crate
   falls onto one stair step (`fx` with a `fall` motion + `fxwait` + `fxplay`), the camera pans there and back (`pan`), the
   step gives way and the player drops through it (`drop`), the screen fades (`fade`), and a `warp` sends them into the
   sewers. Played by tools/verify_quest_fx.mjs.

2. zz_fx_all, "Cipher's full sweep" -- ONE scene that uses EVERY step there is, in order: `shake` thuds, fog on a map
   whose own profile has no fog (`weather`), `time` to night, `lightning`, a `ghost` replay of Cipher, a crate that falls
   and then slides (`fx`/`fxwait`/`fxplay`/`fxmove`/`fxremove`), a real mid-scene `battle`, a `chase` lap the player runs,
   a `drop` and a `rise`, a `fade` and a `warp` -- plus a `props` entry that leaves our own signboard on the bridge once
   the quest is handed in (the world the quest changed stays changed). Played by tools/verify_quest_all.mjs.

Everything is data; see web/quest-scenes.js and docs/quests-fx-brief.md. Both quests are drafts: a plain
`python3 tools/build_quests.py` leaves them out of web/quests.json, `--with-drafts` puts them back for the lab.
"""
from dsl import *

BRIDGE = "s205"      # Central Sector - Asuka Bridge (Cipher stands at 896,296)
SEWERS = "s320"      # Asuka City - Asuka Sewers, where the stair leads
CRATE = [1056, 320]  # the stair landing the player stands on: the crate lands beside them on the same step
LOOK = [1056, 200]   # the camera point above the stair landing
SIGN = [936, 302]    # the board Cipher leaves beside his post once the full sweep is handed in

# The lap the chase runs (the same one zz_chase_demo uses; every leg is walkable for the player's own foot box).
LAP = [
    [896, 296], [868, 276], [800, 268], [720, 260], [668, 244],
    [700, 232], [780, 236], [860, 252], [888, 276], [900, 300],
]

OFFER = [
    "Query: are you a field tester?",
    "Status: this bridge has one step I do not trust.",
    "I will drop a crate on it. Stand on the stair landing and hold still. Will you?",
]
REMIND = [
    "Status: the crate is still up on the tower.",
    "Query: ready for the drop test?",
]
DONE = [
    "Status: the step held. Mostly.",
    "Payment: this disk. It heals what a fall breaks.",
]

TEST = [
    {"say": 1005, "name": "Cipher", "text": "Query: standing by."},
    {"fade": "out", "frames": 10},
    {"put": "player", "at": [CRATE[0] - 12, CRATE[1]]},
    {"wait": 8},
    {"fade": "in", "frames": 10},
    {"pan": [CRATE[0], CRATE[1] - 120]},
    {"say": 1005, "name": "Cipher", "text": "Status: crate away."},
    {"fx": "crate", "sheet": "crate", "at": [CRATE[0], 40], "clip": "fall",
     "fall": {"floor": CRATE[1], "step": 0.7}},
    {"wait": 12},
    {"say": 1005, "name": "Cipher", "text": "Query: did the step hold?"},
    {"fxwait": "crate"},
    {"fxplay": "crate", "clip": "settle"},
    {"say": 1005, "name": "Cipher", "text": "Status: the step did not hold."},
    {"say": None, "name": "", "text": "The stair gives way under your feet."},
    {"drop": 100, "step": 0.4},
    {"say": 1005, "name": "Cipher", "text": "Query: are you down there? Answer with your feet."},
    {"fade": "out", "frames": 20},
    {"warp": {"map": SEWERS, "at": [576, 448], "dir": 0}},
]

OFFER_SCENE = [{"say": 1005, "name": "Cipher", "text": line} for line in OFFER] + \
              [{"ask": "Run the test?", "options": ["Run it", "Not now"]}]

QUESTS = []

_q = quest(
    "zz_fx_demo", "Cipher's field test", 1005, BRIDGE,
    text="Cipher is testing one step of the Asuka Bridge and wants a witness standing on it. Watch the crate fall, then "
         "find out how much weight the step really holds.",
    goal=[go(SEWERS, "Find the way up out of the sewers under the bridge")],
    pay=pay(200, ("Energy Disk", 1)),
    offer=OFFER, remind=REMIND, done=DONE,
    ask="Run the test?", options=("Run it", "Not now"),
    plain=True,
)
# The offer is spoken in place (Cipher is a security unit at his post, not a townsman walking over), and the test itself is
# the accept scene, where the effects play.
_q["offer"]["scene"] = OFFER_SCENE
_q["doneScene"] = [{"say": 1005, "name": "Cipher", "text": line} for line in DONE]
_q["acceptScene"] = TEST
QUESTS.append(_q)

# ----------------------------------------------------------------------------------------------------------------
# zz_fx_all: ONE scene with every step of the vocabulary, in the order they make a small story.
# ----------------------------------------------------------------------------------------------------------------
OFFER_ALL = [
    "Query: field tester, is that you?",
    "Status: I have a full field test and one bridge that has never been tested.",
    "Query: will you walk it with me? Fog, thunder, a fall, and something running. I will explain as we go.",
]
REMIND_ALL = [
    "Status: the full sweep is still waiting.",
    "Query: ready to walk the bridge?",
]
DONE_ALL = [
    "Status: full sweep complete. Every step of the bridge answered.",
    "Payment: this disk, and a board with your name on it. The bridge remembers who stood on it.",
]

SWEEP = [
    {"say": 1005, "name": "Cipher", "text": "Status: full field test. Stand clear, keep up, and do not step off the edge."},
    # Thuds: something enormous walking behind the camera. The field shakes, the text box stays still.
    shake(5, frames=10, every=26, times=4),
    {"say": 1005, "name": "Cipher", "text": "Query: did you feel that? Something big is walking the bridge."},
    # Fog, on a map whose own profile has none (strength 1: the bridge is bright white stone, so it reads as a thin haze --
    # the state says it is there, the eye barely does; a fog moment wants a darker map to look like anything).
    weather("fog", strength=1.0, frames=60),
    {"say": 1005, "name": "Cipher", "text": "Status: fog. Thin, but it is here. This bridge has never had any."},
    # Night, in the middle of the day: the panel's own time of day, lamps and all, indoors too.
    tod("night", frames=90),
    {"say": 1005, "name": "Cipher", "text": "Query: see the lamps? Night, on a bridge, in the middle of the day."},
    # One cue of lightning (two bolts); thunder follows when the player has weather sound on.
    lightning(2),
    {"say": 1005, "name": "Cipher", "text": "Status: thunder on cue. The sky is doing as it is told."},
    # A memory replay: Cipher himself, faded and tinted, then put back.
    {"ghost": 1005, "alpha": 0.35, "tint": "#9fc8ff"},
    {"say": 1005, "name": "Cipher", "text": "Status: this is the unit I was, standing where I stand. Query: can you see through it?"},
    {"ghost": 1005, "off": True},
    {"say": 1005, "name": "Cipher", "text": "Status: good. The bridge is done with the past. Now the stair."},
    # Our own art, the camera on it: a crate falls (fall = the s415 maths), settles, slides, then fades away.
    pan(LOOK),
    {"say": 1005, "name": "Cipher", "text": "Status: watch the landing."},
    fx("crate", at=[CRATE[0], 40], clip="fall", fall={"floor": CRATE[1], "step": 0.7}),
    {"wait": 12},
    fx_wait("crate"),
    fx_play("crate", "settle"),
    {"say": 1005, "name": "Cipher", "text": "Query: did the step hold?"},
    fx_move("crate", slide={"to": [1000, CRATE[1]], "frames": 40}),
    {"say": 1005, "name": "Cipher", "text": "Status: and it slides. Nothing on this bridge stays where it is put."},
    fx_remove("crate", fade=20),
    pan("player"),
    # A real fight mid-scene (screen 34, a level 1 Kunemon): a win goes on with the scene, a flee too, a loss ends it.
    {"say": 1005, "name": "Cipher", "text": "Status: the last part is not a test. Something is in the fog and it is not mine."},
    battle(34),
    {"say": 1005, "name": "Cipher", "text": "Status: back. The fog let go of the bridge when the fight did. Query: are you whole?"},
    # The chase: the player keeps the controls and must stay with Cipher round the plaza (answer 0 kept, 1 lost).
    {"chase": 1005, "path": LAP, "speed": 120, "lose": 96, "frames": 720},
    {"say": 1005, "name": "Cipher", "text": "Status: you kept up. Query: one last thing."},
    # The floor gives way (the s680 drive) and the lift brings the player back, the camera with them.
    {"say": None, "name": "", "text": "The stair landing gives way under your feet."},
    drop(90, step_by=0.5),
    {"say": None, "name": "", "text": "You land on the level below, and the lift brings you back up."},
    rise(90, step_by=0.5),
    {"say": 1005, "name": "Cipher", "text": "Status: full sweep complete. The bridge is cleared."},
    fade("out", 20),
    warp(SEWERS, [576, 448]),
]

OFFER_ALL_SCENE = [{"say": 1005, "name": "Cipher", "text": line} for line in OFFER_ALL] + \
                  [{"ask": "Run the full sweep?", "options": ["Run it", "Not now"]}]

_all = quest(
    "zz_fx_all", "Cipher's full sweep", 1005, BRIDGE,
    text="Cipher has one bridge and one full field test: fog, night, thunder, a fall, a fight and a lap to run. Walk it "
         "with him and he will leave a board beside his post to say you did.",
    goal=[go(SEWERS, "Find the way up out of the sewers under the bridge")],
    pay=pay(250, ("Energy Disk", 1)),
    offer=OFFER_ALL, remind=REMIND_ALL, done=DONE_ALL,
    ask="Run the full sweep?", options=("Run it", "Not now"),
    plain=True,
    props=[prop(BRIDGE, "frame", SIGN, clip="idle", after="done")],
)
_all["offer"]["scene"] = OFFER_ALL_SCENE
_all["doneScene"] = [{"say": 1005, "name": "Cipher", "text": line} for line in DONE_ALL]
_all["acceptScene"] = SWEEP
QUESTS.append(_all)
