// Build web/biome/assets/anime.json (gallery catalog) + append CREDITS.md / manifest.json rows for the anime set.
// Inputs: ~/biome-tmp/sf-results.json (tools/biome_fetch_anime.mjs) and ~/biome-tmp/pack-results.json (tools/biome_fetch_packs.mjs).
// usage: node biome_build_anime_catalog.mjs <repo>
import fs from "node:fs";
const H = process.env.HOME, REPO = process.argv[2], A = REPO + "/web/biome/assets/";
const sf = JSON.parse(fs.readFileSync(H + "/biome-tmp/sf-results.json")), pk = JSON.parse(fs.readFileSync(H + "/biome-tmp/pack-results.json"));
const oga = fs.existsSync(H + "/biome-tmp/oga-results.json") ? JSON.parse(fs.readFileSync(H + "/biome-tmp/oga-results.json")) : [];   // tools/biome_fbx_build (three FBXLoader) OpenGameArt CC0 toon trees
const kindOf = (n) => {
  const s = n.toLowerCase();
  if (/willow/.test(s) && !/(wind in|bow|saber|mask)/.test(s)) return "willow";
  if (/lupine|flower set|flowers?.*pack/.test(s)) return "flower";
  if (/(pack|kit\b|collection|\bset\b|scene|diorama|assets?\b|environment|vegitation|patio|river|bridge|terrain_|terrain\b.*pack|forest\b)/.test(s) && !/(pine tree and bush|single)/.test(s)) return "kit";
  if (/(snow|winter|frozen|fir tree set)/.test(s) && /(tree|pine|fir|cedar)/.test(s)) return "snowtree";
  if (/(palm|coconut)/.test(s)) return "palm";
  if (/(cherry|sakura)/.test(s)) return "cherry";
  if (/willow/.test(s)) return "willow";
  if (/(lily|lotus)/.test(s)) return "lily";
  if (/(cattail|reed|bulrush)/.test(s)) return "reed";
  if (/(seaweed|kelp)/.test(s)) return "seaweed";
  if (/coral/.test(s)) return "other";
  if (/mushroom/.test(s)) return "mushroom";
  if (/(shell|conch)/.test(s)) return "shell";
  if (/(dead tree|dead_tree)/.test(s)) return "deadtree";
  if (/(log|stump|driftwood|trunk)/.test(s)) return "wood";
  if (/(\bpine|cedar|spruce|\bfir\b|conifer)/.test(s)) return "pine";
  if (/(tree|ginkgo|birch|oak)/.test(s)) return "tree";
  if (/grass/.test(s)) return "grass";
  if (/(bush|shrub|hedge)/.test(s)) return "bush";
  if (/(flower|lupine|dandelion|edelweiss|lavender|gentian|heather|daisy|crocus|primrose|bellflower)/.test(s)) return "flower";
  if (/(fern|plant|foliage|folliage|ivy|vine|vegetation|clover)/.test(s)) return "plant";
  if (/(cliff|basalt|island|terrain|modular)/.test(s)) return "cliff";
  if (/(rock|stone|boulder)/.test(s)) return "rock";
  return "other";
};
// multi-tree sets / lying models measured by bounds (height < 0.7 x width, or longest axis not up): grid only, never scattered
const NO_SCATTER = ["mandrake_3d_stylized_cedar", "myhnea15_stylized_snowy", "evan4129_snow_pine", "galaxxxy_palm", "valuefindstore_palms", "queshoo_stylized_dead", "borsh_and_date_palm", "pierre_c_edelweiss"];
const pp = fs.existsSync(H + "/biome-tmp/pp-results.json") ? JSON.parse(fs.readFileSync(H + "/biome-tmp/pp-results.json")) : [];   // tools/biome_pp_fetch.mjs (Poly Pizza public GLB, CC-BY 3.0)
const cat = [], credit = [];
for (const [uid, r] of Object.entries(sf)) {
  if (!r.ok) continue;
  const kind = r.mtn ? "mountain" : kindOf(r.name);
  cat.push({ id: r.slug, name: r.name, kind, rel: "sketchfab/" + r.slug + ".glb", author: r.disp || r.author, user: r.author, licence: r.lic === "cc0" ? "CC0 1.0" : "CC-BY 4.0", url: r.url, tris: r.tris, bytes: r.bytes, noScatter: kind === "kit" || kind === "other" || NO_SCATTER.some((p) => r.slug.startsWith(p)) });
  credit.push(`| ${r.name} | Sketchfab by ${r.disp || r.author} (@${r.author}) | ${r.lic === "cc0" ? "CC0 1.0" : "CC-BY 4.0"} | ${r.url} |`);
}
const PN = { kaykit: ["KayKit Forest Nature Pack 1.0 (Kay Lousberg)", "https://kaylousberg.itch.io/kaykit-forest"] };
for (const p of pk) {
  cat.push({ id: p.pack + "_" + p.id, name: p.name, kind: p.kind, rel: p.rel, pack: p.pack, packName: PN[p.pack][0], licence: "CC0 1.0", url: PN[p.pack][1], tris: p.tris, bytes: p.bytes });
  credit.push(`| ${p.id} | ${PN[p.pack][0]} | CC0 1.0 | ${PN[p.pack][1]} |`);
}
for (const o of oga) {
  cat.push({ id: "oga_" + o.id, name: o.name, kind: o.kind, rel: o.rel, pack: "oga", packName: "OpenGameArt: " + o.name + " (CC0)", licence: "CC0 1.0", url: o.url, tris: o.tris, bytes: o.bytes });
  credit.push(`| ${o.name} | OpenGameArt (converted FBX to GLB with three.js FBXLoader) | CC0 1.0 | ${o.url} |`);
}
for (const o of pp) {
  cat.push({ id: "pp_" + o.id, name: o.name, kind: o.kind, rel: o.rel, pack: "pp", packName: "Poly Pizza: " + o.name + " by " + o.creator, licence: o.licence, url: o.url, tris: o.tris, bytes: o.bytes });
  credit.push(`| ${o.name} | Poly Pizza by ${o.creator} (public GLB, no key) | ${o.licence} | ${o.url} |`);
}
fs.writeFileSync(A + "anime.json", JSON.stringify(cat));
let cr = fs.readFileSync(A + "CREDITS.md", "utf8"); const i = cr.indexOf("\n## Anime set"); if (i >= 0) cr = cr.slice(0, i);
cr = cr.replace(/\s+$/, "") + "\n\n## Anime set (Sketchfab CC-BY + CC0 packs; models decimated to <= 30k tris, textures 1K webp by tools/biome_fetch_anime.mjs / biome_fetch_packs.mjs)\n\nCC-BY 4.0 items: credit the author as listed. Licence re-checked from the Sketchfab API at download time.\n\n| Item | Source / author | Licence | URL |\n|---|---|---|---|\n" + credit.join("\n") + "\n";
fs.writeFileSync(A + "CREDITS.md", cr);
const mf = JSON.parse(fs.readFileSync(A + "manifest.json")); for (const c of cat) mf[c.rel] = { tris: c.tris, bytes: c.bytes }; fs.writeFileSync(A + "manifest.json", JSON.stringify(mf, null, 1));
const k = {}; for (const c of cat) k[c.kind] = (k[c.kind] || 0) + 1; console.log(cat.length, JSON.stringify(k));
