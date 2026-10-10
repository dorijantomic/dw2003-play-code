// Headless check for the scrolling backdrop walls.
//
// TEN screens of the original draw a tiled wall that scrolls diagonally, and
// the tenth (the naming screen) is one the first census missed because it
// writes its wrap in the short form. All ten share one code shape, and
// data/scrolling_walls.json is their census (tools/extract_scroll_walls.py).
// The shape, the per-screen clips and the PAL cadence are written out in
// tools/scrolling-walls.mjs, which also holds the rows below and the phase
// measurement this check and tests/scrolling-wall-position.test.js share.
//
// Two different measurements, because the screens answer different questions:
//
//   * LOOP TIME, from pixels, for a screen with a mapped bare-wall box. 96 px at
//     25 px/s means the wall returns to its exact starting phase every 3.84 s.
//     That is independent of how each screen scales the 320x240 frame onto the
//     canvas, which is what makes one threshold valid for every screen. A
//     frozen wall never leaves its start phase; a wall at the wrong speed
//     returns early or late.
//
//   * POSITION, from the picture calls, for the screens whose wall position the
//     host can be asked for: the pause pages and the memory card (a translated
//     session's draw calls), the shop, the DRI lab, the results screen, the
//     naming screen (also translated) and the three card screens (the shipped
//     overlay's own draw arguments, through the runtime). It reads the (x, y)
//     the screen actually asked for, so it can tell a wall that WRAPPED from a
//     wall that is merely hidden behind an opaque window — the exact confusion
//     that made this check report two walls "never loop" on 2026-10-04, and
//     that also hid the card screens' rate behind the pause list's wall for one
//     run. It counts the pixels the counter moved, so a browser frame that ran
//     long and let the host catch up two or three blanks at once no longer
//     reads as a broken wall (tests/scrolling-wall-position.test.js pins both
//     readings).
//
// THE PAUSE LIST HAS NO WALL, AND THAT IS CORRECT. `__labOpen("menu")` is the
// field's START: the original's first pause draws the list over the LIVE FIELD
// (authority-1 rig capture, docs/research/ui/captures/pause-field-home-2026-08-20.png,
// described at docs/research/ui/pause-home-and-items-rig-2026-08-20.md:18-23),
// and the diamond room only appears once you have been into a page and come
// back (captures/pause-overlay-home-2026-08-20.png). The walker's
// `homeOverlay` flag is that rule. So the `pausehome` row asserts the ABSENCE
// of the wall draw, and `pausepage` opens a page, which does have one.
//
// Usage: tools/run-playwright.sh tools/verify_scrolling_walls.mjs [outdir]
// Requires: python3 -m http.server <VERIFY_PORT> --directory web
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import {
    WALL_SCREENS, WALL_LOOP_SEC, WALL_LOOP_TOLERANCE_SEC,
    measureWallPhase, wallPhaseFaults, describeWallPhase,
} from "./scrolling-walls.mjs";

const out = process.argv[2] ?? "/tmp/walls";
mkdirSync(out, { recursive: true });

/** Sample boxes in canvas pixels; each must be BARE wall. Several candidates
 * are tried and the one that tracks the wall best is used. The boxes are the
 * cells a 20 px motion map found to return to their start phase at 3.84 s, so
 * none of them crosses a window, a plate or a card. */
const SCREENS = WALL_SCREENS;

/** Seconds of phase samples. One 96 px period is 3.84 s, so a window under that
 * cannot show a wall that wrapped; 4.2 s can show exactly one. */
const WATCH_SEC = 4.2;

const browser = await chromium.launch({
    channel: "chromium-headless-shell",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });

/** The (x, y) the screen asked for on its wall clip, once per changed frame. */
const sampleWall = (handle, clip, watchSec) => page.evaluate(async ({ handle, clip, watchSec }) => {
    const screen = window[handle];
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    const out = [];
    let last = null;
    const t0 = performance.now();
    while ((performance.now() - t0) / 1000 < watchSec) {
        await frame();
        // A translated session keeps its ordered picture calls; a screen that
        // still runs the shipped overlay keeps the runtime's, which hold the
        // last vertical blank's draws.
        const calls = screen?._session?.draw?.calls ?? screen?._host?.rt?.drawCalls ?? [];
        const w = calls.find((c) => c.method === "drawSprite" && (c.args[1] & 0xff) === clip);
        if (!w) continue;
        const pair = [w.args[2] | 0, w.args[3] | 0];
        const key = pair.join(",");
        if (key !== last) { out.push([(performance.now() - t0) / 1000, pair[0], pair[1]]); last = key; }
    }
    return out;
}, { handle, clip, watchSec });

