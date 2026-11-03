// Numbers check of the BUILT arena's LAKE and its reflections (web/built/mirror.js; recipe kinds "pine_mirror" /
// "rock_mirror", meft1008). No pictures: every number below is measured from the page's own meshes, its own GPU and the
// colours MEASURE.md 2e measured on the original's texels.
//  - inventory: ONE flat lake surface + the mirrored copies (the near ring from web/built/trees.js's own instanced
//    meshes, the far treeline band, the boulder piles), all userData.kind "mirror", one shared uniform object
//  - the surface: flat at one y under the floor, only outside soil.js's shore (bay az 30..135 open), colour = the
//    arena background [240,232,248]
//  - the copies: every vertex at y <= 0 (nothing pokes above the water), the ring's depth ~ its own height, the
//    treeline band -7.41..0 m, the boulders down to -2.15 m
//  - the TINT (GPU probe through the real material's uniforms): at the waterline each copy's colour = its measured
//    reflection colour (MEASURE 2e: ring [16.7,29.9,33.1], treeline [56,64,72], boulders [32,40,40]) and it fades to
//    the lake colour with depth; the ring's reflection is cooler than the ring itself (less green, more blue)
//  - the BAY VIEW (eye 10 m out, 1.7 m up, az 90 / 110 / 120): the lake and the mirrored copies really show up in the
//    frame (pixel passes: only the lake, only the copies, both through the real materials)
//  - cost: the whole module shown vs hidden at 960x720 (<= 0.5 ms), triangles and draw calls; 0 page/shader errors
//   VERIFY_PORT=8090 ARENA=meft1008 [FRAMES=120] tools/run-playwright.sh tools/verify_built_mirror.mjs
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 120));
// USER 2026-10-30 (comparing with the real game): the lake must be DARK grey/blue-grey, rippled, darker toward us, with the
// tree/rock/grass reflections visible, Fresnel, a slight glint and a soft shore -- NOT the pale background [240,232,248].
// (No water texel exists in the pack, MEASURE 2a; the cast comes from the measured reflections, MEASURE 2e.) The old
// asserts that the water IS the background colour were wrong for what the user sees and are replaced below.
const GOLD = { lake: [240, 232, 248], ring: [16.7, 29.9, 33.1], treeline: [56, 64, 72], boulders: [32, 40, 40] };
const BAY = [90, 110, 120];
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 2500)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1200);
let fails = 0, passes = 0, skips = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const skip = (msg) => { skips++; console.log(`SKIP ${msg}`); };

