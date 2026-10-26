#!/usr/bin/env node
// check_tech_targets.mjs — the A9 CONTRACT over the FULL cross product, by arithmetic on the data.
//
// For every battle model (web/assets/battle/models/index.json) and every technique/item class the disc's
// own tables define, build the presentation script exactly as the game builds it (imports
// web/fight/clip-fallback.js, feeds it the model's anim.json + the donor rows) and check the BRIEF4
// contract C1..C10 on the SCRIPT + the model's timeline, for the near side and its mirror.
//
// TARGET CLASS comes from the disc's skills table (digimon.json "skills".type): heal/support = SELF,
// everything else = ENEMY. Items: the item machine's default clip-10 arm = SELF, the throw band 77..90 =
// ENEMY. No species name or id appears in any rule.
//
// CALIBRATION (orchestrator rule): the disc's own authored clips are ground truth — a rule the disc
// violates is a wrong rule. Every per-clip expectation below is DERIVED from the 249 authored packs
// (`signatures()`), never assumed: a clip's contact count, its op1 reaction pairing, its effect-spawn form
// and whether it installs a victim camera are the disc's own signature for that clip. The technique
// record's `hits` column is NOT the contract — the disc contradicts it (every authored clip-8 script has
// 3 contacts while its technique rows say hits=2; every authored clip-11 script has 1 contact while its
// multi rows say 7).
//
// Output: JSON + MD, one row per case, one column per invariant, violations grouped by invariant and by
// builder path so a violation names the systemic cause, never an individual.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const JSON_OUT = arg("--json", "/home/dorij/scratch-research/anim-a9-contract.json");
const MD_OUT = arg("--md", "/home/dorij/scratch-research/anim-a9-contract.md");

const { ANIM_DONOR_GAPS } = await import(resolve(ROOT, "web/fight/anim-donor-map.js"));
const cf = await import(resolve(ROOT, "web/fight/clip-fallback.js"));
const { scriptIsSelfCast } = cf;
const { mirrorOps } = await import(resolve(ROOT, "web/fight/side-mirror.js"));
const { setTechTable, setSkillTable, itemTargetClass, setItemUseEffects } =
  await import(resolve(ROOT, "web/fight/fight-tables.js"));

const idx = JSON.parse(readFileSync(`${MODELS}/index.json`, "utf8"));
const dj = JSON.parse(readFileSync(`${ROOT}/web/assets/data/digimon.json`, "utf8"));
const techTable = JSON.parse(readFileSync(`${ROOT}/web/assets/data/fight_tech_table.json`, "utf8"));
const itemsFile = JSON.parse(readFileSync(`${ROOT}/web/assets/data/items.json`, "utf8"));
const itemRows = Array.isArray(itemsFile) ? itemsFile : (itemsFile.items ?? []);
// The item machine's use-effect table is DISC-DERIVED and not present in every tree; the script carries
// the 9999 current-effect sentinel either way, which the animator resolves at play time.
const itemUsePath = `${ROOT}/web/assets/data/item_use_effects.json`;
const itemRecs = existsSync(itemUsePath) ? JSON.parse(readFileSync(itemUsePath, "utf8")) : { records: [] };
setTechTable(techTable); setSkillTable(dj); setItemUseEffects(itemRecs);

const models = new Map();
const loadModel = (f) => {
  if (models.has(f)) return models.get(f);
  const p = `${MODELS}/${f}/anim.json`;
  const m = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  if (m) m.folder = f;
  models.set(f, m);
  return m;
};
for (const f of idx) {
  const gaps = ANIM_DONOR_GAPS[f]; if (!gaps) continue;
  for (const clip of Object.keys(gaps)) {
    const d = gaps[clip].d; const anim = loadModel(d); if (anim) cf.registerDonorAnim(d, anim);
  }
}
cf.setFallbackDonor(loadModel("m005grey")?.actions ?? null);

