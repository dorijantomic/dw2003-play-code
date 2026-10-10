// Headless check for the bug-maze trap pads (s745 / s746 / s820) — stepping on a
// bugged floor tile bounces the player back to the maze reset point, and the
// facing they land with comes out of the act-13 record's OWN facing word.
//
// Decode (nothing hand-typed):
//   :8a24-:8aa4   0x8008B6D4 writes the record's screen/x/y/facing into the spawn
//                globals (file 0x8a90 `sw $s2,0x64`, :0x8a94 `sw $s3,0x68`,
//                :0x8aa0 `sw $v1,0x6c` — $v1 is the record's params[3], loaded
//                by the caller at :0x5a5c `lhu $v1,0x10($v0)`).
//   :0xe748-:0xe774 the arriving actor's spawn reads those three back, shifts only
//                the two position words `sra 8`, and copies the facing word
//                STRAIGHT into char+0x60 (:0xe758 `lw $v0,0x6c($v0)` /
//                :0xe760 `sw $v0,0x60($s2)`) — the disc's 0-7 facing index,
//                unmapped.
//   tools/gen_trap_pads.py  the one shared generator for these stages: it reads
//                the act-13 records, and since 2026-10-03 names the facing through
//                wstag_extract.DIR8 — char+0x60's order — not the old four-entry
//                table that put every odd word a quarter turn out.
//   web/game.js:6344        hitTrapPad(): on contact, state.dir = reset.dir.
//
// What it asserts, by playing the game:
//   1. THE ROW EXISTS, and its reset point is the destination every act-13 record
//      on the stage shares (read out of the stage's own story_steps.json records).
//   2. THE BOUNCE. Stepping on a bugged floor tile puts the player on the reset
//      cell — no button, no arrow.
//   3. THE FACING. The landed facing is fieldDirectionFromIndex(record word),
//      i.e. what the disc's char+0x60 order says, not the shipped name.
//
// Server: python3 -m http.server 8851 --directory web
// Run:    VERIFY_PORT=8851 tools/run-playwright.sh tools/verify_trap_pad_facing.mjs
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const STAGES = ["s745", "s746", "s820"];
const load = async (p, base = "../web/assets/data/") =>
    JSON.parse(await readFile(new URL(`${base}${p}`, import.meta.url)));
const STEPS = (await load("story_steps.json")).stages;

const FACINGS = ["down", "down-left", "left", "up-left",
    "up", "up-right", "right", "down-right"];

// The disc's 0-7 facing word, read straight out of char+0x60's order.
const fieldDirectionFromIndex = (i) => FACINGS[((i % 8) + 8) % 8];

/** Every shipped trap pad, against the stage's own act-13 records. */
const pads = [];
for (const id of STAGES) {
    const scene = JSON.parse(
        await readFile(new URL(`../web/assets/scenes/${id}.json`, import.meta.url)));
    const block = scene.trapPads;
    assert.ok(block, `${id} must ship a trapPads block`);
    const recs = (STEPS[id.slice(1)]?.steps ?? []).filter((s) => s.op === 13);
    assert.ok(recs.length > 0, `${id} has no act-13 record`);
    const dests = new Set(recs.map((s) => `${s.params[1]},${s.params[2]},${s.params[3] & 7}`));
    assert.equal(dests.size, 1,
        `${id}: ${dests.size} act-13 destinations (${[...dests].join(" / ")})`);
    const [[x, y, word]] = [[...dests][0].split(",")];
    assert.equal(`${block.reset.x},${block.reset.y}`, `${x},${y}`,
        `${id}: reset point is not the record's destination`);
    const wantDir = fieldDirectionFromIndex(Number(word));
    assert.equal(block.reset.dir, wantDir,
        `${id}: record facing word ${word} is "${wantDir}", row ships "${block.reset.dir}"`);
    const cells = [];
    block.mask.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch === "1") cells.push([c, r]);
    }));
    assert.ok(cells.length > 0, `${id}: mask has no trap cell`);
    // s820's reset cell is itself a bugged tile — recorded, not asserted: that is
    // a property of the decoded tile-type layer, unchanged by the facing work.
    const resetCell = block.mask[Math.floor(block.reset.y / block.cell)]
        [Math.floor(block.reset.x / block.cell)];
    pads.push({ id, cells, mask: block.mask, reset: block.reset, word: Number(word),
        wantDir, cell: block.cell, resetIsPad: resetCell === "1", records: recs.length });
}

