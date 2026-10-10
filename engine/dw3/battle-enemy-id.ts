// The enemy-id resolver — FIGHTSTG_F0x8009b8d0 with its index scan FIGHTSTG_F0x8009b864,
// ported from pro/fightstg.s:25645-25684.
//
// The browser re-implements this as `battleHudPlateLabelsFor`'s `enemyStatRowsDB?.[enemyKey]`
// lookup at web/battle.js:2380 and the `enemyStatsBlock` shim at web/battlehud-translated.js:412
// — both resolve the enemy's numeric id (the word at 0x80042b1c + slot*0xc + 0x18) to its
// stat record so the HUD plate can read the enemy name line out of the record's +0x06.
//
// The original's own words (fightstg.s):
//
//   F0x8009b864 (the scan):
//     .L0x8009b870  v1 = [0x80044f4c](0x1cf)     load resource 0x1cf (the enemy stat table)
//     .L0x8009b88c  v0 = lh (v1) ; beqz -> return -1        first id 0 -> not found
//     .L0x8009b894  a0 = 0                                  index
//     .L0x8009b898  v0 = lh (v1) ; beq v0, s0(id) -> return a0
//     .L0x8009b8a8  v1 += 0x46                              stride 70 bytes
//     .L0x8009b8b4  v0 = lh (v1) ; bnez -> loop (a0 += 1 in the delay slot)
//     .L0x8009b8bc  else return -1
//
//   F0x8009b8d0 (the resolver):
//     .L0x8009b8dc  v0 = [0x80044f4c](0x1cf)     the table base
//     .L0x8009b8f4  v1 = F0x8009b864(id)         the scan
//     .L0x8009b900  bltz v1 -> return 0           not found
//     .L0x8009b908  index * 0x46 (sll 3; addu; sll 2; subu; sll 1)
//     .L0x8009b91c  return base + index*0x46
//
// So the record is `base + index*0x46` and the id is the record's own first `u16`. The
// authoritative id->name list is ~/ddw3/rust/types/src/enemy_id.rs (docs/research/battle/
// battle-invocation.md:151-174), and the same resolver is what the wfightmn enemy-combatant
// builder calls through `[0x800a37fc]` to turn a battle descriptor's enemy id into its stats.
//
// Port: `enemyStatsIndex(records, id)` is the scan over an array of u16 ids (stride 0x46),
// and `enemyStatsBlock(base, id, readId)` is the resolver given a base and an id reader.

/** Resource 0x1cf, the enemy stat table (`[0x80044f4c](0x1cf)`). */
export const ENEMY_STATS_PACK = 0x1cf;
/** The record stride, `addiu v1, 0x46`. */
export const ENEMY_STATS_STRIDE = 0x46;
/** The not-found answer, `li v0, -0x1` (scan) / `v0 = 0` (resolver). */
export const ENEMY_STATS_NOT_FOUND = -1;

/**
 * F0x8009b864: linear-scan the table for `id`, returning the record index, or -1.
 * `readId(index)` reads the `u16` id at the start of record `index` (base + index*0x46).
 * The scan stops on a zero id, exactly as `beqz $v0, .L0x8009b8bc` does.
 */
export function enemyStatsIndex(readId: (index: number) => number, id: number): number {
  for (let i = 0; ; i++) {
    const v = readId(i) & 0xffff;
    if (v === 0) return ENEMY_STATS_NOT_FOUND;
    if (v === (id & 0xffff)) return i;
  }
}

/**
 * F0x8009b8d0: resolve an enemy id to its 70-byte stat record, or 0 when not found.
 * `readId(index)` reads the record's leading `u16` id; the table base is the resolver's own
 * argument (the browser reads it from the extracted `enemy_stats.json` / resource service).
 */
export function enemyStatsBlock(
  base: number,
  readId: (index: number) => number,
  id: number,
): number {
  const index = enemyStatsIndex(readId, id);
  if (index < 0) return 0;
  return (base + index * ENEMY_STATS_STRIDE) | 0;
}
