// tools/verify_blast_active_act.mjs — Blast digivolution: entering it and acting
// while it is active.
//
// The plan's blast-digivolution row asks for "enter Blast, act, Tag while
// active, revert and finish fight". This is the enter + act clause; Tag is
// tools/verify_tag_cancels_blast.mjs and the revert/finish is
// tools/verify_blast_revert.mjs.
//
// Authority (BLAST-C002/C004/BLAST-C010, captures/blast-presentation-2026-07-14):
// when the DV gauge saturates and the fighter takes a hit, the gauge path sets
// the pending Blast and the same triggerBlast runs. While the Blast flag +0x1a
// is set, the technique menu SKIPS its MP sufficiency gate (fightstg 0x80096548,
// engine/dw3/ui/native/battle-tech-menu.ts:611) and execution bypasses the MP
// debit, and the DV gauge takes no further gain from damage taken. The check
// proves all three in the real battle:
//   A. Blast inactive: the same technique at 0 MP cannot be chosen at all — the
//      list plays the confirm, keeps the row and answers nothing, which is the
//      baseline the active guard suppresses — and the enemy hit raises the
//      gauge.
//   B. The saturated gauge then arms the Blast by itself (no lab trigger).
//   C. Blast active: the same technique is chosen and casts free, the schedule
//      ticks, and the same enemy hit leaves the gauge where it was.
//
// The enemy's SPD is raised so rollHit's hitChance reaches its always-hit form
// (engine/dw3/battle-formulas.ts rollHit), making the A/B deterministic; the
// player is seeded slow so its own accuracy is irrelevant.
//
// Run: .opencode/autonomy/check-browser tools/verify_blast_active_act.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BLASTACT_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.BLASTACT_SHOT || ".dw3-research/autonomous-plan/shots/blast-active-act";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 9999, maxHp: 9999, mp: 0, maxMp: 9999, dvGauge: 0,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 1, chr: 30 },
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
const snap = () => page.evaluate(() => {
  const b = window.__battleB();
  return {
    st: b.state, sel: b.menuSel, form: b.player.profile?.id,
    hp: b.player.hp, mp: b.player.mp, gauge: Math.round(b.player.gauge ?? 0),
    blast: !!b.blast, turns: b.blast?.playerTurns ?? null, msg: (b.message ?? "").slice(0, 80),
  };
});
// Confirm the pending action / result pages like a player. `cap` counts presses
// (one every 250 ms), not animation frames.
const pressUntil = (stopFn, cap = 12) => page.evaluate(({ src, cap }) => new Promise((resolve) => {
  const stop = new Function("b", `return (${src});`);
  const press = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
  };
  let last = 0, n = 0;
  const tick = () => {
    const b = window.__battleB();
    if (stop(b)) { resolve(true); return; }
    const now = performance.now();
    if (now - last > 250) {
      last = now; press(); n++;
      if (n > cap) { resolve(false); return; }
    }
    requestAnimationFrame(tick);
  };
  tick();
}), { src: stopFn, cap });

// The command list and the TECH list are both the translated pro/fightstg
// screens. Each starts reading the pad only once its own session is built and
// each owns its own highlight, so the check arms the row on the screen's own
// diagnostics (`selection` is the live row) instead of counting blind Downs.
const cmdRow = () => page.evaluate(() =>
  window.__battleCmdNative?.diagnostics?.().selection ?? null);
const techRow = () => page.evaluate(() =>
  window.__battleTechNative?.diagnostics?.().selection ?? null);
// The original's list clamps at both ends instead of wrapping, so six Ups put
// the highlight on row 0 whatever it was, and Downs walk it down to `row`.
const armRow = async (row, read) => {
  for (let i = 0; i < 6; i++) { await tap("ArrowUp"); await page.waitForTimeout(120); }
  for (let i = 0; i < 10 && (await read()) !== row; i++) {
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  return (await read()) === row;
};
/** The first technique the TECH list's own seed prices above 0 MP. */
const pricedTech = () => page.evaluate(() => {
  const list = window.__battleTechNative?.diagnostics?.().seed?.techniques ?? [];
  const i = list.findIndex((t) => Number(t.cost) > 0);
  return i < 0 ? null : { row: i, word: list[i].word, cost: list[i].cost };
});
const waitBootLoader = () => page.waitForFunction(
  () => window.__battleWfightmn?.diagnostics?.().open === false, null, { timeout: 30_000 });
const waitCmdReady = () => page.waitForFunction(
  () => window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 });
