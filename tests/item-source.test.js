// The Item Source Book: the world's own index of where every one of the disc's
// 402 items comes from. Every answer is read from the shipped extraction files
// (web/assets/data/item_obtain_index.json and the shop, merchant and price
// tables it joins) — a kind of source the files do not name never becomes a row.
//
// F2 -> Extras -> "Item source book (new)" (off by default). With the switch off
// there is no row to click, no page and no data fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexRows, sourcesFor, shopRows, priceWord, nothingLine } from "../web/item-source.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const index = read("../web/assets/data/item_obtain_index.json");
const shops = read("../web/assets/data/shops.json");
const merchants = read("../web/assets/data/merchant_shops.json");
const effects = read("../web/assets/data/item_effects.json");
const equipment = read("../web/assets/data/equipment.json");
const data = { index, shops, merchants, effects, equipment };
const items = index.items;
const idOf = (name) => Object.entries(items).find(([, r]) => r.name === name)?.[0];

test("the index holds 402 items: 367 with a source and 35 with none", () => {
    assert.equal(Object.keys(items).length, 402, "the extraction covers every shipped item id");
    const withSource = Object.values(items).filter((r) => (r.sources || []).length > 0);
    const without = Object.entries(items).filter(([, r]) => (r.sources || []).length === 0);
    assert.equal(withSource.length, 367, "367 items have a non-empty sources list");
    assert.equal(without.length, 35, "35 items carry []");
    assert.equal(index.unobtainable.length, 35, "the file's own unobtainable list has 35 rows");
    const noneIds = without.map(([id]) => Number(id)).sort((a, b) => a - b);
    const listed = index.unobtainable.map((r) => r.id).sort((a, b) => a - b);
    assert.deepEqual(noneIds, listed, "the 35 empty rows are exactly the unobtainable list");

    // Every source in the file is one of the five decoded kinds.
    const kinds = new Set();
    for (const r of Object.values(items)) for (const s of r.sources || []) kinds.add(s.kind);
    assert.deepEqual([...kinds].sort(), ["cutscene", "drop", "native", "shop", "talk"]);
});

test("indexRows gives one list row per item, sorted by id, count of real sources", () => {
    const rows = indexRows(index);
    assert.equal(rows.length, 402);
    assert.deepEqual(rows.map((r) => r.id).slice(0, 4), [1, 2, 3, 4], "sorted by item id");
    assert.equal(rows[0].id, 1);
    assert.equal(rows[0].name, "BalancedPack");
    assert.equal(rows[0].category, "key");
    assert.equal(rows[0].count, 1, "BalancedPack's only source is the disc's unopened shop");
    const empty = rows.find((r) => r.id === 68);
    assert.equal(empty.count, 0, "a source-less item counts zero");
    const charge = rows.find((r) => r.id === 43);
    assert.deepEqual(charge, { id: 43, name: "PowerCharge", category: "consumable", count: 23 }, "11 shops + 11 talks + 1 drop");
    const pole = rows.find((r) => r.id === 5);
    assert.equal(pole.count, 3, "FishingPole repeats a talk row in the file; the list counts places, not lines");
});

test("PowerCharge (43): 11 shops, 11 talk grants, one Betamon drop, the real price", () => {
    const rec = sourcesFor(43, data);
    assert.equal(rec.id, 43);
    assert.equal(rec.name, "PowerCharge");
    assert.equal(rec.category, "consumable");
    assert.equal(rec.nothing, false);
    assert.equal(rec.shops.length, 11, "the idea said 3 shops; the shop table says 11");
    assert.deepEqual(rec.shops.map((s) => s.shop_id), [2, 4, 6, 9, 12, 14, 17, 21, 24, 27, 29]);
    assert.equal(rec.talks.length, 11);
    assert.equal(rec.cutscenes.length, 0);
    assert.equal(rec.natives.length, 0);
    assert.equal(rec.drops.length, 1);
    assert.equal(rec.drops[0].enemy, "Betamon");
    assert.equal(rec.drops[0].rate, 192);
    assert.match(rec.drops[0].where, /rate 192 of 1024/);

    assert.equal(priceWord(43, effects), "12 BIT (sells for 6)");

    const asuka = rec.shops.find((s) => s.shop_id === 2);
    assert.equal(asuka.name, "Asuka Item Shop");
    assert.equal(asuka.stage, "s245", "the merchant row that stocks shop 2 stands on s245");
    assert.equal(asuka.npc_id, 22);
    assert.deepEqual(asuka.stages, ["s245"]);
    assert.match(asuka.where, /Asuka Item Shop/);
    assert.match(asuka.where, /s245/);

    // A shop that stands on two stages keeps both, one row for the source.
    const am = rec.shops.find((s) => s.shop_id === 17);
    assert.equal(am.name, "AM Item Shop");
    assert.deepEqual(am.stages, ["s246", "s931"]);
    assert.equal(am.stage, "s246", "the first stage the merchant row names");
    assert.equal(am.npc_id, 22);
});

