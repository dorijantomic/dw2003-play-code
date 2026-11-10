// web/panel-kit.js -- free-height panels built from the game's own pause-list tiles. Pure: no DOM, no imports.
//
// The pause list's row panel is not one picture. cmfont clips 0x1c (five rows), 0x1b (six) and 0x19 (seven) are each a
// grid of the same six tile frames, 40 px wide, four columns (160 px), one band per row after the first two:
//
//     band          height   column 0     columns 1-3
//     top           22       frame 56     frame 57
//     middle x n    14 each  frame 58     frame 59       (n = rows - 2)
//     bottom        20       frame 60     frame 61
//
// So clip height = 42 + 14 * (rows - 2) = 84 / 98 / 112 for 5 / 6 / 7 rows, which is what the sheet's own layer records
// measure (tests/panel-kit.test.js). The disc stops at seven rows. A list of eight or nine rows (Folder Bag + QUESTS +
// GLOSSARY + OPTIONS) takes the same tiles with more middle bands. The engine asks for clip PAUSE_PANEL_EXTRA_BASE + rows
// (engine/dw3/ui/native/pause-list.ts pausePanelClip); screenpack.js registers those clips when the cmfont sheet loads.

/** Must equal PAUSE_PANEL_EXTRA_BASE in engine/dw3/ui/native/pause-list.ts (pinned by tests/panel-kit.test.js). */
export const PAUSE_PANEL_EXTRA_BASE = 0x100;
/** The six tile frames of cmfont, by role. */
export const PANEL_FRAMES = Object.freeze({ topLeft: 56, top: 57, left: 58, mid: 59, bottomLeft: 60, bottom: 61 });
/** A tile is 40 px wide; the pause list's panel is four of them. */
export const PANEL_COLS = 4;
/** cmfont clip 0x1c (decimal 28): five rows, carries all six tile frames. */
const SOURCE_CLIP = "28";

/** Frame number -> { frame, x, y, w, h } read from the layer records of the pause list's own five-row panel. */
export function tileFrames(ids, sourceClip = SOURCE_CLIP) {
    const out = {};
    for (const l of ids?.[sourceClip]?.layers ?? []) out[l.frame] = { frame: l.frame, x: l.x, y: l.y, w: l.w, h: l.h };
    for (const f of Object.values(PANEL_FRAMES)) if (!out[f]) return null;
    return out;
}

/** Height of a panel with `bands` middle bands. */
export function panelHeight(frames, bands) {
    return frames[PANEL_FRAMES.topLeft].h + bands * frames[PANEL_FRAMES.left].h + frames[PANEL_FRAMES.bottomLeft].h;
}

/** A clip (the sheet's own record shape) with `cols` tile columns and `bands` middle bands. */
export function buildPanelClip(frames, cols, bands) {
    const F = PANEL_FRAMES;
    const tileW = frames[F.topLeft].w;
    const layers = [];
    const put = (frame, col, dy) => {
        const f = frames[frame];
        layers.push({ frame: f.frame, x: f.x, y: f.y, w: f.w, h: f.h, dx: col * tileW, dy });
    };
    let dy = 0;
    for (let c = 0; c < cols; c++) put(c === 0 ? F.topLeft : F.top, c, dy);
    dy += frames[F.topLeft].h;
    for (let b = 0; b < bands; b++) {
        for (let c = 0; c < cols; c++) put(c === 0 ? F.left : F.mid, c, dy);
        dy += frames[F.left].h;
    }
    for (let c = 0; c < cols; c++) put(c === 0 ? F.bottomLeft : F.bottom, c, dy);
    return { semi: -1, stp: false, layers };
}

/**
 * Add the clips for 8 to `maxRows` rows to a loaded cmfont `ids` table. Returns how many were added (0 when the sheet has
 * not got the six tiles, in which case nothing changes and the list falls back to the disc's panels).
 */
export function registerPausePanels(ids, maxRows = 12) {
    const frames = tileFrames(ids);
    if (!frames) return 0;
    let added = 0;
    for (let rows = 8; rows <= maxRows; rows++) {
        ids[String(PAUSE_PANEL_EXTRA_BASE + rows)] = buildPanelClip(frames, PANEL_COLS, rows - 2);
        added++;
    }
    return added;
}
