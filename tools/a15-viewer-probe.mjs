#!/usr/bin/env node
// A15: the REAL anim viewer (shipped renderer, port 8122) - does the retargeted cast fire from the prop,
// keep ONE prop mesh, and return to its own idle?  Playwright + the same files the game loads.
//
//   tools/run-playwright.sh tools/a15-viewer-probe.mjs --model m190bolt --tech 159 --side near
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
                ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
                ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      const path = resolve(ROOT, "." + decodeURIComponent(url.pathname));
      if (path !== ROOT && !path.startsWith(ROOT + "/")) throw new Error("outside");
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const model = arg("model", "m190bolt");
const tech = Number(arg("tech", "159"));
const side = arg("side", "near");
const outcome = arg("outcome", "hit");
const port = Number(arg("port", 8122));
const out = arg("out", "/home/dorij/scratch-research/a15");
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=${outcome}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });

const info = await page.evaluate(async () => {
  const v = window.__viewer, s = v.state, r = v.r;
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  const pack = await (await fetch(`assets/battle/models/${s.folder}/anim.json`)).json();
  const idleFrames = (pack.timeline?.[0]?.table || []).filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
  // mesh parts the pack's own IDLE keeps scaled to ~0 (ch3 of every meshed bone)
  const hidden = [];
  for (let b = 0; b < pack.bones.length; b++) {
    const ch3 = pack.bones[b]?.anim?.ch3;
    if (!ch3 || !(pack.bones[b].faces || []).length) continue;
    let hi = 0;
    for (const f of idleFrames) { const s3 = interp3(ch3, f); hi = Math.max(hi, Math.abs(s3[0]), Math.abs(s3[1]), Math.abs(s3[2])); }
    if (hi / 4096 < 0.05) hidden.push(b);
  }
  function interp3(ch, f) {
    let prev = null;
    for (const k of ch) { const kf = k[3] | 0; if (kf === 30000) break; if (kf <= f) { prev = k; continue; }
      if (!prev) return [k[0], k[1], k[2]];
      const t = (f - (prev[3] | 0)) / ((kf - (prev[3] | 0)) || 1);
      return [prev[0] + (k[0] - prev[0]) * t, prev[1] + (k[1] - prev[1]) * t, prev[2] + (k[2] - prev[2]) * t]; }
    return prev ? [prev[0], prev[1], prev[2]] : [4096, 4096, 4096];
  }
  return {
    folder: s.folder, build: s.script?.buildKind ?? null, clip: s.clip, maxTick: s.maxTick,
    idleFrames: idleFrames.slice(0, 4).concat(idleFrames.slice(-2)),
    idleCount: idleFrames.length, idleLo: Math.min(...idleFrames), idleHi: Math.max(...idleFrames),
    hiddenBones: hidden,
    op6: (s.script?.ops ?? []).filter((o) => o.op === 6 && (o.words?.[0] | 0) === 0).map((o) => o.words.slice()),
    ops: (s.script?.ops ?? []).map((o) => `${o.op}:[${(o.words || []).join(",")}]`),
    atkFrame0: atk?.currentFrame?.() ?? null, atkHidden0: atk?.currentHiddenParts?.() ?? null,
  };
});
console.log("INFO", JSON.stringify(info, null, 1));

// what the RENDERER draws at a tick: frame, table, the forced-off parts, and the drawn scale of the
// idle-hidden bones (from the pose the viewer's own buildBoneWorldMatrices produced).
const probe = async (t) => page.evaluate((t) => {
  const v = window.__viewer, s = v.state, r = v.r;
  v.seek(t);
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  const pose = v.pose(s.side);
  const scales = (v.__hiddenBones || []).map((b) => {
    const o = b * 12;
    const col = (i) => Math.hypot(pose[o + i], pose[o + i + 1], pose[o + i + 2]);
    return +Math.max(col(0), col(3), col(6)).toFixed(3);
  });
  return { tick: t, frame: atk?.currentFrame?.() ?? null, table: atk?.timelineTable ?? null,
    blend: !!atk?.currentBlend?.(), hidden: atk?.currentHiddenParts?.() ?? null, scales,
    move: atk?.moveDelta?.() ?? null };
}, t);
await page.evaluate((h) => { window.__viewer.__hiddenBones = h; }, info.hiddenBones);

const during = [];
const MAX = Math.min(info.maxTick, 200);
// launch once, then advance the REAL coordinator one logic tick at a time (seek(t) would re-run the
// script from the start every sample: O(n^2) and too slow for a 200-tick probe).
await page.evaluate(() => { window.__viewer.seek(0); });
for (let t = 1; t <= MAX; t++) during.push(await page.evaluate((t) => {
  const v = window.__viewer, s = v.state, r = v.r;
  if (r.coordinator.active) r.coordinator.tick(2);
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  const pose = v.pose(s.side);
  const scales = (v.__hiddenBones || []).map((b) => {
    const o = b * 12;
    const col = (i) => Math.hypot(pose[o + i], pose[o + i + 1], pose[o + i + 2]);
    return +Math.max(col(0), col(3), col(6)).toFixed(3);
  });
  return { tick: t, frame: atk?.currentFrame?.() ?? null, table: atk?.timelineTable ?? null,
    blend: !!atk?.currentBlend?.(), hidden: atk?.currentHiddenParts?.() ?? null, scales,
    move: atk?.moveDelta?.() ?? null };
}, t));
const visible = during.filter((r) => r.scales.some((s) => s >= 0.05));
console.log("ticks sampled", during.length, "| ticks drawing an idle-hidden part:", visible.length,
  visible.slice(0, 6).map((r) => `${r.tick}:${r.scales.join("/")}`).join(" "));
console.log("hidden-part override during the cast:", JSON.stringify([...new Set(during.map((r) => JSON.stringify(r.hidden)))]));

// AFTER the action: tick the animator itself for 60 logic ticks (what the next turn draws).
const after = await page.evaluate(() => {
  const v = window.__viewer, s = v.state, r = v.r;
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  v.runToEnd(1500);
  const rows = [];
  for (let k = 1; k <= 60; k++) {
    atk.tick(2);
    if (k % 6 === 0) rows.push({ k, frame: atk.currentFrame(), table: atk.timelineTable,
      blend: !!atk.currentBlend?.(), hidden: atk.currentHiddenParts?.() ?? null });
  }
  return rows;
});
const idleOk = after.every((r) => r.table === 0 && r.frame >= info.idleLo && r.frame <= info.idleHi && r.hidden == null);
console.log("AFTER-END", JSON.stringify({ idleOk, rows: after }));

for (const t of [0, 12, 24, 36, 48, Math.min(MAX, 60)]) {
  await probe(t);
  const p = `${out}/${model}-t${tech}-${side}-${t}.png`;
  await page.screenshot({ path: p });
}
const res = { model, tech, side, outcome, info, during, after, idleOk, errs: errs.slice(0, 8) };
await writeFile(`${out}/${model}-t${tech}-${side}-a15.json`, JSON.stringify(res, null, 1));
console.log("errors:", errs.slice(0, 8));
await browser.close();
server.close();
