#!/usr/bin/env node
// probe 5: the faithful tick (renderer's own tickSim: camera record + coordinator + effect player
// all advanced) — cost per tick, and the strike frame with the effect actually drawn.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".css": "text/css", ".wasm": "application/wasm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".bin": "application/octet-stream" };
function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://l").pathname));
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("nf"); }
  });
  return new Promise((ok, no) => { server.once("error", no); server.listen(port, "127.0.0.1", () => ok(server)); });
}
const PORT = 8107;
const server = await serve(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`http://127.0.0.1:${PORT}/web/battle-lab.html`, { waitUntil: "load" });
for (let i = 0; i < 400; i++) { if (await page.evaluate(() => !!window.__r?.playerAnimator)) break; await new Promise((r) => setTimeout(r, 50)); }

const PROBE = async () => {
  const r = window.__r;
  const fxMod = await import("/web/fight/effect-player.js");
  const b3 = await import("/web/battle3d.js");
  const st = {};
  window.__p = st;
  const STEP = 1 / 60;
  st.load = async (side, folder) => {
    if (side === "near") {
      await r.setPlayerDigimon(folder);
      for (let i = 0; i < 400 && !r.playerAnimator?.model; i++) await new Promise((x) => setTimeout(x, 25));
      return !!r.playerAnimator?.model;
    }
    const before = r.enemyAnimator;
    r.setEnemyDigimon(folder);
    for (let i = 0; i < 1200; i++) { if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) return true; await new Promise((x) => setTimeout(x, 25)); }
    return false;
  };
  st.time = () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) r.render(STEP);
    const tRender = (performance.now() - t0) / 100;
    const t1 = performance.now();
    for (let i = 0; i < 100; i++) { r.coordinator.tick(2); r.effectPlayer?.step(2); }
    const tTick = (performance.now() - t1) / 100;
    return { msPerRenderTick: tRender, msPerFastTick: tTick };
  };
  st.go = async (side, tech, lethal) => {
    const atk = side === "near" ? r.playerAnimator : r.enemyAnimator;
    const def = side === "near" ? r.enemyAnimator : r.playerAnimator;
    atk.setIdle(); def.setIdle(); r.effectPlayer?.clear();
    r.setCameraMode("director", { scriptOwnsCamera: false });
    for (let i = 0; i < 20; i++) r.render(STEP);
    r.setCameraMode("behind", { scriptOwnsCamera: false });
    r.render(0);
    let hits = [], fx = [], cams = [], aux = [], defClips = [];
    let prevD = !!def.vm;
    let last99 = null, lastStrike = null;
    const hooks = {
      onHit: (x) => { hits.push({ t: clock, type: x.type }); if (x.type === 99) last99 = clock; if (x.type === 99 || x.type === 98) lastStrike = clock; },
      onEffect: (x) => fx.push({ t: clock, type: x.type, x: x.x, y: x.y, z: x.z }),
      onCamera: (x) => cams.push({ t: clock, words: x.words.slice() }),
      onAuxAction: (x) => aux.push({ t: clock, mode: x.mode }),
    };
    let clock = 0;
    const ok = side === "near" ? r.playerAttack(tech, { ...hooks, lethal }) : r.enemyAttack(tech, { ...hooks, lethal });
    // faithful: one renderer tick per step (camera record, both actors, effects)
    let t = 0, shot = null, pngStrike = null;
    const canvasShot = () => {
      const draw = r.getEffectDraw();
      const cv = document.getElementById("cv");
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(window.__off, 0, 0);
      if (draw) fxMod.drawEffects(ctx, draw.list, draw.manifest, draw.images, draw.view);
      return { png: cv.toDataURL("image/png"), renderList: r.effectPlayer?.renderList?.().length ?? null, drawNull: !draw };
    };
    for (t = 1; t <= 600; t++) {
      clock = t;
      r.setCameraMode("behind", { scriptOwnsCamera: r.coordinator.active });
      r.render(STEP);
      if (!!def.vm !== prevD) { defClips.push({ t, clip: def._clip, vm: !!def.vm }); prevD = !!def.vm; }
      if (last99 != null && t === last99 + 1 && !pngStrike) { shot = t; pngStrike = canvasShot(); }
      if (!atk.vm && !def.vm && (last99 == null || t > last99 + 2)) break;
    }
    const dbg = r.__dnaDebug();
    const endShot = canvasShot();
    return {
      ok, ticks: t, last99, lastStrike, shot, hits, fx, cams, aux, defClips,
      defEnd: { vm: !!def.vm, clip: def._clip, held: def._heldPose },
      camRecord: dbg.camRecord ? { kind: dbg.camRecord.kind, issuer: dbg.camRecord.issuer, preset: dbg.camRecord.preset } : null,
      strike: pngStrike ? { renderList: pngStrike.renderList, drawNull: pngStrike.drawNull } : null,
      endDraw: { renderList: endShot.renderList, drawNull: endShot.drawNull },
      png: (pngStrike?.png ?? endShot.png),
    };
  };
  return true;
};
await page.evaluate(PROBE);

const out = "/home/dorij/.hermes/profiles/rverify/cache/scratch";
await page.evaluate((f) => window.__p.load("near", f), "m005grey");
await page.evaluate((f) => window.__p.load("far", f), "m051kuwa");
console.log("timing", JSON.stringify(await page.evaluate(() => window.__p.time())));
for (const [folder, lethal] of [["m441raiz", false], ["m440sijn", false], ["m005grey", false]]) {
  await page.evaluate((f) => window.__p.load("near", f), folder);
  const res = await page.evaluate(({ lethal }) => window.__p.go("near", 1, lethal), { lethal });
  const { png, ...rest } = res;
  await writeFile(`${out}/a7a5-${folder}-c5.png`, Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64"));
  console.log(folder, JSON.stringify(rest));
}
await browser.close();
await new Promise((r) => server.close(r));
