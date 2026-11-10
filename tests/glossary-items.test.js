// GLOSSARY > ITEMS: the rows (web/glossary-items.js), the section switch and the drawing (web/glossary-book.js), the wiring (web/game.js).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createGlossaryBook, ITEMS_LAYOUT } from "../web/glossary-book.js";
import { buildSpecies } from "../web/glossary-digimon.js";
import { buildItemsData, createItemsModel, heldIn, itemPage, oddsText, whereLines, whereVisible } from "../web/glossary-items.js";
import { createItemLog } from "../web/item-log.js";

// ---------------------------------------------------------------- fixtures
const enemies = { enemies: [
    { enemy_id: "Betamon", drop_item: "PowerCharge", drop_rate: 191 },       // 192 / 1024 = 18.75 -> 18.8%
    { enemy_id: "Goburimon", drop_item: "PowerCharge", drop_rate: 63 },      // 64 / 1024  = 6.25 -> 6.3%
    { enemy_id: "Goburimon2", drop_item: "PowerCharge", drop_rate: 127 },    // 128 / 1024 = 12.5%: the better record of the same Digimon
    { enemy_id: "Kunemon", drop_item: "DarkPower1", drop_rate: 0 },          // 1 / 1024 = 0.1%
    { enemy_id: "Cardmon1", drop_item: "PowerCharge", drop_rate: 255 },      // placeholder rows never count
    { enemy_id: "Null", drop_item: "Null", drop_rate: 0 },
] };
const stats = { records: [{ nameId: 1 }, { nameId: 2 }, { nameId: 2 }, { nameId: 3 }, { nameId: 4 }] };
const nameBank = ["", "Betamon", "Goburimon", "Kunemon", "Card"];
const obtain = { items: {
    43: { name: "PowerCharge", category: "consumable", sources: [{ kind: "shop", shop_id: 2, stages: ["s245"] }, { kind: "shop", shop_id: 4, stages: ["s250"] }, { kind: "shop", shop_id: 30, stages: [] }, { kind: "shop", shop_id: 2, stages: ["s246"] }, { kind: "talk", stage: "s1", npc_id: 1 }] },
    44: { name: "DarkPower1", category: "consumable", sources: [{ kind: "drop", enemy: "Kunemon", rate: 0 }] },
    45: { name: "Cashew", category: "key", sources: [] },
} };
const shops = { shops: [{ shop_id: 2, name: "Asuka Item Shop" }, { shop_id: 4, name: "AS Black Market" }, { shop_id: 30, name: "" }] };
const data = () => buildItemsData({ obtain, shops, enemies, stats, nameBank });
const logOf = (met = {}, beaten = {}, owned = {}) => ({ metCount: (n) => met[n] || 0, beatenCount: (n) => beaten[n] || 0, ownedCount: (n) => owned[n] || 0 });
const INFO = { 43: { name: "Power Charge", desc: "Restores 500 HP." }, 44: { name: "Dark Power", desc: "" }, 45: { name: "Cashew", desc: "A nut." } };

// ---------------------------------------------------------------- rows
test("odds are printed as a percent with one decimal (rate + 1 of 1024)", () => {
    assert.equal(oddsText(192), "18.8%");
    assert.equal(oddsText(1), "0.1%");
    assert.equal(oddsText(1024), "100%");
});

test("where lines: shops first (one per name, the unnamed shop left out), then only met Digimon, best chance first", () => {
    const d = data();
    const all = whereLines(d, 43, logOf({ Betamon: 1, Goburimon: 1 }));
    assert.deepEqual(all.map((l) => l.text), ["Sold at Asuka Item Shop", "Sold at AS Black Market", "Dropped by Betamon", "Dropped by Goburimon"]);
    assert.deepEqual(all.filter((l) => l.kind === "drop").map((l) => l.right), ["18.8%", "12.5%"]);      // Goburimon: the better record wins
    assert.ok(all.every((l) => !/\?/.test(l.text)));
});

test("a Digimon never met is not shown at all, not even as ???", () => {
    const d = data();
    assert.deepEqual(whereLines(d, 44, logOf()).map((l) => l.text), []);
    assert.deepEqual(whereLines(d, 44, logOf({ Kunemon: 1 })).map((l) => l.text), ["Dropped by Kunemon"]);
    const nothing = whereLines(d, 43, logOf());
    assert.deepEqual(nothing.map((l) => l.kind), ["shop", "shop"]);
});

