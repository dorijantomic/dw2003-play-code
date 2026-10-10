// engine/dw3/battle-formulas.ts
// Pure, testable battle math, mirroring the decoded PS1 disasm. Ported from
// web/battle-formulas.js. No DOM/canvas. Randomness injected via `rng` (RAND_U16).
//
// Authority: docs/research/battle/battle-formula-leaves.md (each function cites the decoded
// source in ~/ddw3/asm/dw2003/pro/fightstg.s / wfightmn.s).

import { randU16 } from "./random-stream.ts";

export interface EffStats {
  level?: number;           // leading effective halfword +0x00
  str: number;
  def: number;
  spt: number;
  wis: number;
  spd: number;
  /** Effective +0x38, the crit contribution — RAW (default 0). The doubling the
   *  crit roll's plain-attack arm applies when `aura` is set is the ROLL's own
   *  step (fightstg.s:30700 `sll $v0, 0x1`), so it does not live in this value;
   *  the accuracy leaf reads the same byte undoubled (`:30960 lbu $v0, 0x38($a2)`). */
  crit?: number;
  /** The attacker's effective +0x1B flag (AuraPlug), read by the crit roll's
   *  plain-attack arm only: it doubles the +0x38 contribution. */
  aura?: boolean;
  armor?: number;           // flat reduction +0x27 = equipment armor (default 0)
  resistances?: Record<string, number>; // element ×100 table (100 = neutral)
  elementalAttack?: { element?: string; amount: number };
  family?: number;          // effective +0x25 raw profile byte
  accuracyBonus?: number;   // equipment pool +0x3a, added to attacker SPD
  multiAttack?: boolean;    // effective +0x37 != 0 (Multi Crest): 3-hit divert + 0.4x per hit
  magicalCritStatusBonus?: number; // the target's +0x1c intensity terms; supplied by effStats, read by magicalCritProc from the DEFENDER's view
  /**
   * Effective +0x26, the affinity multiplier byte, copied from the live combatant
   * record's +0x0E. F0x8009f6dc stage 3 (0x8009f7b0) adds `running * byte / 64`
   * on the ACTING side's block when the byte is nonzero. No writer for the live
   * record's +0x0E was found in any overlay, so every captured battle carries 0
   * and this stage never fires until one is located; the stage itself is ported.
   */
  affinity?: number;
  /**
   * Effective +0x28..: the stat-record byte +0x12 of every worn family 2..14 piece
   * that carries one (`wornFamilyBytes`). F0x8009f6dc stage 2's plain-attack arm
   * (0x8009f77c) scans +0x28..+0x2A for a value equal to the defender's +0x25 and adds
   * half the running damage (x1.5). F0x800a02ac's crit roll scans the same three bytes
   * for a family equal to the defender's and adds 0x10.
   */
  weaponFamilies?: readonly number[];
  /**
   * Effective +0x3B: the combatant's evasion pool (equipment evade_up). Read ONLY by
   * the enemy branch of the accuracy leaf F0x800a06ac, which folds it into the SPD
   * difference (`diff = SPD − SPD − evasion`, then /8); the player branch never sees
   * it.
   */
  evadeBonus?: number;
  /**
   * The combatant's own +0x1d>>3 (paralyzed), +0x1e>>3 (asleep) and +0x1f>>1
   * (confused) terms, summed. The crit roll F0x800a02ac reads them from the OTHER
   * team's fighter record (`fighters[side == 0]` — the target), so a caller computes
   * this on the DEFENDER's view and `critProc` adds it as `def.critStatusBonus`.
   */
  critStatusBonus?: number;
  /** The acting side's byte — 0 the player (SIDE_PLAYER), 0x10 the enemy (SIDE_ENEMY).
   *  F0x800a06ac runs a different formula per side, so the roll needs it. */
  sideByte?: number;
  /** FIGHTSTG_battle.kind (0x800a4536). 6 = BATTLE_KIND_FINAL_LAST, whose player-side
   *  accuracy is the fixed `(RAND & 0x7f) >= 0x2b` roll. */
  battleKind?: number;
}

export interface Skill {
  power: number;            // +0x2 raw game power units
  element?: string;         // +0x7 element name ("normal" = none)
  base_acc?: number;        // +0x6 base accuracy
  /** Raw record byte +0x0A, the TECH_EFFECT_* opcode (the "f7" byte): < 2 = a plain
   *  attack, >= 2 = a technique, 0x0B = TECH_EFFECT_CRITICAL. The skill bank supplies
   *  it where the raw table is available; `effect` is the name-only fallback. */
  effect_id?: number;
  effect?: string;          // f7 effect name (e.g. "precision")
  effect_p1?: number;       // f8 effect param 1 (proc chance / magnitude)
  effect_p2?: number;       // f9 effect param 2 — the SAME byte as effectPower (+0xC)
  /** Raw +0x0C, TechData.effectPower: the crit-chance addition of a TECH_EFFECT_CRITICAL
   *  technique (and the drain ratio, a boost's amount, ... by effect). */
  effect_power?: number;
  basic_attack?: boolean;   // enables the equipment +0x2b/+0x2c basic-attack term
  /** Raw record byte +0x10, the action-script clip. The Multi-Crest plain-attack
   *  gate (F0x8009e0cc .L0x8009e24c and F0x8009f6dc .L0x8009f88c) skips the 3-hit
   *  diversion and the 0.4x stage when this byte is 0x0b or 0x0c. */
  clip?: number;
  magical?: boolean;        // routes elemental damage through FIGHTSTG's magical curve
  target_family?: number;   // raw skill +0x9, compared with defender effective +0x25
  damage_scalar?: number;    // raw skill +0x8, used by the magical crit roll
}

export interface ElementalField { element: string; power: number; }

const ELEMENT_ID: Record<string, number> = {
  normal: 1, fire: 2, water: 3, ice: 4, wind: 5, thunder: 6, machine: 7, dark: 8,
};

/** Element name -> the numeric id the original stores in `0x800a4530` (and the
 *  record/element tables). Unknown/normal names resolve to 1. */
export function elementId(name: string | undefined | null): number {
  return ELEMENT_ID[name ?? "normal"] ?? 1;
}

// Table 0x800a4670 indexed by the attacking element. If the active field matches
// this value, F0x8009f644 applies the opposing-field penalty.
const FIELD_COUNTER = [0, 0, 4, 2, 5, 3, 7, 8, 6];

/** F0x8009f644: signed pre-resistance field adjustment. */
export function elementalFieldAdjustment(
  base: number,
  attackElement: string | undefined,
  field: ElementalField | null | undefined,
): number {
  if (!field || field.power <= 0) return 0;
  const attackId = ELEMENT_ID[attackElement ?? "normal"] ?? 1;
  const fieldId = ELEMENT_ID[field.element] ?? 1;
  if (fieldId < 2 || attackId < 2) return 0;
  if (attackId === fieldId) return Math.trunc((base * field.power) / 128);
  if (FIELD_COUNTER[attackId] === fieldId) return -Math.trunc((base * field.power) / 256);
  return 0;
}

