"""DEMO, NOT SHIPPED (id zz_chase_demo, deliberately absent from shipped.txt).

Proves the `chase` scene step on a live map: Cipher (the security unit on the Asuka Bridge, npc 1005) runs a sensor lap of
the bridge plaza and the PLAYER keeps the controls and has to stay within reach of him. The lap is a zigzag across the
plaza, and every straight leg is walkable for the player's own foot box (checked against web/assets/collision/s205.json).

The lap is the quest's one objective, so the step can be retaken: keep up and the talk completes and Cipher hands over the
reward; lose him (over `lose` px for a full second, or still far away when the time limit comes) and the scene stops at
once -- the words after a lost chase never play -- the objective stays open, and talking to Cipher again runs the lap again.
A lost chase never fails or cancels the quest.

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "Cipher's sensor lap" -> Go -> Enter.
"""
from dsl import *

BRIDGE = "s205"      # Central Sector - Asuka Bridge (Cipher stands at 896,296)

# The lap: out along the plaza's left side, a zigzag back, and down to the stair head, ending at his own post.
LAP = [
    [896, 296], [868, 276], [800, 268], [720, 260], [668, 244],
    [700, 232], [780, 236], [860, 252], [888, 276], [900, 300],
]

OFFER = [
    "Query: are you a field tester?",
    "Status: my motion sensor needs a moving reference, and the bridge is the only clear run.",
    "Query: keep up with me for one lap?",
]
REMIND = [
    "Status: the lap is still waiting.",
    "Query: ready to run?",
]
DONE = [
    "Status: lap complete. The sensor logged one witness.",
    "Payment: this disk. Data is worth more than money out here.",
]

# The whole step: two lines, the run, then the words that only play if the player kept up.
LAP_SCENE = [
    {"say": 1005, "name": "Cipher", "text": "Query: standing by. Do not fall behind."},
    {"say": 1005, "name": "Cipher", "text": "Status: lap armed. Keep up."},
    # The step under test: the target walks LAP at 120 px/s (the player runs about 240); 96 px of slack, 12 s at most.
    {"chase": 1005, "path": LAP, "speed": 120, "lose": 96, "frames": 720},
    {"say": 1005, "name": "Cipher", "text": "Status: lap complete. You kept up."},
    {"say": "player", "name": "Junior", "text": "Only a security unit running laps on a bridge."},
]
# Said when the run is lost, so the player knows the lap is not over: the step is still open.
RETRY = [
    "Status: reference lost. Query: run it again?",
]

OFFER_SCENE = [{"say": 1005, "name": "Cipher", "text": line} for line in OFFER] + \
              [{"ask": "Run the lap?", "options": ["Run it", "Not now"]}]

QUESTS = []

_q = quest(
    "zz_chase_demo", "Cipher's sensor lap", 1005, BRIDGE,
    text="Cipher needs a moving reference for his motion sensor. Run one lap of the bridge plaza and stay within reach of "
         "him -- fall behind for a second and he stops the test.",
    goal=[talk(1005, BRIDGE, ["Status: the sensor has its reading. Query: again?"], label="Run the lap with Cipher")],
    pay=pay(200, ("Energy Disk", 1)),
    offer=OFFER, remind=REMIND, done=DONE,
    ask="Run the lap?", options=("Run it", "Not now"),
    plain=True,
)
_q["offer"]["scene"] = OFFER_SCENE
_q["doneScene"] = [{"say": 1005, "name": "Cipher", "text": line} for line in DONE]
# The objective IS the lap: the scene runs on the talk, and a lost run leaves it open (web/quests.js chaseLost rule), so
# the same talk is the retry.
_q["objectives"][0]["scene"] = LAP_SCENE
_q["objectives"][0]["retryLines"] = RETRY
QUESTS.append(_q)
