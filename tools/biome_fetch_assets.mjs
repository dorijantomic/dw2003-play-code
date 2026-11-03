// Fetch + shrink the FREE assets of the biome gallery (web/biome/assets/**). Not disc data. Licences: CC0 only here
// (Quaternius Stylized Nature MegaKit Standard, Poly Haven). Writes web/biome/assets/CREDITS.md and manifest.json.
// Needs @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp: run it from a folder that has them in
// node_modules (copy this file there):   node biome_fetch_assets.mjs <repo> <megakit_dir> [only=substring]
//   <megakit_dir> = the unzipped "Stylized Nature MegaKit[Standard].zip" (https://quaternius.itch.io/stylized-nature-megakit)
// Poly Haven files come from https://api.polyhaven.com/files/<id> (needs a User-Agent header).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, weld, simplify, textureCompress, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const [repo, MK, only0 = ""] = process.argv.slice(2);
const MOUNTAIN = only0 === "mountain";       // "mountain" = fetch only the MOUNTAIN tab assets and MERGE into manifest.json / CREDITS.md
const LAKE = only0 === "lake";               // "lake" = fetch only the LAKE tab assets and MERGE into manifest.json / CREDITS.md
const BEACH = only0 === "beach" || LAKE || MOUNTAIN;     // "beach" = fetch only the BEACH tab assets and MERGE into manifest.json / CREDITS.md
const only = BEACH ? "" : only0;
const OUT = path.join(repo, "web/biome/assets");
const TMP = path.join(process.env.HOME, "biome-tmp/dl");
fs.mkdirSync(TMP, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const UA = { "User-Agent": "curl/8" };
const manifest = {};
const credits = [];

const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; } return Math.round(t); };

async function shrink(doc, { target = 0, tex = 1024 } = {}) {
  for (const mat of doc.getRoot().listMaterials()) { mat.setNormalTexture(null); mat.setOcclusionTexture(null); mat.setMetallicRoughnessTexture(null); mat.setEmissiveTexture(null); }
  await doc.transform(prune());
  const t0 = tris(doc);
  if (target && t0 > target) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: target / t0, error: 0.08, lockBorder: false }));
  }
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 82 }), prune());
  return t0;
}
async function emit(doc, rel, meta, opts) {
  if (only && !rel.includes(only)) return;
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t0 = await shrink(doc, opts);
  await io.write(file, doc);
  manifest[rel] = { tris: tris(doc), trisBefore: t0, bytes: fs.statSync(file).size };
  console.log(rel, t0, "->", manifest[rel].tris, Math.round(manifest[rel].bytes / 1024) + "KB");
}

// ---- Quaternius MegaKit (CC0), LOD0 as-is (textures 1024 webp), LOD1 simplified for trees ----
const Q = "Stylized Nature MegaKit (Standard) by Quaternius";
const QURL = "https://quaternius.itch.io/stylized-nature-megakit";
const qnames = BEACH ? [] : fs.readdirSync(path.join(MK, "glTF")).filter((f) => f.endsWith(".gltf")).map((f) => f.slice(0, -5));
for (const n of BEACH ? [] : qnames) {
  const lod = /^(CommonTree|TwistedTree|Pine|DeadTree)_/.test(n);
  await emit(await io.read(path.join(MK, "glTF", n + ".gltf")), `quaternius/${n}.glb`, null);
  if (lod) await emit(await io.read(path.join(MK, "glTF", n + ".gltf")), `quaternius/${n}_lod1.glb`, null, { target: 600 });
  credits.push([`${n}`, Q, "CC0 1.0", QURL]);
}