/**
 * Production RNG matching RAND_U16 (0x8004dc0c). The disc has ONE random stream
 * and this is it: the table walk `rand_u16` (exe/fns.s:10116-10134), whose
 * implementation is engine/dw3/random-stream.ts. It used to be
 * `(Math.random() * 0x10000) | 0` -- the same range, a different source -- so every
 * battle roll drew from its own sequence instead of sharing the game's.
 */
export const RAND_U16 = randU16;

/**
 * GCC signed `/ 100` as used by check_move_cond and the DV-gauge draw:
 * multiply by 0x51eb851f, take the high 32 bits, sra 5, subtract the sign.
 */
export function signedDiv100(n: number): number {
  const x = n | 0;
  const hi = Number((BigInt(x) * 0x51eb851fn) >> 32n) | 0;
  return ((hi >> 5) - (x >> 31)) | 0;
}

/**
 * HP-fraction threshold for check_move_cond 2/3/6/7 (fightstg/check_move_cond.s .L2).
 * `threshold = i16(maxHP / 100) * ((cmp * 100) >> 7)`, with +0x7f before the
 * `>> 7` when `cmp * 100` is negative. Not `maxHP * cmp / 128`.
 */
export function hpFractionThreshold(maxHp: number, cmp: number): number {
  const c = (cmp << 16) >> 16;
  let scaled = ((((c * 2 + c) << 3) + c) << 2);
  if (scaled < 0) scaled += 0x7f;
  const factor = scaled >> 7;
  const hundredths = (signedDiv100((maxHp << 16) >> 16) << 16) >> 16;
  return hundredths * factor;
}

/**
 * Inputs for the `check_move_cond` predicates whose original operands are
 * fight-workspace globals or records the walker models separately. An undefined
 * field means the caller does not own that operand; a predicate that needs it
 * returns null rather than guessing.
 */
export interface EnemyMoveContext {
  /** Active party member's live form: DIGIMON_PROFILES row id (record +0x00 species). */
  partyProfileId?: number | null;
  /** i16 @0x800a4530 — active elemental field id (ELEMENT_ID values; 0 = none). */
  fieldElementId?: number | null;
  /** u32 @0x80042b2c — the current battle's screen id. */
  battleId?: number | null;
  /** u8 @0x80042b59 — encounter config byte 1 (`battle_config.raw_2b58_2b65[1]`). */
  encounterGateByte?: number | null;
  /** The simultaneous enemy records; the actor at `activeEnemyIndex` is skipped. */
  enemySlots?: ReadonlyArray<{ hp?: number; speciesId?: number }> | null;
  activeEnemyIndex?: number | null;
}

/**
 * Decoded enemy move predicates whose inputs exist in the walker combatant model.
 * Returns null when the original predicate depends on an unmodelled fight-workspace
 * field; callers must then skip that move instead of inventing a condition.
 *
 * FIGHTSTG_check_move_cond, jump table @0x80082d58 (fightstg/check_move_cond.s):
 *   0 = always, 1 = random/128, 2/3 = self HP below / at-or-above fraction,
 *   4/5 = current MP below/at-or-above value, 6/7 = other HP below / at-or-above,
 *   8 = the active party form is one of the eight partner profiles,
 *   10 = another enemy slot is alive (cmp 0) or that species is alive (cmp != 0),
 *   11 = the active elemental field id equals value,
 *   12 = the battle screen id equals value,
 *   13 = encounter config byte 1 equals value.
 * Still unmodelled (null): 9 (self +0x2c & 0x8) and 14-18 (self +0x04/+0x0e..
 * +0x14), whose operand identities are unread; see
 * docs/research/battle/enemy-ai-move-conditions.md.
 */
export function enemyMoveCondition(
  condition: number,
  value: number,
  self: { mp: number; hp?: number; maxHp?: number },
  rng: () => number,
  other?: { hp: number; maxHp: number },
  context?: EnemyMoveContext,
): boolean | null {
  const cmp = (value << 16) >> 16;
  switch (condition) {
    case 0: return true;
    case 1: return (rng() & 0x7f) < value;
    case 2:
    case 3: {
      if (self.hp == null || self.maxHp == null) return null;
      const below = self.hp < hpFractionThreshold(self.maxHp, value);
      return condition === 2 ? below : !below;
    }
    case 4: return self.mp < value;
    case 5: return self.mp >= value;
    case 6:
    case 7: {
      if (!other) return null;
      const below = other.hp < hpFractionThreshold(other.maxHp, value);
      return condition === 6 ? below : !below;
    }
    case 8: {
      // .L002: the active party record's +0x00 (live form id) is matched against
      // the first halfword of DIGIMON_PROFILES rows 0..7 -- the eight partner
      // profiles (Kotemon..Patamon). The walker names the same rows by id 1..8.
      const formId = context?.partyProfileId;
      if (formId == null) return null;
      return formId >= 1 && formId <= 8;
    }
    case 10: {
      // .L005: walk the three enemy records, skipping the actor. cmp 0 = any
      // other slot alive; cmp != 0 = that species alive.
      const slots = context?.enemySlots;
      if (!slots) return null;
      const active = context?.activeEnemyIndex ?? 0;
      for (let i = 0; i < slots.length; i++) {
        if (i === active) continue;
        const slot = slots[i];
        if (!slot) continue;
        const species = slot.speciesId ?? 0;
        if (species === 0) continue;
        if (cmp !== 0 && species !== cmp) continue;
        if ((slot.hp ?? 0) !== 0) return true;
      }
      return false;
    }
    case 11:
      // .L21: i16 @0x800a4530. F0x8009f644 reads the same global as the active
      // field element, so a battle with no field is id 0.
      return (context?.fieldElementId ?? 0) === cmp;
    case 12: {
      // .L22: u32 @0x80042b2c is the battle's screen id (fieldstg hands the
      // encounter screen id to 0x8008b798, which stores it there).
      const battleId = context?.battleId;
      if (battleId == null) return null;
      return battleId === cmp;
    }
    case 13: {
      // .L23: u8 @0x80042b59, encounter config byte 1 (screen record +0x0d).
      const gate = context?.encounterGateByte;
      if (gate == null) return null;
      return (gate & 0xff) === (cmp & 0xff);
    }
    default: return null;
  }
}

/** FIGHTSTG_F0x80089148: enemy AI action 1=Fight, 2=Tech A, 3=Tech B.
 *  Action 4 is the flee special; 5–8 select another enemy slot and are not techniques. */
export function enemyActionSkillId(
  action: number,
  skills: { attack?: number; move_1?: number; move_2?: number },
): number | null {
  switch (action) {
    case 1: return skills.attack || null;
    case 2: return skills.move_1 || null;
    case 3: return skills.move_2 || null;
    default: return null;
  }
}

/** Physical pre-element base — F0x8009f97c → STR·power/DEF. */
export function physicalBase(atk: EffStats, def: EffStats, power: number): number {
  return Math.floor((atk.str * power) / Math.max(1, def.def));
}

/**
 * Magical base — F0x8009fab4 player branch [battle-magical-base-player-2026-09-05].
 * The move power is scaled by the SPT ratio, then bounded to half through twice
 * that raw power before the later element/critical/armor stages.
 */
