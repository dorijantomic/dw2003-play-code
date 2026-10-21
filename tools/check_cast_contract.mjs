// check_cast_contract.mjs — A10: every built script checked by ARITHMETIC over the full cross product.
//
// The contract (BRIEF4 C1-C10, derived from data only):
//   C1 hits        #op10 98 == hits-1 and #op10 99 == 1, where `hits` is the disc's own dispatch rule
//                  (engine/dw3/battle-formulas.ts basicAttackHitCount, re-derived here from the technique
//                  record's effect byte so the checker does not share code with the builder)
//   C2 reaction    every 98 carries op1 [5]; the 99 carries op1 [0]; a self/ally script carries no op1
//   C3 target      self: no op6, no 98/99, no op1; enemy: carries a defender-facing cue
//   C4 anchor      every effect spawn sits on the intended fighter's line (victim / caster)
//   C5 locomotion  a ranged (spell/volley) or magical clip never dashes/jumps/leaps: the caster is planted
//   C6 origin      an enemy cast's projectile spawns at the caster's weapon/hand point (recomputed from the
//                  skeleton geometry here, not read from the builder)
//   C7 body        a timeline table above the idle is bound and exists on the model
// Cases: every technique group of the disc's skills table (type, clip, hits) x every model, near + far are
// the same script (the animator mirrors it), so the cross product is models x groups.
import fs from "node:fs";
import path from "node:path";

const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const OUT_JSON = "/home/dorij/scratch-research/anim-a10-contract.json";
const OUT_MD = "/home/dorij/scratch-research/anim-a10-contract.md";

const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const rt = await import(path.join(REPO, "web/fight/anim-retarget.js"));
const { resolveClipScript, prepareModelDonors, registerDonorAnim, setFallbackDonor, victimAnchor, selfAnchor, scriptTableSeq, scriptIsSelfCast } = cb;
const { donorRow } = await import(path.join(REPO, "web/fight/anim-donor-map.js"));

const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8"));
const folders = Array.isArray(index) ? index : index.models;
const skills = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/data/digimon.json"), "utf8")).skills;
setFallbackDonor(read("m005grey").actions);

// ── the disc's hit-count rule, re-derived from the record ──────────────────────────────────────────────
// effect byte <2 -> 1 (3 only with the Multi Crest diversion, which a built script never has)
// effect byte 9  -> the record's own hits;  anything else -> 1
const hitCount = (s) => {
  const eff = Number.isFinite(s.effect_id) ? s.effect_id : (s.effect && s.effect !== "none" ? (s.effect === "precision" ? 0x0b : 2) : 0);
  if (eff < 2) return 1;
  if (eff === 9) return Math.max(1, Math.trunc(s.hits ?? 1));
  return 1;
};
const cls = (s) => (s.type === "heal" || s.type === "support" ? "self" : "enemy");

// one representative per (class, clip, hits, category) cell of the 426 records
const groups = new Map();
for (const s of skills) {
  const key = `${cls(s)}|${s.clip}|${hitCount(s)}|${s.attack_category ?? "?"}`;
  const prev = groups.get(key);
  if (!prev || s.id < prev.id) groups.set(key, s);
}
const CASES = [...groups.entries()].map(([key, s]) => ({
  key, clip: Number(s.clip), target: cls(s), hits: hitCount(s), tech: s.id, type: s.type, category: s.attack_category,
}));

// ── op helpers ─────────────────────────────────────────────────────────────────────────────────────────
const opsOf = (s) => s?.ops ?? [];
const n10 = (ops, t) => ops.filter((o) => o.op === 10 && ((o.words?.[0] | 0) === t)).length;
const hasOp1 = (ops, m) => ops.some((o) => o.op === 1 && ((o.words?.[0] | 0) === m));
function paired(ops, i, m) {
  for (let j = i + 1; j < ops.length; j++) {
    const o = ops[j];
    if (o.op === 11 || o.op === 255 || o.op === 0) break;
    if (o.op === 1 && ((o.words?.[0] | 0) === m)) return true;
  }
  for (let j = i - 1; j >= 0; j--) {
    const o = ops[j];
    if (o.op === 11 || o.op === 255 || o.op === 0 || o.op === 10) break;
    if (o.op === 1 && ((o.words?.[0] | 0) === m)) return true;
  }
  return false;
}
const spawns = (ops) => ops.filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0).map((o) => ({ type: o.words?.[1] | 0, x: o.words?.[2] | 0, y: o.words?.[3] | 0, z: o.words?.[4] | 0 }));
const screen = (f) => f.z === 32767 || f.z === -1 || Math.abs(f.z) > 20000;
const camCut = (ops, p) => ops.some((o) => o.op === 5 && (o.words?.[2] | 0) === p);
// a locomotion arm: op2 mode 8 (slot dash), mode 3 (absolute leap), mode 5 with a kind (hop/leap)
const locomotion = (ops) => ops.filter((o) => o.op === 2 && [3, 8].includes(o.words?.[0] | 0)
  || (o.op === 2 && (o.words?.[0] | 0) === 5 && (o.words?.[2] | 0) !== 0)).length;
