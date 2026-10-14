// tools/verify_escape_roll.mjs
//
// Headless check that a Run from a battle still resolves, through the real web/game.js
// and the rebuilt engine bundle. The player's Run is F0x800a1608 side 0 (fightstg): a
// 0..127 roll under (base+1)*8 + level advantage + speed advantage (faster only) + the
// Runner Sandal/Shoes bonus — and REFUSED OUTRIGHT when the encounter's own byte
// 0x80042b65 (the screen record's +0x19, `raw_2b58_2b65[13]`) is nonzero.
//
// Three cases, each read off the battle's own pages:
//   A. a Run that MUST escape (the player is vastly faster) — the disc's two pages,
//      0x41 "Run!" then 0x43 "Run away!", then the battle ends;
//   B. a Run that MUST NOT (the player is far slower, equal level) — the 0x41 page is
//      the only one (the disc's failure arm prints no second page) and the fight goes on;
//   C. the same vastly-faster player in a STORY battle (screen 200, Kuwagamon, whose
//      record byte +0x19 is 1) — refused by the gate, no roll can save it.
//
// Server: python3 -m http.server 8788 --directory web
// Run:    VERIFY_PORT=8788 tools/run-playwright.sh tools/verify_escape_roll.mjs
import { chromium } from "playwright";
import { waitForCommandMenu, tapCircle } from "./verify-battle-wait.mjs";

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

/** Start a battle from its own screen record (the encounter's byte 13 comes with it). */
async function startScreenBattle(screenId) {
  await page.evaluate(async ({ id }) => {
    await window.__battle.startScreen(id, () => {}, () => {}, () => {}, { mapId: "s245" });
  }, { id: screenId });
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
  return {
    active: !!window.__battle?.isActive?.(),
    state: b?.state ?? null,
    message: b?.message ?? null,
    // The disc's own page id (the `+0xac` spec's first payload word), when the line is
    // the original's; `_msgSpecFor` pins the text it belongs to.
    specId: (b?._msgSpec && b?._msgSpecFor === b?.message) ? (b._msgSpec.payload?.[0] ?? null) : null,
    pages: b?._resultPages?.length ?? 0,
    pageIndex: b?._resultPageIndex ?? 0,
    gateByte: b?.encounterGateBytes?.[13] ?? null,
  };
});

const result = { ok: false, errors };
try {
  // ── A. must escape ────────────────────────────────────────────────────────────────
  await boot(9999);
  await startBattle(1);                       // player 9999 vs enemy 1 -> must escape
  result.runRow = await selectRun();
  await tapCircle(page);
  let seen = null, firstPage = null, secondPage = null;
  for (let i = 0; i < 60; i++) {
    seen = await snap();
    if (seen.specId === 0x41 && !firstPage) firstPage = { specId: seen.specId, message: seen.message };
    if (seen.specId === 0x43 && !secondPage) secondPage = { specId: seen.specId, message: seen.message };
    if (secondPage) break;
    if (firstPage && !secondPage) await tapCircle(page);
    await page.waitForTimeout(120);
  }
  result.escapeFirstPage = firstPage;
  result.escapeSecondPage = secondPage;
  for (let i = 0; i < 40; i++) { seen = await snap(); if (!seen.active) break; await tapCircle(page); await page.waitForTimeout(120); }
  result.escaped = seen?.active === false;

  // ── B. must NOT escape (the player is far slower) ─────────────────────────────────
  await boot(1);
  await startBattle(9999);                    // player 1 vs enemy 9999, equal level -> refused
  result.failRunRow = await selectRun();
  await tapCircle(page);
  let failPage = null, failActive = null;
  for (let i = 0; i < 40; i++) {
    seen = await snap();
    if (seen.specId === 0x41 && !failPage) { failPage = { specId: seen.specId, message: seen.message }; failActive = seen.active; break; }
    await page.waitForTimeout(120);
  }
  result.failPage = failPage;
  result.failStillActive = failActive;
  result.failGateByte = (await snap()).gateByte;

  // ── C. the story battle refuses the same runaway player (0x80042b65) ──────────────
  await boot(9999);
  await startScreenBattle(200);               // Kuwagamon, story battle: record +0x19 = 1
  result.storyGateByte = (await snap()).gateByte;
  result.storyRunRow = await selectRun();
  await tapCircle(page);
  let storyPage = null, storyActive = null;
  for (let i = 0; i < 40; i++) {
    seen = await snap();
    if (seen.specId === 0x41 && !storyPage) { storyPage = { specId: seen.specId, message: seen.message }; storyActive = seen.active; break; }
    await page.waitForTimeout(120);
  }
  result.storyPage = storyPage;
  result.storyStillActive = storyActive;

  result.ok = result.escaped === true
    && result.escapeFirstPage?.specId === 0x41 && result.escapeSecondPage?.specId === 0x43
    && result.failPage?.specId === 0x41 && result.failStillActive === true
    && result.storyGateByte === 1 && result.storyPage?.specId === 0x41 && result.storyStillActive === true
    && errors.length === 0;
} catch (e) {
  result.error = e.message;
} finally {
  await browser.close();
}

console.log("SUMMARY", JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
