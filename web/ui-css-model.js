// web/ui-css-model.js -- the "UI look: Smooth" model (idea I11, first slice). Pure: no DOM, no window.
//
// The field conversation box (the NPC balloon, the plain bottom window, the balloon tail and the "more" arrow) is drawn in
// the 320x240 native space from CMFONTCS sprite pieces plus one stretched fill quad (engine/dw3/ui/native/dialogue-frame.ts
// F0x8001C050, dialogue-plain-window.ts, dialogue-marker.ts). The numbers below were READ from the shipped data, not
// guessed: the layout tables D0x8004DCF8 / D0x8004DD00 / D0x8004DD10 in resident.bin and the pixels of the cmfont sheet
// (assets/ui/cmfont_sheet.png clips 0 1 2 3 4 5 6 7 8 9) and the uifont sheet. They are the SHAPES (rects, ring colours,
// gradient rows), so a DOM+CSS layer can draw the same silhouette as vectors that scale with the canvas.
// The CSS layer draws only what the game already decided: positions come from the session's own draw calls
// (layoutFromIntents), the text from its own widgets. Timing, input and sound are untouched.
//
// Pause list (part b): measured and pinned here (PAUSE_LIST), but NOT drawn in CSS yet: its row text, cursor and icons are
// canvas-drawn on top of the panel, and a DOM panel above the canvas would cover them. See the report.

export const UI_W = 320;
export const UI_H = 240;

// ------------------------------------------------------------------------------------------------ 320x240 -> screen
/** Native-to-view scale the game's own native screens use (web/dialogue-translated.js draw): the 320x240 frame sits at the
 *  view's top-left, scaled by min(viewW/320, viewH/240), at least 1. */
export function uiViewScale(viewW, viewH) {
    return Math.max(1, Math.min(viewW / UI_W, viewH / UI_H));
}

/**
 * Where the 320x240 space lands on the page. `canvasRect` = the game canvas getBoundingClientRect() (page px),
 * `view` = the canvas's logical size (640x480). Returns the page-px origin and the page px per native pixel (kx, ky).
 */
export function uiPlacement(canvasRect, view = { w: 640, h: 480 }) {
    const s = uiViewScale(view.w, view.h);
    return {
        left: canvasRect.left, top: canvasRect.top,
        kx: s * canvasRect.width / view.w, ky: s * canvasRect.height / view.h,
    };
}

/** A native rect {x,y,w,h} as a page rect {left,top,width,height} (what getBoundingClientRect() must report). */
export function uiRectToScreen(rect, canvasRect, view = { w: 640, h: 480 }) {
    const p = uiPlacement(canvasRect, view);
    return { left: p.left + rect.x * p.kx, top: p.top + rect.y * p.ky, width: rect.w * p.kx, height: rect.h * p.ky };
}

// ------------------------------------------------------------------------------------------------ colours (sheet pixels)
const C = {
    edge: "rgb(184,232,232)",    // 'a'  outer bright edge (top/left ring 0)
    mid: "rgb(120,160,168)",     // 'c'
    soft: "rgb(152,208,208)",    // 'b'
    pale: "rgb(184,216,224)",    // 'e'
    paler: "rgb(192,224,232)",   // 'f'
    fill: "rgb(216,232,248)",    // 'g'  body
    teal: "rgb(0,128,112)",      // 'd'  accent line
    tealSoft: "rgb(104,176,176)",// 'h'  either side of the divider
    dark: "rgb(88,112,120)",     // 'i'  bottom/right ring 0
    shadowHi: "rgb(240,240,240)",// 'k'
    shadowLo: "rgb(120,120,120)",// 'j'
    tailFill: "rgb(160,208,208)",
};

// ------------------------------------------------------------------------------------------------ the balloon frame
/**
 * Balloon frame, in native pixels (clips 0 / 1 / 2 of cmfont; the quad texture is clip 1):
 *  - height 62 (+0x66 = 0x3E), always; width 95..139 (+0x64, clamped 0x5F..0x8B by dialogueBalloonBuild)
 *  - left piece = clip 0 (16 wide), right piece = clip 2 (12 wide), middle = clip 1 stretched
 *  - the body inside the pieces is (outerW - 2) x 60; the last 2 px right and bottom are a 1px white + 1px grey drop line
 *  - five 1px rings: top/left outer->inner [edge, mid, soft, pale, paler]; bottom/right outer->inner [dark, mid, soft, pale, paler]
 *  - rows: 0-4 top rings, 5-11 body, 12 tealSoft, 13 teal, 14 tealSoft (the name-tab divider), 15-54 body, 55-59 bottom rings
 */
