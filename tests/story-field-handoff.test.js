import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameEngine, createScreenRouter, movieReturnScreen, movieRow } from "../engine/index.ts";
import { MOVIE_DESTINATIONS } from "../engine/dw3/movie-destinations.ts";

const table = JSON.parse(readFileSync("data/screen_table.json", "utf8"));
const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));

test("movie return uses the current story step, then the shared alternate screen table", () => {
  let ordinal = 43;
  const router = createScreenRouter(table, { useAlt: () => ordinal === 45 });
  assert.equal(router.route(0xe03)?.to, "s225");
  ordinal = 45;
  assert.equal(router.route(0xe03)?.to, "s925");
  ordinal = 46;
  assert.equal(router.route(0xe03)?.to, "s225");
  // Independently compare the generated data with the original overlay's
  // destination words. No production code executes the overlay.
  const original = readFileSync("web/assets/native/screens/pro_stdwtitl.bin");
  for (let index = 0; index < 12; index++) {
    const destination = original.readUInt32LE(0x4fe8 + index * 12 + 8);
    assert.equal(MOVIE_DESTINATIONS[index], destination);
    const rec = table[String(destination)];
    if (rec) assert.equal(router.route(0xe01 + index)?.to, `s${rec.stage}`);
  }
  assert.equal(router.route(0xe00), null, "title is not a movie");
  assert.equal(router.route(0xe0d), null, "END card is not a movie");
});

test("field entry writes the visited flag before arrival through the flag store", () => {
  const engine = new GameEngine(content, { screenTable: table });
  const writes = [];
  engine.state.flags.onChange((id, value) => writes.push([id, value]));
  assert.equal(engine.state.flags.get(0x20d7), false);
  engine.state.vars.set("$story.ordinal", 43);
  engine.loadStage("s780");
  assert.equal(engine.state.flags.get(0x20d7), true);
  assert.deepEqual(writes, [[0x20d7, true]]);
  assert.equal(engine.state.vars.get("$story.ordinal"), 43);
  engine.loadStage("s925");
  assert.equal(engine.state.flags.get(0x2076), true);
  assert.deepEqual(writes.at(-1), [0x2076, true]);
  engine.state.flags.set(0x2076, false);
  engine.loadStage("s226");
  assert.equal(engine.state.flags.get(0x2076), true, "base and alternate share a screen id");
  // Check the complete decoded field table, rather than only the reported place.
  for (const [id, rec] of Object.entries(table)) {
    for (const stage of [rec.stage, rec.alt?.stage].filter(n => n != null)) {
      const flag = 0x1e00 + Number(id);
      engine.state.flags.set(flag, false);
      engine.loadStage(`s${stage}`);
      assert.equal(engine.state.flags.get(flag), true, `s${stage}, screen ${id}`);
    }
  }
});

test("the host plays a movie-naming handoff through the shared chain before routing", () => {
  // web/game.js doStoryHandoff: a HANDOFF that names a movie row (the s780
  // reunion's 0xE03 = row 2 = MOVIED01_STR) plays the row chain through the one
  // field movie adapter and then routes the selector the chain ended on; the
  // finale's ending hand-off runs the same playMovieChain.
  const src = readFileSync("web/game.js", "utf8");
  const at = src.indexOf("function doStoryHandoff(");
  assert.ok(at > 0, "doStoryHandoff exists");
  const body = src.slice(at, src.indexOf("function routeStoryHandoff(", at));
  assert.ok(body.includes("movieRow(handoff.screenId) != null"),
    "a movie-naming handoff is recognised");
  assert.ok(body.includes("playMovieChain(handoff.screenId)"),
    "it plays through the shared row chain");
  assert.ok(body.includes("routeStoryHandoff(ev, handoff, selector)"),
    "the selector the chain ends on is what routes");
  const chainAt = src.indexOf("async function playMovieChain");
  assert.ok(chainAt > 0, "the shared chain exists");
  const chain = src.slice(chainAt, src.indexOf("async function playEndingChain", chainAt));
  assert.ok(chain.includes("movieRow(selector)") && chain.includes("fieldMovie.open(selector)"),
    "the chain plays each row through the field movie adapter");
  assert.ok(chain.includes("movieReturnScreen(selector, screenRouterOptions.useAlt())"),
    "each row's return selector is read with the router's own ordinal rule");
  const endingAt = src.indexOf("async function playEndingChain");
  assert.ok(src.slice(endingAt, src.indexOf("battle.setEndingHandoff({", endingAt))
    .includes("await playMovieChain(launchCode)"), "the ending hand-off shares the chain");
  // The row the reunion names is the one the shipped stream covers.
  const row = movieRow(0xe03);
  assert.equal(row.fileIndex, 2026);
  assert.equal(row.frames, 465);
  assert.equal(movieReturnScreen(0xe03, true), 0x276);
});
