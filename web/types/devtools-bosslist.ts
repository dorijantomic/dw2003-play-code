export interface BossListRow {
  hasName: boolean;
  /** the opponent names field_encounters.json gives the screen, joined with " / ", or the unknown marker */
  opponent: string;
  party: { name: string; level: number; }[];
  places: { mapId: string; mapName: string; }[];
  screenId: number;
  speakers: string[];
  /** rowText(): the searchable text of the whole row */
  text?: string;
}

/** One battle candidate of a stage script: the flag that arms it and the screen it opens. */
export interface ScriptedBattleCandidate {
  preFlagKey?: string;
  screenId?: number;
  screenIdHint?: number;
}

/** One event of a stage script: the flag it sets and the esdmg part it plays. */
export interface ScriptedEvent {
  flag_key?: string;
  esdmg_stage?: number | string;
  esdmg_entry?: number | string;
}

/** One stage script: its battle candidates and its events. */
export interface ScriptedStage {
  battle_candidates?: ScriptedBattleCandidate[];
  events?: ScriptedEvent[];
}
