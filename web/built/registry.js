// ASSET REGISTRY of the built arenas: every thing that can stand in a slot, by id. ASSETS know NOTHING about where they go
// (placement lives in web/built/slots.js as slot data). One entry = { id, name, kinds[], source, licence, group, make(env) }.
//   make(env) -> a NORMALISED asset { id, parts: [{ geo, mat, attrs? }], h, r, surfaceMat?, toolkit?, dispose() }:
//     - origin at the base centre, height <= 1 (a wide flat thing is scaled so its half width is 1), r = half width (footprint)
//     - mat = ready to draw instanced (per-instance matrix + instanceColor multiply); colour fit (web/built/colourfit.js)
//       patches ANY of these by the layer name of the mesh the binder puts it in, so a swapped slot keeps its fit
//     - attrs = constant per-instance attributes a module shader needs ({ aFade: [1 float, fill 1] }), made by the binder
//   env = { THREE, S (shared.js), pal, rec } of the arena that is asked; a biome asset ignores env.
// Sources: (1) built  = our own pieces of web/built/*.js and web/arena-built.js (geometry + material factories, same code the
// arena modules call); (2) biome  = the gallery entries web/biome/*.js (Quaternius CC0, Poly Haven CC0, KayKit, OGA, Sketchfab
// anime CC-BY, procedural); (3) surface = plain painted surfaces (ground, water, sky gradients); (4) none = draw nothing.
import * as THREE from "../lib3d/three.module.js";

export const REGISTRY = new Map();
export function register(def) { REGISTRY.set(def.id, def); return def; }

// ------------------------------------------------------------------ normalise
const _b = new THREE.Box3();
/** Parts [{geo, mat}] in any units/placement -> base at y 0 and the xz centre at 0, height <= 1 (half width <= 1). Geometry is cloned. */
export function normaliseParts(parts, { assume = false } = {}) {
  for (const p of parts) p.geo.computeBoundingBox();
  _b.makeEmpty(); for (const p of parts) _b.union(p.geo.boundingBox);
  const size = _b.getSize(new THREE.Vector3()), c = _b.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, size.z);
  const k = assume ? 1 : 1 / Math.max(size.y, w * 0.5, 1e-6);
  const dx = assume ? 0 : -c.x, dz = assume ? 0 : -c.z, dy = assume ? 0 : -_b.min.y;
  const m = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(dx, dy, dz));
  if (!assume) for (const p of parts) { p.geo = p.geo.clone(); p.geo.applyMatrix4(m); p.geo.computeBoundingBox(); p.geo.computeBoundingSphere(); }
  _b.makeEmpty(); for (const p of parts) _b.union(p.geo.boundingBox);
  const s2 = _b.getSize(new THREE.Vector3());
  return { h: Math.max(s2.y, 1e-6), r: Math.max(0.5 * Math.max(s2.x, s2.z), 1e-6) };
}

