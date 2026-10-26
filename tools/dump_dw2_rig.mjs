// Dump a DW2 glTF's node tree + bind-pose world positions (no browser).
//   node tools/dump_dw2_rig.mjs <model.gltf>
import fs from "node:fs";
import { parseGltf, samplePose, poseBounds } from "/home/dorij/dw2003-play-anim/web/anim-viewer-dw2.js";

const file = process.argv[2];
const model = parseGltf(JSON.parse(fs.readFileSync(file, "utf8")));
const pose = samplePose(model, -1, 0);       // bind pose
const b = poseBounds(model, pose);
console.log("file", file);
console.log("bounds min", b.min.map((v) => v.toFixed(1)).join(" "), "max", b.max.map((v) => v.toFixed(1)).join(" "), "size", b.size.map((v) => v.toFixed(1)).join(" "));
console.log("node                          parent  mesh  world x,y,z                          scale");
model.json.nodes.forEach((n, i) => {
  const m = pose.world.subarray(i * 16, i * 16 + 16);
  const s = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
  const depth = (() => { let d = 0, p = model.parent[i]; while (p >= 0) { d++; p = model.parent[p]; } return d; })();
  console.log(
    `${String(n.name || "node" + i).padEnd(28)} ${String(model.parent[i]).padStart(6)}  ${String(n.mesh ?? "-").padStart(4)}  ` +
    `${[m[12], m[13], m[14]].map((v) => v.toFixed(1).padStart(8)).join(" ")}   ${s.map((v) => v.toFixed(2)).join(",")}  d${depth}` +
    `${n.translation ? "  t " + n.translation.map((v) => v.toFixed(1)).join(",") : ""}`,
  );
});
console.log("clips:", model.anims.map((a) => a.name).join(", "));
