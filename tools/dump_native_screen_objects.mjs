// Dump the runtime's live objects with selected fields, to see a screen's
// state machines advance. Env: MOD, FRAMES, FIELDS (hex offsets, comma).
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MOD = process.env.MOD || "pro/stdwtitl";
const FRAMES = Number(process.env.FRAMES || 30);
const FIELDS = (process.env.FIELDS || "0xc,0x10,0x54").split(",").map((s) => parseInt(s, 16));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded" });
await page.click('button[data-scr="nativescreen"]');
await page.waitForURL(/native-screen-lab\.html/);
await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
await page.evaluate((m) => window.__nativeScreenBoot(m), MOD);
await page.waitForFunction((n) => window.__nativeScreen().frames >= n, FRAMES, { timeout: 10000 });
const out = await page.evaluate((fields) => window.__nativeScreenObjects().map((o) => ({
    addr: o.addr, cb: o.cb, alive: o.alive,
    fields: fields.map((f) => window.__nativeScreenRead((o.addr + f) >>> 0, 4)),
})), FIELDS);
console.log(`${MOD} objects=${out.length}`);
for (const o of out) console.log(`  0x${o.addr.toString(16)} cb=0x${o.cb.toString(16)} alive=${o.alive} fields=${JSON.stringify(o.fields)}`);
await browser.close();