// ── the disc's per-clip signature, derived from every authored pack ────────────────────────────────
// contacts = #(98)+#(99); op1 = the reaction mode string; spawn = "world" when a spawn is anchored at an
// arena line (|z| >= 2000) else "screen"; victimCam = the clip installs a slot preset that is not the
// item camera (3/6) and not the reset (0).
function signatures() {
  const per = new Map();
  for (const f of idx) {
    const a = loadModel(f); const acts = a?.actions;
    if (!Array.isArray(acts)) continue;
    for (const [c, s] of Object.entries(acts)) {
      if (!s?.ops?.length) continue;
      if (!per.has(c)) per.set(c, { packs: 0, contacts: new Map(), op1: new Map(), spawn: new Map(), cam: new Map() });
      const g = per.get(c); g.packs++;
      const n = s.ops.filter((o) => o.op === 10 && [98, 99].includes(o.words?.[0] | 0)).length;
      g.contacts.set(n, (g.contacts.get(n) ?? 0) + 1);
      const op1 = s.ops.filter((o) => o.op === 1).map((o) => o.words?.[0] | 0).join("/");
      g.op1.set(op1, (g.op1.get(op1) ?? 0) + 1);
      const sp = s.ops.filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0);
      const screenZ = (z) => z === 32767 || z === -1 || Math.abs(z) > 20000;
      const form = sp.some((o) => !screenZ(o.words?.[4] | 0) && Math.abs(o.words?.[4] | 0) >= 2000) ? "world"
        : sp.length ? "screen" : "none";
      g.spawn.set(form, (g.spawn.get(form) ?? 0) + 1);
      const cam = s.ops.filter((o) => o.op === 5 && (o.words?.[1] | 0) === 0).map((o) => o.words?.[2] | 0).join("/");
      g.cam.set(cam, (g.cam.get(cam) ?? 0) + 1);
    }
  }
  const mode = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const out = new Map();
  for (const [c, g] of per) {
    // CONTACT COUNTS and op1 modes are SETS: the disc authors variants (clip 10: 53 packs with the item
    // sound contact, 16 without), so a built script is correct when it matches ANY authored variant of
    // its clip. The per-pack facts are the ground truth; no single value is imposed.
    out.set(Number(c), {
      packs: g.packs,
      contacts: new Set([...g.contacts.keys()].map(Number)),
      contactMode: Number(mode(g.contacts)),
      op1: new Set([...g.op1.keys()]),
      op1Mode: mode(g.op1),
      spawn: mode(g.spawn),
      cam: mode(g.cam),
    });
  }
  return out;
}
const SIG = signatures();

// ── helpers ───────────────────────────────────────────────────────────────────
const hasOps = (s) => !!s && Array.isArray(s.ops) && s.ops.length > 0;
const opCount = (s, op) => (s?.ops ?? []).filter((o) => o.op === op).length;
const contacts = (s) => (s?.ops ?? []).filter((o) => o.op === 10 && [98, 99].includes(o.words?.[0] | 0));
const spawns = (s) => (s?.ops ?? []).filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0);

const selfTechs = dj.skills.filter((s) => s.type === "heal" || s.type === "support");
const selfClips = [...new Set(selfTechs.map((s) => s.clip))].sort((a, b) => a - b);
const enemyClips = [...new Set(dj.skills.filter((s) => s.type === "attack").map((s) => s.clip))].sort((a, b) => a - b);
const THROW = [77, 90];
const defaultItems = [...new Set(itemRows.map((r) => r.id | 0))].filter((id) => id > 0 && !(id >= THROW[0] && id <= THROW[1])).sort((a, b) => a - b);

function checkSelf(model, folder, clip, label) {
  const built = cf.resolveClipScript(model, clip, { element: 1, target: "self" });
  const own = model.actions?.[clip];
  const selfAuthored = hasOps(own) && scriptIsSelfCast(own);
  const path = !hasOps(own) ? "built" : selfAuthored ? "own-self" : "built-over-own-attack";
  const violations = [];
  if (!built) return { folder, label, clip, target: "self", path, violations: ["C3 no script"] };
  const ops = built.ops ?? [];
  // C3 — self-targeted means aimed at the CASTER: no projectile, no reaction request, no hit spark, no
  // victim camera cut. A bare op10 98/99 in an AUTHORED item clip is the item's SOUND cue (the disc's own
  // clip 10 is `3[1,9999] 5[60,0,3] … 10[99,0] 3[0,9999,0,0,32767]` with nothing enemy-facing), not a
  // strike; a BUILT self script carries no op10 at all.
  if (opCount(built, 6)) violations.push("C3 projectile op6");
  if (opCount(built, 1)) violations.push("C3 op1 reaction");
  if (!scriptIsSelfCast(built)) violations.push("C3 not a self-shaped script");
  if (built.synthesized && contacts(built).length) violations.push("C3 built self carries a strike");
  // C4 — every spawn is on the caster: none may sit on the victim line; a built script must carry the
  // current-effect (9999) spawn.
  const sp = spawns(built);
  const world = sp.filter((o) => !(o.words?.[4] === 32767 || o.words?.[4] === -1));
  if (world.some((o) => Math.abs(o.words?.[4] | 0) > 1000)) violations.push("C4 effect on the victim line");
  if (built.synthesized && !sp.some((o) => (o.words?.[1] | 0) === 9999)) violations.push("C4 no current-effect spawn");
  // C5 — the caster stays planted
  if (ops.some((o) => o.op === 2 && [3, 8].includes(o.words?.[0] | 0))) violations.push("C5 locomotion op2 3/8");
  // C7 — a body table of THIS model is bound and held long enough to move
  const binds = ops.filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words?.[2] | 0) !== 1).map((o) => o.words[2] | 0);
  const bodies = binds.filter((t) => (model.timeline?.[t]?.table?.length ?? 0) > 0);
  if (!bodies.length) violations.push("C7 no body table");
  const hold = ops.filter((o) => o.op === 11).reduce((a, o) => Math.max(a, o.words?.[0] | 0), 0);
  if (hold < 10) violations.push("C7 frozen (hold < 10)");
  // C8 — a camera PAIR (a slot preset in, preset 0 out). A BUILT script writes the disc's player
  // convention (preset 3 = the near slot). An AUTHORED script is the disc's own ground truth and uses its
  // own slot (3 near / 7 far) with no requirement of this rule (clip 11 authors no camera at all).
  if (built.synthesized) {
    const cams = ops.filter((o) => o.op === 5).map((o) => o.words || []);
    const pair = cams.length >= 2 && cams[0][1] === 0 && (cams[0][2] | 0) >= 1 && (cams[0][2] | 0) <= 7
      && cams[cams.length - 1][1] === 0 && cams[cams.length - 1][2] === 0;
    if (!pair) violations.push("C8 camera pair missing");
    if ((cams[0]?.[2] | 0) !== 3) violations.push("C8 built camera is not the near-slot preset");
  }
  // C9 — the mirror keeps the shape and never moves a spawn toward the victim line
  const m = mirrorOps(ops);
  if (m.length !== ops.length) violations.push("C9 mirror length");
  if (m.filter((o) => o.op === 10 && [98, 99].includes(o.words?.[0] | 0)).length !== contacts(built).length) violations.push("C9 mirror contacts");
  if (m.filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0 && !(o.words?.[4] === 32767 || o.words?.[4] === -1))
    .some((o) => Math.abs(o.words?.[4] | 0) > 1000)) violations.push("C9 mirror spawn off the caster");
  return { folder, label, clip, target: "self", path, tables: bodies.join("/"), hold, violations };
}

