"""The Lost and Found: the inn's box of other people's things.

Tailmon (npc 20) keeps a box under the counter of the Asuka Inn 1F (s235, at 188,154 -- a real record with no
spawn_flags: she is always there) for what guests leave behind. Three things come out of it: a travel pass, a carved
charm with no cord, and a ferry ticket with no name. Each one belongs to a real person standing on a real map -- the
Traveler in Asuka City (s200, 555,474), the Old Man in Asuka City (s200, 1088,288) and the Girl in Zhu Que City (s501,
432,249), with the Old Woman who carved the charm in Central Park (s330, 1065,997) as the other claimant -- and each
job ends at the counter with a two-way choice about who keeps it. The last hand-in leaves the box itself in the inn
(web/extra_fx/crate.json at 188,200, one tile below the counter, on ground the player's own foot box stands on).

Plain words: Tailmon is a counter giver (the dsl's STAY set), so her offers and hand-ins are lines, not walking scenes.
The three owners are story-gated (spawn_flags on every positioned record), so each talk step waits on unlock.met. No new
character, no new art, no story flag, no runtime change: with F2 -> Extras -> Quests off, none of it exists.

Try it: python3 tools/build_quests.py --with-drafts; web/quest-lab.html -> "The Pass in the Box" -> Go -> Goals.
"""
from dsl import *

INN = "s235"         # Central Sector - Asuka Inn 1F: Tailmon behind the counter at 188,154
ASUKA = "s200"       # Central Sector - Asuka City: the Traveler at 555,474, the Old Man at 1088,288
PARK = "s330"        # Central Sector - Central Park: the Old Woman at 1065,997
CITY = "s501"        # South Sector - Zhu Que City: the Girl at 432,249

# ---------------------------------------------------------------- the travel pass
PASS_OFFER = [
    "Inn business first. Under this counter there is a box. Guest things. They leave them, they do not come back, and "
    "I am not a lost property office.",
    "A travel pass came up today. Stamped, current, good for the roads east. The name on it is not mine and I am not "
    "walking to the gate with it.",
    "A traveler drinks at the corner in Asuka City. Brown vest, dry mouth, thinks he invented being mysterious. The "
    "pass has his face on the stamp. Go and ask him what he wants done with it.",
    "Ask him properly. If he wants it, fine. If he wants it to sit in my box until he remembers he has it, also fine. "
    "Will you go?",
]
PASS_REMIND = [
    "The traveler. Asuka City, the corner where the idlers drink, the one who looks like his own luggage. Ask him "
    "about the pass.",
    "I am not posting it and I am not guessing. He is alive and he is in that city. Go and talk to him.",
]
PASS_DONE = [
    "So. Eleven years of promise in one little card, and he gave you a speech about boots. That is a man who has "
    "not decided anything since he was twenty.",
    "Here is the choice, and it is yours because I have a queue. Do I put the pass in his hand the next time he "
    "comes through my door, or do I keep it under the counter until he asks?",
]
# What the Traveler says (a walking scene: he comes over and talks as he walks).
PASS_LINES = [
    "That face. You came from the inn. Tailmon found my pass, did she? She has a box with no bottom and she still "
    "finds things in it.",
    "I thought it went into the water off the Asuka Bridge. I looked for it three days. That is how I lost the boots.",
    "Keep walking, I talk better walking. A travel pass is a promise that you will go somewhere. Mine has been a "
    "promise for eleven years. That is a long time to keep one.",
    "Tell her this, and tell her plainly. If I take it back, I have to use it. If she keeps it in the box, I can "
    "visit it. That is not a joke. It is the best offer I have had all year.",
]

