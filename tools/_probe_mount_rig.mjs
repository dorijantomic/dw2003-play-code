// Probe: measure + pose + gait the mount model in plain node (no browser, no picture).
//   node tools/_probe_mount_rig.mjs
import fs from "node:fs";
import {
  parseDw2Gltf, measureRig, calibrateGait, bindPose, applyGait, updateWorld, poseBounds, gaitFootfalls,
} from "../web/mount3d.js";

const file = "web/dw2models/033UNIM.gltf";
const model = parseDw2Gltf(JSON.parse(fs.readFileSync(file, "utf8")));
const rig = measureRig(model);
console.log("nodes", model.nodes.length, "meshes", model.meshes.length, "clips", model.anims.map((a) => a.name).join(","));
console.log("height", rig.height.toFixed(1), "body", rig.body, "head", rig.head, "forward", rig.forward, "axis", rig.forwardAxis);
console.log("legs", rig.legs.map((L) => `${L.hip}->${L.end}(${L.depth})`).join(" "));
console.log("feet", rig.feet.join(","), "back", rig.back.toFixed(1));
const legs = calibrateGait(model, rig);
console.log("gait axes", legs.map((L) => `${L.hip} axis ${L.axis.map((v) => v.toFixed(2)).join(",")} sign ${L.sign} swing ${L.swing.toFixed(1)}`).join(" | "));
const falls = gaitFootfalls(model, rig, legs, 16);
const fwdIdx = rig.forwardAxis === "x" ? 0 : 2;
legs.forEach((L, i) => {
  const zs = falls.map((f) => f[i][fwdIdx]);
  const ys = falls.map((f) => f[i][1]);
  console.log(`  foot ${L.end}: swing ${(Math.max(...zs) - Math.min(...zs)).toFixed(1)} px along forward, lift ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}`);
});
// planted alternation: a true 4-beat gait has, at every moment, at least one foot near its lowest point
const lows = legs.map((L, i) => Math.min(...falls.map((f) => f[i][1])));
const ground = Math.min(...lows);
const plantedAt = falls.map((f) => legs.filter((L, i) => f[i][1] <= ground + 0.06 * rig.height).length);
console.log("feet on the ground per frame:", plantedAt.join(""));
