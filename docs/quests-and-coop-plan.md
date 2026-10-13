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
- [x] 1.1 Read the flag store, save path, reward dispatch and battle/stage hooks. (NPC placement and the
      textbox/balloon are still unread: they belong to Phase 2.)
- [x] 1.2 `web/quests.js` + `web/quests.json`: data-driven definitions, its own state store
      (`localStorage` key `dw.quests.v1`, version field), never touching story flags.
      **Limitation:** the store is per browser, not per memory-card slot. The card image has a fixed binary
      layout, so quest data is not written into it. Per-slot quests need a look at how loading rewrites state.
- [x] 1.3 Quest log (F3), toasts on accept / ready / complete, a two-step "Reset quests" button.
- [~] 1.4 Hooks: **battle won** (real, tested through a real fight) and **stage entered** (tested) are done,
      via `web/gameEvents.js`. **Item obtained** and **card duel won** are not done yet; add them when a
      quest needs them (Phase 2.3 needs the card duel one).
- [x] 1.5 Rewards go through the game's own item store and money; the quest is marked done and saved
      before the reward is paid, so a reload cannot pay twice (tested).
- [x] 1.6 F2 switch "Extra quests (experimental)": off by default, and excluded from "All on" and the presets.
      Tested: no story or progress key changes (`tools/verify_quests.mjs`).
- Tests: `python3 tools/check_quests.py` (data against the game's tables), `tools/verify_quests.mjs`
  and `tools/verify_quests_realbattle.mjs` (browser).

### Phase 2 - first three quests (each one small and testable)
- [x] 2.1 **Bounty boards** at East Station and South Station: defeat N named wild Digimon on the nearby map.
      Species and maps are checked against the real encounter tables (`tools/check_quests.py`). A quest can
      only be accepted while standing at its board (`acceptAt`), and night/story variants count.
- [x] 2.2 **Quiet route** (changed from the plan): walk from the Wire Forest entrance's north-west gate to its
      south gate without a fight. A fight, or leaving the map, sends you back to the start. The ambush-tile
      version was dropped: ambush tiles are one-shot and share a single latch, so dodging them is not a
      repeatable skill. Tested with simulated fights AND a real battle start.
- [~] 2.3 **Card ladder** (changed from the plan): win 3, then 6, duels against any tamer. Per-opponent
      ladders need the field's NPC-to-opponent mapping, which I have not read. The quest logic is tested with
      simulated results; the one-line hook in `cardduel-native.js` (`cardDuelEnded`) parses but has **not** been
      exercised by a real duel, because the duel runs on the original's code inside an emulated screen.
- [~] 2.4 Quest giver NPC mechanism: **replaced by location-gated notice boards** (above). Placing new NPCs
      into maps is the riskiest part and was not needed to prove the framework. Do it in Phase 3 only for
      quests that truly need a character.

### Phase 3 - more quests, once the framework is proven
- [x] **Challenge fights** (new capability): the quest layer can launch a real fight from the log through the
      game's own hand-off (`startQuestBattle` in `game.js`, same guards as a random encounter), using real
      encounter screens, optionally stronger (`scale`, `hpMult`). Only a win completes it. A **loss returns to
      the field with the party restored** (it does not go to the title screen). Tested with real fights.
- [x] **Leader rematch gauntlet:** Seiryu's team (the game's real three-fighter gauntlet), a hard version
      (the game's own stat scales x22/16, HP x1.5, verified in the battle), and "Three leaders, one afternoon"
      (eight fights). Gated by the game's own decoded story-beat flags, **read only** (`requires.flag`).
- [x] **Double trouble in Central Park:** two real roaming fights back to back (this is the Phase 4.4
      "double ambush", done as a gauntlet).
- [x] **Arena qualifiers:** a new three-match gauntlet on the arena floor (the game's own tournament rounds
      are unfilled stubs; these are new, and say so).
- [x] **Circuit Board cartographer:** chart six different boards (new `visitSet` objective; it remembers which
      ones, counts a variant of a place once, and survives a reload).
- [x] **Before and after:** see the Main Lobby as Asuka City and again as Amaterasu City. Changed from the plan's
      "across the worlds": the story shows that Asuka becomes Amaterasu partway through, they are not two
      worlds you can travel between.
- [ ] **Fishing contest: not feasible yet.** There is no fishing implementation in the web port to hook; the
      system is decoded in the docs but not ported.
- [ ] **Album collector: not feasible yet.** The only album in the port is the card album; there is no record of
      which Digimon species you have seen.

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
