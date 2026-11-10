# GLOSSARY and OPTIONS Implementation Plan (build steps 1 and 2 in full, steps 3 to 6 outlined)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No step in this plan commits.**

**Goal:** Two new pause-menu entries, OPTIONS (player settings, 4 pages) and GLOSSARY (a book), built on one shared window kit that looks and moves like the game's own menus. This plan builds the kit, the pause-list rows (step 1) and OPTIONS (step 2).

**Architecture:** The pause list (engine/dw3/ui/pause-root-session.ts) learns to hold any number of extra rows. Choosing GLOSSARY or OPTIONS ends the list with a `book` result; `web/book-host.js` then runs a small canvas screen over the frozen field (the same hand-off the Card Album uses), and gives the pause list back on the same row. Screens are made of the game's own pieces (cmfont and ststat plates, the status wall, the pixel font, the pause pad port) through a thin kit (`web/ui-kit.js`). OPTIONS reads and writes the same store as F2 (`fx`, localStorage `dw.fx.v1`).

**Tech Stack:** Plain ES modules in `web/`, TypeScript in `engine/` (bundled to `web/vendor/engine.js` by `npm run build:engine`), `node --test`, Playwright Chromium on the AMD GPU for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-04-glossary-and-options-design.md` (approved). Read it before starting; this plan argues from it and the "Notes on the spec" section below lists where the code differs.

Repo: `/home/dorij/dw2003-play-integration` (WSL). From Windows run commands as `wsl.exe -e bash -lc '...'`. All paths below are relative to the repo unless absolute.

## Global Constraints

- **NO git commits in any step. Do not commit, do not push, do not merge.** Where a normal plan would commit, the step is: "do not commit; report the changed files" (`git status --short` and list them in the report).
- Node for every test: `export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH` then `cd /home/dorij/dw2003-play-integration` then `npm test` (`node --test 'tests/*.test.js' 'tests/lane-b/*.test.js'`, about 2 minutes). A baseline of 37 known failing tests is in `/home/dorij/dream/baseline-failing.txt`. **No new failure is allowed.** The check (made and run once while writing this plan, it printed nothing, so there is no new failure at the start) is the script created in Task 1: `/home/dorij/ui-review/new-failures.sh`; it must print nothing under "new failures". Also `npm run typecheck` must stay clean (it is clean now).
- **Screenshots: GPU only.** Use `tools/run-playwright.sh` (sets `GALLIUM_DRIVER=d3d12`) and `tools/verify-launch.mjs` (HARDWARE args) through `tools/ui_shot.mjs` (Task 1), which prints the WebGL renderer and THROWS unless it names an AMD card. SwiftShader or llvmpipe = **stop and report**, never fall back. Game server: `python3 /home/dorij/serve_game.py` on port 8090 (start it hidden if it is not already answering: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8090/index.html` must print 200). Screenshots go to `/home/dorij/ui-review/build/<task>.png`; the main session looks at them. The executor never judges a picture and never asks the user to look.
- Every task ends with: its node tests pass, the new-failures check is empty, and a GPU screenshot saved to `/home/dorij/ui-review/build/<task>.png`. (Tasks that add only pure modules re-take the unchanged pause list, which proves nothing leaked into the old screen.)
- **New things default OFF** behind dev switches `glossary` and `options` (EXPERIMENTAL list in `web/ambience.js`). With both off the old pause list is byte for byte what it is today. F2 is **not** trimmed in step 2 (that is step 6, after the user accepts OPTIONS). Settings are F2 toggles, never URL flags.
- **Public repo: never add disc-derived data files.** Everything below is code and numbers measured from code; the cmfont tile recipe is geometry, not art. Tests that read `web/assets/**` (a symlink to the local extraction, never committed) skip themselves when the file is missing.
- **Keyboard and gamepad: reuse the game's existing input.** Keyboard and pad both end as the same *word-bit* button names in `state.keys` (`web/game.js` dispatchInput line 7680 adds them; `web/input.js` `attachGamepad` feeds the pad into the same dispatcher). In English the face buttons are swapped from the physical ones (`engine/systems/input-map.ts` `PAD_FACE_WORD_SWAP`): **CONFIRM is the word `circle`** (Enter, Space, Z, C; pad bottom button), **BACK is the word `cross`** (Escape, X; pad top button), Q and E are `l1` and `r1`, I is `start`, arrows and W A S D are `up down left right`. New screens read these through `ui.MenuPadWords` (the pause pages' own pad port), never through a second reader.
- Look: the game's own menus. OPTIONS and GLOSSARY reuse the **QUESTS page's layout** (`engine/dw3/ui/native/pause-quests.ts`): slanted top bar = cmfont clip 0x18 at (34, 13); list window = cmfont clip 0x24 at (0xa8, 0x28) with rows at x 0xbd, y 0x31 + 0xe*i and the cursor at x 0xb0; help box = ststat clip 0x20 at (0, 194) with text at (20, 198) and (20, 212); pause-list sounds; panels fold open in 10 steps and shut in 5. Navy see-through panels with the blue double frame and cut corners are those clips. Pixel font via `web/uifont.js`, white cursor via `drawCursor`, orange numbers = font kind 3. The blue tiled wall with the emblem is the status backdrop (`web/status-backdrop.js`, ststat clip 0x1d). The executor reads the layout from the code above, not from pictures.
- Plain English text. Pause strings use letters, digits and spaces only.
- Do not create worktrees, clones or copies of the repo. All work is in `/home/dorij/dw2003-play-integration`.
- `web/vendor/` is not tracked by git (it is excluded locally) and is a build output of `npm run build:engine`. Engine (TypeScript) edits reach the browser only after that rebuild. `npm run build:engine` is part of Task 2; see its note.

## Notes on the spec (read, measured, and different from what the spec says)

1. **Weather values.** The spec says F2 weather values are random / always / stormy / clear. In the code they are `auto` / `always` / `storm` / `clear` (`web/ambience.js:481` reads `"storm"`; the F2 select at `:1169` offers `auto`, `always`, `storm`, `clear`). The plan uses the real ones; labels are Random / Always / Storms / Clear.
2. **Fold lengths.** "10 frames to open, 5 to close" is right for the motion, but the tween (`engine/dw3/ui/fold-tween.ts`, integer step) reaches 4095 of 4096 after 10 ticks and lands on the **11th**; the close lands on the 5th. Tests pin 11 and 5.
3. **Repeat ladder.** The spec's `padRepeatFires` (`input-map.ts:334`) first repeats 16 ticks after the edge. The pause pages use `ui.MenuPadWords` (`engine/dw3/ui/pad-words.ts`), which repeats at ticks 16, 22, 26, 30 after a press at tick 1 (15, then 6, then 4). The plan uses `MenuPadWords` because the pause list itself does. One tick of difference on the first repeat.
4. **Button words.** In English Confirm is the word `circle` and Back the word `cross` (see Global Constraints). The spec's table is about physical buttons.
5. **The free-size double frame (spec 5.2 "not read yet") is solved.** The pause list's row panel is a grid of six cmfont tile frames (56 to 61), 40 px wide, 4 columns: top band 22 px, one 14 px band per row after the first two, bottom 20 px. Clips 0x1c, 0x1b, 0x19 (5, 6, 7 rows: 84, 98, 112 px) are exactly that grid (a test rebuilds them layer for layer). Eight and nine rows (126, 140 px) are the same tiles with more bands. No new art, no fixed-size problem; the "one BOOK row" fallback is not needed for the panel.
6. **More than one extra row needs more than a longer list.** The party cards own widget slots 0x28 to 0xac and the cursor sits at 0xb0 once there are more than six rows, so rows 8 and 9 take slots 0xb4 and 0xb8 and the slot block grows (`pauseSlotArea`).
7. **EXTRAS rows and "Quests stays on".** Today only `quests` is on; `questtriggers`, `questemotes`, `questplacecard`, `questsecondjob` are off. A row that shows "on only when all keys are on" would show Quests off at first. The plan shows a row ON when **any** of its keys is on, and moving it sets all of them.
8. **Quest page text.** The QUESTS description line "Talk to people and explore. New quests unlock as you play." (58 characters) runs off the band; the page also cuts other lines by character count. Task 5 fixes both by measuring text.
9. `web/vendor/engine.js` is not in git and the dream ledger says it can be stale against the TypeScript. Task 2 rebuilds it (this repo's own `npm run build:engine`).
10. Detail Low and Medium key lists are **not decided in the spec**. Task 6 ships them empty (Low and Medium then differ from High only by `fx.quality`); Task 7 measures and fills them.

## Review Focus

Failure modes the spec implies but does not test, most likely first. Each has a test in the task that owns the code.

1. **The Enter that chose the row is still down when the book opens** and would confirm the first row or close it. Test: Task 3 `book-host.test.js` "a confirm that was down when the book opened does not act", `ui-kit-input.test.js`.
2. **Back is still down when the book shuts and the pause list reopens**, so the list sees a fresh Back press and closes the whole pause. Test: Task 3 "the pause list does not come back while the pad is still held".
3. **No Folder Bag:** the extra rows sit one row higher; picking by position must still hit the right book. Test: Task 2 "without the Folder Bag the extras sit one row higher".
4. **Old or hand-edited saved settings** (`weatherMode: "stormy"`, volume 7, battle speed 99, a pixel filter that no longer exists, no volume at all) must give every row a text and never throw. Test: Task 6 `options-old-saves.test.js`.
5. **Wide window and long text:** the dim must cover the wide-screen sides, labels and help text must be fitted by measured width (the font is proportional). Tests: Task 3 `book-host-draw.test.js`, Task 5 `text-fit.test.js`, Task 9 `options-book.test.js` (every page draws at fold 0, 0.5 and 1 without throwing).

## File Structure

Create (all new; none is disc-derived):

| File | Responsibility |
|---|---|
| `tools/ui_shot.mjs` | GPU-only game launcher and screenshot helper; refuses software renderers |
| `web/panel-kit.js` | free-height panels from the pause list's six cmfont tiles; registers clips for 8 to 12 rows |
| `web/ui-kit-input.js` | the pause pad port (`MenuPadWords` + `MenuDisplayClock`) behind one `step` / `advance` for the book screens |
| `web/ui-kit.js` | folds and fold chain, plates (header, footer, list window, help box), bar, dim |
| `web/book-host.js` | runs one book over the frozen field: opens through folds, feeds the pad, shuts, hands back to the pause list |
| `web/book-blank.js` | the empty book (GLOSSARY in step 1) |
| `web/pause-extra-rows.js` | which extra rows the pause list gets, in order |
| `web/text-fit.js` | fit and wrap text by measured width |
| `web/options-model.js` | OPTIONS rows, pages, Detail presets, cursor; pure |
| `web/detail-presets.js` | keys Low and Medium switch off (generated by the measure tool) |
| `web/volume-levels.js` | music and sound volumes as multipliers of the game's own gains |
| `web/options-book.js` | the OPTIONS screen (drawing and keys) |
| `tools/measure_fx_cost.mjs` | measures each Detail effect's cost |

Modify: `engine/dw3/ui/native/pause-list.ts`, `engine/dw3/ui/pause-root-session.ts`, `web/screenpack.js`, `web/status-translated.js`, `web/ambience.js`, `web/audio.js`, `web/fxaudio.js`, `web/quests.js`, `web/game.js`. Tests are listed per task.

---

## Step 1: window kit, input, folds, wall, extra rows in the pause list

### Task 1: GPU screenshot helper and the new-failures check

**Files:**
- Create: `tools/ui_shot.mjs`
- Create: `/home/dorij/ui-review/new-failures.sh` (outside the repo)
- Create: `/home/dorij/ui-review/build/shots/t1.mjs` (outside the repo)
- Test: `tests/ui-shot.test.js`

**Interfaces:**
- Produces: `rendererIsGpu(string): boolean`, `openGame({ fx, map, port, width, height, inventory }): Promise<{ browser, page, renderer }>` (throws on a software renderer), `shot(page, name): Promise<path>`, `press(page, key, ms, after)`, `padHold(page, index, ms, after)`, `SHOT_DIR`. Later tasks import these.

- [ ] **Step 1: Write the failing test** `tests/ui-shot.test.js`

```js
// The screenshot helper refuses software renderers (tools/ui_shot.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { SHOT_DIR, rendererIsGpu } from "../tools/ui_shot.mjs";

test("AMD hardware strings pass; SwiftShader, llvmpipe, software and unknown strings fail", () => {
    assert.equal(rendererIsGpu("ANGLE (AMD, D3D12 (AMD Radeon RX 9060 XT), OpenGL 4.6)"), true);
    assert.equal(rendererIsGpu("D3D12 (AMD Radeon(TM) Graphics)"), true);
    assert.equal(rendererIsGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"), false);
    assert.equal(rendererIsGpu("llvmpipe (LLVM 15.0.7, 256 bits)"), false);
    assert.equal(rendererIsGpu("Software rasterizer AMD"), false);
    assert.equal(rendererIsGpu("Mesa Intel(R) UHD"), false);
    assert.equal(rendererIsGpu(""), false);
    assert.equal(rendererIsGpu(undefined), false);
});

test("screenshots go to the review folder the main session reads", () => {
    assert.equal(SHOT_DIR, "/home/dorij/ui-review/build/");
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `node --test tests/ui-shot.test.js` Expected: FAIL, `Cannot find module '../tools/ui_shot.mjs'`.

- [ ] **Step 3: Create `tools/ui_shot.mjs`**

```js
// tools/ui_shot.mjs -- GPU-only game screenshots for the UI work (GLOSSARY / OPTIONS). Numbers and files; the main session looks.
//
//   tools/run-playwright.sh yourscript.mjs        (run-playwright.sh sets GALLIUM_DRIVER=d3d12 so Chromium gets the AMD GPU)
//   import { openGame, shot, padHold, rendererIsGpu } from "./ui_shot.mjs";
//
// openGame() launches Chromium through tools/verify-launch.mjs (HARDWARE args), prints the WebGL renderer string and THROWS if it
// is a software renderer (SwiftShader, llvmpipe) or not an AMD card. Serve the game first: python3 /home/dorij/serve_game.py (port 8090).
import { mkdirSync } from "node:fs";
import { launch } from "./verify-launch.mjs";

export const SHOT_DIR = "/home/dorij/ui-review/build/";

/** True for an AMD hardware renderer string; false for SwiftShader, llvmpipe, softpipe or anything that is not AMD / Radeon. */
export function rendererIsGpu(renderer) {
    const s = String(renderer ?? "");
    if (/swiftshader|llvmpipe|softpipe|software/i.test(s)) return false;
    return /AMD|Radeon/i.test(s);
}

/**
 * Start the game on `map` with the given F2 settings (written to localStorage before the page loads, so a dev switch is on
 * from the first frame) and a fake gamepad driven by window.__btn (a standard-mapping button index, -1 = none).
 */
export async function openGame({ fx = {}, map = "s580", port = 8090, width = 1280, height = 720, inventory = [] } = {}) {
    mkdirSync(SHOT_DIR, { recursive: true });
    const browser = await launch();
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript((settings) => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("dw.fx.v1", JSON.stringify(settings));
        window.__btn = -1;
        navigator.getGamepads = () => {
            const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === window.__btn, touched: i === window.__btn, value: i === window.__btn ? 1 : 0 }));
            return [{ id: "fake", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons, timestamp: performance.now() }];
        };
    }, fx);
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/index.html?skipTitle=1&map=${map}`);
    await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 90000 });
    await page.waitForTimeout(3000);
    await page.evaluate((items) => { for (const it of items) window.__state.inventory.push(it); }, inventory);
    const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "no WebGL";
    });
    console.log(`WebGL renderer: ${renderer}`);
    if (!rendererIsGpu(renderer)) { await browser.close(); throw new Error(`NOT the AMD GPU (${renderer}): stop and report`); }
    return { browser, page, renderer };
}

/** Save the whole page to /home/dorij/ui-review/build/<name>.png and return the path. */
export async function shot(page, name) {
    const path = `${SHOT_DIR}${name}.png`;
    await page.screenshot({ path });
    console.log(`saved ${path}`);
    return path;
}

/** A keyboard key down and up (Playwright key names: "i", "Enter", "ArrowDown", "Escape", "q", "e"). */
export async function press(page, key, ms = 120, after = 400) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(after);
}

/** Press a standard-mapping gamepad button (0 bottom = confirm, 3 top = back, 4 L1, 5 R1, 12-15 d-pad) for `ms`. */
export async function padHold(page, index, ms = 120, after = 300) {
    await page.evaluate((i) => { window.__btn = i; }, index);
    await page.waitForTimeout(ms);
    await page.evaluate(() => { window.__btn = -1; });
    await page.waitForTimeout(after);
}
```

- [ ] **Step 4: Run the test, expect PASS** (`node --test tests/ui-shot.test.js`, 2 tests).

- [ ] **Step 5: Create the new-failures check** `/home/dorij/ui-review/new-failures.sh` and make it executable (`chmod +x`)

```bash
#!/usr/bin/env bash
# Runs the whole suite and prints every failing test that is NOT in the known baseline. Must print nothing under the heading.
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH
cd /home/dorij/dw2003-play-integration
npm test > /tmp/full.txt 2>&1
sed -n 's/^ *✖ \(.*\) ([0-9.]*ms)$/\1/p' /tmp/full.txt | sort -u > /tmp/now-failing.txt
echo "new failures (must be empty):"
comm -13 <(sort -u /home/dorij/dream/baseline-failing.txt) /tmp/now-failing.txt
```

Run it: `/home/dorij/ui-review/new-failures.sh` (about 2 minutes). Expected: the heading and nothing after it.

- [ ] **Step 6: Screenshot of today's pause list** (proves the GPU path and records the "before"). Create `/home/dorij/ui-review/build/shots/t1.mjs`:

```js
import { openGame, press, shot } from "/home/dorij/dw2003-play-integration/tools/ui_shot.mjs";
const { browser, page } = await openGame({ fx: {} });
await press(page, "i", 120, 2500);          // START opens the pause list; the folds take about a second
await shot(page, "01-pause-list-before");
await browser.close();
```

Run: `cd /home/dorij/dw2003-play-integration && tools/run-playwright.sh /home/dorij/ui-review/build/shots/t1.mjs`. Expected output: `WebGL renderer: ... AMD ...` and `saved /home/dorij/ui-review/build/01-pause-list-before.png`. If it throws "NOT the AMD GPU": stop and report.

- [ ] **Step 7: Do not commit.** Report changed files (`git status --short`).

---

### Task 2: extra rows in the pause list (engine), free-height panel tiles

**Files:**
- Modify: `engine/dw3/ui/native/pause-list.ts` (host option `extraRow` becomes `extraRows`; helpers `pausePanelClip`, `pauseRowSlot`, `pauseSlotArea`; rows 7 and up in their own slots)
- Modify: `engine/dw3/ui/pause-root-session.ts` (seed `extraRow` becomes `extraRows`; `book` result; slot block size)
- Modify: `web/screenpack.js` (register the extra panel clips when cmfont loads)
- Create: `web/panel-kit.js`
- Test: `tests/pause-list-extra-rows.test.js`, `tests/panel-kit.test.js` (the lane-b oracle `tests/lane-b/pause-list.test.js` and `tests/map-visited-flag.test.js` must still pass unchanged)

**Interfaces:**
- Produces (TypeScript): `PAUSE_PANEL_EXTRA_BASE = 0x100`, `pausePanelClip(rows)`, `pauseRowSlot(i)`, `pauseSlotArea(extraCount)` from `pause-list.ts`; `PauseSeed.extraRows?: ReadonlyArray<{ label: string; opens: string }>`; `PauseRootSession.homeResult()` may now return `{ kind: "book"; book: string; row: number }`.
- Produces (JS): `web/panel-kit.js` `PAUSE_PANEL_EXTRA_BASE`, `PANEL_FRAMES`, `PANEL_COLS`, `tileFrames(ids)`, `panelHeight(frames, bands)`, `buildPanelClip(frames, cols, bands)`, `registerPausePanels(ids, maxRows)`.
- Measured facts used (read from `web/assets/ui/cmfont_sheet.json`, 2026-11-04): clips 0x1c / 0x1b / 0x19 are 160 x 84 / 98 / 112 with 20 / 24 / 28 layers; frames 56 (top-left 40x22), 57 (top 40x22), 58 (left 40x14), 59 (mid 40x14), 60 (bottom-left 40x20), 61 (bottom 40x20).

- [ ] **Step 1: Write the failing tests.** `tests/pause-list-extra-rows.test.js`:

```js
// EXTRA rows on the pause home list (not on the disc): the list takes any number of rows after its own,
// keeps the disc's list byte for byte when there are none, and the nine-row case (Folder Bag + QUESTS +
// GLOSSARY + OPTIONS) puts every label on its own widget and picks a panel clip that is tall enough.
import test from "node:test";
import assert from "node:assert/strict";
import { PauseRootSession } from "../engine/dw3/ui/pause-root-session.ts";
import { PAUSE_PANEL_EXTRA_BASE, pausePanelClip, pauseRowSlot, pauseSlotArea } from "../engine/dw3/ui/native/pause-list.ts";
import { pauseResources, pauseSeed } from "./helpers/pause-resources.js";

const THREE = [
    { label: "QUESTS 2", opens: "quests" },
    { label: "GLOSSARY", opens: "glossary" },
    { label: "OPTIONS", opens: "options" },
];
const DISC_ROWS = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS", "CARD FOLDERS"];

const homeSession = (over = {}) => new PauseRootSession(2, pauseSeed("home", over), pauseResources(2), { playSound: () => {} });
/** Tick until the list is open and waiting for the player (step 3 of its open sequence). */
function settle(session) {
    for (let i = 0; i < 400 && session.mem.read32(session.root + 0x10) !== 3; i++) session.tick([]);
    assert.equal(session.mem.read32(session.root + 0x10), 3, "the list finished opening");
}
/** One press: the button for one frame, then nothing for one frame. */
function press(session, button) { session.tick([button]); session.tick([]); }
/** The text a row widget holds, decoded with the game's codes (0x04+n digit, 0x0E+n capital, 0x28+n lower case, 0x01 0x01 space). */
function widgetText(mem, widget) {
    const rec = widget + 0x5c, buf = mem.read32(rec) >>> 0, len = mem.read16(rec + 6) & 0xff;
    let out = "";
    for (let i = 0; i < len; i++) {
        const c = mem.read8(buf + i);
        if (c === 0x01) { if (mem.read8(buf + i + 1) === 0x01) { out += " "; i++; } continue; }
        if (c >= 0x04 && c <= 0x0d) out += String(c - 0x04);
        else if (c >= 0x0e && c <= 0x27) out += String.fromCharCode(0x41 + c - 0x0e);
        else if (c >= 0x28 && c <= 0x47) out += String.fromCharCode(0x61 + c - 0x28);
    }
    return out;
}
const rowLabels = (session) => {
    const mem = session.mem, slots = mem.read32(session.root + 0x24) >>> 0, count = mem.read32(session.root + 0x5c) | 0;
    return Array.from({ length: count }, (_, i) => widgetText(mem, mem.read32(slots + pauseRowSlot(i)) >>> 0));
};
const panelClips = (session) => session.draw.calls.filter((c) => c.method === "drawSprite" && c.args[0] === 0x02860000 && c.args[1] >= 0x19 && c.args[1] !== 0x1a).map((c) => c.args[1]);

test("the helper numbers: panel clip per row count, row slots, slot block size", () => {
    assert.equal(PAUSE_PANEL_EXTRA_BASE, 0x100);
    assert.deepEqual([5, 6, 7, 8, 9].map(pausePanelClip), [0x1c, 0x1b, 0x19, 0x108, 0x109]);
    assert.deepEqual([0, 1, 6, 7, 8].map(pauseRowSlot), [0x0c, 0x10, 0x24, 0xb4, 0xb8]);
    assert.deepEqual([0, 1, 2, 3].map(pauseSlotArea), [0x84, 0xb4, 0xb8, 0xbc]);
});

test("no extra rows: the list is the disc's (five rows, panel clip 0x1c)", () => {
    const session = homeSession();
    settle(session);
    assert.equal(session.mem.read32(session.root + 0x5c), 5);
    assert.deepEqual(rowLabels(session), DISC_ROWS.slice(0, 5));
    assert.ok(panelClips(session).includes(0x1c), "the five-row panel is drawn");
});

test("one extra row is today's QUESTS row: six rows without the Folder Bag, seven with it", () => {
    const quests = [THREE[0]];
    let session = homeSession({ extraRows: quests });
    settle(session);
    assert.deepEqual(rowLabels(session), [...DISC_ROWS.slice(0, 5), "QUESTS 2"]);
    assert.ok(panelClips(session).includes(0x1b));
    session = homeSession({ extraRows: quests, cardFoldersUnlocked: true });
    settle(session);
    assert.deepEqual(rowLabels(session), [...DISC_ROWS, "QUESTS 2"]);
    assert.ok(panelClips(session).includes(0x19));
});

test("Folder Bag + QUESTS + GLOSSARY + OPTIONS: nine rows, each on its own widget, the nine-row panel", () => {
    const session = homeSession({ extraRows: THREE, cardFoldersUnlocked: true });
    settle(session);
    assert.equal(session.mem.read32(session.root + 0x5c), 9);
    assert.deepEqual(rowLabels(session), [...DISC_ROWS, "QUESTS 2", "GLOSSARY", "OPTIONS"]);
    assert.ok(panelClips(session).includes(0x109), "panel clip for nine rows");
    // the party cards' own widgets were not overwritten by rows 7 and 8
    const slots = session.mem.read32(session.root + 0x24) >>> 0;
    const rowWidgets = new Set(Array.from({ length: 9 }, (_, i) => session.mem.read32(slots + pauseRowSlot(i))));
    assert.equal(rowWidgets.size, 9, "nine different widgets");
});

test("the cursor walks the nine rows without wrapping and picks the right row", () => {
    const session = homeSession({ extraRows: THREE, cardFoldersUnlocked: true });
    settle(session);
    const row = () => session.mem.read32(session.root + 0x58) | 0;
    for (let i = 0; i < 12; i++) press(session, "down");
    assert.equal(row(), 8, "stops on the last row");
    for (let i = 0; i < 12; i++) press(session, "up");
    assert.equal(row(), 0, "stops on the first row");
});

test("choosing GLOSSARY or OPTIONS ends the list with a book result; QUESTS still opens its page", () => {
    const choose = (downs) => {
        const session = homeSession({ extraRows: THREE, cardFoldersUnlocked: true });
        settle(session);
        for (let i = 0; i < downs; i++) press(session, "down");
        press(session, "circle"); // the confirm word in English (engine/systems/input-map.ts PAD_FACE_WORD_SWAP)
        for (let i = 0; i < 200 && !session.finished(); i++) session.tick([]);
        assert.ok(session.finished());
        return session.homeResult();
    };
    assert.deepEqual(choose(6), { kind: "page", page: "quests", row: 6 });
    assert.deepEqual(choose(7), { kind: "book", book: "glossary", row: 7 });
    assert.deepEqual(choose(8), { kind: "book", book: "options", row: 8 });
    assert.deepEqual(choose(5), { kind: "page", page: "cardfolders", row: 5 }, "CARD FOLDERS is untouched");
});

test("without the Folder Bag the extras sit one row higher and still resolve by position", () => {
    const session = homeSession({ extraRows: THREE });
    settle(session);
    assert.equal(session.mem.read32(session.root + 0x5c), 8);
    for (let i = 0; i < 6; i++) press(session, "down");
    press(session, "circle");
    for (let i = 0; i < 200 && !session.finished(); i++) session.tick([]);
    assert.deepEqual(session.homeResult(), { kind: "book", book: "glossary", row: 6 });
});
```

