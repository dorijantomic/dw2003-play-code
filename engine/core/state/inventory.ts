import type { InventoryReader } from "../types.ts";

export class Inventory implements InventoryReader {
  private items = new Map<number, number>();

  has(id: number, count = 1): boolean {
    return (this.items.get(id) ?? 0) >= count;
  }

  /**
   * Add n of id. The original's bag count is a single byte clamped to [0,99]
   * (F0x800161d8; claim items-stack-quantity-cap-99-floor-0-2026-08-04): a grant
   * at 99 adds internally and re-clamps silently, with no rejection message.
   */
  add(id: number, n = 1): void {
    this.items.set(id, Math.min(99, (this.items.get(id) ?? 0) + n));
  }

  remove(id: number, n = 1): void {
    const v = (this.items.get(id) ?? 0) - n;
    if (v > 0) this.items.set(id, v);
    else this.items.delete(id);
  }

  toJSON(): [number, number][] {
    return [...this.items];
  }

  load(rows: [number, number][]): void {
    this.items = new Map(rows);
  }
}
