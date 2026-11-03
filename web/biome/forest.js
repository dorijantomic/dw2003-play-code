// FOREST tab: asset grid entries + the assembled forest scene.
import * as THREE from "three";
import { Tree, TreePreset } from "../lib3d/ez-tree.es.js";
import { toonify, toonMat, groundMaterial, terrainH, scatter, composeTRS, instancedParts, LODSpecies, bakeImpostor, rng, tris, GRADE_PHOTO, U, noiseTexture, CullSet } from "./toolkit.js";
import { loadToon, partsGroup, loadTex } from "./loader.js";
import * as P from "./procedural.js";

export const ASSETS = new URL("./assets/", import.meta.url).href;
const QS = "Quaternius Stylized Nature MegaKit (Standard)", QU = "https://quaternius.com/packs/stylizednaturemegakit.html";
const PS = "Poly Haven (decimated, 1K albedo)", PU = (id) => `https://polyhaven.com/a/${id}`;
const CC0 = "CC0 1.0";

// ------------------------------------------------------------------ entry helpers (shared with the Shared tab)
export const q = (id, cat, o = {}) => ({ id: "q_" + id, cat, name: o.name || id.replace(/_/g, " "), source: QS, licence: CC0, url: QU, noSpin: false,
  make: async () => partsGroup((await loadToon(`${ASSETS}quaternius/${id}.glb`, o.t || {})).parts), ...(o.e || {}) });
export const ph = (id, cat, o = {}) => ({ id: "ph_" + id, cat, name: o.name || id.replace(/_/g, " "), source: PS, licence: CC0, url: PU(id),
  make: async () => partsGroup((await loadToon(`${ASSETS}polyhaven/${id}.glb`, o.t || {})).parts), ...(o.e || {}) });
export const proc = (id, cat, name, make, e = {}) => ({ id: "proc_" + id, cat, name, source: "Procedural (our code)", licence: "own code", url: "web/biome/procedural.js", make, ...e });
/** photoreal texture on a round ground disc through the toon ground material (does not spin: world-space mapping) */
export const texDisc = (id, cat, name, o = {}) => ({ id: "tex_" + id, cat, name, source: PS + " texture", licence: CC0, url: PU(id), noSpin: true,
  make: async () => {
    const t = await loadTex(`${ASSETS}polyhaven/tex/${id}_diff_1k.jpg`);
    const m = groundMaterial([t, t, t, t], { tile: o.tile || 1.1, splat: [2, 2, 0, 9] });
    const g = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.06, 56, 1), m); g.position.y = 0.03; const grp = new THREE.Group(); grp.add(g); return grp;
  } });