const R0 = await page.evaluate(async ({ frames: FRAMES, gpu: GPU, bay: BAY, gold: GOLD }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const SO = await import("./built/soil.js");
  const B = window.__built, rr = window.__r;
  if (!B) return { missing: true };
  const R = B.renderer;
  rr.render(0); const cam = rr.getCameraInfo().render; B.render(cam);
  const M = S.UNITS_PER_M, out = {};
  const mirror = [], lake = [], refl = [];
  B.scene.traverse((o) => {
    if (!o.isMesh || o.userData?.kind !== "mirror") return;
    mirror.push(o);
    if (o.userData.part === "surface") lake.push(o); else if (o.userData.part !== "bank") refl.push(o);
  });
  out.inv = { total: mirror.length, lake: lake.length, refl: refl.length,
              parts: refl.map((m) => m.userData.part), kinds: [...new Set(mirror.map((m) => m.userData.kind))],
              mats: [...new Set(mirror.map((m) => m.material.name))], info: B.info.mirror || null };
  if (!lake.length) return out;
  const L = SO.soilLand(B.__rec || (await (await fetch(`assets-hd/battle/built/${B.info.pack}.json`, { cache: "no-store" })).json()));
  // ---- 1. the surface: flat, under the floor, outside the land, lake colour = the arena background
  {
    const g = lake[0].geometry, P = g.attributes.position;
    let ymin = Infinity, ymax = -Infinity, onLand = 0, inBay = 0, bayMax = 0, rmax = 0, rOut = 0;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), r = Math.hypot(x, z);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); rmax = Math.max(rmax, r); rOut = Math.max(rOut, r);
      const az = Math.atan2(x, z) * 180 / Math.PI;
      if (L.landAt(x, z)) onLand++;
      if (az >= 30 && az <= 135) { inBay++; bayMax = Math.max(bayMax, r / M); }
    }
    out.surface = { verts: P.count, ymin, ymax, rmax: rmax / M, onLand, onLandShare: onLand / P.count, inBay, bayMax,
                    tris: g.userData.tris, cols: g.userData.cols,
                    colour: lake[0].material.uniforms.uLakeNear.value.clone(), colourFar: lake[0].material.uniforms.uLakeFar.value.clone(),
                    bg: (await (await fetch(`assets-hd/battle/built/${B.info.pack}.json`, { cache: "no-store" })).json()).bg,
                    depthWrite: lake[0].material.depthWrite, renderOrder: lake[0].renderOrder };
    {
      const enc = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
      const a = lake[0].material.uniforms.uLakeNear.value, b = lake[0].material.uniforms.uLakeFar.value;
      out.lakeMidS = [enc(a.r) / 2 + enc(b.r) / 2, enc(a.g) / 2 + enc(b.g) / 2, enc(a.b) / 2 + enc(b.b) / 2];
    }
    // the shore: soil.js's own outline in the bay, and the farthest water vertex
    const bayLand = [];
    for (let a = 30; a <= 135; a += 5) bayLand.push(+(L.outline.landEnd[Math.round(((a + 180) % 360))] / M).toFixed(2));
    out.surface.bayLandEnd = bayLand;
  }
  // ---- 2. every copy below the water, and how deep
  {
    const tmp = new THREE.Matrix4(), wm = new THREE.Matrix4(), v = new THREE.Vector3(), box = new THREE.Box3();
    out.copies = [];
    for (const m of refl) {
      m.updateWorldMatrix(true, false);
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, corners = [];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push(new THREE.Vector3(x, y, z));
      let lo = Infinity, hi = -Infinity, n = 0;
      const mats = [];
      if (m.isInstancedMesh) { const a = m.instanceMatrix.array; for (let i = 0; i < m.count * 16; i += 16) mats.push(new THREE.Matrix4().fromArray(a, i)); }
      else mats.push(new THREE.Matrix4());
      for (const im of mats) {
        wm.multiplyMatrices(m.matrixWorld, im);
        for (const c of corners) { v.copy(c).applyMatrix4(wm); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
        n++;
      }
      out.copies.push({ part: m.userData.part, species: m.userData.species || null, yMin: lo, yMax: hi, depth: -lo / M,
                        count: n, tris: (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1),
                        tint: m.material.uniforms.uTint.value.clone(), fadeK: m.material.uniforms.uFadeK.value });
    }
    out.yMaxOfAll = Math.max(...out.copies.map((c) => c.yMax));
    out.copyClips = refl.map((m) => /vW\.y\s*>\s*-0\.5/.test(m.material.fragmentShader));
  }
  // ---- 3. the tint: GPU probe through each material's own uniforms, one column per depth
  const depths = [0.1, 0.25, 0.5, 1, 2, 4, 6, 8, 10];
  out.probe = [];
  {
    const src = B.layers.find((l) => l.id === "mirror");
    for (const m of refl) {
      const cols = depths.length, rows = 4, N = cols * rows;
      const P = new Float32Array(N * 3), pid = new Float32Array(N), d = new Float32Array(N);
      for (let i = 0; i < N; i++) { pid[i] = i; d[i] = depths[i % cols]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("pid", new THREE.BufferAttribute(pid, 1));
      g.setAttribute("depth", new THREE.BufferAttribute(d, 1));
      const mat = src.probeMaterial(m, cols, rows);
      const sc = new THREE.Scene(), pts = new THREE.Points(g, mat); pts.frustumCulled = false; sc.add(pts);
      const rt = new THREE.WebGLRenderTarget(cols * 2, rows * 2, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
      const prev = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
      const px = new Float32Array(cols * 2 * rows * 2 * 4); R.readRenderTargetPixels(rt, 0, 0, cols * 2, rows * 2, px);
      R.setRenderTarget(prev); rt.dispose(); g.dispose(); mat.dispose();
      const byDepth = depths.map((dd, ci) => {
        const sum = [0, 0, 0];
        for (let r = 0; r < rows; r++) {
          const o = ((r * 2) * (cols * 2) + ci * 2) * 4;
          sum[0] += px[o]; sum[1] += px[o + 1]; sum[2] += px[o + 2];
        }
        return sum.map((v) => +(v / rows * 255).toFixed(1));
      });
      // what the maths says these should be (same uniforms, same sRGB encoding) — printed for the report
      const u = m.material.uniforms, T0 = u.uTint.value, HZ = u.uLakeMid.value, k = u.uFadeK.value, fmax = u.uFadeMax.value;
      const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
      const dec = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const expect = depths.map((d) => {
        const f = Math.min(1 - Math.exp(-d * k), fmax);
        const h = [HZ.r, HZ.g, HZ.b];
        return [T0.r, T0.g, T0.b].map((v, i) => {                       // sRGB lerp, then display-encoded
          const srgb = enc(v) + (enc(h[i]) - enc(v)) * f;
          return +(enc(dec(srgb)) * 255).toFixed(1);
        });
      });
      out.probe.push({ part: m.userData.part, species: m.userData.species || null, depths, colours: byDepth, expect });
    }
  }
  // ---- 4. the bay view: what the frame really shows at the fight camera's own eye ring, az 90/110/120.
  //      The share and colour of the lake and of the copies are DIFFS of the full frame against the same frame with
  //      that layer hidden, so land, shore and trees occlude them exactly as they do for the player.
  out.bay = [];
  {
    const W = 480, H = 360;   // half of 960x720: pixel shares, not detail
    // sRGB target: the materials write display-encoded colour (`#include <colorspace_fragment>` follows the target),
    // so these pixels can be compared with MEASURE.md's sRGB numbers directly
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace });
    const buf = new Uint8Array(W * H * 4);
    const shoot = (cam) => {
      const prev = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear(); R.render(B.scene, cam);
      R.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      R.setRenderTarget(prev);
      return Uint8Array.from(buf);
    };
    const diff = (a, b) => { let n = 0, s = [0, 0, 0]; for (let i = 0; i < W * H; i++) { const o = i * 4; if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 6) { n++; s[0] += a[o]; s[1] += a[o + 1]; s[2] += a[o + 2]; } } return { n, share: n / (W * H), mean: n ? s.map((v) => +(v / n).toFixed(1)) : null }; };
    // a red stand-in for one layer: what shows red is what that layer really puts on screen (land and trees occlude it)
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000, depthWrite: false, transparent: false, side: THREE.DoubleSide });
    const mask = (targets, hide) => {
      const saved = targets.map((m) => m.material);
      const hid = hide.map((m) => [m, m.visible]);
      for (const [m, v] of hid) m.visible = false;
      targets.forEach((m) => { m.material = red; });
      const img = shoot(curCam);
      targets.forEach((m, i) => { m.material = saved[i]; });
      for (const [m, v] of hid) m.visible = v;
      let n = 0, top = H, bot = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = ((H - 1 - y) * W + x) * 4;   // readRenderTargetPixels: row 0 = bottom, so flip to screen rows
        if (img[o] > 120 && img[o + 1] < 80 && img[o + 2] < 80) { n++; top = Math.min(top, y); bot = Math.max(bot, y); }
      }
      return { n, share: n / (W * H), top, bot };
    };
    let curCam = null;
    for (const az of BAY) {
      const a = az * Math.PI / 180;
      const c = new THREE.PerspectiveCamera(45, W / H, 1, B.camera.far);
      c.position.set(Math.sin(a) * 10 * M, 1.7 * M, Math.cos(a) * 10 * M);
      c.lookAt(0, 0, 0); c.updateMatrixWorld();
      curCam = c;
      const full = shoot(c);
      for (const m of refl) m.visible = false; const noRefl = shoot(c); for (const m of refl) m.visible = true;
      const rp = diff(full, noRefl);                       // the copies as the frame composites them
      const lm = mask(lake, refl);                         // the lake's own visible area (red, copies hidden)
      // the horizon row: the view ray with slope 0 (the waterline at infinity); nothing mirrored may be above it
      // screen row of the waterline at infinity: the camera sits 1.7 m above the water and looks down 9.65 deg
      const pitch = Math.atan2(1.7, 10), halfV = 22.5 * Math.PI / 180;
      const horizon = Math.round((0.5 - 0.5 * Math.tan(pitch) / Math.tan(halfV)) * H);
      const rm = mask(refl, lake);
      // the water's own colour through its real material (only the lake drawn, over black)
      const others = []; B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && !lake.includes(o)) others.push(o); });
      for (const o of others) o.visible = false;
      const lakeImg = shoot(c);
      for (const o of others) o.visible = true;
      out.bay.push({ az, refl: rp, lake: lm, copies: rm, horizon, lakeCol: diff(lakeImg, new Uint8Array(W * H * 4)) });
    }
    for (const m of [...lake, ...refl]) m.visible = true;
    rt.dispose(); red.dispose();
  }
  // ---- 5. shared uniforms, programs, draw calls, cost at 960x720
  {
    const mats = new Set(B.materials); let bad = 0, refs = 0;
    for (const m of mats) for (const k of Object.keys(S.U)) { refs++; if (m.uniforms[k] !== S.U[k]) bad++; }
    out.uniforms = { materials: mats.size, refs, bad, inList: mirror.every((m) => mats.has(m.material)) };
    out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
    const hidden = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && !mirror.includes(o)) { hidden.push(o); o.visible = false; } });
    B.render(cam); out.only = { calls: B.info.calls, triangles: B.info.triangles };
    for (const o of hidden) o.visible = true;
    const gl = R.getContext(), one = new Uint8Array(4);
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const set = (v) => { for (const m of mirror) m.visible = v; };
    const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
    time(12);
    // interleaved blocks (shown, hidden, shown, hidden ...) and the MEDIAN of the differences: this box runs several
    // verifiers at once, and a single shown-block-then-hidden-block pair drifts with whatever else is on the GPU
    const blocks = 8, per = Math.max(15, Math.round(FRAMES / blocks));
    const deltas = [], showns = [], hiddens = [];
    for (let b = 0; b < blocks; b++) {
      set(true); const s1 = time(per); set(false); const h1 = time(per);
      deltas.push(s1 - h1); showns.push(s1); hiddens.push(h1);
    }
    set(true); B.render(cam);
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    out.frame = { dt: med(deltas), min: Math.min(...deltas), deltas, shown: med(showns), hidden: med(hiddens), frames: per * blocks, blocks, gpu: GPU,
                  W: R.domElement.width, H: R.domElement.height, allCalls: B.info.calls, allTris: B.info.triangles,
                  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  }
  return out;
}, { frames: FRAMES, gpu: gpuMode(), bay: BAY, gold: GOLD });
// ---- 6. the water LOOK, numbers from the GPU (USER 2026-10-30: real water, not a white sheet)
const W2 = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const MI = await import("./built/mirror.js");
  const B = window.__built, rr = window.__r, Rn = B.renderer;
  rr.render(0); const cam0 = rr.getCameraInfo().render; B.render(cam0);
  const M = S.UNITS_PER_M, W = 320, H = 240, out = {};
  const find = (f) => { const l = []; B.scene.traverse((o) => { if (o.isMesh && f(o)) l.push(o); }); return l; };
  const lake = find((o) => o.userData?.part === "surface")[0];
  const copies = find((o) => o.userData?.kind === "mirror" && o.userData.part !== "surface" && o.userData.part !== "bank");
  const bank = find((o) => o.name === "builtLakeBank")[0] || null;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace });
  const buf = new Uint8Array(W * H * 4);
  const shoot = (cam) => { const prev = Rn.getRenderTarget(); Rn.setRenderTarget(rt); Rn.setClearColor(0x000000, 1); Rn.clear(); Rn.render(B.scene, cam); Rn.readRenderTargetPixels(rt, 0, 0, W, H, buf); Rn.setRenderTarget(prev); return Uint8Array.from(buf); };
  const red = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const maskOf = (mesh, cam) => { const m0 = mesh.material; mesh.material = red; const im = shoot(cam); mesh.material = m0; const sel = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (im[i * 4] > 250 && im[i * 4 + 1] < 4 && im[i * 4 + 2] < 4) sel[i] = 1; return sel; };
  const camAt = (az, h, tx, ty, tz, d = 10) => { const a = az * Math.PI / 180; const c = new THREE.PerspectiveCamera(45, W / H, 1, B.camera.far); c.position.set(Math.sin(a) * d * M, h * M, Math.cos(a) * d * M); c.lookAt(tx, ty, tz); c.updateMatrixWorld(); return c; };
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bankRefl = find((o) => o.name === "builtLakeBankReflection")[0] || null;
  const hideCopies = () => { copies.forEach((m) => { m.visible = false; }); if (bankRefl) bankRefl.visible = false; };
  const showCopies = () => { copies.forEach((m) => { m.visible = true; }); if (bankRefl) bankRefl.visible = true; };

  // the water alone from the bay (az 110), the fight camera
  const cam = camAt(110, 1.7, 0, 0, 0);
  hideCopies();
  const sel = maskOf(lake, cam), img = shoot(cam);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let n = 0, s = 0, sq = 0; const rs = [0, 0, 0];
    for (let x = 0; x < W; x++) { const i = (H - 1 - y) * W + x; if (!sel[i]) continue; const o = i * 4; const l = lum(img[o], img[o + 1], img[o + 2]); n++; s += l; sq += l * l; rs[0] += img[o]; rs[1] += img[o + 1]; rs[2] += img[o + 2]; }
    if (n > 20) rows.push({ y, n, mean: s / n, sd: Math.sqrt(Math.max(0, sq / n - (s / n) ** 2)), rgb: rs.map((v) => v / n) });
  }
  out.rows = rows.length;
  if (rows.length > 20) {
    const q = (a, b) => { const r = rows.slice(Math.floor(rows.length * a), Math.floor(rows.length * b)); return r.reduce((s, x) => s + x.mean, 0) / r.length; };
    out.farL = q(0, 0.25); out.nearL = q(0.75, 1);
    out.sd = rows.reduce((s, x) => s + x.sd, 0) / rows.length;                   // spread across a row = the ripple texture
    out.maxStep = Math.max(...rows.slice(1).map((r, i) => Math.abs(r.mean - rows[i].mean)));
    out.rgbNear = rows[rows.length - 1].rgb.map((v) => +v.toFixed(0)); out.rgbFar = rows[0].rgb.map((v) => +v.toFixed(0));
  }
  // animation: the same view at two times
  const U = S.U; const t0 = U.uWindTime.value;
  U.uWindTime.value = 1.0; const a1 = shoot(cam); U.uWindTime.value = 4.0; const a2 = shoot(cam); U.uWindTime.value = t0;
  let dsum = 0, dn = 0;
  for (let i = 0; i < W * H; i++) if (sel[i]) { const o = i * 4; dsum += Math.abs(lum(a1[o], a1[o + 1], a1[o + 2]) - lum(a2[o], a2[o + 1], a2[o + 2])); dn++; }
  out.animDiff = dn ? dsum / dn : 0; out.waterPx = dn;
  // Fresnel: straight down vs grazing, same water, same light, no copies
  const dxy = [Math.sin(110 * Math.PI / 180) * 10 * M, Math.cos(110 * Math.PI / 180) * 10 * M];
  const camDown = new THREE.PerspectiveCamera(45, W / H, 1, B.camera.far);
  camDown.position.set(dxy[0], 3 * M, dxy[1]); camDown.up.set(0, 0, 1); camDown.lookAt(dxy[0], 0, dxy[1]); camDown.updateMatrixWorld();
  const selD = maskOf(lake, camDown), imgD = shoot(camDown);
  { let s = 0, n = 0; for (let i = 0; i < W * H; i++) if (selD[i]) { const o = i * 4; s += lum(imgD[o], imgD[o + 1], imgD[o + 2]); n++; } out.downL = n ? s / n : null; out.downPx = n; }
  out.grazeL = out.farL;
  // glint: put the light on the mirror direction of the middle row and compare the brightest water pixel
  {
    const ld = U.uLightDir.value.clone();
    let base = 0; for (let i = 0; i < W * H; i++) if (sel[i]) { const o = i * 4; base = Math.max(base, lum(img[o], img[o + 1], img[o + 2])); }
    const rowMid = rows[Math.floor(rows.length / 2)]; const ndcY = 1 - 2 * (rowMid.y + 0.5) / H;
    const ray = new THREE.Vector3(0, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
    U.uLightDir.value.set(ray.x, -ray.y, ray.z).normalize();           // flat-water reflection of that ray
    const g = shoot(cam); let mx = 0; for (let i = 0; i < W * H; i++) if (sel[i]) { const o = i * 4; mx = Math.max(mx, lum(g[o], g[o + 1], g[o + 2])); }
    out.glintMax = mx; out.glintBase = base;
    U.uLightDir.value.copy(ld);
  }
  // soft shore: the strip of water just outside the land at az 110 seen from above; largest step between neighbouring pixels
  {
    const camS = new THREE.PerspectiveCamera(30, W / H, 1, B.camera.far);
    camS.position.set(Math.sin(110 * Math.PI / 180) * 9 * M, 6 * M, Math.cos(110 * Math.PI / 180) * 9 * M);
    camS.lookAt(Math.sin(110 * Math.PI / 180) * 5.5 * M, 0, Math.cos(110 * Math.PI / 180) * 5.5 * M); camS.updateMatrixWorld();
    const sS = maskOf(lake, camS), iS = shoot(camS); let worst = 0, n = 0, lo = 255, hi = 0; const steps = [];
    for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
      const i = (H - 1 - y) * W + x, j = i - 1; if (!sS[i] || !sS[j]) continue;
      const d = Math.abs(lum(iS[i * 4], iS[i * 4 + 1], iS[i * 4 + 2]) - lum(iS[j * 4], iS[j * 4 + 1], iS[j * 4 + 2])); worst = Math.max(worst, d); n++; steps.push(d);
    }
    for (let i = 0; i < W * H; i++) if (sS[i]) { const l = lum(iS[i * 4], iS[i * 4 + 1], iS[i * 4 + 2]); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    steps.sort((a, b) => a - b);
    out.shore = { px: n, maxStep: worst, p99: steps[Math.floor(steps.length * 0.99)], lo, hi, u: { shoreK: lake.material.uniforms.uShoreK.value, foamK: lake.material.uniforms.uFoamK.value } };
  }
  showCopies();
  // the normal map: tileable (opposite edges continuous), non-trivial slope
  {
    const d = MI.makeWaterNormalData(256); let edge = 0, inner = 0, ne = 0, ni = 0, sl = 0;
    for (let y = 0; y < 256; y++) {
      const a = d.data[(y * 256 + 0) * 4 + 3], b = d.data[(y * 256 + 255) * 4 + 3], c = d.data[(y * 256 + 100) * 4 + 3], c2 = d.data[(y * 256 + 101) * 4 + 3];
      edge += Math.abs(a - b); ne++; inner += Math.abs(c - c2); ni++;
    }
    for (let i = 0; i < 256 * 256; i++) sl += Math.hypot(d.data[i * 4] / 255 * 2 - 1, d.data[i * 4 + 1] / 255 * 2 - 1);
    out.nmap = { wrapEdge: edge / ne, neighbour: inner / ni, slope: sl / (256 * 256) };
  }
  // the bank (the pines' foot row)
  if (bank) {
    const camB = camAt(270, 1.7, 0, 0, 0); const sB = maskOf(bank, camB), iB = shoot(camB); const px = [];
    for (let i = 0; i < W * H; i++) if (sB[i]) px.push([iB[i * 4], iB[i * 4 + 1], iB[i * 4 + 2]]);
    const med = (k) => { const a = px.map((p) => p[k]).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
    out.bank = { px: px.length, med: [med(0), med(1), med(2)], info: B.info.mirror.bank };
  }
  out.hasShader = { fres: /pow\(1\.0 - cosT, 5\.0\)/.test(lake.material.fragmentShader), spec: /uSpecPow/.test(lake.material.fragmentShader), nmap: /uWN/.test(lake.material.fragmentShader) };
  out.tex = { name: lake.material.uniforms.uWN.value?.name, size: lake.material.uniforms.uWN.value?.image?.width };
  return out;
}).catch((e) => ({ error: String(e).slice(0, 400) }));
// the viewer's own layer switch (web/arena-viewer.html LAYERS: kinds "mirror"): off hides every mesh of the module
const UL = await page.evaluate(() => {
  const rows = window.__layers.rows ? window.__layers.rows() : [];
  window.__layers.set("mirror", false);
  const off = []; window.__built.scene.traverse((o) => { if (o.userData?.kind === "mirror") off.push(o.visible); });
  window.__layers.set("mirror", true);
  const on = []; window.__built.scene.traverse((o) => { if (o.userData?.kind === "mirror") on.push(o.visible); });
  return { rows, off, on };
}).catch(() => null);
await browser.close().catch(() => {});

