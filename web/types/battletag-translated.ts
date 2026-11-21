
/** One party member the tag list names: its species, its gauges, its roster slot, and its three forms. */
export interface BattleTagMemberSeed {
  digimonId?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  name?: string;
  /** the member's equipped form ids */
  forms?: number[];
  blast?: boolean;
}

/** Where the tag list opens: the acting slot, whether it takes input, its row, and the party. */
export interface BattleTagSeed {
  activeIndex?: number;
  interactive?: number;
  cursorRow?: number;
  members?: BattleTagMemberSeed[];
}

/** What the tag list is handed: the host's live state, read for the party it lists. */
export interface BattleTagOptions {
  getState?: () => any;
}