export const BALLOON_FRAME = Object.freeze({
    h: 62, bodyH: 60, minW: 95, maxW: 139, capL: 16, capR: 12, shadow: 2, chamfer: 2,
    ringsTL: Object.freeze([C.edge, C.mid, C.soft, C.pale, C.paler]),
    ringsBR: Object.freeze([C.dark, C.mid, C.soft, C.pale, C.paler]),
    fill: C.fill, divider: Object.freeze({ y: 12, colours: [C.tealSoft, C.teal, C.tealSoft] }),
    // marching dashes of the third ring (teal over soft): [firstRow, rowCount]
    dashesLeft: Object.freeze([[3, 2], [7, 3], [11, 1]]),                 // left piece, column 2
    dashesRight: Object.freeze([[15, 1], [18, 3], [23, 2], [26, 31]]),    // right piece, column 7 (body column W-5)
    shadowHi: C.shadowHi, shadowLo: C.shadowLo,
});

/**
 * Per balloon mode (0 above-left, 1 below-left, 2 above-right, 3 below-right), offsets from the anchor (obj+0x60/0x62),
 * read from resident.bin D0x8004DCF8 (outline), D0x8004DD00 (fill), D0x8004DD10 (marker) and the text layout table
 * D0x8004DCF4 rest fields. `width` = +0x64. Modes 0/1 (body left of the anchor) shift the left piece, fill and texts by -width.
 */
export const BALLOON_MODES = Object.freeze([
    { mode: 0, above: true,  left: true,  tail: { clip: 3, dx: 0,   dy: -16 }, capL: { dx: 0,   dy: -74 }, fill: { dx: 16,  dy: -74 }, capRx: 16,  nameText: { dx: 6,   dy: -71 }, bodyText: { dx: 6,   dy: -58 }, marker: { dx: 16, dy: -38 } },
    { mode: 1, above: false, left: true,  tail: { clip: 5, dx: 0,   dy: 0 },   capL: { dx: 0,   dy: 12 },  fill: { dx: 16,  dy: 12 },  capRx: 16,  nameText: { dx: 6,   dy: 15 },  bodyText: { dx: 6,   dy: 28 },  marker: { dx: 16, dy: 48 } },
    { mode: 2, above: true,  left: false, tail: { clip: 4, dx: -16, dy: -16 }, capL: { dx: -26, dy: -74 }, fill: { dx: -10, dy: -74 }, capRx: null, nameText: { dx: -20, dy: -71 }, bodyText: { dx: -20, dy: -58 }, marker: { dx: null, dy: -38 } },
    { mode: 3, above: false, left: false, tail: { clip: 6, dx: -20, dy: 0 },   capL: { dx: -26, dy: 12 },  fill: { dx: -10, dy: 12 },  capRx: null, nameText: { dx: -20, dy: 15 }, bodyText: { dx: -20, dy: 28 }, marker: { dx: null, dy: 48 } },
]);

/**
 * Everything the table says for one balloon: anchor (ax, ay) and width, in native pixels. Used by the tests as the oracle for
 * the intents-based layout, and equal to what the original's build computes.
 */
export function balloonRects(mode, ax, ay, width) {
    const m = BALLOON_MODES[mode & 3];
    const sub = m.left ? width : 0;
    const capLx = ax + m.capL.dx - sub;
    const capRx = (m.capRx ?? width - 14) + ax;           // modes 2/3: obj+0x64 - 0xE
    const y = ay + m.capL.dy;
    const outer = { x: capLx, y, w: capRx + BALLOON_FRAME.capR - capLx, h: BALLOON_FRAME.h };
    return {
        outer, capL: { x: capLx, y }, capR: { x: capRx, y },
        fill: { x: ax + m.fill.dx - sub, y: ay + m.fill.dy, w: width, h: BALLOON_FRAME.h },
        tail: { clip: m.tail.clip, x: ax + m.tail.dx, y: ay + m.tail.dy },
        nameText: { x: ax + m.nameText.dx - sub, y: ay + m.nameText.dy },
        bodyText: { x: ax + m.bodyText.dx - sub, y: ay + m.bodyText.dy },
        marker: { x: ax + (m.marker.dx ?? width - 14), y: ay + m.marker.dy, w: 8, h: 20 },
    };
}

