"""Stage 2, East (Seiryu): West and East Wire Forest, the Forest Inn and its basement, Protocol Forest and Ruins,
Divermon's Lake, Duel Island, Wind Prairie, Kicking Forest, Tyranno Valley, East Station, and Seiryu City with its
three towers. Wild levels here are 1 to 30.

Five small stories, one of them a two-quest chain across Seiryu City and the Gale Tower:
  e1_elle_stairs     Elle at Zephyr Tower cannot get Maria up the stairs; clear the thing on them and tell her.
  e1_maria_lunch     Maria is coming up tonight; tell Elle, and fetch the lunch she left at the wrong tower.
  e1_laura_lunch     Laura leaves a lunch for Veemon at the inn door every day; a Goburimon took it today.
  e1_cary_offering   Bakemon Fan Cary calls something down the inn stairs and needs a card game and a witness.
  e1_olivia_survey   Ms. Olivia from the rival company wants to know why this game is fun.

Voices: these are the game's own named townspeople, and they stand on the generic npc ids below, so characters.json
only holds the role voice. Written here from what they say in their own town (read, never copied):
  46  Girl          s360 Forest Inn      Laura. Card collector, talks in exclamations, brave about cards, shy about people.
  46  Girl          s420 Seiryu City     Maria. Crybaby, apologises for everything, counts on her fingers, wants to be braver.
  46  Girl          s425 Zephyr Tower    Elle. Practical older-sister voice, plans out loud, hides worry behind lists.
  45  Boy           s365 Forest Inn BF   Cary. Bakemon fan, scared of everything, jokes about being scared.
  54  Office Lady   s430 Seiryu Tower    Ms. Olivia. Runs the rival company, delighted by everything, says the quiet part.
  53  Office Worker s430 Seiryu Tower    Manager Sasaki. Tired employee, dry, honest when the boss is not listening.
  178 Pink-haired Girl s370 Protocol Forest  Kail. Cheerful friend, notices everything, reports it like gossip.
"""
from dsl import *

INN, INN_BF = "s360", "s365"
PROTOCOL, RUINS = "s370", "s375"
CITY, ZEPHYR, TOWER, GALE = "s420", "s425", "s430", "s435"
DUEL_ISLE, PRAIRIE = "s385", "s395"

