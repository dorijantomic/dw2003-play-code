// Quest scenes: walkable ground.
//
// A scripted walk hands the game's cutscene VM a target point, and the VM's walk driver steps the character toward it in
// eight directions with no collision test at all (engine/systems/cutscene-manager.ts `_moveToward`): a straight line
// that crosses a wall walks straight through it. This module is the one place that knows what such a line may cross, so
// a quest scene can route a walk around a wall instead, and the build-time checker can say "this spot is inside a wall".
//
// It is pure (no DOM, no game state) and is used twice:
//   * at build time by tools/check_quest_walks.mjs, over web/assets/collision/<map>.json (the JSON shape); and
//   * at run time by web/game.js (playQuestScene -> compileScene), over state.collision[mapId] (the engine grid: the
//     same fields plus a decoded Uint8Array `cells`).
//
// Ground is measured with the player's own foot box (game.js `boxStuck`, engine `rectBlocked`): 12 px wide, 8 px deep,
// hanging off the feet point. A point is walkable when that box touches no blocked cell. The box is 12 px wide on an
// 8 px grid, so a walkable point also needs its two horizontal neighbours free — the same standard the game's own field
// movement applies to the player, and the one web/quest-scenes.js `planTogether` already used.

/** The player's foot box: half width, and how far above the feet point it reaches. */
export const FOOT_HALF = 6;
export const FOOT_DEPTH = 8;

/** The cell of a grid the point falls in. */
const cellOf = (grid, x, y) => [Math.floor(x / grid.cell), Math.floor(y / grid.cell)];

/**
 * A grid in the shape this module works on: `{ cell, cols, rows, cells }` with `cells` a per-cell 0/1 array. Accepts the
 * engine's own grid (already in that shape) and the JSON one (`{ blocked: ["0101...", ...] }`, one string per row).
 */
export function questGrid(src) {
    if (!src || !Number.isFinite(src.cols) || !Number.isFinite(src.rows)) return null;
    const cell = src.cell || 8;
    if (src.cells && typeof src.cells.length === "number" && src.cells.length >= src.cols * src.rows) {
        return src.cells instanceof Uint8Array ? src : { cell, cols: src.cols, rows: src.rows, cells: Uint8Array.from(src.cells) };
    }
    if (!Array.isArray(src.blocked)) return null;
    const cells = new Uint8Array(src.cols * src.rows);
    src.blocked.forEach((row, r) => {
        const s = String(row);
        for (let c = 0; c < src.cols; c++) if (s[c] === "1") cells[r * src.cols + c] = 1;
    });
    return { cell, cols: src.cols, rows: src.rows, cells };
}

/** Whether any blocked cell lies in the rectangle (x0,y0)-(x1,y1); off the grid counts as blocked. */
export function questRectBlocked(grid, x0, y0, x1, y1) {
    if (!grid) return true;
    const [c0, r0] = cellOf(grid, x0, y0), [c1, r1] = cellOf(grid, x1, y1);
    for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
            if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return true;
            if (grid.cells[r * grid.cols + c]) return true;
        }
    return false;
}

/** Whether a character standing with its feet at (x, y) is on walkable ground. */
export function questStandFree(grid, x, y) {
    return !questRectBlocked(grid, x - FOOT_HALF, y - FOOT_DEPTH, x + FOOT_HALF, y);
}

