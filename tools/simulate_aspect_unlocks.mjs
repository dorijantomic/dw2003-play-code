// Simulates a playthrough with the game's real unlock rule (engine/dw3/evo-trees.ts) to see WHEN each extra form is learned
// by different builds, with and without the aspect routes. Balance check for docs/aspect-system-plan.md.
//
//   node tools/simulate_aspect_unlocks.mjs [extra_species.json] [--native] [--json out.json]
//
// The player model (every assumption is a constant below):
//  - fights one battle at a time at their own level; EXP per battle is the median of the walkable pools at that level
//    (stage_encounters + field_encounters + battle_rewards); levels follow the starter's growth_xp (web/battle.js rule)
//  - level-ups add the expected core and element growth of the starter (rollLevelUpGains tables) and 5 training points
//  - training points are spent as soon as they exist; element drills open at Lv SILVER_LV; core drills always
//  - the three seated forms are the ones most needed as prerequisites of forms not yet learned; a seated form gains one
//    form level a battle (10 DVEXP a battle against the 10*level ladder)
//  - one form is learned per battle: the first record in table order that passes (the disc's rule)
import fs from "node:fs";
import path from "node:path";
import { firstUnlockedTreeRecord } from "../engine/dw3/evo-trees.ts";

const args = process.argv.slice(2);
const native = args.includes("--native");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const extraPath = args.find((a) => a.endsWith(".json") && a !== jsonOut) ?? "web/assets/data/extra_species.json";
const DATA = "web/assets/data";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const base = read(path.join(DATA, "digimon.json")).digimon;
const evo = read(path.join(DATA, "evolutions.json"));
const prg = read(path.join(DATA, "progression.json"));
const enc = read(path.join(DATA, "field_encounters.json")).screens;
const stageEnc = read(path.join(DATA, "stage_encounters.json")).stages;
const extra = read(extraPath);

// core drill points per training point: the normal drills pay 1 + rand%2, 7 + rand%2, 14 + rand%3 for 1, 5, 10 points (about 1.5 each),
// the ultra variants 2, 10, 20 (progression.gym.core_rows); a drill also lowers a secondary stat, which this ignores (so it favours the player)
const SILVER_LV = 10, TP_PER_LEVEL = 5, MAX_LEVEL = 99, CORE_RATE = Number(process.env.CORE_RATE ?? 1.5);
const ELEMS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const CORE = ["str", "def", "spt", "wis", "spd"];
const lu = prg.level_up, gym = prg.gym;
const partnerIds = new Set((extra.starters ?? []).map((p) => p.id));       // the switched-off partners are not part of the game
const nameOf = new Map(base.map((d) => [d.id, d.name]));
for (const d of extra.digimon) nameOf.set(d.id, d.name);
const tierOf = (id) => { const n = nameOf.get(id); return extra.meta[n]?.tier ?? 0; };
const isExtra = (id) => id >= 56 && !partnerIds.has(id);

// ---- exp / dvexp per battle at a level, from the walkable pools -------------------------------------------------
const pts = [];
for (const z of Object.values(stageEnc)) for (const zone of z.zones) {
  if (!zone.rate_level) continue;
  for (const slot of zone.slots) {
    const es = enc[String(slot)], r = prg.battle_rewards[slot];
    if (slot && es?.length && r) pts.push([Math.max(...es.map((e) => e.level)), r[1], r[0]]);
  }
}
const nearMed = (L, col) => {
  let near = pts.filter((p) => Math.abs(p[0] - L) <= 3).map((p) => p[col]).sort((a, b) => a - b);
  if (!near.length) near = [...pts].sort((a, b) => Math.abs(a[0] - L) - Math.abs(b[0] - L)).slice(0, 5).map((p) => p[col]).sort((a, b) => a - b);
  return near[Math.floor(near.length / 2)] || 1;
};
const expAt = (L) => nearMed(L, 1);

// ---- the level-up rules ------------------------------------------------------------------------------------------
const coreBlock = lu.core_table.flat(), block = coreBlock.concat(lu.elem_table);
const tier6 = (lv) => { for (let i = 0; i < lu.core_tier_bounds.length; i++) if (lv < lu.core_tier_bounds[i]) return i; return lu.core_tier_bounds.length; };
const coreGain = (g, lv) => { let t = 0; for (let r = 0; r < 5; r++) t += block[tier6(lv) * 9 + g + r] ?? 0; return t / 5; };
const elemGain = (g, lv) => { if (lv >= lu.elem_level_limit) return 0; let t = 0; for (let r = 0; r < 4; r++) t += block[coreBlock.length + g + r] ?? 0; return t / 4; };
const threshold = (g, n) => {
  let t = lu.exp_tier_bounds.length - 1;
  for (let i = 0; i < lu.exp_tier_bounds.length; i++) if (n < lu.exp_tier_bounds[i]) { t = i; break; }
  return Math.floor(g * (n ** 3 + 5 * n - 6) / 10) + lu.exp_tier_const[t];
};
// element drill: points per training point at the current value (normal drills, growth class 3), the same rule the planner uses
const elemRate = (value) => {
  const b = value < gym.elem_brackets[0] ? 0 : value < gym.elem_brackets[1] ? 1 : 2;
  const t = gym.elem_tables[gym.elem_ptr[2][b]];
  let best = 0;
  gym.tp_costs.forEach((c, ci) => { best = Math.max(best, t[ci * 3][0] / c); });
  return best;
};

