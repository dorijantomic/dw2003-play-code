// The places system: a stage's exits re-aim per the place you entered from.
//
// Ledger: places-copy-place-points-family-2026-10-10, places-update-stage-variants-2026-10-10,
// places-game-place-producers-2026-10-10, places-start-stage-family-2026-10-10. The port is
// engine/systems/place-points.ts; the tables are tools/extract_stage_place_points.py ->
// web/assets/data/stage_place_points.json, and the runtime half is applyPlacePoints in
// web/game.js, which this file drives through the same helper the page calls.
//
// FAIL-BEFORE: on the master baseline the scene rows are the default chain's coordinates
// and there is no placePoints data at all, so every "entered from place N" assertion here
// fails; and engine/systems/place-points.ts does not exist to import.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  copyPlacePoints, aimPlacePoints, placePointPair,
} from "../engine/systems/place-points.ts";
import { routePairCommit } from "../engine/systems/route-pair.ts";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const TABLES = read("web/assets/data/stage_place_points.json").stages;
const SECTIONS = read("web/assets/data/maze_sections.json").stages;
const CAPTURE = read("web/assets/data/maze_exits.json").stages;
const STEPS = read("web/assets/data/story_steps.json").stages;
const GRIDS = read("web/assets/data/story_trigger_grids.json").stages;
const scene = (s) => read(`web/assets/scenes/s${s}.json`);

// The host's own resolution step, mirrored from applyPlacePoints (web/game.js): the
// baked base stage, with the ordinal-aware router left out (no screen in these tables
// has a shadow record that changes the destination at ordinal 0, the state these
// assertions run in).
const aim = (s, place, placeArg) => {
  const sc = scene(s);
  return aimPlacePoints(sc.exits, sc.placePoints, place, placeArg,
    (p) => (p.to ? { to: p.to, dir: p.dirName ?? "down" } : null));
};
const rowFor = (rows, slot) => rows.find((r) => r.slot === slot);

test("the copy matches BOTH halves of the pair and nothing else", () => {
  const table = {
    entries: [
      { place: 4, placeArg: 1, points: [{ screen: 572, x: 160, y: 1000, dir: 0, place: 0, placeArg: 0 }] },
      { place: 0, placeArg: 0, points: [{ screen: 587, x: 720, y: 800, dir: 0, place: 0, placeArg: 0 }] },
    ],
  };
  assert.equal(copyPlacePoints(table, 4, 1).length, 1, "an exact match is found");
  assert.equal(copyPlacePoints(table, 4, 2), null, "place alone is not enough");
  assert.equal(copyPlacePoints(table, 5, 1), null, "placeArg alone is not enough");
  assert.equal(copyPlacePoints(table, 0, 0).length, 1, "(0,0) is a real key");
  assert.equal(copyPlacePoints(table, 99, 99), null, "no match returns null — no fallback");
  assert.equal(copyPlacePoints(undefined, 4, 1), null);
});

test("wstag835's chains are the audit's measured landing points", () => {
  // The 2026-10-13 field-script audit's measurement: "wstag835: place 4 ->
  // (160,1000)/(224,288) vs default (720,800)/(160,336)". And place 7 ->
  // (1056,488)/(176,376).
  const four = copyPlacePoints(TABLES["835"], 4, 1);
  assert.deepEqual(four.map((p) => [p.screen, p.x, p.y, p.dir]),
    [[572, 160, 1000, 0], [741, 224, 288, 5]]);
  const seven = copyPlacePoints(TABLES["835"], 7, 1);
  assert.deepEqual(seven.map((p) => [p.screen, p.x, p.y, p.dir]),
    [[574, 1056, 488, 0], [736, 176, 376, 5]]);
  const def = copyPlacePoints(TABLES["835"], 0, 0);
  assert.deepEqual(def.map((p) => [p.screen, p.x, p.y, p.dir]),
    [[587, 720, 800, 0], [742, 160, 336, 5]], "the (0,0) default is the shipped default");
});

test("a stage entered from place N aims its exits at the N-chain", () => {
  // Entering wstag835 from place 4: slot 0 leads to s490 at (160,1000) facing
  // "down" and publishes (0,0) — a hole out; slot 1 leads to s850 at (224,288)
  // facing "up" and publishes (4,1) — the same section pair, carried on.
  const rows = aim("835", 4, 1);
  const r0 = rowFor(rows, 0);
  const r1 = rowFor(rows, 1);
  assert.deepEqual(
    { to: r0.to, x: r0.spawnX, y: r0.spawnY, dir: r0.dir, aimed: r0.aimed },
    { to: "s490", x: 160, y: 1000, dir: "down", aimed: true });
  assert.deepEqual(
    { to: r1.to, x: r1.spawnX, y: r1.spawnY, dir: r1.dir, aimed: r1.aimed },
    { to: "s850", x: 224, y: 288, dir: "up", aimed: true });
  // The base rows are pristine: the aim returned a new array.
  const base = scene("835").exits;
  assert.ok(base.every((r) => !r.aimed), "the shipped rows were not mutated");
  assert.equal(base[0].to, "s835", "the shipped row is still the static placeholder");
  // place 7 lands where the audit measured, and place 5 stays on the default
  // exit but re-publishes its own section pair.
  const seven = aim("835", 7, 1);
  assert.deepEqual([rowFor(seven, 0).to, rowFor(seven, 0).spawnX, rowFor(seven, 0).spawnY],
    ["s500", 1056, 488]);
  assert.deepEqual([rowFor(seven, 1).to, rowFor(seven, 1).spawnX, rowFor(seven, 1).spawnY],
    ["s825", 176, 376]);
});

