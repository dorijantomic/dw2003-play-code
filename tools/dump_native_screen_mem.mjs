// Read native screen RAM after boot+ticks for focused debugging.
// Env: MOD (module), ADDRS (comma hex), FRAMES.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MOD = process.env.MOD || "pro/stdwtitl";
const ADDRS = (process.env.ADDRS || "0x80088234,0x8005CCA8").split(",").map((s) => parseInt(s, 16) >>> 0);
const FRAMES = Number(process.env.FRAMES || 60);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded" });
await page.click('button[data-scr="nativescreen"]');
await page.waitForURL(/native-screen-lab\.html/);
await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
await page.evaluate((m) => window.__nativeScreenBoot(m), MOD);
await page.waitForFunction((n) => window.__nativeScreen().frames >= n, FRAMES, { timeout: 10000 });
const out = await page.evaluate((addrs) => addrs.map((a) => ({ addr: a, u32: window.__nativeScreenRead(a, 4), u16: window.__nativeScreenRead(a, 2) })), ADDRS);
console.log(MOD, JSON.stringify(out));
await browser.close();
