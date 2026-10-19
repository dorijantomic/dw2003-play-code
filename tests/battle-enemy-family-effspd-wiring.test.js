// The enemy combatant's family byte and the seven EFFECTIVE-SPD call sites (web/battle.js).
//
// SYNTHESIS 2.2 / 2.3, re-verified against the ASM in phase2-rflow.md §4:
//
//   * F0x8009EC94's enemy branch copies the resolved species record's byte +0x30 into the
//     effective block's +0x25 family byte (`pro/fightstg.s:0x8009f5f4`,
//     engine/dw3/equipment.ts:883-885), and that field IS SDIGIEDT's `digimon_type`
//     (ddw3 `rust/dw2003_pro_sdigiedt/src/data.rs` — EnemyStats +0x30). `enemyToProfile`
//     dropped it, so `effStats` answered the fallback 1 for every enemy DEFENDER: a
//     family-targeted technique (record +0x9 = elem2 >= 2) lost its x1.5 stage
//     (F0x8009f6dc .L0x8009f740-.L0x8009f7a8), its +0x3C physical crit arm (F0x800a02ac)
//     and its +0x40 magical one (F0x800a0514).
//   * the delay routine F0x8009bda4 builds BOTH blocks through F0x8009ec94 and reads +0x0a
//     from each (`:26308-26309`); the escape roll F0x800a1608 does the same for both its
//     sides (`:31974-31975` player, `:32001-32004` enemy). The walker passed the stored
//     halfwords at seven sites, so a form change, a stat modifier or a persistent penalty
//     never reached turn order, the status clock or either flee roll.
//
// Each half runs the code, not the spelling: the two functions are lifted out of
// web/battle.js and driven against the real engine leaves, so the first test would still
// catch a renamed field (it reads the object `effStats`/`resolveDamage` actually see) and
// the second catches a "use effStats somewhere else" rewrite that leaves a site raw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { effStats } from "../engine/dw3/battle-combat.ts";
import { resolveDamage, critProc, actionTimelineDelay } from "../engine/dw3/battle-formulas.ts";

const SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const DATA = (rel) => JSON.parse(readFileSync(new URL(`../web/assets/data/${rel}`, import.meta.url), "utf8"));

const noCrit = () => 0x7f;   // 127: under no chance this test can reach

