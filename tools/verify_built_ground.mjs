// Numbers check of the BUILT arena's Step 3 layer (web/built/ground.js; plan Step 3, no pictures):
//  - what this arena HAS first: the ground.js ground pieces are the recipe's "grass" meshes. An arena with none
//    (a beach: its floor is sand.js, kinds "sand" / "shore") has no painted ground, no bank and no cliffs, so every
//    check that needs one prints an explicit SKIP with the measured reason; the ones that do not (the hills, the
//    boulders, the draw-call / triangle budget, the shared uniforms, the frame time) still run.
//  - page and shader errors; every program compiles
//  - the arena mask: ONE baked texture, over the ground (its baked heights vs a ray down on the ground meshes),
//    read by the ground, the bank and the boulders (the same texture object), and its JS twin == its own bytes
//  - the painted ground: 3 HARD colour steps (grass / dirt / path). Boundary points are found with the mask's JS
//    twin (where an amount crosses 0.5, the two plateaus read 0.10 clear of it on each side); the ground material's
//    OWN groundPaint() is then (a) sampled on the GPU with a points pass for the plateau colours (vs the palette
//    entries, linear and sRGB bytes, 1/255) and (b) rendered at 960x720 through the arena camera, where the edge is
//    read in 8 directions through each boundary and the narrowest 10%-90% step width is taken, fitted as a step
//    plus a linear background so the pattern drifting under the edge is not charged to it: a hard step is ~1 px,
//    a blend would be many
//  - cliffs: the steep ground triangles (slope threshold) really are painted rock
//  - triangles and draw calls of the whole layer, printed (budget <= 9 calls, ~33k triangles)
//  - every boulder and hill base on or below the ground surface (max error printed)
//  - keep-out by vertices over the FINAL buffers: no boulder / bank / hill vertex within
//    (furthest fighter + 1000) of the centre and none inside a view cone (every eye seen, swept round the circle)
//  - ribbons only past the ground's own edge (min ribbon radius vs the ground's max radius)
//  - one shared uniform object on every new material; frame time shown vs hidden over FRAMES frames (env, default
//    120: this box renders on the real GPU through ANGLE/D3D12, where a frame is ~1.5 ms, so 120 frames is a
//    0.2 s sample and anything under 0.3 ms is below its resolution)
//   VERIFY_PORT=8090 [ARENA=meft1013] [FRAMES=120] tools/run-playwright.sh tools/verify_built_ground.mjs
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1013";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 120));   // frame-time sample per state (software GL: 120 is plenty)
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

