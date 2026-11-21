import { unlockedTreeRecords, firstUnlockedTreeRecord, RAND_U16, scaledStat } from "../vendor/engine.js";
import { evolvedMaxStats } from "../battle.js";
import type { BattleEndContext, WinBattleRewardsArgs } from "./core/types.js";

/**
 * The Digimon a won battle PAYS — the set the reward is split between. One
 * rule, resolved from the marked set at the outcome, read by the share divisor,
 * the per-member payout, the DVEXP ladder, the level-up pass and the report
 * row's own participant flag.
 *
 * `b.participantIndices` is the marked set the battle accumulated: the lead at
 * setup, plus anybody tagged in or fused (`F0x800a69f0` / `F0x800a6b18`, the two
 * writers of the original's per-position flag byte). The original prunes it
 * before the report is built. The battle-outcome routine `F0x800a7c00` walks the
 * three live records and, for any whose CURRENT HP is not positive, writes 1 HP
 * to the roster and clears that position's flag byte and its three column bytes
 * in one block — pro/wfightmn.s .L0x00002044 `lh $v0, 0x8($s1)` /
 * .L0x0000204c `bgtz $v0, .L0x00002084` (so `<= 0` is the KO arm) /
 * .L0x0000206c `sh $v1, 0x788($v0)` / .L0x00002070-.L0x00002080
 * `sb $zr` at `0x6`/`0x7`/`0x8`/`0x9` of that row.
 *
 * The report then divides the reward by the number of rows whose flag is STILL
 * set, not by the number deployed — pro/stfgtrep.s .L0x00002c58
 * `lbu $v0, 0x6($a0)` / .L0x00002c60 `beqz` (skip) / .L0x00002c68
 * `addiu $a2, 0x1`, and `$a2` is the share divisor at .L0x00002cbc-.L0x00002d54.
 * So a member knocked out mid-fight is paid NOTHING **and** stops shrinking
 * everyone else's share: a solo survivor of a two-Digimon fight is paid the full
 * 100%, not 60%.
 *
 * Live HP is the right input, not the roster's. `writeBackBattleVitals` (the
 * `.L0x0000206c` 1-HP floor above) writes `statsRecord.hp` and never touches the
 * live `hp`, so this predicate reads the same value the original reads at
 * `.L0x00002044` no matter which of the two runs first.
 *
 * A marked position with no resident record cannot have been knocked out by the
 * fight, so it stays in rather than silently vanishing from the payout.
 */
export function paidParticipants(b: BattleEndContext) {
  const marked = b?.participantIndices;
  if (!marked?.size) return [];
  const out = [];
  for (const index of marked) {
    const record = b?.playerRecords?.[index];
    const hp = Number(record?.hp);
    if (record && Number.isFinite(hp) && hp <= 0) continue;  // knocked out at the outcome
    out.push(index);
  }
  return out;
}

// evolvedMaxStats is re-exported above, from engine/dw3/battle-stats.ts (one home).

// Which digivolutions this line can take right now. The disc has EIGHT trees, one
// per roster slot, and its unlock routine picks the tree by slot (0x8008903C) and
// scans that tree's 44 records in table order — never a table keyed by the form the
// member happens to be in. Both the battle report and the Digivolve menus ask the
// one rule in ./evo-trees.js, which is that routine. Nothing here re-indexes them.
//
// `evolutionTrees` and `digimonDB` are the battle's loaded data (both live inside
// createBattle, so they are passed in).
// `member` is { slot, stats }: the roster slot chooses the tree, and the member's
// own ledger, level and stats are the gates. Returns [{ record, index, toName }]
// in table order; a record already in the member's form ledger is left out, exactly
// as the routine's `bgez` skip does.
export function treeCandidatesFor(evolutionTrees, digimonDB, member) {
  if (!member?.stats || !evolutionTrees) return [];
  const stats = member.stats;
  const formLevels = Object.fromEntries((stats.formLedger ?? [])
    .map((record) => [Number(record.id), Number(record.formLevel ?? 1)]));
  return unlockedTreeRecords(evolutionTrees, member.slot, {
    formLevels, level: stats.level ?? 1, stats,
  }).map(({ record, index }) => ({
    ...record,
    index,
    toId: record.to,
    toName: digimonDB?.[record.to]?.name ?? null,
  }));
}

