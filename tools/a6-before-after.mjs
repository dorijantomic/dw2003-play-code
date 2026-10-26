#!/usr/bin/env node
// a6/before-after.mjs - one Knightmon clip-9 sheet BEFORE (the shipped fallback body: the model's own basic
// attack under the donor's cast script) and AFTER (the anim-retarget prototype bakes the donor's rotation
// motion onto the model's skeleton), same camera, same 8-frame sampling. Research tool.
//
//   tools/run-playwright.sh tools/a6-before-after.mjs --target m178kngt --source m369duke --clip 9 \
//       --cam orbit --out /home/dorij/scratch-research/anim-sheets --prefix a6-kngt
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
const target = arg("target", "m178kngt");
const source = arg("source", "m369duke");
const clip = Number(arg("clip", 9));
const offset = Number(arg("offset", 6000));
const out = arg("out", "/home/dorij/scratch-research/anim-sheets");
const prefix = arg("prefix", "a6-kngt");
const port = Number(arg("port", 8106));
const cam = arg("cam", "orbit");
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/battle-lab.html`, { waitUntil: "load" });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  if (await page.evaluate(() => !!window.__r && !!window.__r.playerAnimator)) break;
  await new Promise((r) => setTimeout(r, 50));
}

const res = await page.evaluate(async ({ target, source, clip, offset, cam }) => {
  const sel = document.getElementById("cam");
  if (sel) { sel.value = cam; sel.dispatchEvent(new Event("change")); }
  const mod = await import("/web/battle3d.js");
  const rt = await import("/web/fight/anim-retarget.js");
  const r = window.__r, off = window.__off;
  await r.setPlayerDigimon(target);
  const a = r.playerAnimator;      // setPlayerDigimon swaps the animator: take it AFTER the swap
  const shot = (ticks, label, ctx, S) => {
    r.render(0);
    const x = ((label.k - 1) % 4) * 480, y = Math.floor((label.k - 1) / 4) * 336;
    ctx.drawImage(off, x, y, 480, 336);
    ctx.fillStyle = "#8cf"; ctx.font = "bold 15px monospace";
    ctx.fillText(`${label.what} tick ${label.t} frame ${a.currentFrame()}`, x + 6, y + 18);
  };
  const sheetOf = async (start, ticks) => {
    const S = document.createElement("canvas");
    S.width = 4 * 480; S.height = 2 * 336;
    const ctx = S.getContext("2d");
    ctx.fillStyle = "#0d0d16"; ctx.fillRect(0, 0, S.width, S.height);
    start();
    let t = 0;
    for (let k = 1; k <= 8; k++) {
      const goal = Math.max(1, Math.round((ticks * k) / 8));
      while (t < goal) { r.coordinator.tick(2); t++; }
      shot(t, { k, t, what: "before: own basic body" }, ctx, S);
    }
    return S.toDataURL("image/png");
  };

  // BEFORE: the shipped path - a.setAction(9) builds the fallback script (donor cast, own basic-attack body)
  const reset = () => { a.setIdle(); for (let i = 0; i < 20; i++) r.coordinator.tick(2); };
  reset();
  a.setAction(clip, {}, { element: 1 });
  let ticks = 0;
  for (; ticks < 300; ticks++) { r.coordinator.tick(2); if (!a.vm || a.vm.ended) break; }
  reset();
  const before = await sheetOf(() => { a.setAction(clip, {}, { element: 1 }); }, ticks);

  // AFTER: bake the donor's rotation motion onto this skeleton and run the shifted table.
  // The lab renders the model object setPlayerDigimon loaded (battle3d.js:3466 uses playerModel),
  // so the bake is written back INTO that object - swapping a.model alone renders the old model.
  const src = await fetch(`assets/battle/models/${source}/anim.json`).then((x) => x.json());
  const own = a.model;
  const bake = rt.bakeRetarget(own, src, clip, { offset });
  if (!bake) { reset(); return { error: "bake returned null" }; }
  for (let i = 0; i < own.bones.length; i++) {
    const b = bake.model.bones[i];
    if (b?.anim) own.bones[i].anim = b.anim;
  }
  own.timeline[bake.table] = bake.model.timeline[bake.table];
  const tab = bake.model.timeline[bake.table].table;
  let lo = Infinity, hi = -1;
  for (const e of tab) { const v = e.value | 0; if (v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  const span = hi > lo ? hi - lo : 60;
  const windup = Math.round(span * 0.5), tail = Math.round(span * 0.4);
  a.model = own;
  reset();
  a.setScript({ ops: [
    { op: 2, words: [0, 0, bake.table] },
    { op: 11, words: [windup] },
    { op: 10, words: [99, 0] },
    { op: 11, words: [tail] },
    { op: 2, words: [0, 0, 1] },
    { op: 255, words: [] },
  ] }, {}, { initialTable: bake.table });
  let aticks = 0;
  for (; aticks < 300; aticks++) { r.coordinator.tick(2); if (!a.vm || a.vm.ended) break; }
  a.model = own;
  reset();
  a.setScript({ ops: [
    { op: 2, words: [0, 0, bake.table] },
    { op: 11, words: [windup] },
    { op: 10, words: [99, 0] },
    { op: 11, words: [tail] },
    { op: 2, words: [0, 0, 1] },
    { op: 255, words: [] },
  ] }, {}, { initialTable: bake.table });
  const afterCanvas = document.createElement("canvas");
  afterCanvas.width = 4 * 480; afterCanvas.height = 2 * 336;
  const actx = afterCanvas.getContext("2d");
  actx.fillStyle = "#0d0d16"; actx.fillRect(0, 0, afterCanvas.width, afterCanvas.height);
  let t = 0;
  const start = Math.min(14, Math.max(1, aticks - 8));   // skip the camera cut at the head of the cast
  for (let k = 1; k <= 8; k++) {
    const goal = Math.max(1, Math.round(start + ((aticks - start) * (k - 1)) / 7));
    while (t < goal) { r.coordinator.tick(2); t++; }
    r.render(0);
    const x = ((k - 1) % 4) * 480, y = Math.floor((k - 1) / 4) * 336;
    actx.drawImage(off, x, y, 480, 336);
    actx.fillStyle = "#8cf"; actx.font = "bold 15px monospace";
    actx.fillText(`retarget clip ${clip} tick ${t} frame ${a.currentFrame()}`, x + 6, y + 18);
  }
  a.model = own;
  reset();
  return { before, after: afterCanvas.toDataURL("image/png"), ticks, aticks, covered: +bake.covered.toFixed(2) };
}, { target, source, clip, offset, cam });

if (res.error) console.log("ERROR", res.error);
else {
  const fs = await import("node:fs/promises");
  const b = `${out}/${prefix}-before-c${clip}-near.png`;
  const af = `${out}/${prefix}-after-c${clip}-near.png`;
  await fs.writeFile(b, Buffer.from(res.before.split(",")[1], "base64"));
  await fs.writeFile(af, Buffer.from(res.after.split(",")[1], "base64"));
  console.log(JSON.stringify({ before: b, after: af, ticks: res.ticks, aticks: res.aticks, covered: res.covered, cam }, null, 1));
}
if (errs.length) console.log("page errors:", errs.slice(0, 6));
await browser.close();
server.close();
