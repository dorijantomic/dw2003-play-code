// tools/verify_story_movie_handoff.mjs — the post-game story handoff's movie (MOVIED01_STR).
//
// What it proves, by playing the game rather than calling the movie directly:
//
//   1. The s780 reunion's `HANDOFF 0xE03` (wstag780.s event 1500, the beat that
//      writes the post-game marker 45) is the title overlay's movie player at row
//      2 = MOVIED01_STR (pro/stdwtitl.s .L0x00005000; disc file 2026, 465
//      pictures in the row). The walker's story-handoff path (web/game.js
//      doStoryHandoff, the shared playMovieChain) plays it before routing the
//      selector the chain ends on.
//   2. The movie is the disc's stream: movied01.mp4, 320x416, 15 fps, its own
//      465-picture count (the stream carries 480; the disc stops 15 early).
//   3. Its pictures advance on the console's 50 Hz blank cadence while the real
//      video plays (currentTime advances).
//   4. It ends by itself on the row's count and the warp then lands on s925 —
//      row 2's return 0x207 re-pointed to 0x276 at ordinal 45 (screen 630, the
//      {base 226, alt 925} record).
//   5. The pad's START ends the movie early (the original's other end arm) and
//      the same warp still happens.
//   6. Control: a HANDOFF that names no movie (s925's own arrival event 1600,
//      HANDOFF 627) routes with no movie phase at all.
//
// Server: the check starts and stops its own server (like the newer harnesses);
// VERIFY_PORT overrides the default 8749.
// Run:    tools/run-playwright.sh tools/verify_story_movie_handoff.mjs
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.VERIFY_PORT) || 8749;
const ROOT = `http://localhost:${PORT}`;
const OUT = process.env.STORY_MOVIE_SHOT || ".bunny-scratch/story-movie-handoff";
mkdirSync(OUT, { recursive: true });

// ── the check's own server (a stale one on the port would serve another tree) ─
const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", "web"],
    { cwd: ROOT_DIR, stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", stopServer);
async function waitForServer(url, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(url, { method: "HEAD" });
            if (r.ok || r.status === 404) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`server did not come up on ${url}`);
}
await waitForServer(`${ROOT}/index.html`);

const MOVIE_CODE = 0xe03;          // the reunion's launch code
const MOVIE_FRAMES = 465;          // movie row 2 (pro/stdwtitl.s .L0x00005000)
const MOVIE_FILE = "movied01.mp4";
const RETURN_POST_GAME = 0x276;    // row 2 at master ordinal 0x2d

const browser = await chromium.launch({ headless: true });
const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); console.log(ok ? "  ok:" : "  FAIL:", m); };

/** A fresh session on s780 at `ordinal`, with the reunion's arrival once-bit the
 *  caller chooses. `gameSpeed` bounds the wall clock; the movie runs on the
 *  console's blanks either way (the speed hack sub-steps the same sim). */
