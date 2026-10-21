#!/usr/bin/env node
// K19e — the exemplar as the ENEMY in the battle renderer's own path (web/battle-lab.html, port 8130).
//
//   tools/run-playwright.sh tools/k19e_battle_lab.mjs
//
// battle-lab drives the real battle3d + FightCoordinator (the same setAnimByTech -> resolveClipScript ->
// ActorAnimator chain the battle uses, including op1 dispatch to the defender, camera and effects). For
// each exemplar it enables the solver scope for that pair INSIDE the page, makes the enemy cast the
// technique, and reads back: the solved table the animator bound, the ops the VM ran, the contact and the
// defender's reaction, the return to idle, and any page error.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8130;
const OUT = "/home/dorij/scratch-research/anim-k19e-battle-lab.json";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const SLICE = [
  { folder: "m228piem", techId: 167, tech: "Darkness Chaos" },
  { folder: "m094icem", techId: 151, tech: "Snowstorm" },
  { folder: "m050coca", techId: 153, tech: "Air Blast" },
];
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text().slice(0, 160)); });
  const row = { folder: ex.folder, tech: ex.tech, techId: ex.techId };
  try {
    await page.goto(`http://127.0.0.1:${PORT}/web/battle-lab.html?model=${ex.folder}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__r && window.__r.enemyAnimator?.model, null, { timeout: 120000 });
    // the solver's scope, set in the page on the SAME module instance battle3d uses
    const scope = await page.evaluate(async (ex) => {
      const m = await import("/web/fight/anim-solver.js");
      return JSON.stringify(m.setSolverScope([{ folder: ex.folder, tech: ex.tech }]));
    }, ex);
    // the exemplar IS the enemy for this run
    await page.evaluate((folder) => window.__r.setEnemyDigimon(folder), ex.folder);
    await page.waitForFunction(() => window.__r.enemyAnimator?.model?.folder !== undefined, null, { timeout: 60000 });
    const started = await page.evaluate((techId) => {
      window.__contacts = 0;
      const ok = window.__r.enemyAttack(techId, { onHit: (rec) => { if ((rec?.type | 0) === 99) window.__contacts++; } });
      const a = window.__r.enemyAnimator;
      return { ok, ops: (a.vm?.ops ?? []).map((o) => `${o.op}[${(o.words ?? []).join(",")}]`), tables: a.model.timeline ? Object.keys(a.model.timeline).length : 0 };
    }, ex.techId);
    // sample the bound table while the action runs
    const bound = new Set();
    let active = true, guard = 0;
    while (active && guard++ < 400) {
      const s = await page.evaluate(() => ({ active: !!window.__r.coordinator.active, table: window.__r.enemyAnimator.timelineTable, clip: window.__r.enemyAnimator._clip }));
      if (s.table != null) bound.add(s.table);
      active = s.active;
      if (active) await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => {
      const r = window.__r, a = r.enemyAnimator, d = r.playerAnimator;
      const casts = a.model.solverCasts ?? {};
      const first = Object.values(casts)[0] ?? null;
      return {
        build: a.vm ? null : "ended", clip: a._clip, table: a.timelineTable,
        solverTable: first?.table ?? null, report: first?.report ? {
          cls: first.report.cls, mode: first.report.mode, worstAim: +first.report.worstAim.toFixed(2),
          gate: first.report.gate, ground: first.report.rootDrift,
        } : null,
        contacts: window.__contacts ?? 0, defenderClip: d?._clip ?? null,
        fxCount: window.__fxCount ?? null, vmActive: !!(a.vm && !a.vm.ended),
        bakes: a.model.__solverBakes ?? 0,
      };
    });
    row.scope = scope;
    row.started = started;
    row.tablesBoundDuring = [...bound];
    row.after = after;
  } catch (e) {
    row.error = String(e.message || e).slice(0, 300);
  }
  row.pageErrors = errors.slice(0, 5);
  rows.push(row);
  await page.close();
  const a = row.after || {};
  console.log(`${row.folder} "${row.tech}": start=${row.started?.ok} bakes=${a.bakes} solverTable=${a.solverTable} bound=${JSON.stringify(row.tablesBoundDuring)} ` +
    `contacts=${a.contacts} defenderClip=${a.defenderClip} returnTable=${a.table} aim=${a.report?.worstAim} gate=${JSON.stringify(a.report?.gate)} errors=${row.pageErrors.length}${row.error ? " ERR " + row.error : ""}`);
}
await browser.close();
server.close();
const ok = rows.filter((r) => r.started?.ok && (r.after?.bakes ?? 0) > 0 && (r.tablesBoundDuring || []).includes(r.after?.solverTable) && (r.after?.contacts ?? 0) > 0 && r.pageErrors.length === 0);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ run: new Date().toISOString(), port: PORT, rows, pass: `${ok.length}/${rows.length}` }, null, 1));
console.log(`\n${ok.length}/${rows.length} pass · wrote ${OUT}`);
process.exitCode = ok.length === rows.length ? 0 : 1;
