// Automatic COLOUR FIT of an arena's BUILT look to its HD Remaster render. Generic: no arena name, no layer list.
//   VERIFY_PORT=8090 [ARENA=meft1008] tools/verify-lock.sh tools/run-playwright.sh tools/fit_built_colours.mjs
// 1. renders hd + built from the camera poses of tools/compare_built_vs_hd.mjs (battle, 8 azimuths at eye height, 2 high views);
// 2. LAYERS are what arena-built.js really built (web/built/colourfit.js discovers every Mesh/Points/Line of the scene, grouped
//    by name). Per pose each layer is hidden in turn and the frame re-rendered: a pixel belongs to the layer whose removal
//    changes it most (> THR summed over rgb), so every pixel has a known owner (sky, trees, floor, lake, reeds, ...);
// 3. per layer, HD's colour stats over the layer's pixels (linear: mean, p10, p90, per channel) are matched by
//    lin' = gain * lin^gamma applied to the layer's final colour (closed form from the stats, re-rendered and re-solved
//    ITERS times, the best iteration kept per layer). A layer HD has nothing like (hiding it cuts the error to < 0.6 of
//    its own and it owns < 4% of the frame) is written as visible:false;
// 4. writes web/assets-hd/battle/built/<pack>.colours.json (git-ignored). The modules read it through web/built/colourfit.js
//    (no file = nothing patched = today's colours, bit for bit). A fresh page then loads that file and is compared with
//    the last iteration;
// 5. prints one row per layer: share of the frame, HD mean rgb, built before / after, mean |delta| before -> after.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1008";
const ITERS = +(process.env.ITERS || 6), THR = 12, MINPX = 1500, W = 960, H = 720;
const OUT = path.join(os.homedir(), "scratch-research", "compare", ARENA, "fit");
fs.mkdirSync(OUT, { recursive: true });
const url = (look) => `${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=${look}&p=m373rena&e=m051kuwa`;
const browser = await launch();
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

async function open(look, tool) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.addInitScript((tool) => { performance.now = () => globalThis.__tNow || 0; window.requestAnimationFrame = () => 0; if (tool) globalThis.__fitTool = true; }, tool);
  await page.goto(url(look));
  await page.waitForFunction(() => !!window.__renderFrame && !!window.__r && !!window.__viewerState, null, { timeout: 90000, polling: 200 });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate((look) => { window.__renderFrame(0); const B = window.__built; const r = window.__r;
      const fo = !!r.getFighterBounds("player") && !!r.getFighterBounds("enemy");
      return look === "built" ? (!!B && !B.missing && B.info.triangles > 0 && fo && (B.info.layers?.sand ? !!B.info.layers.sand.tex?.ready : true)) : fo; }, look);
    if (ok && i >= 15) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.selectOption("#cam", "free");
  for (let i = 0; i < 80 && !(await page.evaluate(() => { window.__renderFrame(0); return !!window.__tools.freeCam; })); i++) await new Promise((r) => setTimeout(r, 250));
  return { ctx, page, errors };
}

