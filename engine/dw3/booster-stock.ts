// Booster set ids are item ids: stcrdshp.s:2129 and cardgame.s:33089
// read the SAME carried byte (save + 0x7c + setId). Keep the card API's
// Map-shaped interface as a live view of the shared item store.
import { heldCount, setHeldCount, type ItemStoreState } from './item-store.ts';
import type { CardCollection } from '../systems/card-battle.ts';

class BoosterStock extends Map<number, number> {
  private state: ItemStoreState;
  private ids: readonly number[];
  constructor(state: ItemStoreState, ids: readonly number[]) { super(); this.state = state; this.ids = ids; }
  override get(id: number): number | undefined { return this.ids.includes(id) ? heldCount(this.state, id) : undefined; }
  override has(id: number): boolean { return (this.get(id) ?? 0) > 0; }
  override set(id: number, count: number): this {
    if (!this.ids.includes(id)) throw new RangeError(`Unknown booster item ${id}`);
    setHeldCount(this.state, id, count, heldCount(this.state, id));
    return this;
  }
  override delete(id: number): boolean { const had = this.has(id); if (this.ids.includes(id)) setHeldCount(this.state, id, 0, heldCount(this.state, id)); return had; }
  override clear(): void { for (const id of this.ids) setHeldCount(this.state, id, 0, heldCount(this.state, id)); }
  override get size(): number { return this.ids.filter(id => this.has(id)).length; }
  override *entries(): MapIterator<[number, number]> { for (const id of this.ids) if (this.has(id)) yield [id, this.get(id)!]; }
  override *keys(): MapIterator<number> { for (const [id] of this.entries()) yield id; }
  override *values(): MapIterator<number> { for (const [, count] of this.entries()) yield count; }
  override [Symbol.iterator](): MapIterator<[number, number]> { return this.entries(); }
  override forEach(callback: (value: number, key: number, map: Map<number, number>) => void, thisArg?: unknown): void {
    for (const [id, count] of this.entries()) callback.call(thisArg, count, id, this);
  }
}

/** Bind all members of the decoded set table. Old browser saves kept duel
 * rewards separately; migrate those once, taking the larger count when both
 * representations have stock. Subsequent reads/writes address only the bag. */
export function bindBoosterStock(col: CardCollection, state: ItemStoreState, ids: readonly number[]): void {
  if (col.packs instanceof BoosterStock) return;
  for (const [id, count] of col.packs) {
    if (ids.includes(id)) setHeldCount(state, id, Math.max(heldCount(state, id), count), heldCount(state, id));
  }
  col.packs = new BoosterStock(state, ids);
}

export const BOOSTER_HELD_BASE = 0x80048db0;
/** Adapters seed and commit only booster members, leaving other carried items
 * to their owning screen. Original execution remains a reference route. */
export function seedBoosterStock(state: ItemStoreState, ids: readonly number[], write: (address: number, value: number, size: number) => void): void {
  for (const id of ids) write(BOOSTER_HELD_BASE + id, heldCount(state, id), 1);
}
export function commitBoosterStock(state: ItemStoreState, ids: readonly number[], read: (address: number, size: number) => number): void {
  for (const id of ids) setHeldCount(state, id, read(BOOSTER_HELD_BASE + id, 1), heldCount(state, id));
}