/** Whether a character can walk the straight line a->b without its foot box touching a wall (sampled every `step` px). */
export function questLineClear(grid, ax, ay, bx, by, step = 4, skip = 0) {
    if (!grid) return true;
    const len = Math.hypot(bx - ax, by - ay);
    // `skip` px at the start are not sampled: a character the scene did not place (an NPC on its own post) may already
    // be standing with its foot box clipped, and walking away from that is not the scene's fault
    const from = skip > 0 && len > skip ? skip / len : 0;
    const n = Math.max(1, Math.ceil((len * (1 - from)) / step));
    for (let i = 0; i <= n; i++) {
        const t = from + (1 - from) * (i / n);
        if (!questStandFree(grid, ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
}

// --- the cell graph -----------------------------------------------------------------------------------------------
// A cell is standable when a character standing at its lower middle is on walkable ground. Eight neighbours, but a
// diagonal step is only allowed when both cells it passes between are standable too (no cutting a wall corner).

/** The standable point of a cell: its lower middle (where the feet of a character standing in it would be). */
const cellPoint = (grid, c, r) => [c * grid.cell + grid.cell / 2, r * grid.cell + grid.cell - 1];

/** Whether a cell can be stood in. */
export function questCellFree(grid, c, r) {
    if (!grid || c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
    const [x, y] = cellPoint(grid, c, r);
    return questStandFree(grid, x, y);
}

/** The nearest standable cell to a point, searched in rings out to `limit` cells; null when there is none. */
export function questFreeCellNear(grid, x, y, limit = 6) {
    const [c0, r0] = cellOf(grid, x, y);
    if (questCellFree(grid, c0, r0)) return [c0, r0];
    for (let d = 1; d <= limit; d++) {
        let best = null, bestD = Infinity;
        for (let r = r0 - d; r <= r0 + d; r++)
            for (let c = c0 - d; c <= c0 + d; c++) {
                if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== d) continue;      // the ring only
                if (!questCellFree(grid, c, r)) continue;
                const dd = Math.hypot(c - c0, r - r0);
                if (dd < bestD) { best = [c, r]; bestD = dd; }
            }
        if (best) return best;
    }
    return null;
}

/** Breadth-first search over standable cells; returns the cell path (inclusive) or null when the goal is unreachable. */
export function questCellPath(grid, from, to) {
    if (!grid || !from || !to) return null;
    const { cols, rows } = grid;
    const key = (c, r) => r * cols + c;
    const prev = new Int32Array(cols * rows).fill(-1);
    const seen = new Uint8Array(cols * rows);
    const start = key(from[0], from[1]);
    seen[start] = 1;
    const queue = [from];
    const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let head = 0; head < queue.length; head++) {
        const [c, r] = queue[head];
        if (c === to[0] && r === to[1]) break;
        for (const [dc, dr] of STEP) {
            const nc = c + dc, nr = r + dr;
            if (!questCellFree(grid, nc, nr)) continue;
            if (dc && dr && (!questCellFree(grid, c + dc, r) || !questCellFree(grid, c, r + dr))) continue;
            const k = key(nc, nr);
            if (seen[k]) continue;
            seen[k] = 1;
            prev[k] = key(c, r);
            queue.push([nc, nr]);
        }
    }
    const goal = key(to[0], to[1]);
    if (!seen[goal]) return null;
    const path = [];
    for (let k = goal; k !== -1; k = prev[k]) path.push([k % cols, Math.floor(k / cols)]);
    return path.reverse();
}

/**
 * The shortest walkable route from a point to a point, as a few straight legs (`[[x, y], ...]`, the last one the
 * destination). `exact` is false when the route stops short of the requested spot (it is inside a wall, or in a pocket
 * nothing can walk to): then the last leg is the ground closest to it that the walker can really reach. A straight line
 * that is already clear is a single leg (the common case: no routing at all). Returns null only when there is no grid or
 * the walker stands nowhere standable at all.
 */
export function questRoute(grid, ax, ay, bx, by) {
    if (!grid) return null;
    const target = [Math.round(bx), Math.round(by)];
    const len = Math.hypot(target[0] - ax, target[1] - ay);
    const exact = questStandFree(grid, target[0], target[1]);
    // the walker's own first 12 px are not checked: it may already stand with a clipped foot box on its own post
    if (questLineClear(grid, ax, ay, target[0], target[1], 4, 12)) {
        return exact ? { legs: [target], exact: true } : { legs: [], exact: false };
    }
    // A short step to a spot that is not standable ground (a giver stepping back off a counter cell) is walked as the
    // scene wrote it: routing a 4 px step would send the character wandering off to the nearest cell instead.
    if (!exact && len <= 24) return { legs: [target], exact: false };
    const start = questFreeCellNear(grid, ax, ay);
    if (!start) return null;
    // the goal: the destination's own cell when it can be stood in, else the closest standable one to it
    const goal = exact ? cellOf(grid, target[0], target[1]) : questFreeCellNear(grid, target[0], target[1], 8);
    let cells = goal && questCellFree(grid, goal[0], goal[1]) ? questCellPath(grid, start, goal) : null;
    let end = exact ? target : (goal ? cellPoint(grid, goal[0], goal[1]) : null);
    let stopsShort = !exact;
    if (!cells) {
        // nowhere near the destination is reachable: stop on the closest ground the walker can walk to instead, so the
        // walk still goes as far toward it as the map allows (and still finishes)
        const stop = questClosestCell(grid, start, target);
        if (!stop) return null;
        cells = questCellPath(grid, start, stop);
        if (!cells) return null;
        end = cellPoint(grid, stop[0], stop[1]);
        stopsShort = true;
    }
    const points = [[ax, ay], ...cells.map(([c, r]) => cellPoint(grid, c, r)), end];
    // string-pull: keep only the corners a straight walk can actually take
    const legs = [];
    let i = 0;
    while (i < points.length - 1) {
        let j = points.length - 1;
        while (j > i + 1 && !questLineClear(grid, points[i][0], points[i][1], points[j][0], points[j][1])) j--;
        legs.push([Math.round(points[j][0]), Math.round(points[j][1])]);
        i = j;
    }
    // the last leg is the destination itself (or its standable stand-in), never a cell centre short of it
    if (legs.length === 0) legs.push([Math.round(end[0]), Math.round(end[1])]);
    else legs[legs.length - 1] = [Math.round(end[0]), Math.round(end[1])];
    return { legs, exact: !stopsShort };
}

/** The cell closest to `target` that a character standing on `start`'s own piece of ground can walk to. */
export function questClosestCell(grid, start, target) {
    if (!grid || !start) return null;
    const { cols, rows } = grid;
    const seen = new Uint8Array(cols * rows);
    const queue = [start];
    seen[start[1] * cols + start[0]] = 1;
    let best = null, bestD = Infinity;
    const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let head = 0; head < queue.length; head++) {
        const [c, r] = queue[head];
        const [x, y] = cellPoint(grid, c, r);
        const d = Math.hypot(x - target[0], y - target[1]);
        if (d < bestD) { best = [c, r]; bestD = d; }
        for (const [dc, dr] of STEP) {
            const nc = c + dc, nr = r + dr;
            if (!questCellFree(grid, nc, nr)) continue;
            if (dc && dr && (!questCellFree(grid, c + dc, r) || !questCellFree(grid, c, r + dr))) continue;
            const k = nr * cols + nc;
            if (seen[k]) continue;
            seen[k] = 1;
            queue.push([nc, nr]);
        }
    }
    return best;
}

/**
 * The legs a quest scene's walk should take: one leg when the straight line is clear, a routed few when it is not (so
 * the character goes around the wall instead of through it), and null when there is nothing to route over.
 */
export function questWalkLegs(grid, ax, ay, bx, by) {
    const r = questRoute(grid, ax, ay, bx, by);
    if (!r) return null;
    if (r.exact && r.legs.length === 1) return r.legs;
    if (!r.legs.length) return null;                  // the destination is inside a wall and nowhere near ground
    return r.legs;
}

// --- the map's own reachable area ----------------------------------------------------------------------------------

/**
 * Connected components of standable cells (8-connected, no cutting a wall corner): `labels` is one int per cell (-1 =
 * not standable) and two cells share a label exactly when a character can walk between them.
 */
export function questComponents(grid) {
    if (!grid) return { labels: new Int32Array(0), sizes: [] };
    const { cols, rows } = grid;
    const labels = new Int32Array(cols * rows).fill(-1);
    const sizes = [];
    const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const k = r * cols + c;
            if (labels[k] !== -1 || !questCellFree(grid, c, r)) continue;
            const label = sizes.length;
            let size = 0;
            const queue = [[c, r]];
            labels[k] = label;
            for (let head = 0; head < queue.length; head++) {
                const [qc, qr] = queue[head];
                size++;
                for (const [dc, dr] of STEP) {
                    const nc = qc + dc, nr = qr + dr;
                    if (!questCellFree(grid, nc, nr)) continue;
                    if (dc && dr && (!questCellFree(grid, qc + dc, qr) || !questCellFree(grid, qc, qr + dr))) continue;
                    const nk = nr * cols + nc;
                    if (labels[nk] !== -1) continue;
                    labels[nk] = label;
                    queue.push([nc, nr]);
                }
            }
            sizes.push(size);
        }
    return { labels, sizes };
}

