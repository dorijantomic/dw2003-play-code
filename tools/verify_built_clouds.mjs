// Numbers check of the BUILT arena's 3D CUMULUS BANKS (web/built/sky.js, research r4/clouds.md §7 STEP 1 + STEP 2).
// No pictures: every PASS/FAIL below is counts, distances, heights or pixel VALUES read back from float targets.
//  1. WIRING   one object named "builtClouds" (its material is the cloud material), 9 banks, ~100k triangles, ONE draw
//              call, drawn by the viewer's "3D clouds" switch
//  2. SHAPE    the mesh is not inside out (winding vs the field-gradient normals, signed volume > 0); the BASE is a
//              flat plane (a share of the vertices sit within one bake cell of their bank's base, spread over the bank's
//              whole width); the TOP EDGE is a row of TOWERS, not a loaf: per bank, the max height over 16 slices of the
//              width spreads over > 1/3 of the bank's height with >= 2 local maxima, and from the viewer's eye the
//              skyline over 0.5-deg azimuth bins has sd > 2 deg and >= 8 local maxima
//  3. PLACEMENT every vertex's ray from every eye (the viewer's + the keep-out sweep) meets the arena's own sky ring
//              inside its measured band, and no cloud vertex is nearer the centre than the farthest tree crown / floor
//  4. PIXELS   clouds alone into a float target, 24 views: no pixel above the ring top or below its foot; the TOP band
//              of every column is bright and near the recipe's measured cloud white, the BOTTOM band is blue-grey
//              (b - r >= 15) and darker (luma drop > 25) -> "bright white lit tops, blue-grey shaded undersides"
//  5. LIGHT    the material's light uniforms ARE the shared objects; a JS twin of the shader shows the RIM term is 0
//              wherever we do not look toward the light and a fraction of the lit albedo where we do; forcing NIGHT
//              through window.__layers.setSkyMode("night") lights the same mesh from the MOON, the pixels get darker
//              and bluer; back to auto returns to the sun
//  6. COST     frame time with the clouds shown vs hidden over FRAMES frames (<= 1 ms), draw calls removed by hiding them
//   VERIFY_PORT=8090 [ARENA=meft1002|meft1013] [FRAMES=600] tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_clouds.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const FRAMES = Math.max(60, Number(process.env.FRAMES || 600));
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 500)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 120000 }).catch(() => {});
await page.waitForFunction(() => window.__r?.getFighterBounds?.("player"), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const R = await page.evaluate(async ({ FRAMES }) => {
  const THREE = await import("./lib3d/three.module.js");
  const SK = await import("./built/sky.js");
  const S = await import("./built/shared.js");
  const B = window.__built, rr = B.renderer, out = {};
  const cm = B.scene.getObjectByName("builtClouds");
  if (!cm) return { missing: true };
  const sky = B.scene.getObjectByName("builtSky");
  const I = B.info.sky.clouds, skyI = B.info.sky;
  out.info = { banks: I.banks, lobes: I.lobes, triangles: I.triangles, vertices: I.vertices, tones: I.tones, bakedMs: I.bakedMs, light: I.light };
  out.dome = { meshes: B.scene.children.filter((o) => o.name === "builtSky").length };
  out.cloudMeshes = B.scene.children.filter((o) => o.name === "builtClouds").length;
  out.children = cm.children.length;   // the banks are ONE opaque mesh: no sprite skirt, no alpha pass
  const camInfo = window.__r.getCameraInfo().render;
  B.render(camInfo);
  const H = rr.getDrawingBufferSize(new THREE.Vector2()).y, fov = B.camera.fov;
  out.view = { H, fov: +fov.toFixed(2) };

  // ---- 2. SHAPE: winding, flat base, towers ----
  const P = cm.geometry.attributes.position.array, N = cm.geometry.attributes.normal.array, IX = cm.geometry.index.array;
  out.indexType = cm.geometry.index.array.constructor.name;
  const s = B.scene.children.find((o) => o.isGroup && o !== sky)?.scale.x || 1;
  const V = [];   // ring-frame vertices (recipe units)
  const M = cm.matrixWorld.elements;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    V.push([(M[0] * x + M[4] * y + M[8] * z + M[12]) / s, (M[1] * x + M[5] * y + M[9] * z + M[13]) / s, (M[2] * x + M[6] * y + M[10] * z + M[14]) / s]);
  }
  const NW = [];  // world normals (uniform scale: no renormalisation needed beyond the scale)
  for (let i = 0; i < N.length; i += 3) {
    const x = N[i], y = N[i + 1], z = N[i + 2];
    const nx = M[0] * x + M[4] * y + M[8] * z, ny = M[1] * x + M[5] * y + M[9] * z, nz = M[2] * x + M[6] * y + M[10] * z;
    const L = Math.hypot(nx, ny, nz) || 1; NW.push([nx / L, ny / L, nz / L]);
  }
  {
    let bad = 0, vol = 0, tris = 0;
    for (let t = 0; t < IX.length; t += 3) {
      const a = IX[t], b = IX[t + 1], c = IX[t + 2];
      const A = V[a], Bv = V[b], C = V[c];
      const e1 = [Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = [0, 1, 2].map((k) => NW[a][k] + NW[b][k] + NW[c][k]);
      if (fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] < 0) bad++;
      vol += A[0] * (Bv[1] * C[2] - Bv[2] * C[1]) - A[1] * (Bv[0] * C[2] - Bv[2] * C[0]) + A[2] * (Bv[0] * C[1] - Bv[1] * C[0]);
      tris++;
    }
    out.winding = { tris, bad, volume: vol / 6 };
  }
  // per bank (exact vertex ranges from sky.js): flat base share and the tower profile of the top edge
  const banks = I.list.map((B0) => {
    const pts = V.slice(B0.v0 || 0, (B0.v0 || 0) + (B0.vn || V.length));
    const H0 = B0.top - B0.base;
    const baseY = Math.min(...pts.map((q) => q[1]));
    const flat = pts.filter((q) => q[1] < baseY + SK.CLOUDS.VOXEL).length;
    const xs = pts.map((q) => Math.atan2(q[2], q[0]) * B0.r * Math.PI / 180);   // arc position
    // 40 slices across the bank's arc: fine enough to see single puffs (16 was coarser than the puffs themselves)
    const NB = 40, x0 = Math.min(...xs), x1 = Math.max(...xs), prof = new Array(NB).fill(-1e9);
    for (const q of pts) { const bi = Math.min(NB - 1, Math.max(0, Math.floor((Math.atan2(q[2], q[0]) * B0.r * Math.PI / 180 - x0) / Math.max(x1 - x0, 1) * NB))); prof[bi] = Math.max(prof[bi], (q[1] - B0.base) / Math.max(H0, 1)); }
    const top = Math.max(...prof), bot = Math.min(...prof.filter((v) => v > -1e8));
    // how uneven the top edge is: the turning points of the profile (a dome has 2; a heap of puffs has more) and its sd
    let turns = 0, prev = 0;
    const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
    const sd = Math.sqrt(prof.reduce((a, b) => a + (b - mean) ** 2, 0) / prof.length);
    for (let i = 1; i < prof.length; i++) {
      const d = prof[i] - prof[i - 1];
      if (Math.abs(d) < 0.02) continue;
      const s = Math.sign(d);
      if (prev && s !== prev) turns++;
      prev = s;
    }
    return { az: B0.az, H: Math.round(H0), verts: pts.length, flatShare: +(flat / Math.max(pts.length, 1)).toFixed(3),
             prof: prof.map((v) => +(v < -1e8 ? 0 : v).toFixed(2)), spread: +(top - bot).toFixed(2), turns: +turns.toFixed(0), sd: +sd.toFixed(3) };
  });
  out.banks = banks;
  out.twinN = V.length;
  // the skyline from the viewer's eye over all banks: 0.5 deg azimuth bins
  {
    const e = B.camera.position.toArray();
    const bins = new Map();
    for (const v of V) {
      const dx = v[0] - e[0] / s, dy = v[1] - e[1] / s, dz = v[2] - e[2] / s;
      const az = Math.round(Math.atan2(dz, dx) * 180 / Math.PI * 2) / 2, el = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
      bins.set(az, Math.max(bins.get(az) ?? -90, el));
    }
    const keys = [...bins.keys()].sort((a, b) => a - b), skyv = keys.map((k) => bins.get(k));
    const sm = skyv.map((v, i) => (skyv[Math.max(0, i - 1)] + v + skyv[Math.min(skyv.length - 1, i + 1)]) / 3);
    let peaks = 0; for (let i = 2; i < sm.length - 2; i++) if (sm[i] > sm[i - 2] + 0.15 && sm[i] > sm[i + 2] + 0.15) peaks++;
    // how many times the skyline turns over: a row of smooth domes has few, a puffy horizon has many
    let turns = 0, prev = 0;
    for (let i = 1; i < sm.length; i++) {
      const d = sm[i] - sm[i - 1];
      if (Math.abs(d) < 0.10) continue;
      const s = Math.sign(d);
      if (prev && s !== prev) turns++;
      prev = s;
    }
    const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
    out.skyline = { bins: keys.length, min: +Math.min(...sm).toFixed(2), max: +Math.max(...sm).toFixed(2), turns,
                    sd: +Math.sqrt(sm.reduce((a, b) => a + (b - mean) ** 2, 0) / sm.length).toFixed(2), peaks };
  }

  // ---- 3. PLACEMENT: the ring band from every eye, and what they stand behind ----
  const [y0, y1] = skyI.band, eye0 = SK.SKY_U.uRingEye.value;
  const eyes = [eye0.toArray()], rings = (B.info.keepOut?.rings || []);
  for (const [rr0, yy] of rings) for (let a = 0; a < 360; a += 15) eyes.push([Math.sin(a * Math.PI / 180) * rr0 / s, yy / s, Math.cos(a * Math.PI / 180) * rr0 / s]);
  const vt = { eyes: eyes.length, rings, tested: 0, outside: 0, hy: [1e9, -1e9], minR: 1e9, y: [1e9, -1e9] };
  for (const v of V) { vt.minR = Math.min(vt.minR, Math.hypot(v[0], v[2])); vt.y[0] = Math.min(vt.y[0], v[1]); vt.y[1] = Math.max(vt.y[1], v[1]); }
  for (const e of eyes) {
    const ev = new THREE.Vector3(...e);
    for (let i = 0; i < V.length; i += 2) {
      const d = [V[i][0] - e[0], V[i][1] - e[1], V[i][2] - e[2]], L = Math.hypot(...d);
      const hy = SK.ringHitYJS([d[0] / L, d[1] / L, d[2] / L], ev);
      vt.tested++; if (hy < y0 || hy > y1) vt.outside++;
      vt.hy[0] = Math.min(vt.hy[0], hy); vt.hy[1] = Math.max(vt.hy[1], hy);
    }
  }
  vt.share = vt.hy.map((h) => +((h - y0) / Math.max(y1 - y0, 1)).toFixed(3));
  out.verts = vt;
  out.band = [y0, y1];
  let treeR = 0; const sp = B.info.foliage?.species || {}, fol = B.foliage?.children || [];
  for (const m of fol) {
    const box = sp[m.userData.species]?.box, half = box ? Math.max(...[0, 2].flatMap((k) => [Math.abs(box.min[k]), Math.abs(box.max[k])])) : 1;
    m.userData.at.forEach((a, i) => { treeR = Math.max(treeR, Math.hypot(a[0], a[2]) + m.userData.scale[i] * half); });
  }
  let floorR = 0, floorN = 0;
  B.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !["grass", "sand", "shore"].includes(o.userData.kind)) return;
    floorN++;
    const Pa = o.geometry.attributes.position;
    for (let i = 0; i < Pa.count; i++) floorR = Math.max(floorR, Math.hypot(Pa.getX(i), Pa.getZ(i)));
  });
  out.behind = { trees: { r: Math.round(treeR), meshes: fol.length }, floor: { r: Math.round(floorR), meshes: floorN } };

  // ---- 4. PIXELS: clouds alone, 24 views ----
  const W2 = 480, H2 = 360, cam = new THREE.PerspectiveCamera(fov, W2 / H2, B.camera.near, B.camera.far);
  const tg = new THREE.WebGLRenderTarget(W2, H2, { type: THREE.FloatType, format: THREE.RGBAFormat });
  const mask = new Float32Array(W2 * H2 * 4);
  const cc = new THREE.Color(), ca = rr.getClearAlpha(); rr.getClearColor(cc);
  const others = B.scene.children.filter((o) => o !== cm && o.visible);
  const mk = { views: 0, W: W2, H: H2, pixels: 0, above: 0, below: 0, maxEl: -90, ringTopEl: 0 };
  const band = [[], [], [], [], [], []];      // colour by height share of each column's cloud (0 = base, 5 = top)
  const s8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const dirOf = (px, py, c2) => new THREE.Vector3((px + 0.5) / W2 * 2 - 1, (py + 0.5) / H2 * 2 - 1, 0.5).unproject(c2).sub(c2.position).normalize().toArray();
  const elOf = (d) => Math.asin(d[1]) * 180 / Math.PI;
  const Lv = S.U.uLightDir.value;
  const topEl = (d) => { const h = Math.hypot(d[0], d[2]); let lo = -1, hi = 3; for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi), q = [d[0] / h, m, d[2] / h], L2 = Math.hypot(...q); if (SK.ringHitYJS([q[0] / L2, q[1] / L2, q[2] / L2], eye0) < y1) lo = m; else hi = m; } return Math.atan(lo) * 180 / Math.PI; };
  for (const o of others) o.visible = false;
  for (let hd = 0; hd < 360; hd += 30) for (const pitch of [0, 15]) {
    const t = hd * Math.PI / 180, p = pitch * Math.PI / 180;
    cam.position.copy(B.camera.position);
    cam.lookAt(cam.position.x + Math.sin(t) * Math.cos(p), cam.position.y + Math.sin(p), cam.position.z + Math.cos(t) * Math.cos(p));
    cam.updateMatrixWorld();
    rr.setRenderTarget(tg); rr.setClearColor(0x000000, 0);
    rr.clear(); rr.render(B.scene, cam); rr.readRenderTargetPixels(tg, 0, 0, W2, H2, mask);
    rr.setRenderTarget(null);
    mk.views++;
    for (let px = 0; px < W2; px++) {
      // the buffer's row 0 is the BOTTOM of the screen, so the highest row index is the TOP of the cloud
      let lowRow = -1, highRow = -1;
      for (let py = 0; py < H2; py++) if (mask[(py * W2 + px) * 4 + 3] >= 0.5) { if (lowRow < 0) lowRow = py; highRow = py; }
      if (lowRow < 0) continue;
      for (let py = lowRow; py <= highRow; py++) {
        const k = (py * W2 + px) * 4;
        if (mask[k + 3] < 0.5) continue;
        mk.pixels++;
        const d = dirOf(px, py, cam), hy = SK.ringHitYJS(d, eye0);
        if (hy > y1) mk.above++; if (hy < y0) mk.below++;
        const el = elOf(d); if (el > mk.maxEl) { mk.maxEl = el; mk.ringTopEl = topEl(d); }
        const c8 = [s8(mask[k]), s8(mask[k + 1]), s8(mask[k + 2])];
        const v = (py - lowRow) / Math.max(highRow - lowRow, 1);          // 1 = top of the column's cloud
        band[Math.min(5, Math.floor(v * 6))].push(c8);
      }
    }
  }
  for (const o of others) o.visible = true;
  rr.setClearColor(cc, ca); tg.dispose();
  const avg = (list) => list.length ? [0, 1, 2].map((ch) => list.reduce((a, c) => a + c[ch], 0) / list.length) : [0, 0, 0];
  out.mask = mk;
  out.colour = {
    bands: band.map((b) => ({ n: b.length, luma: +lum(avg(b)).toFixed(1), rgb: avg(b).map((v) => Math.round(v)) })),
    top: avg(band[5]).map((v) => Math.round(v)), bottom: avg(band[0]).map((v) => Math.round(v)),
    mid: avg(band[2]).map((v) => Math.round(v)),
    lumaTop: +lum(avg(band[5])).toFixed(1), lumaBottom: +lum(avg(band[0])).toFixed(1),
    blueBottom: +(avg(band[0])[2] - avg(band[0])[0]).toFixed(1), blueTop: +(avg(band[5])[2] - avg(band[5])[0]).toFixed(1),
  };
  // 4c. THE SILVER LINING, measured as the light the RIM TERM ITSELF adds: render each view twice, with the rim's gain
  //     set to 0 and to its real value, and split the difference by whether the light is behind the bank. A lining is
  //     light added only toward the light, and it must be a lining, not a sheen.
  {
    const u = cm.material.uniforms, gain = u.uCloudC.value.y;
    const cg = new THREE.WebGLRenderTarget(W2, H2, { type: THREE.FloatType, format: THREE.RGBAFormat });
    const A = new Float32Array(W2 * H2 * 4), Bb = new Float32Array(W2 * H2 * 4);
    const side = { sun: { n: 0, sum: 0, peak: 0 }, away: { n: 0, sum: 0, peak: 0 } };
    const shoot = (buf) => {
      for (const o of others) o.visible = false;
      rr.setRenderTarget(cg); rr.setClearColor(0x000000, 0); rr.clear(); rr.render(B.scene, cam);
      rr.readRenderTargetPixels(cg, 0, 0, W2, H2, buf); rr.setRenderTarget(null);
      for (const o of others) o.visible = true;
    };
    for (let hd = 0; hd < 360; hd += 30) for (const pitch of [0, 15]) {
      const t = hd * Math.PI / 180, p = pitch * Math.PI / 180;
      cam.position.copy(B.camera.position);
      cam.lookAt(cam.position.x + Math.sin(t) * Math.cos(p), cam.position.y + Math.sin(p), cam.position.z + Math.cos(t) * Math.cos(p));
      cam.updateMatrixWorld();
      u.uCloudC.value.y = gain; shoot(A);
      u.uCloudC.value.y = 0; shoot(Bb);
      for (let py = 0; py < H2; py += 2) for (let px = 0; px < W2; px += 2) {
        const k = (py * W2 + px) * 4;
        if (A[k + 3] < 0.5) continue;
        const d = dirOf(px, py, cam), g = d[0] * Lv.x + d[1] * Lv.y + d[2] * Lv.z;
        // g > 0 = the view ray points TOWARD the light, so the bank in that pixel is BACKLIT (the sun behind it)
        const s = g > 0.25 ? side.sun : g < 0 ? side.away : null;
        if (!s) continue;
        const dl = lum([s8(A[k]), s8(A[k + 1]), s8(A[k + 2])]) - lum([s8(Bb[k]), s8(Bb[k + 1]), s8(Bb[k + 2])]);
        s.n++; s.sum += dl; s.peak = Math.max(s.peak, dl);
      }
    }
    u.uCloudC.value.y = gain;
    rr.setClearColor(cc, ca); cg.dispose();
    out.rim = {
      n: { sun: side.sun.n, away: side.away.n },
      mean: { sun: side.sun.n ? +(side.sun.sum / side.sun.n).toFixed(2) : null, away: side.away.n ? +(side.away.sum / side.away.n).toFixed(2) : null },
      peak: { sun: +side.sun.peak.toFixed(1), away: +side.away.peak.toFixed(1) },
    };
  }
  // 4b. COHESION: the silhouette is a few big billowy masses, not a field of drips. 4-connected components of the cloud
  //     mask, per view: how much of the cloud the biggest one carries, and how many specks there are.
  {
    const lab = new Int32Array(W2 * H2).fill(-1), stack = new Int32Array(W2 * H2);
    const cg = new THREE.WebGLRenderTarget(W2, H2, { type: THREE.FloatType, format: THREE.RGBAFormat });
    const cmask = new Float32Array(W2 * H2 * 4);
    let worstShare = 1, specks = 0, comps = 0, views = 0, biggest = 0;
    for (let hd = 0; hd < 360; hd += 30) for (const pitch of [0, 15]) {
      const t = hd * Math.PI / 180, p = pitch * Math.PI / 180;
      cam.position.copy(B.camera.position);
      cam.lookAt(cam.position.x + Math.sin(t) * Math.cos(p), cam.position.y + Math.sin(p), cam.position.z + Math.cos(t) * Math.cos(p));
      cam.updateMatrixWorld();
      for (const o of others) o.visible = false;
      rr.setRenderTarget(cg); rr.setClearColor(0x000000, 0); rr.clear(); rr.render(B.scene, cam);
      rr.readRenderTargetPixels(cg, 0, 0, W2, H2, cmask); rr.setRenderTarget(null);
      for (const o of others) o.visible = true;
      lab.fill(-1);
      const sizes = [];
      for (let i = 0; i < W2 * H2; i++) {
        if (cmask[i * 4 + 3] < 0.5 || lab[i] >= 0) continue;
        const id = sizes.length; let n = 0, sp = 0;
        stack[sp++] = i; lab[i] = id;
        while (sp) {
          const q = stack[--sp]; n++;
          const qx = q % W2, qy = (q - qx) / W2;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x2 = qx + dx, y2 = qy + dy;
            if (x2 < 0 || y2 < 0 || x2 >= W2 || y2 >= H2) continue;
            const j2 = y2 * W2 + x2;
            if (lab[j2] >= 0 || cmask[j2 * 4 + 3] < 0.5) continue;
            lab[j2] = id; stack[sp++] = j2;
          }
        }
        sizes.push(n);
      }
      const total = sizes.reduce((a, b) => a + b, 0);
      if (!total) continue;
      views++; comps += sizes.length;
      biggest = Math.max(biggest, Math.max(...sizes));
      worstShare = Math.min(worstShare, Math.max(...sizes) / total);
      specks += sizes.filter((n) => n < 300).length;
    }
    rr.setClearColor(cc, ca); cg.dispose();
    out.cohesion = { views, comps, specks, worstShare: +worstShare.toFixed(3), biggest };
  }

  // ---- 5. LIGHT: the material's uniforms are the shared ones; the rim term by a JS twin of the shader ----
  const u = cm.material.uniforms, U0 = S.U;
  out.sharedRefs = { dir: u.uLightDir === U0.uLightDir, colour: u.uLightColor === U0.uLightColor, ambient: u.uAmbient === U0.uAmbient,
                     sameLight: cm.material.uniforms.uLightColor.value === U0.uLightColor.value };
  const LOOK = SK.CLOUD_LOOK;
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = (a) => { const L = Math.hypot(...a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
  const eye = B.camera.position.toArray();
  const twin = { rimMax: 0, rimSumSun: 0, rimSumAway: 0, nSun: 0, nAway: 0, rimNonZeroAway: 0, litMax: 0, darkMin: 1e9 };
  for (let i = 0; i < V.length; i += 2) {
    const Vv = nrm([eye[0] / s - V[i][0], eye[1] / s - V[i][1], eye[2] / s - V[i][2]]);
    const Nv = NW[i];
    const back = Math.max(-dot3(Vv, [Lv.x, Lv.y, Lv.z]), 0);      // the light BEHIND the bank: forward scattering
    const fres = Math.pow(1 - Math.max(dot3(Nv, Vv), 0), LOOK.RIM_POW);
    const rim = fres * Math.pow(back, LOOK.RIM_BACK) * LOOK.RIM_GAIN;
    twin.rimMax = Math.max(twin.rimMax, rim);
    const front = dot3(Vv, [Lv.x, Lv.y, Lv.z]);
    if (back > 0.5) { twin.rimSumSun += rim; twin.nSun++; } else if (front >= 0) { twin.rimSumAway += rim; twin.nAway++; if (rim > 0) twin.rimNonZeroAway++; }
    // the lit term at this vertex, for the "rim is a lining, not a sheen" bound
    const h = cm.geometry.attributes.aCloud.array[i * 3], vis = cm.geometry.attributes.aCloud.array[i * 3 + 1];
    const wrap = Math.min(1, Math.max(0, (dot3(Nv, [Lv.x, Lv.y, Lv.z]) + LOOK.WRAP) / (1 + LOOK.WRAP)));
    const key = Math.pow(wrap, LOOK.KEY_POW) * (LOOK.BASE_K + (1 - LOOK.BASE_K) * Math.pow(h, LOOK.HEIGHT_POW)) * (LOOK.VIS_FLOOR + (1 - LOOK.VIS_FLOOR) * vis);
    twin.litMax = Math.max(twin.litMax, key);
    twin.darkMin = Math.min(twin.darkMin, key);
  }
  twin.rimMeanSun = twin.nSun ? twin.rimSumSun / twin.nSun : 0;
  twin.rimMeanAway = twin.nAway ? twin.rimSumAway / twin.nAway : 0;
  out.twin = twin;

  // ---- 6. COST ----
  const gl = rr.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(10);
  const shown = time(FRAMES), shownCalls = B.info.calls;
  cm.visible = false; const hidden = time(FRAMES), hiddenCalls = B.info.calls;
  cm.visible = true;
  out.frame = { shown, hidden, calls: shownCalls, hiddenCalls, frames: FRAMES };
  out.programs = { count: rr.info.programs.length, failed: rr.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  out.day = { light: U0.uLightColor.value.toArray().map((v) => +v.toFixed(3)), dir: [Lv.x, Lv.y, Lv.z].map((v) => +v.toFixed(3)),
              sunDot: +(Lv.x * U0.uSunDir.value.x + Lv.y * U0.uSunDir.value.y + Lv.z * U0.uSunDir.value.z).toFixed(4) };
  out.dayPixels = { luma: +lum(avg(band.flat())).toFixed(1) };

  // ---- 7. the viewer's switch and the forced night ----
  const before = { visible: cm.visible };
  window.__layers.set("clouds", false);
  const off = { visible: cm.visible, drawn: (() => { B.render(camInfo); return B.info.calls; })() };
  window.__layers.set("clouds", true);
  B.render(camInfo);
  const on = { visible: cm.visible, drawn: B.info.calls };
  out.layer = { before, off, on };
  return out;
}, { FRAMES });

// night, on the same page: forced through the viewer's own switch, then back to auto
const NI = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const SK = await import("./built/sky.js");
  const S = await import("./built/shared.js");
  const B = window.__built, rr = B.renderer, out = {};
  const s8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const shoot = () => {
    const cm = B.scene.getObjectByName("builtClouds");
    const others = B.scene.children.filter((o) => o !== cm && o.visible);
    for (const o of others) o.visible = false;
    const W2 = 240, H2 = 180, cam = new THREE.PerspectiveCamera(B.camera.fov, 1.333, B.camera.near, B.camera.far);
    cam.position.copy(B.camera.position); cam.quaternion.copy(B.camera.quaternion); cam.updateMatrixWorld();
    const tg = new THREE.WebGLRenderTarget(W2, H2, { type: THREE.FloatType, format: THREE.RGBAFormat });
    const buf = new Float32Array(W2 * H2 * 4), cc = new THREE.Color(), ca = rr.getClearAlpha();
    rr.getClearColor(cc); rr.setRenderTarget(tg); rr.setClearColor(0x000000, 0); rr.clear();
    rr.render(B.scene, cam); rr.readRenderTargetPixels(tg, 0, 0, W2, H2, buf); rr.setRenderTarget(null); rr.setClearColor(cc, ca);
    tg.dispose();
    for (const o of others) o.visible = true;
    const cols = [];
    for (let i = 0; i < buf.length; i += 4) if (buf[i + 3] >= 0.5) cols.push([s8(buf[i]), s8(buf[i + 1]), s8(buf[i + 2])]);
    const mean = cols.length ? [0, 1, 2].map((k) => cols.reduce((a, c) => a + c[k], 0) / cols.length) : [0, 0, 0];
    return { n: cols.length, rgb: mean.map((v) => Math.round(v)), luma: +lum(mean).toFixed(1) };
  };
  out.day = shoot();
  out.nightMode = window.__layers.setSkyMode("night");
  const cm = B.scene.getObjectByName("builtClouds"), U0 = S.U;
  const moon = SK.SKY_U.uMoonDir.value.clone().normalize(), sun = U0.uSunDir.value.clone().normalize(), g = U0.uLightDir.value.clone().normalize();
  out.night = { ...shoot(), mode: window.__built.shared.light.mode, key: U0.uLightColor.value.toArray().map((v) => +v.toFixed(3)),
                toMoon: +g.dot(moon).toFixed(4), toSun: +g.dot(sun).toFixed(4),
                shared: cm.material.uniforms.uLightDir === U0.uLightDir && cm.material.uniforms.uLightColor === U0.uLightColor };
  out.auto = window.__layers.setSkyMode("auto");
  const g2 = U0.uLightDir.value.clone().normalize();
  out.autoLit = { ...shoot(), mode: window.__built.shared.light.mode, toSun: +g2.dot(sun).toFixed(4), toMoon: +g2.dot(moon).toFixed(4) };
  out.domes = B.scene.children.filter((o) => o.name === "builtSky").length;
  out.cloudMeshes = B.scene.children.filter((o) => o.name === "builtClouds").length;
  out.failed = rr.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
  return out;
});
await browser.close().catch(() => {});

