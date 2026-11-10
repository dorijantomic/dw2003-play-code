// web/glossary-items.js -- the rows behind GLOSSARY > ITEMS (one item per screen). Pure: no DOM, no storage, no drawing.
//
// Which items: only the ones the player has OWNED or SEEN (web/item-log.js knownIds). What each page says:
//   name + what it does   the game's own text (engine ITEM_BY_ID: esitmnam / esitminf, the shop and equip footers read the same)
//   x N                   how many are in the bag now
//   where to get it       shops that sell it (item_obtain_index.json source kind "shop", named by shops.json), and the Digimon
//                         that drop it (codex-data dropIndex over enemies.json) -- ONLY Digimon the player has met. A Digimon
//                         never met is not shown at all (no "???").
// Digimon names: the disc's own name line (bank 0x4e line `nameId` of the enemy stat record, battlecmd/enemy_stats.json; the
// records are in the same order as enemies.json rows: checked 193 of 193 against the id path battle.js uses). Records such as
// "Goburimon2" carry the plain name on the disc, so a Digimon with several records is ONE line (best chance wins).
// Odds are printed as a percent with one decimal, the same as the DIGIMON page ("Drops: ..."): rate+1 of 1024 per win.
import { dropIndex, dropOdds } from "./codex-data.js";
import { displayName, metOf } from "./glossary-digimon.js";

/** Rows of the page's one panel (listRowY 0..8): name row, "What it does" head, description, "Where to get it" head, where lines. */
export const ITEM_ROWS = 9;
export const MAX_DESC_LINES = 2;

/** Where lines that fit under the name row, both heads and `descLines` description lines. */
export const whereVisible = (descLines) => ITEM_ROWS - (descLines > 0 ? 3 + descLines : 2);

/** "12.6%": the odds of one drop as the DIGIMON page prints them. */
export const oddsText = (n) => `${Math.round((n / 1024) * 1000) / 10}%`;

/**
 * The tables the page needs, built once. `obtain` = item_obtain_index.json, `shops` = shops.json, `enemies` = enemies.json,
 * `stats` = battlecmd/enemy_stats.json, `nameBank` = the decoded lines of name bank 0x4e (array of strings) or null.
 * Returns { enemyName(enemyId), groups: Map<display, enemyId[]>, shopName(id), obtainName(itemId), shopIds(itemId), droppers(itemId) }.
 */
export function buildItemsData({ obtain, shops, enemies, stats, nameBank = null } = {}) {
    const list = Array.isArray(enemies) ? enemies : Array.isArray(enemies?.enemies) ? enemies.enemies : [];
    const records = Array.isArray(stats?.records) ? stats.records : [];
    const display = new Map(), groups = new Map();
    list.forEach((e, i) => {
        const id = typeof e?.enemy_id === "string" ? e.enemy_id : "";
        if (!id || id === "Null") return;
        const line = records[i]?.nameId == null ? null : nameBank?.[records[i].nameId | 0];
        const name = typeof line === "string" && line !== "" ? line : displayName(id);
        display.set(id, name);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(id);
    });
    const index = dropIndex(enemies);
    const items = obtain?.items && typeof obtain.items === "object" ? obtain.items : {};
    const shopList = Array.isArray(shops) ? shops : Array.isArray(shops?.shops) ? shops.shops : [];
    const shopNames = new Map(shopList.map((s) => [Number(s.shop_id), typeof s.name === "string" ? s.name : ""]));
    return {
        enemyName: (id) => display.get(id) ?? displayName(id),
        groups,
        shopName: (id) => shopNames.get(Number(id)) || "",
        obtainName: (itemId) => items[String(itemId)]?.name ?? "",
        shopIds: (itemId) => (items[String(itemId)]?.sources ?? []).filter((s) => s?.kind === "shop").map((s) => Number(s.shop_id)),
        droppers: (itemId) => index.byItem.get(items[String(itemId)]?.name ?? "")?.droppers ?? [],
    };
}

