"""Stage 3, South (Suzaku). Five quests walking South Station, the Bulk and Tranquil Swamps, the Swamp Inn, the Ether
Jungle and Suzaku City. Wild levels in the sector run 8 to 40; these are written for levels 14 to 18.

What is in it:
  s1_ayumi_roll      Teacher Ayumi counted her class and came up two short.
  s1_kyle_excuse     ...the boy who ran off has a promise to keep and no idea how to keep it. (after s1_ayumi_roll)
  s1_puck_ghost      Ghostbuster Puck hears wailing in the reeds and will not go and look.
  s1_gatomon_shift   A Gatomon trainee gets one night to run the inn on her own.        (after s1_puck_ghost)
  s1_groupie         Tamer Andy's groupie has never won anything of her own.

Voices: the game's own named townspeople stand on the generic npc ids below, so characters.json only holds the role voice.
Written here from what they say in their own town (read for this, never copied):
  54  Office Lady   s505 Suzaku Inn     Teacher Ayumi. Tired, precise, says she is not angry when she is; bad at games
                                        and honest about it.
  46  Girl          s490 Ether Jungle   Animal Lover Jen. Fast, delighted by everything with four legs, no sense of danger.
  45  Boy           s500 Suzaku City    Strongman Kyle. Big promises, loud, ashamed of being scared, would rather be told
                                        off than talked about.
  51  Geek          s465 Tranquil Swamp Ghostbuster Puck. Lists things when nervous, claims he busts ghosts, jumps at wind.
  57  Old Man       s445 Bulk Swamp     Grandpa Pug. Slow and warm; answers a question with a small story, then the answer.
  120 Tailmon        s470 Swamp Inn      A Gatomon trainee. Businesslike, teases, has never been allowed to run a night.
  46  Girl          s440 South Station  Andy's groupie. Fast, loud, everything in exclamations; has never had a win or a
                                        thought of her own to say out loud.

Nothing here touches a story flag, and no line is a line the game says.
"""
from dsl import *

STATION, BULK, TRANQUIL, SWAMPINN = "s440", "s445", "s465", "s470"
JUNGLE, CITY, SZINN = "s490", "s500", "s505"

