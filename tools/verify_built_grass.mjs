// Numbers check of the BUILT arena's grass blades (web/built/grass.js, plan Step 2, al-ro style; no pictures):
//  - the blades stand on whatever the arena's recipe gave them: a ground.js "grass" mesh (forest) or a sand.js
//    "shore" band (beach). Which one is read from the blade mesh's own tris, and the two checks that only make sense
//    on painted ground (the ground mask, the pattern albedo) are replaced by the beach's own measured rule (the
//    shore's aGreen gate, the bladeColours band) instead of being run against nothing.
//  - page and shader errors; programs compile
//  - blade count (>= 100000), 9 vertices / 7 triangles per blade, total triangles
//  - every blade on its ground triangle: base (instanceMatrix x world) vs the triangle's plane and inside it, and an
//    independent ray down onto the ground meshes (<= 1e-3 units)
//  - every blade on GRASS paint: the ground material's own mask texture read on the GPU at each base (dirt, rock,
//    path < 0.5) and the triangle's slope under the ground's cliff threshold
//  - GPU probe through the material's own grassWorldPos(): base vertices stay on the ground with the wind on; tip
//    move as a share of blade height; the 3D shape (twist of the width direction root -> top row, forward curl); the
//    tips' wind moves follow the rolling wave (correlation with a JS twin of grassWave() and the flutter)
//  - height rule under the fighters, over 5 frames of the orbiting idle camera: every blade whose base is inside a
//    fighter's box footprint, projected with the battle renderer's own matrix, is <= 3 % of that fighter's on-screen
//    height (fighter box from the battle renderer, its 8 corners projected)
//  - root colour = the ground material's own albedo at the root (GPU ground pattern x the mask's AO vs the baked root)
//  - grass draw calls (<= 4); the shared uniform object is the same reference; frame time at 960x720 over 600 frames:
//    blades shown vs hidden, and blades + ground shown vs both hidden (budget 2.5 ms for the pair); GPU timer query
//    too when the backend offers EXT_disjoint_timer_query_webgl2
//   VERIFY_PORT=8090 [ARENA=meft1013] tools/run-playwright.sh tools/verify_built_grass.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1013";
const BUDGET = 2.5;   // ms, blades + ground (task)
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 60000 }).catch(() => {});
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

// shared page-side helpers: a points pass into a float target, and the GPU probe of every blade vertex
await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js"), G = await import("./built/grass.js");
  const B = window.__built, R = B.renderer;
  const mesh = B.scene.getObjectByName("grass_blades");
  const pointsPass = (obj, W, H) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const sc = new THREE.Scene(); obj.frustumCulled = false; sc.add(obj);
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
    const px = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px); R.setRenderTarget(prev); rt.dispose();
    return px;
  };
  const ROW = 1000;
  // every vertex of every blade through the SAME grassWorldPos with the grass material's own uniform objects and
  // the mesh's own per-blade attributes
  const probe = () => {
    const nv = mesh.geometry.attributes.position.count, ni = mesh.count, rows = Math.ceil(ni / ROW);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", mesh.geometry.attributes.position);
    g.setAttribute("instanceMatrix", new THREE.InstancedBufferAttribute(mesh.instanceMatrix.array.slice(0, ni * 16), 16));
    for (const [k, a] of Object.entries(mesh.geometry.attributes)) if (a.isInstancedBufferAttribute) g.setAttribute(k, a);
    g.instanceCount = ni;
    const mat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, mesh.material.uniforms, { uNV: { value: nv }, uRows: { value: rows } }),
      vertexShader: `attribute mat4 instanceMatrix; uniform float uNV, uRows; varying vec3 vP;
        ${S.NOISE_GLSL}
        ${S.WIND_GLSL}
        ${G.GRASS_GLSL}
        void main(){ vP = grassWorldPos(position, instanceMatrix); gl_PointSize = 1.0;
          float i = float(gl_InstanceID), col = mod(i, ${ROW}.0) * uNV + float(gl_VertexID), row = floor(i / ${ROW}.0);
          gl_Position = vec4((col + 0.5) / (${ROW}.0 * uNV) * 2.0 - 1.0, (row + 0.5) / uRows * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){ gl_FragColor = vec4(vP, 1.0); }` });
    const pts = new THREE.Points(g, mat); pts.matrixAutoUpdate = false; pts.matrix.copy(mesh.matrixWorld); pts.matrixWorld.copy(mesh.matrixWorld);
    const px = pointsPass(pts, ROW * nv, rows); mat.dispose(); g.dispose();
    return (i, j) => { const o = ((Math.floor(i / ROW)) * ROW * nv + (i % ROW) * nv + j) * 4; return [px[o], px[o + 1], px[o + 2]]; };
  };
  window.__gp = { THREE, S, G, B, R, mesh, probe, pointsPass, ROW,
    sameFn: mesh.material.vertexShader.includes("grassWorldPosN(position, instanceMatrix") && mesh.material.vertexShader.includes(G.GRASS_GLSL) };
});

