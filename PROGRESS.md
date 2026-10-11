# Progress

How much of Digimon World 2003 this recreation already does. This page is
generated from `web/system-status.json` by `tools/build_progress.mjs`; do not
edit it by hand.

**Overall: about 69% of the game's systems work** ███████░░░

- 13 of 34 systems work fully, 21 work partly.
- 105 of 121 game screens are rebuilt from the original game's code (87%).
- 36% of the 2119 documented facts about the original game are fully checked against its code.

## How to read this

- **✅ Works**: the feature is in the game and runs the way the original does,
  as far as we have found. Bugs are still possible.
- **🟡 Partly works**: the feature is in the game, but parts of it are missing
  or simplified.
- **Checked against the original**: of the facts we have written down about how
  the original does this feature, the share that has been fully confirmed
  against the original game's code. A low number means less has been double
  checked, not that it is broken.
- **Overall %**: every system counts the same; a working one counts 1, a
  partly working one ½. It is a rough guide, not a measurement of play time.

## Story & world

| Feature | Status | Checked against the original |
| --- | --- | --- |
| Gym training | ✅ Works | 8% (1/12) |
| Inns | ✅ Works | 0% (0/9) |
| Random encounters | ✅ Works | 54% (15/28) |
| Arena tournaments | 🟡 Partly works | 11% (1/9) |
| Card battles | 🟡 Partly works | 24% (128/527) |
| Exploring the world (maps, doors, people) | 🟡 Partly works | 31% (66/216) |
| Fishing | 🟡 Partly works | 26% (6/23) |
| Post-game content | 🟡 Partly works | 0% (0/7) |
| Quests and story events | 🟡 Partly works | 63% (20/32) |
| Saving and loading | 🟡 Partly works | 0% (0/3) |
| Shops | 🟡 Partly works | 36% (18/50) |
| Story progression | 🟡 Partly works | 33% (1/3) |

## Battles & Digimon

| Feature | Status | Checked against the original |
| --- | --- | --- |
| Charisma | ✅ Works | 17% (1/6) |
| DNA digivolution | ✅ Works | 7% (1/14) |
| Elements and weaknesses | ✅ Works | 0% (0/1) |
| EXP and leveling up | ✅ Works | 43% (3/7) |
| Party management | ✅ Works | 24% (4/17) |
| Stat growth | ✅ Works | 74% (17/23) |
| Status effects | ✅ Works | 54% (7/13) |
| Battles | 🟡 Partly works | 59% (189/319) |
| Blast digivolution | 🟡 Partly works | 71% (15/21) |
| Digivolution | 🟡 Partly works | 36% (8/22) |
| Equipment | 🟡 Partly works | 55% (24/44) |
| Items | 🟡 Partly works | 95% (19/20) |
| Techniques | 🟡 Partly works | 28% (5/18) |

## Look & sound

| Feature | Status | Checked against the original |
| --- | --- | --- |
| 3D battle scenes | ✅ Works | 80% (4/5) |
| Character shadows | ✅ Works | 0% (0/15) |
| 2D graphics | 🟡 Partly works | 0% (0/4) |
| Menus and windows | 🟡 Partly works | 12% (31/256) |
| Music and sound | 🟡 Partly works | 33% (20/60) |

## Under the hood

| Feature | Status | Checked against the original |
| --- | --- | --- |
| Battle model data | ✅ Works | 8% (1/12) |
| Controls | 🟡 Partly works | 0% (0/16) |
| Core engine | 🟡 Partly works | 52% (145/281) |
| Loading game resources | 🟡 Partly works | 33% (4/12) |

The engineering view of the same data (every claim, test and code file) is the
systems page: open `systems.html` in the running game.
