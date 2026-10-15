"""Flagship quests: few, each its own small story, several kinds of step, a choice at the end, and characters drawn
for the purpose (data/authored/quests/new_characters.json). Lore: docs/quests-lore.md.
Written 2026-10-15 after the first 190 quests were judged too much of "go there, talk to X".

What each one is about:
  f_two_sides_bridge   Keith and Nick, rival friends split across the two servers, one bridge apart
  f_digimon_surprise   Agumon and Patamon each plan a surprise for the other
"""
from dsl import *

PARK, WIRE, BEACH, CAPE = "s330", "s335", "s340", "s345"
ASUKA_OUT, ASUKA_OLD, LOBBY = "s202", "s200", "s212"
BRIDGE, BRIDGE2 = "s205", "s206"

QUESTS = [

    quest("f_digimon_surprise", "The Same Surprise", 365, ASUKA_OLD,
          text="Agumon is planning a surprise for Patamon and needs it kept secret. Find out what Patamon is up to, and bring Energy Disks for the party.",
          goal=[talk(371, ASUKA_OLD, ["Oh. Hello. Um. Could you do me a favour? Could you keep Agumon busy for a bit?",
                                      "It is for tomorrow. It is a secret. It is his day, the day he came online. I want to give him a surprise.",
                                      "I do not know how to bake. Is there any sort of party food in this world? Thank you. Thank you twice."],
                     label="Ask Patamon what he is up to"),
                bring("Energy Disk", 2, "Bring two Energy Disks")],
          ordered=True, lvl=3, short="Same Surprise",
          pay=pay(150),
          offer=["Psst. Hey. Hey! Tomorrow is Patamon's day! The day he came online! He does not know I know!",
                 "I want to throw him a surprise, but I cannot bake, and I cannot hide things, and I am not good at secrets.",
                 "Could you check what Patamon is doing so he does not suspect? And could we find some party food?"],
          ask="Help Agumon?", options=("Of course", "Not now"),
          remind=["Did you check on Patamon? Is he suspicious? He always knows when I am up to something.",
                  "And food! We need food! Disks are the closest thing we have to cake."],
          done=["Two Energy Disks! This is the best party food ever. I think.",
                "Wait. Why was Patamon so nervous when I walked past just now? He kept hiding something behind his wing."],
          verdict={"ask": "What do you say to Agumon?", "options": ["Suggest one party", "Keep both secrets"],
                   "pay": [pay(0, ("Antidote Disk", 1)), pay(200)],
                   "after": [["Wait. Patamon is planning one too? For ME?",
                              "Then let us not hide. Let us have one party for both of us. That is much easier, and the food is already here.",
                              "I feel a bit silly. Also a bit very happy. Thank you."],
                             ["You are keeping something from me, aren't you. I can tell. Your face is doing a thing.",
                              "Fine. Fine! I will pretend I did not notice. Tomorrow I am going to act so surprised. You have no idea."]]}),

    quest("f_two_sides_bridge", "Two Sides of One Bridge", 102, BRIDGE,
          text="Keith and Nick met on a bridge every day until a second server split them onto two copies of it. Take Keith's message across, and win two card duels for Nick.",
          goal=[talk(103, BRIDGE2, ["Keith sent you. Of course he did. Tell him I am busy. Tell him I am very, very busy.",
                                    "Fine. The truth. I have lost four duels in a row and I did not want him to see. That is all it is.",
                                    "Before I answer him, I need proof the cards are still worth it. Win two duels. If a stranger can do it, so can I."],
                     label="Take the message to Nick"),
                duel(2)],
          ordered=True, lvl=38, seen=[BRIDGE2], short="Two Bridges",
          pay=pay(500),
          offer=["Nick. The Black Hat. You know him? Of course you do.",
                 "We stood on this bridge every day. Then the second server opened and he was on the other side. Same bridge. Different world.",
                 "Go across. Ask if he still owes me a rematch. Do not say I asked nicely."],
          ask="Carry the message?", options=("I will carry it", "Not now"),
          remind=["Did you reach him? What did he say? Short version.", "Never mind. Finish the job first."],
          done=["You crossed over. And?", "Tell me what he said. Do not make it soft."],
          verdict={"ask": "What do you tell Keith?", "options": ["Everything Nick said", "That Nick is just busy"],
                   "pay": [pay(0, ("Charisma Ring", 1)), pay(0, ("Wisdom Ring", 1))],
                   "after": [["Four. In a row. Ha.",
                              "That is the first honest thing he has said since the servers split. Tell him to come over. I will go easy on him.",
                              "Maybe. A little."],
                             ["Busy. Sure.",
                              "He is a bad liar, that one. I will wait on the bridge. It is the only place I know where he can find me.",
                              "Thank you. For the soft version. Do not tell him I said that."]]}),
]