function checkEnemy(model, folder, clip, label) {
  const sig = SIG.get(clip) ?? null;
  const own = model.actions?.[clip];
  const built = cf.resolveClipScript(model, clip, { element: 1, target: "enemy" });
  if (hasOps(own)) {
    // CALIBRATION: the model's own script DEFINES the ground truth for its clip, so it carries no
    // expectation (the signature table is built from these rows). Facts are recorded for the report.
    return { folder, label, clip, target: "enemy", path: "own", contact98: contacts(own).filter((o) => (o.words[0] | 0) === 98).length, contact99: contacts(own).filter((o) => (o.words[0] | 0) === 99).length, op1: opCount(own, 1), violations: [] };
  }
  const violations = [];
  if (!built) return { folder, label, clip, target: "enemy", path: "none", violations: ["C3 no script"] };
  const c98 = contacts(built).filter((o) => (o.words[0] | 0) === 98).length;
  const c99 = contacts(built).filter((o) => (o.words[0] | 0) === 99).length;
  // C1 — the count must be one the disc itself authors for this clip
  if (sig && !sig.contacts.has(c98 + c99)) violations.push(`C1 contacts ${c98}+${c99} not an authored variant {${[...sig.contacts].join(",")}}`);
  // C2 — the reaction pairing the disc's DOMINANT authored form for this clip carries (clip 16/17/15
  // and clip 10 author an effect-only contact with no op1 in all but one pack, so no requirement there)
  const ops = built.ops;
  const idx98 = ops.map((o, i) => (o.op === 10 && (o.words?.[0] | 0) === 98 ? i : -1)).filter((i) => i >= 0);
  const idx99 = ops.map((o, i) => (o.op === 10 && (o.words?.[0] | 0) === 99 ? i : -1)).filter((i) => i >= 0);
  const near = (i, mode) => ops.slice(Math.max(0, i - 4), Math.min(ops.length, i + 5)).some((o) => o.op === 1 && (o.words?.[0] | 0) === mode);
  const modeOp1 = sig?.op1Mode ?? "";
  if (modeOp1.includes("5") && idx98.some((i) => !near(i, 5))) violations.push("C2 98 without op1[5]");
  if (modeOp1.includes("0") && idx99.length && !idx99.some((i) => near(i, 0))) violations.push("C2 99 without op1[0]");
  // C4 — the effect must land on the VICTIM. The disc authors both forms (world anchor at the victim
  // line for the melee clips, screen-space under a victim camera cut for the cast clips), so either is
  // correct; what may never happen is a screen-space effect with no camera on the victim.
  const sp = spawns(built);
  const last99 = idx99.length ? idx99[idx99.length - 1] : -1;
  const after = last99 >= 0 ? sp.filter((o) => ops.indexOf(o) > last99) : sp;
  const screenZ = (z) => z === 32767 || z === -1 || Math.abs(z) > 20000;
  const victimCam = ops.some((o) => o.op === 5 && (o.words?.[0] | 0) === 0 && [1, 2, 3, 4, 5, 6, 7].includes(o.words?.[2] | 0));
  const worldVictim = after.some((o) => !screenZ(o.words?.[4] | 0) && Math.abs(o.words?.[4] | 0) >= 4000);
  if (after.length && !worldVictim && !victimCam) violations.push("C4 strike spawn not on the victim");
  return { folder, label, clip, target: "enemy", path: "built", contact98: c98, contact99: c99, op1: opCount(built, 1), violations };
}

