"""The Bridge at Golden Hour: a photograph of the Asuka Bridge, and the question of whose picture it is.

The Traveler (npc 47, Asuka City) has crossed the world twice and owns no photographs of any of it. One place he wants
kept: the Asuka Bridge at golden hour. Cipher (1005, the security unit at its post) has an eye that records every
crossing and has never been asked for a copy, so the scene pins golden hour and clear weather, puts Cipher at the rail,
turns it toward the light, pans over the water and asks what the picture is really of. The hand-in offers three endings
(give the print to the Traveler, leave it with Cipher, keep it), and the inn keeps a framed print whichever you choose.

The prop is our own `frame` sheet (web/extra_fx/frame.json, clips idle/glint), left beside the innkeeper's counter once
the quest is done (web/quest-props.js, docs/quests-fx-brief.md section 6).

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "The Bridge at Golden Hour" -> Go -> Goals.
"""
from dsl import *

CITY = "s200"        # Central Sector - Asuka City (the Traveler stands at 555,474)
BRIDGE = "s205"      # Central Sector - Asuka Bridge (Cipher stands at 896,296)
INN = "s235"         # Asuka City - Asuka Inn 1F

RAIL = [912, 304]     # the rail at Cipher's post: free ground for the player's own foot box
SHOT = [1000, 280]    # the camera's point: over the rail, the water and the low sun
FRAMED = [232, 176]   # the inn's hall, beside the counter; the frame sheet stands on the floor

OFFER = [
    "I have crossed the whole world twice and I own photographs of none of it. My one regret. Well. One of four.",
    "There is a bridge in Asuka worth looking at for about a minute a day. Golden hour. Real light on real stone.",
    "Cipher, the security unit on the bridge, sees everything that crosses it. Ask it to take that one picture for me. Will you?",
]
REMIND = [
    "Cipher is on the Asuka Bridge. It watches every crossing. It has never once been asked to keep one.",
    "The light is the whole point. Do not let it get dark on you.",
]
DONE = [
    "You brought it. Let me look at it properly, not in the middle of the street.",
    "Yes. That is the bridge. That is the light. That is the minute I missed the first time I crossed it.",
    "The inn keeps a print by the counter. The bridge should be seen by people who are only passing through.",
]

CIPHER_LINES = [
    "Status: the Traveler wants a picture of this bridge.",
    "Query: golden hour is in one minute. Stand clear of the rail.",
    "Status: recorded. The print will be waiting at the Asuka Inn.",
]

# The talk scene. Cipher steps to the rail, the day slides to golden hour, the weather clears, the camera pans over the
# water, and it asks what the picture is really of. `time` and `weather` carry no `force`: a player who switched the
# effect off in F2 keeps it off, and the words still work.
BRIDGE_SCENE = [
    {"say": 1005, "name": "Cipher", "text": "Halt. Status: no incident. Query: the Traveler sent you."},
    {"say": 1005, "name": "Cipher", "text": "My eye records every crossing of this bridge. No one has ever asked for a copy."},
    {"say": 1005, "name": "Cipher", "text": "Status: the light is right for about a minute. Stand clear of the rail."},
    {"put": 1005, "at": RAIL},
    {"face": 1005, "dir": "right"},
    tod("golden", frames=90),
    weather("clear", frames=30),
    pan(SHOT),
    {"say": 1005, "name": "Cipher", "text": "Query: recording. Status: golden hour, one bridge, no weather, one unit."},
    {"say": None, "name": "", "text": "Cipher holds still. The river turns the colour of old brass."},
    {"say": 1005, "name": "Cipher", "text": "Query: what is the picture really of?"},
    {"ask": "What is the picture really of?", "options": ["The bridge", "The light", "The man who asked"]},
    {"say": 1005, "name": "Cipher", "text": "Status: logged. A photograph can carry all three, if it is taken honestly."},
    {"say": 1005, "name": "Cipher", "text": "Status: file sent to the Asuka Inn. Query: the Traveler should hold the print, not the file."},
    pan("player"),
    {"say": 1005, "name": "Cipher", "text": "Query: tell him the light was on time."},
]

_photo = talk(1005, BRIDGE, CIPHER_LINES, label="Ask Cipher for the photograph")
_photo["scene"] = BRIDGE_SCENE

QUESTS = [
    quest("g_bridge_golden", "The Bridge at Golden Hour", 47, CITY,
          text="The Traveler has seen the world twice and photographed none of it. Cipher's eye can catch the Asuka "
               "Bridge at golden hour, and the question is whose picture it becomes.",
          goal=[_photo],
          pay=pay(300),
          offer=OFFER, remind=REMIND, done=DONE,
          ask="Ask Cipher for the picture?", options=("I will ask", "Not now"),
          short="Golden Hour",
          verdict={"ask": "Where does the photograph go?",
                   "options": ["It is yours, Traveler", "Leave it with Cipher", "I am keeping it"],
                   "pay": [pay(0, ("Booster 12a", 1)), pay(0, ("Booster 13a", 1)), pay(0, ("Energy Disk", 1))],
                   "after": [["Good. Then it goes on the first page of the album. That page has been empty a long time.",
                              "Here. I buy card packs and never open them. It is a habit. Take one.",
                              "And if you ever stand on that bridge at the right minute, do not look at your feet."],
                             ["With the unit? Hm. A guard with a picture of its own post. I like it.",
                              "Tell it the light was on time. It will log that as a compliment.",
                              "Cipher handed me this from the lost property box. It says you have earned it."],
                             ["Then keep it. Some pictures are for the person who stood there.",
                              "Take this for the road. A traveller never leaves with empty hands. That is a rule I just made up.",
                              "And the inn keeps a print, so the bridge is never only ours. Three copies, three places."]]},
          props=[prop(INN, "frame", FRAMED, clip="glint", after="done")]),
]
