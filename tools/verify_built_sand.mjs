// Numbers check of the BUILT arena's SAND floor and SHORE band (web/built/sand.js; beach arenas, meft1002; no
// pictures). The arena's own floor triangles are painted with the CC0 photo's own colour, tinted so its mean IS the
// piece's measured `all` colour, plus wind ripples in the normal; the shore band is painted with the piece's own
// measured picture-row colours (8 bins) and carries aGreen = the measured green share of its row, so grass grows on it
// only where the picture turns green.
//   - page and shader errors; the sand + shore materials' programs compile
//   - colours: the sand material's uSandAll / uSandLo / uSandHi ARE the piece's measured all / p10 / p90 (<= 2/255);
//     the photo is loaded and its mean read (uTexOn 1)
//   - the paint alone (no light, no haze: the material's own uniforms and sandPaint() GLSL):
//       * 32768 area-weighted points on the sand at full detail: MEAN colour = measured all (<= 3/255); CONTINUOUS:
//         >= 1000 distinct 8-bit colours and the two commonest < 5 % (the old paint was exactly two tones)
//       * as drawn (mips), 960x720 top-down and through the viewer's camera: the same mean, many distinct colours
//       * no shimmer: the viewer's camera panned a quarter pixel; per-pixel paint difference beyond 10 m
//         (mean <= 1.5/255, p99 <= 8/255)
//       * ripples (close top-down, 1 unit/px): share of crest pixels, their orientation vs the ripple direction, and
//         the measured wavelength vs RIP_LEN
//   - cost: sand shown vs hidden, viewer camera, 600 frames each (info)
//   - shore rows: the material's uRows ARE the piece's measured rows (<= 2/255); the paint at each of the 8 bin
//     centres IS that row's colour (<= 2/255, GPU points pass through the same GLSL); every painted pixel lies on the
//     piece's row table (<= 2/255); the band paints the whole row range; the sand->green crossing row
//   - aGreen: every vertex's aGreen IS the measured green share of its picture row (CPU, same interpolation as the
//     paint); bladeColours are the measured greens of the two greenest rows
//   - grass: blades ONLY where aGreen > 0.5 (min over every blade), 0 blades on the sand (exact, per triangle, plus a
//     ray-down sample), every blade root on the segment between the shore's measured greens, and grass.js's own
//     palette == the shore's bladeColours
//   - 0 shader errors from the sand/shore materials (three logs the failing GLSL, so it names them); other layers'
//     programs are printed but not charged here
//   - draw calls / triangles of the sand + shore alone, and of the whole built world
//   VERIFY_PORT=8090 [ARENA=meft1002] tools/run-playwright.sh tools/verify_built_sand.mjs
import fs from "node:fs";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const REC = JSON.parse(fs.readFileSync(new URL(`../web/assets-hd/battle/built/${ARENA}.json`, import.meta.url), "utf8"));
const beach = REC.pieces.filter((p) => p.kind === "sand" || p.kind === "shore");
if (!beach.length) {
  console.log(`SKIP ${ARENA} has no sand/shore pieces (this checker needs a beach arena)`);
  process.exit(0);
}
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [], pageErrs = [];
page.on("pageerror", (e) => pageErrs.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 60000 }).catch(() => {});
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const d8b = (a, b) => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k])));   // 8-bit channel distance

const loaded = await page.evaluate(() => window.__built && { missing: !!window.__built.missing, info: window.__built.info });
check(loaded && !loaded.missing, `built world loaded: ${JSON.stringify(loaded?.info?.pieces)}`);
check(!!loaded?.info?.layers?.sand, `sand + shore layer built: ${JSON.stringify(loaded?.info?.layers?.sand)}`);
check(loaded?.info?.layers?.sand?.triangles === beach.reduce((s, p) => s + p.tris, 0),
  `sand + shore drawn: ${loaded?.info?.layers?.sand?.triangles} triangles = the recipe's ${beach.reduce((s, p) => s + p.tris, 0)} (${beach.map((p) => `${p.name} ${p.kind} ${p.tris}`).join(", ")})`);

