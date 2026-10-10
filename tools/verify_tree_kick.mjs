// Headless check for TreeBoots tree-kicking, driven through the REAL
// web/game.js in the web/ui-lab.html harness (no mock renderer).
//
// Decode: engine/systems/tree-kick.ts, tools/extract_tree_kick.py,
// docs/research/field/tree-boots-kicking-decoded-2026-07-29.md.
//
// What it asserts, by playing the game rather than calling the state machine:
//
//   1. Without the TreeBoots a tree does nothing — flag 0x8004 gates the kick.
//   2. With the boots, facing a tree and pressing the action key kicks it: the
//      tree's own point sprite leaves its resting cell 0x38 and Junior's kick
//      cells play while his input is held.
//   3. Kicking a DEAD tree puts the radar card up and starts no fight, and the
//      card's ring colour is the decoded distance band to the live tree.
//   4. Kicking the LIVE tree starts a fight from this stage's own scripted
//      encounter block (slot 3 or 6) and moves the live marker somewhere else.
//   5. The live tree survives a return to the same map and is re-rolled on a
//      different one.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_tree_kick.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const STAGES = await load("tree_kick.json");
const SCREENS = (await load("field_encounters.json")).screens;

const STAGE = "s485";      // Phoenix Bay — the stage the rig capture was taken on
const OTHER = "s480";      // Jungle Grave — another tree stage, for the re-roll
const cfg = STAGES[STAGE];
assert.ok(cfg, "tree_kick.json must carry Phoenix Bay");
assert.equal(cfg.trees.length, 16, "the capture counted sixteen trees");
const SLOT_SCREENS = Object.values(cfg.encounters).map((e) => e.screenId);
const NEAR = SCREENS[String(cfg.encounters["3"].screenId)][0].name;
assert.ok(NEAR.startsWith("Cardmon"), `slot 3 must be a Cardmon, got ${NEAR}`);

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
await page.goto(`${ROOT}/ui-lab.html`, { waitUntil: "load" });
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

const press = () => frame.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await new Promise((r) => requestAnimationFrame(r));
});

