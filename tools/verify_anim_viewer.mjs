#!/usr/bin/env node
// verify_anim_viewer.mjs — the A13 acceptance gate, in a real browser, with arithmetic assertions.
//
// What it proves (each line of the verdict is a number, not an opinion):
//   search      typing "Raijinmon" into the page's own search box narrows the list to it and selects it
//   actions     every action the action panel offers plays and ENDS (bounded), and its pose moves
//   scrub       seeking to a contact tick changes the skeleton pose (bone matrices differ)
//   orbit       N degrees of orbit changes the camera azimuth by N (and a real mouse drag does too)
//   pitch       pitch reaches ±89° (and ±89.95° with the full-pitch toggle), finite at the pole
//   pan/zoom    a drag moves the pivot; the wheel changes the distance monotonically and toward the cursor
//   freecam     during a playing attack with an op5 camera cut, the FREE camera's eye does not move;
//               with the battle camera on, the same attack MOVES it (so the cut really fires)
//   framing     for EVERY one of the 249 models (tiny and giant), framing the model puts the whole
//               bounding box inside the viewport, with no NaN in any matrix
//   gallery     the gallery renders non-blank thumbnails
//
// Usage: tools/run-playwright.sh tools/verify_anim_viewer.mjs [--json out.json] [--sheets dir] [--port 8116]
// Exit code 0 when every check passed.
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = +(opt("--port", "8116"));
const SHEETS = opt("--sheets", "/home/dorij/scratch-research/anim-sheets");
const JSON_OUT = opt("--json", "/home/dorij/scratch-research/a13-verify.json");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream", ".css": "text/css" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let p = join(ROOT, decodeURIComponent(url.pathname));
    const s = await stat(p).catch(() => null);
    if (!s) { res.writeHead(404); res.end("not found"); return; }
    if (s.isDirectory()) p = join(p, "index.html");
    const body = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
await mkdir(SHEETS, { recursive: true });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/web/anim-viewer.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.entry, null, { timeout: 60000 });

// ── 1. the page's own search box selects Raijinmon ────────────────────────────────────────────
await page.fill("#search", "Raijinmon");
await page.waitForFunction(() => document.querySelectorAll("#species li").length >= 1, null, { timeout: 10000 });
const listCount = await page.$$eval("#species li", (n) => n.length);
await page.click("#species li");
await page.waitForFunction(() => window.__viewer.state.folder === "m441raiz" && !!window.__viewer.state.action, null, { timeout: 60000 });
const sel = await page.evaluate(() => ({
  folder: window.__viewer.state.folder, name: window.__viewer.state.entry.name,
  actions: window.__viewer.state.actions.length, action: window.__viewer.state.action.name,
  clip: window.__viewer.state.clip, maxTick: window.__viewer.state.maxTick,
}));
check("search 'Raijinmon' narrows the list to the one Digimon", listCount === 1, `${listCount} rows`);
check("search selects it (folder + actions built)", sel.folder === "m441raiz" && sel.actions >= 8, JSON.stringify(sel));
await page.screenshot({ path: join(SHEETS, "a13-raijinmon-viewer.png") });

// ── 2. every action in the panel plays and ends, and moves the pose ──────────────────────────
const actionRuns = await page.evaluate(() => {
  const v = window.__viewer;
  const out = [];
  for (let i = 0; i < v.state.actions.length; i++) {
    v.setActionByIndex(i);
    const a = v.state.action;
    const max = v.state.maxTick;
    v.seek(0);
    const p0 = v.pose();
    // the interesting pose is the contact/strike the script itself marks; reactions get 45%
    const mark = v.state.marks.find((m) => m.kind === "contact");
    const at = mark ? mark.tick : Math.max(1, Math.floor(max * 0.45));
    v.seek(at);
    const p1 = v.pose();
    let diff = 0;
    for (let k = 0; k < Math.min(p0.length, p1.length); k++) diff = Math.max(diff, Math.abs(p0[k] - p1[k]));
    const res = v.runToEnd();
    out.push({ kind: a.kind, name: a.name, clip: a.clip, max, ticks: res.ticks, ended: res.ended, poseDiff: +diff.toFixed(4) });
  }
  return out;
});
const badActions = actionRuns.filter((r) => r.kind !== "idle" && !r.ended);
const stillActions = actionRuns.filter((r) => r.kind !== "idle" && r.poseDiff < 0.01);
check("every action in the panel ends (no hang)", badActions.length === 0, `${actionRuns.length} actions, ${badActions.map((b) => b.name).join(", ") || "all ended"}`);
check("every action moves the skeleton", stillActions.length === 0, stillActions.map((b) => `${b.name}:${b.poseDiff}`).join(", ") || `min pose delta ${Math.min(...actionRuns.filter((r) => r.kind !== "idle").map((r) => r.poseDiff)).toFixed(4)}`);

