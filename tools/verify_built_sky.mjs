// Numbers check of the BUILT arena's sky (web/built/sky.js, plan Step 4), no pictures: pixel VALUES are read back from
// a 1x1 float render target (the dome's own mesh and material, a probe camera looking along one direction) and
// compared with numbers; nothing is ever looked at as an image.
//  DAY (the arena the viewer loaded, meft1013)
//  - the dome is 12 triangles, and its centre equals the eye every frame (the viewer's own frame loop)
//  - JS twin (skyRadianceJS) vs GPU at N directions, clouds off: max error in 0-255 sRGB (<= 2)
//  - clouds only where the view ray meets the arena's own sky ring between its measured heights (ymin..ymax):
//    every direction whose GPU colour differs from the cloud-free twin must hit the ring inside the band
//    (since the 3D clouds: the old noise decks are OFF, so the dome must differ from the twin NOWHERE)
//  - 3D CLOUDS (sky.js "builtClouds"): bank/puff count, one mesh, one draw call; every vertex of the mesh's OWN
//    buffer seen from 49 eyes (the viewer's + the keep-out sweep) meets the ring inside its measured band; every
//    vertex beyond the farthest tree/bush crown; GPU pixels of the clouds alone (24 views): none above the ring top
//    or below its foot; no hard edge: neighbour-row sky change above the clouds <= 2/255 (and the old decks, built
//    again on the night page, show their cut > 2/255, so the measure discriminates); toon tones vs the recipe's
//    p90; frame time clouds shown vs hidden (<= 1 ms); forced night: lit by the shared light from the MOON
//  - horizon / zenith / below-horizon colour vs the recipe's measured colours (delta in 0-255 sRGB)
//  - the arena is DAY, and the day dome carries no night light (moon 0, stars 0, no star map baked)
//  - HAZE: the aerial() of every lit material (shared.js LIGHT_GLSL) is probed with its OWN shader: a clip-space quad
//    per sample writes aerial(black, eye + dir*dist) into a float target, and the numbers must equal
//    skyRadiance(dir) * (1 - exp(-k d)) over 40 directions x 4 distances — i.e. the haze lifts toward the SKY'S OWN
//    radiance, not a lookalike. The max difference to the OLD flat mix(uSkyHorizon, uSkyZenith, smoothstep) is
//    printed as the discriminating power of the check, and at f -> 1 the haze must equal the DOME's own pixel.
//  NIGHT (a fresh page: the same recipe with its sky ring recoloured to a night measurement — no night recipe exists
//  on this box yet, see the report)
//  - DAY OR NIGHT COMES FROM THE MEASUREMENT: the mode of 8 recolourings of the ring's median colour equals the
//    luma test every time, and the run flips exactly once (no pack name is involved)
//  - the moon stands AGAINST THE LIGHT: same elevation, azimuth exactly opposite the sun's; its disc is measured by
//    a fan of probes across it (half-brightness angle vs the configured radius, hard edge, no light at the sun)
//  - three star tiers by count and brightness: counts strictly decreasing, every sampled star's GPU lift inside its
//    own band, the three bands disjoint and ordered; star-free directions show no lift; no star below the horizon
//  - the night sky obeys the same measured ring heights: clouds only inside the band, horizon/zenith vs the night
//    measurement, twin (skyDomeJS = radiance + moon disc + stars) <= 2/255
//  - the NIGHT haze equals the night dome over many directions (away from the disc and the stars)
//   VERIFY_PORT=8090 [ARENA=meft1013] [FRAMES=600] tools/run-playwright.sh tools/verify_built_sky.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1013";
const FRAMES = +(process.env.FRAMES || 600);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 60000 }).catch(() => {});
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

