/**
 * Drive battle-test.html through a tech (signature) attack and report
 * what pose each digimon has before, during, and after the attack.
 *
 * Usage:
 *   tools/run-playwright.sh web/test-tech-pose.mjs
 */

import { chromium } from "playwright";
import { resolveModelFolder } from "./battle3d.js";
import { techToClip, techRecord } from "./fight/fight-tables.js";

const out = process.env.OUT_DIR ?? "/tmp/tech-pose";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

await page.goto(new URL("./battle-test.html", import.meta.url).href);

// Wait for model selector to populate
await page.waitForSelector("#playerSel option:nth-child(2)", { timeout: 15000 });

// Select Renamon as player (should be in the list)
const playerSel = await page.$("#playerSel");
const options = await playerSel.$$("option");
let renamonIdx = 0;
for (let i = 0; i < options.length; i++) {
  const text = await options[i].textContent();
  if (text.toLowerCase().includes("renamon")) {
    renamonIdx = i;
    break;
  }
}
await page.evaluate((idx) => {
  document.querySelector("#playerSel").selectedIndex = idx;
}, renamonIdx);

// Trigger form refresh
await page.evaluate(() => {
  document.querySelector("#formSel").dispatchEvent(new Event("change"));
});

// Select enemy (Agumon)
const enemySel = await page.$("#enemySel");
const eOptions = await enemySel.$$("option");
let agumonIdx = 0;
for (let i = 0; i < eOptions.length; i++) {
  const text = await eOptions[i].textContent();
  if (text.toLowerCase().includes("agumon")) {
    agumonIdx = i;
    break;
  }
}
await page.evaluate((idx) => {
  document.querySelector("#enemySel").selectedIndex = idx;
}, agumonIdx);

// Click Start Battle
await page.$$("#startBtn")[0].click();

// Wait for battle to start and render
await new Promise(r => setTimeout(r, 3000));

// Try to take a screenshot
await page.screenshot({ path: `${out}/battle-start.png`, fullPage: false });

console.log("Battle started, screenshot saved. Check canvas and status.");

// Now try to navigate to a tech selection
// In the actual game flow, after "Start Battle":
// 1. Player menu appears
// 2. Arrow down to "tech" tab
// 3. Arrow down to a tech
// 4. Confirm

// Let's try to advance through the menu
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("ArrowDown");
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: `${out}/menu-step-${i}.png`, fullPage: false });
}

// Try Enter to select
await page.keyboard.press("Enter");
await new Promise(r => setTimeout(r, 2000));
await page.screenshot({ path: `${out}/after-enter.png`, fullPage: false });

// Check what's on screen
const status = await page.$eval("#status", el => el.innerText);
console.log("Status:", status);

// Try to access renderer3d to see what's happening
const renderer = await page.evaluate(() => {
  return window.battle?.battle3d?.renderer3d || window.__battle3d;
});
console.log("Renderer:", renderer);

await browser.close();
console.log("Done. Check screenshots in", out);
