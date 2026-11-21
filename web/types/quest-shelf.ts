// One stored quest-layer state (the "dw.quests.v1" key), as web/quest-shelf.ts validates it.

/** The shape web/quests.ts freshState() writes, with the optional blocks a newer state carries. */
export interface QuestSnapshot {
  /** a finished quest's mark: a time, or the Ledger's { at }; validateSnapshot() tells them apart at runtime */
  done: Record<string, any>;
  /** the generated quest on offer, and how many of them were already completed */
  gen?: { n: number; def: any; completed?: number; };
  /** a picked answer per quest (the Ledger's shape), when a state carries one */
  picks?: Record<string, { pick: number; at: number; }>;
  v: number;
  /** a running quest: progress per objective, the keys it already counted, and when it started */
  active: Record<string, { p: number[]; seen: string[][]; at: number }>;
  announced?: Record<string, number>;
  duelWins: number;
  met: string[];
  seen?: Record<string, number>;
  /** a fired trigger's mark (the time it fired) per trigger id */
  triggers?: Record<string, number>;
  visited: string[];
}
