// tools/verify_encounter_roll.mjs — the live field roll, with the RNG pinned to
// one slot, must launch the exact record the SHIPPED stage pool names; and a
// stage that registers no type-4 zone map must roll nothing at all.
//
// Authority: docs/research/field/encounter-step-counter-decoded-2026-07-25.md
// (ENCOUNTER-Q001, resolved) and docs/research/battle/battle-invocation.md.
//   * fieldstg F0x80092664: counter -= RATE[block[0]]; on expiry the gated
//     selector runs and the counter resets.
//   * F0x800925a8: slot = rand() & 7; screen = block.slots[slot].
//   * A stage whose wstag init never calls set_resource(4, ...) has zonemgr[4]=0;
//     fieldstg's phase-0 clear zeroes it on entry, so the driver returns.
//
// The success value is NOT injected: the expected enemy is read from the shipped
// JSON by direct indexing, and the check only forces THE EXACT SLOT the original
// rolls (`rand()&7`) plus the countdown state that is already a saved counter.
// The battle itself is started by the production field loop, not called here.
//
// Run: .opencode/autonomy/check-browser tools/verify_encounter_roll.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.ENCOUNTER_SHOT ||
  ".dw3-research/autonomous-plan/shots/encounter-roll";
mkdirSync(OUT, { recursive: true });

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const load = async (p) =>
  JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const STAGE = await load("stage_encounters.json");
const FIELD = await load("field_encounters.json");
const GRIDS = await load("zone_grids.json");

const PARTY = ["p003pken", "p005koet", "p004kogu"];
// A constant in [0, 0x10000) whose low 3 bits are the slot we want (3).
const SLOT = 3;
const PINNED_RANDOM = (SLOT + 0.5) / 0x10000;

function zoneOf(stageId, x, y) {
  const g = GRIDS.stages[String(stageId).replace(/^s/, "")];
  if (!g) return 0;
  if ("uniform" in g) return g.uniform;
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return 0;
  return g.grid[cy * g.w + cx];
}

// Direct indexing of the shipped tables — independent of the engine helpers the
// game itself calls, so a bug in those cannot make this assertion pass.
function expectedRoll(stageId, x, y, slot) {
  const stage = STAGE.stages[String(stageId).replace(/^s/, "")];
  const zone = zoneOf(stageId, x, y);
  const block = zone ? stage.zones[zone - 1] : null;
  const screen = block ? block.slots[slot] : 0;
  const party = screen ? FIELD.screens[String(screen)] : null;
  return { zone, screen: screen || 0, enemy: party?.[0]?.name ?? null };
}

const browser = await chromium.launch();
const errors = [];

async function open(stageId) {
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
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${ROOT}/?skipTitle=1&map=${stageId}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(900);
  return { context, page };
}

const read = (page) => page.evaluate(() => ({
  x: window.__state.x, y: window.__state.y,
  tick: window.__state._encTick, counter: window.__state._encCounter,
  battle: window.__battle.isActive(),
}));