// ---------------- report ----------------
if (R.missing) { console.log(`FAIL no "builtClouds" mesh in the scene`); process.exit(1); }
const I = R.info, K = R.colour, TW = R.twin;
console.log(`     (info) ${ARENA}: ${I.banks} banks, ${I.lobes} lobes, ${I.triangles} triangles, ${I.vertices} vertices, baked in ${I.bakedMs} ms; tones lit ${I.tones.lit} shade ${I.tones.shade} deep ${I.tones.deep}; index ${R.indexType}`);
console.log(`     (info) view H ${R.view.H} fov ${R.view.fov}; measured ring band y ${R.band.join("..")}; every vertex ray hits it at ${R.verts.hy.map(Math.round).join("..")} (share ${R.verts.share.join("..")}), from ${R.verts.eyes} eyes (rings ${JSON.stringify(R.verts.rings)})`);
// the triangle range is the bake resolution's bound, not the cost bound: the cost is the frame-time check below
check(R.cloudMeshes === 1 && I.banks >= 6 && I.banks <= 10 && I.triangles >= 40000 && I.triangles <= 220000 && R.children === 0,
  `structure: ${R.cloudMeshes} mesh "builtClouds" of ${I.banks} banks and ${I.triangles} triangles (40k-220k), ${I.lobes} lobes in ONE opaque pass (${R.children} child objects: no sprite skirt, no alpha blend)`);
