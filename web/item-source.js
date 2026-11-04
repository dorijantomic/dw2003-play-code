// web/item-source.js — the world's own index of where every one of the disc's
// 402 items comes from: the shop that sells it (name, price and the stage its
// merchant stands on), the NPC talk that hands it over, the cutscene that gives
// it, the stage's own code that grants it, and the enemy that drops it with its
// roll. When none of those exist the book says so in words, per category.
//
// Pure: no page, no storage, no network, no flag write. The page
// (web/item-source.html) and the node test hand it the shipped tables:
//   item_obtain_index.json — {items: {id: {name, category, sources[]}}, unobtainable[]}
//     source kinds: shop {shop_id, stages[]} | talk {stage, npc_id} |
//     cutscene {stage, event_id} | native {stage, event_id, offset} |
//     drop {enemy, rate}
//   shops.json — {shops: [{shop_id, name, count, items[]}]}
//   merchant_shops.json — {merchants: [{stage, npc_id, kind, shop_id?, stock[]}], dri_desks: [...]}
//   item_effects.json — {items: [{id, name, category, buy, sell}]}
//   equipment.json — {equipment: [{id, buy_price, sell_price}]} (prices agree with
//     item_effects on all 268 pieces, so a caller may pass it only as a fallback)
//
// Nothing here is guessed: a kind the files do not name never becomes a row, an
// id the index does not hold returns null, and a shop with no name stays nameless.

const CATEGORY_WORD = {
    consumable: "consumable",
    booster: "card booster",
    key: "key item",
    equipment: "piece of equipment",
    accessory: "accessory",
};

/** The {id: record} map inside an index object, or the object itself. */
function itemMap(index) {
    if (!index || typeof index !== "object") return {};
    const items = index.items && typeof index.items === "object" ? index.items : index;
    return items && typeof items === "object" ? items : {};
}

/** An array table either handed as its own list or as the file's own wrapper. */
function tableRows(table, key) {
    if (Array.isArray(table)) return table;
    return table && Array.isArray(table[key]) ? table[key] : [];
}

/**
 * One source's identity, per kind. The extraction lists a few grants twice
 * (FishingPole's s340/npc 282 talk, for one); two lines that name the same
 * place are one place.
 */
function sourceKey(source) {
    switch (source.kind) {
        case "shop": return `shop:${source.shop_id}:${(source.stages || []).slice().sort().join(",")}`;
        case "talk": return `talk:${source.stage}:${source.npc_id}`;
        case "cutscene": return `cutscene:${source.stage}:${source.event_id}`;
        case "native": return `native:${source.stage}:${source.event_id}:${source.offset}`;
        case "drop": return `drop:${source.enemy}:${source.rate}`;
        default: return `${source.kind}:${JSON.stringify(source)}`;
    }
}

function distinctSources(sources) {
    const seen = new Set();
    const rows = [];
    for (const source of sources || []) {
        if (!source || !source.kind) continue;
        const key = sourceKey(source);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(source);
    }
    return rows;
}

/**
 * The list the page draws: one row per item, sorted by id, with the number of
 * real places (not repeated lines) that hand it over.
 */
export function indexRows(index) {
    const items = itemMap(index);
    return Object.keys(items)
        .map((key) => Number(key))
        .filter((id) => Number.isFinite(id))
        .sort((a, b) => a - b)
        .map((id) => {
            const record = items[String(id)] || {};
            return {
                id,
                name: record.name || "",
                category: record.category || "",
                count: distinctSources(record.sources).length,
            };
        });
}

/**
 * One shop source resolved against the shipped tables: the shop's own name,
 * every stage its merchant row names, and the merchant standing there.
 * Shop 30 is the disc's unopened shop — a stock and no merchant on any stage —
 * and says exactly that; a shop id the shop table does not hold is named as
 * unknown, never given an invented name or stage.
 */
