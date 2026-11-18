"""Card 315: the card past the last page.

The Girl (npc 46, Zhu Que City, s501, 432,249) opens a booster and finds a card her folder cannot hold. The set numbers
314 (web/cardalbum-native.js addresses ids 1..314; its grid loops test `id < 0x13B`), and this card is the catalogue's
own 315, Calumon -- the Start Phase's face-down card (engine/systems/card-battle.ts CALUMON_CARD_ID, escardgm.toml
"Draw Calumon to go first"). She asks the player to win three card duels while she holds it (the duelWin counter is the
game's global one, web/quests.js hears cardDuelEnded, so the words never say three in a row), then decides at the hand-in
whether the card goes back in her tin or stays with the player. Her one strange moment is our own shard glow
(web/extra_fx/shard.png + .json), placed beside her in the hand-in scene.

The card is a story object only: no card data, no album slot and no deck rule is touched -- web/assets/data/card_catalog
already holds 315 Calumon and 316 Impmon, and the album keeps its 314-card grid. The pay is a real booster from
web/assets/data/battlecmd/esitmnam.json.

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "The Card Past the Last Page" -> Go -> Goals.
"""
from dsl import *

CITY = "s501"        # South Sector - Zhu Que City (the Girl stands at 432,249)

OFFER = [
    "You! Card person! Yes, you. Stop. Look at this and tell me it is real.",
    "I opened a booster this morning and there it was, between two Konemon. No number on the corner. No set mark. "
    "Nothing in my album looks like it.",
    "My album ends at 314. I have counted the last page four times. This one will not sit in the folder. It slides "
    "out. It does it every time!",
    "I need to know what it is before I decide anything. Win three card duels and let me hold the card while you "
    "play. If it is a fake, it will do nothing at all. If it is not...",
    "Will you? Three duels. Not for me. For the card.",
]
REMIND = [
    "Three duels! I am counting on my fingers. Do not make me take my boots off.",
    "The card is warm. Cards are not supposed to be warm, are they? Come back when you have three wins.",
]
DONE = [
    "Three wins! And look! It is doing something. It has never done anything.",
    "Come closer. Hold out your hand. Do not drop it.",
]

# The hand-in. She comes over, the card glows in our own shard sheet, and the question it ends on is the verdict's own
# question: web/quests.js hands the scene's answer to the verdict, so both lists below are written in the same order.
DONE_SCENE = [
    {"walk": 46, "to": {"near": "player", "gap": 40}},
    {"arrive": 46},
    {"say": 46, "name": "Girl", "text": "Three wins! And look at it now. It is doing something. It has never done anything."},
    fx("shard", sheet="shard", near=46, dy=-10, clip="appear"),
    {"say": None, "name": "", "text": "The card in her hand glows. The light has no colour you could give a name to, "
                                       "and it does not stop."},
    {"say": 46, "name": "Girl", "text": "It was never in my album. It was never in anyone's. So it is not mine to keep "
                                        "and it is not yours either. That is the problem, and it is a big one."},
    {"say": 46, "name": "Girl", "text": "So you decide. Give it back and I will keep it in the tin with my doubles. "
                                        "Keep it, and it stays the card the album will never show. Which is it?"},
    {"ask": "What happens to card 315?", "options": ["Give the card back", "Keep the card"]},
]

QUESTS = [
    quest("g_card_315", "The Card Past the Last Page", 46, CITY,
          text="The Girl pulled a card out of a booster that her album cannot hold: number 315, in a set of 314. Win "
               "three card duels, then decide whether she keeps it or you do.",
          goal=duel(3),
          pay=pay(100),
          offer=OFFER, remind=REMIND, done=DONE,
          ask="Win three duels for her?", options=("I will duel", "Not now"),
          short="Card 315", lvl=14,
          verdict={"ask": "What happens to card 315?",
                   "options": ["Give the card back", "Keep the card"],
                   "pay": [pay(500, ("Booster 13a", 1)), pay(150, ("Booster 12a", 1))],
                   "after": [["Good. I am going to name it after you. Not on the card. The card stays blank. In my head.",
                              "It goes in the tin with the doubles. The tin is for cards I love and cannot use. It is "
                              "a good tin.",
                              "Here is a booster from the same box. If a 316 exists, I want to be the one who finds it."],
                             ["Keep it, then. I thought you might. I would have.",
                              "It will not go in the album. It will not go in a deck. It will just be the card you have "
                              "that nobody can see.",
                              "Take this as well. Not a thank you. A trade. You gave me a good afternoon and I am "
                              "paying for it."]]}),
]

# The scene dsl builds for `done` is replaced by the hand-in above (the glow and the question it ends on).
QUESTS[0]["doneScene"] = DONE_SCENE
