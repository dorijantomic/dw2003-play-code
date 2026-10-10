// BUY controller branches from stitshop F0x80083eb0. These decisions use
// original item counts and prices; screen animation remains in the host.

export type ShopBuyRefusal = "too-many" | "not-enough" | null;

/** State 3: a full bag wins over the affordability check. */
export function shopBuyRefusal(held: number, bits: number, price: number): ShopBuyRefusal {
  if (held === 99) return "too-many";
  if (bits < price) return "not-enough";
  return null;
}

/** State 5: price zero uses divisor one; room and affordability cap the spinner. */
export function shopBuyQuantityCeiling(held: number, bits: number, price: number): number {
  const affordable = Math.trunc(bits / (price || 1));
  return Math.min(affordable, 99 - held);
}

/** State 17: the accepted quantity saturates the bag at 99 and costs price × qty. */
export function shopBuyCommit(held: number, bits: number, price: number, qty: number): {
  held: number;
  bits: number;
} {
  return { held: Math.min(99, held + qty), bits: bits - price * qty };
}

/** State 40: after the Equipped. message, a spent last copy exits to the list. */
export function shopBuyAfterEquip(held: number): "list" | "equipwho" {
  return held <= 0 ? "list" : "equipwho";
}
