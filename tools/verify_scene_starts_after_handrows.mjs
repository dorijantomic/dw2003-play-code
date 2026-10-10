// Headless check for the arrival scenes that used to be reached by a hand row, driven through
// the REAL web/game.js in the web/ui-lab.html harness (no mock renderer).
//
// What a player meets, one room at a time:
//   s421  arrive at step 11 with 0x408b set  -> the partner-accompanied walk-out, and you end up
//         in s431. (Its `trigger: "OnExit"` row is gone: the room's own entry object starts it.)
//   s545  arrive at step 2 with 0x4051 set   -> the cutscene out of the room, and you end up in
//         s540. (Same: the row was a claim about an exit trigger the disc does not have.)
//   s440  arrive at step 6                   -> the walk-out to s445. Still the entry object.
//   s210  walk to the tile in front of a lobby door at step 2 -> your partner walks back and says
//         it needs your partner Digimon data, and you stay. (Two `OnExit` "guards" that used to
//         BLOCK both doors are gone; the lobby's own position step is the start.)
//   s795  arrive with 0x4043 set -> the second scene, and you end up in s750. This one is a
//   s800  SECOND gate object, on the phase-1 band, so it did not run at all before 2026-10-05.
//
// Every ordinal and flag here is read out of web/assets/data/scene/arrival_candidates.json or
// web/assets/data/story_steps.json at the top of the run — nothing is typed in twice.
//
//   python3 -m http.server 8791 --directory web
//   VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_scene_starts_after_handrows.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) => JSON.parse(await readFile(new URL(`../web/${p}`, import.meta.url)));
const GATES = (await load("assets/data/scene/arrival_candidates.json")).stages;
const STEPS = (await load("assets/data/story_steps.json")).stages;
const GRIDS = (await load("assets/data/story_trigger_grids.json")).stages;
const EVENTS = await load("assets/events/wstag_events.json");

/** The gate object rows of one place, in overlay-allocation order. */
const gateObjects = (mapId) => {
    const v = GATES[mapId];
    return !v ? [] : (Array.isArray(v) ? v : [v]);
};
/** The one candidate of `event` in `mapId`'s phase-1 gate object (the second one), or null. */
const phase1 = (mapId, event) =>
    gateObjects(mapId).find((g) => g.phase_gate?.band === "phase1")
        ?.candidates.find((c) => c.event === event);
/** Every leaf of a candidate's own paths, as [id, expected] pairs. */
const leaves = (cand) => cand.paths.flat().map(([id, v]) => [id, v]);
const head = (stage, id) => {
    const e = EVENTS[stage].find((x) => x.id === id);
    assert.ok(e, `${stage} event ${id} exists`);
    return e.disasm.slice(0, 2).join(" ");
};
/** Seed one gate candidate's own leaves as the flags and ordinal they name. */
const seed = (cand) => {
    const ordinal = [], flags = [];
    for (const [id, v] of leaves(cand)) {
        if ((id & 0xff00) === 0x6000) ordinal.push([id & 0x1ff, v]);
        else flags.push([id, v]);
    }
    return { ordinal, flags };
};

const CASES = [
    { name: "s421: the partner walk-out is the room's own entry object",
      map: "s421", event: 741, pick: 741, dest: "s780", gate: "reset" },
    { name: "s421: with 0x408f set the same object starts 743 and sends you to s431",
      map: "s421", event: 743, pick: 743, dest: "s431", gate: "reset" },
    { name: "s545: the cutscene out of the room is the room's own entry object",
      map: "s545", event: 711, pick: 711, dest: "s540", gate: "reset" },
    { name: "s440: the walk-out to s445 is the entry object",
      map: "s440", event: 152, pick: 152, dest: "s445", gate: "reset" },
    { name: "s795: the SECOND gate object (phase-1 band) sends you to s750",
      map: "s795", event: 1505, pick: 1505, dest: "s750", gate: "phase1" },
    { name: "s800: the SECOND gate object (phase-1 band) sends you to s750",
      map: "s800", event: 1506, pick: 1506, dest: "s750", gate: "phase1" },
];
for (const c of CASES) {
    const obj = gateObjects(c.map).find((g) => (g.phase_gate?.band ?? "reset") === c.gate);
    assert.ok(obj, `${c.map} has a ${c.gate}-band gate object`);
    const cand = obj.candidates.find((x) => x.event === c.pick);
    assert.ok(cand, `${c.map}/${c.gate}: candidate ${c.pick}`);
    assert.equal(head(c.map, c.event), head(c.map, c.pick));
    Object.assign(c, seed(cand));
}
// The s210 reminder is a POSITION STEP, so its ordinal comes from the record's own condition.
const stepIndex = STEPS["210"].steps.findIndex((s) => s.op === 8 && s.params[0] === 20);
const step20 = STEPS["210"].steps[stepIndex];
assert.equal(step20.cond_a >> 8, 0x60, `event 20's step gates on the ordinal (${step20.cond_a})`);
assert.equal(step20.cond_b, 0xffff, "and has no second condition");
const ORD20 = step20.cond_a & 0x1ff;
const cell = GRIDS["210"].grid.indexOf(stepIndex);
assert.notEqual(cell, -1, `s210's grid carries byte ${stepIndex}`);
const TILE20 = { x: (cell % GRIDS["210"].w) * GRIDS["210"].cell + GRIDS["210"].cell / 2,
                 y: Math.floor(cell / GRIDS["210"].w) * GRIDS["210"].cell + GRIDS["210"].cell / 2 };

