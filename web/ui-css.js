// web/ui-css.js -- the "UI look: Smooth" overlay (idea I11, first slice): the field conversation box drawn as DOM + CSS vectors
// over the game canvas, in the same 320x240 space, scaled with the canvas (one CSS transform), instead of upscaled pixel pictures.
//
// It draws only what the game already decided. web/dialogue-translated.js hands it the session's own draw calls / fill intent
// (positions) and widget text runs (letters, pens); timing, input and sounds stay in the game. The OPTIONS row "UI look" (fx.uiLook)
// switches it; "pixel" (default) never reaches this file. Shapes and numbers: web/ui-css-model.js.
//
// Live check by numbers (no picture): window.__uiCss.check() compares every part's getBoundingClientRect() with the rect the
// model expects for the current canvas size.
import {
    UI_W, UI_H, uiPlacement, uiRectToScreen, balloonParts, BALLOON_FRAME, TAIL_COLOURS, tailPolygon, MARKER, PLAIN_BAND,
    rowsGradient, tailInnerPolygon, TEXT_FACES, SMOOTH_FONT_STACK, isSmoothLook,
} from "./ui-css-model.js";
import { fontClutRow, fontReady } from "./uifont.js";

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

function buildText(layer, runs) {
    for (const run of runs) {
        const face = TEXT_FACES[run.kind] ?? TEXT_FACES[1];
        const col = faceColours(run.kind, run.clut);
        const line = document.createElement("div");
        line.dataset.uiPart = "text";
        line.dataset.uiText = run.text;
        line.style.cssText = `position:absolute;left:${run.x}px;top:${run.y}px;width:0;height:${face.cellH}px;`;
        for (const g of run.glyphs) {
            if (g.ch === " ") continue;
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

function rebuild(layer, layout, runs) {
    layer.replaceChildren();
    if (layout.band) buildBand(layer, layout.band);
    if (layout.balloon) buildBalloon(layer, layout.balloon);
    buildText(layer, runs);
}

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
    if (!uiCssAvailable() || (!layout.balloon && !layout.band)) return false;
    if (view && view.w > 0 && view.h > 0) VIEW = { w: view.w, h: view.h };
    ensureRoot();
    let l = layers.get(key);
    if (!l) {
        const el = document.createElement("div");
        el.dataset.uiLayer = key;
        el.style.cssText = `position:absolute;left:0;top:0;width:${UI_W}px;height:${UI_H}px;`;
        root.appendChild(el);
        l = { el, sig: "", seen: 0, seenFrame: 0 };
        layers.set(key, l);
    }
    l.seen = performance.now();
    l.seenFrame = frameNo;
    const sig = JSON.stringify([layout, runs.map((r) => [r.text, r.kind, r.clut, r.x, r.y])]);
    if (sig !== l.sig) { l.sig = sig; rebuild(l.el, layout, runs); }
    place();
    if (!rafId) rafId = requestAnimationFrame(tick);
    return true;
}

/** Each part's rect now vs what the model says it must be (page px). Max error is in `worst`. */
export function uiCssCheck() {
    if (!root || !canvasEl) return { parts: [], worst: 0, note: "overlay not showing" };
    const cr = canvasEl.getBoundingClientRect();
    const parts = [];
    let worst = 0;
    for (const el of root.querySelectorAll("[data-ui-rect]")) {
        const [x, y, w, h] = el.dataset.uiRect.split(",").map(Number);
        const want = uiRectToScreen({ x, y, w, h }, cr, VIEW);
        const got = el.getBoundingClientRect();
        const err = Math.max(Math.abs(got.left - want.left), Math.abs(got.top - want.top), Math.abs(got.width - want.width), Math.abs(got.height - want.height));
        worst = Math.max(worst, err);
        parts.push({ part: el.dataset.uiPart, want, got: { left: got.left, top: got.top, width: got.width, height: got.height }, err });
    }
    return { canvas: { left: cr.left, top: cr.top, width: cr.width, height: cr.height }, parts, worst };
}

if (typeof window !== "undefined") {
    window.__uiCss = {
        look: () => (uiLookSmooth() ? "smooth" : "pixel"),
        check: uiCssCheck,
        layers: () => [...layers.keys()],
        constants: { frameH: BALLOON_FRAME.h },
    };
}
