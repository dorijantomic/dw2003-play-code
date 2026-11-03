// Numbers check of the BUILT arena's LAKE as the user sees it (build-water3, 2026-10-30). No pictures: every number is
// read from pixel buffers of offscreen renders (checker-side, never looked at) and from the page's own geometry.
//   banding     the water alone (reflection off): row-to-row luma steps, the residual after a moving median, and the
//               strongest periodic peak (autocorrelation) of the row means -> no stripes
//   ribbon      the rows between the water and the far bank: nothing darker than the water by more than a bound
//   shore       the longest straight run (m) of the land's edge in the bay, from soilLand().landAt at 0.1 deg x 5 units
//   reflection  at the DEFAULT camera (the viewer's own) and the bay cameras (eye 10 m out, 1.7 m up): the share of
//               water pixels that carry reflection (frame with vs without it) and the correlation of the reflected
//               rows with the upright far shore's rows (trees / bank / sky)
//   cost        reflection pass on vs off, interleaved blocks, 960x720; triangles/draw calls with the pass counted
//   VERIFY_PORT=8090 ARENA=meft1008 [INVESTIGATE=1] [FRAMES=96] tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_lake.mjs
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = Math.max(24, Number(process.env.FRAMES || 96));
const INVESTIGATE = !!process.env.INVESTIGATE;
const BAY = [90, 110, 120];
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 1500)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);
// the water's normal-map files load asynchronously: wait for the module's own flag when it has one
await page.waitForFunction(() => { const w = window.__built?.layers?.find((l) => l.id === "water"); return !w?.lake || w.lake.ready(); }, null, { timeout: 30000 }).catch(() => {});
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const R = await page.evaluate(async ({ frames: FRAMES, bay: BAY, gpu: GPU, inv: INV }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const SO = await import("./built/soil.js");
  const B = window.__built, rr = window.__r, Rn = B.renderer, M = S.UNITS_PER_M;
  if (!B) return { missing: true };
  rr.render(0); const cam0 = rr.getCameraInfo().render; B.render(cam0);
  const out = {};
  const find = (f) => { const l = []; B.scene.traverse((o) => { if (o.isMesh && f(o)) l.push(o); }); return l; };
  const newLake = find((o) => o.name === "sea_surface")[0] || null;
  const oldLake = find((o) => o.userData?.part === "surface")[0] || null;
  const water = newLake || oldLake;
  if (!water) return { noLake: true };
  out.kind = newLake ? "water.js lake" : "mirror.js lake";
  const copies = find((o) => o.userData?.kind === "mirror" && o.userData.part !== "surface" && o.userData.part !== "bank");
  const bankMeshes = find((o) => o.userData?.kind === "mirror" && (o.userData.part === "bank" || o.userData.part === "bank-reflection"));
  const U = newLake ? newLake.material.uniforms : null;
  const WL = B.layers?.find((l) => l.id === "water")?.lake || null;
  const reflOff = () => { if (U?.uReflOn) U.uReflOn.value = 0; if (WL) WL.reflection.enabled = false; for (const m of copies) m.visible = false; };
  const reflOn = () => { if (U?.uReflOn) U.uReflOn.value = 1; if (WL) WL.reflection.enabled = true; for (const m of copies) m.visible = true; };
  const W = 640, H = 480;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace });
  const buf = new Uint8Array(W * H * 4);
  const shoot = (cam) => { const prev = Rn.getRenderTarget(); Rn.setRenderTarget(rt); Rn.setClearColor(0x000000, 1); Rn.clear(); Rn.render(B.scene, cam); Rn.readRenderTargetPixels(rt, 0, 0, W, H, buf); Rn.setRenderTarget(prev); return Uint8Array.from(buf); };
  const red = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: false, depthWrite: true });
  const redLake = newLake ? (() => { const m = newLake.material.clone(); m.uniforms = newLake.material.uniforms; m.fragmentShader = newLake.material.fragmentShader.replace("gl_FragColor = vec4(col, cover);", "gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);").replace("#include <colorspace_fragment>", ""); m.transparent = false; m.needsUpdate = true; return m; })() : null;   // the real water shader (its shore cut-out kept), painted red
  const maskOf = (mesh, cam) => { const m0 = mesh.material; mesh.material = (mesh === newLake && redLake) ? redLake : red; const hid = copies.concat(bankMeshes.filter((b) => b.userData.part === "bank-reflection")); const vis = hid.map((m) => m.visible); hid.forEach((m) => { m.visible = false; }); const im = shoot(cam); hid.forEach((m, i) => { m.visible = vis[i]; }); mesh.material = m0; const sel = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (im[i * 4] > 250 && im[i * 4 + 1] < 4 && im[i * 4 + 2] < 4) sel[i] = 1; return sel; };
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Y = (img, x, yTop) => { const o = ((H - 1 - yTop) * W + x) * 4; return lum(img[o], img[o + 1], img[o + 2]); };   // screen row yTop (0 = top)
  // inward = the fight camera's own sense (10 m out, 1.7 m up, looking at the arena centre); outward = from the same eye
  // across the lake to the far bank (the view where the far shore, the bank and the reflections are the picture)
  const camAt = (az, out = false, h = 1.7, d = 10) => { const a = az * Math.PI / 180; const c = new THREE.PerspectiveCamera(45, W / H, 1, B.camera.far); c.position.set(Math.sin(a) * d * M, h * M, Math.cos(a) * d * M); if (out) c.lookAt(Math.sin(a) * 40 * M, h * M, Math.cos(a) * 40 * M); else c.lookAt(0, 0.4 * M, 0); c.updateMatrixWorld(); return c; };
  // the viewer's own idle camera: t 0 is inside the arena (eye 1 m up near the centre), t 6 and t 12 are on the 10 m ring
  const defCamAt = (t) => { rr.render(t); const c = rr.getCameraInfo().render; B.render(c); const k = B.camera.clone(); k.aspect = W / H; k.updateProjectionMatrix(); k.updateMatrixWorld(); return k; };
  const views = [["def6", defCamAt(6)], ["def12", defCamAt(12)], ...BAY.map((a) => ["in" + a, camAt(a)]), ...BAY.map((a) => ["out" + a, camAt(a, true)])];
  rr.render(0); B.render(cam0);
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

  // ---- per view: banding (reflection off), reflection share/correlation, ribbon profile
  out.views = [];
  for (const [name, cam] of views) {
    const sel = maskOf(water, cam);
    reflOff(); const off = shoot(cam); reflOn(); const on = shoot(cam);
    const rowsOf = (img) => { const rows = []; for (let y = 0; y < H; y++) { let n = 0, s = 0; for (let x = 0; x < W; x++) { if (!sel[(H - 1 - y) * W + x]) continue; n++; s += Y(img, x, y); } if (n >= 0.85 * W) rows.push({ y, m: s / n, n }); } return rows.slice(8); };
    const rOff = rowsOf(off), rOn = rowsOf(on);
    const bandOf = (rows) => {
      if (rows.length < 30) return null;
      const m = rows.map((r) => r.m), steps = m.slice(1).map((v, i) => Math.abs(v - m[i]));
      const half = 7, res = m.map((v, i) => { const w = m.slice(Math.max(0, i - half), i + half + 1); return v - med(w); });
      const rmax = Math.max(...res.map(Math.abs));
      // periodic peak: autocorrelation of the residual, lags 3..40 rows, normalised by lag 0
      const mu = res.reduce((a, b) => a + b, 0) / res.length, z = res.map((v) => v - mu), v0 = z.reduce((a, b) => a + b * b, 0) || 1e-9;
      let acPeak = 0, acLag = 0; for (let lag = 3; lag <= Math.min(40, z.length >> 1); lag++) { let s = 0; for (let i = lag; i < z.length; i++) s += z[i] * z[i - lag]; const c = s / v0 * (z.length / (z.length - lag)); if (c > acPeak) { acPeak = c; acLag = lag; } }
      return { rows: rows.length, maxStep: Math.max(...steps), p95Step: [...steps].sort((a, b) => a - b)[Math.floor(steps.length * 0.95)], maxResid: rmax, rmsResid: Math.sqrt(v0 / z.length), acPeak, acLag, farL: m[0], nearL: m[m.length - 1] };
    };
    // water top row per column (first water pixel with 10 water pixels below it)
    const yw = new Array(W).fill(-1);
    for (let x = 0; x < W; x++) for (let y = 0; y < H - 12; y++) { let ok = true; for (let k = 0; k < 10; k++) if (!sel[(H - 1 - (y + k)) * W + x]) { ok = false; break; } if (ok) { yw[x] = y; break; } }
    const xs = []; for (let x = Math.floor(W * 0.1); x < W * 0.9; x++) if (yw[x] > 30 && yw[x] < H - 40) xs.push(x);
    const ywMed = med(xs.map((x) => yw[x]));
    // aligned profile around the water's far edge, final frame (reflection on)
    const prof = [];
    for (let o = -10; o <= 40; o += 1) { let s = 0, n = 0; for (const x of xs) { const y = yw[x] + o; if (y >= 0 && y < H) { s += Y(on, x, y); n++; } } prof.push([o, n ? +(s / n).toFixed(1) : null]); }
    // reflection: share of water pixels that differ with vs without it, and the correlation with the upright rows
    let nW = 0, nDiff = 0, nWup = 0, nDiffUp = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!sel[(H - 1 - y) * W + x]) continue; const o = ((H - 1 - y) * W + x) * 4; const d = Math.abs(on[o] - off[o]) + Math.abs(on[o + 1] - off[o + 1]) + Math.abs(on[o + 2] - off[o + 2]); nW++; if (d > 12) nDiff++; if (y < ywMed + (H - ywMed) * 0.5) { nWup++; if (d > 12) nDiffUp++; } }
    const hB = 28; const u = [], w = [], wOff = [];
    // mirror image test: for k = 3..hB, the water pixel k rows under the far edge against the upright pixel k rows over it, row means removed
    const mk = (img, shift = 0) => { const A = [], Bv = []; for (let k = 3; k <= hB; k++) { const ra = [], rb = []; for (const x of xs) { const yb = yw[x] + k, ya = yw[x] - k; if (ya < 0 || yb >= H || !sel[(H - 1 - yb) * W + x]) continue; const xb = Math.min(W - 1, Math.max(0, x + shift)); if (!sel[(H - 1 - yb) * W + xb]) continue; ra.push(Y(off, x, ya)); rb.push(Y(img, xb, yb) - Y(off, xb, yb)); } if (ra.length < 20) continue; const ma = ra.reduce((p, q) => p + q, 0) / ra.length, mb = rb.reduce((p, q) => p + q, 0) / rb.length; ra.forEach((v, i) => { A.push(v - ma); Bv.push(rb[i] - mb); }); } return [A, Bv]; };
    const [mA, mB] = mk(on), [nA, nB] = mk(on, 61);   // control: the same reflection image paired with upright columns 61 px away
    for (const x of xs) {
      let su = 0, nu = 0, sw = 0, nw = 0, so = 0;
      for (let y = Math.max(0, yw[x] - hB); y <= yw[x] - 4; y++) { su += Y(off, x, y); nu++; }
      for (let y = yw[x] + 4; y <= yw[x] + hB && y < H; y++) if (sel[(H - 1 - y) * W + x]) { sw += Y(on, x, y) - Y(off, x, y); so += Y(off, x, y); nw++; }
      if (nu > 5 && nw > 5) { u.push(su / nu); w.push(sw / nw); wOff.push(so / nw); }
    }
    const corr = (a, b) => { const n = a.length; if (n < 20) return null; const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb + 1e-9); };
    const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
    // the ribbon: depth of the darkest aligned-profile value in [-8, +8] under the lighter of the two sides
    const side = (lo, hi) => { const v = prof.filter((p) => p[0] >= lo && p[0] <= hi && p[1] != null).map((p) => p[1]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const inner = prof.filter((p) => p[0] >= -4 && p[0] <= 8 && p[1] != null).map((p) => p[1]);
    const sideUp = side(-10, -6), sideDn = side(14, 40);
    out.views.push({ name, waterPx: nW, band: bandOf(rOff), bandOn: bandOf(rOn), ywMed, cols: xs.length, profile: prof,
      ribbon: inner.length && sideUp != null && sideDn != null ? { min: Math.min(...inner), up: sideUp, down: sideDn, depth: Math.min(sideUp, sideDn) - Math.min(...inner) } : null,
      refl: { mirrorCorr: mA.length > 50 ? corr(mA, mB) : null, mirrorCorrOff: nA.length > 50 ? corr(nA, nB) : null, share: nW ? nDiff / nW : 0, shareUpper: nWup ? nDiffUp / nWup : 0, corr: corr(u, w), corrOff: corr(u, wOff), sdRefl: w.length ? sd(w) : 0, meanRefl: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0, cols: u.length } });
    if (INV && name === "out110") {
      // WHAT DRAWS the rows around the far edge: hide one group at a time and re-measure the aligned profile's minimum
      const groups = { copies, bank: bankMeshes.filter((b) => b.userData.part === "bank"), bankRefl: bankMeshes.filter((b) => b.userData.part === "bank-reflection") };
      const profOf = (im) => { const pr = []; for (let o = -24; o <= 40; o += 2) { let q = 0, n = 0; for (const x of xs) { const y = yw[x] + o; if (y >= 0 && y < H) { q += Y(im, x, y); n++; } } pr.push([o, +(q / n).toFixed(1)]); } return pr; };
      out.inv = { base: profOf(shoot(cam)) };
      const tryHide = (label, list) => { const vis = list.map((m) => m.visible); list.forEach((m) => { m.visible = false; }); out.inv[label] = profOf(shoot(cam)); list.forEach((m, i) => { m.visible = vis[i]; }); };
      for (const [k, l] of Object.entries(groups)) tryHide("hide_" + k, l);
      tryHide("hide_copies_bank_bankRefl", [...groups.copies, ...groups.bank, ...groups.bankRefl]);
      if (newLake) {
        const vary = (label, key, val) => { const keep = U[key].value; U[key].value = val; out.inv[label] = profOf(shoot(cam)); U[key].value = keep; };
        vary("distort0", "uDistort", 0); vary("mudK0", "uMudK", 0); vary("slope0A", "uSlopeA", 0); vary("refl0", "uReflK", 0);
      }
      {
        const all = []; B.scene.traverse((o) => { if (o.isMesh || o.isPoints) all.push(o); });
        out.invList = all.map((o) => (o.name || "?") + "/" + (o.userData?.kind || "-") + (o.material?.transparent ? "/T" : "") + (o.visible ? "" : "/hidden"));
        const tr = all.filter((o) => o !== water && o.material?.transparent && o.visible);
        const vis = tr.map((o) => o.visible); tr.forEach((o) => { o.visible = false; }); out.inv.hideTransparent = profOf(shoot(cam)); tr.forEach((o, i) => { o.visible = vis[i]; });
        out.invTransparent = tr.map((o) => o.name || o.userData?.kind || "?");
      }
      {
        const kinds = {}; B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== water) { const k = o.userData?.kind || o.name || "?"; (kinds[k] ||= []).push(o); } });
        for (const [k, l] of Object.entries(kinds)) tryHide("only_hide_" + k, l);
      }
      // everything but the water + sky dome hidden: is the ribbon in the water itself?
      const others = []; B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== water && o.name !== "builtSky") others.push(o); });
      const vis2 = others.map((o) => o.visible); others.forEach((o) => { o.visible = false; });
      const im2 = shoot(cam); others.forEach((o, i) => { o.visible = vis2[i]; });
      out.inv.waterAndSkyOnly = profOf(im2);
    }
  }
  // ---- the shore: longest straight run of the land's edge in the bay (0.1 deg x 5 units ray march, exact to 1 cm)
  {
    const rec = B.__rec || (await (await fetch(`assets-hd/battle/built/${B.info.pack}.json`, { cache: "no-store" })).json());
    const L = SO.soilLand(rec);
    const edge = [];
    for (let a = 30; a <= 135; a += 0.1) {
      const s = Math.sin(a * Math.PI / 180), c = Math.cos(a * Math.PI / 180); let lo = 0, hi = 14000;
      // first r where land ends (monotone in the bay: land is contiguous from the centre)
      const FD = B.layers?.find((l) => l.id === "water")?.field || null;
      const land = FD ? (x, z) => { const sz = FD.size, u = (x + FD.span) / (2 * FD.span) * sz - 0.5, v = (z + FD.span) / (2 * FD.span) * sz - 0.5, i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0; const g = (i, j) => THREE.DataUtils.fromHalfFloat(FD.tex.image.data[(Math.min(sz - 1, Math.max(0, j)) * sz + Math.min(sz - 1, Math.max(0, i))) * 4]); const d = (g(i0, j0) * (1 - fu) + g(i0 + 1, j0) * fu) * (1 - fv) + (g(i0, j0 + 1) * (1 - fu) + g(i0 + 1, j0 + 1) * fu) * fv; return d > 0; } : (x, z) => L.landAt(x, z);
      out.shoreFrom = FD ? "water.js shore field (the visible waterline)" : "soilLand";
      for (let r = 0; r <= 14000; r += 20) { if (!land(s * r, c * r)) { hi = r; break; } lo = r; }
      for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (land(s * m, c * m)) lo = m; else hi = m; }
      edge.push([s * lo / M, c * lo / M]);
    }
    const tol = 0.01; let best = 0, bestAt = 0, n = edge.length;
    for (let i = 0; i < n - 2; i++) {
      let j = i + 2;
      for (; j < n; j++) {
        const ax = edge[i][0], az = edge[i][1], bx = edge[j][0] - ax, bz = edge[j][1] - az, l = Math.hypot(bx, bz) || 1e-9; let ok = true;
        for (let k = i + 1; k < j; k++) { const d = Math.abs((edge[k][0] - ax) * bz - (edge[k][1] - az) * bx) / l; if (d > tol) { ok = false; break; } }
        if (!ok) break;
      }
      const jj = j - 1, len = Math.hypot(edge[jj][0] - edge[i][0], edge[jj][1] - edge[i][1]);
      if (len > best) { best = len; bestAt = 30 + i * 0.1; }
    }
    // the same measure on a circle through the same points' mean radius = what "smooth" would score
    const rMean = edge.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / n, circ = 2 * Math.sqrt(8 * rMean * tol);
    let cliffs = 0; for (let i = 1; i < n; i++) if (Math.hypot(edge[i][0] - edge[i - 1][0], edge[i][1] - edge[i - 1][1]) > 0.5) cliffs++;
    let pathLen = 0; for (let i = 1; i < n; i++) pathLen += Math.hypot(edge[i][0] - edge[i - 1][0], edge[i][1] - edge[i - 1][1]);
    let margin = Infinity, expo = 0; {
      const FD2 = B.layers?.find((l) => l.id === "water")?.field;
      if (FD2) for (let k = 0; k < edge.length; k++) { const a = (30 + k * 0.1) * Math.PI / 180, rc = Math.hypot(edge[k][0], edge[k][1]) * M; let rp = rc; while (L.landAt(Math.sin(a) * rp, Math.cos(a) * rp) && rp < 15000) rp += 10; margin = Math.min(margin, (rp - rc) / M); if (rp - rc < 1) expo++; }
    }
    out.shore = { margin, expo, from: out.shoreFrom, points: n, longestStraight: best, at: bestAt, circleRef: circ, rMean, cliffs, pathLen, tol };
  }
  // ---- cost: pass on vs off (960x720 canvas), interleaved blocks; counts with the pass included
  {
    const gl = Rn.getContext(), one = new Uint8Array(4), dbg = gl.getExtension("WEBGL_debug_renderer_info");
    B.render(cam0);
    out.counts = { calls: B.info.calls, tris: B.info.triangles };
    const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
    time(10);
    const blocks = 8, per = Math.max(10, Math.round(FRAMES / blocks)), d = [], on = [], off = [];
    for (let b = 0; b < blocks; b++) { reflOn(); const a = time(per); reflOff(); const c = time(per); d.push(a - c); on.push(a); off.push(c); }
    reflOn(); B.render(cam0);
    out.cost = { dt: med(d), shown: med(on), hidden: med(off), min: Math.min(...d), frames: per * blocks, W: Rn.domElement.width, H: Rn.domElement.height, gpu: GPU, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "" };
    if (U?.uReflOn) { U.uReflOn.value = 0; B.render(cam0); out.countsOff = { calls: B.info.calls, tris: B.info.triangles }; U.uReflOn.value = 1; B.render(cam0); }
  }
  out.info = { preset: B.info.water?.preset || null, refl: B.info.water?.reflection || null };
  return out;
}, { frames: FRAMES, bay: BAY, gpu: gpuMode(), inv: INVESTIGATE }).catch((e) => ({ error: String(e && e.stack || e).slice(0, 900) }));
await browser.close().catch(() => {});

