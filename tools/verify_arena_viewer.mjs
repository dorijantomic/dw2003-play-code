// Numbers check of web/arena-viewer.html (no pictures): for ARENA (default meft1001) in each look, which arena sheet
// files the renderer fetched (HD Remaster must read assets-hd, Original must not), page errors, the share of lit
// canvas pixels, and that the player's own asset mode is put back after the page closes.
//   (Optional files the renderer always probes - slot_map.json, item_use_effects.json, throw_item_effects.json - 404 here as in battle-lab; not counted.)
// Then the BUILT look's layer panel on the beach arena (default meft1002, the only arena with sand/shore, water/sea,
// rock spires and seagulls):
//  - every beach switch exists only while the loaded arena's built world has that layer (built.info.layers), the
//    forest arena's panel has none of them, and they come back with the beach arena
//  - each switch hides exactly its own meshes (userData.kind sand/shore, water/sea, spire, gulls) and nothing else,
//    and turning it back on restores every mesh; all four off then on restores the whole world
//  - draw calls, triangles and frame time at 960x720, shown vs hidden per layer, and the whole built world total
//    (budget <= 10 ms/frame, BUDGET_MS); frame time is the built world's own render with a readPixels sync, FRAMES
//    samples per state (the GPU runs a frame in ~2 ms, so a delta under 0.3 ms is printed as within the timer's
//    noise, not as a cost)
//  - the switches are applied on change and once per newly loaded arena only, never every frame (__layers.stats())
//   VERIFY_PORT=8090 [ARENA=meft1001] [BUILT_ARENA=meft1002] [FOREST_ARENA=meft1013] [FRAMES=120] [BUDGET_MS=10]
//   tools/run-playwright.sh tools/verify_arena_viewer.mjs
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1001";
const BUILT_ARENA = process.env.BUILT_ARENA || "meft1002";
const FOREST_ARENA = process.env.FOREST_ARENA || "meft1013";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 120));   // frame-time sample per state
const BUDGET_MS = Number(process.env.BUDGET_MS || 10);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("assetMode", "authentic"); sessionStorage.setItem("seeded", "1"); } });
let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

