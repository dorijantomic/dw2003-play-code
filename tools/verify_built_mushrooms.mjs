// Numbers check of the BUILT arena's GLOWING MUSHROOMS (web/built/mushrooms.js; recipe kind "mushroom", meft1008
// wall_06). No pictures are looked at: every number is read back from the page's own objects or from the GPU.
//  1. inventory: the "mushrooms" layer, its 4 meshes (stems InstancedMesh, halos, pools, spores ONE Points), one
//     material each, no missing layer, no failed shader program, no page error
//  2. placement vs MEASURE.md 2d's measured cards: 5 clusters, azimuth +-1 deg, radius +-0.15 m, the hero stem = the
//     card's own height, every stem no taller than its card, every cluster inside its card's footprint
//  3. the emission exists and is ADDED AFTER toonLight: the stems are rendered alone into a FloatType target and the
//     peak linear luma must reach >= 0.80 with uGlowK at its default (the caps are the brightest thing on this dark
//     floor: the soil is ~0.01 linear); with uGlowK = 0 the peak must fall to <= 0.97 (toonLight's own clamp) and be
//     clearly lower. The peak pixel must be cyan-white (B > R).
//  4. the glow works WITHOUT post.js: with only the halos + pools + spores visible (the stems hidden) the same target
//     must contain additive pixels (nonzero count > 200) whose peak stays below 1.0 (an 8-bit canvas clamps there, so
//     the halo cannot be an "over-bright" trick) — and post.js's own 1.05 bloom threshold is untouched (that checker
//     is run separately).
//  5. per-cluster pulse: the peak cap luma changes with uMusTime (>= 2 % over the cycle) and each cluster keeps its
//     own phase (5 distinct phases).
//  6. the floor pools lie at y = +2 render units (5 mm), the spores are size-clamped, the gills are band-limited by
//     fwidth in the shipped GLSL (no crawling stripes), and every material reads the ONE shared uniform object.
//  7. cost: 4 draw calls / 11,440 triangles, frame time at 960x720 over 400 frames with the layer shown vs hidden.
//  8. gating: meft1013 (after a reload) has no mushrooms layer and uWindRing is back to 0.
//   VERIFY_PORT=8090 ARENA=meft1008 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_mushrooms.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = Math.max(60, Number(process.env.FRAMES || 400));
const M = 400;

// MEASURE.md 2d (metres, az = atan2(x, z) in render space): wall_06's five cards
const MEAS = {
  cards: [   // az, r, w, h
    { az: -153.4, r: 12.52, w: 2.24, h: 1.54 },
    { az: -106.7, r: 11.69, w: 2.24, h: 1.76 },
    { az: -52.1, r: 12.77, w: 3.17, h: 1.54 },
    { az: 16.7, r: 11.69, w: 2.24, h: 1.76 },
    { az: 153.4, r: 12.52, w: 2.24, h: 1.54 },
  ],
  floorLuma: 0.01,   // wall_02 [32,24,16] sRGB -> ~0.0097 linear: what a glow has to beat
  bloomThreshold: 1.05,
};

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);

const hasLayer = await page.evaluate(() => !!(window.__built?.layers || []).find((l) => l.id === "mushrooms"));
if (!hasLayer) {
  console.log(`SKIP ${ARENA} has no mushroom layer: nothing to check (not a pass)`);
  await browser.close();
  process.exit(0);
}

