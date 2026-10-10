// Headless check for step op 14 — the launch-pad handoff tile — driven through the
// REAL web/game.js in the web/ui-lab.html harness (no mock renderer, no walking bot).
//
// Decode: pro/fieldstg.s
//   :5a30-:5a7c   the op-14 handler — actor->vt[0x158](actor, &record[0xa]) and THEN,
//                in the same frame, 0x8008B6d4(p@0xa, -1, p@0xc<<8, p@0xe<<8, p@0x10, 0x3c)
//   :8a24-:8aa4   0x8008B6d4 — get the type-7 scene object, +0x5c = screen id, +0x60 = -1,
//                +0x68 = the sixth word, setPhase(2); globals 0x80099DE4/E8/EC = spawn x/y/facing
//   :8ac0-:8ad4   0x8008b770 — op 1's wrapper: the SAME body with `sw $zr,0x14($sp)`, i.e. no wait
//   :8984-:89c8   the phase-2 handler spends +0x68 one tick at a time and loads at 0
//   :0xe744-:0xe774 the arriving actor's spawn reads those three globals, `sra 8` for the cells
// engine/systems/scene-step-ops.ts execPlaybackOp (op 14 + `holdTicks`),
// engine/systems/trigger-system.ts playback (the driver's gates),
// engine/systems/launch-pad.ts (the pad walk — the same controller op 13 gets).
//
// What it asserts, by playing the game:
//
//   1. THE TILE. Stand on the s311 tile whose grid byte names its op-14 record and ask
//      the port: op 14, the pad-walk slot 0x158, the handoff entry point 0x8008B6D4
//      (not op 1's 0x8008B770 wrapper), and the sixth word 0x3c.
//   2. THE GATE. s311's record is the only gated one of the eleven (cond_a 0x6028 = 1);
//      with that flag unset the tile is dark and the press does nothing at all.
//   3. THE HANDOFF. Press as a player does: Junior starts walking to a launch pad and
//      the screen stays put for the record's 0x3c-tick hold — the disc changes stage
//      only once scene_obj+0x68 runs out, and the hold is NOT a wait for the walk.
//   4. THE ARRIVAL. The player ends in the stage the record's own screen id resolves
//      to (through the same screen table the story handoff routes with), standing on
//      the record's own cell, facing the record's own facing.
//
// Server: python3 -m http.server 8841 --directory web
// Run:    VERIFY_PORT=8841 tools/run-playwright.sh tools/verify_step_launch_handoff.mjs
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const GRIDS = (await load("story_trigger_grids.json")).stages;
const STEPS = (await load("story_steps.json")).stages;
const SCREENS = await load("screen_table.json");
const PADS = await load("launch_pads.json");

const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];

/** The first cell on `stage` whose grid byte names an op-14 step record. */
function cellForOp14(stage) {
    const grid = GRIDS[stage.slice(1)];
    const prog = STEPS[stage.slice(1)];
    for (let i = 0; i < grid.grid.length; i++) {
        const b = grid.grid[i] & 0xff;
        if (!b) continue;
        const idx = b & 0x1f;
        if (idx >= prog.steps.length || prog.steps[idx].op !== 14) continue;
        return {
            grid, idx, group: (b >> 5) & 7, step: prog.steps[idx],
            x: (i % grid.w) * grid.cell + grid.cell / 2,
            y: Math.floor(i / grid.w) * grid.cell + grid.cell / 2,
        };
    }
    return null;
}

// s311 — A.o.A. Headquarters. Its single op-14 record is the only one of the eleven
// that carries a flag condition, which makes it the one place both halves of the gate
// can be shown: shut, then open.
const STAGE = "s311";
const cell = cellForOp14(STAGE);
assert.ok(cell, "s311 must have an op-14 tile");
const [screenId, spawnX, spawnY, facingIndex] = cell.step.params;
const entry = SCREENS[String(screenId)];
assert.ok(entry?.stage != null, `screen ${screenId} must resolve to a stage`);
const DEST = `s${entry.stage}`;
// char+0x60 is the 0-7 facing index: the handoff copies the record's word straight
// into it (fieldstg.s:0xe758/:0xe760), so this is the disc's own table.
const FACE = FACINGS[facingIndex & 7];
assert.ok(PADS[STAGE.slice(1)]?.pads?.length, `${STAGE} registers at least one launch pad`);

