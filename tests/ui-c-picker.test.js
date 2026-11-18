// tests/ui-c-picker.test.js -- look C kit, T2 (partner pickers): highlight states by palette row, the cursor colour cycle, the SORT swap
// bracket, the item detail band, the lab / gym info card, the "Switch with who?" window, the shop "Equip who?" parts, the stripe field,
// and the claims for these screens. Synthetic fixtures only (no disc data): sizes are made up, the rules are what is tested.
import test from "node:test";
import assert from "node:assert/strict";
import { claimFor } from "../web/ui-c/claims.js";
import { begin, clipHook, end } from "../web/ui-c/capture.js";
import {
    LOCKED_ROW, cardStates, cyclePulse, composeBracket, composeDetail, readInfoRuns, composeInfoCard, switchTreePath, composeSwitchWindow,
    shopDetailRects, composeArrows, composeWindowPage,
} from "../web/ui-c/pages.js";
import { bracketPath, stripesGradient } from "../web/ui-c/parts.js";

const ID = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const part = (o) => ({ bx: 0, by: 0, rel: ID, row: 0, ...o });

// ------------------------------------------------------------------------------------------------ claims
test("claims: the T2 clips are parts, the pictures on them stay art", () => {
    assert.equal(claimFor("ststat", 40).part, "bracket");
    assert.equal(claimFor("ststat", 41).part, "bracket");
    assert.equal(claimFor("ststat", "30#8").part, "highlight", "a palette row id resolves to its base clip");
    assert.equal(claimFor("ststat", 47).part, "detail");
    assert.equal(claimFor("stdglabo", 45).part, "switchWin");
    assert.equal(claimFor("stdglabo", 45).layers, true, "the switch window reads its cells from the sheet layers");
    for (const id of [56, 51, 59]) assert.equal(claimFor("stdglabo", id).part, "art");
    for (const id of [11, 12]) assert.equal(claimFor("cmfont", id).part, "art");
    assert.deepEqual([65, 66, 67, 68, 36].map((id) => claimFor("cmfont", id).part), ["name", "money", "priceWin", "window", "window"]);
    assert.deepEqual([21, 14, 8, 15, 22].map((id) => claimFor("stshop", id).part), ["header", "shopDetail", "pcard", "pickHl", "art"]);
    assert.equal(claimFor("stshop", 14).layers, true);
});

test("capture: a claim with layers: true gets the clip's sheet layers as rects relative to the draw position", () => {
    const ctx = { getTransform: () => ({ a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 }) };
    const pack = { name: "stdglabo", ids: { 45: { layers: [{ dx: 0, dy: 0, w: 100, h: 90 }, { dx: 5.7, dy: 6, w: 40, h: 60 }] } } };
    begin("k", ctx, { a: 3, d: 3, e: 0, f: 0 }, () => null);
    assert.equal(clipHook(ctx, pack, 45, 160, 30, () => assert.fail("claimed")), true);
    const s = end();
    assert.deepEqual(s.parts[0].layers, [{ x: 0, y: 0, w: 100, h: 90 }, { x: 5, y: 6, w: 40, h: 60 }]);
    assert.deepEqual([s.parts[0].w, s.parts[0].h], [100, 90]);
});

// ------------------------------------------------------------------------------------------------ highlight state + colour cycle
test("card states come from the highlight's palette row: row 8 = the held (locked) partner, any other row = the cursor", () => {
    assert.equal(LOCKED_ROW, 8);
    const cards = [{ y: 17 }, { y: 63 }, { y: 109 }];
    assert.deepEqual(cardStates(cards, []), ["normal", "normal", "normal"]);
    assert.deepEqual(cardStates(cards, [{ y: 63, row: 8 }, { y: 17, row: 3 }]), ["on", "locked", "normal"]);
    assert.deepEqual(cardStates(cards, [{ y: 110, row: 0 }]), ["normal", "normal", "on"], "within 3 native of the card");
    assert.deepEqual(cardStates(cards, [{ y: 40, row: 0 }]), ["normal", "normal", "normal"], "between cards = none");
});

test("cyclePulse: orange at row 0, amber at row 4, back again; period 8", () => {
    assert.equal(cyclePulse(0), "#f89800");
    assert.equal(cyclePulse(4), "#ffd26a");
    assert.equal(cyclePulse(8), cyclePulse(0));
    assert.equal(cyclePulse(2), cyclePulse(6), "a triangle wave: up and down the same steps");
    assert.notEqual(cyclePulse(2), cyclePulse(0));
    const g = (row) => parseInt(cyclePulse(row).slice(3, 5), 16);
    assert.ok(g(0) < g(1) && g(1) < g(2) && g(2) < g(3) && g(3) < g(4), "brightens towards row 4");
});

