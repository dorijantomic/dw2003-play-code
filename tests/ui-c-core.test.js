// Look C kit core (web/ui-c): geometry, bleed, the fold matrix, the claims lookup, the fit rule, the plate shapes. Pure: no browser, no DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { applyRel, bleedFlags, dimOf, dx, dy, edges, placement, relative, snapRect } from "../web/ui-c/geometry.js";
import { CLAIMS, claimFor, isPauseHome } from "../web/ui-c/claims.js";
import { fitRun } from "../web/ui-c/text.js";
import { barFill, plateShape } from "../web/ui-c/parts.js";
import { CURSOR_POSES, badgeSvg, isCursorToken, splitTokens } from "../web/ui-c/icons.js";
import { begin, capturing, clipBounds, clipHook, end, runsHook } from "../web/ui-c/capture.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ------------------------------------------------------------------------------------------------ placement and snapping
test("placement: the native 320x240 box lands where the game canvas draws it, at three window sizes", () => {
    // 640x480 canvas at (100,50) page px, scale 2 canvas px per native px: 2 page px per native px
    const a = placement({ a: 2, d: 2, e: 0, f: 0 }, { w: 640, h: 480 }, { left: 100, top: 50, width: 640, height: 480 });
    assert.deepEqual([a.s, a.sy, a.ox, a.oy], [2, 2, 100, 50]);
    // window fill: the same canvas shown at 1920x1440 css px: 6 page px per native px
    const b = placement({ a: 2, d: 2, e: 0, f: 0 }, { w: 640, h: 480 }, { left: 0, top: 0, width: 1920, height: 1440 });
    assert.equal(b.s, 6);
    // a scope that starts after a translate (offset 10 canvas px)
    const c = placement({ a: 2, d: 2, e: 10, f: 20 }, { w: 640, h: 480 }, { left: 0, top: 0, width: 1280, height: 960 });
    assert.deepEqual([c.s, c.ox, c.oy], [4, 20, 40]);
});

test("the C files' design px (3 per native px, native box at page x 160) map to native units", () => {
    near(dx(160), 0); near(dx(700), 180); near(dx(664), 168); near(dx(0), -160 / 3); near(dy(144), 48); near(dy(474), 158);
});

test("snapRect: floor on the left/top, round on the right/bottom, so touching parts stay flush", () => {
    const pl = { s: 3.4, sy: 3.4, ox: 10.3, oy: 5.7 };
    const a = snapRect({ x: 10, y: 10, w: 20, h: 12 }, pl, { x: 0, y: 0 }, { left: 0, top: 0, right: 2000, bottom: 2000 });
    const b = snapRect({ x: 30, y: 10, w: 20, h: 12 }, pl, { x: 0, y: 0 }, { left: 0, top: 0, right: 2000, bottom: 2000 });
    assert.ok(Math.abs(a.right - b.left) <= 1, "two parts that touch in native units touch within one page pixel");
    for (const r of [a, b]) for (const k of ["left", "top", "right", "bottom", "width", "height"]) assert.ok(Number.isInteger(r[k]), k);
});

test("bleed: a rect that starts at x <= 0 runs on to the left limit, one that ends at x >= 320 to the right limit", () => {
    assert.deepEqual(bleedFlags({ x: 0, y: 0, w: 100, h: 10 }), { left: true, right: false });
    assert.deepEqual(bleedFlags({ x: 200, y: 0, w: 120, h: 10 }), { left: false, right: true });
    assert.deepEqual(bleedFlags({ x: 50, y: 0, w: 100, h: 10 }), { left: false, right: false });
    const pl = { s: 3, sy: 3, ox: 160, oy: 0 };
    const limit = { left: 0, top: 0, right: 1280, bottom: 720 };   // window-fill: the stage is the limit
    const r = snapRect({ x: 0, y: 17, w: 116, h: 42 }, pl, { x: 0, y: 0 }, limit);
    assert.equal(r.left, 0, "bleeds left to the stage edge");
    const wide = snapRect({ x: 180, y: 48, w: 400, h: 12 }, pl, { x: 0, y: 0 }, limit);
    assert.equal(wide.right, 1280, "bleeds right to the stage edge");
    const no = snapRect({ x: 0, y: 17, w: 116, h: 42 }, pl, { x: 0, y: 0 }, limit, false);
    assert.equal(no.left, 160, "text-like parts do not bleed");
});