// ------------------------------------------------------------------------------------------------ tail, marker, band
/** Tail sprites (cmfont clips 3 4 5 6): per row [firstColumn, lastColumn] of the opaque texels; 16 rows (clips 5/6: 14). Fill (160,208,208) inside a 1px (88,112,120) outline. */
export const TAIL_ROWS = Object.freeze({
    3: Object.freeze([[5, 14], [5, 14], [4, 13], [4, 15], [3, 15], [3, 14], [2, 13], [2, 12], [1, 11], [1, 10], [0, 9], [0, 8], [0, 7], [1, 6], [2, 5], [3, 4]]),
    4: Object.freeze([[0, 9], [0, 9], [1, 10], [2, 11], [3, 12], [4, 12], [5, 13], [6, 13], [7, 14], [8, 14], [9, 15], [10, 15], [11, 16], [12, 16], [13, 16], [14, 15]]),
    5: Object.freeze([[1, 2], [0, 3], [0, 4], [0, 5], [1, 6], [1, 7], [2, 8], [2, 9], [3, 10], [3, 11], [4, 12], [4, 13], [5, 14], [5, 14]]),
    6: Object.freeze([[12, 13], [11, 14], [10, 15], [9, 16], [8, 16], [7, 16], [6, 15], [5, 15], [4, 14], [3, 14], [2, 13], [1, 13], [0, 12], [0, 9]]),
});
export const TAIL_COLOURS = Object.freeze({ fill: C.tailFill, outline: C.dark });

/** Tail clip as polygon points (native px, relative to the sprite top-left) of the opaque silhouette: down the left edge, up the right. */
export function tailPolygon(clip) {
    const rows = TAIL_ROWS[clip];
    if (!rows) return null;
    const pts = [];
    rows.forEach(([a], y) => { pts.push([a, y], [a, y + 1]); });
    for (let y = rows.length - 1; y >= 0; y--) pts.push([rows[y][1] + 1, y + 1], [rows[y][1] + 1, y]);
    return pts;
}

/** The tail's fill: the silhouette without its 1px outline (rows 1..n-2, one column in from the left edge, to the last opaque column). */
export function tailInnerPolygon(clip) {
    const rows = TAIL_ROWS[clip];
    if (!rows) return [];
    const kept = [];
    for (let y = 1; y < rows.length - 1; y++) { const a = rows[y][0] + 1, b = rows[y][1]; if (a < b) kept.push([y, a, b]); }
    if (!kept.length) return [];
    const pts = [];
    kept.forEach(([y, a]) => pts.push([a, y], [a, y + 1]));
    for (let i = kept.length - 1; i >= 0; i--) pts.push([kept[i][2], kept[i][0] + 1], [kept[i][2], kept[i][0]]);
    return pts;
}

/** The "more" arrow: cmfont clip 7, 8 x 20 (the game draws this one clip for every frame; no palette variants exist). Parts, native px in the sprite: three 3x2 dashes, a 3x6 shaft, a pointed head. */
export const MARKER = Object.freeze({
    w: 8, h: 20,
    dashes: Object.freeze([[0, 0], [0, 3], [0, 6]]), dashW: 3, dashH: 2,
    dashColours: Object.freeze(["rgb(216,120,48)", "rgb(240,112,0)", "rgb(152,160,48)"]),
    shaft: Object.freeze({ x: 0, y: 9, w: 3, h: 6, colours: ["rgb(240,112,0)", "rgb(216,120,48)", "rgb(152,160,48)"] }),
    headRows: Object.freeze([[15, 5], [16, 5], [17, 4], [18, 3], [19, 2]]),   // [y, width] from column 0
    headColour: "rgb(240,112,0)",
});

/**
 * The plain window's dimming band (cmfont clips 8 and 9 at (0,166), each 320x60): the union is a column-uniform strip.
 * Rows (relative to y 166): navy (0,0,8) rows 0, 2-3, 7-52, 56-57, 59; the (0,32,80) line on rows 6 and 53; rows 1, 4-5, 54-55, 58 clear.
 * (The 19 leftmost and 5 rightmost columns slope by up to 3 rows; not drawn.)
 */
