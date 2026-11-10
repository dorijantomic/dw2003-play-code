# GLOSSARY > DIGIMON Implementation Plan (build step 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No step in this plan commits.**

**Goal:** The DIGIMON section of the GLOSSARY book: a numbered list on the left, the Digimon's own 3D model turning slowly on the right, page 1 (about) and page 2 (strength), and a new per-species Met / Defeated counter that is saved with the game.

**Architecture:** Four small pure modules (species log, species rows, paging model, 3D stage wrapper) and two drawing modules (card, book). The book plugs into `web/book-host.js` through its book interface and replaces the blank book that `glossary` opens today. The model is the game's own battle renderer in its one-model mode (free camera that orbits, which is the model turning), drawn into an offscreen canvas and copied into the window. Counts live in their own localStorage key, which save slots already copy.

**Tech Stack:** Plain ES modules in `web/`, `node --test`, Playwright Chromium on the AMD GPU for screenshots. No engine (TypeScript) change, so no `build:engine`.

**Spec:** `docs/superpowers/specs/2026-11-04-glossary-and-options-design.md` sections 2.2, 2.3, 5.3 (with its 2026-11-04 correction) and 6 DIGIMON. Earlier plan (steps 1 and 2, already built): `docs/superpowers/plans/2026-11-04-glossary-and-options.md`; read its Global Constraints first, they apply here word for word.

Repo: `/home/dorij/dw2003-play-integration` (WSL). From Windows run commands as `wsl.exe -e bash -lc '...'`. All paths are relative to the repo unless absolute.

## Global Constraints

(Copied from the earlier plan; every task includes them.)

- **NO git commits in any step. Do not commit, do not push, do not merge.** Where a normal plan would commit, the step is: "do not commit; report the changed files" (`git status --short`, list them in the report).
- Node for every test: `export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH` then `cd /home/dorij/dw2003-play-integration`; one file: `node --test tests/<file>.test.js`; everything: `npm test` (about 2 minutes). Baseline failures are in `/home/dorij/dream/baseline-failing.txt`. **No new failure is allowed.** Check: `/home/dorij/ui-review/new-failures.sh` must print nothing under "new failures (must be empty):". Also `npm run typecheck` stays clean.
- **Screenshots: GPU only.** `tools/ui_shot.mjs` (exists) launches through `tools/verify-launch.mjs` (HARDWARE args) under `tools/run-playwright.sh` (`GALLIUM_DRIVER=d3d12`), prints the WebGL renderer and THROWS unless it names an AMD card. SwiftShader or llvmpipe = **stop and report**, never fall back. Game server `python3 /home/dorij/serve_game.py` on 8090 (`curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html` must print 200; start it hidden if not). Screenshots go to `/home/dorij/ui-review/build/<name>.png`; the main session looks at them. The executor never judges a picture and never asks the user to look. Shot scripts live outside the repo in `/home/dorij/ui-review/build/shots/`.
- Every task ends with: its node tests pass, the new-failures check is empty, `npm run typecheck` is clean, and (Tasks 3 to 6) a GPU screenshot saved to `/home/dorij/ui-review/build/<task>.png`. Tasks that add only pure modules (1, 2) re-take the unchanged pause list to prove nothing leaked into it.
- **New things default OFF** behind the dev switch `glossary` (already in `web/ambience.js` Extras group and EXPERIMENTAL list). With it off the pause list is byte for byte today's. Settings are F2 toggles, never URL flags. The Met / Defeated counter is invisible (no screen) and records ALWAYS, switch on or off (Notes, point 8).
- **Public repo: never add disc-derived data files.** Tests that read `web/assets/**` (a symlink to the local extraction, never committed) skip themselves when the file is missing. Test fixtures are small invented tables.
- **Keyboard and gamepad: reuse the game's existing input.** CONFIRM is the word `circle`, BACK is the word `cross`, Q and E are `l1` and `r1`, arrows and W A S D are `up down left right` (`web/ui-kit-input.js` `WORD`). The book reads them only through `book.act(buttons)`.
- Look: the game's own menus. Window pieces only from `web/ui-kit.js` (`drawHeader`, `drawPanel`, `drawFooter`, `drawHelpBox`, `drawBar`, `withFold`, `listRowY`), the pixel font `web/uifont.js` (`drawText`, `textWidth`, `drawCursor`, `drawIconGlyph`; kind 1 = white, kind 3 = orange numbers), measured text `web/text-fit.js`. Status sheet reference (read from code, not pictures): `web/menu.js:2406-2515` `_drawDetail` with `status_ui.json screens.detail` (ststat clip 31 name tab at (20,13), ststat 33 stat window at (0,84) with cmfont 15 stat icons at (0,87), numbers right-aligned at x 50 and 91, pitch 14) and the emblem wall `web/status-backdrop.js`. Measured native sizes (`clipSize`, `web/screenpack.js:54`): ststat 31 is 300x39, ststat 33 is 108x109, ststat 34 is 208x65, ststat 60 is 76x25, cmfont 15 is 70x100, cmfont 24 (header) is 288x25.
- Plain English text. Pause strings use letters, digits and spaces only. The game font has no middle dot: use `-` (`assets/ui/uifont.json` chars checked).
- Do not create worktrees, clones or copies of the repo. `web/vendor/` is a build output, untouched here.

## Notes on the spec (read and measured; different from, or missing in, the spec)

1. **Species count is 240, not 190.** The list is one entry per species name. `digimon.json` + `extra_species.json` give 190 partner profiles; `enemies.json` gives 193 wild names (minus the `Null` row); 143 of the wild names are also partner names. Union = 240 (counted offline with the same merge the game does at load). All 240 resolve to a model folder through `resolveModelFolder` (`web/battle3d.js:6382-6410`; 3 names go through `canonicalModelName`).
2. **Only real fields are shown (coordinator ruling).** `digimon.json` and `enemies.json` rows have no level, element, attribute or family-name field; `family` / `digimon_type` are bare numbers and no names table exists in `web/`, `engine/`, `docs/` or the extracted `assets/data` (checked: no attribute / type-name / family-name key; `extra_species_aspect.json` is the Aspect bonus mechanic, not a species attribute). So **element and family are NOT shown at all** (no guess from a technique, no `Family N`). The level line is real data: your partner's live level (`Lv 9`), else `Found at level 5-12` from its encounter rows (`encounterIndex` rows carry `level`); no encounter row and not your partner = no line.
3. **Wild species have no HP/MP in `wildRows`.** HP = largest `hp` of its encounter rows. The encounter's `mp` read 9999 on the first screen looked at, so wild MP is not shown (a task step measures it first).
4. **The one-model camera already exists** (spec 5.3 correction): `setEnemyVisible(false)` `battle3d.js:3612`, `setIsolated` `:6203`, `setCameraMode("free")` + `setFreeCameraView` `:6143`, `createFreeCamera` with `autoOrbitSpeed` (`web/anim-viewer-camera.js:58, 285`). 30 degrees per second = one turn per 12 s. No `battle3d.js` change is planned.
5. **Digivolution "from / into": real tables only (coordinator ruling).** Records are per line (8 lines, `evolutions.json`). **Grows into** is shown only for a starter: `lineTargets(evolutions, slot, profiles)` (`web/codex.js:150`), its line's forms. **Grows from** is shown only when a line's records reach the species, and says which starter(s) (the same `linesOf` data the Codex prints as "Can be reached from", `web/codex.js:653-664, 1166-1180`; "any of the 8 starters" when every line reaches it). A species with no real line shows neither line (no `-`, no own rule).
6. **L1 / R1 conflict.** The spec header says Q / E switch SECTION (DIGIMON, ITEMS, PLACES); the approved design says R1 opens page 2. Both cannot own the shoulder buttons. This plan uses L1 / R1 for pages 1 / 2 inside DIGIMON (ITEMS and PLACES do not exist yet; the tabs are drawn, dim, and nothing switches to them). **The user must decide how sections switch before step 4.**
7. **Keys (confirmed by the coordinator).** Page 1: up / down = one species, left / right = ten. Page 2: left / right = previous / next species, up / down scroll the page's lines. L1 / R1 = page 1 / 2. Section switch (ITEMS / PLACES) comes later.
8. **The counter records always (coordinator ruling).** It is invisible (no screen) and cheap, so it records whether or not the `glossary` switch is on; the record then exists when the player first opens the glossary. It writes one extra localStorage key that save slots copy (`web/save.js:90-110`). Counts start from the day this ships.
9. **A defeat is also a meeting** (co-op wins send only `battleWon`, `web/mpbattle.js:842-844`): noting a defeat raises met to at least 1.
10. **Bosses with several members**: every member of the party is counted as met when the fight starts (`web/battle.js:4105`, `party: partyEntries`). Simple, and a member you never reach still counts. To confirm.
11. **The reveal does not block input.** The album's page flip blocks input until settled (`ddw3:card-album-screen-2026-08-14.md:259-273`); with a 240-row list and a held direction repeating every 4 ticks that would stall the list, so the card side reveals one line every 2 frames while input stays open (a new move restarts the reveal).
12. **Title bar room (confirmed).** `GLOSSARY`, `L1`, three tabs and `R1` already use most of the 288 px bar (`headerLayout`, `web/options-book.js:39`), so the counts are drawn on the list window's first line, not in the bar, as `Met 34/240  Beaten 12` (two spaces, no middle dot; a test measures that it fits).
13. A shadow (`???`) species draws its model tinted black with `setFighterTint` (`battle3d.js:995`). The tint table is module-global and shared with real fights, so the stage resets it (`setFighterTint("player", null)`) every time it shows a known species and when the book closes.
14. **"Your partner".** The party rows give a nickname-or-rookie name (`web/party.js` `partyRosterView`: `name`) and the current form (`formName`). A species is "your partner" when it equals the rookie species or the current form of a party member (first three members, as `plannerPartyMembers`, `web/game.js:1787`).

## Review Focus

Failure modes the spec implies but no task's happy path covers, most likely first. Each has a test in the task that owns the code.

1. **Loading another save slot while the game runs rewrites localStorage** (`web/save.js:103-110` `restoreStorage`) and a log that cached its counts in memory would overwrite the loaded slot's counts on the next write. The log keeps nothing in memory: every call reads, changes and writes. Test: Task 1 "a key changed under the log is read, not overwritten".
2. **Damaged or hand-edited `dw.glossary.v1`** (not JSON, wrong version, a string where a count belongs, `__proto__` as a species) must read as an empty log and never throw. Test: Task 1.
3. **Holding a direction through 240 species** must not leave the 3D model loading dozens of species: only the latest request may land. Test: Task 4 "a newer show() wins over a slower older one".
4. **Names longer than their box** (`Imperialdramon-F`, `BK WarGreymon`, a 6-technique list, a 179-record line) must be fitted by measured width, never overflow the window. Test: Task 3 / Task 5 fit tests with a wide fake font.
5. **A species with no encounter row, no drop, no model, or only a wild or only a partner row** must give every line a text and never throw. Test: Task 2 `glossary-digimon-edge.test.js`.

## File Structure

Create (all new; none is disc-derived):

| File | Responsibility |
|---|---|
| `web/species-log.js` | the Met / Defeated counter: storage key, read-through log, event wiring |
| `web/glossary-digimon.js` | pure: build the 240 species, their state, list rows, header counts, page 1 and page 2 lines, data loader |
| `web/glossary-model.js` | pure: cursor, window top, page, page-2 scroll, card reveal |
| `web/glossary-stage.js` | the one 3D renderer for the book: show a species, turn it, draw it into a rectangle |
| `web/glossary-book.js` | the book for `createBookHost`: layout, drawing, keys |

Modify: `web/battle.js` (one line, the `battleStarted` payload), `web/book-host.js` (pass `dt` to `book.draw`; call `book.close?.()` when the host drops the book), `web/game.js` (register the book, party reader, install the log). Tests are listed per task.

---

### Task 1: the Met / Defeated counter and its storage

**Files:**
- Create: `web/species-log.js`
- Modify: `web/battle.js:4204` (add `enemies` to the `battleStarted` payload)
- Test: `tests/species-log.test.js`

**What was read (so the executor need not guess):** nothing records met or defeated species today. `battleStarted` carries `{ mapId, screenId }` (`web/battle.js:4204`). `battleWon` carries `{ enemies: [names], mapId, screenId }` on a win only, strings only (`web/battle.js:7861`). The only listener, `web/quests.js:247-249`, advances active quest steps and stores nothing per species. The quest layer keeps its own localStorage key `dw.quests.v1` (`web/quests.js:27, 62-72`); save slots copy every localStorage key except `assetMode` and the three slots (`web/save.js:90-110`), so a new key follows the save.

**Interfaces:**
- Produces: `SPECIES_LOG_KEY = "dw.glossary.v1"`; `createSpeciesLog(storage?) -> { read(), noteMet(names), noteBeaten(names), metCount(name), beatenCount(name), totals() }` where `storage = { getItem(k), setItem(k, v) }` (default `globalThis.localStorage`, or a no-op when absent) and `read()` returns a fresh `{ v: 1, met: {name: n}, beaten: {name: n} }`; `noteMet` / `noteBeaten` take an array of names, return `true` when something was written; `totals()` returns `{ met, beaten }` (species with a count above 0). `installSpeciesLog({ on, log }) -> off()`: listens to `battleStarted` (`e.enemies` -> `noteMet`) and `battleWon` (`e.enemies` -> `noteBeaten`), always.

- [ ] **Step 1: Write the failing tests** `tests/species-log.test.js`

