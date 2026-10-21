#!/usr/bin/env node
// Quick smoke probe for the animation viewer: load the page, report console/page errors, and dump
// the state the verifier depends on. Not a gate; the gate is tools/verify_anim_viewer.mjs.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 8116;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".bin": "application/octet-stream" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let p = join(ROOT, decodeURIComponent(url.pathname));
    const s = await stat(p).catch(() => null);
    if (!s) { res.writeHead(404); return res.end("not found"); }
    if (s.isDirectory()) p = join(p, "index.html");
    const body = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`console.${m.type()}: ${m.text()}`); });
const missing = [];
page.on("response", (r) => { if (r.status() === 404) missing.push(r.url()); });
await page.goto(`http://127.0.0.1:${PORT}/web/anim-viewer.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer && window.__viewer.state.entry, null, { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => window.__viewer?.state?.action, null, { timeout: 60000 }).catch(() => {});
const info = await page.evaluate(() => {
  const v = window.__viewer;
  return {
    hasR: !!window.__r,
    entry: v?.state.entry?.name || null,
    folder: v?.state.folder || null,
    actions: v?.state.actions?.length ?? null,
    action: v?.state.action?.name || null,
    clip: v?.state.clip,
    maxTick: v?.state.maxTick,
    marks: v?.state.marks?.length,
    camMode: window.__r?.getCameraMode?.(),
    bounds: window.__r?.getFighterBounds?.("player"),
    listItems: document.querySelectorAll("#species li").length,
    title: document.getElementById("title")?.textContent,
  };
});
console.log(JSON.stringify(info, null, 2));
// play the default action and screenshot the strike
const run = await page.evaluate(() => {
  const v = window.__viewer;
  v.seek(0);
  const p0 = v.pose();
  const res = v.runToEnd();
  const p1 = v.pose();
  let diff = 0;
  for (let i = 0; i < Math.min(p0.length, p1.length); i++) diff = Math.max(diff, Math.abs(p0[i] - p1[i]));
  return { res, poseDiff: diff, tick: v.state.tick, maxTick: v.state.maxTick, marks: v.state.marks.map((m) => [m.tick, m.text]) };
});
console.log("RUN:", JSON.stringify(run));
await page.screenshot({ path: "/home/dorij/scratch-research/anim-sheets/a13-probe.png" });
console.log("ERRORS:", errors.filter((e) => !e.includes("404")).slice(0, 20));
console.log("MISSING:", [...new Set(missing)].slice(0, 20));
await browser.close();
server.close();