export function magicalBase(atk: EffStats, def: EffStats, power: number): number {
  const mid = Math.floor((50 * atk.spt) / Math.max(1, def.spt)) + 50;
  const base = Math.floor((power * mid) / 100);
  return Math.min(power * 2, Math.max(Math.floor(power / 2), base));
}

/** The technique's raw effect byte (skill+0x0A, the "f7" opcode). Falls back to the
 *  skill bank's effect name when a caller carries no raw byte; only two tests matter to
 *  the formulas — `>= 2` (a technique, not a plain attack) and `== 0x0B`
 *  (TECH_EFFECT_CRITICAL, named "precision") — so every other name maps to a plain 2. */
function effectByteOf(skill: Skill | null | undefined): number {
  if (typeof skill?.effect_id === "number") return skill.effect_id;
  const name = skill?.effect;
  if (!name || name === "none") return 0;
  return name === "precision" ? 0x0b : 2;
}

/**
 * Physical critical roll — F0x800a02ac(side, move): `(RAND_U16 & 0x7f) < chance` with
 *
 *   chance = 4
 *     technique arm (effect >= 2):  += effectPower(+0xC) ONLY when effect == 0x0B;
 *     plain-attack arm (effect < 2): chance = atk.crit + 4 when the +0x38 byte is
 *       nonzero, DOUBLED when the attacker's record +0x1B is set (fightstg.s:30694
 *       `lbu $v0, 0x1b($a0)` / :30700 `sll $v0, 0x1`) — the roll owns this doubling;
 *   + skill.family(+0x9) >= 2 and == def.family(+0x25) ? 0x3C
 *     : first worn weapon family (+0x28..+0x2A) >= 2 and == def.family ? 0x10;
 *   + def.critStatusBonus — the TARGET's own +0x1d>>3 / +0x1e>>3 / +0x1f>>1.
 *
 * The status terms read the OTHER team's fighter record (`j = side == 0` →
 * `fighters[side == 0][active]`, fightstg.s:30732-30768) — the target's ailments, not
 * the attacker's. The +0x1B doubling applies only where the byte itself does, i.e.
 * the plain-attack arm; a technique never reads it.
 */
export function critProc(atk: EffStats, def: EffStats, skill: Skill, rng: () => number): boolean {
  let chance = 4;
  const effect = effectByteOf(skill);
  if (effect >= 2) {
    if (effect === 0x0b) chance += skill.effect_power ?? skill.effect_p2 ?? 0;
  } else if ((atk.crit ?? 0) !== 0) {
    chance = (atk.crit ?? 0) * (atk.aura ? 2 : 1) + 4;
  }
  if ((skill.target_family ?? 0) >= 2) {
    if (skill.target_family === def.family) chance += 0x3c;
  } else {
    for (const tag of (atk.weaponFamilies ?? []).slice(0, 3)) {
      if (tag >= 2 && tag === def.family) { chance += 0x10; break; }
    }
  }
  chance += def.critStatusBonus ?? 0;
  return (rng() & 0x7f) < chance;
}

/**
 * Magical critical roll — F0x800a0514, called by F0x8009fab4.
 *
 *   chance = min(0x40, trunc(skill[+0x8] * 100 / defender element)) + 4,
 *            or that scalar term + 0x40 when skill[+0x9] >= 2 matches the
 *            defender's +0x25; + the TARGET's three record intensity terms.
 *
 * The scalar chain is `((a<<1 + a)<<3 + a)<<2` = 100*a (fightstg.s:30812-30820
 * `sll/addu/sll/addu/sll`, words 00041840 00641821 000318c0 00641821 00031880),
 * divided by the defender's element halfword (`div` at :30821, truncated toward
 * zero) and capped at 0x40 (:30824-:30827); ReGame rolls.c:97 agrees
 * (`elementPower * 100 / resist`). The status block (:30838-30874) selects the
 * OTHER team's fighter record — `fighters[side == 0]`, the TARGET (`sltiu $v0,
 * 0x1` @0x800a05ec, the same selector the physical roll uses) — so the terms
 * are read from the defender's effStats view (`def.magicalCritStatusBonus`).
 * That block is word-identical to the physical roll's (0x800a0620..0x800a067c
 * vs 0x800a0484..0x800a04e0 in pro_fightstg.bin, base 0x80082cb0), and `effStats`
 * supplies both views from the combatant's own frozen/sleep/confuse magnitudes —
 * the same sum as `critStatusBonus`. The attacker contributes nothing to this roll.
 */
export function magicalCritProc(
  atk: EffStats,
  def: EffStats,
  skill: Skill,
  rng: () => number,
): boolean {
  const element = skill.element;
  const resistance = element && element !== "normal"
    ? (def.resistances?.[element] ?? 0)
    : 0;
  let scalarTerm = 0;
  if (resistance !== 0 && skill.damage_scalar != null) {
    scalarTerm = Math.min(0x40, Math.trunc((skill.damage_scalar * 100) / resistance));
  }
  let chance = scalarTerm + 4;
  if ((skill.target_family ?? 0) >= 2 && skill.target_family === def.family) {
    chance = scalarTerm + 0x40;
  }
  chance += def.magicalCritStatusBonus ?? 0;
  return (rng() & 0x7f) < chance;
}

/** Player magical element factor — F0x8009fab4 after the field adjustment.
 * Claim: battle-magical-element-curve-player-2026-09-05. */
export function magicalElementalFactor(raw: number): number {
  if (raw < 100) return 400 - (3 * raw);
  if (raw >= 300) return 65 - Math.trunc(raw / 20);
  return 125 - Math.trunc(raw / 4);
}

