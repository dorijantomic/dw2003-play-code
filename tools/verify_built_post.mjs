// Numbers check of the BUILT arena's look / post pass (web/built/post.js, plan Step 5), no pictures:
//  - ONE tone-map site: a 0.5 linear grey through the whole chain (composite -> bloom -> split-tone -> ACES -> dither
//    -> sRGB -> 8 bits) lands on the ACES reference within 1/255, and the same grey fed in ALREADY tone-mapped lands
//    on the double-map value instead (both printed: a second tone map in the chain shows up as that number, a FAIL).
//    The site count is read off the pass sources (ACES calls - definitions); no built material and not battle3d
//    carries an ACES fit or a three toneMapping setting.
//  - bloom: 0 on a plain white patch below the threshold and 0 on a pure-white full-screen frame (every one of the
//    four bloom levels is exactly 0, counted texel by texel, and the finished frame is byte-identical with the
//    strength on and off); the REAL built frame is judged on one frozen pair of its source canvases because the
//    world's own canvas is not bit-stable on this GPU - 1/255 on a few sky texels between two identical renders,
//    measured here, with the post pass out of the picture; non-zero around a disc
//    above the threshold, with the measured halo falloff printed; a full-white frame ABOVE the threshold is uniform
//    (no rim / no halo).
//  - MSAA: the composite target is samples === 4 and a 45-degree high-contrast edge rasterized into that very target
//    gives > 0 blended pixels, while a samples 0 target of the same size and the same edge gives 0.
//  - dither: a flat patch stays within 1/255 of the flat colour, shows more than one level, and its mean is the flat
//    colour; down a synthetic gradient the longest identical run falls from tens of rows to the 8x8 tile, i.e. the
//    bands are dithered away.
//  - the composite: with the fighters hidden and shown the visible canvas differs ONLY where the fighter canvas has
//    alpha and the background survives (sample points inside / outside the silhouette printed).
//  - ?post=0 bypass: the visible canvas equals the plain 2D composite exactly (0 differing pixels) and no post exists.
//  - page errors 0, every shader program compiles, frame time over FRAMES frames with the pass on vs off.
//   VERIFY_PORT=8090 [ARENA=meft1013] [FRAMES=120] tools/run-playwright.sh tools/verify_built_post.mjs
//   (real GPU through tools/run-playwright.sh - ANGLE D3D12 on the host's RX 9060 XT - is ~1 ms a frame, so 120
//    frames is a real sample; VERIFY_GPU=0 forces the old software path, ~0.5 s a frame)
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1013";
const FRAMES = +(process.env.FRAMES || 120);
const errors = [];
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

