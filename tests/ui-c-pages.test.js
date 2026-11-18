// Look C kit T7 (web/ui-c/fullpages.js): the full-screen pages -- name entry (chooser + keyboard, also the deck folder rename), SAVE /
// LOAD and their confirms, the Digimon Online window, the language page, the pause MAP name window, the END card. Pure: synthetic draw
// parts and text runs in, part descriptors out. No browser, no DOM, no game data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    C7, runSegments, keyCells, slotRects, lineArt, composeNameEntry, composeMemcard, composeNet, composeMapPage, composeEnd, composeLanguage,
} from "../web/ui-c/fullpages.js";
import { N, ID, FAMILY_C } from "../web/ui-c/base.js";
import { claimFor, isPicturePack, STSTAT_DIR } from "../web/ui-c/claims.js";
import { insetRect } from "../web/ui-c/capture.js";
import { pickPauseScreen, composeDeck } from "../web/ui-c/screens.js";
import { plateShape } from "../web/ui-c/parts.js";

const run = (text, x, y, o = {}) => ({ text, x, y, kind: 1, face: null, w: text.length * 7, ...o });
/** A run with its pen positions (the game's fixed pitch `pitch`). */
const grun = (text, x, y, pitch, o = {}) => run(text, x, y, { glyphs: [...text].map((ch, k) => ({ ch, x: x + pitch * k, dx: pitch })), ...o });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, row: 0, ...o });
const call = (dir, id) => ({ method: "drawSprite", args: [dir << 16, id] });
const byPart = (out, p) => out.filter((d) => d.part === p);
const src = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");

// the keyboard clip's grid blocks as its sheet layers (positions relative to the draw position): 3 columns of 5 keys, 7 / 7 / 3 rows
const KB_LAYERS = [
    { x: 18, y: 6, w: 72, h: 54 }, { x: 18, y: 60, w: 72, h: 54 }, { x: 18, y: 114, w: 72, h: 18 },
    { x: 96, y: 6, w: 72, h: 54 }, { x: 96, y: 60, w: 72, h: 54 }, { x: 96, y: 114, w: 72, h: 18 },
    { x: 174, y: 6, w: 72, h: 54 }, { x: 0, y: 0, w: 266, h: 4 },
];
const keyboard = () => part("keyboard", 29, 84, 266, 139, { layers: KB_LAYERS });
const slots = (n) => part("nameSlots", 75, 64, 19 * n, 20, { layers: Array.from({ length: n }, (_, k) => ({ x: 19 * k, y: 0, w: 20, h: 20 })) });

// ------------------------------------------------------------------------------------------------ claims, wiring
test("claims: name entry, chooser, memory card, net window, language, END; the map packs are pictures", () => {
    const namedt = { 29: "nameHdr", 30: "portraitFrame", 31: "portraitBack", 55: "nameSlots", 53: "nameSlots", 37: "keyboard", 39: "keyCursor", 40: "slotCursor" };
    for (const [id, p] of Object.entries(namedt)) assert.equal(claimFor("namedt", id).part, p, `namedt ${id}`);
    for (const id of [60, 61, 62, 63, 64, 70, 71, 72, 44, 45, 46, 47, 48, 77, 78, 79]) {
        const c = claimFor("namedt", `${id}#4`);
        assert.equal(c.part, "keyButton", `namedt ${id}`);
        assert.deepEqual(c.artInset, [5, 2, 3, 3], "the button word stays the game's pixels, cut inside its frame (every language)");
    }
    assert.equal(claimFor("namedt", 8), null, "the portrait stays art");
    assert.equal(claimFor("stdgnm", 30).part, "pickRow");
    assert.equal(claimFor("stdgnm", 32).layer, "over");
    assert.equal(claimFor("stmcrd", 33).layers, true);
    assert.equal(claimFor("stmcrd", 31).part, "mcPipe", "the pipe runs behind the panel: a part, not art");
    assert.deepEqual(claimFor("stmcrd", 36).artSizes, [[48, 32]], "the partner diamonds stay pictures");
    assert.equal(claimFor("stnmet", 15).part, "netWin");
    for (const id of [4, 5, 6, 7, 8]) assert.equal(claimFor("cntselwn", id).part, "langCursor", `cntselwn ${id}: one cursor clip per row`);
    assert.deepEqual(claimFor("cntselwn", 2).artSizes.map(String), ["44,28", "72,14", "64,14", "76,14", "64,16"], "flags + words stay pictures");
    assert.equal(claimFor("endall", 0).part, "art");
    assert.equal(claimFor("ststat", 59).part, "mapName");
    assert.ok(isPicturePack("stwmp0map") && isPicturePack("stwmp12area") && !isPicturePack("stwmp0"));
    assert.equal(claimFor("stwmp3area", 7).part, "art");
});

