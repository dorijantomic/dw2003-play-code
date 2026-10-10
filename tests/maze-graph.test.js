// The wrap-maze exit graph, and the shipped data it runs on.
//
// Ledger: maze-exit-record-table. The graph is extracted statically by
// tools/extract_maze_exits.py and reproduces all 33 runtime-captured maze exits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMazeExit, currentSection, isHole } from "../engine/dw3/maze.ts";

const graph = JSON.parse(readFileSync("web/assets/data/maze_sections.json", "utf8")).stages;
const CIRCUIT = { 744: "865", 745: "870", 746: "875", 747: "880", 748: "885", 749: "890", 750: "895" };
const circuitScreens = new Set(Object.keys(CIRCUIT).map(Number));
const circuitStages = Object.values(CIRCUIT);
const allCircuitExits = circuitStages.flatMap((s) => graph[s].flatMap((sec) => sec.exits));

test("s635 section (1,1) is exactly the table the rig captured", () => {
  // The 2026-07-09 capture entered s635 from s630, whose warp record carries
  // key=1, companion=1 -- so its live table must be this section's exits.
  const sec = currentSection(graph["635"], 1, 1);
  const got = sec.exits.map((e) => [e.screen, e.x, e.y, e.dir]);
  assert.deepEqual(got.sort(), [
    [599, 256, 632, 5],   // up    -> s630
    [601, 288, 256, 7],   // right -> s640
    [601, 848, 760, 3],   // left  -> s640
    [601, 856, 252, 1],   // down  -> s640
  ].sort());
});

test("inside the Circuit Board every move is north or south", () => {
  const inner = allCircuitExits.filter((e) => circuitScreens.has(e.screen));
  assert.equal(inner.length, 534);
  assert.deepEqual([...new Set(inner.map((e) => e.dir))].sort(), [1, 5]);
  assert.ok(inner.every((e) => e.key !== 0), "a move inside the maze keeps a route");
});

test("every exit to the surface is a hole that clears the route pair", () => {
  const out = allCircuitExits.filter((e) => !circuitScreens.has(e.screen));
  assert.equal(out.length, 76);
  assert.ok(out.every(isHole));
});

test("holes exist only on the two screens a surface dive can reach", () => {
  for (const [screen, stage] of Object.entries(CIRCUIT)) {
    const holes = graph[stage].flatMap((s) => s.exits).filter(isHole);
    const expected = screen === "744" ? 44 : screen === "745" ? 32 : 0;
    assert.equal(holes.length, expected, `screen ${screen}`);
  }
});

test("resolveMazeExit picks by direction when a section branches", () => {
  const sections = [{
    key: 3, companion: 2, exits: [
      { screen: 749, key: 3, companion: 3, x: 10, y: 20, dir: 1 },
      { screen: 748, key: 3, companion: 1, x: 30, y: 40, dir: 5 },
    ],
  }];
  assert.equal(resolveMazeExit(sections, 3, 2, 1).screen, 749);
  assert.equal(resolveMazeExit(sections, 3, 2, 5).screen, 748);
  assert.equal(resolveMazeExit(sections, 3, 2, 7), undefined);
});

test("a corridor section resolves without consulting direction", () => {
  const sections = [{ key: 2, companion: 1, exits: [
    { screen: 749, key: 2, companion: 1, x: 928, y: 128, dir: 1 } ] }];
  assert.equal(resolveMazeExit(sections, 2, 1, null).screen, 749);
});

test("an unknown route pair resolves to nothing rather than guessing", () => {
  assert.equal(resolveMazeExit(graph["875"], 99, 99, 1), undefined);
  assert.equal(currentSection(graph["875"], 99, 99), undefined);
});

test("every section an occupant lives in exists in the graph", () => {
  // Route-gated NPCs/chests/card opponents across the seven circuit stages;
  // each must be standing in a section the maze can actually deliver you to.
  // 2026-10-06: the special block actors' cast records joined the scenes, so
  // their route gates are censused too (163 rows, up from 85), and the gate is
  // read faithfully: only an `expected: 1` route flag NAMES a section (an
  // `expected: 0` pair is the "not this route" half of an ordinary spawn gate),
  // and a key-only gate asks that the key exist in any section, since a
  // companion is not named.
  let checked = 0;
  for (const stage of circuitStages) {
    const scene = JSON.parse(readFileSync(`web/assets/scenes/s${stage}.json`, "utf8"));
    for (const npc of scene.npcs) {
      let key = null, companion = null;
      for (const f of npc.spawn_flags ?? []) {
        if (((f.id >> 8) & 0xfe) !== 0x7e || f.expected !== 1) continue;
        const i = f.id & 0x1ff;
        if (i < 0x1e) key = i + 1; else companion = i - 0x1d;
      }
      if (key === null) continue;
      checked++;
      const ok = companion === null
        ? (graph[stage] ?? []).some((s) => s.key === key)
        : currentSection(graph[stage], key, companion);
      assert.ok(ok, `s${stage} occupant route (${key},${companion}) has no section`);
    }
  }
  assert.equal(checked, 163);
});
