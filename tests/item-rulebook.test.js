// The Item Rulebook: one page of the disc's own item numbers — what each field
// consumable really does, the caps each one runs into, the 25 items that only
// work inside a fight, and what a shop pays for the pieces it never sells.
//
// Everything shown is computed from the shipped effect table (web/assets/data/
// item_effects.json) and pinned here to the engine's own constants and to the
// decoded FIGHTSTG jump table (engine/dw3/battle-items.ts).
//
// F2 -> Extras -> "Item rulebook (new)" (off by default). With the switch off
// there is no row to click, no page and no data fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ruleRows, capWords, sellSheet, battleOnly, CAPS } from "../web/item-rulebook.js";
import { FIELD_BOOST_CAP_HP_MP, FIELD_BOOST_CAP_STAT } from "../engine/dw3/items.ts";
import { TP_CAP } from "../engine/dw3/item-effect.ts";
import { isBattleEffectItem } from "../engine/dw3/battle-items.ts";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const effects = read("../web/assets/data/item_effects.json");
const src = readFileSync(new URL("../web/item-rulebook.js", import.meta.url), "utf8");
const rows = ruleRows(effects);
const ids = (list) => list.map((r) => r.id);

test("the shipped table holds 402 items: 49 consumables, 23 field effects and 25 fight-only items", () => {
    assert.equal(effects.items.length, 402, "every shipped item id is in the effect table");
    assert.equal(effects.items.filter((r) => r.category === "consumable").length, 49);
    assert.equal(rows.hp.length + rows.tp.length + rows.stat.length + rows.elem.length, 23,
        "4 HP charges + 4 TP chips + 8 stat chips + 7 elemental disks");
    assert.equal(rows.battle.length, 25, "the fight-only band the jump table dispatches");
    // The one row tagged `booster` is a card pack, not a field effect: it belongs to
    // no group the rulebook prints.
    const booster = effects.items.find((r) => r.effect === "booster");
    assert.ok(booster, "the table does have one booster row");
    for (const group of [rows.hp, rows.tp, rows.stat, rows.elem, rows.battle]) {
        assert.ok(!group.some((r) => r.id === booster.id), "a booster never lands in an effect group");
    }
    // Groups are sorted by item id and every row carries the numbers the page prints.
    for (const group of [rows.hp, rows.tp, rows.stat, rows.elem, rows.battle]) {
        assert.deepEqual(ids(group).slice().sort((a, b) => a - b), ids(group));
        for (const r of group) {
            assert.equal(typeof r.name, "string");
            assert.ok(r.name.length > 0);
            assert.equal(typeof r.value, "number");
            assert.equal(typeof r.buy, "number");
            assert.equal(typeof r.sell, "number");
        }
    }
});

test("the four HP charges are 500 / 2000 / 5000 / 9999 at 12 / 120 / 260 / 0 BIT", () => {
    assert.equal(rows.hp.length, 4);
    assert.deepEqual(rows.hp.map((r) => [r.id, r.name, r.value, r.buy, r.sell]), [
        [43, "PowerCharge", 500, 12, 6],
        [44, "SuperCharge", 2000, 120, 60],
        [45, "UltraCharge", 5000, 260, 130],
        [46, "MaxCharge", 9999, 0, 200],
    ]);
    // The one no shop sells is MaxCharge: 0 BIT buy, 200 BIT sell.
    assert.equal(rows.hp.filter((r) => r.buy === 0).length, 1);
    assert.equal(rows.hp.find((r) => r.buy === 0).id, 46);
});

test("the four TP chips are the four TrainChips, ids 62-65, +1 / +2 / +3 / +5", () => {
    assert.equal(rows.tp.length, 4);
    assert.deepEqual(rows.tp.map((r) => [r.id, r.name, r.value, r.buy, r.sell]), [
        [62, "TrainChip1", 1, 0, 400],
        [63, "TrainChip2", 2, 0, 700],
        [64, "TrainChip3", 3, 0, 1000],
        [65, "TrainChipV", 5, 0, 1600],
    ]);
});

