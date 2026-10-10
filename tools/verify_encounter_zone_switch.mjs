// tools/verify_encounter_zone_switch.mjs — the story ordinal must switch which
// zone-block group the live roll reads, on a multi-group stage.
//
// Authority: engine/dw3/encounters.ts and
// docs/research/field/encounter-step-counter-decoded-2026-07-25.md.
//   scene_struct+0x20 holds ONE selector record {tag, key, 0, ZoneBlock*[4]}.
//   s335 (Wire Forest) is family "progress_ordinal": wstag335.s file 0x1cc-0x224
//   runs `slti $v0,$v1,0xb` / `slti $v0,$v1,0x18` on [0x8004b370] and stores the
//   matched record. Bands: ord<11 -> record 0, 11<=ord<24 -> record 1, else 2.
//
// The check pins the RNG slot (the original's rand()&7) and the saved ordinal,
// then lets the PRODUCTION field loop start the battle. The expected enemy is
// read from the shipped JSON by direct indexing, per band, so a wrong group
// selection changes what appears.
//
// Run: .opencode/autonomy/check-browser tools/verify_encounter_zone_switch.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.ENCOUNTER_SHOT ||
  ".dw3-research/autonomous-plan/shots/encounter-zone-switch";
mkdirSync(OUT, { recursive: true });

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const load = async (p) =>
  JSON.parse(await readFile(new URL(`../web/assets/data/${p}`, import.meta.url)));
const STAGE = await load("stage_encounters.json");
const FIELD = await load("field_encounters.json");
const GRIDS = await load("zone_grids.json");

const PARTY = ["p003pken", "p005koet", "p004kogu"];
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

// The expected enemy for an ORDINAL BAND, read straight out of the shipped
// tables: band -> group index -> the group's flat block for this zone -> slot.
function expectedForBand(stageId, ordinal, x, y, slot) {
  const key = String(stageId).replace(/^s/, "");
  const stage = STAGE.stages[key];
  const zone = zoneOf(stageId, x, y);
  const sel = stage.selector;
  const bands = sel.groups;
  let band = bands.length - 1;
  for (let i = 0; i < sel.thresholds.length; i++)
    if (ordinal < sel.thresholds[i]) { band = bands[i]; break; }
  const blocks = stage.groups[band].blocks;
  const flat = zone ? blocks[zone - 1] : null;
  const screen = flat != null ? stage.zones[flat].slots[slot] : 0;
  const party = screen ? FIELD.screens[String(screen)] : null;
  return { zone, band, screen: screen || 0, enemy: party?.[0]?.name ?? null };
}

const browser = await chromium.launch();
const errors = [];

async function rollAtOrdinal(ordinal) {
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
  await page.goto(`${ROOT}/?skipTitle=1&map=s335`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(900);

  // Seed the story point (a prerequisite, read by the stage's own selector
  // code) and pin the roll. Then walk: the production loop does the rest.
  await page.evaluate(([ord, r]) => {
    window.__state.progressOrdinal = ord;
    Math.random = () => r;
    window.__state._encCounter = 1;
    window.__state._encTick = 0;
  }, [ordinal, PINNED_RANDOM]);
  const level = await page.evaluate(() =>
    window.__battle.encounterRateLevel("s335", window.__state.x, window.__state.y));
  const pos = await page.evaluate(() => ({ x: window.__state.x, y: window.__state.y }));
  await page.keyboard.down("ArrowLeft");
  await page.waitForFunction(() => window.__battle.isActive(), null, { timeout: 5000 });
  await page.keyboard.up("ArrowLeft");
  await page.screenshot({ path: `${OUT}/ordinal-${ordinal}.png` });
  const pk = await page.evaluate(() => window.__battle.peek());
  await context.close();
  return { pos, level, enemy: pk.enemy?.name ?? null };
}

const low = await rollAtOrdinal(10);
const high = await rollAtOrdinal(24);
const wantLow = expectedForBand("s335", 10, low.pos.x, low.pos.y, SLOT);
const wantHigh = expectedForBand("s335", 24, high.pos.x, high.pos.y, SLOT);

assert.ok([1, 2].includes(wantLow.zone), `s335 spawn zone ${wantLow.zone}`);
assert.equal(wantLow.band, 0, "ordinal 10 is band 0");
assert.equal(wantHigh.band, 2, "ordinal 24 is band 2");
assert.equal(wantLow.enemy, "Kunemon");
assert.equal(wantHigh.enemy, "Kuwagamon2");
assert.equal(low.level, 3, "s335 zone 1 rate level is 3 in both bands");
assert.equal(high.level, 3, "the switch is the POOL, not the cadence");
assert.equal(low.enemy, wantLow.enemy,
  `ordinal 10 (band 0) must roll ${wantLow.enemy}, got ${low.enemy}`);
assert.equal(high.enemy, wantHigh.enemy,
  `ordinal 24 (band 2) must roll ${wantHigh.enemy}, got ${high.enemy}`);
assert.notEqual(low.enemy, high.enemy, "the two story bands must not roll the same monster");

await browser.close();
assert.deepEqual(errors, [], "no page errors");
console.log(`story switch OK — s335 zone ${wantLow.zone} slot ${SLOT}: ` +
  `ordinal 10 (band 0) -> screen ${wantLow.screen} ${low.enemy}; ` +
  `ordinal 24 (band 2) -> screen ${wantHigh.screen} ${high.enemy}; rate level 3 both`);
