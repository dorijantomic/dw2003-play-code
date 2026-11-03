// Poly Pizza picks (public static.poly.pizza GLB links from ~/biome-tmp/pp-pages.json, no key) -> web/biome/assets/packs/pp/*.glb + ~/biome-tmp/pp-results.json. Run from ~/biome-tmp: node biome_pp_fetch.mjs <repo> id:kind ...
import fs from "node:fs"; import { NodeIO } from "@gltf-transform/core"; import { ALL_EXTENSIONS } from "@gltf-transform/extensions"; import { flatten, prune, dedup } from "@gltf-transform/functions";
const H = process.env.HOME, REPO = process.argv[2], pages = JSON.parse(fs.readFileSync(H + "/biome-tmp/pp-pages.json")), io = new NodeIO().registerExtensions(ALL_EXTENSIONS), out = [];
const OUT = REPO + "/web/biome/assets/packs/pp"; fs.mkdirSync(OUT, { recursive: true });
for (const a of process.argv.slice(3)) {
  const [id, kind] = a.split(":"), p = pages[id]; if (!p?.glb || !/^CC0|^CC-BY/.test(p.lic)) { console.log("skip", id); continue; }
  const buf = Buffer.from(await (await fetch(p.glb)).arrayBuffer()); const doc = await io.readBinary(buf);
  for (const an of doc.getRoot().listAnimations()) an.dispose(); await doc.transform(flatten(), dedup(), prune());
  const slug = (p.title + "_" + p.creator + "_" + id.slice(0, 5)).toLowerCase().replace(/[^a-z0-9]+/g, "_"); await io.write(OUT + "/" + slug + ".glb", doc);
  out.push({ id: slug, name: p.title, kind, rel: "packs/pp/" + slug + ".glb", url: "https://poly.pizza/m/" + id, creator: p.creator, licence: p.lic, tris: p.tris, bytes: fs.statSync(OUT + "/" + slug + ".glb").size });
  console.log("OK", slug, p.tris, p.lic); await new Promise(s => setTimeout(s, 10000));
}
fs.writeFileSync(H + "/biome-tmp/pp-results.json", JSON.stringify(out, null, 1));