check(R.winding.bad <= R.winding.tris * 0.005 && R.winding.volume > 0,
  `the surface is not inside out: ${R.winding.bad} of ${R.winding.tris} triangles disagree with their field-gradient normals (<= 0.5%), signed volume ${R.winding.volume.toExponential(2)} (> 0)`);
const flatWorst = Math.min(...R.banks.map((b) => b.flatShare));
check(flatWorst >= 0.05, `flat base: the emptiest bank still has ${(flatWorst * 100).toFixed(1)}% of its vertices within one bake cell of its base plane (>= 5%) — tops ${R.banks.map((b) => b.prof[20].toFixed(1)).join(" ")}`);
const turnsWorst = Math.min(...R.banks.map((b) => b.turns)), sdWorst = Math.min(...R.banks.map((b) => b.sd));
check(sdWorst >= 0.08,
  `soft puffy tops, not a flat loaf: over 40 slices of its width every bank's top edge varies with sd >= 0.08 of its height (worst ${sdWorst}, ${turnsWorst} turns in the flattest)`);
// the skyline is measured by how far it wanders (sd), how far up and down it goes (spread) and how often it turns over:
// a row of smooth domes turns a handful of times, a bank of puffs turns dozens of times
check(R.skyline.sd >= 2 && R.skyline.max - R.skyline.min >= 8 && R.skyline.turns >= 10,
  `a puffy, uneven skyline seen from the eye, not a row of domes: ${R.skyline.bins} azimuth bins (0.5 deg) of elevation ${R.skyline.min}..${R.skyline.max} deg (spread >= 8), sd ${R.skyline.sd} deg (> 2), the line turns over ${R.skyline.turns} times (>= 10), ${R.skyline.peaks} local maxima`);
