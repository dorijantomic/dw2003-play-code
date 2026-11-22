// web/world-globe-layout.js -- the layout maths of web/world-globe.html. Pure: no DOM, no window, no three.js.
//
// Stitches every open-air field map into ONE flat world, from the scenes' own exits:
//  * A "place" is one real spot. Day/night/event copies (map-variants.json) and renamed twins (same size and the same exit
//    rectangles, e.g. Asuka City / Amaterasu City) are one place; the base picture is drawn.
//  * For each exit A -> B the data gives two facts: the exit rectangle in A and the spawn point in B. The exit sits on one edge
//    of A (so B lies on that side of A); the spawn sits on one edge of B (so A lies on the opposite side of B). The fact nearest
//    its edge (smallest distance / map size) decides the side. B is then put flush against that side of A, shifted along the
//    edge so the exit point and the spawn point meet.
//  * Places grow out of a root like Prim's tree: the most edge-like link first. A candidate that would overlap a placed map is
//    slid along the shared edge (still touching), else tried from another placed neighbour, else pushed outward (not adjacent).
//  * Linked groups that no open-air exit joins (Central+East, South, West, North, Duel Island, Kusanagi) are put on the side
//    their sector name says (Central / East / West / South / North) of the main group, pushed outward until clear.
//  * Interior maps (every map that is not open air) are not drawn; each one that a place leads to (breadth first through
//    interior maps) becomes part of a small pin on that place, at the door / spawn point.
import { regionOf, buildGraph } from "./map-screen-model.js";
import { isOpenAirMapName } from "./map-open-air.js";

export const OVERLAP_TOL = 8;      // px: two maps overlap only when they cross by more than this on BOTH axes
export const ADJ_TOL = 16;         // px: "touching" when the gap on one axis is at most this and they share some edge on the other
const SLIDE_STEP = 32;
const PLACE_TOL = 4;               // strict tolerance while placing (the test tolerance is looser)
const COMPONENT_GAP = 96;
const PIN_MERGE = 24;

const OPP = { E: "W", W: "E", N: "S", S: "N" };
const horiz = (d: string) => d === "E" || d === "W";

/** A rectangle in map or world pixels. */
interface Rect { x: number; y: number; w: number; h: number }
/** One open-air map row from the manifest. */
interface MapRow { id: string | number; name: string; width: number; height: number; image?: string }
/** One exit of a scene (the rectangle in the map, the spawn point in the target). */
interface ExitRow { to: string; x: number; y: number; w: number; h: number; spawnX: number; spawnY: number }
interface SceneMap { exits?: ExitRow[] }
type Scenes = Record<string, SceneMap | undefined>;
/** One oriented relation candidate (see collectRelations). */
interface Cand { dir: string; score: number; ax: number; ay: number; bx: number; by: number }
/** A place: one real spot, drawn as its base picture. */
interface Place { key: string; id: string | number; ids: (string | number)[]; name: string; names: string[]; region: string; w: number; h: number; image?: string; x?: number; y?: number; comp?: number; adjacent?: boolean }
type MapId = string | number;

/** Nearest edge of a w x h map to the point, with distance / size (0 = on the edge). */
export function nearestSide(x: number, y: number, w: number, h: number) {
    const c: [string, number][] = [["W", x / w], ["E", (w - x) / w], ["N", y / h], ["S", (h - y) / h]];
    c.sort((a, b) => a[1] - b[1]);
    return { side: c[0]![0], score: Math.max(0, c[0]![1]) };
}

export function overlapDepth(a: Rect, b: Rect) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return { ox, oy };
}
export function overlaps(a: Rect, b: Rect, tol = OVERLAP_TOL) {
    const { ox, oy } = overlapDepth(a, b);
    return ox > tol && oy > tol;
}
export function adjacent(a: Rect, b: Rect, tol = ADJ_TOL) {
    const { ox, oy } = overlapDepth(a, b);
    // ox < 0 = gap on x; touching when the gap is small and they overlap on y (and vice versa)
    return (-ox <= tol && oy > 0) || (-oy <= tol && ox > 0);
}