// ---- report
if (R0.missing) { console.log("FAIL built arena did not load (window.__built missing)"); for (const e of errors) console.log("   error:", e); process.exit(1); }
const I = R0.inv;
console.log(`     (info) ${ARENA}: mirror meshes ${I.total} (surface ${I.lake}, copies ${I.refl}: ${JSON.stringify(I.parts)}), materials ${JSON.stringify(I.mats)}`);
if (!I.lake && /bank only/.test(I.info?.mode || "")) {   // build-water3: water.js built the lake (planar reflection); mirror.js keeps the bank only
  const bank = R0.inv.parts.length === 0 && !!I.info?.bank;
  check(!!I.info?.bank && I.total >= 1, `lake is water.js now (${I.info.mode}); mirror.js built the grass bank only: ${I.total} mesh(es), bank ${JSON.stringify(I.info.bank && { r: I.info.bank.r, h: I.info.bank.h, colour: I.info.bank.colour })}; the lake itself is checked by tools/verify_built_lake.mjs`);
  check(errors.length === 0, `errors: ${errors.length}`);
  console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL`);
  process.exit(fails);
}
if (!I.lake) { console.log(`FAIL no lake surface in ${ARENA} (recipe has no pine_mirror / rock_mirror piece)`); process.exit(1); }
if (I.info) console.log(`     (info) info.mirror: lake ${I.info.lake?.tris} tris over ${I.info.lake?.cols} azimuth columns, ring ${I.info.ring?.tris} tris / ${I.info.ring?.instances} instances, treeline ${I.info.treeline?.tris} tris at r ${I.info.treeline?.r} m, boulders ${I.info.boulders?.tris} tris (${I.info.boulders?.from}), build ${I.info.buildMs} ms`);

// 1. the surface
{
  const s = R0.surface, bg = s.bg;
  check(s.ymin === s.ymax && s.ymax <= 0, `the lake surface is flat and under the floor: one y = ${s.ymax} (<= 0), ${s.verts} vertices, ${s.tris} triangles`);
  const enc = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
  const nearS = [s.colour.r, s.colour.g, s.colour.b].map(enc), farS = [s.colourFar.r, s.colourFar.g, s.colourFar.b].map(enc);
  const lumaS = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  check(lumaS(nearS) < lumaS(farS) && lumaS(farS) <= 100 && nearS[2] > nearS[0] && farS[2] > farS[0] && farS[2] - farS[0] <= 45,
    `the water is DARK blue-grey, darker toward us: near ${nearS.map((v) => v.toFixed(0))} (luma ${lumaS(nearS).toFixed(0)}) -> far ${farS.map((v) => v.toFixed(0))} (luma ${lumaS(farS).toFixed(0)}); NOT the pale background ${JSON.stringify(bg)} (luma ${lumaS(bg).toFixed(0)}); the measured reflections' cast is blue-grey (MEASURE 2e)`);
  const landShare = s.onLandShare;
  check(landShare < 0.35, `the surface follows the shore: ${(landShare * 100).toFixed(0)} % of its vertices are under the land (the ${(0.75).toFixed(2)} m overlap that hides the tessellated seam), ${(100 - landShare * 100).toFixed(0)} % open water`);
  check(s.rmax > 27.8 && s.rmax < 80, `the water reaches past the far treeline: outer radius ${s.rmax.toFixed(1)} m (27.8 m treeline, < 80 m)`);
  check(s.inBay > 0 && s.bayMax > 3, `the bay is open water: ${s.inBay} surface vertices at az 30..135 out to ${s.bayMax.toFixed(1)} m, land ends there at ${s.bayLandEnd.slice(0, 6).join("/")}..${s.bayLandEnd.slice(-3).join("/")} m`);
  check(s.depthWrite === false, `the surface writes no depth (so the copies below it are not hidden by it): depthWrite ${s.depthWrite}, renderOrder ${s.renderOrder}`);
}
// 2. the copies below the water
{
  const c = R0.copies, byPart = Object.fromEntries(c.map((x) => [x.part + (x.species ? ":" + x.species : ""), x]));
  // the tree ring's feet stand 0.02-0.04 m INTO the ground (web/built/trees.js), so their mirrored vertices reach that
  // far above y 0 — inside the upright trunk of the very same tree, and the shader discards vW.y > -0.5 units (1 mm)
  check(c.length >= 3 && R0.yMaxOfAll <= 20,
    `every mirrored copy is at or below the waterline: ${c.length} meshes, highest vertex y = ${R0.yMaxOfAll.toFixed(2)} units (${(R0.yMaxOfAll / 400).toFixed(3)} m = the trees' own feet, 2-4 cm into the ground; <= 0.05 m)`);
  const clipped = R0.copyClips;
  check(clipped.every((v) => v === true), `and the shader itself clips every copy above the surface: ${clipped.filter(Boolean).length}/${clipped.length} materials discard vW.y > -0.5 units (1 mm)`);
  const ring = c.filter((x) => x.part === "ring");
  const ringDeep = Math.max(...ring.map((x) => x.depth));
  check(ring.length > 0 && ringDeep > 14 && ringDeep < 17.5, `the near ring is mirrored to its own height: deepest ${ringDeep.toFixed(2)} m (the measured cards are 16.24 m tall), ${ring.reduce((s, x) => s + x.count, 0)} instances`);
  const tl = byPart["treeline"];
  check(!!tl && tl.depth > 7.3 && tl.depth < 7.6 && Math.abs(tl.yMax) < 0.01, `the far treeline band hangs -${tl?.depth.toFixed(2)} m down (wall_01 is -7.41..0 m), top at y ${tl?.yMax.toFixed(3)}`);
  const bo = byPart["boulders"];
  check(!!bo && bo.depth >= 1.70 && bo.depth <= 2.30,
    `the boulder piles hang -${bo?.depth.toFixed(2)} m down (wall_04's own band is -2.24..0 m; the source is ${R0.inv.info?.boulders?.from})`);
}
// 3. the tint, per depth
{
  const P = R0.probe;
  const near = (part, sp) => P.find((p) => p.part === part && (!sp || p.species === sp));
  const at = (p, d) => p.colours[p.depths.indexOf(d)];
  for (const pr of R0.probe) console.log(`     (info) probe ${pr.part}${pr.species ? ":" + pr.species : ""}: measured ${JSON.stringify(pr.colours[1])} expect ${JSON.stringify(pr.expect[1])} at 0.25 m; at 6 m ${JSON.stringify(pr.colours[6])} vs ${JSON.stringify(pr.expect[6])}`);
  const ring = near("ring", "wall") || near("ring");
  const ringc = at(ring, 0.25);
  check(Math.max(...ringc.map((v, i) => Math.abs(v - GOLD.ring[i]))) <= 12,
    `the ring's reflection at the waterline is its measured colour: ${ringc.map((v) => v.toFixed(0))} vs MEASURE 2e ${GOLD.ring} (sRGB, max |diff| <= 12)`);
  const tl = near("treeline"), tlc = at(tl, 0.25);
  check(Math.max(...tlc.map((v, i) => Math.abs(v - GOLD.treeline[i]))) <= 14,
    `the treeline's reflection is the washed-out blue-grey wall_01 is: ${tlc.map((v) => v.toFixed(0))} vs ${GOLD.treeline} (max |diff| <= 14)`);
  const bo = near("boulders"), boc = at(bo, 0.25);
  check(Math.max(...boc.map((v, i) => Math.abs(v - GOLD.boulders[i]))) <= 16,
    `the boulders' reflection is the darker green-grey wall_04 is: ${boc.map((v) => v.toFixed(0))} vs ${GOLD.boulders} (max |diff| <= 16)`);
  // cool shift: the ring's reflection loses green and gains blue against the ring's own colour
  const gb = (c) => c[2] / Math.max(c[1], 1e-3);
  const upCol = [10, 29, 19];   // floor_01's own measured median (MEASURE 2c), sRGB
  check(gb(ringc) > 1.0 && gb(ringc) > gb(upCol), `the ring's copy is cooler than the ring: blue/green ${gb(ringc).toFixed(2)} (reflection) vs ${gb(upCol).toFixed(2)} (floor_01's own median [10,29,19])`);
  // fade: the copies die into the lake colour with depth, monotonically, and reach it by ~8-10 m
  const midS = R0.lakeMidS;   // the water colour the copies fade toward (sRGB)
  const fade = (p) => p.depths.map((d) => { const c = at(p, d); return Math.hypot(c[0] - midS[0], c[1] - midS[1], c[2] - midS[2]); });
  const f1 = fade(tl);
  const mono = f1.every((v, i) => i === 0 || v <= f1[i - 1] + 0.6);
  const drop = 1 - f1[f1.length - 1] / f1[0];
  check(mono && drop > 0.10, `the copy fades into the water colour with depth: treeline distance to ${midS.map((v) => v.toFixed(0))} ${f1.map((v) => v.toFixed(0)).join(" -> ")} at 0.1..10 m (monotone, -${(drop * 100).toFixed(0)} %)`);
  const all = R0.probe.every((p) => p.colours.every((c) => c.every((v) => v >= 0 && v <= 255)));
  check(all, `every probed reflection colour is in range (${R0.probe.length} materials x ${R0.probe[0].depths.length} depths)`);
}
// 4. the bay view
{
  for (const b of R0.bay) console.log(`     (info) bay az ${b.az}: lake ${(b.lake.share * 100).toFixed(1)} % of frame, copies ${(b.copies.share * 100).toFixed(1)} % (composited mean ${JSON.stringify(b.refl.mean)}), topmost copy row ${b.copies.top} vs horizon row ${b.horizon}`);
  const lakeShare = Math.max(...R0.bay.map((b) => b.lake.share));
  const copyShare = Math.max(...R0.bay.map((b) => b.copies.share));
  check(lakeShare > 0.10, `looking into the bay shows the lake: up to ${(lakeShare * 100).toFixed(1)} % of the frame over az 90/110/120 (> 10 %), the copies' own water hidden`);
  check(copyShare > 0.02 && copyShare < 0.55, `and the mirrored copies in it: ${R0.bay.map((b) => (b.copies.share * 100).toFixed(1)).join(" / ")} % of the frame (2..55 %)`);
  const above = R0.bay.filter((b) => b.copies.top < b.horizon - 2);
  check(above.length === 0, `no pixel of a mirrored copy is drawn above the waterline: topmost copy row ${R0.bay.map((b) => b.copies.top).join("/")} vs horizon rows ${R0.bay.map((b) => b.horizon).join("/")}`);
  const lc = R0.bay.map((b) => b.lakeCol.mean).filter(Boolean);
  const lumaF = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  check(lc.length > 0 && lc.every((c) => lumaF(c) >= 20 && lumaF(c) <= 100 && c[2] > c[0]),
    `the water itself is dark blue-grey in frame: ${JSON.stringify(lc.map((c) => c.map((v) => +v.toFixed(0))))} (luma 20..100, blue > red); the old build drew [236,229,246]`);
  // what the eye sees on the water: the copies composited over the pale lake, i.e. nearer the lake than a hard copy
  const dist = (c, g) => Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]);
  const seen = R0.bay.map((b) => b.refl.mean).filter(Boolean);
  const midF = R0.lakeMidS;
  check(seen.length > 0 && seen.every((c) => lumaF(c) > lumaF(midF) - 5),
    `the reflections are visible IN the water: their frame colour ${JSON.stringify(seen[0])} (luma ${lumaF(seen[0]).toFixed(0)}) is not darker than the water ${midF.map((v) => v.toFixed(0))} (luma ${lumaF(midF).toFixed(0)}) -- they show as lighter shapes on dark water`);
}
// 5. shared uniforms, programs, cost
{
  const U = R0.uniforms, F = R0.frame, L = R0.only;
  check(U.bad === 0 && U.inList, `one shared uniform object: ${U.materials} materials, ${U.bad} not the same reference; the lake materials are in the list`);
  check(R0.programs.failed === 0, `shader programs compile: ${R0.programs.count}, ${R0.programs.failed} failed`);
  check(L.calls <= 12, `the lake and its copies cost ${L.calls} draw calls (<= 12)`);
  const dt = F.dt;
  console.log(`     (info) frame at ${F.W}x${F.H} (${F.gpu}): ${F.blocks} interleaved blocks of ${F.frames / F.blocks} frames each: mirror shown ${F.shown.toFixed(2)} ms, hidden ${F.hidden.toFixed(2)} ms, median delta ${dt.toFixed(2)} ms, best block ${F.min.toFixed(2)} ms (block deltas ${F.deltas.map((v) => v.toFixed(2)).join(" ")}); whole frame ${F.allCalls} calls, ${F.allTris} triangles; ${F.renderer}`);
  check(F.W === 960 && F.H === 720, `frame time measured at 960x720 over ${F.frames} frames`);
  check(dt <= 0.8, `the lake and its reflections cost ${dt.toFixed(2)} ms at 960x720 (<= 0.8 ms; the pale flat lake was 0.21 ms, the dark rippled water with Fresnel/glint, the bank and its reflection add the rest)`);
}
// 6. the water LOOK
if (W2.error) { check(false, `water-look probe failed: ${W2.error}`); } else {
  console.log(`     (info) water alone from the bay (az 110, fight camera): ${W2.rows} rows, far quarter luma ${W2.farL?.toFixed(1)}, near quarter ${W2.nearL?.toFixed(1)}, near rgb ${JSON.stringify(W2.rgbNear)} far rgb ${JSON.stringify(W2.rgbFar)}, row spread ${W2.sd?.toFixed(2)}, animation diff ${W2.animDiff?.toFixed(2)}, down ${W2.downL?.toFixed(1)}, glint ${W2.glintMax?.toFixed(0)} vs ${W2.glintBase?.toFixed(0)}`);
  check(W2.rows > 20 && W2.nearL < W2.farL - 8, `darker toward us: near quarter luma ${W2.nearL?.toFixed(1)} < far quarter ${W2.farL?.toFixed(1)} - 8`);
  check(W2.farL <= 110 && W2.nearL >= 12, `and dark overall (not a white sheet): luma ${W2.nearL?.toFixed(0)} (near) .. ${W2.farL?.toFixed(0)} (far) of 255; the pale background is luma 233`);
  check(W2.sd >= 0.9, `rippled, textured: the luma spread across a row of water is ${W2.sd?.toFixed(2)}/255 (>= 0.9; the old flat sheet was ~0.2)`);
  check(W2.animDiff >= 0.25, `animated ripples: the same view at two times differs by ${W2.animDiff?.toFixed(2)}/255 on average over ${W2.waterPx} water pixels (>= 0.25)`);
  check(W2.downL != null && W2.downL < W2.grazeL - 3, `Fresnel: looking down the water is darker than at grazing angles: down ${W2.downL?.toFixed(1)} vs grazing ${W2.grazeL?.toFixed(1)} (${W2.downPx} px)`);
  check(W2.glintMax > W2.glintBase + 4 && W2.glintMax < W2.glintBase + 150, `a slight sun glint: with the light on the mirror direction the brightest water pixel is ${W2.glintMax?.toFixed(0)} vs ${W2.glintBase?.toFixed(0)} (+4 .. +150)`);
  check(W2.shore.px > 500 && W2.shore.p99 <= 20 && W2.shore.u.shoreK > 0 && W2.shore.u.foamK > 0, `soft shore: ${W2.shore.px} neighbour pairs along the waterline, pixel-to-pixel luma step: 99th percentile ${W2.shore.p99.toFixed(1)} (<= 20), largest ${W2.shore.maxStep.toFixed(1)} (sun glints), wet edge ${W2.shore.u.shoreK} + lapping line ${W2.shore.u.foamK}; luma range ${W2.shore.lo.toFixed(0)}..${W2.shore.hi.toFixed(0)}`);
  check(W2.maxStep <= 26, `no hard line across the water: largest row-to-row mean luma step ${W2.maxStep?.toFixed(1)} (<= 26; the whole near-to-far ramp is ${(W2.farL - W2.nearL).toFixed(0)})`);
  check(W2.nmap.wrapEdge <= W2.nmap.neighbour * 3 + 3 && W2.nmap.slope > 0.05 && W2.nmap.slope < 0.7, `the generated normal map tiles (wrap-edge height step ${W2.nmap.wrapEdge.toFixed(1)} vs ${W2.nmap.neighbour.toFixed(1)} between neighbours) and has ripple slope ${W2.nmap.slope.toFixed(2)}`);
  check(W2.hasShader.fres && W2.hasShader.spec && W2.hasShader.nmap, `the shader is the Water.js recipe: normal-map taps + Schlick Fresnel + Blinn glint: ${JSON.stringify(W2.hasShader)} (${W2.tex.name} ${W2.tex.size}x${W2.tex.size})`);
  if (W2.bank) {
    const bm = W2.bank.med, tgt = [96, 112, 80];
    check(W2.bank.px > 200 && Math.max(...bm.map((v, k) => Math.abs(v - tgt[k]))) <= 22 && bm[1] > bm[0] && bm[1] > bm[2],
      `the grass bank at the pines' foot is light green: median sRGB ${JSON.stringify(bm)} vs the far-pines foot row ${JSON.stringify(tgt)} (max |diff| <= 22), ${W2.bank.px} px, from ${W2.bank.info?.from}`);
  } else check(false, "no grass bank mesh (builtLakeBank): the pines' foot row [98,114,77] has to be built");
}
if (UL) check(UL.rows.includes("mirror") && UL.off.length > 0 && UL.off.every((v) => v === false) && UL.on.every((v) => v === true),
  `the viewer's "lake and reflections" switch works: layer row ${UL.rows.includes("mirror") ? "present" : "MISSING"}, ${UL.off.length} meshes off -> ${UL.on.filter(Boolean).length} on`);
else skip("the viewer's layer switch: page evaluate failed");
for (const er of errors) console.log("   error:", er);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails);
