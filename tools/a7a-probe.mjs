#!/usr/bin/env node
// throwaway probe for A7a (round 2): reaction clip + strike-effect placement, with our own
// projection built from the live camera (so it works whether or not an effect is on screen).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("nf"); }
  });
  return new Promise((ok, no) => { server.once("error", no); server.listen(port, "127.0.0.1", () => ok(server)); });
}

const PORT = Number(process.env.PORT || 8107);
const server = await serve(PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${PORT}/web/battle-lab.html`, { waitUntil: "load" });
for (let i = 0; i < 400; i++) {
  if (await page.evaluate(() => !!window.__r?.playerAnimator)) break;
  await new Promise((r) => setTimeout(r, 50));
}

const PROBE = async () => {
  const m = await import("/web/battle3d.js");
  const r = window.__r;
  const st = { m };
  window.__p = st;
  st.load = async (side, folder) => {
    if (side === "near") {
      const ok = await r.setPlayerDigimon(folder);
      for (let i = 0; i < 400 && !r.playerAnimator?.model; i++) await new Promise((x) => setTimeout(x, 25));
      return !!r.playerAnimator?.model;
    }
    const before = r.enemyAnimator;
    r.setEnemyDigimon(folder);
    for (let i = 0; i < 1200; i++) {
      if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) return true;
      await new Promise((x) => setTimeout(x, 25));
    }
    return false;
  };
  st.projector = () => {
    const dbg = r.__dnaDebug();
    if (!dbg?.cam) return null;
    const W = 960, H = 672;
    const cam = dbg.cam;
    const fov = 2 * Math.atan(120 / cam.H);
    const pv = m.mat4Mul(m.mat4Perspective(fov, W / H, 1, 60000), m.mat4LookAt(cam.eye, cam.look, [0, 1, 0]));
    return (p) => {
      const cx = pv[0] * p[0] + pv[4] * p[1] + pv[8] * p[2] + pv[12];
      const cy = pv[1] * p[0] + pv[5] * p[1] + pv[9] * p[2] + pv[13];
      const cw = pv[3] * p[0] + pv[7] * p[1] + pv[11] * p[2] + pv[15];
      if (cw <= 0) return null;
      return { x: (cx / cw * 0.5 + 0.5) * W, y: (1 - (cy / cw * 0.5 + 0.5)) * H };
    };
  };
  st.attack = (side, techId, opts) => {
    const atk = side === "near" ? r.playerAnimator : r.enemyAnimator;
    const def = side === "near" ? r.enemyAnimator : r.playerAnimator;
    if (!atk?.model || !def?.model) return { error: "missing actor" };
    atk.setIdle(); def.setIdle(); r.effectPlayer?.clear();
    for (let i = 0; i < 30; i++) { r.setCameraMode("director", { scriptOwnsCamera: false }); r.render(1 / 60); }
    const rec = { hits: [], fx: [], cams: [], aux: [], defClips: [], atkClips: [], strikeTick: null, shots: [] };
    let tick = 0;
    rec.defStart = { clip: def._clip | 0, vm: !!def.vm };
    rec.atkStart = { clip: atk._clip | 0, vm: !!atk.vm };
    const hooks = {
      onHit: (x) => { rec.hits.push({ tick, type: x.type }); if (x.type === 99 || x.type === 98) rec.strikeTick ??= tick; },
      onEffect: (x) => rec.fx.push({ tick, type: x.type, x: x.x, y: x.y, z: x.z }),
      onCamera: (x) => rec.cams.push({ tick, words: x.words.slice() }),
      onAuxAction: (x) => rec.aux.push({ tick, mode: x.mode }),
    };
    const ok = side === "near" ? r.playerAttack(techId, { ...hooks, lethal: !!opts?.lethal })
                              : r.enemyAttack(techId, { ...hooks, lethal: !!opts?.lethal });
    if (!ok) return { error: "attack refused" };
    rec.atkHome = { ...atk.homeSlot };
    rec.defHome = { ...def.homeSlot };
    const shotAt = () => {
      r.setCameraMode("director", { scriptOwnsCamera: r.coordinator.active });
      r.render(0);
      const dbg = r.__dnaDebug();
      const proj = st.projector();
      const inst = (r.effectPlayer?.instances ?? []).map((i) => ({ type: i.type, side: i.side, screen: i.screen, pos: i.pos }));
      const aabbC = (a) => a ? [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2] : null;
      const atkBox = side === "near" ? dbg.pAABB : dbg.eAABB;
      const defBox = side === "near" ? dbg.eAABB : dbg.pAABB;
      rec.shots.push({
        tick, camScriptOwned: !!r.coordinator.active,
        cam: dbg.camRecord ? { kind: dbg.camRecord.kind, issuer: dbg.camRecord.issuer, preset: dbg.camRecord.preset } : null,
        camFields: dbg.camRecord?.fields ?? null,
        camMode: dbg.camMode, directorRow: dbg.director?.row, directorSub: dbg.director?.sub,
        camEye: dbg.cam ? dbg.cam.eye.map(Math.round) : null, camLook: dbg.cam ? dbg.cam.look.map(Math.round) : null,
        inst,
        atkPx: proj ? proj(aabbC(atkBox)) : null, defPx: proj ? proj(aabbC(defBox)) : null,
        atkBoxC: aabbC(atkBox), defBoxC: aabbC(defBox),
        screenPosPx: inst.map((i) => i.screen ? { x: 480 + i.pos.x * 2.8, y: 336 + i.pos.y * 2.8 } : null),
      });
    };
    let prevDvm = !!def.vm, prevAvm = !!atk.vm;
    for (tick = 1; tick <= 900; tick++) {
      r.coordinator.tick(2);
      r.setCameraMode("director", { scriptOwnsCamera: r.coordinator.active });
      if (!!def.vm !== prevDvm) { rec.defClips.push({ tick, clip: def._clip | 0, vm: !!def.vm }); prevDvm = !!def.vm; }
      if ((atk._clip | 0) !== (rec.atkClips[rec.atkClips.length - 1]?.clip ?? rec.atkStart.clip))
        rec.atkClips.push({ tick, clip: atk._clip | 0 });
      if (rec.hits.length && rec.shots.length === 0) shotAt();
      else if (rec.shots.length === 1 && rec.strikeTick != null && tick === rec.strikeTick + 5) shotAt();
      if (!atk.vm && !def.vm) break;
    }
    rec.ticks = tick;
    rec.defEnd = { vm: !!def.vm, clip: def._clip, frame: def.currentFrame() };
    rec.atkEnd = { vm: !!atk.vm, clip: atk._clip, move: atk.moveDelta() };
    return rec;
  };
  return true;
};
await page.evaluate(PROBE);

const techByClip = { 5: 1, 9: 137, 10: 184 };
const cases = [];
for (const folder of ["m441raiz", "m175krsr", "m440sijn", "m005grey"]) {
  for (const lethal of [false, true]) cases.push([folder, 5, "near", lethal]);
}
for (const folder of ["m441raiz", "m440sijn", "m005grey"]) {
  cases.push([folder, 9, "near", false], [folder, 10, "near", false]);
}
cases.push(["m005grey", 5, "far", false], ["m441raiz", 5, "far", false]);
const DEFENDER = "m005grey";
for (const [folder, clip, side, lethal] of cases) {
  if (side === "near") await page.evaluate((f) => window.__p.load("near", f), folder);
  else await page.evaluate((f) => window.__p.load("far", f), folder);
  const defSide = side === "near" ? "far" : "near";
  const defFolder = folder === DEFENDER ? "m051kuwa" : DEFENDER;
  await page.evaluate(({ s, f }) => window.__p.load(s, f), { s: defSide, f: defFolder });
  const res = await page.evaluate(({ tech, lethal, side }) => window.__p.attack(side, tech, { lethal }),
    { tech: techByClip[clip], lethal, side });
  const fx = res.fx ?? [];
  const worldFx = fx.filter((f) => ![32767, -1].includes(f.z));
  console.log(JSON.stringify({
    case: `${folder} c${clip} ${side}${lethal ? " lethal" : ""} vs ${defFolder}`,
    atkHome: res.atkHome, defHome: res.defHome,
    defStart: res.defStart, defClips: res.defClips, defEnd: res.defEnd,
    aux: res.aux.slice(0, 6), hits: res.hits.slice(0, 10),
    fx, worldFx, ticks: res.ticks, cams: res.cams.slice(0, 4),
    shots: res.shots.map((s) => ({ tick: s.tick, cam: s.cam, camFields: s.camFields, camMode: s.camMode,
      row: s.directorRow, sub: s.directorSub, inst: s.inst.length, atkPx: s.atkPx, defPx: s.defPx,
      atkBoxC: s.atkBoxC, defBoxC: s.defBoxC, screenPosPx: s.screenPosPx })),
  }));
}
await browser.close();
await new Promise((r) => server.close(r));
