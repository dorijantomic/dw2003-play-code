// What the walker's own state keeps when the merchant closes, in the original's
// order: the screen's WEAR changes first, then the bag the screen's own count
// arrays hold.
//
// The merchant is handed the save block and writes the two arrays itself
// (`docs/research/items/item-store-shared-system-2026-10-03.md` §6: the stitshop
// BUY commit, the SELL commit and the hand swap all index `base + 0x7C + id` and
// `base + 0x20F + id` directly — there is no resident commit routine). So on close
// the block is the authority for the bag, and each swap the screen performed is
// replayed into the shared store so the WORNED byte and the wearer record move
// together.
//
// Replaying the swap is not optional bookkeeping. The block's byte is the number
// the band under the list draws, and it is written ONCE per piece: stitshop
// F0x8008C800 raises `worn` a single time at 0x8008CA30 and then writes BOTH hand
// halfwords for a two-handed piece (0x8008CAB4 with 0x8008CABC in the delay slot).
// Re-deriving the change by diffing the six slots instead — walking them and
// calling the equip move per slot — raises it twice, and re-applies the bag moves
// the block already contains, so a sword that came off a hand ends up in the bag
// twice. `commitEquipEvent` is the store's one writer for that pair (0x8008C92C and
// 0x8008CA10): it writes the slot map the swap produced and moves the worn byte
// once per piece that left or joined the record.
import { commitEquipEvent, reconcileHeldCounts, type ItemStoreState } from "../item-store.ts";
import type { ShopSaveResult } from "./shop-save-state.ts";

/** The walker's state plus the wallet the merchant owns. */
export interface MerchantCloseState extends ItemStoreState {
  bits?: number;
}

/**
 * Apply one merchant session to the walker's state. The order matters: the swaps
 * move the worn byte and the wearer record, and the bag is then set to the counts
 * the screen's own block holds, which already include those swaps.
 */
export function commitMerchantClose(state: MerchantCloseState, result: ShopSaveResult): void {
  state.bits = result.bits;
  for (const swap of result.swaps) {
    commitEquipEvent(state, swap.party, swap.equipment);
  }
  reconcileHeldCounts(state, result.inventory);
}