// Stage Select v2 (web/stagslct.js) — the developers' own table, as the August
// 2026 complete decode reads it (docs/research/ui/stagslct-full-decode-2026-08-05.md).
//
// The shipped asset keeps the 297 records in `menuRows` (270 launchable entries,
// 20 horizontal rules, 7 section headings) and the 31 developer-overlay rows in
// their own `categories` list. v2 puts them back together in the table's own
// order: 270 entry + 31 category + 7 heading + 20 separator = 328 rows.
// Everything here is node-only: no browser, no screenshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextEntryRow, v2Rows, createStagslctMenu } from "../web/stagslct.js";

const DATA = JSON.parse(readFileSync(new URL("../web/assets/data/stagslct_ui.json", import.meta.url), "utf8"));
const SOURCE = readFileSync(new URL("../web/stagslct.js", import.meta.url), "utf8");
const AMBIENCE = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");

function countKinds(rows) {
    const out = { entry: 0, category: 0, heading: 0, separator: 0 };
    for (const row of rows) out[row.kind] = (out[row.kind] || 0) + 1;
    return out;
}

function fakeStorage(initial = {}) {
    const items = { ...initial };
    return {
        items,
        getItem: (k) => (k in items ? items[k] : null),
        setItem: (k, v) => { items[k] = String(v); },
        removeItem: (k) => { delete items[k]; },
    };
}

function fakeCtx() {
    const texts = [];
    return {
        texts,
        fillStyle: "",
        font: "",
        imageSmoothingEnabled: true,
        save() {},
        restore() {},
        fillRect() {},
        fillText(t) { texts.push(String(t)); },
        measureText(t) { return { width: String(t).length * 6 }; },
        drawImage() {},
    };
}

test("v2 restores the developers' 328-row table with its four kinds", () => {
    const rows = v2Rows(DATA);
    assert.equal(rows.length, 328, "270 entry + 31 category + 7 heading + 20 separator");
    const kinds = countKinds(rows);
    assert.equal(kinds.entry, 270, "launchable entries (239 field screens + 31 developer rows)");
    assert.equal(kinds.category, 31, "the 31 developer-overlay rows, drawn as category tags");
    assert.equal(kinds.heading, 7, "section headings");
    assert.equal(kinds.separator, 20, "horizontal rules");
    // The asset itself keeps the 297 records and the 31 category rows apart.
    assert.equal(DATA.menuRows.length, 297);
    assert.equal(DATA.categories.length, 31);
    // The first row is a category tag for the screen's own row; the first
    // selectable row is the entry right under it.
    assert.equal(rows[0].kind, "category");
    assert.equal(nextEntryRow(rows, 0, 1), 1, "from row 0 the cursor lands on the first entry");
    const entries = rows.filter((r) => r.kind === "entry");
    assert.equal(entries.length - 1, 269, "the last entry index is 269");
    assert.equal(rows[nextEntryRow(rows, rows.length - 1, -1)].kind, "entry", "walking back from the end lands on an entry");
});

test("nextEntryRow skips every non-entry row in both directions", () => {
    const rows = v2Rows(DATA);
    assert.equal(nextEntryRow(rows, 0, 1), 1);
    assert.equal(nextEntryRow(rows, 2, 1), 4, "a separator skips forward to the next entry");
    assert.equal(nextEntryRow(rows, 2, -1), 1, "and backward to the previous one");
    assert.equal(nextEntryRow(rows, 327, -1), 326, "the trailing separator walks back to the last entry");
    assert.equal(nextEntryRow(rows, 326, 1), 326, "from an entry it stays on it");
    assert.equal(nextEntryRow(rows, 327, 1), -1, "past the end there is no entry");
    // Every returned row really is an entry, and the count is the 270 entries.
    let seen = 0;
    for (let i = nextEntryRow(rows, 0, 1); i >= 0; i = nextEntryRow(rows, i + 1, 1)) seen++;
    assert.equal(seen, 270);
});

test("the chrome numbers are the build routine's own", () => {
    assert.equal(DATA.chrome.list.rows_visible, 14, "14 rows at file 0x21f4");
    assert.equal(DATA.chrome.list.y_base, 45);
    assert.equal(DATA.chrome.list.row_pitch, 12);
    assert.equal(DATA.chrome.cursor.x, 14);
});

