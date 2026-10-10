// tools/verify_battle_exit_cleanup.mjs — leaving a fight writes the party's real
// HP/MP back, a KO returns at 1 HP with its MP untouched, and battle-only status
// is NOT saved to the field.
//
// Authority: web/battle.js writeBackBattleVitals (the native battle-end write of
// F0x800a7c00: a KO'd resident record goes back to the field at 1 HP and its MP
// is not overwritten; a survivor writes hp+mp; dvGauge is clamped to the decoded
// 1000). Ailments live on the live combat record only, never on the stored
// stats, so they are inherently cleared when the fight ends.
//
// The KO/status states are seeded prerequisites; the assertions are the stored
// party after an ordinary Run. The player's SPD is raised only to make the flee
// certain, so no RNG can leave the fight running.
//
// Run: .opencode/autonomy/check-browser tools/verify_battle_exit_cleanup.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.EXIT_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.EXIT_SHOT || ".bunny-scratch/shots/battle-exit-cleanup";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, hp, mp) => ({
  digimonId, level, xp: 0, tp: 10, hp, mp, maxHp: 400, maxMp: 120,
  dvGauge: 123,
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
}, { lead: member(1, 10, 400, 120), rena: member(7, 10, 300, 100), pata: member(8, 10, 300, 100) });

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
const stored = () => page.evaluate(() => {
  const s = window.__state;
  return {
    lead: { hp: s.partnerStats.hp, mp: s.partnerStats.mp, dv: s.partnerStats.dvGauge,
            ail: Object.keys(s.partnerStats.ailments || {}) },
    second: { hp: s.partyStats[1]?.hp, mp: s.partyStats[1]?.mp,
              ail: Object.keys(s.partyStats[1]?.ailments || {}) },
    storedLead: JSON.parse(localStorage.getItem("partnerStats") ?? "{}"),
    storedSecond: JSON.parse(localStorage.getItem("partyStats") ?? "[]")[1] ?? null,
    active: window.__battle.isActive(),
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);

  // Seeded prerequisites: the active member is KO'd and poisoned; the second is
  // a hurt, frozen survivor. Its stored MP differs from the live record, so the
  // KO branch's "MP is not overwritten" rule is observable.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.playerRecords[0].hp = 0;
    b.playerRecords[0].mp = 99;
    b.playerRecords[0].gauge = 5000;
    b.playerRecords[0].ailments.poison = { power: 4 };
    b.playerRecords[1].hp = 50;
    b.playerRecords[1].mp = 33;
    b.playerRecords[1].ailments.frozen = { power: 4 };
    b.player.spd = 9999;      // make the ordinary Run certain
    b.enemy.spd = 1;
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
  });
  await shot("exit-ko-poisoned");

  // Ordinary keys: the command list's own row 5 = Run -> confirm. The list is the
  // translated pro/fightstg screen: it owns the highlight and the confirm, and it
  // only reads the pad once its own session is built, so arm the row on its live
  // selection (the walker's menuSel is only written back on the confirm) after the
  // battle boot loader has retired.
  await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false,
    null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });
  const selection = () => page.evaluate(() => window.__battleCmdNative?.diagnostics?.().selection ?? null);
  for (let i = 0; i < 8 && (await selection()) !== 5; i++) {
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  if ((await selection()) !== 5) await fail(`the Run row was not armed (row ${await selection()})`);
  await tap("Enter");
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => !window.__battle.isActive())) break;
    await tap("Enter");
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => !window.__battle.isActive(), null, { timeout: 15_000 });
  await page.waitForTimeout(400);
  const after = await stored();
  await shot("exit-field-after");

  eq("KO lead returns at 1 HP", after.lead.hp, 1);
  eq("KO lead keeps its stored MP", after.lead.mp, 120);
  eq("KO lead's DV gauge clamps to 1000", after.lead.dv, 1000);
  eq("KO lead saved no battle ailment", after.lead.ail, []);
  eq("survivor writes hp back", after.second.hp, 50);
  eq("survivor writes mp back", after.second.mp, 33);
  eq("survivor saved no battle ailment", after.second.ail, []);
  if (after.storedLead.hp !== 1) fail(`localStorage lead hp: ${after.storedLead.hp}`);
  if (after.storedSecond?.hp !== 50) fail(`localStorage second hp: ${after.storedSecond?.hp}`);
  if ("ailments" in after.storedLead) fail("battle ailments leaked into localStorage partnerStats");

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, lead: after.lead, second: after.second,
    storedLead: { hp: after.storedLead.hp, mp: after.storedLead.mp, dv: after.storedLead.dvGauge,
                  ail: Object.keys(after.storedLead.ailments || {}) },
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
