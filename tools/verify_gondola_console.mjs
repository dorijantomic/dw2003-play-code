// Headless check for the East/South Station gondola, driven through the REAL web/game.js in
// the web/ui-lab.html harness (no mock renderer).
//
// Decode: the console is the stage's own invisible talk point — s410's cast list record
// `real_5_5_463_328`, slot 5, npc_id 63, with the ptrB dialogue-state table whose `on_close`
// writes bank 0x90 (web/assets/scenes/s410.json; the launcher is
// docs/research/scripting/talk-event-launcher-bank90-2026-07-28.md, and the bindings are
// web/assets/data/talk_launch_bindings.json). Writing 0x900A starts event 142, 0x9009 starts
// event 140, 0x905F starts event 143; the South Station console writes 0x9060 → event 144.
// Every one of those four events ends in a HANDOFF (wstag_events.json: 142 → `HANDOFF 557`
// s415, 143 → `HANDOFF 562` s440, 144 → `HANDOFF 556` s410, and 140 ENDs with no handoff).
// With no card at all the console's own line plays instead, and the POSITION STEP program
// (web/assets/data/story_steps.json s210/s410 op-8 records, ported by
// engine/systems/trigger-system.ts) starts event 90, which walks you to the console and
// HANDOFFs 554 → s400.
//
// What a player meets: press confirm in front of the gondola console. The Blue Card in your bag
// starts the ride and the game moves you across; the corrupted card is refused and you stay; no
// card at all gets you told who is in charge and put back outside the station.
//
// What this replaces: four hand `OnExit` rows in tools/engine-convert/decode-table.json (s410
// 140/142/143, s440 144) plus tools/wire_gondola.py's `gondola: true` exit zone — an exit
// trigger the disc does not have, standing in for a conversation the disc does have.
//
//   python3 -m http.server 8791 --directory web
//   VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_gondola_console.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) => JSON.parse(await readFile(new URL(`../web/${p}`, import.meta.url)));
const EVENTS = (await load("assets/events/wstag_events.json"));
const S410 = await load("assets/scenes/s410.json");
const S440 = await load("assets/scenes/s440.json");
const BINDINGS = await load("assets/data/talk_launch_bindings.json");
const STEPS = await load("assets/data/story_steps.json");

const evOf = (stage, id) => EVENTS[stage].find((e) => e.id === id);
const head = (e) => e.disasm.slice(0, 2).join(" ");
/** The step record a trigger byte selects: low 5 bits index the program, top 3 are the group. */
const stepRecordAt = (grid, byte) => STEPS.stages["410"].steps[byte & 0x1f];
// The four console-launched scenes, each read from the binding table rather than a hand list.
const launchOf = (stage, event) => BINDINGS.stages[stage].find((r) => r.event === event);
const ev90 = evOf("s410", 90);
assert.equal(head(launchOf("s410", 142) && evOf("s410", 142)), head(evOf("s410", 142)));
for (const [stage, id, dest] of [["s410", 142, "s415"], ["s410", 143, "s440"], ["s440", 144, "s410"], ["s410", 140, undefined]]) {
    const e = evOf(stage, id);
    assert.ok(launchOf(stage, id), `${stage} event ${id} has a bank-0x90 start site`);
    assert.equal(e.handoff_to, dest, `${stage} event ${id} hands off to ${dest}`);
    assert.ok(e.disasm.at(-1) === "END", `${stage} event ${id} ends`);
    assert.ok(e.disasm.some((l) => l.startsWith("HANDOFF")) === (dest !== undefined),
        `${stage} event ${id} ${dest ? "carries" : "carries no"} HANDOFF`);
}
// The no-card branch is the stage's own POSITION step, not a row: an op-8 record in s410.
const step90 = STEPS.stages["410"].steps.find((s) => s.op === 8 && s.params[0] === 90);
assert.ok(step90, "s410's step program names event 90");
assert.equal(evOf("s410", 90).handoff_to, "s400");
// The no-card branch is open at the story step its OWN two conditions name (cond_a 0x6005 =
// ordinal 5, cond_b 0xffff = none) — read, not guessed, and a different step from the console's
// own spawn gate (0x6006), which is why the two never fight over the same visit.
const STEP_ORDINAL = step90.cond_a & 0x1ff;
assert.equal(step90.cond_a & 0xff00, 0x6000, `event 90's step gates on the ordinal (${step90.cond_a})`);
assert.equal(step90.cond_b, 0xffff, "and has no second condition");