test("relative / applyRel: the fold, slide and zoom the renderer applies about a pivot carry onto a native rect", () => {
    const m0 = { a: 2, d: 2, e: 0, f: 0 };
    // renderer: translate(px,py) scale(sx,sy) translate(-px,-py) on top of the scope matrix
    const px = 100, py = 40, sx = 0.5, sy = 0.25;
    const m = { a: 2 * sx, d: 2 * sy, e: 2 * (px - px * sx), f: 2 * (py - py * sy) };
    const rel = relative(m0, m);
    near(rel.a, sx); near(rel.d, sy);
    const r = applyRel({ x: 60, y: 20, w: 80, h: 40 }, rel);
    near(r.x, px + (60 - px) * sx); near(r.y, py + (20 - py) * sy); near(r.w, 40); near(r.h, 10);
    assert.deepEqual(applyRel({ x: 1, y: 2, w: 3, h: 4 }, relative(m0, m0)), { x: 1, y: 2, w: 3, h: 4 }, "identity stays identity");
});

test("edges: 4/3 u edge, 2/3 u under-edge, 2 u shadow, at least one pixel", () => {
    assert.deepEqual([edges(3).e1, edges(3).e2, edges(3).sh], [4, 2, 6]);       // 1280x720 page: the C files' numbers
    assert.deepEqual([edges(2).e1, edges(2).e2, edges(2).sh], [3, 1, 4]);       // 640x480
    assert.deepEqual([edges(4.5).e1, edges(4.5).e2, edges(4.5).sh], [6, 3, 9]); // 1920x1080
    assert.equal(edges(0.3).e1, 1); assert.equal(edges(0.3).e2, 1);
    near(edges(3).d, 1);
});

test("dimOf: only a full-screen semi-transparent quad dims the overlay", () => {
    assert.equal(dimOf([]), 0);
    assert.equal(dimOf([{ semiTransparent: true, w: 320, h: 240, r: 255 }]), 1);
    near(dimOf([{ semiTransparent: true, w: 320, h: 240, r: 51 }]), 0.2);
    assert.equal(dimOf([{ semiTransparent: true, w: 100, h: 240, r: 255 }]), 0);
    assert.equal(dimOf([{ semiTransparent: false, w: 320, h: 240, r: 255 }]), 0);
});

// ------------------------------------------------------------------------------------------------ claims
test("claims: the pause home clips are claimed by (pack, id); anything else is art", () => {
    assert.equal(claimFor("cmfont", 21).part, "card");
    assert.equal(claimFor("cmfont", 23).part, "cardName");
    assert.equal(claimFor("cmfont", 24).part, "header");
    assert.equal(claimFor("cmfont", 26).part, "money");
    for (const id of [0x19, 0x1b, 0x1c, 0x108, 0x10c]) assert.equal(claimFor("cmfont", id).part, "panel", String(id));
    assert.equal(claimFor("cmfont", 0x108).rows, 8);
    assert.equal(claimFor("cmfont", "21#2").part, "card", "a palette variant of a claimed clip is claimed too");
    assert.equal(claimFor("cmfont", 1), null, "an unlisted clip is art");
    assert.equal(claimFor("ststat", 21), null, "the pack name is part of the key");
    assert.ok(Object.isFrozen(CLAIMS));
});

const sprite = (id, x, y, dir = 0x2860000) => ({ method: "drawSprite", args: [dir, id, x, y] });
test("isPauseHome: the list panel at (168,40) and the money band together mean the home", () => {
    const calls = [{ method: "setOrigin", args: [320, 0] }, sprite(21, 0, 17), sprite(24, 34, 13), sprite(264, 168, 40), sprite(26, 0, 158)];
    assert.equal(isPauseHome(calls), true);
    assert.equal(isPauseHome(calls.filter((c) => c.args[1] !== 26)), false);
    assert.equal(isPauseHome(calls.map((c) => (c.args[1] === 264 ? sprite(264, 100, 40) : c))), false, "a panel somewhere else is another page");
    assert.equal(isPauseHome([sprite(264, 168, 40, 0x4040000), sprite(26, 0, 158, 0x4040000)]), false, "another pack");
});

// ------------------------------------------------------------------------------------------------ capture scope
test("capture: a claimed clip becomes a part with its matrix, an unclaimed one is drawn on the art context, text becomes runs", () => {
    const artCalls = [];
    const art = { setTransform: (...a) => artCalls.push(["t", ...a]) };
    const ctx = { getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }) };
    const pack = { name: "cmfont", ids: { 1: { layers: [{ dx: 0, dy: 0, w: 30, h: 20 }, { dx: 30, dy: 0, w: 10, h: 20 }] }, 21: { layers: [] } } };
    assert.equal(capturing(), false);
    begin("k", ctx, { a: 2, d: 2, e: 0, f: 0 }, () => art);
    assert.equal(capturing(), true);
    assert.equal(clipHook(ctx, pack, 21, 0, 17, () => assert.fail("claimed clips are not drawn")), true);
    let drawn = 0;
    assert.equal(clipHook(ctx, pack, 1, 4, 8, (c) => { assert.equal(c, art); drawn++; }), true);
    assert.equal(drawn, 1);
    assert.equal(clipHook({ getTransform: ctx.getTransform }, pack, 1, 0, 0, () => assert.fail("another context is not ours")), false);
    assert.equal(runsHook([{ text: "A" }, { text: "B" }]), true);
    const s = end();
    assert.equal(capturing(), false);
    assert.deepEqual(s.parts.map((p) => [p.part, p.x, p.y]), [["card", 0, 17]]);
    // a 40 x 20 sprite is art by size (up to 48 x 48), not a flat plate; not listed in claims.js
    assert.deepEqual(s.unclaimed, [{ pack: "cmfont", id: "1", x: 4, y: 8, w: 40, h: 20, listed: false, flat: false }]);
    assert.deepEqual(s.runs.map((r) => r.text), ["A", "B"]);
    assert.equal(runsHook([{ text: "x" }]), false, "outside a scope nothing is captured");
    assert.deepEqual(clipBounds(pack, 1), { x: 0, y: 0, w: 40, h: 20 });
    assert.equal(clipBounds(pack, 99), null);
});

