// The walkable area is the stage's REGISTERED walk layers, not a fixed sub set.
//
// tools/tmpk_collision.py builds `blocked` from the TMPK subs the stage registers
// for resource type 0 (terrain/walk) and type 1 (a second walk layer only 8
// stages register: s261, s375, s376, s480, s481, s540, s934, s949). The old
// reader unioned a hardcoded {0,1,2}: it dropped the type-1 layer whole (blocked
// the Pharaohmon stairs in s375 and the Jungle Grave boardwalk in s480/s481) and
// merged the type-4 encounter-zone layer (a uniform full-coverage sub) into the
// walkable area of ~29 stages, leaving those maps with no walls at all.
//
// These cells are the evidence: each was blocked in the pre-fix grid at HEAD and
// decodes walkable in the stage's registered type-1 sub (verified against the
// disc with tools/tmpk_collision.py registered_layers()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (id) => JSON.parse(readFileSync(new URL(`../web/assets/collision/${id}.json`, import.meta.url)));
const blockedAt = (grid, x, y) => grid.blocked[Math.floor(y / 8)][Math.floor(x / 8)];
const blockedCount = (grid) => grid.blocked.reduce((n, row) => n + (row.match(/1/g)?.length ?? 0), 0);

// type-1-only cells (blocked by the old grid, open now), from the disc's sub 4 (s375) / sub 3 (s480).
const TYPE1_CELLS = {
  s375: [[1016, 192], [936, 264], [1032, 288], [872, 336]],
  s480: [[864, 976], [384, 1080], [784, 1152], [640, 1288]],
};

test("the Pharaohmon stairs (s375) and the Jungle Grave boardwalk (s480) are walkable", () => {
  for (const [id, cells] of Object.entries(TYPE1_CELLS)) {
    const grid = load(id);
    for (const [x, y] of cells)
      assert.equal(blockedAt(grid, x, y), "0", `${id} type-1 cell (${x},${y}) must be walkable`);
  }
});

test("the type-1 layer is only unioned where the stage registers it", () => {
  // s481 is the alias twin of s480 and carries the same registered layers.
  assert.equal(blockedCount(load("s481")), blockedCount(load("s480")));
  // s376/s949 are aliases of s375; s949 registers type 0 -> sub 2, type 1 -> sub 3.
  assert.equal(blockedAt(load("s949"), 936, 264), "0", "s949 alias of s375");
});

test("the type-4 encounter layer is NOT part of the walkable area", () => {
  // These stages register their encounter layer as a uniform full-coverage sub;
  // the old {0,1,2} union merged it, leaving the maps almost wall-free.
  // New blocked-cell counts are the type-0 walk layer's own walls.
  assert.ok(blockedCount(load("s953")) > 20000, "s953 must have real walls");
  assert.ok(blockedCount(load("s810")) > 15000, "s810 must have real walls");
  assert.ok(blockedCount(load("s949")) > 20000, "s949 must have real walls");
});
