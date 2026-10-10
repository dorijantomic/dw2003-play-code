// Headless check for s810's op-13 launch pads — the pads the Spy Satellite floor
// has always had on the disc and the walker never shipped a row for. Driven
// through the REAL web/game.js in the web/ui-lab.html harness (no mock renderer,
// no walking bot).
//
// Decode (all from pro/fieldstg.s / the stage's own overlay, nothing hand-typed):
//   :5bd8-:5d98   the resident driver 0x80088888. Its ONLY pad read is `andi
//                $v0,0x2000` at :5d04, inside the PLAYBACK arm (:5cbc-:5d50)
//                behind `beq $v1,$a0 -> :5cbc` at :5c7c. The SETUP arm
//                (:5c94-:5cb8) reads no button at all.
//   :5648-:56a4   step-load 0x80088288: op 8-14 skip the 0x80097624 facing cone
//                (:567c `j 0x80088358`, :5680 `li $v0,0x1`), so op 13 is live in
//                every facing. Only the record's own two conditions gate it
//                (:56dc/:5700, :5710/:5734).
//   :5820         setup op 13 = actor->vt[0x158](actor, &record[0xa]); the body at
//                :0xc79c stores that pointer in the pad controller (:0xc7e4), so
//                the destination is the record's own params[1..3].
//   :8a24-:8aa4   0x8008B6D4 writes the record's screen/x/y/facing into the spawn
//                globals; :0xe744-:0xe774 the arriving actor's spawn reads them
//                back with `sra 8` and copies the facing word straight into
//                char+0x60 -- the disc's 0-7 facing index, unmapped.
//   engine/systems/launch-pad.ts  the controller: approach, pad charge, flight,
//                                  and the record's facing word at the snap.
//
// What it asserts, by playing the game:
//
//   1. THE CELL. The pad is chosen the way the disc chooses it — the type-7
//      trigger byte under the player's own feet (fieldstg.s:55f8), whose low
//      five bits name an op-13 record. The shipped exit row for the same
//      destination is checked against that record, so the two cannot drift.
//   2. THE CONTACT. Walking onto the cell is enough. The disc's driver runs its
//      SETUP arm every frame with no button read in it (fieldstg.s:5c94-:5cb8;
//      the only pad read, `andi $v0,0x2000`, is at :5d04, inside the PLAYBACK
//      arm behind `beq $v1,$a0 -> :5cbc` at :5c7c), and setup op 13 is the pad
//      walk — actor->vt[0x158] at fieldstg.s:5820. So the leader starts walking
//      to the pad with no button pressed, and no "?" prompt appears, because op
//      13 draws no bubble and its playback entry is the executor's own epilogue.
//   3. THE LANDING. The player ends on the map, on the record's own cell, facing
//      fieldDirectionFromIndex(params[3]) — read out of the stage's own op-13
//      record, not out of the shipped row.
//
// Server: python3 -m http.server 8837 --directory web
// Run:    VERIFY_PORT=8837 tools/run-playwright.sh tools/verify_s810_launch_pads.mjs
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const scene = JSON.parse(
    await readFile(new URL("../web/assets/scenes/s810.json", import.meta.url)));
const STEPS = (await load("story_steps.json")).stages;
const GRIDS = (await load("story_trigger_grids.json")).stages;
const PADS = await load("launch_pads.json");

const FACINGS = ["down", "down-left", "left", "up-left",
    "up", "up-right", "right", "down-right"];

// The disc's 0-7 facing word, read straight out of char+0x60's order.
const fieldDirectionFromIndex = (i) => FACINGS[((i % 8) + 8) % 8];

assert.ok(scene.exits.some((e) => e.launchPad), "s810 ships launch-pad exit rows");
assert.ok(PADS["810"]?.pads?.some((p) => p.enabled),
    "s810 registers its own type-0x17 pad objects");

// The pad cell, chosen the way the disc chooses it: the type-7 trigger byte
// under the player's own feet, low five bits = step index (fieldstg.s:5614/:5624).
const grid = GRIDS["810"];
const prog = STEPS["810"].steps;
let chosen = null;
for (let i = 0; i < grid.grid.length && !chosen; i++) {
    const byte = grid.grid[i] & 0xff;
    if (!byte) continue;
    const idx = byte & 0x1f;
    if (idx >= prog.length || prog[idx].op !== 13) continue;
    chosen = {
        cell: grid.cell, group: (byte >> 5) & 7, idx,
        x: (i % grid.w) * grid.cell + grid.cell / 2,
        y: Math.floor(i / grid.w) * grid.cell + grid.cell / 2,
        rec: prog[idx],
    };
}
assert.ok(chosen, "s810 has a trigger cell naming an op-13 record");
const { rec } = chosen;
const [, spawnX, spawnY, facingIndex] = rec.params;
// The shipped row for the same destination must agree with the record.
const exit = scene.exits.find((e) => e.launchPad
    && e.spawnX === spawnX && e.spawnY === spawnY);