/** The loop time of one bare-wall box: when the pixels came back to their start. */
const trackLoopTime = (boxes) => page.evaluate(async ({ boxes, watchSec }) => {
    const canvas = document.querySelector("canvas#game");
    const ctx = canvas.getContext("2d");
    const frame = () => new Promise((res) => requestAnimationFrame(res));

    const track = async ([bx, by, bw, bh]) => {
        // Subsample: enough texture to identify the phase, cheap enough to
        // recompute every frame for several seconds.
        const grab = () => {
            const d = ctx.getImageData(bx, by, bw, bh).data;
            const s = [];
            for (let i = 0; i < d.length; i += 16) s.push(d[i], d[i + 1], d[i + 2]);
            return s;
        };
        await frame();
        const ref = grab();
        const flat = new Set(ref).size <= 3;
        const t0 = performance.now();
        const trace = [];
        while ((performance.now() - t0) / 1000 < watchSec) {
            await frame();
            const now = grab();
            let sum = 0;
            for (let i = 0; i < ref.length; i++) sum += Math.abs(ref[i] - now[i]);
            trace.push([(performance.now() - t0) / 1000, sum / ref.length]);
        }
        // peak divergence tells us it moved at all; the first strong return to
        // the reference phase after that is the loop time.
        const peak = Math.max(...trace.map((p) => p[1]));
        let ret = null;
        for (const [t, e] of trace) {
            if (t < 1.0) continue;
            if (e < peak * 0.25 && (ret === null || e < ret[1])) ret = [t, e];
        }
        return { box: [bx, by, bw, bh], flat, peak, loop: ret?.[0] ?? null, resid: ret?.[1] ?? null };
    };

    const results = [];
    for (const b of boxes) results.push(await track(b));
    results.sort((p, q) => q.peak - p.peak);
    return results[0];
}, { boxes, watchSec: 4.6 });

const failures = [];
for (const screen of SCREENS) {
    if (screen.seedLab) await page.evaluate((n) => window.__labOpen(n), screen.seedLab);
    await page.evaluate((n) => window.__labOpen(n), screen.lab);
    await page.waitForTimeout(900);
    if (screen.session) {
        // A screen that loads its tables before it draws (the naming screen
        // reads two text banks and a data tail) has no picture calls for a
        // while, and sampling then would measure the screen that was up before.
        const drawing = await page.waitForFunction((handle) => {
            const s = window[handle];
            const calls = s?._session?.draw?.calls ?? s?._host?.rt?.drawCalls ?? [];
            return calls.length > 0;
        }, screen.session, { timeout: 10000 }).then(() => true).catch(() => false);
        if (!drawing) failures.push(`${screen.name}: ${screen.session} never issued a picture call; ` +
            `the screen may not have opened at all`);
    }
    await page.locator("canvas#game").screenshot({ path: `${out}/${screen.name}.png` });

    if (screen.bare === false) {
        // No wall call at all: the list is over the field, as the disc draws it.
        const r = await sampleWall(screen.session ?? "__status", screen.wallClip ?? 0x1d, 1.5);
        const ok = r.length === 0;
        console.log(`${ok ? "ok  " : "FAIL"} ${screen.name.padEnd(10)} no wall call over the field ` +
            `(saw ${r.length} phase${r.length === 1 ? "" : "s"})`);
        if (!ok) failures.push(`${screen.name}: the START list drew the pause wall ${r.length} times; ` +
            `the disc draws it over the live field (pause-field-home-2026-08-20.png)`);
        continue;
    }

    let pixelOk = true;
    let loop = "n/a";
    let detail = "";
    if (screen.boxes) {
        const r = await trackLoopTime(screen.boxes);
        loop = r.loop === null ? "never" : r.loop.toFixed(2) + "s";
        pixelOk = !r.flat && r.peak > 3 && r.loop !== null
            && Math.abs(r.loop - WALL_LOOP_SEC) <= WALL_LOOP_TOLERANCE_SEC;
        if (!pixelOk) {
            failures.push(
                `${screen.name}: wall phase loop ${r.loop === null ? "never returned" : r.loop.toFixed(2) + "s"}, ` +
                `expected ${WALL_LOOP_SEC}s (96px at 25px/s); peak divergence ${r.peak.toFixed(1)}` +
                `${r.flat ? "; sample region is flat" : ""}`);
        }
        detail = ` peak=${r.peak.toFixed(1)} resid=${r.resid?.toFixed(2) ?? "-"} box=${r.box.join(",")}`;
        if (r.flat) detail += " FLAT";
    }

    let position = "";
    let positionOk = true;
    if (screen.wallClip) {
        const m = measureWallPhase(await sampleWall(screen.session, screen.wallClip, WATCH_SEC));
        position = ` ${describeWallPhase(m)}`;
        const faults = wallPhaseFaults(m);
        positionOk = faults.length === 0;
        if (!positionOk) {
            failures.push(`${screen.name}: the wall it asked for over ${WATCH_SEC}s — ${faults.join("; ")}`);
        }
    }

    console.log(
        `${pixelOk && positionOk ? "ok  " : "FAIL"} ${screen.name.padEnd(10)} ` +
        `loop=${loop} (want ${WALL_LOOP_SEC}s)${detail}${position}`);
}
await browser.close();
console.log("done ->", out);
if (failures.length) {
    console.error("\nwalls not scrolling at the decoded rate:\n" + failures.join("\n"));
    process.exit(1);
}
