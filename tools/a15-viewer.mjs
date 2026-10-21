#!/usr/bin/env node
// A15: measure a cast in the REAL anim viewer — the pose after the clip, the meshes drawn, and where
// the launch leaves. Playwright + the shipped renderer.
//
//   tools/run-playwright.sh tools/a15-viewer.mjs --model m190bolt --tech 159 --side near --out /home/dorij/scratch-research/a15
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
const tech = arg("tech", "159");
const clip = arg("clip", null);
const side = arg("side", "near");
const outcome = arg("outcome", "hit");
const port = Number(arg("port", 8122));
const out = arg("out", "/home/dorij/scratch-research/a15");
const after = String(arg("after", "0,5,20,60,120")).split(",").map(Number);
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
const q = clip != null ? `clip=${clip}` : `tech=${tech}`;
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&${q}&side=${side}&outcome=${outcome}`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });

const info = await page.evaluate(() => {
  const v = window.__viewer, s = v.state, r = v.r;
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  return {
    maxTick: s.maxTick, clip: s.clip, techId: s.techId, build: s.script?.buildKind ?? null, retargeted: !!s.script?.retargeted,
    folder: s.folder, defender: s.defender,
    modelBones: atk?.model?.bones?.length, bonesWithFaces: atk?.model?.bones?.map((b, i) => [i, (b.faces || []).length]).filter((x) => x[1]),
    totalVerts: atk?.model?.bones?.reduce((n, b) => n + (b.faces || []).length * 3, 0),
    ops: (s.script?.ops ?? []).map((o) => `${o.op}:[${(o.words || []).join(",")}]${o.launch ? " @" + o.launch.id + "/" + o.launch.bone : ""}`),
  };
});

// the actor's post-action state: tick the real coordinator past the end, then read the pose it draws
const rows = [];
await page.evaluate(() => { window.__viewer.pause(); window.__viewer.seek(window.__viewer.state.maxTick); });
let prev = 0;
for (const n of after) {
  const row = await page.evaluate(async (extra) => {
    const v = window.__viewer, r = v.r, s = v.state;
    const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
    for (let i = 0; i < extra; i++) r.coordinator.tick(2);
    r.render(0);
    (function () { try { window.__viewer.composite?.(); } catch {} })();
    const b3 = await import("/web/battle3d.js");
    const m = atk.model;
    const f = atk.currentFrame(), bl = atk.currentBlend?.() ?? null;
    const bwm = b3.buildBoneWorldMatrices(m, f, bl);
    const pos = new Float32Array(m.bones.reduce((n, b) => n + (b.faces || []).length * 3, 0));
    b3.updateSkeletalVBO(m, f, bwm, pos);
    // per-bone drawn centroid/extent, and the model's overall box
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) { if (pos[i + k] < lo[k]) lo[k] = pos[i + k]; if (pos[i + k] > hi[k]) hi[k] = pos[i + k]; }
    }
    // group drawn verts into spatial clusters of the size-given radius, report the count + each box
    const pts = [];
    for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1], pos[i + 2]]);
    const fx = r.getEffectDraw?.();
    return {
      extra, tick: s.tick, frame: +f.toFixed(2), table: atk.timelineTable, idle: !atk.vm,
      blend: bl ? { from: bl.from, t: +bl.t.toFixed(2) } : null,
      box: { lo: lo.map((x) => +x.toFixed(0)), hi: hi.map((x) => +x.toFixed(0)) },
      verts: pts.length,
      fx: fx ? fx.list.map((e) => ({ arch: e.arch ?? e.program ?? null, frame: e.frame, side: e.side })) : null,
      count: 0,
    };
  }, n - prev);
  prev = n;
  rows.push(row);
  await page.screenshot({ path: resolve(out, `${model}-${q.replace("=", "")}-after${n}.png`) });
}
// also a mid-cast shot at the launch tick (the tick the op6 fires)
const launchTicks = await page.evaluate(() => {
  const v = window.__viewer, s = v.state;
  const marks = (s.marks || []).filter((m) => m.ops?.includes("6") || m.text?.includes("6")).map((m) => m.tick);
  return { marks: (s.marks || []).map((m) => ({ tick: m.tick, text: m.text })).slice(0, 40) };
});
await page.evaluate(() => { window.__viewer.seek(Math.round(window.__viewer.state.maxTick * 0.5)); });
await page.screenshot({ path: resolve(out, `${model}-${q.replace("=", "")}-mid.png`) });

console.log(JSON.stringify({ info, rows, launchTicks, errs: errs.slice(0, 8) }, null, 1));
await browser.close();
server.close();
