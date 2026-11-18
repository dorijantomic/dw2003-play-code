"""zz_mount - the quest that unlocks the first mount (web/mount.js MOUNTS[0], id "unimon").

A draft until the user ships it (add zz_mount to shipped.txt). Central Park (s330): Unimon (quest character 1006) lies
hurt beside one of the park's holes (the exit to s865 at 608,480). Bring him two Antidote Disks and drive off two of the
Kunemon that bite at him; then he stands up and lets you ride (F2 -> Extras -> Mount, R to ride).
No story flag, no story counter.
"""
from dsl import quest, pay, bring, kill

MOUNT = quest(
    "zz_mount",
    "The Long Road",
    who=1006,
    place="s330",
    text="A hurt Unimon lies beside a hole in Central Park. Poison in his legs, Kunemon biting at him.",
    goal=[
        bring("Antidote Disk", 2, "Bring Unimon two Antidote Disks for the poison in his legs"),
        kill("Kunemon", 2, ["s330"]),
    ],
    pay=pay(0),
    offer=[
        "Stay back, little one. I am not as gentle as I look. Not today.",
        "The Kunemon came up out of that hole while I slept. Their bites burn. My legs will not hold me.",
        "Two Antidote Disks would clear the poison. And if those biters were gone, I could rest.",
        "Help me stand, and I will carry you farther than your feet ever could. Will you?",
    ],
    remind=[
        "Two Antidote Disks, little one. The poison is slow, but it is not kind.",
        "I can still hear the Kunemon down there. Two of them, at least.",
    ],
    done=[
        "The burning is gone. Look, I can stand.",
        "I keep my word. Call me when the road is long, and I will come. Press R, and climb on.",
    ],
    lvl=6,
    seen=["s330"],
)

QUESTS = [MOUNT]
