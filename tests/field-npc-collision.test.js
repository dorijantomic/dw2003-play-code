// Field NPC / tree collision — the walk predicate's standing-actor obstacle.
//
// The original's response to a blocked foot point is NOT a step revert. Each
// walking tick advances the actor and then calls F0x8008dfec (file 0xb33c),
// which runs FIVE probes — one per point of the facing's own cone — and, for
// each point that lands inside another field actor's footprint diamond
// (F0x80092a90: |dx| + 2|dy| <= actor+0x80) or within 10 px of a tree
// (F0x8008ce40), calls F0x8008de0c (file 0xb15c) with that record's own push
// vector: x by ±magnitude/2, y by ±magnitude/4, applied as `actor.x -= arg3;
// actor.y -= arg4`. Both `jal 0x8008dfec` sites discard the return value, so
// the push is the whole response. Nothing behind the actor is ever probed,
// which is why walking away from an obstacle is never refused.
//
// The record tables (dumped from web/assets/native/fieldstg.bin):
//   * 0x80097B88 (file 0x14ED8): 16 × {s32 x, s32 y} foot-ring offsets.
//   * 0x80097B60 (file 0x14EB0): 8 facings × 5 record indices.
//   * 0x80097C08 (file 0x14F58): 2 flag bytes per record (bit0 = pushes,
//     bit7 = negate; byte0 drives x, byte1 y).
//
// Fails on the pre-fix tree: engine/systems/field-movement.ts exports neither
// the 16-record table nor fieldProbePushback, and web/game.js reverts the step
// (fieldStepBlockedByActors) instead of pushing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FIELD_FOOTPRINT_OFFSETS,
  FIELD_PROBE_OFFSETS,
  FIELD_PROBE_INDEX,
  FIELD_PROBE_FLAGS,
  fieldProbeOffsets,
  fieldProbePushback,
  actorFootprintBlocked,
} from "../engine/systems/field-movement.ts";
import { npcHalfWidth } from "../engine/dw3/npc-sizes.ts";
import { treeIndexAt, TREE_HIT_RADIUS } from "../engine/systems/tree-kick.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = readFileSync(join(ROOT, "web/game.js"), "utf8");

test("the foot ring is F0x8008dfec's 16 offset records (RAM 0x80097B88)", () => {
  assert.deepEqual(FIELD_PROBE_OFFSETS, [
    [-6, -8], [6, -8], [8, -6], [8, 6], [6, 8], [-6, 8], [-8, 6], [-8, -6],
    [0, -8], [8, 0], [0, 8], [-8, 0], [8, -8], [8, 8], [-8, 8], [-8, -8],
  ]);
  assert.deepEqual(FIELD_FOOTPRINT_OFFSETS, FIELD_PROBE_OFFSETS.slice(0, 8),
    "the octagon is records 0-7");
  assert.ok(FIELD_PROBE_OFFSETS.every(([x, y]) => x !== 0 || y !== 0));
});

test("the per-facing selector is the 8×5 table at RAM 0x80097B60", () => {
  assert.deepEqual(FIELD_PROBE_INDEX, [
    [10, 5, 4, 6, 3], [14, 6, 5, 7, 4], [11, 7, 6, 0, 5], [15, 7, 0, 6, 1],
    [8, 0, 1, 7, 2], [12, 2, 1, 3, 0], [9, 2, 3, 1, 4], [13, 3, 4, 2, 5],
  ]);
  // The five points of a facing span its own 135° cone and nothing else: the
  // front (0,±8 / ±8,0), the two front diagonals and the two front corners.
  assert.deepEqual(fieldProbeOffsets(0), [[0, 8], [-6, 8], [6, 8], [-8, 6], [8, 6]]);
  assert.deepEqual(fieldProbeOffsets(4), [[0, -8], [-6, -8], [6, -8], [-8, -6], [8, -6]]);
  assert.deepEqual(fieldProbeOffsets(6), [[8, 0], [8, -6], [8, 6], [6, -8], [6, 8]]);
  for (let f = 0; f < 8; f++) {
    const pts = fieldProbeOffsets(f);
    assert.equal(pts.length, 5);
    // No point of a facing lies strictly behind it: walking away is never probed.
    const behind = { 0: (p) => p[1] < 0, 2: (p) => p[0] > 0, 4: (p) => p[1] > 0, 6: (p) => p[0] < 0 };
    if (behind[f]) assert.ok(pts.every((p) => !behind[f](p)), `facing ${f} probes behind itself`);
  }
});

