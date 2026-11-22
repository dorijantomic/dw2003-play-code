// What web/replay-theatre.ts is opened on.

/** One event row of the replay list (replayRows). */
export interface ReplayRow {
  /** the stage the event lives in */
  mapId: string;
  /** the stage's display name */
  stage: string;
  eventId: number;
  /** the first thing the event says, shown in the list */
  firstSay: string | null;
  /** playable from where the player stands */
  playable: boolean;
  /** reached, but in another room */
  elsewhere: boolean;
}

/** A prepared view of one room's story scenes: where the player is, and the events reachable here and elsewhere. */
export interface ReplayView {
  /** the place name shown at the top */
  place?: string;
  /** the events of the room the player stands in */
  here?: ReplayRow[];
  /** the events of every other reached stage */
  elsewhere?: ReplayRow[];
}

/** One beat of progress_ordinal.json: a stage number and the story ordinals at which it opens. */
export interface ReplayLadderBeat {
  stage?: number | string;
  ordinals?: (number | string)[];
}

/** One map of assets/manifest.json, as far as the ladder reads it. */
export interface ReplayManifestMap {
  id?: string;
  name?: string;
}

/** The prepared ladder: each stage's beats ascending, and the manifest's name of each stage. */
export interface ReplayLadder {
  byStage: Record<string, number[]>;
  names: Record<string, string>;
}

/** progress_ordinal.json as an object, or an already prepared ladder (the same optional keys are read off a bare array too). */
export interface ReplayLadderObject {
  ladder?: ReplayLadderBeat[];
  byStage?: Record<string, number[]> | null;
  names?: Record<string, string>;
}

/** progress_ordinal.json as a bare array of beats. */
export interface ReplayLadderList extends Array<ReplayLadderBeat> {
  ladder?: ReplayLadderBeat[];
  byStage?: Record<string, number[]> | null;
  names?: Record<string, string>;
}

/** What replayLadder() and replayRows() take as the ladder: a prepared one, a raw file or its array. */
export type ReplayLadderSource = ReplayLadderList | ReplayLadderObject;

/** assets/manifest.json as an object, or its bare map array. */
export interface ReplayManifestObject {
  maps?: ReplayManifestMap[];
}

/** assets/manifest.json's maps as a bare array. */
export interface ReplayManifestList extends Array<ReplayManifestMap> {
  maps?: ReplayManifestMap[];
}

/** One extracted event record (wstag), as far as the theatre reads it. */
export interface ReplayEvent {
  id?: number | string;
  flag_key?: string | number;
  disasm?: string[];
  script_offset?: number | string;
}

/** The page's state. */
export interface ReplayState {
  open: boolean;
  wasOn: boolean;
  place: string;
  here: ReplayRow[];
  elsewhere: ReplayRow[];
  cursor: number;
  chosen: ReplayRow | null | undefined;
}
