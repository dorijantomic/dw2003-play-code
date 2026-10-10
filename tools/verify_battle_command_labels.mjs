import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";
import { baseUrl } from "./verify-base-url.mjs";

// Presentation row BATTLE-HUD-COMMANDS-001: the six command labels sit at the
// decoded (0x24, 0x6d + 19*index) on layer 0x1005 (claim
// battle-command-window-labels-2026-08-19). This opens the real game shell,
// starts a battle through the production entry, and captures the command menu
// so the before/after label origin can be compared against the decode.
//
// Server: python3 -m http.server 8754 --directory web   (or VERIFY_PORT=<port>)
// Run:    LABEL_SHOT=<dir> tools/run-playwright.sh tools/verify_battle_command_labels.mjs
const ROOT = process.env.LABEL_ROOT || `${baseUrl(8754)}/`;
const OUT = process.env.LABEL_SHOT || "/tmp/battle-labels";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("labelFixture")) return;
  sessionStorage.setItem("labelFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", "null");
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10) });

try {
  await page.goto(ROOT + "?skipTitle=1&map=s245&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 2, enemyLevel: 1, screenId: 5, onWin() {}, onFlee() {}, onLose() {} });
  });
  await waitForCommandMenu(page);
  await page.waitForTimeout(1200);
  writeFileSync(`${OUT}/command-menu.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
} finally {
  await browser.close();
}
if (errors.length) { console.error(JSON.stringify({ errors })); process.exit(1); }
console.log(JSON.stringify({ ok: true, out: OUT }, null, 2));
