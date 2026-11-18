"""Stage 6 and 7: Amaterasu after the Oinkmon week, and the test-round city (s920 to s931).

The week when the Digitize Wave turned every player on this server into an Oinkmon is the thing all four stories are
about, because the whole server is still talking about it. Nobody here is a pig any more, so each quest is about what
being one taught the people who were.

  am1_barbie_oink_mode   Fashion Barbie turns the pig week into a fashion line. Three people who wore a nose they could
                         not take off tell her what they think of one you can.
  am1_mickey_upstairs    Grandpa Mickey cannot bring himself up two flights to Grandpa Donald. Part one of the chain:
                         take something warm up and hear what Donald has been waiting to be asked.
  am1_donald_stairs      Part two, and the walk down: Donald goes to the bar, plays one bad game of cards, and Mickey
                         has to be told to come.
  am1_olivia_lobby       In the test-round city, Ms. Olivia hides from her office in one map and Manager Sasaki hides
                         from the same office in the next one, and each thinks the other is the danger.

Voices. These are the game's own named townspeople and they stand on generic npc ids, so characters.json only holds the
role voice (the same arrangement as pack_n1_north.py). Written here from what they say in their own town, read and
never copied:
  46  Girl          s246 Wedge's Shop        Fashion Barbie. Loud, delighted, everything is a moment.
  58  Old Woman     s201 Amaterasu City       Grandma Nancy. Warm scolding, feeds everyone, says the true thing last.
  45  Boy           s201 Amaterasu City       Liar Jim. Boasts, then the truth slips out and he covers it again.
  56  Kid           s256 Lamb Chop            Bacchus' Wife. Teasing about her husband, fond of him underneath.
  57  Old Man       s236 Amaterasu Inn 1F     Grandpa Mickey. Slow, jokes about his body, never says the thing first.
  57  Old Man       s241 Amaterasu Inn 2F     Grandpa Donald. Wry, counts things, would rather be asked than helped.
  54  Office Lady   s921 test-round city      Ms. Olivia. Office gossip, half out the door, pleased to be naughty.
  53  Office Worker s923 test-round lobby     Manager Sasaki. Tired, polite, would rather not be seen either.
No new characters or sprites were needed.
"""
from dsl import *

CITY, INN1, INN2, SHOP, BAR = "s201", "s236", "s241", "s246", "s256"
LOBBY, TESTCITY = "s923", "s921"

