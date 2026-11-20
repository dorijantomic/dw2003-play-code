// web/cursor-almanac.js — every menu cursor the game uses, at the rate the disc
// uses it. DOM-free: node imports this file, web/cursor-almanac.html draws with it.
//
// Four screens, four decoded clocks:
//
//   Pause menu   F0x8001B0A4 (engine/dw3/ui/cursor-handler.ts) swaps the widget's
//                line-0 string through the five glyph strings at 0x8004DCE0:
//                32 vsyncs on frame 0, then 6 vsyncs per step through frames 1..4,
//                entry 4 repeating entry 2 — one pulse is 56 vsyncs. The
//                constructor's presets (+0x74 = 0x20, +0x78 = 6) live in
//                engine/dw3/ui/spawn-ui-icon.ts. The glyph strings themselves are
//                the ones the walker already draws with (web/uifont.js,
//                CURSOR_FRAMES), so this page cannot drift from the pause menu.
//   Card album   F0x80084500's grid cursor is clip 7, its palette walking the
//                6-step CLUT table at 0x80085A4C every 17 ticks; the L1/R1 page
//                arrows blink on the same 17 (engine/dw3/ui/native/album-lifecycle.ts).
//   Digimon Lab  F0x8008365C: the chart cursor and both pagers CLUT-cycle rows
//                0-3 every 8 vsyncs (engine/dw3/ui/native/lab-chart.ts).
//   World map    F0x80098B84: the marker/cursor frame advances on a 4-frame
//                counter (engine/dw3/ui/native/pause-map.ts).
//
// One tick is one vsync; the page runs the clock at PAL's 50 Hz.
//
// OFF unless F2 -> Extras -> "Cursor almanac (new)" is switched on
// (web/ambience.js). With the switch off the page has no link anywhere.

import { CURSOR_FRAMES, CURSOR_REST_VSYNC, CURSOR_STEP_VSYNC } from "./uifont.js";

/** The five glyph strings the pause cursor swaps through (table 0x8004DCE0). */
export const GLYPH_TABLE = CURSOR_FRAMES;

/**
 * The pause list cursor's whole pulse, read from the same table the handler
 * uses: `rest` vsyncs on frame 0, `step` vsyncs per step through the last
 * `glyphs - 1` entries, then back to frame 0. `repeats` lists the earlier
 * entries the last one repeats (entry 4 repeats entry 2).
 */
export function pauseCycle() {
    const repeatIndex = GLYPH_TABLE.length - 1;
    const repeats = [];
    for (let i = 0; i < repeatIndex; i++) {
        if (GLYPH_TABLE[i] === GLYPH_TABLE[repeatIndex]) repeats.push(i);
    }
    return {
        rest: CURSOR_REST_VSYNC,
        step: CURSOR_STEP_VSYNC,
        cycle: CURSOR_REST_VSYNC + CURSOR_STEP_VSYNC * repeatIndex,
        glyphs: GLYPH_TABLE.length,
        repeatIndex,
        repeats,
    };
}

const PAUSE = pauseCycle();

/**
 * The four cursors, one row each. `source` says where the cursor lives in the
 * code and in the decoded doc. The pause row's rest/step/cycle are the
 * module's own table (pauseCycle), not a second copy of the numbers.
 */
export const CURSORS = Object.freeze([
    Object.freeze({
        screen: "Pause menu",
        kind: "glyph",
        glyphs: GLYPH_TABLE,
        rest: PAUSE.rest,
        step: PAUSE.step,
        cycle: PAUSE.cycle,
        source:
            "engine/dw3/ui/cursor-handler.ts cursorHandler (F0x8001B0A4) and " +
            "engine/dw3/ui/spawn-ui-icon.ts (+0x74 = 0x20, +0x78 = 6); " +
            "docs/research/ui/pause-menu-chrome-decoded-2026-09-04.md §1",
    }),
    Object.freeze({
        screen: "Card album",
        kind: "clut",
        clut: "0x80085A4C, 6 steps",
        clutSteps: 6,
        period: 17,
        source:
            "engine/dw3/ui/native/album-lifecycle.ts (clip 7, +0xB4 / +0xB0, 0x11 ticks); " +
            "docs/research/ui/stcrdabm-decoded-2026-07-12.md §2",
    }),
    Object.freeze({
        screen: "Digimon Lab",
        kind: "clut",
        clut: "rows 0-3",
        rows: 4,
        period: 8,
        source:
            "engine/dw3/ui/native/lab-chart.ts labChartDraw (+0x288, paletteShift); " +
            "docs/research/ui/stgdglab-decoded-2026-07-11.md Phase 3",
    }),
    Object.freeze({
        screen: "World map",
        kind: "blink",
        period: 4,
        frames: 4,
        source:
            "engine/dw3/ui/native/pause-map.ts mapDraw (+0x174, +0x170, +0xA0); " +
            "docs/research/systems-plain/menus.md §The map",
    }),
]);

/**
 * The frame a row shows at vsync `t`, in that row's own decoded clock:
 *
 *   glyph rows  the pause pulse: 0 during the rest, then 1..4 one step each
 *   clut rows   the palette step: the album's six, the lab's four
 *   blink rows  the map's 4-frame counter
 */
export function frameOf(row, t) {
    const tick = Math.max(0, Math.floor(Number(t) || 0));
    if (row.kind === "glyph") {
        const k = tick % row.cycle;
        if (k < row.rest) return 0;
        return 1 + Math.floor((k - row.rest) / row.step);
    }
    if (row.kind === "clut") {
        const steps = row.clutSteps ?? row.rows;
        return Math.floor(tick / row.period) % steps;
    }
    return Math.floor(tick / row.period) % row.frames;
}
