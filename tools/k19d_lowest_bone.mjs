// Which bone owns the lowest vertex of a model at rest, and its role — so a "the body left the floor"
// number can be read correctly (a foot lifting is a bug; a wing tip lifting is the motion).
import fs from "node:fs";
import path from "node:path";
const ROOT = "/home/dorij/dw2003-play-anim";
const FA = await import(path.join(ROOT, "web/fight/firing-axis.js"));
const AC = await import(path.join(ROOT, "web/fight/anim-collision.js"));
for (const folder of process.argv.slice(2)) {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/battle/models", folder, "anim.json"), "utf8"));
  model.folder = folder;
  const pose = FA.restPoseOf(model);
  let lo = -Infinity, bone = -1;
  for (let i = 0; i < model.bones.length; i++) {
    for (const v of model.bones[i].verts || []) {
      const y = FA.vertexWorld(model, i, v, pose)[1];
      if (y > lo) { lo = y; bone = i; }
    }
  }
  const rig = AC.rigColliders(model, folder);
  const role = rig?.colliders?.find((c) => c.bone === bone)?.role ?? "no collider";
  console.log(`${folder}: lowest vertex at rest on bone ${bone}, role ${role}`);
}
