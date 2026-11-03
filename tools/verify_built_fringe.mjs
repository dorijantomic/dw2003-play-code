// Numbers check of the BUILT arena's LAKE GRASS / REED FRINGE (web/built/fringe.js; recipe kind "fringe", meft1008
// wall_07). No pictures are looked at: every number is read back from the page's own objects or from the GPU.
//  1. inventory: the "fringe" layer, ONE merged opaque mesh (no alpha texture, no blending, double-sided), one
//     material, no missing layer, no failed shader program, no page error
//  2. placement vs MEASURE.md 2d's measured cards: 5 clumps, azimuth +-1.5 deg, radius +-0.3 m, 2.24 m wide, four of
//     them in the lake bay (az 46..123 deg, the bay the tree ring leaves open)
//  3. the two halves: for every card the blades' tops reach exactly the measured half height (0.5 x card height) and
//     the reflection reaches exactly as far below the water line; no above-water vertex below y 0, no reflection
//     vertex above it; every card's half within MEASURE's -1.01..+1.77 m band
//  3b. DENSE AND BRIGHT (USER 2026-10-30: the real game's clumps are dense, bright saturated green, wide and full; the first
//     build was sparse thin dark reeds): >= 150 blades per card, the above-water half fills >= 40 % of its card rectangle
//     seen square-on (MEASURE: the card picture is 50 % opaque), its pixels are saturated green in the measured colours
//     (median [10,61,18], tips [26,86,20]) and the reflection is the measured dark blue-green ([10,31,33] median)
//  4. the reflection looks like the measurement: each half is rendered on its own (the module lays the above-water
//     block and the reflection block out as two index ranges) and the reflection's mean must be darker, with less
//     green and more blue than the blades above the water ([8,32,32] below vs [8,64,16] above)
//  5. the shared wind: the sway is the shared field (the material's uWindDir/uWindTime/uWindStrength/uWindRing ARE
//     the shared uniform objects), the tip actually moves, it moves with time, uWindStrength 0 freezes it, and the
//     travelling ring gust is on for this arena
//  6. cost: 1 draw call, triangles (dense: ~16,000), frame time at 960x720 over 400 frames with the layer shown vs hidden
//  7. gating: meft1013 (after a reload) has no fringe layer
//   VERIFY_PORT=8090 ARENA=meft1008 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_fringe.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = Math.max(60, Number(process.env.FRAMES || 400));
const M = 400;

