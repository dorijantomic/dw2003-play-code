#!/usr/bin/env node
// A14 probe v2: drive the REAL viewer one render tick at a time (the live path: r.render(1/60)
// steps the sim AND the effect player), and record every projectile flight's drawn layer position.
//
//   tools/run-playwright.sh tools/a14-viewer-probe2.mjs --model m172mtar --tech 150 --side near
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
const port = Number(arg("port", 8121));
const out = arg("out", "/home/dorij/scratch-research/a14");
const shotAt = String(arg("shots", "")).split(",").filter(Boolean).map(Number);
const camMode = arg("cam", "free");
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=${outcome}`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });

// install a per-tick recorder INSIDE the page: it wraps r.render, and after each render records the
// live flights with their DRAWN layer world position (proj-layers, the renderer's own arithmetic)
await page.evaluate(async () => {
  const v = window.__viewer, r = v.r;
  const PL = await import("./fight/proj-layers.js");
  const packs = new Map();
  const packFor = async (id) => {
    if (!packs.has(id)) packs.set(id, await (await fetch(`assets/battle/effects/proj/${id}.json`)).json().catch(() => null));
    return packs.get(id);
  };
  window.__rec = [];
  const orig = r.render.bind(r);
  window.__tickRender = (dt) => orig(dt);
  // preload the packs the script names so the recorder is synchronous
  const ids = new Set((v.state.script?.ops ?? []).filter((o) => o.op === 6).map((o) => o.words?.[1]));
  for (const id of ids) await packFor(id);
  v.__packFor = packFor; v.__PL = PL;
});
const ticks = await page.evaluate(async () => {
  const v = window.__viewer, r = v.r, PL = v.__PL;
  const rec = [];
  v.seek(0);
  const orig = r.render.bind(r);
  const MAX = Math.min(v.state.maxTick, 400);
  for (let t = 0; t <= MAX; t++) {
    // snapshot BEFORE the step (the frame the renderer last drew)
    const ep = r.effectPlayer;
    const flights = [];
    for (const p of ep.projectiles) {
      const pack = await v.__packFor(p.id);
      let layer = null, shown = null;
      if (pack) {
        const M = PL;
        const root = M.mat4Mul(M.mat4Translate(p.from[0], p.from[1], p.from[2]),
                               M.mat4RotPSX(p.to[0], p.to[1], p.to[2]));
        const frame = M.clipFrameAt(pack.clip, p.t);
        const w = M.projLayerWorlds(pack.layers, frame, root);
        layer = [Math.round(w.world[1][12]), Math.round(w.world[1][13]), Math.round(w.world[1][14])];
        shown = w.shown[1];
      }
      flights.push({ id: p.id, t: p.t, ticks: p.ticks, from: p.from.map(Math.round), to: p.to.map(Math.round), layer, shown });
    }
    const atk = v.state.side === "near" ? r.playerAnimator : r.enemyAnimator;
    rec.push({ tick: t, frame: atk?.currentFrame?.() ?? null, move: (atk?.moveDelta?.() ?? [0, 0, 0]).map(Math.round), flights });
    orig(1 / 60);
  }
  return rec;
});
const info = await page.evaluate(() => {
  const v = window.__viewer, s = v.state, r = v.r;
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  const def = s.side === "near" ? r.enemyAnimator : r.playerAnimator;
  return { maxTick: s.maxTick, clip: s.clip, build: s.script?.buildKind ?? null, folder: s.folder,
           atkHome: atk?.homeSlot ?? null, defHome: def?.homeSlot ?? null,
           ops: (s.script?.ops ?? []).filter((o) => [3, 5, 6, 10].includes(o.op)).map((o) => `${o.op}:[${(o.words || []).join(",")}]`) };
});
console.log("INFO", JSON.stringify(info, null, 1));
const withFlights = ticks.filter((t) => t.flights.length);
console.log(`\nticks with a flight: ${withFlights.length} (first ${withFlights[0]?.tick}, last ${withFlights[withFlights.length - 1]?.tick})`);
for (const t of withFlights) {
  const f = t.flights[0];
  console.log(`${t.tick} t=${f.t} id=${f.id} shown=${f.shown} layer=${JSON.stringify(f.layer)} from=${JSON.stringify(f.from)} move=${t.move}`);
}
const moves = ticks.filter((t) => t.move.some((v) => v !== 0));
console.log("\nnon-zero move ticks:", moves.length, moves.slice(0, 6).map((t) => `${t.tick}:${t.move.join("/")}`).join(" "));
await writeFile(`${out}/${model}-t${tech}-${side}-seq.json`, JSON.stringify({ info, ticks }, null, 1));
// screenshots mid-flight
const at = shotAt.length ? shotAt : (withFlights.length ? [withFlights[0].tick + 10, withFlights[0].tick + 30, withFlights[Math.floor(withFlights.length / 2)].tick] : [10]);
for (const t of at) {
  await page.evaluate((t) => {
    const v = window.__viewer, r = v.r;
    v.seek(0);
    for (let i = 0; i < t; i++) r.render(1 / 60);
  }, t);
  const p = `${out}/${model}-t${tech}-${side}-live${t}.png`;
  await page.screenshot({ path: p });
  console.log("shot", p);
}
console.log("errors:", errs.slice(0, 5));
await browser.close();
server.close();
