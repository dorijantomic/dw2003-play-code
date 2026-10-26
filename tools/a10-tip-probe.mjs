// A10 debug 4: is the disc's op6 launch point the WEAPON TIP (not the bone base)?
import fs from "node:fs";
import path from "node:path";
import { restPose, rolesOf } from "../web/fight/anim-retarget.js";
const MODELS = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));

function tipAt(model, bone, frame) {
  const pose = restPose(model, frame);
  const R = pose.rot[bone], t = pose.pos[bone];
  const vs = model.bones[bone].verts || [];
  let best = null, bd = -1;
  for (const v of vs) {
    const x = -(R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) + t[0];
    const y = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
    const z = -(R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) + t[2];
    const d = Math.hypot(x - t[0], y - t[1], z - t[2]);
    if (d > bd) { bd = d; best = [x, y, z]; }
  }
  return { tip: best.map(Math.round), base: t.map(Math.round), len: Math.round(bd), verts: vs.length };
}
for (const [f, clip, want] of [["m369duke", 9, "op6 (-1024,7424,5248) => world (1024,-7424,-5248)"],
  ["m005grey", 9, "op6 (0,1664,3968)"], ["m441raiz", 9, "op6 (0,8320,-2854)"]]) {
  const m = read(f);
  const r = rolesOf(m);
  const prop = r.props[0]?.bone ?? (r.arms.find((a) => a.side === "right") ?? r.arms[0])?.chain.slice(-1)[0];
  const tab = m.actions[clip].ops.find((o) => o.op === 2 && (o.words[2] | 0) > 1)?.words[2] | 0;
  const vals = m.timeline[tab].table.map((e) => e.value | 0).filter((v) => v < 0x8000);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  let best = null;
  for (let k = 0; k <= 10; k++) {
    const fr = Math.round(lo + ((hi - lo) * k) / 10);
    const t = tipAt(m, prop, fr);
    if (!best || t.tip[1] < best.tip[1]) best = { ...t, fr };
  }
  console.log(`${f} clip ${clip} table ${tab} range ${lo}..${hi} prop bone ${prop}: highest tip ${JSON.stringify(best)}  want ${want}`);
}
