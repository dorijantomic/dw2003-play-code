// What a DW2 glTF carries inside: buffers, images, materials, clip names (no browser).
//   node tools/dw2_gltf_info.mjs <model.gltf>
import fs from "node:fs";

const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`${file}
  asset ${JSON.stringify(j.asset)}
  buffers ${(j.buffers || []).map((b, i) => `#${i} ${String(b.uri || "").slice(0, 42)}${String(b.uri || "").length > 42 ? "..." : ""} ${b.byteLength}`).join(" | ")}
  images  ${(j.images || []).map((im, i) => `#${i} ${im.name || ""} ${String(im.uri || "").slice(0, 42)}${String(im.uri || "").length > 42 ? "..." : ""} ${im.mimeType || ""}`).join(" | ")}
  textures ${(j.textures || []).length}  materials ${(j.materials || []).length}
  skins ${(j.skins || []).map((s) => `${s.name || ""} ${s.joints.length}j`).join(" | ")}
  animations ${(j.animations || []).map((a) => a.name).join(", ")}
  nodes ${j.nodes.length} meshes ${(j.meshes || []).length}`);
const mats = (j.materials || []).slice(0, 6).map((m) => `${m.name || "?"}:alpha=${m.alphaMode || "OPAQUE"} tex=${m.pbrMetallicRoughness?.baseColorTexture?.index ?? "-"}`);
console.log("  materials", mats.join(" | "));
const attrs = new Set();
for (const m of j.meshes || []) for (const p of m.primitives || []) for (const [k, v] of Object.entries(p.attributes || {})) attrs.add(`${k}:${j.accessors[v].componentType}x${j.accessors[v].type}`);
console.log("  attributes", [...attrs].join(", "));