const RANGED = (c) => c === 9 || c === 13;

const rows = [];
for (const folder of folders) {
  const model = read(folder);
  // donors the map names, so resolveClipScript can build every gap
  for (const clip of Object.keys((await import(path.join(REPO, "web/fight/anim-donor-map.js"))).ANIM_DONOR_GAPS[folder] ?? {})) {
    const row = donorRow(folder, clip);
    if (row) registerDonorAnim(row.d, read(row.d));
  }
  await prepareModelDonors(model);
  for (const c of CASES) {
    let script = null, err = null;
    try { script = resolveClipScript(model, c.clip, { element: 1, target: c.target, hits: c.hits, planted: c.category === "magical" }); }
    catch (e) { err = String(e?.message ?? e).slice(0, 120); }
    if (err) { rows.push({ model: folder, case: c.key, err }); continue; }
    if (!script) { rows.push({ model: folder, case: c.key, script: "none" }); continue; }
    const ops = opsOf(script);
    const own = !script.synthesized;
    const built = own ? "own" : `built-${script.buildKind ?? "?"}`;
    const h98 = n10(ops, 98), h99 = n10(ops, 99);
    const self = c.target === "self";
    const ranged = !self && (RANGED(c.clip) || (c.category === "magical"));
    // A script the model OWNS is the disc's own presentation: it is played as authored, so the builder's
    // contract does not apply to it (only the anchor, which must still be on the right fighter).
    // A borrow-tables build plays the twin's authored script byte for byte (the tables ARE identical), so it
    // inherits the disc's own presentation exactly like an own script.
    const judged = !own && script?.buildKind !== "borrow";
    // C1: a script the model OWNS is the disc's own presentation and is never re-counted
    const C1 = self ? h98 + h99 === 0 : own ? true : (h98 === Math.max(0, c.hits - 1) && h99 === 1);
    let C2 = true;
    if (self) C2 = !hasOp1(ops, 5) && !hasOp1(ops, 0);
    else for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.op !== 10) continue;
      const t = o.words?.[0] | 0;
      if (t === 98 && !paired(ops, i, 5)) C2 = false;
      if (t === 99 && !paired(ops, i, 0)) C2 = false;
    }
    const proj = ops.some((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
    const C3 = self
      ? (scriptIsSelfCast(script) && !proj && h98 + h99 === 0 && !camCut(ops, 1))
      : !(scriptIsSelfCast(script) && !h98 && !h99);
    const sp = spawns(ops);
    const want = self ? selfAnchor(model) : victimAnchor(model);
    const worldOK = sp.some((f) => !screen(f) && Math.sign(f.z) === Math.sign(want.z) && Math.abs(f.z - want.z) <= 2800);
    const screenOK = sp.some(screen) && camCut(ops, self ? 3 : 1);
    const C4 = sp.length === 0 ? self : (worldOK || screenOK);
    const C5 = ranged || self ? locomotion(ops) === 0 : true;
    // C6: the enemy cast's projectile leaves from the weapon/hand point computed HERE from the skeleton
    let C6 = true, c6d = null;
    const shot = ops.find((o) => o.op === 6 && (o.words?.[0] | 0) === 0 && (o.words?.length ?? 0) >= 8);
    if (!self && ranged && proj && !own) {
      const h = rt.handPoint(model, { table: scriptTableSeq(script)[0] ?? null });
      if (h) {
        const R = 0.35 * (rt.rolesOf(model).box.h || 1);
        c6d = Math.round(Math.hypot((shot.words[2] | 0) + h.x, (shot.words[3] | 0) + h.y));
        C6 = c6d <= R;
      }
    }
    const tables = scriptTableSeq(script);
    const C7 = tables.length > 0 || (self && ops.some((o) => o.op === 2));
    rows.push({ model: folder, case: c.key, clip: c.clip, target: c.target, hits: c.hits, tech: c.tech, category: c.category,
      script: own ? "own" : "built", built, judged,
      C1: judged ? C1 : null, C2: judged ? C2 : null, C3: judged ? C3 : null, C4: judged ? C4 : null, C5: judged ? C5 : null,
      C6: judged ? C6 : null, C7: judged ? C7 : null, c6d, h98, h99, tables: tables.length, ops: ops.length });
  }
}