# ---------------------------------------------------------------- the charm with no cord
CHARM_OFFER = [
    "Second thing. Do not look at me like that. There is a queue of things in this box and I am working through it.",
    "A charm. Carved bone, a little fox on one side and a road on the other. It came to me loose, in a teacup, and "
    "the teacup is not for sale.",
    "It has no cord. A charm is not a charm until it hangs off something. Bring me a ribbon from the shop in Asuka. "
    "Any colour. I am not paying for it.",
    "And ask the old man in Asuka City about the charm. He tells legends there and he never once mentions this, "
    "which is how I know it was his. Will you?",
]
CHARM_REMIND = [
    "The old man in Asuka City. The charm first, then the ribbon, then the two of us decide.",
    "A ribbon from the shop. Any colour. Do not bring me string. I have string.",
]
CHARM_DONE = [
    "A fox on one side and a road on the other. He talked for an hour and gave you the whole story for free. That is "
    "how I know it hurt.",
    "So he sold it, and she carved it, and it has been in my box for a season, listening to guests complain about "
    "the weather.",
    "One of them gets it. The man who sold his promise or the woman who made it. Say the name and I will string it "
    "tonight.",
]
CHARM_LINES = [
    "A carved charm? A fox on one side, a road on the other? Sit. No, walk with me. My knees are better walking.",
    "That was mine. Sixty years ago I was going to be a great traveler. I bought the charm and a coat and a map. "
    "Then I sold the charm for a meal. The coat went the same way.",
    "Do not tell me you found it in an inn. I know that inn. The cat who runs it has a box with no bottom, and I "
    "have lost a hat to it.",
    "I do not want it back. That is the honest answer. A young man's charm on an old man's neck is a joke with one "
    "listener. But I know who might want it. An old woman in Central Park. She carved it. She will remember the "
    "road on it, and she will remember the road I did not take.",
]

# ---------------------------------------------------------------- the ticket with no name
TICKET_OFFER = [
    "Last one, and then I am closing the box for the season. A ticket. No name on it.",
    "Ferry ticket, one way. The stamp is old. There is one word on the back and it is not a name. It is a seven "
    "with a long loop.",
    "A girl in Zhu Que City collects paper and knows every hand in three sectors. She is loud, she is honest, and "
    "she will tell you whose seven that is.",
    "Then come back and tell me what to do with it. I could post it. I could keep it. I am not deciding for a family "
    "I have never met. Will you go?",
]
TICKET_REMIND = [
    "Zhu Que City. The girl with the paper collection. She will not be hard to find. She is always being loud.",
    "The ticket stays in the box until you come back. I am not posting anything on a guess.",
]
TICKET_DONE = [
    "Her sister. Hm. I have had that girl at my counter twice and she never once mentioned a sister.",
    "So the ticket is a lie nobody used, or a truth nobody said. Either way it is not mine to post.",
    "Here is what I think, and then you decide. A letter to the sister can carry it. Or it stays in the box and the "
    "girl can come and ask for it when she is ready.",
]
TICKET_LINES = [
    "A ticket! You have a ticket and you are not going anywhere? Give it here. I collect paper. I have a whole box "
    "of paper and one drawer for the really good paper.",
    "No name. Just a number and a ferry stamp. And this handwriting. Look at the loop on the seven. I know that "
    "seven.",
    "That is my sister's writing. She went east two years ago. She writes me one postcard a year and she always "
    "writes the seven like that.",
    "Wait. This ticket is older than that. It is a ticket she bought to leave and never used. She told me she went. "
    "She told me she stood on the ferry and watched the water.",
    "If it was never used, then she never left the way she said. I do not know what to do with a thing like that. Do "
    "not tell me what to do with it. I will cry, and then I will keep it, and then I will be late for dinner.",
]