export const PLAIN_BAND = Object.freeze({
    x: 0, y: 166, w: 320, h: 60, navy: "rgb(0,0,8)", line: "rgb(0,32,80)",
    rows: Object.freeze([[0, 1, "navy"], [2, 2, "navy"], [6, 1, "line"], [7, 46, "navy"], [53, 1, "line"], [56, 2, "navy"], [59, 1, "navy"]]),
    textOrigin: Object.freeze({ x: 18, y: 176 }),   // F0x8001BE00: widget at (0x12, 0xB0)
    wipeSeconds: 0.17,
});

/** The text faces (uifont): cell height, capital height, baseline row and the clut entry that is the face / shadow. */
export const TEXT_FACES = Object.freeze({
    1: Object.freeze({ cellH: 12, capH: 10, baseline: 11, faceIndex: 2, shadowIndex: 1, fontPx: 14 }),
    2: Object.freeze({ cellH: 9, capH: 9, baseline: 9, gradient: true, shadowIndex: 14, fontPx: 12.5 }),
    3: Object.freeze({ cellH: 8, capH: 8, baseline: 8, faceIndex: 4, shadowIndex: 1, fontPx: 11 }),
});
export const SMOOTH_FONT_STACK = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

// ------------------------------------------------------------------------------------------------ pause list (measured only)
/** The pause list's frames (engine/dw3/ui/native/pause-list.ts drawWindows, web/panel-kit.js): all cmfont sprites, drawn in the canvas with the text on top. */
export const PAUSE_LIST = Object.freeze({
    panel: Object.freeze({ x: 0xa8, y: 0x28, w: 160, tile: 40, topH: 22, bandH: 14, bottomH: 20, clips: { 5: 0x1c, 6: 0x1b, 7: 0x19 }, heights: { 5: 84, 6: 98, 7: 112 } }),
    helpBand: Object.freeze({ x: 0, y: 0x9e, w: 108, h: 21, clip: 0x1a }),
    cards: Object.freeze({ x: 0, y: 0x11, step: 0x2e, w: 116, h: 42, clips: [0x15, 0x17] }),
    prompt: Object.freeze({ x: 0x22, y: 0xd, clip: 0x18 }),
});
export const panelHeightFor = (rows) => PAUSE_LIST.panel.topH + (rows - 2) * PAUSE_LIST.panel.bandH + PAUSE_LIST.panel.bottomH;

// ------------------------------------------------------------------------------------------------ parts (vector shapes)
const px = (n) => `${+n.toFixed(3)}px`;