test("shop 30 is the disc's unopened shop: a stock, no merchant, no stage", () => {
    const pole = sourcesFor(5, data);
    assert.equal(pole.shops.length, 1);
    const s30 = pole.shops[0];
    assert.equal(s30.shop_id, 30);
    assert.equal(s30.unopened, true);
    assert.equal(s30.stage, null, "no stage entry names a stage for shop 30");
    assert.equal(s30.npc_id, null, "no merchant row stocks shop 30");
    assert.equal(s30.name, null, "the shop table has no name for it");
    assert.match(s30.where, /unopened shop/);
    assert.doesNotMatch(s30.where, /s\d{3}/, "never invents a stage");
});

test("shopRows resolves one source to its shop name, its stages and its merchant", () => {
    const row = shopRows({ kind: "shop", shop_id: 2, stages: ["s245"] }, shops, merchants);
    assert.equal(row.name, "Asuka Item Shop");
    assert.deepEqual(row.stages, ["s245"]);
    assert.deepEqual(row.merchants, [{ stage: "s245", npc_id: 22 }]);
    assert.equal(row.stage, "s245");
    assert.equal(row.npc_id, 22);
    // A shop the shop table does not name can never gain an invented name.
    const unknown = shopRows({ kind: "shop", shop_id: 99, stages: [] }, shops, merchants);
    assert.equal(unknown.name, null);
    assert.equal(unknown.stage, null);
    assert.equal(unknown.npc_id, null);
    assert.match(unknown.where, /unknown shop 99/);
});

test("FishingPole (5): the file repeats a talk row; the book prints it once", () => {
    const raw = items[idOf("FishingPole")].sources.filter((s) => s.kind === "talk" && s.stage === "s340" && s.npc_id === 282);
    assert.equal(raw.length, 2, "the extraction really lists s340/npc 282 twice");
    const rec = sourcesFor(5, data);
    const once = rec.talks.filter((s) => s.stage === "s340" && s.npc_id === 282);
    assert.equal(once.length, 1, "the book de-duplicates a repeated grant");
    assert.deepEqual(rec.talks.map((t) => [t.stage, t.npc_id]), [["s340", 282], ["s942", 282]]);

    // The same rule on a fixture: the same source twice is one row.
    const fixture = {
        index: { items: { 1: { name: "Fixture", category: "key", sources: [
            { kind: "talk", stage: "s1", npc_id: 7 },
            { kind: "talk", stage: "s1", npc_id: 7 },
            { kind: "drop", enemy: "Agumon", rate: 64 },
            { kind: "drop", enemy: "Agumon", rate: 64 },
        ] } }, unobtainable: [] },
        shops: { shops: [] }, merchants: { merchants: [] }, effects: { items: [] },
    };
    const rec2 = sourcesFor(1, fixture);
    assert.equal(rec2.talks.length, 1);
    assert.equal(rec2.drops.length, 1);
});

test("an id the file does not hold is null, never a guessed row", () => {
    assert.equal(sourcesFor(999, data), null);
    assert.equal(sourcesFor(0, data), null);
    assert.equal(sourcesFor(43, { index: { items: {} } }), null);
});

