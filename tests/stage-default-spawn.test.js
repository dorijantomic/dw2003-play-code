// Stage default spawn — the scene descriptor's per-stage arrival position.
//
// Decode: tools/extract_stage_default_spawn.py header (fieldstg F0x8009116c:
// +0x2C/+0x30 are 24.8 fixed, the leader's map pixel is raw >> 8). The data
// check below is the evidence the transform is right: a wrong divisor or offset
// would land spawns on blocked collision, and 74% of the grid is blocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const SPAWN = JSON.parse(readFileSync("web/assets/data/stage_default_spawn.json", "utf8"));
const MANIFEST = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
const MAPS = Object.fromEntries((MANIFEST.maps ?? MANIFEST).map((m) => [m.id, m]));

test("every stage gets a default spawn", () => {
  const ids = Object.keys(SPAWN);
  assert.ok(ids.length >= 290, `expected ~293 spawns, got ${ids.length}`);
  for (const [id, p] of Object.entries(SPAWN)) {
    assert.equal(Number.isInteger(p.x) && Number.isInteger(p.y), true, `${id} must have integer x/y`);
    assert.equal(p.x >= 0 && p.y >= 0, true, `${id} must not be negative`);
  }
});

test("the descriptor 24.8 fixed transform: raw >> 8", () => {
  // wstag895 +0x2C=0x13B00, +0x30=0x21000 -> (315, 528), inside the 1152x768 map.
  assert.deepEqual(SPAWN.s895, { x: 315, y: 528, facing: 0 });
  assert.deepEqual(SPAWN.s271, { x: 192, y: 285, facing: 0 });
});

test("spawns with an extracted map land on walkable cells", () => {
  let checked = 0;
  for (const [id, p] of Object.entries(SPAWN)) {
    const map = MAPS[id];
    if (!map) continue;
    const path = `web/assets/collision/${id}.json`;
    if (!existsSync(path)) continue; // 20 stages have no collision file
    const c = JSON.parse(readFileSync(path, "utf8"));
    const col = Math.floor(p.x / c.cell), row = Math.floor(p.y / c.cell);
    assert.ok(col < c.cols && row < c.rows, `${id} spawn (${p.x},${p.y}) is outside its map`);
    assert.notEqual(c.blocked[row][col], "1", `${id} spawn (${p.x},${p.y}) is on blocked collision`);
    checked++;
  }
  assert.ok(checked >= 270, `expected ~273 walkable spawns, checked ${checked}`);
});