/** Element + crit + armor + clamp stage — F0x8009f6dc. */
export function resolveDamage(
  base: number,
  atk: EffStats,
  def: EffStats,
  skill: Skill,
  rng: () => number,
  field?: ElementalField | null,
): number {
  let s0 = base + elementalFieldAdjustment(base, skill.element, field);
  // Stage 2 — F0x8009f6dc .L0x8009f740-.L0x8009f7a8, PHYSICAL tail only (F0x8009fab4,
  // the magical leaf, never calls this routine). `skill+0x9 >= 2` matched against the
  // defender's +0x25 adds HALF the running value again (x1.5): .L0x8009f764 computes
  // `(s0 + (s0 >>> 31)) >> 1` and the jump's delay slot `addu $s0, $v0` adds it to s0.
  // When `skill+0x9 < 2` the same bonus comes from the ATTACKER's own worn family bytes
  // +0x28..+0x2A (`slti $v0, $v1, 0x3` at .L0x8009f7a4). The two arms are exclusive and
  // at most one bonus applies: the family arm jumps over the byte scan, and the scan's
  // match jumps straight to the bonus.
  if (!skill.magical) {
    const boost = () => { s0 += (s0 + (s0 >>> 31)) >> 1; };
    if ((skill.target_family ?? 0) >= 2) {
      if (skill.target_family === def.family) boost();
    } else {
      for (const tag of (atk.weaponFamilies ?? []).slice(0, 3)) {
        if (tag < 2) continue;
        if (tag === def.family) { boost(); break; }
      }
    }
    // Stage 3 — .L0x8009f7b0: `+= running * attacker[+0x26] / 64`, truncated toward zero.
    const affinity = atk.affinity ?? 0;
    if (affinity) s0 += Math.trunc((s0 * affinity) / 64);
  }
  const elem = skill.element;
  if (elem && elem !== "normal") {
    const raw = def.resistances?.[elem] ?? 100;
    if (skill.magical) {
      s0 = Math.trunc((s0 * magicalElementalFactor(raw)) / 100);
    } else if (def.resistances) {
      // F0x8009f6dc .L0x8009f7d8-.L0x8009f864: a technique whose element byte is
      // >= 2 adds `2 * running * skill[+0x8] / defenderElement`, the defender's
      // own element halfword (`lh 0xc($v0)`, $v0 = defender block + 2*(element-2)).
      // The value DIVIDES, so a higher element value is more resistance — the
      // same direction the magical curve above and the accessory term below use.
      // There is no `running * element / 100` stage in the original's tail.
      s0 += Math.trunc((2 * s0 * (skill.damage_scalar ?? 0)) / Math.max(1, raw));
    }
  }
  if (skill.magical && (skill.target_family ?? 0) >= 2 && skill.target_family === def.family) {
    s0 += Math.trunc(s0 / 2);
  }
  const equipElement = atk.elementalAttack?.element;
  if (skill.basic_attack && equipElement && def.resistances) {
    const resistance = Math.max(1, def.resistances[equipElement] ?? 100);
    s0 += Math.trunc((s0 * atk.elementalAttack!.amount * 2) / resistance);
  }
  // Special-op stage — F0x8009f6dc L29950-L29972: on a plain attack (skill f7
  // < 2, the browser basic_attack path) whose attacker carries the effective
  // +0x37 gate (Multi Crest — the same gate that diverts the resolver to the
  // 3-hit applier, fightstg.s:28502 -> 28580) the running damage is scaled by
  // trunc(2/5): the 0x66666667 magic applied to s0<<2 then >>2. The gate's THIRD
  // term is the record's own clip byte +0x10 (`.L0x8009f88c lbu $v0, 0x10($s1)` /
  // `:29954 addiu $v0, -0xb` / `:29956 sltiu $v0, 0x2` / `:29958 bnez`), the same
  // test the resolver runs before diverting — see `multiCrestPlainAttack`.
  // The tail runs ONCE for the whole action (the applier's loop calls only the
  // accuracy method, fightstg.s:27628/:27631), so the 0.4x scale is applied to
  // the one value all three hits share, not once per hit.
  if (skill.basic_attack && multiCrestPlainAttack(!!atk.multiAttack, skill.clip)) {
    s0 = Math.trunc((s0 * 2) / 5);
  }
  const critical = skill.magical
    ? magicalCritProc(atk, def, skill, rng)
    : critProc(atk, def, skill, rng);
  if (critical) {
    const r = (rng() & 0x3f) + 0x20; // 32..95
    s0 += Math.floor((s0 * r) / 64);
  }
  const armor = def.armor ?? 0;
  if (armor) {
    s0 -= armor;
    if (s0 <= 0) s0 = 0;
  }
  const cap = 5 * base;
  if (s0 > cap) s0 = cap;
  if (s0 >= 10000) s0 = 9999;
  return s0;
}

/** MIPS `sra` after the `+7`/`+0x7f` sign fixup: divide by 2^bits, truncated toward
 *  zero (NOT a JS `>>`, which floors — the two differ for every negative non-multiple). */
function truncDivPow2(value: number, bits: number): number {
  const v = Math.trunc(value);
  return (v + (v < 0 ? (1 << bits) - 1 : 0)) >> bits;
}

/**
 * Physical accuracy roll — F0x800a06ac(side, move). `(RAND_U16 & 0x7f) < chance`.
 * The two sides run DIFFERENT formulas (fightstg.s:30929-31011):
 *
 *   player (side == 0):
 *     - battle kind 6 (BATTLE_KIND_FINAL_LAST) short-circuits to `(RAND & 0x7f) >= 0x2B`;
 *     - diff = atk.SPD(+0xA) + atk.accuracy(+0x3A) − def.SPD(+0xA);
 *     - a plain attack (effect < 2) subtracts the attacker's +0x38 crit byte; a
 *       technique never does;
 *     - chance = skill accuracy(+0x6) + trunc(accuracy · (trunc(diff/8) + level) / 128);
 *     - NO floor: a low-accuracy attack falls below 0x20, or below zero — then it
 *       can never land.
 *   enemy (side != 0):
 *     - diff = atk.SPD − def.SPD − def.evasion(+0x3B)  (the evasion lives INSIDE diff/8);
 *     - no crit term at all;
 *     - chance is floored at 0x20.
 *
 * `atk.sideByte` carries the acting side (0 player / 0x10 enemy; absent = player) and
 * `atk.battleKind` the battle's kind word (0x800a4536); both come from `effStats`.
 */
export function rollHit(atk: EffStats, def: EffStats, skill: Skill, rng: () => number): boolean {
  const acc = skill.base_acc ?? 100;
  const level = (atk.level ?? 0) - (def.level ?? 0);
  if ((atk.sideByte ?? 0) === 0) {
    if ((atk.battleKind ?? 0) === 6) return (rng() & 0x7f) >= 0x2b;
    const diff = atk.spd + (atk.accuracyBonus ?? 0) - def.spd;
    const crit = effectByteOf(skill) >= 2 ? 0 : (atk.crit ?? 0);
    const term = truncDivPow2(diff, 3) + level - crit;
    return (rng() & 0x7f) < acc + truncDivPow2(acc * term, 7);
  }
  const diff = atk.spd - def.spd - (def.evadeBonus ?? 0);
  const term = truncDivPow2(diff, 3) + level;
  let chance = acc + truncDivPow2(acc * term, 7);
  if (chance < 0x20) chance = 0x20;
  return (rng() & 0x7f) < chance;
}

/**
 * Magical accuracy roll — F0x800a08c8(side, move). `(RAND_U16 & 0x7f) < chance`.
 *
 * Unlike the physical leaf's per-side split, ONE formula serves both sides
 * (fightstg.s:31082-31105, arm `.L0x800a09a0`):
 *
 *   - the battle kind word (0x800a4536) == 6 short-circuits to
 *     `(RAND & 0x7f) >= 0x2B` on the PLAYER side only (:31069-31081,
 *     `.L0x800a096c`-`.L0x800a099c`), the same fixed roll as the physical leaf;
 *   - acc_term = trunc((atk.WIS(+0x8) − def.WIS(+0x8)) / 8) + (atk.level(+0x0) − def.level)
 *     (:31082-31092; the `+7` sign fixup precedes the `>>3`, so the WIS division
 *     truncates toward zero and the level difference is added AFTER it);
 *   - chance = skill accuracy(+0x6) + trunc(accuracy · acc_term / 128)
 *     (:31093-31098; the `+0x7f` fixup precedes the `>>7`);
 *   - NO floor and NO cap: a low-accuracy cast falls below 0x20 — at or below
 *     zero it can never land — and nothing clamps the top at 0x80. This leaf has
 *     no crit, family or ailment terms at all.
 *
 * The resolver calls this leaf for category-3 (magical) attacks only
 * (`FIGHTSTG_F0x8009e0cc`: :28467 `beq $v1, 3, .L0x8009e330`, which loads
 * `0xa0($s0)` at :28557); the dispatch-byte-0x1f reset F0x8009ddd8 reads the same
 * `+0xa0` entry unconditionally (:28224 `lw $v0, 0xa0($s3)`). The multi-hit
 * applier's follow-up rolls call the PHYSICAL leaf whatever the category
 * (`F0x8009d4b8` :27628 `lw $v0, 0x9c($s3)`; ReGame tech_effects.c:100-136
 * FIGHTSTG_rollMultiHit), so only the FIRST accuracy roll of an action dispatches
 * on the attack category.
 *
 * `atk.sideByte` carries the acting side (0 player / 0x10 enemy; absent = player)
 * and `atk.battleKind` the battle's kind word — both come from `effStats`.
 */
