#!/usr/bin/env node
// probe 3: why is getEffectDraw() null, and what does the strike frame actually look like?
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
  const st = {};
  window.__p = st;
  st.load = async (side, folder) => {
    if (side === "near") {
      const ok = await r.setPlayerDigimon(folder);
      for (let i = 0; i < 400 && !r.playerAnimator?.model; i++) await new Promise((x) => setTimeout(x, 25));
      return !!r.playerAnimator?.model;
    }
    const before = r.enemyAnimator;
    r.setEnemyDigimon(folder);
    for (let i = 0; i < 1200; i++) { if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) return true; await new Promise((x) => setTimeout(x, 25)); }
    return false;
  };
  st.go = async (tech, lethal) => {
    const atk = r.playerAnimator, def = r.enemyAnimator;
    atk.setIdle(); def.setIdle(); r.effectPlayer?.clear();
    for (let i = 0; i < 30; i++) { r.setCameraMode("director", { scriptOwnsCamera: false }); r.render(1 / 60); }
    let strike = null, hits = [], fx = [];
    r.playerAttack(tech, {
      lethal,
      onHit: (x) => { hits.push(x.type); if (x.type === 99 || x.type === 98) strike ??= true; },
      onEffect: (x) => fx.push({ type: x.type, x: x.x, y: x.y, z: x.z }),
    });
    for (let t = 1; t <= 300; t++) {
      r.coordinator.tick(2);
      r.setCameraMode("director", { scriptOwnsCamera: r.coordinator.active });
      if (strike) break;
    }
    r.render(0);
    const draw = r.getEffectDraw();
    const inst = (r.effectPlayer?.instances ?? []).map((i) => ({ type: i.type, side: i.side, screen: i.screen, pos: i.pos, state: i.fx?.state, chans: Array.from(i.fx?.chans ?? []) }));
    const rl = r.effectPlayer?.renderList?.() ?? [];
    const dbg = r.__dnaDebug();
    const cv = document.getElementById("cv");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(window.__off, 0, 0);
    let dataUrl = null;
    if (draw) {
      const mod = await import("/web/fight/effect-player.js");
      mod.drawEffects(ctx, draw.list, draw.manifest, draw.images, draw.view);
      dataUrl = cv.toDataURL("image/png");
    } else {
      dataUrl = cv.toDataURL("image/png");
    }
    return {
      hits, fx, inst, renderList: rl.length, renderListFirst: rl[0] ?? null,
      drawNull: !draw, manifestType2: (r.effectPlayer?.manifest?.types ?? {})["2"] ? Object.keys(r.effectPlayer.manifest.types["2"]) : null,
      manifestHas2: !!r.effectPlayer?.manifest?.types?.["2"],
      cam: dbg.cam, camRecord: dbg.camRecord, camMode: dbg.camMode,
      offWH: [window.__off.width, window.__off.height],
      aabb: { p: dbg.pAABB, e: dbg.eAABB },
      dataUrl,
      worldToScreenCheck: draw ? {
        defHome: draw.view.worldToScreen({ x: 0, y: 0, z: 5504 }, "enemy"),
        atkHome: draw.view.worldToScreen({ x: 0, y: 0, z: -5670 }, "player"),
        centre: { x: draw.view.centerX, y: draw.view.centerY, pxScale: draw.view.pxScale },
      } : null,
    };
  };
  return true;
};
await page.evaluate(PROBE);

const out = "/home/dorij/.hermes/profiles/rverify/cache/scratch";
for (const folder of ["m441raiz", "m440sijn", "m005grey"]) {
  await page.evaluate((f) => window.__p.load("near", f), folder);
  await page.evaluate((f) => window.__p.load("far", f), "m051kuwa");
  const res = await page.evaluate(() => window.__p.go(1, false));
  if (res.dataUrl) await writeFile(`${out}/a7a-${folder}-c5.png`, Buffer.from(res.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  const { dataUrl, ...rest } = res;
  console.log(folder, JSON.stringify(rest, null, 1).slice(0, 4000));
}
await browser.close();
await new Promise((r) => server.close(r));
