// The BIT Ledger: the whole economy on one page, out of the disc's own numbers —
// the 9,999,999 wallet cap, what fights pay (the spread and the twenty best), what
// people hand over, what the 31 shops charge, what a bed costs in the 21 inns, and
// the pieces no shop sells but still pays for.
//
// Every figure is computed from the shipped extraction files, never hand-typed:
//   web/assets/data/progression.json      battle_rewards[screen] = [dvexp, exp, bits]
//   web/assets/data/bank70_money_grants.json  the 17 NPC money grants
//   web/assets/data/shops.json            31 shops and their stock
//   web/assets/data/inn_ui.json           21 inn records, price per Digimon
//   web/assets/data/item_effects.json     402 items with buy / sell
// The wallet ceiling is pinned to the engine's own MONEY_CAP
// (engine/systems/shop-manager.ts:16, the disc's 0x98967F).
//
// The ledger never reads the exp or dvexp columns — fight ranking for experience is
// the Grind planner's job — and the page has no auction line: this checkout has no
// auction data file, so there is no lot price to print.
//
// F2 -> Extras -> "BIT ledger (new)" (off by default). With the switch off there is
// no row to click, no page and no data fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    MONEY_CAP,
    payoutStats,
    grants,
    shopPrices,
    innTariffs,
    sellShelf,
    afford,
    capAdd,
} from "../web/bit-ledger.js";
import { MONEY_CAP as ENGINE_MONEY_CAP } from "../engine/systems/shop-manager.ts";
import { SHOP_BIT_CAP } from "../engine/dw3/ui/shop-save-state.ts";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const readText = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const rewards = read("../web/assets/data/progression.json").battle_rewards;
const grantRows = read("../web/assets/data/bank70_money_grants.json").grants;
const shops = read("../web/assets/data/shops.json").shops;
const inns = read("../web/assets/data/inn_ui.json").inns;
const effects = read("../web/assets/data/item_effects.json");
const moduleSrc = readText("../web/bit-ledger.js");
const pageSrc = readText("../web/bit-ledger.html");
const pageScript = readText("../web/bit-ledger-page.js");

/** The bits column, the only one this page is allowed to read. */
const bitsOf = (row) => Number(Array.isArray(row) ? row[2] : 0);

test("battle_rewards is the disc's 335-screen table, and rows 0 / 1 / 2 are the decoded ones", () => {
    assert.equal(rewards.length, 335, "one row per screen id");
    assert.deepEqual(rewards[0], [0, 0, 0], "row 0 is the table's own empty row");
    assert.deepEqual(rewards[1], [12, 120, 240]);
    assert.deepEqual(rewards[2], [14, 140, 280]);
    // The table is [dvexp, exp, bits]; the ledger only ever reads bits.
    assert.equal(rewards.filter((r) => bitsOf(r) === 0).length, 5, "five screen ids pay nothing");
});

test("payoutStats spreads the 330 fights that pay, and lists the twenty best", () => {
    const stats = payoutStats(rewards);
    assert.equal(stats.count, 330, "335 rows minus the five that pay nothing");
    assert.equal(stats.min, 10, "the lowest real payout");
    assert.equal(stats.median, 470, "the middle payout");
    assert.equal(stats.max, 5475, "the highest payout");
    assert.equal(stats.top20.length, 20);
    assert.deepEqual(stats.top20[0], { screen: 262, bits: 5475 }, "the top fight is screen 262");
    assert.deepEqual(stats.top20.map((r) => r.bits), [
        5475, 3875, 3660, 3180, 3000, 2695, 2515, 1980, 1920, 1740,
        1730, 1710, 1680, 1655, 1625, 1600, 1600, 1580, 1570, 1570,
    ]);
    // The list is the file's own top twenty, ties broken by screen id.
    const expected = rewards
        .map((r, screen) => ({ screen, bits: bitsOf(r) }))
        .filter((r) => r.bits > 0)
        .sort((a, b) => b.bits - a.bits || a.screen - b.screen)
        .slice(0, 20);
    assert.deepEqual(stats.top20, expected);
});

test("payoutStats never reads the exp or dvexp column", () => {
    const fixture = [
        [10, 100, 100],
        [20, 200, 300],
        [30, 300, 200],
        [40, 400, 0],
    ];
    const plain = payoutStats(fixture);
    assert.deepEqual(plain, { count: 3, min: 100, median: 200, max: 300, top20: [{ screen: 1, bits: 300 }, { screen: 2, bits: 200 }, { screen: 0, bits: 100 }] });
    // Change both other columns only: not one number may move.
    const expOnly = fixture.map(([dvexp, exp, bits]) => [dvexp, exp * 7 + 5, bits]);
    const dvOnly = fixture.map(([dvexp, exp, bits]) => [dvexp * 3 + 1, exp, bits]);
    assert.deepEqual(payoutStats(expOnly), plain);
    assert.deepEqual(payoutStats(dvOnly), plain);
    // An even count takes the mean of the two middle payouts.
    assert.equal(payoutStats([[0, 0, 100], [0, 0, 200]]).median, 150);
    assert.deepEqual(payoutStats([]), { count: 0, min: 0, median: 0, max: 0, top20: [] });
});

