"""The giant quests: a MetalTyrannomon and a Triceramon walk across a field, leave prints that stay, and are fought.

DRAFTS (never in shipped.txt). Two quests, one per giant, both built the same way and told differently:

  zz_giant_trike  Central Park (s330), Old Woman. Something huge crosses the grass on the bench row, shaking the
                  ground, and goes out the west gate (s340) leaving three-toed prints. Follow the trail and beat it
                  (screen 51 = a wild Triceramon).
  zz_giant_metal  Lake of Ice (s715), Young Man. The ice rings under a metal weight: a MetalTyrannomon crosses the
                  lake eastward, through the treeline and out at the pass (s710). Follow the prints and beat it
                  (screen 100 = a wild MetalTyrannomon).

The crossing is a scene: the field shakes on every footfall, the giant sheet slides across over the prints (the prints
are layer "behind", so the giant walks on top of them), and one print is dropped under a foot at each thud. The prints
stay afterwards as props (after="accepted", so they are there while the player follows the trail); a fallen log stays
once the job is handed in. The sheets are already three times a person, so the fx step needs no scale.

Every print is on ground the player's own 12 x 8 foot box can stand on (measured along the line with the walk check's
own geometry). The giant is scripted art and is not bound by walls, exactly like a chase target; the PLAYER walks the
map's real floor to the gate.

The art is ours: big_claw (Triceramon placeholder until its own sheet lands), print_claw, print_horn and log are drawn
by tools/make_giant_art.py; giant_metal_g is the MetalTyrannomon sheet cut from generated art. The same idea rendered
from the game's own battle models (tools/partner-from-model.sh + tools/make_giant_fx.py) is disc-derived, git-ignored,
and is NOT what these quests use.
"""
from dsl import *

PARK = "s330"        # Central Sector - Central Park (Old Woman 58 at 1065,997; open grass y~930, x 740..1560)
GATE = "s340"        # the park's west gate, out of the park
ICE = "s715"         # North Sector - Lake of Ice (Young Man 49 at 433,393; open ice y~368, x 420..740)
PASS = "s710"        # the lake's east pass, through the treeline

# The crossing on the park: right to left along the open grass, 740 px, a print every ~120 px (all on free ground).
PARK_Y = 930
PARK_FROM, PARK_TO = 1500, 760
PARK_PRINTS = [(1400, PARK_Y), (1280, PARK_Y), (1160, PARK_Y), (1040, PARK_Y), (920, PARK_Y), (800, PARK_Y)]

