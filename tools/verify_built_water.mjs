// Numbers check of the BUILT arena's WATER + SEA (web/built/water.js; beach arenas, meft1002). No pictures: every
// number below is read back from the GPU as data (float render targets) or computed from the recipe.
//  1 errors: page errors (the NaN bounding-sphere error is traced to the mesh that owns the geometry and reported by
//    name; it counts against THIS check only when the geometry is one of the water's own); every program compiles
//  2 waterline vs the real land edge, per 10 deg: the land edge is found INDEPENDENTLY here (point-in-triangle march
//    over the recipe's own sand + shore triangles), then compared with (a) the baked field's zero crossing read off
//    the GPU along the same ray and (b) the sea's inner-ring radius function waterlineAt(); each direction is named
//    beach (sand meets sea) or bank (the shore piece stands between the sand and the sea)
//  3 the thin band: the module's own sandWater() (what sand.js paints with) on the GPU at every 50-unit sand sample
//    over 64 times (3.7 swash periods): how far inland wetness > 0.02 and the film reach, per direction; both must be
//    <= WET_MAX (+ 1 field texel); the share of the sand that is ever wet; NO wetness on sand nearer the bank than the sea
//  4 below-horizon coverage from the viewer camera turned to 12 directions (30 deg apart): an id pass (land/ground,
//    sea, band; sky, clouds, trees, blades, gulls and spires hidden, so only the ground and the water count) -> the
//    share of below-horizon pixels that hit NO surface (~0), and the sea pixels drawn where the field says land
//    (poke-through through the sand, must be 0)
//  5 colours: the module's own seaRamp() on the GPU = the sea piece's measured rows (<= 2/255), the far body = the
//    far row; on screen (sea pixels by distance offshore): turquoise near, deep blue far
//  6 moving foam: the bore line's mean distance offshore through one swash period (it must run in)
//  7 horizon: the sea's last pixels below the horizon vs the sky's first above it, per column (rendered frame;
//    clouds, cloud skirt and gulls hidden, they drift through those rows)
//  8 opaque, shared uniforms, polygon offset; the 'water and sea' layer switch hides/shows both meshes
//  9 cost: frame time at 960x720 over FRAMES (600) frames, water shown vs hidden: <= 1 ms
// 10 stripes: from the viewer camera at 6 directions, on the open sea (beyond the foam), the row-to-row colour
//    change per 32-px column segment and how far a row leaves the straight gradient through its neighbours (d2),
//    plus the per-pixel row-to-row change; must be small (user, 2026-10-30: "weird different color lines")
// 11 continuity in time: foam, bore, lace (sea) and film, foam edge, wetness (sand) at 3000+ points over two
//    swash periods at 1/60 s: the largest change between two frames (user: "the waves reset")
//   VERIFY_PORT=8090 ARENA=meft1002 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_water.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 600));
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [], nan = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", async (m) => {
  if (m.type() !== "error" || /^Failed to load resource/.test(m.text())) return;
  if (/Computed radius is NaN/.test(m.text())) {
    const g = m.args()[1];
    nan.push(g ? await g.evaluate((geo) => { (window.__nanGeos ||= []).push(geo); return geo.uuid; }).catch(() => null) : null);
    return;
  }
  errors.push(m.text().slice(0, 400));
});
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built&post=0`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
for (let k = 0; k < 3; k++) await page.waitForTimeout(1000);
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const loaded = await page.evaluate(() => ({ water: !!window.__built?.info?.water, layers: Object.keys(window.__built?.info?.layers || {}) }));
if (!loaded.water) {
  console.log(`SKIP ${ARENA}: no water/sea in this arena's built world (layers ${JSON.stringify(loaded.layers)})`);
  // the NaN error is still traced, so the report names it on every arena
  const owners = await page.evaluate(() => (window.__nanGeos || []).map((g) => { let o = null; window.__built?.scene?.traverse((q) => { if (q.geometry === g) o = { mesh: q.name, kind: q.userData?.kind || null }; }); return o; }));
  if (owners.length) console.log(`     (info) NaN bounding sphere on ${ARENA}: ${JSON.stringify(owners)}`);
  for (const e of errors) console.log("   error:", e);
  await browser.close().catch(() => {});
  process.exit(errors.length ? 1 : 0);
}

