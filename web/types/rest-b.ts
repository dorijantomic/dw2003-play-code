// Types shared by the files of the "rest-b" group (web/map-screen-model.ts, web/newmaps.ts, ...). Type-only: nothing here is emitted.
import type { ManifestMap, SceneNpc, SpriteRecord, StageExit } from "../game/types.js";
import type { AmbienceSettings } from "./ambience.js";

/** An exit a new map adds to a neighbour (assets/data/newmaps/<id>.json neighbourExits). */
export interface NewMapExit extends StageExit {
  _newMap?: boolean;
}

/** The scene of a new map: the file's own, or an empty one. */
export interface NewMapScene {
  npcs: SceneNpc[];
  exits: NewMapExit[];
  zones: unknown[];
}

/** One file of assets/data/newmaps/: index.json holds `maps`, <id>.json the rest. */
export interface NewMapFile {
  maps?: string[];
  record?: ManifestMap;
  scene?: NewMapScene;
  neighbourExits?: Array<{ map: string; exit: NewMapExit; }>;
}

/** Everything loadNewMaps() reads: the records to join the manifest, the scenes by id and the exits each neighbour gains. */
export interface NewMaps {
  records: ManifestMap[];
  scenes: Record<string, NewMapScene>;
  exits: Record<string, NewMapExit[]>;
}

/** The live effects settings (window.__fx): the named values and switches, and any other key by name. */
export type AmbienceBag = AmbienceSettings & { [key: string]: unknown };

/** A new partner's record of web/extra_partners.json: a character sprite record, plus whether its drawn art has arrived. */
export interface ExtraPartnerRecord extends SpriteRecord {
  art?: boolean;
}

/** Where one partner picture is: painted (canvas), still loading (pending) or there is none (none). */
export interface PartnerPictureEntry {
  canvas?: HTMLCanvasElement;
  none?: boolean;
  pending?: boolean;
}

/** The patch canvas seamPatchFor() builds for one map, with how many seams it fills and how many pixels it paints. */
export interface SeamPatch {
  canvas: HTMLCanvasElement;
  regions: number;
  pixels: number;
}

/** One slot of the enemy team as the self-tag rules read it: the id (0 = empty), the disc species id, and the hp. */
export interface EnemySlot {
  id: number;
  speciesId: number;
  hp: number;
}

/** A team record the slot list is made from: an enemies.json profile (it carries no id) and the disc species id. */
export interface EnemyTeamRecord {
  hp: number;
  profile?: { id?: number | string | undefined; } | null | undefined;
  speciesId?: number | string | undefined;
}

/** One real drop a fused body still owes: the item name and the highest rate any other half carries it at. */
export interface FusionDropRow {
  item: string;
  rate: number;
}