// dome centre vs eye over the viewer's own frames (sampled after each of its renders)
await page.evaluate(() => {
  window.__skyFollow = [];
  const f = () => {
    const B = window.__built, sky = B?.scene?.getObjectByName("builtSky");
    if (sky) {
      const a = sky.matrixWorld.elements, c = B.camera.matrixWorld.elements;
      window.__skyFollow.push(Math.hypot(a[12] - c[12], a[13] - c[13], a[14] - c[14]));
    }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
await page.waitForTimeout(3000);

const R = await page.evaluate(async ({ FRAMES }) => {
  const THREE = await import("./lib3d/three.module.js");
  const SK = await import("./built/sky.js");
  const S = await import("./built/shared.js");
  const B = window.__built, rr = B.renderer, out = {};
  const sky = B.scene.getObjectByName("builtSky");
  out.sameModule = SK.current.sky?.mesh === sky;
  out.tris = sky.geometry.index ? sky.geometry.index.count / 3 : sky.geometry.attributes.position.count / 3;
  out.follow = { frames: window.__skyFollow.length, max: Math.max(...window.__skyFollow) };
  out.info = B.info.sky;
  const camInfo = window.__r.getCameraInfo().render;
  B.render(camInfo);   // one fresh frame: the dome sits on the eye
  out.eye = B.camera.position.toArray().map((v) => +v.toFixed(1));
  out.domeAt = sky.position.toArray().map((v) => +v.toFixed(1));
  out.worldScale = B.scene.children.find((o) => o.isGroup && o !== sky)?.scale.x;
  out.ringEye = SK.SKY_U.uRingEye.value.toArray().map((v) => +v.toFixed(1));
  const H = B.renderer.getDrawingBufferSize(new THREE.Vector2()).y, fov = B.camera.fov;
  out.view = { H, fov: +fov.toFixed(2), pxRad: 2 * Math.tan(fov * Math.PI / 360) / H };

  // probe: the real dome + material, a camera on the same eye looking along d, 1x1 float target
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  const pfov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) / H) * 180 / Math.PI;   // same radians per pixel as the view
  const pc = new THREE.PerspectiveCamera(pfov, 1, 1, B.camera.far);
  const hidden = B.scene.children.filter((o) => o !== sky && o.visible);
  const px = new Float32Array(4);
  const probe = (d) => {
    pc.position.copy(B.camera.position);
    pc.up.set(0, 1, 0); if (Math.abs(d[1]) > 0.999) pc.up.set(0, 0, 1);
    pc.lookAt(pc.position.x + d[0], pc.position.y + d[1], pc.position.z + d[2]); pc.updateMatrixWorld();
    for (const o of hidden) o.visible = false;
    const prev = rr.getRenderTarget(); rr.setRenderTarget(rt); rr.render(B.scene, pc); rr.readRenderTargetPixels(rt, 0, 0, 1, 1, px); rr.setRenderTarget(prev);
    for (const o of hidden) o.visible = true;
    return [px[0], px[1], px[2]];
  };
  const s8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const d8 = (a, b) => Math.max(...a.map((v, k) => Math.abs(s8(v) - s8(b[k]))));
  const norm = (v) => { const L = Math.hypot(...v); return v.map((x) => x / L); };
  const SU = SK.SKY_U, keepAmt = SU.uCloudAmt.value;
  const sd = S.U.uSunDir.value, sun = [sd.x, sd.y, sd.z];

  // 1. twin vs GPU, clouds off
  SU.uCloudAmt.value = 0;
  // (a 1x1 probe aimed EXACTLY along a box edge reads an uncovered pixel; the full-size coverage test below shows the
  //  real view has no such gap, so probe directions are kept 1 deg off the box edges and corners)
  const dirs = [[0, 1, 0], sun, [0, -1, 0]];
  for (let a = 1; a < 360; a += 45) dirs.push([Math.sin(a * Math.PI / 180), 0, Math.cos(a * Math.PI / 180)]);
  const N = 64, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y); dirs.push([Math.cos(i * ga) * r, y, Math.sin(i * ga) * r]); }
  let worst = 0, worstAt = null;
  for (const d of dirs) { const e = d8(probe(d), SK.skyRadianceJS(d)); if (e > worst) { worst = e; worstAt = d.map((v) => +v.toFixed(3)); } }
  out.twin = { n: dirs.length, worst, worstAt };

  // 2. measured colours: horizon at right angles to the sun (the calibration spot) and round the circle; zenith; below
  const T = out.info.targets, lin = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  // what is below the horizon: the recipe's haze piece; a beach recipe has none, so the sky piece's own bottom colour
  // (the ring's foot, the last thing the dome draws before y = 0) is what is measured there instead
  const belowT = T.haze ?? T.horizon, belowSrc = T.haze ? "recipe haze" : "ring bottom (this arena has no haze piece)";
  const perp = norm([-sd.z, 0, sd.x]);
  out.horizon = { at90: d8(probe(perp), lin(T.horizon)), gpu: probe(perp).map((v) => +s8(v).toFixed(1)), target: T.horizon, round: [] };
  for (let a = 0; a < 360; a += 30) out.horizon.round.push(+d8(probe([Math.sin(a * Math.PI / 180), 0, Math.cos(a * Math.PI / 180)]), lin(T.horizon)).toFixed(1));
  out.zenith = { d: d8(probe([0, 1, 0]), lin(T.zenith)), target: T.zenith };
  // The dome cannot be darker than its own sun glow: calibrate() scales the two stops and never below 0. Where the
  // measured background is darker than that glow in a channel, no stop can reach it — so the check below holds the
  // dome to the measured colour in every channel it CAN reach, and prints the ones it cannot with their measured gap.
  {
    const glowUp = SK.skySunGlowJS([0, 1, 0]), tz = lin(T.zenith), dz = probe([0, 1, 0]);
    out.zenith.per = [0, 1, 2].map((k) => ({ k, target: tz[k], glow: glowUp[k], got: dz[k], reach: glowUp[k] <= tz[k],
      d8: Math.abs(s8(dz[k]) - s8(tz[k])) }));
    out.zenith.limited = out.zenith.per.some((q) => !q.reach);
    out.zenith.dReach = Math.max(0, ...out.zenith.per.filter((q) => q.reach).map((q) => q.d8));
  }
  out.below = { d: d8(probe(norm([-perp[0], -0.3, -perp[2]].map((v, k) => k === 1 ? v : -v))), lin(belowT)), target: belowT, src: belowSrc };

  // ---- 5. HAZE: the aerial() of the lit materials, run through its OWN shader, must equal the sky's radiance ----
  // The probe draws one clip-space quad per sample; its vertex shader makes the world point (eye + dir * dist) and the
  // fragment shader is shared.js's own aerial(), fed black, so the result is skyRadiance(dir) * (1 - exp(-k d)).
  const aerialProbe = (samples) => {
    const n = samples.length;
    const art = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const buf = new Float32Array(n * 4);
    const pos = new Float32Array(n * 18), adir = new Float32Array(n * 18), adist = new Float32Array(n * 6);
    for (let k = 0; k < n; k++) {
      const x0 = -1 + 2 * k / n, x1 = -1 + 2 * (k + 1) / n, quad = [[x0, -1], [x1, -1], [x1, 1], [x0, -1], [x1, 1], [x0, 1]];
      for (let v = 0; v < 6; v++) {
        const o = k * 6 + v;
        pos[o * 3] = quad[v][0]; pos[o * 3 + 1] = quad[v][1]; pos[o * 3 + 2] = 0;
        adir[o * 3] = samples[k].d[0]; adir[o * 3 + 1] = samples[k].d[1]; adir[o * 3 + 2] = samples[k].d[2];
        adist[o] = samples[k].dist;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(adir, 3));
    g.setAttribute("aDist", new THREE.BufferAttribute(adist, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: S.uniformsWith(),
      vertexShader: /* glsl */`attribute vec3 aDir; attribute float aDist; varying vec3 vW;
        void main() { vW = cameraPosition + aDir * aDist; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`varying vec3 vW;
        ${S.NOISE_GLSL}
        ${S.LIGHT_GLSL}
        void main() { gl_FragColor = vec4(aerial(vec3(0.0), vW), 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    const sc = new THREE.Scene(), qm = new THREE.Mesh(g, m); qm.frustumCulled = false; sc.add(qm);   // clip-space quad: never cull it
    const c2 = new THREE.PerspectiveCamera(45, 1, 1, 100); c2.position.copy(B.camera.position); c2.updateMatrixWorld();
    const cc = new THREE.Color(), ca = rr.getClearAlpha(); rr.getClearColor(cc);
    rr.setRenderTarget(art); rr.setClearColor(0x000000, 0); rr.clear(); rr.render(sc, c2);
    rr.readRenderTargetPixels(art, 0, 0, n, 1, buf); rr.setRenderTarget(null); rr.setClearColor(cc, ca);
    art.dispose(); m.dispose(); g.dispose();
    return Array.from({ length: n }, (_, k) => [buf[k * 4], buf[k * 4 + 1], buf[k * 4 + 2]]);
  };
  const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const oldSkyJS = (d) => {   // what aerial() lifted toward BEFORE: the flat palette pair (shared.js uSkyHorizon/uSkyZenith)
    const t = smooth01(0, 0.6, d[1]), H = [S.U.uSkyHorizon.value.r, S.U.uSkyHorizon.value.g, S.U.uSkyHorizon.value.b],
          Z = [S.U.uSkyZenith.value.r, S.U.uSkyZenith.value.g, S.U.uSkyZenith.value.b];
    return H.map((h, k) => h + (Z[k] - h) * t);
  };
  const hd = [];
  for (const el of [5, 15, 25, 35, 45, 55, 65, 75, 85]) for (const az of [0, 40, 80, 120, 160, 200, 240, 280, 320, 350]) {
    const ce = Math.cos(el * Math.PI / 180);
    hd.push([Math.sin(az * Math.PI / 180) * ce, Math.sin(el * Math.PI / 180), Math.cos(az * Math.PI / 180) * ce]);
  }
  const dists = [800, 3000, 12000, 2000000];
  const samples = []; for (const d of hd) for (const dist of dists) samples.push({ d, dist });
  const gpuAerial = aerialProbe(samples);
  const k = S.U.uAerialK.value;
  let hazeWorst = 0, hazeAt = null, oldWorst = 0, asymWorst = 0, asymAt = null;
  for (let i = 0; i < samples.length; i++) {
    const { d, dist } = samples[i], f = 1 - Math.exp(-dist * k);
    const want = SK.skyRadianceJS(d).map((v) => v * f);
    const e = d8(gpuAerial[i], want);
    if (e > hazeWorst) { hazeWorst = e; hazeAt = { el: Math.round(Math.asin(d[1]) * 180 / Math.PI), dist }; }
    oldWorst = Math.max(oldWorst, d8(SK.skyRadianceJS(d), oldSkyJS(d)));
    if (dist === 2000000) {   // f = 0.99998: the haze IS the sky there -> compare with the dome's own pixel
      const e2 = d8(gpuAerial[i], probe(d));
      if (e2 > asymWorst) { asymWorst = e2; asymAt = { el: Math.round(Math.asin(d[1]) * 180 / Math.PI), dist }; }
    }
  }
  out.haze = { n: samples.length, dirs: hd.length, dists, worst: hazeWorst, at: hazeAt, old: oldWorst, asym: asymWorst, asymAt };

  // 3. clouds in the band: grid of directions, cloud = GPU (clouds on) differs from the cloud-free twin by > 1.5/255
  SU.uCloudAmt.value = keepAmt;
  const [y0, y1] = out.info.band, eye = SU.uRingEye.value;
  const band = { dirs: 0, cloudy: 0, outside: 0, worstOut: null, elev: [90, -90], ringElev: [90, -90], quarter: [[0, 0], [0, 0], [0, 0], [0, 0]] };
  for (let az = 1; az < 360; az += 10) for (let el = -7.5; el <= 50; el += 1) {
    const ce = Math.cos(el * Math.PI / 180), d = [Math.sin(az * Math.PI / 180) * ce, Math.sin(el * Math.PI / 180), Math.cos(az * Math.PI / 180) * ce];
    const hy = SK.ringHitYJS(d, eye), inBand = hy >= y0 && hy <= y1;
    const cl = d8(probe(d), SK.skyRadianceJS(d)) > 1.5;
    band.dirs++;
    if (inBand) { band.ringElev[0] = Math.min(band.ringElev[0], el); band.ringElev[1] = Math.max(band.ringElev[1], el);
      const q = Math.min(3, Math.floor((hy - y0) / (y1 - y0) * 4)); band.quarter[q][0]++; if (cl) band.quarter[q][1]++; }
    if (!cl) continue;
    band.cloudy++; band.elev[0] = Math.min(band.elev[0], el); band.elev[1] = Math.max(band.elev[1], el);
    if (!inBand) { band.outside++; band.worstOut ||= { az, el, hy: Math.round(hy) }; }
  }
  out.band = band;
  rt.dispose();

  // 3c. the 3D cumulus: the mesh's OWN vertex buffer (times its world matrix) against the ring band from many eyes,
  //     then GPU pixels of the clouds alone (no twin), the sky rows above them, the tones, the frame time
  {
    const cm = B.scene.getObjectByName("builtClouds"), C = { info: out.info.clouds };
    C.meshes = B.scene.children.filter((o) => o.name === "builtClouds").length;
    const s = out.worldScale || 1, P = cm.geometry.attributes.position.array, M = cm.matrixWorld.elements;
    const V = [];
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      V.push([(M[0] * x + M[4] * y + M[8] * z + M[12]) / s, (M[1] * x + M[5] * y + M[9] * z + M[13]) / s, (M[2] * x + M[6] * y + M[10] * z + M[14]) / s]);
    }
    // the trees: farthest crown edge (instance spot + its scale times the species' horizontal half-size)
    let treeR = 0; const sp = B.info.foliage?.species || {}, fol = B.foliage?.children || [];
    for (const m of fol) {
      const box = sp[m.userData.species]?.box, half = box ? Math.max(...[0, 2].flatMap((k) => [Math.abs(box.min[k]), Math.abs(box.max[k])])) : 1;
      m.userData.at.forEach((a, i) => { treeR = Math.max(treeR, Math.hypot(a[0], a[2]) + m.userData.scale[i] * half); });
    }
    // the arena's own floor (ground.js "grass", sand.js "sand" / "shore"): the other thing a cloud must stand behind
    let floorR = 0, floorN = 0;
    B.scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !["grass", "sand", "shore"].includes(o.userData.kind)) return;
      floorN++;
      const Pa = o.geometry.attributes.position;
      for (let i = 0; i < Pa.count; i++) floorR = Math.max(floorR, Math.hypot(Pa.getX(i), Pa.getZ(i)));
    });
    C.trees = { r: treeR, meshes: fol.length, floorR: Math.round(floorR), floorN };
    // eyes: the viewer's own + every keep-out ring (eye distance, height) swept round the circle every 15 deg
    const eyes = [SU.uRingEye.value.toArray()], rings = (B.info.keepOut?.rings || []);
    for (const [rr, yy] of rings) for (let a = 0; a < 360; a += 15) eyes.push([Math.sin(a * Math.PI / 180) * rr / s, yy / s, Math.cos(a * Math.PI / 180) * rr / s]);
    const vt = { eyes: eyes.length, rings, tested: 0, outside: 0, hy: [1e9, -1e9], minR: 1e9, y: [1e9, -1e9] };
    for (const v of V) { vt.minR = Math.min(vt.minR, Math.hypot(v[0], v[2])); vt.y[0] = Math.min(vt.y[0], v[1]); vt.y[1] = Math.max(vt.y[1], v[1]); }
    for (const e of eyes) {
      const ev = new THREE.Vector3(...e);
      for (let i = 0; i < V.length; i += 2) {
        const d = norm([V[i][0] - e[0], V[i][1] - e[1], V[i][2] - e[2]]), hy = SK.ringHitYJS(d, ev);
        vt.tested++; if (hy < y0 || hy > y1) vt.outside++;
        vt.hy[0] = Math.min(vt.hy[0], hy); vt.hy[1] = Math.max(vt.hy[1], hy);
      }
    }
    vt.f = vt.hy.map((h) => (h - y0) / (y1 - y0));
    C.verts = vt;
    // GPU: clouds alone (cleared to alpha 0) and sky + clouds, from the eye at 12 headings x 2 pitches
    const W2 = 480, H2 = 360, cam = new THREE.PerspectiveCamera(fov, W2 / H2, B.camera.near, B.camera.far);
    const tg = new THREE.WebGLRenderTarget(W2, H2, { type: THREE.FloatType, format: THREE.RGBAFormat });
    const mask = new Float32Array(W2 * H2 * 4), full = new Float32Array(W2 * H2 * 4);
    const cc = new THREE.Color(), ca = rr.getClearAlpha(); rr.getClearColor(cc);
    const others = B.scene.children.filter((o) => o !== cm && o !== sky && o.visible);
    const mk = { views: 0, W: W2, H: H2, pixels: 0, above: 0, below: 0, maxEl: -90, ringTopEl: 0 };
    const edge = { views: 0, cols: 0, worst: 0, at: null }, tone = { maxLuma: -1, minLuma: 1e9, max: null, min: null };
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const dirOf = (px, py) => new THREE.Vector3((px + 0.5) / W2 * 2 - 1, (py + 0.5) / H2 * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize().toArray();
    const elOf = (d) => Math.asin(d[1]) * 180 / Math.PI;
    const rEye = SU.uRingEye.value;
    // the ring top's elevation in the direction d (bisection on the slope that meets the ring exactly at y1)
    const topEl = (d) => { const h = Math.hypot(d[0], d[2]); let lo = -1, hi = 3; for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi), q = norm([d[0] / h, m, d[2] / h]); if (SK.ringHitYJS(q, rEye) < y1) lo = m; else hi = m; } return Math.atan(lo) * 180 / Math.PI; };
    for (const o of others) o.visible = false;
    for (let hd = 0; hd < 360; hd += 30) for (const pitch of [0, 15]) {
      const t = hd * Math.PI / 180, p = pitch * Math.PI / 180;
      cam.position.copy(B.camera.position);
      cam.lookAt(cam.position.x + Math.sin(t) * Math.cos(p), cam.position.y + Math.sin(p), cam.position.z + Math.cos(t) * Math.cos(p)); cam.updateMatrixWorld();
      // the dome's own horizon line (el = 0) is a feature of the sky, not a cloud edge: rows at or below it are not
      // "above the clouds". Measured per view, once (elevation rises monotonically with the row).
      let hzRow = -1;
      for (let py = 0; py < H2; py++) { if (dirOf(W2 >> 1, py)[1] <= 0) hzRow = py; else break; }
      rr.setRenderTarget(tg); rr.setClearColor(0x000000, 0);
      sky.visible = false; rr.clear(); rr.render(B.scene, cam); rr.readRenderTargetPixels(tg, 0, 0, W2, H2, mask);
      sky.visible = true; rr.clear(); rr.render(B.scene, cam); rr.readRenderTargetPixels(tg, 0, 0, W2, H2, full);
      rr.setRenderTarget(null);
      mk.views++; edge.views++;
      for (let px = 0; px < W2; px++) {
        let topRow = -1;
        for (let py = 0; py < H2; py++) {
          const k = (py * W2 + px) * 4;
          if (mask[k + 3] < 0.5) continue;
          topRow = py; mk.pixels++;
          const d = dirOf(px, py), hy = SK.ringHitYJS(d, rEye);
          if (hy > y1) mk.above++; if (hy < y0) mk.below++;
          const el = elOf(d); if (el > mk.maxEl) { mk.maxEl = el; mk.ringTopEl = topEl(d); }
          const c8 = [s8(mask[k]), s8(mask[k + 1]), s8(mask[k + 2])], L = lum(c8);
          if (L > tone.maxLuma) { tone.maxLuma = L; tone.max = c8.map(Math.round); }
          if (L < tone.minLuma) { tone.minLuma = L; tone.min = c8.map(Math.round); }
        }
        // rows above the topmost cloud pixel AND above the dome's own horizon (3 px margin; whole column if it has no
        // cloud): neighbour-row change
        let any = false;
        for (let py = Math.max(0, topRow + 4, hzRow + 1); py < H2 - 1; py++) {
          const k = (py * W2 + px) * 4, k2 = ((py + 1) * W2 + px) * 4;
          if (mask[k2 + 3] >= 0.5 || mask[k + 3] >= 0.5) continue;
          any = true;
          const dlt = Math.max(...[0, 1, 2].map((ch) => Math.abs(s8(full[k + ch]) - s8(full[k2 + ch]))));
          if (dlt > edge.worst) { edge.worst = dlt; edge.at = { heading: hd, pitch, px, py, el: +elOf(dirOf(px, py)).toFixed(2) }; }
        }
        if (any) edge.cols++;
      }
    }
    for (const o of others) o.visible = true;
    rr.setClearColor(cc, ca); tg.dispose();
    C.mask = mk; C.edge = edge;
    tone.litErr = Math.max(...tone.max.map((v, k) => Math.abs(v - C.info.tones.lit[k])));
    tone.darkBlue = tone.min[2] >= tone.min[0] && tone.min[2] >= tone.min[1];
    C.tone = tone;
    // draw calls of the clouds alone
    const hideAll = B.scene.children.filter((o) => o !== cm && o.visible);
    for (const o of hideAll) o.visible = false;
    B.render(camInfo); C.drawCalls = B.info.calls;
    for (const o of hideAll) o.visible = true;
    // frame time, clouds shown vs hidden (readPixels makes the GPU finish each frame)
    const gl2 = rr.getContext(), one2 = new Uint8Array(4);
    const time2 = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl2.readPixels(0, 0, 1, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, one2); } return (performance.now() - t0) / n; };
    time2(10);
    let sh = 0, hi2 = 0;
    for (let rep = 0; rep < 3; rep++) { cm.visible = true; sh += time2(FRAMES / 3); cm.visible = false; hi2 += time2(FRAMES / 3); }
    cm.visible = true;
    C.frame = { shown: sh / 3, hidden: hi2 / 3, frames: FRAMES };
    out.clouds = C;
  }

  // 3b. the dome covers every pixel: the dome alone into a full-size float target cleared to alpha 0, from the view
  //     camera and from cameras aimed straight at a box edge and a box corner; uncovered pixels keep alpha 0
  {
    const W = B.renderer.getDrawingBufferSize(new THREE.Vector2()).x;
    const big = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const buf = new Float32Array(W * H * 4), cc = new THREE.Color(), ca = rr.getClearAlpha(); rr.getClearColor(cc);
    const vc = new THREE.PerspectiveCamera(fov, W / H, B.camera.near, B.camera.far);
    const res = [];
    for (const d of [null, [1, 0, 1], [1, 1, 1], [-1, -1, 1]]) {
      vc.position.copy(B.camera.position);
      if (d) vc.lookAt(vc.position.x + d[0], vc.position.y + d[1], vc.position.z + d[2]); else vc.quaternion.copy(B.camera.quaternion);
      vc.updateMatrixWorld();
      for (const o of hidden) o.visible = false;
      rr.setRenderTarget(big); rr.setClearColor(0x000000, 0); rr.clear(); rr.render(B.scene, vc); rr.readRenderTargetPixels(big, 0, 0, W, H, buf); rr.setRenderTarget(null);
      for (const o of hidden) o.visible = true;
      let gap = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] < 0.5) gap++;
      res.push(gap);
    }
    rr.setClearColor(cc, ca); big.dispose();
    out.cover = { W, H, gaps: res };
  }

  // 4. frame time, sky shown vs hidden (readPixels makes the GPU finish each frame)
  const gl = rr.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(10);
  sky.visible = true; const shown = time(FRAMES);
  sky.visible = false; const hid = time(FRAMES);
  sky.visible = true;
  out.frame = { shown, hidden: hid, frames: FRAMES, renderer: gl.getParameter(gl.RENDERER) };
  out.programs = { count: rr.info.programs.length, failed: rr.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  // the day dome must carry no night light at all (no star map baked either: a day arena pays nothing for night)
  out.nightOff = { mode: out.info.mode, moonAmt: SU.uMoonAmt.value, starAmt: SU.uStarAmt.value, stars: !!SK.current.stars };
  return out;
}, { FRAMES });

