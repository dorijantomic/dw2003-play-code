// Disc fixes for the post-hit queue slots and the counter (scratch/tech-audit fill-D-last.json):
//  (1) 430 Dark Pupil, dispatch 13: 50% flee lock, time (rand%101+100)*211.f9(24), page esmfight[0x44];
//  (2) 431 Vemmon, dispatch 29: floor(player maxMP*f9/128) player -> enemy, kind 18 "{1} MP absorbed!";
//  (3) debuff-with-damage techs 81/351/355/388/434: pages esmfight[0x33] / [0x34];
//  (4) counter: no 3-use half-damage stance; blow base = dmgTaken*f9/64 (/32 when charged), real resolver.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPostHitDispatch, applyStatDebuffDispatch, battleStatusEventAdvance,
} from "../web/battle.js";
import {
  DAMAGE_TERM_POST_HIT_ARMS, resolveCounterBlow, counterBlowBase,
} from "../web/vendor/engine.js";
import { Arena } from "../web/mpbattle-rules.js";
import { castFieldTechnique } from "../web/battle.js";
import { frozenGateBlocksTurn } from "../web/vendor/engine.js";

const T = JSON.parse(readFileSync(new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const mk = (over = {}) => ({ profile: { name: "x", id: 100, family: 1 }, level: 10, hp: 300, maxHp: 300, mp: 60,
  maxMp: 60, str: 150, def: 100, spt: 100, wis: 40, spd: 80, affinity: 0, statMods: { str: 0, def: 0, spd: 0 },
  ailments: {}, ...over });
function battle(p = {}, e = {}) {
  const player = mk(p), enemy = mk(e);
  return { player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0, encounterGateBytes: new Array(14).fill(0) };
}
const cycle = (values) => { let i = 0; return () => values[i++ % values.length]; };

test("430 Dark Pupil: table row 13 is the real word, 50% roll, lock 2400..4800, page 0x44, expires", () => {
  assert.equal(DAMAGE_TERM_POST_HIT_ARMS[11].dispatch, 13);
  assert.equal(DAMAGE_TERM_POST_HIT_ARMS[11].arm, 0x8009e0b4, "BEFORE: 0x8009e0bc (bare return)");
  let landed = 0, min = 1e9, max = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const b = battle();
    const r = applyPostHitDispatch(b, T[430], { lockRecord: T[211], playerName: "Agumon", enemyName: "Foe", rng: undefined });
    if (r?.landed) {
      landed++;
      assert.equal(b.player.cantFlee, true);
      const ev = b.statusEvents.find((e) => e.code === 0x10);
      min = Math.min(min, ev.time); max = Math.max(max, ev.time);
      assert.equal(r.page.spec.kind, 2);
      assert.deepEqual(r.page.spec.payload, [0x44, 0]);
      assert.equal(r.page.spec.name, "Agumon");
    } else assert.equal(b.player.cantFlee, undefined);
  }
  const rate = landed / N;
  assert.ok(rate > 0.45 && rate < 0.55, `rate ${rate}`);
  assert.ok(min >= 2400 && max <= 4800, `time ${min}..${max}`);
  // expiry clears the lock
  const b = battle();
  for (let i = 0; i < 200 && !applyPostHitDispatch(b, T[430], { lockRecord: T[211] })?.landed; i++);
  assert.equal(b.player.cantFlee, true);
  for (let n = 0; n < 30 && b.player.cantFlee; n++) battleStatusEventAdvance(b);
  assert.equal(b.player.cantFlee, false, "expired");
  // the magnitude is record 211's f9 (24), not 430's own (32)
  assert.equal(T[211].crit, 24); assert.equal(T[430].crit, 32);
  console.log(`AFTER 430: landed ${(rate * 100).toFixed(1)}% , lock ${min}..${max} units, page [0x44,0] | BEFORE: nothing happened, row word 0x8009e0bc`);
});

test("431 Vemmon: drains floor(player maxMP*8/128) player -> enemy, kind 18 page, caps", () => {
  const b = battle({ mp: 300, maxMp: 320 }, { mp: 10, maxMp: 100 });
  const r = applyPostHitDispatch(b, T[431], { playerName: "Agumon", enemyName: "Vemmon" });
  assert.equal(r.amount, 20);
  assert.equal(b.player.mp, 280);
  assert.equal(b.enemy.mp, 30);
  assert.equal(r.page.spec.kind, 18);
  assert.deepEqual(r.page.spec.payload, [0x10, 20, 1]);
  assert.deepEqual(r.page.spec.slots, ["20"]);
  assert.equal(r.page.spec.name, "Vemmon");
  // capped at the player's current MP; enemy clamped at its max; no MP -> nothing
  const c = battle({ mp: 5, maxMp: 320 }, { mp: 99, maxMp: 100 });
  assert.equal(applyPostHitDispatch(c, T[431], {}).amount, 5);
  assert.equal(c.player.mp, 0); assert.equal(c.enemy.mp, 100);
  const d = battle({ mp: 0, maxMp: 320 });
  assert.equal(applyPostHitDispatch(d, T[431], {}).landed, false);
  console.log("AFTER 431: 320 maxMP -> 20 MP moved (6.25%), page kind 18 [0x10,20,1] | BEFORE: nothing moved, no page");
});

test("debuff-with-damage techs print esmfight 0x33 / 0x34 (kind 2) naming the debuffed side", () => {
  const out = {};
  for (const id of [81, 351, 355, 388, 434]) {
    const b = battle();
    const r = applyStatDebuffDispatch(b, 0, T[id], { player: "Agumon", enemy: "Foe" });
    const word = r.stat === 0 ? 0x33 : 0x34;
    assert.equal(r.page.spec.kind, 2, id);
    assert.deepEqual(r.page.spec.payload, [word, 0x10], id);
    assert.equal(r.page.spec.name, "Foe");
    out[id] = `0x${word.toString(16)}`;
  }
  const b = battle();
  const r = applyStatDebuffDispatch(b, 1, T[351], { player: "Agumon", enemy: "Foe" });
  assert.deepEqual(r.page.spec.payload, [0x34, 0]);
  assert.equal(r.page.spec.name, "Agumon");
  console.log("AFTER pages:", JSON.stringify(out), "| BEFORE: no page");
});

test("counter: no stance; blow base = taken*f9/64 (/32 charged); real resolver", () => {
  // before: dmg>>1 whatever the record (200 taken -> 100). after:
  const rows = { "f9=1": 1, "f9=64": 64, "f9=96": 96, "f9=127": 127 };
  const out = {};
  for (const [k, f9] of Object.entries(rows)) out[k] = [counterBlowBase(200, f9), counterBlowBase(200, f9, true)];
  assert.deepEqual(out["f9=1"], [3, 6]);
  assert.deepEqual(out["f9=64"], [200, 400]);
  assert.deepEqual(out["f9=96"], [300, 600]);
  assert.equal(counterBlowBase(200, 64, true, true), 200, "player basic tech skips the scale");
  // the real resolver: a weak f9 (1) blow does far less than a strong one (96) from the same fighters
  const foe = mk({ str: 200 }), me = mk();
  const skill = { id: 335, power: 20, attack_category: "physical", basic_attack: true, element: "normal" };
  const rng = cycle([100, 3000, 20000, 41000, 9000]);
  const weak = resolveCounterBlow(foe, me, skill, 200, 1, rng);
  const strong = resolveCounterBlow(foe, me, skill, 200, 96, cycle([100, 3000, 20000, 41000, 9000]));
  assert.equal(weak.hit, true); assert.equal(strong.hit, true);
  assert.ok(strong.dmg > weak.dmg * 20, `weak ${weak.dmg} strong ${strong.dmg}`);
  const charged = resolveCounterBlow({ ...foe, aura: true }, me, skill, 200, 96, cycle([100, 3000, 20000, 41000, 9000]));
  assert.ok(charged.dmg > strong.dmg * 1.8, `charged ${charged.dmg} strong ${strong.dmg}`);
  console.log(`AFTER counter (taken 200): f9=1 base 3 | f9=64 base 200 | f9=96 base 300 | charged x2; blow dmg f9=1 ${weak.dmg}, f9=96 ${strong.dmg}, charged ${charged.dmg} | BEFORE: always 100`);
});

test("counter: a magical skill still runs the physical tail; Multi-Crest basic tech holds the 0.4x gate off", () => {
  const seq = () => cycle([100, 3000, 20000, 41000, 9000]);
  const skill = { id: 335, power: 20, attack_category: "physical", basic_attack: true, element: "normal", base_acc: 110 };
  const mag = { ...skill, attack_category: "magical", element: "fire", damage_scalar: 30 };
  const RES = { fire: 80, water: 120, ice: 150, wind: 320, thunder: 95, machine: 210, dark: 60 };
  const prof = { name: "X", id: 100, family: 77, resistances: RES, status_resist: { poison: 0, paralyze: 0, confuse: 0, sleep: 0, ko: 0 } };
  const foe = mk({ str: 200, profile: prof }), me = mk({ profile: prof });
  assert.equal(resolveCounterBlow(foe, me, mag, 200, 64, seq()).dmg, 350);
  assert.equal(resolveCounterBlow(foe, me, mag, 200, 96, seq()).dmg, 525);
  const mc = mk({ str: 200, profile: prof, multiAttack: true });
  assert.equal(resolveCounterBlow(mc, me, skill, 200, 64, seq(), undefined, true).dmg, 200);
});

test("online arena: a player's counter-effect technique (f7=10) does nothing", () => {
  const TECH = { id: 63, name: "Sharp Claw", mp_cost: 0, attack_category: "physical", effect: "counter", power: 25, hits: 1 };
  const kit = { skillDB: () => ({ 63: TECH }), techRecord: () => ({ dispatch: 10, category: 2 }), basic: () => TECH };
  const foe = mk();
  const ar = new Arena({ kit, players: [{ id: 0, name: "P", rec: mk() }], foes: [{ name: "E", rec: foe }], rng: () => 3 });
  const res = ar.playerAction(ar.state().players?.[0]?.key ?? "p0", { k: "tech", sk: 63, tw: 0, t: 0 });
  assert.equal(foe.hp, 300, "BEFORE: the foe took damage");
  assert.deepEqual(res.lines, []);
});

test("counter trigger: Frozen gate (disc gate 2) and comparator 0 = no counter (gate 4), in the real code", () => {
  // The gate is the real engine function; a Frozen defender with power 127 and a low roll is blocked,
  // a non-Frozen one never is.
  const frozen = mk({ ailments: { frozen: { power: 127, turns: 3 } } });
  assert.equal(frozenGateBlocksTurn(frozen, () => 0), true, "Frozen + roll under chance: no reaction");
  assert.equal(frozenGateBlocksTurn(mk(), () => 0), false, "not Frozen: gate open");
  // triggerEnemyCounterRow lives inside createBattle: assert the order of its gates in the shipped source.
  const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  const at = src.indexOf("function triggerEnemyCounterRow");
  const body = src.slice(at, at + 1800);
  const iDmg = body.indexOf("damage <= 0");
  const iFrozen = body.indexOf("frozenGateBlocksTurn(defender");
  const iCmp = body.indexOf("!(row.comparator | 0)");
  assert.ok(iDmg > 0 && iFrozen > iDmg && iCmp > iFrozen, "order: damage word, Frozen roll, comparator 0");
  console.log("AFTER  counter: Frozen defender (roll passes) -> no counter; comparator 0 -> no counter | BEFORE: neither gate");
});

test("field techs 213..219 store element id 6 (thunder) with power 64 + SPT/10", () => {
  for (const id of [213, 214, 215, 216, 217, 218, 219]) {
    const b = { player: mk({ spt: 375 }), enemy: mk(), playerRecords: [null, null, null], activePlayerIndex: 0 };
    castFieldTechnique(b, 0, T[id], "whatever");
    assert.equal(T[id].category, 6);
    assert.deepEqual(b.field, { element: "thunder", power: Math.min(127, T[id].crit + 37) });
  }
  console.log("AFTER  field 213 (SPT 375): {thunder(6), 101} | BEFORE: the tech's own element (fire)");
});