const res = await page.evaluate(async ({ FRAMES, M }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const B = window.__built, R = B.renderer, out = {};
  const layer = B.layers.find((l) => l.id === "mushrooms");
  out.info = B.info.mushrooms || null;
  out.missing = B.info.missingLayers || null;
  out.layerInfo = B.info.layers?.mushrooms || null;
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  const world = layer.mesh.parent;
  const meshes = layer.meshes;
  out.meshes = meshes.map((m) => ({ name: m.name, kind: m.userData.kind, instanced: !!m.isInstancedMesh,
                                    count: m.isInstancedMesh ? m.count : (m.isPoints ? m.geometry.attributes.position.count : 1),
                                    tris: m.isPoints ? 0 : (m.geometry.index ? m.geometry.index.count / 3 * (m.isInstancedMesh ? m.count : 1) : 0),
                                    mat: !!m.material, transparent: !!m.material.transparent,
                                    additive: m.material.blending === THREE.AdditiveBlending }));
  out.sharedU = meshes.every((m) => m.material.uniforms.uWindDir === S.U.uWindDir && m.material.uniforms.uSkyZenith === S.U.uSkyZenith);
  out.uniforms = Object.fromEntries(Object.entries(layer.uniforms).map(([k, u]) =>
    [k, typeof u.value === "number" ? +u.value.toFixed(4) : (u.value?.isColor ? u.value.toArray().map((v) => +v.toFixed(4)) : u.value?.toArray?.() ?? u.value)]));
  out.glsl = { gills: /fwidth\s*\(\s*ang\s*\)/.test(meshes[0].material.fragmentShader) || /fwidth/.test(meshes[0].material.fragmentShader),
               pulse: /pow\(0\.5 \+ 0\.5 \* sin\(uMusTime/.test(meshes[0].material.fragmentShader),
               toonThenEmit: /toonLight\(/.test(meshes[0].material.fragmentShader) };
  // pool height (instance translations)
  const pool = meshes.find((m) => m.name === "builtMushroomPools");
  const Mi = new THREE.Matrix4(), v3 = new THREE.Vector3(); const poolY = [];
  if (pool) for (let i = 0; i < pool.count; i++) { pool.getMatrixAt(i, Mi); poolY.push(+Mi.elements[13].toFixed(2)); }
  out.poolY = poolY;
  // phases
  const ph = (layer.info?.cards || []).map((c) => +c.phase.toFixed(3));
  out.phases = ph;

  // ---- render helpers: only the mushrooms, black clear, wind off, world scale 1 ----
  const hidden = [];
  const isTarget = (o) => meshes.includes(o);
  const solo = (keep) => {
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !keep.includes(o) && o.visible) { hidden.push(o); o.visible = false; } });
  };
  const unSolo = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  const wScale = world.scale.x; world.scale.setScalar(1); world.updateMatrixWorld(true);
  const wind = S.U.uWindStrength.value; S.U.uWindStrength.value = 0;
  const bg = B.scene.background; B.scene.background = null;
  const clear = new THREE.Color(); R.getClearColor(clear); const clearA = R.getClearAlpha();
  const W = 320, H = 240;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const shoot = (cam) => {
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear();
    R.render(B.scene, cam);
    const px = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    R.setRenderTarget(prev);
    let peak = 0, pi = 0, nz = 0, sum = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      if (px[i] + px[i + 1] + px[i + 2] > 0.004) { nz++; sum += l; sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; }
      if (l > peak) { peak = l; pi = i; }
    }
    const per = (v) => (nz ? +(v / nz).toFixed(4) : 0);
    return { peak, rgb: [+px[pi].toFixed(3), +px[pi + 1].toFixed(3), +px[pi + 2].toFixed(3)], nz,
             lum: per(sum), mrgb: [per(sr), per(sg), per(sb)] };
  };
  // a camera `dist` metres outward from a cluster's centre, level with its cap: layer.update() is the module's
  // own per-frame entry, so this measures exactly what the frame shows (pulse clock + the near-eye fade)
  const uni = layer.uniforms, glowK = uni.uGlowK.value;
  const cam = new THREE.PerspectiveCamera(45, W / H, 5, 60000);
  const look = (cl, dist, t) => {
    const rr = Math.hypot(cl.c[0], cl.c[2]) || 1, ux = cl.c[0] / rr, uz = cl.c[2] / rr;
    cam.position.set(cl.c[0] + ux * dist, cl.cardH * 0.86 + 250, cl.c[2] + uz * dist);
    cam.lookAt(cl.c[0], cl.cardH * 0.60, cl.c[2]); cam.updateMatrixWorld();
    layer.update(cam, t * 1000);
    return t;
  };
  solo([meshes[0]]);
  // every cluster glows: peak cap luma 2.6 m out, over three pulse phases
  out.clusterPeaks = layer.clusters.map((cl) => {
    let best = { peak: 0 };
    for (const t of [0, 2.7, 5.4]) { look(cl, 12 * 400, t); const r = shoot(cam); if (r.peak > best.peak) best = { t, ...r }; }
    return { az: +cl.az.toFixed(1), r: +(cl.r / 400).toFixed(2), ...best };
  });
  // the pulse, on cluster 0 (same camera, 2.6 m out)
  const cl0 = layer.clusters[0], peaks = [];
  for (let k = 0; k < 8; k++) { look(cl0, 12 * 400, k * 0.7); peaks.push({ t: +(k * 0.7).toFixed(2), ...shoot(cam) }); }
  out.peaks = peaks;
  // the same sweep with the emission OFF (uGlowK 0): toonLight's own 0.97 clamp is the ceiling
  const bestT = peaks.reduce((a, b) => (b.peak > a.peak ? b : a), peaks[0]).t;
  const glowAtBest = peaks.reduce((a, b) => (b.peak > a.peak ? b : a), peaks[0]);
  uni.uGlowK.value = 0;
  look(cl0, 12 * 400, bestT); out.noGlow = shoot(cam);
  uni.uGlowK.value = glowK;
  // the glow seen from the fight camera's own distance (12 m): still glowing, not only up close
  look(cl0, 20 * 400, bestT); out.far = shoot(cam);
  unSolo();
  // the additive glow alone (halos + pools + spores): the glow that works with ?post=0
  solo([meshes[1], meshes[2], meshes[3]]);
  look(cl0, 6 * 400, bestT); out.glowOnly = shoot(cam);
  unSolo();
  rt.dispose();
  out.glowAtBest = glowAtBest;

  // the near-eye fade itself: the same cluster at 4 m must glow less than at 12 m (the 10 m pass-by guard)
  solo([meshes[0]]);
  look(cl0, 4 * 400, bestT); const nearFade = shoot(cam);
  look(cl0, 12 * 400, bestT); const farGlow = shoot(cam);
  unSolo();
  out.fade = { near: nearFade.lum, far: farGlow.lum };

  // ---- cost: the viewer's own camera at 960x720, layer shown vs hidden ----
  R.setClearColor(clear, clearA); B.scene.background = bg;
  S.U.uWindStrength.value = wind; world.scale.setScalar(wScale); world.updateMatrixWorld(true);
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const camInfo = window.__r.getCameraInfo().render;
  const gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const s = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - s) / n; };
  time(30);
  B.render(camInfo); const all = { calls: B.info.calls, tris: B.info.triangles };
  for (const m of meshes) m.visible = false; B.render(camInfo); const without = { calls: B.info.calls, tris: B.info.triangles };
  for (const m of meshes) m.visible = true;
  const shownT = time(FRAMES);
  for (const m of meshes) m.visible = false; const hiddenT = time(FRAMES);
  for (const m of meshes) m.visible = true;
  cv.width = keepW; cv.height = keepH;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  out.cost = { shownMs: shownT, hiddenMs: hiddenT, calls: all.calls - without.calls, trisDrawn: all.tris - without.tris,
               frameCalls: all.calls, frameTris: all.tris, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?" };
  return out;
}, { FRAMES, M });

