// LAKE tab: asset grid entries + the assembled lake (calm toon lake at the centre, near pebble beach + pier at +z, reeds / lilies / willows around, hills far away).
// Follows beach.js: entries[] for Grid mode, buildLake(ctx) for Biome mode. Shore law, water, ground shader, procedural plants: lakeproc.js. Water reflection = low-res mirror pass.
import * as THREE from "three";
import { toonMat, composeTRS, instancedParts, LODSpecies, bakeImpostor, rng, tris, skyMaterial, CullSet, U } from "./toolkit.js";
import { loadToon, partsGroup, loadTex } from "./loader.js";
import * as P from "./procedural.js";
import * as L from "./lakeproc.js";
import { q, ph, proc, texDisc, ASSETS, ezTreeParts } from "./forest.js";

const { lakeH, lakeD, polar, vnoise, LAKE_C } = L;
const PS = "Poly Haven (decimated, 1K albedo)", CC0 = "CC0 1.0", OWN = "Procedural (our code)", EZ = "EZ-Tree by Daniel Greenheck (generated live)";
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const T = (id) => loadTex(`${ASSETS}polyhaven/tex/${id}_diff_1k.jpg`);
let _gt = null;
const groundTex = () => _gt || (_gt = Promise.all(["grass_ground", "aerial_grass_rock", "brown_mud_leaves_01", "rocky_terrain", "brown_mud_02", "river_small_rocks"].map(T)));
const groundMat = async (o) => { const t = await groundTex(); return L.lakeGround(t.slice(0, 4), t[4], t[5], o); };
const part = (parts) => partsGroup(parts);
const TH0 = Math.PI / 2;                                                    // the near bank (+z), open pebble beach + pier
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; };
const beachMask = (th, e = 0) => 1 - Math.exp(-((angDiff(th, TH0) / 0.34) ** 2)) * (1 - sstep(6, 11, e));   // 0 on the open beach (near the water), 1 elsewhere

// ------------------------------------------------------------------ terrain tiles + water (real world coordinates, so the shore law of the shaders applies)
function tile(mat, x0, x1, z0, z1, cell, extra, hf = lakeH) {
  const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d, Math.max(2, Math.round(w / cell)), Math.max(2, Math.round(d / cell)));
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hf(p.getX(i), p.getZ(i)) + (extra ? extra(p.getX(i), p.getZ(i)) : 0));
  g.computeVertexNormals(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, mat); m.name = "ground"; return m;
}
function waterPlane(x0, x1, z0, z1, cell) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.max(1, Math.round((x1 - x0) / cell)), Math.max(1, Math.round((z1 - z0) / cell)));
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, L.lakeWaterMaterial()); m.renderOrder = 5; m.frustumCulled = false; m.name = "lake water"; return m;
}
async function shoreTile(x0, x1, z0, z1, cell, water = true) {
  const grp = new THREE.Group(); grp.add(tile(await groundMat({}), x0, x1, z0, z1, cell)); if (water) grp.add(waterPlane(x0, x1, z0, z1, cell * 1.5)); return grp;
}
const ZS = polar(TH0, 0)[1];                                                // z of the shore at x = 0
async function bankDisc(o = {}) {
  const t = await groundTex(), m = L.lakeGround(t.slice(0, 4), o.mud ?? t[4], o.peb ?? t[5], { disc: true, tile: 1.2, ...(o.g || {}) });
  const g = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.06, 64, 1), m); g.position.y = 0.03; const grp = new THREE.Group(); grp.add(g);
  if (o.water) { const w = new THREE.Mesh(new THREE.CircleGeometry(1.3, 56), L.lakeWaterMaterial({ disc: true })); w.rotation.x = -Math.PI / 2; w.position.y = 0.085; w.renderOrder = 5; grp.add(w); }
  return grp;
}
// ------------------------------------------------------------------ small display fields for the grid
function fld(parts, n, rad, sc, seed, base = 0x5c6b3e, y = 0.04) {
  const g = new THREE.Group(), r = rng(seed), m = new Float32Array(n * 16), b = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.05, rad * 1.05, 0.05, 44), toonMat({ color: base }, { shadeK: 0.82, rim: 0 })); b.position.y = 0.025; g.add(b);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; composeTRS(m, i, Math.cos(a) * d, y, Math.sin(a) * d, r() * 6.28, sc[0] + (sc[1] - sc[0]) * r()); }
  g.add(instancedParts(parts, m, n)); return g;
}
function waterBlock(rad = 1.3) { const b = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 1.0, 56), toonMat({ color: 0x3b8f9c }, { shadeK: 0.85, rim: 0 })); b.position.y = -0.47; return b; }
function floatField(parts, n, rad, sc, seed) {
  const g = new THREE.Group(), r = rng(seed), m = new Float32Array(n * 16); g.add(waterBlock(rad + 0.1));
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad * 0.85; composeTRS(m, i, Math.cos(a) * d, 0.03, Math.sin(a) * d, r() * 6.28, sc[0] + (sc[1] - sc[0]) * r()); }
  g.add(instancedParts(parts, m, n)); return g;
}
const mossy = (parts, m) => { for (const x of parts) { x.mat.userData.toon.moss = m; x.mat.userData.tag = (x.mat.userData.tag || "") + "moss"; } return parts; };
/** rock / log / stump sunk into a water block with the waterline look (object-space level in the grid) */
async function sunk(res, frac = 0.3, moss = 0.8, extra) {
  const h = res.height ?? 1; mossy(res.parts, moss); L.waterlineify(res.parts, { mode: "object", level: frac * h });
  const g = new THREE.Group(), body = part(res.parts); body.position.y = 0.04 - frac * h; g.add(waterBlock(Math.max(1.0, (res.size?.x ?? 1.5) * 0.75))); g.add(body); if (extra) extra(g); return g;
}

// ------------------------------------------------------------------ grid entries
const cat = { water: "Lake water", shore: "Shore: mud, pebbles, wet bank", terr: "Lake terrain", reeds: "Reeds, cattails, rushes, sedges", marsh: "Marsh grass and meadow flowers", edge: "Water iris, horsetail, loosestrife",
  ferns: "Ferns and bank plants", lily: "Water lilies, lotus, floating mats", sub: "Submerged plants", willow: "Willow (weeping)", trees: "Alder, birch and bank trees", over: "Overhanging branches",
  logs: "Fallen logs, stumps, roots", rocks: "Rocks (half-submerged, moss)", steps: "Stepping stones", peb: "Pebbles", pier: "Pier", air: "Mist, light motes, sky" };
const lp = (id, c, name, make, extra = {}) => proc(id, c, name, make, { url: "web/biome/lakeproc.js", ...extra });
const tex = (ids, c) => ids.map(([id, n]) => texDisc(id, c, n));
const phw = (id, c, name, o = {}) => ({ id: "phw_" + id, cat: c, name, source: PS + " + our waterline shader", licence: CC0, url: `https://polyhaven.com/a/${id}`, noSpin: false,
  make: async () => sunk(await loadToon(`${ASSETS}polyhaven/${id}.glb`, { grade: true, ...(o.t || {}) }), o.frac ?? 0.3, o.moss ?? 0.8) });
