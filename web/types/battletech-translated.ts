
/** One technique the list offers: its name word and its cost. */
export interface BattleTechEntry {
  word?: number;
  cost?: number;
}

/** The seed the screen hands its session: the opening words, already clamped. */
export interface BattleTechWords {
  activeIndex: number;
  mp: number;
  maxMp: number;
  noCharge: number;
  techniques: { word: number; cost: number; }[];
}

/** Where the technique list opens: the acting slot, its MP, whether charging is free, and the known techniques. */
export interface BattleTechSeed {
  activeIndex?: number;
  mp?: number;
  maxMp?: number;
  noCharge?: number;
  techniques?: BattleTechEntry[];
}
