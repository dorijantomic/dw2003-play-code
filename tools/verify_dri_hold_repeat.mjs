// tools/verify_dri_hold_repeat.mjs — the Lab desk's held-direction repeat.
//
// Original: the Switch screens read the pad service's repeat word as well as
// its pressed word (F0x8008b798 case 4), so a held direction walks the cursor on
// the shared curve — edge, then +16 ticks, +6, then every 4 (PAD_REPEAT /
// padRepeatFires, claim SHARED-INPUT-PAD-REPEAT). This check drives the real
// game loop: open the Lab, hold ArrowDown with a single keydown (no auto-repeat
// from the browser), and watch the cursor advance on that cadence.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_hold_repeat.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_HOLD_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_HOLD_SHOT || ".dw3-research/autonomous-plan/shots/dri-hold-repeat";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
});
await page.addInitScript(() => {
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  const m = (id, lvl) => ({ digimonId: id, level: lvl, xp: 0, hp: 300, maxHp: 300, mp: 100, maxMp: 100, stats: { str: 50, def: 40, spt: 40, wis: 40, spd: 40, chr: 30 }, bonuses: {}, elemBonuses: {} });
  localStorage.setItem("partnerStats", JSON.stringify(m(1, 10)));
  localStorage.setItem("partyStats", JSON.stringify([m(1, 10), m(7, 10), m(8, 10)]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("rosterOwned", "199");
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const results = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(400);

  // Open the real Lab on the Switch list (three pedestals) and hold ArrowDown.
  await page.evaluate(() => window.__dri.openAction(0, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "switch_from", null, { timeout: 5_000 });
  results.before = await page.evaluate(() => ({ screen: window.__dri.screen, cursor: window.__dri.cursor }));

  // One keydown, no keyup: the browser sends no auto-repeat, so any movement
  // after the edge is the decoded in-game repeat.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })));
  results.timeline = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    const t0 = performance.now();
    let last = null;
    const tick = () => {
      const c = window.__dri.cursor;
      if (c !== last) { out.push({ t: Math.round(performance.now() - t0), cursor: c }); last = c; }
      if (performance.now() - t0 > 1200) { resolve(out); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" })));
  results.afterRelease = await page.evaluate(() => window.__dri.cursor);
  await page.waitForTimeout(500);
  results.stillAfterRelease = await page.evaluate(() => window.__dri.cursor);
  writeFileSync(`${OUT}/held-down-repeat.png`,
    Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));

  // The edge is one change; the repeats start at least a 16-tick beat later.
  const tl = results.timeline;
  const moves = tl.map((x) => x.cursor);
  if (tl.length < 3) fail(`the held direction did not repeat: ${JSON.stringify(tl)}`);
  const first = tl[0];
  const firstRepeat = tl[1];
  if (!firstRepeat || firstRepeat.t - first.t < 200) {
    fail(`the repeat came too early to be the 16-tick beat: ${JSON.stringify(tl)}`);
  }
  if (results.afterRelease !== results.stillAfterRelease) {
    fail(`the cursor kept moving after release: ${results.afterRelease} -> ${results.stillAfterRelease}`);
  }
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.before.screen === "switch_from", `not on the switch list: ${JSON.stringify(results.before)}`);
  assert(results.timeline.length >= 3, `expected edge + 2 repeats: ${JSON.stringify(results.timeline)}`);
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
