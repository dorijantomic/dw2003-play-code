// The DIGIMON screen (web/glossary-book.js): keys, sounds, geometry and drawing with a fake canvas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLOSSARY_LAYOUT, cardLines, createGlossaryBook, fitCounts } from "../web/glossary-book.js";
import { buildSpecies, headerCounts } from "../web/glossary-digimon.js";
import { layoutTabs } from "../web/ui-kit.js";

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const P = (id, name) => ({ id, name, hp: 100, mp: 50, str: 10, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL }, resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [9], tech_learn_levels: [], tech_load_levels: [], blasts: [], is_starter: true });
const names = ["Kotemon", "Imperialdramon-F", "BK WarGreymon", "Agumon", "Gabumon", "Patamon", "Veemon", "Guilmon", "Renamon", "Betamon", "Kunemon", "Gizamon"];
const DATA = buildSpecies({ digimon: { digimon: names.map((n, i) => P(i + 1, n)), skills: [{ id: 9, name: "Pepper Breath", element: "fire" }] }, enemies: { enemies: [] }, evolutions: { lines: [] } });
// 240 species, three-digit numbers, long names, for the width tests
const BIG_NAMES = Array.from({ length: 240 }, (_, i) => (i === 7 ? "Imperialdramon-F" : i === 8 ? "BK WarGreymon" : `Mon${i}x${"m".repeat(i % 9)}`));
const BIG = buildSpecies({ digimon: { digimon: BIG_NAMES.map((n, i) => P(i + 1, n)), skills: [{ id: 9, name: "Pepper Breath", element: "fire" }] }, enemies: { enemies: [] }, evolutions: { lines: [] } });
const log = (met = {}, beaten = {}) => ({ metCount: (n) => met[n] || 0, beatenCount: (n) => beaten[n] || 0, totals: () => ({ met: Object.keys(met).length, beaten: Object.keys(beaten).length }), read: () => ({}) });

// A canvas that records fillText and measures 7 px a letter (what textWidth falls back to while the font is not loaded).
function fakeCtx() {
    const calls = [], texts = [];
    return new Proxy({}, {
        get: (_t, n) => (n === "calls" ? calls : n === "texts" ? texts
            : n === "measureText" ? (s) => ({ width: String(s).length * 7 })
            : n === "fillText" ? (s, x, y) => { texts.push({ s: String(s), x, y: y - 11, w: String(s).length * 7, h: 12 }); calls.push([n, s, x, y]); }
            : (...a) => { calls.push([n, ...a]); }),
        set: () => true,
    });
}
function setup({ met = { Kotemon: 1 }, beaten = { Kotemon: 1 }, partners = [], data = DATA } = {}) {
    const sounds = [], flips = [];
    const book = createGlossaryBook({ sfx: { play: (n) => sounds.push(n), playPacked: (n) => flips.push(n) }, getSpecies: () => data, getLog: () => log(met, beaten), getPartners: () => partners, stage: null });
    return { book, sounds, flips };
}
const keys = (...k) => new Set(k);
const open = (ticks = 100) => ({ progress: () => 1, ticks, dt: 0.02 });

// the game font advances (web/assets/ui/uifont.json, a local symlink: the real-font tests skip when it is missing)
function fontMeasure() {
    let map;
    try { map = JSON.parse(readFileSync(new URL("../web/assets/ui/uifont.json", import.meta.url), "utf8")); } catch { return null; }
    const alias = { "▲": "[arrow-up]", "▼": "[arrow-down]" };
    const tbl = (k, t) => k[t === "b" ? "basic" : "ext"];
    return (text, kind = 1) => {
        let w = 0;
        for (const ch0 of String(text)) {
            const c = map.chars[alias[ch0] ?? ch0];
            const k = map.kinds[String(kind)] ?? map.kinds["1"];
            const g = c && (tbl(k, c.t)[String(c.i)] ?? tbl(map.kinds["1"], c.t)[String(c.i)]);
            w += g ? (g.dx || 0) + (g.adv || g.w + 1) : 6;
        }
        return w;
    };
}
const measure = fontMeasure();
const real = { skip: measure ? false : "web/assets/ui/uifont.json is not available" };