// ---------------- the viewer's "sky time" switch: night FORCED on this (day) arena, then back to auto ----------------
const FX = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const SK = await import("./built/sky.js");
  const B = window.__built, rr = B.renderer, out = {};
  const before = B.scene.getObjectByName("builtSky");
  out.night = window.__layers.setSkyMode("night");
  const sky = B.scene.getObjectByName("builtSky");
  out.rebuilt = { domes: B.scene.children.filter((o) => o.name === "builtSky").length, replaced: sky !== before,
                  same: SK.current.sky.mesh === sky && B.info.sky === SK.current.sky.info && B.materials.includes(sky.material) };
  B.render(window.__r.getCameraInfo().render);
  out.failed = rr.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
  const cloudState = () => {
    const cm = B.scene.getObjectByName("builtClouds"), u = cm?.material.uniforms, SU0 = window.__built.shared.U, g = SU0.uLightDir.value;
    const moon = SK.SKY_U.uMoonDir.value.clone().normalize(), sun = SU0.uSunDir.value.clone().normalize();
    return { meshes: B.scene.children.filter((o) => o.name === "builtClouds").length, mode: window.__built.shared.light.mode,
             sharedRef: u?.uLightDir === SU0.uLightDir && u?.uLightColor === SU0.uLightColor && u?.uAmbient === SU0.uAmbient,
             toMoon: g.clone().normalize().dot(moon), toSun: g.clone().normalize().dot(sun), key: SU0.uLightColor.value.toArray().map((v) => +v.toFixed(3)) };
  };
  out.clouds = cloudState();
  const SU = SK.SKY_U, rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  const H = rr.getDrawingBufferSize(new THREE.Vector2()).y, fov = B.camera.fov;
  const pc = new THREE.PerspectiveCamera(2 * Math.atan(Math.tan(fov * Math.PI / 360) / H) * 180 / Math.PI, 1, 1, B.camera.far), px = new Float32Array(4);
  const hidden = B.scene.children.filter((o) => o !== sky && o.visible);
  const probe = (d) => {
    pc.position.copy(B.camera.position); pc.up.set(0, 1, 0); if (Math.abs(d[1]) > 0.999) pc.up.set(0, 0, 1);
    pc.lookAt(pc.position.x + d[0], pc.position.y + d[1], pc.position.z + d[2]); pc.updateMatrixWorld();
    for (const o of hidden) o.visible = false;
    rr.setRenderTarget(rt); rr.render(B.scene, pc); rr.readRenderTargetPixels(rt, 0, 0, 1, 1, px); rr.setRenderTarget(null);
    for (const o of hidden) o.visible = true;
    return [px[0], px[1], px[2]];
  };
  const s8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const lin = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const d8 = (a, b) => Math.max(...a.map((v, k) => Math.abs(s8(v) - s8(b[k]))));
  // the moon must stand clear of the clouds: its ray never meets the ring inside the band (with clouds ON)
  const moon = SU.uMoonDir.value.toArray(), hy = SK.ringHitYJS(moon, SU.uRingEye.value), [y0, y1] = B.info.sky.band;
  out.moon = { amt: SU.uMoonAmt.value, elev: +(Math.asin(moon[1]) * 180 / Math.PI).toFixed(2), hitY: Math.round(hy), band: [y0, y1],
               clear: !(hy >= y0 && hy <= y1), lift: Math.max(...probe(moon).map((v, k) => v - SK.skyRadianceJS(moon)[k])) };
  // stars: each sampled star's GPU lift (clouds off) = its bake; zenith = the measured background
  const keep = SU.uCloudAmt.value; SU.uCloudAmt.value = 0;
  const st = SK.current.stars, errs = [];
  out.stars = st ? { lit: st.tiers.reduce((a, t) => a + t.n, 0) } : null;
  if (st) for (const t of st.tiers) for (let i = 0; i < t.dirs.length; i += Math.ceil(t.dirs.length / 8)) {
    const d = t.dirs[i], a = probe(d), b = SK.skyRadianceJS(d).map((v, k) => v + SK.skyMoonJS(d)[k]);
    errs.push(Math.abs(Math.max(...a.map((v, k) => v - b[k])) - Math.round(t.mag * 255) / 255));
  }
  out.stars && (out.stars.err = Math.max(...errs), out.stars.n = errs.length);
  // a night FORCED on a day arena is graded darker by the shared light (shared.js setBuiltLight / NIGHT_LIGHT, another
  // worker's code): the zenith target is then the measured background put through that same grade
  const LS = window.__built.shared, zt = lin(B.info.sky.targets.zenith);
  if (LS.light?.skyGraded) {
    const g = LS.NIGHT_LIGHT, l = 0.2126 * zt[0] + 0.7152 * zt[1] + 0.0722 * zt[2];
    for (let k = 0; k < 3; k++) zt[k] = (l + (zt[k] - l) * g.SKY_SAT) * g.SKY_GAIN[k];
  }
  out.zenithGraded = !!LS.light?.skyGraded;
  // graded: the grade also scales the halo by a luma ratio, so the GPU is held to the twin of the graded stops
  // (exact), and the distance to the graded background is printed
  out.zenithToGradedBg = d8(probe([0, 1, 0]), zt);
  out.zenith = out.zenithGraded ? d8(probe([0, 1, 0]), SK.skyDomeJS([0, 1, 0])) : out.zenithToGradedBg;
  out.horizonTwin = d8(probe([1, 0, 0]), SK.skyDomeJS([1, 0, 0]));
  out.glowScale = B.info.sky.glowScale;
  SU.uCloudAmt.value = keep;
  // back to auto: the measurement says day again, no night light left
  out.auto = window.__layers.setSkyMode("auto");
  out.cloudsAuto = cloudState();
  out.autoLeft = { moon: SU.uMoonAmt.value, stars: SU.uStarAmt.value, map: !!SK.current.stars, domes: B.scene.children.filter((o) => o.name === "builtSky").length };
  SU.uCloudAmt.value = 0;
  // same reach rule as the day check: only the channels whose measured background is not darker than the sun's glow
  {
    const zt2 = lin(B.info.sky.targets.zenith), zg = probe([0, 1, 0]), zglow = SK.skySunGlowJS([0, 1, 0]);
    out.autoZenithReach = [0, 1, 2].filter((k) => zglow[k] <= zt2[k]).length;
    out.autoZenith = Math.max(0, ...[0, 1, 2].filter((k) => zglow[k] <= zt2[k]).map((k) => Math.abs(s8(zg[k]) - s8(zt2[k]))));
  }
  SU.uCloudAmt.value = keep;
  B.render(window.__r.getCameraInfo().render);
  out.failedAfter = rr.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
  rt.dispose();
  return out;
});