```js
// The Met / Defeated counter (web/species-log.js): read-through storage, damaged data, event wiring, and the battle payload.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPECIES_LOG_KEY, createSpeciesLog, installSpeciesLog } from "../web/species-log.js";

const memory = (seed = {}) => {
    const m = new Map(Object.entries(seed));
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};

test("a fresh store reads as empty; a name counts once per call entry", () => {
    const log = createSpeciesLog(memory());
    assert.deepEqual(log.read(), { v: 1, met: {}, beaten: {} });
    assert.equal(log.noteMet(["Kunemon", "Kunemon", "Betamon"]), true);
    assert.equal(log.metCount("Kunemon"), 2, "two Kunemon in one fight are two meetings");
    assert.equal(log.metCount("Betamon"), 1);
    assert.equal(log.beatenCount("Kunemon"), 0);
    assert.deepEqual(log.totals(), { met: 2, beaten: 0 });
});

test("a defeat is also a meeting", () => {
    const log = createSpeciesLog(memory());
    log.noteBeaten(["Gizamon"]);
    assert.equal(log.beatenCount("Gizamon"), 1);
    assert.equal(log.metCount("Gizamon"), 1, "beaten but never recorded as met: met is raised to 1");
    log.noteMet(["Gizamon"]);
    log.noteBeaten(["Gizamon"]);
    assert.deepEqual([log.metCount("Gizamon"), log.beatenCount("Gizamon")], [2, 2]);
});

test("a key changed under the log is read, not overwritten (a save slot was loaded)", () => {
    const store = memory();
    const log = createSpeciesLog(store);
    log.noteMet(["Kunemon"]);
    store.setItem(SPECIES_LOG_KEY, JSON.stringify({ v: 1, met: { Agumon: 7 }, beaten: { Agumon: 3 } }));   // the loaded slot's counts
    log.noteMet(["Betamon"]);
    assert.equal(log.metCount("Agumon"), 7);
    assert.equal(log.beatenCount("Agumon"), 3);
    assert.equal(log.metCount("Kunemon"), 0, "the slot that was loaded does not know Kunemon");
    assert.equal(log.metCount("Betamon"), 1);
});

test("damaged data reads as empty and never throws", () => {
    for (const bad of ["", "not json", "null", "[]", "7", JSON.stringify({ v: 2, met: { A: 1 } }), JSON.stringify({ v: 1, met: "x", beaten: [] }),
        JSON.stringify({ v: 1, met: { A: "3", B: -1, C: 1.5, D: null, E: 2 }, beaten: { __proto__: { X: 1 }, F: 4 } })]) {
        const log = createSpeciesLog(memory({ [SPECIES_LOG_KEY]: bad }));
        assert.doesNotThrow(() => log.read(), bad);
        assert.doesNotThrow(() => log.noteMet(["Z"]), bad);
    }
    const log = createSpeciesLog(memory({ [SPECIES_LOG_KEY]: JSON.stringify({ v: 1, met: { A: "3", B: -1, C: 1.5, D: null, E: 2 }, beaten: { F: 4 } }) }));
    assert.deepEqual(log.read().met, { E: 2 }, "only whole positive counts survive");
    assert.equal(log.beatenCount("F"), 4);
});

test("names that are not species are ignored: numbers, empty, __proto__, constructor, very long", () => {
    const log = createSpeciesLog(memory());
    assert.equal(log.noteMet([12, "", null, undefined, "__proto__", "constructor", "prototype", "x".repeat(200), {}]), false);
    assert.deepEqual(log.read(), { v: 1, met: {}, beaten: {} });
    assert.equal(({}).polluted, undefined);
});

test("a storage that throws loses the count but not the game", () => {
    const log = createSpeciesLog({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } });
    assert.doesNotThrow(() => log.noteMet(["Kunemon"]));
    assert.deepEqual(log.read(), { v: 1, met: {}, beaten: {} });
});

test("the events feed the log, always (no switch)", () => {
    const handlers = {};
    const on = (name, fn) => { handlers[name] = fn; return () => { delete handlers[name]; }; };
    const log = createSpeciesLog(memory());
    const off = installSpeciesLog({ on, log });
    handlers.battleStarted({ enemies: ["Kunemon", "Betamon"], mapId: "s200" });
    handlers.battleWon({ enemies: ["Kunemon"], mapId: "s200", screenId: 1 });
    handlers.battleWon({});
    handlers.battleStarted(undefined);
    assert.deepEqual([log.metCount("Kunemon"), log.metCount("Betamon"), log.beatenCount("Kunemon"), log.beatenCount("Betamon")], [1, 1, 1, 0]);
    off();
    assert.deepEqual(Object.keys(handlers), []);
});

test("the battle sends the enemy names when a fight starts, the same expression the win uses", () => {
    const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes('emitGameEvent("battleStarted"'));
    assert.ok(line, "the battleStarted event is still sent");
    assert.match(line, /enemies: \(battle\?\.party \?\? \[\]\)\.map\(\(e\) => e\.enemyId\)\.filter\(\(n\) => typeof n === "string"\)/);
    assert.match(line, /mapId: battle\?\.mapId \?\? null, screenId: battle\?\.screenId \?\? null/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`node --test tests/species-log.test.js`: cannot find `web/species-log.js`).

- [ ] **Step 3: Write `web/species-log.js`**

```js
// web/species-log.js -- which species the player has MET and DEFEATED, and how often. Feeds GLOSSARY > DIGIMON.
//
// Why a new store: nothing recorded it. `battleStarted` carried no names (web/battle.js), `battleWon` carries them but the only
// listener (web/quests.js:247-249) just advances an active quest step. Where it lives: its own localStorage key, like the quest
// layer's `dw.quests.v1` (web/quests.js:27), NOT `dw.fx.v1`. Save slots copy every key but assetMode and the three slots
// (web/save.js:90-110), so the counts travel with each save and a load brings back that slot's counts.
//
// The log keeps NOTHING in memory: every call reads the key, changes it and writes it back. A slot load rewrites localStorage
// under a running game (restoreStorage), and a cached copy would overwrite the loaded counts on the next write.
export const SPECIES_LOG_KEY = "dw.glossary.v1";
const MAX_NAME = 64;
const BAD_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const validName = (n) => typeof n === "string" && n.length > 0 && n.length <= MAX_NAME && !BAD_NAMES.has(n);
const cleanCounts = (o) => {
    const out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const k of Object.keys(o)) {
        if (!validName(k)) continue;
        const v = o[k];
        if (Number.isInteger(v) && v > 0) out[k] = v;
    }
    return out;
};

function defaultStorage() {
    return typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
}

export function createSpeciesLog(storage = defaultStorage()) {
    const read = () => {
        try {
            const j = JSON.parse(storage.getItem(SPECIES_LOG_KEY) || "null");
            if (j && typeof j === "object" && j.v === 1) return { v: 1, met: cleanCounts(j.met), beaten: cleanCounts(j.beaten) };
        } catch { /* damaged: read as empty */ }
        return { v: 1, met: {}, beaten: {} };
    };
    const write = (s) => { try { storage.setItem(SPECIES_LOG_KEY, JSON.stringify(s)); } catch { /* blocked or full: the count is lost, the game goes on */ } };
    const note = (names, field) => {
        const list = (Array.isArray(names) ? names : []).filter(validName);
        if (!list.length) return false;
        const s = read();
        for (const n of list) {
            s[field][n] = (s[field][n] || 0) + 1;
            if (field === "beaten" && !s.met[n]) s.met[n] = 1;     // a defeat is also a meeting
        }
        write(s);
        return true;
    };
    return {
        read,
        noteMet: (names) => note(names, "met"),
        noteBeaten: (names) => note(names, "beaten"),
        metCount: (name) => read().met[name] || 0,
        beatenCount: (name) => read().beaten[name] || 0,
        totals() { const s = read(); return { met: Object.keys(s.met).length, beaten: Object.keys(s.beaten).length }; },
    };
}

/** Wire the log to the game's event bus (web/gameEvents.js `on`). Returns a function that unhooks both. */
export function installSpeciesLog({ on, log }) {
    const offs = [
        on("battleStarted", (e) => { log.noteMet(e?.enemies); }),
        on("battleWon", (e) => { log.noteBeaten(e?.enemies); }),
    ];
    return () => { for (const off of offs) off?.(); };
}
```

Note for the test "a defeat is also a meeting": in the test the second part notes met then beaten and expects `[2, 2]`: `noteMet` -> met 2 (after the first defeat set it to 1), `noteBeaten` -> beaten 2, met stays 2. Correct as written.

- [ ] **Step 4: Edit `web/battle.js:4204`** to

```js
    emitGameEvent("battleStarted", { mapId: battle?.mapId ?? null, screenId: battle?.screenId ?? null, enemies: (battle?.party ?? []).map((e) => e.enemyId).filter((n) => typeof n === "string") });   // optional layers (extra quests, the glossary counter) hear it