test("the wallet stops at the engine's own 0x98967F, and afford is the inn's own >=", () => {
    assert.equal(MONEY_CAP, ENGINE_MONEY_CAP, "the ledger's cap is the shop manager's cap");
    assert.equal(MONEY_CAP, SHOP_BIT_CAP, "and the shop save state's cap");
    assert.equal(MONEY_CAP, 9999999);
    assert.match(moduleSrc, /0x98967f/i, "written once, in the disc's own hex");

    assert.equal(capAdd(9999990, 20), 9999999, "a 20 BIT win into a nearly full wallet stops at the cap");
    assert.equal(capAdd(9999999, 1), 9999999, "already at the cap");
    assert.equal(capAdd(0, 240), 240);
    assert.equal(capAdd(100, -30), 70, "spending takes bits away");
    assert.equal(capAdd(10, -30), 0, "the wallet never goes below zero");

    assert.equal(afford(23999, 24000), false, "one BIT short");
    assert.equal(afford(24000, 24000), true, "exactly enough is enough");
    assert.equal(afford(24001, 24000), true);
});

test("the 17 NPC money grants are counted from the file, never typed as a literal", () => {
    assert.equal(grantRows.length, 17, "the bank-0x70 table ships 17 grants");
    const got = grants(grantRows);
    assert.equal(got.count, grantRows.length, "the count is the file's own length");
    assert.equal(got.list.length, grantRows.length);
    assert.equal(got.total, grantRows.reduce((sum, r) => sum + Number(r.amount), 0), "the total is the file's own sum");
    assert.equal(got.total, 47500);
    assert.deepEqual(got.list.map((r) => r.amount), [8500, 8500, 8500, 5000, 5000, 3000, 3000, 1600, 1600, 1000, 600, 300, 300, 300, 100, 100, 100],
        "dearest first");
    for (const r of got.list) {
        assert.equal(typeof r.stage, "string");
        assert.ok(r.stage.length > 0, "every grant names the stage it happens on");
        assert.equal(typeof r.npcId, "number");
        assert.ok(r.amount > 0);
    }
});

test("all 31 shops, each showing its dearest stock read from the price table", () => {
    assert.equal(shops.length, 31, "the shop table ships 31 shops");
    const priced = shopPrices(shops, effects);
    assert.equal(priced.length, shops.length, "one row per shop, counted from the file");
    const buy = new Map(effects.items.map((r) => [r.id, Number(r.buy) || 0]));

    for (const row of priced) {
        const shop = shops.find((s) => s.shop_id === row.shopId);
        assert.ok(shop, `shop ${row.shopId} exists in shops.json`);
        const prices = shop.items.map((it) => buy.get(it.id) || 0);
        const dearest = Math.max(0, ...prices);
        assert.equal(row.stock, shop.items.length, "the whole stock is counted");
        assert.equal(row.price, dearest, `${row.shop || "shop " + row.shopId} shows the dearest stock's price`);
        if (dearest > 0) {
            const item = shop.items.find((it) => (buy.get(it.id) || 0) === dearest);
            assert.equal(row.name, item.name, "and the dearest item's own name");
            assert.equal(row.priced, prices.filter((p) => p > 0).length, "priced stock is counted");
        } else {
            assert.equal(row.name, null, "a shop with no priced stock names no item");
        }
    }

    // The unopened shop is the one with nothing priced; it is not invented a price.
    const unopened = priced.filter((r) => r.priced === 0);
    assert.equal(unopened.length, 1);
    assert.equal(unopened[0].shopId, 30);
    assert.equal(unopened[0].price, 0);

    // The dearest single shop price in the whole game, read from the table.
    const dearest = priced.reduce((a, b) => (b.price > a.price ? b : a));
    assert.equal(dearest.price, 60000);
    assert.equal(dearest.name, "RoninBlade");
    assert.equal(dearest.shop, "Hidden Armory Office");
    assert.equal(afford(dearest.price - 1, dearest.price), false, "one BIT short of the dearest thing");
    assert.equal(afford(dearest.price, dearest.price), true, "exactly enough buys it");
});

