import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    const p = resolve(ROOT, "." + decodeURIComponent(url.pathname));
    if (p !== ROOT && !p.startsWith(ROOT + "/")) throw new Error("outside");
    const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { console.log("404", req.url); res.writeHead(404); res.end("not found"); }
});
await new Promise((d) => server.listen(8129, "127.0.0.1", d));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const folder = process.argv[2] || "m228piem", tech = process.argv[3] || "167";
await page.goto(`http://127.0.0.1:8129/web/anim-viewer.html?model=${folder}&tech=${tech}&side=near&outcome=hit`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });
const out = await page.evaluate(() => {
  const v = window.__viewer, s = v.state;
  return { maxTick: s.maxTick, clip: s.clip, marks: s.marks, ops: (s.script?.ops || []).map((o) => [o.op, o.words]), build: s.script?.buildKind, retargeted: !!s.script?.retargeted, action: s.action };
});
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await browser.close(); server.close();
