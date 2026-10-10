// The route pair, driven on the real page: a warp that reaches a writer site publishes
// that step record's own two numbers, and a warp that reaches none leaves both alone.
//
// Item-store gap 6 asked for a "once per newly obtained item" marker and its sparkle.
// The disc has neither: the two halfwords at [D0x80048D34+0x44] / [+0x46] are the route
// pair, written only by the playback executor's op 1 and by the op-9/10 dive launcher,
// both from the step record's own params[5] / params[6], and read only through bank 0x7E
// (engine/systems/route-pair.ts carries the decode; docs/research/items/
// item-store-shared-system-2026-10-03.md § 5 is the correction).
//
// So this drives the two shapes a player actually walks into:
//
//   1. s205's op-10 dive (record params[5]=2, params[6]=1): stand on the tile, press
//      Circle, and the dive lands with the pair (2,1) — the bank-0x7E gate that asks
//      for route 2 answers 1 afterwards and answered 0 before.
//   2. s260's plain warp: that stage ships NO step program, so the disc has no writer
//      there. Standing on its door with the pair already (7,3), the warp to s275 must
//      leave (7,3) standing.
//
// Before this change both cases ended at (0,0): web/game.js wrote a zero of its own on
// every warp. The old code's answer is reproducible by serving this worktree's web/ with
// `git show HEAD:web/game.js` in place of game.js.
//
// Run via:  VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_route_pair_commit.mjs
//
// Ledger: encounter-zone-group-key-written-on-map-transition,
//         encounter-zone-group-key-record-is-type7-step-record,
//         encounter-companion-scalar-is-second-route-coordinate,
//         route-pair-published-only-by-publishing-step-2026-10-03,
//         item-store-gap6-new-item-marker-refuted-2026-10-03.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = baseUrl(8923);

const STEPS = JSON.parse(readFileSync("web/assets/data/story_steps.json", "utf8")).stages;
const GRIDS = JSON.parse(readFileSync("web/assets/data/story_trigger_grids.json", "utf8")).stages;

/** The s205 dive tile: the first op-9/10 record on s205 that names a non-zero pair. */
function diveCase() {
  const stage = "205";
  const grid = GRIDS[stage];
  const program = STEPS[stage].steps;
  for (let r = 0; r < grid.h; r++) {
    for (let c = 0; c < grid.w; c++) {
      const cell = grid.grid[r * grid.w + c] | 0;
      if (!cell) continue;
      const record = program[cell & 0x1f];
      if (!record || (record.op !== 9 && record.op !== 10)) continue;
      const params = record.params ?? [];
      if (!(params[5] || params[6])) continue;
      return {
        stage, op: record.op, key: params[5] | 0, companion: params[6] | 0,
        x: c * grid.cell + 4, y: r * grid.cell + 4,
      };
    }
  }
  return null;
}

const dive = diveCase();
if (!dive) { console.error("no keyed dive in the shipped data"); process.exit(1); }

// s260 is the one shipped stage with exits and no step program at all: its single door
// reaches no writer site, so the pair must survive the warp.
const s260 = JSON.parse(readFileSync("web/assets/scenes/s260.json", "utf8"));
const plain = s260.exits[0];
const plainCase = {
  stage: "260", to: plain.to,
  x: plain.x + Math.floor(plain.w / 2), y: plain.y + Math.floor(plain.h / 2),
  start: [7, 3],
};
const CLEARED = [0, 0];

console.log(`case 1: s${dive.stage} op ${dive.op} dive at (${dive.x},${dive.y}) — the record's own` +
  ` params[5]=${dive.key} params[6]=${dive.companion}`);
console.log(`case 2: s${plainCase.stage} -> ${plainCase.to} at (${plainCase.x},${plainCase.y}) —` +
  ` no step program, so no writer site; the pair (${plainCase.start}) must survive`);

const browser = await chromium.launch();
const errors = [];

