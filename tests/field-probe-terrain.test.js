// Field probe path vs the disc's F0x8008de0c step predicate.
//
// The five-probe push-back (F0x8008dfec) calls F0x8008de0c (file 0xb15c) once
// per probe point. Its predicate is NOT occupancy alone: after the occupancy
// query (zonemgr+0x58 = F0x80092a90: actor footprint diamonds + F0x8008ce40
// trees) it reads the typed-terrain byte at the probe point through
// zonemgr+0x44 (F0x80092914, called with the current-type word [0x8004b414],
// which every stage sets to 0) and refuses the step on that byte:
//
//   * byte == 1 -> never refused (a stage with no registered typed layer
//     answers 1: F0x800927fc returns 0 and F0x80092914 returns 1U);
//   * a height-carrying form (actor+0x64 != 0, Submarimon alone) is refused by
//     the code's band — raised tiers 2..6 pass only at or over 0x1000*code
//     (.L0x0000b1f0-0xb260), mirror tiers 18..22 only underneath
//     (0x6001 - 0x1000*(code-0x12), .L0x0000b268-0xb2d8);
//   * the refused byte zeroes the query result and the push applies
//     (.L0x0000b2ec-0xb31c: `actor.x -= arg3; actor.y -= arg4`).
//
// The walker's probe path used to check occupancy only, and applied the gate
// (invented, at the destination point) BEFORE the move instead. These tests
// fail on that tree and pass once the gate lives inside the probe predicate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  fieldProbePushback,
  actorFootprintBlocked,
} from "../engine/systems/field-movement.ts";
import {
  terrainCodeAt,
  terrainGateBlocks,
} from "../engine/core/util/collision.ts";
import { npcHalfWidth } from "../engine/dw3/npc-sizes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = readFileSync(join(ROOT, "web/game.js"), "utf8");

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

/** One 8x8 tile grid whose leaf byte at (0,0) is `code`. */
function terrainGrid(code) {
  const terrain = [
    b64([1, 1, 0]),                      // bin0: gw=1 gh=1, tile 0
    b64([0, 0, 0, 0]),                   // bin1: 2x2 at 64px -> entry 0
    b64([0, 0, 0, 0, 0, 0, 0, 0]),       // bin2: u16 entries -> 0
    b64([0, 0, 0, 0, 0, 0, 0, 0]),       // bin3
    b64([0, 0, 0, 0, 0, 0, 0, 0]),       // bin4
    b64([code, ...Array(63).fill(0)]),   // bin5: leaf 0, pixel (0,0) = code
  ];
  return { cell: 8, cols: 1, rows: 1, cells: new Uint8Array([0]), terrain: terrain.map((s) => Uint8Array.from(Buffer.from(s, "base64"))) };
}

test("the probe predicate refuses a point the form's height is wrong for (F0x8008de0c band)", () => {
  const g = terrainGrid(0x16);           // ceiling 0x2000: passes only below 0x2001
  assert.equal(terrainCodeAt(g, 0, 0), 0x16);
  assert.equal(terrainGateBlocks(g, 0, 0, 0x2001), true, "at/over the ceiling -> refused");
  assert.equal(terrainGateBlocks(g, 0, 0, 0x2000), false, "just under the ceiling -> passes");
  assert.equal(terrainGateBlocks(g, 0, 0, 0), false, "a walking form carries no height");
  const g2 = terrainGrid(0x04);          // floor 0x4000: passes only at/over
  assert.equal(terrainGateBlocks(g2, 0, 0, 0x3fff), true, "under the floor -> refused");
  assert.equal(terrainGateBlocks(g2, 0, 0, 0x4000), false, "at the floor -> passes");
});

test("code 1 and a stage with no typed layer are never terrain-gated (F0x80092914 returns 1)", () => {
  const g1 = terrainGrid(0x01);
  for (const h of [0, 0x1000, 0x3000, 0x7000]) assert.equal(terrainGateBlocks(g1, 0, 0, h), false);
  const noLayer = { cell: 8, cols: 1, rows: 1, cells: new Uint8Array([0]) };
  assert.equal(terrainGateBlocks(noLayer, 0, 0, 0x3000), false);
  assert.equal(terrainCodeAt(noLayer, 0, 0), 0);
});

test("a gated probe point pushes the actor exactly like an occupied one (the push is the whole response)", () => {
  // The composed predicate the walker must use: occupancy OR the height band.
  const g = terrainGrid(0x16);
  const npcs = [];
  const blockedAt = (height) => (px, py) =>
    actorFootprintBlocked(npcs, (n) => npcHalfWidth(n.npc_id), px, py)
    || terrainGateBlocks(g, px, py, height);
  // Facing 0 (down) probes (0,8) first: at height 0x2001 the point is refused,
  // and record 10's flags (0x00, 0x01) push y by +mag/4 (subtracted -> up).
  const gated = fieldProbePushback(0, 0x4cc, 0, 0, blockedAt(0x2001));
  assert.equal(gated.y, 307 / 256);
  assert.equal(gated.x, 0);
  // Below the ceiling the same probe passes: nothing pushes.
  assert.deepEqual(fieldProbePushback(0, 0x4cc, 0, 0, blockedAt(0x2000)), { x: 0, y: 0 });
  // A walking form (no height) is never gated by this cell.
  assert.deepEqual(fieldProbePushback(0, 0x4cc, 0, 0, blockedAt(0)), { x: 0, y: 0 });
});

test("web/game.js runs the gate inside the probe predicate, not as a pre-move refusal", () => {
  // The probe callback must compose the terrain half with occupancy.
  assert.match(gameSrc, /terrainGateBlocks\(grid, px, py, heightFixed\)/,
    "the probe predicate calls terrainGateBlocks at the probe point");
  // The old invented gate checked the destination BEFORE the move and skipped
  // the move + probes entirely; the disc has no such check (F0x8008de0c is the
  // only gate, and it lives at the probe points).
  assert.doesNotMatch(gameSrc, /terrainGateBlocks\(grid, state\.x \+ delta\.x/,
    "the destination pre-move gate is gone");
  // The sub's height feeds the predicate.
  assert.match(gameSrc, /fieldStepObstaclePush\(m, grid, state\.x, state\.y, moveMag, heightFixed\)/,
    "the movement path passes the form height into the probe response");
});

test("Submarimon's swim reads the PURE row-0 helper, not the terrain-scaled one (zonemgr+0x4c)", () => {
  // WQ004-ZONE-4C-PURE / ZONE-Q001-CELL-710-FACING-MOVE-STEP: the sub's swim
  // states call 0x80092da0 (row 0, no query, no remap, no sign flip). Only the
  // walk states read the terrain-scaled 0x80092ca0.
  assert.match(gameSrc, /state\.submarimon\s*\?\s*fieldPureDirectionDelta\(state\.dir, moveMag\)/,
    "the sub's delta comes from the pure helper");
  assert.match(gameSrc, /: fieldDirectionDelta\(\s*state\.dir,\s*moveMag,\s*terrainCodeAt\(grid, state\.x, state\.y\),?\s*\)/,
    "the walking delta keeps the terrain-scaled helper");
});
