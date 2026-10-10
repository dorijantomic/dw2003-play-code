// Cardmon booster reward — the pack a defeated Cardmon leaves.
//
// Decode: engine/dw3/cardmon-booster.ts header (fieldstg battle setup F0x8008B798).
// The per-screen tables are extracted by tools/extract_cardmon_boosters.py.
// Values are item ids (0x177..0x18A); the display name comes from item-names.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cardmonBooster, isCardmonEnemyId, CARDMON_ENEMY_IDS,
} from "../engine/dw3/cardmon-booster.ts";
import { BOOSTER_ITEM_IDS } from "../engine/dw3/booster-items.ts";

const TABLE = JSON.parse(readFileSync("web/assets/data/cardmon_boosters.json", "utf8"));
const CATALOG = JSON.parse(readFileSync("web/assets/data/items.json", "utf8")).catalog;
const BOOSTER_1B = 0x177, RBOOSTER_01 = 0x186;

/** Every item id the shipped table can name, read straight off the data. */
function tableIds() {
  const ids = new Set([TABLE.default.nz, TABLE.default.z]);
  for (const side of ["odd", "even"]) {
    for (const key of Object.keys(TABLE[side])) {
      const choice = TABLE[side][key];
      ids.add(choice.nz); ids.add(choice.z);
      if (choice.story2d) { ids.add(choice.story2d.nz); ids.add(choice.story2d.z); }
    }
  }
  return [...ids].sort((a, b) => a - b);
}

test("only the Cardmon family ids gate the reward", () => {
  for (const id of CARDMON_ENEMY_IDS) assert.equal(isCardmonEnemyId(id), true);
  for (const id of [456, 465, 1, 0, null, undefined, "457"])
    assert.equal(isCardmonEnemyId(id), false, `${id} must not be Cardmon`);
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 1, rand: 1 }), null);
});

test("the table covers the Cardmon fight screens with two packs each", () => {
  assert.equal(Object.keys(TABLE.odd).length, 178);
  assert.equal(Object.keys(TABLE.even).length, 206);
  for (const choice of Object.values(TABLE.odd)) assert.ok(choice.nz && choice.z);
  for (const choice of Object.values(TABLE.even)) assert.ok(choice.nz && choice.z);
  assert.deepEqual(TABLE.default, { nz: BOOSTER_1B, z: RBOOSTER_01 });
});

// CENSUS (FISH-Q004). The decoded system is one shared reward: every arm of the
// fieldstg switch ends at the same tail, `sw $v0, 0x2b6c($v1)`
// (fieldstg.s:9380), which stores the booster id into the battle descriptor.
// The member list is therefore whatever that switch can name, and it must equal
// the item-id block 0x177..0x18A — Booster1b..Booster15b and RBooster01..05 —
// and nothing else. This test fails if a pack is added to or dropped from the
// extracted table, and it fails if the reward ever widens past that block.
test("CENSUS: the reward's members are exactly items 0x177..0x18A and no others", () => {
  const expected = Array.from({ length: 0x18A - 0x177 + 1 }, (_, i) => 0x177 + i);
  assert.deepEqual(tableIds(), expected);
  // And those ids really are the boosters on the disc, and are all of the
  // "b"/RBooster half of the booster set — the 0x5B/0x169..0x176 "a" packs are
  // the shop's stock and are never a Cardmon's reward.
  const names = new Map(CATALOG.map((r) => [r.id, r.name]));
  for (const id of expected) assert.match(names.get(id), /^R?Booster/, `item ${id} is a booster`);
  const inStock = new Set(BOOSTER_ITEM_IDS);
  for (const id of expected) assert.ok(inStock.has(id), `booster ${id} must be in the item bag`);
  const neverAwarded = [...inStock].filter((id) => !expected.includes(id));
  assert.deepEqual(neverAwarded.sort((a, b) => a - b), [0x5b, ...Array.from({ length: 14 }, (_, i) => 0x169 + i)]);
});