// ---- 1. the two painted looks (unchanged): sheets, lit canvas, page errors, asset mode put back -------------------
for (const look of ["hd", "authentic"]) {
  const page = await ctx.newPage();
  const errors = [], sheets = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("response", (r) => { if (r.url().includes(`/battle/arenas/${ARENA}/`) && r.url().endsWith(".png")) sheets.push([r.status(), new URL(r.url()).pathname]); });
  await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=${look}`);
  await page.waitForTimeout(6000);
  const lit = await page.evaluate(() => {
    const c = document.getElementById("cv"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n / (c.width * c.height);
  });
  const status = await page.textContent("#status");
  const layersHidden = await page.evaluate(() => getComputedStyle(document.getElementById("layersRow")).display === "none");
  const hd = sheets.filter(([, p]) => p.includes("/assets-hd/")).length;
  const ok = errors.length === 0 && sheets.length > 0 && sheets.every(([s]) => s === 200) && lit > 0.2 && layersHidden
    && (look === "hd" ? hd === sheets.length : hd === 0);
  check(ok, `${look}: status "${status}", sheets ${sheets.length} (hd ${hd}), lit ${(lit * 100).toFixed(1)}%, errors ${errors.length}, layer panel hidden ${layersHidden}`);
  for (const [s, p] of sheets) console.log(`   ${s} ${p}`);
  for (const e of errors) console.log("   error:", e);
  await page.close();
}

// ---- 2. built look: the beach layers, their exactness, and the frame numbers --------------------------------------
const page = await ctx.newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 600)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
const builtUrl = `${baseUrl(8090)}/arena-viewer.html?arena=${BUILT_ARENA}&look=built`;
await page.goto(builtUrl);
await page.waitForFunction((p) => window.__built?.info?.pack === p && window.__built?.info?.triangles > 0, BUILT_ARENA, { timeout: 90000 }).catch(() => {});
if (!(await page.evaluate(() => !!window.__built?.scene))) {
  console.log(`FAIL built ${BUILT_ARENA} did not load (window.__built missing)`);
  for (const e of errors) console.log("   error:", e);
  await browser.close();
  process.exit(fails + 1);
}

// The beach switches exist only where the world has the layer; a recipe kind whose module did not load is a real
// defect (arena-built.js reports it in info.missingLayers), not something to skip silently.
const R = await page.evaluate(async ({ frames: FRAMES }) => {
  const B = window.__built, rr = window.__r;
  const gl = B.renderer.getContext(), one = new Uint8Array(4);
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  rr.render(0);
  let cam = rr.getCameraInfo()?.render;
  B.render(cam);
  const out = {
    pack: B.info.pack, layers: Object.keys(B.info.layers || {}), missing: B.info.missingLayers || [],
    W: B.renderer.domElement.width, H: B.renderer.domElement.height,
    canvas: { w: window.__builtCv.width, h: window.__builtCv.height },
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    base: { calls: B.info.calls, tris: B.info.triangles },
  };
  // frame time of the built world alone, with the GPU forced to finish (readPixels), as the other built checks do
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(10);
  out.base.ms = time(FRAMES);

  const meshes = []; B.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const vis = () => meshes.map((o) => o.visible);
  const baseVis = vis();
  out.meshes = meshes.length;
  out.base.visible = baseVis.filter(Boolean).length;
  // the panel as the user sees it: the switches actually in the DOM, in order, with their labels
  out.panel = [...document.querySelectorAll("#layers input[data-layer]")].map((i) => ({ key: i.dataset.layer, label: i.parentElement.textContent.trim(), checked: i.checked }));
  out.rows = window.__layers.rows();

  const DEF = {
    sand: (o) => o.userData.kind === "sand" || o.userData.kind === "shore",
    water: (o) => o.userData.kind === "water" || o.userData.kind === "sea",
    spires: (o) => o.userData.kind === "spire",
    gulls: (o) => o.userData.kind === "gulls",
  };
  const LABEL = { sand: "sand and shore", water: "water and sea", spires: "rock spires", gulls: "seagulls" };
  out.expectLabels = LABEL;
  out.layersRun = {};
  out.kinds = {};
  for (const m of meshes) { const k = m.userData.kind || m.name; out.kinds[k] = (out.kinds[k] || 0) + 1; }
  for (const [k, match] of Object.entries(DEF)) {
    if (!out.layers.includes(k)) continue;   // not in this arena: its switch must not exist (checked below)
    const input = document.querySelector(`#layers input[data-layer="${k}"]`);
    const r = { switch: !!input, label: input ? input.parentElement.textContent.trim() : null };
    out.layersRun[k] = r;
    if (!input) continue;
    const before = vis();
    const exp = meshes.map(match);
    B.render(cam); const on1 = { calls: B.info.calls, tris: B.info.triangles, ms: time(FRAMES) };
    input.click();
    const after = vis();
    const hidden = []; let othersChanged = 0, missed = 0;
    for (let i = 0; i < meshes.length; i++) {
      if (before[i] !== after[i]) { if (exp[i]) hidden.push(meshes[i].name || meshes[i].userData.kind); else othersChanged++; }
      if (exp[i] && after[i]) missed++;
    }
    r.hidden = hidden.length; r.exp = exp.filter(Boolean).length; r.othersChanged = othersChanged; r.missed = missed;
    r.checkedOff = input.checked === false && window.__layers.on[k] === false;
    B.render(cam); r.off = { calls: B.info.calls, tris: B.info.triangles, ms: time(FRAMES) };
    input.click();
    const back = vis();
    r.backOk = back.every((v, i) => v === before[i]);
    r.checkedOn = input.checked === true && window.__layers.on[k] === true;
    B.render(cam); r.on2 = { calls: B.info.calls, tris: B.info.triangles, ms: time(FRAMES) };
    // shown = the mean of the samples on either side of the hidden one: a linear clock ramp cancels out
    r.on = { calls: r.on2.calls, tris: r.on2.tris, ms: (on1.ms + r.on2.ms) / 2 };
    r.onRange = [on1.ms, r.on2.ms];
  }
  // everything off, then everything on: the whole world comes back exactly as it was
  const beach = Object.keys(DEF).filter((k) => out.layers.includes(k));
  for (const k of beach) document.querySelector(`#layers input[data-layer="${k}"]`).click();
  const offVis = vis();
  out.allOff = { hidden: offVis.filter((v) => !v).length, beachHidden: beach.map((k) => meshes.filter(DEF[k]).filter((m) => !m.visible).length),
                 allBeachOff: beach.every((k) => meshes.filter(DEF[k]).every((m) => !m.visible)),
                 othersChanged: meshes.filter((m, i) => m.visible !== baseVis[i] && !beach.some((k) => DEF[k](m))).length };
  for (const k of beach) document.querySelector(`#layers input[data-layer="${k}"]`).click();
  const onVis = vis();
  out.allOn = { back: onVis.every((v, i) => v === baseVis[i]), visible: onVis.filter(Boolean).length,
                allBeachOn: beach.every((k) => meshes.filter(DEF[k]).every((m) => m.visible)) };
  B.render(cam); out.total = { calls: B.info.calls, tris: B.info.triangles, ms: time(FRAMES) };

  // the switches must be applied on change only: 40 rendered frames must not re-apply the layers
  const s0 = window.__layers.stats();
  for (let i = 0; i < 40; i++) window.__renderFrame(performance.now());
  const s1 = window.__layers.stats();
  const first = document.querySelector("#layers input[data-layer]");
  first.click(); const s2 = window.__layers.stats(); first.click(); const s3 = window.__layers.stats();
  out.stats = { frames: s1.applies - s0.applies, toggle: s2.applies - s1.applies, untoggle: s3.applies - s2.applies,
                why: s3.why, applies: s3.applies };
  out.errors = 0;
  return out;
}, { frames: FRAMES });

