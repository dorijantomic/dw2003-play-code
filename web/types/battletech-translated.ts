
/** One technique the list offers: its name word and its cost. */
export interface BattleTechEntry {
  word?: number;
  cost?: number;
}

/** Where the technique list opens: the acting slot, its MP, whether charging is free, and the known techniques. */
export interface BattleTechSeed {
  activeIndex?: number;
  mp?: number;
  maxMp?: number;
  noCharge?: number;
  techniques?: BattleTechEntry[];
}
