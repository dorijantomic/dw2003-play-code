"""Stage 5, North (Genbu): Boot and Snow and Freeze Mountain, the Mountain Inn, the Kulon Mine and Pit, the Lake of Ice,
the Legendary Gym, the Ice Dungeon, the Chamber Room, the Battle Gate and Genbu City. Wild levels here are 36 to 58.

One chain, three quests, walking the whole sector: Kimo from Hawaii (Lake of Ice) loses his postcards, the man who wants to
build a villa in the snow (Lake of Ice) walks his building sites, and the old writer Tor (Genbu City) walks the north for
chapter nine of his novel. Plus one small story at the Legendary Gym.

Voices: these are the game's own named townspeople, and they stand on the generic npc ids below, so characters.json only
holds the role voice. Written here from what they say in their own town (read, never copied):
  49  Young Man     s715 Lake of Ice     Kimo. Homesick, polite, jokes about the cold, says the plain true thing last.
  53  Office Worker s715 Lake of Ice     Perrin. Tired office formal, plans out loud, kind under the paperwork.
  45  Boy           s720 Legendary Gym  Kazuya. Eager, nervous, does not want to be fussed over.
  46  Girl          s720 Legendary Gym  Cecilia. Fast, loud, bossy, fond of him and unable to say it plainly.
  57  Old Man       s760 Genbu City      Tor. Wanders off the point, warm, funny about being old and unread.
"""
from dsl import *

BOOT, FREEZE, INN = "s690", "s705", "s700"
ICE, GYM = "s715", "s720"
DUNGEON, CHAMBER, GATE, CITY = "s735", "s750", "s755", "s760"

