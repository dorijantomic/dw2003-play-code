// tools/verify_field_movie_handoff.mjs — the ordinal-43 field movie (MOVIED08_STR).
//
// What it proves, by playing the game rather than calling the movie directly:
//
//   1. At story ordinal 43, the field's battle handoff runs MOVIED08_STR first.
//      The handoff is `F0x8008B798` (pro/fieldstg.s .L0x00008b30-.L0x00008b54):
//      it writes selector 0xE0A — title-overlay mode 10 = movie row 9, disc file
//      2032 — instead of 0x600, and the row's own return selector is 0x600, the
//      battle. The walker hangs this on the one funnel every field battle passes
//      through (web/battle.js `startParty`, setFieldMovieHandoff), driven here by
//      the Fire Dungeon's own ambush tile (the same trigger verify_ambush_tile
//      uses).
//   2. The movie is the disc's stream: movied08.mp4, 320x416, 15 fps, its own
//      434-picture count (the stream carries 450; the disc stops 16 early).
//   3. Its pictures advance on the console's 50 Hz blank cadence — ~15 pictures
//      per second — while the real video plays (currentTime advances).
//   4. It ends by itself on the row's count (434 pictures = 1447 blanks =
//      28.94 s), never on the container's event, and the battle it was always
//      headed to then starts. Fleeing the fight returns control to the field.
//   5. The pad's START ends the movie early (the original's other end arm).
//   6. At any other ordinal no movie plays: an ordinal-44 session starts the
//      same battle directly (the control).
//
// Server: python3 -m http.server 8741 --directory web   (VERIFY_PORT overrides)
// Run:    tools/run-playwright.sh tools/verify_field_movie_handoff.mjs
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = baseUrl(8741);
const OUT = process.env.MOVIE_SHOT || ".bunny-scratch/field-movie-handoff";
mkdirSync(OUT, { recursive: true });

const load = async (p) =>
    JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const TILES = await load("forced_encounters.json");
const GRIDS = (await load("story_trigger_grids.json")).stages;
const SCREENS = (await load("field_encounters.json")).screens;

const STAGE = "s740"; // North Sector — Fire Dungeon, the ambush tile's own stage
const tile = TILES[STAGE];
assert.ok(tile, "forced_encounters.json must carry the Fire Dungeon ambush tile");
assert.ok(SCREENS[String(tile.screenId)], "the tile's screen must have an enemy party");

const MOVIE_CODE = 0xe0a;
const MOVIE_FRAMES = 434; // movie row 9 (pro/stdwtitl.s .L0x00005054)

/** The patch cells of a stage's ambush tile, in trigger-grid coordinates. */
function patchCells(stageId, t) {
    const g = GRIDS[stageId.slice(1)];
    const cells = [];
    for (let i = 0; i < g.grid.length; i++) {
        const v = g.grid[i];
        if (v && t.stepIndexes.includes(v & 0x1f)) cells.push([i % g.w, Math.floor(i / g.w)]);
    }
    return { cells, cell: g.cell };
}

const BUTTONS = ["up", "down", "left", "right"];
const RING = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

const browser = await chromium.launch({ headless: true });
const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); console.log(ok ? "  ok:" : "  FAIL:", m); };

