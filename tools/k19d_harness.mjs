#!/usr/bin/env node
// K19d exemplar harness — the viewer links and the before/after contact sheets.
//
// For each exemplar (BRIEF6: three models, one per emitter class, chosen by tools/k19d_select.mjs) it
// opens the REAL viewer (web/anim-viewer.html) in headless Chromium at the page's own deep link,
// plays the technique in isolated mode, and captures 8 frames of the action from the FRONT and from
// the 3/4 view, composed into one labelled sheet per view:
//
//   /home/dorij/scratch-research/anim-sheets/k19-<model>-front.png
//   /home/dorij/scratch-research/anim-sheets/k19-<model>-34.png
//
// It also writes the deep links and the phase marks to /home/dorij/scratch-research/anim-k19d-sheets.json.
// The numbers are tools/k19d_postconditions.mjs's job; this tool is the pictures.
//
//   tools/run-playwright.sh tools/k19d_harness.mjs                # all three, both views
//   tools/run-playwright.sh tools/k19d_harness.mjs --model m228piem --view front
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = "/home/dorij/scratch-research/anim-sheets";
const PORT = 8129;
const VIEWER = `http://127.0.0.1:${PORT}/web/anim-viewer.html`;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
                ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
                ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ONLY = arg("model", null);
const ONLY_VIEW = arg("view", null);
// --solver: turn the lead's solver on inside the page (scope "all") and re-resolve the action, so the
// pictures show what the engine would play with O3 in force. Without it the pictures are the "before":
// today's planted / retargeted build.
const SOLVER = argv.includes("--solver");
const TAG = arg("tag", SOLVER ? "after" : "before");
const SUFFIX = TAG === "before" ? "" : `-${TAG}`;

// the slice — the test harness is the only place these ids are allowed to appear (BRIEF6)
const EXEMPLARS = [
  { key: "bare-hands", folder: "m228piem", name: "Piedmon", techId: 167, tech: "Darkness Chaos" },
  { key: "prop-arm", folder: "m178kngt", name: "Knightmon", techId: 158, tech: "Electro Bolt" },
  { key: "mouth-head", folder: "m050coca", name: "Kokatorimon", techId: 153, tech: "Air Blast" },
];
const VIEWS = [{ key: "front", preset: "front" }, { key: "34", preset: "threeQuarter" }];

function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      const p = resolve(ROOT, "." + decodeURIComponent(url.pathname));
      if (p !== ROOT && !p.startsWith(ROOT + "/")) throw new Error("outside");
      const body = await readFile(p);
      res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

const deepLink = (ex) => `${VIEWER}?model=${ex.folder}&tech=${ex.techId}&side=near&outcome=hit${SOLVER ? "&solver=1" : ""}`;

