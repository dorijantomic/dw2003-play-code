// tools/verify_party_pips.mjs — the battle HUD's party pips draw each member's
// STATE, not a fixed marker.
//
// Authority (original assembly, decoded): FIGHTSTG_F0x800934f0 computes the pip
// state from the member's record — 3 when the ailment byte +0x1C is set, else 2
// when HP == 0, else 1 when HP != max, else 0 — and draws cel 0xC+state for the
// side's ACTIVE slot and 0x3C+state for every other slot. Those eight cels are
// the pgfgc00 pack's 12x9 / 12x7 icons (cels 12-15 and 60-63).
//
// The check seeds those states onto a real production battle (the states are the
// prerequisite; the assertion is the DRAWN cel), reads them back through
// window.__battle.debugPips(), and then issues an ordinary Fight so the poisoned
// member's recorded ailment actually ticks — the shown state and the behaviour
// agree. `enemy.hp` is raised only so the fight does not end mid-measurement.
//
// Run: .opencode/autonomy/check-browser tools/verify_party_pips.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.PIPS_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.PIPS_SHOT || ".dw3-research/autonomous-plan/shots/party-pips";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
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
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const read = () => page.evaluate(() => {
  const b = window.__battleB();
  return {
    pips: window.__battle.debugPips(),
    records: b.playerRecords.map((r) => ({ hp: r.hp, maxHp: r.maxHp, ail: Object.keys(r.ailments || {}) })),
    active: b.activePlayerIndex,
    message: b.message,
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  // Production battle entry (the same createBattle object game.js calls).
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);
  // Keep the enemy alive so the fight cannot end mid-measurement.
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // ── 0. Every member full and healthy: active pip 0xC, the rest 0x3C. ──
  const base = await read();
  eq("baseline player pips", base.pips.player, [12, 60, 60]);
  eq("baseline enemy pip", base.pips.enemy, 12);
  await shot("pips-baseline-full");

  // ── 1. Seed the three non-full states: active poisoned, slot 1 damaged,
  //       slot 2 KO. The displayed cels must follow. ──
  await page.evaluate(() => {
    const b = window.__battleB();
    b.playerRecords[0].ailments.poison = { power: 4, tickTime: 0 };
    b.playerRecords[1].hp = Math.max(1, b.playerRecords[1].maxHp - 5);
    b.playerRecords[2].hp = 0;
  });
  const seeded = await read();
  eq("poisoned/damaged/KO pips", seeded.pips.player, [15, 61, 62]);
  await shot("pips-poison-damaged-ko");

  // ── 2. Remove the ailment and heal: the pip goes back to damaged (0xD),
  //       then full (0xC) — the icon tracks the record, not a fixed value. ──
  await page.evaluate(() => {
    const r = window.__battleB().playerRecords[0];
    delete r.ailments.poison;
    r.hp = r.maxHp - 3;
  });
  eq("recovered-to-damaged pip", (await read()).pips.player[0], 13);
  await page.evaluate(() => {
    const r = window.__battleB().playerRecords[0];
    r.hp = r.maxHp;
    r.ailments.poison = { power: 4, tickTime: 0 };
  });
  eq("poisoned-again pip", (await read()).pips.player[0], 15);

  // ── 3. The shown ailment is real: one ordinary Fight and the poison event
  //       must fire on the active member. ──
  const before = await page.evaluate(() => window.__battleB().playerRecords[0].hp);
  let sawPoison = false;
  for (let i = 0; i < 14 && !sawPoison; i++) {
    await tap("Enter");
    await page.waitForTimeout(450);
    sawPoison = await page.evaluate(() => {
      const b = window.__battleB();
      return `${b.message ?? ""}${b._timelineMessage ?? ""}`.includes("poison");
    });
  }
  const after = await page.evaluate(() => ({
    hp: window.__battleB().playerRecords[0].hp,
    message: window.__battleB().message,
  }));
  if (!sawPoison) fail(`no poison tick message after an ordinary Fight: ${JSON.stringify(after.message)}`);
  if (!(after.hp < before))
    fail(`the poisoned active member did not take tick damage: ${before} -> ${after.hp}`);
  eq("pip still 0xF while poisoned", (await read()).pips.player[0], 15);
  await shot("pips-poison-tick");

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, base: base.pips, seeded: seeded.pips, active: seeded.active,
    poison: { before, after: after.hp, message: after.message }, records: seeded.records,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