async function open(query = "") {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built${query}`);
  await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ built: !!window.__built, missing: !!window.__built?.missing, post: !!window.__post }));
  if (!st.built) { await browser.close().catch(() => {}); throw new Error(`the built world never loaded (another agent editing web/arena-built.js?): ${errors.join(" | ") || "no page error"}`); }
  return { browser, page, st };
}

// ═════════════════════════ page 1: the pass on (default) ═════════════════════════
const { browser, page } = await open();

// ---- shared page-side helpers, installed once (each block below re-renders synchronously before it reads) ----
await page.evaluate(() => {
  const cv = document.getElementById("cv"), ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  const P = window.__post, U = P.U;
  // The real renderer string, read NOW: gl.RENDERER is the "WebKit WebGL" privacy string, the unmasked one lives
  // behind WEBGL_debug_renderer_info, and Chrome blanks it once this context has drawn for a while (measured).
  const dbg = P.gl.getExtension("WEBGL_debug_renderer_info");
  window.__glInfo = {
    renderer: dbg ? P.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : P.gl.getParameter(P.gl.RENDERER),
    vendor: dbg ? P.gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
    masked: P.gl.getParameter(P.gl.RENDERER),
  };
  // the wind runs on real time and would move the foliage between two frames the checks compare: freeze it here, once
  window.__built.shared.wind.tick = () => {};
  window.__t = {
    W, H, P, U, ctx,
    T: performance.now(),
    // one viewer frame on the SAME camera state: the first call advances the idle clock, the rest see dt 0
    step() { window.__renderFrame(this.T); },
    grab() { return ctx.getImageData(0, 0, W, H).data; },
    flat(c, grad = 0) { U.uOverride.value.set(c[0], c[1], c[2], 1); U.uOverrideGrad.value = grad; },
    disc(c, rad, soft) { U.uOverride.value.set(c[0], c[1], c[2], 2); U.uOverrideGrad.value = 0; U.uSpot.value.set(rad, soft, 0); },
    clear() { U.uOverride.value.set(0, 0, 0, 0); U.uOverrideGrad.value = 0; },
    patch(d, x0, y0, w, h) { const v = []; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; v.push([d[i], d[i + 1], d[i + 2]]); } return v; },
    stats(v, k = 0) { let mn = 1e9, mx = -1e9, s = 0; for (const p of v) { mn = Math.min(mn, p[k]); mx = Math.max(mx, p[k]); s += p[k]; } return { min: mn, max: mx, mean: s / v.length, levels: new Set(v.map((p) => p[k])).size }; },
    // the module's own JS twin, the same maths the shader runs, without the dither
    ref(c) { return P.twin.chain(c, 0, 0, Object.assign({}, P.settings, { dither: 0 })).map((v) => v * 255); },
  };
});

// ---- 1. exactly one tone map for the whole frame ----
const tone = await page.evaluate(() => {
  const t = window.__t, P = t.P;
  const out = { settings: P.settings, samples: P.target.samples, isRT: !!P.target.isWebGLRenderTarget, post: !!P };
  // 0.5 linear grey through the whole chain
  const ref = t.ref([0.5, 0.5, 0.5]);
  t.flat([0.5, 0.5, 0.5]); t.step();
  const s = t.stats(t.patch(t.grab(), 400, 300, 48, 48));
  out.chain = { ref: +ref[0].toFixed(3), mean: +s.mean.toFixed(3), min: s.min, max: s.max, levels: s.levels,
    maxDev: +Math.max(Math.abs(s.min - ref[0]), Math.abs(s.max - ref[0])).toFixed(3) };
  // the ACES reference itself, from the module's JS twin of three's fit (sRGB encoded: the value the 8 bits hold)
  out.aces05 = +(P.twin.srgb(P.twin.aces([0.5, 0.5, 0.5]))[0] * 255).toFixed(3);
  // the same 0.5 grey fed in already tone-mapped: a second tone map would land on THAT value, not on the reference
  const a = P.twin.aces([0.5, 0.5, 0.5])[0];
  t.flat([a, a, a]); t.step();
  const s2 = t.stats(t.patch(t.grab(), 400, 300, 48, 48));
  out.twice = { input: +a.toFixed(6), want: +(P.twin.chain([a, a, a], 0, 0, Object.assign({}, P.settings, { dither: 0 }))[0] * 255).toFixed(3),
    measured: +s2.mean.toFixed(3) };
  // where that one ACES call is, and that nothing else in the frame carries a tone map
  out.toneMap = P.toneMap;
  const mats = [];
  window.__built.scene.traverse((o) => { if (o.material?.fragmentShader) mats.push(o.material.fragmentShader); });
  out.builtMaterials = mats.length;
  out.acesInBuilt = (mats.join("\n").match(/\bACES\w*|\bacesFilmic\w*|\btoneMapping\b/g) || []).length;
  t.clear(); t.step();
  return out;
});
await page.evaluate(async () => {
  const src = await fetch("./battle3d.js").then((r) => r.text());
  window.__battle3d = (src.match(/\bACES\w*|\bacesFilmic\w*|\btoneMapping\b/g) || []).length;
});
const battle3dAces = await page.evaluate(() => window.__battle3d);

console.log(`     (info) page: post ${tone.post ? "present" : "MISSING"}, target samples ${tone.samples}, settings ${JSON.stringify(tone.settings)}`);
console.log(`     (info) ACES reference for 0.5 linear grey: ${tone.aces05}/255 (three r186 ACESFilmicToneMapping, exposure ${tone.settings.exposure}); one ACES call site in the pass sources`);
check(tone.post && tone.samples === 4 && tone.isRT, `one own render target with 4x MSAA: samples ${tone.samples}`);
check(tone.chain.maxDev <= 1 && Math.abs(tone.chain.mean - tone.chain.ref) <= 0.5,
  `0.5 linear grey through the whole chain: ${tone.chain.mean}/255 (reference ${tone.chain.ref}, ACES ${tone.aces05}), max deviation ${tone.chain.maxDev}/255 (<= 1), ${tone.chain.levels} levels`);
check(Math.abs(tone.twice.measured - tone.twice.want) <= 1 && Math.abs(tone.twice.measured - tone.chain.ref) > 1,
  `already-tone-mapped ${tone.twice.input} fed in a second time: ${tone.twice.measured}/255 = the double-map value ${tone.twice.want} (not the single-map ${tone.chain.ref}), so a second tone map would be visible as a fail`);
check(tone.toneMap.sites === 1, `tone-map sites in the pass sources: ${tone.toneMap.sites} (${tone.toneMap.calls} calls of ACES, ${tone.toneMap.defs} definition)`);
check(tone.acesInBuilt === 0 && battle3dAces === 0, `no other tone map in the frame: ${tone.acesInBuilt} ACES/toneMapping matches in the ${tone.builtMaterials} built material shaders, ${battle3dAces} in battle3d.js`);

// ---- 2. bloom ----
// The built world's own canvas is NOT bit-stable on this GPU: two renders of the same camera, same uniforms, same
// scene differ by 1/255 on a handful of sky texels that sit exactly on a rounding boundary (measured below, and
// with the post pass out of the picture entirely). So the on/off pair is not two live frames: the module is run
// twice over ONE frame's own canvases, with no world/fighter render in between, which is byte-identical by
// construction. A leak is still caught twice over - the four bloom levels must be exactly 0 texel by texel, and
// that frozen pair must come out byte-identical.
const bloom = await page.evaluate(() => {
  const t = window.__t, P = t.P, U = t.U, out = {};
  const keep = U.uBloom.value;
  const diffPixels = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  const onOff = () => { t.step(); const on = t.grab(); U.uBloom.value = 0; t.step(); const off = t.grab(); U.uBloom.value = keep; return { on, off, diff: diffPixels(on, off) }; };
  /** One render of the module straight onto the visible canvas at strength s, over the world/fighter canvases. */
  const shot = (s) => { U.uBloom.value = s; P.render(window.__builtCv, window.__off); t.ctx.drawImage(P.canvas, 0, 0); return t.grab(); };
  // (a) the real frame: nothing in it reaches the 1.05 threshold
  t.clear(); t.step();
  const rb = P.readBloom();                            // the four levels of the frame just drawn
  const liveFrame = t.grab();
  // That frame again, twice, at the two strengths, with NO world/fighter render in between: both renders upload
  // and sample one and the same pixels of the one and the same canvases, so a difference can only be the bloom.
  // (A 2D-canvas snapshot of the fighter canvas would add a premultiply round trip on its alpha edge - ~1k texels
  // differ from the live frame that way - so the canvases themselves are the frozen pair.)
  const on = shot(keep), off = shot(0); U.uBloom.value = keep;
  // two LIVE frames at the same strength: the wobble a live on/off pair would inherit, for the record
  t.step(); const l1 = t.grab(); t.step(); const l2 = t.grab();
  out.real = { max: +rb.max.toFixed(6), l0max: +rb.l0max.toFixed(6), nonzero: rb.nonzero, texels: rb.texels,
    w: t.W, h: t.H, diff: diffPixels(on, off), frozenVsLive: diffPixels(on, liveFrame), sameLive: diffPixels(l1, l2) };
  // (b) a plain white patch below the threshold: 1.0 linear is the brightest an 8-bit sRGB source can be
  t.flat([1, 1, 1]); t.step();
  const pb = P.readBloom(); const po = onOff();
  const ps = t.stats(t.patch(po.on, 100, 100, 64, 64));
  out.plain = { max: +pb.max.toFixed(4), l0max: +pb.l0max.toFixed(4), nonzero: pb.nonzero, diff: po.diff, value: ps.mean, levels: ps.levels };
  // (c) a pure-white FULL-SCREEN frame, above the threshold (2.0 linear): the bloom runs, yet the frame stays uniform
  //     (a rim or a halo would show as a border that differs from the centre)
  // the bloom-on-white test needs ACES's soft shoulder (2.0 linear must not clamp to the same 255 with and without the
  // bloom): run it with the full tone map even on the arena whose colour pass the viewer sets to toneMix 0 (meft1008)
  const keepMix = U.uToneMix.value; U.uToneMix.value = 1;
  t.flat([2, 2, 2]); t.step();
  const wb = P.readBloom(); const wo = onOff();
  const centre = t.stats(t.patch(wo.on, 440, 320, 80, 80));
  const border = [];
  for (const [x0, y0] of [[0, 0], [t.W - 8, 0], [0, t.H - 8], [t.W - 8, t.H - 8], [0, 360], [t.W - 8, 360], [480, 0], [480, t.H - 8]]) {
    const s = t.stats(t.patch(wo.on, x0, y0, 8, 8)); border.push(s.mean);
  }
  const all = t.stats(t.patch(wo.on, 0, 0, t.W, t.H));
  out.white = { max: +wb.max.toFixed(4), l0max: +wb.l0max.toFixed(4), diff: wo.diff, centre: centre.mean, levels: centre.levels,
    borderMin: +Math.min(...border).toFixed(3), borderMax: +Math.max(...border).toFixed(3), lo: all.min, hi: all.max };
  U.uToneMix.value = keepMix;
  // (d) a disc above the threshold: the halo, and how it falls off (sharpest bloom level, along its centre row)
  t.disc([4, 4, 4], 0.03, 0.004);
  t.step();
  const db = P.readBloom(), L0 = P.readLevel(0);  const cx = Math.round(0.5 * L0.w), cy = Math.round(0.5 * L0.h), row = [];
  for (let x = 0; x < L0.w; x++) row.push((L0.px[(cy * L0.w + x) * 4] + L0.px[(cy * L0.w + x) * 4 + 1] + L0.px[(cy * L0.w + x) * 4 + 2]) / 3);
  const prof = [];
  for (const r of [0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.16]) {
    const x = Math.min(L0.w - 1, Math.round(cx + r * L0.w));
    prof.push([r, +row[x].toFixed(3)]);
  }
  const discPix = t.stats(t.patch(t.grab(), 470, 350, 4, 4));
  out.disc = { w: L0.w, h: L0.h, max: +db.max.toFixed(4), l0max: +db.l0max.toFixed(4), profile: prof, centre: discPix.mean };
  // the same disc with the bloom off, for the end-to-end halo on the finished frame
  const keepS = U.uBloom.value; U.uBloom.value = 0; t.step(); const noGlow = t.grab(); U.uBloom.value = keepS;
  t.disc([4, 4, 4], 0.03, 0.004); t.step(); const glow = t.grab();
  const halo = [];
  for (const r of [0.0, 0.03, 0.045, 0.06, 0.08, 0.1, 0.14]) {
    const x = Math.min(t.W - 1, Math.round((0.5 + r) * t.W)), y = Math.round(0.5 * t.H);
    const i = (y * t.W + x) * 4;
    halo.push([r, +(glow[i] - noGlow[i]).toFixed(2)]);
  }
  out.halo8 = halo;
  t.clear(); t.step();
  return out;
});
const b = bloom;
console.log(`     (info) real frame: ${b.real.nonzero} of ${b.real.texels} bloom texels non-zero (max ${b.real.max}, level 0 max ${b.real.l0max}) - nothing in the built frame reaches the 1.05 threshold on 8-bit sRGB sources`);
console.log(`     (info) why the on/off pair is not two live frames: the pair reproduces the live frame to ${b.real.frozenVsLive} px, while two LIVE frames at the SAME strength differ by ${b.real.sameLive} px (the built world's own canvas flips 1/255 on sky texels at a rounding boundary between identical renders - see the header)`);
check(b.real.max === 0 && b.real.l0max === 0 && b.real.nonzero === 0 && b.real.diff === 0,
  `bloom is 0 on the real frame: ${b.real.nonzero} of ${b.real.texels} texels in the four levels are non-zero (max ${b.real.max}), and one frozen pair of that frame's source canvases is byte-identical with strength ${tone.settings.bloom.strength} on vs off (${b.real.diff} pixels differ of ${b.real.w * b.real.h})`);
check(b.plain.max === 0 && b.plain.l0max === 0 && b.plain.nonzero === 0 && b.plain.diff === 0 && b.plain.value > 100,
  `bloom is 0 on plain white below the threshold (1.0 linear, the brightest an 8-bit sRGB source holds: ${b.plain.value}/255): ${b.plain.nonzero} non-zero bloom texels, bright pass max ${b.plain.max}, ${b.plain.diff} pixels differ with the strength on vs off`);
check(b.white.max > 0 && b.white.diff > 0 && b.white.hi - b.white.lo <= 1 && Math.abs(b.white.borderMin - b.white.centre) <= 0.5 && Math.abs(b.white.borderMax - b.white.centre) <= 0.5,
  `pure-white full-screen frame above the threshold (2.0 linear): bloom runs (max ${b.white.max}) and the frame stays flat - centre ${b.white.centre}/255, borders ${b.white.borderMin}..${b.white.borderMax}, whole frame ${b.white.lo}..${b.white.hi} - no rim, no halo`);
check(b.disc.l0max > 0.5 && b.disc.profile[0][1] > b.disc.profile[4][1] && b.disc.profile[9][1] < b.disc.profile[0][1] * 0.5,
  `bloom is non-zero around a disc above the threshold: level 0 max ${b.disc.l0max} (${b.disc.w}x${b.disc.h})`);
console.log(`     (info) halo falloff, level 0 bloom value at uv distance r from the centre of a 0.03 r disc: ${b.disc.profile.map(([r, v]) => `r ${r} -> ${v}`).join(", ")}`);
console.log(`     (info) end-to-end halo on the 8-bit frame (bloom on minus off, brightness at r): ${b.halo8.map(([r, v]) => `r ${r} -> ${v}`).join(", ")}`);

// ---- 3. dither ----
const dither = await page.evaluate(() => {
  const t = window.__t, U = t.U;
  // a flat sky patch (0.35 linear: a mid sky tone) through the whole chain
  const ref = t.ref([0.35, 0.35, 0.35]);
  t.flat([0.35, 0.35, 0.35]); t.step();
  const s = t.stats(t.patch(t.grab(), 380, 260, 64, 64));
  const out = { ref: +ref[0].toFixed(3), min: s.min, max: s.max, mean: +s.mean.toFixed(3), levels: s.levels,
    maxDev: +Math.max(Math.abs(s.min - ref[0]), Math.abs(s.max - ref[0])).toFixed(3) };
  // a synthetic sky gradient: the run of one identical 8-bit value down a column, and the rows that already hold both
  // neighbours side by side (a dithered transition instead of a hard step)
  const scan = (d) => {
    const x = 480, W = t.W, col = [];
    for (let y = 0; y < t.H; y++) col.push(d[(y * W + x) * 4 + 1]);
    let maxRun = 1, run = 1, steps = 0, mixed = 0;
    for (let y = 0; y < col.length; y++) {
      let m = 0;
      for (let k = 1; k < 8; k++) if (d[(y * W + x + k) * 4 + 1] !== col[y]) m = 1;
      mixed += m;
      if (y === 0) continue;
      if (col[y] === col[y - 1]) run++; else { run = 1; steps++; }
      maxRun = Math.max(maxRun, run);
    }
    const lo = Math.min.apply(null, col), hi = Math.max.apply(null, col);
    return { maxRun, steps, mixed, levels: new Set(col).size, lo, hi };
  };
  t.flat([0.3, 0.3, 0.3], 0.05); t.step();
  const on = scan(t.grab());
  const keep = U.uDither.value; U.uDither.value = 0; t.step();
  const off = scan(t.grab());
  U.uDither.value = keep;
  out.grad = { on, off };
  // the two 8-bit plateaus: a solid white and a solid black must come out exactly 255 and exactly 0 (the dither is
  // gated off there, so it can neither lift nor dip them)
  const plateau = (c) => { t.flat(c); t.step(); const d = t.grab(); const v = t.stats(t.patch(d, 200, 200, 96, 96)); return { min: v.min, max: v.max, mean: v.mean }; };
  out.solidWhite = plateau([20, 20, 20]);
  out.solidBlack = plateau([0, 0, 0]);
  t.clear(); t.step();
  return out;
});
check(dither.maxDev <= 1 && Math.abs(dither.mean - dither.ref) <= 0.5 && dither.levels > 1,
  `flat sky patch: ${dither.mean}/255 vs the flat colour ${dither.ref}, max deviation ${dither.maxDev}/255 (<= 1), ${dither.levels} levels (the 8x8 pattern), mean deviation ${Math.abs(dither.mean - dither.ref).toFixed(2)}/255`);
check(dither.grad.on.maxRun < dither.grad.off.maxRun && dither.grad.on.mixed > dither.grad.off.mixed && dither.grad.off.mixed === 0
  && Math.abs(dither.grad.on.levels - dither.grad.off.levels) <= 2,
  `dither does not band: down a 0.05 linear gradient the longest identical run is ${dither.grad.off.maxRun} rows without the dither and ${dither.grad.on.maxRun} rows with it; ${dither.grad.on.mixed} of ${dither.grad.on.steps} transition rows carry both levels side by side (${dither.grad.off.mixed} without the dither), ${dither.grad.off.levels} vs ${dither.grad.on.levels} levels, ${dither.grad.on.lo}..${dither.grad.on.hi}`);
check(dither.solidWhite.min === 255 && dither.solidWhite.max === 255 && dither.solidBlack.max === 0,
  `dither does not lift solid colours: a solid white comes out exactly ${dither.solidWhite.min}..${dither.solidWhite.max} and a solid black ${dither.solidBlack.min}..${dither.solidBlack.max} (0 deviating pixels)`);

// ---- 4. MSAA on the real target ----
const msaa = await page.evaluate(() => {
  const P = window.__t.P;
  const four = P.probeEdge(P.target.samples), one = P.probeEdge(0);
  window.__t.clear(); window.__t.step();
  return { four: { samples: four.samples, mid: four.intermediate, dark: four.dark, light: four.light, levels: four.levels },
    one: { samples: one.samples, mid: one.intermediate, dark: one.dark, light: one.light } };
});
console.log(`     (info) 45-degree edge, ${msaa.four.dark}/${msaa.four.light} pure pixels, blended values ${JSON.stringify(msaa.four.levels)} (x16)`);
check(msaa.four.samples === 4 && msaa.four.mid > 0, `MSAA on the composite target: samples ${msaa.four.samples}, ${msaa.four.mid} blended pixels on a high-contrast diagonal (> 0)`);
check(msaa.one.mid === 0, `the same edge with samples ${msaa.one.samples}: ${msaa.one.mid} blended pixels, so the count above is the MSAA and not the scene`);

// ---- 5. the composite: fighters, alpha, background ----
const comp = await page.evaluate(() => {
  const t = window.__t, r = window.__r, P = t.P;
  t.step();                                    // one fresh frame of the viewer's own path
  // freeze the built world: ONE snapshot of its canvas, fed to the same post pass for both frames. The world's own
  // camera / keep-out jitter (arena-built re-places when the fighters' bounds change) must not leak into a check that
  // is about the composite, so both frames get exactly the same world pixels.
  const snap = document.createElement("canvas"); snap.width = t.W; snap.height = t.H;
  snap.getContext("2d").drawImage(window.__builtCv, 0, 0);
  const alphaOf = () => {
    const c = new OffscreenCanvas(t.W, t.H), x = c.getContext("2d"); x.drawImage(window.__off, 0, 0);
    return x.getImageData(0, 0, t.W, t.H).data;
  };
  const draw = (world) => { P.render(world, window.__off); t.ctx.drawImage(P.canvas, 0, 0); };
  r.setPlayerVisible(true); r.setEnemyVisible(true); r.render(0);
  draw(snap); const shown = t.grab(), A = alphaOf();
  r.setPlayerVisible(false); r.setEnemyVisible(false); r.render(0);
  draw(snap); const hidden = t.grab();
  r.setPlayerVisible(true); r.setEnemyVisible(true);
  let diff = 0, outside = 0, insideBand = 0, rim = 0, bigOutside = 0;
  const bbox = [1e9, 1e9, -1e9, -1e9], outs = [];
  const alphaAt = (x, y) => A[(y * t.W + x) * 4 + 3];
  for (let i = 0, p = 0; i < shown.length; i += 4, p++) {
    const d = shown[i] !== hidden[i] || shown[i + 1] !== hidden[i + 1] || shown[i + 2] !== hidden[i + 2];
    const a = A[i + 3];
    if (d) { diff++; if (a === 0) { outside++; const x = p % t.W, y = Math.floor(p / t.W);
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y); bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
      const near = (x > 0 && alphaAt(x - 1, y) > 0) || (x < t.W - 1 && alphaAt(x + 1, y) > 0) || (y > 0 && alphaAt(x, y - 1) > 0) || (y < t.H - 1 && alphaAt(x, y + 1) > 0);
      if (near) rim++;
      if (Math.abs(shown[i] - hidden[i]) > 1 || Math.abs(shown[i + 1] - hidden[i + 1]) > 1 || Math.abs(shown[i + 2] - hidden[i + 2]) > 1) bigOutside++;
      if (outs.length < 8) outs.push({ x, y, rim: near, shown: [shown[i], shown[i + 1], shown[i + 2]], hidden: [hidden[i], hidden[i + 1], hidden[i + 2]] }); } }
    if (!d && a > 0) insideBand++;
  }
  // a point inside the silhouette (alpha > 128, changed) and one outside it
  let inPt = null, outPt = null;
  for (let p = 0; p < t.W * t.H && (!inPt || !outPt); p++) {
    const i = p * 4, x = p % t.W, y = Math.floor(p / t.W);
    const d = shown[i] !== hidden[i] || shown[i + 1] !== hidden[i + 1] || shown[i + 2] !== hidden[i + 2];
    if (!inPt && d && A[i + 3] > 128) inPt = { x, y, a: A[i + 3], shown: [shown[i], shown[i + 1], shown[i + 2]], hidden: [hidden[i], hidden[i + 1], hidden[i + 2]] };
  }
  outPt = { x: 20, y: 20, a: A[(20 * t.W + 20) * 4 + 3], shown: [shown[(20 * t.W + 20) * 4], shown[(20 * t.W + 20) * 4 + 1], shown[(20 * t.W + 20) * 4 + 2]], hidden: [hidden[(20 * t.W + 20) * 4], hidden[(20 * t.W + 20) * 4 + 1], hidden[(20 * t.W + 20) * 4 + 2]] };
  let alphaPixels = 0; for (let i = 3; i < A.length; i += 4) if (A[i] > 0) alphaPixels++;
  return { diff, outside, rim, bigOutside, alphaPixels, sameWhereNoAlpha: insideBand, inPt, outPt, bbox, outs, W: t.W, H: t.H };
});
console.log(`     (info) fighter canvas: ${comp.alphaPixels} pixels with alpha > 0 (${(comp.alphaPixels / (comp.W * comp.H) * 100).toFixed(1)}% of the frame)`);
if (comp.inPt) console.log(`     (info) inside the silhouette: (${comp.inPt.x}, ${comp.inPt.y}) alpha ${comp.inPt.a}, fighters shown ${comp.inPt.shown} vs hidden ${comp.inPt.hidden}`);
else console.log(`     (info) inside the silhouette: NO pixel with alpha > 128 changed`);
console.log(`     (info) outside the silhouette: (${comp.outPt.x}, ${comp.outPt.y}) alpha ${comp.outPt.a}, shown ${comp.outPt.shown} vs hidden ${comp.outPt.hidden}`);
console.log(`     (info) pixels that changed outside the fighter alpha: ${comp.outside}, bbox ${comp.bbox.join(",")}, e.g. ${JSON.stringify(comp.outs.slice(0, 4))}`);
check(comp.diff > 0 && comp.bigOutside === 0 && comp.outside - comp.rim === 0 && comp.outside <= comp.W * comp.H * 1e-4,
  `the composite differs only where a fighter is: ${comp.diff} pixels changed between fighters shown and hidden, ${comp.diff - comp.outside} inside the fighter canvas' alpha; of the ${comp.outside} on alpha-0 pixels every one is a 1/255 step on a texel touching the silhouette (${comp.rim} adjacent to a fighter pixel), ${(comp.outside / (comp.W * comp.H) * 100).toFixed(3)}% of the frame`);
check(comp.inPt && comp.inPt.shown.join() !== comp.inPt.hidden.join() && comp.outPt.shown.join() === comp.outPt.hidden.join(),
  `the fighters are drawn and the background survives: inside ${JSON.stringify(comp.inPt?.shown)} vs ${JSON.stringify(comp.inPt?.hidden)}, outside ${JSON.stringify(comp.outPt.shown)} vs ${JSON.stringify(comp.outPt.hidden)}`);

// ---- 6. frame time, the pass on vs the plain 2D composite (the ?post=0 path, proved below) ----
const timing = await page.evaluate((FRAMES) => {
  const t = window.__t, P = t.P, gl = P.gl, one = new Uint8Array(4);
  const r = window.__r, B = window.__built, ctx = t.ctx, gb = B.renderer.getContext();
  const on = () => { window.__renderFrame(t.T); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); };
  const offF = () => {                       // exactly the ?post=0 branch of the viewer's frame()
    r.setCameraMode(document.getElementById("cam").value, { scriptOwnsCamera: false });
    r.render(0); B.render(r.getCameraInfo()?.render);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, t.W, t.H);
    ctx.drawImage(window.__builtCv, 0, 0); ctx.drawImage(window.__off, 0, 0);
    gb.readPixels(0, 0, 1, 1, gb.RGBA, gb.UNSIGNED_BYTE, one);
  };
  const time = (f, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t0) / n; };
  time(on, 5); time(offF, 5);
  // Two blocks, alternating the two paths, so the block-to-block spread is visible instead of hidden in one number.
  const block = () => { const a = time(on, FRAMES), b = time(offF, FRAMES); return { on: a, off: b, d: a - b }; };
  const r1 = block(), r2 = block();
  return { frames: FRAMES, blocks: [r1, r2], withPost: (r1.on + r2.on) / 2, without: (r1.off + r2.off) / 2,
    calls: P.info.calls, passes: P.info.passes };
}, FRAMES);
// the unmasked renderer string was captured when the page opened (Chrome blanks it after a while)
const glInfo = await page.evaluate(() => window.__glInfo);
const programs = await page.evaluate(() => { const i = window.__post.renderer.info; return { count: i.programs.length, failed: i.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length }; });
await browser.close().catch(() => {});

