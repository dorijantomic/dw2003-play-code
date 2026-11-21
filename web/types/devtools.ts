/** The devtools panel's asset tables (web/devtools.ts), all parsed from the disc's own JSON. */

/** data/manifest.json — one row per map and per character sheet. */
export interface DevtoolsManifest {
  maps: { id: number; name: string; image: string }[];
  characters: { id: number; name: string; sheet: string }[];
}

/** One entry of data/enemies.json. */
export interface DevtoolsEnemy {
  enemy_id: number;
}

/** One scripted stage event of data/wstag.json, keyed by map id. */
export interface DevtoolsStageEvent {
  id: number;
  flag_key?: string;
  disasm?: string[];
}

/** One battle backdrop pack, keyed by its trigger signature. */
export interface DevtoolsBackdrop {
  pack: string;
  element: string;
}

export interface DevtoolsData {
  /** data/battle_arenas.json — arena id -> pack, and stage/screen -> arena id. */
  arenas?: {
    byArena: Record<number, { pack: string }>;
    byStage: Record<string, Record<string, number | null>>;
  };
  backdrops?: {
    bySig: Record<string, DevtoolsBackdrop>;
    byTech: Record<string, DevtoolsBackdrop>;
  };
  enemies?: DevtoolsEnemy[];
  manifest?: DevtoolsManifest;
  /** data/digimon.json's skill table. */
  skills?: { id: number; name: string }[];
  /** data/stage_names.json — map id -> the disc's stage name. */
  stageNames?: Record<number, string>;
  /** data/wstag.json — map id -> that stage's scripted events. */
  wstag?: Record<number, DevtoolsStageEvent[]>;
}
