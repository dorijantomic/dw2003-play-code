import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NativeMemory } from "../engine/native/memory.ts";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { installShopCatalog } from "../engine/dw3/ui/shop-catalog.ts";
import { enumerateShopInventory, SHOP_INVENTORY_SAVE } from "../engine/dw3/ui/shop-inventory.ts";

const catalog = JSON.parse(readFileSync(new URL("../web/assets/data/shop_catalog.json", import.meta.url), "utf8"));
const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const overlay = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_stitshop.bin", import.meta.url)));
const itemRecords = new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url)));
const descriptors = catalog.itemDescriptors.map((row) =>
  new Uint8Array(readFileSync(new URL(`../web/assets/data/${row.file}`, import.meta.url))));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const services = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
const DEST_A = 0x80190000;
const DEST_B = 0x80191000;

test("resident inventory collector and translated SELL provider return the same ordered IDs", () => {
  const rt = new NativeStageRuntime(overlay, entry, services, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  const mem = new NativeMemory();
  installShopCatalog(mem, catalog, itemRecords, descriptors);
  assert.equal(createHash("sha256").update(itemRecords).digest("hex"), catalog.itemRecords.sha256);
  assert.deepEqual(itemRecords, resident.slice(catalog.itemRecords.base - 0x80010000,
    catalog.itemRecords.base - 0x80010000 + itemRecords.length));
  for (let i = 0; i < descriptors.length; i++) {
    const row = catalog.itemDescriptors[i];
    assert.equal(createHash("sha256").update(descriptors[i]).digest("hex"), row.sha256);
    assert.deepEqual(descriptors[i], resident.slice(row.base - 0x80010000,
      row.base - 0x80010000 + row.size));
  }
  for (let i = 0; i < catalog.uiTables.bytes.length; i++) {
    const address = catalog.uiTables.base + i;
    assert.equal(mem.read8(address), rt.mem.read8(address), `shop UI table byte ${i}`);
  }
  for (const [base, bytes] of [
    [catalog.cursorGlyphs.tableBase, catalog.cursorGlyphs.tableBytes],
    [catalog.cursorGlyphs.stringsBase, catalog.cursorGlyphs.stringBytes],
  ]) {
    for (let i = 0; i < bytes.length; i++) {
      assert.equal(mem.read8(base + i), rt.mem.read8(base + i), `cursor glyph byte ${i}`);
    }
  }
  for (const row of catalog.inventoryDirectories) {
    assert.equal(mem.read32(catalog.inventoryDirectoryTable + row.category * 4) >>> 0,
      rt.mem.read32(catalog.inventoryDirectoryTable + row.category * 4) >>> 0);
    for (let i = 0; i <= row.items.length; i++) {
      assert.equal(mem.read16(row.address + i * 2), rt.mem.read16(row.address + i * 2));
    }
  }
  for (const [id, held, worn] of [[43, 1, 0], [44, 0, 1], [45, 2, 0], [92, 1, 0], [292, 0, 2]]) {
    rt.mem.write8(SHOP_INVENTORY_SAVE + 0x7c + id, held);
    rt.mem.write8(SHOP_INVENTORY_SAVE + 0x20f + id, worn);
    mem.write8(SHOP_INVENTORY_SAVE + 0x7c + id, held);
    mem.write8(SHOP_INVENTORY_SAVE + 0x20f + id, worn);
  }
  for (const category of [0, 1, 2, 3, 4, 5, -1, -2147483647, -2147483644]) {
    rt.cpu.call(0x800135e8, [category, DEST_A]);
    const originalCount = rt.cpu.reg(2) | 0;
    const translatedCount = enumerateShopInventory(mem, category, DEST_B);
    assert.equal(translatedCount, originalCount, `category ${category} count`);
    assert.deepEqual(Array.from({ length: translatedCount }, (_, i) => mem.read16(DEST_B + i * 2)),
      Array.from({ length: originalCount }, (_, i) => rt.mem.read16(DEST_A + i * 2)),
      `category ${category} item order`);
  }
});
