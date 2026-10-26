import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
const ROOT = resolve(import.meta.dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
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
await new Promise((ok) => server.listen(8135, "127.0.0.1", ok));
const t0 = Date.now();
const browser = await chromium.launch({ ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
page.on("pageerror", (e) => logs.push(`ERR: ${e.message}`.slice(0, 300)));
await page.goto("http://127.0.0.1:8135/web/anim-viewer.html?model=m172mtar&tech=150&side=near&outcome=hit", { waitUntil: "domcontentloaded" });
console.log("loaded in", Date.now() - t0, "ms");
try {
  await page.waitForFunction(() => !!window.__viewer, null, { timeout: 20000 });
  console.log("__viewer in", Date.now() - t0, "ms");
} catch (e) { console.log("no __viewer:", e.message.slice(0, 120)); }
try {
  await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 30000 });
  console.log("script in", Date.now() - t0, "ms");
} catch (e) { console.log("no script:", e.message.slice(0, 120)); }
const info = await page.evaluate(() => ({ v: !!window.__viewer, st: window.__viewer?.state?.script ? "yes" : "no",
  gl: (() => { try { const c = document.createElement("canvas"); return !!c.getContext("webgl2"); } catch (e) { return String(e.message); } })(),
  errs: window.__errs?.slice?.(0, 3) ?? null }));
console.log("info", JSON.stringify(info));
console.log(logs.slice(0, 12).join("\n"));
await browser.close(); server.close();
