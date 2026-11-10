# GLOSSARY and OPTIONS: design (2026-11-04)

Status: DRAFT for the user. No code changed. Not committed.
Paths are relative to the repo root (`~/dw2003-play-integration`) unless they start with `ddw3:` (= `~/ddw3-walker/docs/research/ui/`). Every claim about code gives file:line that was read.
No disc-derived data is in this doc (the repo is public). Pieces are only named.

## 1. Goal

Two new entries on the pause menu (key `i`):

- **GLOSSARY** (name may change): one book that replaces seven scattered overlays. Sections: DIGIMON, ITEMS, PLACES.
- **OPTIONS**: all player settings, in 4 pages.

Both look and move like the game's own menus. F2 keeps only developer pages and labs; a player never needs it.

## 2. What the player sees

Screen is 320x240 (`web/menu.js` draws in 320x240 pause space; `ddw3:status-menu-chrome-decompiled-2026-07-10.md:123-137` lists pivots up to x=0x140=320, y=0xd3=211).
Legend: `[ ]` = navy panel with blue double frame and cut corners. `>` = the game's cursor. Orange = the game's number face.

### 2.1 Pause list (existing screen, two more rows)

```
 +------------------------------+
 | [triangle] Close Status      |
 +------------------+
 | ITEMS            |
 | SORT             |
 | MAP              |
 | TECHNIQUES       |
 | STATUS           |
 | CARD FOLDERS     |   (only with the Folder Bag)
 | QUESTS 2         |   (existing extra row)
 | GLOSSARY         |   NEW
 | OPTIONS          |   NEW
 +------------------+
```

### 2.2 GLOSSARY > DIGIMON, page 1 (approved by the user 2026-11-04)

```
 +-----------------------------------------------------------+
 | GLOSSARY  <Q DIGIMON ITEMS PLACES E>   Met 34/240  Beaten 12 |
 +---------------------+-------------------------------------+
 |   1 Kotemon         |  [ Agumon ]            (name tab)    |
 |   2 Veemon          |                                     |
 | > 3 Agumon          |   (the Digimon's own 3D model,      |
 |   4 ???             |    turning slowly, own idle motion) |
 |   5 ???             +-------------------------------------+
 |   6 Gabumon         | Found at level 5-12                 |
 |   7 Betamon         | Met - Defeated x4 - Your partner    |
 |                     | Lives in: <map>, <map>              |
 |                     | Drops: <item> 12%                   |
 +---------------------+-------------------------------------+
 | one-line help                             [R1] strength    |
 +-----------------------------------------------------------+
```

- **List (left), numbered.** One row per species: its number, then its name. A species the player has never met shows `???` (a shadow, no name, no data). Up/down moves one row; left/right jumps ten (**to confirm**: the user's approved text does not name the keys; the first draft had left/right = previous/next and up/down = jump 10, which suits a list drawn across the screen, not a vertical one). The list scrolls with blinking arrows (4.4).
- **Right, top: the Digimon's own 3D model**, turning slowly (one turn per 12 seconds) with its own idle motion; the name sits on a name tab above it (the status screen's name-tab plate).
- **Counts (coordinator ruling 2026-11-04):** drawn on the list window's first line as `Met 34/240  Beaten 12` (two spaces; the game font has no middle dot, `assets/ui/uifont.json` chars checked; the title bar has no room beside the section tabs). N = species met, M = species beaten at least once, total = every species in the list; section 6 says where each number comes from.
- **Page 1 (about) shows:**
  - level: your partner's live level (`Lv 9`), else `Found at level 5-12` from its encounter rows (real data); no line when there is neither. **No element and no family are shown: the tables hold neither (family is a bare number with no names table, element does not exist per species), and nothing is guessed in their place;**
  - your record: `Met` / `Defeated xN` / `Your partner` (the last only when the species is one of your partners right now);
  - where it lives (map names);
  - drops (item + chance).
- **What a Digimon you have only MET shows:** its name and its picture (model) and the `Met` part of your record. Everything else (level, where it lives, drops, and the whole of page 2) appears after its **first defeat**. (Reading of "only met shows name + picture": the record line is kept because it is what the player just earned; to be confirmed.) A species that is one of your partners right now counts as known.
- Order: partners first (the 190 partner profiles), then wild-only species (the wild table has 143 of its 193 species in the partner list too, so each name appears once: 190 + 50 = 240 numbers; measured from `digimon.json` + `extra_species.json` + `enemies.json`).
- Look: the game's own status sheet (STATUS detail screen): name-tab plate, white labels with orange numbers, the blue emblem wall behind. Window pieces are named in section 5.2 and the plan.

### 2.3 GLOSSARY > DIGIMON, page 2 (strength; R1 from page 1, L1 back)

```
 +-----------------------------------------------------------+
 | GLOSSARY  <Q DIGIMON ITEMS PLACES E>   Met 34/240  Beaten 12 |
 +---------------------+-------------------------------------+
 |  (list, same)       | [ Agumon ]    (model, smaller)       |
 |                     |  HP   =========  310                |
 |                     |  MP   =====      120                |
 |                     |  STR  ======      48 ...            |
 |                     | Resists: Fire     Weak to: Water    |
 |                     | Techniques: Pepper Breath, ...      |
 |                     | From: Kotemon   Into: Greymon, ...   |
 |                     | Level 12 - needs: <what it still needs> |
 +---------------------+-------------------------------------+
 | one-line help for the row                  [L1] about       |
 +-----------------------------------------------------------+
```