/**
 * Which of a map's standable cells the player can actually be standing in: every component that holds one of `seeds`
 * (the map's exits), every component those join through `links` (a ladder's two ends, the two sides of a door), and the
 * map's largest component (a map whose exits all sit on wall cells would otherwise read as "nothing is reachable").
 * Everything else is a sealed pocket — ground drawn on the map that nothing can walk to. `reach` is one byte per cell,
 * 1 = reachable.
 */
export function questReachArea(grid, seeds = [], links = []) {
    const { cols, rows } = grid || { cols: 0, rows: 0 };
    const { labels, sizes } = questComponents(grid);
    const parent = sizes.map((_, i) => i);
    const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const unite = (a, b) => {
        if (a == null || b == null || a === -1 || b === -1 || a === b) return;
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };
    const labelOf = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
        const c = Math.floor(x / grid.cell), r = Math.floor(y / grid.cell);
        if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
        return labels[r * cols + c];
    };
    for (const [a, b] of links) unite(labelOf(a[0], a[1]), labelOf(b[0], b[1]));
    const on = new Set();
    for (const [x, y] of seeds) {
        const label = labelOf(x, y);
        if (label !== -1) on.add(find(label));
    }
    let biggest = -1;
    for (let i = 0; i < sizes.length; i++) if (biggest === -1 || sizes[i] > sizes[biggest]) biggest = i;
    if (biggest !== -1) on.add(find(biggest));
    const reach = new Uint8Array(cols * rows);
    for (let k = 0; k < labels.length; k++) if (labels[k] !== -1 && on.has(find(labels[k]))) reach[k] = 1;
    return reach;
}

