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

- **F3** opens the log (the page's key hint lists it). The log is the game's own list widget; each quest's details open
  in the game's own conversation window.
- **The pause menu has a QUESTS row** after CARD FOLDERS (labelled `QUESTS` or `QUESTS 2`: the number is how many are
  ready to claim or new). It is the disc's own list: its seven-row panel (clip 0x19, the disc has the art for it), its font,
  cursor and fold animation. Choosing it closes the pause, runs the quest log, and reopens the pause on that row.
  Built in `engine/dw3/ui/native/pause-list.ts` and `pause-root-session.ts` behind an optional `extraRow` hook that the
  disc-faithful default never sets (the original-code oracle tests for the list still pass). The log itself is still the
  game's choice list and system window, not a page inside the pause with the party cards behind it.
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
- Speech is shown by the game's own translated conversation box (the same balloon, bitmap font, wipe and sounds as a
  real NPC). `web/dialogue-pack.js` writes a line in the disc's own text format (name tab, words, line and page
  breaks) and hands it to the box as a one-line pack. `tools/verify_dialogue_pack.mjs` re-encodes every plain-text line
  of the disc's `estalk00..09` files and checks the bytes are identical (2825 of 2825 readable lines). The quest's own
  words are new writing; only the format and the box are the game's.
- The yes/no question and the quest list use the game's `choice` widget, details use the game's system window.
- `tools/check_quests.py` checks that each named NPC has a real field position on the named maps.
- **Not done:** placing brand-new characters into maps. Characters the disc text has no code for (some punctuation,
  the player-name code) are dropped from quest text. The small "New quest" notice is still a page-level box styled like
  the game's windows, not drawn on the game canvas.

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

## Building the engine

The pause row needs a rebuilt `web/vendor/engine.js`. This checkout lacks five generated data files the engine imports, so
`tools/build_engine_local.sh` borrows them (and esbuild) from a research checkout (`GENERATED_ENGINE_DIR`, `ESBUILD`;
default `~/ddw3-walker`) and writes `web/vendor/` of THIS checkout only. Building the unmodified sources there reproduces the
shipped bundle byte for byte apart from path comments, so the tooling matches. `web/vendor` is git-ignored: a copy or ZIP of the
game needs the rebuilt `engine.js`, or the QUESTS row is simply absent (the list is then the disc's six rows).

## Tests


- `python3 tools/check_quests.py` - data against the game's tables (species, maps, items, NPC positions, unlock rules).
- Browser (needs Chrome with `--remote-debugging-port=9333` and the game on port 8770): `verify_quests.mjs`,
  `verify_quests_phase2.mjs`, `verify_quests_phase3.mjs`, `verify_quests_phase3b.mjs`,
  `verify_quests_realbattle.mjs`, `verify_quests_unlock.mjs`, `verify_quests_pause.mjs` (the pause row); `node tools/verify_dialogue_pack.mjs` (set `DIALOGUE_DIR` if `web/assets` is a symlink Windows cannot follow).

## Not verified / not built

- Rewards and difficulty have not been playtested by a person.
- Quest progress is per browser, not per memory-card slot (the card image has a fixed binary layout).
- The card-duel hook (`cardDuelEnded`) has not been exercised by a real duel.
- The real-key talk path was checked with Leomon (a fresh game). For Agumon and Takato in the late-game cities, a
  jump-in load has no story state, so the test calls the same hook the game calls instead of pressing keys there.
- Fishing contest and album collector are not possible yet (no fishing in the port; the only album is the card album).
- F3 is a keyboard key; there is no gamepad button for the log (the conversation box and lists do work with the pad).

## Co-op (removed)

Remote-play co-op (host streams the canvas over WebRTC, a guest sends keys) was built and tested between two tabs
of one browser, then removed on request. It remains in git history on this branch (commits f7a8a95 and earlier).
True 2-versus-2 was never built.
