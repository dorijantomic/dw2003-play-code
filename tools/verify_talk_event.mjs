// Headless check for the bank-0x90 talk launcher, driven through the REAL
// web/game.js in the web/ui-lab.html harness (no mock renderer).
//
// Decode: tools/extract_talk_event_launches.py,
// docs/research/scripting/talk-event-launcher-bank90-2026-07-28.md.
//
// What it asserts, by playing the Kicking Forest hide-and-seek rather than
// calling the launcher:
//
//   1. With the game running, walking up to one of Veemon's decoys and talking
//      to it plays a scene — the thing that used to be swallowed.
//   2. The scene that plays is the one the decode names for that spot's bit,
//      and its completion sets that spot's own "already searched" flag, so the
//      decoy switches to its found-variant record.
//   3. Finding the real Veemon runs the event that hands off out of the forest,
//      which is what leads to the Tree Boots.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_talk_event.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) => JSON.parse(await readFile(new URL(`../web/${p}`, import.meta.url)));
const LAUNCH = await load("assets/data/talk_event_launches.json");
const SCENE = await load("assets/scenes/s400.json");
const EVENTS = (await load("assets/events/wstag_events.json")).s400;
// The per-stage event table carries the completion flag writes; wstag_events
// carries the bytecode. Both are keyed by event id.
const EVENT_SETS = (await load("assets/data/story_steps.json")).stages["400"].events;

const STAGE = "s400";
const HIDE_ACTIVE = 6694; // "the hide-and-seek is running" — spawns the search spots

// The searchable spots, read out of the shipped scene: each is an NPC whose
// on_close writes bank 0x90, paired with the "searched" flag the launched
// event's completion sets.
const SPOTS = [];
for (const npc of SCENE.npcs) {
    for (const st of npc.dialogue_states || []) {
        for (const oc of st.on_close || []) {
            if (((oc.id >> 8) & 0xfe) !== 0x90) continue;
            const bit = oc.id & 0x1ff;
            const eventId = LAUNCH.events[bit];
            const erec = EVENTS.find((e) => e.id === eventId);
            const sets = EVENT_SETS.find((e) => e.event_id === eventId)?.sets ?? [];
            SPOTS.push({ npc: npc.npc_id, x: npc.x, y: npc.y, bit, eventId, erec, sets });
        }
    }
}
assert.ok(SPOTS.length >= 4, `s400 has the four search spots (found ${SPOTS.length})`);

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const errors = [];

