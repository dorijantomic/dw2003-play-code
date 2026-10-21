#!/usr/bin/env node
// K19 slice probe — the three exemplars in the REAL viewer, one run each, through the O3 hook (port 8123).
//
//   tools/run-playwright.sh tools/k19_slice_probe.mjs
//
// For each (model, technique) of the slice it opens the viewer's own deep link with &solver=1 (which is the
// engine's scope for exactly these three pairs), lets it resolve, and reads back:
//   - the script the viewer is about to play: buildKind "solved", solved=true, and the table it binds is the
//     solver's own table (not a donor's, not the planted own-body build)
//   - the numeric postconditions the solver recorded while baking INSIDE the page (aim error at release,
//     release point vs the measured point, reach, capsule clearance, ground drift, gate)
//   - the tick budget and the last table bound (1 = the model's idle: the cast returns to the body's own idle)
//   - any page error
// Writes /home/dorij/scratch-research/anim-k19-slice.json and prints a table.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8123;
const OUT = "/home/dorij/scratch-research/anim-k19-slice.json";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
                ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
                ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const SLICE = [
  { folder: "m228piem", techId: 167, tech: "Darkness Chaos", cls: "prop arm (per-emitter x2)" },
  { folder: "m094icem", techId: 151, tech: "Snowstorm", cls: "hand (per-emitter x2)" },
  { folder: "m050coca", techId: 153, tech: "Air Blast", cls: "mouth" },
];
const VIEWER = `http://127.0.0.1:${PORT}/web/anim-viewer.html`;
const link = (x) => `${VIEWER}?model=${x.folder}&tech=${x.techId}&side=near&outcome=hit&solver=1`;

function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const p = join(ROOT, decodeURIComponent(url.pathname));
      if (!existsSync(p)) { res.writeHead(404); res.end("no"); return; }
      const body = await readFile(p);
      res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
      res.end(body);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

const server = await serve(PORT);
const browser = await chromium.launch();
const rows = [];
for (const ex of SLICE) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  let row = { ...ex, link: link(ex) };
  try {
    await page.goto(link(ex), { waitUntil: "load" });
    await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__viewer?.r?.playerAnimator?.model, null, { timeout: 120000 });
    const measured = await page.evaluate(() => {
      const v = window.__viewer, s = v.state, model = v.r.playerAnimator.model;
      const script = s.script || {};
      const tables = (script.ops || []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0).map((o) => o.words?.[2] | 0);
      const casts = Object.fromEntries(Object.entries(model.solverCasts || {}).map(([k, c]) => [k, c]));
      const first = Object.values(casts)[0] || null;
      const rep = first?.report || null;
      const last = [...(script.ops || [])].reverse().find((o) => o.op === 2 && (o.words?.[0] | 0) === 0);
      return {
        solverOn: !!s.solver, build: script.buildKind ?? null, solved: !!script.solved,
        tables, solverTable: first?.table ?? null,
        playsSolverTable: first ? Object.values(casts).some((c) => tables.includes(c.table)) : false,
        backToIdle: last ? (last.words?.[2] | 0) === 1 : null,
        maxTick: s.maxTick, clip: s.clip, techId: s.techId, folder: s.folder,
        report: rep && {
          cls: rep.cls, mode: rep.mode, windup: rep.windup, release: rep.release, flight: rep.flight,
          follow: rep.follow, ticks: rep.ticks, height: Math.round(rep.height),
          aim: rep.aim.map((a) => ({ id: a.id, err: a.error == null ? null : +a.error.toFixed(2) })),
          worstAim: +rep.worstAim.toFixed(2),
          reached: rep.reached.map((r) => r && ({ id: r.id, h: +r.height.toFixed(2), f: +r.forward.toFixed(2), want: r.want })),
          reach: rep.reach, penetration: { ok: rep.penetration.ok, over: Math.round(rep.penetration.over), clearance: Math.round(rep.penetration.clearance) },
          rootDrift: rep.rootDrift, gate: rep.gate, pass: rep.pass, shared: rep.shared,
        },
      };
    });
    row = { ...row, ...measured };
  } catch (e) {
    row.error = String(e.message || e).slice(0, 300);
  }
  row.pageErrors = errors.slice(0, 3);
  rows.push(row);
  await page.close();
}
await browser.close();
server.close();
const report = { run: new Date().toISOString(), port: PORT, slice: rows };
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 1));
for (const r of rows) {
  const p = r.report;
  console.log(`${r.folder} "${r.tech}" ${r.cls}: build=${r.build} solved=${r.solved} playsSolverTable=${r.playsSolverTable} idle=${r.backToIdle} maxTick=${r.maxTick} errors=${r.pageErrors.length}${r.error ? " ERR " + r.error : ""}`);
  if (p) console.log(`   aim=${p.worstAim}° reach=${p.reach.map((x) => (x.centre ? "centre" : `${x.id} ${x.ok ? "ok" : "NO"} d=${x.d} arm=${x.arm}`)).join(",")} pen.ok=${p.penetration.ok} over=${p.penetration.over} drift=${p.rootDrift} gate=${JSON.stringify(p.gate)}`);
}
console.log("\nwrote", OUT);