check(R.verts.outside === 0 && R.verts.eyes >= 40,
  `every vertex inside the ring's measured band seen from ${R.verts.eyes} eyes: ${R.verts.tested} vertex rays, ${R.verts.outside} outside; ring height hit ${R.verts.hy.map(Math.round).join("..")} (band share ${R.verts.share.join("..")}), cloud y ${R.verts.y.map(Math.round).join("..")}, r ${Math.round(R.verts.minR)}..`);
check(R.verts.minR > Math.max(R.behind.trees.r, R.behind.floor.r),
  `clouds beyond everything on the ground: nearest cloud vertex r ${Math.round(R.verts.minR)} vs the farthest tree/bush crown r ${R.behind.trees.r} (${R.behind.trees.meshes} meshes) and the arena floor r ${R.behind.floor.r} (${R.behind.floor.meshes} meshes)`);
check(R.mask.pixels > 100000 && R.mask.above === 0 && R.mask.below === 0,
  `no cloud above the band (GPU pixels): ${R.mask.views} views ${R.mask.W}x${R.mask.H}, ${R.mask.pixels} cloud pixels, ${R.mask.above} above the ring top, ${R.mask.below} below its foot; the highest cloud pixel is at ${R.mask.maxEl.toFixed(2)} deg vs the ring top's ${R.mask.ringTopEl.toFixed(2)} deg in that column`);
