// Card packs are resident consumable items, not a second inventory.
// See docs/research/items/item-store-shared-system-2026-10-03.md.
import { heldCount, setHeldCount, type ItemStoreState } from '../item-store.ts';
import type { CardCollection } from '../../systems/card-battle.ts';

class CardPackStore extends Map<number, number> {
  readonly state: ItemStoreState;
  readonly ids: readonly number[];
  constructor(state: ItemStoreState, ids: readonly number[]) {
    super(); this.state = state; this.ids = [...new Set(ids)];
  }
  override get(id: number): number | undefined {
    return this.ids.includes(id) ? heldCount(this.state, id) : undefined;
  }
  override set(id: number, count: number): this {
    if (!this.ids.includes(id)) throw new Error(`Not a decoded booster item: ${id}`);
    setHeldCount(this.state, id, count, heldCount(this.state, id)); return this;
  }
  override has(id: number): boolean { return (this.get(id) ?? 0) > 0; }
  override delete(id: number): boolean { const had = this.has(id); if (had) this.set(id, 0); return had; }
  override clear(): void { for (const id of this.ids) this.set(id, 0); }
  private snapshot(): Map<number, number> {
    return new Map(this.ids.filter((id) => this.has(id)).map((id) => [id, this.get(id)!]));
  }
  override get size(): number { return this.snapshot().size; }
  override entries() { return this.snapshot().entries(); }
  override keys() { return this.snapshot().keys(); }
  override values() { return this.snapshot().values(); }
  override [Symbol.iterator]() { return this.entries(); }
  override forEach(callback: (value: number, key: number, map: Map<number, number>) => void, thisArg?: unknown): void {
    for (const [id, count] of this) callback.call(thisArg, count, id, this);
  }
}

export function bindCardPacks(collection: CardCollection, state: ItemStoreState, ids: readonly number[]): void {
  if (collection.packs instanceof CardPackStore && collection.packs.state === state) return;
  const legacy = [...collection.packs];
  collection.packs = new CardPackStore(state, ids);
  // Browser save migration only: preserve old separate-pack saves when the bag
  // has no count. Never add two representations of the same saved pack together.
  for (const [id, count] of legacy) {
    if (ids.includes(id) && heldCount(state, id) === 0) collection.packs.set(id, count);
  }
}

export function cardPackInventory(collection: CardCollection) {
  return collection.packs instanceof CardPackStore ? collection.packs.state.inventory : undefined;
}