test("wiring: every T7 owner paints in its scope; the deck knows the namedt pack; the map page is picked", () => {
    assert.match(src("nameentry-translated.js"), /ui: \{ key: "ui-name", compose: composeName \}/);
    assert.match(src("save-translated.js"), /ui: \{ key: "ui-save", compose: composeMemcard \}/);
    assert.match(src("packselect-translated.js"), /ui: \{ key: "ui-pack", compose: composeWizard \}/);
    assert.match(src("endscreen-translated.js"), /ui: \{ key: "ui-end", compose: composeEnd \}/);
    assert.match(src("cntysel-native.js"), /uiC\.scope\("ui-lang", ctx, \{ enable: true, compose: composeLanguage/);
    assert.match(src("carddeck-translated.js"), /const PACKS = \{ 1598: "stcdsp", 1904: "namedt" \}/, "without it the rename keyboard draws text only");
    assert.match(src("carddeck-translated.js"), /compose: composeDeck/);
    assert.equal(pickPauseScreen([call(STSTAT_DIR, 29), call(STSTAT_DIR, 59)]).id, "map");
    // the deck: the keyboard page goes to the name composer, the other deck pages to the window page
    const kb = composeDeck({ parts: [keyboard()], runs: [] });
    assert.ok(byPart(kb, "key").length > 0);
    assert.equal(byPart(composeDeck({ parts: [], runs: [] }), "key").length, 0);
});

test("asset panel: kit tokens and fonts, focus visible, the tokens reach :root", () => {
    const html = src("index.html");
    const css = html.slice(html.indexOf("#asset-mode-screen {"), html.indexOf(".asset-mode-close[hidden]"));
    for (const t of ["--c-c-edge", "--c-c-body", "--c-c-title", "--f-label", "--f-text", "--c-orange", "--c-slot-on", ":focus-visible"]) assert.ok(css.includes(t), t);
    assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, "no raw colours: the panel takes the kit tokens");
    assert.match(src("ui-c/tokens.css"), /^:root, #ui-c-root \{/m);
});

// ------------------------------------------------------------------------------------------------ helpers
test("runSegments: a run is cut at gaps of two spaces or more, each piece at the game's pen x", () => {
    const r = grun("[x] button: Save   [t] Back", 20, 206, 6);
    const s = runSegments(r);
    assert.deepEqual(s.map((q) => q.text), ["[x] button: Save", "[t] Back"]);
    assert.equal(s[1].x, 20 + 6 * r.text.indexOf("[t]"));
    assert.deepEqual(runSegments(run("Saved.", 20, 192)), [{ text: "Saved.", x: 20 }], "no glyphs: one piece at the run's x");
});

test("keyCells / slotRects: the grid and the slots come from the clip's own sheet layers", () => {
    const cells = keyCells(keyboard());
    assert.equal(cells.length, 5 * (7 + 7 + 3), "5 keys per row; the 266-wide outline is no block");
    assert.deepEqual([cells[0].nx, cells[0].ny], [47, 90]);
    assert.deepEqual([cells[1].nx, cells[5].ny], [47 + 14, 90 + 18], "pitch 14 x 18");
    assert.deepEqual(cells[0].rect, { x: 47 + C7.keyIn, y: 90 + C7.keyIn, w: C7.keyW, h: C7.keyH });
    const s = slotRects(slots(8));
    assert.equal(s.length, 8);
    assert.deepEqual(s[2].rect, { x: 75 + 38, y: 64, w: C7.slotW, h: C7.slotH });
});

test("insetRect: the button word = the clip cut inside its frame [l, t, r, b]", () => {
    assert.deepEqual(insetRect(203, 153, 72, 19, [5, 2, 3, 3]), { x: 208, y: 155, w: 64, h: 14 });
});

test("lineArt: thin pieces merge along a row into rules; columns stay; mid-size pieces are boxes", () => {
    const art = lineArt({ layers: [
        { x: 11, y: 99, w: 100, h: 2 }, { x: 111, y: 99, w: 100, h: 2 }, { x: 0, y: 0, w: 4, h: 66 }, { x: 8, y: 43, w: 120, h: 15 }, { x: 131, y: 23, w: 48, h: 32 },
    ] }, [[48, 32]]);
    assert.deepEqual(art.rows, [{ x: 11, y: 99, w: 200, h: 2 }]);
    assert.equal(art.cols.length, 1);
    assert.deepEqual(art.boxes, [{ x: 8, y: 43, w: 120, h: 15 }], "the 48 x 32 pictures are skipped");
});

test("shapes: the C7 key (chamfer 8 top-left) and button (chamfer 14 top-left + bottom-right)", () => {
    const key = plateShape("key", 38, 50, 1, 1, 2, "all");
    assert.ok(key.outer.startsWith("polygon(8px 0"), key.outer);
    const kb = plateShape("kb", 70, 17, 1, 1, 2);
    assert.ok(/14px/.test(kb.outer) && kb.box, kb.outer);
});

// ------------------------------------------------------------------------------------------------ name entry
test("name keyboard: one key per grid cell, letters by glyph x, the key cursor (39) = the orange key", () => {
    const parts = [keyboard(), part("keyCursor", 47 + 14, 90 + 18, 16, 18), part("nameHdr", 24, 21, 272, 24)];
    const runs = [grun("ABCDE", 47, 91, 14), grun("FGHIJ", 47, 109, 14), grun("-~・?!", 203, 127, 14), run("Enter Name", 32, 26, { clut: 2 })];
    const out = composeNameEntry({ parts, runs }, { word: "NAME" });
    const keys = byPart(out, "key");
    assert.equal(keys.length, 85);
    const on = keys.filter((k) => k.body === "var(--c-orange)");
    assert.equal(on.length, 1);
    assert.equal(on[0].key, "kb0.key6.plate", "row 1 col 1 = G");
    const ch = (k) => out.find((d) => d.key === `kb0.key${k}.ch`)?.text;
    assert.equal(ch(0), "A");
    assert.equal(ch(6), "G");
    const dot = out.find((d) => d.kind === "text" && d.text === "·");
    assert.ok(dot, "the game's middle dot is the dot key");
    assert.equal(keys.filter((k) => k.body === FAMILY_C.emptyBody).length, 85 - 15, "cells without a letter are the dim empty keys");
    const title = out.find((d) => d.key === "hdr0.t");
    assert.equal(title.color, "var(--c-c-title)", "a tinted title run is the C7 green");
    assert.ok(title.rect.x >= 24 + C7.hdrTextIn - 0.01, "the title is 36 dp into the plate");
    assert.ok(!out.some((d) => d.kind === "text" && /^[A-Z]{5}$/.test(d.text)), "no key row left as one text run");
});

test("name slots: each letter in the slot under its pen x; the slot cursor (40) = the amber slot; a gap stays empty", () => {
    const parts = [slots(8), part("slotCursor", 75 + 19 * 2, 64, 20, 20)];
    const fw = "　";
    const out = composeNameEntry({ parts, runs: [grun(`${fw}${fw}temon${fw}`, 75, 64, 19)] });
    const letters = out.filter((d) => /^slot0\.\d\.ch$/.test(d.key)).map((d) => `${d.key.split(".")[1]}=${d.text}`);
    assert.deepEqual(letters, ["2=t", "3=e", "4=m", "5=o", "6=n"]);
    const on = byPart(out, "slot").filter((d) => d.body === FAMILY_C.slotOn);
    assert.deepEqual(on.map((d) => d.key), ["slot0.2.plate"]);
});

test("buttons: the game draws the cursor's button twice (two palette rows): that one is orange; arrows are C svgs", () => {
    const btn = (id, x, row) => part("keyButton", x, 195, 18, 19, { id: row ? `${id}#${row}` : String(id), base: id });
    const parts = [btn(44, 203, 4), btn(45, 222, 4), btn(78, 246, 4), btn(44, 203, 0)];
    const out = composeNameEntry({ parts, runs: [run("[arrow-left]", 206, 198), run("[arrow-right]", 225, 198)] });
    const plates = byPart(out, "keyButton");
    assert.equal(plates.length, 3, "one plate per position");
    assert.deepEqual(plates.filter((d) => d.edge === "var(--c-orange)").map((d) => d.key), ["btn@203,195"]);
    assert.equal(byPart(out, "keyArrow").length, 2);
    assert.ok(!out.some((d) => d.kind === "text" && /arrow/.test(d.text)), "no raw arrow token");
});

test("chooser: the row under the cursor frame (32) is orange with corners and the chevron; names are Russo labels", () => {
    const parts = [part("pickRow", 32, 53, 160, 42), part("pickRow", 32, 96, 160, 42), part("pickCursor", 28, 92, 162, 46)];
    const out = composeNameEntry({ parts, runs: [run("Kotemon", 75, 71), run("Renamon", 75, 114)] });
    const rows = byPart(out, "pickRow");
    assert.deepEqual(rows.map((d) => d.edge), [FAMILY_C.edge, "var(--c-orange)"]);
    assert.equal(byPart(out, "selection").length, 1);
    assert.equal(out.filter((d) => d.kind === "chevron").length, 1);
    assert.deepEqual(out.filter((d) => d.role === "label").map((d) => d.text), ["Kotemon", "Renamon"]);
});

// ------------------------------------------------------------------------------------------------ memory card, net, language, map, END
test("memory card: pipe under the panel, title tab, the prompt divider with the orange lead, prompt pieces at the game's x", () => {
    const panel = part("mcPanel", 5, 89, 312, 146, { layers: [
        { x: 0, y: 0, w: 16, h: 146 }, { x: 296, y: 0, w: 16, h: 146 }, { x: 11, y: 11, w: 160, h: 2 }, { x: 11, y: 99, w: 288, h: 2 }, { x: 11, y: 132, w: 288, h: 2 },
    ] });
    const parts = [part("backdrop", 29, 0, 320, 240), part("mcPipe", 25, 0, 20, 240), panel];
    const runs = [run("SAVE", 205, 98), run("SAVING", 20, 113), grun("Choose slot.", 20, 192, 6), grun("[cross] Save   [triangle] Back", 20, 206, 6)];
    const out = composeMemcard({ parts, runs });
    const order = out.map((d) => d.part);
    assert.ok(order.indexOf("pipe") < order.indexOf("window"), "the pipe is composed before (under) the panel");
    assert.equal(byPart(out, "windowTitle").length, 1);
    assert.ok(out.some((d) => d.kind === "text" && d.text === "SAVE"));
    assert.equal(out.find((d) => d.text === "SAVING").role, "label");
    const lead = out.find((d) => d.key === "mc0.lead");
    assert.ok(lead && lead.edge === "var(--c-orange)" && lead.rect.y === 89 + 99, "the orange lead sits on the first rule of the lower half");
    assert.equal(out.filter((d) => d.part === "hintIcon").length, 2, "both button pieces get their badge");
    const back = out.find((d) => d.kind === "text" && d.text === "Back");
    assert.ok(back.rect.x > 20 + 6 * 15, "the second piece starts at its own pen x");
});

test("net window: a family C window on the over layer (the backdrop is art), text in key ink", () => {
    const win = part("netWin", 56, 47, 320, 58, { bx: -56, by: 3, layers: [{ x: -56, y: 3, w: 56, h: 58 }, { x: 0, y: 3, w: 16, h: 58 }, { x: 16, y: 3, w: 192, h: 58 }, { x: 208, y: 3, w: 56, h: 58 }] });
    const out = composeNet({ parts: [win], runs: [run("Welcome to Digimon Online.", 66, 59)] });
    const w = out.find((d) => d.key === "net0");
    assert.equal(w.layer, "over");
    assert.deepEqual([w.rect.x, w.rect.w], [56, 208], "the circuit wires (56 x 58 at each end) stay pictures");
    assert.equal(out.find((d) => d.kind === "text").color, FAMILY_C.keyInk);
});

test("language: band under the column under the header; the cursor row is the amber focus plate with corners", () => {
    const parts = [part("backdrop", 89, 89, 432, 336), part("langHeader", 0, 20, 320, 28), part("langColumn", 148, 0, 172, 240), part("langBand", 0, 158, 336, 64), part("langCursor", 167, 85, 136, 32)];
    const out = composeLanguage({ parts, runs: [] });
    const order = out.map((d) => d.part).filter((p) => /^lang/.test(p));
    assert.deepEqual(order.slice(0, 3), ["langBand", "langColumn", "langHeader"]);
    const cur = out.find((d) => d.key === "lang0.on");
    assert.deepEqual([cur.edge, cur.body, cur.rect.y], ["var(--c-orange)", FAMILY_C.slotOn, 85]);
    assert.equal(byPart(out, "selection").length, 1);
});

test("map: the name window without the clip's drop shadow, over the map picture; END has nothing of its own", () => {
    const out = composeMapPage({ parts: [part("mapName", 0, 20, 244, 40, { bx: 9 })], runs: [run("Asuka City", 16, 25)] });
    const w = out.find((d) => d.key === "map0.win");
    assert.deepEqual(w.rect, { x: 10, y: 20, w: 236, h: 36 });
    assert.equal(w.layer, "over");
    assert.equal(out.find((d) => d.kind === "text").text, "Asuka City");
    assert.deepEqual(composeEnd({ parts: [], runs: [] }), []);
});
