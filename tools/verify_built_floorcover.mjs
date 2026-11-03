// Numbers check of the BUILT arena's FOREST-FLOOR COVER (web/built/floorcover.js; recipe kind "soil", meft1008 wall_02).
// No pictures are looked at: every number is read back from the page's own objects or from GPU pixels as counts.
//  1. inventory: the "floorcover" layer, 6 types, instanced, one material each, no failed program, no page error
//  2. colours: every instance colour is one of the 15 MEASURED wall_02 colours (x 0.9..1.1) or the measured green; the
//     litter mix (brown : yellow-orange : green) is within 3 points of the measured shares 48.5 : 6.6 : 10.2
//  3. placement: every instance on land (soilLand), none inside the arena's fight radius (info.keepOut.fightR), the
//     tall plants (ferns) outside every eye -> fighter view cone (the arena's own rejectReason), nothing taller than 0.6 m
//  4. density: instances per m2 of land rise from the clear radius to the land edge (thirds of t), sparse in the middle
//  5. wind: the shared uniforms (same objects as the trees), the layer's pixels change with uWindTime and not with
//     uFcWind = 0, and the shader calls builtWind
//  6. LOD: ferns nearer than 6.5 m of the eye use the detailed geometry, farther ones the cheap one; from 50 m away
//     the vertex-shader fade collapses everything (0 pixels)
//  7. knobs: the tuning panel has a "Floor cover" folder; a density control writes the uniform; the viewer's layer switch
//     hides and shows the meshes
//  8. cost: draw calls, triangles, frame time at 960x720 with the layer shown vs hidden (target <= +0.5 ms)
//  9. gating: meft1013 and meft1002 (after a reload) have no floorcover layer
//   VERIFY_PORT=8090 ARENA=meft1008 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_floorcover.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = Math.max(60, Number(process.env.FRAMES || 400));
const M = 400;
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
await page.waitForTimeout(2500);

const hasLayer = await page.evaluate(() => !!(window.__built?.layers || []).find((l) => l.id === "floorcover"));
if (!hasLayer) {
  console.log(`SKIP ${ARENA} has no floorcover layer: nothing to check (not a pass)`);
  await browser.close();
  process.exit(0);
}