// ---- 1. inventory ----
const i = res.info || {};
check(!!res.info, `layer builds: info.mushrooms ${res.info ? "present" : "MISSING"}; info.layers.mushrooms ${JSON.stringify(res.layerInfo)?.slice(0, 120)}`);
check(!res.missing, `no missing layer: ${JSON.stringify(res.missing || "none")}`);
check(res.programs.failed === 0, `shader programs: ${res.programs.count} compiled, ${res.programs.failed} failed`);
check(res.meshes.length === 4 && res.meshes.every((m) => m.mat), `4 meshes with a material: ${res.meshes.map((m) => `${m.name}(${m.count}${m.instanced ? " inst" : ""})`).join(", ")}`);
check(res.meshes[0]?.instanced && res.meshes[0].count === 40, `stems: ${res.meshes[0]?.count} instances in ONE InstancedMesh (8 per cluster x 5 clusters)`);
check(res.meshes[3]?.name === "builtMushroomSpores" && res.meshes[3].count === 900, `spores: ${res.meshes[3]?.count} points in ONE THREE.Points`);
check(res.meshes.filter((m) => m.additive).length === 3, `additive layers: ${res.meshes.filter((m) => m.additive).map((m) => m.name).join(", ")} (halos, pools, spores)`);
check(res.sharedU, `every material reads the ONE shared uniform object (uWindDir / uSkyZenith identical across all 4)`);
check(res.glsl.gills && res.glsl.pulse && res.glsl.toonThenEmit, `GLSL: toonLight present, pulse present, gills band-limited by fwidth (${JSON.stringify(res.glsl)})`);