// The census above reads the table; this one drives the shipped selection over
// every member's whole reach, so a member the data names but the selection can
// never return (a dead arm, a wrong parity, a wrong mask) is caught too.
test("every member is reachable through the shipped selection", () => {
  const reached = new Set();
  for (const enemyId of CARDMON_ENEMY_IDS) {
    for (const side of ["odd", "even"]) {
      for (const screen of Object.keys(TABLE[side])) {
        for (const rand of [0, 1, 0x10, 0x20, 0xffff]) {
          for (const progressOrdinal of [0, 0x2d]) {
            const id = cardmonBooster(TABLE, { screen: Number(screen), enemyId, rand, progressOrdinal });
            if (id != null) reached.add(id);
          }
        }
      }
    }
  }
  assert.deepEqual([...reached].sort((a, b) => a - b), tableIds());
});

test("out-of-range screens fall to Booster1b / RBooster01", () => {
  // s485 (0x1E5) is below both ranges; the fishing-spot Cardmon2 (id 458, even).
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 458, rand: 1 }), BOOSTER_1B);
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 458, rand: 0 }), RBOOSTER_01);
});

test("enemy-id parity picks the odd/even table for the same screen", () => {
  // 554 = 0x22A: odd Cardmon (457) -> Booster3b (0x179), even (458) -> Booster1b.
  assert.equal(cardmonBooster(TABLE, { screen: 554, enemyId: 457, rand: 5 }), 0x179);
  assert.equal(cardmonBooster(TABLE, { screen: 554, enemyId: 458, rand: 5 }), BOOSTER_1B);
  // 564 = 0x234: odd -> default, even -> Booster2b (0x178).
  assert.equal(cardmonBooster(TABLE, { screen: 564, enemyId: 457, rand: 5 }), BOOSTER_1B);
  assert.equal(cardmonBooster(TABLE, { screen: 564, enemyId: 458, rand: 5 }), 0x178);
  // 718 = 0x2CE: odd -> Booster14b (0x184), even -> Booster15b (0x185);
  // both rare RBooster05 (0x18A) at draw 0.
  assert.equal(cardmonBooster(TABLE, { screen: 718, enemyId: 457, rand: 5 }), 0x184);
  assert.equal(cardmonBooster(TABLE, { screen: 718, enemyId: 458, rand: 5 }), 0x185);
  assert.equal(cardmonBooster(TABLE, { screen: 718, enemyId: 457, rand: 0 }), 0x18A);
  assert.equal(cardmonBooster(TABLE, { screen: 718, enemyId: 458, rand: 0 }), 0x18A);
});

test("the random mask is 0x1f for odd ids and 0xf for even ids", () => {
  // Even id: 0x10 and 0x20 both mask to 0 -> the rare pack.
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 458, rand: 0x10 }), RBOOSTER_01);
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 458, rand: 0x20 }), RBOOSTER_01);
  // Odd id: only 0x20 masks to 0; 0x10 is nonzero -> the common pack.
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 457, rand: 0x10 }), BOOSTER_1B);
  assert.equal(cardmonBooster(TABLE, { screen: 485, enemyId: 457, rand: 0x20 }), RBOOSTER_01);
});

test("the progress-0x2d screens switch packs", () => {
  // 652 = 0x28C. Base: odd -> Booster6b (0x17c)/RBooster02 (0x187).
  // At story ordinal 0x2d: Booster9b (0x17f)/RBooster03 (0x188).
  assert.equal(cardmonBooster(TABLE, { screen: 652, enemyId: 457, rand: 1 }), 0x17C);
  assert.equal(cardmonBooster(TABLE, { screen: 652, enemyId: 457, rand: 0 }), 0x187);
  assert.equal(cardmonBooster(TABLE, { screen: 652, enemyId: 457, rand: 1, progressOrdinal: 0x2d }), 0x17F);
  assert.equal(cardmonBooster(TABLE, { screen: 652, enemyId: 457, rand: 0, progressOrdinal: 0x2d }), 0x188);
});