// ------------------------------------------------------------------------------------------------ swap bracket
test("the swap bracket: arrows 7 native below the top and 8 above the bottom, for both bracket heights", () => {
    for (const [h, rel, want] of [[106, ID, [7, 98]], [61, ID, [7, 53]], [61, { ...ID, a: 1.5, d: 1.5 }, [10.5, 79.5]]]) {
        const out = [];
        composeBracket(part({ part: "bracket", x: 100, y: 20, w: 24, h, rel }), out);
        assert.equal(out.length, 1);
        assert.equal(out[0].kind, "bracket");
        assert.equal(out[0].layer, "over");
        assert.deepEqual(out[0].arrows, want);
    }
});

test("bracketPath: one bar from the top arrow to the bottom arrow, one head per arrow; none without arrows", () => {
    assert.equal(bracketPath(72, 318, 3, []), "");
    const d = bracketPath(72, 318, 3, [21, 294]);
    assert.equal((d.match(/M/g) ?? []).length, 3, "bar + two heads");
    assert.match(d, /^M\d+ \d+H/);
    assert.ok((d.match(/M0 /g) ?? []).length === 2, "each head starts at the left edge (points at the portrait)");
});

// ------------------------------------------------------------------------------------------------ item detail band
test("the item detail band is full width with three dividers; numbers right-anchored, labels past 624 dp dim, the name in Russo 22", () => {
    const runs = [
        { text: "Short Sword", x: 20, y: 101 },
        { text: "Equip", x: 160, y: 101 }, { text: "0", x: 200, y: 101, right: 205, w: 6 },
        { text: "Items", x: 230, y: 101 }, { text: "3", x: 290, y: 101, right: 295, w: 6 },
        { text: "far", x: 10, y: 10 },
    ];
    const out = [], used = new Set();
    composeDetail(part({ part: "detail", x: 0, y: 98, w: 320, h: 16 }), runs, used, out);
    const band = out.find((o) => o.key === "detail.band");
    assert.equal(band.rect.x, 0); assert.equal(band.rect.w, 320);
    assert.equal(out.filter((o) => /^detail\.div/.test(o.key)).length, 3);
    assert.equal(used.size, 5, "only the runs on the line are taken");
    const nums = out.filter((o) => /^detail\.n\d/.test(o.key));
    assert.equal(nums.length, 2);
    for (const n of nums) assert.equal(n.align, "right");
    assert.ok(out.some((o) => o.key === "detail.name"));
});

// ------------------------------------------------------------------------------------------------ lab / gym info card
const infoRuns = () => [
    { text: "Kotemon", x: 104, y: 6 },
    { text: "LV", x: 104, y: 20 }, { text: "1", x: 120, y: 20 },
    { text: "HP", x: 104, y: 32 }, { text: "40", x: 150, y: 32, right: 160, w: 10 }, { text: "/", x: 161, y: 32 }, { text: "86", x: 166, y: 32, right: 178, w: 12 },
    { text: "MP", x: 104, y: 41 }, { text: "38", x: 150, y: 41 }, { text: "/", x: 161, y: 41 }, { text: "38", x: 166, y: 41 },
];

test("readInfoRuns: the name is the top non-label run; LV / HP / MP rows read their numbers in x order", () => {
    const r = readInfoRuns(infoRuns());
    assert.equal(r.name.text, "Kotemon");
    assert.deepEqual(r.stats.map((s) => [s.id, s.values]), [["LV", ["1"]], ["HP", ["40", "86"]], ["MP", ["38", "38"]]]);
    assert.equal(r.stats[1].right, 178);
    const ph = readInfoRuns([{ text: "ーーーーー", x: 104, y: 6 }, { text: "HP", x: 104, y: 32 }, { text: "ーーーー", x: 150, y: 32 }]);
    assert.deepEqual(ph.stats[0].values, [], "placeholder rows carry no numbers");
});

test("composeInfoCard: bars from the drawn numbers, cur/max text, every run on the card used", () => {
    const runs = infoRuns(), used = new Set(), out = [];
    composeInfoCard(part({ part: "info", shape: "sr", x: 0, y: 0, w: 190, h: 60 }), 0, runs, used, out);
    const bars = out.filter((o) => o.kind === "bar");
    assert.equal(bars.length, 2);
    assert.ok(Math.abs(bars[0].ratio - 40 / 86) < 1e-9);
    assert.equal(bars[1].ratio, 1);
    assert.ok(out.some((o) => o.text === "40/86"));
    assert.ok(out.some((o) => o.text === "Kotemon"));
    assert.equal(used.size, runs.length);
});