// ---- page side: frames, owners, histograms ----
const FIT = `(() => {
  const cv = document.getElementById("cv"), W = cv.width, H = cv.height, c2 = cv.getContext("2d");
  const grab = () => c2.getImageData(0, 0, W, H).data;
  const F = { poses: null, hd: [], own: [], ids: [] };
  const frame = (p) => { const fc = window.__tools.freeCam; fc.set(p.eye, p.look); fc.camera.fov = p.fov; fc.camera.updateProjectionMatrix();
    for (let i = 0; i < 4; i++) { globalThis.__tNow = 7000 + i * 16; window.__renderFrame(globalThis.__tNow); } };
  F.load = async (poses, urls) => { F.poses = poses; F.hd = [];
    for (const u of urls) { const im = new Image(); im.src = u; await im.decode(); const o = document.createElement("canvas"); o.width = W; o.height = H;
      const x = o.getContext("2d"); x.drawImage(im, 0, 0); F.hd.push(x.getImageData(0, 0, W, H).data); } return F.hd.length; };
  F.layerIds = () => window.__built.colourFit.ids();
  // owner pass: ids = the layers to test; returns per layer touched count and the error against HD with / without it
  F.masks = (ids) => { const cf = window.__built.colourFit; F.ids = ids; F.own = [];
    const K = ids.length, touched = new Float64Array(K), eWith = new Float64Array(K), eWithout = new Float64Array(K);
    for (let pi = 0; pi < F.poses.length; pi++) {
      frame(F.poses[pi]); const f = new Uint8ClampedArray(grab()), hd = F.hd[pi];
      const own = new Int16Array(W * H).fill(-1), best = new Int32Array(W * H);
      for (let k = 0; k < K; k++) {
        cf.setVisible(ids[k], false); frame(F.poses[pi]); const h = grab(); cf.setVisible(ids[k], true);
        for (let i = 0, j = 0; j < W * H; i += 4, j++) {
          const d = Math.abs(f[i] - h[i]) + Math.abs(f[i + 1] - h[i + 1]) + Math.abs(f[i + 2] - h[i + 2]);
          if (d > ${THR}) { touched[k]++; eWith[k] += Math.abs(f[i] - hd[i]) + Math.abs(f[i + 1] - hd[i + 1]) + Math.abs(f[i + 2] - hd[i + 2]);
            eWithout[k] += Math.abs(h[i] - hd[i]) + Math.abs(h[i + 1] - hd[i + 1]) + Math.abs(h[i + 2] - hd[i + 2]);
            if (d > best[j]) { best[j] = d; own[j] = k; } }
        }
      }
      F.own.push(own);
    }
    return { touched: [...touched], eWith: [...eWith], eWithout: [...eWithout] };
  };
  // histogram pass: per owner k (K = unowned), per source (0 built, 1 hd), per channel, 256 bins
  F.hist = () => { const K = F.ids.length, hist = new Int32Array((K + 1) * 2 * 3 * 256), luma = [];
    for (let pi = 0; pi < F.poses.length; pi++) {
      frame(F.poses[pi]); const f = grab(), hd = F.hd[pi], own = F.own[pi]; let lb = 0, lh = 0;
      for (let i = 0, j = 0; j < W * H; i += 4, j++) {
        const k = own[j] < 0 ? K : own[j], b = (k * 2) * 768, h = (k * 2 + 1) * 768;
        hist[b + f[i]]++; hist[b + 256 + f[i + 1]]++; hist[b + 512 + f[i + 2]]++;
        hist[h + hd[i]]++; hist[h + 256 + hd[i + 1]]++; hist[h + 512 + hd[i + 2]]++;
        lb += 0.2126 * f[i] + 0.7152 * f[i + 1] + 0.0722 * f[i + 2]; lh += 0.2126 * hd[i] + 0.7152 * hd[i + 1] + 0.0722 * hd[i + 2];
      }
      luma.push([lh / (W * H), lb / (W * H)]);
    }
    return { hist: Array.from(hist), luma }; };
  F.frameLuma = () => { const luma = []; for (const p of F.poses) { frame(p); const f = grab(); let l = 0;
    for (let i = 0; i < f.length; i += 4) l += 0.2126 * f[i] + 0.7152 * f[i + 1] + 0.0722 * f[i + 2]; luma.push(l / (W * H)); } return luma; };
  window.__fitTool2 = F;
})()`;

const GRAB_PNG = `(() => document.getElementById("cv").toDataURL("image/png"))()`;

// ---- HD side: the same poses as compare_built_vs_hd.mjs ----
const hd = await open("hd", false);
const base = await hd.page.evaluate(() => {
  const r = window.__r, fc = window.__tools.freeCam, a = r.getFighterBounds("player"), b = r.getFighterBounds("enemy");
  const c = [(a.center[0] + b.center[0]) / 2, 0, (a.center[2] + b.center[2]) / 2];
  const f = document.getElementById("fighters"); f.checked = false; f.dispatchEvent(new Event("change"));
  return { start: fc.start, centre: c, fov: fc.start.fovDeg, gy: Math.min(a.min[1], b.min[1]) };
});
const poses = [{ name: "battle", eye: base.start.eye, look: base.start.look, fov: base.fov }];
for (let k = 0; k < 8; k++) {
  const az = k * 45, s = Math.sin(az * Math.PI / 180), c = Math.cos(az * Math.PI / 180), e = [base.centre[0], base.gy + 680, base.centre[2]];
  poses.push({ name: `az${String(az).padStart(3, "0")}`, eye: e, look: [e[0] + s * 1000, e[1], e[2] + c * 1000], fov: base.fov });
}
const bd = [base.start.eye[0] - base.centre[0], base.start.eye[2] - base.centre[2]], bl = Math.hypot(...bd) || 1;
for (const [n, h, back] of [["high1", 4000, 2500], ["high2", 12000, 6000]])
  poses.push({ name: n, eye: [base.centre[0] + bd[0] / bl * back, base.gy + h, base.centre[2] + bd[1] / bl * back], look: [base.centre[0], base.gy, base.centre[2]], fov: base.fov });
