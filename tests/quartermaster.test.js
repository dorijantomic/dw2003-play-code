// Quartermaster part 1 — the best legal loadout, from the game's own numbers.
//
// The rule under test is the pause sheet's own:
//   * a piece belongs in a slot its decoded wield descriptor admits
//     (`wieldSlotsFor`: 1 Right, 2 Left, 3 Left or Right, 4 Head, 5 Body,
//     6/8 Accessory, 7 Two-handed);
//   * the member's line must admit the piece through its wear mask
//     (`pauseEquipRowAdmits`, engine/dw3/equipment.ts:163);
//   * a two-handed descriptor (stat byte +0x2 === 7) takes BOTH hands and is
//     offered in both hand lists, so it must never be worn next to a left piece;
//   * only copies we own (held + worn) may be proposed.
//
// Every number comes from `gearStatContributions` in the vendored engine — this
// file writes no stat amount of its own, only ids and copy counts read from the
// shipped catalog.
//
// One correction to the card, measured at this HEAD: ShortSword (92) is stat byte
// +0x2 = 3, the esstatus string "Left or Right", so `wieldSlotsFor(92)` answers
// ["right", "left"] — not ["right"]. Its catalog `slot` column says right, but
// the descriptor is what the pause list walks (engine/dw3/equipment.ts:55), and
// 92 of the 268 rows carry that descriptor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  gearStatContributions,
  isTwoHanded as engineIsTwoHanded,
  wieldSlotsFor as engineWieldSlotsFor,
  pauseEquipRowAdmits,
} from "../web/vendor/engine.js";
import { poolFrom, itemRecord, slotOptions, legalCombo, bestLoadout } from "../web/quartermaster.js";

const equipment = JSON.parse(
  readFileSync(new URL("../web/assets/data/equipment.json", import.meta.url), "utf8"),
).equipment;
const effects = JSON.parse(
  readFileSync(new URL("../web/assets/data/item_effects.json", import.meta.url), "utf8"),
).items;
const byId = new Map(equipment.map((r) => [r.id, r]));
const record = (id) => itemRecord(byId.get(id));

/** A pool from owned pieces: [[id, held = 1], ...] plus a worn map. */
function owned(rows, worn = {}) {
  return poolFrom(
    rows.map(([id, held]) => ({ id, qty: held ?? 1 })),
    worn,
  );
}

/** Fold a gearStatContributions list into { stat: amount }, adding repeats. */
function fold(list) {
  const out = {};
  for (const c of list) out[c.stat] = (out[c.stat] ?? 0) + c.amount;
  return out;
}

/** chosen minus worn, dropping zeros: the delta the page shows per slot. */
function diff(chosen, worn) {
  const out = {};
  for (const k of new Set([...Object.keys(chosen), ...Object.keys(worn)])) {
    const v = (chosen[k] ?? 0) - (worn[k] ?? 0);
    if (v !== 0) out[k] = v;
  }
  return out;
}

test("the catalog's two-handed class is stat byte +0x2 = 7, and the engine reads it", () => {
  const zwei = record(178);
  assert.equal(engineIsTwoHanded(zwei), true);
  assert.equal(engineIsTwoHanded(record(92)), false);
  assert.deepEqual(engineWieldSlotsFor(zwei), ["right", "left"]);
  // Correction to the card: ShortSword is descriptor 3, "Left or Right".
  assert.equal(record(92).statBytes[2], 3);
  assert.deepEqual(engineWieldSlotsFor(record(92)), ["right", "left"]);
  // item_effects.json's `two_handed` flag names the same 23 rows the class byte does.
  const flagged = effects
    .filter((r) => r.two_handed === true)
    .map((r) => r.id)
    .sort((a, b) => a - b);
  const classed = equipment
    .filter((r) => r.stat_bytes[2] === 7)
    .map((r) => r.id)
    .sort((a, b) => a - b);
  assert.deepEqual(flagged, classed);
  assert.equal(classed.length, 23);
});

