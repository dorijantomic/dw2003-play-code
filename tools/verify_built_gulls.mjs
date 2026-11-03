// Numbers check of the seagulls of the BUILT arena (web/built/gulls.js, recipe kind "gulls", meft1002 floor_07).
// No pictures: counts, distances, heights and pixel VALUES only.
//  - wiring: the layer loads (no "gulls" in info.missingLayers), 14 gulls = 7 recipe cards x their 2 picture copies
//    (each card's 24x16 picture is tiled `copies: 2` times across its width, so a card holds two birds), one InstancedMesh
//  - one gull per PICTURE COPY, in card-then-copy order: at t = 0 the rendered instance sits at that copy's own centre
//    on the card (base + ((k + 0.5)/copies - 0.5) x w along the card's dir, <= 1 unit), and the RENDERED instance's
//    orbit radius = that copy centre's distance from the arena centre (<= 1 unit, read back from the instance
//    matrices over 240 s), and the orbit is a circle of that radius
//  - the bob stays inside the card's measured height band: every gull vertex (JS twin of the shader, all 45, over
//    240 s, through the real instance matrix) inside [card base, card base + h], inside the piece's measured band
//    (y 180-1984), and never below y = 0
//  - wing span: nominal 2 x half span = 0.96 x the COPY width (= card width / copies, half the card); the DRAWN span
//    measured through the material's own vertex shader (GPU probe) and reported as a share of the copy width
//  - keep-out: every shown gull outside the fight radius and outside every eye cone. Proved twice: the cone hull's
//    farthest point from the axis (a cone is the convex hull of the eye and the fighter sphere) against the orbit's
//    closest approach, and a direct inViewCone sweep at a finer step than the module's. Then two forced states (a
//    fight radius over the orbit; an eye ring on the orbit, put into the arena's live keep-out because that is what
//    its reject() tests against, and restored right after) must hide gulls with the right reason and scale them to
//    0, and the real state must show all 14 again
//  - one draw call: hiding the layer removes exactly 1 call and 14 x 15 = 210 triangles; the gulls alone draw 1 call
//  - the shared sun / moon light shades them: every light uniform IS the shared object, and forcing night through
//    window.__layers.setSkyMode("night") changes their pixels (darker, bluer)
//  - the flap moves wing vertices: the material's own vertex shader rendered into a float target at several times
//    (against the JS twin gullFlapJS), body vertices still, wing tips moved, and the pixels move at a fixed camera
//  - colours: uWhite / uShade / uTip ARE the piece's measured p90 / lavender bucket (g > r) / p10; the day render
//    shows white bodies, lavender undersides and dark tips
//  - whole world frame time at 960x720 (<= 10 ms), shader programs compile, page errors 0
//   VERIFY_PORT=8090 [ARENA=meft1002] [FRAMES=600] tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_gulls.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const FRAMES = Math.max(60, Number(process.env.FRAMES || 600));
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
const resourceErrors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 700)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/^Failed to load resource/.test(t)) resourceErrors.push(String(m.location()?.url || t).slice(0, 160));
  else errors.push(t.slice(0, 500));
});
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.layers?.gulls || window.__built?.missing || window.__built?.info?.missingLayers, null, { timeout: 120000 }).catch(() => {});
await page.waitForFunction(() => window.__r?.getFighterBounds("player") && window.__built?.info?.triangles > 0, null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1200);
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const f = (v, n = 2) => (+v).toFixed(n);