test("records of one Digimon merge to one name; meeting either record counts; an owned form counts as met (a defeat always logs a meeting too)", () => {
    const d = data();
    assert.equal(d.enemyName("Goburimon2"), "Goburimon");
    assert.deepEqual(d.groups.get("Goburimon"), ["Goburimon", "Goburimon2"]);
    assert.equal(whereLines(d, 43, logOf({ Goburimon2: 1 })).filter((l) => l.kind === "drop").length, 1);
    assert.equal(whereLines(d, 43, logOf({}, {}, { Betamon: 1 })).filter((l) => l.kind === "drop").length, 1);
});

test("without the name bank the display name is the record key without its number", () => {
    const d = buildItemsData({ obtain, shops, enemies, stats, nameBank: null });
    assert.equal(d.enemyName("Goburimon2"), "Goburimon");
});

test("Cardmon rows and Null never become droppers", () => {
    const names = data().droppers(43).map((x) => x.enemy);
    assert.deepEqual(names, ["Betamon", "Goburimon", "Goburimon2"]);
});

test("item page: the game's name, the description, the count in the bag", () => {
    const page = itemPage(data(), 43, { info: (id) => INFO[id], held: heldIn([{ id: 43, qty: 3 }, { id: 9, qty: 1 }], 43), log: logOf() });
    assert.equal(page.name, "Power Charge");
    assert.equal(page.count, 3);
    assert.equal(page.does, "Restores 500 HP.");
    assert.equal(itemPage(data(), 99, { info: () => null, log: logOf() }).name, "Item 99");
});

test("room for the where lines under the name row, the heads and the description", () => {
    assert.equal(whereVisible(2), 4);
    assert.equal(whereVisible(1), 5);
    assert.equal(whereVisible(0), 7);
});

