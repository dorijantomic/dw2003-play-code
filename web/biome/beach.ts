// BEACH tab: asset grid entries + the assembled beach (sea at -z, sand berm, dunes behind, palms, coastal pines, rocks and tide pools on the right).
// Follows forest.js: entries[] for Grid mode, buildBeach(ctx) for Biome mode. Shore law, ocean, ground shader, procedural assets: beachproc.js.
import * as THREE from "three";
import { toonMat, scatter, composeTRS, instancedParts, LODSpecies, bakeImpostor, rng, tris, skyMaterial, U, CullSet } from "./toolkit.js";
import { loadToon, partsGroup, loadTex } from "./loader.js";
import * as P from "./procedural.js";
import * as B from "./beachproc.js";
import { q, ph, proc, texDisc, ASSETS } from "./forest.js";

const { beachH, shoreZ, POOLS, vnoise, sstep } = B;
const PS = "Poly Haven (decimated, 1K albedo)", CC0 = "CC0 1.0", OWN = "Procedural (our code)";
const T = (id) => loadTex(`${ASSETS}polyhaven/tex/${id}_diff_1k.jpg`);
let _bt = null;
const beachTex = () => _bt || (_bt = Promise.all(["coast_sand_01", "coast_sand_03", "shell_floor_01", "coast_sand_rocks_02", "damp_beach_sand"].map(T)));
const sandMat = async (o) => { const t = await beachTex(); return B.beachGround(t.slice(0, 4), t[4], o); };
const SAND_TINT = [1.9, 1.6, 0.8];     // green grass -> dry sand-yellow dune grass

// ------------------------------------------------------------------ terrain tiles + shore groups (real world coordinates, so the shader shore law applies)
function tile(mat, x0, x1, z0, z1, cell, extra) {
  const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d, Math.max(2, Math.round(w / cell)), Math.max(2, Math.round(d / cell)));
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, beachH(p.getX(i), p.getZ(i)) + (extra ? extra(p.getX(i), p.getZ(i)) : 0));
  g.computeVertexNormals(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, mat); m.name = "ground"; return m;
}
function waterPlane(x0, x1, z0, z1, cell) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.max(2, Math.round((x1 - x0) / cell)), Math.max(2, Math.round((z1 - z0) / cell)));
  g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, B.oceanMaterial()); m.renderOrder = 5; m.frustumCulled = false; m.name = "ocean"; return m;
}
async function shoreGroup(x0, x1, z0, z1, cell, water = true) {
  const grp = new THREE.Group(), gm = tile(await sandMat({}), x0, x1, z0, z1, cell);
  grp.add(gm); if (water) grp.add(waterPlane(x0, x1, z0, z1, cell * 1.5));
  grp.position.y = -gm.geometry.boundingBox.min.y; return grp;
}
const ripple = (x, z) => 0.024 * Math.max(0, Math.sin((z - shoreZ(x)) * 6.5 + 1.0 + Math.sin(x * 0.45) * 1.4));
function clumpField(parts, n, rad, sc = [0.8, 1.3], seed = 8) {
  const r = rng(seed), m = new Float32Array(n * 16), g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.05, rad * 1.05, 0.05, 44), toonMat({ color: 0xd9c79a }, { shadeK: 0.82, rim: 0 })); base.position.y = 0.025; g.add(base);
  for (let i = 0; i < n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; composeTRS(m, i, Math.cos(a) * d, 0.04, Math.sin(a) * d, r() * 6.28, sc[0] + (sc[1] - sc[0]) * r()); }
  g.add(instancedParts(parts, m, n)); return g;
}
/** instanced litter pile on a sand disc: kinds = [{parts, n, scale}] */
function litterDisc(kinds, rad = 1.2, seed = 4, colors = null) {
  const g = new THREE.Group(), r = rng(seed), base = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.1, rad * 1.1, 0.05, 44), toonMat({ color: 0xd2bf93 }, { shadeK: 0.82, rim: 0 })); base.position.y = 0.025; g.add(base);
  for (const k of kinds) {
    const m = new Float32Array(k.n * 16);
    for (let i = 0; i < k.n; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; composeTRS(m, i, Math.cos(a) * d, 0.05, Math.sin(a) * d, r() * 6.28, (k.scale || 1) * (0.8 + 0.5 * r())); }
    const ig = instancedParts(k.parts, m, k.n);
    if (colors) for (const im of ig.children) { for (let i = 0; i < k.n; i++) im.setColorAt(i, colors[Math.floor(r() * colors.length)]); im.instanceColor.needsUpdate = true; }
    g.add(ig);
  }
  return g;
}
const SHELLCOL = ["#ffffff", "#f2d9c4", "#e8e2d0", "#f5c9b8", "#d9c3a0"].map((c) => new THREE.Color(c));
const part = (parts) => partsGroup(parts);
const lean = (grp, a = 0.14) => { grp.rotation.z = -a; const w = new THREE.Group(); w.add(grp); return w; };
async function poolItem(poolIdx, nrock, seed) {
  const [px, pz, pr] = POOLS[poolIdx], grp = new THREE.Group(), x0 = px - 7, x1 = px + 7, z0 = pz - 7, z1 = pz + 7;
  grp.add(tile(await sandMat({}), x0, x1, z0, z1, 0.35));
  const rocks = await loadToon(`${ASSETS}polyhaven/coast_rocks_05.glb`, { h: 0.8, grade: true }); B.algaeify(rocks.parts, 0.95, [0.1, 0.42, 0.2]);
  const r = rng(seed);
  for (let i = 0; i < nrock; i++) {
    const a = (i / nrock) * 6.28 + r() * 0.5, d = pr * 1.35 + r() * 0.9, g = part(rocks.parts), s = 0.35 + 0.45 * r();
    g.position.set(px + Math.cos(a) * d, beachH(px + Math.cos(a) * d, pz + Math.sin(a) * d) - 0.05, pz + Math.sin(a) * d); g.rotation.y = r() * 6.28; g.scale.set(s, s * (0.8 + 0.5 * r()), s); grp.add(g);
  }
  grp.add(poolWater(poolIdx));
  const g0 = new THREE.Group(); g0.add(grp); return g0;
}
function poolWater(i) {
  const [px, pz, pr] = POOLS[i], m = new THREE.Mesh(new THREE.CircleGeometry(pr * 1.12, 36), B.poolMaterial(pr * 1.12));
  m.rotation.x = -Math.PI / 2; m.position.set(px, beachH(px, pz) + 0.36, pz); m.renderOrder = 6; m.name = "pool"; return m;
}
function islands() {
  const g = new THREE.Group(), mat = toonMat({ color: 0x6f8aa6 }, { shadeK: 0.8, rim: 0 }), r = rng(5);
  for (const [x, s] of [[-30, 1.0], [14, 1.5], [46, 0.8]]) {
    const geo = new THREE.PlaneGeometry(40 * s, 14 * s, 40, 8); geo.rotateX(-Math.PI / 2); const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (20 * s), v = p.getZ(i) / (7 * s), e = Math.max(0, 1 - u * u - v * v * 1.6); p.setY(i, Math.pow(e, 0.8) * 5.5 * s * (0.8 + 0.4 * Math.sin(u * 7 + x))); }
    geo.computeVertexNormals(); const m = new THREE.Mesh(geo, mat); m.position.set(x, -0.2, 0); g.add(m);
  }
  return g;
}
const skyBall = async () => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 24), skyMaterial({ side: THREE.FrontSide, zenith: 0x2f7bd8, mid: 0x78bff0, horizon: 0xe4f3fa, cloud: 0.45 })); m.position.y = 1.5; g.add(m); return g; };

