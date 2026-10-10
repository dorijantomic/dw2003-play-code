// tools/verify_blast_revert.mjs — Blast digivolution: the automatic REVERT and
// the fight's result writeback.
//
// The plan's blast-digivolution row asks for "enter Blast, act, Tag while
// active, revert and finish fight". Tag is tools/verify_tag_cancels_blast.mjs;
// this is the revert + finish half.
//
// Authority: sequence 0x62 (captures/blast-presentation-2026-07-14/README.md,
// BLAST-C001/C002/C009). On schedule expiry the shared cleanup restores the
// saved form FIRST, zeroes the DV gauge, and only then plays the de-digivolution
// presentation (blast_run4.txt f5938-5941); the revert sound is player11
// (0xa0045ec9) and the message is esmfight 0x62 "<name> Back to normal!". The
// battle then continues and a win still commits the normal report once.
//
// The check drives the real battle: production Blast (window.__battleBlast),
// then one ordinary Fight turn with the schedule seeded to its last turn, so the
// SHIPPED tick (tickBlastTurn -> _blastRevertPending -> revertBlast) runs, not a
// direct call. Seeded prerequisites: the gauge so the production Blast arms, and
// playerTurns = 1 so the expiry is reached without six full animated turns (the
// decoded initial value of 6 is asserted at arm time). The win leg reuses the
// production report path from tools/verify_battle_reward.mjs.
//
// Run: .opencode/autonomy/check-browser tools/verify_blast_revert.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BLASTREVERT_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.BLASTREVERT_SHOT || ".dw3-research/autonomous-plan/shots/blast-revert";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120, dvGauge: 0,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("digivolveDemo", "0");
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

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const state = () => page.evaluate(() => {
  const b = window.__battleB();
  return {
    formId: b.player.profile?.id ?? null,
    formName: b.player.profile?.name ?? null,
    gauge: Math.round(b.player.gauge ?? 0),
    blast: b.blast ? { active: !!b.blast.active, savedFormId: b.blast.savedFormId, playerTurns: b.blast.playerTurns } : null,
    blastShow: !!b.blastShow,
    message: b.message ?? "",
    active: b.activePlayerIndex,
    stored: JSON.parse(localStorage.getItem("partnerStats") ?? "{}").dvGauge,
  };
});
const field = () => page.evaluate(() => {
  const s = window.__state;
  return {
    leadXp: s.partnerStats?.xp, leadLevel: s.partnerStats?.level,
    bits: s.bits,
    storedXp: JSON.parse(localStorage.getItem("partnerStats") ?? "{}").xp,
    storedBits: localStorage.getItem("bits"),
  };
});

const results = { errors };
// A line the message panel is showing holds the turn until Circle, the way the
// original's own sequencer does (msgHoldsTurn, web/battle.js:2615), so the
// player reads each line and presses Circle; the committed turn's own result
// pages and the command list take the same press. A press sent while none of
// them is waiting is dropped, so only press when one of them is up.
const padWanted = () => page.evaluate(() =>
  (window.__battle?.peek?.()?.messageLine?.holdsTurn === true)
  || (window.__battleB?.()?._resultReady === true)
  || (window.__battleCmdNative?.diagnostics?.().ready === true));
