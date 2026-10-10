// Headless check for the position step's PLAYBACK executor (`0x800885d4`) as the
// walker now uses it, driven through the REAL web/game.js in the web/ui-lab.html
// harness (no mock renderer).
//
// Decode: pro/fieldstg.s:5924-5bd4 (the executor), :5bd8-5d84 (the resident driver
// whose gates decide when it runs), :5a80/:5ac0 (ops 2/3, the ladder),
// :5970-5a2c (op 1, the door and its handoff); engine/systems/scene-step-ops.ts
// execPlaybackOp and engine/systems/trigger-system.ts playback.
//
// What it asserts, by playing the game:
//
//   1. LADDER. Standing on the tile whose grid byte names the step's op-2 record
//      (the ladder's bottom end) and pressing the confirm button mounts the climb,
//      and the player is snapped to the record's OWN endpoint cell — not to whatever
//      endpoint happens to be within a radius. Facing the tile the way the record's
//      grid group asks is required; facing away is not.
//   2. WARP. Standing on a door tile (op 1) and pressing the same button crosses, and
//      the landing is the destination the record names.
//   3. GATE. The same door tile with the player facing AWAY from the group's cone
//      shows no prompt and does not cross — the disc's facing gate, which the door
//      path now shares with the icon.
//
// Server: python3 -m http.server 8833 --directory web
// Run:    VERIFY_PORT=8833 tools/run-playwright.sh tools/verify_step_ladder_warp.mjs
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const GRIDS = (await load("story_trigger_grids.json")).stages;
const STEPS = (await load("story_steps.json")).stages;
const CONE = (await load("scene/step_enable_table.json")).rows;

const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];

/** A cell whose byte names a step with `op`, preferring one the facing cone admits. */
function cellForOp(stage, op) {
    const grid = GRIDS[stage.slice(1)];
    const prog = STEPS[stage.slice(1)];
    for (let i = 0; i < grid.grid.length; i++) {
        const b = grid.grid[i] & 0xff;
        if (!b) continue;
        const idx = b & 0x1f;
        if (idx >= prog.steps.length || prog.steps[idx].op !== op) continue;
        const g = (b >> 5) & 7;
        return {
            grid, idx, group: g, step: prog.steps[idx],
            cx: i % grid.w, cy: Math.floor(i / grid.w),
            x: (i % grid.w) * grid.cell + grid.cell / 2,
            y: Math.floor(i / grid.w) * grid.cell + grid.cell / 2,
        };
    }
    return null;
}

// ── the ladder: s946 (Forest Inn door side) has one rail, and its op-2/op-3
//    records carry its id and both endpoint cells verbatim.
const LADDER_STAGE = "s946";
const ladderBottom = cellForOp(LADDER_STAGE, 2);
const ladderTop = cellForOp(LADDER_STAGE, 3);
assert.ok(ladderBottom && ladderTop, "s946 must have an op-2 and an op-3 tile");
const [ladderId, bx, by] = ladderBottom.step.params;
const [, tx, ty] = ladderTop.step.params;
assert.equal(ladderTop.step.params[0], ladderId, "both ends name the same ladder id");

// ── the warp: s946's own grid has two op-1 records, the door out and its partner.
//    Pick one whose exit row exists in the scene, and read the destination from the
//    scene record (the resolved product of the same params).
const WARP_STAGE = LADDER_STAGE;
const sceneJson = JSON.parse(
    await readFile(new URL(`../web/assets/scenes/${WARP_STAGE}.json`, import.meta.url)),
);
const warpRow = sceneJson.exits.find((e) => e.to);
assert.ok(warpRow, "s946 must have an exit");
const warpCell = cellForOp(WARP_STAGE, 1);
assert.ok(warpCell, "s946 must have an op-1 tile");