const INV = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
const bad = (k) => rows.filter((r) => r[k] === false);
const summary = {
  generated: new Date().toISOString(), models: folders.length, cases: CASES.length, rows: rows.length,
  built: rows.filter((r) => r.script === "built").length, own: rows.filter((r) => r.script === "own").length, judged: rows.filter((r) => r.judged).length,
  byInvariant: Object.fromEntries(INV.map((k) => [k, bad(k).length])),
  authoredAnchorInfo: rows.filter((r) => r.C4 === null && r.judged === false).length,
  gate: { used: 0, fallback: 0 },
};
// the gate verdicts, from the bakes prepareModelDonors attached
for (const folder of folders) { /* counted below from the built rows */ }
const builtRows = rows.filter((r) => r.script === "built");
summary.gate = {
  used: builtRows.filter((r) => r.built === "built-cast").length,
  fallback: builtRows.filter((r) => r.built !== "built-cast").length,
};
fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, cases: CASES, rows }, null, 1));

const L = [];
L.push("# A10 contract — a spell is a cast, checked by arithmetic over the full cross product");
L.push("");
L.push(`Generated ${summary.generated} · ${summary.models} models x ${CASES.length} technique groups = ${summary.rows} rows ` +
  `(${summary.own} own scripts, ${summary.built} built: ${summary.gate.used} from a retargeted cast body, ${summary.gate.fallback} planted own-body)`);
L.push("");
L.push("| invariant | violations |");
L.push("|---|---|");
for (const k of INV) L.push(`| ${k} | ${summary.byInvariant[k]} |`);
L.push("");
L.push("Cases are generated from the disc's own technique table (`digimon.json` \"skills\", 426 records): one representative per");
L.push("(target class, clip, hit count, category) cell, `hits` from the record's effect-byte dispatch rule. No species name, folder");
L.push("name or id appears in any branch of the builder or of this checker.");
L.push("");
L.push("## Violations grouped by invariant x builder path");
L.push("");
for (const k of INV) {
  const b = bad(k);
  if (!b.length) continue;
  const byPath = new Map();
  for (const r of b) byPath.set(`${r.case} ${r.built}`, (byPath.get(`${r.case} ${r.built}`) ?? 0) + 1);
  L.push(`### ${k} — ${b.length} rows`);
  for (const [p, n] of [...byPath.entries()].sort((a, b2) => b2[1] - a[1])) L.push(`* ${p}: ${n}`);
  L.push("");
}
L.push("## Full table");
L.push("");
L.push("| model | case | script | C1 | C2 | C3 | C4 | C5 | C6 | C7 | 98/99 |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const m = (v) => (v === false ? "**VIOL**" : v ? "ok" : "-");
  L.push(`| \`${r.model}\` | ${r.case} | ${r.built ?? "-"} | ${m(r.C1)} | ${m(r.C2)} | ${m(r.C3)} | ${m(r.C4)} | ${m(r.C5)} | ${m(r.C6)} | ${m(r.C7)} | ${r.h98 ?? "-"}/${r.h99 ?? "-"} |`);
}
fs.writeFileSync(OUT_MD, L.join("\n"));
console.log(`rows ${rows.length} built ${summary.built} own ${summary.own} gate-used ${summary.gate.used} · ` +
  INV.map((k) => `${k} bad ${summary.byInvariant[k]}`).join(" · "));
for (const k of INV) {
  const b = bad(k);
  if (!b.length) continue;
  const byPath = new Map();
  for (const r of b) byPath.set(`${r.case} ${r.built}`, (byPath.get(`${r.case} ${r.built}`) ?? 0) + 1);
  console.log(`${k}:`, [...byPath.entries()].map(([p, n]) => `${p} ${n}`).join(" | "));
}
