// web/ui-css.js -- the "UI look: Smooth" overlay (idea I11, first slice): the field conversation box drawn as DOM + CSS vectors
// over the game canvas, in the same 320x240 space, scaled with the canvas (one CSS transform), instead of upscaled pixel pictures.
//
// It draws only what the game already decided. web/dialogue-translated.js hands it the session's own draw calls / fill intent
// (positions) and widget text runs (letters, pens); timing, input and sounds stay in the game. The OPTIONS row "UI look" (fx.uiLook)
// switches it; "pixel" (default) never reaches this file. Shapes and numbers: web/ui-css-model.js.
//
// Slice 2 adds the choice list (web/choice.js), the Yes/No window (web/yesno-translated.js) and the pause home list: panel, money
// band, row labels, animated cursor (web/status-translated.js). For those the OWNER skips its canvas pictures AND its text and
// cursor (the overlay draws every one at the same pen), and calls uiCssHide(key) the moment it draws pixels again, so a page
// change never leaves a ghost panel.
//
// Live check by numbers (no picture): window.__uiCss.check() compares every part's getBoundingClientRect() with the rect the
// model expects for the current canvas size.
import {
    UI_W, UI_H, uiPlacement, uiRectToScreen, balloonParts, BALLOON_FRAME, TAIL_COLOURS, tailPolygon, MARKER, PLAIN_BAND,
    rowsGradient, tailInnerPolygon, TEXT_FACES, SMOOTH_FONT_STACK, isSmoothLook, SYMBOL_GLYPHS, glyphBoxes, scaledRect, CHOICE_LOOK,
} from "./ui-css-model.js";
import { drawText, fontClutRow, fontReady } from "./uifont.js";

const EXPIRE_MS = 60, EXPIRE_FRAMES = 3;   // a layer its owner has not refreshed for this long AND this many display frames is removed (the box closed)
let frameNo = 0;

let VIEW = { w: 640, h: 480 };   // the game canvas's logical size, set by each caller (game.js VIEW_W x VIEW_H)
let root = null, stage = null, canvasEl = null, rafId = 0;
const layers = new Map();        // key -> { el, sig, seen, view }

const hasDom = () => typeof document !== "undefined";
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** True when the OPTIONS row says Smooth. */
export function uiLookSmooth() {
    return typeof window !== "undefined" && isSmoothLook(window.__fx?.uiLook);
}

/** True when the overlay can draw right now (a page, the stage, the canvas, the game font for the text). */
export function uiCssAvailable() {
    if (!hasDom()) return false;
    stage = stage || document.getElementById("stage");
    canvasEl = canvasEl || document.getElementById("game");
    return !!(stage && canvasEl && fontReady());
}

function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    root.id = "ui-css-root";
    root.style.cssText = `position:absolute;left:0;top:0;width:${UI_W}px;height:${UI_H}px;transform-origin:0 0;pointer-events:none;` +
        `z-index:6;overflow:hidden;font-family:${SMOOTH_FONT_STACK};-webkit-font-smoothing:antialiased;`;
    stage.appendChild(root);
    return root;
}

function place() {
    const cr = canvasEl.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const p = uiPlacement(cr, VIEW);
    root.style.left = `${p.left - sr.left}px`;
    root.style.top = `${p.top - sr.top}px`;
    root.style.transform = `scale(${p.kx},${p.ky})`;
    return { cr, p };
}

