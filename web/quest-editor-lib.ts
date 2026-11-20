// Quest editor: the rules for where a quest character may stand and where a named path may go.
//
// Pure (no DOM): web/quest-editor.js draws with it, tools/quest_editor_check.mjs (the save helper) and
// tests/quest-editor.test.js check saved data with it. "Walkable" is exactly web/quest-walk.js: the player's own foot box
// on web/assets/collision/<map>.json, and legs between two points are the wall routing the quest scenes use.
import { questGrid, questStandFree, questFreeCellNear, questWalkLegs, questCellFree } from "./quest-walk.js";

export const DIRS = ["down", "down-left", "left", "right", "up-left", "up", "down-right", "up-right"];
export const PATH_NAME = /^[a-z][a-z0-9_]*$/;
export const SNAP_LIMIT = 3;                         // cells (24 px): a drop further than this from walkable ground is refused

export { questGrid };

/** A walkable point's own standing spot for a cell: lower middle of the cell (the same point quest-walk.js uses). */
export const cellSpot = (grid, c, r) => [c * grid.cell + grid.cell / 2, r * grid.cell + grid.cell - 1];

/** Whether a character may stand with its feet at (x, y). */
export function walkable(grid, x, y) {
    return !!grid && Number.isFinite(x) && Number.isFinite(y) && questStandFree(grid, Math.round(x), Math.round(y));
}

/**
 * Where a dropped point lands: itself when walkable, else the closest walkable spot within SNAP_LIMIT cells, else null
 * (refused). Returns [x, y] in whole pixels.
 */
export function snapPoint(grid, x, y) {
    if (!grid) return null;
    const px = Math.round(x), py = Math.round(y);
    if (walkable(grid, px, py)) return [px, py];
    const cell = questFreeCellNear(grid, px, py, SNAP_LIMIT);
    return cell ? cellSpot(grid, cell[0], cell[1]).map(Math.round) : null;
}

/** The walking legs of a path: from each point to the next, through the wall routing. [] when it has fewer than 2 points. */
export function pathLegs(grid, points) {
    const out = [];
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        out.push(questWalkLegs(grid, ax, ay, bx, by) ?? [[bx, by]]);
    }
    return out;
}

/**
 * Everything wrong with the saved data, as plain sentences (empty = fine).
 * @param data      { characters: [{ npc_id, name, residents: [{map,x,y,dir}] }], paths: { name: { map, points } } }
 * @param gridOf    (mapId) -> grid in quest-walk.js shape, or null when the map has no collision data
 */
export function checkData(data, gridOf) {
    const bad = [];
    const ids = new Set();
    for (const ch of data.characters ?? []) {
        if (!Number.isInteger(ch.npc_id) || ch.npc_id < 1000) bad.push(`character ${ch.name}: npc_id ${ch.npc_id} is not 1000 or more`);
        if (ids.has(ch.npc_id)) bad.push(`character ${ch.npc_id} is listed twice`);
        ids.add(ch.npc_id);
        const seen = new Set();
        for (const r of ch.residents ?? []) {
            const where = `${ch.name} on ${r.map} at ${r.x},${r.y}`;
            if (!DIRS.includes(r.dir)) bad.push(`${where}: facing "${r.dir}" is not one of ${DIRS.join(", ")}`);
            if (seen.has(r.map)) bad.push(`${ch.name} stands on ${r.map} twice`);
            seen.add(r.map);
            const g = gridOf(r.map);
            if (!g) bad.push(`${where}: no walk data for map ${r.map}`);
            else if (!walkable(g, r.x, r.y)) bad.push(`${where}: not walkable ground`);
        }
    }
    for (const [name, p] of Object.entries(data.paths ?? {})) {
        if (!PATH_NAME.test(name)) bad.push(`path "${name}": use lower-case letters, digits and _ , starting with a letter`);
        const g = gridOf(p.map);
        if (!g) { bad.push(`path ${name}: no walk data for map ${p.map}`); continue; }
        if (!Array.isArray(p.points) || !p.points.length) { bad.push(`path ${name}: no points`); continue; }
        p.points.forEach(([x, y], i) => {
            if (!walkable(g, x, y)) bad.push(`path ${name}: point ${i + 1} (${x},${y}) is not walkable ground`);
        });
        for (let i = 1; i < p.points.length; i++) {
            const r = questWalkLegs(g, p.points[i - 1][0], p.points[i - 1][1], p.points[i][0], p.points[i][1]);
            if (!r) bad.push(`path ${name}: no way from point ${i} to point ${i + 1}`);
        }
    }
    return bad;
}

export { questCellFree };
