// Does the drop shadow stay on the ladder's FOOT while the character descends,
// or does it ride up the sprite? Measures the live canvas (real web/game.js),
// per frame, against the ladder's own endpoint rows — no mock renderer.
//
// Original ground truth (docs/research/field/character-drop-shadow-decoded-2026-07-27.md
// + this session): the climb offset lives in entity+0x90; the per-frame update
// subtracts it from the actor's world y for the BILLBOARD
// (fieldstg.s file 0xe3d8-0xe3fc: +0x5c = (+0x54 - +0x90) >> 8) and the renderer
// adds it back for the shadow (file 0xcbf8: shadowY += (+0x90) >> 8). So on a
// ladder the shadow stays on the foot and the sprite climbs away from it.
//
// `window.__noClimbShadowOffset` reproduces the pre-fix behaviour for a measured
// before/after in one run.
//
// Server: python3 -m http.server <port> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_ladder_shadow.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = Number(process.env.VERIFY_PORT || 8741);
const MAP = "s381"; // one 54 px ladder, bottom (432,374) -> top (417,320)
const BASE = `${baseUrl(PORT)}/?skipTitle=1&map=${MAP}&noEncounters=1`;
const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const outDir = resolve(process.argv[2] ?? "/tmp/ladder-shadow-verification");
mkdirSync(outDir, { recursive: true });

// Read the shadow's device rows in a window around the player, plus the actor's
// feet row and the ladder's foot row, all in the same DEVICE space. The camera
// follows the player, so his screen row is ~constant during the climb — the
// ladder's foot row and the shadow are what move relative to him.
const SAMPLE = () => {
  const canvas = document.getElementById("game");
  const w = canvas.width;
  const px = canvas.getContext("2d").getImageData(0, 0, w, canvas.height).data;
  const cam = window.__lastCam;
  const s = window.__state;
  const zoom = cam.zoom ?? 1;
  const c = s.climb;
  const sx = (x) => Math.round((x - cam.x) * zoom);
  const feet = Math.round((s.y - cam.y) * zoom);
  const footDevice = c ? Math.round((c.bottom.y - cam.y) * zoom) : feet;
  const x0 = Math.max(0, sx(s.x) - 22 * zoom);
  const x1 = Math.min(w - 1, sx(s.x) + 22 * zoom);
  // Per device row, how many shadow-coloured pixels land in the window.
  const rowPix = new Map();
  for (let y = 0; y < canvas.height; y++) {
    let n = 0, lo = -1, hi = -1;
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      if (px[i] === 0x30 && px[i + 1] === 0x30 && px[i + 2] === 0x38) {
        if (lo < 0) lo = x; hi = x; n++;
      }
    }
    if (n > 0) rowPix.set(y, { n, lo, hi });
  }
  // The shadow is a contiguous ~11-logical-row band; keep the largest cluster
  // (gap <= 2 device rows) so stray matching map pixels elsewhere cannot widen it.
  const rows = [...rowPix.keys()].sort((a, b) => a - b);
  let best = null, cur = null;
  for (const y of rows) {
    if (cur && y - cur.bot <= 2) { cur.bot = y; }
    else { if (cur && (!best || cur.pixels > best.pixels)) best = cur; cur = { top: y, bot: y, pixels: 0 }; }
    cur.pixels += rowPix.get(y).n;
  }
  if (cur && (!best || cur.pixels > best.pixels)) best = cur;
  return {
    progress: c ? Math.round(c.progress * 10) / 10 : null,
    phase: c?.phase ?? null,
    actorFeetRow: feet,
    ladderFootDeviceRow: footDevice,
    shadowTopRow: best ? best.top : null,
    shadowBotRow: best ? best.bot : null,
    shadowCentreRow: best ? (best.top + best.bot) / 2 : null,
    shadowPixels: best ? best.pixels : 0,
    shadowWidthMax: best ? Math.max(...[...rowPix].filter(([y]) => y >= best.top && y <= best.bot).map(([, v]) => v.hi - v.lo + 1)) : 0,
    zoom,
    stateY: s.y,
    footWorldY: c ? c.bottom.y : null,
  };
};