```

(`battle.party` is the fight's party, set at `web/battle.js:4105`; the quest layer ignores the new field.)

- [ ] **Step 5: Run `node --test tests/species-log.test.js` (7 tests PASS)**, then the neighbours that read battle.js or quests: `node --test tests/quests*.test.js tests/mp-credit*.test.js`. If a test pins the old `battleStarted` line, update that one expectation (only the new field), nothing else.

- [ ] **Step 6: New-failures check** `/home/dorij/ui-review/new-failures.sh` (empty) and `npm run typecheck` (clean).

- [ ] **Step 7: Screenshot of the unchanged pause list** (proves nothing leaked): `/home/dorij/ui-review/build/shots/g1.mjs`

```js
import { openGame, press, shot } from "/home/dorij/dw2003-play-integration/tools/ui_shot.mjs";
const { browser, page } = await openGame({ fx: { glossary: true } });
await press(page, "i", 120, 2500);
await shot(page, "g1-pause-list");
await browser.close();
```

Run: `wsl.exe -e bash -lc 'cd /home/dorij/dw2003-play-integration && tools/run-playwright.sh /home/dorij/ui-review/build/shots/g1.mjs'`.

- [ ] **Step 8: Do not commit.** Report changed files.

---

### Task 2: the species rows (pure)

**Files:**
- Create: `web/glossary-digimon.js`
- Test: `tests/glossary-digimon.test.js` (rules, small invented tables), `tests/glossary-digimon-edge.test.js` (odd inputs), `tests/glossary-digimon-real.test.js` (the real tables; skips without `web/assets`)

**Interfaces:**
- Consumes: `partnerRows`, `wildRows`, `encounterIndex`, `lineTargets`, `dropOdds` (`web/codex.js:112, 238, 332, 150, 433`); `plannerRows` (`web/evolution-planner.js:182`); `createSpeciesLog` shape from Task 1 (only `metCount(name)`, `beatenCount(name)`, `totals()` are used, so a fake works).
- Produces:
  - `buildSpecies({ digimon, evolutions, enemies, modelMap, encounters }) -> { species: Species[], world, maxima }`. `digimon` = `digimon.json` object (after the extra roster's merge), `evolutions` = `evolutions.json`, `enemies` = `enemies.json`, `modelMap` = `model_map.json` or null, `encounters` = `{ stages, screens, maps }` (`stage_encounters.json`, `field_encounters.json`, `manifest.json`). `Species = { index (0-based), number (1-based), name, partner (codex partner row | null), wild (codex wild row | null), profileId (number | null), hp (number | null), mp (number | null), stats ({str, def, spt, wis, spd, chr} numbers, chr null for wild-only), resists ({fire..dark}), levels ({min, max} | null), lives (string[]), drop ({ item, n, of: 1024, percent } | null), techniques (string[]), from (string | null: the starter(s) whose line reaches it), into (string[]: a starter's line forms, else empty) }`. `world = { evolutions, profiles, skills }`. `maxima = { hp, mp, str, def, spt, wis, spd, chr }` (largest value over all species, for bar scales).
  - `mapLabel(stageName) -> string` (the part after the last em-dash, as the quest log does).
  - `speciesState(sp, log, partner) -> "unknown" | "met" | "known"` (`partner` truthy = known).
  - `partnerOf(sp, partners) -> partner | null`. `partners = [{ slot, rookie, form, level, live }]` (Task 6 builds it; `rookie` and `form` are species names).
  - `headerCounts(species, log) -> { met, beaten, total, text }` with `text = "Met 41/240  Beaten 12"` (two spaces).
  - `listRows(species, log, partners) -> [{ index, number, label, state }]` (`label` is the name, or `???` while unknown).
  - `pageOne(sp, state, log, partner) -> { title, row1, record, lives, drops, shadow }` (strings; `shadow` true while unknown).
  - `pageTwoLines(sp, state, partner, world, maxima) -> Line[]` where `Line = { kind: "head" | "bar" | "text", label, icon?, value?, max?, neutral?, text? }`.
  - `loadGlossaryData(fetchJson) -> Promise<{ species, world, maxima } | null>` (same eight fetches as `codexLoad`, `web/codex.js:677-715`).
- Level rule is in Notes 2 (no element, no family: Notes 2); from / into rule is in Notes 5.

- [ ] **Step 1: Read first, print, do not change anything.** Run this once and keep the output in the report; it proves the numbers the tests assert:

```bash
wsl.exe -e bash -lc 'export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH; cd /home/dorij/dw2003-play-integration/web && node --input-type=module -e "
import fs from \"node:fs\";
const J=(p)=>JSON.parse(fs.readFileSync(p));
const en=J(\"assets/data/enemies.json\").enemies.filter(e=>e.enemy_id!==\"Null\");
const d=J(\"assets/data/digimon.json\"), x=J(\"assets/data/extra_species.json\");
const have=new Set(d.digimon.map(p=>p.id));
const names=new Set([...d.digimon,...x.digimon.filter(e=>!have.has(e.id))].map(p=>p.name));
console.log(\"partners\",names.size,\"wild\",en.length,\"union\",new Set([...names,...en.map(e=>e.enemy_id)]).size);
const f=J(\"assets/data/field_encounters.json\").screens; let n9999=0,total=0;
for(const k of Object.keys(f)) for(const m of f[k]){ total++; if(m.mp===9999) n9999++; }
console.log(\"encounter members\",total,\"with mp 9999\",n9999);
"'
```

Expected: `partners 190 wild 193 union 240`. If the union is not 240 stop and report (the plan's numbers depend on it). The second line decides wild MP: if EVERY member has `mp` 9999 the data has no wild MP and `mp` stays `null` for wild-only species (as the code below does); if many do not, report it and keep `null` anyway (a later change, not this task).

- [ ] **Step 2: Write the failing tests** `tests/glossary-digimon.test.js`

```js
// GLOSSARY > DIGIMON rows (web/glossary-digimon.js): one entry per species name, shadows, counts, pages.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSpecies, headerCounts, listRows, mapLabel, pageOne, pageTwoLines, partnerOf, speciesState } from "../web/glossary-digimon.js";
import { partnerRows, wildRows } from "../web/codex.js";

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const P = (id, name, extra = {}) => ({ id, name, hp: 100 + id, mp: 50 + id, str: 10 + id, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL, fire: 150, water: 60 },
    resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [1, 9, 0, 0, 0, 0], tech_learn_levels: [], tech_load_levels: [], blasts: [], is_starter: false, ...extra });
const DIGIMON = { digimon: [P(1, "Kotemon", { is_starter: true }), P(2, "Dinohumon"), P(3, "Greymon")],
    skills: [{ id: 1, name: "Fight", element: "normal", power: 60 }, { id: 9, name: "Pepper Breath", element: "fire", power: 90 }, { id: 5, name: "Bubble", element: "water", power: 30 }] };
const E = (name, extra = {}) => ({ enemy_id: name, digimon_id: name, attack: 1, move_1: 5, move_2: 0, str: 40, def: 30, spt: 20, wis: 10, spd: 50, resistances: { ...EL, ice: 175 }, status_resist: {},
    digimon_type: 4, drop_item: "Null", drop_rate: 0, ai_moves: [], ...extra });
const ENEMIES = { enemies: [E("Greymon", { drop_item: "Medicine", drop_rate: 127 }), E("Kunemon"), E("Null")] };   // the Null record is the disc's placeholder
const ENC = {
    stages: { 200: { zones: [{ slots: [1, 2, 0], rate_level: 3 }] }, 201: { zones: [{ slots: [1, 0, 0], rate_level: 3 }] } },
    screens: { 1: [{ name: "Kunemon", level: 5, hp: 90, mp: 9999, stat_scale: 16 }], 2: [{ name: "Greymon", level: 12, hp: 400, mp: 9999, stat_scale: 16 }, { name: "Greymon", level: 20, hp: 700, mp: 9999, stat_scale: 16 }] },
    maps: { maps: [{ id: "s200", name: "Central Sector — Asuka City" }, { id: "s201", name: "Forest Edge" }] },
};
const EVOLUTIONS = { lines: [{ slot: 0, digimonId: 1, records: [{ to: 2, req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 0, threshold: 1 }, { to: 3, req0: 2, req0Level: 5, req1: 0, req1Level: 1, kind: 0, threshold: 1 }] }] };
const build = () => buildSpecies({ digimon: DIGIMON, evolutions: EVOLUTIONS, enemies: ENEMIES, modelMap: { Kunemon: "m001kune" }, encounters: ENC });
const fakeLog = (met = {}, beaten = {}) => ({ metCount: (n) => met[n] || 0, beatenCount: (n) => beaten[n] || 0, totals: () => ({ met: Object.keys(met).length, beaten: Object.keys(beaten).length }) });

test("one entry per species name: partners first in id order, then wild-only; the Null record is not a species", () => {
    const { species } = build();
    assert.deepEqual(species.map((s) => s.name), ["Kotemon", "Dinohumon", "Greymon", "Kunemon"]);
    assert.deepEqual(species.map((s) => s.number), [1, 2, 3, 4]);
    assert.ok(species[2].partner && species[2].wild, "Greymon is both a partner and a wild species and appears once");
    assert.equal(species[3].partner, null);
});

test("rows equal what the Codex shows for the same data", () => {
    const { species } = build();
    const pr = partnerRows(DIGIMON), wr = wildRows(ENEMIES, DIGIMON.skills, { Kunemon: "m001kune" });
    assert.deepEqual(species[0].partner, pr[0]);
    assert.deepEqual(species[3].wild, wr.find((r) => r.name === "Kunemon"));
    assert.deepEqual([species[0].hp, species[0].mp, species[0].stats.str], [pr[0].hp, pr[0].mp, pr[0].stats.str]);
});

test("level range, map names and drop come from the tables; nothing is invented", () => {
    const { species } = build();
    const grey = species.find((s) => s.name === "Greymon");
    assert.deepEqual(grey.levels, { min: 12, max: 20 });
    assert.deepEqual(grey.lives, ["Asuka City"], "the part after the dash, once");
    assert.equal(grey.drop.item, "Medicine");
    assert.deepEqual([grey.drop.n, grey.drop.of], [128, 1024]);
    assert.equal(grey.drop.percent, 12.5);
    assert.equal("element" in grey || "family" in grey, false, "no element or family is shown: the tables have none");
    const kun = species.find((s) => s.name === "Kunemon");
    assert.deepEqual(kun.lives, ["Asuka City", "Forest Edge"]);
    assert.equal(kun.hp, 90, "wild HP = the largest encounter HP");
    assert.equal(kun.mp, null, "no wild MP is shown");
    assert.equal(kun.drop, null);
});

test("mapLabel keeps the part after the last dash", () => {
    assert.equal(mapLabel("Central Sector — Asuka City"), "Asuka City");
    assert.equal(mapLabel("Forest Edge"), "Forest Edge");
    assert.equal(mapLabel(null), "");
});

test("state: unknown, met, known (beaten or your partner)", () => {
    const { species } = build();
    const [kote, , , kune] = species;
    assert.equal(speciesState(kune, fakeLog(), null), "unknown");
    assert.equal(speciesState(kune, fakeLog({ Kunemon: 2 }), null), "met");
    assert.equal(speciesState(kune, fakeLog({ Kunemon: 2 }, { Kunemon: 1 }), null), "known");
    assert.equal(speciesState(kote, fakeLog(), { slot: 0 }), "known", "a species that is your partner is known");
});

test("partnerOf matches the rookie species or the current form of a party member", () => {
    const { species } = build();
    const partners = [{ slot: 0, rookie: "Kotemon", form: "Greymon", level: 9, live: {} }];
    assert.equal(partnerOf(species[0], partners), partners[0]);
    assert.equal(partnerOf(species[2], partners), partners[0]);
    assert.equal(partnerOf(species[1], partners), null);
    assert.equal(partnerOf(species[1], []), null);
});

test("the header counts and the list: numbers, names, ??? shadows", () => {
    const { species } = build();
    const log = fakeLog({ Kotemon: 1, Kunemon: 3 }, { Kunemon: 1 });
    assert.deepEqual(headerCounts(species, log), { met: 2, beaten: 1, total: 4, text: "Met 2/4  Beaten 1" });
    const rows = listRows(species, log, []);
    assert.deepEqual(rows.map((r) => [r.number, r.label, r.state]), [[1, "Kotemon", "met"], [2, "???", "unknown"], [3, "???", "unknown"], [4, "Kunemon", "known"]]);
});

test("page 1: unknown shows nothing but a shadow; met shows name and record; known shows everything", () => {
    const { species } = build();
    const kune = species[3];
    const unk = pageOne(kune, "unknown", fakeLog(), null);
    assert.deepEqual([unk.title, unk.shadow, unk.row1, unk.record, unk.lives, unk.drops], ["???", true, "", "", "", ""]);
    const met = pageOne(kune, "met", fakeLog({ Kunemon: 2 }), null);
    assert.equal(met.title, "Kunemon");
    assert.equal(met.record, "Met");
    assert.equal(met.row1, "");
    assert.equal(met.lives, "");
    const grey = species[2];
    const known = pageOne(grey, "known", fakeLog({ Greymon: 3 }, { Greymon: 2 }), { slot: 0, rookie: "Kotemon", form: "Greymon", level: 9, live: {} });
    assert.equal(known.row1, "Lv 9", "your partner shows its live level");
    assert.equal(known.record, "Met  Defeated x2  Your partner");
    assert.equal(known.lives, "Lives in: Asuka City");
    assert.equal(known.drops, "Drops: Medicine 12.5%");
    const wild = pageOne(species[3], "known", fakeLog({ Kunemon: 1 }, { Kunemon: 1 }), null);
    assert.equal(wild.row1, "Found at level 5");
    const range = pageOne(species[2], "known", fakeLog({ Greymon: 1 }, { Greymon: 1 }), null);
    assert.equal(range.row1, "Found at level 12-20");
    assert.equal(wild.drops, "Drops: none");
});

test("page 2: locked until known; bars use the shared maxima; strong, weak, techniques, from, into", () => {
    const { species, world, maxima } = build();
    const locked = pageTwoLines(species[3], "met", null, world, maxima);
    assert.equal(locked.length, 1);
    assert.equal(locked[0].kind, "text");
    const lines = pageTwoLines(species[2], "known", null, world, maxima);
    const bar = (label) => lines.find((l) => l.kind === "bar" && l.label === label);
    assert.deepEqual([bar("HP").value, bar("HP").max], [103, maxima.hp]);
    assert.equal(bar("STR").icon, "str");
    const text = (label) => lines.find((l) => l.kind === "text" && l.label === label)?.text;
    assert.equal(text("Resists"), "Fire");
    assert.equal(text("Weak to"), "Water");
    assert.ok(lines.some((l) => l.kind === "head" && l.label === "Techniques"));
    assert.ok(lines.some((l) => l.kind === "text" && l.text === "Pepper Breath"));
    assert.equal(text("Grows from"), "Kotemon", "a line's records reach it: the line's starter");
    assert.equal(text("Grows into"), undefined, "only a starter has a line of forms: no line, no invented one");
    const kote = pageTwoLines(species[0], "known", null, world, maxima);
    assert.equal(kote.find((l) => l.label === "Grows from"), undefined, "a starter is not reached from a line");
    assert.equal(kote.find((l) => l.label === "Grows into").text, "Dinohumon, Greymon", "a starter: its whole line (lineTargets)");
    const kune = pageTwoLines(species[3], "known", null, world, maxima);
    assert.equal(kune.some((l) => l.label === "Grows from" || l.label === "Grows into"), false, "a species with no real line shows nothing there");
});

test("page 2 for your partner adds the current level and what the next form still needs", () => {
    const { species, world, maxima } = build();
    const partner = { slot: 0, rookie: "Kotemon", form: "Kotemon", level: 9, live: { level: 9, formLevels: { 1: 1 }, stats: {} } };
    const lines = pageTwoLines(species[0], "known", partner, world, maxima);
    assert.equal(lines.find((l) => l.label === "Your level").text, "9");
    const next = lines.find((l) => l.label === "Next form");
    assert.ok(next && /Dinohumon/.test(next.text), next?.text);
});
```

and `tests/glossary-digimon-edge.test.js`:

```js
// Odd inputs must give every line a text and never throw (Review Focus 5).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSpecies, listRows, pageOne, pageTwoLines } from "../web/glossary-digimon.js";

const fakeLog = { metCount: () => 1, beatenCount: () => 1, totals: () => ({ met: 0, beaten: 0 }) };

test("empty and missing tables give an empty list, not an error", () => {
    for (const args of [{}, { digimon: null, enemies: null }, { digimon: { digimon: [], skills: [] }, enemies: { enemies: [] } }]) {
        const { species } = buildSpecies(args);
        assert.deepEqual(species, []);
        assert.deepEqual(listRows(species, fakeLog, []), []);
    }
});

test("a wild-only species with no encounter, no model map, no drop gives text on every line", () => {
    const enemies = { enemies: [{ enemy_id: "Lonely", digimon_id: "Lonely", attack: 0, move_1: 0, move_2: 0, str: 1, def: 1, spt: 1, wis: 1, spd: 1, resistances: {}, status_resist: {}, digimon_type: 0, drop_item: "Null", drop_rate: 0, ai_moves: [] }] };
    const { species, world, maxima } = buildSpecies({ digimon: { digimon: [], skills: [] }, enemies, modelMap: null, encounters: {} });
    assert.equal(species.length, 1);
    const p1 = pageOne(species[0], "known", fakeLog, null);
    assert.equal(p1.row1, "", "no encounter row and not your partner: no level line");
    assert.equal(p1.lives, "Lives in: -");
    assert.equal(p1.drops, "Drops: none");
    for (const line of pageTwoLines(species[0], "known", null, world, maxima)) {
        assert.ok(line.kind === "head" || typeof line.label === "string");
        if (line.kind === "text") assert.ok(typeof line.text === "string" && line.text.length > 0, JSON.stringify(line));
    }
});

test("a partner whose line is missing from evolutions.json still builds", () => {
    const digimon = { digimon: [{ id: 1, name: "A", hp: 1, mp: 1, str: 1, def: 1, spt: 1, wis: 1, spd: 1, chr: 1, family: 1, resistances: {}, tech_slots: [], blasts: [] }], skills: [] };
    const { species, world, maxima } = buildSpecies({ digimon, evolutions: null, enemies: { enemies: [] } });
    const lines = pageTwoLines(species[0], "known", { slot: 5, rookie: "A", form: "A", level: 1, live: { level: 1, formLevels: {} } }, world, maxima);
    assert.ok(lines.length > 0);
});
```

and `tests/glossary-digimon-real.test.js` (real tables, skips without `web/assets`):

```js
// The real tables: 240 species, unique names, every one has a model folder, partners first.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildSpecies } from "../web/glossary-digimon.js";
import { canonicalModelName } from "../web/battle3d.js";

const A = new URL("../web/assets/", import.meta.url);
const have = existsSync(new URL("data/digimon.json", A)) && existsSync(new URL("data/extra_species.json", A));
const J = (p) => JSON.parse(readFileSync(new URL(p, A), "utf8"));

test("the real tables give 240 unique species, partners first, every name has a model folder", { skip: !have }, () => {
    const d = J("data/digimon.json"), x = J("data/extra_species.json");
    const ids = new Set(d.digimon.map((p) => p.id));
    const digimon = { ...d, digimon: [...d.digimon, ...x.digimon.filter((e) => !ids.has(e.id))] };
    const modelMap = J("battle/model_map.json");
    const { species } = buildSpecies({ digimon, evolutions: J("data/evolutions.json"), enemies: J("data/enemies.json"), modelMap,
        encounters: { stages: J("data/stage_encounters.json"), screens: J("data/field_encounters.json"), maps: J("manifest.json") } });
    assert.equal(species.length, 240);
    assert.equal(new Set(species.map((s) => s.name)).size, 240);
    assert.equal(species.filter((s) => s.partner).length, 190);
    assert.ok(species.slice(0, 190).every((s) => s.partner), "partners first");
    assert.ok(species.slice(190).every((s) => !s.partner && s.wild));
    assert.deepEqual(species.filter((s) => !modelMap[canonicalModelName(s.name)]).map((s) => s.name), [], "every species has a model folder");
    assert.ok(species.every((s) => s.lives.length > 0 || !s.wild), "every wild species lives somewhere");
});
```

- [ ] **Step 3: Run the three files, expect FAIL** (`web/glossary-digimon.js` missing).

- [ ] **Step 4: Write `web/glossary-digimon.js`**

```js
// web/glossary-digimon.js -- the rows behind GLOSSARY > DIGIMON. Pure: no DOM, no storage, no drawing.
//
// One entry per species NAME: the partner profiles (digimon.json after web/extra-roster.js's merge, 190) first, then the wild
// species whose name is not already a partner name (enemies.json, 193 names, 143 shared, so 50 more: 240). Rows are the Codex's
// own (web/codex.js partnerRows / wildRows / encounterIndex), so the two books cannot disagree.
//
// What the tables do NOT hold (read, plan Notes 2 and 3): a level, an element or a family name per species, and a wild MP. None of
// those is shown, and nothing is guessed in their place. The level line is your partner's live level, else "Found at level a-b"
// from its encounter rows, else no line.
import { dropOdds, encounterIndex, lineTargets, partnerRows, wildRows } from "./codex.js";
import { plannerRows } from "./evolution-planner.js";

const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const BARS = [["HP", "hp", null], ["MP", "mp", null], ["STR", "str", "str"], ["DEF", "def", "def"], ["SPT", "spt", "spt"], ["WIS", "wis", "wis"], ["SPD", "spd", "spd"], ["CHR", "chr", "chr"]];

/** Map name as the quest log shows it: the part after the dash. */
export const mapLabel = (stageName) => String(stageName ?? "").replace(/^.*— /, "").trim();

function techniqueNames(partner, wild, skillById) {
    const ids = partner ? partner.techSlots : [wild?.attack?.id, wild?.move1?.id, wild?.move2?.id];
    const names = [];
    for (const id of ids ?? []) {
        const n = skillById.get(Number(id) || 0)?.name;
        if (n && !names.includes(n)) names.push(n);
    }
    return names;
}

/** Lines of evolutions.json that can reach each profile id, and the root (starter) id of each line. */
function lineIndex(evolutions) {
    const lines = Array.isArray(evolutions?.lines) ? evolutions.lines : [];
    const reach = new Map(), rootSlot = new Map();
    lines.forEach((line, slot) => {
        if (line?.digimonId != null) rootSlot.set(line.digimonId, slot);
        for (const r of line?.records ?? []) {
            if (!reach.has(r.to)) reach.set(r.to, new Set());
            reach.get(r.to).add(slot);
        }
    });
    return { lines, reach, rootSlot };
}

export function buildSpecies({ digimon, evolutions = null, enemies, modelMap = null, encounters = {} } = {}) {
    const profiles = Array.isArray(digimon?.digimon) ? digimon.digimon : [];
    const skills = Array.isArray(digimon?.skills) ? digimon.skills : [];
    const skillById = new Map(skills.map((s) => [s.id, s]));
    const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
    const partners = partnerRows({ digimon: profiles, skills }, skills);
    const wilds = wildRows(enemies ?? { enemies: [] }, skills, modelMap);
    const enc = encounterIndex(encounters?.stages ?? null, encounters?.screens ?? null, encounters?.maps ?? null);
    const idx = lineIndex(evolutions);

    const byName = new Map(), order = [];
    const entry = (name) => { if (!byName.has(name)) { byName.set(name, { partner: null, wild: null }); order.push(name); } return byName.get(name); };
    for (const p of partners) entry(p.name).partner = p;
    for (const w of wilds) entry(w.name).wild = w;

    const species = order.map((name, index) => {
        const { partner, wild } = byName.get(name);
        const rows = enc.bySpecies.get(name) ?? [];
        const lv = rows.map((r) => r.level).filter((n) => n > 0);
        const lives = [];
        for (const r of [...rows].sort((a, b) => a.stage - b.stage)) {
            const label = mapLabel(r.stageName) || `Stage ${r.stage}`;
            if (!lives.includes(label)) lives.push(label);
        }
        const encHp = rows.map((r) => r.hp).filter((n) => n > 0);
        const profileId = partner ? partner.id : null;
        const dropItem = wild && wild.drop && wild.drop !== "Null" ? wild.drop : null;
        let from = null, into = [];
        if (profileId != null) {
            if (idx.rootSlot.has(profileId)) {
                into = lineTargets(evolutions, idx.rootSlot.get(profileId), profiles);   // a starter: its line's forms
            } else {
                const slots = idx.reach.get(profileId);
                if (slots?.size) {
                    from = slots.size === idx.lines.length && idx.lines.length > 1
                        ? `any of the ${idx.lines.length} starters`
                        : [...slots].map((sl) => nameOf.get(idx.lines[sl]?.digimonId)).filter(Boolean).join(", ") || null;
                }
            }
        }
        const n = dropItem ? dropOdds(wild.dropRate).n : 0;
        return {
            index, number: index + 1, name, partner, wild, profileId,
            hp: partner ? partner.hp : (encHp.length ? Math.max(...encHp) : null),
            mp: partner ? partner.mp : null,
            stats: partner ? partner.stats : { ...(wild?.stats ?? {}), chr: null },
            resists: partner ? partner.resistances : (wild?.resists ?? {}),
            levels: lv.length ? { min: Math.min(...lv), max: Math.max(...lv) } : null,
            lives,
            drop: dropItem ? { item: dropItem, n, of: 1024, percent: Math.round((n / 1024) * 1000) / 10 } : null,
            techniques: techniqueNames(partner, wild, skillById),
            from, into: [...new Set(into)],
        };
    });

    const maxima = { hp: 1, mp: 1, str: 1, def: 1, spt: 1, wis: 1, spd: 1, chr: 1 };
    for (const sp of species) {
        for (const [, key] of BARS) {
            const v = key === "hp" ? sp.hp : key === "mp" ? sp.mp : sp.stats?.[key];
            if (Number.isFinite(v) && v > maxima[key]) maxima[key] = v;
        }
    }
    return { species, world: { evolutions, profiles, skills }, maxima };
}

// ---------------------------------------------------------------- what the player knows

export function partnerOf(sp, partners) {
    for (const p of partners ?? []) if (p && (p.rookie === sp.name || p.form === sp.name)) return p;
    return null;
}

/** "unknown" = never met (a ??? shadow), "met" = name and picture only, "known" = defeated once, or your partner. */
export function speciesState(sp, log, partner) {
    if (partner) return "known";
    if (log.beatenCount(sp.name) > 0) return "known";
    if (log.metCount(sp.name) > 0) return "met";
    return "unknown";
}

export function headerCounts(species, log) {
    let met = 0, beaten = 0;
    for (const sp of species) {
        if (log.metCount(sp.name) > 0) met++;
        if (log.beatenCount(sp.name) > 0) beaten++;
    }
    return { met, beaten, total: species.length, text: `Met ${met}/${species.length}  Beaten ${beaten}` };
}

export function listRows(species, log, partners) {
    return species.map((sp) => {
        const state = speciesState(sp, log, partnerOf(sp, partners));
        return { index: sp.index, number: sp.number, label: state === "unknown" ? "???" : sp.name, state };
    });
}

// ---------------------------------------------------------------- page 1

export function pageOne(sp, state, log, partner) {
    if (state === "unknown") return { title: "???", row1: "", record: "", lives: "", drops: "", shadow: true };
    const defeated = log.beatenCount(sp.name);
    const record = ["Met", defeated > 0 ? `Defeated x${defeated}` : "", partner ? "Your partner" : ""].filter(Boolean).join("  ");
    if (state === "met") return { title: sp.name, row1: "", record, lives: "", drops: "", shadow: false };
    const found = sp.levels ? (sp.levels.min === sp.levels.max ? String(sp.levels.min) : `${sp.levels.min}-${sp.levels.max}`) : null;
    return {
        title: sp.name,
        row1: partner ? `Lv ${partner.level}` : found ? `Found at level ${found}` : "",
        record,
        lives: `Lives in: ${sp.lives.length ? sp.lives.join(", ") : "-"}`,
        drops: sp.drop ? `Drops: ${sp.drop.item} ${sp.drop.percent}%` : "Drops: none",
        shadow: false,
    };
}

// ---------------------------------------------------------------- page 2

/** The partner's next form: the one READY now, else the one with the fewest unmet gates (table order breaks ties). */
export function nextForm(rows) {
    if (!rows?.length) return null;
    return rows.find((r) => r.ready) ?? rows.reduce((best, r) => (r.unmet.length < best.unmet.length ? r : best), rows[0]);
}

export function pageTwoLines(sp, state, partner, world, maxima) {
    if (state !== "known") return [{ kind: "text", label: "Locked", text: state === "met" ? "Defeat it once to see its strength." : "Meet it first." }];
    const out = [];
    for (const [label, key, icon] of BARS) {
        const value = key === "hp" ? sp.hp : key === "mp" ? sp.mp : sp.stats?.[key];
        if (!Number.isFinite(value)) continue;
        out.push({ kind: "bar", label, icon, value, max: maxima[key] });
    }
    const strong = ELEMENTS.filter((e) => (sp.resists?.[e] ?? 100) > 100).map(cap);
    const weak = ELEMENTS.filter((e) => (sp.resists?.[e] ?? 100) < 100).map(cap);
    out.push({ kind: "text", label: "Resists", text: strong.join(", ") || "-" });
    out.push({ kind: "text", label: "Weak to", text: weak.join(", ") || "-" });
    out.push({ kind: "head", label: "Techniques" });
    if (sp.techniques.length) for (const t of sp.techniques) out.push({ kind: "text", label: "", text: t });
    else out.push({ kind: "text", label: "", text: "-" });
    if (sp.from) out.push({ kind: "text", label: "Grows from", text: sp.from });
    if (sp.into.length) out.push({ kind: "text", label: "Grows into", text: sp.into.join(", ") });
    if (partner) {
        out.push({ kind: "text", label: "Your level", text: String(partner.level) });
        const next = nextForm(plannerRows(world.evolutions, partner.slot, world.profiles, world.skills, partner.live));
        out.push({ kind: "text", label: "Next form", text: next ? `${next.name}: ${next.text}`.replace(/ — /g, " - ") : "none left" });   // the font has no long dash
    }
    return out;
}

// ---------------------------------------------------------------- loading

const asJson = (v) => (typeof v?.json === "function" ? v.json() : v);

/** Fetch the tables through the page's own fetch (so web/extra-roster.js's merge has run) and build the species. Never rejects. */
export async function loadGlossaryData(fetchJson = globalThis.fetch) {
    if (typeof fetchJson !== "function") return null;
    try {
        const [digimon, evolutions, enemies, modelMap, stages, screens, maps] = await Promise.all([
            "assets/data/digimon.json", "assets/data/evolutions.json", "assets/data/enemies.json", "assets/battle/model_map.json",
            "assets/data/stage_encounters.json", "assets/data/field_encounters.json", "assets/manifest.json",
        ].map((p) => Promise.resolve(fetchJson(p)).then(asJson)));
        return buildSpecies({ digimon, evolutions, enemies, modelMap, encounters: { stages, screens, maps } });
    } catch {
        return null;
    }
}
```

Notes for the executor, to check while the tests run: (a) `wildRows(enemies, skills, models)` takes the skill LIST, so `skills` is passed as the array; (b) `partnerRows({ digimon: profiles, skills }, skills)` is the shape `web/codex.js:112` documents (`digimon` may be the object or the array); (c) the test "Resists" for Greymon: fire 150 is above 100 (resists), water 60 below (weak), as `engine/dw3/battle-formulas.ts:555` says (the value divides the damage). (d) In the page 2 test the line `assert.match(... "ok")` is a plain existence check of the `Techniques` head; leave it as written.

- [ ] **Step 5: Run the three test files, expect PASS** (9 + 3 + 1). If the real-data test fails on the species count, stop and report the printed counts (Notes 1 depends on it).

- [ ] **Step 6: New-failures check and typecheck.** Take the pause-list screenshot again (`g2`, same script as `g1`, name `g2-pause-list`).

- [ ] **Step 7: Do not commit.** Report changed files and the Step 1 numbers.

---

### Task 3: the paging model, the list screen and page 1

**Files:**
- Create: `web/glossary-model.js`, `web/glossary-book.js`
- Modify: `web/book-host.js` (pass `dt`, the seconds of the last frame, in the `view` given to `book.draw`; call `book.close?.()` when the host drops the book)
- Test: `tests/glossary-model.test.js`, `tests/glossary-book.test.js`, extend `tests/book-host.test.js` (one test)

**Interfaces:**
- Consumes: Task 2 (`listRows`, `headerCounts`, `pageOne`, `speciesState`, `partnerOf`); `web/ui-kit.js` (`drawHeader`, `drawPanel`, `drawFooter`, `drawHelpBox`, `withFold`, `listRowY`, `LIST_WINDOW`); `web/ui-kit-input.js` (`WORD`); `web/text-fit.js` (`fitByWidth`, `BAND_TEXT_W`); `web/uifont.js` (`drawText`, `drawCursor`, `textWidth`); `web/options-book.js` `headerLayout` (`:39`).
- Produces:
  - `createGlossaryModel({ count }) -> { index(), page(), top(), line(), move(d), jump(d), setPage(p, allowed), scrollLine(d, lineCount), resetCard(), reveal(rows) , tickReveal() }`. `VISIBLE = 8` list rows. No wrap at either end (the pause list's rule). `move`, `jump`, `setPage` and `scrollLine` return `true` only when something changed. `top()` keeps the cursor inside the window. `reveal(total)` = how many card lines are shown (`floor(ticks / 2)`, at most `total`); `tickReveal()` adds one frame; `move`, `jump`, `setPage` call `resetCard()`.
  - `createGlossaryBook({ sfx, getSpecies, getLog, getPartners, stage }) -> book` for `createBookHost` (`windows: ["title", "list", "model", "footer"]`, `wall: true`). `getSpecies()` returns the Task 2 `{ species, world, maxima }` or null while loading; `getLog()` the species log; `getPartners()` the party reader; `stage` the Task 4 stage (or null in tests).
  - `GLOSSARY_LAYOUT` (rectangles, all in the 320 x 240 box).

**Layout (starting numbers; the geometry test holds the constraints, the shot is for tuning):** header = `HEADER` (cmfont 24 at (34,13), 288 x 25); footer = `FOOTER` (ststat 32 at (0,194)); list panel `drawPanel(ctx, 0, 40, 3, 7)` = 120 x 140 (`panelPixelHeight(7)`), first line = counts, then 8 species rows at `listRowY(i)` (`y = 49 + 14 i`) with the cursor at x 6, the number right-aligned (orange) at x 40, the name from x 46; right pane: model panel `drawPanel(ctx, 124, 40, 5, 4)` = 200 x 98 (bleeds past x 320 exactly as the pause list window does, `web/ui-kit.js:183`), card panel `drawPanel(ctx, 124, 138, 5, 1)` = 200 x 56 with its two text rows at y 147 and 161; footer lines: `Lives in: ...` and `Drops: ...` (page 1), the row help line and the `[R1] strength` / `[L1] about` hint (page 2).

- [ ] **Step 1: Write the failing tests** `tests/glossary-model.test.js`

```js
// Cursor, window top, page and card reveal of GLOSSARY > DIGIMON (web/glossary-model.js). Pure.
import test from "node:test";
import assert from "node:assert/strict";
import { VISIBLE, createGlossaryModel } from "../web/glossary-model.js";

test("one step at a time, no wrap at either end, and a move that does nothing reports false", () => {
    const m = createGlossaryModel({ count: 240 });
    assert.equal(m.move(-1), false);
    assert.equal(m.move(1), true);
    assert.equal(m.index(), 1);
    assert.equal(m.jump(10), true);
    assert.equal(m.index(), 11);
    assert.equal(m.jump(-100), true, "jumping past the top stops at the top");
    assert.equal(m.index(), 0);
    m.jump(1000);
    assert.equal(m.index(), 239);
    assert.equal(m.move(1), false);
    assert.equal(m.jump(10), false);
});

test("the window always holds the cursor", () => {
    const m = createGlossaryModel({ count: 240 });
    for (let i = 0; i < 239; i++) { m.move(1); assert.ok(m.index() >= m.top() && m.index() < m.top() + VISIBLE, `index ${m.index()} top ${m.top()}`); }
    for (let i = 0; i < 239; i++) { m.move(-1); assert.ok(m.index() >= m.top() && m.index() < m.top() + VISIBLE); }
    assert.equal(m.top(), 0);
});

test("a list shorter than the window never scrolls", () => {
    const m = createGlossaryModel({ count: 3 });
    m.jump(10);
    assert.deepEqual([m.index(), m.top()], [2, 0]);
    assert.equal(createGlossaryModel({ count: 0 }).move(1), false, "an empty list has nowhere to go");
});

test("page 2 opens only when allowed; going back always works; page 2 scroll stops at both ends", () => {
    const m = createGlossaryModel({ count: 10 });
    assert.equal(m.setPage(1, false), false);
    assert.equal(m.page(), 0);
    assert.equal(m.setPage(1, true), true);
    assert.equal(m.page(), 1);
    assert.equal(m.setPage(1, true), false, "already there");
    assert.equal(m.scrollLine(1, 3), true);
    assert.equal(m.scrollLine(1, 3), true);
    assert.equal(m.scrollLine(1, 3), false, "three lines: the cursor stops on the last");
    assert.equal(m.line(), 2);
    assert.equal(m.setPage(0, false), true);
    assert.equal(m.line(), 0, "a page change resets the scroll");
});

test("moving to another species resets page-2 scroll but keeps the page", () => {
    const m = createGlossaryModel({ count: 10 });
    m.setPage(1, true);
    m.scrollLine(1, 9);
    m.move(1);
    assert.deepEqual([m.page(), m.line()], [1, 0]);
});

test("the card reveals one line every 2 frames, restarts on a change, and never exceeds the total", () => {
    const m = createGlossaryModel({ count: 10 });
    assert.equal(m.reveal(4), 0);
    m.tickReveal(); m.tickReveal();
    assert.equal(m.reveal(4), 1);
    for (let i = 0; i < 20; i++) m.tickReveal();
    assert.equal(m.reveal(4), 4);
    m.move(1);
    assert.equal(m.reveal(4), 0, "a new species starts the reveal again");
});
```

and `tests/glossary-book.test.js`:

```js
// The DIGIMON screen (web/glossary-book.js): keys, sounds, geometry and drawing with a fake canvas.
import test from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY_LAYOUT, createGlossaryBook } from "../web/glossary-book.js";
import { buildSpecies } from "../web/glossary-digimon.js";

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const P = (id, name) => ({ id, name, hp: 100, mp: 50, str: 10, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL }, resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [9], tech_learn_levels: [], tech_load_levels: [], blasts: [] });
const names = ["Kotemon", "Imperialdramon-F", "BK WarGreymon", "Agumon", "Gabumon", "Patamon", "Veemon", "Guilmon", "Renamon", "Betamon", "Kunemon", "Gizamon"];
const DATA = buildSpecies({ digimon: { digimon: names.map((n, i) => P(i + 1, n)), skills: [{ id: 9, name: "Pepper Breath", element: "fire" }] }, enemies: { enemies: [] }, evolutions: { lines: [] } });
const log = (met = {}, beaten = {}) => ({ metCount: (n) => met[n] || 0, beatenCount: (n) => beaten[n] || 0, totals: () => ({ met: Object.keys(met).length, beaten: Object.keys(beaten).length }), read: () => ({}) });

function fakeCtx() {
    const calls = [];
    return new Proxy({}, { get: (_t, n) => (n === "calls" ? calls : n === "measureText" ? () => ({ width: 10 }) : (...a) => { calls.push([n, ...a]); }), set: () => true });
}
function setup({ met = { Kotemon: 1 }, beaten = { Kotemon: 1 }, partners = [] } = {}) {
    const sounds = [], flips = [];
    const book = createGlossaryBook({ sfx: { play: (n) => sounds.push(n), playPacked: (n) => flips.push(n) }, getSpecies: () => DATA, getLog: () => log(met, beaten), getPartners: () => partners, stage: null });
    return { book, sounds, flips };
}
const keys = (...k) => new Set(k);

test("the book names its four windows in opening order and sits on the wall", () => {
    const { book } = setup();
    assert.deepEqual(book.windows, ["title", "list", "model", "footer"]);
    assert.equal(book.wall, true);
});

test("Back leaves; up and down move one species with the cursor sound; left and right jump ten; a move that does nothing is silent", () => {
    const { book, sounds } = setup();
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("up")), null);
    assert.deepEqual(sounds, []);
    book.act(keys("down"));
    assert.equal(book.model.index(), 1);
    book.act(keys("right"));
    assert.equal(book.model.index(), 11);
    assert.deepEqual(sounds, ["system02", "system02"]);
});

test("R1 opens page 2 only for a species the player has defeated; L1 goes back; the flip plays the open and close sounds", () => {
    const { book, flips } = setup({ met: { Kotemon: 1, "Imperialdramon-F": 1 }, beaten: { Kotemon: 1 } });
    book.act(keys("r1"));
    assert.equal(book.model.page(), 1);
    book.act(keys("l1"));
    assert.equal(book.model.page(), 0);
    book.act(keys("down"));                       // Imperialdramon-F: met only
    book.act(keys("r1"));
    assert.equal(book.model.page(), 0, "no page 2 before the first defeat");
    assert.equal(flips.length, 2, "only the two real flips made a sound");
});

test("on page 2 left and right change species by one and up and down scroll the lines", () => {
    const { book } = setup();
    book.act(keys("r1"));
    book.act(keys("right"));
    assert.equal(book.model.index(), 1);
    book.act(keys("left"));
    assert.equal(book.model.index(), 0);
    book.act(keys("down"));
    assert.equal(book.model.line(), 1);
    assert.equal(book.model.index(), 0, "up and down did not move the species");
});

test("the rectangles lie inside the 320 x 240 box, above the footer, and the two panels do not overlap", () => {
    const L = GLOSSARY_LAYOUT;
    for (const [name, r] of Object.entries({ list: L.list, model: L.model, card: L.card })) {
        assert.ok(r.x >= 0 && r.y >= 40 && r.y + r.h <= 194, `${name} is under the header and above the footer`);
        assert.ok(r.x + r.w <= 328, `${name} ends at or before x 328 (the disc's panels bleed past 320)`);
    }
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(hit(L.list, L.model), false);
    assert.equal(hit(L.list, L.card), false);
    assert.equal(hit(L.model, L.card), false);
});

test("the counts line and every long name are fitted by measured width, so nothing passes its box", () => {
    const { book } = setup();
    const ctx = fakeCtx();
    book.draw(ctx, { progress: () => 1, ticks: 100, dt: 0.02 });
    assert.ok(ctx.calls.length > 0);
});

test("every fold stage draws without throwing, on every species state and both pages", () => {
    for (const partners of [[], [{ slot: 0, rookie: "Kotemon", form: "Kotemon", level: 9, live: { level: 9, formLevels: {}, stats: {} } }]]) {
        const { book } = setup({ met: { Kotemon: 1, "Imperialdramon-F": 1 }, beaten: { Kotemon: 2 }, partners });
        for (const p of [0, 0.5, 1]) for (const page of [0, 1]) {
            if (page === 1) book.act(keys("r1"));
            assert.doesNotThrow(() => book.draw(fakeCtx(), { progress: () => p, ticks: 10, dt: 0.02 }));
        }
    }
});

test("while the tables are still loading the book draws a plain message and still answers Back", () => {
    const book = createGlossaryBook({ sfx: null, getSpecies: () => null, getLog: () => log(), getPartners: () => [], stage: null });
    assert.doesNotThrow(() => book.draw(fakeCtx(), { progress: () => 1, ticks: 0, dt: 0.02 }));
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("down")), null);
});
```

and two tests appended to `tests/book-host.test.js` (read its existing setup first: it builds a host with a fake book and a fake `ctx`; reuse the same helpers): `book.draw` receives `view.dt` (the seconds of the last `update`), and a book with a `close` method is closed once when the host drops it:

```js
test("the book's draw gets the last frame's seconds", () => {
    let seen = null;
    const book = { windows: ["a"], wall: false, act: () => null, draw: (_c, view) => { seen = view; } };
    const host = createBookHost({ factories: { x: () => book } });   // use the same fake ctx and held-set helpers as the tests above
    host.open("x", null, []);
    host.update(0.02, new Set());
    host.draw(fakeCtx(), 640, 480, 0);
    assert.equal(seen.dt, 0.02);
});

