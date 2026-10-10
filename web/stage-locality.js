export const FIELD_LOCATION_KEY = "fieldLocation";
export const FIELD_LOCATION_VERSION = 1;

/** Return the unique, valid stages directly reachable from one scene. */
export function directStageNeighbors(stageId, scenes, knownStageIds = null) {
  const known = knownStageIds ? new Set(knownStageIds) : null;
  const result = [];
  const seen = new Set([stageId]);
  for (const exit of scenes?.[stageId]?.exits ?? []) {
    const id = exit?.to;
    if (!id || seen.has(id) || (known && !known.has(id))) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Current stage first, followed by the stages worth keeping warm. */
export function stageWorkingSet(stageId, scenes, knownStageIds = null) {
  return [stageId, ...directStageNeighbors(stageId, scenes, knownStageIds)];
}

/** Sprite sheets referenced by a collection of stage scenes. */
export function stageSpriteIds(stageIds, scenes) {
  const ids = new Set();
  for (const stageId of stageIds) {
    for (const npc of scenes?.[stageId]?.npcs ?? []) {
      if (npc?.sprite) ids.add(npc.sprite);
    }
  }
  return ids;
}

export function encodeFieldLocation(location) {
  const value = {
    version: FIELD_LOCATION_VERSION,
    mapId: location.mapId,
    x: location.x,
    y: location.y,
    dir: location.dir,
  };
  if (location.entranceReturn) value.entranceReturn = location.entranceReturn;
  return JSON.stringify(value);
}

/** Parse a saved position defensively; stale/corrupt saves fall back to null. */
export function decodeFieldLocation(raw, knownStageIds) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const known = new Set(knownStageIds ?? []);
    if (
      value?.version !== FIELD_LOCATION_VERSION ||
      !known.has(value.mapId) ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      !["up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"].includes(value.dir)
    ) return null;
    const result = { mapId: value.mapId, x: value.x, y: value.y, dir: value.dir };
    const back = value.entranceReturn;
    if (back && known.has(back.to) && Number.isFinite(back.x) && Number.isFinite(back.y)
        && Number.isFinite(back.w) && Number.isFinite(back.h)
        && Number.isFinite(back.spawnX) && Number.isFinite(back.spawnY)) {
      result.entranceReturn = {
        x: back.x, y: back.y, w: back.w, h: back.h, to: back.to,
        spawnX: back.spawnX, spawnY: back.spawnY,
        dir: typeof back.dir === "string" ? back.dir : "down",
        _entranceReturn: true,
      };
    }
    return result;
  } catch {
    return null;
  }
}
