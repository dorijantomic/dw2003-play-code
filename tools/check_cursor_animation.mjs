// Focused proof for the timebase fix: the shop's native selection pointer must
// advance its animation frame index (+0x6C) under the real engine/native tick.
// Before the fix the tick counter was overwritten with the frame delta, so the
// gate never fired and +0x6C stayed 0 forever.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MODULE = "pro/stitshop";
const OUT = "/tmp/cursor-animation";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/);
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
    await page.waitForFunction(() => {
        const s = window.__nativeScreen?.();
        return s && s.booted && s.frames >= 3;
    }, null, { timeout: 10000 });

    // There is more than one cursor object; the hidden ones sit at +0x64 = 0 and
    // never animate, so the check follows the VISIBLE pointer (+0x64 != 0).
    const sample = () => page.evaluate(() => {
        const objs = window.__nativeScreenObjects();
        const cursors = objs.filter((o) => o.cb === 0x8001b0a4 && o.alive).map((o) => ({
            addr: o.addr,
            idx: window.__nativeScreenRead((o.addr + 0x6c) >>> 0, 4) >>> 0,
            phase: window.__nativeScreenRead((o.addr + 0x10) >>> 0, 4) >>> 0,
            visible: window.__nativeScreenRead((o.addr + 0x64) >>> 0, 4) >>> 0,
        }));
        const s = window.__nativeScreen();
        return { frame: s.frames, traps: s.traps, cursors, cursor: cursors.find((c) => c.visible !== 0) ?? null };
    });

    const samples = [];
    const seen = new Set();
    let early = null;
    let anim = null;
    for (let i = 0; i < 200; i++) {
        const s = await sample();
        samples.push(s);
        if (s.cursor !== null) {
            seen.add(s.cursor.idx);
            if (early === null) {
                early = s;
                await page.screenshot({ path: `${OUT}/cursor-rest.png` });
            }
            if (s.cursor.idx >= 2 && anim === null) {
                anim = s;
                await page.screenshot({ path: `${OUT}/cursor-step.png` });
                break;
            }
        }
        await page.waitForTimeout(50);
    }
    writeFileSync(`${OUT}/samples.json`, JSON.stringify({ module: MODULE, early, anim, samples, errors }, null, 1) + "\n");

    const problems = [];
    if (early === null) problems.push("visible cursor object (cb=0x8001b0a4, +0x64 != 0) not found");
    if (anim === null) problems.push("cursor glyph index never advanced past 1");
    if (seen.size < 2) problems.push(`cursor glyph index never changed (saw ${[...seen].join(",")})`);
    if (errors.length) problems.push(`page errors: ${errors.join("; ")}`);
    if (samples.some((s) => s.traps !== 0)) problems.push("traps on the shop path");
    if (problems.length) {
        console.error(`FAIL cursor animation: ${problems.join("; ")}`);
        await browser.close();
        process.exit(1);
    }
    console.log(`PASS cursor animation: rest idx=${early.cursor.idx} frame=${early.frame} -> idx=${anim.cursor.idx} frame=${anim.frame}`);
} finally {
    await browser.close();
}