// ---------------- night: a fresh page, the same recipe with a night measurement ----------------
// The night ring colours are CHOSEN (no night arena has been through tools/arena_built_recipe.py on this box yet):
// a dark blue night sky with a brighter horizon. Everything the night branch decides is measured against them.
const NIGHT_BG = [9, 11, 26];
const NIGHT_SKY = { all: [26, 30, 58], p10: [18, 21, 44], p90: [58, 64, 104], green: [22, 26, 60], other: [27, 31, 58],
                    top: [16, 19, 40], bottom: [34, 39, 70] };
const NIGHT_HAZE = { all: [22, 25, 48], p10: [22, 25, 48], p90: [22, 25, 48], green: null, other: [22, 25, 48],
                     top: [22, 25, 48], bottom: [22, 25, 48] };
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 60000 }).catch(() => {});

const NT = await page.evaluate(async ({ NIGHT_BG, NIGHT_SKY, NIGHT_HAZE, ARENA }) => {
  const THREE = await import("./lib3d/three.module.js");
  const SK = await import("./built/sky.js");
  const S = await import("./built/shared.js");
  const rec = await (await fetch(`assets-hd/battle/built/${ARENA}.json`, { cache: "no-store" })).json();
  const out = {};

  // 6. the mode is read from the MEASUREMENT: 8 recolourings of the ring's median colour, the luma test must decide
  //    every one of them and the run must flip exactly once
  const dayRing = rec.pieces.find((p) => p.kind === "sky").colours.all;
  out.classify = [];
  for (const k of [0.15, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1.0]) {
    const r2 = JSON.parse(JSON.stringify(rec));
    r2.pieces.find((p) => p.kind === "sky").colours.all = dayRing.map((v) => Math.round(v * k));
    const m = SK.skyMode(r2);
    out.classify.push({ k, ring: r2.pieces.find((p) => p.kind === "sky").colours.all, luma: +m.luma.toFixed(4), mode: m.mode });
  }
  out.dayMode = SK.skyMode(rec);

  // 7. build the night sky in its own renderer (a day sky in this page is not touched again)
  const night = JSON.parse(JSON.stringify(rec));
  night.bg = NIGHT_BG;
  for (const p of night.pieces) {
    if (p.kind === "sky") p.colours = NIGHT_SKY;
    if (p.kind === "haze") p.colours = NIGHT_HAZE;
  }
  const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
  const rr = new THREE.WebGLRenderer({ canvas, antialias: false });
  rr.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 640 / 360, 1, 60000);
  cam.position.copy(window.__built.camera.position); cam.updateMatrixWorld();
  const t0 = performance.now();
  const sky = SK.createBuiltSky(scene, night, S.makePalette(night), () => 1);
  out.nightClouds = sky.info.clouds && { banks: sky.info.clouds.banks, light: sky.info.clouds.light };
  if (sky.clouds) sky.clouds.mesh.visible = false;   // the dome checks below read the dome alone (the clouds: section 3c)
  const buildMs = performance.now() - t0;
  out.build = { ms: +buildMs.toFixed(0), mode: sky.info.mode, tris: sky.info.triangles };

  const H = 360, fov = 45;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  const pfov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) / H) * 180 / Math.PI;
  const pc = new THREE.PerspectiveCamera(pfov, 1, 1, cam.far);
  const px = new Float32Array(4);
  const probe = (d) => {
    pc.position.copy(cam.position);
    pc.up.set(0, 1, 0); if (Math.abs(d[1]) > 0.999) pc.up.set(0, 0, 1);
    pc.lookAt(pc.position.x + d[0], pc.position.y + d[1], pc.position.z + d[2]); pc.updateMatrixWorld();
    rr.setRenderTarget(rt); rr.render(scene, pc); rr.readRenderTargetPixels(rt, 0, 0, 1, 1, px); rr.setRenderTarget(null);
    return [px[0], px[1], px[2]];
  };
  const s8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const d8 = (a, b) => Math.max(...a.map((v, u) => Math.abs(s8(v) - s8(b[u]))));
  const norm = (v) => { const L = Math.hypot(...v); return v.map((x) => x / L); };
  const SU = SK.SKY_U, sd = S.U.uSunDir.value, sun = [sd.x, sd.y, sd.z];
  const moon = SU.uMoonDir.value.toArray(), R0 = SU.uMoonRadius.value;
  // clouds OFF for the disc, star, twin and colour checks (as by day): the twins have no clouds; back on for step 12
  const keepAmt = SU.uCloudAmt.value;
  SU.uCloudAmt.value = 0;

  // 8. the moon stands against the light: same elevation, azimuth exactly opposite
  const hz = (v) => { const L = Math.hypot(v[0], v[2]); return [v[0] / L, v[2] / L]; };
  const mh = hz(moon), sh = hz(sun);
  out.moonPlaced = { moon, sun, horizDot: mh[0] * sh[0] + mh[1] * sh[1], elevDiff: Math.abs(moon[1] - sun[1]),
                     elevDeg: +(Math.asin(moon[1]) * 180 / Math.PI).toFixed(2), radiusDeg: +(R0 * 180 / Math.PI).toFixed(3) };
  // 9. the disc, measured by a fan across it in two great circles (radiance without the disc subtracted out)
  const perpOf = (m) => norm([-m[2], 0, m[0]]);
  const side1 = perpOf(moon), side2 = norm([moon[1] * side1[2] - moon[2] * side1[1], moon[2] * side1[0] - moon[0] * side1[2], moon[0] * side1[1] - moon[1] * side1[0]]);
  const onCircle = (side, deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [moon[0] * c + side[0] * s, moon[1] * c + side[1] * s, moon[2] * c + side[2] * s]; };
  const discAt = (d) => Math.max(...probe(d).map((v, i) => v - SK.skyRadianceJS(d)[i]));
  const peak = discAt(moon);
  const fans = [];
  for (const side of [side1, side2]) for (const sign of [1, -1]) {
    const sd2 = side.map((v) => v * sign);
    const at = (deg) => discAt(onCircle(sd2, deg));
    const L0 = at(0.05);
    let hit = null, prevD = 0.05, prevL = L0;
    const profile = [];
    for (let deg = 0.15; deg <= 8; deg += 0.05) {
      const L = at(deg); profile.push(+L.toFixed(5));
      if (!hit && L < L0 * 0.5) hit = { deg: prevD + (deg - prevD) * (prevL - L0 * 0.5) / Math.max(prevL - L, 1e-9), edgeL: L };
      prevD = deg; prevL = L;
    }
    // hard edge: 1.3 x the radius carries no disc light at all
    const outside = at(R0 * 180 / Math.PI * 1.3);
    fans.push({ dir: sign > 0 ? "a" : "b", side: side === side1 ? 1 : 2, halfDeg: hit ? +hit.deg.toFixed(3) : null, outside: +outside.toFixed(5), p2: profile[2] });
  }
  out.moonDisc = { peak: +peak.toFixed(5), peakSrgb: +(255 * s8(peak)).toFixed(1), fans };
  const sunGap = probe(sun).map((v, i) => v - SK.skyRadianceJS(sun)[i]);
  out.moonAtSun = { gap: +Math.max(...sunGap).toFixed(5) };

  // 10. three star tiers by count and brightness
  const st = SK.current.stars;
  const noStars = (d) => { const a = SK.skyRadianceJS(d), b = SK.skyMoonJS(d); return a.map((v, i) => v + b[i]); };
  // a star's own light = GPU minus the star-free twin, in LINEAR (what is baked); the sRGB lift is printed too, but
  // it depends on what is behind the star (the moon's halo), so it cannot separate the tiers by itself
  const tierDelta = (d) => { const a = probe(d), b = noStars(d); return [Math.max(...a.map((v, i) => v - b[i])), Math.max(...a.map((v, i) => s8(v) - s8(b[i])))]; };
  out.stars = { size: [st.W, st.H], counts: st.tiers.map((t) => t.n), mags: st.tiers.map((t) => t.mag), lit: 0,
                tiers: [], minEl: 90, maxEl: -90 };
  let lit = 0; for (let i = 0; i < st.data.length; i += 4) if (st.data[i] || st.data[i + 1] || st.data[i + 2]) lit++;
  out.stars.lit = lit;
  for (const t of st.tiers) {
    const step = Math.max(1, Math.ceil(t.dirs.length / 24));
    const vals = [], svals = [];
    for (let i = 0; i < t.dirs.length; i += step) { const [l, sv] = tierDelta(t.dirs[i]); vals.push(l); svals.push(+sv.toFixed(1)); }
    out.stars.tiers.push({ n: t.n, dirs: t.dirs.length, samples: vals.length, baked: Math.round(t.mag * 255) / 255,
                           min: Math.min(...vals), max: Math.max(...vals), smin: Math.min(...svals), smax: Math.max(...svals) });
    for (const d of t.dirs) { const el = Math.asin(d[1]) * 180 / Math.PI; out.stars.minEl = Math.min(out.stars.minEl, el); out.stars.maxEl = Math.max(out.stars.maxEl, el); }
  }
  // star-free directions: no lift beyond the twin, and nothing below the horizon
  const free = [], below = [];
  for (let i = 0; i < 120; i++) {
    const y = 0.05 + 0.94 * ((i + 0.5) / 120), a = i * 2.39996, r = Math.sqrt(1 - y * y);
    const d = [Math.cos(a) * r, y, Math.sin(a) * r];
    if (SK.skyStarsJS(d).some((v) => v !== 0)) continue;
    free.push(+d8(probe(d), SK.skyDomeJS(d)).toFixed(2));
  }
  for (const el of [-2, -6, -12, -25, -45, -70]) { const t = el * Math.PI / 180; below.push(+d8(probe([Math.cos(t) * 0.7, Math.sin(t), Math.cos(t) * 0.7]), SK.skyDomeJS([Math.cos(t) * 0.7, Math.sin(t), Math.cos(t) * 0.7])).toFixed(2)); }
  out.stars.free = { n: free.length, max: Math.max(...free) };
  // the moon stands in front of the stars: no baked star where the disc has any light (skyMoon() > 0)
  let inDisc = 0, nearest = 180;
  for (const t of st.tiers) for (const d of t.dirs) {
    if (SK.skyMoonJS(d).some((v) => v > 0)) inDisc++;
    nearest = Math.min(nearest, Math.acos(Math.min(1, d[0] * moon[0] + d[1] * moon[1] + d[2] * moon[2])) * 180 / Math.PI);
  }
  out.stars.moon = { inDisc, nearestDeg: +nearest.toFixed(2), skipped: sky.info.night.stars.skippedMoon };
  out.glowScale = sky.info.glowScale;
  out.stars.below = { n: below.length, max: Math.max(...below) };

  // 11. night sky vs its own twin, and vs the night measurement at the horizon / zenith
  const dirs = [[0, 1, 0], sun, moon, [0, -1, 0]];
  for (let a = 1; a < 360; a += 45) dirs.push([Math.sin(a * Math.PI / 180), 0, Math.cos(a * Math.PI / 180)]);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 64; i++) { const y = 1 - 2 * (i + 0.5) / 64, r = Math.sqrt(1 - y * y); dirs.push([Math.cos(i * ga) * r, y, Math.sin(i * ga) * r]); }
  let tw = 0, twAt = null;
  for (const d of dirs) { const e = d8(probe(d), SK.skyDomeJS(d)); if (e > tw) { tw = e; twAt = d.map((v) => +v.toFixed(3)); } }
  out.twin = { n: dirs.length, worst: tw, worstAt: twAt };
  const T = sky.info.targets, lin = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const perp = norm([-sd.z, 0, sd.x]);
  out.horizon = { at90: d8(probe(perp), lin(T.horizon)), target: T.horizon };
  out.zenith = { d: d8(probe([0, 1, 0]), lin(T.zenith)), target: T.zenith };

  // 12. the night sky obeys the same measured ring heights (clouds only inside the band)
  SU.uCloudAmt.value = keepAmt;
  const [y0, y1] = sky.info.band, eye = SU.uRingEye.value;
  const band = { dirs: 0, cloudy: 0, outside: 0, worstOut: null, elev: [90, -90], ringElev: [90, -90] };
  for (let az = 1; az < 360; az += 10) for (let el = -7.5; el <= 50; el += 1) {
    const ce = Math.cos(el * Math.PI / 180), d = [Math.sin(az * Math.PI / 180) * ce, Math.sin(el * Math.PI / 180), Math.cos(az * Math.PI / 180) * ce];
    const hy = SK.ringHitYJS(d, eye), inBand = hy >= y0 && hy <= y1;
    const cl = d8(probe(d), SK.skyDomeJS(d)) > 1.5;
    band.dirs++;
    if (inBand) { band.ringElev[0] = Math.min(band.ringElev[0], el); band.ringElev[1] = Math.max(band.ringElev[1], el); }
    if (!cl) continue;
    band.cloudy++; band.elev[0] = Math.min(band.elev[0], el); band.elev[1] = Math.max(band.elev[1], el);
    if (!inBand) { band.outside++; band.worstOut ||= { az, el, hy: Math.round(hy) }; }
  }
  out.band = band;
  SU.uCloudAmt.value = 0;   // the haze is compared with the cloud-free dome

  // 13. the night haze: aerial() at f -> 1 must equal the night dome's own pixel, away from the disc and the stars
  const aerialProbe = (samples) => {
    const n = samples.length;
    const art = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const buf = new Float32Array(n * 4);
    const pos = new Float32Array(n * 18), adir = new Float32Array(n * 18), adist = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x0 = -1 + 2 * i / n, x1 = -1 + 2 * (i + 1) / n, quad = [[x0, -1], [x1, -1], [x1, 1], [x0, -1], [x1, 1], [x0, 1]];
      for (let v = 0; v < 6; v++) {
        const o = i * 6 + v;
        pos[o * 3] = quad[v][0]; pos[o * 3 + 1] = quad[v][1]; pos[o * 3 + 2] = 0;
        adir[o * 3] = samples[i].d[0]; adir[o * 3 + 1] = samples[i].d[1]; adir[o * 3 + 2] = samples[i].d[2];
        adist[o] = samples[i].dist;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(adir, 3));
    g.setAttribute("aDist", new THREE.BufferAttribute(adist, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: S.uniformsWith(),
      vertexShader: /* glsl */`attribute vec3 aDir; attribute float aDist; varying vec3 vW;
        void main() { vW = cameraPosition + aDir * aDist; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`varying vec3 vW;
        ${S.NOISE_GLSL}
        ${S.LIGHT_GLSL}
        void main() { gl_FragColor = vec4(aerial(vec3(0.0), vW), 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    const sc = new THREE.Scene(), qm = new THREE.Mesh(g, m); qm.frustumCulled = false; sc.add(qm);   // clip-space quad: never cull it
    const c2 = new THREE.PerspectiveCamera(45, 1, 1, 100); c2.position.copy(cam.position); c2.updateMatrixWorld();
    const cc = new THREE.Color(), ca = rr.getClearAlpha(); rr.getClearColor(cc);
    rr.setRenderTarget(art); rr.setClearColor(0x000000, 0); rr.clear(); rr.render(sc, c2);
    rr.readRenderTargetPixels(art, 0, 0, n, 1, buf); rr.setRenderTarget(null); rr.setClearColor(cc, ca);
    art.dispose(); m.dispose(); g.dispose();
    return Array.from({ length: n }, (_, i) => [buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]]);
  };
  // directions clear of the moon disc and of every star (the haze reads the radiance, not the sky's decorations)
  const nearMoon = (d) => Math.acos(Math.min(1, Math.max(-1, d[0] * moon[0] + d[1] * moon[1] + d[2] * moon[2]))) < R0 * 4;
  const hd = [];
  for (const el of [5, 12, 22, 35, 50, 65, 80, 88]) for (let az = 0; az < 360; az += 30) {
    const ce = Math.cos(el * Math.PI / 180);
    const d = [Math.sin(az * Math.PI / 180) * ce, Math.sin(el * Math.PI / 180), Math.cos(az * Math.PI / 180) * ce];
    if (nearMoon(d) || SK.skyStarsJS(d).some((v) => v !== 0)) continue;
    hd.push(d);
  }
  // f -> 1: the haze is the sky there, so it must equal the dome's own pixel
  const far = aerialProbe(hd.map((d) => ({ d, dist: 2000000 })));
  let aw = 0, awAt = null;
  for (let i = 0; i < hd.length; i++) { const e = d8(far[i], probe(hd[i])); if (e > aw) { aw = e; awAt = { el: Math.round(Math.asin(hd[i][1]) * 180 / Math.PI) }; } }
  // and at ordinary distances it must still be the sky's own radiance (JS twin) times the same f
  const mix = aerialProbe(hd.map((d) => ({ d, dist: 3000 })));
  let mw = 0; for (let i = 0; i < hd.length; i++) mw = Math.max(mw, d8(mix[i], SK.skyRadianceJS(hd[i]).map((v) => v * (1 - Math.exp(-3000 * S.U.uAerialK.value)))));
  out.haze = { n: hd.length, far: aw, farAt: awAt, mid: mw };

  // 14. the hard-edge measure discriminates: the DAY recipe's dome with the OLD noise decks back on (opts.decks) shows
  //     the cut at the ring top as a big neighbour-row jump; the same dome with them off (the default) does not.
  //     Measured on the dome alone (no 3D clouds), every column, rows above the horizon, 12 headings.
  const rowJump = (decks) => {
    const sc2 = new THREE.Scene();
    SK.createBuiltSky(sc2, rec, S.makePalette(rec), () => 1, { decks, clouds: false });
    const W3 = 320, H3 = 240, c3 = new THREE.PerspectiveCamera(46, W3 / H3, 1, 60000);
    const t3 = new THREE.WebGLRenderTarget(W3, H3, { type: THREE.FloatType, format: THREE.RGBAFormat }), b3 = new Float32Array(W3 * H3 * 4);
    let worst = 0;
    for (let h = 0; h < 360; h += 30) {
      const a = h * Math.PI / 180; c3.position.copy(cam.position);
      c3.lookAt(c3.position.x + Math.sin(a), c3.position.y + Math.tan(10 * Math.PI / 180), c3.position.z + Math.cos(a)); c3.updateMatrixWorld();
      rr.setRenderTarget(t3); rr.render(sc2, c3); rr.readRenderTargetPixels(t3, 0, 0, W3, H3, b3); rr.setRenderTarget(null);
      for (let px = 0; px < W3; px++) for (let py = H3 / 2; py < H3 - 1; py++) {
        const k = (py * W3 + px) * 4, k2 = k + W3 * 4;
        worst = Math.max(worst, ...[0, 1, 2].map((ch) => Math.abs(s8(b3[k + ch]) - s8(b3[k2 + ch]))));
      }
    }
    t3.dispose();
    return worst;
  };
  out.edgeOld = rowJump(true); out.edgeNew = rowJump(false);
  return out;
}, { NIGHT_BG, NIGHT_SKY, NIGHT_HAZE, ARENA });

await browser.close().catch(() => {});

let skips = 0;
const skip = (msg) => { skips++; console.log(`SKIP ${msg}`); };
const I = R.info;
console.log(`     (info) ring profile ${JSON.stringify(I.ring)}, band y ${I.band.join("-")}, world scale ${R.worldScale}, eye ${R.eye} (ring frame ${R.ringEye}), view H ${R.view.H} fov ${R.view.fov}, calibration residual ${I.calibResidual.toExponential(2)} (linear), build ${I.ms} ms, mode ${I.mode} (ring luma ${I.night.ringLuma} vs ${I.night.threshold})`);
check(R.tris === 12 && R.sameModule, `sky dome is ${R.tris} triangles (12)`);
check(R.follow.frames > 10 && R.follow.max < 1e-6 && R.eye.every((v, k) => v === R.domeAt[k]), `dome centre = eye: ${R.follow.frames} viewer frames, max |centre - eye| ${R.follow.max.toExponential(2)}; forced frame dome ${R.domeAt} eye ${R.eye}`);
check(R.cover.gaps.every((g) => g === 0), `dome covers every pixel (${R.cover.W}x${R.cover.H}, view / box edge / box corner / lower corner): uncovered ${R.cover.gaps.join(" / ")}`);
check(R.twin.worst <= 2, `JS twin vs GPU (1x1 float target), clouds off, ${R.twin.n} directions: max ${R.twin.worst.toFixed(3)}/255 sRGB (<= 2) at ${R.twin.worstAt}`);
const b = R.band;
check(!I.decks && b.cloudy === 0 && b.outside === 0, `the old flat noise decks are OFF by default: the dome alone differs from the cloud-free twin in ${b.cloudy}/${b.dirs} grid directions (0); ring band seen ${b.ringElev.join("..")} deg from the eye`);
const CL = R.clouds;
console.log(`     (info) 3D clouds: ${CL.info.banks} banks, ${CL.info.lobes} lobes, ${CL.info.triangles} triangles, ${CL.info.vertices} vertices; tones sRGB lit ${CL.info.tones.lit} shade ${CL.info.tones.shade} deep ${CL.info.tones.deep}; light ${CL.info.light}`);
check(CL.meshes === 1 && CL.info.banks >= 8 && CL.info.lobes >= CL.info.banks * 20 && CL.drawCalls === 1, `cloud count: ${CL.info.banks} banks of ${CL.info.lobes} lobes in ${CL.meshes} mesh, ${CL.drawCalls} draw call(s) alone`);
check(CL.verts.outside === 0 && CL.verts.eyes >= 40, `every cloud vertex inside the ring's measured band ${I.band.join("-")} seen from ${CL.verts.eyes} eyes (the viewer's + the keep-out sweep ${JSON.stringify(CL.verts.rings)}): ${CL.verts.tested} vertex rays, ${CL.verts.outside} outside; ring height hit ${CL.verts.hy.map(Math.round).join("..")} (band share ${CL.verts.f.map((v) => v.toFixed(3)).join("..")})`);
console.log(`     (info) what the clouds must stand behind: ${CL.trees.meshes} tree/bush mesh(es) with crowns out to r ${Math.round(CL.trees.r)}, the arena's own floor ${CL.trees.floorN} mesh(es) out to r ${CL.trees.floorR}; nearest cloud vertex r ${Math.round(CL.verts.minR)}`);
if (CL.trees.meshes > 0) check(CL.verts.minR > Math.max(CL.trees.r, CL.trees.floorR), `clouds beyond the trees: nearest cloud vertex r ${Math.round(CL.verts.minR)} from the centre vs farthest tree/bush crown edge r ${Math.round(CL.trees.r)} (and the hills' outer ribbon 9050); cloud y ${CL.verts.y.map(Math.round).join("..")}`);
else check(CL.verts.minR > CL.trees.floorR, `clouds beyond this arena's own floor (it has no trees: ${CL.trees.meshes} foliage meshes): nearest cloud vertex r ${Math.round(CL.verts.minR)} from the centre vs the floor's own edge r ${CL.trees.floorR} (${CL.trees.floorN} grass/sand/shore meshes) and 0 tree/bush crowns; cloud y ${CL.verts.y.map(Math.round).join("..")}`);
check(CL.mask.pixels > 1000 && CL.mask.above === 0 && CL.mask.below === 0, `no cloud above the band (GPU pixels): ${CL.mask.views} views ${CL.mask.W}x${CL.mask.H}, ${CL.mask.pixels} cloud pixels, ${CL.mask.above} above the ring top, ${CL.mask.below} below its foot; highest cloud pixel ${CL.mask.maxEl.toFixed(2)} deg vs ring top ${CL.mask.ringTopEl.toFixed(2)} deg in that column`);
check(CL.edge.worst <= 2 && CL.edge.cols > 100, `no hard edge above the clouds: largest sky change between neighbouring rows over ${CL.edge.cols} columns x ${CL.edge.views} views ${CL.edge.worst.toFixed(2)}/255 (<= 2) at ${JSON.stringify(CL.edge.at)}`);
check(CL.tone.maxLuma - CL.tone.minLuma > 20 && CL.tone.litErr <= 12 && CL.tone.darkBlue, `toon tones: brightest cloud pixel ${CL.tone.max} vs lit tone ${CL.info.tones.lit} (diff ${CL.tone.litErr.toFixed(1)}, <= 12), darkest ${CL.tone.min} (lilac: blue largest ${CL.tone.darkBlue}), luma span ${(CL.tone.maxLuma - CL.tone.minLuma).toFixed(1)}`);
console.log(`     (info) frame time over ${CL.frame.frames} frames: clouds shown ${CL.frame.shown.toFixed(3)} ms, hidden ${CL.frame.hidden.toFixed(3)} ms, clouds ${(CL.frame.shown - CL.frame.hidden).toFixed(3)} ms (budget 1 ms)`);
check(CL.frame.shown - CL.frame.hidden <= 1, `clouds cost ${(CL.frame.shown - CL.frame.hidden).toFixed(3)} ms per frame (<= 1)`);
check(R.horizon.at90 <= 2, `horizon (y 0, 90 deg from the sun) vs recipe ring-bottom colour ${R.horizon.target}: GPU ${R.horizon.gpu}, delta ${R.horizon.at90.toFixed(2)}/255; round the circle every 30 deg: ${R.horizon.round.join(" ")} (the sun side carries the warm band)`);
if (!R.zenith.limited) check(R.zenith.d <= 2, `zenith vs recipe background ${R.zenith.target}: delta ${R.zenith.d.toFixed(2)}/255`);
else check(R.zenith.dReach <= 2, `zenith vs recipe background ${R.zenith.target}: delta ${R.zenith.dReach.toFixed(2)}/255 in the ${R.zenith.per.filter((q) => q.reach).length} channel${R.zenith.per.filter((q) => q.reach).length === 1 ? "" : "s"} the dome can reach; the other${R.zenith.per.filter((q) => !q.reach).length === 1 ? "" : "s"} ` +
  `${R.zenith.per.filter((q) => !q.reach).map((q) => `${["red", "green", "blue"][q.k]} ${q.target.toFixed(4)} linear`).join(", ")} ${R.zenith.per.filter((q) => !q.reach).length === 1 ? "is" : "are"} darker than the sun's own glow at the zenith ` +
  `(${R.zenith.per.filter((q) => !q.reach).map((q) => q.glow.toFixed(4)).join(", ")} linear), and calibrate() scales the stops and never below 0, so no stop can be that dark (GPU there ${R.zenith.per.filter((q) => !q.reach).map((q) => q.got.toFixed(4)).join(", ")})`);
console.log(`     (info) below the horizon (y -0.3, away from the sun) vs ${R.below.src} ${R.below.target}: delta ${R.below.d.toFixed(2)}/255`);
check(R.nightOff.mode === "day" && R.nightOff.moonAmt === 0 && R.nightOff.starAmt === 0 && !R.nightOff.stars, `this arena is DAY from its own measured ring (luma ${I.night.ringLuma} >= ${I.night.threshold}) and the day dome adds no night light: moon ${R.nightOff.moonAmt}, stars ${R.nightOff.starAmt}, star map ${R.nightOff.stars ? "baked" : "none"}`);
const HZ = R.haze;
check(HZ.worst <= 2, `HAZE = the sky's own radiance: aerial() (the materials' own shader: aerial(black, eye + dir*dist)) vs skyRadiance(dir) * (1 - exp(-k d)) over ${HZ.dirs} directions x ${HZ.dists.length} distances (${HZ.n} samples): max ${HZ.worst.toFixed(2)}/255 (<= 2) at ${JSON.stringify(HZ.at)}`);
check(HZ.old > 3, `that check discriminates: the OLD flat mix(uSkyHorizon, uSkyZenith, smoothstep) differs from skyRadiance by up to ${HZ.old.toFixed(1)}/255 at the same directions (> 3)`);
check(HZ.asym <= 2, `haze = sky away from the horizon too: at f = 0.99998 the haze's own pixel equals the DOME's pixel (clouds off) over ${HZ.dirs} directions 5..85 deg: max ${HZ.asym.toFixed(2)}/255 at ${JSON.stringify(HZ.asymAt)}`);
check(R.programs.failed === 0, `shader programs compile: ${R.programs.count}, ${R.programs.failed} failed`);
const fr = R.frame;
console.log(`     (info) frame time over ${fr.frames} frames: sky shown ${fr.shown.toFixed(2)} ms, hidden ${fr.hidden.toFixed(2)} ms, sky ${(fr.shown - fr.hidden).toFixed(2)} ms (${fr.renderer})`);

// ---------------- sky time switch report ----------------
check(FX.night?.mode === "night" && FX.night.forced && FX.night.measured === "day" && FX.rebuilt.domes === 1 && FX.rebuilt.replaced && FX.rebuilt.same && FX.failed === 0,
  `sky time = night FORCED on ${ARENA} (measured ${FX.night?.measured}): mode ${FX.night?.mode}, only the sky rebuilt (${FX.rebuilt.domes} dome, new mesh ${FX.rebuilt.replaced}, viewer refs updated ${FX.rebuilt.same}), ${FX.failed} programs failed`);
check(FX.moon.amt === 1 && FX.moon.clear && FX.moon.lift > 0.5, `forced night: the moon stands clear of the clouds (${FX.moon.elev} deg up, its ray meets the ring at y ${FX.moon.hitY}, band ${FX.moon.band.join("-")}), GPU disc lift ${FX.moon.lift.toFixed(3)} linear`);
check(FX.stars && FX.stars.lit === 948 && FX.stars.err <= 1e-3 && FX.zenith <= 2 && FX.horizonTwin <= 2,
  `forced night: ${FX.stars?.lit} stars, ${FX.stars?.n} sampled GPU lift = bake (max error ${FX.stars?.err?.toExponential(1)}), zenith ${FX.zenithGraded ? `vs the twin of the night-graded stops (shared.js grade) ${FX.zenith.toFixed(2)}/255 (graded background ${FX.zenithToGradedBg.toFixed(2)}/255)` : `vs measured background ${FX.zenith.toFixed(2)}/255`}, horizon vs night twin ${FX.horizonTwin.toFixed(2)}/255; halo scale ${FX.glowScale}`);
check(FX.auto?.mode === "day" && !FX.auto.forced && FX.autoLeft.moon === 0 && FX.autoLeft.stars === 0 && !FX.autoLeft.map && FX.autoLeft.domes === 1 && FX.autoZenith <= 2 && FX.failedAfter === 0,
  `sky time back to auto: mode ${FX.auto?.mode} from the measurement, moon ${FX.autoLeft.moon}, stars ${FX.autoLeft.stars}, star map ${FX.autoLeft.map ? "kept" : "freed"}, zenith ${FX.autoZenith.toFixed(2)}/255` +
  `${FX.autoZenithReach < 3 ? ` (${FX.autoZenithReach} channel${FX.autoZenithReach === 1 ? "" : "s"} checked: the measured background is darker than the sun's glow in the rest)` : ""}, ${FX.failedAfter} programs failed`);

check(FX.clouds.meshes === 1 && FX.clouds.mode === "night" && FX.clouds.sharedRef && FX.clouds.toMoon > 0.9999,
  `forced night: ${FX.clouds.meshes} cloud mesh on the SHARED light (same uniform refs ${FX.clouds.sharedRef}), lit by the MOON (light dir . moon ${FX.clouds.toMoon.toFixed(5)}, . sun ${FX.clouds.toSun.toFixed(3)}), key ${FX.clouds.key}`);
check(FX.cloudsAuto.meshes === 1 && FX.cloudsAuto.mode === "day" && FX.cloudsAuto.sharedRef && FX.cloudsAuto.toSun > 0.9999,
  `back to auto: ${FX.cloudsAuto.meshes} cloud mesh, lit by the SUN (light dir . sun ${FX.cloudsAuto.toSun.toFixed(5)}), key ${FX.cloudsAuto.key}`);

// ---------------- night report ----------------
const C = NT.classify, t3 = NT.stars.tiers;
console.log(`     (info) night recipe: sky ring ${JSON.stringify(NIGHT_SKY.all)} — CHOSEN (no night arena measured on this box yet); moon at ${NT.moonPlaced.elevDeg} deg, ${NT.moonPlaced.radiusDeg} deg radius; ${NT.stars.size[0]}x${NT.stars.size[1]} star map, ${NT.stars.lit} lit texels, ${NT.build.ms} ms to build`);
check(NT.build.mode === "night" && NT.build.tris === 12, `the night recipe builds a NIGHT dome of ${NT.build.tris} triangles (mode ${NT.build.mode})`);
const flip = C.findIndex((c) => c.mode === "day");
check(C.every((c) => c.mode === (c.luma < I.night.threshold ? "night" : "day")) && flip > 0 && C.slice(flip).every((c) => c.mode === "day"),
  `day or night comes from the measured ring colour alone, not the pack name: 8 recolourings of the ring's median, mode = (luma < ${I.night.threshold}): ${C.map((c) => `${c.ring.join(",")}@${c.luma}=${c.mode}`).join(" ")}`);
check(NT.dayMode.mode === "day" && C[C.length - 1].mode === "day" && C[0].mode === "night", `the measured arena is day (luma ${+NT.dayMode.luma.toFixed(3)}) and a dark ring of the same recipe is night (luma ${C[0].luma})`);
const MP = NT.moonPlaced;
check(MP.moon[1] > 0 && MP.horizDot < -0.9999 && MP.elevDiff < 1e-3, `the moon stands AGAINST the light: azimuth dot(moon, -sun) horizontal = ${(-MP.horizDot).toFixed(6)}, same elevation (|dy| ${MP.elevDiff.toExponential(1)}), ${MP.elevDeg} deg up; moon ${JSON.stringify(MP.moon.map((v) => +v.toFixed(3)))}`);
const half = NT.moonDisc.fans.map((f) => f.halfDeg);
check(half.every((h) => h != null && Math.abs(h - MP.radiusDeg) <= 0.3),
  `moon disc measured across it (4 half-fans, half-brightness angle): ${half.join(" / ")} deg vs the ${MP.radiusDeg} deg radius (<= 0.3); peak lift ${NT.moonDisc.peakSrgb}/255`);
check(NT.moonDisc.fans.every((f) => f.outside < 0.02 * NT.moonDisc.peak), `the disc has a hard edge: at 1.3 x the radius no disc light (max ${Math.max(...NT.moonDisc.fans.map((f) => f.outside)).toFixed(5)} linear vs peak ${NT.moonDisc.peak.toFixed(3)}); no disc on the light's side (max lift at the sun ${NT.moonAtSun.gap.toFixed(4)} linear)`);
check(NT.stars.counts[0] > NT.stars.counts[1] && NT.stars.counts[1] > NT.stars.counts[2] && NT.stars.counts[2] > 0 && NT.stars.mags[0] < NT.stars.mags[1] && NT.stars.mags[1] < NT.stars.mags[2],
  `three star tiers: counts ${NT.stars.counts.join(" / ")} (strictly fewer), brightness ${NT.stars.mags.join(" / ")} linear (strictly brighter), ${NT.stars.lit} lit texels = ${NT.stars.counts.reduce((a, n) => a + n, 0)}`);
check(t3.every((t) => t.n === t.dirs) && t3.every((t) => Math.abs(t.min - t.baked) <= 1e-3 && Math.abs(t.max - t.baked) <= 1e-3) && t3[0].max < t3[1].min - 0.1 && t3[1].max < t3[2].min - 0.1,
  `star tiers by measured GPU lift over the star-free twin (linear, ${t3.map((t) => t.samples).join("/")} sampled per tier): ${t3.map((t, i) => `tier${i} ${t.min.toFixed(4)}..${t.max.toFixed(4)} (baked ${t.baked.toFixed(4)})`).join(", ")} — each = its bake (<= 1e-3), bands disjoint and ordered (> 0.1 apart)`);
console.log(`     (info) the same stars in sRGB 0-255 lift (depends on the sky behind them): ${t3.map((t, i) => `tier${i} ${t.smin}..${t.smax}`).join(", ")}`);
check(NT.stars.moon.inDisc === 0, `no star behind the moon disc: ${NT.stars.moon.inDisc} baked stars where skyMoon() > 0; nearest star ${NT.stars.moon.nearestDeg} deg from the moon's centre (disc ${MP.radiusDeg} deg); ${NT.stars.moon.skipped} draws skipped there in the bake`);
console.log(`     (info) night halo scale ${NT.glowScale.toFixed(4)} (1 = the picked glow fits under GLOW_MAX_SHARE of the measured colour)`);
check(NT.stars.free.n > 20 && NT.stars.free.max <= 2 && NT.stars.below.max <= 2,
  `stars only where they are baked: ${NT.stars.free.n} star-free directions show <= ${NT.stars.free.max}/255 lift, ${NT.stars.below.n} directions below the horizon <= ${NT.stars.below.max}/255; every star sits ${NT.stars.minEl.toFixed(1)}..${NT.stars.maxEl.toFixed(1)} deg up`);
check(NT.twin.worst <= 2, `night twin (skyDomeJS = radiance + moon disc + stars) vs GPU, clouds off, ${NT.twin.n} directions: max ${NT.twin.worst.toFixed(3)}/255 at ${NT.twin.worstAt}`);
check(NT.horizon.at90 <= 2 && NT.zenith.d <= 2, `night sky keeps the measurement: horizon (90 deg from the moon's light) vs ring bottom ${NT.horizon.target} delta ${NT.horizon.at90.toFixed(2)}/255; zenith vs background ${NT.zenith.target} delta ${NT.zenith.d.toFixed(2)}/255`);
const nb = NT.band;
check(nb.cloudy === 0 && nb.outside === 0, `the night dome carries no flat noise clouds either (decks off): ${nb.cloudy}/${nb.dirs} directions differ from the night twin`);
check(NT.edgeOld > 2 && NT.edgeNew <= 2, `the hard-edge measure discriminates: the dome with the OLD decks on jumps ${NT.edgeOld.toFixed(1)}/255 between neighbouring rows (> 2: the cut), with them off ${NT.edgeNew.toFixed(2)}/255 (<= 2)`);
check(NT.haze.n > 20 && NT.haze.far <= 2 && NT.haze.mid <= 2, `night haze = night sky: aerial() at f -> 1 equals the dome's own pixel over ${NT.haze.n} directions clear of the disc and the stars, max ${NT.haze.far.toFixed(2)}/255; at 3000 units vs skyRadiance * f, max ${NT.haze.mid.toFixed(2)}/255`);

for (const e of errors) console.log("   error:", e);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails);
