// Look C kit T4 (web/ui-c/sheets.js): the info sheets -- status sheet, See Digivolve, See Equipment, the equipment item grid, the fight
// report, the element chips. Pure: synthetic draw parts and text runs in, part descriptors out. No browser, no DOM, no game data.
import test from "node:test";
import assert from "node:assert/strict";
import {
    SHEET, FORM_SHEET, REPORT, panelRows, rowsFromRuns, linedWindow, statChips, expPlate, tpPlate, composeTabPanel, composeFormSheet,
    composeFormList, composeSheetParts, composeReport,
} from "../web/ui-c/sheets.js";
import { N, ID, ELEMENTS, elementChip } from "../web/ui-c/base.js";
import { claimFor, STATUS_CLIPS, STSTAT_DIR, CMFONT_DIR } from "../web/ui-c/claims.js";
import { pickPauseScreen, composeStatusPage, STATUS_WORD } from "../web/ui-c/screens.js";
import { plateShape } from "../web/ui-c/parts.js";
import { dx } from "../web/ui-c/geometry.js";

const run = (text, x, y, o = {}) => ({ text, x, y, kind: "text", face: null, w: text.length * 6, ...o });
const num = (text, right, y) => run(text, right - text.length * 6, y, { right });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, row: 0, ...o });
const call = (dir, id) => ({ method: "drawSprite", args: [dir << 16, id] });
const byPart = (out, p) => out.filter((d) => d.part === p);

// ------------------------------------------------------------------------------------------------ claims + the screen pick
test("claims: the status sheet clips, the See Digivolve icon column as art, the fight report pack", () => {
    const want = { 31: "headerWin", 33: "statWin", 34: "tabPanel", 35: "tabPanel", 44: "tabPanel", 36: "formList", 39: "formSheet", 42: "slotWin", 60: "tpPlate" };
    for (const [id, p] of Object.entries(want)) assert.equal(claimFor("ststat", id).part, p, `ststat ${id}`);
    assert.equal(claimFor("cmfont", 20).part, "art");
    const rpt = { 30: "backdrop", 33: "expPlate", 29: "msgBand", 31: "reportCard", 32: "formBar", 36: "reportHl" };
    for (const [id, p] of Object.entries(rpt)) assert.equal(claimFor("stfrpt", id).part, p, `stfrpt ${id}`);
    assert.equal(claimFor("stfrpt", "36#3").layers, true, "the highlight is split by its own sheet layers");
    assert.equal(claimFor("stfrpt", 8), null, "the portrait stays art");
});

test("pickPauseScreen: a sidebar page with a status clip is the status sheet; without one it stays the PARTY page", () => {
    const side = [call(CMFONT_DIR, 21), call(CMFONT_DIR, 22)];
    for (const id of STATUS_CLIPS) assert.equal(pickPauseScreen([...side, call(STSTAT_DIR, id)]).id, "status", `ststat ${id}`);
    assert.equal(pickPauseScreen(side).id, "sidebar");
    assert.equal(pickPauseScreen([call(STSTAT_DIR, 33)]), null, "no party card = not a sidebar page");
});

// ------------------------------------------------------------------------------------------------ base pieces
test("rb shape: open on the left, one chamfer bottom-right", () => {
    const s = plateShape("rb", 300, 200, 1, 3, 4);
    assert.ok(s.outer && s.inner && s.box);
    assert.equal(s.box.l, 0, "no edge on the left (it bleeds off the screen)");
});

test("elementChip: chip body #10104a; a cap 8 dp wide below the 10 dp chamfer when given; the seven C9 colours in row order", () => {
    assert.equal(ELEMENTS.length, 7);
    assert.equal(ELEMENTS[0], "var(--c-el-fire)");
    assert.equal(ELEMENTS[6], "var(--c-el-dark)");
    const rc = { x: 10, y: 20, w: 40, h: 13 };
    const [body, cap] = elementChip("c", rc, ELEMENTS[2]);
    assert.equal(body.edge, "var(--c-chip)");
    assert.equal(body.shape, "chip");
    assert.deepEqual(cap.rect, { x: 10, y: 20 + N(10), w: N(8), h: 13 - N(10) });
    assert.equal(cap.edge, "var(--c-el-ice)");
    assert.equal(elementChip("c", rc).length, 1, "no cap = a plain stat chip");
});