console.log(`     (info) one post frame = ${timing.passes} passes, ${timing.calls} draw calls`);
console.log(`     (info) renderer: ${glInfo.renderer}${glInfo.vendor ? ` [${glInfo.vendor}]` : ""} (gl.RENDERER alone says "${glInfo.masked}")`);
check(programs.failed === 0, `shader programs compile: ${programs.count}, ${programs.failed} failed`);
{
  const [r1, r2] = timing.blocks;
  const res = 0.3;   // what this timer can resolve at 960x720: under this the delta is scheduling noise, not a cost
  const ds = [r1.d, r2.d], biggest = Math.max(Math.abs(r1.d), Math.abs(r2.d));
  console.log(`     (info) frame time at ${b.real.w}x${b.real.h}, two blocks of ${timing.frames} frames: post on ${r1.on.toFixed(2)} / ${r2.on.toFixed(2)} ms, plain 2D composite ${r1.off.toFixed(2)} / ${r2.off.toFixed(2)} ms, the look ${ds.map((d) => `${d >= 0 ? "+" : ""}${d.toFixed(2)}`).join(" / ")} ms/frame`
    + (biggest < res
      ? ` - both blocks under the ~${res} ms this timer resolves at this size (and the sign flips between runs), so the look is AT the measurement floor: this is an upper bound, not a measured cost`
      : ` - the larger of the two blocks is above the ~${res} ms this timer resolves at this size, so read it as the look's cost within +/- ${Math.abs(r1.d - r2.d).toFixed(2)} ms`));
}
check(timing.withPost > 0 && timing.without > 0, `frame time measured over 2x${timing.frames} frames: ${timing.withPost.toFixed(2)} ms with the post, ${timing.without.toFixed(2)} ms without`);

