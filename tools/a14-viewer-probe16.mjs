#!/usr/bin/env node
// A14 probe v16 (cheap, final): the user's viewer URL, game camera, defender shown. For a handful of
// ticks: what the EffectPlayer holds (id, elapsed, from, to) + a PNG. The drawn point and its screen
// position are computed in Node from the SAME shipped modules the renderer uses (proj-layers + battle3d).
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { chromium } from "playwright";
import * as PL from "../web/fight/proj-layers.js";
import * as b3 from "../web/battle3d.js";
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
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const model = arg("model", "m172mtar"), tech = arg("tech", "150"), side = arg("side", "near");
const ticks = String(arg("ticks", "24,32,40,48,56,64")).split(",").map(Number);
const port = Number(arg("port", 8133));
const out = arg("out", "/home/dorij/scratch-research/a14");
const tag = arg("tag", `${model}-t${tech}-${side}`);
await mkdir(out, { recursive: true });
await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=hit`, { waitUntil: "load" });
// leave the viewer's own camera and UI exactly as the page opens (the operator's URL)
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 180000 });
const rows = [];
for (const t of ticks) {
  const row = await page.evaluate((t) => {
    const v = window.__viewer, r = v.r;
    v.seek(0);
    for (let i = 0; i < t; i++) r.render(1 / 60);
    const pl = r.effectPlayer.projectiles.map((p) => ({ id: p.id, t: p.t, ticks: p.ticks,
      from: p.from.map(Math.round), to: p.to.map(Math.round), side: p.side }));
    return { t, flights: pl, frame: r.attacker?.()?.currentFrame?.() ?? null,
             defPos: v.state?.defender?.home ? null : (window.__viewer.defenderHome?.() ?? null) };
  }, t);
  await page.screenshot({ path: `${out}/${tag}-t${t}.png` });
  // drawn point of layer 1 from the shipped builder (same math the renderer does)
  if (row.flights.length) {
    const f = row.flights[0];
    let pack = null;
    try { pack = JSON.parse(await readFile(join(ROOT, `web/assets/battle/effects/proj/${f.id}.json`), "utf8")); } catch {}
    if (pack?.layers) {
      const frame = PL.clipFrameAt(pack.clip, f.t);
      const root = PL.mat4Mul(PL.mat4Translate(f.from[0], f.from[1], f.from[2]),
                              PL.mat4RotPSX(f.to[0], f.to[1], f.to[2]));
      const { world, shown } = PL.projLayerWorlds(pack.layers, frame, root);
      row.frameUsed = frame;
      row.shown = shown;
      row.world1 = world[1] ? [Math.round(world[1][12]), Math.round(world[1][13]), Math.round(world[1][14])] : null;
    }
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log("errors:", errs.slice(0, 3));
await writeFile(`${out}/${tag}-viewer16.json`, JSON.stringify(rows, null, 1));
await browser.close();
server.close();
