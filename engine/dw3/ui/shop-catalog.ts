// Data-only merchant stock records for the translated shop list.
// The records and item-ID arrays are extracted from the original overlay;
// no code bytes or original instruction executor are installed.
import type { NativeMemory } from "../../native/memory.ts";
import { SHOP_STOCK_RECORDS } from "./shop-stock.ts";

export interface ShopCatalogRecord {
  shopId: number;
  recordAddress: number;
  itemsAddress: number;
  count: number;
  items: number[];
}

export interface ShopCatalogData {
  schema: number;
  module: string;
  recordBase: number;
  records: ShopCatalogRecord[];
  shopNames: { base: number; ids: number[] };
  uiTables: { base: number; bytes: number[]; sha256: string };
  inventoryDirectoryTable: number;
  inventoryDirectories: Array<{ category: number; address: number; items: number[] }>;
  itemRecords: { base: number; count: number; stride: number; file: string; sha256: string };
  itemDescriptors: Array<{ base: number; size: number; file: string; sha256: string }>;
  itemIconClips: { base: number; bytes: number[] };
  cursorGlyphs: { tableBase: number; tableBytes: number[]; stringsBase: number; stringBytes: number[] };
}

export const SHOP_INVENTORY_DIRECTORY_TABLE = 0x80042bc8;
export const SHOP_ITEM_RECORD_BASE = 0x80041838;
export const SHOP_ITEM_RECORD_COUNT = 403;
export const SHOP_ITEM_RECORD_STRIDE = 12;
export const SHOP_ITEM_ICON_CLIPS = 0x80042ba8;
export const SHOP_NAMES_BASE = 0x8008cb40;
export const SHOP_CURSOR_TABLE = 0x8004dce0;
export const SHOP_CURSOR_STRINGS = 0x8005ccd0;
export const SHOP_UI_TABLE_BASE = 0x8008caa8;
export const SHOP_DESCRIPTOR_RANGES = [
  { base: 0x80040244, size: 0x12d8, file: "shop_descriptors_main.bin" },
  { base: 0x8005cb54, size: 0x15c, file: "shop_descriptors_extra.bin" },
] as const;

/** Install the shop loader's exact data addresses into translated task memory. */
export function installShopCatalog(mem: NativeMemory, data: ShopCatalogData, itemRecords: Uint8Array,
                                   descriptors: readonly Uint8Array[]): void {
  if (data.schema !== 1 || data.module !== "pro/stitshop" ||
      data.recordBase !== SHOP_STOCK_RECORDS || data.records.length !== 31 ||
      data.shopNames.base !== SHOP_NAMES_BASE || data.shopNames.ids.length !== 30 ||
      data.uiTables.base !== SHOP_UI_TABLE_BASE || data.uiTables.bytes.length !== SHOP_NAMES_BASE - SHOP_UI_TABLE_BASE ||
      data.itemDescriptors.length !== SHOP_DESCRIPTOR_RANGES.length ||
      descriptors.length !== SHOP_DESCRIPTOR_RANGES.length ||
      data.inventoryDirectoryTable !== SHOP_INVENTORY_DIRECTORY_TABLE ||
      data.inventoryDirectories.length !== 5 ||
      data.itemRecords.base !== SHOP_ITEM_RECORD_BASE ||
      data.itemRecords.count !== SHOP_ITEM_RECORD_COUNT ||
      data.itemRecords.stride !== SHOP_ITEM_RECORD_STRIDE ||
      itemRecords.length !== SHOP_ITEM_RECORD_COUNT * SHOP_ITEM_RECORD_STRIDE ||
      data.itemIconClips.base !== SHOP_ITEM_ICON_CLIPS ||
      data.itemIconClips.bytes.length < 1 || data.itemIconClips.bytes.length > 256 ||
      data.cursorGlyphs.tableBase !== SHOP_CURSOR_TABLE ||
      data.cursorGlyphs.tableBytes.length !== 20 ||
      data.cursorGlyphs.stringsBase !== SHOP_CURSOR_STRINGS ||
      data.cursorGlyphs.stringBytes.length !== 16) {
    throw new Error("Invalid translated merchant catalog");
  }
  for (let id = 0; id < data.records.length; id++) {
    const row = data.records[id]!;
    if (row.shopId !== id || row.recordAddress !== SHOP_STOCK_RECORDS + id * 8 ||
        row.count !== row.items.length || row.count < 1 || row.count > 128 ||
        row.itemsAddress < 0x80082cb0 || row.itemsAddress >= SHOP_STOCK_RECORDS ||
        row.itemsAddress + row.count * 2 > SHOP_STOCK_RECORDS ||
        row.items.some((item) => !Number.isInteger(item) || item <= 0 || item > 0xffff)) {
      throw new Error(`Invalid merchant stock row ${id}`);
    }
    mem.write32(row.recordAddress, row.count);
    mem.write32(row.recordAddress + 4, row.itemsAddress);
    row.items.forEach((item, index) => mem.write16(row.itemsAddress + index * 2, item));
  }
  for (let id = 0; id < data.shopNames.ids.length; id++) {
    const name = data.shopNames.ids[id]!;
    if (!Number.isInteger(name) || name < 1 || name > 30) {
      throw new Error(`Invalid merchant name ${id}`);
    }
    mem.write32(SHOP_NAMES_BASE + id * 4, name);
  }
  for (let i = 0; i < data.uiTables.bytes.length; i++) {
    const value = data.uiTables.bytes[i]!;
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("Invalid shop UI table byte");
    mem.write8(SHOP_UI_TABLE_BASE + i, value);
  }
  if ([0, 1, 2, 3].some((index) => mem.read32(SHOP_UI_TABLE_BASE + index * 4) !== index + 1)) {
    throw new Error("Invalid shop category selector table");
  }
  installItemTables(mem, data, itemRecords, descriptors);
}