- **Bars with numbers:** HP, MP and the other stats as bars, the number beside each in the orange number face. No table.
- **Resists / weak to** (elements, read from the seven resistance numbers: 100 is neutral and the value DIVIDES the damage, so above 100 resists and below 100 is weak, `engine/dw3/battle-formulas.ts:27, 555`), **techniques**, **digivolves from / into** (the digivolution line; partners also use the blast forms where they apply).
- **Partners only:** the partner's **current level** and **what it still needs for its next form** (the planner's live gates).
- Page 2 is locked (R1 does nothing, no hint) until the species has been defeated once.
- Page flip and section switch use the album's cell-by-cell reveal (4.5).

<!-- First draft of 2.2 and 2.3 (replaced 2026-11-04 by the approved design above; kept so nothing is lost):
### 2.2 GLOSSARY > DIGIMON, page 1

```
 +--------------------------------------+
 | GLOSSARY   <Q  DIGIMON  ITEMS  PLACES  E>   |
 +-------------------+------------------+
 |                   | Agumon           |
 |   (big 3D model,  | Lv 12   Fire     |
 |    slowly turning,| HP  =======      |
 |    idle motion)   | MP  ====         |
 |                   | STR ======       |
 |                   | DEF ====         |
 |                   | SPD =====        |
 |                   | WIS ===          |
 +-------------------+------------------+
 | > Agumon      1/190   [R1] page 2    |
 +--------------------------------------+
```
Left/right = previous/next Digimon. Up/down = jump 10. Partners first, then wild. Bars are drawn, numbers in orange beside them. No table.

### 2.3 GLOSSARY > DIGIMON, page 2

```
 +-------------------+------------------+
 |  (model, smaller) | RESISTS          |
 |                   |  Fire  ===       |
 |                   |  Water =====     |
 |                   | TECHNIQUES       |
 |                   |  > Pepper Breath |
 |                   |    Claw Attack   |
 |                   | GROWS INTO       |
 |                   |  Greymon -> ...  |
 +-------------------+------------------+
 | one-line help for the row            |
 +--------------------------------------+
```
-->

### 2.4 GLOSSARY > ITEMS (one item at a time)

```
 +--------------------------------------+
 | [icon]  Medicine              x 3    |
 +--------------------------------------+
 | What it does                         |
 |  Heals a flat amount of HP.          |
 | Where to get it                      |
 |  > Shop in <town>                    |
 |    Dropped by <Digimon>   rate       |
 +--------------------------------------+
```
Left/right = previous/next item. Up/down = scroll the "where" lines. Icon from `drawItemIcon` (`web/itemicons.js:43`).

### 2.5 GLOSSARY > PLACES

Three sub-pages (L1/R1 inside the section, Q/E for the main sections):

```
 GYMS           ARENAS          FISHING
 +----------------------+
 | <Gym town>           |   one gym per screen:
 |  Greeter: <name>     |   its rank ladder as a short list,
 |  Rank 1  ID card     |   the next rank in orange
 |  Rank 2  ID card     |
 +----------------------+
```
Arenas: one arena per screen with the places that use it. Fishing: one stage per screen with casts left and what bites.

### 2.6 OPTIONS

Approved by the user 2026-11-04. 4 pages. Q/E (L1/R1) switch page, up/down moves, left/right changes a value. Keyboard and gamepad.

```
 +--------------------------------------+
 | OPTIONS   <Q  GAME SCREEN SOUND EXTRAS  E>  |
 +--------------------------------------+
 | > Battle speed        <   x2   >     |
 |   Random fights       < normal >     |
 +--------------------------------------+
 | How often wild Digimon jump you.     |   (help line for the focused row)
 +--------------------------------------+
```
The game is visible behind, dimmed.

