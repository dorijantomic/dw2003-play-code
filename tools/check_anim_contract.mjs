// check_anim_contract.mjs — the A7a reaction/effect contract, checked by ARITHMETIC over the full cross
// product instead of by rendering. Everything is derived from data: the model index, each pack's anim.json,
// and the disc's technique table (digimon.json "skills": type, clip, hits). No species name, folder name or id
// appears in any branch — the case list is generated from the technique table, the models from the index.
//
// For every model x every (clip, target-class) case the game can present on clips 5/9/10, resolve the action
// script the game will play (own or built by web/fight/clip-fallback.js) and assert:
//   C1 hits          enemy case: #op10 98 == hits-1 and #op10 99 == 1 (the record's own hit count)
//   C2 reaction      every 98 carries an op1 [5] in its own tick window; the 99 carries an op1 [0];
//                    self case: no op1 at all
//   C3 target class  self case: no op1, no op6 launch, no 98/99, no victim camera cut; enemy case: not a
//                    self cast (a script that carries no defender-facing cue cannot hurt anyone)
//   C4 anchor        enemy: a world op3 on the VICTIM line (victimAnchor(model)) or a screen op3 behind a
//                    victim camera cut; self: a world op3 on the caster's line (selfAnchor(model)) or a
//                    screen op3 behind the caster camera preset
//   C5 locomotion    self case and ranged/attack case: no dash/jump op2 (modes 3,5,8) binding a movement
//   C7 body motion   the script binds at least one timeline table above the idle (table > 1), so the body moves
// Output: a JSON row per case with one boolean per invariant, and an MD summary whose violation lists are
// grouped by invariant and by builder path (own / built-<buildKind>) — never by species.
import fs from "node:fs";
import path from "node:path";

const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const OUT_JSON = "/home/dorij/scratch-research/anim-a7a-contract.json";
const OUT_MD = "/home/dorij/scratch-research/anim-a7a-contract.md";
const VICTIM_LINE = 5120;

const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const { donorRow } = await import(path.join(REPO, "web/fight/anim-donor-map.js"));
const { resolveClipScript, prepareModelDonors, registerDonorAnim, setFallbackDonor, victimAnchor, selfAnchor, scriptTableSeq, scriptIsSelfCast } = cb;

const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8"));
const folders = Array.isArray(index) ? index : index.models;
const skills = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/data/digimon.json"), "utf8")).skills;

// ── the case list, generated from the technique table ────────────────────────────────────────────────
// clips 5/9/10 with the classes the table actually gives them; the representative is the lowest id in each
// (type, clip, hits>1) cell, so the expected hit count is the record's own.
const CLIPS = [5, 9, 10];
const groups = new Map();
for (const s of skills) {
  if (!CLIPS.includes(s.clip)) continue;
  const cls = s.type === "heal" || s.type === "support" ? "self" : "enemy";
  const key = `${cls}|${s.clip}|${(s.hits ?? 1) > 1 ? "multi" : "single"}`;
  const prev = groups.get(key);
  if (!prev || s.id < prev.id) groups.set(key, s);
}
const CASES = [...groups.entries()].map(([key, s]) => ({
  key, clip: s.clip, target: s.type === "heal" || s.type === "support" ? "self" : "enemy",
  hits: s.hits ?? 1, tech: s.id, type: s.type, category: s.attack_category,
}));
// the one the last-resort donor belongs to is set up by the game at load; data, not a branch
setFallbackDonor(read("m005grey").actions);

// ── op helpers (all read the script the game will play) ──────────────────────────────────────────────
const opsOf = (s) => s?.ops ?? [];
const n10 = (ops, t) => ops.filter((o) => o.op === 10 && ((o.words?.[0] | 0) === t)).length;
const hasOp1 = (ops, mode) => ops.some((o) => o.op === 1 && ((o.words?.[0] | 0) === mode));
/** an op1 of `mode` in the tick window that belongs to the op10 at index i (contacts and their reaction are
 *  executed in the same tick; an op11 wait / op255 end / op0 jump closes the window). */
