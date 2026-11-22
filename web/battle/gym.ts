import { RAND_U16 } from "../vendor/engine.js";
import { CORE_STATS } from "./progress.js";
import type { DigimonRecord } from "../types/battle.js";
interface GymRecord {
  tp_costs: number[];
}

interface GymDrillEntry {
  id: number;
  stat: string;
  reps: number;
}


// Gym drill catalog for a gym rank (1..14): [{ drill, primary, secondary }].
export function gymDrillsForRank(rank: number, gym) {
  return gym.rank_menus[Math.min(Math.max(rank, 1), gym.rank_menus.length) - 1] ?? [];
}

const GYM_CORE_STATS = [null, "str", "def", "spt", "wis", "spd"];

const GYM_ELEM_STATS = [null, null, null, null, null, null, null, null,
                        "fire", "water", "ice", "wind", "thunder", "machine", "dark"];

// A drill's `primary`/`secondary` are the game's own stat ids, and the gym
// screen needs the same mapping to pick which of its result messages to say
// (each message index is a base plus the id). One table, exported, rather than
// a second copy in web/gym.js.
export function gymStatForId(id: number) {
  if (id >= 1 && id <= 5) return GYM_CORE_STATS[id];
  if (id >= 8 && id <= 14) return GYM_ELEM_STATS[id];
  if (id === 15) return "maxHp";
  if (id === 16) return "maxMp";
  return null;
}

// Resolve one training run into stat deltas. Pure: caller applies them + spends TP.
//   drillEntry = { drill, primary, secondary } (from gymDrillsForRank)
//   tpChoice   = 0/1/2 (TP 1 / TP 5 / TP10), ultra = "Ultra Training Chance" challenge won
//   dig        = { elemGrowth: {fire:1..5,...}, elemCur: {fire:0..999,...} } for brackets
// Returns { tpCost, effects: [{ stat, delta }] } (negative delta = loss; "maxHp"/"maxMp").
export function gymTrainingResult(drillEntry, tpChoice, ultra: boolean, dig, gym, rng = RAND_U16) {
  const roll = ([base, range]) => base + (range ? rng()! % range : 0);
  const superDrill = drillEntry.drill >= 13;
  const variant = !ultra ? 0 : superDrill ? 2 : 1; // elem/hpmp row variant
  const effects = [];
  const applyEffect = (id: number, isPrimary: boolean) => {
    if (!id) return;
    if (id >= 1 && id <= 5) {
      if (isPrimary) { // core gain (0x8008c304): (super?6:0) + ultra*3 + tpChoice
        const row = gym.core_rows[(superDrill ? 6 : 0) + (ultra ? 3 : 0) + tpChoice];
        effects.push({ stat: GYM_CORE_STATS[id], delta: roll(row) });
      } else if ((rng()! & 1) === 0) {
        // core loss (0x8008c364), applier 0x800862d0: only rolled in when rand()&1 == 0
        // (50% of trainings); the store floor-clamps the stat at 0.
        effects.push({ stat: GYM_CORE_STATS[id], delta: -roll(gym.loss_rows[tpChoice]) });
      }
    } else if (id >= 8 && id <= 14) { // elemental gain: bracket by current stat + growth
      const elem = GYM_ELEM_STATS[id];
      const cur = dig?.elemCur?.[elem] ?? 0;
      const bracket = cur < gym.elem_brackets[0] ? 0 : cur < gym.elem_brackets[1] ? 1 : 2;
      const growth = Math.min(Math.max(dig?.elemGrowth?.[elem] ?? 1, 1), gym.elem_ptr.length);
      const table = gym.elem_tables[gym.elem_ptr[growth - 1][bracket]];
      effects.push({ stat: elem, delta: roll(table[variant + tpChoice * 3]) });
    } else if (id === 15 || id === 16) { // maxHP/maxMP gain (0x8008c490)
      const row = gym.hpmp_rows[variant + tpChoice * 3];
      effects.push({ stat: id === 15 ? "maxHp" : "maxMp", delta: roll(row) });
    }
  };
  applyEffect(drillEntry.primary, true);
  applyEffect(drillEntry.secondary, false);
  return { tpCost: gym.tp_costs[tpChoice], effects };
}

// Rep-success percent for the mid-training widget polls (stgtrain helper 0x80086abc,
// call site 0x44d4: percent = v0 + 0x4b): base 75, +3 when TrainingBook (337) sits in
// either accessory slot (native roster +0x3c8/+0x3ca) — checked FIRST, so the book wins
// over the brace — else +6 when PowerBrace (338) does. The bonuses do NOT stack.
export function gymRepPercent(equip) {
  const a = equip?.acc0, b = equip?.acc1;
  if (a === 337 || b === 337) return 78;
  if (a === 338 || b === 338) return 81;
  return 75;
}