const res = await page.evaluate(async ({ FRAMES, M, ARENA }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const FC = await import("./built/floorcover.js");
  const SOIL = await import("./built/soil.js");
  const B = window.__built, R = B.renderer, out = {};
  const layer = B.layers.find((l) => l.id === "floorcover");
  const rec = await (await fetch(`assets-hd/battle/built/${ARENA}.json`, { cache: "no-store" })).json();
  const land = SOIL.soilLand(rec);
  out.missing = B.info.missingLayers || null;
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  const info = B.info.floorcover; out.info = JSON.parse(JSON.stringify(info));
  const meshes = [...layer.meshes];
  out.meshes = meshes.map((m) => ({ name: m.name, type: m.userData.type, inst: !!m.isInstancedMesh, count: m.count, cap: m.instanceMatrix.count, hasColor: !!m.instanceColor, kind: m.userData.kind }));
  out.matNames = [...new Set(meshes.map((m) => m.material.name))];
  out.sharedWind = meshes.every((m) => m.material.uniforms.uWindDir === S.U.uWindDir && m.material.uniforms.uWindStrength === S.U.uWindStrength && m.material.uniforms.uWindTime === S.U.uWindTime);
  out.vsHasWind = meshes.every((m) => /builtWind\(/.test(m.material.vertexShader));
  out.fadeInShader = meshes.every((m) => /smoothstep\(uFcFar0, uFcFar1/.test(m.material.vertexShader));

  // ---- instances: position, scale, colour, type
  const items = [];   // { type, x, z, y, s, top, rgb }
  const P = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  const api = layer.api;
  const bbTop = (g) => { g.computeBoundingBox(); return g.boundingBox.max.y; };
  const collect = (m, type, n, matAt, colAt) => {
    const top = bbTop(m.geometry);
    for (let i = 0; i < n; i++) {
      matAt(i, P); P.decompose(v, q, sc);
      colAt(i, col); const c = col.clone().convertLinearToSRGB();
      items.push({ type, x: v.x, z: v.z, y: v.y, s: sc.y, top: v.y + top * sc.y, rgb: [c.r * 255, c.g * 255, c.b * 255] });
    }
  };
  for (const m of meshes) {
    const type = m.userData.type;
    if (type === "fern") continue;
    collect(m, type, m.count, (i, o) => m.getMatrixAt(i, o), (i, o) => m.getColorAt(i, o));
  }
  const F = api.ferns;
  if (F) F.items.forEach((it, i) => {
    F.mats[i].decompose(v, q, sc); const c = new THREE.Color().fromArray(F.cols[i]).convertLinearToSRGB();
    items.push({ type: "fern", x: v.x, z: v.z, y: v.y, s: sc.y, top: v.y + sc.y, rgb: [c.r * 255, c.g * 255, c.b * 255] });
  });
  const by = {}; for (const it of items) (by[it.type] ||= []).push(it);
  out.counts = Object.fromEntries(Object.entries(by).map(([k, l]) => [k, l.length]));
  out.total = items.length;

  // ---- 2. colours against the 15 measured ones
  const groups = [["brown", FC.MEAS.brown], ["light", FC.MEAS.light], ["green", FC.MEAS.green], ["neutral", FC.MEAS.neutral]];
  const nearest = (rgb) => {
    let best = null;
    for (const [g, list] of groups) for (const c of list) {
      const k = (rgb[0] / c[0] + rgb[1] / c[1] + rgb[2] / Math.max(c[2], 1)) / 3;   // best uniform scale (loose), then residual
      let kk = 0, den = 0; for (let a = 0; a < 3; a++) { kk += rgb[a] * c[a]; den += c[a] * c[a]; } kk /= den;
      const res = Math.max(...[0, 1, 2].map((a) => Math.abs(rgb[a] - kk * c[a]) / Math.max(rgb[a], 4)));
      const sc = res + 0.05 * Math.abs(kk - 1);   // grey [24,24,24] is also [16,16,16] x 1.5: prefer the colour nearest to scale 1
      if (!best || sc < best.sc) best = { g, c, k: kk, res, sc };
    }
    return best;
  };
  const cls = { litter: { brown: 0, light: 0, green: 0, other: 0 } }; let worstRes = 0, kMin = 9, kMax = 0, bad = 0;
  for (const it of items) {
    const b = nearest(it.rgb); it.group = b.g;
    // ferns/clover/tufts carry k up to 1.25 (their own brightness range), litter 0.92..1.08, others 1.0
    worstRes = Math.max(worstRes, b.res); kMin = Math.min(kMin, b.k); kMax = Math.max(kMax, b.k);
    if (b.res > 0.04 || b.k < 0.85 || b.k > 1.3) { bad++; (out.badSample ||= []).length < 6 && out.badSample.push([it.type, it.rgb.map(Math.round), b.g, b.c.slice(0,3), +b.k.toFixed(2)]); }
    if (it.type === "litter") cls.litter[b.res < 0.06 ? b.g : "other"]++;
  }
  out.colour = { bad, worstRes, kMin, kMax, litter: cls.litter, litterN: by.litter?.length || 0, measShares: FC.MEAS.shares };
  out.plantGreen = ["fern", "clover", "tuft"].map((t) => (by[t] || []).every((it) => it.group === "green"));

  // ---- 3. placement
  const fightR = B.info.keepOut?.fightR ?? null;
  out.fightR = fightR; out.clearUsed = info.clearM * M;
  out.offLand = items.filter((it) => !land.landAt(it.x, it.z)).length;
  const rad = items.map((it) => Math.hypot(it.x, it.z));
  out.minR = Math.min(...rad); out.maxR = Math.max(...rad);
  out.inside = items.filter((it) => Math.hypot(it.x, it.z) < (fightR ?? 0) - 1).length;
  out.maxTopM = Math.max(...items.map((it) => it.top)) / M;
  out.topByType = Object.fromEntries(Object.entries(by).map(([k, l]) => [k, +(Math.max(...l.map((it) => it.top)) / M).toFixed(3)]));
  // ferns vs the arena's own cone test
  let coneHit = 0, fightHit = 0;
  for (const it of by.fern || []) {
    const c = [it.x, it.s * 0.5, it.z], r = it.s * 0.9;
    const why = B.debug.rejectReason([{ c, r, tris: [{ c, r }] }]);
    if (why === "cone") coneHit++; else if (why === "fight") fightHit++;
  }
  out.coneHit = coneHit; out.fightHit = fightHit;
  out.fighters = B.info.keepOut?.fighters || []; out.rings = B.info.keepOut?.rings || [];
  // distance of any instance to a fighter (xz)
  out.nearFighter = Math.min(...items.map((it) => Math.min(...out.fighters.map((f) => Math.hypot(it.x - f.c[0], it.z - f.c[2])), 1e9)));

  // ---- 4. density per land m2 by thirds of t
  const edgeAt = (az) => { const o = land.outline; const k = Math.max(0, Math.min(o.landEnd.length - 1, Math.floor((az - o.az0) / o.stepDeg))); return o.landEnd[k]; };
  const clearR = info.clearM * M, cell = 100, area = [0, 0, 0];
  for (let x = -7000; x <= 7000; x += cell) for (let z = -7000; z <= 7000; z += cell) {
    const r = Math.hypot(x, z); if (r <= clearR || !land.landAt(x, z)) continue;
    const e = edgeAt(Math.atan2(x, z) * 180 / Math.PI); if (!(e - clearR > 200) || r > e - 20) continue;
    const t = (r - clearR) / (e - clearR); area[Math.min(2, Math.floor(t * 3))] += (cell / M) ** 2;
  }
  out.area = area;
  out.dens = {};
  for (const k of Object.keys(by)) {
    const n = [0, 0, 0];
    for (const it of by[k]) {
      const r = Math.hypot(it.x, it.z), e = edgeAt(Math.atan2(it.x, it.z) * 180 / Math.PI); const t = (r - clearR) / (e - clearR);
      n[Math.max(0, Math.min(2, Math.floor(t * 3)))]++;
    }
    out.dens[k] = n.map((c, i) => +(c / Math.max(area[i], 1e-6)).toFixed(3));
  }

  // ---- 5. wind (pixels of the layer alone), 6. LOD fade
  const hidden = [];
  const solo = () => B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && !meshes.includes(o) && o.visible) { hidden.push(o); o.visible = false; } });
  const unsolo = () => { for (const o of hidden) o.visible = true; hidden.length = 0; };
  const camInfo = window.__r.getCameraInfo().render;
  B.render(camInfo);
  const W = 320, H = 240, rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
  const bg = B.scene.background; B.scene.background = null;
  const shoot = () => {
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear(); R.render(B.scene, B.camera);
    const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px); R.setRenderTarget(prev);
    return px;
  };
  const nz = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 0) n++; return n; };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++; return n; };
  solo();
  const w0 = S.U.uWindTime.value, ws = S.U.uWindStrength.value;
  S.U.uWindTime.value = 0.4; const a = shoot(); S.U.uWindTime.value = 2.1; const b = shoot();
  layer.uniforms.uFcWind.value = 0; const c0 = shoot(); S.U.uWindTime.value = 0.4; const c1 = shoot();
  layer.uniforms.uFcWind.value = 3.0;
  out.wind = { litPixels: nz(a), diffWind: diff(a, b), diffNoWind: diff(c0, c1), strength: ws };
  // far away: an eye 50 m out beyond the ring, same look
  const far = { ...camInfo, eye: [0, 400, -50 * M * 1], look: [0, 0, 0] };
  B.render(far); out.fadeFar = { litPixels: nz(shoot()) };
  B.render(camInfo); out.fadeNear = { litPixels: nz(shoot()) };
  unsolo(); B.scene.background = bg; S.U.uWindTime.value = w0; rt.dispose();

  // ---- LOD of ferns against the eye the layer saw last
  B.render(camInfo);
  const eye = api.lastEye, nm = F.near.count, fm = F.far.count;
  let nearBad = 0, farBad = 0, dn = [], df = [];
  for (let i = 0; i < nm; i++) { F.near.getMatrixAt(i, P); const d = Math.hypot(P.elements[12] - eye.x, P.elements[14] - eye.z) / M; dn.push(d); if (d >= 6.5) nearBad++; }
  for (let i = 0; i < fm; i++) { F.far.getMatrixAt(i, P); const d = Math.hypot(P.elements[12] - eye.x, P.elements[14] - eye.z) / M; df.push(d); if (d < 6.5) farBad++; }
  out.lod = { near: nm, far: fm, total: F.items.length, nearBad, farBad, nearMax: Math.max(0, ...dn), farMin: Math.min(...df, 99),
              trisNear: F.near.geometry.userData.tris, trisFar: F.far.geometry.userData.tris, eye: [eye.x / M, eye.z / M] };
  // an eye INSIDE the ferns: some must go near
  B.render({ ...camInfo, eye: [F.items[0].x + 200, 100, F.items[0].z + 200], look: [F.items[0].x, 0, F.items[0].z] });
  out.lod.nearAtFern = F.near.count;
  B.render(camInfo);

  // ---- 7. knobs and the layer switch
  await window.__tools.ready().catch(() => {});
  const tuner = window.__tools.tuner;
  if (tuner) {
    tuner.build();
    const ents = tuner.entries.filter((e) => e.folder === "Floor cover");
    out.knobs = ents.map((e) => e.name).sort();
    const e = ents.find((x) => x.name === "uFcDensLitter");
    if (e) { const was = layer.types.litter.mat.uniforms.uFcDensLitter.value; tuner.set(e.id, 0.5); out.knobSet = layer.types.litter.mat.uniforms.uFcDensLitter.value; tuner.set(e.id, was); out.knobBack = layer.types.litter.mat.uniforms.uFcDensLitter.value; }
    const w = ents.find((x) => x.name === "uFcWind");
    out.knobWindShared = !!w && w.targets.length === 1;
  } else out.knobs = null;
  window.__layers.set("floorcover", false); out.switchOff = meshes.every((m) => !m.visible);
  window.__layers.set("floorcover", true); out.switchOn = layer.meshes.every((m) => m.visible);
  out.row = !!document.querySelector('input[data-layer="floorcover"]');

  // ---- rebuild idempotent: same state again does not rebuild
  const builds = info.builds; layer.place(B.debug.ko ? { fightR: B.debug.ko.fightR, farthest: B.debug.ko.farthest, rings: B.debug.ko.rings, fighters: B.debug.ko.fighters } : null);
  out.rebuilds = { before: builds, after: B.info.floorcover.builds, buildMs: B.info.floorcover.buildMs };

  // ---- 8. cost at 960x720
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const s = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - s) / n; };
  time(30);
  B.render(camInfo); const a1 = { calls: B.info.calls, tris: B.info.triangles };
  layer.setVisible(false); B.render(camInfo); const a2 = { calls: B.info.calls, tris: B.info.triangles }; layer.setVisible(true);
  const blocks = []; for (let k = 0; k < 6; k++) { layer.setVisible(true); const s = time(Math.ceil(FRAMES / 6)); layer.setVisible(false); const h = time(Math.ceil(FRAMES / 6)); blocks.push([s, h]); }
  layer.setVisible(true); cv.width = keepW; cv.height = keepH;
  const med = (arr) => arr.sort((x, y) => x - y)[arr.length >> 1];
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  out.cost = { shownMs: med(blocks.map((b) => b[0])), hiddenMs: med(blocks.map((b) => b[1])), deltaMs: med(blocks.map((b) => b[0] - b[1])),
               calls: a1.calls - a2.calls, trisDrawn: a1.tris - a2.tris, frameCalls: a1.calls, frameTris: a1.tris, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?" };
  return out;
}, { FRAMES, M, ARENA });