/** The item tables every translated screen that names items reads: the cursor glyphs, the
 *  five inventory directories, the item records, descriptor ranges and icon clips. */
export function installItemTables(mem: NativeMemory, data: ShopCatalogData, itemRecords: Uint8Array,
                                  descriptors: readonly Uint8Array[]): void {
  if (data.schema !== 1 ||
      data.itemDescriptors.length !== SHOP_DESCRIPTOR_RANGES.length ||
      descriptors.length !== SHOP_DESCRIPTOR_RANGES.length ||
      data.inventoryDirectoryTable !== SHOP_INVENTORY_DIRECTORY_TABLE ||
      data.inventoryDirectories.length !== 5 ||
      data.itemRecords.base !== SHOP_ITEM_RECORD_BASE ||
      data.itemRecords.count !== SHOP_ITEM_RECORD_COUNT ||
      data.itemRecords.stride !== SHOP_ITEM_RECORD_STRIDE ||
      itemRecords.length !== SHOP_ITEM_RECORD_COUNT * SHOP_ITEM_RECORD_STRIDE ||
      data.itemIconClips.base !== SHOP_ITEM_ICON_CLIPS ||
      data.itemIconClips.bytes.length < 1 || data.itemIconClips.bytes.length > 256 ||
      data.cursorGlyphs.tableBase !== SHOP_CURSOR_TABLE ||
      data.cursorGlyphs.tableBytes.length !== 20 ||
      data.cursorGlyphs.stringsBase !== SHOP_CURSOR_STRINGS ||
      data.cursorGlyphs.stringBytes.length !== 16) {
    throw new Error("Invalid translated item tables");
  }
  mem.load(Uint8Array.from(data.cursorGlyphs.tableBytes), SHOP_CURSOR_TABLE);
  mem.load(Uint8Array.from(data.cursorGlyphs.stringBytes), SHOP_CURSOR_STRINGS);
  for (let i = 0; i < 5; i++) {
    const ptr = mem.read32(SHOP_CURSOR_TABLE + i * 4) >>> 0;
    if (ptr < SHOP_CURSOR_STRINGS || ptr + 4 > SHOP_CURSOR_STRINGS + 16) {
      throw new Error(`Invalid shop cursor glyph pointer ${i}`);
    }
  }
  for (let category = 0; category < 5; category++) {
    const row = data.inventoryDirectories[category]!;
    if (row.category !== category || row.address < 0x80010000 ||
        row.address + (row.items.length + 1) * 2 > SHOP_INVENTORY_DIRECTORY_TABLE ||
        row.items.length > 512 ||
        row.items.some((item) => !Number.isInteger(item) || item <= 0 || item > 0xffff)) {
      throw new Error(`Invalid inventory directory ${category}`);
    }
    mem.write32(SHOP_INVENTORY_DIRECTORY_TABLE + category * 4, row.address);
    row.items.forEach((item, index) => mem.write16(row.address + index * 2, item));
    mem.write16(row.address + row.items.length * 2, 0);
  }
  mem.load(itemRecords, SHOP_ITEM_RECORD_BASE);
  for (let i = 0; i < SHOP_DESCRIPTOR_RANGES.length; i++) {
    const expected = SHOP_DESCRIPTOR_RANGES[i]!;
    const row = data.itemDescriptors[i]!;
    const bytes = descriptors[i]!;
    if (row.base !== expected.base || row.size !== expected.size ||
        row.file !== expected.file || bytes.length !== expected.size) {
      throw new Error(`Invalid shop descriptor range ${i}`);
    }
    mem.load(bytes, row.base);
  }
  for (let itemId = 1; itemId < SHOP_ITEM_RECORD_COUNT; itemId++) {
    const pointer = mem.read32(SHOP_ITEM_RECORD_BASE + itemId * SHOP_ITEM_RECORD_STRIDE) >>> 0;
    if (pointer && !SHOP_DESCRIPTOR_RANGES.some((row) =>
      pointer >= row.base && pointer + 14 <= row.base + row.size)) {
      throw new Error(`Unloaded shop item descriptor ${itemId}`);
    }
  }
  data.itemIconClips.bytes.forEach((clip, index) => {
    if (!Number.isInteger(clip) || clip < 0 || clip > 255) {
      throw new Error(`Invalid item icon clip ${index}`);
    }
    mem.write8(SHOP_ITEM_ICON_CLIPS + index, clip);
  });
}
