// Headless screenshot verifier for the native "Choose a Starter Pack" screen.
// Usage: ~/.local/share/playwright-shot/run.sh tools/verify_packselect.mjs [outdir]
// Requires: cd web && python3 -m http.server 8742
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/packselect";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// skipLanguage=1 skips the PAL boot country/language screen, which would
// otherwise cover the title this check clicks through.
await page.goto(`${baseUrl(8742)}/?skipLanguage=1`, { waitUntil: "load" });
await page.waitForFunction(
  () => window.__state && document.getElementById("title-newgame")?.onclick,
  null, { timeout: 30000 });
// The native title hides the walker's HTML button (its canvas draws the menu),
// so click it through the DOM rather than by visibility.
await page.evaluate(() => document.getElementById("title-newgame").click());
await page.waitForFunction(() => window.__state?.started, null, { timeout: 10000 });
await page.waitForTimeout(2000);

await page.evaluate(async () => {
  const mod = await import("/stplnmet.js");
  const s = window.__state;
  s.packSelect = mod.createPackSelect();
  s.packSelectDone = () => { s.packSelect = null; };
});
const key = (kk) => page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k })), kk);
for (const [n, presses] of [["A", 0], ["B", 1], ["C", 2]]) {
  await page.waitForTimeout(400);
  await page.locator("canvas#game").screenshot({ path: `${out}/pack_${n}.png` });
  console.log("shot pack_" + n);
  await key("ArrowDown");
}
await browser.close();