function idNum(id) { const n = parseInt(String(id).replace(/\D+/g, ""), 10); return Number.isFinite(n) ? n : 1e9; }

/**
 * Places from the manifest: { places: [{ key, id, ids, name, names, region, w, h }], memberOf: Map(mapId -> key) }.
 * `id` is the picture shown (lowest-numbered map of the place that is not a variant).
 */
export function buildPlaces(maps, scenes, variants = {}) {
    const open = maps.filter((m) => isOpenAirMapName(m.name));
    // Union-find over open maps. Two maps are one place when (1) same size and exactly the same exit rectangles (renamed twins:
    // Asuka / Amaterasu City, the chapter-2 copies), or (2) map-variants.json pairs them, they share name and size, and every exit
    // of the one has an exit of the other within 64 px (day / night / event versions). The variants file alone is not enough:
    // it also pairs maps that are really different spots (s203 -> s219).
    const parent = new Map(open.map((m) => [m.id, m.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
    const exitsOf = (id: string | number): any[] => scenes?.[id]?.exits ?? [];
    const bySig = new Map();
    for (const m of open) {
        const ex = exitsOf(m.id);
        if (!ex.length) continue;
        const sig = `${m.width}x${m.height}|` + ex.map((e) => [e.x, e.y, e.w, e.h].join(",")).sort().join(";");
        if (bySig.has(sig)) union(bySig.get(sig), m.id); else bySig.set(sig, m.id);
    }
    const near = (ea, eb) => ea.every((x: { x: number; w: number; y: number; h: number; }) => eb.some((y: { x: number; w: number; y: number; h: number; }) => Math.hypot(x.x + x.w / 2 - y.x - y.w / 2, x.y + x.h / 2 - y.y - y.h / 2) <= 64));
    const openById = new Map<any, any>(open.map((m) => [m.id, m]));
    for (const m of open) {
        const b = openById.get(variants[m.id]);
        if (!b || b.name !== m.name || b.width !== m.width || b.height !== m.height) continue;
        const ea = exitsOf(m.id), eb = exitsOf(b.id);
        if (ea.length && eb.length && (ea.length <= eb.length ? near(ea, eb) : near(eb, ea))) union(m.id, b.id);
    }
    const groups = new Map();
    for (const m of open) { const r = find(m.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); }
    const places = [], memberOf = new Map();
    for (const list of groups.values()) {
        const bases = list.filter((m: { id: string | number; }) => !variants[m.id]);
        const pick = (bases.length ? bases : list).slice().sort((a, b) => idNum(a.id) - idNum(b.id))[0];
        const names = [...new Set(list.map((m) => m.name))];
        const place = {
            key: pick.id, id: pick.id, ids: list.map((m) => m.id).sort((a, b) => idNum(a) - idNum(b)),
            name: pick.name, names, region: regionOf(pick.name), w: pick.width, h: pick.height, image: pick.image,
        };
        places.push(place);
        for (const m of list) memberOf.set(m.id, place.key);
    }
    places.sort((a, b) => idNum(a.id) - idNum(b.id));
    return { places, memberOf };
}

/** Candidate relations per ordered pair, oriented a -> b: { dir (where b lies from a), score, ax, ay (anchor in a), bx, by (anchor in b) }. */
function collectRelations(places, memberOf, scenes, byKey) {
    const rel = new Map();   // "a|b" -> [cand]
    const push = (a, b, c) => { const k = `${a}|${b}`; if (!rel.has(k)) rel.set(k, []); rel.get(k).push(c); };
    for (const p of places) {
        for (const id of p.ids) {
            for (const e of scenes?.[id]?.exits ?? []) {
                const tk = memberOf.get(e.to);
                if (!tk || tk === p.key) continue;
                if (!Number.isFinite(e.spawnX) || !Number.isFinite(e.spawnY)) continue;
                const q = byKey.get(tk);
                const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
                const fa = nearestSide(cx, cy, p.w, p.h);      // exit on edge fa.side of p => q lies on that side of p
                const fb = nearestSide(e.spawnX, e.spawnY, q.w, q.h); // spawn near edge fb.side of q => p lies there from q => q lies opposite from p
                const c1 = { dir: fa.side, score: fa.score, ax: cx, ay: cy, bx: e.spawnX, by: e.spawnY };
                const c2 = { dir: OPP[fb.side], score: fb.score, ax: cx, ay: cy, bx: e.spawnX, by: e.spawnY };
                for (const c of [c1, c2]) {
                    push(p.key, q.key, c);
                    push(q.key, p.key, { dir: OPP[c.dir], score: c.score, ax: c.bx, ay: c.by, bx: c.ax, by: c.ay });
                }
            }
        }
    }
    return rel;
}

function freeAt(rect: Rect, placed, ignore, tol: number | undefined) {
    for (const r of placed) if (r !== ignore && overlaps(rect, r, tol)) return false;
    return true;
}

/** Where q goes flush against p on side `dir`, exit/spawn anchors meeting. */
function flush(p, q, c) {
    switch (c.dir) {
        case "E": return { x: p.x + p.w, y: p.y + c.ay - c.by };
        case "W": return { x: p.x - q.w, y: p.y + c.ay - c.by };
        case "S": return { x: p.x + c.ax - c.bx, y: p.y + p.h };
        default: return { x: p.x + c.ax - c.bx, y: p.y - q.h };
    }
}

function tryPlace(p, q, cands, placed) {
    // cands sorted best first. Returns { x, y, adjacent } or null.
    for (const c of cands) {
        const base = flush(p, q, c);
        const hz = horiz(c.dir);
        const span = (hz ? p.h + q.h : p.w + q.w);
        for (let k = 0; k * SLIDE_STEP <= span; k++) {
            for (const sgn of k === 0 ? [1] : [1, -1]) {
                const off = k * SLIDE_STEP * sgn;
                const r = { x: base.x + (hz ? 0 : off), y: base.y + (hz ? off : 0), w: q.w, h: q.h };
                const ov = overlapDepth(r, p);
                // must still share a real stretch of the edge with p
                if ((hz ? ov.oy : ov.ox) < 64) continue;
                if (freeAt(r, placed, null, PLACE_TOL)) return { x: r.x, y: r.y, adjacent: true };
            }
        }
    }
    return null;
}

function pushOutward(q, from, dir: string, placed) {
    const r = { x: from.x, y: from.y, w: q.w, h: q.h };
    const dx = dir === "E" ? 1 : dir === "W" ? -1 : 0, dy = dir === "S" ? 1 : dir === "N" ? -1 : 0;
    for (let i = 0; i < 400 && !freeAt(r, placed, null, PLACE_TOL); i++) { r.x += dx * SLIDE_STEP; r.y += dy * SLIDE_STEP; }
    return { x: r.x, y: r.y };
}

function sectorDir(sector: string) {
    if (/^East/.test(sector)) return "E";
    if (/^West/.test(sector)) return "W";
    if (/^North/.test(sector)) return "N";
    if (/^South/.test(sector)) return "S";
    return null; // Central, Kusanagi, ...
}

/** Interior-map pins: [{ placeKey, x, y, ids, names }] in the place's own picture coordinates. */
function buildPins(maps, scenes, places, memberOf, byKey) {
    const graph = buildGraph(maps, scenes);
    const isInterior = (id) => !memberOf.has(id);
    const seeds = [];   // { placeKey, x, y, mapId }
    for (const p of places) {
        for (const id of p.ids) {
            for (const e of scenes?.[id]?.exits ?? []) {
                if (typeof e?.to === "string" && graph.nameOf(e.to) && isInterior(e.to) && Number.isFinite(e.x))
                    seeds.push({ placeKey: p.key, x: e.x + e.w / 2, y: e.y + e.h / 2, mapId: e.to });
            }
        }
    }
    const haveSeed = new Set(seeds.map((s) => s.mapId));
    for (const m of maps) {
        if (!isInterior(m.id) || haveSeed.has(m.id)) continue;
        for (const e of scenes?.[m.id]?.exits ?? []) {
            const tk = memberOf.get(e.to);
            if (tk && Number.isFinite(e.spawnX) && Number.isFinite(e.spawnY)) {
                seeds.push({ placeKey: tk, x: e.spawnX, y: e.spawnY, mapId: m.id });
                haveSeed.add(m.id);
                break;
            }
        }
    }
    // multi-source breadth first through interior maps: a deeper map joins the pin of the seed that reaches it first
    const owner = new Map();
    const queue = [];
    seeds.forEach((s, i) => { if (!owner.has(s.mapId)) { owner.set(s.mapId, i); queue.push(s.mapId); } });
    for (let qi = 0; qi < queue.length; qi++) {
        const id = queue[qi];
        for (const n of graph.neighbours(id)) if (isInterior(n) && !owner.has(n)) { owner.set(n, owner.get(id)); queue.push(n); }
    }
    const bySeed = new Map();
    for (const [id, i] of owner) { if (!bySeed.has(i)) bySeed.set(i, []); bySeed.get(i).push(id); }
    const pins = [];
    seeds.forEach((s, i) => {
        const ids = bySeed.get(i);
        if (!ids) return;
        const p = byKey.get(s.placeKey);
        const x = Math.min(p.w, Math.max(0, s.x)), y = Math.min(p.h, Math.max(0, s.y));
        const near = pins.find((q) => q.placeKey === s.placeKey && Math.hypot(q.x - x, q.y - y) <= PIN_MERGE);
        if (near) { for (const id of ids) if (!near.ids.includes(id)) near.ids.push(id); return; }
        pins.push({ placeKey: s.placeKey, x, y, ids: ids.slice() });
    });
    for (const pin of pins) pin.names = [...new Set(pin.ids.map((id) => graph.nameOf(id)))];
    const unreached = maps.filter((m) => isInterior(m.id) && !owner.has(m.id)).length;
    return { pins, unreached };
}

/**
 * The whole world. Returns { places: [{ key, id, ids, name, names, region, w, h, x, y, comp, adjacent }], pins: [{ placeKey, x, y, wx, wy,
 * ids, names }] (wx, wy = world position), bounds: { x, y, w, h }, links: [{ a, b, tree, adjacent }], components, stats }.
 */
export function buildWorld({ maps, scenes, variants = {} }) {
    const { places, memberOf } = buildPlaces(maps, scenes, variants);
    const byKey = new Map(places.map((p) => [p.key, p]));
    const rel = collectRelations(places, memberOf, scenes, byKey);
    const nbr = new Map(places.map((p) => [p.key, new Set()]));
    for (const k of rel.keys()) { const [a, b] = k.split("|"); nbr.get(a)!.add(b); }

    // connected components over open-air links
    const compOf = new Map(), comps = [];
    for (const p of places) {
        if (compOf.has(p.key)) continue;
        const members = [], st = [p.key];
        compOf.set(p.key, comps.length);
        while (st.length) { const k = st.pop(); members.push(k); for (const n of nbr.get(k)!) if (!compOf.has(n)) { compOf.set(n, comps.length); st.push(n); } }
        comps.push(members);
    }

    const compInfo = [];
    const treeEdges = new Set();
    comps.forEach((members, ci) => {
        members.sort((a, b) => nbr.get(b)!.size - nbr.get(a)!.size || idNum(a) - idNum(b));
        const root = byKey.get(members[0]);
        root!.x = 0; root!.y = 0; root!.comp = ci; root!.adjacent = true;
        const placed = [root];
        const done = new Set([root!.key]);
        while (done.size < members.length) {
            // best edge from a placed to an unplaced node
            let best = null;
            for (const pk of done) for (const qk of nbr.get(pk)!) {
                if (done.has(qk)) continue;
                const cands = rel.get(`${pk}|${qk}`).slice().sort((a: { score: number; }, b: { score: number; }) => a.score - b.score);
                if (!best || cands[0].score < best.score || (cands[0].score === best.score && idNum(qk) < idNum(best.qk))) best = { pk, qk, score: cands[0].score };
            }
            const q = byKey.get(best!.qk);
            // try the best-scoring placed neighbour first, then every other placed neighbour
            const order = [best!.pk, ...[...done].filter((k) => k !== best!.pk && nbr.get(k)!.has(best!.qk))];
            let res = null, from = null;
            for (const pk of order) {
                const cands = rel.get(`${pk}|${best!.qk}`).slice().sort((a: { score: number; }, b: { score: number; }) => a.score - b.score);
                res = tryPlace(byKey.get(pk), q, cands, placed);
                if (res) { from = pk; break; }
            }
            if (!res) {
                const pk = best!.pk, c = rel.get(`${pk}|${best!.qk}`).slice().sort((a: { score: number; }, b: { score: number; }) => a.score - b.score)[0];
                const p = byKey.get(pk);
                res = { ...pushOutward(q, flush(p, q, c), c.dir, placed), adjacent: false };
                from = pk;
            }
            q!.x = res.x; q!.y = res.y; q!.comp = ci; q!.adjacent = res.adjacent;
            treeEdges.add(from < best!.qk ? `${from}|${best!.qk}` : `${best!.qk}|${from}`);
            placed.push(q); done.add(q!.key);
        }
        const bx = Math.min(...placed.map((r) => r!.x)), by = Math.min(...placed.map((r) => r!.y));
        const bx2 = Math.max(...placed.map((r) => r!.x + r!.w)), by2 = Math.max(...placed.map((r) => r!.y + r!.h));
        const tally = new Map();
        for (const k of members) { const s = byKey.get(k)!.region; tally.set(s, (tally.get(s) ?? 0) + 1); }
        const top = [...tally].sort((a, b) => b[1] - a[1])[0]![0];
        compInfo.push({ index: ci, members, box: { x: bx, y: by, w: bx2 - bx, h: by2 - by }, sector: top, dir: sectorDir(top) });
    });

    // components: the biggest one (most places) is the main land; the rest go on the side their sector name says
    const orderC = compInfo.slice().sort((a, b) => b.members.length - a.members.length || a.index - b.index);
    const main = orderC[0];
    const moveComp = (c, dx: number, dy: number) => { for (const k of c.members) { const p = byKey.get(k); p!.x += dx; p!.y += dy; } c.box.x += dx; c.box.y += dy; };
    const compRects = (c) => c.members.map((k) => byKey.get(k));
    moveComp(main, -main.box.x, -main.box.y);
    const settled = [main];
    for (const c of orderC.slice(1)) {
        const dir = c.dir;
        const b = main.box;
        let tx, ty;
        if (dir === "E") { tx = b.x + b.w + COMPONENT_GAP; ty = b.y + (b.h - c.box.h) / 2; }
        else if (dir === "W") { tx = b.x - COMPONENT_GAP - c.box.w; ty = b.y + (b.h - c.box.h) / 2; }
        else if (dir === "S") { tx = b.x + (b.w - c.box.w) / 2; ty = b.y + b.h + COMPONENT_GAP; }
        else if (dir === "N") { tx = b.x + (b.w - c.box.w) / 2; ty = b.y - COMPONENT_GAP - c.box.h; }
        else { tx = b.x + b.w + COMPONENT_GAP; ty = b.y + b.h + COMPONENT_GAP; }  // no sector (Kusanagi City): bottom right corner
        moveComp(c, Math.round(tx - c.box.x), Math.round(ty - c.box.y));
        const clear = () => {
            const others = settled.flatMap(compRects);
            return compRects(c).every((r: Rect) => others.every((o) => !overlaps(r, { x: o.x - COMPONENT_GAP / 2, y: o.y - COMPONENT_GAP / 2, w: o.w + COMPONENT_GAP, h: o.h + COMPONENT_GAP }, 0)));
        };
        const ddx = dir === "E" || !dir ? 1 : dir === "W" ? -1 : 0, ddy = dir === "S" || !dir ? 1 : dir === "N" ? -1 : 0;
        for (let i = 0; i < 400 && !clear(); i++) moveComp(c, ddx * SLIDE_STEP, ddy * SLIDE_STEP);
        settled.push(c);
    }

    // shift everything to a non-negative corner, round to whole pixels
    const minX = Math.min(...places.map((p) => p.x)), minY = Math.min(...places.map((p) => p.y));
    for (const p of places) { p.x = Math.round(p.x - minX); p.y = Math.round(p.y - minY); }
    const bounds = { x: 0, y: 0, w: Math.max(...places.map((p) => p.x + p.w)), h: Math.max(...places.map((p) => p.y + p.h)) };

    // links (undirected) and their adjacency
    const links = [];
    const seenPair = new Set();
    for (const k of rel.keys()) {
        const [a, b] = k.split("|");
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        const [lo, hi] = key.split("|");
        links.push({ a: lo, b: hi, tree: treeEdges.has(key), adjacent: adjacent(byKey.get(lo)!, byKey.get(hi)) });
    }

    // pins
    const { pins, unreached } = buildPins(maps, scenes, places, memberOf, byKey);
    for (const pin of pins) { const p = byKey.get(pin.placeKey); pin.wx = p!.x + pin.x; pin.wy = p!.y + pin.y; }

    // overlaps
    let overlapCount = 0;
    for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) if (overlaps(places[i]!, places[j])) overlapCount++;

    const openMaps = maps.filter((m) => isOpenAirMapName(m.name)).length;
    return {
        places, pins, bounds, links, components: compInfo,
        stats: {
            openMaps, places: places.length, mapsPlaced: places.reduce((n, p) => n + p.ids.length, 0),
            overlaps: overlapCount, links: links.length, linksAdjacent: links.filter((l) => l.adjacent).length,
            treeEdges: links.filter((l) => l.tree).length, treeAdjacent: links.filter((l) => l.tree && l.adjacent).length,
            pins: pins.length, pinnedInterior: new Set(pins.flatMap((p) => p.ids)).size, interiorUnreached: unreached,
            components: compInfo.length,
        },
    };
}

/** How the world fits a texW x texH canvas: uniform scale (never above 1), centred, with a margin. */
export function fitWorld(bounds: { x: number; y: number; w: number; h: number; }, texW: number, texH: number, margin = 0.04) {
    const scale = Math.min(1, (texW * (1 - 2 * margin)) / bounds.w, (texH * (1 - 2 * margin)) / bounds.h);
    return { scale, ox: (texW - bounds.w * scale) / 2 - bounds.x * scale, oy: (texH - bounds.h * scale) / 2 - bounds.y * scale, texW, texH };
}

/** Smallest 2:1 power-of-two canvas (width capped at maxW) that keeps the world at scale 1, else maxW x maxW/2. */
export function textureSize(bounds: { x: number; y: number; w: number; h: number; }, maxW = 8192, margin = 0.04) {
    let w = 1024;
    while (w < maxW && (w * (1 - 2 * margin) < bounds.w || (w / 2) * (1 - 2 * margin) < bounds.h)) w *= 2;
    return { w, h: w / 2 };
}

export function worldToTex(fit: { scale: number; ox: number; oy: number; texW: number; texH: number; }, wx: number, wy: number) { return { x: wx * fit.scale + fit.ox, y: wy * fit.scale + fit.oy }; }
export function texToWorld(fit: { scale: number; ox: number; oy: number; texW: number; texH: number; }, tx: number, ty: number) { return { x: (tx - fit.ox) / fit.scale, y: (ty - fit.oy) / fit.scale }; }

/** What is at world point (x, y): { place, pin } (pin = nearest pin within `pinRadius` world px, on top of the place). */
export function hitTest(world, x: number, y: number, pinRadius = 12) {
    let pin = null, best = pinRadius;
    for (const p of world.pins) { const d = Math.hypot(p.wx - x, p.wy - y); if (d <= best) { best = d; pin = p; } }
    const place = world.places.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) ?? null;
    return { place, pin };
}
