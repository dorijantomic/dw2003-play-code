// On-screen proof that a tech's effect lands ON a Digimon rather than on empty arena.
//
// A tech like Diamond Storm draws its burst as SCREEN-SPACE sprites (op3 z = 32767 / -1): fixed
// points on the PS1's 320x240 frame, almost always (0,0), i.e. dead centre. Nothing in the sprite
// layer can put such a sprite on a fighter — only the CAMERA can, by framing the fighter the
// script means the burst for. So this measures the one thing that matters: on every tick that has
// a screen-space effect up, how far is that effect's spawn point from the nearest fighter's
// on-screen silhouette?
//
// An earlier version of this file measured the caster's height and footing against a live capture
// instead. That passed while the burst still hung off to the side, because a fighter can be framed
// at the right SIZE and still be nowhere near the centre of the frame. Distance to the silhouette
// is the quantity the player actually sees.
//
// Two defects it now pins:
//   1. op5's third vector (cam struct +0x18) is the shot's world ANCHOR, and the eye/target pair
//      is relative to it. Dropped, the 80 anchored shots among the 283 shipped ones all aimed at
//      the arena origin; Diamond Storm's opening shot then sat the caster a quarter-screen left of
//      her own burst. See web/fight/battle-camera.js applyOp5.
//   2. The synthetic impact cut replaced the camera the attacker's own script had already set for
//      its strike, aiming at the caster's empty ground slot while she was still airborne and
//      leaving the hit sparks stranded in mid-air. That stand-in is removed (2026-10-08): an
//      ordinary attack installs no camera of its own, so the attacker's authored shot stands. See
//      battle3d.js (_impactContact / _camHookFor).
// Measured over Renamon's Diamond Storm: worst miss 112 px before, 19 px after.
//
// This drives ONE Digimon through a real browser. It is the ground check, not the coverage check:
// spot-checking packs one at a time says nothing about the other 244. For the whole roster in
// under a second and with no browser, run tools/audit_camera_effect_alignment.mjs, which walks
// every action of every pack against the same shipped applyOp5. Use both - this one proves the
// rendered result, that one proves the rule holds everywhere.
//
// Run:  tools/run-playwright.sh tools/verify_effect_screen_alignment.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

// PSX px. The gate sits far below the 112 px the two defects produced and comfortably above the
// 19 px that remains, which is the authored stand-off of a spawn point from the body it belongs
// to (op3 spawns Diamond Storm's sparks at (0,0) and (10,-10), not on a bone).
const TOL = 40;
const MODEL = process.env.MODEL || "m373rena";
const TECH = process.env.TECH || "59";
// The opponent is part of this check's premise, not a free choice. Renamon's Diamond Storm op5
// is `[0, 1, -2112,192,-2880, 0,0,0, 512,1152,5504, 0,-307,0, 0, 226]`: the anchor puts its aim
// point at arena z = 5504, and a fighter stands at z = 0x1400 + its own record's stand-off
// (FIGHTSTG_F0x80087f38). 5504 = 5120 + 384, which is AGUMON's stand-off (record 3), so the pack
// was authored against him and the burst lands on his body. Against an opponent who stands
// further down-field the same authored shot aims short — in the original too, since the point is
// baked into the pack — so the lab's own default opponent (a wild Digimon, which is what the
// opening camera needs) is not the one this measurement is about.
const FOE = process.env.FOE || "m003agum";
const PORT = Number(process.env.PORT || 8752);
const OUT_DIR = process.env.OUT_DIR || "/tmp/effect-alignment";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".bin": "application/octet-stream" };
const server = process.env.VERIFY_PORT ? null : http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(process.cwd(), "web", rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});
if (server) await new Promise((r) => server.listen(PORT, r));
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
let rows = [];
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  page.on("pageerror", (e) => errors.push("JS: " + e.message));
  await page.goto(`http://localhost:${process.env.VERIFY_PORT || PORT}/battle-lab.html`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("#pModel option").length > 0,
    { timeout: 30000 });
  await page.selectOption("#pModel", MODEL);
  await page.selectOption("#eModel", FOE);
  await page.fill("#rawTech", TECH);
  await page.waitForTimeout(1600);

  await page.evaluate(() => {
    const r = window.__r, S = 140 / 400;                    // battle3d MODEL_SCALE
    window.__rows = [];
    (function loop() {
      const d = r.getEffectDraw(), dbg = r.__dnaDebug();
      if (d && dbg.pAABB) {
        const v = d.view;
        // Render units -> PS1 arena units -> canvas px -> the PSX 320x240 frame the sprites are
        // drawn in. worldToScreen is the renderer's own projection, so this measures the shipped
        // camera rather than a copy of it.
        const toPSX = (q) => q && ({ x: (q.x - v.centerX) / v.pxScale + 160,
                                     y: (q.y - v.centerY) / v.pxScale + 120 });
        const box = (a) => {
          if (!a) return null;
          const pts = [];
          for (const X of [a.min[0], a.max[0]]) for (const Y of [a.min[1], a.max[1]])
            for (const Z of [a.min[2], a.max[2]]) {
              const p = toPSX(v.worldToScreen({ x: X / S, y: -Y / S, z: Z / S }, "player"));
              if (p) pts.push(p);
            }
          if (pts.length < 8) return null;   // behind the camera: no silhouette this tick
          return { x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)),
                   y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)) };
        };
        // Spawn points only. dx/dy are the record's own authored dispersal (Diamond Storm throws
        // its sparks +-80 px around the impact), which is not required to land on a body.
        // Full-frame clips spawn at (-160,-120): those are backdrops, not placed effects.
        const sp = d.list
          .filter((s) => s.screen && Math.abs(s.pos.x) < 160 && Math.abs(s.pos.y) < 120)
          .map((s) => ({ x: 160 + s.pos.x, y: 120 + s.pos.y }));
        if (sp.length) window.__rows.push({ P: box(dbg.pAABB), E: box(dbg.eAABB), sp });
      }
      if (window.__sampling !== false) requestAnimationFrame(loop);
    })();
    window.__sampling = true;
    document.querySelector("#atkP").click();
  });
  await page.waitForTimeout(5000);
  rows = await page.evaluate(() => { window.__sampling = false; return window.__rows; });
} finally {
  await browser.close();
  server?.close();
}

const dist = (p, b) => (b
  ? Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1))
  : Infinity);
let worst = 0, sprites = 0, offBody = 0;
for (const r of rows) for (const s of r.sp) {
  const d = Math.min(dist(s, r.P), dist(s, r.E));
  sprites++;
  if (d > TOL) offBody++;
  if (d > worst) worst = d;
}

console.log(`\n${MODEL} vs ${FOE} tech ${TECH}: every screen-space effect spawn, measured`);
console.log("against the nearest fighter's silhouette inside the PSX 320x240 frame");
console.log(`  ticks with an effect up   ${rows.length}`);
console.log(`  effect spawns measured    ${sprites}`);
console.log(`  worst miss                ${worst.toFixed(0)} px   (tolerance ${TOL})`);
console.log(`  spawns off every fighter  ${offBody}`);
console.log("  page errors:", errors.length ? errors.join(" ;; ") : "none");

const pass = !errors.length && rows.length >= 10 && sprites > 0 && offBody === 0;
console.log(pass
  ? "\nPASS - every screen-space effect this tech spawns lands on a Digimon."
  : "\nFAIL - a screen-space effect is drawn off every fighter; the camera is not framing its subject.");
process.exit(pass ? 0 : 1);