# ------------------------------------------------------------------ Ren, a drifter met four times (art: Gemini, character by the user)
QUESTS += [

    quest("f_ren_1_beach", "A Stranger on the Sand", 1004, BEACH,
          text="A red-haired drifter named Ren wants to see how you play before she says anything else. Win one card duel against the way she sees it.",
          goal=duel(1), lvl=3, short="On the Sand",
          pay=pay(150),
          offer=["Hold still. You walk like someone who just logged in and is still checking that their legs work.",
                 "I am Ren. I never stay anywhere long, but I like to see how new people play. One card duel. Winner picks what we talk about.",
                 "Do not worry. I go easy on the first one."],
          ask="Play a duel?", options=("Let us play", "Not now"),
          remind=["The duel first. Then I talk. That is the deal.", "I will be right here. I am always right somewhere."],
          done=["Not bad. You hesitate before you play your best card. Everybody does, at first.",
                "Here, for the road. And a tip. The world is bigger than the water you are standing next to. Go east, where the wind is."],
          verdict={"ask": "What do you tell her?", "options": ["I won fair", "You went easy"],
                   "pay": [pay(0, ("Energy Disk", 1)), pay(0, ("Antidote Disk", 1))],
                   "after": [["Fair. I will remember that. See you down the road. Probably in the wind."],
                             ["Ha. Sharp. Next time I will not. Try to keep up."]]}),

    quest("f_ren_2_prairie", "The Wind Still Blows", 1004, "s395",
          text="Ren was right about the wind. Her partner has been training, and she wants to see if you can take him on.",
          goal=fight(268, ["s395"], "Beat Ren's partner on the prairie", scale=10), after="f_ren_1_beach", lvl=12, short="Wind Blows",
          pay=pay(500),
          offer=["Told you. East, in the wind.", "My partner has been training. He got serious. The little Kotemon I started with is gone. Now there is only Kyukimon, and he is fast.",
                 "One fight. I will not call it off, so keep your medicine close."],
          ask="Take the fight?", options=("I am ready", "Not yet"),
          remind=["He is waiting. Take your time, then take the fight.", "Kyukimon does not wait for anyone. I do."],
          done=["Good. Better than good. He is grinning, you cannot see it, but he is.", "Take this. It keeps the wind off your back."],
          verdict={"ask": "What do you say?", "options": ["Your partner is strong", "You trained him well"],
                   "pay": [pay(0, ("Wind Ring", 1)), pay(0, ("Power Ring", 1))],
                   "after": [["Strong. Yes. He would want you to say that, and he would never say it himself."],
                             ["I did not train him. He trained himself and let me stand nearby. But thank you."]]}),

    quest("f_ren_3_bay", "Salt and Steel", 1004, "s485",
          text="Ren wants a rematch at Phoenix Bay, but only when you are strong enough to make it fair. Reach level 22 and beat her partner again.",
          goal=[level(22, "Reach level 22"), fight(268, ["s485"], "Beat Ren's partner at the bay", scale=15)],
          ordered=True, after="f_ren_2_prairie", lvl=16, short="Salt and Steel",
          pay=pay(900),
          offer=["You found me. Good. The bay is quiet and the water makes everyone honest.",
                 "I want a rematch, but a fair one. I do not fight people who are not ready, it is no fun. Come back at level twenty two.",
                 "Then we go again. This time my partner will not hold back."],
          ask="Come back stronger?", options=("I will", "Not now"),
          remind=["Level twenty two. Not twenty one. I am quite particular about it.", "The bay will be here. So will I, probably."],
          done=["That was a real fight. I felt every one of those hits.", "I am going to say something I do not say often. I was glad it was you."],
          verdict={"ask": "How do you answer?", "options": ["Same here", "Do not get used to it"],
                   "pay": [pay(0, ("Guard Ring", 1)), pay(200)],
                   "after": [["Good. Then it was worth the walk."],
                             ["Ha. Fair. I will try not to."]]}),

    quest("f_ren_4_desert", "Where She Started", 1004, "s640",
          text="Ren is in the Mobius Desert, where she says she started. She wants one last hard fight and will tell you why she never stays anywhere.",
          goal=fight(268, ["s640"], "Face Ren and Kyukimon in the desert", scale=21, hp=1.4), after="f_ren_3_bay", lvl=26, short="Her Start",
          pay=pay(1500),
          offer=["The desert. This is where I started. A long time ago, or a week, I lose track. Everybody here does.",
                 "I never stay anywhere because stopping makes me think. If I keep walking, I have not been logged in too long. Not yet.",
                 "One last hard fight. Not to win. To remember I can still choose to stand still. Will you?"],
          ask="Fight Ren?", options=("I will", "Not yet"),
          remind=["I will wait. For once I am good at it.", "Take your time. The sand is warm."],
          done=["That was it. That was what I wanted. Thank you.", "I am not going to stand still forever. But it is nice to know that I can."],
          verdict={"ask": "What do you tell her?", "options": ["Walk with me", "Keep walking"],
                   "pay": [pay(0, ("Spirit Ring", 1)), pay(0, ("Awake Ring", 1))],
                   "after": [["Walk with you. Hm. Maybe for a bit. Do not tell anyone I said so."],
                             ["Yes. Keep walking. And if I end up somewhere you stand, I will say hello. That is a promise."]]}),
]


