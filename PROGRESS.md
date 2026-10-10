# Progress

How much of Digimon World 2003 this recreation already does. This page is
generated from `web/system-status.json` by `tools/build_progress.mjs`; do not
edit it by hand.

**Overall: about 69% of the game's systems work** ███████░░░

- 13 of 34 systems work fully, 21 work partly.
- 105 of 121 game screens are rebuilt from the original game's code (87%).
- Everything is built from the original game's code and checked as we go: 85% of the 2119 facts we have written down about the original are at least partly confirmed against its code, and 36% fully.

## How to read this

- **✅ Works**: the feature is in the game and runs the way the original does,
  as far as we have found. Bugs are still possible.
- **🟡 Partly works**: the feature is in the game, but parts of it are missing
  or simplified.
- **Double-checking**: we keep checking each feature against the original
  game's code. The share of facts confirmed so far is in the summary above;
  a feature that is not fully confirmed yet is not necessarily broken.
- **Overall %**: every system counts the same; a working one counts 1, a
  partly working one ½. It is a rough guide, not a measurement of play time.

## Story & world

| Feature | Status | What works and what is missing |
| --- | --- | --- |
| Gym training | ✅ Works |  |
| Inns | ✅ Works |  |
| Random encounters | ✅ Works |  |
| Arena tournaments | 🟡 Partly works | The final World Champ fight works from start to finish. The tournament bracket itself isn't in the game yet, and neither is the 4-badge entry check. |
| Card battles | 🟡 Partly works | Duels, card effects and the card screens work. Many card effects are still unfinished. |
| Exploring the world (maps, doors, people) | 🟡 Partly works | Maps, doors, ladders, mazes, ice, fire traps, launch pads and Submarimon all work. A few map details are still unfinished. |
| Fishing | 🟡 Partly works | Rod, bobber, meter and both fishing battle outcomes work. One small visual detail at the end of a cast still needs checking. |
| Post-game content | 🟡 Partly works | The reunion, the world changes and the post-game movie work. The movie that plays on the title screen after you finish isn't done yet. |
| Quests and story events | 🟡 Partly works | The whole story is hooked up: all 40 story beats work, with no gaps. Three side events are skipped for now. |
| Saving and loading | 🟡 Partly works | The memory-card screens work, and your party, stats, gear, forms and cards save and load correctly. The saved file isn't byte-for-byte the same as the original's. |
| Shops | 🟡 Partly works | Buying, selling, stock and the card-pack shop work. A few small details are left. |
| Story progression | 🟡 Partly works | The story's gating works. A few extra party-related checks aren't covered. |

## Battles & Digimon

| Feature | Status | What works and what is missing |
| --- | --- | --- |
| Charisma | ✅ Works |  |
| DNA digivolution | ✅ Works |  |
| Elements and weaknesses | ✅ Works |  |
| EXP and leveling up | ✅ Works |  |
| Party management | ✅ Works |  |
| Stat growth | ✅ Works |  |
| Status effects | ✅ Works |  |
| Battles | 🟡 Partly works | Commands, damage, items, status effects and the results screen work. A few damage details are unresolved. |
| Blast digivolution | 🟡 Partly works | The blast gauge, the free-technique use and all four animations work. Some detail around switching fighters mid-battle and what is kept after the fight still needs work. |
| Digivolution | 🟡 Partly works | The digivolve screens, evolution graph, unlock checks and dive forms work. Some saved form details are still unnamed. |
| Equipment | 🟡 Partly works | Slots, two-handed and accessory rules, stats and the 999 limit work. Some crest and equipment effects are unfinished. |
| Items | 🟡 Partly works | The item list, prices, battle items and stack limits work. Some item effects and edge cases are unfinished. |
| Techniques | 🟡 Partly works | Learning, slots, MP cost and technique rules work. How forms are stored on the memory card is unfinished. |

## Look & sound

| Feature | Status | What works and what is missing |
| --- | --- | --- |
| 3D battle scenes | ✅ Works |  |
| Character shadows | ✅ Works |  |
| 2D graphics | 🟡 Partly works | Text, windows and screens are drawn the way the original draws them. We haven't compared whole screens against the original yet. |
| Menus and windows | 🟡 Partly works | Menus, dialogue, name entry, registration, title and country screens work. A few screens still use a stopgap. |
| Music and sound | 🟡 Partly works | Music and sound effects play the way the original does. A few specific cues (item, KO and miss sounds) are deliberately not played yet. |

## Under the hood

| Feature | Status | What works and what is missing |
| --- | --- | --- |
| Battle model data | ✅ Works |  |
| Controls | 🟡 Partly works | Controller and keyboard input work consistently across every screen. |
| Core engine | 🟡 Partly works | The game's basic services (memory, flags, randomness, timing) work. One stopgap remains: some original machine code is still being run. |
| Loading game resources | 🟡 Partly works | Loading and unloading screens' assets works. We haven't compared load timing and visuals against the original yet. |

The engineering view of the same data (every claim, test and code file) is the
systems page: open `systems.html` in the running game.
