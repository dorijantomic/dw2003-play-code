// What web/replay-theatre.ts is opened on.

/** One event row of the replay list (replayRows). */
export interface ReplayRow {
  /** the stage the event lives in */
  mapId: string;
  /** the stage's display name */
  stage: string;
  eventId: number;
  /** the first thing the event says, shown in the list */
  firstSay: string;
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