# The crossing on the ice: left to right, eastward toward the treeline and the pass (free run x 420..740).
ICE_Y = 368
ICE_LOOK = (590, 308)     # the camera during the crossing: view x 430..750 (map 1024 wide, view 320, target - 160)
# The giant (cell 110 wide, anchored at its middle) starts and ends wholly outside that view, so it walks in from the
# left edge and out past the right one; 2 px a blank as before.
ICE_FROM, ICE_TO = 360, 820
ICE_FRAMES = 230
# Footfalls on the walk sheet's own clock (8 frames, hold 7 = a 56-blank cycle): a foot lands on frames 3 and 7, i.e.
# blanks 14 and 42 of the cycle (measured on the DW2 clip the local sheet is filmed from: feet planted from ticks 15 and 43
# of 54). Every footfall shakes the field (also off screen, before it comes into view); a print is left only where the
# giant is over the free run of ice x 420..740, so every print stays on ground the player can stand on.
ICE_STEPS = [(t, ICE_FROM + (ICE_TO - ICE_FROM) * t // ICE_FRAMES) for t in range(14, ICE_FRAMES, 28)]
ICE_PRINTS = [(x, ICE_Y) for _, x in ICE_STEPS if 420 <= x <= 740]
ICE_WALK = [(t, (x, ICE_Y) if 420 <= x <= 740 else None) for t, x in ICE_STEPS]

OFFER_TRIKE = [
    "Sit down if you like. Or do not. The ground has been jumping since breakfast.",
    "Three toes in every print, and each print as wide as my bench. Something big went past while I was reading.",
    "It went out the west gate. Follow the prints and beat it before it comes back for the flowerbeds.",
]
REMIND_TRIKE = [
    "The prints are still in the grass, dear. Big as plates.",
    "Out the west gate, then stand your ground. I will keep the bench warm.",
]
DONE_TRIKE = [
    "You actually did it. The ground has stopped jumping.",
    "Take the bits and this disk. The park owes you a quiet morning.",
]

OFFER_METAL = [
    "Do you hear that? The ice is ringing.",
    "Something metal walks the lake. It cracks where it steps, and it does not look down.",
    "The prints go east, through the treeline. Walk them and put it down.",
]
REMIND_METAL = [
    "Still ringing. The prints are still there, going east.",
    "Past the trees, at the pass. Then hit it hard.",
]
DONE_METAL = [
    "You are standing and the lake is still here. Good.",
    "Take this ring and the bits. It came off something stronger than me, and you earned it.",
]


def crossing(name, sheet, clip, frm, to, prints, print_sheet, shake_amp=6, frames=180, thud=8, steps=None, look=None):
    """The giant walks from `frm` to `to` while the field shakes and one print lands at each footfall.

    `steps`: when the sheet's step clock is known, a list of (blank from the start of the walk, print point or None) --
    every entry shakes, only the ones with a point leave a print (`prints` is then unused); otherwise each print's time
    follows from its position along the slide. `look`: the camera point (default: halfway along the walk).

    The slide runs on its own clock, so every wait is the gap to the next footfall minus the thud already spent
    (each `shake` blocks for its frames); the prints land under the feet, not after the giant has gone.
    """
    span = abs(to[0] - frm[0]) or 1
    out = [
        {"say": None, "name": "", "text": "The ground jumps."},
        pan(list(look) if look else [(frm[0] + to[0]) // 2, frm[1] - 60]),   # camera first, high enough for the giant
        shake(shake_amp, frames=12, every=24, times=3),
        fx(name, at=list(frm), sheet=sheet, clip=clip),
        fx_move(name, slide={"to": list(to), "frames": frames}),
    ]
    last = 0
    if steps:           # the thud STARTS on the footfall: wait out the gap since the previous thud ended
        n = 0
        for at, p in steps:
            out.append({"wait": max(1, at - last)})
            if p:
                n += 1
                out.append(fx("print%d" % n, at=list(p), sheet=print_sheet, layer="behind"))
            out.append(shake(max(2, shake_amp - 2), frames=thud))
            last = at + thud
        prints = []
    for i, p in enumerate(prints):
        at = int(round(frames * abs(p[0] - frm[0]) / span))
        out.append({"wait": max(3, at - thud - last)})
        out.append(fx("print%d" % (i + 1), at=list(p), sheet=print_sheet, layer="behind"))
        out.append(shake(max(2, shake_amp - 2), frames=thud))
        last = at
    out.append(fx_wait(name))
    if look:
        out.append(fx_remove(name))      # it has walked out of view: take it off the map, so it is not met later
    out.append(pan("player"))
    out.append({"say": None, "name": "", "text": "It is gone. The prints are not."})
    return out


CROSS_TRIKE = crossing("giant", "big_claw", "walk-left", (PARK_FROM, PARK_Y), (PARK_TO, PARK_Y),
                       PARK_PRINTS, "print_claw")
CROSS_METAL = crossing("giant", "giant_metal_g", "walk-right", (ICE_FROM, ICE_Y), (ICE_TO, ICE_Y),
                       ICE_PRINTS, "print_horn", shake_amp=7, frames=ICE_FRAMES, steps=ICE_WALK, look=ICE_LOOK)

QUESTS = []

_q = quest(
    "zz_giant_trike", "The park walks",
    58, PARK,
    text="Something with three toes and a bench-wide foot crossed Central Park this morning, shaking the ground, and "
         "went out the west gate. The Old Woman watched it go: follow the prints through the gate and beat what made "
         "them.",
    goal=[go(GATE, "Follow the prints out of the park's west gate"),
          fight([51], [GATE], "Beat the Triceramon the prints belong to")],
    pay=pay(3000, ("Revive Disk", 1)),
    offer=OFFER_TRIKE, remind=REMIND_TRIKE, done=DONE_TRIKE,
    ask="Walk the trail with me?", options=("I will go", "Not now"),
    lvl=8, seen=[GATE], plain=True,
    props=[prop(PARK, "print_claw", p, clip="idle", layer="behind", after="accepted") for p in PARK_PRINTS] +
          [prop(PARK, "log", [790, 940], clip="idle", after="done")],
)
_q["offer"]["scene"] = [{"say": 58, "name": "Old Woman", "text": l} for l in OFFER_TRIKE] + \
                       [{"ask": "Walk the trail with me?", "options": ["I will go", "Not now"]}]
_q["acceptScene"] = [{"say": 58, "name": "Old Woman", "text": "There. Listen. That is it now, on the grass."}] + CROSS_TRIKE
_q["doneScene"] = [{"say": 58, "name": "Old Woman", "text": l} for l in DONE_TRIKE]
QUESTS.append(_q)

_q = quest(
    "zz_giant_metal", "The lake rings",
    49, ICE,
    text="The ice on the Lake of Ice rings all day and cracks where nothing should be walking. A metal giant crossed "
         "the lake eastward and went through the treeline to the pass. The Young Man wants the trail walked and the "
         "thing beaten.",
    goal=[go(PASS, "Follow the prints east, through the treeline"),
          fight([100], [PASS], "Beat the MetalTyrannomon past the treeline")],
    pay=pay(4000, ("Revive Ring", 1)),
    offer=OFFER_METAL, remind=REMIND_METAL, done=DONE_METAL,
    ask="Walk it with me?", options=("I will go", "Not now"),
    lvl=34, seen=[PASS], plain=True,
    props=[prop(ICE, "print_horn", p, clip="idle", layer="behind", after="accepted") for p in ICE_PRINTS] +
          [prop(ICE, "log", [730, 372], clip="idle", after="done")],
)
_q["offer"]["scene"] = [{"say": 49, "name": "Young Man", "text": l} for l in OFFER_METAL] + \
                       [{"ask": "Walk it with me?", "options": ["I will go", "Not now"]}]
_q["acceptScene"] = [{"say": 49, "name": "Young Man", "text": "There it is. Across the ice. Go on, and do not run."}] + CROSS_METAL
_q["doneScene"] = [{"say": 49, "name": "Young Man", "text": l} for l in DONE_METAL]
QUESTS.append(_q)