- **GAME** (2 rows): battle speed (x1 / x1.5 / x2 / x3; using it turns its switch on by itself), random fights (fewer / normal / more; same). While their switch is off a row shows x1 / normal (what the game really does). Moving the value turns the switch on; setting x1 / normal turns it off again.
- **SCREEN**: Detail Original / Low / Medium / High (ONE choice, sets the small effect switches of Terrain, Weather, Atmosphere, Life and Ground, plus `fx.quality`; Original = every effect key off, the PS1 look; High = all on; table in section 6), wide screen, time of day (auto / day / golden / dusk / night = `fx.todMode`), weather (Random / Always / Storms / Clear = today's `fx.weatherMode` values auto / always / storm / clear), pixel filter, HD-2D look (on/off only), toon look.
- **SOUND**: music volume, sound volume (new: today fixed gains in `audio.js` and `fxaudio.js`, only mute key `b`), weather and place sounds on/off.
- **EXTRAS** (9 rows): one on/off row per group of invented features: Quests, Mount, Boss ideas, Giant mode, Battle ideas, Battle motion, Camera and look, Villagers, Online. A row turns all its keys on or off together; the help line says in plain words what it adds. Off at first (Quests stays on, as today). Single keys stay settable in F2 for developers.

Defaults: Detail High, sound on, extras off (Quests on, as today). Disc-faithful behaviour has no switch at all.
Same store and same keys as the F2 panel: `fx` in localStorage `dw.fx.v1` (`web/ambience.js:49-61`). F2 stops being a place for player settings, but only after the user accepts OPTIONS (build step 6); until then F2 is unchanged.

## 3. Controls

Same on every new screen.

| Action | Keyboard | Pad | Source |
|---|---|---|---|
| Move | Arrows / W A S D | D-pad, left stick | `engine/systems/input-map.ts:218-221` |
| Confirm | Enter, Space, Z, C | Cross (bottom) | `engine/systems/input-map.ts:225` |
| Back | Esc, X | Triangle (top) | `engine/systems/input-map.ts:234` |
| Switch section | Q / E | L1 / R1 | `engine/systems/input-map.ts:237-238` |
| Open pause | I | Start | `engine/systems/input-map.ts:241` |

- Held direction repeats: 16, then 6, then 4 ticks (`engine/systems/input-map.ts:330`, `PAD_REPEAT`; measured in `ddw3:pad-input-service-behaviour-2026-08-21.md:257-262`; a press is one frame). Held face buttons never repeat (`input-map.ts:327` comment, `:344-348`).
- Gamepad goes through the game's existing input: `attachGamepad` in `web/input.js:125`, used at `web/game.js:8453-8461`. It feeds the same `dispatchInput` as the keyboard, with word-bit names ("cross", "triangle"), so no new pad code is needed.
- Cursor does not wrap on the pause list (`ddw3:pause-menu-screen-tree-2026-08-14.md:108-117`). New lists follow that.
- **Careful (decode vs. game):** the old doc says Circle confirms (`pause-menu-screen-tree:116-120`), but the shipped game swaps the face buttons for English (`web/input.js:5-9`; `ddw3:pad-input-service-behaviour:197`). We use what the shipped game does (Cross confirm, Triangle back), as the user asked.

## 4. Animation (same as the game's own menus)

Reuse, do not invent. All numbers are the game's own, read from code/decodes.

1. **Window open/close = "fold".** A window scales from 0 to full around a pivot. Opening: 10 frames, plays the open sound (SYSTEM03 / `0x40019`). Closing: 5 frames (double speed), plays SYSTEM04 / `0x4001a`. Windows open one after another; each waits until the previous is ready.
   - Decode: `ddw3:status-menu-chrome-decompiled-2026-07-10.md:123-137`.
   - Walker code: `web/menu.js:590-648` (`_foldOpen`, `_foldClose`, `_animStart`, `_foldTr`, `fold()` at `:1565`); shared math in `engine/dw3/ui/fold-tween.ts` (named at `web/menu.js:620`, called at `:625`; file exists, not read).
   - Translated pause version: `engine/dw3/ui/native/pause-list.ts:108-137` (`pauseListFoldStart` / `pauseListFoldStep`; value 0 to 0x1000). `pause-quests.ts:70-72` shows a page starting its three folds.
   - Sound names in code: `pause-list.ts:91` (`PAUSE_LIST_SFX`: open, close, cursor, confirm, back).
2. **Opening order.** Top bar first, then list window, then description band (QUESTS: `pause-quests.ts:5-8, 70-72`). For GLOSSARY: title bar, then model window and card together, then footer line. OPTIONS: title bar, list window, help band.
3. **Cursor.** The animated list cursor: a rest phase of 32 vsyncs then 4 frames of 6 vsyncs (`web/uifont.js:258-273`, `drawCursor`). Moving plays the cursor sound (`system02`, `web/menu.js:255-262`; list cursor `PAUSE_LIST_SFX.cursor`). Confirm `system00`, back `system01` (`web/menu.js:810, 897, 923`).
4. **Blinking arrows** for "more above/below" and for the page hint: footer arrow is a 5-step blink (`web/menu.js:1829`); scroll arrows toggle every 9 vsyncs (`web/menu.js:2648-2650`).
5. **Section switch (Q/E) and Digimon change** copy the album's page flip: the old page stays on screen while the new one is revealed cell by cell (one every 2 frames), then a short settle before input reopens; open/close sounds on the flip, a "settled" sound when the page has something on it (`ddw3:card-album-screen-2026-08-14.md:259-273`). For GLOSSARY: the card side (right) reveals line by line the same way; the model swaps at the start of the reveal.
6. **Panel slide** (4 frames, linear) for the OPTIONS help band and for DIGIMON page 2 growing its list (`web/menu.js:651-660`, "See Digivolve" slide).
7. **Backdrop wall.** Full-screen status pages sit on a tiled wall that drifts down-right forever without a seam (`ddw3:scrolling-backdrop-walls-2026-08-14.md:11-21`); clips are built with a spare tile past every edge (`:56-63`). Status backdrop is clip 0x1d (`ddw3:status-menu-chrome-decompiled:27`; `web/status-backdrop.js:9-23`). Walker helper: `drawPackBackdrop` (`web/screenpack.js:214`, described `scrolling-backdrop-walls:119-125`). **The START list itself has no wall** (it is over the live field; `scrolling-backdrop-walls:154-165`), so OPTIONS (dimmed game behind) follows that, and GLOSSARY (full screen) uses the wall.
8. **Digimon model.** Slow turn about the up axis, with its own idle motion. See 5.2. Speed and idle are not game data yet: **I do not know yet** how fast the game's own model viewers turn; to be measured before building (decided: one turn per 12 s).
9. **Close** = reverse folds in the reverse order, then back to the pause list (as `pause-quests.ts:161`: three folds started closed).

## 5. Where it plugs in

### 5.1 The pause list

- Key `i` = Start (`engine/systems/input-map.ts:241`). Opened in `web/game.js:7826-7850` (`if (!state.menuOpen) pauseHome();`), which is `openPauseHome` (`web/pause-home.js:21-32`), which calls `status.openHome` (translated pause).
- The pause list is the translated page `engine/dw3/ui/pause-root-session.ts` behind `web/status-translated.js`.
- **How QUESTS was added** (copy this):
  1. `web/quests.js:688-695` `questsPauseRow()` returns `{label}`; null when quests are off.
  2. `web/game.js:957` `extraRow: () => questsPauseRow()` and `:958` `questsPage`, in the options object given to `createStatusTranslated`.
  3. `web/status-translated.js:147-148` copies them into the seed.
  4. `engine/dw3/ui/pause-root-session.ts:165-167` seed field `extraRow`; `:322-324` loads the label as a one-string bank; `:417` allocates room for the cursor; `:484-486` selecting the LAST row returns page "quests"; `:738` maps the disc's unused builder address to `questsFactory`.
  5. `engine/dw3/ui/native/pause-list.ts:75, 301-304, 422` draws and counts the extra row.
  6. The page itself: `engine/dw3/ui/native/pause-quests.ts` (translated, memory-based widgets).
- **Limit found: exactly ONE extra row is supported today** (`pause-list.ts:75, 301, 422`; `pause-root-session.ts:167, 484`). GLOSSARY and OPTIONS need an `extraRows` list. Also the row panel clip comes in fixed sizes (five, six, seven rows, `pause-list.ts:99-100`); with Folder Bag + QUESTS + 2 new rows the list has 9 rows, and **no nine-row panel clip is known to me**. This is the first thing to check (nine rows or one BOOK row is decided after build step 1, see section 11).
- **Recommended way to open the pages: the CARD FOLDERS hand-off**, not new translated pages. The Card Album and folder editor are web screens opened from the pause with a way back: `web/game.js:1049-1088` (`menu.onCardAlbum = () => { state.menuOpen = false; cardAlbum.open(backToCardFolders); }`; `status-translated` `onTransition` at `game.js:948-951`). GLOSSARY and OPTIONS do the same: the pause row calls a new `glossary.open(backToPause)` / `options.open(backToPause)`. Reason: the 3D model, bars and long text do not fit the translated text-widget pages (`pause-quests.ts:1-12` shows how small those are: eight rows, three lines).
- Overlay input routing today: `web/game.js:2454` is the list of "an overlay is open" tests (cut content, codex, blast, planner, damage lab, replay); the new screens are added to that list and to the per-frame tick near `game.js:8560-8575`.

### 5.2 Window kit (new module, `web/ui-kit.js`)

Pieces, all existing:

| Piece | Where |
|---|---|
| Chrome plates (cmfont and ststat clips: header, footer, list window, card, description band) | `web/screenpack.js:23-64` (`loadPack`, `drawClip`); used at `web/menu.js:237, 1796-1834` |
| Fold open/close | section 4.1 |
| Pixel font (`drawText`, `textWidth`) | `web/uifont.js:182-203` |
| Orange numbers | `NUMBER_FONT_KIND = 3` and `numberClutRow` (`web/uifont.js:61-76`) |
| Cursor | `drawCursor` (`web/uifont.js:273`) |
| Item icons | `drawItemIcon` (`web/itemicons.js:43`) |
| Menu sounds | `sfx.play("system00|01|02|03|04|06|07")` (counts in `web/menu.js`; 02 cursor `:255-262`, 01 back `:810`) |
| Plain navy box fallback | `drawWindow` (`web/uiRects.js:15-27`): navy fill + thin blue line, NOT the double frame |
| Wall backdrop | section 4.7 |

The kit only wraps these in a few calls: `panel(id, rect)`, `foldOpen/Close`, `list(rows, cursor)`, `bar(value, max)`, `helpLine(text)`. No new art.
The **double frame with cut corners** is a cmfont/ststat plate drawn with `drawClip`; which exact clip ids give a free-size panel is **not read yet** (still to read in step 1).

### 5.3 Move Theatre renderer for the Digimon

- `web/move-theatre.html:44-200`: `createBattle3D(offscreenCanvas, sfx)` (`battle3d.js:1963`), then `r.setPlayerDigimon(folder)` (`battle3d.js:3571`, returns a promise), `r.preloadDigimon(folder)` (`:3565`), `r.render(dt)` per frame, copy the offscreen canvas to the visible one (`move-theatre.html:176-200`).
- Species to model folder: `theatrePlan()` in `web/theatre-plan.js` (reads `digimon.json`, `model_map.json`, `models/index.json`; `move-theatre.html:66-72`). Returns `model: null` when a species has no battle model: those show a card without a model.
- See-through background exists: `createBattle3D(canvas, sfx, {alpha:true})` (`battle3d.js:1963-1967`) and `setBuiltArena(true)` (`:6154`), added for the Arena Viewer.
- **Gap:** the renderer draws a whole battle (two fighters and an arena, `move-theatre.html:80-86` sets a Kuwagamon as the foe). A "model alone, centred, slowly turning" view needs a showcase camera and the foe hidden. I did not find an existing one-model mode in `battle3d.js` (camera modes are the four in `theatre-plan.js:11`). Decided: add a showcase camera behind a flag.
- Make ONE renderer for the whole book and reuse it when the player moves to the next Digimon (do not create a new WebGL context per page).
- **Correction (2026-11-04, found while planning the DIGIMON step): a one-model view already exists, so the Gap above is smaller.** `web/anim-viewer.html` shows one Digimon alone: `r.setEnemyVisible(false)` (`battle3d.js:3612`), `r.setIsolated(true, "player")` (neutral background and ground grid, `battle3d.js:6203`, drawn at `:5453, 5565`), `r.setCameraMode("free")` with `r.setFreeCameraView(() => cam.view())` (`battle3d.js:6143`), and a free camera from `web/anim-viewer-camera.js` (`createFreeCamera`) that has `autoOrbitSpeed` in degrees per second (`:58, 285`; 30 = one turn per 12 s) and `frameBounds` (`:204`). Orbiting the camera is the model turning; no new flag in `battle3d.js` is needed unless the ground grid or the neutral background looks wrong in the window (`setBuiltArena(true)` + `{alpha:true}` gives a see-through canvas, `battle3d.js:6155`, but the floor quad is still drawn then, `:5563`). The plan tries the existing pieces first.

### 5.4 Switches (follow the rule)

- QUESTS is gated by `enabled = () => !fx || fx.quests !== false` (`web/quests.js:73`), and `"quests"` is not in the EXPERIMENTAL list (`web/ambience.js:54`), so it is **ON by default today**. It is listed in the Extras group (`web/ambience.js:36`). Keep that default (changing it would change what the user already has); to be confirmed.
- New behaviour stays OFF until the user has seen it. GLOSSARY and OPTIONS are hidden until the user has seen them: one dev switch each (`glossary`, `options`), added to Extras (`ambience.js:36`) and to EXPERIMENTAL (`:54`), so they are off at first; the pause row returns null when off (like `questsPauseRow`). After the user approves, the switch leaves EXPERIMENTAL (default on).
- Inside OPTIONS, the EXTRAS rows (one per group) are the player's switches for invented features (off at first; Quests on as today). Disc-faithful behaviour has no switch.

## 6. Data sources per section

Nothing new is stored. Each row comes from tables that existing modules already read. Shapes are named in the modules' own headers.

### DIGIMON
- Partner rows (name, level, element/family, six stats, resistances, status resist, six technique slots, signature, blast forms): `partnerRows(digimon, skills)` at `web/codex.js:112` (header `:1-30`). Includes the 135 extra species merged by `web/extra-roster.js` (`codex.js:1-8`).
- Wild rows (five stats, resists, attack/moves, drop and rate): `wildRows(enemies, skills, models)` at `web/codex.js:238` (header `:25-35`).
- Digivolution line: `lineTargets(evolutions, slot, profiles)` at `web/codex.js:150`; live gates ("what it still needs"): `plannerRows` at `web/evolution-planner.js:182` and `requirementText` `:113`.
- Blast forms and the level bracket for each: `blastCards(digimon, skills)` at `web/blast-ladder.js:68`, `tierForLevel` `:43`.
- 3D model: section 5.3.
- Partner pictures for species with no model: `web/partner-pictures.js` (named at `menu.js` imports; used by `native-screen-render.js:25`).

Added 2026-11-04 (approved design in 2.2 and 2.3). Each number on those two pages and where it comes from:

- **The species list** (pure, new): one entry per species NAME. Partners first (`partnerRows`, the 190 profiles), then the wild species whose name is not already a partner name (`wildRows`: 143 of the 193 names are also partner names, so 50 are wild-only; total 240; counted from `digimon.json` + `extra_species.json` + `enemies.json`). The wild key is `enemy_id` (the string `battleWon` sends, `web/battle.js:7861`, and `wildRows().name`, `web/codex.js:248`).
- **Level:** a partner you have right now shows its live level (`plannerPartyMembers()` in `web/game.js`, field `live.level`): `Lv 9`. Every other species shows `Found at level 5-12` from the level range of the places it lives in (`encounterIndex().bySpecies`, rows carry `level`, `web/codex.js:332-383`). No range and not your partner = no line. The species tables themselves carry no level (`digimon.json` / `enemies.json` have none; read).
- **Element and family: not shown.** The tables carry no element for a species and `family` / `digimon_type` are bare numbers (`web/codex.js:125, 259`); no names table exists in `web/`, `engine/`, `docs/` or the extracted `assets/data` (checked). Per the coordinator's ruling no guess is shown (no element from a technique, no `Family N`).
- **Grows from / into: real tables only.** Shown for a starter: its line's forms (`lineTargets`, `web/codex.js:150`). Shown for another form only as "reached from" the starter line(s) whose records reach it (the data behind the Codex's "Can be reached from", `web/codex.js:653-664, 1166-1180`). A species with no real line shows nothing there; no rule of our own.
- **Where it lives (map names):** `encounterIndex(...).bySpecies.get(name)` gives the stages, `stageName` is the map name (shown the way the quest log does, the part after the dash: `mapLabel`, `web/quests.js`) (`web/codex.js:332-383`, names from `assets/manifest.json`). A species with no encounter row shows `-`.
- **Drops (item + chance):** `wildRows()` fields `drop`, `dropRate` and `dropOdds(rate)` (`web/codex.js:238, 433`); the placeholder item `Null` means none (`dropText`, `:419`).
- **Page 2:** partner HP and MP from `partnerRows` (`hp`, `mp`), the other stats from `stats` (`web/codex.js:112-148`). A wild-only species has five stats and no HP/MP in its row (`wildRows`, `web/codex.js:238-289`); its HP is the largest `hp` of its encounter rows (`encounterIndex` rows carry `hp`). The encounter's `mp` read 9999 in the first screen looked at (`field_encounters.json` screen 1), so wild MP is **not shown until it is measured** (the data task measures it). Resistances from the seven element numbers (100 neutral, the value divides damage: `engine/dw3/battle-formulas.ts:27, 555`); techniques from `techSlots` / `attack, move1, move2` through `skills`; grows from / into as in the Grows bullet above (real line data only; nothing when there is no line); blast forms from `blastCards` (`web/blast-ladder.js:68`, the five forms and their level brackets, starters only).
- **Partner extras on page 2:** current level (above) and "what it still needs for the next form" from `plannerRows(evolutions, slot, profiles, skills, live)` (`web/evolution-planner.js:182`): the row that is READY now, else the one with the fewest unmet gates, shown as its `text`.
- **Met / defeated: a NEW per-species counter (the only new stored data).**
  - **What exists today (searched `web/`, `engine/`, `tools/`, `tests/`): nothing records which wild species the player met or beat.** `battleStarted` carries only `{ mapId, screenId }` (`web/battle.js:4204`, no names). `battleWon` carries `{ enemies: [names], mapId, screenId }` and is sent on a WIN only, and only for string names (`web/battle.js:7861`; a co-op win sends it only with the `mpcredit` switch on, `web/mpbattle.js:842-844`). The one listener, `web/quests.js:247-249`, advances an ACTIVE quest's "defeat" objective and stores nothing per species. `st.met` in the quest state is a list of `npc@map` keys for characters, not species (`web/quests.js:61-66`). No `seen`/`kills`/`bestiary` store exists.
  - **How it is stored (follow the quest layer):** its own localStorage key, `dw.glossary.v1`, not `dw.fx.v1`. The quest layer does the same (`dw.quests.v1`, `web/quests.js:27, 62-72`). Save slots copy EVERY localStorage key except `assetMode` and the three slots (`web/save.js:90-101` `snapshotStorage`, `:103-110` `restoreStorage`), so the new key travels with each save slot and a load brings back that slot's counts, exactly as quests do. Shape: `{ v: 1, met: { "<species name>": n }, beaten: { "<species name>": n } }`.
  - **When it counts:** met = +1 for each enemy of the fight when it starts (needs the enemy names added to the `battleStarted` payload at `web/battle.js:4204`, an additive field the quest layer ignores); defeated = +1 per enemy on `battleWon`. Fled or lost fights count as met only. It records ALWAYS (coordinator ruling), whether or not the `glossary` switch is on: it is invisible, and the record then exists when the player first opens the glossary. It counts from the day this ships; nothing is back-filled.
  - **Header numbers:** `Met N` = species with `met > 0`; `Beaten M` = species with `beaten > 0`; `total` = the 240 list entries.

