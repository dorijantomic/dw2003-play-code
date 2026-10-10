// The merchant's HAND SWAP, and what the walker keeps once the shop closes.
//
// What a player sees: stand in the Asuka Heavy Armory with a Short Sword already
// on your partner's right hand, walk the list to the Zweihander and buy it. Answer
// Yes to "Equip?" and pick that partner. The Zweihander takes BOTH hands, the Short
// Sword it displaced comes back into your bag, and the band under the list reads
// "Equip 1". Walk out of the shop and the bag still holds exactly one Short Sword
// and "Equip n" still reads 1.
//
// The swap itself is the original's one routine, stitshop F0x8008C800 (file
// 0x9B50, RAM 0x8008C800): the piece in the chosen slot is taken off — its worn
// byte down, its carried byte up, `stitshop.s:9975-9980` (RAM 0x8008C8C0 load,
// 0x8008C8D0 / 0x8008C8D4 stores) — then the new piece goes on with `worn += 1;
// held -= 1` ONCE, `stitshop.s:10083-10088` (RAM 0x8008CA20..0x8008CA34), even
// though both hand halfwords are written (0x8008CAB4 / 0x8008CABC in the delay
// slot). So the worn byte of a two-handed piece is ONE.
//
// Closing the merchant has to hand that same swap to the walker's shared store
// (`commitEquipEvent`) — not re-derive it by diffing the six slots afterwards, which
// counts a two-handed piece twice and applies the bag moves the block already
// wrote. engine/dw3/ui/shop-close-commit.ts is the one commit order.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ShopRootSession } from "../engine/dw3/ui/shop-root-session.ts";
import { commitMerchantClose } from "../engine/dw3/ui/shop-close-commit.ts";
import { SHOP_HELD_BASE, SHOP_WORN_BASE } from "../engine/dw3/ui/shop-save-state.ts";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const catalog = json("../web/assets/data/shop_catalog.json");
const resources = {
  catalog, banks: new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
    const id = offset + 2;
    return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
  })),
  descriptors: catalog.itemDescriptors.map((row) =>
    new Uint8Array(readFileSync(new URL(`../web/assets/data/${row.file}`, import.meta.url)))),
  font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
  itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))),
};

/** Short Sword 92 — the Asuka Armory's first row, one hand, right or left. */
const SHORT_SWORD = 92;
/** Zweihander 178 — the Heavy Armory's eighth row, class 7, both hands. */
const ZWEIHANDER = 178;
/** shop 3 = the Asuka Heavy Armory; its row 8 is the Zweihander. */
const HEAVY_ARMORY = 3;

/** The walker's own fields the merchant reads and writes. */
function walkerState(equipment = [{}, {}, {}], inventory = [], worn = {}) {
  return { bits: 900000, inventory, worn, equipment };
}

/**
 * Open the merchant on `shopId` with `seed`, wait for the BUY stock list, and hand
 * back the pieces the test drives. Every step waits for the buy actor's own state
 * word, so a fold animation cannot swallow a key.
 */
function openShop(shopId, seed) {
  const session = new ShopRootSession(shopId, 2, seed, resources, { playSound() {}, closeSave() {} });
  const mem = session.mem;
  const reach = (address, value, limit = 200) => {
    for (let frame = 0; frame < limit && mem.read32(address) !== value; frame++) session.tick([]);
    assert.equal(mem.read32(address), value, `state ${address.toString(16)} never reached ${value}`);
  };
  const actorOf = () => {
    const context = mem.read32(session.root + 0x24) >>> 0;
    return mem.read32(context + 0x1c) >>> 0;
  };
  reach(session.root + 0x10, 3);
  session.tick(["circle"]); session.tick([]);           // root -> BUY
  let actor = 0;
  for (let frame = 0; frame < 80 && !actor; frame++) { actor = actorOf(); if (!actor) session.tick([]); }
  assert.ok(actor, "BUY actor created");
  reach(actor + 0x10, 3);
  const actorReach = (value, limit = 200) => {
    for (let frame = 0; frame < limit && mem.read32(actor + 0x10) !== value; frame++) session.tick([]);
    assert.equal(mem.read32(actor + 0x10), value, `BUY actor never reached state ${value}`);
  };
  const press = (button) => { session.tick([button]); session.tick([]); };
  const settle = (frames = 24) => { for (let i = 0; i < frames; i++) session.tick([]); };
  /** The stock row the list is highlighting, read the way the verifier reads it. */
  const highlighted = () => {
    const list = mem.read32(mem.read32(actor + 0x24)) >>> 0;
    const stock = mem.read32(list + 0x6b4) >>> 0;
    return mem.read16(stock + mem.read32(list + 0x6bc) * 2);
  };
  const moveTo = (id) => {
    for (let step = 0; step < 40 && highlighted() !== id; step++) {
      press("down"); settle(2); press("right"); settle(2);
    }
    assert.equal(highlighted(), id, "the list reached the wanted row");
  };
  /** list -> How many? -> Buy/No -> Buy -> Equip? -> Equip who? -> Equipped. */
  const buyAndEquip = () => {
    press("circle"); settle(8); actorReach(8);
    press("circle"); settle(8); actorReach(17);
    press("circle"); settle(8); actorReach(27);
    press("circle"); settle(8); actorReach(32);
    press("circle"); settle(8); actorReach(39);
    press("circle"); settle(8); actorReach(3);
  };
  return { session, mem, actor, actorReach, press, settle, highlighted, moveTo, buyAndEquip };
}

