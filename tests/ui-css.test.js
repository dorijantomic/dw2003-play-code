// "UI look: Smooth" (idea I11, first slice): the measured geometry of the field conversation box, the 320x240 -> screen mapping at
// several canvas sizes, the layout read back from the game's own draw calls, and the OPTIONS row. Pure: no browser, no DOM.
// The numbers pinned here were read from resident.bin (layout tables D0x8004DCF8 / D0x8004DD00 / D0x8004DD10) and the cmfont sheet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    BALLOON_FRAME, BALLOON_MODES, CHOICE_LOOK, CLIP, MARKER, PAUSE_LIST, PLAIN_BAND, SYMBOL_GLYPHS, TAIL_ROWS, TEXT_FACES, TILES, UI_H, UI_W,
    YESNO_PLACEMENTS, YESNO_WINDOW, MONEY_BAND_PLACEMENTS,
    balloonParts, balloonRects, choiceLayout, composeRects, fadeDim, glyphBoxes, isSmoothLook, layoutFromIntents, moneyBandRects, panelHeightFor,
    pauseHomeLayout, pausePanelPlacements, pausePanelRects, pausePanelRows, scaledRect, spritesFromCalls, tailInnerPolygon, tailPolygon,
    uiPlacement, uiRectToScreen, uiViewScale, widgetInside, yesNoLayout, yesNoRects,
} from "../web/ui-css-model.js";
import { PAGES, buildRows, createOptionsModel } from "../web/options-model.js";

const src = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ------------------------------------------------------------------------------------------------ geometry table
test("the balloon frame numbers are the measured ones", () => {
    assert.equal(UI_W, 320); assert.equal(UI_H, 240);
    assert.equal(BALLOON_FRAME.h, 62);              // +0x66 = 0x3E
    assert.equal(BALLOON_FRAME.minW, 95);           // clamp 0x5F
    assert.equal(BALLOON_FRAME.maxW, 139);          // clamp 0x8B (0x8C and over become 0x8B)
    assert.equal(BALLOON_FRAME.capL, 16);           // cmfont clip 0
    assert.equal(BALLOON_FRAME.capR, 12);           // cmfont clip 2
    assert.deepEqual(BALLOON_FRAME.ringsTL, ["rgb(184,232,232)", "rgb(120,160,168)", "rgb(152,208,208)", "rgb(184,216,224)", "rgb(192,224,232)"]);
    assert.deepEqual(BALLOON_FRAME.ringsBR, ["rgb(88,112,120)", "rgb(120,160,168)", "rgb(152,208,208)", "rgb(184,216,224)", "rgb(192,224,232)"]);
    assert.equal(BALLOON_FRAME.fill, "rgb(216,232,248)");
    assert.deepEqual(BALLOON_FRAME.divider, { y: 12, colours: ["rgb(104,176,176)", "rgb(0,128,112)", "rgb(104,176,176)"] });
    assert.deepEqual(BALLOON_FRAME.dashesLeft, [[3, 2], [7, 3], [11, 1]]);
    assert.deepEqual(BALLOON_FRAME.dashesRight, [[15, 1], [18, 3], [23, 2], [26, 31]]);
});

test("the four modes carry the layout-table offsets (and the old hand-written tail table agrees)", () => {
    assert.deepEqual(BALLOON_MODES.map((m) => [m.tail.clip, m.tail.dx, m.tail.dy]), [[3, 0, -16], [5, 0, 0], [4, -16, -16], [6, -20, 0]]);   // web/textbox.js BALLOON_TAIL
    assert.deepEqual(BALLOON_MODES.map((m) => [m.capL.dx, m.capL.dy]), [[0, -74], [0, 12], [-26, -74], [-26, 12]]);
    assert.deepEqual(BALLOON_MODES.map((m) => [m.fill.dx, m.fill.dy]), [[16, -74], [16, 12], [-10, -74], [-10, 12]]);
    assert.deepEqual(BALLOON_MODES.map((m) => [m.nameText.dx, m.nameText.dy, m.bodyText.dx, m.bodyText.dy]), [[6, -71, 6, -58], [6, 15, 6, 28], [-20, -71, -20, -58], [-20, 15, -20, 28]]);
    assert.deepEqual(BALLOON_MODES.map((m) => m.marker.dy), [-38, 48, -38, 48]);
    assert.deepEqual(BALLOON_MODES.map((m) => m.marker.dx), [16, 16, null, null]);   // modes 2/3 use width - 14
});

