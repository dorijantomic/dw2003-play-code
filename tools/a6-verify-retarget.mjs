#!/usr/bin/env node
// a6/verify_retarget.mjs - prototype: bake a donor's clip-9 rotation motion onto a similar model's skeleton
// (web/fight/anim-retarget.js) and measure/render it in the battle lab. Research tool; not used by the game.
//
//   tools/run-playwright.sh tools/a6-verify-retarget.mjs --target m178kngt --source m369duke --clip 9 \
//       --out /home/dorij/scratch-research/anim-sheets --prefix a6-kngt-after --port 8106
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
const target = arg("target");
const source = arg("source");
const clip = Number(arg("clip", 9));
const offset = Number(arg("offset", 6000));
const side = arg("side", "near");
const out = arg("out", "/home/dorij/scratch-research/anim-sheets");
const prefix = arg("prefix", "a6-retarget");
const port = Number(arg("port", 8106));
const cam = arg("cam", "director");
if (!target || !source) { console.error("need --target and --source"); process.exit(2); }
await mkdir(out, { recursive: true });

const server = await serve(port);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${port}/web/battle-lab.html`, { waitUntil: "load" });
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  if (await page.evaluate(() => !!window.__r && !!window.__r.playerAnimator)) break;
  await new Promise((r) => setTimeout(r, 50));
}
await page.evaluate(async ({ target, source, clip, offset, side, cam }) => {
  const sel = document.getElementById("cam");
  if (sel) { sel.value = cam; sel.dispatchEvent(new Event("change")); }
  const mod = await import("/web/battle3d.js");
  const rt = await import("/web/fight/anim-retarget.js");
  const r = window.__r;
  window.__rt = { mod, rt, ready: false };
  if (side === "near") await r.setPlayerDigimon(target);
  else {
    const before = r.enemyAnimator;
    r.setEnemyDigimon(target);
    const t = Date.now();
    while (Date.now() - t < 20000) {
      if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) break;
      await new Promise((x) => setTimeout(x, 40));
    }
  }
  const src = await fetch(`assets/battle/models/${source}/anim.json`).then((x) => x.json());
  const a = side === "near" ? r.playerAnimator : r.enemyAnimator;
  window.__rt.animator = a;
  window.__rt.srcModel = a.model;
  window.__rt.bake = rt.bakeRetarget(a.model, src, clip, { offset });
  window.__rt.ready = true;
}, { target, source, clip, offset, side, cam });

const res = await page.evaluate(async ({ clip, side }) => {
  const { mod, rt } = window.__rt;
  const r = window.__r, off = window.__off;
  const a = window.__rt.animator;
  const bake = window.__rt.bake;
  if (!bake) return { error: "bake returned null (bone map too thin)" };
  const bwm = mod.buildBoneWorldMatrices;
  const pose = (model, frame, blend) => {
    const n = model.num_bones ?? model.bones.length;
    const bw = bwm(model, frame, blend);
    const out = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const m = bw.mats[i];
      out[i * 12 + 0] = m[0]; out[i * 12 + 1] = m[1]; out[i * 12 + 2] = m[2];
      out[i * 12 + 3] = m[4]; out[i * 12 + 4] = m[5]; out[i * 12 + 5] = m[6];
      out[i * 12 + 6] = m[8]; out[i * 12 + 7] = m[9]; out[i * 12 + 8] = m[10];
      out[i * 12 + 9] = m[12]; out[i * 12 + 10] = m[13]; out[i * 12 + 11] = m[14];
    }
    return out;
  };
  const range = { min: null, max: null };
  const add = (p) => {
    if (!range.min) { range.min = Float32Array.from(p); range.max = Float32Array.from(p); return; }
    for (let i = 0; i < p.length; i++) { if (p[i] < range.min[i]) range.min[i] = p[i]; if (p[i] > range.max[i]) range.max[i] = p[i]; }
  };
  const own = a.model;
  a.setIdle();
  const idle = { min: null, max: null };
  for (let i = 0; i < 60; i++) {
    r.coordinator.tick(2);
    const p = pose(a.model, a.currentFrame(), a.currentBlend ? a.currentBlend() : null);
    if (!idle.min) { idle.min = Float32Array.from(p); idle.max = Float32Array.from(p); }
    else for (let k = 0; k < p.length; k++) { if (p[k] < idle.min[k]) idle.min[k] = p[k]; if (p[k] > idle.max[k]) idle.max[k] = p[k]; }
  }
  // swap in the baked clone and run the shifted table; waits follow the table's own frame span
  const span = (() => {
    const tab = bake.model.timeline[bake.table].table;
    let lo = Infinity, hi = -1;
    for (const e of tab) { const v = e.value | 0; if (v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    return hi > lo ? hi - lo : 60;
  })();
  const windup = Math.round(span * 0.5), tail = Math.round(span * 0.4);
  a.model = bake.model;
  a.setIdle();
  for (let i = 0; i < 10; i++) r.coordinator.tick(2);
  a.setScript({ ops: [
    { op: 3, words: [0, 9999, 0, 0, 32767] },
    { op: 2, words: [0, 0, bake.table] },
    { op: 11, words: [windup] },
    { op: 10, words: [99, 0] },
    { op: 3, words: [0, 2, 0, 0, 32767] },
    { op: 11, words: [tail] },
    { op: 2, words: [0, 0, 1] },
    { op: 255, words: [] },
  ] }, {}, { initialTable: bake.table });
  add(pose(a.model, a.currentFrame(), null));
  let ticks = 0;
  for (ticks = 1; ticks <= 900; ticks++) {
    r.coordinator.tick(2);
    add(pose(a.model, a.currentFrame(), a.currentBlend ? a.currentBlend() : null));
    if (!a.vm || a.vm.ended) break;
  }
  const n = a.model.num_bones ?? a.model.bones.length;
  const rot = [], trans = [];
  for (let b = 0; b < n; b++) {
    let mr = 0, mt = 0;
    for (let k = 0; k < 9; k++) mr = Math.max(mr, range.max[b * 12 + k] - range.min[b * 12 + k]);
    for (let k = 9; k < 12; k++) mt = Math.max(mt, range.max[b * 12 + k] - range.min[b * 12 + k]);
    rot.push(+mr.toFixed(3)); trans.push(+mt.toFixed(1));
  }
  const idleRot = [];
  for (let b = 0; b < n; b++) {
    let mr = 0;
    for (let k = 0; k < 9; k++) mr = Math.max(mr, idle.max[b * 12 + k] - idle.min[b * 12 + k]);
    idleRot.push(+mr.toFixed(3));
  }
  const ratio = rot.map((v, i) => +(v / Math.max(idleRot[i], 0.02)).toFixed(1));
  // skeleton sheet: draw bone positions as a stick figure (side + front) for the target and the source, so a
  // joint that bends the wrong way is visible without the model's armour hiding it
  const drawPose = (ctx2, model, frame, ox, oy, label, highlight) => {
    const bw = bwm(model, frame, null);
    const P = bw.worldTrans;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const p of P) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); }
    const s = Math.min(300 / Math.max(1, mxx - mnx), 300 / Math.max(1, mxy - mny));
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
    const tx = (p) => ox + 240 + (p[0] - cx) * s;
    const ty = (p) => oy + 168 + (p[1] - cy) * s;
    ctx2.font = "bold 12px monospace";
    ctx2.fillStyle = "#8cf"; ctx2.fillText(label, ox + 6, oy + 16);
    for (let i = 0; i < P.length; i++) {
      const par = (model.bones[i].parent_slot ?? 0) - 1;
      if (par < 0) continue;
      ctx2.strokeStyle = (highlight && highlight.has(i)) ? "#f86" : "#6c9";
      ctx2.lineWidth = (highlight && highlight.has(i)) ? 4 : 2;
      ctx2.beginPath(); ctx2.moveTo(tx(P[par]), ty(P[par])); ctx2.lineTo(tx(P[i]), ty(P[i])); ctx2.stroke();
      ctx2.fillStyle = "#cde"; ctx2.fillRect(tx(P[i]) - 2, ty(P[i]) - 2, 4, 4);
    }
  };
  const limbBones = new Set(bake.roles.target.arms.flatMap((x) => x.chain).concat(bake.roles.target.legs.flatMap((x) => x.chain)));
  const SK = document.createElement("canvas");
  SK.width = 4 * 480; SK.height = 2 * 336;
  const sk = SK.getContext("2d");
  sk.fillStyle = "#0d0d16"; sk.fillRect(0, 0, SK.width, SK.height);
  const tab = bake.model.timeline[bake.table].table;
  const plain = tab.map((e) => e.value | 0).filter((v) => v < 0x8000);
  const lo = Math.min(...plain), hi = Math.max(...plain);
  for (let k = 0; k < 8; k++) {
    const f = Math.round(lo + ((hi - lo) * k) / 7);
    const srcF = f - bake.offset;
    const col = k % 4, rowPair = Math.floor(k / 4);
    drawPose(sk, bake.model, f, col * 480, rowPair * 336, `TARGET frame ${f}`, limbBones);
    drawPose(sk, window.__rt.srcModel, srcF, col * 480, (rowPair + 2) * 672 / 2, `SOURCE frame ${srcF}`, null);
  }

  const S = document.createElement("canvas");
  S.width = 4 * 480; S.height = 2 * 336;
  const ctx = S.getContext("2d");
  ctx.fillStyle = "#0d0d16"; ctx.fillRect(0, 0, S.width, S.height);
  a.model = bake.model;
  a.setIdle();
  for (let i = 0; i < 10; i++) r.coordinator.tick(2);
  a.setScript({ ops: [
    { op: 2, words: [0, 0, bake.table] },
    { op: 11, words: [windup] },
    { op: 10, words: [99, 0] },
    { op: 11, words: [tail] },
    { op: 2, words: [0, 0, 1] },
    { op: 255, words: [] },
  ] }, {}, { initialTable: bake.table });
  let t = 0;
  for (let k = 1; k <= 8; k++) {
    const targetTick = Math.max(1, Math.round((ticks * k) / 8));
    while (t < targetTick) { r.coordinator.tick(2); t++; }
    r.render(0);
    const x = ((k - 1) % 4) * 480, y = Math.floor((k - 1) / 4) * 336;
    ctx.drawImage(off, x, y, 480, 336);
    ctx.fillStyle = "#8cf"; ctx.font = "bold 15px monospace";
    ctx.fillText(`retarget clip ${clip} tick ${t} frame ${a.currentFrame()}`, x + 6, y + 18);
  }
  a.model = own;
  a.setIdle();
  return { ended: !a.vm || true, ticks, bones: n, table: bake.table, covered: +bake.covered.toFixed(2),
           rotMax: Math.max(...rot), rotBone: rot.indexOf(Math.max(...rot)), idleMax: Math.max(...idleRot),
           ratio, rot, trans, png: S.toDataURL("image/png"), skel: SK.toDataURL("image/png"), map: bake.map };
}, { clip, side });
if (res.error) { console.log("ERROR", res.error); }
else {
  const fs = await import("node:fs/promises");
  const file = `${out}/${prefix}-c${clip}-${side}.png`;
  await fs.writeFile(file, Buffer.from(res.png.split(",")[1], "base64"));
  if (res.skel) await fs.writeFile(`${out}/${prefix}-c${clip}-${side}-skel.png`, Buffer.from(res.skel.split(",")[1], "base64"));
  const brief = { ...res, png: undefined, skel: undefined, map: res.map.join(" ") };
  await fs.writeFile(`${out}/${prefix}-c${clip}-${side}.json`, JSON.stringify(brief, null, 1));
  console.log(JSON.stringify({ ...brief, file }, null, 1).slice(0, 2000));
}
if (errs.length) console.log("page errors:", errs.slice(0, 6));
await browser.close();
server.close();