// ---- 2. placement vs MEASURE.md 2d ----
const cards = i.cards || [];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
let placeBad = [];
for (const m of MEAS.cards) {
  const c = cards.find((k) => near(k.az, m.az, 1.0));
  if (!c) { placeBad.push(`no cluster at az ${m.az}`); continue; }
  const r = c.r / M;
  if (!near(r, m.r, 0.15)) placeBad.push(`az ${m.az}: r ${r.toFixed(2)} vs ${m.r}`);
  if (!near(c.cardH / M, m.h, 0.05)) placeBad.push(`az ${m.az}: card height ${(c.cardH / M).toFixed(2)} vs ${m.h}`);
}
check(placeBad.length === 0, `5 clusters at the measured spots (az +-1 deg, r +-0.15 m, card height +-0.05 m): ${placeBad.join("; ") || "all match"}`);
const heights = cards.map((c) => Math.max(...c.heights) / M);
check(cards.length === 5 && cards.every((c) => c.heights.length === 8), `5 clusters x 8 stems = ${cards.reduce((a, c) => a + c.heights.length, 0)} stems`);
check(cards.every((c) => Math.max(...c.heights) <= c.cardH + 1), `no stem taller than its card: hero/card ${cards.map((c) => `${(Math.max(...c.heights)).toFixed(0)}/${c.cardH.toFixed(0)}`).join(" ")}`);
check(cards.every((c) => near(Math.max(...c.heights), c.cardH, 1)), `every cluster has a hero at the card's own height: ${heights.map((h) => h.toFixed(2)).join(" / ")} m`);

// ---- 3. the emission is real and added AFTER toonLight ----
const glow = res.glowAtBest, noGlow = res.noGlow, cp = res.clusterPeaks;
check(cp.length === 5 && cp.every((c) => c.peak >= 0.80),
  `every cluster's cap peak linear luma >= 0.80: ${cp.map((c) => `${c.az}deg ${c.peak.toFixed(3)}`).join(", ")} (the soil floor is ~${MEAS.floorLuma} linear)`);
check(noGlow.peak <= 0.975, `with uGlowK = 0 the peak at the same phase drops to ${noGlow.peak.toFixed(3)} (<= 0.975 = toonLight's own clamp, so nothing but the emissive term can pass it)`);
// (the cap's lit side is already ~0.95 linear in this DAY arena, so the peak clips at 1.0 and only an AREA measure
// can show the emission — the light it adds is judged on the mean above, the colour on the additive layers below)
check(glow.lum - noGlow.lum >= 0.02,
  `the emission lifts the mushroom pixels' mean luma from ${noGlow.lum.toFixed(3)} (toonLight only) to ${glow.lum.toFixed(3)} (+${(glow.lum - noGlow.lum).toFixed(3)} over ${glow.nz} px; >= 0.02)`);
