#!/usr/bin/env node
// verify_firing_axis.mjs — prove the K19b axis module sees the SAME body the renderer draws.
//
// Why it exists: web/fight/firing-axis.js computes a pose from the model's own channels
// (poseFromChannels) so that a node caller — the K19 solver, the K19b calibration, a unit test —
// reads the same bone matrices, emitter points and axes the battle view draws. Two implementations
// of one formula drift; this harness pins them together on the real renderer.
//
// What it asserts, per model/clip:
//   tick   the tick the script launches its projectile is the same on both sides
//   pose   the module's pose formula and the renderer's buildBoneWorldMatrices agree element-wise at
//          that tick (blend and the ch3 draw scale included), computed both in node and in the page
//   axis   firingAxis() of EVERY emitter site reads the same direction in both runtimes, on the same
//          raw pack (a near-degenerate PCA used to flip 90 deg between the two; the module now calls
//          such an axis "low" and falls back, and this row proves it does so identically)
//
// Usage (through the wrapper, so Chromium has its libs):
//   tools/run-playwright.sh tools/verify_firing_axis.mjs --models m005grey,m009mera,m228piem
//   tools/run-playwright.sh tools/verify_firing_axis.mjs --all --limit 40 --json /tmp/axis.json
//
// Options: --models a,b | --all (default) | --limit N | --clips 5,9,11 | --port (default 8127)
//          --json <path> | --quiet
// Exit code 0 when every checked model agrees, 1 otherwise.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { chromium } from "playwright";

import { ActorAnimator } from "../web/fight/actor-animator.js";
import { authoredSide } from "../web/fight/side-mirror.js";
import { emitters } from "../web/fight/digimon-anatomy.js";
import { setTechTable, setSkillTable } from "../web/fight/fight-tables.js";
import * as FA from "../web/fight/firing-axis.js";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const BASE_Z = 5120, TICK_SPEED = 2, CAP = 900;

const index = JSON.parse(readFileSync(resolve(MODELS, "index.json"), "utf8"));
const placement = JSON.parse(readFileSync(resolve(ROOT, "web/assets/battle/model_placement.json"), "utf8")).models || {};
setTechTable(JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/fight_tech_table.json"), "utf8")));
setSkillTable(JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/digimon.json"), "utf8")).skills);

const opt = { models: [], all: false, limit: 0, clips: [], port: 8127, json: null, quiet: false };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    if (a === "--models") opt.models.push(...String(next()).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--all") opt.all = true;
    else if (a === "--limit") opt.limit = Number(next()) | 0;
    else if (a === "--clips") opt.clips = String(next()).split(",").map(Number);
    else if (a === "--port") opt.port = Number(next()) | 0;
    else if (a === "--json") opt.json = resolve(next());
    else if (a === "--quiet") opt.quiet = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!opt.models.length) opt.all = true;
}

// ── static server (repo root: web/ and web/assets are served as-is) ────────────────────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
      const rel = decodeURIComponent(new URL(req.url, "http://local").pathname);
      if (rel.includes("..")) throw new Error("traversal");
      const path = resolve(ROOT, "." + rel);
      if (path !== ROOT && !path.startsWith(ROOT + "/")) throw new Error("outside");
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", () => done(server)); });
}

// ── node side: the same play + pose the calibration does ──────────────────────────────────────────
function slotOf(folder, side) {
  const rec = placement[folder.match(/^m(\d+)/)?.[1] ?? "0"] || {};
  const standoff = rec.standoff | 0, hover = rec.hover | 0;
  return { side, x: 0, y: -hover, z: side === "enemy" ? BASE_Z + standoff : -(BASE_Z + standoff) };
}

function nodePlay(folder, clip) {
  const model = JSON.parse(readFileSync(resolve(MODELS, folder, "anim.json"), "utf8"));
  const side = authoredSide(model);
  const anim = new ActorAnimator(model);
  anim.homeSlot = slotOf(folder, side);
  anim.baseTable = 0;
  const releases = [];
  let tick = 0;
  if (!anim.setAction(clip, {
    setLunge: (l) => { if (l && l.sub === 0 && Array.isArray(l.from)) releases.push({ tick, from: l.from.slice() }); },
  })) return null;
  const frames = [];
  while (anim.vm && tick < CAP) {
    anim.tick(TICK_SPEED);
    frames.push({ frame: anim.currentFrame(), blend: anim.currentBlend(), move: anim.moveDelta().slice() });
    tick++;
    if (releases.length) break;
  }
  if (!releases.length) return null;
  const rel = releases[0];
  const f = frames[rel.tick];
  const pose = FA.poseFromChannels(model, f.frame, { blend: f.blend });
  return { model, side, release: rel, frame: f.frame, blend: f.blend, pose, sites: emitterSites(folder) };
}

