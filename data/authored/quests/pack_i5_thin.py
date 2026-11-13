"""Idea I5: eight small quests for the thinnest regions (East, South, West and North Sector had 2 to 5 shipped quests each).

No story flag is read or written. Every giver is a generic townsperson who stands on the named map; unlock levels sit
about five under the wild levels of the quest. Rewards follow the neighbouring packs (e1 East, s1 South, w_west West, n1 North)
and only name items the regional shops sell (Seiryu, Suzaku, Byakko and Genbu item shops: Power, Super and Ultra Charge,
Antidote, Revive, Energy and Life Disks).

  East     i5_kid_wire_forest    Kid, East Wire Forest: a dare, three Goburimon and one Kokatorimon
           i5_geek_prairie_hum   Geek, Wind Prairie: ask the Researcher in Tyranno Valley, then quiet three Yanmamon
  South    i5_cape_ledger        Office Worker, South Cape: walk to Phoenix Bay, count Shellmon
           i5_bay_antidotes      Young Woman, Phoenix Bay: two Antidote Disks and two Apemon
  West     i5_oasis_race         Girl in Red Cap, Pelche Oasis: three Airdramon, then a race to the Mobius Desert
           i5_hall_charges       Traveler, Mirage Hall: two Super Charges, a look at Mirage Tower
  North    i5_freeze_flask       Traveler, Freeze Mountain: three Frigimon, a warm word at the Mountain Inn
           i5_kulon_lamps        Old Man, Kulon Mine: three Drimogemon and two Energy Disks for the lamps
"""
from dsl import *

WIRE_E, PRAIRIE, VALLEY = "s355", "s395", "s405"
CAPE, BAY = "s495", "s485"
OASIS, MOBIUS, HALL, TOWER = "s560", "s640", "s651", "s645"
FREEZE, INN, MINE = "s705", "s700", "s710"

