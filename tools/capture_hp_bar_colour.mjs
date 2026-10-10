// Captures the battle HUD's HP bar either side of the decoded quarter-HP line.
// Start the repository's battle server first:
//   python3 -m http.server 8742 --directory web
// Then:
//   tools/run-playwright.sh tools/capture_hp_bar_colour.mjs [outDir]
import { chromium } from "playwright";
import fs from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const url = process.env.BATTLE_TEST_URL || "http://127.0.0.1:8742/battle-test.html";
const out = process.argv[2] || "/tmp/hp-bar";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on("pageerror", (error) => console.error("PAGE", error));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#formSel")?.options.length > 0);
  await page.selectOption("#playerSel", "4");
  await page.fill("#playerLevel", "99");
  await page.selectOption("#enemySel", "1");
  await page.fill("#enemyLevel", "1");
  await page.click("#startBtn");
  await waitForCommandMenu(page);

  const max = await page.evaluate(() => window.__battleB().player.maxHp);
  const quarter = Math.trunc(max / 4);
  for (const [name, hp] of [["above-quarter", quarter + 1], ["at-quarter", quarter], ["one-hp", 1]]) {
    await page.evaluate((v) => { window.__battleB().player.hp = v; }, hp);
    await page.waitForTimeout(400);
    await page.locator("#c").screenshot({ path: `${out}/${name}.png` });
    console.log(`${name}: player HP ${hp} of ${max} (quarter = ${quarter}) -> ${out}/${name}.png`);
  }
} finally {
  await browser.close();
}