QUESTS = [

    # ------------------------------------------------------------ 1. the chain, part one: the thing on the stairs
    quest("e1_elle_stairs", "The Thing on the Stairs", 46, ZEPHYR,
          text="Elle is waiting at Zephyr Tower and Maria will not come up while something big sits on the city "
               "stairs. Clear the stairs, then tell Maria it is gone.",
          goal=[fight(204, [CITY], "Clear the city stairs", scale=12),
                talk(46, CITY, ["You moved it. I watched from behind the sign with my hands over my ears, and you "
                                "just moved it.",
                                "I am coming up. Tonight, when the lamps come on. That is a promise and I am very "
                                "bad at promises, so you should probably check.",
                                "Tell Elle. Tell her I am not scared. I am nearly not scared. That is the best I "
                                "can do today."],
                     label="Tell Maria the stairs are clear")],
          pay=pay(500, ("Life Disk", 1)), ordered=True, lvl=8, seen=[ZEPHYR], short="Stairs",
          offer=["You are the tamer everyone is talking about. I am Elle. I have been standing at this tower since "
                 "breakfast and my feet have gone quiet.",
                 "Maria is down in the city. She will not come up while something big sits on the stairs, and I "
                 "cannot move it and she cannot walk past it.",
                 "Would you move the thing first, and then tell her it is gone? She will believe you. She has known "
                 "me for nine years and she has never believed me once."],
          ask="Help them meet?", options=("I will help", "Not now"),
          remind=["The big thing is at the bottom of the stairs, near the sign. Two heads. One of them grins.",
                  "And then Maria, down in the city. Tell her the stairs are clear. Tell her I am still here."],
          done=["You are back. Is she coming? Do not tell me she cried. All right. Tell me she cried, but do it "
                "slowly.",
                "Tonight, then. I will stand here until the lamps go on. I am very good at waiting. I have had all "
                "day to practise.",
                "Here. I bought a lunch for her and a lunch for me. Take mine. I am too busy being right to eat."]),

    # ------------------------------------------------------------ 2. the chain, part two: a lunch at the wrong tower
    quest("e1_maria_lunch", "A Lunch at Gale Tower", 46, CITY,
          text="Maria is going up to Elle tonight and left her lunch box at Gale Tower this morning. Tell Elle the "
               "plan, then fetch the box before Maria remembers it.",
          goal=[talk(46, ZEPHYR, ["Maria is coming up? Tonight? You told her the lamps will be on. I will light them "
                                  "early. I will light them at lunchtime if I can find the switch.",
                                  "One thing. She left her lunch box on the step of the old tower this morning. If "
                                  "she remembers it on the way up, she will turn around and go home for it.",
                                  "Would you fetch it first? It is on the tall tower, on the step, with a ribbon on "
                                  "the lid. She ties a ribbon on everything she is afraid of losing."],
                     label="Tell Elle about tonight"),
                go(GALE, "Find Maria's lunch box at Gale Tower")],
          pay=pay(250), ordered=True, after="e1_elle_stairs", lvl=8, seen=[CITY], short="The Lunch",
          offer=["It is me again. I am still here. I have been thinking about tonight and now I cannot stop.",
                 "I am going up when the lamps come on. That is decided. My legs are less decided, but they will "
                 "have to come with me.",
                 "Would you tell Elle? Not now. Before tonight. Tell her I am coming and she does not have to wait on "
                 "the stairs for me like I am a parcel.",
                 "And I left my lunch at the old tower this morning. If I remember it halfway up, I will turn "
                 "around. I know myself. So would you get it first?"],
          ask="Take the message?", options=("I will go", "Not now"),
          remind=["Elle is at the windmill tower. Tell her about the lamps. She likes a plan.",
                  "And my lunch box is on the step of the old tower, the tall one. It has a ribbon on the lid so "
                  "nobody takes it. Nobody has taken it."],
          done=["You found the box. With the ribbon on it. I thought the birds would have it by now. I think about "
                "birds more than I should.",
                "And you spoke to Elle. She is lighting the lamps early. She has never lit anything early in her "
                "life.",
                "Tonight, then. I will walk up and I will not cry. I have practised in the mirror. There are no "
                "mirrors in this city, but I practised."],
          verdict={"ask": "What do you tell Maria about Elle?",
                   "options": ["She is proud of you", "She is just as scared"],
                   "pay": [pay(0, ("Ribbon", 1)), pay(300)],
                   "after": [["She is proud of me? She said that? Do not tell me the words. I will cry and I have "
                              "practised not crying.",
                              "Here. My spare ribbon. I have two and I only need one for tonight. This one is lucky. "
                              "I have decided it is lucky."],
                             ["She is scared too? Elle? Elle once shouted at a Kuwagamon and it went home.",
                              "Then I will go up first and she can come after me. That is what friends are for. Here. "
                              "Take this. I have been saving it for something important, and this is important."]]}),

    # ------------------------------------------------------------ 3. a lunch at the inn door
    quest("e1_laura_lunch", "The Lunch Box", 46, INN,
          text="Laura leaves a lunch at the inn door for Veemon every morning. A Goburimon took it today. Get the box "
               "back from the two Goburimon in the Protocol Forest.",
          goal=[kill("Goburimon", 2, [PROTOCOL]),
                talk(178, PROTOCOL, ["You got it back! I watched from behind a tree. You are very loud. The "
                                     "Goburimon thought so too.",
                                     "One of them dropped this when it ran. A card. I was going to keep it, because "
                                     "it has Veemon on it and I like Veemon, and then I saw the sandwiches.",
                                     "Tell the girl at the inn to give it to him herself. That is what I would do. I "
                                     "am very good at telling people what to do."],
                     label="Talk to Kail about the card")],
          pay=pay(250), ordered=True, lvl=7, seen=[INN], short="Lunch Box",
          offer=["Hi! Hello! You are a tamer, I can tell by the way you stand. I am Laura. I have a question and it "
                 "is not about taming.",
                 "Every morning I make a lunch and leave it at the inn door for Veemon. He never says thank you and I "
                 "have never said hello, so it is fair.",
                 "Today a Goburimon took the box. There are two of them in the Protocol Forest, everyone knows. "
                 "Would you get it back? A girl with pink hair watches them all day, she will tell you if they drop "
                 "anything.",
                 "There is a card in the box. I put it in with the food. Do not tell anyone that part."],
          ask="Find the lunch?", options=("I will find it", "Not now"),
          remind=["Two Goburimon in the Protocol Forest. The box is red. They will not give it back politely, they "
                  "are Goburimon.",
                  "The card is in the middle, under the sandwiches. I am trusting you with that."],
          done=["You got it. Is the card still there? It is. Oh no. Now I have to actually give it to him.",
                "I have been leaving lunches at that door for two weeks. That is not a friendship, that is a "
                "service. And now I have a card with his face on it and no words."],
          verdict={"ask": "What should Laura do with the card?",
                   "options": ["Give it to him herself", "Let me give it to him"],
                   "pay": [pay(0, ("Antidote Disk", 1)), pay(0, ("Booster 05a", 1))],
                   "after": [["You are right. I will do it. I will walk up and say, hello, I am Laura, I make the "
                              "lunches, and then I will probably run away.",
                              "Here. For the trouble. And if you see him first, do not tell him. I want to see his "
                              "face when he works it out."],
                             ["You will give it to him? Then tell him it is from Laura. Say the name. He might know "
                              "it.",
                              "Here, take the whole pack. There is a Veemon card in it and some others. I buy them "
                              "for the card and I do not even play."]]}),

    # ------------------------------------------------------------ 4. one night, one table, two stickers
    quest("e1_cary_offering", "Bakemon Appreciation Night", 45, INN_BF,
          text="Cary has one night in the inn basement to meet Bakemon and needs a card game and a witness. Win one "
               "duel for the key, then sit with him when something comes down the stairs.",
          goal=[duel(1),
                fight(53, [INN_BF], "Sit with Cary when it comes down the stairs", scale=12)],
          pay=pay(250), ordered=True, lvl=7, seen=[INN_BF], short="Bakemon Night",
          offer=["Tonight. This basement. One table, two stickers, one candle, and whatever comes down those stairs at "
                 "midnight.",
                 "I have been calling it for a week. Hum twice, tap the pipe three times. It is in the magazine. It "
                 "answers. It taps back. Nobody has ever tapped back before.",
                 "The clerk says the basement is full of ghosts and she will not give me the key. She also says nobody "
                 "has beaten her at cards in nine years. Two problems, one table.",
                 "Win one game tonight and she will hand it over out of spite. She cheats. Win anyway. Then come down "
                 "here and sit with me. I will scream, and I am telling you now so it does not surprise you."],
          ask="Sit the night out with him?", options=("I am in", "Not now"),
          remind=["The clerk at the desk. One game of cards. The key is in her apron and her deck is mostly a lie.",
                  "Then midnight, down here. It taps three times before it comes. Do not tap back. That is my job."],
          done=["It came down. It came down and it sat at the table and it hummed at me. Look at it. It is wet. It has "
                "been in the water.",
                "It is a Gekomon. Not Bakemon. Not a ghost either, so I was half right, and half right is the best I "
                "have ever been.",
                "It has been answering me all week. Every night, every tap. Nobody has answered me for a week in my "
                "whole life."],
          verdict={"ask": "So what do you do with it?",
                   "options": ["Keep it. It chose you.", "Take it back to the marsh."],
                   "pay": [pay(0, ("Cat Glove", 1)), pay(0, ("Tin Mail", 1))],
                   "after": [["Then it stays. It can sleep by the boiler and I will learn what it eats, and it can tap "
                              "the pipe whenever it likes.",
                              "I wanted a Bakemon because a Bakemon is not a ghost. What I got is a friend who taps "
                              "pipes. That is better, and I am not saying it twice.",
                              "Here. I bought this glove to be a Bakemon's hand. It does not fit me. It fits you. Take "
                              "it before I change my mind."],
                             ["Back to the marsh. Yes. It came up with the water, so it should go home with the water.",
                              "I will walk it to the ditch behind the inn. Slowly. I am not brave. I am only not "
                              "scared of this one.",
                              "Here. I made this out of tin for a costume. It is too small for me and too big for a "
                              "Gekomon, and it is yours."]]}),

    # ------------------------------------------------------------ 5. the rival company wants to know why
    quest("e1_olivia_survey", "Cookiemon Online", 54, TOWER,
          text="Ms. Olivia wants to know why Digimon Online is fun so she can build a better game. Ask Sasaki, visit "
               "the Forest Inn, Duel Island and the Wind Prairie, and win one card duel.",
          goal=[talk(53, TOWER, ["Careful. She is in a mood. Not the bad mood. The good one. It is worse.",
                                 "You want the honest answer? Players come for the cards and they stay because "
                                 "somebody is sitting next to them. Do not tell her the second part, it does not fit "
                                 "a plan.",
                                 "Actually, tell her. She has not spoken to anyone but me in six days and I am "
                                 "running out of things to say."],
                     label="Ask Sasaki what players really want"),
                tour([INN, DUEL_ISLE, PRAIRIE], 3, "Visit the inn, the island and the prairie"),
                duel(1)],
          pay=pay(300), ordered=True, lvl=10, seen=[TOWER], short="Cookiemon",
          offer=["You there. Small tamer. Do you have a minute? I am Olivia. I run a company. It is a rival company, "
                 "we are losing, and I have stopped minding.",
                 "Everyone says this game is fun. Nobody can tell me why. The inn is a room with a cat in it. Duel "
                 "Island is a rock with fish on it. And yet.",
                 "Be my research. Visit the inn, the island and the windy field. Ask Sasaki as well, he is my "
                 "employee, he is honest when I am not listening.",
                 "And win one card duel. I need to know if the cards are the reason. I suspect the cards are the "
                 "reason."],
          ask="Do the research?", options=("I will go", "Not now"),
          remind=["Three places. The Forest Inn, Duel Island, the Wind Prairie. Sasaki is the man in the grey jacket "
                  "pretending to work.",
                  "And a duel. Do not lose on purpose. I will know."],
          done=["You are back. Report. No, do not sit, this is a tower, there is nowhere to sit.",
                "The inn. The island. The field. The cards. And Sasaki says the inn, which is the answer I did not "
                "want."],
          verdict={"ask": "Why is Digimon Online fun?",
                   "options": ["The cards and the fights", "The people you sit next to"],
                   "pay": [pay(0, ("Power Charge", 1)), pay(0, ("Boost Chip", 1))],
                   "after": [["Cards. A deck is a plan you hold in your hand that nobody can take from you. I can put "
                              "that in a slide.",
                              "Cookie cards. No. That is a terrible name and I have already written it down.",
                              "Here. Overtime pay. Sasaki will file it as research."],
                             ["The people. You sit next to someone at an inn and by the morning you know what they "
                              "are afraid of. That is not a feature. That is not even a good slide.",
                              "I have been in this tower a week and I have talked to Sasaki more than to my own team "
                              "in the real world.",
                              "Here. A chip from our lab. It boosts something. Probably charisma. Take it before I "
                              "keep it."]]}),
]
