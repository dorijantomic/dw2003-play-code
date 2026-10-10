// The merchant's info band and its hand swap, on the translated merchant page.
//
// What a player sees: the band under the item list reads "Equip n" for the piece
// under the cursor, and n is the ORIGINAL's stored worn byte, not a count of who
// wears what (stitshop.s:7310, RAM 0x80089ECC, `lb $a2, 0x20f($v0)` into the
// widget at block+0x08). When the merchant puts a bought piece on a partner, the
// same routine that writes the six equip halfwords writes the block's second count
// array beside it (stitshop F0x8008C800's transfer arm, `stitshop.s:10083-10088`:
// `lbu 0x20f` / `addiu 1` / `sb 0x20f` at RAM 0x8008CA20/0x8008CA30, and the
// unequip side at `stitshop.s:9975-9980` and `10024-10034`, RAM 0x8008C8D0 and
// 0x8008C940), so the figure moves with the wearer record instead of standing
// still.
//
// The byte-level oracle for those four stores is tests/shop-equip-swap-oracle.test.js,
// which runs the original routine itself; this file drives the whole merchant and
// reads what the band shows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ShopRootSession } from "../engine/dw3/ui/shop-root-session.ts";
import { ROSTER_EQUIP_OFFSETS, ROSTER_RECORDS, ROSTER_STRIDE } from "../engine/dw3/party-context.ts";
import { SHOP_HELD_BASE, SHOP_WORN_BASE } from "../engine/dw3/ui/shop-save-state.ts";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const catalog = json("../web/assets/data/shop_catalog.json");
const descriptors = catalog.itemDescriptors.map((row) =>
  new Uint8Array(readFileSync(new URL(`../web/assets/data/${row.file}`, import.meta.url))));
const banks = new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
  const id = offset + 2;
  return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
}));
const resources = {
  catalog, banks, descriptors,
  font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
  itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))),
};

/** The game's own digit codes: `4 + digit`, the way encodeName writes them. */
const DIGIT = (n) => 4 + n;

/** Short Sword 92: the Asuka Armory's first stock row. */
const SHORT_SWORD = 92;
/** Tenjimaru 93, held in the other hand so both hand slots are spoken for. */
const TENJIMARU = 93;

function open(seed) {
  const session = new ShopRootSession(0, 2, seed, resources, { playSound() {}, closeSave() {} });
  const mem = session.mem;
  const reach = (address, value, limit = 160) => {
    for (let frame = 0; frame < limit && mem.read32(address) !== value; frame++) session.tick([]);
    assert.equal(mem.read32(address), value, `state ${address.toString(16)} never reached ${value}`);
  };
  reach(session.root + 0x10, 3);
  session.tick(["circle"]); session.tick([]);
  const rootContext = mem.read32(session.root + 0x24) >>> 0;
  let actor = 0;
  for (let frame = 0; frame < 60; frame++) {
    actor = mem.read32(rootContext + 0x1c) >>> 0;
    if (actor) break;
    session.tick([]);
  }
  assert.ok(actor, "BUY actor created");
  reach(actor + 0x10, 3);
  const actorReach = (value, limit = 160) => {
    for (let frame = 0; frame < limit && mem.read32(actor + 0x10) !== value; frame++) session.tick([]);
    assert.equal(mem.read32(actor + 0x10), value, `BUY actor never reached state ${value}`);
  };
  // The buy machine walks several fold states between prompts, so a press only
  // counts once the previous screen has settled.
  const press = () => {
    session.tick(["circle"]); session.tick([]);
    for (let frame = 0; frame < 24; frame++) session.tick([]);
  };
  /** Buy whatever row the shelf is highlighting and equip it on the first member. */
  const buyAndEquip = () => {
    press(); actorReach(8);
    press(); actorReach(17);
    press(); actorReach(27);
    press(); actorReach(32);
    press();
    for (let frame = 0; frame < 40; frame++) session.tick([]);
  };
  return { session, actor, mem, actorReach, press, buyAndEquip };
}

/** The band's block, the object F0x80089A44 writes its nine labels into. */
function bandBlock(mem, actor) {
  const actorContext = mem.read32(actor + 0x24) >>> 0;
  const band = mem.read32(actorContext + 4) >>> 0;
  assert.ok(band, "the item detail band is a live task");
  return { band, block: mem.read32(band + 0x24) >>> 0 };
}

/** The bytes the band's "Equip n" widget (block+0x08) is showing. */
function equipFigure(mem, block) {
  const widget = mem.read32(block + 0x08) >>> 0;
  const line = widget + 0x5c;
  const length = mem.read16(line + 6);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(mem.read8(mem.read32(line) + i));
  return { bytes, visible: mem.read8(widget + 0xc1) };
}

