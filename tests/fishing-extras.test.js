// Fishing extra rewards (web/fishing-extras.js, data/authored/web/assets/data/fishing_extras.json).
//
// The disc catch is a battle and is never touched: the roll is a separate draw
// that only picks an extra. These tests are pure (seeded random, no browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    tableFor, totalPercent, rollExtra, messageFor, createFishFinds, extrasRows, findKey, FISH_FINDS_KEY,
} from "../web/fishing-extras.js";
import { encodeChar } from "../web/dialogue-pack.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = read("../data/authored/web/assets/data/fishing_extras.json");
const fish = read("../web/assets/data/fishing_spots.json");
const enc = read("../web/assets/data/field_encounters.json").screens;
const effects = read("../web/assets/data/item_effects.json").items;
const rewards = read("../web/assets/data/progression.json").battle_rewards;
const itemById = new Map(effects.map((i) => [i.id, i]));
const B = data.balance;

/** a small seeded generator (mulberry32) */
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const worth = (id) => { const i = itemById.get(id); return i.buy > 0 ? i.buy : i.sell * 2; };

test("every fishing stage has an extras entry, and nothing else", () => {
    assert.deepEqual(Object.keys(data.stages).sort(), Object.keys(fish).sort());
    assert.equal(Object.keys(data.stages).length, 46);
});

test("the tier of each stage is its slot-4 Cardmon level through the stated table", () => {
    for (const stage of Object.keys(fish)) {
        const level = enc[String(fish[stage].catch["4"].screenId)][0].level;
        assert.equal(data.stages[stage].tier, B.tier_by_cardmon_level[String(level)], stage);
    }
});

test("every stage's total extra chance is within 3 to 8 percent", () => {
    for (const stage of Object.keys(data.stages)) {
        const total = totalPercent(tableFor(data, stage));
        assert.ok(total >= B.min_total_percent && total <= B.max_total_percent, `${stage}: ${total}`);
    }
});

test("item ids are real, the name matches, keys are unique, chances are sane", () => {
    for (const area of data.areas) {
        const keys = new Set();
        for (const e of area.entries) {
            assert.ok(!keys.has(e.key), `${area.id} ${e.key} twice`);
            keys.add(e.key);
            assert.ok(e.chance > 0 && e.chance <= 3, `${area.id} ${e.key} chance`);
            assert.ok(e.tiers.length >= 1 && e.tiers.every((t) => t >= 1 && t <= 4));
            if (e.kind === "item") {
                const item = itemById.get(e.item);
                assert.ok(item, `${area.id} ${e.key}: item ${e.item}`);
                assert.equal(item.name, e.name);
                assert.notEqual(item.category, "key", "never a key item");
            } else if (e.kind === "bits") {
                assert.ok(Number.isInteger(e.bits) && e.bits > 0);
            } else if (e.kind === "hint") {
                assert.ok(data.hints[e.hint], `${area.id} ${e.key}: hint ${e.hint}`);
            } else assert.fail(`kind ${e.kind}`);
        }
    }
});

test("balance rule: item worth under the tier ceiling, very rare up to double, cards are the disc's card class", () => {
    const cards = new Set(B.card_pack_item_ids);
    for (const area of data.areas) {
        for (const e of area.entries) {
            if (e.kind !== "item") continue;
            const tier = Math.max(...e.tiers);
            if (cards.has(e.item)) {
                assert.ok(e.item === 91 || (e.item >= 361 && e.item <= 394), "card pack id range");
                continue;
            }
            const ceiling = B.item_value_ceiling[String(tier)] * (e.very_rare ? B.very_rare_multiplier : 1);
            assert.ok(worth(e.item) <= ceiling, `${area.id} ${e.key}: ${worth(e.item)} > ${ceiling}`);
            if (e.very_rare) assert.ok(e.chance <= B.very_rare_max_percent, `${e.key} very rare means 1 percent or less`);
        }
    }
});

