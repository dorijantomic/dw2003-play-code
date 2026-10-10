// Fishing FISH-Q006 follow-up: the strike's stop position on the real screen.
//
// Decode (authority 2): on a CIRCLE strike the bobber's +0x60 speed (0x100) is
// stepped down by 0x10 (3 rolls in 4) or 4 (1 in 4) each tick while +0x5c keeps
// moving by the decaying speed. So the marker glides exactly
//   0x10 * (15+14+...+1) = 0x780   (fast, 7.5 bands)
//   4 * (63+62+...+1)     = 0x1F80  (slow, 31.5 bands)
// past the press, plus the strike tick's own 0x100. The band is then read at
// that parked position. engine/systems/fishing.ts models it; this drives the
// REAL game and checks the observed stop against those numbers.
//
// The existing tools/verify_fishing.mjs is the full controlled replay (pole
// gate, cast, settle, angler clips, sweep, strike, band -> battle, budget,
// no item). This one adds the stop-position arithmetic on screen.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_fishing_strike_stop.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.FSTOP_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.FSTOP_SHOT || "/tmp/fishing-strike-stop";
mkdirSync(OUT, { recursive: true });

const STAGE = "s485";
const SPOTS = JSON.parse(readFileSync("web/assets/data/fishing_spots.json", "utf8"));
const GRIDS = JSON.parse(readFileSync("web/assets/data/story_trigger_grids.json", "utf8")).stages;
const cfg = SPOTS[STAGE];
const grid = GRIDS[STAGE.slice(1)];
const idxs = cfg.spots.map((s) => s.stepIndex);
const cells = [];
for (let i = 0; i < grid.grid.length; i++) {
  const v = grid.grid[i];
  if (v && idxs.includes(v & 0x1f)) cells.push({
    x: (i % grid.w) * grid.cell + grid.cell / 2,
    y: Math.floor(i / grid.w) * grid.cell + grid.cell / 2,
  });
}

const PRE = 0x100;          // meter moved on the strike tick itself
const GLIDE_FAST = 0x780;   // 0x10 * (1..15)
const GLIDE_SLOW = 0x1f80;  // 4 * (1..63)

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p005koet", "p004kogu"]));
  localStorage.setItem("inventory", JSON.stringify([{ id: 5, qty: 1 }])); // FishingPole
  localStorage.setItem("bits", "1000");
});

let failed = null;
const fail = (msg) => { failed = msg; console.error("FAIL:", msg); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);
const run = () => page.evaluate(() => {
  const f = window.__state.fishing;
  return f ? {
    phase: f.run.phase, meter: f.run.meter, speed: f.run.speed,
    step: f.run.brakeStep, reversing: f.run.reversing, band: f.run.band,
    pattern: f.run.pattern,
  } : null;
});

try {
  await page.goto(`${BASE}?skipTitle=1&map=${STAGE}&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);

  // Stand on a spot and cast with the ordinary action key.
  let cast = false;
  for (const c of cells) {
    await page.evaluate((p) => window.__tp(p.x, p.y), c);
    await page.waitForTimeout(120);
    await page.keyboard.press(" ");
    await page.waitForTimeout(150);
    if (await run()) { cast = true; break; }
  }
  if (!cast) throw new Error("no Phoenix Bay spot accepted a cast");

  // Wait for the sweep, then strike at a safe point so the glide cannot hit an
  // end and reverse (forward < 0xC00 + 0x2080 stays under 0x3000; reverse >
  // 0x2400 stays above 0).
  await page.waitForFunction(() => window.__state.fishing?.run?.phase === "sweep",
    null, { timeout: 10_000 });
  let pressed = null;
  for (let i = 0; i < 400; i++) {
    const r = await run();
    if (!r) break;
    const safe = r.reversing ? r.meter > 0x2400 : r.meter < 0xc00;
    if (r.phase === "sweep" && safe) {
      // Sample the meter and deliver the strike in the SAME evaluate. Reading the
      // meter over one CDP round trip and pressing over another let the sweep run on
      // for a frame in between, and that frame's 0x100 lands in `moved` — which is why
      // this check used to fail about two runs in three, by exactly 0x100, with the
      // marker's own arithmetic untouched. Dispatching in the same turn means the strike
      // is consumed by the very next frame and `moved` is the glide and nothing else.
      pressed = await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        const r = window.__state.fishing?.run;
        return r && {
          phase: r.phase, meter: r.meter, speed: r.speed, step: r.brakeStep,
          reversing: r.reversing, band: r.band, pattern: r.pattern,
        };
      });
      break;
    }
    await page.waitForTimeout(16);
  }
  if (!pressed) await fail("never found a safe strike point in the sweep");
  await shot("fishing-strike-pressed");

  // The hold branch sets the band on its first tick, one tick after the brake
  // zeroes the speed, so wait for the band itself rather than the phase.
  await page.waitForFunction(
    () => { const r = window.__state.fishing?.run; return r?.phase === "hold" && r.band != null; },
    null, { timeout: 10_000 });
  const stopped = await run();
  await page.waitForTimeout(150);
  await shot("fishing-strike-stopped");

  const forward = !pressed.reversing;
  const moved = forward ? stopped.meter - pressed.meter : pressed.meter - stopped.meter;
  const expected = stopped.step === 0x10
    ? PRE + GLIDE_FAST
    : stopped.step === 4 ? PRE + GLIDE_SLOW : null;
  if (expected == null)
    await fail(`unexpected brake step ${stopped.step}`);
  else if (moved !== expected)
    await fail(`stop glide ${moved} (0x${moved.toString(16)}), expected ${expected} (0x${expected.toString(16)}) for step ${stopped.step}`);
  if (stopped.speed !== 0) await fail(`marker still drifting: speed ${stopped.speed}`);
  if (stopped.band == null) await fail("the stopped marker did not read a band");
  if (errors.length) await fail(`${errors.length} page error(s)`);

  console.log("RESULT", JSON.stringify({
    ok: !failed, cellUsed: cells[0], pressed, stopped, moved, expected, forward,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
