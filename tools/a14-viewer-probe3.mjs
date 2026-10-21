#!/usr/bin/env node
// A14 probe v3: DOES THE PROJECTILE PUT ANY PIXEL ON SCREEN? Deterministic: re-run the clip to tick t,
// capture the GL frame, clear the flights, redraw the same frame, and diff the two images.
// The diff's pixel count / bbox is the projectile's real drawn footprint in the shipped renderer.
//
//   tools/run-playwright.sh tools/a14-viewer-probe3.mjs --model m172mtar --tech 150 --side near
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
const outcome = arg("outcome", "hit");
const port = Number(arg("port", 8122));
const out = arg("out", "/home/dorij/scratch-research/a14");
const step = Number(arg("step", 6));
const cam = arg("cam", "free");       // free | game
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=${outcome}`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });
if (cam === "game") {
  await page.evaluate(() => {
    const v = window.__viewer;
    v.state.freeCam = false; v.state.battleCamMode = "game";
    const cb = document.getElementById("freeCam"); if (cb) cb.checked = false;
    v.r.setCameraMode("game");
  });
}

const result = await page.evaluate(async ({ step }) => {
  const v = window.__viewer, r = v.r;
  const MAX = Math.min(v.state.maxTick, 400);
  const diffs = [];
  const frame = async (t) => {
    v.seek(0);
    for (let i = 0; i < t; i++) r.render(1 / 60);
    return await r.debugCaptureFrame();
  };
  const diff = async (a, b) => {
    const load = (d) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = d; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement("canvas");
    c.width = ia.width; c.height = ia.height;
    const g = c.getContext("2d");
    g.drawImage(ia, 0, 0);
    const A = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(ib, 0, 0);
    const B = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, peak = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d > 6) {
        n++;
        const px = (i >> 2) % c.width, py = Math.floor((i >> 2) / c.width);
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (d > peak) peak = d;
      }
    }
    return { n, bbox: x1 >= 0 ? [x0, y0, x1, y1] : null, w: c.width, h: c.height, peak };
  };
  for (let t = step; t <= MAX; t += step) {
    const withA = await frame(t);
    const flights = r.effectPlayer.projectiles.map((p) => ({ id: p.id, t: p.t }));
    r.effectPlayer.projectiles.length = 0;
    r.render(0);
    const without = await r.debugCaptureFrame();
    const d = await diff(withA, without);
    diffs.push({ tick: t, flights, ...d });
  }
  return diffs;
}, { step });

console.log("tick | flights | drawn px | bbox | canvas");
for (const d of result) console.log(`${d.tick} | ${JSON.stringify(d.flights)} | ${d.n} | ${JSON.stringify(d.bbox)} | ${d.w}x${d.h} peak=${d.peak}`);
await writeFile(`${out}/${model}-t${tech}-${side}-pixels.json`, JSON.stringify(result, null, 1));
console.log("errors:", errs.slice(0, 5));
await browser.close();
server.close();
