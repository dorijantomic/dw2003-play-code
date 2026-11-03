// MOUNTAIN tab: asset grid entries + the assembled mountain scene (alpine meadow valley with a stream, tarn and waterfall at the origin, conifer belt, krummholz,
// scree, cliffs, snowfields and glacier on the massif to -z, layered distant ranges, cloud sea, blowing snow). Follows lake.js: entries[] for Grid mode,
// buildMountain(ctx) for Biome mode. Terrain law: mtlaw.js. Procedural assets + shaders: mountainproc.js.
import * as THREE from "three";
import { toonMat, composeTRS, instancedParts, LODSpecies, bakeImpostor, rng, tris, skyMaterial, CullSet, U } from "./toolkit.js";
import { loadToon, partsGroup, loadTex } from "./loader.js";
import * as P from "./procedural.js";
import * as MP from "./mountainproc.js";
import * as M from "./mtlaw.js";
import { q, ph, proc, texDisc, ASSETS, ezTreeParts } from "./forest.js";

const { mtH, mtInfo, waterDist, sstep, vnoise } = M;
const PS = "Poly Haven (decimated, 1K albedo)", CC0 = "CC0 1.0", OWN = "Procedural (our code)", EZ = "EZ-Tree by Daniel Greenheck (generated live)";
const T = (id) => loadTex(`${ASSETS}polyhaven/tex/${id}_diff_1k.jpg`);
let _gt = null;
const groundTex = () => _gt || (_gt = Promise.all(["aerial_grass_rock", "rock_face", "rocky_gravel", "snow_field_aerial", "lichen_rock"].map(T)).then(([grass, rock, scree, snow, lichen]) => ({ grass, rock, scree, snow, lichen })));
const gmat = async (o) => MP.mountainGround(await groundTex(), o);
const part = (parts) => partsGroup(parts);

// ------------------------------------------------------------------ terrain tiles in real world coordinates
function tile(mat, x0, x1, z0, z1, cell, extra) {
  const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d, Math.max(2, Math.round(w / cell)), Math.max(2, Math.round(d / cell)));
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, mtH(p.getX(i), p.getZ(i)) + (extra ? extra(p.getX(i), p.getZ(i)) : 0));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat); m.name = "ground"; return m;
}
const slab = async (x0, x1, z0, z1, cell, extra = [], o = {}) => { const g = new THREE.Group(); g.add(tile(await gmat(o), x0, x1, z0, z1, cell)); for (const e of extra) g.add(e); return g; };
function fld(parts, n, rad, sc, seed, base = 0x5c6b3e, y = 0.04) {
  const g = new THREE.Group(), r = rng(seed), m = new Float32Array(n * 16), b = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.05, rad * 1.05, 0.05, 44), toonMat({ color: base }, { shadeK: 0.82, rim: 0 })); b.position.y = 0.025; g.add(b);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; composeTRS(m, i, Math.cos(a) * d, y, Math.sin(a) * d, r() * 6.28, sc[0] + (sc[1] - sc[0]) * r()); }
  g.add(instancedParts(parts, m, n)); return g;
}
const MEAD = 0x6a7f3c, ROCKB = 0x7d7a76, SNOWB = 0xe9f1fa, SCREEB = 0x8b8780;
const wx = (res, o) => { MP.weather(res.parts, o); return res; };

// ------------------------------------------------------------------ grid entries
const cat = { terr: "Mountain terrain", snow: "Snow, ice, glacier", cliff: "Cliffs and rock faces", crag: "Crags, spires, boulders", scree: "Scree, talus, gravel", ground: "Rock and ground textures",
  meadow: "Alpine meadow grass and flowers", cover: "Lichen, moss, dwarf shrubs", conif: "Conifers: spruce, fir, larch", krum: "Krummholz and dwarf pines", dead: "Dead silver snags", water: "Stream, waterfall, tarn", air: "Ranges, clouds, snow in the air" };
const mp = (id, c, name, make, extra = {}) => proc(id, c, name, make, { url: "web/biome/mountainproc.js", ...extra });
const ph2 = (id, c, name, t = {}, extra = {}) => ph(id, c, { name, t: { grade: true, ...t }, e: extra });
const ez = (id, c, name, preset, seed, over, h) => ({ id: "ez_" + id, cat: c, name, source: EZ, licence: "MIT", url: "https://github.com/dgreenheck/ez-tree", noSpin: false, make: async () => part(ezTreeParts(preset, seed, over, h)) });
const SPRUCE = { bark: { tint: 0x5a4636 }, leaves: { tint: 0x2e5f4a } }, LARCH = { bark: { tint: 0x7a5a42 }, leaves: { tint: 0xb2c25a } }, SPRUCE2 = { bark: { tint: 0x4f3d30 }, leaves: { tint: 0x3a6b52 } };
const screeField = async () => { const g = new THREE.Group(), r = rng(3), b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 44), toonMat({ color: SCREEB }, { shadeK: 0.82, rim: 0 })); b.position.y = 0.025; g.add(b);
  for (let k = 1; k <= 2; k++) { const m = new Float32Array(9 * 16); for (let i = 0; i < 9; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 1.1; composeTRS(m, i, Math.cos(a) * d, 0.05, Math.sin(a) * d, r() * 6.28, 0.9 + 0.5 * r()); } g.add(instancedParts(MP.screeParts(k), m, 9)); }
  return g; };
const stoneRes = async (id, o = {}) => wx(await loadToon(`${ASSETS}polyhaven/${id}.glb`, { grade: true, ...(o.t || {}) }), o.w);
const qRes = async (id, o = {}) => wx(await loadToon(`${ASSETS}quaternius/${id}.glb`, o.t || {}), o.w);
const rockEntry = (id, c, name, w = {}, t = {}) => ({ id: "mr_" + id, cat: c, name, source: PS + " + our weather shader (snow dust, lichen)", licence: CC0, url: `https://polyhaven.com/a/${id}`, noSpin: false, make: async () => part((await stoneRes(id, { w, t })).parts) });

