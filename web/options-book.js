// web/options-book.js -- the OPTIONS screen: four pages of player settings in the QUESTS page layout (slanted header bar,
// navy list window on the right, help box at the bottom, the dimmed field behind). Rows and rules: web/options-model.js.
//
// Keys (web/ui-kit-input.js words): up / down move the cursor, left / right change the value, Q / E (l1 / r1) switch the
// page, Back (cross) leaves. Settings are written through window.__setFxMany, the same store as F2 (web/ambience.js).
import { SPRITE_FILTERS } from "./sprite-filters.js";
import { GPU_FILTER_NAMES } from "./gpu-pixel-filter.js";
import { LIST_ROWS, PAGES, createOptionsModel } from "./options-model.js";
import { WORD } from "./ui-kit-input.js";
import { LIST_WINDOW, drawHeader, drawHelpBox, drawPanel, layoutTabs, listRowY, withFold } from "./ui-kit.js";
import { drawCursor, drawText, textWidth } from "./uifont.js";
import { fitByWidth } from "./text-fit.js";

/** Short names: the long F2 names ("Plain smooth (bilinear)") are too long for a value beside a row label. */
const FILTER_SHORT = Object.freeze({ off: "Off", bilinear: "Smooth", epx: "EPX", mmpx: "MMPX", xbr: "xBR", xbrblend: "xBR blend" });
/** The filters the GPU path can run, as [id, label]. */
export const pixelFilterChoices = () => Object.keys(SPRITE_FILTERS)
    .filter((k) => k === "off" || GPU_FILTER_NAMES.includes(k))
    .map((k) => [k, FILTER_SHORT[k] ?? SPRITE_FILTERS[k]]);

const ARROW_W = 10;     // room kept for one arrow
const GAP = 4;          // between the label and the value block
const WIDE = 200;       // 5 columns of 40 px

/**
 * OPTIONS has its own, wider list window than the QUESTS page (ruling: it may differ): 5 columns = 200 px, its right edge
 * where the 160 px one ended (x 328), so it starts at x 128. Rows and cursor keep the QUESTS offsets from the window's left.
 */
const WX = LIST_WINDOW.x + LIST_WINDOW.w - WIDE;
export const OPTIONS_WINDOW = Object.freeze({
    x: WX, y: LIST_WINDOW.y, cols: 5, bands: LIST_ROWS - 2,   // rows = bands + 2 (panel-kit); sized for the most rows on screen at once (an EFFECTS category scrolls past that)
     pivot: LIST_WINDOW.pivot,
    textX: WX + (LIST_WINDOW.textX - LIST_WINDOW.x),
    cursorX: WX + (LIST_WINDOW.cursorX - LIST_WINDOW.x),
    valueRight: 288,    // right end of the value text; its right arrow sits after it, inside the frame (the box ends at x 320)
});

/** Header: "OPTIONS", then L1, the page tabs and R1 in one row, each measured so no two touch. Boxes are [x0, x1]. */
export function headerLayout(widthOf, title, tabs, hintW = widthOf("L1")) {
    const titleX = 44, l1 = titleX + widthOf(title) + 8, tabStart = l1 + hintW + 8, tabGap = 8;
    const xs = layoutTabs(tabs, widthOf, tabStart, tabGap);
    const tabBoxes = tabs.map((t, i) => [xs[i], xs[i] + widthOf(t)]);
    const r1 = tabBoxes.length ? tabBoxes[tabBoxes.length - 1][1] + 8 : tabStart;
    return { title: [titleX, titleX + widthOf(title)], l1: [l1, l1 + hintW], r1: [r1, r1 + hintW], tabs: tabBoxes, tabStart, tabGap };
}

/** One row's drawn parts for a row view `r`: the label (cut only if it cannot fit) and where the value and its arrows go. */
export function rowLayout(widthOf, r, win = OPTIONS_WINDOW) {
    const kind = r.numeric ? 3 : 1;
    const valueW = widthOf(r.value, kind);
    const right = win.valueRight, left = right - valueW;
    const room = left - (r.canLeft ? ARROW_W : 0) - GAP - win.textX;
    return { label: fitByWidth(r.label, (s) => widthOf(s, 1), room), valueRight: right, valueLeft: left, leftArrowX: left - ARROW_W, rightArrowX: right + 2, kind };
}

export function createOptionsBook({ sfx = null, fx = () => (typeof window !== "undefined" ? window.__fx : null), setFxMany = (o) => window.__setFxMany?.(o) } = {}) {
    const store = { get: (k) => fx()?.[k], setMany: (o) => setFxMany(o) };
    const model = createOptionsModel(store, pixelFilterChoices());
    const cue = (result) => { if (result) sfx?.play?.("system02"); };
    return {
        windows: ["title", "list", "help"],
        wall: false,
        model,
        act(buttons) {
            if (buttons.has(WORD.back)) { if (model.back()) { cue("move"); return null; } return "back"; }
            if (buttons.has(WORD.confirm)) cue(model.select());
            else if (buttons.has(WORD.prev)) cue(model.switchPage(-1));
            else if (buttons.has(WORD.next)) cue(model.switchPage(1));
            else if (buttons.has("up")) cue(model.moveRow(-1));
            else if (buttons.has("down")) cue(model.moveRow(1));
            else if (buttons.has("left")) cue(model.change(-1));
            else if (buttons.has("right")) cue(model.change(1));
            return null;
        },
        draw(ctx, view) {
            const pt = view.progress("title"), pl = view.progress("list"), ph = view.progress("help");
            const hl = headerLayout((s, k = 1) => textWidth(s, k), "OPTIONS", model.pageLabels());
            drawHeader(ctx, pt, "OPTIONS", model.pageLabels(), model.page(), { tabStart: hl.tabStart, gap: hl.tabGap });
            if (pt >= 1) {
                drawText(ctx, "L1", hl.l1[0], 20, { kind: 3, clut: 2 });
                drawText(ctx, "R1", hl.r1[0], 20, { kind: 3, clut: 2 });
            }
            const rows = model.view();
            const W = OPTIONS_WINDOW;
            withFold(ctx, pl, W.pivot[0], W.pivot[1], "x", () => drawPanel(ctx, W.x, W.y, W.cols, W.bands));
            if (pl >= 1) {
                rows.forEach((r, i) => {
                    const y = listRowY(i), t = rowLayout((s, k = 1) => textWidth(s, k), r);
                    drawText(ctx, t.label, W.textX, y);
                    if (r.canLeft) drawText(ctx, "◀", t.leftArrowX, y);
                    drawText(ctx, r.value, t.valueRight, y, { alignRight: true, kind: t.kind });
                    if (r.canRight) drawText(ctx, "▶", t.rightArrowX, y);
                });
                drawCursor(ctx, view.ticks * 2, W.cursorX, listRowY(model.row()));
                const more = model.scroll();
                if (more.above) drawText(ctx, "▲", W.valueRight + 14, listRowY(0));
                if (more.below) drawText(ctx, "▼", W.valueRight + 14, listRowY(LIST_ROWS - 1));
            }
            drawHelpBox(ctx, ph, ph >= 1 ? model.help() : "");
        },
    };
}