async function session(ordinal, { firedRows = ["s780.auto.0"], gameSpeed = 2 } = {}) {
    const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    const movieErrors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on("response", (r) => {
        if (r.status() >= 400 && /\/assets\/movie\//.test(r.url())) movieErrors.push(`${r.status()} ${r.url()}`);
    });
    await page.addInitScript((seed) => {
        const member = () => ({
            digimonId: 39, level: 99, xp: 0, tp: 10, hp: 9999, mp: 9999, maxHp: 9999, maxMp: 9999,
            stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 }, bonuses: {}, elemBonuses: {},
        });
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken", "p005koet", "p004kogu"]));
        localStorage.setItem("partnerStats", JSON.stringify(member()));
        localStorage.setItem("partyStats", JSON.stringify([member(), member(), member()]));
        localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
        localStorage.setItem("rosterOwned", "1");
        localStorage.setItem("bits", "1000");
        localStorage.setItem("progressOrdinal", String(seed.ordinal));
        localStorage.setItem("engineEvents", JSON.stringify(seed.firedRows));
    }, { ordinal, firedRows });
    await page.goto(`${ROOT}/?skipTitle=1&map=s780&noEncounters=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 40_000 });
    await page.evaluate((s) => { window.__gameSpeed = s; }, gameSpeed);
    return { context, page, errors, movieErrors };
}

const movie = (page) => page.evaluate(() => window.__fieldMovie?.() ?? null);
const mapId = (page) => page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);
const ordinal = (page) => page.evaluate(() => Number(window.__engine.state.vars.get("$story.ordinal")));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Press through the reunion cutscene until the movie phase opens or `until` is true. */
async function pressUntil(page, until, { deadlineMs = 120_000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < deadlineMs) {
        if (await until()) return true;
        const st = await page.evaluate(() => ({
            textbox: window.__textbox?.isOpen?.() ?? false,
            cutscene: window.__cutscene?.isActive?.() ?? false,
        }));
        if (st.textbox || st.cutscene) {
            await page.keyboard.down("Enter");
            await page.waitForTimeout(120);
            await page.keyboard.up("Enter");
        } else {
            await page.waitForTimeout(120);
        }
    }
    return until();
}

// ── Session A: the movie plays, ends on the row's count, the warp lands s925 ─
try {
    console.log("session A: the reunion's handoff, natural end");
    const { context, page, errors, movieErrors } = await session(43);
    try {
        const opened = await pressUntil(page, async () => {
            const m = await movie(page);
            return m?.open === true && m.file !== "";
        });
        check(opened, "the reunion's HANDOFF 0xE03 opened the movie before any warp");
        const m0 = await movie(page);
        check(m0.code === MOVIE_CODE, `the handoff's own launch code 0x${MOVIE_CODE.toString(16)} (got ${m0.code})`);
        check(m0.file === MOVIE_FILE, `the row's own stream is playing (${m0.file})`);
        check(m0.frames === MOVIE_FRAMES, `the row's own count (${m0.frames})`);
        check(m0.destination === "0x207", `the row's tabled return (${m0.destination})`);
        check((await mapId(page)) === "s780", "the warp waits for the movie");
        // The stream really decodes in the page.
        await page.waitForFunction(() => {
            const m = window.__fieldMovie?.();
            return m?.readyState >= 2 && m.paused === false;
        }, null, { timeout: 20_000 });
        const playing0 = await movie(page);
        check(playing0.width === 320 && playing0.height === 416,
            `native pixel rate: 320x416 stream (${playing0.width}x${playing0.height})`);
        await page.waitForTimeout(2500);
        const playing = await movie(page);
        check(playing.open === true, "still playing");
        check(playing.pictures > 5, `pictures advance (${playing.pictures} of ${playing.frames})`);
        check(playing.currentTime > 1.0, `the stream is playing (${playing.currentTime.toFixed(2)} s)`);
        const perSecond = playing.pictures / (playing.blanks / 50);
        check(Math.abs(perSecond - 15) < 1, `~15 pictures per second of blanks (${perSecond.toFixed(2)})`);
        await shot(page, "a1-movie-playing");

        // It ends by itself on the row's count — never on the container's event.
        await page.waitForFunction(() => window.__fieldMovie?.().open === false, null, { timeout: 90_000 });
        const ended = await movie(page);
        check(ended.endReason === "last-picture", `ended on the row's own count (${ended.endReason})`);
        check(ended.pictures === MOVIE_FRAMES, `465 pictures, not the stream's 480 (${ended.pictures})`);
        check(ended.blanks >= 1550, `1550 blanks = 31.0 s of the console's cadence (${ended.blanks})`);

        // The chain's return (0x276 at ordinal 45) routes to the alias s925.
        const landed = await pressUntil(page, async () => (await mapId(page)) === "s925");
        check(landed, "the warp landed on the post-game alias s925");
        check((await ordinal(page)) === 45, `the post-game marker is 45 (${await ordinal(page)})`);
        await shot(page, "a2-landed-s925");
        check(movieErrors.length === 0, `every movie asset served (${movieErrors.join(" | ")})`);
        check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    } finally {
        await context.close();
    }
} catch (e) {
    failures.push(`session A threw: ${e.message}`);
}