test("balloonRects: the four modes from an anchor and a width", () => {
    const m0 = balloonRects(0, 300, 120, 100);
    assert.deepEqual(m0.outer, { x: 200, y: 46, w: 128, h: 62 });        // width + 28
    assert.deepEqual(m0.fill, { x: 216, y: 46, w: 100, h: 62 });
    assert.deepEqual(m0.tail, { clip: 3, x: 300, y: 104 });
    assert.deepEqual(m0.nameText, { x: 206, y: 49 }); assert.deepEqual(m0.bodyText, { x: 206, y: 62 });
    assert.deepEqual(m0.marker, { x: 316, y: 82, w: 8, h: 20 });
    const m1 = balloonRects(1, 300, 100, 95);
    assert.deepEqual(m1.outer, { x: 205, y: 112, w: 123, h: 62 });
    assert.deepEqual(m1.tail, { clip: 5, x: 300, y: 100 }); assert.deepEqual(m1.marker, { x: 316, y: 148, w: 8, h: 20 });
    const m2 = balloonRects(2, 100, 150, 100);
    assert.deepEqual(m2.outer, { x: 74, y: 76, w: 124, h: 62 });         // width + 24
    assert.deepEqual(m2.fill, { x: 90, y: 76, w: 100, h: 62 });
    assert.deepEqual(m2.tail, { clip: 4, x: 84, y: 134 });
    assert.deepEqual(m2.nameText, { x: 80, y: 79 }); assert.deepEqual(m2.bodyText, { x: 80, y: 92 });
    assert.deepEqual(m2.marker, { x: 186, y: 112, w: 8, h: 20 });
    const m3 = balloonRects(3, 100, 100, 139);
    assert.deepEqual(m3.capR, { x: 225, y: 112 }); assert.deepEqual(m3.tail, { clip: 6, x: 80, y: 100 });
    // the body top agrees with web/textbox.js balloonBodyRect: above = anchor - 12 - h with h = 62 -> anchor - 74
    assert.equal(balloonRects(0, 0, 200, 100).fill.y + 62, 200 - 12);
});

test("tail silhouettes: 16 rows for clips 3 and 4, 14 for clips 5 and 6; every row ends inside its sprite", () => {
    assert.deepEqual(Object.keys(TAIL_ROWS).map((k) => TAIL_ROWS[k].length), [16, 16, 14, 14]);
    for (const [clip, rows] of Object.entries(TAIL_ROWS)) {
        const w = clip === "3" || clip === "5" ? 16 : 20;
        for (const [a, b] of rows) assert.ok(a >= 0 && a <= b && b < w, `${clip}: ${a}..${b}`);
        assert.ok(tailPolygon(Number(clip)).length === rows.length * 4);
        assert.ok(tailInnerPolygon(Number(clip)).length >= 4);
    }
    assert.equal(tailPolygon(9), null);
});

test("the plain window: band rows, origin of its text, and the marker", () => {
    assert.deepEqual([PLAIN_BAND.x, PLAIN_BAND.y, PLAIN_BAND.w, PLAIN_BAND.h], [0, 166, 320, 60]);   // clips 8, 9 at (0, 0xA6)
    assert.deepEqual(PLAIN_BAND.textOrigin, { x: 18, y: 176 });                                       // F0x8001BE00: (0x12, 0xB0)
    assert.deepEqual(PLAIN_BAND.rows.map((r) => r[0] + r[1]).slice(-1), [60]);
    assert.deepEqual([MARKER.w, MARKER.h], [8, 20]);
    assert.deepEqual(TEXT_FACES[1], { cellH: 12, capH: 10, baseline: 11, faceIndex: 2, shadowIndex: 1, fontPx: 14 });
    assert.equal(TEXT_FACES[2].cellH, 9);
});

