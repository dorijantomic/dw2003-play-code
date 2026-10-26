#!/usr/bin/env node
// a6-shot.mjs - screenshot a battle-lab model (near or far) for A6 donor research.
//   tools/run-playwright.sh tools/a6-shot.mjs --model m178kngt,m369duke --cam director --out /home/dorij/scratch-research/anim-sheets --prefix a6-id
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
      const rel = decodeURIComponent(url.pathname);
      const path = resolve(ROOT, "." + rel);
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
const models = String(arg("model", "")).split(",").filter(Boolean);
const side = arg("side", "near");
const cam = arg("cam", "director");
const out = arg("out", "/home/dorij/scratch-research/anim-sheets");
const prefix = arg("prefix", "a6");
const port = Number(arg("port", 8106));
const ticks = Number(arg("ticks", 60));
const clip = arg("clip", null);
if (!models.length) { console.error("--model needed"); process.exit(2); }
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
await page.evaluate(({ cam }) => {
  const sel = document.getElementById("cam");
  if (sel) { sel.value = cam; sel.dispatchEvent(new Event("change")); }
}, { cam });
for (const folder of models) {
  const res = await page.evaluate(async ({ folder, side, ticks, clip }) => {
    const r = window.__r, off = window.__off;
    if (!r || !off) return { error: "no renderer" };
    if (side === "near") {
      const ok = await r.setPlayerDigimon(folder);
      if (!ok) return { error: `setPlayerDigimon(${folder}) failed` };
    } else {
      const before = r.enemyAnimator;
      r.setEnemyDigimon(folder);
      const t = Date.now();
      while (Date.now() - t < 20000) {
        if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) break;
        await new Promise((x) => setTimeout(x, 40));
      }
      if (!r.enemyAnimator || r.enemyAnimator === before) return { error: "far model did not load" };
    }
    const a = side === "near" ? r.playerAnimator : r.enemyAnimator;
    a.setIdle();
    for (let i = 0; i < 24; i++) r.coordinator.tick(2);
    if (clip != null) {
      const started = a.setAction(Number(clip), {}, { element: 1 });
      if (!started) return { error: `clip ${clip} refused` };
      for (let i = 0; i < Math.max(1, Math.min(ticks, 200)); i++) r.coordinator.tick(2);
    } else {
      for (let i = 0; i < Math.max(1, ticks); i++) r.coordinator.tick(2);
    }
    r.render(0);
    const S = document.createElement("canvas");
    S.width = off.width; S.height = off.height;
    const ctx = S.getContext("2d");
    ctx.drawImage(off, 0, 0);
    return { png: S.toDataURL("image/png"), frame: a.currentFrame?.() ?? null,
             bones: a.model?.num_bones ?? null, folder, clip };
  }, { folder, side, ticks, clip });
  if (res.error) { console.log(folder, "ERROR", res.error); continue; }
  const fs = await import("node:fs/promises");
  const file = `${out}/${prefix}-${folder}-${side}.png`;
  await fs.writeFile(file, Buffer.from(res.png.split(",")[1], "base64"));
  console.log(folder, "->", file, "frame", res.frame, "bones", res.bones);
}
if (errs.length) console.log("page errors:", errs.slice(0, 5));
await browser.close();
server.close();