function box(parent, name, x, y, w, h, css = "", abs = null) {
    const d = document.createElement("div");
    d.dataset.uiPart = name;
    d.dataset.uiRect = `${abs ? abs[0] : x},${abs ? abs[1] : y},${w},${h}`;
    d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${css}`;
    parent.appendChild(d);
    return d;
}

function buildBalloon(layer, b) {
    const o = b.outer;
    const frame = box(layer, "balloon", o.x, o.y, o.w, o.h);
    for (const p of balloonParts(o.w)) {
        const d = document.createElement("div");
        d.dataset.uiPart = `balloon:${p.name}`;
        d.dataset.uiRect = `${o.x + p.x},${o.y + p.y},${p.w},${p.h}`;
        d.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;${p.css}`;
        frame.appendChild(d);
    }
    if (b.tail) {
        const outer = tailPolygon(b.tail.clip), inner = tailInnerPolygon(b.tail.clip);
        if (outer) {
            const poly = (list) => `polygon(${list.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
            const t = box(layer, "tail", b.tail.x, b.tail.y, 20, 16, `background:${TAIL_COLOURS.outline};clip-path:${poly(outer)}`);
            if (inner.length) {
                const f = document.createElement("div");
                f.style.cssText = `position:absolute;inset:0;background:${TAIL_COLOURS.fill};clip-path:${poly(inner)}`;
                t.appendChild(f);
            }
        }
    }
    if (b.marker) buildMarker(layer, b.marker);
}

function buildMarker(layer, m) {
    const wrap = box(layer, "marker", m.x, m.y, MARKER.w, MARKER.h);
    const cols = (list) => `linear-gradient(to right,${list.map((c, i) => `${c} ${i}px ${i + 1}px`).join(",")})`;
    for (const [dx, dy] of MARKER.dashes) box(wrap, "marker:dash", dx, dy, MARKER.dashW, MARKER.dashH, `background:${cols(MARKER.dashColours)}`, [m.x + dx, m.y + dy]);
    const s = MARKER.shaft;
    box(wrap, "marker:shaft", s.x, s.y, s.w, s.h, `background:${cols(s.colours)}`, [m.x + s.x, m.y + s.y]);
    const y0 = MARKER.headRows[0][0], n = MARKER.headRows.length;
    const pts = [[0, 0]];
    MARKER.headRows.forEach(([, w], i) => pts.push([w, i], [w, i + 1]));
    pts.push([0, n]);
    box(wrap, "marker:head", 0, y0, 5, n, `background:${MARKER.headColour};clip-path:polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(",")})`, [m.x, m.y + y0]);
}

function buildBand(layer, band) {
    const rows = PLAIN_BAND.rows.map(([a, n, which]) => [a, n, which === "line" ? PLAIN_BAND.line : PLAIN_BAND.navy]);
    box(layer, "band", band.x, band.y, band.w, band.h, `background:${rowsGradient(rows)}`);
}

function faceColours(kind, clut) {
    const row = fontClutRow(kind, clut) ?? fontClutRow(kind, 0);
    const face = TEXT_FACES[kind] ?? TEXT_FACES[1];
    if (!row) return { fill: "#fff", shadow: "rgba(0,0,0,.6)", gradient: null };
    const shadow = rgb(row[face.shadowIndex] ?? row[1]);
    if (face.gradient) {
        // kind 2 rows 0..8 use clut entries 8,1,2,...,7,8 (glyph pixel index = cell row, measured on 'A')
        const order = [8, 1, 2, 3, 4, 5, 6, 7, 8];
        const stops = order.map((idx, i) => `${rgb(row[idx])} ${i}px ${i + 1}px`).join(",");
        return { fill: null, shadow, gradient: `linear-gradient(to bottom,${stops})` };
    }
    return { fill: rgb(row[face.faceIndex]), shadow, gradient: null };
}

/** A bracket glyph token ("[enter]" = the list cursor, "[triangle]"...): the cursor frames as sharp boxes in the font's own colours,
 *  any other token from the loaded font sheet through a small canvas (nothing about it is stored in the code). */
function buildSymbol(line, g, run, col) {
    const rel = g.x - run.x;
    const shape = SYMBOL_GLYPHS[g.ch];
    if (shape) {
        const wrap = document.createElement("div");
        wrap.dataset.uiPart = "symbol";
        wrap.dataset.uiText = g.ch;
        wrap.style.cssText = `position:absolute;left:${rel + g.dx}px;top:0;width:${shape.w}px;height:${shape.h}px;`;
        for (const b of glyphBoxes(shape)) {
            const d = document.createElement("div");
            d.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${b.index === 1 ? col.shadow : (col.fill ?? "#fff")}`;
            wrap.appendChild(d);
        }
        line.appendChild(wrap);
        return;
    }
    const c = document.createElement("canvas");
    c.width = 16; c.height = 14;
    c.dataset.uiPart = "symbol";
    c.dataset.uiText = g.ch;
    c.style.cssText = `position:absolute;left:${rel}px;top:0;width:16px;height:14px;image-rendering:pixelated;`;
    drawText(c.getContext("2d"), g.ch, 0, 0, { kind: run.kind, clut: run.clut });
    line.appendChild(c);
}

