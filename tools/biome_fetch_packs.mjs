// Step 5 (anime set). KayKit Forest (CC0, itch free tier) -> curated GLBs in web/biome/assets/packs/. Zips unpacked to ~/biome-tmp/free/{kk}. Run from ~/biome-tmp: node biome_fetch_packs.mjs <repo>
import fs from "node:fs"; import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core"; import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, weld, simplify, textureCompress, dedup, flatten } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
const H = process.env.HOME, REPO = process.argv[2], F = H + "/biome-tmp/free";
await MeshoptSimplifier.ready; const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; } return Math.round(t); };
const KK = F + "/kk/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/";
const kk = [["Tree_1_A","tree"],["Tree_2_A","tree"],["Tree_2_C","tree"],["Tree_3_A","tree"],["Tree_4_A","tree"],["Tree_Bare_1_A","deadtree"],["Tree_Bare_2_A","deadtree"],["Bush_1_A","bush"],["Bush_2_A","bush"],["Bush_3_A","bush"],["Bush_4_A","bush"],["Grass_1_A","grass"],["Grass_2_A","grass"],["Rock_1_A","rock"],["Rock_1_E","rock"],["Rock_2_A","rock"],["Rock_3_A","rock"],["Rock_3_H","rock"]].map(([n,k]) => ({ pack: "kaykit", file: KK + n + "_Color1.gltf", name: n.replace(/_/g, " "), id: n, kind: k }));
const out = []; fs.mkdirSync(REPO + "/web/biome/assets/packs/kaykit", { recursive: true });
for (const it of kk) {
  try {
    const doc = await io.read(it.file);
    for (const m of doc.getRoot().listMaterials()) { m.setNormalTexture(null); m.setOcclusionTexture(null); m.setMetallicRoughnessTexture(null); m.setEmissiveTexture(null); }
    await doc.transform(flatten(), prune()); const t0 = tris(doc);
    if (t0 > 30000) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 30000 / t0, error: 0.05 }));
    await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 84 }), prune());
    const rel = `packs/${it.pack}/${it.id}.glb`; await io.write(REPO + "/web/biome/assets/" + rel, doc);
    out.push({ ...it, file: undefined, rel, tris: tris(doc), bytes: fs.statSync(REPO + "/web/biome/assets/" + rel).size });
  } catch (e) { console.log("FAIL", it.id, String(e.message).slice(0, 80)); }
}
fs.writeFileSync(H + "/biome-tmp/pack-results.json", JSON.stringify(out, null, 1)); console.log(out.length, "packs items");
