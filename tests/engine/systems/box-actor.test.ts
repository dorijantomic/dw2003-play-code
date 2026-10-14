// tests/engine/systems/box-actor.test.ts
// The item boxes (p126itmb) and the mode-0x4a talk body's family test: the ids
// the s2 test names (fieldstg F0x8008FED0 case 0x4A, file 0xde4c-0xde84), and
// the census that says those ids ARE the p126itmb records of the shipped
// scenes -- the family is not a walker-side invention.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  BOX_ACTOR_IDS, BOX_TALK_CLIP, BOX_TALK_CUE, BOX_GONE_STATE, isBoxActorId,
} from "../../../engine/systems/box-actor.ts";

test("the family is exactly the talk body's id test", () => {
  // `beq v1,0x21` / `(v1-0x4d) < 0xb` / `(v1-0x154) < 5` / `v1 == 0x15b`.
  for (const id of [33, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 340, 341, 342, 343, 344, 347]) {
    assert.ok(isBoxActorId(id), `${id} is in the family`);
  }
  assert.deepEqual([...BOX_ACTOR_IDS], [33, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 340, 341, 342, 343, 344, 347]);
  // The boundaries just outside every range, and the neighbours that must NOT
  // be caught: the player, Veemon (s395), the spriteless search points (npc
  // 63), and the three special block actors.
  for (const id of [32, 34, 76, 88, 339, 345, 346, 348, 2, 35, 63, 328, 351, 352]) {
    assert.ok(!isBoxActorId(id), `${id} is not in the family`);
  }
  assert.ok(!isBoxActorId(null) && !isBoxActorId(undefined) && !isBoxActorId(NaN));
  // The start-arm clip/cue and the close-arm remove state the module documents.
  assert.equal(BOX_TALK_CLIP, 0x41);
  assert.equal(BOX_TALK_CUE, 0x80045dc7);
  assert.equal(BOX_GONE_STATE, 3);
});

test("the family is the whole p126itmb census, and nothing else", () => {
  const dir = new URL("../../../web/assets/scenes/", import.meta.url);
  const boxIds = new Set<number>();
  const familySprites = new Map<number, Set<string>>();
  let instances = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const scene = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as {
      npcs?: { npc_id?: number; sprite?: string }[];
    };
    for (const n of scene.npcs ?? []) {
      if (n.sprite === "p126itmb") {
        instances++;
        boxIds.add(n.npc_id!);
      }
      if (isBoxActorId(n.npc_id)) {
        if (!familySprites.has(n.npc_id!)) familySprites.set(n.npc_id!, new Set());
        familySprites.get(n.npc_id!)!.add(n.sprite ?? "");
      }
    }
  }
  // 124 p126itmb records over exactly the 18 family ids.
  assert.equal(instances, 124);
  assert.deepEqual([...boxIds].sort((a, b) => a - b), [...BOX_ACTOR_IDS].sort((a, b) => a - b));
  // And no other sprite shares a family id: the id test is a box test.
  for (const [id, sprites] of familySprites) {
    assert.deepEqual([...sprites], ["p126itmb"], `id ${id} must only ever be a box`);
  }
});
