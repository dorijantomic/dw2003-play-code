// A10 debug 5: the prop tip across the donor cast table, against the disc's own op6 launch point
import fs from "node:fs";
import path from "node:path";
import { restPose, rolesOf } from "../web/fight/anim-retarget.js";
const MODELS = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
function tipAt(model, bone, frame) {
  const pose = restPose(model, frame);
  const R = pose.rot[bone], t = pose.pos[bone];
  const vs = model.bones[bone]?.verts || [];
  let best = null, bd = -1;
  for (const v of vs) {
    const x = -(R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) + t[0];
    const y = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
    const z = -(R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) + t[2];
    const d = Math.hypot(x - t[0], y - t[1], z - t[2]);
    if (d > bd) { bd = d; best = [x, y, z]; }
  }
  return { tip: best.map(Math.round), len: Math.round(bd) };
}
for (const [f, clip] of [["m369duke", 9], ["m005grey", 9]]) {
  const m = read(f);
  const r = rolesOf(m);
  const prop = r.props[0]?.bone ?? (r.arms.find((a) => a.side === "right") ?? r.arms[0])?.chain.slice(-1)[0] ?? 1;
  const tab = m.actions[clip].ops.find((o) => o.op === 2 && (o.words[2] | 0) > 1)?.words[2] | 0;
  const vals = m.timeline[tab].table.map((e) => e.value | 0).filter((v) => v < 0x8000);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const op6 = m.actions[clip].ops.find((o) => o.op === 6 && (o.words[0] | 0) === 0)?.words ?? [];
  console.log(`${f} clip ${clip} prop ${prop} table ${lo}..${hi} op6 raw ${JSON.stringify(op6)} => world (${-op6[2]},${-op6[3]},${-op6[4]})`);
  for (let k = 0; k <= 10; k++) {
    const fr = Math.round(lo + ((hi - lo) * k) / 10);
    const t = tipAt(m, prop, fr);
    console.log(`   frame ${fr}: tip ${t.tip.join("/")} len ${t.len}`);
  }
}