/** Press Circle while a line is showing or the command list is up, until `done`. */
const pressUntil = async (done, budgetMs = 40_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if (await page.evaluate(done)) return true;
    if (await padWanted()) await tap("Enter");
    await page.waitForTimeout(250);
  }
  return page.evaluate(done);
};
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  results.before = await field();

  await page.evaluate(async () => {
    window.__blastResult = null;
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1,
      // The battle id keys the disc's own reward record
      // (progression.battle_rewards). Without one the report leg below reads 0
      // EXP and 0 BIT and proves nothing (tools/verify_battle_reward.mjs:85).
      screenId: 200,
      onWin: (res) => { window.__blastResult = res; },
      onFlee: () => { window.__blastResult = { fled: true }; },
      onLose: () => { window.__blastResult = { lost: true }; },
    });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // Production Blast. The gauge is a prerequisite (the automatic path arms at
  // DV_GAUGE_MAX); triggerBlast itself is the shipped entry.
  await page.evaluate(() => { window.__battleB().player.gauge = 999; });
  const armState = await state();
  const armed = await page.evaluate(() => window.__battleBlast());
  if (!armed) fail("window.__battleBlast() found no Blast target");
  const armState2 = await state();
  results.arm = { beforeBlast: armState, afterTrigger: armState2 };
  if (!armState2.blast?.active) fail(`Blast not active after the production trigger: ${JSON.stringify(armState2)}`);
  if (armState2.blast?.playerTurns !== 6) fail(`the armed schedule is not the decoded 6 player turns: ${JSON.stringify(armState2.blast)}`);
  // Let the transformation finish (digivolveDemo=0 runs the program to its end).
  await page.waitForFunction(() => {
    const b = window.__battleB();
    return b.blast?.active && !b.blastShow;
  }, null, { timeout: 15_000 });
  const afterBlast = await state();
  results.afterBlast = afterBlast;

  // Kotemon (digimon 1) at level 10 -> tier 1 -> blasts[1] = 20 (web/assets/data/digimon.json).
  if (afterBlast.formId !== 20) fail(`Blast-on did not swap to the tier target 20: ${JSON.stringify(afterBlast)}`);
  if (afterBlast.gauge !== 999) fail(`gauge moved during the transformation: ${afterBlast.gauge}`);

  // Arm the sound trace for the revert only, then seed the schedule's last turn.
  await page.evaluate(() => { window.__sfxTrace = new Set(); });
  await page.evaluate(() => { window.__battleB().blast.playerTurns = 1; });
  // Observe the authored sequence: the "Digivolve Demo" pause-menu setting (the
  // player can toggle it any time) plays the 326-frame revert instead of
  // skipping it, so the captured sound beat is measurable. Switched back off
  // after the beat to fast-forward the remainder for the result leg.
  await page.evaluate(() => { localStorage.setItem("digivolveDemo", "1"); });

  // One ordinary Fight turn commits; tickBlastTurn expires the schedule and the
  // shipped advanceAfterResult runs revertBlast. The committed turn's result
  // pages need an ordinary confirm, so the in-page loop presses Enter as the
  // player would and resolves the moment the revert sequence starts. The revert
  // cleanup restores the form and zeroes the gauge BEFORE the presentation
  // (blast_run4.txt f5938 f5939), so all of that must already read back here.
  results.revertStart = await page.evaluate(() => new Promise((resolve, reject) => {
    const t0 = performance.now();
    let lastPress = 0;
    const press = () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
    };
    const tick = () => {
      const b = window.__battleB();
      if (b.blastShow?.program === "blast_revert") {
        resolve({
          frame: Math.round(b.blastShow.frame ?? 0),
          formId: b.player.profile?.id ?? null,
          formName: b.player.profile?.name ?? null,
          gauge: Math.round(b.player.gauge ?? 0),
          blast: b.blast,
          sfx: [...(window.__sfxTrace ?? [])],
        });
        return;
      }
      if (performance.now() - t0 > 12_000) { reject(new Error("the schedule expiry did not start the revert")); return; }
      if (performance.now() - lastPress > 250) { lastPress = performance.now(); press(); }
      requestAnimationFrame(tick);
    };
    press();
    tick();
  }));

  // The captured beat: PLAYER11 at +50, not at commit.
  results.revertSound = await page.evaluate(() => new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      const b = window.__battleB();
      if ((window.__sfxTrace ?? new Set()).has("player11")) {
        resolve({ frame: Math.round(b.blastShow?.frame ?? -1) });
        return;
      }
      if (performance.now() - t0 > 5_000) { reject(new Error("the revert sound never fired")); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }));

  // Fast-forward the rest of the authored sequence and read the committed state.
  await page.evaluate(() => { localStorage.setItem("digivolveDemo", "0"); });
  results.revert = await page.evaluate(() => new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      const b = window.__battleB();
      if (b.blast === null && !b.blastShow) {
        resolve({
          formId: b.player.profile?.id ?? null,
          formName: b.player.profile?.name ?? null,
          gauge: Math.round(b.player.gauge ?? 0),
          blast: b.blast,
          message: b.message ?? "",
          // The original's own call for this line: kind 2, word 0x62, the saved
          // name. The translated panel draws those two lines.
          spec: b._msgSpec ?? null,
          active: b.activePlayerIndex,
          stored: JSON.parse(localStorage.getItem("partnerStats") ?? "{}").dvGauge,
          sfx: [...(window.__sfxTrace ?? [])],
        });
        return;
      }
      if (performance.now() - t0 > 8_000) { reject(new Error("the revert did not complete")); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await shot("blast-reverted");

  if (results.revertStart.formId !== 1) fail(`the revert cleanup did not restore Kotemon before the presentation: ${JSON.stringify(results.revertStart)}`);
  if (results.revertStart.gauge !== 0) fail(`the revert cleanup did not zero the gauge before the presentation: ${results.revertStart.gauge}`);
  if (results.revertStart.blast !== null) fail(`the Blast flag survived the cleanup: ${JSON.stringify(results.revertStart.blast)}`);
  if (results.revertStart.sfx.includes("player11")) fail(`the revert sound played at commit, not on its captured frame: ${JSON.stringify(results.revertStart.sfx)}`);
  if (!(results.revertSound.frame >= 50 && results.revertSound.frame < 110)) fail(`the revert sound fired at frame ${results.revertSound.frame}, not the captured +50`);
  if (results.revert.formId !== 1) fail(`revert did not restore Kotemon (1): ${JSON.stringify(results.revert)}`);
  if (results.revert.formName !== "Kotemon") fail(`restored form name: ${results.revert.formName}`);
  if (results.revert.gauge !== 0) fail(`revert did not zero the gauge: ${results.revert.gauge}`);
  if (results.revert.blast !== null) fail(`the Blast flag survived the revert: ${JSON.stringify(results.revert.blast)}`);
  if (results.revert.stored !== 0) fail(`localStorage dvGauge after revert: ${results.revert.stored}`);
  if (!results.revert.sfx.includes("player11")) fail(`the revert sound player11 was not played: ${JSON.stringify(results.revert.sfx)}`);
  // The line is the original's, drawn on two lines: the Digimon's name and the
  // bank word esmfight 0x62, "Back to normal!" (wfightmn.s .L0x0000316c).
  if (results.revert.message !== "Kotemon\nBack to normal!") fail(`revert message: ${JSON.stringify(results.revert.message)}`);
  if (results.revert.spec?.kind !== 2 || results.revert.spec?.payload?.[0] !== 0x62
      || results.revert.spec?.name !== "Kotemon") {
    fail(`the revert line is not the original's own call: ${JSON.stringify(results.revert.spec)}`);
  }

  // Read the lines the rest of the fight puts up — the enemy's own turn follows
  // the player's, so more than one is waiting — and hand the turn back.
  if (!await pressUntil(() => window.__battleB?.()?.state === 2))
    fail(`the command list never came back after the revert: ${JSON.stringify(await state())}`);

  // Finish the fight with an ordinary Fight command and the normal report.
  // The shared press (tools/verify-battle-wait.mjs): no line is waiting by now, so this only
  // re-asserts the list is built and reading the pad before the Fight confirm.
  await waitForCommandMenu(page);
  await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
  if (!await pressUntil(() => window.__battleB?.()?.state === 8, 60_000))
    fail(`the fight did not reach the win: ${JSON.stringify(await state())}`);
  await page.waitForFunction(() => window.__battleB?.()?.state === 8, null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", null, { timeout: 30_000 });
  results.report = await page.evaluate(() => {
    const b = window.__battleB();
    return {
      phase: b._victoryPhase,
      applied: b._winApplied,
      reward: b._winReward,
      pages: (b._winPages ?? []).map((p) => ({ kind: p.kind, value: p.value, message: p.message })),
    };
  });
  await page.waitForTimeout(1700);
  await shot("blast-report");

  // Skip through the report: it samples the pad's HELD word once a frame, so
  // each press has to be held across frames — a tap inside one tick is missed
  // and the screen stays up with the award unpaid.
  let guard = 0;
  while (await page.evaluate(() => !!window.__battle?.isActive?.()) && guard++ < 20) {
    await page.keyboard.down("Enter");
    await page.waitForTimeout(140);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(600);
  }
  await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  results.afterReport = await field();
  results.onWin = await page.evaluate(() => window.__blastResult);
  await shot("blast-field");
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.revert, "no revert state captured");
  assert(results.report?.applied === true, "the win report was not applied after the revert");
  const shownXp = results.report.reward?.xp ?? 0;
  const expPage = results.report.pages.find((p) => p.kind === "exp");
  assert(expPage && Number(expPage.value) === shownXp,
    `report EXP page wrong: ${JSON.stringify(results.report.pages)}`);
  const deltaXp = (results.afterReport.leadXp ?? 0) - (results.before.leadXp ?? 0);
  assert(deltaXp === shownXp, `EXP applied ${deltaXp}, report showed ${shownXp}`);
  assert(results.afterReport.bits === results.before.bits + (results.report.reward?.bits ?? 0),
    `bits ${results.before.bits} -> ${results.afterReport.bits}, report showed ${results.report.reward?.bits}`);
  assert(results.onWin && !results.onWin.fled && !results.onWin.lost,
    `onWin not called with a victory: ${JSON.stringify(results.onWin)}`);
  assert(results.afterReport.storedXp === results.afterReport.leadXp &&
    results.afterReport.storedBits === String(results.afterReport.bits),
    `award not persisted: ${JSON.stringify(results.afterReport)}`);
  console.log("RESULT", JSON.stringify({ ok: true, revertStart: results.revertStart, revertSound: results.revertSound, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