// MEASURE.md 2d: wall_07's five cards (az, r, w, half-height), all centred on the water line y = 0
const MEAS = {
  cards: [
    { az: 50.3, r: 20.19, w: 2.24, half: 1.43 },
    { az: 75.1, r: 17.64, w: 2.24, half: 1.01 },
    { az: 101.3, r: 19.56, w: 2.24, half: 1.77 },
    { az: 120.1, r: 17.98, w: 2.24, half: 1.01 },
    { az: -156.3, r: 24.25, w: 2.24, half: 1.01 },
  ],
  bay: [46, 123],          // the four lake-bay cards (MEASURE 2d: "four of five stand in the lake bay az 46..123")
  band: [-1.77, 1.77],     // every card's y span, metres
  above: [8, 64, 16],      // sRGB median of the picture above y 0
  below: [8, 32, 32],      // sRGB median below y 0
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

const hasLayer = await page.evaluate(() => !!(window.__built?.layers || []).find((l) => l.id === "fringe"));
if (!hasLayer) {
  console.log(`SKIP ${ARENA} has no fringe layer: nothing to check (not a pass)`);
  await browser.close();
  process.exit(0);
}

const res = await page.evaluate(async ({ FRAMES, M }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const F = await import("./built/fringe.js");
  const B = window.__built, R = B.renderer, out = {};
  const layer = B.layers.find((l) => l.id === "fringe");
  out.info = B.info.fringe || null;
  out.missing = B.info.missingLayers || null;
  out.layerInfo = B.info.layers?.fringe || null;
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  const mesh = layer.mesh, geo = mesh.geometry, mat = mesh.material;
  out.mesh = { name: mesh.name, kind: mesh.userData.kind, meshes: layer.meshes.length, transparent: !!mat.transparent,
               blending: mat.blending === THREE.NormalBlending, side: mat.side === THREE.DoubleSide, alphaTest: mat.alphaTest || 0,
               verts: geo.attributes.position.count, index: geo.index.count };
  out.sharedWind = mat.uniforms.uWindDir === S.U.uWindDir && mat.uniforms.uWindTime === S.U.uWindTime
    && mat.uniforms.uWindStrength === S.U.uWindStrength && mat.uniforms.uWindRing === S.U.uWindRing;
  out.windRing = S.U.uWindRing.value;
  out.glsl = { ring: /uWindRing/.test(mat.vertexShader), gust: /uWindGust/.test(mat.vertexShader),
               bend: /p\.xz \+= wO/.test(mat.vertexShader), noise: /noise3\(/.test(mat.vertexShader) };
  out.uniforms = Object.fromEntries(Object.entries(layer.uniforms).map(([k, u]) =>
    [k, typeof u.value === "number" ? +u.value.toFixed(4) : (u.value?.isColor ? u.value.toArray().map((v) => +v.toFixed(4)) : u.value?.toArray?.() ?? u.value)]));
  // per-vertex y per index block (above / reflection)
  const pos = geo.attributes.position, ref = geo.attributes.aRef, t = geo.attributes.aT;
  let ymax = -1e9, ymin = 1e9, aboveVerts = 0, refVerts = 0, badAbove = 0, badRef = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), isRef = ref.getX(i) > 0.5;
    ymax = Math.max(ymax, y); ymin = Math.min(ymin, y);
    if (isRef) { refVerts++; if (y > 0.001) badRef++; } else { aboveVerts++; if (y < -0.001) badAbove++; }
  }
  out.geo = { ymax: +ymax.toFixed(2), ymin: +ymin.toFixed(2), aboveVerts, refVerts, badAbove, badRef };
  // per-card top / bottom, from the index ranges the module records
  out.cards = (layer.info?.cards || []).map((c) => {
    const [aStart, aCount, vStart, vCount] = c.aboveRange, [rStart, rCount, rvStart, rvCount] = c.refRange;
    let aTop = -1e9, rBot = 1e9;
    for (let i = vStart; i < vStart + vCount; i++) aTop = Math.max(aTop, pos.getY(i));
    for (let i = rvStart; i < rvStart + rvCount; i++) rBot = Math.min(rBot, pos.getY(i));
    return { ...c, aStart, aCount, rStart, rCount, aTop, rBot, vStart, vCount, rvStart, rvCount };
  });
  // ---- the sway, through the module's own JS twin of the shader ----
  const U = (tt) => ({ windDir: [S.U.uWindDir.value.x, S.U.uWindDir.value.y], time: tt, strength: S.U.uWindStrength.value,
                       gust: S.U.uWindGust.value, freq: S.U.uWindFreq.value, phaseScale: S.U.uWindPhaseScale.value, ring: S.U.uWindRing.value });
  const c0 = out.cards[2] || out.cards[0];   // the tallest card (az 101.3)
  const tipIdx = c0.vStart + 8;              // the first ribbon's tip vertex (rows 0..3 = 8 verts, tip = 9th)
  const tip = [pos.getX(tipIdx), pos.getY(tipIdx), pos.getZ(tipIdx)];
  const anchor = [geo.attributes.aAnchor.getX(tipIdx), 0, geo.attributes.aAnchor.getZ(tipIdx)];
  const H = geo.attributes.aH.getX(tipIdx);
  const p1 = F.fringeWindJS(tip, anchor, 1, H, 0, U(1.0));
  const p2 = F.fringeWindJS(tip, anchor, 1, H, 0, U(3.0));
  const p0 = F.fringeWindJS(tip, anchor, 1, H, 0, { ...U(1.0), strength: 0 });
  out.wind = { tip, H, d1: +Math.hypot(p1[0] - tip[0], p1[2] - tip[2]).toFixed(2), d2: +Math.hypot(p2[0] - tip[0], p2[2] - tip[2]).toFixed(2),
               frozen: +Math.hypot(p0[0] - tip[0], p0[2] - tip[2]).toFixed(2),
               moved: +Math.hypot(p1[0] - p2[0], p1[2] - p2[2]).toFixed(2), pct: +(100 * Math.hypot(p1[0] - tip[0], p1[2] - tip[2]) / H).toFixed(1) };

  // ---- render helpers: the fringe alone, black clear, wind OFF (a still frame per half) ----
  const hidden = [];
  const solo = (keep) => { B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !keep.includes(o) && o.visible) { hidden.push(o); o.visible = false; } }); };
  const unSolo = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  const world = mesh.parent, wScale = world.scale.x; world.scale.setScalar(1); world.updateMatrixWorld(true);
  const wind = S.U.uWindStrength.value; S.U.uWindStrength.value = 0;
  const bg = B.scene.background; B.scene.background = null;
  const clear = new THREE.Color(); R.getClearColor(clear); const clearA = R.getClearAlpha();
  const W = 320, H2 = 240;
  const rt = new THREE.WebGLRenderTarget(W, H2, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const shoot = (cam) => {
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear();
    R.render(B.scene, cam);
    const px = new Float32Array(W * H2 * 4); R.readRenderTargetPixels(rt, 0, 0, W, H2, px); R.setRenderTarget(prev);
    let nz = 0, sr = 0, sg = 0, sb = 0, sl = 0;
    const e8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
    const ch = [[], [], []];
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] + px[i + 1] + px[i + 2] <= 0.002) continue;
      nz++; sr += px[i]; sg += px[i + 1]; sb += px[i + 2];
      sl += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      ch[0].push(e8(px[i])); ch[1].push(e8(px[i + 1])); ch[2].push(e8(px[i + 2]));
    }
    const per = (v) => (nz ? +(v / nz).toFixed(4) : 0);
    const q = (a, f) => { if (!a.length) return 0; const b = Float32Array.from(a).sort(); return +b[Math.min(b.length - 1, Math.floor(f * b.length))].toFixed(1); };
    return { nz, luma: per(sl), rgb: [per(sr), per(sg), per(sb)], med8: ch.map((a) => q(a, 0.5)), p90G: q(ch[1], 0.9), p90_8: ch.map((a) => q(a, 0.9)) };
  };
  // camera in the bay, 5 m outward from the tallest card, level with the water line
  const card = layer.clusters[2];
  const rr = Math.hypot(card.c[0], card.c[2]), ux = card.c[0] / rr, uz = card.c[2] / rr;
  const cam = new THREE.PerspectiveCamera(45, W / H2, 5, 60000);
  cam.position.set(card.c[0] + ux * 5 * M, 1.15 * M, card.c[2] + uz * 5 * M);
  cam.lookAt(card.c[0], 0.05 * M, card.c[2]); cam.updateMatrixWorld();
  solo([mesh]);
  const all = geo.index.count;
  geo.setDrawRange(0, layer.info.aboveIndexCount); out.above = shoot(cam);
  geo.setDrawRange(layer.info.aboveIndexCount, all - layer.info.aboveIndexCount); out.below = shoot(cam);
  geo.setDrawRange(0, all); out.whole = shoot(cam);
  // coverage, square-on: for every card, the above-water half seen from 8 m toward the arena centre, wind off; the share of
  // the card's own rectangle (w x half) that has a blade in it, and how high the silhouette reaches
  geo.setDrawRange(0, layer.info.aboveIndexCount);
  out.cover = layer.clusters.map((cl) => {
    const rr2 = Math.hypot(cl.c[0], cl.c[2]), ux2 = cl.c[0] / rr2, uz2 = cl.c[2] / rr2;
    const half = cl.half, w2 = cl.w;
    const cm = new THREE.PerspectiveCamera(30, 1, 5, 60000);
    cm.position.set(cl.c[0] - ux2 * 8 * M, half / 2, cl.c[2] - uz2 * 8 * M); cm.lookAt(cl.c[0], half / 2, cl.c[2]); cm.updateMatrixWorld();
    const WW = 256, HH = 256, rt2 = new THREE.WebGLRenderTarget(WW, HH, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
    const prev = R.getRenderTarget(); R.setRenderTarget(rt2); R.setClearColor(0x000000, 1); R.clear(); R.render(B.scene, cm);
    const px = new Float32Array(WW * HH * 4); R.readRenderTargetPixels(rt2, 0, 0, WW, HH, px); R.setRenderTarget(prev); rt2.dispose();
    // project the card rectangle's corners
    const ax = -uz2, az2 = ux2;   // sideways
    const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cm); return [(v.x * 0.5 + 0.5) * WW, (v.y * 0.5 + 0.5) * HH]; };
    const cs = [[-1, 0], [1, 0], [-1, half], [1, half]].map(([sx, y]) => proj(cl.c[0] + ax * sx * w2 / 2, y, cl.c[2] + az2 * sx * w2 / 2));
    const x0 = Math.floor(Math.min(...cs.map((c) => c[0]))), x1 = Math.ceil(Math.max(...cs.map((c) => c[0])));
    const y0 = Math.floor(Math.min(...cs.map((c) => c[1]))), y1 = Math.ceil(Math.max(...cs.map((c) => c[1])));
    let inRect = 0, on = 0, topRow = y1;
    for (let y = Math.max(0, y0); y < Math.min(HH, y1); y++) for (let x = Math.max(0, x0); x < Math.min(WW, x1); x++) {
      inRect++; const o = (y * WW + x) * 4;
      if (px[o] + px[o + 1] + px[o + 2] > 0.002) { on++; topRow = Math.min(topRow, y); }
    }
    // image row y grows UP in a read-back; the rectangle's top is y1
    let top = 0; for (let y = Math.min(HH - 1, y1); y >= y0; y--) { let any = false; for (let x = x0; x < x1 && !any; x++) { const o = (y * WW + x) * 4; if (px[o] + px[o + 1] + px[o + 2] > 0.002) any = true; } if (any) { top = y; break; } }
    return { az: +cl.az.toFixed(1), share: inRect ? on / inRect : 0, reach: (top - y0) / Math.max(1, y1 - y0) };
  });
  geo.setDrawRange(0, all);
  unSolo();
  rt.dispose();
  R.setClearColor(clear, clearA); B.scene.background = bg;
  S.U.uWindStrength.value = wind; world.scale.setScalar(wScale); world.updateMatrixWorld(true);

  // ---- cost at 960x720, the viewer's own camera ----
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const camInfo = window.__r.getCameraInfo().render;
  const gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const s = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - s) / n; };
  time(30);
  B.render(camInfo); const a1 = { calls: B.info.calls, tris: B.info.triangles };
  mesh.visible = false; B.render(camInfo); const a2 = { calls: B.info.calls, tris: B.info.triangles };
  mesh.visible = true;
  const shownT = time(FRAMES); mesh.visible = false; const hiddenT = time(FRAMES); mesh.visible = true;
  cv.width = keepW; cv.height = keepH;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  out.cost = { shownMs: shownT, hiddenMs: hiddenT, calls: a1.calls - a2.calls, trisDrawn: a1.tris - a2.tris,
               frameCalls: a1.calls, frameTris: a1.tris, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?" };
  return out;
}, { FRAMES, M });

