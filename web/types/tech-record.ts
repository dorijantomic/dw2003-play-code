export interface TechRecordMerged {
  /** the record's accuracy: rand%128 < base_acc·(1 + SPD_diff/128) */
  base_acc?: number;
  effect_id: number;
  effect_power: number;
}

/** An enemy record that carries an item: what rollBattleDrop picks from. */
export interface BattleDropCandidate {
  drop_item: string;
  drop_rate: number;
}
