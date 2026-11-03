// Numbers check of the Arena Viewer's FREE CAMERA and TUNING PANEL (web/arena-viewer-tools.js), no pictures:
//  (a) camera "free": the camera starts at the battle camera's pose; mouse drag (turn), right drag (pan), wheel (zoom)
//      and the W key move it; after each move the built world's view-projection (built.info.pv) and battle3d's
//      (r.getViewProjection()) are the same matrix (every element within 1e-4 x max(1, |element|)), battle3d draws
//      through the free eye, and each fighter's foot projects to the same pixel in both, as does the sand/ground point
//      under it (built.groundHeight); free off gives the camera back to the battle (setFreeCameraView(null)).
//  (b) panel: opening it builds folders from the uniforms really on the materials; a change to water run-up (uRunup,
//      written to EVERY material that has it: the sea and the sand) and to the light direction lands on the uniform
//      objects; reset writes the start values back exactly (===); "copy values" puts the changed values on the clipboard.
//  (c) untouched: frames of the battle idle camera are byte-identical to the page before this change. Time is frozen
//      (performance.now and requestAnimationFrame replaced in the page) and the same frames are drawn by hand in both
//      pages; compared: built.info.pv and an FNV-1a hash of the visible canvas. BASE_HTML = path of the old
//      arena-viewer.html (served in place of the page through a Playwright route, no file is written); without it the
//      check compares two loads of the current page and says so.
//   VERIFY_PORT=8090 [ARENA=meft1002] [BASE_HTML=/path/old.html] tools/verify-lock.sh tools/run-playwright.sh tools/verify_viewer_freecam.mjs
import fs from "node:fs";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const URL_ = `${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built&p=m373rena&e=m051kuwa`;
const BASE = process.env.BASE_HTML || null;
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const browser = await launch();

async function open(html) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl(8090) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  // frozen time: the frames below are drawn by hand at fixed times, so two loads draw the same pictures
  await page.addInitScript(() => { performance.now = () => globalThis.__tNow || 0; window.requestAnimationFrame = () => 0; });
  if (html) await page.route("**/arena-viewer.html*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto(URL_);
  await page.waitForFunction(() => !!window.__built && !!window.__renderFrame, null, { timeout: 90000, polling: 200 });
  // let the models and textures arrive (real time passes, page time does not)
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => { window.__renderFrame(0); const B = window.__built;
      return !B.missing && B.info.triangles > 0 && !!window.__r.getFighterBounds("player") && !!window.__r.getFighterBounds("enemy")
        && (B.info.layers?.sand ? !!B.info.layers.sand.tex?.ready : true); });
    if (ok && i >= 12) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ctx, page, errors };
}
const frames = (page) => page.evaluate(() => {
  const out = [], cv = document.getElementById("cv"), x = cv.getContext("2d");
  for (let k = 0; k < 4; k++) {
    globalThis.__tNow = 5000 + k * 16; window.__renderFrame(performance.now());
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let h = 2166136261 >>> 0; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
    out.push({ pv: window.__built.info.pv.join(","), hash: h.toString(16) });
  }
  return out;
});

// ---------------- (c) untouched = before ----------------
let baseFrames = null, baseErrors = [];
{
  const b = await open(BASE ? fs.readFileSync(BASE, "utf8") : null);
  baseFrames = await frames(b.page);
  baseErrors = b.errors;
  await b.ctx.close();
}
console.log(`INFO baseline page errors: ${baseErrors.length}${baseErrors.length ? " (" + [...new Set(baseErrors)].slice(0, 2).join(" | ") + ")" : ""}`);
const { ctx, page, errors } = await open(null);
const nowFrames = await frames(page);
const untouched = await page.evaluate(() => ({ cam: window.__r.getCameraMode(), free: !!window.__tools?.freeCam,
  panel: !!window.__tools?.tuner, built: !!window.__tools?.tuner?.ready }));
console.log(`(c) baseline: ${BASE ? `BASE_HTML ${BASE}` : "none given: two loads of the current page"}`);
for (let k = 0; k < nowFrames.length; k++)
  check(nowFrames[k].pv === baseFrames[k].pv && nowFrames[k].hash === baseFrames[k].hash,
    `(c) idle frame ${k}: pv ${nowFrames[k].pv === baseFrames[k].pv ? "same" : "DIFFERENT"}, hash ${nowFrames[k].hash} vs ${baseFrames[k].hash}`);
check(new Set(nowFrames.map((f) => f.hash)).size > 1, `(c) the hash sees time move (${new Set(nowFrames.map((f) => f.hash)).size} different hashes in 4 frames)`);
check(untouched.cam === "director" && !untouched.free && untouched.panel && !untouched.built,
  `(c) untouched state: camera ${untouched.cam}, free cam ${untouched.free}, panel made ${untouched.panel} (collapsed, controls built: ${untouched.built})`);

