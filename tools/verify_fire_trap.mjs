// Headless check for the Fire Dungeon floor trap, driven through the REAL
// web/game.js in the web/ui-lab.html harness (no mock renderer).
//
// Decode: engine/systems/fire-trap.ts, tools/extract_fire_traps.py, and the
// controlled s740 replay
// docs/research/field/captures/fire-dungeon-explosion-state4-2026-07-28.txt.
//
// What it asserts, all against the shipped extraction rather than hand-copied
// numbers, and all by playing the game rather than by calling the controller:
//
//   1. Walking into the traced region (cell (26,15), value 9) with the gate flag
//      clear takes field control — exactly as the capture's frame 13 did.
//   2. Standing in the SAME region with the gate flag already set does nothing:
//      the one-shot really is one-shot.
//   3. The sequence plays SWITCH02 once and COMEX113 once per walking Digimon.
//   4. Explosion pixels actually paint on the live canvas over the party.
//   5. Every walking Digimon ends on exactly 1 HP and none of them dies.
//   6. Control comes back and the region's gate flag (0x40b1) is now set.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_fire_trap.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const STAGE = "s740";
const traps = JSON.parse(
    await readFile(new URL("../web/assets/data/fire_traps.json", import.meta.url)),
);
const cfg = traps[STAGE];
assert.ok(cfg, "fire_traps.json must carry s740");
// The patch the controlled replay sprang: grid cell (26,15) = step 9 = event 9007.
const REGION = cfg.traps.find((t) => t.stepIndex === 9);
assert.ok(REGION, "s740 must carry the traced region");
assert.equal(REGION.eventId, 9007);
const CELL = 32;
// Start two cells NORTH of the patch and walk in, the way the capture did
// (Down held) — so the trap has to be entered, not spawned on top of.
const START = { x: 26 * CELL + 16, y: 13 * CELL + 8 };

const outDir = resolve(process.argv[2] ?? "/tmp/fire-trap-verification");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1200);
const frame = page.frames().find((f) => f.url().includes("index.html"));

const raf = (n) => frame.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

// The lab boots into s200 with a cutscene still holding the field (true with or
// without this feature — it is a harness condition, not a game one). Nothing on
// the movement path runs while a cutscene is active, so hand the manager an
// empty program to retire it before driving the player.
await frame.evaluate(async () => {
    if (!window.__cutscene.isActive()) return;
    window.__cutscene.start([], null, () => {});
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
});
await frame.waitForFunction(() => !window.__cutscene.isActive(), null, { timeout: 10000 });

// Put three Digimon in the walking party, each on full HP, and record every
// sound the game plays from here on.
const setup = await frame.evaluate(async ([stage, start]) => {
    const s = window.__state;
    const maps = s.manifest.maps;
    const idx = maps.findIndex((m) => m.id === stage);
    if (idx < 0) return { ok: false, reason: `no map ${stage}` };

    // Record sounds at TWO levels. `calls` is what the controller asked for;
    // `voices` is what the Web Audio graph actually started, with the decoded
    // buffer's duration. Only the second proves a cue is audible — counting
    // calls alone passes even when the id resolves to nothing and the player
    // silently returns.
    const calls = [];
    const voices = [];
    window.__playedSounds = calls;
    window.__startedVoices = voices;
    const sfx = window.__sfx;
    {
        const orig = sfx.play.bind(sfx);
        sfx.play = (id, ...rest) => { calls.push(String(id)); return orig(id, ...rest); };
    }
    {
        // playPacked returns the stem it resolved the packed id to, or null.
        // Record BOTH, so "the cue fired" and "the cue named a real sample"
        // are separate observations.
        const orig = sfx.playPacked.bind(sfx);
        sfx.playPacked = (id, ...rest) => {
            calls.push(String(id));
            const key = orig(id, ...rest);
            calls.push(key === null ? "<unresolved>" : key);
            return key;
        };
    }
    const AC = window.AudioContext.prototype;
    const make = AC.createBufferSource;
    AC.createBufferSource = function () {
        const src = make.call(this);
        const start = src.start.bind(src), stop = src.stop.bind(src);
        const v = { dur: 0, rate: 1, cut: false };
        src.start = (...a) => {
            v.dur = src.buffer?.duration ?? 0;
            v.rate = src.playbackRate.value;
            voices.push(v);
            return start(...a);
        };
        // A voice the category arbitration killed early. The explosions run
        // longer than the gap between them, so any cut here means the sequence
        // is truncating itself back into a thud.
        src.stop = (...a) => { v.cut = true; return stop(...a); };
        return src;
    };

    s.party = s.party?.length >= 3 ? s.party.slice(0, 3) : ["p001agmn", "p002gbmn", "p003pmon"];
    s.partnerStats = { ...(s.partnerStats ?? {}), digimonId: 1, level: 5, hp: 150, maxHp: 150 };
    s.partyStats = [
        s.partnerStats,
        { digimonId: 2, level: 5, hp: 140, maxHp: 140 },
        { digimonId: 3, level: 5, hp: 130, maxHp: 130 },
    ];
    window.__setMap(idx, start);
    return { ok: true };
}, [STAGE, START]);
assert.ok(setup.ok, setup.reason);
await raf(20);