test("an unmatched pair leaves the static slots standing", () => {
  // The disc's copyPlacePoints returns WITHOUT copying when no entry matches —
  // the slots keep their static records, which for the maze stages are self-warps.
  const rows = aim("835", 99, 99);
  assert.ok(rows.every((r) => !r.aimed), "nothing was aimed");
  const r0 = rowFor(rows, 0);
  assert.deepEqual({ to: r0.to, x: r0.spawnX, y: r0.spawnY, selfWarp: r0.selfWarp },
    { to: "s835", x: 176, y: 328, selfWarp: true });
});

test("the taken slot publishes its own pair — zeros included", () => {
  // The SLOT_EXIT arm's two stores have no zero test, so a hole publishes (0,0),
  // a real clear. placePointPair is the port; the aimed row's routeWords is what
  // the existing route-pair commit then publishes.
  for (const stage of Object.keys(TABLES)) {
    for (const entry of TABLES[stage].entries) {
      for (const p of entry.points) {
        assert.deepEqual(placePointPair(p), { key: p.place, companion: p.placeArg });
      }
    }
  }
  const rows = aim("835", 4, 1);
  assert.deepEqual(routePairCommit({ routeWords: rowFor(rows, 0).routeWords }),
    { key: 0, companion: 0 }, "a hole clears the pair");
  assert.deepEqual(routePairCommit({ routeWords: rowFor(rows, 1).routeWords }),
    { key: 4, companion: 1 }, "the section pair is carried on");
});

test("every places scene ships one slotted row per op-1 step", () => {
  for (const stage of Object.keys(TABLES)) {
    const sc = scene(stage);
    const prog = (STEPS[stage] ?? {}).steps ?? [];
    const grid = GRIDS[stage];
    const wedges = new Set();
    if (grid && grid.grid) {
      for (const b of grid.grid) if (b) wedges.add(b & 0x1f);
    }
    const want = prog
      .map((st, i) => (st.op === 1 && wedges.has(i) ? i : null))
      .filter((i) => i !== null);
    const rows = (sc.exits ?? []).filter((e) => "warp" in e);
    assert.deepEqual(rows.map((r) => r.slot), want,
      `${stage}: one row per op-1 step, in step order`);
    assert.ok(sc.placePoints, `${stage} carries the table`);
    assert.equal(sc.placePoints.entries.length, TABLES[stage].entries.length);
  }
});

test("the tables agree with the maze section graph read the other way", () => {
  // maze_sections.json (tools/extract_maze_exits.py) is the same disc records
  // walked from the chain head backward; the copy order is the reverse, and the
  // scene's baked points carry the same destinations and facings.
  for (const stage of Object.keys(TABLES)) {
    const graph = Object.fromEntries(
      (SECTIONS[stage] ?? []).map((s) => [`${s.key}:${s.companion}`, s]));
    for (const entry of TABLES[stage].entries) {
      if (entry.place === 0 && entry.placeArg === 0) continue;
      const sec = graph[`${entry.place}:${entry.placeArg}`];
      assert.ok(sec, `${stage} (${entry.place},${entry.placeArg}) is a section`);
      assert.deepEqual(
        entry.points.map((p) => [p.screen, p.x, p.y, p.dir]),
        [...sec.exits].reverse().map((e) => [e.screen, e.x, e.y, e.dir]),
        `${stage} (${entry.place},${entry.placeArg}): copy order is the reversed chain`);
      const baked = scene(stage).placePoints.entries
        .find((e) => e.place === entry.place && e.placeArg === entry.placeArg);
      assert.deepEqual(baked.points.map((p) => p.screen),
        entry.points.map((p) => p.screen), `${stage}: baked screens match`);
    }
  }
});

test("the rig capture reproduces through the aimed default chain", () => {
  // maze_exits.json is the live capture of the 12 stages the rig entered. With a
  // (0,0) default present that is the chain the arrival published, so aiming the
  // scene with (0,0) must reproduce the capture row for row.
  for (const stage of Object.keys(CAPTURE)) {
    const rows = aim(stage, 0, 0);
    const aimed = rows.filter((r) => r.aimed);
    const got = aimed.map((r) => [r.to, r.spawnX, r.spawnY, r.dir]);
    const dirName = (d) => (typeof d === "string" ? d
      : ({ 1: "down", 3: "left", 5: "up", 7: "right" }[d] ?? "down"));
    const want = CAPTURE[stage].map((e) => [e.to, e.spawnX, e.spawnY, dirName(e.dir)]);
    assert.deepEqual(got, want, `${stage}: the aimed (0,0) chain is the capture`);
  }
});

test("the updateStage variant census is the claim's", () => {
  // places-update-stage-variants-2026-10-10: 25 copy-first, 7 next-first
  // (825, 835, 840, 845, 850, 855, 860), 2 tile-anims-first (635, 640).
  const byVariant = {};
  for (const [stage, t] of Object.entries(TABLES)) {
    (byVariant[t.variant] ??= []).push(stage);
  }
  assert.equal(byVariant["copy-first"].length, 25);
  assert.deepEqual(byVariant["next-first"].sort(), ["825", "835", "840", "845", "850", "855", "860"]);
  assert.deepEqual(byVariant["tile-anims-first"].sort(), ["635", "640"]);
  assert.equal(Object.keys(TABLES).length, 34);
});