/** Whether a point is in that reachable area (its own cell, or the nearest standable cell within a few). */
export function questReachable(grid, reach, x, y, limit = 4) {
    if (!grid || !reach) return true;
    const [c0, r0] = cellOf(grid, x, y);
    if (questCellFree(grid, c0, r0)) return !!reach[r0 * grid.cols + c0];
    const near = questFreeCellNear(grid, x, y, limit);
    return near ? !!reach[near[1] * grid.cols + near[0]] : false;
}

// --- where a stand-in may stand ------------------------------------------------------------------------------------

/** The sideways nudges a quest stand-in tries before it gives up and stands on the post itself. */
export const STAND_IN_OFFSETS = [
    [28, 0], [-28, 0], [28, -8], [-28, -8], [0, -10], [0, 10],
    [56, 0], [-56, 0], [56, -8], [-56, -8], [0, -20], [0, 20],
];

/**
 * Where a quest stand-in (game.js `questStandIns`) should stand: the post itself when it is clear, else the first nudge
 * around it that is, else the post (a stand-in on the post is better than no stand-in at all: the quest still needs
 * someone to talk to). `clear(x, y)` answers "walkable ground and no other character there".
 */
export function standInSpot(post, clear, offsets = STAND_IN_OFFSETS) {
    const x = Math.round(Number(post?.x) || 0), y = Math.round(Number(post?.y) || 0);
    if (typeof clear !== "function" || clear(x, y)) return { x, y };
    for (const [dx, dy] of offsets) if (clear(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return { x, y };
}