const R = await page.evaluate(async ({ FRAMES }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const G = await import("./built/gulls.js");
  const B = window.__built, LV = window.__layers;
  if (!B) return { missing: true };
  const out = { pack: B.info.pack, layerIds: Object.keys(B.info.layers || {}), missingLayers: B.info.missingLayers || [] };
  const L = (B.layers || []).find((e) => e.id === "gulls");
  if (!L) return { ...out, noGulls: true };
  const mat = L.mesh.material, mesh = L.mesh, geo = L.geo;
  const pa = geo.attributes.position.array, sa = geo.attributes.aSeg.array, nv = pa.length / 3;
  const piece = (await fetch(`assets-hd/battle/built/${B.info.pack}.json`).then((r) => r.json())).pieces.find((p) => p.kind === "gulls");
  out.recipe = { cards: piece.cards, colours: piece.colours, ymin: piece.ymin, ymax: piece.ymax, rmin: piece.rmin, rmax: piece.rmax, tris: piece.tris };
  out.info = { count: L.info.count, cards: L.info.cards, cardCopies: L.info.cardCopies, shown: L.info.shown, trisPerGull: L.info.trisPerGull, reach: L.info.reach,
    band: L.info.band, gulls: L.info.gulls, exactTests: L.info.exactTests, hiddenWhy: L.info.hiddenWhy };
  out.mesh = { count: mesh.count, tris: geo.attributes.position.count / 3, name: mesh.name, meshes: (L.meshes || []).length,
    instanced: !!mesh.isInstancedMesh, inScene: !!mesh.parent, visible: mesh.visible,
    aGull: geo.attributes.aGull?.isInstancedBufferAttribute && geo.attributes.aGull.count === mesh.count, aSeg: !!geo.attributes.aSeg };
  const ko = B.debug.ko;
  out.keepOut = { fightR: ko.fightR, farthest: ko.farthest, rings: ko.rings.map((g) => ({ r: g.r, y: g.y })), fighters: ko.fighters.map((q) => ({ c: q.c, r: q.r })) };

  // ---- colours: the uniforms ARE the measured p90 / lavender / p10 ----
  const eq = (c, m) => { const e = S.srgb(m); return Math.max(Math.abs(c.r - e.r), Math.abs(c.g - e.g), Math.abs(c.b - e.b)); };
  const U = mat.uniforms;
  out.colours = {
    white: [U.uWhite.value.r, U.uWhite.value.g, U.uWhite.value.b], shade: [U.uShade.value.r, U.uShade.value.g, U.uShade.value.b],
    tip: [U.uTip.value.r, U.uTip.value.g, U.uTip.value.b], beak: [U.uBeak.value.r, U.uBeak.value.g, U.uBeak.value.b],
    errWhite: eq(U.uWhite.value, piece.colours.p90), errShade: eq(U.uShade.value, piece.colours.green), errTip: eq(U.uTip.value, piece.colours.p10),
    p90: piece.colours.p90, green: piece.colours.green, p10: piece.colours.p10,
  };
  out.share = { keys: [], bad: [] };
  for (const k of ["uLightDir", "uLightColor", "uAmbient", "uShadowTint", "uSkyFill", "uGroundBounce", "uRimColor", "uUnlitK"]) {
    out.share.keys.push(k); if (U[k] !== S.U[k]) out.share.bad.push(k);
  }
  out.shader = { usesToonLight: /toonLight\(/.test(mat.fragmentShader), usesAerial: /aerial\(/.test(mat.fragmentShader),
    shadeOnUnderside: /if \(under\) base = uShade/.test(mat.fragmentShader), tipByObjX: /abs\(vObj\.x\) > 0\.86/.test(mat.fragmentShader),
    flapInShader: /gullFlap\(position, aSeg, aGull, uGullTime, n\)/.test(mat.vertexShader),
    tipGlsl: (mat.fragmentShader.match(/abs\(vObj\.x\) > ([\d.]+)/) || [])[1] };

  // ---- orbit radius / bob / floor: the JS twin of the shader through the REAL instance matrices, over 240 s ----
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), V = new THREE.Vector3(), Sc = new THREE.Vector3(), Pc = new THREE.Vector3(), Qc = new THREE.Quaternion();
  const Qr = new THREE.Quaternion().setFromAxisAngle(Z, -G.GULL.BANK), Qy = new THREE.Quaternion(), M = new THREE.Matrix4(), Mi = new THREE.Matrix4();
  const per = L.gulls.map((q, i) => ({ i, card: q.card, copy: q.copy, copies: q.copies, cw: q.cw, R: q.R, hs: q.hs, bob: q.bob, y0: q.y0, y1: q.y1, yc: q.yc, w: q.w, g: q.g,
    Rmin: Infinity, Rmax: -Infinity, ymin: Infinity, ymax: -Infinity, rhoObj: 0, scale: 0, p0: null }));
  const times = []; for (let t = 0; t <= 240; t += 2) times.push(t);
  for (const t of times) {
    L.setTime(t);
    for (const p of per) {
      mesh.getMatrixAt(p.i, Mi); Mi.decompose(Pc, Qc, Sc);
      p.scale = Sc.x;
      if (t === 0) p.p0 = [Pc.x, Pc.z];
      const rr = Math.hypot(Pc.x, Pc.z); p.Rmin = Math.min(p.Rmin, rr); p.Rmax = Math.max(p.Rmax, rr);
      for (let v = 0; v < nv; v++) {
        const pp = G.gullFlapJS([pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]], sa[v], p.g, t);
        V.set(pp[0], pp[1], pp[2]).applyMatrix4(Mi);
        p.ymin = Math.min(p.ymin, V.y); p.ymax = Math.max(p.ymax, V.y);
        p.rhoObj = Math.max(p.rhoObj, Math.hypot(pp[0], pp[1], pp[2]));
      }
    }
  }
  out.per = per;
  // each gull's OWN picture-copy centre, from the recipe alone: the card's base + ((k + 0.5)/copies - 0.5) x w
  // along the card's own dir; its distance from the arena centre is the orbit radius the gull must keep
  out.copy = L.gulls.map((q) => {
    const c = piece.cards[q.card], dir = c.dir || [0, 0], off = ((q.copy + 0.5) / q.copies - 0.5) * c.w;
    const x = c.base[0] + off * dir[0], z = c.base[2] + off * dir[1];
    return { card: q.card, copy: q.copy, copies: q.copies, off, cw: c.w / q.copies, w: c.w, h: c.h, baseY: c.base[1], x, z, R: Math.hypot(x, z) };
  });
  out.cardR = out.copy.map((k) => k.R);
  out.spanRatio = per.map((p, i) => (2 * p.hs) / out.copy[i].cw);
  // the drawn span over time (JS twin), object units
  let spanMaxJS = 0, leftX = 0, rightX = 0;
  for (let t = 0; t <= 120; t += 0.05) for (let v = 0; v < nv; v++) {
    if (sa[v] < 0.5) continue;
    const pp = G.gullFlapJS([pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]], sa[v], per[0].g, t);
    spanMaxJS = Math.max(spanMaxJS, Math.abs(pp[0]));
    if (pp[0] > 0) rightX = Math.max(rightX, pp[0]); else leftX = Math.max(leftX, -pp[0]);
  }
  out.spanDrawn = spanMaxJS * 2 * per[0].hs / out.copy[0].cw;
  out.spanSides = [leftX, rightX];

  // ---- GPU vertex probe: the material's OWN vertex shader, one pixel per vertex, position out ----
  const Rr = B.renderer, gl = Rr.getContext();
  const cc0 = Rr.getClearColor(new THREE.Color()), ca0 = Rr.getClearAlpha();
  const probe = (gi, t) => {
    const q = L.gulls[gi];
    const P = new Float32Array(nv * 3), SG = new Float32Array(nv), AG = new Float32Array(nv * 3), PR = new Float32Array(nv * 2), NR = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      P.set([pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]], i * 3); SG[i] = sa[i]; AG.set(q.g, i * 3);
      PR.set([(i + 0.5) / nv * 2 - 1, 0], i * 2);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(P, 3)); pg.setAttribute("normal", new THREE.BufferAttribute(NR, 3));
    pg.setAttribute("aSeg", new THREE.BufferAttribute(SG, 1)); pg.setAttribute("aGull", new THREE.BufferAttribute(AG, 3));
    pg.setAttribute("aProbe", new THREE.BufferAttribute(PR, 2));
    const vs = mat.vertexShader
      .replace("attribute float aSeg; attribute vec3 aGull;", "attribute float aSeg; attribute vec3 aGull; attribute vec2 aProbe;")
      .replace("gl_Position = projectionMatrix * viewMatrix * w;", "gl_Position = vec4(aProbe.x, 0.0, 0.0, 1.0); gl_PointSize = 1.0;");
    const pm = new THREE.ShaderMaterial({ uniforms: mat.uniforms, vertexShader: vs,
      fragmentShader: "varying vec3 vW; void main(){ gl_FragColor = vec4(vW, 1.0); }" });
    const rt = new THREE.WebGLRenderTarget(nv, 1, { type: THREE.FloatType, depthBuffer: false });
    const sc = new THREE.Scene(), pts = new THREE.Points(pg, pm); pts.frustumCulled = false; sc.add(pts);
    mat.uniforms.uGullTime.value = t;
    const prev = Rr.getRenderTarget();
    Rr.setRenderTarget(rt); Rr.setClearColor(0, 1); Rr.clear(); Rr.render(sc, new THREE.Camera());
    const px = new Float32Array(nv * 4); Rr.readRenderTargetPixels(rt, 0, 0, nv, 1, px); Rr.setRenderTarget(prev);
    rt.dispose(); pm.dispose(); pg.dispose();
    return Array.from({ length: nv }, (_, i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  };
  const q0 = L.gulls[0], pts = [0.0, 0.11, 1.37, 2.9];
  const probes = pts.map((t) => probe(0, t));
  Rr.setClearColor(cc0, ca0);
  const twin = (t) => Array.from({ length: nv }, (_, v) => G.gullFlapJS([pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]], sa[v], q0.g, t));
  let errTwin = 0, bodyMove = 0, wingMove = 0, spanMax = 0;
  for (const [k, t] of pts.entries()) {
    const tw = twin(t), pr = probes[k];
    for (let v = 0; v < nv; v++) {
      errTwin = Math.max(errTwin, Math.hypot(pr[v][0] - tw[v][0], pr[v][1] - tw[v][1], pr[v][2] - tw[v][2]));
      spanMax = Math.max(spanMax, Math.abs(pr[v][0]));
      const d = Math.max(...probes.map((pp) => Math.hypot(pp[v][0] - probes[0][v][0], pp[v][1] - probes[0][v][1], pp[v][2] - probes[0][v][2])));
      if (sa[v] < 0.5) bodyMove = Math.max(bodyMove, d); else wingMove = Math.max(wingMove, d);
    }
  }
  out.probe = { nv, errTwin, bodyMove, wingMove, spanMax, times: pts };

  // ---- keep-out, independent of the module ----
  const eyes = [];
  for (const g of out.keepOut.rings) for (let a = 0; a < 360; a += 3) eyes.push([Math.sin(a * Math.PI / 180) * g.r, g.y, Math.cos(a * Math.PI / 180) * g.r]);
  const coneReach = (eye, fi) => Math.max(Math.hypot(eye[0], eye[2]), Math.hypot(fi.c[0], fi.c[2]) + fi.r);
  const whyFor = (i, rings, fighters, azStep) => {
    const p = per[i], rho = p.rhoObj * p.hs;
    if (p.R - rho < out.keepOut.fightR) return "fight";
    for (const ring of rings) for (let e = 0; e < 360; e += 3) {
      const eye = [Math.sin(e * Math.PI / 180) * ring.r, ring.y, Math.cos(e * Math.PI / 180) * ring.r];
      for (const fi of fighters) {
        if (p.R - rho > coneReach(eye, fi)) continue;          // the hull cannot reach the orbit
        for (let a = 0; a < 360; a += azStep) for (const dy of [-p.bob, 0, p.bob]) {
          const c = [p.R * Math.sin(a * Math.PI / 180), p.yc + dy, p.R * Math.cos(a * Math.PI / 180)];
          if (S.inViewCone(c, rho, eye, fi.c, fi.r)) return "cone";
        }
      }
    }
    return null;
  };
  const real = { fightR: ko.fightR, farthest: ko.farthest, rings: ko.rings, fighters: ko.fighters };
  out.keepMine = L.gulls.map((q, i) => {
    const p = per[i], rho = p.rhoObj * p.hs;
    let maxCone = 0;
    for (const e of eyes) for (const fi of out.keepOut.fighters) maxCone = Math.max(maxCone, coneReach(e, fi));
    return { i, R: q.R, rho: +rho.toFixed(1), clearance: +(q.R - rho - out.keepOut.fightR).toFixed(0), maxCone: Math.round(maxCone), why: whyFor(i, out.keepOut.rings, out.keepOut.fighters, 1) };
  });
  out.keepModule = { shown: L.info.shown, hiddenWhy: L.info.hiddenWhy, exactTests: L.info.exactTests };

  // forced states: the hide path must work; every gull left SHOWN must still pass the independent test
  // read the instance matrix itself: three's decompose() reports 1 for a zero-scale matrix, the array does not lie
  const matrixScale = (i) => { const a = mesh.instanceMatrix.array, o = i * 16;
    return +Math.max(Math.hypot(a[o], a[o + 1], a[o + 2]), Math.hypot(a[o + 4], a[o + 5], a[o + 6]), Math.hypot(a[o + 8], a[o + 9], a[o + 10])).toFixed(3); };
  const stateOf = () => ({ shown: L.info.shown, hidden: L.info.hiddenWhy.map(([i, w]) => [i, w]), scales: L.gulls.map((q, i) => matrixScale(i)) });
  L.place({ fightR: 20000, farthest: 19000, rings: real.rings, fighters: real.fighters });
  out.forceFight = stateOf();
  const savedRings = ko.rings;
  ko.rings = [{ r: L.gulls[0].R, y: L.gulls[0].yc }];        // an eye ring on gull 0's orbit (restored below)
  L.place({ fightR: real.fightR, farthest: real.farthest, rings: ko.rings, fighters: real.fighters });
  out.forceCone = stateOf();
  out.forceConeMine = L.gulls.map((q, i) => whyFor(i, ko.rings, real.fighters, 2));
  ko.rings = savedRings;
  L.place(real);
  out.restored = stateOf();

  // ---- pixels: gulls alone, day vs night, close up ----
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const world = mesh.parent;
  let hidden = [];
  const onlyGulls = () => { B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== mesh && o.visible) { hidden.push(o); o.visible = false; } });
    if (B.camera.userData.sky && B.camera.userData.sky.visible) { hidden.push(B.camera.userData.sky); B.camera.userData.sky.visible = false; } };
  const restoreAll = () => { for (const o of hidden) o.visible = true; hidden = []; };
  const readPx = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const setCam = (cam) => { const c = B.camera; c.fov = cam.fovRad * 180 / Math.PI; c.aspect = cam.aspect; c.updateProjectionMatrix();
    c.position.set(...cam.eye); c.up.set(...cam.up); c.lookAt(new THREE.Vector3(...cam.look)); c.updateMatrixWorld(); };
  const renderAt = (cam, t) => { setCam(cam); world.scale.setScalar(1); L.setTime(t); Rr.render(B.scene, B.camera); };
  const camOf = (i, t) => {
    const c = L.at(i, t).c, az = Math.atan2(c[0], c[2]), d = 3.2 * L.gulls[i].hs;
    return { fovRad: 45 * Math.PI / 180, aspect: W / H, eye: [c[0] + Math.sin(az) * d * 0.85, c[1] + d * 0.42, c[2] + Math.cos(az) * d * 0.85], look: c, up: [0, 1, 0] };
  };
  const stats = (px) => {
    let n = 0, s = [0, 0, 0], lum = 0, white = 0, lav = 0, dark = 0, bs = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (r + g + b < 6) continue;
      n++; s[0] += r; s[1] += g; s[2] += b;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; lum += l;
      if (l > 110 && Math.abs(b - r) < 22) { white++; bs[0] += r; bs[1] += g; bs[2] += b; }
      if (b - r > 8 && l > 25 && l < 170) lav++;
      if (l < 22) dark++;
    }
    return { n, mean: s.map((v) => v / Math.max(1, n)), luma: lum / Math.max(1, n), white, lav, dark, brightMean: bs.map((v) => v / Math.max(1, white)) };
  };
  const cam0 = camOf(0, 1.3);
  LV.setSkyMode("day"); onlyGulls(); renderAt(cam0, 1.3); const dayPx = readPx(); const lightDay = [S.U.uLightColor.value.r, S.U.uLightColor.value.g, S.U.uLightColor.value.b]; restoreAll();
  LV.setSkyMode("night"); onlyGulls(); renderAt(cam0, 1.3); const nightPx = readPx(); const lightNight = [S.U.uLightColor.value.r, S.U.uLightColor.value.g, S.U.uLightColor.value.b]; restoreAll();
  LV.setSkyMode("day");
  let diff = 0, big = 0;
  for (let i = 0; i < dayPx.length; i += 4) if (dayPx[i] !== nightPx[i] || dayPx[i + 1] !== nightPx[i + 1] || dayPx[i + 2] !== nightPx[i + 2]) {
    diff++; if (Math.abs(dayPx[i] - nightPx[i]) + Math.abs(dayPx[i + 1] - nightPx[i + 1]) + Math.abs(dayPx[i + 2] - nightPx[i + 2]) > 24) big++;
  }
  out.pix = { size: [W, H], day: stats(dayPx), night: stats(nightPx), diff, big, lightDay, lightNight, mode: S.light.mode };
  onlyGulls(); renderAt(cam0, 1.3); const f0 = readPx(); renderAt(cam0, 1.5); const f1 = readPx(); restoreAll();
  let fmove = 0; for (let i = 0; i < f0.length; i += 4) if (f0[i] !== f1[i] || f0[i + 1] !== f1[i + 1] || f0[i + 2] !== f1[i + 2]) fmove++;
  out.pix.flapPixels = fmove;
  onlyGulls(); renderAt(camOf(5, 2.1), 2.1); out.pix.gull5 = stats(readPx()); restoreAll();
  // seen from below: the wing undersides take the lavender shade (uShade), the top is white
  const under = (i, t) => { const c = L.at(i, t).c, az = Math.atan2(c[0], c[2]), d = 3.2 * L.gulls[i].hs;
    return { fovRad: 45 * Math.PI / 180, aspect: W / H, eye: [c[0] + Math.sin(az) * d * 0.8, c[1] - d * 0.45, c[2] + Math.cos(az) * d * 0.8], look: c, up: [0, 1, 0] }; };
  onlyGulls(); renderAt(under(0, 1.3), 1.3); out.pix.under = stats(readPx()); restoreAll();

  // ---- draw calls / triangles / frame time (the real frame path) ----
  const camR = window.__r.getCameraInfo().render;
  const draw = () => { B.render(camR); return { calls: B.info.calls, tris: B.info.triangles }; };
  mesh.visible = true; const withG = draw();
  mesh.visible = false; const withoutG = draw();
  mesh.visible = true;
  onlyGulls(); mesh.visible = true; const alone = draw(); restoreAll();
  out.draw = { withG, withoutG, alone, deltaCalls: withG.calls - withoutG.calls, deltaTris: withG.tris - withoutG.tris };
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return (b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2; };
  const one = new Uint8Array(4);
  const block = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camR); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  const perBlock = Math.max(10, Math.round(FRAMES / 10)), on = [], off = [];
  mesh.visible = true; block(10); mesh.visible = false; block(10); mesh.visible = true;
  for (let k = 0; k < 10; k++) { mesh.visible = true; on.push(block(perBlock)); mesh.visible = false; off.push(block(perBlock)); }
  mesh.visible = true;
  out.frame = { on: med(on), off: med(off), cost: med(on.map((v, i) => v - off[i])), size: [W, H], renderer: (() => { const d = gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() };
  const pi = Rr.info.programs || [];
  out.programs = { count: pi.length, failed: pi.filter((p) => p.diagnostics && !p.diagnostics.runnable).length,
    logs: pi.filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => (p.diagnostics.vertexShader?.log || p.diagnostics.fragmentShader?.log || "").slice(0, 300)) };
  out.glError = gl.getError();
  out.infoAfter = { shown: L.info.shown, hiddenWhy: L.info.hiddenWhy, mode: S.light.mode };
  return out;
}, { FRAMES });

