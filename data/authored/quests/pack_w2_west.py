"""Stage 4, West (Byakko): four small human stories at the edge of the story.

The big West pack (pack_w_west.py) gives every townsperson an errand thread. These four take the people the
story itself leaves standing in the Byakko Dome and Byakko City: a boy who appointed himself the night watch,
the operator at the desk and the guardsman she cannot leave it for, the class president writing the city book,
and the rival who wants the credit for a plan he did not make.

Voices. Everyone who hands out a quest here is already in characters.json. Two people in these stories have no
entry there and never hand out a quest: the Numemon in the Underground Cave and Guardsman Max. Max is quoted in
narration, never given a talk step or a scene line, so nothing depends on a name tab. If they are ever wanted as
givers, the voices are: Numemon, slow, apologetic, sure it is in trouble and asking permission for everything;
Guardsman Max, formal and careful, says his rank, goes quiet when he is nervous.
"""
from dsl import *

CITY, DOME, CAVE = "s660", "s675", "s685"
TOWER, BADLAND = "s645", "s550"

QUESTS = [

    # ------------------------------------------------------------ the self-appointed night watch
    quest("w2_ryan_pots", "The Night Watch", 45, CITY,
          text="The Boy has made himself the night watch of Byakko City. Flower pots keep leaving the wall and he keeps falling asleep at the important part. Win his duel, then follow the little prints down into the cave.",
          goal=[duel(1), go(CAVE, "Follow the little prints into the cave")],
          pay=pay(400),
          lvl=24, seen=[CITY], ordered=True, short="Night watch",
          offer=["Hey! Hey. You. You are a real tamer, right? With a badge and everything. Good. I need a deputy.",
                 "I am the night watch of Byakko City. I made myself the night watch because nobody else would. Something keeps taking the flower pots off the wall. One every night.",
                 "I keep falling asleep at the important part. So: deputy. First we duel, because that is the rule, and I wrote the rule."],
          ask="Be my deputy?",
          options=("I will be deputy", "Not now"),
          remind=["The duel first. A deputy who has not duelled is just a person standing next to me.",
                  "Then the little prints. They go down. Down is the cave under the city. I am not going down there. The watch stays up. That is the whole point of a watch."],
          done=["All six! In a nest! You found the whole crime scene and the crime scene is a nest.",
                "Wait. Wait wait wait. That is a Numemon nest. Numemon. The one who got everybody out of that cave. That Numemon.",
                "I need to sit down. The watch is sitting down for a minute."],
          verdict={"ask": "What do you tell him?",
                   "options": ["It was the Numemon", "The wind took them"],
                   "pay": [pay(200, ("Kung Fu Cap", 1)), pay(150, ("Energy Disk", 2))],
                   "after": [["The hero of the cave is a pot thief. And he is sleeping better than he has in weeks, on six flower pots.",
                              "I am going to go and be quiet for a while and think about what a guard is actually for.",
                              "Here. That was my grandad's watch cap. A real guard gave it to me and now I am giving it to my deputy."],
                             ["The wind. Right. The wind took six flower pots off a wall and put them in a nest.",
                              "I am the night watch and I have decided the wind is not a suspect. The wind is my friend.",
                              "Take these. And thank you. For the wind."]]}),

    quest("w2_ryan_roster", "The Roster", 45, CITY,
          text="The Boy wants the Numemon written into the city book as the second night watch. The class president keeps the book and she is in the Byakko Dome. Ask her for the line, then win the duel she asks for first.",
          goal=[talk(48, DOME, ["You are the deputy. The Boy has told everyone. He told the flower seller, the inn, and one wall.",
                                "He wants the Numemon written into the city book as the second night watch. I keep the book, so it is my handwriting either way.",
                                "But I do not sign anything I have not tested. Duel me. If you can beat me, the watch is real enough for a page."],
                     label="Ask the class president for the line"),
                duel(1)],
          pay=pay(700, ("Power Chip", 1)),
          lvl=27, after="w2_ryan_pots", seen=[DOME], ordered=True, short="The Roster",
          offer=["Deputy! Big news. I have decided the Numemon should be the second night watch. Of the lower city. The lower city is the cave.",
                 "A roster is not a roster until the class president writes it in the city book. She is in the Dome. She remembers everything, so do not try to be interesting.",
                 "And she will want a duel out of you first. She always wants a duel. Do it for the watch."],
          ask="Go and get it written?",
          options=("For the watch", "Not now"),
          remind=["The Dome. The class president. The city book. And a duel, because she is like that.",
                  "If she says no, tell her the watch will be very disappointed. The watch is me. I will be very disappointed."],
          done=["She wrote it. Read it out. Slowly. I want to hear the whole sentence.",
                "Night watch: the Boy. Second night watch: the Numemon, of the lower city. That is the best sentence in the whole book.",
                "Here. The watch does not have a budget, so this is my pocket. Do not tell my mother."]),

    # ------------------------------------------------------------ the desk and the guardsman
    quest("w2_remy_afternoon", "The Long Afternoon", 54, CITY,
          text="The Office Lady has one free afternoon and has decided to spend it on somebody else. Take the operator's message down to the cave, then find out where the guardsman on watch went.",
          goal=[go(CAVE, "Take the message down to the cave"),
                talk(47, DOME, ["Max? Big shoulders, serious face, walks like the floor owes him money? He came back up about an hour ago.",
                                "He has been standing behind the seats talking to a wall. I heard a bit of it. He is practising asking someone to dinner at the oasis.",
                                "Do not tell him I told you. He will make me do drills, and I am a student, not a soldier."],
                     label="Ask the Traveler about the guardsman")],
          pay=pay(400),
          lvl=26, seen=[DOME], ordered=True, short="Long afternoon",
          offer=["Darling. Do not sit down. I have been sitting for a week and it has not helped me at all.",
                 "I have one free afternoon and I am spending it on somebody else, which is not like me, and I am enjoying it enormously.",
                 "The operator at the Dome has the same afternoon free. The guardsman she would like to spend it with is on watch at the cave and will not leave his post, and she cannot leave her desk to tell him.",
                 "I could carry the message. But everyone would see me carrying it, and by this evening it would be a wedding with a cake. So you carry it. Say: the afternoon is going."],
          ask="Carry the message?",
          options=("I will carry it", "Not now"),
          remind=["Down to the cave, darling. The message is four words. Do not improve them.",
                  "Then come back and tell me what he was doing up here. I have been dying to know for a week and I never die."],
          done=["So he swapped with the other guard. Of course he swapped. People in love make no sense and I love it.",
                "And the Traveler saw him practising at a wall? Darling, that is the best thing I have heard all week, and I hear everything.",
                "So. Do I go and tell her he is practising words, or do I let him get there himself and watch?"],
          verdict={"ask": "What do you tell her?",
                   "options": ["Tell her he is practising", "Let him get there"],
                   "pay": [pay(300, ("Angel Ring", 1)), pay(300, ("Revive Ring", 1))],
                   "after": [["I will tell her. She will go and stand next to him and be very, very surprised.",
                              "He once stood in front of a whole gang and did not blink. And now he cannot say a sentence at a wall.",
                              "Take this. It was my lucky ring and it has brought me exactly no luck, so it is your turn."],
                             ["You are right. Let him do it badly and on his own. That is the only way it counts.",
                              "I will say nothing. I will sit here and say nothing, which for me is a form of exercise.",
                              "Take this. It is the ring I keep for the ones who come back late, and you came back."]]}),

    # ------------------------------------------------------------ the rival and the notes
    quest("w2_keith_plan", "Somebody's Plan", 102, DOME,
          text="The Yellow Coat says the whole Byakko campaign was his plan. He left two notes of it in the field. Fetch them from the tower stairs and the South Badland, hear the class president out, and duel him for the record.",
          goal=[talk(48, DOME, ["You were out in the field with the Yellow Coat. Good. I am writing the city book and I need one line from somebody who was actually there.",
                                "Everybody else has given me a line and every line is about themselves. His is the longest and it has the word I in it nine times.",
                                "Get his notes. If they are his, I will write his line and that is that. If they are not his, I still need a line, and I would rather have yours."],
                     label="Hear what the class president needs"),
                tour([TOWER, BADLAND], 2, "Fetch the two plan notes"),
                duel(1)],
          pay=pay(1400),
          lvl=34, flag=16414, seen=[DOME], ordered=True, short="Two notes",
          offer=["Kid! There you are. Look at this sector. Finished. You know how? Her plan and my skills. Mostly my skills.",
                 "I left two notes of that plan out in the field. One on the Mirage Tower stairs, one in the South Badland where I drew the guards off.",
                 "Fetch them for the record. Then duel me, so the record also shows I was still sharp after all that thinking."],
          ask="Fetch his notes?",
          options=("I will fetch them", "Not now"),
          remind=["The tower stairs and the South Badland. Two notes. They are not hidden. I am not a hider, I am a planner.",
                  "Then the duel. I have been stretching. Well. I have been thinking about stretching."],
          done=["Both notes. Good. Read the second one out loud, the one from the Badland.",
                "Wait. That is not my handwriting. That is her handwriting. And on the back it says, keep him busy, he will want to help.",
                "The class president is standing right there with the book and a pen. She wants one line. Which line do I give her?"],
          verdict={"ask": "Which line do you give her?",
                   "options": ["His plan, his skills", "Her plan, his legs"],
                   "pay": [pay(250, ("Iron Glove", 1)), pay(250, ("Prayer Ring", 1))],
                   "after": [["His plan, his skills. Ha! In the book. In ink.",
                              "You know it was her plan. I know it was her plan. The book will not know, and the book is what people read.",
                              "Here. I wore this the day this sector was won. It is worth nothing at all. Keep it anyway."],
                             ["Her plan and my legs. Hm.",
                              "That is fair. That is the most fair sentence anybody has written about me, and it took a kid to say it.",
                              "Take this. I have been carrying it for luck and I have had no luck, so it is your turn."]]}),
]

# The last one is handed in to the Yellow Coat with the class president standing beside him, so the city book
# and the choice at the end happen on screen instead of in the text. Without her on the map the plain done
# lines say the same thing, so the quest never depends on the scene running.
_KEITH_DONE = [
    {"say": 102, "name": "Yellow Coat", "text": "Both notes. Good. Read the second one out loud, the one from the Badland."},
    {"say": 102, "name": "Yellow Coat", "text": "Wait. That is not my handwriting."},
    {"say": 102, "name": "Yellow Coat", "text": "That is her handwriting. And on the back it says, keep him busy, he will want to help. She wrote that about me."},
    {"walk": 48, "to": {"near": "player", "gap": 54}},
    {"arrive": 48},
    {"say": 48, "name": "Schoolgirl", "text": "I am writing the city book. One line about how this sector was won, and everybody has given me a line, and every line is about themselves."},
    {"say": 48, "name": "Schoolgirl", "text": "You were out there. So. Which line do I write?"},
]
for _q in QUESTS:
    if _q["id"] == "w2_keith_plan":
        _q["doneScene"] = _KEITH_DONE
