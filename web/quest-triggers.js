// Walk-in quest triggers: a quest scene that starts because the player stepped into a patch of ground — or walked into
// a place at the right beat.
//
// The shape is the original field VM's own. Every `wstag` stage carries a type-7 trigger grid; the step programs index it
// (`step_idx = zonecheck(type=7, x, y) & 0x1f`) and fire the matching op-8 `start_event` cutscene step. All 42 op-8 steps
// across 30 stages are flag-gated (docs/research/scripting/field-script-engine-verified.md:835-836, :864), so a walk-in
// event is always "this ground, while this gate says so", never "anywhere, always". This module gives the extra quests
// the same shape with authored rectangles instead of a decoded grid:
//
//   { "id": "gt_bridge_cipher",              // one per trigger; the fired mark is kept by this id
//     "map": "s205",                         // the stage id of the map it sits on
//     "rect": [x, y, w, h],                  // world pixels; the player's feet point
//     "once": true,                          // default true: a seen scene does not replay on the next walk-in
//     "when": { "quest": "f_two_sides_bridge", "status": "active" },   // optional gate on the quest layer's own status
//     "scene": [ ... ] }                     // steps in web/quest-scenes.js's vocabulary
//
// Enter-only, like the game's own zone check: the previous tick must be OUTSIDE the rectangle and the current one INSIDE.
// A scene that could not run (game busy, an actor not on the map) returns null from game.js: the trigger stays armed and
// nothing is written.
//
// An ARRIVAL row is the same record with `"on": "enter"` and NO rectangle. Its condition is the map load itself: the
// first field tick of a place (the tick with no previous spot, which web/quests.js passes on a map change). That is the
// disc's own commonest scene shape — a place's entry gate object asks its candidate chain once per field load and
// starts at most one event (engine/systems/scene-arrival.ts; docs/research/scripting/field-script-engine-verified.md:
// 1473-1512, the reset band runs once per field load):
//
//   { "id": "gt_asuka_gate", "map": "s330", "on": "enter",
//     "when": { "quest": "f_two_sides_bridge", "status": "active" }, "scene": [ ... ] }
//
// The arrival arm is tested after the game's own arrival chain (the runner is ticked after setMap), it waits for the
// first idle tick if the game is busy, and then decides ONCE for that load: one scene, or nothing.
//
// Everything is OFF unless F2 -> Extras -> Quest triggers is on AND F2 -> Extras -> Quests is on.

/** The four statuses of a quest as the layer reports them (web/quests.js statusOf); "locked" is not a gate a trigger may name. */
export const TRIGGER_STATUSES = ["available", "active", "ready", "done"];

const inRect = (r, x, y) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
const read = (v) => (typeof v === "function" ? v() : v);

/**
 * The pure decision: which trigger (if any) the player just walked into. No side effects, no game and no DOM: the caller
 * passes the two places, the quest state and a small context. Only the current map's few rectangles are tested, and the
 * context is asked nothing about a trigger that is not on this map (the runner even keeps a per-map list).
 *
 * @param triggers  authored triggers (the full list is fine; other maps are skipped before anything else is read)
 * @param mapId     the stage id the player is on
 * @param prev      {x, y} the previous tick's feet point, or null when the player just arrived on this map
 * @param now       {x, y} this tick's feet point
 * @param state     the quest layer's own store (state.triggers[id] holds a fired mark)
 * @param ctx       { enabled(), statusOf(id), idle(), dialogBusy, battle } — read-only questions
 * @returns the trigger to play, or null
 */
export function enterTrigger(triggers, mapId, prev, now, state, ctx) {
    if (!read(ctx?.enabled)) return null;                        // the F2 switch: read before anything else
    if (!Array.isArray(triggers) || !mapId || !prev || !now) return null;
    if (!Number.isFinite(prev.x) || !Number.isFinite(prev.y) || !Number.isFinite(now.x) || !Number.isFinite(now.y)) return null;
    if (!read(ctx.idle)) return null;                            // a battle, a cutscene, a menu, a fade
    if (read(ctx.dialogBusy)) return null;                       // one of this layer's own conversations
    if (read(ctx.battle)) return null;                           // a quest fight it started
    for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        if (!t || t.map !== mapId) continue;                     // only the handful this map has
        const rect = t.rect;
        if (!Array.isArray(rect) || rect.length !== 4) continue;  // a broken row is the checker's business, never a throw
        if (t.once !== false && state?.triggers?.[t.id]) continue; // seen once already
        const when = t.when;
        if (when) {
            if (!when.quest || !TRIGGER_STATUSES.includes(when.status)) continue;
            if (!ctx.statusOf || ctx.statusOf(when.quest) !== when.status) continue;
        }
        if (inRect(rect, prev.x, prev.y) || !inRect(rect, now.x, now.y)) continue;   // enter only
        return t;
    }
    return null;
}

/**
 * The arrival decision: which `on: "enter"` row (if any) this map load starts. The same record, the same gate and the
 * same runner as a walk-in trigger; only the condition is different — the map load is already known to have happened,
 * so there is no rectangle and no previous/current place. The disc's gate objects ask their chain once per field load
 * and start at most one event (engine/systems/scene-arrival.ts), which is the rule the runner around this one keeps.
 *
 * A rectangle on an arrival row is ignored here; the build-time checker refuses `on` together with `rect` as ambiguous.
 *
 * @param triggers  the map's authored triggers (other maps and rectangle-only rows are skipped)
 * @param mapId     the stage id that was just loaded
 * @param state     the quest layer's own store (state.triggers[id] holds a fired mark)
 * @param ctx       { enabled(), statusOf(id), idle(), dialogBusy, battle } — read-only questions
 * @returns the arrival row to play, or null
 */
