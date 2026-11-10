// web/ui-kit.js -- the window kit for the new book screens (GLOSSARY, OPTIONS). Everything here wraps pieces the game
// already has; no new art.
//
//   * folds: a window opens by scaling from 0 to full about a pivot over 10 steps (sound 0x40019) and shuts in 5 (sound
//     0x4001a); the windows of a screen open one after another (engine/dw3/ui/fold-tween.ts; web/menu.js _foldOpen)
//   * plates: header cmfont clip 24, footer ststat clip 32, list panel from the pause list's own tiles (web/panel-kit.js)
//   * text: web/uifont.js (kind 1 = the white face, kind 3 = the orange number face), cursor drawCursor
//
// All coordinates are the 320 x 240 box the pause menus use. The host (web/book-host.js) scales the canvas.
import { ui } from "./vendor/engine.js";
import { loadPack, drawClip, packReady } from "./screenpack.js";
import { drawText, textWidth } from "./uifont.js";
import { buildPanelClip, tileFrames } from "./panel-kit.js";
import { BAND_TEXT_W, fitByWidth, wrapByWidth } from "./text-fit.js";

export const BOX_W = 320;
export const BOX_H = 240;
/** Every pause window is installed with 10 steps: 10 to open, 5 to shut (fold-tween.ts FOLD_CLOSE_RATE). */
export const OPEN_STEPS = 10;
/** Packed sound words: SYSTEM03 on a window opening, SYSTEM04 on one shutting (fold-tween.ts FOLD_OPEN_SFX / FOLD_CLOSE_SFX). */
export const SFX_OPEN = 0x40019;
export const SFX_CLOSE = 0x4001a;

const cmfont = loadPack("cmfont");
const ststat = loadPack("ststat");

// ---------------------------------------------------------------- folds

/** One window's fold. state(): "shut" | "opening" | "open" | "closing". progress(): 0..1, the scale. tick(): one displayed frame. */
export function createFold(steps = OPEN_STEPS) {
    const t = ui.createFoldTween();
    let state = "shut";
    return {
        open() { ui.startFold(t, 0, ui.FOLD_MAX, steps); state = "opening"; },
        close() {
            if (state === "open") ui.startFoldClose(t, steps);
            else if (state === "opening") { ui.startFold(t, t.value, 0, steps); t.delta *= ui.FOLD_CLOSE_RATE; }
            else return;
            state = "closing";
        },
        tick() {
            if (state !== "opening" && state !== "closing") return true;
            const landed = ui.tickFold(t);
            if (landed) state = state === "opening" ? "open" : "shut";
            return landed;
        },
        state: () => state,
        progress: () => (state === "open" ? 1 : state === "shut" ? 0 : ui.foldProgress(t)),
    };
}

/**
 * The windows of one screen, opened one after another in `names` order (each starts when the one before has landed) and
 * shut in the reverse order. `onStart(name, opening)` is where the open / close sound is played.
 */
export function createFoldChain(names, { steps = OPEN_STEPS, onStart = () => {} } = {}) {
    const folds = Object.fromEntries(names.map((n) => [n, createFold(steps)]));
    let phase = "shut";
    let at = 0;
    const start = (i, opening) => { folds[names[i]][opening ? "open" : "close"](); onStart(names[i], opening); };
    return {
        folds,
        phase: () => phase,
        open() {
            if (phase === "open" || phase === "opening") return;
            phase = "opening"; at = 0; start(0, true);
        },
        close() {
            if (phase === "shut" || phase === "closing") return;
            const last = names.map((n) => folds[n].state()).map((s) => s !== "shut").lastIndexOf(true);
            if (last < 0) { phase = "shut"; return; }
            phase = "closing"; at = last; start(at, false);
        },
        tick() {
            for (const n of names) folds[n].tick();
            const cur = folds[names[at]];
            if (phase === "opening" && cur.state() === "open") {
                if (at + 1 < names.length) { at++; start(at, true); } else phase = "open";
            } else if (phase === "closing" && cur.state() === "shut") {
                if (at > 0) { at--; start(at, false); } else phase = "shut";
            }
            return phase;
        },
    };
}

/** Run `draw` with the window folded to `progress` (0..1) about (px, py). axis "x" squeezes sideways, "y" up and down. Draws nothing at 0. */
export function withFold(ctx, progress, px, py, axis, draw) {
    if (!(progress > 0)) return false;
    if (progress >= 1) { draw(); return true; }
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(axis === "y" ? 1 : progress, axis === "x" ? 1 : progress);
    ctx.translate(-px, -py);
    draw();
    ctx.restore();
    return true;
}

// ---------------------------------------------------------------- plates

/** Header plate: cmfont clip 24 at (34, 13), folds about (320, 25); the game's header text sits at (152, 19) (status_ui.json screens.shared). */
export const HEADER = Object.freeze({ clip: 24, x: 34, y: 13, pivot: [320, 25], textX: 152, textY: 19 });
/** Footer plate: ststat clip 32 at (0, 194), folds about (0, 211); text lines at (20, 198) and (20, 212). */
export const FOOTER = Object.freeze({ clip: 32, x: 0, y: 194, pivot: [0, 211], textX: 20, textY: 198, lineH: 14 });
/** The list panel's tile size (web/panel-kit.js). */
export const TILE_W = 40;

/** Height in pixels of a panel with `bands` middle bands: 22 on top, 14 a band, 20 at the bottom. */
export const panelPixelHeight = (bands) => 22 + 14 * bands + 20;