function buildText(layer, runs) {
    for (const run of runs) {
        const face = TEXT_FACES[run.kind] ?? TEXT_FACES[1];
        const col = faceColours(run.kind, run.clut);
        const line = document.createElement("div");
        line.dataset.uiPart = "text";
        line.dataset.uiText = run.text;
        line.dataset.uiRect = `${run.x},${run.y},0,${face.cellH}`;
        line.style.cssText = `position:absolute;left:${run.x}px;top:${run.y}px;width:0;height:${face.cellH}px;`;
        for (const g of run.glyphs) {
            if (g.ch === " ") continue;
            if (g.ch.length > 1) { buildSymbol(line, g, run, col); continue; }
            const s = document.createElement("span");
            s.textContent = g.ch;
            const paint = col.gradient
                ? `background:${col.gradient};-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(1px 1px 0 ${col.shadow});`
                : `color:${col.fill};text-shadow:1px 1px 0 ${col.shadow};`;
            s.style.cssText = `position:absolute;left:${g.x + g.dx - run.x}px;top:0;font-size:${face.fontPx}px;line-height:${face.cellH}px;height:${face.cellH}px;white-space:pre;${paint}`;
            line.appendChild(s);
        }
        layer.appendChild(line);
    }
}

/** One composed tile picture (the pause panel, the money band, the Yes/No window): a wrapper at the sprite's place that takes the
 *  sprite's own scale about its own pivot (the Yes/No window folds open that way), with one sharp box per composed rect. */
