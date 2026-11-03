// Numbers check of PLACEMENT + ASSETS (web/built/place/*.js slot data, registry.js asset factories, slots.js binder,
// arena-slots-ui.js panel, tools/swap_asset.mjs file path) on meft1008 / meft1013 / meft1002.
//   MODE=baseline  save the default frame of each arena (run this on the code BEFORE a refactor)
//   (default)      1 default frames == baseline (1 frame in BASE_DIR; 7 camera poses in FRAMES_BASE, made by slots_frames.mjs OUT=)
//                  2 registry count by source
//                  3 every registry asset binds into one slot of every slot kind on all three arenas (errors, gl errors, no-mesh),
//                    then resetAll == default
//                  4 a tree swap rebuilds the lake reflection (meft1008 mirror copies: rebuilds, signature numbers)
//                  5 a rock swap keeps the rock shader (the module rock assets swapped between the rock slots: uniform present, linked)
//                  6 swap by UI API / DOM clicks / tools/swap_asset.mjs: frame changes, survives reload, file == UI frame
//                  7 reset: slot reset, the page's Reset button (confirm; also hides older file swaps), swap_asset reset
//                  8 every slot of every arena takes an asset; resetAll == baseline   9 frame time 960x720 default vs swapped
//   VERIFY_PORT=8090 tools/verify-lock.sh tools/run-playwright.sh tools/verify_slots.mjs
//   [BASE_DIR=/tmp/dw2003-slots-baseline] [FRAMES_BASE=$HOME/slots-base] [ONLY=1,3,...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { launch } from "./verify-launch.mjs";
import { openViewer, grab, diff } from "./verify_slots_frame.mjs";
import { arenaFrames } from "./slots_frames.mjs";

const DIR = process.env.BASE_DIR || "/tmp/dw2003-slots-baseline";
const FB = process.env.FRAMES_BASE || path.join(os.homedir(), "slots-base");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
const run = (n) => !ONLY || ONLY.has(n);
const ARENAS = ["meft1008", "meft1013", "meft1002"];
const A = "meft1013", TREE = "foliage.broadleaf", ROCK = "ground.rocks", SWAP = "built.pine";
const FILES = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../web/assets-hd/battle/built");
fs.mkdirSync(DIR, { recursive: true });
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const browser = await launch();
const swap = (...a) => execFileSync(process.execPath, ["tools/swap_asset.mjs", ...a], { encoding: "utf8" }).trim();
const READY = () => window.__renderFrame && window.__built && !window.__built.missing && window.__tools?.tuner && window.__slotsUI;
const ready = async (page) => { await page.waitForFunction(READY, null, { timeout: 120000, polling: 250 }); await page.waitForTimeout(1500); };

if (process.env.MODE === "baseline") {
  for (const arena of ARENAS) {
    const { page } = await openViewer(browser, arena); await page.waitForTimeout(2500);
    fs.writeFileSync(`${DIR}/${arena}.rgba`, await grab(page, 3)); console.log("baseline saved", arena); await page.context().close();
  }
  await browser.close(); process.exit(0);
}
swap("reset", A);   // a clean file for the checks

// ---- 1 default frames == baseline
if (run(1)) for (const arena of ARENAS) {
  const f = `${DIR}/${arena}.rgba`, { page, errors } = await openViewer(browser, arena); await page.waitForTimeout(2500);
  const fr = await grab(page, 3);
  if (!fs.existsSync(f)) { fs.writeFileSync(f, fr); console.log("no baseline for", arena, "- saved now"); }
  const d = diff(fr, fs.readFileSync(f));
  check(d.max === 0 && d.count === 0, `1 ${arena} default frame vs baseline: max diff ${d.max}, differing bytes ${d.count}, page errors ${errors.length}`);
  await page.context().close();
  if (fs.existsSync(`${FB}/${arena}_default.rgba.gz`)) {
    const { frames, errors: e2 } = await arenaFrames(browser, arena);
    let same = 0, worst = 0;
    for (const { pose, buf } of frames) { const g = diff(buf, zlib.gunzipSync(fs.readFileSync(`${FB}/${arena}_${pose}.rgba.gz`))); if (!g.count) same++; worst = Math.max(worst, g.max); }
    check(same === frames.length && !e2.length, `1 ${arena} ${frames.length} camera poses vs ${FB}: identical ${same}/${frames.length}, max diff ${worst}, page errors ${e2.length}`);
  }
}

