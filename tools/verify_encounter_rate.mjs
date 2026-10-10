// tools/verify_encounter_rate.mjs — headless check that the decoded encounter step
// counter actually drives the field (ENCOUNTER-Q001, 2026-07-25).
//
// Drives the real web/game.js loop, not a mock: walks the player on a stage with a
// known zone rate and asserts the observed roll cadence matches the decoded model
// (one driver run per 8 movement ticks, counter 0..1279, rate = RATE[zone level]).
//
// Run: npm run pw tools/verify_encounter_rate.mjs   (serve web/ on :8742 first)
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const URL = `${ROOT}/index.html`;

const party = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 960, height: 720 },
  storageState: {
    cookies: [],
    origins: [{
      origin: ROOT,
      localStorage: [
        { name: "engineSchema", value: "2" },
        { name: "party", value: JSON.stringify(party) },
        { name: "charId", value: party[0] },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// The rate model itself, straight from the shipped engine bundle + data.
const model = await page.evaluate(async () => {
  const eng = await import("./vendor/engine.js");
  const db = await fetch("assets/data/stage_encounters.json").then((r) => r.json());
  const levels = {};
  for (const s of Object.values(db.stages))
    for (const z of s.zones) levels[z.rate_level] = (levels[z.rate_level] || 0) + 1;
  // Expected driver runs from a full counter, per level.
  const runs = (lvl) => {
    let c = 1279, n = 0;
    for (;;) { const r = eng.encounterStepTick(c, lvl); c = r.counter; n++; if (r.expired) break; }
    return n;
  };
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 4096; i++) {
    const v = eng.resetEncounterCounter(() => i);
    min = Math.min(min, v); max = Math.max(max, v);
  }
  return {
    rateTable: [...eng.ENCOUNTER_RATE_TABLE],
    dataRateTable: db.rate_table,
    tickFrames: eng.ENCOUNTER_TICK_FRAMES,
    levels, counterMin: min, counterMax: max,
    runsPerLevel: [0, 1, 2, 3, 4, 5].map(runs),
  };
});

const fail = [];
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail.push(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

eq("rate table (engine)", model.rateTable, [2000, 3, 4, 6, 9, 18]);
eq("rate table (shipped data)", model.dataRateTable, [2000, 3, 4, 6, 9, 18]);
eq("driver tick period", model.tickFrames, 8);
eq("counter domain", [model.counterMin, model.counterMax], [0, 1279]);
eq("driver runs per level", model.runsPerLevel, [1, 427, 320, 214, 143, 72]);
// Every shipped zone level must index the 6-entry table.
for (const k of Object.keys(model.levels))
  if (!(Number(k) >= 0 && Number(k) <= 5)) fail.push(`zone rate_level out of range: ${k}`);

// Live field walk on s320 (a single zone, rate level 4 = rate 9): walking must
// advance the free-running tick and drain the counter by whole multiples of the
// zone's rate — the decoded driver running inside the real game loop.
const MAP = "s320";
await page.goto(`${ROOT}/?skipTitle=1&map=${MAP}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
await page.waitForTimeout(1200);

const before = await page.evaluate(() => ({
  tick: window.__state._encTick, counter: window.__state._encCounter,
}));
const level = await page.evaluate(
  (m) => window.__battle.encounterRateLevel(m, window.__state.x, window.__state.y), MAP,
);
await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(2000);
await page.keyboard.up("ArrowLeft");
const after = await page.evaluate(() => ({
  tick: window.__state._encTick, counter: window.__state._encCounter,
}));

const rate = model.rateTable[level];
const drained = before.counter - after.counter;
if (level !== 4) fail.push(`${MAP} zone rate level: got ${level} want 4`);
if (!(after.tick > before.tick))
  fail.push(`field tick did not advance while walking: ${before.tick} -> ${after.tick}`);
// A battle may start mid-walk and reset the counter; only assert when it did not.
if (drained > 0 && drained % rate !== 0)
  fail.push(`counter drained ${drained}, not a multiple of the zone rate ${rate}`);
if (!Number.isInteger(after.counter) || after.counter > 1279)
  fail.push(`counter left its decoded domain: ${after.counter}`);

// The engine's master switch [0x80042b1c] gates only the launch: with it off the
// driver still runs and the counter still drains and resets. ?noEncounters=1 is
// the walker's stand-in, so it must drain too — not freeze the counter.
await page.goto(`${ROOT}/?skipTitle=1&map=${MAP}&noEncounters=1`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
await page.waitForTimeout(1200);
const offBefore = await page.evaluate(() => window.__state._encCounter);
await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(2000);
await page.keyboard.up("ArrowLeft");
const offAfter = await page.evaluate(() => window.__state._encCounter);
const offDrained = offBefore - offAfter;
if (!(offDrained > 0 && offDrained % rate === 0))
  fail.push(`noEncounters walk drained ${offDrained}, expected a positive multiple of ${rate}`);
console.log(`gate-off walk    : counter ${offBefore}->${offAfter} ` +
  `(drained ${offDrained} = ${offDrained / rate} driver runs, no battle)`);

console.log(`live walk        : ${MAP} level ${level} (rate ${rate}), tick ` +
  `${before.tick}->${after.tick}, counter ${before.counter}->${after.counter} ` +
  `(drained ${drained}${drained > 0 ? ` = ${drained / rate} driver runs` : ""})`);
console.log("rate table       :", model.rateTable.join(", "));
console.log("counter domain   :", model.counterMin, "..", model.counterMax);
console.log("driver runs/level:", model.runsPerLevel.join(", "));
console.log("zone levels      :", JSON.stringify(model.levels));
if (errors.length) console.log("page errors      :", errors.slice(0, 3));

await browser.close();

if (fail.length || errors.length) {
  for (const f of fail) console.error("FAIL", f);
  for (const e of errors) console.error("PAGEERROR", e);
  process.exit(1);
}
console.log("encounter-rate verification OK");