// ---- the trees: the disc's 44 records, then the extra records (as web/extra-roster.js mergeEvolutions) -----------------
const treeFor = (slot) => ({ lines: [{ slot, digimonId: base[slot].id, records: [...(evo.lines[slot]?.records ?? []).slice(0, 44), ...(extra.tree[String(slot)] ?? [])] }] });
const treesBySlot = Array.from({ length: 8 }, (_, s) => {
  const t = { lines: [] };
  t.lines[s] = treeFor(s).lines[0];
  return t;
});

// ---- archetypes --------------------------------------------------------------------------------------------------
// { name, tpTo: "str" | an element | "even" | "none" }
const ARCHETYPES = [
  { name: "no training", tpTo: "none" },
  { name: "balanced stats", tpTo: "even" },
  { name: "STR specialist", tpTo: "str" },
  ...ELEMS.map((e) => ({ name: `${e} specialist`, tpTo: e })),
];

function simulate(slot, arch, { maxBattles = 4000 } = {}) {
  const rookie = base[slot];
  const g = rookie.growth_xp;
  const st = { level: 1, xp: 0, tp: 0, stats: Object.fromEntries(CORE.map((k) => [k, rookie[k]])), bonuses: {}, elemBonuses: {}, formLedger: [], equippedForms: [] };
  for (const e of ELEMS) st.elemBonuses[e] = 0;
  const tree = treesBySlot[slot];
  const records = tree.lines[slot].records;
  const acquired = [];   // { id, battle, level }
  let battles = 0;
  const elementOf = (el) => st.elemBonuses[el];
  while (battles < maxBattles && st.level < MAX_LEVEL) {
    battles++;
    // exp and level-ups
    st.xp += expAt(st.level);
    while (st.level < MAX_LEVEL && st.xp > threshold(g, st.level + 1)) {
      st.level++;
      for (const k of CORE) st.stats[k] += coreGain(rookie.growth[k], st.level);
      for (const e of ELEMS) st.elemBonuses[e] += elemGain(rookie.resistance_growth[e], st.level);
      st.tp = Math.min(99, st.tp + TP_PER_LEVEL);
    }
    // spend the training points
    if (st.tp > 0 && arch.tpTo !== "none") {
      const tp = st.tp;
      if (arch.tpTo === "even") { for (const k of CORE) st.stats[k] += (tp / 5) * CORE_RATE; st.tp = 0; }
      else if (arch.tpTo === "str") { st.stats.str += tp * CORE_RATE; st.tp = 0; }
      else if (st.level >= SILVER_LV) {                    // before Silver the points wait (up to the cap of 99)
        for (let i = 0; i < tp; i++) st.elemBonuses[arch.tpTo] = Math.min(999, st.elemBonuses[arch.tpTo] + elemRate(st.elemBonuses[arch.tpTo]));
        st.tp = 0;
      }
    }
    // form levels: the three seated forms gain a level a battle
    const need = new Map(), counted = new Set();            // each target form counts once, however many routes lead to it
    for (const r of records) {
      if (counted.has(r.to) || st.formLedger.some((f) => f.id === r.to)) continue;
      counted.add(r.to);
      for (const q of [r.req0, r.req1]) if (q) need.set(q, (need.get(q) ?? 0) + 1);
    }
    const seated = [...st.formLedger].sort((a, b) => (need.get(b.id) ?? 0) - (need.get(a.id) ?? 0) || a.formLevel - b.formLevel).slice(0, 3);
    for (const f of seated) f.formLevel = Math.min(99, f.formLevel + 1);
    // the unlock rule, once per battle
    const ctx = {
      formLevels: Object.fromEntries(st.formLedger.map((f) => [f.id, f.formLevel])),
      level: st.level,
      stats: {
        stats: st.stats, bonuses: st.bonuses,
        // the game's JS path counts the trained element bonus only; the native record holds the species base + the bonus
        elemBonuses: native ? Object.fromEntries(ELEMS.map((e) => [e, st.elemBonuses[e] + (rookie.resistances?.[e] ?? 0)])) : st.elemBonuses,
      },
    };
    const hit = firstUnlockedTreeRecord(tree, slot, ctx);
    if (hit) {
      st.formLedger.push({ id: hit.record.to, formLevel: 1 });
      acquired.push({ id: hit.record.to, battle: battles, level: st.level, kind: hit.record.kind });
    }
  }
  return { acquired, battles, final: st };
}

