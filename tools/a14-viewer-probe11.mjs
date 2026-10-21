#!/usr/bin/env node
// A14 probe v11: is the projectile drawn but OCCLUDED by the caster's own body?
// At tick t: A = body+flight, B = flight only (body hidden AFTER the step, render(0)), C = empty.
//   ball px = count(B,C)   body px = count(A,B)
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
const model = arg("model", "m172mtar");
const tech = arg("tech", "150");
const side = arg("side", "near");
const ticks = String(arg("ticks", "30,40,48,52,56,60")).split(",").map(Number);
const cam = arg("cam", "free");
const port = Number(arg("port", 8129));
const out = arg("out", "/home/dorij/scratch-research/a14");
await mkdir(out, { recursive: true });
const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=hit`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });
if (cam === "game") {
  await page.evaluate(() => {
    const v = window.__viewer;
    v.state.freeCam = false; v.state.battleCamMode = "game";
    const cb = document.getElementById("freeCam"); if (cb) cb.checked = false;
    v.r.setCameraMode("game");
  });
}
const res = await page.evaluate(async (ticks) => {
  const v = window.__viewer, r = v.r;
  const load = (d) => new Promise((res2) => { const im = new Image(); im.onload = () => res2(im); im.src = d; });
  const px = async (d) => {
    const im = await load(d);
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };
  const count = (A, B) => {
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.d.length; i += 4) {
      const dd = Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]);
      if (dd > 6) { n++; const p = i >> 2, X = p % A.w, Y = (p / A.w) | 0; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    }
    return { n, bbox: x1 >= 0 ? [x0, y0, x1, y1] : null };
  };
  const rows = [];
  for (const t of ticks) {
    v.seek(0);
    for (let i = 0; i < t; i++) r.render(1 / 60);
    const flights = r.effectPlayer.projectiles.map((p) => ({ id: p.id, t: p.t }));
    const A = await px(await r.debugCaptureFrame());
    r.setPlayerVisible(false); r.render(0);
    const B = await px(await r.debugCaptureFrame());
    r.effectPlayer.projectiles.length = 0; r.render(0);
    const C = await px(await r.debugCaptureFrame());
    r.setPlayerVisible(true);
    rows.push({ tick: t, flights, bodyOnly: count(A, B), flightHiddenBody: count(B, C) });
  }
  return rows;
}, ticks);
for (const r of res) console.log(`tick ${r.tick} flights=${JSON.stringify(r.flights)} bodyPx=${r.bodyOnly.n} flightPx(bodyHidden)=${r.flightHiddenBody.n} bbox=${JSON.stringify(r.flightHiddenBody.bbox)}`);
console.log("errors:", errs.slice(0, 5));
await writeFile(`${out}/${model}-occlusion2.json`, JSON.stringify(res, null, 1));
await browser.close();
server.close();
