// web/map-screen-model.js -- the NEW map screen's data and cursor (OPTIONS > GAME > Map screen: New). Pure: no DOM, no window.
//
// Built at runtime from what the game already loaded: the map manifest (state.manifest.maps: id, name), the scene routing data
// (state.scenes[id].exits / warps: where each map leads), the "have I walked in here" flag the field entry writes, and the
// current map. Nothing is stored. Areas are grouped into regions by the part of the manifest name before " - " (the long dash).
// A region shows the areas you have visited as boxes, the links between them as lines, and, beside a visited area, each linked
// area you have not visited as a "???" box (its name stays hidden). Regions with no visited area are not listed.

/** The region a manifest name belongs to: "Central Sector — Asuka City" -> "Central Sector"; a name without a dash is its own region. */
export function regionOf(name) {
    const s = String(name ?? "");
    const i = s.indexOf(" — ");
    return i > 0 ? s.slice(0, i) : s;
}

/** Every link between two manifest maps, as a Set of "a|b" keys (a < b), from the scenes' exits and warps. Self links and unknown ids are dropped. */
export function buildLinks(maps, scenes) {
    const known = new Set(maps.map((m) => m.id));
    const links = new Set<string>();
    for (const m of maps) {
        const sc = scenes?.[m.id];
        if (!sc) continue;
        const targets = [];
        for (const e of sc.exits ?? []) if (typeof e?.to === "string") targets.push(e.to);
        for (const w of sc.warps ?? []) if (Number.isFinite(Number(w?.stage))) targets.push(`s${Number(w.stage)}`);
        for (const t of targets) if (t !== m.id && known.has(t)) links.add(m.id < t ? `${m.id}|${t}` : `${t}|${m.id}`);
    }
    return links;
}

/** { regions: [{ name, ids }] in manifest order, regionIndex(id), nameOf(id), neighbours(id) }. */
export function buildGraph(maps, scenes) {
    const regions = [], byName = new Map(), regionOfId = new Map(), names = new Map(), adj = new Map();
    for (const m of maps) {
        const r = regionOf(m.name);
        if (!byName.has(r)) { byName.set(r, regions.length); regions.push({ name: r, ids: [] }); }
        regions[byName.get(r)].ids.push(m.id);
        regionOfId.set(m.id, byName.get(r));
        names.set(m.id, String(m.name ?? m.id));
        adj.set(m.id, []);
    }
    for (const key of buildLinks(maps, scenes)) {
        const [a, b] = key.split("|");
        adj.get(a).push(b); adj.get(b).push(a);
    }
    return {
        regions,
        regionIndex: (id) => regionOfId.get(id) ?? -1,
        nameOf: (id) => names.get(id) ?? "",
        neighbours: (id) => adj.get(id) ?? [],
    };
}

/**
 * What one region shows: `nodes` = [{ id, seen }] (visited first, then the "???" ones beside them) and `edges` = [[a, b]],
 * both only among the shown nodes. `seen(id)` = the flag question; the current map always counts as visited.
 */
export function regionView(graph, regionIdx, seen, currentId) {
    const region = graph.regions[regionIdx];
    if (!region) return { nodes: [], edges: [], visited: 0, total: 0 };
    const isSeen = (id) => id === currentId || !!seen(id);
    const visited = region.ids.filter(isSeen);
    const shown = new Set(visited);
    const frontier = [];
    for (const id of visited) {
        for (const n of graph.neighbours(id)) {
            if (graph.regionIndex(n) === regionIdx && !shown.has(n)) { shown.add(n); frontier.push(n); }
        }
    }
    const nodes = [...visited.map((id) => ({ id, seen: true })), ...frontier.map((id) => ({ id, seen: false }))];
    const edges = [];
    for (const id of shown) for (const n of graph.neighbours(id)) if (id < n && shown.has(n)) edges.push([id, n]);
    return { nodes, edges, visited: visited.length, total: region.ids.length };
}

/** The regions with at least one visited area, as indexes into graph.regions (the list the L1 / R1 buttons walk). */
export function openRegions(graph, seen, currentId) {
    const out = [];
    graph.regions.forEach((r, i) => { if (r.ids.some((id) => id === currentId || seen(id))) out.push(i); });
    return out;
}

/**
 * Place the nodes of one region in a box of w x h (node centres, `size` = box side). Columns are the link distance from `rootId`
 * (a component that does not reach it starts a column of its own further right); a column with more nodes than rows fit is
 * split into more columns. Deterministic, and no two boxes overlap.
 */
/** What one region shows the book: the boxes (visited first, then the "???" ones), the links among them, and the counts. */
export interface RegionView {
    nodes: { id: string; seen: boolean }[];
    edges: [string, string][];
    visited: number;
    total: number;
}