const hdPng = [];
for (const p of poses) {
  hdPng.push(await hd.page.evaluate(async ([p, A]) => {
    const fc = window.__tools.freeCam; fc.set(p.eye, p.look); fc.camera.fov = p.fov; fc.camera.updateProjectionMatrix();
    for (let i = 0; i < 4; i++) { globalThis.__tNow = 7000 + i * 16; window.__renderFrame(globalThis.__tNow); }
    return eval(A);
  }, [p, GRAB_PNG]));
}
await hd.ctx.close();
console.log(`INFO hd poses ${poses.length}`);

// ---- built side ----
const bt = await open("built", true);
await bt.page.evaluate(() => { const f = document.getElementById("fighters"); f.checked = false; f.dispatchEvent(new Event("change")); });
await bt.page.evaluate(FIT);
await bt.page.evaluate(([p, u]) => window.__fitTool2.load(p, u), [poses, hdPng]);
const pack = await bt.page.evaluate(() => window.__built.info.pack);
let ids = await bt.page.evaluate(() => { window.__renderFrame(0); window.__renderFrame(7000); return window.__fitTool2.layerIds(); });
console.log(`INFO pack ${pack}; layers discovered (${ids.length}): ${ids.join(", ")}`);
// identity at start: every layer patched but off
for (const id of ids) await bt.page.evaluate((id) => window.__built.colourFit.set(id, { gain: [1, 1, 1], gamma: [1, 1, 1], on: 0 }), id);

const additive = await bt.page.evaluate((ids) => ids.map((id) => window.__built.colourFit.additive(id)), ids);
let M = await bt.page.evaluate((ids) => window.__fitTool2.masks(ids), ids);
const total = poses.length * W * H;
const hidden = [];
ids.forEach((id, k) => {
  const share = M.touched[k] / total;
  if (M.touched[k] < MINPX || share >= 0.04) return;
  if (M.eWithout[k] < 0.6 * M.eWith[k] || (additive[k] && M.eWithout[k] < 1.1 * M.eWith[k])) hidden.push(id);
});
if (process.env.TRACE) ids.forEach((id, k) => console.log(`  hide-test ${id}: touched ${M.touched[k]} eWith ${(M.eWith[k] / Math.max(1, M.touched[k])).toFixed(1)} eWithout ${(M.eWithout[k] / Math.max(1, M.touched[k])).toFixed(1)}`));
const share0 = Object.fromEntries(ids.map((id, k) => [id, M.touched[k] / total]));
if (hidden.length) {
  for (const id of hidden) await bt.page.evaluate((id) => window.__built.colourFit.setVisible(id, false), id);
  ids = ids.filter((i) => !hidden.includes(i));
  M = await bt.page.evaluate((ids) => window.__fitTool2.masks(ids), ids);   // owners again without the hidden layers
  console.log(`INFO hidden (HD has nothing like them): ${hidden.join(", ")}`);
}