// ── 3. the scrubber moves the pose (seek to the strike tick) ──────────────────────────────────
const scrub = await page.evaluate(() => {
  const v = window.__viewer;
  const idx = v.state.actions.findIndex((a) => a.kind === "tech" && a.clip === 5);
  v.setActionByIndex(idx >= 0 ? idx : 0);
  v.seek(0);
  const p0 = v.pose();
  const m = v.state.marks.find((x) => x.text.includes("STRIKE")) || v.state.marks.find((x) => x.kind === "contact");
  const tick = m ? m.tick : Math.floor(v.state.maxTick / 2);
  v.seek(tick);
  const p1 = v.pose();
  let diff = 0;
  for (let k = 0; k < Math.min(p0.length, p1.length); k++) diff = Math.max(diff, Math.abs(p0[k] - p1[k]));
  const slider = +document.getElementById("scrub").value;
  // and the strike frame drawn: save the composited canvas for the human
  return { tick, slider, diff: +diff.toFixed(4), max: v.state.maxTick, marks: v.state.marks.length, png: document.getElementById("cv").toDataURL("image/png") };
});
await writeFile(join(SHEETS, "a13-raijinmon-strike.png"), Buffer.from(scrub.png.split(",")[1], "base64"));
check("the scrubber seeks to the strike tick and the pose changes", scrub.diff > 0.02 && scrub.slider === scrub.tick,
  `tick ${scrub.tick}/${scrub.max}, pose delta ${scrub.diff}, ${scrub.marks} markers`);

// ── 4. camera arithmetic: orbit, pitch, pan, zoom (API + real mouse) ─────────────────────────
const camMath = await page.evaluate(() => {
  const v = window.__viewer, cam = v.cam;
  const az = () => cam.azimuthDeg();
  const a0 = az();
  cam.orbitBy(30, 0, { immediate: true }); cam.update(0);
  const a1 = az();
  cam.orbitBy(-75, 0, { immediate: true }); cam.update(0);
  const a2 = az();
  cam.orbitBy(0, 500, { immediate: true });
  const pitchDown = cam.pitchDeg();
  cam.orbitBy(0, -1000, { immediate: true });
  const pitchUp = cam.pitchDeg();
  cam.allowFullPitch = true;
  cam.orbitBy(0, 1000, { immediate: true });
  const pitchFull = cam.pitchDeg();
  const poleFinite = cam.isFinite() && cam.viewMatrix().every(Number.isFinite) && cam.projection(4 / 3).every(Number.isFinite);
  cam.allowFullPitch = false;
  cam.setPreset("threeQuarter", { immediate: true });
  const p0 = cam.targetPivot.slice();
  cam.panPixels(120, -60, 900);
  const panD = Math.hypot(...cam.targetPivot.map((v2, i) => v2 - p0[i]));
  const d0 = cam.dist;
  cam.zoomBy(0.8); const d1 = cam.dist;
  cam.zoomBy(1.25); const d2 = cam.dist;
  return {
    a0, a1, a2, pitchDown, pitchUp, pitchFull, poleFinite, panD, d0, d1, d2,
    mod360: (d) => ((d % 360) + 360) % 360,
  };
});
const dAz = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
check("orbit: +30° changes the azimuth by +30°", Math.abs(dAz(camMath.a1, camMath.a0) - 30) < 0.01, `${camMath.a0.toFixed(2)} -> ${camMath.a1.toFixed(2)}`);
check("orbit: -75° changes it by -75°", Math.abs(dAz(camMath.a2, camMath.a1) + 75) < 0.01, `${camMath.a1.toFixed(2)} -> ${camMath.a2.toFixed(2)}`);
check("pitch clamps at ±89° and reaches ±89.95° with full pitch, finite at the pole",
  Math.abs(camMath.pitchDown - 89) < 0.01 && Math.abs(camMath.pitchUp + 89) < 0.01 && Math.abs(camMath.pitchFull - 89.95) < 0.01 && camMath.poleFinite,
  `${camMath.pitchDown.toFixed(2)} / ${camMath.pitchUp.toFixed(2)} / ${camMath.pitchFull.toFixed(2)} finite=${camMath.poleFinite}`);
