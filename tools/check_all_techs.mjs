#!/usr/bin/env node
// tools/check_all_techs.mjs - does OUR technique code do what the original PS1 disc does?
//
//   node tools/check_all_techs.mjs            (no browser, no fight; ~10 s)
//   node tools/check_all_techs.mjs --verbose  (also print the "not checked" list and every skipped case)
//   options for the break-it proof only:
//     --digimon=<path>   skill bank the GAME merges (default web/assets/data/digimon.json)
//     --table=<path>     technique table the GAME merges (default web/assets/data/fight_tech_table.json)
//     --disc=<path>      technique table used as the DISC reference (default = --table)
//     --engine=<path>    engine bundle used for the direct-call checks (default web/vendor/engine.js)
//     --web=<dir>        JS tree the game code (battle.js, tech-record.js, enemy-stats.js, vendor/engine.js) is imported from (default web/); a /tmp copy lets a break-it proof change game code without touching the repo
//
// WHAT IT DOES, for every technique id of the disc table (1..443):
//   NUMBERS  the skill our game builds (digimon.json row + web/tech-record.js mergeTechRecord, exactly the
//            merge web/battle.js runs at load) against the disc row: MP, power, category, element 1,
//            element 2, scalar, accuracy byte, target, hits, clip, effect opcode, effect parameters.
//   CODE     our REAL functions (engine bundle web/vendor/engine.js + web/battle.js plan functions), called
//            directly with fixed stat sets and scripted random draws, against an EXPECTED value computed here
//            by an independent reference of the disc formula. The reference below imports nothing of ours;
//            each formula cites the walker doc line (doc:) or the disc assembly line (asm:) it was written from.
//            Checks: mp, accuracy, damage (+crit), crit chance, drain, multi-hit, status landing,
//            instant death, stat debuff on hit, heals/cures/revive (cat 4), stat buffs/debuffs, charges,
//            locks, MP steal, Gilead Plant (cat 5), field techniques (cat 6).
//   EXTENSION (every other battle effect a technique can have): steal (127/128), the timeline delays of every status / buff / debuff / lock / Auto Recover entry and the one event queue
//   (delay, timers, pool, cureevt), poison tick / frozen block / confusion gag rolls (poisonhp, frozen, confuse), the equipment / field / target-status terms of the accuracy, crit and damage leaves
//   (accterms, critterms, tailterms), counters (counter), post-hit codes 13/29/32-35 (posthit, penalty), Back Storm 406 with its slot records 441/442 (repeat), who a technique acts on when the other side casts it
//   (side), the enemy stat scale (enemyscale), table rows no skill uses (norow) and one hand-worked example per check (hand). Printed at the end: the NOT CHECKED list, each item with its reason.
// The disc table is only READ at run time (never copied into the repo). Exit code 1 on any mismatch.
//
// Doc root DOCS = ~/ddw3-walker/docs/research ; asm = ~/ddw3/asm/dw2003/pro/fightstg.s
//
// Where the reference follows the assembly and NOT the walker doc text (both read from ~/ddw3/asm/dw2003/pro/fightstg.s):
//  - physical tail, element 2 family match: `sra 1` then `addu $s0, $v0` = ADDS half (x1.5), doc battle-formula-leaves.md:175-181 says "halves" (0x8009f740-0x8009f770)
//  - magical crit magnitude: RAND % 65 + 0x20 (0x7e07e07f divide-by-65 magic, 0x8009fd54-0x8009fda4); the physical leaf uses RAND & 0x3f (0x8009f8e4)
//  - magical crit chance, element 1 == 1: the scalar divisor address arithmetic `elem-2` reads the defender's +0x0a (SPD) (0x800a0590-0x800a059c)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const opt = (name, def) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const VERBOSE = argv.includes("--verbose");
const P_WEB = opt("web", path.join(ROOT, "web"));          // JS tree the game code is imported from (default web/); a /tmp copy lets the break-it proofs change game code without touching the repo
const P_DIGIMON = opt("digimon", path.join(ROOT, "web/assets/data/digimon.json"));
const P_TABLE = opt("table", path.join(ROOT, "web/assets/data/fight_tech_table.json"));
const P_DISC = opt("disc", P_TABLE);
const P_ENGINE = opt("engine", path.join(P_WEB, "vendor/engine.js"));
const imp = (p) => import(pathToFileURL(p).href);

// ---------------------------------------------------------------------------------------------
// 0. Freshness guard: the game runs the bundle web/vendor/engine.js, which is built from engine/*.ts.
//    If the battle modules of the bundle differ from a fresh build of the sources, the check would
//    test old code: say so and fail.
// ---------------------------------------------------------------------------------------------
const notes = [];       // things that could not be checked / warnings
let staleBundle = false;
async function freshnessGuard() {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { notes.push("bundle freshness NOT verified (esbuild not installed)"); return; }
  const r = await esbuild.build({ entryPoints: [path.join(ROOT, "engine/index.ts")], bundle: true, format: "esm", write: false, logLevel: "silent", absWorkingDir: ROOT });
  const fresh = Buffer.from(r.outputFiles[0].contents).toString("utf8");
  const shipped = fs.readFileSync(path.join(ROOT, "web/vendor/engine.js"), "utf8");
  const chunks = (text) => {
    const m = new Map(); let name = null, buf = [];
    for (const line of text.split("\n")) {
      const h = /^\/\/ (?:\S*\/)?(engine\/\S+\.ts)$/.exec(line);
      if (h) { if (name) m.set(name, (m.get(name) ?? "") + buf.join("\n")); name = h[1]; buf = []; } else buf.push(line);
    }
    if (name) m.set(name, (m.get(name) ?? "") + buf.join("\n"));
    return m;
  };
  const a = chunks(fresh), b = chunks(shipped);
  const diff = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) if (a.get(k) !== b.get(k)) diff.push(k);
  const battle = diff.filter((k) => /engine\/dw3\/(battle-(combat|formulas|damage-terms|status-events|finale|stats|party|items|steal-roll|confusion|form-change|result-page|task-spawn)|random-stream|effective-stats|roster|equipment)/.test(k));
  if (battle.length) { staleBundle = true; notes.push(`STALE BUNDLE: web/vendor/engine.js differs from the sources in ${battle.join(", ")} (run npm run build:engine)`); }
  const other = diff.filter((k) => !battle.includes(k));
  if (other.length) notes.push(`bundle differs from sources only in non-battle modules (${other.length}: ${other.slice(0, 4).join(", ")}...)`);
}
await freshnessGuard();

// ---------------------------------------------------------------------------------------------
// 1. Load the real game modules and the data.
// ---------------------------------------------------------------------------------------------
const E = await imp(P_ENGINE);                         // engine bundle (direct-call checks)
const B = await imp(path.join(P_WEB, "battle.js")); // plan functions (cat 4/5/6, stat debuff on hit)
const TR = await imp(path.join(P_WEB, "tech-record.js"));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const GAME_TABLE = readJson(P_TABLE);
const DISC = readJson(P_DISC);
const SKILLS = readJson(P_DIGIMON).skills;
const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
const IDS = Object.keys(DISC).map(Number).sort((x, y) => x - y);
const disc = (id) => DISC[String(id)];

// The skill the game builds, exactly as web/battle.js loadData does (line `mergeTechRecord(s, rec, { useDiscAcc: true })`).
const gameSkill = (id) => { const s = SKILL_BY_ID.get(id); return s ? TR.mergeTechRecord(s, GAME_TABLE[String(id)], { useDiscAcc: true }) : null; };
const NAME = (id) => SKILL_BY_ID.get(id)?.name ?? "";

// ---------------------------------------------------------------------------------------------
// 2. Bookkeeping: per check the set of tested ids and the set of failed ids; one line per mismatch.
// ---------------------------------------------------------------------------------------------
const CHECKS = new Map();      // check -> { tested:Set, failed:Set }
const chk = (c) => { if (!CHECKS.has(c)) CHECKS.set(c, { tested: new Set(), failed: new Set(), skipped: 0, cases: 0 }); return CHECKS.get(c); };
const tested = (c, id) => { const k = chk(c); k.cases++; k.tested.add(id); };
const groups = new Map();   // one printed line per (check, tech, field kind); numbers in the field text are ignored for grouping
const AGG = new Set(["accterms", "tailterms", "critterms"]);   // many techs, one cause: printed as one line per (check, scenario) with the failing ids
const aggs = new Map();
function bad(c, id, field, expected, ours, extra = "") {
  chk(c).failed.add(id);
  const kind = field.replace(/set [A-E]/g, "set #").replace(/-?\d+(\.\d+)?/g, "#");
  if (AGG.has(c)) {
    const scen = (/scenario "([^"]+)"/.exec(field) ?? [, ""])[1] || field.replace(/-?\d+(\.\d+)?/g, "#");
    const what = field.replace(/scenario "[^"]+"/, "").replace(/ \(chance [^)]*\)/, "").replace(/-?\d+(\.\d+)?/g, "#").trim();
    const key = `${c}|${scen}|${what}`;
    const g = aggs.get(key);
    if (g) { g.ids.add(id); g.n++; return; }
    aggs.set(key, { ids: new Set([id]), n: 1, c, scen, what, first: `id ${id} ${NAME(id)}: ${field}: disc/expected ${JSON.stringify(expected)} ours ${JSON.stringify(ours)}` });
    return;
  }
  const key = `${c}|${id}|${kind}`;
  const g = groups.get(key);
  if (g) { g.n++; return; }
  groups.set(key, { n: 1, line: `${c.padEnd(10)} id ${String(id).padStart(3)} ${String(NAME(id)).padEnd(18)} ${field}: disc/expected ${JSON.stringify(expected)}  ours ${JSON.stringify(ours)}${extra ? "  " + extra : ""}` });
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function eq(c, id, field, expected, ours, extra) { tested(c, id); if (!same(expected, ours)) bad(c, id, field, expected, ours, extra); }

// ---------------------------------------------------------------------------------------------
// 3. Disc constants used below.
// ---------------------------------------------------------------------------------------------
// element 1..8 (doc: battle/battle-system.md:113-125)
const ELEM = ["", "normal", "fire", "water", "ice", "wind", "thunder", "machine", "dark"];
// category 2 physical, 3 magical, 4 heal/cure/revive, 5 scripted stat/lock/MP, 6 field (doc: battle/battle-message-page-kinds-2026-10-04.md:513, 528-546)
const CAT_NAME = { 2: "physical", 3: "magical" };
// target byte f3: 2 = opposing fighter (all 402 attack rows), 3 = one friendly (the heals), 4 = whole party (doc: ui/pause-menu-screen-tree-2026-08-14.md:377-387
// confirms 3 and 4 for heals; 2 and 1 are read from the data pattern, see disc-techs notes), 1 = the field row (cat 6).
const TARGET_TYPE = { 1: "attack", 2: "attack", 3: "heal", 4: "support" };
// effect opcode f7 -> the effect name digimon.json carries (doc: battle/battle-formula-leaves.md:784-810)
const OP_NAME = { 2: "poison", 3: "paralyze", 4: "confuse", 5: "sleep", 6: "instant_death", 8: "drain", 9: "multihit", 10: "counter", 11: "precision", 12: "steal" };

// ---------------------------------------------------------------------------------------------
// CHECK 1: NUMBERS - the skill our game builds vs the disc row.
// ---------------------------------------------------------------------------------------------
const DNA_IDS = new Set([374, 375, 376, 377, 378, 379, 380, 432, 433, 434]);   // built by dnaResultAttack, not from a skill row
const noSkillRow = [];
for (const id of IDS) {
  const r = disc(id), s = gameSkill(id), c = "numbers";
  if (!s) {
    noSkillRow.push(id);
    if (DNA_IDS.has(id) && (r.category === 2 || r.category === 3)) {
      // DNA result attacks come straight from the record through dnaResultAttack (web/battle.js).
      const a = B.dnaResultAttack(id, GAME_TABLE[String(id)], { power: 0, category: 0, element: 1 }, ELEM[r.elem1]).skill;
      eq(c, id, "dna power", r.power, a.power); eq(c, id, "dna category", CAT_NAME[r.category], a.attack_category);
      eq(c, id, "dna element", ELEM[r.elem1], a.element); eq(c, id, "dna accuracy", r.elemCtx, a.base_acc);
      eq(c, id, "dna target_family", r.elem2, a.target_family); eq(c, id, "dna scalar", r.scalar, a.damage_scalar);
    }
    continue;
  }
  eq(c, id, "mp", r.mp, s.mp_cost);
  eq(c, id, "power", r.power, s.power);
  eq(c, id, "category", r.category, s.attack_cat);
  if (CAT_NAME[r.category]) eq(c, id, "category name", CAT_NAME[r.category], s.attack_category);
  eq(c, id, "element 1", ELEM[r.elem1], s.element);
  eq(c, id, "element 2", r.elem2, s.target_family);
  eq(c, id, "scalar", r.scalar, s.damage_scalar);
  eq(c, id, "accuracy (+0x06)", r.elemCtx, s.base_acc);
  eq(c, id, "target (f3 -> type)", TARGET_TYPE[r.f3], s.type);
  eq(c, id, "hits", r.f14, s.hits);
  eq(c, id, "clip", r.clip, s.clip);
  eq(c, id, "effect opcode", r.dispatch, s.effect_id);
  eq(c, id, "effect power", r.crit, s.effect_power);
  if (s.effect !== undefined || OP_NAME[r.dispatch]) eq(c, id, "effect name", OP_NAME[r.dispatch] ?? null, s.effect ?? null);
  if (s.effect_p1 !== undefined) eq(c, id, "effect_p1 (f8)", r.f8, s.effect_p1);
  if (s.effect_p2 !== undefined) eq(c, id, "effect_p2 (f9)", r.crit, s.effect_p2);
}
const missingFromBank = IDS.filter((i) => !SKILL_BY_ID.has(i));
if (missingFromBank.length) notes.push(`no skill row in digimon.json (the game never builds a skill for them): ${missingFromBank.join(",")} - DNA ids (374-380, 432-434) go through dnaResultAttack (numbers); 194/195/375 are category-4 cures run through battleRestorePlanFor (heal, cureevt, side); 129, 130, 443 are run in "norow" and 441/442 in "repeat" with a skill built from the disc row; nothing in enemy_stats.json (attack/tech1/tech2) or digimon.json names 129, 130, 441, 442, 443`);

// ---------------------------------------------------------------------------------------------
// CHECK 2: MP COST. Rule (doc: battle/digivolution-tech-system-decoded-2026-07-11.md:259-278, asm F0x800a1d3c):
//   cost = record mp; enemy side pays list price; MPProxy-type item: cost -= item effect, if <=0 then 1; loaded tech (flag 0x4000): cost += cost/5, min +1.
// ---------------------------------------------------------------------------------------------
const refMp = (mp, { loaded = false, down = 0, enemy = false }) => {
  let cost = mp;
  if (enemy) return cost;
  if (down > 0) { cost -= down; if (cost <= 0) cost = 1; }
  if (loaded) { const p = Math.trunc(cost / 5); cost += p === 0 ? 1 : p; }
  return cost;
};
for (const id of IDS) {
  const r = disc(id), s = gameSkill(id);
  const base = s ? s.mp_cost : r.mp;          // what the game feeds the function (web/battle.js: techniqueMpCost(skill.mp_cost ?? 20, ...))
  for (const v of [{}, { loaded: true }, { down: 5 }, { down: 5, loaded: true }, { down: 999 }, { enemy: true }]) {
    const ours = E.techniqueMpCost(base ?? 20, v.loaded ? 0x4000 : 0, { enemySide: !!v.enemy, mpCostDown: v.down ?? 0 });
    eq("mp", id, `cost ${JSON.stringify(v)}`, refMp(r.mp, v), ours);
  }
}

