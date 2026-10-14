---
reach: Extra quests for the browser port - what exists, how they unlock, how characters hand them out, and what is not done.
status: built on experiment branch `experiment/quests-coop` (nothing here is original-game behaviour). Co-op was tried and removed.
---

# Extra quests

Written 2026-10-13, rewritten 2026-10-14. This is **new content layered on the shipped game**. It does not change
the story or the battle rules.

## Ground rules

- `docs/research/UNFINISHED-CONTENT-NOT-ADDED-TO-THE-ACTUAL-GAME.md` says the walker recreates the game that
  shipped and must not invent the missing half. So the quests live in their own module and their own store, and
  can be switched off in F2 -> Extras -> "Quests".
- **Never write the master story counter** (`[0x8004b370]`) or any story flag. Quest progress lives in its own
  `localStorage` key (`dw.quests.v1`), so a normal save and the story stay valid with the quests on or off.
- A quest never replaces a story scene: `questTalk` runs after the game's own story check, so if the story (or a
  scripted battle) takes a conversation, the quest layer is never asked.
- Say plainly what is unverified. Every part below ends with a test, not an assumption.

## What the player sees

- A **Quests** button on the screen (and **F3**) opens the log. A badge counts quests ready to claim and new ones
  not yet looked at.
- Quests are **not all available**. They unlock as you play (below) and a toast says "New quest: ...".
- Some are taken from a **notice board** (only while you stand in that place), some are **handed out by a real
  character** of the game, some are **generated** and scale with the party.

## Unlocking

A quest definition may carry `requires` (another quest done, or a decoded story-beat flag, read only) and
`unlock`:

| `unlock` field | meaning |
|---|---|
| `visited: [maps]` | you have been to any one of these places (night/story variants count as the same place) |
| `done: id` | another quest is finished |
| `flag: n` | a decoded story-beat flag is set (read only) |
| `duelWins: n` | you have won n card duels |
| `level: n` | the party's highest level |
| `partner: id` | that Digimon is your lead or in your party |
| `met: [{npc, map}]` | you have actually seen that character standing there |

`met` exists because many characters only appear at certain points of the story (their `spawn_flags` in the scene
files). A quest about such a character waits until you have met them, instead of promising something the
current story state cannot deliver.

## Characters (real NPCs)

- `offer` hands a quest out through an NPC (`npc` id from the scene files, `maps`, `lines`); the player answers
  "I will do it" / "Not now". `turnIn` (or the offer NPC) takes the finished quest back and pays.
- `talk` objectives are conversations with NPCs, optionally `ordered`.
- The dialogue box is the quest layer's own (not the game's balloon). While it is open it takes the keys ahead of
  the game (Enter / Space / Z advance, arrows choose, Esc = "not now"). Key-ups still reach the game.
- `tools/check_quests.py` checks that each named NPC has a real field position on the named maps.
- **Not done:** placing brand-new characters into maps, and using the game's own balloon / text font for quest
  speech. The quest speech is written for this layer; it is not shipped-game dialogue.

## Generated jobs ("Wanted board")

`generateBounty(visited, level, n, table)` (pure, seeded) builds one job at a time from the places you have been
and the party's level:

- species and place come from the game's own wild-encounter tables (single-enemy roaming fights);
- the count grows with the level, the BIT reward grows with count and level, and the item tier rises with level;
- every third job is an **elite hunt**: one real fight against that species with stats and HP scaled by level.
- Needs two visited hunting grounds. The next job appears on the next map change after you finish one.
- The balance numbers are first guesses, not playtested.

## Quests in the data (`web/quests.json`)

Park pest control, Wire Forest survey (Leomon), East / South Station bounties, the quiet route, two card ladders,
double trouble in Central Park, Seiryu's rematch (+ hard), three leaders in one afternoon, Circuit Board
cartographer, Before and after, Arena qualifiers, and "Guilmon cannot find his tamer".

"Guilmon cannot find his tamer" is a new quest (I found no such scene in the shipped dialogue; this is not
recalled game content). It needs Guilmon as lead or in the party and having met Takato (alt) in Qing Long City,
then Agumon at East Station and Takato in Qing Long City.

## Tests

- `python3 tools/check_quests.py` - data against the game's tables (species, maps, items, NPC positions, unlock rules).
- Browser (needs Chrome with `--remote-debugging-port=9333` and the game on port 8770): `verify_quests.mjs`,
  `verify_quests_phase2.mjs`, `verify_quests_phase3.mjs`, `verify_quests_phase3b.mjs`,
  `verify_quests_realbattle.mjs`, `verify_quests_unlock.mjs`.

## Not verified / not built

- Rewards and difficulty have not been playtested by a person.
- Quest progress is per browser, not per memory-card slot (the card image has a fixed binary layout).
- The card-duel hook (`cardDuelEnded`) has not been exercised by a real duel.
- The real-key talk path was checked with Leomon (a fresh game). For Agumon and Takato in the late-game cities, a
  jump-in load has no story state, so the test calls the same hook the game calls instead of pressing keys there.
- Fishing contest and album collector are not possible yet (no fishing in the port; the only album is the card album).
- No gamepad button for the Quests button; the dialogue takes keyboard and mouse.

## Co-op (removed)

Remote-play co-op (host streams the canvas over WebRTC, a guest sends keys) was built and tested between two tabs
of one browser, then removed on request. It remains in git history on this branch (commits f7a8a95 and earlier).
True 2-versus-2 was never built.