await page.evaluate(() => { window.__renderFrame(performance.now()); window.__renderFrame(performance.now() + 16); });
await page.waitForTimeout(500);
await browser.close().catch(() => {});

if (R.missing) { console.log("FAIL no built arena"); process.exit(1); }
if (R.noGulls) { console.log(`FAIL no gulls layer: layers ${JSON.stringify(R.layerIds)}, missing ${JSON.stringify(R.missingLayers)}`); process.exit(1); }

const L2 = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const blue = (c) => c[2] / Math.max(1e-6, c[0] + c[1] + c[2]);
const P = R.recipe, cards = P.cards, per = R.per, N = per.length;
const copies = cards.map((c) => Math.max(1, Math.round(c.copies || 1)));
const nCopies = copies.reduce((a, b) => a + b, 0);
const wantOrder = cards.flatMap((c, ci) => Array.from({ length: copies[ci] }, (_, k) => [ci, k]));

// ---- 1. wiring ----
const gullMissing = (R.missingLayers || []).filter((m) => m.id === "gulls");
check(!gullMissing.length && R.layerIds.includes("gulls"), `gulls layer loaded: layers ${R.layerIds.join(",")}; missingLayers ${(R.missingLayers || []).map((m) => m.id).join(",") || "none"}`);
check(R.mesh.meshes === 1 && R.mesh.instanced && R.mesh.inScene && R.mesh.aGull && R.mesh.count === N && R.info.count === N &&
  R.info.cards === cards.length && JSON.stringify(R.info.cardCopies) === JSON.stringify(copies) && N === nCopies && N === 14,
  `one InstancedMesh with ${N} gulls = ${cards.length} recipe cards x ${copies.join("/")} picture copies each (${P.tris} tris, ${cards.length} cards ${cards.map((c) => c.w + "x" + c.h).join(" ")})`);