test("the 35 source-less items say so in their own category's words", () => {
    assert.match(nothingLine(items["68"]), /nothing in the retail game gives this consumable/);
    assert.match(nothingLine(items["375"]), /nothing in the retail game gives this card booster/);
    assert.equal(sourcesFor(68, data).nothing, true);
    assert.equal(sourcesFor(68, data).shops.length + sourcesFor(68, data).drops.length, 0);
    assert.match(nothingLine(items["1"]), /key item/);
    // The 35 are 2 consumables and 33 card boosters, never one blanket sentence.
    const lines = index.unobtainable.map((r) => nothingLine(r));
    assert.equal(lines.filter((l) => /this consumable/.test(l)).length, 2);
    assert.equal(lines.filter((l) => /this card booster/.test(l)).length, 33);
    // A record with no category still gets an honest line.
    assert.match(nothingLine({ name: "X", category: null }), /this item/);
});

test("priceWord reads the shipped price table, equipment's own field names included", () => {
    assert.equal(priceWord(43, effects), "12 BIT (sells for 6)");
    assert.equal(priceWord(1, effects), "no price (0 BIT buy, 0 BIT sell)");
    // equipment.json names them buy_price/sell_price; the fallback must not guess.
    assert.equal(priceWord(92, effects), "200 BIT (sells for 100)");
    assert.equal(priceWord(92, { items: [] }, equipment), "200 BIT (sells for 100)");
    assert.equal(priceWord(92, effects, equipment), "200 BIT (sells for 100)");
    // The two price files agree on all 268 pieces of equipment, so the page only
    // has to fetch item_effects.json.
    let agree = 0;
    for (const eq of equipment.equipment) {
        const row = effects.items.find((r) => r.id === eq.id);
        assert.ok(row, `${eq.name} is in the effects table too`);
        assert.equal(row.buy, eq.buy_price, `${eq.name} buy price`);
        assert.equal(row.sell, eq.sell_price, `${eq.name} sell price`);
        agree++;
    }
    assert.equal(agree, 268);
});

test("the module is pure: no page, no storage, no flag write, no fetch", () => {
    const src = readFileSync(new URL("../web/item-source.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /\bdocument\b/);
    assert.doesNotMatch(src, /\bwindow\b/);
    assert.doesNotMatch(src, /\blocalStorage\b/);
    assert.doesNotMatch(src, /\bsessionStorage\b/);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /flag_id|setFlag|set_flag/);
});

test("the page fetches only the four shipped data files it needs", () => {
    const page = readFileSync(new URL("../web/item-source.html", import.meta.url), "utf8");
    const script = readFileSync(new URL("../web/item-source-page.js", import.meta.url), "utf8");
    const files = [...new Set([...(page + script).matchAll(/assets\/data\/[a-z_0-9]+\.json/g)].map((m) => m[0]))].sort();
    assert.deepEqual(files, [
        "assets/data/item_effects.json",
        "assets/data/item_obtain_index.json",
        "assets/data/merchant_shops.json",
        "assets/data/shops.json",
    ]);
    assert.match(page, /<script type="module" src="\.\/item-source-page\.js"><\/script>/, "the page's own script");
    assert.match(script, /from "\.\/item-source\.js"/, "the page renders through the pure module");
    for (const fn of ["indexRows", "sourcesFor", "priceWord", "nothingLine"]) {
        assert.match(script, new RegExp(`\\b${fn}\\b`), `the page uses ${fn}`);
    }
    assert.match(script, /rows\.length/, "the list is built from the 402 rows, not a hand list");
});

test("the F2 switch is off by default and gates the row, the page and its data", () => {
    const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
    assert.match(ambience, /\["itemsource", "Item source book \(new\)"\]/, "the F2 Extras row");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"itemsource"/, "off until the player switches it on");
    assert.match(ambience, /id="fx-itemsource" hidden/, "the button row ships hidden");
    assert.match(ambience, /const itemSource = panel\.querySelector\("#fx-itemsource"\); if \(itemSource\) itemSource\.hidden = !fx\.itemsource;/, "refreshPanel follows the switch");
    assert.match(ambience, /if \(fx\.itemsource\)[^;{}]*window\.open\("item-source\.html", "_blank", "noopener"\)/, "opened only behind the toggle's guard");
    assert.equal(ambience.split("item-source.html").length - 1, 1, "one reference to the page, no other link into it");
    assert.doesNotMatch(ambience, /(get|has)\("itemsource"\)/, "never a URL flag");
    assert.match(ambience, /#fx-panel \.row\[hidden\] \{ display:none; \}/, "the panel's own rule that makes a hidden row vanish");
});
