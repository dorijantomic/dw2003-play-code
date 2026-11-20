// web/bit-ledger.js — the whole economy of Digimon World 3 in the disc's own
// numbers, with nothing hand-typed:
//   * the wallet ceiling: MONEY_CAP is 0x98967F = 9,999,999, the stop the shop
//     manager's sale path and the exe's money grant both write back
//     (engine/systems/shop-manager.ts:16, docs/generated/bounds.md:69);
//   * what fights pay — battle_rewards[screen] = [dvexp, exp, bits] from
//     web/assets/data/progression.json (stfgtrep 0x80086a88). Only the bits
//     column is ever read here; ranking fights by experience is another page's
//     job, so the exp and dvexp columns are not even looked at;
//   * what people hand over — the 17 bank-0x70 money grants;
//   * what each of the 31 shops charges at most — the dearest stock, priced out
//     of the item table's own buy column;
//   * what a bed costs in each of the 21 inns — the record's price per Digimon;
//   * the sell shelf: every piece with no shop price but a real sell price, so a
//     shop never sells it and still pays for it.
//
// Pure: no page, no storage, no network. The page (web/bit-ledger.html) hands it
// the shipped tables; tests/bit-ledger.test.js pins every figure to the files and
// the cap to the engine's constant.
//
// Five rows of battle_rewards pay 0 BIT — row 0 is the table's own empty filler,
// the other four are screen ids with no reward — so the payout spread is taken
// over the 330 rows that actually pay. A 0 BIT "payout" is not a payout.

/** The wallet ceiling, in the disc's own hex: 0x98967F = 9,999,999 BIT. */
export const MONEY_CAP = 0x98967f;

const whole = (v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/** The rows behind `{ items: [...] }`, a bare array, or nothing. */
function tableRows(data, key) {
    if (Array.isArray(data)) return data;
    return data && Array.isArray(data[key]) ? data[key] : [];
}

/**
 * The payout spread over the bits column of [dvexp, exp, bits] rows:
 *   count   how many screen ids pay anything (0 BIT rows are not fights)
 *   min     the lowest real payout
 *   median  the middle payout (mean of the two middle ones on an even count)
 *   max     the highest payout
 *   top20   the twenty best, dearest first, ties by screen id:
 *           { screen, bits }
 */
export function payoutStats(rewards) {
    const paid = [];
    tableRows(rewards, "battle_rewards").forEach((row, screen) => {
        const bits = Array.isArray(row) ? whole(row[2]) : whole(row && row.bits);
        if (bits > 0) paid.push({ screen, bits });
    });
    const sorted = paid.map((r) => r.bits).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = !sorted.length ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
        count: paid.length,
        min: sorted.length ? sorted[0] : 0,
        median,
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        top20: paid.slice().sort((a, b) => b.bits - a.bits || a.screen - b.screen).slice(0, 20),
    };
}

/**
 * The NPC money grants, dearest first:
 *   { count, total, list: [{ stage, npcId, amount }] }
 * The stage is the map id the grant's own row names (s206, s218, ...); the amount
 * is the row's own amount. Nothing here is summed into the wallet — the ledger
 * only reports what the table holds.
 */
export function grants(rows) {
    const list = tableRows(rows, "grants")
        .map((r) => ({
            stage: String(r && r.stage != null ? r.stage : ""),
            npcId: whole(r && r.npc_id),
            amount: whole(r && r.amount),
        }))
        .sort((a, b) => b.amount - a.amount || a.stage.localeCompare(b.stage));
    return { count: list.length, total: list.reduce((sum, r) => sum + r.amount, 0), list };
}

/**
 * The dearest piece of stock in every shop, priced from the item table's buy
 * column, dearest shop first:
 *   { shopId, shop, stock, priced, id, name, price }
 * `stock` is how many kinds the shop lists and `priced` how many of them carry a
 * price. A shop whose whole stock has no price (the disc's unopened shop 30) gets
 * price 0 and a null item rather than an invented figure.
 */
export function shopPrices(shops, effects) {
    const price = new Map();
    for (const r of tableRows(effects, "items")) price.set(Number(r.id), whole(r.buy));
    const list = tableRows(shops, "shops").map((shop) => {
        const stock = Array.isArray(shop.items) ? shop.items : [];
        let best = null;
        let priced = 0;
        for (const it of stock) {
            const p = price.get(Number(it.id)) || 0;
            if (p <= 0) continue;
            priced++;
            if (!best || p > best.price || (p === best.price && Number(it.id) < best.id)) {
                best = { id: Number(it.id), name: String(it.name == null ? "" : it.name), price: p };
            }
        }
        return {
            shopId: Number(shop.shop_id),
            shop: String(shop.name == null ? "" : shop.name),
            stock: stock.length,
            priced,
            id: best ? best.id : null,
            name: best ? best.name : null,
            price: best ? best.price : 0,
        };
    });
    return list.sort((a, b) => b.price - a.price || a.shopId - b.shopId);
}

/**
 * Every inn's bed price per Digimon, cheapest first:
 *   { name, map, price }
 * The price is the record's own price_per_digimon; the map is the stage id it is
 * registered on.
 */
export function innTariffs(inns) {
    return tableRows(inns, "inns")
        .map((r) => ({
            name: String(r && r.name != null ? r.name : ""),
            map: String(r && r.map != null ? r.map : ""),
            price: whole(r && r.price_per_digimon),
        }))
        .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}

/**
 * The sell shelf: every piece a shop never sells (no buy price) but still pays
 * for (a real sell price), best sale first: { id, name, sell }.
 */
export function sellShelf(effects) {
    return tableRows(effects, "items")
        .filter((r) => whole(r.buy) === 0 && whole(r.sell) > 0)
        .map((r) => ({ id: Number(r.id), name: String(r.name == null ? "" : r.name), sell: whole(r.sell) }))
        .sort((a, b) => b.sell - a.sell || a.id - b.id);
}

/** Can a wallet of `bits` pay `price`? Exactly enough is enough — the inn's own rule. */
export function afford(bits, price) {
    return Number(bits) >= Number(price);
}

/**
 * Add `add` BIT to a wallet and stop at the ceiling. The original refuses to go
 * below zero as well (the subtract arm floors at 0), so a spend can empty the
 * wallet but never overdraw it.
 */
export function capAdd(bits, add) {
    const sum = whole(bits) + Math.trunc(Number(add) || 0);
    return Math.max(0, Math.min(MONEY_CAP, sum));
}