async function runDescent(page, buggy) {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15000 });
  await page.waitForFunction((m) => (window.__state.scenes?.[m]?.ladders ?? []).length > 0,
    MAP, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.evaluate((b) => { window.__noClimbShadowOffset = b; }, buggy);
  const ladder = await page.evaluate((m) => window.__state.scenes[m].ladders[0], MAP);
  // Face the way the TOP tile asks, then mount (press Confirm).
  const grp = await page.evaluate(([m, p]) => {
    const ts = window.__engineTriggerSystem;
    const map = window.__state.manifest.maps[window.__state.mapIdx].id;
    for (let f = 0; f < 8; f++) {
      const pb = ts.playback(map, p.x, p.y, f, true);
      if (pb?.live) return pb.group;
    }
    return null;
  }, [MAP, ladder.top]);
  await page.evaluate(([p, d]) => {
    window.__state.x = p.x; window.__state.y = p.y;
    window.__state.dir = d; window.__state.moving = false;
  }, [ladder.top, FACINGS[grp]]);
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !!window.__state.climb, null, { timeout: 6000 });
  await page.keyboard.down("ArrowDown");
  const samples = [];
  const seen = new Set();
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(160);
    const s = await page.evaluate(SAMPLE);
    if (s.phase === "climb" && !seen.has(Math.round(s.progress))) {
      seen.add(Math.round(s.progress));
      samples.push(s);
    }
    if (!s.phase || s.phase === "dismount") break;
  }
  await page.keyboard.up("ArrowDown");
  await page.screenshot({ path: resolve(outDir, buggy ? "descent-before.png" : "descent-after.png") });
  await page.evaluate(async () => {
    const f = document.getElementById("game");
    if (!f) return;
  });
  return { ladder, samples };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const after = await runDescent(page, false);
const before = await runDescent(page, true);

const report = (label, run) => {
  const { ladder } = run;
  console.log(`\n== ${label} (ladder bottom.y=${ladder.bottom.y}, top.y=${ladder.top.y}) ==`);
  for (const s of run.samples) {
    const dFoot = s.shadowCentreRow == null ? "n/a" : (s.shadowCentreRow - s.ladderFootDeviceRow).toFixed(1);
    const dFeet = s.shadowCentreRow == null ? "n/a" : (s.shadowCentreRow - s.actorFeetRow).toFixed(1);
    console.log(
      `  progress ${String(s.progress).padStart(5)}  actor feet row ${s.actorFeetRow}` +
      `  shadow rows ${s.shadowTopRow}..${s.shadowBotRow} (centre ${s.shadowCentreRow}, width ${s.shadowWidthMax})` +
      `  centre-vs-ladder-foot(device) ${dFoot}  centre-vs-actor-feet ${dFeet}`,
    );
  }
};

report("AFTER (fix: shadow pinned to foot)", after);
report("BEFORE (__noClimbShadowOffset: old behaviour)", before);

// With the fix, the shadow's centre stays on the ladder's foot row (within a
// logical pixel) for every mid-climb sample; without it, it rides the actor's
// feet row instead. Both are measured on the same descent, same rig.
let ok = true;
const rows = [];
for (const s of after.samples) {
  if (s.shadowCentreRow == null) { ok = false; console.error("  no shadow pixels found (after)"); continue; }
  const d = Math.abs(s.shadowCentreRow - s.ladderFootDeviceRow);
  rows.push(d);
  if (d > 2 * s.zoom) { ok = false; console.error(`  AFTER: shadow centre ${d} device px from the ladder foot`); }
}
if (after.samples.length < 3) { ok = false; console.error(`too few mid-climb samples (after): ${after.samples.length}`); }
// The pre-fix behaviour must reproduce the reported bug: the shadow sat on the
// actor's feet (his lifted sprite), not on the foot of the ladder.
const beforeOnSprite = before.samples.filter((s) =>
  s.shadowCentreRow != null && Math.abs(s.shadowCentreRow - s.actorFeetRow) <= 2 * s.zoom).length;
if (beforeOnSprite < 1) {
  ok = false;
  console.error("BEFORE did not reproduce the shadow-on-the-sprite behaviour");
}
// Sanity: the shadow is the ~25-logical-px texture, not a stray map pixel band.
for (const s of after.samples) {
  if (s.shadowCentreRow != null && s.shadowWidthMax > 30 * s.zoom) {
    ok = false; console.error(`  AFTER: shadow band is ${s.shadowWidthMax} px wide (not the texture)`);
  }
}
if (errors.length) { ok = false; console.error(`${errors.length} page error(s)`); }

console.log(`\nAFTER: max |shadow centre - ladder foot| = ${Math.max(...rows, 0)} device px over ` +
  `${after.samples.length} mid-climb samples; BEFORE samples on the sprite feet: ${beforeOnSprite}.`);
console.log(ok ? "OK — after the fix the shadow stays on the ladder foot; before, it rode the sprite."
  : "FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