const litTarget = I.tones.lit, topErr = Math.max(...K.top.map((v, k) => Math.abs(v - litTarget[k])));
check(K.lumaTop - K.lumaBottom > 25 && K.blueBottom >= 15 && topErr <= 20,
  `bright white tops, blue-violet bases: the top sixth of the clouds reads ${K.top} (luma ${K.lumaTop}) vs the measured cloud white ${litTarget} (max channel error ${topErr.toFixed(1)} <= 20); the bottom sixth reads ${K.bottom} (luma ${K.lumaBottom}, blue minus red ${K.blueBottom} >= 15); the drop over the column is ${(K.lumaTop - K.lumaBottom).toFixed(1)}/255 (> 25)`);
// the measured cloud white is itself slightly blue (its own blue-red is 15/255), so "the tops are not tinted" means
// within 5/255 of the measurement they are held to, not "below 15"
const blueWhite = Math.max(15, K.top[2] - K.top[0]) + 5;
check(K.blueTop <= blueWhite && K.bands[3].luma < K.bands[5].luma && K.bands[1].luma < K.bands[3].luma,
  `a smooth vertical ramp, not two flat tones: bands base->top ${K.bands.map((b) => `${b.luma}`).join(" < ")} luma (monotone up), blue-red ${K.bands.map((b) => `${b.rgb[2] - b.rgb[0]}`).join(" ")} (the top within ${blueWhite} of the measured white's own blue-red)`);