check(per.every((p, i) => p.card === wantOrder[i][0] && p.copy === wantOrder[i][1] && p.copies === copies[wantOrder[i][0]]),
  `gull order card-then-copy: ${per.map((p) => `${p.card}.${p.copy}`).join(" ")}`);
check(R.mesh.tris === 15 && R.info.trisPerGull === 15 && R.mesh.aSeg, `gull geometry: ${R.mesh.tris} triangles per gull (body 9 + 3 per wing), ${N * R.mesh.tris} for ${N}`);

// ---- 2. orbit radius = the gull's own picture copy's distance ----
let rErr = 0, rDrift = 0, sErr = 0, t0Err = 0, cwErr = 0;
for (let i = 0; i < N; i++) {
  rErr = Math.max(rErr, Math.abs(per[i].R - R.cardR[i])); rDrift = Math.max(rDrift, per[i].Rmax - per[i].Rmin);
  sErr = Math.max(sErr, Math.abs(per[i].scale - per[i].hs)); cwErr = Math.max(cwErr, Math.abs(per[i].cw - R.copy[i].cw));
  t0Err = Math.max(t0Err, Math.hypot(per[i].p0[0] - R.copy[i].x, per[i].p0[1] - R.copy[i].z));
}
console.log(`     (info) orbit radius / its copy centre distance: ${per.map((p, i) => `${f(p.R, 1)}/${f(R.cardR[i], 1)}`).join(" ")}`);
console.log(`     (info) copy centres along dir: ${R.copy.map((k) => `c${k.card}.${k.copy} off ${f(k.off, 1)} (w ${f(k.w, 1)} / ${k.copies} = ${f(k.cw, 1)})`).join("; ")}`);
check(rErr <= 1, `each orbit radius = its own picture copy's centre distance: worst ${f(rErr, 4)} units (<= 1); rendered circle over 240 s within ${f(rDrift, 5)} units, instance scale = half span (+-${f(sErr, 6)})`);
check(t0Err <= 1 && cwErr < 1e-9, `each gull starts on its own copy centre (worst ${f(t0Err, 4)} units) and its copy width = card width / copies (worst ${cwErr.toExponential(1)})`);

