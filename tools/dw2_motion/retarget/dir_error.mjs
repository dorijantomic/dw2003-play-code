// dir_error.mjs — what you SEE: do our limbs point where DW2's limbs point? For every paired bone that has a paired child, the direction bone-origin -> child-origin
// In the repo since 2026-10-26 (from the private research prototype): paths come from ./paths.mjs, the logic is unchanged.
// at several poses, DW2 (turned into our frame when DW2 faces the other way) against ours. Reports the mean and worst angle per species.
//   node dir_error.mjs <map.json> <dw2 clip index> <out dir with report.json> [ticks-per-pose | targets.json]
import fs from "node:fs"; import os from "node:os";
import * as D from "./dwr.mjs";
import { dw2Path, fightModule } from "./paths.mjs";
const fa = await import(fightModule("firing-axis.js"));
const [mapPath, clipS, dir, tppS] = process.argv.slice(2);
const M = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const src = JSON.parse(fs.readFileSync(dw2Path(M.dw2.id), "utf8"));
const rep = JSON.parse(fs.readFileSync(`${dir}/report.json`, "utf8")), model = JSON.parse(fs.readFileSync(`${dir}/${M.ours.folder}/anim.json`, "utf8"));
const ENDS = tppS && tppS.endsWith(".json") ? JSON.parse(fs.readFileSync(tppS, "utf8")).ends : null, TPP = +(tppS && !tppS.endsWith(".json") ? tppS : 2);
const facingFlip = !!M.flipDw2;
const restF = Math.min(...model.timeline[0].table.map((e) => e.value).filter((v) => v >= 0 && v < 0x8000));
const oursRest = D.K.k16Pose(model, restF).P, dwRestF = Math.min(...src.timeline[0].table.map((e) => e.value).filter((v) => v >= 0 && v < 0x8000)), dwRestP = fa.poseFromChannels(src, dwRestF).pos;
const xTol = 0.02 * Math.max(...oursRest.map((p) => Math.abs(p[0])));
const mism = (o, dd) => { const xo = oursRest[o][0], xd = (facingFlip ? -1 : 1) * dwRestP[dd][0]; return Math.abs(xo) > xTol && Math.abs(xd) > xTol && Math.sign(xo) !== Math.sign(xd); };
const tableOf = (c) => src.actions[c].ops.find((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1)?.words[2] ?? src.clips[c].table;
const fr = src.timeline[tableOf(+clipS)].table.map((e) => e.value).filter((v) => v >= 0 && v < 0x8000), lo = Math.min(...fr), hi = Math.max(...fr);
const partner = new Map(M.pairs), kids = new Map();   // our bone -> our paired child (first)
const par = model.bones.map((b) => (b.parent_slot | 0) - 1);
for (const [o] of M.pairs) { const p = par[o]; if (p >= 0 && partner.has(p) && !kids.has(p)) kids.set(p, o); }
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const errs = [], perBone = {};
const total = hi - lo;
for (const k of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((f) => Math.round(total * f))) {
  const dw = fa.poseFromChannels(src, lo + k).pos, tick = Math.min(rep.ticks, ENDS ? ENDS[k] : k * TPP + TPP - 1), us = D.K.k16Pose(model, rep.offset + tick).P;
  for (const [p, c] of kids) {
    const a = partner.get(p), b = partner.get(c);
    let dd = [dw[b][0] - dw[a][0], dw[b][1] - dw[a][1], dw[b][2] - dw[a][2]]; if (facingFlip) dd = [-dd[0], dd[1], -dd[2]]; if (mism(p, a)) dd = [-dd[0], dd[1], dd[2]];
    const du = [us[c][0] - us[p][0], us[c][1] - us[p][1], us[c][2] - us[p][2]];
    if (Math.hypot(...dd) < 1e-6 || Math.hypot(...du) < 1e-6) continue;
    const e = angle(unit(dd), unit(du)); errs.push(e); (perBone[p] ??= []).push(e);
  }
}
const mean = errs.reduce((s, x) => s + x, 0) / Math.max(1, errs.length);
const worst = Object.entries(perBone).map(([b, v]) => [b, v.reduce((s, x) => s + x, 0) / v.length]).sort((x, y) => y[1] - x[1]).slice(0, 4);
console.log(`dirErr ${mean.toFixed(1)} deg mean over ${errs.length} segments; worst bones: ${worst.map(([b, v]) => b + ":" + v.toFixed(0)).join(" ")}`);
