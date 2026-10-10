// tools/verify_transition_wipe.mjs — the ordinary stage-change wipe.
//
// The walker used to draw a flat black fade on every warp. It now draws the
// decoded A27 wipe: a window centred on the player that closes while the screen
// outside it is covered by a grey tile fill (fieldstg F0x8008A5E4; rig capture
// docs/research/field/captures/warp-wipe-2026-09-13/). This freezes the wipe at
// a few fade levels and reads the canvas: partway through, the screen centre
// must still be bright (the open window) while the corner is dark; fully closed
// it must be black.
//
// Needs the game served:  python3 -m http.server 8741 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/verify_transition_wipe.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/transition-wipe";
mkdirSync(out, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1&map=s300`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
await page.waitForTimeout(2500);

const sample = () => page.evaluate(() => {
  const cv = document.getElementById("game");
  const g = cv.getContext("2d");
  const px = (x, y) => {
    const d = g.getImageData(x, y, 1, 1).data;
    return Math.round((d[0] + d[1] + d[2]) / 3);
  };
  return { corner: px(6, 6), centre: px(320, 240), top: px(320, 6) };
});

// The renderer reads the shared fade's WIPE CLOCK, not `fade.alpha`
// (web/game.js drawTransitionWipe: `const clock = state.wipe; if (clock.phase !== 1
// && clock.phase !== -1) return;`), so freezing the fade's own alpha drew nothing.
// Pin the clock at the close frame for that progress and hold `fade.dir` at 0 so
// stepWipeClock never runs (web/game.js:5945 only steps while dir !== 0).
const freeze = async (a) => {
  await page.evaluate((v) => {
    const closeFrames = 32; // WIPE_CLOSE_FRAMES, web/stage-wipe.js:41
    const frame = Math.round(v * closeFrames);
    window.__fade.dir = 0;
    window.__fade.pending = null;
    window.__fade.alpha = v;
    window.__state.wipe = { phase: 1, t: frame, frame };
  }, a);
  await page.waitForTimeout(90);
  return sample();
};

let failed = false;
const check = (ok, msg) => { if (!ok) failed = true; console.log(`${ok ? "ok" : "FAIL"}: ${msg}`); };

const base = await freeze(0);
console.log("alpha 0.00:", JSON.stringify(base));

const half = await freeze(0.45);
console.log("alpha 0.45:", JSON.stringify(half));
await page.screenshot({ path: `${out}/alpha-045.png` });
// The window is centred, so the middle of the screen stays as bright as it was
// while the corner and the top edge (both outside the window) darken.
const dropCentre = base.centre - half.centre;
const dropCorner = base.corner - half.corner;
const dropTop = base.top - half.top;
console.log(`drops  centre=${dropCentre} corner=${dropCorner} top=${dropTop}`);
check(dropCorner > 25, `the closed corner darkens (drop ${dropCorner})`);
check(dropTop > 25, `the closed top edge darkens (drop ${dropTop})`);
check(dropCentre < 12, `the open window leaves the centre alone (drop ${dropCentre})`);
check(dropCorner > dropCentre + 20, `the corner darkens more than the window centre (${dropCorner} vs ${dropCentre})`);

const shut = await freeze(1);
console.log("alpha 1.00:", JSON.stringify(shut));
await page.screenshot({ path: `${out}/alpha-100.png` });
check(shut.centre < 6 && shut.corner < 6, `a fully closed wipe is black (${shut.centre}, ${shut.corner})`);

// Leave the game clean.
await page.evaluate(() => { window.__fade.alpha = 0; window.__fade.dir = 0; });
console.log(`wrote ${out}`);
await b.close();
if (failed) { console.log("wipe check FAILED"); process.exit(1); }
console.log("transition wipe OK");
