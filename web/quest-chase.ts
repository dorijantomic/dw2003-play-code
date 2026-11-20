// web/quest-chase.js
// The `chase` scene step's machine (web/quest-scenes.js documents the step): a target runs a path while the PLAYER keeps
// control and must stay within `lose` px of it. The result goes back to the quest the way an "ask" answer does:
//   0 = kept up (the path ran out, or the time limit came, with the player still within `lose`),
//   1 = lost it (the gap stayed over `lose` for a full second, or the path/time ran out while it was over).
//
// It is pure -- no DOM, no game state -- so tests drive it directly. game.js feeds it the player's position every frame
// and moves whichever character (an NPC id) or effect (an fx instance name) the step names. Nothing here decides what a
// loss means: the host ends the rest of the scene on 1, so the lines after a failed chase never claim a success, and the
// quest itself is never failed -- the player can talk again and retake it.
//
// `path` points are world pixels; the target starts where it already stands and walks the points in order at `speed` px
// per second (default 130: the player runs about 240, so keeping up is possible and falling behind is a real risk).
// `frames` is an optional limit, counted in 60ths of a second like every other scene wait. Scripted means scripted: the
// target walks straight through walls, and it may leave the map; the player is the one the map's collision applies to.
//
// The one hint it gives the host: `state.warn` turns on when the gap passes 80% of `lose` (the host blinks the target), so
// a chase about to be lost looks different from one being kept.

/** The face a walker shows along (dx, dy): the field's own direction names. */
export function chaseFacing(dx, dy) {
    const x = dx > 0.5 ? 1 : dx < -0.5 ? -1 : 0;
    const y = dy > 0.5 ? 1 : dy < -0.5 ? -1 : 0;
    if (y > 0) return x < 0 ? "down-left" : x > 0 ? "down-right" : "down";
    if (y < 0) return x < 0 ? "up-left" : x > 0 ? "up-right" : "up";
    return x < 0 ? "left" : "right";
}

/** A gap this big a share of `lose` and the target starts blinking. */
const WARN_AT = 0.8;
/** How many ticks (60 = one second of real play) the gap may stay over `lose` before it counts as lost. */
const GRACE_FRAMES = 60;

/**
 * @param spec  { path: [[x, y], ...], speed?, lose?, frames?, grace? } -- the step's event after compileScene resolved it
 * @param start { x, y } where the target stands when the chase begins (its own position, not path[0])
 */
export function createQuestChase(spec, start) {
    const path = (Array.isArray(spec?.path) ? spec.path : []).map((p) => [Number(p?.[0]) || 0, Number(p?.[1]) || 0]);
    const speed = Number(spec?.speed) > 0 ? Number(spec.speed) : 130;
    const lose = Number(spec?.lose) > 0 ? Number(spec.lose) : 90;
    const limit = Number.isFinite(Number(spec?.frames)) && Number(spec.frames) > 0 ? Number(spec.frames) : null;
    const grace = Number(spec?.grace) >= 1 ? Math.round(Number(spec.grace)) : GRACE_FRAMES;
    const from = start && Number.isFinite(Number(start.x)) && Number.isFinite(Number(start.y))
        ? { x: Number(start.x), y: Number(start.y) }
        : { x: path[0]?.[0] ?? 0, y: path[0]?.[1] ?? 0 };
    let total = 0;
    for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const state = {
        x: from.x, y: from.y,
        dir: "down",
        moving: false,
        point: 0,                // the path point it is walking to
        elapsed: 0,              // seconds since the chase began
        distance: 0,             // px to the player, the last tick
        outFor: 0,               // ticks in a row with the gap over `lose`
        warn: false,             // the player is about to lose it
        over: path.length === 0,
        result: path.length === 0 ? 0 : null,
    };

    /** One frame: move the target along the path, then judge the gap. Returns the state. */
    function tick(playerX, playerY, dt) {
        if (state.over) return state;
        const step = Math.max(0, Math.min(0.25, Number(dt) || 0));
        let move = speed * step;
        state.moving = false;
        // Walk the path: arrive at each point in turn; a large step may cross several of them.
        let guard = 0;
        while (move > 0 && state.point < path.length && guard++ < 256) {
            const [tx, ty] = path[state.point];
            const dx = tx - state.x, dy = ty - state.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 1e-6) { state.point += 1; continue; }
            state.dir = chaseFacing(dx, dy);
            if (move >= dist) {
                state.x = tx; state.y = ty;
                move -= dist;
                state.point += 1;
            } else {
                state.x += (dx / dist) * move;
                state.y += (dy / dist) * move;
                move = 0;
            }
            state.moving = true;
        }
        if (state.point >= path.length) state.moving = false;
        state.elapsed += step;
        state.distance = Math.hypot((Number(playerX) || 0) - state.x, (Number(playerY) || 0) - state.y);
        const out = state.distance > lose;
        state.outFor = out ? state.outFor + 1 : 0;
        state.warn = out || state.distance > lose * WARN_AT;
        // A gap that holds for a whole second is lost, whatever the path is doing: the chase is over, the words after it
        // must not claim a success. A stumble back inside `lose` before then clears the count, so clipping a wall once is
        // survivable.
        if (state.outFor >= grace) {
            state.over = true;
            state.result = 1;
            return state;
        }
        if (state.point >= path.length) {
            state.over = true;
            state.result = state.distance <= lose ? 0 : 1;      // kept it to the end, or did not
            return state;
        }
        if (limit != null && state.elapsed * 60 >= limit) {
            state.over = true;
            state.result = state.distance <= lose ? 0 : 1;      // time called while still in reach
            return state;
        }
        return state;
    }

    return { state, tick, speed, lose, limit, grace, path, total };
}