// The one form this line learns after this battle: the routine's FIRST passing
// record, and nothing else. Returns the record's target or null.
export function nextUnlockedEvolution(trees, slot, stats) {
  if (!stats) return null;
  const formLevels = Object.fromEntries((stats.formLedger ?? [])
    .map((record) => [Number(record.id), Number(record.formLevel ?? 1)]));
  const hit = firstUnlockedTreeRecord(trees, slot, {
    formLevels, level: stats.level ?? 1, stats,
  });
  return hit ? { ...hit.record, toId: hit.record.to, index: hit.index } : null;
}

// The equipped triple of one roster line, and the auto-equip that fills it.
// Ported from the digivolution unlock routine, pro/stfgtrep.s file 0x369C-0x390C
// (RAM 0x8008634C, overlay base 0x80082CB0):
//
//   0x3888  lw $v0, 0x2738($s5)   ctx+0x2738 = [0x8004B46C] = F0x800176AC
//                                 get_equipped(slot, out) — the valid entries
//                                 (id >= 3) in order, then -1 padding
//   0x3898  move_ $a0, $zr        i = 0
//   0x38A0  lh $v0, ($v1)         out[i]
//   0x38A8  slti $v0, $v0, 0x3    free slot := out[i] < 3
//   0x38AC  bnez $v0, 0x3824      -> write here
//   0x38B0  addiu $a0, 0x1        (delay slot) i + 1
//   0x38B4  slti $v0, $a0, 0x3    else keep going while i + 1 < 3
//   0x3824  move_ $a0, $s4
//   0x3828  sh $s1, ($v1)         out[i] = the new form's value0
//   0x382C  lw $v0, 0x273c($s5)   ctx+0x273c = [0x8004B470] = F0x800177d0
//   0x3834  jalr $v0              set_equipped(slot, out) — writes all three
//
// So the rule is: write into the FIRST slot holding a value < 3, and write the
// whole triple back through set_equipped. A line whose three slots already hold
// forms has no such slot — the loop falls out at 0x38BC/0x38C0, nothing is
// written and nothing is discarded; the routine still returns the new form's
// value0 ($s1 in the delay slot at 0x383C and 0x38C4), so the report line is the
// same either way. The freshly learned form stays in the acquired-form ledger
// (acquire_form at ctx+0x2744 runs before the scan), and the Digimon Lab's
// "Change digivolve type." (enumerate_acquired, F0x80017898 at [0x8004B474],
// gated at four acquired forms) is how the player puts it in a slot afterwards.
export const EQUIP_SLOTS = 3;

export function autoEquipForm(equipped, formId) {
  const current = Array.isArray(equipped) ? equipped : [];
  // get_equipped's view of the line: the entries its ids resolve to (id >= 3),
  // in slot order, then -1 padding.
  const held = current.filter((id) => Number(id) >= 3);
  if (held.length >= EQUIP_SLOTS) {
    // A full triple is left exactly as the player set it.
    return { equipped: current, equippedNow: false };
  }
  held.push(Number(formId));
  return { equipped: held, equippedNow: true };
}

// ── Progression: EXP thresholds, level-up rolls, battle rewards, gym drills ──
// Decoded from stfgtrep.s (exp fn 0x80086184, stat rolls 0x80085e3c, DVEXP 0x80086924/
// 0x800865c0) and stgtrain.s (appliers 0x800861bc/0x800862d0/0x800863d4/0x800865a0).
// Tables come from assets/data/progression.json (tools/extract_progression_tables.py).
// See docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md.

export const EXPADAPTER_ID = 321; // accessory: +20% EXP  (stfgtrep 0x1dd0 check)

export const BITADAPTER_ID = 322; // accessory: +20% Bits (stfgtrep 0x26c0 check)

// Total EXP that must be EXCEEDED (strict >) to reach `nextLevel`.
export function levelUpThreshold(growthXp: number, nextLevel: number, lu) {
  if (nextLevel >= 100) return Infinity;
  const bounds = lu.exp_tier_bounds; // [5, 20, 40, 100]
  let tier = bounds.length - 1;
  for (let i = 0; i < bounds.length; i++) if (nextLevel < bounds[i]) { tier = i; break; }
  const cubic = Math.floor(growthXp * (nextLevel ** 3 + 5 * nextLevel - 6) / 10);
  return cubic + lu.exp_tier_const[tier];
}

// Level after banking `exp` total EXP (may gain several levels; cap 99).
export function levelForExp(currentLevel, exp: number, growthXp: number, lu) {
  let lv = currentLevel;
  while (lv < (lu.level_cap ?? 99) && exp > levelUpThreshold(growthXp, lv + 1, lu)) lv++;
  return lv;
}

