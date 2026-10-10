// Player-visible check: the s415 Deeper Crevice SCENERY LAYER, in ORDINARY play.
//
// WHAT IT SHOWS AND WHY.  On the crevice the player stands on a fixed platform
// and the world looks like it moves because the crevice's own scenery -- the
// rock wall with its pipes, rails and struts -- SLIDES across the screen behind
// the platform.  This layer (registry id 0x32c, engine/systems/point-record-
// actor.ts `scroll-layer`) is built by the stage itself, gated on story flag
// 0x4018:
//
//   * FIRST VISIT (flag clear): the picture slides up-and-right at a constant
//     8 px right / 4 px up per PAL blank, and the arrival event's
//     `SETANIM 812 822` (web/assets/events/wstag_events.json s415 event 150,
//     after its WAIT 180) eases it to a stop -- speed 0x800 -> 0 in steps of
//     0x10 a blank.
//   * REVISIT (flag set): the same object is built but never gains a speed, so
//     its offset stays 0 and it is a still backdrop.
//
// The numbers are read PER FRAME from `window.__stageObjects.scrollLayers`, the
// engine's own live geometry, so nothing here is inferred from averaged pixels.
// The two screenshot pairs are the before/after for the eye.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_scroll_layer.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/shots/scroll-layer";
const PORT = Number(process.env.VERIFY_PORT ?? 8788);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => { logs.push(`pageerror: ${e.message}`); fails.push(`pageerror: ${e.message}`); });

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
    if (!ok) fails.push(name);
};

/** Boot s415 the ordinary way, no ?nativeStages, and settle. */
async function enter() {
    await page.goto(`${baseUrl(PORT)}?skipTitle=1&map=s415`);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 25000 });
    await page.waitForTimeout(1200);
}

/**
 * Read the layer's live geometry once per animation frame.  `fireSub` (when
 * given) arms `SETANIM 812 822` from a frame in, exactly as the arrival event
 * does; the ease is what follows.
 */
async function sampleRun(frames, fireSubAt) {
    return page.evaluate(async ({ n, fireAt }) => {
        const so = await import("/stage-objects.js");
        const out = [];
        for (let i = 0; i < n; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            if (fireAt !== null && i === fireAt) so.fireStageObject("s415", 812, 822);
            const d = (window.__stageObjects.scrollLayers("s415") ?? [])[0] ?? null;
            out.push(d ? { x: d.x, y: d.y, visit: d.visit, xs: d.xSpeed, ys: d.ySpeed } : null);
        }
        return out;
    }, { n: frames, fireAt: fireSubAt ?? null });
}