/**
 * The stock list's highlighted item id. list+0x6BC is the flat row index and
 * list+0x6B4 the stock halfword table, read at `row * 2` (verify_shop_sell_paging
 * reads the same pair).
 */
function highlighted(mem, actor) {
  const list = mem.read32(mem.read32(actor + 0x24)) >>> 0;
  assert.ok(list, "the stock list is a live task");
  const stock = mem.read32(list + 0x6b4) >>> 0;
  return mem.read16(stock + mem.read32(list + 0x6bc) * 2);
}

test("the merchant band reads the stored worn byte, not a scan of the wearer record", () => {
  // Nobody in the party wears the Short Sword, but the block's second count array
  // says 2 — a switched-out partner still has it on. The original shows the byte
  // (stitshop.s:7310), so the figure is 2.
  const { session, actor, mem } = open({
    bits: 500000, inventory: [{ id: SHORT_SWORD, qty: 2 }],
    worn: [{ id: SHORT_SWORD, qty: 2 }],
    party: [{ rosterSlot: 0, starterSlot: 0 }],
  });
  session.tick([]);
  const { band, block } = bandBlock(mem, actor);
  assert.equal(mem.read32(band + 0x1e4), SHORT_SWORD, "the band shows the highlighted item");
  assert.deepEqual(equipFigure(mem, block).bytes, [DIGIT(2)],
    "Equip 2 comes from the block's second count array");
  assert.equal(equipFigure(mem, block).visible, 1);
});

test("the merchant's equip apply moves the worn byte and the wearer record together", () => {
  // Tenjimaru 93 is in the lead's left hand, so the slot picker answers RIGHT for
  // the Short Sword the shelf is highlighting (F0x8008C510) and the original's
  // equip apply writes the hand and the block's second count array in one call:
  // `sh` the halfword, `lbu 0x20f` / `addiu 1` / `sb 0x20f` the worn byte.
  const { session, actor, mem, buyAndEquip } = open({
    bits: 500000, inventory: [],
    worn: [{ id: TENJIMARU, qty: 1 }],
    party: [{ rosterSlot: 0, starterSlot: 0, equipment: { left: TENJIMARU } }],
  });
  const record = ROSTER_RECORDS + ROSTER_STRIDE * 0;
  assert.equal(mem.read16(record + ROSTER_EQUIP_OFFSETS.right), 0, "the right hand is free");
  assert.equal(mem.read16(record + ROSTER_EQUIP_OFFSETS.left), TENJIMARU, "Tenjimaru is on the left");
  assert.equal(mem.read8(SHOP_WORN_BASE + SHORT_SWORD), 0, "the Short Sword has nothing worn");
  assert.equal(highlighted(mem, actor), SHORT_SWORD, "the shelf opens on the Short Sword");

  buyAndEquip();

  assert.equal(mem.read16(record + ROSTER_EQUIP_OFFSETS.right), SHORT_SWORD,
    "the wearer record moves to the bought piece");
  assert.equal(mem.read16(record + ROSTER_EQUIP_OFFSETS.left), TENJIMARU, "the other hand is untouched");
  assert.equal(mem.read8(SHOP_WORN_BASE + SHORT_SWORD), 1,
    "and the bought piece's worn byte rises with it (stitshop 0x8008CA30)");
  assert.equal(mem.read8(SHOP_HELD_BASE + SHORT_SWORD), 0, "its copy left the bag");
  assert.equal(mem.read8(SHOP_WORN_BASE + TENJIMARU), 1, "the other hand keeps its count");
  assert.equal(mem.read8(SHOP_HELD_BASE + TENJIMARU), 0, "and nothing came back to the bag");
});

test("the band figure follows the equip instead of standing at the number the shop opened with", () => {
  const { session, actor, mem, buyAndEquip } = open({
    bits: 500000, inventory: [],
    worn: [{ id: TENJIMARU, qty: 1 }],
    party: [{ rosterSlot: 0, starterSlot: 0, equipment: { left: TENJIMARU } }],
  });
  const { block } = bandBlock(mem, actor);
  session.tick([]);
  assert.deepEqual(equipFigure(mem, block).bytes, [DIGIT(0)],
    "nothing wears the Short Sword yet");

  buyAndEquip();
  // Back on the stock list the band is filled again, and it reads the same block
  // the equip just wrote.
  assert.deepEqual(equipFigure(mem, block).bytes, [DIGIT(1)],
    "Equip 1 for a weapon the partner is now holding");
});