// ------------------------------------------------------------------ EZ-Tree trees (MIT): birch, oak
function setDeep(o, m) { for (const [k, v] of Object.entries(m)) (v && typeof v === "object" && !(v.isColor) ? setDeep(o[k], v) : (o[k] = v)); }
export function ezTreeParts(preset, seed, over, height) {
  const t = new Tree();
  t.options.copy(structuredClone(TreePreset[preset]));
  setDeep(t.options, over || {});
  t.options.seed = seed; t.generate();
  const bg = t.branchesMesh.geometry.clone(), lg = t.leavesMesh.geometry.clone();
  bg.computeBoundingBox(); lg.computeBoundingBox();
  const top = Math.max(bg.boundingBox.max.y, lg.boundingBox.max.y), k = height / top;
  const fix = (g) => { g.scale(k, k, k); const n = g.attributes; if (!n.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n.position.count * 2), 2)); const gg = new THREE.BufferGeometry(); gg.setAttribute("position", n.position); gg.setAttribute("normal", n.normal); gg.setAttribute("uv", n.uv); gg.setIndex(g.index); gg.computeBoundingSphere(); return gg; };
  const bm = new THREE.MeshLambertMaterial({ map: t.branchesMesh.material.map, color: 0xffffff }), lm = new THREE.MeshLambertMaterial({ map: t.leavesMesh.material.map, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  const lc = new THREE.Color(t.options.leaves.tint); const bc = new THREE.Color(t.options.bark.tint ?? 0xffffff);
  bm.color.copy(bc); lm.color.copy(lc);
  bm.userData.tag = "ezbark"; lm.userData.tag = "ezleaf";
  return [{ geo: fix(bg), mat: toonify(bm, { wind: 0.3, height, shadeK: 0.7, grade: { sat: 1.15, post: 0.15 } }) },
          { geo: fix(lg), mat: toonify(lm, { wind: 0.3, height, flutter: 0.9, trans: 0.35, shadeK: 0.68, grade: { sat: 1.2, post: 0.1 } }) }];
}
const BIRCH = { bark: { type: "birch", tint: 0xffffff }, leaves: { type: "aspen", tint: 0xb9d96a, count: 5, size: 2.0 } };
const OAK = { leaves: { tint: 0x6fae3a, count: 5, size: 3.0 } };

// ------------------------------------------------------------------ grid entries
export const entries = [
  // floor materials
  texDisc("forest_ground_04", "Floor materials", "Forest ground 04"), texDisc("forest_ground_05", "Floor materials", "Forest ground 05"),
  texDisc("forrest_ground_01", "Floor materials", "Forest ground 01"), texDisc("forest_floor", "Floor materials", "Forest floor"),
  texDisc("brown_mud_leaves_01", "Floor materials", "Brown mud + leaves"), texDisc("wood_chip_path", "Floor materials", "Wood chip path"),
  {
    id: "proc_splat", cat: "Floor materials", name: "4-layer splat (floor+litter+moss+path)", source: PS + " textures, our splat shader", licence: CC0, url: "web/biome/toolkit.js groundMaterial", noSpin: true,
    make: async () => {
      const t = await Promise.all(["forest_ground_04", "forest_leaves_02", "brown_mud_leaves_01", "wood_chip_path"].map((n) => loadTex(`${ASSETS}polyhaven/tex/${n}_diff_1k.jpg`)));
      const g = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.06, 56, 1), groundMaterial(t, { tile: 1.6, splat: [0.42, 0.55, 0.55, 9] })); g.position.y = 0.03;
      const grp = new THREE.Group(); grp.add(g); return grp;
    },
  },
  // leaf litter
  texDisc("forest_leaves_02", "Leaf litter", "Forest leaves 02"), texDisc("forest_leaves_03", "Leaf litter", "Forest leaves 03"),
  texDisc("leaves_forest_ground", "Leaf litter", "Leaves on forest ground"), texDisc("dry_decay_leaves", "Leaf litter", "Dry decayed leaves"),
  proc("litter_oak", "Leaf litter", "Leaf cards (oak, instanced)", async () => litterPile("oak")),
  proc("litter_maple", "Leaf litter", "Leaf cards (maple, instanced)", async () => litterPile("maple")),
  // twigs
  ph("dry_branches_medium_01", "Twigs and debris", { name: "Dry branches" }), ph("bark_debris_01", "Twigs and debris", { name: "Bark debris" }),
  proc("twigs", "Twigs and debris", "Twig bundle", async () => partsGroup(P.twigParts(2))),
  // moss
  ph("moss_01", "Moss", { name: "Moss patch", t: { grade: true } }), ph("rock_moss_set_01", "Moss", { name: "Rock + moss set 01", t: { grade: true, moss: 0 } }), ph("rock_moss_set_02", "Moss", { name: "Rock + moss set 02", t: { grade: true } }),
  texDisc("mossy_rock", "Moss", "Mossy rock texture"), texDisc("rock_pitted_mossy", "Moss", "Pitted mossy rock texture"), texDisc("lichen_rock", "Moss", "Lichen rock texture"),
  { ...q("Rock_Medium_2", "Moss", { name: "Rock with shader moss (up-facing mask)" }), id: "q_Rock_Medium_2_moss", make: async () => partsGroup(await mossRock()) },
  // ferns
  q("Fern_1", "Ferns", { name: "Fern 1", t: { h: 0.7, wind: 0.6, flutter: 0.6 } }), ph("fern_02", "Ferns", { name: "Fern 02", t: { wind: 0.5, flutter: 0.6, grade: true } }),
  // flowers
  ...["Flower_3_Group", "Flower_3_Single", "Flower_4_Group", "Flower_4_Single"].map((n) => q(n, "Flowers", { t: { h: n.includes("Group") ? 0.45 : 0.4, wind: 0.5, flutter: 0.4 } })),
  q("Clover_1", "Flowers", { name: "Clover 1", t: { h: 0.12 } }), q("Clover_2", "Flowers", { name: "Clover 2", t: { h: 0.12 } }),
  ...[1, 2, 3, 4, 5].map((i) => q("Petal_" + i, "Flowers", { name: "Petal " + i, t: { h: 0.06, ground: false } })),
  ph("dandelion_01", "Flowers", { name: "Dandelion", t: { wind: 0.4, flutter: 0.3, grade: true } }), ph("celandine_01", "Flowers", { name: "Celandine", t: { wind: 0.4, grade: true } }), ph("periwinkle_plant", "Flowers", { name: "Periwinkle", t: { wind: 0.3, grade: true } }),
  ph("nettle_plant", "Flowers", { name: "Nettle (plant)", t: { wind: 0.4, grade: true } }),
  q("Plant_1", "Flowers", { name: "Plant 1", t: { h: 0.5, wind: 0.5 } }), q("Plant_1_Big", "Flowers", { name: "Plant 1 big", t: { h: 0.8, wind: 0.5 } }),
  q("Plant_7", "Flowers", { name: "Plant 7", t: { h: 0.4, wind: 0.5 } }), q("Plant_7_Big", "Flowers", { name: "Plant 7 big", t: { h: 0.8, wind: 0.5 } }),
  // shrubs and bushes
  q("Bush_Common", "Shrubs and bushes", { name: "Bush common", t: { h: 1.2, wind: 0.3, flutter: 0.5, trans: 0.3 } }), q("Bush_Common_Flowers", "Shrubs and bushes", { name: "Bush common flowers", t: { h: 1.2, wind: 0.3, flutter: 0.5 } }),
  ...[1, 2, 3, 4].map((i) => ph("shrub_0" + i, "Shrubs and bushes", { name: "Shrub 0" + i, t: { wind: 0.3, flutter: 0.4, grade: true, trans: 0.3 } })),
  // broadleaf
  ...[1, 2, 3, 4, 5].map((i) => q("CommonTree_" + i, "Broadleaf trees", { name: "Common tree " + i, t: { wind: 0.35, flutter: 0.9, trans: 0.4 } })),
  ...[1, 2, 3, 4, 5].map((i) => q("TwistedTree_" + i, "Broadleaf trees", { name: "Twisted tree " + i, t: { wind: 0.35, flutter: 0.9, trans: 0.4 } })),
  { id: "ez_oak", cat: "Broadleaf trees", name: "EZ-Tree oak (procedural, MIT)", source: "EZ-Tree by Daniel Greenheck (generated live)", licence: "MIT", url: "https://github.com/dgreenheck/ez-tree",
    make: async () => partsGroup(ezTreeParts("Oak Medium", 7, OAK, 9)) },
  // pine / fir
  ...[1, 2, 3, 4, 5].map((i) => q("Pine_" + i, "Pine and fir", { name: "Pine " + i, t: { wind: 0.3, flutter: 0.5 } })),
  ph("fir_tree_01", "Pine and fir", { name: "Fir tree 01 (scan, 7M tris to 11k)", t: { wind: 0.25, flutter: 0.4, grade: true } }), ph("fir_sapling_medium", "Pine and fir", { name: "Fir sapling", t: { wind: 0.3, flutter: 0.4, grade: true } }),
  // birch
  { id: "ez_birch1", cat: "Birch", name: "EZ-Tree birch A (procedural, MIT)", source: "EZ-Tree by Daniel Greenheck (generated live)", licence: "MIT", url: "https://github.com/dgreenheck/ez-tree", make: async () => partsGroup(ezTreeParts("Aspen Medium", 3, BIRCH, 10)) },
  { id: "ez_birch2", cat: "Birch", name: "EZ-Tree birch B (procedural, MIT)", source: "EZ-Tree by Daniel Greenheck (generated live)", licence: "MIT", url: "https://github.com/dgreenheck/ez-tree", make: async () => partsGroup(ezTreeParts("Aspen Medium", 11, BIRCH, 8.5)) },
  // dead / fallen / stumps
  ...[1, 2, 3, 4, 5].map((i) => q("DeadTree_" + i, "Dead trees, logs, stumps", { name: "Dead tree " + i, t: { wind: 0.1 } })),
  ph("dead_tree_trunk", "Dead trees, logs, stumps", { name: "Fallen log 01", t: { grade: true } }), ph("dead_tree_trunk_02", "Dead trees, logs, stumps", { name: "Fallen log 02", t: { grade: true } }),
  ph("tree_stump_01", "Dead trees, logs, stumps", { name: "Stump 01", t: { grade: true } }), ph("tree_stump_02", "Dead trees, logs, stumps", { name: "Stump 02", t: { grade: true } }),
  // roots
  ph("pine_roots", "Roots", { name: "Pine roots", t: { grade: true } }), ph("root_cluster_01", "Roots", { name: "Root cluster 01", t: { grade: true } }),
  ph("root_cluster_02", "Roots", { name: "Root cluster 02", t: { grade: true } }), ph("single_root", "Roots", { name: "Single root", t: { grade: true } }),
  // mushrooms
  q("Mushroom_Common", "Mushrooms", { name: "Mushroom common", t: { h: 0.22 } }), q("Mushroom_Laetiporus", "Mushrooms", { name: "Laetiporus (bracket)", t: { h: 0.3 } }),
  proc("mush_agaric", "Mushrooms", "Fly agaric cluster (lathe)", async () => partsGroup(P.mushroomParts("agaric", 5))),
  proc("mush_brown", "Mushrooms", "Brown cap cluster (lathe)", async () => partsGroup(P.mushroomParts("brown", 8))),
  proc("mush_glow", "Mushrooms", "Glow cluster (lathe + emissive)", async () => partsGroup(P.mushroomParts("glow", 12))),
  // vines / ivy
  proc("ivy", "Vines and ivy", "Ivy on trunk (cards + stems)", async () => ivyTrunk()),
  proc("vines", "Vines and ivy", "Hanging vines", async () => hangingVines()),
  // rocks
  ...[1, 2, 3].map((i) => q("Rock_Medium_" + i, "Forest rocks", { name: "Rock medium " + i, t: {} })),
  ph("rock_07", "Forest rocks", { name: "Rock 07", t: { grade: true } }), ph("rock_09", "Forest rocks", { name: "Rock 09", t: { grade: true } }),
  ph("stone_01", "Forest rocks", { name: "Stone 01", t: { grade: true } }), ph("boulder_01", "Forest rocks", { name: "Boulder 01", t: { grade: true } }),
  ...["RockPath_Round_Small_1", "RockPath_Round_Small_2", "RockPath_Round_Small_3", "RockPath_Round_Thin", "RockPath_Round_Wide", "RockPath_Square_Small_1", "RockPath_Square_Small_2", "RockPath_Square_Small_3", "RockPath_Square_Thin", "RockPath_Square_Wide"].map((n) => q(n, "Forest rocks", { name: n.replace(/_/g, " ") })),
  // undergrowth grass
  q("Grass_Common_Short", "Undergrowth grass", { name: "Grass common short", t: { h: 0.35, wind: 0.7, flutter: 0.4 } }), q("Grass_Common_Tall", "Undergrowth grass", { name: "Grass common tall", t: { h: 0.7, wind: 0.7, flutter: 0.4 } }),
  q("Grass_Wispy_Short", "Undergrowth grass", { name: "Grass wispy short", t: { h: 0.45, wind: 0.7, flutter: 0.4 } }), q("Grass_Wispy_Tall", "Undergrowth grass", { name: "Grass wispy tall", t: { h: 0.9, wind: 0.7, flutter: 0.4 } }),
  proc("grass_blades", "Undergrowth grass", "Blade clump field (al-ro style ribbons)", async () => grassPatch()),
  proc("shafts", "Light and air", "Canopy light shafts (additive cards)", async () => { const g = new THREE.Group(); const s = P.lightShafts(4, 3, 0.4); s.scale.setScalar(0.12); s.position.y = 0.2; g.add(s); return g; }, { noSpin: false }),
];