const R0 = await page.evaluate(async ({ FRAMES }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const W = await import("./built/water.js");
  const B = window.__built, rr = window.__r, R = B.renderer;
  const layer = B.layers.find((l) => l.id === "water");
  const meshes = layer.meshes, mats = layer.materials, F = layer.field;
  const sea = meshes.find((m) => m.name === "sea_surface"), band = meshes.find((m) => m.name === "sea_horizon");
  const rec = await fetch(`assets-hd/battle/built/${B.info.pack}.json`, { cache: "no-store" }).then((x) => x.json());
  const P = W.WATER, out = { info: B.info.water };
  const toSrgb = (v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
  out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  // NaN owners
  out.nan = (window.__nanGeos || []).map((g) => { let o = null; B.scene.traverse((q) => { if (q.geometry === g) o = { mesh: q.name, kind: q.userData?.kind || null, water: meshes.includes(q) }; }); return o || { mesh: null }; });

  // a point probe: one GL point per sample, its fragment returns vec4 numbers (float target)
  const probe = (xz, uniforms, body, extraUniforms = "") => {
    const n = xz.length / 2, COLS = 1024, ROWS = Math.max(1, Math.ceil(n / COLS));
    const pos = new Float32Array(COLS * ROWS * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = xz[i * 2]; pos[i * 3 + 2] = xz[i * 2 + 1]; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({ uniforms,
      vertexShader: `varying vec2 vXZ; void main(){ vXZ = position.xz; gl_PointSize = 1.0; float i = float(gl_VertexID);
        gl_Position = vec4((mod(i, ${COLS}.0) + 0.5) / ${COLS}.0 * 2.0 - 1.0, (floor(i / ${COLS}.0) + 0.5) / ${ROWS}.0 * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec2 vXZ; ${extraUniforms} ${S.NOISE_GLSL} ${S.LIGHT_GLSL} ${W.SHORE_GLSL} ${W.WATER_BODY_GLSL} ${W.SEA_GLSL}
        void main(){ ${body} }` });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
    const rt = new THREE.WebGLRenderTarget(COLS, ROWS, { type: THREE.FloatType });
    const px = new Float32Array(COLS * ROWS * 4);
    const prev = R.getRenderTarget();
    R.setRenderTarget(rt); R.setClearColor(0, 0); R.clear(); R.render(new THREE.Scene().add(pts), new THREE.Camera());
    R.readRenderTargetPixels(rt, 0, 0, COLS, ROWS, px); R.setRenderTarget(prev);
    rt.dispose(); mat.dispose(); g.dispose();
    return px;
  };
  const U = (extra = {}) => Object.assign({}, sea.material.uniforms, extra);

  // ---------------- 2. waterline vs the real land edge ----------------
  const land = rec.pieces.filter((p) => p.kind === "sand" || p.kind === "shore");
  const sandP = rec.pieces.filter((p) => p.kind === "sand");
  const inTris = (pieces, x, z) => {
    for (const p of pieces) for (let t = 0; t < p.pos.length; t += 9) {
      const ax = p.pos[t], az = p.pos[t + 2], bx = p.pos[t + 3], bz = p.pos[t + 5], cx = p.pos[t + 6], cz = p.pos[t + 8];
      const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  };
  const edgeAlong = (pieces, dx, dz) => { for (let r = 12000; r > 0; r -= 4) if (inTris(pieces, dx * r, dz * r)) return r; return 0; };
  const dirs = [];
  for (let k = 0; k < 36; k++) {
    const az = (-175 + 10 * k) * Math.PI / 180, dx = Math.sin(az), dz = Math.cos(az);
    dirs.push({ deg: -175 + 10 * k, dx, dz, land: edgeAlong(land, dx, dz), sand: edgeAlong(sandP, dx, dz), ring: W.waterlineAt(F, az), smooth: W.smoothWaterlineAt(F.smooth, az) });
  }
  {   // the baked field's zero crossing along each ray (GPU), -600 .. +600 units round the land edge, 3-unit steps
    const N = 401, xz = [];
    for (const d of dirs) for (let i = 0; i < N; i++) { const r = d.land - 600 + i * 3; xz.push(d.dx * r, d.dz * r); }
    const px = probe(xz, U(), `gl_FragColor = vec4(shoreDist(vXZ), 0.0, 0.0, 1.0);`);
    dirs.forEach((d, k) => {
      let zc = null;
      for (let i = 1; i < N; i++) { const a = px[(k * N + i - 1) * 4], b = px[(k * N + i) * 4]; if (a > 0 && b <= 0) { zc = d.land - 600 + (i - 1 + a / (a - b)) * 3; } }
      d.field = zc;
      d.kind = d.land - d.sand > 60 ? "bank" : "beach";
    });
  }
  out.waterline = dirs.map((d) => ({ deg: d.deg, kind: d.kind, sand: d.sand, land: d.land, field: d.field == null ? null : Math.round(d.field), ring: Math.round(d.ring),
                                     errField: d.field == null ? null : Math.round(d.field - d.smooth), errRing: Math.round(d.ring - d.land),
                                     smooth: Math.round(d.smooth), inland: Math.round(d.land - d.smooth) }));
  {   // corners: the land outline's turn at each vertex vs the smooth line's largest turn over any 100 units of it
    const O = F.outline, k = (p) => p[0].toFixed(2) + "," + p[1].toFixed(2), nx = new Map();
    for (const e of O) { if (!nx.has(k(e.a))) nx.set(k(e.a), []); nx.get(k(e.a)).push(e); }
    const used = new Set(), turns = [];
    for (const e0 of O) {
      if (used.has(e0)) continue; const L = []; let e = e0;
      while (e && !used.has(e)) { used.add(e); L.push(e.a); e = (nx.get(k(e.b)) || []).find((q) => !used.has(q)); }
      for (let i = 0; i < L.length; i++) {
        const a = L[(i + L.length - 1) % L.length], p = L[i], b = L[(i + 1) % L.length];
        const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
        turns.push(Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])) * 180 / Math.PI);
      }
    }
    const sm = F.smooth, n = sm.n, P = Array.from({ length: n }, (_, i) => [Math.sin(sm.az[i]) * sm.r[i], Math.cos(sm.az[i]) * sm.r[i]]);
    const hd = P.map((p, i) => { const q = P[(i + 1) % n]; return [Math.atan2(q[1] - p[1], q[0] - p[0]), Math.hypot(q[0] - p[0], q[1] - p[1])]; });
    let worst = 0, seg = 0, worstAz = null;
    for (let i = 0; i < n; i++) {   // the heading change from sample i over the next 100 units of curve
      let L = 0, j = i; while (L < 100) { L += hd[j % n][1]; j++; }
      let dA = hd[j % n][0] - hd[i][0]; dA = Math.abs(Math.atan2(Math.sin(dA), Math.cos(dA))) * 180 / Math.PI;
      if (dA > worst) { worst = dA; worstAz = sm.az[i] * 180 / Math.PI; } seg = Math.max(seg, hd[i][1]);
    }
    const real = turns.filter((t) => t < 170).sort((p, q) => q - p);
    out.corners = { vertices: turns.length, polyMax: +real[0].toFixed(1), polyOver20: real.filter((t) => t > 20).length, slits: turns.length - real.length,
                    smoothPer100: +worst.toFixed(1), worstAz: +worstAz.toFixed(1), smoothSeg: Math.round(seg), sigma: sm.sigma, dev: sm.dev, clamped: sm.clamped };
  }

  // ---------------- 3. the thin band: sandWater() over the sand ----------------
  {
    const span = F.span, size = F.size, upx = 2 * span / size, xz = [];
    for (let z = -6000; z <= 6000; z += 50) for (let x = -6000; x <= 6000; x += 50) {
      const i = Math.floor((x + span) / upx), j = Math.floor((z + span) / upx);
      if (F.onSand[j * size + i]) xz.push(x, z);
    }
    const n = xz.length / 2, T = 64;
    const maxWet = new Float32Array(n), maxFilm = new Float32Array(n), maxEdge = new Float32Array(n), dd = new Float32Array(n), db = new Float32Array(n);
    const uT = { value: 0 };
    for (let k = 0; k < T; k++) {
      uT.value = 100 + k * 0.37;
      const px = probe(xz, U({ uT }), `vec4 s = shoreTap(vXZ); vec3 w = sandWater(vXZ, uT); gl_FragColor = vec4(w.x, w.z, s.r, w.y + (s.a < s.r ? -1.0 : 0.0));`, "uniform float uT;");
      for (let i = 0; i < n; i++) {
        maxFilm[i] = Math.max(maxFilm[i], px[i * 4]); maxWet[i] = Math.max(maxWet[i], px[i * 4 + 1]); dd[i] = px[i * 4 + 2];
        const e = px[i * 4 + 3]; db[i] = e < -0.5 ? 1 : 0; maxEdge[i] = Math.max(maxEdge[i], e < -0.5 ? e + 1 : e);
      }
    }
    const bins = Array.from({ length: 36 }, () => ({ wet: 0, film: 0, n: 0, wetN: 0 }));
    let wetN = 0, filmN = 0, edgeN = 0, bankN = 0, bankWet = 0, maxWetD = 0, maxFilmD = 0;
    for (let i = 0; i < n; i++) {
      const az = Math.atan2(xz[i * 2], xz[i * 2 + 1]) * 180 / Math.PI, b = Math.min(35, Math.floor((az + 180) / 10)), q = bins[b];
      q.n++;
      if (maxWet[i] > 0.02) { wetN++; q.wetN++; q.wet = Math.max(q.wet, dd[i]); maxWetD = Math.max(maxWetD, dd[i]); }
      if (maxFilm[i] > 0) { filmN++; q.film = Math.max(q.film, dd[i]); maxFilmD = Math.max(maxFilmD, dd[i]); }
      if (maxEdge[i] > 0.5) edgeN++;
      if (db[i]) { bankN++; if (maxWet[i] > 0.02) bankWet++; }
    }
    out.band = { samples: n, times: T, wetShare: wetN / n, filmShare: filmN / n, edgeN, maxWetD, maxFilmD, bankN, bankWet,
                 bins: bins.map((q, k) => ({ deg: -175 + 10 * k, wet: Math.round(q.wet), film: Math.round(q.film), share: q.n ? q.wetN / q.n : 0 })),
                 wetMax: W.WET_MAX, texel: upx };
  }

  // ---------------- 4. below-horizon coverage + poke-through, 12 directions ----------------
  rr.render(0);
  const cam0 = rr.getCameraInfo().render;
  const CW = B.renderer.domElement.width, CH = B.renderer.domElement.height;
  const HIDE = (o) => o.name === "builtSky" || o.name === "builtClouds" || ["foliage", "grassBlades", "gulls", "spire"].includes(o.userData?.kind);
  const idMat = (id) => new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: `void main(){ vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_PointSize = 2.0; gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `void main(){ gl_FragColor = vec4(0.0, 0.0, ${id.toFixed(1)}, 1.0); }` });
  const uScale = { value: 1 };
  const seaId = new THREE.ShaderMaterial({ uniforms: U({ uScale }), side: THREE.DoubleSide,
    polygonOffset: sea.material.polygonOffset, polygonOffsetFactor: sea.material.polygonOffsetFactor, polygonOffsetUnits: sea.material.polygonOffsetUnits,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; uniform float uScale; ${S.NOISE_GLSL} ${W.SHORE_GLSL} void main(){ gl_FragColor = vec4(shoreDist(vW.xz / uScale), length(vW.xz), 2.0, 1.0); }` });
  const bandId = idMat(3), landId = idMat(1);
  const idPass = (cam, hide = HIDE) => {
    B.render(cam);
    const swap = [];
    B.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.visible) return;
      if (hide(o)) { swap.push([o, o.material, true]); o.visible = false; return; }
      swap.push([o, o.material, false]);
      o.material = o === sea ? seaId : o === band ? bandId : landId;
    });
    const rt = new THREE.WebGLRenderTarget(CW, CH, { type: THREE.FloatType });
    const prev = R.getRenderTarget(), bg = B.scene.background;
    B.scene.background = null;
    R.setRenderTarget(rt); R.setClearColor(0, 0); R.clear(); R.render(B.scene, B.camera);
    const px = new Float32Array(CW * CH * 4); R.readRenderTargetPixels(rt, 0, 0, CW, CH, px);
    R.setRenderTarget(prev); rt.dispose(); B.scene.background = bg;
    for (const [o, m, hid] of swap) { o.material = m; if (hid) o.visible = true; }
    return px;
  };
  // world ray per pixel (bottom-up rows, like the float readback): dir.y < 0 = below the horizon
  const rayY = (x, y) => { const v = new THREE.Vector3((x + 0.5) / CW * 2 - 1, (y + 0.5) / CH * 2 - 1, 0.5).unproject(B.camera); return v.sub(B.camera.position).normalize(); };
  const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
  out.views = [];
  const scale = cam0.arenaScale || 1;
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    const cam = { ...cam0, eye: rotY(cam0.eye, a), look: rotY(cam0.look, a) };
    const px = idPass(cam);
    let below = 0, hole = 0, seaN = 0, landN = 0, bandN = 0, poke = 0;
    uScale.value = cam.arenaScale || 1;
    const tex = F.span * 2 / F.size;
    for (let y = 0; y < CH; y += 2) for (let x = 0; x < CW; x += 2) {
      const d = rayY(x, y); if (d.y >= 0) continue;
      below++;
      const o = (y * CW + x) * 4, id = Math.round(px[o + 2]);
      if (id === 0) hole++; else if (id === 1) landN++; else if (id === 3) bandN++;
      else if (id === 2) { seaN++; if (px[o] > 2 * tex) poke++; }
    }
    out.views.push({ deg: k * 30, eye: cam.eye.map(Math.round), below, hole, share: below ? hole / below : 0, sea: seaN / Math.max(1, below), land: landN / Math.max(1, below), band: bandN / Math.max(1, below), poke });
  }
  out.scale = scale;
  out.hidden = []; B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && HIDE(o)) out.hidden.push(o.name || o.userData?.kind); });
  out.hidden = [...new Set(out.hidden)];

  // ---------------- 5. colours ----------------
  {
    const A = W.anchors(rec);
    const xz = []; for (let k = 0; k < 8; k++) xz.push(k, 0);
    const pxR = probe(xz, U(), `float k = vXZ.x; gl_FragColor = vec4(seaRamp(k / 7.0), 1.0);`);
    let err = 0; const got = [];
    for (let k = 0; k < 8; k++) { const c = [0, 1, 2].map((i) => toSrgb(pxR[k * 4 + i])); got.push(c); for (let i = 0; i < 3; i++) err = Math.max(err, Math.abs(c[i] - A.ramp[k][i])); }
    const seaPiece = rec.pieces.find((p) => p.kind === "sea");
    const rowsRev = seaPiece ? [...seaPiece.rows].reverse().map((r) => r.rgb) : null;
    let rowErr = 0; if (rowsRev) for (let k = 0; k < 8; k++) for (let i = 0; i < 3; i++) rowErr = Math.max(rowErr, Math.abs(got[k][i] - rowsRev[k][i]));
    // the body at distances offshore (m): 0, 2, 5, 10, 20, 40, 80
    const offs = [0, 2, 5, 10, 20, 40, 80], xz2 = []; for (const o of offs) xz2.push(o, 0);
    const pxB = probe(xz2, U(), `gl_FragColor = vec4(seaBody(-vXZ.x * ${S.UNITS_PER_M.toFixed(1)}), 1.0);`);
    const body = offs.map((o, k) => ({ m: o, rgb: [0, 1, 2].map((i) => toSrgb(pxB[k * 4 + i])) }));
    out.colour = { rampErr: err, rowErr, ramp: got, rampFrom: A.rampFrom, body, farErr: Math.max(...[0, 1, 2].map((i) => Math.abs(body[body.length - 1].rgb[i] - A.ramp[7][i]))),
                   deep: A.deep, shallow: A.shallow, foam: A.foam, bed: A.bed };
  }

  // ---------------- 6. moving foam: the bore line's mean distance offshore over one period ----------------
  {
    // per beach ray (its own swash phase), the bore line's position = the mean distance offshore of its samples with
    // bore > 0.5, at 16 times through one period; a step between two times is "in" when the line moved shoreward
    // (wrap-arounds, where a new line is born out at SURF_W, are steps of more than half SURF_W and are counted apart)
    const rays = [], NO = Math.ceil((P.SURF_W + 400) / 10), xz = [];
    for (let k = 0; k < 36; k++) {
      const d = out.waterline[k]; if (d.kind !== "beach") continue;
      const az = d.deg * Math.PI / 180; rays.push(d.deg);
      for (let i = 0; i < NO; i++) { const r = d.land + i * 10; xz.push(Math.sin(az) * r, Math.cos(az) * r); }
    }
    const uT = { value: 0 }, TT = 16, pos = rays.map(() => []);
    for (let k = 0; k < TT; k++) {
      uT.value = 200 + k * P.PERIOD / TT;
      const px = probe(xz, U({ uT }), `vec4 s = shoreTap(vXZ); gl_FragColor = vec4(seaBore(vXZ, max(-s.r, 0.0), uT, 0.0) * beachOpen(s), -s.r, 0.0, 1.0);`, "uniform float uT;");
      rays.forEach((_, r) => { let sum = 0, n = 0; for (let i = 0; i < NO; i++) { const o = (r * NO + i) * 4; if (px[o] > 0.5) { sum += px[o + 1]; n++; } } pos[r].push(n ? sum / n : null); });
    }
    let inward = 0, outward = 0, wraps = 0; const speeds = [];
    for (const p of pos) for (let k = 1; k < TT; k++) {
      if (p[k] == null || p[k - 1] == null) continue;
      const dv = p[k] - p[k - 1];
      if (Math.abs(dv) > P.SURF_W / 2) { wraps++; continue; }
      if (dv < 0) { inward++; speeds.push(-dv / (P.PERIOD / TT)); } else outward++;
    }
    speeds.sort((a, b) => a - b);
    out.bore = { rays: rays.length, inward, outward, wraps, speed: speeds.length ? speeds[speeds.length >> 1] : 0, want: P.SURF_W / P.PERIOD,
                 sample: pos[0].map((v) => (v == null ? null : Math.round(v))) };
  }

  // ---------------- 7. horizon: the rendered frame, last sea pixel vs first sky pixel per column ----------------
  {
    const cam = cam0;
    // the clouds, the cloud skirt and the gulls are hidden here: they drift through the 3 rows above the horizon, so
    // the same build measured 10.6 .. 16.4 mean with them shown and 2.2 .. 10.7 with only the clouds hidden (worst 157,
    // a gull), depending on the second (2026-10-30)
    // Measured 2026-10-30 (water unchanged between runs): mean 8.6 / 16.2 / 19.6, worst 135, depending on the run:
    // other objects (the spires' cards and bushes, grass blades in the wind) stand on the horizon in some columns.
    // The check is the WATER meeting the sky: everything but the sea, its horizon band and the sky dome is hidden; the
    // whole frame (clouds, skirt, gulls hidden as before) is reported beside it.
    const measure = (keep) => {
      const hid = []; B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !keep(o)) { hid.push(o); o.visible = false; } });
      B.render(cam);
      const cv = B.renderer.domElement, c2 = new OffscreenCanvas(CW, CH), x2 = c2.getContext("2d", { willReadFrequently: true });
      x2.drawImage(cv, 0, 0); const img = x2.getImageData(0, 0, CW, CH).data;   // top-down
      for (const o of hid) o.visible = true;
      let sum = 0, n = 0, worst = 0;
      for (let x = 4; x < CW; x += 16) {
        let yh = null;   // first top-down row whose ray goes below the horizon
        for (let y = 0; y < CH; y++) { if (rayY(x, CH - 1 - y).y < 0) { yh = y; break; } }
        if (yh == null || yh < 4 || yh > CH - 5) continue;
        const a = (yh - 3) * CW + x, b = (yh + 2) * CW + x;
        const d = Math.max(...[0, 1, 2].map((i) => Math.abs(img[a * 4 + i] - img[b * 4 + i])));
        sum += d; n++; worst = Math.max(worst, d);
      }
      return { columns: n, mean: n ? sum / n : null, worst };
    };
    out.horizon = measure((o) => o.name === "sea_surface" || o.name === "sea_horizon" || o.name === "builtSky");
    out.horizonAll = measure((o) => !(o.name === "builtClouds" || o.name === "builtCloudSkirt" || o.name === "builtGulls"));
  }

  // ---------------- 10. stripes: neighbouring screen rows across the OPEN sea, rendered frame ----------------
  // The viewer camera turned to 6 directions. The id pass (section 4's, with the shore distance in R) marks the sea
  // pixels; only the open sea counts (beyond the foam's reach, SURF_W + 7 BORE_W offshore, so the foam line is not
  // called a stripe) and only pixels whose 8 neighbours are open sea too (no antialiased edge). Per 32-px
  // column segment, the row's mean colour: d1 = its change to the next row, d2 = |m(y+1) - 2 m(y) + m(y-1)| = how far a
  // row leaves the straight gradient through its neighbours (a stripe: large; a smooth gradient, however steep:
  // small). Per pixel: the same row-to-row change, p99 and max. All in sRGB /255.
  // The sky's clouds, its cloud skirt (sky.js: transparent, drawn over the far sea) and the gulls are hidden for the
  // id pass AND the frame, so this measures the WATER's own colour; how many open-sea pixels the skirt and clouds
  // change is reported apart (info: overSea).
  {
    const reach = P.SURF_W + 7 * P.BORE_W, SEG = 32;
    const OVER = (o) => o.name === "builtClouds" || o.name === "builtCloudSkirt" || o.name === "builtGulls";
    const keyMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: sea.material.polygonOffsetFactor, polygonOffsetUnits: sea.material.polygonOffsetUnits,
      vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: `void main(){ gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }` });
    const grab = (cam, hideOver) => {
      const hid = []; if (hideOver) B.scene.traverse((o) => { if (OVER(o) && o.visible) { hid.push(o); o.visible = false; } });
      B.render(cam);
      const cv = B.renderer.domElement, c2 = new OffscreenCanvas(CW, CH), x2 = c2.getContext("2d", { willReadFrequently: true });
      x2.drawImage(cv, 0, 0); const d = x2.getImageData(0, 0, CW, CH).data;   // top-down
      for (const o of hid) o.visible = true;
      return d;
    };
    const views = [];
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      const cam = { ...cam0, eye: rotY(cam0.eye, a), look: rotY(cam0.look, a) };
      const ids = idPass(cam, (o) => o.name === "builtSky" || OVER(o));   // every solid occluder drawn (spires, trees, grass)
      uScale.value = cam.arenaScale || 1;
      const img = grab(cam, true), full = grab(cam, false);
      // the KEY frame: the real scene with the sea painted pure magenta, so a pixel counts only where the sea itself is
      // what the frame shows (the id pass draws the grass blades without their wind, so it misses where they stand)
      const seaMat = sea.material; sea.material = keyMat; const key = grab(cam, true); sea.material = seaMat;
      const open = new Uint8Array(CW * CH);   // top-down
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const o = ((CH - 1 - y) * CW + x) * 4, p = (y * CW + x) * 4;
        open[y * CW + x] = Math.round(ids[o + 2]) === 2 && -ids[o] > reach && key[p] === 255 && key[p + 1] === 0 && key[p + 2] === 255 ? 1 : 0; }
      let overSea = 0, openN = 0;
      for (let i = 0; i < CW * CH; i++) if (open[i]) { openN++; if (Math.max(...[0, 1, 2].map((c) => Math.abs(img[i * 4 + c] - full[i * 4 + c]))) > 6) overSea++; }
      // a pixel counts when it and its 8 neighbours are open sea (no antialiased edge of the sand, a spire or a gull)
      const ok = (x, y) => { if (y < 1 || y > CH - 2 || x < 1 || x > CW - 2) return false;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!open[(y + j) * CW + x + i]) return false; return true; };
      let n = 0, d1max = 0, d2max = 0, d2big = 0, pn = 0; const pd = [];
      for (let x0 = 0; x0 + SEG <= CW; x0 += SEG) {
        const m = new Array(CH).fill(null);
        for (let y = 1; y < CH - 1; y++) {
          let all = true; const s = [0, 0, 0];
          for (let x = x0; x < x0 + SEG; x++) { if (!ok(x, y)) { all = false; break; } const o = (y * CW + x) * 4; s[0] += img[o]; s[1] += img[o + 1]; s[2] += img[o + 2]; }
          if (all) m[y] = s.map((v) => v / SEG);
        }
        for (let y = 1; y < CH - 1; y++) {
          if (!m[y] || !m[y - 1]) continue;
          d1max = Math.max(d1max, ...[0, 1, 2].map((i) => Math.abs(m[y][i] - m[y - 1][i])));
          if (!m[y + 1]) continue;
          const d2 = Math.max(...[0, 1, 2].map((i) => Math.abs(m[y + 1][i] - 2 * m[y][i] + m[y - 1][i])));
          n++; d2max = Math.max(d2max, d2); if (d2 > 3) d2big++;
        }
      }
      for (let y = 1; y < CH - 1; y++) for (let x = 0; x < CW; x++) {
        if (!ok(x, y)) continue;
        const a2 = (y * CW + x) * 4, b2 = a2 + CW * 4; if (!open[(y + 1) * CW + x]) continue;
        pd.push(Math.max(...[0, 1, 2].map((i) => Math.abs(img[a2 + i] - img[b2 + i])))); pn++;
      }
      pd.sort((p, q) => p - q);
      views.push({ deg: k * 60, overSea: openN ? overSea / openN : 0, rows: n, d1max: +d1max.toFixed(1), d2max: +d2max.toFixed(1), d2big, px: pn, p99: pd.length ? pd[Math.floor(pd.length * 0.99)] : 0, pmax: pd.length ? pd[pd.length - 1] : 0 });
    }
    out.stripes = { views, reach };
  }

  // ---------------- 11. continuity in time: no value may jump between two frames ----------------
  // Points along every beach ray from SURF_W + 7 BORE_W offshore to WET_MAX inland (25-unit steps), at 1/60 s steps
  // over TWO full swash periods: the sea's foam (seaFoam, what the sea draws), its two moving parts (the bore line and
  // the lace), and what the sand draws (sandWater: film, foam edge, wetness). Every time sits in one point (its y), so
  // the whole series is one GPU pass. A moving line legitimately changes a point by about speed / width per frame
  // (the bore: SURF_W / PERIOD = 281 units/s over a >= 63-unit half width -> ~0.11); a reset is a jump of ~1.
  {
    const rays = out.waterline.filter((d) => d.kind === "beach");
    const lo = -(P.SURF_W + 7 * P.BORE_W), hi = W.WET_MAX, step = 25, NO = Math.floor((hi - lo) / step) + 1;
    const NT = Math.round(2 * P.PERIOD * 60) + 1, t0 = 300;
    const pts = [];
    for (const d of rays) { const az = d.deg * Math.PI / 180; for (let i = 0; i < NO; i++) { const r = d.land - (lo + i * step); pts.push(Math.sin(az) * r, Math.cos(az) * r); } }
    const NP = pts.length / 2, COLS = 1024, total = NP * NT, ROWS = Math.ceil(total / COLS);
    const run = (body) => {
      const pos = new Float32Array(COLS * ROWS * 3);
      for (let k = 0; k < NT; k++) for (let i = 0; i < NP; i++) { const o = (k * NP + i) * 3; pos[o] = pts[i * 2]; pos[o + 1] = t0 + k / 60; pos[o + 2] = pts[i * 2 + 1]; }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.ShaderMaterial({ uniforms: U(),
        vertexShader: `varying vec2 vXZ; varying float vT; void main(){ vXZ = position.xz; vT = position.y; gl_PointSize = 1.0; float i = float(gl_VertexID);
          gl_Position = vec4((mod(i, ${COLS}.0) + 0.5) / ${COLS}.0 * 2.0 - 1.0, (floor(i / ${COLS}.0) + 0.5) / ${ROWS}.0 * 2.0 - 1.0, 0.0, 1.0); }`,
        fragmentShader: `varying vec2 vXZ; varying float vT; ${S.NOISE_GLSL} ${S.LIGHT_GLSL} ${W.SHORE_GLSL} ${W.WATER_BODY_GLSL} ${W.SEA_GLSL}
          void main(){ ${body} }` });
      const ptsO = new THREE.Points(g, mat); ptsO.frustumCulled = false;
      const rt = new THREE.WebGLRenderTarget(COLS, ROWS, { type: THREE.FloatType });
      const px = new Float32Array(COLS * ROWS * 4), prev = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0, 0); R.clear(); R.render(new THREE.Scene().add(ptsO), new THREE.Camera());
      R.readRenderTargetPixels(rt, 0, 0, COLS, ROWS, px); R.setRenderTarget(prev); rt.dispose(); mat.dispose(); g.dispose();
      return px;
    };
    // fp = 30 units: the footprint of a near-shore sea pixel from the viewer camera (so the band-limited parts are on)
    const sea4 = run(`vec4 s = shoreTap(vXZ); float off = max(-s.r, 0.0); float o = beachOpen(s);
      float bore = (off < uSurfW + uBoreW * 7.0 && s.r < 0.0) ? seaBore(vXZ, off, vT, 30.0) * o : 0.0;
      gl_FragColor = vec4(s.r < 0.0 ? seaFoam(vXZ, s, vT, 30.0) : 0.0, bore, seaLace(vXZ, vT, 30.0), 0.0);`);
    const sand4 = run(`vec4 s = shoreTap(vXZ); vec3 w = s.r >= 0.0 ? sandWater(vXZ, vT) : vec3(0.0); gl_FragColor = vec4(w, 0.0);`);
    const names = [["seaFoam", sea4, 0], ["bore", sea4, 1], ["lace", sea4, 2], ["sandFilm", sand4, 0], ["sandEdge", sand4, 1], ["sandWet", sand4, 2]];
    out.time = { points: NP, frames: NT, seconds: (NT - 1) / 60, rays: rays.length, q: {} };
    for (const [name, px, c] of names) {
      let max = 0, at = null; const all = [];
      for (let i = 0; i < NP; i++) for (let k = 1; k < NT; k++) {
        const dv = Math.abs(px[(k * NP + i) * 4 + c] - px[((k - 1) * NP + i) * 4 + c]);
        all.push(dv); if (dv > max) { max = dv; at = { t: +(t0 + k / 60).toFixed(3), phase: +(((k / 60) % P.PERIOD) / P.PERIOD).toFixed(3) }; }
      }
      all.sort((p, q) => p - q);
      out.time.q[name] = { max: +max.toFixed(4), p999: +all[Math.floor(all.length * 0.999)].toFixed(4), big: all.filter((v) => v > (name === "sandFilm" ? 12 : 0.2)).length, at };
    }
  }

  // ---------------- 12. one foam line, not a set of parallel lines ----------------
  // Across the shore (along the smooth waterline's normal, every 5 deg of the beach) at 5-unit steps from SURF_W +
  // 7 BORE_W offshore to WET_MAX inland, at 48 times through one period: the number of separate bright lines (local
  // maxima >= 0.3 that stand >= 0.15 above the dip to the next) of the bore, of the sand's foam, and of ALL the foam
  // the eye sees across the shore (the sea's seaFoam, then the sand's foam edge). One wave = one line.
  {
    const sm = F.smooth, at = (a) => { const r = W.smoothWaterlineAt(sm, a); return [Math.sin(a) * r, Math.cos(a) * r]; };
    const rays = [];
    for (let deg = -180; deg < 180; deg += 5) {
      const a = deg * Math.PI / 180, near = out.waterline.reduce((b, d) => (Math.abs(((d.deg - deg + 540) % 360) - 180) < Math.abs(((b.deg - deg + 540) % 360) - 180) ? d : b));
      if (near.kind !== "beach" || Math.abs(((near.deg - deg + 540) % 360) - 180) > 5) continue;
      const p = at(a), p1 = at(a + 0.002), p0 = at(a - 0.002), tx = p1[0] - p0[0], tz = p1[1] - p0[1], tl = Math.hypot(tx, tz);
      let nx = tz / tl, nz = -tx / tl; if (nx * p[0] + nz * p[1] < 0) { nx = -nx; nz = -nz; }   // outward (to sea)
      rays.push({ deg, p, n: [nx, nz] });
    }
    const lo = -(P.SURF_W + 7 * P.BORE_W), hi = W.WET_MAX, step = 5, NO = Math.floor((hi - lo) / step) + 1, NT = 48, t0 = 300;
    const pts = [];
    for (const d of rays) for (let i = 0; i < NO; i++) { const o = lo + i * step; pts.push(d.p[0] - d.n[0] * o, d.p[1] - d.n[1] * o); }
    const NP = pts.length / 2, COLS = 1024, ROWS = Math.ceil(NP * NT / COLS);
    const pos = new Float32Array(COLS * ROWS * 3);
    for (let k = 0; k < NT; k++) for (let i = 0; i < NP; i++) { const o = (k * NP + i) * 3; pos[o] = pts[i * 2]; pos[o + 1] = t0 + k * P.PERIOD / NT; pos[o + 2] = pts[i * 2 + 1]; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({ uniforms: U(),
      vertexShader: `varying vec2 vXZ; varying float vT; void main(){ vXZ = position.xz; vT = position.y; gl_PointSize = 1.0; float i = float(gl_VertexID);
        gl_Position = vec4((mod(i, ${COLS}.0) + 0.5) / ${COLS}.0 * 2.0 - 1.0, (floor(i / ${COLS}.0) + 0.5) / ${ROWS}.0 * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec2 vXZ; varying float vT; ${S.NOISE_GLSL} ${S.LIGHT_GLSL} ${W.SHORE_GLSL} ${W.WATER_BODY_GLSL} ${W.SEA_GLSL}
        void main(){ vec4 s = shoreTap(vXZ); float off = max(-s.r, 0.0); float o = beachOpen(s);
          float bore = (s.r < 0.0 && off < uSurfW + uBoreW * 7.0) ? seaBore(vXZ, off, vT, 0.0) * o : 0.0;
          vec3 sw = sandWater(vXZ, vT); bool onSand = s.r >= 0.0 || s.g > 0.5;
          gl_FragColor = vec4(bore, onSand ? sw.y : 0.0, onSand ? sw.y : max(smoothstep(uFoamW, 0.0, off) * waveArrive(vXZ, s.r, vT), bore * 0.9) * o, s.r >= 0.0 ? sw.z : -1.0); }` });
    const po = new THREE.Points(g, mat); po.frustumCulled = false;
    const rt = new THREE.WebGLRenderTarget(COLS, ROWS, { type: THREE.FloatType }), px = new Float32Array(COLS * ROWS * 4);
    R.setRenderTarget(rt); R.setClearColor(0, 0); R.clear(); R.render(new THREE.Scene().add(po), new THREE.Camera());
    R.readRenderTargetPixels(rt, 0, 0, COLS, ROWS, px); R.setRenderTarget(null); rt.dispose(); mat.dispose(); g.dispose();
    const lines = (v) => {   // separate maxima: >= 0.3, and the dip between two counted maxima >= 0.15 below the lower
      const pk = [];
      for (let i = 0; i < v.length; i++) if (v[i] >= 0.3 && (i === 0 || v[i] >= v[i - 1]) && (i === v.length - 1 || v[i] > v[i + 1])) pk.push(i);
      const kept = [];
      for (const i of pk) {
        const j = kept[kept.length - 1];
        if (j == null) { kept.push(i); continue; }
        let dip = Infinity; for (let m = j; m <= i; m++) dip = Math.min(dip, v[m]);
        if (Math.min(v[i], v[j]) - dip >= 0.15) kept.push(i); else if (v[i] > v[j]) kept[kept.length - 1] = i;
      }
      lines.last = kept; return kept.length;
    };
    const q = {};
    for (const [name, c] of [["bore", 0], ["sandEdge", 1], ["allFoam", 2]]) {
      const hist = [0, 0, 0, 0, 0, 0]; let most = 0, sum = 0, cases = 0;
      for (let r = 0; r < rays.length; r++) for (let k = 0; k < NT; k++) {
        const v = []; for (let i = 0; i < NO; i++) v.push(px[(k * NP + r * NO + i) * 4 + c]);
        const n = lines(v); if (n > 1 && (q.ex = q.ex || []).filter((e) => e[0] === name).length < 8) q.ex.push([name, rays[r].deg, k, lines.last.map((i) => Math.round(lo + i * step) + ":" + v[i].toFixed(2)).join(" ")]); hist[Math.min(5, n)]++; most = Math.max(most, n); sum += n; cases++;
      }
      q[name] = { hist, most, mean: +(sum / cases).toFixed(2), cases };
    }
    // wetness must fall inland (dry sand never lies between two wet bands: a light line along the beach)
    let rise = 0, bad = 0, riseAt = null; const riseD = {};
    for (let r = 0; r < rays.length; r++) for (let k = 0; k < NT; k++) {
      let lo2 = Infinity, up = 0, upD = null;
      for (let i = 0; i < NO; i++) { const v = px[(k * NP + r * NO + i) * 4 + 3]; if (v < 0) continue; lo2 = Math.min(lo2, v); if (v - lo2 > up) { up = v - lo2; upD = lo + i * step; } }
      if (up > rise) { rise = up; riseAt = { d: upD, deg: rays[r].deg, k }; } if (up > 0.05) { bad++; const b = Math.round(upD / 40) * 40; riseD[b] = (riseD[b] || 0) + 1; }
    }
    q.wetRise = { max: +rise.toFixed(3), bad, at: riseAt, where: riseD };
    out.lines = { rays: rays.length, times: NT, step, q };
  }

  // ---------------- 8. opaque, shared uniforms, polygon offset, layer switch ----------------
  out.material = { transparent: mats.filter((m) => m.transparent).length, depthWrite: mats.filter((m) => m.depthWrite !== true).length,
                   inList: mats.filter((m) => B.materials.includes(m)).length, count: mats.length,
                   offset: [sea.material.polygonOffset, sea.material.polygonOffsetFactor, sea.material.polygonOffsetUnits] };
  let bad = 0, keys = 0;
  for (const m of mats) for (const k of Object.keys(S.U)) { keys++; if (m.uniforms[k] !== S.U[k]) bad++; }
  out.uniforms = { bad, keys };
  window.__layers.set("water", false); const off = meshes.map((m) => m.visible);
  window.__layers.set("water", true); const on = meshes.map((m) => m.visible);
  out.layer = { off, on };

  // ---------------- 9. cost at 960x720 ----------------
  {
    const cam = cam0;
    const keepW = R.domElement.width, keepH = R.domElement.height;
    R.domElement.width = 960; R.domElement.height = 720;
    const gl = R.getContext(), one = new Uint8Array(4);
    const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
    B.camera.aspect = 960 / 720;
    time(30);
    // interleaved blocks, so a drift of the machine hits both the same
    let tOn = 0, tOff = 0; const blocks = 6, per = Math.max(10, Math.round(FRAMES / blocks));
    for (let b = 0; b < blocks; b++) {
      tOn += time(per);
      meshes.forEach((m) => (m.visible = false)); tOff += time(per); meshes.forEach((m) => (m.visible = true));
    }
    R.domElement.width = keepW; R.domElement.height = keepH;
    B.render(cam);
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    out.frame = { all: tOn / blocks, noWater: tOff / blocks, water: (tOn - tOff) / blocks, frames: per * blocks, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?" };
    B.render(cam); const all = B.info.triangles;
    out.tris = { sea: sea.geometry.index.count / 3, band: band.geometry.index.count / 3, all };
  }
  return out;
}, { FRAMES });