// ------------------------------------------------------------------------------------------------ "Switch with who?"
test("switchTreePath: one bar plus an arrow per cell; empty without cells", () => {
    assert.equal(switchTreePath([], [], 30), "");
    const d = switchTreePath([10, 58, 106], [58], 30);
    assert.equal((d.match(/M/g) ?? []).length, 5);
    assert.ok(!/NaN/.test(d));
});

test("composeSwitchWindow: window plate, a frame per capsule cell, the tree as an svg path, all from the clip's layers", () => {
    const layers = [
        { x: 0, y: 0, w: 220, h: 180 },
        { x: 10, y: 5, w: 44, h: 71 }, { x: 58, y: 5, w: 44, h: 71 }, { x: 106, y: 5, w: 44, h: 71 },
        { x: 30, y: 78, w: 112, h: 24 },
        { x: 58, y: 104, w: 44, h: 71 },
    ];
    const out = [];
    composeSwitchWindow(part({ part: "switchWin", x: 160, y: 40, w: 220, h: 180, layers }), 0, out);
    assert.equal(out.filter((o) => o.part === "window").length, 1);
    assert.equal(out.filter((o) => o.part === "cell").length, 4);
    const tree = out.find((o) => o.part === "tree");
    assert.equal(tree.kind, "svg");
    assert.deepEqual([tree.vw, tree.vh], [112, 24]);
    assert.equal((tree.d.match(/M/g) ?? []).length, 1 + 3 + 1, "three arrows up, one down");
});

// ------------------------------------------------------------------------------------------------ shop "Equip who?"
test("shopDetailRects: name | stats on the top row, the price plate under the right end, split at the clip's tall layers", () => {
    const L = [{ x: 0, y: 0, w: 60, h: 20 }, { x: 60, y: 0, w: 40, h: 20 }, { x: 100, y: 0, w: 60, h: 34 }, { x: 160, y: 0, w: 40, h: 34 }];
    assert.deepEqual(shopDetailRects(L), [
        { x: 0, y: 0, w: 100, h: 20, shape: "ch" },
        { x: 100, y: 0, w: 100, h: 20, shape: "ch" },
        { x: 160, y: 20, w: 40, h: 14, shape: "sl" },
    ]);
    assert.deepEqual(shopDetailRects([{ x: 0, y: 0, w: 80, h: 20 }]), [{ x: 0, y: 0, w: 80, h: 20, shape: "ch" }], "no split = one plate");
    assert.deepEqual(shopDetailRects([]), []);
});

test("composeArrows: the stat-change token becomes an orange chevron, never raw text", () => {
    const runs = [{ text: "48", x: 50, y: 120 }, { text: "[arrow-right]", x: 70, y: 120 }, { text: "62", x: 90, y: 120 }];
    const used = new Set(), out = [];
    composeArrows(runs, used, out);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, "chevron");
    assert.ok(used.has(runs[1]) && !used.has(runs[0]));
    const page = composeWindowPage({ parts: [], runs });
    assert.ok(!page.some((o) => o.text === "[arrow-right]"));
    assert.equal(page.filter((o) => o.kind === "chevron").length, 1);
});

test("composeWindowPage: the shop cursor frame is corner brackets in the cycle colour of its palette row", () => {
    const out = composeWindowPage({ parts: [part({ part: "pickHl", layer: "over", x: 10, y: 150, w: 90, h: 73, row: 4 })], runs: [] });
    const c = out.find((o) => o.kind === "corners");
    assert.equal(c.color, cyclePulse(4));
    assert.deepEqual([c.rect.x, c.rect.y, c.rect.w, c.rect.h], [10, 150, 90, 73]);
});

// ------------------------------------------------------------------------------------------------ stripe field
test("stripesGradient: one period is always 24 dp light + 48 dp dark, and a full period of scroll gives the same field (no seam)", () => {
    const d = 3, P = 72 * d;
    const stops = (g) => [...g.matchAll(/(var\(--c-stripe(?:-dark)?\)) ([\d.]+)(?:px)? ([\d.]+)px/g)].map((m) => [m[1].includes("dark") ? "D" : "L", +m[2], +m[3]]);
    for (const scroll of [0, 1, 7.5, 13, 16.9, 40, 123.4]) {
        const s = stops(stripesGradient(scroll, d));
        const light = s.filter((x) => x[0] === "L").reduce((a, x) => a + x[2] - x[1], 0);
        assert.ok(Math.abs(light - 24 * d) < 0.05, `light width at scroll ${scroll}: ${light}`);
        assert.ok(Math.abs(s[s.length - 1][2] - P) < 0.01, "the period ends at 72 dp");
    }
    const period = 24 / Math.SQRT2;                     // native scroll that moves the field one 72 dp period along the 135 degree axis
    assert.equal(stripesGradient(5 + period, d), stripesGradient(5, d));
});