check(R.rim.n.sun > 2000 && R.rim.n.away > 2000 && R.rim.mean.sun > 1 && R.rim.mean.away < 0.05 && R.rim.peak.away < 0.05,
  `the silver lining is on the backlit side only: the rim term adds ${R.rim.mean.sun}/255 on average (peak ${R.rim.peak.sun}) to the ${R.rim.n.sun} cloud pixels where the light is BEHIND the bank, and ${R.rim.mean.away}/255 (peak ${R.rim.peak.away}) where it is in front — measured by rendering the same views with the term's gain at 0 and at its real value`);
const CO = R.cohesion;
check(CO.specks <= CO.views * 2 && CO.comps <= CO.views * 5 && CO.worstShare >= 0.30,
  `cohesive billows, not drips: over ${CO.views} views a biggest single silhouette mass carries ${(CO.worstShare * 100).toFixed(0)}% of the cloud pixels at worst (>= 40%), ${CO.comps} components in all, ${CO.specks} specks under 300 px (<= ${CO.views * 2}), biggest ${CO.biggest} px`);
check(R.sharedRefs.dir && R.sharedRefs.colour && R.sharedRefs.ambient,
  `the banks read the SHARED light (same uniform objects: dir ${R.sharedRefs.dir}, colour ${R.sharedRefs.colour}, ambient ${R.sharedRefs.ambient}); day key ${JSON.stringify(R.day.light)} along the sun (dot ${R.day.sunDot})`);
