
/** One party member the DNA screen lists: its species, its roster slot, its gauges and its three forms. */
export interface BattleDnaMemberSeed {
  digimonId?: number;
  rosterSlot?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  status?: number;
  blast?: boolean;
  panel?: unknown;
  /** the member's equipped form ids */
  forms?: number[];
  preselected?: number;
}

/** Where the DNA screen opens: the first step ("list" or "pane"), the acting slot, the partner, and the party. */
export interface BattleDnaSeed {
  step?: string;
  activeIndex?: number;
  partnerIndex?: number;
  members?: BattleDnaMemberSeed[];
}