await browser.close().catch(() => {});

// ---------------- report ----------------
const w = R0.info;
console.log(`     (info) water: ${w.meshes} meshes (sea surface ${R0.tris.sea} tris + horizon band ${R0.tris.band}), land outline ${w.waterline.outline} edges (sand ${w.waterline.sand} + bank ${JSON.stringify(w.waterline.banks)}), bake ${w.waterline.bakeMs} ms, built in ${w.ms} ms`);
console.log(`     (info) thin band (units, 400 = 1 m): run-up ${w.swashBand.runup} (max ${w.swashBand.runupMax}), damp strip ${w.swashBand.damp}, wet max ${w.swashBand.wetMax} = ${(w.swashBand.wetMax / 400).toFixed(2)} m; bore from ${w.swashBand.surf}`);

console.log(`     (info) viewer camera arenaScale ${R0.scale}`);
const nanWater = R0.nan.filter((o) => o && o.water);
if (R0.nan.length) console.log(`     (info) NaN bounding sphere (not water): ${JSON.stringify(R0.nan)}`);
check(R0.programs.failed === 0, `shader programs compile: ${R0.programs.count}, ${R0.programs.failed} failed`);

console.log("     (info) waterline per 10 deg  [deg kind: sand edge / land edge / smooth line / field zero / sea ring | field - smooth, ring - land]");
for (let i = 0; i < 36; i += 6) console.log("       " + R0.waterline.slice(i, i + 6).map((d) => `${d.deg} ${d.kind}: ${d.sand}/${d.land}/${d.smooth}/${d.field}/${d.ring} |${d.errField},${d.errRing}`).join("   "));
const wl = R0.waterline, eF = Math.max(...wl.map((d) => (d.errField == null ? 1e9 : Math.abs(d.errField)))), eR = Math.max(...wl.map((d) => Math.abs(d.errRing)));
const beachSandErr = Math.max(...wl.filter((d) => d.kind === "beach").map((d) => Math.abs(d.land - d.sand)));
check(eF <= 40, `the baked field's zero crossing = the smooth waterline (smoothWaterlineAt), worst ${eF} units (<= 40 = 10 cm) over 36 directions`);
{
  const c = R0.corners, inl = wl.map((d) => d.inland), lo = Math.min(...inl), hi = Math.max(...inl);
  console.log(`     (info) corners: the land outline has ${c.vertices} vertices, turning up to ${c.polyMax} deg (${c.polyOver20} turn > 20 deg; ${c.slits} slit tips of ~180 deg); the smooth line (Gaussian ${c.sigma} units along the shore, ${c.clamped} samples clamped) turns at most ${c.smoothPer100} deg over any 100 units (at az ${c.worstAz}), samples <= ${c.smoothSeg} units apart; it lies ${c.dev.mean} units (mean), ${c.dev.max} (max) inland of the land edge`);
  check(c.smoothPer100 <= 12 && lo >= -8 && hi <= 260,
    `smooth waterline, no straight-edge corners: turns <= ${c.smoothPer100} deg per 100 units (<= 12; the outline turns up to ${c.polyMax} deg at a point), never seaward of the land edge (land - smooth ${lo} .. ${hi} units at 36 directions; >= -8, <= 260)`);
}
check(eR <= 80, `the sea's inner ring follows it: waterlineAt() vs the land edge, worst ${eR} units (<= 80; the ring is tucked ${w.params.OVERLAP} under it)`);
console.log(`     (info) ${wl.filter((d) => d.kind === "beach").length} beach directions (land edge = sand edge, worst ${beachSandErr} units), ${wl.filter((d) => d.kind === "bank").length} bank directions (${wl.filter((d) => d.kind === "bank").map((d) => d.deg).join(",")} deg: the grass bank stands between the sand and the sea)`);