export function rollMagicHit(atk: EffStats, def: EffStats, skill: Skill, rng: () => number): boolean {
  if ((atk.sideByte ?? 0) === 0 && (atk.battleKind ?? 0) === 6) return (rng() & 0x7f) >= 0x2b;
  const acc = skill.base_acc ?? 100;
  const term = truncDivPow2(atk.wis - def.wis, 3) + ((atk.level ?? 0) - (def.level ?? 0));
  return (rng() & 0x7f) < acc + truncDivPow2(acc * term, 7);
}

/**
 * WFIGHTMN 0x800aabf0 special-battle finalizer.
 * Modes 1/2 floor player-to-enemy damage at maxHP/11; mode 3 makes
 * player-to-enemy damage zero. Enemy-to-player and modes >=4 are unchanged.
 */
export function specialModeDamage(
  mode: number, playerToEnemy: boolean, currentHp: number, maxHp: number,
  perHitDamage: number, hitCount = 1,
): number {
  if (mode <= 0 || !playerToEnemy || mode >= 4) return perHitDamage;
  if (mode === 3) return 0;
  const floorHp = Math.trunc(maxHp / 11);
  if (floorHp >= currentHp) return 0;
  if (hitCount <= 0 || perHitDamage * hitCount <= currentHp - floorHp) return perHitDamage;
  return Math.trunc((currentHp - floorHp) / hitCount);
}

/**
 * FIGHTSTG_F0x80088564's mode-1 low-HP escape predicate.
 *
 * The battle action object (`pro/fightstg.s:5829`, arm `.L0x800885bc`-`.L0x80088664`;
 * lifted at `exe-decomp/fightstg_c/F0x80088564.c:49-57`) reads the mode word
 * `0x800A4536` and, when it is **1**, compares the acting ENEMY's current HP
 * (combatant record +0x08) against its maximum HP (+0x06) divided by 10; below that it
 * writes `esmfight[0x5f]` "Fleeing!" and commits the battle result byte 0 (flee → back
 * to the field). The mode-1 damage floor (`specialModeDamage`, maxHP/11) sits BELOW
 * this threshold (maxHP/10), so a mode-1 boss always escapes the moment the player
 * would otherwise have dealt the killing blow instead of dying. The arm is gated on
 * mode == 1 alone, so mode 2 (Zanbamon) never takes it — mode 2's fight ends on the
 * Cross Slash forced flee (result-queue slot 35) instead.
 *
 * `maxHp` is truncated the way the disc's divide-by-10 (magic `0x66666667`, shift 2)
 * truncates it, and the comparison is strictly less-than.
 */
export function specialModeLowHpEscape(
  mode: number, currentHp: number, maxHp: number,
): boolean {
  if (mode !== 1) return false;
  if (!(currentHp > 0)) return false;
  return currentHp < Math.trunc(maxHp / 10);
}

/** Blast/DV gauge gain from a hit — F0x800a1c18: ratio=100·dmg/stat, gain=ratio²/20, cap 1000. */
export function gaugeGain(damage: number, stat: number): number {
  if (stat <= 0) return 0;
  const ratio = Math.floor((100 * damage) / stat);
  let gain = Math.floor((ratio * ratio) / 20);
  if (gain > 1000) gain = 1000;
  return gain;
}

/** F0x800a1c18 accessory pass: OverClocked +20%, OverLoad +40%, each slot stacks. */
export function boostedGaugeGain(
  gain: number,
  accessoryIds: number[] = [],
): number {
  let out = gain;
  for (const id of accessoryIds) {
    if (id === 329) out += Math.floor(out / 5);
    else if (id === 330) out += Math.floor((out * 2) / 5);
  }
  return Math.min(1000, out);
}

/**
 * The hit-gain writer's gate and delta — wfightmn file offset `0x4330`
 * (RAM `0x800aa110`), the ONLY caller of `F0x800a1c18`. It reads the target's
 * CURRENT HP back after the damage has landed and returns before the gauge when
 * it is zero, so a hit that knocked the Digimon out earns no Blast/DV gauge:
 *
 *   wfightmn.s:4388-4390  `lh $v0, 0x8($s1)` / `beqz $v0, .L0x000043f4`
 *                         $s1 = the ACTIVE PARTY combatant record (0x800a4468);
 *                         +0x08 is its current HP.
 *   wfightmn.s:4398-439a0  Blast reservation +0x1a standing -> return.
 *
 * `hpAfter` is the target's HP AFTER the hit is applied (`damage` subtracted,
 * floored at 0); the writers apply HP first and call this second
 * (e.g. fightstg.s:12810-12824 HP write, then :12834-12836 the `jal 0x800aa110`).
 *
 * Returns `null` when the writer short-circuits (target at 0 HP, or Blast
 * active) — the caller keeps its other side-effects but must not move the gauge;
 * otherwise the delta to add, which may itself be 0 when the ratio rounds to 0.
 */
export function hitGaugeGain(
  damage: number,
  maxHp: number,
  hpAfter: number,
  opts: { blastActive?: boolean; accessories?: number[] } = {},
): number | null {
  if (opts.blastActive) return null;
  if (hpAfter <= 0) return null;
  return boostedGaugeGain(gaugeGain(damage, maxHp), opts.accessories ?? []);
}

/**
 * Blast target tier from the partner's battle level — event-0x12 handler ladder
 * (F0x800a8bf4 @0x800a8cbc: slti 4 / 0x13 / 0x27 / 0x46). level<4->0, <19->1,
 * <39->2, <70->3, else 4. [BLAST-C002]
 */
export function levelTier(level: number): number {
  if (level < 4) return 0;
  if (level < 19) return 1;
  if (level < 39) return 2;
  if (level < 70) return 3;
  return 4;
}

/**
 * Automatic-Blast target Digimon id = the partner's *rookie* profile blasts[levelTier].
 * `blasts` values are already digimon.json ids (== profile `this` index), so no
 * resolver is needed. Verified vs runtime: Renamon(id7) lvl15 -> tier1 -> blasts[1]=27
 * = Taomon (0x177), the id captured live at event 0x12. [BLAST-C002]
 */