test("pause list frames (measured; slice 2 draws the panel and the money band in CSS)", () => {
    assert.deepEqual([PAUSE_LIST.panel.x, PAUSE_LIST.panel.y, PAUSE_LIST.panel.w], [168, 40, 160]);
    assert.deepEqual([5, 6, 7].map(panelHeightFor), [84, 98, 112]);                                  // equals the sheet's clips 0x1c 0x1b 0x19
    assert.deepEqual([PAUSE_LIST.helpBand.x, PAUSE_LIST.helpBand.y, PAUSE_LIST.helpBand.w, PAUSE_LIST.helpBand.h], [0, 158, 108, 21]);
});

// ------------------------------------------------------------------------------------------------ 320x240 -> screen
test("the native frame scale is the game's own: min(viewW/320, viewH/240), at least 1", () => {
    assert.equal(uiViewScale(640, 480), 2);
    assert.equal(uiViewScale(320, 240), 1);
    assert.equal(uiViewScale(1280, 480), 2);
    assert.equal(uiViewScale(100, 100), 1);
});

test("mapping 320x240 to page pixels at several canvas sizes", () => {
    // 640x480 canvas at the page origin: one native pixel = 2 page pixels
    assert.deepEqual(uiRectToScreen({ x: 0, y: 0, w: 320, h: 240 }, { left: 0, top: 0, width: 640, height: 480 }), { left: 0, top: 0, width: 640, height: 480 });
    // 1280x960 canvas at (10, 20): 4 page pixels per native pixel
    assert.deepEqual(uiRectToScreen({ x: 160, y: 120, w: 16, h: 12 }, { left: 10, top: 20, width: 1280, height: 960 }), { left: 650, top: 500, width: 64, height: 48 });
    // 480x360 canvas: 1.5 per native pixel
    assert.deepEqual(uiRectToScreen({ x: 18, y: 176, w: 100, h: 12 }, { left: 0, top: 0, width: 480, height: 360 }), { left: 27, top: 264, width: 150, height: 18 });
    // a squashed canvas (960x540): x and y scale differ, exactly as the canvas pixels do
    const p = uiPlacement({ left: 5, top: 7, width: 960, height: 540 });
    near(p.kx, 3); near(p.ky, 2.25);
    assert.deepEqual(uiRectToScreen({ x: 0, y: 166, w: 320, h: 60 }, { left: 5, top: 7, width: 960, height: 540 }), { left: 5, top: 7 + 166 * 2.25, width: 960, height: 135 });
    // a 320x240 logical view (UI Lab): scale 1, so 2 page pixels per native pixel on a 640x480 canvas
    assert.deepEqual(uiRectToScreen({ x: 10, y: 10, w: 10, h: 10 }, { left: 0, top: 0, width: 640, height: 480 }, { w: 320, h: 240 }), { left: 20, top: 20, width: 20, height: 20 });
});

// ------------------------------------------------------------------------------------------------ layout from the game's calls
const sprite = (id, x, y) => ({ method: "drawSprite", args: [0x02860000, id, x, y] });
const fillRaw = (x0, y0, x1, y1) => ({ at: 0, kind: "frameFill", intent: { corners: [x0, y0, x1, y0, x0, y1, x1, y1] } });

/** The calls dialogueFrameDraw makes for a balloon (clip 0 at the left piece, clip 2 at the right piece, the tail, the arrow) and its fill quad. */
function synth(mode, ax, ay, width) {
    const r = balloonRects(mode, ax, ay, width);
    const calls = [sprite(r.tail.clip, r.tail.x, r.tail.y), sprite(0, r.capL.x, r.capL.y), sprite(2, r.capR.x, r.capR.y), sprite(7, r.marker.x, r.marker.y)];
    return { r, calls, raw: [fillRaw(r.fill.x, r.fill.y, r.fill.x + r.fill.w, r.fill.y + r.fill.h)] };
}

