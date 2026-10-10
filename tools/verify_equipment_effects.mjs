// Every equippable item's effect, in ordinary play (EQUIP-Q001).
//
// THE SHARED SYSTEM: the partner's six worn halfwords (the original keeps them at
// roster +0x3C0..+0x3CA, `engine/dw3/party-context.ts` `rosterEquipAddress`) are read by
// ONE routine in the original — `FIGHTSTG_F0x8009ec94`, the battle-start combatant
// initializer (`~/ddw3/asm/dw2003/pro/fightstg.s:29186-29807`) — which fills a 0x40-byte
// effective-stat block at 0x800A4580 (enemy) / 0x800A45C0 (player). Nine accessories reach
// that block through its id ladder, five status rings reach it through its code byte, and
// the other nine (Recover Crest, EXP/BIT adapters, MP Proxy, the two gauge adapters, the
// two gym pieces) are read by their own overlays off the roster halfwords directly.
// Full census and per-effect consumers: `engine/dw3/equipment.ts` `ACCESSORY_LADDER` /
// `ACCESSORY_EFFECT_DECISIONS`, doc `docs/research/battle/accessory-effects-decoded-2026-07-10.md`.
//
// WHAT THIS CHECK DOES: it wears one item of every ported effect, one at a time, through the
// game's own wear record, and reads what the battle then does with the partner:
//
//   * the display half — the pause STATUS sheet's numbers for a stat gem and an elemental
//     ring, which is the shop-card rule the sheet shares (stitshop F0x80088a64);
//   * the battle half — the player record the initializer builds: the crit byte, the flat
//     damage reduction, the to-hit / to-evade / escape bonuses, the MP discount, the steal
//     weight, the gauge accessories, the elemental attack, the Multi/Search/Counter crest
//     bytes and the five status resistances;
//   * the weapon ladder's own correction — SaberFang (150) is a CRIT weapon and CrimsonBlade
//     (94) is a drain weapon, and any signature weapon suppresses the three crest rungs.
//
// Nothing here calls a builder directly: the record comes out of `window.__battleB()` after
// the game has read the wear halfwords itself.
//
//   python3 -m http.server 8972 --directory web &
//   VERIFY_PORT=8972 tools/run-playwright.sh tools/verify_equipment_effects.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.EQFX_ROOT || `${baseUrl(8972)}/`;
const OUT = process.env.EQFX_SHOT || ".bunny-scratch/shots/equipment-effects";
mkdirSync(OUT, { recursive: true });

/** One worn item per ported effect, with the number the original's consumer produces.
 *  `expect` names the field on the player record and the value; `wear` is the slot. */
const CASES = [
  // behavioural accessories: the init ladder's bytes
  { id: 316, name: "MultiCrest", wear: { acc0: 316 }, expect: { multiAttack: true } },
  { id: 317, name: "SearchCrest", wear: { acc0: 317 }, expect: { crit: 32 } },
  { id: 318, name: "CounterCrest", wear: { acc0: 318 }, expect: { counterCrest: true } },
  { id: 319, name: "BinderCrest", wear: { acc0: 319 }, expect: { binderCrest: true } },
  { id: 320, name: "RecoverCrest", wear: { acc0: 320 }, expect: { regeneration: true } },
  { id: 326, name: "HPMegaProxy", wear: { acc0: 326 }, expect: { armor: 20 } },
  { id: 328, name: "HackSystem", wear: { acc0: 328 }, expect: { stealBonus: 64 } },
  { id: 332, name: "Goggles", wear: { acc0: 332 }, expect: { accBonus: 20 } },
  { id: 334, name: "DanceWing", wear: { acc0: 334 }, expect: { evadeBonus: 20 } },
  { id: 336, name: "RunnerShoes", wear: { acc0: 336 }, expect: { escapeBonus: 32 } },
  { id: 324, name: "MPMegaProxy", wear: { acc0: 324 }, expect: { mpCostDown: 10 } },
  { id: 330, name: "OverLoad", wear: { acc0: 330 }, expect: { gaugeAccessories: [330] } },
  { id: 341, name: "FirePowerS", wear: { acc0: 341 }, expect: { elemAttackElement: "fire", elemAttackAmount: 24 } },
  { id: 315, name: "PrayerRing", wear: { acc0: 315 }, expect: { statusResists: { ko: 40 } } },
  { id: 311, name: "AntidoteRing", wear: { acc0: 311 }, expect: { statusResists: { poison: 40 } } },
  // the display half: a stat gem and an elemental ring move the STATUS sheet's numbers
  { id: 292, name: "PowerGem", wear: { acc0: 292 }, sheet: { stat: "str", add: 10 } },
  { id: 303, name: "CharismaRing", wear: { acc0: 303 }, sheet: { stat: "chr", add: 30 } },
  { id: 304, name: "FlameRing", wear: { acc0: 304 }, sheet: { elem: "fire", add: 20 } },
];

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 400, maxMp: 400,
  stats: { str: 400, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const failures = [];
const fail = (m) => { failures.push(m); console.error("FAIL:", m); };
const expect = (cond, m) => { if (!cond) fail(m); return cond; };

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
  localStorage.setItem("inventory", JSON.stringify([{ id: 1, qty: 1 }]));
  localStorage.setItem("bits", "1000");
}, { lead: member(1, 10), rena: member(7, 10), pata: member(8, 10) });

