"""DEMO, NOT SHIPPED (id zz_props_demo, deliberately absent from shipped.txt).

A proof that a quest can leave OUR OWN art on a map and have it stay there because of the quest's state -- the world
changed, on every visit, from the saved quest state (web/quest-props.js, docs/quests-fx-brief.md section 6).

The Geek (npc 51, Asuka City Main Lobby) has put up a signboard and wants to know if it reads as a sign from across the
square. While the job is open the new board stands beside him (`after: "accepted"`, and `solid: true`, so the player
bumps into it like a person); when it is handed in the old board is leaning by the desk for good (`after: "done"`).

It exercises: the `props` quest data (dsl.prop), the two states ("accepted" / "done"), the `entity` layer (y-sorted with
the people), the optional `solid` foot box, and the state change while standing on the map (no reload).

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "The lobby sign" -> Go -> Enter.
"""
from dsl import *

LOBBY = "s210"       # Asuka City - Main Lobby (the Geek stands at 529,505)
SQUARE = "s200"      # Asuka City, outside the lobby doors
NEW_BOARD = [560, 505]    # beside the Geek, in the open corridor
OLD_BOARD = [584, 525]    # leaning by the desk once the job is done

OFFER = [
    "New build: one sign, two posts, six pixels of weatherproofing.",
    "Problem: it stands in the lobby, and lobby people do not look up.",
    "Task: walk out to the square, look back at the doors, then come back and tell me it reads as a sign.",
]
REMIND = [
    "Reminder: out to the square, look back at the doors, back here.",
    "Three steps. I have counted them.",
]
DONE = [
    "Data point: it reads. Two posts, no wobble, one useful sign.",
    "Payment: bits, and a disk for your trouble.",
    "The old board stays where it is leaning. Some things should stay.",
]

QUESTS = []

_q = quest(
    "zz_props_demo", "The lobby sign", 51, LOBBY,
    text="The Geek has put up a signboard in the lobby and wants a second opinion on it. Walk out to the square, look "
         "back at the doors, then tell him what it looks like from there.",
    goal=[go(SQUARE, "Look back at the lobby doors from the square")],
    pay=pay(120, ("Antidote Disk", 1)),
    offer=OFFER, remind=REMIND, done=DONE,
    ask="Take the look?",
    props=[
        prop(LOBBY, "frame", NEW_BOARD, clip="idle", after="accepted", solid=True),
        prop(LOBBY, "frame", OLD_BOARD, clip="glint", after="done"),
    ],
)
QUESTS.append(_q)