// every eye and fighter this run sees (the viewer's own frame loop), for the independent keep-out test
await page.evaluate(() => {
  window.__seen = [];
  const f = () => {
    const c = window.__r?.getCameraInfo?.()?.render;
    if (c) window.__seen.push({ eye: [...c.eye], fighters: ["player", "enemy"].map((s) => window.__r.getFighterBounds(s)).filter(Boolean)
      .map((b) => ({ c: [...b.center], r: Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 })) });
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
for (let k = 0; k < 3; k++) await page.waitForTimeout(1300);

const R0 = await page.evaluate(async ({ frames: FRAMES, gpu: GPU }) => {
  // ---- page-side helpers ---------------------------------------------------------------------------------
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const GS = await import("./built/grass.js");
  const G = await import("./built/ground.js");
  const B = window.__built, rr = window.__r;
  if (!B) return { missing: true, hasRenderer: !!rr };
  const R = B.renderer;
  rr.render(0); const cam = rr.getCameraInfo().render; B.render(cam);
  const out = {};
  // the ground.js ground pieces are the recipe's "grass" meshes; a beach arena has none (its floor is sand.js)
  const groundMeshes = []; B.scene.traverse((o) => { if (o.isMesh && o.userData.kind === "grass") groundMeshes.push(o); });
  const groundMesh = groundMeshes[0] || null;
  const bank = B.scene.getObjectByName("builtBank"), hills = B.scene.getObjectByName("builtHills");
  const getRocks = () => B.scene.getObjectByName("builtBoulders");
  let rocks = getRocks();
  const gm = groundMesh ? groundMesh.material : null, mask = B.ground.mask, gp = B.ground.palette;
  const W = B.renderer.domElement.width, H = B.renderer.domElement.height;
  const arr = (c) => [c.r, c.g, c.b];
  const lin2srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const bytes = (c) => c.map((v) => lin2srgb(Math.min(1, Math.max(0, v))) * 255);
  const kinds = {}; B.scene.traverse((o) => { if (o.isMesh) kinds[o.userData.kind || o.name] = (kinds[o.userData.kind || o.name] || 0) + 1; });
  out.hasGround = !!groundMesh;
  out.inv = { grass: groundMeshes.length, bank: !!bank, rocks: rocks?.count ?? 0, hills: !!hills, kinds };

  // a points pass into a float target: one sample per cell of a cols x rows grid. Each sample is a 2x2 sprite on
  // its own 2 px cell with its centre on a pixel centre, so the fragment's derivative quad lies inside ONE sample:
  // a 1 px point shares its 2x2 quad with its neighbours, and fwidth() of a per-point value would then be the jump
  // between unrelated points, not the material's own footprint.
  const CELL = 2;
  const pointsPass = (geo, mat, cols, rows) => {
    const w = cols * CELL, h = rows * CELL;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const sc = new THREE.Scene(), pts = new THREE.Points(geo, mat); pts.frustumCulled = false; sc.add(pts);
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear();
    R.render(sc, new THREE.Camera());
    const px = new Float32Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, px);
    R.setRenderTarget(prev); rt.dispose();
    return { px, w };
  };
  // the ground material's own groundPaint(), sampled at world points with a given normal
  const paintProbe = (pts) => {
    const n = pts.length, P = new Float32Array(n * 3), NN = new Float32Array(n * 3), id = new Float32Array(n);
    pts.forEach((p, i) => { P.set(p.p, i * 3); NN.set(p.n, i * 3); id[i] = i; });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("aN", new THREE.BufferAttribute(NN, 3));
    g.setAttribute("pid", new THREE.BufferAttribute(id, 1));
    const cols = 100, rows = Math.max(1, Math.ceil(n / cols));
    const uniforms = Object.assign({}, gm.uniforms, { uGrid: { value: new THREE.Vector2(cols, rows) } });
    const mat = new THREE.ShaderMaterial({ uniforms,
      vertexShader: `attribute vec3 aN; attribute float pid; uniform vec2 uGrid; varying vec3 vW; varying vec3 vN;
        void main(){ vW = position; vN = aN; gl_PointSize = 2.0;
          gl_Position = vec4((mod(pid, uGrid.x) + 0.25) / uGrid.x * 2.0 - 1.0, (floor(pid / uGrid.x) + 0.25) / uGrid.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vW; varying vec3 vN;
        ${S.NOISE_GLSL}
        ${S.LIGHT_GLSL}
        ${G.GROUND_GLSL}
        void main(){ gl_FragColor = vec4(groundPaint(vW, normalize(vN)), 1.0); }` });
    const { px, w } = pointsPass(g, mat, cols, rows);
    const at = (i) => { const o = ((Math.floor(i / cols) * CELL) * w + (i % cols) * CELL) * 4; return [px[o], px[o + 1], px[o + 2]]; };
    const sameFn = gm.fragmentShader.includes("groundPaint(vW, N)") && G.GROUND_GLSL.includes("vec3 groundPaint(vec3 wpos, vec3 N)");
    mat.dispose(); g.dispose();
    return { at, sameFn };
  };
  if (groundMesh) {   // the painted ground, its mask and its cliffs: only an arena with ground.js ground pieces has them
    // ---- 1. the mask ---------------------------------------------------------------------------------------
    out.mask = {
      same: gm.uniforms.uMask.value === mask.texture && bank?.material.uniforms.uMask.value === mask.texture
            && rocks?.material.uniforms.uMask.value === mask.texture,
      size: [mask.texture.image.width, mask.texture.image.height], span: gm.uniforms.uMaskSpan.value,
      info: B.info.ground.mask, mipmaps: mask.texture.generateMipmaps, linear: mask.texture.magFilter === THREE.LinearFilter,
    };
    {
      const d = mask.texture.image.data, N = mask.texture.image.width, span = mask.span;
      let worst = 0, n = 0;
      for (let j = 3; j < N; j += 31) for (let i = 5; i < N; i += 37) {
        const x = (i + 0.5) / N * span - span / 2, z = (j + 0.5) / N * span - span / 2;
        const o = (j * N + i) * 4, s2 = mask.sample(x, z);
        worst = Math.max(worst, Math.abs(s2.dirt - d[o] / 255), Math.abs(s2.rock - d[o + 1] / 255),
                         Math.abs(s2.path - d[o + 2] / 255), Math.abs(s2.ao - d[o + 3] / 255));
        n++;
      }
      out.mask.twin = { err: worst, n };
    }
    {
      const ray = new THREE.Raycaster(); let worst = 0, n = 0;
      for (let k = 0; k < 400; k++) {
        const a = k / 400 * Math.PI * 2, rad = 250 + (k % 11) * 330;
        if (rad > 3800) continue;   // the flat floor only: on the rim a texel average is not the point height
        const x = Math.sin(a) * rad, z = Math.cos(a) * rad;
        ray.set(new THREE.Vector3(x, 1e5, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(groundMesh)[0];
        if (!hit) continue;
        n++; worst = Math.max(worst, Math.abs(hit.point.y - mask.heightAt(x, z)));
      }
      out.mask.height = { err: worst, n };
    }
    out.palette = { dirt: arr(gp.dirt), path: arr(gp.path), rockLo: arr(gp.rockLo), rockHi: arr(gp.rockHi), src: gp.src };
    // ---- 2. boundaries from the JS twin ---------------------------------------------------------------
    // the ground's own surface at a world point: the height a ray down finds and that triangle's face normal,
    // turned to point up. The ground mesh's triangles are wound facing down, so the DoubleSide material lights the
    // side it is seen from with -vN: seen from above, the up-turned normal is the one groundPaint() is given, and
    // this is what the paint probe below is told, so a plateau sample is the colour the eye would see there.
    const DOWN = new THREE.Vector3(0, -1, 0), gRay = new THREE.Raycaster(),
          gNM = new THREE.Matrix3().getNormalMatrix(groundMesh.matrixWorld);
    const surfaceAt = (x, z) => {
      gRay.set(new THREE.Vector3(x, 1e5, z), DOWN);
      const hit = gRay.intersectObject(groundMesh)[0];
      if (!hit) return null;
      const n = hit.face.normal.clone().applyMatrix3(gNM).normalize();
      if (n.y < 0) n.negate();
      return { y: hit.point.y, n: [n.x, n.y, n.z], slope: 1 - n.y };
    };
    // A boundary is where a mask amount crosses 0.5: that is where the shader's groundStep() flips. The amounts are
    // smooth fields hundreds of units across (the hard edge is the shader's fwidth step, NOT the texel grid), so the
    // two plateaus are read where the amount is 0.10 clear of 0.5 on each side - there the step is fully on or off -
    // and each side must be on gentle ground whose other steps are off, or the paint there is not this boundary's.
    const sitesOf = (channel, alsoClear) => {
      const sites = [];
      for (let a = 0; a < 24; a++) {
        const az = a / 24 * Math.PI * 2, sx = Math.sin(az), cz = Math.cos(az);
        let prev = null;
        for (let rad = 400; rad < 6400; rad += 5) {
          const v = mask.sample(sx * rad, cz * rad)[channel];
          if (prev && (prev[1] - 0.5) * (v - 0.5) <= 0) {
            const t = (0.5 - prev[1]) / (prev[1] - v || 1e-9);
            const rad0 = prev[0] + (rad - prev[0]) * t;
            const side = (dir) => {
              for (let d = 5; d <= 600; d += 5) {
                const r2 = rad0 + dir * d;
                if (r2 < 300 || r2 > 6500) return null;
                const s = mask.sample(sx * r2, cz * r2);
                if (Math.abs(s[channel] - 0.5) > 0.10) return { x: sx * r2, z: cz * r2, s };
              }
              return null;
            };
            const A = side(-1), B = side(1);
            if (!A || !B) continue;
            if ((A.s[channel] - 0.5) * (B.s[channel] - 0.5) >= 0) continue;      // touches 0.5 without crossing it
            const edge = surfaceAt(sx * rad0, cz * rad0);
            const sa = surfaceAt(A.x, A.z), sb = surfaceAt(B.x, B.z);
            if (!edge || !sa || !sb) continue;                                   // off the ground
            if (edge.slope > G.GROUND.CLIFF_LO - 0.01 || sa.slope > G.GROUND.CLIFF_LO - 0.01
                || sb.slope > G.GROUND.CLIFF_LO - 0.01) continue;                // the cliff paint would take it
            if (![A, B].every((q) => q.s.rock < 0.45 && alsoClear.every((c2) => q.s[c2] < 0.45))) continue;
            sites.push({ x: sx * rad0, z: cz * rad0, y: edge.y, A: { ...A, surf: sa }, B: { ...B, surf: sb } });
          }
          prev = [rad, v];
        }
      }
      return sites;
    };
    const dirtX = sitesOf("dirt", ["path"]), pathX = sitesOf("path", []);
    // ---- 3. plateau colours on the GPU, through the material's own groundPaint() --------------------------
    {
      const samples = [];
      for (const c of dirtX) {
        samples.push({ p: [c.A.x, c.A.surf.y, c.A.z], n: c.A.surf.n });
        samples.push({ p: [c.B.x, c.B.surf.y, c.B.z], n: c.B.surf.n });
      }
      const probe = paintProbe(samples);
      let errDirt = 0, errGrass = 0, n = 0;
      for (const [i, c] of dirtX.entries()) {
        const dirtFirst = c.A.s.dirt > 0.5;
        const dirtC = probe.at(dirtFirst ? i * 2 : i * 2 + 1), grassC = probe.at(dirtFirst ? i * 2 + 1 : i * 2);
        const grassP = dirtFirst ? c.B : c.A;
        const albedo = GS.groundAlbedo(gm.uniforms.uA.value, gm.uniforms.uB.value, [grassP.x, grassP.surf.y, grassP.z]);
        errDirt = Math.max(errDirt, ...dirtC.map((v, k) => Math.abs(v - out.palette.dirt[k])));
        errGrass = Math.max(errGrass, ...grassC.map((v, k) => Math.abs(v - albedo[k])));
        n++;
      }
      out.steps = { dirtX: dirtX.length, n, errDirt, errGrass, sameFn: probe.sameFn,
                    dirtBytes: bytes(out.palette.dirt), srcDirt: gp.src.dirt };
    }
    {
      const samples = [];
      for (const c of pathX) {
        samples.push({ p: [c.A.x, c.A.surf.y, c.A.z], n: c.A.surf.n });
        samples.push({ p: [c.B.x, c.B.surf.y, c.B.z], n: c.B.surf.n });
      }
      const probe = paintProbe(samples);
      let err = 0, n = 0;
      for (const [i, c] of pathX.entries()) {
        const inside = probe.at(c.A.s.path > 0.5 ? i * 2 : i * 2 + 1);
        err = Math.max(err, ...inside.map((v, k) => Math.abs(v - out.palette.path[k]))); n++;
      }
      out.pathStep = { crossings: pathX.length, n, err, bytes: bytes(out.palette.path), src: gp.src.path };
    }
    // ---- 4. the edge is HARD: render groundPaint at 960x720 through the arena camera and measure ----------
    {
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat });
      const dbg = new THREE.ShaderMaterial({ uniforms: gm.uniforms, side: THREE.DoubleSide, vertexShader: gm.vertexShader,
        fragmentShader: `varying vec3 vW; varying vec3 vN;
          ${S.NOISE_GLSL}
          ${S.LIGHT_GLSL}
          ${G.GROUND_GLSL}
          void main(){ vec3 N = normalize(gl_FrontFacing ? vN : -vN); gl_FragColor = vec4(groundPaint(vW, N), 1.0); }` });
      const hide = [];
      B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && o !== groundMesh) { hide.push(o); o.visible = false; } });
      const prevMat = groundMesh.material; groundMesh.material = dbg;
      const prevRT = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(B.scene, B.camera);
      const px = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
      R.setRenderTarget(prevRT); rt.dispose();
      groundMesh.material = prevMat;
      for (const o of hide) o.visible = true;
      const at = (x, y) => {   // bilinear read, top-left pixel coordinates
        const fx = Math.min(W - 1.001, Math.max(0, x)), fy = Math.min(H - 1.001, Math.max(0, y));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const g = (i, j, k) => px[((H - 1 - Math.min(H - 1, Math.max(0, j))) * W + Math.min(W - 1, Math.max(0, i))) * 4 + k];
        return [0, 1, 2].map((k) => (g(x0, y0, k) * (1 - tx) + g(x0 + 1, y0, k) * tx) * (1 - ty)
                               + (g(x0, y0 + 1, k) * (1 - tx) + g(x0 + 1, y0 + 1, k) * tx) * ty);
      };
      const PV = new THREE.Matrix4().multiplyMatrices(B.camera.projectionMatrix, B.camera.matrixWorldInverse);
      const v4 = new THREE.Vector4(), widths = [], widths2 = [], detail = [];
      let onScreen = 0, skipped = 0;
      // The profile is the colour step PLUS whatever the ground's own pattern does under it (the grass side drifts
      // across the 600-unit fbm while the walk crosses +-7 px), and a raw 10%-90% read would charge that drift to the
      // edge. So the step is measured by fitting u(t) = c0 + c1 t + A smoothstep(t0 - w, t0 + w, t) and taking the
      // fitted smoothstep's own 10%-90% span (1.216 w): a hard step fits w ~ 1 px whatever the pattern does, a real
      // blend fits a large w because the model can express one.
      const stepShape = (t, t0, w) => { const x = Math.min(1, Math.max(0, (t - t0 + w) / (2 * w))); return x * x * (3 - 2 * x); };
      const fitStep = (f) => {
        let best = { res: Infinity };
        for (let t0 = -2; t0 <= 2.001; t0 += 0.25) for (let w = 0.2; w <= 6.001; w += 0.2) {
          let s11 = 0, s12 = 0, s13 = 0, s22 = 0, s23 = 0, s33 = 0, b1 = 0, b2 = 0, b3 = 0;
          for (const q of f) { const t = q.t, u = q.u, s = stepShape(t, t0, w);
            s11++; s12 += t; s13 += s; s22 += t * t; s23 += t * s; s33 += s * s; b1 += u; b2 += t * u; b3 += s * u; }
          const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
          if (Math.abs(det) < 1e-12) continue;
          const c0 = (b1 * (s22 * s33 - s23 * s23) - s12 * (b2 * s33 - s23 * b3) + s13 * (b2 * s23 - s22 * b3)) / det;
          const c1 = (s11 * (b2 * s33 - s23 * b3) - b1 * (s12 * s33 - s23 * s13) + s13 * (s12 * b3 - b2 * s13)) / det;
          const A = (s11 * (s22 * b3 - b2 * s23) - s12 * (s12 * b3 - b2 * s13) + b1 * (s12 * s23 - s22 * s13)) / det;
          let res = 0;
          for (const q of f) { const e = q.u - (c0 + c1 * q.t + A * stepShape(q.t, t0, w)); res += e * e; }
          if (res < best.res) best = { res, t0, w, A };
        }
        return best;
      };
      // one straight cross-section through the boundary point, from -7 px to +7 px along (dx, dy), read against the
      // two colours the material is supposed to put there: the palette dirt and the grass pattern's albedo at this
      // site. u = 0 on grass, 1 on dirt, so a section that only sees pattern drift never spans 0..1 and is rejected.
      const section = (px, py, dx, dy, gc, dv, L2) => {
        const step = 0.25, span = 7, vals = [];
        for (let t = -span; t <= span + 1e-9; t += step) vals.push({ t, c: at(px + dx * t, py + dy * t) });
        let f = vals.map((s) => ({ t: s.t, u: s.c.reduce((acc, v, k) => acc + (v - gc[k]) * dv[k], 0) / L2 }));
        const u0 = f[0].u, u1 = f[f.length - 1].u;
        if (!((u0 <= 0.2 && u1 >= 0.8) || (u1 <= 0.2 && u0 >= 0.8))) return null;   // both plateaus on this line?
        if (f.some((q) => q.u < -0.25 || q.u > 1.25)) return null;                  // a third colour in the window
        if (u0 > u1) f = f.map((q) => ({ t: q.t, u: 1 - q.u }));                    // read it grass -> dirt
        const fit = fitStep(f);
        let peak = 0; for (let i = 1; i < f.length; i++) peak = Math.max(peak, Math.abs(f[i].u - f[i - 1].u) / step);
        return { L2, fit, peak, w: fit.A >= 0.5 ? 1.216 * fit.w : null, w2: peak > 1e-3 ? 1 / peak : null,
                 prof: f.map((q) => +q.u.toFixed(3)) };
      };
      for (const c of dirtX) {
        v4.set(c.x, c.y, c.z, 1).applyMatrix4(PV);
        if (v4.w <= 1) continue;
        const px0 = (v4.x / v4.w * 0.5 + 0.5) * W, py0 = (0.5 - v4.y / v4.w * 0.5) * H;
        if (px0 < 12 || py0 < 12 || px0 > W - 12 || py0 > H - 12) continue;
        onScreen++;
        const grassP = c.A.s.dirt > 0.5 ? c.B : c.A;
        const gc = GS.groundAlbedo(gm.uniforms.uA.value, gm.uniforms.uB.value, [grassP.x, grassP.surf.y, grassP.z]);
        const dv = out.palette.dirt.map((v, k) => v - gc[k]), L2 = dv.reduce((s, v) => s + v * v, 0);
        if (L2 < 0.004) { skipped++; continue; }        // the dirt colour is too close to the grass here to measure
        // The edge is read in 8 directions through the boundary point and the NARROWEST usable crossing is taken: for
        // a line-like edge one of them is the perpendicular, and a colour event that lies along the other directions
        // cannot widen it. A blend is wide whichever way it is crossed, so this cannot hide one.
        let best = null;
        for (let k = 0; k < 8; k++) {
          const ang = k * Math.PI / 4;
          const s = section(px0, py0, Math.cos(ang), Math.sin(ang), gc, dv, L2);
          if (!s || s.w == null) continue;
          if (!best || s.w < best.w) best = { ...s, dir: k };
        }
        if (!best) { skipped++; continue; }
        widths.push(best.w);
        if (best.w2 != null) widths2.push(best.w2);
        detail.push({ w: best.w, w2: best.w2, fitW: best.fit.w, fitA: best.fit.A, dir: best.dir,
                      px: Math.round(px0), py: Math.round(py0), dist: Math.round(v4.w),
                      r: Math.round(Math.hypot(c.x, c.z)), l2: L2,
                      dA: c.A.d, dB: c.B.d, mA: +c.A.s.dirt.toFixed(3), mB: +c.B.s.dirt.toFixed(3),
                      texelPx: +(28.1 / (2 * v4.w * Math.tan(B.camera.fov * Math.PI / 360) / H)).toFixed(2),
                      prof: best.w > 2.5 ? best.prof : undefined });
      }
      out.edge = { measured: widths.length, onScreen, skipped, widths, widths2, detail, W, H, eye: cam.eye.map(Math.round) };
    }
    // ---- 5. cliffs: steep ground triangles are painted rock -----------------------------------------------
    {
      const Pp = groundMesh.geometry.attributes.position, Nn = groundMesh.geometry.attributes.normal;
      const steep = [], band = [];
      let up = 0;
      for (let t = 0; t < Pp.count; t += 3) {
        const nx = Nn.getX(t), ny = Nn.getY(t), nz = Nn.getZ(t), len = Math.hypot(nx, ny, nz) || 1;
        const sgn = ny < 0 ? -1 : 1;
        const n = [nx / len * sgn, ny / len * sgn, nz / len * sgn];      // face normal, turned to point up
        if (n[1] > 0) up++;
        const slope = 1 - n[1];
        if (slope < G.GROUND.CLIFF_LO) continue;
        const c = [0, 1, 2].map((k) => (Pp.getX(t + k) + Pp.getX(t + 1 + k) + Pp.getX(t + 2 + k)) / 3);
        const e = { p: c, n, slope };
        steep.push(e); if (slope >= G.GROUND.CLIFF_HI) band.push(e);
      }
      const lo = steep.filter((e) => e.slope < G.GROUND.CLIFF_HI).slice(0, 200);   // the soft band paints rockLo
      const hi = band.slice(0, 200);                                              // past the hard band paints rockHi
      const pr = paintProbe(lo.concat(hi));
      let errLo = 0, errHi = 0;
      lo.forEach((e, i) => { errLo = Math.max(errLo, ...pr.at(i).map((v, k) => Math.abs(v - out.palette.rockLo[k]))); });
      hi.forEach((e, i) => { errHi = Math.max(errHi, ...pr.at(lo.length + i).map((v, k) => Math.abs(v - out.palette.rockHi[k]))); });
      out.cliff = { tris: Pp.count / 3, steep: steep.length, lo: lo.length, band: band.length, hi: hi.length, errLo, errHi,
                    upFrac: up / (Pp.count / 3), slopeLo: G.GROUND.CLIFF_LO, slopeHi: G.GROUND.CLIFF_HI,
                    maxSlope: steep.reduce((m, e) => Math.max(m, e.slope), 0) };
    }
  }
  // ---- 6. draw calls and triangles of the layer alone ---------------------------------------------------
  {
    const meshes = B.ground.meshes();
    const hide = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && !meshes.includes(o)) { hide.push(o); o.visible = false; } });
    B.render(cam); out.layer = { calls: B.info.calls, triangles: B.info.triangles };
    for (const o of hide) o.visible = true;
    B.render(cam); const all = B.info.calls, allT = B.info.triangles;
    B.ground.setVisible(false); B.render(cam);
    out.layer.delta = all - B.info.calls; out.layer.deltaTris = allT - B.info.triangles;
    B.ground.setVisible(true); B.render(cam);
    out.layer.meshes = meshes.length;
  }
  out.parts = B.info.ground.parts; out.info = B.info.ground;
  // ---- 7. bases, keep-out and the ribbons' radius -------------------------------------------------------
  {
    const seen = window.__seen || [], fighters = [], eyes = [];
    for (const s of seen) {
      if (!eyes.some((e) => Math.hypot(e[0] - s.eye[0], e[1] - s.eye[1], e[2] - s.eye[2]) < 25)) eyes.push(s.eye);
      for (const f of s.fighters) { const g = fighters.find((g) => Math.hypot(g.c[0] - f.c[0], g.c[1] - f.c[1], g.c[2] - f.c[2]) < 50); if (!g) fighters.push({ ...f }); else g.r = Math.max(g.r, f.r); }
    }
    const fightR = Math.max(...fighters.map((f) => Math.hypot(f.c[0], f.c[2]))) + 1000;
    const rings = [];
    for (const e of eyes) { const rad = Math.hypot(e[0], e[2]); if (!rings.some((g) => Math.abs(g[0] - rad) < 100 && Math.abs(g[1] - e[1]) < 100)) rings.push([rad, e[1]]); }
    for (const [rad, y] of rings) for (let a = 0; a < 360; a += 3) eyes.push([Math.sin(a * Math.PI / 180) * rad, y, Math.cos(a * Math.PI / 180) * rad]);
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
    // the surface a boulder is buried in: the ground.js ground, or none in this arena (a beach's boulders sit on sand.js)
    const gAt = groundMesh ? ((x, z) => { ray.set(new THREE.Vector3(x, 1e5, z), down); const h = ray.intersectObject(groundMesh)[0]; return h ? h.point.y : null; }) : (() => null);
    const M = new THREE.Matrix4(), v = new THREE.Vector3();
    const inCone = (c) => eyes.some((e) => fighters.some((f) => S.inViewCone(c, 0, e, f.c, f.r)));
    rocks = getRocks();
    let rv = 0, rFight = 0, rCone = 0, baseN = 0, baseUnder = 0, baseErr = -Infinity, deepest = 0;
    if (rocks) {
      const hull = rocks.geometry.attributes.position;
      for (let i = 0; i < rocks.count; i++) {
        rocks.getMatrixAt(i, M); M.premultiply(rocks.matrixWorld);
        const sy = Math.hypot(M.elements[4], M.elements[5], M.elements[6]);
        for (let j = 0; j < hull.count; j++) {
          v.fromBufferAttribute(hull, j).applyMatrix4(M); rv++;
          if (Math.hypot(v.x, v.z) < fightR) rFight++;
          if (inCone([v.x, v.y, v.z])) rCone++;
          if (hull.getY(j) < -0.02) {          // a vertex of the buried part (object space, height normalised to 1)
            const g = gAt(v.x, v.z); if (g == null) continue;
            baseN++; const e = v.y - g;
            baseErr = Math.max(baseErr, e); deepest = Math.min(deepest, e);
            if (e <= 1e-6) baseUnder++;
          }
        }
      }
    }
    const scan = (mesh) => {
      if (!mesh) return { verts: 0, inFight: 0, inCone: 0, minR: Infinity, maxR: 0, minY: Infinity };
      const P = mesh.geometry.attributes.position;
      let verts = 0, inFight = 0, inConeN = 0, minR = Infinity, maxR = 0, minY = Infinity;
      for (let j = 0; j < P.count; j++) {
        v.fromBufferAttribute(P, j).applyMatrix4(mesh.matrixWorld); verts++;
        const rad = Math.hypot(v.x, v.z); minR = Math.min(minR, rad); maxR = Math.max(maxR, rad); minY = Math.min(minY, v.y);
        if (rad < fightR) inFight++;
        if (inCone([v.x, v.y, v.z])) inConeN++;
      }
      return { verts, inFight, inCone: inConeN, minR, maxR, minY };
    };
    out.keep = { fightR: Math.round(fightR), farthest: Math.round(fightR - 1000), fighters: fighters.length,
                 eyes: eyes.length, rings: rings.map((g) => [Math.round(g[0]), Math.round(g[1])]),
                 rocks: { verts: rv, inFight: rFight, inCone: rCone, count: rocks?.count ?? 0 },
                 bank: scan(bank), hills: scan(hills) };
    out.keep.bases = { rocks: baseN, under: baseUnder, maxErr: baseErr, deepest };
    let gMax = null;
    if (groundMesh) {
      gMax = 0; const gpa = groundMesh.geometry.attributes.position;
      for (let j = 0; j < gpa.count; j++) gMax = Math.max(gMax, Math.hypot(gpa.getX(j), gpa.getZ(j)));
    }
    out.keep.groundRadius = gMax;
  }
  // ---- 8. shared uniforms, programs, frame time ---------------------------------------------------------
  {
    const mats = new Set(); for (const m of B.materials) mats.add(m);
    let bad = 0, refs = 0;
    for (const m of mats) for (const k of Object.keys(S.U)) { refs++; if (m.uniforms[k] !== S.U[k]) bad++; }
    out.uniforms = { materials: mats.size, refs, bad, sameModule: B.shared.U === S.U };
    out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
    const gl = R.getContext(), one = new Uint8Array(4);
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");   // the real backend, not "WebKit WebGL"
    const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
    time(10);
    B.ground.setVisible(true); const shown = time(FRAMES);
    B.ground.setVisible(false); const hidden = time(FRAMES);
    B.ground.setVisible(true);
    out.frame = { shown, hidden, frames: FRAMES, gpu: GPU,
                  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  }
  out.material = groundMesh ? { kind: groundMesh.userData.kind, transparent: gm.transparent, side: gm.side,
                   pattern: !!gm.uniforms.uA && !!gm.uniforms.uB && gm.uniforms.uScale.value === GS.GROUND_SCALE,
                   rocks: rocks ? { count: rocks.count, tris: rocks.geometry.attributes.position.count / 3,
                                    instanced: !!rocks.isInstancedMesh, transparent: rocks.material.transparent } : null } : null;
  out.rocksMesh = rocks ? { count: rocks.count, tris: rocks.geometry.attributes.position.count / 3,
                            instanced: !!rocks.isInstancedMesh, transparent: rocks.material.transparent } : null;
  out.view = { W, H };
  out.rocksInfo = B.info.ground.rocks;
  return out;
}, { frames: FRAMES, gpu: gpuMode() });
await browser.close().catch(() => {});