test("the book names its four windows in opening order and sits on the wall", () => {
    const { book } = setup();
    assert.deepEqual(book.windows, ["title", "list", "model", "footer"]);
    assert.equal(book.wall, true);
});

test("Back leaves; up and down move one species with the cursor sound; left and right jump ten; a move that does nothing is silent", () => {
    const { book, sounds } = setup();
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("up")), null);
    assert.deepEqual(sounds, []);
    book.act(keys("down"));
    assert.equal(book.model.index(), 1);
    book.act(keys("right"));
    assert.equal(book.model.index(), 11);
    assert.deepEqual(sounds, ["system02", "system02"]);
});

test("R1 opens page 2 only for a species the player has defeated; L1 goes back; the flip plays the open and close sounds", () => {
    const { book, flips } = setup({ met: { Kotemon: 1, "Imperialdramon-F": 1 }, beaten: { Kotemon: 1 } });
    book.act(keys("r1"));
    assert.equal(book.model.page(), 1);
    book.act(keys("l1"));
    assert.equal(book.model.page(), 0);
    book.act(keys("down"));                       // Imperialdramon-F: met only
    book.act(keys("r1"));
    assert.equal(book.model.page(), 0, "no page 2 before the first defeat");
    assert.equal(flips.length, 2, "only the two real flips made a sound");
});

test("on page 2 left and right change species by one and up and down scroll the lines", () => {
    const { book } = setup();
    book.act(keys("r1"));
    book.act(keys("right"));
    assert.equal(book.model.index(), 1);
    book.act(keys("left"));
    assert.equal(book.model.index(), 0);
    book.act(keys("down"));
    assert.equal(book.model.line(), 1);
    assert.equal(book.model.index(), 0, "up and down did not move the species");
});

test("the rectangles lie inside the 320 x 240 box, above the footer, and the three panels do not overlap", () => {
    const L = GLOSSARY_LAYOUT;
    for (const [name, r] of Object.entries({ list: L.list, model: L.model, card: L.card })) {
        assert.ok(r.x >= 0 && r.y >= 40 && r.y + r.h <= 194, `${name} is under the header and above the footer`);
        assert.ok(r.x + r.w <= 328, `${name} ends at or before x 328 (the disc's panels bleed past 320)`);
    }
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.equal(hit(L.list, L.model), false);
    assert.equal(hit(L.list, L.card), false);
    assert.equal(hit(L.model, L.card), false);
});

test("the text boxes lie inside their windows: list columns in order, card text inside the card, the picture inside the model panel", () => {
    const L = GLOSSARY_LAYOUT;
    assert.ok(L.countsX >= L.list.x && L.countsRight <= L.list.x + L.list.w - 6);
    assert.ok(L.cursorX + 8 <= L.numberRight - 3 * 7 + 0, "the cursor (8 px) ends before the number column starts (three digits at 7 px at most)");
    assert.ok(L.numberRight < L.nameX && L.nameX < L.nameRight && L.nameRight <= L.arrowX, "number, name and scroll arrow are three separate columns");
    assert.ok(L.arrowX + 9 <= L.list.x + L.list.w - 6, "the scroll arrow (9 px) stays inside the frame");
    assert.ok(L.cardX >= L.card.x + 6 && L.cardRight <= L.card.x + L.card.w - 6);
    assert.ok(L.image.x >= L.model.x + 6 && L.image.x + L.image.w <= L.model.x + L.model.w - 6);
    assert.ok(L.image.y >= L.model.y + 6 && L.image.y + L.image.h <= L.model.y + L.model.h - 6);
    for (const y of L.cardRows) assert.ok(y >= L.card.y + 6 && y + 12 <= L.card.y + L.card.h - 6, `card row ${y}`);
});

test("the counts line is fitted by measured width and keeps both numbers when only the double space is too wide", () => {
    const w = (s) => s.length * 5;
    assert.equal(fitCounts("Met 34/240  Beaten 12", w, 200), "Met 34/240  Beaten 12");
    assert.equal(fitCounts("Met 34/240  Beaten 12", w, 103), "Met 34/240 Beaten 12", "one space instead of two");
    assert.ok(w(fitCounts("Met 34/240  Beaten 12", w, 60)) <= 60, "and cut only if even that does not fit");
});