try {
    // ── FIRST VISIT ──────────────────────────────────────────────────────
    await enter();
    // A fresh boot has flag 0x4018 clear; make it explicit so the check does
    // not depend on the save's own history.
    await page.evaluate(async () => {
        window.__storyFlags.set(0x4018, 0);
        const so = await import("/stage-objects.js");
        so.clearStageObjects("s415");
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/s415-first-before.png` });

    const first = await sampleRun(40, null);
    check("first visit: the scenery layer is live", first.some((d) => d && d.visit === 0),
        JSON.stringify(first[0]));
    // The constant slide: the engine's own 8.8 speed is the full 0x800 across /
    // 0x400 up (the disc's 8 px / 4 px per PAL blank) until the ease.
    const withLayer = first.filter(Boolean);
    const steady = withLayer.slice(-20);
    check("first visit: it slides at 8 px right / 4 px up per blank",
        steady.every((d) => d.xs === 0x800 && d.ys === 0x400),
        `x speed ${[...new Set(withLayer.map((d) => d.xs))].join(",")}`);
    const dx = withLayer.slice(1).map((d, i) => d.x - withLayer[i].x);
    const dy = withLayer.slice(1).map((d, i) => d.y - withLayer[i].y);
    check("first visit: the picture moves RIGHT and UP", dx.some((v) => v > 0)
        && dy.some((v) => v < 0),
        `x steps ${[...new Set(dx)].sort((a, b) => a - b).join(",")}`
        + ` | y steps ${[...new Set(dy)].sort((a, b) => a - b).join(",")}`);
    const moved = withLayer[withLayer.length - 1];
    check("first visit: the picture has slid before the ease",
        moved.x !== 0 && moved.y !== 0x100, `x ${moved.x}, y ${moved.y}`);
    await page.screenshot({ path: `${OUT}/s415-first-sliding.png` });

    // Now the ease: fire the arrival event's own SETANIM 812 822 and watch the
    // speed fall to zero, 0x10 a blank.  (A frame may cover more than one PAL
    // blank, so the decay is a multiple of 0x10 -- but it is monotone and lands
    // exactly on 0.)
    const ease = await sampleRun(260, 3);
    const easeLayer = ease.filter(Boolean);
    const speeds = easeLayer.map((d) => d.xs);
    const decayed = speeds.filter((v) => v !== 0x800);
    check("the ease: the speed starts at the full 0x800 and only falls",
        speeds.includes(0x800) && decayed.every((v, i, a) => i === 0 || v <= a[i - 1]),
        `speeds ${[...new Set(speeds)].slice(0, 8).join(",")} ...`);
    check("the ease: every step is a multiple of the 0x10 decay",
        decayed.every((v) => (0x800 - v) % 0x10 === 0),
        `saw ${[...new Set(decayed)].slice(0, 8).join(",")}`);
    check("the ease: it reaches 0 and holds (the slide stops)",
        speeds[speeds.length - 1] === 0 && speeds.slice(-40).every((v) => v === 0),
        `last speeds ${speeds.slice(-40).join(",")}`);
    check("the ease: the vertical speed is always half the horizontal",
        easeLayer.every((d) => d.ys === (d.xs >> 1)),
        `last pair ${easeLayer[easeLayer.length - 1].xs}/${easeLayer[easeLayer.length - 1].ys}`);
    const last = easeLayer[easeLayer.length - 1];
    check("the ease: the picture is left on screen, stopped",
        last.xs === 0 && last.ys === 0, `x ${last.x}, y ${last.y}`);
    await page.screenshot({ path: `${OUT}/s415-first-stopped.png` });

    // ── REVISIT ──────────────────────────────────────────────────────────
    await page.evaluate(async () => {
        window.__storyFlags.set(0x4018, 1);
        const so = await import("/stage-objects.js");
        so.clearStageObjects("s415"); // force the layer to be rebuilt
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/s415-revisit-before.png` });
    const revisit = await sampleRun(120, null);
    const revLayer = revisit.filter(Boolean);
    check("revisit: the same object is built (visit word 1)",
        revLayer.length > 0 && revLayer.every((d) => d.visit === 1),
        JSON.stringify(revLayer[0]));
    check("revisit: it stays STATIC -- x never leaves 0",
        revLayer.every((d) => d.x === 0),
        `x seen ${[...new Set(revLayer.map((d) => d.x))].join(",")}`);
    check("revisit: and y never leaves its 0x100 bias",
        revLayer.every((d) => d.y === 0x100),
        `y seen ${[...new Set(revLayer.map((d) => d.y))].join(",")}`);
    await page.screenshot({ path: `${OUT}/s415-revisit-still.png` });

    // ── the layer is not the interpreter ─────────────────────────────────
    const native = await page.evaluate(async () => {
        const ns = await import("/native-stage.js");
        return ns.nativeStage("s415") !== null;
    });
    check("s415 is not running the original overlay machine code", !native);
} finally {
    console.log("VERDICT", fails.length === 0 ? "OK" : `FAIL ${fails.join("; ")}`);
    console.log("--- console log ---");
    for (const l of logs.slice(-30)) console.log(l);
    await browser.close();
    if (fails.length) process.exitCode = 1;
}
