// The OPTIONS screen (web/options-book.js): keys reach the model, sounds play once per move, and drawing a whole page does not throw.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOptionsBook, pixelFilterChoices } from "../web/options-book.js";
import { LIST_WINDOW, listRowY } from "../web/ui-kit.js";
import { DETAIL_KEYS } from "../web/options-model.js";

function fakeCtx() {
    const log = [];
    return new Proxy({}, {
        get: (_t, n) => (n === "log" ? log : n === "measureText" ? () => ({ width: 10 }) : (...a) => { log.push([n, ...a]); }),
        set: () => true,
    });
}
function setup() {
    const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off", battleSpeed: 2, encounterDialMode: "normal", musicVolume: 1, soundVolume: 1 };
    for (const k of DETAIL_KEYS) fx[k] = true;     // the game starts with every effect on
    const sounds = [];
    const book = createOptionsBook({ sfx: { play: (n) => sounds.push(n) }, fx: () => fx, setFxMany: (o) => Object.assign(fx, o) });
    return { fx, sounds, book };
}
const keys = (...k) => new Set(k);

test("Back leaves; arrows, Q and E reach the model; a move that does nothing is silent", () => {
    const { fx, sounds, book } = setup();
    assert.equal(book.act(keys("cross")), "back");
    assert.equal(book.act(keys("up")), null);
    assert.deepEqual(sounds, [], "already on the first row: no sound");
    book.act(keys("down"));
    assert.equal(book.model.row(), 1);
    book.act(keys("l1"));
    assert.equal(book.model.page(), 0, "no page before the first");
    book.act(keys("r1"));
    assert.equal(book.model.page(), 1);
    book.act(keys("up"));                       // page SCREEN, first row: nothing above it
    assert.deepEqual(sounds, ["system02", "system02"], "down, then the page; the up did nothing");
    book.act(keys("left"));                     // Detail High -> the level below it
    assert.equal(sounds.length, 3);
    assert.notEqual(fx.quality, "high");
    book.act(keys("right"));
    assert.equal(fx.quality, "high");
});

test("one acting frame does one thing (Back wins over everything else)", () => {
    const { book } = setup();
    assert.equal(book.act(keys("cross", "down", "r1")), "back");
    assert.equal(book.model.row(), 0);
    assert.equal(book.model.page(), 0);
});

test("the pixel filter list is Off plus the GPU filters", () => {
    const ids = pixelFilterChoices().map((f) => f[0]);
    assert.equal(ids[0], "off");
    assert.ok(ids.includes("epx") && !ids.includes("nearest4"));
});

test("every page draws without throwing, with the windows folded in, half open and shut", () => {
    const { book } = setup();
    for (let page = 0; page < 4; page++) {
        for (const p of [0, 0.5, 1]) {
            const ctx = fakeCtx();
            assert.doesNotThrow(() => book.draw(ctx, { progress: () => p, ticks: 7 }), `page ${page} at ${p}`);
        }
        book.act(keys("r1"));
    }
});

test("the list uses the QUESTS page places: rows at x 189, y 49 + 14 i, cursor at x 176", () => {
    assert.deepEqual([LIST_WINDOW.textX, LIST_WINDOW.textY, LIST_WINDOW.pitch, LIST_WINDOW.cursorX], [0xbd, 0x31, 0xe, 0xb0]);
    assert.deepEqual([0, 1, 8].map(listRowY), [49, 63, 161]);
    const quests = readFileSync(new URL("../engine/dw3/ui/native/pause-quests.ts", import.meta.url), "utf8");
    assert.match(quests, /createText\(layer, 1, 0xbd, 0x31 \+ i \* 0xe\)/);
    assert.match(quests, /drawSprite\(pack\(PACK_CMFONT\), 0x24, 0xa8, 0x28\)/);
    assert.deepEqual([LIST_WINDOW.x, LIST_WINDOW.y], [0xa8, 0x28]);
});

// ---- fix round 1: header hints, wide window, full labels
import { OPTIONS_WINDOW, headerLayout, rowLayout } from "../web/options-book.js";
import { EFFECT_CATEGORIES, LIST_ROWS, PAGES, buildRows } from "../web/options-model.js";

// the game font advances (web/assets/ui/uifont.json, a local symlink: these tests skip when it is missing)
function fontMeasure() {
    let map;
    try { map = JSON.parse(readFileSync(new URL("../web/assets/ui/uifont.json", import.meta.url), "utf8")); } catch { return null; }
    const alias = { "▶": "[arrow-right]", "◀": "[arrow-left]" };
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
const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];

test("L1 and R1 hints touch neither the title nor any tab, and the bar fits the 320 box", { skip: !fontMeasure() && "font data not present" }, () => {
    const m = fontMeasure(), labels = PAGES.map((p) => p.label);
    const h = headerLayout((s) => m(s, 1), "OPTIONS", labels, m("L1", 3));
    const boxes = [h.title, h.l1, ...h.tabs, h.r1];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `box ${i} and ${j} overlap`);
    for (let i = 0; i + 1 < boxes.length; i++) assert.ok(boxes[i + 1][0] - boxes[i][1] >= 4, `gap after box ${i}`);
    assert.ok(h.r1[1] <= 320, `R1 ends at ${h.r1[1]}`);
});