const walkers = await frame.evaluate(() => window.__activeFollowerCount());
assert.equal(walkers, 3, "three Digimon must be walking with the tamer");

const hpNow = () => frame.evaluate(() =>
    window.__state.partyStats.map((p) => [p.hp, p.maxHp]));
assert.deepEqual(await hpNow(), [[150, 150], [140, 140], [130, 130]],
    "party starts on full HP");

const gate = () => frame.evaluate((f) => window.__storyFlags.get(f), REGION.gateFlag);
assert.equal(await gate(), 0, "the traced region's gate flag starts clear");

// ── 1. Walk into the patch. Control must be taken. ─────────────────────────
// The field does NOT move on screen-cardinal axes: `fieldDirectionDelta` reads
// the native isometric terrain×direction table, so "hold Down" reaches a
// DIAGONAL world neighbour and, from some cells, moves nothing at all. So place
// the player on each ring neighbour of the traced cell, try ALL FOUR buttons
// from there, and keep the first that actually ends on a region cell.
assert.equal(await frame.evaluate(() => !!window.__state.fireTrap), false,
    "standing outside the patch must not spring it");
const armed = await frame.evaluate(async ([stepIndex, frames]) => {
    const s = window.__state;
    const idx = s.manifest.maps.findIndex((m) => m.id === "s740");
    const g = s.storyGrids["740"];
    const cell = g.cell;
    // Every cell of this region, in the same &0x1f encoding the game uses.
    const region = new Set();
    for (let i = 0; i < g.grid.length; i++) {
        const v = g.grid[i];
        if (v && (v & 0x1f) === stepIndex)
            region.add([i % g.w, Math.floor(i / g.w)].join(","));
    }
    const RING = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
    const BUTTONS = ["up", "down", "left", "right"];
    for (const key of region) {
        const [rx, ry] = key.split(",").map(Number);
        for (const [dx, dy] of RING) {
            const from = [rx + dx, ry + dy];
            if (region.has(from.join(","))) continue;
            for (const button of BUTTONS) {
                window.__setMap(idx, { x: from[0]*cell + cell/2, y: from[1]*cell + cell/2 });
                for (let i = 0; i < 12; i++) await new Promise(r => requestAnimationFrame(r));
                s.keys.add(button);
                let armedAt = -1;
                for (let i = 0; i < frames; i++) {
                    await new Promise(r => requestAnimationFrame(r));
                    if (s.fireTrap) { armedAt = i; break; }
                }
                s.keys.delete(button);
                if (armedAt >= 0) return { armedAt, button, from };
            }
        }
    }
    return { armedAt: -1 };
}, [REGION.stepIndex, 120]);
assert.ok(armed.armedAt > 0, "the trap must be walked INTO, not sprung on arrival");
assert.ok(armed.armedAt >= 0, "walking into the region must spring the trap");

const cellUnder = await frame.evaluate(() => {
    const s = window.__state;
    const g = s.storyGrids["740"];
    return g.grid[Math.floor(s.y / g.cell) * g.w + Math.floor(s.x / g.cell)];
});
assert.equal(cellUnder & 0x1f, REGION.stepIndex, "sprung from the traced cell");

// The D-pad is dead while the controller holds the scene.
const before = await frame.evaluate(() => [window.__state.x, window.__state.y]);
await frame.evaluate(() => window.__state.keys.add("arrowdown"));
await raf(10);
await frame.evaluate(() => window.__state.keys.delete("arrowdown"));
assert.deepEqual(await frame.evaluate(() => [window.__state.x, window.__state.y]),
    before, "input must not move the player while the trap runs");

