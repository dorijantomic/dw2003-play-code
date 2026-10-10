import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeMemory } from "../engine/native/memory.ts";
import { seedShopSaveState, SHOP_WORN_BASE } from "../engine/dw3/ui/shop-save-state.ts";
import { EQUIPMENT_BY_ID } from "../engine/dw3/equipment.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url));
const catalog = JSON.parse(read("web/assets/data/shop_catalog.json"));
const image = read("web/assets/native/screens/pro_stitshop.bin");
const records = read(`web/assets/data/${catalog.itemRecords.file}`);
const descriptors = catalog.itemDescriptors.map((row) => ({ ...row,
  bytes: read(`web/assets/data/${row.file}`) }));

// A census, not a sample: the dispatch tables bound the parent machines,
// and the item-record pointers bound the two-hand family. Reference bytes are
// read only by this test; the production screen loads data-only resources.
test("merchant controller, stock and two-hand seed populations equal the disc populations", () => {
  for (const [file, offset, count] of [
    ["shop-buy-machine.ts", 0, 51],
    ["shop-sell-machine.ts", 0xd0, 204],
    ["shop-root-machine.ts", 0x4e8, 24],
  ]) {
    const targets = Array.from({ length: count }, (_, state) => image.readUInt32LE(offset + state * 4));
    const defaultTarget = targets[0];
    const decoded = targets.flatMap((target, state) => target === defaultTarget ? [] : [state]);
    const source = read(`engine/dw3/ui/${file}`).toString();
    const implemented = [...source.matchAll(/case\s+(0x[\da-f]+|\d+)\s*:/gi)]
      .map((m) => Number(m[1])).sort((a, b) => a - b);
    assert.deepEqual(implemented, decoded, file);
  }
  // Read the stock directory, including the 31st non-launchable data record.
  const stockOffset = catalog.recordBase - 0x80082cb0;
  // The directory ends at the adjacent shop-service table (§5 of
  // docs/research/ui/shop-system-decompiled.md). Do not infer the population
  // from the JSON's length: that would let a dropped row disappear unnoticed.
  const stockCount = (0x8008d1ac - catalog.recordBase) / 8;
  assert.equal(catalog.records.length, stockCount);
  for (let index = 0; index < stockCount; index++) {
    const count = image.readUInt32LE(stockOffset + index * 8);
    const pointer = image.readUInt32LE(stockOffset + index * 8 + 4);
    const decoded = Array.from({ length: count }, (_, n) => image.readUInt16LE(pointer - 0x80082cb0 + n * 2));
    assert.deepEqual(catalog.records[index].items, decoded, `stock ${index}`);
  }
  const cardImage = read("web/assets/native/screens/pro_stcrdshp.bin");
  const cardShops = JSON.parse(read("web/assets/data/card_shops.json")).shops;
  const decodedCardShops = [];
  // Zero-terminated card-id arrays and a -1 shop-id sentinel, as F0x80089160
  // scans them. Derive the full population rather than repeating 24 ids.
  for (let offset = 0x8008cdd4 - 0x80082cb0; cardImage.readInt32LE(offset) !== -1; offset += 12) {
    const shopId = cardImage.readUInt32LE(offset);
    const ids = [];
    for (let cursor = cardImage.readUInt32LE(offset + 8) - 0x80082cb0;
      cardImage.readUInt16LE(cursor) !== 0; cursor += 2) ids.push(cardImage.readUInt16LE(cursor));
    decodedCardShops.push({ shopId, ids });
  }
  assert.deepEqual(cardShops.map((row) => ({ shopId: row.shopId, ids: row.cardIds })), decodedCardShops,
    "card-shop consumers receive the complete decoded stock population");
  const twoHand = [];
  for (let id = 1; id < catalog.itemRecords.count; id++) {
    const pointer = records.readUInt32LE(id * catalog.itemRecords.stride);
    const range = descriptors.find((row) => pointer >= row.base && pointer + 3 <= row.base + row.size);
    if (range && range.bytes[pointer - range.base + 2] === 7) twoHand.push(id);
  }
  const engineFamily = Object.values(EQUIPMENT_BY_ID)
    .filter((row) => row.statBytes?.[2] === 7).map((row) => row.itemId ?? row.id).sort((a, b) => a - b);
  assert.ok(twoHand.length > 0, "raw descriptors found the family");
  assert.deepEqual(engineFamily, twoHand, "engine includes the complete raw two-hand family");
  for (const id of twoHand) {
    const mem = new NativeMemory();
    seedShopSaveState(mem, { bits: 10000, inventory: [], party: [0, 1, 2].map((rosterSlot) => ({
      rosterSlot, equipment: { right: id, left: id },
    })) });
    assert.equal(mem.read8(SHOP_WORN_BASE + id), 3, `three partners, three worn copies of ${id}`);
    seedShopSaveState(mem, { bits: 10000, inventory: [], worn: [{ id, qty: 4 }], party: [
      { rosterSlot: 0, equipment: { right: id, left: id } },
    ] });
    assert.equal(mem.read8(SHOP_WORN_BASE + id), 4, `stored count includes reserve partner for ${id}`);
  }
});