// ------------------------------------------------------------------------------------------------ lined windows
test("rowsFromRuns: one row per text line, 1 native above the pen; cursor glyphs make no row", () => {
    const runs = [run("A", 30, 50), run("9", 80, 51, { right: 86 }), run("[select]", 20, 50), run("B", 30, 64)];
    assert.deepEqual(rowsFromRuns(runs, new Set(), { x: 0, y: 40, w: 200, h: 40 }), [49, 63]);
});

test("linedWindow: the cursor row is solid orange, pushed out 12, chevron on it; every run in the window is taken", () => {
    const runs = [run("[enter]", 18, 50), run("One", 30, 50), run("Two", 30, 64), num("12", 150, 64)];
    const used = new Set(), out = [];
    linedWindow("w", { x: 10, y: 40, w: 150, h: 40 }, [49, 63], runs, used, out, ID, { rowX: 22 });
    const rows = byPart(out, "row");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].shape, "rowSolid");
    assert.equal(rows[0].rect.x, 22 - SHEET.push);
    assert.equal(rows[1].shape, "row");
    assert.equal(rows[1].rect.x + rows[1].rect.w, 160, "rows run to the window's right edge");
    assert.equal(byPart(out, "cursor").length, 1);
    assert.equal(used.size, 4);
    const n = out.find((d) => d.role === "number");
    assert.equal(n.align, "right");
    assert.equal(n.rect.x + n.rect.w, 150, "numbers end where the game ends them");
});

test("tab panel: the tab plate with the game's title, rows 17 below the tab top, 14 apart; 6 rows in the Equip panel", () => {
    assert.equal(panelRows(107), 6);
    assert.equal(panelRows(65), 3);
    const p = part("tabPanel", 160, 119, 208, 107);
    const runs = [run("Equip", 167, 121), run("Head", 192, 137), run("Body", 192, 151)];
    const used = new Set(), out = [];
    composeTabPanel(p, 0, runs, used, out);
    const tab = out.find((d) => d.part === "tab");
    assert.deepEqual([tab.rect.x, tab.rect.w, tab.rect.h], [160, SHEET.tabW, SHEET.tabH]);
    const rows = byPart(out, "row");
    assert.equal(rows.length, 6);
    assert.equal(rows[0].rect.y, 119 + SHEET.rowDy);
    assert.equal(rows[1].rect.y - rows[0].rect.y, 14);
    const win = out.find((d) => d.part === "window");
    assert.ok(win.rect.x + win.rect.w >= 320, "the body bleeds right");
    assert.equal(out.find((d) => d.text === "Equip").role, "label");
    assert.equal(used.size, 3);
});

// ------------------------------------------------------------------------------------------------ chips, EXP, TP
test("statChips: one chip per number; the second column of seven rows gets the element caps top to bottom", () => {
    const runs = [];
    for (let i = 0; i < 6; i++) runs.push(num(String(10 + i), 50, 91 + 14 * i));
    for (let i = 0; i < 7; i++) runs.push(num(String(i), 91, 91 + 14 * i));
    const out = [];
    statChips("s", { x: 0, y: 84, w: 108, h: 109 }, runs, new Set(), out);
    assert.equal(byPart(out, "statChip").length, 13);
    const caps = byPart(out, "chipCap");
    assert.deepEqual(caps.map((c) => c.edge), ELEMENTS);
    assert.ok(caps.every((c) => c.rect.x === 91 - 37), "caps on the resistance column only");
    assert.equal(out.filter((d) => d.role === "number").length, 13);
});

test("EXP plate: solid orange, dark ink number right-anchored, label dark ink", () => {
    const out = [], used = new Set();
    expPlate(part("expPlate", 0, 61, 108, 21), 0, [num("1234", 66, 69), run("EXP", 70, 69)], used, out);
    const pl = out.find((d) => d.part === "expPlate");
    assert.equal(pl.edge, "var(--c-orange)");
    assert.equal(pl.body, null);
    assert.ok(out.filter((d) => d.kind === "text").every((t) => t.color === "var(--c-orange-ink)"));
    assert.equal(used.size, 2);
});

test("TP plate: TP dim, number amber; hidden with its text when the footer band covers it", () => {
    const tp = () => part("tpPlate", 0, 196, 76, 25), runs = () => [run("TP", 16, 203), num("40", 45, 203)];
    const out = [];
    tpPlate(tp(), 0, runs(), new Set(), out);
    assert.equal(out.find((d) => d.role === "number").color, "var(--c-num)");
    assert.equal(out.find((d) => d.text === "TP").color, "var(--c-dim-label)");
    const rs = runs(), used = new Set(), out2 = [];
    composeSheetParts([tp(), part("footer", 0, 190, 320, 40)], rs, used, out2);
    assert.equal(out2.length, 0);
    assert.equal(used.size, 2, "the TP text is taken, not left to the footer");
});