QUESTS = [
    quest("lf_pass", "The Pass in the Box", 20, INN,
          text="Tailmon has a travel pass in the box under her counter. The traveler it belongs to is in Asuka City. "
               "Ask him what he wants done with it, then decide whether he gets it back or it stays in the box.",
          goal=talk(47, ASUKA, PASS_LINES, label="Ask the Traveler about the pass"),
          pay=pay(100),
          offer=PASS_OFFER, remind=PASS_REMIND, done=PASS_DONE,
          ask="Find the traveler for her?", options=("I will go", "Not now"),
          short="The Pass", lvl=4,
          verdict={"ask": "What happens to the travel pass?",
                   "options": ["Give it to him", "Leave it in the box"],
                   "pay": [pay(150, ("Runner Shoes", 1)), pay(300, ("Life Disk", 1))],
                   "after": [["Then he takes it. I will put it in his hand myself and I will not say one word about "
                              "the eleven years.",
                              "He will say something dry and pretend he is not pleased. I have known him eight "
                              "years. He is pleased.",
                              "Here. He left these behind in the spring, which is the closest that man comes to "
                              "giving a present. They are your size, more or less."],
                             ["In the box it stays. It is a good box. It has a lid, and everything in it is "
                              "somebody's.",
                              "When he asks, he can have it. Not before. A promise you do not have to keep yet is "
                              "the kind I understand.",
                              "Take the bits from the till and do not tell the guests. The box pays for itself, "
                              "eventually."]]}),

    quest("lf_charm", "The Charm in the Box", 20, INN,
          text="A carved charm in Tailmon's box has no cord and an owner who sold it long ago. Bring a ribbon for it, "
               "hear the old man's story, then choose who keeps it.",
          goal=[talk(57, ASUKA, CHARM_LINES, label="Ask the Old Man about the charm"),
                bring("Ribbon", 1, label="Bring a ribbon for the charm")],
          pay=pay(100),
          offer=CHARM_OFFER, remind=CHARM_REMIND, done=CHARM_DONE,
          ask="Run the errand for her?", options=("I will go", "Not now"),
          short="The Charm", lvl=8, after="lf_pass",
          verdict={"ask": "Who gets the charm?",
                   "options": ["Give it back to him", "Give it to her"],
                   "pay": [pay(250, ("Charisma Ring", 1)), pay(150, ("Wisdom Ring", 1))],
                   "after": [["Then I will string it on the ribbon and send it to him with the morning bread. He "
                              "will say he did not want it. He will wear it.",
                              "The old woman will hear about it. She hears about everything. If she comes to "
                              "complain, I will make her tea and agree with her.",
                              "Take this. A ring with a face on it that makes people think you are charming. It is a "
                              "liar of a ring. Wear it anyway."],
                             ["Good. He will say he does not want it and he will mean it. She carved it and she "
                              "never sold it. That is a different kind of owner.",
                              "I will wrap it in the ribbon and put it on the post to Central Park. She will scold "
                              "me for not doing it sooner. I will let her.",
                              "Take this. She gave me a whole bag of them years ago and I still have not found out "
                              "what they do. You will."]]}),

    quest("lf_ticket", "The Ticket With No Name", 20, INN,
          text="A ferry ticket in Tailmon's box has no name, only a seven with a long loop. A girl in Zhu Que City "
               "knows the hand. Then choose: post it to her sister, or keep it in the box.",
          goal=talk(46, CITY, TICKET_LINES, label="Show the Girl the ticket"),
          pay=pay(100),
          offer=TICKET_OFFER, remind=TICKET_REMIND, done=TICKET_DONE,
          ask="Take the ticket south?", options=("I will go", "Not now"),
          short="The Ticket", lvl=16, after="lf_charm",
          verdict={"ask": "What happens to the ticket?",
                   "options": ["Post it to her sister", "Keep it in the box"],
                   "pay": [pay(250, ("Booster 14a", 1)), pay(100, ("Booster 15a", 1))],
                   "after": [["Then I will write the envelope myself. My hand is terrible and the postman is "
                              "afraid of me, but it will get there.",
                              "I will put one line in it. Your sister found a ticket. That is all. The rest is "
                              "theirs.",
                              "The box goes out from under the counter. If people are going to leave things, they "
                              "can leave them where I can see them. Take this. The post is expensive."],
                             ["In the box, then. I will put it under the ledger, near the top, where a girl who "
                              "asks will find it.",
                              "She will ask. They always come back for the thing they did not take the first "
                              "time. It is the one thing an inn teaches you.",
                              "And the box stays out. It has a lid, it has a story, and now it has a job. Take this "
                              "from the till."]]},
          props=[prop(INN, "crate", (188, 200))]),
]