// ---- 1. inventory ----
const i = res.info || {};
check(!!res.info, `layer builds: info.fringe present (${i.clusters} clumps, ${i.blades} blades, ${i.tris} tris)`);
check(!res.missing, `no missing layer: ${JSON.stringify(res.missing || "none")}`);
check(res.programs.failed === 0, `shader programs: ${res.programs.count} compiled, ${res.programs.failed} failed`);
check(res.mesh.meshes === 1 && res.mesh.blending && !res.mesh.transparent && res.mesh.side && res.mesh.alphaTest === 0,
  `ONE opaque double-sided mesh, no alpha test, no blending: ${JSON.stringify(res.mesh)}`);
check(res.glsl.ring && res.glsl.gust && res.glsl.bend && res.glsl.noise,
  `the sway is the shared wind field: ${JSON.stringify(res.glsl)}`);
check(res.sharedWind && res.windRing > 0,
  `the material's uWindDir/uWindTime/uWindStrength/uWindRing ARE the shared uniform objects (uWindRing ${res.windRing}: the ring gust trees.js sets for this arena)`);

// ---- 2. placement vs MEASURE.md 2d ----
const cards = res.cards;
let bad = [];
for (const m of MEAS.cards) {
  const c = cards.find((k) => Math.abs(k.az - m.az) <= 1.5);
  if (!c) { bad.push(`no clump near az ${m.az}`); continue; }
  const r = c.r / M;
  if (Math.abs(r - m.r) > 0.3) bad.push(`az ${m.az}: r ${r.toFixed(2)} vs ${m.r}`);
  if (Math.abs(c.w / M - m.w) > 0.05) bad.push(`az ${m.az}: width ${(c.w / M).toFixed(2)} vs ${m.w}`);
  if (Math.abs(c.half / M - m.half) > 0.05) bad.push(`az ${m.az}: half height ${(c.half / M).toFixed(2)} vs ${m.half}`);
}
check(cards.length === 5 && bad.length === 0, `5 clumps at the measured spots (az +-1.5 deg, r +-0.3 m, 2.24 m wide, half height +-0.05 m): ${bad.join("; ") || "all match"}`);
const bay = cards.filter((c) => c.az >= MEAS.bay[0] && c.az <= MEAS.bay[1]).length;
check(bay === 4, `${bay} of 5 clumps stand in the lake bay (az ${MEAS.bay[0]}..${MEAS.bay[1]} deg): ${cards.map((c) => `${c.az}deg/${(c.r / M).toFixed(1)}m`).join(", ")}`);