// ------------------------------------------------------------------ grid entries
const cat = { sand: "Sand (dry)", wet: "Sand (wet) and shoreline", shelly: "Sand (shelly, gravel)", terr: "Dunes and shore terrain", ocean: "Ocean and surf", dg: "Dune grass", shrub: "Beach shrubs and sea grape",
  succ: "Succulents and ground cover", palm: "Palms", pine: "Coastal pine", drift: "Driftwood", shell: "Shells", weed: "Seaweed and wrack", rock: "Coastal rocks", cliff: "Cliffs and sea stacks",
  pool: "Tide pools", peb: "Pebbles", rtex: "Rock textures", sky: "Sky" };
const tex = (ids, c) => ids.map(([id, n]) => texDisc(id, c, n));
const prox = (id, c, name, make, extra = {}) => proc(id, c, name, make, extra);
const palmEntry = (kind, seed, name) => prox(`palm_${kind}_${seed}`, cat.palm, name, async () => part(B.palmParts(kind, seed, 0)), { url: "web/biome/beachproc.js palmParts" });
const driftPH = (id, name, t = {}, e = {}) => ph(id, cat.drift, { name, t: { grade: true, tint: [1.28, 1.22, 1.1], ...t }, e });
const rawEntries = [
  ...tex([["coast_sand_01", "Coast sand 01"], ["coast_sand_02", "Coast sand 02"], ["coast_sand_03", "Coast sand 03"], ["coast_sand_04", "Coast sand 04"], ["coast_sand_05", "Coast sand 05"],
    ["aerial_sand", "Aerial sand"], ["sand_01", "Sand 01"], ["aerial_beach_01", "Aerial beach 01"], ["aerial_beach_02", "Aerial beach 02"], ["aerial_beach_03", "Aerial beach 03"]], cat.sand),
  ...tex([["damp_beach_sand", "Damp beach sand"], ["damp_beach_sand_02", "Damp beach sand 02"], ["damp_sand", "Damp sand"]], cat.wet),
  prox("wetdry", cat.wet, "Wet to dry sand, hard wet line + swash (shader)", async () => {
    const m = await sandMat({ disc: true, ripples: 0.4 }); const g = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.06, 56, 1), m); g.position.y = 0.03; const grp = new THREE.Group(); grp.add(g); return grp;
  }, { source: PS + " + our shader", licence: CC0, url: "web/biome/beachproc.js beachGround", noSpin: true }),
  ...tex([["gravelly_sand", "Gravelly sand"], ["shell_floor_01", "Shell floor 01"], ["coast_sand_rocks_02", "Coast sand with rocks 02"]], cat.shelly),
  // terrain
  prox("dunes", cat.terr, "Dune field (displaced ridged noise, 4-layer sand splat)", async () => { const g = new THREE.Group(); const m = tile(await sandMat({}), -26, 26, 24, 76, 0.8); g.add(m); g.position.y = -m.geometry.boundingBox.min.y; return g; },
    { source: OWN + ", Poly Haven sand", licence: CC0, url: "web/biome/beachproc.js beachH", noSpin: true }),
  prox("profile", cat.terr, "Beach profile: sea floor, berm, wet line, dune (no water)", async () => { const g = await shoreGroup(-10, 10, -40, 64, 0.7, false); return g; },
    { source: OWN + ", Poly Haven sand", licence: CC0, url: "web/biome/beachproc.js beachH", noSpin: true }),
  prox("ripples", cat.terr, "Rippled sand patch (displaced mesh + shader ripples)", async () => {
    const z = shoreZ(0), m = tile(await sandMat({ ripples: 0.45 }), -3, 3, z + 3.2, z + 9.4, 0.06, ripple); const g = new THREE.Group(); g.add(m); g.position.y = -m.geometry.boundingBox.min.y; return g;
  }, { source: OWN + ", Poly Haven sand", licence: CC0, url: "web/biome/beachproc.js ripple", noSpin: true }),
  prox("islands", cat.terr, "Distant island silhouettes (low-res heightfield)", async () => islands(), { noSpin: false }),
  // ocean
  prox("shore", cat.ocean, "Shore: depth bands + swash foam + sand under water", async () => shoreGroup(-14, 14, -30, 14, 0.5), { source: OWN + ", Poly Haven sand", licence: CC0, url: "web/biome/beachproc.js oceanMaterial", noSpin: true }),
  prox("surf", cat.ocean, "Surf close-up: breaking lines + foam + sparkle", async () => shoreGroup(-8, 8, -19, -6, 0.3), { source: OWN + ", Poly Haven sand", licence: CC0, url: "web/biome/beachproc.js oceanMaterial", noSpin: true }),
  prox("deep", cat.ocean, "Open sea: deep colour bands + vertex waves", async () => shoreGroup(-25, 25, -130, -80, 1.6), { source: OWN + ", Poly Haven sand", licence: CC0, url: "web/biome/beachproc.js oceanMaterial", noSpin: true }),
  prox("spray", cat.ocean, "Sea spray puffs (billboards, pulsing)", async () => {
    const g = new THREE.Group(); const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.06, 40), toonMat({ color: 0xb9c4c4 }, { rim: 0 })); base.position.y = 0.03; g.add(base);
    const sp = B.seaSpray([-3.5, -2, -0.8, 0.6, 2, 3.4], 3, () => 0); sp.position.y = 0.1; sp.scale.setScalar(0.35); g.add(sp); return g;
  }, { noSpin: false }),
  // dune grass
  prox("marram0", cat.dg, "Marram grass (gold-green), ribbon blades, GPU wind", async () => clumpField(B.marramParts(0, 3), 70, 1.2, [0.9, 1.5])),
  prox("marram1", cat.dg, "Marram grass, short pale", async () => clumpField(B.marramParts(1, 3), 90, 1.2, [0.9, 1.5])),
  prox("marram2", cat.dg, "Beach grass, tall green", async () => clumpField(B.marramParts(2, 3), 60, 1.2, [0.9, 1.5])),
  prox("oats", cat.dg, "Sea oats with plumes", async () => clumpField(B.seaOatsParts(2), 26, 1.1, [0.9, 1.4])),
  ...["Grass_Wispy_Tall", "Grass_Wispy_Short", "Grass_Common_Tall"].map((n) => ({ ...q(n, cat.dg, { name: n.replace(/_/g, " ") + " (sand tint)", t: { h: n.includes("Tall") ? 0.9 : 0.45, wind: 0.7, flutter: 0.4, tint: SAND_TINT } }), id: "q_" + n })),
  ph("grass_bermuda_01", cat.dg, { name: "Bermuda grass tuft", t: { wind: 0.6, grade: true } }),
  // shrubs
  ph("searsia_burchellii", cat.shrub, { name: "Searsia burchellii (coastal shrub)", t: { grade: true, wind: 0.25, flutter: 0.4, trans: 0.3 } }),
  ph("searsia_lucida", cat.shrub, { name: "Searsia lucida (coastal shrub)", t: { grade: true, wind: 0.25, flutter: 0.4, trans: 0.3 } }),
  ph("wild_rooibos_bush", cat.shrub, { name: "Wild rooibos bush", t: { grade: true, wind: 0.3, flutter: 0.4 } }),
  q("Bush_Common", cat.shrub, { name: "Coastal bush (Bush Common, salt tint)", t: { wind: 0.3, flutter: 0.5, tint: [1.15, 1.2, 0.85] } }),
  prox("seagrape1", cat.shrub, "Sea grape (round leaves + fruit clusters) A", async () => part(B.seaGrapeParts(1, 1))),
  prox("seagrape2", cat.shrub, "Sea grape, large spreading B", async () => part(B.seaGrapeParts(2, 1.5))),
  // succulents
  ph("cheiridopsis_succulent", cat.succ, { name: "Cheiridopsis succulent", t: { grade: true } }), ph("crystalline_iceplant", cat.succ, { name: "Crystalline iceplant (ground cover)", t: { grade: true } }),
  ph("leipoldtia_schultzei", cat.succ, { name: "Leipoldtia succulent", t: { grade: true } }), ph("othonna_cerarioides", cat.succ, { name: "Othonna cerarioides", t: { grade: true, wind: 0.2 } }),
  ph("didelta_spinosa", cat.succ, { name: "Didelta spinosa", t: { grade: true, wind: 0.2 } }),
  // palms
  palmEntry("coconut", 1, "Coconut palm A (segmented trunk, 15 frond cards, nuts)"), palmEntry("coconut", 2, "Coconut palm B"), palmEntry("curved", 1, "Curved palm A (leaning trunk)"), palmEntry("curved", 2, "Curved palm B"),
  palmEntry("young", 1, "Young palm (short trunk, upright fronds)"), palmEntry("fan", 1, "Fan palm A (fan leaf cards on petioles)"), palmEntry("fan", 2, "Fan palm B"),
  prox("frond", cat.palm, "Palm frond card (alpha-to-coverage, 8 segments)", async () => part(B.frondCardParts())),
  // pines
  ...[2, 3, 4, 5].map((i) => ({ ...q("Pine_" + i, cat.pine, { name: `Coastal pine ${i} (Pine_${i}, wind-leaning, squat)`, t: { wind: 0.3, flutter: 0.5, trans: 0.2, tint: [1.08, 1.05, 0.9] } }), id: "q_Pine_" + i,
    make: async () => { const g = part((await loadToon(`${ASSETS}quaternius/Pine_${i}.glb`, { wind: 0.3, flutter: 0.5, trans: 0.2, tint: [1.08, 1.05, 0.9] })).parts); g.scale.y = 0.85; return lean(g, 0.13); } })),
  // driftwood
  driftPH("dead_quiver_trunk", "Driftwood: quiver tree trunk, bleached", { wind: 0 }), driftPH("dead_quiver_branch_01", "Driftwood: branch 01"), driftPH("dead_quiver_branch_02", "Driftwood: branch 02"),
  driftPH("dead_tree_trunk", "Driftwood: log, bleached"), driftPH("dead_tree_trunk_02", "Driftwood: log with roots, bleached"), driftPH("dry_branches_medium_01", "Driftwood: dry branches"),
  ...[0, 1, 2].map((k) => prox("drift" + k, cat.drift, `Driftwood ${"ABC"[k]} (procedural: grain, roots, fork)`, async () => part(B.driftwoodParts(3, k)))),
  // shells
  ph("lambis_shell", cat.shell, { name: "Lambis (spider conch) shell", t: { grade: true } }),
  ...[["scallop", "Scallop shell (ribbed fan)"], ["conch", "Conch shell (spiral)"], ["whelk", "Whelk shell (tall spiral)"], ["clam", "Clam shell (two valves)"], ["cowrie", "Cowrie shell"], ["dollar", "Sand dollar (shell test)"]]
    .map(([k, n]) => prox("shell_" + k, cat.shell, n, async () => part(B.shellParts(k, 2)))),
  prox("shell_pile", cat.shell, "Shell litter on sand (instanced, 6 kinds, tinted)", async () => litterDisc(["scallop", "conch", "whelk", "clam", "cowrie", "dollar"].map((k, i) => ({ parts: B.shellParts(k, i + 1), n: 9, scale: 7 })), 1.2, 4, SHELLCOL)),
  // seaweed
  prox("wrack1", cat.weed, "Wrack clump A (kelp strands, bladders, sea lettuce)", async () => part(B.wrackParts(1))), prox("wrack2", cat.weed, "Wrack clump B", async () => part(B.wrackParts(2))),
  prox("kelp", cat.weed, "Standing kelp (ribbons, GPU sway)", async () => part(B.kelpParts(1))),
  prox("wrackline", cat.weed, "Wrack line on sand (instanced clumps)", async () => litterDisc([{ parts: B.wrackParts(1), n: 7, scale: 2.2 }, { parts: B.wrackParts(2), n: 6, scale: 2.2 }], 1.2, 6)),
  // rocks
  ...["coast_rocks_05", "coast_land_rocks_02", "coast_land_rocks_03", "coast_land_rocks_04", "sand_rocks_small_01", "coast_rocks_03", "coast_rocks_02", "coast_rocks_01"].map((id) => ph(id, cat.rock, { name: id.replace(/_/g, " "), t: { grade: true } })),
  ...[1, 2, 3].map((i) => q("Rock_Medium_" + i, cat.rock, { name: "Sea-worn rock " + i + " (Rock Medium, warm tint)", t: { tint: [1.25, 1.15, 1.0] } })),
  // cliffs
  ph("coastal_cliff_01", cat.cliff, { name: "Coastal cliff 01", t: { grade: true } }), ph("coastal_cliff_02", cat.cliff, { name: "Coastal cliff 02", t: { grade: true } }), ph("coastal_cliff_04", cat.cliff, { name: "Coastal cliff 04", t: { grade: true } }),
  ph("coast_line_01", cat.cliff, { name: "Coast line 01 (rock platform)", t: { grade: true } }), ph("coast_line_02", cat.cliff, { name: "Coast line 02 (rock platform)", t: { grade: true } }),
  ...[1, 2, 3].map((s) => prox("stack" + s, cat.cliff, `Sea stack ${s} (strata, grassy cap)`, async () => part(B.seaStackParts(s, 9 + s * 2, 2.2 + s * 0.4)))),
  // tide pools
  prox("pool1", cat.pool, "Tide pool A (rocks with algae, banded water)", async () => poolItem(0, 9, 3), { source: OWN + ", Poly Haven rock + sand", licence: CC0, url: "web/biome/beach.js poolItem", noSpin: true }),
  prox("pool2", cat.pool, "Tide pool B (smaller, 7 rocks)", async () => poolItem(1, 7, 5), { source: OWN + ", Poly Haven rock + sand", licence: CC0, url: "web/biome/beach.js poolItem", noSpin: true }),
  prox("pool3", cat.pool, "Tide pool C", async () => poolItem(2, 6, 8), { source: OWN + ", Poly Haven rock + sand", licence: CC0, url: "web/biome/beach.js poolItem", noSpin: true }),
  { ...ph("coast_rocks_05", cat.pool, { name: "Algae rock (shader algae on rock tops)", t: { grade: true } }), id: "ph_algae_rock",
    make: async () => part(B.algaeify((await loadToon(`${ASSETS}polyhaven/coast_rocks_05.glb`, { grade: true })).parts, 0.95, [0.1, 0.42, 0.2])) },
  // pebbles
  ...[["Pebble_Round_1", "Pebble round 1"], ["Pebble_Round_3", "Pebble round 3"], ["Pebble_Square_1", "Pebble square 1"], ["Pebble_Square_4", "Pebble square 4"]].map(([id, n]) => q(id, cat.peb, { name: n + " (light)", t: { h: 0.12, tint: [1.35, 1.3, 1.2] } })),
  ...tex([["pebbles", "Pebbles"], ["large_pebbles", "Large pebbles"], ["floor_pebbles_01", "Floor pebbles 01"]], cat.peb),
  ...tex([["low_tide_rocks", "Low tide rocks"], ["seaside_rock", "Seaside rock"]], cat.rtex),
  prox("sky", cat.sky, "Sky dome, beach palette + toon clouds", skyBall, { source: "Procedural (idea: web/built/sky.js gradient)" }),
];
export const entries = rawEntries.map((e) => ({ ...e, id: "b_" + e.id }));

