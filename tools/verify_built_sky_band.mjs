// Numbers check of the BUILT sky in BAND MODE (web/built/sky.js + shared.js skyBand(); meft1008: a painted sky band
// standing on a treeline band, sky piece ymin > 0). No pictures: pixel VALUES are read back from float render targets
// and compared with numbers; the measured colours are read as texel numbers from the arena's own band texture
// (geometry.json group page "wall" with the sky piece's clut, the texel rect its uv spans) at page load, so no
// disc-derived number is stored in this file.
//  - band mode is on (uBandMix 1) only because the sky piece floats (ymin > 0), the 3D cumulus banks are not built
//  - DAY (measured ring luma), no night light
//  - JS twin (skyRadianceJS) vs GPU dome, band clouds off, at many directions from the fight eye: <= 2/255
//  - every texel row of the band picture vs the dome at the same ring height (from the fight eye, 8 azimuths):
//    per-row max error and median (the picture is stepped in 8/255 palette steps; the dome is a smooth ramp)
//  - the sky painted into the pine band's top (wall_00, above the trees) vs the dome there (below the band)
//  - every ray that meets the ring below its foot (y < 0) shows the background (= the lake) colour exactly
//  - no hard line: largest step between neighbouring screen rows (960x720, fight camera) in the band, at its top
//  - band clouds on: they change the dome ONLY where the ray meets the ring inside the band; size of the change
//  - cost at 960x720 (fight camera): dome triangles + draw calls, frame time sky shown/hidden, clouds on/off
//   VERIFY_PORT=8090 [ARENA=meft1008] [FRAMES=300] tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_sky_band.mjs
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const FRAMES = +(process.env.FRAMES || 300);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const R = await page.evaluate(async ({ ARENA, FRAMES }) => {
  const THREE = await import("./lib3d/three.module.js");
  const SK = await import("./built/sky.js");
  const B = window.__built, rr = B.renderer, out = {};
  const sky = B.scene.getObjectByName("builtSky"), SU = SK.SKY_U, I = B.info.sky;
  out.info = { mode: I.mode, band: I.band, bandMode: I.bandMode, residual: I.calibResidual, tris: I.triangles };
  out.bandMix = SU.uBandMix.value; out.banks = !!B.scene.getObjectByName("builtClouds");
  out.night = { moon: SU.uMoonAmt.value, stars: SU.uStarAmt.value, starTex: !!SU.uStarTex.value };

  // ---- the measured band picture, as texel numbers ----
  const base = `./assets/battle/arenas/${ARENA}`;
  const geo = await (await fetch(`${base}/geometry.json`)).json();
  const rec = await (await fetch(`./assets-hd/battle/built/${ARENA}.json`)).json();
  const skyPiece = rec.pieces.find((p) => p.kind === "sky");
  const tex = async (file) => {
    const img = new Image(); img.src = `${base}/${file}`; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, img.width, img.height);
  };
  const M = 0.35;   // render = pack (x,-y,-z) * 0.35
  // the sky group: the wall group whose vertices span the sky piece's measured heights
  const groupY = (g) => { let lo = 1e9, hi = -1e9; for (let i = 1; i < g.pos.length; i += 3) { const y = -g.pos[i] * M; lo = Math.min(lo, y); hi = Math.max(hi, y); } return [lo, hi]; };
  const rowsOf = async (g) => {
    const [ylo, yhi] = groupY(g);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < g.uv.length; i += 2) { u0 = Math.min(u0, g.uv[i] * 256); u1 = Math.max(u1, g.uv[i] * 256); v0 = Math.min(v0, g.uv[i + 1] * 256); v1 = Math.max(v1, g.uv[i + 1] * 256); }
    u0 = Math.round(u0); u1 = Math.round(u1); v0 = Math.round(v0); v1 = Math.round(v1);
    const T = await tex(`${g.page}_c${g.clut[0]}_r${g.clut[1]}.png`);
    const rows = [];
    for (let v = v0; v < v1; v++) {   // v0 = top (corr v,y = -1, measured), v1 = bottom
      const px = [];
      for (let u = u0; u < u1; u++) { const o = (v * T.width + u) * 4; px.push([T.data[o], T.data[o + 1], T.data[o + 2]]); }
      const med = [0, 1, 2].map((k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1]);
      rows.push({ y: yhi - (v - v0 + 0.5) / (v1 - v0) * (yhi - ylo), med });
    }
    return { ylo, yhi, rect: [u0, u1, v0, v1], file: `${g.page}_c${g.clut[0]}_r${g.clut[1]}.png`, rows };
  };
  const skyG = geo.groups.find((g) => { const [lo, hi] = groupY(g); return g.page === "wall" && Math.abs(lo - skyPiece.ymin) < 2 && Math.abs(hi - skyPiece.ymax) < 2; });
  out.bandPic = skyG ? await rowsOf(skyG) : null;
  // the pine band right under it (its top shows painted sky): the group whose top meets the sky band's foot
  const pineG = geo.groups.find((g) => { const [lo, hi] = groupY(g); return g !== skyG && g.page === "wall" && Math.abs(hi - skyPiece.ymin) < 2 && lo >= -1; });
  out.pinePic = pineG ? await rowsOf(pineG) : null;

  // ---- probe: the real dome + material from an eye, looking along d, 1x1 float target ----
  const s = B.scene.children.find((o) => o.isGroup && o !== sky)?.scale.x || 1;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  const pc = new THREE.PerspectiveCamera(0.05, 1, 1, B.camera.far);
  const hidden = B.scene.children.filter((o) => o !== sky && o.visible);
  const px = new Float32Array(4);
  const EYE = [0, 680, 4000];   // fight eye in the ring frame: 10 m from the centre, 1.7 m up (MEASURE.md 2g)
  const probe = (d, eye = EYE) => {
    pc.position.set(eye[0] * s, eye[1] * s, eye[2] * s);
    pc.up.set(0, 1, 0); if (Math.abs(d[1]) > 0.999) pc.up.set(0, 0, 1);
    pc.lookAt(pc.position.x + d[0], pc.position.y + d[1], pc.position.z + d[2]); pc.updateMatrixWorld();
    for (const o of hidden) o.visible = false;
    const prev = rr.getRenderTarget(); rr.setRenderTarget(rt); rr.render(B.scene, pc); rr.readRenderTargetPixels(rt, 0, 0, 1, 1, px); rr.setRenderTarget(prev);
    for (const o of hidden) o.visible = true;
    return [px[0], px[1], px[2]];
  };
  const s8 = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
  const to8 = (c) => c.map(s8);
  const d8 = (a, b) => Math.max(...a.map((v, k) => Math.abs(s8(v) - s8(b[k]))));
  const dm = (a8, b) => Math.max(...a8.map((v, k) => Math.abs(v - s8(b[k]))));   // measured sRGB vs linear
  const norm = (v) => { const L = Math.hypot(...v); return v.map((x) => x / L); };
  const ringR = SU.uRing.value[0].y, [Y0, Y1] = [SU.uBandY.value.x, SU.uBandY.value.y];
  // direction from eye to the ring point at azimuth az (deg, atan2(x, z)) and height h
  const toRing = (az, h, eye = EYE) => norm([ringR * Math.sin(az * Math.PI / 180) - eye[0], h - eye[1], ringR * Math.cos(az * Math.PI / 180) - eye[2]]);
  const keepCl = SU.uSkyClAmt.value;
  out.cloudsAmt = keepCl;

  // 1. twin vs GPU, band clouds off
  SU.uSkyClAmt.value = 0;
  const dirs = [];
  const N = 96, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y); dirs.push([Math.cos(i * ga) * r, y, Math.sin(i * ga) * r]); }
  for (let az = 7; az < 360; az += 30) for (const f of [-0.5, -0.1, 0, 0.25, 0.5, 0.75, 1, 1.1, 1.5]) dirs.push(toRing(az, Y0 + f * (Y1 - Y0)));
  let worst = 0, worstAt = null;
  for (const d of dirs) {
    SU.uRingEye.value.set(...EYE);
    const e = d8(probe(d), SK.skyRadianceJS(d)); if (e > worst) { worst = e; worstAt = d.map((v) => +v.toFixed(3)); }
  }
  out.twin = { n: dirs.length, worst, worstAt };

  // 2. band picture rows vs the dome at the same ring height (8 azimuths)
  const rowCmp = (pic) => pic.rows.map((r) => {
    let e = 0, got = null;
    for (let az = 22.5; az < 360; az += 45) { const g = probe(toRing(az, r.y)); const x = dm(r.med, g); if (x > e) { e = x; got = to8(g).map((v) => +v.toFixed(1)); } }
    return { y: +r.y.toFixed(1), m: +(r.y / 400).toFixed(2), measured: r.med, dome: got, err: +e.toFixed(1) };
  });
  out.bandRows = out.bandPic ? rowCmp(out.bandPic) : null;
  // WHAT THE USER SEES: the dome colours through the colour pass (window.__post, ACES share = post.settings.toneMix)
  const PP = window.__post;
  out.post = PP ? { toneMix: PP.settings.toneMix, uniform: PP.U.uToneMix.value } : null;
  if (PP && out.bandRows) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    out.display = out.bandRows.map((r) => ({ m: r.m, measured: r.measured, dome: r.dome,
      shown: PP.twin.chain(r.dome.map(lin), 4, 4, PP.settings).map((v) => +(v * 255).toFixed(1)),
      aces: PP.twin.chain(r.dome.map(lin), 4, 4, { ...PP.settings, toneMix: 1 }).map((v) => +(v * 255).toFixed(1)) }));
  }
  // pine band top: only rows whose texels are sky-coloured across the whole row (the sky above the pine tips)
  if (out.pinePic) {
    const ref = out.bandPic.rows[out.bandPic.rows.length - 1].med;
    const skyRows = { ...out.pinePic, rows: out.pinePic.rows.filter((r) => r.med[2] > r.med[0] + 24 && r.med[2] >= 200 && r.y > 0.5 * Y0) };
    out.pineSky = rowCmp(skyRows); out.pineSkyRef = ref;
  }

  // 3. below the ring foot = the background colour exactly
  const bg = rec.bg, below = [];
  for (let az = 3; az < 360; az += 20) for (const h of [-200, -800, -3000, -20000]) { const g = probe(toRing(az, h)); below.push(Math.max(...to8(g).map((v, k) => Math.abs(v - bg[k])))); }
  for (const d of [[0, -1, 0], norm([1, -0.2, 0.3]), norm([-0.3, -0.05, -1])]) { const g = probe(d); below.push(Math.max(...to8(g).map((v, k) => Math.abs(v - bg[k])))); }
  out.below = { n: below.length, worst: Math.max(...below), bg, lakeInfo: I.bandMode?.lake };

  // 4. no hard line: dome alone, 960x720, fight camera looking at the far band and the near band
  const W = 960, H = 720;
  const big = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  const buf = new Float32Array(W * H * 4);
  const vc = new THREE.PerspectiveCamera(45, W / H, B.camera.near, B.camera.far);
  const rowStep = (look, clouds) => {
    SU.uSkyClAmt.value = clouds ? keepCl : 0;
    vc.position.set(EYE[0] * s, EYE[1] * s, EYE[2] * s); vc.up.set(0, 1, 0); vc.lookAt(look[0] * s, look[1] * s, look[2] * s); vc.updateMatrixWorld();
    for (const o of hidden) o.visible = false;
    rr.setRenderTarget(big); rr.render(B.scene, vc); rr.readRenderTargetPixels(big, 0, 0, W, H, buf); rr.setRenderTarget(null);
    for (const o of hidden) o.visible = true;
    // ring height for each pixel's ray, then the largest neighbour-row step inside / at the top / at the bottom of the band
    const inv = new THREE.Matrix4().copy(vc.projectionMatrixInverse), cw = vc.matrixWorld, v3 = new THREE.Vector3();
    const res = { inBand: 0, top: 0, foot: 0 };
    for (let x = 0; x < W; x += 8) for (let y = 1; y < H; y++) {
      const o = (y * W + x) * 4, p = ((y - 1) * W + x) * 4;
      v3.set((x + 0.5) / W * 2 - 1, (y + 0.5) / H * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(cw).sub(vc.position).normalize();
      const h = SK.skyBandHJS([v3.x, v3.y, v3.z], { x: EYE[0], y: EYE[1], z: EYE[2] });
      const st = Math.max(...[0, 1, 2].map((k) => Math.abs(s8(buf[o + k]) - s8(buf[p + k]))));
      if (h >= Y0 && h <= Y1) res.inBand = Math.max(res.inBand, st);
      else if (h > Y1 && h <= Y1 + 0.5 * (Y1 - Y0)) res.top = Math.max(res.top, st);
      else if (h >= 0 && h < Y0) res.foot = Math.max(res.foot, st);
    }
    return Object.fromEntries(Object.entries(res).map(([k, v]) => [k, +v.toFixed(2)]));
  };
  out.steps = {
    far: rowStep([0, (Y0 + Y1) / 2, -ringR], false), near: rowStep([0, (Y0 + Y1) / 2, ringR], false),
    farCl: rowStep([0, (Y0 + Y1) / 2, -ringR], true), nearCl: rowStep([0, (Y0 + Y1) / 2, ringR], true),
  };

  // 5. band clouds on: changes only inside the band (ray meets the ring between ymin and ymax)
  SU.uSkyClAmt.value = keepCl;
  let outside = 0, insideMax = 0, insideN = 0, insideChanged = 0;
  for (let az = 0; az < 360; az += 5) for (let f = -0.6; f <= 1.6; f += 0.05) {
    const h = Y0 + f * (Y1 - Y0), d = toRing(az, h);
    const on = probe(d); SU.uSkyClAmt.value = 0; const off = probe(d); SU.uSkyClAmt.value = keepCl;
    const e = d8(on, off);
    if (h >= Y0 && h <= Y1) { insideN++; insideMax = Math.max(insideMax, e); if (e > 0.5) insideChanged++; } else outside = Math.max(outside, e);
  }
  out.clouds = { outside: +outside.toFixed(2), insideMax: +insideMax.toFixed(1), insideShare: +(insideChanged / insideN).toFixed(3) };

  // 6. cost at 960x720, fight camera (the viewer's own render(), canvas set to 960x720)
  const cv = rr.domElement, keepW = cv.width, keepH = cv.height;
  cv.width = W; cv.height = H;
  const cam = { ...window.__r.getCameraInfo().render };
  cam.eye = EYE.map((v) => v * s); cam.look = [0, 0, 0]; cam.up = [0, 1, 0]; cam.fovRad = 45 * Math.PI / 180; cam.aspect = W / H; cam.arenaScale = s;
  const gl = rr.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(10);
  const t = { on: 0, off: 0, clOn: 0, clOff: 0 };
  for (let rep = 0; rep < 3; rep++) {
    sky.visible = true; SU.uSkyClAmt.value = keepCl; t.on += time(FRAMES / 3);
    sky.visible = false; t.off += time(FRAMES / 3);
    sky.visible = true; SU.uSkyClAmt.value = 0; t.clOff += time(FRAMES / 3);
    SU.uSkyClAmt.value = keepCl; t.clOn += time(FRAMES / 3);
  }
  for (const k in t) t[k] /= 3;
  B.render(cam); const full = { tris: B.info.triangles, calls: B.info.calls };
  for (const o of hidden) o.visible = false; B.render(cam); const dome = { tris: B.info.triangles, calls: B.info.calls };
  for (const o of hidden) o.visible = true;
  out.cost = { W: rr.getDrawingBufferSize(new THREE.Vector2()).x, H: rr.getDrawingBufferSize(new THREE.Vector2()).y, ...t, full, dome, frames: FRAMES, renderer: gl.getParameter(gl.RENDERER) };
  cv.width = keepW; cv.height = keepH;
  out.programs = { count: rr.info.programs.length, failed: rr.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  SU.uSkyClAmt.value = keepCl;
  rt.dispose(); big.dispose();
  return out;
}, { ARENA, FRAMES });

