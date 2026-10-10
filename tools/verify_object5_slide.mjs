// Player-visible check: the live field character, and the three stage objects
// that move it.
//
// fieldstg's resident object registered as NAME 5 is the character you are
// leading, and its +0x54 is its world Y in 16.8 fixed point. Three stage objects
// write it, and this drives all three in ORDINARY play -- no ?nativeStages, so the
// original overlay machine code is not running:
//
//   s261 id 827 (0x33b)  Amaterasu City / Cargo Tower.  `SETANIM 827 840` / 841
//                        runs a six-clip sequence that walks two of the stage's
//                        own point-sprite rows AND the player together, 127
//                        pixels up (840) or down (841).
//   s926 id 854 (0x356)  Amaterasu City / Arena Front Desk.  Its row walks down
//                        the screen a pixel a blank for 150 blanks -- and so does
//                        the player, so the ROOM scrolls rather than the row.
//   s680 id 814 (0x32e)  Byakko City / Storage Room.  `SETANIM 814 891` starts
//                        a drive that pushes the player down with a growing step
//                        for 122 blanks.
//
// What a player sees is the room scrolling with the player, the two rows staying
// glued to them, and `window.__fieldChar` -- the character's own word -- moving.
// Decode: docs/research/field/stage-object-registry-2026-10-04.md section 19.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_object5_slide.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/object5-slide";
const CARD_WAIT = Number(process.env.CARD_WAIT || 6000);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
let verdict = "FAIL";