QUESTS = [

    # ------------------------------------------------------------ 1. the fashion line
    quest("am1_barbie_oink_mode", "Oink Mode", 46, SHOP,
          text="Fashion Barbie is turning the Oinkmon week into a fashion line and wants to know if people will wear it. "
               "Ask Grandma Nancy and Liar Jim in the city square and the wife of the man at the Lamb Chop, and bring her "
               "a ring for the nose.",
          goal=[talk(58, CITY, ["A pig nose. On my face. Again. Sit down, you look thin, have you eaten?",
                                "You know what it taught me, that week? That I did not mind the nose at all. I minded that I "
                                "could not tell Sid I loved him for seven days. He oinked at me and I oinked back and we "
                                "both knew, and that is not the same as saying it.",
                                "So tell her yes. Put a nose on me and put one on him too. But tell her the nose is not "
                                "the funny part. The not being able to talk is the funny part, and she should sell that."],
                     label="Ask Grandma Nancy about a pig nose"),
                talk(45, CITY, ["A snout? For fashion? I would wear it. I would wear two. Best week of my life, that week.",
                                "Nobody could see my face. Nobody could hear me lie. I oinked at my mother and she "
                                "oinked back and I did not have to explain one single thing.",
                                "That is not true. I could not eat. I could not say sorry to her for the thing I said "
                                "at dinner. I have still not said it.",
                                "Will I buy the nose? Ask me tomorrow and I will lie to you again. Ask her to make it "
                                "cheap, that way it is easier to take off."],
                     label="Ask Liar Jim about a pig nose"),
                talk(56, BAR, ["Snout and a curly tail. For sale. Hm.",
                                "My husband drank this whole bar dry, then the beam hit him and he was a pig, and he was "
                                "QUIET for one week. Best week of my life. I slept. I read. Nobody told me about the war.",
                                "Then he turned back and he talked for six hours and I was so happy I nearly cried, and "
                                "then he asked me to fetch him a drink.",
                                "So yes. Sell her the nose. If it keeps him quiet for one evening I will buy ten."],
                     label="Ask Bacchus' wife about a pig nose"),
                bring("Prayer Ring", 1, "Bring Barbie a ring for the nose")],
          pay=pay(300),
          offer=["You. Stand there. No, there. Perfect. Oh, you are perfect. Do not move.",
                 "Oink Mode. This is my moment. Snout, curly tail, pink to the knee. Last week every person on this "
                 "server was a pig, so now it is fashion, and I am going to be rich.",
                 "But I need to know if they will wear it. Ask three who actually were pigs. Grandma Nancy in the city "
                 "square. Liar Jim, who is also in the square and will lie. And the wife of that man who drinks at the "
                 "Lamb Chop.",
                 "And bring me a ring. A nose needs a ring. The pawn counter in this room sells them, the Gomamon in "
                 "the corner. Tell him it is for me and he will still charge you."],
          ask="Ask them for Barbie?", options=("I will ask", "Not now"),
          remind=["Well? What did Nancy say? Nancy always says something and it is never short.",
                  "And the ring. Do not forget the ring. A snout with no ring is just a nose."],
          done=["All three. Talk, talk, talk. Tell me everything, then tell me the one thing, because I have to decide "
                "tonight.",
                "Wedge has already ordered the pink cloth. He is very confident. Tell me he is right."],
          verdict={"ask": "So. Will they wear Oink Mode?",
                   "options": ["Run it. Pink for everyone.", "Ears only. No snout."],
                   "pay": [pay(600, ("Mirage Robe", 1)), pay(600, ("Wool Cap", 1))],
                   "after": [["Then it is settled. Pink for everyone. I am going to be rich and a little hated.",
                              "The nose comes off, though. That is the trick of it. Look. It comes off.",
                              "Here. The first one. Do not wear it in the rain, you will lose the nose and then you are "
                              "just a person in a pink coat."],
                             ["No snout. No snout at all. Hm. Hm hm hm.",
                              "The ears are fine, you said. Nancy said the nose is not the funny part. Jim said he "
                              "could not say sorry with it on.",
                              "All right. Ears only. It is not fashion, it is a hat. But it is a very good hat and "
                              "nobody has to apologise in it.",
                              "Here. The plain one. I made it for myself, and then I made a snout for it, and now I am "
                              "taking the snout off and giving it to you."]]},
          lvl=40, seen=[CITY], short="Oink Mode"),

    # ------------------------------------------------------------ 2. the chain, part one: two flights
    quest("am1_mickey_upstairs", "Two Flights Up", 57, INN1,
          text="Grandpa Mickey has not been up the two flights to Grandpa Donald since the week they were both pigs. "
               "Take Donald something warm from the shop, hear how he is, then tell Mickey what he said.",
          goal=[bring("Flame Ring", 1, "Buy Donald a warm ring from the shop"),
                talk(57, INN2, ["Sit. Not on the pillow, it is holding my back together.",
                                "A ring. Not a disk and not soup. A ring, and it is warm. Hm. Give it here.",
                                "My hands have been cold since the cure. Nobody tells you that. You come back from "
                                "being a pig and your hands are cold for a month.",
                                "So he sent you up. Nine days. I have counted. He has not counted, he is too busy telling "
                                "himself about the stairs.",
                                "Tell him this, and do not make it soft, he hates soft. I can come down. I have been "
                                "able to come down since the cure. I was waiting to be asked.",
                                "And tell him my seat at the bar is getting cold, and it is his fault, and he is paying."],
                     label="See Grandpa Donald on the second floor")],
          pay=pay(300), ordered=True,
          offer=["Sit down. No, sit down. You are making my neck hurt, standing there being young.",
                 "Donald is upstairs. Second floor, same inn. Forty years we have been friends and he has been nine "
                 "days up there.",
                 "We were pigs together last week. He was a very rude pig. He hummed at the wall and I heard it "
                 "through the floor, and I hummed back, and neither of us said a word about it after.",
                 "I have not gone up. Two flights. I could do it. I have been telling myself I could do it since "
                 "Tuesday. Would you take him something warm and look at him for me?",
                 "Not food. He will say he is not hungry and then he will be insulted. A Flame Ring from the pawn "
                 "counter in this room, the Gomamon. It is warm to hold, and he cannot complain about a ring."],
          ask="Take something up to Donald?", options=("I will go up", "Not now"),
          remind=["Have you been up? Is he eating? Do not tell me if he is eating better than me.",
                  "The ring first. A warm hand and then a warm word, in that order. He is funny about order."],
          done=["You have been up there a long time. Say the short version. I am old and I have a bad neck.",
                "He can come down. He can come down and he has been waiting to be asked. Ha."],
          verdict={"ask": "What do you tell Mickey?",
                   "options": ["He can come down. Come down.", "He says he is fine."],
                   "pay": [pay(500, ("Fairy Tale", 1)), pay(500, ("Prayer Ring", 1))],
                   "after": [["He can come down. He has been able to come down for a week and he was waiting to be "
                              "asked.",
                              "We are a pair of old fools and the stairs are not even steep. Right. Help me up. No, "
                              "not like that, I am not a sack of disks.",
                              "Here. The ferry story. I have carried this book up those stairs more times than I can "
                              "count. He can hear it at the bar like a person."],
                             ["Fine. He is fine. Good. Then that is that.",
                              "I will read to him through the floor tonight and he can shout at me about the ending. "
                              "He always shouts about the ending.",
                              "Here. It was for him. He does not read any more, his eyes went. You keep it, and when "
                              "you are old, do not wait to be asked."]]},
          lvl=40, seen=[CITY], short="Two Flights"),

    # ------------------------------------------------------------ 3. the chain, part two: the walk down
    quest("am1_donald_stairs", "The Way Down", 57, INN2,
          text="Grandpa Donald is going down to the Lamb Chop today and wants to know if the city square is safe for an "
               "old man. Play one game of cards with him, walk the way, then get Mickey to come down.",
          goal=[duel(1),
                tour([CITY, BAR], 2, "Walk from the inn through the city square to the Lamb Chop"),
                talk(57, INN1, ["Down? To the bar? Today? And he is telling me. Not asking. Telling.",
                                "Forty years he has been telling me things, and forty years I have been saying no and "
                                "then doing them anyway.",
                                "Tell him I will be at his table in an hour. Tell him the ferry story has a new ending. "
                                "That will hold him, he hates a new ending.",
                                "And tell him to order the milk. He always orders the expensive thing and then "
                                "complains about it for a week."],
                     label="Tell Mickey to come down")],
          pay=pay(400), ordered=True, after="am1_mickey_upstairs",
          offer=["You again. Good. Sit down, but not on the pillow, it is holding my back together.",
                 "I am going down today. To the Lamb Chop. I have been deciding since breakfast and I am nearly "
                 "decided.",
                 "The way goes through the city square, and young tamers run in that square, at things I cannot see. "
                 "Walk it for me. From this inn, through the square, to the bar, and tell me if a man with a stick can "
                 "stand in it.",
                 "Then tell Mickey to come down and meet me. And play one game of cards with me first. I have not held "
                 "a card since before your parents met, and I would like to lose quietly before I lose in front of him."],
          ask="Walk the way for Donald?", options=("I will walk it", "Not now"),
          remind=["The square. Watch how the young ones run, then tell me if I can stand in it.",
                  "And Mickey. Tell him today, not someday. Do not let him start on his knees."],
          done=["You walked it and you came back, so it is walkable. Good.",
                "And you let me lose. You let me lose slowly, one card at a time, like a gentleman. Thank you. I feel "
                "ready to be terrible in public."],
          verdict={"ask": "What do you tell Donald about Mickey?",
                   "options": ["He is coming down now.", "He says his knees are bad."],
                   "pay": [pay(700, ("Red Cap", 1)), pay(700, ("Sober Ring", 1))],
                   "after": [["He is coming. Today. For me.",
                              "Then I will wear the cap I bought for the walk. I bought it a week ago and I have been "
                              "keeping it in a drawer like a coward.",
                              "Here. You take it. I do not need a cap to sit with him. That is the whole point of him "
                              "coming down. My head can be cold and happy."],
                             ["His knees. Of course. His knees have been bad since the servers were young.",
                              "Then I will go up. Two flights. If he is going to lie to me about his knees, I want to "
                              "be in the room when he does it.",
                              "Here. A ring I bought to stop my hands shaking on the stairs. I do not need it now, I "
                              "am too angry to shake. Angry is better than shaking, and it walks faster."]]},
          lvl=40, seen=[CITY], short="The Way Down"),

    # ------------------------------------------------------------ 4. two people hiding from the same office
    quest("am1_olivia_lobby", "The Seminar", 54, TESTCITY,
          text="Ms. Olivia is hiding from her office in the test-round city. Check the lobby for anyone from work and "
               "beat the manager who plays cards there, then tell her what you found.",
          goal=[talk(53, LOBBY, ["You are looking at me. Nobody looks at a man who is working. Sit down, sit down.",
                                 "Manager Sasaki. I told my office I am at a seminar. The seminar is this lobby. The "
                                 "speaker is a card game.",
                                 "You want to know if anyone from my company is here? There is a woman from Planning who "
                                 "is supposed to be at a dentist. I saw her ten minutes ago. She looked very healthy "
                                 "for a dentist.",
                                 "I am not going to say anything to her and she is not going to say anything to me. We "
                                 "have an understanding and neither of us has said one word of it.",
                                 "Beat me at cards and I will tell you the rest. If I lose, I have to stop pretending to "
                                 "work, and then we can talk like people."],
                     label="Ask the manager in the lobby"),
                duel(1)],
          pay=pay(400), ordered=True,
          offer=["Do not look at me like that. I am not here. I am at a dentist. I have been at a dentist for four "
                 "hours.",
                 "I told the office I had a tooth. I told my team I had a meeting. I told the director I had a tooth "
                 "and a meeting and a train.",
                 "If one person from work walks through this city, I am finished. There is a whole lobby down there, "
                 "full of people in nice jackets. Would you look at it for me?",
                 "And there is a man who sits in that lobby and plays cards all day. He knows everybody. Beat him at "
                 "cards first. He only talks to people who beat him, and he only beats people who are in a hurry."],
          ask="Scout the lobby for Olivia?", options=("I will look", "Not now"),
          remind=["Well? Did you go down? Is the lobby full of people in ties?",
                  "If you saw the director, lie to me. Lie badly. I will believe a bad lie today, I am desperate."],
          done=["Sasaki. You talked to Sasaki. Sasaki is a manager. Sasaki is from my office. Sasaki is from my floor.",
                "Wait. He is hiding too? He told them he was at a seminar? Ha! Then nobody from upstairs is here and "
                "we are both safe and I am going to be so smug about this."],
          verdict={"ask": "What do you tell Olivia about Sasaki?",
                   "options": ["He saw you. He is hiding.", "The lobby was empty."],
                   "pay": [pay(900, ("Sniper Goggle", 1)), pay(900, ("Wisdom Ring", 1))],
                   "after": [["He saw me. He saw me an hour ago and he said nothing, and he is hiding from the same man.",
                              "Then I am going down there. We will sit at one table and be two very bad employees "
                              "together, and if the director walks in we will both be at a seminar.",
                              "Here. I bought these to spot the director across a room. I do not need to spot anybody "
                              "now. Somebody is on my side."],
                             ["Empty. Good. That is what I thought. That is what I hoped.",
                              "I will stay up here and wave at the lobby from the window, like a queen with a "
                              "toothache.",
                              "Here. A ring I bought to think better. It did not work, but it is very pretty and it "
                              "cost me a lot, and you have earned something expensive."]]},
          lvl=40, seen=["s920"], short="The Seminar"),
]
