import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";
import { baseUrl } from "./verify-base-url.mjs";

// Bounded check for the shared loaded-technique price (plan section 6.1,
// TL-010 / FIGHTSTG_F0x800a1d3c). It starts the real battle through
// web/battle-test.html's production createBattle path, seeds the persistent
// roster fixture from the URL, then opens the ordinary Tech menu and confirms
// one command. Only the debit is observed; the same techniqueMpCost result is
// what drawTechMenu prints as the row's MP.
//
// Start the repo server first:
//   python3 -m http.server 8742 --directory web
// Then:
//   tools/run-playwright.sh tools/verify_tech_mp_cost.mjs
//
// Tech 190 ("Antidote", digimon.json) has Unknown3 base MP 8 — the reduced
// 1-4 band this fix is about when an MPProxy (5) is worn.
const BASE = process.env.BATTLE_TEST_URL || `${baseUrl(8742)}/battle-test.html`;
const TECH = 190;
const BASE_MP = 8;
const cases = [
  { name: "native_proxy5", load: "0", proxy: "5", expected: BASE_MP - 5 },              // 3
  { name: "loaded_proxy5", load: "1", proxy: "5", expected: Math.max(1, BASE_MP - 5) + 1 }, // 4
  { name: "loaded_proxy10", load: "1", proxy: "10", expected: 1 + 1 },                  // 2
  { name: "loaded_plain", load: "1", proxy: "0", expected: BASE_MP + 1 },               // 9
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const c of cases) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("PAGE", c.name, e));
    const url = `${BASE}?tech=${TECH}&load=${c.load}&proxy=${c.proxy}`;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#formSel")?.options.length > 0);
    await page.click("#startBtn");
    await waitForCommandMenu(page);

    const before = await page.evaluate(() => {
      const b = window.__battleB();
      return { mp: b.player.mp, name: b.player.profile.name, form: b.player.profile.id };
    });
    // Ordinary buttons: move the command cursor to Tech and confirm.
    await page.evaluate(() => window.__battleTest.handleKey("arrowdown"));
    await page.evaluate(() => window.__battleTest.handleKey("enter"));
    await page.waitForFunction(() => window.__battleB?.()?.state === 3, { timeout: 5_000 });
    const menu = await page.evaluate(() => {
      const b = window.__battleB();
      return { state: b.state, techSel: b.techSel, mp: b.player.mp };
    });
    if (process.env.TECH_SHOT)
      writeFileSync(`${process.env.TECH_SHOT}/tech-menu-${c.name}-before.png`,
        Buffer.from((await page.locator("#c").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

    await page.evaluate(() => window.__battleTest.handleKey("enter"));
    // The action's line ("Kotemon uses Antidote!") waits to be read, as every
    // battle line now does (verify-battle-wait.mjs); the price is paid when the
    // action goes on. One Circle reads it; press again only while MP is unpaid.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(600);
      if (await page.evaluate((mp0) => window.__battleB().player.mp < mp0, before.mp)) break;
      await page.evaluate(() => window.__battleTest.handleKey("enter"));
    }
    await page.waitForFunction(
      (mp0) => window.__battleB?.()?.player?.mp < mp0,
      before.mp,
      { timeout: 20_000 },
    );
    const after = await page.evaluate(() => ({ mp: window.__battleB().player.mp, message: window.__battleB().message }));
    if (process.env.TECH_SHOT)
      writeFileSync(`${process.env.TECH_SHOT}/tech-cast-${c.name}-after.png`,
        Buffer.from((await page.locator("#c").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

    const spent = before.mp - after.mp;
    results.push({ case: c.name, ...before, menu, ...after, spent, expected: c.expected });
    if (spent !== c.expected)
      throw new Error(`${c.name}: spent ${spent} MP, expected ${c.expected} (${JSON.stringify({ before, menu, after })})`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ ok: true, baseMp: BASE_MP, results }, null, 2));