const b = R0.band, lim = b.wetMax + b.texel;
console.log("     (info) wet reach inland per 10 deg (units, wet>0.02 / film>0): " + b.bins.map((q) => `${q.deg}:${q.wet}/${q.film}`).join(" "));
check(b.maxWetD <= lim && b.maxFilmD <= lim, `wet sand only in the thin band: over ${b.samples} sand samples x ${b.times} times, wetness reaches at most ${Math.round(b.maxWetD)} units (${(b.maxWetD / 400).toFixed(2)} m) inland, the swash film ${Math.round(b.maxFilmD)} units (${(b.maxFilmD / 400).toFixed(2)} m); limit ${Math.round(lim)} (WET_MAX ${Math.round(b.wetMax)} + 1 texel)`);
check(b.wetShare < 0.2 && b.filmShare > 0 && b.edgeN > 0, `the rest of the beach stays dry: ${(b.wetShare * 100).toFixed(1)} % of the sand is ever wet (< 20 %), film on ${(b.filmShare * 100).toFixed(1)} %, foam edge on ${b.edgeN} samples`);
check(b.bankN > 0 ? b.bankWet === 0 : true, `no wet sand against the grass bank: ${b.bankWet} of ${b.bankN} sand samples nearer the bank than the sea are ever wet`);

