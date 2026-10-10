// Print one frame's recorded draw intents for a native screen root (order matters:
// the renderer paints last-recorded first). Env: MOD, FRAMES.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MOD = process.env.MOD || "pro/stdwtitl";
const FRAMES = Number(process.env.FRAMES || 20);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded" });
await page.click('button[data-scr="nativescreen"]');
await page.waitForURL(/native-screen-lab\.html/);
await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
await page.evaluate((m) => window.__nativeScreenBoot(m), MOD);
await page.waitForFunction((n) => window.__nativeScreen().frames >= n, FRAMES, { timeout: 10000 });
// The lab's raf loop clears drawCalls each tick; read it right after a frame.
const frames = await page.evaluate(() => { const s = window.__nativeScreen(); return s.frames; });
const draws = await page.evaluate(() => window.__nativeScreenDraws());
console.log(`${MOD} frames=${frames} draws=${draws.length}`);
for (const d of draws) console.log(`  ${d.method} ${d.args.map((a) => (a > 0xffff ? "0x" + a.toString(16) : a)).join(" ")}`);
await browser.close();