// ── Session B: the pad's START ends the movie early; the warp still lands ────
try {
    console.log("session B: START skip");
    const { context, page, errors, movieErrors } = await session(43);
    try {
        const opened = await pressUntil(page, async () => (await movie(page))?.open === true);
        check(opened, "the movie opened again in a fresh session");
        await page.waitForTimeout(1200);
        const before = await movie(page);
        check(before.open === true && before.pictures > 0, `playing before the press (${before.pictures} pictures)`);
        await page.keyboard.press("i"); // the pad's START (the original's other end arm)
        await page.waitForFunction(() => window.__fieldMovie?.().open === false, null, { timeout: 5_000 });
        const after = await movie(page);
        check(after.endReason === "start", `START ended it early (${after.endReason})`);
        check(after.pictures < MOVIE_FRAMES, `cut before the count (${after.pictures} < ${MOVIE_FRAMES})`);
        const landed = await pressUntil(page, async () => (await mapId(page)) === "s925");
        check(landed, "the same warp still landed on s925");
        check((await ordinal(page)) === 45, "the marker is still 45");
        check(movieErrors.length === 0, `every movie asset served (${movieErrors.join(" | ")})`);
        check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    } finally {
        await context.close();
    }
} catch (e) {
    failures.push(`session B threw: ${e.message}`);
}

// ── Session C (control): a non-movie HANDOFF routes with no movie phase ──────
// s925's arrival event 1600 hands off 627 (a plain screen id) -> s923. Booted at
// 45 with the reunion already seen, so the only handoff this session runs is
// event 1600's.
try {
    console.log("session C: control, s925's event 1600 (no movie)");
    const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
        const member = () => ({
            digimonId: 39, level: 99, xp: 0, tp: 10, hp: 9999, mp: 9999, maxHp: 9999, maxMp: 9999,
            stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 }, bonuses: {}, elemBonuses: {},
        });
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken", "p005koet", "p004kogu"]));
        localStorage.setItem("partnerStats", JSON.stringify(member()));
        localStorage.setItem("partyStats", JSON.stringify([member(), member(), member()]));
        localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
        localStorage.setItem("rosterOwned", "1");
        localStorage.setItem("bits", "1000");
        localStorage.setItem("progressOrdinal", "45");
        localStorage.setItem("engineEvents", JSON.stringify(["s780.auto.0", "s780.auto.1500"]));
    });
    try {
        await page.goto(`${ROOT}/?skipTitle=1&map=s925&noEncounters=1`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 40_000 });
        await page.evaluate(() => { window.__gameSpeed = 2; });
        const landed = await pressUntil(page, async () => (await mapId(page)) === "s923");
        check(landed, "s925's event 1600 handed off 627 -> s923");
        const control = await page.evaluate(() => ({
            movie: window.__fieldMovie?.() ?? null,
            map: window.__state.manifest.maps[window.__state.mapIdx].id,
        }));
        check(control.movie.code === 0 && control.movie.open === false && control.movie.endReason === null,
            `no movie phase for a non-movie handoff (code ${control.movie.code}, open ${control.movie.open})`);
        check(control.map === "s923", `the control landed where the plain id routes (${control.map})`);
        check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    } finally {
        await context.close();
    }
} catch (e) {
    failures.push(`session C threw: ${e.message}`);
}

await browser.close();
stopServer();

writeFileSync(`${OUT}/proof.json`, JSON.stringify({ failures }, null, 2) + "\n");
if (failures.length) {
    console.error("\nFAILED:");
    for (const m of failures) console.error(" -", m);
    process.exit(1);
}
console.log("\nOK: the post-game story handoff plays MOVIED01 and lands on s925; a plain handoff plays no movie");
