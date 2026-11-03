// Numbers check of the BOULDER PILES of the built meft1008 (web/built/boulders.js: recipe kind "rock", wall_03).
// No pictures are looked at: every number is read back from the GPU or from the page's own objects.
//  1. loaded: the module's info, one mesh "builtBoulderPiles" (userData.kind "rocks"), shaders compile, no page errors
//  2. the piles stand where the piece's cards are (source: the recipe, which reads the arena's own triangles) and match
//     the measured placement/width/height (MEASURE.md 2d): A az -65.5 r 24.17 m 2.93x1.72 m, B az 128.1 r 22.98 m
//     3.81x2.15 m; every vertex above the floor and inside the measured radius band
//  2b. STACKED COBBLES (USER 2026-10-30: the real game's boulders are a stacked pile of brown/pink cobbles with dark
//     cracks between the stones; the first build was 4-5 smooth pink blobs): >= 12 / 16 separate stones in piles A / B in
//     >= 3 layers, round (320-triangle icospheres), the dark cracks measured from the render: the share of the pile's
//     pixels that are crack-dark (luma <= 45/255) matches the measured wall_03 dark cluster ([28,23,24], 22 % of the
//     texels) within 12..38 %, and the lit stones reach the measured p90 ([168,128,112]) within 45/255
//  3. baked occlusion: aAO present, crevices darker than tops (mean AO of the lowest quarter < the top quarter)
//  4. colour, from the GPU: the piles' median sRGB vs the piece's measured median [96,64,64] (warm, 0 % green)
//  5. the mirror hand-off (layer.reflection: mesh, geometry, material, piles) the lake module needs
//  6. cost at 960x720: triangles, draw calls, frame time with the piles shown vs hidden
//  7. meft1013 / meft1002: no "rock" piece, so the module is not loaded at all (skipped cleanly)
//   VERIFY_PORT=8090 ARENA=meft1008 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_boulders.mjs
import fs from "node:fs";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const path = new URL(`../web/assets-hd/battle/built/${ARENA}.json`, import.meta.url);
if (!fs.existsSync(path)) { console.log(`SKIP ${ARENA}: no built recipe (${path.pathname})`); process.exit(0); }
const REC = JSON.parse(fs.readFileSync(path, "utf8"));
const ROCK = REC.pieces.filter((p) => p.kind === "rock");
if (!ROCK.length) { console.log(`SKIP ${ARENA} has no "rock" piece: nothing to check (not a pass)`); process.exit(0); }