const waitTechReady = () => page.waitForFunction(
  () => window.__battleTechNative?.diagnostics?.().ready === true, null, { timeout: 20_000 });

/** Fight -> Tech -> the priced technique, each step waiting for its own screen. */
const tech3 = async () => {
  await waitCmdReady();
  if (!await armRow(1, cmdRow)) fail(`the Tech row was not armed (row ${await cmdRow()})`);
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 3, null, { timeout: 8000 })
    .catch(() => {});
  await waitTechReady();
  const priced = await pricedTech();
  if (!priced) fail("the TECH list has no technique priced above 0 MP");
  if (!await armRow(priced.row, techRow)) fail(`the priced technique row was not armed (row ${await techRow()})`);
  await tap("Enter");
  await page.waitForTimeout(400);
  return { ...priced, chosen: await page.evaluate(() => window.__battleTechNative?.diagnostics?.().chosen ?? null) };
};

// Advance the transient beats (action, enemy turn, result pages) but NEVER press
// at the player's menu, so the check cannot accidentally commit an extra Fight.
const settleToMenu = () => page.evaluate(() => new Promise((resolve) => {
  const t0 = performance.now();
  const press = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
  };
  let last = 0;
  const tick = () => {
    const b = window.__battleB();
    if (b.state === 2) { resolve(true); return; }
    const now = performance.now();
    if ([5, 6, 7].includes(b.state) && now - last > 250) { last = now; press(); }
    if (now - t0 > 10_000) { resolve(false); return; }
    requestAnimationFrame(tick);
  };
  tick();
}));

