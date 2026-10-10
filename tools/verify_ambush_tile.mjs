// Headless check for the ambush tiles, driven through the REAL web/game.js in
// the web/ui-lab.html harness (no mock renderer).
//
// Decode: engine/systems/ambush-tile.ts, tools/extract_forced_encounters.py,
// docs/research/field/ambush-tile-forced-encounter-2026-07-28.md.
//
// What it asserts, by playing the game rather than calling the launcher:
//
//   1. Walking onto the Fire Dungeon's ambush patch with the shared latch clear
//      starts a battle.
//   2. The battle is the one the stage's own scripted encounter block names —
//      the red Numemon — not the floor's boss and not a random roll.
//   3. Firing sets the shared latch, and while you stay on the patch it does
//      NOT fire again — that is the latch's whole mechanical job.
//   4. The latch is per VISIT: come back to the area and the ambush is armed
//      again. Minotarumon meets you every time you drop into Protocol Ruins.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_ambush_tile.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const TILES = await load("forced_encounters.json");
const SCREENS = (await load("field_encounters.json")).screens;
const GRIDS = (await load("story_trigger_grids.json")).stages;

const STAGE = "s740";
const tile = TILES[STAGE];
assert.ok(tile, "forced_encounters.json must carry the Fire Dungeon tile");
const expected = SCREENS[String(tile.screenId)][0].name;

// The patch cells of a stage's ambush tile, in trigger-grid coordinates.
function patchCells(stageId, t) {
    const g = GRIDS[stageId.slice(1)];
    const cells = [];
    for (let i = 0; i < g.grid.length; i++) {
        const v = g.grid[i];
        if (v && t.stepIndexes.includes(v & 0x1f)) cells.push([i % g.w, Math.floor(i / g.w)]);
    }
    return { cells, cell: g.cell };
}

// Seed a REAL party through localStorage the way verify_encounter_rate does.
// The battle module builds its fighter from the saved character and declines a
// hand-stubbed partnerStats: with a synthetic party the trigger fires, the latch
// sets, and no battle appears — which looks exactly like broken wiring.
// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const errors = [];