`tests/panel-kit.test.js`:

```js
// Free-height panels from the pause list's own tiles (web/panel-kit.js). The tile recipe is checked against the sheet's
// own clips for five, six and seven rows, so the eight- and nine-row panels are the same recipe with more bands.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
    PANEL_COLS, PANEL_FRAMES, PAUSE_PANEL_EXTRA_BASE, buildPanelClip, panelHeight, registerPausePanels, tileFrames,
} from "../web/panel-kit.js";
import { PAUSE_PANEL_EXTRA_BASE as ENGINE_BASE, pausePanelClip } from "../engine/dw3/ui/native/pause-list.ts";

const SHEET = new URL("../web/assets/ui/cmfont_sheet.json", import.meta.url);
const haveSheet = existsSync(SHEET);
const load = () => { const j = JSON.parse(readFileSync(SHEET, "utf8")); return j.ids ?? j; };
const canon = (layers) => layers.map((l) => JSON.stringify([l.frame, l.x, l.y, l.w, l.h, l.dx, l.dy])).sort();

test("the web base equals the engine's, and the engine asks for base + rows above seven", () => {
    assert.equal(PAUSE_PANEL_EXTRA_BASE, ENGINE_BASE);
    assert.equal(pausePanelClip(8), PAUSE_PANEL_EXTRA_BASE + 8);
    assert.equal(pausePanelClip(9), PAUSE_PANEL_EXTRA_BASE + 9);
});

test("the recipe rebuilds the disc's 5, 6 and 7 row panels layer for layer", { skip: !haveSheet && "cmfont sheet not extracted here" }, () => {
    const ids = load();
    const frames = tileFrames(ids);
    assert.ok(frames, "the five-row panel carries all six tile frames");
    for (const [rows, clip] of [[5, "28"], [6, "27"], [7, "25"]]) {
        const built = buildPanelClip(frames, PANEL_COLS, rows - 2);
        assert.deepEqual(canon(built.layers), canon(ids[clip].layers), `${rows} rows = clip ${clip}`);
    }
});

test("heights are 84, 98, 112 for 5, 6, 7 rows and 126, 140 for 8, 9", { skip: !haveSheet && "cmfont sheet not extracted here" }, () => {
    const frames = tileFrames(load());
    assert.deepEqual([3, 4, 5, 6, 7].map((bands) => panelHeight(frames, bands)), [84, 98, 112, 126, 140]);
});

test("registerPausePanels adds clips 8..12 rows, 160 px wide, and leaves the disc's clips alone", { skip: !haveSheet && "cmfont sheet not extracted here" }, () => {
    const ids = load();
    const before = JSON.stringify(ids["25"]);
    assert.equal(registerPausePanels(ids), 5);
    assert.equal(JSON.stringify(ids["25"]), before);
    for (const rows of [8, 9]) {
        const clip = ids[String(PAUSE_PANEL_EXTRA_BASE + rows)];
        assert.equal(clip.layers.length, 4 * rows, "four tiles per band, rows bands");
        const w = Math.max(...clip.layers.map((l) => l.dx + l.w));
        const h = Math.max(...clip.layers.map((l) => l.dy + l.h));
        assert.deepEqual([w, h], [160, 14 * rows + 14]);
    }
});

test("a sheet without the six tiles gets no clips and does not throw", () => {
    const ids = { 28: { layers: [{ frame: 56, x: 0, y: 0, w: 40, h: 22, dx: 0, dy: 0 }] } };
    assert.equal(registerPausePanels(ids), 0);
    assert.deepEqual(Object.keys(ids), ["28"]);
    assert.equal(tileFrames({}), null);
    assert.equal(tileFrames(undefined), null);
});

test("screenpack.js registers the clips when the cmfont sheet loads", () => {
    const src = readFileSync(new URL("../web/screenpack.js", import.meta.url), "utf8");
    assert.match(src, /import \{ registerPausePanels \} from "\.\/panel-kit\.js";/);
    assert.match(src, /p\.ids = j\.ids \?\? j;\s*\n\s*if \(name === "cmfont"\) registerPausePanels\(p\.ids\);/);
});

test("PANEL_FRAMES names the six frames the disc's panels use", () => {
    assert.deepEqual(Object.values(PANEL_FRAMES), [56, 57, 58, 59, 60, 61]);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test tests/pause-list-extra-rows.test.js tests/panel-kit.test.js` Expected: FAIL (missing exports `pausePanelClip` etc., missing `web/panel-kit.js`).

- [ ] **Step 3: Apply the engine change to `pause-list.ts`** (unified diff; save it to `/tmp/t2-pause-list.diff` and run `git apply --recount /tmp/t2-pause-list.diff`, or make the same edits by hand):

```diff
--- a/engine/dw3/ui/native/pause-list.ts
+++ b/engine/dw3/ui/native/pause-list.ts
@@ -68,11 +68,13 @@
     /** ctx+0x84(pack, clip, x, y) */
     drawSprite(pack: number, clip: number, x: number, y: number): void;
     /**
-     * EXTRA (not on the disc): when the host supplies this and it returns a bank, the list gets one more row after its own,
-     * labelled by string 0 of that one-string text bank (`bank` is its address). The panel behind the rows is the disc's own
-     * seven-row clip. Absent or null leaves the list exactly as the disc builds it.
+     * EXTRA (not on the disc): when the host supplies this and it returns rows, the list gets that many more rows after its
+     * own, in order. Row n is labelled by string `text` of the text bank at address `bank`. The panel behind the rows is the
+     * disc's own clip for five, six or seven rows (`pausePanelClip`); for eight or more rows it is the synthetic clip
+     * `PAUSE_PANEL_EXTRA_BASE + rows`, which web/panel-kit.js builds out of the disc's own tiles. Absent or empty leaves the
+     * list exactly as the disc builds it.
      */
-    extraRow?(): { bank: number } | null;
+    extraRows?(): ReadonlyArray<{ bank: number; text: number }>;
 }
 
 const GAME = 0x80048d34;
@@ -96,11 +98,20 @@
  * past the party cards' slots (the third card's values end at 0xac) to 0xb0.
  */
 const cursorSlot = (mem: PauseListMemory, obj: number) => ((mem.read32(obj + 0x5c) | 0) > 6 ? 0xb0 : 0x24);
-/** The panel clip behind the rows: 0x1c (five rows) or 0x1b (six), exactly as on the disc, and the disc's own seven-row panel 0x19 when the extra row makes seven. */
-const panelClip = (mem: PauseListMemory, obj: number) => {
-    const rows = mem.read32(obj + 0x5c) | 0;
-    return rows > 6 ? 0x19 : (0x21 - rows) | 0;
-};
+/** First synthetic panel clip id: the clip for `rows` rows (eight or more) is `PAUSE_PANEL_EXTRA_BASE + rows` (web/panel-kit.js). */
+export const PAUSE_PANEL_EXTRA_BASE = 0x100;
+/** The panel clip behind `rows` rows: 0x1c (five) or 0x1b (six), exactly as on the disc, 0x19 for seven, a synthetic clip above. */
+export const pausePanelClip = (rows: number): number =>
+    rows > 7 ? PAUSE_PANEL_EXTRA_BASE + rows : rows > 6 ? 0x19 : (0x21 - rows) | 0;
+const panelClip = (mem: PauseListMemory, obj: number) => pausePanelClip(mem.read32(obj + 0x5c) | 0);
+/**
+ * Where row `i`'s text widget sits in the slot block. Rows 0-6 keep the disc's place (0x0c + 4i); the party cards own
+ * 0x28-0xac and the cursor sits at 0xb0 once there are more than six rows, so rows 7 and up go after the cursor.
+ */
+export const pauseRowSlot = (i: number): number => (i < 7 ? 0xc + i * 4 : 0xb4 + (i - 7) * 4);
+/** Bytes of slot block the list needs for `extraCount` extra rows: the disc's 0x84, or room up to the last row widget (at most six disc rows). */
+export const pauseSlotArea = (extraCount: number): number =>
+    extraCount > 0 ? 0xb4 + Math.max(0, 6 + extraCount - 7) * 4 : 0x84;
 const bank = (mem: PauseListMemory, host: PauseListHost) => host.textBank((mem.read32(BANK_BASE) + 0xb0) | 0);
 const slot = (mem: PauseListMemory, addr: number) => mem.read32(addr) | 0;
 
@@ -149,7 +160,7 @@
     const layer = s16(mem.read16(obj + 0x50));
     mem.write32(slots, host.createText(layer, 1, 0x98, 0x13));
     const rows = mem.read32(obj + 0x5c) | 0;
-    for (let i = 0; i < rows; i++) mem.write32(slots + 0xc + i * 4, host.createText(layer, 1, 0xbd, 0x31 + i * 0xe));
+    for (let i = 0; i < rows; i++) mem.write32(slots + pauseRowSlot(i), host.createText(layer, 1, 0xbd, 0x31 + i * 0xe));
     const cursor = host.createCursor(layer, 0, 0xb0, s16((mem.read32(obj + 0x58) | 0) * 0xe + 0x31));
     mem.write32(slots + cursorSlot(mem, obj), cursor);
     host.callMethod(cursor, 0x80, [0]);
@@ -298,15 +309,17 @@
         case 1:
             if (!pauseListFoldStep(mem, obj + 0x80)) return;
             pauseListCard(mem, slots, 1, 1, host);
-            const extra = host.extraRow?.() ?? null;
+            const extras = host.extraRows?.() ?? [];
+            const firstExtra = rows() - extras.length;
             for (let i = 0; i < rows(); i++) {
                 mem.write32(obj + 0x18, i);
-                if (extra && i === rows() - 1) { // the extra row's label comes from its own one-string bank
-                    host.callMethod(slot(mem, slots + 0xc + i * 4), 0x114, [extra.bank, 0]);
+                const extra = i >= firstExtra ? extras[i - firstExtra] : undefined;
+                if (extra) { // an extra row's label comes from its own text bank
+                    host.callMethod(slot(mem, slots + pauseRowSlot(i)), 0x114, [extra.bank, extra.text]);
                     continue;
                 }
                 const text = mem.read32(ROW_TEXT + i * 4 + (mem.read32(obj + 0x60) | 0) * 0x18) | 0;
-                host.callMethod(slot(mem, slots + 0xc + i * 4), 0x114, [bank(mem, host), text]);
+                host.callMethod(slot(mem, slots + pauseRowSlot(i)), 0x114, [bank(mem, host), text]);
             }
             mem.write32(obj + 0x18, Math.max(rows(), 0) || 0);
             host.sfx(PAUSE_LIST_SFX.open);
@@ -333,7 +346,7 @@
             pauseListCard(mem, slots, 1, 0, host);
             for (let i = 0; i < rows(); i++) {
                 mem.write32(obj + 0x18, i);
-                host.callMethod(slot(mem, slots + 0xc + i * 4), 0x144, [0]);
+                host.callMethod(slot(mem, slots + pauseRowSlot(i)), 0x144, [0]);
             }
             mem.write32(obj + 0x18, Math.max(rows(), 0) || 0);
             host.sfx(PAUSE_LIST_SFX.close);
@@ -419,7 +432,7 @@
         mem.write32(CARD_FLAG_OUT, 1);
         mem.write32(obj + 0x60, 1);
     } else mem.write32(CARD_FLAG_OUT, 0);
-    mem.write32(obj + 0x5c, ((mem.read32(obj + 0x60) | 0) + 5 + (host.extraRow?.() ? 1 : 0)) | 0);
+    mem.write32(obj + 0x5c, ((mem.read32(obj + 0x60) | 0) + 5 + (host.extraRows?.().length ?? 0)) | 0);
     mem.write32(obj + 0x64, pauseListMapGate(mem, host) >= 0 ? 1 : 0);
     pauseListWidgets(mem, obj, slots, host);
 }
```

- [ ] **Step 4: Apply the change to `pause-root-session.ts`:**

```diff
--- a/engine/dw3/ui/pause-root-session.ts
+++ b/engine/dw3/ui/pause-root-session.ts
@@ -60,7 +60,7 @@
   cardFoldersRoot, dimQuadFactory, dimQuadStart, dimQuadTick,
 } from "./native/pause-card-folders.ts";
 import { pauseGridWord, pauseSeenScan, pauseStageByte } from "./native/pause-misc.ts";
-import { pauseListBuild, pauseListTick } from "./native/pause-list.ts";
+import { pauseListBuild, pauseListTick, pauseSlotArea } from "./native/pause-list.ts";
 import { buildTextBankImage } from "./native/game-text.ts";
 import { QUESTS_HANDLER, questsFactory, questsRoot } from "./native/pause-quests.ts"; // EXTRA: the QUESTS page
 import { mapServerFromStage } from "./native/map-server.ts";
@@ -161,10 +161,11 @@
   /** Whether a map cell has been seen (the page's flag reader). */
   mapSeen?: (flagId: number) => boolean;
   /**
-   * EXTRA (not on the disc): one more row at the end of the pause home list, with this label (letters, digits and spaces).
-   * Choosing it opens the QUESTS page (`page: "quests"`), the builder the disc's own table names for that slot.
+   * EXTRA (not on the disc): more rows at the end of the pause home list, in order, each with its label (letters, digits and
+   * spaces). `opens: "quests"` opens the QUESTS page (the builder the disc's own table names for the slot after CARD FOLDERS);
+   * any other `opens` ends the list with `{ kind: "book", book, row }` and the browser opens that screen (GLOSSARY, OPTIONS).
    */
-  extraRow?: { label: string };
+  extraRows?: ReadonlyArray<{ label: string; opens: string }>;
   /** EXTRA (not on the disc): what the QUESTS page lists. Each entry's `lines` are the three description lines shown under the list. */
   quests?: {
     prompt: string; readPrompt: string;
@@ -213,7 +214,7 @@
   private frame = 0;
   private sawPage = false;
   private closed = false;
-  private homeResultValue: { kind: "page"; page: PausePage; row: number } | { kind: "exit" } | null = null;
+  private homeResultValue: { kind: "page"; page: PausePage; row: number } | { kind: "book"; book: string; row: number } | { kind: "exit" } | null = null;
   private homeBackdrop = 0;
 
   constructor(language: number, seed: PauseSeed, resources: PauseResources, host: PauseSessionHost) {
@@ -319,9 +320,10 @@
       cardFoldersFactory: (obj) => cardFoldersFactory(mem, obj, foldersHost),
       questsFactory: (obj) => questsFactory(mem, obj, questsHost),
     });
-    const extraBank = seed.page === "home" && seed.extraRow ? this.loadBank([seed.extraRow.label], 0x7f00) : 0;
+    const extraRows = seed.page === "home" ? (seed.extraRows ?? []) : [];
+    const extraBank = extraRows.length ? this.loadBank(extraRows.map((row) => row.label), 0x7f00) : 0;
     const homeHost = {
-      extraRow: () => (extraBank ? { bank: extraBank } : null),
+      extraRows: () => extraRows.map((_, text) => ({ bank: extraBank, text })),
       sfx: host.playSound,
       callMethod: (target: number, slot: number, args: number[]) => { this.call(target, slot, args); return 0; },
       textBank: (id: number) => this.banks.source(id),
@@ -414,7 +416,7 @@
     });
     this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
     if (seed.page === "home") {
-      this.root = this.tree.allocate(HOME_HANDLER, 0xac, seed.extraRow ? 0xb4 : 0x84); // 0xb4: room for the cursor's slot, which moves past the seventh row
+      this.root = this.tree.allocate(HOME_HANDLER, 0xac, pauseSlotArea(seed.extraRows?.length ?? 0)); // 0xb4 and up: room for the cursor's slot, which moves past the seventh row, and for rows 8 and 9
       pauseListBuild(mem, this.root, 0x1002, seed.homeRow ?? 0);
       if (seed.homeOverlay) {
         this.homeBackdrop = this.widgets.arena.alloc(0x60);
@@ -481,8 +483,11 @@
 
   private selectHomePage(): void {
     const row = this.mem.read32(PAUSE_ROW_CELL) | 0;
-    if (this.seed.extraRow && row === (this.mem.read32(this.root + 0x5c) | 0) - 1) {
-      this.homeResultValue = { kind: "page", page: "quests", row }; // EXTRA: the row after the disc's own
+    const extras = this.seed.extraRows ?? [];
+    const firstExtra = (this.mem.read32(this.root + 0x5c) | 0) - extras.length;
+    if (extras.length && row >= firstExtra) { // EXTRA: the rows after the disc's own
+      const extra = extras[row - firstExtra]!;
+      this.homeResultValue = extra.opens === "quests" ? { kind: "page", page: "quests", row } : { kind: "book", book: extra.opens, row };
       return;
     }
     const page = (["items", "sort", "map", "techniques", "status", "cardfolders"] as PausePage[])[row];
```

- [ ] **Step 5: Create `web/panel-kit.js`:**

```js
// web/panel-kit.js -- free-height panels built from the game's own pause-list tiles. Pure: no DOM, no imports.
//
// The pause list's row panel is not one picture. cmfont clips 0x1c (five rows), 0x1b (six) and 0x19 (seven) are each a
// grid of the same six tile frames, 40 px wide, four columns (160 px), one band per row after the first two:
//
//     band          height   column 0     columns 1-3
//     top           22       frame 56     frame 57
//     middle x n    14 each  frame 58     frame 59       (n = rows - 2)
//     bottom        20       frame 60     frame 61
//
// So clip height = 42 + 14 * (rows - 2) = 84 / 98 / 112 for 5 / 6 / 7 rows, which is what the sheet's own layer records
// measure (tests/panel-kit.test.js). The disc stops at seven rows. A list of eight or nine rows (Folder Bag + QUESTS +
// GLOSSARY + OPTIONS) takes the same tiles with more middle bands. The engine asks for clip PAUSE_PANEL_EXTRA_BASE + rows
// (engine/dw3/ui/native/pause-list.ts pausePanelClip); screenpack.js registers those clips when the cmfont sheet loads.

/** Must equal PAUSE_PANEL_EXTRA_BASE in engine/dw3/ui/native/pause-list.ts (pinned by tests/panel-kit.test.js). */
export const PAUSE_PANEL_EXTRA_BASE = 0x100;
/** The six tile frames of cmfont, by role. */
export const PANEL_FRAMES = Object.freeze({ topLeft: 56, top: 57, left: 58, mid: 59, bottomLeft: 60, bottom: 61 });
/** A tile is 40 px wide; the pause list's panel is four of them. */
export const PANEL_COLS = 4;
/** cmfont clip 0x1c (decimal 28): five rows, carries all six tile frames. */
const SOURCE_CLIP = "28";

/** Frame number -> { frame, x, y, w, h } read from the layer records of the pause list's own five-row panel. */
export function tileFrames(ids, sourceClip = SOURCE_CLIP) {
    const out = {};
    for (const l of ids?.[sourceClip]?.layers ?? []) out[l.frame] = { frame: l.frame, x: l.x, y: l.y, w: l.w, h: l.h };
    for (const f of Object.values(PANEL_FRAMES)) if (!out[f]) return null;
    return out;
}

/** Height of a panel with `bands` middle bands. */
export function panelHeight(frames, bands) {
    return frames[PANEL_FRAMES.topLeft].h + bands * frames[PANEL_FRAMES.left].h + frames[PANEL_FRAMES.bottomLeft].h;
}

/** A clip (the sheet's own record shape) with `cols` tile columns and `bands` middle bands. */
export function buildPanelClip(frames, cols, bands) {
    const F = PANEL_FRAMES;
    const tileW = frames[F.topLeft].w;
    const layers = [];
    const put = (frame, col, dy) => {
        const f = frames[frame];
        layers.push({ frame: f.frame, x: f.x, y: f.y, w: f.w, h: f.h, dx: col * tileW, dy });
    };
    let dy = 0;
    for (let c = 0; c < cols; c++) put(c === 0 ? F.topLeft : F.top, c, dy);
    dy += frames[F.topLeft].h;
    for (let b = 0; b < bands; b++) {
        for (let c = 0; c < cols; c++) put(c === 0 ? F.left : F.mid, c, dy);
        dy += frames[F.left].h;
    }
    for (let c = 0; c < cols; c++) put(c === 0 ? F.bottomLeft : F.bottom, c, dy);
    return { semi: -1, stp: false, layers };
}

/**
 * Add the clips for 8 to `maxRows` rows to a loaded cmfont `ids` table. Returns how many were added (0 when the sheet has
 * not got the six tiles, in which case nothing changes and the list falls back to the disc's panels).
 */
export function registerPausePanels(ids, maxRows = 12) {
    const frames = tileFrames(ids);
    if (!frames) return 0;
    let added = 0;
    for (let rows = 8; rows <= maxRows; rows++) {
        ids[String(PAUSE_PANEL_EXTRA_BASE + rows)] = buildPanelClip(frames, PANEL_COLS, rows - 2);
        added++;
    }
    return added;
}
```

- [ ] **Step 6: Register the clips when cmfont loads** (`web/screenpack.js`):

```diff
--- a/web/screenpack.js
+++ b/web/screenpack.js
@@ -8,6 +8,7 @@
 // authored dx/dy offsets. See docs/research/ui/menu-assets-decoded-2026-07-03.md.
 
 import { loadAssetImage } from "./assets.js";
+import { registerPausePanels } from "./panel-kit.js";
 
 const packs = {}; // name -> { img, map, ids, patterns }
 
@@ -38,6 +39,7 @@
   fetch(`assets/ui/${name}_sheet.json`).then((r) => r.json()).then((j) => {
     p.map = j;
     p.ids = j.ids ?? j;
+    if (name === "cmfont") registerPausePanels(p.ids);
   }).catch(() => {});
   return p;
 }
```