check(TW.rimNonZeroAway === 0 && TW.rimMeanSun > 1e-4 && TW.rimMax < 0.35,
  `rim term (JS twin of the shader, over ${R.twinN} vertices): exactly 0 on the ${TW.nAway} vertices we do not look at against the light, mean ${TW.rimMeanSun.toFixed(4)} on the ${TW.nSun} we do, peak ${TW.rimMax.toFixed(3)} of the albedo (< 0.35: a lining, not a sheen)`);
check(R.frame.shown - R.frame.hidden <= 1,
  `cost: ${R.frame.shown.toFixed(3)} ms shown vs ${R.frame.hidden.toFixed(3)} ms hidden over ${R.frame.frames} frames = ${(R.frame.shown - R.frame.hidden).toFixed(3)} ms for the clouds (<= 1 ms)`);
check(R.frame.calls - R.frame.hiddenCalls === 1,
  `one draw call with the clouds on (${R.frame.calls}) and ${R.frame.hiddenCalls} with them off: the banks are ONE opaque mesh`);
check(R.layer.off.visible === false && R.layer.on.visible === true && R.layer.off.drawn === R.frame.hiddenCalls && R.layer.on.drawn === R.frame.calls,
  `the viewer's "3D clouds" switch hides them: drawn calls ${R.layer.on.drawn} -> ${R.layer.off.drawn} (hidden by the frame loop ${R.frame.hiddenCalls}), mesh visible ${R.layer.on.visible} -> ${R.layer.off.visible}`);