const rows = [];
for (const folder of idx) {
  const model = loadModel(folder);
  if (!model) continue;
  await cf.prepareModelDonors(model);
  for (const clip of selfClips) {
    const tech = selfTechs.find((s) => s.clip === clip);
    rows.push(checkSelf(model, folder, clip, `tech ${tech.id} (${tech.type})`));
  }
  for (const item of defaultItems) {
    const r = checkSelf(model, folder, 10, `item ${item}`);
    r.kind = "item";
    if (itemTargetClass(item) !== "self") r.violations.push("C10 item class");
    rows.push(r);
  }
  for (const clip of enemyClips) rows.push(checkEnemy(model, folder, clip, `tech group clip ${clip}`));
}

const bad = rows.filter((r) => r.violations.length);
const byInv = new Map();
for (const r of bad) for (const v of r.violations) {
  const k = v.split(" ")[0];
  if (!byInv.has(k)) byInv.set(k, []);
  byInv.get(k).push(`${r.folder} ${r.label} [${r.target}/${r.path}]`);
}
const byPath = new Map();
for (const r of rows) byPath.set(`${r.target}/${r.path}`, (byPath.get(`${r.target}/${r.path}`) ?? 0) + 1);
const summary = {
  rows: rows.length, passed: rows.length - bad.length, failed: bad.length,
  by_target_path: Object.fromEntries([...byPath.entries()].sort()),
  by_invariant: Object.fromEntries([...byInv.entries()].sort().map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 12) }])),
  disc_signature: Object.fromEntries([...SIG.entries()].sort((a, b) => a[0] - b[0]).map(([c, s]) => [c, {
    packs: s.packs, contacts: [...s.contacts].sort((a, b) => a - b), contact_mode: s.contactMode,
    op1: [...s.op1].filter(Boolean), op1_mode: s.op1Mode, spawn: s.spawn, cam: s.cam,
  }])),
};
writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1));
const md = [];
md.push("# A9 contract over the full cross product (auto-generated; per-clip expectations derived from the disc)");
md.push("");
md.push(`rows ${summary.rows} · pass ${summary.passed} · fail ${summary.failed}`);
md.push("");
md.push("## The disc's own per-clip signature (derived from every authored pack)");
md.push("");
md.push("| clip | packs | contacts (98+99) | op1 modes | effect spawn | camera |"); md.push("|---|---|---|---|---|---|");
for (const [c, s] of [...SIG.entries()].sort((a, b) => a[0] - b[0])) md.push(`| ${c} | ${s.packs} | ${[...s.contacts].sort((a, b) => a - b).join("/")} | ${[...s.op1].filter(Boolean).join(" or ") || "-"} | ${s.spawn} | ${s.cam || "-"} |`);
md.push("");
md.push("| target/path | rows |"); md.push("|---|---|");
for (const [k, v] of Object.entries(summary.by_target_path)) md.push(`| ${k} | ${v} |`);
md.push("");
md.push("| invariant | violated rows | sample (model, case, builder path) |"); md.push("|---|---|---|");
for (const [k, v] of Object.entries(summary.by_invariant)) md.push(`| ${k} | ${v.count} | ${v.sample.join("<br>")} |`);
md.push("");
md.push("| model | case | clip | target | path | contacts 98/99 | op1 | tables | hold | violations |");
md.push("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) md.push(`| ${r.folder} | ${r.label} | ${r.clip} | ${r.target} | ${r.path} | ${r.contact98 ?? "-"}/${r.contact99 ?? "-"} | ${r.op1 ?? "-"} | ${r.tables ?? "-"} | ${r.hold ?? "-"} | ${r.violations.join("; ") || "ok"} |`);
writeFileSync(MD_OUT, md.join("\n") + "\n");
console.log(JSON.stringify({ rows: summary.rows, passed: summary.passed, failed: summary.failed, by_target_path: summary.by_target_path, by_invariant: Object.fromEntries(Object.entries(summary.by_invariant).map(([k, v]) => [k, v.count])) }, null, 1));
console.log(`\nwrote ${JSON_OUT}\nwrote ${MD_OUT}`);
process.exit(bad.filter((r) => r.target === "self").length ? 1 : 0);