### ITEMS
- Where to get: `indexRows(index)` `web/item-source.js:76`, `sourcesFor(id, data)` `:183`, `shopRows` `:100`, `priceWord` `:148`, `nothingLine` `:171`. Tables named in `item-source.js:8-16` (obtain index, shops, merchant shops, item effects, equipment).
- What it does (caps, clips, sell value): `ruleRows(effects)` `web/item-rulebook.js:58`, `capWords` `:74`, `sellSheet` `:100`, `battleOnly` `:110`.
- Drops (which Digimon drop it): `dropIndex` / `dropEntry` `web/codex.js:460, 493` (Drops tab) and the `drop` source kind in `item-source.js:13`.
- Icon: section 5.2.
- The page halves of the item book and rulebook are DOM pages (`web/item-source-page.js:1-14`, `item-rulebook-page.js:1-14`). Their word-making must be moved into the pure modules (or a small `glossary-text.js`) so the canvas screen can use it. Not done yet.

### PLACES
- Gyms and rank ladder: `gymRows(ranks, menus, stage)` `web/gym-map.js:73`, `rankLadder` `:61`, `groupSizes` `:45`; wording helpers (`greeterText`, `placeName`, `gateText`, `drillText`, `mapSummary`) are in `web/gym-map-page.js:1-14`, top level is DOM-free.
- Battle arenas: `setBattlefieldsData` `web/codex.js:719` and the Battlefields tab (`codex.js:1700-1790`): stages, maps, 29 arenas, element worlds.
- Fishing: `almanac(fish, screens, rewards, maps)` `web/fishing-almanac.js:79`, `cardmonStages` `:99`, `waterIndex` `:108`, `castsLeft` `:125`, `rewardFor` `:137`. The in-field hint uses `fx.anglermap` (`web/game.js:11124`).

