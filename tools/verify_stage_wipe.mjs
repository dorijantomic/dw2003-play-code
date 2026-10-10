// The stage-change wipe, read off the canvas after ONE real stage change.
//
// WHAT IT PROVES, and what it is here to catch. The closing wipe shows the old
// field through a window that shrinks onto the player, with the tile cover
// everywhere else -- that is a cover AROUND a rect. The opening wipe is the
// opposite shape: ONE black band covering the middle of the screen, narrowing
// 8 px at each edge per frame, with the new field back at the two sides. The
// original decides that because state 2 sets its rect on the 0x1001 object --
// the same object the tile cover F0x80086CE4(0x1001, ...) is drawn through --
// while state 1 sets its rect on a 0x1002 object. Painting one shared routine
// with one polarity silently draws the opposite wipe, which is exactly what a
// pixel check at the screen edges catches.
//
// It changes stage by asking the game for a warp through window.__fade, the
// same seam the other verifiers use. There is no walking bot here: the player
// never moves.
//
// Run:
//   python3 -m http.server $PORT --directory web &
//   VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_stage_wipe.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = 8772;

// One in-page recorder: every animation frame of the transition it writes down
// what the screen shows, in native 320x240 coordinates, so the assertions below
// run on the whole sequence instead of on a sample the browser happened to be
// holding when the harness looked.
const INSTALL_RECORDER = () => {
  const src = document.querySelector("canvas");
  const strip = document.createElement("canvas");
  const k = src.width / 320;               // device pixels per native pixel
  strip.width = src.width;
  strip.height = Math.max(1, Math.round(k));
  const g = strip.getContext("2d", { willReadFrequently: true });
  const ROWS = [60, 120, 180];             // native y of the sampled rows
  const samples = [];
  // A covered pixel is the cover at its cap: fully subtracted, i.e. black. The
  // additive seam lines sit at multiples of 64, so those columns are skipped
  // when the band edge is measured -- a seam pixel is lit inside the cover.
  const COVERED = 8;
  const isSeam = (x) => x % 64 === 0;
  const tick = () => {
    const phase = window.__state.wipe.phase;
    const frame = window.__state.wipe.frame;
    if (phase === 1 || phase === -1) {
      g.clearRect(0, 0, strip.width, strip.height);
      const out = { phase, frame, rows: [] };
      for (const ny of ROWS) {
        g.drawImage(src, 0, Math.round(ny * k), src.width, Math.round(k), 0, 0, src.width, Math.round(k));
        const d = g.getImageData(0, 0, strip.width, strip.height).data;
        const cols = new Array(320);
        for (let nx = 0; nx < 320; nx++) {
          let worst = 0;
          for (let dy = 0; dy < strip.height; dy++) {
            const i = (dy * strip.width + Math.round(nx * k)) * 4;
            worst = Math.max(worst, d[i] + d[i + 1] + d[i + 2]);
          }
          cols[nx] = worst;
        }
        out.rows.push(cols);
      }
      samples.push(out);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__wipeSamples = samples;
  return { k };
};

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { failed = true; console.log("  [pageerror]", e.message); });
  await page.goto(`${baseUrl(PORT)}/?skipTitle=1&noEncounters=1&map=s300`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  // A stage that is not loaded yet, so the swap really reloads a map.
  const dest = await page.evaluate(() => {
    const warm = new Set(window.__assetLocality().retainedStages);
    const here = window.__state.manifest.maps[window.__state.mapIdx].id;
    return window.__state.manifest.maps.map((m) => m.id).find((id) => id !== here && !warm.has(id));
  });
  await page.evaluate(INSTALL_RECORDER);
  await page.evaluate((to) => {
    window.__fade.dir = 1;
    window.__fade.pending = { to, spawnX: null, spawnY: null, dir: "down", scripted: true };
  }, dest);
  // 32 frames to close, the load, then 21 to open.
  await page.waitForTimeout(4000);
  const samples = await page.evaluate(() => window.__wipeSamples);

  const mod = await import("../web/stage-wipe.js");
  const COVERED = 8;
  const open = samples.filter((s) => s.phase === -1);
  const close = samples.filter((s) => s.phase === 1);
  console.log(`recorded ${close.length} close frames and ${open.length} open frames`);

  // ---- the open, sampled at 3 frames ------------------------------------
  // The drawn frames are 1..19 (frame 20's band is already 0 px wide).
  const drawn = open.filter((s) => s.frame >= 1 && mod.openFrame(s.frame).bandW > 0);
  if (drawn.length < 3) {
    console.log(`FAIL: only ${drawn.length} open frames with a band, wanted 3`);
    failed = true;
  }
  const pick = [];
  for (const target of [3, 9, 15]) {
    // Nearest recorded frame to the target, so the check does not depend on how
    // many frames the browser managed to record.
    let best = null;
    for (const s of drawn) {
      if (!best || Math.abs(s.frame - target) < Math.abs(best.frame - target)) best = s;
    }
    if (best && !pick.includes(best)) pick.push(best);
  }
  for (const s of pick) {
    const row = s.rows[1];               // native y = 120, through the middle
    const f = mod.openFrame(s.frame);
    const edgeL = row[2], edgeR = row[317], centre = row[160];
    // Column run: the first and last covered column (seam columns skipped).
    let first = -1, last = -1;
    for (let x = 0; x < 320; x++) {
      if (x % 64 === 0) continue;
      if (row[x] <= COVERED) { if (first < 0) first = x; last = x; }
    }
    const edges = edgeL > COVERED && edgeR > COVERED;
    const middle = centre <= COVERED;
    const geom = first >= 0 && Math.abs(first - f.bandX) <= 2
      && Math.abs(last - (f.bandX + f.bandW - 1)) <= 2;
    const ok = edges && middle && geom;
    console.log(
      `open frame ${s.frame}: band ${f.bandX}..${f.bandX + f.bandW - 1} (want ${f.bandX}..${f.bandX + f.bandW - 1})` +
      ` | covered columns ${first}..${last} | edges field ${edges} (L ${edgeL}, R ${edgeR})` +
      ` | centre covered ${middle} (${centre}) ${ok ? "OK" : "MISMATCH"}`);
    if (!ok) failed = true;
  }

  // ---- the close, one frame's polarity ----------------------------------
  // The cover is everything AROUND the window, so both screen edges are black
  // while the window still shows the field.
  const c = close.find((s) => s.frame === 10) ?? close[close.length - 1];
  if (!c) {
    console.log("FAIL: no close frames recorded");
    failed = true;
  } else {
    const row = c.rows[1];
    const edgeL = row[2], edgeR = row[317];
    const lit = row.filter((v) => v > COVERED).length;
    const ok = edgeL <= COVERED && edgeR <= COVERED && lit > 0;
    console.log(
      `close frame ${c.frame}: edges covered ${edgeL <= COVERED && edgeR <= COVERED}` +
      ` (L ${edgeL}, R ${edgeR}) | field still visible in ${lit}/320 columns ${ok ? "OK" : "MISMATCH"}`);
    if (!ok) failed = true;
  }

  if (failed) console.log("FAIL: the wipe drawn on screen is not the decoded wipe");
  else console.log("PASS: the open paints the cover inside the band and the close around the window");
} finally {
  await browser.close().catch(() => {});
}
process.exit(failed ? 1 : 0);