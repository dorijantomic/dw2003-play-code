#!/usr/bin/env node
// Build the viewer's two small generated data files from the A10 evidence tables.
//
//   /home/dorij/scratch-research/anim-a10-gate.json   -> web/anim-gate.json            (per folder/clip verdict)
//   /home/dorij/scratch-research/anim-contract.json   -> web/anim-contract-index.json  (per folder/clip/side counts)
//
// The contract is 20 MB of one row per (species x technique x side x outcome); the viewer only needs
// the verdict for the case on screen, so this script folds it down to per (folder, clip, side)
// case counts and per-invariant failure counts — the same numbers, ~200 kB. Only model folder names,
// clip numbers and invariant names are carried: no disc animation data, nothing per species.
//
// Usage: node tools/build_anim_viewer_data.mjs [--gate <path>] [--contract <path>] [--out <dir>]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const GATE = opt("--gate", "/home/dorij/scratch-research/anim-a10-gate.json");
const CONTRACT = opt("--contract", "/home/dorij/scratch-research/anim-contract.json");
const OUT = resolve(ROOT, opt("--out", "web"));

const INVARIANTS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];

const gate = JSON.parse(await readFile(GATE, "utf8"));
// Keep the fields the panel prints; drop the sample-specific ones the gate used for its own report.
const gateOut = gate.map((r) => ({
  folder: r.folder, clip: String(r.clip), donor: r.donor ?? null, used: !!r.used,
  reasons: r.reasons ?? [], covered: r.covered ?? null, missing: r.missing ?? [],
  hand: r.hand ?? null, energy: r.energy ?? null, moved: r.moved ?? null,
  folds: r.folds ?? null, speed: r.speed ?? null, ankle: r.ankle ?? null,
  returnGap: r.returnGap ?? null, motion: r.motion ?? null, err: r.err ?? null,
}));

const contract = JSON.parse(await readFile(CONTRACT, "utf8"));
const byFolder = {};
let rows = 0;
for (const r of contract.rows || []) {
  if (!r.model || r.clip == null || !r.side) continue;
  rows++;
  const f = (byFolder[r.model] ||= {});
  const c = (f[String(r.clip)] ||= {});
  const s = (c[r.side] ||= { cases: 0, fail: {}, builds: {}, scripts: {} });
  s.cases++;
  if (r.build) s.builds[r.build] = (s.builds[r.build] || 0) + 1;
  if (r.script) s.scripts[r.script] = (s.scripts[r.script] || 0) + 1;
  for (const inv of INVARIANTS) if (r[inv] === false) s.fail[inv] = (s.fail[inv] || 0) + 1;
}
const index = {
  generated: contract.summary?.generated ?? null,
  source: "anim-contract.json (A10 C1-C10, one row per species x technique x side x outcome)",
  invariantNames: {
    C1: "hit count = technique hits", C2: "reaction pairing", C3: "target class",
    C4: "effect anchor", C5: "locomotion / ends", C6: "projectile origin",
    C7: "body motion", C8: "camera frames both", C9: "side symmetry", C10: "items",
  },
  summary: contract.summary || null,
  rows,
  byFolder,
};

await writeFile(resolve(OUT, "anim-gate.json"), JSON.stringify(gateOut) + "\n");
await writeFile(resolve(OUT, "anim-contract-index.json"), JSON.stringify(index) + "\n");
const mb = (n) => (n / 1024).toFixed(1) + " kB";
console.log(`web/anim-gate.json            ${gateOut.length} rows, ${mb(JSON.stringify(gateOut).length)}`);
console.log(`web/anim-contract-index.json  ${rows} cases -> ${Object.keys(byFolder).length} folders, ${mb(JSON.stringify(index).length)}`);