/** A fresh session on the ambush stage at `ordinal`, with a real party. */
async function session(ordinal) {
    const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    const movieErrors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
    // Console "Failed to load resource" lines are the battle 3D models' optional
    // slot_map files (pre-existing, unrelated); the movie's own assets are
    // watched by URL instead, so a missing stream cannot hide behind them.
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on("response", (r) => {
        if (r.status() >= 400 && /\/assets\/movie\//.test(r.url())) movieErrors.push(`${r.status()} ${r.url()}`);
    });
    await page.addInitScript((ord) => {
        const member = (digimonId, level, hp, mp) => ({
            digimonId, level, xp: 0, tp: 10, hp, mp, maxHp: 400, maxMp: 120, dvGauge: 123,
            stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {},
        });
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken", "p005koet", "p004kogu"]));
        localStorage.setItem("partnerStats", JSON.stringify(member(1, 10, 400, 120)));
        localStorage.setItem("partyStats", JSON.stringify([member(1, 10, 400, 120), member(7, 10, 300, 100), member(8, 10, 300, 100)]));
        localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
        localStorage.setItem("bits", "1000");
        localStorage.setItem("inventory", "[]");
        localStorage.setItem("progressOrdinal", String(ord));
    }, ordinal);
    await page.goto(`${ROOT}/?skipTitle=1&map=${STAGE}&noEncounters=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 40_000 });
    await page.waitForFunction((ord) => Number(window.__engine.state.vars.get("$story.ordinal")) === ord,
        ordinal, { timeout: 5_000 });
    // Count every battle the game tries to start, and end any entry cutscene.
    await page.evaluate(() => {
        window.__battlesStarted = [];
        const orig = window.__battle.startScreen.bind(window.__battle);
        window.__battle.startScreen = (screenId, ...rest) => {
            window.__battlesStarted.push(screenId);
            return orig(screenId, ...rest);
        };
        if (window.__cutscene?.isActive?.()) window.__cutscene.start([], null, () => {});
    });
    await page.evaluate(async () => {
        for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    });
    return { context, page, errors, movieErrors };
}

const movie = (page) => page.evaluate(() => window.__fieldMovie?.() ?? null);
const inBattle = (page) => page.evaluate(() => window.__battle.isActive());
const shot = async (page, name) => writeFileSync(`${OUT}/${name}.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
        "base64"));

const goto = (page, at) => page.evaluate(async ([s, p]) => {
    const st = window.__state;
    const idx = st.manifest.maps.findIndex((m) => m.id === s);
    window.__setMap(idx, p);
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
}, [STAGE, at]);

// Walk ONTO the patch and report whether the handoff fired. The patches sit in
// diagonal isometric corridors, so all four buttons are tried from each
// neighbouring cell (the recipe verify_ambush_tile.mjs proves).
async function walkOntoPatch(page, t) {
    const { cells, cell } = patchCells(STAGE, t);
    const patch = new Set(cells.map((c) => c.join(",")));
    const approach = new Map();
    for (const [gx, gy] of cells) {
        for (const [dx, dy] of RING) {
            const from = [gx + dx, gy + dy];
            if (patch.has(from.join(","))) continue;
            approach.set(from.join(","), from);
        }
    }
    for (const from of approach.values()) {
        const at = { x: from[0] * cell + cell / 2, y: from[1] * cell + cell / 2 };
        if (await goto(page, at) !== STAGE) continue;
        for (const button of BUTTONS) {
            await goto(page, at); // reset for each button
            const moved = await page.evaluate(async ([key, cells32, c, frames]) => {
                const st = window.__state;
                const on = new Set(cells32.map((x) => x.join(",")));
                const here = () => [Math.floor(st.x / c), Math.floor(st.y / c)].join(",");
                const n0 = window.__battlesStarted.length;
                st.keys.add(key);
                let arrived = -1, fired = -1;
                for (let i = 0; i < frames; i++) {
                    await new Promise((r) => requestAnimationFrame(r));
                    if (arrived < 0 && on.has(here())) arrived = i;
                    if (fired < 0 && window.__battlesStarted.length > n0) { fired = i; break; }
                }
                st.keys.delete(key);
                return { arrived, fired };
            }, [button, cells, cell, 140]);
            if (moved.fired >= 0) return { fired: true, dir: button };
            if (moved.arrived >= 0) return { fired: false, reached: true };
        }
    }
    return { fired: false, reached: false };
}

/** Flee the fight the ordinary way: arm the list's Run row, confirm. The SPDs
 *  make the flee certain, so no RNG can leave the fight running. */
async function fleeBattle(page) {
    await waitForCommandMenu(page);
    await page.evaluate(() => {
        const b = window.__battleB();
        b.player.spd = 9999;
        b.enemy.spd = 1;
        b.enemy.hp = 99999;
        b.enemy.maxHp = 99999;
    });
    const selection = () => page.evaluate(() => window.__battleCmdNative?.diagnostics?.().selection ?? null);
    for (let i = 0; i < 8 && (await selection()) !== 5; i++) {
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(140);
    }
    check(await selection() === 5, "the Run row is armed");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 8; i++) {
        if (!await inBattle(page)) break;
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
    }
    await page.waitForFunction(() => !window.__battle.isActive(), null, { timeout: 20_000 });
}