for (const v of R0.views) console.log(`     (info) view ${String(v.deg).padStart(3)} deg eye ${JSON.stringify(v.eye)}: ${v.below} below-horizon px (every 2nd), ${v.hole} hit nothing (${(v.share * 100).toFixed(2)} %), sea ${(v.sea * 100).toFixed(1)} %, land ${(v.land * 100).toFixed(1)} %, band ${(v.band * 100).toFixed(2)} %, sea-over-land ${v.poke}`);
console.log(`     (info) hidden for the coverage count: ${JSON.stringify(R0.hidden)}`);
const worstHole = Math.max(...R0.views.map((v) => v.share)), poke = R0.views.reduce((s, v) => s + v.poke, 0);
check(worstHole < 0.001, `the sea fills the gap: below the horizon, from the viewer camera at 12 directions, at most ${(worstHole * 100).toFixed(3)} % of the pixels hit no surface (< 0.1 %)`);
check(poke === 0, `the sea never pokes through the land: ${poke} sea pixels drawn where the field says land (> 2 texels inland), all 12 views`);

const c = R0.colour;
check(c.rampErr <= 2 && (c.rampFrom == null || c.rowErr <= 2) && c.farErr <= 2,
  `colour ramp = the recipe's measured sea rows (${c.rampFrom}): seaRamp() on the GPU worst ${c.rampErr} /255 vs anchors, ${c.rowErr} vs the rows; the far body = the far row (${c.farErr} /255)`);