const PORT = Number(process.env.VERIFY_PORT ?? 8791);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const errors = [];

/** One clean boot of the lab, the console seeded, and the room's arrival scene paged out.
 *  A fresh boot per case is deliberate: the gondola's two halves live behind DIFFERENT cast
 *  records and their gates read flags a finished scene has already written, so sharing one
 *  session between cases would let an earlier case's on_close decide a later case's line. */
async function boot(mapId, ordinal, items, party) {
    const context = await browser.newContext({
        viewport: { width: 1100, height: 900 },
        storageState: {
            cookies: [],
            origins: [{
                origin: `http://localhost:${PORT}`,
                localStorage: [
                    { name: "engineSchema", value: "2" },
                    { name: "party", value: JSON.stringify(PARTY) },
                    { name: "charId", value: PARTY[0] },
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
    // The console carries no OnTalk story row, so releasing the bridge's talk for this session
    // changes nothing the console needs; a seeded lab boot leaves it busy after the opening.
    await frame.evaluate(() => {
        window.__engineBridge.onTalk = () => false;
        if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
    });
    await frame.waitForFunction(() => !window.__cutscene.isActive(), null, { timeout: 15000 });
    await frame.evaluate(async ([mapId, ordinal, items, party]) => {
        const press = (k) => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
            window.dispatchEvent(new KeyboardEvent("keyup", { key: k }));
        };
        window.__playedFlagKeys = [];
        const orig = window.__cutscene.start.bind(window.__cutscene);
        window.__cutscene.start = (...a) => { window.__playedFlagKeys.push(a[0]); return orig(...a); };
        window.__engine.state.vars.set("$story.ordinal", ordinal);
        // The card gate is bank 0x80 possession, read through ownsItem(state, id).
        for (const id of items) window.__engine.state.inventory.add(id);
        window.__engine.state.party.load({ members: party });
        const idx = window.__state.manifest.maps.findIndex((m) => m.id === mapId);
        window.__setMap(idx, { x: 200, y: 200 });
        for (let k = 0; k < 900; k++) {
            if (window.__fade.dir === 0 && !window.__textbox.isOpen() && !window.__cutscene.isActive()) {
                for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
                if (window.__fade.dir === 0 && !window.__textbox.isOpen() && !window.__cutscene.isActive()) break;
                continue;
            }
            press(" ");
            for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
        }
    }, [mapId, ordinal, items, party]);
    return { page, frame };
}

const evOf_ = evOf;
const shots = [];
const played = (frame) => frame.evaluate(() => window.__playedFlagKeys.map((d) => (d || []).slice(0, 2).join(" ")));
// The first scene of each routine is the one the launcher started; anything after it is the
// DESTINATION's own arrival chain, which fires on the fresh field load exactly as it does in
// the disc.
const ARRIVAL = new Map([["s415", [150, 151]], ["s440", [152]], ["s400", [1300]], ["s410", []]]);
const assertFirst = (stage, id, list, dest) => {
    const e = evOf_(stage, id);
    assert.equal(list[0], head(e), `the launcher must start event ${id} first (${JSON.stringify(list)})`);
    const arrival = new Set(ARRIVAL.get(dest).map((x) => head(evOf_(dest, x))));
    assert.deepEqual(list.slice(1).filter((h) => !arrival.has(h)), [],
        `only event ${id} may start here, besides ${dest}'s own arrival scene (${JSON.stringify(list)})`);
};

/** Stand in front of the console, press confirm, page the line and the scene to their ends. */
async function consoleRoutine(frame, stage) {
    const r = await frame.evaluate(async ([stage]) => {
        const st = window.__state;
        const n = window.__npcsHere().find((x) => x.npc_id === 63);
        if (!n) return { console: null };
        st.x = n.x; st.y = n.y + 24; st.dir = "up";
        for (let i = 0; i < 40 && window.__fade.dir !== 0; i++)
            await new Promise((r2) => requestAnimationFrame(r2));
        for (let i = 0; i < 10; i++) await new Promise((r2) => requestAnimationFrame(r2));
        const target = window.__talkTarget();
        const press = (k) => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
            window.dispatchEvent(new KeyboardEvent("keyup", { key: k }));
        };
        press(" ");
        for (let i = 0; i < 15; i++) await new Promise((r2) => requestAnimationFrame(r2));
        const opened = window.__textbox.isOpen() || window.__dialogueBox.isOpen();
        // Page the conversation and then the scene the launcher started. Confirm is pressed only
        // while a box or a cutscene is actually up, and the routine ends the moment the stage
        // changes, so nothing else in the new room is talked to.
        for (let k = 0; k < 900; k++) {
            if (window.__state.manifest.maps[window.__state.mapIdx].id !== stage) break;
            if (!window.__textbox.isOpen() && !window.__cutscene.isActive()
                && !window.__dialogueBox.isOpen()) {
                await new Promise((r2) => requestAnimationFrame(r2));
                continue;
            }
            press(" ");
            for (let i = 0; i < 6; i++) await new Promise((r2) => requestAnimationFrame(r2));
        }
        for (let i = 0; i < 60; i++) await new Promise((r2) => requestAnimationFrame(r2));
        return {
            opened,
            line: target?.state?.dialogue ?? null,
            map: window.__state.manifest.maps[window.__state.mapIdx].id,
            x: Math.round(st.x), y: Math.round(st.y),
        };
    }, [stage]);
    return r;
}


// The console is TWO cast records, and each one's spawn gate picks which half of the disc's
// gondola is in the room (web/assets/scenes/s410.json, records `real_5_5_463_328` and
// `real_5_5_463_328#1`):
//   record A  spawns at story step 0x6006 (= 6)   — the first-ride beat: the Blue Card opens the
//              ride (estalk06#810 → event 142), the corrupted one is refused (#740 → event 140),
//              and holding neither is met by #739 and nothing at all.
//   record B  spawns on 0x705c = "party has slot 2" — the steady state, where the console is a
//              plain door (#741 → event 143 → South Station).
// So each case below sets the ordinal AND the party, and both come from the records' own
// `spawn_flags`, not from a hand list.

// ── 1. the real Blue Card, first ride: the console takes you over the Bulbmon gondola (s415) ──
{
    const { page, frame } = await boot("s410", 6, [398], [1]);
    const r = await consoleRoutine(frame, "s410");
    assert.ok(r.opened, `the console must show its line (${JSON.stringify(r)})`);
    assert.deepEqual(r.line, { file: "estalk06", index: 810 }, "the Blue Card line");
    assertFirst("s410", 142, await played(frame), "s415");
    assert.equal(r.map, "s415", `the ride lands in the mid-ride map (got ${r.map} at ${r.x},${r.y})`);
    shots.push(await page.screenshot({ path: new URL("../.bunny-scratch/gondola-first-ride.png", import.meta.url).pathname }));
    await page.context().close();
}

// ── 2. the corrupted card: refused, and you stay in the station ──────────────────────────────
{
    const { page, frame } = await boot("s410", 6, [399], [1]);
    const r = await consoleRoutine(frame, "s410");
    assert.ok(r.opened, `the console must show its line (${JSON.stringify(r)})`);
    assert.deepEqual(r.line, { file: "estalk06", index: 740 }, "the corrupted-card line");
    assertFirst("s410", 140, await played(frame), "s410");
    assert.equal(r.map, "s410", "a refused ride leaves you where you were");
    await page.context().close();
}

// ── 3. steady state (party slot 2): the same console is a plain door into South Station ─────
{
    const { page, frame } = await boot("s410", 7, [398], [1, 2]);
    const r = await consoleRoutine(frame, "s410");
    assert.ok(r.opened, `the console must show its line (${JSON.stringify(r)})`);
    assert.deepEqual(r.line, { file: "estalk06", index: 741 }, "the steady-state line");
    assertFirst("s410", 143, await played(frame), "s440");
    assert.equal(r.map, "s440", `the steady-state ride lands in South Station (got ${r.map})`);
    await page.context().close();
}

// ── 4. the way back: the South Station console returns you to East Station (s410) ────────────
{
    const { page, frame } = await boot("s440", 7, [398], [1]);
    const r = await consoleRoutine(frame, "s440");
    assert.ok(r.opened, `the South Station console must show its line (${JSON.stringify(r)})`);
    assert.deepEqual(r.line, { file: "estalk06", index: 811 }, "the return line");
    assertFirst("s440", 144, await played(frame), "s410");   // the return ride is the s440 record
    assert.equal(r.map, "s410", `the return ride lands in East Station (got ${r.map})`);
    shots.push(await page.screenshot({ path: new URL("../.bunny-scratch/gondola-return.png", import.meta.url).pathname }));
    await page.context().close();
}

// ── 5. no card at all: the stage's own position step walks you to the console and sends you ──
//      back out (event 90, an op-8 step record — not a row, not an exit trigger) ────────────────
{
    const { page, frame } = await boot("s410", STEP_ORDINAL, [], [1]);
    // The step grid's cell size is the extractor's own `cell` field (engine/systems/
    // trigger-system.ts sampleStepByte), not a guessed tile width. The first live cell is the
    // one the stage uses for its event-90 record: byte 1 = step 1 = the op-8 record (90).
    const grid = (await load("assets/data/story_trigger_grids.json")).stages["410"];
    const byte = 1;
    assert.ok(grid.grid.includes(byte), `s410's grid carries byte ${byte} (step ${byte & 0x1f})`);
    const cell = grid.grid.indexOf(byte);
    const tileX = (cell % grid.w) * grid.cell + Math.floor(grid.cell / 2);
    const tileY = Math.floor(cell / grid.w) * grid.cell + Math.floor(grid.cell / 2);
    assert.equal((stepRecordAt(grid, byte) ?? null)?.params[0], 90,
        "that byte selects the op-8 record naming event 90");
    const r = await frame.evaluate(async ([x, y]) => {
        const st = window.__state;
        st.x = x; st.y = y;
        for (let k = 0; k < 900; k++) {
            if (window.__state.manifest.maps[window.__state.mapIdx].id !== "s410") break;
            if (!window.__textbox.isOpen() && !window.__cutscene.isActive()
                && !window.__dialogueBox.isOpen()) {
                await new Promise((r2) => requestAnimationFrame(r2));
                continue;
            }
            window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
            window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
            for (let i = 0; i < 6; i++) await new Promise((r2) => requestAnimationFrame(r2));
        }
        for (let i = 0; i < 60; i++) await new Promise((r2) => requestAnimationFrame(r2));
        return {
            map: window.__state.manifest.maps[window.__state.mapIdx].id,
            played: window.__playedFlagKeys.map((d) => (d || []).slice(0, 2).join(" ")),
        };
    }, [tileX, tileY]);
    assertFirst("s410", 90, r.played, "s400");
    assert.equal(r.map, "s400", `no card puts you back outside the station (got ${r.map})`);
    shots.push(await page.screenshot({ path: new URL("../.bunny-scratch/gondola-no-card.png", import.meta.url).pathname }));
    await page.context().close();
}

assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
console.log(`gondola console: all five branches pass (${shots.length} captures)`);
await browser.close();