export function arrivalTrigger(triggers, mapId, state, ctx) {
    if (!read(ctx?.enabled)) return null;                        // the F2 switch: read before anything else
    if (!Array.isArray(triggers) || !mapId) return null;
    if (!read(ctx.idle)) return null;                            // a battle, a cutscene, a menu, a fade
    if (read(ctx.dialogBusy)) return null;                       // one of this layer's own conversations
    if (read(ctx.battle)) return null;                           // a quest fight it started
    for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        if (!t || t.map !== mapId || t.on !== "enter") continue; // only this map's arrival rows
        if (!Array.isArray(t.scene) || !t.scene.length) continue;   // a broken row is the checker's business, never a throw
        if (t.once !== false && state?.triggers?.[t.id]) continue;  // seen once already
        const when = t.when;
        if (when) {
            if (!when.quest || !TRIGGER_STATUSES.includes(when.status)) continue;
            if (!ctx.statusOf || ctx.statusOf(when.quest) !== when.status) continue;
        }
        return t;
    }
    return null;
}

/**
 * The runtime: one runner for the whole quest layer. It indexes the authored triggers by map once, so a frame only ever
 * looks at the current map's few rows (no grid scan, no allocation); a player who just changed map has no previous spot
 * on the new one, so no walk-in rectangle fires from walking through a warp — that first tick is the arrival rows' own
 * condition instead.
 *
 * ctx = { enabled(), statusOf(id), idle(), dialogBusy, battle, state(), playScene(scene), save(), warn(msg) }
 * `tick` returns a promise only when a scene was started, so the caller can ignore it in the frame loop.
 */
export function installTriggers(triggers, ctx = {}) {
    const byMap = new Map();
    for (const t of Array.isArray(triggers) ? triggers : []) {
        if (!t || typeof t.id !== "string" || typeof t.map !== "string") continue;
        let list = byMap.get(t.map);
        if (!list) byMap.set(t.map, (list = []));
        list.push(t);
    }
    const prevAt = { x: 0, y: 0 }, nowAt = { x: 0, y: 0 };   // one pair, refilled: a frame allocates nothing
    let playing = false;                                     // a scene is running: no second trigger on top of it
    let arrivalMap = null;                                   // a fresh field load whose on:"enter" rows are still to be asked
    /** Start one trigger's scene and, when it really ran, keep its fired mark. Both arms end here. */
    function fire(t) {
        playing = true;
        let p;
        try { p = ctx.playScene ? ctx.playScene(t.scene) : null; }
        catch (e) { playing = false; ctx.warn?.(`[quest triggers] scene "${t.id}" failed to start: ${e}`); return null; }
        return Promise.resolve(p).then((result) => {
            if (!result) return null;                        // busy or an actor missing: still armed, no mark
            const st = read(ctx.state);                      // read again: a reset during the scene replaces the store
            if (st?.triggers) {
                st.triggers[t.id] = Date.now();
                if (ctx.save) ctx.save();                    // one save, after the scene really ran
            }
            return result;
        }).catch((e) => {
            ctx.warn?.(`[quest triggers] scene "${t.id}" failed: ${e}`);
            return null;
        }).finally(() => { playing = false; });
    }
    const busy = () => !read(ctx.idle) || !!read(ctx.dialogBusy) || !!read(ctx.battle);
    return {
        /** One field frame. prevX/prevY are null when the player has just arrived on this map. */
        tick(mapId, prevX, prevY, nowX, nowY) {
            if (!read(ctx.enabled)) return null;             // off: no state read, no rectangle, no scene
            if (!mapId) return null;
            // Arrival rows come first: a map load is their condition, and a fresh load must not be skipped by the
            // walk-in arm's own "no previous spot" return below. The load is armed by the tick with no previous place
            // (web/quests.js passes null on a map change). It stays armed while the game is busy — the game's own
            // arrival chain, a menu, a quest scene — and is decided ONCE for that load: one scene, or nothing. The next
            // map change drops it (and arms its own).
            if (prevX == null || prevY == null) arrivalMap = mapId;
            else if (arrivalMap !== mapId) arrivalMap = null;
            if (arrivalMap === mapId && !playing) {
                const list = byMap.get(mapId);
                if (!list || !list.length) {
                    arrivalMap = null;                       // nothing authored here: this load is decided
                } else {
                    const t = arrivalTrigger(list, mapId, read(ctx.state), ctx);
                    if (t) {
                        arrivalMap = null;                   // one arrival scene per field load
                        return fire(t);
                    }
                    if (busy()) return null;                 // still armed: try again when idle
                    arrivalMap = null;                       // asked while idle and nothing passed: decided once
                }
            }
            if (playing || prevX == null || prevY == null) return null;
            if (!Number.isFinite(prevX) || !Number.isFinite(prevY) || !Number.isFinite(nowX) || !Number.isFinite(nowY)) return null;
            const list = byMap.get(mapId);
            if (!list || !list.length) return null;
            prevAt.x = prevX; prevAt.y = prevY; nowAt.x = nowX; nowAt.y = nowY;
            const t = enterTrigger(list, mapId, prevAt, nowAt, read(ctx.state), ctx);
            if (!t || !Array.isArray(t.scene) || !t.scene.length) return null;
            return fire(t);
        },
        /** How many authored triggers sit on a map (the quest lab and tests use it; the field does not). */
        count(mapId) { const list = byMap.get(mapId); return list ? list.length : 0; },
        /** Every trigger, grouped by map (read only). */
        byMap: () => byMap,
    };
}