const rawEntries = [
  // ---- terrain
  mp("t_slab_meadow", cat.terr, "Terrain tile: meadow valley with stream (heightmap, slope/altitude splat)", async () => slab(-20, 20, -34, 6, 0.6, [MP.streamMesh(-34, 6, 0.5)]), { noSpin: true }),
  mp("t_slab_forest", cat.terr, "Terrain tile: conifer-belt slope (grass, scree, lichen rock)", async () => slab(-60, -20, -150, -110, 1.0), { noSpin: true }),
  mp("t_slab_rock", cat.terr, "Terrain tile: ridged rock massif with gullies and strata ledges", async () => slab(-90, -40, -220, -170, 1.2), { noSpin: true }),
  mp("t_slab_snow", cat.terr, "Terrain tile: snow line, snowfields and ice patches", async () => slab(-20, 40, -300, -240, 1.4), { noSpin: true }),
  mp("t_peak", cat.terr, "Peak with snow cap (main massif, 300 m block, coarse)", async () => slab(-110, 130, -330, -100, 5), { noSpin: true }),
  mp("t_ridge", cat.terr, "Eroded ridges: gullies running downhill, terraced ledges", async () => slab(60, 140, -180, -100, 1.6), { noSpin: true }),
  // ---- snow, ice, glacier
  ...["snow_01", "snow_02", "snow_03", "snow_field_aerial"].map((id) => ({ ...texDisc(id, cat.snow, "Snow material: " + id), id: "mt_tex_" + id })),
  mp("snowdrift", cat.snow, "Snow drift (wind-sculpted mound, sastrugi ripples)", async () => part(MP.snowDriftParts(1)), { noSpin: false }),
  mp("snowcap", cat.snow, "Snow cap on a crag (weather shader: up-facing snow)", async () => { const p = MP.cragParts(2, { h: 3 }); MP.weather(p, { snow: 0.9 }); return part(p); }),
  mp("glacier", cat.snow, "Glacier tongue (crevasses, moraine edge, seracs)", async () => part(MP.glacierParts(1)), { noSpin: false }),
  mp("glacier2", cat.snow, "Glacier tongue B", async () => part(MP.glacierParts(2)), { noSpin: false }),
  // ---- cliffs and rock faces
  ph2("rock_face_01", cat.cliff, "Rock face 01", {}), ph2("rock_face_02", cat.cliff, "Rock face 02", {}),
  ph2("namaqualand_cliff_01", cat.cliff, "Cliff 01 (Namaqualand)", {}), ph2("namaqualand_cliff_02", cat.cliff, "Cliff 02 (Namaqualand)", {}), ph2("mountainside", cat.cliff, "Mountainside", {}),
  mp("cliff1", cat.cliff, "Cliff face A (strata ledges, columns, stains, talus foot)", async () => part(MP.cliffParts(1))),
  mp("cliff2", cat.cliff, "Cliff face B (taller, snow-dusted)", async () => { const p = MP.cliffParts(2, { h: 11 }); MP.weather(p, { snow: 0.55 }); return part(p); }),
  mp("strata", cat.cliff, "Rock strata texture (painted canvas) on a slab", async () => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.3), toonMat({ map: MP.strataTexture() }, { shadeK: 0.8, rim: 0.1 })); m.position.y = 1.3; g.add(m); return g; }),
  // ---- crags, spires, boulders
  ...[1, 2, 3, 4].map((s) => mp("crag" + s, cat.crag, `Crag ${s} (ridged, strata-banded)`, async () => part(MP.cragParts(s)))),
  mp("spire", cat.crag, "Spire cluster (4 crags)", async () => part(MP.spireCluster(1))),
  mp("crag_snow", cat.crag, "Crag with lichen and snow dust", async () => { const p = MP.cragParts(5); MP.weather(p, { snow: 0.45, lichen: 0.8 }); return part(p); }),
  rockEntry("boulder_01", cat.crag, "Boulder 01 (lichen)", { lichen: 0.8 }), rockEntry("rock_07", cat.crag, "Rock 07 (snow dust)", { snow: 0.5 }), rockEntry("rock_09", cat.crag, "Rock 09 (lichen)", { lichen: 0.7 }),
  rockEntry("stone_01", cat.crag, "Stone 01", { lichen: 0.5 }), rockEntry("rock_moss_set_01", cat.crag, "Mossy rock set 01", {}), rockEntry("rock_moss_set_02", cat.crag, "Mossy rock set 02", {}),
  ...["02", "03", "04", "05", "06"].map((n) => rockEntry("namaqualand_boulder_" + n, cat.crag, "Round boulder " + n, { lichen: 0.5, snow: n === "05" ? 0.5 : 0 })),
  rockEntry("namaqualand_boulders_01", cat.crag, "Boulder group 01", { lichen: 0.6 }), rockEntry("namaqualand_rocks_01", cat.crag, "Rocks 01", { snow: 0.3, lichen: 0.4 }),
  ...[1, 2, 3].map((i) => ({ id: "mq_Rock_Medium_" + i, cat: cat.crag, name: `Rock Medium ${i} (snow dust)`, source: "Quaternius Stylized Nature MegaKit (Standard) + our weather shader", licence: CC0, url: "https://quaternius.com/packs/stylizednaturemegakit.html", noSpin: false,
    make: async () => part((await qRes("Rock_Medium_" + i, { w: { snow: 0.4 } })).parts) })),
  // ---- scree, talus, gravel
  mp("scree_field", cat.scree, "Scree field (angular shard patches, instanced)", screeField, { noSpin: true }),
  mp("scree_patch", cat.scree, "Scree patch (10 shards)", async () => part(MP.screeParts(3))),
  ...["Pebble_Square_1", "Pebble_Square_3", "Pebble_Square_5", "Pebble_Round_2"].map((n) => q(n, cat.scree, { name: n.replace(/_/g, " ") + " (talus chip)", t: { h: 0.14, tint: [1.0, 1.0, 1.05] } })),
  ...[["rocky_gravel", "Rocky gravel"], ["gravel_stones", "Gravel stones"], ["gravel_ground_01", "Gravel ground 01"], ["sandy_gravel_02", "Sandy gravel 02"], ["gray_rocks", "Gray rocks"], ["rocks_ground_02", "Rocks ground 02"], ["rocks_ground_04", "Rocks ground 04"], ["rocks_ground_01", "Rocks ground 01"]]
    .map(([id, n]) => ({ ...texDisc(id, cat.scree, n), id: "mt_tex_" + id })),
  // ---- rock textures
  ...[["rock_face", "Rock face"], ["rock_face_03", "Rock face 03"], ["rock_face_04", "Rock face 04"], ["cliff_side", "Cliff side"], ["rocky_terrain", "Rocky terrain"], ["rocky_terrain_02", "Rocky terrain 02"], ["rocky_terrain_03", "Rocky terrain 03"],
    ["rocky_trail", "Rocky trail"], ["dark_rock", "Dark rock"], ["aerial_rocks_02", "Aerial rocks 02"], ["lichen_rock", "Lichen rock"], ["mossy_rock", "Mossy rock"], ["rock_boulder_cracked", "Cracked boulder rock"], ["aerial_grass_rock", "Alpine grass and rock"]]
    .map(([id, n]) => ({ ...texDisc(id, cat.ground, n), id: "mt_tex_" + id })),
  // ---- alpine meadow
  mp("grass_alp", cat.meadow, "Alpine meadow grass (short tussocks, GPU wind)", async () => fld(P.grassClumpParts({ seed: 4, blades: 5, segs: 3, h: [0.15, 0.32], w: 0.02, fade: [30, 50], rootCol: [0.12, 0.24, 0.08], tipCol: [0.56, 0.68, 0.26] }), 60, 1.2, [0.9, 1.5], 31, MEAD)),
  q("Grass_Common_Short", cat.meadow, { name: "Common short grass (Quaternius)", t: { h: 0.35, wind: 0.7, flutter: 0.4, tint: [1.0, 0.98, 0.8] } }), q("Grass_Wispy_Short", cat.meadow, { name: "Wispy short grass (Quaternius)", t: { h: 0.4, wind: 0.7, flutter: 0.4, tint: [1.0, 0.98, 0.8] } }),
  q("Clover_1", cat.meadow, { name: "Clover 1 (Quaternius)", t: { h: 0.12, wind: 0.3 } }),
  ph("grass_medium_01", cat.meadow, { name: "Grass medium 01 (patch)", t: { grade: true, wind: 0.6 } }),
  mp("gentian", cat.meadow, "Gentian (blue trumpets, rosette)", async () => fld(MP.gentianParts(1), 9, 0.4, [1.4, 2.2], 32, MEAD, 0.03)),
  mp("edelweiss", cat.meadow, "Edelweiss-like (woolly white bracts, felted leaves)", async () => fld(MP.edelweissParts(1), 9, 0.4, [1.4, 2.2], 33, ROCKB, 0.03)),
  mp("saxifrage_w", cat.meadow, "Saxifrage cushion (white flowers)", async () => fld(MP.saxifrageParts(1), 6, 0.5, [1.2, 1.8], 34, ROCKB, 0.03)),
  mp("saxifrage_p", cat.meadow, "Saxifrage cushion (pink flowers)", async () => fld(MP.saxifrageParts(2), 6, 0.5, [1.2, 1.8], 35, ROCKB, 0.03)),
  mp("heather", cat.meadow, "Heather (arching stems, purple bell spikes)", async () => fld(MP.heatherParts(1), 7, 0.6, [1.0, 1.5], 36, MEAD, 0.03)),
  q("Flower_3_Group", cat.meadow, { name: "Meadow flowers 3 (Quaternius)", t: { h: 0.4, wind: 0.5, flutter: 0.4 } }), q("Flower_4_Group", cat.meadow, { name: "Meadow flowers 4 (Quaternius)", t: { h: 0.4, wind: 0.5, flutter: 0.4 } }),
  ph("dandelion_01", cat.meadow, { name: "Dandelion", t: { grade: true, wind: 0.4, flutter: 0.3 } }), ph("celandine_01", cat.meadow, { name: "Celandine", t: { grade: true, wind: 0.4 } }),
  q("Plant_1", cat.meadow, { name: "Alpine plant 1", t: { h: 0.4, wind: 0.5 } }), q("Plant_7", cat.meadow, { name: "Alpine plant 7", t: { h: 0.4, wind: 0.5 } }),
  // ---- lichen, moss, dwarf shrubs, juniper
  mp("lichen", cat.cover, "Lichen patches on rock (orange, yellow-green, grey, black crust)", async () => fld(MP.lichenParts(1), 6, 0.9, [1.4, 2.0], 37, ROCKB, 0.05)),
  mp("moss", cat.cover, "Moss cushions", async () => fld(MP.mossCushionParts(1), 5, 0.7, [1.0, 1.4], 38, ROCKB, 0.05)),
  ph("moss_01", cat.cover, { name: "Moss 01 (Poly Haven)", t: { grade: true } }),
  mp("dwarf_willow", cat.cover, "Dwarf willow mat (grey-green leaves, catkins)", async () => fld(MP.dwarfShrubParts(1, 0), 4, 0.7, [1.2, 1.8], 39, ROCKB, 0.04)),
  mp("crowberry", cat.cover, "Crowberry / bearberry mat (red leaves, black berries)", async () => fld(MP.dwarfShrubParts(2, 1), 4, 0.7, [1.2, 1.8], 40, ROCKB, 0.04)),
  ...["shrub_01", "shrub_03"].map((id) => ph(id, cat.cover, { name: "Dwarf shrub " + id.slice(-2) + " (Poly Haven)", t: { grade: true, wind: 0.3, trans: 0.3, h: 0.7 } })),
  mp("juniper", cat.cover, "Juniper (low spreading conifer, blue-green, berries)", async () => part(MP.juniperParts(1))),
  mp("juniper2", cat.cover, "Juniper B", async () => part(MP.juniperParts(2))),
  // ---- conifers
  ez("spruce0", cat.conif, "Spruce A (EZ-Tree pine preset, dark blue-green)", "Pine Medium", 3, SPRUCE, 14), ez("spruce1", cat.conif, "Spruce B (EZ-Tree)", "Pine Medium", 8, SPRUCE2, 11),
  ez("spruce_snow", cat.conif, "Spruce, snow-dusted (weather shader)", "Pine Medium", 3, SPRUCE, 14),
  ez("larch0", cat.conif, "Larch A (EZ-Tree, golden-green needles)", "Pine Medium", 5, LARCH, 15), ez("larch1", cat.conif, "Larch B (EZ-Tree)", "Pine Medium", 12, LARCH, 12),
  ph("fir_tree_01", cat.conif, { name: "Fir tree 01 (scan, decimated)", t: { wind: 0.25, flutter: 0.4, grade: true, h: 14 } }), ph("fir_sapling_medium", cat.conif, { name: "Fir sapling", t: { wind: 0.3, flutter: 0.4, grade: true } }),
  ph("pine_sapling_small", cat.conif, { name: "Pine sapling small", t: { wind: 0.3, flutter: 0.4, grade: true, h: 2.2 } }), ph("pine_sapling_medium", cat.conif, { name: "Pine sapling medium", t: { wind: 0.3, flutter: 0.4, grade: true, h: 4 } }),
  ...[1, 2, 3, 4, 5].map((i) => q("Pine_" + i, cat.conif, { name: "Pine " + i + " (Quaternius)", t: { wind: 0.3, flutter: 0.5, h: 9 } })),
  { id: "mq_Pine_2_snow", cat: cat.conif, name: "Pine 2, snow-dusted", source: "Quaternius Stylized Nature MegaKit (Standard) + our weather shader", licence: CC0, url: "https://quaternius.com/packs/stylizednaturemegakit.html", noSpin: false,
    make: async () => part((await qRes("Pine_2", { t: { wind: 0.3, flutter: 0.5, h: 9 }, w: { snow: 0.7 } })).parts) },
  // ---- krummholz
  mp("krum1", cat.krum, "Krummholz A (wind-bent, flagged to the lee side)", async () => part(MP.krummholzParts(1))), mp("krum2", cat.krum, "Krummholz B", async () => part(MP.krummholzParts(2))), mp("krum3", cat.krum, "Krummholz C", async () => part(MP.krummholzParts(3))),
  ...[1, 2, 3].map((i) => q("TwistedTree_" + i, cat.krum, { name: "Twisted pine " + i + " (Quaternius)", t: { wind: 0.3, flutter: 0.5, h: 3.2 } })),
  // ---- dead silver snags
  mp("snag1", cat.dead, "Silver snag A (bleached grain, splintered top, bare limbs)", async () => part(MP.snagParts(1))), mp("snag2", cat.dead, "Silver snag B", async () => part(MP.snagParts(2))), mp("snag3", cat.dead, "Silver snag C", async () => part(MP.snagParts(3))),
  ...[1, 2, 3, 4, 5].map((i) => q("DeadTree_" + i, cat.dead, { name: "Dead tree " + i + " (Quaternius, silvered)", t: { wind: 0.05, h: 6, tint: [1.25, 1.28, 1.32] } })),
  ph("dead_tree_trunk", cat.dead, { name: "Dead trunk (Poly Haven)", t: { grade: true, tint: [1.2, 1.22, 1.25] } }), ph("dead_quiver_trunk", cat.dead, { name: "Dead trunk 2 (Poly Haven)", t: { grade: true, tint: [1.2, 1.22, 1.25] } }),
  // ---- water
  mp("w_stream", cat.water, "Mountain stream (shore law, flowing streaks, white water, banks)", async () => slab(-16, 12, -40, -12, 0.5, [MP.streamMesh(-40, -12, 0.5)]), { noSpin: true }),
  mp("w_stream2", cat.water, "Mountain stream, lower reach", async () => slab(-8, 24, 10, 38, 0.5, [MP.streamMesh(10, 38, 0.5)]), { noSpin: true }),
  mp("w_tarn", cat.water, "Alpine tarn (depth bands, caustics, foam line, bowl bed)", async () => slab(-44, -4, -80, -38, 0.8, [MP.tarnMesh()]), { noSpin: true }),
  mp("w_fall", cat.water, "Waterfall (scrolling sheet, foam pool, spray) over the scarp into the tarn", async () => slab(-40, -12, -92, -62, 0.7, [(() => { const w = MP.waterfallParts(); w.position.set(M.FALL.x, M.TARN.y, M.FALL.z + 0.5); return w; })(), MP.tarnMesh()]), { noSpin: true }),
  mp("w_fall_only", cat.water, "Waterfall sheet alone", async () => { const g = new THREE.Group(), w = MP.waterfallParts(3.4, 5); g.add(w); const c = MP.cliffParts(3, { w: 9, h: 6 }); c[0].geo.translate(0, 0, -0.9); g.add(part(c)); return g; }),
  // ---- sky, ranges, clouds, snow in the air
  mp("ranges", cat.air, "Distant mountain ranges: 3 layered silhouettes with aerial haze", async () => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) g.add(MP.rangeLayer(i)); g.userData.keep = true; return g; }, { noSpin: true }),
  mp("cloudsea", cat.air, "Cloud sea below the peaks (toon deck, 3 steps)", async () => { const g = new THREE.Group(), b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 40), toonMat({ color: 0x6f86a8 }, { rim: 0 })); b.position.y = 0.025;
    const d = MP.cloudDeck({ y: [0.3, 0.6], size: 40, near: 0, far: 1, cover: 0.7, scale: 0.35, fixed: [0, 0], name: "cloud sea" }); g.add(b, d); return g; }, { noSpin: true }),
  mp("lowcloud", cat.air, "Low clouds drifting round the peaks (stacked decks)", async () => { const g = new THREE.Group(), b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 40), toonMat({ color: 0x6f86a8 }, { rim: 0 })); b.position.y = 0.025;
    g.add(b, MP.cloudDeck({ y: [0.5, 1.0, 1.5], size: 40, near: 0, far: 1, cover: 0.45, scale: 0.4, fixed: [0, 0], name: "low cloud" })); return g; }, { noSpin: true }),
  mp("blowsnow", cat.air, "Blowing snow (GPU flakes streaming along the wind)", async () => { const g = new THREE.Group(), b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 40), toonMat({ color: SNOWB }, { rim: 0 })); b.position.y = 0.025;
    g.add(b, MP.snowPoints("blow", { n: 300, box: 3, scale: 900, seed: 5 })); return g; }, { noSpin: true }),
  mp("spindrift", cat.air, "Spindrift: snow plume streaming off a crest", async () => { const g = new THREE.Group(), c = MP.cragParts(6, { h: 2.5, w: 0.8 }); MP.weather(c, { snow: 0.8 }); g.add(part(c), MP.snowPoints("spindrift", { n: 160, crests: [[0, 2.4, 0]], speed: 0.35, life: 6, scale: 90, seed: 6 })); return g; }, { noSpin: true }),
  mp("sky", cat.air, "Mountain sky: deep zenith, thin toon clouds, hazy horizon", async () => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 24), skyMaterial({ side: THREE.FrontSide, zenith: 0x2a68c4, mid: 0x7fb6ec, horizon: 0xc9dcec, cloud: 0.35 })); m.position.y = 1.5; g.add(m); return g; }, { source: "Procedural (idea: web/built/sky.js gradient)" }),
];
export const entries = rawEntries.map((e) => ({ ...e, id: "m_" + e.id }));
// snow-dusted spruce entry needs the weather hook applied to its parts
{ const e = entries.find((x) => x.id === "m_ez_spruce_snow"); e.make = async () => { const p = ezTreeParts("Pine Medium", 3, SPRUCE, 14); MP.weather(p, { snow: 0.8 }); return part(p); }; }
{ const e = entries.find((x) => x.id === "m_mp_ranges" || x.id === "m_proc_ranges"); if (e) e.make = async () => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const m = MP.rangeLayer(i); m.onBeforeRender = () => {}; g.add(m); } g.scale.setScalar(0.004); return g; }; }