/** Hard-stop vertical gradient from rows [[startRow, count, colour|null], ...] over `h` rows (null = transparent). */
export function rowsGradient(rows) {
    const stops = [];
    for (const [start, count, colour] of rows) stops.push(`${colour ?? "transparent"} ${px(start)} ${px(start + count)}`);
    return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/**
 * The balloon frame as absolutely positioned boxes, native px relative to the frame's outer top-left.
 * `outerW` = left piece start .. right piece end (= width + 28 for modes 0/1). Each part: { name, x, y, w, h, css }.
 */
export function balloonParts(outerW) {
    const F = BALLOON_FRAME, W = outerW, bw = W - F.shadow, bh = F.bodyH;
    const parts = [];
    const add = (name, x, y, w, h, css = "") => parts.push({ name, x, y, w, h, css });
    // drop line: white then grey, along the right and the bottom
    add("shadow-hi-right", W - 2, 4, 1, 56, `background:${F.shadowHi}`);
    add("shadow-lo-right", W - 1, 3, 1, 57, `background:${F.shadowLo}`);
    add("shadow-hi-bottom", 4, 60, W - 6, 1, `background:${F.shadowHi}`);
    add("shadow-lo-bottom", 4, 61, W - 6, 1, `background:${F.shadowLo}`);
    add("shadow-lo-corner-l", 3, 60, 1, 1, `background:${F.shadowLo}`);
    add("shadow-lo-corner-r", W - 2, 60, 1, 1, `background:${F.shadowLo}`);
    // body: vertical fill + divider, five rings as inset shadows, chamfered corners
    const c = F.chamfer;
    const rings = [];
    for (let i = 0; i < 5; i++) rings.push(`inset ${i + 1}px ${i + 1}px 0 0 ${F.ringsTL[i]}`, `inset ${-(i + 1)}px ${-(i + 1)}px 0 0 ${F.ringsBR[i]}`);
    const d = F.divider;
    const bg = rowsGradient([[0, d.y, F.fill], [d.y, 1, d.colours[0]], [d.y + 1, 1, d.colours[1]], [d.y + 2, 1, d.colours[2]], [d.y + 3, bh - d.y - 3, F.fill]]);
    const clip = `polygon(${c}px 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, ${c}px 100%, 0 calc(100% - ${c}px), 0 ${c}px)`;
    add("body", 0, 0, bw, bh, `background:${bg};box-shadow:${rings.join(",")};clip-path:${clip}`);
    // third-ring teal dashes
    F.dashesLeft.forEach(([y, n], i) => add(`dash-left-${i}`, 2, y, 1, n, `background:${C.teal}`));
    F.dashesRight.forEach(([y, n], i) => add(`dash-right-${i}`, W - 5, y, 1, n, `background:${C.teal}`));
    return parts;
}

// ------------------------------------------------------------------------------------------------ from the game's draw calls
export const CLIP = Object.freeze({ capL: 0, fill: 1, capR: 2, tails: [3, 4, 5, 6], marker: 7, bandTop: 8, bandBottom: 9 });

/** The sprite draws of one frame, with the scale/pivot state the renderer applies (web/native-screen-render.js). */
export function spritesFromCalls(calls, contextMarkers = []) {
    const resets = new Set(contextMarkers);
    const st = { sx: 0x1000, sy: 0x1000, px: 0, py: 0 };
    const out = [];
    calls.forEach((c, i) => {
        if (resets.has(i)) { st.sx = 0x1000; st.sy = 0x1000; st.px = 0; st.py = 0; }
        if (c.method === "setScale") { st.sx = c.args[0]; st.sy = c.args[1]; }
        else if (c.method === "setPos") { st.px = c.args[0]; st.py = c.args[1]; }
        else if (c.method === "drawSprite") out.push({ id: c.args[1], x: c.args[2], y: c.args[3], sx: st.sx / 0x1000, sy: st.sy / 0x1000, px: st.px, py: st.py });
    });
    return out;
}

/**
 * What the CSS layer shows for one dialogue frame, taken from the session's own draw calls and raw fill intent.
 * Returns { balloon, band } (either may be null). balloon: { outer, capL, capR, fill, tail, marker }.
 */
export function layoutFromIntents(calls, raw = [], contextMarkers = []) {
    const sprites = spritesFromCalls(calls, contextMarkers);
    const fillRaw = raw.find((r) => r.kind === "frameFill");
    let balloon = null;
    if (fillRaw) {
        const k = fillRaw.intent.corners;
        const fill = { x: Math.min(k[0], k[2], k[4], k[6]), y: Math.min(k[1], k[3], k[5], k[7]) };
        fill.w = Math.max(k[0], k[2], k[4], k[6]) - fill.x;
        fill.h = Math.max(k[1], k[3], k[5], k[7]) - fill.y;
        const capL = sprites.find((s) => s.id === CLIP.capL), capR = sprites.find((s) => s.id === CLIP.capR);
        const tail = sprites.find((s) => CLIP.tails.includes(s.id));
        const marker = sprites.find((s) => s.id === CLIP.marker);
        if (capL && capR) {
            balloon = {
                fill, capL: { x: capL.x, y: capL.y }, capR: { x: capR.x, y: capR.y },
                outer: { x: capL.x, y: capL.y, w: capR.x + BALLOON_FRAME.capR - capL.x, h: BALLOON_FRAME.h },
                tail: tail ? { clip: tail.id, x: tail.x, y: tail.y } : null,
                marker: marker ? { x: marker.x, y: marker.y, w: MARKER.w, h: MARKER.h } : null,
            };
        }
    }
    let band = null;
    const bands = sprites.filter((s) => s.id === CLIP.bandTop || s.id === CLIP.bandBottom);
    if (bands.length && !balloon) {
        const b = bands[0], sx = b.sx;
        band = { x: b.px + (b.x - b.px) * sx, y: PLAIN_BAND.y, w: PLAIN_BAND.w * sx, h: PLAIN_BAND.h };
    }
    return { balloon, band };
}

/** The OPTIONS row's value is "smooth" only when chosen; anything else (missing, old save, junk) is the untouched pixel look. */
export const UI_LOOKS = Object.freeze(["pixel", "smooth"]);
export const isSmoothLook = (value) => value === "smooth";