export function blastTargetId(
  blasts: number[] | undefined | null,
  level: number,
): number | null {
  if (!blasts || blasts.length < 5) return null;
  const id = blasts[levelTier(level)];
  return id && id > 0 ? id : null;
}

/** Counter Crest roll: 32 + floor(64*damage/maxHP), on the 0..127 RNG scale. */
export function counterCrestProc(
  damage: number,
  maxHp: number,
  rng: () => number,
): boolean {
  const chance = 0x20 + Math.floor((Math.max(0, damage) * 0x40) / Math.max(1, maxHp));
  return (rng() & 0x7f) < chance;
}

/** Enemy escape roll (F0x800a1608 side 1): Binder Crest halves the base 64/128
 *  chance. `0x800a4580` is the ACTING side and `0x800a45c0` the other (settled
 *  2026-09-13 from F0x8009ec94's flag branch), so the fleeing side's SPD is the
 *   numerator: `base + trunc((enemySpd − playerSpd)/10)`, no max(0,·) clamp.
 *  The acting enemy's ailment byte gates it the SAME way the player's Run is
 *  gated: Sleep (`+0x1c & 0x08`) refuses the flee outright (fightstg.s:31991-31995)
 *  and Frozen (`0x02`) halves the base before the SPD term (fightstg.s:32001-32004).
 *  Both read the acting record's `+0x24` block byte, which F0x8009ec94 copies from
 *  record `+0x1c`; in the walker that is `battleAilmentByte(en)`. */
export function enemyFleeProc(
  playerSpd: number,
  enemySpd: number,
  binderCrest: boolean,
  rng: () => number,
  enemyAilment = 0,
): boolean {
  const ailment = Math.trunc(enemyAilment);
  if (ailment & 0x08) return false;        // Sleep: cannot flee (fightstg.s:31991-31995)
  let base = binderCrest ? 0x20 : 0x40;
  if (ailment & 0x02) base >>= 1;          // Frozen halves the base (fightstg.s:32001-32004)
  const chance = base + Math.trunc((enemySpd - playerSpd) / 10);
  return (rng() & 0x7f) < chance;
}

/** Secondary status-effect roll — chance = atk − def/8, clamped [1,127]. */
export function statusRoll(atk: number, def: number, rng: () => number, statusId = 1): number {
  let chance = atk - Math.floor(def / 8);
  if (chance < 1) chance = 1;
  if (chance > 127) chance = 127;
  return (rng() & 0x7f) < chance ? statusId : 0;
}

/**
 * F0x800a0a18/0b98/0d00/0e68/0fac status landing formula.
 * MIPS signed divisions truncate toward zero.
 */
export function statusInflictionRoll(
  power: number,
  attackerWis: number,
  victimWis: number,
  victimElement: number,
  victimStatusResistance: number,
  rng: () => number,
): boolean {
  const attackTerm = power + Math.trunc(attackerWis / 8);
  const defence = victimElement + victimStatusResistance + Math.trunc(victimWis / 2);
  const chance = Math.max(1, Math.min(127, attackTerm - Math.trunc(defence / 8)));
  return (rng() & 0x7f) < chance;
}

/** Accessory status resistance is a flat reduction on the 128-point proc scale. */
export function statusPowerAfterResistance(
  power: number,
  ailment: string,
  resistances: Record<string, number> | undefined,
): number {
  return power - (resistances?.[ailment] ?? 0);
}

/**
 * The Multi Crest plain-attack gate — F0x8009e0cc `.L0x8009e238`-`.L0x8009e26c` and
 * F0x8009f6dc `.L0x8009f868`-`.L0x8009f89c`, the SAME three-term conjunction twice:
 *
 *   1. the record's effect opcode `skill+0xa` is below 2 (the plain-attack shape,
 *      `sltiu $v0, $v1, 0x2`),
 *   2. the record's clip byte `skill+0x10` is outside {0x0b, 0x0c}
 *      (`lbu $v0, 0x10($s4)` / `addiu $v0, -0xb` / `sltiu $v0, 0x2` / `bnez`),
 *   3. the acting side's effective `+0x37` is nonzero — Multi Crest
 *      (`lbu $v0, 0x37($s2)` / `bnez`).
 *
 * Holding it diverts the resolver into the three-hit applier F0x8009d4b8 and scales
 * the running damage by trunc(2/5). A record whose clip byte is 0x0b or 0x0c does
 * neither: it is one hit at full damage. `clip` undefined means the caller carries
 * no record byte, and then only terms 3 is testable, so the gate falls back to it.
 */
export function multiCrestPlainAttack(multiAttack: boolean, clip: number | undefined): boolean {
  if (!multiAttack) return false;
  if (clip == null) return true;
  return clip !== 0x0b && clip !== 0x0c;
}

/** Multi Crest gate (effective record +0x37) AND the record's clip byte: the
 *  plain attack is three hits at 40% each, otherwise one. F0x8009d4b8's `$s2` is
 *  left at its `li $s2, 0x3` initializer (`:27583`) for every record whose `skill+0xa`
 *  is below 2; only the `lbu $s2, 0x11($v1)` delay slot at `:27586` reads `skill+0x11`. */
export function basicAttackHitCount(multiAttack: boolean, clip?: number): number {
  return multiCrestPlainAttack(multiAttack, clip) ? 3 : 1;
}

/**
 * The one loaded-technique MP price — FIGHTSTG_F0x800a1d3c (TL-010, verified;
 * EQUIP-C013). `flaggedTech` is the roster form-ledger halfword as it survives
 * into the battle command list: id in bits 0..12, 0x4000 = loaded/loaned.
 *
 *   cost = Unknown3[(tech & 0x1fff) - 1].mp_cost
 *   if side != 0: return cost                     # the enemy pays list price
 *   if MPProxy/MPMegaProxy equipped:              # the SECOND matching slot wins
 *       cost -= item effect; if cost <= 0: cost = 1
 *   if tech & 0x4000:                             # a loaned technique
 *       cost += max(1, floor(cost / 5))
 *
 * The premium uses the post-reduction cost: for a reduced base of 1-4 the
 * minimum one-MP premium is the whole difference from a plain `cost/5`.
 */
export function techniqueMpCost(
  baseCost: number,
  flaggedTech: number,
  opts: { enemySide?: boolean; mpCostDown?: number } = {},
): number {
  const base = Math.max(0, Math.trunc(baseCost));
  if (opts.enemySide) return base;
  let cost = base;
  const down = Math.max(0, Math.trunc(opts.mpCostDown ?? 0));
  if (down > 0) {
    cost -= down;
    if (cost <= 0) cost = 1;              // floor 1 happens before the premium
  }
  if ((flaggedTech & 0x4000) !== 0) {
    const premium = Math.trunc(cost / 5);
    cost += premium !== 0 ? premium : 1;  // +20%, minimum +1
  }
  return cost;
}

/** HP-drain heal — heal = floor(damage·ratio/128); ratio doubled when super-effective. */
export function drainHeal(damage: number, ratio: number, doubled = false): number {
  const r = doubled ? ratio * 2 : ratio;
  return Math.max(0, Math.floor((damage * r) / 128));
}