// ---- report -----------------------------------------------------------------------------------------------
if (R0.missing) { console.log("FAIL built arena did not load (window.__built missing)"); for (const e of errors) console.log("   error:", e); process.exit(1); }
let skips = 0;
const skip = (msg) => { skips++; console.log(`SKIP ${msg}`); };
const m = R0.mask, p = R0.parts, L = R0.layer, k = R0.keep, b = k.bases, f = R0.frame;
const c = R0.cliff, st = R0.steps, ps = R0.pathStep;
const inv = R0.inv, hasGround = R0.hasGround;
const floorKinds = ["grass", "sand", "shore"].filter((q) => inv.kinds[q]).map((q) => `${q} x${inv.kinds[q]}`).join(", ") || "none";
// what is missing, measured: the check list below says which checks need it
const noGround = `no ground.js ground in ${ARENA}: ${inv.grass} meshes of kind "grass" (floor ${floorKinds}; the baked mask has ${R0.info.mask.groundTexels} texels on the ground)`;
console.log(`     (info) this arena: ${inv.grass} ground.js ground mesh(es) of kind "grass", ${inv.bank ? 1 : 0} bank, ` +
  `${inv.rocks} boulder(s), hills ${inv.hills ? "yes" : "no"}; floor kinds ${floorKinds}`);