// Reward share per recipient: solo 100%, pair 60% each, 3+ splits evenly.
export function expShare(base: number, participants: number) {
  if (participants <= 1) return base;
  if (participants === 2) return Math.floor(base * 6 / 10);
  return Math.floor(base / participants);
}

// battle_rewards[screen_id] = [dvexp_base, exp_base, bits_base]; all-zero record = none.
// A battle with no id pays nothing (the disc's own record 0 is all-zero), so a missing id
// is a bug in the route that started the fight — say so rather than paying a guess.
export function battleRewardFor(screenId: string | number | null | undefined, rewards: { [x: string]: null; }) {
  if (screenId == null) {
    console.warn("[battle] battle started without a screenId: no EXP/BIT record, so it pays 0");
    return null;
  }
  const r = rewards?.[screenId] ?? null;
  if (!r || (r[0] === 0 && r[1] === 0 && r[2] === 0)) return null;
  return { dvexp: r[0], exp: r[1], bits: r[2] };
}

// What one participant of a won battle is paid, from that record and nothing else: the
// share is 100% solo / 60% each for two / one third each for three (stfgtrep 0x2ce0-0x2d54)
// and the EXP/BIT Adapter accessories add x/5 (0x1dd0 / 0x26c0). No record means 0 EXP and
// 0 BIT — the original awards per BATTLE, never per enemy.
export function winBattleRewards({ screenId, participants = 1, equipment = {}, rewards }: WinBattleRewardsArgs) {
  const rw = battleRewardFor(screenId, rewards);
  const share = Math.max(1, participants);
  const boost = (v: number, id: number | undefined) => (equipment.acc0 === id || equipment.acc1 === id) ? v + Math.floor(v / 5) : v;
  return {
    xp:    boost(expShare(rw?.exp ?? 0, share), EXPADAPTER_ID),
    bits:  boost(rw?.bits ?? 0, BITADAPTER_ID),
    dvexp: rw?.dvexp ?? 0,
  };
}

// Per-form DVEXP gain: level-scaled from the battle's dvexp base, then the party share,
// min 1, capped 10 below the form's DV-level cap (profile byte +0x3c) and 50 at/past it.
export function dvexpGain(base: number, partnerLevel: number, participants: number, formLevel: number, formCap: number) {
  const div = Math.min(Math.max(partnerLevel, 1), 50);
  let amt = expShare(Math.floor(base * 10 / div), participants);
  if (amt <= 0) amt = 1;
  return Math.min(amt, formLevel < formCap ? 10 : 50);
}

// One level-up's random stat gains (rolled at the NEW level). The shipped game applies
// these to stored current stats, and so does the walker's stored-stat model below
// (applyLevelUpGains) — joined to stfgtrep 0x80085e3c in STAT-Q002-LEVELUP-STATROLL-JOIN-001.
export function rollLevelUpGains(profile, newLevel: number, lu, rng = RAND_U16) {
  const g = profile.growth ?? {};
  const tier4 = newLevel < 5 ? 0 : newLevel < 20 ? 1 : newLevel < 40 ? 2 : 3;
  const hpmp = (growth: number) => growth - lu.hpmp_tier_adj[tier4] + lu.hpmp_rand9[rng() % 9];
  const bounds = lu.core_tier_bounds; // [5, 20, 40, 60, 80]
  let tier6 = bounds.length;
  for (let i = 0; i < bounds.length; i++) if (newLevel < bounds[i]) { tier6 = i; break; }
  // The disc reads the six 9-word core rows and the 8-word element table as ONE
  // contiguous block (core at 0x800891B0, the element table right after it at
  // 0x80089288, overlay end at 0x800892A8). A roll can run off a row's end, and
  // the read follows the memory: growth 5 with rand%5==4 reads the NEXT row's
  // first word (tiers 0-4; tier 5 reads the element table's first word, a 0), and
  // growth 5 with rand%4==3 reads the word past the whole block — the RAM after
  // the 0x65F8-byte overlay, which is 0 in every captured dump (the overlay file
  // ends exactly at the table). The old code clamped to the tail (a 2) in both
  // cases and returned 0 for the core overflow; the disc adds the block's own
  // word instead.
  const coreRows = (lu.core_table ?? []).flat();
  const stride = lu.core_table?.[0]?.length ?? 9;
  const block = coreRows.concat(lu.elem_table ?? []);
  const core = {};
  for (const k of ["str", "def", "spt", "wis", "spd", "chr"])
    core[k] = block[tier6 * stride + (g[k] ?? 0) + rng() % 5] ?? 0;
  const elems = {};
  if (newLevel < (lu.elem_level_limit ?? 41)) {
    for (const k of ["fire", "water", "ice", "wind", "thunder", "machine", "dark"]) {
      const idx = coreRows.length + (profile.resistance_growth?.[k] ?? 0) + rng() % 4;
      elems[k] = block[idx] ?? 0;
    }
  }
  return { hp: hpmp(g.hp ?? 0), mp: hpmp(g.mp ?? 0), core, elems };
}