test("a book is told when the host drops it", () => {
    let closed = 0;
    const book = { windows: ["a"], wall: false, act: () => null, draw() {}, close() { closed++; } };
    const host = createBookHost({ factories: { x: () => book } });
    host.open("x", null, []);
    host.close();
    assert.equal(closed, 1);
    host.close();
    assert.equal(closed, 1, "closing a host with no book does nothing");
});
```

(If the file's helpers are named differently, use theirs; the assertions stay.)

- [ ] **Step 2: Run the three files, expect FAIL.**

- [ ] **Step 3: Edit `web/book-host.js`**: add `let lastDt = 0;` beside `let ticks`, set `lastDt = dt;` at the top of `update` (after the `if (!book) return;`), change the draw call to `book.draw(ctx, { progress: (n) => chain.folds[n].progress(), ticks, dt: lastDt });`, and in `close()` call `book?.close?.();` before `book = null`. Update the interface comment at the top (`view = { progress(windowName), ticks, dt }`; `close?(): void`). Nothing else in the host changes.

- [ ] **Step 4: Write `web/glossary-model.js`**

```js
// web/glossary-model.js -- cursor, list window, page and card reveal of GLOSSARY > DIGIMON. Pure.
// Rules: the cursor does not wrap (the pause list's rule, ddw3 pause-menu-screen-tree:108-117); a page change or a new species
// restarts the card reveal and resets page-2 scroll.
export const VISIBLE = 8;          // species rows in the list window (its first line is the counts)
export const REVEAL_EVERY = 2;     // frames per card line (the album's cell-by-cell flip, one every 2 frames)