if (hasGround) {
  console.log(`     (info) mask ${m.size[0]}x${m.size[1]} over ${m.span} units (texel ${m.info.texel.toFixed(1)}), baked ${m.info.ms} ms, ${m.info.groundTexels} texels on the ground, ${m.linear ? "linear" : "nearest"} filter, mipmaps ${m.mipmaps}`);
  check(m.same, `one mask texture, the same object on the ground, the bank and the boulders`);
  check(m.twin.err < 1 / 255 && m.twin.n > 100, `mask JS twin = the texture's own bytes: max error ${m.twin.err.toExponential(2)} on ${m.twin.n} texels (< 1/255)`);
  check(m.height.err < 1 && m.height.n > 100, `mask sits on the ground: baked height vs a ray down, max |diff| ${m.height.err.toExponential(2)} units on ${m.height.n} floor points`);
  check(st.sameFn && st.dirtX >= 6, `the paint check runs the ground material's own groundPaint() (${st.dirtX} grass/dirt boundaries)`);
  check(st.errDirt < 1 / 255, `dirt step = the measured palette entry: max error ${st.errDirt.toExponential(2)} linear on ${st.n} samples (dirt ${JSON.stringify(gpBytes(st.srcDirt))} -> ${st.dirtBytes.map((v) => v.toFixed(1))})`);
  check(st.errGrass < 1 / 255, `grass step = the pattern grass.js bakes blades against: max error ${st.errGrass.toExponential(2)} on ${st.n} samples`);
  check(ps.n >= 3 && ps.err < 1 / 255, `path step = the measured palette entry: max error ${ps.err.toExponential(2)} on ${ps.n} path crossings (${JSON.stringify(gpBytes(ps.src))} -> ${ps.bytes.map((v) => v.toFixed(1))})`);
  const wmax = Math.max(...R0.edge.widths), w2max = Math.max(...R0.edge.widths2);
  check(R0.edge.measured >= 6 && wmax <= 3 && w2max <= 3,
    `colour steps are HARD: ${R0.edge.measured} of ${R0.edge.onScreen} dirt/grass boundaries on screen at ${R0.edge.W}x${R0.edge.H} (${R0.edge.skipped} skipped: a third colour crosses the walk), 10%-90% step width max ${wmax.toFixed(2)} px, change/peak-gradient max ${w2max.toFixed(2)} px (<= 3)`);
  check(c.steep > 0 && c.lo > 0 && c.errLo < 1 / 255 && c.errHi < 1 / 255,
    `cliffs: ${c.steep} of ${c.tris} ground triangles past the slope threshold ${c.slopeLo} (24 deg; steepest ${(Math.acos(1 - c.maxSlope) * 180 / Math.PI).toFixed(1)} deg), ${c.band} past the hard band ${c.slopeHi}; painted rock within ${Math.max(c.errLo, c.errHi).toExponential(2)} of the palette`);
} else {
  skip(`the mask is one texture on the ground, the bank and the boulders: ${noGround}, so there is no ground or bank material to share it with (boulders: ${inv.rocks})`);
  skip(`mask JS twin = the texture's own bytes: ${noGround} — 0 of 0 texels to compare`);
  skip(`mask sits on the ground (baked height vs a ray down): ${noGround}, so a ray down finds no ground mesh`);
  skip(`the paint check runs the ground material's own groundPaint(): ${noGround}, so there is no groundPaint() material`);
  skip(`dirt step = the measured palette entry: ${noGround}, so there are 0 grass/dirt boundaries to sample`);
  skip(`grass step = the pattern grass.js bakes blades against: ${noGround}, so there is 0 ground albedo to compare with`);
  skip(`path step = the measured palette entry: ${noGround}, so there are 0 path crossings to sample`);
  skip(`colour steps are HARD (10%-90% step width): ${noGround}, so 0 boundaries are on screen to measure`);
  skip(`cliffs: ${noGround}, so 0 of 0 ground triangles carry a slope`);
}
console.log(`     (info) triangles: ground ${p.ground.tris} + bank ${p.bank.tris} + boulders ${p.rocks.tris} (${p.rocks.count} x ${p.rocks.trisPerRock ?? "-"}) + hills ${p.hills.tris} (${p.hills.ribbons} ribbons) = ${R0.info.triangles}`);
if (p.rocks.count > 0) check(p.rocks.trisPerRock === 36, `boulder hulls: ${p.rocks.trisPerRock} triangles each (ConvexGeometry, 20 points)`);
else skip(`boulder hulls: ${ARENA} places 0 boulders (info.ground.parts.rocks.count 0), so there is no hull to measure`);
check(L.calls <= 9, `Step 3 draw calls: ${L.calls} alone, ${L.delta} added to the frame (<= 9), ${L.triangles} triangles drawn`);
check(R0.info.triangles <= 33000, `Step 3 triangles ${R0.info.triangles} (<= 33k) in ${L.meshes} meshes`);
if (hasGround) check(b.rocks > 0 && b.maxErr <= 1e-6 && b.under === b.rocks,
  `every boulder base on or below the ground: ${b.rocks} buried vertices, ${b.under} below, max (vertex - ground) ${b.maxErr <= 0 ? b.maxErr.toExponential(2) : b.maxErr} (<= 0), deepest ${Math.round(-b.deepest)} units under`);