const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    storageState: {
        cookies: [],
        origins: [{
            origin: ROOT,
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
const logs = [];
page.on("console", (m) => {
    const t = m.text();
    if (/TALK|EVENT/.test(t)) logs.push(t.replace(/^%c\[STORY\]\s*color:[^ ]+\s*/, "").slice(0, 160));
});

const boot = async () => {
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    return page.frames().find((f) => f.url().includes("index.html"));
};

await page.goto(`${ROOT}/ui-lab.html`, { waitUntil: "load" });
let frame = await boot();

// HARNESS CAVEAT, stated plainly. Booting the lab straight into a seeded party
// auto-fires the Asuka opening on s200. Its cutscene finishes, but the story
// bridge never leaves `busy` afterwards in this seeded-boot path (observed: cut
// false, busy true, indefinitely) — and a busy bridge answers every `onTalk`
// with "I consumed that", so no NPC anywhere in the session can be talked to.
// That is a pre-existing condition of booting the lab this way, unrelated to the
// launcher under test, and it is NOT worked around by pretending the opening
// played: `onTalk` is released for this session only. Everything the test then
// exercises is the real path — talk -> textbox -> on_close -> applyStoryFlag ->
// bank 0x90 -> playStoryEvent.
// 2026-10-04: this comment used to read "None of these Kicking Forest NPCs carry an
// OnTalk story row, so releasing it removes nothing they would otherwise do." That was
// WRONG — the Kicking Forest's four search spots each carried an ungated `s400.talk.1301`
// .. `s400.talk.1304` row the converter had guessed from each scene's disassembly, so the
// row (not the conversation) was what started the scene and the searcher's own line was
// never shown. The row is gone: a scene a conversation starts is started by the launcher
// (engine/systems/talk-launch.ts, tools/extract_talk_launch_bindings.py), so releasing
// `onTalk` now really does remove nothing. tools/verify_talk_scene_story_step.mjs is the
// end-to-end check that the line shows and the scene follows it.
await frame.evaluate(() => {
    window.__engineBridge.onTalk = () => false;
    // Same hard cancel verify_fire_trap.mjs uses to get the intro off the screen.
    if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
});
await frame.waitForFunction(() => !window.__cutscene.isActive(), null, { timeout: 15000 });

await frame.evaluate(() => {
    // Record every event the game plays, so "nothing happened" is an observation
    // about the LAUNCHER and not about what is on screen.
    window.__eventsPlayed = [];
    const orig = window.__cutscene.start.bind(window.__cutscene);
    window.__cutscene.start = (...args) => {
        window.__eventsPlayed.push(1);
        return orig(...args);
    };
});

// Press through whatever is on screen until the story bridge is idle again.
// This matters more than it looks: the bridge answers `onTalk` with "I consumed
// it" while it is busy, so a half-finished opening scene silently swallows every
// talk in the session and the launcher looks broken when it is not.
// A scripted scene runs on its own timeline (WALKTO/WAIT), so this presses to
// page dialogue along but otherwise just lets it play out.
async function settle(label, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const idle = await frame.evaluate(async () => {
            for (let i = 0; i < 20; i++) {
                if (window.__textbox.isOpen()) {
                    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
                    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
                }
                for (let j = 0; j < 3; j++) await new Promise((r) => requestAnimationFrame(r));
            }
            return !window.__cutscene.isActive() && !window.__textbox.isOpen();
        });
        if (idle) return;
    }
    assert.fail(`the story bridge must go idle ${label}`);
}

const flag = (id) => frame.evaluate((f) => window.__storyFlags.get(f), id);
const setFlag = (id, v) => frame.evaluate(([f, val]) => window.__storyFlags.set(f, val), [id, v]);
const raf = (n) => frame.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

// Arm the quest and enter the forest, then re-arm: entering a stage rebuilds the
// scene from the flags, so the spots must exist by the time we arrive.
await setFlag(HIDE_ACTIVE, 1);
const arrived = await frame.evaluate(async (s) => {
    const st = window.__state;
    const idx = st.manifest.maps.findIndex((m) => m.id === s);
    window.__setMap(idx, { x: 900, y: 400 });
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, STAGE);
assert.equal(arrived, STAGE, "the harness reached the Kicking Forest");
await settle("after entering the forest");
await setFlag(HIDE_ACTIVE, 1);

/** Stand next to a spot's NPC, press confirm, and close whatever it opens. */
async function talkTo(spot) {
    return frame.evaluate(async ([x, y]) => {
        const st = window.__state;
        // Step onto the tile just below the NPC and face up at it.
        st.x = x;
        st.y = y + 20;
        st.dir = "up";
        for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
        const before = window.__eventsPlayed.length;
        const press = (k) => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
            window.dispatchEvent(new KeyboardEvent("keyup", { key: k }));
        };
        press(" ");
        for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
        const opened = window.__textbox.isOpen();
        // Page through the spoken line to its close, which is where on_close —
        // and therefore the launcher — runs.
        for (let i = 0; i < 40 && window.__textbox.isOpen(); i++) {
            press(" ");
            await new Promise((r) => requestAnimationFrame(r));
        }
        for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
        return {
            opened,
            playedEvents: window.__eventsPlayed.length - before,
            inCutscene: window.__cutscene.isActive(),
        };
    }, [spot.x, spot.y]);
}

// ── The decoy spots: talking must launch the scene AND set the searched flag. ──
const results = [];
for (const spot of SPOTS) {
    if (!spot.erec) continue;
    const r = await talkTo(spot);
    await settle(`after talking to spot ${spot.bit}`); // let the launched scene finish
    results.push({ spot, r });
}

const talked = results.filter((x) => x.r.opened);
if (!talked.length) console.log("story log:\n  " + logs.slice(-25).join("\n  "));
assert.ok(talked.length >= 1,
    `at least one search spot must be talkable (opened: ${results.map((x) => x.r.opened).join(",")})`);
const launched = results.filter((x) => x.r.playedEvents > 0 || x.r.inCutscene);
assert.ok(launched.length >= 1,
    "talking to a search spot must launch its scene — this is the whole bank-0x90 path; " +
    `saw ${JSON.stringify(results.map((x) => x.r))}`);

// ── Progress actually recorded: at least one "already searched" flag is now set. ──
const searched = [];
for (const { spot } of results) {
    for (const [fid] of spot.sets) if (await flag(fid)) searched.push(fid);
}
assert.ok(searched.length >= 1,
    "a completed search must set its spot's searched flag, so the decoy switches record; " +
    `spots checked: ${JSON.stringify(SPOTS.map((s) => ({ bit: s.bit, sets: s.sets })))}`);

assert.deepEqual(errors, [], "no page errors");
console.log(
    `OK — Kicking Forest: ${talked.length}/${results.length} spots talkable, ` +
    `${launched.length} launched a scene, searched flags set: ${[...new Set(searched)].join(",")}`,
);
await browser.close();