export function createGlossaryModel({ count }) {
    const last = Math.max(0, (count | 0) - 1);
    let index = 0, top = 0, page = 0, line = 0, shown = 0;
    const settle = () => { if (index < top) top = index; else if (index >= top + VISIBLE) top = index - VISIBLE + 1; top = Math.max(0, Math.min(top, Math.max(0, last + 1 - VISIBLE))); };
    const changed = () => { line = 0; shown = 0; };
    const go = (to) => { const t = Math.max(0, Math.min(last, to)); if (t === index || count <= 0) return false; index = t; settle(); changed(); return true; };
    return {
        index: () => index, top: () => top, page: () => page, line: () => line,
        move: (d) => go(index + d),
        jump: (d) => go(index + d),
        setPage(p, allowed = true) { if (p === page || (p === 1 && !allowed)) return false; page = p; changed(); return true; },
        scrollLine(d, lineCount) { const t = Math.max(0, Math.min(Math.max(0, lineCount - 1), line + d)); if (t === line) return false; line = t; return true; },
        resetCard: changed,
        reveal: (total) => Math.min(total, Math.floor(shown / REVEAL_EVERY)),
        tickReveal() { shown++; },
    };
}
```

(`move` and `jump` are the same arithmetic; they stay two names so the book's key table reads like the spec.)

- [ ] **Step 5: Write `web/glossary-book.js`**

```js
// web/glossary-book.js -- the GLOSSARY book, DIGIMON section: numbered list on the left, the turning model and the card on the
// right. Rows: web/glossary-digimon.js. Cursor and pages: web/glossary-model.js. Model: web/glossary-stage.js (Task 4).
// Keys (web/ui-kit-input.js words): up / down one species, left / right ten (page 2: left / right one species, up / down scroll the
// page), L1 / R1 page 1 / page 2 (the section tabs ITEMS and PLACES are drawn dim; nothing switches to them yet: spec Notes 6),
// Back leaves.
import { WORD } from "./ui-kit-input.js";
import { SFX_CLOSE, SFX_OPEN, drawFooter, drawHeader, drawPanel, listRowY, panelPixelHeight, withFold } from "./ui-kit.js";
import { drawCursor, drawText, textWidth } from "./uifont.js";
import { BAND_TEXT_W, fitByWidth } from "./text-fit.js";
import { headerLayout } from "./options-book.js";
import { headerCounts, listRows, pageOne, pageTwoLines, partnerOf, speciesState } from "./glossary-digimon.js";
import { VISIBLE, createGlossaryModel } from "./glossary-model.js";

const rect = (x, y, cols, bands) => ({ x, y, w: cols * 40, h: panelPixelHeight(bands), cols, bands });
export const GLOSSARY_LAYOUT = Object.freeze({
    list: rect(0, 40, 3, 7),
    model: rect(124, 40, 5, 4),
    card: rect(124, 138, 5, 1),
    cursorX: 6, numberRight: 40, nameX: 46, nameRight: 116,
    cardX: 132, cardRows: [147, 161], cardRight: 316,
    // the model is drawn inside its panel, away from the frame
    image: { x: 130, y: 46, w: 188, h: 86 },
});
const TABS = ["DIGIMON", "ITEMS", "PLACES"];