// ------------------------------------------------------------------ plain toon material (built light, instanced, no wind)
/** One flat painted colour through the shared toon light + aerial haze. col = linear THREE.Color. */
export function plainMaterial(S, col, { name = "plain", rim = 0.3 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uBase: { value: new THREE.Vector3(col.r, col.g, col.b) } }),
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying vec3 vTint; uniform vec3 uBase;
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        vTint = uBase;
        #ifdef USE_INSTANCING_COLOR
          vTint *= instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vW; varying vec3 vN; varying vec3 vTint;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        if (!gl_FrontFacing) N = -N;
        vec3 col = toonLight(vTint, N, V, vW, 1.0, ${rim.toFixed(2)});
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  m.name = name;
  return m;
}
/** A sky gradient seen from inside: horizon -> zenith by the view direction (linear THREE.Color). */
export function skyGradientMaterial(S, horizon, mid, zenith, name = "skyGradient") {
  return new THREE.ShaderMaterial({
    name, uniforms: { uH: { value: new THREE.Vector3(horizon.r, horizon.g, horizon.b) }, uM: { value: new THREE.Vector3(mid.r, mid.g, mid.b) }, uZ: { value: new THREE.Vector3(zenith.r, zenith.g, zenith.b) } },
    vertexShader: /* glsl */`varying vec3 vD; void main() { mat4 im = mat4(1.0);
      #ifdef USE_INSTANCING
        im = instanceMatrix;
      #endif
      vec4 w = modelMatrix * im * vec4(position, 1.0); vD = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`uniform vec3 uH, uM, uZ; varying vec3 vD;
      void main() { float t = clamp(normalize(vD).y, 0.0, 1.0); vec3 c = t < 0.35 ? mix(uH, uM, t / 0.35) : mix(uM, uZ, (t - 0.35) / 0.65);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, depthWrite: false,
  });
}

// ------------------------------------------------------------------ built entries
const lin = (env, c, k = 1) => env.S.srgb(c, k);
const firstPiece = (env, kind) => env.rec?.pieces?.find((p) => p.kind === kind);
/** cypress colours: the arena's own piece when it has one, else the palette's crown colours */
function cypCols(env, kind) {
  const p = firstPiece(env, kind), { pal } = env;
  if (p?.colours) { const c = p.colours; return { bottom: lin(env, c.bottom || c.all), top: lin(env, c.top || c.all), tip: lin(env, c.p90 || c.all), mid: lin(env, c.green || c.all) }; }
  return { bottom: pal.crownShade, top: pal.crownMid, tip: pal.crownLit, mid: pal.crownMid };
}
const toSrgb255 = (c) => { const q = c.clone().convertLinearToSRGB(); return [q.r * 255, q.g * 255, q.b * 255]; };
const one = (geo, mat, extra = {}) => ({ parts: [{ geo, mat, ...extra }], assume: true });

function builtDefs() {
  const L = [];
  const add = (id, name, kinds, make, source = "Built (our code)", licence = "own code") => L.push({ id, name, kinds, source, licence, group: "built", make });
  // --- trees (web/arena-built.js, web/built/trees.js)
  add("built.broadleaf", "Fluffy broadleaf tree (ez-tree boughs + fluffytree crown)", ["tree", "broadleaf"], async (env) => {
    const A = await import("../arena-built.js"), geo = A.broadleafGeometry(21, env.pal);
    const hi = [env.pal.crownLit, env.pal.crownMid].map((c) => c);
    const hiTint = ["r", "g", "b"].map((c) => hi[0][c] / Math.max(hi[1][c], 1e-4));
    return one(geo, A.foliageMaterial(A.leafClumpTexture(), geo.userData.crown, hiTint));
  }, "Built: ez-tree (MIT) + fluffytree (MIT)", "MIT");
  add("built.bush", "Fluffy bush", ["bush", "shrub"], async (env) => {
    const A = await import("../arena-built.js"), geo = A.bushGeometry(7, env.pal);
    const hiTint = ["r", "g", "b"].map((c) => env.pal.bushLit[c] / Math.max(env.pal.bushMid[c], 1e-4));
    const r = one(geo, A.foliageMaterial(A.leafClumpTexture(), geo.userData.crown, hiTint)); return r;
  }, "Built: fluffytree (MIT)", "MIT");
  add("built.pine", "Cone-stack pine", ["tree", "pine", "conifer"], async (env) => {
    const A = await import("../arena-built.js"), geo = A.pineGeometry(11, env.pal);
    return one(geo, A.foliageMaterial(A.leafClumpTexture(), geo.userData.crown, [1, 1, 1]));
  });
  add("built.cypress_wall", "Tall cypress (wall ring)", ["tree", "cypress", "conifer"], async (env) => {
    const T = await import("./trees.js"), geo = T.cypressGeometry(THREE, T.WALL, T.WALL.H0 + T.WALL.HR / 2, 31);
    return one(geo, T.cypressMaterial(THREE, env.S, cypCols(env, "cypress_wall")));
  });
  add("built.cypress_grove", "Cypress (grove)", ["tree", "cypress", "conifer"], async (env) => {
    const T = await import("./trees.js"), geo = T.cypressGeometry(THREE, T.GROVE, T.GROVE.H0 + T.GROVE.HR / 2, 47);
    return one(geo, T.cypressMaterial(THREE, env.S, cypCols(env, "cypress_grove")));
  });
  add("built.shrub", "Shrub (grove foot)", ["bush", "shrub"], async (env) => {
    const T = await import("./trees.js"), c = cypCols(env, "cypress_grove"), s = T.shrubSpecies(THREE, env.S, c);
    return one(s.geo, s.mat);
  });
  add("built.pine_far", "Far pine (needle whorls)", ["tree", "pine", "conifer"], async (env) => {
    const T = await import("./trees.js"), geo = T.pineGeometry(THREE, 9000);
    const p = firstPiece(env, "far_pines"), pc = p?.colours;
    const greens = pc ? { lo: pc.p10 || pc.all, mid: pc.green || pc.all, hi: pc.all } : { lo: toSrgb255(env.pal.crownShade), mid: toSrgb255(env.pal.needleMid), hi: toSrgb255(env.pal.needleLit) };
    return one(geo, T.pineMaterial(THREE, env.S, greens));
  });
  // --- MODULE DEFAULT ASSETS: what each placement slot of web/built/place/*.js draws by default (the arena modules'
  //     own factories; geometry + material only). Each also works in any other slot (instanced parts).
  const mod = (id, name, kinds, make, source = "Built (our code)", licence = "own code") => L.push({ id, name, kinds, source, licence, group: "module", make });
  for (const [sp, nm, kinds] of [["broadleaf", "Fluffy broadleaf (arena default)", ["tree", "broadleaf"]], ["pine", "Cone-stack pine (arena default)", ["tree", "pine", "conifer"]], ["bush", "Fluffy bush (arena default)", ["bush", "shrub"]]])
    mod("mod." + sp, nm, kinds, async (env) => {
      const Fo = await import("./foliage.js");
      env.shared ||= {};
      const a = Fo.speciesAsset(sp, env.pal, (env.shared.leafTex ||= Fo.leafClumpTexture()));
      env.materials?.push(a.mat);
      return { parts: [{ geo: a.geo, mat: a.mat }], assume: true };
    }, "Built: ez-tree (MIT) + fluffytree (MIT)", "MIT");
  mod("mod.boulder_piles", "Boulder piles (arena default)", ["rock", "boulder"], async (env, slot) => {
    const B = await import("./boulders.js");
    return { build: (s, ctx) => B.buildBoulders(s, ctx), parts: [B.boulderPart(env, slot?.data?.pieces?.[0]?.colours)], assume: true };
  });
  mod("mod.gulls", "Seagull flock (arena default)", ["bird", "gull"], async (env) => {
    const G = await import("./gulls.js");
    const col = { white: env.S.srgb([247, 245, 250]), shade: env.S.srgb([196, 200, 241]), tip: env.S.srgb([15, 19, 29]), beak: env.S.srgb(G.GULL.ACCENT_FALLBACK) };
    return { build: (s, ctx) => G.buildGulls(s, ctx), parts: [{ geo: G.gullGeometry(), mat: G.gullMaterial(env.S, col), attrs: { aGull: [3, 0.5] } }] };
  });
  const mushPart = async (env) => {
    const M = await import("./mushrooms.js"), S = env.S, geo = M.mushroomGeometry(THREE, M.MUSH.SEGMENTS);
    const uni = { uMusTime: { value: 0 }, uGlowCol: { value: new THREE.Color(0.55, 0.92, 1.0) }, uStemCol: { value: new THREE.Color(0.55, 0.62, 0.6) }, uCapCol: { value: new THREE.Color(0.75, 0.85, 0.85) },
      uGlowK: { value: M.MUSH.GLOW_K }, uNightK: { value: M.MUSH.GLOW_DAY }, uGlow: { value: 1.0 }, uGillN: { value: M.MUSH.GILL_N }, uPulseW: { value: M.MUSH.PULSE_W },
      uHaloK: { value: M.MUSH.HALO_K }, uPoolK: { value: M.MUSH.POOL_K }, uSporeK: { value: 0.75 }, uSporeScale: { value: 1 }, uSporeMaxPx: { value: 1 } };
    return { geo, mat: M.mushroomMaterial(S, {}, uni), attrs: { aPhase: [1, 0], aFade: [1, 1] } };
  };
  mod("mod.mushrooms", "Glowing mushroom cluster (arena default)", ["mushroom", "plant"], async (env) => {
    const M = await import("./mushrooms.js");
    return { build: (s, ctx) => M.buildMushrooms(s, ctx), parts: [await mushPart(env)], assume: true };
  });
  mod("mod.fringe", "Reed / grass clump with its reflection (arena default)", ["grass", "reed"], async (env) => {
    const Fr = await import("./fringe.js");
    // any other slot: one clump of the same blades (a single 1-unit card) in the same wind shader
    const one = { c: [0, 0, 0], r: 0, az: 0, w: 1, half: 1, blades: Array.from({ length: 24 }, (_, b) => ({ foot: [(b / 23 - 0.5) * 0.8, 0, ((b * 7) % 5 - 2) * 0.05], H: 0.6 + 0.4 * ((b * 5) % 7) / 6, yaw: b * 2.4, bw: 0.05, bow: 0.25, tint: 0.9 + 0.2 * ((b * 3) % 4) / 3 })) };
    const made = Fr.buildFringe({ data: { clusters: [one], colours: {} } }, { S: env.S, info: null, materials: null });
    return { build: (s, ctx) => Fr.buildFringe(s, ctx), parts: [{ geo: made.geo, mat: made.material }], assume: true };
  });
  // the tree ring of a forest-and-lake arena (web/built/trees.js); colours = the slot's measured piece colours in its own
  // slot, the palette's crown colours anywhere else
  const ringCols = (env, slot, id) => (slot?.default === id && slot.data?.colours) || null;
  const palCols = (env) => { const q = (c) => toSrgb255(c); return { bottom: q(env.pal.crownShade), top: q(env.pal.crownMid), all: q(env.pal.crownMid), p90: q(env.pal.crownLit), green: q(env.pal.crownMid) }; };
  for (const which of ["wall", "grove"])
    mod("mod.cypress_" + which, `Cypress ${which} (arena default)`, ["tree", "cypress", "conifer"], async (env, slot) => {
      const T = await import("./trees.js"), a = T.cypressAsset(THREE, env.S, which, ringCols(env, slot, "mod.cypress_" + which) || palCols(env));
      env.materials?.push(a.mat);
      return { parts: [a], assume: true };
    });
  mod("mod.shrub", "Shrub + solid foot (arena default)", ["bush", "shrub"], async (env, slot) => {
    const T = await import("./trees.js"), parts = T.shrubAsset(THREE, env.S, ringCols(env, slot, "mod.shrub") || palCols(env));
    for (const p of parts) env.materials?.push(p.mat);
    return { parts, assume: true };
  });
  mod("mod.far_pines", "Far pines, 4 variants (arena default)", ["tree", "pine", "conifer"], async (env, slot) => {
    const T = await import("./trees.js");
    const greens = (slot?.default === "mod.far_pines" && slot.data?.greens) || { lo: toSrgb255(env.pal.crownShade), mid: toSrgb255(env.pal.needleMid), hi: toSrgb255(env.pal.needleLit) };
    const a = T.farPinesAsset(THREE, env.S, greens);
    env.materials?.push(a.mat);
    return { variants: a.geos.map((geo) => [{ geo, mat: a.mat }]), assume: true };
  });
  for (const kind of ["fern", "clover", "tuft", "litter", "twig", "pebble"])
    mod("mod.fc_" + kind, `Forest floor ${kind} (arena default)`, kind === "pebble" ? ["rock", "litter"] : kind === "litter" || kind === "twig" ? ["litter"] : ["plant", "ground cover"], async (env) => {
      const F = await import("./floorcover.js");
      env.shared ||= {};
      const a = F.coverAsset(kind, (env.shared.fcUniforms ||= F.coverUniforms()));
      env.materials?.push(a.mat);
      return { parts: a.parts, lod: a.lod, update: a.update, assume: true };
    });
  // surfaces of the arena modules: build() from their own slot's data; any other surface slot gets a plain material
  // of their measured colour, any other slot a flat disc of it
  const surfMod = (id, name, kinds, file, fn, colOf) => mod(id, name, ["surface", ...kinds], async (env, slot) => {
    const Mo = await import(file), mat = plainMaterial(env.S, colOf(Mo, env, slot), { name: id, rim: 0.0 });
    return { build: (s, ctx) => Mo[fn](s, ctx), parts: [{ geo: new THREE.CylinderGeometry(1, 1, 0.04, 28, 1), mat }], surfaceMat: mat, assume: true };
  });
  surfMod("mod.sand", "Beach sand + shore band (arena default)", ["ground", "sand"], "./sand.js", "buildSand",
    (Mo, env, slot) => Mo.sandSurfaceMaterial(slot?.default === "mod.sand" ? slot.data?.pieces?.find((p) => p.kind === "sand")?.colours : null));
  surfMod("mod.water", "Sea / lake surface with its horizon band (arena default)", ["water"], "./water.js", "buildWater",
    (Mo, env, slot) => env.S.srgb(slot?.default === "mod.water" && slot.data?.anchors?.shallow || [52, 110, 150]));
  surfMod("mod.ground", "Arena ground: painted grass / forest soil (arena default)", ["ground"], "./ground.js", "buildFloor",
    (Mo, env, slot) => env.S.srgb((slot?.default === "mod.ground" && slot.data?.gp?.src?.grassLo) || [96, 124, 70]));
  surfMod("mod.bank", "Bank strips, bottom -> top gradient (arena default)", ["ground", "bank"], "./ground.js", "buildBank",
    (Mo, env, slot) => env.S.srgb((slot?.default === "mod.bank" && slot.data?.gp?.src?.dirt) || [136, 99, 81]));
  mod("mod.hills", "Distant hill ribbons (arena default)", ["hill", "surface"], async (env) => {
    const G = await import("./ground.js");
    // any other slot: one low hill cone in the grass colour
    return { build: (s, ctx) => G.buildHills(s, ctx), parts: [{ geo: new THREE.ConeGeometry(1, 0.5, 24, 1), mat: plainMaterial(env.S, env.S.srgb([96, 124, 70]), { name: "mod.hills" }) }], assume: true };
  });
  mod("mod.ground_rocks", "Half-buried boulder, rock + moss (arena default)", ["rock", "boulder"], async (env, slot) => {
    const G = await import("./ground.js");
    return { parts: [G.rockPart(env, slot)], assume: true };
  });
  mod("mod.grass", "Grass blades: twist, curl, wind waves (arena default)", ["grass"], async (env, slot) => {
    const Gr = await import("./grass.js");
    return { parts: [Gr.grassAsset(env, slot)], assume: true };
  }, "Built: ideas after al-ro's grass (re-written)", "own code");
  mod("mod.spires", "Cliff spires: rock pillars + ledge shrubs (arena default)", ["rock", "spire", "cliff"], async (env, slot) => {
    const Sp = await import("./spires.js");
    return { build: (s, ctx) => Sp.buildSpires(s, ctx), parts: [Sp.pillarPart(env.S)], assume: true };
  });
  mod("mod.mirror", "Lake bank + mirrored copies (arena default)", ["bank", "water"], async (env) => {
    const Mi = await import("./mirror.js");
    // any other slot: a low grass mound in the bank's colour
    return { build: (s, ctx) => Mi.buildMirror(s, ctx), parts: [{ geo: new THREE.CylinderGeometry(0.6, 1, 0.35, 16, 1), mat: plainMaterial(env.S, env.S.srgb(Mi.BANK.COL), { name: "mod.mirror" }) }], assume: true };
  });
  mod("mod.sky", "Sky dome: measured ring gradient, day / night (arena default)", ["surface", "sky"], async (env, slot) => {
    const Sk = await import("./sky.js");
    // any other surface slot: a gradient of the measured ring colours (else the day gradient)
    const c = (slot?.default === "mod.sky" && slot.data?.sky?.colours) || null, q = (a, d) => env.S.srgb(a || d);
    const mat = skyGradientMaterial(env.S, q(c?.bottom || c?.all, [214, 232, 246]), q(c?.all, [140, 186, 232]), q(slot?.data?.bg || c?.top, [60, 112, 196]), "mod.sky");
    return { build: (s, ctx) => Sk.buildSky(s, ctx), parts: [{ geo: new THREE.CylinderGeometry(1, 1, 0.04, 28, 1), mat }], surfaceMat: mat, assume: true };
  });
  mod("mod.clouds", "3D cumulus banks in the sky ring (arena default)", ["cloud", "sky"], async (env) => {
    const Sk = await import("./sky.js");
    // any other slot: one white lobe cluster
    return { build: (s, ctx) => Sk.buildClouds(s, ctx), parts: [{ geo: new THREE.IcosahedronGeometry(1, 2), mat: plainMaterial(env.S, env.S.srgb([236, 236, 244]), { name: "mod.clouds", rim: 0.2 }) }], assume: true };
  });
  // --- rocks (plain toon on our geometry: the module rock shaders read their own per-vertex data)
  add("built.cobble", "Boulder (lumpy cobble)", ["rock", "boulder"], async (env) => {
    const B = await import("./boulders.js"), geo = B.cobbleMesh(5);
    const c = env.pal.grassLo.clone().lerp(new THREE.Color(0.2, 0.18, 0.17), 0.5);
    return one(geo, plainMaterial(env.S, c, { name: "builtCobble" }));
  });
  add("built.pillar", "Rock pillar (spire template)", ["rock", "spire", "cliff"], async (env) => {
    const Sp = await import("./spires.js"), t = Sp.makePillar(3, "wall");
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(t.pos), 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(t.idx), 1)); g.computeVertexNormals();
    return { parts: [{ geo: g, mat: plainMaterial(env.S, new THREE.Color(0.22, 0.19, 0.17), { name: "builtPillar" }) }] };
  });
  // --- forest floor + mushrooms + gulls (module geometry + module material)
  const fc = async (kind, fn) => {
    const F = await import("./floorcover.js");
    const shared = { uFcWind: { value: F.COVER.WIND_K }, uFcFar0: { value: 1e6 }, uFcFar1: { value: 2e6 }, uFcGain: { value: 1.0 }, uFcRootK: { value: 0.72 }, uFcTipK: { value: 1.18 }, uFcDim: { value: 1.0 } };
    return one(F[fn](), F.coverMaterial(shared, "uFcDens" + kind, "builtFloorcover_" + kind.toLowerCase()));
  };
  add("built.fern", "Fern", ["plant", "fern"], async () => { const F = await import("./floorcover.js"); const shared = { uFcWind: { value: F.COVER.WIND_K }, uFcFar0: { value: 1e6 }, uFcFar1: { value: 2e6 }, uFcGain: { value: 1.0 }, uFcRootK: { value: 0.72 }, uFcTipK: { value: 1.18 }, uFcDim: { value: 1.0 } };
    return one(F.fernGeometry(true), F.coverMaterial(shared, "uFcDensFern", "builtFloorcover_fern")); });
  add("built.clover", "Clover tuft", ["plant", "ground cover"], () => fc("Clover", "cloverGeometry"));
  add("built.tuft", "Grass tuft", ["grass", "ground cover"], () => fc("Tuft", "tuftGeometry"));
  add("built.leaf", "Fallen leaf", ["litter"], () => fc("Litter", "leafGeometry"));
  add("built.twig", "Twig", ["litter", "wood"], () => fc("Twig", "twigGeometry"));
  add("built.pebble", "Pebble", ["rock", "litter"], () => fc("Pebble", "pebbleGeometry"));
  add("built.mushroom", "Glowing mushroom", ["mushroom", "plant"], async (env) => {
    const M = await import("./mushrooms.js"), S = env.S, geo = M.mushroomGeometry(THREE, M.MUSH.SEGMENTS);
    const uni = { uMusTime: { value: 0 }, uGlowCol: { value: new THREE.Color(0.55, 0.92, 1.0) }, uStemCol: { value: new THREE.Color(0.55, 0.62, 0.6) }, uCapCol: { value: new THREE.Color(0.75, 0.85, 0.85) },
      uGlowK: { value: M.MUSH.GLOW_K }, uNightK: { value: M.MUSH.GLOW_DAY }, uGlow: { value: 1.0 }, uGillN: { value: M.MUSH.GILL_N }, uPulseW: { value: M.MUSH.PULSE_W },
      uHaloK: { value: M.MUSH.HALO_K }, uPoolK: { value: M.MUSH.POOL_K }, uSporeK: { value: 0.75 }, uSporeScale: { value: 1 }, uSporeMaxPx: { value: 1 } };
    return one(geo, M.mushroomMaterial(S, {}, uni), { attrs: { aPhase: [1, 0], aFade: [1, 1] } });
  });
  add("built.gull", "Seagull (flapping)", ["bird", "gull"], async (env) => {
    const G = await import("./gulls.js"), geo = G.gullGeometry();
    const col = { white: env.S.srgb([247, 245, 250]), shade: env.S.srgb([196, 200, 241]), tip: env.S.srgb([15, 19, 29]), beak: env.S.srgb([230, 170, 40]) };
    return one(geo, G.gullMaterial(env.S, col), { attrs: { aGull: [3, 0.5] } });
  });
  // --- surfaces: plain painted ground, water, sky (a surface slot takes the material; any other slot gets a flat disc of it)
  const surf = (id, name, kinds, col, extra = {}) => add(id, name, ["surface", ...kinds], async (env) => {
    const mat = extra.sky ? skyGradientMaterial(env.S, ...extra.sky.map((c) => env.S.srgb(c)), id) : plainMaterial(env.S, env.S.srgb(col), { name: id, rim: 0.0 });
    const disc = new THREE.CylinderGeometry(1, 1, 0.04, 28, 1);
    return { parts: [{ geo: disc, mat }], assume: true, surfaceMat: mat };
  }, "Built: plain painted surface", "own code");
  surf("surface.grass", "Surface: plain grass", ["ground"], [92, 128, 70]);
  surf("surface.soil", "Surface: plain soil", ["ground"], [92, 70, 52]);
  surf("surface.sand", "Surface: plain sand", ["ground"], [214, 190, 140]);
  surf("surface.stone", "Surface: plain stone", ["ground", "rock"], [120, 116, 112]);
  surf("surface.snow", "Surface: plain snow", ["ground"], [236, 240, 246]);
  surf("surface.water", "Surface: plain water", ["water"], [62, 128, 176]);
  surf("surface.lake", "Surface: plain lake", ["water"], [92, 150, 160]);
  surf("surface.sky_day", "Sky: day gradient", ["sky"], null, { sky: [[214, 232, 246], [140, 186, 232], [60, 112, 196]] });
  surf("surface.sky_dusk", "Sky: dusk gradient", ["sky"], null, { sky: [[255, 214, 160], [217, 138, 138], [59, 63, 140]] });
  surf("surface.sky_night", "Sky: night gradient", ["sky"], null, { sky: [[40, 52, 96], [18, 26, 60], [6, 10, 28]] });
  L.push({ id: "none", name: "Nothing (hide this slot)", kinds: ["none"], source: "Built", licence: "-", group: "none", make: async () => ({ parts: [], none: true, h: 1, r: 1 }) });
  return L;
}