// ---------------------------------------------------------------------------------------------
// Test combatants and fixed stat sets.
// ---------------------------------------------------------------------------------------------
const mkC = (o = {}) => ({
  profile: { name: o.name ?? "X", id: 100, family: o.family ?? 77, resistances: { ...(o.res ?? { fire: 120, water: 120, ice: 120, wind: 120, thunder: 120, machine: 120, dark: 120 }) },
    status_resist: { poison: o.sr?.poison ?? 0, paralyze: o.sr?.paralyze ?? 0, confuse: o.sr?.confuse ?? 0, sleep: o.sr?.sleep ?? 0, ko: o.sr?.ko ?? 0 } },
  level: o.level ?? 10, hp: o.hp ?? 300, maxHp: o.maxHp ?? 300, mp: o.mp ?? 60, maxMp: o.maxMp ?? 60,
  str: o.str ?? 100, def: o.def ?? 100, spt: o.spt ?? 100, wis: o.wis ?? 40, spd: o.spd ?? 80,
  affinity: o.affinity ?? 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {}, ...(o.extra ?? {}),
});
// resistance values chosen to hit every branch of the magical curve: <100, 100..299, >=300
const SETS = [
  { n: "A", side: 0, atk: { level: 12, str: 150, def: 100, spt: 120, wis: 60, spd: 90 },
    def: { level: 9, str: 80, def: 110, spt: 90, wis: 40, spd: 70, family: 77, res: { fire: 80, water: 120, ice: 150, wind: 320, thunder: 95, machine: 210, dark: 60 } } },
  { n: "B", side: 0, atk: { level: 30, str: 400, def: 200, spt: 300, wis: 200, spd: 200, affinity: 80 },
    def: { level: 35, str: 120, def: 60, spt: 500, wis: 150, spd: 220, family: "MATCH", res: { fire: 50, water: 30, ice: 99, wind: 299, thunder: 100, machine: 300, dark: 450 } } },
  { n: "C", side: 0, atk: { level: 5, str: 20, def: 50, spt: 30, wis: 10, spd: 40 },
    def: { level: 20, str: 200, def: 400, spt: 600, wis: 300, spd: 90, family: 78, res: { fire: 100, water: 99, ice: 300, wind: 150, thunder: 299, machine: 80, dark: 120 } } },
  { n: "E", side: 0x10, scale: 20, atk: { level: 15, str: 130, def: 90, spt: 110, wis: 70, spd: 95 },
    def: { level: 14, str: 100, def: 90, spt: 100, wis: 50, spd: 100, family: "MATCH", res: { fire: 90, water: 140, ice: 310, wind: 60, thunder: 200, machine: 100, dark: 400 } } },
];
function setup(S, r) {
  const fam = S.def.family === "MATCH" ? (r.elem2 >= 2 ? r.elem2 : 78) : S.def.family;
  const atk = mkC({ ...S.atk, name: "Atk", extra: { sideByte: S.side, ...(S.scale ? { powerScale: S.scale } : {}) } });
  const def = mkC({ ...S.def, family: fam, name: "Def", hp: 9999, maxHp: 9999 });
  return { atk, def, fam };
}
const seq = (list) => { let i = 0; return () => (i < list.length ? list[i++] : 0); };

// ---------------------------------------------------------------------------------------------
// REFERENCE IMPLEMENTATION of the disc formulas (independent of engine/*.ts and web/*.js).
// Every division is the MIPS signed division = truncation toward zero (Math.trunc).
// ---------------------------------------------------------------------------------------------
const trunc = Math.trunc;

// Hit chance out of 128; hit iff (RAND & 0x7f) < chance.
//   physical (cat 2), PLAYER side: acc_term = trunc((atk.SPD + atk.+0x3a - def.SPD)/8) + (atk.level - def.level) [- atk.+0x38 on a plain attack];
//   chance = acc + trunc(acc*acc_term/128), NO floor.                      doc: battle/battle-formula-leaves.md:714-734, asm 0x800a0784-0x800a0824
//   physical, ENEMY side: acc_term = trunc((atk.SPD - def.SPD - def.evasion)/8) + level diff; chance floored at 0x20.   asm 0x800a082c-0x800a0890
//   magical (cat 3), both sides: acc_term = trunc((atk.WIS - def.WIS)/8) + level diff, no floor.      asm 0x800a09a0-0x800a09fc (fightstg.s:31082-31099)
function refChance(cat, side, acc, a, d) {
  const lvl = a.level - d.level;
  if (cat === 3) return acc + trunc((acc * (trunc((a.wis - d.wis) / 8) + lvl)) / 128);
  if (side === 0) return acc + trunc((acc * (trunc((a.spd - d.spd) / 8) + lvl)) / 128);
  const c = acc + trunc((acc * (trunc((a.spd - d.spd) / 8) + lvl)) / 128);
  return c < 0x20 ? 0x20 : c;
}
// Crit chance (out of 128), physical leaf F0x800a02ac: 4, +effect power only when opcode == 11, +0x3c when elem2>=2 matches the defender family. doc: battle-formula-leaves.md:634-652
const refCritPhys = (r, famMatch) => 4 + (r.dispatch === 11 ? r.crit : 0) + (r.elem2 >= 2 && famMatch ? 0x3c : 0);
// Magical crit F0x800a0514: min(0x40, trunc(100*scalar / D)) + 4, or +0x40 instead of +4 when elem2>=2 matches the defender family.
//   D = defender effective halfword at +0x0c + 2*(elem1-2) (asm fightstg.s:30793-30805 `addiu v0,-2 / sll 1 / addu / lh 0xc(v0)`): the element value for elem1>=2.
//   For elem1 == 1 (normal) the same address arithmetic reads +0x0a = the defender's SPD (the leaf has no elem1>=2 guard).   doc: battle-formula-leaves.md:645-662; asm for the quirk.
function refCritMag(r, D, famMatch) {
  let t = trunc((100 * r.scalar) / D);
  if (t > 0x40) t = 0x40;
  return r.elem2 >= 2 && famMatch ? t + 0x40 : t + 4;
}
const defElem = (d, e) => d.res[ELEM[e]];
// The damage leaf. Returns { leaf, crit, mag } for a given crit draw d2 and magnitude draw d3.
//   physical F0x8009f97c + F0x8009f6dc (asm 0x8009f97c-0x8009f978):
//     base = trunc(STR * power' / DEF), power' = trunc(power*scale/16) for an enemy attacker
//     s0 = base (+ field 0); elem2>=2 and == def family: s0 += trunc(s0/2) (asm 0x8009f740-0x8009f770: `sra 1` then `addu $s0,$v0`; the doc text "halves" is wrong)
//     affinity byte v: s0 += trunc(s0*v/64)  (asm 0x8009f7b0-0x8009f7d4)
//     elem1>=2: s0 += trunc(2*s0*scalar / defElem(elem1)) (asm 0x8009f7dc-0x8009f864)
//     crit: s0 += trunc(s0*((d3 & 0x3f)+0x20)/64) (asm 0x8009f8e4-0x8009f904)
//     cap: s0 = min(s0, 5*base); if s0 >= 10000 -> 9999 (asm 0x8009f92c-0x8009f950)
//   magical F0x8009fab4 (asm 0x8009fab4-0x8009fe18, doc battle-formula-leaves.md:661-713):
//     mid = trunc(50*atk.SPT/def.SPT)+50; s1 = trunc(power'*mid/100); s1 = min(s1, 2*power'); s1 = max(s1, trunc(power'/2))
//     elem1>=2: v = defElem; s0 = trunc(s0*(v<100 ? 400-3v : v<300 ? 125-trunc(v/4) : 65-trunc(v/20))/100)
//     elem2>=2 == def family: s0 += trunc(s0/2)  (asm 0x8009fd0c-0x8009fd38)
//     crit: s0 += trunc(s0*((d3 % 65)+0x20)/64)  (asm 0x8009fd54-0x8009fda4: the RAND is divided by 65 with the 0x7e07e07f magic, NOT masked with 0x3f)
//     cap: s0 = min(s0, 5*s1); >= 10000 -> 9999
function refLeaf(r, S, st, d2, d3) {
  const A = st.atk, D = st.def;
  const famMatch = r.elem2 >= 2 && r.elem2 === st.fam;
  const power = S.scale ? trunc((r.power * S.scale) / 16) : r.power;
  if (r.category === 2) {
    const base = trunc((A.str * power) / D.def);
    let s0 = base;
    if (r.elem2 >= 2 && famMatch) s0 += trunc(s0 / 2);
    if (A.affinity) s0 += trunc((s0 * A.affinity) / 64);
    if (r.elem1 >= 2) s0 += trunc((2 * s0 * r.scalar) / defElem(D.profile, r.elem1));
    const chance = refCritPhys(r, famMatch);
    const crit = (d2 & 0x7f) < chance;
    if (crit) s0 += trunc((s0 * ((d3 & 0x3f) + 0x20)) / 64);
    if (s0 > 5 * base) s0 = 5 * base;
    if (s0 >= 10000) s0 = 9999;
    return { leaf: s0, crit, chance, base };
  }
  const mid = trunc((50 * A.spt) / D.spt) + 50;
  let s1 = trunc((power * mid) / 100);
  if (s1 > 2 * power) s1 = 2 * power;
  if (s1 < trunc(power / 2)) s1 = trunc(power / 2);
  let s0 = s1;
  if (r.elem1 >= 2) {
    const v = defElem(D.profile, r.elem1);
    const mul = v < 100 ? 400 - 3 * v : v < 300 ? 125 - trunc(v / 4) : 65 - trunc(v / 20);
    s0 = trunc((s0 * mul) / 100);
  }
  if (r.elem2 >= 2 && famMatch) s0 += trunc(s0 / 2);
  const Dcrit = r.elem1 >= 2 ? defElem(D.profile, r.elem1) : D.spd;
  const chance = refCritMag(r, Dcrit, famMatch);
  const crit = (d2 & 0x7f) < chance;
  if (crit) s0 += trunc((s0 * ((d3 % 65) + 0x20)) / 64);
  if (s0 > 5 * s1) s0 = 5 * s1;
  if (s0 >= 10000) s0 = 9999;
  return { leaf: s0, crit, chance, base: s1 };
}
// The effective stat view the reference needs (no equipment, no modifiers: effective = the combatant's own numbers).
const view = (c) => ({ level: c.level, str: c.str, def: c.def, spt: c.spt, wis: c.wis, spd: c.spd, affinity: c.affinity, profile: { res: c.profile.resistances } });
const refSt = (S, st) => ({ atk: view(st.atk), def: view(st.def), fam: st.fam });

// What a whole attack action does, in the order the disc consumes the random stream:
//   1. accuracy (first roll, category 2 -> physical leaf, 3 -> magical leaf), 2. the damage leaf: crit proc then, if it procs, the magnitude,
//   3. drain proc (opcode 8 only, only if the first roll hit), 4. hits-1 more physical accuracy rolls.   doc: battle-formula-leaves.md:70-165
function refAction(r, S, st, draws, hits = 1) {
  const q = refSt(S, st);
  let i = 0; const nx = () => (i < draws.length ? draws[i++] : 0);
  const chance = refChance(r.category, S.side, r.elemCtx, q.atk, q.def);
  const hit1 = (nx() & 0x7f) < chance;
  // look at the crit draw without consuming the magnitude unless it procs
  const d2 = nx();
  const critCh = r.category === 2 ? refCritPhys(r, r.elem2 >= 2 && r.elem2 === st.fam)
    : refCritMag(r, r.elem1 >= 2 ? defElem(q.def.profile, r.elem1) : q.def.spd, r.elem2 >= 2 && r.elem2 === st.fam);
  const procs = (d2 & 0x7f) < critCh;
  const d3 = procs ? nx() : 0;
  const L = refLeaf(r, S, q, d2, d3);
  let heal = 0;
  if (hit1 && r.dispatch === 8) { const p = (nx() & 0x7f) < r.f8; if (p) heal = (L.leaf * r.crit) >> 7; }
  let landed = hit1 ? 1 : 0;
  for (let k = 1; k < hits; k++) {
    const c2 = refChance(2, S.side, r.elemCtx, q.atk, q.def);
    if ((nx() & 0x7f) < c2) landed++;
  }
  return { hit: landed > 0, landed, leaf: L.leaf, total: L.leaf * landed, heal, chance, critChance: L.chance, crit: L.crit };
}

// ---------------------------------------------------------------------------------------------
// CHECK 3-6: accuracy, damage, crit chance, drain, multi-hit through the real resolveAttack / resolveMultiHit.
// ---------------------------------------------------------------------------------------------
const isAttack = (id) => { const r = disc(id); return (r.category === 2 || r.category === 3); };
// techs the player/enemy resolver does not run through resolveAttack: 406 (two-slot repeat, F0x8009ddd8), counters (op 10: player use does nothing),
// 441/442 (the two slots of 406), 443 (unused template).
const SKIP_RESOLVER = new Set([406, 441, 442, 443]);
function attackSkill(id) {
  const s = gameSkill(id);
  if (!s) return null;
  // the player's Fight / enemy basic attack path forces a physical plain attack (web/battle.js: `{ ...basicSkill, attack_category: "physical" }`, `basic_attack: true`);
  // a basic record that is itself magical (438, 440) keeps its own category.
  return s.tech_basic && disc(id).category === 2 ? { ...s, attack_category: "physical", basic_attack: true } : s;
}
let skippedFloor = 0;
for (const id of IDS) {
  if (!isAttack(id) || SKIP_RESOLVER.has(id)) continue;
  const r = disc(id), skill = attackSkill(id);
  if (!skill) {
    if (!DNA_IDS.has(id) && ![129, 130].includes(id)) notes.push(`attack ${id} has no skill row: accuracy/damage not run through the game`);
    continue;
  }
  const isCounter = r.dispatch === 10;
  for (const S of SETS) {
    const st = setup(S, r);
    const q = refSt(S, st);
    const hitCh = refChance(r.category, S.side, r.elemCtx, q.atk, q.def);
    // ---- accuracy: boundary draws (0, c-1, c, c+1, 127); ours must hit exactly when the draw is below the chance
    const probe = new Set([0, 127, hitCh - 1, hitCh, hitCh + 1].filter((x) => x >= 0 && x <= 127));
    for (const d1 of probe) {
      const A = setup(S, r);
      const ours = E.resolveAttack(A.atk, A.def, skill, seq([d1, 127, 0, 0, 0]), null);
      eq("accuracy", id, `set ${S.n} draw ${d1} (chance ${hitCh}/128)`, (d1 & 0x7f) < hitCh, ours.hit);
    }
    if (isCounter) continue;      // a player's counter does nothing; damage not dealt by the technique itself
    // ---- damage and crit: full action with scripted draws; boundary draws for the crit roll, three magnitude draws
    const lf = refLeaf(r, S, q, 127, 0);
    if (lf.leaf < 1) { skippedFloor++; continue; }       // our engine floors a hit at 1; the disc floor is not documented
    const cc = lf.chance;
    const d2s = new Set([0, 127, cc - 1, cc, cc + 1].filter((x) => x >= 0 && x <= 127));
    for (const d2 of d2s) for (const d3 of [0, 64, 4095]) {
      if (r.dispatch === 8 || r.dispatch === 9) continue;    // drain / multi-hit have their own checks below
      const draws = [0, d2, d3, 0, 0];
      const exp = refAction(r, S, st, draws);
      if (!exp.hit) continue;
      const A = setup(S, r);
      const ours = E.resolveAttack(A.atk, A.def, skill, seq(draws), null);
      const tag = `set ${S.n} crit draw ${d2} mag draw ${d3}${exp.crit ? " (crit)" : ""}`;
      eq("damage", id, `${tag}`, exp.total, ours.dmg);
    }
    // ---- crit chance on its own: ours crits exactly when the crit draw is below the reference chance (seen as the damage change)
    if (r.dispatch !== 8 && r.dispatch !== 9) {
      const critTotal = refAction(r, S, st, [0, 0, 0, 0, 0]), plainTotal = refAction(r, S, st, [0, 127, 0, 0, 0]);
      if (critTotal.hit && critTotal.total !== plainTotal.total && !(refLeaf(r, S, q, 127, 0).crit)) {
        for (const d2 of d2s) {
          const draws = [0, d2, 0, 0, 0];
          const exp = refAction(r, S, st, draws);
          const A = setup(S, r);
          const ours = E.resolveAttack(A.atk, A.def, skill, seq(draws), null);
          eq("critchance", id, `set ${S.n} crit draw ${d2} (reference chance ${cc}/128): crit or not`, exp.crit, ours.dmg === critTotal.total);
        }
      }
    }
    // ---- drain (opcode 8): proc (draw & 0x7f) < f8, heal = floor(damage*f9/128). doc: battle-formula-leaves.md:865-882
    if (r.dispatch === 8) {
      for (const pd of [0, r.f8 - 1, r.f8, 127]) {
        if (pd < 0 || pd > 127) continue;
        // draws: acc, crit proc (no crit unless chance>=128), [mag if crit], drain proc
        const q2 = refSt(S, st);
        const critNeeded = refLeaf(r, S, q2, 127, 0).crit;
        const draws = critNeeded ? [0, 127, 0, pd, 0] : [0, 127, pd, 0, 0];
        const exp = refAction(r, S, st, draws);
        if (!exp.hit) continue;
        const A = setup(S, r);
        const ours = E.resolveAttack(A.atk, A.def, skill, seq(draws), null);
        eq("drain", id, `set ${S.n} proc draw ${pd} (f8 ${r.f8}, ratio ${r.crit}/128) heal`, exp.heal, ours.heal);
        eq("drain", id, `set ${S.n} proc draw ${pd} damage`, exp.total, ours.dmg);
      }
    }
    // ---- multi-hit (opcode 9): hit count = f14 = skill.hits as the game uses it; one damage value, one accuracy roll per hit
    if (r.dispatch === 9) {
      const hits = skill.hits ?? 1;
      eq("multihit", id, `hit count the game uses (f14)`, r.f14, hits);
      const tail = [0, 127, 100, 3, 64, 90, 20, 127, 55, 12, 0, 77, 5, 126, 100];
      const draws = [0, 127, ...tail];
      const exp = refAction(r, S, st, draws, r.f14);
      const A = setup(S, r);
      const ours = E.resolveMultiHit(A.atk, A.def, skill, hits, seq(draws), null);
      eq("multihit", id, `set ${S.n} landed hits of ${r.f14}`, exp.landed, ours.landed);
      eq("multihit", id, `set ${S.n} total damage (one value x landed)`, exp.total, ours.dmg);
    } else {
      eq("multihit", id, "hits for a non-multi-hit record is 1", 1, skill.hits ?? 1);
    }
  }
}
if (skippedFloor) notes.push(`${skippedFloor} damage cases skipped: reference value < 1 (our engine floors a landed hit at 1, the disc floor is not in the docs)`);

