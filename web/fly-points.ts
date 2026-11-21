// web/fly-points.js -- the places your partner can fly you to (the pause list's FLY row, quest zz_fly). Pure: no DOM, no window.
//
// Rules (lore: the Digi-Egg of Love, Hawkmon -> Halsemon, carries two on the wind):
//   * Only the maps in FLY_POINTS: towns and open-air hubs reached on foot. Never a dungeon, an interior, or any map that
//     only a dig or a swim reaches (the West and North Sectors, Duel Island, the sea): those roads stay the player's to dig and swim.
//     Every point is one stage id, but the world holds copies of each place (normal / Amaterasu / the s9xx finale world: same size,
//     same exit rectangles). On foot a door never leaves its own world, so the world you stand in decides the copy: flyCopyFor.
//   * A point is offered once the player has walked into any copy of it (the same flag the MAP page reads).
//   * Flight starts only from open air, with a free field (no battle, cutscene, quest scene, dive form, wipe or story hand-off).
//   * You arrive by the game's own map change (web/game.js flyTo -> runStageHandoff scripted:true), the party gathers on you.
// tests/fly-points.test.js holds every rule; the fly points are listed once, here.

import { isOpenAirMapName } from "./map-open-air.js";

/** The quest that gives the flight (data/authored/quests/pack_zz_fly.py). */
export const FLY_QUEST = "zz_fly";

/** Stage ids that may be flown to, in the order the list shows them. */
export const FLY_POINTS = Object.freeze(["s200", "s201", "s330", "s420"]);

/** The pause list row. */
/** A map record as the fly rules read it: its stage id, its name, and the size the twin signature compares. */
export interface FlyMap { id: string; name?: string; width?: number; height?: number }
/** A scene exit: the rectangle it covers, and the map it leads to. */
export interface FlyExit { x?: number; y?: number; w?: number; h?: number; to?: string; _entranceReturn?: boolean }
/** The scenes table (web/assets/scenes.json) as the fly rules read it: a map id's exits. */
export type FlyScenes = Record<string, { exits?: FlyExit[] }>;

/** A place the partner can fly to: the stage id the game warps to, and the label the list shows. */
export interface FlyPlace { id: string; label: string }

export const FLY_ROW_LABEL = "FLY";

export const NO_AIR_LINE = "No room to take flight in here.";
export const NO_FREE_LINE = "Not now.";
export const NO_PLACE_LINE = "No place to fly to yet. Walk somewhere first.";

/** "Central Sector — Asuka City" -> "Asuka City". */
export function flyLabel(name: string | undefined) {
    const s = String(name ?? "");
    const i = s.indexOf(" — ");
    return (i > 0 ? s.slice(i + 3) : s).trim();
}

/**
 * The copies of every place: maps with the same size and the same exit rectangles (the normal world, its Amaterasu twin, the s9xx
 * finale twin), each group sorted by map id. Map<id, string[]>; a map with no twin is absent. Pure; cached per `scenes` object.
 */
const twinCache = new WeakMap();
export function mapTwins(maps, scenes) {
    const hit = scenes && typeof scenes === "object" ? twinCache.get(scenes) : null;
    if (hit && hit.maps === maps) return hit.groups;
    const bySig = new Map();
    for (const m of maps ?? []) {
        const ex = (scenes?.[m.id]?.exits ?? []).filter((e) => !e._entranceReturn);
        if (!ex.length) continue;
        const sig = `${m.width}x${m.height}|` + ex.map((e) => [e.x, e.y, e.w, e.h].join(",")).sort().join(";");
        if (!bySig.has(sig)) bySig.set(sig, []);
        bySig.get(sig).push(m.id);
    }
    const groups = new Map();
    const num = (id) => Number(String(id).replace(/\D/g, ""));
    for (const ids of bySig.values()) {
        if (ids.length < 2) continue;
        ids.sort((a, b) => num(a) - num(b));
        for (const id of ids) groups.set(id, ids);
    }
    if (scenes && typeof scenes === "object") twinCache.set(scenes, { maps, groups });
    return groups;
}

/** The worlds: the normal one, its Amaterasu copy, the s9xx finale copy (index = world number). */
export const WORLDS = Object.freeze(["normal", "amaterasu", "s9xx"]);
const idNum = (id) => Number(String(id).replace(/\D/g, ""));

/** The world of a map from its twin group alone: s9xx ids = the finale world, the others take their rank by id (0 normal, 1 Amaterasu). */
function rankWorld(group, id) {
    if (idNum(id) >= 900) return 2;
    const r = group.filter((x) => idNum(x) < 900).indexOf(id);
    return r >= 0 && r < 2 ? r : -1;
}

