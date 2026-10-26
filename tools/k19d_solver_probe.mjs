#!/usr/bin/env node
// K19d probe: what the lead's solver (web/fight/anim-solver.js) makes of the three exemplars today.
// Calls solveCast directly (no clip-fallback hook needed yet) and prints the verdict + the numbers the
// postcondition report will quote. Nothing is written; `apply: false` keeps the model clean.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const { prepareModelDonors, setDonorLoader } = await import(path.join(ROOT, "web/fight/clip-fallback.js"));
const S = await import(path.join(ROOT, "web/fight/anim-solver.js"));

const cache = new Map();
setDonorLoader((folder) => {
  if (!cache.has(folder)) {
    const f = path.join(MODELS, folder, "anim.json");
    cache.set(folder, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
  }
  return Promise.resolve(cache.get(folder));
});

const EX = [
  { key: "bare-hands", folder: "m228piem", tech: "Darkness Chaos" },
  { key: "prop-arm", folder: "m178kngt", tech: "Electro Bolt" },
  { key: "mouth-head", folder: "m050coca", tech: "Air Blast" },
];

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
for (const ex of EX) {
  const model = JSON.parse(fs.readFileSync(path.join(MODELS, ex.folder, "anim.json"), "utf8"));
  model.folder = ex.folder;
  await prepareModelDonors(model);
  const group = S.solverGroup(model, { tech: ex.tech });
  const plan = group.ok ? S.planCast(model, group) : null;
  const res = group.ok && plan?.ok ? S.solveCast(model, { tech: ex.tech, apply: false }) : null;
  const out = {
    key: ex.key, folder: ex.folder, tech: ex.tech,
    group: group.ok ? { cls: group.cls, mode: group.mode, sites: group.sites?.map((s) => s.id) } : group,
    plan: plan ? { ok: plan.ok, why: plan.why ?? null, ticks: plan.ticks, release: plan.release, windup: plan.windup, flight: plan.flight, follow: plan.follow, H: r2(plan.H) } : null,
    solved: res ? { ok: res.ok, table: res.table, tick: res.tick, ticks: res.ticks } : null,
    report: res?.report ? {
      gate: res.report.gate, pass: res.report.pass, worstAim: r2(res.report.worstAim),
      aim: res.report.aim?.map((a) => ({ id: a.id, cls: a.cls, err: r2(a.error) })),
      reached: res.report.reached, penetration: res.report.penetration,
      rootDrift: r2(res.report.rootDrift), metrics: res.report.metrics,
      shared: res.report.shared, constants: res.report.constants,
    } : null,
  };
  console.log(JSON.stringify(out, null, 1));
}