test("layoutFromIntents rebuilds the balloon from the draw calls, for every mode", () => {
    for (const [mode, ax, ay, w] of [[0, 300, 120, 100], [1, 300, 100, 95], [2, 100, 150, 100], [3, 100, 100, 139]]) {
        const { r, calls, raw } = synth(mode, ax, ay, w);
        const { balloon, band } = layoutFromIntents(calls, raw);
        assert.equal(band, null);
        assert.deepEqual(balloon.outer, r.outer, `mode ${mode} outer`);
        assert.deepEqual(balloon.fill, r.fill, `mode ${mode} fill`);
        assert.deepEqual(balloon.tail, r.tail, `mode ${mode} tail`);
        assert.deepEqual(balloon.marker, r.marker, `mode ${mode} marker`);
    }
});

test("layoutFromIntents: the plain window's band follows the game's own wipe scale and pivot", () => {
    const calls = [
        { method: "setScale", args: [0x800, 0x1000, 0x1000] }, { method: "setPos", args: [320, 196] },
        sprite(8, 0, 166), sprite(9, 0, 166),
    ];
    const { balloon, band } = layoutFromIntents(calls, []);
    assert.equal(balloon, null);
    assert.deepEqual(band, { x: 320 + (0 - 320) * 0.5, y: 166, w: 160, h: 60 });       // half way through the wipe, pinned at the right edge
    const full = layoutFromIntents([sprite(8, 0, 166), sprite(9, 0, 166)], []).band;
    assert.deepEqual(full, { x: 0, y: 166, w: 320, h: 60 });
    assert.deepEqual(layoutFromIntents([], []), { balloon: null, band: null });
});

test("a draw-context marker resets scale and pivot, like the renderer", () => {
    const calls = [{ method: "setScale", args: [0x800, 0x800, 0x1000] }, sprite(8, 0, 0), sprite(9, 0, 0)];
    const s = spritesFromCalls(calls, [1]);
    assert.equal(s[0].sx, 1);   // the marker at call 1 starts a fresh context before the first sprite
});

test("balloonParts: body, drop line and dashes sit inside the 62-high frame, for the widest and narrowest box", () => {
    for (const w of [95 + 28, 139 + 28, 139 + 24]) {
        const parts = balloonParts(w);
        const body = parts.find((p) => p.name === "body");
        assert.deepEqual([body.x, body.y, body.w, body.h], [0, 0, w - 2, 60]);
        assert.equal((body.css.match(/inset/g) ?? []).length, 10);          // five rings, two sides each
        for (const p of parts) {
            assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= 62, `${p.name} stays inside ${w}x62`);
        }
        assert.equal(parts.filter((p) => p.name.startsWith("dash-left")).length, 3);
        assert.equal(parts.filter((p) => p.name.startsWith("dash-right")).length, 4);
    }
});

// ------------------------------------------------------------------------------------------------ the OPTIONS row
test("OPTIONS: one row 'UI look' Pixel / Smooth on the SCREEN page, Pixel by default, written to fx.uiLook", () => {
    assert.ok(PAGES.find((p) => p.id === "screen").rows.includes("uiLook"));
    const rows = buildRows([["off", "Off"]]);
    assert.equal(rows.uiLook.label, "UI look");
    assert.deepEqual(rows.uiLook.choices, ["Pixel", "Smooth"]);
    const fx = {};
    const store = { get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) };
    assert.equal(rows.uiLook.read(store), 0, "nothing saved reads Pixel");
    rows.uiLook.write(store, 1);
    assert.equal(fx.uiLook, "smooth");
    assert.equal(rows.uiLook.read(store), 1);
    rows.uiLook.write(store, 0);
    assert.equal(fx.uiLook, "pixel");
    fx.uiLook = "sharp";                                    // an old or hand-edited save
    assert.equal(rows.uiLook.read(store), 0, "junk reads Pixel");
    assert.equal(isSmoothLook("smooth"), true);
    for (const v of ["pixel", "Smooth", undefined, null, 1, ""]) assert.equal(isSmoothLook(v), false);
});