// ---- stats ----
const lin = (v) => Math.pow(v / 255, 2.2);
function chanStats(h, off) {
  let n = 0, s = 0, sb = 0; for (let v = 0; v < 256; v++) { n += h[off + v]; s += h[off + v] * lin(v); sb += h[off + v] * v; }
  if (!n) return null;
  const q = (p) => { let a = 0; for (let v = 0; v < 256; v++) { a += h[off + v]; if (a >= p * n) return lin(v); } return 1; };
  return { n, mean: s / n, p10: q(0.1), p90: q(0.9), byte: sb / n };
}
function layerStats(hist, k) {
  const out = { built: [], hd: [] };
  for (let c = 0; c < 3; c++) { out.built.push(chanStats(hist, (k * 2) * 768 + c * 256)); out.hd.push(chanStats(hist, (k * 2 + 1) * 768 + c * 256)); }
  return out;
}
const lumaB = (a) => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
const enc = (x) => 255 * Math.pow(x, 1 / 2.2);
const err = (st) => st.built.reduce((s, b, c) => s + Math.abs(b.byte - st.hd[c].byte), 0) / 3;   // mean error, bytes (the table)
// selection score: mean error + half the p10 / p90 error (so the gamma stage can win when the spread matches better)
const score = (st) => st.built.reduce((s, b, c) => s + 2 * Math.abs(b.byte - st.hd[c].byte) + 0.5 * (Math.abs(enc(b.p10) - enc(st.hd[c].p10)) + Math.abs(enc(b.p90) - enc(st.hd[c].p90))), 0) / 3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const P = {};
ids.forEach((id) => { P[id] = { gain: [1, 1, 1], gamma: [1, 1, 1], best: null, first: null }; });
let lastLuma = null;
for (let it = 0; it <= ITERS; it++) {
  const R = await bt.page.evaluate(() => window.__fitTool2.hist());
  if (it === 0) lastLuma = R.luma;
  const hist = Int32Array.from(R.hist);
  const rows = [];
  ids.forEach((id, k) => {
    const st = layerStats(hist, k); if (!st.built[0] || !st.hd[0]) return;
    const n = st.built[0].n; if (n < MINPX) return;
    const e = err(st), sc = score(st), p = P[id];
    const rec = { it, e, sc, hdP10: st.hd.map((s) => enc(s.p10)), hdP90: st.hd.map((s) => enc(s.p90)), bytesB: st.built.map((s) => s.byte), bytesH: st.hd.map((s) => s.byte), n };
    p.first ||= rec;
    if (!p.best || sc < p.best.sc) p.best = { ...rec, gain: [...p.gain], gamma: [...p.gamma] };
    p.last = rec; (p.trace ||= []).push(`${e.toFixed(1)}/${sc.toFixed(1)}`); rows.push(id);
    if (it === ITERS) return;
    // two stages. it 0..2: GAIN only, per channel gain *= hd.mean / built.mean (in linear, from the byte means, so the
    // sRGB mean converges). it 3..: GAMMA from the log p10..p90 spread ratio (damped 0.5, kept in 0.75..1.4), then the
    // gain is re-matched to the mean the same way. Keeping the best iteration per layer makes a layer whose HD pixels are
    // other content (so no colour match is possible) end as "not improved" and stay out of the file.
    for (let c = 0; c < 3; c++) {
      const b = st.built[c], h = st.hd[c]; if (b.mean < 1e-4) continue;
      let d = 1;
      if (it >= 3) {
        const sb = Math.log(Math.max(b.p90, 2e-3) / Math.max(b.p10, 2e-3)), sh = Math.log(Math.max(h.p90, 2e-3) / Math.max(h.p10, 2e-3));
        if (sb > 0.3) d = clamp(Math.pow(sh / sb, 0.35), 0.9, 1.1);
      }
      // y' = hd.mean * (y / built.mean)^d  composed with the current  y = gain * lin^gamma
      const m = lin(h.byte) / Math.max(lin(b.byte), 1e-4), bm = Math.max(lin(b.byte), 1e-4);
      p.gain[c] = clamp(d === 1 ? p.gain[c] * m : lin(h.byte) * Math.pow(bm, -d) * Math.pow(p.gain[c], d), 0.2, 5);
      p.gamma[c] = clamp(p.gamma[c] * d, 0.75, 1.4);
    }
  });
  if (it < ITERS) for (const id of rows) await bt.page.evaluate(([id, g, m]) => window.__built.colourFit.set(id, { gain: g, gamma: m, on: 1 }), [id, P[id].gain, P[id].gamma]);
  console.log(`INFO iteration ${it}: mean layer error ${(rows.reduce((s, id) => s + P[id].last.e, 0) / Math.max(1, rows.length)).toFixed(2)} (bytes)`);
}
for (const id of ids) if (P[id].best) await bt.page.evaluate(([id, g, m]) => window.__built.colourFit.set(id, { gain: g, gamma: m, on: 1 }), [id, P[id].best.gain, P[id].best.gamma]);
const finalLuma = await bt.page.evaluate(() => window.__fitTool2.frameLuma());