const r = res;
// ---- 1 ----
check(!r.missing, `no missing layers ${JSON.stringify(r.missing)}; failed shader programs ${r.programs.failed} of ${r.programs.count}`);
const types = ["fern", "clover", "tuft", "litter", "twig", "pebble"];
check(types.every((t) => (r.counts[t] || 0) > 0), `all 6 types placed: ${JSON.stringify(r.counts)} (total ${r.total})`);
check(r.meshes.every((m) => m.inst && m.hasColor && m.kind === "floorcover"), `${r.meshes.length} InstancedMeshes, each with instance colour, userData.kind floorcover; materials ${r.matNames.join(", ")}`);
check(r.matNames.length === 6, `one material per type: ${r.matNames.length}`);
// ---- 2 ----
if (r.badSample) console.log('bad sample', JSON.stringify(r.badSample));
check(r.colour.bad === 0, `every instance colour is a measured wall_02 colour x ${r.colour.kMin.toFixed(2)}..${r.colour.kMax.toFixed(2)} (worst residual ${(r.colour.worstRes * 100).toFixed(1)} %), ${r.colour.bad} off`);
const L = r.colour.litter, Ln = r.colour.litterN, tot = r.colour.measShares.brown + r.colour.measShares.light + r.colour.measShares.green;
const sh = (k) => L[k] / Ln * 100, ms = (k) => r.colour.measShares[k] / tot * 100;
check(["brown", "light", "green"].every((k) => Math.abs(sh(k) - ms(k)) <= 3), `litter mix brown/yellow-orange/green ${sh("brown").toFixed(1)}/${sh("light").toFixed(1)}/${sh("green").toFixed(1)} % vs measured ${ms("brown").toFixed(1)}/${ms("light").toFixed(1)}/${ms("green").toFixed(1)} % (other ${L.other})`);
check(r.plantGreen.every(Boolean), `ferns, clover and tufts all use the measured green [32,40,24]: ${r.plantGreen}`);
// ---- 3 ----
check(r.offLand === 0, `every instance on land (soilLand.landAt): ${r.offLand} off`);
check(r.fightR != null && r.inside === 0 && r.minR >= r.fightR - 1, `none inside the fight radius: fightR ${r.fightR} (${(r.fightR / M).toFixed(2)} m), nearest instance ${(r.minR / M).toFixed(2)} m, ${r.inside} inside; layer used ${(r.clearUsed / M).toFixed(2)} m`);
check(r.coneHit === 0 && r.fightHit === 0, `ferns outside every eye -> fighter view cone and the fight radius (the arena's rejectReason): cone ${r.coneHit}, fight ${r.fightHit} of ${r.counts.fern}; ${r.fighters.length} fighters, ${r.rings.length} eye rings`);
check(r.maxTopM <= 0.6, `nothing taller than 0.6 m: tallest ${r.maxTopM.toFixed(2)} m ${JSON.stringify(r.topByType)}`);
// ---- 4 ----
const risingOf = (k) => r.dens[k][0] < r.dens[k][1] && r.dens[k][1] < r.dens[k][2];
check(["litter", "fern", "twig"].every(risingOf), `density per m2 rises inner < middle < outer third: ${["litter", "fern", "twig"].map((k) => k + " " + r.dens[k].join("/")).join("; ")}`);
check(types.every((k) => r.dens[k][2] > r.dens[k][0]), `every type denser at the tree ring than near the clear radius: ${types.map((k) => k + " " + r.dens[k].join("/")).join("; ")} (land m2 per third ${r.area.map((v) => v.toFixed(0)).join("/")})`);
// ---- 5 ----
check(r.sharedWind && r.vsHasWind, `wind: the materials hold the SAME wind uniform objects as the trees and the vertex shader calls builtWind (strength ${r.wind.strength})`);
check(r.wind.litPixels > 200 && r.wind.diffWind > 0 && r.wind.diffNoWind === 0, `wind moves the layer: ${r.wind.litPixels} lit px at 320x240, ${r.wind.diffWind} px change between wind times, ${r.wind.diffNoWind} with uFcWind = 0`);
// ---- 6 ----
check(r.lod.nearBad === 0 && r.lod.farBad === 0 && r.lod.near + r.lod.far === r.lod.total && r.lod.trisFar < r.lod.trisNear, `fern LOD: ${r.lod.near} near (max ${r.lod.nearMax.toFixed(1)} m) + ${r.lod.far} far (min ${r.lod.farMin.toFixed(1)} m) = ${r.lod.total}; tris ${r.lod.trisNear} near vs ${r.lod.trisFar} far; eye ${r.lod.eye.map((v) => v.toFixed(1))}`);
check(r.lod.nearAtFern >= 1, `an eye next to a fern turns it detailed: ${r.lod.nearAtFern} near`);
check(r.fadeFar.litPixels === 0 && r.fadeNear.litPixels > 200 && r.fadeInShader, `distance fade: ${r.fadeNear.litPixels} lit px from the viewer's eye, ${r.fadeFar.litPixels} from 50 m out`);
// ---- 7 ----
if (r.knobs) {
  check(["uFcWind", "uFcGain", "uFcDensLitter", "uFcDensFern", "uFcFar0", "uFcRootK", "uFcTipK"].every((n) => r.knobs.includes(n)) && r.knobWindShared, `tuning panel "Floor cover": ${r.knobs.join(", ")}`);
  check(r.knobSet === 0.5 && r.knobBack === 1, `a density control writes the uniform: ${r.knobSet}, restored ${r.knobBack}`);
} else console.log("SKIP tuning panel not available in this page (not a pass)");
check(r.switchOff && r.switchOn && r.row, `the viewer's layer switch hides and shows the meshes (row present ${r.row})`);
check(r.rebuilds.after === r.rebuilds.before, `place() with an unchanged fight state does not rebuild (${r.rebuilds.before} -> ${r.rebuilds.after}); last build ${r.rebuilds.buildMs} ms`);
// ---- 8 ----
check(r.cost.calls >= 6 && r.cost.calls <= 40, `draw calls of the layer in the viewer's frame: ${r.cost.calls} (frame total ${r.cost.frameCalls})`);
check(r.cost.trisDrawn > 20000 && r.cost.trisDrawn < 400000, `triangles drawn by the layer: ${r.cost.trisDrawn} (frame total ${r.cost.frameTris})`);
check(r.cost.deltaMs <= 0.5, `frame time at 960x720 (median of 6 blocks): shown ${r.cost.shownMs.toFixed(2)} ms, hidden ${r.cost.hiddenMs.toFixed(2)} ms, delta +${r.cost.deltaMs.toFixed(2)} ms (<= 0.5) on ${r.cost.renderer}`);

// ---- 9. gating ----
for (const other of ["meft1013", "meft1002"]) {
  await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${other}&look=built`);
  await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
  const gate = await page.evaluate(() => ({ fc: !!window.__built?.info?.floorcover, layers: Object.keys(window.__built?.info?.layers || {}), anyFc: (() => { let n = 0; window.__built?.scene.traverse((o) => { if (o.userData?.kind === "floorcover") n++; }); return n; })() }));
  check(!gate.fc && gate.anyFc === 0, `gated: ${other} has no floorcover layer or mesh (layers ${JSON.stringify(gate.layers)})`);
}
check(errors.length === 0, `page errors: ${errors.length}${errors.length ? " -> " + errors.slice(0, 3).join(" | ") : ""}`);
console.log(`\nfloorcover ${ARENA}: ${passes} PASS / ${fails} FAIL; build ${r.info.buildMs} ms, ${r.info.instances} instances, clear ${r.info.clearM} m`);
await browser.close();
process.exit(fails ? 1 : 0);
