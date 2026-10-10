// The route pair, published by the step the player pressed — on the real page.
//
// `verify_entry_key.mjs` sets `state.entryKey` by hand to show the encounter selector
// reacting. This one shows where the number COMES FROM: the walker's own trigger system
// answers a live step tile, and the pair it reports is the step record's own params[5] /
// params[6] — the two fields the disc's two writer sites read.
//
// It also shows the two halves of the gate agreeing: the pair the step publishes is
// exactly the pair a bank-0x7E NPC predicate on the destination screen asks for.
//
// Run via:  VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_route_pair_publish.mjs
//
// Ledger: encounter-zone-group-key-written-on-map-transition,
//         encounter-zone-group-key-record-is-type7-step-record,
//         encounter-companion-scalar-is-second-route-coordinate.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { readFileSync } from "node:fs";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".ogg": "audio/ogg",
  ".wav": "audio/wav", ".css": "text/css", ".bin": "application/octet-stream",
};

const PORT = Number(process.env.VERIFY_PORT || 8947);
const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const path = join(process.cwd(), "web", rel === "/" ? "index.html" : rel);
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(PORT, r));
const base = `http://127.0.0.1:${PORT}`;

// The offline facts this checks the page against, read from the shipped data.
const STEPS = JSON.parse(readFileSync("web/assets/data/story_steps.json", "utf8")).stages;
const GRIDS = JSON.parse(readFileSync("web/assets/data/story_trigger_grids.json", "utf8")).stages;
const NPCS = JSON.parse(readFileSync("web/assets/data/npc_flag_sets.json", "utf8")).flag_sets;

/** A stage with a keyed op-1/9/10 step, the cell that names it, and its own pair. */
let found = null;
function pickCase() {
  for (const stage of Object.keys(STEPS)) {
    const grid = GRIDS[stage];
    if (!grid) continue;
    const prog = STEPS[stage];
    for (let i = 0; i < prog.steps.length; i++) {
      const rec = prog.steps[i];
      if (![1, 9, 10].includes(rec.op)) continue;
      const key = rec.params[5] | 0;
      const companion = rec.params[6] | 0;
      if (!key && !companion) continue;
      for (let r = 0; r < grid.h; r++) {
        for (let c = 0; c < grid.w; c++) {
          const b = grid.grid[r * grid.w + c] | 0;
          if (b === 0 || (b & 0x1f) !== i) continue;
          const here = {
            stage, step: i, op: rec.op, key, companion, group: b >> 5,
            x: c * grid.cell + 4, y: r * grid.cell + 4,
            condA: rec.cond_a, argA: rec.arg_a, condB: rec.cond_b, argB: rec.arg_b,
          };
          if (gatesFor(stage, key, companion).length) return here;   // a stage whose cast is gated on it
          if (!found) found = here;
        }
      }
    }
  }
  return found;
}

/**
 * The NPC dialogues gated on exactly this pair, anywhere in the game, with the two flag
 * ids they ask with. A pair published by one surface entrance is what the underground
 * screens on the far side gate their cast on, so the stage need not be the same one.
 */
function gatesFor(_stage, key, companion) {
  const out = [];
  for (const row of NPCS) {
    for (const [id, expected] of row.gate ?? []) {
      if (((id >> 8) & 0xfe) !== 0x7e || expected !== 1) continue;
      const index = id & 0x1ff;
      const want = index < 0x1e ? key : companion;
      const got = index < 0x1e ? index + 1 : index - 0x1d;
      if (want === got) out.push({ id, index, stage: row.stage, side: index < 0x1e ? "key" : "companion" });
    }
  }
  return out;
}

