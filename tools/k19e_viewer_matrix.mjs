#!/usr/bin/env node
// K19e — the three exemplars in the REAL viewer, across every side and outcome (port 8130).
//
//   tools/run-playwright.sh tools/k19e_viewer_matrix.mjs
//
// For each exemplar x side(near/far) x outcome(hit/miss/lethal):
//   - the deep link with &solver=1 (the slice's own scope) resolves buildKind "solved"
//   - the solved table is the one the animator BINDS (not just declared)
//   - the action runs to its end through the coordinator, the defender plays its outcome reaction
//     (2 survive / 3 death / 4 evade), and the attacker is back on its own idle table afterwards
//   - the idle keeps advancing (the cast does not freeze the body) and no page error appears
// Writes /home/dorij/scratch-research/anim-k19e-viewer.json.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8130;
const OUT = "/home/dorij/scratch-research/anim-k19e-viewer.json";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const SLICE = [
  { folder: "m228piem", techId: 167, tech: "Darkness Chaos", cls: "prop" },
  { folder: "m094icem", techId: 151, tech: "Snowstorm", cls: "hand" },
  { folder: "m050coca", techId: 153, tech: "Air Blast", cls: "mouth" },
];
const VIEWER = `http://127.0.0.1:${PORT}/web/anim-viewer.html`;
const link = (x, side, outcome) => `${VIEWER}?model=${x.folder}&tech=${x.techId}&side=${side}&outcome=${outcome}&solver=1`;

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
  for (const side of ["near", "far"]) {
    for (const outcome of ["hit", "miss", "lethal"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errors = [];
      const failed = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
      const row = { folder: ex.folder, tech: ex.tech, cls: ex.cls, side, outcome, link: link(ex, side, outcome) };
      try {
        await page.goto(row.link, { waitUntil: "load" });
        await page.waitForFunction(() => window.__viewer?.state?.script && window.__viewer?.r?.playerAnimator?.model, null, { timeout: 120000 });
        const before = await page.evaluate(() => {
          const v = window.__viewer, s = v.state, script = s.script || {};
          const atk = s.side === "near" ? v.r.playerAnimator : v.r.enemyAnimator;
          const model = atk.model;
          const cast = Object.values(model.solverCasts ?? {})[0] || null;
          const tables = (script.ops || []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0).map((o) => o.words?.[2] | 0);
          return {
            attacker: s.side === "near" ? "player" : "enemy",
            build: script.buildKind ?? null, solved: !!script.solved,
            solverTable: cast?.table ?? null, tables, maxTick: s.maxTick,
            report: cast?.report ? {
              cls: cast.report.cls, mode: cast.report.mode, ticks: cast.report.ticks,
              aim: cast.report.aim.map((a) => (a.error == null ? null : +a.error.toFixed(2))),
              worstAim: +cast.report.worstAim.toFixed(2), gate: cast.report.gate,
              ground: cast.report.rootDrift, reach: cast.report.reach.map((r) => (r.centre ? "centre" : `${r.id}:${r.ok ? "ok" : "NO"}${r.pulled ? "/pulled" : ""}`)),
              pen: { ok: cast.report.penetration.ok, over: Math.round(cast.report.penetration.over) },
              mass: cast.report.metrics?.bones ?? null,
            } : null,
          };
        });
        const run = await page.evaluate(() => window.__viewer.runToEnd(3000));
        // after the clip: attacker idle table + frame advancing, defender reaction clip
        const after = await page.evaluate(async () => {
          const v = window.__viewer, r = v.r;
          const atk = v.state.side === "near" ? r.playerAnimator : r.enemyAnimator;
          const def = v.state.side === "near" ? r.enemyAnimator : r.playerAnimator;
          const snap = () => ({ table: atk.timelineTable, frame: atk.currentFrame(), vm: !!atk.vm, hidden: atk.currentHiddenParts?.() ?? null });
          const a = snap();
          if (!v.state.playing) v.play();
          await new Promise((res) => setTimeout(res, 500));
          const b = snap();
          // what the coordinator asked the DEFENDER to play (op1 dispatch)
          const disp = r.coordinator?.log ?? r.coordinator?.dispatches ?? null;
          return {
            attackerTable: a.table, attackerFrame: a.frame, idleAdvanced: b.frame !== a.frame,
            attackerVm: a.vm, defenderClip: def?._clip ?? null, coordinatorActive: !!r.coordinator.active,
            playing: !!v.state.playing,
            lastTableOp: (() => { const ops = v.state.script?.ops || []; const last = [...ops].reverse().find((o) => o.op === 2 && (o.words?.[0] | 0) === 0); return last ? last.words[2] | 0 : null; })(),
            solverCasts: Object.keys(atk.model?.solverCasts ?? {}).length,
            dispatch: disp ? JSON.stringify(disp).slice(0, 200) : null,
          };
        });
        row.before = before;
        row.run = run;
        row.after = after;
      } catch (e) {
        row.error = String(e.message || e).slice(0, 300);
      }
      row.pageErrors = errors.slice(0, 3);
      row.failed404 = [...new Set(failed)].slice(0, 5);
      rows.push(row);
      await page.close();
      const rep = row.before?.report;
      console.log(`${row.folder} ${row.side}/${row.outcome}: build=${row.before?.build} solved=${row.before?.solved} ` +
        `aim=${rep?.worstAim}° gate=${JSON.stringify(rep?.gate)} run=${row.run?.ticks}t ended=${row.run?.ended} ` +
        `idleTable=${row.after?.attackerTable} advanced=${row.after?.idleAdvanced} defenderClip=${row.after?.defenderClip} ` +
        `errors=${row.pageErrors.length}${row.failed404?.length ? " 404:" + row.failed404.join(",") : ""}${row.error ? " ERR " + row.error : ""}`);
    }
  }
}
await browser.close();
server.close();
const ok = rows.filter((r) => !r.error && r.before?.build === "solved" && r.run?.ended && r.after?.attackerTable === 0 && r.after?.idleAdvanced && r.pageErrors.length === 0);
const report = { run: new Date().toISOString(), port: PORT, slice: SLICE, rows, pass: `${ok.length}/${rows.length}` };
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 1));
console.log(`\n${ok.length}/${rows.length} pass · wrote ${OUT}`);
process.exitCode = ok.length === rows.length ? 0 : 1;
