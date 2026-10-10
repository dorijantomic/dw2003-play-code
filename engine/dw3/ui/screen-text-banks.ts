// Data-only installation of a screen's indexed text families, the way the
// merchant's are (shop-text-banks.ts): each bank is a count, an offset table
// and NUL-terminated strings, loaded once where the screen reads it.
import type { NativeMemory } from "../../native/memory.ts";
import { fetchTableEntry } from "./fetch-table.ts";

export const SCREEN_TEXT_BANK_BASE = 0x801e0000;

export class ScreenTextBanks {
  readonly sources = new Map<number, number>();
  constructor(mem: NativeMemory, language: number, offsets: readonly number[],
              banks: ReadonlyMap<number, Uint8Array>, label: string) {
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error(`Invalid ${label} language`);
    let address = SCREEN_TEXT_BANK_BASE;
    for (const offset of offsets) {
      const id = offset + language;
      const data = banks.get(id);
      if (!data) throw new Error(`Missing ${label} text bank ${id}`);
      if (data.length < 8 || address + data.length > 0x80200000) throw new Error(`Invalid ${label} text bank ${id}`);
      mem.load(data, address);
      this.sources.set(id, address);
      address = ((address + data.length + 7) & ~7) >>> 0;
    }
  }

  source(id: number): number {
    const address = this.sources.get(id);
    if (address === undefined) throw new Error(`Unloaded text bank ${id}`);
    return address;
  }

  stringById(mem: NativeMemory, source: number, index: number): number {
    if (![...this.sources.values()].includes(source)) throw new Error("Unknown text source");
    return fetchTableEntry(mem, source, index);
  }
}