const qw = (id, c, name, o = {}) => ({ id: "qw_" + id, cat: c, name, source: "Quaternius Stylized Nature MegaKit (Standard) + our waterline shader", licence: CC0, url: "https://quaternius.com/packs/stylizednaturemegakit.html", noSpin: false,
  make: async () => sunk(await loadToon(`${ASSETS}quaternius/${id}.glb`, o.t || {}), o.frac ?? 0.3, o.moss ?? 0.9) });
const ez = (id, c, name, preset, seed, over, h) => ({ id: "ez_" + id, cat: c, name, source: EZ, licence: "MIT", url: "https://github.com/dgreenheck/ez-tree", noSpin: false, make: async () => part(ezTreeParts(preset, seed, over, h)) });
const BIRCH = { bark: { type: "birch", tint: 0xffffff }, leaves: { type: "aspen", tint: 0xb9d96a, count: 5, size: 2.0 } };
const ALDER = { bark: { type: "oak", tint: 0x8a7868 }, leaves: { type: "ash", tint: 0x4f8a3c, count: 5, size: 2.4 } };

const rawEntries = [
  // ---- water
  lp("w_shallows", cat.water, "Lake water, shore to deep (depth bands, caustics, foam, ripples, sparkle)", async () => bankDisc({ water: true }), { noSpin: true, source: OWN, licence: "own code" }),
  lp("w_shore", cat.water, "Lake shore tile with the real shore law (water + bowl bed + bank)", async () => shoreTile(-10, 10, ZS - 14, ZS + 10, 0.5), { noSpin: true }),
  lp("w_deep", cat.water, "Open lake: deep colour bands, ripple rings, sparkle", async () => shoreTile(-12, 12, -46, -20, 1.4), { noSpin: true }),
  lp("w_caustic", cat.water, "Shallows close-up: caustics, soft foam line, pebbles under water", async () => shoreTile(-3.5, 3.5, ZS - 4, ZS + 1, 0.12), { noSpin: true }),
  // ---- shore materials
  ...tex([["river_small_rocks", "River small rocks"], ["ganges_river_pebbles", "Ganges river pebbles"], ["pebble_ground_01", "Pebble ground 01"], ["floor_pebbles_01", "Floor pebbles 01"], ["dry_riverbed_rock", "Dry riverbed rock"],
    ["mud_cracked_dry_riverbed_002", "Cracked dry riverbed mud"]], cat.shore),
  ...tex([["brown_mud", "Brown mud"], ["brown_mud_02", "Brown mud 02"], ["brown_mud_03", "Brown mud 03"], ["coral_mud_01", "Coral mud 01"], ["aerial_mud_1", "Aerial mud"]], cat.shore),
  ...tex([["grass_ground", "Grass ground (bank)"], ["aerial_grass_rock", "Aerial grass and rock"]], cat.shore),
  lp("bank_wet", cat.shore, "Wet bank: dry grass to mud, pebbles, dark wet line + tide mark (shader)", async () => bankDisc(), { noSpin: true, source: OWN + ", Poly Haven textures", licence: CC0 }),
  lp("bank_mud", cat.shore, "Muddy bank variant (coral mud + river pebbles)", async () => bankDisc({ mud: await T("coral_mud_01"), peb: await T("ganges_river_pebbles"), water: true }), { noSpin: true, source: OWN + ", Poly Haven textures", licence: CC0 }),
  lp("bank_pebble", cat.shore, "Pebble beach: shore shader + instanced pebbles", async () => {
    const g = await bankDisc({ water: true }), r = rng(5), names = ["Pebble_Round_1", "Pebble_Round_3", "Pebble_Square_1", "Pebble_Square_4"];
    for (const n of names) { const res = await loadToon(`${ASSETS}quaternius/${n}.glb`, { h: 0.06, tint: [1.3, 1.25, 1.15] }), m = new Float32Array(60 * 16);
      for (let i = 0; i < 60; i++) { const x = (r() * 2 - 1) * 1.0, z = 0.25 + r() * 0.8; composeTRS(m, i, x, 0.06, z, r() * 6.28, 0.5 + r()); } g.add(instancedParts(res.parts, m, 60)); }
    return g;
  }, { noSpin: true, source: OWN + ", Quaternius pebbles, Poly Haven textures", licence: CC0 }),
  // ---- terrain
  lp("t_profile", cat.terr, "Lake bowl profile: bed, shore, bank (no water)", async () => shoreTile(-8, 8, ZS - 16, ZS + 14, 0.7, false), { noSpin: true }),
  lp("t_hills", cat.terr, "Far hills ring (low-res heightfield, fog colour)", async () => hillsRing(), { noSpin: false }),
  // ---- reeds
  lp("reed0", cat.reeds, "Common reed A (culms, straps, plumes, dead culms), GPU wind", async () => fld(L.reedParts(1, 0), 10, 1.0, [0.8, 1.2], 3), { noSpin: false }),
  lp("reed1", cat.reeds, "Common reed B (shorter)", async () => fld(L.reedParts(2, 1), 12, 1.0, [0.8, 1.2], 4)),
  lp("cattail0", cat.reeds, "Cattail A (brown heads, spikes, long straps)", async () => fld(L.cattailParts(1, 0), 10, 1.0, [0.8, 1.2], 5)),
  lp("cattail1", cat.reeds, "Cattail B", async () => fld(L.cattailParts(2, 1), 12, 1.0, [0.8, 1.2], 6)),
  lp("bulrush", cat.reeds, "Bulrush (round stems, spikelet clusters)", async () => fld(L.bulrushParts(1), 12, 1.0, [0.8, 1.2], 7)),
  lp("rush", cat.reeds, "Rushes (thin arching stems, flower clusters)", async () => fld(L.rushParts(1), 14, 1.1, [0.8, 1.3], 8)),
  lp("sedge", cat.reeds, "Sedge (arching straps, seed spikes)", async () => fld(L.sedgeParts(1), 14, 1.1, [0.8, 1.3], 9)),
  // ---- marsh grass / meadow
  lp("marsh0", cat.marsh, "Marsh grass A (tall, moist green)", async () => fld(L.marshGrassParts(1), 18, 1.2, [0.8, 1.3], 10)),
  lp("marsh1", cat.marsh, "Marsh grass B", async () => fld(L.marshGrassParts(2), 18, 1.2, [0.8, 1.3], 11)),
  q("Grass_Common_Tall", cat.marsh, { name: "Common tall grass (Quaternius, wet tint)", t: { h: 0.9, wind: 0.7, flutter: 0.4, tint: [0.9, 1.05, 0.85] } }),
  q("Grass_Wispy_Tall", cat.marsh, { name: "Wispy tall grass (Quaternius, wet tint)", t: { h: 1.0, wind: 0.7, flutter: 0.4, tint: [0.9, 1.05, 0.85] } }),
  ph("grass_medium_01", cat.marsh, { name: "Grass medium 01 (patch)", t: { grade: true, wind: 0.6 } }), ph("grass_medium_02", cat.marsh, { name: "Grass medium 02 (patch)", t: { grade: true, wind: 0.6 } }),
  q("Flower_3_Group", cat.marsh, { name: "Meadow flowers 3 (group)", t: { h: 0.5, wind: 0.5, flutter: 0.4 } }), q("Flower_4_Group", cat.marsh, { name: "Meadow flowers 4 (group)", t: { h: 0.5, wind: 0.5, flutter: 0.4 } }),
  ph("celandine_01", cat.marsh, { name: "Celandine", t: { grade: true, wind: 0.4 } }), ph("dandelion_01", cat.marsh, { name: "Dandelion", t: { grade: true, wind: 0.4, flutter: 0.3 } }),
  ph("periwinkle_plant", cat.marsh, { name: "Periwinkle", t: { grade: true, wind: 0.3 } }),
  // ---- water iris, horsetail, loosestrife
  lp("iris", cat.edge, "Water iris (sword leaves, yellow flowers, buds)", async () => fld(L.irisParts(1), 7, 1.0, [0.9, 1.3], 12)),
  lp("horsetail", cat.edge, "Horsetail (jointed stems, whorled needles)", async () => fld(L.horsetailParts(1), 8, 1.0, [0.9, 1.4], 13)),
  lp("loose", cat.edge, "Purple loosestrife (flower spikes)", async () => fld(L.loosestrifeParts(1), 9, 1.0, [0.9, 1.3], 14)),
  // ---- ferns and bank plants
  q("Fern_1", cat.ferns, { name: "Fern (Quaternius)", t: { h: 0.75, wind: 0.6, flutter: 0.6 } }), ph("fern_02", cat.ferns, { name: "Fern 02 (Poly Haven)", t: { grade: true, wind: 0.5, flutter: 0.6 } }),
  q("Plant_1", cat.ferns, { name: "Bank plant 1", t: { h: 0.6, wind: 0.5 } }), q("Plant_7", cat.ferns, { name: "Bank plant 7", t: { h: 0.55, wind: 0.5 } }),
  ph("weed_plant_02", cat.ferns, { name: "Weed plant 02", t: { grade: true, wind: 0.4 } }), ph("shrub_sorrel_01", cat.ferns, { name: "Sorrel (flowering)", t: { grade: true, wind: 0.4 } }),
  q("Bush_Common", cat.ferns, { name: "Bank bush", t: { h: 1.2, wind: 0.3, flutter: 0.5, trans: 0.3 } }), ph("shrub_02", cat.ferns, { name: "Shrub 02", t: { grade: true, wind: 0.3, trans: 0.3 } }),
  // ---- lilies / floating
  lp("lilypad", cat.lily, "Lily pads (notched, cupped, bobbing), single and groups", async () => floatField(L.lilyPadParts(1, 1), 9, 1.0, [1, 1.6], 15)),
  lp("padgroup", cat.lily, "Lily pad group (6 pads)", async () => floatField(L.lilyPadParts(2, 6), 3, 0.9, [1, 1.3], 16)),
  lp("lily_white0", cat.lily, "White water lily A (pads + flowers)", async () => floatField(L.waterLilyParts(1, false), 2, 0.5, [1.0, 1.2], 17)),
  lp("lily_white1", cat.lily, "White water lily B", async () => floatField(L.waterLilyParts(2, false), 2, 0.5, [1.0, 1.2], 18)),
  lp("lily_pink", cat.lily, "Pink water lily", async () => floatField(L.waterLilyParts(3, true), 2, 0.5, [1.0, 1.2], 19)),
  lp("lotus", cat.lily, "Lotus (raised pads, tall pink flowers)", async () => floatField(L.lotusParts(1), 1, 0.3, [1.1, 1.3], 20)),
  lp("duckweed", cat.lily, "Duckweed mat (alpha speckle, floating)", async () => floatField(L.matParts("duckweed"), 2, 0.5, [1.2, 2.2], 21)),
  lp("algae", cat.lily, "Algae mat (stringy olive, floating)", async () => floatField(L.matParts("algae"), 2, 0.5, [1.2, 2.2], 22)),
  // ---- submerged
  lp("eelgrass", cat.sub, "Eelgrass (long ribbons, sway)", async () => subField(L.eelgrassParts(1), 12, 0.9, [0.9, 1.3], 23)),
  lp("milfoil", cat.sub, "Water milfoil (feathery cards)", async () => subField(L.milfoilParts(1), 8, 0.9, [0.9, 1.3], 24)),
  lp("pondweed", cat.sub, "Pondweed (broad leaves on stems)", async () => subField(L.pondweedParts(1), 8, 0.9, [0.9, 1.3], 25)),
  // ---- willow
  lp("willow0", cat.willow, "Weeping willow A (forked trunk, arching limbs, 140 hanging strand cards)", async () => part(L.willowParts(1, 0))),
  lp("willow1", cat.willow, "Weeping willow B", async () => part(L.willowParts(2, 0))),
  lp("willow_lod1", cat.willow, "Weeping willow A, LOD 1 (fewer, wider strands)", async () => part(L.willowParts(1, 1))),
  // ---- trees
  ez("birch0", cat.trees, "Birch A (EZ-Tree, MIT)", "Aspen Medium", 3, BIRCH, 10), ez("birch1", cat.trees, "Birch B (EZ-Tree, MIT)", "Aspen Medium", 11, BIRCH, 8.5),
  ez("alder0", cat.trees, "Alder A (EZ-Tree ash preset, dark bark)", "Ash Medium", 5, ALDER, 9), ez("alder1", cat.trees, "Alder B (EZ-Tree ash preset)", "Ash Medium", 9, ALDER, 8),
  q("CommonTree_3", cat.trees, { name: "Bank tree (Quaternius CommonTree 3, cool green)", t: { wind: 0.35, flutter: 0.9, trans: 0.4, tint: [0.9, 1.05, 0.85] } }),
  q("CommonTree_5", cat.trees, { name: "Bank tree (Quaternius CommonTree 5, cool green)", t: { wind: 0.35, flutter: 0.9, trans: 0.4, tint: [0.9, 1.05, 0.85] } }),
  ph("tree_small_02", cat.trees, { name: "Small tree 02 (Poly Haven)", t: { grade: true, wind: 0.3, flutter: 0.6, trans: 0.3 } }), ph("island_tree_01", cat.trees, { name: "Island tree 01 (Poly Haven)", t: { grade: true, wind: 0.3, flutter: 0.6, trans: 0.3 } }),
  ph("pachira_aquatica_01", cat.trees, { name: "Pachira aquatica (water chestnut, marsh tree)", t: { grade: true, wind: 0.3, flutter: 0.6, trans: 0.3 } }),
  q("DeadTree_2", cat.trees, { name: "Dead snag by the water", t: { wind: 0.05 } }),
  // ---- overhanging branches
  lp("over0", cat.over, "Leaning bank tree + branch over the water A (leaf clusters, hanging twigs)", async () => part(L.overhangParts(1))),
  lp("over1", cat.over, "Leaning bank tree + branch over the water B", async () => part(L.overhangParts(2))),
  lp("over2", cat.over, "Leaning bank tree + branch over the water C", async () => part(L.overhangParts(3))),
  // ---- logs, stumps, roots
  phw("dead_tree_trunk", cat.logs, "Fallen log in the water A (moss + waterline)", { frac: 0.35, moss: 0.8 }), phw("dead_tree_trunk_02", cat.logs, "Fallen log in the water B (moss + waterline)", { frac: 0.35, moss: 0.8 }),
  ...[1, 2, 3].map((s) => ({ id: "log" + s, cat: cat.logs, name: `Fallen log ${"ABC"[s - 1]} (procedural: curved, root flare, stubs, moss + waterline)`, source: OWN, licence: "own code", url: "web/biome/lakeproc.js logParts", noSpin: false,
    make: async () => { const parts = L.logParts(s); L.waterlineify(parts, { mode: "object", level: 0.15 }); const g = new THREE.Group(), b = part(parts); b.position.y = 0.04 + 0.1; g.add(waterBlock(1.3), b); return g; } })),
  phw("tree_stump_01", cat.logs, "Stump at the waterline 01", { frac: 0.2, moss: 0.9 }), phw("tree_stump_02", cat.logs, "Stump at the waterline 02", { frac: 0.2, moss: 0.9 }),
  ph("root_cluster_01", cat.logs, { name: "Bank roots 01", t: { grade: true } }), ph("root_cluster_02", cat.logs, { name: "Bank roots 02", t: { grade: true } }), ph("single_root", cat.logs, { name: "Single root", t: { grade: true } }),
  ph("dry_branches_medium_01", cat.logs, { name: "Dry branches", t: { grade: true } }),
  // ---- rocks
  phw("boulder_01", cat.rocks, "Boulder 01 (half-submerged, moss, waterline)", { frac: 0.3 }), phw("rock_07", cat.rocks, "Rock 07 (half-submerged)", { frac: 0.3 }), phw("rock_09", cat.rocks, "Rock 09 (half-submerged)", { frac: 0.3 }),
  phw("stone_01", cat.rocks, "Stone 01 (half-submerged)", { frac: 0.3 }), phw("rock_moss_set_01", cat.rocks, "Mossy rock set 01", { frac: 0.25, moss: 0.4 }), phw("rock_moss_set_02", cat.rocks, "Mossy rock set 02", { frac: 0.25, moss: 0.4 }),
  phw("namaqualand_boulder_02", cat.rocks, "Round boulder 02 (Namaqualand)", { frac: 0.3 }), phw("namaqualand_boulder_03", cat.rocks, "Round boulder 03 (Namaqualand)", { frac: 0.3 }), phw("namaqualand_boulder_04", cat.rocks, "Round boulder 04 (Namaqualand)", { frac: 0.3 }),
  phw("namaqualand_stones_01", cat.rocks, "Flat stones (Namaqualand)", { frac: 0.2, moss: 0.3 }),
  ...[1, 2, 3].map((i) => qw("Rock_Medium_" + i, cat.rocks, `Rock Medium ${i} (half-submerged, moss)`)),
  // ---- stepping stones
  ...["Round_Small_1", "Round_Small_2", "Round_Small_3", "Round_Thin", "Round_Wide", "Square_Small_1", "Square_Small_2", "Square_Small_3", "Square_Thin", "Square_Wide"].map((n) => qw("RockPath_" + n, cat.steps, "Stepping stone " + n.replace(/_/g, " "), { frac: 0.0, moss: 0.5 })),
  lp("steps_path", cat.steps, "Stepping-stone path across the shallows (12 stones, instanced, waterline)", async () => stepsPath(), { noSpin: true, source: "Quaternius RockPath + our code", licence: CC0 }),
  // ---- pebbles
  ...["Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3", "Pebble_Round_4", "Pebble_Round_5", "Pebble_Square_1", "Pebble_Square_2", "Pebble_Square_3", "Pebble_Square_4", "Pebble_Square_5", "Pebble_Square_6"]
    .map((n) => q(n, cat.peb, { name: n.replace(/_/g, " ") + " (light)", t: { h: 0.12, tint: [1.3, 1.25, 1.15] } })),
  // ---- pier
  { id: "pier", cat: cat.pier, name: "Wooden pier (Poly Haven modular_wooden_pier, 15 m, waterline)", source: PS + " + our waterline shader", licence: CC0, url: "https://polyhaven.com/a/modular_wooden_pier", noSpin: false,
    make: async () => { const res = await loadToon(`${ASSETS}polyhaven/modular_wooden_pier.glb`, { scale: 0.5, grade: true, ground: false }); L.waterlineify(res.parts, { mode: "object", level: 0.0 }); return part(res.parts); } },
  // ---- mist, motes, sky
  lp("mist", cat.air, "Lake mist sheets (drifting noise, thick over water, thin on the bank)", async () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 40), toonMat({ color: 0x4f8a98 }, { rim: 0 })); b.position.y = 0.025; g.add(b, L.lakeMist(7, 3, 0.15, [0, 0])); return g; }, { noSpin: true }),
  lp("motes", cat.air, "Light motes (additive, flicker, drift: not animals)", async () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 40), toonMat({ color: 0x35502f }, { rim: 0 })); b.position.y = 0.025; g.add(b, L.moteCloud(60, 4, [0, 0, 1.2, 1.2], [0.2, 1.8])); return g; }, { noSpin: true }),
  lp("sky", cat.air, "Sky dome, lake palette + toon clouds", async () => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 24), skyMaterial({ side: THREE.FrontSide, zenith: 0x3f7fd0, mid: 0x8fc4ea, horizon: 0xdcecf2, cloud: 0.5 })); m.position.y = 1.5; g.add(m); return g; }, { source: "Procedural (idea: web/built/sky.js gradient)" }),
];
export const entries = rawEntries.map((e) => ({ ...e, id: "l_" + e.id }));