test("headerLayout never overlaps, even with the 7 px fallback measure", () => {
    const h = headerLayout((s) => s.length * 7, "OPTIONS", PAGES.map((p) => p.label));
    const boxes = [h.title, h.l1, ...h.tabs, h.r1];
    for (let i = 0; i + 1 < boxes.length; i++) assert.ok(boxes[i][1] < boxes[i + 1][0]);
});

test("the OPTIONS list window is 5 columns (200 px) with the old right edge; QUESTS places stay", () => {
    assert.equal(OPTIONS_WINDOW.cols, 5);
    assert.equal(OPTIONS_WINDOW.x + 200, LIST_WINDOW.x + LIST_WINDOW.w);
    assert.equal(OPTIONS_WINDOW.textX - OPTIONS_WINDOW.x, LIST_WINDOW.textX - LIST_WINDOW.x);
    assert.equal(OPTIONS_WINDOW.cursorX - OPTIONS_WINDOW.x, LIST_WINDOW.cursorX - LIST_WINDOW.x);
    assert.ok(OPTIONS_WINDOW.valueRight + 14 < 320, "right arrow stays inside the frame");
});

test("no label is shortened on any row with any value (real font measure)", { skip: !fontMeasure() && "font data not present" }, () => {
    const m = fontMeasure(), rows = buildRows(pixelFilterChoices());
    for (const p of PAGES) for (const id of p.rows) {
        const row = rows[id];
        row.choices.forEach((value, i) => {
            const t = rowLayout((s, k) => m(s, k), { label: row.label, value, numeric: !!row.numeric, canLeft: i > 0, canRight: i < row.choices.length - 1 });
            assert.equal(t.label, row.label, `${row.label} with ${value}`);
        });
        if (row.customLabel) assert.equal(rowLayout((s, k) => m(s, k), { label: row.label, value: row.customLabel(), numeric: false, canLeft: true, canRight: true }).label, row.label);
    }
});

test("no EFFECTS label is shortened, with On or Off, the arrows, a category value, or Back (real font measure)", { skip: !fontMeasure() && "font data not present" }, () => {
    const m = fontMeasure();
    const fit = (label, value, canLeft, canRight) => assert.equal(rowLayout((s, k) => m(s, k), { label, value, numeric: false, canLeft, canRight }).label, label, `${label} with ${value}`);
    for (const c of EFFECT_CATEGORIES) {
        for (const v of ["All", "Some", "None"]) fit(c.label, v, false, true);
        for (const i of c.items) { fit(i.label, "On", true, false); fit(i.label, "Off", false, true); }
    }
    fit("Back", "", false, false);
});

test("the cancel button closes an open category first and leaves OPTIONS only from the list; confirm opens and flips", () => {
    const { fx, book } = setup();
    book.act(keys("r1")); book.act(keys("r1")); book.act(keys("r1"));
    assert.equal(book.model.page(), 3);
    book.act(keys("circle"));                  // Weather opens
    assert.equal(book.model.inCategory(), true);
    book.act(keys("circle"));                  // Rain flips off
    assert.equal(fx.rain, false);
    assert.equal(book.act(keys("cross")), null, "closes the category only");
    assert.equal(book.model.inCategory(), false);
    assert.equal(book.act(keys("cross")), "back");
});

test("an open category with more rows than the window scrolls and draws without throwing, arrows included", () => {
    const { book } = setup();
    for (let i = 0; i < 3; i++) book.act(keys("r1"));
    book.act(keys("down")); book.act(keys("down"));
    book.act(keys("circle"));                  // Atmosphere (12 switches + Back)
    for (let i = 0; i < 12; i++) book.act(keys("down"));
    const ctx = fakeCtx();
    assert.doesNotThrow(() => book.draw(ctx, { progress: () => 1, ticks: 3 }));
    assert.ok(ctx.log.length > 0);
});

test("every row of every page lies inside the OPTIONS window, and the window ends above the help box (y 194)", () => {
    const W = OPTIONS_WINDOW, top = W.y, bottom = W.y + 22 + 14 * W.bands + 20;
    const most = Math.max(...PAGES.map((p) => p.rows.length));
    assert.equal(W.bands + 2, LIST_ROWS, "tall enough for the 9 rows on screen at once");
    assert.ok(most <= LIST_ROWS);
    for (const p of PAGES) for (let i = 0; i < p.rows.length; i++) {
        const y = listRowY(i);
        assert.ok(y >= top + 8 && y + 12 <= bottom - 7, `${p.id} row ${i}: y ${y}..${y + 12} in ${top}..${bottom}`);
    }
    // the same margin as the disc 8-row panel (rows y 49..159 in 40..166)
    assert.equal(listRowY(7) + 12, 40 + 22 + 14 * 6 + 20 - 7);
    assert.ok(bottom < 194, `window ends at ${bottom}`);
});