export function layoutNodes(view: RegionView, rootId, w, h, size = 8) {
    const ids = view.nodes.map((n) => n.id);
    if (!ids.length) return new Map();
    const adj = new Map<string, string[]>(ids.map((id) => [id, []] as [string, string[]]));
    for (const [a, b] of view.edges) { adj.get(a).push(b); adj.get(b).push(a); }
    const layers = [], done = new Set();
    const order = ids.includes(rootId) ? [rootId, ...ids.filter((i) => i !== rootId)] : ids;
    for (const start of order) {
        if (done.has(start)) continue;
        let layer = [start]; done.add(start);
        while (layer.length) {
            layers.push(layer);
            const next = [];
            for (const id of layer) for (const n of adj.get(id)) if (!done.has(n)) { done.add(n); next.push(n); }
            layer = next;
        }
    }
    const pitchY = size + 6, rowsFit = Math.max(1, Math.floor((h - size) / pitchY) + 1);
    const cols = [];
    for (const l of layers) for (let i = 0; i < l.length; i += rowsFit) cols.push(l.slice(i, i + rowsFit));
    const pitchX = cols.length > 1 ? Math.min(size + 28, (w - size) / (cols.length - 1)) : 0;
    const left = (w - pitchX * (cols.length - 1)) / 2;
    const out = new Map();
    cols.forEach((col, ci) => {
        const pitch = col.length > 1 ? Math.min(pitchY + 8, (h - size) / (col.length - 1)) : 0;
        const top = (h - pitch * (col.length - 1)) / 2;
        col.forEach((id, ri) => out.set(id, { x: Math.round(left + pitchX * ci), y: Math.round(top + pitch * ri) }));
    });
    return out;
}

/** The node nearest to `from` in direction `dir` ("up" | "down" | "left" | "right"), or null when none lies that way. A cone: the sideways gap counts double. */
export function nearestInDirection(pos, from, dir) {
    const p = pos.get(from);
    if (!p) return null;
    let best = null, bestCost = Infinity;
    for (const [id, q] of pos) {
        if (id === from) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
        const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        if (along <= 0 || across > along * 2 + 2) continue;      // behind, or too far off to the side
        const cost = along + across * 2;
        if (cost < bestCost || (cost === bestCost && id < best)) { best = id; bestCost = cost; }
    }
    return best;
}

/** The screen's state: which region, which node the cursor is on, and the text for the help band. */
/** A manifest map as the map screen reads it: its stage id and its "Region — Town" name. */
export interface MapScreenRecord { id: string; name?: string }

/** What the game hands the map screen: the maps, the scene routing data, the seen flag, and the map you are on. */
export interface MapScreenData {
    maps: MapScreenRecord[];
    scenes?: Record<string, any> | null;
    seen: (id: string) => boolean;
    currentId: string | null;
}

export function createMapScreenModel({ maps, scenes, seen, currentId, box = { w: 252, h: 100 } }: MapScreenData & { box?: { w: number; h: number } }) {
    const graph = buildGraph(maps, scenes);
    const listed = openRegions(graph, seen, currentId);
    let at = Math.max(0, listed.indexOf(graph.regionIndex(currentId)));
    let view = null, pos = null, cursor = null;
    const build = () => {
        view = regionView(graph, listed[at], seen, currentId);
        const root = view.nodes.some((n) => n.id === currentId) ? currentId : (view.nodes[0]?.id ?? null);
        pos = layoutNodes(view, root, box.w, box.h);
        cursor = root;
    };
    if (listed.length) build();
    return {
        graph,
        count: () => listed.length,
        regionIndex: () => at,
        regionName: () => (listed.length ? graph.regions[listed[at]].name : ""),
        /** Visited of all areas in this region. */
        progress: () => (listed.length ? { visited: view.visited, total: view.total } : { visited: 0, total: 0 }),
        nodes: () => (view ? view.nodes : []),
        edges: () => (view ? view.edges : []),
        position: (id) => pos?.get(id) ?? null,
        cursor: () => cursor,
        currentId: () => currentId,
        /** The area under the cursor: its name stays "???" until it has been visited. */
        selected() {
            if (!cursor) return null;
            const known = cursor === currentId || !!seen(cursor);
            return { id: cursor, seen: known, here: cursor === currentId, name: known ? graph.nameOf(cursor) : "???" };
        },
        /** The line for the help band. */
        help() {
            const s = this.selected();
            if (!s) return "No area visited yet.";
            return s.here ? `${s.name} (You are here)` : s.name;
        },
        /** "up" | "down" | "left" | "right": the cursor goes to the nearest box that way. Returns "move" or null (nothing that way). */
        move(dir) {
            if (!cursor) return null;
            const n = nearestInDirection(pos, cursor, dir);
            if (n === null) return null;
            cursor = n; return "move";
        },
        /** d = -1 / +1: the previous / next region that has a visited area. */
        switchRegion(d) {
            const next = Math.min(listed.length - 1, Math.max(0, at + d));
            if (next === at || !listed.length) return null;
            at = next; build(); return "move";
        },
    };
}