function subField(parts, n, rad, sc, seed) {
  const g = new THREE.Group(), r = rng(seed), m = new Float32Array(n * 16);
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.2, rad * 1.2, 0.08, 44), toonMat({ color: 0x6b5d45 }, { shadeK: 0.8, rim: 0 })); bed.position.y = 0.04; g.add(bed);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; composeTRS(m, i, Math.cos(a) * d, 0.08, Math.sin(a) * d, r() * 6.28, sc[0] + (sc[1] - sc[0]) * r()); }
  g.add(instancedParts(parts, m, n));
  const w = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.2, rad * 1.2, 0.02, 44), new THREE.MeshBasicMaterial({ color: 0x3f9fae, transparent: true, opacity: 0.38, depthWrite: false })); w.position.y = 1.45; w.renderOrder = 5; g.add(w);
  return g;
}
async function stepsPath() {
  const g = new THREE.Group(), base = await bankDisc({ water: true }), r = rng(7); g.add(base);
  const names = ["Round_Small_1", "Round_Small_2", "Square_Small_1", "Round_Small_3", "Square_Small_2", "Round_Thin", "Square_Small_3"], res = [];
  for (const n of names) { const x = await loadToon(`${ASSETS}quaternius/RockPath_${n}.glb`, { scale: 0.45 }); L.waterlineify(x.parts, { mode: "object", level: 0.0 }); res.push(x); }
  for (let i = 0; i < 12; i++) { const b = part(res[i % res.length].parts), u = i / 11; b.position.set(Math.sin(u * 5) * 0.35, 0.09, 0.9 - u * 1.9); b.rotation.y = r() * 6.28; b.scale.setScalar(0.8 + 0.4 * r()); g.add(b); }
  return g;
}
function hillsRing() {
  const g = new THREE.Group(), mat = toonMat({ color: 0x6b8fa0 }, { shadeK: 0.8, rim: 0 });
  const geo = new THREE.PlaneGeometry(60, 20, 90, 12); geo.rotateX(-Math.PI / 2); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) / 30, v = p.getZ(i) / 10, e = Math.max(0, 1 - v * v) * (0.55 + 0.45 * Math.sin(u * 9) * Math.sin(u * 4 + 1)); p.setY(i, e * 9); }
  geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, mat)); return g;
}

