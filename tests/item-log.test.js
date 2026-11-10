// The item log (web/item-log.js): owned / seen items in the glossary store, old saves, the bag watcher, save-slot copy.
import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_LOG_KEY, createItemLog, watchBag } from "../web/item-log.js";
import { SPECIES_LOG_KEY, createSpeciesLog } from "../web/species-log.js";
import { __setStoreItem, __getStoreItem, __clearStore, writeSlot, restoreSlotData } from "../web/save.js";

const memory = (seed = {}) => {
    const m = new Map(Object.entries(seed));
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};

test("same key as the species log", () => assert.equal(ITEM_LOG_KEY, SPECIES_LOG_KEY));

test("an old save (no items part) loads as empty and keeps its species counts when items are added", () => {
    const old = { v: 1, met: { Agumon: 2 }, beaten: { Agumon: 1 }, owned: { Agumon: 1 } };
    const store = memory({ [ITEM_LOG_KEY]: JSON.stringify(old) });
    const log = createItemLog(store);
    assert.deepEqual(log.read(), { owned: {}, seen: {} });
    assert.deepEqual(log.knownIds(), []);
    assert.equal(log.noteOwned([5]), true);
    const j = JSON.parse(store.getItem(ITEM_LOG_KEY));
    assert.deepEqual(j.met, { Agumon: 2 });
    assert.deepEqual(j.owned, { Agumon: 1 });
    assert.deepEqual(j.items, { owned: { 5: 1 }, seen: {} });
});

test("owned and seen are sets; knownIds is the union, sorted", () => {
    const log = createItemLog(memory());
    assert.equal(log.noteOwned([7, 7, 3]), true);
    assert.equal(log.noteOwned([7]), false, "nothing new");
    assert.equal(log.noteSeen([3, 20]), true);
    assert.equal(log.isOwned(7), true);
    assert.equal(log.isOwned(20), false);
    assert.equal(log.isSeen(20), true);
    assert.deepEqual(log.knownIds(), [3, 7, 20]);
});

test("bad ids are ignored; damaged data never throws", () => {
    const log = createItemLog(memory());
    assert.equal(log.noteOwned([0, -1, 1.5, 403, "x", null, undefined, {}]), false);
    for (const bad of ["", "nope", "null", "[]", JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, items: { owned: [1], seen: "x" } }), JSON.stringify({ v: 1, items: { owned: { "01": 1, "5": 1, "9": 0, "500": 1 } } })]) {
        const l = createItemLog(memory({ [ITEM_LOG_KEY]: bad }));
        assert.doesNotThrow(() => l.read(), bad);
        assert.doesNotThrow(() => l.noteSeen([4]), bad);
    }
    assert.deepEqual(createItemLog(memory({ [ITEM_LOG_KEY]: JSON.stringify({ v: 1, items: { owned: { "01": 1, "5": 1, "9": 0, "500": 1 } } }) })).read().owned, { 5: 1 });
});

test("the species log keeps the items part when it writes (and read() still has no items)", () => {
    const store = memory();
    createItemLog(store).noteOwned([12]);
    const sp = createSpeciesLog(store);
    sp.noteMet(["Kunemon"]);
    assert.deepEqual(Object.keys(sp.read()).sort(), ["beaten", "met", "owned", "v"]);
    assert.deepEqual(createItemLog(store).read().owned, { 12: 1 });
    assert.equal(sp.metCount("Kunemon"), 1);
});

test("syncBag: everything in the bag counts as owned, empty slots do not", () => {
    const log = createItemLog(memory());
    assert.equal(log.syncBag([{ id: 1, qty: 3 }, { id: 2, qty: 0 }, { id: 9 }]), true);
    assert.deepEqual(log.knownIds(), [1, 9]);
    assert.equal(log.syncBag(null), false);
});

test("watchBag: bag at start is synced; push, assignment and a re-add after removal are logged; count raise is not needed", () => {
    const log = createItemLog(memory());
    const state = { inventory: [{ id: 4, qty: 1 }] };
    watchBag(state, log);
    assert.deepEqual(log.knownIds(), [4]);
    state.inventory.push({ id: 8, qty: 1 });                 // what storeHeld does
    assert.equal(log.isOwned(8), true);
    state.inventory.splice(state.inventory.findIndex((s) => s.id === 8), 1);   // dropHeld
    assert.equal(log.isOwned(8), true, "owned stays after the item is gone");
    state.inventory = [{ id: 30, qty: 2 }];                  // a load or duel restore
    assert.equal(log.isOwned(30), true);
    state.inventory.push({ id: 31, qty: 1 });
    assert.equal(log.isOwned(31), true, "the new bag is watched too");
    assert.equal(Array.isArray(state.inventory), true);
    assert.equal(JSON.stringify(state.inventory), JSON.stringify([{ id: 30, qty: 2 }, { id: 31, qty: 1 }]));
});

test("watchBag with the real item store (storeAddItem)", async () => {
    const { storeAddItem } = await import("../web/vendor/engine.js");
    const log = createItemLog(memory());
    const state = { inventory: [] };
    watchBag(state, log);
    storeAddItem(state, 11, 2);
    assert.equal(log.isOwned(11), true);
    assert.equal(state.inventory.find((s) => s.id === 11).qty, 2);
});

test("a save slot copies the item log and a load brings it back", () => {
    __clearStore();
    const live = { getItem: (k) => __getStoreItem(k), setItem: (k, v) => __setStoreItem(k, v) };
    const log = createItemLog(live);
    log.noteOwned([5]); log.noteSeen([6]);
    assert.equal(writeSlot(0, {}), true);
    log.noteOwned([99]);                                    // after the save
    assert.equal(log.isOwned(99), true);
    assert.equal(restoreSlotData(0), true);
    assert.deepEqual(log.read(), { owned: { 5: 1 }, seen: { 6: 1 } }, "the slot's log, not the later one");
    __clearStore();
});

test("watchBag: assigning state.inventory to itself keeps one wrap, so a push is logged once", () => {
    let calls = 0;
    const real = createItemLog(memory());
    const log = { ...real, noteOwned: (ids) => { calls++; return real.noteOwned(ids); } };
    const state = { inventory: [{ id: 4, qty: 1 }] };
    watchBag(state, log);
    const first = state.inventory;
    state.inventory = state.inventory;
    state.inventory = state.inventory;
    assert.equal(state.inventory, first, "the same proxy, not a proxy of a proxy");
    calls = 0;
    state.inventory.push({ id: 9, qty: 1 });
    assert.equal(calls, 1);
    assert.equal(real.isOwned(9), true);
});
