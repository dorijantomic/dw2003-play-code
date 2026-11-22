// The filters web/quest-offers.ts applies when it decides which jobs a character may hand out right now.
import type { QuestDef } from "../quests.js";

/** offersAt()'s options: what the host knows about quest status, the session's refusals, and the lab's own focus. */
export interface QuestOfferFilters {
  /** the quest's status in the save ("available" when absent) */
  statusOf?: (def: QuestDef) => string;
  /** the ids the player said "not now" to this session */
  declined?: { has: (id: string) => boolean; };
  /** the lab asked for one quest in particular */
  labFocus?: string | null;
  /** night/story variants of a place count as the same place */
  canon?: (mapId: string) => string;
}