/** Open the page on `stage`, seed the pair, stand on (x,y) and press the button. */
async function drive(stage, pair, x, y) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`${stage}: ${String(e).slice(0, 120)}`));
  await page.goto(`${BASE}/index.html?skipTitle=1&skipLanguage=1&map=s${stage}`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__engineTriggerSystem && window.__state.x > 0,
    null, { timeout: 90_000 });
  await page.evaluate(([p, px, py]) => {
    window.__state.progressOrdinal = 20;
    window.__state.entryKey = p[0];
    window.__state.entryCompanion = p[1];
    window.__state.x = px;
    window.__state.y = py;
    window.__state.dir = "down";
    window.__state.moving = false;
  }, [pair, x, y]);
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => ({
    map: window.__state.manifest?.maps?.[window.__state.mapIdx]?.id ?? null,
    pair: [window.__state.entryKey ?? 0, window.__state.entryCompanion ?? 0],
    gate: window.__storyFlags.get(0x7e00 | (window.__state.entryKey - 1)),
  }));
  await page.keyboard.press("Enter");
  let after = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(400);
    after = await page.evaluate(() => ({
      map: window.__state.manifest?.maps?.[window.__state.mapIdx]?.id ?? null,
      pair: [window.__state.entryKey ?? 0, window.__state.entryCompanion ?? 0],
    }));
    if (after.map !== `s${before.map.slice(1)}` && after.map !== before.map) break;
    if (after.pair[0] !== before.pair[0] || after.pair[1] !== before.pair[1]) break;
  }
  await page.waitForTimeout(600);
  const gates = await page.evaluate(() => {
    const id = (i) => 0x7e00 | i;
    return {
      keyGate: window.__storyFlags.get(id((window.__state.entryKey | 0) - 1)),
      companionGate: window.__storyFlags.get(id(0x1e + (window.__state.entryCompanion | 0) - 1)),
      raw: [0x7e01, 0x7e1e, 0x7e00, 0x7e1f].map((i) => `${i.toString(16)}=${window.__storyFlags.get(i)}`),
      pair: [window.__state.entryKey, window.__state.entryCompanion],
    };
  });
  await page.close();
  return { before, after, gates };
}

const dived = await drive(dive.stage, CLEARED, dive.x, dive.y);
const plainRan = await drive(plainCase.stage, plainCase.start, plainCase.x, plainCase.y);

const fail = [];
const ok = (cond, why) => { if (!cond) fail.push(why); };

console.log("\ns205's dive:");
console.log(`  standing on the tile, the pair was ${dived.before.pair.join(",")}` +
  ` and the key gate answered ${dived.before.gate}`);
console.log(`  after the warp the page is on ${dived.after.map} with the pair ` +
  `${dived.after.pair.join(",")}; its gates answer key=${dived.gates.keyGate} companion=${dived.gates.companionGate}` +
  ` [${dived.gates.raw.join(" ")} pair=${dived.gates.pair.join(",")}]`);
ok(dived.after.map !== `s${dive.stage}`, `the dive did not run (still on ${dived.after.map})`);
ok(dived.after.pair[0] === dive.key && dived.after.pair[1] === dive.companion,
  `the dive published ${dived.after.pair.join(",")}, the record names ${dive.key},${dive.companion}`);
ok(dived.gates.keyGate === 1, "the bank-0x7E key gate for this route did not answer 1");
ok(dived.gates.companionGate === 1, "the bank-0x7E companion gate for this route did not answer 1");

console.log("\ns260's plain warp:");
console.log(`  the pair stood at ${plainRan.before.pair.join(",")} on ${plainRan.before.map}`);
console.log(`  after the warp the page is on ${plainRan.after.map} with the pair ` +
  `${plainRan.after.pair.join(",")}`);
ok(plainRan.after.map === plainCase.to, `the door did not run (on ${plainRan.after.map})`);
ok(plainRan.after.pair[0] === plainCase.start[0] && plainRan.after.pair[1] === plainCase.start[1],
  `the pair was ${plainRan.after.pair.join(",")} after a warp that reaches no writer site`);

if (errors.length) fail.push(`page errors: ${errors[0]}`);
await browser.close();

if (fail.length) {
  console.error("\nFAIL:");
  for (const f of fail) console.error("  " + f);
  process.exit(1);
}
console.log("\nOK: a warp that runs a step record publishes that record's own two numbers, and a");
console.log("    warp that runs none leaves both halves exactly as the last writer left them.");