// ── Stored-stat model ──
// The shipped game keeps CURRENT stats on the roster record (+0x22 maxHP, +0x26 maxMP,
// +0x28.. core, +0x34.. elems) and mutates them by rollLevelUpGains on level-up and by gym
// drills; nothing re-derives them from the profile. The walker mirrors that with
// ps.stats (core), ps.maxHp/maxMp, and ps.elemBonuses (trained elemental points on top of
// profile.resistances). Old derived-stat saves are migrated by seeding the profile×level
// baseline once (identical totals at seed time).

export const CORE_STATS = ["str", "def", "spt", "wis", "spd", "chr"];

// Profile-derived baseline for the core block — used to migrate old saves and to reseed
// on evolution (form change swaps the whole stat body in the walker's model).
export function seedStoredStats(profile, level) {
  const s = {};
  for (const k of CORE_STATS) s[k] = scaledStat(profile, k, level);
  return s;
}

// Seed ps.stats if missing (old save / fresh partner); returns the live block.
export function ensureStoredStats(ps, profile) {
  if (!ps.stats) ps.stats = seedStoredStats(profile, ps.level ?? 1);
  return ps.stats;
}

// Apply one level-up's rolled gains in place (fn 0x80085e3c store semantics: plain adds,
// clamp maxHP/maxMP at 9999 and core/elems at 999; there is NO lower clamp).
export function applyLevelUpGains(ps, gains, lu: { hpmp_cap: number; stat_cap: number; }) {
  const hpmpCap = lu?.hpmp_cap ?? 9999;
  const statCap = lu?.stat_cap ?? 999;
  ps.maxHp = Math.min((ps.maxHp ?? 0) + gains.hp, hpmpCap);
  ps.maxMp = Math.min((ps.maxMp ?? 0) + gains.mp, hpmpCap);
  ps.stats ??= {};
  for (const k of CORE_STATS)
    ps.stats[k] = Math.min((ps.stats[k] ?? 0) + (gains.core[k] ?? 0), statCap);
  const elems = gains.elems ?? {};
  if (Object.keys(elems).length) {
    ps.elemBonuses ??= {};
    for (const k of Object.keys(elems))
      ps.elemBonuses[k] = Math.min((ps.elemBonuses[k] ?? 0) + elems[k], statCap);
  }
  return ps;
}

// One partner's level-up, applied once (stfgtrep fn 0x80086184 + rolls 0x80085e3c):
// rolls every level gained onto the stored stats, adds TP +5 a level (clamped at 99 —
// the disc's check is `if (TP+5 >= 100) TP = 99`, file 0x3658-0x3664) and sets the
// level. NOTHING refills HP or MP: the disc's routine writes only the 19-halfword
// block's level/TP/maxHP/maxMP/stat halfwords (the current-HP halfword at record
// +0x20 and current MP at +0x24 are never a store target there), so a level-up keeps
// the damage the battle left. The old walker code healed the partner to full here.
//
// `growthProfile` is the row the disc's rolls read: the member's STARTER species'
// (levelUpGrowthProfile), never the active form's. `prof` stays the active form only
// for the no-progression-table branch, which has no disc counterpart.
export function applyLevelUp(ps, prof, oldLevel: number, newLevel: number, lu, growthProfile = prof) {
  ps.level = newLevel;
  if (lu) {
    ensureStoredStats(ps, growthProfile);
    for (let lv = oldLevel + 1; lv <= newLevel; lv++)
      applyLevelUpGains(ps, rollLevelUpGains(growthProfile, lv, lu), lu);
  } else {
    // No progression table (progression.json failed to load — loadData's `.catch(() =>
    // null)` at :3410): the same max HP/MP rule as evolution, so a non-starter form gets
    // 80 + str*level, not the `hp` placeholder. This is the only path that reaches here:
    // every battle entry point awaits loadData, and the shipped table has `level_up`.
    const { maxHp, maxMp } = evolvedMaxStats(prof, newLevel, ps.bonuses);
    ps.maxHp = maxHp;
    ps.maxMp = maxMp;
  }
  const tpCap = lu?.tp_cap ?? 99;
  ps.tp = Math.min((ps.tp ?? 0) + (lu?.tp_per_level ?? 5) * (newLevel - oldLevel), tpCap);
  return ps;
}

