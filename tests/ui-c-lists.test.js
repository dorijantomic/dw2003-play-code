// Look C kit T3 (web/ui-c): paged lists and grids -- list sizes, page slots, the pager, the shared base parts, sheet pieces kept as art,
// and the pause-home test that keeps the back path in look C. Pure: no browser, no DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIST, cellRect, pageSlots, findPager, composePager } from "../web/ui-c/lists.js";
import { N, ID, rowPlate, cursor, corners, typeWord, badgeText, tokenLine, stripes } from "../web/ui-c/base.js";
import { CLAIMS, claimFor, isPauseHome } from "../web/ui-c/claims.js";
import { artPieces, begin, clipHook, end } from "../web/ui-c/capture.js";

const run = (text, x, y, o = {}) => ({ text, x, y, ...o });

// ------------------------------------------------------------------------------------------------ list sizes (C3)
test("list sizes: row pitch 14, columns 131 apart, cell 120 x 12 (C3 360 x 36 dp)", () => {
    assert.deepEqual([LIST.pitch, LIST.colPitch, LIST.cellW, LIST.cellH], [14, 131, 120, 12]);
    assert.equal(LIST.cellW * 3, 360);
});

test("cellRect: the cell starts 14 dp left of the icon; the cursor row is pushed out 12 to the left, its right edge stays", () => {
    const off = cellRect(40, 50), on = cellRect(40, 50, true);
    assert.equal(off.x, 40 - N(14));
    assert.equal(on.x, off.x - LIST.push);
    assert.equal(on.x + on.w, off.x + off.w, "the right edge does not move");
});

test("pageSlots: the empty slots of a short page sit on the same grid (no shift), two columns", () => {
    const lines = [{ x: 20, y: 40 }, { x: 151, y: 40 }, { x: 20, y: 54 }];
    const s = pageSlots(lines, 40 + 3 * 14);
    assert.deepEqual(s.cols, [20, 151]);
    assert.equal(s.rows, 3);
    assert.deepEqual(s.empty, [{ x: 151, y: 54 }, { x: 20, y: 68 }, { x: 151, y: 68 }]);
    assert.deepEqual(pageSlots([]).empty, []);
});

// ------------------------------------------------------------------------------------------------ the pager
test("findPager: 'n' + '/' + 'm' runs on one line; runs already used are never taken", () => {
    const runs = [run("1", 100, 200, { w: 6 }), run("/", 107, 200, { w: 6 }), run("27", 114, 200, { w: 12 })];
    const pg = findPager(runs);
    assert.equal(pg.total, "27");
    assert.equal(findPager(runs, new Set([runs[0]])), null);
});

test("composePager: centred on the slash, or centred in the page plate the game draws it on", () => {
    const runs = () => [run("1", 100, 200, { w: 6 }), run("/", 107, 200, { w: 6 }), run("27", 114, 200, { w: 12 })];
    const free = []; composePager(runs(), new Set(), free);
    assert.equal(free[0].text, "1 / 27");
    const freeRect = free[0].rect;
    assert.equal(freeRect.x + freeRect.w / 2, 110, "centre on the slash");
    const plate = { x: 90, y: 196, w: 60, h: 16 }, inPlate = [];
    composePager(runs(), new Set(), inPlate, ID, [plate]);
    const r = inPlate[0].rect;
    assert.equal(r.x, plate.x); assert.equal(r.w, plate.w);
    assert.equal(r.y + r.h / 2, plate.y + plate.h / 2, "vertically centred in the plate");
});

// ------------------------------------------------------------------------------------------------ the shared base parts
test("rowPlate: the focused row is solid orange, a plain row has the navy under-edge on the body", () => {
    const on = rowPlate("r", { x: 0, y: 0, w: 10, h: 4 }, true), off = rowPlate("r", { x: 0, y: 0, w: 10, h: 4 }, false);
    assert.equal(on.shape, "rowSolid"); assert.equal(on.edge, "var(--c-orange)");
    assert.equal(off.shape, "row"); assert.equal(off.edge, "var(--c-under)"); assert.equal(off.body, "var(--c-body)");
});

test("cursor: the chevron follows the game's glyph pose; the hidden pose gives no part", () => {
    const c = cursor("c", "[enter]", 50, 20);
    assert.equal(c.kind, "chevron");
    near(c.rect.w, 10); near(c.rect.h, N(20));
    near(c.rect.x + c.rect.w / 2, 50); near(c.rect.y + c.rect.h / 2, 20);
    assert.equal(cursor("c", "[space2]", 50, 20), null);
});