// ------------------------------------------------------------------ biome entries (gallery assets)
const BIOME_MODS = ["forest", "beach", "lake", "mountain", "sharedtab", "objects"];
const TABS = ["forest", "beach", "lake", "mountain", "shared"];
const sourceGroup = (e) => {
  const s = `${e.source || ""} ${e.url || ""}`;
  if (/Quaternius/i.test(s)) return "Quaternius";
  if (/Poly ?Haven/i.test(s)) return "Poly Haven";
  if (/KayKit/i.test(s)) return "KayKit";
  if (/OGA|opengameart/i.test(s)) return "OpenGameArt";
  if (/Sketchfab/i.test(s) || /^an_/.test(e.id)) return "Sketchfab (anime)";
  if (/^ob_/.test(e.id)) return "Objects (own)";
  if (/Procedural/i.test(s)) return "Procedural";
  return "Other";
};
const kindsOf = (e) => {
  const s = `${e.cat} ${e.name}`.toLowerCase(), k = new Set();
  const rx = [["tree", /tree|pine|fir\b|birch|oak|palm|willow|cherry|spruce|cypress|trunk|snag|krummholz|juniper/], ["bush", /bush|shrub|hedge|heather|sage/], ["rock", /rock|boulder|stone|cliff|crag|spire|scree|pebble|gravel|glacier/],
    ["grass", /grass|reed|sedge|rush|marram|oats|cattail|bulrush|horsetail|tuft/], ["plant", /plant|fern|flower|lily|iris|clover|moss|lichen|weed|kelp|ivy|vine|lotus|gentian|edelweiss/], ["mushroom", /mushroom|agaric/],
    ["wood", /wood|log|branch|twig|driftwood|stump/], ["surface", /sky|cloud|fog|mist|ground|floor|material|water|stream|sea|ocean|pool|snow drift|sand/], ["shell", /shell|coral|crab/]];
  for (const [t, r] of rx) if (r.test(s)) k.add(t);
  if (!k.size) k.add("other");
  k.add(String(e.cat || "other").toLowerCase());
  return [...k];
};
let biomePromise = null;
/** Load the biome gallery catalogs (once). Resolves to registry defs. */
export function loadBiome() {
  return (biomePromise ||= (async () => {
    const mods = await Promise.all(BIOME_MODS.map((n) => import(`../biome/${n}.js`)));
    const anime = await import("../biome/anime.js");
    const raw = [...mods.flatMap((m) => m.entries || []), ...TABS.flatMap((t) => anime.entries(t))];
    const seen = new Set(), out = [];
    for (const e of raw) {
      if (!e?.id || seen.has(e.id)) continue;
      const base = e.id.replace(/^an_[a-z]+_/, "an_");
      if (/^an_/.test(e.id) && seen.has(base)) continue;
      seen.add(e.id); seen.add(base);
      out.push({ id: "bio." + e.id, name: e.name, kinds: kindsOf(e), source: e.source || "Biome gallery", sourceGroup: sourceGroup(e), licence: e.licence || "?", group: "biome", cat: e.cat, url: e.url, make: (env) => makeBiome(e, env) });
    }
    for (const d of out) register(d);
    return out;
  })());
}
let toolkitMod = null;
export const toolkit = () => toolkitMod;
async function makeBiome(e, env) {
  toolkitMod ||= await import("../biome/toolkit.js");
  const obj = await e.make();
  obj.updateMatrixWorld(true);
  const parts = [], tk = toolkitMod;
  const flat = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.material || !o.geometry?.attributes?.position) return;
    if (o.isInstancedMesh) {   // expand a few instances so a tuft field keeps its shape
      const n = Math.min(o.count, 64), M = new THREE.Matrix4();
      for (let i = 0; i < n; i++) { o.getMatrixAt(i, M); flat.push({ geo: o.geometry, mat: o.material, m: new THREE.Matrix4().multiplyMatrices(o.matrixWorld, M) }); }
    } else flat.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld });
  });
  if (!flat.length) throw new Error("no mesh in " + e.id);
  // one merged geometry per material (all instances of a part share one draw)
  const byMat = new Map();
  for (const f of flat) {
    const g = tk.normaliseGeo(f.geo, /^ob_/.test(e.id)); g.applyMatrix4(f.m);   // vertex colours only for our own objects (ob_*)
    (byMat.get(f.mat) || byMat.set(f.mat, []).get(f.mat)).push(g);
  }
  const { mergeGeometries } = await import("../biome/vendor/BufferGeometryUtils.js");
  for (const [mat, gs] of byMat) {
    const geo = gs.length > 1 ? mergeGeometries(gs, false) : gs[0];
    if (!geo) continue;
    // the toon fade (scale to zero beyond a few metres) must not fire at 400 units per metre
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); if (sh.uniforms.uFade) sh.uniforms.uFade.value.set(1e9, 2e9); };
    mat.needsUpdate = true;
    parts.push({ geo, mat });
  }
  return { parts, toolkit: true };
}