console.log(`     (info) body by distance offshore: ${c.body.map((q) => `${q.m} m ${JSON.stringify(q.rgb)}`).join(", ")}; foam ${JSON.stringify(c.foam)}, bed ${JSON.stringify(c.bed)}`);
const n0 = c.body[0].rgb, nf = c.body[c.body.length - 1].rgb;
check(n0[1] > n0[2] * 0.85 && n0[1] > 150 && nf[2] > nf[1] * 2.5, `turquoise near the shore ${JSON.stringify(n0)} -> deep blue far ${JSON.stringify(nf)}`);

const bo = R0.bore;
console.log(`     (info) bore line on the first beach ray over one ${w.params.PERIOD} s period (units offshore): ${JSON.stringify(bo.sample)}`);
check(bo.inward > 4 * Math.max(1, bo.outward) && bo.speed > 0.5 * bo.want && bo.speed < 2 * bo.want,
  `moving foam on the wave edge: over ${bo.rays} beach rays the bore line moved shoreward in ${bo.inward} steps, seaward in ${bo.outward} (${bo.wraps} new lines born out at sea); median speed ${bo.speed.toFixed(0)} units/s (designed ${bo.want.toFixed(0)})`);

console.log(`     (info) horizon in the whole frame (spires, bushes, grass shown; clouds, skirt, gulls hidden): mean ${R0.horizonAll.mean?.toFixed(1)} /255, worst ${R0.horizonAll.worst}`);
check(R0.horizon.columns > 10 && R0.horizon.mean <= 14, `the far sea meets the sky (only the sea, its band and the sky drawn): last sea pixel vs first sky pixel over ${R0.horizon.columns} columns, mean ${R0.horizon.mean?.toFixed(1)} /255 (<= 14), worst ${R0.horizon.worst}`);