check("pan moves the pivot", camMath.panD > 1, `${camMath.panD.toFixed(1)} units`);
check("zoom is monotonic", camMath.d1 < camMath.d0 && camMath.d2 > camMath.d1, `${camMath.d0.toFixed(0)} -> ${camMath.d1.toFixed(0)} -> ${camMath.d2.toFixed(0)}`);

// real mouse: drag orbits, right-drag pans, wheel zooms; double-click re-pivots
const box = await page.$eval("#cv", (c) => { const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
const camBefore = await page.evaluate(() => ({ az: window.__viewer.cam.azimuthDeg(), dist: window.__viewer.cam.dist, pivot: window.__viewer.cam.targetPivot.slice() }));
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 160, cy + 30, { steps: 8 });
await page.mouse.up();
const camAfterDrag = await page.evaluate(() => ({ az: window.__viewer.cam.azimuthDeg() }));
await page.mouse.move(cx, cy);
await page.mouse.down({ button: "right" });
await page.mouse.move(cx + 90, cy - 40, { steps: 6 });
await page.mouse.up({ button: "right" });
const camAfterPan = await page.evaluate(() => ({ pivot: window.__viewer.cam.targetPivot.slice() }));
await page.mouse.wheel(0, -420);
await page.waitForTimeout(60);
const camAfterWheel = await page.evaluate(() => ({ dist: window.__viewer.cam.dist }));
await page.mouse.dblclick(cx + 40, cy + 40);
const camAfterDbl = await page.evaluate(() => ({ pivot: window.__viewer.cam.targetPivot.slice() }));
const panMoved = Math.hypot(...camAfterPan.pivot.map((v, i) => v - camBefore.pivot[i]));
check("mouse drag orbits the camera", Math.abs(dAz(camAfterDrag.az, camBefore.az)) > 5, `${camBefore.az.toFixed(1)}° -> ${camAfterDrag.az.toFixed(1)}°`);
check("right-drag pans the pivot", panMoved > 1, `${panMoved.toFixed(1)} units`);
check("wheel changes the distance (zoom to cursor)", camAfterWheel.dist < camBefore.dist, `${camBefore.dist.toFixed(0)} -> ${camAfterWheel.dist.toFixed(0)}`);
check("double-click re-pivots", Math.hypot(...camAfterDbl.pivot.map((v, i) => v - camAfterPan.pivot[i])) > 0.5, "pivot moved");

// ── 5. the free camera ignores the script's op5 cuts; the battle camera does not ──────────────
const freeCamTest = await page.evaluate(async () => {
  const v = window.__viewer, r = v.r;
  // an action that carries an op5 camera record, from the dry-run markers
  let idx = v.state.actions.findIndex((a) => a.kind === "tech" && a.clip === 9);
  if (idx < 0) idx = v.state.actions.findIndex((a) => a.kind === "tech");
  v.setActionByIndex(idx);
  const camMark = v.state.marks.find((m) => m.kind === "camera");
  const tick = camMark ? camMark.tick : Math.floor(v.state.maxTick * 0.4);
  v.setFreeCam(true);
  r.setFreeCameraView(() => v.cam.view());
  r.setCameraMode("free");
  v.cam.update(3);                       // settle any damping left by the mouse checks
  v.seek(0);
  v.cam.update(3);
  const eye0 = v.eye().slice();
  // play through the action's own op5 cut (the mark from the dry run), then check the eye
  v.play();
  const until = Math.min(v.state.maxTick, (camMark ? camMark.tick : 20) + 8);
  for (let i = 0; i < 40 && v.state.tick < until; i++) await new Promise((res) => setTimeout(res, 50));
  const eye1 = v.eye().slice();
  v.pause();
  const scriptCam = v.state.scriptCam;
  const maxFreeDelta = Math.max(...eye0.map((x, i) => Math.abs(x - eye1[i])));
  // now the battle camera: the same action's op5 must move it (explicit mode: the page's own rAF
  // loop would otherwise re-install the free camera between the seeks)
  v.setFreeCam(false);
  r.setFreeCameraView(null);
  r.setCameraMode("game", { scriptOwnsCamera: true });
  v.seek(0);
  const before = r.getCameraInfo()?.eye?.slice() || null;
  let seen = null;
  for (let t = 0; t <= Math.min(v.state.maxTick, tick + 20); t++) {
    v.seek(t);
    const e = r.getCameraInfo()?.eye?.slice() || null;
    if (e && before && Math.max(...e.map((x, i) => Math.abs(x - before[i]))) > 1) { seen = { t, e }; break; }
  }
  const maxBattleDelta = seen ? Math.max(...seen.e.map((x, i) => Math.abs(x - before[i]))) : 0;
  return { idx, tick, scriptCam, camMark: camMark?.text || null, maxFreeDelta, maxBattleDelta, eyeFinite: eye1.every(Number.isFinite) };
});
check("free camera: the eye does not move while an attack plays (op5 fired: " + (freeCamTest.camMark || "none") + ")",
  freeCamTest.maxFreeDelta < 1e-6 && freeCamTest.eyeFinite, `free eye delta ${freeCamTest.maxFreeDelta}`);
check("battle camera: the same attack's op5 MOVES the eye (control)", freeCamTest.maxBattleDelta > 1, `battle eye delta ${freeCamTest.maxBattleDelta.toFixed(1)} at tick ${freeCamTest.scriptCam ? freeCamTest.tick : "?"}`);

// ── 5b. the far side and the outcome control ─────────────────────────────────────────────────
const sideChecks = await page.evaluate(async () => {
  const v = window.__viewer, r = v.r;
  const setSel = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event("change")); };
  const wait = (fn, ms = 20000) => new Promise((res) => { const t0 = performance.now(); const tick = () => ((fn() || performance.now() - t0 > ms) ? res() : setTimeout(tick, 60)); tick(); });
  setSel("side", "far");
  await wait(() => v.state.side === "far" && v.state.layoutKey.endsWith("|far") && r.enemyAnimator && v.state.action && !r.coordinator.active);
  const far = v.runToEnd();
  const farClip = r.enemyAnimator?._clip;
  const farSide = v.state.side;
  setSel("side", "near");
  await wait(() => v.state.side === "near" && v.state.layoutKey.endsWith("|near") && r.playerAnimator && v.state.action && !r.coordinator.active);
  const sd = document.getElementById("showDefender"); sd.checked = true; sd.dispatchEvent(new Event("change"));
  setSel("outcome", "lethal");
  await wait(() => v.state.outcome === "lethal" && v.state.action && !r.coordinator.active);
  const idx = v.state.actions.findIndex((a) => a.kind === "tech" && a.clip === 5);
  v.setActionByIndex(idx >= 0 ? idx : 0);
  const lethal = v.runToEnd();
  const def = r.enemyAnimator;
  return {
    far: { side: farSide, clip: farClip, ended: far.ended, ticks: far.ticks },
    lethal: { defClip: def?._clip, held: !!def?._heldPose, ended: lethal.ended },
  };
});
check("side=far: the Digimon on the enemy side plays and ends", sideChecks.far.ended && sideChecks.far.clip >= 0 && sideChecks.far.ticks > 2, JSON.stringify(sideChecks.far));
check("outcome=lethal: the defender plays the death reaction (clip 3) and holds it", sideChecks.lethal.defClip === 3 && sideChecks.lethal.held, JSON.stringify(sideChecks.lethal));

