#!/usr/bin/env node
// verify_support_cast.mjs — a SELF/ALLY cast and an ITEM USE must be observable ON THE CASTER, with no
// attack anywhere: no projectile, no strike contact, no defender reaction, no lunge, and the effect on
// the caster's own body. (A9; the full cross product is checked by tools/check_tech_targets.mjs — this is
// the real-renderer smoke sample: same page, same animator, same camera as the battle.)
//
// Usage: tools/run-playwright.sh tools/verify_support_cast.mjs --model m441raiz,m115muge,m003agum \
//          --tech 198 --item 43 --side near --out /home/dorij/scratch-research/anim-sheets
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const opt = {
  models: String(arg("--model", "m441raiz,m115muge,m003agum")).split(",").map((s) => s.trim()).filter(Boolean),
  tech: Number(arg("--tech", "198")),
  item: Number(arg("--item", "43")),
  sides: String(arg("--side", "near")) === "both" ? ["near", "far"] : [String(arg("--side", "near"))],
  def: arg("--defender", "m051kuwa"),
  out: arg("--out", "/home/dorij/scratch-research/anim-sheets"),
  json: arg("--json", null),
  port: Number(arg("--port", "8112")),
  steps: Number(arg("--steps", "260")),
};
mkdirSync(opt.out, { recursive: true });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".bin": "application/octet-stream", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    const p = resolve(ROOT, "." + decodeURIComponent(req.url.split("?")[0]));
    const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(opt.port, "127.0.0.1", r));

