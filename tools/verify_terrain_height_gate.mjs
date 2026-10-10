// Submarimon terrain-height gate — end-to-end regression.
//
// While wearing the water form, a raised or lowered terrain tier refuses the
// step until the sub is at the right depth (fieldstg F0x8008DE0C; engine
// collapse terrainHeightGate). On s825 at y=292 there is a clear run from x=332
// into a run of terrain code 22 cells at x=356..360 (passes only while the
// height is UNDER 0x2001). Thrusting also dives, so the height is held fixed
// during each run to isolate the gate: at 0x3000 the tier refuses the step; at
// 0x1800 (the water-column floor) it opens.
//
// Run: tools/run-playwright.sh tools/verify_terrain_height_gate.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = `${baseUrl(8741)}`;
const SEABED = "s825";
const START = { x: 332, y: 292 };
const GATE_X = 356;

const browser = await chromium.launch();
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed++; });
  await page.goto(`${BASE}/?skipTitle=1&map=${SEABED}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  const snap = () => page.evaluate(() => {
    const s = window.__state;
    return { x: s.x, y: s.y, sub: s.submarimon ? { height: s.submarimon.heightFixed } : null };
  });
  const place = (height) => page.evaluate(({ at, h }) => {
    const s = window.__state;
    s.x = at.x; s.y = at.y; s.dir = "right";
    s.submarimon.facing = 6;             // engine facing 6 = right
    s.submarimon.speedFixed = 0;
    s.submarimon.velocityFixed = 0;
    s.submarimon.heightFixed = h;
  }, { at: START, h: height });
  // Thrust while pinning the height, so only the gate decides the step.
  const thrustAt = async (height) => {
    await place(height);
    await page.keyboard.down("x");       // the sub's throttle is word bit 0x4000 = BACK = the key `x` (engine/systems/input-map.ts)
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(40);
      await page.evaluate((h) => {
        const s = window.__state;
        if (s.submarimon) { s.submarimon.heightFixed = h; s.submarimon.velocityFixed = 0; }
      }, height);
    }
    await page.keyboard.up("x");
    await page.waitForTimeout(200);
    return snap();
  };

  // Height 0x3000 is OVER the code-22 tier (0x2001): the step is refused.
  const blocked = await thrustAt(0x3000);
  check(blocked.x < GATE_X, "above the tier the step is refused", `x=${blocked.x.toFixed(1)}`);

  // At the water-column floor (under 0x2001) the same cell opens.
  const crossed = await thrustAt(0x1800);
  check(crossed.x > GATE_X, "under the tier the sub crosses", `x=${crossed.x.toFixed(1)}`);
} finally {
  await browser.close();
}
console.log(failed === 0 ? "\nTERRAIN HEIGHT GATE OK" : `\n${failed} CHECK(S) FAILED`);
if (failed) process.exit(1);