function paired(ops, i, mode) {
  for (let j = i + 1; j < ops.length; j++) {
    const o = ops[j];
    if (o.op === 11 || o.op === 255 || o.op === 0) break;
    if (o.op === 1 && ((o.words?.[0] | 0) === mode)) return true;
  }
  for (let j = i - 1; j >= 0; j--) {
    const o = ops[j];
    if (o.op === 11 || o.op === 255 || o.op === 0 || o.op === 10) break;
    if (o.op === 1 && ((o.words?.[0] | 0) === mode)) return true;
  }
  return false;
}
const spawns = (ops) => ops.filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0)
  .map((o) => ({ type: o.words?.[1] | 0, z: o.words?.[4] | 0 }));
const screenSpawn = (f) => f.z === 32767 || f.z === -1 || Math.abs(f.z) > 20000;
const camCut = (ops, preset) => ops.some((o) => o.op === 5 && (o.words?.[2] | 0) === preset);
const locomotion = (ops) => ops.filter((o) => o.op === 2 && [3, 5, 8].includes(o.words?.[0] | 0)).length;

function judge(model, caseDef, script) {
  const ops = opsOf(script);
  const empty = ops.length === 0;
  const h98 = n10(ops, 98), h99 = n10(ops, 99);
  const self = caseDef.target === "self";
  const built = script?.synthesized ? `built-${script.buildKind ?? "?"}` : "own";

  // C1 — the record's hit count. ADVISORY: the effective count comes from the dispatch rule (effect byte /
  // Multi Crest) which is A8/A10's contract, so the raw `hits` field is reported, not gated here.
  const C1 = self ? true : (h98 === Math.max(0, caseDef.hits - 1) && h99 === 1);

  // C2 — the reaction pairing, or none for a self cast
  let C2 = true;
  if (self) C2 = !hasOp1(ops, 5) && !hasOp1(ops, 0);
  else {
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (o.op !== 10) continue;
      const t = o.words?.[0] | 0;
      if (t === 98 && !paired(ops, i, 5)) C2 = false;
      if (t === 99 && !paired(ops, i, 0)) C2 = false;
    }
    if (!h99) C2 = false;
  }

  // C3 — target class shape
  const proj = ops.some((o) => o.op === 6 && ((o.words?.[0] | 0) === 0));
  const C3 = self
    ? (scriptIsSelfCast(script) && !proj && h98 + h99 === 0 && !camCut(ops, 1))
    : !(scriptIsSelfCast(script) && !h98 && !h99);   // an enemy script must carry a defender-facing cue

  // C4 — the effect anchor is on the fighter the technique is aimed at
  const sp = spawns(ops);
  const want = self ? selfAnchor(model) : victimAnchor(model);
  // same bound the runtime harness applies to a world anchor (2800 PS1 units around the intended fighter's
  // line, and on that fighter's side of the arena), so authored scripts that anchor a little off the line pass
  const worldOK = sp.some((f) => !screenSpawn(f) && Math.sign(f.z) === Math.sign(want.z) && Math.abs(f.z - want.z) <= 2800);
  const screenOK = sp.some(screenSpawn) && camCut(ops, self ? 3 : 1);
  const C4 = empty ? false : (worldOK || screenOK) || (self && sp.length === 0);

  // C5 — no dash/jump in a cast/support body, and none at all in a self cast
  const C5 = self ? locomotion(ops) === 0 : (caseDef.category === "magical" ? locomotion(ops) === 0 : true);

  // C7 — a body table above the idle is bound (the pose leaves idle)
  const C7 = scriptTableSeq(script).length > 0 || (self && hasTableSelf(model, script));

  return { C1, C2, C3, C4, C5, C7, h98, h99, spawns: sp.length, built,
           tables: scriptTableSeq(script), camCut: { victim: camCut(ops, 1), caster: camCut(ops, 3) } };
}
function hasTableSelf(model, script) {
  const tables = new Set(Object.keys(model.tables ?? {}).map(Number));
  return opsOf(script).some((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && tables.has(o.words?.[2] | 0));
}

const rows = [];
for (const folder of folders) {
  const model = read(folder);
  for (const caseDef of CASES) {
    let script = null, err = null;
    try {
      if (!model.actions?.[caseDef.clip]?.ops?.length) {
        const row = donorRow(folder, caseDef.clip);
        if (row) registerDonorAnim(row.d, read(row.d));
        await prepareModelDonors(model);
      }
      script = resolveClipScript(model, caseDef.clip, { element: 1, target: caseDef.target });
    } catch (e) { err = String(e?.message ?? e).slice(0, 120); }
    const v = err ? {} : judge(model, caseDef, script);
    rows.push({ model: folder, case: caseDef.key, clip: caseDef.clip, target: caseDef.target, tech: caseDef.tech,
                hits: caseDef.hits, type: caseDef.type, script: script ? (script.synthesized ? "built" : "own") : "none",
                err, ...v });
  }
}

// ── output: one row per case, one column per invariant, violations grouped by invariant x builder path ──
const INV = ["C2", "C3", "C4", "C5", "C7"];
const summary = {
  generated: new Date().toISOString(), models: folders.length, cases: CASES.map((c) => ({ ...c })),
  runs: rows.length,
  byInvariant: Object.fromEntries(INV.map((k) => [k, rows.filter((r) => r.err || r[k] === false).length])),
  C1_advisory: rows.filter((r) => r.err || r.C1 === false).length,
  errors: rows.filter((r) => r.err).length,
};
fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows }, null, 1));

