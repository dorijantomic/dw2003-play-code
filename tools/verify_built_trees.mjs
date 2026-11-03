// Numbers check of the near TREE RING of the built meft1008 (web/built/trees.js: kinds cypress_wall / cypress_grove).
// No pictures are looked at: every number is read back from the GPU or from the page's own objects.
//  1. loaded: the module's info, no page/shader errors, every plant above the floor (nothing below y 0: the lake copy is
//     a later step), the ring gust on (U.uWindRing) here and OFF on meft1013 after a reload
//  2. positions vs measured: every plant's ground spot inside its piece's measured ring radius (MEASURE.md 2c,
//     14.60..16.54 m, +-0.5 m for the crown depth) and inside its own card's azimuth span (+-1 deg)
//  3. coverage from the arena centre, measured on the GPU (alpha test included, wind off): 1440 px per 90 deg at
//     every 0.25 m of height, 4 views; per 0.25 deg column -> per piece the opaque share per 0.5 m row vs MEASURE.md
//     (the cards' own opaque share per row), the column tops p10/p50/p90 vs MEASURE.md, the gaps (no opaque column
//     at any height) vs the measured ONE gap az 30.25..135.0 (104.75 deg)
//  4. what the fight camera sees: eye 10 m out, 1.7 m up, looking at the centre, vfov 45, 4:3, 12 azimuths (the
//     measurement's own camera, MEASURE.md 2g): the ring's share of the frame vs the measured floor_00+01+02 share,
//     and the ring pixels' median sRGB vs the cards' measured median (reported; the toon light makes its own bands)
//  5. cost: triangles, draw calls of the ring, frame time at 960x720 over 600 frames with the ring shown vs hidden
//   VERIFY_PORT=8090 ARENA=meft1008 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_trees.mjs
import fs from "node:fs";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const REC = JSON.parse(fs.readFileSync(new URL(`../web/assets-hd/battle/built/${ARENA}.json`, import.meta.url), "utf8"));
const RING_KINDS = ["cypress_wall", "cypress_grove"];
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
if (!REC.pieces.some((p) => RING_KINDS.includes(p.kind))) {
  console.log(`SKIP ${ARENA} has no ${RING_KINDS.join("/")} pieces: nothing to check (not a pass)`);
  process.exit(0);
}