test("poolFrom reads the bag and the worn map into the 1..402 item range", () => {
  const pool = poolFrom(
    [
      { id: 178, qty: 1 },
      { id: 275, qty: 2 },
      { id: 403, qty: 5 },
      { id: 0, qty: 2 },
    ],
    { 92: 1, 999: 2 },
  );
  assert.deepEqual(pool[178], { held: 1, worn: 0 });
  assert.deepEqual(pool[275], { held: 2, worn: 0 });
  assert.deepEqual(pool[92], { held: 0, worn: 1 });
  assert.deepEqual(pool[303], { held: 0, worn: 0 });
  assert.equal(Object.keys(pool).length, 402);
  assert.equal(403 in pool, false);
  assert.equal(0 in pool, false);
  assert.equal(999 in pool, false);
  // The same pool fed in another order is the same pool.
  const again = poolFrom(
    [
      { id: 403, qty: 5 },
      { id: 0, qty: 2 },
      { id: 275, qty: 2 },
      { id: 178, qty: 1 },
    ],
    { 999: 2, 92: 1 },
  );
  assert.deepEqual(again, pool);
});

test("slotOptions offers only owned pieces, in the hand lists the descriptor admits", () => {
  const pool = owned([
    [178],
    [92],
    [275],
    [248],
    [303, 0],
  ]);
  const options = slotOptions({ lineSlot: 0, equipment: {} }, pool, equipment);
  assert.deepEqual(options.head, [248]);
  assert.deepEqual(options.right, [92, 178]);
  // 92 is Left or Right, 178 is Two-handed, 275 is a left-only shield.
  assert.deepEqual(options.left, [92, 178, 275]);
  // held + worn === 0: never proposed.
  assert.equal(options.head.includes(303), false);
  assert.equal(options.left.includes(303), false);
});

test("the member's line refuses pieces its wear mask does not admit", () => {
  const pool = owned([[178], [275]]);
  const options = slotOptions({ lineSlot: 1, equipment: {} }, pool, equipment);
  // Zweihander's mask 57 = lines 0, 3, 4, 5; Buckler's 255 admits every line.
  assert.equal(record(178).wearMask, 57);
  assert.equal(options.right.includes(178), false);
  assert.equal(options.left.includes(178), false);
  assert.deepEqual(options.right, []);
  assert.deepEqual(options.left, [275]);
  // `rules` may override the member's own line (the page passes the roster slot).
  const viaRules = slotOptions({ lineSlot: 0, equipment: {} }, pool, equipment, { lineSlot: 1 });
  assert.deepEqual(viaRules.left, [275]);
  assert.equal(viaRules.right.includes(178), false);
});

test("the pause row refuses a left-slot piece in the right row, for the member holding 178", () => {
  // The card's example: a member already wearing the Zweihander (178) offers
  // the Buckler (275, a left-slot piece) — the right row refuses it outright.
  const holding = { lineSlot: 0, equipment: { right: 178 } };
  assert.equal(record(275).statBytes[2], 2);
  assert.equal(pauseEquipRowAdmits(holding.lineSlot, 2, 275), false);
  assert.equal(pauseEquipRowAdmits(holding.lineSlot, 3, 275), true);
  assert.equal(legalCombo({ right: 178, left: 275 }, equipment, holding), false);
  const options = slotOptions(holding, owned([[275]]), equipment);
  assert.equal(options.right.includes(275), false);
  assert.deepEqual(options.left, [275]);
  // A Left-or-Right sword is admitted by both hand rows.
  assert.equal(pauseEquipRowAdmits(0, 2, 92), true);
  assert.equal(pauseEquipRowAdmits(0, 3, 92), true);
});

test("a piece with held + worn === 0 is never proposed", () => {
  const member = { lineSlot: 0, equipment: {} };
  const pool = poolFrom([{ id: 275, qty: 0 }], {});
  assert.deepEqual(pool[275], { held: 0, worn: 0 });
  assert.deepEqual(slotOptions(member, pool, equipment), {
    head: [],
    body: [],
    right: [],
    left: [],
    acc0: [],
    acc1: [],
  });
  const loadout = bestLoadout(member, pool, equipment);
  assert.deepEqual(loadout.slots, { head: 0, body: 0, right: 0, left: 0, acc0: 0, acc1: 0 });
});