QUESTS = [

    # ------------------------------------------------------------ 1. the chain, part one: a teacher's arithmetic
    quest("s1_ayumi_roll", "The Roll Call", 54, SZINN,
          text="Teacher Ayumi counted her class at the Suzaku Inn and came up two short. Jen is drawing animals in the "
               "Ether Jungle and Kyle went after her. Find her, and clear the RedVegiemon off the path home.",
          goal=[talk(46, JUNGLE, ["Oh! Hello! Are you looking for me? I am not lost. I know exactly where I am. It is "
                                  "the path that moved.",
                                  "Kyle got us into this. He said the big trees were full of rare animals and he was "
                                  "right, and then a RedVegiemon came out of them.",
                                  "The others ran back to the inn. I stayed to draw it. Page one is the RedVegiemon. "
                                  "Page two is my hand shaking.",
                                  "Push two of them off the path and I can finish the drawing. Then I will go back. "
                                  "That is a promise, and I keep those."],
                     label="Find Jen in the Ether Jungle"),
                kill("RedVegiemon", 2, [JUNGLE])],
          ordered=True, lvl=14, seen=[CITY], short="Roll Call",
          pay=pay(500, ("Energy Disk", 1)),
          offer=["Excuse me. Are you a tamer? Good. I am a teacher and I have lost my class.",
                 "I counted them at the inn this morning. Two missing. Jen went into the Ether Jungle to draw "
                 "animals. Kyle went after her to look brave.",
                 "Find Jen near the big trees and walk her back. If a RedVegiemon is standing between her and the "
                 "path, move it. I would do it myself if I knew how."],
          ask="Find my class?", options=("I will look", "Not now"),
          remind=["The Ether Jungle is west of here, past the bay. Jen stops for anything with four legs.",
                  "If you find Kyle first, tell him I am not angry. That is not true yet, but tell him."],
          done=["Both of them. Good. Now sit down and tell me the truth, tamer.",
                "Why did they leave the path? I have asked them twice and they only look at their shoes."],
          verdict={"ask": "What do you tell Ayumi?",
                   "options": ["They are scared of you", "They wanted one adventure"],
                   "pay": [pay(0, ("Revive Disk", 1)), pay(0, ("Antidote Disk", 1))],
                   "after": [["Scared of me. Yes. This morning I said that if this world is dangerous I will have the "
                              "game closed for the whole school.",
                              "I said it to be careful. They heard it as a threat, and they ran to have one adventure "
                              "before I took it away.",
                              "Then nobody is in trouble. Not even me. I will tell them that tonight, and I will "
                              "practise saying it kindly."],
                             ["One adventure. They are twelve. Of course they wanted one adventure.",
                              "I said something this morning about closing the game. I meant it as a worry. They "
                              "heard a threat, and they were right to.",
                              "Take this as well. One disk for each of them, and one for you, because you carried "
                              "the message I should have carried myself."]]}),

    # ------------------------------------------------------------ 2. the chain, part two: the promise he broke
    quest("s1_kyle_excuse", "The Strongest Excuse", 45, CITY,
          text="Strongman Kyle promised his teacher he would not battle in this world, then forgot the promise in one "
               "second. Spar with him at the practice ring behind the gate and carry his apology to the Suzaku Inn.",
          goal=[fight(215, [CITY], "Spar with Kyle at the practice ring", scale=15),
                talk(54, SZINN, ["Kyle sent you. Of course he did. He has been standing behind that gate for an hour "
                                 "pretending to stretch.",
                                 "Tell him I am not angry. Angry was this morning. This is the afternoon, and it is "
                                 "something quieter.",
                                 "And tell him that a promise kept because someone is watching is not a promise. It "
                                 "is a performance."],
                     label="Carry Kyle's apology to the Suzaku Inn")],
          ordered=True, after="s1_ayumi_roll", lvl=16, seen=[CITY], short="Strongest",
          pay=pay(450, ("HP Chip", 1)),
          offer=["The swamp. You are the one who pulled us out. Do not tell Teacher Ayumi that part.",
                 "I promised her I would not battle here. Then a RedVegiemon looked at me funny and I forgot the "
                 "promise in one second.",
                 "There is a practice ring behind the city gate. One fight with me so I know I am not just talking. "
                 "Then take my apology to her. I am too big to carry it myself."],
          ask="Spar and carry word?", options=("I will do both", "Not now"),
          remind=["The ring is behind the gate. A Kunemon and two Dokugumon. Do not go easy on me, I will know.",
                  "And the apology. Say it in my words: I am sorry I forgot the promise. Say the rest with your face."],
          done=["You went to the inn. What did she say? Do not make it soft. I can take it."],
          verdict={"ask": "What did Ayumi say?",
                   "options": ["She is scared, not angry", "She said you broke it"],
                   "pay": [pay(0, ("Train Chip 2", 1)), pay(0, ("Power Charge", 1))],
                   "after": [["Scared. Of what. Of me getting hurt, or of me being here at all...",
                              "I keep thinking she is the enemy of fun. She is a person who cannot log out either. "
                              "I forgot that.",
                              "I will go to the inn and say it myself. Not sorry to get out of trouble. Sorry "
                              "because it is true."],
                             ["She said that. Then she said it quietly, which is worse.",
                              "Here. It is a training chip, the good one. I am not giving it to you because you "
                              "fought me. I am giving it to you because you went to the inn and I did not."]]}),

    # ------------------------------------------------------------ 3. a noise in the reeds
    quest("s1_puck_ghost", "The Ghost in the Reeds", 51, TRANQUIL,
          text="Something has been wailing in the Tranquil Swamp for three nights and Ghostbuster Puck will not go near "
               "the water. Ask the old man at the Bulk Swamp what it is, then stand in the reeds and wait for it.",
          goal=[talk(57, BULK, ["A wailing in the reeds. My father would have called it a guest with no inn.",
                                "I have heard it twice. It is not angry. Angry has a rhythm to it. This one is only "
                                "sad, and sad is mostly cold.",
                                "Ghosts have no use for bedding. If it takes a warm thing from you and says thank "
                                "you, it is not a ghost."],
                     label="Ask Grandpa Pug what wails in the swamp"),
                fight(55, [TRANQUIL], "Stand in the reeds and face what wails", scale=15)],
          ordered=True, lvl=15, seen=[BULK, TRANQUIL], short="Ghost in Reeds",
          pay=pay(350, ("Sober Disk", 1)),
          offer=["You. Tamer. Listen. Three nights, a noise in the reeds. Low. Long. Not a Gekomon. I checked.",
                 "I am a ghostbuster. I bust ghosts. I do not have a weapon, I do not have a partner who likes water, "
                 "and I have exactly ten fingers I would like to keep.",
                 "Two jobs. Ask the old man at the Bulk Swamp what it is, he has heard everything in this swamp twice. "
                 "Then stand in the reeds tonight and let it come to you. I will take notes from here. Loudly."],
          ask="Take the night shift?", options=("I will go", "Not now"),
          remind=["The old man sits at the Bulk Swamp with his knees up. Ask him. He likes being asked.",
                  "And then the reeds. Take a disk. Not for me. For you. Obviously."],
          done=["You are back and you are not a ghost. Good. What was it? Tell me all of it. I am writing it down. "
                "My hand is steady. Look how steady."],
          verdict={"ask": "What do you tell Puck?",
                   "options": ["A Bakemon, and lonely", "It was only the wind"],
                   "pay": [pay(0, ("Antidote Ring", 1)), pay(0, ("Awake Ring", 1))],
                   "after": [["A Bakemon. Real. And it was not haunting anybody. It was sitting in the water being sad.",
                              "That is worse and better at once. Worse because sad is hard to bust. Better because "
                              "I can go and talk to it.",
                              "Here. This ring hummed when I held it near the water. Keep it. If you hear wailing "
                              "again you will know what it is. So will I."],
                             ["The wind. Right. The wind. In the reeds. At night. Three nights in a row.",
                              "Then there is nothing out there and I am very brave and I will sleep with the lamp "
                              "on because of the wind.",
                              "Take this. A ring that keeps your head clear. Mine is already much too clear."]]}),

    # ------------------------------------------------------------ 4. one night, one guest
    quest("s1_gatomon_shift", "The First Shift", 120, SWAMPINN,
          text="The youngest Gatomon at the Swamp Inn has never been allowed to run a night alone. Find her one guest "
               "brave enough to stay, clear the Gekomon out of the cellar, and give the common room one good card duel.",
          goal=[talk(51, TRANQUIL, ["A room? At the inn? With a bed and a door and no water in it?",
                                    "I have been sleeping behind a rock for six days. I am not scared. I am "
                                    "uncomfortable. There is a difference.",
                                    "Tell her I will pay, and tell her I do not snore, which is a lie she will find "
                                    "out about."],
                     label="Find a guest at the Tranquil Swamp"),
                fight(53, [SWAMPINN], "Clear the Gekomon out of the inn cellar", scale=14),
                duel(1)],
          ordered=True, after="s1_puck_ghost", lvl=15, seen=[SWAMPINN], short="First Shift",
          pay=pay(550, ("Life Disk", 1)),
          offer=["You. Do you sleep? Not here. Nobody sleeps here any more.",
                 "I am a trainee manager. I have made eleven beds, folded four hundred towels, and never run one "
                 "night on my own. Tonight the others are in the city and the desk is mine.",
                 "A manager needs a guest. Find me one. And the cellar has a Gekomon in it that sings all night, and "
                 "a guest who cannot sleep does not come back.",
                 "And this inn has a card table in the common room and nobody has ever played one game at it. One "
                 "duel. That is all a good night needs."],
          ask="Help me run the night?", options=("I will help", "Not now"),
          remind=["A guest. Anyone with legs and a blanket. The one in the swamp who is scared of ghosts never "
                  "sleeps anyway.",
                  "And the cellar. A Gekomon. It is not dangerous, it is only loud, and loud is the enemy of a good inn.",
                  "And one card duel at my table. I want somebody to lean on the desk and watch, the way guests do."],
          done=["He stayed. He actually stayed. He is asleep in room two with the lamp on.",
                "And the cellar is quiet, and there are cards on the table with the corner turned up. I ran one "
                "night. I did a whole night.",
                "Here. This is from the inn, not from me, so you cannot refuse it. Come back and sleep in a bed "
                "like a person."]),

    # ------------------------------------------------------------ 5. the girl who copied a genius
    quest("s1_groupie", "A Cap of Her Own", 46, STATION,
          text="The girl who follows Tamer Andy everywhere has never won a fight of her own. Beat the pair that blocks "
               "the station road at night and win one card duel, so she can watch from close up how it is done.",
          goal=[fight(210, [STATION], "Beat the pair that blocks the station road", scale=15),
                duel(1)],
          ordered=True, lvl=14, seen=[STATION], short="Her Own Cap",
          pay=pay(600, ("Charisma Chip", 1)),
          offer=["You are a tamer. A real one. I have seen the way you walk.",
                 "I am Andy's groupie. I have followed him since the East. I know his favourite disk, his lucky "
                 "folder, and the way he says yah when he is losing.",
                 "I have never won anything. Not one duel, not one fight. I want to watch a real one from very close "
                 "before I try it, and nobody duels a groupie.",
                 "So. Beat the Triceramon and the Tuskmon that block the station road at night. Then win one card "
                 "duel. I will stand near enough to see how a winner stands."],
          ask="Show me how it is done?", options=("I will show you", "Not now"),
          remind=["The station road at night. A Triceramon and a Tuskmon. They are not clever, they are just wide.",
                  "And one duel. Any table. I will watch your hands, not your cards."],
          done=["You did it. You did it the way I thought it was done.",
                "Except you made a mistake in the second round and you laughed at it. Andy never laughs when he "
                "loses. He says yah.",
                "I have been practising being him for a year. I think I would rather practise being me for a while. "
                "Ask me something."],
          verdict={"ask": "What do you ask her?",
                   "options": ["What do you like yourself?", "Will you tell Andy?"],
                   "pay": [pay(0, ("Red Cap", 1)), pay(0, ("School Cap", 1))],
                   "after": [["Me? I like the station. I like the wind when the train comes in. I like the shop where "
                              "nobody buys the pink disks.",
                              "That is a very small list. It is mine though. Nobody gave it to me.",
                              "Here. My cap. Not the groupie one, the one under it. My grandmother sent it. It is ugly "
                              "and it is mine."],
                             ["Tell him? No. He would say something kind and I would go back to following him.",
                              "I will stand at the station for a while and see if I still like the wind. That is "
                              "enough of a plan.",
                              "Take this. A school cap. I will need a new one anyway, one that is not a costume."]]}),
]