test("corners, stripes and typeWord: one shape each; the bag's darker word colour is an option, not a copy", () => {
    assert.equal(corners("k", { x: 0, y: 0, w: 1, h: 1 }).layer, "over");
    assert.equal(stripes(12).scroll, 12);
    assert.equal(typeWord("t", "ITEMS", { x: 0, y: 0, w: 1, h: 1 }).color, undefined);
    assert.equal(typeWord("t", "ITEMS", { x: 0, y: 0, w: 1, h: 1 }, ID, 150, "var(--c-type-deep)").color, "var(--c-type-deep)");
});

test("badgeText / tokenLine: a '[triangle] Button:Back' run becomes a round badge + text, never the raw token", () => {
    assert.deepEqual(badgeText("[triangle] Button:Back"), { badge: "[triangle]", txt: "Button:Back" });
    const out = [];
    tokenLine("k", "[triangle] Button:Back", 10, 10, ID, out);
    assert.equal(out.length, 2);
    assert.equal(out[0].kind, "icon");
    assert.ok(!JSON.stringify(out[1]).includes("[triangle]"));
});

// ------------------------------------------------------------------------------------------------ sheet pieces kept as art
test("artPieces: only the sheet pieces of the listed sizes (the element cubes, 16 x 16) stay art", () => {
    const layers = [{ w: 200, h: 40 }, { w: 16, h: 16 }, { w: 16, h: 8 }, { w: 16, h: 16 }];
    assert.equal(artPieces(layers, [[16, 16]]).length, 2);
    assert.deepEqual(artPieces(undefined, [[16, 16]]), []);
});

test("claims: the folder rows keep their cubes (artSizes), the album card back stays art on a C frame, the shop L1 arrow is a chip", () => {
    for (const id of [64, 65, 66, 68]) assert.deepEqual(claimFor("stcdsp", id).artSizes, [[16, 16]]);
    assert.equal(claimFor("stalbm", 6)?.keepArt, true);
    assert.equal(claimFor("stshop", 16)?.part, "pageChip");
    assert.equal(claimFor("sttrng3", 35)?.part, "hint", "the drill description plate is a C plate");
    assert.ok(Object.isFrozen(CLAIMS.stcdsp));
});

test("clipHook with artSizes: the frame becomes a part and only the cube pieces are drawn, in their own pixels", () => {
    const ctx = { getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
    const drawn = [];
    const art = { setTransform() {}, drawImage: (...a) => drawn.push(a), imageSmoothingEnabled: true };
    const pack = {
        name: "stcdsp", img: { id: "sheet" },
        ids: { 65: { layers: [{ x: 0, y: 0, dx: 0, dy: 0, w: 200, h: 40 }, { x: 300, y: 10, dx: 12, dy: 20, w: 16, h: 16 }] } },
    };
    begin("t", ctx, { a: 1, d: 1, e: 0, f: 0 }, () => art);
    const took = clipHook(ctx, pack, 65, 5, 7, () => assert.fail("the whole clip is never drawn"));
    const s = end();
    assert.equal(took, true);
    assert.equal(s.parts.length, 1); assert.equal(s.parts[0].part, "folder");
    assert.deepEqual(drawn, [[pack.img, 300, 10, 16, 16, 17, 27, 16, 16]]);
    assert.equal(s.unclaimed.length, 0);
});

// ------------------------------------------------------------------------------------------------ back path (user rule 1)
const sprite = (id, x, y, dir = 0x2860000) => ({ method: "drawSprite", args: [dir, id, x, y] });
test("isPauseHome: backing out keeps look C -- the diamond backdrop (ststat 29) under the home does not hide it", () => {
    const home = [sprite(21, 0, 17), sprite(264, 168, 40), sprite(26, 0, 158)];
    assert.equal(isPauseHome([sprite(29, 0, 0, 0x4040000), ...home]), true, "the game keeps drawing the backdrop on the way back");
    assert.equal(isPauseHome([...home, sprite(22, 0, 30)]), false, "the portrait plates mark a sidebar page (items categories)");
});

test("pickPauseScreen decides from the frame only: the page the menu was opened on is not a test", () => {
    const src = readFileSync(new URL("../web/ui-c/screens.js", import.meta.url), "utf8");
    assert.match(src, /export function pickPauseScreen\(calls, _entry\)/);
    assert.match(src, /if \(isPauseHome\(calls\)\) return \{ id: "home"/);
});

test("VRAM pictures (card faces, drill pictures) go through the look C art hook", () => {
    const src = readFileSync(new URL("../web/native-screen-render.js", import.meta.url), "utf8");
    assert.match(src, /artHook\(ctx, \(c\) => options\.paintPrim\(c, d\.call\)\)/);
});

function near(a, b, eps = 1e-9) { assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`); }
