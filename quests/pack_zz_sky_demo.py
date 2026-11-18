"""DEMO, NOT SHIPPED (id zz_sky_demo, deliberately absent from shipped.txt).

The quest-scene atmosphere steps on one map: ASKA BRIDGE (s205), which has no fog of its own and no weather at all. Cipher
(1005) runs a drill and the bridge does what he says:

  shake     four thuds, as if something enormous were walking up behind you
  weather   fog on a map whose own profile has none
  time      night, in the middle of the day, lamps and all
  lightning two flashes on cue
  clear     both back to the map's own sky before the scene ends

Everything is data; see web/quest-scenes.js and docs/quests-fx-brief.md. Nothing here may be left behind when the scene
ends: the verifier reads window.__questFx.sky() after it.

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "Cipher's bridge drill" -> Go -> Enter.
"""
from dsl import *

BRIDGE = "s205"      # Central Sector - Asuka Bridge (Cipher stands at 896,296)
SEWERS = "s320"      # where the drill sends you afterwards, so the demo has a goal to hand in

OFFER = [
    "Query: are you free for a drill?",
    "Status: I have been testing what this bridge can show.",
    "Fog. Night. Thunder. None of them belong here. Will you watch?",
]
REMIND = [
    "Status: the drill is still waiting.",
    "Query: ready to see the bridge lie?",
]
DONE = [
    "Status: the drill is done.",
    "Payment: this disk. For your trouble, and your nerve.",
]

DRILL = [
    {"say": 1005, "name": "Cipher", "text": "Status: drill begins. Stand still and watch the bridge."},
    shake(4, frames=12, every=24, times=4),
    {"say": 1005, "name": "Cipher", "text": "Query: did you feel that? Something big walked by."},
    weather("fog", strength=0.9, frames=60),
    {"say": 1005, "name": "Cipher", "text": "Status: fog. This bridge has never had fog. Now it does."},
    tod("night", frames=90),
    {"say": 1005, "name": "Cipher", "text": "Query: see the lamps? Night, on a bridge, in the middle of the day."},
    lightning(2),
    {"say": 1005, "name": "Cipher", "text": "Status: thunder. The sky is listening."},
    weather("clear", frames=45),
    tod("day", frames=60),
    {"say": 1005, "name": "Cipher", "text": "Status: drill over. Everything is back where it was."},
]

OFFER_SCENE = [{"say": 1005, "name": "Cipher", "text": line} for line in OFFER] + \
              [{"ask": "Run the drill?", "options": ["Run it", "Not now"]}]

QUESTS = []

_q = quest(
    "zz_sky_demo", "Cipher's bridge drill", 1005, BRIDGE,
    text="Cipher wants to see how much of the sky this bridge can hold. Fog, night and thunder, on a bridge that has "
         "none of them, then everything back as it was.",
    goal=[go(SEWERS, "Take the long way back through the sewers")],
    pay=pay(150, ("Energy Disk", 1)),
    offer=OFFER, remind=REMIND, done=DONE,
    ask="Run the drill?", options=("Run it", "Not now"),
    plain=True,
)
_q["offer"]["scene"] = OFFER_SCENE
_q["doneScene"] = [{"say": 1005, "name": "Cipher", "text": line} for line in DONE]
_q["acceptScene"] = DRILL
QUESTS.append(_q)
