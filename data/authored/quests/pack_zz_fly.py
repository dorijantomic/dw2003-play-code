"""zz_fly - the quest that unlocks flying between places (web/fly-points.js, data/authored/fly-points.json).

Shipped (shipped.txt). The Old Man of Asuka City (npc 57, s200) tells of the Digi-Egg of Love: the wind egg, the one that
turns a Hawkmon into Halsemon. He sends you to stand in the Wind Prairie (s395) and feel the wind, and the egg answers.
Reward: no bits and no item (the item table is the disc's, so a new Digi-Egg cannot be added to it). Done = the key: a FLY
row appears on the pause list and the partner can take flight to the fly points already visited.
No story flag, no story counter.
"""
from dsl import quest, pay, go, level

FLY = quest(
    "zz_fly",
    "The Wind Egg",
    who=57,
    place="s200",
    text="The Old Man says the Digi-Egg of Love hears the wind. Stand in the Wind Prairie and let it hear you.",
    goal=[
        go("s395", "Stand in the Wind Prairie and feel the wind"),
        level(10, "Reach level 10 with your partner"),
    ],
    pay=pay(0),
    offer=[
        "Sit down a moment, little one. I will tell you a very old thing.",
        "There is an egg that listens to the wind. The Digi-Egg of Love. A Hawkmon wearing it grows wings that carry two.",
        "It does not listen to just anyone. Go and stand in the Wind Prairie, and grow a little first. Level 10 will do.",
        "Will you go and let the wind have a look at you?",
    ],
    remind=[
        "The Wind Prairie, little one. And a partner with some strength in the legs.",
        "The wind is patient. It is the one thing older than I am.",
    ],
    done=[
        "There. Do you feel it? The egg has heard you.",
        "Your partner may now take flight to any town or open land you have already walked. Open the pause menu and choose FLY.",
        "It will not carry you where you have not been, nor under the earth, nor over the deep. Those roads are still yours to dig and swim.",
    ],
    lvl=8,
    seen=["s330"],
)

QUESTS = [FLY]
