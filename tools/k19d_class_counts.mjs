// Counts for the report: candidates per class, and which techniques would exercise R3's COMBINED branch
// (shots rule "single" with two or more emitters) among the still-planted rows.
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync("/home/dorij/scratch-research/anim-k19d-select.json", "utf8"));
const cls = new Map();
const combined = [];
for (const r of rows) for (const s of r.spells) {
  const c = s.emitterClass;
  const e = cls.get(c) || { models: new Set(), plantedModels: new Set(), plantedRows: 0, rows: 0 };
  e.models.add(r.folder); e.rows++;
  if (s.planted) { e.plantedModels.add(r.folder); e.plantedRows++; }
  cls.set(c, e);
  if (s.planted && s.shots === "single" && (s.emitters || []).length >= 2) combined.push({ folder: r.folder, name: r.name, tech: s.name, techId: s.techId, emitters: s.emitters, size: r.size });
}
for (const [c, e] of [...cls.entries()].sort()) console.log(`${c}: ${e.models.size} models (${e.plantedModels.size} with a planted spell), ${e.rows} rows, ${e.plantedRows} planted`);
console.log(`\ncombined-branch candidates (single rule, 2+ emitters): ${combined.length}`);
for (const x of combined.slice(0, 20)) console.log(`  ${x.folder} ${x.name} tech ${x.techId} ${x.tech} emitters ${x.emitters.join("+")} [${x.size}]`);