- [ ] **Step 7: Run the two new tests and the two old ones, expect PASS**

Run: `node --test tests/pause-list-extra-rows.test.js tests/panel-kit.test.js tests/lane-b/pause-list.test.js tests/map-visited-flag.test.js` Expected: all pass (7 + 7 new tests; the oracle and map tests unchanged).

- [ ] **Step 8: Typecheck and rebuild the engine bundle**

Run: `npm run typecheck` Expected: no output (clean). Then `npm run build:engine` (writes the untracked `web/vendor/engine.js` and `engine-native.js`). Then `node --test tests/bundle-split-no-interpreter.test.js` Expected: pass. Note: `web/vendor` is not in git; the dream ledger warned the bundle can be stale against the TypeScript, so a rebuild may bring in other recent engine changes: if the new-failures check (Step 9) then shows a failure outside the files of this task, stop and report it.

- [ ] **Step 9: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 10: Screenshot, pause list unchanged** (no extra rows besides QUESTS, so the engine change must be invisible). `/home/dorij/ui-review/build/shots/t2.mjs`: same as t1 but `await shot(page, "02-pause-list-unchanged")`. Run it as in Task 1 Step 6.

- [ ] **Step 11: Do not commit.** Report changed files.

---

### Task 3: kit input, folds, plates, book host, blank book

**Files:**
- Create: `web/ui-kit-input.js`, `web/ui-kit.js`, `web/book-host.js`, `web/book-blank.js`
- Test: `tests/ui-kit-input.test.js`, `tests/ui-kit.test.js`, `tests/book-host.test.js`, `tests/book-host-args.test.js`, `tests/book-host-draw.test.js`

**Interfaces:**
- Consumes: Task 2 `web/panel-kit.js` (`buildPanelClip`, `tileFrames`); `ui.MenuPadWords`, `ui.MenuDisplayClock`, `ui.createFoldTween`, `ui.startFold`, `ui.startFoldClose`, `ui.tickFold`, `ui.foldProgress`, `ui.FOLD_MAX`, `ui.FOLD_CLOSE_RATE`, `maskFromButtons`, `buttonsFromMask`, `isPadButton`, `buttonForKey` from `web/vendor/engine.js` (all present in the current bundle; re-check with `grep -c` if the bundle is rebuilt); `web/screenpack.js`, `web/uifont.js`, `web/status-backdrop.js`.
- Produces: `createKitInput(): { reset(held), step(held, tick): Set<string>, advance(dt, held): Set<string>[] }`, `WORD = { confirm: "circle", back: "cross", prev: "l1", next: "r1", start: "start" }`, `REPEATING`; `ui-kit.js`: `createFold(steps)`, `createFoldChain(names, { steps, onStart })` (`.folds`, `.phase()`, `.open()`, `.close()`, `.tick()`), `withFold(ctx, progress, px, py, axis, draw)`, `drawPanel(ctx, x, y, cols, bands)`, `drawHeader(ctx, progress, title, tabs, active)`, `drawFooter(ctx, progress, line1, line2)`, `drawBar`, `barFill`, `dimField`, `panelPixelHeight`, `layoutTabs`, `HEADER`, `FOOTER`, `LIST_WINDOW`, `LIST_VALUE_RIGHT`, `drawListWindow(ctx, progress, rows)`, `listRowY(i)`, `drawHelpBox(ctx, progress, text)`, `SFX_OPEN = 0x40019`, `SFX_CLOSE = 0x4001a`; `createBookHost({ sfx, factories, fx, setFx, setFxMany })` with `.open(name, onBack, held)`, `.close()`, `.update(dt, held)`, `.draw(ctx, viewW, viewH, padL)`, `.isOpen()`; the **book interface** `{ windows: string[], wall: boolean, act(buttons: Set<string>): "back" | null, tick?(), draw(ctx, view) }` with `view = { progress(windowName), ticks }`; `createBlankBook({ title })`.
- Note: `ui-kit.js` below already contains the QUESTS-layout helpers (`LIST_WINDOW`, `drawListWindow`, `drawHelpBox`) and imports `web/text-fit.js`; **create `web/text-fit.js` here too** (its tests come in Task 5; it is pure, 40 lines).

- [ ] **Step 1: Write the failing tests**, five files.

`tests/ui-kit-input.test.js`:

```js
// The book screens' pad reader (web/ui-kit-input.js): repeat ladder, no repeat on face buttons, the opening press is ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { REPEATING, WORD, createKitInput } from "../web/ui-kit-input.js";
import { buttonForKey } from "../web/vendor/engine.js";

/** Hold `buttons` from tick 1 to tick `last`; list the ticks on which `name` acts. */
function actingTicks(buttons, name, last, input = createKitInput()) {
    const out = [];
    for (let tick = 1; tick <= last; tick++) if (input.step(new Set(buttons), tick).has(name)) out.push(tick);
    return out;
}

test("a held direction acts on the press, then at ticks 16, 22, 26, 30, ... (15, then 6, then every 4)", () => {
    assert.deepEqual(actingTicks(["down"], "down", 60), [1, 16, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58]);
});

test("a held face button, shoulder or Start acts once and never repeats", () => {
    for (const name of ["circle", "cross", "l1", "r1", "start", "square"]) {
        assert.deepEqual(actingTicks([name], name, 80), [1], name);
    }
    assert.deepEqual([...REPEATING], ["up", "down", "left", "right"]);
});

test("the words are the English ones: Enter confirms as circle, Escape backs out as cross, Q and E are l1 and r1", () => {
    assert.equal(buttonForKey("enter", 2), WORD.confirm);
    assert.equal(buttonForKey("escape", 2), WORD.back);
    assert.equal(buttonForKey("q", 2), WORD.prev);
    assert.equal(buttonForKey("e", 2), WORD.next);
    assert.equal(buttonForKey("i", 2), WORD.start);
});

test("a button that was down when the screen opened does nothing until it is let go", () => {
    const input = createKitInput();
    input.reset(["circle"]);
    for (let tick = 1; tick <= 5; tick++) assert.equal(input.step(new Set(["circle"]), tick).size, 0, `tick ${tick}`);
    assert.equal(input.step(new Set(), 6).size, 0);
    assert.ok(input.step(new Set(["circle"]), 7).has("circle"), "a fresh press acts");
});

test("words that are not pad buttons (letters, F keys) are ignored", () => {
    const input = createKitInput();
    assert.equal(input.step(new Set(["f", "a", "circle"]), 1).size, 1);
});

test("two directions held together both act", () => {
    const input = createKitInput();
    const act = input.step(new Set(["up", "left"]), 1);
    assert.deepEqual([...act].sort(), ["left", "up"]);
});

test("advance gives 50 displayed frames for one second", () => {
    const input = createKitInput();
    assert.equal(input.advance(1, new Set()).length, 50);
});
```

`tests/ui-kit.test.js`:

```js
// The window kit (web/ui-kit.js): folds 10 / 5 steps, windows opening one after another, small drawing helpers.
import test from "node:test";
import assert from "node:assert/strict";
import {
    BOX_H, BOX_W, OPEN_STEPS, SFX_CLOSE, SFX_OPEN, barFill, createFold, createFoldChain, drawPanel, layoutTabs, panelPixelHeight, withFold,
} from "../web/ui-kit.js";

/** A canvas that only records what is asked of it. */
function recordingCtx() {
    const log = [];
    const ctx = new Proxy({}, {
        get: (_t, name) => (name === "log" ? log : (...args) => { log.push([name, ...args]); }),
        set: () => true,
    });
    return ctx;
}
const ticksUntil = (fold, state, limit = 100) => { let n = 0; while (fold.state() !== state && n < limit) { fold.tick(); n++; } return n; };

test("the box is 320 x 240, a window folds in 10 steps and the sounds are the game's SYSTEM03 / SYSTEM04 words", () => {
    assert.deepEqual([BOX_W, BOX_H, OPEN_STEPS], [320, 240, 10]);
    assert.equal(SFX_OPEN, 0x40019);
    assert.equal(SFX_CLOSE, 0x4001a);
});

test("a fold opens in ten steps of motion and lands on the eleventh (the game's integer step), and shuts in five", () => {
    const fold = createFold();
    assert.equal(fold.state(), "shut");
    assert.equal(fold.progress(), 0);
    fold.open();
    const seen = [];
    for (let i = 0; i < 10; i++) { fold.tick(); seen.push(fold.progress()); }
    assert.ok(seen.every((p, i) => p > (seen[i - 1] ?? 0) && p < 1), "rising and not yet 1 after ten steps");
    assert.ok(seen[9] > 0.999, "ten steps reach 4095 of 4096");
    assert.equal(fold.state(), "opening");
    fold.tick();
    assert.equal(fold.state(), "open");
    assert.equal(fold.progress(), 1);
    fold.close();
    assert.equal(ticksUntil(fold, "shut"), 5, "shuts in five steps (twice the speed)");
    assert.equal(fold.progress(), 0);
});

test("closing a fold that is half open only goes down", () => {
    const fold = createFold();
    fold.open();
    for (let i = 0; i < 4; i++) fold.tick();
    const mid = fold.progress();
    assert.ok(mid > 0.3 && mid < 0.5);
    fold.close();
    let last = mid;
    for (let i = 0; i < 10 && fold.state() !== "shut"; i++) {
        fold.tick();
        assert.ok(fold.progress() <= last, "never goes back up");
        last = fold.progress();
    }
    assert.equal(fold.state(), "shut");
});

test("three windows open one after another and shut in the reverse order, each with its sound", () => {
    const events = [];
    const chain = createFoldChain(["title", "body", "footer"], { onStart: (name, opening) => events.push([name, opening]) });
    chain.open();
    assert.deepEqual(events, [["title", true]], "only the first window starts at once");
    let n = 0;
    while (chain.phase() !== "open" && n < 200) { chain.tick(); n++; if (events.length === 2) assert.equal(chain.folds.title.state(), "open", "body waits for title"); }
    assert.equal(chain.phase(), "open");
    assert.deepEqual(events.map((e) => e[0]), ["title", "body", "footer"]);
    assert.equal(n, 33, "three windows of eleven ticks");
    events.length = 0;
    chain.close();
    n = 0;
    while (chain.phase() !== "shut" && n < 200) { chain.tick(); n++; }
    assert.deepEqual(events, [["footer", false], ["body", false], ["title", false]]);
    assert.equal(n, 15, "three windows of five ticks");
});

test("closing a chain that is still opening shuts only the windows that were started", () => {
    const events = [];
    const chain = createFoldChain(["a", "b", "c"], { onStart: (name, opening) => events.push([name, opening]) });
    chain.open();
    for (let i = 0; i < 14; i++) chain.tick();           // a is open, b has started
    events.length = 0;
    chain.close();
    for (let i = 0; i < 60; i++) chain.tick();
    assert.deepEqual(events, [["b", false], ["a", false]], "c never started, so it is never closed");
    assert.equal(chain.phase(), "shut");
    assert.equal(chain.folds.c.state(), "shut");
});

test("withFold draws nothing at 0, plainly at 1, and squeezed about the pivot in between", () => {
    const ctx = recordingCtx();
    let drawn = 0;
    assert.equal(withFold(ctx, 0, 10, 20, "x", () => drawn++), false);
    assert.equal(drawn, 0);
    withFold(ctx, 1, 10, 20, "x", () => drawn++);
    assert.equal(drawn, 1);
    assert.deepEqual(ctx.log, [], "no transform at full size");
    withFold(ctx, 0.5, 10, 20, "x", () => drawn++);
    assert.deepEqual(ctx.log.map((c) => c[0]), ["save", "translate", "scale", "translate", "restore"]);
    assert.deepEqual(ctx.log[2], ["scale", 0.5, 1]);
    ctx.log.length = 0;
    withFold(ctx, 0.25, 0, 0, "y", () => {});
    assert.deepEqual(ctx.log[2], ["scale", 1, 0.25]);
});

test("panel height is 22 + 14 per band + 20, and the tab labels are laid out left to right", () => {
    assert.deepEqual([3, 4, 5, 7].map(panelPixelHeight), [84, 98, 112, 140]);
    assert.deepEqual(layoutTabs(["AA", "BBBB", "C"], (s) => s.length * 8, 100, 12), [100, 128, 172]);
});

test("barFill: proportional, clamped, and zero for a missing or empty maximum", () => {
    assert.equal(barFill(50, 100, 80), 40);
    assert.equal(barFill(150, 100, 80), 80);
    assert.equal(barFill(-5, 100, 80), 0);
    assert.equal(barFill(5, 0, 80), 0);
    assert.equal(barFill(undefined, 100, 80), 0);
    assert.equal(barFill(1, 1000, 80), 0, "a sliver rounds to nothing");
});

test("drawPanel draws one tile per column per band and says no until the sheet has loaded", () => {
    const frame = (frame, h) => ({ frame, x: frame, y: 0, w: 40, h, dx: 0, dy: 0 });
    const pack = { img: {}, ids: { 28: { layers: [frame(56, 22), frame(57, 22), frame(58, 14), frame(59, 14), frame(60, 20), frame(61, 20)] } } };
    const ctx = recordingCtx();
    assert.equal(drawPanel(ctx, 5, 6, 8, 7, pack), true);
    assert.equal(ctx.log.filter((c) => c[0] === "drawImage").length, 8 * (7 + 2));
    assert.equal(drawPanel(ctx, 0, 0, 8, 7, { img: null, ids: pack.ids }), false);
    assert.equal(drawPanel(ctx, 0, 0, 8, 7, { img: {}, ids: {} }), false);
});
```

`tests/book-host.test.js`:

```js
// The book host (web/book-host.js): opens a book through its folds, hands it the pad, shuts it, and gives the pause list back
// only once the pad is let go.
import test from "node:test";
import assert from "node:assert/strict";
import { RELEASE_WAIT_FRAMES, createBookHost } from "../web/book-host.js";
import { createBlankBook } from "../web/book-blank.js";

const DT = 0.02; // one field tick at 50 Hz
function stubBook(log) {
    return {
        windows: ["one", "two"], wall: false,
        act(buttons) { log.push([...buttons].sort().join("+")); return buttons.has("cross") ? "back" : null; },
        tick() { log.push("tick"); },
        draw() {},
    };
}
function setup() {
    const sounds = [], acts = [], backs = [];
    const sfx = { playPacked: (id) => sounds.push(id), play: (name) => sounds.push(name) };
    const host = createBookHost({ sfx, factories: { demo: () => stubBook(acts) } });
    const run = (held, frames) => { for (let i = 0; i < frames; i++) host.update(DT, held); };
    return { host, sounds, acts, backs, run };
}

test("unknown book names do not open, and a second open while one is up is refused", () => {
    const { host } = setup();
    assert.equal(host.open("nope"), false);
    assert.equal(host.isOpen(), false);
    assert.equal(host.open("demo"), true);
    assert.equal(host.open("demo"), false);
    assert.equal(host.isOpen(), true);
});

test("the book gets no pad until its windows are open; then it gets the acting buttons", () => {
    const { host, acts, run, sounds } = setup();
    host.open("demo", null, []);
    assert.deepEqual(sounds, [0x40019], "the first window's open sound at once");
    run(new Set(["down"]), 10);
    assert.equal(acts.filter((a) => a !== "tick").length, 0, "still opening: nothing reaches the book");
    run(new Set(), 20);
    assert.deepEqual(sounds, [0x40019, 0x40019], "the second window opened after the first");
    run(new Set(["down"]), 1);
    assert.ok(acts.includes("down"));
});

test("Back shuts the windows in reverse, plays the back click and the close sounds, then calls back exactly once", () => {
    const { host, sounds, backs, run } = setup();
    host.open("demo", () => backs.push("back"), []);
    run(new Set(), 40);
    sounds.length = 0;
    run(new Set(["cross"]), 1);
    run(new Set(), 40);
    assert.deepEqual(sounds, ["system01", 0x4001a, 0x4001a]);
    assert.deepEqual(backs, ["back"]);
    assert.equal(host.isOpen(), false);
    run(new Set(), 10);
    assert.deepEqual(backs, ["back"], "not again");
});

test("the pause list does not come back while the pad is still held, but does after the wait is over", () => {
    const { host, backs, run } = setup();
    host.open("demo", () => backs.push("back"), []);
    run(new Set(), 40);
    run(new Set(["cross"]), 1);
    run(new Set(["cross"]), 20);
    assert.deepEqual(backs, [], "Back still down: the list would see it as a press and close");
    run(new Set(), 3);
    assert.deepEqual(backs, ["back"], "let go: it comes back");
    assert.ok(RELEASE_WAIT_FRAMES > 0);
});

test("a confirm that was down when the book opened does not act", () => {
    const { host, acts, run } = setup();
    host.open("demo", null, ["circle"]);
    run(new Set(["circle"]), 60);
    assert.equal(acts.filter((a) => a.includes("circle")).length, 0);
});

test("the blank book: Back is the only thing it answers, and all three windows are named", () => {
    const book = createBlankBook({ title: "GLOSSARY" });
    assert.deepEqual(book.windows, ["title", "body", "footer"]);
    assert.equal(book.wall, true);
    assert.equal(book.act(new Set(["circle", "down"])), null);
    assert.equal(book.act(new Set(["cross"])), "back");
});
```

`tests/book-host-args.test.js`:

```js
// What the host gives each book it makes (web/book-host.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createBookHost } from "../web/book-host.js";

test("each book is made with the settings store and the batch setter", () => {
    const seen = [];
    const setFxMany = () => {};
    const book = { windows: ["one"], wall: false, act: () => null, draw() {} };
    const host = createBookHost({ factories: { demo: (args) => { seen.push(args); return book; } }, setFxMany });
    assert.equal(host.open("demo"), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].setFxMany, setFxMany);
    assert.equal(typeof seen[0].setFx, "function");
    assert.equal(typeof seen[0].fx, "function");
});
```

`tests/book-host-draw.test.js`:

```js
// Review focus: the book draws over a wide window too (web/book-host.js draw), and draws nothing when no book is open.
import test from "node:test";
import assert from "node:assert/strict";
import { createBookHost } from "../web/book-host.js";

function fakeCtx() {
    const log = [];
    return new Proxy({}, { get: (_t, n) => (n === "log" ? log : (...a) => { log.push([n, ...a]); }), set: () => true });
}
const book = (wall) => ({ windows: ["w"], wall, act: () => null, draw(ctx, view) { ctx.fillRect(1, 2, 3, 4); view.progress("w"); } });

test("nothing is drawn while no book is open", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480, 0);
    assert.deepEqual(ctx.log, []);
});

test("the dim covers the wide-screen sides: from -padL to viewW + padL, full height", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480, 120);
    const dim = ctx.log.find((c) => c[0] === "fillRect");
    assert.deepEqual(dim.slice(1), [-120, 0, 640 + 240, 480]);
});

test("the book is drawn in the 320 x 240 box: the canvas is scaled by viewW / 320", () => {
    const host = createBookHost({ factories: { demo: () => book(false) } });
    host.open("demo");
    const ctx = fakeCtx();
    host.draw(ctx, 640, 480);
    const scale = ctx.log.find((c) => c[0] === "scale");
    assert.deepEqual(scale.slice(1), [2, 2]);
    assert.ok(ctx.log.some((c) => c[0] === "fillRect" && c[1] === 1 && c[4] === 4), "the book's own draw ran");
});

test("a wall book fills the dim solid (alpha 1) before the wall", () => {
    const host = createBookHost({ factories: { demo: () => book(true) } });
    host.open("demo");
    const ctx = { fillStyle: "", log: [], fillRect(...a) { this.log.push([this.fillStyle, ...a]); }, save() {}, restore() {}, scale() {} };
    host.draw(ctx, 320, 240, 0);
    assert.equal(ctx.log[0][0], "rgba(0, 0, 0, 1)");
});
```

- [ ] **Step 2: Run, expect FAIL** (`node --test tests/ui-kit-input.test.js tests/ui-kit.test.js tests/book-host.test.js tests/book-host-args.test.js tests/book-host-draw.test.js`): modules not found.

- [ ] **Step 3: Create the modules.** `web/text-fit.js`:

```js
// web/text-fit.js -- fit text to a pixel width by MEASURING it, never by counting characters. Pure: the caller passes the
// measuring function (web/uifont.js textWidth, which falls back to 7 px a letter until the font has loaded).
//
// Why: the QUESTS page cut its lines at 36 characters (web/quests.js) and the description band's one-line sentence ran off the
// right edge; the font is proportional, so a character count is wrong in both directions.

/** Longest start of `text` that fits `maxW` px, cut at a word end when one fits (never an ellipsis: the pause font has none). */
export function fitByWidth(text, widthOf, maxW) {
    const s = String(text ?? "").trim();
    if (widthOf(s) <= maxW) return s;
    const words = s.split(/\s+/);
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (widthOf(next) > maxW) break;
        line = next;
    }
    if (line) return line;
    let cut = s;                                   // one word wider than the box: cut letters
    while (cut.length > 1 && widthOf(cut) > maxW) cut = cut.slice(0, -1);
    return cut;
}

/** `text` broken into lines no wider than `maxW` px, on spaces. A word wider than the box gets a line of its own, cut to fit. */
export function wrapByWidth(text, widthOf, maxW) {
    const out = [];
    let line = "";
    for (const word of String(text ?? "").split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (widthOf(next) <= maxW) { line = next; continue; }
        if (line) out.push(line);
        line = fitByWidth(word, widthOf, maxW);
    }
    if (line) out.push(line);
    return out;
}

/** The description band's text area: x 20 to the right edge of the 320 box with a 20 px margin (ststat clip 0x20, web/ui-kit.js FOOTER). */
export const BAND_TEXT_W = 280;
```

`web/ui-kit-input.js`:

```js
// web/ui-kit-input.js -- what the new book screens (GLOSSARY, OPTIONS) read from the pad. One frame at a time.
//
// It reuses the game's own pause pad port, not a new one: `ui.MenuPadWords` (engine/dw3/ui/pad-words.ts) turns the held
// buttons into "pressed this frame" and "repeat fired this frame" exactly as the pause pages see them, and
// `ui.MenuDisplayClock` gives the displayed frames (50 per second). The held buttons are `state.keys` in web/game.js: the
// keyboard (web/game.js keydown) and the gamepad (web/input.js attachGamepad) both feed it with the same WORD-BIT names, so
// one reader serves both. In English the words are swapped from the physical buttons (engine/systems/input-map.ts
// PAD_FACE_WORD_SWAP): CONFIRM is the word "circle" (Enter, Space, Z, C; pad bottom button) and BACK is the word "cross"
// (Escape, X; pad top button). Q and E are "l1" and "r1"; Start (I) is "start".
//
// Rules:
//  * a direction repeats while held (first repeat 15 ticks after the press tick, then every 6, then every 4: the pause pad's
//    own 16 / 6 / 4 credit ladder); a face button, a shoulder or Start never repeats;
//  * a button that was already down when the screen opened (the Enter that chose the row) does nothing until it is let go.
import { ui, maskFromButtons, buttonsFromMask, isPadButton } from "./vendor/engine.js";

/** The only buttons that repeat while held. */
export const REPEATING = Object.freeze(["up", "down", "left", "right"]);
/** The word names this module is written in (see the header). */
export const WORD = Object.freeze({ confirm: "circle", back: "cross", prev: "l1", next: "r1", start: "start" });

export function createKitInput() {
    const clock = new ui.MenuDisplayClock();
    const words = new ui.MenuPadWords();
    let blocked = new Set();
    const api = {
        /** Call when the screen opens, with the buttons that are down right now. */
        reset(held = []) { blocked = new Set([...held].filter(isPadButton)); },
        /** One displayed frame at display tick `tick`: the set of buttons that act in it. */
        step(held, tick) {
            const down = new Set([...held].filter(isPadButton));
            for (const b of [...blocked]) if (!down.has(b)) blocked.delete(b);
            for (const b of blocked) down.delete(b);
            const { pressed, repeated } = words.update(maskFromButtons(down), tick);
            const act = new Set(buttonsFromMask(pressed));
            for (const b of buttonsFromMask(repeated)) if (REPEATING.includes(b)) act.add(b);
            return act;
        },
        /** `dt` seconds of real time: one Set of acting buttons per displayed frame that is due. */
        advance(dt, held) { return clock.advance(dt).map((frame) => api.step(held, frame.tick)); },
    };
    return api;
}
```

`web/ui-kit.js`:

