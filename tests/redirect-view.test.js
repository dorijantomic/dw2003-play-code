// Counter redirects: the fifteen npc ids where the confirm press is a lie. You
// stand on a spriteless position marker and the game's own remap table
// (0x80097C68, engine/dw3/npc-confirm-redirects.ts) swaps it for the character
// behind the counter before the interact arms run. This test pins the table's
// numbers to the engine, the map census to the 294 shipped scene files, and the
// page/switch wiring to the F2 panel.
//
// F2 -> Extras -> "Counter redirects (new)" (off by default). With the switch
// off there is no row to click and no page to open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  redirectRows,
  scanScenes,
  redirectReport,
  redirectFor,
  pairsOnMap,
  reportMaps,
  NPC_CONFIRM_REDIRECT_TABLE_RAM,
} from "../web/redirect-view.js";
import {
  confirmRedirectPairs,
  confirmRedirectId,
  NPC_CONFIRM_REDIRECT_TABLE_RAM as ENGINE_TABLE_RAM,
} from "../web/vendor/engine.js";

const readText = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const readJson = (p) => JSON.parse(readText(p));

// The 294 rooms the game ships, keyed by map id — the same reading the page does.
function readScenes() {
  const dir = new URL("../web/assets/scenes/", import.meta.url);
  const scenes = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    scenes.set(file.slice(0, -5), JSON.parse(readFileSync(new URL(file, dir), "utf8")));
  }
  return scenes;
}
const scenes = readScenes();
const pairs = confirmRedirectPairs();
const report = redirectReport(pairs, scenes);
const rowOf = (from, to) => report.find((r) => r.from === from && r.to === to);
const mapsOf = (from, to) => (rowOf(from, to)?.maps || []).map((m) => m.map);

test("the table is the engine's own fifteen pairs at 0x80097C68", () => {
  assert.equal(confirmRedirectPairs().length, 15);
  assert.equal(confirmRedirectId(112), 32);
  assert.equal(confirmRedirectId(999), null);
  assert.equal(confirmRedirectId(null), null);
  assert.equal(NPC_CONFIRM_REDIRECT_TABLE_RAM, 0x80097c68);
  assert.equal(NPC_CONFIRM_REDIRECT_TABLE_RAM, ENGINE_TABLE_RAM);

  // The page's row list is the table itself, in table order, not a copy.
  assert.deepEqual(redirectRows(pairs), pairs.map(([from, to]) => ({ from, to })));
  assert.equal(redirectRows(pairs).length, 15);
});

test("scanScenes counts the 294 rooms and their 330 distinct npc ids", () => {
  assert.deepEqual(scanScenes(scenes), { maps: 294, ids: 330 });
});

test("every pair stands in at least one room's cast, and 28 rooms carry one", () => {
  assert.equal(report.length, 15);
  for (const row of report) {
    assert.ok(row.maps.length >= 1, `${row.from} -> ${row.to} stands in a room`);
  }
  const carries = reportMaps(report);
  assert.equal(carries.length, 28);
  assert.deepEqual(carries, [...carries].sort(), "the map list is sorted");
  assert.deepEqual(new Set(carries), new Set(report.flatMap((r) => r.maps.map((m) => m.map))));
});

test("the four-lobby rooms carry four pairs each, s271 carries three", () => {
  for (const map of ["s210", "s211", "s220", "s221"]) {
    const here = report.filter((r) => mapsOf(r.from, r.to).includes(map)).map((r) => [r.from, r.to]);
    assert.equal(here.length, 4, `${map} carries four pairs`);
  }
  assert.deepEqual(
    report.filter((r) => mapsOf(r.from, r.to).includes("s271")).map((r) => [r.from, r.to]),
    [[220, 206], [256, 52], [270, 157]],
  );
  assert.deepEqual(mapsOf(220, 206).includes("s271") ? [[220, 206]] : [], [[220, 206]]);
  assert.deepEqual(
    report.filter((r) => mapsOf(r.from, r.to).includes("s295")).map((r) => [r.from, r.to]),
    [[288, 12]],
  );
  assert.deepEqual(
    report.filter((r) => mapsOf(r.from, r.to).includes("s380")).map((r) => [r.from, r.to]),
    [[284, 75]],
  );
});

test("on s210 the marker is spriteless at (360,268) and the clerk is (384,255) p157opft", () => {
  const hit = rowOf(112, 32).maps.find((m) => m.map === "s210");
  assert.ok(hit, "112 -> 32 stands in s210");
  assert.deepEqual(hit.marker, { x: 360, y: 268 });
  assert.equal(hit.marker.sprite, undefined);
  assert.equal("sprite" in hit.marker, false, "the marker record carries no sprite key");
  assert.deepEqual(hit.target, { x: 384, y: 255, sprite: "p157opft" });
});