// ------------------------------------------------------------------------------------------------ text fit rule
test("fit rule: shrink to 85 %, then drop the letter-spacing, and say when it still does not fit", () => {
    const measure = (size, sp) => 10 * (size * 0.5 + sp);   // 10 letters
    assert.deepEqual(fitRun(measure, 20, 2, 0), { size: 20, spacing: 2, fits: true }, "no limit");
    assert.deepEqual(fitRun(measure, 20, 2, 200), { size: 20, spacing: 2, fits: true }, "fits as is");
    const shrunk = fitRun(measure, 20, 2, 115);
    assert.ok(shrunk.fits && shrunk.size < 20 && shrunk.size >= 17 - 1e-9 && shrunk.spacing === 2, JSON.stringify(shrunk));
    const tight = fitRun(measure, 20, 2, 85);
    assert.deepEqual([tight.size, tight.spacing, tight.fits], [17, 0, true], "85 % and no spacing");
    assert.equal(fitRun(measure, 20, 2, 60).fits, false);
});

// ------------------------------------------------------------------------------------------------ shapes, bars, icons
test("plate shapes: the slants and chamfers of the C files, in design px times d", () => {
    const sr = plateShape("sr", 500, 126, 1, 4, 2);
    assert.equal(sr.outer, "polygon(0px 0px,500px 0px,460px 126px,0px 126px)");
    assert.deepEqual(sr.box, { l: 0, t: 4, r: 4, b: 4 });
    assert.equal(sr.inner, "polygon(0px 0px,494px 0px,457px 118px,0px 118px)");
    const sl = plateShape("sl", 760, 64, 1, 4, 2);
    assert.equal(sl.outer, "polygon(40px 0px,760px 0px,760px 64px,0px 64px)");
    assert.equal(sl.inner, "polygon(41px 0px,756px 0px,756px 56px,2px 56px)");
    const row = plateShape("row", 300, 36, 1, 4, 2);
    assert.equal(row.outer, "polygon(14px 0px,300px 0px,300px 36px,0px 36px,0px 14px)");
    assert.equal(row.inner, "polygon(13px 0px,300px 0px,300px 34px,0px 34px,0px 13px)");
    assert.deepEqual(row.box, { l: 0, t: 0, r: 0, b: 2 });
    assert.equal(plateShape("rowSolid", 300, 36, 1, 4, 2).inner, null);
    const big = plateShape("sr", 1500, 378, 3, 12, 6);
    assert.equal(big.outer, "polygon(0px 0px,1500px 0px,1380px 378px,0px 378px)", "the slant scales with d");
});

test("bars: the fill is a whole pixel width and never leaves the track", () => {
    assert.equal(barFill(0.5, 136), 68);
    assert.equal(barFill(1, 136), 136); assert.equal(barFill(0, 136), 0);
    assert.equal(barFill(2, 136), 136); assert.equal(barFill(-1, 136), 0);
    assert.ok(Number.isInteger(barFill(0.3333, 137)));
});

test("icons: four cursor poses, button badges, and the token splitter", () => {
    assert.deepEqual(Object.keys(CURSOR_POSES), ["[enter]", "[enter2]", "[select]", "[space2]"]);
    assert.equal(CURSOR_POSES["[space2]"].hidden, true);
    assert.ok(CURSOR_POSES["[enter2]"].sx > 1 && CURSOR_POSES["[select]"].sy < 1);
    assert.ok(isCursorToken("[enter]") && !isCursorToken("ITEMS") && !isCursorToken("[triangle]"));
    assert.match(badgeSvg("[triangle]"), /^<svg/);
    assert.equal(badgeSvg("[nothing]"), null, "an unknown token falls back to the old glyph");
    assert.deepEqual(splitTokens("[triangle]Button: Close Status"), [{ tok: "[triangle]" }, { txt: "Button: Close Status" }]);
    assert.deepEqual(splitTokens("a [x] b"), [{ txt: "a " }, { tok: "[x]" }, { txt: " b" }]);
});