# ------------------------------------------------------------------ Cipher, a security unit on the Asuka Bridge (art: Gemini)
QUESTS += [

    quest("f_cipher_standing_orders", "Standing Orders", 1005, BRIDGE,
          text="A security unit on the Asuka Bridge has orders to stop everyone and has begun to wonder why. Ask the Old Man what waiting means, and win a card duel to show it what play looks like.",
          goal=[talk(57, ASUKA_OUT, ["A machine asking about waiting? Sit down. The river never hurries and still reaches the sea.",
                                     "Tell it that standing at a bridge is not the same as being stuck. A guard who knows why he stands is a guard. One who does not is only a statue.",
                                     "And tell it to look at who crosses. Every face is a different reason."],
                     label="Ask the Old Man about waiting"),
                duel(1)],
          ordered=True, lvl=4, short="Orders",
          pay=pay(250),
          offer=["Halt. Identification required.",
                 "Query: you carry no Administrative Pass, yet I hesitated. My orders do not mention hesitation. Status: confused.",
                 "Assignment for you. Ask the old human by the plaza what waiting means. Then show me what a game looks like. One duel."],
          ask="Help the unit?", options=("I will help", "Not now"),
          remind=["Status: waiting. Data requested: the meaning of waiting, and one duel.",
                  "Take your time. That is not a joke. I am learning jokes."],
          done=["Data received. Waiting is not being stuck. Playing is not idleness. Updating internal notes.",
                "Query: when orders say stop, and a person says please, which is correct?"],
          verdict={"ask": "What do you tell Cipher?", "options": ["Orders are orders", "Use your judgement"],
                   "pay": [pay(0, ("Armor Chip", 1)), pay(0, ("Charisma Chip", 1))],
                   "after": [["Acknowledged. Orders are orders. Logging.",
                              "But I will log the person's reason too. Every time. That is within the rules."],
                             ["Acknowledged. Judgement is permitted if it is documented.",
                              "I will document it. In writing. With diagrams. Thank you, Tamer."]]}),
]