function buildTiled(layer, t) {
    const r = t.rect, s = { sx: r.sx, sy: r.sy, px: r.px, py: r.py };
    const w = scaledRect(r);
    const wrap = box(layer, t.name, r.x, r.y, r.w, r.h, "", [w.x, w.y, w.w, w.h]);
    if (r.sx !== 1 || r.sy !== 1) wrap.style.cssText += `transform-origin:${r.px - r.x}px ${r.py - r.y}px;transform:scale(${r.sx},${r.sy});`;
    for (const c of t.rects) {
        const a = scaledRect({ x: r.x + c.x, y: r.y + c.y, w: c.w, h: c.h, ...s });
        const d = box(wrap, `${t.name}:box`, c.x, c.y, c.w, c.h, `background:${c.colour}`, [a.x, a.y, a.w, a.h]);
        d.dataset.uiChild = "1";
    }
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** The choice list (web/choice.js): the window, and its prompt / options / cursor as SVG text set on the game's own baselines. */
function buildChoice(layer, c) {
    const L = CHOICE_LOOK, w = c.window;
    box(layer, "choice-window", w.x, w.y, w.w, w.h, `background:${L.fill};box-shadow:inset 0 0 0 ${+c.edge.toFixed(4)}px ${L.edge};`);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", UI_W);
    svg.setAttribute("height", UI_H);
    svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;";
    const put = (name, t) => {
        const e = document.createElementNS(SVG_NS, "text");
        e.setAttribute("x", t.x);
        e.setAttribute("y", t.y);
        e.setAttribute("font-size", c.fontPx);
        e.setAttribute("font-family", L.font);
        e.setAttribute("fill", t.fill);
        e.setAttribute("xml:space", "preserve");
        e.textContent = t.text;
        svg.appendChild(e);
        box(layer, `choice-${name}`, t.x, t.y, 0, 0).dataset.uiText = t.text;   // the text's own pen (x, baseline), checked like any part
    };
    put("prompt", c.prompt);
    c.options.forEach((o, i) => put(`option${i}`, o));
    if (c.cursor) put("cursor", c.cursor);
    layer.appendChild(svg);
}

const hasChrome = (layout) => !!(layout.balloon || layout.band || layout.tiled?.length || layout.choice);
function rebuildChrome(layer, layout) {
    layer.replaceChildren();
    if (layout.band) buildBand(layer, layout.band);
    if (layout.balloon) buildBalloon(layer, layout.balloon);
    for (const t of layout.tiled ?? []) buildTiled(layer, t);
    if (layout.choice) buildChoice(layer, layout.choice);
}
// the signature of a layout without the (large, derived) composed rect lists
const layoutSig = (layout) => JSON.stringify({ ...layout, tiled: layout.tiled?.map((t) => [t.name, t.rect]) });

function tick() {
    rafId = 0;
    frameNo++;
    const now = performance.now();
    for (const [key, l] of layers) {
        if (now - l.seen > EXPIRE_MS && frameNo - l.seenFrame >= EXPIRE_FRAMES) { l.el.remove(); layers.delete(key); }
    }
    if (layers.size && root) { place(); rafId = requestAnimationFrame(tick); }
}

/**
 * Show one dialogue frame. `key` names the box (each createDialogueTranslated has its own), `layout` = layoutFromIntents(...),
 * `runs` = collectNativeTextRuns(...). Returns true when the overlay drew it (the caller then skips its canvas pixels).
 */
export function uiCssShowDialogue(key, layout, runs, view = null) {
    return uiCssShow(key, layout, runs, view);
}

/**
 * Show one frame of any overlay box. `layout` = { balloon?, band?, tiled?, choice? } (web/ui-css-model.js), `runs` = the text
 * runs of the widgets the overlay draws, `opts.dim` = 0..1 darkening of the whole layer (the pause fade). The chrome and the
 * text are rebuilt separately, only when their own signature changes (the list cursor swaps its glyph every few frames).
 * Returns true when the overlay drew it: the caller must then skip the canvas pixels of everything in `layout` AND the `runs`.
 */
export function uiCssShow(key, layout, runs, view = null, opts = {}) {
    if (!uiCssAvailable() || !hasChrome(layout)) return false;
    if (view && view.w > 0 && view.h > 0) VIEW = { w: view.w, h: view.h };
    ensureRoot();
    let l = layers.get(key);
    if (!l) {
        const el = document.createElement("div");
        el.dataset.uiLayer = key;
        el.style.cssText = `position:absolute;left:0;top:0;width:${UI_W}px;height:${UI_H}px;`;
        const chrome = document.createElement("div"), text = document.createElement("div");
        chrome.dataset.uiPart = "chrome"; text.dataset.uiPart = "texts";
        el.append(chrome, text);
        root.appendChild(el);
        l = { el, chrome, text, sig: "", textSig: "", seen: 0, seenFrame: 0, dim: -1 };
        layers.set(key, l);
    }
    l.seen = performance.now();
    l.seenFrame = frameNo;
    const sig = layoutSig(layout);
    if (sig !== l.sig) { l.sig = sig; rebuildChrome(l.chrome, layout); }
    const textSig = JSON.stringify(runs.map((r) => [r.text, r.kind, r.clut, r.x, r.y]));
    if (textSig !== l.textSig) { l.textSig = textSig; l.text.replaceChildren(); buildText(l.text, runs); }
    const dim = Math.max(0, Math.min(1, opts.dim ?? 0));
    if (dim !== l.dim) { l.dim = dim; l.el.style.filter = dim > 0 ? `brightness(${+(1 - dim).toFixed(4)})` : ""; }
    place();
    if (!rafId) rafId = requestAnimationFrame(tick);
    return true;
}

/** Remove a box now (its owner is drawing canvas pixels again, e.g. the pause moved to another page). */
export function uiCssHide(key) {
    const l = layers.get(key);
    if (!l) return;
    l.el.remove();
    layers.delete(key);
}

/** Each part's rect now vs what the model says it must be (page px). Max error is in `worst`. */
export function uiCssCheck() {
    if (!root || !canvasEl) return { parts: [], worst: 0, note: "overlay not showing" };
    const cr = canvasEl.getBoundingClientRect();
    const parts = [];
    let worst = 0, count = 0;
    for (const el of root.querySelectorAll("[data-ui-rect]")) {
        const [x, y, w, h] = el.dataset.uiRect.split(",").map(Number);
        const want = uiRectToScreen({ x, y, w, h }, cr, VIEW);
        const got = el.getBoundingClientRect();
        const err = Math.max(Math.abs(got.left - want.left), Math.abs(got.top - want.top), Math.abs(got.width - want.width), Math.abs(got.height - want.height));
        worst = Math.max(worst, err);
        count++;
        // composed tile boxes (data-ui-child) are counted and in `worst`, but listed only when they are off
        if (!el.dataset.uiChild || err > 0.01) parts.push({ layer: el.closest("[data-ui-layer]")?.dataset.uiLayer, part: el.dataset.uiPart, text: el.dataset.uiText, want, got: { left: got.left, top: got.top, width: got.width, height: got.height }, err });
    }
    return { canvas: { left: cr.left, top: cr.top, width: cr.width, height: cr.height }, count, parts, worst };
}

if (typeof window !== "undefined") {
    window.__uiCss = {
        look: () => (uiLookSmooth() ? "smooth" : "pixel"),
        check: uiCssCheck,
        layers: () => [...layers.keys()],
        texts: () => [...root?.querySelectorAll("[data-ui-text]") ?? []].map((e) => `${e.closest("[data-ui-layer]")?.dataset.uiLayer}: ${e.dataset.uiText}`),
        constants: { frameH: BALLOON_FRAME.h },
    };
}