test("the eight stat chips are +30 HP/MP and +10 to the six stats", () => {
    assert.equal(rows.stat.length, 8);
    assert.deepEqual(rows.stat.map((r) => [r.id, r.effect, r.value]), [
        [47, "stat_hp", 30],
        [48, "stat_mp", 30],
        [49, "stat_str", 10],
        [50, "stat_def", 10],
        [51, "stat_spt", 10],
        [52, "stat_wis", 10],
        [53, "stat_spd", 10],
        [54, "stat_chr", 10],
    ]);
    assert.deepEqual(rows.stat.map((r) => r.name), [
        "HPChip", "MPChip", "PowerChip", "ArmorChip", "MindChip", "WisdomChip", "BoostChip", "CharismaChip",
    ]);
});

test("the seven elemental disks are +10 to each of the seven tolerances", () => {
    assert.equal(rows.elem.length, 7);
    assert.deepEqual(rows.elem.map((r) => [r.id, r.effect, r.value]), [
        [55, "elem_fire", 10],
        [56, "elem_water", 10],
        [57, "elem_ice", 10],
        [58, "elem_wind", 10],
        [59, "elem_thunder", 10],
        [60, "elem_machine", 10],
        [61, "elem_dark", 10],
    ]);
    assert.deepEqual(rows.elem.map((r) => r.name), [
        "FireChip", "WaterChip", "IceChip", "WindChip", "ThunderChip", "MetalChip", "DevilChip",
    ]);
});

test("the 25 fight-only rows are exactly the ids the FIGHTSTG jump table dispatches", () => {
    assert.deepEqual(ids(rows.battle), Array.from({ length: 25 }, (_, i) => 66 + i));
    assert.equal(rows.battle[0].name, "AntidoteDisk");
    assert.equal(rows.battle[24].name, "TNTBall");
    // The decoded table at 0x80082f1c is 48 words, indexed by ItemId - 43: its
    // window is 43..90, and the fight-only band is the tail 66..90.
    assert.equal(90 - 43 + 1, 48, "the jump table's 48-word window");
    assert.equal(isBattleEffectItem(43), false, "the charges run the field heal arm, not a fight handler");
    assert.equal(isBattleEffectItem(65), false, "the last TrainChip is still a field item");
    assert.equal(isBattleEffectItem(66), true);
    assert.equal(isBattleEffectItem(90), true);
    assert.equal(isBattleEffectItem(91), false, "past the table's last word");
    for (const r of rows.battle) assert.equal(isBattleEffectItem(r.id), true, `${r.name} is in the decoded band`);
    assert.deepEqual(ids(battleOnly(effects)), ids(rows.battle));
});

test("the sell sheet flags every piece a shop never sells but pays for, and every price that is not half", () => {
    const sheet = sellSheet(effects);
    const never = ids(sheet.neverSold);
    const odd = ids(sheet.notHalf);

    // The six the idea named are all here, and the list is computed, not hardcoded:
    // it is every row with a 0 BIT buy price and a real sell price.
    for (const id of [46, 62, 63, 64, 65, 337]) assert.ok(never.includes(id), `item ${id} is never sold but pays`);
    const computedNever = effects.items.filter((r) => r.buy === 0 && r.sell > 0).map((r) => r.id);
    assert.equal(never.length, computedNever.length);
    assert.deepEqual(never.slice().sort((a, b) => a - b), computedNever.slice().sort((a, b) => a - b));
    assert.ok(never.includes(85), "CrimsonCable is a fight throwable no shop sells");
    assert.ok(never.includes(90), "TNTBall too");

    // Half price is the rule, not the law: PowerCharge 12/6 is exactly half and stays
    // out; MaxCharge 0/200 cannot be half of anything and is in.
    assert.ok(!odd.includes(43), "PowerCharge 12/6 is exactly half");
    assert.ok(odd.includes(46), "MaxCharge 0/200 is not half");
    const computedOdd = effects.items.filter((r) => r.sell > 0 && r.sell * 2 !== r.buy).map((r) => r.id);
    assert.equal(odd.length, computedOdd.length);
    assert.deepEqual(odd.slice().sort((a, b) => a - b), computedOdd.slice().sort((a, b) => a - b));
    // Every row the sheet names carries a real sell price, and the two lists are rows,
    // sorted by id, not bare numbers.
    for (const r of [...sheet.neverSold, ...sheet.notHalf]) assert.ok(r.sell > 0);
    assert.deepEqual(ids(sheet.neverSold), never.slice().sort((a, b) => a - b));
});