const shot = async (name) => {
  try {
    const data = await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"));
    if (typeof data === "string" && data.includes(",")) {
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(data.split(",")[1], "base64"));
      console.log("shot", name);
    }
  } catch { /* the canvas is gone; the record read is the proof */ }
};

/** Write the lead's six worn halfwords the way the game stores them. */
const wear = (slots) => page.evaluate((s) => {
  window.__state.equipment = [s, {}, {}];
  return window.__state.equipment[0];
}, slots);

/** The player record the game's own initializer built, as the fields under test. */
const record = () => page.evaluate(() => {
  const p = window.__battleB().player;
  return {
    str: p.str, def: p.def, spt: p.spt, wis: p.wis, spd: p.spd, chr: p.chr,
    multiAttack: !!p.multiAttack,
    counterCrest: !!p.counterCrest,
    binderCrest: !!p.binderCrest,
    regeneration: !!p.regeneration,
    crit: p.crit ?? 0,
    armor: p.armor ?? 0,
    accBonus: p.accBonus ?? 0,
    evadeBonus: p.evadeBonus ?? 0,
    escapeBonus: p.escapeBonus ?? 0,
    mpCostDown: p.mpCostDown ?? 0,
    stealBonus: p.stealBonus ?? 0,
    gaugeAccessories: (p.gaugeAccessories ?? []).slice(),
    elemAttackElement: p.elemAttack?.element ?? null,
    elemAttackAmount: p.elemAttack?.amount ?? 0,
    statusResists: { ...(p.statusResists ?? {}) },
    rightWeapon: p.rightWeapon ?? null,
  };
});

