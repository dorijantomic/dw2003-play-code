// A10 gate survey: run the automatic retarget gate over every clip-9/13 gap row and print the table.
import fs from "node:fs";
import path from "node:path";
import { bakeRetarget, castGate, CAST_GATE } from "../web/fight/anim-retarget.js";
import { ANIM_DONOR_GAPS } from "../web/fight/anim-donor-map.js";

const ROOT = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(ROOT, "web/assets/battle/models");
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8"));
const folders = Array.isArray(index) ? index : index.models;

const rows = [];
for (const folder of folders) {
  const gaps = ANIM_DONOR_GAPS[folder];
  if (!gaps) continue;
  for (const clip of Object.keys(gaps)) {
    if (![9, 13].includes(Number(clip))) continue;
    const row = gaps[clip];
    const model = read(folder);
    if (model.actions?.[clip]?.ops?.length) continue;   // owns it: nothing to build
    const donor = read(row.d);
    if (!donor.actions?.[clip]?.ops?.length) { rows.push({ folder, clip, donor: row.d, err: "donor has no clip" }); continue; }
    const bake = bakeRetarget(model, donor, Number(clip), { offset: 6000 });
    if (!bake) { rows.push({ folder, clip, donor: row.d, err: "no bake (map/table)" }); continue; }
    bake.source = donor;
    const gate = castGate(bake);
    rows.push({ folder, clip, donor: row.d, ...gate });
  }
}
const used = rows.filter((r) => r.used).length;
console.log(JSON.stringify({ gate: CAST_GATE, rows: rows.length, used, fallback: rows.length - used }));
console.log("folder clip donor used reasons cov miss hand energy moved folds speed ankle ret motion");
for (const r of rows) {
  console.log([r.folder, r.clip, r.donor, r.used ? "USED" : "FALLBACK", (r.reasons ?? [r.err]).join("+"),
    r.covered ?? "-", (r.missing ?? []).length ? r.missing.join(",") : "-", r.hand ?? "-", r.energy ?? "-", r.moved ?? "-",
    r.folds ?? "-", r.speed ?? "-", r.ankle ?? "-", r.returnGap ?? "-", r.motion ?? "-"].join(" "));
}
fs.writeFileSync("/home/dorij/scratch-research/anim-a10-gate.json", JSON.stringify(rows, null, 1));