test("a stored cursor and scroll come back when the screen reopens, and movement saves them", () => {
    const storage = fakeStorage({ "dw.stagslct.v2": JSON.stringify({ cursor: 40, scroll: 0 }) });
    globalThis.localStorage = storage;
    globalThis.window = { __fx: { stageselect: true } };
    try {
        const menu = createStagslctMenu(DATA);
        menu.show();
        assert.equal(menu.cursor, 40, "cursor restored");
        assert.equal(menu.scroll, 27, "cursor 40 in a 14-row window scrolls to 27 (40 - 14 + 1)");

        menu.handleKey("arrowdown");
        assert.equal(menu.cursor, 41);
        assert.equal(menu.scroll, 28, "the window keeps the cursor on its last row");
        const saved = JSON.parse(storage.items["dw.stagslct.v2"]);
        assert.deepEqual(saved, { cursor: 41, scroll: 28 });

        menu.hide();
        const again = createStagslctMenu(DATA);
        again.show();
        assert.equal(again.cursor, 41, "position remembered across visits");
        assert.equal(again.scroll, 28);
    } finally {
        delete globalThis.localStorage;
        delete globalThis.window;
    }
});

test("with the switch off the stored position is ignored and the old screen is drawn", () => {
    const storage = fakeStorage({ "dw.stagslct.v2": JSON.stringify({ cursor: 40, scroll: 27 }) });
    globalThis.localStorage = storage;
    globalThis.window = { __fx: { stageselect: false } };
    try {
        const menu = createStagslctMenu(DATA);
        menu.show();
        assert.equal(menu.cursor, 0, "off: the old screen always starts at row 0");
        assert.equal(menu.scroll, 0);
        const ctx = fakeCtx();
        menu.draw(ctx, 320, 240);
        assert.ok(ctx.texts.includes("Stage Select"), "the old screen still draws its title");
        assert.ok(!ctx.texts.some((t) => t.startsWith("0x")), "the old screen has no category launch-code rows");

        menu.handleKey("arrowdown");
        assert.equal(storage.items["dw.stagslct.v2"], JSON.stringify({ cursor: 40, scroll: 27 }),
            "off: moving the old screen never writes the v2 store");
    } finally {
        delete globalThis.localStorage;
        delete globalThis.window;
    }
});

test("with the switch on the screen draws the category tags, headings and rules", () => {
    globalThis.window = { __fx: { stageselect: true } };
    try {
        const menu = createStagslctMenu(DATA);
        menu.show();
        const ctx = fakeCtx();
        menu.draw(ctx, 320, 240);
        assert.ok(ctx.texts.includes("Stage Select"), "title");
        assert.ok(ctx.texts.includes("August 2026 decode"), "the v2 header names the decode it follows");
        assert.ok(ctx.texts.some((t) => t.startsWith("0x")), "a category row draws its launch code");
        assert.ok(ctx.texts.some((t) => t.includes("―")), "a horizontal rule row is drawn");
    } finally {
        delete globalThis.window;
    }
});

test("the file keeps the old and the v2 branch behind window.__fx?.stageselect", () => {
    assert.match(SOURCE, /window\.__fx\?\.stageselect/);
    assert.match(SOURCE, /function drawV1\b/, "the old rendering is still there");
    assert.match(SOURCE, /function drawV2\b/, "the v2 rendering is there");
    assert.match(SOURCE, /dw\.stagslct\.v2/, "the persisted store key");
    assert.doesNotMatch(SOURCE, /stagslct-decoded-2026-07-11\.md/, "the stale July header is gone");
    assert.match(SOURCE, /stagslct-full-decode-2026-08-05\.md/, "the header cites the August decode");
});

test("F2 -> Extras -> Stage select (dev) is wired and off by default", () => {
    assert.match(AMBIENCE, /\["stageselect", "Stage select \(dev\)"\]/);
    const experimental = AMBIENCE.match(/const EXPERIMENTAL = \[([^\]]*)\]/);
    assert.ok(experimental, "EXPERIMENTAL list found");
    assert.match(experimental[1], /"stageselect"/, "stageselect is experimental, so a preset never turns it on");
    assert.match(AMBIENCE, /for \(const k of MANUAL\) fx\[k\] = false;/, "experimental keys start off");
});
