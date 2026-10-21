#!/usr/bin/env node
// A14 probe v9: SAVE the pinned-projectile frames so they can be looked at.
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
const id = Number(arg("id", 210));
const ticks = String(arg("ticks", "5,30,60")).split(",").map(Number);
const port = Number(arg("port", 8128));
const out = arg("out", "/home/dorij/scratch-research/a14");
await mkdir(out, { recursive: true });
const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&clip=5`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });
for (const t of ticks) {
  const png = await page.evaluate(async ({ id, t }) => {
    const r = window.__viewer.r;
    let ready = false;
    for (let n = 0; n < 100 && !ready; n++) { ready = r.debugProjectileReady(id); if (!ready) await new Promise((x) => setTimeout(x, 50)); }
    r.effectPlayer.clear();
    r.debugRenderProjectileAt(id, t, { side: "player", from: [0, -1500, -3000], to: [0, 2048, 0] });
    return await r.debugCaptureFrame();
  }, { id, t });
  const f = `${out}/pin-${id}-t${t}.png`;
  await writeFile(f, Buffer.from(png.split(",")[1], "base64"));
  console.log(f);
}
await browser.close();
server.close();
