// Numbers check of the biome asset gallery (web/biome-gallery.html). No pictures: counts and milliseconds only.
//   TAB=forest|shared|beach|lake|mountain|all   (default forest)   tab(s) to check; later steps reuse this unchanged
//   GRID=0     skip the per-page grid timing (faster)
//   FRAMES=120 frames per timing sample     BUDGET_MS=4  biome scene target (PASS/FAIL line only)
//   VERIFY_PORT=8090 tools/verify-lock.sh tools/run-playwright.sh tools/verify_biome_gallery.mjs
//   (anime) also runs every biome with "Use anime set" ON (same views + budget) and checks it defaults OFF.
// Checks per tab: page loads with zero console errors / failed requests; every asset of the tab builds (count, tris > 0);
// grid: ms/frame, draws, tris per page; biome: ms/frame (GPU timer if the browser has it, always render+gl.finish()),
// draws, tris from three's renderer.info at 3 camera views; species + instance counts.
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const TAB = process.env.TAB || "forest";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 120));
const BUDGET = Number(process.env.BUDGET_MS || 4);
const GRID = process.env.GRID !== "0";
const tabs = TAB === "all" ? ["forest", "beach", "lake", "mountain", "shared"] : TAB.split(",");

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + String(e.stack || e).slice(0, 600)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text().slice(0, 500)); });
page.on("requestfailed", (r) => errors.push("requestfailed " + (r.failure()?.errorText || "") + " " + r.url().slice(-90)));
page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url().slice(-90)}`); });
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

await page.goto(`${baseUrl(8090)}/biome-gallery.html?tab=${tabs[0] === "beach" || tabs[0] === "lake" || tabs[0] === "mountain" ? "shared" : tabs[0]}&mode=grid`);
await page.waitForFunction(() => window.__gallery, null, { timeout: 30000 });
await page.evaluate(() => window.__gallery.ready);
console.log("gpu mode:", gpuMode(), JSON.stringify(await page.evaluate(() => window.__gallery.rendererInfo())));

const report = {};
for (const tab of tabs) {
  const R = (report[tab] = {});
  const empty = await page.evaluate((t) => window.__gallery.TABS[t].entries.length === 0, tab);
  if (empty) { console.log(`SKIP ${tab}: no assets yet (later step)`); continue; }
  console.log(`\n===== TAB ${tab} =====`);
  // 1. every asset builds
  const all = await page.evaluate((t) => window.__gallery.loadAll(t), tab);
  R.assets = all;
  const bySrc = {}; for (const a of all.assets) { const k = `${a.source} | ${a.licence}`; bySrc[k] = (bySrc[k] || 0) + 1; }
  console.log(`assets: ${all.ok}/${all.total} build with triangles > 0`);
  for (const [k, n] of Object.entries(bySrc)) console.log(`  ${n}  ${k}`);
  const byCat = {}; for (const a of all.assets) (byCat[a.cat] ||= []).push(a);
  for (const [c, l] of Object.entries(byCat)) console.log(`  [${c}] ${l.length}: ` + l.map((a) => `${a.name} (${a.tris}t/${a.draws}d)`).join("; "));
  check(all.failed.length === 0, `${tab}: all ${all.total} assets build` + (all.failed.length ? " FAILED: " + JSON.stringify(all.failed) : ""));
  // 2. grid pages
  if (GRID) {
    await page.evaluate((t) => window.__gallery.setView(t, "grid"), tab);
    const pages = await page.evaluate(() => Math.ceil(window.__gallery.TABS[window.__gallery.state.tab].entries.length / window.__gallery.state.PAGE));
    const rows = [];
    for (let p = 0; p < pages; p++) {
      await page.evaluate(async (p) => { window.__gallery.state.page = p; await window.__gallery.setView(); }, p);
      const m = await page.evaluate((f) => window.__gallery.measure(f, 8), Math.min(FRAMES, 40));
      rows.push(m);
    }
    R.grid = rows;
    const mx = Math.max(...rows.map((r) => r.finishMeanMs)), av = rows.reduce((a, r) => a + r.finishMeanMs, 0) / rows.length;
    console.log(`grid: ${pages} pages, ms/frame mean ${av.toFixed(2)} max ${mx.toFixed(2)} | draws max ${Math.max(...rows.map((r) => r.draws))} | tris max ${Math.max(...rows.map((r) => r.tris))}`);
    check(true, `${tab}: grid mode built ${pages} pages`);
  }
  // 3. biome
  await page.evaluate((t) => window.__gallery.setView(t, "biome"), tab);
  const bi = await page.evaluate(() => ({ b: window.__gallery.biomeInfo(), bs: window.__gallery.buildStats }));
  const sp = bi.b?.species || [];
  console.log(`biome: build ${JSON.stringify(bi.bs[tab + "/biome"])} species ${sp.length} instances ${sp.reduce((a, s) => a + s.n, 0)} impostor species ${bi.b?.impostors}`);
  console.log("  " + sp.map((s) => `${s.name} x${s.n}`).join(", "));
  const views = [];
  for (let v = 0; v < 3; v++) {
    await page.evaluate((v) => window.__gallery.setCamera(v), v);
    const m = await page.evaluate((f) => window.__gallery.measure(f, 40), FRAMES);
    m.pixels = await page.evaluate(() => window.__gallery.sample());
    const lod = await page.evaluate(() => window.__gallery.biomeInfo()?.lod);
    if (lod) m.lod = lod;
    views.push(m);
    console.log(`  view ${v}: finish mean ${m.finishMeanMs} p50 ${m.finishP50Ms} p95 ${m.finishP95Ms} ms | GPU timer ${m.gpuMs ?? "unsupported"} ms | CPU submit ${m.cpuSubmitMs} ms | draws ${m.draws} | tris ${m.tris}`);
    console.log(`    pixels: luma ${m.pixels.meanLuma} std ${m.pixels.stdLuma} nearBlack ${m.pixels.nearBlack} top ${m.pixels.topRGB} mid ${m.pixels.midRGB} bottom ${m.pixels.bottomRGB}` + (m.lod ? ` | tree LOD bins ${JSON.stringify(m.lod)}` : ""));
    check(m.pixels.stdLuma > 8 && m.pixels.nearBlack < 0.4, `${tab}: view ${v} canvas is not blank (std ${m.pixels.stdLuma}, nearBlack ${m.pixels.nearBlack})`);
  }
  R.biome = { views, species: sp };
  if (tab === "lake") {   // mirror pass numbers: what the low-res reflection target holds, and how much it changes the water pixels
    const rc = await page.evaluate(async () => {
      const L = await import("./biome/lakeproc.js"), g = window.__gallery, r = g.renderer, bi = g.getBiome(), rt = bi.reflector.rt;
      g.setCamera(0); for (let i = 0; i < 6; i++) await new Promise((x) => requestAnimationFrame(x));
      const w = rt.width, h = rt.height, px = new Uint8Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, px);
      let s = 0, s2 = 0, n = 0; const half = [0, 0, 0, 0, 0, 0], hc = [0, 0];
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4, l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2], k = y < h / 2 ? 0 : 1; s += l; s2 += l * l; n++; half[k * 3] += px[i]; half[k * 3 + 1] += px[i + 1]; half[k * 3 + 2] += px[i + 2]; hc[k]++; }
      const m = s / n, on = g.sample(); L.reflection.on.value = 0; const off = g.sample(); L.reflection.on.value = 1;
      const lowRGB = half.slice(0, 3).map((v) => Math.round(v / hc[0])), upRGB = half.slice(3).map((v) => Math.round(v / hc[1]));
      return { size: [w, h], meanLuma: +m.toFixed(1), stdLuma: +Math.sqrt(s2 / n - m * m).toFixed(1), rtBottomHalfRGB: lowRGB, rtTopHalfRGB: upRGB, canvasMidOn: on.midRGB, canvasMidOff: off.midRGB, lumaOn: on.meanLuma, lumaOff: off.meanLuma, reflMs: bi.species && bi.reflector.ms };
    });
    console.log("  mirror pass:", JSON.stringify(rc));
    check(rc.stdLuma > 6, `lake: mirror target holds a scene (luma std ${rc.stdLuma})`);
    check(Math.abs(rc.lumaOn - rc.lumaOff) > 0.2 || rc.canvasMidOn.some((v, i) => Math.abs(v - rc.canvasMidOff[i]) > 1), "lake: reflection changes the water pixels (on vs off)");
  }
  const worst = Math.max(...views.map((v) => v.finishMeanMs));
  check(worst <= BUDGET, `${tab}: biome ms/frame worst view ${worst.toFixed(2)} <= ${BUDGET} (960x720)`);
  // 4. "Use anime set" toggle ON (default is OFF: checked above by every earlier number). Same views, same budget.
  {
    check(await page.evaluate(() => window.__gallery.state.anime === false), `${tab}: anime toggle defaults OFF`);
    const nAn = await page.evaluate((t) => window.__gallery.TABS[t].entries.filter((e) => e.cat === "Anime").length, tab);
    check(nAn > 0, `${tab}: Anime category in grid has ${nAn} entries`);
    await page.evaluate((t) => window.__gallery.setView(t, "biome"), tab);
    await page.evaluate(() => window.__gallery.setAnime(true));
    const ai = await page.evaluate(() => ({ b: window.__gallery.biomeInfo(), a: window.__gallery.animeInfo(), bs: window.__gallery.buildStats }));
    const asp = ai.b?.species || [], anSp = asp.filter((s) => s.name.startsWith("anime "));
    console.log(`anime ON: build ${JSON.stringify(ai.bs[tab + "/biome+anime"])} species ${asp.length} (anime ${anSp.length}, ${anSp.reduce((a, s) => a + s.n, 0)} instances) hidden groups: ${(ai.a?.hidden || []).join(", ")}`);
    check(anSp.length > 0 && (ai.a?.hidden || []).length > 0, `${tab}: anime ON adds ${anSp.length} species and hides ${(ai.a?.hidden || []).length} weaker groups`);
    const av = [];
    for (let v = 0; v < 3; v++) {
      await page.evaluate((v) => window.__gallery.setCamera(v), v);
      const m = await page.evaluate((f) => window.__gallery.measure(f, 40), FRAMES);
      m.pixels = await page.evaluate(() => window.__gallery.sample()); av.push(m);
      console.log(`  anime view ${v}: finish mean ${m.finishMeanMs} p95 ${m.finishP95Ms} ms | GPU timer ${m.gpuMs ?? "unsupported"} ms | draws ${m.draws} tris ${m.tris} | luma ${m.pixels.meanLuma} std ${m.pixels.stdLuma}`);
      check(m.pixels.stdLuma > 8 && m.pixels.nearBlack < 0.4, `${tab}: anime view ${v} canvas is not blank`);
    }
    R.anime = { views: av, species: anSp };
    const aw = Math.max(...av.map((v) => v.finishMeanMs));
    check(aw <= BUDGET, `${tab}: anime ON biome ms/frame worst view ${aw.toFixed(2)} <= ${BUDGET} (960x720)`);
    await page.evaluate(() => window.__gallery.setAnime(false));
  }
  console.log("renderer:", JSON.stringify(await page.evaluate(() => window.__gallery.rendererInfo())));
}
const ls = await page.evaluate(() => window.__gallery.loadStats);
console.log(`\nGLB requests ${ls.requested}, loaded ${ls.loaded}, failed ${ls.failed.length}`);
check(ls.failed.length === 0, "no asset file failed to load");
check(errors.length === 0, `zero console errors / failed requests (${errors.length})`);
for (const e of [...new Set(errors)].slice(0, 15)) console.log("  ! " + e);
await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