if (R.error) { console.log("FAIL page evaluate:", R.error); process.exit(1); }
if (R.noLake) { console.log(`FAIL no lake surface in ${ARENA}`); process.exit(1); }
const f1 = (v) => (v == null ? "n/a" : Number(v).toFixed(1)), f2 = (v) => (v == null ? "n/a" : Number(v).toFixed(2));
console.log(`     (info) ${ARENA}: lake = ${R.kind}, preset ${R.info.preset}, reflection ${JSON.stringify(R.info.refl)}`);
for (const v of R.views) {
  console.log(`     (info) view ${v.name}: water ${v.waterPx} px, far edge row ${v.ywMed}; banding(refl off) ${v.band ? `maxStep ${f2(v.band.maxStep)} p95 ${f2(v.band.p95Step)} maxResid ${f2(v.band.maxResid)} rms ${f2(v.band.rmsResid)} acPeak ${f2(v.band.acPeak)}@${v.band.acLag} (rows ${v.band.rows}, far ${f1(v.band.farL)} near ${f1(v.band.nearL)})` : "n/a"}; with reflection maxStep ${f2(v.bandOn?.maxStep)} maxResid ${f2(v.bandOn?.maxResid)}`);
  console.log(`     (info) view ${v.name}: far-edge profile (offset:luma) ${v.profile.map((p) => p[0] + ":" + p[1]).join(" ")}`);
  console.log(`     (info) view ${v.name}: reflection share ${f2(v.refl.share * 100)} % of water px (upper half ${f2(v.refl.shareUpper * 100)} %), column-profile corr ${f2(v.refl.corr)} (off ${f2(v.refl.corrOff)}), mirror-image pixel corr ${f2(v.refl.mirrorCorr)} (shifted-column control ${f2(v.refl.mirrorCorrOff)}), sd ${f2(v.refl.sdRefl)} mean diff ${f2(v.refl.meanRefl)} over ${v.refl.cols} columns`);
}
if (R.invList) console.log(`     (info) scene meshes: ${R.invList.join(", ")}; transparent hidden in the test: ${JSON.stringify(R.invTransparent)}`);
if (R.inv) console.log(`     (info) ribbon cause (view out110, aligned luma profile, offset:luma, per variant): ${Object.entries(R.inv).map(([k, v]) => k + " " + v.filter((p) => p[0] >= -3 && p[0] <= 4).map((p) => p[0] + ":" + p[1]).join(" ")).join(" | ")}`);
console.log(`     (info) shore (bay az 30..135, ${R.shore.points} points, tol ${R.shore.tol} m): longest straight run ${f2(R.shore.longestStraight)} m at az ${R.shore.at.toFixed(1)}, a circle of the same mean radius ${f1(R.shore.rMean)} m would score ${f2(R.shore.circleRef)} m; radial cliffs ${R.shore.cliffs}; water curve to the soil polygon edge: min gap ${f2(R.shore.margin)} m, ${R.shore.expo} of ${R.shore.points} rays under 1 cm-ish gap; path ${f1(R.shore.pathLen)} m`);
console.log(`     (info) cost ${R.cost.W}x${R.cost.H} (${R.cost.gpu}) ${R.cost.frames} frames: reflection on ${f2(R.cost.shown)} ms, off ${f2(R.cost.hidden)} ms, median delta ${f2(R.cost.dt)} ms (best block ${f2(R.cost.min)}); frame counts ${JSON.stringify(R.counts)}, pass off ${JSON.stringify(R.countsOff || null)}; ${R.cost.renderer}`);

