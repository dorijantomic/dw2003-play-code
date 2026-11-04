// web/redirect-view.js — who the confirm press really reaches.
//
// Fifteen npc ids are not people: they are spriteless position markers standing
// where a counter clerk, a guard or a checkpoint looks reachable from. The field
// confirm handler (F0x8008E2CC, pro/fieldstg.s 0xb674-0xb73c) finds the marker
// id in the 15-record remap table at RAM 0x80097C68 and swaps it for the real
// actor before the interact arms run — which is why two records share one tile
// and why the Explorer shows a marker with no sprite next to a clerk with one.
// The table lives in the engine (engine/dw3/npc-confirm-redirects.ts, built into
// ./vendor/engine.js); this module only reads it and joins it to the shipped
// scenes. It keeps no second copy of a pair.
//
// Pure: no DOM, no storage, no network. The page (web/redirect-lab.html) does the
// fetching; this file answers every question from the records it is handed.
import {
  confirmRedirectId,
  confirmRedirectPairs,
  NPC_CONFIRM_REDIRECT_TABLE_RAM,
} from "./vendor/engine.js";

// The address is the engine's own constant, re-exported so the page can print it
// without typing the number a second time.
export { NPC_CONFIRM_REDIRECT_TABLE_RAM };

/** The engine's pairs as plain rows: [{ from, to }], in table order. */
export function redirectRows(pairs = confirmRedirectPairs()) {
  return (pairs || []).map(([from, to]) => ({ from, to }));
}

/** Map ids of a scene set (a Map or a plain object), sorted so a report is stable. */
function mapIds(scenes) {
  if (!scenes) return [];
  const keys = scenes instanceof Map ? [...scenes.keys()] : Object.keys(scenes);
  return keys.map(String).sort();
}

/** The npc records of one room. */
function npcsOf(scenes, mapId) {
  if (!scenes) return [];
  const scene = scenes instanceof Map ? scenes.get(mapId) : scenes[mapId];
  return scene && Array.isArray(scene.npcs) ? scene.npcs : [];
}

/** First record per npc id: the marker can stand twice, the cast is still one. */
function firstRecords(npcs) {
  const out = new Map();
  for (const rec of npcs) {
    if (!rec || rec.npc_id == null) continue;
    if (!out.has(rec.npc_id)) out.set(rec.npc_id, rec);
  }
  return out;
}

/** One standing spot: the record's x/y and, only when the record has one, its sprite. */
function spot(rec) {
  const out = { x: rec.x, y: rec.y };
  if (typeof rec.sprite === "string" && rec.sprite) out.sprite = rec.sprite;
  return out;
}

/** How many rooms there are and how many distinct npc ids stand in them. */
export function scanScenes(scenes) {
  const ids = new Set();
  const rooms = mapIds(scenes);
  for (const map of rooms) {
    for (const rec of npcsOf(scenes, map)) {
      if (rec && rec.npc_id != null) ids.add(rec.npc_id);
    }
  }
  return { maps: rooms.length, ids: ids.size };
}

/**
 * One row per pair: the rooms where BOTH ids stand in the same cast, with the
 * marker's spot (no sprite) and the clerk's spot and sprite. First record per id
 * per room, so a marker that stands twice is still one position.
 */
export function redirectReport(pairs = confirmRedirectPairs(), scenes = new Map()) {
  const rows = [];
  const rooms = mapIds(scenes);
  const casts = new Map();
  for (const map of rooms) casts.set(map, firstRecords(npcsOf(scenes, map)));
  for (const [from, to] of pairs || []) {
    const maps = [];
    for (const map of rooms) {
      const cast = casts.get(map);
      const marker = cast.get(from);
      const target = cast.get(to);
      if (!marker || !target) continue;
      maps.push({ map, marker: spot(marker), target: spot(target) });
    }
    rows.push({ from, to, maps });
  }
  return rows;
}

/** The pair a press at this id reaches, or null when the id is not a marker. */
export function redirectFor(id) {
  const to = confirmRedirectId(id);
  return to == null ? null : { from: id, to };
}

/** The pairs one room carries — both ids of the pair in that room's cast. */
export function pairsOnMap(mapId, scenes, pairs = confirmRedirectPairs()) {
  const cast = new Set(npcsOf(scenes, mapId).map((rec) => rec && rec.npc_id));
  return (pairs || [])
    .filter(([from, to]) => cast.has(from) && cast.has(to))
    .map(([from, to]) => [from, to]);
}

/** Every room that carries at least one pair, sorted — the map chips' own list. */
export function reportMaps(report) {
  const out = new Set();
  for (const row of report || []) {
    for (const hit of row.maps || []) out.add(hit.map);
  }
  return [...out].sort();
}