// ── op 4: s375's ledge. Four tiles name one op-4 record with param 0 = 5.
const SLOPE_STAGE = "s375";
const slopeCell = cellForOp(SLOPE_STAGE, 4);
assert.ok(slopeCell, "s375 must have an op-4 tile");

// ── op 7: s202's three op-7 records are the fishing spots.
const CAST_STAGE = "s202";
const castCell = cellForOp(CAST_STAGE, 7);
assert.ok(castCell, "s202 must have an op-7 tile");

const PORT = Number(process.env.VERIFY_PORT || 8833);
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

/** Put the player on a cell, face a way, and let the frame settle. */
const stand = async (p, dir) => frame.evaluate(async ([q, d]) => {
    const st = window.__state;
    st.x = q.x;
    st.y = q.y;
    st.dir = d;
    st.climb = null;
    st.slope = null;
    st.moving = false;
    for (let k = 0; k < 12; k++) await new Promise((r) => requestAnimationFrame(r));
    return {
        map: st.manifest.maps[st.mapIdx].id,
        x: Math.round(st.x), y: Math.round(st.y),
        dir: st.dir,
        onExit: st.onExit,
        icon: st._indicatorKey ?? null,
        fishing: st.fishing != null,
    };
}, [p, dir]);

/** The port's own answer for the tile underfoot, read from the engine. */
const askPort = (p, dir = null) => frame.evaluate(async ([q, d]) => {
    const st = window.__state;
    const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
    const facing = d == null ? q.group : Math.max(0, FACINGS.indexOf(d));
    const pb = window.__engineTriggerSystem.playback(
        st.manifest.maps[st.mapIdx].id, q.x, q.y, facing, true);
    return pb && {
        live: pb.live, op: pb.op, group: pb.group,
        slot: pb.effect?.actorCall?.slot ?? null,
        x: pb.effect?.actorCall?.args?.[1] ?? null,
        y: pb.effect?.actorCall?.args?.[2] ?? null,
        handoff: pb.effect?.handoff?.args ?? null,
        // The actor-side half: engine/systems/step-actor-actions.ts.
        mode: pb.effect?.actorAction?.mode ?? null,
        kind: pb.effect?.actorAction?.kind ?? null,
        side: pb.effect?.actorAction?.side ?? null,
        stepCells: pb.effect?.actorAction?.stepCells ?? null,
        dropCells: pb.effect?.actorAction?.dropCells ?? null,
        floatDx: pb.effect?.actorAction?.floatDx ?? null,
        floatDy: pb.effect?.actorAction?.floatDy ?? null,
    };
}, [p, dir]);

// The game lives in an iframe and page.keyboard dispatches to the focused document,
// which in the lab is the harness. Dispatch the event inside the game frame instead —
// game.js listens on its own window, and this is the same event a real key makes.
const keyEvent = (type, key, code) => frame.evaluate(([t, k, c]) => {
    window.dispatchEvent(new KeyboardEvent(t, { key: k, code: c, bubbles: true, cancelable: true }));
}, [type, key, code]);
const press = async (key, code = key) => {
    await keyEvent("keydown", key, code);
    await frame.waitForTimeout(30);
    await keyEvent("keyup", key, code);
};
/** Hold a direction key down until `done` (the field loop reads state.keys). */
const holdUntil = async (key, frameFn, timeout) => {
    await keyEvent("keydown", key, key);
    try {
        await frame.waitForFunction(frameFn, null, { timeout });
    } finally {
        await keyEvent("keyup", key, key);
    }
};

