// SHARED tab (used by every biome): sky, clouds, fog/mist, ground materials, rocks, pebbles, grass.
import * as THREE from "three";
import { skyMaterial, groundMaterial, terrainH, scatter, instancedParts, composeTRS, rng, tris, toonMat } from "./toolkit.js";
import { loadToon, partsGroup, loadTex } from "./loader.js";
import * as P from "./procedural.js";
import { ASSETS, q, ph, proc, texDisc, grassPatch } from "./forest.js";

const skySphere = (o) => async () => {
  const g = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 24), skyMaterial({ side: THREE.FrontSide, ...o }));
  m.position.y = 1.5; g.add(m); return g;
};
export const entries = [
  proc("sky_day", "Sky", "Sky dome: gradient + sun glow (12-tri box in game, sphere preview)", skySphere({ clouds: false }), { source: "Procedural (idea: web/built/sky.js gradient)" }),
  proc("sky_clouds", "Clouds", "Toon cloud deck (noise texture, sun-side light)", skySphere({ cloud: 0.55 })),
  proc("sky_overcast", "Clouds", "Toon cloud deck, overcast", skySphere({ cloud: 0.95, zenith: 0x6f86a8, mid: 0x9bb0c8, horizon: 0xcfd9e3 })),
  proc("sky_dusk", "Sky", "Sky dome, warm dusk palette", skySphere({ cloud: 0.4, zenith: 0x3b3f8c, mid: 0xd98a8a, horizon: 0xffd6a0 })),
  proc("mist", "Fog", "Low mist sheets (3 noise cards) + posts", async () => {
    const g = new THREE.Group(); g.add(P.mistSheets(4.2, 3, 0.18));
    const post = new THREE.CylinderGeometry(0.06, 0.08, 1.4, 8), m = toonMat({ color: 0x6a5238 }, { shadeK: 0.7 });
    for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(post, m); p.position.set(-1.5 + (i % 3) * 1.5, 0.7, -1.2 + Math.floor(i / 3) * 2.4); g.add(p); }
    return g;
  }, { source: "Procedural (scene.fog exp2 + mist cards)" }),
  // ground materials
  ...[["aerial_beach_01", "Sand (aerial beach 01)"], ["sand_01", "Sand 01"], ["grass_path_2", "Grass path 2"], ["forest_ground_04", "Forest ground 04"], ["rocky_terrain", "Rocky terrain"],
      ["rocks_ground_01", "Rocks ground 01"], ["gravel_ground_01", "Gravel ground 01"], ["floor_pebbles_01", "Floor pebbles"], ["snow_02", "Snow 02"], ["rock_boulder_cracked", "Cracked boulder rock"]]
    .map(([id, n]) => ({ ...texDisc(id, "Ground materials", n), id: "sh_tex_" + id })),
  { id: "sh_splat", cat: "Ground materials", name: "4-layer splat (grass/rock/gravel/sand)", source: "Poly Haven textures (CC0) + our splat shader", licence: "CC0 1.0", url: "web/biome/toolkit.js groundMaterial", noSpin: true,
    make: async () => {
      const t = await Promise.all(["grass_path_2", "rocky_terrain", "gravel_ground_01", "sand_01"].map((n) => loadTex(`${ASSETS}polyhaven/tex/${n}_diff_1k.jpg`)));
      const g = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.06, 56, 1), groundMaterial(t, { tile: 1.6, splat: [0.45, 0.55, 0.6, 9], tints: [[0.85, 1.1, 0.7], [1, 1, 1], [1, 1, 1], [1, 1, 1]] })); g.position.y = 0.03;
      const grp = new THREE.Group(); grp.add(g); return grp;
    } },
  // rocks
  ...[1, 2, 3].map((i) => ({ ...q("Rock_Medium_" + i, "Rocks"), id: "sh_q_Rock_Medium_" + i, name: "Rock medium " + i })),
  ...["rock_07", "rock_09", "stone_01", "boulder_01"].map((n) => ({ ...ph(n, "Rocks", { name: n.replace("_", " "), t: { grade: true } }), id: "sh_ph_" + n })),
  // pebbles
  ...[1, 2, 3, 4, 5].map((i) => ({ ...q("Pebble_Round_" + i, "Pebbles", { name: "Pebble round " + i, t: { h: 0.12 } }), id: "sh_q_Pebble_Round_" + i })),
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ ...q("Pebble_Square_" + i, "Pebbles", { name: "Pebble square " + i, t: { h: 0.12 } }), id: "sh_q_Pebble_Square_" + i })),
  // grass
  ...["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"].map((n) => ({ ...q(n, "Grass", { name: n.replace(/_/g, " "), t: { h: n.includes("Tall") ? 0.8 : 0.4, wind: 0.7, flutter: 0.4 } }), id: "sh_q_" + n })),
  { ...proc("grass_field", "Grass", "Blade clump field (al-ro style ribbons, GPU wind)", async () => grassPatch()), id: "sh_grass_field" },
];