### OPTIONS (current settings and where each is stored)

All values live in `fx`, saved under `dw.fx.v1` (`web/ambience.js:49-61`). OPTIONS uses the same store and the same keys.

| Row | Today | Key / store | Reads it |
|---|---|---|---|
| Battle speed (x1, 1.5, 2, 3) | slider `fx.battleSpeed`, default 2, only works when `battlespeed` is on | `ambience.js:60, 1173` | `battle.js:5625`; `battle-speed.js:47` |
| Random fights (fewer / normal / more) | `fx.encounterDialMode` (today none, rare, normal, lure), only works when `encounterdial` is on | `ambience.js:61, 1162` | `encounter-dial.js:39-41`; `game.js:9666` |
| Music volume | **does not exist.** Fixed 0.6, only mute key `b` | none | `audio.js:63`; `game.js:8426` |
| Sound volume | **does not exist.** Effects fixed 0.7; weather sounds fixed 0.55 | none | `audio.js:132`; `fxaudio.js:26` |
| Detail (Original / Low / Medium / High) | no single preset. F2 "Quality" only sets weather-particle density | `fx.quality` + the keys below | `ambience.js:48, 312, 716, 1175` |
| Pixel filter | default off | `fx.spriteFilter` | `ambience.js:1174`; `game.js:450` |
| Time of day (auto, day, golden, dusk, night) | F2 "Time" | `fx.todMode` | `ambience.js:1170` |
| Weather (Random / Always / Storms / Clear) | F2 "Weather", same 4 values (auto, always, storm, clear) | `fx.weatherMode` | `ambience.js:1169` |