// ---- table ----
const f1 = (a) => a.map((v) => v.toFixed(0)).join("/");
console.log("layer | frame share | HD mean rgb [HD p10 .. p90 rgb] | built before | built after | mean|delta| before -> after (bytes) | luma delta before -> after");
const layersOut = {};
for (const id of ids) {
  const p = P[id]; if (!p.best) { console.log(`${id}: skipped (< ${MINPX} px)`); continue; }
  const lb = lumaB(p.first.bytesB) - lumaB(p.first.bytesH), la = lumaB(p.best.bytesB) - lumaB(p.best.bytesH);
  if (process.env.TRACE) console.log(`  trace ${id}: ${p.trace.join(" ")}  gain ${p.best.gain.map((v) => v.toFixed(2))} gamma ${p.best.gamma.map((v) => v.toFixed(2))}`);
  console.log(`${id} | ${(p.first.n / total * 100).toFixed(1)}% | ${f1(p.first.bytesH)} [${f1(p.first.hdP10)} .. ${f1(p.first.hdP90)}] | ${f1(p.first.bytesB)} | ${f1(p.best.bytesB)} | ${p.first.e.toFixed(1)} -> ${p.best.e.toFixed(1)} | ${lb.toFixed(1)} -> ${la.toFixed(1)}`);
  if (p.best.sc < p.first.sc) layersOut[id] = { gain: p.best.gain.map((v) => +v.toFixed(4)), gamma: p.best.gamma.map((v) => +v.toFixed(4)), px: p.first.n, deltaBefore: +p.first.e.toFixed(2), deltaAfter: +p.best.e.toFixed(2), scoreBefore: +p.first.sc.toFixed(2), scoreAfter: +p.best.sc.toFixed(2) };
}
for (const id of hidden) { layersOut[id] = { visible: false }; console.log(`${id} | ${(share0[id] * 100).toFixed(2)}% | hidden (HD has nothing like it)`); }
const colours = { arena: ARENA, pack, tool: "tools/fit_built_colours.mjs", iterations: ITERS, layers: layersOut };
const file = path.resolve("web/assets-hd/battle/built", `${pack}.colours.json`);
fs.writeFileSync(file, JSON.stringify(colours, null, 1));
console.log(`INFO wrote ${file}: ${Object.keys(layersOut).length} layers`);
const lumaTable = poses.map((p, i) => `${p.name} hd ${lastLuma[i][0].toFixed(1)} built ${lastLuma[i][1].toFixed(1)} -> ${finalLuma[i].toFixed(1)}`);
console.log("INFO frame mean luma per pose (hd, built before -> after): " + lumaTable.join("; "));
await bt.ctx.close();

// ---- fresh page, no tool flag: only the file ----
const vf = await open("built", false);
await vf.page.evaluate(() => { const f = document.getElementById("fighters"); f.checked = false; f.dispatchEvent(new Event("change")); });
await vf.page.evaluate(FIT);
await vf.page.evaluate(([p, u]) => window.__fitTool2.load(p, u), [poses, hdPng]);
const fresh = await vf.page.evaluate(() => { window.__renderFrame(0); return window.__fitTool2.frameLuma(); });
const dev = Math.max(...fresh.map((l, i) => Math.abs(l - finalLuma[i])));
check(dev < 0.6, `fresh page loading only the file reproduces the tool's last frame luma: max deviation ${dev.toFixed(2)} (<0.6)`);
check(bt.errors.length === 0 && vf.errors.length === 0, `page errors: built ${bt.errors.length} fresh ${vf.errors.length} ${[...new Set([...bt.errors, ...vf.errors])].slice(0, 2).join(" | ")}`);
await vf.ctx.close(); await browser.close();
fs.writeFileSync(path.join(OUT, "fit.json"), JSON.stringify({ colours, lumaTable, hidden }, null, 1));
console.log(`${fails ? "FAIL" : "PASS"} ${fails} failed`);
process.exit(fails ? 1 : 0);
