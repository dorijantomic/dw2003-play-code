import type { FlyExit } from "../fly-points.js";

/** The saved field position: what directStageNeighbors()/decodeFieldLocation() read and write. */
export interface StageLocalityValue {
  /** the facing of the player when the map was left ("down", "up-left", ...) */
  dir: string;
  /** the scene exit the player came in through, stamped so the way back is where it was */
  entranceReturn?: StageEntranceReturn;
  /** the map id ("s200"...), as the manifest lists it */
  mapId: string;
  version: number;
  x: number;
  y: number;
}

/** The entrance a load puts back into the scene's exits (a fly exit, plus where it drops the player). */
export interface StageEntranceReturn extends FlyExit {
  dir?: string;
  spawnX?: number;
  spawnY?: number;
}

export interface StageLocalityResult {
  dir: string;
  entranceReturn?: StageEntranceReturn;
  mapId: string;
  x: number;
  y: number;
}

/** The part of a stage's scene the neighbour and sprite lookups read. */
export interface StageLocalityScene {
  exits?: Array<{ to?: string | undefined; } | null | undefined>;
  npcs?: Array<{ sprite?: string | undefined; } | null | undefined>;
}

/** The scenes table (state.scenes): a scene per stage id. */
export type StageLocalityScenes = Record<string | number, StageLocalityScene | undefined> | null | undefined;

/** The position encodeFieldLocation() saves (it adds the version). */
export type StageLocationInput = Omit<StageLocalityValue, "version">;
