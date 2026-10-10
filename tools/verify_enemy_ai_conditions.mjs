import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, runBattleTurn } from "./verify-battle-wait.mjs";

/** A shipped enemy's own ai_moves rows, read out of the extracted data. */
const enemyRows = (name) => JSON.parse(
  readFileSync(new URL("../web/assets/data/enemies.json", import.meta.url), "utf8"),
).enemies.find((e) => e.enemy_id === name)?.ai_moves ?? null;

// Plan section 4 battle row: the enemy-AI move predicates beyond 0-7.
//
// This runs the real game shell and the production createBattle path
// (window.__battle.start), selects the ordinary Fight command, and lets the
// enemy take its turn. It then reads the resulting message / MP debit to see
// which ai_moves row check_move_cond picked.
//
// Condition 11 (0x800a4530 field element) is exercised with real enemies.json rows
// and a real operand. Conditions 12 (0x80042b2c battle screen id), 8 and 13 use a
// one-row ai_moves fixture on a real enemy, because no shipped enemy has an
// OBSERVABLE FIRST row for 8 or 13, and Devidramon's SECOND row is a coin flip that
// pays the same technique cost as its first: {action 2, cond 1, value 40} fires on
// `(rng() & 0x7f) < 40` (engine/dw3/battle-enemy-ai.ts, `check_move_cond` case 1),
// so with the real four rows the OFF half of the cond-12 pair could be paid by that
// row instead -- it did, on 2026-10-04, and the check failed for a reason that had
// nothing to do with cond 12. The fixture is the enemy's own first row, asserted
// against the shipped data below; the operand (field element, party form, encounter
// config byte, battle screen id) and the dispatch are production either way.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_enemy_ai_conditions.mjs
const ROOT = process.env.AI_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.AI_SHOT || "/tmp/enemy-ai";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 999999, maxHp: 999999, mp: 300, maxMp: 300,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 200, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("aiFixture")) return;
  sessionStorage.setItem("aiFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify({
    digimonId: 1, level: 10, xp: 0, tp: 10, hp: 999999, maxHp: 999999, mp: 300, maxMp: 300,
    stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 200, chr: 30 },
    bonuses: {}, elemBonuses: {},
  }));
  localStorage.setItem("partyStats", "null");
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
});

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

// Start one battle, let the enemy act, and report what it did.
async function enemyTurn(label, { enemyId, screenId, field, aiMoves, profileId }) {
  await page.evaluate(async (opt) => {
    await window.__battle.start({
      enemyId: opt.enemyId, enemyLevel: 1, screenId: opt.screenId ?? undefined,
      onWin() {}, onFlee() {}, onLose() {},
    });
  }, { enemyId, screenId });
  await waitForCommandMenu(page);
  const before = await page.evaluate((opt) => {
    const b = window.__battleB();
    b.field = opt.field ? { element: opt.field, power: 100 } : null;
    b.enemy.hp = 9999; b.enemy.maxHp = 9999;
    if (opt.aiMoves) b.enemy.eStats.ai_moves = opt.aiMoves;
    if (opt.profileId) b.player.profile = { ...b.player.profile, id: opt.profileId };
    return { mp: b.enemy.mp, profileId: b.player.profile?.id ?? null,
             battleId: b.screenId ?? null, gateByte: b.encounterGateBytes?.[1] ?? null,
             field: b.field?.element ?? null };
  }, { field, aiMoves, profileId });
  await tap("Enter");   // the Fight row
  // Let the whole turn run the way a player lives it -- read every line, turn every
  // results page, stop once the enemy's own turn has happened and the command menu is
  // back -- through the one shared pump (tools/verify-battle-wait.mjs). The check used
  // to carry its own 160-iteration copy of that loop and its own 30s-per-battle waits,
  // which is where the five minutes went: a battle opened with a screen id puts up no
  // opening line, so every battle spent a full long timeout proving there was none.
  let sawEnemy = false;
  const states = await runBattleTurn(page, {
    ticks: 220,
    until: (s) => sawEnemy && s.state === 2 && !s.holds,
    onSnapshot: (s) => { if (s.state === 6) sawEnemy = true; },
  });
  await page.waitForTimeout(200);
  try { await shot(`enemy-ai-${label}`); } catch { /* battle over: canvas is on the field */ }
  const last = states[states.length - 1] ?? { msg: "", enemyMp: before.mp, fled: false, state: null };
  const after = { state: last.state, msg: last.msg, pages: last.pages, ready: last.ready,
                  mp: last.enemyMp ?? before.mp, fled: !!last.fled };
  await page.waitForTimeout(400);
  return { before, after, messages: states.map((x) => x.msg).filter(Boolean), states };
}

