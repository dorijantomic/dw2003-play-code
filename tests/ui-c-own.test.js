// Look C for our own screens (T9): the books (OPTIONS, GLOSSARY, World Globe MAP book, FLY; web/book-host.js), the pause QUESTS page and the
// Digivolve Demo page (web/menu.js). Pure: synthetic parts + text runs in, descriptors out (positions and strings only, no game data).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readSource } from "./helpers/source.js";
import { composeBook, composeBookHeader, BOOK, isDimRun } from "../web/ui-c/books.js";
import { composeFooter } from "../web/ui-c/pages.js";
import { pickPauseScreen, composeBookScreen, composeDemo } from "../web/ui-c/screens.js";
import { claimFor, CMFONT_DIR, STSTAT_DIR } from "../web/ui-c/claims.js";
import { PAGE_KEY } from "../web/ui-c/base.js";
import { IDENTITY, dx } from "../web/ui-c/geometry.js";

const src = (f) => readSource(new URL(`../${f}`, import.meta.url));
const run = (text, x, y, o = {}) => ({ text, x, y, kind: 1, clut: 0, right: null, w: text.length * 7, glyphs: [], ...o });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, w, h, bx: 0, by: 0, rel: IDENTITY, ...o });
const call = (dir, id) => ({ method: "drawSprite", args: [dir << 16, id] });
const by = (out, key) => out.find((d) => d.key === key);
const right = (r) => r.x + r.w;

// the OPTIONS frame as the game draws it (header 34,13 288x25; the list window; the footer band), positions from a live run
const header = () => part("header", 34, 13, 288, 25);
const headerRuns = (active = "GAME") => [
    run("OPTIONS", 44, 16, { w: 52 }), run("L1", 97, 16, { w: 12 }),
    ...[["GAME", 120], ["SCREEN", 156], ["SOUND", 206], ["EFFECTS", 249]].map(([t, x]) => run(t, x, 16, { w: t.length * 7, clut: t === active ? 0 : 7 })),
    run("R1", 306, 16, { w: 12 }),
];

// ------------------------------------------------------------------------------------------------ header
test("book header: title, L1 / R1 chips, one orange tab, dim tabs", () => {
    const out = [], used = new Set(), runs = headerRuns("SOUND");
    composeBookHeader(header(), runs, used, out);
    assert.equal(by(out, "book.header").shape, "sl");
    assert.equal(by(out, "book.hdr0.text").text, "OPTIONS");
    assert.equal(by(out, "book.hdr1.text").text, "L1");
    assert.equal(out.filter((d) => d.part === "bookTab").length, 1, "one active tab");
    assert.equal(by(out, "book.hdr4").text, "SOUND");
    assert.equal(by(out, "book.hdr4").color, "var(--c-orange-ink)");
    assert.equal(by(out, "book.hdr2").color, "var(--c-dim-label)", "GAME is drawn dim (clut 7)");
    assert.equal(used.size, runs.length, "every header run is taken");
});

test("book header: the R1 chip stays inside x 318 (an edge plate would bleed) and the last tab stops before it", () => {
    const out = [];
    composeBookHeader(header(), headerRuns("EFFECTS"), new Set(), out);
    const chip = by(out, "book.hdr6.chip").rect, tab = by(out, "book.hdr5.tab").rect;
    assert.ok(right(chip) <= BOOK.chipMaxX + 1e-9, `chip ends at ${right(chip)}`);
    assert.ok(right(tab) <= chip.x, `tab ends ${right(tab)} after the chip starts ${chip.x}`);
});

test("isDimRun = the game font's dim row (clut 7); PAGE_KEY is one shared test", () => {
    assert.equal(isDimRun({ clut: 7 }), true);
    assert.equal(isDimRun({ clut: 0 }), false);
    for (const k of ["L1", "R1", "L2", "R2"]) assert.match(k, PAGE_KEY);
    assert.doesNotMatch("GAME", PAGE_KEY);
});

// ------------------------------------------------------------------------------------------------ panels
test("book panel with the cursor: shared rows, the counts line left of the cursor column is a dim head line", () => {
    const win = part("window", 0, 40, 160, 140);
    const runs = [run("Met 6/240 Beaten 1", 56, 49), run("[enter]", 60, 63), run("Kotemon", 98, 63), run("Kumamon", 98, 77)];
    const out = composeBook({ parts: [win], runs }, { dimClut: true });
    const head = out.find((d) => d.text === "Met 6/240 Beaten 1");
    assert.ok(head && head.color === "var(--c-dim-label)");
    assert.ok(out.some((d) => d.text === "Kotemon"));
    assert.ok(out.some((d) => d.part === "cursor"), "the chevron at the focused row");
});

test("rows: false (map book): a C window plate and the chevron alone at the game's cursor", () => {
    const out = composeBook({ parts: [part("window", 20, 40, 260, 140)], runs: [run("[enter]", 100, 100)] }, { rows: false });
    assert.equal(out.filter((d) => d.part === "window").length, 1);
    assert.equal(out.filter((d) => d.part === "row").length, 0);
    assert.equal(out.filter((d) => d.part === "cursor").length, 1);
});