// ---- 2 registry; 3 every asset into one slot of every kind, all three arenas
let assets = [];
for (const arena of ARENAS) {
  if (!run(2) && !run(3)) break;
  const { page } = await openViewer(browser, arena); await page.waitForTimeout(1500);
  if (!assets.length) {
    assets = await page.evaluate(async () => (await import("./built/registry.js")).listAllAssets());
    const by = {}; for (const a of assets) { const k = a.group + (a.sourceGroup ? ":" + a.sourceGroup : ""); by[k] = (by[k] || 0) + 1; }
    if (run(2)) check(assets.length > 100, `2 registry: ${assets.length} assets ${JSON.stringify(by)}`);
  }
  if (!run(3)) { await page.context().close(); continue; }
  await grab(page, 1);
  const f0 = await grab(page, 2);
  const kinds = await page.evaluate(() => { const k = {}; for (const s of window.__built.slots.list()) k[s.kind] ||= s.id; return k; });
  const pageErrs = []; page.on("pageerror", (e) => pageErrs.push(String(e).slice(0, 160)));
  const t0 = Date.now(), tally = []; let total = 0, okAll = 0, glAll = 0, emptyAll = 0;
  for (const [kind, slot] of Object.entries(kinds)) {
    const r = await page.evaluate(async ([slot, ids]) => {
      const B = window.__built, gl = B.renderer.getContext(), out = { ok: 0, gl: [], bad: [], empty: [] };
      for (const id of ids) {
        while (gl.getError()) {}
        try {
          await B.slots.bind(slot, id); window.__renderFrame(5000);
          const s = B.slots.get(slot), e = gl.getError();
          if (e) out.gl.push(`${id}:${e}`);
          const n = (s.inst?.objects?.length || 0) + (s.inst?.meshes?.length || 0);
          if (!n && id !== "none" && (s.cur || s.items)?.n) out.empty.push(id);
          out.ok++;
        } catch (e) { out.bad.push(`${id}: ${String(e?.message || e).slice(0, 100)}`); }
      }
      await B.slots.reset(slot);
      return out;
    }, [slot, assets.map((a) => a.id)]);
    total += assets.length; okAll += r.ok; glAll += r.gl.length; emptyAll += r.empty.length;
    tally.push(`${kind}(${slot}) ${r.ok}/${assets.length}${r.gl.length ? " gl " + r.gl.length : ""}${r.empty.length ? " empty " + r.empty.length : ""}`);
    for (const x of [...r.bad.slice(0, 3), ...r.gl.slice(0, 3).map((g) => "gl " + g), ...r.empty.slice(0, 3).map((g) => "empty " + g)]) console.log(`   ${arena} ${slot}: ${x}`);
  }
  await page.evaluate(() => window.__built.slots.resetAll());
  const fR = await grab(page, 2), dR = diff(f0, fR);
  check(okAll === total && !glAll && !emptyAll && !pageErrs.length && dR.count === 0,
    `3 ${arena}: ${Object.keys(kinds).length} slot kinds x ${assets.length} assets: bound ${okAll}/${total}, gl errors ${glAll}, no-mesh ${emptyAll}, page errors ${pageErrs.length}, resetAll diff ${dR.max}, ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`   ${tally.join(" | ")}`);
  if (pageErrs.length) console.log("   page errors:", pageErrs.slice(0, 3).join(" | "));
  await page.context().close();
}

// ---- 4 a tree swap changes the lake reflection (meft1008)
if (run(4)) {
  const { page } = await openViewer(browser, "meft1008"); await page.waitForTimeout(2000);
  await grab(page, 1);
  const sig = () => page.evaluate(() => {
    const B = window.__built, inst = B.slots.instanceOf("mirror.lake"); let n = 0, sum = 0, tris = 0;
    for (const o of inst?.objects || []) o.traverse((m) => {
      if (!m.isMesh) return; n++;
      const p = m.geometry.attributes.position; tris += ((m.geometry.index ? m.geometry.index.count : p.count) / 3) * (m.isInstancedMesh ? m.count : 1);
      for (let i = 0; i < p.array.length; i += 97) sum += p.array[i];
      if (m.instanceMatrix) for (let i = 0; i < m.count * 16; i += 13) sum += m.instanceMatrix.array[i];
      m.updateWorldMatrix(true, false); sum += m.matrixWorld.elements[12] + m.matrixWorld.elements[13] * 3 + m.matrixWorld.elements[14] * 7;
    });
    return { n, tris: Math.round(tris), sum: +sum.toFixed(3), real: !!B.slots.get("mirror.lake")?.data?.real };
  });
  const s0 = await sig();
  const rebuilt = await page.evaluate(async () => {
    const B = window.__built; let k = 0; const off = B.slots.on((id) => { if (id === "mirror.lake") k++; });
    await B.slots.bind("trees.wall", "built.pine"); await B.slots.idle(); window.__renderFrame(5000); off(); return k;
  });
  const s1 = await sig();
  await page.evaluate(async () => { await window.__built.slots.reset("trees.wall"); await window.__built.slots.idle(); window.__renderFrame(5000); });
  const s2 = await sig();
  check(s0.real || (rebuilt >= 1 && s1.sum !== s0.sum && s2.sum === s0.sum && s2.tris === s0.tris),
    `4 meft1008 trees.wall -> built.pine: lake ${s0.real ? "real (planar)" : "mirrored copies"}, mirror rebuilds ${rebuilt}, ` +
    `meshes ${s0.n} -> ${s1.n} -> ${s2.n}, triangles ${s0.tris} -> ${s1.tris} -> ${s2.tris}, signature ${s0.sum} -> ${s1.sum} -> back ${s2.sum}`);
  await page.context().close();
}

// ---- 5 a rock swap keeps the rock shader: each module rock asset in another arena's rock slot
if (run(5)) {
  const cases = [["meft1013", ROCK, "mod.spires", "uStrataFreq"], ["meft1002", "spires.rock", "mod.ground_rocks", "uMoss"],
                 ["meft1013", ROCK, "mod.boulder_piles", "uRockGrain"], ["meft1008", "boulders.piles", "mod.spires", "uStrataFreq"]];
  for (const [arena, slot, asset, uni] of cases) {
    const { page, errors } = await openViewer(browser, arena); await page.waitForTimeout(1500);
    await grab(page, 1);
    const r = await page.evaluate(async ([slot, asset, uni]) => {
      const B = window.__built, gl = B.renderer.getContext(); while (gl.getError()) {}
      await B.slots.bind(slot, asset); await B.slots.idle(); window.__renderFrame(5000);
      const s = B.slots.get(slot), meshes = new Set();
      for (const o of s.inst?.objects || []) o.traverse((m) => { if (m.isMesh) meshes.add(m); });
      let withU = 0, inst = 0, linked = 0;
      for (const m of meshes) {
        const mt = Array.isArray(m.material) ? m.material[0] : m.material;
        if (mt?.uniforms?.[uni]) withU++;
        if (m.isInstancedMesh) inst++;
        const cp = B.renderer.properties.get(mt)?.currentProgram;
        if (cp && gl.getProgramParameter(cp.program, gl.LINK_STATUS)) linked++;
      }
      return { meshes: meshes.size, withU, inst, linked, bound: B.slots.list().find((x) => x.id === slot).bound, gl: gl.getError() };
    }, [slot, asset, uni]);
    check(r.bound === asset && r.withU > 0 && r.linked === r.meshes && !r.gl && !errors.length,
      `5 ${arena} ${slot} <- ${asset}: meshes ${r.meshes} (instanced ${r.inst}), with ${uni} ${r.withU}, programs linked ${r.linked}, gl error ${r.gl}, page errors ${errors.length}`);
    await page.context().close();
  }
}

// ---- 6/7 swap by UI API, DOM clicks, file; reload; reset
if (run(6) || run(7)) {
  const base = fs.readFileSync(`${DIR}/${A}.rgba`);
  const { page } = await openViewer(browser, A); await page.waitForTimeout(2000);
  let dialogs = 0, accept = true; page.on("dialog", (d) => { dialogs++; accept ? d.accept() : d.dismiss(); });
  await grab(page, 1);
  const f0 = await grab(page, 2);
  const ok = await page.evaluate(([s, a]) => window.__slotsUI.choose(s, a), [TREE, SWAP]);
  const f1 = await grab(page, 2), d01 = diff(f0, f1);
  check(ok && d01.count > 0, `6a UI API swap ${TREE} -> ${SWAP}: frame changed in ${d01.count} bytes (max ${d01.max})`);
  const st = await page.evaluate(() => window.__viewerState.get().slots);
  check(st?.[A]?.[TREE] === SWAP, `6b choice remembered per arena in the viewer state: ${JSON.stringify(st)}`);
  await page.reload(); await ready(page);
  const f2 = await grab(page, 2), d12 = diff(f1, f2);
  check(d12.count === 0, `6c after reload the swapped frame is identical: diff ${d12.max}`);
  await page.evaluate((s) => window.__slotsUI.resetSlot(s), TREE);
  const f3 = await grab(page, 2), d03 = diff(f0, f3);
  check(d03.count === 0, `7a reset this slot: frame == default, diff ${d03.max}`);
  // DOM: slot row -> Replace... -> gallery card -> the row's reset button
  await page.evaluate(() => { window.__slotsUI.renderList(); document.getElementById("slotsPanel").open = true; });
  await page.click(`#slotsList .slotRow[data-slot="${TREE}"] .replace`);
  await page.waitForSelector("#slotGal .card", { timeout: 60000 });
  await page.fill("#galSearch", "fluffy bush");
  const cards = await page.$$eval("#slotGal .card", (c) => c.map((x) => x.dataset.asset));
  await page.click(`#slotGal .card[data-asset="built.bush"]`);
  await page.evaluate(() => window.__built.slots.idle()); await page.waitForTimeout(300);
  const f4 = await grab(page, 2), d04 = diff(f0, f4);
  const bound = await page.evaluate((s) => window.__built.slots.list().find((x) => x.id === s)?.bound, TREE);
  check(bound === "built.bush" && d04.count > 0, `6d DOM: Replace... gallery (${cards.length} cards for "fluffy bush") click -> bound ${bound}, frame changed ${d04.count} bytes`);
  await page.click(`#slotsList .slotRow[data-slot="${TREE}"] .reset`);
  const f5 = await grab(page, 2), d05 = diff(f0, f5);
  check(d05.count === 0, `7b DOM reset button of the slot: diff ${d05.max}`);
  // the page's Reset: Cancel keeps everything, OK clears the choices
  await page.evaluate(([s, a]) => window.__slotsUI.choose(s, a), [TREE, SWAP]);
  accept = false; await page.click("#resetAll"); await page.waitForTimeout(500);
  const kept = await page.evaluate((s) => window.__built.slots.list().find((x) => x.id === s)?.bound, TREE);
  const url = page.url(); accept = true; await page.click("#resetAll"); await page.waitForURL((u) => !u.search, { timeout: 60000 });
  await page.goto(url); await ready(page);   // Reset opens the page without parameters; the arena again by URL
  const left = await page.evaluate(() => { try { return localStorage.getItem("dw2003.arenaViewer.state.v1"); } catch { return "x"; } });
  const fRes = await grab(page, 2), dRes = diff(f0, fRes);
  check(dialogs === 2 && kept === SWAP && (!left || !JSON.parse(left).slots) && dRes.count === 0,
    `7c the page's Reset asks (${dialogs} dialogs): Cancel keeps the swap (${kept}), OK clears the choices (saved state ${left ? "has no slots" : "removed"}), frame == default (diff ${dRes.max})`);
  await page.context().close();

  // file path: swap_asset.mjs set -> a fresh context shows the swap, equal to the UI frame
  {   // what `swap_asset.mjs list` writes (the slot ids and the asset index), from this page
    const p = (await openViewer(browser, A)).page; await p.waitForTimeout(1000);
    const out = await p.evaluate(async () => ({ placements: window.__built.slots.exportPlacements(), assets: await (await import("./built/registry.js")).listAllAssets() }));
    fs.writeFileSync(path.join(FILES, `${A}.placements.json`), JSON.stringify(out.placements));
    fs.writeFileSync(path.join(FILES, "_assets.index.json"), JSON.stringify(out.assets));
    await p.context().close();
  }
  console.log("   " + swap("set", A, TREE, SWAP));
  const p2 = (await openViewer(browser, A)).page; await p2.waitForTimeout(2000);
  let dlg2 = 0; p2.on("dialog", (d) => { dlg2++; d.accept(); });
  await grab(p2, 1);
  const f6 = await grab(p2, 2), d06 = diff(f0, f6), d16 = diff(f1, f6);
  check(d06.count > 0 && d16.count === 0, `6e swap_asset.mjs set: frame changed ${d06.count} bytes vs default, identical to the UI swap (diff ${d16.max})`);
  await p2.reload(); await ready(p2);
  const f7 = await grab(p2, 2), d67 = diff(f6, f7);
  check(d67.count === 0, `6f the file swap survives reload: diff ${d67.max}`);
  // the page's Reset also hides the file's swap (written before the reset); a newer `set` shows again
  const url2 = p2.url(); await p2.click("#resetAll"); await p2.waitForURL((u) => !u.search, { timeout: 60000 }); await p2.goto(url2); await ready(p2);
  const f9 = await grab(p2, 2), d09 = diff(f0, f9);
  const fileStill = swap("show", A).includes(SWAP);
  await p2.waitForTimeout(20);
  console.log("   " + swap("set", A, TREE, SWAP));
  await p2.reload(); await ready(p2);
  const f10 = await grab(p2, 2), d10 = diff(f1, f10);
  check(dlg2 === 1 && d09.count === 0 && fileStill && d10.count === 0,
    `7d page Reset with a file swap: ${dlg2} dialog, frame == default (diff ${d09.max}), file kept (${fileStill}); a newer swap_asset set shows again (diff to the UI swap ${d10.max})`);
  await p2.context().close();
  console.log("   " + swap("reset", A));
  const p3 = (await openViewer(browser, A)).page; await p3.waitForTimeout(2000);
  const f8 = await grab(p3, 3), d8 = diff(f0, f8), d8b = diff(base, f8);
  check(d8.count === 0 && d8b.count === 0, `7e swap_asset.mjs reset: frame == default (diff ${d8.max}) == baseline (diff ${d8b.max})`);
  await p3.context().close();
}

// ---- 8 every slot of every arena takes an asset; resetAll == baseline
if (run(8)) for (const arena of ARENAS) {
  const { page } = await openViewer(browser, arena); await page.waitForTimeout(2000);
  await grab(page, 1);
  const f0 = await grab(page, 2);
  const res = await page.evaluate(async () => {
    const B = window.__built, gl = B.renderer.getContext(), out = { slots: 0, ok: 0, bad: [] };
    for (const s of B.slots.list()) {
      out.slots++; while (gl.getError()) {}
      try { await B.slots.bind(s.id, s.surface ? "surface.stone" : "built.cobble"); window.__renderFrame(5000); if (gl.getError()) throw new Error("gl error"); out.ok++; }
      catch (e) { out.bad.push(s.id + ": " + String(e.message || e).slice(0, 80)); }
    }
    return out;
  });
  const fS = await grab(page, 2), dS = diff(f0, fS);
  await page.evaluate(() => window.__built.slots.resetAll());
  const fR = await grab(page, 2), dR = diff(f0, fR), dB = diff(fs.readFileSync(`${DIR}/${arena}.rgba`), fR);
  check(res.ok === res.slots && dS.count > 0 && dR.count === 0 && dB.count === 0,
    `8 ${arena}: ${res.ok}/${res.slots} slots took an asset (${res.bad.join("; ")}), frame changed ${dS.count} bytes, resetAll == default (diff ${dR.max}) == baseline (diff ${dB.max})`);
  await page.context().close();
}

// ---- 9 frame time 960x720, default vs swapped
if (run(9)) {
  const cases = { meft1008: [["trees.wall", "built.pine"]], meft1013: [[TREE, SWAP], [ROCK, "built.cobble"]], meft1002: [["spires.rock", "built.cobble"]] };
  for (const arena of ARENAS) {
    const p = (await openViewer(browser, arena)).page; await p.waitForTimeout(2000); await grab(p, 1);
    const timeIt = () => p.evaluate(() => {
      const B = window.__built, R = B.renderer, cv = R.domElement, kw = cv.width, kh = cv.height; cv.width = 960; cv.height = 720;
      const cam = window.__r.getCameraInfo().render, gl = R.getContext(), one = new Uint8Array(4), now = window.__realNow;
      const time = (n) => { const t0 = now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (now() - t0) / n; };
      time(20); const a = [time(150), time(150), time(150)].sort((x, y) => x - y);
      cv.width = kw; cv.height = kh; return { ms: a[1], tris: B.info.triangles, calls: B.info.calls };
    });
    const tD = await timeIt(), parts = [`default ${tD.ms.toFixed(2)} ms (${tD.tris} tris, ${tD.calls} calls)`]; let worst = 0;
    for (const [s, a] of cases[arena]) {
      await p.evaluate(async ([s, a]) => { await window.__built.slots.bind(s, a); await window.__built.slots.idle(); }, [s, a]);
      const t = await timeIt(); worst = Math.max(worst, t.ms); parts.push(`+${s}->${a} ${t.ms.toFixed(2)} ms (${t.tris}, ${t.calls})`);
    }
    check(worst < tD.ms * 2 + 2, `9 frame time ${arena} 960x720: ${parts.join("; ")}`);
    await p.context().close();
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
await browser.close();
process.exit(fails ? 1 : 0);
