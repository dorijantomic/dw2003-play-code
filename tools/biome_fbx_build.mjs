// glb (from fbx2glb) + PNG texture -> web/biome/assets/packs/oga/<id>.glb  (1K webp)
import fs from "node:fs"; import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core"; import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, textureCompress } from "@gltf-transform/functions";
const H = process.env.HOME, B = H + "/biome-tmp/fbx/", REPO = process.argv[2], io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const T1 = B + "TreeToonStylizedTextures_1/", T2 = B + "TreeToonStylizedTextures_2/";
const J = [
 { id: "ttoon_01_spring", glb: "t01", name: "Tree Toon Stylized 01", kind: "tree", tex: { "*": T1 + "TreeToonStylizedTexture(Spring).png" }, pg: "tree-toon-stylized" },
 { id: "ttoon_02_autumn", glb: "t02", name: "Tree Toon Stylized 02 (autumn)", kind: "tree", tex: { "*": T1 + "TreeToonStylizedTexture(AutumnExtreme).png" }, pg: "tree-toon-stylized" },
 { id: "ttoon_03_spring", glb: "t03", name: "Tree Toon Stylized 03", kind: "tree", tex: { "*": T1 + "TreeToonStylizedTexture(Spring).png" }, pg: "tree-toon-stylized" },
 { id: "ttoon_04_winter", glb: "t04", name: "Tree Toon Stylized 04 (winter)", kind: "snowtree", tex: { "*": T2 + "TreeToonStylizedTexture(Winter).png" }, pg: "tree-toon-stylized" },
 { id: "sinuous", glb: "sin", name: "Sinuous Toon Tree", kind: "tree", tex: { Bark: B + "sinuoustoontreetextures/SinuousTreeToonBarkTexture.png", LeavesAndAlpha: B + "sinuoustoontreetextures/SinuousTreeToonTexture.png" }, pg: "sinuous-toon-tree" },
 { id: "stoon_01", glb: "st", name: "Stylized Toon Tree 01", kind: "tree", tex: { "*": B + "treetoonstylized_01e/TreeToonStylized01/textures/TextureUVTreeToonStylizedStyle01.png" }, pg: "tree-stylized-toon" },
];
fs.mkdirSync(REPO + "/web/biome/assets/packs/oga", { recursive: true }); const res = [];
for (const j of J) {
  const doc = await io.read(B + "out/" + j.glb + ".glb"); let tris = 0;
  for (const m of doc.getRoot().listMaterials()) {
    const p = j.tex[m.getName()] || j.tex["*"]; if (!p) continue;
    const t = doc.createTexture(m.getName()).setImage(fs.readFileSync(p)).setMimeType("image/png");
    m.setBaseColorTexture(t).setBaseColorFactor([1, 1, 1, 1]).setDoubleSided(true);
    if (/Leaves/.test(m.getName())) m.setAlphaMode("MASK").setAlphaCutoff(0.5);
  }
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 84 }), prune());
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3;
  const rel = "packs/oga/" + j.id + ".glb"; await io.write(REPO + "/web/biome/assets/" + rel, doc);
  res.push({ ...j, tex: undefined, glb: undefined, rel, tris: Math.round(tris), bytes: fs.statSync(REPO + "/web/biome/assets/" + rel).size, url: "https://opengameart.org/content/" + j.pg });
}
fs.writeFileSync(H + "/biome-tmp/oga-results.json", JSON.stringify(res, null, 1)); console.log(res.map(r => r.id + " " + r.tris + " " + r.bytes).join("\n"));