// ------------------------------------------------------------------ the assembled mountain
const FOG = new THREE.Color(0xc9dcec);
function scatterPts(n, seed, area, ok, o = {}) {
  const r = rng(seed), out = [], sc = o.scale || [0.9, 1.2]; let tries = 0;
  while (out.length < n && tries++ < n * (o.tries || 60)) {
    const x = area[0] + (r() * 2 - 1) * area[2], z = area[1] + (r() * 2 - 1) * area[3], inf = mtInfo(x, z), pr = ok(x, z, inf.h, inf.ny);
    if (!(pr > 0) || r() > pr) continue;
    out.push({ x, z, s: sc[0] + (sc[1] - sc[0]) * r(), yaw: r() * 6.28, h: inf.h, ny: inf.ny });
  }
  return out;
}
const toMats = (pts, o = {}) => { const m = new Float32Array(pts.length * 16), r = rng(o.seed || 5); pts.forEach((p, i) => composeTRS(m, i, p.x, mtH(p.x, p.z) + (o.y || 0), p.z, p.yaw, p.s, o.tilt ? o.tilt * r() : 0, r() * 6.28, o.sy ? p.s * o.sy : null)); return m; };
const patch = (x, z, s = 4, f = 0.05) => Math.pow(vnoise(x, z, f, s), 1.6) * 1.8;
const valleyClear = (x, z) => sstep(10, 22, Math.hypot(x - 2, z - 6));            // keep the camera area open