// ------------------------------------------------------------------ the assembled beach
const HALF = 118;
const wd = new THREE.Vector2(0.8, 0.6).normalize();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(), _pp = new THREE.Vector3(), _ss = new THREE.Vector3(), _mm = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
function composeLean(out, i, x, y, z, yaw, sx, sy, a) {
  _q.setFromAxisAngle(_up, yaw); _ax.set(wd.y, 0, -wd.x); _q2.setFromAxisAngle(_ax, a); _q2.multiply(_q); _pp.set(x, y, z); _ss.set(sx, sy, sx); _mm.compose(_pp, _q2, _ss); out.set(_mm.elements, i * 16);
}
function dart(n, seed, minD, ok, xr = [-HALF, HALF], zr = [-12, 120]) {
  const r = rng(seed), cell = minD, grid = new Map(), out = []; let tries = 0;
  while (out.length < n && tries++ < n * 60) {
    const x = xr[0] + (xr[1] - xr[0]) * r(), z = zr[0] + (zr[1] - zr[0]) * r(); if (ok && !ok(x, z, r)) continue;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell); let bad = false;
    for (let i = -1; i <= 1 && !bad; i++) for (let j = -1; j <= 1 && !bad; j++) for (const p of grid.get((cx + i) + "," + (cz + j)) || []) if (Math.hypot(p[0] - x, p[1] - z) < minD) { bad = true; break; }
    if (bad) continue; out.push([x, z]); const k = cx + "," + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z]);
  }
  return out;
}
/** seeded rejection scatter on beachH. prob(x,z) -> 0..1. o: scale [a,b], y offset, tilt (random up to), tiltFix (always), sy (vertical stretch) */
function bscatter(n, seed, area, prob, o = {}) {
  const r = rng(seed), [cx, cz, hw, hd] = area, out = new Float32Array(n * 16), sc = o.scale || [0.9, 1.2]; let i = 0, tries = 0;
  while (i < n && tries++ < n * 80) {
    const x = cx + (r() * 2 - 1) * hw, z = cz + (r() * 2 - 1) * hd; if (r() > prob(x, z)) continue;
    const s = sc[0] + (sc[1] - sc[0]) * r();
    composeTRS(out, i, x, beachH(x, z) + (o.y || 0), z, r() * 6.28, s, o.tiltFix ?? (o.tilt || 0) * r(), r() * 6.28, o.sy ? s * o.sy : null); i++;
  }
  return { mats: out.subarray(0, i * 16), count: i };
}
export async function buildBeach(ctx) {
  const { renderer, tune = {} } = ctx;
  const root = new THREE.Group(), lods = [], cull = new CullSet(), info = { species: [], impostors: 0 };
  const note = (name, n, parts) => info.species.push({ name, n, tris: parts ? parts.reduce((a, p) => a + tris(p.geo), 0) : 0 });
  const N = (n) => Math.round(n * (tune.density ?? 1));
  const D = (x, z) => z - shoreZ(x);
  const patchy = (x, z, s = 4, f = 0.06) => Math.pow(vnoise(x, z, f, s), 2.0) * 1.9;
  const nearPool = (x, z) => POOLS.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r * 2.2);
  const bandG = (d, c, w) => Math.exp(-(((d - c) / w) ** 2));

  // ---- ground (fine near, coarse far) + ocean + islands
  const gmat = await sandMat({});
  const near = tile(gmat, -100, 100, -48, 125, 1.25); near.name = "ground"; root.add(near);
  const far = tile(gmat, -520, 520, -330, 520, 26, () => -0.22); far.name = "ground far"; root.add(far);
  note("ground (fine 200x173 m, 1.25 m cells)", 1, [{ geo: near.geometry }]); note("ground far (coarse)", 1, [{ geo: far.geometry }]);
  const seaNear = waterPlane(-130, 130, -130, 16, 2.2), seaFar = waterPlane(-650, 650, -620, -129, 22);
  root.add(seaNear, seaFar); note("ocean (toon bands, foam, waves, sparkle)", 2, [{ geo: seaNear.geometry }, { geo: seaFar.geometry }]);
  const isl = islands(); isl.position.set(0, 0, -300); isl.scale.setScalar(2.6); root.add(isl); note("distant islands", 3, null);
  const xs = []; for (let x = -100; x <= 100; x += 3.1) xs.push(x + Math.sin(x) * 0.8);
  const spray = B.seaSpray(xs, 3); root.add(spray); note("sea spray puffs", xs.length, [{ geo: spray.geometry }]);
  for (let i = 0; i < POOLS.length; i++) root.add(poolWater(i));
  note("tide pool water", POOLS.length, null);

  // ---- helpers for instanced species
  const add = (name, parts, n, prob, o = {}) => {
    const s = bscatter(n, name.length * 31 + n, o.area || [0, 55, HALF, 68], (x, z) => (nearPool(x, z) ? 0 : prob(x, z)), o);
    const g = o.colors ? instancedParts(parts, s.mats, s.count, name) : cull.add(parts, s.mats, s.count, name); g.name = name; root.add(g); note(name, s.count, parts);
    if (o.colors) for (const im of g.children) { const r = rng(5); for (let i = 0; i < s.count; i++) im.setColorAt(i, o.colors[Math.floor(r() * o.colors.length)]); im.instanceColor.needsUpdate = true; }
    return s;
  };
  const lodSp = (name, l0, l1, mats, n, dist) => {
    const imp = bakeImpostor(renderer, partsGroup(l0), 8, 256);
    const sp = new LODSpecies(name, [{ parts: l0 }, { parts: l1 }, { impostor: imp.factory }], mats, n, dist); lods.push(sp); root.add(sp.group); note(name, n, l0); info.impostors++;
  };
  const FD = [32, 58], FDS = [60, 90];
  const L = (id, t) => loadToon(`${ASSETS}quaternius/${id}.glb`, { fade: FD, ...t });
  const H = (id, t) => loadToon(`${ASSETS}polyhaven/${id}.glb`, { fade: FD, ...t });

  // ---- palms (hero palms near the start view + dart-thrown groves), LOD0 / LOD1 / impostor
  const hero = [[-9, 4, "coconut", 1], [6, 8, "curved", 1], [14, 3, "young", 1], [-17, 10, "fan", 1], [2, 14, "coconut", 2], [-4, 21, "curved", 2], [22, 15, "coconut", 1], [-26, 6, "fan", 2], [30, 24, "young", 1]];
  const grove = dart(N(64), 21, 5.5, (x, z) => { const d = D(x, z); return d > 9 && d < 58 && vnoise(x, z, 0.035, 1) > 0.3 && !nearPool(x, z) && !hero.some((h) => Math.hypot(h[0] - x, h[1] - z) < 6); });
  const kinds = [["coconut", 1, 3], ["coconut", 2, 2], ["curved", 1, 1], ["curved", 2, 1], ["young", 1, 2], ["fan", 1, 1], ["fan", 2, 1]], tot = kinds.reduce((a, k) => a + k[2], 0);
  for (const [kind, seed, w] of kinds) {
    const pos = hero.filter((h) => h[2] === kind && h[3] === seed).map((h) => [h[0], h[1]]);
    grove.forEach((p, i) => { let a = i % tot, ki = 0; for (let k = 0; k < kinds.length; k++) { if (a < kinds[k][2]) { ki = k; break; } a -= kinds[k][2]; } if (kinds[ki][0] === kind && kinds[ki][1] === seed) pos.push(p); });
    if (!pos.length) continue;
    const r = rng(seed * 7 + kind.length), m = new Float32Array(pos.length * 16);
    pos.forEach(([x, z], i) => composeTRS(m, i, x, beachH(x, z) - 0.05, z, r() * 6.28, 0.85 + 0.4 * r(), 0.02 * r(), r() * 6.28));
    lodSp(`palm ${kind} ${seed}`, B.palmParts(kind, seed, 0), B.palmParts(kind, seed, 1), m, pos.length, [30, 85]);
  }

  // ---- coastal pines (wind-leaning, squat), back dunes
  const pinePos = dart(N(34), 33, 7, (x, z) => { const d = D(x, z); return d > 50 && d < 112 && vnoise(x, z, 0.03, 9) > 0.28; });
  for (const [i, id] of ["Pine_2", "Pine_3", "Pine_4"].entries()) {
    const pos = pinePos.filter((_, k) => k % 3 === i); if (!pos.length) continue;
    const t = { wind: 0.3, flutter: 0.5, trans: 0.2, tint: [1.08, 1.05, 0.9] };
    const l0 = await loadToon(`${ASSETS}quaternius/${id}.glb`, t), l1 = await loadToon(`${ASSETS}quaternius/${id}_lod1.glb`, t), r = rng(40 + i), m = new Float32Array(pos.length * 16);
    pos.forEach(([x, z], k) => { const s = 0.85 + 0.45 * r(); composeLean(m, k, x, beachH(x, z) - 0.1, z, r() * 6.28, s * 1.1, s * 0.85, 0.12 + 0.08 * r()); });
    lodSp(`coastal ${id}`, l0.parts, l1.parts, m, pos.length, [50, 120]);
  }

  // ---- big rock platforms, cliffs, sea stacks (single meshes)
  const big = async (id, h, x, z, yaw, o = {}) => {
    const t = await loadToon(`${ASSETS}polyhaven/${id}.glb`, { h, grade: true, ...o }), g = partsGroup(t.parts);
    g.position.set(x, beachH(x, z) + (o.y || -0.3), z); g.rotation.y = yaw; root.add(g); note(id, 1, t.parts);
  };
  await big("coast_rocks_03", 2.6, 72, shoreZ(72) + 15, 0.4); await big("coast_rocks_02", 2.8, -108, shoreZ(-108) + 20, 1.0);
  await big("coast_rocks_01", 3.0, 112, shoreZ(112) + 24, 2.2); await big("coast_line_01", 2.4, -100, shoreZ(-100) + 2, 0.3, { y: -0.6 }); await big("coast_line_02", 2.2, 98, shoreZ(98) - 4, 1.2, { y: -0.6 });
  await big("coastal_cliff_01", 10, -118, 28, Math.PI / 2, { y: -1.2 }); await big("coastal_cliff_02", 10, 124, 48, -Math.PI / 2, { y: -1.2 }); await big("coastal_cliff_04", 14, 0, 135, 0, { y: -1.5 });
  for (const [i, [x, z, Rr, Hh]] of [[-38, -46, 2.8, 12], [22, -64, 3.6, 14], [60, -36, 2.4, 9], [-72, -30, 3.0, 11]].entries()) {
    const parts = B.seaStackParts(i + 1, Hh, Rr), g = partsGroup(parts); g.position.set(x, beachH(x, z) + 0.9, z); g.rotation.y = i; root.add(g); note("sea stack " + (i + 1), 1, parts);
  }

  // ---- tide-pool rocks with algae around each pool
  {
    const rk = await loadToon(`${ASSETS}polyhaven/coast_rocks_05.glb`, { h: 0.8, grade: true, fade: FDS }); B.algaeify(rk.parts, 0.95, [0.1, 0.42, 0.2]);
    const m = new Float32Array(POOLS.length * 9 * 16), r = rng(77); let k = 0;
    for (const [px, pz, pr] of POOLS) for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.28 + r() * 0.5, d = pr * 1.35 + r() * 0.9, x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d, s = 0.35 + 0.45 * r(); composeTRS(m, k++, x, beachH(x, z) - 0.05, z, r() * 6.28, s, 0, 0, s * (0.8 + 0.5 * r())); }
    const g = instancedParts(rk.parts, m, k, "tide pool rocks"); root.add(g); note("tide pool rocks (algae)", k, rk.parts);
  }
  const rightShelf = (x, z) => sstep(30, 48, x) * (1 - sstep(80, 100, x)) * sstep(1, 4, D(x, z)) * (1 - sstep(20, 34, D(x, z)));
  await add("coast_land_rocks_03", (await H("coast_land_rocks_03", { h: 0.9, grade: true, fade: FDS })).parts, N(7), (x, z) => rightShelf(x, z) * 0.9, { scale: [0.5, 1.1] });
  await add("coast_land_rocks_04", (await H("coast_land_rocks_04", { h: 0.8, grade: true, fade: FDS })).parts, N(6), (x, z) => rightShelf(x, z) * 0.9, { scale: [0.4, 0.9] });
  await add("coast_land_rocks_02", (await H("coast_land_rocks_02", { h: 0.9, grade: true, fade: FDS })).parts, N(5), (x, z) => rightShelf(x, z) * 0.8, { scale: [0.4, 0.9] });
  await add("coast_rocks_05", (await H("coast_rocks_05", { h: 0.9, grade: true, fade: FDS })).parts, N(34), (x, z) => (D(x, z) > -2 && D(x, z) < 40 ? 0.05 + 0.5 * rightShelf(x, z) + 0.2 * Math.abs(x) / HALF * patchy(x, z, 2, 0.05) : 0), { scale: [0.5, 1.3] });
  await add("sand_rocks_small_01", (await H("sand_rocks_small_01", { h: 0.35, grade: true, fade: FDS })).parts, N(16), (x, z) => (D(x, z) > 1 && D(x, z) < 30 ? 0.3 * patchy(x, z, 6, 0.04) : 0), { scale: [0.7, 1.4] });
  for (let i = 1; i <= 3; i++) await add("Rock_Medium_" + i, (await L("Rock_Medium_" + i, { fade: FDS, tint: [1.25, 1.15, 1.0] })).parts, N(5), (x, z) => (D(x, z) > 0 && D(x, z) < 50 ? 0.4 * patchy(x, z, 7 + i, 0.03) : 0), { scale: [0.5, 1.1] });

  // ---- dune vegetation
  const dunes = (x, z, c = 20) => sstep(c - 6, c + 6, D(x, z));
  await add("marram gold", B.marramParts(0, 3), N(3800), (x, z) => dunes(x, z, 22) * (0.2 + 0.8 * patchy(x, z, 4, 0.05)), { scale: [0.8, 1.5] });
  await add("marram pale", B.marramParts(1, 3), N(2600), (x, z) => dunes(x, z, 16) * (0.15 + 0.85 * patchy(x, z, 6, 0.045)), { scale: [0.8, 1.5] });
  await add("beach grass tall", B.marramParts(2, 4), N(1900), (x, z) => dunes(x, z, 32) * patchy(x, z, 8, 0.04), { scale: [0.8, 1.5] });
  await add("sea oats", B.seaOatsParts(2), N(300), (x, z) => dunes(x, z, 24) * patchy(x, z, 11, 0.05), { scale: [0.8, 1.4] });
  await add("Grass_Wispy_Tall", (await L("Grass_Wispy_Tall", { h: 0.9, wind: 0.7, flutter: 0.4, tint: SAND_TINT })).parts, N(260), (x, z) => dunes(x, z, 28) * patchy(x, z, 12, 0.05), { scale: [0.8, 1.3] });
  await add("Grass_Common_Tall", (await L("Grass_Common_Tall", { h: 0.7, wind: 0.7, flutter: 0.4, tint: SAND_TINT })).parts, N(220), (x, z) => dunes(x, z, 30) * patchy(x, z, 13, 0.05), { scale: [0.8, 1.3] });
  await add("sea grape A", B.seaGrapeParts(1, 1), N(70), (x, z) => (D(x, z) > 14 ? 0.8 * patchy(x, z, 14, 0.04) : 0), { scale: [0.8, 1.5] });
  await add("sea grape B", B.seaGrapeParts(2, 1.5), N(40), (x, z) => (D(x, z) > 18 ? 0.8 * patchy(x, z, 15, 0.04) : 0), { scale: [0.8, 1.4] });
  await add("searsia_burchellii", (await H("searsia_burchellii", { h: 2.0, grade: true, wind: 0.25, flutter: 0.4, trans: 0.3, fade: FDS })).parts, N(11), (x, z) => (D(x, z) > 30 ? 0.7 * patchy(x, z, 16, 0.04) : 0), { scale: [0.8, 1.3] });
  await add("searsia_lucida", (await H("searsia_lucida", { h: 1.5, grade: true, wind: 0.25, flutter: 0.4, trans: 0.3, fade: FDS })).parts, N(22), (x, z) => (D(x, z) > 24 ? 0.8 * patchy(x, z, 17, 0.04) : 0), { scale: [0.8, 1.3] });
  await add("wild_rooibos_bush", (await H("wild_rooibos_bush", { grade: true, wind: 0.3, flutter: 0.4 })).parts, N(60), (x, z) => (D(x, z) > 18 ? 0.8 * patchy(x, z, 18, 0.05) : 0), { scale: [0.6, 1.2] });
  await add("Bush_Common (salt tint)", (await L("Bush_Common", { h: 1.1, wind: 0.3, flutter: 0.5, tint: [1.15, 1.2, 0.85] })).parts, N(36), (x, z) => (D(x, z) > 26 ? 0.6 * patchy(x, z, 19, 0.045) : 0), { scale: [0.8, 1.4] });
  await add("cheiridopsis", (await H("cheiridopsis_succulent", { grade: true, fade: FD })).parts, N(80), (x, z) => (D(x, z) > 12 ? 0.6 * patchy(x, z, 20, 0.07) : 0), { scale: [0.5, 1.0] });
  await add("crystalline iceplant", (await H("crystalline_iceplant", { grade: true, fade: FD })).parts, N(90), (x, z) => (D(x, z) > 10 ? 0.6 * patchy(x, z, 21, 0.07) : 0), { scale: [0.5, 1.1] });
  await add("leipoldtia", (await H("leipoldtia_schultzei", { grade: true, fade: FD })).parts, N(60), (x, z) => (D(x, z) > 14 ? 0.6 * patchy(x, z, 22, 0.07) : 0), { scale: [0.5, 1.0] });
  await add("othonna", (await H("othonna_cerarioides", { h: 1.0, grade: true, wind: 0.2, fade: FDS })).parts, N(14), (x, z) => (D(x, z) > 28 ? 0.6 * patchy(x, z, 23, 0.05) : 0), { scale: [0.7, 1.2] });
  await add("didelta", (await H("didelta_spinosa", { h: 1.2, grade: true, wind: 0.2, fade: FDS })).parts, N(14), (x, z) => (D(x, z) > 30 ? 0.6 * patchy(x, z, 24, 0.05) : 0), { scale: [0.7, 1.2] });

  // ---- tide line: wrack, shells, driftwood, pebbles; kelp under the surf
  const tideLine = (x, z) => bandG(D(x, z), 4.0, 1.1) * (0.35 + 0.65 * patchy(x, z, 30, 0.07));
  for (let i = 1; i <= 3; i++) await add("wrack " + i, B.wrackParts(i), N(100), tideLine, { scale: [0.9, 1.7], y: 0.01 });
  const shellZone = (x, z) => bandG(D(x, z), 3.8, 2.4) * (0.4 + 0.6 * patchy(x, z, 33, 0.09));
  for (const [i, k] of ["scallop", "conch", "whelk", "clam", "cowrie", "dollar"].entries()) await add("shell " + k, B.shellParts(k, i + 1), N(90), shellZone, { scale: [0.8, 1.5], y: 0.01, colors: SHELLCOL });
  await add("lambis shell", (await H("lambis_shell", { grade: true, fade: FD })).parts, N(60), shellZone, { scale: [0.8, 1.4], y: 0.01 });
  const driftZ = (x, z) => bandG(D(x, z), 9.5, 4.5) * (0.2 + 0.8 * patchy(x, z, 35, 0.04));
  const dw = { grade: true, tint: [1.28, 1.22, 1.1], fade: FDS };
  for (let k = 0; k < 3; k++) await add("driftwood " + "ABC"[k], B.driftwoodParts(3, k), N(14), driftZ, { scale: [0.8, 1.6] });
  await add("dead_tree_trunk (bleached)", (await H("dead_tree_trunk", dw)).parts, N(8), driftZ, { scale: [0.7, 1.3], y: 0.05 });
  await add("dead_tree_trunk_02 (bleached)", (await H("dead_tree_trunk_02", dw)).parts, N(5), driftZ, { scale: [0.5, 1.0], y: 0.0 });
  await add("dead_quiver_trunk (laid)", (await H("dead_quiver_trunk", dw)).parts, N(8), driftZ, { scale: [0.7, 1.3], y: 0.1, tiltFix: 1.45 });
  await add("dead_quiver_branch_01", (await H("dead_quiver_branch_01", dw)).parts, N(16), driftZ, { scale: [0.8, 1.6] });
  await add("dead_quiver_branch_02", (await H("dead_quiver_branch_02", dw)).parts, N(16), driftZ, { scale: [0.8, 1.6] });
  await add("dry_branches (driftwood)", (await H("dry_branches_medium_01", dw)).parts, N(14), driftZ, { scale: [0.6, 1.1] });
  const pebZone = (x, z) => (D(x, z) > 0.5 && D(x, z) < 18 ? (0.1 + 0.9 * bandG(D(x, z), 6, 6)) * (0.2 + 0.8 * patchy(x, z, 38, 0.05)) + 0.5 * rightShelf(x, z) : 0);
  for (const id of ["Pebble_Round_1", "Pebble_Round_3", "Pebble_Square_1", "Pebble_Square_4"]) await add(id, (await L(id, { h: 0.1, tint: [1.35, 1.3, 1.2] })).parts, N(300), pebZone, { scale: [0.6, 1.6] });
  await add("kelp (standing)", B.kelpParts(1), N(150), (x, z) => (D(x, z) < -1.5 && D(x, z) > -9 ? 0.7 * patchy(x, z, 40, 0.06) : 0), { scale: [0.8, 1.4], area: [0, -6, HALF, 8] });

  // ---- surf mist / haze
  const mist = P.mistSheets(260, 2, 0.35); root.add(mist); note("coastal haze sheets", 2, null);

  return {
    root, info,
    update(camera, frame) { for (const s of lods) s.update(camera, frame === 0); cull.update(camera, frame === 0); },
    lodCounts() { const t = { lod0: 0, lod1: 0, far: 0 }; for (const s of lods) { const c = s.counts(); t.lod0 += c[0]; t.lod1 += c[1] || 0; t.far += c[2] || 0; } return t; },
  };
}