/** The field answers the pad again: try each button until the player moves. */
async function fieldAnswersPad(page) {
    for (const button of BUTTONS) {
        const moved = await page.evaluate(async ([key, frames]) => {
            const st = window.__state;
            const before = [st.x, st.y];
            st.keys.add(key);
            for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
            st.keys.delete(key);
            return st.x !== before[0] || st.y !== before[1];
        }, [button, 60]);
        if (moved) return true;
    }
    return false;
}

// ── Session A: the movie plays, ends by itself, and the fight follows ────────
try {
    console.log("session A: ordinal 43, natural end");
    const { context, page, errors, movieErrors } = await session(43);
    try {
        const run = await walkOntoPatch(page, tile);
        check(run.fired, `the ambush tile fired the battle handoff (reached: ${run.reached === true})`);

        // 1/2. The movie opens with the disc's own row and asset. `open` flips
        // synchronously (the engine player); `file` lands when the shipped
        // manifest resolves, so wait for both before reading the asset.
        await page.waitForFunction(() => {
            const m = window.__fieldMovie?.();
            return m?.open === true && m.file !== "";
        }, null, { timeout: 10_000 });
        const opened = await movie(page);
        check(opened.code === MOVIE_CODE, `the handoff names selector 0x${MOVIE_CODE.toString(16)} (got ${opened.code})`);
        check(opened.file === "movied08.mp4", `the row's own stream is playing (${opened.file})`);
        check(opened.frames === MOVIE_FRAMES, `the row's own count (${opened.frames})`);
        check(opened.destination === "0x600", `the movie's return selector is the battle (${opened.destination})`);
        check(opened.endReason === null && (await inBattle(page)) === false,
            "the fight waits for the movie");

        // 3. Frames advance on the console's cadence while the real stream plays.
        await page.waitForTimeout(3000);
        const playing = await movie(page);
        check(playing.open === true, "still playing after 3 s");
        check(playing.pictures > 5, `pictures advance (${playing.pictures} of ${playing.frames})`);
        check(playing.currentTime > 1.5, `the stream is playing (${playing.currentTime.toFixed(2)} s)`);
        check(playing.width === 320 && playing.height === 416,
            `native pixel rate: 320x416 stream (${playing.width}x${playing.height})`);
        const perSecond = playing.pictures / (playing.blanks / 50);
        check(Math.abs(perSecond - 15) < 1, `~15 pictures per second of blanks (${perSecond.toFixed(2)})`);
        await shot(page, "a1-movie-playing");

        // 4. It ends by itself on the row's count — never on the container.
        await page.waitForFunction(() => window.__fieldMovie?.().open === false, null, { timeout: 45_000 });
        const ended = await movie(page);
        check(ended.endReason === "last-picture", `ended on the row's own count (${ended.endReason})`);
        check(ended.pictures === MOVIE_FRAMES, `434 pictures, not the stream's 450 (${ended.pictures})`);
        check(ended.blanks >= 1447, `1447 blanks = 28.94 s of the console's cadence (${ended.blanks})`);

        // The movie's own return selector is the battle: it starts now.
        await page.waitForFunction(() => window.__battle.isActive(), null, { timeout: 30_000 });
        const started = await page.evaluate(() => window.__battlesStarted.slice());
        check(started.length === 1 && started[0] === tile.screenId,
            `the same battle the field set up (${JSON.stringify(started)} vs screen ${tile.screenId})`);
        await shot(page, "a2-battle-after-movie");

        // Flee -> control returns to the field.
        await fleeBattle(page);
        const back = await page.evaluate(() => ({
            battle: window.__battle.isActive(),
            map: window.__state.manifest.maps[window.__state.mapIdx].id,
            movieOpen: window.__fieldMovie().open,
            movieEnd: window.__fieldMovie().endReason,
        }));
        check(back.battle === false && back.movieOpen === false, "the fight and the movie are over");
        check(back.map === STAGE, `still on the stage the walk was on (${back.map})`);
        check(await fieldAnswersPad(page), "the field answers the pad again (control is back)");
        await shot(page, "a3-field-after");
        check(movieErrors.length === 0, `every movie asset served (${movieErrors.join(" | ")})`);
        check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    } finally {
        await context.close();
    }
} catch (e) {
    failures.push(`session A threw: ${e.message}`);
}