// ---- 3. bob inside the card's height band, never below the floor ----
const bobBad = [], bandBad = [];
let floorMin = Infinity, yLo = Infinity, yHi = -Infinity;
for (let i = 0; i < N; i++) {
  const p = per[i], c = cards[p.card];
  if (!(p.bob > 0) || p.bob > c.h / 2 + 1e-6) bobBad.push(i);
  if (p.ymin < c.base[1] - 0.5 || p.ymax > c.base[1] + c.h + 0.5) bandBad.push([i, f(p.ymin, 1), f(c.base[1], 1), f(p.ymax, 1), f(c.base[1] + c.h, 1)]);
  floorMin = Math.min(floorMin, p.ymin); yLo = Math.min(yLo, p.ymin); yHi = Math.max(yHi, p.ymax);
}
console.log(`     (info) bob amplitude ${per.map((p) => f(p.bob, 1)).join(" ")} units; every vertex over 240 s y ${f(yLo, 1)}..${f(yHi, 1)} (piece band ${f(P.ymin, 1)}..${f(P.ymax, 1)})`);
check(!bobBad.length && !bandBad.length, `bob stays inside the card's measured height band: ${N} gulls, ${bandBad.length} outside their card ${JSON.stringify(bandBad)}`);
check(yLo >= P.ymin - 0.5 && yHi <= P.ymax + 0.5, `all ${N * 45} gull vertices over 240 s inside the piece's measured band y ${f(P.ymin, 1)}..${f(P.ymax, 1)}`);
check(floorMin >= 0, `no gull vertex ever below the arena floor: lowest y ${f(floorMin, 2)} (>= 0)`);

