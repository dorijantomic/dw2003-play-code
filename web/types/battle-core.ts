// Types only: shapes of the battle core files (web/battle/core/*.ts, web/party.ts). Nothing here is emitted.
import type { DigimonRecord } from "./battle.js";

/** The species table: digimon.json rows keyed by the species id. */
export type DigimonTable = Record<number, DigimonRecord>;

/** What the walker's one-line sentence of a scripted technique reads off its plan (web/battle/messages.ts). */
export interface WalkerSentencePlan {
  effect?: string | undefined;
  refused?: boolean | undefined;
  stats?: { stat?: number | undefined }[] | undefined;
  rollLanded?: boolean | undefined;
  mpMoved?: number | undefined;
  changed?: { heal?: number | undefined } | undefined;
  charged?: boolean | undefined;
  /** the battle message page the plan prints */
  page?: { payload?: readonly number[] | undefined } | null | undefined;
}