const HALF = 70;
/** Shared meadow scene: all shared assets together. */
export async function buildShared(ctx) {
  const root = new THREE.Group(), info = { species: [] };
  const note = (name, n, parts) => info.species.push({ name, n, tris: parts ? parts.reduce((a, p) => a + tris(p.geo), 0) : 0 });
  const tex = await Promise.all(["grass_path_2", "rocky_terrain", "gravel_ground_01", "sand_01"].map((n) => loadTex(`${ASSETS}polyhaven/tex/${n}_diff_1k.jpg`)));
  const gg = new THREE.PlaneGeometry(HALF * 2.6, HALF * 2.6, 100, 100); gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, terrainH(gp.getX(i), gp.getZ(i), 1.6)); gg.computeVertexNormals();
  root.add(new THREE.Mesh(gg, groundMaterial(tex, { tile: 3.2, tints: [[0.85, 1.12, 0.65], [1, 1, 1], [1, 1, 1], [1, 1, 1]], splat: [0.5, 0.6, 0.55, 0.55] })));
  const area = [0, 0, HALF, HALF], FD = [30, 55];
  const add = async (name, parts, n, dens, sc) => { const s = scatter(n, name.length * 13 + n, area, dens, { scale: sc }); const g = instancedParts(parts, s.mats, s.count, name); root.add(g); note(name, s.count, parts); };
  const vn = (x, z, f, s) => 0.5 + 0.5 * Math.sin(x * f + s) * Math.cos(z * f * 1.3 + s * 2);
  await add("grass blades", P.grassClumpParts({ seed: 7, blades: 4, segs: 3, h: [0.3, 0.6], tipCol: [0.62, 0.82, 0.25], fade: [26, 50] }), 22000, (x, z) => 0.55 + 0.45 * vn(x, z, 0.09, 1), [0.8, 1.5]);
  await add("grass tall", P.grassClumpParts({ seed: 11, blades: 4, segs: 3, h: [0.6, 1.1], w: 0.045, fade: [26, 50] }), 3500, (x, z) => vn(x, z, 0.06, 5) > 0.55 ? 1 : 0.1, [0.9, 1.5]);
  for (const n of ["Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall"]) await add(n, (await loadToon(`${ASSETS}quaternius/${n}.glb`, { h: n.includes("Tall") ? 0.8 : 0.4, wind: 0.7, flutter: 0.4, fade: FD })).parts, 500, (x, z) => vn(x, z, 0.08, n.length), [0.8, 1.4]);
  for (const n of ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"]) await add(n, (await loadToon(`${ASSETS}quaternius/${n}.glb`, { fade: [80, 120] })).parts, 14, (x, z) => (Math.hypot(x, z) > 5 ? 1 : 0), [0.8, 2.0]);
  for (const n of ["rock_07", "rock_09", "stone_01"]) await add(n, (await loadToon(`${ASSETS}polyhaven/${n}.glb`, { grade: true, fade: [80, 120] })).parts, 12, (x, z) => (Math.hypot(x, z) > 5 ? 1 : 0), [0.8, 1.8]);
  await add("boulder_01", (await loadToon(`${ASSETS}polyhaven/boulder_01.glb`, { grade: true, fade: [100, 140] })).parts, 3, (x, z) => (Math.hypot(x, z) > 14 ? 1 : 0), [1.2, 2]);
  for (let i = 1; i <= 5; i++) await add("Pebble_Round_" + i, (await loadToon(`${ASSETS}quaternius/Pebble_Round_${i}.glb`, { h: 0.12, fade: FD })).parts, 140, () => 0.8, [0.7, 1.6]);
  for (let i = 1; i <= 6; i++) await add("Pebble_Square_" + i, (await loadToon(`${ASSETS}quaternius/Pebble_Square_${i}.glb`, { h: 0.12, fade: FD })).parts, 110, () => 0.8, [0.7, 1.6]);
  return { root, info, update() {} };
}
