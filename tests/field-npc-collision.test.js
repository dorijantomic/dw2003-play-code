// Field NPC / tree collision — the walk predicate's standing-actor obstacle.
//
// The original refuses a field step when a point of the actor's foot perimeter
// (table RAM 0x80097B88, probed by F0x8008dfec) lands inside another field
// actor's footprint diamond (F0x80092a90: |dx| + 2|dy| <= actor+0x80) or within
// 10 px of a tree (F0x8008ce40). The walker only checked the walkmesh before
// this; web/game.js now routes its movement through the same rule.
//
// Fails on the pre-fix tree: engine/systems/field-movement.ts exports neither
// FIELD_FOOTPRINT_OFFSETS nor actorFootprintBlocked, and web/game.js has no
// fieldStepBlockedByActors call.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FIELD_FOOTPRINT_OFFSETS,
  actorFootprintBlocked,
} from "../engine/systems/field-movement.ts";
import { npcHalfWidth } from "../engine/dw3/npc-sizes.ts";
import { treeIndexAt, TREE_HIT_RADIUS } from "../engine/systems/tree-kick.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = readFileSync(join(ROOT, "web/game.js"), "utf8");

test("the probe offsets are F0x8008dfec's 8 perimeter points (RAM 0x80097B88)", () => {
  assert.deepEqual(FIELD_FOOTPRINT_OFFSETS, [
    [-6, -8], [6, -8], [8, -6], [8, 6], [6, 8], [-6, 8], [-8, 6], [-8, -6],
  ]);
  assert.ok(FIELD_FOOTPRINT_OFFSETS.every(([x, y]) => x !== 0 || y !== 0));
});

test("the actor box is the diamond |dx| + 2|dy| <= npcHalfWidth (F0x80092a90)", () => {
  const at = (npc, x, y, hw) => actorFootprintBlocked([npc], () => hw, x, y);
  const npc = { x: 100, y: 100 };
  assert.equal(at(npc, 100, 100, 16), true);
  assert.equal(at(npc, 116, 100, 16), true, "east vertex");
  assert.equal(at(npc, 117, 100, 16), false);
  assert.equal(at(npc, 100, 108, 16), true, "south vertex, 2*8=16");
  assert.equal(at(npc, 100, 109, 16), false);
  assert.equal(at(npc, 110, 103, 16), true, "on the edge, 10+6=16");
  assert.equal(at(npc, 111, 103, 16), false, "11+6=17");
});

test("npcHalfWidth is size(npc_id) >> 1 and null outside the table", () => {
  assert.equal(npcHalfWidth(1), 16); // NPC_SIZE_BYTES[1] = 32 -> 16
  assert.equal(npcHalfWidth(null), null);
  assert.equal(npcHalfWidth(9999), null);
});

test("the tree box is the ±10 square of F0x8008ce40", () => {
  assert.equal(TREE_HIT_RADIUS, 10);
  const trees = [{ rec: 0, x: 500, y: 300 }];
  assert.notEqual(treeIndexAt(trees, { x: 510, y: 300 }), null);
  assert.notEqual(treeIndexAt(trees, { x: 500, y: 310 }), null);
  assert.equal(treeIndexAt(trees, { x: 511, y: 300 }), null);
  assert.equal(treeIndexAt(trees, { x: 500, y: 311 }), null);
});

test("walking at an NPC is stopped by the perimeter scan, and passing is not", () => {
  // Mirror web/game.js::fieldStepBlockedByActors for a player walking right into
  // an actor at (300, 200) with half-width 16.
  const npc = { npc_id: 1, x: 300, y: 200 };
  const npcs = [npc];
  const blocked = (x, y) => FIELD_FOOTPRINT_OFFSETS.some(([ox, oy]) =>
    actorFootprintBlocked(npcs, (n) => npcHalfWidth(n.npc_id), x + ox, y + oy));
  // Far to the left, the walk is free...
  assert.equal(blocked(260, 200), false);
  // ...and on the near side of the diamond it refuses.
  assert.equal(blocked(288, 200), true, "front probe already inside the box");
});

test("web/game.js routes field movement through the actor/tree obstacle", () => {
  assert.match(gameSrc, /fieldStepBlockedByActors\s*\(/,
    "the movement path calls the obstacle test");
  assert.match(gameSrc, /FIELD_FOOTPRINT_OFFSETS/);
  assert.match(gameSrc, /actorFootprintBlocked\(/);
  assert.match(gameSrc, /npcHalfWidth\(/);
  // It must be reached inside the walking tick, right after the walkmesh move.
  const iMove = gameSrc.indexOf("const moved = moveWithCollision(");
  const iObstacle = gameSrc.indexOf("fieldStepBlockedByActors(m, state.x, state.y)");
  assert.ok(iMove > 0 && iObstacle > iMove,
    "the obstacle check sits after the walkmesh move in the field tick");
});
