// BUILT look of a battle arena (Arena Viewer only, look=built): the arena made anew with three.js in an anime
// background style instead of the disc's textured triangles. WHERE things stand comes from the arena's own triangles
// (tools/arena_built_recipe.py -> assets-hd/battle/built/<pack>.json, git-ignored); WHAT each piece is was named once
// per arena (asked of Gemini). Colours are the pieces' own measured colours.
// PLACEMENT and ASSETS are fully separate (web/built/slots.js header):
//   PLACEMENT  web/built/place/<module>.js: the recipe -> SLOTS (positions, rotations, sizes, outlines, measured colours,
//              keep-out rules). No geometry, no material.
//   ASSETS     web/built/registry.js by id (the module defaults "mod.*" are the modules' own geometry + material
//              factories in web/built/<module>.js; the biome gallery; plain surfaces; none).
//   BINDER     web/built/slots.js builds the scene from the slots + the chosen asset of each (default = today's look).
// This file only runs the placements in order, owns the shared KEEP-OUT state and draws the frame.
// KEEP-OUT: no plant / rock whose keep-out spheres come within (farthest fighter + 1000) of the centre, and none inside
// a view cone from the camera to a fighter. The battle camera spins around the fight (the idle director's arms add to
// the shot's Y angle every frame), so every eye height/distance seen is swept round the full circle (3 deg steps).
// The battle renderer draws only the fighters on its own see-through canvas (setBuiltArena) and this world goes under
// it with the same frame's camera (getCameraInfo().render), as the disc arena is.
import * as THREE from "./lib3d/three.module.js";
import * as S from "./built/shared.js";
import { loadColourFit, createColourFit } from "./built/colourfit.js";   // per-layer colour overrides (assets-hd/battle/built/<pack>.colours.json), generic
import { createSlots } from "./built/slots.js";   // the binder (any registry asset into any slot), web/built/registry.js

// The foliage ASSETS (leaf texture, fluffy material, broadleaf / bush / pine geometry) live in web/built/foliage.js;
// re-exported here for older importers.
export { leafClumpTexture, foliageMaterial, buildGeometry, fluffyPart, broadleafGeometry, bushGeometry, pineGeometry } from "./built/foliage.js";

// The placements, in build order: [id, recipe kinds that load it (null = every arena), module, extra layer?]
const PLACEMENTS = [
  ["sky", null, "./built/place/sky.js", false],
  ["ground", null, "./built/place/ground.js", false],
  ["sand", ["sand", "shore"], "./built/place/sand.js", true],
  ["water", ["water", "sea", "pine_mirror", "rock_mirror"], "./built/place/water.js", true],   // preset by recipe: sea/water -> ocean, mirror pieces -> lake
  ["spires", ["spire"], "./built/place/spires.js", true],
  ["gulls", ["gulls"], "./built/place/gulls.js", true],
  ["trees", ["cypress_wall", "cypress_grove", "far_pines"], "./built/place/trees.js", true],   // meft1008 near ring + far painted treeline
  ["boulders", ["rock"], "./built/place/boulders.js", true],   // meft1008 wall_03 boulder piles
  ["mushrooms", ["mushroom"], "./built/place/mushrooms.js", true],
  ["fringe", ["fringe"], "./built/place/fringe.js", true],
  ["floorcover", ["soil"], "./built/place/floorcover.js", true],
  ["mirror", ["pine_mirror", "rock_mirror"], "./built/place/mirror.js", true],   // LAST extra: it derives from what is bound in the slots before it
  ["grass", null, "./built/place/grass.js", false],
  ["foliage", null, "./built/place/foliage.js", false],
];