// ── 1. Idle: the tick free-runs, but the driver never runs with no movement. ──
{
  const { context, page } = await open("s320");
  const before = await read(page);
  await page.waitForTimeout(1000);
  const after = await read(page);
  assert.ok(after.tick > before.tick,
    `idle must advance the free-running tick: ${before.tick} -> ${after.tick}`);
  assert.equal(after.counter, before.counter,
    `idle must not drain the countdown: ${before.counter} -> ${after.counter}`);
  assert.equal(after.battle, false, "idle must not start a battle");
  console.log(`idle          : tick ${before.tick}->${after.tick}, ` +
    `counter held at ${after.counter}, no battle`);

  // ── 2. Controlled roll: force the countdown to expire on the next beat and
  //           pin rand()&7 = 3. The production loop must launch the exact pool
  //           record for the zone the player is standing in. ──
  const want = expectedRoll("s320", after.x, after.y, SLOT);
  assert.equal(want.zone, 1, `s320 spawn must be in zone 1, got ${want.zone}`);
  assert.equal(want.screen, 85, "s320 zone 1 slot 3 is screen 85 in the shipped pool");
  assert.equal(want.enemy, "Raremon");
  await page.evaluate((r) => {
    Math.random = () => r;
    window.__state._encCounter = 1;   // save-state countdown, expires on the next run
    window.__state._encTick = 0;      // on the 8-tick beat
  }, PINNED_RANDOM);
  await page.keyboard.down("ArrowLeft");
  await page.waitForFunction(() => window.__battle.isActive(), null, { timeout: 5000 });
  await page.keyboard.up("ArrowLeft");
  await page.screenshot({ path: `${OUT}/s320-roll.png` });
  const pk = await page.evaluate(() => window.__battle.peek());
  assert.equal(pk.enemy?.name, want.enemy,
    `s320 zone ${want.zone} slot ${SLOT} must be ${want.enemy}: ${JSON.stringify(pk)}`);
  console.log(`s320 roll     : zone ${want.zone} slot ${SLOT} -> screen ${want.screen} ` +
    `= ${pk.enemy.name} (production field roll)`);
  const counterOk = await page.evaluate(() => window.__state._encCounter <= 1279);
  assert.equal(counterOk, true, "the post-expiry reset stays inside 0..1279");
  await context.close();
}

// ── 3. Zero-rate area: s210 registers no type-4 zone map, so the module gate
//        returns and the countdown is not even touched while walking. ──
{
  const { context, page } = await open("s210");
  const lvl = await page.evaluate(() =>
    window.__battle.encounterRateLevel("s210", window.__state.x, window.__state.y));
  assert.equal(lvl, 0, "a stage with no type-4 registration reports rate level 0");
  const before = await read(page);
  await page.evaluate(() => { window.__state._encCounter = 5; window.__state._encTick = 0; });
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(1600);
  await page.keyboard.up("ArrowLeft");
  const after = await read(page);
  assert.ok(after.tick > before.tick, "the field still ticks in a grid-less stage");
  assert.equal(after.counter, 5,
    `a grid-less stage must not drain the countdown at all: ${before.counter} -> ${after.counter}`);
  assert.equal(after.battle, false, "a grid-less stage must start no random battle");
  await page.screenshot({ path: `${OUT}/zero-rate-s210.png` });
  console.log(`zero-rate s210: rate level 0, tick ${before.tick}->${after.tick}, ` +
    `counter untouched at 5, no battle`);
  await context.close();
}


// ── 4. Wall contact: the beat is gated on the movement PATH, not on
//        displacement — the native's walk call site passes `moving` as a
//        literal 1, so pushing a wall still ticks and drains the driver.
{
  const { context, page } = await open("s320");
  // Seed the leader against the left margin so the held direction is blocked
  // from the first frame (a position prerequisite, not the value under test).
  await page.evaluate(() => window.__setMap(window.__state.mapIdx, { x: 14, y: 400 }));
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__state._encCounter = 1279; window.__state._encTick = 0; });
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(250);            // settle against the wall
  const b = await read(page);
  await page.waitForTimeout(1200);
  const a = await read(page);
  await page.screenshot({ path: `${OUT}/wall-contact.png` });
  await page.keyboard.up("ArrowLeft");
  assert.equal(a.x, b.x, `the wall must hold x: ${b.x} -> ${a.x}`);
  assert.equal(a.y, b.y, `the wall must hold y: ${b.y} -> ${a.y}`);
  const drained = b.counter - a.counter;
  assert.ok(drained > 0 && drained % 9 === 0,
    `an input-blocked wall push must still drain by the zone rate 9: ` +
    `${b.counter} -> ${a.counter}`);
  console.log(`wall contact  : x held at ${a.x}, counter ${b.counter}->${a.counter} ` +
    `(drained ${drained} = ${drained / 9} driver runs)`);
  await context.close();
}

await browser.close();
assert.deepEqual(errors, [], "no page errors");
console.log("encounter roll OK — idle holds the counter, a pinned-RNG field roll launches " +
  "the shipped pool, a grid-less stage stays quiet, and a wall push still ticks the driver");
