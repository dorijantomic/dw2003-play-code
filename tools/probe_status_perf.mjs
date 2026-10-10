// Perf probe: boot time and fold-in time of the native pause page, plus the
// per-tick cost and the live frame rate.
// tools/run-playwright.sh tools/probe_status_perf.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.PERF_SHOT || "/tmp/opencode/status-perf";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
const bootMs = await page.evaluate(() => {
    window.__state.bits = 4321;
    window.__state.party = ["p003pken", "p006rna", null];
    window.__state.partnerStats = { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 };
    window.__state.partyStats = [
        { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        null,
    ];
    const t0 = performance.now();
    window.__labOpen("status", "status");
    return performance.now() - t0;
});
console.log("open() returned after", bootMs.toFixed(1), "ms");
const t1 = Date.now();
await page.waitForFunction(() => (window.__status?.diagnostics?.().screen?.childUnk10 ?? 0) === 11, null, { timeout: 60000 });
console.log("picker interactive after", Date.now() - t1, "ms (from after open)");

const perf = await page.evaluate(() => {
    const st = window.__status;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) st.update(16.7);
    const tickMs = (performance.now() - t0) / 20;
    const d = st.diagnostics();
    const byCb = {};
    for (const o of d.screen.objects) byCb[o.cb] = (byCb[o.cb] ?? 0) + 1;
    const f0 = d.renderer.frames;
    const p0 = performance.now();
    return new Promise((res) => setTimeout(() => {
        const f1 = st.diagnostics().renderer.frames;
        const p1 = performance.now();
        res({ tickMs, byCb, fps: (f1 - f0) / ((p1 - p0) / 1000), frames: [f0, f1], objects: d.screen.objects.length });
    }, 1500));
});
console.log(JSON.stringify(perf, null, 1));
writeFileSync(`${OUT}/perf.json`, JSON.stringify(perf, null, 1) + "\n");
await browser.close();