export async function createArenaBuilt(canvas, pack, opts = {}) {
  const res = await fetch(`assets-hd/battle/built/${pack}.json`, { cache: "no-store" });
  if (!res.ok) return { missing: true, pack };
  const rec = await res.json();
  const fitFile = await loadColourFit(pack);   // null for an arena without a colours file: then nothing below touches a material
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 1, 60000);
  const world = new THREE.Group(); scene.add(world);
  const info = { pack, pieces: {}, instances: {}, foliage: null, keepOut: null };
  const materials = [];
  const pal = S.makePalette(rec);
  S.initNoise(1013);
  S.U.uWindRing.value = 0;   // the travelling ring gust is off unless a placement turns it on (meft1008)

  const colourFit = createColourFit(scene, fitFile, !!globalThis.__fitTool);
  // Choices: <pack>.slots.json (git-ignored, tools/swap_asset.mjs), then the viewer's own (opts.slotChoices).
  const slotFile = await fetch(`assets-hd/battle/built/${pack}.slots.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // env of the ASSETS: shared light / palette / the material list / the frame's camera; never the recipe
  const env = { THREE, S, pal, materials, info, camera, renderer, worldScale: () => world.scale.x };
  const slots = createSlots({ world, scene, env, colourFit, pack, file: slotFile, choices: opts.slotChoices?.() ?? null,
                              fileResetAt: opts.slotFileResetAt?.() ?? 0, onChange: (c) => opts.onSlotsChange?.(c) });

  // ---- keep-out state: the fighters and every eye ring (distance, height) seen so far ----
  // A fighter keeps every place it was seen at (100 units apart) with its largest bounding sphere; an eye ring is a
  // distance/height pair seen (100 units apart). A new place or ring re-runs every placement's place().
  const ko = { fightR: 0, farthest: null, fighters: [], rings: [], built: false, rebuilds: 0 };
  function keepOutChanged(k) {
    if (!k?.fighters?.length) return false;
    let changed = false;
    const far = Math.max(...k.fighters.map((f) => Math.hypot(f.c[0], f.c[2])));
    if (ko.farthest == null || far > ko.farthest + 0.5) { ko.farthest = Math.max(far, ko.farthest ?? 0); changed = true; }
    for (const f of k.fighters) {
      const near = ko.fighters.find((g) => g.side === f.side && Math.hypot(g.c[0] - f.c[0], g.c[1] - f.c[1], g.c[2] - f.c[2]) < 100);
      if (!near) { ko.fighters.push({ side: f.side, c: [...f.c], r: f.r }); changed = true; }
      else if (f.r > near.r + 25) { near.r = f.r; changed = true; }
    }
    for (const e of k.eyes || []) {
      const rr = Math.hypot(e[0], e[2]), y = e[1];
      if (!ko.rings.some((g) => Math.abs(g.r - rr) < 100 && Math.abs(g.y - y) < 100)) { ko.rings.push({ r: rr, y }); changed = true; }
    }
    return changed;
  }
  // a thing's keep-out spheres in the world: shape (slots.js shapeOfParts), position p, uniform scale s, yaw about +Y
  function worldBands(sp, p, s, yaw) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const tf = (o) => ({ c: [p[0] + s * (cs * o.c[0] + sn * o.c[2]), p[1] + s * o.c[1], p[2] + s * (-sn * o.c[0] + cs * o.c[2])], r: s * o.r });
    return sp.bands.map((b) => ({ ...tf(b), tris: b.tris.map(tf) }));
  }
  function rejectReason(bands) {
    for (const b of bands) for (const t of b.tris) if (Math.hypot(t.c[0], t.c[2]) - t.r < ko.fightR) return "fight";
    for (const f of ko.fighters) {
      // the eye swept round the full circle of each ring (the idle camera spins), the fighter where it was seen
      for (const g of ko.rings) for (let a = 0; a < 360; a += 3) {
        const e = [Math.sin(a * Math.PI / 180) * g.r, g.y, Math.cos(a * Math.PI / 180) * g.r];
        for (const b of bands) {
          if (!S.inViewCone(b.c, b.r, e, f.c, f.r)) continue;
          for (const t of b.tris) if (S.inViewCone(t.c, t.r, e, f.c, f.r)) return "cone";
        }
      }
    }
    return null;
  }
  // the ground things stand on = the meshes of the slots that say so (the bound ground surfaces + sand), as bound now
  const groundSlots = [];
  const groundMeshes = () => groundSlots.flatMap((id) => slots.meshesOf(id).filter((m) => m.isMesh && !m.userData?.notGround));
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  function groundHeight(x, z) {
    ray.set(new THREE.Vector3(x, 1e5, z), down);
    const hit = ray.intersectObjects(groundMeshes(), false)[0];
    return hit ? hit.point.y : null;
  }
  const keepOut = { state: null, reject: (c, r) => rejectReason([{ c, r, tris: [{ c, r }] }]) };

  // ---- the placements ----
  const foliageGroup = new THREE.Group(); foliageGroup.name = "foliage";
  const pctx = {
    rec, pal, opts, info, S, world, scene, camera, slots, keepOut, foliageGroup,
    get plans() { return plans; },   // the placements run so far (grass reads the ground's and the sand's surfaces)
    pieces: (kind) => rec.pieces.filter((p) => p.kind === kind),
    ko: { groundHeight, rejectReason, worldBands, state: ko },
    groundMeshes, addGround: (id) => groundSlots.push(id),
    newGroup: (name) => { const g = new THREE.Group(); g.name = name; world.add(g); return g; },   // a parent for a placement's slots
    layer: (id) => layers.find((l) => l.id === id) || null,
  };
  const layers = [], missing = [], plans = {};
  for (const [id, kinds, mod, extra] of PLACEMENTS) {
    if (kinds && !rec.pieces.some((p) => kinds.includes(p.kind))) continue;
    try {
      const plan = await (await import(mod)).plan(pctx);
      if (!plan) continue;
      plans[id] = plan;
      await slots.add(plan.slots || []);
      plan.after?.();
      if (plan.layer && extra) layers.push(Object.assign(plan.layer, { id }));
      else if (plan.layer) plan.layer.id = id;
    } catch (e) {
      if (!extra) throw e;
      missing.push({ id, error: String(e && e.message || e).slice(0, 200), stack: String(e?.stack || "").slice(0, 800) });
    }
  }
  info.layers = Object.fromEntries(layers.map((e) => [e.id, e.info ?? true]));
  if (missing.length) info.missingLayers = missing;
  const fol = plans.foliage;

  function place() {
    const tPlace = performance.now();
    ko.fightR = (ko.farthest ?? 0) + 1000;
    keepOut.state = { fightR: ko.fightR, farthest: ko.farthest ?? 0, rings: ko.rings, fighters: ko.fighters };
    fol?.resetStats();
    slots.place({ ...keepOut.state, ko });   // every slot with a place() rule, with the asset bound to it now
    for (const pl of Object.values(plans)) pl.afterPlace?.(keepOut.state);   // reports (e.g. the tree ring's keep-out touch count)
    ko.built = true; ko.rebuilds++;
    const stats = fol ? fol.stats : {};
    stats.ms = Math.round(performance.now() - tPlace);
    const { round, ...st } = stats;
    info.keepOut = { fightR: Math.round(ko.fightR), farthestFighter: Math.round(ko.farthest ?? 0), rings: ko.rings.map((g) => [Math.round(g.r), Math.round(g.y)]),
                     fighters: ko.fighters.map((f) => ({ side: f.side, c: f.c.map(Math.round), r: Math.round(f.r) })), rebuilds: ko.rebuilds, ...st };
    fol?.report();
  }

  function render(cam) {
    if (!cam) return;
    const k = opts.keepOut?.();
    if (keepOutChanged(k) || (!ko.built && !opts.keepOut)) place();
    S.wind.tick(performance.now());
    renderer.setSize(canvas.width, canvas.height, false);
    camera.fov = cam.fovRad * 180 / Math.PI; camera.aspect = cam.aspect; camera.updateProjectionMatrix();
    camera.position.set(...cam.eye); camera.up.set(...cam.up); camera.lookAt(...cam.look);
    camera.updateMatrixWorld();
    world.scale.setScalar(cam.arenaScale || 1);
    camera.userData.sky?.position.copy(camera.position);
    slots.update(camera, performance.now());   // gulls flap / water moves / LOD with this frame's camera
    if (colourFit.dirty) colourFit.apply();
    renderer.render(scene, camera);
    info.triangles = renderer.info.render.triangles; info.calls = renderer.info.render.calls;
    info.pv = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).toArray();
  }
  return { render, info, renderer, scene, camera, colourFit, slots, materials, foliage: foliageGroup, species: fol?.species || {}, shared: S, groundHeight,
           ground: plans.ground?.layer || null, layers, debug: { candidates: fol?.candidates || {}, worldBands, rejectReason, ko } };
}
