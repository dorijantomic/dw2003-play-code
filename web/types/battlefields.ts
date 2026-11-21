// Types only: the manifests web/battlefields.ts reads. Nothing here is emitted (node's strip mode
// erases declarations), so this file must never hold runtime code.

/** One stage's arena table: the default arena id, and the arena each battle screen rolls (188 -> 18). */
export interface ArenaStageTable {
  _default?: number;
  [screen: string]: number | undefined;
}

/** One arena the manifest lists: the pack fightstg loads, its background colour, its CLUT count. */
export interface ArenaManifestEntry {
  pack?: string;
  bg?: number[];
  clutTextures?: number;
}

/** The arena manifest: the stages that carry fights, and the arenas by id. */
export interface ArenaManifest {
  byStage?: Record<string, ArenaStageTable>;
  byArena?: Record<string, ArenaManifestEntry>;
}

/** One map record of the map manifest: its id ("s013"), its own name, and the zones it carries. */
export interface MapRecord {
  id?: string;
  name?: string;
  zones?: MapZoneRecord[];
}

/** One zone of a map record: where it is and which stage it leads to. */
export interface MapZoneRecord {
  id?: number;
  stage?: string;
}

/** One backdrop pack: the pack folder it draws from, its element world ("data" = the ordinary arena) and its sound. */
export interface BackdropPack {
  element?: string;
  pack?: string;
  sound?: number;
}

/** The backdrop tables: the packs by technique signature, by technique id, and the ordinary fallback. */
export interface BackdropTable {
  bySig?: Record<string, BackdropPack>;
  byTech?: Record<string, number>;
  fallbackSig?: number;
}

/** One row of the technique table: the element world its sigEffect names. */
export interface TechniqueTableEntry {
  sigEffect?: number;
  name?: string;
}

/** One skill of digimon.json's list: its id and display name. */
export interface SkillRecord {
  id?: number | string;
  name?: string;
}

/** What the battlefields page hands its row builders: the manifests it loaded, by name. */
export interface BattlefieldsInput {
  arenas?: ArenaManifest;
  backdrops?: BackdropTable;
  maps?: MapRecord[];
  skills?: SkillRecord[];
  techTable?: Record<string, TechniqueTableEntry>;
}
