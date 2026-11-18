"""Stage 1, Central Sector on Asuka: the inn, the shops, El Dorado and the park, in the week after the maintenance.

Five quests, all given by townspeople the story does not need (npc_story_check: FREE on every map they stand on):
  c1_boy_sleepless   Chicago Green cannot sleep; the hum in the inn wall is a pipe, and a stray Kunemon was only keeping warm
  c1_riggs_gear      Riggs from LA has asked every shop for the same rare gear; the one buyer in the auction back room is him
  c1_boy_lot         Smith Junior's father bought a sealed auction lot, and a Cardmon has it up a tree in the park
  c1_geek_set        a collector at El Dorado needs the last piece of his set: Junior's suit (follows c1_boy_lot, its reward)
  c1_girl_angemon    Mika wants her Patamon to digivolve; he is scared of being a stranger to her, and only wants to see a fair duel

Chain: c1_boy_lot pays the Gym Suit, c1_geek_set needs exactly that suit, at El Dorado, with one duel in it.
Dropped ideas (kept here so the next worker does not re-pitch them): Master John and the bar sign (npc 25 has no name tab in
characters.json), Fussy Freda as a giver (npc 56 is tagged "Kid", wrong name tab for her), Tai Kong Wong fishing (STORY: his talk
hands over the fishing pole), Steve and Bill (Steve is SERVICE at the Yellow Cruiser, Bill is only on Amaterasu), Kail's lost Digimon
hint (a story hint the player needs), the Old Woman's hole in the park, Miss Misha's job application, Renamon's rival test,
Lazy Alan's free week, the Lamb Chop lunch gossip.
"""
from dsl import *

ASUKA, INN2, SMITH, JUNK, DORADO = "s200", "s240", "s245", "s250", "s280"
PARK = "s330"