/** Drain proc — F0x800a1308: `rand%128 < f8` (effect_p1), a flat chance with no
 *  defender term. A drain skill only heals on the frames this returns true; the
 *  same roll gates the weapon lifesteal through eff`+0x35`. */
export function drainProcRoll(effectP1: number, rng: () => number): boolean {
  return (rng() & 0x7f) < effectP1;
}

/**
 * The escape (Run) base — the live-workspace halfword `0x800a4534`
 * (`0x800a4460 + 0xd4`), read on the PLAYER side only. Measured value **1**
 * (worker-ck, 2026-10-09, `.dw3-research/escape-roll-2026-10-09/worker-ck.md`).
 * Its writer IS located (worker-cn, 2026-10-09,
 * `.dw3-research/escape-terms-2026-10-09/worker-cn.md`): the battle **event-2
 * handler `F0x800a7418`** (wfightmn, file `0x1638`; event table entry 0 at RAM
 * `0x800aadf0`) does a read-modify-write on it — `lhu $v0,0xd4($v1)` /
 * `addiu $v0,0x1` / `sh $v0,0xd4($v1)` with `$v1 = 0x800a4460`
 * (`wfightmn.s:1577-1581`). Corpus-wide the only two accesses to `0x800a4534`
 * are that store and the escape routine's read (`fightstg.s:31960`). It is
 * therefore a **counter that increments**, not a flat constant. `ESCAPE_BASE_DEFAULT`
 * stays 1 because it matches the measurement (BSS starts the field at 0 and the
 * handler had run once). Two things are still unread, and are not invented here:
 * **what the counter counts and where (if anywhere) it resets.** No initialiser
 * exists in the corpus, and the per-battle clear at `wfightmn.s:2488` zeroes only
 * `+0xd0`/`+0xd2`, not `+0xd4`; a rig read across two battles would settle it.
 * `escapeBase` lets a later located source override the default.
 */
export const ESCAPE_BASE_DEFAULT = 1;

/** Inputs to the player's Run roll — F0x800a1608 side 0. */
export interface EscapeRoll {
  /** Acting (player) fighter's effective level — block +0x00. */
  selfLevel: number;
  /** The other (enemy) fighter's effective level — its block +0x00. */
  otherLevel: number;
  /** Acting fighter's effective SPD — block +0x0a. */
  selfSpd: number;
  /** Other fighter's effective SPD — its block +0x0a. */
  otherSpd: number;
  /** Live-workspace `0x800a4534`; defaults to the measured {@link ESCAPE_BASE_DEFAULT}. */
  escapeBase?: number;
  /** Effective `+0x3c`: the Runner Sandal/Shoes escape bonus (record +0x06). */
  escapeBonus?: number;
  /** Live record `+0x1c` ailment bitfield (0x02 Frozen, 0x08 Sleep, 0x10 tech-abort). */
  selfAilment?: number;
}

/**
 * The player's Run threshold on the 0..127 roll scale — the escape roll
 * `F0x800a1608` side 0 (`~/ddw3/asm/dw2003/pro/fightstg.s:31913-32026`; C
 * `exe-decomp/fightstg_c/F0x800a1608.c`), verified live 2026-10-09.
 *
 * The routine builds both sides' effective blocks with `F0x8009ec94`
 * (0x800a4580 = the acting/fleeing side, 0x800a45c0 = the other) and returns
 * `((RAND_U16 & 0x7f) < threshold)`. On the player side:
 *
 *   threshold = (base + 1) * 8                       # base = *(s16)0x800a4534
 *             + max(0, level_self - level_other)      # block +0x00, both sides
 *             + max(0, (SPD_self - SPD_other) / 10)   # block +0x0a, trunc toward 0
 *             + eff_self.byte3c                        # Runner Sandal/Shoes bonus
 *
 * and it returns 0 (cannot run) when the acting record's `+0x1c` ailment byte has
 * Sleep (0x08) or a tech-abort (0x10); Frozen (0x02) halves the base term only.
 *
 * The PREVIOUS shipped rule — `8·SPD_self/SPD_enemy` at wfightmn file 0x1324 — is a
 * different routine the player's Run never executes (hooked; it never fired across
 * four live Runs). A faster fighter rolls better here too, but the magnitude is this
 * base-plus-bonus, not a ratio.
 */
export function escapeThreshold(opts: EscapeRoll): number {
  const ailment = Math.trunc(opts.selfAilment ?? 0);
  if (ailment & 0x18) return 0;                       // Sleep or tech-abort: cannot run
  let threshold = ((Math.trunc(opts.escapeBase ?? ESCAPE_BASE_DEFAULT)) + 1) << 3;
  if (ailment & 0x02) threshold >>= 1;                // Frozen halves the base term
  const levelDiff = Math.trunc(opts.selfLevel) - Math.trunc(opts.otherLevel);
  if (levelDiff > 0) threshold += levelDiff;
  const spdDiff = Math.trunc((Math.trunc(opts.selfSpd) - Math.trunc(opts.otherSpd)) / 10);
  if (spdDiff > 0) threshold += spdDiff;
  return threshold + Math.max(0, Math.trunc(opts.escapeBonus ?? 0));
}

/**
 * Roll one player Run. `true` = escaped — `(RAND_U16 & 0x7f) < threshold`.
 * A refused run (`escapeThreshold` 0) can never succeed, matching the original's
 * `return 0`. `rng` is the shared stream (`RAND_U16` unless a caller injects one).
 */
export function fleeChance(opts: EscapeRoll, rng: () => number): boolean {
  const threshold = escapeThreshold(opts);
  return threshold > 0 && (rng() & 0x7f) < threshold;
}

// ── Ailments (status conditions) ────────────────────────────────────────────
// Ailment bit values on the live combatant record +0x1c. CORRECTED 2026-07-16
// (STATUS-C004): anchored to the turn reader F0x80088564@0x887ac message text
// (0x2→"Frozen and can't move!", 0x4→confused gag, 0x8→"Asleep!") and the
// appliers ori 0x2/0x4/0x8 (F0x8009c8b0/c9c0/cb10). The prior table
// (sleep 0x02/frozen 0x04/poison 0x08/confuse 0x10) was shifted by the now-
// falsified "confuse=0x10": no `ori 0x10`/`ori 0x20` exists anywhere, so bits
// 0x10/0x20 are unrelated tech-abort flags, NOT confuse/charm.
export const AILMENT = Object.freeze({
  poison: 0x01,
  frozen: 0x02,
  confuse: 0x04,
  sleep: 0x08,
});

/** Map a skill `effect` string (digimon.json) → the ailment it inflicts (or null). */
export function ailmentOfEffect(effect: string): string | null {
  switch (effect) {
    case "poison": return "poison";
    case "paralyze": return "frozen";
    case "confuse": return "confuse";
    case "sleep": return "sleep";
    default: return null;
  }
}

/**
 * Poison queue-code-9 HP loss — F0x8009fe1c.
 *
 * `magnitude` is the code-9 queue payload at +0xc. The defensive terms are
 * target effective Water (+0x0e) and Poison resistance (+0x1a). MIPS signed
 * division truncates toward zero; the result is clamped to [1, maxHP/2].
 */