test("the buy that wears a two-handed weapon reports the swap it made", () => {
  const state = walkerState([{ right: SHORT_SWORD }, {}, {}], [], { [SHORT_SWORD]: 1 });
  const { session, moveTo, buyAndEquip } = openShop(HEAVY_ARMORY, {
    bits: state.bits,
    inventory: state.inventory,
    worn: Object.entries(state.worn).map(([id, qty]) => ({ id: Number(id), qty })),
    party: [{ rosterSlot: 0, starterSlot: 0, equipment: { right: SHORT_SWORD } }],
  });
  moveTo(ZWEIHANDER);
  buyAndEquip();
  const result = session.result();
  assert.deepEqual(result.swaps, [{
    party: 0, itemId: ZWEIHANDER,
    equipment: { right: ZWEIHANDER, left: ZWEIHANDER },
    displaced: [SHORT_SWORD],
  }], "one swap, naming the piece that came off the hand");
});

test("leaving the armory leaves one Short Sword in the bag, not two", () => {
  const state = walkerState([{ right: SHORT_SWORD }, {}, {}], [], { [SHORT_SWORD]: 1 });
  const { session, mem, moveTo, buyAndEquip } = openShop(HEAVY_ARMORY, {
    bits: state.bits,
    inventory: state.inventory,
    worn: Object.entries(state.worn).map(([id, qty]) => ({ id: Number(id), qty })),
    party: [{ rosterSlot: 0, starterSlot: 0, equipment: { right: SHORT_SWORD } }],
  });
  moveTo(ZWEIHANDER);
  buyAndEquip();

  // What the screen itself shows, before anything is handed back.
  assert.equal(mem.read8(SHOP_HELD_BASE + SHORT_SWORD), 1, "the displaced sword is back in the bag");
  assert.equal(mem.read8(SHOP_WORN_BASE + SHORT_SWORD), 0, "and nothing wears it any more");
  assert.equal(mem.read8(SHOP_HELD_BASE + ZWEIHANDER), 0, "the Zweihander left the bag");
  assert.equal(mem.read8(SHOP_WORN_BASE + ZWEIHANDER), 1,
    "and is worn once, not once per hand (stitshop 0x8008CA30)");

  commitMerchantClose(state, session.result());

  assert.deepEqual(state.inventory, [{ id: SHORT_SWORD, qty: 1 }],
    "the bag holds the displaced sword exactly once");
  assert.deepEqual(state.worn, { [ZWEIHANDER]: 1 },
    "\"Equip n\" reads 1 for a two-handed piece, as the original's single store does");
  assert.deepEqual(state.equipment, [
    { right: ZWEIHANDER, left: ZWEIHANDER }, {}, {},
  ], "the wearer record holds the Zweihander in both hands");
  assert.equal(state.bits, session.result().bits, "the wallet is the screen's");
});

test("a plain purchase into a free hand keeps its worn count and leaves no bag slot", () => {
  const state = walkerState();
  const { session, mem, buyAndEquip } = openShop(0, {
    bits: state.bits,
    inventory: [],
    worn: [],
    party: [{ rosterSlot: 0, starterSlot: 0, equipment: {} }],
  });
  buyAndEquip();
  assert.equal(mem.read8(SHOP_WORN_BASE + SHORT_SWORD), 1, "worn once, on screen");
  commitMerchantClose(state, session.result());
  assert.deepEqual(state.inventory, [], "the sword never sat in the bag");
  assert.deepEqual(state.worn, { [SHORT_SWORD]: 1 });
  assert.deepEqual(state.equipment, [{ right: SHORT_SWORD }, {}, {}]);
});

test("a purchase you decline to equip only moves the bag", () => {
  // "Equip?" -> No: the original's state 29 skips the member picker and returns to
  // the list, so the merchant made no swap at all.
  const state = walkerState();
  const { session, actor, actorReach, press, settle } = openShop(0, {
    bits: state.bits,
    inventory: [], worn: [],
    party: [{ rosterSlot: 0, starterSlot: 0, equipment: {} }],
  });
  press("circle"); settle(8); actorReach(8);     // list -> How many?
  press("circle"); settle(8); actorReach(17);    // -> Buy/No
  press("circle"); settle(8); actorReach(27);    // Buy
  press("down"); press("circle"); settle(8); actorReach(3);   // Equip? -> No
  const result = session.result();
  assert.deepEqual(result.swaps, [], "no swap was made");
  commitMerchantClose(state, result);
  assert.deepEqual(state.inventory, [{ id: SHORT_SWORD, qty: 1 }], "the sword is in the bag");
  assert.deepEqual(state.worn, {}, "and nothing wears it");
  assert.deepEqual(state.equipment, [{}, {}, {}]);
  assert.ok(actor, "the actor is still alive");
});