for (const v of R0.stripes.views) console.log(`     (info) stripes view ${String(v.deg).padStart(3)} deg: ${v.rows} open-sea row triples; row-mean change max ${v.d1max}, off the gradient (d2) max ${v.d2max}, d2 > 3: ${v.d2big}; per pixel row change p99 ${v.p99}, max ${v.pmax} (${v.px} px); the sky's clouds / skirt / gulls change ${(v.overSea * 100).toFixed(1)} % of these open-sea pixels by > 6 (not water)`);
const sv = R0.stripes.views.filter((v) => v.rows > 0), sD2 = Math.max(...sv.map((v) => v.d2max)), sBig = sv.reduce((s, v) => s + v.d2big, 0), sP99 = Math.max(...sv.map((v) => v.p99));
check(sv.length >= 3 && sD2 <= 4 && sBig <= 2 && sP99 <= 8,
  `no colour stripes across the open sea (beyond ${R0.stripes.reach} units offshore), ${sv.length} of 6 views: a row leaves the smooth gradient by at most ${sD2.toFixed(1)} /255 (<= 4), ${sBig} rows by more than 3 (<= 2); per pixel row-to-row change p99 ${sP99} (<= 8)`);
{
  const lq = R0.lines.q; delete lq.ex;
  console.log(`     (info) foam lines per ray (${R0.lines.rays} beach rays x ${R0.lines.times} times, ${R0.lines.step}-unit steps), histogram 0..5+: ` + Object.entries(lq).filter(([k]) => k !== "wetRise").map(([k, v]) => `${k} [${v.hist}] most ${v.most} mean ${v.mean}`).join("; "));
  check(lq.wetRise.max <= 0.05, `the wet sand gets drier inland, no dry line between two wet bands: wetness rises inland by at most ${lq.wetRise.max} (<= 0.05; ${lq.wetRise.bad} of ${R0.lines.rays * R0.lines.times} ray-times rise more; worst at ${JSON.stringify(lq.wetRise.at)}, by d: ${JSON.stringify(lq.wetRise.where)})`);
  check(lq.bore.most <= 1 && lq.sandEdge.most <= 1 && lq.allFoam.most <= 2,
    `one foam line, not parallel lines: the bore draws at most ${lq.bore.most} line per ray, the sand's foam edge at most ${lq.sandEdge.most} (both <= 1), all the foam across the shore (lace patches aside) at most ${lq.allFoam.most} (<= 2: this wave's edge and the next wave's bore out at sea), at every ray and time`);
}
const tq = R0.time.q;
console.log(`     (info) time: ${R0.time.points} points on ${R0.time.rays} beach rays x ${R0.time.frames} frames (${R0.time.seconds.toFixed(1)} s at 1/60 s): ` + Object.entries(tq).map(([k, q]) => `${k} max ${q.max} p99.9 ${q.p999} jumps ${q.big} @${JSON.stringify(q.at)}`).join("; "));
check(tq.seaFoam.max <= 0.2 && tq.bore.max <= 0.2 && tq.lace.max <= 0.2 && tq.sandEdge.max <= 0.2 && tq.sandWet.max <= 0.2 && tq.sandFilm.max <= 12,
  `continuous in time (no reset): largest change between two frames over two swash periods: sea foam ${tq.seaFoam.max}, bore ${tq.bore.max}, lace ${tq.lace.max}, sand foam edge ${tq.sandEdge.max}, wetness ${tq.sandWet.max} (all <= 0.2), film ${tq.sandFilm.max} units (<= 12)`);

