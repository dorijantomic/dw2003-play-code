// The refused MAP row. F0x8001270c.c:177 plays the packed CONFIRM SFX and only
// then tests `(unk64 != 0) || (unk58 != 2)`, so a MAP the game will not open
// still clicks like every other row -- it simply does nothing. The walker used
// to play the CANCEL sound instead.
//
// menu.js reads its geometry from status_ui.json through `fetch` at import
// time, so this file serves the real file from disk and imports the module
// dynamically afterwards.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

globalThis.fetch = async (url) => ({
  json: async () => JSON.parse(readFileSync(`web/${String(url)}`, "utf8")),
});
if (typeof globalThis.localStorage === "undefined") {
  const mem = Object.create(null);
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const { createMenu, mapUnavailable } = await import("../web/menu.js");
await new Promise((r) => setTimeout(r, 50)); // let the two layout fetches land

test("a refused MAP plays the confirm sound and opens nothing", () => {
  const late = { mapIdx: 0, manifest: { maps: [{ id: "s800" }] },
    inventory: [], party: [], keys: new Set() };
  assert.equal(mapUnavailable(late), true, "the late stage really is gated");

  const played = [];
  const m = createMenu({ play: (n) => played.push(n) });
  m.reset();
  m.handleKey("down", late);
  m.handleKey("down", late);            // cursor onto MAP -- it may still land there
  played.length = 0;
  m.handleKey("circle", late);
  assert.equal(m.screen, "home", "the row does not open the map");
  assert.ok(played.includes("system00"), "the confirm sound still plays");
  assert.ok(!played.includes("system01"), "and it is not the cancel sound");
});

test("an available MAP opens on the same confirm sound", () => {
  const early = { mapIdx: 0, manifest: { maps: [{ id: "s200" }] },
    inventory: [], party: [], keys: new Set() };
  assert.equal(mapUnavailable(early), false);
  const played = [];
  const m = createMenu({ play: (n) => played.push(n) });
  m.reset();
  m.handleKey("down", early);
  m.handleKey("down", early);
  played.length = 0;
  m.handleKey("circle", early);
  assert.equal(m.screen, "map");
  assert.ok(played.includes("system00"));
});
