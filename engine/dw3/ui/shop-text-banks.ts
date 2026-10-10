// Data-only resource installation for the translated merchant screen. These
// are the four indexed string families the root, list and detail panel read.
import type { NativeMemory } from "../../native/memory.ts";
import { fetchTableEntry } from "./fetch-table.ts";

export const SHOP_TEXT_BANK_BASE = 0x801e0000;
export const SHOP_TEXT_BANK_OFFSETS = [0x63, 0x6a, 0x71, 0x94] as const;

export class ShopTextBanks {
  readonly sources = new Map<number, number>();
  constructor(mem: NativeMemory, language: number, banks: ReadonlyMap<number, Uint8Array>) {
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid shop language");
    let address = SHOP_TEXT_BANK_BASE;
    for (const offset of SHOP_TEXT_BANK_OFFSETS) {
      const id = offset + language;
      const data = banks.get(id);
      if (!data) throw new Error(`Missing shop text bank ${id}`);
      if (data.length < 8 || address + data.length > 0x80200000) throw new Error(`Invalid shop text bank ${id}`);
      mem.load(data, address);
      this.sources.set(id, address);
      address = ((address + data.length + 7) & ~7) >>> 0;
    }
  }

  source(id: number): number {
    const address = this.sources.get(id);
    if (address === undefined) throw new Error(`Unloaded shop text bank ${id}`);
    return address;
  }

  stringById(mem: NativeMemory, source: number, index: number): number {
    if (![...this.sources.values()].includes(source)) throw new Error("Unknown shop text source");
    return fetchTableEntry(mem, source, index);
  }
}
