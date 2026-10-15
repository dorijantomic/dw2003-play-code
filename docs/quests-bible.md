---
reach: The quest bible - why the extra quests look the way they do, what the world offers them, who gives them, and how to add more. Read this before writing or changing a quest.
status: written 2026-10-15 while building the large quest set. Complements docs/quests-plan.md (the engine side).
---

# Quest bible

`docs/quests-plan.md` says how the quest layer works. This file says **what to put in it and why**: the design rules, the
shape of the world the quests live in, who the givers are, and the recipes for each kind of quest. Everything here is about
*new* content layered on the shipped game. Nothing a character says in a quest is game text, and no quest writes a story
flag or the master story counter.

## 1. What makes a quest worth doing (research, 2026-10-15)

Sources read: [What Makes a Good Sidequest? (Inkwell Ideas)](https://inkwellideas.com/2023/09/what-makes-a-good-sidequest/),
[Good Side Quest Design: Rules and Examples (GameBanshee)](https://gamebanshee.com/k4wqq),
[Side quest syndrome (Game Informer)](https://gameinformer.com/b/features/archive/2017/02/09/side-quest-syndrome-designing-the-road-less-travelled),
[How to design side quests worth doing (Bugnet)](https://bugnet.io/blog/how-to-design-side-quests-worth-doing),
[Sidequest design (Critpoints)](https://critpoints.net/2015/07/04/sidequest-design/), and for the Digimon side the
[Digimon World 1 recruit guides (Almar's Guides)](https://almarsguides.com/retro/walkthroughs/ps1/games/digimonworld/fullplaythrough/recruitabledigimon/)
and the [PSX Data Center page for Digimon World 3](https://psxdatacenter.com/games/U/D/SLUS-01436.html). These are practitioner
articles, not studies; treat the rules as opinion that happens to agree with itself.

What they agree on, and what we do about it:

| Rule | What we do |
|---|---|
| A fetch quest can work if the **path** is interesting | Every errand goes through a place worth seeing; the text says *why that place* |
| Quest givers need a **bit of backstory**, not just a task | Each giver has a voice (`data/authored/quests/characters.json`) and a thread of their own across towns |
| **Variety**: combat, social, exploration, a twist | Eleven patterns (section 5); no region is all one kind |
| **Short** (about 15 minutes) and built from the **core mechanics** | Only fights, walking, talking, cards, items and forms: nothing needs a system the game lacks |
| **Value over volume**: forgettable quests train players to skip | Each quest has one distinct hook in its first line, and a reward that fits it |
| A side quest should **fit its area** and not outshine the story | Quests stay in the place they belong to and unlock when the player has actually been there |
| **Surprise**: shift expectations | Chains end differently than they start (a message turns out to matter; a rival turns into a helper) |

From Digimon itself (what the series and the two Digimon World games do that a generic quest does not):

- **Digimon are the reward and the question.** DW1 recruits a Digimon by feeding it the right item and then beating it; DW3
  unlocks forms through DNA agents who send you to find and beat a stronger one. Here the equivalent is *learning a form*:
  quests that say where a species roams, what it likes, and then ask you to take its shape (the `ownForm` objective).
- **Evolution is earned by living the world.** A quest should push the player to a place and a fight, not to a menu.
- **Bonds and partners.** Quests mention the partner. The player's partner is a character, not a stat sheet.
- **Cards** are a whole side game in DW3 (314 cards, duels at inns and shops): card quests belong to card people.
- **Towns have services** (inn, item shop, shops). Shopkeepers are people too: they get requests about their stock.
- **Trade and hidden things.** DW1 hides recruits behind trades and tools. Our version: bring-an-item quests, and quests that
  send you to a corner of a map you would not otherwise visit.

## 2. The world the quests live in

The game is a recreation of Digimon World 2003 (PS1): a networked world, "Digimon Online", split into sectors around the
central **Asuka City** hub. Four leaders guard four directions. Every place exists twice: the normal version and a
**post-game "Amaterasu" version** (the odd-numbered sibling stage, e.g. s330 Central Park and s331 Central Park) where the
enemies are far stronger and the characters differ. `web/map-variants.json` maps each variant to its canonical place and
the quest layer treats them as one place (a quest at s330 also works at s331).

Regenerate the full table any time with `python3 tools/survey_world_for_quests.py` (writes `docs/generated/quests-world.txt`;
git-ignored because it holds names and tables taken from the disc). Story order is the ladder in that file.

### Stages of the game, and how a quest says "not yet"

| Stage | Where | Wild levels | How a quest unlocks there |
|---|---|---|---|
| 1. Beginning | Asuka City, Central Park (s330), Wire Forest entrance (s335), Shell Beach (s340), Plug Cape (s345) | 1-13 | `visited` the place; `level` 1-8 |
| 2. East (Seiryu) | West/East Wire Forest, Forest Inn, Protocol Forest and Ruins, Divermon's Lake, Duel Island, Wind Prairie, Kicking Forest, Tyranno Valley, East Station, Seiryu / Qing Long City | 1-30 | `visited` + `level` 6-18 |
| 3. South (Suzaku) | South Station, Bulk / Bios / Tranquil Swamp, Swamp Inn, Shaman House, Jungle Grave, Phoenix Bay, Ether Jungle, South Cape, Suzaku / Zhu Que City, UG Lake, Jungle Shrine, Catacomb, Bug Maze | 8-40 | `flag: 16402` (Seiryu leader beaten) or `visited` + `level` 14-30 |
| 4. West (Byakko) | Badlands, Noise Desert, Pelche Oasis, Bullet Valley, Dum Dum Factory, Duct Rooms, Operation Room, Sewers, Secret Room, Mobius Desert, Mirage Tower / Hall / Room, Byakko / Bai Hu City | 20-47 | `flag: 16386` (Suzaku leader beaten) or `visited` + `level` 22-38 |
| 5. North (Genbu) | Boot / Snow / Freeze Mountain, Mountain Inn, Kulon Mine / Pit / Weapons, Lake of Ice, Legendary Gym, the five dungeons, Chamber Room, Battle Gate, Genbu City | 36-58 | `flag: 16414` (Byakko leader beaten) or `visited` + `level` 34-48 |
| 6. Beyond | Seabed, Circuit Board, Undersea Base, Spy Satellite, and every post-game (odd) version of the above | 40-99 | `visited` + `level` 40-70; the post-game variants only when the player has reached them |

Story flags that are safe to read (read only, never written): `16388` partner downloaded, `16402` Seiryu leader,
`16386` Suzaku leader, `16414` Byakko leader (from `chapter_progression.json`). Prefer `visited` + `level` for most quests: it
makes the log follow where the player has *actually been*, which is the exploration feel we want, and it needs no story state.

### Rules the data gives us

- A `defeat` objective may only name a species that **roams alone** on the named maps (the checker enforces it). The survey
  file lists them per place as `roam:`.
- A `challenge` objective names fight screens (ids in the survey). Screens 34-45 are single weak enemies; 188-334 are the
  encounter and boss pool; 1-33 are the leader and boss fights.
- Characters only stand in a place at some points of the story (their spawn flags). So every quest unlocks with `met`: the
  player must have **seen** the giver standing there. The "New quest" toast therefore appears when the player first meets the
  giver, never for someone who is not there yet.
- Generic townspeople share one npc_id across every town (45-58, 101-103, 178 ...). That is what makes a *thread* possible.

## 3. Who gives quests

`data/authored/quests/characters.json`, keyed by npc_id. It records what each sprite looks like (checked on a contact sheet),
the name tab shown in the conversation box, and a **voice**. Named Digimon and shopkeepers keep the names the game gives them
(Leomon, Takato, Agumon, Patamon, Renamon, Tailmon, Wizardmon, Gargomon, Gomamon, Smith, Wedge); every other townsperson is a role
described from the sprite ("Old Woman", "Yellow Coat"), because the disc names none of them.

**Threads** (also in that file) are the recurring characters who carry a storyline across towns: the Old Woman's rumours, the
Old Man's riddles, the Geek's data hunts, the Girl's card swaps, the Boy's dares, the Office Worker's errands, the Yellow Coat's
rivalry, the Black Hat's secrets. A quest from a thread names the *next* place, so following a character walks you through the
world. Write in the character's voice. If you cannot hear them, reread their line in the file.

## 4. What a quest can ask for (objectives) and show (scenes)

Objectives (see `docs/quests-plan.md` for the full list): `defeat`, `visit`, `visitSet`, `challenge`, `duelWin`, `talk`, `reach`,
`ownForm`, plus the two added with the big set: `bring` (hand over N of an item at the giver, who keeps them) and `level` (the
party's highest level reaches N). A quest may carry several, in order or not.

Scenes (`web/quest-scenes.js`): `walk`, `arrive`, `wait`, `face`, `put`, `look`, `say`, `ask`, `together`, `apart`, `sfx`.
They run on the game's own cutscene engine, so the walking is the story scenes' walking. The builder gives every quest whose
giver is a walking character a scene in which the giver walks to the player, speaks, walks with them where there is room, asks
the question, and both walk back. While the job is open the giver talks about the job (`remindLines`), never the ordinary chat.
A quest whose giver is a shopkeeper at a counter, or is not on the map, falls back to plain lines.

## 5. The patterns

Every quest is one of these shapes (the builder has a helper for each; `tools/build_quests.py`):

1. **Cull**: thin out a species where it roams. The text says *why they are a problem here*, never just "kill N".
2. **Hunt**: one stronger fight (`challenge` with a scale), a named opponent, a reason.
3. **Messenger chain**: carry words between 2-4 real characters in a town, ordered. Each stop has its own line and its own twist.
4. **Explorer**: visit a set of places out of a list ("see three of the five rooms"), remembering which.
5. **Form hunt**: learn the shape of a species (`ownForm`), usually after meeting it on the road. Teaches where things live.
6. **Card quest**: win duels; belongs to card people and card shops.
7. **Collector**: bring items; the giver tells you where such things turn up.
8. **Mentor**: reach a level, then come back; the giver is invested in your partner.
9. **Rival**: back-to-back fights with a recurring rival; each round raises the stakes.
10. **Rumour**: the Old Woman says something strange was seen somewhere; go and see (`visit`), then something small happens.
11. **Mystery arc**: three to five quests that share a cast and change who is where; the last one reframes the first.

## 6. Size and shape of the set

About 500 quests. Counts per stage are in the builder's report; the rough plan: stage 1 about 80, East 90, South 90, West 90,
North 80, Beyond 70. Hand-written arcs (11) carry the memorable beats; the rest are patterns with their own text, not
fill-in-the-blank templates. Rewards scale with stage (bits and items from that stage's shops and drops; rare equipment only
for hunts). No quest gives more than a stage's worth of money per hour of play.

Ids are `<region>_<slug>` and are **append-only**: never reuse or rename an id, because quest progress is stored by id.

## 7. How to add or change quests

- Sources live in `data/authored/quests/` (characters, and the packs per region); the builder `tools/build_quests.py` writes
  `web/quests.json`. Do not edit `web/quests.json` by hand.
- `python3 tools/check_quests.py` checks every quest against the game's own tables (species roam where claimed, maps, items,
  NPC positions, unlock rules, scenes). It must say OK.
- `node --test tests/quest-scenes.test.js` checks scenes compile.
- Try one in the browser: open `web/quest-lab.html`, press **Go** on the quest, press Enter at the giver. **Goals** meets the
  objectives to see the turn-in. The lab has a search box for the big list.

## 8. Not done / honest limits

- Only a sample of the set has been played in a browser; the rest is checked against the data, not by a person.
- Giver positions are real, but whether a character stands somewhere at a given story moment is unknown for most places: the
  `met` unlock covers it by waiting until the player has seen them.
- Balance (rewards, scale numbers) is a first guess.
- New characters now exist (npc_id 1000+, drawn by `tools/make_quest_sprites.py`; see `docs/quests-art-brief.md`), three so far.

## 9. Quality over quantity (decided 2026-10-15)

The first 190 quests were judged too thin: 180 had a single kind of step ("go here, talk to X, kill N"). Only 31 of them ship
(`data/authored/quests/shipped.txt`; the rest stay as drafts in the packs, unshipped). The new rule for what ships: **a small
story with a turn, more than one kind of step, and often a choice at the hand-in** (`verdict=` in the DSL: the answer picks
the reward and the closing lines). Lore to draw on: `docs/quests-lore.md`. The flagship set is `pack_f_flagship.py`.

Also decided: a character's ordinary words always come first. The first talk with anyone in a session is their normal
chat (it may be a hint the player needs); an offer or a reminder waits for the next talk. Handing in a finished job is
immediate.