// ---- 4. wing span = 0.96 x the copy width (= half the card on meft1002) ----
const spanWorst = Math.max(...R.spanRatio.map((v) => Math.abs(v - 0.96)));
console.log(`     (info) nominal span / copy width ${R.spanRatio.map((v) => f(v, 4)).join(" ")}; drawn span through the shader ${f(R.spanDrawn, 4)} x copy width (max |x| ${f(R.probe.spanMax, 4)} of the GPU probe, JS ${f(R.spanSides[0], 4)}/${f(R.spanSides[1], 4)})`);
check(spanWorst < 1e-9, `wing span = 0.96 x the copy width (= card width / copies) for every gull (worst ${spanWorst.toExponential(1)})`);
check(R.spanDrawn > 0.9 && R.spanDrawn <= 0.96 && Math.abs(R.spanSides[0] - R.spanSides[1]) < 1e-3,
  `drawn span (the M-bend shortens it) ${f(R.spanDrawn, 3)} x copy width, in 0.90..0.96; wings symmetric ${f(R.spanSides[0], 4)} / ${f(R.spanSides[1], 4)}`);

// ---- 5. keep-out ----
const worstClear = Math.min(...R.keepMine.map((k) => k.clearance));
const coneMax = Math.max(...R.keepMine.map((k) => k.maxCone));
console.log(`     (info) fight radius ${R.keepOut.fightR} (farthest fighter ${R.keepOut.farthest}); orbit closest approach ${R.keepMine.map((k) => f(k.R - k.rho, 0)).join(" ")}; widest cone reach ${coneMax}; nearest clearance ${worstClear}`);
console.log(`     (info) module: shown ${R.keepModule.shown}, hidden ${JSON.stringify(R.keepModule.hiddenWhy)}, exact tests ${R.keepModule.exactTests}`);
check(R.keepMine.every((k) => !k.why) && R.keepModule.shown === N && !R.keepModule.hiddenWhy.length,
  `every gull outside the fight radius (clearance >= ${worstClear}) and outside every eye cone (${R.keepOut.rings.length} rings x 120 eyes x ${R.keepOut.fighters.length} fighters, reach <= ${coneMax} < the orbit's closest approach)`);