test("bars (GLOSSARY strength), arrows and the faint word", () => {
    const out = composeBook({ parts: [part("backdrop", 12, 0, 320, 240), { part: "bookBar", x: 200, y: 60, w: 80, h: 6, ratio: 0.25, rel: IDENTITY }],
        runs: [run("▼", 280, 160, { w: 7 }), run("◀", 230, 49, { w: 7 })] }, { word: "QUESTS" });
    const bar = out.find((d) => d.part === "cardBar");
    assert.equal(bar.kind, "bar");
    assert.equal(bar.ratio, 0.25);
    assert.deepEqual(out.filter((d) => d.part === "arrow").map((d) => d.key.split("@")[0]).sort(), ["arrow.down", "arrow.left"]);
    assert.ok(out.some((d) => d.key === "backdrop.type"));
});

// ------------------------------------------------------------------------------------------------ footer (shared with the pause pages)
test("footer: three lines (QUESTS) stay inside the band; text runs to the divider; a word past it (BIT) gets its own room", () => {
    const foot = part("footer", 0, 194, 320, 38);
    const runs = [run("Central Park pest control", 24, 198), run("Report to Leomon in Central Park", 24, 212), run("Reward: 300 BIT", 24, 226)];
    const out = [];
    composeFooter(foot, runs, new Set(), out);
    const lines = out.filter((d) => /^footer\.l\d\.text$/.test(d.key));
    assert.equal(lines.length, 3);
    for (const l of lines) assert.ok(l.rect.y >= 194 && l.rect.y + l.rect.h <= 232 + 1e-9, `line ${l.key} at ${l.rect.y}`);
    assert.ok(Math.abs(right(lines[0].rect) - dx(1060)) < 1e-6, "the description reaches the right divider");
    const demo = [];
    composeFooter(foot, [run("Setup the Battle Digivolve demo", 24, 212), run("99999", 261, 212, { w: 39 }), run("BIT", 300, 212, { w: 21 })], new Set(), demo);
    const bit = demo.find((d) => d.text === "BIT");
    assert.ok(bit.rect.w >= 17, `BIT has ${bit.rect.w} native`);
    assert.ok(right(demo.find((d) => d.text === "Setup the Battle Digivolve demo").rect) <= 261, "the line stops before the number");
    // a hint the game right-aligns to the divider (GLOSSARY "R1 Strength", hintRight 300): right-aligned there, room to grow left
    for (const hintRun of [run("R1 Strength", 223, 212, { w: 77 }), run("R1 Strength", 260, 212, { w: 40, right: 300 })]) {
        const hint = [];
        composeFooter(foot, [hintRun], new Set(), hint);
        const h = hint.find((d) => d.text === "R1 Strength");
        assert.equal(h.align, "right");
        assert.equal(h.role, "body", "a right-anchored word is not a number");
        assert.ok(Math.abs(right(h.rect) - dx(1060)) < 1e-6 && h.rect.w > 77, `hint box ${h.rect.x} + ${h.rect.w}`);
    }
});

// ------------------------------------------------------------------------------------------------ picking and claims
test("pause QUESTS page is picked from its frame; the kit panels are windows", () => {
    assert.equal(pickPauseScreen([call(CMFONT_DIR, 36)]).id, "quests");
    assert.equal(pickPauseScreen([call(STSTAT_DIR, 32), call(CMFONT_DIR, 24)]).id, "quests");
    assert.deepEqual({ ...claimFor("cmfont", "kit-12x8") }, { part: "window", layer: "under" });
    assert.notEqual(claimFor("ststat", "kit-12x8")?.part, "window");
    assert.equal(typeof composeBookScreen({ rows: false }), "function");
    assert.equal(typeof composeDemo, "function");
});

// ------------------------------------------------------------------------------------------------ wiring
test("wiring: the books and the demo page draw inside a look C scope; painted parts are handed over", () => {
    const host = src("web/book-host.js");
    assert.match(host, /uiC\.scope\(BOOK_UI_KEY, ctx, \{ enable: true, texts: true, compose: composeBookScreen\(/);
    const menu = src("web/menu.js");
    assert.match(menu, /uiC\.scope\("ui-menu", ctx, \{ enable: lookC, texts: true, compose: composeDemo \}/);
    assert.match(menu, /alignRight: true/, "card numbers keep their right edge (the card reads them by it)");
    assert.match(src("web/ui-kit.js"), /partHook\(ctx, \{ part: "bookBar"/);
    assert.match(src("web/world-globe-book.js"), /if \(!artHook\(ctx, paint\)\) paint\(ctx\)/, "the globe picture goes on the art layer");
    assert.match(src("web/uifont.js"), /artHook\(ctx, paint\)/);
});

test("one library: no old look left, PAGE_KEY defined once", () => {
    const dir = new URL("../web/ui-c/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
    const defs = files.filter((f) => /(const|let) PAGE_KEY\b/.test(readFileSync(new URL(f, dir), "utf8")));
    assert.deepEqual(defs, ["base.js"]);
    for (const f of ["web/menu.js", "web/book-host.js", "web/game.js", "web/status-translated.js"]) assert.doesNotMatch(src(f), /ui-css|uiLook/, f);
});