Two traps:
- **Battle speed and Random fights are dead unless their switch is on** (`battle-speed.js:47`, `encounter-dial.js:40`). The OPTIONS row owns the switch too: while the switch is off the row shows x1 / normal (what the game really does); moving the value writes it and turns the switch on; setting x1 / normal turns it off again (decided).
- **Volumes are new work.** A master gain for music (`audio.js:63`, jingle element `:109`), for effects (`audio.js:132`) and for weather (`fxaudio.js:26`), saved in `fx`, default equal to today's values (nothing changes until the player moves it). Sound is on by default.

#### Where every key goes

Read from `web/ambience.js:31-54` (`FX_GROUPS` 99 keys, EXPERIMENTAL list, BATTLE list). Targets: a Detail preset, a page of OPTIONS, or "F2 dev only". Non-key values (`quality`, `todMode`, `weatherMode`, `spriteFilter`, `battleSpeed`, `encounterDialMode`, `lightGain`, `hd2dStrength`) are in the rows above. `lightGain` and `hd2dStrength` stay F2 dev sliders; the HD-2D row is on/off only (decided).

Detail Original / Low / Medium / High (35 keys + `fx.quality`; Original = all 35 off, High = all on):

| Group | Keys |
|---|---|
| Terrain (8) | sway, grass, grasspush, water, reflect, mirror, wetlook, seam |
| Weather (9) | rain, rainwater, snow, sand, lightning, gusts, breath, frost, screenfx |
| Atmosphere (12) | tod, nightlight, clouds, lamps, lightpool, lightreveal, indoor, fog, shafts, heat, sparkle, pollen |
| Life (3) | leaves, fireflies, devils |
| Ground (2) | steps, puddles |
| Screen (1) | uisharp |