// The mid-training rep widget polls (stgtrain rep task F0x800871ac + widget F0x800897b8).
// Each rep = rand%100 <= percent (widget case 4: (unk9C < rand%100) ^ 1). The task starts
// with a 3-rep round (unk18 = 2, set in state 54 F0x80087110); a clean sweep of all three
// triggers the "Ultra Training Chance!" offer (@0x71f0: unk64 && unk68 && unk6c → state 0xA),
// while a SUPER drill (id >= 13, unk60 >= 0xD) that did NOT sweep extends to a 5-rep round
// (unk18 2→4 at 0x71fc). Basic drills always stop at three. Returns the per-rep results for
// the rep-marker row (F0x80086c0c: hit → ring clip 0x45, miss → X clip 0x46).
export function gymRepResults(percent: number, superDrill = false, rng = RAND_U16) {
  const reps = [0, 1, 2].map(() => rng()! % 100 <= percent);
  if (superDrill && !reps.every(Boolean)) {
    reps.push(rng()! % 100 <= percent, rng()! % 100 <= percent);
  }
  return reps;
}

// "Ultra Training Chance" challenge roll (stgtrain widget 0x7074): rand%100 <= percent,
// percent = 50 (set at 0x513c) — forced to 0 (0x5110) when the drill equals the one the
// LAST won challenge trained (remembered in roster byte +0x3cc), so the same drill can
// never win twice in a row. Win ⇒ ultra tables + remember drill; lose ⇒ "Failed..." +
// normal tables.
export function ultraChanceRoll(drill, lastUltraDrill, rng = RAND_U16) {
  const percent = drill === lastUltraDrill ? 0 : 50;
  return rng()! % 100 <= percent;
}

// Total session stat change. DECODED 2026-07-13 (F0x800866cc + F0x80087334): the native
// applies a fresh gain roll PER REP but ONLY on a hit (F0x800866cc computes `slot->unk78`
// / `unk8C` inside `if (result != 0)`), then SUMS every rep slot (F0x80087334 loops all
// five `+0x78`/`+0x8C` into the primary/secondary totals). So the stat change = one
// `gymTrainingResult` roll PER O — an X contributes nothing, and more O's (4th/5th
// attempts) mean a proportionally bigger gain. The bonus/challenge rep, when WON, adds one
// more roll rolled with the ultra tables (F0x80087e18 sets `+0xd8` then applies rep 3);
// a lost challenge (its X) adds nothing. If every rep missed (zero total) the native shows
// "Failed..." (estraini 71, F0x80087334 `arg4==0 && arg5==0` branch).
//   repResults   = the ordinary reps (3, or 5 for a super/starred drill or an "As is" pick)
//   challengeWon = null (no bonus rep) | true (won → +1 ultra roll) | false (lost → nothing)
export function gymSessionResult(drillEntry: GymDrillEntry, tpChoice: number, repResults: boolean[], challengeWon: boolean, dig: DigimonRecord, gym: GymRecord, rng = RAND_U16): { tpCost: number; effects: { stat: string; delta: number }[] } {
  const totals = new Map();
  const add = (fx) => { for (const { stat, delta } of fx) totals.set(stat, (totals.get(stat) ?? 0) + delta); };
  for (const ok of repResults) if (ok) add(gymTrainingResult(drillEntry, tpChoice, false, dig, gym, rng).effects);
  if (challengeWon === true) add(gymTrainingResult(drillEntry, tpChoice, true, dig, gym, rng).effects);
  return { tpCost: gym.tp_costs[tpChoice], effects: [...totals].map(([stat, delta]) => ({ stat, delta })) };
}

// Apply gymTrainingResult effects to the stored-stat block (store semantics as the
// level-up rolls: maxHp/maxMp cap 9999, core/elems cap 999, core loss floors at 0).
export function applyGymEffects(ps, effects, lu: { hpmp_cap: number; stat_cap: number; }) {
  const hpmpCap = lu?.hpmp_cap ?? 9999;
  const statCap = lu?.stat_cap ?? 999;
  ps.stats ??= {};
  for (const { stat, delta } of effects) {
    if (stat === "maxHp" || stat === "maxMp") {
      ps[stat] = Math.min((ps[stat] ?? 0) + delta, hpmpCap);
    } else if (stat in ps.stats || CORE_STATS.includes(stat)) {
      ps.stats[stat] = Math.min(Math.max((ps.stats[stat] ?? 0) + delta, 0), statCap);
    } else { // elemental gains accumulate on the trained-elemental block
      ps.elemBonuses ??= {};
      ps.elemBonuses[stat] = Math.min((ps.elemBonuses[stat] ?? 0) + delta, statCap);
    }
  }
  return ps;
}
