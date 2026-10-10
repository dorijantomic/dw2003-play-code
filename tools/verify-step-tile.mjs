// The one reading of "where is this door, and which way must the player face for it
// to arm", shared by every browser check that stands on a field door.
//
// Read out of the SHIPPED artefacts, never hard-coded:
//
//   web/assets/data/story_trigger_grids.json — the type-7 position grid, re-derived
//     from each overlay by tools/extract_story_trigger_grids.py. Its byte's low 5
//     bits index web/assets/data/story_steps.json's records; its top 3 bits are the
//     required approach-facing group (step-load, pro/fieldstg.s:5614-:5628).
//   web/assets/data/story_steps.json          — the 24-byte records the byte indexes.
//   web/assets/data/scene/step_enable_table.json — FIELDSTG.PRO's 8x8 facing cone at
//     RAM 0x80097624 (tools/extract_step_enable_table.py), read at
//     pro/fieldstg.s:5688-:56a4 as `cone[group][player facing]`, live iff != 0.
//
// A door row's rectangle is the BOUNDING BOX of its step cells, so its centre can be
// a cell the grid leaves blank (s210's s220 door: 704,608 is inside the rect and is
// not a step tile). `doorTile` therefore returns a stand point inside a cell that is
// non-zero, and `armDir` the facing the cone admits for that cell's group.
import { readFileSync } from "node:fs";

/** char+0x60's 0-7 index order — engine/systems/field-movement.ts FIELD_DIRECTIONS,
 *  which is the column index of the cone table and the scale table at 0x8009b724. */
export const FACINGS = [
    "down", "down-left", "left", "up-left",
    "up", "up-right", "right", "down-right",
];

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));

export const GRIDS = read("../web/assets/data/story_trigger_grids.json").stages;
export const STEPS = read("../web/assets/data/story_steps.json").stages;
export const SCREENS = read("../data/screen_table.json");
export const CONE = read("../web/assets/data/scene/step_enable_table.json").rows;

const key = (stage) => String(stage).replace(/^s/, "");

/** The grid byte under a world point, or 0 when the stage has no grid there. */
export function gridByteAt(stage, x, y) {
    const g = GRIDS[key(stage)];
    if (!g?.grid || !g.cell) return 0;
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return 0;
    return (g.grid[cy * g.w + cx] & 0xff) || 0;
}

/**
 * The tile a door row actually sits on, and what that tile demands of the player.
 * `stand` is a point inside a cell the grid marks non-zero; `armDir` is a facing the
 * shipped cone admits for that cell's group, and `blindDir` one it refuses — so a
 * check can prove the door really is gated on the disc's facing cone instead of
 * being armed anywhere on the rectangle.
 */
export function doorTile(stage, row) {
    const g = GRIDS[key(stage)];
    if (!g?.grid || !g.cell) return null;
    const x0 = Math.floor(row.x / g.cell), x1 = Math.floor((row.x + row.w - 1) / g.cell);
    const y0 = Math.floor(row.y / g.cell), y1 = Math.floor((row.y + row.h - 1) / g.cell);
    const cells = [];
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            const b = g.grid[ty * g.w + tx] & 0xff;
            if (b) cells.push({ tx, ty, x: tx * g.cell, y: ty * g.cell, byte: b });
        }
    }
    if (!cells.length) return null;
    const c = cells[0];
    const step = c.byte & 0x1f, group = (c.byte >> 5) & 7;
    const armDir = FACINGS.find((_, i) => CONE?.[group]?.[i]);
    const blindDir = FACINGS.find((_, i) => !CONE?.[group]?.[i]);
    return {
        ...c,
        cells: cells.length,
        step,
        group,
        armDir,
        blindDir,
        // The cell's middle: inside the cell, so inside the row's rectangle too.
        stand: { x: c.x + g.cell / 2, y: c.y + g.cell / 2 },
        record: STEPS[key(stage)]?.steps?.[step] ?? null,
    };
}

/** Which way the player must FACE for the tile under (x, y) to arm. */
export function armingFacing(stage, x, y) {
    const group = (gridByteAt(stage, x, y) >> 5) & 7;
    return FACINGS[group];
}
