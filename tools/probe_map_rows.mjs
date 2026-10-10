// MAP row probe: boot the pause host with row 2 (MAP) and row 3 (TECHNIQUES),
// seed a real party, confirm a Digimon, and compare what each row shows.
// tools/run-playwright.sh tools/probe_map_rows.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/native-screen-lab.html?bridge=1`;
const OUT = process.env.MAP_SHOT || "/tmp/opencode/map-rows";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

const rows = {};
for (const [row, name] of [[2, "map"], [3, "techniques"], [4, "status"]]) {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__nativeScreenList?.().length > 0, null, { timeout: 60000 });
    const info = await page.evaluate((rowV) => {
        window.__nativeScreenBoot("pro/ststatus");
        // Same js task, before the host's first tick: pick the page and give the
        // panels real data (the page reads the resident save context).
        window.__nativeScreenWrite(0x8005ccf0, rowV, 4);
        window.__nativeScreenWrite(0x8005ccf4, 0, 4);
        window.__nativeScreenSeedParty({
            positions: [0, 1, 0xffffffff],
            stats: [
                { slot: 0, name: "Kotemon", level: 12, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25, exp: 0 },
                { slot: 1, name: "Renamon", level: 12, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25, exp: 0 },
            ],
        });
        window.__nativeScreenWrite(0x80048da0, 4321, 4);
        return true;
    }, row);
    void info;
    // Wait for the fold-in, then confirm the first Digimon.
    await page.waitForFunction(() => {
        const objs = window.__nativeScreenObjects();
        return objs.length > 1 && (window.__nativeScreen().frames ?? 0) > 40;
    }, null, { timeout: 30000 });
    const before = await page.evaluate(() => window.__nativeScreenTextDump().map((w) => w.decoded.map((d) => d.text).join("|")).filter(Boolean));
    await page.screenshot({ path: `${OUT}/row${row}-${name}-before.png` });
    // Circle: hold one frame, release (the pad is edge-detected by the next tick).
    const f0 = await page.evaluate(() => window.__nativeScreen().frames);
    await page.evaluate(() => window.__nativeScreenPad(0x2000));
    await page.waitForFunction((n) => window.__nativeScreen().frames > n + 2, f0, { timeout: 5000 });
    await page.evaluate(() => window.__nativeScreenPad(0));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/row${row}-${name}-after.png` });
    const after = await page.evaluate(() => {
        const objects = window.__nativeScreenObjects();
        const texts = window.__nativeScreenTextDump().map((w) => w.decoded.map((d) => d.text).join("|")).filter(Boolean);
        return { objects: objects.length, texts: texts.slice(0, 14) };
    });
    rows[name] = { before: before.slice(0, 14), after: after.texts };
    await page.waitForTimeout(300);
}

console.log(JSON.stringify(rows, null, 1));
writeFileSync(`${OUT}/rows.json`, JSON.stringify(rows, null, 1) + "\n");
await browser.close();
