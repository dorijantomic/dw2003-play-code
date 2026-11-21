// The filters web/quest-offers.ts applies when it decides which jobs a character may hand out right now.

/** offersAt()'s options: what the host knows about quest status, the session's refusals, and the lab's own focus. */
export interface QuestOfferFilters {
  /** the quest's status in the save ("available" when absent) */
  statusOf?: (def: any) => string;
  /** the ids the player said "not now" to this session */
  declined?: { has: (id: number) => boolean; };
  /** the lab asked for one quest in particular */
  labFocus?: number | string;
  /** night/story variants of a place count as the same place */
  canon?: (mapId: number) => number;
}