// ---------------------------------------------------------------------------------------------
// CHECK 7: status landing (opcodes 2-5) and instant death (6) through the real tryInflict / tryInstantDeath.
//   attack = f8 + trunc(attackerWIS/8); defence = victim element + victim status resistance + trunc(victimWIS/2);
//   chance = clamp(attack - trunc(defence/8), 1, 127); landed iff (RAND & 0x7f) < chance.   doc: battle-formula-leaves.md:1151-1169
//   pairs: poison = Water + Poison res; frozen = Thunder + Paralyze res; confuse = Wind + Confuse res; sleep = Ice + Sleep res; instant death = Dark + KO res (same doc; census 532-552)
// ---------------------------------------------------------------------------------------------
const STATUS_PAIR = { 2: ["water", "poison"], 3: ["thunder", "paralyze"], 4: ["wind", "confuse"], 5: ["ice", "sleep"], 6: ["dark", "ko"] };
for (const id of IDS) {
  const r = disc(id);
  if (!(r.dispatch >= 2 && r.dispatch <= 6) || !isAttack(id)) continue;
  const skill = gameSkill(id);
  if (!skill) continue;
  const [el, sr] = STATUS_PAIR[r.dispatch];
  for (const v of [
    { aw: 60, dw: 40, e: 120, s: 0 }, { aw: 200, dw: 10, e: 50, s: 10 }, { aw: 0, dw: 300, e: 400, s: 80 }, { aw: 999, dw: 0, e: 1, s: 0 },
  ]) {
    const att = mkC({ wis: v.aw, name: "Atk" });
    const mkDef = () => mkC({ wis: v.dw, name: "Def", res: { fire: 120, water: 120, ice: 120, wind: 120, thunder: 120, machine: 120, dark: 120, [el]: v.e }, sr: { [sr]: v.s } });
    const chance = Math.max(1, Math.min(127, (r.f8 + trunc(v.aw / 8)) - trunc((v.e + v.s + trunc(v.dw / 2)) / 8)));
    for (const d of new Set([0, 127, chance - 1, chance, chance + 1].filter((x) => x >= 0 && x <= 127))) {
      const def = mkDef();
      let landed;
      if (r.dispatch === 6) landed = E.tryInstantDeath(skill, def, "Def", att, seq([d, 0, 0, 0])) !== "";
      else landed = E.tryInflict(skill, def, "Def", att, seq([d, 0, 0, 0])) !== null;
      eq("status", id, `attWIS ${v.aw} defWIS ${v.dw} elem ${v.e} res ${v.s} draw ${d} (chance ${chance}/128)`, (d & 0x7f) < chance, landed);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// CHECK 8: stat debuff on a landed hit (opcodes 26 / 27 on category 2/3 rows: 81, 351, 355, 388, 434).
//   The opposing active fighter takes the stat setter with magnitude -f9 (asm F0x8009d858 fightstg.s:27828-27870 `lbu a3,0xc(s0)` / `negu a3`;
//   26 = attack, 27 = defense); the setter's arithmetic: delta = trunc(eff*magnitude/128), lower bound -trunc(eff/2), upper bound eff. doc: battle-formula-leaves.md:579-593, 396-420
// ---------------------------------------------------------------------------------------------
const mkBattle = (po = {}, eo = {}) => {
  const player = mkC({ name: "Agu", ...po }), enemy = mkC({ name: "Foe", ...eo });
  return { player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0, encounterGateBytes: new Array(14).fill(0) };
};
const refStatDelta = (eff, mag) => { let d = trunc((eff * mag) / 128); const lo = -trunc(eff / 2); if (d < lo) d = lo; if (d > eff) d = eff; return d; };
for (const id of IDS) {
  const r = disc(id);
  if (!isAttack(id) || (r.dispatch !== 26 && r.dispatch !== 27)) continue;
  const key = r.dispatch === 26 ? "str" : "def";
  for (const eff of [90, 200, 33]) {
    const b = mkBattle({}, { [key]: eff });
    const before = b.enemy.statMods[key];
    const res = B.applyStatDebuffDispatch(b, 0, GAME_TABLE[String(id)], { player: "Agu", enemy: "Foe" });
    eq("debuffhit", id, `enemy ${key} ${eff}: modifier change`, refStatDelta(eff, -r.crit), (b.enemy.statMods[key] ?? 0) - before);
    eq("debuffhit", id, `other stat untouched`, 0, b.enemy.statMods[r.dispatch === 26 ? "def" : "str"] ?? 0);
    void res;
  }
}

// ---------------------------------------------------------------------------------------------
// CHECK 9: category 4 (heal / cure / revive), real battleRestorePlanFor (web/battle.js).
//   184-186: heal = min(9999, (power<<6) + trunc(WIS*power/8)), capped at the wound                      doc: battle-message-page-kinds-2026-10-04.md:1064-1076
//   187,188: same amount for every standing party member, capped at the largest missing HP                doc: same file :1064-1076
//   100: every fallen member gets full HP, ailments untouched; 375: whole party full HP and all ailments cleared  doc: same file :925-1000 (11.3)
//   190/192/194/196 cure poison/frozen/confuse/all on every present slot (fallen too); 191/193/195/197 the same for standing members.  doc: same file :925-1000
// ---------------------------------------------------------------------------------------------
const mkParty = () => {
  const a = mkC({ name: "A", hp: 10, maxHp: 300, wis: 40 }), b = mkC({ name: "B", hp: 100, maxHp: 500 }), c = mkC({ name: "C", hp: 0, maxHp: 400 });
  const bt = { player: a, enemy: mkC({ name: "Foe" }), playerRecords: [a, b, c], activePlayerIndex: 0, encounterGateBytes: new Array(14).fill(0) };
  return { bt, a, b, c };
};
const hpOf = (...xs) => xs.map((x) => x.hp);
const ailOf = (...xs) => xs.map((x) => Object.keys(x.ailments).sort().join("+"));
for (const id of IDS) {
  const r = disc(id);
  if (r.category !== 4) continue;
  const rec = GAME_TABLE[String(id)];
  const raw = (wis) => Math.min(9999, (r.power << 6) + trunc((wis * r.power) / 8));
  if (id >= 184 && id <= 186) {
    for (const [hp, max, wis] of [[1, 9999, 40], [290, 300, 200], [1, 300, 40], [5, 9999, 999]]) {
      const bt = mkBattle({ hp, maxHp: max, wis });
      B.battleRestorePlanFor(bt, 0, rec, id, { name: "Agu" });
      eq("heal", id, `hp ${hp}/${max} wis ${wis}: hp after (amount ${raw(wis)}, wound ${max - hp})`, Math.min(max, hp + Math.min(raw(wis), max - hp)), bt.player.hp);
    }
  } else if (id === 187 || id === 188) {
    for (const wis of [40, 400]) {
      const { bt, a, b, c } = mkParty(); a.wis = wis;
      B.battleRestorePlanFor(bt, 0, rec, id, { name: "Agu" });
      const amt = Math.min(raw(wis), Math.max(300 - 10, 500 - 100));
      eq("heal", id, `party wis ${wis}: hp after of A,B,C(fallen) (amount ${amt})`, [Math.min(300, 10 + amt), Math.min(500, 100 + amt), 0], hpOf(a, b, c));
    }
  } else if (id === 100) {
    const { bt, a, b, c } = mkParty(); c.ailments = { poison: { power: 3 } };
    B.battleRestorePlanFor(bt, 0, rec, id, {});
    eq("heal", id, "revive: hp of A,B,C", [10, 100, 400], hpOf(a, b, c));
    eq("heal", id, "revive: ailments untouched", ["", "", "poison"], ailOf(a, b, c));
  } else if (id === 375) {
    const { bt, a, b, c } = mkParty(); a.ailments = { poison: { power: 3 }, frozen: { power: 3 } }; b.ailments = { sleep: { power: 3 } }; c.ailments = { confuse: { power: 3 } };
    B.battleRestorePlanFor(bt, 0, rec, id, {});
    eq("heal", id, "375: hp of A,B,C (all full)", [300, 500, 400], hpOf(a, b, c));
    eq("heal", id, "375: all ailments cleared", ["", "", ""], ailOf(a, b, c));
  } else if (id >= 190 && id <= 197) {
    const even = id % 2 === 0;
    const slotKind = { 190: ["poison"], 191: ["poison"], 192: ["frozen"], 193: ["frozen"], 194: ["confuse"], 195: ["confuse"], 196: ["poison", "frozen", "confuse", "sleep"], 197: ["poison", "frozen", "confuse", "sleep"] }[id];
    const { bt, a, b, c } = mkParty();
    const all = { poison: { power: 3 }, frozen: { power: 3 }, confuse: { power: 3 }, sleep: { power: 3 } };
    for (const x of [a, b, c]) x.ailments = JSON.parse(JSON.stringify(all));
    B.battleRestorePlanFor(bt, 0, rec, id, { name: "Agu" });
    const left = (x) => Object.keys(all).filter((k) => !slotKind.includes(k)).sort().join("+");
    eq("heal", id, "standing members A,B lose exactly the cured ailment(s)", [left(), left()], ailOf(a, b));
    if (even) eq("heal", id, "even half cures the fallen slot too (F0x8009c330 does not test HP)", left(), ailOf(c)[0]);
    else if (id !== 197) eq("heal", id, "odd half never cures a fallen member", "confuse+frozen+poison+sleep", ailOf(c)[0]);
  } else if (id === 189) {
    const bt = mkBattle({ hp: 1, maxHp: 300 });
    B.battleRestorePlanFor(bt, 0, rec, id, { name: "Agu" });
    const codes = (bt.statusEvents ?? []).filter((e) => e.code).map((e) => e.code).sort((x, y) => x - y);
    eq("heal", id, "189 stages the end event (code 5) and the regen source (code 6)", [5, 6], codes);
  }
}
// regen tick, F0x800a01ac: floor(maxHP*R/128), R = RAND%9+8 for Auto Recover (payload != 0), cap 9999.  doc: battle-formula-leaves.md:1401-1419
for (const [mx, dr] of [[300, 0], [300, 5], [300, 8], [1000, 4000], [30000, 1234]]) {
  eq("regen", 189, `regenTick maxHP ${mx} draw ${dr}`, Math.min(9999, trunc((mx * ((dr % 9) + 8)) / 128)), E.regenTick(mx, () => dr, true));
}

// ---------------------------------------------------------------------------------------------
// CHECK 10: category 5, real battleScriptedPlanFor (web/battle.js).
//   198-208 stat arms: delta = trunc(eff*mag/128), mag = direction*f9, bounds [-trunc(eff/2), eff]; 198/200/202 acting fighter, 199/201/203 every living
//   ally, 204-208 the opposing fighter; stat 198,199,204 attack; 200,201,205,206 defense; 202,203,207,208 speed.   doc: battle-formula-leaves.md:357-384, 579-606
//   209/210: acting fighter's charge byte = f9                                   doc: battle-formula-leaves.md:230-237
//   211/212/391: lands iff (RAND & 0x7f) < f8                                    doc: battle-formula-leaves.md:560-578, 357-384
//   392: MP moved player -> enemy = min(player MP, trunc(player maxMP*f9/128)), enemy clamped at its max   asm fightstg.s:13936-14000 (0x80090654-0x800906fc)
//   400: heal = min(9999, (power<<6) + trunc(WIS*power/8)) on the casting side's own fighter, capped at its max HP, and its charge byte = 32   doc: battle-formula-leaves.md:384, 389-410
// ---------------------------------------------------------------------------------------------
const STAT_OF = { 198: ["str", +1, "self"], 199: ["str", +1, "party"], 200: ["def", +1, "self"], 201: ["def", +1, "party"], 202: ["spd", +1, "self"], 203: ["spd", +1, "party"],
  204: ["str", -1, "opp"], 205: ["def", -1, "opp"], 206: ["def", -1, "opp"], 207: ["spd", -1, "opp"], 208: ["spd", -1, "opp"] };
// draws by seeding the real stream: pre-draw N values, reseed, run; the reference consumes the pre-drawn list.
const predraw = (seed, n) => { E.randU16SetSeed(seed); const out = []; for (let i = 0; i < n; i++) out.push(E.RAND_U16()); E.randU16SetSeed(seed); return out; };
for (const id of IDS) {
  const r = disc(id);
  if (r.category !== 5) continue;
  const rec = GAME_TABLE[String(id)];
  if (STAT_OF[id]) {
    const [key, dir, scope] = STAT_OF[id];
    const mag = dir * r.crit;
    const bt = mkBattle({ [key]: 100 }, { [key]: 90 });
    const ally = mkC({ name: "Ally", [key]: 60 }), fallen = mkC({ name: "Down", [key]: 50, hp: 0 });
    bt.playerRecords[1] = ally; bt.playerRecords[2] = fallen;
    B.battleScriptedPlanFor(bt, 0, rec, id, { name: "Agu" });
    const mods = [bt.player.statMods[key], ally.statMods[key], fallen.statMods[key], bt.enemy.statMods[key]];
    const d = (eff) => refStatDelta(eff, mag);
    const exp = scope === "self" ? [d(100), 0, 0, 0] : scope === "party" ? [d(100), d(60), 0, 0] : [0, 0, 0, d(90)];
    eq("cat5", id, `${key} modifiers [actor, ally, fallen ally, enemy] (mag ${mag})`, exp, mods);
  } else if (id === 209 || id === 210) {
    const bt = mkBattle();
    B.battleScriptedPlanFor(bt, 0, rec, id, { name: "Agu" });
    eq("cat5", id, "charge byte (f9)", r.crit, bt.player.affinity);
  } else if (id === 211 || id === 212 || id === 391) {
    let okN = 0;
    for (const roll of [0, r.f8 - 1, r.f8, 127]) {
      const bt = mkBattle();
      const plan = B.battleScriptedPlanFor(bt, 1, rec, id, { name: "Foe", roll7: roll });   // 211/212/391 are enemy-only
      eq("cat5", id, `roll7 ${roll} vs f8 ${r.f8}: landed`, roll < r.f8, !!plan?.rollLanded);
    }
    for (let seed = 1; seed <= 40; seed++) {
      const d = predraw(seed, 1); const bt = mkBattle();
      const plan = B.battleScriptedPlanFor(bt, 1, rec, id, { name: "Foe" });
      if (((d[0] & 0x7f) < r.f8) === !!plan?.rollLanded) okN++;
    }
    eq("cat5", id, "real stream, 40 seeds: landed matches (draw & 0x7f) < f8", 40, okN);
  } else if (id === 392) {
    for (const [pm, pmx, em, emx] of [[300, 320, 10, 100], [5, 320, 99, 100], [0, 320, 10, 100], [999, 999, 0, 999], [60, 60, 0, 1]]) {
      const bt = mkBattle({ mp: pm, maxMp: pmx }, { mp: em, maxMp: emx });
      B.battleScriptedPlanFor(bt, 1, rec, id, { name: "Foe" });       // 392 is an enemy-only technique (Persiamon)
      const mv = Math.min(pm, trunc((pmx * r.crit) / 128));
      eq("cat5", id, `player MP ${pm}/${pmx} enemy MP ${em}/${emx}: [player, enemy] MP`, pm > 0 ? [pm - mv, Math.min(emx, em + mv)] : [pm, em], [bt.player.mp, bt.enemy.mp]);
    }
  } else if (id === 400) {
    for (const [hp, mx, wis] of [[1, 9999, 40], [290, 300, 200], [5, 9999, 999]]) {
      const bt = mkBattle({}, { hp, maxHp: mx, wis: 10 }); bt.player.wis = wis;
      B.battleScriptedPlanFor(bt, 1, rec, id, { name: "Foe" });
      // enemy casts: the heal uses the acting (enemy) side's WIS
      const w = bt.enemy.wis;
      const raw = Math.min(9999, (r.power << 6) + trunc((w * r.power) / 8));
      eq("cat5", id, `enemy caster hp ${hp}/${mx} wis ${w}: hp after`, Math.min(mx, hp + raw), bt.enemy.hp);
      eq("cat5", id, "charge byte set to 32", 32, bt.enemy.affinity);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// CHECK 11: category 6 field techniques 213-219, real castFieldTechnique.
//   field element word = the record's category byte (6), power = min(127, f9 + trunc(SPT/10)), timer event = 1000 + 12*SPT   asm fightstg.s:14029-14074 (0x800907cc-0x8009087c)
// ---------------------------------------------------------------------------------------------
for (const id of IDS) {
  const r = disc(id);
  if (r.category !== 6) continue;
  for (const side of [0, 1]) for (const spt of [1, 100, 375, 1500]) {
    const bt = mkBattle({ spt: side === 0 ? spt : 100 }, { spt: side === 1 ? spt : 100 });
    B.castFieldTechnique(bt, side, GAME_TABLE[String(id)], ELEM[r.elem1]);
    const ev = (bt.statusEvents ?? []).find((e) => e.code === 7);
    const s = Math.max(0, spt);
    eq("field", id, `side ${side} SPT ${spt}: [element id, power, timer]`, [r.category, Math.min(127, r.crit + trunc(s / 10)), 1000 + 12 * s],
      [E.elementId(bt.field?.element), bt.field?.power, ev?.time]);
  }
}
// field adjustment: matching field adds trunc(base*power/128); the countering field subtracts trunc(base*power/256); table [0,0,4,2,5,3,7,8,6]. doc: battle-formula-leaves.md:177-181
{
  const COUNTER = [0, 0, 4, 2, 5, 3, 7, 8, 6];
  for (let atk = 2; atk <= 8; atk++) for (let fld = 2; fld <= 8; fld++) {
    const base = 1000, power = 74;
    const exp = atk === fld ? trunc((base * power) / 128) : COUNTER[atk] === fld ? -trunc((base * power) / 256) : 0;
    eq("field", 0, `adjustment attack element ${atk} vs field ${fld}`, exp, E.elementalFieldAdjustment(base, ELEM[atk], { element: ELEM[fld], power }));
  }
}


// =============================================================================================
// EXTENSION A: steal, status/buff/lock timers, poison/frozen/confusion rolls, regen/Auto Recover,
// cure events. Every reference below is written from the disc assembly (fightstg.s) / walker doc line
// cited next to it; nothing here imports a formula of ours.
// =============================================================================================
const dr = (d) => () => d / 0x10000;                  // the pool helpers take a 0..1 source: draw d (0..65535) in, d out
const mkPool = () => E.emptyStatusEventPool();
const live = (pool) => pool.filter((e) => e.code);
const PSEUDO = 0;                                      // id column for checks that are not one technique (delay arms, rolls)

// ---------------------------------------------------------------------------------------------
// CHECK steal (opcode 12: 127 Picking Claw, 128 Snapping Claw) - FIGHTSTG_F0x800a1114 (fightstg.s:31576-31694, 0x800a11c8-0x800a12e4)
//   ratio = trunc(100*eff[+0xa]/eff[+0x4a]) capped 200 (0x800a11d0-0x800a1218); weight = trunc(100*(rec[+0xb] + eff[+0x3e])/64) (0x800a1220-0x800a1278, the sra 6 sits in the jalr delay slot);
//   threshold = trunc(enemyRecord[+0x04] * ratio * weight / 10000) (0x800a127c-0x800a12b8, magic 0x68db8bad);  steals iff (RAND & 0x3ff) < threshold (0x800a12c4-0x800a12e4, signed remainder of /1024)
//   Only the player side (a0 & 0xff == 0) reaches the roll: for the enemy side (0x800a11bc `bnez -> return 0`) the function returns 0.   doc: battle-steal-roll-wired-2026-10-06.md:55-72
// ---------------------------------------------------------------------------------------------
const refStealThr = (f04, num, den, w, bonus) => {
  let ratio = trunc((100 * num) / den); if (ratio >= 0xc9) ratio = 0xc8;
  const weight = trunc((100 * (w + bonus)) / 64);
  return trunc((f04 * ratio * weight) / 10000);
};
for (const id of IDS) {
  const r = disc(id);
  if (r.dispatch !== 12 || !isAttack(id)) continue;
  for (const f04 of [0, 2, 16, 32, 64, 128, 192, 256]) for (const [num, den] of [[100, 100], [100, 50], [50, 100], [30, 200], [999, 1], [1, 999], [101, 100]]) for (const bonus of [0, 32, 64]) {
    const thr = refStealThr(f04, num, den, r.f8, bonus);
    for (const d of new Set([0, 1, thr - 1, thr, thr + 1, 1023, 1024 + thr - 1, 1024 + thr, 0xffff].filter((x) => x >= 0 && x <= 0xffff)))
      eq("steal", id, `enemy +0x04 ${f04} SPD ${num}/${den} bonus ${bonus} draw ${d} (threshold ${thr}/1024)`, (d & 0x3ff) < thr, E.stealProc(f04, num, den, r.f8, bonus, d));
  }
}
{ // the enemy stat table's steal factor: 100 of 193 records are 0 (doc: enemy-steal-factor-zero-2026-10-06.md:62-90 histogram, raw disc bytes read twice there)
  const t = readJson(path.join(ROOT, "web/assets/data/battlecmd/enemy_stats.json")).records;
  const hist = {}; for (const rec of t) hist[rec.field04] = (hist[rec.field04] ?? 0) + 1;
  eq("steal", PSEUDO, "shipped enemy stat table: histogram of record +0x04 (doc: 100 zero, 1 x 2, 19 x 16, 17 x 32, 15 x 64, 34 x 128, 2 x 192, 5 x 256)", { 0: 100, 2: 1, 16: 19, 32: 17, 64: 15, 128: 34, 192: 2, 256: 5 }, hist);
}

// ---------------------------------------------------------------------------------------------
// CHECK delay: FIGHTSTG_F0x8009bda4 (fightstg.s:26010-26310), the one routine that gives every timed event its length.
//   param table 0x800a4384, u16 [base,min,max] per opcode, read from the .word data fightstg.s:34861-34880 (e.g. word 0x02c303e8 = 1000,707).
//   default arm 0x8009c1bc (ops 0,1,3..7): delay = trunc(base * other.SPD(+0xa of the SECOND getter block) / isqrt(own.SPD*other.SPD)), isqrt = 10 Babylonian steps from 999 (0x8009c224-0x8009c264); then min/max tail 0x8009c2a4.
//   op 2 (0x8009bdf4): RAND % base + 10*own.SPT(+6);  op 8 (0x8009be7c): RAND % 8001 (magic 0x830e3cfd, 63*127 = 8001, 0x8009be90-0x8009bec0);
//   ops 9/10/11 (0x8009bec8/0x8009bf90/0x8009c058): RAND % 500 + 8*(own.SPT + G) + K - 8*(other[a] + other[b]), K 3000/3000/1000, G = 0x800a435d = the ailment magnitude;  op 12 (0x8009c130): RAND % 2001 + 10*own.SPT + 2000.
//   doc: battle-formula-leaves.md:940-1100, 1243-1290
// ---------------------------------------------------------------------------------------------
const OPT = [[1000, 707, 1414], [250, 176, 353], [2001, 1001, 0], [2000, 0, 0], [2500, 0, 0], [3000, 0, 0], [3500, 0, 0], [4000, 0, 0], [0, 2000, 6000], [500, 1000, 0], [500, 1000, 0], [500, 500, 0], [2001, 0, 0]];
const refIsqrt = (v) => { let x = 999; for (let i = 0; i < 10; i++) { const s = x + trunc(v / x); x = trunc(s / 2); } return x; };
const refTail = (op, d) => { const [, mn, mx] = OPT[op]; if (mn !== 0 && d < mn) d = mn; if (mx !== 0 && d > mx) d = mx; return d; };
const refDelay = (op, own, opp) => refTail(op, trunc((OPT[op][0] * opp) / refIsqrt(own * opp)));
const SPDS = [[100, 100], [100, 25], [25, 100], [999, 1], [1, 999], [300, 299], [50, 200], [80, 70]];
for (const op of [0, 1, 3, 4, 5, 6, 7]) for (const [own, opp] of SPDS) {
  eq("delay", PSEUDO, `opcode ${op} SPD own ${own} other ${opp}`, refDelay(op, own, opp), E.statusEventDelay(op, { own, opp }));
  if (op === 0) {
    eq("delay", PSEUDO, `opcode 0 (action) SPD own ${own} other ${opp}: statusEventActionDelay`, refDelay(0, own, opp), E.statusEventActionDelay(own, opp));
    eq("delay", PSEUDO, `opcode 0 (action) SPD own ${own} other ${opp}: actionTimelineDelay`, refDelay(0, own, opp), E.actionTimelineDelay(own, opp));
  }
}
const DRAWS = [0, 1, 499, 500, 1999, 2000, 2001, 2002, 2709, 2710, 4001, 6000, 8000, 8001, 30000, 65535];
for (const d of DRAWS) {
  for (const spt of [0, 1, 100, 375]) {
    eq("delay", PSEUDO, `opcode 2 (Auto Recover tick) draw ${d} SPT ${spt}`, refTail(2, (d % 2001) + 10 * spt), E.statusEventTickDelay(spt, dr(d)));
    eq("delay", PSEUDO, `opcode 12 (stat change) draw ${d} SPT ${spt}`, 2000 + (d % 2001) + 10 * spt, E.statusEventStatDelay(spt, dr(d)));
  }
  eq("delay", PSEUDO, `opcode 8 (confusion mode 0) draw ${d}`, refTail(8, d % 8001), E.statusEventConfusionDelay(dr(d)));
  for (const [spt, mag, a, b] of [[100, 40, 120, 0], [30, 96, 400, 80], [375, 5, 10, 10], [0, 0, 999, 999]]) for (const [op, K] of [[9, 3000], [10, 3000], [11, 1000]])
    eq("delay", PSEUDO, `opcode ${op} draw ${d} SPT ${spt} magnitude ${mag} other ${a}+${b}`, refTail(op, (d % 500) + 8 * (spt + mag - a - b) + K),
      E.statusEventRecoveryDelay(op, { draw: d, ownSpt: spt, magnitude: mag, otherA: a, otherB: b }));
}

// ---------------------------------------------------------------------------------------------
// CHECK timers: the durations our game really stages. Every ailment / buff / lock / Auto Recover entry goes into the one pool 0x800a3868 through our stage helpers, called the way web/battle.js and engine/dw3/battle-combat.ts call them.
//   ailments: poison F0x8009c7d4 (code 9, time 1000 fixed, payload = magnitude, a re-hit only refreshes the payload, fightstg.s:26696-26760); frozen F0x8009c8b0 (code 0x0a, op 9); confusion F0x8009c9c0 (code 0x0b, op 8 when its second
//   argument is 0 = the two direct callers, else op 10, :26849); sleep F0x8009cb10 (code 0x0c, op 11).  Which SIDE's SPT: the side handed to the stager (the victim, first getter block); the opposite side's element + status resistance are subtracted.
//   stats: F0x8009cc20 (code .L0x800a43e0[stat] = 0x0d/0x0e/0x0f, time = op 12 on the target's side, an existing entry gets its time replaced, fightstg.s:26983-27046)
//   locks: F0x8009cd1c (:27049-27144): code 0x10 for dispatch 13 / 0x11 for dispatch 14, found on the PLAYER side (a1 = 0) at slot [0x800a4468], time = (RAND % 101 + 100) * record[+0xc] (record = the lock technique, 211/212), refresh replaces the time
//   Auto Recover (189): F0x8009c5e8 code 5 time = op 2 (refresh replaces the time) + F0x8009c6a4 code 6 time 1000 payload 0xbd (a refresh keeps the time, only the payload), :26560-26720
// ---------------------------------------------------------------------------------------------
const STAT_CODE = [0x0d, 0x0e, 0x0f];
const entriesOf = (pool, code) => live(pool).filter((e) => e.code === code);
for (const [stat, name] of [[0, "attack"], [1, "defense"], [2, "speed"]]) for (const d of [0, 2000, 2001, 4500, 65535]) for (const spt of [1, 100, 375]) {
  const pool = mkPool();
  E.stageStatusEventStat(pool, 0x10, 1, stat, spt, dr(d));
  const e = entriesOf(pool, STAT_CODE[stat])[0];
  eq("timers", PSEUDO, `${name} change: stager entry [code, time, side, slot] draw ${d} SPT ${spt}`, [STAT_CODE[stat], 2000 + (d % 2001) + 10 * spt, 0x10, 1], e ? [e.code, e.time, e.side, e.slot] : null);
  E.stageStatusEventStat(pool, 0x10, 1, stat, spt, dr((d + 777) & 0xffff));
  eq("timers", PSEUDO, `${name} change: a second change on the same slot REPLACES the time (one entry)`, [1, 2000 + (((d + 777) & 0xffff) % 2001) + 10 * spt], [entriesOf(pool, STAT_CODE[stat]).length, entriesOf(pool, STAT_CODE[stat])[0]?.time]);
}
for (const lockDispatch of [13, 14]) for (const d of [0, 100, 101, 5000, 65535]) for (const mag of [24, 32]) {
  const pool = mkPool();
  E.stageStatusEventLock(pool, lockDispatch === 14 ? 1 : 0, 2, mag, dr(d));
  const e = entriesOf(pool, lockDispatch === 14 ? 0x11 : 0x10)[0];
  eq("timers", PSEUDO, `lock (dispatch ${lockDispatch}): entry [code, time, side, slot] draw ${d} record +0xc ${mag}`, [lockDispatch === 14 ? 0x11 : 0x10, ((d % 101) + 100) * mag, 0, 2], e ? [e.code, e.time, e.side, e.slot] : null);
}
// the real ailment path: applyAilment on a victim, with a scripted draw (the function takes the walker's raw 16-bit draw)
for (const [ail, code] of [["frozen", 0x0a], ["confuse", 0x0b], ["sleep", 0x0c], ["poison", 0x09]]) for (const mode of ail === "confuse" ? [1, 0] : [1]) for (const d of [0, 250, 499, 500, 2709, 2710, 4001, 8001, 65535]) for (const [mag, vSpt, oEl, oSr] of [[24, 100, 120, 0], [96, 30, 50, 40], [5, 375, 300, 80]]) {
  const victim = mkC({ name: "Victim", extra: { statusEvents: mkPool(), sideByte: 0x10, slot: 0, spt: vSpt } }); victim.spt = vSpt;
  const other = mkC({ name: "Other", res: { fire: 120, water: 120, ice: oEl, wind: oEl, thunder: oEl, machine: 120, dark: 120 }, sr: { paralyze: oSr, confuse: oSr, sleep: oSr } });
  victim.statusEvents = mkPool();
  E.applyAilment(victim, ail, { effect_p2: mag, ...(ail === "confuse" ? { confusion_recovery_mode: mode } : {}) }, other, seq([d]));
  const e = entriesOf(victim.statusEvents, code)[0];
  const k = oEl + oSr;
  let time;
  if (ail === "poison") time = 1000;
  else if (ail === "frozen") time = refTail(9, (d % 500) + 8 * (vSpt + mag - k) + 3000);
  else if (ail === "sleep") time = refTail(11, (d % 500) + 8 * (vSpt + mag - k) + 1000);
  else time = mode === 0 ? refTail(8, d % 8001) : refTail(10, (d % 500) + 8 * (vSpt + mag - k) + 3000);
  const label = ail === "confuse" ? `confusion mode ${mode} (${mode === 0 ? "direct: ChaosWave / the two direct callers, op 8" : "from a skill, op 10"})` : ail;
  eq("timers", PSEUDO, `${label}: entry [code, time, payload] draw ${d} magnitude ${mag} victimSPT ${vSpt} otherElem+res ${oEl}+${oSr}`, [code, time, ail === "poison" ? mag : mag], e ? [e.code, e.time, e.payload] : null);
}
// every technique that inflicts an ailment (opcodes 2-5), through tryInflict so the Aura doubling and the f9 magnitude are our real ones: the staged time must follow the disc formula
for (const id of IDS) {
  const r = disc(id);
  if (!(r.dispatch >= 2 && r.dispatch <= 5) || !isAttack(id)) continue;
  const skill = gameSkill(id); if (!skill) continue;
  const ail = { 2: "poison", 3: "frozen", 4: "confuse", 5: "sleep" }[r.dispatch], code = { 2: 9, 3: 0x0a, 4: 0x0b, 5: 0x0c }[r.dispatch];
  for (const d of [10, 3000]) {
    const att = mkC({ wis: 400, name: "Atk" }), def = mkC({ wis: 0, name: "Def", res: { fire: 120, water: 1, ice: 1, wind: 1, thunder: 1, machine: 120, dark: 120 } });
    def.statusEvents = mkPool(); def.sideByte = 0x10; def.slot = 0; def.spt = 90;
    const got = E.tryInflict(skill, def, "Def", att, seq([0, d, d, d]));   // draw 0 lands the roll (chance >= 1), the next draw feeds the delay
    const e = entriesOf(def.statusEvents, code)[0];
    const mag = r.crit, k = 1 + 0;       // other side (the attacker): element 120 (default), resistance 0 -> uses attacker fields: element value below
    const aEl = { poison: 0, frozen: 120, confuse: 120, sleep: 120 }[ail] ?? 0;   // attacker's own element for the pair is the default 120 (water for poison is not read: poison has no delay arm)
    const time = ail === "poison" ? 1000 : ail === "frozen" ? refTail(9, (d % 500) + 8 * (90 + mag - aEl - 0) + 3000) : ail === "sleep" ? refTail(11, (d % 500) + 8 * (90 + mag - aEl - 0) + 1000) : refTail(10, (d % 500) + 8 * (90 + mag - aEl - 0) + 3000);
    void k; void got;
    eq("timers", id, `${ail} landed by this technique: staged [code, time] draw ${d} (f9 magnitude ${mag}, attacker element 120, victim SPT 90)`, [code, time], e ? [e.code, e.time] : null);
  }
}
// Auto Recover (189): the two entries it stages
for (const d of [0, 1000, 2000, 2001, 65535]) for (const spt of [1, 100, 375]) {
  const pool = mkPool();
  E.stageStatusEventSideTick(pool, 0x10, spt, dr(d));
  E.stageStatusEventRegen(pool, 0x10, 0, 189);
  const t = entriesOf(pool, 5)[0], g = entriesOf(pool, 6)[0];
  eq("timers", 189, `Auto Recover: [end event time, regen time, regen payload] draw ${d} SPT ${spt}`, [refTail(2, (d % 2001) + 10 * spt), 1000, 189], [t?.time, g?.time, g?.payload]);
  E.stageStatusEventSideTick(pool, 0x10, spt, dr((d + 5) & 0xffff)); g.time = 333; E.stageStatusEventRegen(pool, 0x10, 0, 189);
  eq("timers", 189, `Auto Recover cast twice: end time replaced, regen time kept (draw ${d})`, [refTail(2, (((d + 5) & 0xffff) % 2001) + 10 * spt), 333, 1, 1], [entriesOf(pool, 5)[0]?.time, entriesOf(pool, 6)[0]?.time, entriesOf(pool, 5).length, entriesOf(pool, 6).length]);
}
// the poison tick: F0x8009fe1c (fightstg.s:30323-30398): trunc(maxHP * (trunc(payload/2) - trunc((poisonRes + water)/10)) / 100), at least 1, at most trunc(maxHP/2)
const refPoisonTick = (maxHp, payload, water, res) => { let v = trunc((trunc(payload / 2) - trunc((res + water) / 10)) * maxHp / 100); if (v <= 0) v = 1; const half = trunc(maxHp / 2); return half < v ? half : v; };
for (const maxHp of [1, 2, 99, 300, 1000, 9999]) for (const payload of [0, 1, 24, 64, 96, 200]) for (const [water, res] of [[0, 0], [120, 0], [50, 80], [450, 200], [1, 999]])
  eq("poisonhp", PSEUDO, `maxHP ${maxHp} payload ${payload} water ${water} poison res ${res}: HP lost per 1000 units`, refPoisonTick(maxHp, payload, water, res), E.poisonTimelineDamage(maxHp, payload, water, res));
// the Frozen block roll F0x800a19d8 (fightstg.s:32167-32204): chance = max(0x20, rec[+0x2d] - trunc((eff[+0x1c](paralyze res) + eff[+0x14](thunder))/8)); blocks iff (RAND & 0x7f) < chance
for (const [power, thunder, para] of [[40, 120, 0], [127, 10, 5], [20, 300, 80], [96, 0, 0], [0, 0, 0], [60, 400, 400]]) {
  const chance = Math.max(0x20, power - trunc((para + thunder) / 8));
  for (const d of new Set([0, 31, 32, chance - 1, chance, chance + 1, 127, 128 + chance - 1, 128 + chance].filter((x) => x >= 0)))
    eq("frozen", PSEUDO, `frozen power ${power} thunder ${thunder} paralyze res ${para} draw ${d} (block chance ${chance}/128)`, (d & 0x7f) < chance,
      E.frozenGateBlocksTurn(mkC({ res: { fire: 120, water: 120, ice: 120, wind: 120, thunder, machine: 120, dark: 120 }, sr: { paralyze: para }, extra: { ailments: { frozen: { power } } } }), seq([d])));
}
// the confusion gag roll F0x800a1910 (fightstg.s:32114-32156): gag iff (RAND & 0x7f) < rec[+0x1f] - trunc((eff[+0x1e](confuse res) + eff[+0x12](wind))/8)
for (const [mag, wind, conf] of [[40, 120, 0], [127, 10, 5], [20, 300, 80], [96, 0, 0], [0, 0, 0], [200, 8, 8]]) {
  const thr = mag - trunc((conf + wind) / 8);
  for (const d of new Set([0, thr - 1, thr, thr + 1, 127, 128 + thr].filter((x) => x >= 0)))
    eq("confuse", PSEUDO, `confusion magnitude ${mag} wind ${wind} confuse res ${conf} draw ${d} (gag threshold ${thr}/128)`, (d & 0x7f) < thr, E.confusionGagRoll(mag, wind, conf, seq([d])));
}
// cure events: F0x8009c330 (fightstg.s:26405-26468) frees the pending event(s) of the cured ailment on each PRESENT slot: kind 0 -> code 9, 1 -> 0x0a, 2 -> 0x0b, 3 (all) -> the six codes 9,10,11,12,16,17 (.L0x800a43d4 = 0x0c0b0a09 + 0x1110).
// 375 reads the same six (.L0x800a3438).  The stat codes 13..15 stay.   doc: battle-message-page-kinds-2026-10-04.md:1005-1030, 1041-1050
{
  const CURE = { 190: [9], 192: [0x0a], 194: [0x0b], 196: [9, 0x0a, 0x0b, 0x0c, 0x10, 0x11], 375: [9, 0x0a, 0x0b, 0x0c, 0x10, 0x11] };
  for (const id of IDS) {
    if (!CURE[id]) continue;
   for (const withBits of [true, false]) {
    const { bt, a, b, c } = mkParty();
    const pool = bt.statusEvents = mkPool();
    if (withBits) for (const x of [a, b, c]) x.ailments = { poison: { power: 3 }, frozen: { power: 3 }, confuse: { power: 3 }, sleep: { power: 3 } };
    for (const slot of [0, 1, 2]) for (const code of [9, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11]) E.enqueueStatusEvent(pool, { code, time: 500 + code, side: 0, slot, payload: 1, payload2: 0 });
    B.battleRestorePlanFor(bt, 0, GAME_TABLE[String(id)], id, { name: "Agu" });
    const left = new Set(); for (const e of live(pool)) left.add(`${e.side}:${e.slot}:${e.code}`);
    const want = new Set(); for (const slot of [0, 1, 2]) for (const code of [9, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11]) if (!CURE[id].includes(code)) want.add(`0:${slot}:${code}`);
    eq("cureevt", id, `pending events left after the cure (side:slot:code), slots 0,1,2 all present (even the fallen slot 2: the helper does not test HP); records ${withBits ? "carry the ailment bits" : "carry NO ailment bit"} (the helper frees the event whatever the record bits say, :26417-:26443)`, [...want].sort(), [...left].sort());
   }
  }
}


// =============================================================================================
// EXTENSION B: the terms the first checks left out - equipment bytes of the effective block (+0x26 affinity done above; +0x27 armor, +0x28..2a weapon families, +0x2b/+0x2c weapon element,
// +0x37 Multi Crest, +0x38 crit byte, +0x3a accuracy, +0x3b evasion, +0x1b Aura), the elemental field in the damage tail, the TARGET's frozen/sleep/confusion magnitudes in both crit rolls,
// the enemy power scale (set E above) at scales other than 20, and the final-battle accuracy short cut.
// Reference = the whole of F0x800a06ac / F0x800a08c8 (accuracy), F0x800a02ac / F0x800a0514 (crit), F0x8009f6dc / F0x8009fab4 (damage tails), F0x8009f644 (field), read line by line in fightstg.s:29850-30320, 30627-31110.
// ---------------------------------------------------------------------------------------------
const FIELD_COUNTER = [0, 0, 4, 2, 5, 3, 7, 8, 6];                  // words at 0x800a4670 (fightstg.s:35048-35056)
const ALLRES = { fire: 120, water: 120, ice: 120, wind: 120, thunder: 120, machine: 120, dark: 120 };
const XATK = { level: 12, str: 150, def: 100, spt: 120, wis: 60, spd: 90 };
const XDEF = { level: 9, str: 80, def: 110, spt: 90, wis: 40, spd: 70, res: { fire: 80, water: 120, ice: 150, wind: 320, thunder: 95, machine: 210, dark: 60 } };
// each scenario: which extra byte(s) of the effective blocks it fills (atk/def extras go on the combatant exactly as web/battle.js buildPlayerRecord fills them)
const XS = [
  { n: "crit byte +0x38 = 12", side: 0, atk: { ...XATK, extra: { crit: 12 } }, def: { ...XDEF, family: 77 } },
  { n: "crit byte +0x38 = 12 and Aura (+0x1b)", side: 0, atk: { ...XATK, extra: { crit: 12, aura: true } }, def: { ...XDEF, family: 77 } },
  { n: "worn weapon families [3,5,0] vs target family 5", side: 0, atk: { ...XATK, extra: { weaponFamilies: [3, 5, 0] } }, def: { ...XDEF, family: 5 } },
  { n: "accuracy accessory +0x3a = 9", side: 0, atk: { ...XATK, extra: { accBonus: 9 } }, def: { ...XDEF, family: 77 } },
  { n: "weapon element fire x30 (+0x2b/+0x2c)", side: 0, atk: { ...XATK, extra: { elemAttack: { element: "fire", amount: 30 } } }, def: { ...XDEF, family: 77 } },
  { n: "Multi Crest (+0x37)", side: 0, atk: { ...XATK, extra: { multiAttack: true } }, def: { ...XDEF, family: 77 } },
  { n: "target armor +0x27 = 6", side: 0, atk: { ...XATK }, def: { ...XDEF, family: 77, extra: { armor: 6 } } },
  { n: "target armor +0x27 = 200", side: 0, atk: { ...XATK }, def: { ...XDEF, family: 77, extra: { armor: 200 } } },
  { n: "target frozen 40 + asleep 33 + confused 20", side: 0, atk: { ...XATK }, def: { ...XDEF, family: "MATCH", extra: { ailments: { frozen: { power: 40 }, sleep: { power: 33 }, confuse: { power: 20 } } } } },
  { n: "target frozen 255", side: 0, atk: { ...XATK }, def: { ...XDEF, family: 78, extra: { ailments: { frozen: { power: 255 } } } } },
  { n: "field matching the technique's element (power 74)", side: 0, field: "match", atk: { ...XATK }, def: { ...XDEF, family: 77 } },
  { n: "field countering the technique's element (power 74)", side: 0, field: "counter", atk: { ...XATK, spt: 300 }, def: { ...XDEF, family: 77 } },
  { n: "enemy side, power scale 8 / evade +11", side: 0x10, scale: 8, atk: { ...XATK }, def: { ...XDEF, family: "MATCH", extra: { evadeBonus: 11 } } },
  { n: "enemy side, power scale 33 / evade +40", side: 0x10, scale: 33, atk: { ...XATK, level: 30, spd: 60 }, def: { ...XDEF, level: 8, spd: 50, family: 77, extra: { evadeBonus: 40 } } },
  { n: "final battle (kind 6), player side", side: 0, battleKind: 6, atk: { ...XATK }, def: { ...XDEF, family: 77 } },
];
function xBuild(S, r) {
  const fam = S.def.family === "MATCH" ? (r.elem2 >= 2 ? r.elem2 : 78) : S.def.family;
  const atk = mkC({ ...S.atk, name: "Atk", extra: { sideByte: S.side, ...(S.scale ? { powerScale: S.scale } : {}), ...(S.battleKind ? { battleKind: S.battleKind } : {}), ...(S.atk.extra ?? {}) } });
  const def = mkC({ ...S.def, family: fam, name: "Def", hp: 9999, maxHp: 9999, extra: S.def.extra ?? {} });
  let field = null;
  if (S.field && r.elem1 >= 2) field = { element: ELEM[S.field === "match" ? r.elem1 : FIELD_COUNTER[r.elem1]], power: 74 };
  else if (S.field) field = { element: "fire", power: 74 };      // normal-element technique: the field never applies
  return { atk, def, fam, field };
}
const xView = (c) => ({ level: c.level, str: c.str, def: c.def, spt: c.spt, wis: c.wis, spd: c.spd, affinity: c.affinity, crit: c.crit ?? 0, aura: !!c.aura, wf: c.weaponFamilies ?? [], accb: c.accBonus ?? 0,
  evade: c.evadeBonus ?? 0, armor: c.armor ?? 0, multi: !!c.multiAttack, eqe: c.elemAttack ?? null, family: c.profile.family, res: c.profile.resistances,
  statusTerm: (c.ailments?.frozen ? (c.ailments.frozen.power >> 3) : 0) + (c.ailments?.sleep ? (c.ailments.sleep.power >> 3) : 0) + (c.ailments?.confuse ? (c.ailments.confuse.power >> 1) : 0) });
// F0x8009f644 (fightstg.s:29706-29850 area, 0x8009f644-0x8009f6d8): field element f (word 0x800a4530) >= 2, power p (+2): attack element e == f -> trunc(base*p/128); table[e] == f -> -trunc(base*p/256); else 0
const refField = (base, e, field) => { if (!field) return 0; const f = ELEM.indexOf(field.element); if (f < 2) return 0; if (e === f) return trunc((base * field.power) / 128); if (FIELD_COUNTER[e] === f) return -trunc((base * field.power) / 256); return 0; };
// accuracy leaves: 0x800a06ac (physical) / 0x800a08c8 (magical); null = the final-battle short cut (player side, kind 6): hit iff (RAND & 0x7f) >= 0x2b (0x800a0774-0x800a0780: slti 0x2b then xori 1)
function xChance(r, S, A, D) {
  const lvl = A.level - D.level, acc = r.elemCtx;
  if (S.side === 0 && S.battleKind === 6) return null;
  if (r.category === 3) return acc + trunc((acc * (trunc((A.wis - D.wis) / 8) + lvl)) / 128);
  if (S.side === 0) { const term = trunc((A.spd + A.accb - D.spd) / 8) + lvl - (r.dispatch < 2 ? A.crit : 0); return acc + trunc((acc * term) / 128); }
  const term = trunc((A.spd - D.spd - D.evade) / 8) + lvl; const c = acc + trunc((acc * term) / 128); return c < 0x20 ? 0x20 : c;
}
const xHit = (r, S, A, D, d) => { const c = xChance(r, S, A, D); return c === null ? (d & 0x7f) >= 0x2b : (d & 0x7f) < c; };
// crit chance, physical F0x800a02ac (0x800a02ac-0x800a0510) and magical F0x800a0514 (0x800a0514-0x800a06a8)
function xCritChance(r, A, D) {
  const famMatch = r.elem2 >= 2 && r.elem2 === D.family;
  if (r.category === 2) {
    let s = 4;
    if (r.dispatch >= 2) { if (r.dispatch === 11) s += r.crit; } else if (A.crit !== 0) s = A.crit * (A.aura ? 2 : 1) + 4;
    if (r.elem2 >= 2) { if (famMatch) s += 0x3c; } else { for (const w of A.wf.slice(0, 3)) if (w >= 2 && w === D.family) { s += 0x10; break; } }
    return s + D.statusTerm;
  }
  const Dv = r.elem1 >= 2 ? D.res[ELEM[r.elem1]] : D.spd;       // address arithmetic +0xc + 2*(elem1-2) reads +0xa (SPD) for elem1 == 1 (0x800a0590-0x800a059c)
  let t = trunc((100 * r.scalar) / Dv); if (t > 0x40) t = 0x40;
  return (famMatch ? t + 0x40 : t + 4) + D.statusTerm;
}
// the damage tails. phys: F0x8009f97c + F0x8009f6dc;  mag: F0x8009fab4. returns the one damage value (before the "hit" gate) and whether the crit proc fired
function xLeaf(r, S, A, D, field, d2, d3) {
  const power = S.scale ? trunc((r.power * S.scale) / 16) : r.power;
  const famMatch = r.elem2 >= 2 && r.elem2 === D.family;
  let base, s0;
  if (r.category === 2) {
    base = trunc((A.str * power) / D.def);
    s0 = base + refField(base, r.elem1, field);
    let boost = famMatch;
    if (r.elem2 < 2) { boost = false; for (const w of A.wf.slice(0, 3)) if (w >= 2 && w === D.family) { boost = true; break; } }
    if (boost) s0 += trunc(s0 / 2);
    if (A.affinity) s0 += trunc((s0 * A.affinity) / 64);
    if (r.elem1 >= 2) s0 += trunc((2 * s0 * r.scalar) / D.res[ELEM[r.elem1]]);
    else if (r.clip !== 0x0b && r.clip !== 0x0c && A.eqe) s0 += trunc((2 * s0 * A.eqe.amount) / D.res[A.eqe.element]);   // 0x8009f804-0x8009f864: elem1 < 2, clip not 0xb/0xc, eff[+0x2b] set
    if (r.dispatch < 2 && A.multi && r.clip !== 0x0b && r.clip !== 0x0c) s0 = trunc((4 * s0) / 10);                          // 0x8009f868-0x8009f8c0 (0x66666667 on s0<<2, sra 2)
  } else {
    const mid = trunc((50 * A.spt) / D.spt) + 50;
    let s1 = trunc((power * mid) / 100); if (s1 > 2 * power) s1 = 2 * power; if (s1 < trunc(power / 2)) s1 = trunc(power / 2);
    base = s1; s0 = s1 + refField(s1, r.elem1, field);
    if (r.elem1 >= 2) { const v = D.res[ELEM[r.elem1]]; s0 = trunc((s0 * (v < 100 ? 400 - 3 * v : v < 300 ? 125 - trunc(v / 4) : 65 - trunc(v / 20))) / 100); }
    if (famMatch) s0 += trunc(s0 / 2);
  }
  const chance = xCritChance(r, A, D);
  const crit = (d2 & 0x7f) < chance;
  if (crit) s0 += trunc((s0 * (((r.category === 2 ? (d3 & 0x3f) : (d3 % 65))) + 0x20)) / 64);
  if (D.armor) { s0 -= D.armor; if (s0 <= 0) s0 = 0; }
  if (s0 > 5 * base) s0 = 5 * base;
  if (s0 >= 10000) s0 = 9999;
  return { leaf: s0, crit, chance };
}
const xSkipDispatch = new Set([8, 9, 10]);          // drain / multi-hit / counter rows have their own checks
for (const id of IDS) {
  if (!isAttack(id) || SKIP_RESOLVER.has(id) || xSkipDispatch.has(disc(id).dispatch)) continue;
  const r = disc(id), skill = attackSkill(id);
  if (!skill) continue;
  for (const S of XS) {
    const b0 = xBuild(S, r), A = xView(b0.atk), D = xView(b0.def);
    const field = b0.field;
    const c = xChance(r, S, A, D);
    // ---- accuracy (physical +0x3a, +0x38 on a plain attack, +0x3b evasion on the enemy side, the final-battle short cut)
    for (const d1 of new Set([0, 127, 0x2a, 0x2b, ...(c === null ? [] : [c - 1, c, c + 1])].filter((x) => x >= 0 && x <= 127))) {
      const X = xBuild(S, r);
      const ours = E.resolveAttack(X.atk, X.def, skill, seq([d1, 127, 0, 0, 0]), X.field);
      eq("accterms", id, `scenario "${S.n}" draw ${d1} (chance ${c === null ? "kind-6 short cut" : c + "/128"})`, xHit(r, S, A, D, d1), ours.hit);
    }
    // ---- damage tail with no crit (draw 127): armor, weapon element, Multi Crest 0.4, weapon-family 1.5, field, enemy power scale
    const noCrit = xLeaf(r, S, A, D, field, 127, 0);
    if (!noCrit.crit && noCrit.leaf >= 1 && xHit(r, S, A, D, 0)) {
      const X = xBuild(S, r);
      const ours = E.resolveAttack(X.atk, X.def, skill, seq([0, 127, 0, 0, 0]), X.field);
      eq("tailterms", id, `scenario "${S.n}": damage with no crit (leaf ${noCrit.leaf})`, noCrit.leaf, ours.dmg);
    }
    // ---- crit chance with every term: boundary draws around the reference chance, magnitude draw 20 (phys & 0x3f / mag % 65)
    if (!(r.category === 3 && r.elem1 === 1)) {       // magical elem1==1 rows are the known +0xa quirk above (the 77 mismatches); not repeated here
      const cc = xCritChance(r, A, D);
      for (const d2 of new Set([0, cc - 1, cc, cc + 1, 127].filter((x) => x >= 0 && x <= 127))) {
        const lf = xLeaf(r, S, A, D, field, d2, 20);
        if (lf.leaf < 1 || !xHit(r, S, A, D, 0)) continue;
        const X = xBuild(S, r);
        const ours = E.resolveAttack(X.atk, X.def, skill, seq([0, d2, 20, 0, 0]), X.field);
        eq("critterms", id, `scenario "${S.n}": crit draw ${d2} (chance ${cc}/128) damage`, lf.leaf, ours.dmg);
      }
    }
  }
}
// Multi Crest hit count: the resolver F0x8009e0cc (fightstg.s:28491-28500 + F0x8009d4b8 :27583-27608): dispatch < 2 and clip not 0xb/0xc and eff+0x37 -> 3 attempts;  dispatch 9 -> the record's +0x11 byte; anything else 1
for (const id of IDS) {
  if (!isAttack(id) || SKIP_RESOLVER.has(id)) continue;
  const r = disc(id), skill = gameSkill(id); if (!skill) continue;
  for (const multi of [false, true]) {
    // the Multi Crest diversion is in the PHYSICAL branch of the resolver only (0x8009e238-0x8009e26c); the magical branch sends dispatch < 2 to the exit (0x8009e37c-0x8009e394)
    const want = r.dispatch === 9 ? r.f14 : (r.dispatch < 2 && r.category === 2 && multi && r.clip !== 0x0b && r.clip !== 0x0c) ? 3 : 1;
    eq("accterms", id, `Multi Crest ${multi}: attempts per action`, want, E.basicAttackHitCount(multi, skill));
  }
}


// =============================================================================================
// EXTENSION C: counters, post-hit codes 13/29/32-35, Back Storm (406 / 441 / 442), side hard-coding of 100/375/392/400/211/212, enemy stat scale, rows no skill uses.
// =============================================================================================
// ---------------------------------------------------------------------------------------------
// CHECK counter - the counter BLOW F0x8009ff40 (fightstg.s:30399-30520), run by the reaction object F0x8008ee84 (:12517-12600): the countering fighter rolls the PHYSICAL accuracy leaf with the countering technique, then
//   base = trunc(damageTaken * rec[+0xc] / 64) (trunc(.../32) when the countering fighter's +0x1b charge byte is set); the player's OWN basic technique (rec == species +0x1c) passes damageTaken through unchanged and holds eff+0x37 off;
//   the base goes through the physical tail F0x8009f6dc (crit, element, field, armor, cap 5*base).   Counter Crest roll F0x800a15a8 (:31923-31948): (RAND & 0x7f) < 0x20 + trunc(64*damage/playerMaxHP).
//   (Counter stance of a dispatch-10 technique: the disc deals nothing - see the "NOT CHECKED" notes; the resolver diverts it at :28425-28461.)
// ---------------------------------------------------------------------------------------------
const refCounterBase = (taken, f9, charged, basic) => { if (basic) return taken; const p = taken * f9; return charged ? trunc(p / 32) : trunc(p / 64); };
function xLeafBase(r, S, A, D, field, base, d2, d3) {          // the physical tail with an explicit base (what F0x8009f6dc does with its a2)
  let s0 = base + refField(base, r.elem1, field);
  const famMatch = r.elem2 >= 2 && r.elem2 === D.family;
  let boost = famMatch;
  if (r.elem2 < 2) { boost = false; for (const w of A.wf.slice(0, 3)) if (w >= 2 && w === D.family) { boost = true; break; } }
  if (boost) s0 += trunc(s0 / 2);
  if (A.affinity) s0 += trunc((s0 * A.affinity) / 64);
  if (r.elem1 >= 2) s0 += trunc((2 * s0 * r.scalar) / D.res[ELEM[r.elem1]]);
  else if (r.clip !== 0x0b && r.clip !== 0x0c && A.eqe) s0 += trunc((2 * s0 * A.eqe.amount) / D.res[A.eqe.element]);
  if (r.dispatch < 2 && A.multi && r.clip !== 0x0b && r.clip !== 0x0c) s0 = trunc((4 * s0) / 10);
  const chance = xCritChance({ ...r, category: 2 }, A, D);
  const crit = (d2 & 0x7f) < chance;
  if (crit) s0 += trunc((s0 * ((d3 & 0x3f) + 0x20)) / 64);
  if (D.armor) { s0 -= D.armor; if (s0 <= 0) s0 = 0; }
  if (s0 > 5 * base) s0 = 5 * base;
  if (s0 >= 10000) s0 = 9999;
  return s0;
}
for (const id of IDS) {
  const r = disc(id);
  if (r.dispatch !== 10 || !isAttack(id)) continue;
  const skill = gameSkill(id); if (!skill) continue;
  for (const S of SETS) for (const charged of [false, true]) for (const taken of [1, 33, 120, 999, 4000]) {
    const st = setup(S, r); st.atk.aura = charged;
    const X = { ...S, scale: 0 };
    const q = refSt(S, st), A = xView(st.atk), D = xView(st.def);
    const base = refCounterBase(taken, r.crit, charged, false);
    const chance = refChance(2, S.side, r.elemCtx, q.atk, q.def);
    for (const d1 of new Set([0, chance - 1, chance, 127].filter((x) => x >= 0 && x <= 127))) for (const d2 of [0, 127]) {
      const st2 = setup(S, r); st2.atk.aura = charged;
      const ours = E.resolveCounterBlow(st2.atk, st2.def, skill, taken, r.crit, seq([d1, d2, 21]), null, false);
      const hit = (d1 & 0x7f) < chance;
      const exp = hit ? Math.max(0, xLeafBase(r, X, A, D, null, base, d2, 21)) : 0;
      eq("counter", id, `set ${S.n} charged ${charged} damage taken ${taken} f9 ${r.crit} draws acc ${d1} crit ${d2}: [hit, damage] (base ${base}, accuracy ${chance}/128)`, [hit, exp], [ours.hit, ours.dmg]);
    }
  }
}
{ // the player's own basic technique through the same function: base = the damage taken, unscaled, Multi Crest held off
  const r = disc(10), skill = { ...gameSkill(10), attack_category: "physical", basic_attack: true };
  for (const S of SETS.filter((x) => x.side === 0)) for (const taken of [7, 200]) for (const multi of [false, true]) {
    const st = setup(S, r); st.atk.multiAttack = multi;
    const q = refSt(S, st), A = xView(st.atk), D = xView(st.def);
    const chance = refChance(2, S.side, r.elemCtx, q.atk, q.def);
    const ours = E.resolveCounterBlow(st.atk, st.def, skill, taken, r.crit, seq([0, 127, 0]), null, true);
    const exp = chance > 0 ? xLeafBase(r, { ...S, scale: 0 }, { ...A, multi: false }, D, null, taken, 127, 0) : 0;
    eq("counter", 10, `player's own basic technique countering (Counter Crest swing), set ${S.n} damage taken ${taken} Multi Crest ${multi}: damage (base = damage taken, F0x8009ff40 s3 == 1)`, chance > 0 ? exp : 0, ours.dmg);
  }
}
for (const dmg of [1, 10, 150, 299, 300, 999]) for (const maxHp of [1, 50, 300, 999, 9999]) {
  const chance = 0x20 + trunc((dmg * 64) / maxHp);
  for (const d of new Set([0, chance - 1, chance, 127, 128 + chance - 1].filter((x) => x >= 0)))
    eq("counter", PSEUDO, `Counter Crest roll: damage ${dmg} player max HP ${maxHp} draw ${d} (chance ${chance}/128)`, (d & 0x7f) < chance, E.counterCrestProc(dmg, maxHp, seq([d])));
}

// ---------------------------------------------------------------------------------------------
// CHECK posthit - the post-hit dispatcher F0x8009df78 (fightstg.s:28311-28400): table 0x80083234 indexed dispatch-2 over 33 words (dispatch 2..34); every word that is 0x8009e0bc is a bare return.
//   13 (430) -> F0x8009dd64 (:28169-28198): roll [0x800a4648] = F0x800a1508 = (RAND & 0x7f) < rec[+0xb]; on a hit the consumer stages the flee lock with record 211 (li $a0, 0xd3 :15233) -> time (RAND % 101 + 100) * 24, code 0x10, player's active slot
//   29 (431) -> F0x8009da0c (:27943-27985) + consumer :15066-15110: player active MaxMP * rec[+0xc] / 128 (sra 7), capped at the player's current MP, 0 if the player has none; the amount's LOW BYTE is the slot byte (a multiple of 256 moves nothing);
//               enemy active fighter gains it, clamped at its max MP
//   32/33/34 (421..428) -> F0x8009daac / db94 / dc8c (:27986-28168): roll [0x800a4644] = F0x800a1458 (:31794-31830) = (RAND & 0x7f) < rec[+0xb] + trunc((eff.WIS(block 0x800a4580) - eff.WIS(block 0x800a45c0))/8);
//               F0x800a1458 builds side 0 into 0x800a45c0 (flag 0) and side 0x10 into 0x800a4580 (flag 1), so 0x800a4580 is the ENEMY: chance = f8 + trunc((enemyWIS - playerWIS)/8).
//               32: slot = RAND & 1 (draw first), then the roll, +rec[+0xc] on that one of the player's persistent halfwords; 33: one roll per slot 0..2; 34: one roll, all three.   Slots are STR, DEF, SPD.
//   35 (393) and every dispatch above 34 are outside the table: the dispatcher does nothing.   10: the table word is a bare return.
// ---------------------------------------------------------------------------------------------
{
  const rec = (id) => GAME_TABLE[String(id)];
  // 13
  for (const id of IDS) {
    const r = disc(id); if (r.dispatch !== 13 || !isAttack(id)) continue;
    for (const roll of new Set([0, r.f8 - 1, r.f8, 127, 128 + r.f8 - 1, 128 + r.f8])) {
      const bt = mkBattle(); bt.statusEvents = mkPool();
      const seed = 91 + roll; const dd = predraw(seed, 1);
      const res = B.applyPostHitDispatch(bt, rec(id), { rng: seq([roll]), lockRecord: rec(211), playerName: "Agu" });
      const lands = (roll & 0x7f) < r.f8;
      const lock = entriesOf(bt.statusEvents, 0x10)[0];
      eq("posthit", id, `flee lock roll draw ${roll} (f8 ${r.f8}): [landed, lock entry code/time/side, player flee bit]`, [lands, lands ? [0x10, ((dd[0] % 101) + 100) * disc(211).crit, 0] : null, lands],
        [!!res?.landed, lock ? [lock.code, lock.time, lock.side] : null, !!bt.player.cantFlee]);
    }
  }
  // 29
  for (const id of IDS) {
    const r = disc(id); if (r.dispatch !== 29 || !isAttack(id)) continue;
    for (const [pm, px, em, ex] of [[300, 320, 10, 100], [5, 320, 99, 100], [0, 320, 10, 100], [4096, 4096, 0, 9999], [4095, 4096, 0, 9999], [999, 999, 0, 999], [60, 60, 0, 1]]) {
      const bt = mkBattle({ mp: pm, maxMp: px }, { mp: em, maxMp: ex });
      B.applyPostHitDispatch(bt, rec(id), { enemyName: "Foe" });
      let mv = pm > 0 ? Math.min(pm, trunc((px * r.crit) / 128)) : 0; if ((mv & 0xff) === 0) mv = 0;
      eq("posthit", id, `MP absorb: player MP ${pm}/${px} enemy MP ${em}/${ex}: [player MP, enemy MP] (moved ${mv})`, [pm - mv, Math.min(ex, em + mv)], [bt.player.mp, bt.enemy.mp]);
    }
  }
  // 32 / 33 / 34
  for (const id of IDS) {
    const r = disc(id); if (![32, 33, 34].includes(r.dispatch) || !isAttack(id)) continue;
    for (const [pw, ew] of [[40, 40], [100, 20], [20, 100], [0, 255]]) {
      const chance = r.f8 + trunc((ew - pw) / 8);
      const lo = chance - 1, hi = chance;
      const scripts = r.dispatch === 32 ? [[0, lo], [1, lo], [0, hi], [1, hi]] : r.dispatch === 33 ? [[lo, hi, lo], [hi, lo, hi], [hi, hi, hi]] : [[lo], [hi]];
      for (const draws of scripts) {
        const bt = mkBattle({ wis: pw }, { wis: ew });
        const res = B.applyPostHitDispatch(bt, rec(id), { rng: seq(draws) });
        const exp = [0, 0, 0];
        if (r.dispatch === 32) { if ((draws[1] & 0x7f) < chance) exp[draws[0] & 1] += r.crit; }
        else if (r.dispatch === 33) draws.forEach((dv, i) => { if ((dv & 0x7f) < chance) exp[i] += r.crit; });
        else if ((draws[0] & 0x7f) < chance) for (let i = 0; i < 3; i++) exp[i] += r.crit;
        eq("penalty", id, `dispatch ${r.dispatch}, player WIS ${pw} enemy WIS ${ew}, draws ${draws.join(",")} (landing chance ${chance}/128): [STR, DEF, SPD] penalty`, exp, [res?.penalty?.str ?? 0, res?.penalty?.def ?? 0, res?.penalty?.spd ?? 0]);
      }
    }
  }
  // outside the table / bare returns: nothing runs
  for (const id of IDS) {
    const r = disc(id); if (!(r.dispatch === 35 || r.dispatch === 36 || r.dispatch === 10)) continue;
    const bt = mkBattle(); bt.statusEvents = mkPool();
    const res = B.applyPostHitDispatch(bt, rec(id), { rng: seq([0, 0, 0, 0]) });
    eq("posthit", id, `dispatch ${r.dispatch}: the post-hit dispatcher runs nothing (returns null, no event, no penalty)`, [null, 0, 0], [res ?? null, live(bt.statusEvents).length, (bt.player.statPenalty?.str ?? 0) + (bt.player.statPenalty?.def ?? 0)]);
  }
}

// ---------------------------------------------------------------------------------------------
// CHECK repeat - Back Storm 406: dispatch byte 0x1f -> F0x8009ddd8 (fightstg.s:28201-28263): for slot 0 and slot 1 ask the MAGICAL accuracy leaf (+0xa0) with the action's own technique (406); a landed slot stores the damage of the SLOT's record
//   (0x1b9 = 441 water, 0x1ba = 442 thunder) from the magical damage leaf (+0x88) and bumps the hit counter; the apply step sums the two. Counter 0x34 = landed slots, 0x36 = 2, flag 0x4435 = 1.
// ---------------------------------------------------------------------------------------------
for (const pattern of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
  const calls = []; const flags = [0, 0], caps = [0, 0]; let k = 0;
  const state = { count: 9, total: 0, done: 0 };
  E.multiHitReset([0, 1].map((i) => ({ setFlag: (v) => { flags[i] = v; }, setCaption: (v) => { caps[i] = v; } })), { side: () => 0x10, id: () => 406 },
    { predicate: (side, id) => { calls.push(["acc", side, id]); return pattern[k++]; }, produce: (side, tid) => { calls.push(["dmg", side, tid]); return tid * 3; } }, state);
  const expCalls = []; const expCaps = [0, 0], expFlags = [0, 0]; let n = 0;
  for (let i = 0; i < 2; i++) { expCalls.push(["acc", 0x10, 406]); if (pattern[i]) { expFlags[i] = 1; expCalls.push(["dmg", 0x10, i === 0 ? 0x1b9 : 0x1ba]); expCaps[i] = (i === 0 ? 0x1b9 : 0x1ba) * 3; n++; } }
  eq("repeat", 406, `hit pattern ${pattern.join("")}: [calls, slot flags, slot values, count, capacity, done flag]`, [expCalls, expFlags, expCaps, n, 2, 1], [calls, flags, caps, state.count, state.total, state.done]);
}
for (const id of [441, 442]) {                    // the slot records' damage: the magical leaf of each record, the accuracy being 406's own
  const r = disc(id);
  const skill = { id, power: r.power, element: ELEM[r.elem1], attack_category: "magical", magical: true, base_acc: r.elemCtx, target_family: r.elem2, damage_scalar: r.scalar, clip: r.clip, effect_id: r.dispatch };
  for (const S of SETS) {
    const st = setup(S, r), q = refSt(S, st);
    for (const [d2, d3] of [[127, 0], [0, 64], [0, 4095]]) {
      const lf = refLeaf(r, S, q, d2, d3); if (lf.leaf < 1 || refChance(3, S.side, r.elemCtx, q.atk, q.def) <= 0) continue;
      const A = setup(S, r);
      const ours = E.resolveAttack(A.atk, A.def, skill, seq([0, d2, d3]), null);
      eq("repeat", id, `slot damage set ${S.n} crit draw ${d2} magnitude draw ${d3}`, lf.leaf, ours.dmg);
    }
  }
}
for (const S of SETS) {                           // 406's own accuracy (the slot's roll): magical leaf with the 406 row
  const r = disc(406), skill = gameSkill(406); if (!skill) break;
  const st = setup(S, r), q = refSt(S, st), c = refChance(3, S.side, r.elemCtx, q.atk, q.def);
  for (const d of new Set([0, 127, c - 1, c, c + 1].filter((x) => x >= 0 && x <= 127))) {
    const A = setup(S, r);
    eq("repeat", 406, `accuracy of one slot, set ${S.n} draw ${d} (chance ${c}/128)`, (d & 0x7f) < c, E.rollMagicHit(E.effStats(A.atk), E.effStats(A.def), skill, seq([d])));
  }
}

// ---------------------------------------------------------------------------------------------
// CHECK side - who a technique really acts on (doc: battle-message-page-kinds-2026-10-04.md:1009-1014 for 100/375; asm F0x80090654 392, F0x80090734 400, F0x8009cd1c 211/212):
//   100 / 375: restore the PLAYER's party whichever side cast them;   184..197: the casting side;   189: stages the casting side's events;
//   392 (:0x80090654-0x800906fc): source is ALWAYS the player's active (0x4470 + [0x4468]*0x20), destination ALWAYS the enemy's (0x44d0 + [0x446c]*0x20), amount min(player MP, player MaxMP*crit/128);
//   400 (:0x80090734-0x80090798): the heal goes to the ENEMY's active fighter whoever casts, amount from F0x800a0108(acting side) = (power<<6) + trunc(WIS_of_acting_side*power/8), cap 9999, capped at the enemy's max, enemy +0xe (charge) = 0x20;
//   211/212 (F0x8009cd1c): locks land on the PLAYER's active slot whoever casts; the roll F0x800a1508 is (RAND & 0x7f) < rec[+0xb];  stat arms 198-208: self/party act on the casting side, 204-208 on the opposite side.
// ---------------------------------------------------------------------------------------------
for (const id of IDS) {
  const r = disc(id), rec = GAME_TABLE[String(id)];
  if (r.category === 4 && (id === 100 || id === 375)) {            // cast by the ENEMY (side 1): the player's party is restored, the enemy untouched
    const { bt, a, b, c } = mkParty(); bt.enemy.hp = 7; bt.enemy.ailments = { poison: { power: 3 } }; for (const x of [a, b, c]) x.ailments = { poison: { power: 3 }, sleep: { power: 3 } };
    B.battleRestorePlanFor(bt, 1, rec, id, { name: "Foe" });
    eq("side", id, "cast by the enemy: [player party HP, enemy HP, enemy ailments, player ailments left]", [id === 100 ? [10, 100, 400] : [300, 500, 400], 7, "poison", id === 100 ? ["poison+sleep", "poison+sleep", "poison+sleep"] : ["", "", ""]],
      [hpOf(a, b, c), bt.enemy.hp, Object.keys(bt.enemy.ailments).join("+"), ailOf(a, b, c)]);
  } else if (r.category === 4 && id >= 184 && id <= 188) {          // cast by the enemy: the enemy heals with ITS WIS
    for (const [hp, mx, wis] of [[1, 9999, 40], [290, 300, 200], [5, 700, 60]]) {
      const bt = mkBattle({ hp: 20, maxHp: 400 }, { hp, maxHp: mx, wis });
      B.battleRestorePlanFor(bt, 1, rec, id, { name: "Foe" });
      const raw = Math.min(9999, (r.power << 6) + trunc((wis * r.power) / 8));
      eq("side", id, `cast by the enemy, enemy hp ${hp}/${mx} wis ${wis}: [enemy hp, player hp] (amount ${raw})`, [Math.min(mx, hp + Math.min(raw, mx - hp)), 20], [bt.enemy.hp, bt.player.hp]);
    }
  } else if (r.category === 4 && id >= 190 && id <= 197) {          // cure cast by the enemy: its own ailments go, the player's stay
    const bt = mkBattle(); const all = { poison: { power: 3 }, frozen: { power: 3 }, confuse: { power: 3 }, sleep: { power: 3 } };
    bt.enemy.ailments = JSON.parse(JSON.stringify(all)); bt.player.ailments = JSON.parse(JSON.stringify(all));
    B.battleRestorePlanFor(bt, 1, rec, id, { name: "Foe" });
    const cured = { 190: ["poison"], 191: ["poison"], 192: ["frozen"], 193: ["frozen"], 194: ["confuse"], 195: ["confuse"], 196: ["poison", "frozen", "confuse", "sleep"], 197: ["poison", "frozen", "confuse", "sleep"] }[id];
    eq("side", id, "cast by the enemy: [enemy ailments left, player ailments left]", [Object.keys(all).filter((k) => !cured.includes(k)).sort().join("+"), "confuse+frozen+poison+sleep"], [Object.keys(bt.enemy.ailments).sort().join("+"), Object.keys(bt.player.ailments).sort().join("+")]);
  } else if (id === 189) {
    const bt = mkBattle({}, { hp: 5, maxHp: 300 }); bt.statusEvents = mkPool();
    B.battleRestorePlanFor(bt, 1, rec, id, { name: "Foe" });
    eq("side", id, "cast by the enemy: the end event (code 5) and the regen source (code 6) go on the ENEMY side (0x10)", [[5, 0x10], [6, 0x10]], [5, 6].map((c) => [c, entriesOf(bt.statusEvents, c)[0]?.side]));
  } else if (id === 392) {                                           // cast by the PLAYER
    for (const [pm, pmx, em, emx] of [[300, 320, 10, 100], [5, 320, 99, 100], [0, 320, 10, 100]]) {
      const bt = mkBattle({ mp: pm, maxMp: pmx }, { mp: em, maxMp: emx });
      B.battleScriptedPlanFor(bt, 0, rec, id, { name: "Agu" });
      const mv = Math.min(pm, trunc((pmx * r.crit) / 128));
      eq("side", id, `cast by the player: player MP ${pm}/${pmx} enemy MP ${em}/${emx}: [player, enemy] MP (source is still the player)`, pm > 0 ? [pm - mv, Math.min(emx, em + mv)] : [pm, em], [bt.player.mp, bt.enemy.mp]);
    }
  } else if (id === 400) {                                           // cast by the PLAYER: the ENEMY is healed with the PLAYER's WIS
    for (const [hp, mx, pw] of [[1, 9999, 40], [290, 300, 200], [5, 9999, 999]]) {
      const bt = mkBattle({ wis: pw }, { hp, maxHp: mx, wis: 10 });
      B.battleScriptedPlanFor(bt, 0, rec, id, { name: "Agu" });
      const raw = Math.min(9999, (r.power << 6) + trunc((pw * r.power) / 8));
      eq("side", id, `cast by the player (player WIS ${pw}): [enemy hp, enemy charge byte] (heal goes to the enemy, amount ${raw})`, [Math.min(mx, hp + raw), 32], [bt.enemy.hp, bt.enemy.affinity]);
    }
  } else if (id === 211 || id === 212) {                             // cast by the PLAYER: the lock still lands on the player's own active slot
    for (const roll of [0, r.f8 - 1, r.f8, 127]) {
      const bt = mkBattle(); bt.statusEvents = mkPool(); const dd = predraw(4000 + roll, 1);
      const plan = B.battleScriptedPlanFor(bt, 0, rec, id, { name: "Agu", roll7: roll });
      const lands = roll < r.f8; const code = id === 212 ? 0x11 : 0x10; const e = entriesOf(bt.statusEvents, code)[0];
      eq("side", id, `cast by the player, roll ${roll} (f8 ${r.f8}): [landed, lock entry, flag on the player]`, [lands, lands ? [code, ((dd[0] % 101) + 100) * r.crit, 0] : null, lands], [!!plan?.rollLanded, e ? [e.code, e.time, e.side] : null, !!(id === 212 ? bt.player.cantDigivolve : bt.player.cantFlee)]);
    }
  } else if (id === 209 || id === 210) {                              // charge cast by the ENEMY: the acting (enemy) fighter's charge byte = f9, the player's untouched
    const bt = mkBattle(); B.battleScriptedPlanFor(bt, 1, rec, id, { name: "Foe" });
    eq("side", id, "cast by the enemy: [enemy charge byte, player charge byte]", [r.crit, 0], [bt.enemy.affinity, bt.player.affinity]);
  } else if (id === 391) {
    for (const roll of [0, r.f8 - 1, r.f8, 127]) { const bt = mkBattle(); const plan = B.battleScriptedPlanFor(bt, 0, rec, id, { name: "Agu", roll7: roll });
      eq("side", id, `cast by the player, roll ${roll} (f8 ${r.f8}): landed`, roll < r.f8, !!plan?.rollLanded); }
  } else if (STAT_OF[id]) {                                          // stat arms cast by the ENEMY
    const [key, dir, scope] = STAT_OF[id]; const mag = dir * r.crit;
    const bt = mkBattle({ [key]: 100 }, { [key]: 90 });
    B.battleScriptedPlanFor(bt, 1, rec, id, { name: "Foe" });
    const d = (eff) => refStatDelta(eff, mag);
    const exp = scope === "opp" ? [d(100), 0] : [0, d(90)];        // self/party act on the enemy itself (one fighter on its side); 204-208 act on the player
    eq("side", id, `cast by the enemy: ${key} modifiers [player, enemy] (mag ${mag})`, exp, [bt.player.statMods[key], bt.enemy.statMods[key]]);
  }
}
// 211/212/430 flee-lock + digivolve-lock also through their stat-arm timers when cast by the enemy are in "timers"; the stat arms' own pool times follow:
for (const id of IDS) {
  const r = disc(id); const sd = STAT_OF[id]; if (!sd || r.category !== 5) continue;
  const [key, dir, scope] = sd;
  for (const side of [0, 1]) {
    const bt = mkBattle({ spt: 130, [key]: 100 }, { spt: 77, [key]: 90 }); bt.statusEvents = mkPool();
    const dd = predraw(7000 + id * 2 + side, 3);
    B.battleScriptedPlanFor(bt, side, GAME_TABLE[String(id)], id, { name: "X" });
    const targetSide = scope === "opp" ? 1 - side : side;               // which side's fighter changes
    const spt = targetSide === 0 ? 130 : 77;                            // the stager hands the TARGET's side to the delay routine (fightstg.s:13778 move_ $a0,$s1 -> :26204 own SPT)
    const stat = { str: 0, def: 1, spd: 2 }[key];
    const es = entriesOf(bt.statusEvents, STAT_CODE[stat]).sort((x, y) => x.slot - y.slot);
    const wantTimes = (scope === "party" ? es.map((_, i) => 2000 + (dd[i] % 2001) + 10 * spt) : [2000 + (dd[0] % 2001) + 10 * spt]);
    eq("timers", id, `cast by side ${side}: stat-change expiry events [side, time...] (target side ${targetSide ? "enemy" : "player"}, target SPT ${spt})`, [targetSide ? 0x10 : 0, ...wantTimes], [es[0]?.side, ...es.map((e) => e.time)]);
  }
}

// ---------------------------------------------------------------------------------------------
// CHECK enemyscale - the enemy branch of the effective-stat builder F0x8009ec94 (fightstg.s:29703-29770): each of the five core stats = trunc(record stat * scale / 16) (0x8009f4fc-0x8009f524: mult, +0xf when negative, sra 4),
//   the scale halfword is the encounter's descriptor +0x22 (0x80042b1c + slot*12 + 0x22); 16 is identity. The enemy's move power is scaled by the same halfword (F0x8009f97c :30071-30083, F0x8009fab4 :30167-30179; set E and the scenarios above).
// ---------------------------------------------------------------------------------------------
{
  const ES = await imp(path.join(P_WEB, "enemy-stats.js"));
  for (const raw of [1, 7, 33, 50, 99, 255, 999, 32767]) for (const scale of [1, 8, 15, 16, 17, 20, 33, 64, 255])
    eq("enemyscale", PSEUDO, `enemy stat ${raw} at scale ${scale}: scaleEnemyStat`, trunc((raw * scale) / 16), ES.scaleEnemyStat(raw, scale));
}

// ---------------------------------------------------------------------------------------------
// CHECK norow - table rows no skill row builds: 129 / 130 (drain rows), 443 (template), through the same real functions with a skill made exactly from the disc row (the way the slot damage is built).
//   Nothing in enemy_stats.json (193 records: attack/tech1/tech2) or in digimon.json's skill bank names 129, 130, 441, 442, 443; fightstg.s names 0x1b9/0x1ba (441/442) only at :28215-28217 and never 0x81/0x82/0x1bb.
// ---------------------------------------------------------------------------------------------
for (const id of [129, 130, 443]) {
  const r = disc(id);
  const skill = { id, power: r.power, element: ELEM[r.elem1], attack_category: CAT_NAME[r.category], magical: r.category === 3, base_acc: r.elemCtx, target_family: r.elem2, damage_scalar: r.scalar, clip: r.clip, effect_id: r.dispatch, effect_p1: r.f8, effect_p2: r.crit, ...(r.dispatch === 8 ? { effect: "drain" } : {}) };
  for (const S of SETS) {
    const st = setup(S, r), q = refSt(S, st);
    const hitCh = refChance(r.category, S.side, r.elemCtx, q.atk, q.def);
    for (const d1 of new Set([0, hitCh - 1, hitCh, 127].filter((x) => x >= 0 && x <= 127))) {
      const A = setup(S, r);
      eq("norow", id, `set ${S.n} accuracy draw ${d1} (chance ${hitCh}/128)`, (d1 & 0x7f) < hitCh, E.resolveAttack(A.atk, A.def, skill, seq([d1, 127, 0, 0, 0]), null).hit);
    }
    for (const [d2, d3, pd] of [[127, 0, 0], [0, 64, 0], [127, 0, 127]]) {
      const lf = refLeaf(r, S, q, d2, d3); if (lf.leaf < 1) continue;
      const draws = r.dispatch === 8 ? (lf.crit ? [0, d2, d3, pd] : [0, d2, pd, 0]) : [0, d2, d3, 0];
      const exp = refAction(r, S, st, draws); if (!exp.hit) continue;
      const A = setup(S, r);
      const ours = E.resolveAttack(A.atk, A.def, skill, seq(draws), null);
      eq("norow", id, `set ${S.n} crit draw ${d2} magnitude draw ${d3}${r.dispatch === 8 ? ` drain draw ${pd}` : ""}: [damage, heal]`, [exp.total, r.dispatch === 8 ? exp.heal : 0], [ours.dmg, ours.heal ?? 0]);
    }
  }
}


// ---------------------------------------------------------------------------------------------
// CHECK pool - the one status/turn event queue at 0x800a3868 (99 slots x 0x1c): FIGHTSTG_F0x8009ba4c "pick next" (fightstg.s:25778-25858) and the per-code free table at 0x800a3800 (:34124-34148).
//   scan slots 0..98, live = code != 0.  best = -1, t0 = 0x7fff.  For each live entry e: if best != -1 AND NOT (best.time < e.time) AND (best.code - 2) < 2 (unsigned) -> best = e (a turn event loses every tie and every later-or-equal entry);
//   then if e.time < t0 -> best = e.  Then t = best.time is subtracted from EVERY live entry (u16 wrap) and the code is returned; table word -1 (codes 4, 6, 9) leaves the entry queued, 1 frees it, 0 fires nothing.
// ---------------------------------------------------------------------------------------------
{
  const refPick = (pool) => {
    let best = -1, t0 = 0x7fff;
    pool.forEach((e, i) => {
      if (!e.code) return;
      if (best !== -1 && !(pool[best].time < e.time) && (((pool[best].code - 2) >>> 0) < 2)) { best = i; t0 = e.time; }
      if (e.time < t0) { best = i; t0 = e.time; }
    });
    return { best, t0 };
  };
  let seed = 12345; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  for (let k = 0; k < 400; k++) {
    const pool = mkPool(); const n = 1 + rnd(8);
    for (let j = 0; j < n; j++) { const i = rnd(99); pool[i] = { code: [2, 3, 5, 6, 9, 10, 13, 16][rnd(8)], time: [0, 500, 1000, 1000, 1500, 2000, 7000][rnd(7)], side: 0, slot: 0, payload: 0, payload2: 0 }; }
    const want = refPick(pool);
    const wantTimes = pool.map((e) => (e.code ? (e.time - want.t0) & 0xffff : e.time));
    const wantCode = want.best >= 0 ? pool[want.best].code : null;
    const copy = JSON.parse(JSON.stringify(pool));
    const got = E.pickNextStatusEvent(copy);
    eq("pool", PSEUDO, `pick next from a random pool (400 pools; codes 2,3,5,6,9,10,13,16; times 0..7000): [slot, code]`, [want.best, wantCode], [got ? got.index : -1, got ? got.code : null]);
    eq("pool", PSEUDO, `pick next: every live entry's time after the subtract (400 pools; sum of the 99 times)`, wantTimes.reduce((x, y) => x + y, 0), copy.reduce((x, e) => x + e.time, 0));
  }
  const KEEP = new Set([4, 6, 9]);
  for (let code = 1; code <= 0x14; code++) eq("pool", PSEUDO, `code ${code}: slot freed when it fires (table 0x800a3800 word: -1 keeps 4/6/9, 1 frees the rest)`, !KEEP.has(code), E.statusEventFreesSlot(code));
}


// ---------------------------------------------------------------------------------------------
// CHECK hand - one hand-worked example per new check: the arithmetic is written out here by hand, then asserted against the real function (a mistake in either shows up as a mismatch).
// ---------------------------------------------------------------------------------------------
{
  let n = 0; const hand = (text, ok) => eq("hand", 9000 + ++n, text, true, !!ok);
  hand("steal: Picking Claw (weight byte 64), enemy +0x04 = 16, thief SPD 100 vs foe 50: ratio 100*100/50 = 200 (cap 200), weight 100*64/64 = 100, threshold 16*200*100/10000 = 32 -> draw 31 steals, 32 does not, 1024+31 steals (only the low ten bits count)",
    E.stealProc(16, 100, 50, 64, 0, 31) && !E.stealProc(16, 100, 50, 64, 0, 32) && E.stealProc(16, 100, 50, 64, 0, 1024 + 31));
  hand("delay: opcode 0 own SPD 100 other 25: isqrt(2500) = 50, 1000*25/50 = 500, below the 707 floor -> 707;  opcode 3 own 100 other 100: 2000*100/100 = 2000",
    E.statusEventDelay(0, { own: 100, opp: 25 }) === 707 && E.statusEventDelay(3, { own: 100, opp: 100 }) === 2000);
  hand("stat-change duration: draw 100, own SPT 50: 2000 + 100 % 2001 + 10*50 = 2600", E.statusEventStatDelay(50, () => 100 / 65536) === 2600);
  { const pool = mkPool(); E.stageStatusEventLock(pool, 0, 0, 24, () => 5 / 65536);
    hand("lock duration: draw 5, record +0xc = 24: (5 % 101 + 100) * 24 = 2520 units", entriesOf(pool, 0x10)[0]?.time === 2520); }
  { const pool = mkPool(); E.stageStatusEventSideTick(pool, 0, 100, () => 1500 / 65536);
    hand("Auto Recover end event: draw 1500, SPT 100: 1500 % 2001 + 10*100 = 2500 (floor 1001)", entriesOf(pool, 5)[0]?.time === 2500); }
  hand("poison tick: max HP 300, payload 64, water 120, poison res 0: trunc(64/2)=32 minus trunc(120/10)=12 -> 20 percent of 300 = 60 (between 1 and 150)", E.poisonTimelineDamage(300, 64, 120, 0) === 60);
  hand("frozen block: power 40, thunder 120, paralyze 0: 40 - trunc(120/8) = 25, floored at 32 -> draw 31 blocks, 32 does not",
    E.frozenGateBlocksTurn(mkC({ res: { ...ALLRES, thunder: 120 }, extra: { ailments: { frozen: { power: 40 } } } }), seq([31])) && !E.frozenGateBlocksTurn(mkC({ res: { ...ALLRES, thunder: 120 }, extra: { ailments: { frozen: { power: 40 } } } }), seq([32])));
  hand("confusion gag: magnitude 40, wind 120, resist 0: 40 - 15 = 25 -> draw 24 gags, 25 attacks", E.confusionGagRoll(40, 120, 0, seq([24])) && !E.confusionGagRoll(40, 120, 0, seq([25])));
  { const r = disc(10), sk = { ...gameSkill(10), attack_category: "physical", basic_attack: true };
    const mk = () => [mkC({ level: 12, spd: 90, extra: { crit: 12, accBonus: 9 } }), mkC({ level: 9, spd: 70, name: "D" })];
    const [a1, d1] = mk(), [a2, d2] = mk();
    hand(`accuracy of Fight (accuracy byte ${r.elemCtx}), player side: term = trunc((90+9-70)/8)=3 + level 3 - crit byte 12 = -6; chance = 110 + trunc(110*-6/128) = 105 -> draw 104 hits, 105 misses`,
      E.resolveAttack(a1, d1, sk, seq([104, 127, 0]), null).hit && !E.resolveAttack(a2, d2, sk, seq([105, 127, 0]), null).hit); }
  hand("counter blow base: damage taken 120, countering record f9 64: 120*64/64 = 120; charged (/32) 240", E.counterBlowBase(120, 64, false, false) === 120 && E.counterBlowBase(120, 64, true, false) === 240);
  hand("Counter Crest: damage 150 on max HP 300: 32 + trunc(150*64/300) = 64 -> draw 63 counters, 64 does not", E.counterCrestProc(150, 300, seq([63])) && !E.counterCrestProc(150, 300, seq([64])));
  { const r = disc(421), mkb = () => mkBattle({ wis: 100 }, { wis: 20 }); const b1 = mkb(), b2 = mkb();
    const hit = B.applyPostHitDispatch(b1, GAME_TABLE["421"], { rng: seq([0, 37]) }), miss = B.applyPostHitDispatch(b2, GAME_TABLE["421"], { rng: seq([0, 38]) });
    hand(`penalty (421, f8 ${r.f8}): chance = ${r.f8} + trunc((enemy WIS 20 - player WIS 100)/8) = ${r.f8} - 10 = 38 -> draws (slot 0, roll 37) lands +${r.crit} STR, (slot 0, roll 38) does not`, hit?.penalty?.str === r.crit && miss?.penalty?.str === 0); }
  { const bt = mkBattle({ mp: 300, maxMp: 320 }, { mp: 10, maxMp: 100 }); B.applyPostHitDispatch(bt, GAME_TABLE["431"], { enemyName: "Foe" });
    hand("431 MP absorb: player max MP 320 * crit 8 / 128 = 20 moved: player 300 -> 280, enemy 10 -> 30", bt.player.mp === 280 && bt.enemy.mp === 30); }
  { const ES = await imp(path.join(P_WEB, "enemy-stats.js")); hand("enemy stat scale: 50 * 33 / 16 = 103 (truncated 103.125)", ES.scaleEnemyStat(50, 33) === 103); }
  { const r = disc(115), sk = attackSkill(115);
    const a = mkC({ extra: { elemAttack: { element: "fire", amount: 30 } }, level: 10, str: 100, def: 100 }), d = mkC({ name: "D", level: 10, str: 100, def: 100, res: { ...ALLRES, fire: 80 } });
    const base = trunc((100 * r.power) / 100);
    const ours = E.resolveAttack(a, d, sk, seq([0, 127, 0]), null).dmg;
    hand(`weapon element on a normal-element technique (${r.power} power, base ${base}): + trunc(2*${base}*30/80) = ${base + trunc((2 * base * 30) / 80)} (the disc stage has no basic-attack test, fightstg.s:29924-29940)`, ours === base + trunc((2 * base * 30) / 80)); }
}

// ---------------------------------------------------------------------------------------------
// Not checked (and why).
// ---------------------------------------------------------------------------------------------
notes.push(
  "NOT CHECKED, with the reason (everything else in the 443 rows is checked above):",
  "  - counter STANCE of a dispatch-10 technique (63, 90, 121, 122, 302, 303, 335, 401): the disc deals nothing for a player's use (resolver F0x8009e0cc :28425-28461 -> F0x8009d72c, post-hit word 0x8009e0bc, tag read once at :13067); our gate is a branch inside the createBattle closure (web/battle.js:7252) and the enemy counter ROW is the closure function triggerEnemyCounterRow (web/battle.js:7919): neither is an export, so no function can be called here",
  "  - Counter Crest SWING (web/battle.js:7881 triggerPlayerCounter, closure): READ, not run: it calls resolveAttack on the species' basic technique (base = STR*power/DEF); the disc (F0x8008ee84 -> F0x8009ff40 with s3 == 1, :30424-30447) runs the physical tail on base = the damage taken. engine resolveCounterBlow(playerBasicTech = true) does that and IS checked above (counter), but the game does not call it for the Crest",
  "  - Cross Slash 393 (dispatch 35): the post-hit dispatcher has no arm for 35 (checked: nothing runs); 'the target flees' is the result-queue word 35 drained by F0x80091a8c, set and consumed inside the battle-loop closure (web/battle.js:7364, :7818)",
  "  - Back Storm 406 wiring (web/battle.js:5318 resolveRepeatDispatch / slotDamage, closure): the pieces it uses ARE checked (multiHitReset against F0x8009ddd8, the magical damage leaf on records 441/442, the magical accuracy leaf on 406); the closure's own glue is not callable",
  "  - the ODD cure halves 191/193/195/197 free their pool events through the message-page scan F0x80099140 (kind 9, fightstg.s:23642-23649), a routine this script does not model; the EVEN halves and 375 (F0x8009c330) are checked (cureevt)",
  "  - equipment: the item id -> effective-byte ladder of F0x8009ec94 (0x8009f0cc-0x8009f4a0, ~190 compare instructions) is not re-derived; every effective byte it fills (+0x26 affinity, +0x27 armor, +0x28..+0x2a weapon family, +0x2b/+0x2c weapon element, +0x2d..+0x36 weapon status, +0x37 Multi Crest, +0x38 crit, +0x3a accuracy, +0x3b evade, +0x3e steal bonus, +0x1b Aura) is checked where a leaf reads it (accterms, critterms, tailterms, steal, timers, counter)",
  "  - HP application of the poison / regen ticks (HP-delta primitive 0x800aa9f0 in the wfightmn .word dump, survive floor): the tick AMOUNT is checked (poisonhp, regen), the apply step is in an overlay dump this script cannot read as instructions",
  "  - steal by the ENEMY side: the disc returns 0 (F0x800a1114 0x800a11bc); web/battle.js trySteal (:3739) and stealRoll (:10316) are only reached from the player's branches (:7145, :7356), so there is no enemy call to make; read, not run",
  "  - 391 Helter Skelter landing consequence (forced de-digivolve): the roll is checked both ways; the consequence is an event pushed to the battle script (menu.c EVENT_DIGIDEVOLVE), outside fightstg",
  "  - battle messages, pages and animation: out of scope.",
);

// ---------------------------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------------------------
const order = ["numbers", "mp", "accuracy", "damage", "critchance", "drain", "multihit", "status", "debuffhit", "heal", "regen", "cat5", "field", "steal", "delay", "timers", "poisonhp", "frozen", "confuse", "cureevt", "critterms", "accterms", "tailterms", "counter", "posthit", "penalty", "repeat", "pool", "side", "enemyscale", "norow", "hand"];
const LINES = [...groups.values()].map((g) => g.line + (g.n > 1 ? `   [${g.n} failing cases]` : ""));
for (const g of aggs.values()) {
  const ids = [...g.ids].sort((x, y) => x - y);
  LINES.push(`${g.c.padEnd(10)} scenario "${g.scen}" ${g.what}: ${ids.length} technique(s) differ; first ${g.first}; ids ${ids.slice(0, 14).join(",")}${ids.length > 14 ? ",..." : ""}`);
}
console.log(LINES.join("\n"));
if (LINES.length) console.log("");
const parts = [];
for (const c of order) {
  const k = CHECKS.get(c); if (!k) continue;
  parts.push(`${c} ${k.tested.size - k.failed.size}/${k.tested.size}${k.cases > k.tested.size ? ` (${k.cases} cases)` : ""}`);
}
console.log(`ids ${IDS[0]}..${IDS[IDS.length - 1]} (${IDS.length} rows); per-tech totals (ok/tested): ${parts.join(", ")}`);
for (const n of notes) console.log(`note: ${n}`);
const failedTotal = [...CHECKS.values()].reduce((s, k) => s + k.failed.size, 0);
console.log(`${LINES.length} mismatch line(s); ${failedTotal} failed tech-check pair(s)${staleBundle ? "; STALE BUNDLE" : ""}`);
process.exit(failedTotal > 0 || staleBundle ? 1 : 0);