const PORT = Number(process.env.VERIFY_PORT ?? 8791);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const errors = [];

/** One clean boot, the flags seeded, the room entered, and its arrival scene paged to its end. */
async function enter(mapId, ordinal, flags, tile) {
    const context = await browser.newContext({
        viewport: { width: 1100, height: 900 },
        storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [
            { name: "engineSchema", value: "2" },
            { name: "party", value: JSON.stringify(PARTY) },
            { name: "charId", value: PARTY[0] }] }] },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${mapId}: ${e.message}`));
    await page.goto(`http://localhost:${PORT}/ui-lab.html`, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const frame = page.frames().find((f) => f.url().includes("index.html"));
    await frame.evaluate(() => {
        window.__engineBridge.onTalk = () => false;
        if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
    });
    await frame.waitForFunction(() => !window.__cutscene.isActive(), null, { timeout: 15000 });
    const r = await frame.evaluate(async ([mapId, ordinal, flags, tile]) => {
        const press = (k) => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
            window.dispatchEvent(new KeyboardEvent("keyup", { key: k }));
        };
        window.__playedFlagKeys = [];
        const orig = window.__cutscene.start.bind(window.__cutscene);
        window.__cutscene.start = (...a) => { window.__playedFlagKeys.push(a[0]); return orig(...a); };
        if (ordinal != null) window.__engine.state.vars.set("$story.ordinal", ordinal);
        for (const [id, v] of flags) window.__storyFlags.set(id, v);
        const idx = window.__state.manifest.maps.findIndex((m) => m.id === mapId);
        window.__setMap(idx, tile ? { x: tile.x, y: tile.y } : { x: 100, y: 100 });
        if (tile) window.__state.moving = false;
        // `__setMap` swaps the room directly and does NOT run the entry hook; the room's arrival
        // scene is started by the last line of checkStageCutscene, which is exactly
        // `engineBridge.onStageEnter` (web/game.js). A scripted warp out of the room goes through
        // the real fade path, so the DESTINATION's own arrival still fires the way it should.
        // The room has to be the CURRENT one first: the bridge's renderer resolves the scene by
        // flag_key against `currentMap().id`, exactly as the real entry does.
        for (let k = 0; k < 900; k++) {
            if (window.__state.manifest.maps[window.__state.mapIdx].id === mapId) break;
            await new Promise((x) => requestAnimationFrame(x));
        }
        window.__engineBridge.onStageEnter(mapId);
        for (let k = 0; k < 1200; k++) {
            const map = window.__state.manifest.maps[window.__state.mapIdx].id;
            if (map !== mapId) break;
            if (!window.__textbox.isOpen() && !window.__cutscene.isActive()
                && !window.__dialogueBox.isOpen() && window.__fade.dir === 0) {
                await new Promise((x) => requestAnimationFrame(x));
                continue;
            }
            press(" ");
            for (let i = 0; i < 6; i++) await new Promise((x) => requestAnimationFrame(x));
        }
        for (let i = 0; i < 90; i++) await new Promise((x) => requestAnimationFrame(x));
        return {
            map: window.__state.manifest.maps[window.__state.mapIdx].id,
            x: Math.round(window.__state.x), y: Math.round(window.__state.y),
            played: window.__playedFlagKeys.map((d) => (d || []).slice(0, 2).join(" ")),
        };
    }, [mapId, ordinal, flags, tile]);
    if (process.env.VERIFY_TRACE) console.log("  trace", mapId, JSON.stringify({ ordinal, flags, tile }), JSON.stringify(r));
    await context.close();
    return r;
}

const shots = [];
for (const c of CASES) {
    const r = await enter(c.map, c.ordinal[0]?.[0] ?? null, c.flags);
    assert.equal(r.played[0], head(c.map, c.event),
        `${c.name}: first scene must be event ${c.event} (${JSON.stringify(r.played)})`);
    assert.equal(r.map, c.dest, `${c.name}: it ends in ${c.dest} (got ${r.map} at ${r.x},${r.y})`);
    shots.push(`${c.map}${c.gate === "phase1" ? "-phase1" : ""}`);
    console.log(`ok  ${c.name}  ->  ${c.dest}`);
}

// ── s210: the pre-download reminder is the lobby's own position step, not a door block ────────
{
    const r = await enter("s210", ORD20, [], TILE20);
    assert.equal(r.played[0], head("s210", 20),
        `s210: the tile starts event 20 (${JSON.stringify(r.played)})`);
    assert.equal(r.map, "s210", "and it leaves you in the lobby — the scene walks your partner back, it does not block a door");
    shots.push("s210-step20");
    console.log("ok  s210: the reminder tile says the line and you stay in the lobby");
}

assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
console.log(`scene starts after the hand rows: ${shots.length} rooms pass`);
await browser.close();