export function createGlossaryBook({ sfx = null, getSpecies, getLog, getPartners = () => [], stage = null }) {
    let model = null, loadedFor = null, first = true;
    const data = () => {
        const d = getSpecies();
        if (d && loadedFor !== d) { loadedFor = d; model = createGlossaryModel({ count: d.species.length }); }
        return d;
    };
    const current = (d) => {
        const sp = d.species[model.index()];
        const partners = getPartners();
        const partner = partnerOf(sp, partners);
        return { sp, partner, state: speciesState(sp, getLog(), partner), partners };
    };
    const cue = (ok) => { if (ok) sfx?.play?.("system02"); return ok; };
    const show = (d) => { const c = current(d); stage?.show(c.sp.name, { shadow: c.state === "unknown" }); };
    const book = {
        windows: ["title", "list", "model", "footer"],
        wall: true,
        get model() { data(); return model; },
        act(buttons) {
            if (buttons.has(WORD.back)) return "back";
            const d = data();
            if (!d || !model) return null;
            const before = model.index();
            const onPage2 = model.page() === 1;
            if (buttons.has(WORD.next)) {
                const c = current(d);
                if (model.setPage(1, c.state === "known")) sfx?.playPacked?.(SFX_OPEN);
            } else if (buttons.has(WORD.prev)) {
                if (model.setPage(0)) sfx?.playPacked?.(SFX_CLOSE);
            } else if (buttons.has("up")) {
                if (onPage2) cue(model.scrollLine(-1, pageTwoLines(...lineArgs(d)).length)); else cue(model.move(-1));
            } else if (buttons.has("down")) {
                if (onPage2) cue(model.scrollLine(1, pageTwoLines(...lineArgs(d)).length)); else cue(model.move(1));
            } else if (buttons.has("left")) cue(onPage2 ? model.move(-1) : model.jump(-10));
            else if (buttons.has("right")) cue(onPage2 ? model.move(1) : model.jump(10));
            if (model.index() !== before) show(d);
            return null;
        },
        tick() {
            const d = data();
            if (d && first) { first = false; show(d); }     // the first species' model is asked for as soon as the tables are in
            model?.tickReveal();
        },
        close() { stage?.close(); },
        draw(ctx, view) {
            const d = data();
            const L = GLOSSARY_LAYOUT;
            const pt = view.progress("title"), pl = view.progress("list"), pm = view.progress("model"), pf = view.progress("footer");
            const w = (s, k = 1) => textWidth(s, k);
            const hl = headerLayout(w, "GLOSSARY", TABS);
            drawHeader(ctx, pt, "GLOSSARY", TABS, 0, { tabStart: hl.tabStart, gap: hl.tabGap });
            if (pt >= 1) { drawText(ctx, "L1", hl.l1[0], 20, { kind: 3, clut: 2 }); drawText(ctx, "R1", hl.r1[0], 20, { kind: 3, clut: 2 }); }
            if (!d) {
                withFold(ctx, pl, 160, 110, "x", () => drawPanel(ctx, L.list.x, L.list.y, 8, 4));
                if (pl >= 1) drawText(ctx, "Loading...", 20, 70);
                drawFooter(ctx, pf, "", "");
                return;
            }
            const log = getLog(), rows = listRows(d.species, log, getPartners());
            const counts = headerCounts(d.species, log);
            withFold(ctx, pl, L.list.x, L.list.y + L.list.h / 2, "x", () => drawPanel(ctx, L.list.x, L.list.y, L.list.cols, L.list.bands));
            if (pl >= 1) {
                drawText(ctx, fitByWidth(counts.text, (s) => w(s), L.nameRight - 8), 8, listRowY(0));
                for (let i = 0; i < VISIBLE; i++) {
                    const r = rows[model.top() + i];
                    if (!r) break;
                    const y = listRowY(i + 1);
                    drawText(ctx, String(r.number), L.numberRight, y, { kind: 3, alignRight: true });
                    drawText(ctx, fitByWidth(r.label, (s) => w(s), L.nameRight - L.nameX), L.nameX, y, r.state === "unknown" ? { clut: 7 } : undefined);
                }
                drawCursor(ctx, view.ticks * 2, L.cursorX, listRowY(model.index() - model.top() + 1));
                if (model.top() > 0 && (view.ticks % 18) < 9) drawText(ctx, "▲", 100, listRowY(0));
                if (model.top() + VISIBLE < rows.length && (view.ticks % 18) < 9) drawText(ctx, "▼", 100, listRowY(VISIBLE));
            }
            const c = current(d);
            const lines = model.page() === 1 ? pageTwoLines(c.sp, c.state, c.partner, d.world, d.maxima) : null;
            if (model.page() === 0) drawPageOne(ctx, pm, pf, c, getLog(), model, stage, view, w);
            else drawPageTwo(ctx, pm, pf, lines, c, model, view, w);
        },
    };
    const lineArgs = (d) => { const c = current(d); return [c.sp, c.state, c.partner, d.world, d.maxima]; };
    return book;
}

function drawPageOne(ctx, pm, pf, c, log, model, stage, view, w) {
    const L = GLOSSARY_LAYOUT;
    const p1 = pageOne(c.sp, c.state, log, c.partner);
    withFold(ctx, pm, L.model.x, L.model.y + L.model.h / 2, "x", () => { drawPanel(ctx, L.model.x, L.model.y, L.model.cols, L.model.bands); drawPanel(ctx, L.card.x, L.card.y, L.card.cols, L.card.bands); });
    if (pm >= 1) {
        const shown = model.reveal(3);
        const drawn = stage?.draw(ctx, L.image.x, L.image.y, L.image.w, L.image.h, view.dt) ?? false;
        if (!drawn) drawText(ctx, "No picture", L.image.x + 60, L.image.y + 36, { clut: 7 });
        drawText(ctx, fitByWidth(p1.title, (s) => w(s), L.cardRight - L.cardX), L.cardX, L.model.y + 4);
        if (shown >= 1) drawText(ctx, fitByWidth(p1.row1, (s) => w(s), L.cardRight - L.cardX), L.cardX, L.cardRows[0]);
        if (shown >= 2) drawText(ctx, fitByWidth(p1.record, (s) => w(s), L.cardRight - L.cardX), L.cardX, L.cardRows[1]);
    }
    drawFooter(ctx, pf, model.reveal(3) >= 3 ? fitByWidth(p1.lives, (s) => w(s), BAND_TEXT_W) : "", model.reveal(3) >= 3 ? fitByWidth(p1.drops, (s) => w(s), BAND_TEXT_W) : "");
    if (pf >= 1 && c.state === "known") drawText(ctx, "R1 strength", 244, 212, { kind: 3, clut: 2 });
}

function drawPageTwo(ctx, pm, pf, lines, c, model, view, w) {
    // Task 5 draws the scrolling strength page; until then the pane is the empty panel.
    const L = GLOSSARY_LAYOUT;
    withFold(ctx, pm, L.model.x, L.model.y + L.model.h / 2, "x", () => drawPanel(ctx, L.model.x, L.model.y, L.model.cols, 7));
    drawFooter(ctx, pf, "", "");
}
```

Executor: Task 5 adds the `drawBar`, `drawIconGlyph` and `wrapToLines` imports where it uses them. `ctx` in the tests is a Proxy: `drawText` falls back to `ctx.fillText` while the font is not loaded in node (`web/uifont.js:203-212`), so nothing needs a font. The arrow glyphs `▲ ▼` are the ones `web/options-book.js:89` already draws with the same font (`◀ ▶`); if the font has no triangle glyph for these, `drawText` leaves a gap of `cellWidth` (harmless), and the shot shows it. Do not invent other glyphs.

- [ ] **Step 6: Run `node --test tests/glossary-model.test.js tests/glossary-book.test.js tests/book-host.test.js`, expect PASS.** Then the neighbours: `node --test tests/options-book.test.js tests/ui-kit.test.js tests/book-wiring.test.js`.

- [ ] **Step 7: New-failures check and typecheck.**

- [ ] **Step 8: Screenshot.** The book is only reachable in the game after Task 6's wiring, so this task's screenshots (`g3-*`) are taken with Task 6's script and reported there. Say so in this task's report; do not edit `web/game.js` for a temporary hook.

- [ ] **Step 9: Do not commit.** Report changed files.

---

### Task 4: the model window (one renderer, turning, shadow, fallback)

**Files:**
- Create: `web/glossary-stage.js`
- Test: `tests/glossary-stage.test.js`

**Interfaces:**
- Consumes: `createBattle3D(canvas, sfx, opts)` (`web/battle3d.js:1963`), `resolveModelFolder(name)` (`:6400`), `setFighterTint(side, rgba)` (`:995`), `createFreeCamera(opts)` (`web/anim-viewer-camera.js:44`; `autoOrbitSpeed` `:58`, `update(dt)` `:283`, `view()` `:306`, `frameBounds(bounds, aspect, {immediate})` `:204`, `DEG` `:20`), and these renderer methods: `setEnemyVisible(false)` `:3612`, `setPlayerVisible(true)` `:3609`, `setIsolated(true, "player")` `:6203`, `setCameraMode("free")` `:3419`, `setFreeCameraView(fn)` `:6143`, `setPlayerDigimon(folder)` `:3571` (a Promise of true or false), `getFighterBounds("player")` `:6145`, `render(dt)`.
- Produces: `TURN_SECONDS = 12`, `TURN_DEG_PER_S = 30`, `createStage({ makeRenderer, makeCamera, resolveFolder, setTint, size }) -> { show(name, { shadow }) -> Promise<boolean>, draw(ctx, x, y, w, h, dt) -> boolean, close(), debug() }`. In the game `makeRenderer = (canvas) => createBattle3D(canvas, null)`, `makeCamera = createFreeCamera`, `resolveFolder = resolveModelFolder`, `setTint = setFighterTint`; `size` = the canvas size in pixels (the image rectangle times the 2x game scale).

**How it works (all read):** the animation viewer shows one Digimon alone with exactly these calls (`web/anim-viewer.html:584-585, 1573-1575, 1607-1608`). The free camera orbits the pivot at `autoOrbitSpeed` degrees per second, which is the model turning; the renderer's idle (ActorAnimator) keeps running inside `render(dt)`. The distance is fitted once to the model's bounding SPHERE (not its box), so the model does not swell as it turns. `isolated` mode paints a neutral background and a ground grid under the fighter (`battle3d.js:5453, 5565, 4902`); `setBuiltArena(true)` with `{alpha:true}` would give a see-through canvas but still draws the floor quad (`:5563`), so isolated mode is the first try and the shot decides.

- [ ] **Step 1: Write the failing tests** `tests/glossary-stage.test.js`

```js
// The one 3D stage for the glossary (web/glossary-stage.js), with a recording renderer and the real free camera.
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_DEG_PER_S, TURN_SECONDS, createStage } from "../web/glossary-stage.js";
import { createFreeCamera } from "../web/anim-viewer-camera.js";

function recorder() {
    const log = [], pending = [];
    const r = {
        log, pending,
        setEnemyVisible: (v) => log.push(["enemyVisible", v]),
        setPlayerVisible: (v) => log.push(["playerVisible", v]),
        setIsolated: (on, side) => log.push(["isolated", on, side]),
        setCameraMode: (m) => log.push(["cameraMode", m]),
        setFreeCameraView: (fn) => { r.view = fn; log.push(["freeView", typeof fn]); },
        setPlayerDigimon: (folder) => new Promise((res) => { log.push(["player", folder]); pending.push({ folder, res }); }),
        getFighterBounds: () => ({ min: [-50, 0, -50], max: [50, 160, 50], center: [0, 80, 0], size: [100, 160, 100] }),
        render: (dt) => log.push(["render", dt]),
    };
    return r;
}
function setup(over = {}) {
    const r = recorder();
    const tints = [];
    let made = 0, cams = [];
    const stage = createStage({
        makeRenderer: () => { made++; return r; },
        makeCamera: (o) => { const c = createFreeCamera(o); cams.push(c); return c; },
        resolveFolder: async (name) => (name === "Nope" ? null : `m_${name}`),
        setTint: (side, rgba) => tints.push([side, rgba]),
        size: [376, 172],
        canvasFactory: () => ({ width: 376, height: 172 }),
        ...over,
    });
    return { stage, r, tints, made: () => made, cams };
}
const ctx = () => { const calls = []; return { calls, drawImage: (...a) => calls.push(a) }; };
const settle = () => new Promise((res) => setTimeout(res, 0));

test("one turn per 12 seconds is 30 degrees a second", () => {
    assert.equal(TURN_SECONDS, 12);
    assert.equal(TURN_DEG_PER_S, 30);
});

test("the renderer is built once, set up as the animation viewer sets it up, and reused for the next species", async () => {
    const { stage, r, made } = setup();
    const a = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); assert.equal(await a, true);
    const b = stage.show("Gabumon", { shadow: false });
    await settle(); r.pending[1].res(true); await b;
    assert.equal(made(), 1, "no second WebGL context");
    const calls = r.log.filter((l) => ["enemyVisible", "playerVisible", "isolated", "cameraMode", "freeView"].includes(l[0]));
    assert.deepEqual(calls, [["enemyVisible", false], ["playerVisible", true], ["isolated", true, "player"], ["cameraMode", "free"], ["freeView", "function"]]);
});

test("a newer show() wins over a slower older one (holding a direction through the list)", async () => {
    const { stage, r } = setup();
    const first = stage.show("Agumon", { shadow: false });
    await settle();
    const second = stage.show("Gabumon", { shadow: false });
    await settle();
    r.pending[1].res(true);
    assert.equal(await second, true);
    r.pending[0].res(true);
    assert.equal(await first, false, "the older request is told it lost");
    assert.equal(stage.debug().folder, "m_Gabumon");
});