// MEASURE.md 2d (the original's own cards, sRGB from the disc sheets)
const MEAS = { A: { az: -65.5, r: 24.17, w: 2.93, h: 1.72 }, B: { az: 128.1, r: 22.98, w: 3.81, h: 2.15 },
               radius: [22.90, 24.34], median: [96, 64, 64], p10: [32, 24, 24], p90: [168, 128, 112] };
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

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
  const layer = B.layers.find((l) => l.id === "boulders");
  out.layers = Object.keys(B.info.layers || {});
  out.missing = B.info.missingLayers || null;
  out.info = B.info.boulders || null;
  if (!layer) return out;
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  const mesh = layer.meshes.find((m) => m.name === "builtBoulderPiles") || layer.meshes[0];
  out.mesh = { name: mesh?.name, kind: mesh?.userData?.kind, count: layer.meshes.length };
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, ao = g.attributes.aAO, tn = g.attributes.aTint;
  out.attrs = { position: !!pos, normal: !!nor, aAO: !!ao, aTint: !!tn, tris: pos.count / 3, vertices: pos.count };
  // bounds, radius, y, and AO vs height
  const v = new THREE.Vector3();
  let rmin = Infinity, rmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  const rows = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
    ymin = Math.min(ymin, v.y); ymax = Math.max(ymax, v.y);
    rows.push([v.y, ao ? ao.array[i] : 1, tn ? tn.array[i] : 0.5]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const n4 = Math.max(1, Math.floor(rows.length / 4));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  out.bounds = { rmin: rmin / 400, rmax: rmax / 400, ymin: ymin / 400, ymax: ymax / 400 };
  out.ao = { min: Math.min(...rows.map((r) => r[1])), max: Math.max(...rows.map((r) => r[1])),
             lowMean: mean(rows.slice(0, n4).map((r) => r[1])), topMean: mean(rows.slice(-n4).map((r) => r[1])),
             tintMin: Math.min(...rows.map((r) => r[2])), tintMax: Math.max(...rows.map((r) => r[2])) };
  // per-pile bounds (the two piles are far apart: split by azimuth sign around the +x axis is not safe, so by distance
  // to each pile's own card centre)
  out.piles = (layer.reflection?.piles || layer.info?.piles || []).map((p) => ({ ...p }));
  // per pile: how far its own vertices stand from its card centre (a pile has depth; the card is flat)
  out.pileDepth = out.piles.map((p) => {
    const c = [p.x, p.z]; let drMax = 0, dsMax = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const dp = Math.hypot(v.x - p.x, v.z - p.z);
      // split the vertices between the two piles by their own distance to the centres, so each pile is measured alone
      if (out.piles.some((o) => o !== p && Math.hypot(v.x - o.x, v.z - o.z) < dp)) continue;
      const rv = Math.hypot(v.x, v.z) / 400 - p.r; drMax = Math.max(drMax, Math.abs(rv));
      const sd = Math.abs((v.x - p.x) * -(p.z / (p.r * 400)) + (v.z - p.z) * (p.x / (p.r * 400)));
      dsMax = Math.max(dsMax, sd / 400);
    }
    return { az: p.az, r: p.r, w: p.w, drMax, dsMax };
  });
  out.reflection = !!(layer.reflection && layer.reflection.mesh && layer.reflection.geometry && layer.reflection.material && Array.isArray(layer.reflection.piles));
  out.reflectSame = !!(layer.reflection && layer.reflection.geometry === g && layer.reflection.material === mesh.material);

  // ---- render the piles alone (magenta clear, sRGB target, aerial haze off for the raw stone) ----
  const hidden = [];
  B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && o !== mesh) { hidden.push(o); o.visible = false; } });
  const world = mesh.parent.parent; const ws = world.scale.x; world.scale.setScalar(1); world.updateMatrixWorld(true);
  const read = (cam, W, H) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = R.getRenderTarget(); R.setRenderTarget(rt);
    R.setClearColor(0xff00ff, 1); R.clear(); R.render(B.scene, cam);
    const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    R.setRenderTarget(prev); rt.dispose(); return px;
  };
  const isBg = (px, i) => px[i] > 250 && px[i + 1] < 5 && px[i + 2] > 250;
  const M = 400;
  // from the arena centre, looking at each pile: how big is it on screen, and what colour?
  out.shots = [];
  for (const p of out.piles) {
    const a = p.az * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
    cam.position.set(Math.sin(a) * p.r * 0.55 * M, 1.4 * M, Math.cos(a) * p.r * 0.55 * M);
    cam.lookAt(Math.sin(a) * p.r * M, p.h * 0.45 * M, Math.cos(a) * p.r * M); cam.updateMatrixWorld();
    const px = read(cam, 240, 180);
    let n = 0; const cols = []; let warm = 0;
    for (let i = 0; i < px.length; i += 4) if (!isBg(px, i)) { n++; cols.push([px[i], px[i + 1], px[i + 2]]); if (px[i] >= px[i + 1]) warm++; }
    const med = [0, 1, 2].map((c) => { const s = cols.map((x) => x[c]).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; });
    out.shots.push({ az: p.az, share: n / (240 * 180), median: med, warmShare: n ? warm / n : 0 });
  }
  // aerial haze off: the stone's own colours (the graded shot above keeps the arena's haze)
  const ak = S.U.uAerialK.value; S.U.uAerialK.value = 0; const rawShots = [], rawDetail = [];
  for (const p of out.piles) {
    const a = p.az * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(45, 4 / 3, 10, 60000);
    cam.position.set(Math.sin(a) * p.r * 0.55 * M, 1.4 * M, Math.cos(a) * p.r * 0.55 * M);
    cam.lookAt(Math.sin(a) * p.r * M, p.h * 0.45 * M, Math.cos(a) * p.r * M); cam.updateMatrixWorld();
    const px = read(cam, 240, 180); const cols = [];
    for (let i = 0; i < px.length; i += 4) if (!isBg(px, i)) cols.push([px[i], px[i + 1], px[i + 2]]);
    rawShots.push([0, 1, 2].map((c) => { const s = cols.map((x) => x[c]).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; }));
    const lum = cols.map((x) => 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]);
    const dark = lum.filter((v) => v <= 45).length / Math.max(1, lum.length);
    const p90 = [0, 1, 2].map((c) => { const s = cols.map((x) => x[c]).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.9)] : null; });
    rawDetail.push({ dark, p90, n: cols.length });
  }
  S.U.uAerialK.value = ak; out.rawMedian = rawShots; out.rawDetail = rawDetail;
  for (const o of hidden) o.visible = true;
  world.scale.setScalar(ws); world.updateMatrixWorld(true);

  // ---- cost at 960x720 with the viewer's own camera ----
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const camInfo = window.__r.getCameraInfo().render;
  const gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(20);
  B.render(camInfo); const all = { calls: B.info.calls, tris: B.info.triangles };
  mesh.visible = false; B.render(camInfo); const without = { calls: B.info.calls, tris: B.info.triangles }; mesh.visible = true;
  const shown = time(600); mesh.visible = false; const hid = time(600); mesh.visible = true;
  cv.width = keepW; cv.height = keepH;
  out.cost = { calls: all.calls - without.calls, trisDrawn: all.tris - without.tris, shownMs: shown, hiddenMs: hid,
               frameCalls: all.calls, frameTris: all.tris };
  return out;
});