// ---- Poly Haven models (CC0) ----
const PH_MODELS = { fir_tree_01: [14000, 2500], fir_sapling_medium: [4500, 1200], dead_tree_trunk: [2500], dead_tree_trunk_02: [2500], tree_stump_01: [2000], tree_stump_02: [2000],
  pine_roots: [1800], root_cluster_01: [1500], root_cluster_02: [1500], single_root: [900], dry_branches_medium_01: [1200], bark_debris_01: [900],
  fern_02: [800], moss_01: [3000], dandelion_01: [700], celandine_01: [700], periwinkle_plant: [1200], shrub_01: [1500], shrub_02: [1200], shrub_03: [1200], shrub_04: [1200],
  boulder_01: [6000], rock_07: [1500], rock_09: [1500], stone_01: [1200], rock_moss_set_01: [2000], rock_moss_set_02: [2000], nettle_plant: [1200] };
async function get(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url + " " + r.status);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
// BEACH tab models (CC0): shells, dead wood, coastal rocks + cliffs, dune shrubs and succulents
const PH_MODELS_BEACH = { lambis_shell: [900], dead_quiver_branch_01: [1200], dead_quiver_branch_02: [1200], dead_quiver_trunk: [2000], sand_rocks_small_01: [1500],
  coast_rocks_01: [2500], coast_rocks_02: [2500], coast_rocks_03: [2500], coast_rocks_05: [2500], coast_land_rocks_02: [4000], coast_land_rocks_03: [4000], coast_land_rocks_04: [4000],
  coast_line_01: [6000], coast_line_02: [6000], coastal_cliff_01: [6000], coastal_cliff_02: [6000], coastal_cliff_04: [6000],
  searsia_burchellii: [1800], searsia_lucida: [1800], wild_rooibos_bush: [1800], cheiridopsis_succulent: [900], crystalline_iceplant: [900], leipoldtia_schultzei: [900],
  othonna_cerarioides: [900], didelta_spinosa: [1200], grass_bermuda_01: [800] };
// LAKE tab models (CC0): marsh/bank plants, wooden pier, boulders and stones for the shore
const PH_MODELS_LAKE = { grass_medium_01: [900], grass_medium_02: [900], weed_plant_02: [1200], shrub_sorrel_01: [1200], pachira_aquatica_01: [2500], tree_small_02: [3500],
  island_tree_01: [4000], modular_wooden_pier: [3500], namaqualand_boulder_02: [2500], namaqualand_boulder_03: [2500], namaqualand_boulder_04: [2500], namaqualand_stones_01: [2500] };
// MOUNTAIN tab models (CC0): cliffs and rock faces, boulders, young pines
const PH_MODELS_MOUNTAIN = { rock_face_01: [7000], rock_face_02: [7000], namaqualand_cliff_01: [7000], namaqualand_cliff_02: [7000], mountainside: [9000],
  namaqualand_boulder_05: [2500], namaqualand_boulder_06: [2500], namaqualand_boulders_01: [4000], namaqualand_rocks_01: [4000], pine_sapling_small: [3000], pine_sapling_medium: [4500] };
for (const [id, [t0, t1]] of Object.entries(MOUNTAIN ? PH_MODELS_MOUNTAIN : LAKE ? PH_MODELS_LAKE : BEACH ? PH_MODELS_BEACH : PH_MODELS)) {
  if (only && !id.includes(only)) continue;
  try {
    const f = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
    const g = f.gltf["1k"].gltf;
    const dir = path.join(TMP, "m_" + id);
    await get(g.url, path.join(dir, path.basename(g.url)));
    for (const [rel, v] of Object.entries(g.include)) await get(v.url, path.join(dir, rel));
    await emit(await io.read(path.join(dir, path.basename(g.url))), `polyhaven/${id}.glb`, null, { target: t0 });
    if (t1) await emit(await io.read(path.join(dir, path.basename(g.url))), `polyhaven/${id}_lod1.glb`, null, { target: t1 });
    credits.push([id, "Poly Haven model (decimated, 1K albedo only)", "CC0 1.0", `https://polyhaven.com/a/${id}`]);
  } catch (e) { console.log("SKIP model", id, String(e).slice(0, 120)); }
}

