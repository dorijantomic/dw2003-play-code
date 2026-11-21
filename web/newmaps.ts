// web/newmaps.js — maps made after the disc (Gemini HD maps, tools/newmap_export.py + tools/newmap_import.py).
//
// NEW CONTENT of this project, on for everyone (no option row, no URL flag).
// Data: assets/data/newmaps/index.json {"maps": [id...]}, and per map
//   <id>.json            {record, scene, neighbourExits:[{map, exit}]}
//   <id>.collision.json  the game's own collision grid (engine/core/util/collision.ts GridJSON: cell, cols, rows, "0/1" rows)
// (authored copy: data/authored/web/assets/data/newmaps/; the picture web/assets/maps/<id>.png is local art, git-ignored).
//
// A new map loads like a disc map: its record joins manifest.maps (so the stage loader fetches its picture and, through
// record.collision, its grid), its scene comes from the file instead of assets/scenes, and the exit added to the
// neighbour is appended to the neighbour's scene when that scene is built. A map whose picture is missing is skipped
// whole (a fresh clone has the data but not the art), so no door leads to a missing place.
//
// Pure: takes a fetch-like function; no DOM, no game state.

const DIR = "assets/data/newmaps/";

/** Read every new map. `get(url)` resolves to parsed JSON or null (404). `has(url)` resolves true when the file exists. */
export async function loadNewMaps(get, has) {
    const out = { records: [], scenes: {}, exits: {} };
    const idx = await get(DIR + "index.json").catch(() => null);
    for (const id of idx?.maps ?? []) {
        try {
            const doc = await get(`${DIR}${id}.json`);
            if (!doc?.record || doc.record.id !== id) continue;
            if (has && !(await has(doc.record.image))) continue;
            out.records.push(doc.record);
            out.scenes[id] = doc.scene ?? { npcs: [], exits: [], zones: [] };
            for (const n of doc.neighbourExits ?? []) (out.exits[n.map] ??= []).push(n.exit);
        } catch {
            /* a broken file skips that map only */
        }
    }
    return out;
}

/** A neighbours' pack: the map records to add, and the exits a neighbour gains ({ to } entries), per map id. */
interface NewMapPack {
    records: { id: string }[];
    exits: Record<string, { to: string }[]>;
}

/** Add the records to a manifest (never replaces a disc map). Returns the ids added. */
export function mergeNewMaps(manifest: { maps: { id: string; }[]; }, nm: NewMapPack) {
    const have = new Set(manifest.maps.map((m) => m.id));
    const added: string[] = [];
    for (const r of nm.records) {
        if (have.has(r.id)) continue;
        manifest.maps.push(r);
        added.push(r.id);
    }
    // the neighbours' exits only make sense for maps that really joined
    for (const [map, list] of Object.entries(nm.exits)) nm.exits[map] = list.filter((e) => added.includes(e.to));
    return added;
}

/** The scene of a new map, or null when `id` is not one. */
export function newMapScene(nm, id: string | number) {
    return nm?.scenes?.[id] ?? null;
}

/** Put the exits that lead into new maps onto a neighbour's scene (once; safe to call again). */
export function addNewMapExits(nm, mapId: string | number, scene) {
    const list = nm?.exits?.[mapId];
    if (!list?.length) return;
    scene.exits = scene.exits ?? [];
    for (const e of list) if (!scene.exits.some((x) => x._newMap === e._newMap && x.to === e.to)) scene.exits.push({ ...e });
}