const c = pickCase();
if (!c) { console.error("no keyed op-1/9/10 step in the shipped data"); process.exit(1); }
const gates = gatesFor(c.stage, c.key, c.companion);
console.log(`case: s${c.stage} step ${c.step} op ${c.op} at (${c.x},${c.y}) group ${c.group}`);
console.log(`  the record's own two fields: params[5]=${c.key} params[6]=${c.companion}`);
console.log(`  bank-0x7E NPC gates this pair satisfies anywhere in the game: ${gates.length}` +
  (gates.length ? ` (${gates.slice(0, 4).map((g) => `${g.side} 0x${g.id.toString(16)} on s${g.stage}`).join(", ")}${gates.length > 4 ? ", ..." : ""})` : ""));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/index.html?skipTitle=1&skipLanguage=1&map=s${c.stage}`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
await page.waitForFunction(
  (m) => window.__engineTriggerSystem && window.__state.x > 0,
  c.stage, { timeout: 60_000 });
await page.waitForTimeout(800);

// Put the player ON the tile and let the game's own tick arm it. The step's gate is a
// progress-ordinal range (the s205 dive asks for ordinal >= 15), so raise the story step
// the way a save that has got that far would carry it, then stand on the tile and press
// Circle. Nothing else about the step is touched.
await page.evaluate((c) => {
  window.__state.progressOrdinal = 20;
  window.__state.x = c.x;
  window.__state.y = c.y;
  window.__state.dir = "down";
  window.__state.moving = false;
}, c);
await page.waitForTimeout(1200);

const armed = await page.evaluate((c) => {
  const ts = window.__engineTriggerSystem;
  const out = [];
  for (let f = 0; f < 8; f++) {
    const pb = ts.playback(c.stage, c.x, c.y, f, true);
    out.push({ f, live: pb?.live ?? false, op: pb?.op ?? null, routeWords: pb?.routeWords ?? null });
    if (pb?.live) break;
  }
  return out;
}, c);

const press = async () => {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
};
await press();
// The dive runs its own presentation and hands the stage change to the far end.
for (let i = 0; i < 30; i++) {
  const done = await page.evaluate(() => window.__state.entryKey !== 0 || window.__state.entryCompanion !== 0);
  if (done) break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1500);

const probe = await page.evaluate((c) => {
  const published = (c.armed ?? []).find((t) => t.routeWords)?.routeWords ?? null;
  // Latch what the step published, the way the warp's commit does, and then ask the
  // bank-0x7E gates through the walker's own adapter. (`verify_entry_key.mjs` latches
  // state.entryKey the same way for the encounter side.)
  if (published) {
    window.__state.entryKey = published.d78;
    window.__state.entryCompanion = published.d7a;
  }
  const answers = published
    ? [...new Set(c.gateIds)].map((id) => ({ id, v: window.__storyFlags.get(id) }))
    : [];
  return {
    published,
    answers,
    latched: [window.__state.entryKey ?? 0, window.__state.entryCompanion ?? 0],
    mapNow: (window.__state.manifest?.maps?.[window.__state.mapIdx]?.id ?? null),
    x: window.__state.x, y: window.__state.y,
  };
}, { ...c, gateIds: gates.map((g) => g.id), armed });
probe.armed = armed;


server.close();
await browser.close();

console.log("the walker's own playback() on that tile:");
for (const t of probe.armed) {
  console.log(`  facing ${t.f} live=${t.live} op=${t.op}` +
    (t.routeWords ? `  ->  publishes d78=${t.routeWords.d78} d7a=${t.routeWords.d7a}` : ""));
}
console.log("the pair it published:", JSON.stringify(probe.published));
console.log("the bank-0x7E gates answer with that pair:",
  probe.answers.map((a) => `0x${a.id.toString(16)}=${a.v}`).join(" ") || "(none)");
if (errors.length) console.log("page errors:", errors.slice(0, 3));

console.log("the page is on", JSON.stringify({ map: probe.mapNow, x: probe.x, y: probe.y }));
console.log("(the pair now standing in state.entryKey / entryCompanion is " +
  `${probe.latched[0]},${probe.latched[1]} — latched here rather than by a driven warp, so the\n  check below is about the gates, not about the walk animation.)`);
const fail = [];
if (!probe.published) fail.push("the walker's playback() published no route pair on a keyed step");
else if (probe.published.d78 !== c.key || probe.published.d7a !== c.companion) {
  fail.push(`published ${JSON.stringify(probe.published)}, the record's own fields are ` +
    `{d78:${c.key},d7a:${c.companion}}`);
}
if (probe.answers.some((a) => a.v !== 1)) {
  fail.push(`a bank-0x7E gate on this pair did not answer 1: ${JSON.stringify(probe.answers)}`);
}
if (errors.length) fail.push(`page errors: ${errors[0]}`);

if (fail.length) {
  console.error("\nFAIL:");
  for (const f of fail) console.error("  " + f);
  process.exit(1);
}
console.log("\nOK: on the real page the armed step publishes the record's own two fields, and");
console.log("    every bank-0x7E gate in the game that asks for that pair answers 1 with them.");