// ---- 3. the two halves ----
const g = res.geo;
check(g.badAbove === 0 && g.badRef === 0, `no above-water vertex below y 0 (${g.badAbove}) and no reflection vertex above it (${g.badRef})`);
check(g.aboveVerts === g.refVerts && g.aboveVerts > 0, `the reflection is an exact copy of the blade block: ${g.aboveVerts} blade / ${g.refVerts} reflection vertices`);
const tops = cards.map((c) => Math.abs(c.aTop - c.half));
const bots = cards.map((c) => Math.abs(c.rBot + c.half));
check(Math.max(...tops) <= 2 && Math.max(...bots) <= 2,
  `blades reach exactly their card's half height and the reflection exactly as deep (worst top ${Math.max(...tops).toFixed(1)} u, bottom ${Math.max(...bots).toFixed(1)} u)`);
check(g.ymax <= MEAS.band[1] * M + 2 && g.ymin >= MEAS.band[0] * M - 2,
  `the whole fringe stays inside the measured band ${MEAS.band[0]}..${MEAS.band[1]} m: ${(g.ymin / M).toFixed(2)}..${(g.ymax / M).toFixed(2)} m`);

// ---- 4. the reflection looks like the measurement ----
const A = res.above, Bl = res.below;
check(A.nz > 200 && Bl.nz > 200, `both halves render: ${A.nz} blade / ${Bl.nz} reflection probe pixels`);
check(Bl.luma < A.luma, `the reflection is darker: mean luma ${Bl.luma} below vs ${A.luma} above (measured [8,32,32] vs [8,64,16])`);
check(Bl.rgb[1] <= A.rgb[1] * 0.85, `the reflection loses green: G ${Bl.rgb[1]} vs ${A.rgb[1]} (ratio ${(Bl.rgb[1] / A.rgb[1]).toFixed(2)}, measured 0.50 in sRGB / <= 0.85 here)`);
check(Bl.rgb[2] >= A.rgb[2], `the reflection is bluer: B ${Bl.rgb[2]} vs ${A.rgb[2]} (measured 2.0x in sRGB)`);

