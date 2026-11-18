"""The DDNA Mix-Up: one Monmon DDNA case, two claimants, and a researcher who cannot choose.

The Researcher (npc 43, Central Park) has two requests for one Monmon and one DDNA case that came back from Duel
Island with its labels gone. The Schoolgirl (npc 48, same park) filed the first request in spring for the school
science fair and has the whole project drawn out. The other request is one line from a tamer in the east. The player
learns what she wants, beats the Armormon on Duel Island (the real screen 270, level 28) to open the case, and hands
in with a three-way verdict: give it to the Schoolgirl, give it to the other tamer, or keep it. The real item and the
real fight, new words, and a cost either way.

No new DDNA item and no change to the real grant (web/assets/data/item_grants.json, event 1276 on s385): the quest
only uses the real item name and the real screen.

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "The DDNA Mix-Up" -> Go -> Goals.
"""
from dsl import *

PARK = "s330"        # Central Sector - Central Park: the Researcher at 737,954 and the Schoolgirl at 1152,793
ISLE = "s385"        # East Sector - Duel Island (screen 270: Armormon, level 28, 1584 HP)

OFFER = [
    "Ah. A tamer. Good. I have one form here and I have lost the other, so you will have to be both. "
    "I am with DRI. Digimon Research Institute. Central Park branch. Bench and me.",
    "Two requests came in this week. Both for a Monmon. And one Monmon DDNA came back from Duel Island in the "
    "same post. The labels came off in the rain. I am almost certain I did not take them off. Almost.",
    "One DDNA, two people waiting. I am a scientist, not a magistrate. Talk to the schoolgirl by the fountain, "
    "the one with the orange hair. Find out what she actually wants it for.",
    "Then beat the Armormon on Duel Island. The case will not open before that. Come back and tell me what you "
    "think. Will you?",
]
REMIND = [
    "The schoolgirl is by the fountain. Orange hair, blue jacket, asks questions in threes. Talk to her first. "
    "Then Duel Island.",
    "The case will not open early. It will not. I have tried twice and it sulked. The Armormon is the key.",
]
DONE = [
    "You are back, and the case is warm. That means the lock opened. Do not shake it.",
    "I read her project while you were out. Eleven pages. She has drawn the Monmon on every one, including the "
    "back. The other request is one line. Want Monmon. Will pay. That is the whole form.",
    "I cannot decide between a page and a line. That is your job now.",
]

# What the Schoolgirl tells the player. Her voice: fast, curious, asks too many questions, remembers everything.
GIRL_LINES = [
    "You are here about the DDNA. Do not say anything. I know. You are here about the DDNA. Right? Yes. "
    "I can tell by your face.",
    "I filed the request in spring. For the school science fair. A Monmon. I have the whole project done "
    "already. What it eats. How it walks. What it does when it is happy.",
    "Do you know what it does when it is happy? I wrote three pages. I can show you. Are we walking? We are "
    "walking.",
    "The other request is from a tamer in the east. He has a partner already. I have seen it. It is enormous. "
    "He does not need a Monmon. I need a Monmon.",
    "The researcher says he cannot choose. So you choose. Tell him what you decide. I have eleven pages now. "
    "I finished the back of the last one.",
]

QUESTS = [
    quest("g_dri_mixup", "The DDNA Mix-Up", 43, PARK,
          text="A DRI researcher has one Monmon DDNA and two requests for it. Talk to the schoolgirl, beat the "
               "Armormon on Duel Island to open the case, then choose who gets it.",
          goal=[talk(48, PARK, GIRL_LINES, label="Ask the Schoolgirl about the Monmon"),
                fight(270, [ISLE], "Beat Armormon on Duel Island for the DDNA")],
          pay=pay(400),
          offer=OFFER, remind=REMIND, done=DONE,
          ask="Help him sort it out?", options=("I will help", "Not now"),
          short="DDNA Mix-Up", lvl=12, seen=[ISLE], ordered=True,
          verdict={"ask": "Where does the Monmon DDNA go?",
                   "options": ["Give it to the Schoolgirl", "Give it to the other tamer", "I am keeping it"],
                   "pay": [pay(200, ("Booster 12a", 1)), pay(200, ("Booster 13a", 1)), pay(0, ("Monmon DDNA", 1))],
                   "after": [["Good. I was hoping you would say that. I am not supposed to have hopes. Very "
                              "unprofessional.",
                              "She took the case with both hands and said, I am going to name it after you. Then "
                              "she ran off before I could explain that it is a research subject, not a pet. Do "
                              "not tell her I said that.",
                              "The other tamer gets a letter. I am very good at letters. I have never posted one."],
                             ["I will seal it for the post, then. He has a partner already, a big one, and a "
                              "shelf for things like this. She has a project. That is not a reason. It is only "
                              "a fact.",
                              "She did not cry. She said she understood, and then she said it again, which is how "
                              "I knew she did not. She asked to keep the papers. I said yes. They are her papers.",
                              "I learned something today. I am not sure I like being a person who decides. Ask me "
                              "a question I can measure instead."],
                             ["You beat the Armormon, so the case is yours. That is the rule I wrote on the "
                              "bench this morning. Rules are easier before anyone is sad.",
                              "She came back while you were out. She had drawn a Monmon where the answer should "
                              "go. I told her the case was gone. She said, oh, and started a second drawing. She "
                              "will be all right. That is the worst part.",
                              "Keep it safe. It is not a badge. It is somebody's project, and a one-line "
                              "request, and now it is yours. Three things in one case. I should write that down. "
                              "I will not."]]}),
]
