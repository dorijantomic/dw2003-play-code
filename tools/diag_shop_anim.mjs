// Capture mid-fold frames of the shop window animations (scratch).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/shopanim";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${baseUrl(8741)}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state && window.__shop, null, { timeout: 30000 });
await page.click("#title-newgame");
await page.waitForFunction(() => window.__state?.started, null, { timeout: 10000 });
await page.evaluate(() => {
  if (window.__state.nameEntry) { window.__state.nameEntry = null; window.__state.nameEntryDone = null; }
});
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const s = window.__state;
  s.bits = 130821;
  window.__shop.open([1, 2, 3, 4, 5, 6, 21, 22], null, { name: "Suzaku Item Shop" });
});
await page.waitForTimeout(60);  // ~1/3 through the 0.18s root fold
await page.screenshot({ path: `${out}/a_root_mid.png` });
await page.waitForTimeout(600);
// enter the list and catch the y-fold mid-way
await page.evaluate((k) => window.__shop.handleKey(k, window.__state), "enter");
await page.waitForTimeout(70);
await page.screenshot({ path: `${out}/b_list_mid.png` });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/c_list_done.png` });
await browser.close();
console.log("done ->", out);