/**
 * Which world every OPEN-AIR map is in: Map<id, 0|1|2> (index into WORLDS). A twinned map takes its rank in its twin group. A map with
 * no twin (Ether Jungle, the s9xx Plug Cape...) takes the world its open-air neighbours (exits in or out) are in, when they all agree,
 * repeated until nothing changes. A map with no such neighbour (Kusanagi Street Corner) stays out: world unknown.
 * Underground / dig maps are not followed (they join the worlds). Pure; cached per `scenes` object.
 */
const worldCache = new WeakMap();
export function mapWorlds(maps: FlyMap[], scenes: FlyScenes | null) {
    const hit = scenes && typeof scenes === "object" ? worldCache.get(scenes) : null;
    if (hit && hit.maps === maps) return hit.worlds;
    const twins = mapTwins(maps, scenes);
    const air = new Set((maps ?? []).filter((m) => isOpenAirMapName(m.name)).map((m) => m.id));
    const worlds = new Map();
    for (const id of air) {
        const g = twins.get(id);
        const w = g ? rankWorld(g, id) : -1;
        if (w >= 0) worlds.set(id, w);
    }
    const adj = new Map();
    const link = (a: string, b: string) => { if (air.has(a) && air.has(b)) { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); } };
    for (const [from, sc] of Object.entries(scenes ?? {})) for (const e of sc?.exits ?? []) if (e?.to) { link(from, e.to); link(e.to, from); }
    for (let changed = true; changed;) {
        changed = false;
        for (const id of air) {
            if (worlds.has(id)) continue;
            const ws = new Set([...(adj.get(id) ?? [])].filter((n) => worlds.has(n)).map((n) => worlds.get(n)));
            if (ws.size === 1) { worlds.set(id, [...ws][0]); changed = true; }
        }
    }
    if (scenes && typeof scenes === "object") worldCache.set(scenes, { maps, worlds });
    return worlds;
}

/**
 * Which copy of fly point `id` a door from `currentId` leads to on foot: the copy in the same world as the map you stand on.
 * { id } or { why }: "world-unknown" (the map you stand on has no known world), "no-copy" (that world holds no copy of the point).
 * Never a guess.
 */
export function flyCopyFor({ maps, scenes, currentId, id }) {
    const w = mapWorlds(maps, scenes).get(currentId);
    if (w === undefined) return { why: "world-unknown" };
    const g = mapTwins(maps, scenes).get(id);
    const copy = g ? g.find((x) => rankWorld(g, x) === w) : null;
    return copy ? { id: copy } : { why: "no-copy" };
}

/** Every copy of a fly point (just itself when it has no twin). */
export const flyCopiesOf = (maps, scenes, id) => mapTwins(maps, scenes).get(id) ?? [id];

/**
 * The visited fly points, in FLY_POINTS order, except the place you stand on (any of its copies): [{ id, label }].
 * `maps` = the manifest maps ({ id, name }); `seen(id)` = "have I walked into this map"; a point counts as visited when any of its
 * copies was. With `scenes`, a point whose copy cannot be resolved from where you stand is left out, and the label is the copy's.
 */
/** What the fly list is computed from: the maps, which copies were seen, where you stand, the points, and the scenes. */
interface FlyPlacesArgs {
    maps?: FlyMap[];
    seen?: (id: string) => boolean;
    currentId?: string | null;
    points?: readonly string[];
    scenes?: FlyScenes | null;
}
export function flyPlaces({ maps = [], seen = () => false, currentId = null, points = FLY_POINTS, scenes = null }: FlyPlacesArgs = {}) {
    const byId = new Map<string, FlyMap>(maps.map((m) => [m.id, m] as [string, FlyMap]));
    const out = [], used = new Set();
    for (const id of points) {
        let m = byId.get(id);
        const copies = scenes ? flyCopiesOf(maps, scenes, id) : [id];
        if (!m || copies.includes(currentId) || !copies.some((c) => seen(c))) continue;
        if (scenes) {
            const c = flyCopyFor({ maps, scenes, currentId, id });
            if (c.why) continue;
            if (used.has(c.id)) continue;   // s200 and s201 are one place seen from two worlds: listed once
            used.add(c.id);
            m = byId.get(c.id) ?? m;
        }
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
export function createFlyModel(places: FlyPlace[]) {
    let at = 0;
    return {
        count: () => places.length,
        places: () => places,
        index: () => at,
        current: () => places[at] ?? null,
        move(delta: number) { if (places.length < 2) return false; at = (at + delta + places.length) % places.length; return true; },
    };
}