// ---------------- (a) free camera ----------------
const camState = (tag) => page.evaluate(async (tag) => {
  const THREE = await import("./lib3d/three.module.js");
  const B = window.__built, r = window.__r;
  const P = B.info.pv, Q = Array.from(r.getViewProjection());
  let worst = 0; for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(P[i] - Q[i]) / Math.max(1, Math.abs(Q[i])));
  const W = 960, H = 720;
  const px = (m, p) => { const v = new THREE.Vector4(...p, 1).applyMatrix4(new THREE.Matrix4().fromArray(m)); return [(v.x / v.w * 0.5 + 0.5) * W, (0.5 - v.y / v.w * 0.5) * H, v.w]; };
  const fc = window.__tools.freeCam, ri = r.getCameraInfo().render;
  const fighters = ["player", "enemy"].map((side) => {
    const b = r.getFighterBounds(side); if (!b) return null;
    const foot = [b.center[0], b.min[1], b.center[2]], gy = B.groundHeight(b.center[0], b.center[2]);
    const g = [b.center[0], gy ?? 0, b.center[2]];
    const fb = px(P, foot), fr = px(Q, foot), gb = px(P, g), gr = px(Q, g);
    return { side, feetY: +b.min[1].toFixed(1), groundY: gy == null ? null : +gy.toFixed(1),
      footPx: fr.slice(0, 2).map((v) => +v.toFixed(1)), footDiffPx: Math.hypot(fb[0] - fr[0], fb[1] - fr[1]),
      groundDiffPx: Math.hypot(gb[0] - gr[0], gb[1] - gr[1]), footToGroundPx: [Math.hypot(fb[0] - gb[0], fb[1] - gb[1]), Math.hypot(fr[0] - gr[0], fr[1] - gr[1])],
      inFront: fr[2] > 1 };
  });
  return { tag, worst, eye: ri.eye, look: ri.look, free: fc ? fc.view() : null, mode: r.getCameraMode(), fighters };
}, tag);
const before = await page.evaluate(() => window.__r.getCameraInfo().render);
await page.selectOption("#cam", "free");
await page.waitForFunction(() => !!window.__tools.freeCam, null, { timeout: 20000 });
const start = await page.evaluate(() => window.__tools.freeCam.start);
const d0 = Math.max(...[0, 1, 2].map((i) => Math.abs(start.eye[i] - before.eye[i])), ...[0, 1, 2].map((i) => Math.abs(start.look[i] - before.look[i])));
check(d0 < 1e-6, `(a) free camera starts at the battle pose (largest eye/look difference ${d0.toExponential(2)} units; up ${start.up.map((v) => +v.toFixed(4))})`);
let t = 6000;
const frame = async (dtMs = 16) => { t += dtMs; await page.evaluate((t) => { globalThis.__tNow = t; window.__renderFrame(t); }, t); };
await frame();
const box = await page.locator("#cv").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const moves = [];
moves.push(await camState("start"));
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 140, cy - 40, { steps: 6 }); await page.mouse.up();
await frame(); moves.push(await camState("left drag (turn)"));
await page.mouse.move(cx, cy); await page.mouse.down({ button: "right" }); await page.mouse.move(cx - 90, cy + 50, { steps: 6 }); await page.mouse.up({ button: "right" });
await frame(); moves.push(await camState("right drag (pan)"));
await page.mouse.move(cx, cy); await page.mouse.wheel(0, 400); await page.waitForTimeout(100);
await frame(); moves.push(await camState("wheel (zoom out)"));
const preW = await page.evaluate(() => window.__tools.freeCam.view());
await page.locator("body").focus().catch(() => {});
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.down("w"); await frame(100); await page.keyboard.up("w");
moves.push(await camState("W key 0.1 s"));
const postW = moves.at(-1).free;
const wDist = Math.hypot(...[0, 1, 2].map((i) => postW.eye[i] - preW.eye[i]));
for (let i = 0; i < moves.length; i++) {
  const m = moves[i];
  const moved = i === 0 ? 0 : Math.hypot(...[0, 1, 2].map((k) => m.free.eye[k] - moves[i - 1].free.eye[k])) + Math.hypot(...[0, 1, 2].map((k) => m.free.look[k] - moves[i - 1].free.look[k]));
  const throughFree = Math.max(...[0, 1, 2].map((k) => Math.abs(m.eye[k] - m.free.eye[k])), ...[0, 1, 2].map((k) => Math.abs(m.look[k] - m.free.look[k])));
  check(m.mode === "free" && throughFree < 1e-3 && (i === 0 || moved > 1), `(a) ${m.tag}: battle3d draws through the free eye (diff ${throughFree.toExponential(1)}), camera moved ${moved.toFixed(1)} units`);
  check(m.worst <= 1e-4, `(a) ${m.tag}: built pv vs battle3d pv, worst element ${m.worst.toExponential(2)} (relative, <= 1e-4)`);
  for (const f of m.fighters.filter(Boolean)) {
    const ok = f.footDiffPx < 0.05 && f.groundDiffPx < 0.05 && Math.abs(f.footToGroundPx[0] - f.footToGroundPx[1]) < 0.05;
    check(ok, `(a) ${m.tag}: ${f.side} foot at px ${f.footPx} (in front ${f.inFront}); foot same pixel in both ${f.footDiffPx.toFixed(4)} px, ground point under it ${f.groundDiffPx.toFixed(4)} px; foot-to-sand ${f.footToGroundPx.map((v) => v.toFixed(2))} px (feet y ${f.feetY}, ground y ${f.groundY})`);
  }
}
check(Math.abs(wDist - 150) < 1, `(a) W for 0.1 s flies ${wDist.toFixed(2)} units (1500 units/s)`);
// free off: the battle owns the camera again
await page.selectOption("#cam", "director");
await frame();
const off = await page.evaluate(() => ({ mode: window.__r.getCameraMode(), free: !!window.__tools.freeCam, eye: window.__r.getCameraInfo().render.eye }));
const offD = Math.hypot(...[0, 1, 2].map((k) => off.eye[k] - postW.eye[k]));
check(off.mode === "director" && !off.free && offD > 1, `(a) free off: camera ${off.mode}, free cam gone, eye ${offD.toFixed(0)} units from the last free eye`);

