// Regression: a fade transition to a COLD stage (one not pre-warmed as a direct
// scene-exit neighbour) must still complete. This is the shape of every
// automatic/scripted story warp (doStoryHandoff → startTransition) and of the
// stagslct gate-travel jump: the destination is not an exit neighbour of the
// current map, so it is not in the warm working set and has to load behind the
// black screen.
//
// The lazy-map-loading gate used to null `fade.pending` before checking
// readiness, so the deferred transition was lost and the screen stayed black
// for ever (and `startTransition` then refused every later warp because
// `fade.dir !== 0`).
//
// Run: tools/run-playwright.sh tools/verify_cold_stage_transition.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log("  [page]", m.text());
  });
  // Boot straight into a field. The old path clicked the title's New Game
  // button, but the first-launch visuals chooser covers it (and the button is
  // not visible until the native title canvas draws), so the click timed out
  // and the regression was never exercised. `?skipTitle=1&map=` is the same
  // started game without the title, so the check runs on the transition it
  // actually cares about.
  await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1&map=s300`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
  const from = await page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);
  await page.waitForTimeout(2500);

  // Pick a destination that is deliberately NOT warm — the cold case.
  const to = await page.evaluate(() => {
    const warm = new Set(window.__assetLocality().retainedStages);
    const here = window.__state.manifest.maps[window.__state.mapIdx].id;
    return window.__state.manifest.maps
      .map((m) => m.id)
      .find((id) => id !== here && !warm.has(id));
  });
  if (!to) throw new Error("no cold stage available — cannot exercise the regression");

  // Fire the transition the way a scripted story handoff does: arm the fade
  // with a pending exit and let the frame loop drive it.
  await page.evaluate((dest) => {
    window.__fade.dir = 1;
    window.__fade.pending = { to: dest, spawnX: null, spawnY: null, dir: "down", scripted: true };
  }, to);

  console.log(`cold transition ${from} → ${to}`);

  let arrived = false;
  try {
    await page.waitForFunction(
      (dest) => window.__state.manifest.maps[window.__state.mapIdx].id === dest,
      to,
      { timeout: 20000 },
    );
    arrived = true;
  } catch { /* reported below */ }

  const diag = await page.evaluate(() => ({
    mapId: window.__state.manifest.maps[window.__state.mapIdx].id,
    fade: { dir: window.__fade.dir, alpha: window.__fade.alpha, pending: window.__fade.pending?.to ?? null },
    ready: window.__assetLocality().readyStages,
  }));

  if (!arrived) {
    failed = true;
    console.log(`FAIL: never arrived at ${to}`);
    console.log("  ", JSON.stringify(diag));
    if (diag.fade.dir === 1 && diag.fade.alpha >= 1 && diag.fade.pending === null)
      console.log("   → wedged on a black screen with the pending exit dropped");
  } else {
    // The fade must also come back up, otherwise we arrived under a black screen.
    await page.waitForFunction(() => window.__fade.dir === 0 && window.__fade.alpha <= 0, null, { timeout: 10000 })
      .catch(() => { failed = true; console.log("FAIL: arrived but the screen never faded back in"); });
    if (!failed) console.log(`PASS: arrived at ${diag.mapId}, screen restored`);
  }

  // A wedged fade also blocks every later warp; prove transitions still work.
  if (!failed) {
    const back = await page.evaluate(async (dest) => {
      const maps = window.__state.manifest.maps;
      await window.__setMap(maps.findIndex((m) => m.id === dest));
      return maps[window.__state.mapIdx].id;
    }, from);
    if (back !== from) { failed = true; console.log(`FAIL: could not warp back (at ${back})`); }
    else console.log(`PASS: follow-up warp back to ${from} works`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