// ---- height rule under the fighters, 5 frames of the orbiting camera ----
const frames = [];
for (let k = 0; k < 5; k++) {
  await page.waitForTimeout(1200);
  frames.push(await page.evaluate(() => {
    const { THREE, B, mesh, probe } = window.__gp, r = window.__r;
    r.render(0); const cam = r.getCameraInfo().render; B.render(cam);   // one fresh frame, both canvases
    const at = probe();
    const bpv = new THREE.Matrix4().fromArray(r.getViewProjection());   // the battle renderer's own matrix
    const H = window.__off.height, v = new THREE.Vector3();
    const nv = mesh.geometry.attributes.position.count, M = new THREE.Matrix4();
    const out = { arenaScale: cam.arenaScale ?? 1, eye: cam.eye.map(Math.round), fighters: [] };
    for (const side of ["player", "enemy"]) {
      const b = r.getFighterBounds(side); if (!b) continue;
      let y0 = Infinity, y1 = -Infinity;
      for (let c = 0; c < 8; c++) { v.set(c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]).applyMatrix4(bpv); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      const fpx = (y1 - y0) * H / 2;
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, foot = Math.hypot(b.size[0] / 2, b.size[2] / 2);
      let n = 0, worst = 0, worstH = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, M); M.premultiply(mesh.matrixWorld);
        const bx = M.elements[12], bz = M.elements[14];
        if (Math.hypot(bx - cx, bz - cz) > foot) continue;
        n++;
        let a0 = Infinity, a1 = -Infinity, hw = 0;
        for (let j = 0; j < nv; j++) { const p = at(i, j); v.set(...p).applyMatrix4(bpv); a0 = Math.min(a0, v.y); a1 = Math.max(a1, v.y); hw = Math.max(hw, p[1] - M.elements[13]); }
        const ratio = (a1 - a0) * H / 2 / fpx;
        if (ratio > worst) worst = ratio; worstH = Math.max(worstH, hw);
      }
      out.fighters.push({ side, heightWorld: +b.size[1].toFixed(0), foot: Math.round(foot), r: Math.round(Math.hypot(cx, cz)), px: +fpx.toFixed(1), blades: n, worst, worstH: +worstH.toFixed(2) });
    }
    out.state = mesh.userData.state.fighters.map((f) => ({ side: f.side, cap: +f.cap.toFixed(2) }));
    return out;
  }));
}