const s = await page.evaluate(async ({ rec }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const SD = await import("./built/sand.js");
  const B = window.__built, R = B.renderer, W = 960, H = 720, out = {};
  const worldDraw = { calls: B.info.calls, triangles: B.info.triangles };   // the viewer's last frame
  const to8 = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));   // linear -> 8-bit sRGB
  const rgb8 = (c) => [to8(c.r ?? c[0]), to8(c.g ?? c[1]), to8(c.b ?? c[2])];
  const d8 = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  const meshes = [];
  B.scene.traverse((o) => { if (o.isMesh && (o.userData.kind === "sand" || o.userData.kind === "shore")) meshes.push(o); });
  const sandMesh = meshes.find((m) => m.userData.kind === "sand") || null;
  const shoreMesh = meshes.find((m) => m.userData.kind === "shore") || null;
  const recSand = rec.pieces.find((p) => p.kind === "sand") || null;
  const recShore = rec.pieces.find((p) => p.kind === "shore") || null;
  out.meshes = meshes.map((m) => ({ name: m.name, kind: m.userData.kind, verts: m.geometry.attributes.position.count }));

  // one render of the PAINT ALONE (the mesh material's own uniforms + GLSL, no light, no haze) into a float target
  const paintPass = (mesh, camera) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
    const probe = SD.paintProbeMaterial(mesh);
    const badBefore = R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
    const hid = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isInstancedMesh) && o !== mesh && o.visible) { hid.push(o); o.visible = false; } });
    const bg = B.scene.background; B.scene.background = null;
    const keepMat = mesh.material; mesh.material = probe;
    const prevRT = R.getRenderTarget(), prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(B.scene, camera);
    const px = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const bad = Math.max(0, R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length - badBefore);   // programs THIS pass added
    R.setRenderTarget(prevRT); R.setClearColor(prevClear, prevAlpha);
    mesh.material = keepMat; probe.dispose(); rt.dispose(); B.scene.background = bg;
    for (const o of hid) o.visible = true;
    return { px, bad };
  };
  // a points pass: one pixel per input value, through the same GLSL the material paints with
  const pointsPass = (uniforms, frag, values, attr) => {
    const n = values.length, g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(values), 1));
    const mat = new THREE.ShaderMaterial({ uniforms,
      vertexShader: `attribute float ${attr}; varying vec3 vW; varying vec3 vN; varying float vRow;
        void main() { vRow = ${attr}; vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_PointSize = 1.0;
          gl_Position = vec4((float(gl_VertexID) + 0.5) / ${n.toFixed(1)} * 2.0 - 1.0, 0.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vW; varying vec3 vN; varying float vRow;\n${frag}` });
    const rt = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const sc = new THREE.Scene(), pts = new THREE.Points(g, mat); pts.frustumCulled = false; sc.add(pts);
    const prev = R.getRenderTarget();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
    const px = new Float32Array(n * 4); R.readRenderTargetPixels(rt, 0, 0, n, 1, px);
    R.setRenderTarget(prev); rt.dispose(); mat.dispose(); g.dispose();
    return px;
  };

  // ---------- sand: the CC0 photo tinted to the measured colour (mean, continuity, stability), ripples, cost ----------
  if (sandMesh) {
    const u = sandMesh.material.uniforms;
    // the photo must be in and its mean read (sand.js update() sets uTint and flips uTexOn when it is)
    await SD.sandTexturesReady();
    for (let k = 0; k < 400 && u.uTexOn.value !== 1; k++) { window.__renderFrame?.(performance.now()); await new Promise((r) => setTimeout(r, 25)); }
    const tex = SD.sandTextures();
    const v3 = (c) => [c.r ?? c.x, c.g ?? c.y, c.b ?? c.z];
    out.sand = { texOn: u.uTexOn.value, texMean: tex.mean, texPx: tex.px, texReadMs: tex.readMs, tint: v3(u.uTint.value),
                 all8: rgb8(v3(u.uSandAll.value)), lo8: rgb8(v3(u.uSandLo.value)), hi8: rgb8(v3(u.uSandHi.value)),
                 measured: recSand ? recSand.colours : null, passes: {} };
    if (recSand) out.sand.colErr = Math.max(d8(out.sand.all8, recSand.colours.all), d8(out.sand.lo8, recSand.colours.p10), d8(out.sand.hi8, recSand.colours.p90));
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // statistics of a list of linear rgb samples: mean (linear -> 8-bit), distinct 8-bit colours, the most common
    // colour's share, the luminance p10/p50/p90 as 8-bit sRGB grey
    const stats = (cols) => {
      const n = cols.length, m = [0, 0, 0], seen = new Map(), L = [];
      for (const c of cols) {
        m[0] += c[0]; m[1] += c[1]; m[2] += c[2];
        const k = c.map(to8).join(","); seen.set(k, (seen.get(k) || 0) + 1);
        L.push(lum(c));
      }
      L.sort((a, b) => a - b);
      const top = [...seen.values()].sort((a, b) => b - a);
      const q = (f) => to8(L[Math.min(n - 1, Math.floor(f * (n - 1)))]);
      return { n, mean8: rgb8(m.map((v) => v / n)), distinct: seen.size, top1: top[0] / n, top2: ((top[0] || 0) + (top[1] || 0)) / n,
               lumP10: q(0.1), lumP50: q(0.5), lumP90: q(0.9) };
    };
    // (1) many points on the sand, area-weighted over the recipe's triangles (seeded), through the material's own
    //     uniforms and sandPaint(): one pixel per point at FULL detail (a 1-px point has no footprint: mip 0, every
    //     octave on)
    {
      const P = sandMesh.geometry.attributes.position.array, M = sandMesh.matrixWorld, tris = [], acc = [];
      let total = 0;
      for (let i = 0; i < P.length; i += 9) {
        const a = new THREE.Vector3(P[i], P[i + 1], P[i + 2]).applyMatrix4(M), b = new THREE.Vector3(P[i + 3], P[i + 4], P[i + 5]).applyMatrix4(M),
              c = new THREE.Vector3(P[i + 6], P[i + 7], P[i + 8]).applyMatrix4(M);
        const ar = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
        total += ar; tris.push([a, b, c]); acc.push(total);
      }
      let seed = 1234567;
      const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const NW = 256, NH = 128, N = NW * NH, pos = new Float32Array(N * 3);
      for (let k = 0; k < N; k++) {
        const r = rnd() * total; let lo2 = 0, hi2 = acc.length - 1;
        while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (acc[m] < r) lo2 = m + 1; else hi2 = m; }
        const [a, b, c] = tris[lo2]; let s1 = rnd(), s2 = rnd(); if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
        pos[k * 3] = a.x + (b.x - a.x) * s1 + (c.x - a.x) * s2; pos[k * 3 + 1] = a.y + (b.y - a.y) * s1 + (c.y - a.y) * s2; pos[k * 3 + 2] = a.z + (b.z - a.z) * s1 + (c.z - a.z) * s2;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setAttribute("aW", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.ShaderMaterial({ uniforms: u,
        vertexShader: `attribute vec3 aW; varying vec3 vW; varying vec3 vN; varying float vRow;
          void main() { vW = aW; vN = vec3(0.0, 1.0, 0.0); vRow = 0.0; gl_PointSize = 1.0;
            float id = float(gl_VertexID), x = mod(id, ${NW}.0), y = floor(id / ${NW}.0);
            gl_Position = vec4((x + 0.5) / ${NW}.0 * 2.0 - 1.0, (y + 0.5) / ${NH}.0 * 2.0 - 1.0, 0.0, 1.0); }`,
        fragmentShader: `varying vec3 vW; varying vec3 vN; varying float vRow;
          ${S.NOISE_GLSL}
          ${S.LIGHT_GLSL}
          ${SD.SAND_GLSL}
          void main() { gl_FragColor = vec4(sandPaint(vW), 1.0); }` });
      const rt = new THREE.WebGLRenderTarget(NW, NH, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
      const sc = new THREE.Scene(), pts = new THREE.Points(g, mat); pts.frustumCulled = false; sc.add(pts);
      const prev = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
      const px = new Float32Array(N * 4); R.readRenderTargetPixels(rt, 0, 0, NW, NH, px);
      R.setRenderTarget(prev); rt.dispose(); mat.dispose(); g.dispose();
      const cols = []; let missed = 0;
      for (let k = 0; k < N; k++) { if (px[k * 4 + 3] < 0.5) { missed++; continue; } cols.push([px[k * 4], px[k * 4 + 1], px[k * 4 + 2]]); }
      out.sand.points = { ...stats(cols), missed };
    }
    // (2) the paint alone top-down (ortho, 960x720) and through the viewer's camera: the mean of what is DRAWN (mips)
    const wscale = sandMesh.parent?.scale?.x || 1;
    const ortho = new THREE.OrthographicCamera(-5200, 5200, 3900, -3900, 1, 40000);
    ortho.position.set(0, 20000, 0); ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0); ortho.updateMatrixWorld(); ortho.updateProjectionMatrix();
    const passes = { ortho: paintPass(sandMesh, ortho) };
    const sceneCam = B.camera || null;
    if (sceneCam) passes.view = paintPass(sandMesh, sceneCam);
    for (const [name, pass] of Object.entries(passes)) {
      const cols = [];
      for (let i = 0; i < W * H; i++) { const o = i * 4; if (pass.px[o] + pass.px[o + 1] + pass.px[o + 2] > 1e-6) cols.push([pass.px[o], pass.px[o + 1], pass.px[o + 2]]); }
      out.sand.passes[name] = { painted: cols.length / (W * H), ...stats(cols), badPrograms: pass.bad };
    }
    // (3) no shimmer: the viewer's camera panned by a quarter pixel (one slow frame), the paint alone both times;
    //     per-pixel difference (8-bit, max channel) split by the pixel's distance from the eye
    if (sceneCam) {
      const cam2 = sceneCam.clone(); cam2.updateMatrixWorld();
      const fovRad = (sceneCam.fov || 50) * Math.PI / 180, step = 0.25 * fovRad / H;   // radians per quarter pixel
      cam2.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), step); cam2.updateMatrixWorld();
      const a = paintPass(sandMesh, sceneCam).px, b = paintPass(sandMesh, cam2).px;
      // distance of each pixel from the eye: one more pass that writes it
      const keep = sandMesh.material;
      const dmat = new THREE.ShaderMaterial({ vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vW; void main() { gl_FragColor = vec4(length(vW - cameraPosition), 0.0, 0.0, 1.0); }`, side: THREE.DoubleSide });
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
      const hid = []; B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isInstancedMesh) && o !== sandMesh && o.visible) { hid.push(o); o.visible = false; } });
      const bg = B.scene.background; B.scene.background = null; sandMesh.material = dmat;
      const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(B.scene, sceneCam);
      const dist = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, dist);
      R.setRenderTarget(prev); sandMesh.material = keep; B.scene.background = bg; for (const o of hid) o.visible = true; dmat.dispose(); rt.dispose();
      const FAR = 4000 * wscale;   // 10 m
      const near = [], far = [];
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        if (dist[o + 3] < 0.5 || a[o] + a[o + 1] + a[o + 2] <= 1e-6 || b[o] + b[o + 1] + b[o + 2] <= 1e-6) continue;
        const e = Math.max(Math.abs(to8(a[o]) - to8(b[o])), Math.abs(to8(a[o + 1]) - to8(b[o + 1])), Math.abs(to8(a[o + 2]) - to8(b[o + 2])));
        (dist[o] > FAR ? far : near).push(e);
      }
      const sum = (v) => { if (!v.length) return null; const s2 = [...v].sort((x, y) => x - y); return { n: v.length, mean: v.reduce((x, y) => x + y, 0) / v.length, p99: s2[Math.floor(0.99 * (v.length - 1))], max: s2[v.length - 1] }; };
      out.sand.shimmer = { stepPx: 0.25, farUnits: FAR, near: sum(near), far: sum(far) };
    }
    // (4) ripples: a CLOSE top-down view (1 unit/px x the arena scale) where the 10 cm ripples are resolved
    {
      const P = sandMesh.geometry.attributes.position.array, M = sandMesh.matrixWorld;
      // the centre: the sand triangle centroid nearest 1500 units from the arena centre
      let best = null, bd = 1e18;
      for (let i = 0; i < P.length; i += 9) {
        const c = new THREE.Vector3((P[i] + P[i + 3] + P[i + 6]) / 3, (P[i + 1] + P[i + 4] + P[i + 7]) / 3, (P[i + 2] + P[i + 5] + P[i + 8]) / 3).applyMatrix4(M);
        const dd2 = Math.abs(Math.hypot(c.x, c.z) - 1500 * wscale); if (dd2 < bd) { bd = dd2; best = c; }
      }
      const UPP = wscale, hw = W / 2 * UPP, hh = H / 2 * UPP;
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, 40000);
      cam.position.set(best.x, 20000, best.z); cam.up.set(0, 0, -1); cam.lookAt(best.x, 0, best.z); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const pass = paintPass(sandMesh, cam), px = pass.px;
      const rip = new Float32Array(W * H), cov = new Uint8Array(W * H);
      let painted = 0, ripPx = 0;
      for (let i = 0; i < W * H; i++) { const o = i * 4; if (px[o] + px[o + 1] + px[o + 2] <= 1e-6) continue; cov[i] = 1; painted++; rip[i] = px[o + 3]; if (px[o + 3] > 0.3) ripPx++; }
      let sxx = 0, sxy = 0, syy = 0, tn = 0;
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (!cov[i] || !cov[i - 1] || !cov[i + 1] || !cov[i - W] || !cov[i + W]) continue;
        const gx = (rip[i + 1] - rip[i - 1]) / 2, gy = (rip[i + W] - rip[i - W]) / 2;
        if (gx * gx + gy * gy < 1e-6) continue;
        sxx += gx * gx; sxy += gx * gy; syy += gy * gy; tn++;
      }
      // readPixels rows run bottom-up; with up = -z, image +y (row up) is world -z, image +x is world +x
      const ang = tn ? 0.5 * Math.atan2(2 * sxy, sxx - syy) * 180 / Math.PI : null;   // in (x right, y up) image axes
      const dir = u.uRipDir.value, dirImg = Math.atan2(-dir.y, dir.x) * 180 / Math.PI;   // world (x, z) -> image (x, -z)
      const axisDiff = (p, q) => { let d2 = Math.abs(((p - q) % 180 + 180) % 180); return Math.min(d2, 180 - d2); };
      // wavelength: walk lines along the ripple direction, count the starts of the crest runs
      const lens = [], at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : (cov[y * W + x] ? rip[y * W + x] : -1);
      const ux = Math.cos(dirImg * Math.PI / 180), uy = Math.sin(dirImg * Math.PI / 180);
      for (let k = -30; k <= 30; k++) {
        const o = k * 10, runs = []; let prev = 0;
        for (let s2 = -480; s2 <= 480; s2 += 0.5) {
          const v = at(Math.round(W / 2 + ux * s2 - uy * o), Math.round(H / 2 + uy * s2 + ux * o));
          if (v < 0) { prev = 0; continue; }
          const b2 = v > 0.2 ? 1 : 0; if (b2 && !prev) runs.push(s2); prev = b2;
        }
        if (runs.length >= 4) lens.push((runs[runs.length - 1] - runs[0]) / (runs.length - 1) * UPP);
      }
      lens.sort((a, b) => a - b);
      out.sand.ripples = { centre: [Math.round(best.x), Math.round(best.z)], painted: painted / (W * H), share: painted ? ripPx / painted : 0,
        ang, dirImg, angErr: ang == null ? null : axisDiff(ang, dirImg), wave: lens.length ? lens[Math.floor(lens.length / 2)] : null,
        picked: u.uRipLen.value * wscale, lines: lens.length, badPrograms: pass.bad };
    }
    // (5) cost: the viewer's camera, sand shown vs hidden, 600 frames each, 10 interleaved blocks, medians
    {
      const cam = window.__r.getCameraInfo().render, gl = R.getContext(), one = new Uint8Array(4);
      const frame = () => { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); };
      const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) frame(); return (performance.now() - t0) / n; };
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return (b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2; };
      const T = { shown: [], hidden: [] }, set = (v) => { sandMesh.visible = v; };
      set(true); time(10); set(false); time(10);
      for (let k = 0; k < 10; k++) { set(true); T.shown.push(time(60)); set(false); T.hidden.push(time(60)); }
      set(true);
      out.sand.cost = { shown: med(T.shown), hidden: med(T.hidden), frames: 600, size: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    }
  }

  // ---------- shore: the measured picture rows ----------
  if (shoreMesh) {
    const u = shoreMesh.material.uniforms, rows = u.uRows.value, N = rows.length;
    const rows8 = rows.map((c) => rgb8(c));
    out.shore = { rows8, measured8: recShore ? recShore.rows.map((r) => r.rgb) : null, N };
    out.shore.rowErr = recShore ? Math.max(...rows8.map((c, b) => d8(c, recShore.rows[b].rgb))) : null;
    // the paint at each bin centre, through the material's own uniforms and the same shoreRow() GLSL
    const centre = Array.from({ length: N }, (_, b) => (b + 0.5) / N);
    const pp = pointsPass(u, `${SD.SHORE_ROW_GLSL}\nvoid main() { gl_FragColor = vec4(shoreRow(vRow), 1.0); }`, centre, "aRow");
    out.shore.bin8 = []; out.shore.binErr = 0;
    for (let b = 0; b < N; b++) {
      const c = [pp[b * 4], pp[b * 4 + 1], pp[b * 4 + 2]].map(to8);
      out.shore.bin8.push(c);
      if (recShore) out.shore.binErr = Math.max(out.shore.binErr, d8(c, recShore.rows[b].rgb));
    }
    // every painted pixel lies on the piece's row table; the band paints the whole row range
    const tab = [];
    for (let i = 0; i <= 512; i++) { const c = [0, 1, 2].map((k) => SD.rowValue(rows8, i / 512, (q) => q[k])); tab.push(c); }
    const ortho = new THREE.OrthographicCamera(-5200, 5200, 3900, -3900, 1, 40000);
    ortho.position.set(0, 20000, 0); ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0); ortho.updateMatrixWorld(); ortho.updateProjectionMatrix();
    const pass = paintPass(shoreMesh, ortho), px = pass.px;
    let painted = 0, off = 0, worst = 0, rowLo = 1, rowHi = 0, covY = [];
    for (let i = 0; i < W * H; i++) {
      const o = i * 4, c = [px[o], px[o + 1], px[o + 2]];
      if (c[0] + c[1] + c[2] <= 1e-6) continue;
      painted++;
      const c8 = c.map(to8);
      let best = 1e9, bi = 0;
      for (let k = 0; k < tab.length; k++) { const e = d8(c8, tab[k]); if (e < best) { best = e; bi = k; } }
      worst = Math.max(worst, best); if (best > 2) off++;
      const r = bi / 512; rowLo = Math.min(rowLo, r); rowHi = Math.max(rowHi, r);
    }
    out.shore.painted = painted / (W * H); out.shore.paintedPx = painted; out.shore.offTable = off; out.shore.worstRowPx = worst;
    out.shore.rowSpan = [rowLo, rowHi]; out.shore.badPrograms = pass.bad;
    // the geometry's own row mapping: aRow per vertex, and where the band crosses the sand->green row
    const ar = shoreMesh.geometry.attributes.aRow.array, ag = shoreMesh.geometry.attributes.aGreen?.array || null;
    out.shore.rowVert = [Math.min(...ar), Math.max(...ar)];
    if (recShore && ag) {
      let worstG = 0;
      for (let i = 0; i < ar.length; i++) worstG = Math.max(worstG, Math.abs(ag[i] - SD.rowValue(recShore.rows, ar[i], (r) => r.green)));
      out.shore.greenErr = worstG;
      out.shore.aGreen = [Math.min(...ag), Math.max(...ag)];
      // the row where the measured green share crosses 0.5 (the sand -> grass line of the picture)
      let lo2 = 0, hi2 = 1;
      for (let k = 0; k < 60; k++) { const m = (lo2 + hi2) / 2; if (SD.rowValue(recShore.rows, m, (r) => r.green) > 0.5) lo2 = m; else hi2 = m; }
      out.shore.crossRow = (lo2 + hi2) / 2;
      // world y of that row on the band: interpolate y against aRow over the triangles
      const P = shoreMesh.geometry.attributes.position.array, cross = out.shore.crossRow, ys = [];
      for (let i = 0; i < P.length; i += 9) for (let e = 0; e < 3; e++) {
        const a = e, b = (e + 1) % 3, ra = ar[i / 3 + a], rb = ar[i / 3 + b];
        if ((ra - cross) * (rb - cross) <= 0 && ra !== rb) ys.push(P[i + a * 3 + 1] + (P[i + b * 3 + 1] - P[i + a * 3 + 1]) * (cross - ra) / (rb - ra));
      }
      out.shore.crossY = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
      out.shore.yRange = [Math.min(...Array.from({ length: P.length / 3 }, (_, i) => P[i * 3 + 1])), Math.max(...Array.from({ length: P.length / 3 }, (_, i) => P[i * 3 + 1]))];
      // blade colours = the measured greens of the two greenest picture rows
      const bc = shoreMesh.userData.bladeColours;   // where grass.js reads it
      const greenest = recShore.rows.filter(Boolean).sort((a, b) => b.green - a.green).slice(0, 2).map((r) => r.rgb)
        .sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      out.shore.bladeColours = bc ? [bc.p10, bc.p90] : null;
      out.shore.bladeErr = bc ? Math.max(d8(bc.p10, greenest[0]), d8(bc.p90, greenest[greenest.length - 1])) : null;
    }
  }

  // ---------- grass: on the shore's green only, never on the sand ----------
  const gm = B.scene.getObjectByName("grass_blades");
  out.grass = { blades: gm ? gm.count : 0 };
  if (gm && gm.count) {
    const { tris, triOf, bary } = gm.userData, n = gm.count;
    const sandName = sandMesh?.name, shoreName = shoreMesh?.name;
    let minGreen = 1, maxGreen = 0, onSand = 0, onShore = 0, onOther = 0, worstBase = 0;
    for (let i = 0; i < n; i++) {
      const tr = tris[triOf[i]], w = [bary[i * 3], bary[i * 3 + 1], bary[i * 3 + 2]];
      const g = tr.green ? w[0] * tr.green[0] + w[1] * tr.green[1] + w[2] * tr.green[2] : 0;
      minGreen = Math.min(minGreen, g); maxGreen = Math.max(maxGreen, g);
      if (tr.mesh === sandName) onSand++; else if (tr.mesh === shoreName) onShore++; else onOther++;
      worstBase = Math.max(worstBase, Math.abs(w[0] + w[1] + w[2] - 1));
    }
    out.grass = { ...out.grass, minGreen, maxGreen, onSand, onShore, onOther, worstBase, sandTris: tris.filter((t) => t.mesh === sandName).length,
                  shoreTris: tris.filter((t) => t.mesh === shoreName).length,
                  bladeLoHi: tris.length ? { lo: rgb8(tris[0].lo), hi: rgb8(tris[0].hi) } : null };   // the palette grass.js took
    // roots: every blade's baked root colour on the segment between the shore's measured greens
    const bc = shoreMesh?.userData.bladeColours;
    if (bc) {
      const blo = S.srgb(bc.p10), bhi = S.srgb(bc.p90);
      const d2 = [bhi.r - blo.r, bhi.g - blo.g, bhi.b - blo.b], dd2 = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2;
      const root = gm.geometry.attributes.aRoot.array;
      let worst = 0, pMin = 1, pMax = 0, notGreen = 0;
      for (let i = 0; i < n; i++) {
        const c = [root[i * 3], root[i * 3 + 1], root[i * 3 + 2]];
        const tt = ((c[0] - blo.r) * d2[0] + (c[1] - blo.g) * d2[1] + (c[2] - blo.b) * d2[2]) / dd2;
        pMin = Math.min(pMin, tt); pMax = Math.max(pMax, tt);
        worst = Math.max(worst, Math.hypot(c[0] - (blo.r + d2[0] * tt), c[1] - (blo.g + d2[1] * tt), c[2] - (blo.b + d2[2] * tt)));
        if (!(c[1] > c[0] && c[1] > c[2])) notGreen++;
      }
      out.grass.roots = { worst, pMin, pMax, notGreen, lo8: rgb8(blo), hi8: rgb8(bhi) };
    }
    // independent: a ray down at 2000 blade bases lands on the shore mesh, never on the sand
    const ray = new THREE.Raycaster(), M = new THREE.Matrix4(), p = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    let hits = 0, hitSand = 0, hitOther = 0, worstY = 0, sampled = 0;
    const ground = B.ground?.ground || [];
    for (let k = 0; k < 2000; k++) {
      const i = Math.floor(k * n / 2000);
      gm.getMatrixAt(i, M); p.setFromMatrixPosition(M);
      ray.set(new THREE.Vector3(p.x, 1e5, p.z), down);
      const hit = ray.intersectObjects(ground, false)[0];
      sampled++;
      if (!hit) continue;
      hits++;
      if (hit.object.userData.kind === "sand") hitSand++; else if (hit.object.name !== shoreName) hitOther++;
      worstY = Math.max(worstY, Math.abs(hit.point.y - p.y));
    }
    out.grass.ray = { sampled, hits, hitSand, hitOther, worstY };
  }

  // ---------- draw calls / triangles: the sand + shore alone, then the whole built world ----------
  const cam = window.__r.getCameraInfo().render;   // B.render() takes the battle camera's own info object
  const keep = [];
  B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isInstancedMesh) && !meshes.includes(o) && o.visible) { keep.push(o); o.visible = false; } });
  B.render(cam); out.draw = { calls: B.info.calls, triangles: B.info.triangles };
  for (const o of keep) o.visible = true;
  out.world = worldDraw;
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  return out;
}, { rec: REC });
await browser.close().catch(() => {});

// ---- sand: the CC0 photo tinted to the measured colour; continuous; no shimmer; ripples; cost ----
if (s.sand) {
  const sd = s.sand, m = sd.measured;
  check(sd.colErr != null && sd.colErr <= 2, `sand colours ARE the piece's measured ones: uSandAll ${sd.all8} vs all ${m?.all}, uSandLo ${sd.lo8} vs p10 ${m?.p10}, uSandHi ${sd.hi8} vs p90 ${m?.p90} (${sd.colErr}/255 off, <= 2)`);
  check(sd.texOn === 1 && sd.texMean && sd.texPx > 0, `the CC0 photo is in and its mean was read: uTexOn ${sd.texOn}, ${sd.texPx} px wide, mean linear rgb ${sd.texMean?.map((v) => v.toFixed(4)).join(", ")} (read in ${sd.texReadMs} ms), tint ${sd.tint.map((v) => v.toFixed(3)).join(", ")}`);
  const pt = sd.points;
  check(pt && pt.n > 30000 && m && d8b(pt.mean8, m.all) <= 3,
    `sand MEAN colour = the measured all, ${pt?.n} points on the sand at full detail: mean ${JSON.stringify(pt?.mean8)} vs measured ${JSON.stringify(m?.all)} (${pt && m ? d8b(pt.mean8, m.all) : "?"}/255 off, <= 3)`);
  check(pt && pt.distinct >= 1000 && pt.top2 < 0.05,
    `sand paint is CONTINUOUS (not two tones), the same points: ${pt?.distinct} distinct 8-bit colours, the two commonest cover ${((pt?.top2 ?? 1) * 100).toFixed(2)}% (>= 1000 distinct, < 5 %); luminance p10/p50/p90 ${pt?.lumP10}/${pt?.lumP50}/${pt?.lumP90} (8-bit grey)`);
  for (const [name, p] of Object.entries(sd.passes)) {
    const where = name === "ortho" ? "960x720 top-down" : "960x720 through the viewer's camera";
    check(p.painted > (name === "ortho" ? 0.15 : 0.05) && d8b(p.mean8, m.all) <= 3 && p.distinct >= 300 && p.top2 < 0.10,
      `sand paint as drawn (mips), ${where}: ${(p.painted * 100).toFixed(1)}% of the frame, mean ${JSON.stringify(p.mean8)} vs measured ${JSON.stringify(m.all)} (${d8b(p.mean8, m.all)}/255, <= 3), ${p.distinct} distinct colours, two commonest ${(p.top2 * 100).toFixed(2)}% (>= 300, < 10 %)`);
    check(p.badPrograms === 0, `sand paint probe program compiles, ${where}: ${p.badPrograms} failed`);
  }
  const sh = sd.shimmer;
  check(sh && sh.far && sh.far.n > 1000 && sh.far.mean <= 1.5 && sh.far.p99 <= 8,
    `no shimmer: the viewer's camera panned ${sh?.stepPx} px, paint difference per pixel beyond ${(sh?.farUnits / 400).toFixed(0)} m: mean ${sh?.far?.mean.toFixed(2)}/255, p99 ${sh?.far?.p99}/255, max ${sh?.far?.max}/255 over ${sh?.far?.n} px (mean <= 1.5, p99 <= 8)`
    + (sh?.near ? `; nearer: mean ${sh.near.mean.toFixed(2)}, p99 ${sh.near.p99}, max ${sh.near.max} over ${sh.near.n} px` : ""));
  const rp = sd.ripples;
  check(rp && rp.share > 0.02 && rp.share < 0.45 && rp.angErr != null && rp.angErr <= 5,
    `wind ripples present (close top-down at 1 unit/px, centre ${rp?.centre}): ${(rp?.share * 100).toFixed(1)}% of the sand on a crest, the lines' normal at ${rp?.ang?.toFixed(1)} deg vs the ripple direction ${rp?.dirImg?.toFixed(1)} deg (image axes; ${rp?.angErr?.toFixed(1)} off, <= 5)`);
  check(rp && rp.wave != null && Math.abs(rp.wave - rp.picked) <= 0.15 * rp.picked,
    `ripple wavelength: ${rp?.wave?.toFixed(1)} units (median of ${rp?.lines} lines) vs the picked RIP_LEN ${rp?.picked} (<= 15 %)`);
  check(rp && rp.badPrograms === 0, `ripple probe program compiles: ${rp?.badPrograms} failed`);
  const c = sd.cost;
  console.log(`     (info) sand cost at ${c.size.join("x")}, viewer camera, medians of 10 interleaved blocks, ${c.frames} frames each: shown ${c.shown.toFixed(3)} ms, hidden ${c.hidden.toFixed(3)} ms, cost ${(c.shown - c.hidden >= 0 ? "+" : "") + (c.shown - c.hidden).toFixed(3)} ms`);
} else console.log("     (info) this arena has no sand piece");

// ---- shore: the measured picture rows ----
if (s.shore) {
  const r = s.shore;
  check(r.rowErr != null && r.rowErr <= 2, `shore row colours ARE the piece's measured rows: 8 bins, worst ${r.rowErr}/255 off (<= 2); row 0 ${JSON.stringify(r.rows8[0])} vs ${JSON.stringify(r.measured8?.[0])}, row 7 ${JSON.stringify(r.rows8[7])} vs ${JSON.stringify(r.measured8?.[7])}`);
  check(r.binErr <= 2, `the paint at each picture-row centre IS that row's colour (GPU, same shoreRow()): worst ${r.binErr}/255 off (<= 2) over ${r.N} bins`);
  check(r.painted > 0.005 && r.offTable === 0, `the band paints ONLY the piece's row table: ${r.offTable} of ${r.paintedPx} painted pixels off the table (worst ${r.worstRowPx}/255, <= 2)`);
  check(r.rowSpan[0] < 0.1 && r.rowSpan[1] > 0.9, `the band paints its whole picture: picture rows ${r.rowSpan[0].toFixed(2)}..${r.rowSpan[1].toFixed(2)} (vertices carry ${r.rowVert[0].toFixed(2)}..${r.rowVert[1].toFixed(2)})`);
  check(r.greenErr != null && r.greenErr < 1e-6, `aGreen IS the measured green share of the vertex's picture row: worst ${r.greenErr?.toExponential(2)} over the band, aGreen ${r.aGreen?.[0].toFixed(3)}..${r.aGreen?.[1].toFixed(3)}`);
  check(r.bladeErr != null && r.bladeErr <= 2, `bladeColours ARE the measured greens of the two greenest rows: ${JSON.stringify(r.bladeColours?.[0])} / ${JSON.stringify(r.bladeColours?.[1])} (${r.bladeErr}/255 off)`);
  console.log(`     (info) sand -> green: the measured green share crosses 0.5 at picture row ${r.crossRow?.toFixed(3)}; on the band that is y ${r.crossY?.toFixed(1)} (band y ${r.yRange?.[0].toFixed(1)}..${r.yRange?.[1].toFixed(1)})`);
  check(r.badPrograms === 0, `shore paint probe program compiles: ${r.badPrograms} failed`);
} else console.log("     (info) this arena has no shore piece");

// ---- grass on the shore ----
const g = s.grass;
check(g.blades > 0 && g.maxGreen > 0.5, `grass grows on the shore's green: ${g.blades} blades, the picture's green share under them ${g.minGreen?.toFixed(3)}..${g.maxGreen?.toFixed(3)}`);
check(g.minGreen > 0.5, `every blade on ground the picture paints green (aGreen > 0.5): ${g.blades} blades, smallest green share ${g.minGreen?.toFixed(3)}`
  + (g.minGreen > 0.5 ? "" : ` - grass.js keeps a blade with probability = the measured green share (grass.js: "if (keep >= g) continue") instead of a hard cut at 0.5, so blades reach the sand end of the band`));
check(g.onSand === 0 && g.sandTris === 0, `no blades on the sand: ${g.onSand} of ${g.blades} blades on a sand triangle, ${g.sandTris} sand triangles in the grass scatter list (0 of each)`);
check(g.onShore === g.blades && g.worstBase < 1e-3, `every blade sits on a shore triangle: ${g.onShore}/${g.blades} (${g.onOther} elsewhere), barycentric sum off by ${g.worstBase?.toExponential(1)}`);
check(g.ray && g.ray.hits > 1900 && g.ray.hitSand === 0 && g.ray.hitOther === 0 && g.ray.worstY < 1e-3,
  `ray down at ${g.ray?.sampled} blade bases: ${g.ray?.hits} hit the shore, ${g.ray?.hitSand} the sand, ${g.ray?.hitOther} other ground; base vs hit y ${g.ray?.worstY.toExponential(1)}`);
check(g.roots && g.roots.worst < 1e-4 && g.roots.pMin > -1e-3 && g.roots.pMax < 1 + 1e-3 && g.roots.notGreen === 0,
  `blade roots on the shore's measured greens ${JSON.stringify(g.roots?.lo8)}..${JSON.stringify(g.roots?.hi8)}: worst ${g.roots?.worst.toExponential(1)} off the segment, parameter ${g.roots?.pMin.toFixed(4)}..${g.roots?.pMax.toFixed(4)}, ${g.roots?.notGreen} roots not green`);
check(g.bladeLoHi && s.shore?.bladeColours && d8b(g.bladeLoHi.lo, s.shore.bladeColours[0]) <= 2 && d8b(g.bladeLoHi.hi, s.shore.bladeColours[1]) <= 2,
  `grass.js took the shore's bladeColours from the mesh (not the piece's sand p90): its palette ${JSON.stringify(g.bladeLoHi?.lo)}..${JSON.stringify(g.bladeLoHi?.hi)} vs mesh.userData.bladeColours ${JSON.stringify(s.shore?.bladeColours?.[0])}..${JSON.stringify(s.shore?.bladeColours?.[1])}`);
console.log(`     (info) sand + shore alone: ${s.draw.calls} draw calls, ${s.draw.triangles} triangles; whole built world: ${s.world.calls} calls, ${s.world.triangles} triangles`);
// the sand/shore materials' own shader errors: three logs the failing GLSL, so a sand/shore failure names sandPaint /
// shoreRow / uSandLo / uRows / aGreen. Other layers' programs are printed but not charged to this checker.
const sandErrs = errors.filter((e) => /sandPaint|sandRipple|shoreRow|uSandLo|uSandHi|uRows|aGreen/.test(e));
check(sandErrs.length === 0, `shader errors from the sand/shore materials: ${sandErrs.length} (probe programs ${Object.values(s.sand?.passes || {}).reduce((a, p) => a + p.badPrograms, 0) + (s.shore?.badPrograms || 0)} failed)`);
console.log(`     (info) page-wide shader programs: ${s.programs.count} compiled, ${s.programs.failed} failed${s.programs.failed ? " (another layer's material, not sand/shore)" : ""}`);
for (const e of pageErrs) console.log("   page error:", e);
check(pageErrs.length === 0, `page errors: ${pageErrs.length}`);
for (const e of errors) console.log("   console error:", e.split("\n")[0].slice(0, 160));
process.exit(fails ? 1 : 0);