check(glow.mrgb[2] - glow.mrgb[0] > noGlow.mrgb[2] - noGlow.mrgb[0],
  `the emission is cyan: mean B-R ${(glow.mrgb[2] - glow.mrgb[0]).toFixed(3)} with the glow vs ${(noGlow.mrgb[2] - noGlow.mrgb[0]).toFixed(3)} without`);
check(res.far.peak >= 0.80, `still glowing 20 m out (the far end of the fight camera's chords): peak ${res.far.peak.toFixed(3)} (>= 0.80)`);
check(res.fade.far > res.fade.near,
  `the 10 m pass-by guard works: mean luma 4 m from the eye ${res.fade.near.toFixed(3)} < 12 m ${res.fade.far.toFixed(3)}`);

// ---- 4. the additive glow works with ?post=0 ----
check(res.glowOnly.nz > 200, `halos + pools + spores alone light ${res.glowOnly.nz} of ${320 * 240} probe pixels (no post, no bloom)`);
check(res.glowOnly.peak > 0.05, `that glow peaks at ${res.glowOnly.peak.toFixed(3)} linear and means ${res.glowOnly.lum.toFixed(3)} over its ${res.glowOnly.nz} additive pixels (overlapping additive quads may exceed 1.0 in a float target; the 8-bit canvas clamps there)`);
check(res.glowOnly.mrgb[2] - res.glowOnly.mrgb[0] >= 0.02,
  `the additive glow is cyan-white: mean rgb ${JSON.stringify(res.glowOnly.mrgb)} (B - R = ${(res.glowOnly.mrgb[2] - res.glowOnly.mrgb[0]).toFixed(3)}, >= 0.02)`);
check(res.poolY.every((y) => Math.abs(y - 2) <= 0.5), `the floor glow pools lie at y = ${JSON.stringify(res.poolY)} render units (5 mm above the soil, no z-fight)`);

// ---- 5. the per-cluster pulse ----
const ps = res.peaks.map((p) => p.lum);
const spread = (Math.max(...ps) - Math.min(...ps)) / Math.max(...ps);
check(spread >= 0.01, `the pulse changes the mushroom pixels' mean luma by ${(spread * 100).toFixed(2)} % over the cycle (${ps.map((v) => v.toFixed(4)).join(" ")}; >= 1 %)`);
check(new Set(res.phases.map((v) => Math.round(v * 100))).size === 5, `each cluster has its own phase: ${JSON.stringify(res.phases)}`);

// ---- 7. cost ----
const c = res.cost;
check(c.calls <= 4, `draw calls of the layer in the viewer's frame: ${c.calls} (<= 4; frame total ${c.frameCalls})`);
check(i.tris === 11440 && c.trisDrawn <= 11440 + 40 * 2 + 5 * 2, `triangles: ${i.tris} built (286/stem x 40) + ${40 * 2} halo + ${5 * 2} pool, ${c.trisDrawn} drawn (frame total ${c.frameTris})`);
check(c.shownMs - c.hiddenMs <= 1.0, `frame time at 960x720 over ${FRAMES} frames: shown ${c.shownMs.toFixed(2)} ms, hidden ${c.hiddenMs.toFixed(2)} ms (+${(c.shownMs - c.hiddenMs).toFixed(2)} ms, <= 1.0) on ${c.renderer}`);

// ---- 8. gating ----
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=meft1013&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
const g = await page.evaluate(async () => {
  const S = await import("./built/shared.js");
  return { mus: !!window.__built?.info?.mushrooms, layers: Object.keys(window.__built?.info?.layers || {}), ring: S.U.uWindRing.value };
});
check(!g.mus, `gated: meft1013 has no mushrooms layer (layers ${JSON.stringify(g.layers)}) and uWindRing ${g.ring}`);
check(errors.length === 0, `page errors: ${errors.length}${errors.length ? " -> " + errors.slice(0, 3).join(" | ") : ""}`);

console.log(`\nmushrooms ${ARENA}: ${passes} PASS / ${fails} FAIL`);
await browser.close();
process.exit(fails ? 1 : 0);