try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const logs = [];
    page.on("console", (c) => logs.push(`${c.type()}: ${c.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

    /** Boot a stage, park the player on the rows, and wait for the camera. */
    const enter = async (stage, x, y) => {
        await page.goto(`${baseUrl(8993)}/?skipTitle=1&map=${stage}`);
        const style = page.locator("#asset-mode-authentic");
        if (await style.isVisible().catch(() => false)) await style.click();
        await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
        await page.waitForTimeout(CARD_WAIT);
        await page.evaluate(([px, py]) => {
            window.__state.x = px;
            window.__state.y = py;
        }, [x, y]);
        // The camera eases and is clamped to the room, so this is a settle wait,
        // not a convergence test: the numbers that matter are read per sample.
        await page.waitForTimeout(3000);
    };

    /** One sample: the character's own word, the player, the camera, the rows. */
    const read = async (stage, rows) =>
        page.evaluate(async ([s, watch]) => {
            const so = await import("/stage-objects.js");
            const st = so.stageObjectState(s);
            const fc = window.__fieldChar();
            const probe = window.__pointRecordActors.records(s) ?? [];
            return {
                char: fc,
                player: [Math.round(window.__state.x), Math.round(window.__state.y)],
                cam: window.__lastCam ? [window.__lastCam.x, window.__lastCam.y] : null,
                actors: (await import("/effects.js")).pointRecordActors(s).map((a) => ({
                    id: a.id, machine: a.machine, state: a.state, clip: a.clip,
                    mode: a.mode, cursor: a.cursor, wait: a.wait,
                    drive: a.drive, rec: a.rec,
                })),
                rows: watch.map((w) => {
                    const r = probe[w];
                    return r ? { i: r.index, y: r.y, active: r.active } : null;
                }),
            };
        }, [stage, rows]);

    // ── s261: the Cargo Tower's lift ─────────────────────────────────────────
    await enter("s261", 150, 340);
    // The two rows the member claims, straight out of the shipped table.
    const rows261 = await page.evaluate(async () => {
        const t = await (await fetch("/assets/data/point_record_actors.json")).json();
        return t.stages.s261["827"].twoSlot.records;
    });
    const before261 = await read("s261", rows261);
    await page.screenshot({ path: `${OUT}/s261-before.png` });
    // `SETANIM 827 840`: the room's own command, up.
    const fired261 = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject("s261", 827, 840);
    });
    const samples261 = [];
    for (let i = 0; i < 14; i++) {
        samples261.push(await read("s261", rows261));
        if (i === 4 || i === 13) {
            await page.screenshot({ path: `${OUT}/s261-f${i}.png` });
        }
        await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${OUT}/s261-after.png` });

    const s261ok = fired261 === true
        && before261.char.y === 0
        && samples261[0].char.pixels === 0
        && new Set(samples261.map((s) => s.char.pixels)).size > 4
        && new Set(samples261.map((s) => s.player[1])).size > 4
        // the whole run is 127 pixels up, and the room scrolls with the player
        && samples261.at(-1).char.pixels === -127
        && samples261.at(-1).player[1] < before261.player[1] - 100
        && samples261.at(-1).cam[1] < before261.cam[1] - 100
        && samples261.some((s) => s.rows[0] && s.rows[0].y < 200);
    results.push({
        member: "s261 id 827 (0x33b) SETANIM 827 840",
        fired: fired261,
        charPixels: samples261.map((s) => s.char.pixels),
        playerY: samples261.map((s) => s.player[1]),
        camY: samples261.map((s) => (s.cam ? s.cam[1] : null)),
        rowY: samples261.map((s) => (s.rows[0] ? s.rows[0].y : null)),
        rowMoved: samples261.some((s) => s.rows[0] && s.rows[0].y !== before261.rows[0].y),
        verdict: s261ok ? "OK" : "FAIL",
    });

    // ── s926: the row and the player walk down together ─────────────────────
    await enter("s926", 256, 336);
    const rows926 = await page.evaluate(async () => {
        const t = await (await fetch("/assets/data/point_record_actors.json")).json();
        const m = t.stages.s926["854"];
        const tag = Object.keys(m.tags)[0];
        return [m.tags[tag].index];
    });
    // Put the player ON the row, so the capture shows the two together.
    await page.evaluate((i) => {
        const probe = window.__pointRecordActors.records("s926");
        if (probe?.[i]) window.__state.y = probe[i].y;
    }, rows926[0]);
    await page.waitForTimeout(1500);
    const before926 = await read("s926", rows926);
    await page.screenshot({ path: `${OUT}/s926-before.png` });
    const fired926 = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject("s926", 854, 841);
    });
    const samples926 = [];
    for (let i = 0; i < 12; i++) {
        samples926.push(await read("s926", rows926));
        if (i === 11) await page.screenshot({ path: `${OUT}/s926-after.png` });
        await page.waitForTimeout(400);
    }
    const s926ok = fired926 === true
        && before926.char.y === 0
        && samples926.at(-1).char.pixels > 20
        && samples926.at(-1).player[1] > before926.player[1] + 20
        && samples926.at(-1).rows[0].y !== before926.rows[0].y
        && samples926.every((s, i) => i === 0
            || Math.abs((s.rows[0].y - s.player[1])
                - (before926.rows[0].y - before926.player[1])) <= 2);
    results.push({
        member: "s926 id 854 (0x356) SETANIM 854 841",
        fired: fired926,
        charPixels: samples926.map((s) => s.char.pixels),
        playerY: samples926.map((s) => s.player[1]),
        camY: samples926.map((s) => (s.cam ? s.cam[1] : null)),
        rowY: samples926.map((s) => (s.rows[0] ? s.rows[0].y : null)),
        rowTracksPlayer: samples926.every((s, i) => i === 0
            || Math.abs((s.rows[0].y - s.player[1])
                - (before926.rows[0].y - before926.player[1])) <= 2),
        verdict: s926ok ? "OK" : "FAIL",
    });

    // ── s680: the accelerating drive ────────────────────────────────────────
    await enter("s680", 120, 160);
    const before680 = await read("s680", []);
    await page.screenshot({ path: `${OUT}/s680-before.png` });
    const fired680 = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return [so.fireStageObject("s680", 814, 829), so.fireStageObject("s680", 814, 891)];
    });
    const samples680 = [];
    for (let i = 0; i < 12; i++) {
        samples680.push(await read("s680", []));
        if (i === 11) await page.screenshot({ path: `${OUT}/s680-after.png` });
        await page.waitForTimeout(300);
    }
    const s680ok = fired680.every(Boolean)
        && before680.char.y === 0
        && samples680.at(-1).char.pixels > samples680[1].char.pixels
        && samples680.at(-1).player[1] > before680.player[1];
    results.push({
        member: "s680 id 814 (0x32e) SETANIM 814 829 / 891",
        fired: fired680,
        charPixels: samples680.map((s) => s.char.pixels),
        playerY: samples680.map((s) => s.player[1]),
        drive: samples680.at(-1).actors.find((a) => a.id === 814)?.drive ?? null,
        verdict: s680ok ? "OK" : "FAIL",
    });

    for (const l of logs) if (/error|pageerror/i.test(l)) console.log(`  [log] ${l}`);
    verdict = results.every((r) => r.verdict === "OK") ? "OK" : "FAIL";
} finally {
    await browser.close();
}

console.log("=== SUMMARY ===");
for (const r of results) console.log(JSON.stringify(r));
console.log("VERDICT", verdict);
process.exit(verdict === "OK" ? 0 : 1);
