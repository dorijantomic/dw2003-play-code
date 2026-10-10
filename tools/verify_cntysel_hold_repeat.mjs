// tools/verify_cntysel_hold_repeat.mjs — the language screen's held repeat.
//
// The language screen reads held directions on the pad service's curve (edge,
// then +16 ticks, +6, then every 4; PAD_REPEAT / padRepeatFires). Turn 65 moved
// the held-set recording to the top of dispatchInput because every open screen
// (this one included) returns before the old tail add, so the repeat had never
// fired in the real game. This check drives the real screen through the game
// loop with one keydown and no keyup.
//
// Run: .opencode/autonomy/check-browser tools/verify_cntysel_hold_repeat.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.CNTYSEL_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.CNTYSEL_SHOT || ".dw3-research/autonomous-plan/shots/cntysel-hold-repeat";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const results = { errors };
try {
  // `legacyCntysel=1` keeps this check on the hand-authored screen it was written
  // for: the lab entry now opens the shipped pro/cnty_sel overlay, whose own
  // route and held-pad handling are covered by tools/verify_native_cntysel.mjs.
  await page.goto(`${ROOT}?skipTitle=1&noEncounters=1&legacyCntysel=1`);
  await page.waitForFunction(() => window.__state?.started && typeof window.__labOpen === "function", null, { timeout: 40_000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__labOpen("cntysel"));
  await page.waitForFunction(() => window.__labCntysel?.open === true, null, { timeout: 5_000 });
  // The screen gates input until its opening frames have run.
  await page.waitForFunction(() => window.__labCntysel.listReady(), null, { timeout: 5_000 });
  results.before = await page.evaluate(() => ({ cursor: window.__labCntysel.cursor, row: window.__labCntysel.row()?.name ?? null }));

  // One keydown, no keyup: the browser sends no auto-repeat, so movement after
  // the edge is the in-game repeat on the decoded curve.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })));
  results.timeline = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    let last = null;
    const tick = () => {
      const c = window.__labCntysel.cursor;
      if (c !== last) { out.push({ t: Math.round(performance.now() - t0), cursor: c }); last = c; }
      if (performance.now() - t0 > 1200) { resolve(out); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" })));
  results.afterRelease = await page.evaluate(() => window.__labCntysel.cursor);
  await page.waitForTimeout(400);
  results.stillAfterRelease = await page.evaluate(() => window.__labCntysel.cursor);
  writeFileSync(`${OUT}/held-down-repeat.png`,
    Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));

  const tl = results.timeline;
  if (tl.length < 3) fail(`the held direction did not repeat: ${JSON.stringify(tl)}`);
  if (tl[1] && tl[1].t - tl[0].t < 200) fail(`the repeat came too early for the 16-tick beat: ${JSON.stringify(tl)}`);
  if (results.afterRelease !== results.stillAfterRelease) fail(`the cursor moved after release: ${results.afterRelease} -> ${results.stillAfterRelease}`);
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.timeline.length >= 3, `expected edge + repeats: ${JSON.stringify(results.timeline)}`);
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