// ---------------- (b) panel ----------------
const panel = await page.evaluate(() => {
  const T = window.__tools.tuner;
  T.gui.open();   // as a click on its title: builds the controls and takes the start values
  const folders = T.gui.folders.map((f) => `${f._title} ${f.controllersRecursive().length}`);
  const pick = (name) => T.entries.find((e) => e.name === name && !e.live);
  const out = { folders, ready: T.ready, n: T.entries.length, live: T.entries.filter((e) => e.live).map((e) => e.id), tests: [] };
  const vals = (e) => e.targets.map((u) => typeof u.value === "number" ? u.value : u.value.toArray());
  for (const [name, f] of [["uRunup", (v) => v * 1.5], ["uLightDir", null], ["uShallow", null], ["uContrast", (v) => v * 0.5]]) {
    const e = pick(name); if (!e) { out.tests.push({ name, missing: true }); continue; }
    const start = vals(e);
    let id = e.id, v;
    if (f) v = +f(e.start).toPrecision(6);
    else if (e.kind === "col") v = "#ff8000";
    else { id = e.id + ".az"; v = 33; }
    const set = T.set(id, v);
    const after = vals(e);
    out.tests.push({ name, id, mats: e.mats, targets: e.targets.length, set, start, after, wanted: v });
  }
  out.copy = T.changes();
  return out;
});
console.log(`(b) folders: ${panel.folders.join(" | ")}; ${panel.n} uniforms; greyed (seen changing by itself): ${panel.live.join(", ") || "none"}`);
check(panel.ready && panel.folders.length > 0, `(b) panel built on open: ${panel.folders.length} folders`);
for (const s of panel.tests) {
  if (s.missing) { console.log(`INFO (b) ${s.name}: not on this arena`); continue; }
  const changed = s.after.every((a) => JSON.stringify(a) !== JSON.stringify(s.start[0]));
  const allSame = s.after.every((a) => JSON.stringify(a) === JSON.stringify(s.after[0]));
  const exact = typeof s.wanted === "number" && !s.id.endsWith(".az") ? s.after.every((a) => a === s.wanted) : true;
  check(s.set && changed && allSame && exact, `(b) ${s.name} on ${s.mats.join(" + ")} (${s.targets} uniform objects): ${JSON.stringify(s.start[0])} -> ${JSON.stringify(s.after[0])}`);
}
const copied = await page.evaluate(async () => { const T = window.__tools.tuner; const txt = await T.copy(); let clip = null; try { clip = await navigator.clipboard.readText(); } catch {} return { txt, clip }; });
const cj = JSON.parse(copied.txt);
const nChanged = Object.values(cj.changed).reduce((s, f) => s + Object.keys(f).length, 0);
check(nChanged === panel.tests.filter((s) => !s.missing).length && copied.clip === copied.txt,
  `(b) copy values: ${nChanged} changed values in the JSON, clipboard ${copied.clip === copied.txt ? "holds it" : "does NOT hold it"} (${Object.keys(cj.changed).join(", ")})`);
const reset = await page.evaluate((tests) => {
  const T = window.__tools.tuner; T.reset();
  const vals = (e) => e.targets.map((u) => typeof u.value === "number" ? u.value : u.value.toArray());
  return tests.filter((s) => !s.missing).map((s) => { const e = T.entries.find((x) => x.id === s.id || s.id.startsWith(x.id + "."));
    return { name: s.name, exact: vals(e).every((v) => JSON.stringify(v) === JSON.stringify(s.start[0])), now: vals(e)[0] }; });
}, panel.tests);
for (const r of reset) check(r.exact, `(b) reset ${r.name}: back to ${JSON.stringify(r.now)} exactly`);
const after = await page.evaluate(() => Object.keys(window.__tools.tuner.changes()).length);
check(after === 0, `(b) after reset nothing is listed as changed (${after})`);

const known = (e) => /builtSpireCards|computeBoundingSphere\(\): Computed radius is NaN/.test(e);   // the known spires.js NaN (not this page)
const real = errors.filter((e) => !known(e));
check(real.length === 0, `no page errors (${errors.length - real.length} known spires.js NaN bounding-sphere lines not counted)${real.length ? ": " + real.slice(0, 3).join(" | ") : ""}`);
await ctx.close();
await browser.close();
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