Which keys Low and Medium switch off is not decided: to measure (cost per effect) at build step 2.

Pages:

| Page | Row | Keys |
|---|---|---|
| GAME (2) | Battle speed | battlespeed (+ value battleSpeed) |
| GAME | Random fights | encounterdial (+ value encounterDialMode) |
| SCREEN (5) | Wide screen | widefield, battlewide |
| SCREEN | HD-2D look | hd2d |
| SCREEN | Toon look | toonoutline, toonshade (one row) |
| SCREEN | Time of day, Weather, Pixel filter, Detail | values only (above); Detail sets the 35 keys listed above |
| SOUND (4) | Weather and place sounds | sound, ambience, musicfx, footsteps (musicfx and footsteps ride on the same row: decided) |
| SOUND | Music volume, Sound volume | new values |
| EXTRAS (28 keys, 9 rows) | Quests | quests, questtriggers, questemotes, questplacecard, questsecondjob |
| EXTRAS | Mount | mount, mountseat |
| EXTRAS | Boss ideas | fusionbosses, bossphases, bossmusic, bossgrows |
| EXTRAS | Giant mode | giantmode |
| EXTRAS | Battle ideas | fieldwar, omen, practice2v2, enemytells, aishift |
| EXTRAS | Battle motion | ownclips, dw2motion, smoothanim |
| EXTRAS | Camera and look | smartcam, battlepano, softalpha, battleatmos |
| EXTRAS | Villagers | villagers |
| EXTRAS | Online | serverchamp, mpbubbles, mpcredit |

Each EXTRAS row turns all its keys on or off together, with a one-line plain explanation. Single keys stay settable in F2 for dev. `quests` is on today (not in EXPERIMENTAL) and stays on by default (decided).

F2 dev only (25 keys): codex, blastladder, planner, itemsource, gymmap, itemrulebook, anglermap (these 7 feed GLOSSARY and are hidden from F2 once the book is accepted), movetheatre, cutcontent, stageselect, soundtest, soundtrack, cinema, langdesk, damagelab, silence, cursorbook, chatqueue, weaponlab, bitledger, savexray, saveverify, replay, redirectview, arrivallab.

Check: 35 + 2 + 5 + 4 + 28 + 25 = 99 keys.

Disc-faithful behaviour stays always on; there is no switch for it.

## 7. What moves off the player's path

The seven overlays merge into GLOSSARY; their code stays (the glossary reuses the pure modules) and their F2 switches stay for developers until the book is accepted. Then they are hidden from F2.

| Today | Opened by | Goes to |
|---|---|---|
| Codex tabs partners, wild, drops | `__openExtra("codex")` `game.js:8549` | DIGIMON / ITEMS (drops) |
| Codex tabs encounters, loadout, clips, battlefields | same | encounters stay F2; battlefields -> PLACES; loadout and clips stay F2 (developer data) |
| Item source book | `ambience.js:1225` `item-source.html` | ITEMS |
| Item rulebook | `ambience.js:1228` `item-rulebook.html` | ITEMS (the "what it does" line) |
| Gym map | `ambience.js:1226` `gym-map.html` | PLACES > GYMS |
| Angler's almanac | `ambience.js:1233` `fishing-almanac.html` | PLACES > FISHING |
| Blast ladder | `game.js:8550` | DIGIMON page 2 (grows into) |
| Next forms planner | `game.js:8551` | DIGIMON page 2 (grows into, with live gates) |

Stay on F2 (developer only, never needed by a player once OPTIONS is accepted; until then F2 is untouched; table in section 6): Damage Lab, Cursor almanac, Silence report, Counter redirects, Arrival lab, Save X-ray, Language desk, Sound test, Cut-content gallery, Stage select, Replay theatre, Story explorer, BIT ledger.