console.log(`     built ${R.pack} at ${R.W}x${R.H} (built canvas ${R.canvas.w}x${R.canvas.h}), ${R.meshes} meshes (${R.base.visible} visible), renderer ${R.renderer}`);
console.log(`     layers loaded: ${R.layers.join(", ") || "none"}${R.missing.length ? `; MISSING: ${R.missing.map((m) => `${m.id} (${m.error})`).join(", ")}` : ""}`);
console.log(`     mesh kinds: ${Object.entries(R.kinds).map(([k, n]) => `${k} ${n}`).join(", ")}`);

// the four beach layers this task is about must be loaded when the recipe has their pieces
for (const k of ["sand", "water", "spires", "gulls"])
  check(R.layers.includes(k), `${k} layer loaded on ${R.pack} (info.layers has "${k}")`);
check(R.W === 960 && R.H === 720 && R.canvas.w === 960 && R.canvas.h === 720, `built world measured at ${R.W}x${R.H} (built canvas ${R.canvas.w}x${R.canvas.h})`);
check(R.errors === 0 && errors.length === 0, `built page errors: ${errors.length}${errors.length ? " " + errors[0] : ""}`);

// the panel: the base switches untouched and in order, then exactly the beach switches this world has
const panelKeys = R.panel.map((p) => p.key);
const BASE = ["trees", "blades", "ground", "bank", "rocks", "hills", "sky", "clouds"];
check(BASE.every((k, i) => panelKeys[i] === k), `panel keeps the ${BASE.length} base switches in order: ${BASE.join(", ")}`);
const beachKeys = panelKeys.filter((k) => !BASE.includes(k) && k !== "post" && k !== "digiLight");
check(JSON.stringify(beachKeys) === JSON.stringify(["sand", "water", "spires", "gulls"]),
  `panel shows exactly the beach switches this arena has: ${beachKeys.join(", ") || "none"} (post/digiLight excluded)`);