// ---- grid helpers
async function litterPile(kind) {
  const parts = P.litterParts(kind, 0.4), n = 60, r = rng(4), m = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 1.1; composeTRS(m, i, Math.cos(a) * d, 0.01 + i * 0.0006, Math.sin(a) * d, r() * 6.28, 0.8 + r() * 0.7); }
  const g = instancedParts(parts, m, n);
  for (const im of g.children) { for (let i = 0; i < n; i++) im.setColorAt(i, P.LITTER_COLOURS[Math.floor(r() * P.LITTER_COLOURS.length)]); im.instanceColor.needsUpdate = true; }
  return g;
}
async function mossRock() {
  const t = await loadToon(`${ASSETS}quaternius/Rock_Medium_2.glb`, {});
  for (const p of t.parts) { p.mat.userData.tag = "moss"; p.mat.userData.toon.moss = 0.95; p.mat.needsUpdate = true; }
  return t.parts;
}
function ivyTrunk() {
  const g = new THREE.Group(), trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 4.4, 14, 1), toonMat({ color: 0x5b4632 }, { shadeK: 0.7, moss: 0.4 }));
  trunk.position.y = 2.2; g.add(trunk); g.add(partsGroup(P.ivyParts(0.3, 3.8, 3))); return g;
}
function hangingVines() {
  const g = new THREE.Group(), bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 8), toonMat({ color: 0x5b4632 }, { shadeK: 0.7 }));
  bar.rotation.z = Math.PI / 2; bar.position.y = 2.6; g.add(bar); g.add(partsGroup(P.vineParts(2.6, 9))); return g;
}
export function grassPatch() {
  const parts = P.grassClumpParts({ seed: 3, blades: 5, fade: [1e3, 2e3] }), r = rng(8), n = 160, m = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 1.15; composeTRS(m, i, Math.cos(a) * d, 0.02, Math.sin(a) * d, r() * 6.28, 0.8 + r() * 0.6); }
  const g = new THREE.Group(), base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.04, 40), toonMat({ color: 0x2f3b1c }, { shadeK: 0.8 })); base.position.y = 0.02; g.add(base);
  g.add(instancedParts(parts, m, n)); return g;
}

