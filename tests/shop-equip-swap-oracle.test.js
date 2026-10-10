// Compare the shop's slot picker and slot writes with the original overlay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { NativeMemory } from "../engine/native/memory.ts";
import { EQUIPMENT_BY_ID, shopEquipSlot, shopEquipSwap } from "../engine/dw3/equipment.ts";
import * as shopSave from "../engine/dw3/ui/shop-save-state.ts";
const { SHOP_HELD_BASE, SHOP_WORN_BASE } = shopSave;

const screens = "web/assets/native/screens/";
const resident = new Uint8Array(readFileSync(`${screens}resident.bin`));
const shop = new Uint8Array(readFileSync(`${screens}pro_stitshop.bin`));
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
const MEMBER = 0x80180000;
const RECORDS = 0x80190000;
const STATS = 0x801a0000;
const ITEM_STUB = 0x0fd40000;
const MEMBER_STUB = 0x0fd40010;
const slots = ["head", "body", "right", "left", "acc0", "acc1"];

function runtime() {
  const rt = new NativeStageRuntime(shop, entry, host, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  rt.mem.write32(0x80042b98, ITEM_STUB);
  rt.mem.write32(0x8004b484, MEMBER_STUB);
  rt.cpu.setStub(ITEM_STUB, (cpu) => RECORDS + (cpu.reg(4) & 0xffff) * 16);
  rt.cpu.setStub(MEMBER_STUB, () => MEMBER);
  for (const item of Object.values(EQUIPMENT_BY_ID)) {
    const record = RECORDS + item.id * 16;
    const stat = STATS + item.id * 32;
    rt.mem.write32(record, stat);
    rt.mem.write8(record + 9, item.family);
    for (let i = 0; i < item.statBytes.length; i++) rt.mem.write8(stat + i, item.statBytes[i]);
  }
  return rt;
}

function install(rt, equipment) {
  for (const [i, slot] of slots.entries()) rt.mem.write16(MEMBER + 0x3c0 + i * 2, equipment[slot] ?? 0);
}

function readSlots(rt) {
  const out = {};
  for (const [i, slot] of slots.entries()) {
    const id = rt.mem.read16(MEMBER + 0x3c0 + i * 2);
    if (id) out[slot] = id;
  }
  return out;
}

/** Wearer record -> bought item: real swaps, two-handed pieces and accessories. */
const cases = [
  [{}, 92],
  [{ right: 92 }, 93],
  [{ right: 92, left: 93 }, 94],
  [{ right: 92, left: 275 }, 176],
  [{ right: 176, left: 176 }, 177],
  [{ acc0: 292 }, 293],
  [{ acc0: 292, acc1: 293 }, 300],
  [{ acc0: 323, acc1: 317 }, 324],
  [{ acc0: 323, acc1: 324 }, 324],
];

test("shop slot choice and swap writes match the original", () => {
  const rt = runtime();
  for (const [equipment, itemId] of cases) {
    install(rt, equipment);
    const originalSlot = rt.cpu.call(0x8008c510, [0, itemId]) | 0;
    const expectedSlot = shopEquipSlot(equipment, itemId);
    assert.equal(originalSlot, slots.indexOf(expectedSlot), `choose ${itemId} from ${JSON.stringify(equipment)}`);
    const swap = shopEquipSwap(equipment, itemId);
    assert.ok(swap);
    rt.cpu.call(0x8008c800, [0, originalSlot, itemId, 0]);
    assert.deepEqual(readSlots(rt), swap.equipment, `wear ${itemId} from ${JSON.stringify(equipment)}`);

    // The transfer flag also moves one bag count for each displaced piece.
    install(rt, equipment);
    const oldPieces = Object.values(equipment);
    if (equipment.right === equipment.left &&
        EQUIPMENT_BY_ID[equipment.right]?.statBytes?.[2] === 7) oldPieces.pop();
    const ids = new Set([...oldPieces, itemId]);
    for (const id of ids) {
      rt.mem.write8(0x80048d34 + 0x7c + id, id === itemId ? 5 : 1);
      rt.mem.write8(0x80048d34 + 0x20f + id, oldPieces.filter(piece => piece === id).length);
    }
    rt.cpu.call(0x8008c800, [0, originalSlot, itemId, 1]);
    assert.deepEqual(readSlots(rt), swap.equipment, `transfer wear ${itemId}`);
    for (const id of ids) {
      const displaced = swap.displaced.filter(piece => piece === id).length;
      const held = ((id === itemId ? 5 : 1) + displaced - (id === itemId ? 1 : 0)) & 0xff;
      const worn = (oldPieces.filter(piece => piece === id).length - displaced + (id === itemId ? 1 : 0)) & 0xff;
      assert.equal(rt.mem.read8(0x80048d34 + 0x7c + id), held, `bag ${id} after ${itemId}`);
      assert.equal(rt.mem.read8(0x80048d34 + 0x20f + id), worn, `worn ${id} after ${itemId}`);
    }
  }

  install(rt, { right: 92 });
  rt.mem.write8(0x80048d34 + 0x7c + 92, 99);
  rt.mem.write8(0x80048d34 + 0x20f + 92, 1);
  rt.mem.write8(0x80048d34 + 0x7c + 176, 1);
  rt.mem.write8(0x80048d34 + 0x20f + 176, 0);
  rt.cpu.call(0x8008c800, [0, 2, 176, 1]);
  assert.equal(rt.mem.read8(0x80048d34 + 0x7c + 92), 100,
    "returning worn gear at 99 held follows the original 8-bit increment");
});

// The merchant's hand swap moves a copy between the block's TWO count arrays, and
// the merchant's info band reads the second one for its "Equip n" figure
// (stitshop.s:7310). These two helpers are that move, so they are compared with
// the original's own bytes over the same table the swap above uses — including
// the two-handed and accessory arms, which write the counts from their own sites
// (stitshop.s:10052-10084, 10104-10118).
test("the ported block moves write the same two count bytes as the original", () => {
  const { shopBlockEquip, shopBlockUnequip } = shopSave;
  for (const [equipment, itemId] of cases) {
    const swap = shopEquipSwap(equipment, itemId);
    assert.ok(swap, `swap ${itemId} from ${JSON.stringify(equipment)}`);
    const oldPieces = Object.values(equipment);
    if (equipment.right === equipment.left &&
        EQUIPMENT_BY_ID[equipment.right]?.statBytes?.[2] === 7) oldPieces.pop();
    const ids = [...new Set([...oldPieces, itemId])];

    // The original, run for real.
    const rt = runtime();
    install(rt, equipment);
    for (const id of ids) {
      rt.mem.write8(0x80048d34 + 0x7c + id, id === itemId ? 5 : 1);
      rt.mem.write8(0x80048d34 + 0x20f + id, oldPieces.filter((piece) => piece === id).length);
    }
    const slot = rt.cpu.call(0x8008c510, [0, itemId]) | 0;
    rt.cpu.call(0x8008c800, [0, slot, itemId, 1]);
    const original = ids.map((id) => ({
      held: rt.mem.read8(0x80048d34 + 0x7c + id),
      worn: rt.mem.read8(0x80048d34 + 0x20f + id),
    }));

    // The port, over the same starting bytes.
    const mem = new NativeMemory();
    for (const id of ids) {
      mem.write8(SHOP_HELD_BASE + id, id === itemId ? 5 : 1);
      mem.write8(SHOP_WORN_BASE + id, oldPieces.filter((piece) => piece === id).length);
    }
    for (const displaced of swap.displaced) shopBlockUnequip(mem, displaced);
    shopBlockEquip(mem, itemId);
    const ported = ids.map((id) => ({
      held: mem.read8(SHOP_HELD_BASE + id),
      worn: mem.read8(SHOP_WORN_BASE + id),
    }));
    assert.deepEqual(ported, original, `count arrays after ${itemId} onto ${JSON.stringify(equipment)}`);
  }
});