// ---- MEASURE.md (~/dw3-knowledge/research/r5-meft1008/MEASURE.md, 2c / 2g; from the original texels + geometry) ----
const MEAS = {
  ring: [14.60, 16.54],   // r (m) of every floor card corner
  gap: [30.25, 135.0],    // the ONE az gap of floor_00+01+02 together (deg)
  coverAll: 0.709,        // share of the circle with an opaque column
  // opaque share per 0.5 m row (y 0, 0.5 .. 16)
  rows: {
    floor_00: [0.97, 0.94, 0.89, 0.88, 0.77, 0.64, 0.62, 0.5, 0.3, 0.34, 0.4, 0.48, 0.57, 0.66, 0.81, 0.87, 0.81, 0.74, 0.69, 0.66, 0.66, 0.6, 0.56, 0.52, 0.49, 0.49, 0.45, 0.39, 0.28, 0.2, 0.14, 0.07, 0],
    floor_01: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.97, 0.9, 0.66, 0.49, 0.13, 0],
    floor_02: [0.96, 0.93, 0.87, 0.81, 0.72, 0.63, 0.5, 0.32, 0.23, 0.27, 0.38, 0.57, 0.67, 0.78, 0.8, 0.8, 0.78, 0.77, 0.74, 0.7, 0.66, 0.6, 0.58, 0.55, 0.58, 0.54, 0.46, 0.42, 0.33, 0.22, 0.1, 0.05, 0],
  },
  tops: { floor_00: [8.20, 13.51, 15.52], floor_01: [14.55, 15.49, 15.86], floor_02: [7.11, 13.24, 15.52] },   // column tops p10/p50/p90
  topMax: { floor_00: 15.79, floor_01: 16.07, floor_02: 15.79 },
  median: { floor_00: [8, 32, 24], floor_01: [8, 24, 16], floor_02: [8, 16, 8] },   // original texels, sRGB
  // fight camera (12 eyes, every 30 deg from az 0): floor_00 + floor_01 + floor_02 (above y 0) share of the frame
  // fight camera (12 eyes every 30 deg from az 0): floor_00 + floor_01 + floor_02 (above y 0) share of the frame, from
  // MEASURE.md 2g's own ray-cast (tools/meas3.py with every part counted, not only the 8 largest)
  camShare: [0.2897, 0.3347, 0.3282, 0.335, 0.3407, 0.3343, 0.2843, 0.1711, 0.0501, 0.0004, 0.1033, 0.2195],
  // wall_00, the far painted treeline (2c): closed ring at r 27.78 m, 7.41 m tall; silhouette top per 0.1 deg
  far: { rM: 27.78, ymax: 7.41, p10: 5.02, median: 6.08, p90: 6.89, lo: 4.70, hi: 7.32,
         // its 8 picture rows, bottom -> top (the bottom row is PALER than the trees above it)
         rows: [[96, 112, 80], [16, 32, 16], [16, 32, 16], [24, 40, 24], [40, 64, 40], [64, 88, 56]],
         greens: [[23, 40, 20], [57, 81, 46]] },   // the recipe's own picture rows: darkest [23,40,20] .. lit tips [57,81,46]
};

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const B = window.__built, R = B.renderer, out = {};
  const layer = B.layers.find((l) => l.id === "trees");
  out.info = B.info.trees || null; out.missing = B.info.missingLayers || null;
  out.addonErr = B.info.addons?.trees?.error || null;
  if (!layer) return out;
  out.windRing = S.U.uWindRing.value;
  out.instances = layer.instances;
  const ring = layer.meshes;
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  // lowest world y of every ring vertex (instance x vertex), recipe units
  let ymin = Infinity, verts = 0; const v = new THREE.Vector3(), Mi = new THREE.Matrix4();
  for (const m of ring) { const a = m.geometry.attributes.position; for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, Mi); for (let j = 0; j < a.count; j++) { v.fromBufferAttribute(a, j).applyMatrix4(Mi); ymin = Math.min(ymin, v.y); verts++; } } }
  out.ymin = ymin; out.verts = verts;
  out.reflection = !!(layer.reflection && layer.reflection.meshes.length === ring.length && layer.reflection.meshes.every((r) => r.instanceMatrix && r.geometry && r.material));

  // ---- render helpers: only the ring, magenta clear, wind off, world scale 1 (recipe units) ----
  const hidden = [];
  const keepScale = B.scene.children.map((c) => c.scale.x);
  const isRing = (o) => ring.includes(o);
  const soloRing = () => { B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !isRing(o) && o.visible) { hidden.push(o); o.visible = false; } }); };
  const unSolo = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  const world = ring[0].parent.parent;   // group -> world
  const wScale = world.scale.x; world.scale.setScalar(1); world.updateMatrixWorld(true);
  const wind = S.U.uWindStrength.value; S.U.uWindStrength.value = 0;
  const bg = B.scene.background; B.scene.background = null;
  const clear = new THREE.Color(); R.getClearColor(clear); const clearA = R.getClearAlpha();
  const read = (cam, W, H) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0xff00ff, 1); R.clear(); R.render(B.scene, cam);
    const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px); R.setRenderTarget(prev); rt.dispose();
    return px;
  };
  const isBg = (px, i) => px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250;
  soloRing();
  // 3. coverage: camera at the centre at height y, looking out horizontally, 90 deg wide, 1 row read
  const W = 1440, NB = 1440, HSTEP = 0.25, M = 400;
  const heights = []; for (let y = 0.125; y < 16.6; y += HSTEP) heights.push(y);
  const cover = heights.map(() => new Uint8Array(NB));   // bin k = az [-180 + k/4, ...)
  for (let q = 0; q < 4; q++) {
    const azc = -135 + q * 90;   // view centre az (az = atan2(x, z))
    for (const [hi, y] of heights.entries()) {
      const cam = new THREE.PerspectiveCamera(2, W / 3, 10, 40000);
      // horizontal fov 90 deg: vertical fov from the aspect
      cam.fov = 2 * Math.atan(Math.tan(Math.PI / 4) * 3 / W) * 180 / Math.PI; cam.aspect = W / 3; cam.updateProjectionMatrix();
      cam.position.set(0, y * M, 0);
      const a = azc * Math.PI / 180; cam.lookAt(Math.sin(a) * 1000, y * M, Math.cos(a) * 1000); cam.updateMatrixWorld();
      const px = read(cam, W, 3);
      for (let k = 0; k < 360; k++) {   // 0.25 deg bins of this quarter: sample the bin's centre column
        const az = azc - 45 + (k + 0.5) * 0.25, d = (az - azc) * Math.PI / 180;
        // screen x: +x of the camera is to its right; looking along +az, az grows toward -x (az = atan2(x, z))
        const sx = Math.round(W / 2 - Math.tan(d) * W / 2 - 0.5);
        if (sx < 0 || sx >= W) continue;
        const i = (1 * W + sx) * 4;
        const bin = Math.round((az + 180) * 4 - 0.5);
        if (!isBg(px, i)) cover[hi][((bin % NB) + NB) % NB] = 1;
      }
    }
  }
  out.cover = cover.map((r) => Array.from(r)); out.heights = heights;
  // 4. the fight camera of MEASURE.md 2g: eye 10 m out, 1.7 m up, look at the centre, vfov 45, 4:3, 160x120
  out.cams = [];
  for (let k = 0; k < 12; k++) {
    const a = k * 30 * Math.PI / 180, cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
    cam.position.set(Math.sin(a) * 10 * M, 1.7 * M, Math.cos(a) * 10 * M); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const px = read(cam, 160, 120); let n = 0; const cols = [];
    for (let i = 0; i < px.length; i += 4) if (!isBg(px, i)) { n++; cols.push([px[i], px[i + 1], px[i + 2]]); }
    const med = [0, 1, 2].map((c) => { const s = cols.map((x) => x[c]).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; });
    out.cams.push({ az: k * 30, share: n / (160 * 120), median: med });
  }
  // the same ring pixels with the aerial haze off (how much of the colour is haze)
  { const ak = S.U.uAerialK.value; S.U.uAerialK.value = 0; const cols = [];
    for (let k = 0; k < 12; k++) {
      const a = k * 30 * Math.PI / 180, cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
      cam.position.set(Math.sin(a) * 10 * M, 1.7 * M, Math.cos(a) * 10 * M); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      const px = read(cam, 160, 120); for (let i = 0; i < px.length; i += 4) if (!isBg(px, i)) cols.push([px[i], px[i + 1], px[i + 2]]);
    }
    S.U.uAerialK.value = ak;
    out.noHazeMedian = [0, 1, 2].map((c) => { const s = cols.map((x) => x[c]).sort((p, q) => p - q); return s[s.length >> 1]; }); }
  unSolo();
  // the same 12 views with everything shown: how much of the frame is ring (ring drawn last into an id pass is not
  // available, so: full frame vs full frame with the ring hidden, pixels that change)
  out.camsOccl = [];
  for (let k = 0; k < 12; k++) {
    const a = k * 30 * Math.PI / 180, cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
    cam.position.set(Math.sin(a) * 10 * M, 1.7 * M, Math.cos(a) * 10 * M); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const skyMesh = B.camera.userData.sky; if (skyMesh) skyMesh.position.copy(cam.position);
    const p1 = read(cam, 160, 120); for (const m of ring) m.visible = false;
    const p2 = read(cam, 160, 120); for (const m of ring) m.visible = true;
    let n = 0; for (let i = 0; i < p1.length; i += 4) if (Math.abs(p1[i] - p2[i]) + Math.abs(p1[i + 1] - p2[i + 1]) + Math.abs(p1[i + 2] - p2[i + 2]) > 6) n++;
    out.camsOccl.push(n / (160 * 120));
  }
  S.U.uWindStrength.value = wind; B.scene.background = bg; R.setClearColor(clear, clearA);
  world.scale.setScalar(wScale); world.updateMatrixWorld(true);
  // 5. cost at 960x720 with the viewer's own camera
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const camInfo = window.__r.getCameraInfo().render;
  const gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(30);
  // draw calls / triangles of the ring alone in this view
  B.render(camInfo); const all = { calls: B.info.calls, tris: B.info.triangles };
  for (const m of ring) m.visible = false; B.render(camInfo); const without = { calls: B.info.calls, tris: B.info.triangles };
  for (const m of ring) m.visible = true;
  const shown = time(600); for (const m of ring) m.visible = false; const hiddenT = time(600); for (const m of ring) m.visible = true;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  out.cost = { shownMs: shown, hiddenMs: hiddenT, calls: all.calls - without.calls, trisDrawn: all.tris - without.tris, frameCalls: all.calls, frameTris: all.tris,
               renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  cv.width = keepW; cv.height = keepH;
  return out;
});