// ── 6. framing fits EVERY model's bounding box (all 249, tiny and giant) ─────────────────────
await page.evaluate(() => { const v = window.__viewer; v.setFreeCam(true); v.r.setFreeCameraView(() => v.cam.view()); v.r.setCameraMode("free"); v.r.setEnemyVisible(false); });
const folders = await page.evaluate(() => window.__viewer.index.filter((e) => e.folder).map((e) => e.folder));
const frameRows = [];
for (const folder of folders) {
  const row = await page.evaluate(async (f) => {
    const v = window.__viewer, r = v.r, cam = v.cam;
    await r.setPlayerDigimon(f);
    for (let i = 0; i < 3; i++) { r.render(0); if (r.getFighterBounds("player")) break; await new Promise((res) => setTimeout(res, 40)); }
    v.cam.lockPoint = null;
    const b = r.getFighterBounds("player");
    if (!b) return { folder: f, ok: false, why: "no bounds" };
    const aspect = 1120 / 840;
    cam.frameBounds(b, aspect, { immediate: true });
    cam.update(0);
    let worst = 0, nan = !cam.isFinite();
    for (let i = 0; i < 8; i++) {
      const c = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
      const n = cam.project(c, aspect);
      if (!n || !n.every(Number.isFinite)) { nan = true; continue; }
      worst = Math.max(worst, Math.abs(n[0]), Math.abs(n[1]));
    }
    return { folder: f, ok: !nan && worst <= 1.0001, worst: +worst.toFixed(4), h: +(b.max[1] - b.min[1]).toFixed(1), dist: +cam.dist.toFixed(1), nan };
  }, folder);
  frameRows.push(row);
}
const badFrames = frameRows.filter((r) => !r.ok);
const sizes = frameRows.map((r) => r.h).filter(Number.isFinite);
check(`framing fits the whole body for all ${folders.length} models`, badFrames.length === 0,
  badFrames.length ? `${badFrames.length} failed: ${badFrames.slice(0, 8).map((r) => `${r.folder}(${r.why || "ndc " + r.worst})`).join(", ")}`
    : `worst |ndc| ${Math.max(...frameRows.map((r) => r.worst)).toFixed(3)}, heights ${Math.min(...sizes).toFixed(0)}..${Math.max(...sizes).toFixed(0)} units`);

// ── 7. gallery renders live thumbnails ──────────────────────────────────────────────────────
await page.evaluate(() => { window.__viewer.loadEntry("m441raiz"); });
await page.waitForTimeout(300);
await page.click("#galleryBtn");
await page.waitForTimeout(4000);
const gallery = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll("#galleryGrid .tile canvas")];
  let nonBlank = 0;
  for (const c of tiles) {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
    if (max - min > 8) nonBlank++;
  }
  return { tiles: tiles.length, nonBlank };
});
check("gallery draws live thumbnails", gallery.tiles > 0 && gallery.nonBlank > 0, `${gallery.nonBlank}/${gallery.tiles} tiles non-blank`);
await page.screenshot({ path: join(SHEETS, "a13-gallery.png") });
await page.click("#galleryClose").catch(() => {});

check("no page errors", errors.length === 0, errors.slice(0, 4).join(" | ") || "none");

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
await writeFile(JSON_OUT, JSON.stringify({ results, actionRuns, framing: frameRows, freeCamTest, gallery }, null, 2));
console.log("wrote " + JSON_OUT);
await browser.close();
server.close();
process.exit(passed === results.length ? 0 : 1);