// ---- 3b. dense, wide, full, bright saturated green ----
const perCard = i.blades / i.clusters;
check(perCard >= 150, `dense: ${perCard.toFixed(0)} blades per card (>= 150; the first build had 26), ${i.clusters} clumps`);
const cov = res.cover;
console.log(`     (info) square-on coverage of the card rectangle (above-water half): ${cov.map((c) => `${c.az}deg ${(c.share * 100).toFixed(0)} % reach ${(c.reach * 100).toFixed(0)} %`).join(", ")}`);
check(cov.every((c) => c.share >= 0.40), `full: every clump fills >= 40 % of its card rectangle seen square-on (measured picture: 50 % opaque): ${cov.map((c) => (c.share * 100).toFixed(0)).join(" / ")} %`);
check(cov.every((c) => c.reach >= 0.90), `wide silhouettes reach the card's full measured height: ${cov.map((c) => (c.reach * 100).toFixed(0)).join(" / ")} % of the half height (>= 90)`);
const mA = A.med8, chroma = mA[1] - Math.max(mA[0], mA[2]);
check(mA[0] <= 45 && mA[1] >= 45 && mA[1] <= 100 && mA[2] <= 50 && chroma >= 30,
  `bright saturated green: above-water median sRGB ${JSON.stringify(mA)} (measured [10,61,18]; G 45..100, R/B <= 45/50, chroma G - max(R,B) = ${chroma.toFixed(0)} >= 30)`);