test("balance rule: bits never beat the smallest win of that tier's big water Digimon", () => {
    const smallest = {};
    for (const stage of Object.keys(fish)) {
        const tier = data.stages[stage].tier;
        const bits = rewards[fish[stage].catch["7"].screenId][2];
        smallest[tier] = Math.min(smallest[tier] ?? Infinity, bits);
    }
    for (const t of [1, 2, 3, 4]) assert.ok(B.bits_ceiling[String(t)] <= smallest[t], `tier ${t}: ${B.bits_ceiling[t]} vs ${smallest[t]}`);
    for (const area of data.areas) {
        for (const e of area.entries) {
            if (e.kind === "bits") assert.ok(e.bits <= B.bits_ceiling[String(Math.max(...e.tiers))], `${area.id} ${e.key}`);
        }
    }
});

test("the roll: disc catch untouched, extra rate inside the stated range, seeded", () => {
    // The roll never reads or changes the stage's catch record: it is handed only `data`.
    const before = JSON.stringify(fish);
    const N = 200000;
    for (const stage of ["s202", "s331", "s451", "s716"]) {
        const total = totalPercent(tableFor(data, stage));
        const rand = seeded(7);
        let hits = 0;
        for (let i = 0; i < N; i++) if (rollExtra(data, stage, rand)) hits++;
        const rate = (hits / N) * 100;
        assert.ok(rate >= 3 - 0.3 && rate <= 8 + 0.3, `${stage}: measured ${rate}`);
        assert.ok(Math.abs(rate - total) < 0.3, `${stage}: measured ${rate} vs table ${total}`);
    }
    assert.equal(JSON.stringify(fish), before, "the fishing catch table is not written");
    // same seed, same result
    const a = seeded(99), b = seeded(99);
    for (let i = 0; i < 1000; i++) assert.deepEqual(rollExtra(data, "s340", a), rollExtra(data, "s340", b));
    // the roll draws exactly one random number and a draw past the table is no extra
    let draws = 0;
    rollExtra(data, "s202", () => { draws++; return 0.999; });
    assert.equal(draws, 1);
    assert.equal(rollExtra(data, "s202", () => 0.999), null);
    assert.equal(rollExtra(data, "s999", () => 0), null, "a map with no fishing has no table");
});

test("each entry is reachable at its stated width and only on its tier", () => {
    const table = tableFor(data, "s203"); // tier 2
    assert.ok(table.every((e) => e.tiers.includes(2)));
    let at = 0;
    for (const e of table) {
        const hit = rollExtra(data, "s203", () => (at + e.chance / 2) / 100);
        assert.equal(hit.entry.key, e.key);
        at += e.chance;
    }
});

test("messages use only characters the disc text has, and bottle hints fit the box", () => {
    const text = [];
    for (const area of data.areas) {
        for (const e of area.entries) text.push(messageFor(data, area, e, e.name ?? null));
    }
    for (const t of text) {
        for (const ch of t.replace(/\n/g, "")) assert.ok(encodeChar(ch).length > 0, `no code for "${ch}" in: ${t}`);
    }
    for (const h of data.hints) for (const ch of h) assert.ok(encodeChar(ch).length > 0, `no code for "${ch}" in a hint`);
});

test("found flags: remembered in storage, only once, readable by the almanac as ???", () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const finds = createFishFinds(storage);
    const area = data.areas.find((a) => a.id === "shell-beach");
    const entry = area.entries[0];
    assert.equal(finds.isFound(area.id, entry), false);
    assert.equal(finds.note(area.id, entry), true);
    assert.equal(finds.note(area.id, entry), false);
    assert.equal(finds.isFound(area.id, entry), true);
    assert.ok(JSON.parse(mem.get(FISH_FINDS_KEY))[findKey(area.id, entry)]);
    const rows = extrasRows(data, finds.read(), (id) => itemById.get(id).name);
    const row = rows.find((r) => r.stage === "s340");
    assert.equal(rows.length, 46);
    assert.equal(row.entries[0].found, true);
    assert.equal(row.entries[0].label, entry.name);
    assert.ok(row.entries.slice(1).every((x) => !x.found && x.label === "???" && x.percent === null));
    // damaged storage reads as empty
    mem.set(FISH_FINDS_KEY, "{not json");
    assert.deepEqual(createFishFinds(storage).read(), {});
});