// ------------------------------------------------------------------ the assembled lake
const HALF = 112;
function dartPolar(n, seed, minD, eRange, ok) {
  const r = rng(seed), cell = minD, grid = new Map(), out = []; let tries = 0;
  while (out.length < n && tries++ < n * 60) {
    const th = r() * 6.2832, e = eRange[0] + (eRange[1] - eRange[0]) * r(), [x, z] = polar(th, e); if (ok && !ok(x, z, e, th, r)) continue;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell); let bad = false;
    for (let i = -1; i <= 1 && !bad; i++) for (let j = -1; j <= 1 && !bad; j++) for (const p of grid.get((cx + i) + "," + (cz + j)) || []) if (Math.hypot(p[0] - x, p[1] - z) < minD) { bad = true; break; }
    if (bad) continue; out.push([x, z, th, e]); const k = cx + "," + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z]);
  }
  return out;
}
export async function buildLake(ctx) {
  const { renderer, scene, tune = {} } = ctx;
  const root = new THREE.Group(), lods = [], cull = new CullSet(), info = { species: [], impostors: 0 };
  const note = (name, n, parts) => info.species.push({ name, n, tris: parts ? parts.reduce((a, p) => a + tris(p.geo), 0) : 0 });
  const N = (n) => Math.round(n * (tune.density ?? 1));
  const refl = (obj) => obj.traverse((o) => o.layers.enable(1));
  if (scene && scene.userData.sky) scene.userData.sky.layers.enable(1);
  const reflector = new L.LakeReflector(renderer);

  // ---- ground: fine near tile, coarse far tile, coarse mirror tiles (layer 1 only) + water with the mirror pass in onBeforeRender
  const gmat = await groundMat({});
  const near = tile(gmat, -HALF, HALF, -122, 114, 1.5); near.name = "ground near"; root.add(near);
  const farX = (x, z) => Math.max(0, 1 - sstep(HALF - 8, HALF + 24, Math.max(Math.abs(x), Math.abs(z + 4) * 0.96)));
  const farH = (x, z) => lakeH(x, z) + sstep(130, 420, Math.hypot(x, z + 26)) * (24 * vnoise(x, z, 0.0045, 7) + 14 * vnoise(x, z, 0.011, 8)) - 0.9 * farX(x, z);
  const far = tile(gmat, -560, 560, -560, 560, 28, null, farH); far.name = "ground far"; root.add(far);
  note("ground near (fine 224x236 m, 1.5 m cells)", 1, [{ geo: near.geometry }]); note("ground far (coarse hills)", 1, [{ geo: far.geometry }]);
  const mirror = tile(gmat, -HALF, HALF, -122, 114, 4, null, (x, z) => Math.max(0, lakeH(x, z))); mirror.layers.set(1); mirror.name = "ground mirror"; root.add(mirror);
  const farM = new THREE.Mesh(far.geometry, gmat); farM.layers.set(1); root.add(farM);
  note("mirror ground (layer 1, 4 m cells)", 1, [{ geo: mirror.geometry }]);
  const water = waterPlane(-64, 64, -96, 32, 10); water.material.uniforms.uRefl.value = reflector.rt.texture; water.onBeforeRender = (r, s, c) => reflector.render(r, s, c);
  root.add(water); note("lake water (toon bands, caustics, ripples, foam, sparkle, mirror pass 384x288)", 1, [{ geo: water.geometry }]);

  // ---- scatter helper on polar coordinates around the lake: e metres inland of the shore (negative = in the water)
  const patch = (x, z, s = 4, f = 0.06) => Math.pow(vnoise(x, z, f, s), 2.0) * 1.9;
  function lscatter(n, seed, o) {
    const r = rng(seed), out = new Float32Array(n * 16), sc = o.scale || [0.9, 1.2]; let i = 0, tries = 0;
    while (i < n && tries++ < n * 90) {
      const th = r() * 6.2832, e = o.e[0] + (o.e[1] - o.e[0]) * Math.pow(r(), o.skew || 1), [x, z] = polar(th, e);
      const pr = (o.prob ? o.prob(x, z, e, th) : 1) * (o.beach === false ? 1 : o.beach ?? beachMask(th, e));
      if (r() > pr) continue;
      const s = sc[0] + (sc[1] - sc[0]) * r(), y = o.float ? 0 : lakeH(x, z);
      composeTRS(out, i, x, y + (o.y || 0), z, r() * 6.28, s, o.tiltFix ?? (o.tilt || 0) * r(), r() * 6.28, o.sy ? s * o.sy : null); i++;
    }
    return { mats: out.subarray(0, i * 16), count: i };
  }
  const add = (name, parts, n, o) => {
    const s = lscatter(n, name.length * 31 + n, o);
    const g = o.colors ? instancedParts(parts, s.mats, s.count, name) : cull.add(parts, s.mats, s.count, name);
    g.name = name; root.add(g); note(name, s.count, parts); if (o.refl) refl(g);
    if (o.colors) for (const im of g.children) { const r = rng(5); for (let i = 0; i < s.count; i++) im.setColorAt(i, o.colors[Math.floor(r() * o.colors.length)]); im.instanceColor.needsUpdate = true; }
    return s;
  };
  const FD = [34, 60], FDS = [70, 100];
  const Lq = (id, t) => loadToon(`${ASSETS}quaternius/${id}.glb`, { fade: FD, ...t });
  const H = (id, t) => loadToon(`${ASSETS}polyhaven/${id}.glb`, { fade: FD, ...t });
  const wl = (res, frac = 0, moss = 0.8) => { mossy(res.parts, moss); L.waterlineify(res.parts); return res; };

  // ---- emergent plants (reeds, cattails, bulrush, rushes, sedges): water side to bank
  await add("reed A", L.reedParts(1, 0), N(230), { e: [-2.6, 1.4], prob: (x, z) => patch(x, z, 3, 0.05), scale: [0.8, 1.2], refl: true });
  await add("reed B", L.reedParts(2, 1), N(190), { e: [-2.4, 1.2], prob: (x, z) => patch(x, z, 4, 0.05), scale: [0.8, 1.2], refl: true });
  await add("cattail A", L.cattailParts(1, 0), N(150), { e: [-2.2, 0.8], prob: (x, z) => patch(x, z, 5, 0.06), scale: [0.85, 1.25] });
  await add("cattail B", L.cattailParts(2, 1), N(110), { e: [-2.0, 0.8], prob: (x, z) => patch(x, z, 6, 0.06), scale: [0.85, 1.25] });
  await add("bulrush", L.bulrushParts(1), N(130), { e: [-3.0, 0.2], prob: (x, z) => patch(x, z, 7, 0.07), scale: [0.85, 1.3] });
  await add("rushes", L.rushParts(1), N(280), { e: [-1.4, 3.5], prob: (x, z) => patch(x, z, 8, 0.08), scale: [0.8, 1.3] });
  await add("sedge", L.sedgeParts(1), N(330), { e: [-0.4, 8], skew: 1.4, prob: (x, z) => patch(x, z, 9, 0.07), scale: [0.8, 1.3] });
  await add("horsetail", L.horsetailParts(1), N(130), { e: [-1.2, 3], prob: (x, z) => patch(x, z, 10, 0.08), scale: [0.9, 1.4] });
  await add("water iris", L.irisParts(1), N(110), { e: [-0.9, 2.2], prob: (x, z) => patch(x, z, 11, 0.09), scale: [0.9, 1.4] });
  await add("purple loosestrife", L.loosestrifeParts(1), N(100), { e: [0.2, 4.5], prob: (x, z) => patch(x, z, 12, 0.08), scale: [0.9, 1.4] });
  // ---- marsh grass, bank grass, flowers, ferns
  await add("marsh grass A", L.marshGrassParts(1), N(620), { e: [0.4, 12], skew: 1.3, prob: (x, z) => 0.2 + 0.8 * patch(x, z, 13, 0.05), scale: [0.8, 1.4] });
  await add("marsh grass B", L.marshGrassParts(2), N(460), { e: [0.6, 16], skew: 1.3, prob: (x, z) => 0.15 + 0.85 * patch(x, z, 14, 0.05), scale: [0.8, 1.4] });
  await add("Grass_Common_Tall", (await Lq("Grass_Common_Tall", { h: 0.9, wind: 0.7, flutter: 0.4, tint: [0.9, 1.05, 0.85] })).parts, N(160), { e: [0.8, 14], prob: (x, z) => patch(x, z, 15, 0.05), scale: [0.8, 1.3] });
  await add("Grass_Wispy_Tall", (await Lq("Grass_Wispy_Tall", { h: 1.0, wind: 0.7, flutter: 0.4, tint: [0.9, 1.05, 0.85] })).parts, N(160), { e: [0.8, 14], prob: (x, z) => patch(x, z, 16, 0.05), scale: [0.8, 1.3] });
  await add("bank grass blades", P.grassClumpParts({ seed: 7, blades: 4, segs: 3, fade: [24, 44], rootCol: [0.08, 0.22, 0.06], tipCol: [0.5, 0.74, 0.22] }), N(5200), { e: [0.3, 46], skew: 1.2, prob: (x, z) => 0.12 + 0.88 * patch(x, z, 4, 0.05), scale: [0.8, 1.5] });
  await add("tall grass blades", P.grassClumpParts({ seed: 13, blades: 4, segs: 3, h: [0.7, 1.2], w: 0.045, fade: [24, 44], tipCol: [0.66, 0.78, 0.28] }), N(1500), { e: [1.5, 40], prob: (x, z) => patch(x, z, 6, 0.04), scale: [0.9, 1.6] });
  await add("Flower_3_Group", (await Lq("Flower_3_Group", { h: 0.5, wind: 0.5, flutter: 0.4 })).parts, N(70), { e: [1, 20], prob: (x, z) => patch(x, z, 17, 0.07), scale: [0.8, 1.3] });
  await add("Flower_4_Group", (await Lq("Flower_4_Group", { h: 0.5, wind: 0.5, flutter: 0.4 })).parts, N(70), { e: [1, 20], prob: (x, z) => patch(x, z, 18, 0.07), scale: [0.8, 1.3] });
  await add("celandine", (await H("celandine_01", { wind: 0.4, grade: true })).parts, N(90), { e: [0.5, 12], prob: (x, z) => patch(x, z, 19, 0.07), scale: [0.8, 1.4] });
  await add("dandelion", (await H("dandelion_01", { wind: 0.4, flutter: 0.3, grade: true })).parts, N(70), { e: [1, 16], prob: (x, z) => patch(x, z, 20, 0.07), scale: [0.8, 1.4] });
  await add("periwinkle", (await H("periwinkle_plant", { wind: 0.3, grade: true })).parts, N(50), { e: [2, 18], prob: (x, z) => patch(x, z, 21, 0.06), scale: [0.8, 1.4] });
  await add("Fern_1", (await Lq("Fern_1", { h: 0.75, wind: 0.6, flutter: 0.6 })).parts, N(170), { e: [2, 32], prob: (x, z) => 0.25 + 0.75 * patch(x, z, 22, 0.05), scale: [0.7, 1.4] });
  await add("fern_02", (await H("fern_02", { wind: 0.5, flutter: 0.6, grade: true })).parts, N(120), { e: [2, 32], prob: (x, z) => 0.25 + 0.75 * patch(x, z, 23, 0.05), scale: [0.8, 1.4] });
  await add("Plant_1", (await Lq("Plant_1", { h: 0.6, wind: 0.5 })).parts, N(80), { e: [2, 24], prob: (x, z) => patch(x, z, 24, 0.06), scale: [0.8, 1.3] });
  await add("Plant_7", (await Lq("Plant_7", { h: 0.55, wind: 0.5 })).parts, N(80), { e: [2, 24], prob: (x, z) => patch(x, z, 25, 0.06), scale: [0.8, 1.3] });
  await add("weed_plant_02", (await H("weed_plant_02", { wind: 0.4, grade: true })).parts, N(40), { e: [0.5, 8], prob: (x, z) => patch(x, z, 26, 0.07), scale: [0.8, 1.4] });
  await add("sorrel", (await H("shrub_sorrel_01", { wind: 0.4, grade: true })).parts, N(50), { e: [1, 14], prob: (x, z) => patch(x, z, 27, 0.07), scale: [0.8, 1.4] });
  await add("Bush_Common", (await Lq("Bush_Common", { h: 1.2, wind: 0.3, flutter: 0.5, trans: 0.3, fade: FDS })).parts, N(46), { e: [3, 30], prob: (x, z) => patch(x, z, 28, 0.05), scale: [0.8, 1.5] });
  await add("shrub_02", (await H("shrub_02", { wind: 0.3, flutter: 0.4, grade: true, trans: 0.3, fade: FDS })).parts, N(24), { e: [4, 30], prob: (x, z) => patch(x, z, 29, 0.05), scale: [0.8, 1.5] });

  // ---- floating + submerged
  const lilyProb = (x, z) => patch(x, z, 30, 0.05);
  await add("white lily A", L.waterLilyParts(1, false), N(24), { e: [-14, -2.5], float: true, prob: lilyProb, scale: [0.9, 1.4], beach: 1 });
  await add("white lily B", L.waterLilyParts(2, false), N(24), { e: [-14, -2.5], float: true, prob: (x, z) => patch(x, z, 31, 0.05), scale: [0.9, 1.4], beach: 1 });
  await add("pink lily", L.waterLilyParts(3, true), N(14), { e: [-12, -3], float: true, prob: (x, z) => patch(x, z, 32, 0.05), scale: [0.9, 1.4], beach: 1 });
  await add("lily pads", L.lilyPadParts(4, 1), N(150), { e: [-13, -1.5], float: true, prob: lilyProb, scale: [0.9, 1.7], beach: 1 });
  await add("lily pad groups", L.lilyPadParts(5, 5), N(26), { e: [-12, -3], float: true, prob: (x, z) => patch(x, z, 33, 0.05), scale: [0.9, 1.3], beach: 1 });
  await add("lotus", L.lotusParts(1), N(6), { e: [-10, -4], float: true, prob: (x, z) => patch(x, z, 34, 0.04), scale: [1.0, 1.4], beach: 1 });
  await add("duckweed mats", L.matParts("duckweed"), N(14), { e: [-9, -0.5], float: true, prob: (x, z) => patch(x, z, 35, 0.04), scale: [3.5, 7], beach: 1 });
  await add("algae mats", L.matParts("algae"), N(7), { e: [-4, -0.5], float: true, prob: (x, z) => patch(x, z, 36, 0.05), scale: [3, 5], beach: 1 });
  await add("eelgrass", L.eelgrassParts(1), N(400), { e: [-9, -0.8], prob: (x, z) => 0.2 + 0.8 * patch(x, z, 37, 0.07), scale: [0.9, 1.4], beach: 1 });
  await add("milfoil", L.milfoilParts(1), N(220), { e: [-10, -1.5], prob: (x, z) => patch(x, z, 38, 0.07), scale: [0.9, 1.4], beach: 1 });
  await add("pondweed", L.pondweedParts(1), N(150), { e: [-8, -1.2], prob: (x, z) => patch(x, z, 39, 0.07), scale: [0.9, 1.4], beach: 1 });

  // ---- rocks (half-submerged, moss, waterline), logs, stumps, roots, pebbles
  const rock = async (name, res, n, e, sc, refl_) => add(name, wl(res).parts, N(n), { e, prob: (x, z) => 0.1 + 0.9 * patch(x, z, name.length + 40, 0.04), scale: sc, y: -0.12, beach: 1, refl: refl_ });
  await rock("boulder_01", await H("boulder_01", { grade: true, fade: [90, 130] }), 2, [-1.5, 3], [0.9, 1.4], true);   // 54k tris asset (from the forest set): two only
  await rock("rock_07", await H("rock_07", { grade: true, fade: FDS }), 8, [-1.5, 4], [0.8, 1.5], true);
  await rock("rock_09", await H("rock_09", { grade: true, fade: FDS }), 8, [-1.5, 4], [0.8, 1.5], true);
  await rock("stone_01", await H("stone_01", { grade: true, fade: FDS }), 26, [-2, 3], [0.8, 1.6], false);
  await rock("rock_moss_set_01", await H("rock_moss_set_01", { grade: true, fade: FDS }), 8, [-1, 3], [0.8, 1.4], false);
  await rock("rock_moss_set_02", await H("rock_moss_set_02", { grade: true, fade: FDS }), 8, [-1, 3], [0.8, 1.4], false);
  for (const id of ["02", "03", "04"]) await rock("namaqualand_boulder_" + id, await H("namaqualand_boulder_" + id, { grade: true, fade: [90, 130] }), 6, [-1.8, 3], [0.9, 1.7], true);
  await rock("namaqualand_stones_01", await H("namaqualand_stones_01", { grade: true, fade: FDS }), 18, [-2, 2.5], [0.9, 1.6], false);
  for (let i = 1; i <= 3; i++) await rock("Rock_Medium_" + i, await loadToon(`${ASSETS}quaternius/Rock_Medium_${i}.glb`, { fade: [90, 130] }), 8, [-1.5, 5], [0.5, 1.1], true);
  const log = async (name, res, n, sc) => add(name, wl(res, 0, 0.8).parts, N(n), { e: [-2.6, 0.6], prob: (x, z) => 0.2 + 0.8 * patch(x, z, name.length + 50, 0.05), scale: sc, y: -0.08, tilt: 0.04, beach: 0.7, refl: true });
  await log("fallen log A (Poly Haven)", await H("dead_tree_trunk", { grade: true, fade: [90, 130] }), 3, [0.9, 1.4]);
  await log("fallen log B (Poly Haven)", await H("dead_tree_trunk_02", { grade: true, fade: [90, 130] }), 3, [0.9, 1.4]);
  for (let s = 1; s <= 3; s++) { const parts = L.logParts(s); L.waterlineify(parts); for (const p of parts) p.mat.userData.toon.fade = [90, 130]; await add("fallen log " + "ABC"[s - 1] + " (procedural)", parts, N(2), { e: [-2.4, 0.4], scale: [0.9, 1.4], y: 0.12, beach: 0.7, refl: true }); }
  await add("tree_stump_01", wl(await H("tree_stump_01", { grade: true, fade: FDS })).parts, N(5), { e: [-0.6, 3], prob: (x, z) => patch(x, z, 60, 0.05), scale: [0.9, 1.4], y: -0.05 });
  await add("tree_stump_02", wl(await H("tree_stump_02", { grade: true, fade: FDS })).parts, N(5), { e: [-0.6, 3], prob: (x, z) => patch(x, z, 61, 0.05), scale: [0.9, 1.4], y: -0.05 });
  await add("root_cluster_01", (await H("root_cluster_01", { grade: true })).parts, N(10), { e: [0, 4], scale: [0.9, 1.5], y: -0.05 });
  await add("root_cluster_02", (await H("root_cluster_02", { grade: true })).parts, N(10), { e: [0, 4], scale: [0.9, 1.5], y: -0.05 });
  await add("single_root", (await H("single_root", { grade: true })).parts, N(16), { e: [0, 5], scale: [0.9, 1.5], y: -0.03 });
  await add("dry branches", (await H("dry_branches_medium_01", { grade: true })).parts, N(24), { e: [0.2, 12], prob: (x, z) => patch(x, z, 62, 0.05), scale: [0.7, 1.3] });
  const pebZone = (x, z, e) => (e > -1.2 && e < 6 ? (0.25 + 0.75 * patch(x, z, 63, 0.06)) * (0.45 + 0.55 * sstep(-0.5, 0.5, e) * (1 - sstep(2.5, 6, e))) : 0);
  for (const id of ["Pebble_Round_1", "Pebble_Round_3", "Pebble_Square_1", "Pebble_Square_4"]) await add(id, wl(await Lq(id, { h: 0.1, tint: [1.3, 1.25, 1.15], fade: [26, 46] })).parts, N(330), { e: [-1.2, 6], prob: pebZone, scale: [0.6, 1.6], y: 0.0, beach: 1 });

  // ---- stepping stones across the shallows at the beach (hand placed along a wavering line) + pier
  {
    const names = ["Round_Small_1", "Round_Small_2", "Square_Small_1", "Round_Small_3", "Square_Small_2", "Round_Thin", "Square_Small_3", "Round_Wide"], rr = rng(77), stones = [];
    for (const n of names) stones.push(wl(await loadToon(`${ASSETS}quaternius/RockPath_${n}.glb`, { scale: 0.9, fade: [90, 130] }), 0, 0.5));
    for (let k = 0; k < names.length; k++) {
      const pts = []; for (let i = 0; i < 12; i++) if (i % names.length === k) pts.push(i);
      if (!pts.length) continue; const m = new Float32Array(pts.length * 16);
      pts.forEach((i, j) => { const u = i / 11, th = TH0 - 0.2 + Math.sin(u * 4.5) * 0.04, [x, z] = polar(th, 0.6 - u * 9.5); composeTRS(m, j, x, 0.02 + 0.02 * rr(), z, rr() * 6.28, 0.9 + 0.35 * rr(), 0.03 * rr(), rr() * 6.28); });
      const g = cull.add(stones[k].parts, m, pts.length, "stepping stone " + names[k]); root.add(g); refl(g); note("stepping stone " + names[k], pts.length, stones[k].parts);
    }
    const pier = await loadToon(`${ASSETS}polyhaven/modular_wooden_pier.glb`, { scale: 0.55, grade: true, ground: false, fade: [140, 190] }); L.waterlineify(pier.parts);
    const pg = part(pier.parts), [px, pz] = polar(TH0 + 0.17, -2.2); pg.position.set(px, -0.62, pz); root.add(pg); refl(pg); note("wooden pier", 1, pier.parts);
  }

  // ---- trees by LOD species: willow (hero + bank), birch, alder, bank trees; impostor atlas shared with a layer-1 reflection set
  const species = (name, l0, l1, pos, o = {}) => {
    if (!pos.length) return;
    const imp = bakeImpostor(renderer, partsGroup(l0), 8, 256), r = rng(name.length * 977 + pos.length), mats = new Float32Array(pos.length * 16), sc = o.scale || [0.85, 1.25];
    pos.forEach((p, i) => composeTRS(mats, i, p[0], lakeH(p[0], p[1]) - 0.05, p[1], r() * 6.28, (p[4] ?? (sc[0] + (sc[1] - sc[0]) * r())), 0.02 * r(), r() * 6.28));
    const levels = [{ parts: l0 }]; if (l1) levels.push({ parts: l1 }); levels.push({ impostor: imp.factory });
    const sp = new LODSpecies(name, levels, mats, pos.length, l1 ? [o.d0 ?? 26, o.d1 ?? 70] : [o.d1 ?? 50]); lods.push(sp); root.add(sp.group); note(name, pos.length, l0); info.impostors++;
    const rs = new LODSpecies(name + " (mirror)", [{ impostor: imp.factory }], mats, pos.length, [0]); rs.group.traverse((x) => x.layers.set(1)); rs.update({ position: new THREE.Vector3(0, 0, 0) }, true); root.add(rs.group);
  };
  const hero = [[TH0 + 0.62, 2.6, 1, 1.35], [TH0 - 0.7, 3.4, 2, 1.2], [TH0 + 1.35, 3.0, 1, 1.4]].map(([th, e, s, sc]) => [...polar(th, e), th, e, sc]);
  const okTree = (x, z, e, th) => beachMask(th) > 0.35 && vnoise(x, z, 0.03, 1) > 0.12;
  const willowPos = [...hero, ...dartPolar(N(5), 91, 12, [1.5, 8], (x, z, e, th) => beachMask(th) > 0.6 && !hero.some((h) => Math.hypot(h[0] - x, h[1] - z) < 14))];
  species("willow A", L.willowParts(1, 0), L.willowParts(1, 1), willowPos.filter((_, i) => i % 2 === 0), { scale: [1.0, 1.4], d0: 24, d1: 70 });
  species("willow B", L.willowParts(2, 0), L.willowParts(2, 1), willowPos.filter((_, i) => i % 2 === 1), { scale: [1.0, 1.4], d0: 24, d1: 70 });
  const treePos = dartPolar(N(150), 21, 5.6, [4, 90], (x, z, e, th) => okTree(x, z, e, th) && !willowPos.some((h) => Math.hypot(h[0] - x, h[1] - z) < 9) && (e < 24 || vnoise(x, z, 0.05, 3) > 0.22) && Math.hypot(x - 0, z - 26) > 6);
  const bucket = (k, m) => treePos.filter((_, i) => i % m === k);
  species("birch A", ezTreeParts("Aspen Medium", 3, BIRCH, 10), null, bucket(0, 5), { d1: 45 });
  species("birch B", ezTreeParts("Aspen Medium", 11, BIRCH, 8.5), null, bucket(1, 5), { d1: 45 });
  species("alder A", ezTreeParts("Ash Medium", 5, ALDER, 9), null, bucket(2, 5), { d1: 45 });
  species("alder B", ezTreeParts("Ash Medium", 9, ALDER, 8), null, bucket(3, 5), { d1: 45 });
  {
    const t = { wind: 0.35, flutter: 0.9, trans: 0.4, tint: [0.9, 1.05, 0.85] }, pos = bucket(4, 5);
    species("CommonTree_3 (bank)", (await loadToon(`${ASSETS}quaternius/CommonTree_3.glb`, t)).parts, (await loadToon(`${ASSETS}quaternius/CommonTree_3_lod1.glb`, t)).parts, pos.filter((_, i) => i % 2 === 0), { scale: [0.8, 1.15] });
    species("CommonTree_5 (bank)", (await loadToon(`${ASSETS}quaternius/CommonTree_5.glb`, t)).parts, (await loadToon(`${ASSETS}quaternius/CommonTree_5_lod1.glb`, t)).parts, pos.filter((_, i) => i % 2 === 1), { scale: [0.8, 1.15] });
  }
  // leaning bank trees with a branch out over the water (z+ points to the lake)
  {
    const pos = dartPolar(N(13), 301, 11, [0.6, 2.2], (x, z, e, th) => beachMask(th) > 0.7), ov = [L.overhangParts(1), L.overhangParts(2), L.overhangParts(3)];
    for (const [k, parts] of ov.entries()) {
      const mine = pos.filter((_, i) => i % 3 === k); if (!mine.length) continue; const m = new Float32Array(mine.length * 16), r = rng(310 + k);
      mine.forEach(([x, z, th], j) => { const sc = 1.0 + 0.5 * r(), yaw = Math.atan2(-Math.cos(th), -Math.sin(th)); composeTRS(m, j, x, lakeH(x, z) - 0.1, z, yaw + (r() - 0.5) * 0.3, sc, 0, 0); });
      const g = cull.add(parts, m, mine.length, "overhanging branch " + (k + 1), 24); root.add(g); refl(g); note("leaning tree + branch over water " + (k + 1), mine.length, parts);
    }
    const t = { grade: true, wind: 0.3, flutter: 0.6, trans: 0.3 }, dp = dartPolar(N(12), 311, 10, [6, 40], (x, z, e, th) => beachMask(th) > 0.5 && e > 4);
    if (dp.length) { const res = await loadToon(`${ASSETS}polyhaven/tree_small_02.glb`, t); species("tree_small_02", res.parts, null, dp, { scale: [1.2, 2.0], d1: 40 }); }
  }

  // ---- mist over the water, light motes among the reeds, a far silhouette ridge is the far ground tile
  root.add(L.lakeMist(230, 3, 0.2)); note("lake mist sheets (masked by the shore law)", 3, null);
  const motes = L.moteCloud(N(220), 4, [0, -6, 52, 46], [0.3, 3.6]); root.add(motes); note("light motes", N(220), null);

  return {
    root, info, cull, reflector,
    update(camera, frame) { for (const s of lods) s.update(camera, frame === 0); cull.update(camera, frame === 0); },
    lodCounts() { const t = { lod0: 0, lod1: 0, far: 0 }; for (const s of lods) { const c = s.counts(), n = c.length; t.lod0 += c[0]; if (n === 3) t.lod1 += c[1]; t.far += n === 3 ? c[2] : c[1] || 0; } t.cull = { ...cull.stats }; t.reflMs = +reflector.ms.toFixed(2); return t; },
  };
}