const results = {};
try {
    // ── 1. the ladder ────────────────────────────────────────────────────────
    await enter(LADDER_STAGE);
    // The group the op-2 record's own tile demands, and a facing outside its cone.
    const inCone = FACINGS[ladderBottom.group];
    const outCone = FACINGS[(ladderBottom.group + 4) % 8];

    const asked = await askPort(ladderBottom, inCone);
    assert.equal(asked.op, 2, `the port reads op 2 on the ladder's bottom tile (${JSON.stringify(asked)})`);
    assert.equal(asked.slot, 0x114, "the disc's op-2 handler calls actor+0x114");
    assert.equal(asked.x, bx, `the record's own bottom cell (${bx})`);
    assert.equal(asked.y, by, `the record's own bottom cell (${by})`);

    // Facing away from the cone: the tile is not armed, so no prompt, no climb.
    const away = await stand(ladderBottom, outCone);
    results.ladderAway = { ...away, outCone };
    assert.equal(away.icon, null, `facing ${outCone} is outside the tile's cone: no icon`);
    await press("Enter");
    await frame.waitForTimeout(300);
    const stillAway = await frame.evaluate(() => ({
        climb: window.__state.climb ? window.__state.climb.x : null,
    }));
    results.ladderAwayClimb = stillAway.climb;
    assert.equal(stillAway.climb, null, "and no climb mounts facing away from the tile");
    await shot("ladder-away");

    // Facing the tile the way the record's group asks: icon, prompt and the mount.
    const on = await stand(ladderBottom, inCone);
    results.ladderOn = { ...on, inCone };
    assert.ok(on.icon != null, `facing ${inCone} is inside the cone: the ladder icon is up`);
    await shot("ladder-icon");
    await press("Enter");
    await frame.waitForTimeout(250);
    const mounted = await frame.evaluate(() => {
        const c = window.__state.climb;
        return c ? { x: Math.round(c.x), y: Math.round(window.__state.y), dirStr: c.dirStr } : null;
    });
    results.ladderMounted = mounted;
    assert.ok(mounted, "pressing on the op-2 tile mounts the climb");
    assert.equal(mounted.x, bx, "and the player is on the record's endpoint cell, not a radius match");
    await shot("ladder-mounted");
    // Climb up and off at the top: the dismount lands on the op-3 record's cell.
    // Up is a HELD key in the field loop, so it stays down until the climb dismounts.
    await holdUntil("ArrowUp", () => window.__state.climb == null, 20000);
    await frame.waitForTimeout(200);
    const top = await frame.evaluate(() => ({
        x: Math.round(window.__state.x), y: Math.round(window.__state.y),
    }));
    results.ladderTop = top;
    assert.equal(top.y, ty, `the climb dismounts at the op-3 record's cell (${tx},${ty})`);
    await shot("ladder-top");

    // ── 2. the warp ───────────────────────────────────────────────────────────
    await enter(WARP_STAGE);
    const warpAsked = await askPort(warpCell, FACINGS[warpCell.group]);
    results.warpPort = warpAsked;
    assert.equal(warpAsked.op, 1, `the port reads op 1 on the door tile (${JSON.stringify(warpAsked)})`);
    assert.equal(warpAsked.slot, 0x110, "the disc's op-1 handler calls actor+0x110 first");
    assert.deepEqual(warpAsked.handoff?.slice(0, 2),
        [warpCell.step.params[0], -1 >>> 0],
        "then hands the id and -1 to the handoff worker");

    // The same door, facing away: the cone gates it exactly as it gates the icon.
    const warpOut = await stand(warpCell, FACINGS[(warpCell.group + 4) % 8]);
    results.warpAway = warpOut;
    assert.equal(warpOut.onExit, false,
        `facing ${FACINGS[(warpCell.group + 4) % 8]} leaves the door unprompted (the disc's cone)`);
    await shot("warp-away");

    const warpIn = await stand(warpCell, FACINGS[warpCell.group]);
    results.warpOn = warpIn;
    assert.equal(warpIn.onExit, true, "facing the door the record's group asks shows the prompt");
    await shot("warp-prompt");
    await press("Enter");
    await frame.waitForFunction(
        (m) => window.__state.manifest.maps[window.__state.mapIdx].id === m,
        warpRow.to, { timeout: 15000 });
    const arrived = await frame.evaluate(() => ({
        map: window.__state.manifest.maps[window.__state.mapIdx].id,
        x: Math.round(window.__state.x), y: Math.round(window.__state.y),
        dir: window.__state.dir,
    }));
    results.warpArrival = arrived;
    assert.equal(arrived.map, warpRow.to, `crossed to ${warpRow.to}`);
    assert.equal(arrived.x, warpRow.spawnX, `landed at the record's spawn x (${warpRow.spawnX})`);
    assert.equal(arrived.y, warpRow.spawnY, `landed at the record's spawn y (${warpRow.spawnY})`);
    await frame.waitForFunction(() => window.__fade.dir === 0, null, { timeout: 15000 });
    await frame.waitForTimeout(400);
    await shot("warp-arrival");

    // ── 3. OP 4 — the scripted slope step (the actor's +0x11c, mode 0x47) ─────
    // s375 carries four op-4 tiles on one ledge; the record's param 0 is 5, so the
    // disc steps him 16 cells sideways and slides him 5 * 16 = 80 cells down
    // (fieldstg.s:0xdb60-:0xdb8c, +0x90 -= 0x300 a tick at :0xdbe4).
    await enter(SLOPE_STAGE);
    const slopeAsked = await askPort(slopeCell, FACINGS[slopeCell.group]);
    results.slopePort = slopeAsked;
    assert.equal(slopeAsked.op, 4, `the port reads op 4 on the slope tile (${JSON.stringify(slopeAsked)})`);
    assert.equal(slopeAsked.slot, 0x11c, "the disc's op-4 handler calls actor+0x11c");
    assert.equal(slopeAsked.mode, 0x47, "which switches the player into mode 0x47");
    assert.equal(slopeAsked.side, slopeCell.group === 7 ? 1 : -1,
        "the step's direction is the tile's facing group");
    assert.equal(slopeAsked.stepCells, (slopeCell.group === 7 ? 1 : -1) * 16,
        "16 cells sideways (0x1000 internal units, one cell = 0x100)");
    assert.equal(slopeAsked.dropCells, slopeCell.step.params[0] * 16,
        "and param0 * 16 cells down");

    // Facing away from the cone: nothing happens at all.
    const slopeAway = await stand(slopeCell, FACINGS[(slopeCell.group + 4) % 8]);
    results.slopeAway = slopeAway;
    await press("Enter");
    await frame.waitForTimeout(300);
    const noSlope = await frame.evaluate(() => ({
        slope: window.__state.slope != null,
        x: Math.round(window.__state.x), y: Math.round(window.__state.y),
    }));
    results.slopeAwayAfter = noSlope;
    assert.equal(noSlope.slope, false, "facing away from the tile's cone: no step runs");
    assert.equal(noSlope.x, Math.round(slopeCell.x), "... and the player has not moved");
    await shot("slope-away");

    // Facing the tile the record's group asks: press, and he walks himself off it.
    const slopeFrom = await stand(slopeCell, FACINGS[slopeCell.group]);
    results.slopeFrom = slopeFrom;
    assert.equal(Math.round(slopeFrom.x), Math.round(slopeCell.x), "standing on the slope tile");
    await shot("slope-before");
    await press("Enter");
    await frame.waitForTimeout(120);
    const sliding = await frame.evaluate(() => {
        const s = window.__state.slope;
        return s ? { phase: s.phase, x: Math.round(s.x), y: Math.round(s.y) } : null;
    });
    results.slopeSliding = sliding;
    assert.ok(sliding, "pressing on the op-4 tile starts the scripted step");
    assert.equal(sliding.phase, "slide", "which slides him down at three cells a tick");
    assert.equal(sliding.x, Math.round(slopeCell.x) + slopeAsked.stepCells,
        "the sideways step landed immediately, as the disc's sub-block 0 does");
    await shot("slope-sliding");
    await frame.waitForFunction(() => window.__state.slope == null, null, { timeout: 20000 });
    const landed = await frame.evaluate(() => ({
        x: Math.round(window.__state.x), y: Math.round(window.__state.y),
    }));
    results.slopeLanded = landed;
    assert.equal(landed.x, Math.round(slopeCell.x) + slopeAsked.stepCells,
        "he ends 16 cells to the side of the tile");
    assert.equal(landed.y, Math.round(slopeCell.y) + slopeAsked.dropCells,
        `and ${slopeAsked.dropCells} cells lower (param0 * 16)`);
    await shot("slope-after");

    // ── 4. OP 7 — the cast pose (the actor's +0x120, mode 0x48) ───────────────
    // s202's three op-7 records are the fishing spots. They were already ported (the
    // bobber, the five clips and the result balloon live in engine/systems/fishing.ts);
    // what this pass adds is that the spot is ARMED by the playback executor rather
    // than by the walker's private read of the grid byte.
    //
    // And the executor's answer includes the RECORD'S OWN FLAG CONDITIONS, which is
    // where the rod lives: every op-7 record in the shipped corpus carries
    // cond_a = 0x8005 / arg_a = 1, and 0x8005 is item 5 (the FishingPole) in the bag
    // (web/assets/data/story_steps.json). On the disc that condition is read in the
    // driver's SETUP arm (fieldstg.s:56dc/:5700) and its failure branch returns without
    // the level-1 increment at :5d40 — the only way out of sub-state 0, and so the only
    // way to the playback arm at :5cbc/:5d38. So no rod means the press never reaches
    // the cast at all. Both halves are checked: closed, then open.
    await enter(CAST_STAGE);
    const setPole = (on) => frame.evaluate((v) => {
        const st = window.__state;
        st.inventory = st.inventory.filter((s) => s.id !== 5);
        if (v) st.inventory.push({ id: 5, qty: 1 });
        return window.__storyFlags.get(0x8005);
    }, on);
    assert.equal(await setPole(false), 0, "no rod in the bag, no 0x8005");
    const castNoPole = await askPort(castCell, FACINGS[castCell.group]);
    results.castNoPole = castNoPole;
    assert.equal(castNoPole.live, false,
        `without the FishingPole the fishing tile is not armed at all (${JSON.stringify(castNoPole)})`);
    assert.equal(castNoPole.op, null, "... and no op runs, so there is no cast");
    assert.equal(await setPole(true), 1, "the rod in the bag IS flag 0x8005");
    const castAsked = await askPort(castCell, FACINGS[castCell.group]);
    results.castPort = castAsked;
    assert.equal(castAsked.op, 7, `the port reads op 7 on the fishing tile (${JSON.stringify(castAsked)})`);
    assert.equal(castAsked.slot, 0x120, "the disc's op-7 handler calls actor+0x120");
    assert.equal(castAsked.kind, "castPose", "which switches the player into mode 0x48");
    assert.equal(castAsked.floatDx, castCell.step.params[0], "and puts the float at the record's param 0");
    assert.equal(castAsked.floatDy, castCell.step.params[1], "... and its param 1");
    const castAway = await stand(castCell, FACINGS[(castCell.group + 4) % 8]);
    results.castAway = castAway;
    assert.equal(castAway.fishing, false,
        "facing away from the tile's cone the spot is not armed at all");

    assert.deepEqual(errors, [], "no page errors");
    console.log("RESULT", JSON.stringify({ ok: true, ladderId, bottom: [bx, by], top: [tx, ty], results }, null, 1));
    console.log("captures: .bunny-scratch/ladder-{icon,mounted,top,away}.png, warp-{prompt,away,arrival}.png, slope-{before,sliding,after,away}.png");
} catch (e) {
    console.error("FAIL:", e.message);
    console.error("RESULT", JSON.stringify({ ok: false, results }, null, 1));
    process.exitCode = 1;
} finally {
    await browser.close();
}