const results = { errors };
try {
  await page.goto(ROOT + "?skipTitle=1&map=s245&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);

  // cond 11: Icemon's first ai_moves row is {action 4, cond 11, value 2} (fire).
  // The field element comes from the same 0x800a4530 global F0x8009f644 uses.
  results.cond11On = await enemyTurn("cond11-on", { enemyId: "Icemon", field: "fire" });
  results.cond11Off = await enemyTurn("cond11-off", { enemyId: "Icemon", field: "ice" });

  // cond 12: Devidramon's own first row is {action 2, cond 12, value 21}, and
  // screen 21 is the real battle id for it. That row alone runs on both halves --
  // see the header for why the enemy's other rows cannot be in the OFF half.
  const cond12Row = [{ action: 2, comparator: 12, value: 21 }];
  results.cond12Rows = enemyRows("Devidramon");
  results.cond12On = await enemyTurn("cond12-on", { enemyId: "Devidramon", screenId: 21, aiMoves: cond12Row });
  results.cond12Off = await enemyTurn("cond12-off", { enemyId: "Devidramon", screenId: 5, aiMoves: cond12Row });

  // cond 8: a real enemy with a one-row fixture. Kotemon (profile id 1) is one of
  // the eight partner profiles; Greymon (id 12) is not.
  const cond8Row = [{ action: 4, comparator: 8, value: 0 }];
  results.cond8On = await enemyTurn("cond8-on", { enemyId: "Yanmamon", aiMoves: cond8Row });
  results.cond8Off = await enemyTurn("cond8-off", { enemyId: "Yanmamon", aiMoves: cond8Row, profileId: 12 });

  // cond 13: encounter config byte 1. Screen 35 has raw_2b58_2b65[1] = 1;
  // screen 5 has 2. A real enemy with a one-row fixture.
  const cond13Row = [{ action: 4, comparator: 13, value: 1 }];
  results.cond13On = await enemyTurn("cond13-on", { enemyId: "Yanmamon", screenId: 35, aiMoves: cond13Row });
  results.cond13Off = await enemyTurn("cond13-off", { enemyId: "Yanmamon", screenId: 5, aiMoves: cond13Row });
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
// The move is observable through the messages: an escape action says so whether
// the roll succeeded ("ran away") or failed ("couldn't escape").
const escaped = (r) => r.after.fled || r.messages.some((m) => /escape|ran away/i.test(m));

assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
// The cond-12 fixture is Devidramon's own first row, not an invented one.
assert(JSON.stringify(results.cond12Rows?.[0]) === JSON.stringify({ action: 2, comparator: 12, value: 21 }),
  `Devidramon's first ai_moves row is ${JSON.stringify(results.cond12Rows?.[0])}, not the row under test`);
// And the row that made the OFF half unattributable is still there, still a coin flip.
assert(results.cond12Rows?.[1]?.comparator === 1 && results.cond12Rows?.[1]?.action === 2,
  `Devidramon's second row is ${JSON.stringify(results.cond12Rows?.[1])}; the reason the OFF half `
  + `needs a one-row fixture is gone, so this check's comment is stale`);
// cond 11: fire field (id 2) makes Icemon choose the flee action; a different field does not.
assert(results.cond11On.before.field === "fire", "cond11 fixture field not set");
assert(escaped(results.cond11On), `cond11 ON did not flee: ${JSON.stringify(results.cond11On.messages)}`);
assert(!escaped(results.cond11Off), `cond11 OFF fled: ${JSON.stringify(results.cond11Off.messages)}`);
// cond 12: screen 21 makes Devidramon use Tech A (an MP debit); screen 5 does not.
assert(results.cond12On.before.battleId === 21, "cond12 fixture screen not set");
assert(results.cond12On.after.mp < results.cond12On.before.mp,
  `cond12 ON did not pay a technique cost: ${JSON.stringify(results.cond12On)}`);
assert(results.cond12Off.after.mp === results.cond12Off.before.mp,
  `cond12 OFF paid a technique cost: ${JSON.stringify(results.cond12Off)}`);
// cond 8: partner profile id <= 8 matches; an evolved profile id does not.
assert(escaped(results.cond8On), `cond8 ON did not flee: ${JSON.stringify(results.cond8On.messages)}`);
assert(!escaped(results.cond8Off), `cond8 OFF fled: ${JSON.stringify(results.cond8Off.messages)}`);
// cond 13: encounter byte 1 == 1 matches; screen 5's byte 2 does not.
assert(results.cond13On.before.gateByte === 1, `cond13 gate byte not 1: ${results.cond13On.before.gateByte}`);
assert(escaped(results.cond13On), `cond13 ON did not flee: ${JSON.stringify(results.cond13On.messages)}`);
assert(!escaped(results.cond13Off), `cond13 OFF fled: ${JSON.stringify(results.cond13Off.messages)}`);
console.log(JSON.stringify({ ok: true, results }, null, 2));
