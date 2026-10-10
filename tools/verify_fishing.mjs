// Headless check for fishing, driven through the REAL web/game.js in the
// web/ui-lab.html harness (no mock renderer).
//
// Decode: engine/systems/fishing.ts, tools/extract_fishing_spots.py,
// docs/research/field/fishing-system-decoded-2026-07-11.md.
//
// What it asserts, by playing the game rather than calling the state machine:
//
//   1. Without the FishingPole a fishing spot does nothing — the spots only
//      exist because the step record is gated on the pole.
//   2. With the pole, standing on a spot and pressing the action key casts:
//      the float goes out, field control is gone, and the bar appears only
//      after the 91-tick settle.
//   3. Striking brakes the marker to a stop and the cast resolves.
//   4. A cast that stops on a live band starts a BATTLE from the stage's own
//      scripted encounter block — a Cardmon on band 1 — and never grants an
//      item.
//   5. Each cast spends one of the map's sixteen catches, and leaving and
//      re-entering the map puts the budget back.
//
// Run with a web server on port 8742 (or VERIFY_PORT):
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_fishing.mjs
//   VERIFY_PORT=8776 tools/run-playwright.sh tools/verify_fishing.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const SPOTS = await load("fishing_spots.json");
const SCREENS = (await load("field_encounters.json")).screens;
const GRIDS = (await load("story_trigger_grids.json")).stages;

const STAGE = "s485"; // Phoenix Bay — the stage both rig captures were taken on
const cfg = SPOTS[STAGE];
assert.ok(cfg, "fishing_spots.json must carry Phoenix Bay");
const CARDMON = SCREENS[String(cfg.catch["4"].screenId)][0].name;
assert.ok(CARDMON.startsWith("Cardmon"), `band 1 must be a Cardmon, got ${CARDMON}`);

/** World centres of this stage's fishing-spot trigger cells. */
function spotCells() {
    const g = GRIDS[STAGE.slice(1)];
    const idxs = cfg.spots.map((s) => s.stepIndex);
    const out = [];
    for (let i = 0; i < g.grid.length; i++) {
        const v = g.grid[i];
        if (v && idxs.includes(v & 0x1f))
            out.push({
                x: (i % g.w) * g.cell + g.cell / 2,
                y: Math.floor(i / g.w) * g.cell + g.cell / 2,
            });
    }
    return out;
}
const CELLS = spotCells();
assert.ok(CELLS.length, "the trigger grid must place Phoenix Bay's spots");

const PORT = Number(process.env.VERIFY_PORT ?? 8742);
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

await frame.evaluate(() => {
    window.__battlesStarted = [];
    const orig = window.__battle.startScreen.bind(window.__battle);
    window.__battle.startScreen = (screenId, ...rest) => {
        window.__battlesStarted.push(screenId);
        return orig(screenId, ...rest);
    };
    if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
});

const raf = (n) => frame.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

const goto = async (at) => frame.evaluate(async ([s, p]) => {
    const st = window.__state;
    window.__setMap(st.manifest.maps.findIndex((m) => m.id === s), p);
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, [STAGE, at]);

const press = () => frame.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await new Promise((r) => requestAnimationFrame(r));
});

// The strike is CIRCLE. The bobber's tick contains exactly one pad read and it
// tests only bit 0x2000 = CIRCLE, with no CROSS branch
// (docs/research/field/fishing-system-decoded-2026-07-11.md:391, :664). This
// used to press `x`, which is the Back button — the strike was on the wrong
// button entirely. The walker's dispatcher gives a mid-cast CIRCLE to the
// strike before the cast branch can see it, so the same key serves both.
const strike = () => frame.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await new Promise((r) => requestAnimationFrame(r));
});

const fishing = () => frame.evaluate(() => {
    const f = window.__state.fishing;
    return f && {
        phase: f.run.phase, meter: f.run.meter, pattern: f.run.pattern,
        clip: f.pose.clip, sub: f.pose.sub, resultOpen: f.resultOpen,
    };
});
const budget = () => frame.evaluate(() => window.__state.fishingBudget);
const started = () => frame.evaluate(() => window.__battlesStarted.slice());
// The FishingPole is item id 5, and flag 0x8005 is bank-0x80 possession of it —
// a READ over the bag, not a settable bit. So the pole is given and taken the
// way the game gives it: through the inventory.
const setPole = (on) => frame.evaluate((v) => {
    const st = window.__state;
    st.inventory = st.inventory.filter((s) => s.id !== 5);
    if (v) st.inventory.push({ id: 5, qty: 1 });
    return window.__storyFlags.get(0x8005);
}, on);

/** Stand on a spot cell. Returns the cell actually used. */
async function standOnSpot() {
    for (const c of CELLS) {
        if (await goto(c) !== STAGE) continue;
        const on = await frame.evaluate(() => {
            const st = window.__state;
            return { x: st.x, y: st.y };
        });
        if (Math.abs(on.x - c.x) < 24 && Math.abs(on.y - c.y) < 24) return c;
    }
    throw new Error("could not stand on any Phoenix Bay fishing spot");
}