check(errors.length === 0, `no page/shader errors (${errors.length})${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
check(!!res.info, `boulders layer loaded (info.boulders, layers ${JSON.stringify(res.layers)})`);
if (!res.info) { console.log(`\n${fails} FAIL`); await browser.close(); process.exit(1); }
check(!res.missing, `no missing layers (${JSON.stringify(res.missing)})`);
check(res.mesh.count === 1 && res.mesh.name === "builtBoulderPiles" && res.mesh.kind === "rocks",
  `one mesh "${res.mesh.name}", userData.kind ${res.mesh.kind}, ${res.mesh.count} mesh(es) in the layer`);
check(res.programs.failed === 0, `shader programs compile (${res.programs.count}, failed ${res.programs.failed})`);
check(res.attrs.position && res.attrs.normal && res.attrs.aAO && res.attrs.aTint,
  `geometry carries position, normal, aAO (baked occlusion) and aTint: ${JSON.stringify(res.attrs)}`);

// 2. placement vs the recipe's cards and the measured placement
const cards = ROCK.flatMap((p) => (p.cards || []).filter((c) => c.base[1] >= -1));
const M400 = 400;
const cardInfo = cards.map((c) => ({ az: Math.atan2(c.base[0], c.base[2]) * 180 / Math.PI, r: Math.hypot(c.base[0], c.base[2]) / M400, w: c.w / M400, h: c.h / M400 }))
  .sort((a, b) => a.az - b.az);
const ours = [...res.info.piles].sort((a, b) => a.az - b.az);
check(ours.length === 2 && cardInfo.length === 2, `two piles built (${ours.length}) for the piece's 2 cards (${cardInfo.length})`);
const keyOf = (p) => (Math.abs(p.az - MEAS.A.az) < Math.abs(p.az - MEAS.B.az) ? "A" : "B");
let worstPos = 0, worstSize = 0;
for (const p of ours) {
  const k = keyOf(p), m = MEAS[k];
  worstPos = Math.max(worstPos, Math.abs(p.az - m.az), Math.abs(p.r - m.r) * 10);   // 0.1 m per deg-tolerance unit
  worstSize = Math.max(worstSize, Math.abs(p.w - m.w), Math.abs(p.h - m.h));
  console.log(`     pile ${k}: az ${p.az.toFixed(2)} (measured ${m.az}), r ${p.r.toFixed(2)} m (${m.r}), ` +
              `${p.w.toFixed(2)} x ${p.h.toFixed(2)} m (measured ${m.w} x ${m.h}), ${p.lumps} lumps, ${p.tris} tris`);
}
check(worstPos <= 0.5, `piles stand at the measured azimuth/radius: worst |diff| ${worstPos.toFixed(2)} (az <= 0.5 deg, r x10 <= 0.5 = 0.05 m)`);
check(worstSize <= 0.15, `pile silhouettes match the measured card width/height: worst |diff| ${worstSize.toFixed(2)} m (<= 0.15)`);
check(res.bounds.ymin >= -0.02 && res.bounds.ymax <= 2.40,
  `all vertices above the floor and under the card tops: y ${res.bounds.ymin.toFixed(3)}..${res.bounds.ymax.toFixed(2)} m (measured cards 0..2.15)`);
for (const d of res.pileDepth) console.log(`     pile ${keyOf(d)} depth: vertices within ${d.drMax.toFixed(2)} m of its card radius ${d.r} m radially, ${d.dsMax.toFixed(2)} m sideways (card ${d.w} m wide)`);
check(res.pileDepth.every((d) => d.drMax <= 0.55 * d.w && d.dsMax <= 0.55 * d.w),
  `each pile is a lump of the card's own size, centred on its card (radial and sideways half-extent <= 0.55 x its width ${MEAS.radius.join("/")}); worst radial ${Math.max(...res.pileDepth.map((d) => d.drMax)).toFixed(2)} m, sideways ${Math.max(...res.pileDepth.map((d) => d.dsMax)).toFixed(2)} m; absolute r ${res.bounds.rmin.toFixed(2)}..${res.bounds.rmax.toFixed(2)} m`);

// 3. baked AO
check(res.ao.min <= 0.70 && res.ao.topMean > res.ao.lowMean + 0.10,
  `baked occlusion: aAO ${res.ao.min.toFixed(2)}..${res.ao.max.toFixed(2)}; mean on the lowest quarter ${res.ao.lowMean.toFixed(2)} < the top quarter ${res.ao.topMean.toFixed(2)} (> 0.10 darker at the foot), aTint ${res.ao.tintMin.toFixed(2)}..${res.ao.tintMax.toFixed(2)}`);

// 4. colour from the GPU (warm red-brown, 0 % green in the measured piece)
for (const [i, s] of res.shots.entries()) {
  const raw = res.rawMedian[i];
  const err = raw.every((v) => v != null) ? Math.max(...raw.map((v, k) => Math.abs(v - MEAS.median[k]))) : null;
  console.log(`     pile ${keyOf(res.info.piles[i])}: ${(s.share * 100).toFixed(1)} % of a 240x180 frame, median sRGB ${JSON.stringify(s.median)}, with the haze off ${JSON.stringify(raw)} vs measured ${JSON.stringify(MEAS.median)} (${err}/255)`);
  check(err != null && err <= 40, `pile ${keyOf(res.info.piles[i])} colour: median ${JSON.stringify(raw)} vs measured ${JSON.stringify(MEAS.median)} (${err}/255 off, <= 40: the toon light bands it)`);
  check(s.warmShare >= 0.85, `pile ${keyOf(res.info.piles[i])} reads warm (r >= g): ${(s.warmShare * 100).toFixed(0)} % of its pixels (measured 0 % green)`);
}

// 4b. stacked cobbles with dark cracks
{
  const piles = [...res.info.piles].sort((a, b) => a.az - b.az);
  const stones = piles.map((p) => p.lumps - 1);   // minus the dark core
  const need = piles.map((p) => (keyOf(p) === "A" ? 12 : 16));
  check(stones.every((n, k) => n >= need[k]), `separate cobbles: ${piles.map((p, k) => `pile ${keyOf(p)} ${stones[k]} stones (>= ${need[k]})`).join(", ")}; ${res.info.lumpTris} triangles per round cobble`);
  for (const [i, d] of res.rawDetail.entries()) {
    console.log(`     pile ${keyOf(res.info.piles[i])}: crack-dark share ${(d.dark * 100).toFixed(0)} % of its ${d.n} pixels, 90th percentile ${JSON.stringify(d.p90)} (measured dark cluster 22 %, p90 [168,128,112])`);
    check(d.dark >= 0.12 && d.dark <= 0.38, `pile ${keyOf(res.info.piles[i])} has dark cracks between the stones: ${(d.dark * 100).toFixed(0)} % of its pixels are crack-dark (luma <= 45); measured 22 % -> 12..38 %`);
    check(d.p90[0] != null && Math.abs(d.p90[0] - 168) <= 45 && d.p90[0] > d.p90[1] && d.p90[1] > d.p90[2], `pile ${keyOf(res.info.piles[i])} lit stones reach the measured p90: R ${d.p90[0]} vs 168 (+-45), warm order R > G > B (${JSON.stringify(d.p90)})`);
  }
}

// 5. mirror hand-off
check(res.reflection && res.reflectSame, `reflection hand-off for the lake: layer.reflection { mesh, geometry, material, piles } with the SAME geometry and material, ${res.reflection ? res.info.piles.length : 0} piles`);

// 6. cost
check(res.cost.calls <= 1, `one draw call for both piles: ${res.cost.calls} call(s), ${res.cost.trisDrawn} triangles drawn (frame total ${res.cost.frameCalls} calls)`);
check(res.attrs.tris >= 3000 && res.attrs.tris <= 30000, `pile triangles ${res.attrs.tris} (3,000..30,000: separate round cobbles, was 408)`);
console.log(`     (info) frame time at 960x720 over 600 frames: piles shown ${res.cost.shownMs.toFixed(2)} ms, hidden ${res.cost.hiddenMs.toFixed(2)} ms (+${(res.cost.shownMs - res.cost.hiddenMs).toFixed(2)} ms)`);

// 7. gating: an arena without a "rock" piece must not load the module
for (const other of ["meft1013", "meft1002"]) {
  await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${other}&look=built`);
  await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
  const o = await page.evaluate(() => ({ b: !!window.__built?.info?.boulders, layers: Object.keys(window.__built?.info?.layers || {}) }));
  check(!o.b && !o.layers.includes("boulders"), `gated: ${other} has no boulders layer (layers ${JSON.stringify(o.layers)})`);
}

console.log(`\n${fails ? fails + " FAIL" : "all PASS"}`);
await browser.close();
process.exit(fails ? 1 : 0);