for (const p of R.panel.filter((p) => p.key in R.expectLabels))
  check(p.label === R.expectLabels[p.key] && p.checked === true, `switch "${p.label}" (${p.key}) labelled right and on by default`);

// each switch hides exactly its own meshes, nothing else, and everything comes back on
for (const [k, r] of Object.entries(R.layersRun)) {
  check(r.switch, `${k}: a switch exists in the panel`);
  if (!r.switch) continue;
  check(r.exp > 0 && r.hidden === r.exp && r.othersChanged === 0 && r.missed === 0 && r.checkedOff,
    `${k}: hides exactly its own ${r.exp} mesh(es) (${r.hidden} hidden, ${r.othersChanged} others changed, ${r.missed} missed)`);
  check(r.backOk && r.checkedOn, `${k}: back on restores every mesh exactly (${r.backOk ? "all match" : "MISMATCH"})`);
  const dc = r.on.calls - r.off.calls, dt = r.on.tris - r.off.tris, dms = r.on.ms - r.off.ms;
  console.log(`     ${k}: ${r.on.calls} calls / ${r.on.tris} tris shown, ${r.off.calls} / ${r.off.tris} hidden (delta ${dc} calls, ${dt} tris); `
    + `${r.on.ms.toFixed(2)} ms shown vs ${r.off.ms.toFixed(2)} ms hidden (delta ${dms >= 0 ? "+" : ""}${dms.toFixed(2)} ms${Math.abs(dms) < 0.3 ? ", within the 0.3 ms timer noise" : ""})`);
  check(dc >= 1 && dt >= 1, `${k}: measurable in the frame: ${dc} draw call(s), ${dt} triangle(s)`);
}
const a = R.allOff, b = R.allOn;
check(a.allBeachOff && a.othersChanged === 0, `all beach layers off: every beach mesh hidden, ${a.othersChanged} other meshes touched`);
check(b.back && b.allBeachOn && b.visible === R.base.visible, `all beach layers on again: ${b.visible} of ${R.meshes} meshes visible, exactly as before`);

// frame numbers: whole built world, both arenas
console.log(`     whole built world ${R.pack}: ${R.total.calls} draw calls, ${R.total.tris} triangles, ${R.total.ms.toFixed(2)} ms/frame (all layers on)`);
check(R.total.calls === R.base.calls && R.total.tris === R.base.tris && R.total.ms <= BUDGET_MS,
  `whole built world ${R.pack} at ${R.W}x${R.H}: ${R.total.calls} draw calls, ${R.total.tris} triangles, ${R.total.ms.toFixed(2)} ms/frame (<= ${BUDGET_MS} ms)`);

// the switches do not fire every frame
check(R.stats.frames === 0, `40 rendered frames re-apply nothing (layer applies +${R.stats.frames}, last reason "${R.stats.why}")`);
check(R.stats.toggle === 1 && R.stats.untoggle === 1, `a switch applies the layers once per change (+${R.stats.toggle} off, +${R.stats.untoggle} on)`);

