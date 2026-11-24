// web/world-globe-places.js -- which screen the World Globe zoom shows for each place, and where "you are here" goes on it.
// Pure (no DOM): the dev page web/world-globe.js, the pause MAP book (web/game/vars.js -> web/world-globe-book.js) and
// tests/world-globe-zoom.test.js use it with the game's own tables:
// - the place of a stage = status_ui.json screens.map.walker_map (walker stage -> {ps1, server, loc}); its marker record is
//   loc + 1 (web/menu/pure.ts mapMarkerRecord), the globe file's marker `loc`. (The globe files' own "maps" lists are guesses
//   and are not read.)
// - open air = web/map-open-air.ts isOpenAirMapName over the manifest name (the split the field's ambience uses).
// - links = the scene exits (web/assets/scenes/<map>.json): how many OTHER maps have an exit into a map.
// Main screen of a place: its open-air stage with the most links, ties to the lowest stage number; a place with no open-air
// stage (an inn, a mine, a station...) uses the same rule over all its stages.
// Your screen: the map you stand on when it is open air (dot = your position); indoors, the outdoor screen you came in from
// (the entry the field keeps, else the game's synthesized return door) with the dot at that door; else the only outdoor map
// the room's own exits lead to (dot at the exit's arrival point when all its rows agree); else your place's main screen, no dot.
import { isOpenAirMapName } from "./map-open-air.js";
import type { FramePoint, GlobeEntry, GlobeServer } from "./types/world-globe-map.js";
import type {
    GlobePlacesInput, HereScreen, PlaceExit, PlaceMapInfo, PlaceScenes, PlaceScreen, TargetScreen, WalkerMapRow,
} from "./types/world-globe-zoom.js";

const SERVERS: readonly GlobeServer[] = ["asuka", "amaterasu"];

/** the key of one place: server and marker record */
export const placeKey = (server: GlobeServer, record: number): string => `${server}:${record}`;

/** a walker map key ("350") -> its map id ("s350") */
const mapIdOf = (walkerKey: string): string => `s${walkerKey}`;
const stageNumber = (map: string): number => Number(map.replace(/\D/g, "")) || 0;

/** The place of a map (by the walker_map table), or null when the table has no row for it. */
export function placeOfMap(walker: Readonly<Record<string, WalkerMapRow>>, map: string): { server: GlobeServer; record: number } | null {
    const row = walker[String(stageNumber(map))];
    const server = row ? SERVERS[row.server] : undefined;
    return row && server ? { server, record: row.loc + 1 } : null;
}

/** How many other maps have an exit into each map (the game's synthesized return doors do not count). */
export function linkCounts(scenes: PlaceScenes): Map<string, number> {
    const from = new Map<string, Set<string>>();
    for (const [id, scene] of Object.entries(scenes)) {
        for (const e of scene?.exits ?? []) {
            const to = e.to;
            if (!to || to === id || e._entranceReturn) continue;
            let s = from.get(to);
            if (!s) { s = new Set(); from.set(to, s); }
            s.add(id);
        }
    }
    return new Map([...from].map(([k, s]) => [k, s.size]));
}

/** Every place's main screen (see the head of this file), by placeKey. Maps the manifest does not list are left out. */
export function placeScreens(walker: Readonly<Record<string, WalkerMapRow>>, maps: readonly PlaceMapInfo[], scenes: PlaceScenes): Map<string, PlaceScreen> {
    const byId = new Map(maps.map((m) => [m.id, m]));
    const links = linkCounts(scenes);
    const groups = new Map<string, { server: GlobeServer; record: number; stages: string[] }>();
    for (const k of Object.keys(walker)) {
        const map = mapIdOf(k), p = placeOfMap(walker, map);
        if (!p || !byId.has(map)) continue;
        const key = placeKey(p.server, p.record);
        const g = groups.get(key) ?? { ...p, stages: [] };
        g.stages.push(map);
        groups.set(key, g);
    }
    const out = new Map<string, PlaceScreen>();
    for (const [key, g] of groups) {
        const stages = [...g.stages].sort((a, b) => stageNumber(a) - stageNumber(b));
        const open = stages.filter((s) => isOpenAirMapName(byId.get(s)?.name ?? ""));
        const pool = open.length ? open : stages;
        let best = pool[0];
        for (const s of pool) if ((links.get(s) ?? 0) > (links.get(best ?? "") ?? 0)) best = s;
        const m = best === undefined ? undefined : byId.get(best);
        if (!m) continue;
        out.set(key, {
            key, server: g.server, record: g.record, map: m.id, w: m.width, h: m.height, stages,
            links: links.get(m.id) ?? 0, rule: open.length ? "open-air" : "no-open-air",
        });
    }
    return out;
}