test("the push flags are the 2-byte table at RAM 0x80097C08", () => {
  assert.deepEqual(FIELD_PROBE_FLAGS, [
    [0x00, 0x81], [0x00, 0x81], [0x01, 0x00], [0x01, 0x00],
    [0x00, 0x01], [0x00, 0x01], [0x81, 0x00], [0x81, 0x00],
    [0x00, 0x81], [0x01, 0x00], [0x00, 0x01], [0x81, 0x00],
    [0x01, 0x81], [0x01, 0x01], [0x81, 0x01], [0x81, 0x81],
  ]);
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

test("a blocked probe pushes back by its own (∓mag/2, ∓mag/4) — the step is not reverted", () => {
  // Walking right into an actor at (300, 200) with half-width 16, exactly the
  // F0x8008dfec loop: five probes of facing 6 (right), mag 0x4CC.
  const npc = { npc_id: 1, x: 300, y: 200 };
  const npcs = [npc];
  const occupied = (px, py) => actorFootprintBlocked(npcs, (n) => npcHalfWidth(n.npc_id), px, py);
  const pushAt = (x, y) => fieldProbePushback(6, 0x4cc, x, y, occupied);
  // Far to the left, nothing is probed.
  assert.deepEqual(pushAt(260, 200), { x: 0, y: 0 });
  // x = 285: the front probe (8,0) is at 293, |293-300| = 7 <= 16 — occupied.
  // Its record is 9, flags (0x01, 0x00): x pushes by +mag/2 = 614/256 px.
  assert.deepEqual(pushAt(285, 200), { x: 614 / 256, y: 0 });
  // The push moves the actor AWAY from the probe (subtract, as F0x8008de0c
  // does): 285 - 2.398 = 282.602.
  const p = pushAt(285, 200);
  assert.equal(285 - p.x, 285 - 614 / 256);
});

test("only the facing cone is probed: an obstacle behind never blocks the step", () => {
  const npc = { npc_id: 1, x: 300, y: 200 };
  const npcs = [npc];
  const occupied = (px, py) => actorFootprintBlocked(npcs, (n) => npcHalfWidth(n.npc_id), px, py);
  // The actor is right of the player. Walking right (facing 6) it is probed...
  assert.notDeepEqual(fieldProbePushback(6, 0x4cc, 285, 200, occupied), { x: 0, y: 0 });
  // ...and walking AWAY (facing 2, left) every probe lies left of the player,
  // so the actor behind is never tested and the step is free.
  assert.deepEqual(fieldProbePushback(2, 0x4cc, 285, 200, occupied), { x: 0, y: 0 });
  // This is the owner's bug: the old octagon probed (8,0) here and REVERTED
  // the whole step, freezing the player beside an actor/tree they were
  // standing next to.
});

test("a tree in the cone pushes the actor away from it, not through it", () => {
  const trees = [{ rec: 0, x: 300, y: 186 }];
  const occupied = (px, py) => treeIndexAt(trees, { x: px, y: py }) != null;
  // Walking right with a tree 14 px above: the upper probes (6,-8)/(8,-6) hit
  // the ±10 box; record 1 (6,-8) has flags (0x00, 0x81) -> y pushes by
  // -mag/4, subtracted -> y += 1.199 (down, away from the tree).
  const p = fieldProbePushback(6, 0x4cc, 292, 200, occupied);
  assert.ok(p.y < 0, "the push subtracts a negative y, moving the actor down");
  assert.equal(p.y, -307 / 256);
  assert.ok(p.x >= 0);
});

test("web/game.js routes field movement through the actor/tree obstacle", () => {
  assert.match(gameSrc, /fieldStepObstaclePush\s*\(/,
    "the movement path calls the obstacle response");
  assert.match(gameSrc, /fieldProbePushback\(/);
  assert.match(gameSrc, /actorFootprintBlocked\(/);
  assert.match(gameSrc, /npcHalfWidth\(/);
  assert.match(gameSrc, /treeIndexAt\(/);
  // It must be reached inside the walking tick, right after the walkmesh move,
  // and it must SUBTRACT the push instead of restoring the previous position.
  const iMove = gameSrc.indexOf("const moved = moveWithCollision(");
  const iPush = gameSrc.indexOf("fieldStepObstaclePush(m, state.x, state.y, moveMag)");
  assert.ok(iMove > 0 && iPush > iMove,
    "the obstacle response sits after the walkmesh move in the field tick");
  assert.doesNotMatch(gameSrc, /fieldStepBlockedByActors/,
    "the old whole-step revert is gone");
});