// ---- 3. another arena: the beach switches go away and come back, one apply per load ---------------------------------
const s0 = await page.evaluate(() => window.__layers.stats());
await page.evaluate((pack) => {
  const s = document.getElementById("arena");
  s.value = [...s.options].find((o) => o.textContent.startsWith(pack)).value;
  s.dispatchEvent(new Event("change"));
}, FOREST_ARENA);
await page.waitForFunction((p) => window.__built?.info?.pack === p && window.__built?.info?.triangles > 0, FOREST_ARENA, { timeout: 90000 }).catch(() => {});
const F = await page.evaluate(async ({ frames: FRAMES, budget: BUDGET_MS }) => {
  const B = window.__built, rr = window.__r;
  const gl = B.renderer.getContext(), one = new Uint8Array(4);
  rr.render(0); const cam = rr.getCameraInfo()?.render;
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(10);
  return {
    pack: B.info.pack, layers: Object.keys(B.info.layers || {}),
    panel: [...document.querySelectorAll("#layers input[data-layer]")].map((i) => i.dataset.layer),
    calls: B.info.calls, tris: B.info.triangles, ms: time(FRAMES), W: B.renderer.domElement.width, H: B.renderer.domElement.height,
    stats: window.__layers.stats(), rows: window.__layers.rows(),
  };
}, { frames: FRAMES, budget: BUDGET_MS });
const forestBeach = F.panel.filter((k) => ["sand", "water", "spires", "gulls"].includes(k));
check(F.pack === FOREST_ARENA && F.layers.length === 0 && forestBeach.length === 0 && F.rows.length === 0,
  `forest arena ${F.pack}: no beach layers loaded (${F.layers.length}) and no beach switches in the panel (${forestBeach.join(", ") || "none"})`);
check(F.panel.slice(0, 8).join(",") === BASE.join(","), `forest arena keeps the 8 base switches: ${F.panel.join(", ")}`);
check(F.stats.applies - s0.applies === 1 && F.stats.why === "arena",
  `one layer apply for the new arena (+${F.stats.applies - s0.applies}, reason "${F.stats.why}"), not one per frame`);
console.log(`     whole built world ${F.pack}: ${F.calls} draw calls, ${F.tris} triangles, ${F.ms.toFixed(2)} ms/frame at ${F.W}x${F.H} (all layers on)`);
check(F.calls > 0 && F.tris > 0 && F.ms <= BUDGET_MS, `whole built world ${F.pack}: ${F.ms.toFixed(2)} ms/frame (<= ${BUDGET_MS} ms)`);

// back to the beach arena: the switches return with the world, again one apply
const s1 = await page.evaluate(() => window.__layers.stats());
await page.evaluate((pack) => {
  const s = document.getElementById("arena");
  s.value = [...s.options].find((o) => o.textContent.startsWith(pack)).value;
  s.dispatchEvent(new Event("change"));
}, BUILT_ARENA);
await page.waitForFunction((p) => window.__built?.info?.pack === p && window.__built?.info?.triangles > 0, BUILT_ARENA, { timeout: 90000 }).catch(() => {});
const back = await page.evaluate(() => ({
  pack: window.__built?.info?.pack,
  panel: [...document.querySelectorAll("#layers input[data-layer]")].map((i) => i.dataset.layer),
  rows: window.__layers.rows(), stats: window.__layers.stats(),
  allOn: Object.values(window.__layers.on).every(Boolean),
}));
const backBeach = back.panel.filter((k) => ["sand", "water", "spires", "gulls"].includes(k));
check(back.pack === BUILT_ARENA && JSON.stringify(backBeach) === JSON.stringify(["sand", "water", "spires", "gulls"]),
  `beach switches return with ${back.pack}: ${backBeach.join(", ")}`);
check(back.stats.applies - s1.applies === 1 && back.allOn, `one layer apply for the beach arena (+${back.stats.applies - s1.applies}), every switch on`);

const probe = await ctx.newPage();
await probe.goto(`${baseUrl(8090)}/assets/battle/arenas/manifest.json`);
const mode = await probe.evaluate(() => localStorage.getItem("assetMode"));
check(mode === "authentic", `asset mode put back: ${mode}`);
for (const e of errors) console.log("   error:", e);
console.log(`${checks - fails} of ${checks} checks passed${errors.length ? `, ${errors.length} page error(s)` : ""}`);
await browser.close();
process.exit(fails ? 1 : 0);