```js
// web/ui-kit.js -- the window kit for the new book screens (GLOSSARY, OPTIONS). Everything here wraps pieces the game
// already has; no new art.
//
//   * folds: a window opens by scaling from 0 to full about a pivot over 10 steps (sound 0x40019) and shuts in 5 (sound
//     0x4001a); the windows of a screen open one after another (engine/dw3/ui/fold-tween.ts; web/menu.js _foldOpen)
//   * plates: header cmfont clip 24, footer ststat clip 32, list panel from the pause list's own tiles (web/panel-kit.js)
//   * text: web/uifont.js (kind 1 = the white face, kind 3 = the orange number face), cursor drawCursor
//
// All coordinates are the 320 x 240 box the pause menus use. The host (web/book-host.js) scales the canvas.
import { ui } from "./vendor/engine.js";
import { loadPack, drawClip, packReady } from "./screenpack.js";
import { drawText, textWidth } from "./uifont.js";
import { buildPanelClip, tileFrames } from "./panel-kit.js";
import { BAND_TEXT_W, fitByWidth, wrapByWidth } from "./text-fit.js";

export const BOX_W = 320;
export const BOX_H = 240;
/** Every pause window is installed with 10 steps: 10 to open, 5 to shut (fold-tween.ts FOLD_CLOSE_RATE). */
export const OPEN_STEPS = 10;
/** Packed sound words: SYSTEM03 on a window opening, SYSTEM04 on one shutting (fold-tween.ts FOLD_OPEN_SFX / FOLD_CLOSE_SFX). */
export const SFX_OPEN = 0x40019;
export const SFX_CLOSE = 0x4001a;

const cmfont = loadPack("cmfont");
const ststat = loadPack("ststat");

// ---------------------------------------------------------------- folds

/** One window's fold. state(): "shut" | "opening" | "open" | "closing". progress(): 0..1, the scale. tick(): one displayed frame. */
export function createFold(steps = OPEN_STEPS) {
    const t = ui.createFoldTween();
    let state = "shut";
    return {
        open() { ui.startFold(t, 0, ui.FOLD_MAX, steps); state = "opening"; },
        close() {
            if (state === "open") ui.startFoldClose(t, steps);
            else if (state === "opening") { ui.startFold(t, t.value, 0, steps); t.delta *= ui.FOLD_CLOSE_RATE; }
            else return;
            state = "closing";
        },
        tick() {
            if (state !== "opening" && state !== "closing") return true;
            const landed = ui.tickFold(t);
            if (landed) state = state === "opening" ? "open" : "shut";
            return landed;
        },
        state: () => state,
        progress: () => (state === "open" ? 1 : state === "shut" ? 0 : ui.foldProgress(t)),
    };
}

/**
 * The windows of one screen, opened one after another in `names` order (each starts when the one before has landed) and
 * shut in the reverse order. `onStart(name, opening)` is where the open / close sound is played.
 */
export function createFoldChain(names, { steps = OPEN_STEPS, onStart = () => {} } = {}) {
    const folds = Object.fromEntries(names.map((n) => [n, createFold(steps)]));
    let phase = "shut";
    let at = 0;
    const start = (i, opening) => { folds[names[i]][opening ? "open" : "close"](); onStart(names[i], opening); };
    return {
        folds,
        phase: () => phase,
        open() {
            if (phase === "open" || phase === "opening") return;
            phase = "opening"; at = 0; start(0, true);
        },
        close() {
            if (phase === "shut" || phase === "closing") return;
            const last = names.map((n) => folds[n].state()).map((s) => s !== "shut").lastIndexOf(true);
            if (last < 0) { phase = "shut"; return; }
            phase = "closing"; at = last; start(at, false);
        },
        tick() {
            for (const n of names) folds[n].tick();
            const cur = folds[names[at]];
            if (phase === "opening" && cur.state() === "open") {
                if (at + 1 < names.length) { at++; start(at, true); } else phase = "open";
            } else if (phase === "closing" && cur.state() === "shut") {
                if (at > 0) { at--; start(at, false); } else phase = "shut";
            }
            return phase;
        },
    };
}

/** Run `draw` with the window folded to `progress` (0..1) about (px, py). axis "x" squeezes sideways, "y" up and down. Draws nothing at 0. */
export function withFold(ctx, progress, px, py, axis, draw) {
    if (!(progress > 0)) return false;
    if (progress >= 1) { draw(); return true; }
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(axis === "y" ? 1 : progress, axis === "x" ? 1 : progress);
    ctx.translate(-px, -py);
    draw();
    ctx.restore();
    return true;
}

// ---------------------------------------------------------------- plates

/** Header plate: cmfont clip 24 at (34, 13), folds about (320, 25); the game's header text sits at (152, 19) (status_ui.json screens.shared). */
export const HEADER = Object.freeze({ clip: 24, x: 34, y: 13, pivot: [320, 25], textX: 152, textY: 19 });
/** Footer plate: ststat clip 32 at (0, 194), folds about (0, 211); text lines at (20, 198) and (20, 212). */
export const FOOTER = Object.freeze({ clip: 32, x: 0, y: 194, pivot: [0, 211], textX: 20, textY: 198, lineH: 14 });
/** The list panel's tile size (web/panel-kit.js). */
export const TILE_W = 40;

/** Height in pixels of a panel with `bands` middle bands: 22 on top, 14 a band, 20 at the bottom. */
export const panelPixelHeight = (bands) => 22 + 14 * bands + 20;

/** Register (once) and return the id of a `cols` x `bands` panel clip in the cmfont pack, or null while the sheet is not loaded. */
export function panelClipId(pack, cols, bands) {
    const id = `kit-${cols}x${bands}`;
    if (!pack.ids?.[id]) {
        const frames = tileFrames(pack.ids);
        if (!frames) return null;
        pack.ids[id] = buildPanelClip(frames, cols, bands);
    }
    return id;
}

/** Draw a panel of `cols` 40 px columns and `bands` middle bands with its top-left at (x, y). False until the sheet has loaded. */
export function drawPanel(ctx, x, y, cols, bands, pack = cmfont) {
    if (!packReady(pack)) return false;
    const id = panelClipId(pack, cols, bands);
    return id ? drawClip(ctx, pack, id, x, y) : false;
}

/** x of each tab label: starts at `startX`, `gap` pixels between labels. `widthOf(label)` is textWidth in the real build. */
export function layoutTabs(labels, widthOf, startX, gap) {
    const out = [];
    let x = startX;
    for (const label of labels) { out.push(x); x += widthOf(label) + gap; }
    return out;
}

/** Header plate with a title on the left and, optionally, section tabs (the active one in the white face, the rest dim, clut row 7). */
export function drawHeader(ctx, progress, title, tabs = [], active = 0) {
    withFold(ctx, progress, HEADER.pivot[0], HEADER.pivot[1], "x", () => drawClip(ctx, cmfont, HEADER.clip, HEADER.x, HEADER.y));
    if (progress < 1) return;
    if (!tabs.length) { drawText(ctx, title, HEADER.textX, HEADER.textY); return; }
    drawText(ctx, title, 44, HEADER.textY);
    const xs = layoutTabs(tabs, (s) => textWidth(s), 44 + textWidth(title) + 16, 12);
    tabs.forEach((label, i) => drawText(ctx, label, xs[i], HEADER.textY, i === active ? undefined : { clut: 7 }));
}

/** Footer plate with up to two text lines. */
export function drawFooter(ctx, progress, line1 = "", line2 = "") {
    withFold(ctx, progress, FOOTER.pivot[0], FOOTER.pivot[1], "x", () => drawClip(ctx, ststat, FOOTER.clip, FOOTER.x, FOOTER.y));
    if (progress < 1) return;
    if (line1) drawText(ctx, line1, FOOTER.textX, FOOTER.textY);
    if (line2) drawText(ctx, line2, FOOTER.textX, FOOTER.textY + FOOTER.lineH);
}

// ---------------------------------------------------------------- small pieces

/** Pixels of a `w` px bar that `value` of `max` fills (0 when max is not a positive number). */
export function barFill(value, max, w) {
    if (!(max > 0) || !(value > 0)) return 0;
    return Math.max(0, Math.min(w, Math.round((value / max) * w)));
}

/** A flat bar drawn with the frame blue of the pause windows (web/uiRects.js): no new art. */
export function drawBar(ctx, x, y, w, h, value, max) {
    ctx.fillStyle = "rgb(0, 0, 32)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgb(104, 104, 208)";
    ctx.fillRect(x, y, barFill(value, max, w), h);
}

/** The field behind a book, dimmed. `padL` is the wide-screen pad on each side (web/game.js wideField.padL), in canvas pixels. */
export function dimField(ctx, viewW, viewH, padL = 0, alpha = 0.5) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(-padL, 0, viewW + 2 * padL, viewH);
}

// ---------------------------------------------------------------- the QUESTS page's layout, shared
// engine/dw3/ui/native/pause-quests.ts draws: top bar cmfont 0x18 (HEADER above), the list window cmfont 0x24 at (0xa8, 0x28)
// folding about (0x140, 0x52), rows of text at x 0xbd, y 0x31 + 0xe * i, the cursor at x 0xb0, and the description band
// ststat 0x20 (FOOTER above). OPTIONS and GLOSSARY use the same places.
export const LIST_WINDOW = Object.freeze({ clip: 36, x: 168, y: 40, w: 160, pivot: [320, 82], textX: 189, textY: 49, pitch: 14, cursorX: 176, maxRows: 8 });
/** Right edge for a row's value, inside the window (the window ends at x 328, past the 320 box: the disc's own panel bleeds off the edge). */
export const LIST_VALUE_RIGHT = 306;

/** The list window for `rows` rows: the disc's 0x24 panel up to eight rows, the same tiles with more bands above that. */
export function drawListWindow(ctx, progress, rows) {
    withFold(ctx, progress, LIST_WINDOW.pivot[0], LIST_WINDOW.pivot[1], "x", () => {
        if (rows <= LIST_WINDOW.maxRows) drawClip(ctx, cmfont, LIST_WINDOW.clip, LIST_WINDOW.x, LIST_WINDOW.y);
        else drawPanel(ctx, LIST_WINDOW.x, LIST_WINDOW.y, 4, rows - 2);
    });
}

/** y of row `i` of a list. */
export const listRowY = (i) => LIST_WINDOW.textY + LIST_WINDOW.pitch * i;

/** The description band with `text` wrapped by measured width to at most two lines (the second cut to fit). */
export function drawHelpBox(ctx, progress, text) {
    const lines = wrapByWidth(text, (s) => textWidth(s), BAND_TEXT_W);
    drawFooter(ctx, progress, lines[0] ?? "", lines[1] ? fitByWidth(lines.slice(1).join(" "), (s) => textWidth(s), BAND_TEXT_W) : "");
}
```

`web/book-host.js`:

```js
// web/book-host.js -- runs ONE book screen (GLOSSARY, OPTIONS) over the pause menu's way out and back.
//
// How a book is opened: the pause list's row ends the list with { kind: "book", book, row } (engine/dw3/ui/
// pause-root-session.ts), web/status-translated.js calls opts.onBook(book, row), and web/game.js calls open(book, backToPause).
// The host then owns the screen the way the Card Album does (web/game.js menu.onCardAlbum): the field is frozen under it,
// every press is the book's, and when it shuts the pause list comes back on the row the player left.
//
// A book is: {
//   windows: ["title", "body", ...]      the folds, opened in this order, shut in reverse (web/ui-kit.js createFoldChain)
//   wall: boolean                        true = the drifting status wall behind it (full-screen pages); false = the dimmed field
//   act(buttons: Set<string>): "back" | null     one displayed frame's acting buttons (web/ui-kit-input.js); "back" shuts the book
//   tick?(): void                        one displayed frame, after act
//   draw(ctx, view): void                view = { progress(windowName), ticks }, drawn in the 320 x 240 box
// }
import { createKitInput, WORD } from "./ui-kit-input.js";
import { createFoldChain, dimField, SFX_OPEN, SFX_CLOSE } from "./ui-kit.js";
import { createStatusBackdrop } from "./status-backdrop.js";
import { isPadButton } from "./vendor/engine.js";

/** After the book has shut, wait for the player to let go of the pad (at most this many displayed frames) before the pause list returns. */
export const RELEASE_WAIT_FRAMES = 25;

export function createBookHost({ sfx = null, factories = {}, fx = () => (typeof window !== "undefined" ? window.__fx : null), setFx = (k, v) => window.__setFx?.(k, v), setFxMany = (o) => window.__setFxMany?.(o) } = {}) {
    const input = createKitInput();
    const backdrop = createStatusBackdrop();
    let book = null, chain = null, onBack = null;
    let ticks = 0, closing = false, waited = 0;

    const host = {
        isOpen: () => book !== null,
        /** Open `name` (a key of `factories`). `held` is the pad set right now (the confirm that chose the row is still down). */
        open(name, back = null, held = []) {
            const make = factories[name];
            if (!make || book) return false;
            book = make({ sfx, fx, setFx, setFxMany, host });
            onBack = back; ticks = 0; closing = false; waited = 0;
            chain = createFoldChain(book.windows, {
                onStart: (_name, opening) => sfx?.playPacked?.(opening ? SFX_OPEN : SFX_CLOSE),
            });
            input.reset(held);
            backdrop.reset();
            chain.open();
            return true;
        },
        /** Force it shut at once (a lab reset). */
        close() { book = null; chain = null; onBack = null; },
        /** One real frame: `dt` seconds, `held` = web/game.js state.keys. */
        update(dt, held) {
            if (!book) return;
            backdrop.update(dt);
            for (const act of input.advance(dt, held)) {
                ticks++;
                chain.tick();
                if (!closing && chain.phase() === "open") {
                    if (book.act(act) === "back") { closing = true; sfx?.play?.("system01"); chain.close(); }
                    book.tick?.();
                } else if (closing && chain.phase() === "shut") {
                    const down = [...held].some(isPadButton);
                    if (down && ++waited < RELEASE_WAIT_FRAMES) continue;
                    const back = onBack;
                    host.close();
                    back?.();
                    return;
                }
            }
        },
        /** Paint over everything else. `viewW` x `viewH` is the canvas (640 x 480), `padL` the wide-screen pad each side. */
        draw(ctx, viewW, viewH, padL = 0) {
            if (!book) return;
            ctx.save();
            dimField(ctx, viewW, viewH, padL, book.wall ? 1 : 0.5);
            ctx.scale(viewW / 320, viewW / 320);
            if (book.wall) backdrop.draw(ctx, 320, 240);
            book.draw(ctx, { progress: (n) => chain.folds[n].progress(), ticks });
            ctx.restore();
        },
    };
    return host;
}

export { WORD };
```

`web/book-blank.js`:

```js
// web/book-blank.js -- a book with nothing on it: the wall, a header plate, one empty window and the footer.
// It is what GLOSSARY opens in build step 1 (the window kit shown without content) and stays the fallback for a book whose
// pages are not built yet.
import { WORD } from "./ui-kit-input.js";
import { drawFooter, drawHeader, drawPanel, withFold } from "./ui-kit.js";

export function createBlankBook({ title = "GLOSSARY" } = {}) {
    return {
        windows: ["title", "body", "footer"],
        wall: true,
        act(buttons) { return buttons.has(WORD.back) ? "back" : null; },
        draw(ctx, view) {
            drawHeader(ctx, view.progress("title"), title);
            // eight 40 px columns = the full 320 px, seven bands = 140 px tall, between the header and the footer
            withFold(ctx, view.progress("body"), 160, 118, "x", () => drawPanel(ctx, 0, 48, 8, 7));
            drawFooter(ctx, view.progress("footer"), "[triangle] Button: Back");
        },
    };
}
```

- [ ] **Step 4: Run, expect PASS** (same command; 7 + 9 + 6 + 1 + 4 tests). Numbers pinned by these tests were measured when the plan was written: repeat ticks 1, 16, 22, 26, 30...; a fold lands on tick 11 opening and tick 5 shutting; three windows open in 33 ticks and shut in 15.

- [ ] **Step 5: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 6: Screenshot** `/home/dorij/ui-review/build/shots/t3.mjs` = t1 with `shot(page, "03-pause-list-unchanged")` (the new modules are not wired in yet, so the old list must be unchanged).

- [ ] **Step 7: Do not commit.** Report changed files.

---

### Task 4: wire the rows and the host into the game; dev switches; nine-row list; blank kit window

**Files:**
- Create: `web/pause-extra-rows.js`
- Modify: `web/ambience.js` (two dev switches), `web/status-translated.js` (`extraRows`, `book` result, `onBook`), `web/game.js` (host, rows, routing, draw)
- Test: `tests/pause-extra-rows.test.js`, `tests/book-wiring.test.js`

**Interfaces:**
- Consumes: Task 2 seed `extraRows` and `book` result; Task 3 `createBookHost`, `createBlankBook`.
- Produces: `pauseExtraRows({ quests, fx }): Array<{ label, opens }>`, `BOOK_LABELS`, `pauseLabelOk`; F2 keys `glossary` and `options` (Extras group, EXPERIMENTAL, off); `window.__books` (the host) and `window.__openBook(name)` (dev hook, only while the switch is on); `pauseHome(row = 0)` in game.js.
- Order of rows on the pause list: ITEMS, SORT, MAP, TECHNIQUES, STATUS, [CARD FOLDERS with the Folder Bag], [QUESTS n], [GLOSSARY], [OPTIONS].

- [ ] **Step 1: Write the failing tests.** `tests/pause-extra-rows.test.js`:

```js
// The pause list's extra rows (web/pause-extra-rows.js) and how they are wired into the game.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOOK_LABELS, pauseExtraRows, pauseLabelOk } from "../web/pause-extra-rows.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("with both dev switches off the list has exactly today's rows: QUESTS when quests are on, nothing otherwise", () => {
    assert.deepEqual(pauseExtraRows({ quests: { label: "QUESTS 2" }, fx: {} }), [{ label: "QUESTS 2", opens: "quests" }]);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: {} }), []);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: { glossary: false, options: false } }), []);
    assert.deepEqual(pauseExtraRows(), []);
});

test("the book rows follow their own switch, only on a real true, after QUESTS and in the order GLOSSARY, OPTIONS", () => {
    const quests = { label: "QUESTS" };
    assert.deepEqual(pauseExtraRows({ quests, fx: { glossary: true, options: true } }).map((r) => r.label), ["QUESTS", "GLOSSARY", "OPTIONS"]);
    assert.deepEqual(pauseExtraRows({ quests, fx: { options: true } }).map((r) => r.opens), ["quests", "options"]);
    assert.deepEqual(pauseExtraRows({ quests: null, fx: { glossary: "yes" } }), [], "anything but true is off");
});

test("every label fits the pause text codec (letters, digits, spaces)", () => {
    for (const label of Object.values(BOOK_LABELS)) assert.ok(pauseLabelOk(label), label);
    assert.equal(pauseLabelOk("QUESTS 12"), true);
    assert.equal(pauseLabelOk("A/B"), false);
    assert.equal(pauseLabelOk(""), false);
    assert.deepEqual(pauseExtraRows({ quests: { label: "Q/A" }, fx: {} }), [], "a label the codec cannot draw is dropped, not drawn as boxes");
});

test("ambience.js lists both switches in Extras and in EXPERIMENTAL (off at first), and never reads them from the URL", () => {
    const src = read("../web/ambience.js");
    assert.match(src, /\["glossary", "[^"]+"\]/);
    assert.match(src, /\["options", "[^"]+"\]/);
    const experimental = src.match(/const EXPERIMENTAL = \[([^\]]*)\];/)[1];
    assert.match(experimental, /"glossary"/);
    assert.match(experimental, /"options"/);
    assert.doesNotMatch(src, /(get|has)\("(glossary|options)"\)/);
});

test("game.js hands the rows to the pause list and opens the books from the pause list's own result", () => {
    const game = read("../web/game.js");
    assert.match(game, /extraRows: \(\) => pauseExtraRows\(\{ quests: questsPauseRow\(\), fx: window\.__fx \}\),/);
    assert.match(game, /onBook: \(book, row\) => openBook\(book, row\),/);
    assert.doesNotMatch(game, /extraRow: \(\) => questsPauseRow\(\)/, "the single-row option is gone");
    const status = read("../web/status-translated.js");
    assert.match(status, /result\?\.kind === "book"/);
    assert.match(status, /opts\.onBook\?\.\(result\.book, result\.row\)/);
    assert.match(status, /extraRows/);
});
```

`tests/book-wiring.test.js`:

```js
// How the books are wired into web/game.js. Source checks in this repo's style (tests/battle-speed.test.js): the real game
// cannot be imported under node.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const game = read("../web/game.js");

test("one host, created after the sound players, opened only from the pause list's book result", () => {
    assert.equal((game.match(/createBookHost\(/g) || []).length, 1);
    assert.ok(game.indexOf("const books = createBookHost(") > game.indexOf("window.__sfx = sfx;"));
    assert.match(game, /const openBook = \(book, row\) => \{ books\.open\(book, \(\) => pauseHome\(row\), state\.keys\); \};/);
    assert.match(game, /const pauseHome = \(row = 0\) => openPauseHome\(\{ state, status, menu, row \}\);/);
});

test("while a book is open: the field is frozen, presses stay off the field, the book draws after the other overlays", () => {
    assert.match(game, /function update\(dt\) \{\n[^\n]*\n\s*books\.update\(dt, state\.keys\);\n\s*if \(books\.isOpen\(\)\) return;/);
    assert.match(game, /if \(books\.isOpen\(\)\) \{\n\s*e\.preventDefault\?\.\(\);\n\s*return;\n\s*\}/);
    assert.ok(game.indexOf("if (books.isOpen()) {") < game.indexOf("if (cutContentPress(k)) {"), "before every other overlay's press");
    assert.match(game, /replayOpen\(\) \|\| books\.isOpen\(\)/, "counts as a screen that owns the whole picture");
    assert.ok(game.indexOf("replayDraw(ctx, VIEW_W, VIEW_H);") < game.indexOf("books.draw(ctx, VIEW_W, VIEW_H, wideField.padL);"));
});

test("the dev hook opens a book only while its switch is exactly true", () => {
    assert.match(game, /window\.__openBook = \(name\) => !!\(window\.__fx\?\.\[name\] === true && state\.started/);
});
```

- [ ] **Step 2: Run, expect FAIL** (`node --test tests/pause-extra-rows.test.js tests/book-wiring.test.js`).

- [ ] **Step 3: Create `web/pause-extra-rows.js`:**

```js
// web/pause-extra-rows.js -- which extra rows the pause home list gets after the disc's own, in order.
// Pure. The list itself is engine/dw3/ui/pause-root-session.ts (seed.extraRows); web/game.js hands this to
// web/status-translated.js as opts.extraRows.
//
// Pause strings use letters, digits and spaces only (engine/dw3/ui/pause-root-session.ts, PauseSeed.extraRows), and a row
// label is six to eight letters so it fits the panel. The book's name is still open (GLOSSARY, DIGIDEX or BOOK): it is
// written once, here.

/** The row labels of the two books. */
export const BOOK_LABELS = Object.freeze({ glossary: "GLOSSARY", options: "OPTIONS" });

/** True when `label` is something the pause list's text codec can draw. */
export const pauseLabelOk = (label) => /^[A-Za-z0-9 ]{1,12}$/.test(String(label));

/**
 * `quests` is what web/quests.js questsPauseRow() returns ({ label } or null); `fx` is the F2 switch object. A book row is
 * there only while its dev switch is exactly true (default off: web/ambience.js EXPERIMENTAL).
 */
export function pauseExtraRows({ quests = null, fx = null } = {}) {
    const rows = [];
    if (quests && pauseLabelOk(quests.label)) rows.push({ label: quests.label, opens: "quests" });
    if (fx?.glossary === true) rows.push({ label: BOOK_LABELS.glossary, opens: "glossary" });
    if (fx?.options === true) rows.push({ label: BOOK_LABELS.options, opens: "options" });
    return rows;
}
```

- [ ] **Step 4: Dev switches** (`web/ambience.js`):