/** What hereScreen needs about where you are. */
export interface HereFacts {
  /** your place (server + record from the disc's stage table), null = no globe place */
  server: GlobeServer | null;
  record: number;
  /** the map you stand on, your position on it (native px) and the kept entry (see GlobeHereInput) */
  map: string;
  pos: FramePoint | null;
  entry: GlobeEntry | null;
}

const isOpen = (byId: ReadonlyMap<string, PlaceMapInfo>, map: string): boolean => isOpenAirMapName(byId.get(map)?.name ?? "");

/** Your screen on the globe and the dot on it (see the head of this file); null when you have no globe place. */
export function hereScreen(here: HereFacts, walker: Readonly<Record<string, WalkerMapRow>>, maps: readonly PlaceMapInfo[],
    scenes: PlaceScenes, screens: ReadonlyMap<string, PlaceScreen>): HereScreen | null {
    if (!here.server) return null;
    const key = placeKey(here.server, here.record);
    const byId = new Map(maps.map((m) => [m.id, m]));
    /** a map of your own place that is open air, else null */
    const ownOutdoor = (map: string): PlaceMapInfo | null => {
        const p = placeOfMap(walker, map), m = byId.get(map);
        return m && p && placeKey(p.server, p.record) === key && isOpen(byId, map) ? m : null;
    };
    const make = (m: PlaceMapInfo, spot: FramePoint | null, how: HereScreen["how"]): HereScreen => ({ key, map: m.id, w: m.width, h: m.height, spot, how });
    const inPicture = (m: PlaceMapInfo, p: FramePoint | null): FramePoint | null =>
        p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= m.width && p.y <= m.height ? { x: p.x, y: p.y } : null;
    // outdoors: the screen you stand on
    const cur = ownOutdoor(here.map);
    if (cur) return make(cur, inPicture(cur, here.pos), "current");
    // indoors: the outdoor screen you came in from (the field's kept entry)
    const kept = here.entry ? ownOutdoor(here.entry.from) : null;
    if (kept && here.entry) return make(kept, inPicture(kept, { x: here.entry.x, y: here.entry.y }), "entered");
    const exits = scenes[here.map]?.exits ?? [];
    // the game's synthesized return door: its target and arrival point are where you stood when you walked in
    for (const e of exits) {
        const m = e._entranceReturn && e.to ? ownOutdoor(e.to) : null;
        if (m) return make(m, inPicture(m, spawnOf(e)), "entered");
    }
    // the room's own exits: one outdoor map of your place -> that map; the dot only when every row arrives at one point
    const outs = exits.filter((e) => !e._entranceReturn && e.to && ownOutdoor(e.to));
    const targets = new Set(outs.map((e) => e.to));
    if (targets.size === 1) {
        const first = outs[0], m = first?.to ? ownOutdoor(first.to) : null;
        if (m && first) {
            const s = spawnOf(first);
            const same = s !== null && outs.every((e) => { const q = spawnOf(e); return q !== null && Math.hypot(q.x - s.x, q.y - s.y) < 1; });
            return make(m, same ? inPicture(m, s) : null, "door");
        }
    }
    // nothing known: your place's main screen, no dot
    const main = screens.get(key), mm = main ? byId.get(main.map) : undefined;
    return mm ? make(mm, null, "main") : null;
}