// --trace <line index> <build name>: print one run's learned forms in order, to see what holds a form back
if (args.includes("--trace")) {
  const i = args.indexOf("--trace"), slot = +args[i + 1], arch = ARCHETYPES.find((a) => a.name === args[i + 2]);
  const r = simulate(slot, arch);
  console.log(`${base[slot].name} / ${arch.name}: ${r.acquired.length} forms in ${r.battles} battles, final Lv ${r.final.level}`);
  console.log("stats", Object.fromEntries(CORE.map((k) => [k, Math.round(r.final.stats[k])])), "elements", Object.fromEntries(ELEMS.map((e) => [e, Math.round(r.final.elemBonuses[e])])));
  for (const a of r.acquired) console.log(`  battle ${String(a.battle).padStart(4)} Lv ${String(a.level).padStart(2)}  ${nameOf.get(a.id).padEnd(18)} ${isExtra(a.id) ? "t" + tierOf(a.id) : "disc"}  kind ${a.kind}`);
  const have = new Set(r.acquired.map((a) => a.id));
  const missing = (extra.tree[String(slot)] ?? []).filter((x) => !have.has(x.to));
  console.log("not learned:", [...new Set(missing.map((x) => x.to))].length, "forms; samples:",
    [...new Set(missing.map((x) => x.to))].slice(0, 12).map((id) => `${nameOf.get(id)}(t${tierOf(id)})`).join(", "));
  // why: for every form not learned, the first thing that fails on its easiest record at the end of the run
  const ledger = Object.fromEntries(r.final.formLedger.map((f) => [f.id, f.formLevel]));
  const why = new Map();
  for (const id of new Set(missing.map((x) => x.to))) {
    const recs = (extra.tree[String(slot)] ?? []).filter((x) => x.to === id);
    const reasons = recs.map((x) => {
      for (const [q, lv] of [[x.req0, x.req0Level], [x.req1, x.req1Level]]) if (q) { if (ledger[q] == null) return `needs ${nameOf.get(q)}`; if (ledger[q] < lv) return `${nameOf.get(q)} Lv${ledger[q]}<${lv}`; }
      return `gate kind ${x.kind} ${x.threshold}`;
    });
    why.set(id, reasons.join(" | "));
  }
  const tally = new Map();
  for (const [, v] of why) { const k = v.split(" | ")[0].replace(/ Lv\d+<\d+/, " (level)").replace(/gate kind \d+ \d+/, "a stat/element gate"); tally.set(k.startsWith("needs") ? "missing parent form" : k, (tally.get(k.startsWith("needs") ? "missing parent form" : k) ?? 0) + 1); }
  console.log("blockers:", Object.fromEntries(tally));
  const t4 = [...why].filter(([id]) => tierOf(id) >= 4).slice(0, 6);
  console.log("tier 4-5 examples:\n" + t4.map(([id, v]) => `  ${nameOf.get(id)} (t${tierOf(id)}): ${v}`).join("\n"));
  process.exit(0);
}

// ---- report ------------------------------------------------------------------------------------------------------
const LINES = base.slice(0, 8).map((d) => d.name);
const CHECKS = [20, 30, 40, 50, 60];
const out = { extraPath, native, results: {} };
const sumTable = [];
for (let slot = 0; slot < 8; slot++) {
  for (const arch of ARCHETYPES) {
    const r = simulate(slot, arch);
    const ex = r.acquired.filter((a) => isExtra(a.id));
    const byTier = (t) => ex.filter((a) => tierOf(a.id) === t);
    const first = (t) => byTier(t)[0]?.level ?? null;
    const countBy = (lv, t) => ex.filter((a) => a.level <= lv && tierOf(a.id) === t).length;
    const row = {
      line: LINES[slot], build: arch.name, forms: ex.length, discForms: r.acquired.length - ex.length,
      firstTier: [1, 2, 3, 4, 5].map(first),
      byLevel: Object.fromEntries(CHECKS.map((lv) => [lv, [1, 2, 3, 4, 5].map((t) => countBy(lv, t))])),
      viaElement: ex.filter((a) => a.kind >= 8).length,
      endBattles: r.battles,
    };
    row.acq = ex.map((a) => [a.id, a.level, slot, arch.name, a.kind]);
    row.acqDisc = r.acquired.filter((a) => !isExtra(a.id)).map((a) => [a.id, a.level]);
    out.results[`${LINES[slot]} | ${arch.name}`] = { ...row, acq: undefined };
    sumTable.push(row);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));