check(!errors.length, `no page/shader errors (${errors.length})${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
check(!!res.info && !res.addonErr, `trees layer loaded: ${JSON.stringify(res.info?.counts)} plants, ${res.info?.meshes} meshes, ${res.info?.triangles} triangles, build ${res.info?.buildMs} ms${res.addonErr ? " ERROR " + res.addonErr : ""}${res.missing ? " missing " + JSON.stringify(res.missing) : ""}`);
if (!res.info || !res.instances) { console.log(`\n${fails} FAIL`); await browser.close(); process.exit(1); }
check(res.programs.failed === 0, `programs compile (${res.programs.count}, failed ${res.programs.failed})`);
check(res.ymin > -0.05 * 400 && res.ymin < 0, `nothing below the floor: lowest ring vertex y ${(res.ymin / 400).toFixed(3)} m (feet 0.02 m into the ground; the lake copy is NOT built here)`);
check(Math.abs(res.windRing - 0.25) < 1e-9, `shared ring gust on for ${ARENA}: U.uWindRing = ${res.windRing}`);
check(res.reflection, `reflection hand-off: every ring mesh exposed with geometry, material and instanceMatrix (layer.reflection)`);

// 2. positions
const D = 180 / Math.PI;
const cards = res.info.cards;
const spanOf = (c) => { const h = Math.asin(Math.min(1, c.w / 2 / c.r)) * D; return [c.az - h, c.az + h]; };
const inSpan = (az, s, tol) => { const d = (x) => ((x - s[0] + 540) % 360) - 180; return d(az) >= -tol && ((az - s[1] + 540) % 360) - 180 <= tol; };
let badR = 0, badAz = 0, rMin = Infinity, rMax = -Infinity;
for (const it of res.instances) {
  const r = Math.hypot(it.x, it.z) / 400, az = Math.atan2(it.x, it.z) * D;
  rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
  if (r < MEAS.ring[0] - 0.5 || r > MEAS.ring[1] + 0.5) badR++;
  if (!inSpan(az, spanOf(cards[it.card]), 1)) badAz++;
}
check(badR === 0, `every plant's ground spot in the measured ring ${MEAS.ring.join("..")} m (+-0.5): spots at r ${rMin.toFixed(2)}..${rMax.toFixed(2)} m, ${badR} outside`);
check(badAz === 0, `every plant inside its own card's azimuth span (+-1 deg): ${badAz} outside of ${res.instances.length}`);
check(cards.length === 17, `cards (above y 0, merged by ground spot): ${cards.length} (measured 3 + 11 + 3 = 17): ${cards.map((c) => `${c.piece}@${c.az}`).join(" ")}`);

// 3. coverage from the centre
const NB = 1440, binAz = (k) => -180 + (k + 0.5) / 4;
const anyCol = new Uint8Array(NB); for (const row of res.cover) for (let k = 0; k < NB; k++) if (row[k]) anyCol[k] = 1;
const covered = anyCol.reduce((a, b) => a + b, 0) / NB;
const gaps = []; {
  // runs of empty bins, the circle closed
  const start = anyCol.findIndex((x) => x === 1);
  let k = start, run = null;
  for (let s = 0; s <= NB; s++, k = (k + 1) % NB) {
    if (!anyCol[k]) { if (!run) run = { a: k, n: 0 }; run.n++; }
    else if (run) { gaps.push({ from: -180 + run.a / 4, to: -180 + (run.a + run.n) / 4, deg: run.n / 4 }); run = null; }
  }
}
const big = gaps.filter((g) => g.deg >= 1).sort((a, b) => b.deg - a.deg);
const g0 = big[0];
check(big.length === 1 && g0 && Math.abs(g0.from - MEAS.gap[0]) <= 1.5 && Math.abs(g0.to - MEAS.gap[1]) <= 1.5,
  `ONE gap over the bay: ${big.map((g) => `${g.from.toFixed(2)}..${g.to.toFixed(2)} (${g.deg} deg)`).join(", ") || "none"} vs measured ${MEAS.gap[0]}..${MEAS.gap[1]} (104.75 deg); small slits < 1 deg: ${gaps.length - big.length}`);
check(Math.abs(covered - MEAS.coverAll) <= 0.015, `share of the circle with an opaque column ${covered.toFixed(3)} vs measured ${MEAS.coverAll}`);
// per piece rows and column tops
for (const piece of ["floor_00", "floor_01", "floor_02"]) {
  const spans = cards.filter((c) => c.piece === piece).map(spanOf);
  const bins = []; for (let k = 0; k < NB; k++) if (spans.some((s) => inSpan(binAz(k), s, -0.125))) bins.push(k);
  const ys = res.heights;
  const rows = MEAS.rows[piece].map((_, i) => {   // 0.5 m row i = heights within [i*0.5 - 0.25, i*0.5 + 0.25)
    const hs = ys.map((y, j) => [y, j]).filter(([y]) => y >= i * 0.5 - 0.25 && y < i * 0.5 + 0.25).map(([, j]) => j);
    if (!hs.length || !bins.length) return 0;
    let n = 0, t = 0; for (const j of hs) for (const k of bins) { t++; n += res.cover[j][k]; }
    return n / t;
  });
  const err = rows.map((v, i) => v - MEAS.rows[piece][i]);
  const mae = err.reduce((a, b) => a + Math.abs(b), 0) / err.length, mx = Math.max(...err.map(Math.abs));
  const worst = err.map(Math.abs).indexOf(mx);
  console.log(`     ${piece} opaque share by 0.5 m row (ours / measured):`);
  console.log(`       ours ${rows.map((v) => v.toFixed(2)).join(" ")}`);
  console.log(`       meas ${MEAS.rows[piece].map((v) => v.toFixed(2)).join(" ")}`);
  check(mae <= 0.08 && mx <= 0.30, `${piece}: opaque share per 0.5 m row, mean |error| ${mae.toFixed(3)} (<= 0.08), worst ${mx.toFixed(2)} at ${(worst * 0.5).toFixed(1)} m (<= 0.30), ${bins.length} columns`);
  if (piece === "floor_01") {
    // CHANGED (trunks, user verdict "no trunk at all"): the crowns now start at 1.3 m, so the rows 0..1.5 m are trunks (two
    // staggered rows of r 0.2-0.3 m trunks) and no longer 1.00; the closed wall is checked from 1.5 m, the trunk zone separately
    const solid = rows.slice(3, 28).every((v) => v >= 0.97);
    check(solid, `floor_01 is a closed wall from the crown foot (1.5 m) up to 13.5 m: lowest row share = ${Math.min(...rows.slice(3, 28)).toFixed(3)} (>= 0.97)`);
    check(Math.min(...rows.slice(0, 3)) >= 0.70, `floor_01 trunk zone 0..1.5 m is mostly closed by trunks: shares ${rows.slice(0, 3).map((v) => v.toFixed(2)).join(" ")} (>= 0.70; measured 1.00 for the painted wall)`);
  }
  const tops = bins.map((k) => { let t = 0; for (let j = 0; j < ys.length; j++) if (res.cover[j][k]) t = ys[j] + 0.125; return t; }).filter((t) => t > 0).sort((a, b) => a - b);
  const q = (p) => tops[Math.min(tops.length - 1, Math.floor(p * tops.length))];
  const ours = [q(0.1), q(0.5), q(0.9)], mt = MEAS.tops[piece];
  check(Math.abs(ours[1] - mt[1]) <= 1.0 && Math.abs(ours[2] - mt[2]) <= 0.75 && tops[tops.length - 1] <= MEAS.topMax[piece] + 0.5,
    `${piece}: column tops p10/p50/p90 ${ours.map((v) => v.toFixed(2)).join("/")} m vs measured ${mt.join("/")} (p50 +-1.0, p90 +-0.75), max ${tops[tops.length - 1]?.toFixed(2)} vs ${MEAS.topMax[piece]} (+0.5)`);
}

// 4. fight camera
console.log(`     fight camera (MEASURE.md 2g eyes): eye az / ring share alone / ring share in the full frame / measured floor share / ring median sRGB`);
let shareErr = 0;
for (const [k, c] of res.cams.entries()) {
  console.log(`       ${String(c.az).padStart(3)}  ${c.share.toFixed(3)}  ${res.camsOccl[k].toFixed(3)}  ${MEAS.camShare[k].toFixed(3)}  ${JSON.stringify(c.median)}`);
  shareErr = Math.max(shareErr, Math.abs(res.camsOccl[k] - MEAS.camShare[k]));
}
check(shareErr <= 0.08, `ring share of the fight-camera frame vs measured floor_00+01+02 (all 12 eyes): worst |diff| ${shareErr.toFixed(3)} (<= 0.08)`);
const meds = res.cams.filter((c) => c.median[0] != null).map((c) => c.median);
const medAll = [0, 1, 2].map((i) => meds.map((m) => m[i]).sort((a, b) => a - b)[meds.length >> 1]);
console.log(`     (info) ring pixels' median sRGB over the 12 eyes ${JSON.stringify(medAll)}; measured card medians floor_00 ${JSON.stringify(MEAS.median.floor_00)} floor_01 ${JSON.stringify(MEAS.median.floor_01)} floor_02 ${JSON.stringify(MEAS.median.floor_02)} (no haze/light in the cards: reported, not judged); with the aerial haze off ${JSON.stringify(res.noHazeMedian)}`);

// 5. cost
const c = res.cost;
check(c.calls <= 12, `ring draw calls in the viewer's frame: ${c.calls} (<= 12; frame total ${c.frameCalls})`);
check(res.info.triangles <= 120000, `ring triangles ${res.info.triangles} built (<= 120k), ${c.trisDrawn} drawn in the viewer's frame (frame total ${c.frameTris}); per plant ${JSON.stringify(res.info.trisPerPlant)}`);
check(c.shownMs - c.hiddenMs <= 1.5, `frame time at 960x720 over 600 frames: ring shown ${c.shownMs.toFixed(2)} ms, hidden ${c.hiddenMs.toFixed(2)} ms (+${(c.shownMs - c.hiddenMs).toFixed(2)} ms, <= 1.5) on ${c.renderer}`);

// 6. the FAR PINES (wall_00): REAL 3D pines, one row at the recipe's own radius (web/built/trees.js, kind far_pines).
//    Measured from the page's own meshes/geometry and from the GPU (pines alone, magenta clear, wind off):
//    geometry (3D extent, trunk, silhouette profile), placement, top heights, the skyline seen from the centre, closure,
//    colour (saturated green, no haze), needle detail, cost.
const far = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const B = window.__built, R = B.renderer, out = {}, M = 400;
  const layer = B.layers.find((l) => l.id === "trees");
  out.info = B.info.trees?.far || null;
  const f = layer && layer.reflection && layer.reflection.far;
  out.has = !!(f && f.meshes && f.meshes.length);
  if (!out.has) return out;
  const pines = []; B.scene.traverse((o) => { if (o.isInstancedMesh && o.userData?.kind === "farPines") pines.push(o); });
  const lakeFar = []; B.scene.traverse((o) => { if (o.userData?.kind === "mirror" && o.userData.part === "treeline") lakeFar.push(o); });
  out.meshes = pines.map((m) => ({ name: m.name, count: m.count, tris: m.geometry.index.count / 3, transparent: m.material.transparent, alphaTest: m.material.alphaTest,
    side: m.material.side, instanced: m.isInstancedMesh, aerial: /aerial\s*\(/.test(m.material.fragmentShader.slice(m.material.fragmentShader.lastIndexOf("void main"))), discard: /discard/.test(m.material.fragmentShader) }));
  const REC = await (await fetch(`./assets-hd/battle/built/${B.info.pack}.json`)).json();
  const piece = REC.pieces.find((p) => p.kind === "far_pines");
  out.recipe = piece ? { rmax: piece.rmax, ymax: piece.ymax, cards: (piece.cards || []).length, rows: (piece.rows || []).map((r) => (r ? r.rgb : null)) } : null;
  // ---- geometry: per variant, extent in x/y/z, trunk, silhouette profile (max reach per height band), real 3D (not a card)
  out.geo = pines.map((m) => {
    const g = m.geometry, p = g.attributes.position, k = g.attributes.aK;
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let bark = 0, barkTop = 0, limbMinY = 1e9;
    const BANDS = 10, reach = new Float32Array(BANDS);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x); lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y); lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
      if (k.getX(i) > 0.5 && k.getX(i) < 1.5) { bark++; barkTop = Math.max(barkTop, y); } else if (k.getX(i) < 0.5 || k.getX(i) > 1.5) { limbMinY = Math.min(limbMinY, y); const b = Math.min(BANDS - 1, Math.max(0, Math.floor(y * BANDS))); reach[b] = Math.max(reach[b], Math.hypot(x, z)); }
    }
    const hs = new Set(); const aH = g.attributes.aH; let rootMin = 1e9; for (let i = 0; i < p.count; i++) if (k.getX(i) < 0.5) { hs.add(aH.getX(i).toFixed(3)); if (p.getY(i) < 0.9) rootMin = Math.min(rootMin, aH.getX(i)); }
    const az = new Set(); for (let i = 0; i < p.count; i++) if (k.getX(i) < 0.5 && Math.hypot(p.getX(i), p.getZ(i)) > 0.1) az.add(Math.floor((Math.atan2(p.getX(i), p.getZ(i)) + Math.PI) / (Math.PI / 6)));
    return { ext: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], tris: g.index.count / 3, verts: p.count, barkShare: bark / p.count, barkTop, limbMinY, rootMin, reach: Array.from(reach), whorls: hs.size, sectors: az.size };
  });
  // ---- placement and heights (instance matrices)
  const Mi = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), trees = [];
  for (const m of pines) for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, Mi); Mi.decompose(v, q, sc); trees.push({ x: v.x, y: v.y, z: v.z, H: sc.y / M, W: sc.x * m.geometry.userData.Rm / M, variant: m.userData.variant, az: Math.atan2(v.x, v.z) }); }
  out.trees = trees;
  // ---- render helpers: pines alone
  const hidden = [];
  const soloPines = () => { B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !pines.includes(o) && o.visible) { hidden.push(o); o.visible = false; } }); };
  const unSolo = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  const world = pines[0].parent.parent;
  const wScale = world.scale.x; world.scale.setScalar(1); world.updateMatrixWorld(true);
  const wind = S.U.uWindStrength.value; S.U.uWindStrength.value = 0;
  const bg = B.scene.background; B.scene.background = null;
  const clear = new THREE.Color(); R.getClearColor(clear); const clearA = R.getClearAlpha();
  const read = (cam, W, H) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0xff00ff, 1); R.clear(); R.render(B.scene, cam);
    const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px); R.setRenderTarget(prev); rt.dispose(); return px;
  };
  const isBg = (px, i) => px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250;
  soloPines();
  // skyline and closure from the centre: 1440 px per 90 deg at every 0.25 m of height, 4 views
  const W = 1440, NB = 1440, heights = []; for (let y = 0.125; y < 7.7; y += 0.25) heights.push(y);
  const cover = heights.map(() => new Uint8Array(NB));
  for (let qd = 0; qd < 4; qd++) {
    const azc = -135 + qd * 90;
    for (const [hi, y] of heights.entries()) {
      const cam = new THREE.PerspectiveCamera(2, W / 3, 10, 60000);
      cam.fov = 2 * Math.atan(Math.tan(Math.PI / 4) * 3 / W) * 180 / Math.PI; cam.aspect = W / 3; cam.updateProjectionMatrix();
      cam.position.set(0, y * M, 0);
      const a = azc * Math.PI / 180; cam.lookAt(Math.sin(a) * 1000, y * M, Math.cos(a) * 1000); cam.updateMatrixWorld();
      const px = read(cam, W, 3);
      for (let kk = 0; kk < 360; kk++) {
        const az = azc - 45 + (kk + 0.5) * 0.25, d = (az - azc) * Math.PI / 180;
        const sx = Math.round(W / 2 - Math.tan(d) * W / 2 - 0.5);
        if (sx < 0 || sx >= W) continue;
        if (!isBg(px, (1 * W + sx) * 4)) cover[hi][((Math.round((az + 180) * 4 - 0.5) % NB) + NB) % NB] = 1;
      }
    }
  }
  out.cover = cover.map((r) => Array.from(r)); out.heights = heights;
  // fight camera (eye 10 m out, 1.7 m up, vfov 45, 4:3): colours of the pine pixels, 12 eyes
  const cols = [];
  for (let kk = 0; kk < 12; kk++) {
    const a = kk * 30 * Math.PI / 180, cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
    cam.position.set(Math.sin(a) * 10 * M, 1.7 * M, Math.cos(a) * 10 * M); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const px = read(cam, 480, 360);
    for (let i = 0; i < px.length; i += 4) if (!isBg(px, i)) cols.push([px[i], px[i + 1], px[i + 2]]);
  }
  const pick = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const ch = (k) => cols.map((x) => x[k]).sort((a, b) => a - b);
  out.colour = { n: cols.length, p10: [0, 1, 2].map((k) => pick(ch(k), 0.1)), p50: [0, 1, 2].map((k) => pick(ch(k), 0.5)), p90: [0, 1, 2].map((k) => pick(ch(k), 0.9)) };
  const sat = cols.map((x) => { const mx = Math.max(...x), mn = Math.min(...x); return mx ? (mx - mn) / mx : 0; }).sort((a, b) => a - b);
  out.sat = { p10: pick(sat, 0.1), p50: pick(sat, 0.5) };
  out.greenShare = cols.filter((x) => x[1] > x[0] + 4 && x[1] > x[2] + 4).length / Math.max(1, cols.length);
  // needle detail: luma std-dev in 5x5 windows fully inside the trees, bay view (eye az 270), 960x720
  { const a = 270 * Math.PI / 180, cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
    cam.position.set(Math.sin(a) * 10 * M, 1.7 * M, Math.cos(a) * 10 * M); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const Wd = 960, Hd = 720, px = read(cam, Wd, Hd), L = new Float32Array(Wd * Hd), on = new Uint8Array(Wd * Hd);
    for (let i = 0; i < Wd * Hd; i++) { L[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; on[i] = isBg(px, i * 4) ? 0 : 1; }
    let sum = 0, cnt = 0;
    for (let y = 3; y < Hd - 3; y += 2) for (let x = 3; x < Wd - 3; x += 2) {
      let all = 1; for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!on[(y + dy) * Wd + x + dx]) { all = 0; break; }
      if (!all) continue; let m = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m += L[(y + dy) * Wd + x + dx]; m /= 25;
      let s2 = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s2 += (L[(y + dy) * Wd + x + dx] - m) ** 2; sum += Math.sqrt(s2 / 25); cnt++;
    }
    out.detail = { localStd: cnt ? sum / cnt : 0, windows: cnt };
  }
  unSolo();
  S.U.uWindStrength.value = wind; B.scene.background = bg; R.setClearColor(clear, clearA); world.scale.setScalar(wScale); world.updateMatrixWorld(true);
  // cost at 960x720, viewer's camera: pines shown / upright pines hidden / pines + their lake copies hidden
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const camInfo = window.__r.getCameraInfo().render, gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(30);
  const setV = (arr, v) => { for (const o of arr) o.visible = v; };
  B.render(camInfo); const all = { calls: B.info.calls, tris: B.info.triangles };
  setV(pines, false); B.render(camInfo); const noUp = { calls: B.info.calls, tris: B.info.triangles };
  setV(lakeFar, false); B.render(camInfo); const none = { calls: B.info.calls, tris: B.info.triangles };
  setV(pines, true); setV(lakeFar, true);
  const shown = time(600); setV(pines, false); const noUpT = time(600); setV(lakeFar, false); const noneT = time(600); setV(pines, true); setV(lakeFar, true);
  cv.width = keepW; cv.height = keepH;
  out.cost = { upright: { calls: all.calls - noUp.calls, tris: all.tris - noUp.tris }, lake: { calls: noUp.calls - none.calls, tris: noUp.tris - none.tris },
               shown, noUp: noUpT, none: noneT, frameCalls: all.calls, frameTris: all.tris };
  return out;
});
check(far.has, "far pines exposed (layer.reflection.far.meshes)");
if (far.has) {
  const FM = MEAS.far, V = far.meshes.length;
  check(V === 4 && far.meshes.every((m) => m.instanced && m.side === 2 && !m.transparent && m.alphaTest === 0),
    `far pines: ${V} InstancedMeshes (one per variant), opaque (transparent ${far.meshes[0]?.transparent}, alphaTest ${far.meshes[0]?.alphaTest}), double-sided; trees per variant ${far.meshes.map((m) => m.count).join("/")}`);
  check(far.meshes.every((m) => !m.aerial), `no aerial haze in the pine shader (aerial() calls in main(): ${far.meshes.filter((m) => m.aerial).length}); needle comb by discard: ${far.meshes[0]?.discard}`);
  const R0 = far.recipe;
  check(!!R0 && R0.cards === 24 && Math.abs(R0.rmax / 400 - FM.rM) < 0.05, `recipe kind far_pines: ${R0?.cards} cards, r ${(R0?.rmax / 400).toFixed(2)} m`);
  for (const [i, g] of far.geo.entries()) console.log(`     variant ${i}: ${g.tris} tris, ${g.verts} vertices, extent x/y/z ${g.ext.map((v) => v.toFixed(3)).join("/")}, ${g.whorls} whorl heights, limbs in ${g.sectors}/12 azimuth sectors, bark ${(g.barkShare * 100).toFixed(0)} % of vertices up to ${g.barkTop.toFixed(2)}, lowest needle y ${g.limbMinY.toFixed(3)}, reach by tenth ${g.reach.map((v) => v.toFixed(2)).join(" ")}`);
  check(far.geo.every((g) => g.tris >= 800 && g.ext[2] >= 0.8 * g.ext[0] && g.sectors >= 11 && g.whorls >= 11),
    `each variant is a real 3D tree: >= 800 tris (${far.geo.map((g) => g.tris).join("/")}), depth/width ${far.geo.map((g) => (g.ext[2] / g.ext[0]).toFixed(2)).join("/")} (>= 0.8, a card would be ~0), limbs all round (>= 11 of 12 sectors), >= 11 whorls (${far.geo.map((g) => g.whorls).join("/")})`);
  check(far.geo.every((g) => g.barkTop >= 0.9 && g.limbMinY >= -0.005 && g.rootMin >= 0.1 && g.rootMin <= 0.2 && g.barkShare > 0.02),
    `trunk: bark runs to the tip (top ${far.geo.map((g) => g.barkTop.toFixed(2)).join("/")} of the height), bare below the lowest whorl root (${far.geo.map((g) => (g.rootMin * 100).toFixed(0)).join("/")} % of the height), no needle under the ground (lowest ${far.geo.map((g) => (g.limbMinY * 100).toFixed(1)).join("/")} %)`);
  check(far.geo.every((g) => { const r = g.reach; return r[1] > r[4] && r[4] > r[7] && r[7] > r[9] && Math.max(...r.slice(0, 4)) >= r[9] * 2.5 && r[9] < 0.3; }),
    `conical silhouette: crown reach falls from the lower tenths (1) through the middle (4) and upper (7) to the tip (9), and the foot is >= 2.5x the top tenth: ${far.geo.map((g) => g.reach.map((v) => v.toFixed(2)).join(" ")).join(" | ")}`);
  const Hs = far.trees.map((t) => t.H).sort((a, b) => a - b), Ws = far.trees.map((t) => t.W);
  const pq = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const distinctH = new Set(far.trees.map((t) => t.H.toFixed(2))).size;
  check(far.trees.length >= 50 && distinctH >= far.trees.length * 0.75 && new Set(far.trees.map((t) => t.variant)).size === 4 && Math.max(...Ws) / Math.min(...Ws) >= 1.25,
    `varied: ${far.trees.length} trees, ${distinctH} distinct heights, 4 variants, crown radius ${Math.min(...Ws).toFixed(2)}..${Math.max(...Ws).toFixed(2)} m`);
  const rs = far.trees.map((t) => Math.hypot(t.x, t.z) / 400), ys = far.trees.map((t) => t.y);
  check(rs.every((r) => Math.abs(r - FM.rM) <= 0.35) && Math.min(...ys) >= -1e-6, `one row on the recipe radius: r ${Math.min(...rs).toFixed(2)}..${Math.max(...rs).toFixed(2)} m (27.78 +-0.35), all feet at y >= 0 (${(Math.min(...ys) / 400).toFixed(3)})`);
  const azs = far.trees.map((t) => t.az * 180 / Math.PI).sort((a, b) => a - b); let maxGap = 0;
  for (let i = 0; i < azs.length; i++) maxGap = Math.max(maxGap, ((azs[(i + 1) % azs.length] - azs[i] + 360) % 360));
  const meanW = Ws.reduce((a, b) => a + b, 0) / Ws.length;
  check(maxGap * Math.PI / 180 * FM.rM <= 2 * Math.max(...Ws), `neighbours touch: largest centre gap ${(maxGap * Math.PI / 180 * FM.rM).toFixed(2)} m vs mean crown diameter ${(2 * meanW).toFixed(2)} m (gap <= the widest crown's diameter ${(2 * Math.max(...Ws)).toFixed(2)})`);
  const tp = { min: Hs[0], p10: pq(Hs, 0.1), median: pq(Hs, 0.5), p90: pq(Hs, 0.9), max: Hs[Hs.length - 1] };
  check(Math.abs(tp.median - FM.median) <= 0.35 && Math.abs(tp.p10 - FM.p10) <= 0.6 && Math.abs(tp.p90 - FM.p90) <= 0.5 && tp.max <= 7.34 && tp.max >= 7.25 && tp.min >= 4.65,
    `tree TOPS: min ${tp.min.toFixed(2)} p10 ${tp.p10.toFixed(2)} median ${tp.median.toFixed(2)} p90 ${tp.p90.toFixed(2)} max ${tp.max.toFixed(2)} m vs measured silhouette ${FM.lo}/${FM.p10}/${FM.median}/${FM.p90}/${FM.hi} (median +-0.35, p10 +-0.6, p90 +-0.5)`);
  const NB2 = 1440, ysH = far.heights, top = [];
  for (let k = 0; k < NB2; k++) { let t = 0; for (let j = 0; j < ysH.length; j++) if (far.cover[j][k]) t = ysH[j] + 0.125; top.push(t); }
  const sk = top.slice().sort((a, b) => a - b);
  const rowShare = (y) => { const j = ysH.findIndex((h) => h > y); return far.cover[j].reduce((a, b) => a + b, 0) / NB2; };
  check(rowShare(1.0) >= 0.98 && rowShare(2.0) >= 0.93, `ring closed all round at the feet (opaque share of the 360 deg at 1 m ${rowShare(1.0).toFixed(3)} (>= 0.98), 2 m ${rowShare(2.0).toFixed(3)} (>= 0.93); 3 m ${rowShare(3.0).toFixed(3)} and 4 m ${rowShare(4.0).toFixed(3)} are reported only: above the touching point the cones part, the original paints sky/grass there)`);
  console.log(`     skyline from the centre per 0.25 deg (highest opaque pixel): min ${sk[0].toFixed(2)} p10 ${pq(sk, 0.1).toFixed(2)} median ${pq(sk, 0.5).toFixed(2)} p90 ${pq(sk, 0.9).toFixed(2)} max ${sk[NB2 - 1].toFixed(2)} m; measured ${FM.lo}/${FM.p10}/${FM.median}/${FM.p90}/${FM.hi}; share of columns with no pine at 4.0 m: ${(1 - rowShare(4.0)).toFixed(3)}`);
  check(sk[NB2 - 1] <= 7.5 && Math.abs(pq(sk, 0.5) - FM.median) <= 1.0 && sk[0] >= 2.0,
    `skyline as the camera sees it: max ${sk[NB2 - 1].toFixed(2)} (<= 7.5), median ${pq(sk, 0.5).toFixed(2)} (measured ${FM.median} +-1.0; valleys between cones are lower than a painted ridge), lowest column ${sk[0].toFixed(2)} (>= 2.0)`);
  const c = far.colour, lo = FM.greens[0], hi = FM.greens[1];
  console.log(`     pine pixels (12 eyes, ${c.n} px): p10 ${c.p10} median ${c.p50} p90 ${c.p90} sRGB; measured rows ${JSON.stringify(lo)} .. ${JSON.stringify(hi)}; saturation p10/p50 ${far.sat.p10.toFixed(2)}/${far.sat.p50.toFixed(2)}; green share ${far.greenShare.toFixed(3)}`);
  check(far.sat.p50 >= 0.40 && far.greenShare >= 0.90 && c.p50[1] > c.p50[0] + 10 && c.p50[1] > c.p50[2] + 10,
    `saturated green, not grey: median saturation ${far.sat.p50.toFixed(2)} (>= 0.40; grey haze would be < 0.2), ${(far.greenShare * 100).toFixed(1)} % of pine pixels green-dominant (>= 90 %; the rest is bark and deep shade)`);
  check(c.p10.every((v, i) => v >= lo[i] - 14 && v <= hi[i]) && c.p90.every((v, i) => v >= lo[i] && v <= hi[i] + 28) && c.p50.every((v, i) => v >= lo[i] - 4 && v <= hi[i] + 4),
    `colours inside the measured row range ${JSON.stringify(lo)}..${JSON.stringify(hi)}: p10 ${c.p10}, median ${c.p50}, p90 ${c.p90} (lighting x0.74..1.2, per-tree +-8 %)`);
  check(far.detail.localStd >= 5, `needle/branch texture: mean local luma std-dev over 5x5 windows inside the trees ${far.detail.localStd.toFixed(1)} /255 (>= 5; a flat fill is ~0-2), ${far.detail.windows} windows`);
  check(far.cost.upright.calls === V && far.cost.lake.calls === V, `draw calls: upright pines ${far.cost.upright.calls}, their lake copies ${far.cost.lake.calls} (one per variant each)`);
  const dUp = far.cost.shown - far.cost.noUp, dLake = far.cost.noUp - far.cost.none;
  console.log(`     (info) triangles drawn in the viewer's frame: pines ${far.cost.upright.tris}, lake copies ${far.cost.lake.tris}; frame ${far.cost.frameCalls} calls / ${far.cost.frameTris} tris; 960x720 x600: all ${far.cost.shown.toFixed(2)} ms, no upright pines ${far.cost.noUp.toFixed(2)} ms, no pines at all ${far.cost.none.toFixed(2)} ms`);
  check(far.cost.shown - far.cost.none <= 1.0, `cost of the far pines + their reflection at 960x720 over 600 frames: +${(far.cost.shown - far.cost.none).toFixed(2)} ms (upright +${dUp.toFixed(2)}, copies +${dLake.toFixed(2)}; target well under 1 ms)`);
}


