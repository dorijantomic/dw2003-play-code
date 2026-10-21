#!/usr/bin/env node
// probe 4: the battle's own camera at the strike (director RETIRED on the confirm edge, the
// arena shot held), plus a real screenshot of the strike frame for eyeballing.
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
  st.go = async (side, tech, lethal) => {
    const atk = side === "near" ? r.playerAnimator : r.enemyAnimator;
    const def = side === "near" ? r.enemyAnimator : r.playerAnimator;
    atk.setIdle(); def.setIdle(); r.effectPlayer?.clear();
    // the command menu's idle director exists, then the confirm RETIRES it and holds the arena shot
    r.setCameraMode("director", { scriptOwnsCamera: false });
    for (let i = 0; i < 20; i++) r.render(1 / 60);
    r.setCameraMode("behind", { scriptOwnsCamera: false });
    r.render(0);
    const pre = r.__dnaDebug();
    let strike = false, hits = [], fx = [], cams = [], aux = [], defClips = [];
    let prevD = !!def.vm;
    const hooks = {
      onHit: (x) => { hits.push(x.type); if (x.type === 99 || x.type === 98) strike = true; },
      onEffect: (x) => fx.push({ type: x.type, x: x.x, y: x.y, z: x.z }),
      onCamera: (x) => cams.push(x.words.slice()),
      onAuxAction: (x) => aux.push(x.mode),
    };
    const ok = side === "near" ? r.playerAttack(tech, { ...hooks, lethal }) : r.enemyAttack(tech, { ...hooks, lethal });
    let t = 0;
    for (t = 1; t <= 400; t++) {
      r.coordinator.tick(2);
      r.setCameraMode("behind", { scriptOwnsCamera: r.coordinator.active });
      if (!!def.vm !== prevD) { defClips.push({ t, clip: def._clip, vm: !!def.vm }); prevD = !!def.vm; }
      if (strike) break;
    }
    r.render(0);
    const dbg = r.__dnaDebug();
    const draw = r.getEffectDraw();
    const inst = (r.effectPlayer?.instances ?? []).map((i) => ({ type: i.type, side: i.side, screen: i.screen, pos: i.pos }));
    const cam = dbg.cam;
    const W = 960, H = 672;
    const pv = b3.mat4Mul(b3.mat4Perspective(2 * Math.atan(120 / cam.H), W / H, 1, 60000),
      b3.mat4LookAt(cam.eye, cam.look, [0, 1, 0]));
    const proj = (p) => {
      const cx = pv[0] * p[0] + pv[4] * p[1] + pv[8] * p[2] + pv[12];
      const cy = pv[1] * p[0] + pv[5] * p[1] + pv[9] * p[2] + pv[13];
      const cw = pv[3] * p[0] + pv[7] * p[1] + pv[11] * p[2] + pv[15];
      return cw <= 0 ? null : { x: (cx / cw * 0.5 + 0.5) * W, y: (1 - (cy / cw * 0.5 + 0.5)) * H };
    };
    const c = (a) => a ? [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2] : null;
    const atkBox = side === "near" ? dbg.pAABB : dbg.eAABB;
    const defBox = side === "near" ? dbg.eAABB : dbg.pAABB;
    const cv = document.getElementById("cv");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(window.__off, 0, 0);
    if (draw) fxMod.drawEffects(ctx, draw.list, draw.manifest, draw.images, draw.view);
    return {
      side, tech, lethal, ok, ticksToStrike: t, hits, fx, cams, aux, defClips,
      defEnd: { vm: !!def.vm, clip: def._clip, held: def._heldPose },
      preCam: pre.camRecord ? { kind: pre.camRecord.kind, issuer: pre.camRecord.issuer, preset: pre.camRecord.preset, fields: pre.camRecord.fields } : null,
      cam: cam && { eye: cam.eye.map(Math.round), look: cam.look.map(Math.round), H: cam.H },
      camRecord: dbg.camRecord ? { kind: dbg.camRecord.kind, issuer: dbg.camRecord.issuer, preset: dbg.camRecord.preset, fields: dbg.camRecord.fields } : null,
      drawNull: !draw, renderList: r.effectPlayer?.renderList?.().length ?? null,
      inst,
      atkBoxC: c(atkBox), defBoxC: c(defBox),
      atkPx: proj(c(atkBox)), defPx: proj(c(defBox)),
      atkHomePx: proj(b3.ps1ToRender([atk.homeSlot.x, atk.homeSlot.y, atk.homeSlot.z], 0.35)),
      defHomePx: proj(b3.ps1ToRender([def.homeSlot.x, def.homeSlot.y, def.homeSlot.z], 0.35)),
      drawPx: inst.map((i) => i.screen ? { x: 480 + i.pos.x * 2.8, y: 336 + i.pos.y * 2.8 } : proj(b3.ps1ToRender([i.pos.x, i.pos.y, i.pos.z], 0.35))),
      png: cv.toDataURL("image/png"),
    };
  };
  return true;
};
await page.evaluate(PROBE);

const out = "/home/dorij/.hermes/profiles/rverify/cache/scratch";
for (const [folder, lethal] of [["m441raiz", false], ["m441raiz", true], ["m440sijn", false], ["m005grey", false]]) {
  await page.evaluate((f) => window.__p.load("near", f), folder);
  await page.evaluate((f) => window.__p.load("far", f), "m051kuwa");
  const res = await page.evaluate(({ lethal }) => window.__p.go("near", 1, lethal), { lethal });
  const { png, ...rest } = res;
  await writeFile(`${out}/a7a-${folder}-c5-near${lethal ? "-lethal" : ""}.png`, Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64"));
  console.log(folder, lethal, JSON.stringify(rest));
}
await browser.close();
await new Promise((r) => server.close(r));