QUESTS = [

    # ------------------------------------------------------------ Chicago Green, Inn 2F
    quest("c1_boy_sleepless", "A Hum In The Wall", 45, INN2,
          text="Chicago Green has not slept since the maintenance. See where the humming in the park wall starts, clear the "
               "Kunemon out of the inn wall, and find out what is really keeping him awake.",
          goal=[go(PARK, "Look at the park wall where the hum starts"),
                fight(34, [INN2], "Clear the Kunemon out of the inn wall", scale=14)],
          ordered=True, lvl=3, seen=[PARK], short="Hum in wall",
          pay=pay(200),
          offer=["One, two, three, four... no. It is not working. I have counted to four hundred and something and I am wider awake than ever.",
                 "There is a hum in this room. In the wall, right there. My Digimon sleep through it. Three of them, snoring, and not one of them hears it.",
                 "It comes from the park wall, I am sure of it. Go and see where it starts, then come back and clear the ones that have moved into this one."],
          ask="Deal with the hum?", options=("I will look", "Not now"),
          remind=["The park wall first. Then the wall in here. Then I sleep. That is the whole plan and I am very attached to it.",
                  "If you find anything with six legs, do not bring it back to show me. I am tired, not brave."],
          done=["You cleared them out. Thank you. Listen, though. Listen. Still humming.",
                "So it was the pipe all along. The Kunemon were only sitting on it because it is warm. I evicted somebody from a radiator.",
                "My Gabumon has had one eye open this whole time. It was awake. It was waiting for me to stop counting."],
          verdict={"ask": "What do you tell him?", "options": ["The pipe will hum forever", "Say the hum is fixed"],
                   "pay": [pay(0, ("Red Cap", 1)), pay(0, ("Bandanna", 1))],
                   "after": [["Forever. Well. Thank you for not softening it.",
                              "Then I will learn to like it. Starting now. No. Starting tomorrow. I am very tired.",
                              "Here. From Chicago. You sleep better with something on your head, and I have two."],
                             ["Fixed. Ha! Then I am going to sleep for a week.",
                              "I can still hear it, but I have decided it is the sea. Do not correct me, I am nearly asleep.",
                              "Take this. Tie it tight enough and you cannot hear pipes at all."]]}),

    # ------------------------------------------------------------ Riggs, Junk Shop
    quest("c1_riggs_gear", "The Gear That Is Never There", 53, JUNK,
          text="Riggs from LA has asked every shop in Asuka for the same rare gear and heard no every time. Ask the woman in the "
               "Junk Shop where rare things go, then look at El Dorado and Smith's Shop.",
          goal=[talk(54, JUNK, ["Rare things? Darling, rare things do not sit on shelves in this city. They go up at the auction.",
                                "And the auction keeps a back room, and the back room has one customer who buys nearly everything.",
                                "I have never seen his face. Only the suit, and the way he says the word no."],
                     label="Ask Miss Asami where rare gear goes"),
                tour([DORADO, SMITH], 2, label="Look at El Dorado and Smith's Shop")],
          ordered=True, lvl=4, short="Never There",
          pay=pay(250),
          offer=["Divine Barrier. Sniper Shield. Ronin Blade. I have asked every shop in this city and every one of them says the same word. No.",
                 "I flew a long way for gear like this. Ask the lady over there where the rare things actually go. Then look at the auction club and at Smith's shop.",
                 "Come back and tell me I am not going mad. Or tell me I am. Either way I would like to know."],
          ask="Ask around for him?", options=("I will ask", "Not now"),
          remind=["The lady first. She has that look, the one that knows where things go.",
                  "Then El Dorado and Smith's. Do not buy anything. You are on a job."],
          done=["So rare gear never sits on a shelf. It goes to the auction, and the auction keeps a back room for one buyer.",
                "One buyer. From out of town. Wears a suit like mine and does not haggle.",
                "...it is me. I have been outbidding myself for two weeks."],
          verdict={"ask": "What do you tell him?", "options": ["That he bought it himself", "A stranger beat him to it"],
                   "pay": [pay(0, ("Guard Barrier", 1)), pay(0, ("Metal Guard", 1))],
                   "after": [["Right. Of course. I would like to say this is the first time.",
                              "I have four of everything and I cannot remember buying one of them. There is a lesson in there.",
                              "Here. A Guard Barrier. It is the cheap cousin of the one I wanted, and I have three more "
                              "of it in my room."],
                             ["A stranger. Hm. That is a relief, and also a little rude.",
                              "I will find them. I am from LA. We can be patient in traffic, so we can be patient in shops.",
                              "Take this. A metal guard. It stops most things and it does not need finding."]]}),

    # ------------------------------------------------------------ Smith Junior, Smith's Shop
    quest("c1_boy_lot", "The Lot Nobody Opened", 45, SMITH,
          text="Junior's father bought a sealed auction lot and something has taken it out into Central Park. Ask the girl at "
               "El Dorado what the lots usually hold, then get the parcel back.",
          goal=[talk(46, DORADO, ["Sealed lot? Sure. The auction wraps them in paper and nobody opens them but the buyer.",
                                 "Usually it is gear nobody wanted, or a work suit, or something a tamer left behind and forgot to collect.",
                                 "If your friend is hoping for treasure, tell him to hope for a work suit. He will be happier."],
                     label="Ask about sealed lots at El Dorado"),
                fight(327, [PARK], "Get the parcel back from the Cardmon", scale=16)],
          ordered=True, lvl=3, seen=[PARK], short="Unopened Lot",
          pay=pay(150, ("Gym Suit", 1)),
          offer=["Off the record. My dad bought one of those sealed auction lots and he says I am not to open it.",
                 "I left it in the back, like he said. Something has taken it out into the park. It has been up a tree for a week and I cannot say that to my dad.",
                 "Ask the girl at El Dorado how the lots work. Then get the parcel back. Before my dad gets back from the auction."],
          ask="Find out about the lot?", options=("On it", "Not now"),
          remind=["El Dorado first. The girl there knows how the lots are wrapped and what is inside them.",
                  "The Cardmon has it in a tree in the park. Do not look in its nest. It is mostly receipts."],
          done=["You got it back. It is a little chewed, and it is a little heavier than it was.",
                "So it is not treasure. It is a work suit. For a gym. And it is my size. My exact size. That is either wonderful or a warning.",
                "Take one from the stock, on me. Dad will never notice. Dad notices everything. He will never notice."],
          verdict={"ask": "What do you tell him about the suit?", "options": ["Wear it with pride", "Hide it from your dad"],
                   "pay": [pay(0, ("Power Charge", 1)), pay(0, ("Energy Disk", 1))],
                   "after": [["With pride! Yes! I am going to wear it to the counter and lift things.",
                              "If anyone asks, it is a uniform. People trust a uniform.",
                              "Here, take these. Charged up. You will need them for all the lifting I am about to do."],
                             ["Hide it. You are right. He will ask where the box went.",
                              "I will keep it under the counter and take it out when he is at the auction. That is almost the same as wearing it.",
                              "Take this. For the trouble. I pay my people."]]}),

    # ------------------------------------------------------------ a set collector at El Dorado
    quest("c1_geek_set", "A Set With One Hole", 51, DORADO,
          text="A collector at El Dorado has a gear set with one piece missing, and Junior's Gym Suit is that piece. Bring it to "
               "El Dorado and win one duel in it.",
          goal=[bring("Gym Suit", 1, "Bring the Gym Suit Junior gave you"),
                duel(1)],
          ordered=True, after="c1_boy_lot", lvl=5, short="One Hole",
          pay=pay(250, ("Booster 01a", 1)),
          offer=["I collect sets. Not items. Sets. Four pieces that were made for one another and then sold in four different towns.",
                 "The gym set is one piece short and has been for a year. And I hear Junior at Smith's has just been given the suit.",
                 "Bring it here. Then win one duel wearing it, so it counts as used. That is the rule. I wrote the rule."],
          ask="Bring the suit to El Dorado?", options=("I will bring it", "Not now"),
          remind=["One suit, one duel, one very happy collector. Junior will sell it, he sells everything.",
                  "The rest of the set is laid out on the table. It is beautiful and it is missing a suit."],
          done=["The set is whole. Look at it. Four pieces and one boy's work clothes.",
                "And you won in it. So it is not just a collection now, it is a collection with a story. Better.",
                "Here. A booster from the back of my drawer. There is a good card in there. I am almost sure. Take a friend anyway."],
          verdict={"ask": "He asks which piece you would wear.", "options": ["The headband", "The shoes"],
                   "pay": [pay(0, ("Headband", 1)), pay(0, ("Runner Shoes", 1))],
                   "after": [["The headband. Correct. It is the piece with the most personality.",
                              "You wear it and the rest of the set behaves better. That is not science, that is experience.",
                              "Here. It matches the set. Do not wear it to the auction, people will bid."],
                             ["Shoes. Practical. I respect that, even if I do not feel it.",
                              "Bad shoes ruin a whole set. Ask me how I know. Do not ask me.",
                              "Take them. They have been in a drawer for a year and they are desperate to be walked in."]]}),

    # ------------------------------------------------------------ Mika, Asuka City
    quest("c1_girl_angemon", "Bigger, And Safer", 46, ASUKA,
          text="Mika wants her Patamon to digivolve into Angemon and he will only say why after he has watched one fair card duel. "
               "Win one, then ask him why.",
          goal=[duel(1),
                talk(371, ASUKA, ["Oh. Hello. I watched. Nobody was scared, and you both shook hands at the end. I did not know a game could look like that.",
                                  "I still do not want to be big. When I am big I will be a different shape, and for a while Mika will look at me and see a stranger.",
                                  "Tell her that. Tell her I am not refusing her. I am only afraid of that one little while."],
                     label="Ask Patamon why")],
          ordered=True, lvl=2, short="Bigger Safer",
          pay=pay(200),
          offer=["Patamon will not digivolve into Angemon. I have asked him a hundred times. Maybe a hundred and one.",
                 "Just now he said something strange. He said: show me one fair game first, and then I will tell you why.",
                 "So win a duel. A nice one, not a scary one. Then ask him. Then come back to me and I will be brave about it."],
          ask="Win a duel for Patamon?", options=("I will", "Not now"),
          remind=["One fair duel. Then ask him why. Then me. In that order, please.",
                  "I have been practising being brave. It looks a lot like waiting."],
          done=["You came back! And Patamon is still small. And he says it is not my fault.",
                "He says he will be my partner at any size. That is a thing I did not know I needed to hear."],
          verdict={"ask": "What do you tell Mika?", "options": ["Being big is not being safe", "When he is ready"],
                   "pay": [pay(0, ("Cat Ears", 1)), pay(0, ("School Cap", 1))],
                   "after": [["Then what is safe? A friend who stays. That is what he said, too. He said it first, actually.",
                              "I am going to stop asking him to be big. I am going to ask him to play instead.",
                              "Here. I made these for him and they were far too big, so now they are for you."],
                             ["When he is ready. That could be a long time. I am not very good at long times.",
                              "But I can wait. I waited for my candy and it never came back, so I am very practised at waiting.",
                              "Take this. It is from my bag. It is not much, but it is mine, so it is a lot."]]}),
]