check(A.p90_8[1] >= 75 && A.p90_8[1] <= 110, `lit tips reach the measured p90: 90th-percentile G ${A.p90_8[1]} (measured tip [26,86,20] -> 75..110)`);
const mB = Bl.med8;
check(mB[1] >= 15 && mB[1] <= 55 && mB[2] >= mB[1] * 0.8 && mB[2] > mB[0] * 1.5 && Bl.luma < A.luma * 0.7,
  `dark blue-green reflection: median sRGB ${JSON.stringify(mB)} (measured [10,31,33]), luma ${(Bl.luma / A.luma * 100).toFixed(0)} % of the blades above (< 70)`);

// ---- 5. the shared wind actually moves it ----
const w = res.wind;
check(w.d1 > 1 && w.frozen === 0, `the blade tip sways ${w.d1} u (${w.pct} % of its ${(w.H / M).toFixed(2)} m height) at t = 1 s and freezes at uWindStrength 0`);
check(Math.hypot(w.d1 - w.d2, w.moved) > 1, `the sway travels with time: ${w.d1} u at 1 s vs ${w.d2} u at 3 s`);

// ---- 6. cost ----
const c = res.cost;
check(c.calls === 1, `draw calls of the fringe in the viewer's frame: ${c.calls} (frame total ${c.frameCalls})`);
check(i.tris > 6000 && i.tris < 40000 && c.trisDrawn === i.tris && i.trisAbove * 2 === i.tris, `triangles: ${i.tris} (${i.trisAbove} above + ${i.tris - i.trisAbove} reflection; dense clumps, was 3,640), ${c.trisDrawn} drawn (frame total ${c.frameTris})`);
check(c.shownMs - c.hiddenMs <= 1.0, `frame time at 960x720 over ${FRAMES} frames: shown ${c.shownMs.toFixed(2)} ms, hidden ${c.hiddenMs.toFixed(2)} ms (+${(c.shownMs - c.hiddenMs).toFixed(2)} ms, <= 1.0) on ${c.renderer}`);

// ---- 7. gating ----
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=meft1013&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
const gate = await page.evaluate(() => ({ fr: !!window.__built?.info?.fringe, layers: Object.keys(window.__built?.info?.layers || {}) }));
check(!gate.fr, `gated: meft1013 has no fringe layer (layers ${JSON.stringify(gate.layers)})`);
check(errors.length === 0, `page errors: ${errors.length}${errors.length ? " -> " + errors.slice(0, 3).join(" | ") : ""}`);

console.log(`\nfringe ${ARENA}: ${passes} PASS / ${fails} FAIL`);
await browser.close();
process.exit(fails ? 1 : 0);