await mkdir(OUT_DIR, { recursive: true });
const server = await serve(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const sheets = [];
for (const ex of EXEMPLARS) {
  if (ONLY && ONLY !== ex.folder) continue;
  await page.goto(deepLink(ex), { waitUntil: "load" });
  await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__viewer.r?.playerAnimator?.model, null, { timeout: 120000 });
  let solver = null;
  if (SOLVER) {
    // the URL's &solver=1 turns the viewer's switch on (web/anim-viewer.html), which enables the engine's
    // scope before the first resolve. Here we only VERIFY that the script the viewer draws is the solver's.
    solver = await page.evaluate(() => {
      const v = window.__viewer;
      const model = v.r.playerAnimator.model;
      const casts = Object.keys(model.solverCasts || {});
      const tables = (v.state.script?.ops || []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0).map((o) => o.words?.[2] | 0);
      return { on: !!v.state.solver, build: v.state.script?.buildKind ?? null, casts, tables,
               solved: !!v.state.script?.solved,
               playsSolverTable: casts.some((c) => {
                 const rec = model.solverCasts[c] || {};
                 return [rec.table, rec.tables?.[0], rec.tableIndex].some((t) => t != null && tables.includes(t));
               }) };
    });
    await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });
  }
  await page.evaluate(() => { window.__viewer.pause(); });

  const info = await page.evaluate(() => {
    const v = window.__viewer, s = v.state, r = v.r;
    return {
      maxTick: s.maxTick, clip: s.clip, techId: s.techId, folder: s.folder,
      build: s.script?.buildKind ?? null, retargeted: !!s.script?.retargeted,
      marks: (s.marks || []).map((m) => ({ tick: m.tick, kind: m.kind, text: m.text })),
      canvas: { w: v.r?.canvas?.width ?? null, h: v.r?.canvas?.height ?? null },
      cv: { w: document.getElementById("cv").width, h: document.getElementById("cv").height },
    };
  });

  // the eight frames: the wind-up, the release, the follow-through, the return — not just even samples.
  // The op6 records with a non-zero sub are emitter hooks; the SHOT is `projectile 0` (K19b's rule).
  const release = info.marks.find((m) => m.kind === "proj" && /projectile 0$/.test(m.text))?.tick
    ?? info.marks.find((m) => m.kind === "proj")?.tick ?? Math.floor(info.maxTick * 0.3);
  const strike = info.marks.find((m) => m.kind === "contact" && /STRIKE/.test(m.text))?.tick ?? Math.min(info.maxTick, release + 30);
  const end = info.maxTick;
  const wanted = [0, Math.round(release * 0.45), Math.round(release * 0.8), release,
                  Math.min(end, release + 4), Math.min(end, release + 12), Math.min(end, strike), Math.min(end, strike + 26)];
  const ticks = [...new Set(wanted.map((t) => Math.max(0, Math.min(end, t))))].sort((a, b) => a - b);
  while (ticks.length < 8) {                    // a short script: fill with even samples (still unique)
    let added = false;
    for (let i = 1; i < 8 && ticks.length < 8; i++) {
      const t = Math.round((end * i) / 8);
      if (!ticks.includes(t)) { ticks.push(t); added = true; }
    }
    if (!added) break;
  }
  ticks.sort((a, b) => a - b);

  // frame the model over those ticks, from the attacker's own bounds union
  await page.evaluate(async (ticks) => {
    const v = window.__viewer, r = v.r, cam = v.cam;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const t of ticks) {
      v.seek(t);
      const b = r.getFighterBounds("player");
      if (!b) continue;
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.min[i]); mx[i] = Math.max(mx[i], b.max[i]); }
    }
    const aspect = document.getElementById("cv").width / document.getElementById("cv").height;
    cam.frameBounds({ min: mn, max: mx }, aspect, { immediate: true });
    cam.update(0);
  }, ticks);

  const views = {};
  if (SOLVER && !solver?.solved) {
    // the engine did not take this pair over (the solver's own gate refused it, or the hook does not see
    // the technique): an "after" picture would just be the before one under a different name.
    sheets.push({ ...ex, tag: TAG, link: deepLink(ex), maxTick: info.maxTick, build: info.build, solver, skipped: "solver did not take over", sheets: {} });
    console.log(`${ex.name}: solver did NOT take over (build ${info.build}); no ${TAG} sheet written`);
    continue;
  }
  for (const view of VIEWS) {
    if (ONLY_VIEW && ONLY_VIEW !== view.key) continue;
    const dataUrl = await page.evaluate(async ({ ticks, preset, release, strike, tech, name, folder, tag, build }) => {
      const v = window.__viewer, cv = document.getElementById("cv");
      v.cam.setPreset(preset, { immediate: true });
      v.cam.update(0);
      const shots = [];
      for (const t of ticks) {
        v.seek(t);
        v.cam.setPreset(preset, { immediate: true });
        v.cam.update(0);
        v.r.render(0);
        shots.push({ tick: t, url: cv.toDataURL("image/png") });
      }
      const cols = 4, rows = 2, pad = 10, labelH = 30;
      const W = cv.width, H = cv.height;
      const sheet = document.createElement("canvas");
      sheet.width = cols * W + (cols + 1) * pad;
      sheet.height = rows * (H + labelH) + (rows + 1) * pad + 34;
      const c = sheet.getContext("2d");
      c.fillStyle = "#0d0f12"; c.fillRect(0, 0, sheet.width, sheet.height);
      c.fillStyle = "#e8eef6"; c.font = "600 18px monospace";
      c.fillText(`${name} (${folder})  ${tech}  —  ${preset === "front" ? "FRONT" : "3/4"}  —  ${tag.toUpperCase()}: ${build}  —  isolated, 8 frames`, pad, 24);
      const load = (u) => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = u; });
      for (let i = 0; i < shots.length; i++) {
        const im = await load(shots[i].url);
        const x = pad + (i % cols) * (W + pad);
        const y = 34 + pad + Math.floor(i / cols) * (H + labelH + pad);
        c.drawImage(im, x, y, W, H);
        const phase = shots[i].tick === release ? "RELEASE" : shots[i].tick === strike ? "STRIKE"
          : shots[i].tick < release ? "wind-up" : "follow-through";
        c.fillStyle = "#0d0f12"; c.fillRect(x, y + H, W, labelH);
        c.fillStyle = shots[i].tick === release ? "#ffd76a" : shots[i].tick === strike ? "#ff8a7a" : "#9fb3c8";
        c.font = "600 16px monospace";
        c.fillText(`t${shots[i].tick}  ${phase}`, x + 8, y + H + 20);
      }
      return sheet.toDataURL("image/png");
    }, { ticks, preset: view.preset, release, strike, tech: ex.tech, name: ex.name, folder: ex.folder,
         tag: TAG, build: `${info.build ?? "?"}${info.retargeted ? " retargeted" : ""}${solver ? (solver.solved ? " +solver" : " (solver on, not taken)") : ""}` });
    const file = `${OUT_DIR}/k19-${ex.folder}-${view.key}${SUFFIX}.png`;
    await writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    views[view.key] = file;
  }
  sheets.push({ ...ex, tag: TAG, link: deepLink(ex), maxTick: info.maxTick, release, strike, ticks,
                build: info.build, retargeted: info.retargeted, solver, canvas: info.cv, sheets: views });
  console.log(`${ex.name}: ${ticks.length} frames, release ${release}, strike ${strike} of ${info.maxTick} — ${Object.values(views).join(", ")}`);
}

const FILE = "/home/dorij/scratch-research/anim-k19d-sheets.json";
let prev = {};
try { prev = JSON.parse(readFileSync(FILE, "utf8")); } catch { prev = {}; }
const doc = { ...prev, [TAG]: { generatedAt: new Date().toISOString(), port: PORT, solver: SOLVER, sheets, errors } };
writeFileSync(FILE, JSON.stringify(doc, null, 1));
console.log(`\nlinks (${TAG}):`);
for (const s of sheets) console.log(`  ${s.name}  ${s.link}${s.solver ? `   solver ${JSON.stringify(s.solver)}` : ""}`);
if (errors.length) { console.log(`\npage errors (${errors.length}):`); for (const e of errors.slice(0, 10)) console.log("  " + e); }
await browser.close();
server.close();