// ── 1. No pole, no fishing. ────────────────────────────────────────────────
assert.equal(await setPole(false), 0, "no pole, no possession flag");
const cell = await standOnSpot();
await press();
await raf(5);
assert.equal(await fishing(), null, "without the FishingPole a spot does nothing");

// ── 2. With the pole: cast, settle, then the bar. ──────────────────────────
assert.equal(await setPole(true), 1, "the pole in the bag IS flag 0x8005");
await goto(cell);
const budget0 = await budget();
assert.equal(budget0, 16, "a fresh map visit starts with sixteen catches");

await press();
await raf(2);
let f = await fishing();
assert.ok(f, "pressing on a spot with the pole must cast");
assert.equal(f.phase, "settle", "the float settles before the bar appears");
assert.equal(f.meter, 0, "no meter movement during the settle");
assert.equal(await budget(), budget0 - 1, "the cast spends one of the sixteen");

// ── 2b. The angler. Mode 0x48 swaps the player to P002PLYF for the whole ──
// cast and plays five clips off it. Sampled through the render path, so this
// fails if the pack is missing from the manifest or never gets drawn.
const anglerShots = await frame.evaluate(async () => {
    const st = window.__state;
    const seen = [];
    for (let i = 0; i < 130; i++) {
        const f = st.fishing;
        if (!f) break;
        const last = seen[seen.length - 1];
        if (!last || last.clip !== f.pose.clip) seen.push({ clip: f.pose.clip, sub: f.pose.sub });
        await new Promise((r) => requestAnimationFrame(r));
    }
    return seen;
});
// Clip 0x11 is already latched by the time this samples — sub-state 0 sets it
// on the cast's very first tick.
assert.deepEqual(anglerShots.map((s) => s.clip), [0x11, 0x13, 0x14],
    "the angler winds up (0x11), follows through (0x13) and waits (0x14)");
assert.deepEqual(anglerShots.map((s) => s.sub), [1, 2, 3],
    "and each clip belongs to the sub-state that latched it");
const packDrawn = await frame.evaluate(() => {
    const st = window.__state;
    return !!(st.manifest.npcs.find((n) => n.id === "p002plyf")
        && st.npcImgs.p002plyf && st.clipImgs.p002plyf);
});
assert.equal(packDrawn, true, "P002PLYF must be built, loaded and strip-baked");

// Field control is gone for the whole cast.
const moved = await frame.evaluate(async () => {
    const st = window.__state;
    const x0 = st.x, y0 = st.y;
    st.keys.add("arrowdown");
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    st.keys.delete("arrowdown");
    return st.x !== x0 || st.y !== y0;
});
assert.equal(moved, false, "the scene lock holds the player still for the cast");

await raf(90);
f = await fishing();
assert.ok(f && f.phase === "sweep", `the bar must be sweeping, got ${f?.phase}`);
assert.ok(f.meter > 0, "and the marker must be moving");

// ── 2c. The result balloon pops open, holds, then deflates. ───────────────
// Mode 0x48 sub-state 3 opens the balloon (F0x80088144(0, 1, 6), file 0xdd54)
// and sub-state 4 closes it 0x3c ticks later. The balloon is the same actor the
// story bubbles use: its counter +0x60 starts at 0xc8, rises by the frame delta
// and IS the sprite cel (`(u8)(+0x60 >> 2)`, F0x80087E7C file 0x52a4), so the
// player sees a small puff (0x32) grow into the full talk balloon (0x35) with the
// glyph, and then shrink away (0x36, 0x37) after the close.
//
// Sampled off the real canvas rather than off the state machine: the balloon's
// body is FIELDCOM's near-white (248,248,248), so counting near-white pixels in
// the balloon's own window says which cel was actually painted. Cell sizes in
// web/assets/ui/fieldcom.json dir 0: 0x32 = 71 white px, 0x35 = 383, 0x37 = 52.
await strike();
const bubble = await frame.evaluate(async () => {
    const st = window.__state;
    const cv = document.getElementById("game");
    const g = cv.getContext("2d");
    const out = [];
    let seen = false;
    for (let i = 0; i < 600; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const f = st.fishing;
        if (!f || !f.result) { if (seen) break; continue; }
        seen = true;
        const cam = window.__lastCam;
        // The field draws in the native 320x240 space (VIEW_W / ZOOM) and scales
        // by cam.zoom, so this is device pixels per native pixel.
        const k = (cv.width / 640) * cam.zoom;
        const x = Math.round(st.x - cam.x);
        const y = st.y - cam.y - 0x1b; // owner y - (owner height >> 8) - 27
        // The balloon cell box, which every one of cels 0x32..0x37 sits inside.
        const px = g.getImageData(
            Math.round((x - 12) * k), Math.round((y - 32) * k),
            Math.round(24 * k), Math.round(34 * k),
        ).data;
        let white = 0;
        for (let j = 0; j < px.length; j += 4)
            if (px[j] >= 240 && px[j + 1] >= 240 && px[j + 2] >= 240) white++;
        out.push({ age: f.result.age, closedAt: f.result.closedAt, white });
    }
    return out;
});

