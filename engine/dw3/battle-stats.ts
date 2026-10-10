// engine/dw3/battle-stats.ts
// Pure stat scaling + evolution-filter logic, ported from web/battle.js (lines 50–93).
// Starters use real growth rates; champions use growth=1.

export interface StatProfile {
  is_starter?: boolean;
  growth?: Record<string, number>;
  [statKey: string]: unknown;
}

export function scaledStat(profile: StatProfile, statKey: string, level: number): number {
  const base = (profile[statKey] as number) ?? 0;
  const growth = profile.growth?.[statKey] ?? 1;
  return Math.round(base + growth * (level - 1));
}

/** One deployed party position, as the bank-0x72 charisma sum sees it. */
export interface CharismaMember {
  profile: StatProfile | null | undefined;
  level?: number;
  /**
   * The member's STORED current Charisma, when the host tracks one.
   *
   * The native reads `cur_chr` out of the roster record; it does not re-derive
   * the stat from a profile. A host with a stored-stat model (level-up rolls,
   * gym gains) should pass that value here so those gains count. Omitted, the
   * sum falls back to the profile scaling, which is the closest a host without
   * stored stats can get.
   */
  charisma?: number;
  /**
   * Modifier folded into the charisma field before the 999 clamp, inline in
   * F0x80017174 (fns.s L7904-7914).
   *
   * The added value is the LEADING u16 of a definition record fetched through
   * the runtime function pointer D0x80042b98, called with each of the six
   * halfword keys at roster record +0x3c0 (keys <= 0 are skipped). Those six
   * halfwords are lookup KEYS, not the amounts, and the definition table behind
   * that pointer is NOT decoded — docs/research/battle/digimon-cur-stats-helpers.md
   * explicitly warns the older `Unknown4Items` (equipment) reading is unsettled.
   * So this is named for what it does, not for a source we have not proven; a
   * caller passing an equipment figure is making that assumption itself.
   */
  buffCharisma?: number;
}

/**
 * Effective total Charisma of the deployed party — the quantity F0x80015fbc
 * accumulates and compares against the bank-0x72 ladder.
 *
 * The native sums buffer+0x16 over the THREE deployed positions, skipping any
 * whose slot lookup returns negative (undeployed contribute 0). F0x80017174
 * fills that buffer by copying 0x2c bytes from `D0x80048d34 + slot*0x3dc +
 * 0x784`, which is the same address as `DIGIMON_CUR_STATS + slot*0x3dc + 0x1c`
 * (0x80048d34 + 0x784 == 0x8004949c + 0x1c), i.e. roster record +0x1c..+0x48 —
 * a 0x20-byte loop plus a 12-byte tail. Buffer+0x16 is therefore record +0x32 =
 * cur_chr, with a modifier folded in and capped at 999, so the summed quantity
 * is EFFECTIVE charisma, not raw stored charisma.
 *
 * Ledger: charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate.
 */
export function partyCharismaTotal(members: readonly CharismaMember[]): number {
  let total = 0;
  for (const m of members.slice(0, 3)) {
    if (!m) continue;
    const own = m.charisma ?? (m.profile ? scaledStat(m.profile, "chr", m.level ?? 1) : null);
    if (own == null) continue;
    total += Math.min(999, own + (m.buffCharisma ?? 0));
  }
  return total;
}

export function scaledHp(profile: StatProfile, level: number): number {
  if (profile.is_starter) return scaledStat(profile, "hp", level);
  // Champions store hp=1, growth_hp=1 — approximate from combat stats.
  return Math.round(80 + scaledStat(profile, "str", level) * level);
}

export function scaledMp(profile: StatProfile, level: number): number {
  if (profile.is_starter) return scaledStat(profile, "mp", level);
  return Math.round(20 + scaledStat(profile, "spt", level) * Math.floor(level / 2 + 1));
}

/** Max HP/MP for a profile at a level, plus permanent stat-item bonuses. Pure. */
export function evolvedMaxStats(
  profile: StatProfile, level: number, bonuses: { hp?: number; mp?: number } | null | undefined,
): { maxHp: number; maxMp: number } {
  return {
    maxHp: scaledHp(profile, level) + (bonuses?.hp ?? 0),
    maxMp: scaledMp(profile, level) + (bonuses?.mp ?? 0),
  };
}