// The profile whose growth bytes the disc's level curve and level-up rolls read:
// the member's STARTER species' row for its roster slot — `0x8003EF5C + slot*0x58`
// — never the active form's row. F0x80086184 computes that address and reads
// growth_xp at +0x3E (recovered/ddw3/decomp/pro/stfgtrep/F0x80086184.c line 25;
// pro/stfgtrep.s .L0x00003548 builds s4, .L0x000035BC `lbu 0x3e($s4)`), and
// F0x80085E3C reads the growth bytes +0x41/+0x42/+0x43+i/+0x49+i from the same row
// (.L0x000031EC builds s5, then .L0x00003228 / .L0x000032AC / .L0x0000338C /
// .L0x00003434 read them). For the eight starters the slot's row is exactly
// `rookieId - 1` (ROSTER_SLOT_CHARIDS), so the source is the rookie profile. A
// partner fighting as a digivolution therefore keeps the starter's curve and rolls:
// the slot1_ram RAM dump (slot0 standing in Dinohumon, exp 2985 -> level 15) only
// fits the starter's growth_xp 8, not the form's 1.
export function levelUpGrowthProfile(player, profiles) {
  const rookie = profiles?.[Number(player?.rookieId)];
  return rookie ?? player?.profile ?? null;
}

// DV form level from banked DVEXP (fn 0x800865c0): while L<99 and dvexp >= thr(L), L+=1;
// thr(L) = 10·L below the profile's DV cap, then 10·(cap−1) + 50·(L−cap+1) past it.
export function dvLevelForExp(dvexp: number, dvCap: number, levelCap = 99) {
  let lv = 0;
  const thr = (L: number) => L < dvCap ? 10 * L : 10 * (dvCap - 1) + 50 * (L - dvCap + 1);
  while (lv < levelCap && dvexp >= thr(lv)) lv++;
  return lv;
}

// One form's DVEXP bank for a battle: add the gain (capped 9,999,999) and run the
// ladder (fn 0x800865c0). The disc's ladder routine reads the form's state, adds the
// gain, and RETURNS BEFORE its write-back when the form already stands at level 99
// (stfgtrep.s file 0x3994 `slti $v0, 0x63` / file 0x399C `j 0x800866f0` jumps to the
// epilogue, skipping the [0x8004B480] store at file 0x3A28), so a maxed form banks
// NOTHING and its DVEXP total freezes. Returns true when the form gained a level.
export function bankFormDvexp(record: { formLevel: number; dvexp: number; }, gain: number, formCap: number, dvexpCap = 9999999) {
  const oldLevel = record.formLevel ?? 1;
  if (oldLevel >= 99) return false;
  record.dvexp = Math.min(Number(record.dvexp ?? 0) + gain, dvexpCap);
  while (record.formLevel < 99 && record.dvexp >= (record.formLevel < formCap
    ? 10 * record.formLevel
    : 10 * (formCap - 1) + 50 * (record.formLevel + 1 - formCap))) {
    record.formLevel++;
  }
  return record.formLevel > oldLevel;
}

// The DVEXP share divisor: ONE PER SET FORM FLAG BYTE across the rows still flagged
// as reward participants — not the number of standing positions. The report root's
// tick counts them (stfgtrep.s file 0x2C58-0x2CB4: per flagged row, per set byte
// 7+v, `lw $v0, 0x70($s4)` / `sw` at file 0x2C8C-0x2C98), and each row's dvGain call
// passes that count (file 0x1368 `lw $a3, 0x70($v1)`, v1 = the row's +0x50 parent).
// A form taken mid-battle is a second mark on the same row, so it enlarges the
// divisor: a solo lead that DV'd once splits its DVEXP two ways (60% each), not 100%.
export function dvexpShareCount(formFlags, indices: number[]) {
  let marks = 0;
  for (const index of indices ?? []) {
    const flags = formFlags?.[index];
    for (let i = 0; i < 3; i++) if (Number(flags?.[7 + i] ?? 0)) marks++;
  }
  return Math.max(1, marks);
}