```diff
--- a/web/ambience.js
+++ b/web/ambience.js
@@ -33,7 +33,7 @@
     ["Weather", [["rain", "Rain"], ["rainwater", "Rain on water"], ["snow", "Snow & blizzards"], ["sand", "Sandstorm"], ["lightning", "Lightning"], ["gusts", "Wind gusts"], ["breath", "Cold breath"], ["frost", "Frost edges"], ["screenfx", "Screen rain & storm feel"]]],
     ["Atmosphere", [["tod", "Time of day"], ["nightlight", "Night lighting (lit circles)"], ["clouds", "Cloud shadows"], ["lamps", "Lamp glow"], ["lightpool", "Light pools around lamps"], ["lightreveal", "Lamps restore true colours"], ["indoor", "Indoor mood lighting"], ["hd2d", "HD-2D look (tilt-shift, bloom, grade)"], ["battleatmos", "Battle sky & weather: night, fog, snow, rain follow where you are (new)"], ["fog", "Fog & mist"], ["shafts", "Light shafts"], ["heat", "Heat shimmer"], ["sparkle", "Ice sparkle"], ["pollen", "Pollen"]]],
     ["Life", [["leaves", "Falling leaves"], ["fireflies", "Fireflies"], ["devils", "Dust devils & tumbleweeds"], ["villagers", "Ambient villagers (experimental)"]]],
-    ["Extras", [["quests", "Quests (F3 or the Quests button)"], ["questtriggers", "Quest triggers"], ["questemotes", "Quest emotes"], ["questplacecard", "Quest place cards"], ["mount", "Mount (ride a Digimon a quest unlocks)"], ["mountseat", "Rider sits in the saddle (depth split, new)"], ["fusionbosses", "Fusion bosses: Kimeramon + Machinedramon fuse into Millenniummon (new)"], ["bossphases", "Boss phases (new)"], ["bossmusic", "A phase changes the battle music (new)"], ["bossgrows", "The boss grows (new)"], ["giantmode", "Giant mode: any fighter in a battle can be drawn at another size (new)"], ["fieldwar", "Elemental field war: field techniques set the battlefield element, and it shifts on its own every four turns (new)"], ["omen", "A feeling before a fight (new)"], ["encounterdial", "Encounter dial (repel / lure)"], ["battlespeed", "Faster battles"], ["codex", "Digimon Codex (new)"], ["blastladder", "Blast ladder (new)"], ["planner", "Next forms planner (new)"], ["movetheatre", "Move theatre"], ["cutcontent", "Cut-content gallery (dev)"], ["stageselect", "Stage select (dev)"], ["soundtest", "Sound test (dev)"], ["soundtrack", "Soundtrack room"], ["cinema", "Cinema"], ["practice2v2", "Practice 2 vs 2 (test): wild fights are 2 vs 2 with a computer partner"], ["serverchamp", "Server Champ league"], ["langdesk", "Language desk (new)"], ["damagelab", "Damage Lab (new)"], ["itemsource", "Item source book (new)"], ["gymmap", "Gym map (new)"], ["silence", "Silence report (dev)"], ["itemrulebook", "Item rulebook (new)"], ["cursorbook", "Cursor almanac (new)"], ["chatqueue", "Chat: keep every line I type"], ["weaponlab", "Weapon effects (new)"], ["questsecondjob", "Quests: pick which job to take (new)"], ["bitledger", "BIT ledger (new)"], ["savexray", "Save X-ray (new)"], ["saveverify", "Card verify (new)"], ["replay", "Replay theatre (new)"], ["mpbubbles", "The game's own reaction bubbles"], ["redirectview", "Counter redirects (new)"], ["arrivallab", "Arrival lab (dev)"], ["mpcredit", "Co-op wins count for quests"], ["anglermap", "Angler's almanac"]]],
+    ["Extras", [["quests", "Quests (F3 or the Quests button)"], ["questtriggers", "Quest triggers"], ["questemotes", "Quest emotes"], ["questplacecard", "Quest place cards"], ["mount", "Mount (ride a Digimon a quest unlocks)"], ["mountseat", "Rider sits in the saddle (depth split, new)"], ["fusionbosses", "Fusion bosses: Kimeramon + Machinedramon fuse into Millenniummon (new)"], ["bossphases", "Boss phases (new)"], ["bossmusic", "A phase changes the battle music (new)"], ["bossgrows", "The boss grows (new)"], ["giantmode", "Giant mode: any fighter in a battle can be drawn at another size (new)"], ["fieldwar", "Elemental field war: field techniques set the battlefield element, and it shifts on its own every four turns (new)"], ["omen", "A feeling before a fight (new)"], ["encounterdial", "Encounter dial (repel / lure)"], ["battlespeed", "Faster battles"], ["codex", "Digimon Codex (new)"], ["blastladder", "Blast ladder (new)"], ["planner", "Next forms planner (new)"], ["movetheatre", "Move theatre"], ["cutcontent", "Cut-content gallery (dev)"], ["stageselect", "Stage select (dev)"], ["soundtest", "Sound test (dev)"], ["soundtrack", "Soundtrack room"], ["cinema", "Cinema"], ["practice2v2", "Practice 2 vs 2 (test): wild fights are 2 vs 2 with a computer partner"], ["serverchamp", "Server Champ league"], ["langdesk", "Language desk (new)"], ["damagelab", "Damage Lab (new)"], ["itemsource", "Item source book (new)"], ["gymmap", "Gym map (new)"], ["silence", "Silence report (dev)"], ["itemrulebook", "Item rulebook (new)"], ["cursorbook", "Cursor almanac (new)"], ["chatqueue", "Chat: keep every line I type"], ["weaponlab", "Weapon effects (new)"], ["questsecondjob", "Quests: pick which job to take (new)"], ["bitledger", "BIT ledger (new)"], ["savexray", "Save X-ray (new)"], ["saveverify", "Card verify (new)"], ["replay", "Replay theatre (new)"], ["mpbubbles", "The game's own reaction bubbles"], ["redirectview", "Counter redirects (new)"], ["arrivallab", "Arrival lab (dev)"], ["mpcredit", "Co-op wins count for quests"], ["anglermap", "Angler's almanac"], ["glossary", "Glossary book on the pause menu (new)"], ["options", "Options screen on the pause menu (new)"]]],
     ["Ground", [["steps", "Footprints, dust & ripples"], ["puddles", "Puddles & ice"]]],
     ["Sound", [["sound", "Weather sounds"], ["ambience", "Place sounds (water, city)"], ["musicfx", "Music reacts to weather"], ["footsteps", "Footstep sounds"]]],
     // Battle rules the player switches on by hand (all OFF by default; see MANUAL below). One group,
@@ -51,7 +51,7 @@
 const STORE_KEY = "dw.fx.v1";
 export const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off" };   // spriteFilter: gpu-pixel-filter.js (all art), a test, off by default
 for (const [k] of FX_DEFS) fx[k] = true;
-const EXPERIMENTAL = ["villagers", "hd2d", "mount", "mountseat", "widefield", "battlewide", "practice2v2", "cutcontent", "smartcam", "battleatmos", "battlepano", "toonoutline", "toonshade", "softalpha", "fusionbosses", "bossphases", "bossmusic", "bossgrows", "giantmode", "stageselect", "fieldwar", "battlespeed", "codex", "movetheatre", "soundtest", "soundtrack", "cinema", "blastladder", "planner", "questtriggers", "questemotes", "questplacecard", "omen", "encounterdial", "serverchamp", "langdesk", "damagelab", "itemsource", "gymmap", "silence", "itemrulebook", "cursorbook", "chatqueue", "weaponlab", "enemytells", "aishift", "questsecondjob", "bitledger", "savexray", "saveverify", "replay", "mpbubbles", "redirectview", "arrivallab", "mpcredit", "anglermap"];     // off until you switch them on by hand; "All on" and the presets leave them alone
+const EXPERIMENTAL = ["villagers", "hd2d", "mount", "mountseat", "widefield", "battlewide", "practice2v2", "cutcontent", "smartcam", "battleatmos", "battlepano", "toonoutline", "toonshade", "softalpha", "fusionbosses", "bossphases", "bossmusic", "bossgrows", "giantmode", "stageselect", "fieldwar", "battlespeed", "codex", "movetheatre", "soundtest", "soundtrack", "cinema", "blastladder", "planner", "questtriggers", "questemotes", "questplacecard", "omen", "encounterdial", "serverchamp", "langdesk", "damagelab", "itemsource", "gymmap", "silence", "itemrulebook", "cursorbook", "chatqueue", "weaponlab", "enemytells", "aishift", "questsecondjob", "bitledger", "savexray", "saveverify", "replay", "mpbubbles", "redirectview", "arrivallab", "mpcredit", "anglermap", "glossary", "options"];     // off until you switch them on by hand; "All on" and the presets leave them alone
 const BATTLE = ["ownclips", "dw2motion", "smoothanim"];              // the Battle group: same rule, never switched on by a preset
 const MANUAL = [...EXPERIMENTAL, ...BATTLE];
 for (const k of MANUAL) fx[k] = false;
```

- [ ] **Step 5: `web/status-translated.js`:**

```diff
--- a/web/status-translated.js
+++ b/web/status-translated.js
@@ -138,13 +138,14 @@
         // byte is seeded here and that figure is that byte.
         const worn = wornItemIds(state).map((id) => ({ id, qty: wornCount(state, id) }));
         const context = typeof opts.map === "function" ? (opts.map(state) ?? null) : null;
+        const extraRows = entry === "home" ? (opts.extraRows?.(state) ?? []) : [];
         return {
             page: entry, money: Number(state.bits) || 0, inventory, worn, party: partySeed(state),
             stage: context?.stage ?? 0, mapSeen: mapSeenReader(context),
             homeOverlay: st._homeOverlay, homeRow: st._homeRow,
             cardFoldersUnlocked: !!opts.cardFoldersUnlocked?.(),
-            // EXTRA (not on the disc): one more row on the pause home list (the extra quests) and the page it opens
-            ...(entry === "home" && opts.extraRow?.(state) ? { extraRow: opts.extraRow(state) } : {}),
+            // EXTRA (not on the disc): more rows on the pause home list (the extra quests, the GLOSSARY and OPTIONS books)
+            ...(extraRows.length ? { extraRows } : {}),
             ...(entry === "quests" && opts.questsPage?.(state) ? { quests: opts.questsPage(state) } : {}),
         };
     }
@@ -233,6 +234,11 @@
                         st._homeOverlay = true;
                         st._homeRow = result.row;
                         st.open(st._state, result.page, st._onClose, true);
+                    } else if (result?.kind === "book") {
+                        // GLOSSARY / OPTIONS: the list shuts for good (the pause is over) and the browser opens the book,
+                        // which brings the list back on this row when it closes (web/game.js openBook).
+                        st._finish(false);
+                        opts.onBook?.(result.book, result.row);
                     } else st._finish(false);
                 } else if (st._homeFlow && !session.transition()) {
                     readBack(session);
```

- [ ] **Step 6: `web/game.js`:**

```diff
--- a/web/game.js
+++ b/web/game.js
@@ -389,6 +389,9 @@
 import { loadPlaceCard, createPlaceCard } from "./placecard.js";
 import { loadPlaceCardTranslated, createPlaceCardTranslated } from "./placecard-translated.js";
 import { asButton, attachGamepad, isPadButton } from "./input.js";
+import { pauseExtraRows } from "./pause-extra-rows.js";   // GLOSSARY / OPTIONS rows on the pause list (dev switches `glossary`, `options`)
+import { createBookHost } from "./book-host.js";
+import { createBlankBook } from "./book-blank.js";
 import {
     FIELD_LOCATION_KEY,
     decodeFieldLocation,
@@ -406,6 +409,14 @@
 window.__bgm = bgm;
 const sfx = createSfxPlayer(soundRegister);
 window.__sfx = sfx;
+// GLOSSARY and OPTIONS (web/book-host.js): one host runs whichever book the pause list opens.
+const books = createBookHost({
+    sfx,
+    factories: {
+        glossary: () => createBlankBook({ title: "GLOSSARY" }),   // build step 1: the window kit with nothing on it
+    },
+});
+window.__books = books;
 const PACKED_JINGLES = {
     "0x010c0000": "digi_en0",
     "0x010c0001": "digi_en1",
@@ -953,9 +964,10 @@
     // The map page asks the flag store which places you have walked into — the bits the
     // field entry wrote (engine loadStage -> set_flag(0x1E00 + screen id, 1)).
     map: (state) => pauseMapContext(state, undefined, engineFlagSeen),
-    // Extra quests: one more row on the pause list (after CARD FOLDERS) and the page it opens.
-    extraRow: () => questsPauseRow(),
+    // Extra rows on the pause list (after CARD FOLDERS): QUESTS, then the GLOSSARY and OPTIONS books while their dev switches are on.
+    extraRows: () => pauseExtraRows({ quests: questsPauseRow(), fx: window.__fx }),
     questsPage: () => questsPausePage(),
+    onBook: (book, row) => openBook(book, row),
     // The CARD FOLDERS row's gate: the resident home list's own byte, D0x80048f42 =
     // save+0x20E = carried[402] — the Folder Bag key item (claim
     // UI-CARD-FOLDERS-GATE-IS-FOLDER-BAG-ITEM-2026-10-14). It used to read "has
@@ -1046,7 +1058,7 @@
 // every button on them are one system of the original — the resident list
 // F0x8001270c and its builder 0x8001345C — tabulated once in
 // docs/research/ui/pause-home-button-table-2026-10-04.md.
-const pauseHome = () => openPauseHome({ state, status, menu });
+const pauseHome = (row = 0) => openPauseHome({ state, status, menu, row });
 // The Demo Setup screen has no place on the disc's pause list (nothing writes
 // the row), so it is a debug-only extra and its Back has no original answer.
 // It returns to the same one list every other route returns to.
@@ -1087,6 +1099,11 @@
 const backToCardFolders = () => returnToPauseCardFolders({ state, status, menu });
 menu.onCardAlbum = () => { state.menuOpen = false; cardAlbum.open(backToCardFolders); };
 menu.onCardDeck = () => { state.menuOpen = false; cardDeck.open(backToCardFolders); };
+// GLOSSARY / OPTIONS: the pause list ended on that row (status-translated onBook); the book runs over the frozen field and the list
+// comes back on the same row when it shuts. The confirm that chose the row is still down: the host ignores it until it is let go.
+const openBook = (book, row) => { books.open(book, () => pauseHome(row), state.keys); };
+// Dev hook for the screenshot tools: open a book straight from the field, only while its dev switch is on.
+window.__openBook = (name) => !!(window.__fx?.[name] === true && state.started && !state.menuOpen && !books.isOpen() && books.open(name, null, state.keys));
 // East Sector - Duel Island, the card-duel venue (docs/research/story-
 // progression/GAME_WALKTHROUGH.md).
 Promise.all([loadCatalog(), loadStarter()]).then(() => { ensureStarterFolder(); persistCollection(); });
@@ -2451,7 +2468,7 @@
     return !!(state.menuOpen || status?.isOpen() || inn.isOpen() || shop.isOpen() || driMenu.isOpen()
         || gym.isOpen() || cardShop.isOpen() || cardAlbum.isOpen() || cardDeck.isOpen() || cardDuel.isOpen()
         || saveScreen.isOpen() || fightReport.isOpen() || fieldMovie.isOpen() || state.nameEntry || state.packSelect
-        || state.endScreen || state.titleScreen || stagslctMenu.open || cutContentOpen() || soundTest.open || codexOpen() || blastOpen() || plannerOpen() || damageLabOpen() || replayOpen()
+        || state.endScreen || state.titleScreen || stagslctMenu.open || cutContentOpen() || soundTest.open || codexOpen() || blastOpen() || plannerOpen() || damageLabOpen() || replayOpen() || books.isOpen()
         || (USE_NATIVE_CNTYSEL ? cntyselNative.isOpen() : cntyselMenu.open) || state.wipe28);
 }
 function fieldStageFilled() {
@@ -7713,6 +7730,12 @@
     }
     if (!state.started) return;
 
+    // GLOSSARY / OPTIONS: the open book reads the held pad itself (update -> books.update); a press only has to stay off the field.
+    if (books.isOpen()) {
+        e.preventDefault?.();
+        return;
+    }
+
     // EXPERIMENT (cut-content gallery): while the page is up it owns the pad — Left/Right turn a page, Cross/Start
     // close it, every other press is swallowed — so nothing reaches the field underneath. Closed, it answers false
     // and every press falls through exactly as before.
@@ -8557,6 +8580,9 @@
 };
 
 function update(dt) {
+    // GLOSSARY / OPTIONS (web/book-host.js): while a book is up the field is frozen and the book reads the held pad.
+    books.update(dt, state.keys);
+    if (books.isOpen()) return;
     // EXPERIMENT (cut-content gallery): F2 -> Extras -> Cut-content gallery opens a read-only text page on the
     // setting's rising edge. While it is up the field is frozen (nothing moves under a page the player is reading)
     // and dispatchInput gives it every press; with the setting off the page never exists and this costs one call.
@@ -11209,6 +11235,8 @@
     damageLabDraw(ctx, VIEW_W, VIEW_H);
     // EXPERIMENT (Replay theatre): the scene list sits over everything too; it draws only while the page is open.
     replayDraw(ctx, VIEW_W, VIEW_H);
+    // GLOSSARY / OPTIONS: over everything, drawn only while a book is open.
+    books.draw(ctx, VIEW_W, VIEW_H, wideField.padL);
 
     if (fade.alpha > 0) {
         drawTransitionWipe(ctx, camX, camY);
```

- [ ] **Step 7: Run, expect PASS** (`node --test tests/pause-extra-rows.test.js tests/book-wiring.test.js`, 5 + 3 tests). Also `node --check web/game.js`. Old tests that read `ambience.js` or `game.js` must still pass: `node --test tests/battle-speed.test.js tests/arrival-lab.test.js tests/cinema.test.js tests/bit-ledger.test.js`.

- [ ] **Step 8: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 9: Screenshots** `/home/dorij/ui-review/build/shots/t4.mjs`:

```js
import { openGame, press, padHold, shot } from "/home/dorij/dw2003-play-integration/tools/ui_shot.mjs";
// Folder Bag (item 402) + QUESTS + the two dev switches = nine rows
const { browser, page } = await openGame({ fx: { glossary: true, options: true }, inventory: [{ id: 402, qty: 1 }] });
await press(page, "i", 120, 2500);
await shot(page, "04-pause-nine-rows");                       // the pause list with 9 rows
for (let i = 0; i < 7; i++) await press(page, "ArrowDown", 100, 250);   // row 7 = GLOSSARY
await shot(page, "04-pause-cursor-on-glossary");
await press(page, "Enter", 120, 3500);                          // confirm: the list shuts, the blank kit window opens
await shot(page, "04-blank-kit-window");
await press(page, "Escape", 120, 3500);                         // Back: the window shuts, the list returns on the GLOSSARY row
await shot(page, "04-back-on-pause-list");
await press(page, "ArrowDown", 100, 400);                       // OPTIONS row, then the pad: confirm = button 0
await padHold(page, 0, 150, 3500);
await shot(page, "04-options-row-without-a-screen");           // OPTIONS has no screen until Task 9 (see the note below)
await browser.close();
```

Note for the executor: until Task 9 registers `options`, `books.open("options")` returns false and the list simply closes (the confirm ends the pause). That is expected at this task; the last shot then shows the field. Report it as seen.

- [ ] **Step 10: Do not commit.** Report changed files.

---

## Step 2: OPTIONS (4 pages), volumes, Detail preset, dev switch `options`

### Task 5: fit text by measured width (QUESTS help box and OPTIONS share it)

**Files:**
- Test: `tests/text-fit.test.js`, `tests/quests-fit.test.js` (`web/text-fit.js` already exists from Task 3)
- Modify: `web/quests.js`, `engine/dw3/ui/pause-root-session.ts`

**Interfaces:**
- Consumes: `fitByWidth(text, widthOf, maxW)`, `wrapByWidth(text, widthOf, maxW)`, `BAND_TEXT_W = 280` (Task 3); `textWidth` from `web/uifont.js`.
- Produces: `PauseSeed.quests.emptyLine?: string`; `questsPausePage()` returns `emptyLine`; the QUESTS page cuts titles at 126 px, description lines and reading pages at 280 px.
- Why: the QUESTS page cut lines at 36 characters (`web/quests.js:721, 724`) and the empty-page sentence was a fixed 58-character string (`pause-root-session.ts:303`) that ran off the right edge. OPTIONS and GLOSSARY use `drawHelpBox` (Task 3), which wraps by measured width.

- [ ] **Step 1: Write the failing tests.** `tests/text-fit.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { BAND_TEXT_W, fitByWidth, wrapByWidth } from "../web/text-fit.js";

// A proportional stand-in: narrow letters (i l t . ,) 3 px, capitals and w m 8 px, everything else 6 px, space 4 px.
const px = (s) => [...s].reduce((n, c) => n + (" ".includes(c) ? 4 : "ilt.,'".includes(c) ? 3 : "WMwm".includes(c) || (c >= "A" && c <= "Z") ? 8 : 6), 0);

test("text that fits is returned whole (trimmed)", () => {
    assert.equal(fitByWidth("  hello  ", px, 100), "hello");
});

test("fitByWidth cuts at the last word that fits, by pixels not by letter count", () => {
    const text = "Talk to people and explore. New quests unlock as you play.";
    const out = fitByWidth(text, px, BAND_TEXT_W - 100);
    assert.ok(px(out) <= BAND_TEXT_W - 100);
    assert.ok(text.startsWith(out) && out.length < text.length);
    assert.ok(!/\s$/.test(out));
    // two strings of the same length, different widths, fit differently
    assert.notEqual(fitByWidth("iiiiiiiiiiiiiiiiiiii end", px, 70), fitByWidth("WWWWWWWWWWWWWWWWWWWW end", px, 70));
});

test("a single word wider than the box is cut letter by letter", () => {
    const out = fitByWidth("WWWWWWWWWWWW", px, 30);
    assert.equal(out, "WWW");
});

test("wrapByWidth: every line fits, no word is lost or reordered", () => {
    const text = "Talk to people and explore. New quests unlock as you play.";
    const lines = wrapByWidth(text, px, 140);
    assert.ok(lines.length >= 2);
    for (const l of lines) assert.ok(px(l) <= 140, l);
    assert.equal(lines.join(" "), text);
});

test("wrapByWidth handles empty text and an over-wide word", () => {
    assert.deepEqual(wrapByWidth("", px, 100), []);
    assert.deepEqual(wrapByWidth(undefined, px, 100), []);
    const lines = wrapByWidth("ok WWWWWWWWWWWW ok", px, 30);
    for (const l of lines) assert.ok(px(l) <= 30, l);
    assert.equal(lines[0], "ok");
});
```

`tests/quests-fit.test.js`:

```js
// The QUESTS page cuts and wraps by measured width (web/text-fit.js), and the empty page's one line is fitted by the caller.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("web/quests.js measures instead of counting characters, and sends one fitted line for the empty page", () => {
    const quests = read("../web/quests.js");
    assert.doesNotMatch(quests, /cut\(forGameText/, "no character-count cut left");
    assert.doesNotMatch(quests, /wrap\(forGameText\(t\), 36\)/);
    assert.match(quests, /fitByWidth\(forGameText\(t\), W, BAND_TEXT_W\)/);
    assert.match(quests, /wrapByWidth\(forGameText\(t\), W, BAND_TEXT_W\)/);
    assert.match(quests, /emptyLine: fitByWidth\(/);
});

test("the pause session takes that line and no longer carries the 58-character sentence that ran off the band", () => {
    const session = read("../engine/dw3/ui/pause-root-session.ts");
    assert.match(session, /quests\.emptyLine \?\? /);
    assert.doesNotMatch(session, /Talk to people and explore\. New quests unlock as you play\./);
});
```

- [ ] **Step 2: Run** `node --test tests/text-fit.test.js tests/quests-fit.test.js`. Expected: `text-fit` passes (module from Task 3), `quests-fit` FAILS.

- [ ] **Step 3: `web/quests.js`:**

