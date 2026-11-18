"""DEMO, NOT SHIPPED (id zz_ghost_demo, deliberately absent from shipped.txt).

A proof that a quest scene can show a memory: Cipher (the security unit on the Asuka Bridge, npc 1005) plays back a
recording of the bridge's first day as a pale, tinted copy of itself, then shows you the hole it has been guarding.

It exercises, in order: `ghost` on an NPC with a tint, `ghost` off again, `pan` away from the player, `drop` (the s680
+0x54 drive) WITH the camera back on the player, `rise` back up, `pan` back, and `ghost` on the player. Nothing is left
behind: every ghost is cleared on the scene's own exit.

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "The bridge remembers" -> Go -> Enter.
"""
from dsl import *

BRIDGE = "s205"     # Central Sector - Asuka Bridge (Cipher stands at 896,296)
CIPHER = 1005       # Cipher: a security unit, speaks in Query: / Status: lines
LOOK = [760, 160]   # a camera point up the bridge, well away from the player: the fall must be seen from the player anyway

OFFER = [
    "Query: are you the one who walks this bridge?",
    "Status: this bridge has a recording of its first day.",
    "Query: may I play it for you? It is short, and then I have a hole to show you.",
]
REMIND = [
    "Status: the recording is still here.",
    "Query: watching now?",
]
DONE = [
    "Status: the recording is closed.",
    "Query: was it worth your time? Take this disk either way.",
]

WATCH = [
    {"say": CIPHER, "name": "Cipher", "text": "Status: playback begins. This is me, on my first day."},
    {"ghost": CIPHER, "alpha": 0.35, "tint": "#9fc8ff"},
    {"wait": 20},
    {"say": None, "name": "", "text": "Cipher goes pale as glass, and an older, smaller unit stands in its place."},
    {"say": CIPHER, "name": "Cipher", "text": "Status: I stood here for one hour. I did not know which way to walk."},
    {"wait": 40},
    {"ghost": CIPHER, "off": True},
    {"say": CIPHER, "name": "Cipher", "text": "Query: and this is me now. The difference is the hour, not the shape."},
    {"pan": LOOK},
    {"wait": 24},
    {"say": CIPHER, "name": "Cipher", "text": "Status: look where the camera went. I put that hole there, on my first day."},
    {"say": None, "name": "", "text": "The bridge shifts under your feet."},
    {"drop": 90, "step": 0.5},
    {"wait": 12},
    {"say": None, "name": "", "text": "You land under the bridge, and climb back up."},
    {"rise": 90, "step": 0.5},
    {"wait": 12},
    {"pan": "player"},
    {"say": CIPHER, "name": "Cipher", "text": "Query: are you intact? Status: yes, I think."},
    {"ghost": "player", "alpha": 0.4, "tint": "#c9a8ff"},
    {"say": None, "name": "", "text": "For a moment your own recording stands where you stood."},
    {"wait": 30},
    {"ghost": "player", "off": True},
    {"say": CIPHER, "name": "Cipher", "text": "Status: now you are on the record too. Query: satisfied?"},
]

OFFER_SCENE = [{"say": CIPHER, "name": "Cipher", "text": line} for line in OFFER] + \
              [{"ask": "Play it?", "options": ["Play it", "Not now"]}]

QUESTS = []

_q = quest(
    "zz_ghost_demo", "The bridge remembers", CIPHER, BRIDGE,
    text="Cipher on the Asuka Bridge keeps a recording of its first day and wants someone to watch it with it, and then "
         "one look at the hole that first day left. It is in a talkative mood.",
    goal=[go(BRIDGE, "Watch Cipher's recording")],
    pay=pay(200, ("Energy Disk", 1)),
    offer=OFFER, remind=REMIND, done=DONE,
    ask="Play it?", options=("Play it", "Not now"),
    plain=True,
)
_q["offer"]["scene"] = OFFER_SCENE
_q["doneScene"] = [{"say": CIPHER, "name": "Cipher", "text": line} for line in DONE]
_q["acceptScene"] = WATCH
QUESTS.append(_q)
