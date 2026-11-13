// web/fly-points.js -- the places your partner can fly you to (the pause list's FLY row, quest zz_fly). Pure: no DOM, no window.
//
// Rules (lore: the Digi-Egg of Love, Hawkmon -> Halsemon, carries two on the wind):
//   * Only the maps in FLY_POINTS: towns and open-air hubs reached on foot. Never a dungeon, an interior, or any map that
//     only a dig or a swim reaches (the West and North Sectors, Duel Island, the sea): those roads stay the player's to dig and swim.
//     Every point is exactly one stage id; the Asuka / Amaterasu copies of a later chapter are not listed.
//   * A point is offered only after the player has walked into that very map (the same flag the MAP page reads).
//   * Flight starts only from open air, with a free field (no battle, cutscene, quest scene, dive form, wipe or story hand-off).
//   * You arrive by the game's own map change (web/game.js flyTo -> runStageHandoff scripted:true), the party gathers on you.
// tests/fly-points.test.js holds every rule; the fly points are listed once, here.

/** The quest that gives the flight (data/authored/quests/pack_zz_fly.py). */
export const FLY_QUEST = "zz_fly";

/** Stage ids that may be flown to, in the order the list shows them. */
export const FLY_POINTS = Object.freeze(["s200", "s201", "s330", "s420"]);

/** The pause list row. */
export const FLY_ROW_LABEL = "FLY";

export const NO_AIR_LINE = "No room to take flight in here.";
export const NO_FREE_LINE = "Not now.";
export const NO_PLACE_LINE = "No place to fly to yet. Walk somewhere first.";

/** "Central Sector — Asuka City" -> "Asuka City". */
export function flyLabel(name) {
    const s = String(name ?? "");
    const i = s.indexOf(" — ");
    return (i > 0 ? s.slice(i + 3) : s).trim();
}

/**
 * The visited fly points, in FLY_POINTS order, except the map you stand on: [{ id, label }].
 * `maps` = the manifest maps ({ id, name }); `seen(id)` = "have I walked into this map".
 */
export function flyPlaces({ maps = [], seen = () => false, currentId = null, points = FLY_POINTS } = {}) {
    const byId = new Map(maps.map((m) => [m.id, m]));
    const out = [];
    for (const id of points) {
        const m = byId.get(id);
        if (!m || id === currentId || !seen(id)) continue;
        out.push({ id, label: flyLabel(m.name) });
    }
    return out;
}

/**
 * Where the game puts you when you walk into `id`: the spawn of the first (lowest map id) exit of any scene that leads there.
 * { x, y, dir } or null when no scene leads there with a spawn.
 */
export function arrivalSpot(scenes, id) {
    for (const from of Object.keys(scenes ?? {}).sort()) {
        for (const e of scenes[from]?.exits ?? []) {
            if (e?.to === id && Number.isFinite(e.spawnX) && Number.isFinite(e.spawnY)) {
                return { x: e.spawnX, y: e.spawnY, dir: typeof e.dir === "string" ? e.dir : "down" };
            }
        }
    }
    return null;
}

/**
 * May the flight start now? `openAir` = the map you stand on is open air; `free` = the field is free of every lock.
 * Returns null when yes, else the line to say.
 */
export function flyBlock({ openAir, free }) {
    if (!free) return NO_FREE_LINE;
    if (!openAir) return NO_AIR_LINE;
    return null;
}

/** Cursor over a list of places: up / down wrap. */
export function createFlyModel(places) {
    let at = 0;
    return {
        count: () => places.length,
        places: () => places,
        index: () => at,
        current: () => places[at] ?? null,
        move(delta) { if (places.length < 2) return false; at = (at + delta + places.length) % places.length; return true; },
    };
}