// ═════════════════════════ page 2: ?post=0 bypass ═════════════════════════
{
  const { browser: b2, page: p2 } = await open("&post=0");
  const bypass = await p2.evaluate(() => {
    const cv = document.getElementById("cv"), ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    window.__renderFrame(performance.now());
    const got = ctx.getImageData(0, 0, W, H).data;
    // the plain composite the viewer has always drawn: black, then the built canvas, then the fighters
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
    x.drawImage(window.__builtCv, 0, 0);
    x.drawImage(window.__off, 0, 0);
    const want = x.getImageData(0, 0, W, H).data;
    let diff = 0, maxd = 0;
    for (let i = 0; i < want.length; i++) { const d = Math.abs(got[i] - want[i]); if (d) { diff++; maxd = Math.max(maxd, d); } }
    return { diff, maxd, hasPost: window.__post != null, canvas: !!document.querySelector("canvas#cv") };
  });
  await b2.close().catch(() => {});
  check(bypass.diff === 0, `?post=0 bypass: the visible canvas IS the plain 2D composite, ${bypass.diff} differing bytes (max ${bypass.maxd})`);
  check(!bypass.hasPost, `?post=0 creates no post pass: window.__post = ${bypass.hasPost ? "a post object" : "null"}`);
}

for (const e of errors) console.log("   error:", e);
check(errors.length === 0, `errors: ${errors.length}`);
process.exit(fails ? 1 : 0);
