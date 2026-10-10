// engine/systems/shop-manager.ts
// Generic shop buy/sell logic, extracted from web/shop.js `_confirmPurchase`. DW3-free:
// currency + inventory mutation are injected, no item ids hardcoded. The UI (navigation,
// draw, qty selector, feedback) stays in web/shop.js.
//
// Sell value: the decoded DW3 item table (item-data.ts / equipment.ts) carries a real
// per-item sell price — usually floor(price/2), but NOT always (unbuyable items like
// TrainChips have price 0 and a nonzero sell value). When `sell` is present it wins;
// otherwise floor(price * sellRatio) is the fallback (sellRatio 0.5 = the old rule).

// Money ceiling: the original stops the player's money at 9,999,999. Both shops
// clamp on the way up — the item shop's sale path and the exe's money grant both
// write the cap back when the sum passes it (SCREEN-OBJECT-NAME-AUDIT-001;
// docs/generated/bounds.md:69). Selling into a full wallet therefore yields the
// cap, not an overflow.
export const MONEY_CAP = 9999999;

export interface ShopItem { id: number; price: number; sell?: number; }

export interface ShopDeps {
  getGold: () => number;
  setGold: (n: number) => void;
  addItem: (id: number, n: number) => void;
  removeItem: (id: number, n: number) => void;
}

export interface ShopManager {
  buyCost(item: ShopItem, qty: number): number;
  sellGain(item: ShopItem, qty: number, sellRatio: number): number;
  canBuy(item: ShopItem, qty: number): boolean;
  buy(item: ShopItem, qty: number): boolean;
  sell(item: ShopItem, qty: number, sellRatio: number): boolean;
}

export function createShopManager(deps: ShopDeps): ShopManager {
  const buyCost = (item: ShopItem, qty: number) => item.price * qty;
  const sellGain = (item: ShopItem, qty: number, sellRatio: number) =>
    (item.sell ?? Math.floor(item.price * sellRatio)) * qty;

  const canBuy = (item: ShopItem, qty: number) => deps.getGold() >= buyCost(item, qty);

  function buy(item: ShopItem, qty: number): boolean {
    const cost = buyCost(item, qty);
    if (deps.getGold() < cost) return false;
    deps.setGold(deps.getGold() - cost);
    deps.addItem(item.id, qty);
    return true;
  }

  function sell(item: ShopItem, qty: number, sellRatio: number): boolean {
    if (qty <= 0) return false;
    const gain = sellGain(item, qty, sellRatio);
    deps.setGold(Math.min(deps.getGold() + gain, MONEY_CAP));
    deps.removeItem(item.id, qty);
    return true;
  }

  return { buyCost, sellGain, canBuy, buy, sell };
}