const results = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
  });
  // The shared press (tools/verify-battle-wait.mjs) reads the line and waits for the list; the
  // two hand-rolled waits it replaces were the phase, the boot loader and the list's own
  // readiness, and it carries all three.
  await waitForCommandMenu(page);
  await waitCmdReady();
  await page.evaluate(() => {
    const b = window.__battleB();
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    b.enemy.str = 2000; b.enemy.spd = 999;   // always-hit enemy, survivable damage
    b.player.gauge = 0; b.player.mp = 0;
  });

  // ── A. Blast INACTIVE: the 0-MP technique cannot be taken, and the enemy hit
  // raises the gauge — the baseline the active guard must suppress.
  results.legA = { before: await snap() };
  results.legA.priced = await tech3();
  await pressUntil("b.state !== 3", 4).catch(() => {});
  results.legA.refused = await snap();
  // The list plays the confirm, keeps the row and answers nothing: the battle is
  // still on the technique list, nothing was cast, and no MP was spent.
  if (results.legA.refused.st !== 3 || results.legA.priced.chosen !== null) {
    fail(`the 0-MP technique was not refused with Blast inactive: ${JSON.stringify(results.legA)}`);
  }
  if (results.legA.refused.mp !== 0) fail(`leg A spent MP: ${results.legA.refused.mp}`);
  await shot("blast-inactive-refused");
  // BACK (word bit 0x4000) leaves the technique list; then an ordinary Fight turn
  // hands the round to the enemy, whose hit is the gauge baseline. The player's back
  // button is the physical Triangle on an English disc, so it is Escape or `x`;
  // `c` is now CONFIRM (0x2000) and would pick the row instead of leaving the list.
  await tap("Escape");
  await pressUntil("b.state === 2", 6);
  await waitCmdReady();
  if (!await armRow(0, cmdRow)) fail(`the Fight row was not armed (row ${await cmdRow()})`);
  await tap("Enter");
  await pressUntil("b.player.hp < 9999", 20);
  results.legA.afterHit = await snap();
  if (!(results.legA.afterHit.hp < 9999)) fail(`the enemy hit never landed in leg A: ${JSON.stringify(results.legA.afterHit)}`);
  if (!(results.legA.afterHit.gauge > 0)) fail(`the enemy hit raised no gauge with Blast inactive: ${results.legA.afterHit.gauge}`);
  await shot("blast-inactive-refused-hit");
  await settleToMenu();

  // ── B. Automatic entry: the saturated gauge plus the enemy hit arm the Blast
  // through the production gauge path; no lab trigger.
  await page.evaluate(() => { const b = window.__battleB(); b.player.gauge = 1000; b.player.mp = 0; });
  await waitCmdReady();
  await armRow(0, cmdRow);
  await tap("Enter");
  const armedByGauge = await pressUntil("!!b.blast", 30);
  if (!armedByGauge) fail("the saturated gauge did not arm the Blast");
  results.autoEntry = await snap();
  await page.waitForFunction(() => { const b = window.__battleB(); return b.blast?.active && !b.blastShow; }, null, { timeout: 15_000 });
  await settleToMenu();
  results.legB = { before: await snap() };
  if (results.legB.before.form !== 20) fail(`the automatic Blast did not swap the form: ${JSON.stringify(results.legB.before)}`);
  if (results.legB.before.turns !== 6) fail(`armed schedule is not 6 turns: ${JSON.stringify(results.legB.before)}`);
  await shot("blast-auto-entry");

  // ── C. Blast ACTIVE: the same 0-MP technique casts free and the same enemy
  // hit leaves the gauge untouched. The gauge is moved below max first so an
  // unguarded gain would be visible rather than clamped away.
  results.legC = {};
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.gauge = 500; b.player.mp = 0;
    b.timeline = { player: 9999, enemy: 0 };   // enemy's hit lands this round
  });
  // The SAME priced technique leg A was refused for, so the only difference
  // between the two legs is the Blast flag the technique menu tests.
  await waitCmdReady();
  if (!await armRow(1, cmdRow)) fail(`the Tech row was not armed (row ${await cmdRow()})`);
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 3, null, { timeout: 8000 })
    .catch(() => {});
  await waitTechReady();
  results.legC.priced = await pricedTech();
  if (!await armRow(results.legC.priced.row, techRow)) {
    fail(`the priced technique row was not armed (row ${await techRow()})`);
  }
  results.legC.menu = await snap();
  if (results.legC.menu.st !== 3) fail(`the TECH submenu did not open: ${JSON.stringify(results.legC.menu)}`);
  await tap("Enter");
  await page.waitForTimeout(400);
  results.legC.chosen = await page.evaluate(() =>
    window.__battleTechNative?.diagnostics?.().chosen ?? null);
  await pressUntil("b.blast && b.blast.playerTurns === 5", 20);
  results.legC.cast = await snap();
  // The Blast flag is what lets the list hand the technique over at 0 MP, and
  // what leaves the MP alone.
  if (results.legC.chosen === null) {
    fail(`the Blasted technique was refused at 0 MP: ${JSON.stringify(results.legC)}`);
  }
  if (results.legC.cast.mp !== 0) fail(`the Blasted technique spent MP: ${results.legC.cast.mp}`);
  if (results.legC.cast.turns !== 5) fail(`the committed turn did not tick the schedule: ${results.legC.cast.turns}`);
  await shot("blast-active-free-tech");
  await pressUntil("b.player.hp < 9999", 12);
  results.legC.afterHit = await snap();
  if (!(results.legC.afterHit.hp < 9999)) fail(`the enemy hit never landed in leg C: ${JSON.stringify(results.legC.afterHit)}`);
  if (results.legC.afterHit.gauge !== 500) fail(`the gauge gained while Blast was active: ${results.legC.afterHit.gauge}`);
  if (!results.legC.afterHit.blast) fail("the Blast flag dropped before the revert");
  await shot("blast-active-hit-no-gain");
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.legA.priced.cost > 0, "leg A picked a technique that costs nothing");
  assert(results.legA.priced.chosen === null, "leg A took a technique it could not pay for");
  assert(results.legA.afterHit.gauge > 0, "leg A had no gauge baseline");
  assert(results.autoEntry.blast, "leg B did not auto-arm");
  assert(results.legB.before.form === 20, "leg B form not the Blast target");
  assert(results.legC.menu.st === 3, "leg C TECH submenu missing");
  assert(results.legC.chosen !== null, "leg C could not take a technique at 0 MP");
  assert(results.legC.cast.turns === 5, "leg C schedule did not tick");
  assert(results.legC.afterHit.gauge === 500, "leg C gauge moved");
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