// ------------------------------------------------------------------------------------------------ See Digivolve
test("form sheet: name tab, skill tab, stat window rb, technique panel with five rows and the skill row (orange under-edge)", () => {
    const p = part("formSheet", 72, 97, 256, 132), out = [], used = new Set();
    const runs = [run("Name", 79, 104), run("Skill LV", 235, 104), run("Tech", 196, 136), run("Skill", 196, 206)];
    composeFormSheet(p, 0, runs, used, out);
    assert.equal(out.find((d) => d.part === "statWin").shape, "rb");
    assert.equal(out.find((d) => d.part === "nameTab").rect.w, FORM_SHEET.nameW);
    const rows = byPart(out, "row");
    assert.equal(rows.length, FORM_SHEET.rows + 1);
    assert.equal(rows.at(-1).rect.y, 97 + FORM_SHEET.skillRow);
    assert.equal(rows.at(-1).edge, "var(--c-orange)");
    assert.equal(rows[0].edge, "var(--c-under)");
    assert.equal(used.size, 4);
    assert.equal(out.find((d) => d.text === "Skill LV").color, "var(--c-dim-label)");
});

test("forms list: three rows, the choice plate left of the list holds the current form", () => {
    const out = [], used = new Set();
    composeFormList(part("formList", 168, 40, 254, 56), 0, [run("Form", 190, 49), run("Now", 94, 77), run("[space2]", 80, 77)], used, out);
    assert.equal(byPart(out, "row").length, 4);
    assert.equal(byPart(out, "window").length, 2);
    assert.equal(used.size, 3);
});

// ------------------------------------------------------------------------------------------------ the status page
test("status page: the high money plate is the EXP plate, the word STATUS at C4 470 / 600 dp, no wall", () => {
    const parts = [part("backdrop", 5, 5, 0, 0), part("money", 0, 61, 108, 21), part("statWin", 0, 84, 108, 109), part("tpPlate", 0, 196, 76, 25)];
    const runs = [num("0", 66, 69), run("EXP", 70, 69), run("TP", 16, 203), num("3", 45, 203)];
    const out = composeStatusPage({ parts, runs });
    assert.equal(byPart(out, "expPlate").length, 1);
    assert.equal(byPart(out, "money").length, 0);
    const word = out.find((d) => d.kind === "type");
    assert.equal(word.text, "STATUS");
    assert.equal(word.rect.x, dx(470));
    assert.equal(word.sizeDp, STATUS_WORD.sizeDp);
    assert.equal(byPart(out, "wall").length, 0);
    assert.equal(byPart(out, "statWin").length, 1);
    assert.equal(byPart(out, "tpPlate").length, 1);
});

// ------------------------------------------------------------------------------------------------ fight report
test("fight report: card, form bar, message band, highlight corners; every run inside a part is taken", () => {
    const parts = [
        part("backdrop", 38, 38, 0, 0), part("expPlate", 0, 15, 108, 21), part("reportCard", 17, 38, 116, 45), part("formBar", 135, 38, 172, 18),
        part("msgBand", 11, 188, 296, 38), part("reportHl", 17, 38, 104, 43, { layers: [{ x: 0, y: 0, w: 44, h: 43 }, { x: 44, y: 0, w: 48, h: 16 }] }),
    ];
    const runs = [num("89", 66, 23), run("EXP", 69, 23), run("Name", 61, 40), run("LV", 62, 56), num("7", 91, 56), run("EXP", 106, 69),
        num("12", 103, 69), run("Form", 140, 42), num("3", 280, 42), run("Line one", 20, 194), run("Line two", 20, 208)];
    const out = composeReport({ parts, runs });
    for (const p of ["card", "portrait", "cardName", "cardLv", "formBar", "msgBand", "expPlate"]) assert.ok(byPart(out, p).length >= 1, p);
    assert.equal(out.find((d) => d.kind === "stripes").scroll, 38);
    const hl = out.find((d) => d.kind === "corners");
    assert.deepEqual(hl.rect, { x: 17, y: 38, w: 44, h: 43 }, "corners round the biggest highlight piece");
    assert.equal(out.filter((d) => String(d.key).startsWith("rp")).length, 0, "no run left over");
    assert.equal(out.find((d) => d.text === "Line one").role, "body");
    assert.ok(byPart(out, "card").every((d) => d.edge === "var(--c-cyan)"), "the report is the cyan family");
    assert.equal(REPORT.portraitW, 39);
});