test("the caps printed are the engine's own 9999 / 999 / 99, never a second copy", () => {
    assert.equal(CAPS.hpMp, FIELD_BOOST_CAP_HP_MP);
    assert.equal(CAPS.stat, FIELD_BOOST_CAP_STAT);
    assert.equal(CAPS.tp, TP_CAP);
    assert.equal(CAPS.hpMp, 9999);
    assert.equal(CAPS.stat, 999);
    assert.equal(CAPS.tp, 99);

    assert.match(capWords("hp", 500), /9999/, "an HP charge says where HP stops");
    assert.match(capWords("hp", 9999), /9999/);
    assert.match(capWords("tp", 5), /\b99\b/, "a TP chip says where TP stops");
    assert.match(capWords("stat_hp", 30), /9999/, "the HP chip raises max HP, which stops at 9999");
    assert.match(capWords("stat_mp", 30), /9999/);
    for (const e of ["stat_str", "stat_def", "stat_spt", "stat_wis", "stat_spd", "stat_chr"]) {
        assert.match(capWords(e, 10), /999/, `${e} stops at 999`);
    }
    for (const e of ["elem_fire", "elem_water", "elem_ice", "elem_wind", "elem_thunder", "elem_machine", "elem_dark"]) {
        assert.match(capWords(e, 10), /999/, `${e} stops at 999`);
    }
    assert.match(capWords("battle", 0), /only in a fight/i);
    assert.match(capWords("nonsense", 0), /no field effect/i);

    // The module runs in the browser, where engine/*.ts does not exist, so the three
    // numbers are kept here once — and this test is what pins them to the engine.
    assert.doesNotMatch(src, /9999/, "no bare 9999 literal: the cap is written once, as the disc's 0x270f");
    assert.match(src, /0x270f/i);
});

test("the module is pure: no page, no storage, no flag write, no fetch", () => {
    assert.doesNotMatch(src, /\bdocument\b/);
    assert.doesNotMatch(src, /\bwindow\b/);
    assert.doesNotMatch(src, /\blocalStorage\b/);
    assert.doesNotMatch(src, /\bsessionStorage\b/);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /flag_id|setFlag|set_flag/);
});

test("the page renders through the module and fetches only the effect table", () => {
    const page = readFileSync(new URL("../web/item-rulebook.html", import.meta.url), "utf8");
    const script = readFileSync(new URL("../web/item-rulebook-page.js", import.meta.url), "utf8");
    const files = [...new Set([...(page + script).matchAll(/assets\/data\/[a-z_0-9]+\.json/g)].map((m) => m[0]))].sort();
    assert.deepEqual(files, ["assets/data/item_effects.json"], "one table, no second source of truth");
    assert.match(page, /<script type="module" src="\.\/item-rulebook-page\.js"><\/script>/, "the page's own script");
    assert.match(script, /from "\.\/item-rulebook\.js"/, "the page renders through the pure module");
    for (const fn of ["ruleRows", "capWords", "sellSheet", "battleOnly"]) {
        assert.match(script, new RegExp(`\\b${fn}\\b`), `the page uses ${fn}`);
    }
    assert.match(script, /rules\[key\]/, "the list is built from the rulebook's own groups");
    assert.match(script, /rows\.length/, "the page prints the count it read, not a hand list");
});

test("the F2 switch is off by default and gates the row, the page and its data", () => {
    const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
    assert.match(ambience, /\["itemrulebook", "Item rulebook \(new\)"\]/, "the F2 Extras row");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"itemrulebook"/, "off until the player switches it on");
    const devModel = readFileSync(new URL("../web/dev-panel-model.js", import.meta.url), "utf8"), devPanel = readFileSync(new URL("../web/dev-panel.js", import.meta.url), "utf8");
    assert.match(devModel, /itemrulebook: P\("item-rulebook\.html"/, "the Open button's page is in the F2 page model");
    assert.match(ambience, /if \(!o \|\| !fx\[key\]\) return;/, "opened only behind the switch (the Open guard)");
    assert.match(devPanel, /b\.disabled = !fx\[/, "the Open button is disabled while the switch is off");
    assert.equal(devModel.split("item-rulebook.html").length - 1, 1, "one reference to the page, no other link into it");
    assert.equal(ambience.split("item-rulebook.html").length - 1, 0, "ambience.js itself has no link");
    assert.doesNotMatch(ambience, /(get|has)\("itemrulebook"\)/, "never a URL flag");
});
