// tools/verify_escape_roll.mjs
//
// Headless check that a Run from a battle still resolves, through the real web/game.js
// and the rebuilt engine bundle. The player's Run is F0x800a1608 side 0 (fightstg): a
// 0..127 roll under (base+1)*8 + level advantage + speed advantage (faster only) + the
// Runner Sandal/Shoes bonus. This check drives one Run that MUST escape (the player is
// vastly faster than the enemy) and one that MUST NOT (the player is far slower and not
// higher level), and reads the battle's own words for each.
//
// Server: python3 -m http.server 8788 --directory web
// Run:    VERIFY_PORT=8788 tools/run-playwright.sh tools/verify_escape_roll.mjs
import { chromium } from "playwright";
import { waitForCommandMenu, runBattleTurn, tapCircle } from "./verify-battle-wait.mjs";

const PORT = process.env.VERIFY_PORT || 8788;
const ROOT = process.env.PROBE_ROOT || `http://127.0.0.1:${PORT}/`;

const member = (digimonId, spd) => ({ digimonId, level: 10, xp: 0, tp: 10, hp: 9999, maxHp: 9999, mp: 999, maxMp: 999,
  stats: { str: 50, def: 50, spt: 60, wis: 50, spd, chr: 30 }, bonuses: {}, elemBonuses: {} });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

/** Boot with a chosen player SPD so the run threshold is decided before we press. */
async function boot(playerSpd) {
  await page.addInitScript((seed) => {
    localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior"); localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("bits", "1000"); localStorage.setItem("inventory", JSON.stringify([]));
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
  }, { lead: member(1, playerSpd) });
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
  await page.waitForTimeout(400);
}

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);

/** Start a battle whose enemy is much faster than the player. */
async function startBattle(enemySpd) {
  await page.evaluate(async ({ spd }) => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 10, onWin() {}, onFlee() {}, onLose() {} });
    const b = window.__battleB();
    b.enemy.hp = 999999; b.enemy.maxHp = 999999; b.enemy.level = 10; b.enemy.spd = spd;
  }, { spd: enemySpd });
  await waitForCommandMenu(page, { timeout: 40000 });
}

/** Walk the command list to the Run row (index 5 of Fight/Tech/DV/Tag/Item/Run). */
async function selectRun() {
  for (let i = 0; i < 8; i++) { const s = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection); if (s === 0) break; await tap("ArrowUp"); await page.waitForTimeout(80); }
  let sel = 0;
  for (let i = 0; i < 12; i++) {
    sel = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection);
    if (sel === 5) break;
    await tap("ArrowDown"); await page.waitForTimeout(80);
  }
  return sel;
}

const snap = () => page.evaluate(() => {
  const b = window.__battleB?.();
  return { active: !!window.__battle?.isActive?.(), state: b?.state ?? null, message: b?.message ?? null };
});

const result = { ok: false, errors };
try {
  await boot(9999);
  await startBattle(1);                       // player 9999 vs enemy 1 -> must escape
  result.runRow = await selectRun();
  await tapCircle(page);
  let escaped = null, seen = null;
  for (let i = 0; i < 80; i++) {
    seen = await snap();
    if (seen.message) result.escapeMessage = seen.message;
    if (!seen.active) { escaped = true; break; }
    await page.waitForTimeout(100);
  }
  result.escaped = escaped === true;

  await boot(1);
  await startBattle(9999);                    // player 1 vs enemy 9999, equal level -> must NOT escape
  result.failRunRow = await selectRun();
  await tapCircle(page);
  let failMsg = null, stillActive = false;
  for (let i = 0; i < 80; i++) {
    seen = await snap();
    if (seen.message) failMsg = seen.message;
    if (seen.message === "Can't escape!") { stillActive = seen.active; break; }
    await page.waitForTimeout(100);
  }
  result.failMessage = failMsg;
  result.failStillActive = stillActive;
  result.ok = result.escaped === true && result.failMessage === "Can't escape!" && result.failStillActive === true && errors.length === 0;
} catch (e) {
  result.error = e.message;
} finally {
  await browser.close();
}

console.log("SUMMARY", JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