// ---- asserts (bounds picked from the numbers above; see BOARD [build-water3])
const BOUND = { maxStep: 3.0, maxResid: 3.5, acPeak: 0.55, ribbon: 14, straight: 1.6, share: 0.30, corr: 0.25, ms: 3.0 };
const VW = R.views.filter((v) => v.waterPx >= 3000);
const VB = VW.filter((v) => v.band && v.bandOn);
console.log(`     (info) views with enough water to judge: ${VW.map((v) => v.name + " " + v.waterPx).join(", ")}; skipped: ${R.views.filter((v) => v.waterPx < 3000).map((v) => v.name + " " + v.waterPx).join(", ") || "none"}`);
for (const v of VB) {
  const b = v.band;   // the water body (ripples, Fresnel, depth colour) with the reflection off: the reflected trees' own rows are picture content, not bands
  check(b.maxStep <= BOUND.maxStep && b.maxResid <= BOUND.maxResid, `${v.name}: no banding on the water body: row-to-row luma step <= ${f2(b.maxStep)} (<= ${BOUND.maxStep}), residual after a 15-row median <= ${f2(b.maxResid)} (<= ${BOUND.maxResid})`);
  const bo = v.bandOn;
  check(!(bo.acPeak > BOUND.acPeak && bo.rmsResid > 0.8), `${v.name}: no periodic stripe on the displayed water (reflection on): peak ${f2(bo.acPeak)}@${bo.acLag}, rms ${f2(bo.rmsResid)}`);
  check(!(b.acPeak > BOUND.acPeak && b.rmsResid > 0.8), `${v.name}: no periodic stripe: autocorrelation peak ${f2(b.acPeak)} at lag ${b.acLag} (rms residual ${f2(b.rmsResid)}; fails only above ${BOUND.acPeak} with rms > 0.8)`);
  if (!v.name.startsWith("out")) {} else if (v.ribbon) check(v.ribbon.depth <= BOUND.ribbon, `${v.name}: no dark ribbon between water and bank: darkest row within +-8 of the far edge is ${f1(v.ribbon.min)}, sides ${f1(v.ribbon.up)} (bank) / ${f1(v.ribbon.down)} (water): ${f1(v.ribbon.depth)} under the darker side (<= ${BOUND.ribbon})`);
  else check(false, `${v.name}: ribbon not measurable`);
}
check(R.shore.margin >= -0.05, `the visible waterline is inside the soil polygon (its straight edges are under water): min gap ${f2(R.shore.margin)} m (>= -0.05)`);
check(R.shore.longestStraight <= BOUND.straight, `shore edge: longest straight run ${f2(R.shore.longestStraight)} m (<= ${BOUND.straight} m; a circle of that radius scores ${f2(R.shore.circleRef)} m)`);
for (const v of VW) {
  if (v.name.startsWith("in")) { check(v.refl.share >= BOUND.share, `${v.name}: the reflection is on ${f2(v.refl.share * 100)} % of the water pixels (>= ${BOUND.share * 100} %); the mirror-image test is not run for eye-facing-the-arena views (the rows above their water edge are the near land, not a far shore)`); continue; }
  check(v.refl.share >= BOUND.share, `${v.name}: the reflection is on ${f2(v.refl.share * 100)} % of the water pixels (>= ${BOUND.share * 100} %)`);
  check(v.refl.mirrorCorr != null && v.refl.mirrorCorr >= BOUND.corr && v.refl.mirrorCorr > (v.refl.mirrorCorrOff ?? 0) + 0.12, `${v.name}: the water holds the mirror image of the upright far shore: pixel correlation ${f2(v.refl.mirrorCorr)} (>= ${BOUND.corr}; shifted-column control ${f2(v.refl.mirrorCorrOff)})`);
}
check(R.cost.dt <= BOUND.ms, `cost of the reflection: ${f2(R.cost.dt)} ms at 960x720 (<= ${BOUND.ms} ms); frame ${f2(R.cost.shown)} ms`);
for (const er of errors) console.log("   error:", er);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL`);
process.exit(fails);