test("OPTIONS: the model moves onto the row and changes it with left / right", () => {
    const fx = { weatherMode: "auto", quality: "high", todMode: "auto", spriteFilter: "off", battleSpeed: 2, encounterDialMode: "normal", musicVolume: 1, soundVolume: 1 };
    const model = createOptionsModel({ get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) }, [["off", "Off"]]);
    model.switchPage(1);
    for (let i = 0; i < 4; i++) model.moveRow(1);
    const view = model.view();
    assert.equal(view[model.row()].id, "uiLook");
    assert.equal(view[model.row()].value, "Pixel");
    assert.equal(model.change(1), "change");
    assert.equal(fx.uiLook, "smooth");
    assert.equal(model.view()[model.row()].value, "Smooth");
});

test("wiring: default is pixel, the game path is untouched unless the row says smooth, no URL flag", () => {
    assert.match(src("ambience.js"), /fx\.uiLook = "pixel";/);
    const dt = src("dialogue-translated.js");
    assert.match(dt, /if \(uiLookSmooth\(\) && uiCssAvailable\(\)\) \{/);
    assert.match(dt, /renderer\.draw\(ctx, calls, null, \[\], contextMarkers, raw\);/);   // the pixel path is still there, after the branch
    for (const f of ["ui-css.js", "ui-css-model.js"]) assert.doesNotMatch(src(f), /location\.search|URLSearchParams/, `${f} reads no URL flag`);
    assert.match(src("ui-css.js"), /window\.__uiCss = \{/);
});

// ================================================================================================ slice 2
const area = (rects) => rects.reduce((a, r) => a + r.w * r.h, 0);

test("tiles: every frame's rows cover its height exactly and its runs add up to its width", () => {
    assert.deepEqual(Object.keys(TILES).map(Number), [47, 48, 56, 57, 58, 59, 60, 61, 62, 63]);
    for (const [frame, t] of Object.entries(TILES)) {
        let next = 0;
        for (const [start, count, runs] of t.rows) {
            assert.equal(start, next, `frame ${frame} rows are contiguous`);
            next += count;
            assert.equal(runs.reduce((a, [, n]) => a + n, 0), t.w, `frame ${frame} row ${start} is ${t.w} wide`);
        }
        assert.equal(next, t.h, `frame ${frame} is ${t.h} high`);
    }
    assert.deepEqual([TILES[56].w, TILES[56].h, TILES[58].h, TILES[60].h, TILES[47].w, TILES[48].w, TILES[62].w, TILES[63].w, TILES[62].h], [40, 22, 14, 20, 24, 12, 20, 4, 50]);
});

test("the pause panel is the sheet's own composition: 22 + 14 per middle band + 20 high, 160 wide, boxes never overlap", () => {
    assert.deepEqual([5, 6, 7, 8, 9].map((n) => pausePanelPlacements(n).length), [20, 24, 28, 32, 36]);   // = the layer counts of clips 0x1c 0x1b 0x19 and the extra ones
    for (const [rows, boxes] of [[5, 41], [6, 44], [7, 47], [8, 50], [9, 53]]) {
        const rects = pausePanelRects(rows), h = panelHeightFor(rows);
        assert.equal(rects.length, boxes, `${rows} rows`);
        assert.equal(Math.max(...rects.map((r) => r.y + r.h)), h);
        assert.equal(Math.max(...rects.map((r) => r.x + r.w)), 160);
        assert.equal(area(rects), 160 * h - 31, `${rows} rows: every texel but the 31 clear ones in the two chamfered corners`);
        const seen = new Set();
        for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { assert.ok(!seen.has(y * 160 + x), "no overlap"); seen.add(y * 160 + x); }
    }
    // the edge line, the body, the row line
    const p5 = pausePanelRects(5);
    assert.ok(p5.some((r) => r.colour === "#6868d0" && r.x === 4 && r.y === 0 && r.w === 156 && r.h === 1), "top edge");
    assert.ok(p5.some((r) => r.colour === "#282870" && r.y === 21 && r.x === 21 && r.w === 139 && r.h === 1), "first row line, from x 21 to the edge");
    assert.deepEqual(new Set(p5.map((r) => r.colour)), new Set(["#6868d0", "#303068", "#000048", "#000020", "#282870", "#5050a0", "#000008"]));
});

test("the money band (108 x 21) and the Yes/No window (320 x 50) compose from their frames", () => {
    assert.deepEqual(MONEY_BAND_PLACEMENTS.map(([f, dx]) => `${f}@${dx}`), ["47@0", "47@24", "47@48", "47@72", "48@96"]);
    assert.equal(moneyBandRects().length, 24);
    assert.equal(area(moneyBandRects()), 108 * 21 - 4);                      // the slanted end clears two texels in each of its top two rows
    assert.equal(Math.max(...moneyBandRects().map((r) => r.x + r.w)), 108);
    assert.equal(YESNO_PLACEMENTS.length, 18);
    assert.deepEqual(YESNO_PLACEMENTS.slice(-2), [[63, 12, 0], [63, 306, 0]]);
    assert.equal(yesNoRects().length, 8);
    assert.equal(area(yesNoRects()), 320 * 50);
    assert.ok(yesNoRects().some((r) => r.colour === "#6868d0" && r.x === 12 && r.w === 1 && r.y === 1 && r.h === 46), "the upright line at x 12");
    assert.deepEqual([YESNO_WINDOW.clip, YESNO_WINDOW.w, YESNO_WINDOW.h], [0x45, 320, 50]);
});

test("composeRects: later frames cover earlier ones only where they are not clear", () => {
    const r = composeRects([[56, 0, 0]], 40, 22);
    assert.equal(area(r), 40 * 22 - 10);                                      // four + three + two + one clear texels at the top-left chamfer
    assert.equal(composeRects([[56, 0, 0], [57, 0, 0]], 40, 22).length, composeRects([[57, 0, 0]], 40, 22).length, "frame 57 is solid, so it hides frame 56");
});

test("pauseHomeLayout: the panel and the money band from the session's own draw calls, any row count", () => {
    const home = (clip) => [{ method: "setScale", args: [0x1000, 0x1000, 0x1000] }, sprite(0x15, 0, 0x11), sprite(0x18, 0x22, 0xd), sprite(clip, 0xa8, 0x28), sprite(0x1a, 0, 0x9e)];
    for (const [clip, rows] of [[0x1c, 5], [0x1b, 6], [0x19, 7], [0x108, 8], [0x109, 9]]) {
        const lay = pauseHomeLayout(home(clip), [0]);
        assert.equal(pausePanelRows(clip), rows);
        assert.deepEqual(lay.skipClips, [clip, 0x1a], "the canvas skips exactly these clips");
        const [panel, band] = lay.tiled;
        assert.deepEqual([panel.name, panel.rect.x, panel.rect.y, panel.rect.w, panel.rect.h], ["pause-panel", 168, 40, 160, panelHeightFor(rows)]);
        assert.deepEqual([band.name, band.rect.x, band.rect.y, band.rect.w, band.rect.h], ["pause-money-band", 0, 158, 108, 21]);
        assert.deepEqual(lay.textRects, [{ x: 168, y: 40, w: 160, h: panelHeightFor(rows) }, { x: 0, y: 158, w: 108, h: 21 }]);
    }
    // the cards, the prompt and other clips stay on the canvas: not skipped
    assert.ok(!pauseHomeLayout(home(0x1c), [0]).skipClips.includes(0x15));
    // other pages: no panel at (168,40), no band at (0,158)
    assert.equal(pauseHomeLayout([sprite(0x1c, 10, 40), sprite(0x1a, 0, 0)], []), null);
    assert.equal(pauseHomeLayout([], []), null);
    assert.deepEqual([0x1d, 0x100, 0x107, 0x10d, 0].map(pausePanelRows), [0, 0, 0, 0, 0]);
});

test("pauseHomeLayout: the panel's slide-in keeps the game's own scale and pivot", () => {
    const calls = [{ method: "setScale", args: [0x666, 0x1000, 0x1000] }, { method: "setPos", args: [320, 82] }, sprite(0x1c, 0xa8, 0x28)];
    const t = pauseHomeLayout(calls, []).tiled[0];
    near(t.rect.sx, 0x666 / 0x1000);
    assert.deepEqual([t.rect.px, t.rect.py], [320, 82]);
    const w = scaledRect(t.rect);
    near(w.x, 320 + (168 - 320) * t.rect.sx); near(w.w, 160 * t.rect.sx); near(w.y, 40); assert.equal(w.h, 84);   // pinned at the right edge
    assert.deepEqual(scaledRect({ x: 5, y: 6, w: 7, h: 8 }), { x: 5, y: 6, w: 7, h: 8 });
});

test("widgetInside: the row labels, the cursor and the BIT amount belong to the overlay, the party cards and the top help line do not", () => {
    const rects = pauseHomeLayout([sprite(0x1c, 0xa8, 0x28), sprite(0x1a, 0, 0x9e)], []).textRects;
    for (const [x, y] of [[189, 49], [189, 105], [176, 49], [176, 91], [70, 166], [66, 166]]) assert.equal(widgetInside(rects, x, y), true, `${x},${y}`);
    for (const [x, y] of [[152, 19], [55, 19], [16, 28], [94, 138], [189, 125], [167, 60], [70, 180], [66, 157]]) assert.equal(widgetInside(rects, x, y), false, `${x},${y}`);
});

test("fadeDim: only a full-screen semi-transparent quad dims the overlay", () => {
    assert.equal(fadeDim([]), 0);
    assert.equal(fadeDim([{ semiTransparent: true, w: 320, h: 240, r: 128 }]), 128 / 255);
    assert.equal(fadeDim([{ semiTransparent: true, w: 6, h: 90, r: 200 }, { semiTransparent: false, w: 320, h: 240, r: 200 }]), 0, "a scroll bar or an opaque quad is not the fade");
    assert.equal(fadeDim([{ semiTransparent: true, w: 320, h: 240, r: 255 }]), 1);
});

test("yesNoLayout: the window clip 0x45, scaled about its pivot while it folds open", () => {
    const fold = [{ method: "setScale", args: [0x666, 0x1000, 0x1000] }, { method: "setPos", args: [0, 195] }, sprite(0x45, 0, 0xac)];
    const t = yesNoLayout(fold, [0]).tiled[0];
    assert.equal(t.name, "yesno-window");
    assert.deepEqual([t.rect.x, t.rect.y, t.rect.w, t.rect.h], [0, 172, 320, 50]);
    near(scaledRect(t.rect).w, 320 * 0x666 / 0x1000);
    const open = yesNoLayout([sprite(0x45, 0, 0xac)], []).tiled[0];
    assert.deepEqual(scaledRect(open.rect), { x: 0, y: 172, w: 320, h: 50 });
    assert.equal(yesNoLayout([sprite(0x1c, 0, 0xac)], []), null);
});

test("cursor glyphs: the four frames the game swaps, as boxes in the font's shadow (1) and face (2) entries", () => {
    assert.deepEqual(Object.keys(SYMBOL_GLYPHS), ["[enter]", "[enter2]", "[select]", "[space2]"]);
    const count = (g) => glyphBoxes(g).reduce((a, b) => a + b.w * b.h, 0);
    assert.deepEqual(Object.values(SYMBOL_GLYPHS).map((g) => g.rows.length), [12, 12, 12, 12]);
    assert.deepEqual(Object.values(SYMBOL_GLYPHS).map(count), [50, 50, 26, 0]);   // triangle texels (3+4+5+6+7+7+6+5+4+3), bar texels (6+7+7+6)
    assert.deepEqual(glyphBoxes(SYMBOL_GLYPHS["[select]"]).filter((b) => b.index === 2), [{ x: 1, y: 5, w: 5, h: 2, index: 2 }]);
    assert.ok(glyphBoxes(SYMBOL_GLYPHS["[enter2]"]).every((b) => b.index === 2), "the large triangle is all face colour");
    for (const g of Object.values(SYMBOL_GLYPHS)) for (const row of g.rows) assert.equal(row.length, 8);
});

test("choiceLayout: web/choice.js's own arithmetic in the 320x240 space (view 640x480: 2 view px per native px)", () => {
    const c = choiceLayout({ prompt: "Q", options: ["Yes", "No"], cursorIdx: 1 }, 640, 480);
    assert.equal(c.scale, 2);
    // boxH = 16*2 + 24 + 2*24 = 104; x = 12, w = 616, y = 480 - 104 - 12 = 364
    assert.deepEqual(c.window, { x: 6, y: 182, w: 308, h: 52 });
    assert.deepEqual([c.prompt.x, c.prompt.y], [14, 196]);                          // (x + 16, y + 16 + 12) / 2
    assert.deepEqual(c.options.map((o) => [o.x, o.y, o.fill]), [[22, 209, "#a8a8c8"], [22, 221, "#ffffff"]]);   // (x + 32, y + 40 + i*24 + 14) / 2
    assert.deepEqual([c.cursor.x, c.cursor.y, c.cursor.text], [12, 221, "▶"]);   // (x + 16 - 4, row of option 1) / 2
    assert.equal(c.fontPx, 8); assert.equal(c.edge, 0.5);
    // the canvas draws at 3 view px per native px: same box, same shape
    const big = choiceLayout({ prompt: "Q", options: ["Yes", "No"], cursorIdx: 0 }, 960, 720);
    assert.equal(big.scale, 3); near(big.window.w, (960 - 24) / 3); near(big.window.y, (720 - 104 - 12) / 3);
    assert.equal(big.options[0].fill, "#ffffff"); assert.equal(big.options[1].fill, "#a8a8c8");
    assert.equal(choiceLayout({ prompt: "x", options: [], cursorIdx: 0 }).cursor, null);
    assert.equal(CHOICE_LOOK.fill, "rgb(0,0,32)");
});

test("choice.js, uiRects.js and the overlay agree on the colours and the 16px monospace", () => {
    const c = src("choice.js"), u = src("uiRects.js");
    assert.match(u, /ctx\.fillStyle = "rgb\(0, 0, 32\)"/); assert.match(u, /ctx\.strokeStyle = "rgb\(104, 104, 208\)"/);
    for (const col of [CHOICE_LOOK.prompt, CHOICE_LOOK.cursor, CHOICE_LOOK.picked, CHOICE_LOOK.other]) assert.ok(c.includes(`"${col}"`), col);
    assert.match(c, /ctx\.font = "16px monospace"/);
    assert.match(c, /const lineH = 24, pad = 16;/); assert.match(c, /const x = 12, w = viewW - 24;/);
});

test("wiring slice 2: each owner draws the overlay only in Smooth, skips what it draws, and falls back to the unchanged pixel path", () => {
    const ch = src("choice.js"), yn = src("yesno-translated.js"), st = src("status-translated.js"), nt = src("native-screen-text.js"), ns = src("native-session.js");
    assert.match(ch, /if \(uiLookSmooth\(\) && uiCssAvailable\(\) && uiCssShow\(uiKey, \{ choice: choiceLayout\(ch, viewW, viewH\) \}/);
    assert.match(ch, /const lineH = 24, pad = 16;/, "the canvas drawing is still there");
    assert.match(yn, /uiLookSmooth\(\) && uiCssAvailable\(\) \? yesNoLayout\(calls, contextMarkers\) : null/);
    assert.match(yn, /renderer\.draw\(ctx, calls, null, \[\], contextMarkers, \[\]\);/);
    assert.match(st, /st\._entry === "home" && uiLookSmooth\(\) && uiCssAvailable\(\)/);
    assert.match(st, /skipClip: \(name, id\) => skipClips\.size > 0 && name === "cmfont" && skipClips\.has\(id\)/);
    assert.match(st, /paintNativeSession\(ctx, renderer, session, \{ fade: false, skipWidget \}\)/);
    assert.match(st, /if \(!skipWidget\) uiCssHide\(st\._uiKey\)/);
    assert.match(nt, /if \(opts\.skip && opts\.skip\(w\)\) continue;/);
    assert.match(ns, /skipWidget \? \{ revealWindow, skip: skipWidget \} : \{ revealWindow \}/, "without a skip the text call is the old one");
    assert.match(src("ui-css.js"), /export function uiCssHide\(key\)/);
});