```diff
--- a/web/quests.js
+++ b/web/quests.js
@@ -19,6 +19,8 @@
 import { fx } from "./ambience.js";
 import { on } from "./gameEvents.js";
 import { wrap } from "./dialogue-pack.js";
+import { fitByWidth, wrapByWidth, BAND_TEXT_W } from "./text-fit.js";   // measured widths, not character counts
+import { textWidth } from "./uifont.js";
 import { validateScene } from "./quest-scenes.js";
 import { installTriggers } from "./quest-triggers.js";
 import { offersAt, offerLabels } from "./quest-offers.js";   // the offer loop's filters, written once (F2: pick which job)
@@ -709,7 +711,8 @@
 export function questsPausePage() {
     if (!enabled() || !defs.length) return null;
     const MARK = { ready: "! ", active: "- ", available: "? " };
-    const cut = (t, n) => (t.length > n ? t.slice(0, n) : t);           // the page has no room for an ellipsis
+    const W = (s) => textWidth(s);                                       // the game font's own advance widths
+    const TITLE_W = 126;                                                 // the list window's text area (x 189 to the window edge)
     const entries = logEntries().filter(({ d, s }) => s === "ready" || s === "active" || (s === "available" && isHere(d))).map(({ d, s }) => {
         const a = st.active[d.id];
         const k = d.objectives.findIndex((_, j) => ((a?.p[j]) || 0) < targetOf(d, j));
@@ -718,15 +721,15 @@
             : s === "available" ? (d.offer ? `Talk to ${d.offer.name} in ${placesOf(d.offer.maps.slice(0, 1))}` : d.acceptAt ? `Accept it at ${placesOf(d.acceptAt.slice(0, 1))}` : "Open it with F3")
             : (k >= 0 ? objectiveText(d, k) : "");
         const rw = [d.reward?.bits ? `${d.reward.bits} BIT` : "", ...(d.reward?.items ?? []).map((it) => `${it.count ?? 1} ${it.name}`)].filter(Boolean).join(", ");
-        const line = (t) => cut(forGameText(t), 36);
+        const line = (t) => fitByWidth(forGameText(t), W, BAND_TEXT_W);     // the page has no room for an ellipsis
         // the full text, for reading: description, every objective with its progress, the reward and where to go
         const full = [d.text ?? "", ...d.objectives.map((_, j) => "- " + objectiveText(d, j)), rw ? `Reward: ${rw}` : "", goal]
-            .filter(Boolean).flatMap((t) => wrap(forGameText(t), 36));
+            .filter(Boolean).flatMap((t) => wrapByWidth(forGameText(t), W, BAND_TEXT_W));
         const pages = [];
         for (let i = 0; i < full.length; i += 3) pages.push([full[i] ?? "", full[i + 1] ?? "", full[i + 2] ?? ""]);
-        return { title: cut(MARK[s] + forGameText(d.short ?? d.title), 16), lines: [line(d.title), line(goal), line(rw ? `Reward: ${rw}` : "")], pages: pages.length ? pages : [["", "", ""]] };
+        return { title: fitByWidth(MARK[s] + forGameText(d.short ?? d.title), W, TITLE_W), lines: [line(d.title), line(goal), line(rw ? `Reward: ${rw}` : "")], pages: pages.length ? pages : [["", "", ""]] };
     });
-    return { prompt: "QUESTS   Enter: Read", readPrompt: "QUESTS   Enter: Next", entries };
+    return { prompt: "QUESTS   Enter: Read", readPrompt: "QUESTS   Enter: Next", emptyLine: fitByWidth("Explore and talk to people. Quests appear as you play.", W, BAND_TEXT_W), entries };
 }
 
 function installUi(stageEl) {
```

- [ ] **Step 4: `engine/dw3/ui/pause-root-session.ts`:**

```diff
--- a/engine/dw3/ui/pause-root-session.ts
+++ b/engine/dw3/ui/pause-root-session.ts
@@ -169,6 +169,8 @@
   /** EXTRA (not on the disc): what the QUESTS page lists. Each entry's `lines` are the three description lines shown under the list. */
   quests?: {
     prompt: string; readPrompt: string;
+    /** The one line shown when there are no quests, already fitted to the band's width by the caller (web/text-fit.js). */
+    emptyLine?: string;
     /** `pages`: the quest's full text, three lines to a page. */
     entries: ReadonlyArray<{ title: string; lines: readonly [string, string, string]; pages: ReadonlyArray<readonly [string, string, string]> }>;
   };
@@ -301,7 +303,7 @@
     const questStrings = quests ? [
       ...quests.entries.map((e) => e.title),
       ...quests.entries.flatMap((e) => [...e.lines]),
-      quests.prompt, "None right now", "Talk to people and explore. New quests unlock as you play.", quests.readPrompt,
+      quests.prompt, "None right now", quests.emptyLine ?? "Explore and talk to people. Quests appear as you play.", quests.readPrompt,
       ...quests.entries.flatMap((e) => e.pages.flatMap((p) => [...p])),
     ] : [];
     const detailStart: number[] = [];                       // where each quest's full text starts in that bank
```

- [ ] **Step 5: Run, expect PASS**, then `npm run typecheck` (clean) and `npm run build:engine` (the TypeScript changed), then `node --test tests/lane-b/pause-list.test.js tests/map-visited-flag.test.js`.

- [ ] **Step 6: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 7: Screenshot of the QUESTS page** `/home/dorij/ui-review/build/shots/t5.mjs`: `openGame({fx:{}})`, `press i`, five `ArrowDown` (ITEMS, SORT, MAP, TECHNIQUES, STATUS then QUESTS = row 5 without the Folder Bag), `Enter`, wait 2500, `shot(page, "05-quests-page")`. The help line must end inside the band.

- [ ] **Step 8: Do not commit.** Report changed files.

---

### Task 6: OPTIONS model (rows, pages, Detail, cursor), pure

**Files:**
- Create: `web/options-model.js`, `web/detail-presets.js`
- Test: `tests/options-model.test.js`, `tests/options-old-saves.test.js`

**Interfaces:**
- Consumes: `SPEEDS` from `web/battle-speed.js` (`[1, 1.5, 2, 3]`, read in full).
- Produces: `createOptionsModel(store, pixelFilters)` with `page()`, `row()`, `pageLabels()`, `view()` (rows `{ id, label, numeric, help, value, custom, canLeft, canRight }`), `help()`, `switchPage(d)`, `moveRow(d)`, `change(d)` (each returns `"move" | "change" | null`); `store = { get(key), setMany({ key: value }) }`; `PAGES` (GAME 2 rows, SCREEN 7, SOUND 3, EXTRAS 9), `DETAIL_KEYS` (35), `DETAIL_LEVELS`, `DETAIL_OFF`, `EXTRA_GROUPS`, `OPTIONS_HOME` (home of every one of the 99 keys), `detailOf(store)`, `applyDetail(store, level)`, `buildRows(pixelFilters)`; `web/detail-presets.js` exports `DETAIL_OFF_LOW`, `DETAIL_OFF_MEDIUM` (empty until Task 7).
- Behaviour pinned by the tests (all from the spec, section 2.6 and 6, with the corrections in "Notes on the spec"): defaults read Detail High, Battle speed x1, Random fights Normal, Weather Random, volumes 100, weather sounds On, Quests On and the other eight EXTRAS rows Off; moving Battle speed turns `battlespeed` on and x1 turns it off; Random fights Fewer / More = `rare` / `lure` with `encounterdial` on, Normal turns it off; Detail Original switches all 35 off with `quality` low; no key outside the 35 is touched; the cursor never wraps.

- [ ] **Step 1: Write the failing tests.** `tests/options-model.test.js`:

```js
// OPTIONS rows, pages and cursor (web/options-model.js): every row writes the same keys F2 does, defaults equal today's, and
// every one of the 99 effect keys has a home.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    DETAIL_KEYS, DETAIL_LEVELS, DETAIL_OFF, EXTRA_GROUPS, F2_ONLY_KEYS, OPTIONS_HOME, PAGES, applyDetail, buildRows, createOptionsModel, detailOf,
} from "../web/options-model.js";

const SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
/** [group, key] for every pair of FX_GROUPS, read from the source (ambience.js needs a browser to import). */
const PAIRS = [...SRC.match(/export const FX_GROUPS = \[([\s\S]*?)\n\];/)[1].matchAll(/\["(\w+)", "[^"]*"\]/g)].map((m) => m[1]);
const EXPERIMENTAL = SRC.match(/const EXPERIMENTAL = \[([^\]]*)\];/)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
const BATTLE = ["ownclips", "dw2motion", "smoothanim"];

/** The settings as web/ambience.js starts them: every key on, the EXPERIMENTAL and BATTLE ones off. */
function defaults() {
    const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off", battleSpeed: 2, encounterDialMode: "normal", musicVolume: 1, soundVolume: 1 };
    for (const k of PAIRS) fx[k] = !(EXPERIMENTAL.includes(k) || BATTLE.includes(k));
    return fx;
}
const memoryStore = (fx = defaults()) => ({ fx, get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) });
const FILTERS = [["off", "Off"], ["bilinear", "Smooth"], ["epx", "EPX"]];

test("the 99 effect keys are read from ambience.js, and each has exactly one home", () => {
    const keys = PAIRS.filter((k) => k !== "glossary" && k !== "options");
    assert.equal(keys.length, 99);
    assert.deepEqual(keys.filter((k) => !(k in OPTIONS_HOME)), [], "no key without a home");
    assert.deepEqual(Object.keys(OPTIONS_HOME).filter((k) => !PAIRS.includes(k)), [], "no home for a key that does not exist");
    const count = (h) => Object.values(OPTIONS_HOME).filter((v) => v === h).length;
    assert.deepEqual([count("detail"), F2_ONLY_KEYS.length], [35, 25]);
    assert.equal(Object.values(OPTIONS_HOME).filter((v) => v.startsWith("extra:")).length, 28);
});

test("every home that names a row names a real row, and every row is on a page", () => {
    const rows = buildRows(FILTERS);
    for (const home of new Set(Object.values(OPTIONS_HOME))) if (home !== "detail" && home !== "f2") assert.ok(rows[home], home);
    const onPages = PAGES.flatMap((p) => p.rows).sort();
    assert.deepEqual(onPages, Object.keys(rows).sort());
    assert.deepEqual(PAGES.map((p) => p.rows.length), [2, 7, 3, 9]);
});

test("the four pages are GAME, SCREEN, SOUND, EXTRAS", () => {
    assert.deepEqual(PAGES.map((p) => p.label), ["GAME", "SCREEN", "SOUND", "EXTRAS"]);
});

test("the 35 Detail keys are the F2 groups Terrain, Weather, Atmosphere (minus hd2d and battleatmos), Life (minus villagers), Ground and uisharp", () => {
    assert.equal(new Set(DETAIL_KEYS).size, 35);
    for (const k of DETAIL_KEYS) assert.ok(PAIRS.includes(k), k);
    for (const k of DETAIL_KEYS) assert.ok(!EXPERIMENTAL.includes(k), `${k} is on today, so High = today`);
});

test("at the game's own defaults Detail reads High and every row reads today's behaviour", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(detailOf(store), "high");
    const shown = {};
    for (let p = 0; p < PAGES.length; p++) { for (const r of m.view()) shown[r.id] = r.value; m.switchPage(1); }
    assert.equal(shown.battleSpeed, "x1", "the switch is off, so the game runs x1");
    assert.equal(shown.randomFights, "Normal");
    assert.equal(shown.detail, "High");
    assert.equal(shown.wide, "Off");
    assert.equal(shown.timeOfDay, "Auto");
    assert.equal(shown.weather, "Random");
    assert.equal(shown.pixelFilter, "Off");
    assert.equal(shown.hd2d, "Off");
    assert.equal(shown.toon, "Off");
    assert.deepEqual([shown.musicVolume, shown.soundVolume], ["100", "100"]);
    assert.equal(shown.placeSounds, "On");
    assert.equal(shown["extra:quests"], "On", "Quests stay on, as today");
    for (const g of EXTRA_GROUPS.filter((x) => x.id !== "quests")) assert.equal(shown[`extra:${g.id}`], "Off", g.id);
});

test("Detail Original switches all 35 off, High all on, and each level goes through detailOf and back", () => {
    const store = memoryStore();
    applyDetail(store, "original");
    assert.ok(DETAIL_KEYS.every((k) => store.fx[k] === false));
    assert.equal(store.fx.quality, "low");
    assert.equal(detailOf(store), "original");
    for (const level of DETAIL_LEVELS) { applyDetail(store, level); assert.equal(detailOf(store), level, level); }
    applyDetail(store, "high");
    assert.ok(DETAIL_KEYS.every((k) => store.fx[k] === true));
    assert.equal(store.fx.quality, "high");
});

test("Detail never touches a key outside the 35 (hd2d, widefield, quests, sound stay as they were)", () => {
    const store = memoryStore();
    Object.assign(store.fx, { hd2d: true, widefield: true, sound: false });
    const before = { ...store.fx };
    for (const level of DETAIL_LEVELS) applyDetail(store, level);
    applyDetail(store, "high");
    for (const k of Object.keys(before)) if (!DETAIL_KEYS.includes(k) && k !== "quality") assert.equal(store.fx[k], before[k], k);
});

test("Low switches off at least what Medium does, which switches off at least nothing; all inside the 35", () => {
    const low = new Set(DETAIL_OFF.low), med = new Set(DETAIL_OFF.medium);
    for (const k of med) assert.ok(low.has(k), `${k}: off in Medium so off in Low`);
    for (const k of low) assert.ok(DETAIL_KEYS.includes(k), k);
    assert.ok(low.size >= med.size && med.size < DETAIL_KEYS.length);
});

test("an F2 edit that matches no level reads Custom; right picks the first level and left the last", () => {
    const store = memoryStore();
    store.fx.rain = false;
    store.fx.quality = "medium";
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1);
    const row = m.view()[0];
    assert.deepEqual([row.id, row.value, row.custom], ["detail", "Custom", true]);
    assert.equal(m.change(1), "change");
    assert.equal(detailOf(store), "original");
    store.fx.rain = false; store.fx.quality = "medium";
    assert.equal(m.change(-1), "change");
    assert.equal(detailOf(store), "high");
});

test("battle speed: moving it turns its switch on by itself, x1 turns it off again", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(m.change(1), "change");
    assert.deepEqual([store.fx.battlespeed, store.fx.battleSpeed], [true, 1.5]);
    assert.equal(m.view()[0].value, "x1.5");
    m.change(1); m.change(1);
    assert.deepEqual([store.fx.battlespeed, store.fx.battleSpeed], [true, 3]);
    assert.equal(m.change(1), null, "x3 is the end; no wrap");
    for (let i = 0; i < 3; i++) m.change(-1);
    assert.deepEqual([store.fx.battlespeed, store.fx.battleSpeed], [false, 1]);
    assert.equal(m.view()[0].value, "x1");
});

test("battle speed shows the F2 slider's value when the switch is on, and x1 when it is off", () => {
    const store = memoryStore();
    Object.assign(store.fx, { battlespeed: true, battleSpeed: 2 });
    assert.equal(createOptionsModel(store, FILTERS).view()[0].value, "x2");
    store.fx.battleSpeed = 2.4;
    assert.equal(createOptionsModel(store, FILTERS).view()[0].value, "x2", "nearest position");
    store.fx.battlespeed = false;
    assert.equal(createOptionsModel(store, FILTERS).view()[0].value, "x1");
});

test("random fights: Fewer / More turn the dial on, Normal turns it off; a stored 'none' reads Never", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.moveRow(1);
    m.change(-1);
    assert.deepEqual([store.fx.encounterdial, store.fx.encounterDialMode], [true, "rare"]);
    m.change(1); m.change(1);
    assert.deepEqual([store.fx.encounterdial, store.fx.encounterDialMode], [true, "lure"]);
    m.change(-1);
    assert.deepEqual([store.fx.encounterdial, store.fx.encounterDialMode], [false, "normal"]);
    Object.assign(store.fx, { encounterdial: true, encounterDialMode: "none" });
    assert.equal(m.view()[1].value, "Never");
});

test("weather uses the F2 select's real values (auto, always, storm, clear)", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); for (let i = 0; i < 3; i++) m.moveRow(1);
    assert.equal(m.view()[3].id, "weather");
    m.change(1); assert.equal(store.fx.weatherMode, "always");
    m.change(1); assert.equal(store.fx.weatherMode, "storm");
    m.change(1); assert.equal(store.fx.weatherMode, "clear");
    assert.equal(m.change(1), null);
});

test("wide screen sets both keys, toon both keys, weather sounds all four; EXTRAS rows move their whole group", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); m.moveRow(1); m.change(1);
    assert.deepEqual([store.fx.widefield, store.fx.battlewide], [true, true]);
    m.moveRow(5); assert.equal(m.view()[6].id, "toon"); m.change(1);
    assert.deepEqual([store.fx.toonoutline, store.fx.toonshade], [true, true]);
    m.switchPage(1); m.moveRow(2); m.change(-1);
    assert.deepEqual(["sound", "ambience", "musicfx", "footsteps"].map((k) => store.fx[k]), [false, false, false, false]);
    m.switchPage(1);
    m.moveRow(1); m.change(1);                     // Mount on
    assert.deepEqual([store.fx.mount, store.fx.mountseat], [true, true]);
    m.moveRow(-1); m.change(-1);                   // Quests off
    assert.deepEqual(["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"].map((k) => store.fx[k]), [false, false, false, false, false]);
});

test("an extras row reads On when any of its keys is on (F2 can set one by hand) and Off turns them all off", () => {
    const store = memoryStore();
    store.fx.bossmusic = true;
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); m.switchPage(1); m.switchPage(1);
    m.moveRow(2);
    assert.equal(m.view()[2].value, "On");
    m.change(-1);
    assert.deepEqual(["fusionbosses", "bossphases", "bossmusic", "bossgrows"].map((k) => store.fx[k]), [false, false, false, false]);
});

test("volumes move in tenths from 100 and are stored as 0..1", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); m.switchPage(1);
    assert.equal(m.view()[0].id, "musicVolume");
    m.change(-1); assert.equal(store.fx.musicVolume, 0.9);
    for (let i = 0; i < 12; i++) m.change(-1);
    assert.equal(store.fx.musicVolume, 0);
    assert.equal(m.view()[0].value, "0");
    assert.equal(m.change(-1), null);
    store.fx.soundVolume = undefined;
    assert.equal(m.view()[1].value, "100", "a missing value reads as today's gain");
});

test("the cursor never wraps, switching page resets the row, and the help line follows the row", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    assert.equal(m.moveRow(-1), null);
    assert.equal(m.moveRow(1), "move");
    assert.equal(m.moveRow(1), null, "GAME has two rows");
    assert.match(m.help(), /wild Digimon/);
    assert.equal(m.switchPage(-1), null);
    assert.equal(m.switchPage(1), "move");
    assert.equal(m.row(), 0);
    for (let i = 0; i < 5; i++) m.switchPage(1);
    assert.equal(m.page(), 3);
    assert.equal(m.view().length, 9);
});

test("a pixel filter list drives that row; a stored filter not in the list reads the first", () => {
    const store = memoryStore();
    const m = createOptionsModel(store, FILTERS);
    m.switchPage(1); for (let i = 0; i < 4; i++) m.moveRow(1);
    m.change(1);
    assert.equal(store.fx.spriteFilter, "bilinear");
    store.fx.spriteFilter = "xbr";
    assert.equal(m.view()[4].value, "Off");
});
```

`tests/options-old-saves.test.js`:

```js
// Review focus: settings saved by older builds or edited by hand must not break the OPTIONS screen (web/options-model.js).
import test from "node:test";
import assert from "node:assert/strict";
import { PAGES, createOptionsModel } from "../web/options-model.js";

const store = (fx) => ({ get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) });
const everyRow = (m) => {
    const out = {};
    for (let p = 0; p < PAGES.length; p++) { for (const r of m.view()) out[r.id] = r; m.switchPage(1); }
    return out;
};

test("an empty or nonsense settings object still gives every row a value text", () => {
    for (const fx of [{}, { weatherMode: "stormy", todMode: 7, spriteFilter: "nearest4", battleSpeed: "fast", battlespeed: true, musicVolume: "loud", soundVolume: null, quality: 12 }]) {
        const rows = everyRow(createOptionsModel(store(fx), [["off", "Off"]]));
        assert.equal(Object.keys(rows).length, 2 + 7 + 3 + 9);
        for (const r of Object.values(rows)) assert.equal(typeof r.value, "string", r.id);
    }
});

test("the old documented weather word 'stormy' is not a value; it reads the first choice and moving it writes a real one", () => {
    const fx = { weatherMode: "stormy" };
    const m = createOptionsModel(store(fx), [["off", "Off"]]);
    m.switchPage(1); for (let i = 0; i < 3; i++) m.moveRow(1);
    assert.equal(m.view()[3].value, "Random");
    m.change(1);
    assert.equal(fx.weatherMode, "always");
});

test("a volume saved outside 0..1 is shown inside 0..100", () => {
    const fx = { musicVolume: 7, soundVolume: -2 };
    const m = createOptionsModel(store(fx), [["off", "Off"]]);
    m.switchPage(1); m.switchPage(1);
    assert.deepEqual(m.view().slice(0, 2).map((r) => r.value), ["100", "0"]);
});

test("a battle speed saved above x3 shows x3 and one step left gives x2", () => {
    const fx = { battlespeed: true, battleSpeed: 99 };
    const m = createOptionsModel(store(fx), [["off", "Off"]]);
    assert.equal(m.view()[0].value, "x3");
    m.change(-1);
    assert.equal(fx.battleSpeed, 2);
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found).

- [ ] **Step 3: Create `web/detail-presets.js`:**

```js
// web/detail-presets.js -- the Detail keys that Low and Medium switch OFF (web/options-model.js).
// Empty until tools/measure_fx_cost.mjs --write has measured the cost of each effect (build step 2, task 7); until then Low and
// Medium differ from High only by fx.quality (the weather-particle density), and every Detail key stays on.
export const DETAIL_OFF_LOW = Object.freeze([]);
export const DETAIL_OFF_MEDIUM = Object.freeze([]);
```

- [ ] **Step 4: Create `web/options-model.js`:**

```js
// web/options-model.js -- the OPTIONS screen's rows, pages and cursor. Pure: no DOM, no window; the settings object is
// passed in as a store { get(key), setMany({key: value}) } (web/ambience.js: window.__fx, window.__setFxMany).
//
// Same store and same keys as the F2 panel (localStorage "dw.fx.v1", web/ambience.js). OPTIONS adds no key of its own except
// the two volumes (musicVolume, soundVolume; 1 = today's gain). Every one of the 99 FX_GROUPS keys has a home in OPTIONS,
// in the Detail preset, or on F2 only (OPTIONS_HOME below; pinned by tests/options-model.test.js).
import { SPEEDS } from "./battle-speed.js";
import { DETAIL_OFF_LOW, DETAIL_OFF_MEDIUM } from "./detail-presets.js";

// ---------------------------------------------------------------- key homes
/** The 35 effect keys the one Detail choice sets (web/ambience.js groups Terrain, Weather, Atmosphere, Life, Ground, Screen). */
export const DETAIL_KEYS = Object.freeze([
    "sway", "grass", "grasspush", "water", "reflect", "mirror", "wetlook", "seam",
    "rain", "rainwater", "snow", "sand", "lightning", "gusts", "breath", "frost", "screenfx",
    "tod", "nightlight", "clouds", "lamps", "lightpool", "lightreveal", "indoor", "fog", "shafts", "heat", "sparkle", "pollen",
    "leaves", "fireflies", "devils", "steps", "puddles", "uisharp",
]);
export const DETAIL_LEVELS = Object.freeze(["original", "low", "medium", "high"]);
export const DETAIL_LABELS = Object.freeze(["Original", "Low", "Medium", "High"]);
/** Keys each level switches OFF. Original = all 35 (the PS1 look); High = none. Low and Medium come from the measurement (tools/measure_fx_cost.mjs). */
export const DETAIL_OFF = Object.freeze({ original: DETAIL_KEYS, low: DETAIL_OFF_LOW, medium: DETAIL_OFF_MEDIUM, high: Object.freeze([]) });
/** fx.quality (weather-particle density, web/ambience.js QUALITY) that goes with each level. */
export const DETAIL_QUALITY = Object.freeze({ original: "low", low: "low", medium: "medium", high: "high" });

