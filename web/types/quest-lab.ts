// How web/quest-lab.ts reads a quest definition and the quest shelf.
import type { QuestEndingDef, QuestEndingGiver, QuestEndingStep } from "./quest-endings.js";
import type { QuestSnapshot as QuestShelfSnapshot } from "./quest-shelf.js";

/** A character or place a quest names: the ids and maps the lab walks the player to. */
export interface QuestLabRecord {
  maps?: string[] | undefined;
  name?: string | undefined;
  npc?: number | undefined;
}

/** A quest's offer or hand-in. */
export interface QuestLabGiver extends QuestEndingGiver, QuestLabRecord {}

/** One objective of a quest. */
export interface QuestLabObjective extends QuestLabRecord {
  scene?: QuestEndingStep[] | undefined;
  type: string;
}

/** One quest definition of window.__quests.defs, the keys the lab reads. */
export interface QuestLabDef extends QuestEndingDef {
  giver?: string | undefined;
  id: string;
  objectives: QuestLabObjective[];
  offer?: QuestLabGiver | null | undefined;
  short?: string | undefined;
  title: string;
  turnIn?: QuestLabGiver | null | undefined;
}

/** One row of diffSnapshots(): a quest that started or finished, or a pick that changed. */
export interface QuestLabDiffRow {
  from: boolean | number | string | null;
  id: string;
  kind: string;
  to: boolean | number | string | null;
}

/** One named state on the shelf (web/quest-shelf.ts). */
export interface QuestLabShelfItem {
  at: number;
  name: string;
  snap: QuestShelfSnapshot;
}
