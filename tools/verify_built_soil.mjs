// Numbers check of the BUILT arena's SOIL ground (web/built/soil.js through web/built/ground.js; recipe kind "soil",
// meft1008 wall_02). No pictures. (tools/verify_built_ground.mjs is the grass-ground / beach checker of meft1013 and
// meft1002 and stays as it is: it is the before/after proof that those arenas did not change.)
//  - inventory: the soil floor mesh(es) + ONE apron mesh "builtApron", both kind "soil", the SAME material; no hills,
//    no scattered boulders, no ground-pattern material; zero grass blades on soil (grass.js info)
//  - the floor outline: per 1 deg of azimuth the first radius with no floor, found by a RAY DOWN on the real floor
//    mesh every 20 units (independent of soil.js's point-in-triangle test), vs soil.js's own outline (floorEnd) and
//    vs MEASURE's ground_outline (36 azimuths, metres, measured from the disc's own pack data: MEAS env, default
//    ~/dw3-knowledge/research/r5-meft1008/tools/meas.json; not in the repo, disc-derived)
//  - the apron: every tree-ring card foot of MEASURE's bands (floor_00/01/02 cards, 9 points along each card's
//    az_span at its r) stands on land (ray down hits the floor or the apron at y 0); the bay (no cards) stays open:
//    no apron triangle at an azimuth no card covers; the apron is flat (every vertex y 0)
//  - the paint: soilPaint() on the GPU (soil.js soilProbeMaterial, the mesh's own uniform objects) at N points
//    spread over the floor: linear mean vs the piece's measured `all` (the tint target), luma p10..p90 span vs the
//    measured span (the contrast target), photo loaded and both textures 2048 px
//  - one shared uniform object; programs compile; draw calls and triangles of the soil meshes; frame time at the
//    viewport size (960x720) shown vs hidden over FRAMES frames; page errors 0
//   VERIFY_PORT=8090 ARENA=meft1008 [FRAMES=120] [MEAS=...] tools/run-playwright.sh tools/verify_built_soil.mjs
import fs from "node:fs";
import os from "node:os";
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 120));
const MEAS_PATH = process.env.MEAS || `${os.homedir()}/dw3-knowledge/research/r5-meft1008/tools/meas.json`;
const MEAS = fs.existsSync(MEAS_PATH) ? JSON.parse(fs.readFileSync(MEAS_PATH, "utf8")) : null;
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => window.__built?.info?.ground?.soil?.tone || !window.__built?.info?.ground?.soil, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
let fails = 0, passes = 0, skips = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const skip = (msg) => { skips++; console.log(`SKIP ${msg}`); };

