// Numbers check of the BUILT arena's sun / moon light (web/built/shared.js setBuiltLight / modelLight, the opt-in
// battle3d setSceneLight, the Arena Viewer's push). No pictures: pixel VALUES only.
//  - the light state, day vs night: day = today's values exactly; night = from the moon's direction, dimmer and bluer
//  - every lit built material holds the SAME uniform objects for the light (one shared light)
//  - GPU probe: the shared toonLight() on a lit, up-facing point, day vs night, = the expected per-channel ratio
//  - a forced night sky = THIS arena's own measured sky put through the shared night grade (shared.js SKY_SAT /
//    SKY_GAIN), evaluated with the dome's own JS twin at the two calibrated spots: no "it must get bluer" assumption,
//    the expected direction comes from the arena's measured colours (a pure-blue measured sky loses blue share)
//  - the real ground layer drawn alone, on whichever ground surface the arena has (grass mesh, else the sand / shore
//    ground; SKIP when it has neither): mean colour by night darker and bluer than by day
//  - the Digimon: mean colour of the fighter canvas (alpha > 0) by night darker and bluer than by day, and the
//    fighter normals point outward (winding measured)
//  - with setSceneLight never called, battle3d's frame is byte-identical to battle3d with the SCENE-LIGHT blocks
//    stripped out (the game's own code), and the same after on -> null
//  - shader programs compile, no page errors; frame time over FRAMES frames, light on vs off
//   VERIFY_PORT=8090 [ARENA=meft1013] [FRAMES=600] tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_light.mjs
import { readFileSync } from "node:fs";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1013";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 600));
const src = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
const stripped = src.replace(/^[^\n]*\/\/ SCENE-LIGHT-BEGIN[^\n]*\n[\s\S]*?^[^\n]*\/\/ SCENE-LIGHT-END[^\n]*\n/gm, "");
const blocks = (src.match(/\/\/ SCENE-LIGHT-BEGIN/g) || []).length;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
await ctx.route("**/battle3d_nolight.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: stripped }));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.sky && window.__r?.getFighterBounds("player") && window.__r?.getFighterBounds("enemy"), null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1500);
let fails = 0, passes = 0, skips = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const R = await page.evaluate(async ({ FRAMES }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const K = await import("./built/sky.js");            // the dome's own maths (JS twin of the sky GLSL)
  const B = window.__built, r = window.__r;
  if (!B) return { missing: true };
  const out = {};
  const arr = (c) => [c.r, c.g, c.b];
  const LK = ["uLightDir", "uLightColor", "uAmbient", "uShadowTint", "uSkyFill", "uGroundBounce", "uRimColor", "uUnlitK", "uShadeK", "uShadowMix"];
  const lightNow = () => Object.fromEntries(LK.map((k) => [k, S.U[k].value.isColor ? arr(S.U[k].value) : S.U[k].value.toArray ? S.U[k].value.toArray() : S.U[k].value]));
  // the two spots createBuiltSky() calibrates: straight up, and the horizon at right angles to the light (no warm band)
  const dirH = (() => { const sd = S.U.uSunDir.value, l = Math.hypot(-sd.z, sd.x); return [-sd.z / l, 0, sd.x / l]; })();
  const skyNow = () => ({ zenith: arr(S.SKY_U.uZenith.value), horizon: arr(S.SKY_U.uHorizon.value), haze: arr(S.U.uHaze.value), glow: S.SKY_U.uSunGlow.value,
    rad: { up: K.skyRadianceJS([0, 1, 0]), horizon: K.skyRadianceJS(dirH) } });

  const L = window.__layers;
  // ---- 1. light state ----
  L.setSkyMode("day"); window.__renderFrame(performance.now());
  out.day = { light: lightNow(), sky: skyNow(), state: { ...S.light, gradedFor: undefined }, model: S.modelLight(), sunDir: S.U.uSunDir.value.toArray(), pal: B.info.sky?.night };
  L.setSkyMode("night"); window.__renderFrame(performance.now());
  out.night = { light: lightNow(), sky: skyNow(), state: { ...S.light, gradedFor: undefined }, model: S.modelLight(), moonDir: S.SKY_U.uMoonDir.value.toArray(), skyNight: B.info.sky?.night };
  L.setSkyMode("night"); L.set("trees", true); window.__renderFrame(performance.now());   // idempotent: no second grade
  out.nightAgain = skyNow();
  out.NIGHT = S.NIGHT_LIGHT;
  out.targets = B.info.sky?.targets ?? null;        // this arena's own measured sky colours (sRGB 0-255)
  out.calibResidual = B.info.sky?.calibResidual ?? null;
  // ---- 2. one shared light on every lit material ----
  const lit = B.materials.filter((m) => /toonLight\(|c \*= uUnlitK/.test(m.fragmentShader || ""));
  out.share = { lit: lit.length, all: B.materials.length, bad: lit.filter((m) => LK.some((k) => m.uniforms?.[k] !== S.U[k])).length,
    kinds: lit.map((m) => (m.fragmentShader.includes("c *= uUnlitK") ? "unlit" : m.fragmentShader.includes("toonLight(") ? "toon" : "sky")) };
  // ---- 3. GPU probe of toonLight (lit band, N up) ----
  const Rr = B.renderer;
  const probe = () => {
    const n = 8, P = new Float32Array(n * 3), id = new Float32Array(n);
    for (let i = 0; i < n; i++) { P.set([i * 937 - 3000, 0, i * 611 - 2000], i * 3); id[i] = i; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("pid", new THREE.BufferAttribute(id, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: S.uniformsWith({}),
      vertexShader: `attribute float pid; varying vec3 vW; void main(){ vW = position; gl_PointSize = 1.0;
        gl_Position = vec4((pid + 0.5) / 8.0 * 2.0 - 1.0, 0.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vW; ${S.NOISE_GLSL} ${S.LIGHT_GLSL}
        void main(){ gl_FragColor = vec4(toonLight(vec3(0.3), vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), vW, 1.0, 0.0), 1.0); }` });
    const rt = new THREE.WebGLRenderTarget(8, 1, { type: THREE.FloatType, depthBuffer: false });
    const sc = new THREE.Scene(), pts = new THREE.Points(g, mat); pts.frustumCulled = false; sc.add(pts);
    const cc = Rr.getClearColor(new THREE.Color()), ca = Rr.getClearAlpha();
    const prev = Rr.getRenderTarget(); Rr.setRenderTarget(rt); Rr.setClearColor(0, 0); Rr.clear(); Rr.render(sc, new THREE.Camera());
    const px = new Float32Array(32); Rr.readRenderTargetPixels(rt, 0, 0, 8, 1, px); Rr.setRenderTarget(prev); Rr.setClearColor(cc, ca);
    rt.dispose(); mat.dispose(); g.dispose();
    return Array.from({ length: n }, (_, i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  };
  const cam = () => r.getCameraInfo().render;
  // the ground surface THIS arena has: the grass ground mesh (ground.js, kind "grass"), else the sand / shore ground
  // (sand.js, kinds "sand" / "shore"); nothing else is a ground, so an arena with neither has no ground to probe
  const GROUNDS = [{ surface: "grass", kinds: ["grass"] }, { surface: "sand", kinds: ["sand", "shore"] }];
  const ground = GROUNDS.map((g) => {
    let meshes = 0;
    B.scene.traverse((o) => { if (o.isMesh && g.kinds.includes(o.userData.kind)) meshes++; });
    return { ...g, meshes };
  }).find((g) => g.meshes > 0) || null;
  out.groundSurface = ground && { surface: ground.surface, kinds: ground.kinds, meshes: ground.meshes };
  const groundOnly = () => {         // the real ground layer drawn alone; mean of the drawn pixels (sRGB bytes)
    if (!ground) return { mean: [0, 0, 0], n: 0 };
    const hid = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible && !(o.isMesh && ground.kinds.includes(o.userData.kind))) { hid.push(o); o.visible = false; } });
    const cc = Rr.getClearColor(new THREE.Color()), ca = Rr.getClearAlpha(); Rr.setClearColor(0, 0);
    B.render(cam()); const gl = Rr.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (const o of hid) o.visible = true; Rr.setClearColor(cc, ca);
    let s = [0, 0, 0], n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 0) { s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; n++; }
    return { mean: s.map((v) => v / Math.max(1, n)), n };
  };
  const digi = () => {               // the fighter canvas alone (alpha > 0), sRGB bytes
    r.render(0); const gl = window.__off.getContext("webgl"), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = [0, 0, 0], n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; n++; }
    return { mean: s.map((v) => v / Math.max(1, n)), n };
  };
  L.setSkyMode("day"); window.__renderFrame(performance.now());
  const dayM = S.modelLight();
  out.probeDay = probe(); out.groundDay = groundOnly(); r.setSceneLight(dayM); out.digiDay = digi();
  out.normals = r.getSceneLight();
  L.setSkyMode("night"); window.__renderFrame(performance.now());
  const nightM = S.modelLight();
  out.probeNight = probe(); out.groundNight = groundOnly(); r.setSceneLight(nightM); out.digiNight = digi();
  r.setSceneLight(null); out.digiOff = digi();
  // ---- 5. frame time: light on (night, Digimon lit) vs off (no Digimon light, day light state) ----
  const gl = Rr.getContext(), g2 = window.__off.getContext("webgl"), one = new Uint8Array(4);
  const frame = () => { r.render(0); B.render(cam()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); g2.readPixels(0, 0, 1, 1, g2.RGBA, g2.UNSIGNED_BYTE, one); };
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) frame(); return (performance.now() - t0) / n; };
  L.set("digiLight", false);
  const worldOn = () => { S.setBuiltLight({ mode: "night", measured: "day" }); r.setSceneLight(null); };
  const digiOn = () => { S.setBuiltLight({ mode: "day", measured: "day" }); r.setSceneLight(nightM); };
  const bothOn = () => { S.setBuiltLight({ mode: "night", measured: "day" }); r.setSceneLight(nightM); };
  const off = () => { S.setBuiltLight({ mode: "day", measured: "day" }); r.setSceneLight(null); };
  // interleaved short blocks (the GPU is shared with other jobs): FRAMES frames per state in 10 blocks each, median
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return (b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2; };
  const states = { off, worldOn, digiOn, bothOn }, T = Object.fromEntries(Object.keys(states).map((k) => [k, []]));
  const per = Math.max(10, Math.round(FRAMES / 10));
  for (const f of Object.values(states)) { f(); time(10); }
  for (let k = 0; k < 10; k++) for (const [name, f] of Object.entries(states)) { f(); T[name].push(time(per)); }
  off();
  const M = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, med(v)]));
  const blocks = [{ on: M.bothOn, off: M.off, d: M.bothOn - M.off }];
  const parts = [{ world: M.worldOn - M.off, digi: M.digiOn - M.off }];
  out.frame = { blocks, parts, size: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  out.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const pi = Rr.info.programs || [];
  out.programs = { count: pi.length, failed: pi.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  return out;
}, { FRAMES });