// ---- Poly Haven textures (CC0), diffuse 1K jpg ----
const PH_TEX = "forest_ground_04 forest_ground_05 forrest_ground_01 forest_floor forest_leaves_02 forest_leaves_03 leaves_forest_ground dry_decay_leaves brown_mud_leaves_01 mossy_rock rock_pitted_mossy lichen_rock grass_path_2 aerial_beach_01 sand_01 floor_pebbles_01 gravel_ground_01 rocky_terrain rocks_ground_01 snow_02 rock_boulder_cracked wood_chip_path".split(" ");
const PH_TEX_BEACH = "coast_sand_01 coast_sand_02 coast_sand_03 coast_sand_04 coast_sand_05 coast_sand_rocks_02 damp_beach_sand damp_beach_sand_02 damp_sand aerial_sand aerial_beach_02 aerial_beach_03 gravelly_sand shell_floor_01 low_tide_rocks seaside_rock large_pebbles pebbles".split(" ");
const PH_TEX_LAKE = "river_small_rocks ganges_river_pebbles pebble_ground_01 brown_mud brown_mud_02 brown_mud_03 coral_mud_01 aerial_mud_1 dry_riverbed_rock grass_ground mud_cracked_dry_riverbed_002 aerial_grass_rock".split(" ");
const PH_TEX_MOUNTAIN = "rock_face rock_face_03 rock_face_04 cliff_side rocky_terrain_02 rocky_terrain_03 rocky_trail rocks_ground_02 rocks_ground_04 rocky_gravel gravel_stones sandy_gravel_02 gray_rocks dark_rock aerial_rocks_02 snow_01 snow_03 snow_field_aerial".split(" ");
for (const id of MOUNTAIN ? PH_TEX_MOUNTAIN : LAKE ? PH_TEX_LAKE : BEACH ? PH_TEX_BEACH : PH_TEX) {
  if (only && !id.includes(only)) continue;
  try {
    const f = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
    const u = f.Diffuse["1k"].jpg.url;
    const file = path.join(OUT, "polyhaven/tex", id + "_diff_1k.jpg");
    await get(u, file);
    manifest[`polyhaven/tex/${id}_diff_1k.jpg`] = { bytes: fs.statSync(file).size };
    credits.push([`${id} (texture)`, "Poly Haven texture, 1K diffuse", "CC0 1.0", `https://polyhaven.com/a/${id}`]);
    console.log("tex", id, Math.round(fs.statSync(file).size / 1024) + "KB");
  } catch (e) { console.log("SKIP tex", id, String(e).slice(0, 120)); }
}

if (BEACH) {
  const mf = path.join(OUT, "manifest.json"), cf = path.join(OUT, "CREDITS.md");
  const old = JSON.parse(fs.readFileSync(mf, "utf8")); fs.writeFileSync(mf, JSON.stringify({ ...old, ...manifest }, null, 1));
  let md = fs.readFileSync(cf, "utf8"); const marker = "\nCode (MIT):", k = md.indexOf(marker);
  let rows = ""; for (const c of credits) if (!md.includes(`| ${c[0]} |`)) rows += `| ${c.join(" | ")} |\n`;
  fs.writeFileSync(cf, md.slice(0, k) + rows + md.slice(k));
} else if (!only) {
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  let md = "# Biome gallery asset credits\n\nOnly CC0 / MIT / CC-BY. Not disc data. Models were decimated and textures reduced to 1K webp by tools/biome_fetch_assets.mjs.\n\n| Item | Source | Licence | URL |\n|---|---|---|---|\n";
  for (const c of credits) md += `| ${c.join(" | ")} |\n`;
  md += "\nCode (MIT): three.js r186 (web/lib3d, GLTFLoader vendored in web/biome/vendor), EZ-Tree by Daniel Greenheck (web/lib3d/ez-tree.es.js), toon-light and wind ideas from web/built/shared.js of this repo.\nProcedural (no download, our code): mushrooms (lathe), ivy/vines, leaf litter, twigs, clouds, sky, fog, grass blades, birch via EZ-Tree.\n";
  fs.writeFileSync(path.join(OUT, "CREDITS.md"), md);
}