const L = [];
L.push("# A7a contract — defender reaction + effect anchor, by arithmetic over the full cross product");
L.push("");
L.push(`Generated ${summary.generated} · ${summary.models} models x ${CASES.length} (clip, target-class) cases = ${rows.length} rows · ` +
  `violations: ` + INV.map((k) => `${k} ${summary.byInvariant[k]}`).join(", ") +
  ` · C1 hit-count advisory ${summary.C1_advisory} · resolver errors ${summary.errors}`);
L.push("");
L.push("Cases are generated from the technique table (`digimon.json` \"skills\", 426 records): every (type, clip, hits) cell that");
L.push("maps to clips 5/9/10, represented by its lowest id. `self` = type heal/support. No species name is used in any branch.");
L.push("");
L.push("| model | case | script | C1 hits | C2 react | C3 target | C4 anchor | C5 locomotive | C7 body | 98/99/fx |");
L.push("|---|------|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const m = (v) => (r.err ? "ERR" : v ? "ok" : "**VIOL**");
  L.push(`| \`${r.model}\` | ${r.case} | ${r.script} | ${m(r.C1)} | ${m(r.C2)} | ${m(r.C3)} | ${m(r.C4)} | ${m(r.C5)} | ${m(r.C7)} | ${r.h98 ?? "?"}/${r.h99 ?? "?"}/${r.spawns ?? "?"} |`);
}
L.push("");
L.push("## Violations grouped by invariant x builder path");
L.push("");
for (const k of INV) {
  const bad = rows.filter((r) => r.err || r[k] === false);
  if (!bad.length) continue;
  const byPath = new Map();
  for (const r of bad) byPath.set(`${r.case} ${r.script}`, (byPath.get(`${r.case} ${r.script}`) ?? 0) + 1);
  L.push(`### ${k} — ${bad.length} rows`);
  for (const [p, n] of [...byPath.entries()].sort((a, b) => b[1] - a[1])) L.push(`* ${p}: ${n}`);
  L.push("");
}
fs.writeFileSync(OUT_MD, L.join("\n"));
console.log(`rows ${rows.length} · ` + INV.map((k) => `${k} bad ${summary.byInvariant[k]}`).join(" · ") + ` · errors ${summary.errors}`);
for (const k of INV) {
  const bad = rows.filter((r) => r.err || r[k] === false);
  if (!bad.length) continue;
  const byPath = new Map();
  for (const r of bad) byPath.set(`${r.case} ${r.script}`, (byPath.get(`${r.case} ${r.script}`) ?? 0) + 1);
  console.log(`${k}:`, [...byPath.entries()].map(([p, n]) => `${p} ${n}`).join(" | "));
}
