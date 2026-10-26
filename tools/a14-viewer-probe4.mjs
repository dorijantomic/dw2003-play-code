#!/usr/bin/env node
// A14 probe v4: capture the REAL GL frame at chosen ticks (no UI), so the projectile is visible/measurable.
//   tools/run-playwright.sh tools/a14-viewer-probe4.mjs --model m172mtar --tech 150 --ticks 24,40,48,56
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
const cam = arg("cam", "free");
const ticks = String(arg("ticks", "24,40,48,56")).split(",").map(Number);
const port = Number(arg("port", 8123));
const out = arg("out", "/home/dorij/scratch-research/a14");
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
for (const t of ticks) {
  const r = await page.evaluate(async (t) => {
    const v = window.__viewer, r = v.r;
    v.seek(0);
    for (let i = 0; i < t; i++) r.render(1 / 60);
    const flights = r.effectPlayer.projectiles.map((p) => ({ id: p.id, t: p.t, from: p.from.map(Math.round), to: p.to.map(Math.round) }));
    const png = await r.debugCaptureFrame();
    return { flights, png };
  }, t);
  const file = `${out}/${model}-t${tech}-${side}-${cam}-f${t}.png`;
  await writeFile(file, Buffer.from(r.png.split(",")[1], "base64"));
  console.log(t, JSON.stringify(r.flights), "->", file);
}
console.log("errors:", errs.slice(0, 5));
await browser.close();
server.close();