/**
 * The "Where to get it" lines of one item: shops first (in table order, a name once), then the met Digimon that drop it,
 * best chance first. A line is { kind: "shop" | "drop", text, right? } (`right` = the percent, drawn at the right edge).
 * `log` is a species log snapshot (metCount / beatenCount / ownedCount).
 */
export function whereLines(data, itemId, log) {
    const out = [];
    const seenShop = new Set();
    for (const sid of data.shopIds(itemId)) {
        const name = data.shopName(sid);
        if (!name || seenShop.has(name)) continue;       // the disc's unopened shop has no name: not a place
        seenShop.add(name);
        out.push({ kind: "shop", text: `Sold at ${name}` });
    }
    const best = new Map();                                // display name -> best n over its records
    for (const d of data.droppers(itemId)) {
        const name = data.enemyName(d.enemy);
        const names = data.groups.get(name) ?? [d.enemy];
        if (!metOf({ names }, log)) continue;              // never met: not shown at all
        const n = d.odds?.n ?? dropOdds(d.rate).n;
        if (!best.has(name) || n > best.get(name)) best.set(name, n);
    }
    [...best].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .forEach(([name, n]) => out.push({ kind: "drop", text: `Dropped by ${name}`, right: oddsText(n) }));
    return out;
}

/** Items held in a bag [{id, qty}]. */
export const heldIn = (bag, id) => (Array.isArray(bag) ? bag : []).reduce((t, s) => (s && s.id === id ? t + (s.qty ?? 1) : t), 0);

/**
 * One item's page: { id, name, count, does, where }. `info(id)` = { name, desc } from the game's item table.
 */
export function itemPage(data, id, { info, held = 0, log }) {
    const i = info?.(id) ?? null;
    return { id, name: i?.name || `Item ${id}`, count: held, does: String(i?.desc ?? ""), where: data ? whereLines(data, id, log) : [] };
}

/**
 * The ITEMS cursor: remembers the item by id (the list grows when something new is picked up) and the "where" scroll.
 * Does not wrap. Pure.
 */
export function createItemsModel() {
    let id = null, line = 0;
    const indexIn = (ids) => { const k = ids.indexOf(id); return k < 0 ? 0 : k; };
    return {
        /** Current item id for this list (the first one when the remembered item is not in it); null for an empty list. */
        current(ids) { if (!ids.length) return null; if (!ids.includes(id)) { id = ids[0]; line = 0; } return id; },
        index: (ids) => indexIn(ids),
        move(ids, d) {
            if (!ids.length) return false;
            const from = indexIn(ids), to = Math.max(0, Math.min(ids.length - 1, from + d));
            if (to === from) return false;
            id = ids[to]; line = 0;
            return true;
        },
        line: () => line,
        scroll(d, total, visible) {
            const t = Math.max(0, Math.min(Math.max(0, total - visible), line + d));
            if (t === line) return false;
            line = t;
            return true;
        },
    };
}

const asJson = (v) => (typeof v?.json === "function" ? v.json() : v);

/** Fetch the tables and build the data. `loadNameBank()` resolves the decoded name bank lines. Never rejects; null on a failure. */
export async function loadItemsData(fetchJson = globalThis.fetch, loadNameBank = null) {
    if (typeof fetchJson !== "function") return null;
    try {
        const [obtain, shops, enemies, stats] = await Promise.all([
            "assets/data/item_obtain_index.json", "assets/data/shops.json", "assets/data/enemies.json", "assets/data/battlecmd/enemy_stats.json",
        ].map((p) => Promise.resolve(fetchJson(p)).then(asJson)));
        const nameBank = loadNameBank ? await Promise.resolve(loadNameBank()).catch(() => null) : null;
        return buildItemsData({ obtain, shops, enemies, stats, nameBank });
    } catch {
        return null;
    }
}