## 8. Art and assets

Reuse first:
- Plates, wall, cursor, font, icons, sounds: all existing (section 5.2).
- Digimon: the 3D model (section 5.3) or the partner picture.
- Item icon: `drawItemIcon`.

Missing (to confirm after step 1; none generated now). If needed they MAY be made later with the local FIBO pipeline (skill `fibo-safety` must be loaded first: one picture at a time, kill and check after each):
1. A calm backdrop for the model window (soft room/sky), only if the plain wall looks wrong behind a 3D model.
2. Place pictures for PLACES (one per gym town / arena), only if the user wants pictures there; the game's own map thumbnails are tried first.
3. Section tab icons (DIGIMON / ITEMS / PLACES), only if font glyph icons (`drawIconGlyph`, `web/uifont.js:235`) are not enough.
No other new art. Screenshots and a vision review are allowed for this UI work; the steps are in section 10.

## 9. Known bugs fixed on the way

Found in code; cause is NOT measured yet. Each gets a measure-first step.

1. **Codex clip names show as boxes.** The Clips tab draws the developers' own animation names, which are Japanese (full-width) text (`web/fight/clip-names.js:1-10, 37-38`), with the browser's `monospace` canvas font (`web/codex.js:1220-1282`). Likely cause: the canvas font has no glyphs for them. Not proven. The English gloss next to each name is also in the table. Fix idea: draw the English gloss and the id only. Measure first with `measureText` and a glyph check in the GPU Chromium.
2. **Battlefields tab text overlaps.** The list is drawn at a fixed 10 px with `rowH` from the page height and a column cut at 38 characters (`web/codex.js:1763-1790`, `width = 38`, `lh = max(11, min(14, rowH))`), next to a right-hand panel I did not read. Overlap source not measured. Will be replaced by PLACES > ARENAS anyway; fix = measure text widths with `measureText`, not character counts.
3. **Damage Lab footer clipped.** The footer is one long line at `y + h - 16` (`web/damage-lab.js:712`) with no width check. Not measured. Fix: measure and split into two lines.

## 10. Testing and build order

Rule for every step: node tests, then a GPU screenshot with a vision review (allowed for this UI work): `tools/run-playwright.sh` + `tools/verify-launch.mjs`, and the printed WebGL renderer must name the AMD GPU. SwiftShader / llvmpipe = stop and report. FIBO windows hidden. Not committed until asked.

Node tests (existing style: `tests/*.test.js`, e.g. `tests/native-screen-pad-input.test.js`, `tests/scrolling-wall-position.test.js` (both exist in `~/ddw3-walker/tests`); this repo has its own `tests/`): pure logic only (row lists, paging, bar values, repeat ticks 16/6/4, fold timing 10/5 frames, section switch, settings store round-trip).

| Step | Build | Node tests | Screenshot shown |
|---|---|---|---|
| 1 | Window kit + input (`ui-kit.js`), fold, cursor, wall, `extraRows` in the pause list | fold frames 10/5; repeat ladder; list holds 9 rows; QUESTS still works | pause list with 9 rows, a blank kit window |
| 2 | OPTIONS (4 pages) + new volume gains + Detail preset + dev switch `options`. F2 is NOT trimmed here: OPTIONS is hidden until the user sees it | each row: value to `fx`, saved/loaded; defaults equal today's; Detail High = all on; speed/random rows turn their switch on; every key in the section 6 table has a home; Detail Original = all 35 off; Quests row on by default | each of the 4 pages |
| 3 | GLOSSARY > DIGIMON (model, page 1 and 2) | row data equals codex rows; paging; no-model fallback | Digimon page 1 and 2 |
| 4 | GLOSSARY > ITEMS | each item has "where" and "does" lines or the nothing line | one item with icon |
| 5 | GLOSSARY > PLACES | gym ladder, arena, fishing rows | one screen each |
| 6 | After the user accepts OPTIONS (and the book): trim the player settings off F2 so it keeps dev pages and labs only; hide the 7 feeder switches once GLOSSARY is accepted | F2 lists no player setting; every moved key still saved/loaded under `dw.fx.v1` | F2 panel |

The user sees the result of a step before the next step starts. Bug fixes (section 9) go into steps 3 and 5.
Also checked in step 1: opening the pause on a field, in a shop-free spot, still plays the original open sound and fold; the old list is unchanged when both dev switches are off.

## 11. Decisions and open question

Decided (2026-11-04; the user delegated these):
- The model turns once every 12 seconds, with its own idle motion.
- Text is English.
- Nine pause rows or one BOOK row: decided after build step 1 (the nine-row clip check).
- GLOSSARY and OPTIONS stay hidden (off) until the user has seen them.
- Showcase camera for the model alone: yes (a new flag in `battle3d.js` that only this screen sets).
  (2026-11-04: made from the existing free camera and isolated mode, see the correction in 5.3; a new flag only if that is not enough.)
- Wild Digimon the player has not met show as ??? shadows.
- OPTIONS has 4 pages and the defaults in section 2.6; the key table is in section 6.

Still open:
1. **Name:** GLOSSARY, DIGIDEX or BOOK (the QUESTS row is 6 letters; pause strings use letters, digits and spaces only, `pause-root-session.ts:164`).

Still to read (build step 1): exact free-size double-frame clip ids (`ddw3:menu-assets-decoded-2026-07-03.md` section 1 and `ddw3:status-menu-chrome-decompiled` screen map `:15-29`). If none exists, panels are built from fixed plates.
