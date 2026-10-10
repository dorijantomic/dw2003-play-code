// The steal roll — FIGHTSTG_F0x800a1114, ported from pro/fightstg.s:31576-31694.
//
// The browser re-implements the steal proc as `trySteal` in web/battle.js:3013, which rolls
// `statusRoll(effect_p1 + stealBonus, enemy.wis, RAND_U16)` — a completely different formula
// (chance = atk - floor(def/8), on the 0..127 RNG scale). This routine is what the original
// actually does: a steal weight built from the technique's own weight byte, the acting side's
// effective `+0x3e` (the Hack Sticker / Hack System `steal_up` accessory), a stat ratio, and
// the enemy's level, rolled on the low ten bits of the RNG.
//
// The original's own words (fightstg.s), the a0&0xff == 0 path (the only one that reaches the
// roll — the a0&0xff != 0 branch re-tests its own side at .L0x800a11bc and returns 0):
//
//   .L0x800a1138  lbu v0, 0x2b61(0x8004) ; bnez -> return 0        the gate byte
//   .L0x800a115c  s0 = 0x800a4460 ; v0 = lw 0xc(s0) ; sll 5 ; addu   ctx + activeSlot*0x20
//   .L0x800a1164  v0 = lh 0x88(v0) ; blez -> return 0               the acting slot's gate
//   .L0x800a1178  F0x8009ec94(0, 1, lw 0x8(s0))                     build effective stats, near side
//   .L0x800a11b4  F0x8009ec94(0x10, 0, lw 0xc(s0))                  build effective stats, far side
//   .L0x800a11bc  andi v0, a0, 0xff ; bnez -> return 0              side 0 only
//   .L0x800a11c8  a0 = 0x800a4580 (the effective block)
//   .L0x800a11d0  v1 = lh 0xa(a0)
//   .L0x800a11e8  v1d = lh 0x4a(a0)
//   .L0x800a11f0  div ; mflo s1 = 100 * (+0xa) / (+0x4a)           the stat ratio, clamped below
//   .L0x800a11f8  v1 = 0x80042bca + 0x12 * techIndex                the technique record
//   .L0x800a1210  slti v0, s1, 0xc9 ; if s1 >= 201 -> s1 = 0xc8     ratio clamp to 200
//   .L0x800a1220  v0 = lbu 0xb(v1)                                  the technique's steal-weight byte
//   .L0x800a1224  v1 = lbu 0x3e(a0)                                 the acting side's steal_up bonus
//   .L0x800a122c  v0 = techWeight + stealBonus
//   .L0x800a1240  s0 = 100 * v0                                     (weight * 100)
//   .L0x800a1250  ctx + activeSlot*0x20 ; a0 = lh 0x70(v0)          the slot's enemy id
//   .L0x800a126c  v0 = [0x800a37fc] ; jalr v0                       F0x8009b8d0: id -> stats
//   .L0x800a1278  sra $s0, 0x6                                      DELAY SLOT: weight = (100*weight) >> 6
//   .L0x800a127c  v0 = lh 0x4(stats)                                the enemy level
//   .L0x800a1284  v1 = level * s1 ; s0 = v1 * s0                    product = level*ratio*weight
//   .L0x800a129c  magic 0x68db8bad, sra 0xc, sign-fix -> s0 / 10000
//   .L0x800a12b8  RNG() ; then sv0 v1 = (rng >> 10) ; sll 10 ; subu   low 10 bits = rng & 0x3ff
//   .L0x800a12e0  slt v1, s0 ; bnez -> return 1                     (rng & 0x3ff) < threshold
//
// So the threshold is `trunc(level * ratio * weight / 10000)` with `ratio = trunc(100*effNum/effDen)`
// clamped to 200 and `weight = trunc((100 * (techWeight + stealBonus)) / 64)` — the `>> 6` is
// the jalr's DELAY SLOT, so it runs before the resolver's own body and is easy to lose. The roll
// is `(rng & 0x3ff) < threshold`.
//
// `0x800a4580` is the effective stat block the routine reads; `+0xa` and `+0x4a` are the two
// effective fields it divides, and `+0x3e` is the accessory steal-weight byte the equipment
// system decodes (docs/research/battle/accessory-effects-decoded-2026-07-10.md:226).

/** The technique table base (`0x80042bca`), stride 0x12 per technique. */
export const STEAL_TECH_TABLE = 0x80042bca;
/** The technique record stride (`0x12`). */
export const STEAL_TECH_STRIDE = 0x12;
/** The technique record's own steal-weight byte (`+0x0b`). */
export const STEAL_TECH_WEIGHT_OFFSET = 0x0b;
/** The acting side's effective steal_up bonus byte (`+0x3e`, Hack Sticker / Hack System). */
export const STEAL_BONUS_OFFSET = 0x3e;
/** The two effective fields the ratio divides (`+0xa` numerator, `+0x4a` denominator). */
export const STEAL_EFF_NUM_OFFSET = 0x0a;
export const STEAL_EFF_DEN_OFFSET = 0x4a;
/** The ratio is clamped to 200 (`slti ..., 0xc9` / `li ..., 0xc8`). */
export const STEAL_RATIO_MAX = 0xc8;
/** The weight is `(100 * weight) >> 6` — the resolver jalr's delay slot (`.L0x800a1278`). */
export const STEAL_WEIGHT_SHIFT = 6;
/** The product is divided by 10000 (the `0x68db8bad` magic, `sra ..., 0xc`). */
export const STEAL_THRESHOLD_DIVISOR = 10000;
/** The roll is on the low ten bits of the RNG (`rng & 0x3ff`). */
export const STEAL_ROLL_MASK = 0x3ff;

/** `trunc(100 * effNum / effDen)`, clamped to 200 — the `.L0x800a11f0` ratio. */
export function stealRatio(effNum: number, effDen: number): number {
  const r = Math.trunc((100 * (effNum | 0)) / (effDen | 0));
  return r >= STEAL_RATIO_MAX + 1 ? STEAL_RATIO_MAX : r;
}

/** `trunc((100 * (techWeight + stealBonus)) / 64)` — the `.L0x800a1278` delay-slot shift. */
export function stealWeight(techWeight: number, stealBonus: number): number {
  return Math.trunc((100 * ((techWeight | 0) + (stealBonus | 0))) / (1 << STEAL_WEIGHT_SHIFT));
}

/** `trunc(level * ratio * weight / 10000)` — the `.L0x800a129c` magic division. */
export function stealThreshold(
  enemyLevel: number,
  ratio: number,
  techWeight: number,
  stealBonus: number,
): number {
  const weight = stealWeight(techWeight, stealBonus);
  return Math.trunc(((enemyLevel | 0) * (ratio | 0) * weight) / STEAL_THRESHOLD_DIVISOR);
}

/**
 * One steal proc. `rng` returns the raw RNG word (the original masks its low ten bits).
 * Returns true on a landed steal.
 */
export function stealProc(
  enemyLevel: number,
  effNum: number,
  effDen: number,
  techWeight: number,
  stealBonus: number,
  rng: number,
): boolean {
  const threshold = stealThreshold(enemyLevel, stealRatio(effNum, effDen), techWeight, stealBonus);
  return (rng & STEAL_ROLL_MASK) < threshold;
}
