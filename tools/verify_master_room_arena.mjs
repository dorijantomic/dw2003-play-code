// Headless check for the Master Room (s305) arena champions' post-fight scene, driven
// through the REAL web/game.js in the web/ui-lab.html harness (no mock renderer).
//
// Decode: wstag305.s event 1450 (event-table record at file 0x39c0: `WAIT 60 /
// HANDOFF 536 312 285 5`), the bank-0x90 launcher
// (docs/research/scripting/talk-event-launcher-bank90-2026-07-28.md, events[97] = 1450),
// and the champions' own on_close flag lists in web/assets/scenes/s305.json.
//
// What a player meets: in the Master Room there are seven invisible arena champions. Beat one
// and talk to it, and it says one line; when that box closes the game pauses a beat and puts you
// back in the middle of the room — event 1450. This asserts the scene that closes the champion's
// line is 1450 and NOT its neighbour 965 ("walk down and leave to s310"), which carries the same
// flag_key 012e000a and used to win the id-less lookup in playTalkEvent.
//
// Run with a web server on this worktree's port:
//   python3 -m http.server 8790 --directory web
//   VERIFY_PORT=8790 tools/run-playwright.sh tools/verify_master_room_arena.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) => JSON.parse(await readFile(new URL(`../web/${p}`, import.meta.url)));
const LAUNCH = await load("assets/data/talk_event_launches.json");
const EVENTS = (await load("assets/events/wstag_events.json")).s305;
const SCENE = await load("assets/scenes/s305.json");

const STAGE = "s305";
const ORDINAL = 22;            // the Master Room beat the champions spawn on (spawn flag 0x6016)
const LAUNCH_BIT = 97;         // talk_event_launches.json -> event 1450
const CHAMPION = SCENE.npcs.find((n) =>
    (n.dialogue_states || []).some((s) => (s.on_close || []).some((c) => (c.id & 0xff00) === 0x9000)));
assert.equal(LAUNCH.events[LAUNCH_BIT], 1450, "bit 97 is event 1450");
assert.ok(CHAMPION, "the Master Room has an arena champion that writes bank 0x90 on_close");

// The two records the launcher must be told apart by ID: same flag_key, different scenes.
const EV965 = EVENTS.find((e) => e.id === 965);
const EV1450 = EVENTS.find((e) => e.id === 1450);
assert.equal(EV965.flag_key, EV1450.flag_key,
    "the premise: 965 and 1450 share flag_key, so an id-less lookup cannot tell them apart");
assert.equal(EV1450.handoff_to, STAGE, "event 1450 is the scene that puts you back in the room");
assert.equal(EV965.handoff_to, "s310", "event 965 is the one that walks you out of the room");

const PORT = Number(process.env.VERIFY_PORT ?? 8790);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
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

// Same harness caveat verify_talk_event.mjs states: a seeded lab boot leaves the story bridge
// busy after the Asuka opening, and a busy bridge eats every onTalk. Released for this session
// only; the champions carry no OnTalk story row, so nothing else is bypassed.
await frame.evaluate(() => {
    window.__engineBridge.onTalk = () => false;
    if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
});
await frame.waitForFunction(() => !window.__cutscene.isActive(), null, { timeout: 15000 });

await frame.evaluate(() => {
    window.__playedFlagKeys = [];
    const orig = window.__cutscene.start.bind(window.__cutscene);
    window.__cutscene.start = (...a) => { window.__playedFlagKeys.push(a[0]); return orig(...a); };
});

// Arm the gauntlet the way the original's own flags do: the champion's counter bit (flag 0) and
// the six OTHER champions' beaten flags (0x1c28..0x1c33) set, its own (0x1c27) still clear. That
// is exactly the state whose dialogue is estalk05#189 — the line the on_close that launches
// bit 97 hangs off.
const championBeat = CHAMPION.dialogue_states.findIndex((s) =>
    (s.on_close || []).some((c) => (c.id & 0xff00) === 0x9000));
const state = CHAMPION.dialogue_states[championBeat];
// Arm it from the state's OWN gate, not from guessed numbers: the champion's counter bit (the
// bank-0x00 leaf), its own 0x1c beaten flag (the leaf expecting 0), and the other six beaten
// flags, which is what 0x7071 (>=1 set) and 0x7070 (>=2 clear) then read.
const BEATEN = [7207, 7208, 7209, 7210, 7211, 7212, 7213];   // 0x1c27..0x1c33, the tally bank
const counter = state.gate.find((g) => g.id < 0x100 && g.expected === 1)?.id;
const mine = state.gate.find((g) => (g.id >> 8) === 0x1c && g.expected === 0)?.id;
assert.ok(counter !== undefined && mine !== undefined, `the gate names its bits: ${JSON.stringify(state.gate)}`);
const arm = [[counter, 1], ...BEATEN.filter((f) => f !== mine).map((f) => [f, 1])];

await frame.evaluate(async ([ordinal, sets, mapId]) => {
    const st = window.__state;
    window.__engine.state.vars.set("$story.ordinal", ordinal);
    for (const [id, v] of sets) window.__storyFlags.set(id, v);
    const idx = st.manifest.maps.findIndex((m) => m.id === mapId);
    window.__setMap(idx, { x: 300, y: 300 });
    for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
}, [ORDINAL, arm, STAGE]);

const where = () => frame.evaluate(() => ({
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
    x: Math.round(window.__state.x), y: Math.round(window.__state.y),
}));
assert.equal((await where()).map, STAGE, "the harness is standing in the Master Room");

// Stand below the champion, face it, press confirm, and page through its line to its close —
// which is where the on_close write, and therefore the launch, runs.
const before = await frame.evaluate(async ([x, y]) => {
    const st = window.__state;
    st.x = x; st.y = y + 20; st.dir = "up";
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    const press = (k) => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: k }));
    };
    press(" ");
    for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
    const opened = window.__textbox.isOpen();
    for (let i = 0; i < 60 && window.__textbox.isOpen(); i++) {
        press(" ");
        await new Promise((r) => requestAnimationFrame(r));
    }
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    return { opened, inCutscene: window.__cutscene.isActive() };
}, [CHAMPION.x, CHAMPION.y]);
assert.ok(before.opened, `talking to the champion must show its line (${JSON.stringify(before)})`);

// Let whatever the launcher started run to its end.
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
    const idle = await frame.evaluate(async () => {
        for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
        return !window.__cutscene.isActive();
    });
    if (idle) break;
}

const played = await frame.evaluate(() => window.__playedFlagKeys);
const after = await where();
await page.screenshot({ path: new URL("../.bunny-scratch/arena-after.png", import.meta.url).pathname });

// Both records are keyed 012e000a, so the only thing that tells them apart is the bytecode the
// cutscene is handed. Assert that it is 1450's: `WAIT 60 / HANDOFF 536 312 285 5`.
assert.equal(played.length, 1, `closing the champion's line starts exactly one scene (${JSON.stringify(played)})`);
assert.deepEqual(played[0], EV1450.disasm,
    `the scene must be event 1450 (${EV1450.disasm.join(" ")}); ` +
    `event 965 would have played ${EV965.disasm.join(" ")} and walked you out to ${EV965.handoff_to}`);
assert.notDeepEqual(played[0], EV965.disasm);
assert.equal(after.map, STAGE, `event 1450 stays in the Master Room; ended on ${after.map}`);
assert.deepEqual(errors, [], "no page errors");
console.log(`OK — Master Room: the beaten champion's line plays event 1450 ` +
    `(${played[0].join(" ")}) and leaves you on ${after.map}; event 965 would have played ` +
    `${EV965.disasm.join(" ")}`);
await browser.close();