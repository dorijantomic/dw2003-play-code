#!/usr/bin/env node
// A14 probe v6: is the projectile hidden BEHIND the body? Capture the same tick with the fighter
// visible and hidden, and count pixels for the flight alone.
//   tools/run-playwright.sh tools/a14-viewer-probe6.mjs --model m172mtar --tech 150 --ticks 40,48,52
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
const ticks = String(arg("ticks", "40,48,52")).split(",").map(Number);
const port = Number(arg("port", 8126));
const out = arg("out", "/home/dorij/scratch-research/a14");
await mkdir(out, { recursive: true });
const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=hit`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });

const rows = await page.evaluate(async (ticks) => {
  const v = window.__viewer, r = v.r;
  const png = async () => await r.debugCaptureFrame();
  const load = (d) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = d; });
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
  const res = [];
  for (const t of ticks) {
    // A: body visible, projectiles present
    v.seek(0); for (let i = 0; i < t; i++) r.render(1 / 60);
    const flights = r.effectPlayer.projectiles.map((p) => ({ id: p.id, t: p.t }));
    const A = await px(await png());
    // B: same frame, projectiles cleared
    r.effectPlayer.projectiles.length = 0; r.render(0);
    const B = await px(await png());
    // C: body HIDDEN, projectiles back (respawn by restarting the clip with the body hidden)
    r.setPlayerVisible(false);
    v.seek(0); for (let i = 0; i < t; i++) r.render(1 / 60);
    const C = await px(await png());
    r.effectPlayer.projectiles.length = 0; r.render(0);
    const D = await px(await png());
    r.setPlayerVisible(true);
    v.seek(0); r.render(0);
    res.push({ tick: t, flights, visibleBody: count(A, B), hiddenBody: count(C, D) });
  }
  return res;
}, ticks);
for (const r of rows) console.log(`tick ${r.tick} flights=${JSON.stringify(r.flights)} bodyVisible=${JSON.stringify(r.visibleBody)} bodyHidden=${JSON.stringify(r.hiddenBody)}`);
console.log("errors:", errs.slice(0, 5));
await writeFile(`${out}/${model}-t${tech}-${side}-occlusion.json`, JSON.stringify(rows, null, 1));
await browser.close();
server.close();