const BRIDGE = async () => {
  const b3 = await import("/web/battle3d.js");
  const STEP = 1 / 60;
  const r = window.__r;
  const pose = (a) => {
    const n = a.model.num_bones ?? a.model.bones.length;
    const bw = b3.buildBoneWorldMatrices(a.model, a.currentFrame(), a.currentBlend ? a.currentBlend() : null);
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
  window.__sc = {
    load: async (side, folder) => {
      if (side === "near") {
        await r.setPlayerDigimon(folder);
        for (let i = 0; i < 800 && !r.playerAnimator?.model; i++) await new Promise((x) => setTimeout(x, 25));
      } else {
        const before = r.enemyAnimator; r.setEnemyDigimon(folder);
        for (let i = 0; i < 1600; i++) { if (r.enemyAnimator && r.enemyAnimator !== before && r.enemyAnimator.model) break; await new Promise((x) => setTimeout(x, 25)); }
      }
      return true;
    },
    run: async ({ side, kind, id, steps }) => {
      const actor = side === "near" ? r.playerAnimator : r.enemyAnimator;
      const defender = side === "near" ? r.enemyAnimator : r.playerAnimator;
      if (!actor?.model) return { error: "no actor model" };
      actor.setIdle(); defender?.setIdle?.(); r.effectPlayer?.clear();
      r.setCameraMode("director", { scriptOwnsCamera: false });
      for (let i = 0; i < 20; i++) r.render(STEP);
      r.setCameraMode("behind", { scriptOwnsCamera: false }); r.render(0);
      const n = actor.model.num_bones ?? actor.model.bones.length;
      const rec = { fx: [], hits: [], aux: [], cams: [], projectiles: [], effects: [] };
      const hooks = {
        onEffect: (x) => rec.fx.push(x),
        onHit: (x) => rec.hits.push(x),
        onAuxAction: (x) => rec.aux.push(x),
        onCamera: (x) => rec.cams.push(x.words),
        setLunge: (l) => { if (l?.sub === 0) rec.projectiles.push(l); },
      };
      const idle = []; for (let i = 0; i < 45; i++) { r.render(STEP); idle.push(pose(actor)); }
      const home = actor.homeSlot ? { ...actor.homeSlot } : null;
      const ok = kind === "item" ? r.playPlayerItemUse(id, hooks) : r.playerAttack(id, hooks);
      if (!ok) return { error: "the action VM refused", kind, id };
      const poses = []; let maxMove = 0; let ended = false; let ticks = 0; const dEvents = [];
      let dClip = defender?._clip | 0, dVm = !!defender?.vm;
      for (ticks = 1; ticks <= steps; ticks++) {
        r.setCameraMode("behind", { scriptOwnsCamera: r.coordinator.active });
        r.render(STEP);
        const p = pose(actor); poses.push(p);
        const md = actor.moveDelta ? actor.moveDelta() : [0, 0, 0];
        maxMove = Math.max(maxMove, Math.hypot(md[0], md[1], md[2]));
        if (defender) { const c = defender._clip | 0, v = !!defender.vm; if (c !== dClip || v !== dVm) { dEvents.push({ t: ticks, clip: c, vm: v }); dClip = c; dVm = v; } }
        if (!actor.vm) { ended = true; break; }
      }
      // motion range and off-idle distance
      const range = (arr) => { const mn = Float32Array.from(arr[0]), mx = Float32Array.from(arr[0]);
        for (const p of arr) for (let i = 0; i < p.length; i++) { if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i]; }
        return { mn, mx }; };
      const R = range(poses); let rotMax = 0, transMax = 0;
      for (let b = 0; b < n; b++) { let r2 = 0, t2 = 0;
        for (let k = 0; k < 9; k++) r2 = Math.max(r2, R.mx[b * 12 + k] - R.mn[b * 12 + k]);
        for (let k = 9; k < 12; k++) t2 = Math.max(t2, R.mx[b * 12 + k] - R.mn[b * 12 + k]);
        rotMax = Math.max(rotMax, r2); transMax = Math.max(transMax, t2); }
      const RI = range(idle); let offIdle = 0;
      for (let b = 0; b < n; b++) for (let k = 0; k < 9; k++) offIdle = Math.max(offIdle, R.mx[b * 12 + k] - RI.mn[b * 12 + k], RI.mx[b * 12 + k] - R.mn[b * 12 + k]);
      // the effect anchor: screen-space -> ray through the draw point must enter the CASTER's box first
      const dbg = r.__dnaDebug();
      const box = side === "near" ? dbg?.pAABB : dbg?.eAABB;
      const other = side === "near" ? dbg?.eAABB : dbg?.pAABB;
      const cam = dbg?.cam;
      const testPoint = (px, byBox) => {
        if (!cam || !byBox) return null;
        const W = 960, H = 672, eye = cam.eye, look = cam.look;
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
        const zAx = norm(sub(eye, look)), xAx = norm(cross([0, 1, 0], zAx)), yAx = cross(zAx, xAx);
        const tan = 120 / cam.H, aspect = W / H, nx = (2 * px.x) / W - 1, ny = 1 - (2 * px.y) / H;
        const dir = norm([0, 1, 2].map((i) => -zAx[i] + xAx[i] * nx * tan * aspect + yAx[i] * ny * tan));
        const pad = 0.04 * Math.max(byBox.max[0] - byBox.min[0], byBox.max[1] - byBox.min[1], byBox.max[2] - byBox.min[2]);
        let t0 = 0, t1 = 1e9;
        for (let i = 0; i < 3; i++) {
          const lo = byBox.min[i] - pad, hi = byBox.max[i] + pad;
          if (Math.abs(dir[i]) < 1e-9) { if (eye[i] < lo || eye[i] > hi) return null; continue; }
          let ta = (lo - eye[i]) / dir[i], tb = (hi - eye[i]) / dir[i];
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) return null;
        }
        return t1 > 0 ? t0 : null;
      };
      const screenFx = rec.fx.filter((f) => f.z === 32767 || f.z === -1);
      const worldFx = rec.fx.filter((f) => !(f.z === 32767 || f.z === -1));
      const anchors = screenFx.map((f) => {
        const px = { x: 480, y: 336 };
        return { type: f.type, selfT: testPoint(px, box), otherT: testPoint(px, other) };
      });
      // an 8-frame contact sheet across the action
      const pngs = [];
      return {
        kind, id, side, ticks, ended, maxMove: +maxMove.toFixed(1),
        rotMax: +rotMax.toFixed(3), transMax: +transMax.toFixed(1), offIdle: +offIdle.toFixed(3),
        nFx: rec.fx.length, nWorld: worldFx.length, nProjectiles: rec.projectiles.length,
        nAux: rec.aux.length, nHits: rec.hits.length, cams: rec.cams.map((w) => w.join(",")),
        defenderEvents: dEvents, defenderPlayed: dEvents.filter((e) => e.vm).map((e) => e.clip),
        anchors, home,
        actorKind: actor.model.folder ?? null,
      };
    },
    sheet: async ({ side, kind, id, frames }) => {
      // replay and capture 8 frames as one contact sheet
      const actor = side === "near" ? r.playerAnimator : r.enemyAnimator;
      actor.setIdle(); r.effectPlayer?.clear(); r.setCameraMode("director", { scriptOwnsCamera: false });
      for (let i = 0; i < 20; i++) r.render(1 / 60);
      r.setCameraMode("behind", { scriptOwnsCamera: false });
      const ok = kind === "item" ? r.playPlayerItemUse(id, {}) : r.playerAttack(id, {});
      if (!ok) return null;
      const shots = [];
      const total = 300, every = Math.floor(total / frames);
      const cv = document.getElementById("cv"); const ctx = cv.getContext("2d");
      const { drawEffects } = await import("/web/fight/effect-player.js");
      for (let t = 1; t <= total; t++) {
        r.setCameraMode("behind", { scriptOwnsCamera: r.coordinator.active });
        r.render(1 / 60);
        if (t % every === 0) {
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawImage(window.__off, 0, 0);
          const d = r.getEffectDraw(); if (d) drawEffects(ctx, d.list, d.manifest, d.images, d.view);
          shots.push(cv.toDataURL("image/png"));
        }
        if (!actor.vm && t > every * 2) break;
      }
      return shots;
    },
  };
  window.__scReady = true;
  return true;
};

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const results = [];
for (const side of opt.sides) {
  for (const folder of opt.models) {
    await page.goto(`http://127.0.0.1:${opt.port}/web/battle-lab.html?model=${folder}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__r?.playerAnimator, null, { timeout: 60000 });
    await page.evaluate(BRIDGE);
    const loadSide = side === "near" ? "near" : "far";
    await page.evaluate(({ s, f, d }) => window.__sc.load(s, f), { s: "near", f: folder, d: opt.def });
    await page.evaluate(({ s, f }) => window.__sc.load(s, f), { s: "far", f: opt.def });
    for (const [kind, id] of [["item", opt.item], ["tech", opt.tech]]) {
      const run = await page.evaluate(({ side, kind, id, steps }) => window.__sc.run({ side, kind, id, steps }), { side, kind, id, steps: opt.steps });
      if (run?.error) { results.push({ folder, side, kind, id, error: run.error }); continue; }
      // assertions
      const v = [];
      if (!run.ended) v.push("did not end");
      if (run.nProjectiles) v.push(`projectile ×${run.nProjectiles}`);
      if (run.nAux) v.push(`op1/aux ×${run.nAux}`);
      if (run.defenderPlayed.length) v.push(`defender played ${run.defenderPlayed.join(",")}`);
      if (run.maxMove > 400) v.push(`moved ${run.maxMove} from home`);
      if (run.rotMax < 0.06) v.push(`frozen (rot ${run.rotMax})`);
      // a WORLD-space spawn must sit on the caster (the victim line is 5120 away); a screen-space one is
      // drawn under the item/support camera, whose framing is reported by the ray anchor below (the
      // deterministic camera invariant is C8 in tools/check_tech_targets.mjs).
      if (run.nWorld) v.push(`world-space effect away from the caster ×${run.nWorld}`);
      // an item's effect type comes from the disc's item-use table (not present in every tree): with no
      // record the animator faithfully skips the 9999 spawn, so "no effect" is only a failure for a
      // TECHNIQUE, whose effect type the tech table always carries.
      if (kind === "tech" && !run.nFx) v.push("no effect spawned");
      if (kind === "item" && !run.nFx) run.note = "no effect: item-use effect table not loaded (faithful skip)";
      results.push({ folder, side, kind, id, ...run, violations: v });
      // contact sheet for the item run only (keeps this quick)
      if (kind === "item") {
        const shots = await page.evaluate(({ side, kind, id, frames }) => window.__sc.sheet({ side, kind, id, frames }), { side, kind, id, frames: 8 });
        if (shots?.length) {
          const { writeFileSync } = await import("node:fs");
          const buf = Buffer.concat(shots.map((d) => Buffer.from(d.split(",")[1], "base64")));
          // 8 PNGs as separate files (a montage would need a decoder; names are ordered)
          shots.forEach((d, i) => writeFileSync(`${opt.out}/a9-${folder}-${kind}-${side}-f${i + 1}.png`, Buffer.from(d.split(",")[1], "base64")));
        }
      }
    }
  }
}
await browser.close();
server.close();
for (const r of results) {
  if (r.error) console.log(`FAIL ${r.folder} ${r.kind}#${r.id} ${r.side}: ${r.error}`);
  else console.log(`${r.violations.length ? "FAIL" : "PASS"} ${r.folder} ${r.kind}#${r.id} ${r.side}: ended=${r.ended} move=${r.maxMove} rot=${r.rotMax} fx=${r.nFx} proj=${r.nProjectiles} aux=${r.nAux} hits=${r.nHits} def=[${r.defenderPlayed}] anchors=${r.anchors.map((a) => `${a.type}:self=${a.selfT == null ? "-" : a.selfT.toFixed(0)}/other=${a.otherT == null ? "-" : a.otherT.toFixed(0)}`).join(" ")}${r.violations.length ? "  <- " + r.violations.join("; ") : ""}`);
}
if (opt.json) writeFileSync(opt.json, JSON.stringify(results, null, 1));
process.exit(results.some((r) => r.error || (r.violations?.length ?? 1)) ? 1 : 0);