const BM = R.info.bandMode;
// ---- the DISPLAYED sky (through the colour pass): lavender, pale at the top, more violet near the horizon, NOT flat grey
if (R.display?.length) {
  const D = R.display, chroma = (c) => c[2] - c[0], sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  const first = D[D.length - 1], last = D[0];   // rows run from the band top (index 0) to its foot
  const err = Math.max(...D.map((d) => Math.max(...d.shown.map((v, k) => Math.abs(v - d.measured[k])))));
  console.log(`     (info) displayed sky (colour pass toneMix ${R.post.toneMix}): top row ${JSON.stringify(D[0].shown)} (measured ${JSON.stringify(D[0].measured)}, ACES would show ${JSON.stringify(D[0].aces)}), foot row ${JSON.stringify(D[D.length - 1].shown)} (measured ${JSON.stringify(D[D.length - 1].measured)}, ACES ${JSON.stringify(D[D.length - 1].aces)})`);
  check(R.post && R.post.toneMix === 0 && R.post.uniform === 0, `the colour pass does not grey this pale palette: post toneMix ${R.post?.toneMix}, uniform ${R.post?.uniform} (ACES maps the measured sky [208,200,232] to [208,204,217] and the background [240,232,248] to [223,219,222])`);
  check(err <= 10, `DISPLAYED band colours = the measured picture rows: worst ${err.toFixed(1)}/255 over ${D.length} rows through the colour pass (<= 10: one palette step plus the grade)`);
  const mid = D[D.length >> 1];
  check(chroma(mid.shown) >= 18 && chroma(mid.aces) < chroma(mid.shown) - 8, `lavender, not flat grey: displayed blue-minus-red at the middle row ${chroma(mid.shown).toFixed(0)} (measured ${chroma(mid.measured)}; ACES would leave ${chroma(mid.aces).toFixed(0)})`);
  check(sat(D[D.length - 1].shown) > sat(D[0].shown) + 0.08 && D[0].shown[0] > D[D.length - 1].shown[0] + 25, `pale at the top, more saturated violet near the horizon: saturation ${sat(D[D.length - 1].shown).toFixed(2)} (foot) > ${sat(D[0].shown).toFixed(2)} (top) + 0.08, top red ${D[0].shown[0].toFixed(0)} vs foot ${D[D.length - 1].shown[0].toFixed(0)}`);
} else check(false, "no displayed-sky data: window.__post missing (the colour pass is off) or no band rows");
console.log(`     (info) ${ARENA}: band y ${R.info.band.map((v) => (v / 400).toFixed(2)).join("..")} m, ring r ${(BM?.ringR / 400).toFixed(2)} m, stops ${JSON.stringify(BM?.stops)}, below ${BM?.below}, soft ${BM?.soft} u, fade ${BM?.fade?.toFixed(0)} u, glowK ${BM?.glowK}, residual ${R.info.residual?.toExponential(2)}`);
check(R.bandMix === 1 && !!BM, `band mode on (uBandMix ${R.bandMix}, sky piece ymin ${R.info.band[0]} > 0)`);
check(!R.banks, `3D cumulus banks not built in band mode (band picture has no cloud shape)`);
check(R.info.mode === "day" && R.night.moon === 0 && R.night.stars === 0 && !R.night.starTex, `day: mode ${R.info.mode}, moon ${R.night.moon}, stars ${R.night.stars}, star map ${R.night.starTex}`);
check(R.info.tris === 12, `dome is ${R.info.tris} triangles`);
check(R.twin.worst <= 2, `JS twin vs GPU dome (band clouds off), ${R.twin.n} directions from the fight eye: worst ${R.twin.worst.toFixed(2)}/255 at ${R.twin.worstAt} (<= 2)`);
if (R.bandRows) {
  const e = R.bandRows.map((r) => r.err).sort((a, b) => a - b), med = e[e.length >> 1], max = e[e.length - 1];
  console.log(`     (info) band picture ${R.bandPic.file} rect ${R.bandPic.rect}, ${R.bandRows.length} texel rows, y ${(R.bandPic.ylo / 400).toFixed(2)}..${(R.bandPic.yhi / 400).toFixed(2)} m`);
  for (const r of R.bandRows) console.log(`     (row) ${r.m} m measured ${JSON.stringify(r.measured)} dome ${JSON.stringify(r.dome)} err ${r.err}`);
  check(max <= 8, `band rows vs dome at the same ring height (8 azimuths): median ${med}, max ${max}/255 (<= 8 = one palette step of the picture; PICKED bound)`);
} else check(false, "band picture group not found in geometry.json");
if (R.pineSky?.length) {
  for (const r of R.pineSky) console.log(`     (pine-top sky) ${r.m} m measured ${JSON.stringify(r.measured)} dome ${JSON.stringify(r.dome)} err ${r.err}`);
  const mx = Math.max(...R.pineSky.map((r) => r.err));
  console.log(`     (info) sky painted into the pine band's top: ${R.pineSky.length} sky rows, max error ${mx}/255 (info only: the dome there is hidden by the tree ring)`);
} else console.log("     (info) no all-sky rows in the pine band's top (pine tips reach into every row)");
check(R.below.worst <= 1, `rays meeting the ring below its foot = background/lake ${JSON.stringify(R.below.bg)}: worst ${R.below.worst.toFixed(2)}/255 over ${R.below.n} (<= 1); info lake ${JSON.stringify(R.below.lakeInfo)}`);
for (const [k, v] of Object.entries(R.steps)) console.log(`     (info) neighbour-row step, ${k}: in band ${v.inBand}, above top ${v.top}, between foot and band ${v.foot} (/255)`);
// clouds off: the gradient itself (a band line would show here); clouds on: the cloud edges, info only
const stepMax = Math.max(...[R.steps.far, R.steps.near].flatMap((v) => [v.inBand, v.top]));
const stepCl = Math.max(...[R.steps.farCl, R.steps.nearCl].flatMap((v) => [v.inBand, v.top]));
check(stepMax <= 2, `no hard line in the band or at its top (960x720, fight eye, band clouds off): largest neighbour-row step ${stepMax}/255 (<= 2); with clouds on ${stepCl}/255 (cloud edges, info)`);
check(R.clouds.outside <= 0.5, `band clouds (amount ${R.cloudsAmt}) change nothing outside the band: worst ${R.clouds.outside}/255; inside up to ${R.clouds.insideMax}/255 on ${(R.clouds.insideShare * 100).toFixed(1)}% of samples`);
const C = R.cost;
console.log(`     (info) cost at ${C.W}x${C.H}, fight eye, ${C.frames} frames (${C.renderer}): frame sky shown ${C.on.toFixed(3)} ms, hidden ${C.off.toFixed(3)} ms -> sky ${(C.on - C.off).toFixed(3)} ms; band clouds on ${C.clOn.toFixed(3)} / off ${C.clOff.toFixed(3)} -> clouds ${(C.clOn - C.clOff).toFixed(3)} ms`);
console.log(`     (info) dome alone: ${C.dome.tris} triangles, ${C.dome.calls} draw call(s); whole frame ${C.full.tris} triangles, ${C.full.calls} calls`);
check(C.dome.tris === 12 && C.dome.calls === 1, `dome = ${C.dome.tris} triangles, ${C.dome.calls} draw call`);
check(C.on - C.off <= 1, `sky costs ${(C.on - C.off).toFixed(3)} ms per frame at 960x720 (<= 1)`);
check(R.programs.failed === 0, `shader programs compile: ${R.programs.count}, ${R.programs.failed} failed`);
check(errors.length === 0, `no page errors (${errors.length})${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=meft1013&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});
const g13 = await page.evaluate(() => ({ mix: window.__post?.settings?.toneMix, u: window.__post?.U?.uToneMix?.value }));
check(g13.mix === 1 && g13.u === 1, `gated: meft1013 keeps the full ACES colour pass (toneMix ${g13.mix}, uniform ${g13.u})`);
console.log(`\n${passes} PASS, ${fails} FAIL`);
await browser.close();
process.exit(fails ? 1 : 0);
