// Battle-lab probe: does the in-game battle renderer draw MetalTyrannomon coherently?
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = "/home/dorij/scratch-research/giant/battlelab";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/battle-lab.html`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__r, null, { timeout: 40000 });
await page.waitForTimeout(1500);
const names = await page.evaluate(() => (window.__r.listModels ? window.__r.listModels() : null));
console.log("models api", JSON.stringify(names).slice(0, 300));
await page.evaluate(() => { const c = document.getElementById("cam"); if (c) { c.value = "orbit"; c.dispatchEvent(new Event("change")); } });
for (const who of ["m140mtrn", "m203trcr"]) {
  await page.evaluate((n) => { try { window.__r.setEnemyDigimon(n); } catch (e) { console.log("setEnemy failed", e.message); } }, who);
  await page.waitForTimeout(2500);
  const cv = await page.$("#cv");
  writeFileSync(`${OUT}/${who}.png`, await cv.screenshot());
  const readout = await page.evaluate(() => { try { return window.__r.getAnimationReadout?.(); } catch (e) { return String(e); } });
  console.log(who, JSON.stringify(readout).slice(0, 400));
}
await browser.close();
console.log("done");