// ---- 4. byte-identical: battle3d with the SCENE-LIGHT blocks stripped vs as it is (never called, and on -> null) ----
const ident = await page.evaluate(async () => {
  const sel = (id) => document.getElementById(id).value;
  const [manifest] = await Promise.all([fetch("assets/battle/arenas/manifest.json").then((x) => x.json())]);
  const stageFor = {};
  for (const [stage, e] of Object.entries(manifest.byStage)) { const d = e._default; if (d != null && stageFor[d] == null) stageFor[d] = stage; }
  for (const [stage, e] of Object.entries(manifest.byStage)) for (const v of Object.values(e)) if (stageFor[v] == null) stageFor[v] = stage;
  const stage = `s${stageFor[sel("arena")]}`;
  const mk = async (url) => {
    const m = await import(url), cv = new OffscreenCanvas(960, 720), b = m.createBattle3D(cv, null, { alpha: true });
    b.setBuiltArena(true); b.setArenaStage(stage, null); b.setPlayerDigimon(sel("pModel")); b.setEnemyDigimon(sel("eModel"));
    b.setCameraMode("game", { scriptOwnsCamera: false });
    return { b, cv };
  };
  const A = await mk("./battle3d_nolight.js"), C = await mk("./battle3d.js"), D = await mk("./battle3d.js");
  for (let i = 0; i < 100; i++) {
    for (const x of [A, C, D]) x.b.render(0);
    if ([A, C, D].every((x) => x.b.getFighterBounds("player") && x.b.getFighterBounds("enemy"))) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  await new Promise((res) => setTimeout(res, 1500));
  D.b.setSceneLight({ dir: [0, 1, 0], colour: [0.3, 0.3, 0.5], ambient: [0.1, 0.1, 0.2] }); D.b.render(0); D.b.setSceneLight(null);
  const read = (x) => { x.b.render(0); const gl = x.cv.getContext("webgl"), px = new Uint8Array(960 * 720 * 4); gl.readPixels(0, 0, 960, 720, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const pa = read(A), pc = read(C), pd = read(D);
  const diff = (p, q) => { let n = 0; for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) n++; return n; };
  let drawn = 0; for (let i = 3; i < pa.length; i += 4) if (pa[i] > 0) drawn++;
  return { stage, drawn, neverCalled: diff(pa, pc), onThenNull: diff(pa, pd), hasApiStripped: typeof A.b.setSceneLight, hasApi: typeof C.b.setSceneLight };
});
await browser.close().catch(() => {});

if (R.missing) { console.log("FAIL no built arena"); process.exit(1); }
const f3 = (a) => a.map((v) => (+v).toFixed(4)).join(", ");
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const blue = (c) => c[2] / Math.max(1e-6, c[0] + c[1] + c[2]);
const lin = (b) => { const v = b / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const D = R.day.light, N = R.night.light, NL = R.NIGHT;
// day = today's values
const sun = [0.45, 0.8, 0.4], sl = Math.hypot(...sun), sunN = sun.map((v) => v / sl);
const near = (a, b, e = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < e);
console.log(`     (info) day light: dir ${f3(D.uLightDir)} colour ${f3(D.uLightColor)} ambient ${f3(D.uAmbient)} shadowTint ${f3(D.uShadowTint)} skyFill ${f3(D.uSkyFill)} bounce ${f3(D.uGroundBounce)} rim ${f3(D.uRimColor)}`);
console.log(`     (info) night light: dir ${f3(N.uLightDir)} colour ${f3(N.uLightColor)} ambient ${f3(N.uAmbient)} shadowTint ${f3(N.uShadowTint)} skyFill ${f3(N.uSkyFill)} bounce ${f3(N.uGroundBounce)} rim ${f3(N.uRimColor)} unlit ${f3(N.uUnlitK)}`);
check(R.day.state.mode === "day" && near(D.uLightDir, sunN) && near(D.uLightDir, R.day.sunDir) && near(D.uLightColor, [1, 1, 1]) && near(D.uAmbient, [1, 1, 1])
  && near(D.uGroundBounce, [0.07, 0.045, 0.02]) && near(D.uRimColor, [1, 0.95, 0.85]) && near(D.uUnlitK, [1, 1, 1]),
  `day light = today's values (sun dir ${f3(sunN)}, colour 1, ambient 1, bounce, rim, unlit 1)`);
check(R.night.state.mode === "night" && near(N.uLightDir, R.night.moonDir, 1e-4) && near(N.uLightDir, R.night.skyNight?.moonDir || [9, 9, 9], 1e-4),
  `night light comes from the moon: light dir ${f3(N.uLightDir)} = sky moon dir ${f3(R.night.moonDir)}`);
check(luma(N.uLightColor) < luma(D.uLightColor) * 0.6 && blue(N.uLightColor) > blue(D.uLightColor) && luma(N.uAmbient) < luma(D.uAmbient) && blue(N.uShadowTint) > 0.33,
  `night key dimmer and bluer: luma ${luma(N.uLightColor).toFixed(3)} vs ${luma(D.uLightColor).toFixed(3)}, blue share ${blue(N.uLightColor).toFixed(3)} vs ${blue(D.uLightColor).toFixed(3)}; shade x ${luma(N.uAmbient).toFixed(3)}`);
const zd = R.day.sky.zenith, zn = R.night.sky.zenith;
console.log(`     (info) sky stops day zenith ${f3(zd)} horizon ${f3(R.day.sky.horizon)}; forced night zenith ${f3(zn)} horizon ${f3(R.night.sky.horizon)} haze ${f3(R.night.sky.haze)}; sky measured "${R.night.skyNight?.measured}", graded ${R.night.state.skyGraded}; calibrated residual ${R.calibResidual}`);
if (R.night.skyNight?.measured === "day") {
  // The forced night grade's own maths (shared.js gradeNight: desaturate toward the colour's own luma by SKY_SAT, then
  // the per-channel SKY_GAIN) applied to THIS arena's own measured sky. No "it must get bluer" assumption: what night
  // should look like comes out of the arena's measured colours, so a sky measured pure blue loses blue share (the
  // desaturation adds r,g) while a warm one gains it. The dome's own JS twin says what the built sky actually draws.
  const G = (c) => { const l = luma(c); return c.map((v, k) => (l + (v - l) * NL.SKY_SAT) * NL.SKY_GAIN[k]); };
  const hz = G(R.day.sky.haze), err = Math.max(...hz.map((v, k) => Math.abs(v - R.night.sky.haze[k])));
  const tg = R.targets, maxGain = Math.max(...NL.SKY_GAIN);
  const rows = [["zenith", tg?.zenith, R.night.sky.rad.up, R.day.sky.rad.up], ["horizon", tg?.horizon, R.night.sky.rad.horizon, R.day.sky.rad.horizon]]
    .filter(([, t]) => Array.isArray(t)).map(([name, t, got, day]) => {
      const tl = t.map(lin), exp = G(tl), dv = [0, 1, 2].map((k) => got[k] - exp[k]);
      return { name, t: tl, exp, got, err: Math.hypot(...dv) / Math.hypot(...exp), lumaK: luma(got) / luma(tl), gradeK: luma(exp) / luma(tl),
        blueGot: blue(got), blueExp: blue(exp), blueT: blue(tl), darker: luma(got) < luma(day) && luma(got) <= luma(tl) * maxGain };
    });
  for (const r of rows) console.log(`     (info) ${r.name}: measured ${f3(r.t)} -> grade ${f3(r.exp)} vs sky ${f3(r.got)}; luma x${r.lumaK.toFixed(3)} of measured (grade's own x${r.gradeK.toFixed(3)}), blue share ${r.blueGot.toFixed(3)} vs measured ${r.blueT.toFixed(3)} (grade's own ${r.blueExp.toFixed(3)})`);
  const zr = rows[0];
  check(R.night.state.skyGraded && err < 1e-6 && rows.length === 2 && rows.every((r) => r.err < 0.08 && r.darker),
    `forced night = this arena's measured sky through the shared night grade: haze = grade(day haze) (error ${err.toExponential(1)}), ${rows.length ? rows.map((r) => `${r.name} ${(r.err * 100).toFixed(1)}%`).join(", ") + " off the graded measured colour" : `no measured targets in info.sky (${JSON.stringify(tg)})`}; darker at both spots (luma x${rows.map((r) => r.lumaK.toFixed(3)).join(" / x")} of measured, at most the grade's max gain ${maxGain}); zenith blue share ${zr ? zr.blueGot.toFixed(3) : "n/a"} vs measured ${zr ? zr.blueT.toFixed(3) : "n/a"} (the grade's own ${zr ? zr.blueExp.toFixed(3) : "n/a"})`);
}
check(near(R.nightAgain.zenith, zn, 1e-7) && near(R.nightAgain.haze, R.night.sky.haze, 1e-7), `night grade applied once per sky build (a second layer change leaves the stops as they were)`);
check(R.share.lit >= 5 && R.share.bad === 0, `one shared light: ${R.share.lit} lit materials of ${R.share.all} (${R.share.kinds.join(" ")}), ${R.share.bad} with a light uniform that is not the shared object`);
// GPU probe: expected ratio (lit band, N up, no rim): (L_n + 0.1 F_n) / (L_d + 0.1 F_d) per channel
const exp = [0, 1, 2].map((k) => (N.uLightColor[k] + 0.1 * N.uSkyFill[k]) / (D.uLightColor[k] + 0.1 * D.uSkyFill[k]));
let worst = 0;
const got = R.probeDay.map((d, i) => { const n = R.probeNight[i]; const q = [0, 1, 2].map((k) => n[k] / d[k]); worst = Math.max(worst, ...q.map((v, k) => Math.abs(v / exp[k] - 1))); return q; });
console.log(`     (info) GPU toonLight probe, 8 points: day ${f3(R.probeDay[0])} night ${f3(R.probeNight[0])}; ratio ${f3(got[0])}, expected ${f3(exp)}`);
check(worst < 2e-3 && exp[2] / exp[0] > 1.05 && exp.every((v) => v < 0.6), `lit ground point by night = day x the expected per-channel ratio (worst error ${(worst * 100).toFixed(3)}%): darker and bluer`);
const gD = R.groundDay.mean, gN = R.groundNight.mean;
if (!R.groundSurface) {
  skips++;
  console.log(`SKIP real ground render: ${ARENA} draws no ground surface at all (no grass mesh kind "grass", no sand ground kind "sand"/"shore") — 0 of 0 px measured, so this check neither passes nor fails here`);
} else {
  console.log(`     (info) ground surface ${R.groundSurface.surface} (kind ${R.groundSurface.kinds.join("/")}, ${R.groundSurface.meshes} meshes), alone, mean sRGB of ${R.groundDay.n} / ${R.groundNight.n} px: day ${f3(gD)} night ${f3(gN)}; linear luma ratio ${(luma(gN.map(lin)) / luma(gD.map(lin))).toFixed(3)}`);
  check(R.groundDay.n > 1000 && luma(gN) < luma(gD) * 0.75 && blue(gN) > blue(gD), `real ground render (${R.groundSurface.surface}): night darker (luma ${luma(gN).toFixed(1)} vs ${luma(gD).toFixed(1)}) and bluer (blue share ${blue(gN).toFixed(3)} vs ${blue(gD).toFixed(3)})`);
}
const dD = R.digiDay.mean, dN = R.digiNight.mean, dO = R.digiOff.mean;
console.log(`     (info) Digimon canvas, mean sRGB of ${R.digiDay.n} px: unlit ${f3(dO)} day ${f3(dD)} night ${f3(dN)}; model light day ${JSON.stringify(R.day.model)} night ${JSON.stringify(R.night.model)}`);
check(R.digiDay.n > 1000 && luma(dN) < luma(dD) * 0.75 && blue(dN) > blue(dD), `Digimon: night darker (luma ${luma(dN).toFixed(1)} vs ${luma(dD).toFixed(1)}) and bluer (blue share ${blue(dN).toFixed(3)} vs ${blue(dD).toFixed(3)}), same direction as the world light`);
const nm = R.normals;
console.log(`     (info) fighter winding ${nm.winding}: ${JSON.stringify(nm.player)} | ${JSON.stringify(nm.enemy)}`);
check(nm.player?.normals && nm.enemy?.normals && nm.player.outShare > 0.9 && nm.enemy.outShare > 0.9,
  `fighter normals outward: signed volume per bone piece ${((nm.player?.outShare || 0) * 100).toFixed(1)}% / ${((nm.enemy?.outShare || 0) * 100).toFixed(1)}% outward (${nm.player?.bonesOut}/${nm.player?.bonesIn}, ${nm.enemy?.bonesOut}/${nm.enemy?.bonesIn} pieces out/in)`);
check(blocks >= 8 && ident.hasApiStripped === "undefined" && ident.hasApi === "function" && ident.drawn > 1000 && ident.neverCalled === 0 && ident.onThenNull === 0,
  `game unchanged: ${blocks} SCENE-LIGHT blocks; stripped battle3d vs as is, ${ident.drawn} fighter px on ${ident.stage}: ${ident.neverCalled} bytes differ never called, ${ident.onThenNull} after on -> null`);
check(R.programs.failed === 0, `built shader programs compile: ${R.programs.count}, ${R.programs.failed} failed`);
const fb = R.frame.blocks;
console.log(`     (info) frame time at ${R.frame.size.join("x")} on ${R.renderer}, medians of 10 interleaved blocks, ${FRAMES} frames per state: light on ${fb.map((b) => b.on.toFixed(2)).join(" / ")} ms, off ${fb.map((b) => b.off.toFixed(2)).join(" / ")} ms, cost ${fb.map((b) => (b.d >= 0 ? "+" : "") + b.d.toFixed(2)).join(" / ")} ms`);
console.log(`     (info) parts: world night light ${R.frame.parts.map((p) => p.world.toFixed(2)).join(" / ")} ms, Digimon light ${R.frame.parts.map((p) => p.digi.toFixed(2)).join(" / ")} ms`);
check(fb.every((b) => b.on > 0 && b.off > 0), `frame time measured`);
for (const e of errors) console.log("   error:", e);
check(errors.length === 0, `errors: ${errors.length}`);
console.log(`     (info) ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails ? 1 : 0);