// ---------------------------------------------------------------- the known list (item-log)
test("only items the player owned or saw are listed", () => {
    const store = new Map();
    const log = createItemLog({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
    log.noteOwned([43]);
    log.noteSeen([45, 43]);
    assert.deepEqual(log.knownIds(), [43, 45]);
});

// ---------------------------------------------------------------- the cursor
test("previous / next item does not wrap and the item is remembered by id when the list grows", () => {
    const m = createItemsModel();
    let ids = [5, 9, 12];
    assert.equal(m.current(ids), 5);
    assert.equal(m.move(ids, -1), false);
    assert.equal(m.move(ids, 1), true);
    assert.equal(m.current(ids), 9);
    ids = [5, 7, 9, 12];                         // something new was picked up before it
    assert.equal(m.current(ids), 9);
    assert.equal(m.index(ids), 2);
    assert.equal(m.move(ids, 5), true);          // clamps to the last
    assert.equal(m.current(ids), 12);
    assert.equal(m.move(ids, 1), false);
    assert.equal(m.current([]), null);
    assert.equal(m.move([], 1), false);
});

test("scrolling the where lines stops at both ends and starts over on a new item", () => {
    const m = createItemsModel();
    const ids = [1, 2];
    m.current(ids);
    assert.equal(m.scroll(-1, 7, 4), false);
    assert.equal(m.scroll(1, 7, 4), true);
    assert.equal(m.scroll(1, 7, 4), true);
    assert.equal(m.scroll(1, 7, 4), true);
    assert.equal(m.scroll(1, 7, 4), false);      // 7 lines, 4 visible: three steps
    assert.equal(m.line(), 3);
    m.move(ids, 1);
    assert.equal(m.line(), 0);
    assert.equal(m.scroll(1, 3, 4), false);      // fits: nothing to scroll
});

// ---------------------------------------------------------------- the book
const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const P = (id, name) => ({ id, name, hp: 100, mp: 50, str: 10, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL }, resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [9], tech_learn_levels: [], tech_load_levels: [], blasts: [] });
const SPECIES = buildSpecies({ digimon: { digimon: [P(1, "Agumon"), P(2, "Gabumon")], skills: [{ id: 9, name: "Pepper Breath", element: "fire" }] }, enemies: { enemies: [] }, evolutions: { lines: [] } });
const speciesLog = (met = {}, beaten = {}) => ({ metCount: (n) => met[n] || 0, beatenCount: (n) => beaten[n] || 0, ownedCount: () => 0, totals: () => ({ met: 0, beaten: 0 }), read: () => ({}) });

function fakeCtx() {
    const texts = [];
    return new Proxy({}, {
        get: (_t, n) => (n === "texts" ? texts
            : n === "measureText" ? (s) => ({ width: String(s).length * 7 })
            : n === "fillText" ? (s, x, y) => { texts.push({ s: String(s), x, y: y - 11, w: String(s).length * 7 }); }
            : () => {}),
        set: () => true,
    });
}
const open = (ticks = 100) => ({ progress: () => 1, ticks, dt: 0.02 });
const keys = (...k) => new Set(k);

function setup({ ids = [43, 44, 45], bag = [{ id: 43, qty: 3 }], met = {}, beaten = {}, withItems = true, partners = [], loaded = true } = {}) {
    const sounds = [], flips = [];
    const items = { data: loaded ? data() : null, info: (id) => INFO[id] ?? null, ids: () => ids, held: (id) => heldIn(bag, id) };
    const book = createGlossaryBook({
        sfx: { play: (n) => sounds.push(n), playPacked: (n) => flips.push(n) },
        getSpecies: () => SPECIES, getLog: () => speciesLog(met, beaten), getPartners: () => partners, stage: null,
        getItems: withItems ? () => items : null,
    });
    return { book, sounds, flips };
}
const L1 = "l1", R1 = "r1";

test("section switch: R1 from a page 1 with no page 2 goes to ITEMS, L1 comes back; PLACES is never reached", () => {
    const { book } = setup();
    assert.equal(book.section, 0);
    book.act(keys(R1));                          // Agumon not defeated: page 2 is locked, so R1 goes on to ITEMS
    assert.equal(book.section, 1);
    book.act(keys(R1));                          // PLACES is not built: nothing happens
    assert.equal(book.section, 1);
    book.act(keys(L1));
    assert.equal(book.section, 0);
    book.act(keys(L1));
    assert.equal(book.section, 0);
});

test("DIGIMON keeps its own pages: with a defeated species R1 goes to page 2 first, then on to ITEMS; L1 returns to the page left", () => {
    const { book } = setup({ met: { Agumon: 1 }, beaten: { Agumon: 1 } });
    book.act(keys(R1));
    assert.equal(book.model.page(), 1);
    assert.equal(book.section, 0);
    book.act(keys(R1));
    assert.equal(book.section, 1);
    book.act(keys(L1));
    assert.equal(book.section, 0);
    assert.equal(book.model.page(), 1);          // back on page 2
    book.act(keys(L1));
    assert.equal(book.model.page(), 0);
});

test("without an ITEMS provider the book is exactly the DIGIMON book (R1 on page 2 does nothing)", () => {
    const { book } = setup({ withItems: false, met: { Agumon: 1 }, beaten: { Agumon: 1 } });
    book.act(keys(R1));
    book.act(keys(R1));
    assert.equal(book.section, 0);
    assert.equal(book.model.page(), 1);
});

test("ITEMS keys: left / right change item, up / down scroll, Back leaves; DIGIMON's own cursor is not moved", () => {
    const { book, sounds } = setup({ ids: [43, 44, 45], met: { Betamon: 1, Goburimon: 1, Kunemon: 1 } });
    book.act(keys(R1));
    const at = book.model.index();
    assert.equal(book.itemsModel.current([43, 44, 45]), 43);
    book.act(keys("right"));
    assert.equal(book.itemsModel.current([43, 44, 45]), 44);
    book.act(keys("left"));
    book.act(keys("left"));                      // already first
    assert.equal(book.itemsModel.current([43, 44, 45]), 43);
    book.act(keys("down"));                      // 43 has 5 where lines, the description takes 1: room 5 -> no scroll
    assert.equal(book.itemsModel.line(), 0);
    book.act(keys("up"));
    assert.equal(book.model.index(), at);
    assert.ok(sounds.length >= 1);
    assert.equal(book.act(keys("cross")), "back");
});

test("ITEMS draws the name, count, description, shops and met droppers inside the screen, and never a ???", () => {
    const { book } = setup({ met: { Betamon: 1 } });
    book.act(keys(R1));
    const ctx = fakeCtx();
    book.draw(ctx, open());
    const said = ctx.texts.map((t) => t.s);
    for (const want of ["Power Charge", "x 3", "What it does", "Restores 500 HP.", "Where to get it", "Sold at Asuka Item Shop", "Sold at AS Black Market", "Dropped by Betamon", "18.8%"]) assert.ok(said.includes(want), want);
    assert.ok(!said.some((s) => s.includes("???") || s.includes("Goburimon")));      // Goburimon not met
    for (const t of ctx.texts) {
        if (t.s === "▲" || t.s === "▼") continue;
        assert.ok(t.x >= 0 && t.x + t.w <= 320 + 0.5 || t.x >= ITEMS_LAYOUT.arrowX, `${t.s} at ${t.x}`);
    }
    assert.ok(said.includes("L1 Digimon"));
});

test("ITEMS with nothing known: one plain line", () => {
    const { book } = setup({ ids: [] });
    book.act(keys(R1));
    const ctx = fakeCtx();
    book.draw(ctx, open());
    const said = ctx.texts.map((t) => t.s);
    assert.ok(said.includes("No items found yet."));
    assert.ok(!said.includes("What it does") && !said.includes("Where to get it"));
});

test("ITEMS while the tables load says so; an item with no description or place says so plainly", () => {
    const loading = setup({ loaded: false });
    loading.book.act(keys(R1));
    let ctx = fakeCtx();
    loading.book.draw(ctx, open());
    assert.ok(ctx.texts.some((t) => t.s === "Loading..."));
    const bare = setup({ ids: [45] });
    bare.book.act(keys(R1));
    ctx = fakeCtx();
    bare.book.draw(ctx, open());
    assert.ok(ctx.texts.some((t) => t.s === "Nothing found out yet."));
});

test("the header marks ITEMS as the active tab and the DIGIMON screen is unchanged", () => {
    const { book } = setup();
    const a = fakeCtx();
    book.draw(a, open());
    assert.ok(a.texts.some((t) => t.s === "DIGIMON") && a.texts.some((t) => t.s === "PLACES"));
    book.act(keys(R1));
    const b = fakeCtx();
    book.draw(b, open());
    assert.ok(b.texts.some((t) => t.s === "ITEMS"));
});

// ---------------------------------------------------------------- source checks
test("game.js wires the provider: the game's item table, the item log and the bag", () => {
    const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(game, /getItems: glossaryItems/);
    const at = game.indexOf("function glossaryItems()");
    assert.ok(at > 0);
    const block = game.slice(at, game.indexOf("\n}\n", at));
    for (const w of ["ITEM_BY_ID[id]", "itemLog.knownIds()", "heldCount(state, id)", "battleHudNameBank"]) assert.ok(block.includes(w), w);
});

test("keys are the shared pad words (keyboard Q/E and the pad's L1/R1 both reach them)", () => {
    const book = readFileSync(new URL("../web/glossary-book.js", import.meta.url), "utf8");
    assert.match(book, /WORD\.prev/);
    assert.match(book, /WORD\.next/);
    const map = readFileSync(new URL("../engine/systems/input-map.ts", import.meta.url), "utf8");
    assert.match(map, /l1: \["q"\]/);
    assert.match(map, /r1: \["e"\]/);
});

// ---------------------------------------------------------------- the real tables (skipped when the disc data is not here)
const dataDir = new URL("../web/assets/data/", import.meta.url);
const haveReal = ["item_obtain_index.json", "shops.json", "enemies.json", "battlecmd/enemy_stats.json"].every((f) => existsSync(new URL(f, dataDir)));
test("real tables: every dropper in the obtain index is a dropper here, and every shop name resolves", { skip: haveReal ? false : "web/assets/data is not available" }, () => {
    const j = (f) => JSON.parse(readFileSync(new URL(f, dataDir), "utf8"));
    const real = { obtain: j("item_obtain_index.json"), shops: j("shops.json"), enemies: j("enemies.json"), stats: j("battlecmd/enemy_stats.json") };
    const d = buildItemsData(real);
    let withDrops = 0;
    for (const [id, rec] of Object.entries(real.obtain.items)) {
        const a = rec.sources.filter((s) => s.kind === "drop").map((s) => `${s.enemy}:${s.rate}`).sort().join();
        const b = d.droppers(Number(id)).map((x) => `${x.enemy}:${x.rate}`).sort().join();
        assert.equal(b, a, `item ${id}`);
        if (a) withDrops++;
        for (const sid of d.shopIds(Number(id))) assert.ok(d.shopName(sid) || sid === 30, `shop ${sid} of item ${id}`);
    }
    assert.equal(withDrops, 78);
    assert.equal(d.enemyName("Goburimon2"), "Goburimon");
});
