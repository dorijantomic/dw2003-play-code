// tools/verify_submarimon_encounter_gate.mjs — only the THRUST state rolls for
// random encounters; coasting with the engine off does not.
//
// Authority (original assembly, decoded): only the thrust state 0x4b calls the
// movement-tick hook F0x8008fd74 (file 0xd5a4, a1=1 a2=1); the coast state 0x4c
// has no such call. engine/systems/submarimon-motion.ts encodes that as
// `submarimonRollsEncounter(motion, thrusting) = thrusting && speed > 0`, and
// web/game.js feeds it into `encEligible` for the step-counter driver.
//
// The check drives the REAL field loop on the Seabed (s850, uniform zone 1,
// rate level 2 = rate 4): hold CROSS (keyboard `c`) to thrust and watch the
// countdown drain, then release it and watch the sub keep GLIDING with the
// countdown untouched. `?noEncounters=1` mirrors the engine's launch master
// switch, which gates only the battle launch -- the driver still drains and
// resets, so the cadence under test is unchanged and no fight can interrupt.
//
// Run: .opencode/autonomy/check-browser tools/verify_submarimon_encounter_gate.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const BASE = `${ROOT}/`;
const OUT = process.env.SUBENC_SHOT ||
  ".dw3-research/autonomous-plan/shots/submarimon-encounter-gate";
const SUBMARIMON_SPRITE = 327;
const RATE = 4;                       // RATE[rate_level 2] on s850
mkdirSync(OUT, { recursive: true });

const PARTY = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 960, height: 720 },
  storageState: {
    cookies: [],
    origins: [{
      origin: ROOT,
      localStorage: [
        { name: "assetMode", value: "authentic" },
        { name: "engineSchema", value: "2" },
        { name: "party", value: JSON.stringify(PARTY) },
        { name: "charId", value: PARTY[0] },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const field = () => page.evaluate(() => {
  const st = window.__state;
  const id = st.manifest.maps[st.mapIdx].id;
  return {
    map: id,
    x: Math.round(st.x), y: Math.round(st.y),
    form: st.diveForm?.spriteId ?? null,
    sub: st.submarimon
      ? { speed: st.submarimon.speedFixed, height: st.submarimon.heightFixed }
      : null,
    tick: st._encTick, counter: st._encCounter,
    battle: window.__battle.isActive(),
    cross: st.keys.has("cross"),
    level: window.__battle.encounterRateLevel(id, st.x, st.y),
  };
});

const settled = () => page.waitForFunction(() => {
  const st = window.__state;
  return st?.started && window.__fade.dir === 0
    && !(window.__cutscene?.isActive?.() ?? false);
}, null, { timeout: 15_000 });

// ── Reach the Seabed as Submarimon. Direct entry is tried first; if the form is
// not reconstructed on that map, fall back to the real s330 dive (the fixture
// tools/verify_dive_roundtrip.mjs uses), seeding only the prerequisites. ──
await page.goto(`${BASE}?skipTitle=1&map=s850&noEncounters=1`, { waitUntil: "load" });
await settled();
await page.waitForTimeout(400);
let start = await field();
if (start.form !== SUBMARIMON_SPRITE || !start.sub) {
  console.log(`direct s850 boot has no sub form (${start.form}); diving from s330`);
  await page.goto(`${BASE}?skipTitle=1&map=s330&noEncounters=1`, { waitUntil: "load" });
  await settled();
  await page.waitForTimeout(300);
  await page.evaluate((flag) => {
    const s = window.__state;
    window.__engine.state.vars.set("$story.ordinal", 30);
    if (!s.inventory.some((i) => i.id === 16)) s.inventory.push({ id: 16, qty: 1 });
  }, 0x7093);
  const dive = await page.evaluate(() =>
    window.__state.scenes["s330"].exits.find((e) => e.to === "s850" && e.stepOp === 10));
  assert.ok(dive, "s330 carries the op-10 water dive to s850");
  await page.evaluate((d) => window.__tp(d.x + d.w / 2, d.y + d.h / 2), dive);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    window.__state.manifest.maps[window.__state.mapIdx].id === "s850", null, { timeout: 12_000 });
  await settled();
  await page.waitForTimeout(400);
  start = await field();
}

assert.equal(start.map, "s850", `must be on the Seabed, got ${start.map}`);
assert.equal(start.form, SUBMARIMON_SPRITE, `must be Submarimon (327), got ${start.form}`);
assert.ok(start.sub, "the Submarimon buoyancy state must exist");
assert.equal(start.level, 2, `s850 uniform zone 1 rate level must be 2, got ${start.level}`);

// Seed the saved countdown high so the test never rolls; the DRAIN is what is
// under test, and the launch master switch is already off.
await page.evaluate(() => { window.__state._encCounter = 1279; window.__state._encTick = 0; });
const a = await field();

// ── Thrust: the driver runs and drains by the zone rate. ──
await page.keyboard.down("x");
await page.waitForTimeout(1500);
const b = await field();
await page.screenshot({ path: `${OUT}/thrust.png` });
assert.equal(b.battle, false, "no battle may interrupt the measurement");
assert.equal(b.cross, true, "CROSS must be held during the thrust window");
assert.ok(b.sub && b.sub.speed > 0, `the sub must be advancing under thrust: ${JSON.stringify(b.sub)}`);
const thrustDrain = a.counter - b.counter;
assert.ok(thrustDrain > 0 && thrustDrain % RATE === 0,
  `thrust must drain the countdown in multiples of ${RATE}: ${a.counter} -> ${b.counter}`);

// ── Coast: release CROSS. The hull keeps gliding (state.moving stays true, the
// tick keeps advancing) but the driver must NOT run, so the countdown holds. ──
await page.keyboard.up("x");
await page.waitForTimeout(250);
const c = await field();
assert.ok(c.sub && c.sub.speed > 0,
  `the sub must still be GLIDING after release: ${JSON.stringify(c.sub)}`);
await page.waitForTimeout(1200);
const d = await field();
await page.screenshot({ path: `${OUT}/coast.png` });

// The driver stops the frame the release lands, but the countdown only moves in
// steps of RATE every ENCOUNTER_TICK_FRAMES, so the step that was already due
// when the snapshot was taken can still land just after it. Allow exactly that
// one step across the release boundary, then require the settled coast to hold.
assert.ok(c.counter <= b.counter && c.counter >= b.counter - RATE,
  `the countdown must stop at the release boundary (one step of ${RATE} at most): ${b.counter} -> ${c.counter}`);
assert.equal(d.counter, c.counter,
  `the countdown must stay untouched through the whole coast: ${c.counter} -> ${d.counter}`);
assert.ok(d.tick > b.tick,
  `the field tick must keep advancing while coasting: ${b.tick} -> ${d.tick}`);
assert.equal(d.battle, false, "no battle may start from a coast");

await browser.close();
assert.deepEqual(errors, [], "no page errors");
console.log(`submarimon gate OK — s850 rate level ${start.level}: thrust drained ` +
  `${thrustDrain} = ${thrustDrain / RATE} driver runs; a released coast glided ` +
  `(speed ${c.sub.speed} -> ${d.sub?.speed ?? 0}) with the countdown held at ${c.counter}`);