console.log(`     (info) forced fight: shown ${R.forceFight.shown}, hidden ${JSON.stringify(R.forceFight.hidden)}, scales ${JSON.stringify(R.forceFight.scales)}`);
check(R.forceFight.shown === 0 && R.forceFight.hidden.length === N && R.forceFight.hidden.every(([, w]) => w === "fight") && R.forceFight.scales.every((s) => s === 0),
  `forced fight radius over the orbit: all ${N} gulls hidden with reason "fight", every instance scaled to 0`);
const coneHidden = R.forceCone.hidden.filter(([, w]) => w === "cone").length;
const shownCone = R.forceCone.hidden.map(([i]) => i);
const coneSafe = R.forceConeMine.every((w, i) => shownCone.includes(i) || !w);
console.log(`     (info) forced eye ring on gull 0's orbit: shown ${R.forceCone.shown}, hidden ${JSON.stringify(R.forceCone.hidden)}, independent ${JSON.stringify(R.forceConeMine)}`);
console.log(`     (info) forced cone: shown ${R.forceCone.shown}, hidden ${JSON.stringify(R.forceCone.hidden)}, scales ${JSON.stringify(R.forceCone.scales)}, safe ${coneSafe}`);
check(coneHidden >= 1 && R.forceCone.scales.every((s, i) => (shownCone.includes(i) ? s === 0 : s > 0)) && coneSafe,
  `forced eye ring: ${coneHidden} gull(s) hidden with reason "cone", hidden ones scaled to 0, every gull still shown passes the independent cone test`);
check(R.restored.shown === N && !R.restored.hidden.length && R.restored.scales.every((s) => s > 0), `the real keep-out restored: ${R.restored.shown}/${N} shown again`);

// ---- 6. draw call / triangles ----
console.log(`     (info) calls with gulls ${R.draw.withG.calls}, without ${R.draw.withoutG.calls}; triangles ${R.draw.withG.tris} vs ${R.draw.withoutG.tris}; gulls alone ${JSON.stringify(R.draw.alone)}`);
check(R.draw.deltaCalls === 1 && R.draw.deltaTris === N * 15 && N * 15 === 210, `exactly 1 draw call and ${N * 15} triangles (= ${N} gulls x 15) for the gulls (measured delta ${R.draw.deltaCalls} call, ${R.draw.deltaTris} triangles)`);
check(R.draw.alone.calls === 1 && R.draw.alone.tris === 210, `gulls drawn alone: ${R.draw.alone.calls} call, ${R.draw.alone.tris} triangles`);

// ---- 7. the shared sun / moon light ----
const dP = R.pix.day, nP = R.pix.night;
console.log(`     (info) gull pixels ${dP.n} px at ${R.pix.size.join("x")}; day mean ${dP.mean.map((v) => f(v, 1)).join(",")} luma ${f(dP.luma, 1)}; night mean ${nP.mean.map((v) => f(v, 1)).join(",")} luma ${f(nP.luma, 1)}; changed ${R.pix.diff} px (${R.pix.big} by > 24)`);
console.log(`     (info) light colour day ${R.pix.lightDay.map((v) => f(v, 3)).join(",")} night ${R.pix.lightNight.map((v) => f(v, 3)).join(",")} (${R.pix.mode})`);
check(!R.share.bad.length, `one shared light: ${R.share.keys.length} light uniforms are the shared objects (bad: ${R.share.bad.join(",") || "none"})`);
check(R.shader.usesToonLight && R.shader.usesAerial, `gulls shade through the shared toonLight() and aerial()`);
check(dP.n > 5000 && R.pix.diff > 1000 && R.pix.big > 500, `forcing night changes their pixels: ${R.pix.diff} of ${dP.n} px differ (${R.pix.big} strongly)`);
check(nP.luma < dP.luma * 0.75 && blue(nP.mean) > blue(dP.mean),
  `night shades them darker and bluer: luma ${f(nP.luma, 1)} vs ${f(dP.luma, 1)} (x${f(nP.luma / Math.max(1, dP.luma), 3)}), blue share ${f(blue(nP.mean), 3)} vs ${f(blue(dP.mean), 3)}`);