/** Everything the zoom knows about the places, from the game's tables and where you are. */
export function globePlaces(walker: Readonly<Record<string, WalkerMapRow>>, maps: readonly PlaceMapInfo[], scenes: PlaceScenes, here: HereFacts | null): GlobePlacesInput {
    const screens = placeScreens(walker, maps, scenes);
    return { screens, here: here ? hereScreen(here, walker, maps, scenes, screens) : null };
}

/** The screen a zoom target shows: yours (with the dot) when it is your place, else the place's main screen; null = none. */
export function screenForTarget(key: string, places: GlobePlacesInput): TargetScreen | null {
    const h = places.here;
    if (h && h.key === key) return { map: h.map, w: h.w, h: h.h, spot: h.spot, mine: true };
    const m = places.screens.get(key);
    return m ? { map: m.map, w: m.w, h: m.h, spot: null, mine: false } : null;
}

const spawnOf = (e: PlaceExit): FramePoint | null =>
    typeof e.spawnX === "number" && typeof e.spawnY === "number" ? { x: e.spawnX, y: e.spawnY } : null;

/** The field keeps the outdoor screen you came in from while you are indoors: leaving an open-air map into a room keeps where
 *  you stood (the door); room to room keeps it; arriving on an open-air map drops it. */
export function nextGlobeEntry(prev: GlobeEntry | null, from: string, to: string, pos: FramePoint, isOpenAir: (map: string) => boolean): GlobeEntry | null {
    if (isOpenAir(to)) return null;
    if (isOpenAir(from)) return { from, x: pos.x, y: pos.y };
    return prev;
}

// ETS item 42: status_ui.json and manifest.json come from outside: checked here before the tables above read them.
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** status_ui.json -> screens.map.walker_map (rows that are not {ps1, server, loc} numbers are dropped) */
export function parseWalkerMap(ui: unknown): Record<string, WalkerMapRow> {
    const screens = isRec(ui) ? ui["screens"] : undefined;
    const map = isRec(screens) ? screens["map"] : undefined;
    const wm = isRec(map) ? map["walker_map"] : undefined;
    const out: Record<string, WalkerMapRow> = {};
    if (!isRec(wm)) return out;
    for (const [k, v] of Object.entries(wm)) {
        if (!isRec(v)) continue;
        const ps1 = v["ps1"], server = v["server"], loc = v["loc"];
        if (typeof ps1 === "number" && typeof server === "number" && typeof loc === "number") out[k] = { ps1, server, loc };
    }
    return out;
}

/** manifest.json maps (or the game's state.manifest.maps) -> the id / name / size the places table reads */
export function parsePlaceMaps(maps: unknown): PlaceMapInfo[] {
    if (!Array.isArray(maps)) return [];
    const out: PlaceMapInfo[] = [];
    for (const m of maps) {
        if (!isRec(m)) continue;
        const id = m["id"], name = m["name"], width = m["width"], height = m["height"];
        if (typeof id === "string" && typeof name === "string" && typeof width === "number" && typeof height === "number") out.push({ id, name, width, height });
    }
    return out;
}

/** scenes (the game's state.scenes, or the files) -> the exits the places table reads */
export function parsePlaceScenes(scenes: unknown): Record<string, { exits: PlaceExit[] }> {
    const out: Record<string, { exits: PlaceExit[] }> = {};
    if (!isRec(scenes)) return out;
    for (const [id, s] of Object.entries(scenes)) {
        const ex = isRec(s) ? s["exits"] : undefined;
        const exits: PlaceExit[] = [];
        if (Array.isArray(ex)) {
            for (const e of ex) {
                if (!isRec(e)) continue;
                const to = e["to"], sx = e["spawnX"], sy = e["spawnY"];
                exits.push({
                    to: typeof to === "string" ? to : null,
                    spawnX: typeof sx === "number" ? sx : null, spawnY: typeof sy === "number" ? sy : null,
                    _entranceReturn: e["_entranceReturn"] === true,
                });
            }
        }
        out[id] = { exits };
    }
    return out;
}