/** The EXTRAS rows: one per group of invented features. A row is ON when any of its keys is on; moving it sets all of them. */
export const EXTRA_GROUPS = Object.freeze([
    { id: "quests", label: "Quests", keys: ["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"], help: "Extra quests with their own people and places, hints, emotes and place cards." },
    { id: "mount", label: "Mount", keys: ["mount", "mountseat"], help: "Ride a Digimon that a quest unlocks. The rider sits in the saddle." },
    { id: "boss", label: "Boss ideas", keys: ["fusionbosses", "bossphases", "bossmusic", "bossgrows"], help: "Bosses that fuse, change phase, change the music and grow when angry." },
    { id: "giant", label: "Giant mode", keys: ["giantmode"], help: "Any fighter in a battle can be drawn at another size." },
    { id: "battleideas", label: "Battle ideas", keys: ["fieldwar", "omen", "practice2v2", "enemytells", "aishift"], help: "Field wars, a feeling before a fight, 2 vs 2 practice, enemy tells and a pattern breaker." },
    { id: "battlemotion", label: "Battle motion", keys: ["ownclips", "dw2motion", "smoothanim"], help: "Own attack clips, Digimon World 2 motion for empty clips, smoother animation." },
    { id: "camera", label: "Camera and look", keys: ["smartcam", "battlepano", "softalpha", "battleatmos"], help: "A smarter 2 vs 2 camera, painted battle backdrops, soft edges, battle sky and weather." },
    { id: "villagers", label: "Villagers", keys: ["villagers"], help: "Ambient villagers walking about town." },
    { id: "online", label: "Online", keys: ["serverchamp", "mpbubbles", "mpcredit"], help: "League play, reaction bubbles and co-op wins that count for quests." },
]);
const SOUND_KEYS = Object.freeze(["sound", "ambience", "musicfx", "footsteps"]);
const WIDE_KEYS = Object.freeze(["widefield", "battlewide"]);
const TOON_KEYS = Object.freeze(["toonoutline", "toonshade"]);
/** Keys that stay on F2 only (developer pages and labs). */
export const F2_ONLY_KEYS = Object.freeze([
    "codex", "blastladder", "planner", "itemsource", "gymmap", "itemrulebook", "anglermap", "movetheatre", "cutcontent", "stageselect",
    "soundtest", "soundtrack", "cinema", "langdesk", "damagelab", "silence", "cursorbook", "chatqueue", "weaponlab", "bitledger",
    "savexray", "saveverify", "replay", "redirectview", "arrivallab",
]);
/** Where each of the 99 keys lives: "detail", an OPTIONS row id, or "f2". (The two new dev switches `glossary` and `options` are F2 only too.) */
export const OPTIONS_HOME = (() => {
    const home = {};
    for (const k of DETAIL_KEYS) home[k] = "detail";
    home.battlespeed = "battleSpeed"; home.encounterdial = "randomFights";
    for (const k of WIDE_KEYS) home[k] = "wide";
    home.hd2d = "hd2d";
    for (const k of TOON_KEYS) home[k] = "toon";
    for (const k of SOUND_KEYS) home[k] = "placeSounds";
    for (const g of EXTRA_GROUPS) for (const k of g.keys) home[k] = `extra:${g.id}`;
    for (const k of F2_ONLY_KEYS) home[k] = "f2";
    home.glossary = "f2"; home.options = "f2";
    return Object.freeze(home);
})();

// ---------------------------------------------------------------- reading and writing the store
const on = (store, keys) => keys.some((k) => store.get(k) === true);
const setAll = (store, keys, value) => store.setMany(Object.fromEntries(keys.map((k) => [k, value])));

/** "original" | "low" | "medium" | "high", or "custom" when F2 has put the 35 keys somewhere between. */
export function detailOf(store) {
    for (const level of [...DETAIL_LEVELS].reverse()) {
        const off = new Set(DETAIL_OFF[level]);
        if (DETAIL_KEYS.every((k) => (store.get(k) === true) === !off.has(k)) && store.get("quality") === DETAIL_QUALITY[level]) return level;
    }
    return "custom";
}
export function applyDetail(store, level) {
    const off = new Set(DETAIL_OFF[level]);
    store.setMany({ ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, !off.has(k)])), quality: DETAIL_QUALITY[level] });
}

const DIAL = Object.freeze(["rare", "normal", "lure"]);        // fewer / normal / more (web/encounter-dial.js DIAL_MODES)
const TODS = Object.freeze(["auto", "day", "golden", "dusk", "night"]);
const WEATHERS = Object.freeze(["auto", "always", "storm", "clear"]);   // web/ambience.js: the F2 select's values
const VOLUMES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // tenths; 10 = today's gain

const toggleRow = (id, label, help, keys) => ({
    id, label, help, choices: ["Off", "On"],
    read: (s) => (on(s, keys) ? 1 : 0), write: (s, i) => setAll(s, keys, i === 1),
});
const valueRow = (id, label, help, key, values, labels) => ({
    id, label, help, choices: labels,
    read: (s) => Math.max(0, values.indexOf(s.get(key))), write: (s, i) => s.setMany({ [key]: values[i] }),
});
const volumeRow = (id, label, help, key) => ({
    id, label, help, numeric: true, choices: VOLUMES.map((v) => String(v * 10)),
    read: (s) => { const v = Number(s.get(key)); return Number.isFinite(v) ? Math.min(10, Math.max(0, Math.round(v * 10))) : 10; },
    write: (s, i) => s.setMany({ [key]: VOLUMES[i] / 10 }),
});

/** Every row, by id. `pixelFilters` = [[id, label], ...] (web/sprite-filters.js SPRITE_FILTERS limited to the GPU ones). */
export function buildRows(pixelFilters = [["off", "Off"]]) {
    const rows = {
        battleSpeed: {
            id: "battleSpeed", label: "Battle speed", numeric: true, choices: SPEEDS.map((v) => `x${v}`),
            help: "How fast battles run. x1 is the game's own speed.",
            read: (s) => {
                if (s.get("battlespeed") !== true) return 0;                       // the switch is off: the game really runs x1
                const v = Number(s.get("battleSpeed"));
                const want = Number.isFinite(v) ? v : 2;
                return SPEEDS.reduce((best, sp, k) => (Math.abs(sp - want) < Math.abs(SPEEDS[best] - want) ? k : best), 0);
            },
            write: (s, i) => (SPEEDS[i] === 1 ? s.setMany({ battlespeed: false, battleSpeed: 1 }) : s.setMany({ battlespeed: true, battleSpeed: SPEEDS[i] })),
        },
        randomFights: {
            id: "randomFights", label: "Random fights", choices: ["Fewer", "Normal", "More"],
            help: "How often wild Digimon jump you on the map.",
            read: (s) => (s.get("encounterdial") === true ? DIAL.indexOf(s.get("encounterDialMode")) : 1),   // -1 = "none" set in F2
            customLabel: () => "Never",
            write: (s, i) => (DIAL[i] === "normal" ? s.setMany({ encounterdial: false, encounterDialMode: "normal" }) : s.setMany({ encounterdial: true, encounterDialMode: DIAL[i] })),
        },
        detail: {
            id: "detail", label: "Detail", choices: DETAIL_LABELS,
            help: "How many small effects the map shows. Original is the PS1 look, High has all of them.",
            read: (s) => DETAIL_LEVELS.indexOf(detailOf(s)), customLabel: () => "Custom",
            write: (s, i) => applyDetail(s, DETAIL_LEVELS[i]),
        },
        wide: toggleRow("wide", "Wide screen", "Fill a wide window with more of the map at the sides.", WIDE_KEYS),
        timeOfDay: valueRow("timeOfDay", "Time of day", "Pin the light to a time of day, or let it cycle.", "todMode", TODS, ["Auto", "Day", "Golden", "Dusk", "Night"]),
        weather: valueRow("weather", "Weather", "Random weather, always on, storms only, or clear skies.", "weatherMode", WEATHERS, ["Random", "Always", "Storms", "Clear"]),
        pixelFilter: valueRow("pixelFilter", "Pixel filter", "Smooths the pixels of the whole picture.", "spriteFilter", pixelFilters.map((f) => f[0]), pixelFilters.map((f) => f[1])),
        hd2d: toggleRow("hd2d", "HD-2D look", "Tilt-shift blur, bloom and colour grade on the map.", ["hd2d"]),
        toon: toggleRow("toon", "Toon look", "Black outlines and flat cel light on the Digimon in battle.", TOON_KEYS),
        musicVolume: volumeRow("musicVolume", "Music volume", "How loud the music is. 100 is the game's own level.", "musicVolume"),
        soundVolume: volumeRow("soundVolume", "Sound volume", "How loud effects, weather and place sounds are. 100 is the game's own level.", "soundVolume"),
        placeSounds: toggleRow("placeSounds", "Weather sounds", "Rain, wind, water and city sounds, footsteps, and music that reacts to weather.", SOUND_KEYS),
    };
    for (const g of EXTRA_GROUPS) rows[`extra:${g.id}`] = toggleRow(`extra:${g.id}`, g.label, g.help, g.keys);
    return rows;
}

/** The four pages, in order, and the row ids on each (Q / E switch the page). */
export const PAGES = Object.freeze([
    { id: "game", label: "GAME", rows: ["battleSpeed", "randomFights"] },
    { id: "screen", label: "SCREEN", rows: ["detail", "wide", "timeOfDay", "weather", "pixelFilter", "hd2d", "toon"] },
    { id: "sound", label: "SOUND", rows: ["musicVolume", "soundVolume", "placeSounds"] },
    { id: "extras", label: "EXTRAS", rows: EXTRA_GROUPS.map((g) => `extra:${g.id}`) },
]);

// ---------------------------------------------------------------- the cursor
/**
 * Pages, cursor and value changes. No wrap anywhere (the pause list does not wrap: pause-menu-screen-tree-2026-08-14.md).
 * Every method returns what the screen should do: "move" (play the cursor sound), "change" (a value moved), or null.
 */
export function createOptionsModel(store, pixelFilters) {
    const rows = buildRows(pixelFilters);
    let page = 0, row = 0;
    const pageRows = () => PAGES[page].rows.map((id) => rows[id]);
    const here = () => pageRows()[row];
    return {
        page: () => page,
        row: () => row,
        pageLabels: () => PAGES.map((p) => p.label),
        /** What the list shows now: label, current value text, and flags, for each row of the page. */
        view() {
            return pageRows().map((r) => {
                const i = r.read(store);
                return {
                    id: r.id, label: r.label, numeric: !!r.numeric, help: r.help,
                    value: i < 0 ? (r.customLabel?.() ?? "Custom") : r.choices[i],
                    custom: i < 0, canLeft: i > 0, canRight: i < r.choices.length - 1,
                };
            });
        },
        help: () => here().help,
        switchPage(d) {
            const next = Math.min(PAGES.length - 1, Math.max(0, page + d));
            if (next === page) return null;
            page = next; row = 0; return "move";
        },
        moveRow(d) {
            const next = Math.min(pageRows().length - 1, Math.max(0, row + d));
            if (next === row) return null;
            row = next; return "move";
        },
        /** d = -1 / +1. From a custom value, right picks the first choice and left the last. */
        change(d) {
            const r = here(), i = r.read(store);
            const next = i < 0 ? (d > 0 ? 0 : r.choices.length - 1) : Math.min(r.choices.length - 1, Math.max(0, i + d));
            if (next === i) return null;
            r.write(store, next); return "change";
        },
    };
}
```

- [ ] **Step 5: Run, expect PASS** (`node --test tests/options-model.test.js tests/options-old-saves.test.js`, 18 + 4 tests). The first test parses `web/ambience.js` (it needs the two dev switches from Task 4: they are in the file by now).

- [ ] **Step 6: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 7: Screenshot** `/home/dorij/ui-review/build/shots/t6.mjs` = t1 with name `06-pause-list-unchanged` (pure module, nothing visible changed).

- [ ] **Step 8: Do not commit.** Report changed files.

---

### Task 7: measure what each Detail effect costs; fill Low and Medium

**Files:**
- Create: `tools/measure_fx_cost.mjs`
- Create (by the tool): `docs/superpowers/measurements/fx-cost-2026-11-04.json`
- Modify (by the tool): `web/detail-presets.js`
- Test: `tests/options-model.test.js` (unchanged; it already checks Low is a superset of Medium, both inside the 35)

**Interfaces:**
- Consumes: `DETAIL_KEYS` (Task 6), `openGame` (Task 1), `window.__setFx`.
- Produces: the real `DETAIL_OFF_LOW` and `DETAIL_OFF_MEDIUM`. Rule written into the tool header: Medium switches off every key costing >= 0.5 ms per 60 Hz frame of main-thread time, Low every key costing >= 0.15 ms; a difference under twice the baseline spread counts as 0. This is the measurement the spec asks for ("to measure at build step 2"). It measures main-thread busy time (CDP `TaskDuration`), because at the 60 Hz cap the frame rate hides the cost (`ui-review/NOTES.md`: 60.1 fps with everything on or off). GPU time is not in the number.
- Maps: `s245`, `s200`, `s330` (the three the existing verifiers use most: `grep -o "map=s[0-9]*" -rh tools tests | sort | uniq -c`). The tool forces `weatherMode: "always"` and `todMode: "night"`. If a key shows 0 on all three maps, it stays on in every level (nothing to save).

- [ ] **Step 1: Create `tools/measure_fx_cost.mjs`:**

```js
// tools/measure_fx_cost.mjs -- what each of the 35 Detail effects costs the page's main thread, per frame. Numbers only.
//
//   python3 /home/dorij/serve_game.py &            (port 8090)
//   tools/run-playwright.sh tools/measure_fx_cost.mjs [--write]
//
// Method: for each test map, load the game with EVERY Detail key off (and fx.quality "low") and sample the browser's own busy
// time (CDP Performance.getMetrics TaskDuration; this shows cost even when the 60 Hz cap hides it from the frame rate). Then
// switch ONE key on, wait for it to settle, sample again. cost(key) = busy ms per 60 Hz frame with the key on minus the baseline;
// the baseline is sampled three times and the spread is the noise floor, so a difference under twice the spread counts as 0.
// A key's cost is its largest cost over the maps (an effect that only exists on some maps shows on those). Weather is forced
// "always" and the time of day "night" so rain / lamps / fireflies have something to do where the map allows them.
// GPU time is NOT in this number (the page does not see it); the GPU is the AMD card and is far from busy at 60 Hz.
//
// Rule that fills web/detail-presets.js with --write:  Medium switches off every key costing >= 0.5 ms;
// Low switches off every key costing >= 0.15 ms.  (Original = all 35 off; High = none; those two need no data.)
import { writeFileSync, mkdirSync } from "node:fs";
import { openGame } from "./ui_shot.mjs";
import { DETAIL_KEYS } from "../web/options-model.js";

const MAPS = ["s245", "s200", "s330"];          // the maps the existing verifiers use most (grep "map=s" tools tests)
const MEDIUM_MS = 0.5, LOW_MS = 0.15;
const WARM_MS = 2500, SAMPLE_MS = 5000;

async function busyMsPerFrame(page, cdp) {
    const read = async () => {
        const { metrics } = await cdp.send("Performance.getMetrics");
        const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0;
        return { task: get("TaskDuration"), time: get("Timestamp") };
    };
    await page.waitForTimeout(WARM_MS);
    const a = await read();
    await page.waitForTimeout(SAMPLE_MS);
    const b = await read();
    return ((b.task - a.task) / (b.time - a.time)) * (1000 / 60);   // busy fraction -> ms per 60 Hz frame
}

const offAll = Object.fromEntries(DETAIL_KEYS.map((k) => [k, false]));
const results = {};
for (const map of MAPS) {
    const fx = { ...offAll, quality: "low", weatherMode: "always", todMode: "night" };
    const { browser, page } = await openGame({ fx, map });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const base = [await busyMsPerFrame(page, cdp), await busyMsPerFrame(page, cdp), await busyMsPerFrame(page, cdp)];
    const baseline = base.reduce((s, v) => s + v, 0) / 3;
    const noise = Math.max(...base) - Math.min(...base);
    console.log(`${map}: baseline ${baseline.toFixed(3)} ms, noise ${noise.toFixed(3)} ms`);
    for (const key of DETAIL_KEYS) {
        await page.evaluate((k) => window.__setFx(k, true), key);
        const ms = await busyMsPerFrame(page, cdp);
        await page.evaluate((k) => window.__setFx(k, false), key);
        const cost = ms - baseline > 2 * noise ? ms - baseline : 0;
        results[key] = Math.max(results[key] ?? 0, cost);
        console.log(`${map} ${key}: ${cost.toFixed(3)} ms`);
    }
    await browser.close();
}

const offAt = (ms) => DETAIL_KEYS.filter((k) => results[k] >= ms);
const medium = offAt(MEDIUM_MS), low = offAt(LOW_MS);
console.log(JSON.stringify({ maps: MAPS, costMs: results, medium, low }, null, 2));
if (process.argv.includes("--write")) {
    mkdirSync("docs/superpowers/measurements", { recursive: true });
    writeFileSync("docs/superpowers/measurements/fx-cost-2026-11-04.json", JSON.stringify({ maps: MAPS, mediumMs: MEDIUM_MS, lowMs: LOW_MS, costMs: results }, null, 2) + "\n");
    writeFileSync("web/detail-presets.js", `// web/detail-presets.js -- the Detail keys that Low and Medium switch OFF. GENERATED by tools/measure_fx_cost.mjs --write
// from docs/superpowers/measurements/fx-cost-2026-11-04.json (Medium: keys costing >= ${MEDIUM_MS} ms a frame; Low: >= ${LOW_MS} ms).
export const DETAIL_OFF_LOW = Object.freeze(${JSON.stringify(low)});
export const DETAIL_OFF_MEDIUM = Object.freeze(${JSON.stringify(medium)});
`);
    console.log("wrote web/detail-presets.js");
}
```

- [ ] **Step 2: Syntax check:** `node --check tools/measure_fx_cost.mjs` Expected: no output.

- [ ] **Step 3: Run it** (about 15 minutes; run in the background, GPU, hidden): `cd /home/dorij/dw2003-play-integration && tools/run-playwright.sh tools/measure_fx_cost.mjs --write 2>&1 | tee /home/dorij/ui-review/build/fx-cost.log`. Expected: `WebGL renderer: ... AMD ...`, one line per map and key, then the JSON, then `wrote web/detail-presets.js`. If the renderer is not AMD it throws: stop and report.

- [ ] **Step 4: Check the output is sane:** `cat web/detail-presets.js` shows two frozen arrays; every name is one of the 35. Run `node --test tests/options-model.test.js` Expected: PASS (Low is a superset of Medium by construction: 0.15 < 0.5).

- [ ] **Step 5: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 6: Screenshot:** none to show for a data task; re-take `07-pause-list-unchanged` with the t1 script to keep the rule. Report the two lists and the five most expensive keys with their ms in the final message.

- [ ] **Step 7: Do not commit.** Report changed files (including the measurement JSON).

---

### Task 8: volumes (music, sound) and the batch setter

**Files:**
- Create: `web/volume-levels.js`
- Modify: `web/audio.js`, `web/fxaudio.js`, `web/ambience.js`, `web/game.js`
- Test: `tests/volumes.test.js`

**Interfaces:**
- Consumes: Task 4's `web/ambience.js` and `web/game.js`.
- Produces: `fx.musicVolume` and `fx.soundVolume` (numbers 0 to 1, default 1 = the game's own gain: music element 0.6 at `web/audio.js:63` and jingles `:109`, effects 0.7 at `:132`, weather 0.55 at `web/fxaudio.js:26`), saved in `dw.fx.v1` like every other setting; `player.setVolume(level)` on the music and the effects player; `setWeatherVolume(v)` in `web/fxaudio.js`; `setFxMany(values)` and `window.__setFxMany` in `web/ambience.js` (one save for many keys). The volumes are applied on every settings change (`syncLegacyFlags` -> `applyVolumes`) and when `web/game.js` creates the players.

- [ ] **Step 1: Write the failing test** `tests/volumes.test.js`:

```js
// OPTIONS volumes (web/volume-levels.js) and how they reach the three players. 1 = today's gain, so nothing moves until the
// player moves a slider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_GAIN, clampLevel, scaleGain } from "../web/volume-levels.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the base gains are the ones the game has always used: music 0.6, effects 0.7, weather 0.55", () => {
    assert.deepEqual({ ...BASE_GAIN }, { music: 0.6, effects: 0.7, weather: 0.55 });
});

test("level 1 leaves each gain exactly as it was; 0 is silence; half is half", () => {
    for (const base of Object.values(BASE_GAIN)) {
        assert.equal(scaleGain(base, 1), base);
        assert.equal(scaleGain(base, 0), 0);
        assert.equal(scaleGain(base, 0.5), base * 0.5);
    }
});

test("a missing, empty or non-numeric level reads as 1 and a stray number is clamped to 0..1", () => {
    for (const bad of [undefined, null, "", "loud", NaN]) assert.equal(clampLevel(bad), 1, String(bad));
    assert.equal(clampLevel(7), 1);
    assert.equal(clampLevel(-3), 0);
    assert.equal(clampLevel("0.3"), 0.3);
});

test("audio.js: both players have setVolume, the starting gains are unchanged, jingles follow the music level", () => {
    const src = read("../web/audio.js");
    assert.match(src, /el\.volume = BASE_GAIN\.music;/);
    assert.match(src, /gain\.gain\.value = BASE_GAIN\.effects;/);
    assert.equal((src.match(/player\.setVolume = /g) || []).length, 2, "one on the music player, one on the effects player");
    assert.match(src, /je\.volume = scaleGain\(BASE_GAIN\.music, musicLevel\)/);
    assert.doesNotMatch(src, /\.volume = 0\.6/, "no hard-coded 0.6 left");
});

test("fxaudio.js: the weather master is 0.55 times the level, at build and on every setSound", () => {
    const src = read("../web/fxaudio.js");
    assert.match(src, /master\.gain\.value = 0\.55 \* level;/);
    assert.match(src, /ease\(master\.gain, on \? 0\.55 \* level : 0, ac, 0\.2\);/);
    assert.match(src, /export function setWeatherVolume\(v\)/);
});

test("ambience.js: both volumes start at 1, setFxMany saves once, and every settings change re-applies the volumes", () => {
    const src = read("../web/ambience.js");
    assert.match(src, /fx\.musicVolume = 1;/);
    assert.match(src, /fx\.soundVolume = 1;/);
    assert.match(src, /export function setFxMany\(values\) \{\s*Object\.assign\(fx, values\);\s*syncLegacyFlags\(\);\s*save\(Object\.keys\(values\)\);/);
    assert.match(src, /window\.__setFxMany = setFxMany;/);
    assert.match(src, /window\.__lightGain = fx\.lightGain;[^\n]*\n\s*applyVolumes\(\);/);
    assert.match(src, /window\.__bgm\?\.setVolume\?\.\(fx\.musicVolume\);/);
    assert.match(src, /window\.__sfx\?\.setVolume\?\.\(fx\.soundVolume\);/);
    const experimental = src.match(/const EXPERIMENTAL = \[([^\]]*)\];/)[1];
    assert.doesNotMatch(experimental, /Volume/, "the volumes are numbers, not switches");
});