QUESTS = [

    # ------------------------------------------------------------ East
    quest("i5_kid_wire_forest", "The Wire Forest Dare", 56, WIRE_E,
          text="A kid in the East Wire Forest dares you to beat three Goburimon and one Kokatorimon, and to come back "
               "with all your fingers.",
          goal=[kill("Goburimon", 3, [WIRE_E]), kill("Kokatorimon", 1, [WIRE_E])],
          pay=pay(300, ("Antidote Disk", 1)), ordered=True, lvl=9, seen=[WIRE_E], short="Forest dare",
          offer=["Hey! You! I have a game. It is called Who Is Scared Of The Forest.",
                 "I am not scared. I am just standing here. On purpose. Facing the path.",
                 "Beat three Goburimon and one Kokatorimon. The bird one. It is very loud and very pointy.",
                 "Do it and I will say you are braver than me. Out loud. Twice."],
          ask="Take the dare?", options=("Dare accepted", "Not now"),
          remind=["Three Goburimon and one Kokatorimon. I am counting, so no cheating.",
                  "I am still not scared. My knees are just resting."],
          done=["You did it! All of them! Even the loud one!",
                "Okay. You are braver than me. That is once. I will say it again when someone is listening.",
                "Here. It is my Antidote Disk. I took it so nobody would say I forgot to be careful."]),

    quest("i5_geek_prairie_hum", "The Prairie Hum", 51, PRAIRIE,
          text="The Geek in the Wind Prairie hears a hum under the wind. Ask the Researcher in Tyranno Valley what it is, "
               "then quiet three Yanmamon.",
          goal=[talk(43, VALLEY, ["The hum? Yes, yes, I logged it. Three-second period, rising, then cut off.",
                                  "Hm. No, wait. It is the Yanmamon. Their wings. Eleven hundred beats a minute and "
                                  "the wind carries the sound all the way down the grass.",
                                  "Tell your friend the hum is real and the thing making it can be fought."],
                     label="Ask the Researcher about the hum"),
                kill("Yanmamon", 3, [PRAIRIE])],
          pay=pay(400, ("Revive Disk", 1)), ordered=True, lvl=11, seen=[PRAIRIE], short="Prairie hum",
          offer=["Listen. No, listen. Do you hear it? Under the wind. A hum. Pitch about 180 hertz, wobbling.",
                 "I have written down: one, it is not the wind. Two, it is not me. Three, I do not know what it is.",
                 "There is a Researcher in Tyranno Valley with a lot of notebooks. Ask him. Then deal with whatever it is.",
                 "Please. I cannot sleep and I do not even live here."],
          ask="Look into the hum?", options=("I will look", "Not now"),
          remind=["The Researcher in Tyranno Valley. Notebooks, goggles, you cannot miss him.",
                  "And then the hum. I will keep listening. For science."],
          done=["Wings. It was wings. Of course it was wings.",
                "It is quiet! I can hear the grass. It is very loud, the grass.",
                "Here. A Revive Disk. Item one on my list of things I was not going to need."]),

    # ------------------------------------------------------------ South
    quest("i5_cape_ledger", "A Ledger for the Cape", 53, CAPE,
          text="An Office Worker at South Cape needs the bay lights checked at Phoenix Bay and the Shellmon on the "
               "cape thinned out before his ledger is due.",
          goal=[go(BAY, "Walk to Phoenix Bay and look at the lights"), kill("Shellmon", 3, [CAPE])],
          pay=pay(550, ("Energy Disk", 1)), ordered=True, lvl=15, seen=[CAPE], short="Cape ledger",
          offer=["Good day. I am from the harbour office. I am here to count things and I have counted two.",
                 "The ledger wants three more lines. One, the lights at Phoenix Bay are lit. Two, the Shellmon on this "
                 "cape do not block the road.",
                 "I would go myself. My shoes are office shoes and the Shellmon have opinions about them.",
                 "Would you walk to the bay, look at the lights, and thin the Shellmon on your way back?"],
          ask="Fill in the ledger?", options=("I will check", "Not now"),
          remind=["Phoenix Bay for the lights. Then three Shellmon off the cape road.",
                  "I have brought a pen. I will not be needing the pen until you are back."],
          done=["Lights lit. Road clear. Three lines, all true. This is the best ledger I have written.",
                "I will mention you in the margin. Only the margin, I am afraid, but it is a fine margin.",
                "Here. An Energy Disk, from the harbour budget. Please do not tell the harbour."]),

    quest("i5_bay_antidotes", "Antidotes for the Bay", 50, BAY,
          text="A young woman at Phoenix Bay needs two Antidote Disks for her Digimon, and the Apemon that bit it chased "
               "off the shore path.",
          goal=[bring("Antidote Disk", 2, "Bring two Antidote Disks"), kill("Apemon", 2, [BAY])],
          pay=pay(400, ("Revive Disk", 2)), lvl=14, seen=[BAY], short="Bay antidotes",
          offer=["Oh, thank goodness. Are you heading to town? Do you have a moment?",
                 "My partner was bitten by an Apemon on the shore path and the poison is not clearing. I have nothing left.",
                 "The shop in Suzaku City sells Antidote Disks. Could you bring me two?",
                 "And please chase the Apemon off the path. Two of them, I think. I would not ask if I were not scared."],
          ask="Help her?", options=("I will help", "Not now"),
          remind=["Two Antidote Disks, and the Apemon off the shore path.",
                  "My partner is resting. It is very brave. It just wants you to hurry."],
          done=["It is breathing easier already. Thank you. Thank you both.",
                "I do not have much, but a Revive Disk is no use to me now and two would be a waste. Take them."]),

    # ------------------------------------------------------------ West
    quest("i5_oasis_race", "The Oasis Race", 101, OASIS,
          text="The Girl in the Red Cap at Pelche Oasis bets you cannot beat three Airdramon at the water and still be "
               "first to the Mobius Desert.",
          goal=[kill("Airdramon2", 3, [OASIS]), go(MOBIUS, "Reach the Mobius Desert")],
          pay=pay(900, ("Super Charge", 1)), ordered=True, lvl=24, seen=[OASIS], short="Oasis race",
          offer=["Hey. You look fast. I look faster, but you look fast.",
                 "Race. Three Airdramon off the water here, then all the way to the Mobius Desert. First one there wins.",
                 "I will go ahead and tell you I already won. That way when you lose, it is not a surprise.",
                 "Well? Or are you saving your legs for something better?"],
          ask="Take the race?", options=("Race you", "Not now"),
          remind=["Three Airdramon off the water, then the Mobius Desert. I am already stretching.",
                  "You are not slow. You are just not me. Go."],
          done=["Huh. You got here. And the water is clear. And you have not even fallen over.",
                "Fine. You win. I will win next time. I will win very hard next time.",
                "Here. A Super Charge. My prize money, and a bad winner pays up anyway."]),

    quest("i5_hall_charges", "Charges for the Hall", 47, HALL,
          text="A Traveler at Mirage Hall wants two Super Charges before he climbs, and a look at Mirage Tower to see "
               "whether the stairs are still there.",
          goal=[bring("Super Charge", 2, "Bring two Super Charges"), go(TOWER, "Look up at Mirage Tower")],
          pay=pay(900, ("Ultra Charge", 1)), lvl=26, seen=[HALL], short="Hall charges",
          offer=["Ah, a person with legs. I have walked a good deal of this world and it has been kind to me, mostly.",
                 "I want to climb the Mirage Tower. I have been told the stairs are there. I have also been told they are not.",
                 "Bring me two Super Charges from the shop in Byakko City and I will believe the first story.",
                 "And go and look at the Tower first. I would rather hear it from someone who still has the use of their knees."],
          ask="Go and look?", options=("I will look", "Not now"),
          remind=["Two Super Charges, and a good look at Mirage Tower.",
                  "Do not climb it. I am saving the climb. It is about the only thing I have left to save."],
          done=["The stairs are there. Hah. In my experience the stairs are always there, it is the legs that go.",
                "Here. An Ultra Charge. I carried it across half the world and I have never found the day to use it. Perhaps today."]),

    # ------------------------------------------------------------ North
    quest("i5_freeze_flask", "A Flask for Freeze Mountain", 47, FREEZE,
          text="A Traveler on Freeze Mountain has a cold flask and no fire. Clear three Frigimon off the path and walk "
               "down to the Mountain Inn for something hot.",
          goal=[kill("Frigimon", 3, [FREEZE]), go(INN, "Walk down to the Mountain Inn")],
          pay=pay(1000, ("Super Charge", 2)), ordered=True, lvl=37, seen=[FREEZE], short="Freeze flask",
          offer=["Fine weather. If you like weather that is trying to be a wall.",
                 "I have a flask and the flask has gone cold. I have been told that the Inn has a fire. I have not been told "
                 "how to reach the Inn with a Frigimon on every second rock.",
                 "Three of them, off the path, and I will walk down behind you. In my experience, the one in front takes the bites.",
                 "And in the Inn, you can say I sent you. It does not help. But it is nice to be sent."],
          ask="Clear the path?", options=("I will clear it", "Not now"),
          remind=["Three Frigimon off the path. Then the Inn and the fire.",
                  "My flask has not got warmer. I have been checking."],
          done=["Warm! Look at that, a flask that is not an ice block. You are a very good person to have on a mountain.",
                "Here. Two Super Charges. I was keeping them for a rainy day, but up here it only ever snows."]),

    quest("i5_kulon_lamps", "Lamps for the Kulon Mine", 57, MINE,
          text="The Old Man in the Kulon Mine keeps the lamps lit for the miners. Three Drimogemon have dug up his lamp "
               "oil, and he needs two Energy Disks to fill the lamps again.",
          goal=[kill("Drimogemon", 3, [MINE]), bring("Energy Disk", 2, "Bring two Energy Disks")],
          pay=pay(1100, ("Life Disk", 1)), lvl=38, seen=[MINE], short="Mine lamps",
          offer=["Sit, sit. The ground is cold but it is honest. I am the one who keeps the lamps here.",
                 "Three Drimogemon dug through my oil shed last night. They did not drink it. They just wanted to see "
                 "what was under it. That is the sort of neighbours I have.",
                 "Clear them out for an old man. And bring me two Energy Disks from the Genbu City shop. The lamps drink "
                 "them in a way I do not understand and do not question.",
                 "The mine has been dark before. I would rather it were not dark tonight."],
          ask="Light the lamps?", options=("I will help", "Not now"),
          remind=["Three Drimogemon, and two Energy Disks for the lamps.",
                  "They do not mind the dark, the Drimogemon. It is the miners who mind."],
          done=["There. Look at them burn. A whole row of small suns in a hole in the ground.",
                "Take this Life Disk. It has kept me alive for a long time, and I would rather it kept somebody lively."]),
]