// ---- 8. the flap moves wing vertices ----
console.log(`     (info) GPU vertex probe: ${R.probe.nv} vertices, shader vs JS twin worst ${R.probe.errTwin.toExponential(1)} object units; body move ${R.probe.bodyMove.toExponential(1)}, wing move ${f(R.probe.wingMove, 3)}; pixels changed by time alone ${R.pix.flapPixels}`);
check(R.probe.errTwin < 2e-3, `the shader's flap = the JS twin (worst ${R.probe.errTwin.toExponential(1)} object units)`);
check(R.probe.bodyMove < 1e-4 && R.probe.wingMove > 0.3, `flap moves wing vertices over time: wing ${f(R.probe.wingMove, 3)} object units = ${f(R.probe.wingMove * per[0].hs, 0)} arena units, body still (${R.probe.bodyMove.toExponential(1)})`);
check(R.pix.flapPixels > 500, `the flap shows in the frame: ${R.pix.flapPixels} px change with time alone at a fixed camera`);

// ---- 9. colours from the measured piece ----
const C = R.colours;
console.log(`     (info) uWhite ${C.white.map((v) => f(v, 4)).join(",")} = p90 ${C.p90}; uShade ${C.shade.map((v) => f(v, 4)).join(",")} = green ${C.green}; uTip ${C.tip.map((v) => f(v, 4)).join(",")} = p10 ${C.p10}`);
check(C.errWhite < 1e-6 && C.errShade < 1e-6 && C.errTip < 1e-6, `colours are the piece's measured p90 (white) / lavender bucket / p10 (tips): errors ${C.errWhite.toExponential(1)} ${C.errShade.toExponential(1)} ${C.errTip.toExponential(1)}`);
const g = C.green, tp = C.p10;
check(g[1] > g[0] && g[2] > g[1] && L2(tp) < 0.12 * 255, `the shade bucket is the lavender one (r ${g[0]} < g ${g[1]} < b ${g[2]}) and the tips are dark (luma ${f(L2(tp), 1)} of 255)`);
check(R.shader.shadeOnUnderside && R.shader.tipByObjX && +R.shader.tipGlsl === 0.86, `the fragment shader uses them: uShade on the undersides, uTip beyond |x| ${R.shader.tipGlsl}`);
const wShare = dP.white / dP.n, lShare = dP.lav / dP.n, kShare = dP.dark / dP.n;
console.log(`     (info) day render shares: white ${f(wShare * 100, 1)} % (mean ${dP.brightMean.map((v) => f(v, 0)).join(",")}), lavender ${f(lShare * 100, 1)} %, dark tips ${f(kShare * 100, 2)} %; gull 5 white ${f((R.pix.gull5.white / Math.max(1, R.pix.gull5.n)) * 100, 1)} % of ${R.pix.gull5.n} px`);
check(wShare > 0.2 && dP.brightMean.every((v) => v > 130) && Math.abs(dP.brightMean[2] - dP.brightMean[0]) < 26,
  `white body: ${f(wShare * 100, 1)} % of the gull's pixels are bright near-neutral (${dP.brightMean.map((v) => f(v, 0)).join(",")})`);
const uP = R.pix.under, uShare = uP.lav / uP.n;
console.log(`     (info) seen from below: ${uP.n} px, mean ${uP.mean.map((v) => f(v, 1)).join(",")}, lavender ${f(uShare * 100, 1)} %, white ${f((uP.white / uP.n) * 100, 1)} %`);
check(uShare > 0.2 && uP.n > 5000, `from below the wing undersides are the lavender shade: ${f(uShare * 100, 1)} % of ${uP.n} px (b > r)`);
check(kShare > 0.002, `dark tips (p10) ${f(kShare * 100, 2)} % of its pixels from above`);

// ---- 10. shader programs / frame time / errors ----
check(R.programs.failed === 0 && R.glError === 0, `shader programs compile: ${R.programs.count} programs, ${R.programs.failed} failed, gl error ${R.glError} ${R.programs.logs.join(" ")}`);
console.log(`     (info) whole world at ${R.frame.size.join("x")} on ${R.frame.renderer}: gulls on ${f(R.frame.on, 2)} ms, off ${f(R.frame.off, 2)} ms, gull cost ${f(R.frame.cost, 3)} ms (medians of 10 interleaved blocks, ${FRAMES} frames per state)`);
check(R.frame.on > 0 && R.frame.on <= 10, `whole world frame time ${f(R.frame.on, 2)} ms <= 10 ms at ${R.frame.size.join("x")}`);
check(Math.abs(R.frame.cost) < 1.0, `gulls cost ${f(R.frame.cost, 3)} ms/frame (1 draw call, ${N * 15} triangles, within +-1 ms)`);
for (const e of errors) console.log("   error:", e);
check(errors.length === 0, `page errors: ${errors.length}; ${resourceErrors.length} failed resource fetches (${[...new Set(resourceErrors)].join(" ") || "none"})`);
process.exit(fails ? 1 : 0);