// ── Session B: the pad's START ends the movie early ─────────────────────────
try {
    console.log("session B: ordinal 43, START skip");
    const { context, page, errors, movieErrors } = await session(43);
    try {
        const run = await walkOntoPatch(page, tile);
        check(run.fired, "the ambush tile fired again in a fresh session");
        await page.waitForFunction(() => window.__fieldMovie?.().open === true, null, { timeout: 10_000 });
        await page.waitForTimeout(1500);
        const before = await movie(page);
        check(before.open === true && before.pictures > 0, `playing before the press (${before.pictures} pictures)`);
        await page.keyboard.press("i"); // the pad's START (KEYBOARD_BINDINGS.start)
        await page.waitForFunction(() => window.__fieldMovie?.().open === false, null, { timeout: 5_000 });
        const after = await movie(page);
        check(after.endReason === "start", `START ended it early (${after.endReason})`);
        check(after.pictures < MOVIE_FRAMES, `cut before the count (${after.pictures} < ${MOVIE_FRAMES})`);
        check(after.destination === "0x600", "the destination is unchanged by the skip");
        await page.waitForFunction(() => window.__battle.isActive(), null, { timeout: 30_000 });
        check(await inBattle(page), "the fight the movie returned to is up");
        check(movieErrors.length === 0, `every movie asset served (${movieErrors.join(" | ")})`);
        check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    } finally {
        await context.close();
    }
} catch (e) {
    failures.push(`session B threw: ${e.message}`);
}

// ── Session C: any other ordinal starts the battle directly ─────────────────
try {
    console.log("session C: ordinal 44, no movie");
    const { context, page, errors, movieErrors } = await session(44);
    try {
        const run = await walkOntoPatch(page, tile);
        check(run.fired, "the ambush tile fired at ordinal 44 too");
        await page.waitForFunction(() => window.__battle.isActive(), null, { timeout: 30_000 });
        const control = await page.evaluate(() => ({
            battle: window.__battle.isActive(),
            movie: window.__fieldMovie(),
            started: window.__battlesStarted.slice(),
        }));
        check(control.movie.code === 0, `no movie was ever opened (code ${control.movie.code})`);
        check(control.movie.endReason === null && control.movie.open === false, "the movie player stayed closed");
        check(control.started.length === 1 && control.started[0] === tile.screenId,
            `the battle started directly (${JSON.stringify(control.started)})`);
        check(movieErrors.length === 0, `no movie asset was even requested (${movieErrors.join(" | ")})`);
        check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    } finally {
        await context.close();
    }
} catch (e) {
    failures.push(`session C threw: ${e.message}`);
}

await browser.close();

writeFileSync(`${OUT}/proof.json`, JSON.stringify({ failures }, null, 2) + "\n");
if (failures.length) {
    console.error("\nFAILED:");
    for (const m of failures) console.error(" -", m);
    process.exit(1);
}
console.log("\nOK: the ordinal-43 field movie plays, ends on its own count, and hands the fight back");
