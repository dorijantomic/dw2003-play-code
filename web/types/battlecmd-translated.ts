
/** The acting member the command list opens on: its party slot, its ailment byte, and the confusion shuffle's six indices. */
export interface BattleCommandSeed {
  activeIndex?: number;
  ailmentBits?: number;
  jokeIndices?: number[] | null;
}