// the headline numbers: per build, the median over the eight lines
const median = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
console.log(`tree: ${extraPath}${native ? "  (native element scale: base + bonus)" : ""}`);
console.log("build".padEnd(18), "first tier 1..5 (median Lv over 8 lines)".padEnd(44), "extra forms by Lv 30 / 50", " via element route");
for (const arch of ARCHETYPES) {
  const rows = sumTable.filter((r) => r.build === arch.name);
  const first = [0, 1, 2, 3, 4].map((i) => median(rows.map((r) => r.firstTier[i])));
  const tot = (lv) => median(rows.map((r) => r.byLevel[lv].reduce((a, b) => a + b, 0)));
  console.log(arch.name.padEnd(18), first.map((x) => String(x ?? "-").padStart(4)).join(" ").padEnd(44), `${tot(30)} / ${tot(50)}`.padEnd(14), median(rows.map((r) => r.viaElement)));
}
// the envelope: for every form, the earliest level ANY line with ANY build learned it. This is the best case an exploiter gets.
const earliest = new Map();
for (const r of sumTable) for (const [id, lv, slot, build, kind] of r.acq) { const e = earliest.get(id); if (!e || lv < e.lv) earliest.set(id, { lv, slot, build, kind }); }
const everyExtra = [...new Set(Object.values(extra.tree).flat().map((x) => x.to))].filter(isExtra);
const pct = (a, p) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null; };
console.log("\nbest case (earliest level any line/build learned each form): intended Lv from the plan 16/22/30/42/52");
console.log("tier  forms  never  earliest  10th pct  median  | earliest form");
for (let t = 1; t <= 5; t++) {
  const ids = everyExtra.filter((id) => tierOf(id) === t);
  const lv = ids.map((id) => earliest.get(id)?.lv).filter((x) => x != null);
  const first = ids.filter((id) => earliest.get(id)).sort((a, b) => earliest.get(a).lv - earliest.get(b).lv)[0];
  console.log(String(t).padEnd(5), String(ids.length).padEnd(6), String(ids.length - lv.length).padEnd(6), String(pct(lv, 0) ?? "-").padEnd(9), String(pct(lv, 0.1) ?? "-").padEnd(9), String(pct(lv, 0.5) ?? "-").padEnd(7),
    first ? `| ${nameOf.get(first)} Lv${earliest.get(first).lv} (${LINES[earliest.get(first).slot]}, ${earliest.get(first).build}, kind ${earliest.get(first).kind})` : "");
}
// the yardstick: the disc's own 44 forms (ids 9-52), grouped by the same stat-total classes as the extra tiers (the build script's base_tier)
const discTier = (d) => { const t = CORE.reduce((a, k) => a + d[k], 0); return t <= 110 ? 1 : t <= 170 ? 2 : t <= 210 ? 3 : t <= 235 ? 4 : 5; };
const discEarliest = new Map();
for (const r of sumTable) for (const [id, lv] of r.acqDisc) if (id >= 9 && id <= 52 && (!discEarliest.has(id) || lv < discEarliest.get(id))) discEarliest.set(id, lv);
console.log("\nthe disc's own forms of the same power class (the original game's allowance): earliest level any line/build learned one");
console.log("class  disc forms  learned  earliest  10th pct  median  | earliest disc form");
for (let t = 1; t <= 5; t++) {
  const ds = base.filter((d) => d.id >= 9 && d.id <= 52 && discTier(d) === t);
  const got = ds.filter((d) => discEarliest.has(d.id)).sort((a, b) => discEarliest.get(a.id) - discEarliest.get(b.id));
  const lv = got.map((d) => discEarliest.get(d.id));
  console.log(String(t).padEnd(6), String(ds.length).padEnd(11), String(got.length).padEnd(8), String(pct(lv, 0) ?? "-").padEnd(9), String(pct(lv, 0.1) ?? "-").padEnd(9), String(pct(lv, 0.5) ?? "-").padEnd(7), got[0] ? `| ${got[0].name} Lv${discEarliest.get(got[0].id)}` : "");
}
const never = sumTable.filter((r) => r.forms < 135);
console.log(`\nbuilds that never reach all 135 forms by Lv 99: ${never.length} of ${sumTable.length}` + (never.length ? "  (e.g. " + never.slice(0, 3).map((r) => `${r.line}/${r.build}=${r.forms}`).join(", ") + ")" : ""));