const goToStage = (stage) => frame.evaluate(async (s) => {
    const st = window.__state;
    window.__setMap(st.manifest.maps.findIndex((m) => m.id === s));
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, stage);

/** Stand 16px below tree `i` facing up — the capture's own approach. */
const standAtTree = (i) => frame.evaluate(async (k) => {
    const st = window.__state;
    const t = st.treeStages[st.manifest.maps[st.mapIdx].id].trees[k];
    st.x = t.x;
    st.y = t.y + 16;
    st.dir = "up";
    st.treeRadar = null;
    for (let f = 0; f < 3; f++) await new Promise((r) => requestAnimationFrame(r));
    return { x: st.x, y: st.y };
}, i);

const kickState = () => frame.evaluate(() => {
    const st = window.__state;
    return {
        kicking: !!st.treeKick,
        index: st.treeKick?.run.index ?? null,
        treeSprite: st.treeKick
            ? st.treeKick.run.shake.sprite : null,
        kickCell: st.treeKick?.run.kick?.sprite ?? null,
        radar: st.treeRadar ? { ...st.treeRadar } : null,
        live: st.treeLive ? { ...st.treeLive } : null,
        battles: window.__battlesStarted.slice(),
    };
});

// The TreeBoots are item id 4, and flag 0x8004 is bank-0x80 possession of them
// — a READ over the bag, not a settable bit. So they are given the way the game
// gives them: through the inventory.
const setBoots = (on) => frame.evaluate((v) => {
    const st = window.__state;
    st.inventory = st.inventory.filter((s) => s.id !== 4);
    if (v) st.inventory.push({ id: 4, qty: 1 });
    return window.__storyFlags.get(0x8004);
}, on);

const setLive = (i) => frame.evaluate((k) => {
    const st = window.__state;
    st.treeLive = { stage: st.manifest.maps[st.mapIdx].id, index: k };
}, i);

// ── 1. No boots, no kick. ──────────────────────────────────────────────────
assert.equal(await goToStage(STAGE), STAGE);
assert.equal(await setBoots(false), 0, "no boots, no possession flag");
await standAtTree(3);
await press();
await raf(3);
assert.equal((await kickState()).kicking, false,
    "without the TreeBoots a tree does nothing");

// ── 2/3. A dead tree: shake, kick cells, radar card, no fight. ─────────────
assert.equal(await setBoots(true), 1, "the boots in the bag ARE flag 0x8004");
await setLive(8);                       // the capture's live tree
await standAtTree(3);                   // the capture's kicked tree
await press();
await raf(2);
let s = await kickState();
assert.equal(s.kicking, true, "pressing at a tree with the boots must kick it");
assert.equal(s.index, 3, "and it must be the tree in front of us");

// Sample every frame of the kick from inside the page — the cells and the
// shake both run on the field clock, far faster than a round trip per frame.
const trace = await frame.evaluate(async () => {
    const st = window.__state;
    const out = [];
    for (let i = 0; i < 90; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push({
            cell: st.treeKick?.run.kick?.sprite ?? null,
            tree: st.treeKick?.run.shake.sprite ?? null,
        });
    }
    return out;
});
const cells = new Set(trace.map((f) => f.cell).filter(Boolean));
const shake = new Set(trace.map((f) => f.tree).filter((v) => v != null));
s = await kickState();
assert.ok(s.radar, "a dead tree must put the radar card up");
assert.equal(cells.size, 5, `Junior's five kick cells must play, saw ${[...cells]}`);
assert.deepEqual([...cells].sort((a, b) => a - b), [0x47, 0x48, 0x49, 0x4a, 0x4b],
    "facing up, they are FIELDCOM dir-0 0x47..0x4b");
assert.deepEqual([...shake].sort((a, b) => a - b),
    [0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40],
    "and the tree runs its whole shake script");
// s485 tree 3 is at (544,207) and the live tree 8 at (976,143): 432 x 64 apart,
// so the x axis is past 0x100 -> the far (blue) reading, twelve frames a row.
assert.equal(s.radar.icon, 0x50, "432px away reads as the far band");
assert.equal(s.radar.divisor, 0xc);
assert.deepEqual(s.battles, [], "a dead tree starts no fight");
assert.deepEqual(s.live, { stage: STAGE, index: 8 }, "and does not move the marker");

// Junior's input is held while his own kick cells play (leader mode 0x49).
await raf(80);
await standAtTree(3);
await press();
const moved = await frame.evaluate(async () => {
    const st = window.__state;
    const x0 = st.x, y0 = st.y;
    st.keys.add("arrowdown");
    for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
    st.keys.delete("arrowdown");
    return st.x !== x0 || st.y !== y0;
});
assert.equal(moved, false, "the kick holds the player still while it plays");
await raf(80);

// ── 4. The live tree: a fight from this stage's own block, marker moves. ───
await raf(80);                          // let the shake and card run out
await setLive(8);
await standAtTree(8);
await press();
for (let i = 0; i < 40 && !(await kickState()).battles.length; i++) await raf(2);
s = await kickState();
assert.equal(s.battles.length, 1, "the live tree must drop exactly one fight");
assert.ok(SLOT_SCREENS.includes(s.battles[0]),
    `tree kick fought screen ${s.battles[0]}, not one of this stage's ` +
    `slots ${SLOT_SCREENS.join("/")}`);
assert.notEqual(s.live.index, 8, "and the live marker must move on");
const relocated = s.live.index;

// ── 5. The marker survives the same map and re-rolls on a different one. ──
assert.equal(await goToStage(STAGE), STAGE);
assert.equal((await kickState()).live.index, relocated,
    "walking back into the SAME map keeps the live tree");
assert.equal(await goToStage(OTHER), OTHER);
const other = (await kickState()).live;
assert.equal(other.stage, OTHER, "a different map re-rolls onto itself");
assert.ok(other.index < STAGES[OTHER].trees.length);

assert.deepEqual(errors, [], "no page errors");
console.log(
    `tree kick OK — ${cfg.trees.length} trees on ${STAGE}; dead tree 3 -> far ` +
    `radar band, no fight; live tree 8 -> screen ${s.battles[0]} ` +
    `(slot 3 = ${NEAR}), marker 8 -> ${relocated}`);
await browser.close();