// 7. the NEAR CYPRESSES: visible trunks and leafy, broken edges (USER: "no trunk at all, entirely green"; "smooth green
//    sticks on poles"). Measured from the geometry (bark vertices per species, ring-radius spread) and from the GPU (ring
//    alone: bark-coloured pixels at trunk height, pixels lost to the edge breakup).
const cyp = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const B = window.__built, R = B.renderer, out = {}, M = 400;
  const layer = B.layers.find((l) => l.id === "trees");
  const ring = layer.meshes;
  out.species = {};
  for (const m of ring) {
    const sp = m.userData.species;
    if (out.species[sp] || !m.geometry.attributes.kind) continue;
    const g = m.geometry, p = g.attributes.position, kd = g.attributes.kind, Href = g.userData.Href;
    let bark = 0, barkTop = 0, barkR = 0, barkRFoot = 0; const rings = new Map();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      if (kd.getX(i) > 0.5) { bark++; barkTop = Math.max(barkTop, y); if (y > 0.1 / Href && y < 0.8 / Href) barkR = Math.max(barkR, r); if (y < 0.05 / Href) barkRFoot = Math.max(barkRFoot, r); }
      else if (y > g.userData.cb + 0.03 && r > 0.2 / Href) { const key = y.toFixed(5); if (!rings.has(key)) rings.set(key, []); rings.get(key).push(r); }
    }
    let spread = 0, n = 0;
    for (const rs of rings.values()) { if (rs.length < 6) continue; const mu = rs.reduce((a, b) => a + b, 0) / rs.length; const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mu) ** 2, 0) / rs.length); spread += sd / mu; n++; }
    out.species[sp] = { Href, cb: g.userData.cb * Href, barkVerts: bark, barkTopM: barkTop * Href, barkR02: barkR * Href, barkRFoot: barkRFoot * Href, jag: n ? spread / n : 0, rings: n, tris: g.index.count / 3, mat: m.material };
  }
  for (const k of Object.keys(out.species)) delete out.species[k].mat;
  // GPU: ring alone
  const hidden = [];
  const isRing = (o) => ring.includes(o);
  const solo = () => { B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !isRing(o) && o.visible) { hidden.push(o); o.visible = false; } }); };
  const unSolo = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  const world = ring[0].parent.parent, wScale = world.scale.x; world.scale.setScalar(1); world.updateMatrixWorld(true);
  const wind = S.U.uWindStrength.value; S.U.uWindStrength.value = 0;
  const bg = B.scene.background; B.scene.background = null;
  const clear = new THREE.Color(); R.getClearColor(clear); const clearA = R.getClearAlpha();
  const read = (cam, W, H) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true }); rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0xff00ff, 1); R.clear(); R.render(B.scene, cam);
    const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px); R.setRenderTarget(prev); rt.dispose(); return px;
  };
  const isBg = (px, i) => px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250;
  solo();
  // bark pixels: camera at the centre, y = 0.5 m and 1.0 m, 4 x 90 deg, 1440 px wide: opaque pixels whose red >= green (bark is brown-grey, foliage green-dominant)
  const W = 1440; out.trunk = {};
  for (const y of [0.5, 1.0, 3.0]) {
    let opaque = 0, barky = 0;
    for (let qd = 0; qd < 4; qd++) {
      const azc = -135 + qd * 90, cam = new THREE.PerspectiveCamera(2, W / 3, 10, 40000);
      cam.fov = 2 * Math.atan(Math.tan(Math.PI / 4) * 3 / W) * 180 / Math.PI; cam.aspect = W / 3; cam.updateProjectionMatrix();
      cam.position.set(0, y * M, 0); const a = azc * Math.PI / 180; cam.lookAt(Math.sin(a) * 1000, y * M, Math.cos(a) * 1000); cam.updateMatrixWorld();
      const px = read(cam, W, 3);
      for (let x = 0; x < W; x++) { const i = (W + x) * 4; if (isBg(px, i)) continue; opaque++; if (px[i] >= px[i + 1]) barky++; }
    }
    out.trunk[y] = { opaque, barky };
  }
  // edge breakup on ONE wall tree seen from the side (the whole wall hides its own edges): its silhouette with the
  // material's uErode on (default) vs 0: opaque pixels and boundary pixels (opaque with a see-through 4-neighbour)
  const wm = ring.find((m) => m.userData.species === "wall"), wallMat = wm?.material, e0 = wallMat?.uniforms.uErode.value;
  const one = () => {
    const Mi = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    wm.getMatrixAt(0, Mi); Mi.decompose(p, q, sc);
    const Hm = sc.y / M, k = 1 - 9 * M / Math.hypot(p.x, p.z);
    const cam = new THREE.PerspectiveCamera(30, 0.5, 10, 60000);
    cam.position.set(p.x * k, Hm * M * 0.5, p.z * k); cam.lookAt(p.x, Hm * M * 0.5, p.z); cam.updateMatrixWorld();
    const W = 300, H = 600, px = read(cam, W, H); let area = 0, edge = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = (y * W + x) * 4; if (isBg(px, i)) continue; area++;
      if (isBg(px, i - 4) || isBg(px, i + 4) || isBg(px, i - W * 4) || isBg(px, i + W * 4)) edge++; }
    return { area, edge };
  };
  const cnt0 = wm.count; wm.count = 1;
  for (const m of ring) if (m !== wm) m.visible = false;
  out.edge = { eroded: one() }; if (wallMat) wallMat.uniforms.uErode.value = 0; out.edge.smooth = one(); if (wallMat) wallMat.uniforms.uErode.value = e0;
  wm.count = cnt0; for (const m of ring) m.visible = true;
  unSolo();
  S.U.uWindStrength.value = wind; B.scene.background = bg; R.setClearColor(clear, clearA); world.scale.setScalar(wScale); world.updateMatrixWorld(true);
  return out;
});
{
  const w = cyp.species.wall, gr = cyp.species.grove;
  console.log(`     cypress geometry: ${JSON.stringify(Object.fromEntries(Object.entries(cyp.species).map(([k, v]) => [k, { cb: +v.cb.toFixed(2), barkTopM: +v.barkTopM.toFixed(2), barkR02: +v.barkR02.toFixed(3), barkRFoot: +v.barkRFoot.toFixed(3), jag: +v.jag.toFixed(3), tris: v.tris }])))}`);
  check(!!w && !!gr && w.barkVerts > 0 && gr.barkVerts > 0 && w.barkTopM >= 1.2 && gr.barkTopM >= 4.5,
    `cypresses have a trunk (bark vertices, kind 1): the wall trees show ${w?.barkTopM.toFixed(2)} m of bark below the crown (cb ${w?.cb.toFixed(2)} m, was 0), the grove trees ${gr?.barkTopM.toFixed(2)} m (cb ${gr?.cb.toFixed(2)} m)`);
  check(w.barkR02 >= 0.15 && w.barkRFoot >= 1.3 * w.barkR02 * 0.9 && gr.barkR02 >= 0.15,
    `trunks are thick enough to read: radius between 0.1 and 0.8 m ${w.barkR02.toFixed(2)} m (wall) / ${gr.barkR02.toFixed(2)} m (grove), flared at the foot ${w.barkRFoot.toFixed(2)} m`);
  check(w.jag >= 0.06 && gr.jag >= 0.06, `leafy, broken outline: mean ring-radius spread (std/mean over the sides of every crown ring) ${w.jag.toFixed(3)} wall / ${gr.jag.toFixed(3)} grove (>= 0.06), ${w.tris} tris per wall tree`);
  const t05 = cyp.trunk[0.5], t10 = cyp.trunk[1.0], t30 = cyp.trunk[3.0];
  console.log(`     bark-coloured share of the opaque pixels seen from the centre: 0.5 m ${(t05.barky / t05.opaque).toFixed(3)} (${t05.opaque} px), 1.0 m ${(t10.barky / t10.opaque).toFixed(3)}, 3.0 m ${(t30.barky / t30.opaque).toFixed(3)}`);
  check(t05.barky / t05.opaque >= 0.5 && t30.barky / t30.opaque <= 0.1,
    `at trunk height the ring is bark, higher it is foliage: bark share of the opaque pixels ${(t05.barky / t05.opaque).toFixed(2)} at 0.5 m (>= 0.5), ${(t30.barky / t30.opaque).toFixed(3)} at 3 m (<= 0.1)`);
  const lost = 1 - cyp.edge.eroded.area / cyp.edge.smooth.area, rough = cyp.edge.eroded.edge / cyp.edge.smooth.edge;
  check(lost >= 0.01 && lost <= 0.30 && rough >= 1.25,
    `leaf edge breakup on one wall tree: it loses ${(lost * 100).toFixed(1)} % of its pixels to ragged foliage (1..30 %) and its outline gets ${rough.toFixed(2)}x more boundary pixels (>= 1.25x) (${cyp.edge.eroded.area}/${cyp.edge.eroded.edge} vs ${cyp.edge.smooth.area}/${cyp.edge.smooth.edge} area/boundary px)`);
}

// gating: meft1013 after this arena: the ring gust is off again and no trees layer exists
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=meft1013&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
const g = await page.evaluate(async () => { const S = await import("./built/shared.js"); return { ring: S.U.uWindRing.value, trees: !!window.__built?.info?.trees, layers: Object.keys(window.__built?.info?.layers || {}) }; });
check(g.ring === 0 && !g.trees, `gated: meft1013 has uWindRing ${g.ring} and no ring layer (layers ${JSON.stringify(g.layers)})`);

console.log(`\n${fails ? fails + " FAIL" : "all PASS"}`);
await browser.close();
process.exit(fails ? 1 : 0);