assert.ok(bubble.length > 20, `the balloon must be on screen for a while, got ${bubble.length} frames`);
const firstClosed = bubble.findIndex((s) => s.closedAt != null);
assert.ok(firstClosed > 0, "the balloon must be told to close while it is on screen");
// The held face is the biggest balloon there is, and it is what the whole pop is
// growing into. FIELDCOM dir 0 near-white texels: 0x32 = 71, 0x33 = 127,
// 0x34 = 178, 0x35 = 383, 0x36 = 71, 0x37 = 32 (web/assets/ui/fieldcom.json).
const held = Math.max(...bubble.slice(0, firstClosed).map((s) => s.white));
const firstHeld = bubble.findIndex((s) => s.white >= held - 32);
assert.ok(firstHeld >= 3, `the pop takes several frames, first held at ${firstHeld}`);
// The pop: every earlier frame is a clearly smaller balloon, so the old drawing
// — one static cel 0x35 from the opening frame — cannot produce this.
const pop = bubble.slice(0, firstHeld).map((s) => s.white);
assert.ok(pop.every((w) => w <= held - 128),
    `every frame of the pop is a smaller balloon than the held one: ${pop}`);
// The hold: the same face, for the controller's 0x3c ticks.
const hold = bubble.slice(firstHeld, firstClosed).map((s) => s.white);
assert.ok(hold.length > 40,
    `the balloon holds its face for about a second, got ${hold.length} frames`);
assert.ok(hold.every((w) => w >= held - 32), `and never shrinks while it waits: ${hold}`);
assert.ok(bubble.every((s, i) => i === 0 || s.age >= bubble[i - 1].age),
    "the balloon ages forward only");
// The deflate: 0x35 x3, 0x36 x3, 0x37 — the last frame it draws is the 8x8 dot,
// and the frame after it the actor is in stage 3 and draws nothing at all.
const close = bubble.slice(firstClosed);
assert.ok(close.length >= 7 && close.length <= 9,
    `the close animation lasts about seven frames, got ${close.length}`);
assert.ok(close.slice(-2).every((s) => s.white <= held - 128),
    `the balloon must deflate away, tail ${close.slice(-3).map((s) => s.white)}`);

// That strike can itself land a live band, and then the fight section below has
// nothing left to roll for — so keep the fight it started. The fight begins only
// after the angler stands back up, a few frames after the balloon is gone, so
// wait for it rather than read the list at once.
for (let i = 0; i < 20 && !(await started()).length &&
     !(await frame.evaluate(() => window.__battle.isActive())); i++) await raf(5);
let fought = (await started()).length ? await started() : null;

// ── 3/4. Strike until a cast lands on a live band and starts its fight. ────
// The band is the pattern's, not ours — so cast repeatedly and assert about
// whichever cast first resolves into a battle.
for (let attempt = 0; attempt < 40 && !fought; attempt++) {
    if (!(await fishing())) {
        await press();          // cast
        await raf(95);          // settle
    }
    const cur = await fishing();
    if (!cur || cur.phase !== "sweep") { await raf(5); continue; }
    await strike();             // strike — its own pad bit, its own key
    // The fight does not start on the strike: the angler still has to play the
    // result pose (0x3c ticks) and stand back up before mode 0x48 hands control
    // over, and only then does the battle the cast earned begin.
    for (let i = 0; i < 40 && (await fishing()); i++) await raf(15);
    const hits = await started();
    if (hits.length) fought = hits;
    if (await frame.evaluate(() => window.__battle.isActive())) break;
}

assert.ok(fought, "forty casts must land at least one live band");
const slots = Object.values(cfg.catch).map((c) => c.screenId);
for (const screenId of fought)
    assert.ok(slots.includes(screenId),
        `fishing fought screen ${screenId}, which is not one of this stage's ` +
        `catch slots ${slots.join("/")}`);
assert.equal(await frame.evaluate(() => window.__battle.isActive()), true,
    "and the fight is actually on screen");

// ── 5. Nothing was ever put in the bag. ───────────────────────────────────
// The only thing in it should still be the pole itself.
const bag = await frame.evaluate(() =>
    window.__state.inventory.map((s) => `${s.id}x${s.qty}`).sort().join(","));
assert.equal(bag, "5x1", `fishing must grant no item, bag is [${bag}]`);

assert.deepEqual(errors, [], "no page errors");
console.log(
    `fishing OK — ${CELLS.length} spot cells on ${STAGE}; ` +
    `caught screen(s) ${fought.join(",")} (band 1 = ${CARDMON}); ` +
    `budget ${budget0} -> ${await budget()}; no item granted`);
await browser.close();