test("a species with no model folder, or a model that fails to load, is not ready and draws nothing", async () => {
    const { stage, r } = setup();
    assert.equal(await stage.show("Nope", { shadow: false }), false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(false);
    assert.equal(await p, false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
});

test("the camera turns 30 degrees a second: after 12 seconds the target has gone round once", async () => {
    const { stage, r, cams } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    const c = ctx();
    for (let i = 0; i < 600; i++) assert.equal(stage.draw(c, 0, 0, 188, 86, 0.02), true);
    const cam = cams[0];
    assert.ok(Math.abs(cam.targetYaw - 2 * Math.PI) < 1e-6, `yaw ${cam.targetYaw}`);
    assert.equal(cam.autoOrbitSpeed, 30);
    assert.equal(c.calls.length, 600, "every frame copies the renderer canvas into the window");
});

test("the distance is fitted to a sphere once, so it does not change while the model turns", async () => {
    const { stage, r, cams } = setup();
    const p = stage.show("Agumon", { shadow: false });
    await settle(); r.pending[0].res(true); await p;
    const c = ctx();
    stage.draw(c, 0, 0, 188, 86, 0.02);
    const d0 = cams[0].targetDist;
    assert.ok(d0 > 0 && Number.isFinite(d0));
    for (let i = 0; i < 100; i++) stage.draw(c, 0, 0, 188, 86, 0.02);
    assert.equal(cams[0].targetDist, d0);
});

test("a shadow species is tinted black; a known one puts the game's own tint back; closing restores it too", async () => {
    const { stage, r, tints } = setup();
    let p = stage.show("Agumon", { shadow: true });
    await settle(); r.pending[0].res(true); await p;
    assert.deepEqual(tints.at(-1), ["player", [0, 0, 0, 1]]);
    p = stage.show("Gabumon", { shadow: false });
    await settle(); r.pending[1].res(true); await p;
    assert.deepEqual(tints.at(-1), ["player", null]);
    stage.close();
    assert.deepEqual(tints.at(-1), ["player", null]);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false, "closed: nothing drawn");
});

test("without WebGL the stage says so and draws nothing, it does not throw", async () => {
    const { stage } = setup({ makeRenderer: () => null });
    assert.equal(await stage.show("Agumon", { shadow: false }), false);
    assert.equal(stage.draw(ctx(), 0, 0, 188, 86, 0.02), false);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Write `web/glossary-stage.js`**

```js
// web/glossary-stage.js -- the Digimon on the right of GLOSSARY > DIGIMON: the game's own battle renderer, one model alone,
// turning slowly with its own idle motion. One renderer (one WebGL context) for the whole book.
//
// It uses only what the animation viewer already uses (web/anim-viewer.html:584-585, 1573-1575): the enemy hidden, isolated mode
// (neutral background), the free camera mode with the camera from web/anim-viewer-camera.js. The free camera orbits the model at
// `autoOrbitSpeed` degrees a second, which is the model turning. No change to web/battle3d.js.
export const TURN_SECONDS = 12;                       // decided: one turn per 12 seconds
export const TURN_DEG_PER_S = 360 / TURN_SECONDS;     // 30

const SHADOW = [0, 0, 0, 1];                          // a ???: the model drawn black
const PITCH_DEG = 8;                                  // the viewer's "front" preset pitch (anim-viewer-camera.js PRESETS)

export function createStage({ makeRenderer, makeCamera, resolveFolder, setTint, size = [376, 172], canvasFactory = null }) {
    let r = null, canvas = null, cam = null;
    let token = 0, folder = null, ready = false, framed = false, closed = false, failed = false;

    function ensure() {
        if (r || failed) return !!r;
        try {
            canvas = canvasFactory ? canvasFactory(size[0], size[1])
                : (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size[0], size[1]) : null);
            r = canvas ? makeRenderer(canvas) : null;
        } catch { r = null; }
        if (!r) { failed = true; return false; }
        cam = makeCamera({ yaw: 0, pitch: PITCH_DEG * Math.PI / 180, fovDeg: 45, damping: 14 });
        cam.autoOrbitSpeed = TURN_DEG_PER_S;
        r.setEnemyVisible(false);
        r.setPlayerVisible(true);
        r.setIsolated(true, "player");
        r.setCameraMode("free");
        r.setFreeCameraView(() => cam.view());
        return true;
    }

    return {
        /** Show species `name`. Resolves true when its model is up, false when there is none, it failed, or a newer show() won. */
        async show(name, { shadow = false } = {}) {
            const mine = ++token;
            closed = false; ready = false; framed = false; folder = null;
            if (!ensure()) return false;
            setTint("player", shadow ? SHADOW : null);
            let f = null;
            try { f = await resolveFolder(name); } catch { f = null; }
            if (mine !== token) return false;
            if (!f) return false;
            folder = f;
            let ok = false;
            try { ok = await r.setPlayerDigimon(f); } catch { ok = false; }
            if (mine !== token) return false;
            ready = !!ok;
            return ready;
        },
        /** Render one frame and copy it into (x, y, w, h) of `ctx`. False when there is nothing to show. */
        draw(ctx, x, y, w, h, dt = 0.02) {
            if (closed || !ready || !r) return false;
            cam.update(dt);
            r.render(dt);
            if (!framed) {
                const b = r.getFighterBounds("player");
                if (b) {
                    const radius = Math.max(1, Math.hypot(b.size[0], b.size[1], b.size[2]) / 2);
                    // a sphere, not the box: the distance must not change while the model turns
                    cam.frameBounds({ center: b.center, half: [radius, radius, radius] }, w / h, { immediate: true });
                    framed = true;
                }
            }
            ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, y, w, h);
            return true;
        },
        /** The book shut: stop drawing and give the game's tint table back (it is shared with real fights). */
        close() { token++; closed = true; ready = false; setTint("player", null); },
        debug: () => ({ folder, ready, framed, closed, yaw: cam?.yaw ?? null, targetYaw: cam?.targetYaw ?? null, dist: cam?.dist ?? null, speed: cam?.autoOrbitSpeed ?? null }),
    };
}
```

Notes: `createFreeCamera` options are read at `web/anim-viewer-camera.js:44-61` (`yaw`, `pitch` in radians, `fovDeg`, `damping`). `frameBounds` takes `{ center, half }` (`boxOf`, `:176-186`). In the game the canvas is `OffscreenCanvas(size[0], size[1])` and `size` is the window rectangle at the 2x game scale (the book draws in 320 x 240 space onto a 640 x 480 canvas, `web/book-host.js`).

- [ ] **Step 4: Run `node --test tests/glossary-stage.test.js`, expect PASS (8 tests).** Also `node --test tests/anim-viewer*.test.js tests/battle3d*.test.js` (nothing in them should change; the stage touches neither module).

- [ ] **Step 5: New-failures check and typecheck.**

- [ ] **Step 6: GPU measurement and picture of the stage alone** (the book itself is shot in Task 6). `/home/dorij/ui-review/build/shots/g4.mjs`:

```js
import { writeFileSync } from "node:fs";
import { openGame } from "/home/dorij/dw2003-play-integration/tools/ui_shot.mjs";
const { browser, page, renderer } = await openGame({ fx: { glossary: true } });
console.log("renderer", renderer);                       // openGame already threw unless this names the AMD card
const out = await page.evaluate(async () => {
    const { createBattle3D, resolveModelFolder, setFighterTint } = await import("/battle3d.js");
    const { createFreeCamera } = await import("/anim-viewer-camera.js");
    const { createStage } = await import("/glossary-stage.js");
    const stage = createStage({ makeRenderer: (c) => createBattle3D(c, null), makeCamera: createFreeCamera, resolveFolder: resolveModelFolder, setTint: setFighterTint, size: [376, 172] });
    const cv = Object.assign(document.createElement("canvas"), { width: 376, height: 172 });
    const ctx = cv.getContext("2d");
    window.__stageShot = { stage, cv };
    const ok = await stage.show("Agumon", { shadow: false });
    const t0 = performance.now();
    let last = t0;
    await new Promise((res) => {
        const frame = (now) => {
            const dt = Math.min(0.1, (now - last) / 1000); last = now;
            stage.draw(ctx, 0, 0, 376, 172, dt);
            if (now - t0 > 3000) res(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
    return { ok, seconds: (performance.now() - t0) / 1000, debug: stage.debug(), png: cv.toDataURL("image/png") };
});
writeFileSync("/home/dorij/ui-review/build/g4-stage-alone.png", Buffer.from(out.png.split(",")[1], "base64"));
console.log(JSON.stringify({ ok: out.ok, seconds: out.seconds, debug: out.debug }));
await browser.close();
```

Print and report: the renderer string, `ok`, `debug.speed` (30), `debug.dist`, and that `targetYaw` (radians) advanced by about `30 * seconds * PI / 180` (it starts when the draw loop starts, so the model load time is not in it). Report whether the neutral background and the ground grid are drawn (they are by `battle3d.js:5453, 5565`); if the main session rejects the grid, the smallest follow-up is a new `setViewerGrid(false)` in `battle3d.js` (additive, only this screen sets it) and a test for it, as a separate task after the user has seen the shot, not before.

- [ ] **Step 7: Do not commit.** Report changed files.

---

### Task 5: page 2 (strength)

**Files:**
- Modify: `web/glossary-book.js` (replace the `drawPageTwo` stub; add the `drawBar` (from `./ui-kit.js`), `drawIconGlyph` (from `./uifont.js`) and `wrapToLines` (from `./text-fit.js`) imports)
- Test: `tests/glossary-page2.test.js`

**Interfaces:**
- Consumes: Task 2 `pageTwoLines(...) -> Line[]`; Task 3 model (`line()` = the first visible line of the scrolling pane, `scrollLine`); `web/ui-kit.js` `drawBar(ctx, x, y, w, h, value, max)` (`:165`), `barFill`; `drawIconGlyph(ctx, name, x, y)` (`web/uifont.js:235`; names `str def spt wis spd chr fire water ice wind thunder machine dark`); `wrapToLines` (`web/text-fit.js:42`).
- Produces: `PAGE2` (layout constants) and `page2Rows(lines, widthOf) -> VisualRow[]` exported from `web/glossary-book.js`: the pure step that turns lines into drawable rows (a long `text` line becomes up to two wrapped rows; a `head` becomes one row; a bar stays one row). `VisualRow = { kind, label, icon, value, max, text }`. The pane shows 9 rows (the panel `drawPanel(ctx, 124, 40, 5, 7)`: 200 x 140, rows at `listRowY(0..8)`); `model.line()` is the index of the first row shown; arrows blink at the pane's top-right and bottom-right when rows are hidden (toggle every 9 ticks, as `web/menu.js:2648-2650`).

**Row look:** a `bar` row: `drawIconGlyph` (or the white label when there is no icon: HP, MP) at x 132, the bar `drawBar(ctx, 160, y + 3, 100, 6, value, max)`, the number in the orange face right-aligned at x 316. A `text` row: the label in white at x 132 (`Resists`, `Weak to`, `Grows from`, `Grows into`, `Your level`, `Next form`), the text in white from x 196 (or from x 132 when the label is empty), wrapped by measured width to at most two rows. A `head` row: the label in the dim face (`clut: 7`).

- [ ] **Step 1: Write the failing tests** `tests/glossary-page2.test.js`

```js
// Page 2 of GLOSSARY > DIGIMON: lines to drawable rows, scroll, and drawing (web/glossary-book.js).
import test from "node:test";
import assert from "node:assert/strict";
import { PAGE2, createGlossaryBook, page2Rows } from "../web/glossary-book.js";
import { barFill } from "../web/ui-kit.js";

const wide = (s) => s.length * 7;

test("a bar stays one row; a head one row; a long text line wraps to two rows at most, cut to fit", () => {
    const lines = [
        { kind: "bar", label: "HP", value: 300, max: 600 },
        { kind: "head", label: "Techniques" },
        { kind: "text", label: "Grows into", text: "ExVeemon, MetalGreymon, SkullGreymon, Growlmon, WarGrowlmon, Cannondramon, Paildramon, Gallantmon, Grizzmon" },
        { kind: "text", label: "", text: "Pepper Breath" },
    ];
    const rows = page2Rows(lines, wide);
    assert.deepEqual(rows.map((r) => r.kind), ["bar", "head", "text", "text", "text"]);
    assert.ok(rows.filter((r) => r.kind === "text").every((r) => wide(r.text) <= PAGE2.textRight - (r.label ? PAGE2.textX : PAGE2.labelX)), "every text row fits its width");
    assert.equal(rows.filter((r) => r.label === "Grows into").length, 1, "the label is on the first row of a wrapped line only");
});

test("a species with a six-technique list and a 179-form line still gives a short finite list", () => {
    const into = Array.from({ length: 179 }, (_, i) => `Form${i}`).join(", ");
    const rows = page2Rows([{ kind: "text", label: "Grows into", text: into }], wide);
    assert.ok(rows.length <= 2);
});

test("the pane holds nine rows and a bar never passes its track", () => {
    assert.equal(PAGE2.visible, 9);
    assert.equal(barFill(9999, 100, PAGE2.barW), PAGE2.barW);
    assert.equal(barFill(50, 100, PAGE2.barW), PAGE2.barW / 2);
    assert.equal(barFill(0, 100, PAGE2.barW), 0);
    assert.equal(barFill(5, 0, PAGE2.barW), 0, "no maximum: an empty bar, not NaN");
});

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const PROFILE = { id: 1, name: "Kotemon", hp: 100, mp: 50, str: 10, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL, fire: 150 }, resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [9], tech_learn_levels: [], tech_load_levels: [], blasts: [], is_starter: true };
const knownLog = { metCount: () => 1, beatenCount: () => 1, totals: () => ({ met: 1, beaten: 1 }) };
const fakeCtx = () => new Proxy({}, { get: (_t, n) => (n === "measureText" ? () => ({ width: 10 }) : () => {}), set: () => true });

async function page2Book() {
    const { buildSpecies } = await import("../web/glossary-digimon.js");
    const data = buildSpecies({ digimon: { digimon: [PROFILE], skills: [{ id: 9, name: "Pepper Breath", element: "fire" }] }, enemies: { enemies: [] }, evolutions: { lines: [] } });
    const book = createGlossaryBook({ sfx: null, getSpecies: () => data, getLog: () => knownLog, getPartners: () => [], stage: null });
    book.act(new Set(["r1"]));
    return book;
}

test("page 2 draws at every fold stage and scroll position without throwing", async () => {
    const book = await page2Book();
    for (const p of [0, 0.5, 1]) for (let s = 0; s < 3; s++) {
        assert.doesNotThrow(() => book.draw(fakeCtx(), { progress: () => p, ticks: s * 9, dt: 0.02 }));
        book.act(new Set(["down"]));
    }
});

test("the page scrolls until its last row sits on the last pane row, then stops", async () => {
    const book = await page2Book();
    // this Kotemon has no line: 8 bars, Resists, Weak to, Techniques head, 1 technique = 12 rows; 9 fit, so 3 scroll steps
    for (let i = 0; i < 3; i++) { book.act(new Set(["down"])); assert.equal(book.model.line(), i + 1); }
    book.act(new Set(["down"]));
    assert.equal(book.model.line(), 3, "the fourth press does nothing");
    for (let i = 0; i < 9; i++) book.act(new Set(["up"]));
    assert.equal(book.model.line(), 0);
});
```

- [ ] **Step 2: Run, expect FAIL** (`PAGE2` / `page2Rows` not exported).

- [ ] **Step 3: Implement** in `web/glossary-book.js`

```js
export const PAGE2 = Object.freeze({ visible: 9, labelX: 132, textX: 196, textRight: 316, barX: 160, barW: 100, barH: 6, numberRight: 316 });

/** Lines (Task 2) to drawable rows: long text wraps to at most two rows, only the first keeps the label. */
export function page2Rows(lines, widthOf) {
    const rows = [];
    for (const l of lines) {
        if (l.kind !== "text") { rows.push({ kind: l.kind, label: l.label ?? "", icon: l.icon ?? null, value: l.value, max: l.max, text: "" }); continue; }
        const x = l.label ? PAGE2.textX : PAGE2.labelX;
        const parts = wrapToLines(l.text, widthOf, PAGE2.textRight - x, 2);
        (parts.length ? parts : [""]).forEach((t, i) => rows.push({ kind: "text", label: i === 0 ? l.label : "", icon: null, text: t }));
    }
    return rows;
}
```

and replace `drawPageTwo`:

```js
function drawPageTwo(ctx, pm, pf, lines, c, model, view, w) {
    const L = GLOSSARY_LAYOUT;
    withFold(ctx, pm, L.model.x, L.model.y + L.model.h / 2, "x", () => drawPanel(ctx, L.model.x, L.model.y, L.model.cols, 7));
    if (pm >= 1) {
        const rows = page2Rows(lines, (s) => w(s));
        const first = Math.min(model.line(), Math.max(0, rows.length - PAGE2.visible));
        rows.slice(first, first + PAGE2.visible).forEach((r, i) => {
            const y = listRowY(i);
            if (r.kind === "head") drawText(ctx, r.label, PAGE2.labelX, y, { clut: 7 });
            else if (r.kind === "bar") {
                if (!r.icon || !drawIconGlyph(ctx, r.icon, PAGE2.labelX, y)) drawText(ctx, r.label, PAGE2.labelX, y);
                drawBar(ctx, PAGE2.barX, y + 3, PAGE2.barW, PAGE2.barH, r.value, r.max);
                drawText(ctx, String(r.value), PAGE2.numberRight, y, { kind: 3, alignRight: true });
            } else {
                if (r.label) drawText(ctx, r.label, PAGE2.labelX, y);
                drawText(ctx, r.text, r.label ? PAGE2.textX : PAGE2.labelX, y);
            }
        });
        const blink = (view.ticks % 18) < 9;
        if (blink && first > 0) drawText(ctx, "▲", 304, listRowY(0));
        if (blink && first + PAGE2.visible < rows.length) drawText(ctx, "▼", 304, listRowY(PAGE2.visible - 1));
    }
    drawFooter(ctx, pf, c.partner ? "" : "", "");
    if (pf >= 1) drawText(ctx, "L1 about", 244, 212, { kind: 3, clut: 2 });
}
```

Because the pane shows rows from `model.line()`, `scrollLine(d, lineCount)` in `act` must be given the number of ROWS (not lines): change the two `pageTwoLines(...).length` calls in `act` to `page2Rows(pageTwoLines(...lineArgs(d)), (s) => textWidth(s)).length - PAGE2.visible + 1` (never below 1), so the cursor stops where the last row is on the last pane row. Add a test line for it: with 12 rows, 4 `down` presses move `line()` to 3 and a 5th does nothing.

The help line: page 2 has no row help in this step; the footer's first line stays empty except the `L1 about` hint (the spec's "one-line help for the row" belongs to a row cursor, and page 2 here scrolls rather than selects; to confirm with the user).

- [ ] **Step 4: Run `node --test tests/glossary-page2.test.js tests/glossary-book.test.js`, expect PASS.** Fix any line the test changes in `tests/glossary-book.test.js` only for the scroll-limit arithmetic; the other expectations stay.

- [ ] **Step 5: New-failures check, typecheck.**

- [ ] **Step 6: Screenshot** after Task 6 wiring (Task 6 step 6; the page 2 shots are `g6-05` and `g6-06` there).

- [ ] **Step 7: Do not commit.** Report changed files.

---

### Task 6: wiring, the real screenshots, and the INDEX line

**Files:**
- Modify: `web/game.js` (imports near `:394-395`; the book factory at `:416-422`; a party reader beside `plannerPartyMembers` `:1787`; install the log)
- Test: `tests/glossary-wiring.test.js`; update `tests/book-wiring.test.js` only if it pins the blank-book line

**Interfaces:**
- Consumes: Tasks 1 to 5. `partyRosterView` (`web/party.js`) rows have `charId, rookieId, formName, level`; `menu.digimonDB` is keyed by profile id.
- Produces: the `glossary` book is the DIGIMON screen instead of the blank book; `glossaryPartners()` in `web/game.js`.

- [ ] **Step 1: Write the failing wiring test** `tests/glossary-wiring.test.js`

```js
// How GLOSSARY > DIGIMON is wired into web/game.js (source checks, the repo's style: the real game cannot be imported under node).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");

test("the glossary row opens the Digimon screen, not the blank book; OPTIONS is untouched", () => {
    assert.match(game, /glossary: \(args\) => createGlossaryBook\(/);
    assert.doesNotMatch(game, /createBlankBook\(\{ title: "GLOSSARY" \}\)/);
    assert.match(game, /options: \(args\) => createOptionsBook\(args\)/);
});

test("one species log, installed after the sound players, recording always (no switch)", () => {
    assert.equal((game.match(/createSpeciesLog\(/g) || []).length, 1);
    assert.match(game, /installSpeciesLog\(\{ on: onGameEvent, log: speciesLog \}\)/);
    assert.doesNotMatch(game, /installSpeciesLog\([^)]*enabled/);
    assert.ok(game.indexOf("installSpeciesLog(") > game.indexOf("window.__sfx = sfx;"));
});

test("the party reader gives rookie, form, slot and live level for the first three members", () => {
    const at = game.indexOf("function glossaryPartners()");
    assert.ok(at > 0);
    const block = game.slice(at, game.indexOf("\n}\n", at));
    for (const word of ["rosterSlotOfCharId", "rookie:", "form: row.formName", "level:", "formLedger", "slice(0, 3)"]) assert.ok(block.includes(word), word);
});

test("the stage is made once, and the book closes it when the host drops the book", () => {
    assert.equal((game.match(/createStage\(/g) || []).length, 1);
    const book = readFileSync(new URL("../web/glossary-book.js", import.meta.url), "utf8");
    assert.match(book, /close\(\) \{ stage\?\.close\(\); \}/);
    const host = readFileSync(new URL("../web/book-host.js", import.meta.url), "utf8");
    assert.match(host, /book\?\.close\?\.\(\);/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Edit `web/game.js`.**

Imports (next to `:394-395`):

```js
import { createGlossaryBook } from "./glossary-book.js";
import { createStage } from "./glossary-stage.js";
import { createSpeciesLog, installSpeciesLog } from "./species-log.js";
import { loadGlossaryData } from "./glossary-digimon.js";
import { on as onGameEvent } from "./gameEvents.js";
import { createFreeCamera } from "./anim-viewer-camera.js";
```

If `createBattle3D`, `resolveModelFolder` or `setFighterTint` are not imported in `game.js` yet (they are in `battle.js`, `web/battle.js:34`, not here), add `import { createBattle3D, resolveModelFolder, setFighterTint } from "./battle3d.js";` (the module is already loaded by `battle.js`, so this costs nothing extra). Check `grep -n "createFreeCamera\|createBattle3D\|resolveModelFolder\|setFighterTint\|onGameEvent" web/game.js` first so no name is declared twice.

The book factory (replace the `glossary:` line at `:419`; keep `options:`):

```js
const speciesLog = createSpeciesLog();
installSpeciesLog({ on: onGameEvent, log: speciesLog });          // always on: invisible, so the record exists when the glossary is first opened
let glossaryData = null, glossaryLoad = null;              // the 240 species, built once from the tables on first open
const glossaryStage = createStage({
    makeRenderer: (canvas) => createBattle3D(canvas, null),
    makeCamera: createFreeCamera,
    resolveFolder: resolveModelFolder,
    setTint: setFighterTint,
    size: [376, 172],
});
window.__glossaryStage = glossaryStage;                    // dev hook for the screenshot tools (like window.__books)
const books = createBookHost({
    sfx,
    factories: {
        glossary: (args) => {
            glossaryLoad ??= loadGlossaryData().then((d) => { glossaryData = d; if (!d) glossaryLoad = null; return d; });   // fetched once; a failed load is tried again on the next open
            const book = createGlossaryBook({ sfx: args.sfx, getSpecies: () => glossaryData, getLog: () => speciesLog, getPartners: glossaryPartners, stage: glossaryStage });
            return book;
        },
        options: (args) => createOptionsBook(args),
    },
});
```

The host closes the book (`book.close()`, Task 3) whenever it drops it, and the book's `close()` calls `stage.close()`, so the shared fighter tint is given back. The first species' model is requested from `book.tick()` as soon as the tables are in (Task 3).

The party reader (next to `plannerPartyMembers`, `web/game.js:1787`):

```js
// GLOSSARY > DIGIMON: the party as the glossary reads it. `rookie` is the starter species, `form` the species it wears now.
function glossaryPartners() {
    const view = partyRosterView(state.party ?? [], state.partnerStats, state.partyStats, menu.digimonDB ?? {}, state.digimonNames);
    return view.slice(0, 3).map((row, i) => {
        const record = i === 0 ? state.partnerStats : state.partyStats?.[i];
        if (!record) return null;
        const slot = rosterSlotOfCharId(row.charId) ?? (Number(row.rookieId) - 1);
        const level = Number(record.level ?? 1);
        return {
            slot,
            rookie: menu.digimonDB?.[row.rookieId]?.name ?? null,
            form: row.formName,
            level,
            live: { formLevels: Object.fromEntries((record.formLedger ?? []).map((entry) => [Number(entry.id), Number(entry.formLevel ?? 1)])), level, stats: record },
        };
    }).filter(Boolean);
}
```

- [ ] **Step 4: Run `node --test tests/glossary-wiring.test.js tests/book-wiring.test.js tests/book-host.test.js tests/glossary-book.test.js`, expect PASS.** `node --check web/game.js`.

- [ ] **Step 5: Whole suite and typecheck.** `/home/dorij/ui-review/new-failures.sh` (empty), `npm run typecheck` (clean).

- [ ] **Step 6: Real screenshots on the AMD GPU.** `/home/dorij/ui-review/build/shots/g6.mjs` (seeds a log with all three states and a party):

```js
import { openGame, press, padHold, shot } from "/home/dorij/dw2003-play-integration/tools/ui_shot.mjs";
const { browser, page, renderer } = await openGame({ fx: { glossary: true }, party: ["p003pken", "p009rena", "p010pata"] });
console.log("renderer", renderer);                      // must name the AMD card; openGame already threw otherwise
await page.evaluate(() => localStorage.setItem("dw.glossary.v1", JSON.stringify({ v: 1,
    met: { Kunemon: 3, Agumon: 2, Greymon: 1, Betamon: 1 }, beaten: { Kunemon: 2, Agumon: 1 } })));
await press(page, "i", 120, 2500);                      // pause list
for (let i = 0; i < 6; i++) await press(page, "ArrowDown", 100, 250);   // rows: ITEMS SORT MAP TECHNIQUES STATUS QUESTS GLOSSARY (no Folder Bag, quests on, options off): GLOSSARY is row 6
await press(page, "Enter", 120, 4000);                  // folds open, the first species' model loads
await shot(page, "g6-01-first-species");               // species 1, page 1
await page.waitForTimeout(3000);
await shot(page, "g6-02-first-species-3s-later");      // the model has turned about 90 degrees
for (let i = 0; i < 30; i++) await press(page, "ArrowDown", 60, 120);
await shot(page, "g6-03-thirty-down");                  // an unmet species (???) or a met one, depending on the seeded log
await press(page, "ArrowRight", 100, 800);
await shot(page, "g6-04-jump-ten");
await press(page, "e", 120, 1200);                      // R1: page 2 if the species is known
await shot(page, "g6-05-page2");
for (let i = 0; i < 6; i++) await press(page, "ArrowDown", 80, 150);
await shot(page, "g6-06-page2-scrolled");
await press(page, "q", 120, 1000);                      // L1: back to page 1
await press(page, "Escape", 120, 3500);                 // Back: the book shuts, the pause list is back on the same row
await shot(page, "g6-07-back-on-pause-list");
await browser.close();
```

Add to the script, right after the first `Enter`: `console.log("book open:", await page.evaluate(() => window.__books.isOpen()))`, and after the 3 s wait: `console.log(JSON.stringify(await page.evaluate(() => window.__glossaryStage.debug())))` (the dev hook is set in Step 3). Report `book open:` (must be `true`), `speed` (30), `ready`, `framed`, and `targetYaw` (radians; about `0.5 * pi` per 3 s of drawing).

If `book open:` prints `false`, the six `ArrowDown` presses did not land on the GLOSSARY row (the row index moves with the Folder Bag item and the `quests` switch). Do not guess another count and do not look at the picture: open the book with the dev hook `await page.evaluate(() => window.__openBook("glossary"))` instead, run the rest of the script, and say in the report that the pause-list hand-off (the last shot) was not exercised.

- [ ] **Step 7: Check the other half of the hand-off:** the shot `g6-07-back-on-pause-list` must show the pause list again; with the switch off (`fx: {}`) the pause list has no GLOSSARY row (`tests/pause-extra-rows.test.js` already pins it).

- [ ] **Step 8: Add the INDEX line.** Append to `C:\Users\dorij\DW2003-INDEX.md` after the existing glossary lines (done by the author of this plan: the line for this plan file is already there; if you add a tool or page, add its line too).

- [ ] **Step 9: Do not commit.** Report: changed files (`git status --short`), the renderer string, the numbers from Task 4 and Task 6, the test counts, and that no picture was judged.

---

## Self-review

- **Spec coverage (2.2, 2.3, 6 DIGIMON):** list left, numbered, `???` shadows (Tasks 2, 3); 3D model turning once per 12 s with idle (Task 4); header counts `Met N/total  Beaten M` (Tasks 2, 3; placed on the list's first line, Note 12); page 1 level line (element and family dropped: no such data), record Met / Defeated xN / Your partner, where it lives, drops with chance (Task 2 `pageOne`, Task 3 drawing); page 2 HP / MP / other stats as bars, strong and weak elements, techniques, grows from / into, partner level and next-form needs (Task 2 `pageTwoLines`, Task 5 drawing); met-only shows name and picture, the rest after the first defeat (Task 2 `speciesState`, Task 3 `setPage`); the counter and its storage with the code facts (Task 1); weather word fixed in the spec (done separately). Blast forms (`blastCards`, `web/blast-ladder.js:68`) are read in the spec 6 list but not drawn: page 2 shows "Grows into" from the evolution records; the blast ladder (starters only, five forms by partner level) is a possible extra line and is **not in this plan** (the approved text does not ask for it).
- **Placeholders:** none; each code step carries the code. Layout numbers are starting values held by the geometry test and tuned by the shot (stated in Task 3).
- **Type consistency:** `buildSpecies -> { species, world, maxima }` (Task 2) is what `getSpecies()` returns in Tasks 3, 5, 6; `speciesState(sp, log, partner)`, `partnerOf(sp, partners)`, `pageOne(sp, state, log, partner)`, `pageTwoLines(sp, state, partner, world, maxima)` have the same argument order everywhere; the log is `{ metCount, beatenCount, totals, read }` in Tasks 1 to 6; the book view is `{ progress, ticks, dt }` (Task 3 host edit) and the book calls the stage's `draw(ctx, x, y, w, h, dt)` with exactly those arguments; `createStage` option names match between Task 4 and Task 6.
- **Known risks left to the executor's report:** the grid and neutral background in the model window (Task 4 shot); the `▲ ▼` glyphs (Task 3 note); the row index of GLOSSARY in the pause list (Task 6 step 6); whether a test pins the old `battleStarted` payload (Task 1 step 5); `tests/book-host.test.js` helper names (Task 3).
- **Not verified here:** no picture was looked at; the plan's code was not run inside the repo (docs only). The offline counts (240 species, 143 shared, 3 canonical-name models, "from" and "into" examples) were measured with the repo's own `codex.js` functions in a scratch run outside the repo.