test("the counts line with the biggest numbers fits the list window and keeps both counts (real font)", real, () => {
    const L = GLOSSARY_LAYOUT;
    const worst = headerCounts(Array.from({ length: 240 }, (_, i) => ({ name: `n${i}` })), { metCount: () => 1, beatenCount: () => 1 }).text;
    assert.equal(worst, "Met 240/240  Beaten 240");
    const shown = fitCounts(worst, (s) => measure(s), L.countsRight - L.countsX);
    assert.ok(measure(shown) <= L.countsRight - L.countsX, `${measure(shown)} px in ${L.countsRight - L.countsX}`);
    assert.ok(/Met 240\/240 +Beaten 240$/.test(shown), shown);
});

test("list columns fit the real font: the cursor clears three digits, the longest name fits, the arrow clears the name (real font)", real, () => {
    const L = GLOSSARY_LAYOUT;
    assert.ok(L.cursorX + 8 <= L.numberRight - measure("240", 3), "cursor, then number");
    assert.ok(measure("Imperialdramon-F") <= L.nameRight - L.nameX, `name ${measure("Imperialdramon-F")} px in ${L.nameRight - L.nameX}`);
    assert.ok(measure("▲") + L.arrowX <= L.list.x + L.list.w - 6);
});

test("the header row (as drawn: title, then the three tabs, no L1 / R1 marks) keeps its parts apart and inside the plate (real font)", real, () => {
    const xs = layoutTabs(["DIGIMON", "ITEMS", "PLACES"], (s) => measure(s), 44 + measure("GLOSSARY") + 16, 12);
    const boxes = [[44, 44 + measure("GLOSSARY")], ...["DIGIMON", "ITEMS", "PLACES"].map((t, i) => [xs[i], xs[i] + measure(t)])];
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i][0] >= boxes[i - 1][1] + 4, `box ${i} starts after box ${i - 1}`);
    assert.ok(boxes[boxes.length - 1][1] <= 320);
});

test("the card text is wrapped by measured width into at most the card's rows (real font)", real, () => {
    const L = GLOSSARY_LAYOUT;
    const wide = { title: "Imperialdramon-F", row1: "Found at level 100-100", record: "Met  Defeated x99  Your partner" };
    const lines = cardLines(wide, (s) => measure(s), L.cardRight - L.cardX, L.cardRows.length);
    assert.ok(lines.length <= L.cardRows.length);
    for (const l of lines) assert.ok(measure(l) <= L.cardRight - L.cardX, `"${l}" is ${measure(l)} px`);
    assert.ok(lines.join(" ").includes("Your partner"), "nothing was dropped");
});

test("cardLines: title first, then the level line when there is one, then the record wrapped over what rows are left", () => {
    const w = (s) => s.length * 7;
    assert.deepEqual(cardLines({ title: "Kotemon", row1: "Lv 9", record: "Met" }, w, 200, 4), ["Kotemon", "Lv 9", "Met"]);
    assert.deepEqual(cardLines({ title: "Kotemon", row1: "", record: "Met" }, w, 200, 4), ["Kotemon", "Met"]);
    assert.deepEqual(cardLines({ title: "???", row1: "", record: "" }, w, 200, 4), ["???"]);
    const cut = cardLines({ title: "A", row1: "B", record: "one two three four five six seven" }, w, 70, 4);
    assert.equal(cut.length, 4, "never more rows than the card has");
});