check(NI.night.mode === "night" && NI.night.toMoon > 0.9999 && NI.night.shared && NI.night.luma < NI.day.luma * 0.8 && (NI.night.rgb[2] / Math.max(NI.night.rgb[0], 1)) > (NI.day.rgb[2] / Math.max(NI.day.rgb[0], 1)),
  `night: the same banks are lit from the MOON (light . moon ${NI.night.toMoon}), key ${JSON.stringify(NI.night.key)}; the pixels go ${NI.day.rgb} (luma ${NI.day.luma}) -> ${NI.night.rgb} (luma ${NI.night.luma}), cooler (blue/red ${(NI.day.rgb[2] / Math.max(NI.day.rgb[0], 1)).toFixed(2)} -> ${(NI.night.rgb[2] / Math.max(NI.night.rgb[0], 1)).toFixed(2)})`);
check(NI.auto?.mode === "day" && NI.autoLit.toSun > 0.9999 && NI.domes === 1 && NI.cloudMeshes === 1 && NI.failed === 0,
  `back to auto: the sky says ${NI.auto?.mode}, the banks are lit by the SUN again (light . sun ${NI.autoLit.toSun}), ${NI.domes} dome, ${NI.cloudMeshes} cloud mesh, ${NI.failed} programs failed`);
check(R.programs.failed === 0 && errors.length === 0, `shader programs compile (${R.programs.count}, ${R.programs.failed} failed) and the page throws nothing (${errors.length})`);
for (const e of errors) console.log("   error:", e);
console.log(`     (info) ${ARENA}: ${fails} FAIL`);
process.exit(fails);