const cardsIn = MEAS ? ["floor_00", "floor_01", "floor_02"].flatMap((k) => (MEAS.bands?.[k]?.cards || []).map((c) => ({ ...c, piece: k }))) : [];
const R0 = await page.evaluate(async ({ frames: FRAMES, gpu: GPU, cards }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const SO = await import("./built/soil.js");
  const B = window.__built, rr = window.__r;
  if (!B) return { missing: true };
  const R = B.renderer;
  rr.render(0); const cam = rr.getCameraInfo().render; B.render(cam);
  const out = {};
  const soil = []; B.scene.traverse((o) => { if (o.isMesh && o.userData.kind === "soil") soil.push(o); });
  const floor = soil.filter((m) => m.name !== "builtApron"), apron = B.scene.getObjectByName("builtApron");
  const kinds = {}; B.scene.traverse((o) => { if (o.isMesh) kinds[o.userData.kind || o.name] = (kinds[o.userData.kind || o.name] || 0) + 1; });
  const gi = B.info.ground || {}, si = gi.soil || null;
  out.inv = { soil: soil.length, floor: floor.length, apron: !!apron, kinds,
              sameMat: soil.every((m) => m.material === soil[0]?.material), matName: soil[0]?.material?.name,
              hills: !!B.scene.getObjectByName("builtHills"), boulders: B.ground.rocks ? B.ground.rocks.count : 0,
              rocksInfo: gi.rocks?.skipped || null, hillsInfo: gi.parts?.hills?.skipped || null,
              grass: B.info.grass || null, uMask: soil.some((m) => !!m.material.uniforms.uMask) };
  out.soilInfo = si && { apron: si.apron, tone: si.tone && { tint: si.tone.tint, contrast: si.tone.contrast, target: si.tone.target, photo: si.tone.photo, mean: si.tone.mean, px: si.tone.px, readMs: si.tone.readMs },
                         measured: si.measured, credit: si.credit, shoreMs: si.shore?.ms };
  if (!floor.length) return out;
  const u = floor[0].material.uniforms;
  out.tex = { on: u.uSoilOn.value, a: u.uSoilAlbedo.value.image?.width || 0, n: u.uSoilNormal.value.image?.width || 0 };
  // ---- 1. outline by a ray down on the real floor mesh ----
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o3 = new THREE.Vector3();
  const hitAt = (objs, x, z) => { o3.set(x, 1e4, z); ray.set(o3, down); return ray.intersectObjects(objs, false)[0] || null; };
  out.outline = { mesh: [], soil: si?.shore?.floorEnd || [], land: si?.shore?.landEnd || [] };
  for (let k = 0; k < 360; k++) {
    const az = (-180 + k) * Math.PI / 180, s = Math.sin(az), c = Math.cos(az);
    let end = null;
    for (let r = 0; r <= 12000; r += 20) if (!hitAt(floor, s * r, c * r)) { end = r; break; }
    out.outline.mesh.push(end);
  }
  // ---- 2. card feet on land; bay open; apron flat ----
  const groundObjs = [...floor, apron].filter(Boolean);
  out.feet = { n: 0, onLand: 0, onApron: 0, worst: null };
  for (const cd of cards) {
    for (let i = 0; i <= 8; i++) {
      const a = (cd.az_span[0] + (cd.az_span[1] - cd.az_span[0]) * i / 8) * Math.PI / 180, r = cd.r * 400;
      const h = hitAt(groundObjs, Math.sin(a) * r, Math.cos(a) * r);
      out.feet.n++;
      if (h && Math.abs(h.point.y) < 1) { out.feet.onLand++; if (h.object === apron) out.feet.onApron++; }
      else if (!out.feet.worst) out.feet.worst = { piece: cd.piece, az: +(a * 180 / Math.PI).toFixed(2), r: cd.r };
    }
  }
  // MEASURE spans may run past +-180 (e.g. [180, 195.95]): test the azimuth's offset from the span start mod 360
  // soil.js keeps whole 1 deg apron columns, so the apron may run up to 1 deg past a card end (+0.01 for float edges)
  const covered = (azDeg) => cards.some((cd) => (((azDeg - cd.az_span[0] + 1.01) % 360) + 360) % 360 <= cd.az_span[1] - cd.az_span[0] + 2.02);
  out.bay = { apronVertsUncovered: 0, apronVerts: 0, maxAbsY: 0, minR: Infinity, maxR: 0 };
  if (apron) {
    const P = apron.geometry.attributes.position;
    for (let j = 0; j < P.count; j++) {
      const x = P.getX(j), y = P.getY(j), z = P.getZ(j), az = Math.atan2(x, z) * 180 / Math.PI;
      out.bay.apronVerts++; out.bay.maxAbsY = Math.max(out.bay.maxAbsY, Math.abs(y));
      out.bay.minR = Math.min(out.bay.minR, Math.hypot(x, z)); out.bay.maxR = Math.max(out.bay.maxR, Math.hypot(x, z));
      if (cards.length && !covered(az)) out.bay.apronVertsUncovered++;
    }
  }
  // ---- 3. paint on the GPU at N points over the floor ----
  {
    const pts = [], fp = floor[0].geometry.attributes.position;
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const nt = fp.count / 3;
    const areas = []; let tot = 0;
    for (let t = 0; t < nt; t++) {
      const ax = fp.getX(t * 3), az = fp.getZ(t * 3), bx = fp.getX(t * 3 + 1), bz = fp.getZ(t * 3 + 1), cx = fp.getX(t * 3 + 2), cz = fp.getZ(t * 3 + 2);
      tot += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2; areas.push(tot);
    }
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const q = rnd() * tot; let t = areas.findIndex((a) => a >= q); if (t < 0) t = nt - 1;
      let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const v = (k, f) => f.call(fp, t * 3 + k);
      pts.push([v(0, fp.getX) + a * (v(1, fp.getX) - v(0, fp.getX)) + b * (v(2, fp.getX) - v(0, fp.getX)), 0,
                v(0, fp.getZ) + a * (v(1, fp.getZ) - v(0, fp.getZ)) + b * (v(2, fp.getZ) - v(0, fp.getZ))]);
    }
    const CELL = 2, cols = 200, rows = Math.ceil(N / cols);
    const P = new Float32Array(N * 3), id = new Float32Array(N);
    pts.forEach((p, i) => { P.set(p, i * 3); id[i] = i; });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("pid", new THREE.BufferAttribute(id, 1));
    const probe = SO.soilProbeMaterial(floor[0]);
    const mat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, probe.uniforms, { uGrid: { value: new THREE.Vector2(cols, rows) } }),
      vertexShader: `attribute float pid; uniform vec2 uGrid; varying vec3 vW;
        void main(){ vW = position; gl_PointSize = 2.0;
          gl_Position = vec4((mod(pid, uGrid.x) + 0.25) / uGrid.x * 2.0 - 1.0, (floor(pid / uGrid.x) + 0.25) / uGrid.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: probe.fragmentShader });
    const w = cols * CELL, h = rows * CELL;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const sc = new THREE.Scene(), ps = new THREE.Points(g, mat); ps.frustumCulled = false; sc.add(ps);
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
    const px = new Float32Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, px); R.setRenderTarget(prev); rt.dispose();
    const mean = [0, 0, 0], L = [];
    for (let i = 0; i < N; i++) {
      const o = ((Math.floor(i / cols) * CELL) * w + (i % cols) * CELL) * 4;
      mean[0] += px[o]; mean[1] += px[o + 1]; mean[2] += px[o + 2];
      L.push(0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]);
    }
    L.sort((a, b) => a - b);
    const q = (p) => L[Math.floor(p * (L.length - 1))];
    out.paint = { n: N, mean: mean.map((v) => v / N), target: [u.uSoilAll.value.r, u.uSoilAll.value.g, u.uSoilAll.value.b],
                  p10: q(0.1), p50: q(0.5), p90: q(0.9), zeros: L.filter((v) => v <= 0).length };
    mat.dispose(); probe.dispose(); g.dispose();
  }
  // ---- 4. shared uniforms, programs, draw calls, frame time ----
  {
    const mats = new Set(B.materials); let bad = 0, refs = 0;
    for (const m of mats) for (const k of Object.keys(S.U)) { refs++; if (m.uniforms[k] !== S.U[k]) bad++; }
    out.uniforms = { materials: mats.size, refs, bad, soilInList: mats.has(soil[0].material) };
    out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
    const hide = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && !soil.includes(o)) { hide.push(o); o.visible = false; } });
    B.render(cam); out.layer = { calls: B.info.calls, triangles: B.info.triangles };
    for (const o of hide) o.visible = true;
    out.layer.tris = soil.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0);
    const gl = R.getContext(), one = new Uint8Array(4);
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const set = (v) => { for (const m of soil) m.visible = v; };
    const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
    time(10);
    set(true); const shown = time(FRAMES); set(false); const hidden = time(FRAMES); set(true);
    B.render(cam); const allCalls = B.info.calls, allTris = B.info.triangles;
    out.frame = { shown, hidden, frames: FRAMES, gpu: GPU, W: R.domElement.width, H: R.domElement.height, allCalls, allTris,
                  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  }
  return out;
}, { frames: FRAMES, gpu: gpuMode(), cards: cardsIn });
await browser.close().catch(() => {});

// ---- report ----
if (R0.missing) { console.log("FAIL built arena did not load (window.__built missing)"); for (const e of errors) console.log("   error:", e); process.exit(1); }
const I = R0.inv;
console.log(`     (info) ${ARENA}: soil meshes ${I.soil} (floor ${I.floor}, apron ${I.apron ? 1 : 0}), mesh kinds ${JSON.stringify(I.kinds)}`);
if (!I.floor) { console.log(`FAIL no soil floor in ${ARENA} (recipe has no piece of kind "soil")`); process.exit(1); }
const si = R0.soilInfo, tone = si?.tone;
check(I.apron && I.sameMat && I.matName === "soil", `one soil material on the floor and the apron (${I.soil} meshes, material "${I.matName}")`);
check(!I.hills && I.boulders === 0, `no hills, no scattered boulders on soil (hills: ${I.hillsInfo}; rocks: ${I.rocksInfo})`);
check(!I.uMask && (I.grass?.blades ?? 0) === 0, `no grass blades on soil: soil material carries no uMask (${I.uMask ? "has" : "none"}), grass.js made ${I.grass?.blades ?? 0} blades (${I.grass?.note || ""})`);
check(R0.tex.on === 1 && R0.tex.a === 2048 && R0.tex.n === 2048, `photo loaded: albedo ${R0.tex.a} px, normal ${R0.tex.n} px, uSoilOn ${R0.tex.on}; ${si?.credit}`);
// outline
{
  const o = R0.outline; let worst = 0, n = 0;
  for (let k = 0; k < 360; k++) if (o.mesh[k] != null && o.soil[k] != null) { n++; worst = Math.max(worst, Math.abs(o.mesh[k] - o.soil[k])); }
  check(n === 360 && worst <= 40, `floor outline: soil.js floorEnd vs a ray down on the floor mesh, 360 azimuths, max |diff| ${worst} units (<= 40 = 2 steps)`);
  if (MEAS?.ground_outline) {
    let wm = 0, wa = null, m = 0;
    for (const g of MEAS.ground_outline) {
      const k = ((g.az + 180) % 360 + 360) % 360, mine = o.mesh[k] / 400;
      const d = Math.abs(mine - g.first_water); m++;
      if (d > wm) { wm = d; wa = g.az; }
    }
    check(m === 36 && wm <= 0.1, `floor outline vs MEASURE ground_outline: ${m} azimuths, max |diff| ${wm.toFixed(3)} m at az ${wa} (<= 0.1 m)`);
    const bay = MEAS.ground_outline.filter((g) => g.az >= 40 && g.az <= 140).map((g) => `${g.az}:${(o.land[((g.az + 180) % 360)] / 400).toFixed(2)}`);
    console.log(`     (info) land end (floor + apron) in the bay az 40..140, m: ${bay.join(" ")}`);
  } else skip(`floor outline vs MEASURE ground_outline: ${MEAS_PATH} not found`);
  const le = o.land.filter((v) => v != null).map((v) => v / 400), fe = o.soil.filter((v) => v != null).map((v) => v / 400);
  console.log(`     (info) floor end ${Math.min(...fe).toFixed(2)}..${Math.max(...fe).toFixed(2)} m, land end (with apron) ${Math.min(...le).toFixed(2)}..${Math.max(...le).toFixed(2)} m`);
}
// apron
{
  const f = R0.feet, b = R0.bay, a = si?.apron;
  console.log(`     (info) apron: ${a?.tris} tris, ${a?.cellsKept} cells kept / ${a?.cellsOnFloor} on the floor, ${a?.cards} cards, IN ${a?.in} OUT ${a?.out} units; vertices r ${(b.minR / 400).toFixed(2)}..${(b.maxR / 400).toFixed(2)} m`);
  if (cardsIn.length) {
    check(f.n > 0 && f.onLand === f.n, `every tree-ring card foot stands on land: ${f.onLand}/${f.n} points (${cardsIn.length} MEASURE cards x 9), ${f.onApron} of them on the apron${f.worst ? `, first miss ${JSON.stringify(f.worst)}` : ""}`);
    check(b.apronVerts > 0 && b.apronVertsUncovered === 0, `the bay stays open: ${b.apronVertsUncovered} of ${b.apronVerts} apron vertices at an azimuth no card covers (+-1 deg column)`);
  } else { skip(`card feet on land: ${MEAS_PATH} not found`); skip(`the bay stays open: ${MEAS_PATH} not found`); }
  check(b.maxAbsY === 0, `apron flat at the floor: max |y| ${b.maxAbsY}`);
}
// paint
{
  const p = R0.paint, rel = p.mean.map((v, i) => Math.abs(v / p.target[i] - 1));
  check(Math.max(...rel) <= 0.06, `paint mean = the measured colour (tint): linear mean ${p.mean.map((v) => v.toFixed(4))} vs target ${p.target.map((v) => v.toFixed(4))} (measured all ${JSON.stringify(si?.measured?.all)}), max rel. error ${(Math.max(...rel) * 100).toFixed(1)} % on ${p.n} points (<= 6 %)`);
  const span = p.p90 - p.p10, tgt = tone?.target?.span;
  check(tgt > 0 && Math.abs(span / tgt - 1) <= 0.20, `paint contrast = the measured spread: luma p10..p90 ${p.p10.toFixed(4)}..${p.p90.toFixed(4)} (span ${span.toFixed(4)}) vs measured p10/p90 ${JSON.stringify(si?.measured?.p10)}/${JSON.stringify(si?.measured?.p90)} span ${tgt?.toFixed(4)} (within 20 %); solved contrast ${tone?.contrast?.toFixed(3)}, tint ${tone?.tint?.map((v) => v.toFixed(3))}, photo mean ${tone?.mean?.map((v) => v.toFixed(4))}`);
  check(p.zeros === 0, `no black samples: ${p.zeros}`);
}
const U = R0.uniforms, F = R0.frame, L = R0.layer;
check(U.bad === 0 && U.soilInList, `one shared uniform object: ${U.materials} materials, ${U.bad} not the same reference; soil material listed`);
check(R0.programs.failed === 0, `shader programs compile: ${R0.programs.count}, ${R0.programs.failed} failed`);
check(L.calls <= 2, `soil draw calls ${L.calls} (<= 2), ${L.triangles} triangles drawn, ${L.tris} in the meshes`);
const dt = F.shown - F.hidden;
console.log(`     (info) frame at ${F.W}x${F.H} (${F.gpu}) over ${F.frames} frames: soil shown ${F.shown.toFixed(2)} ms, hidden ${F.hidden.toFixed(2)} ms, delta ${dt.toFixed(2)} ms${Math.abs(dt) < 0.3 ? " (below the 0.3 ms resolution: no cost claimed)" : ""}; whole frame ${F.allCalls} calls, ${F.allTris} triangles; ${F.renderer}`);
check(F.W === 960 && F.H === 720 && F.frames >= 20, `frame time measured at 960x720 over ${F.frames} frames`);
for (const er of errors) console.log("   error:", er);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails);