test("every redirect's marker is spriteless and every target has a sprite", () => {
  // The source fact over the real fifteen, and over a fixture too, so the rule
  // is pinned to the records and not accidentally to one lucky room.
  for (const row of report) {
    for (const m of row.maps) {
      assert.equal("sprite" in m.marker, false, `${row.from} marker in ${m.map} has no sprite`);
      assert.equal(typeof m.target.sprite, "string", `${row.to} in ${m.map} has a sprite`);
      assert.ok(m.target.sprite.length > 0);
    }
  }
  const fixture = new Map([
    ["sA", {
      npcs: [
        { npc_id: 112, x: 10, y: 20 },                    // the marker, first record
        { npc_id: 112, x: 99, y: 99 },                    // a second copy: never shown
        { npc_id: 32, x: 30, y: 40, sprite: "pClerk" },   // the clerk, first record
        { npc_id: 32, x: 31, y: 41, sprite: "pClerk" },   // a second copy: never shown
      ],
    }],
    ["sB", { npcs: [{ npc_id: 112, x: 1, y: 2 }] }],      // marker only: not a pair room
  ]);
  const one = redirectReport([[112, 32]], fixture);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].maps, [{
    map: "sA",
    marker: { x: 10, y: 20 },
    target: { x: 30, y: 40, sprite: "pClerk" },
  }], "first record per id per map, and the marker-only room is skipped");
});

test("redirectFor wraps the engine's answer; pairsOnMap lists a room's pairs", () => {
  assert.deepEqual(redirectFor(112), { from: 112, to: 32 });
  assert.equal(redirectFor(999), null);
  assert.equal(redirectFor(null), null);

  assert.deepEqual(pairsOnMap("s271", scenes, pairs), [[220, 206], [256, 52], [270, 157]]);
  assert.deepEqual(pairsOnMap("s295", scenes, pairs), [[288, 12]]);
  assert.deepEqual(pairsOnMap("s200", scenes, pairs), []);
});

test("the module borrows the engine's table and keeps no second copy", () => {
  const src = readText("../web/redirect-view.js");
  assert.match(src, /import\s*\{[^}]*confirmRedirectId[^}]*confirmRedirectPairs[^}]*\}\s*from\s*"\.\/vendor\/engine\.js"/,
    "the engine's own functions");
  assert.doesNotMatch(src, /\bCONFIRM_REDIRECT_PAIRS\b/, "no second pair table");
  assert.doesNotMatch(src, /\[\s*112\s*,\s*32\s*\]/, "no hand-copied pair row");
  assert.doesNotMatch(src, /\[\s*288\s*,\s*12\s*\]/, "no hand-copied pair row");
  assert.doesNotMatch(src, /localStorage|sessionStorage|document\.cookie|fetch\(/, "pure, no store, no fetch");
});

test("the page lists the pairs, chips their rooms and resolves a search id", () => {
  const page = readText("../web/redirect-lab.html");
  const script = page.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(script, "the page's own inline module");
  const code = script[1];

  assert.match(code, /from\s*"\.\/redirect-view\.js"/, "the page renders through the pure module");
  for (const fn of ["redirectRows", "redirectReport", "redirectFor", "scanScenes", "reportMaps"]) {
    assert.match(code, new RegExp(`\\b${fn}\\b`), `the page uses ${fn}`);
  }
  assert.match(page, /id="pairs"/, "the pair list");
  assert.match(page, /id="lookup"/, "the search box");
  assert.match(page, /id="load"/, "the load-all button");
  assert.match(page, /id="progress"/, "the progress line");
  assert.match(page, /assets\/scenes\//, "reads the shipped scene files");
  assert.match(page, /294/, "names the 294 rooms it loads");
  assert.match(code, /press here, you reach/, "the search answer in plain words");
  assert.match(code, /not a marker/, "and what a non-marker id is");

  // The page is a report: it writes nothing anywhere.
  assert.doesNotMatch(page, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(page, /\bmethod:\s*["']POST|\.sendBeacon\(/);
});

test("the F2 switch is off by default and gates the row and the page", () => {
  const ambience = readText("../web/ambience.js");
  assert.match(ambience, /\["redirectview", "Counter redirects \(new\)"\]/, "the F2 Extras row");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.match(experimental[1], /"redirectview"/, "off until the player switches it on");
  assert.match(ambience, /id="fx-redirectview" hidden/, "the button row ships hidden");
  assert.match(ambience, /const redirectview = panel\.querySelector\("#fx-redirectview"\); if \(redirectview\) redirectview\.hidden = !fx\.redirectview;/,
    "refreshPanel follows the switch");
  assert.match(ambience, /if \(fx\.redirectview\)[^;{}]*window\.open\("redirect-lab\.html", "_blank", "noopener"\)/,
    "opened only behind the toggle's guard");
  assert.equal(ambience.split("redirect-lab.html").length - 1, 1, "one reference to the page, no other link into it");
  assert.doesNotMatch(ambience, /(get|has)\("redirectview"\)/, "never a URL flag");
});