else skip(`every boulder base on or below the ground: ${noGround}, so the ${inv.rocks} boulder(s) have no ground.js surface to be measured against`);
if (k.hills.verts > 0) {
  check(k.hills.minY <= 0, `hill bases below the arena floor: lowest ribbon vertex y ${Math.round(k.hills.minY)} (<= 0)`);
  if (hasGround) check(k.hills.minR > k.groundRadius, `ribbons only past the ground's edge: nearest ribbon vertex r ${Math.round(k.hills.minR)} > ground radius ${Math.round(k.groundRadius)}`);
  else skip(`ribbons only past the ground's edge: ${noGround}, so there is no ground radius to compare the nearest ribbon vertex r ${Math.round(k.hills.minR)} with`);
} else {
  skip(`hill bases below the arena floor: ${noGround}, so ground.js builds no hill ribbons here (info.ground.parts.hills: ${JSON.stringify(R0.info.parts.hills)}) and there is no vertex to measure`);
}
console.log(`     (info) keep-out: fight radius ${k.fightR} = farthest fighter ${k.farthest} + 1000, ${k.fighters} fighter spheres, ${k.eyes} eyes (rings ${JSON.stringify(k.rings)}); boulders ${JSON.stringify(R0.rocksInfo && { candidates: R0.rocksInfo.candidates, accepted: R0.rocksInfo.accepted, pushed: R0.rocksInfo.pushed, dropped: R0.rocksInfo.dropped, byReason: R0.rocksInfo.byReason, ms: R0.rocksInfo.ms })}`);
if (k.rocks.count > 0) check(k.rocks.inFight === 0 && k.rocks.inCone === 0, `boulders outside the fight and the cones: ${k.rocks.verts} vertices (${k.rocks.count} rocks), ${k.rocks.inFight} inside ${k.fightR}, ${k.rocks.inCone} in a cone`);
else skip(`boulders outside the fight and the cones: ${ARENA} places 0 boulders, so there are 0 vertices to test`);
if (k.bank.verts > 0) check(k.bank.inFight === 0 && k.bank.inCone === 0 && k.bank.verts > 0, `bank outside the fight and the cones: ${k.bank.verts} vertices, ${k.bank.inFight} inside, ${k.bank.inCone} in a cone`);
else skip(`bank outside the fight and the cones: ${ARENA} draws no bank (0 bank pieces in the recipe), so there are 0 vertices to test`);
if (k.hills.verts > 0) check(k.hills.inFight === 0 && k.hills.inCone === 0, `hills outside the fight and the cones: ${k.hills.verts} vertices, ${k.hills.inFight} inside, ${k.hills.inCone} in a cone`);
else skip(`hills outside the fight and the cones: ${ARENA} builds no hill ribbons (no grass ground), so there are 0 vertices to test`);
const u = R0.uniforms;
check(u.bad === 0 && u.sameModule, `one shared uniform object: ${u.materials} materials x ${(u.refs / u.materials).toFixed(0)} uniforms, ${u.bad} not the same reference`);
check(R0.programs.failed === 0, `shader programs compile: ${R0.programs.count}, ${R0.programs.failed} failed`);
if (hasGround) check(R0.material.pattern && !R0.material.transparent, `ground material keeps grass.js's pattern uniforms (uA/uB/uScale) and is opaque`);
else skip(`ground material keeps grass.js's pattern uniforms (uA/uB/uScale) and is opaque: ${noGround}, so there is no ground material`);
if (R0.rocksMesh) check(!!R0.rocksMesh.instanced && R0.rocksMesh.transparent === false, `boulders: one InstancedMesh, ${R0.rocksMesh.count} instances x ${R0.rocksMesh.tris} triangles`);
else skip(`boulders: one InstancedMesh: ${ARENA} places 0 boulders`);
if (process.env.EDGE_DEBUG && hasGround) { console.table(R0.edge.detail); for (const d of R0.edge.detail) if (d.prof) console.log("prof", d.px, d.py, d.r, JSON.stringify(d.prof)); }
const dt = f.shown - f.hidden;
const belowNoise = Math.abs(dt) < 0.3;   // 0.3 ms: what a frame-time sample on this box can resolve
const V = R0.edge || R0.view;
console.log(`     (info) frame time over ${f.frames} frames at ${V.W}x${V.H} (${f.gpu} path): layer shown ${f.shown.toFixed(2)} ms, hidden ${f.hidden.toFixed(2)} ms, delta ${dt.toFixed(2)} ms; renderer ${f.renderer}`
  + (belowNoise ? ` - below the 0.3 ms resolution of this measurement, so no layer cost is claimed` : ``));
check(f.shown > 0 && f.hidden > 0 && f.frames >= 20, `frame time measured over ${f.frames} frames each (FRAMES env; 120 by default)`);
for (const er of errors) console.log("   error:", er);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails);

function gpBytes(src) { return { r: src[0], g: src[1], b: src[2] }; }