test("everything drawn on page 1 and 2, at the top, at the bottom of the list and while folding, stays inside its window and touches no other text", () => {
    const L = GLOSSARY_LAYOUT;
    const inside = (t, r) => t.x >= r.x && t.x + t.w <= r.x + r.w && t.y >= r.y && t.y + t.h <= r.y + r.h;
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const partners = [{ slot: 0, rookie: BIG.species[0].name, form: BIG.species[0].name, level: 9, live: { level: 9, formLevels: {}, stats: {} } }];
    const met = {}, beaten = {};
    BIG.species.forEach((sp, i) => { met[sp.name] = 1 + (i % 5); beaten[sp.name] = i % 4 === 0 ? 99 : 0; });
    for (const jumpTo of [0, 5, 120, 239]) for (const page of [0, 1]) {
        const { book } = setup({ data: BIG, met, beaten, partners });
        assert.equal(BIG.species.length, 240);
        book.model.jump(jumpTo);
        if (page === 1) book.act(keys("r1"));
        const ctx = fakeCtx();
        for (let i = 0; i < 60; i++) book.tick();
        book.draw(ctx, open(100));
        const texts = ctx.texts.filter((t) => !t.s.startsWith("["));
        const windows = [["list", L.list], ...(page === 1 ? [["pane", L.pane]] : [["model", L.model], ["card", L.card]]), ["footer", { x: 0, y: 194, w: 320, h: 46 }], ["header", { x: 0, y: 0, w: 320, h: 40 }]];
        for (const t of texts) {
            const home = windows.find(([, r]) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h);
            assert.ok(home, `"${t.s}" at ${t.x},${t.y} is in no window`);
            assert.ok(inside(t, home[1]), `"${t.s}" at ${t.x},${t.y} w ${t.w} leaves the ${home[0]} window`);
        }
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
            assert.equal(hit(texts[i], texts[j]), false, `"${texts[i].s}" overlaps "${texts[j].s}" (species ${jumpTo}, page ${page})`);
        }
    }
});

test("the counts line is drawn on the list window's first row, not in the title bar", () => {
    const { book } = setup();
    const ctx = fakeCtx();
    book.draw(ctx, open());
    const t = ctx.texts.find((x) => x.s.startsWith("Met "));
    assert.ok(t, "a counts line was drawn");
    assert.ok(t.y >= GLOSSARY_LAYOUT.list.y && t.y < GLOSSARY_LAYOUT.list.y + 20);
});

test("every fold stage draws without throwing, on every species state and both pages", () => {
    for (const partners of [[], [{ slot: 0, rookie: "Kotemon", form: "Kotemon", level: 9, live: { level: 9, formLevels: {}, stats: {} } }]]) {
        const { book } = setup({ met: { Kotemon: 1, "Imperialdramon-F": 1 }, beaten: { Kotemon: 2 }, partners });
        for (const p of [0, 0.5, 1]) for (const page of [0, 1]) {
            if (page === 1) book.act(keys("r1"));
            assert.doesNotThrow(() => book.draw(fakeCtx(), { progress: () => p, ticks: 10, dt: 0.02 }));
        }
    }
});

test("the stage is asked for the first species once the tables are in, for each move, and is closed with the book", () => {
    const shown = []; let closed = 0;
    const book = createGlossaryBook({ sfx: null, getSpecies: () => DATA, getLog: () => log({ Kotemon: 1 }, {}), getPartners: () => [],
        stage: { show: (n, o) => shown.push([n, o.shadow]), draw: () => true, close: () => { closed++; } } });
    book.tick();
    book.act(keys("down"));
    assert.deepEqual(shown, [["Kotemon", false], ["Imperialdramon-F", true]], "an unmet species is asked for as a shadow");
    book.close();
    assert.equal(closed, 1);
});

test("while the tables are still loading the book draws a plain message and still answers Back", () => {
    const book = createGlossaryBook({ sfx: null, getSpecies: () => null, getLog: () => log(), getPartners: () => [], stage: null });
    assert.doesNotThrow(() => book.draw(fakeCtx(), open(0)));
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("down")), null);
});

test("the stage is told the species' profile id, so it can fall back to the partner picture", () => {
    const seen = [];
    const book = createGlossaryBook({ sfx: null, getSpecies: () => DATA, getLog: () => log({ Kotemon: 1 }, {}), getPartners: () => [],
        stage: { show: (n, o) => seen.push([n, o.partnerId]), draw: () => true, close() {} } });
    book.tick();
    assert.deepEqual(seen[0], ["Kotemon", DATA.species[0].profileId ?? null]);
});