export async function buildMountain(ctx) {
  const { renderer, scene, tune = {} } = ctx;
  const root = new THREE.Group(), lods = [], cull = new CullSet(), info = { species: [], impostors: 0 };
  const note = (name, n, parts) => info.species.push({ name, n, tris: parts ? parts.reduce((a, p) => a + tris(p.geo), 0) : 0 });
  const N = (n) => Math.round(n * (tune.density ?? 1));
  const AREA = [0, -60, 290, 290];

  // ---- terrain: fine near tile, coarse far tile (sunk under the near one), water, waterfall
  const gm = await gmat({});
  const near = tile(gm, -110, 110, -150, 90, 1.5); near.name = "ground near"; root.add(near);
  const nearX = (x, z) => 1 - sstep(96, 110, Math.max(Math.abs(x), Math.abs(z + 30) * 0.92));
  const far = tile(gm, -300, 300, -300, 300, 6, (x, z) => -1.1 * nearX(x, z)); far.name = "ground far"; root.add(far);
  note("ground near (220x240 m, 1.5 m cells)", 1, [{ geo: near.geometry }]); note("ground far (600x600 m, 6 m cells, slope/altitude splat: meadow, rock+strata+lichen, scree, snow, ice)", 1, [{ geo: far.geometry }]);
  const stream = MP.streamMesh(); root.add(stream); note("mountain stream (toon water, flow streaks, white water, foam)", 1, [{ geo: stream.geometry }]);
  const tarn = MP.tarnMesh(); root.add(tarn); note("alpine tarn (depth bands, caustics, foam line)", 1, [{ geo: tarn.geometry }]);
  const wf = MP.waterfallParts(); wf.position.set(M.FALL.x, M.TARN.y, M.FALL.z + 0.5); root.add(wf); note("waterfall (sheet + foam pool + spray)", 1, null);

  // ---- distant ranges, cloud sea / low clouds, blowing snow + spindrift, mountain light dust
  for (let i = 0; i < 3; i++) root.add(MP.rangeLayer(i, 3, FOG)); note("distant ranges (3 haze layers)", 3, null);
  root.add(MP.cloudDeck({ y: [11], size: 900, near: 130, far: 300, cover: 0.62, scale: 0.0042, name: "cloud sea" })); note("cloud sea (toon deck, fades near the camera)", 1, null);
  root.add(MP.cloudDeck({ y: [78, 118], size: 900, near: 200, far: 330, cover: 0.34, scale: 0.0052, col: [0.98, 0.99, 1], name: "low clouds" })); note("low clouds round the peaks", 2, null);
  root.add(MP.snowPoints("blow", { n: N(1300), box: 70, seed: 9 })); note("blowing snow (GPU points)", N(1300), null);
  const crests = []; { const r = rng(4); for (let k = 0; k < 400 && crests.length < 7; k++) { const x = -150 + r() * 300, z = -300 + r() * 170, h = mtH(x, z); if (h > 120 && crests.every((c) => Math.hypot(c[0] - x, c[2] - z) > 45)) crests.push([x, h + 1, z]); } }
  if (crests.length) { root.add(MP.snowPoints("spindrift", { n: crests.length * 220, crests, speed: 3.2, life: 8, seed: 12, scale: 620 })); note("spindrift plumes off the crests", crests.length * 220, null); }

  const add = (name, parts, pts, o = {}) => {
    if (!pts.length) return;
    const mats = toMats(pts, o), g = cull.add(parts, mats, pts.length, name, o.cell || 16); g.name = name; root.add(g); note(name, pts.length, parts); return g;
  };
  const FD = [34, 60], FDS = [70, 110];
  const Lq = (id, t) => loadToon(`${ASSETS}quaternius/${id}.glb`, { fade: FD, ...t });
  const H = (id, t) => loadToon(`${ASSETS}polyhaven/${id}.glb`, { fade: FD, ...t });
  const wd = (x, z) => sstep(0.8, 2.5, waterDist(x, z));
  const meadowP = (x, z, h, ny) => (ny > 0.82 && h < 70 ? (1 - sstep(48, 70, h)) * wd(x, z) : 0);

  // ---- meadow: grass tussocks, flowers
  add("alpine grass tussocks", P.grassClumpParts({ seed: 4, blades: 5, segs: 3, h: [0.16, 0.34], w: 0.02, fade: [26, 46], rootCol: [0.12, 0.24, 0.08], tipCol: [0.56, 0.68, 0.26] }), scatterPts(N(5200), 11, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * (0.15 + 0.85 * patch(x, z, 3)), { scale: [0.9, 1.6] }));
  add("tall alpine grass", P.grassClumpParts({ seed: 13, blades: 4, segs: 3, h: [0.4, 0.75], w: 0.03, fade: [24, 44], tipCol: [0.7, 0.74, 0.3] }), scatterPts(N(1300), 12, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 6, 0.04) * (h < 45 ? 1 : 0.3), { scale: [0.9, 1.6] }));
  add("Grass_Common_Short", (await Lq("Grass_Common_Short", { h: 0.35, wind: 0.7, flutter: 0.4, tint: [1.0, 0.98, 0.8] })).parts, scatterPts(N(700), 13, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 7), { scale: [0.9, 1.5] }));
  add("Grass_Wispy_Short", (await Lq("Grass_Wispy_Short", { h: 0.4, wind: 0.7, flutter: 0.4, tint: [1.0, 0.98, 0.8] })).parts, scatterPts(N(600), 14, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 8), { scale: [0.9, 1.5] }));
  add("gentian", MP.gentianParts(1), scatterPts(N(900), 15, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 15, 0.07), { scale: [1.4, 2.4] }));
  add("edelweiss", MP.edelweissParts(1), scatterPts(N(500), 16, AREA, (x, z, h, ny) => (ny > 0.7 && h > 25 && h < 85 ? patch(x, z, 16, 0.06) : 0), { scale: [1.4, 2.4] }));
  add("saxifrage white", MP.saxifrageParts(1), scatterPts(N(300), 17, AREA, (x, z, h, ny) => (ny > 0.6 && h > 30 && h < 95 ? patch(x, z, 17, 0.07) : 0), { scale: [1.2, 2.0] }));
  add("saxifrage pink", MP.saxifrageParts(2), scatterPts(N(300), 18, AREA, (x, z, h, ny) => (ny > 0.6 && h > 30 && h < 95 ? patch(x, z, 18, 0.07) : 0), { scale: [1.2, 2.0] }));
  add("heather", MP.heatherParts(1), scatterPts(N(700), 19, AREA, (x, z, h, ny) => (ny > 0.7 && h > 8 && h < 60 ? patch(x, z, 19, 0.05) * wd(x, z) : 0), { scale: [1.0, 1.8] }));
  add("Flower_3_Group", (await Lq("Flower_3_Group", { h: 0.4, wind: 0.5, flutter: 0.4 })).parts, scatterPts(N(120), 20, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 20, 0.07), { scale: [0.9, 1.4] }));
  add("Flower_4_Group", (await Lq("Flower_4_Group", { h: 0.4, wind: 0.5, flutter: 0.4 })).parts, scatterPts(N(120), 21, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 21, 0.07), { scale: [0.9, 1.4] }));
  add("dandelion", (await H("dandelion_01", { wind: 0.4, flutter: 0.3, grade: true })).parts, scatterPts(N(80), 22, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 22, 0.07), { scale: [0.9, 1.4] }));
  add("Clover_1", (await Lq("Clover_1", { h: 0.12, wind: 0.3 })).parts, scatterPts(N(260), 23, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 23, 0.07), { scale: [0.9, 1.5] }));
  add("Plant_1", (await Lq("Plant_1", { h: 0.4, wind: 0.5 })).parts, scatterPts(N(90), 24, AREA, (x, z, h, ny) => meadowP(x, z, h, ny) * patch(x, z, 24), { scale: [0.8, 1.3] }));

  // ---- cover: lichen, moss, dwarf shrubs, juniper
  add("lichen patches", MP.lichenParts(1), scatterPts(N(900), 25, AREA, (x, z, h, ny) => (ny > 0.6 && h > 18 && h < 90 ? 0.2 + 0.8 * patch(x, z, 25, 0.06) : 0), { scale: [1.2, 2.4] }), { y: 0.02 });
  add("moss cushions", MP.mossCushionParts(1), scatterPts(N(260), 26, AREA, (x, z, h, ny) => (ny > 0.75 && h < 60 && waterDist(x, z) < 12 ? 0.3 + 0.7 * patch(x, z, 26) : 0), { scale: [1.0, 1.8] }), { y: -0.02 });
  add("moss_01", (await H("moss_01", { grade: true })).parts, scatterPts(N(60), 27, AREA, (x, z, h, ny) => (ny > 0.75 && h < 50 ? patch(x, z, 27) : 0), { scale: [0.8, 1.4] }), { y: -0.01 });
  add("dwarf willow", MP.dwarfShrubParts(1, 0), scatterPts(N(420), 28, AREA, (x, z, h, ny) => (ny > 0.65 && h > 20 && h < 85 ? patch(x, z, 28, 0.06) : 0), { scale: [1.0, 1.9] }));
  add("crowberry", MP.dwarfShrubParts(2, 1), scatterPts(N(420), 29, AREA, (x, z, h, ny) => (ny > 0.65 && h > 20 && h < 85 ? patch(x, z, 29, 0.06) : 0), { scale: [1.0, 1.9] }));
  add("shrub_01", (await H("shrub_01", { grade: true, wind: 0.3, trans: 0.3, h: 0.7, fade: FDS })).parts, scatterPts(N(60), 30, AREA, (x, z, h, ny) => (ny > 0.7 && h > 5 && h < 60 ? patch(x, z, 30) * wd(x, z) : 0), { scale: [0.8, 1.5] }));
  add("juniper A", MP.juniperParts(1), scatterPts(N(120), 31, AREA, (x, z, h, ny) => (ny > 0.6 && h > 15 && h < 80 ? patch(x, z, 31, 0.05) * wd(x, z) * valleyClear(x, z) : 0), { scale: [0.9, 1.6] }));
  add("juniper B", MP.juniperParts(2), scatterPts(N(120), 32, AREA, (x, z, h, ny) => (ny > 0.6 && h > 15 && h < 80 ? patch(x, z, 32, 0.05) * wd(x, z) * valleyClear(x, z) : 0), { scale: [0.9, 1.6] }));

  // ---- rocks: scree, boulders, crags, cliffs
  const scr = (x, z, h, ny) => (ny > 0.5 && ny < 0.86 && h > 14 ? 0.35 + 0.65 * patch(x, z, 40, 0.07) : 0);
  add("scree shards A", MP.screeParts(1), scatterPts(N(2200), 40, AREA, scr, { scale: [1.0, 2.2] }), { y: -0.02 });
  add("scree shards B", MP.screeParts(2), scatterPts(N(2200), 41, AREA, scr, { scale: [1.0, 2.2] }), { y: -0.02 });
  for (const id of ["Pebble_Square_1", "Pebble_Square_3", "Pebble_Square_5", "Pebble_Round_2"]) add(id, (await Lq(id, { h: 0.14, tint: [1, 1, 1.05], fade: [28, 50] })).parts, scatterPts(N(500), 42 + id.length, AREA, scr, { scale: [0.8, 2.0] }), { y: -0.01 });
  const rk = (x, z, h, ny) => (ny > 0.55 && h > 4 && h < 140 ? (0.1 + 0.9 * patch(x, z, 50, 0.04)) * wd(x, z) * valleyClear(x, z) : 0);
  const rockSp = async (name, res, n, sc, y = -0.15, fade) => add(name, res.parts, scatterPts(N(n), 50 + name.length, AREA, rk, { scale: sc }), { y, tilt: 0.1 });
  const alt = (h) => M.SNOWLINE - 12;                                                                              // snow dust from just below the snowline
  const RW = { lichen: 0.7, snow: 0.55, snowAlt: M.SNOWLINE - 18 };
  await rockSp("boulder_01", wx(await H("boulder_01", { grade: true, fade: [100, 150] }), RW), 8, [1.2, 2.2]);
  await rockSp("rock_07", wx(await H("rock_07", { grade: true, fade: FDS }), RW), 50, [1.2, 2.4]);
  await rockSp("rock_09", wx(await H("rock_09", { grade: true, fade: FDS }), RW), 50, [1.2, 2.4]);
  await rockSp("stone_01", wx(await H("stone_01", { grade: true, fade: FDS }), RW), 70, [1.0, 2.2]);
  for (const id of ["02", "03", "04", "05", "06"]) await rockSp("namaqualand_boulder_" + id, wx(await H("namaqualand_boulder_" + id, { grade: true, fade: [100, 150] }), RW), 12, [1.2, 2.6]);
  await rockSp("namaqualand_boulders_01", wx(await H("namaqualand_boulders_01", { grade: true, fade: [100, 150] }), RW), 8, [1.4, 2.6]);
  await rockSp("namaqualand_rocks_01", wx(await H("namaqualand_rocks_01", { grade: true, fade: [100, 150] }), RW), 10, [1.4, 2.6]);
  await rockSp("rock_moss_set_01", wx(await H("rock_moss_set_01", { grade: true, fade: FDS }), { lichen: 0.3 }), 14, [1.2, 2.0]);
  for (let i = 1; i <= 3; i++) await rockSp("Rock_Medium_" + i, wx(await Lq("Rock_Medium_" + i, { fade: [100, 150] }), RW), 16, [1.0, 2.2]);
  for (let s = 1; s <= 4; s++) { const parts = MP.cragParts(s); MP.weather(parts, { snow: 0.5, snowAlt: M.SNOWLINE - 18, lichen: 0.6 }); for (const p of parts) p.mat.userData.toon.fade = [140, 200];
    add("crag " + s, parts, scatterPts(N(18), 60 + s, AREA, (x, z, h, ny) => (ny > 0.3 && h > 35 ? 0.2 + 0.8 * patch(x, z, 60 + s, 0.05) : 0), { scale: [1.4, 3.2] }), { y: -0.4, cell: 32 }); }
  { const parts = MP.spireCluster(2); MP.weather(parts, { snow: 0.6, snowAlt: M.SNOWLINE - 18 }); for (const p of parts) p.mat.userData.toon.fade = [150, 220]; add("spire clusters", parts, scatterPts(N(12), 70, AREA, (x, z, h, ny) => (h > 70 ? 1 : 0), { scale: [2, 3.6] }), { y: -0.5, cell: 32 }); }
  for (const id of ["rock_face_01", "rock_face_02", "namaqualand_cliff_01", "namaqualand_cliff_02", "mountainside"]) {
    const res = wx(await H(id, { grade: true, fade: [150, 230] }), { lichen: 0.5, snow: 0.35, snowAlt: M.SNOWLINE - 10 });
    add(id, res.parts, scatterPts(N(7), 80 + id.length, AREA, (x, z, h, ny) => (ny < 0.6 && h > 14 ? 1 : 0), { scale: [1.2, 2.2], tries: 400 }), { y: -1.0, cell: 32 });
  }
  { const parts = MP.cliffParts(1); MP.weather(parts, { snow: 0.4, snowAlt: M.SNOWLINE - 10 }); for (const p of parts) p.mat.userData.toon.fade = [160, 240];
    add("cliff faces (procedural)", parts, scatterPts(N(10), 90, AREA, (x, z, h, ny) => (ny < 0.5 && h > 25 ? 1 : 0), { scale: [1.2, 2.2], tries: 600 }), { y: -0.8, cell: 32 }); }
  { const g = MP.glacierParts(1); for (const p of g) p.mat.userData.toon.fade = [180, 260];
    const gp = scatterPts(N(5), 91, AREA, (x, z, h, ny) => (ny > 0.8 && h > M.SNOWLINE - 8 && h < M.SNOWLINE + 70 ? 1 : 0), { scale: [3.0, 4.5], tries: 800 });
    add("glacier tongues", g, gp, { y: -0.1, cell: 64 }); }

  // ---- trees by LOD species with impostor atlas: spruce, larch, fir, pines (some snow-dusted), krummholz, snags
  const species = (name, l0, l1, pts, o = {}) => {
    if (!pts.length) return;
    const imp = bakeImpostor(renderer, partsGroup(l0), 8, 256), mats = toMats(pts, { seed: name.length });
    const levels = [{ parts: l0 }]; if (l1) levels.push({ parts: l1 }); levels.push({ impostor: imp.factory });
    const sp = new LODSpecies(name, levels, mats, pts.length, l1 ? [o.d0 ?? 28, o.d1 ?? 90] : [o.d1 ?? 60]); lods.push(sp); root.add(sp.group); note(name, pts.length, l0); info.impostors++;
  };
  const forestP = (hmax = M.TREELINE) => (x, z, h, ny) => (ny > 0.62 && h > 1.5 && h < hmax + 6 ? (1 - sstep(hmax - 10, hmax + 6, h + 5 * (vnoise(x, z, 0.08, 3) - 0.5))) * (0.15 + 0.85 * Math.pow(vnoise(x, z, 0.018, 70), 1.3) * 1.8) * sstep(3, 8, waterDist(x, z)) * sstep(18, 40, Math.hypot(x - 2, z - 6)) : 0);
  const fp = forestP(), tp = (n, seed, sc) => scatterPts(N(n), seed, AREA, fp, { scale: sc, tries: 120 });
  species("spruce A", ezTreeParts("Pine Medium", 3, SPRUCE, 14), null, tp(120, 100, [0.8, 1.35]), { d1: 55 });
  species("spruce B", ezTreeParts("Pine Medium", 8, SPRUCE2, 11), null, tp(120, 101, [0.8, 1.35]), { d1: 55 });
  { const p = ezTreeParts("Pine Medium", 3, SPRUCE, 14); MP.weather(p, { snow: 0.8 }); species("spruce A (snow-dusted)", p, null, scatterPts(N(80), 102, AREA, (x, z, h, ny) => (ny > 0.62 && h > 22 && h < M.TREELINE + 6 ? fp(x, z, h, ny) * 2 : 0), { scale: [0.8, 1.3], tries: 200 }), { d1: 55 }); }
  species("larch A", ezTreeParts("Pine Medium", 5, LARCH, 15), null, tp(70, 103, [0.8, 1.3]), { d1: 55 });
  species("larch B", ezTreeParts("Pine Medium", 12, LARCH, 12), null, tp(70, 104, [0.8, 1.3]), { d1: 55 });
  species("fir_tree_01", (await loadToon(`${ASSETS}polyhaven/fir_tree_01.glb`, { grade: true, wind: 0.25, flutter: 0.4, h: 14 })).parts, (await loadToon(`${ASSETS}polyhaven/fir_tree_01_lod1.glb`, { grade: true, wind: 0.25, flutter: 0.4, h: 14 })).parts, tp(60, 105, [0.7, 1.15]), { d0: 26, d1: 80 });
  for (const i of [1, 3, 5]) {
    const t = { wind: 0.3, flutter: 0.5, h: 9 };
    species("Pine_" + i, (await loadToon(`${ASSETS}quaternius/Pine_${i}.glb`, t)).parts, (await loadToon(`${ASSETS}quaternius/Pine_${i}_lod1.glb`, t)).parts, tp(50, 106 + i, [0.8, 1.3]), { d0: 28, d1: 90 });
  }
  { const t = { wind: 0.3, flutter: 0.5, h: 9 }, p = (await loadToon(`${ASSETS}quaternius/Pine_2.glb`, t)).parts, p1 = (await loadToon(`${ASSETS}quaternius/Pine_2_lod1.glb`, t)).parts; MP.weather(p, { snow: 0.7 }); MP.weather(p1, { snow: 0.7 });
    species("Pine_2 (snow-dusted)", p, p1, scatterPts(N(50), 120, AREA, (x, z, h, ny) => (ny > 0.62 && h > 20 && h < M.TREELINE + 6 ? fp(x, z, h, ny) * 2 : 0), { scale: [0.8, 1.3], tries: 200 }), { d0: 28, d1: 90 }); }
  species("pine_sapling_medium", (await loadToon(`${ASSETS}polyhaven/pine_sapling_medium.glb`, { grade: true, wind: 0.3, flutter: 0.4, h: 4 })).parts, null, tp(40, 121, [0.8, 1.4]), { d1: 40 });
  // upper belt: krummholz (wind-bent) between the tree line and the alpine meadow, all facing the lee direction through their own geometry
  const kp = (x, z, h, ny) => (ny > 0.6 && h > M.TREELINE - 8 && h < M.TREELINE + 30 ? sstep(M.TREELINE - 8, M.TREELINE + 2, h) * (1 - sstep(M.TREELINE + 18, M.TREELINE + 30, h)) * (0.3 + 0.7 * patch(x, z, 130, 0.05)) : 0);
  for (let k = 1; k <= 3; k++) add("krummholz " + "ABC"[k - 1], MP.krummholzParts(k), scatterPts(N(60), 130 + k, AREA, kp, { scale: [0.9, 1.7], tries: 200 }), { y: -0.05, cell: 24 });
  for (const i of [1, 2, 3]) add("Twisted pine " + i, (await Lq("TwistedTree_" + i, { wind: 0.3, flutter: 0.5, h: 3.2, fade: FDS })).parts, scatterPts(N(30), 140 + i, AREA, kp, { scale: [0.8, 1.4], tries: 200 }), { cell: 24 });
  // dead silver snags in the forest belt and above
  const dp = (x, z, h, ny) => (ny > 0.55 && h > 6 && h < M.TREELINE + 30 ? (0.1 + 0.9 * vnoise(x, z, 0.03, 150)) * 0.2 * sstep(18, 40, Math.hypot(x - 2, z - 6)) * sstep(3, 8, waterDist(x, z)) : 0);
  for (let s = 1; s <= 3; s++) { const parts = MP.snagParts(s); for (const p of parts) p.mat.userData.toon.fade = [100, 160]; add("silver snag " + s, parts, scatterPts(N(24), 150 + s, AREA, dp, { scale: [0.8, 1.3], tries: 200 }), { y: -0.1, cell: 32 }); }
  for (const i of [2, 4]) add("DeadTree_" + i + " (silver)", (await Lq("DeadTree_" + i, { wind: 0.05, h: 6, tint: [1.25, 1.28, 1.32], fade: [100, 160] })).parts, scatterPts(N(18), 160 + i, AREA, dp, { scale: [0.8, 1.3], tries: 200 }), { y: -0.1, cell: 32 });
  add("dead_tree_trunk", (await H("dead_tree_trunk", { grade: true, tint: [1.2, 1.22, 1.25], fade: FDS })).parts, scatterPts(N(14), 170, AREA, dp, { scale: [1.0, 1.6], tries: 200 }), { y: -0.1 });

  return {
    root, info, cull,
    update(camera, frame) { for (const s of lods) s.update(camera, frame === 0); cull.update(camera, frame === 0); },
    lodCounts() { const t = { lod0: 0, lod1: 0, far: 0 }; for (const s of lods) { const c = s.counts(), n = c.length; t.lod0 += c[0]; if (n === 3) t.lod1 += c[1]; t.far += n === 3 ? c[2] : c[1] || 0; } t.cull = { ...cull.stats }; return t; },
  };
}