/** Register (once) and return the id of a `cols` x `bands` panel clip in the cmfont pack, or null while the sheet is not loaded. */
export function panelClipId(pack, cols, bands) {
    const id = `kit-${cols}x${bands}`;
    if (!pack.ids?.[id]) {
        const frames = tileFrames(pack.ids);
        if (!frames) return null;
        pack.ids[id] = buildPanelClip(frames, cols, bands);
    }
    return id;
}

/** Draw a panel of `cols` 40 px columns and `bands` middle bands with its top-left at (x, y). False until the sheet has loaded. */
export function drawPanel(ctx, x, y, cols, bands, pack = cmfont) {
    if (!packReady(pack)) return false;
    const id = panelClipId(pack, cols, bands);
    return id ? drawClip(ctx, pack, id, x, y) : false;
}

/** x of each tab label: starts at `startX`, `gap` pixels between labels. `widthOf(label)` is textWidth in the real build. */
export function layoutTabs(labels, widthOf, startX, gap) {
    const out = [];
    let x = startX;
    for (const label of labels) { out.push(x); x += widthOf(label) + gap; }
    return out;
}

/** Header plate with a title on the left and, optionally, section tabs (the active one in the white face, the rest dim, clut row 7). */
export function drawHeader(ctx, progress, title, tabs = [], active = 0, { tabStart = null, gap = 12 } = {}) {
    withFold(ctx, progress, HEADER.pivot[0], HEADER.pivot[1], "x", () => drawClip(ctx, cmfont, HEADER.clip, HEADER.x, HEADER.y));
    if (progress < 1) return;
    if (!tabs.length) { drawText(ctx, title, HEADER.textX, HEADER.textY); return; }
    drawText(ctx, title, 44, HEADER.textY);
    const xs = layoutTabs(tabs, (s) => textWidth(s), tabStart ?? 44 + textWidth(title) + 16, gap);
    tabs.forEach((label, i) => drawText(ctx, label, xs[i], HEADER.textY, i === active ? undefined : { clut: 7 }));
}

/** Footer plate with up to two text lines. */
export function drawFooter(ctx, progress, line1 = "", line2 = "") {
    withFold(ctx, progress, FOOTER.pivot[0], FOOTER.pivot[1], "x", () => drawClip(ctx, ststat, FOOTER.clip, FOOTER.x, FOOTER.y));
    if (progress < 1) return;
    if (line1) drawText(ctx, line1, FOOTER.textX, FOOTER.textY);
    if (line2) drawText(ctx, line2, FOOTER.textX, FOOTER.textY + FOOTER.lineH);
}

// ---------------------------------------------------------------- small pieces

/** Pixels of a `w` px bar that `value` of `max` fills (0 when max is not a positive number). */
export function barFill(value, max, w) {
    if (!(max > 0) || !(value > 0)) return 0;
    return Math.max(0, Math.min(w, Math.round((value / max) * w)));
}

/** A flat bar drawn with the frame blue of the pause windows (web/uiRects.js): no new art. */
export function drawBar(ctx, x, y, w, h, value, max) {
    ctx.fillStyle = "rgb(0, 0, 32)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgb(104, 104, 208)";
    ctx.fillRect(x, y, barFill(value, max, w), h);
}

/** The field behind a book, dimmed. `padL` is the wide-screen pad on each side (web/game.js wideField.padL), in canvas pixels. */
export function dimField(ctx, viewW, viewH, padL = 0, alpha = 0.5) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0 - padL, 0, viewW + 2 * padL, viewH);
}

// ---------------------------------------------------------------- the QUESTS page's layout, shared
// engine/dw3/ui/native/pause-quests.ts draws: top bar cmfont 0x18 (HEADER above), the list window cmfont 0x24 at (0xa8, 0x28)
// folding about (0x140, 0x52), rows of text at x 0xbd, y 0x31 + 0xe * i, the cursor at x 0xb0, and the description band
// ststat 0x20 (FOOTER above). OPTIONS and GLOSSARY use the same places.
export const LIST_WINDOW = Object.freeze({ clip: 36, x: 168, y: 40, w: 160, pivot: [320, 82], textX: 189, textY: 49, pitch: 14, cursorX: 176, maxRows: 8 });
/** Right edge for a row's value, inside the window (the window ends at x 328, past the 320 box: the disc's own panel bleeds off the edge). */
export const LIST_VALUE_RIGHT = 306;

/** The list window for `rows` rows: the disc's 0x24 panel up to eight rows, the same tiles with more bands above that. */
export function drawListWindow(ctx, progress, rows) {
    withFold(ctx, progress, LIST_WINDOW.pivot[0], LIST_WINDOW.pivot[1], "x", () => {
        if (rows <= LIST_WINDOW.maxRows) drawClip(ctx, cmfont, LIST_WINDOW.clip, LIST_WINDOW.x, LIST_WINDOW.y);
        else drawPanel(ctx, LIST_WINDOW.x, LIST_WINDOW.y, 4, rows - 2);
    });
}

/** y of row `i` of a list. */
export const listRowY = (i) => LIST_WINDOW.textY + LIST_WINDOW.pitch * i;

/** The description band with `text` wrapped by measured width to at most two lines (the second cut to fit). */
export function drawHelpBox(ctx, progress, text) {
    const lines = wrapByWidth(text, (s) => textWidth(s), BAND_TEXT_W);
    drawFooter(ctx, progress, lines[0] ?? "", lines[1] ? fitByWidth(lines.slice(1).join(" "), (s) => textWidth(s), BAND_TEXT_W) : "");
}