export function shopRows(source, shops, merchants) {
    const shop_id = Number(source.shop_id);
    const shop = tableRows(shops, "shops").find((s) => Number(s.shop_id) === shop_id) || null;
    const name = shop && shop.name ? shop.name : null;
    const listed = shop && Array.isArray(shop.items) ? shop.items.length : null;
    const stages = Array.isArray(source.stages) ? source.stages.slice() : [];
    const merchantRows = tableRows(merchants, "merchants").filter((m) => Number(m.shop_id) === shop_id);

    const stops = [];
    for (const stage of stages) {
        const hit = merchantRows.find((m) => m.stage === stage);
        stops.push({ stage, npc_id: hit ? hit.npc_id : null });
    }
    const first = stops[0] || null;

    let where;
    if (!shop) {
        where = `unknown shop ${shop_id} — the shop table has no such shop`;
    } else if (!name) {
        const stock = listed != null ? `${listed} items on its list` : "a stock";
        where = `the disc's unopened shop — ${stock} and no merchant row on any stage`;
    } else if (!stops.length) {
        where = `${name} — no stage entry names a stage for it`;
    } else {
        const npcIds = [...new Set(stops.map((s) => s.npc_id).filter((n) => n != null))];
        const people = npcIds.length ? ` (npc ${npcIds.join(", ")})` : " (no merchant row names it)";
        where = `${name} — stands on ${stops.map((s) => s.stage).join(", ")}${people}`;
    }

    return {
        kind: "shop",
        shop_id,
        name,
        stages,
        stage: first ? first.stage : null,
        npc_id: first && first.npc_id != null ? first.npc_id : null,
        merchants: stops,
        unopened: !!shop && !name && stages.length === 0,
        where,
    };
}

/**
 * The price line the shop menu uses: `12 BIT (sells for 6)`. item_effects.json
 * carries every item's buy/sell, equipment included; equipment.json's own
 * buy_price/sell_price names are read only when a caller passes it and the
 * effects table has no price for the id.
 */
export function priceWord(id, effects, equipment = null) {
    const itemId = Number(id);
    const effect = tableRows(effects, "items").find((r) => Number(r.id) === itemId);
    let buy = null;
    let sell = null;
    if (effect && (effect.buy != null || effect.sell != null)) {
        buy = Number(effect.buy) || 0;
        sell = Number(effect.sell) || 0;
    }
    if (buy == null) {
        const piece = tableRows(equipment, "equipment").find((r) => Number(r.id) === itemId);
        if (piece) {
            buy = Number(piece.buy_price) || 0;
            sell = Number(piece.sell_price) || 0;
        }
    }
    if (buy == null) return "no price (not in the price table)";
    if (!buy && !sell) return "no price (0 BIT buy, 0 BIT sell)";
    if (!buy) return `not sold — the shop buys it back for ${sell}`;
    return `${buy} BIT (sells for ${sell})`;
}

/** The honest "nowhere" sentence, worded for the item's own category. */
export function nothingLine(record) {
    const category = record && record.category ? String(record.category) : "";
    const word = CATEGORY_WORD[category] || category.replace(/_/g, " ") || "item";
    return `nothing in the retail game gives this ${word} — no shop sells it, no one hands it over and no enemy drops it.`;
}

/**
 * Every place one item comes from, as the page's five lists. `data` is
 * `{index, shops, merchants, effects, equipment?}` exactly as the four shipped
 * files parse. An id the index does not hold returns null: the book never
 * invents a row for an item the disc does not have.
 */
export function sourcesFor(id, data = {}) {
    const itemId = Number(id);
    const items = itemMap(data.index);
    const record = items[String(itemId)];
    if (!record) return null;

    const out = {
        id: itemId,
        name: record.name || "",
        category: record.category || "",
        shops: [],
        talks: [],
        cutscenes: [],
        natives: [],
        drops: [],
        nothing: (record.sources || []).length === 0,
    };

    for (const source of distinctSources(record.sources)) {
        switch (source.kind) {
            case "shop":
                out.shops.push(shopRows(source, data.shops, data.merchants));
                break;
            case "talk":
                out.talks.push({
                    kind: "talk", stage: source.stage, npc_id: source.npc_id,
                    where: `npc ${source.npc_id} hands it over on ${source.stage}`,
                });
                break;
            case "cutscene":
                out.cutscenes.push({
                    kind: "cutscene", stage: source.stage, event_id: source.event_id,
                    where: `a cutscene on ${source.stage} hands it over (event ${source.event_id})`,
                });
                break;
            case "native":
                out.natives.push({
                    kind: "native", stage: source.stage, event_id: source.event_id, offset: source.offset,
                    where: `the stage's own code on ${source.stage} hands it over when event ${source.event_id} completes (offset ${source.offset})`,
                });
                break;
            case "drop":
                out.drops.push({
                    kind: "drop", enemy: source.enemy, rate: source.rate,
                    where: `${source.enemy} can drop it (rate ${source.rate} of 1024)`,
                });
                break;
            default:
                break;   // a kind the extraction does not define is not a place
        }
    }

    return out;
}
