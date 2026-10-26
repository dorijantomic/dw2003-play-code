#!/usr/bin/env node
// A14 probe v15: where is the projectile ON SCREEN, really? One measurement per tick with the GAME camera:
//   A = body + flight (the user's frame)
//   B = body only (flights cleared)
//   C = empty (body hidden)
// flightPx = A vs B (what the flight adds to the user's frame), alone = B vs C (occlusion-free pixels),
// bodyPx = A vs C (body + flight). A 4x crop of A around the flight bbox is saved for the eye.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
const ROOT = resolve(import.meta.dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
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
const model = arg("model", "m172mtar"), tech = arg("tech", "150"), side = arg("side", "near");
const ticks = String(arg("ticks", "20,30,40,46,52,58,64")).split(",").map(Number);
const port = Number(arg("port", 8131));
const out = arg("out", "/home/dorij/scratch-research/a14");
const tag = arg("tag", `${model}-t${tech}-${side}`);
await mkdir(out, { recursive: true });
const server = await serve(port);
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=hit`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });
await page.evaluate(() => {
  const v = window.__viewer;
  const cb = document.getElementById("freeCam"); if (cb) { cb.checked = false; cb.dispatchEvent(new Event("change")); }
  v.state.freeCam = false; v.state.battleCamMode = "game";
  v.r.setCameraMode("game");
});
const res = await page.evaluate(async (ticks) => {
  const v = window.__viewer, r = v.r;
  const load = (d) => new Promise((res2) => { const im = new Image(); im.onload = () => res2(im); im.src = d; });
  const px = async (d) => {
    const im = await load(d);
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };
  const diff = (A, B) => {
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.d.length; i += 4) {
      const dd = Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]);
      if (dd > 6) { n++; const p = i >> 2, X = p % A.w, Y = (p / A.w) | 0; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    }
    return { n, bbox: x1 >= 0 ? [x0, y0, x1, y1] : null };
  };
  const rows = [];
  const saved = [];
  for (const t of ticks) {
    v.seek(0);
    for (let i = 0; i < t; i++) r.render(1 / 60);
    const flights = r.effectPlayer.projectiles.map((p) => ({ id: p.id, t: p.t, ticks: p.ticks, from: p.from.map(Math.round), to: p.to.map(Math.round) }));
    const urlA = await r.debugCaptureFrame();
    r.effectPlayer.projectiles.length = 0; r.render(0);
    const urlB = await r.debugCaptureFrame();
    r.setPlayerVisible(false); r.render(0);
    const urlC = await r.debugCaptureFrame();
    r.setPlayerVisible(true);
    const A = await px(urlA), B = await px(urlB), C = await px(urlC);
    const dAB = diff(A, B), dAC = diff(A, C), dBC = diff(B, C);
    saved.push({ t, urlA, bbox: dAB.bbox });
    rows.push({ t, flights, flightPx: dAB, bodyAndFlight: dAC, flightAlone: dBC });
  }
  return { rows, saved };
}, ticks);
for (const r of res.rows) {
  console.log(`t=${r.t} flights=${JSON.stringify(r.flights.map((f) => `${f.id}@${f.t}/${f.ticks}`))} ` +
    `flightPx(A-B)=${r.flightPx.n} bbox=${JSON.stringify(r.flightPx.bbox)} ` +
    `alone(B-C)=${r.flightAlone.n} bodyPlus(A-C)=${r.bodyAndFlight.n}`);
}
// 4x crops around the flight bbox written from the page's own data URLs
const crops = await page.evaluate(async (saved) => {
  const load = (d) => new Promise((res2) => { const im = new Image(); im.onload = () => res2(im); im.src = d; });
  const out = [];
  for (const s of saved) {
    if (!s.bbox) { out.push({ t: s.t, url: null }); continue; }
    const im = await load(s.urlA);
    const pad = 30, x = Math.max(0, s.bbox[0] - pad), y = Math.max(0, s.bbox[1] - pad);
    const w = Math.min(im.width - x, s.bbox[2] - s.bbox[0] + pad * 2), h = Math.min(im.height - y, s.bbox[3] - s.bbox[1] + pad * 2);
    const c = document.createElement("canvas"); c.width = w * 4; c.height = h * 4;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    g.drawImage(im, x, y, w, h, 0, 0, w * 4, h * 4);
    out.push({ t: s.t, crop: s.bbox, url: c.toDataURL("image/png") });
  }
  return out;
}, res.saved);
for (const c of crops) {
  if (!c.url) continue;
  await writeFile(`${out}/${tag}-t${c.t}-crop.png`, Buffer.from(c.url.split(",")[1], "base64"));
}
console.log("errors:", errs.slice(0, 5));
await writeFile(`${out}/${tag}-vis2.json`, JSON.stringify(res.rows, null, 1));
await browser.close();
server.close();
