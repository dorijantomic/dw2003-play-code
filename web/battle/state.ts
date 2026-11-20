export const S = {
  // Look only (web/ui-c): the last resolved blow, as a read-only note { seq, kind, hit, dmg, heal, crit, eff } for the damage pop. seq counts blows, so the pop
  // fires once per hit event; nothing here feeds back into a number or the RNG order.
  hitSeq: 0,
  hitNote: null as { seq: number; kind: string; hit: boolean; dmg: number; heal: number; crit: boolean; eff: number } | null,
  // Resource 0x1cf, the enemy stat records in scan order — the 70-byte-stride table
  // FIGHTSTG_F0x8009b864 linear-scans. `enemyStatIdByName` maps an enemies.json
  // `enemy_id` (a name) to the runtime u16 id the original's battle descriptor carries
  // (the authoritative `enemy_id.rs` values, taken from the decoded field encounters);
  // FIGHTSTG_F0x8009b8d0's scan then turns that id into the record. Both are filled by
  // the battle data loader. The walker carries no numeric id of its own, so the name is
  // how a battle names its enemy and the id comes from decoded data — see
  // enemyStatRecordFor. `record.nameId` (`+0x06`) is the line of bank 0x4e the original's
  // plate reads and `record.id` (`+0x00`) is the numeric id the scan looks for.
  enemyStatRecords: null as any[] | null,
  enemyStatIdByName: null as Record<string, any> | null,
};