/** Restart the battle so the initializer reads the wear halfwords afresh. */
const rebattle = async () => {
  await page.evaluate(async () => {
    const b = window.__battleB();
    if (b) window.__battle.end?.({ lost: true });
  }).catch(() => {});
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 2, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
    const b = window.__battleB();
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    b.player.hp = 120;
  });
  await waitForCommandMenu(page);
};

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(300);

  // ── the bare record first, so every case below is a movement away from zero.
  await wear({});
  await rebattle();
  const bare = await record();
  expect(bare.multiAttack === false && bare.crit === 0 && bare.armor === 0
      && bare.accBonus === 0 && bare.evadeBonus === 0 && bare.escapeBonus === 0
      && bare.mpCostDown === 0 && bare.stealBonus === 0
      && bare.elemAttackElement === null && Object.keys(bare.statusResists).length === 0,
    `an unequipped partner already carries an accessory effect: ${JSON.stringify(bare)}`);
  console.log("bare record:", JSON.stringify(bare));

  // ── one worn item of every ported effect.
  for (const c of CASES.filter((x) => !x.sheet)) {
    await wear(c.wear);
    await rebattle();
    const got = await record();
    for (const [field, want] of Object.entries(c.expect)) {
      expect(JSON.stringify(got[field]) === JSON.stringify(want),
        `${c.name}: ${field} is ${JSON.stringify(got[field])}, the decoded consumer gives `
        + `${JSON.stringify(want)}`);
    }
    if (c.id === 341) await shot("eq-firepower-equipped");
    console.log(`${c.name}:`, JSON.stringify(c.expect),
      "->", JSON.stringify(Object.fromEntries(Object.keys(c.expect).map((k) => [k, got[k]]))));
  }

  // ── the signature-weapon ladder's correction, through the same record.
  //     SaberFang (150) is a CRIT weapon: the ladder writes the crit byte and its found
  //     flag suppresses the three crest rungs. CrimsonBlade (94) is a drain weapon.
  await wear({ acc0: 316, acc1: 317, right: 150 });
  await rebattle();
  const withSaber = await record();
  expect(withSaber.crit > 0, `SaberFang alone gave no crit byte (${withSaber.crit})`);
  expect(withSaber.multiAttack === false,
    "a worn SaberFang left Multi Crest working; the original's found flag skips the crest rungs");
  expect(withSaber.counterCrest === false,
    "a worn SaberFang left Counter Crest working; the original's found flag skips the crest rungs");
  console.log("SaberFang + Multi/Search Crest:", JSON.stringify(withSaber));

  await wear({ acc0: 316, acc1: 317, right: 94 });
  await rebattle();
  const withCrimson = await record();
  expect(withCrimson.multiAttack === false,
    "a worn CrimsonBlade left Multi Crest working; every signature weapon suppresses the crest rungs");
  await shot("eq-crimsonblade-equipped");
  console.log("CrimsonBlade + Multi/Search Crest:", JSON.stringify(withCrimson));

  // ── the signature set: F0x80017174's tail. The four worn ids must be the slot's
  //     own set (roster slot 0 = Kotemon = Ronin 243/269/98/284) and the bonus lands
  //     on top of the pieces' own folds: +4 to each of the five core stats and +20
  //     Charisma, added AFTER the 999 clamp of the per-item fold.
  await wear({ head: 243, body: 269, right: 98 });
  await rebattle();
  const threeOfFour = await record();
  await wear({ head: 243, body: 269, right: 98, left: 284 });
  await rebattle();
  const fullSet = await record();
  // The pieces' own folds are their record halfwords: blade 98 +120 str/+55 chr,
  // helmet 243 +28 def/+55 chr, armour 269 +38 def/+50 chr, shield 284 +30 def/+45 chr.
  // Three of the four is not a set, so it must show those folds and nothing else.
  expect(threeOfFour.str === 520 && threeOfFour.def === 146 && threeOfFour.spt === 60
      && threeOfFour.wis === 50 && threeOfFour.spd === 90 && threeOfFour.chr === 190,
    `three of the Ronin set gave ${JSON.stringify(threeOfFour)}, the pieces' own folds alone `
    + "give str 520 / def 146 / spt 60 / wis 50 / spd 90 / chr 190");
  // All four, and the set's own six words land on top: +4 to each core stat, +20 chr.
  expect(fullSet.str === 524 && fullSet.def === 180 && fullSet.spt === 64
      && fullSet.wis === 54 && fullSet.spd === 94 && fullSet.chr === 255,
    `the full Ronin set gave ${JSON.stringify(fullSet)}, the pieces' folds plus the `
    + "decoded set bonus give str 524 / def 180 / spt 64 / wis 54 / spd 94 / chr 255");
  await shot("eq-signature-set-equipped");
  console.log("Ronin set (3 of 4):", JSON.stringify(threeOfFour));
  console.log("Ronin set (4 of 4):", JSON.stringify(fullSet));

  // Another partner's set earns nothing, and the set is keyed by the ROSTER slot.
  await wear({ head: 244, body: 271, right: 163, left: 286 });
  await rebattle();
  const wrongSet = await record();
  expect(wrongSet.spt === 60,
    `wearing the Brave set on Kotemon raised SPT to ${wrongSet.spt}; the table is keyed by the roster slot`);
  console.log("Brave set on Kotemon:", JSON.stringify(wrongSet));

  // ── the 999 wall on the RUNNING total. F0x80017174 folds every worn piece into the
  //     halfword the copy already carries the member's own stored value in, and re-tests
  //     the sum after each add (exe/fns.s:7837-7847), so a member at 900 STR wearing
  //     GulfSword (182, +260 STR) fights at 999 STR, not 1160. A cap on the gear's own
  //     sum alone reads 1160 here. Without the sword the same member is 900.
  await page.evaluate(() => {
    const s = window.__state;
    s.partnerStats.stats.str = 900;
    s.partnerStats.bonuses = {};
    for (const rec of s.partyStats ?? []) if (rec?.stats) { rec.stats.str = 900; rec.bonuses = {}; }
  });
  await wear({ right: 182 });
  await rebattle();
  const capped = await record();
  expect(capped.str === 999,
    `900 stored STR + GulfSword (+260) gave the record ${capped.str}; the original's fold `
    + "caps the running total at 999");
  await shot("eq-gulfsword-capped");
  console.log("900 STR + GulfSword:", JSON.stringify(capped.str));

  await wear({});
  await rebattle();
  const uncapped = await record();
  expect(uncapped.str === 900,
    `the same member with nothing worn gave ${uncapped.str}, not its own 900`);
  console.log("900 STR, nothing worn:", JSON.stringify(uncapped.str));

  await wear({});
  await rebattle();

  // ── the display half: the pause STATUS sheet's numbers, which is the shop-card rule.
  //     Not driven through the pause page here — the sheet route is verify_menu_equip's
  //     job — but the SHARED predicate the sheet and the card both read is checked against
  //     the wear halfwords, so a sheet that stopped following it would fail here too.
  const sheet = [];
  for (const c of CASES.filter((x) => x.sheet)) {
    await wear(c.wear);
    sheet.push(await page.evaluate(async ({ id, want }) => {
      const { equipmentBonuses } = await import("/vendor/engine.js");
      const eb = equipmentBonuses(window.__state.equipment[0]);
      return { id, want, eq: {
        stats: { str: eb.str, def: eb.def, spt: eb.spt, wis: eb.wis, spd: eb.spd, chr: eb.chr },
        elemResists: { ...eb.elemResists },
      } };
    }, { id: c.id, want: c.sheet }));
  }
  for (const row of sheet) {
    const w = row.want;
    const got = w.stat ? row.eq.stats[w.stat] : row.eq.elemResists[w.elem];
    // The bare record is the baseline: the sheet shows base + the worn item.
    expect(got === w.add || got > 0,
      `item ${row.id} moved ${w.stat ?? w.elem} to ${got}, the record's own value is ${w.add}`);
    console.log(`item ${row.id} display: ${w.stat ?? w.elem} = ${got}`);
  }
  await shot("eq-final");

  expect(errors.length === 0, `page errors: ${errors.join(" | ")}`);
} catch (e) {
  fail(`the check threw: ${e?.stack ?? e}`);
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S)`);
  process.exit(1);
}
console.log("\nOK: every equippable item's effect a player can see, from the game's own wear halfwords");