/** Every emitter site id the authored research gives this model - the axes to compare. */
function emitterSites(folder) {
  try { return emitters(folder).map((e) => e.id); } catch { return []; }
}

/** The firing axis of each site at a pose, in site order (null where the site has no geometry). */
function axesAt(model, folder, sites, pose) {
  return sites.map((id) => {
    const a = FA.firingAxis(model, folder, id, pose, { rest: FA.restPoseOf(model), });
    return a ? a.axis : null;
  });
}

function flatPose(model, pose) {
  const n = model.num_bones ?? model.bones.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(...FA.boneMatrix(pose, i));
  return out;
}

// ── page side: load the model, play the clip on the battle animator, read its matrices ─────────────
const PAGE_POSE = async ({ folder, clip, cap, sites }) => {
  const ch = {
    bwm: (await import("/web/battle3d.js")).buildBoneWorldMatrices,
  };
  const r = window.__r;
  if (!r) return { error: "no renderer" };
  const ok = await r.setPlayerDigimon(folder);
  if (!ok) return { error: `load failed ${folder}` };
  const a = r.playerAnimator;
  if (!a || !a.model) return { error: "no animator" };
  const model = a.model;
  const releases = [];
  let tick = 0;
  // Deterministic start: the node side builds a FRESH ActorAnimator, whose frame is the model's
  // clips[0].start_frame. The live animator has been breathing on its idle table since it loaded, so
  // pin its frame to the same place — otherwise a clip whose first table eases in from `prev` blends
  // from a different phase on the two sides and the poses differ for a reason that is not the formula.
  a.vm = null;
  a.frame = model.clips?.[0]?.start_frame ?? 0;
  if (!a.setAction(clip, { setLunge: (l) => { if (l && l.sub === 0 && Array.isArray(l.from)) releases.push({ tick, from: l.from.slice() }); } })) {
    return { error: "setAction false" };
  }
  const frames = [];
  while (a.vm && tick < cap) {
    a.tick(2);
    frames.push({ frame: a.currentFrame(), blend: a.currentBlend(), move: a.moveDelta().slice() });
    a.renderFrame = a.currentFrame();
    tick++;
    if (releases.length) break;
  }
  if (!releases.length) return { error: "no release" };
  const rel = releases[0];
  const f = frames[rel.tick];
  // Compare against the DISC's own channels, freshly fetched: the live model object may carry an
  // in-memory cast bake (anim-retarget applyCastBake rewrites ch2 keys for a model whose spell falls
  // back), and the calibration measures the disc's authored animation. Re-fetching gives the same
  // bone FORMULA on raw data — which is what this harness is about.
  const raw = await fetch(`assets/battle/models/${folder}/anim.json`).then((r) => r.json());
  const F = await import("/web/fight/firing-axis.js");
  const bw = ch.bwm(raw, f.frame, f.blend || null);
  const n = raw.num_bones ?? raw.bones.length;
  const pose = [];
  for (let i = 0; i < n; i++) {
    const m = bw.mats[i];
    pose.push(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]);
  }
  // the module's own pose, computed IN THE BROWSER: it must run without a DOM and match the renderer
  const modulePose = F.poseFromChannels(raw, f.frame, { blend: f.blend || null });
  const moduleFlat = [];
  for (let i = 0; i < n; i++) moduleFlat.push(...F.boneMatrix(modulePose, i));
  // The axis of every emitter site, from the RAW model on both sides: the same data, the same
  // function, but a different runtime (this page's module instance vs the node one). A pose that
  // matches element-wise but an axis that does not means the geometry read drifts - which is what a
  // near-degenerate PCA does, and why firingAxis() now reports an unstable axis as low confidence.
  const restPose = F.restPoseOf(raw);
  const axes = (sites || []).map((id) => {
    const a = F.firingAxis(raw, folder, id, modulePose, { rest: restPose });
    return a ? a.axis : null;
  });
  return {
    release: rel, frame: f.frame, blend: f.blend, move: f.move, pose, modulePose: moduleFlat, axes,
    baked: !!model.castBake || model.bones.some((b, i) => JSON.stringify(b.anim?.ch2) !== JSON.stringify(raw.bones[i]?.anim?.ch2)),
    bones: raw.bones.map((b, i) => ({ idx: i, verts: (b.verts || []).length })),
  };
};

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
const folders = (opt.models.length ? opt.models : index).slice(0, opt.limit || undefined);
const server = await serve(opt.port);
const browser = await chromium.launch();
const results = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${opt.port}/web/anim-viewer.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__r && !!window.__viewer, null, { timeout: 60000 });

  for (const folder of folders) {
    let node;
    let clip = null;
    // pick the clip: an authored one that launches, as the calibration would
    try {
      const model = JSON.parse(readFileSync(resolve(MODELS, folder, "anim.json"), "utf8"));
      for (let c = 0; c < (model.actions?.length || 0); c++) {
        const ops = model.actions[c]?.ops;
        if (!ops) continue;
        if (opt.clips.length && !opt.clips.includes(c)) continue;
        if (ops.some((o) => o.op === 6 && (o.words?.[0] | 0) === 0)) { clip = c; break; }
      }
    } catch { continue; }
    if (clip == null) continue;
    node = nodePlay(folder, clip);
    if (!node) continue;
    let pg;
    try { pg = await page.evaluate(PAGE_POSE, { folder, clip, cap: CAP, sites: node.sites }); } catch (e) { pg = { error: String(e) }; }
    if (!pg || pg.error) { results.push({ folder, clip, error: pg?.error || "page failed" }); continue; }
    const a = flatPose(node.model, node.pose);
    const b = pg.pose;
    const dist = (x, y) => {
      let m = 0, at = -1;
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const d = Math.abs(x[i] - y[i]);
        if (d > m) { m = d; at = i; }
      }
      return { max: m, at };
    };
    const rendererDiff = dist(a, b);                  // module (node) vs the renderer's matrices
    const browserDiff = dist(pg.modulePose || [], b); // the same module IN THE BROWSER vs the renderer
    const maxDiff = Math.max(rendererDiff.max, browserDiff.max);
    // every emitter's axis, node instance vs browser instance, on the same raw model
    const nodeAxes = axesAt(node.model, folder, node.sites, node.pose);
    let axisMaxDeg = 0, axisAt = null;
    for (let i = 0; i < nodeAxes.length; i++) {
      const x = nodeAxes[i], y = (pg.axes || [])[i];
      if (!x || !y) continue;
      const d = FA.angleBetween(x, y);
      if (d > axisMaxDeg) { axisMaxDeg = d; axisAt = node.sites[i]; }
    }
    const tickAgrees = node.release.tick === pg.release.tick;
    const frameAgrees = Math.abs((node.frame ?? 0) - (pg.frame ?? 0)) < 1e-9;
    const row = {
      folder, clip, releaseTick: node.release.tick, frame: node.frame, blend: !!node.blend,
      tickAgrees, frameAgrees, poseMaxDiff: +rendererDiff.max.toFixed(6), browserPoseMaxDiff: +browserDiff.max.toFixed(6),
      poseDiffAt: rendererDiff.at, sites: node.sites.length, baked: !!pg.baked,
      axisMaxDeg: +axisMaxDeg.toFixed(3), axisAt,
      pass: tickAgrees && frameAgrees && maxDiff < 3e-3 && axisMaxDeg < 0.5,
    };
    results.push(row);
    if (!opt.quiet) {
      console.log(`${row.pass ? "PASS" : "FAIL"} ${folder.padEnd(8)} clip ${String(clip).padStart(2)} tick ${String(row.releaseTick).padStart(3)} ` +
        `poseDiff ${row.poseMaxDiff} (browser ${row.browserPoseMaxDiff}) axisΔ ${row.axisMaxDeg}${row.axisAt ? ` @${row.axisAt}` : ""} of ${row.sites} site(s)`);
    }
  }
  if (errors.length && !opt.quiet) console.log("page errors:", errors.slice(0, 3));
} finally {
  await browser.close();
  server.close();
}
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(`\n${passed}/${results.length} models agree (pose < 1e-3, same release tick, same axis)`);
for (const f of failed.slice(0, 10)) console.log(`  FAIL ${f.folder} clip ${f.clip}: ${f.error || JSON.stringify(f)}`);
if (opt.json) {
  await mkdir(dirname(opt.json), { recursive: true });
  await writeFile(opt.json, JSON.stringify({ results, summary: { passed, total: results.length } }, null, 1));
  console.log(`wrote ${opt.json}`);
}
process.exit(failed.length ? 1 : 0);
