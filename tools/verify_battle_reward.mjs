import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { backOutToTitle, loadFromCard, openContinueCard, press, saveToCard } from "./memcard-continue.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

// Plan 6.4 reward leg: a real battle through the game's own battle module, the
// victory report, and the committed award. Proves the report's displayed EXP is
// applied exactly once (the before/after delta equals what the report showed),
// the bits and the bag land, and that saving them to the card, backing out of
// the Continue card to the title and loading them again keeps them.
//
// Server: python3 -m http.server <port> --directory web (VERIFY_PORT)
// Run:    tools/run-playwright.sh tools/verify_battle_reward.mjs
const ROOT = process.env.REWARD_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
// The title boot. The country/language screen (code 0x1600) comes before it and
// ends in the opening movie, so the checks that are about Continue skip it.
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = process.env.REWARD_SHOT || "/tmp/battle-reward";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("rewardFixture")) return;
  sessionStorage.setItem("rewardFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
const field = () => page.evaluate(() => {
  const s = window.__state;
  return {
    leadXp: s.partnerStats?.xp, leadLevel: s.partnerStats?.level,
    bits: s.bits,
    bag: Object.fromEntries((s.inventory ?? []).map((x) => [x.id, x.qty])),
    storedXp: JSON.parse(localStorage.getItem("partnerStats") ?? "{}").xp,
    storedBits: localStorage.getItem("bits"),
    battleActive: !!window.__battle?.isActive?.(),
  };
});

const results = { errors };
// Inside the route, `assert` (below) is not bound yet; this is the same throw.
const must = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  results.before = await field();

  // Production battle entry: the same createBattle object game.js calls for
  // fixed battles and random encounters.
  await page.evaluate(async () => {
    window.__rewardResult = null;
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1,
      // The battle id keys the disc's own reward record (progression.battle_rewards);
      // 200 is the first story fight, [dvexp 1, exp 4, bits 50]. A fight started
      // without one pays nothing at all (web/battle.js battleRewardFor), so the
      // reward leg below would read 0 for EXP and BIT and prove nothing.
      screenId: 200,
      onWin: (res) => { window.__rewardResult = res; },
      onFlee: () => { window.__rewardResult = { fled: true }; },
      onLose: () => { window.__rewardResult = { lost: true }; },
    });
  });
  await waitForCommandMenu(page);
  // Kill the enemy with the ordinary Fight command.
  await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
  await tap("Enter");                       // menuSel 0 = Fight
  // Advance the result pages. ST.WIN is 8; 7 is RESULT_MSG, which waits on a confirm.
  let guardA = 0;
  while (await page.evaluate(() => window.__battleB?.()?.state) !== 8 && guardA++ < 30) {
    await tap("Enter");
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 8, null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", null, { timeout: 30_000 });
  results.report = await page.evaluate(() => {
    const b = window.__battleB();
    return {
      phase: b._victoryPhase,
      applied: b._winApplied,
      reward: b._winReward,
      pages: (b._winPages ?? []).map((p) => ({ kind: p.kind, value: p.value, message: p.message })),
      pageCount: b._winPages?.length ?? 0,
    };
  });
  await page.waitForTimeout(1700);   // let the black cut finish and the page type in
  await shot("battle-report");

  // Skip through the report quickly: press confirm for every page. The report
  // samples the pad's HELD word once a frame, so each press is held across
  // frames — a keydown/keyup inside one tick can be missed entirely, which left
  // the screen up with the BIT unpaid.
  let guard = 0;
  while (await page.evaluate(() => !!window.__battle?.isActive?.()) && guard++ < 20) {
    await press(page, "Enter", 600);
  }
  await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 20_000 });
  await page.waitForTimeout(400);
  results.afterReport = await field();
  results.onWin = await page.evaluate(() => window.__rewardResult);
  await shot("battle-field");

  // Continue keeps the committed award. The award is put on the card first (the
  // SAVE card is `openMemoryCard("save")`, the call an inn or tower save point's
  // HANDOFF makes — web/game.js doStoryHandoff), because Continue only reaches the
  // field by LOADING a file: the card's own exit answers 0xE00, the title, when
  // LOAD mode closes with nothing loaded (pro/stgmcard.s 0x4dc4-0x4e2c).
  results.slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); });
  must(results.slot != null, "the award was not written to a card slot");
  await page.goto(TITLE);
  await page.waitForFunction(() => {
    const t = document.querySelector("#title-screen");
    return t && !t.hidden;
  }, null, { timeout: 30_000 });
  await openContinueCard(page);
  results.backOut = await backOutToTitle(page);
  must(results.backOut.started === false, `backing out of the card started the game: ${JSON.stringify(results.backOut)}`);
  must(results.backOut.phase === "prompt", `the title did not come back: ${JSON.stringify(results.backOut)}`);
  must(results.backOut.exitScreen === 0xe00, `the card's exit selector was ${results.backOut.exitScreen}, not 0xE00`);
  // Continue again, and load the file the award was written to.
  await openContinueCard(page);
  await loadFromCard(page);
  await page.waitForTimeout(400);
  results.afterReload = await field();
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
assert(results.report.applied === true, "reward was not applied at the report");
const shownXp = results.report.reward?.xp ?? 0;
const expPage = results.report.pages.find((p) => p.kind === "exp");
assert(expPage && Number(expPage.value) === shownXp,
  `report EXP page wrong: ${JSON.stringify(results.report.pages)}`);
const deltaXp = (results.afterReport.leadXp ?? 0) - (results.before.leadXp ?? 0);
assert(deltaXp === shownXp, `EXP applied ${deltaXp}, report showed ${shownXp}`);
assert(results.afterReport.leadXp === shownXp, `lead xp wrong: ${results.afterReport.leadXp}`);
assert(results.afterReport.bits === results.before.bits + (results.report.reward?.bits ?? 0),
  `bits ${results.before.bits} -> ${results.afterReport.bits}, report showed ${results.report.reward?.bits}`);
assert(results.onWin && !results.onWin.fled && !results.onWin.lost,
  `onWin not called with a victory: ${JSON.stringify(results.onWin)}`);
assert(results.afterReport.storedXp === results.afterReport.leadXp &&
  results.afterReport.storedBits === String(results.afterReport.bits),
  `award not persisted: ${JSON.stringify(results.afterReport)}`);
assert(results.afterReload.leadXp === results.afterReport.leadXp &&
  results.afterReload.bits === results.afterReport.bits,
  `Continue lost the award: ${JSON.stringify(results.afterReload)}`);
console.log(JSON.stringify({ ok: true, results }, null, 2));