test("game.js applies the saved volumes to the players it creates", () => {
    const src = read("../web/game.js");
    assert.match(src, /bgm\.setVolume\(window\.__fx\?\.musicVolume\);[^\n]*\n\s*sfx\.setVolume\(window\.__fx\?\.soundVolume\);/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Create `web/volume-levels.js`:**

```js
// web/volume-levels.js -- the OPTIONS volumes as multipliers of the game's own fixed gains. Pure.
// 1 = today's gain (music element 0.6 in web/audio.js, effects 0.7, weather and place sounds 0.55 in web/fxaudio.js), so
// nothing changes until the player moves a slider. Anything that is not a number reads 1.

/** A level as a number from 0 to 1; missing or not a number is 1 (today's loudness). */
export function clampLevel(level) {
    if (level === undefined || level === null || level === "") return 1;
    const v = Number(level);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** `base` (the game's own gain) scaled by the player's level. */
export const scaleGain = (base, level) => base * clampLevel(level);

/** The game's own gains, one place. */
export const BASE_GAIN = Object.freeze({ music: 0.6, effects: 0.7, weather: 0.55 });
```

- [ ] **Step 4: `web/audio.js`:**

```diff
--- a/web/audio.js
+++ b/web/audio.js
@@ -1,5 +1,6 @@
 // web/audio.js
 import { battleVoiceGate } from "./battle-voice-gate.js";
+import { BASE_GAIN, clampLevel, scaleGain } from "./volume-levels.js";
 import { packedSampleResolver } from "./packed-sound.js";
 import {
   createSpuVoicePool, renderPhraseNote, PHRASE_SAMPLE_RATE as SAMPLE_RATE,
@@ -60,7 +61,8 @@
 export function createBgmPlayer(register = createExclusiveRegister()) {
   const el = new Audio();
   el.loop = true;
-  el.volume = 0.6;
+  el.volume = BASE_GAIN.music;
+  let musicLevel = 1;                       // the OPTIONS music volume (web/volume-levels.js); 1 = the game's own 0.6
   const player = { muted: false, current: null, el };
 
   // This track's own stop entry, handed to the register: the exclusive
@@ -106,11 +108,18 @@
   player.playJingle = (trackId) => {
     if (player.muted) return;
     let je = jingles.get(trackId);
-    if (!je) { je = new Audio(); je.volume = 0.6; jingles.set(trackId, je); }
+    if (!je) { je = new Audio(); je.volume = scaleGain(BASE_GAIN.music, musicLevel); jingles.set(trackId, je); }
     je.src = "assets/music/" + trackId + ".ogg";
     je.play().catch(() => {});
   };
 
+  /** OPTIONS music volume, 0..1 (1 = today). Applies to the track and to every jingle element. */
+  player.setVolume = (level) => {
+    musicLevel = clampLevel(level);
+    el.volume = scaleGain(BASE_GAIN.music, musicLevel);
+    for (const je of jingles.values()) je.volume = scaleGain(BASE_GAIN.music, musicLevel);
+  };
+
   // call on every user gesture; resumes if autoplay was blocked
   player.unlock = () => {
     if (!player.muted && el.src && el.paused) el.play().catch(() => {});
@@ -129,10 +138,12 @@
   const Ctx = window.AudioContext || window.webkitAudioContext;
   const ctx = Ctx ? new Ctx() : null;
   const gain = ctx ? ctx.createGain() : null;
-  if (gain) { gain.gain.value = 0.7; gain.connect(ctx.destination); }
+  if (gain) { gain.gain.value = BASE_GAIN.effects; gain.connect(ctx.destination); }
   let manifest = null;
   const buffers = {}; // name -> AudioBuffer | Promise
   const player = { muted: false };
+  /** OPTIONS sound volume, 0..1 (1 = today's 0.7): the master gain every effect voice goes through. */
+  player.setVolume = (level) => { if (gain) gain.gain.value = scaleGain(BASE_GAIN.effects, level); };
   const battleGate = battleVoiceGate();
 
   // ── the resident driver's real arbitration (EXE F0x8002006c and callees) ──
```

- [ ] **Step 5: `web/fxaudio.js`:**

```diff
--- a/web/fxaudio.js
+++ b/web/fxaudio.js
@@ -4,6 +4,7 @@
 // block sound before a gesture) and driven every frame by the ambience layer.
 let ac = null, master = null, rain = null, wind = null, sand = null, crickets = null, gust = null;
 let armed = false;
+let level = 1;                 // the OPTIONS sound volume (web/volume-levels.js); 1 = the game's own 0.55
 window.__fxaudioVer = "no-wind-2";
 
 function noiseBuffer(ctx, seconds = 2) {
@@ -23,7 +24,7 @@
 function build() {
     if (ac) return true;
     try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
-    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
+    master = ac.createGain(); master.gain.value = 0.55 * level; master.connect(ac.destination);
     const buf = noiseBuffer(ac, 3);
     rain = loopNoise(ac, buf, "bandpass", 3200, 0.5);
     wind = loopNoise(ac, buf, "lowpass", 480, 0.7);
@@ -53,10 +54,13 @@
 
 const ease = (param, v, ctx, tc = 0.4) => param.setTargetAtTime(v, ctx.currentTime, tc);
 
+/** OPTIONS sound volume, 0..1 (1 = today). Takes effect on the next setSound call, which runs every frame. */
+export function setWeatherVolume(v) { const n = Number(v); level = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1; }
+
 // levels: { rain, wind (0..1), sand, night } ; on = the Sound switch
 export function setSound(on, lv) {
     if (!ac) return;
-    ease(master.gain, on ? 0.55 : 0, ac, 0.2);
+    ease(master.gain, on ? 0.55 * level : 0, ac, 0.2);
     ease(rain.g.gain, on ? lv.rain * 0.16 : 0, ac);
     ease(wind.g.gain, 0, ac, 0.8);   // wind loop removed (harsh); node kept silent
     ease(sand.g.gain, 0, ac);   // sandstorm hiss removed (sounded like wind gusts)
```

- [ ] **Step 6: `web/ambience.js`:**

```diff
--- a/web/ambience.js
+++ b/web/ambience.js
@@ -15,7 +15,7 @@
 import { classSource, variantBase } from "./mapclass.js";
 import { resetScenery, drawScenery, groundScenery, tickWet, wetLevel, todPhaseNow, todColor, cueBolt } from "./scenery.js";
 import { syncVillagers, removeVillagers } from "./crowd.js";
-import { setSound, thunder, footstep, setAmbience, setMusic } from "./fxaudio.js";
+import { setSound, thunder, footstep, setAmbience, setMusic, setWeatherVolume } from "./fxaudio.js";
 import { resetScenery3, drawScenery3 } from "./scenery3.js";
 import { resetScenery2, drawScenery2, gustLevel, hasLights } from "./scenery2.js";
 import { isWaterAt, isWaterStage, waterPixelTest } from "./water3d.js";
@@ -58,6 +58,8 @@
 fx.lightGain = 1;            // Light strength slider (0 to 2)
 fx.hd2dStrength = 1;         // HD-2D strength slider (0 to 2)        // experimental: off until you switch it on
 fx.battleSpeed = 2;          // Faster battles slider (1 to 3, the x1 / x1.5 / x2 / x3 positions; web/battle-speed.js)
+fx.musicVolume = 1;         // OPTIONS music volume, 0..1; 1 = the game's own gain (web/volume-levels.js)
+fx.soundVolume = 1;         // OPTIONS sound volume, 0..1; 1 = the game's own gain
 fx.encounterDialMode = "normal";  // Encounter dial setting (only read while F2 -> Extras -> Encounter dial is on; web/encounter-dial.js)
 try { Object.assign(fx, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch { }
 // Animals were removed: no switch, and an old saved "on" can never bring them back.
@@ -73,6 +75,13 @@
     window.__grassPush = !!fx.grasspush;
     window.__todForce = TODMODES[fx.todMode];
     window.__lightGain = fx.lightGain;        // read by scenery2.js (lamp strength)
+    applyVolumes();
+}
+/** The OPTIONS volumes onto the players (web/game.js also applies them when it creates the players). */
+function applyVolumes() {
+    window.__bgm?.setVolume?.(fx.musicVolume);
+    window.__sfx?.setVolume?.(fx.soundVolume);
+    setWeatherVolume(fx.soundVolume);
 }
 function save(keys = null) {
     for (const k of keys || Object.keys(fx)) stored[k] = fx[k];
@@ -90,6 +99,14 @@
     refreshPanel();
 }
 window.__fx = fx;
+/** Set several settings at once and save once (the OPTIONS screen: a Detail level is 36 values). */
+export function setFxMany(values) {
+    Object.assign(fx, values);
+    syncLegacyFlags();
+    save(Object.keys(values));
+    refreshPanel();
+}
+window.__setFxMany = setFxMany;
 window.__isWaterAt = (x, y) => isWaterAt(S.map ? S.map.id : "", x, y);
 window.__setFx = setFx;
 // URL flags from the older experiments still win for the session.
```

- [ ] **Step 7: `web/game.js`:**

```diff
--- a/web/game.js
+++ b/web/game.js
@@ -409,6 +409,8 @@
 window.__bgm = bgm;
 const sfx = createSfxPlayer(soundRegister);
 window.__sfx = sfx;
+bgm.setVolume(window.__fx?.musicVolume);       // OPTIONS volumes (web/volume-levels.js): 1 = the game's own gain
+sfx.setVolume(window.__fx?.soundVolume);
 // GLOSSARY and OPTIONS (web/book-host.js): one host runs whichever book the pause list opens.
 const books = createBookHost({
     sfx,
```

- [ ] **Step 8: Run, expect PASS** (`node --test tests/volumes.test.js` 7 tests), then the old audio and ambience readers: `node --test tests/battle-speed.test.js tests/battle-audio.test.js tests/audio-cue-lifetimes.test.js tests/audio-archive-oracle.test.js`.

- [ ] **Step 9: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty.

- [ ] **Step 10: Screenshot** `08-pause-list-unchanged` (t1 script). Sound itself cannot be judged by a picture; the volume numbers are covered by the test and shown on the SOUND page in Task 9.

- [ ] **Step 11: Do not commit.** Report changed files.

---

### Task 9: the OPTIONS screen and its registration; the four pages

**Files:**
- Create: `web/options-book.js`
- Modify: `web/game.js` (register `options` with the host)
- Test: `tests/options-book.test.js`, `tests/options-wiring.test.js`

**Interfaces:**
- Consumes: Task 6 `createOptionsModel`; Task 3 `drawHeader`, `drawListWindow`, `listRowY`, `drawHelpBox`, `LIST_WINDOW`, `LIST_VALUE_RIGHT`, `WORD`; Task 5 `fitByWidth`; Task 8 `window.__setFxMany`; `SPRITE_FILTERS` (`web/sprite-filters.js:8`) and `GPU_FILTER_NAMES` (`web/gpu-pixel-filter.js:26`) for the pixel filter row.
- Produces: `createOptionsBook({ sfx, fx, setFxMany })` as a book (windows `title`, `list`, `help`; no wall: the dimmed field shows behind, as the START list does); `pixelFilterChoices()`.
- Layout (the QUESTS page's): slanted header bar with "OPTIONS" on the left and the four page names as tabs (the active one in the white face, the others dim, clut row 7), `L1` and `R1` hints in the number face at the bar's right, list window at (168, 40) with rows at x 189, y 49 + 14 i, label left, value right-aligned at x 300 with `◀` / `▶` arrows when the value can move that way (numbers in the orange number face), the white animated cursor at x 176, the focused row's help line in the bottom box (wrapped by measured width, two lines at most). Q / E (`l1` / `r1`) switch page, up / down move, left / right change, Back leaves.
- Open question to check in the screenshots (not guessable from code): the 160-wide list window may be tight for "Random fights" plus its value. Labels are already shortened by measurement (`fitByWidth`); if a label still loses letters in a screenshot, widen the window to 5 columns by changing `drawPanel(..., 4, ...)` and `LIST_WINDOW.w` together and report it; do not change the QUESTS page.

- [ ] **Step 1: Write the failing tests.** `tests/options-book.test.js`:

```js
// The OPTIONS screen (web/options-book.js): keys reach the model, sounds play once per move, and drawing a whole page does not throw.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOptionsBook, pixelFilterChoices } from "../web/options-book.js";
import { LIST_WINDOW, listRowY } from "../web/ui-kit.js";
import { DETAIL_KEYS } from "../web/options-model.js";

function fakeCtx() {
    const log = [];
    return new Proxy({}, {
        get: (_t, n) => (n === "log" ? log : n === "measureText" ? () => ({ width: 10 }) : (...a) => { log.push([n, ...a]); }),
        set: () => true,
    });
}
function setup() {
    const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off", battleSpeed: 2, encounterDialMode: "normal", musicVolume: 1, soundVolume: 1 };
    for (const k of DETAIL_KEYS) fx[k] = true;     // the game starts with every effect on
    const sounds = [];
    const book = createOptionsBook({ sfx: { play: (n) => sounds.push(n) }, fx: () => fx, setFxMany: (o) => Object.assign(fx, o) });
    return { fx, sounds, book };
}
const keys = (...k) => new Set(k);

test("Back leaves; arrows, Q and E reach the model; a move that does nothing is silent", () => {
    const { fx, sounds, book } = setup();
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("up")), null);
    assert.deepEqual(sounds, [], "already on the first row: no sound");
    book.act(keys("down"));
    assert.equal(book.model.row(), 1);
    book.act(keys("l1"));
    assert.equal(book.model.page(), 0, "no page before the first");
    book.act(keys("r1"));
    assert.equal(book.model.page(), 1);
    book.act(keys("up"));                       // page SCREEN, first row: nothing above it
    assert.deepEqual(sounds, ["system02", "system02"], "down, then the page; the up did nothing");
    book.act(keys("left"));                     // Detail High -> the level below it
    assert.equal(sounds.length, 3);
    assert.notEqual(fx.quality, "high");
    book.act(keys("right"));
    assert.equal(fx.quality, "high");
});

test("one acting frame does one thing (Back wins over everything else)", () => {
    const { book } = setup();
    assert.equal(book.act(keys("cross", "down", "r1")), "back");
    assert.equal(book.model.row(), 0);
    assert.equal(book.model.page(), 0);
});

test("the pixel filter list is Off plus the GPU filters", () => {
    const ids = pixelFilterChoices().map((f) => f[0]);
    assert.equal(ids[0], "off");
    assert.ok(ids.includes("epx") && !ids.includes("nearest4"));
});

test("every page draws without throwing, with the windows folded in, half open and shut", () => {
    const { book } = setup();
    for (let page = 0; page < 4; page++) {
        for (const p of [0, 0.5, 1]) {
            const ctx = fakeCtx();
            assert.doesNotThrow(() => book.draw(ctx, { progress: () => p, ticks: 7 }), `page ${page} at ${p}`);
        }
        book.act(keys("r1"));
    }
});

test("the list uses the QUESTS page's places: rows at x 189, y 49 + 14 i, cursor at x 176", () => {
    assert.deepEqual([LIST_WINDOW.textX, LIST_WINDOW.textY, LIST_WINDOW.pitch, LIST_WINDOW.cursorX], [0xbd, 0x31, 0xe, 0xb0]);
    assert.deepEqual([0, 1, 8].map(listRowY), [49, 63, 161]);
    const quests = readFileSync(new URL("../engine/dw3/ui/native/pause-quests.ts", import.meta.url), "utf8");
    assert.match(quests, /createText\(layer, 1, 0xbd, 0x31 \+ i \* 0xe\)/);
    assert.match(quests, /drawSprite\(pack\(PACK_CMFONT\), 0x24, 0xa8, 0x28\)/);
    assert.deepEqual([LIST_WINDOW.x, LIST_WINDOW.y], [0xa8, 0x28]);
});
```

`tests/options-wiring.test.js`:

```js
// OPTIONS is registered with the book host in web/game.js (build step 2).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("game.js makes the options book from the host's arguments, next to the glossary book", () => {
    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /import \{ createOptionsBook \} from "\.\/options-book\.js";/);
    assert.match(game, /glossary: \(\) => createBlankBook\(\{ title: "GLOSSARY" \}\),[^\n]*\n\s*options: \(args\) => createOptionsBook\(args\),/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Create `web/options-book.js`:**

```js
// web/options-book.js -- the OPTIONS screen: four pages of player settings in the QUESTS page's layout (slanted header bar,
// navy list window on the right, help box at the bottom, the field dimmed behind). Rows and rules: web/options-model.js.
//
// Keys (web/ui-kit-input.js): up / down move the cursor, left / right change the value, Q / E (l1 / r1) switch the page, Back
// leaves. The settings are written through window.__setFxMany, the same store as F2 (web/ambience.js).
import { SPRITE_FILTERS } from "./sprite-filters.js";
import { GPU_FILTER_NAMES } from "./gpu-pixel-filter.js";
import { createOptionsModel } from "./options-model.js";
import { WORD } from "./ui-kit-input.js";
import { LIST_VALUE_RIGHT, LIST_WINDOW, drawHeader, drawHelpBox, drawListWindow, listRowY } from "./ui-kit.js";
import { drawCursor, drawText, textWidth } from "./uifont.js";
import { fitByWidth } from "./text-fit.js";

/** The filters the GPU path can run, as [id, label] (the same list F2 offers). */
export const pixelFilterChoices = () => Object.entries(SPRITE_FILTERS).filter(([k]) => k === "off" || GPU_FILTER_NAMES.includes(k));

export function createOptionsBook({ sfx = null, fx, setFxMany }) {
    const store = { get: (k) => fx()?.[k], setMany: (o) => setFxMany(o) };
    const model = createOptionsModel(store, pixelFilterChoices());
    const cue = (result) => { if (result) sfx?.play?.("system02"); };
    return {
        windows: ["title", "list", "help"],
        wall: false,
        model,
        act(buttons) {
            if (buttons.has(WORD.back)) return "back";
            if (buttons.has(WORD.prev)) cue(model.switchPage(-1));
            else if (buttons.has(WORD.next)) cue(model.switchPage(1));
            else if (buttons.has("up")) cue(model.moveRow(-1));
            else if (buttons.has("down")) cue(model.moveRow(1));
            else if (buttons.has("left")) cue(model.change(-1));
            else if (buttons.has("right")) cue(model.change(1));
            return null;
        },
        draw(ctx, view) {
            drawHeader(ctx, view.progress("title"), "OPTIONS", model.pageLabels(), model.page());
            if (view.progress("title") >= 1) {
                drawText(ctx, "L1", 262, 31, { kind: 3, clut: 2 });
                drawText(ctx, "R1", 300, 31, { kind: 3, clut: 2 });
            }
            const rows = model.view();
            drawListWindow(ctx, view.progress("list"), Math.max(rows.length, 1));
            if (view.progress("list") >= 1) {
                rows.forEach((r, i) => {
                    const y = listRowY(i);
                    const numeric = r.numeric;
                    const valueW = textWidth(r.value, numeric ? 3 : 1);
                    const label = fitByWidth(r.label, (s) => textWidth(s), LIST_VALUE_RIGHT - 18 - valueW - LIST_WINDOW.textX - 6);
                    drawText(ctx, label, LIST_WINDOW.textX, y);
                    if (r.canLeft) drawText(ctx, "◀", LIST_VALUE_RIGHT - valueW - 14, y);
                    drawText(ctx, r.value, LIST_VALUE_RIGHT - 6, y, { alignRight: true, kind: numeric ? 3 : 1 });
                    if (r.canRight) drawText(ctx, "▶", LIST_VALUE_RIGHT - 4, y);
                });
                drawCursor(ctx, view.ticks, LIST_WINDOW.cursorX, listRowY(model.row()));
            }
            drawHelpBox(ctx, view.progress("help"), view.progress("help") >= 1 ? model.help() : "");
        },
    };
}
```

- [ ] **Step 4: Register it** (`web/game.js`):

```diff
--- a/web/game.js
+++ b/web/game.js
@@ -392,6 +392,7 @@
 import { pauseExtraRows } from "./pause-extra-rows.js";   // GLOSSARY / OPTIONS rows on the pause list (dev switches `glossary`, `options`)
 import { createBookHost } from "./book-host.js";
 import { createBlankBook } from "./book-blank.js";
+import { createOptionsBook } from "./options-book.js";
 import {
     FIELD_LOCATION_KEY,
     decodeFieldLocation,
@@ -416,6 +417,7 @@
     sfx,
     factories: {
         glossary: () => createBlankBook({ title: "GLOSSARY" }),   // build step 1: the window kit with nothing on it
+        options: (args) => createOptionsBook(args),
     },
 });
 window.__books = books;
```

- [ ] **Step 5: Run, expect PASS** (`node --test tests/options-book.test.js tests/options-wiring.test.js`, 5 + 1 tests), then `node --check web/game.js`.

- [ ] **Step 6: New-failures check** `/home/dorij/ui-review/new-failures.sh` Expected: empty. `npm run typecheck` clean.

- [ ] **Step 7: Screenshots, each of the 4 pages, keyboard and pad.** `/home/dorij/ui-review/build/shots/t9.mjs`:

```js
import { openGame, press, padHold, shot } from "/home/dorij/dw2003-play-integration/tools/ui_shot.mjs";
const { browser, page } = await openGame({ fx: { options: true } });
await press(page, "i", 120, 2500);
for (let i = 0; i < 6; i++) await press(page, "ArrowDown", 100, 250);   // ITEMS SORT MAP TECHNIQUES STATUS QUESTS -> OPTIONS (row 6)
await press(page, "Enter", 120, 3500);
await shot(page, "09-options-1-game");
await press(page, "ArrowRight", 100, 400);                  // Battle speed: x1 -> x1.5
await shot(page, "09-options-1-game-speed-changed");
await press(page, "e", 100, 900);                           // page 2 (keyboard)
await shot(page, "09-options-2-screen");
await padHold(page, 5, 120, 900);                           // R1 on the pad: page 3
await shot(page, "09-options-3-sound");
await padHold(page, 5, 120, 900);                           // page 4
await shot(page, "09-options-4-extras");
for (let i = 0; i < 8; i++) await press(page, "ArrowDown", 100, 200);   // the last EXTRAS row (9 rows in the list window)
await shot(page, "09-options-4-extras-last-row");
await padHold(page, 3, 150, 3500);                          // Back on the pad (top button): the pause list returns on OPTIONS
await shot(page, "09-back-on-pause-list");
console.log(JSON.stringify(await page.evaluate(() => ({ battlespeed: window.__fx.battlespeed, battleSpeed: window.__fx.battleSpeed, saved: JSON.parse(localStorage.getItem("dw.fx.v1")).battleSpeed }))));
await browser.close();
```

Run as in Task 1 Step 6. Expected console line: `{"battlespeed":true,"battleSpeed":1.5,"saved":1.5}`.

- [ ] **Step 8: Do not commit.** Report changed files (`git status --short`).

---

## Steps 3 to 6 (outline only; each gets its own detailed plan after the user has seen the previous step)

- **Step 3: GLOSSARY > DIGIMON.** New `web/glossary-book.js` (a book for `createBookHost`, windows `title`, `model`, `card`, `footer`, wall on) and `web/glossary-digimon.js` (pure rows from `partnerRows` `web/codex.js:112`, `wildRows` `:238`, `lineTargets` `:150`, `blastCards` `web/blast-ladder.js:68`, `plannerRows` `web/evolution-planner.js:182`; paging 1/190, page 2 = resists, techniques, grows-into; unmet wild species = "???" shadows). Showcase camera flag in `web/battle3d.js` (one renderer for the whole book, `createBattle3D(canvas, sfx, {alpha:true})` at `:1963`, `setPlayerDigimon` `:3571`, model turns once per 12 s with its idle) with `theatrePlan()` (`web/theatre-plan.js`) for species-to-model and a no-model fallback to `web/partner-pictures.js`. Section switch Q / E with the album's cell-by-cell reveal. Replace the `glossary` blank book registration in `web/game.js`. Tests: row data equals codex rows, paging, no-model fallback. Fixes the Clips-tab box glyphs (spec 9.1) after measuring with `measureText` in the GPU Chromium. Open question to settle first: book name (GLOSSARY, DIGIDEX or BOOK) is one constant, `BOOK_LABELS` in `web/pause-extra-rows.js`.
- **Step 4: GLOSSARY > ITEMS.** Move the word-making of `web/item-source-page.js` and `web/item-rulebook-page.js` into the pure modules (`web/item-source.js:76,183`, `web/item-rulebook.js:58`) or a new `web/glossary-text.js`; one item per screen with `drawItemIcon` (`web/itemicons.js:43`); each item has "where" and "does" lines or `nothingLine`. Test: all 402 ids give text. 
- **Step 5: GLOSSARY > PLACES.** Gyms (`web/gym-map.js:73` `gymRows`, `rankLadder` `:61`), arenas (`setBattlefieldsData` `web/codex.js:719`; replaces the Battlefields tab whose text overlaps, fix by `measureText`), fishing (`web/fishing-almanac.js:79`). Damage Lab footer fix (`web/damage-lab.js:712`) measured and split in two lines.
- **Step 6: trim F2** after the user accepts OPTIONS: F2 keeps dev pages and labs only (the 25 `F2_ONLY_KEYS` of `web/options-model.js`); hide the 7 feeder switches after GLOSSARY is accepted; `glossary` and `options` leave EXPERIMENTAL (default on). Tests: F2 lists no player setting; every moved key still saved and loaded under `dw.fx.v1`.

## Self-review

- **Spec coverage:** 2.1 pause list rows (Tasks 2, 4); 2.6 OPTIONS pages and defaults (6, 9); 3 controls (3, 4); 4.1 folds (3), 4.2 order (3, 9), 4.3 cursor (9), 4.7 wall (3, blank book); 5.1 hand-off route (2, 4); 5.2 kit (3); 5.4 switches (4); 6 key table (6: `OPTIONS_HOME` test over all 99); 10 steps 1 and 2 (all tasks); 4.4 blinking arrows, 4.5 page flip, 4.6 panel slide, 4.8 model, 4.9 reverse close: 4.9 is the host's close (3), 4.4 to 4.6 and 4.8 belong to GLOSSARY (step 3) and are not in OPTIONS. Spec 5.3 and 7 to 9 are steps 3 to 6.
- **Placeholders:** none; every code step carries the file or the diff. The Low and Medium lists are produced by Task 7 from a stated rule.
- **Type consistency:** book interface and host signature are defined once (Task 3) and used by Tasks 4 and 9; `store = { get, setMany }` is defined in Task 6 and satisfied in Task 9 by `{ get: (k) => fx()?.[k], setMany }`; `extraRows` seed shape `{ label, opens }` is the same in Tasks 2 and 4.
- **Not verified here:** no screenshot was looked at (the rules forbid it for this agent); drawing code is tested for not throwing, the row and tile geometry against the sheet, and positions against `pause-quests.ts`. Pixel appearance is for the main session to judge from the saved files.
