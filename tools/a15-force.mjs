#!/usr/bin/env node
// A15: force the OLD K16 donor (HiAndromon m356hand) onto Boltmon's model inside the real viewer and
// look at what the user saw (a second axe, a flat pose). Screenshots + the effect list per tick.
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
const model = arg("model", "m190bolt");
const tech = arg("tech", "159");
const donor = arg("donor", "m356hand");
const side = arg("side", "near");
const port = Number(arg("port", 8123));
const out = arg("out", "/home/dorij/scratch-research/a15");
await mkdir(out, { recursive: true });
const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 120000 });

const forced = await page.evaluate(async ([donorFolder]) => {
  const v = window.__viewer, r = v.r, s = v.state;
  const ar = await import("/web/fight/anim-retarget.js");
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  const donorAnim = await (await fetch(`/web/assets/battle/models/${donorFolder}/anim.json`)).json();
  const bake = ar.applyCastBake(atk.model, donorAnim, 9);
  if (!bake) return { err: "no bake" };
  atk.model.castBakes = { 9: bake };
  atk.setAction(9, {}, { element: 6, target: "enemy", tech: null });
  return { table: bake.table, gate: bake.gate, offset: bake.offset,
           ops: (atk.vm?.script?.ops ?? []).map((o) => `${o.op}:[${(o.words || []).join(",")}]${o.launch ? " @" + o.launch.id : ""}`) };
}, [donor]);

const rows = [];
for (let k = 0; k <= 120; k += 6) {
  const row = await page.evaluate(async (n) => {
    const v = window.__viewer, r = v.r, s = v.state;
    const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
    for (let i = 0; i < n; i++) r.coordinator.tick(2);
    r.render(0);
    const fx = r.getEffectDraw?.();
    const b3 = await import("/web/battle3d.js");
    const f = atk.currentFrame();
    const b19 = atk.model.bones[19];
    const s19 = b19?.anim?.ch3 ? b3.interpChannel(b19.anim.ch3, f) : null;
    return { tick: n, frame: f, table: atk.timelineTable, idle: !atk.vm,
             axe19: s19 ? +(Math.max(...s19.map(Math.abs)) / 4096).toFixed(2) : null,
             fx: fx ? fx.list.map((e) => `${e.arch ?? e.program}/${e.frame}/${e.side}`) : null,
             proj: r.effectPlayer?.projectiles?.map((p) => ({ id: p.id, t: p.t })) ?? null };
  }, 6);
  rows.push(row);
  if ([0, 18, 30, 48, 66, 90, 120].includes(k)) await page.screenshot({ path: resolve(out, `${model}-forced-${donor}-t${k}.png`) });
}
console.log(JSON.stringify({ forced, rows, errs: errs.slice(0, 5) }, null, 1));
await browser.close();
server.close();