const PORT = Number(process.env.VERIFY_PORT || 8841);
await mkdir(".bunny-scratch", { recursive: true });
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
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.goto(`http://localhost:${PORT}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes("index.html"));

const shot = async (name) => page.screenshot({
    path: `.bunny-scratch/${name}.png`,
    clip: { x: 335, y: 185, width: 668, height: 480 },
});

const enter = async (stage) => {
    await frame.evaluate(async (s) => {
        const st = window.__state;
        st.__eng?.state?.reset?.();
        const i = st.manifest.maps.findIndex((m) => m.id === s);
        window.__setMap(i);
        for (let k = 0; k < 60; k++) await new Promise((r) => requestAnimationFrame(r));
    }, stage);
    await frame.waitForFunction(() => window.__fade.dir === 0, null, { timeout: 15000 });
    await frame.waitForTimeout(400);
};

/** Put the player on the tile and let the frame settle. */
const stand = async (dir) => frame.evaluate(async ([q, d]) => {
    const st = window.__state;
    st.x = q.x;
    st.y = q.y;
    st.dir = d;
    st.climb = null;
    st.slope = null;
    st.handoffHold = null;
    st.launch = null;
    st.moving = false;
    for (let k = 0; k < 12; k++) await new Promise((r) => requestAnimationFrame(r));
    return {
        map: st.manifest.maps[st.mapIdx].id,
        x: Math.round(st.x), y: Math.round(st.y),
        dir: st.dir,
        icon: st._indicatorKey ?? null,
    };
}, [cell, dir]);

/** The port's own answer for the tile underfoot, read from the engine. */
const askPort = () => frame.evaluate(async (q) => {
    const st = window.__state;
    const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
    const pb = window.__engineTriggerSystem.playback(
        st.manifest.maps[st.mapIdx].id, q.x, q.y, FACINGS.indexOf(q.dir), true);
    return pb && {
        live: pb.live, op: pb.op, group: pb.group,
        padSlot: pb.effect?.padSlot ?? null,
        fn: pb.effect?.handoff?.fn ?? null,
        args: pb.effect?.handoff?.args ?? null,
        hold: pb.effect?.handoff?.holdTicks ?? null,
        bubbleHidden: pb.bubbleHidden,
    };
}, cell);

const keyEvent = (type, key, code) => frame.evaluate(([t, k, c]) => {
    window.dispatchEvent(new KeyboardEvent(t, { key: k, code: c, bubbles: true, cancelable: true }));
}, [type, key, code]);
const press = async (key, code = key) => {
    await keyEvent("keydown", key, code);
    await frame.waitForTimeout(40);
    await keyEvent("keyup", key, code);
};

const results = {};
try {
    // ── 1 & 2. the gate and the port's answer ───────────────────────────────
    await enter(STAGE);

    // The record's own flag condition, closed. On the disc this is read in the driver's
    // SETUP arm (fieldstg.s:56dc/:5700) and its failure branch returns PAST the
    // level-1 increment at :5d40, which is the only way to the playback arm — so a
    // shut flag darkens the tile for the bubble and for the press together.
    //
    // 0x6028 is bank 0x60, which the flag store resolves as PROGRESS-ORDINAL EQUALITY
    // (web/flag-store.js: `bank === 0x60 -> ordinal == id & 0x1ff`), so this one tile is
    // live only at master ordinal 40. That is the Spy Satellite call on the A.o.A. HQ
    // map, and it is the reason s311's tile needs the story moved before it can fire.
    const ORDINAL = 0x6028 & 0x1ff;
    const setFlag = (on, ord) => frame.evaluate(([v, o]) => {
        window.__state.progressOrdinal = v ? o : 0;
        return { ordinal: window.__state.progressOrdinal, flag: window.__storyFlags.get(0x6028) };
    }, [on, ORDINAL]);
    assert.deepEqual(await setFlag(false), { ordinal: 0, flag: 0 },
        "off the ordinal the op-14 gate flag reads 0");
    const shut = await askPort();
    results.shut = shut;
    assert.equal(shut.live, false, `with the flag unset the tile is not live (${JSON.stringify(shut)})`);
    assert.equal(shut.op, null, "so no op runs on a held press");

    const shutStand = await stand("down");
    results.shutStand = shutStand;
    assert.equal(shutStand.icon, null, "and the disc puts the bubble away");
    await press("Enter");
    await frame.waitForTimeout(400);
    const afterShutPress = await frame.evaluate(() => ({
        map: window.__state.manifest.maps[window.__state.mapIdx].id,
        hold: window.__state.handoffHold != null,
        launch: window.__state.launch != null,
    }));
    results.afterShutPress = afterShutPress;
    assert.deepEqual(afterShutPress, { map: STAGE, hold: false, launch: false },
        "pressing a shut op-14 tile does nothing at all");
    await shot("op14-gate-shut");

    assert.deepEqual(await setFlag(true), { ordinal: ORDINAL, flag: 1 },
        "at ordinal 40 the record's own condition holds");
    const asked = await askPort();
    results.asked = asked;
    assert.equal(asked.op, 14, `the port reads op 14 on the tile (${JSON.stringify(asked)})`);
    assert.equal(asked.padSlot, 0x158, "the disc's op-14 handler calls actor+0x158 — the pad walk");
    assert.equal(asked.fn, 0x8008b6d4,
        "and hands off through 0x8008B6D4 itself, NOT op 1's 0x8008B770 wrapper");
    assert.deepEqual(asked.args,
        [screenId, 0xffffffff, (spawnX << 8) >>> 0, (spawnY << 8) >>> 0, facingIndex, 0x3c],
        "the six handoff words are the record's own five plus the 0x3c hold");
    assert.equal(asked.hold, 0x3c, "the hold is 60 ticks — op 1's wrapper passes zero");

    const on = await stand("down");
    results.onTile = on;
    assert.ok(on.icon != null, "the tile shows its indicator");
    await shot("op14-armed");

    // ── 3. the pad walk and the hold ───────────────────────────────────────
    await press("Enter");
    // The press must start the pad walk in the very same frame it requests the
    // handoff — the disc's handler makes both calls back to back (:5a40, :5a70).
    const during = await frame.evaluate(() => {
        const st = window.__state;
        return {
            launch: st.launch ? { phase: st.launch.phase, ticks: st.handoffHold?.ticks } : null,
            hold: st.handoffHold ? st.handoffHold.ticks : null,
            fade: window.__fade.dir,
            moving: st.moving,
        };
    });
    results.during = during;
    assert.ok(during.launch, "pressing on the op-14 tile starts the pad walk");
    assert.equal(during.launch.phase, "approach", "which walks Junior to the pad");
    // Already counting down — a frame or two had passed between the press and this read.
    assert.ok(during.hold > 0 && during.hold <= 0x3c,
        `scene_obj+0x68 was seeded with 0x3c and is counting down (${during.hold})`);
    assert.equal(during.fade, 0, "but the screen has NOT changed yet — the hold is still running");
    await shot("op14-walking");

    // The hold is a fixed count, not a wait for the walk: it must expire on its own
    // and start the ordinary stage change. The pad's own charge is 106 ticks, longer
    // than the 60 the record allows, so the load lands before any flight would.
    await frame.waitForFunction(() => window.__fade.dir !== 0, null, { timeout: 20000 });
    results.holdExpired = await frame.evaluate(() => ({
        fade: window.__fade.dir,
        hold: window.__state.handoffHold,
    }));
    assert.equal(results.holdExpired.hold, null, "the hold is spent and cleared");

    // ── 4. the arrival ──────────────────────────────────────────────────────
    await frame.waitForFunction(
        (d) => window.__state.manifest.maps[window.__state.mapIdx].id === d,
        DEST, { timeout: 30000 });
    await frame.waitForFunction(() => window.__fade.dir === 0, null, { timeout: 30000 });
    await frame.waitForTimeout(600);
    const landed = await frame.evaluate(() => {
        const st = window.__state;
        return {
            map: st.manifest.maps[st.mapIdx].id,
            x: Math.round(st.x), y: Math.round(st.y), dir: st.dir,
        };
    });
    results.landed = landed;
    assert.equal(landed.map, DEST, `screen ${screenId} loads ${DEST}, the stage the table names`);
    assert.equal(landed.x, spawnX, "on the cell the record's own handoff asked for");
    assert.equal(landed.y, spawnY, "... in both axes");
    assert.equal(landed.dir, FACE,
        "facing the record's own 0-7 facing index, copied straight into char+0x60");
    await shot("op14-arrival");

    assert.deepEqual(errors, [], "no page errors");
    console.log("RESULT", JSON.stringify({
        ok: true, stage: STAGE, dest: DEST,
        record: { screenId, spawnX, spawnY, facingIndex, face: FACE },
        results,
    }, null, 1));
    console.log("captures: .bunny-scratch/op14-{gate-shut,armed,walking,arrival}.png");
} catch (e) {
    console.error("FAIL:", e.message);
    console.error("RESULT", JSON.stringify({ ok: false, results }, null, 1));
    process.exitCode = 1;
} finally {
    await browser.close();
}