// Open a fresh session. `flags` is a saved engineFlags blob to start from, which
// is how the second session inherits the latch the first one set — the spent-tile
// case cannot be tested inside one session, because the battle the first walk
// starts is still on screen and there is no public way to end it.
//
// The lab, NOT index.html: index boots to the title, and pressing through it
// starts a New Game, which wipes the party seeded here.
async function session(flags = null) {
    const localStorage = [
        { name: "engineSchema", value: "2" },
        { name: "party", value: JSON.stringify(PARTY) },
        { name: "charId", value: PARTY[0] },
    ];
    if (flags) localStorage.push({ name: "engineFlags", value: flags });
    const context = await browser.newContext({
        viewport: { width: 1100, height: 900 },
        storageState: { cookies: [], origins: [{ origin: ROOT, localStorage }] },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${ROOT}/ui-lab.html`, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const frame = page.frames().find((f) => f.url().includes("index.html"));
    // Count every battle the game tries to start, so "the tile did not fire" is
    // an observation about the TRIGGER and not about whatever is on screen.
    await frame.evaluate(() => {
        window.__battlesStarted = [];
        const orig = window.__battle.startScreen.bind(window.__battle);
        window.__battle.startScreen = (screenId, ...rest) => {
            window.__battlesStarted.push(screenId);
            return orig(screenId, ...rest);
        };
        if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
    });
    await frame.evaluate(async () => {
        for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    });
    return { context, page, frame };
}

let { context, page, frame } = await session();

const raf = (n) => frame.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

const goto = async (stageId, at) => frame.evaluate(async ([s, p]) => {
    const st = window.__state;
    const idx = st.manifest.maps.findIndex((m) => m.id === s);
    window.__setMap(idx, p);
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, [stageId, at]);

const latch = () => frame.evaluate((f) => window.__storyFlags.get(f), tile.gateFlag);
const inBattle = () => frame.evaluate(() => window.__battle.isActive());
const started = () => frame.evaluate(() => window.__battlesStarted.slice());

// Walk ONTO the patch and report whether a battle started.
//
// These patches sit in diagonal isometric corridors, and the field does not
// move on screen-cardinal axes: `fieldDirectionDelta` reads the native
// isometric terrain×direction table, so the button that reaches a given
// neighbour depends on the local terrain class. So do NOT pair a direction
// name to a grid offset. Place the player on each neighbouring cell, try ALL
// FOUR buttons from there, and keep the first attempt that ends on a patch
// cell. That keeps the test honest — the tile is always entered from outside,
// never spawned on top of.
const BUTTONS = ["up", "down", "left", "right"];
const RING = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

async function walkOntoPatch(stageId, t, { expectFire = true } = {}) {
    const { cells, cell } = patchCells(stageId, t);
    const patch = new Set(cells.map((c) => c.join(",")));
    // Every distinct cell that shares an edge or corner with the patch.
    const approach = new Map();
    for (const [gx, gy] of cells) {
        for (const [dx, dy] of RING) {
            const from = [gx + dx, gy + dy];
            if (patch.has(from.join(","))) continue;
            approach.set(from.join(","), from);
        }
    }
    for (const from of approach.values()) {
        const at = { x: from[0] * cell + cell / 2, y: from[1] * cell + cell / 2 };
        if (await goto(stageId, at) !== stageId) continue;
        for (const button of BUTTONS) {
            await goto(stageId, at);   // reset for each button
            const moved = await frame.evaluate(async ([key, cells32, c, frames]) => {
                const st = window.__state;
                const on = new Set(cells32.map((x) => x.join(",")));
                const here = () => [Math.floor(st.x / c), Math.floor(st.y / c)].join(",");
                const startPos = [st.x, st.y];
                const n0 = window.__battlesStarted.length;
                st.keys.add(key);
                let arrived = -1, fired = -1, faceAtEntry = null;
                // The ONE shared field→battle handoff arms the A28 checkerboard
                // (web/game.js startFieldBattle) before it launches the battle, so a
                // firing ambush must show the wipe mid-run. Sample it each frame.
                let wipeMax = 0, wipeSeen = false;
                for (let i = 0; i < frames; i++) {
                    await new Promise((r) => requestAnimationFrame(r));
                    const w = window.__wipe28?.();
                    if (w) { wipeSeen = true; wipeMax = Math.max(wipeMax, w.quads); }
                    if (arrived < 0 && on.has(here())) { arrived = i; faceAtEntry = st.dir; }
                    if (fired < 0 && window.__battlesStarted.length > n0) { fired = i; break; }
                }
                st.keys.delete(key);
                return { arrived, fired, moved: st.x !== startPos[0] || st.y !== startPos[1], faceAtEntry, wipeSeen, wipeMax };
            }, [button, cells, cell, 140]);
            if (moved.fired >= 0) return { fired: true, from, dir: button, frames: moved.fired, faceAtEntry: moved.faceAtEntry, wipeSeen: moved.wipeSeen, wipeMax: moved.wipeMax };
            if (moved.arrived >= 0)
                return { fired: false, from, dir: button, frames: -1, reached: true };
        }
    }
    return { fired: false, reached: false };
}

assert.equal(await latch(), 0, "the shared latch starts clear");

// ── 1/2. The tile starts ITS fight. ────────────────────────────────────────
const run = await walkOntoPatch(STAGE, tile);
assert.ok(run.fired,
    `walking onto the patch must start a battle (reached it: ${run.reached === true})`);
// The ONE shared field→battle handoff: the ambush arms the A28 checkerboard
// before the battle starts (web/game.js startFieldBattle), exactly as the
// original's battle host selects it via scene+0x5C.
assert.ok(run.wipeSeen && run.wipeMax >= 28,
    `the ambush must enter through the shared A28 checkerboard (seen: ${run.wipeSeen}, max quads: ${run.wipeMax})`);
const firedAt = run.frames;

// ── C10: op 8 NEVER READS THE CONE — firing from outside it is the DISC's rule ──
// The field-gap row said an ambush tile requires the approach facing and the
// walker's any-facing fire DIVERGES. The decode says the opposite: every one of
// the 14 patches is an op-8 step, and step-load reads the cone for ops 0-4, 7
// and 15+ only — op 8 jumps straight to live (fieldstg.s :567c; the port's own
// oracle asserts _stepLive(8, g, f) === true for every group and facing,
// tests/lane-b/scene-step.test.js:355). So masking the group off is correct,
// and this walk is the end-to-end proof: the Fire Dungeon patch's six cells are
// all group 3 (cone: left / up-left / up) and the run above entered facing the
// value asserted below — a facing that cone refuses, and the fight still began.
{
    const g = GRIDS[STAGE.slice(1)];
    const { cells } = patchCells(STAGE, tile);
    const groups = new Set(cells.map(([cx, cy]) => (g.grid[cy * g.w + cx] >> 5) & 7));
    assert.deepEqual([...groups], [3], "premise: the Fire Dungeon patch cells are group 3");
    const CONE = JSON.parse(
        await readFile(new URL("../web/assets/data/scene/step_enable_table.json", import.meta.url)),
    ).rows;
    const FACING_NAMES = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
    const faceIdx = FACING_NAMES.indexOf(run.faceAtEntry);
    assert.ok(faceIdx >= 0, `entry facing "${run.faceAtEntry}" is one of the eight`);
    assert.equal(CONE[3][faceIdx], 0,
        `the ambush fired while facing ${run.faceAtEntry} — a facing group 3's cone refuses (op 8 must fire anyway)`);
}

assert.deepEqual(await started(), [tile.screenId],
    `exactly one battle, on the stage's own scripted slot (${expected})`);
assert.equal(await inBattle(), true, "and it is actually on screen");
assert.equal(await latch(), 1, "firing sets the shared latch");
// Sit on the patch a while: the latch must keep it from launching again.
await raf(60);
assert.deepEqual(await started(), [tile.screenId],
    "standing on the patch must not launch a second fight");

// ── 3. Firing set the shared latch. ────────────────────────────────────────
assert.equal(await latch(), 1, "firing must set the shared latch");

// ── 4. Per-visit, not once-ever. A second session re-enters the area with the
// first session's saved flags; entering clears the latch, so the ambush is armed
// again and fires again. This is the property that distinguishes "the patch is
// spent forever" from "Minotarumon is waiting every time you drop down".
const savedFlags = await frame.evaluate(() => localStorage.getItem("engineFlags"));
assert.ok(savedFlags, "flags are persisted to the save");
await context.close();

({ context, page, frame } = await session(savedFlags));
assert.equal(await latch(), 0, "entering the area re-arms the ambush");

const revisit = await walkOntoPatch(STAGE, tile);
assert.ok(revisit.fired, "the ambush fires again on a later visit");
assert.deepEqual(await started(), [tile.screenId],
    "and it is the same fight, started exactly once on this visit too");

assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log(`ambush tile OK — Fire Dungeon patch entered from the ${run.dir} at grid ` +
    `${run.from} facing ${run.faceAtEntry} (outside the patch's group-3 cone: op 8 never ` +
    `reads it), fired at frame ${firedAt} (${expected}, screen ${tile.screenId}); ` +
    `latch 0x${tile.gateFlag.toString(16)} held it to ONE fight while stood on, ` +
    `and it fired again on a fresh visit`);