// ------------------------------------------------------------------ the assembled forest
const HALF = 110;
function vnoise(x, z, f, s = 0) { // cheap smooth value noise 0..1
  const X = x * f + s * 17.3, Z = z * f + s * 9.1, xi = Math.floor(X), zi = Math.floor(Z), fx = X - xi, fz = Z - zi;
  const h = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - sx) + h(xi + 1, zi) * sx) * (1 - sz) + (h(xi, zi + 1) * (1 - sx) + h(xi + 1, zi + 1) * sx) * sz;
}
function dart(n, seed, minD, ok) {
  const r = rng(seed), cell = minD, grid = new Map(), out = []; let tries = 0;
  while (out.length < n && tries++ < n * 60) {
    const x = (r() * 2 - 1) * HALF, z = (r() * 2 - 1) * HALF; if (ok && !ok(x, z, r)) continue;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell); let bad = false;
    for (let i = -1; i <= 1 && !bad; i++) for (let j = -1; j <= 1 && !bad; j++) for (const p of grid.get((cx + i) + "," + (cz + j)) || []) if (Math.hypot(p[0] - x, p[1] - z) < minD) { bad = true; break; }
    if (bad) continue; out.push([x, z]); const k = cx + "," + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z]);
  }
  return out;
}

/** returns { root, update(camera, frame), info } ; info.species = [{name, count, tris}] */
export async function buildForest(ctx) {
  const { renderer, tune = {} } = ctx;
  const root = new THREE.Group(), lods = [], cull = new CullSet(), info = { species: [], impostors: 0 };
  const note = (name, n, parts) => info.species.push({ name, n, tris: parts ? parts.reduce((a, p) => a + tris(p.geo), 0) : 0 });
  // ---- ground
  const tex = await Promise.all(["forest_ground_04", "forest_leaves_02", "brown_mud_leaves_01", "wood_chip_path"].map((n) => loadTex(`${ASSETS}polyhaven/tex/${n}_diff_1k.jpg`)));
  const gg = new THREE.PlaneGeometry(HALF * 2.6, HALF * 2.6, 110, 110); gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, terrainH(gp.getX(i), gp.getZ(i)));
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, groundMaterial(tex, { tile: 3.0, tints: [[1, 1, 1], [1.05, 0.95, 0.85], [0.7, 0.9, 0.55], [1.1, 1.0, 0.9]], splat: [0.5, 0.58, 0.5, 0.9] }));
  ground.name = "ground"; root.add(ground);

  // ---- trees (dart throwing: no overlaps) ----
  const clearing = 5.5;
  const pts = dart(tune.trees ?? 300, 21, 3.4, (x, z) => Math.hypot(x, z) > clearing + 1 && vnoise(x, z, 0.03, 1) > 0.18);
  const B = [], Pn = [], Bi = [], D = [];
  for (const [x, z] of pts) { const n = vnoise(x, z, 0.022, 2), r2 = vnoise(x * 7.1, z * 3.3, 1, 5); (n > 0.62 ? Pn : n < 0.38 ? Bi : (r2 > 0.8 ? D : B)).push([x, z]); }
  // top up: some dead trees, birch groves, a few broadleaf among pines
  const treeGrid = new Map(); const gk = (x, z) => Math.floor(x / 4) + "," + Math.floor(z / 4);
  for (const [x, z] of pts) { const k = gk(x, z); if (!treeGrid.has(k)) treeGrid.set(k, []); treeGrid.get(k).push([x, z]); }
  const nearTree = (x, z, d) => { const cx = Math.floor(x / 4), cz = Math.floor(z / 4), R = Math.ceil(d / 4); for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (const p of treeGrid.get((cx + i) + "," + (cz + j)) || []) if (Math.hypot(p[0] - x, p[1] - z) < d) return true; return false; };

  const species = async (name, urls, positions, o) => {
    if (!positions.length) return null;
    const l0 = urls.l0 ? await urls.l0() : null, l1 = urls.l1 ? await urls.l1() : null;
    const obj = partsGroup(l0.parts); const imp = bakeImpostor(renderer, obj, 8, 256);
    const r = rng(name.length * 977 + positions.length), mats = new Float32Array(positions.length * 16);
    positions.forEach(([x, z], i) => composeTRS(mats, i, x, terrainH(x, z) - 0.05, z, r() * 6.28, (o.scale || [0.8, 1.25])[0] + ((o.scale || [0.8, 1.25])[1] - (o.scale || [0.8, 1.25])[0]) * r(), 0.03 * r(), r() * 6.28));
    const levels = [{ parts: l0.parts }]; if (l1) levels.push({ parts: l1.parts }); levels.push({ impostor: imp.factory });
    const dist = l1 ? [o.d0 ?? 26, o.d1 ?? 70] : [o.d1 ?? 55];
    const sp = new LODSpecies(name, levels, mats, positions.length, dist); lods.push(sp); root.add(sp.group); note(name, positions.length, l0.parts); info.impostors++;
    return { l0, positions };
  };
  const qT = (id, t) => ({ l0: () => loadToon(`${ASSETS}quaternius/${id}.glb`, t), l1: () => loadToon(`${ASSETS}quaternius/${id}_lod1.glb`, t) });
  const spread = (arr, k) => arr.filter((_, i) => i % k.m === k.i);
  const bT = { wind: 0.35, flutter: 0.9, trans: 0.4 }, pT = { wind: 0.3, flutter: 0.5, trans: 0.2 };
  const bSpecies = ["CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "TwistedTree_1", "TwistedTree_2"];
  const broadInfo = [];
  for (let s = 0; s < bSpecies.length; s++) broadInfo.push(await species(bSpecies[s], qT(bSpecies[s], bT), spread(B, { m: bSpecies.length, i: s }), {}));
  const pSpecies = ["Pine_1", "Pine_2", "Pine_3", "Pine_4"];
  for (let s = 0; s < pSpecies.length; s++) await species(pSpecies[s], qT(pSpecies[s], pT), spread(Pn, { m: 5, i: s }), {});
  await species("fir_tree_01", { l0: () => loadToon(`${ASSETS}polyhaven/fir_tree_01.glb`, { ...pT, grade: true }), l1: () => loadToon(`${ASSETS}polyhaven/fir_tree_01_lod1.glb`, { ...pT, grade: true }) }, spread(Pn, { m: 5, i: 4 }), { scale: [0.7, 1.0] });
  for (let s = 0; s < 2; s++) {
    const pos = spread(Bi, { m: 2, i: s }); if (!pos.length) continue;
    const parts = ezTreeParts("Aspen Medium", [3, 11][s], BIRCH, [10, 8.5][s]);
    const obj = partsGroup(parts), imp = bakeImpostor(renderer, obj, 8, 256), r = rng(50 + s), mats = new Float32Array(pos.length * 16);
    pos.forEach(([x, z], i) => composeTRS(mats, i, x, terrainH(x, z) - 0.05, z, r() * 6.28, 0.8 + 0.45 * r(), 0.03 * r(), r() * 6.28));
    const sp = new LODSpecies("birch" + s, [{ parts }, { impostor: imp.factory }], mats, pos.length, [45]); lods.push(sp); root.add(sp.group); note("EZ birch " + "AB"[s], pos.length, parts); info.impostors++;
  }
  for (let s = 0; s < 3; s++) {
    const pos = spread(D, { m: 3, i: s }); const id = "DeadTree_" + (s + 1); if (!pos.length) continue;
    const l0 = await loadToon(`${ASSETS}quaternius/${id}.glb`, { wind: 0.05 }), l1 = await loadToon(`${ASSETS}quaternius/${id}_lod1.glb`, { wind: 0.05 }), r = rng(70 + s), mats = new Float32Array(pos.length * 16);
    pos.forEach(([x, z], i) => composeTRS(mats, i, x, terrainH(x, z) - 0.05, z, r() * 6.28, 0.8 + 0.4 * r(), 0.05 * r(), r() * 6.28));
    const sp = new LODSpecies(id, [{ parts: l0.parts }, { parts: l1.parts }], mats, pos.length, [50]); lods.push(sp); root.add(sp.group); note(id, pos.length, l0.parts);
  }
  // ez oak among broadleaf stands
  {
    const parts = ezTreeParts("Oak Medium", 7, OAK, 9), pos = B.filter((_, i) => i % 9 === 4); if (pos.length) {
      const obj = partsGroup(parts), imp = bakeImpostor(renderer, obj, 8, 256), r = rng(90), mats = new Float32Array(pos.length * 16);
      pos.forEach(([x, z], i) => composeTRS(mats, i, x + 1.5, terrainH(x + 1.5, z) - 0.05, z, r() * 6.28, 0.8 + 0.4 * r(), 0.02, 0));
      const sp = new LODSpecies("ezoak", [{ parts }, { impostor: imp.factory }], mats, pos.length, [45]); lods.push(sp); root.add(sp.group); note("EZ oak", pos.length, parts); info.impostors++;
    }
  }

  // ---- understory: one InstancedMesh group per species, GPU distance fade ----
  const FD = [30, 52];
  const area = [0, 0, HALF, HALF];
  const dens = {
    open: (x, z) => (Math.hypot(x, z) < 3 ? 0.15 : 0.5 + 0.5 * vnoise(x, z, 0.09, 3)),
    patchy: (x, z, s = 4, f = 0.06) => Math.pow(vnoise(x, z, f, s), 2.2) * 1.8,
    underTree: (x, z) => (nearTree(x, z, 3.2) ? 1 : 0.12),
    nearTrunk: (x, z) => (nearTree(x, z, 1.8) ? 1 : 0),
  };
  const add = async (name, loader, n, density, sc, extra = {}) => {
    const parts = Array.isArray(loader) ? loader : (await loader).parts;
    const s = scatter(n, name.length * 31 + n, area, (x, z) => (Math.hypot(x, z) < 1.2 ? 0 : density(x, z)), { scale: sc, tilt: extra.tilt || 0, yOffset: extra.y || 0 });
    const g = extra.colors ? instancedParts(parts, s.mats, s.count, name) : cull.add(parts, s.mats, s.count, name); g.name = name; root.add(g); note(name, s.count, parts);
    if (extra.colors) for (const im of g.children) { const r = rng(5); for (let i = 0; i < s.count; i++) im.setColorAt(i, extra.colors[Math.floor(r() * extra.colors.length)]); im.instanceColor.needsUpdate = true; }
    return { g, s, parts };
  };
  const L = (id, t) => loadToon(`${ASSETS}quaternius/${id}.glb`, { fade: FD, ...t });
  const H = (id, t) => loadToon(`${ASSETS}polyhaven/${id}.glb`, { fade: FD, ...t });
  const scaleTune = tune.density ?? 1, N = (n) => Math.round(n * scaleTune);

  await add("grass blades", P.grassClumpParts({ seed: 7, blades: 4, segs: 3, fade: [24, 44] }), N(14000), (x, z) => dens.patchy(x, z, 4, 0.05) * 0.9 + 0.1, [0.8, 1.5]);
  await add("grass tall blades", P.grassClumpParts({ seed: 13, blades: 4, segs: 3, h: [0.7, 1.2], w: 0.045, fade: [24, 44], tipCol: [0.72, 0.8, 0.28] }), N(2500), (x, z) => dens.patchy(x, z, 6, 0.04), [0.9, 1.6]);
  await add("Grass_Common_Short", L("Grass_Common_Short", { h: 0.35, wind: 0.7, flutter: 0.4 }), N(500), dens.patchy, [0.8, 1.4]);
  await add("Grass_Common_Tall", L("Grass_Common_Tall", { h: 0.7, wind: 0.7, flutter: 0.4 }), N(300), dens.patchy, [0.8, 1.3]);
  await add("Grass_Wispy_Short", L("Grass_Wispy_Short", { h: 0.45, wind: 0.7, flutter: 0.4 }), N(400), dens.patchy, [0.8, 1.4]);
  await add("Grass_Wispy_Tall", L("Grass_Wispy_Tall", { h: 0.9, wind: 0.7, flutter: 0.4 }), N(200), (x, z) => dens.patchy(x, z, 6, 0.05), [0.8, 1.3]);
  await add("Fern_1", L("Fern_1", { h: 0.75, wind: 0.6, flutter: 0.6 }), N(700), dens.underTree, [0.7, 1.4]);
  await add("fern_02", H("fern_02", { wind: 0.5, flutter: 0.6, grade: true }), N(450), dens.underTree, [0.8, 1.4]);
  await add("Plant_1", L("Plant_1", { h: 0.5, wind: 0.5 }), N(180), dens.open, [0.8, 1.3]);
  await add("Plant_1_Big", L("Plant_1_Big", { h: 0.8, wind: 0.5 }), N(90), dens.underTree, [0.8, 1.3]);
  await add("Plant_7", L("Plant_7", { h: 0.45, wind: 0.5 }), N(180), dens.open, [0.8, 1.3]);
  await add("Plant_7_Big", L("Plant_7_Big", { h: 0.85, wind: 0.5 }), N(90), dens.underTree, [0.8, 1.3]);
  await add("Clover_1", L("Clover_1", { h: 0.12 }), N(400), (x, z) => dens.patchy(x, z, 9, 0.08), [0.8, 1.4]);
  await add("Clover_2", L("Clover_2", { h: 0.12 }), N(400), (x, z) => dens.patchy(x, z, 10, 0.08), [0.8, 1.4]);
  for (const f of ["Flower_3_Group", "Flower_3_Single", "Flower_4_Group", "Flower_4_Single"]) await add(f, L(f, { h: f.includes("Group") ? 0.45 : 0.4, wind: 0.5, flutter: 0.4 }), N(f.includes("Group") ? 90 : 130), (x, z) => dens.patchy(x, z, f.length, 0.07), [0.8, 1.3]);
  await add("dandelion", H("dandelion_01", { wind: 0.4, flutter: 0.3, grade: true }), N(120), (x, z) => dens.patchy(x, z, 12, 0.07), [0.8, 1.4]);
  await add("celandine", H("celandine_01", { wind: 0.4, grade: true }), N(120), (x, z) => dens.patchy(x, z, 14, 0.07), [0.8, 1.4]);
  await add("periwinkle", H("periwinkle_plant", { wind: 0.3, grade: true }), N(100), dens.underTree, [0.8, 1.4]);
  await add("nettle", H("nettle_plant", { wind: 0.4, grade: true }), N(70), dens.underTree, [0.8, 1.3]);
  await add("Bush_Common", L("Bush_Common", { h: 1.2, wind: 0.3, flutter: 0.5, trans: 0.3 }), N(110), dens.underTree, [0.8, 1.5]);
  await add("Bush_Common_Flowers", L("Bush_Common_Flowers", { h: 1.2, wind: 0.3, flutter: 0.5 }), N(70), dens.underTree, [0.8, 1.4]);
  for (let i = 1; i <= 4; i++) await add("shrub_0" + i, H("shrub_0" + i, { wind: 0.3, flutter: 0.4, grade: true, trans: 0.3 }), N(30), dens.underTree, [0.8, 1.5]);
  // litter: oak + maple cards, tinted per instance; twigs; debris
  await add("leaf litter oak", P.litterParts("oak", 0.12), N(5500), (x, z) => 0.35 + 0.65 * dens.patchy(x, z, 3, 0.07), [0.7, 1.5], { colors: P.LITTER_COLOURS });
  await add("leaf litter maple", P.litterParts("maple", 0.12), N(3500), (x, z) => 0.3 + 0.7 * dens.patchy(x, z, 8, 0.08), [0.7, 1.5], { colors: P.LITTER_COLOURS });
  await add("twigs", P.twigParts(2), N(600), dens.underTree, [0.7, 1.5]);
  await add("twigs B", P.twigParts(6), N(400), dens.open, [0.7, 1.4]);
  await add("dry branches", H("dry_branches_medium_01", { grade: true }), N(70), dens.underTree, [0.7, 1.3]);
  await add("bark debris", H("bark_debris_01", { grade: true }), N(70), dens.nearTrunk, [0.7, 1.3]);
  // roots, logs, stumps
  await add("pine roots", H("pine_roots", { grade: true, moss: 0 }), N(22), dens.nearTrunk, [0.9, 1.4], { y: -0.05 });
  await add("root cluster 01", H("root_cluster_01", { grade: true }), N(22), dens.nearTrunk, [0.9, 1.4], { y: -0.05 });
  await add("root cluster 02", H("root_cluster_02", { grade: true }), N(22), dens.nearTrunk, [0.9, 1.4], { y: -0.05 });
  await add("single root", H("single_root", { grade: true }), N(40), dens.nearTrunk, [0.9, 1.5], { y: -0.03 });
  const mossy = async (p, m) => { for (const x of p.parts) { x.mat.userData.toon.moss = m; x.mat.userData.tag = "moss"; } return p; };
  await add("fallen log 01", mossy(await H("dead_tree_trunk", { grade: true, fade: [60, 90] }), 0.8), N(12), dens.underTree, [0.9, 1.4]);
  await add("fallen log 02", mossy(await H("dead_tree_trunk_02", { grade: true, fade: [60, 90] }), 0.8), N(12), dens.underTree, [0.9, 1.4]);
  await add("stump 01", mossy(await H("tree_stump_01", { grade: true, fade: [60, 90] }), 0.9), N(9), dens.open, [0.9, 1.4]);
  await add("stump 02", mossy(await H("tree_stump_02", { grade: true, fade: [60, 90] }), 0.9), N(9), dens.open, [0.9, 1.4]);
  // rocks with shader moss, pebbles
  for (let i = 1; i <= 3; i++) await add("Rock_Medium_" + i, mossy(await loadToon(`${ASSETS}quaternius/Rock_Medium_${i}.glb`, { fade: [70, 100] }), 0.9), N(22), dens.open, [0.7, 1.7]);
  await add("rock 07", mossy(await H("rock_07", { grade: true, fade: [70, 100] }), 0.8), N(16), dens.open, [0.8, 1.5]);
  await add("rock 09", mossy(await H("rock_09", { grade: true, fade: [70, 100] }), 0.8), N(16), dens.open, [0.8, 1.5]);
  await add("stone 01", mossy(await H("stone_01", { grade: true }), 0.7), N(40), dens.open, [0.8, 1.6]);
  await add("rock moss set 01", H("rock_moss_set_01", { grade: true, fade: [70, 100] }), N(12), dens.open, [0.8, 1.4]);
  await add("rock moss set 02", H("rock_moss_set_02", { grade: true, fade: [70, 100] }), N(12), dens.open, [0.8, 1.4]);
  await add("boulder 01", mossy(await H("boulder_01", { grade: true, fade: [90, 130] }), 0.85), N(3), (x, z) => (Math.hypot(x, z) > 12 ? 1 : 0), [1.0, 1.8]);
  for (const n of ["Round_Small_1", "Round_Small_2", "Square_Small_1", "Square_Small_3"]) await add("RockPath_" + n, L("RockPath_" + n, { h: 0.1 }), N(60), dens.open, [0.9, 1.5]);
  for (const n of ["Pebble_Round_1", "Pebble_Round_3", "Pebble_Square_1", "Pebble_Square_4"]) await add(n, L(n, { h: 0.06 }), N(160), dens.open, [0.7, 1.5]);
  // moss patches and mushrooms
  await add("moss patch", H("moss_01", { grade: true }), N(60), dens.underTree, [0.8, 1.5]);
  await add("Mushroom_Common", L("Mushroom_Common", { h: 0.2 }), N(160), dens.underTree, [0.7, 1.4]);
  await add("Mushroom_Laetiporus", L("Mushroom_Laetiporus", { h: 0.3 }), N(25), dens.nearTrunk, [0.7, 1.3]);
  await add("fly agaric", P.mushroomParts("agaric", 5), N(70), dens.underTree, [0.7, 1.4]);
  await add("brown caps", P.mushroomParts("brown", 8), N(70), dens.underTree, [0.7, 1.4]);
  await add("glow mushrooms", P.mushroomParts("glow", 12), N(55), dens.underTree, [0.8, 1.6]);
  await add("Petals", L("Petal_1", { h: 0.06, ground: false }), N(300), dens.open, [0.8, 1.5], { y: 0.02 });

  // ---- ivy on broadleaf trunks, hanging vines at crowns ----
  const ivyParts = P.ivyParts(0.3, 3.8, 3), vineParts = P.vineParts(2.6, 9);
  const ivyM = [], vineM = [], vr = rng(33);
  for (const bi of broadInfo) {
    if (!bi) continue;
    const tr = trunkRadius(bi.l0.parts), crownY = crownBase(bi.l0.parts);
    bi.positions.forEach(([x, z], i) => {
      if (vr() < 0.55) { const m = new Float32Array(16); composeTRS(m, 0, x, terrainH(x, z) - 0.1, z, vr() * 6.28, tr / 0.3, 0, 0, 1.0); ivyM.push(...m); }
      if (vr() < 0.45) { const m = new Float32Array(16), a = vr() * 6.28, d = tr + 0.9 + vr() * 1.5; composeTRS(m, 0, x + Math.cos(a) * d, terrainH(x, z) + crownY - 2.6, z + Math.sin(a) * d, vr() * 6.28, 0.8 + vr() * 0.6); vineM.push(...m); }
    });
  }
  if (ivyM.length) { const g = instancedParts(ivyParts, Float32Array.from(ivyM), ivyM.length / 16, "ivy"); root.add(g); note("ivy on trunks", ivyM.length / 16, ivyParts); }
  if (vineM.length) { const g = instancedParts(vineParts, Float32Array.from(vineM), vineM.length / 16, "vines"); root.add(g); note("hanging vines", vineM.length / 16, vineParts); }

  // ---- light shafts + mist ----
  root.add(P.lightShafts(8, 4, 22), P.mistSheets(120, 3, 0.25));

  const lodCamera = new THREE.Vector3(1e9, 0, 0);
  return {
    root, info,
    update(camera, frame) { for (const s of lods) s.update(camera, frame === 0); cull.update(camera, frame === 0); },
    lodCounts() { const t = { lod0: 0, lod1: 0, far: 0 }; for (const s of lods) { const c = s.counts(), L = c.length; t.lod0 += c[0]; if (L === 3) t.lod1 += c[1]; t.far += L === 3 ? c[2] : c[1]; } return t; },
    totals() { let t = 0, n = 0; for (const s of info.species) { t += s.tris; n += s.n; } return { species: info.species.length, instances: n }; },
  };
}
function trunkRadius(parts) {
  let r = 0; for (const p of parts) { const a = p.geo.attributes.position; for (let i = 0; i < a.count; i++) { const y = a.getY(i); if (y > 0.9 && y < 1.3) r = Math.max(r, Math.hypot(a.getX(i), a.getZ(i))); } }
  return Math.min(Math.max(r, 0.12), 0.8);
}
function crownBase(parts) {
  let m = 1e9; for (const p of parts) if (p.mat.alphaTest > 0) { p.geo.computeBoundingBox(); m = Math.min(m, p.geo.boundingBox.min.y); } return m === 1e9 ? 3 : m + 0.4;
}
