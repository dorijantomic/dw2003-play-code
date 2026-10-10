import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameEngine, createScreenRouter } from "../engine/index.ts";
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