// ---- static numbers ----
const res = await page.evaluate(async () => {
  const { THREE, S, G, B, R, mesh, probe, pointsPass, sameFn, ROW } = window.__gp;
  const out = { info: B.info.grass, sameFn };
  out.count = mesh.count; out.trisPerBlade = mesh.geometry.index.count / 3; out.vertsPerBlade = mesh.geometry.attributes.position.count;
  // 1. on the ground triangle (plane + inside), and an independent ray down onto the ground meshes
  const { triOf, tris } = mesh.userData, M = new THREE.Matrix4(), ray = new THREE.Raycaster();
  // the surfaces the blades actually stand on: the mesh names in the blade mesh's own tris (a forest's ground.js
  // "grass" mesh, a beach's sand.js "shore" band) — not a kind guess, which finds nothing on a beach
  const groundNames = new Set(tris.map((t) => t.mesh));
  const grounds = []; B.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && groundNames.has(o.name)) grounds.push(o); });
  out.grounds = { names: [...groundNames], kinds: grounds.map((o) => o.userData.kind), n: grounds.length };
  if (!grounds.length) return { ...out, noGround: true };
  let plane = 0, outside = 0, rayErr = 0, noHit = 0;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const base = new Float32Array(mesh.count * 3);
  let bMinR = Infinity, bMaxR = 0;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, M); M.premultiply(mesh.matrixWorld);
    const p = [M.elements[12], M.elements[13], M.elements[14]], t = tris[triOf[i]];
    base.set(p, i * 3);
    const br = Math.hypot(p[0], p[2]); bMinR = Math.min(bMinR, br); bMaxR = Math.max(bMaxR, br);
    plane = Math.max(plane, Math.abs(dot(sub(p, t.a), t.n)));
    // barycentric of p in the triangle (projected on its plane)
    const v0 = sub(t.b, t.a), v1 = sub(t.c, t.a), v2 = sub(p, t.a);
    const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01;
    const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bu = 1 - bv - bw;
    const L = Math.sqrt(Math.max(d00, d11));
    if (Math.min(bu, bv, bw) * L < -1e-3) outside++;
    if (i % 10) continue;   // the raycast on every 10th blade (13k rays): the plane test above covers all of them
    ray.set(new THREE.Vector3(p[0], 1e5, p[2]), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(grounds, false);
    if (!hits.length) { noHit++; continue; }
    rayErr = Math.max(rayErr, Math.min(...hits.map((h) => Math.abs(h.point.y - p[1]))));
  }
  out.onGround = { plane, outside, rayErr, noHit, grounds: grounds.length, rays: Math.ceil(mesh.count / 10) };
  out.bladeR = { min: Math.round(bMinR), max: Math.round(bMaxR) };
  out.params = { COUNT: G.GRASS.COUNT, MIN_COUNT: G.GRASS.MIN_COUNT, DENSITY: G.GRASS.DENSITY, GREEN_MIN: G.GRASS.GREEN_MIN };
  // 1b. on GRASS paint: the ground's own mask texture on the GPU at every base, and the slope under the cliff band
  //     (a shore band has no mask: grass.js gates the blade on the shore's own measured green share instead)
  const gm = grounds[0].material;
  const masked = !!gm.uniforms?.uMask;
  out.masked = masked;
  const pidOf = (n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
  const basePass = (fs, uniforms) => {
    const n = mesh.count, rows = Math.ceil(n / ROW);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(base, 3)); g.setAttribute("pid", new THREE.BufferAttribute(pidOf(n), 1));
    const mat = new THREE.ShaderMaterial({ uniforms,
      vertexShader: `attribute float pid; varying vec3 vP; void main(){ vP = position; gl_PointSize = 1.0;
        gl_Position = vec4((mod(pid, ${ROW}.0) + 0.5) / ${ROW / 2}.0 - 1.0, (floor(pid / ${ROW}.0) + 0.5) / ${rows}.0 * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: fs });
    const px = pointsPass(new THREE.Points(g, mat), ROW, rows); mat.dispose(); g.dispose();
    return px;
  };
  if (masked) {
    const px = basePass(`uniform sampler2D uMask; uniform float uMaskSpan; varying vec3 vP;
      void main(){ gl_FragColor = texture2D(uMask, vP.xz / uMaskSpan + 0.5); }`, { uMask: gm.uniforms.uMask, uMaskSpan: gm.uniforms.uMaskSpan });
    let worst = 0, over = 0, slope = 0;
    for (let i = 0; i < mesh.count; i++) {
      const m = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); worst = Math.max(worst, m); if (m >= 0.5) over++;
      slope = Math.max(slope, 1 - tris[triOf[i]].n[1]);
    }
    out.paint = { masked, worst, over, slope, cliffLo: gm.uniforms.uCliffLo?.value, hasMask: true, maskedFlag: B.info.grass.masked };
  } else {
    // the shore's own rule: grass.js keeps a blade only where the shore's measured green share (aGreen, the piece's
    // picture rows) at its barycentric point is above GREEN_MIN, so every blade's own share must clear that gate
    const bary = mesh.userData.bary, gate = G.GRASS.GREEN_MIN, full = G.GRASS.GREEN_FULL;
    let min = Infinity, over = 0, greenTris = 0;
    for (let i = 0; i < mesh.count; i++) {
      const t = tris[triOf[i]];
      const g = t.green ? bary[i * 3] * t.green[0] + bary[i * 3 + 1] * t.green[1] + bary[i * 3 + 2] * t.green[2] : 0;
      if (g < min) min = g;
      if (g <= gate) over++;
    }
    for (const t of tris) if (t.green) greenTris++;
    out.paint = { masked, greenMin: min, over, gate, full, n: mesh.count, greenTris, tris: tris.length,
                  slope: Math.max(...tris.map((t) => 1 - t.n[1])), hasMask: false, maskedFlag: B.info.grass.masked };
  }
  // 2. GPU probe with the wind on: base vertices (y = 0) stay at the instance base; tip move share of height; shape
  const U = S.U, keepT = U.uWindTime.value, keepS = U.uWindStrength.value;
  const pos = mesh.geometry.attributes.position, baseJ = [], tipJ = [];
  for (let j = 0; j < pos.count; j++) { if (pos.getY(j) === 0) baseJ.push(j); if (pos.getY(j) === 1) tipJ.push(j); }
  const topRow = [pos.count - 3, pos.count - 2];   // the last pair below the tip
  U.uWindStrength.value = 0; const still = probe();
  U.uWindStrength.value = keepS;
  // shape, wind off: twist = angle between the root's and the top row's width direction (xz); curl = tip offset / height
  {
    const tw = [], cu = [];
    for (let i = 0; i < mesh.count; i += 7) {
      const T = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
      const a0 = still(i, baseJ[0]), a1 = still(i, baseJ[1]), b0 = still(i, topRow[0]), b1 = still(i, topRow[1]), tp = still(i, tipJ[0]);
      const u = [a1[0] - a0[0], a1[2] - a0[2]], w = [b1[0] - b0[0], b1[2] - b0[2]];
      const lu = Math.hypot(...u), lw = Math.hypot(...w); if (lu < 1e-4 || lw < 1e-4) continue;
      tw.push(Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / lu / lw))));
      const hgt = tp[1] - T[1]; if (hgt > 1) cu.push(Math.hypot(tp[0] - T[0], tp[2] - T[2]) / hgt);
    }
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
    out.shape = { twistMed: med(tw), twistMin: Math.min(...tw), curlMed: med(cu), n: tw.length };
  }
  let baseErr = 0, tipShare = 0, moved = 0;
  // JS twin of grassWave() + the flutter, to see that the tips move with the rolling wave
  const wd = U.uWindDir.value, MU = mesh.material.uniforms, wl = MU.uGrassWave.value, sp = MU.uGrassWaveSpeed.value, fl = MU.uGrassFlutter.value.valueOf();
  const d2 = [wd.x * 0.819 - wd.y * 0.574, wd.x * 0.574 + wd.y * 0.819], bl = mesh.geometry.attributes.aBlade;
  const waveJS = (x, z, t) => { const w1 = Math.sin((x * wd.x + z * wd.y) * 2 * Math.PI / wl.x - t * sp.x), w2 = Math.sin((x * d2[0] + z * d2[1]) * 2 * Math.PI / wl.y - t * sp.y); const w = 0.5 + 0.5 * (0.65 * w1 + 0.35 * w2); return w * w; };
  const corr = [];
  for (let k = 0; k < 6; k++) {
    const t = 3 + k * 0.7; U.uWindTime.value = t; const at = probe();
    const xs = [], ys = [];
    for (let i = 0; i < mesh.count; i++) {
      const T = [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
      const p0 = still(i, tipJ[0]), hgt = p0[1] - T[1];
      for (const j of baseJ) { const q = at(i, j), q0 = still(i, j); baseErr = Math.max(baseErr, Math.abs(q[1] - T[1]), Math.hypot(q[0] - q0[0], q[1] - q0[1], q[2] - q0[2])); }
      if (hgt > 1) {
        const q = at(i, tipJ[0]), d = Math.hypot(q[0] - p0[0], q[2] - p0[2]); tipShare = Math.max(tipShare, d / hgt); if (d > 1e-3) moved++;
        if (i % 5 === 0) {
          const c = bl.getX(i), Hh = hgt * c / Math.sin(c);   // arc length = the blade's (capped) height
          const amp = 0.25 + 0.75 * waveJS(mesh.instanceMatrix.array[i * 16 + 12], mesh.instanceMatrix.array[i * 16 + 14], t) + fl * Math.sin(t * U.uWindFreq.value * 3 + bl.getZ(i));
          xs.push(amp * Hh); ys.push(d);
        }
      }
    }
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    corr.push(sxy / Math.sqrt(sxx * syy));
  }
  U.uWindTime.value = keepT;
  out.wind = { baseErr, tipShare, moved: moved / 6, strength: keepS, corrMin: Math.min(...corr) };
  // 3. root colour vs the ground material's own albedo there (GPU: same pattern GLSL and scale x the mask's AO);
  //    on a shore there is no pattern: the root must be the shore's own measured band colour at that triangle
  {
    const root = mesh.geometry.attributes.aRoot;
    if (masked) {
      const px = basePass(`uniform vec3 uA, uB; uniform float uScale, uAOAmt, uMaskSpan; uniform sampler2D uMask; varying vec3 vP; ${S.NOISE_GLSL}
          void main(){ vec3 c = mix(uA, uB, smoothstep(0.35, 0.65, fbm3(vP * uScale)));
            gl_FragColor = vec4(c * mix(1.0, texture2D(uMask, vP.xz / uMaskSpan + 0.5).a, uAOAmt), 1.0); }`,
        S.uniformsWith({ uA: gm.uniforms.uA, uB: gm.uniforms.uB, uScale: gm.uniforms.uScale, uAOAmt: gm.uniforms.uAOAmt,
                         uMask: gm.uniforms.uMask, uMaskSpan: gm.uniforms.uMaskSpan }));
      let err = 0; for (let i = 0; i < mesh.count; i++) for (let c = 0; c < 3; c++) err = Math.max(err, Math.abs(px[i * 4 + c] - root.array[i * 3 + c]));
      out.colour = { masked, err, n: mesh.count, sameGroundPiece: grounds.length === 1, aoAmt: gm.uniforms.uAOAmt?.value };
    } else {
      // sand.js sets the shore mesh's bladeColours (its measured p10/p90); grass.js mixes the triangle's own lo..hi
      // with a per-blade draw, so every root must lie inside the measured band of the shore row it grows from
      let exc = 0, n = 0;
      for (let i = 0; i < mesh.count; i++) {
        const t = tris[triOf[i]], lo = [t.lo.r, t.lo.g, t.lo.b], hi = [t.hi.r, t.hi.g, t.hi.b];
        for (let c = 0; c < 3; c++) { const v = root.array[i * 3 + c]; exc = Math.max(exc, Math.max(0, lo[c] - v, v - hi[c])); }
        n++;
      }
      out.colour = { masked, exc, n, sameGroundPiece: grounds.length === 1, bands: [...new Set(tris.map((t) => t.lo.getHexString()))].length };
    }
  }
  // 4. shared uniform object
  let bad = 0; for (const k of Object.keys(S.U)) if (mesh.material.uniforms[k] !== S.U[k]) bad++;
  out.uniforms = { bad, keys: Object.keys(S.U).length, sameModule: B.shared.U === S.U, inList: B.materials.includes(mesh.material) };
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  out.material = { transparent: mesh.material.transparent, castShadow: mesh.castShadow };
  // 5. grass draw calls: everything else hidden
  const cam = window.__r.getCameraInfo().render, hide = [];
  B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== mesh && o.visible) { hide.push(o); o.visible = false; } });
  B.render(cam); out.draw = { calls: B.info.calls, triangles: B.info.triangles };
  for (const o of hide) o.visible = true;
  B.render(cam); const allCalls = B.info.calls; mesh.visible = false; B.render(cam); out.draw.delta = allCalls - B.info.calls; mesh.visible = true;
  // 6. frame time at 960x720, 600 frames: blades shown vs hidden; blades + ground shown vs both hidden
  const cv = R.domElement, keepW = cv.width, keepH = cv.height; cv.width = 960; cv.height = 720;
  const gl = R.getContext(), one = new Uint8Array(4);
  const tq = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  const gpuTime = async (n) => {
    if (!tq) return null;
    const qs = [];
    for (let i = 0; i < n; i++) { const q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); B.render(cam); gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
    for (let k = 0; k < 200 && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 10));
    if (gl.getParameter(tq.GPU_DISJOINT_EXT)) return null;
    let s = 0, m = 0; for (const q of qs) { if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { s += gl.getQueryParameter(q, gl.QUERY_RESULT); m++; } gl.deleteQuery(q); }
    return m ? s / m / 1e6 : null;
  };
  const setG = (v) => { for (const g of grounds) g.visible = v; };
  time(20);
  const F = 600, fr = {};
  mesh.visible = true; setG(true); fr.shown = time(F); fr.gShown = await gpuTime(F);
  mesh.visible = false; fr.hidden = time(F); fr.gHidden = await gpuTime(F);
  setG(false); fr.bothHidden = time(F); fr.gBothHidden = await gpuTime(F);
  mesh.visible = true; setG(true);
  cv.width = keepW; cv.height = keepH; B.render(cam);
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");   // the real backend, not "WebKit WebGL"
  out.frame = { ...fr, frames: F, W: 960, H: 720, timer: !!tq, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  return out;
});
await browser.close().catch(() => {});

const g = res.info || {};
let skips = 0;
const skip = (msg) => { skips++; console.log(`SKIP ${msg}`); };
const gr = res.grounds || { names: [], kinds: [], n: 0 };
const onGrass = gr.kinds.includes("grass");
if (res.noGround) { console.log(`FAIL the blade mesh names ${JSON.stringify(gr.names)} but no such surface is in the scene`); process.exit(1); }
console.log(`     (info) ${res.count} blades (${g.tries} samples, ${g.offPaint} off the grass paint, radius ${g.radius}), ${res.vertsPerBlade} vertices / ${res.trisPerBlade} triangles per blade = ${res.count * res.trisPerBlade} triangles, on ${g.groundTriangles} ground triangles, built in ${g.ms} ms`);
console.log(`     (info) blades stand on ${gr.names.join(", ")} (kind ${gr.kinds.join("/")}, r ${res.bladeR.min}..${res.bladeR.max}): ` +
  (onGrass ? `the ground mask (dirt/rock/path) and the pattern albedo` : `the shore's own measured green share (no ground mask in this arena) and its bladeColours band`));
if (onGrass) check(res.count >= 100000 && res.vertsPerBlade === 9 && res.trisPerBlade === 7, `blades: ${res.count} (>= 100000), 9-vertex / 7-triangle blades`);
else {
  // a beach's green is a band, not the forest's ground: the count is the density rule's own target for that surface
  const P = res.params, tgt = Math.min(P.COUNT, Math.max(P.MIN_COUNT, Math.round(g.density * g.effArea)));
  check(res.count === g.target && g.target === tgt && res.count >= P.MIN_COUNT && res.vertsPerBlade === 9 && res.trisPerBlade === 7,
    `blades: ${res.count} = the density rule's target for ${g.effArea} units² of measured shore green (${g.density} blades/unit², min ${P.MIN_COUNT}), 9-vertex / 7-triangle blades`);
}
const og = res.onGround;
check(og.plane < 1e-3 && og.outside === 0, `every blade on its ground triangle: max distance to the plane ${og.plane.toExponential(2)} (< 1e-3), ${og.outside} outside it`);
check(og.noHit === 0 && og.rayErr < 1e-3, `independent ray down on the ground meshes (${og.rays} blades): max |base - ground| ${og.rayErr.toExponential(2)} (< 1e-3), ${og.noHit} with no ground`);
const pt = res.paint;
if (pt.hasMask) check(pt.hasMask && pt.masked && pt.over === 0 && pt.slope < pt.cliffLo, `every blade on grass paint: ground mask (GPU) max dirt/rock/path ${pt.worst.toFixed(3)} (< 0.5, ${pt.over} over), max slope ${pt.slope.toFixed(3)} (< cliff ${pt.cliffLo})`);
else check(pt.greenMin > pt.gate && pt.over === 0 && pt.greenTris === pt.tris,
  `every blade on the shore's measured green: min green share ${pt.greenMin.toFixed(4)} (> the ${pt.gate} gate), ${pt.over} blades at or below it; ${pt.n} blades on ${pt.tris} shore triangles (${pt.greenTris} carry a measured green row), max slope ${pt.slope.toFixed(3)}`);
check(res.sameFn, `GPU probe runs the material's own grassWorldPos()`);
const sh = res.shape;
check(sh.twistMed > 0.5 && sh.curlMed > 0.08, `3D blades: width direction turns ${sh.twistMed.toFixed(2)} rad root -> top row (median, min ${sh.twistMin.toFixed(2)}), tip curls ${(sh.curlMed * 100).toFixed(0)}% of height forward (median), ${sh.n} blades`);
const w = res.wind;
check(w.baseErr < 1e-3 && w.moved > 0, `wind on (strength ${w.strength}): blade bases fixed (max move ${w.baseErr.toExponential(2)} units), ${w.moved.toFixed(0)} tips move per time; largest tip move ${(w.tipShare * 100).toFixed(1)}% of blade height`);
check(w.corrMin > 0.9, `rolling wave: tip moves vs the JS twin of the wave, correlation min ${w.corrMin.toFixed(3)} over 6 times (> 0.9)`);
for (const [k, f] of frames.entries()) console.log(`frame ${k}: eye ${f.eye} arenaScale ${f.arenaScale}; ` + f.fighters.map((x) =>
  `${x.side} h ${x.heightWorld} on screen ${x.px} px, foot r ${x.foot}, ${x.blades} blades under it, worst ${(x.worst * 100).toFixed(2)}% (tallest ${x.worstH} units)`).join(" | ") + `; caps ${JSON.stringify(f.state)}`);
const under = frames.flatMap((f) => f.fighters);
const bladeFrames = under.reduce((s, x) => s + x.blades, 0);
if (bladeFrames > 0) check(under.length > 0 && under.some((x) => x.blades > 0) && under.every((x) => x.worst <= 0.03),
  `height rule: every blade under a fighter <= 3% of its on-screen height (worst ${(Math.max(...under.map((x) => x.worst)) * 100).toFixed(2)}%, ${bladeFrames} blade-frames)`);
else skip(`height rule: ${bladeFrames} blades under a fighter in ${frames.length} frames (${under.length} fighter-frames) — ` +
  `the blades stand at r ${res.bladeR.min}..${res.bladeR.max} on ${gr.names.join(", ")}, the fighters inside r ${Math.max(...under.map((x) => x.r))}, so 0 of 0 blades can be measured`);
if (res.colour.masked) check(res.colour.err < 2e-3, `root colour = the ground's albedo there (pattern x AO ${res.colour.aoAmt}): max error ${res.colour.err.toExponential(2)} on ${res.colour.n} blades (< 2e-3)`);
else check(res.colour.exc < 1e-6 && res.colour.n > 0,
  `root colour inside the shore's measured band at its triangle: max excursion ${res.colour.exc.toExponential(2)} on ${res.colour.n} blades (${res.colour.bands} distinct bladeColours bands, 0 outside)`);
check(res.draw.calls <= 4 && res.draw.delta <= 4, `grass draw calls: ${res.draw.calls} alone, ${res.draw.delta} added to the frame (<= 4); ${res.draw.triangles} triangles drawn`);
check(res.uniforms.bad === 0 && res.uniforms.sameModule && res.uniforms.inList, `one shared uniform object: ${res.uniforms.keys} shared uniforms, ${res.uniforms.bad} not the same reference`);
check(res.programs.failed === 0, `shader programs compile: ${res.programs.count}, ${res.programs.failed} failed`);
check(!res.material.transparent && !res.material.castShadow, `blades opaque, cast no shadow`);
const fr = res.frame, gpuS = (a, b) => (a != null && b != null ? `${(a - b).toFixed(2)} ms GPU timer` : "no GPU timer");
const blades = fr.shown - fr.hidden, pair = fr.shown - fr.bothHidden;
console.log(`     (info) frame time at ${fr.W}x${fr.H} over ${fr.frames} frames on ${fr.renderer}: all ${fr.shown.toFixed(2)} ms, blades hidden ${fr.hidden.toFixed(2)}, blades + ground hidden ${fr.bothHidden.toFixed(2)}; blades ${blades.toFixed(2)} ms (${gpuS(fr.gShown, fr.gHidden)}), blades + ground ${pair.toFixed(2)} ms (${gpuS(fr.gShown, fr.gBothHidden)}); whole frame GPU ${fr.gShown != null ? fr.gShown.toFixed(2) : "-"} ms`);
check(pair <= BUDGET, `blades + ground frame time ${pair.toFixed(2)} ms <= ${BUDGET} ms`);
for (const e of errors) console.log("   error:", e);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails);