// ── 4. Explosion pixels reach the canvas. ──────────────────────────────────
// Measured as a LAYER: the same frame with the bursts drawn and suppressed, so
// the map, the party sprites and the ambient torches all cancel out exactly.
const burstPixels = async () => frame.evaluate(async () => {
    const cv = document.querySelector("canvas");
    const ctx2 = cv.getContext("2d");
    const grab = () => Array.from(ctx2.getImageData(0, 0, cv.width, cv.height).data);
    const on = grab();
    const trap = window.__state.fireTrap;
    // Keyed by the burst object, not its index: the controller may spawn another
    // explosion during the frame this waits out, and an index-keyed restore
    // would then hand the new burst an undefined sprite list.
    const saved = new Map();
    for (const b of trap?.run.bursts ?? []) {
        saved.set(b, b.sprites);
        b.sprites = b.sprites.map(() => null);
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const off = grab();
    for (const [b, sprites] of saved) b.sprites = sprites;
    let n = 0;
    for (let i = 0; i < on.length; i += 4)
        if (on[i] !== off[i] || on[i + 1] !== off[i + 1] || on[i + 2] !== off[i + 2]) n++;
    return n;
});

let peakBurst = 0;
let seenBursts = 0;
for (let i = 0; i < 400; i++) {
    if (!(await frame.evaluate(() => !!window.__state.fireTrap))) break;
    const live = await frame.evaluate(() =>
        window.__state.fireTrap.run.bursts.filter((b) => !b.done).length);
    if (live > 0) {
        seenBursts = Math.max(seenBursts,
            await frame.evaluate(() => window.__state.fireTrap.run.bursts.length));
        peakBurst = Math.max(peakBurst, await burstPixels());
    }
    await raf(2);
}
await page.screenshot({ path: resolve(outDir, "after.png") });

assert.equal(seenBursts, 3, "one explosion per walking Digimon");
assert.ok(peakBurst > 200,
    `explosion sprites must paint on the canvas (peak ${peakBurst} px)`);

// ── 3/5/6. Sounds, HP and the one-shot gate. ───────────────────────────────
assert.equal(await frame.evaluate(() => !!window.__state.fireTrap), false,
    "the controller must release the scene");

const sounds = await frame.evaluate(() => window.__playedSounds.slice());
assert.equal(sounds.filter((s) => s === cfg.sounds.arm).length, 1, "one SWITCH02 cue");
assert.equal(sounds.filter((s) => s === cfg.sounds.blast).length, 3,
    "one COMEX113 cue per Digimon");
// Each packed id must have RESOLVED to a real stem — playPacked returns null for
// an id with no extracted sample, and a null return is silent.
assert.ok(sounds.includes("switch02"), "SWITCH02 must resolve to its sample");
assert.equal(sounds.filter((s) => s === "comex113").length, 3,
    "each COMEX113 cue must resolve to its sample");
// ...and each must have actually started a voice carrying real audio. The four
// trap voices are the last four started; the walk-in footsteps precede them.
const voices = await frame.evaluate(() => window.__startedVoices.slice(-4));
assert.equal(voices.length, 4, "four voices started (arm + one per Digimon)");
for (const v of voices) {
    assert.ok(v.dur > 0 && v.rate > 0,
        `every trap voice must carry decoded audio (got ${JSON.stringify(v)})`);
    assert.equal(v.cut, false,
        "no trap voice may be cut short by the next one — the explosions overlap");
}
// Each blast outlasts the gap to the next, which is exactly why they must overlap.
const blastDur = voices.at(-1).dur / voices.at(-1).rate;
assert.ok(blastDur > (cfg.waitTicks / 60),
    `the blast (${blastDur.toFixed(2)}s) is longer than the ${cfg.waitTicks}-tick gap`);

const hp = await hpNow();
assert.deepEqual(hp, [[1, 150], [1, 140], [1, 130]],
    "every walking Digimon is left on exactly 1 HP, alive");

assert.equal(await gate(), 1, "the sprung region's gate flag is now set");

// ── 2. One-shot: standing on the same patch again does nothing. ────────────
await frame.evaluate((s) => window.__teleport(s.x, s.y), START);
await raf(5);
await frame.evaluate(() => window.__state.keys.add("arrowdown"));
await raf(90);
await frame.evaluate(() => window.__state.keys.delete("arrowdown"));
assert.equal(await frame.evaluate(() => !!window.__state.fireTrap), false,
    "a sprung region must never fire again");
assert.deepEqual(await hpNow(), hp, "and must not touch HP again");

assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log(`fire trap OK — sprung at frame ${armed.armedAt}, 3 explosions, ` +
    `peak ${peakBurst} burst px, party left on 1 HP, gate 0x${REGION.gateFlag.toString(16)} set`);
console.log(`screenshot: ${resolve(outDir, "after.png")}`);