assert.ok(exit, `a shipped launch row names the record's own cell ${spawnX},${spawnY}`);
assert.equal(exit.dir, fieldDirectionFromIndex(facingIndex & 7),
    "and its facing is the record's own 0-7 word");

const PORT = Number(process.env.VERIFY_PORT || 8837);
await mkdir(".bunny-scratch", { recursive: true });
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.goto(`http://localhost:${PORT}/ui-lab.html?skipTitle=1&map=s810&noEncounters=1`,
    { waitUntil: "load" });
await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes("index.html"));

const shot = (name) => page.screenshot({
    path: `.bunny-scratch/${name}.png`,
    clip: { x: 335, y: 185, width: 668, height: 480 },
});

const read = () => frame.evaluate(() => {
    const st = window.__state;
    return {
        map: st.manifest.maps[st.mapIdx].id,
        x: Math.round(st.x), y: Math.round(st.y), dir: st.dir,
        phase: st.launch?.phase ?? null,
        onExit: st.onExit,
        icon: st._indicatorKey ?? null,
    };
});

const results = { pad: { cell: chosen.x, cellY: chosen.y, group: chosen.group,
    to: `${spawnX},${spawnY}`, facingIndex, recordDir: fieldDirectionFromIndex(facingIndex & 7),
    shippedDir: exit.dir }, rows: scene.exits.filter((e) => e.launchPad).length };
try {
    // ── 1 & 2. the CONTACT. No button, no prompt. ─────────────────────────
    // The disc's driver runs its SETUP arm (fieldstg.s:5c94-:5cb8) on every frame
    // the player stands on a live step tile, and reads no button there — the only
    // pad read in the whole driver is `andi $v0,0x2000` at :5d04, inside the
    // PLAYBACK arm. Setup op 13 is the pad walk (actor->vt[0x158], :5820), so
    // simply being on the cell starts it. Nothing is pressed below.
    await frame.evaluate(async (q) => {
        const st = window.__state;
        st.x = q.x;
        st.y = q.y;
        st.dir = "down";
        st.moving = false;
        st.launch = null;
        st.handoffHold = null;
        for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r));
    }, chosen);
    await frame.waitForTimeout(200);
    const walking = await read();
    results.walking = walking;
    assert.ok(walking.phase,
        `standing on the pad cell must start the pad walk, no button (${JSON.stringify(walking)})`);
    assert.equal(walking.onExit, false,
        "and no '?' prompt: setup op 13 draws no bubble and its playback entry is " +
        "the executor's own epilogue (fieldstg.s:0x5bc8)");
    assert.equal(walking.icon, null, "a setup op asks for no arrow — the cell is the trigger");
    await shot("s810-pad-walk");

    // ── 3. the landing ────────────────────────────────────────────────────
    await frame.waitForFunction(() => !window.__state.launch, null, { timeout: 30000 });
    await frame.waitForTimeout(300);
    const landed = await read();
    results.landed = landed;
    await shot("s810-pad-landed");
    assert.equal(landed.map, "s810");
    assert.equal(landed.x, spawnX, `record cell x: landed ${landed.x}`);
    assert.equal(landed.y, spawnY, `record cell y: landed ${landed.y}`);
    // The landing facing is the record's own 0-7 word named through char+0x60's
    // order (engine/systems/field-movement.ts) and handed to the pad controller
    // by engine/systems/scene-step-ops.ts op 13, out of the record itself.
    const wantDir = fieldDirectionFromIndex(facingIndex & 7);
    assert.equal(landed.dir, wantDir, `landed facing ${landed.dir}, record says ${wantDir}`);
    assert.equal(errors.length, 0, `${errors.length} page error(s)`);
    console.log("RESULT", JSON.stringify({ ok: true, results }));
} catch (e) {
    console.log("RESULT", JSON.stringify({ ok: false, error: e.message, results }));
    process.exitCode = 1;
} finally {
    await browser.close();
}