export function poisonTimelineDamage(
  maxHp: number,
  magnitude: number,
  targetWater: number,
  targetPoisonResistance: number,
): number {
  const strengthTerm = Math.trunc(magnitude / 2);
  const resistTerm = Math.trunc((targetWater + targetPoisonResistance) / 10);
  const rate = strengthTerm - resistTerm;
  const raw = Math.trunc((maxHp * rate) / 100);
  return Math.min(Math.max(1, raw), Math.trunc(maxHp / 2));
}

/** Regen HP-gain per turn — F0x800a01ac (type==0): R=rng%5+4, floor(maxHp·R/128), cap 9999. */
export function regenTick(maxHp: number, rng: () => number): number {
  const R = (rng() % 5) + 4;
  return Math.min(9999, Math.floor((maxHp * R) / 128));
}

/** Frozen action-block roll — F0x800a19d8. True means the actor loses this turn;
 *  the roll never clears Frozen. The caller supplies the combined effective resistance term. */
export function frozenBlockRoll(power: number, combinedResistance: number, rng: () => number): boolean {
  let chance = power - Math.floor(combinedResistance / 8);
  if (chance < 0x20) chance = 0x20;
  return (rng() & 0x7f) < chance;
}

export type TimedAilment = "frozen" | "confuse" | "sleep";

// The three ailments' recovery delay is NOT a formula of this shape. It belongs to the
// delay routine's own per-opcode arms, which live with the one status-event pool in
// `battle-status-events.ts` (`statusEventRecoveryDelay`, `statusEventConfusionDelay`,
// `statusEventTickDelay`). The formula that used to stand here was wrong once those arms
// were read — see docs/research/battle/battle-formula-leaves.md, "The ailment recoveries
// and the poison tick — the same pool, five more codes": it read the technique's
// `effect_p2` where the arm reads the global `0x800a435d` (the record's own `+0x38`
// ailment id), and it computed confusion mode 0 as `draw % 8001` where the arm computes
// `draw - 8001 * (draw / 2710)`, which is 2000 for every draw from 2710 up.

/** Normal code-2 action delay — F0x8009bda4 opcode 0 / param [1000,707,1414]. */
export function actionTimelineDelay(ownSpd: number, opponentSpd: number): number {
  const own = Math.max(1, Math.trunc(ownSpd));
  const opponent = Math.max(1, Math.trunc(opponentSpd));
  const product = own * opponent;
  let root = 999;
  for (let i = 0; i < 10; i++) {
    root = Math.max(1, Math.trunc((root + Math.trunc(product / root)) / 2));
  }
  const delay = Math.trunc((1000 * opponent) / root);
  return Math.min(1414, Math.max(707, delay));
}

export interface ActorTimeline {
  player: number;
  enemy: number;
}

/** Queue bootstrap: player code 2 at time 0, enemy code 3 at half player delay. */
export function initialActorTimeline(playerSpd: number, enemySpd: number): ActorTimeline {
  return { player: 0, enemy: Math.trunc(actionTimelineDelay(playerSpd, enemySpd) / 2) };
}

/**
 * Queue one completed actor event and advance to the next individually scheduled
 * actor. This is the browser-sized form of the original code-2/code-3 event queue:
 * the actor that just acted receives its speed-relative delay, then the shared
 * clock advances only as far as the earliest pending actor.
 */
export function scheduleNextActor(
  timeline: ActorTimeline,
  acted: "player" | "enemy",
  playerSpd: number,
  enemySpd: number,
): { elapsed: number; next: "player" | "enemy" } {
  timeline[acted] += acted === "player"
    ? actionTimelineDelay(playerSpd, enemySpd)
    : actionTimelineDelay(enemySpd, playerSpd);
  // `F0x8009ba4c`'s minimum scan is NOT "first inserted wins on equal times".
  // Its tie step (`pro/fightstg.s:25791-25809`; `F0x8009ba4c.c:22-28`) replaces
  // the best entry when the best's delay >= the current entry's delay AND the
  // best's kind is 2 or 3 — so an actor-turn entry (code 2 player / code 3
  // enemy) loses every equal-delay tie to the entry scanned after it. The
  // bootstrap seats code 2 in slot 0 and code 3 in slot 1 (`pro/wfightmn.s`
  // file `0x3f80-0x3fa8`), and each side re-enqueues into its own vacated slot
  // (`F0x8009b930` takes the first free slot), so the enemy is the higher slot
  // and wins an exact tie. Measured: with this rule a two-slot reduction of the
  // queue matches the 99-slot model for every actor and frame in 100,000
  // randomised tag-turn cases; the old `<=` mismatched 21.4% of them.
  const next = timeline.player < timeline.enemy ? "player" : "enemy";
  const elapsed = Math.max(0, timeline[next]);
  timeline.player = Math.max(0, timeline.player - elapsed);
  timeline.enemy = Math.max(0, timeline.enemy - elapsed);
  return { elapsed, next };
}

/** Counter retaliation — reflects the incoming hit at half strength (damage >> 1). */
export function counterDamage(damageTaken: number): number {
  return Math.max(0, damageTaken >> 1);
}

// ── The persistent stat-penalty consumer — the producer's other half ──────────────────
//
// The post-hit arms (dispatch 32/33/34, FIGHTSTG_F0x8009df78 -> F0x8009daac/db94/dc8c in
// engine/dw3/battle-damage-terms.ts) write three halfwords on the roster member; the
// shared effective-stat builder F0x80017174 subtracts each from one core stat and the
// battle block floors the result at 1 (`pro/fightstg.s:29320-29326`, `sh $a2=1`). This is
// the battle-side read half: STR/DEF/SPD each lose their own slot's amount, then floor at
// 1 — the number the damage leaves (`physicalBase`, `rollHit`) then use.
//
// WHICH slot is which stat is `DAMAGE_TERM_PENALTY_SLOT_STATS` in
// engine/dw3/battle-damage-terms.ts (slot 0 = STR, 1 = DEF, 2 = SPD); `damageTermPenaltyByStat`
// keys a producer result by that mapping, so a caller feeds it straight in.

/** The three core stats a persistent penalty can reduce. */
export interface StatPenalty {
  str?: number;
  def?: number;
  spd?: number;
}

/**
 * Apply the persistent stat penalty to a fighter's effective stats. Mirrors the original's
 * `lhu`/`subu`/`sh $zr` at `exe/fns.s:7919-7945` (STR -= +0x26, DEF -= +0x28, SPD -= +0x2a)
 * followed by `F0x8009ec94`'s floor of 1. Returns a new object; the input is not mutated.
 */
export function applyStatPenalty<T extends { str: number; def: number; spd: number }>(
  stats: T,
  penalty: StatPenalty,
): T {
  const sub = (value: number, amount: number | undefined): number => {
    const out = (Math.trunc(Number(value)) || 0) - (Math.trunc(Number(amount)) || 0);
    return out < 1 ? 1 : out;
  };
  return {
    ...stats,
    str: sub(stats.str, penalty.str),
    def: sub(stats.def, penalty.def),
    spd: sub(stats.spd, penalty.spd),
  };
}