const PORT = Number(process.env.VERIFY_PORT || 8851);
await mkdir(".bunny-scratch", { recursive: true });
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const results = { pads: pads.map((p) =>
    ({ id: p.id, records: p.records, reset: p.reset, recordDir: p.wantDir,
        cells: p.cells.length, resetCellIsPad: p.resetIsPad })) };

try {
    // s745 is the one stage we drive: the Bug Maze Pit itself, 18 act-13 records
    // and 164 bugged floor cells. The other two are asserted from their records.
    const target = pads[0];
    await page.goto(`http://localhost:${PORT}/ui-lab.html?skipTitle=1&map=${target.id}&noEncounters=1`,
        { waitUntil: "load" });
    await page.waitForFunction(() => {
        const f = document.getElementById("game");
        return f?.contentWindow?.__state?.started;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const frame = page.frames().find((f) => f.url().includes("index.html"));

    const read = () => frame.evaluate(() => {
        const st = window.__state;
        return {
            map: st.manifest.maps[st.mapIdx].id,
            x: Math.round(st.x), y: Math.round(st.y), dir: st.dir,
            icon: st._indicatorKey ?? null,
        };
    });

    // ── 1. a cell that is NOT a pad: the reset point itself ──────────────────
    await frame.evaluate(async (q) => {
        const st = window.__state;
        st.x = q.x; st.y = q.y; st.dir = "up"; st.moving = false;
        for (let k = 0; k < 8; k++) await new Promise((r) => requestAnimationFrame(r));
    }, { x: target.reset.x, y: target.reset.y });
    await page.waitForTimeout(400);
    const atReset = await read();
    results.atReset = atReset;
    assert.equal(`${atReset.x},${atReset.y}`, `${target.reset.x},${target.reset.y}`,
        `the maze reset cell must hold the player (${JSON.stringify(atReset)})`);
    await page.screenshot({
        path: `.bunny-scratch/trappad-${target.id}-reset.png`,
        clip: { x: 335, y: 185, width: 668, height: 480 },
    });

    // ── 2. WALK onto a bugged floor tile: the bounce, no button ─────────────
    // The pad check rides the movement path (web/game.js:6344, inside the
    // `state.moving` block), so the player has to actually step — stand on a
    // neighbouring non-pad cell and hold the key that walks onto the pad.
    const [padCol, padRow] = target.cells[(target.cells.length / 2) | 0];
    const mask = target.mask;
    // The real keyboard keys behind the d-pad (engine/systems/input-map.ts:96).
    const DIR_OF = { "1,0": "ArrowRight", "-1,0": "ArrowLeft",
        "0,1": "ArrowDown", "0,-1": "ArrowUp" };
    let stand = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = padCol + dx, ny = padRow + dy;
        if (nx < 0 || ny < 0 || ny >= mask.length || nx >= mask[0].length) continue;
        if (mask[ny][nx] === "1") continue;
        // the key that walks from (nx,ny) ONTO the pad is the opposite way
        stand = { x: nx * target.cell + target.cell / 2,
            y: ny * target.cell + target.cell / 2, key: DIR_OF[`${-dx},${-dy}`] };
        break;
    }
    assert.ok(stand, "no non-pad neighbour of the chosen pad to walk in from");
    const padCell = { x: padCol * target.cell + target.cell / 2,
        y: padRow * target.cell + target.cell / 2 };
    results.walk = { stand, pad: padCell };
    await frame.evaluate(async (q) => {
        const st = window.__state;
        st.x = q.x; st.y = q.y; st.dir = "up"; st.moving = false;
        for (let k = 0; k < 8; k++) await new Promise((r) => requestAnimationFrame(r));
    }, stand);
    await page.waitForTimeout(300);
    await page.screenshot({
        path: `.bunny-scratch/trappad-${target.id}-approach.png`,
        clip: { x: 335, y: 185, width: 668, height: 480 },
    });

    // The bounce happens INSIDE the tick that finds the player on a pad, and it
    // sets state.dir on that tick; the next tick with the key still held would
    // overwrite the facing from the d-pad and walk them off the reset point. So
    // sample every frame in-page (to catch the bounce's own tick) and release
    // the key as soon as the reset point is reached.
    await frame.evaluate(() => {
        const st = window.__state;
        window.__trap = [];
        const tick = () => {
            window.__trap.push([Math.round(st.x), Math.round(st.y), st.dir]);
            if (window.__trap.length < 600) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await frame.evaluate((k) => {
        window.dispatchEvent(new KeyboardEvent("keydown",
            { key: k, code: k, bubbles: true, cancelable: true }));
    }, stand.key);
    await frame.waitForFunction((q) => {
        const st = window.__state;
        return Math.round(st.x) === q.x && Math.round(st.y) === q.y;
    }, target.reset, { polling: "raf", timeout: 15000 });
    await frame.evaluate((k) => {
        window.dispatchEvent(new KeyboardEvent("keyup",
            { key: k, code: k, bubbles: true, cancelable: true }));
    }, stand.key);
    await page.waitForTimeout(250);
    const bounced = await read();
    const samples = await frame.evaluate(() => window.__trap);
    const cellOf = (v) => `${Math.floor(v / 8)},${Math.floor(v / 8)}`;
    const atResetCells = samples.filter(([x, y]) =>
        Math.floor(x / target.cell) === Math.floor(target.reset.x / target.cell)
        && Math.floor(y / target.cell) === Math.floor(target.reset.y / target.cell));
    results.bounced = bounced;
    results.samples = { total: samples.length, atResetCell: atResetCells.length,
        first: samples.find(([x, y]) =>
            Math.floor(x / target.cell) === Math.floor(target.reset.x / target.cell)
            && Math.floor(y / target.cell) === Math.floor(target.reset.y / target.cell)) };
    await page.screenshot({
        path: `.bunny-scratch/trappad-${target.id}-bounced.png`,
        clip: { x: 335, y: 185, width: 668, height: 480 },
    });

    assert.equal(bounced.map, target.id);
    assert.equal(cellOf(bounced.x), cellOf(target.reset.x),
        `stepping onto the bugged tile at ${padCell.x},${padCell.y} must bounce the ` +
        `player to the reset point (${JSON.stringify(bounced)})`);
    assert.ok(atResetCells.length > 0,
        `the player never stood on the reset cell (${JSON.stringify(bounced)})`);
    // The FIRST frame on the reset cell already carries the record's facing: that
    // is the bounce's own tick, before any further input could steer.
    assert.equal(atResetCells[0][2], target.wantDir,
        `bounced facing ${atResetCells[0][2]}, but the act-13 record's word ` +
        `${target.word} says ${target.wantDir}`);
    assert.equal(bounced.dir, target.wantDir,
        `landed facing ${bounced.dir}, but the act-13 record's word ${target.word} ` +
        `says ${target.wantDir}`);
    assert.equal(errors.length, 0, `${errors.length} page error(s)`);
    console.log("RESULT", JSON.stringify({ ok: true, results }));
} catch (e) {
    console.log("RESULT", JSON.stringify({ ok: false, error: e.message, results }));
    process.exitCode = 1;
} finally {
    await browser.close();
}