QUESTS = [

    # ------------------------------------------------------------ 1. the chain, part one: a man from a warm place
    quest("n1_kimo_postcard", "A Postcard from the Ice", 49, ICE,
          text="Kimo came north to see the snow and lost his postcards to an Icemon. Ask the man with the villa plans "
               "where they went, and take two of them back from the Icemon.",
          goal=[talk(53, ICE, ["The Icemon? Yes. It sits by my stakes and sorts paper. I assumed it was helping me.",
                               "It does not eat the paper. It keeps it out of the wet. That is more than most builders "
                               "do for my drawings.",
                               "His cards are under the third stake. And tell him I envy him. He has somewhere to go "
                               "back to."],
                     label="Ask the villa man about the postcards"),
                kill("Icemon", 2, [ICE])],
          pay=pay(900),
          offer=["Achoo! Sorry. Snow in my nose. I am Kimo. I am from Hawaii. It is warm there all year and I have "
                 "never owned a coat.",
                 "I came up here to see the snow. I have seen it. It is white and it is cold and it is inside my shoes.",
                 "I wrote three postcards to my sister, and the wind took them, and an Icemon took them from the wind. "
                 "Would you get two of them back?",
                 "And ask the man with the villa plans. He sits by the water and draws houses and he sees everything."],
          ask="Find the postcards?", options=("I will look", "Not now"),
          remind=["The Icemon sits by the villa man's stakes and sorts paper. It is not fast. Nothing here is fast "
                  "except the wind.",
                  "Two postcards, please. The third one is in my boot and it is staying there."],
          done=["Look at that. Frost on the corners and one small bite. My sister will think I am a very exciting person.",
                "Now the hard part. She asks if I am having fun. What do I write?"],
          verdict={"ask": "What should Kimo write home?",
                   "options": ["Write her the truth", "Write her something warm"],
                   "pay": [pay(0, ("Ice Ring", 1)), pay(0, ("Flame Ring", 1))],
                   "after": [["Then I will write it. It is cold, I am a little scared, and I miss the sea. She will "
                              "worry, and then she will write back. That is what sisters are for.",
                              "Here. This ring is cold even in my hand. It is the most honest thing I have found up here."],
                             ["You are right. She is small. I will tell her about the snow, and the Icemon who likes "
                              "paper, and the man building a house in it. All true. Just not all of it.",
                              "Here. A warm ring. I have carried it all week and I did not know it was warm until now."]]},
          lvl=36, seen=[ICE], short="Postcard"),

    # ------------------------------------------------------------ 2. the chain, part two: a house on the ice
    quest("n1_perrin_villa", "A Villa on the Ice", 53, ICE,
          text="Perrin is going to build a house on the Lake of Ice. Walk his three possible sites and clear the Freeze "
               "Mountain path, then tell him who the house is for.",
          goal=[tour([BOOT, FREEZE, INN], 3, label="Walk the three possible building sites"),
                fight([219], [FREEZE], "Clear the Kuwagamon off the Freeze Mountain path", scale=14)],
          pay=pay(1200), after="n1_kimo_postcard",
          offer=["You are the one the Hawaiian man sent. Good. I am Perrin. I am going to build a house up here. "
                 "On the ice. With a window.",
                 "I am not a builder. I write reports about other people's buildings, in an office, in a suit. "
                 "This one will be mine.",
                 "Three places could hold it. The road up at Boot Mountain. The path over Freeze Mountain. The Inn, "
                 "where there is soup. Walk all three and tell me what you see.",
                 "And something large is sitting on the Freeze Mountain path. A cart cannot pass a large thing. "
                 "Would you move it?"],
          ask="Walk the sites for Perrin?", options=("I will walk them", "Not now"),
          remind=["Boot Mountain, Freeze Mountain, and the Inn. Three walks. I would go myself but my boots are "
                  "office boots.",
                  "And the large thing on the path. It is not a cow. I checked."],
          done=["You walked all three. Sit down. Tell me the worst one first.",
                "So the ice sings at night, the mountain is loud, and the Inn has soup and somebody else's "
                "conversation.",
                "I want the ice. I have had enough conversation. But tell me this. Who is the house for?"],
          verdict={"ask": "Who is the villa for?",
                   "options": ["For you, to wait in", "For whoever comes after"],
                   "pay": [pay(0, ("Down Jacket", 1)), pay(0, ("Prayer Ring", 1))],
                   "after": [["For me, then. A room, a kettle, and a window with nothing in it. That is not a sad "
                              "thing. I have decided it is not.",
                              "Here. My spare coat. You will come up and visit, and I will pretend I did not plan "
                              "for that."],
                             ["For whoever comes after. A door left open, a kettle on the sill, and a note that says "
                              "the owner is out.",
                              "Here. My mother's prayer ring. She said it was for a house with a door people knock "
                              "on. This one will have one."]]},
          lvl=37, seen=[ICE], short="The villa"),

    # ------------------------------------------------------------ 3. the Legendary Gym: a test he was not told about
    quest("n1_cecilia_proof", "Proof He Can", 46, GYM,
          text="Cecilia has set Kazuya a card duel against a stranger and asked for no mercy. Win it, then hear what "
               "he has to say when it is over.",
          goal=[duel(1),
                talk(45, GYM, ["You did not go easy. Nobody ever does not go easy on me. Thank you.",
                               "She thinks I do not know she asked you. I have known her since we were six. She is "
                               "bad at secrets and very good at being scary.",
                               "Do not tell her I know. Or tell her. I do not mind. I am going to beat you next time "
                               "either way."],
                     label="Hear Kazuya out")],
          pay=pay(1000), ordered=True,
          offer=["You. Yes, you. I am Cecilia. That boy by the wall is Kazuya and he will not do one thing on his own, "
                 "not one, not ever.",
                 "So I told him a stranger wants to duel him. He is excited. He does not know I asked you to win.",
                 "Do not go easy on him. If he loses to a stranger and gets up again, that is the whole lesson. "
                 "Will you?"],
          ask="Duel Kazuya and do not go easy?", options=("I will duel him", "Not now"),
          remind=["He is right there, shuffling his cards and pretending not to be nervous. Win it.",
                  "I am not cruel. I am tired of carrying him. There is a difference and it is small."],
          done=["Well? Did he cry? He did not cry. I can see it on your face.",
                "He got up and shook your hand. He has never done that. Not once."],
          verdict={"ask": "What do you tell Cecilia?",
                   "options": ["He knew about the test", "He never knew a thing"],
                   "pay": [pay(0, ("Tiger Glove", 1)), pay(0, ("Mighty Guard", 1))],
                   "after": [["He knew. He sat there, let me plan it, and said nothing at all.",
                              "That is not a scared boy. That is a patient one. I have been pushing a door that was "
                              "already open.",
                              "Here. A glove from the armoury in Genbu City. Wear it and he will know who taught you "
                              "to stand straight."],
                             ["Good. Let him have it. He got up in front of a stranger and he thinks he did it alone.",
                              "Next time I will not arrange the stranger. Here. A guard from the armoury in Genbu "
                              "City. He will want to see you hold it."]]},
          lvl=36, seen=[GYM], short="Proof"),

    # ------------------------------------------------------------ 4. the chain, part three: chapter nine
    quest("n1_tor_novel", "Chapter Nine", 57, CITY,
          text="Tor is writing a novel about the tamer who came north. Walk the chamber, the gate and the dungeon, and "
               "hear the man with the house speak for himself.",
          goal=[tour([CHAMBER, GATE, DUNGEON], 3, label="Walk the three places Tor cannot"),
                talk(53, ICE, ["A writer wants my own words? Tell him I am not interesting. I am a man with a plan and "
                               "a very bad coat.",
                               "Tell him the ice is loud at night. It talks. Nobody believes that until they sleep "
                               "on it.",
                               "And tell him this. I did not come here to be alone. I came here to see if I could "
                               "stand it. That is different, and that is the whole book."],
                     label="Hear the man with the house in his own words")],
          pay=pay(1400), after="n1_perrin_villa",
          offer=["Sit down, sit down. I am Tor. I write novels. You have not read them. Nobody has, and that is the "
                 "tragedy of our age.",
                 "I am writing one about a real tamer. You. Everyone up here is talking about the kid who came north "
                 "with three badges and no coat.",
                 "Eight chapters are done. Chapter nine needs three places my knees will not take me to, and one "
                 "man's own words.",
                 "The chamber with the door to the real world. The gate where the Leader stands. The dungeon under "
                 "the ice. And the man who built a house up here. Walk them and bring me what you saw."],
          ask="Gather chapter nine?", options=("I will go", "Not now"),
          remind=["The chamber, the gate, the dungeon. And the man with the house. Four walks for one chapter.",
                  "Take your time. I have been rewriting the same paragraph for a week."],
          done=["The gate. The chamber. The ice. And a man who built a house in it. I have enough. I have more than "
                "enough.",
                "I finished chapter nine while you were out. The hero does not save anything. He stays, in a bad "
                "place, and makes it a place.",
                "It is the best thing I have written and it is not about you at all. Do you want to hear it, or do "
                "you want to hit me?"],
          verdict={"ask": "What do you say about chapter nine?",
                   "options": ["Write me in as the hero", "Keep it about staying"],
                   "pay": [pay(0, ("Fairy Tale", 1)), pay(0, ("Glasses", 1))],
                   "after": [["Then I will write you in. Chapter ten. You arrive, you save everything, and everybody "
                              "claps. It will be the worst chapter in the book and children will love it.",
                              "Here. The first copy. Do not read chapter ten."],
                             ["Good. Then it stays. A boy who saves everything is a story. A man who stays in the "
                              "cold is a person.",
                              "Here. My spare glasses. You read people better than I do, and I want the world to "
                              "look at you the way it looks at me."]]},
          lvl=38, seen=[CITY], short="Chapter nine"),
]