/** Lift one function declaration out of web/battle.js and bind the names it closes over. */
function evalFn(name, bindings = {}) {
  const decl = SRC.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n {0,2}\\}`));
  assert.ok(decl, `web/battle.js still declares ${name}()`);
  const names = Object.keys(bindings);
  return new Function(...names, `${decl[0]}\nreturn ${name};`)(...names.map((n) => bindings[n]));
}

/** A live combat record in the walker's shape, the way buildEnemyRecord/buildPlayerRecord make them. */
function combatant(profile, over = {}) {
  return {
    profile, level: 20, hp: 400, maxHp: 400, mp: 100, maxMp: 100,
    str: 100, def: 100, spt: 100, wis: 100, spd: 100, chr: 0,
    ailments: {}, statMods: { str: 0, def: 0, spd: 0 },
    ...over,
  };
}

// ── 2.2: the enemy profile carries the species family byte ──────────────────────────────

test("enemyToProfile carries digimon_type as the profile's family", () => {
  const enemyToProfile = evalFn("enemyToProfile");
  const prof = enemyToProfile({
    enemy_id: "Kuwagamon", digimon_id: "Kuwagamon", digimon_type: 4,
    resistances: { fire: 90, thunder: 160 },
  });
  assert.equal(prof.name, "Kuwagamon");
  assert.deepEqual(prof.resistances, { fire: 90, thunder: 160 });
  assert.equal(prof.family, 4,
    "the enemy branch of F0x8009ec94 copies species +0x30, i.e. digimon_type");
});

test("an enemy defender's family reaches the x1.5 stage and the +0x3C crit arm", () => {
  const enemyToProfile = evalFn("enemyToProfile");
  const player = effStats(combatant({ id: 1, name: "Agumon", family: 1, resistances: {} }));
  const def = effStats(combatant(enemyToProfile({
    digimon_id: "Kuwagamon", digimon_type: 2, resistances: {},
  })));
  assert.equal(def.family, 2, "effStats must answer the enemy's own family");

  // The physical family stage (F0x8009f6dc stage 2) and the magical +50% arm.
  const skill = { element: "normal", power: 100, target_family: 2 };
  assert.equal(resolveDamage(100, player, def, skill, noCrit), 150);
  assert.equal(resolveDamage(100, player, def, { ...skill, magical: true }, noCrit), 150);
  // A family the defender does not carry gets nothing.
  assert.equal(resolveDamage(100, player, def, { ...skill, target_family: 3 }, noCrit), 100);

  // The crit arm: 4 base + 0x3C only on the match (0x800a02ac).
  assert.equal(critProc(player, def, { ...skill, effect: "drain" }, () => 0x3f), true);
  assert.equal(critProc(player, def, { ...skill, effect: "drain" }, () => 0x40), false);
  assert.equal(critProc(player, def, { ...skill, target_family: 3, effect: "drain" }, () => 0x3f), false);
});

test("every shipped enemy row has the family byte the disc copies", () => {
  const { enemies } = DATA("enemies.json");
  assert.equal(enemies.length, 194);
  for (const e of enemies) {
    assert.equal(typeof e.digimon_type, "number", `${e.enemy_id} carries digimon_type`);
    assert.ok(e.digimon_type >= 0 && e.digimon_type <= 11, `${e.enemy_id}: ${e.digimon_type} in 0..11`);
  }
});

// ── 2.3: SPD is read through the effective block ────────────────────────────────────────

test("effectiveSpd answers the block's +0x0a, not the stored halfword", () => {
  const effectiveSpd = evalFn("effectiveSpd", { effStats });
  const plain = combatant({ id: 1, name: "Agumon", family: 1, resistances: {} });
  assert.equal(effectiveSpd(plain), 100);

  // A live stat modifier (the category-5 speed arm's +0x14) folds in.
  assert.equal(effectiveSpd({ ...plain, statMods: { str: 0, def: 0, spd: 50 } }), 150);
  // A persistent penalty from an earlier battle subtracts, floored at 1.
  assert.equal(effectiveSpd({ ...plain, statPenalty: { str: 0, def: 0, spd: 40 } }), 60);
  assert.equal(effectiveSpd({ ...plain, statPenalty: { str: 0, def: 0, spd: 400 } }), 1);
  // A missing record answers what the raw sites used to pass.
  assert.equal(effectiveSpd(undefined), 0);
});

test("the delay the disc reads really moves with effective SPD", () => {
  assert.notEqual(actionTimelineDelay(60, 150), actionTimelineDelay(150, 150));
  assert.ok(actionTimelineDelay(150, 150) < actionTimelineDelay(60, 150));
});

test("all seven timeline/status/flee sites pass the effective SPD", () => {
  const sites = [
    ["status clock", /statusEventActionDelay\(effectiveSpd\(b\.player\), effectiveSpd\(b\.enemy\)\)/],
    ["battle boot", /initialActorTimeline\(effectiveSpd\(initialPlayer\), effectiveSpd\(enemyObj\)\)/],
    ["turn schedule", /scheduleNextActor\(b\.timeline, acted, effectiveSpd\(b\.player\), effectiveSpd\(b\.enemy\)\)/],
    ["party step", /initialActorTimeline\(effectiveSpd\(b\.player\), effectiveSpd\(nextEnemy\)\)/],
    ["finale beat", /initialActorTimeline\(effectiveSpd\(b\.player\), effectiveSpd\(next\)\)/],
    ["enemy flee", /enemyFleeProc\(effectiveSpd\(b\.player\), effectiveSpd\(en\), /],
    ["player run", /selfSpd: effectiveSpd\(b\.player\), otherSpd: effectiveSpd\(b\.enemy\)/],
  ];
  for (const [name, re] of sites) assert.ok(re.test(SRC), `${name} reads the effective block's +0x0a`);
});

test("no site was left on the stored halfword", () => {
  const stale = [
    /statusEventActionDelay\(b\.player\?\.spd/,
    /initialActorTimeline\(initialPlayer\.spd, enemyObj\.spd\)/,
    /scheduleNextActor\(b\.timeline, acted, b\.player\.spd, b\.enemy\.spd\)/,
    /initialActorTimeline\(b\.player\.spd, nextEnemy\.spd\)/,
    /initialActorTimeline\(b\.player\.spd, next\.spd\)/,
    /enemyFleeProc\(b\.player\.spd, en\.spd/,
    /selfSpd: b\.player\.spd \| 0, otherSpd: b\.enemy\.spd \| 0/,
  ];
  for (const re of stale) assert.ok(!re.test(SRC), `raw SPD left at ${re}`);
});
