---
reach: Planning optional new quests and co-op for the browser port; what the engine already supports and what it does not.
status: plan (experiment branch `experiment/quests-coop`; nothing here is original-game behaviour)
---

# New quests and co-op: plan

Written 2026-10-13. This is an **optional, experimental layer**. It does not change the shipped game's
story or battle rules, and every part of it is off by default.

## Ground rules

- `docs/research/UNFINISHED-CONTENT-NOT-ADDED-TO-THE-ACTUAL-GAME.md` says the walker recreates the game
  that shipped and must not invent the missing half. So all of this lives in its own module and its own
  flag bank, behind F2 switches, and is never required to finish the story.
- **Never write the master story counter** (`[0x8004b370]`). Quests use a separate store, so a normal
  save, and the story, stay valid with the layer on or off.
- Anything keyed to a stage id or to the picture on screen survives story changes. Asuka and Amaterasu
  are parallel stage ids; a quest that names the pair works in both.
- Say plainly what is unverified. Each phase ends with a test, not an assumption.

## What the engine gives us (checked)

- **Story:** one linear counter. Chapters are gated by banked flags (`chapter_progression.json`,
  `story_steps.json`). Post-game: four Amaterasu leaders, five epic weapons, the World Champion.
- **Side systems:** card duels (`cardduel*.js`, card shop data), fishing, the Arena, Circuit Board maps,
  shops that differ per world, the Digimon album.
- **Battle:** one enemy object (`b.enemy`) against one active Digimon, plus a tag (partner swap) list.
  Multi-enemy parties exist in the data and are fought as a **gauntlet**, one after another
  (`battle.js` `gauntletNext`, `b.partyIndex`). The turn order is a two-actor timeline
  (`initialActorTimeline`). The 3D renderer already takes an enemy-slot array (`enemySlots`).
- **Enemies are data:** `enemies.json` (stats, resistances, a four-slot AI table with comparator and value).
- **Encounters:** `field_encounters.json`, `stage_encounters.json`, `forced_encounters.json`; ambush tiles
  share a latch (bank 0, bit 15).
- **Followers:** the party already trails the leader in the field.
- **Not verified yet:** whether battle simulation is deterministic given the same inputs; how hard the
  multi-actor battle change really is; how best to hand a second player control of a follower.

## Phases (work down this list; tick each when it is done AND tested)

### Phase 0 - this plan
- [x] Plan written and committed on `experiment/quests-coop`.

### Phase 1 - quest framework (works offline, one player)
- [ ] 1.1 Read the existing flag store, save path, reward dispatch, textbox/balloon and NPC placement code.
- [ ] 1.2 `quests.js`: data-driven quest definitions (`quests.json`), own state store (separate from the
      story flags), persisted in the same place saves live, with a version field.
- [ ] 1.3 Quest log screen (a key, plus a line in the F2 panel); toast on accept / progress / complete.
- [ ] 1.4 Hooks: battle won (enemy species, stage), item obtained, stage entered, card duel won.
- [ ] 1.5 Rewards through the game's own item/money routines; never duplicates on reload.
- [ ] 1.6 F2 switch "Extra quests" (off by default) and a test that proves the story state is untouched.

### Phase 2 - first three quests (each one small and testable)
- [ ] 2.1 **Bounty board** at the stations: defeat N named wild Digimon (counts from the stage encounter tables).
- [ ] 2.2 **Quiet route**: cross a map without stepping on the known ambush tiles; a miss triggers the ambush.
- [ ] 2.3 **Card ladder**: one duelist per town, rare cards as rewards (card shop data).
- [ ] 2.4 A quest giver NPC mechanism (placed from data, speaks with the game's own balloon).

### Phase 3 - more quests, once the framework is proven
- [ ] Arena qualifiers (the four stub rounds on each floor), fishing contest, Circuit Board cartographer,
      across-the-worlds errands, leader rematch gauntlet, album collector.

### Phase 4 - co-op, in order of effort
- [ ] 4.1 **Remote play**: the host's browser runs the game and streams its canvas; the second player sends
      button presses back. No determinism needed; works for turn-based play. Needs a way to connect the two
      browsers (copy-paste codes, no server). Unverified.
- [ ] 4.2 **Tag-team co-op**: each player owns some of the Digimon; control passes to the owner of the
      active one. Small change to turn handling.
- [ ] 4.3 **Harder fights**: enemy stats scaled by player count (a data change); boss phases that reuse
      existing moves and the AI table's comparators.
- [ ] 4.4 **Double ambush** as a two-member gauntlet (works today); a simultaneous one only after 4.5.
- [ ] 4.5 **True 2-versus-2** (multi-actor timeline, targeting, enemy target choice, camera framing).
      Large; only if 4.1 to 4.4 prove the idea is worth it.

## Risks

- `battle.js` is very large and the singular enemy is assumed in many places; 4.5 is the real cost.
- Quest state must survive the Asuka/Amaterasu switch and chapter changes.
- Anything that needs a second browser cannot be fully verified by one headless test; say so when it applies.