const m = R0.material;
check(m.transparent === 0 && m.depthWrite === 0 && m.inList === m.count && m.offset[0] === true, `opaque: ${m.count} materials, ${m.transparent} transparent, ${m.depthWrite} without depth write, ${m.inList} in the world's list; sea polygon offset ${JSON.stringify(m.offset)}`);
check(R0.uniforms.bad === 0, `the shared light/haze uniforms are the same objects (sun by day, moon by night): ${R0.uniforms.bad} of ${R0.uniforms.keys} differ`);
check(R0.layer.off.every((v) => !v) && R0.layer.on.every((v) => v), `the 'water and sea' switch: off -> ${JSON.stringify(R0.layer.off)}, on -> ${JSON.stringify(R0.layer.on)}`);

const f = R0.frame;
console.log(`     (info) frame time at 960x720 over ${f.frames} frames each (interleaved) on ${f.renderer}: shown ${f.all.toFixed(3)} ms, water hidden ${f.noWater.toFixed(3)} ms`);
check(f.water <= 1.0, `water cost ${f.water.toFixed(3)} ms/frame (<= 1 ms)`);

for (const e of errors) console.log("   error:", e);
check(errors.length === 0 && nanWater.length === 0, `page errors: ${errors.length} (+ NaN bounding sphere on water geometry: ${nanWater.length})`);
process.exit(fails ? 1 : 0);
