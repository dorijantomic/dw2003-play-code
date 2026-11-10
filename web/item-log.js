// web/item-log.js -- which ITEMS the player has ever OWNED or SEEN. Feeds GLOSSARY > ITEMS.
//
// Same store as the species log (web/species-log.js): localStorage `dw.glossary.v1`, which save slots already copy with every
// other key (web/save.js NON_GAME_KEYS), so the item log travels with each save. This module adds one part to it:
//   items: { owned: {"12":1}, seen: {"12":1} }       (sets: an item id is 1 once it is in)
// Old saves have no `items` part: it reads as empty. Both modules keep the other's parts when they write
// (species-log.js carries `items` through its own writes; this module keeps met/beaten/owned as they are).
//
// Nothing is cached in memory: every call reads the key, changes it and writes it back (a slot load rewrites localStorage
// under a running game).
import { ITEM_ID_MAX } from "./vendor/engine.js";

export const ITEM_LOG_KEY = "dw.glossary.v1";
export const ITEM_MAX_ID = ITEM_ID_MAX;    // the shipped item catalogue ends at 402 (engine item-directories)

const validId = (n) => Number.isInteger(n) && n >= 1 && n <= ITEM_MAX_ID;
const cleanSet = (o) => {
    const out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const k of Object.keys(o)) {
        const id = Number(k);
        if (validId(id) && String(id) === k && o[k]) out[k] = 1;
    }
    return out;
};

function defaultStorage() {
    return typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
}

export function createItemLog(storage = defaultStorage()) {
    // the whole stored object (other parts untouched); the cleaned items part is taken from it
    const readRaw = () => {
        try {
            const j = JSON.parse(storage.getItem(ITEM_LOG_KEY) || "null");
            if (j && typeof j === "object" && !Array.isArray(j) && j.v === 1) return j;
        } catch { /* damaged: read as empty */ }
        return { v: 1, met: {}, beaten: {}, owned: {} };
    };
    const read = () => { const i = readRaw().items; return { owned: cleanSet(i?.owned), seen: cleanSet(i?.seen) }; };
    const note = (field, ids) => {
        const list = (Array.isArray(ids) ? ids : []).map(Number).filter(validId);
        if (!list.length) return false;
        const raw = readRaw();
        const items = { owned: cleanSet(raw.items?.owned), seen: cleanSet(raw.items?.seen) };
        let added = false;
        for (const id of list) if (!items[field][id]) { items[field][id] = 1; added = true; }
        if (!added) return false;
        try { storage.setItem(ITEM_LOG_KEY, JSON.stringify({ ...raw, items })); } catch { /* blocked or full: the game goes on */ }
        return true;
    };
    return {
        read,
        noteOwned: (ids) => note("owned", ids),
        noteSeen: (ids) => note("seen", ids),
        isOwned: (id) => !!read().owned[id],
        isSeen: (id) => !!read().seen[id],
        /** owned or seen: the ids the ITEMS page lists */
        knownIds() { const s = read(); return [...new Set([...Object.keys(s.owned), ...Object.keys(s.seen)].map(Number))].sort((a, b) => a - b); },
        /** everything in a bag ([{id, qty}]) counts as owned (existing players, loaded saves) */
        syncBag(bag) { return note("owned", (Array.isArray(bag) ? bag : []).filter((s) => s && (s.qty ?? 1) > 0).map((s) => s.id)); },
    };
}

/**
 * Watch `state.inventory`: any slot put into the bag (the store's one creating place is storeHeld, engine/dw3/item-store.ts, a
 * `push`) is logged as owned, and so is every slot of a bag assigned to `state.inventory` (load, duel restore). Raising the
 * count of a slot already in the bag needs no hook: that item is owned already. The bag in `state` at call time is synced.
 */
export function watchBag(state, log) {
    const mine = new WeakSet();     // the proxies made here: assigning one back (state.inventory = state.inventory) must not wrap it again
    const wrap = (bag) => {
        if (!Array.isArray(bag) || mine.has(bag)) return bag;
        const p = new Proxy(bag, {
            set(target, prop, value, recv) {
                if (typeof prop === "string" && /^\d+$/.test(prop) && value && typeof value === "object") {
                    try { log.noteOwned([value.id]); } catch { /* never break the bag */ }
                }
                return Reflect.set(target, prop, value, recv);
            },
        });
        mine.add(p);
        return p;
    };
    let bag = state.inventory;
    try { log.syncBag(bag); } catch { /* ignore */ }
    bag = wrap(bag);
    Object.defineProperty(state, "inventory", {
        enumerable: true, configurable: true,
        get: () => bag,
        set: (v) => { try { log.syncBag(v); } catch { /* ignore */ } bag = wrap(v); },
    });
}
