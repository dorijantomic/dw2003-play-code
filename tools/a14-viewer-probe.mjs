#!/usr/bin/env node
// A14: measure a cast in the REAL anim viewer — is a projectile flight actually alive, where is it,
// does it reach the defender, and is it on screen? Playwright + the shipped renderer.
//
//   tools/run-playwright.sh tools/a14-viewer-probe.mjs --model m172mtar --tech 150 --side near --out disc
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
const port = Number(arg("port", 8120));
const out = arg("out", "/home/dorij/scratch-research/a14");
const shots = String(arg("shots", "")).split(",").filter(Boolean).map(Number);
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
await page.goto(`http://127.0.0.1:${port}/web/anim-viewer.html?model=${model}&tech=${tech}&side=${side}&outcome=${outcome}`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__viewer?.state?.script, null, { timeout: 90000 });

const info = await page.evaluate(() => {
  const v = window.__viewer, s = v.state, r = v.r;
  const atk = s.side === "near" ? r.playerAnimator : r.enemyAnimator;
  const def = s.side === "near" ? r.enemyAnimator : r.playerAnimator;
  return {
    maxTick: s.maxTick, clip: s.clip, techId: s.techId, build: s.script?.buildKind ?? null,
    folder: s.folder, defender: s.defender,
    atkHome: atk?.homeSlot ?? null, defHome: def?.homeSlot ?? null,
    atkMove: atk?.moveDelta?.() ?? null,
    ops: (s.script?.ops ?? []).map((o) => `${o.op}:[${(o.words || []).join(",")}]`),
    freeCam: s.freeCam, camMode: r.getCameraMode?.() ?? null,
  };
});
console.log("INFO", JSON.stringify(info, null, 1));

const perTick = [];
const MAX = Math.min(info.maxTick, 400);
for (let t = 0; t <= MAX; t++) {
  const row = await page.evaluate((t) => {
    const v = window.__viewer, r = v.r;
    r.effectPlayer.projectiles.length = 0;      // re-launch each tick: count only this tick's spawns
    v.seek(t);
    const ep = r.effectPlayer;
    const list = ep.projectiles.map((p) => ({
      id: p.id, t: p.t, ticks: p.ticks,
      from: p.from.map(Math.round), to: p.to.map(Math.round),
      pos: ep.projectileList().find((q) => q.id === p.id && q.t === p.t)?.pos ?? null,
      registered: !!p.flight?.registered,
      meshReady: r.debugProjectileReady?.(p.id) ?? null,
    }));
    const st = r.getStatus?.() ?? {};
    const atk = v.state.side === "near" ? r.playerAnimator : r.enemyAnimator;
    return { tick: t, n: list.length, list, move: atk?.moveDelta?.() ?? null, st: {
      enemyVisible: st.enemyVisible, enemyAnim: st.enemyAnim, moveDelta: st.moveDelta } };
  }, t);
  perTick.push(row);
}
const flying = perTick.filter((r) => r.n > 0);
console.log("ticks with a live flight:", flying.length, "of", perTick.length);
for (const r of flying.slice(0, 60)) {
  console.log(r.tick, "n=" + r.n, JSON.stringify(r.list));
}
const moves = perTick.map((r) => `${r.tick}:${(r.move || [0, 0, 0]).map(Math.round).join("/")}`);
console.log("move samples:", moves.filter((_, i) => i % 10 === 0).join(" "));

// screenshots at chosen ticks (and at the strike)
const strike = (() => {
  const i = info.ops.findIndex((o) => o.startsWith("10:[99"));
  return i;
})();
const at = shots.length ? shots : [0, 6, 12, 24, 40, Math.max(1, Math.round(MAX * 0.6)), MAX];
for (const t of at) {
  await page.evaluate((t) => { const v = window.__viewer; v.r.effectPlayer.projectiles.length = 0; v.seek(t); }, t);
  const p = `${out}/${model}-t${tech}-${side}-${t}.png`;
  await page.screenshot({ path: p });
  console.log("shot", p);
}
console.log("errors:", errs.slice(0, 10));
await writeFile(`${out}/${model}-t${tech}-${side}-ticks.json`, JSON.stringify({ info, perTick }, null, 1));
await browser.close();
server.close();