test("the 21 inns and what a bed costs in each", () => {
    assert.equal(inns.length, 21, "the inn table ships 21 records");
    const tariffs = innTariffs(inns);
    assert.equal(tariffs.length, inns.length, "one row per inn, counted from the file");
    // Names repeat across regions (two Forest Inns, two Swamp Inns...), so the map
    // id is what tells one record from another.
    for (const t of tariffs) {
        const inn = inns.find((i) => i.name === t.name && i.map === t.map);
        assert.ok(inn, `${t.name} on ${t.map} exists in inn_ui.json`);
        assert.equal(t.price, inn.price_per_digimon, "the price is the record's own price_per_digimon");
    }
    assert.deepEqual(
        tariffs.map((t) => [t.name, t.map, t.price]),
        inns.map((i) => [i.name, i.map, i.price_per_digimon]).sort((a, b) => a[2] - b[2] || a[0].localeCompare(b[0])),
        "every inn appears once, at its own price");
    const prices = inns.map((i) => i.price_per_digimon);
    assert.deepEqual(tariffs.map((t) => t.price), prices.slice().sort((a, b) => a - b), "cheapest bed first");
    assert.equal(Math.min(...prices), 8, "Asuka Inn is the cheapest bed");
    assert.equal(Math.max(...prices), 88, "the dearest bed");
});

test("the sell shelf is every piece no shop sells but a shop pays for", () => {
    const shelf = sellShelf(effects);
    const computed = effects.items
        .filter((r) => (Number(r.buy) || 0) === 0 && (Number(r.sell) || 0) > 0)
        .map((r) => r.id);
    assert.equal(shelf.length, computed.length, "the list is computed from the prices, not typed");
    assert.equal(shelf.length, 60);
    assert.deepEqual(shelf.map((r) => r.id).slice().sort((a, b) => a - b), computed.slice().sort((a, b) => a - b));
    for (const r of shelf) {
        assert.ok(r.sell > 0);
        assert.equal(typeof r.name, "string");
        assert.ok(r.name.length > 0);
    }
    assert.deepEqual(shelf.slice(0, 3).map((r) => r.sell), [2000, 2000, 2000], "dearest sale first");
});

test("the module is pure: no page, no storage, no fetch", () => {
    assert.doesNotMatch(moduleSrc, /\bdocument\b/);
    assert.doesNotMatch(moduleSrc, /\bwindow\b/);
    assert.doesNotMatch(moduleSrc, /\blocalStorage\b/);
    assert.doesNotMatch(moduleSrc, /\bsessionStorage\b/);
    assert.doesNotMatch(moduleSrc, /\bfetch\s*\(/);
});

test("the page reads only the five shipped tables, and has no auction line", () => {
    const files = [...new Set([...(pageSrc + pageScript).matchAll(/assets\/data\/[a-z_0-9]+\.json/g)].map((m) => m[0]))].sort();
    assert.deepEqual(files, [
        "assets/data/bank70_money_grants.json",
        "assets/data/inn_ui.json",
        "assets/data/item_effects.json",
        "assets/data/progression.json",
        "assets/data/shops.json",
    ], "five tables, no second source of truth");
    assert.match(pageSrc, /<script type="module" src="\.\/bit-ledger-page\.js"><\/script>/, "the page's own script");
    assert.match(pageScript, /from "\.\/bit-ledger\.js"/, "the page renders through the pure module");
    for (const fn of ["payoutStats", "grants", "shopPrices", "innTariffs", "sellShelf", "afford", "capAdd"]) {
        assert.match(pageScript, new RegExp(`\\b${fn}\\b`), `the page uses ${fn}`);
    }
    for (const id of ["cap", "fights", "grants", "shops", "inns", "shelf"]) {
        assert.match(pageSrc, new RegExp(`id="${id}"`), `the page has a ${id} section`);
    }
    // There is no auction data file in this checkout, so no auction figure is printed.
    assert.doesNotMatch(pageSrc + pageScript, /auction/i);
});

test("the F2 switch is off by default and gates the row, the page and its data", () => {
    const ambience = readText("../web/ambience.js");
    assert.match(ambience, /\["bitledger", "BIT ledger \(new\)"\]/, "the F2 Extras row");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"bitledger"/, "off until the player switches it on");
    assert.match(ambience, /id="fx-bitledger" hidden/, "the button row ships hidden");
    assert.match(ambience, /const bitLedger = panel\.querySelector\("#fx-bitledger"\); if \(bitLedger\) bitLedger\.hidden = !fx\.bitledger;/, "refreshPanel follows the switch");
    assert.match(ambience, /if \(fx\.bitledger\)[^;{}]*window\.open\("bit-ledger\.html", "_blank", "noopener"\)/, "opened only behind the toggle's guard");
    assert.equal(ambience.split("bit-ledger.html").length - 1, 1, "one reference to the page, no other link into it");
    assert.doesNotMatch(ambience, /(get|has)\("bitledger"\)/, "never a URL flag");
    assert.match(ambience, /#fx-panel \.row\[hidden\] \{ display:none; \}/, "the panel's own rule that makes a hidden row vanish");
});