// ------------------------------------------------------------------ build + cache
let builtLoaded = false;
function ensureBuilt() { if (builtLoaded) return; builtLoaded = true; for (const d of builtDefs()) register(d); }
const cache = new Map();   // arena + slot + asset id -> Promise<asset>
/** All entries known now (the built + module + surface + none ones; add the biome ones with loadBiome()). */
export function listAssets() { ensureBuilt(); return [...REGISTRY.values()].map(({ make, ...meta }) => meta); }
export async function listAllAssets() { ensureBuilt(); await loadBiome(); return listAssets(); }
/** The asset `id` made for one SLOT of one arena (cached per arena + slot: every slot gets its own materials, so the
 *  colour fit, which patches a material once by its mesh's layer name, fits each slot on its own).
 *  -> { id, parts?, variants?, lod?, build?, h, r, native (= the slot's default asset: its exact matrices apply), ... } */
export function getAsset(id, env, pack = "", slot = null) {
  ensureBuilt();
  const k = pack + "|" + (slot?.id ?? "") + "|" + id;
  if (!cache.has(k)) cache.set(k, (async () => {
    if (!REGISTRY.has(id) && id.startsWith("bio.")) await loadBiome();
    const def = REGISTRY.get(id);
    if (!def) throw new Error("unknown asset " + id);
    const raw = await def.make(env, slot);
    const parts = raw.parts || (raw.variants ? raw.variants[0] : null);
    const dims = raw.none ? { h: 1, r: 1 } : raw.h && raw.r ? { h: raw.h, r: raw.r } : parts?.length ? normaliseParts(parts, { assume: !!raw.assume }) : { h: 1, r: 1 };
    if (raw.variants && !raw.assume) for (const v of raw.variants.slice(1)) normaliseParts(v);
    return { ...raw, id, name: def.name, kinds: def.kinds, parts, variants: raw.variants || null, h: dims.h, r: dims.r, surfaceMat: raw.surfaceMat || null,
      toolkit: !!raw.toolkit, none: !!raw.none, native: !!slot && slot.default === id,
      dispose() { for (const p of parts || []) p.geo.dispose?.(); } };
  })());
  return cache.get(k);
}
export function dropCache(key) { for (const k of [...cache.keys()]) if (k.startsWith(key + "|")) cache.delete(k); }
