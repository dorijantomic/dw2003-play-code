// Headless check for the position step's facing-cone enable gate, driven through the
// REAL web/game.js in the web/ui-lab.html harness (no mock renderer).
//
// Decode: pro/fieldstg.s step-load 0x80088288 (file 0x55d8) reading the 8x8 cone at
// RAM 0x80097624 = FIELDSTG.PRO +0x14974; engine/systems/trigger-system.ts _stepLive;
// tools/extract_step_enable_table.py.
//
// What it asserts, by playing the game rather than calling the gate:
//
//   1. Standing on a tile whose grid byte names an INDICATOR opcode (op 1-4/7 — the
//      opcodes the disc actually puts through the cone) shows the icon over the
//      player's head when the facing is inside the cone, and HIDES it when the
//      facing is outside. So the "!" / arrow / ladder glyph now only appears when
//      you are looking at the thing it marks, as on the disc.
//   2. Facing all eight ways around the tile, the set of facings that show the icon
//      is exactly {g-1, g, g+1} for the tile's hi-3-bit group g.
//
// Run with a web server on this worktree's port:
//   python3 -m http.server 8819 --directory web
//   VERIFY_PORT=8819 tools/run-playwright.sh tools/verify_step_facing_cone.mjs
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const GRIDS = (await load("story_trigger_grids.json")).stages;
const STEPS = (await load("story_steps.json")).stages;
const CONE = (await load("scene/step_enable_table.json")).rows;

// The Master Room has both kinds of tile on one grid: byte 161 selects step 1
// (op 8, the cutscene — which the disc never puts through the cone) and byte 32
// selects step 0 (op 1, the door arrow — which it does).
const STAGE = "s305";
const grid = GRIDS[STAGE.slice(1)];
const cellOf = (wantByte) => {
    for (let i = 0; i < grid.grid.length; i++) {
        if ((grid.grid[i] & 0xff) === wantByte) return [i % grid.w, Math.floor(i / grid.w)];
    }
    return null;
};
const indicatorCell = cellOf(32);
assert.ok(indicatorCell, "s305 must have a byte-32 (indicator) tile");
const stepIdx = 32 & 0x1f;
const group = (32 >> 5) & 7;
assert.ok(STEPS[STAGE.slice(1)].steps[stepIdx].op >= 1 && STEPS[STAGE.slice(1)].steps[stepIdx].op <= 4,
    "that step is an indicator opcode, which the disc gates on facing");

const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const allowed = [0, 1, 2, 3, 4, 5, 6, 7].filter((f) => CONE[group][f]);
const cone = [(group + 7) % 8, group, (group + 1) % 8].sort((a, b) => a - b);
assert.deepEqual([...allowed].sort((a, b) => a - b), cone,
    "the shipped table's row is the ±1 cone around the tile's group");

const PORT = Number(process.env.VERIFY_PORT || 8819);
const browser = await chromium.launch();
const errors = [];
const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    storageState: {
        cookies: [],
        origins: [{
            origin: `http://localhost:${PORT}`,
            localStorage: [
                { name: "engineSchema", value: "2" },
                { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
                { name: "charId", value: "p003pken" },
            ],
        }],
    },
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes("index.html"));

const at = { x: indicatorCell[0] * grid.cell + grid.cell / 2, y: indicatorCell[1] * grid.cell + grid.cell / 2 };
const idx = await frame.evaluate(async ([s, p]) => {
    const st = window.__state;
    const i = st.manifest.maps.findIndex((m) => m.id === s);
    window.__setMap(i);
    for (let k = 0; k < 40; k++) await new Promise((r) => requestAnimationFrame(r));
    // Stand on the tile directly: the spawn argument of __setMap is a scene spawn point,
    // not an arbitrary pixel, and this check is about which grid cell is underfoot.
    st.x = p.x;
    st.y = p.y;
    // Let the map wipe and the location title finish, so the capture is the steady state.
    for (let k = 0; k < 150; k++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, [STAGE, at]);
assert.equal(idx, STAGE, "the Master Room loaded");

// Stand still on the tile and face each of the eight directions; report whether the
// indicator icon is armed. `state._indicatorKey` is what the renderer keys the icon
// and its cue sound on, so a non-null value IS the icon being shown.
const seen = [];
for (const dir of FACINGS) {
    const on = await frame.evaluate(async (d) => {
        const st = window.__state;
        st.dir = d;
        st._indicatorKey = null;
        for (let k = 0; k < 24; k++) await new Promise((r) => requestAnimationFrame(r));
        return st._indicatorKey;
    }, dir);
    seen.push({ dir, on: on != null });
    // Clip to the game canvas: the icon floats just above the player's head, and the
    // surrounding UI chrome does not change with the facing.
    const clip = { x: 335, y: 185, width: 668, height: 480 };
    if (dir === FACINGS[allowed[0]]) await page.screenshot({ path: ".bunny-scratch/cone-inside.png", clip });
    if (dir === FACINGS[(allowed[0] + 4) % 8]) await page.screenshot({ path: ".bunny-scratch/cone-outside.png", clip });
}

const lit = seen.filter((s) => s.on).map((s) => FACINGS.indexOf(s.dir)).sort((a, b) => a - b);
assert.deepEqual(lit, allowed,
    `the icon shows for exactly the cone {${allowed.join(",")}}, got {${lit.join(",")}}`);

await mkdir(".bunny-scratch", { recursive: true });
console.log(`s${STAGE.slice(1)} tile (${indicatorCell.join(",")}) byte 32 -> step ${stepIdx} ` +
    `op ${STEPS[STAGE.slice(1)].steps[stepIdx].op}, facing group ${group}`);
for (const s of seen) console.log(`  facing ${s.dir.padEnd(9)} icon ${s.on ? "SHOWN" : "hidden"}`);
console.log(`indicator shown for facings {${allowed.join(",")}} = {${allowed.map((f) => FACINGS[f]).join(", ")}}`);
console.log("captures: .bunny-scratch/cone-inside.png / cone-outside.png");
assert.deepEqual(errors, [], "no page errors");

await browser.close();
console.log("OK");