test("legalCombo refuses the illegal pairs the pause sheet refuses", () => {
  const member = { lineSlot: 0, equipment: {} };
  assert.equal(legalCombo({ right: 92, left: 275 }, equipment, member), true);
  assert.equal(legalCombo({ right: 178 }, equipment, member), true);
  assert.equal(legalCombo({ right: 178, left: 275 }, equipment, member), false,
    "a two-handed sword takes both hands");
  assert.equal(legalCombo({ right: 275 }, equipment, member), false,
    "a left-only shield cannot sit in the right row");
  assert.equal(legalCombo({ right: 92, left: 92 }, equipment, member), false,
    "one copy, one slot");
  // A descriptor-8 accessory pair from the same bank cannot be worn together
  // (equipApplyRecord takes the first off when the second goes on).
  assert.equal(legalCombo({ acc0: 323, acc1: 324 }, equipment, member), false);
  assert.equal(legalCombo({ acc0: 323, acc1: 325 }, equipment, member), true);
});

test("bestLoadout never wears a two-handed sword together with a left piece", () => {
  const member = { lineSlot: 0, equipment: {} };
  const loadout = bestLoadout(member, owned([[178], [92], [275]]), equipment);
  // Zweihander's own total (187) beats ShortSword + Buckler (46): it takes both
  // hands and the shield stays in the bag.
  assert.equal(loadout.slots.right, 178);
  assert.equal(loadout.slots.left || 0, 0);
  assert.equal(loadout.slots.right === 178 && loadout.slots.left === 275, false);
  // The same pool without the two-hander dresses the other legal way: a
  // one-handed sword in the right hand and the shield in the left.
  const pair = bestLoadout(member, owned([[92], [275]]), equipment);
  assert.equal(pair.slots.right, 92);
  assert.equal(pair.slots.left, 275);
  // And the refusal names the shield and the reason the page will show.
  const refusal = loadout.refusals.find((r) => r.slot === "left" && r.id === 275);
  assert.ok(refusal, `275 is missing from ${JSON.stringify(loadout.refusals)}`);
  assert.equal(refusal.reason, "hands");
});

test("a worn copy with no held copy is proposed exactly once", () => {
  const member = { lineSlot: 0, equipment: { right: 178, left: 178 } };
  const loadout = bestLoadout(member, poolFrom([], { 178: 1 }), equipment);
  assert.equal(loadout.slots.right, 178);
  assert.equal(loadout.slots.left || 0, 0);
  assert.deepEqual(Object.values(loadout.slots).filter((id) => id > 0), [178]);
  // The two hand halfwords are ONE worn piece: leaving it alone changes nothing.
  for (const slot of Object.keys(loadout.slots)) assert.deepEqual(loadout.deltas[slot], {});
});

test("every delta is the chosen piece's contribution minus the worn piece's", () => {
  const member = { lineSlot: 0, equipment: { right: 92, left: 275 } };
  const pool = owned([[178], [248], [274], [303], [293]], { 92: 1, 275: 1 });
  const loadout = bestLoadout(member, pool, equipment);
  assert.deepEqual(loadout.slots, {
    head: 248,
    body: 274,
    right: 178,
    left: 0,
    acc0: 303,
    acc1: 293,
  });
  const worn = { head: 0, body: 0, right: 92, left: 275, acc0: 0, acc1: 0 };
  for (const slot of Object.keys(loadout.slots)) {
    const chosen = record(loadout.slots[slot]);
    const before = record(worn[slot]);
    assert.deepEqual(
      loadout.deltas[slot],
      diff(
        chosen ? fold(gearStatContributions(chosen)) : {},
        before ? fold(gearStatContributions(before)) : {},
      ),
      slot,
    );
  }
  // One spot-check in the engine's own words: the Zweihander over the ShortSword.
  assert.deepEqual(
    loadout.deltas.right,
    diff(fold(gearStatContributions(record(178))), fold(gearStatContributions(record(92)))),
  );
});

test("the same pool in a different order gives the same six slots and refusals", () => {
  const member = { lineSlot: 0, equipment: { right: 92, left: 275 } };
  const bagA = [[93], [276], [248], [274], [303], [293]];
  const bagB = [...bagA].reverse();
  const a = bestLoadout(member, owned(bagA, { 92: 1, 275: 1 }), equipment);
  const b = bestLoadout(member, owned(bagB, { 275: 1, 92: 1 }), equipment);
  assert.deepEqual(a.slots, b.slots);
  assert.deepEqual(a.deltas, b.deltas);
  assert.deepEqual(a.refusals, b.refusals);
});

test("the module's only import is the vendored engine", () => {
  const src = readFileSync(new URL("../web/quartermaster.js", import.meta.url), "utf8");
  const specifiers = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(specifiers, ["./vendor/engine.js"]);
});
