// Before/after capture for the low-HP stance fix: BetaMon's basic attack (clip 5) ends with the
// script's "return to your base idle" record. Healthy -> the normal idle; low HP -> the low-HP
// stance. Captures the tail pose in both HP states.
import { chromium } from "playwright";
import fs from "fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/low-hp";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.goto(`${baseUrl(8123)}/fight-action-lab.html`);
await page.waitForFunction(() => !!window.__r, null, { timeout: 30000 });
await page.waitForTimeout(2500);   // let the lab finish its own default spawn first
await page.evaluate(() => { window.__r.setPlayerDigimon("m004beta"); window.__r.setEnemyDigimon(null); });
await page.waitForFunction(() => (window.__r.debugTimelineTables() || []).length > 0, null, { timeout: 30000 });
console.log("tables:", await page.evaluate(() => window.__r.debugTimelineTables().length));

for (const [name, low] of [["healthy", false], ["low-hp", true]]) {
  await page.evaluate((l) => {
    window.__r.setFighterBaseIdle("player", l);
    window.__r.playPlayerActionClip(5);
  }, low);
  await page.waitForTimeout(5000);            // ~300 logic ticks: the action's tail
  const table = await page.evaluate(() => window.__r.playerAnimator?.timelineTable);
  await page.locator("#c").screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${OUT}/${name}.png  (bound timeline table = ${table})`);
}
// What the two resting poses actually are, played straight from Renamon's timeline: table 0 is the
// normal idle, table 1 is the low-HP stance the tail of every attack script returns to.
await page.evaluate(() => window.__r.setPlayerDigimon("m373rena"));
await page.waitForTimeout(2500);
for (const [name, idx] of [["renamon-idle", 0], ["renamon-lowhp", 1]]) {
  await page.evaluate((i) => window.__r.debugPlayPlayerTable(i), idx);
  await page.waitForTimeout(1200);
  await page.locator("#c").screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${OUT}/${name}.png (timeline table ${idx})`);
}

await browser.close();
