// A10 probe: (a) op6 spawn convention vs the weapon bone's world position; (b) cast table binds per clip 9/13.
import fs from "node:fs";
import { restPose, rolesOf } from "../web/fight/anim-retarget.js";
const ROOT = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
const read = (f) => JSON.parse(fs.readFileSync(`${ROOT}/${f}/anim.json`, "utf8"));

for (const f of ["m369duke", "m441raiz", "m190bolt", "m005grey", "m178kngt"]) {
  const m = read(f);
  const r = rolesOf(m);
  const pose = restPose(m, 0);
  const props = r.props.map((p) => ({ bone: p.bone, side: p.side, pos: pose.pos[p.bone].map((v) => Math.round(v)) }));
  const arms = r.arms.map((a) => ({ side: a.side, tip: a.chain[a.chain.length - 1], pos: pose.pos[a.chain[a.chain.length - 1]].map((v) => Math.round(v)) }));
  console.log(`== ${f} h=${Math.round(r.box.h)} props=${JSON.stringify(props)} armTips=${JSON.stringify(arms)}`);
  for (const c of [9, 13]) {
    const s = m.actions?.[c];
    if (!s) continue;
    const binds = (s.ops || []).filter((o) => o.op === 2 && (o.words[0] | 0) === 0 && (o.words[2] | 0) > 1).map((o) => o.words[2] | 0);
    const shot = (s.ops || []).filter((o) => o.op === 6);
    console.log(`   clip ${c} binds=${JSON.stringify(binds)} op6=${JSON.stringify(shot.map((o) => o.words))}`);
  }
}

// (b) across all models: donors' clip-9/13 binds and how many op6 they carry
const index = JSON.parse(fs.readFileSync(`${ROOT}/index.json`, "utf8"));
const folders = Array.isArray(index) ? index : index.models;
const multi = [], none = [], shots = new Map();
for (const f of folders) {
  const m = read(f);
  for (const c of [9, 13]) {
    const s = m.actions?.[c];
    if (!s?.ops?.length) continue;
    const binds = s.ops.filter((o) => o.op === 2 && (o.words[0] | 0) === 0 && (o.words[2] | 0) > 1).map((o) => o.words[2] | 0);
    const sh = s.ops.filter((o) => o.op === 6 && (o.words[0] | 0) === 0).length;
    if (binds.length > 1) multi.push(`${f}:${c}=${binds.join("+")}`);
    if (!binds.length) none.push(`${f}:${c}`);
    shots.set(sh, (shots.get(sh) ?? 0) + 1);
  }
}
console.log("== authored clip 9/13 with >1 body table:", multi.length, multi.slice(0, 12).join(" "));
console.log("== authored clip 9/13 with NO body table:", none.length, none.slice(0, 12).join(" "));
console.log("== op6 launch count histogram:", JSON.stringify([...shots.entries()].sort((a, b) => a[0] - b[0])));
