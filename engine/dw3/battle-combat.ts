// engine/dw3/battle-combat.ts
// DW3 combat resolvers, ported from web/battle.js (the hoisted module-level functions).
// Closure-independent: compose battle-formulas over flat combatant records. Faithful to the
// decoded pipeline — see docs/research/battle/battle-formula-leaves.md.

import {
  physicalBase, magicalBase, resolveDamage, rollHit, drainHeal, drainProcRoll, RAND_U16,
  statusInflictionRoll, ailmentOfEffect, poisonTimelineDamage, regenTick, frozenBlockRoll,
  critBonusFor, counterDamage,
  type ElementalField, type StatPenalty,
} from "./battle-formulas.ts";
import { ENEMY_GAG_LINES } from "./battle-confusion.ts";
// What the original shows for an ailment: its own one-word line, its own box page, and
// the turn-start gate's own line (battle-ailment-display).
import {
  ailmentTurnStartMessageSpec, type AilmentKey,
} from "./battle-ailment-display.ts";
import { weaponSecondary } from "./equipment.ts";
import { formChangeCoreStats, formChangeValues } from "./battle-form-change.ts";
import { battleElementValue } from "./effective-stats.ts";
// The combatant record's +0x0E, the damage tail's stage-3 operand, and the one
// rule that spends it. See engine/dw3/battle-damage-terms.ts DAMAGE_TERM_AFFINITY_ARMS.
import { consumeAffinity } from "./battle-damage-terms.ts";
// The ONE clock every timed battle effect runs on: the 99-slot pool at 0x800a3868. An
// ailment's recovery is not a counter on the record; it is a queued entry whose expiry IS
// the cure. See engine/dw3/battle-status-events.ts.
import {
  emptyStatusEventPool, stageStatusEventAilment, statusEventDraw,
  type StatusEventPool,
} from "./battle-status-events.ts";

const BASIC_POWER = 60;

/** `power` is the live magnitude byte, or Poison's code-9 queue payload. */
export interface Ailment { power: number; }

export interface Combatant {
  level?: number;
  str: number; def: number; spt: number; wis: number; spd: number;
  hp: number; maxHp: number;
  ailments: Record<string, Ailment>;
  /**
   * The battle's ONE status-event pool — the original's single 99-slot, 28-byte queue at
   * `0x800a3868`, shared by both sides. An ailment's recovery is an entry in it, so the
   * record needs a way to reach it; `web/battle.js` links `b.player` and `b.enemy` to the
   * same array at battle setup, and `applyAilment` creates one if a caller has not.
   */
  statusEvents?: StatusEventPool;
  /** The side byte the original's stagers are handed: 0 the player, `0x10` the enemy. */
  sideByte?: number;
  /** `[0x800a4468 + 4 * (side != 0)]` — this record's side's active fighter slot. */
  slot?: number;
  /** Recover Crest's battle-long recurring source; it is not a curable status bit. */
  regeneration?: boolean;
  counterStance?: { uses: number };
  profile?: {
    id?: number;
    resistances?: Record<string, number>;
    status_resist?: Record<string, number>;
    family?: number;
    str?: number; def?: number; spt?: number; wis?: number; spd?: number;
  };
  /**
   * The species the roster's own numbers belong to (F0x8009EC94's profile-block
   * species). While the live form id differs from it the live form's own core
   * stats are added to every read; a record without it never gets the addition.
   */
  savedSpeciesId?: number;
  /**
   * The roster's own species record — the row `savedSpeciesId` names. F0x8009EC94
   * derives the effective block from THIS row's seven element values and five
   * status-resistance bytes and then adds the live form's row on top, while
   * `profile` is the LIVE form's row. A record without one keeps the live row's
   * own values and gets no addition.
   */
  savedProfile?: {
    resistances?: Record<string, number>;
    status_resist?: Record<string, number>;
  };
  elemBonuses?: Record<string, number>;
  statusResists?: Record<string, number>;
  /**
   * The three persistent post-hit penalty halfwords the roster member carries at
   * `+0x42`/`+0x44`/`+0x46` — STR / DEF / SPD, in that slot order
   * (`DAMAGE_TERM_PENALTY_SLOT_STATS`, engine/dw3/battle-damage-terms.ts). The
   * shared effective builder F0x80017174 subtracts each from its own core stat and
   * floors at 0 (`exe/fns.s:7919-7945`); the battle block then adds the live
   * `statMods` and floors at 1 (`pro/fightstg.s:29315-29331`). Unlike `statMods`
   * (per battle, written by the category-5 arms) these PERSIST across battles on the
   * roster record and are cleared only by the party rest F0x8001104c.
   */
  statPenalty?: StatPenalty;
  crit?: number;
  armor?: number;
  accBonus?: number;
  evadeBonus?: number;
  elemAttack?: { element?: string; amount: number } | null;
  statusImmunities?: Record<string, boolean>;
  /** AuraPlug's attacker-owned effectiveness flag (record +0x2b -> effective +0x1b). */
  aura?: boolean;
  /** Multi Crest gate: effective +0x37 != 0 — 3-hit divert plus 0.4x per hit. */
  multiAttack?: boolean;
  /** Exact eff[+0x1c]+eff[+0x14] input for F0x800a19d8, when a host can supply it. */
  frozenBlockResistance?: number;
  /** Optional decoded intensity contribution consumed by the magical crit roll. */
  magicalCritStatusBonus?: number;
  /**
   * Effective block +0x26, the affinity multiplier byte, copied by F0x8009EC94 from
   * the live combatant record's +0x0E. F0x8009F6DC stage 3 adds `running * byte / 64`.
   * No writer for that record byte was found in any overlay, so it is 0 everywhere the
   * walker has observed; the stage is ported and the operand is not yet sourced.
   */
  affinity?: number;
  /**
   * Effective block +0x28.. — the stat-record byte +0x12 of every worn family 2..14
   * piece that carries one (`wornFamilyBytes`). F0x8009F6DC stage 2's plain-attack arm
   * scans +0x28..+0x2A and adds half the running damage (x1.5) when one equals the
   * defender's family byte.
   */
  weaponFamilies?: readonly number[];
  /** Enemy only: encounter enemy +0x0a (descriptor +0x22). Both base routines
   *  scale an attacking enemy's move power by it / 16 (F0x8009f97c
   *  .L0x8009fa30, F0x8009fab4 .L0x8009fb74). 16 or absent = unscaled. */
  powerScale?: number;
  [k: string]: unknown;
}

export interface Skill {
  power?: number;
  element?: string;
  base_acc?: number;
  attack_category?: string;
  effect?: string;
  effect_p1?: number;
  effect_p2?: number;
  target_family?: number;
  damage_scalar?: number;
  confusion_recovery_mode?: 0 | 1;
  /** Raw record byte +0x10, the action-script clip. The Multi-Crest plain-attack
   *  gate skips the three-hit diversion and the 0.4x stage on 0x0b / 0x0c. */
  clip?: number;
  /** Marks the ordinary attack path so elemental-attack accessories can contribute. */
  basic_attack?: boolean;
}

export interface AttackResult { hit: boolean; dmg: number; heal: number; }

/**
 * The original's turn-start gate page, `FIGHTSTG_F0x80088564`'s `+0xac` call: line 1 the
 * Digimon's name, line 2 the bank's own line for that ailment. `spec` is what the
 * translated panel draws; `prefix` is the same moment as one flat string for the
 * headless callers and for `?legacyBattleMsg=1`.
 */
export interface TurnStartSpec {
  kind: number;
  payload: number[];
  name: string;
}

export interface TurnStart {
  skipped: boolean;
  /** One flat sentence, for the walker-only paths; the game's words come from `spec`. */
  prefix: string;
  /** The original's own battle message box page for this moment, when it has one. */
  spec?: TurnStartSpec;
  confused?: boolean;
  /** The one of the eight confuse one-liners the gate drew (`esmfight` 0x83 + n). */
  gag?: number;
  /** The bank's own line, for the flat sentence. */
  word?: string;
}
export interface AilmentTimelineEvent {
  combatant: Combatant;
  ailment: string;
  kind: "damage" | "recovery" | "regen";
  amount?: number;
}

/**
 * The points every other source adds on top of an element value, folded in with
 * a PLUS. Two of them, and neither is a reduction:
 *
 * - **the trained points** are already inside the stored halfword this value
 *   starts from. `F0x80085e3c` (`exe-decomp/stfgtrep_c/F0x80085e3c.c:100-118`)
 *   writes one level-up's rolled gains into `DIGIMON_CUR_STATS + 0x34..0x40`
 *   with `addu` + a 999 cap, the gym and the resist chips write the same
 *   halfwords, and `F0x80017174` (`exe-decomp/c/F0x80017174.c:53-64`) copies
 *   them into the scratch verbatim — it does not subtract, scale or floor them.
 * - **the worn gear's elemental resist** is added by the same scratch builder:
 *   its six-slot loop over `DIGIMON_CUR_STATS + 0x3c0` (`exe/fns.s:7912-7990`)
 *   calls `F0x80017578`, whose codes 8..14 land on scratch +0x18..+0x24 with
 *   `addu` and the same 999 cap (`exe-decomp/c/F0x80017578.c:23-30`).
 *
 * The sum itself lives in ONE place, `elementValue` in effective-stats.ts, which
 * every screen reads too; this fold only adds F0x8009EC94's floor of 1
 * (`.L0x8009eee8`, `blez` -> 1), which is the battle block's own step and the
 * only reason this wrapper exists.
 */
export function foldElemBonuses(
  base: Record<string, number> | undefined, bonuses: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(base ?? {}) };
  for (const k of Object.keys(out)) {
    out[k] = battleElementValue({ resistances: { [k]: out[k]! } }, bonuses, k);
  }
  return out;
}

/** The species-record rows the form rule reads: the live form's, and the roster's. */
function formRows(c: Combatant) {
  const roster = c.savedProfile ?? c.profile;
  return { live: c.profile, roster };
}

/**
 * The seven element values F0x8009EC94 writes to block +0x0C..+0x18 for this
 * combatant: the roster row's own seven (which already carry every trained
 * point and worn item's resist, because `F0x80017174` builds the scratch the
 * block is read from) plus the live form's own seven while the form differs.
 * Every element read in battle goes through here — the damage divisor, the
 * ailment element term, the poison tick — so a changed form's elements are the
 * original's on all of them.
 */
export function combatantElements(c: Combatant): Record<string, number> {
  const eStats = c.eStats as {
    resistances?: Record<string, number>;
    status_resist?: Record<string, number>;
  } | undefined;
  const { roster } = formRows(c);
  const values = formChangeValues(c.profile?.id, c.savedSpeciesId, {
    resistances: c.profile?.resistances ?? eStats?.resistances,
    status_resist: c.profile?.status_resist ?? eStats?.status_resist,
  }, roster);
  return foldElemBonuses(values.elements, c.elemBonuses);
}

/**
 * One of the five status resistances F0x8009EC94 writes to block +0x1A..+0x22:
 * the roster row's own byte plus the live form's own byte while the form
 * differs. `undefined` when the species record carries no such byte, so the
 * caller's existing fall-through to a host's `eStats` value is untouched.
 */
export function combatantStatusResist(c: Combatant, status: string): number | undefined {
  const live = c.profile;
  if (live?.status_resist?.[status] == null) return undefined;
  const { roster } = formRows(c);
  const values = formChangeValues(
    live?.id, c.savedSpeciesId, { status_resist: live?.status_resist }, roster,
  );
  return values.statusResist[status];
}

/**
 * One combatant's own stat modifiers — the live record's `+0x10` / `+0x12` / `+0x14`.
 *
 * The walker's `str` / `def` / `spd` already carry the base fold (stored value + every
 * worn piece, capped at 999, floored at 1), which is the effective builder's FIRST
 * step; these three halfwords are the record's own modifier on top of it, and they are
 * written only by the category-5 stat arms (`battleScriptedPlanFor` in `web/battle.js`).
 */
function statMod(c: Combatant, which: "str" | "def" | "spd"): number {
  const mods = (c as { statMods?: { str?: number; def?: number; spd?: number } }).statMods;
  return Math.trunc(Number(mods?.[which] ?? 0)) | 0;
}

/** The modular 16-bit add the effective builder's copy loop performs, with its floor. */
function withStatMod(base: number, mod: number): number {
  const sum = (Math.trunc(Number(base) | 0) + Math.trunc(Number(mod) | 0)) << 16 >> 16;
  return sum < 1 ? 1 : sum;
}

/**
 * The persistent post-hit penalty a fighter record carries, normalized to three
 * halfwords. Absent means all three are 0 (a record that never took a penalty arm).
 */
export function statPenaltyOf(c: Combatant): { str: number; def: number; spd: number } {
  const p = c.statPenalty;
  return {
    str: Math.trunc(Number(p?.str ?? 0)) | 0,
    def: Math.trunc(Number(p?.def ?? 0)) | 0,
    spd: Math.trunc(Number(p?.spd ?? 0)) | 0,
  };
}

/**
 * The shared effective builder's own subtraction and sign floor: `lhu` base,
 * `lhu` penalty, `subu`, `sh`, then `sh $zr` when the result is negative
 * (`exe/fns.s:7919-7927` for STR, `:7928-7936` DEF, `:7937-7945` SPD). It floors at
 * 0, NOT at 1 — the battle block's 1 comes later, after the form base and the live
 * `statMods` are added (`pro/fightstg.s:29315-29331`).
 */
function subtractPenaltyFloor(base: number, amount: number): number {
  const out = (Math.trunc(Number(base)) | 0) - (Math.trunc(Number(amount)) | 0);
  return out < 0 ? 0 : out;
}

/**
 * Add a penalty arm's result to a persistent fighter record — the `+=` the three
 * appliers write into roster `+0x42`/`+0x44`/`+0x46` (F0x8009daac / F0x8009db94 /
 * F0x8009dc8c, engine/dw3/battle-damage-terms.ts). `penalty` is
 * `damageTermPenaltyByStat(result)`'s shape. Returns a new record; the input is not
 * mutated, so the host stores the result back on its roster member.
 */
export function addStatPenalty(c: Combatant, penalty: StatPenalty): Combatant {
  const cur = statPenaltyOf(c);
  const add = (v: number | undefined): number => Math.trunc(Number(v) || 0) | 0;
  return {
    ...c,
    statPenalty: {
      str: cur.str + add(penalty.str),
      def: cur.def + add(penalty.def),
      spd: cur.spd + add(penalty.spd),
    },
  };
}

/**
 * Zero the three persistent penalty halfwords — the party rest F0x8001104c
 * (`exe-decomp/c/F0x8001104c.c:20`), where each present slot's roster record
 * `+0x42`/`+0x44`/`+0x46` is set 0 inside the three-iteration loop. The inn's stay
 * reaches it at `exe/fns.s:2022` (state 21, `F0x800116f8`). A heal and the next
 * battle's setup do NOT clear them on the disc — this rest is the only established
 * clearing point. Returns a new record; the input is not mutated.
 */
export function clearStatPenalty(c: Combatant): Combatant {
  return { ...c, statPenalty: { str: 0, def: 0, spd: 0 } };
}

export function effStats(c: Combatant) {
  // F0x8009EC94 (.L0x8009ed84-.L0x8009ed90): the live form id is compared with
  // the form the roster's own numbers belong to, and only when they differ are
  // the live form's species-record core stats, its seven element values and its
  // five status-resistance bytes added on top. A record that carries no roster
  // form (an enemy, or a battle that never changed form) adds nothing. Nothing is
  // written when the form changes; this is the read.
  const form = formChangeCoreStats(c.profile?.id, c.savedSpeciesId, c.profile);
  // The roster member's three persistent penalty halfwords (this record's
  // `statPenalty`, copied from the member at battle setup). The shared builder
  // F0x80017174 subtracts each from its own folded core stat and floors at 0, BEFORE
  // the live form's base and the live `statMods` are added: `exe/fns.s:7919-7945`.
  const penalty = statPenaltyOf(c);
  const stats = {
    level: c.level ?? 0,
    // THE THREE STAT MODIFIERS — the live combatant record's `+0x10` / `+0x12` / `+0x14`,
    // the halfwords the category-5 stat arms write (`.L0x800902dc` through
    // `FIGHTSTG_F0x800a1aa8`, pro/fightstg.s:32295 `sh $v0, 0x10($a1)`). The effective
    // builder adds each one to the matching core stat (`:29298 lh $v0, 0x14($s3)` /
    // `:29299 lhu $v1, 0x14($s3)` / `:29306 addu $v0, $v1` and its two siblings) on a
    // 16-bit halfword, so a NEGATIVE modifier subtracts as long as the sum stays inside
    // the halfword, and the copy loop then floors at 1 (`:29311 lh` / `:29313 blez`).
    // The same three words index the block at `+0x02 + 2 * .L0x800a4694[index]`, i.e.
    // attack / defense / speed (`:32269 lhu $v0, 0x2($v1)`).
    str: withStatMod(subtractPenaltyFloor(c.str, penalty.str) + form.str, statMod(c, "str")),
    def: withStatMod(subtractPenaltyFloor(c.def, penalty.def) + form.def, statMod(c, "def")),
    spt: withStatMod(c.spt + form.spt, 0),
    wis: withStatMod(c.wis + form.wis, 0),
    spd: withStatMod(subtractPenaltyFloor(c.spd, penalty.spd) + form.spd, statMod(c, "spd")),
    // F0x800a02ac doubles the attacker's effective +0x38 crit contribution
    // when AuraPlug's effective +0x1b flag is active.
    crit: (c.crit ?? 0) * (c.aura ? 2 : 1),
    armor: c.armor ?? 0,
    resistances: combatantElements(c),
    family: c.profile?.family ?? 1,
    // F0x8009EC94 copies the live record's +0x0E to +0x26 and the worn family-2..14
    // pieces' stat-record byte +0x12 to +0x28..; F0x8009F6DC stage 2/3 read both.
    affinity: c.affinity ?? 0,
    weaponFamilies: c.weaponFamilies ?? [],
    accuracyBonus: c.accBonus ?? 0,
    multiAttack: !!c.multiAttack,
    magicalCritStatusBonus: c.magicalCritStatusBonus ?? 0,
  };
  return c.elemAttack ? { ...stats, elementalAttack: c.elemAttack } : stats;
}

/** Shared setup for one attack: effective stats, the skill view the formula
 *  leaves consume, and the pre-element base. Both the single-hit and the
 *  multi-hit resolvers use it, so their damage stage cannot drift apart. */
function buildAttack(attacker: Combatant, defender: Combatant, skill: Skill | null) {
  const atk = effStats(attacker);
  const def = effStats(defender);
  const rawPower = skill?.power ?? BASIC_POWER;
  const power = attacker.powerScale == null
    ? rawPower
    : Math.trunc((rawPower * attacker.powerScale) / 16);
  const isMagical = skill?.attack_category === "magical";
  const attackFields = {
    power,
    element: skill?.element ?? "normal",
    base_acc: (skill?.base_acc ?? 128) - (defender.evadeBonus ?? 0),
    crit_bonus: critBonusFor(skill),
    magical: isMagical,
    target_family: skill?.target_family ?? 1,
    ...(skill?.clip === undefined ? {} : { clip: skill.clip }),
    ...(skill?.damage_scalar === undefined ? {} : { damage_scalar: skill.damage_scalar }),
  };
  const sk = skill?.basic_attack ? { ...attackFields, basic_attack: true } : attackFields;
  const base = isMagical ? magicalBase(atk, def, power) : physicalBase(atk, def, power);
  return { atk, def, sk, base };
}

/**
 * One attack action, the whole resolver roll order — `FIGHTSTG_F0x8009e0cc`.
 *
 * The original's order is fixed by the assembly and is what this reproduces:
 *
 * 1. **accuracy, once**, at `0x8009e200` (physical, vtable `+0x9c`) or `0x8009e348`
 *    (magical, `+0xa0`); the result is stored to the action context `+0x30` at
 *    `0x8009e21c` / `0x8009e364`, and the attempt counter to `+0x36` at
 *    `0x8009e22c` / `0x8009e374` — both in branch DELAY slots, so they run whether
 *    or not the branch is taken.
 * 2. **the damage value, once**, at `0x8009e228` (`+0x84`, physical) or `0x8009e370`
 *    (`+0x88`, magical), stored to `+0x28` at `0x8009e234` / `0x8009e378` — also a
 *    delay slot, so **the damage leaf runs and rolls its critical even when the
 *    accuracy roll missed**. The critical roll lives INSIDE that leaf
 *    (`F0x8009f6dc` `.L0x8009f8c4 jal FIGHTSTG_F0x800a02ac`), which is why a
 *    three-hit technique cannot crit three times: there is one roll for the action.
 * 3. **accuracy again, `hits - 1` more times**, inside the multi-hit applier
 *    `F0x8009d4b8`: its loop `.L0x8009d570`-`.L0x8009d5f0` (fightstg.s:27628-27660,
 *    entered at `:27623 beqz $v0` with `$s1 = 1`) calls nothing but the `+0x9c`
 *    accuracy method (`lw $v0, 0x9c($s3)` at `:27628` / `jalr $v0` at `:27631`) and
 *    writes the per-attempt flag (`sb $v1/$zr, 0x30($v0)` at `:27643`/`:27656`) and
 *    the two counters. No damage value is computed anywhere in that routine.
 *
 * The apply routine then turns the one stored value into a total in a single
 * product — `WFIGHTMN 0x800aa1f0` `.L0x0000490c lh $a2, 0x34($a1)` /
 * `.L0x00004910 lw $v0, 0x28($a1)` / `.L0x00004918 mult $a2, $v0` /
 * `.L0x00004938 mflo $s2` — `landed hits × the one damage value`, applied once.
 * The single-hit arm is `.L0x00004adc lw $s2, 0x441c($v0)`, i.e. `ctx+0x28` itself.
 *
 * So every landed hit deals the same amount, a miss in the middle only removes that
 * hit's share, and `dmg` is the total while `dmgPerHit` is the number the original
 * computes once. The drain heal is likewise computed once from that single value
 * (`F0x8009d61c` `:27724 lw $v0, 0x28($s0)` / `:27726 mult $v0, $v1` /
 * `:27731 sra $v0, 0x7`), so it is not multiplied by `landed`, and it sits behind the
 * FIRST accuracy result rather than behind "any hit landed": the whole secondary
 * chain is gated on `ctx+0x30` (`fightstg.s:28506 lbu $v0, 0x30($s1)` /
 * `:28508 beqz`), the accuracy the resolver rolled before the applier ever ran.
 */
export function resolveAttackSequence(
  attacker: Combatant, defender: Combatant, skill: Skill | null, hits: number,
  rng: () => number = RAND_U16, field?: ElementalField | null,
): MultiHitResult {
  const attempts = Math.max(1, hits | 0);
  const { atk, def, sk, base } = buildAttack(attacker, defender, skill);
  // 1. accuracy #1 — the original stores its result whatever happens next.
  const firstLanded = rollHit(atk, def, sk, rng);
  let landed = firstLanded ? 1 : 0;
  // 2. the damage value, once, whether or not the first roll landed.
  const dmgPerHit = Math.max(1, resolveDamage(base, atk, def, sk, rng, field));
  const heal = firstLanded && skill?.effect === "drain" && drainProcRoll(skill.effect_p1 ?? 0, rng)
    ? drainHeal(dmgPerHit, skill.effect_p2 ?? 0, !!attacker.aura)
    : 0;
  // 3. accuracy #2..hits — the applier's loop, accuracy only.
  for (let i = 1; i < attempts; i++) if (rollHit(atk, def, sk, rng)) landed++;
  // The charge is spent by the NEXT action of the acting fighter — and it is this action
  // when this action is the one that reads it. Read out of `FIGHTSTG_F0x8008f714`: its
  // state 0 calls the resolver (`:13000 jalr $v0`, through `0x800a445c` =
  // `F0x8009e0cc`), which is where the byte enters the effective block, and its state 1
  // sub-state 0 clears it (`:13092 sh $zr, 0xe($v0)`). Read then clear, so the tail's
  // stage 3 sees the byte and this call empties it — one call here so the single-hit path
  // and the multi-hit applier cannot drift, because the multi-hit arm computes its damage
  // value once and re-rolls only accuracy. The no-damage categories clear the same byte on
  // their own gates (`clearActionAffinity` in `web/battle.js`), because the original's
  // clear carries no category test.
  consumeAffinity(attacker);
  return { hit: landed > 0, dmg: dmgPerHit * landed, heal, dmgPerHit, landed, attempts, firstLanded };
}

export function resolveAttack(
  attacker: Combatant, defender: Combatant, skill: Skill | null, rng: () => number = RAND_U16,
  field?: ElementalField | null,
): AttackResult {
  const r = resolveAttackSequence(attacker, defender, skill, 1, rng, field);
  return { hit: r.hit, dmg: r.dmg, heal: r.heal };
}

export interface MultiHitResult extends AttackResult {
  /** The one value the original's damage leaf computed for this action; each
   *  landed hit deals this much. `dmg` is `dmgPerHit * landed`. */
  dmgPerHit: number;
  landed: number;
  attempts: number;
  /** The resolver's OWN accuracy roll, before the applier loop — the one that
   *  gates the secondary effects (`pro/fightstg.s:28506` / `:28508`). */
  firstLanded: boolean;
}

/**
 * Multi-hit attack — the decoded `F0x8009d4b8` applier, which is steps 1-3 of
 * `resolveAttackSequence` above. Kept as its own export because the callers hold a
 * hit count from the record's own byte `+0x11` (`skill.hits`); it adds nothing to
 * the resolver. Claim `BATTLE-Q004-ROLLTABLE-001`.
 */
export function resolveMultiHit(
  attacker: Combatant, defender: Combatant, skill: Skill | null, hits: number,
  rng: () => number = RAND_U16, field?: ElementalField | null,
): MultiHitResult {
  return resolveAttackSequence(attacker, defender, skill, hits, rng, field);
}

function recoveryField(c: Combatant, ail: "frozen" | "confuse" | "sleep") {
  const eStats = c.eStats as { status_resist?: Record<string, number> } | undefined;
  const elements = combatantElements(c);
  const element = ail === "frozen" ? "thunder" : ail === "confuse" ? "wind" : "ice";
  const status = ail === "frozen" ? "paralyze" : ail;
  const statusResistance = c.statusResists?.[status]
    ?? (status === "paralyze" ? c.statusResists?.frozen : undefined)
    ?? combatantStatusResist(c, status)
    ?? eStats?.status_resist?.[status]
    ?? 0;
  return { element: elements[element] ?? 0, statusResistance };
}

const STATUS_ELEMENT: Record<string, string> = {
  poison: "water", frozen: "thunder", confuse: "wind", sleep: "ice", ko: "dark",
};

function inflictionDefence(c: Combatant, ail: string) {
  const eStats = c.eStats as { status_resist?: Record<string, number> } | undefined;
  const elements = combatantElements(c);
  const nativeStatus = ail === "frozen" ? "paralyze" : ail;
  const statusResistance = c.statusResists?.[nativeStatus]
    ?? (nativeStatus === "paralyze" ? c.statusResists?.frozen : undefined)
    ?? combatantStatusResist(c, nativeStatus)
    ?? eStats?.status_resist?.[nativeStatus]
    ?? 0;
  return { element: elements[STATUS_ELEMENT[ail]!] ?? 0, statusResistance };
}

/**
 * Put one landed ailment on the record AND queue its recovery in the shared pool.
 *
 * There is no per-ailment countdown any more. The original's three recovery stagers —
 * `FIGHTSTG_F0x8009c8b0` (frozen), `F0x8009c9c0` (confused) and `F0x8009cb10` (asleep) —
 * and the poison stager `F0x8009c7d4` all write one entry into the pool at `0x800a3868`,
 * refresh it in place if it is already there, and set the record's `+0x1c` bit. The entry
 * coming due IS the cure, so `battleStatusEventAdvance` deleting the flag is the same rule
 * the disc runs through `FIGHTSTG_F0x8009c330`.
 */
export function applyAilment(
  c: Combatant,
  ail: string,
  skill: Skill | null,
  opponent?: Combatant,
  rng: () => number = RAND_U16,
): void {
  // Normal skill handlers copy f9/effect_p2 into the live magnitude byte.
  // effect_p1 is the separate upstream proc-power input. Keep it only as a
  // fallback for direct/synthetic callers that do not carry a full skill row.
  const rawMagnitude = skill?.effect_p2 ?? skill?.effect_p1 ?? 64;
  const power = rawMagnitude & 0xff;
  const pool = c.statusEvents ?? (c.statusEvents = emptyStatusEventPool());
  const side = (c.sideByte ?? 0) | 0;
  const slot = (c.slot ?? 0) | 0;
  const directConfusion = ail === "confuse" && skill?.confusion_recovery_mode === 0;
  // `FIGHTSTG_F0x8009c9c0` picks its delay opcode from its SECOND argument, the action's own
  // technique id: zero -> opcode 8, anything else -> opcode 10.
  const techniqueId = directConfusion ? 0 : 1;
  if (ail !== "poison" && !directConfusion
      && !(opponent && (ail === "frozen" || ail === "sleep"
        || (ail === "confuse" && skill?.confusion_recovery_mode !== undefined)))) {
    // A pool with no entry to queue: the flag still goes on, exactly as the walker's own
    // record did before, and nothing will time it out.
    c.ailments[ail] = { power };
    return;
  }
  // The poison entry carries the constant 1000 and the direct-confusion entry runs opcode 8,
  // which reads no stat at all -- so neither has an opposing pair. Every other recovery
  // reads the OTHER side's element + status resistance, the fields `opcodes 9/10/11` subtract.
  const readsOpposing = ail !== "poison" && !(ail === "confuse" && techniqueId === 0);
  const fields = opponent && readsOpposing
    ? recoveryField(opponent, ail as "frozen" | "confuse" | "sleep")
    : { element: 0, statusResistance: 0 };
  // The pool's delay helpers take a 0..1 source (the disc's draw is `rand() * 0x10000`,
  // and `statusEventStatDelay` / `statusEventLockDelay` are written that way). `applyAilment`
  // has always taken the walker's RAW 16-bit draw, so it is normalised here rather than
  // changing either convention.
  const draw = statusEventDraw(() => (((rng() | 0) % 0x10000) / 0x10000));
  stageStatusEventAilment(pool, {
    side,
    slot,
    ailment: ail,
    // The record's own `+0x38` byte is the ailment id the apply machine hands the stager
    // (`lbu $a2, 0x38($r4)` `pro/fightstg.s:15196`, `:15206`, `:15216`, `:15226`); the
    // three cure stagers keep it at `record+0x1d` / `+0x1e` / `+0x1f`.
    ailmentId: ail === "poison" ? 0x1e : ail === "frozen" ? 0x1f
      : ail === "confuse" ? 0x20 : 0x21,
    delay: {
      draw,
      ownSpt: Math.max(0, effSptOf(c) | 0),
      ailmentId: ail === "poison" ? 0x1e : ail === "frozen" ? 0x1f
        : ail === "confuse" ? 0x20 : 0x21,
      otherA: fields.element,
      otherB: fields.statusResistance,
    },
    techniqueId,
  });
  c.ailments[ail] = { power };
}

/** The record's own effective spirit, the `lh $v0, 0x6($s1)` the delay arms read. */
function effSptOf(c: Combatant): number {
  const mods = (c as { statMods?: { spt?: number } }).statMods;
  return (c.spt | 0) + ((mods?.spt ?? 0) | 0);
}

/**
 * Roll one attack's ailment against `defender` and apply it if it lands.
 *
 * Returns the ailment key that landed, or `null`. **Not a sentence**: in the original a
 * landed ailment is not part of the damage line at all. `FIGHTSTG_F0x80091534` writes the
 * ailment's `esmfight` index into the payload and asks the shared message box for a page of
 * its own (kind 2, `fightstg.s:15257`), and that page is built only after the damage
 * page's line has been read (`fightstg.s:14624-14626`, then `:14705`, then `:15277-15279`).
 * The caller turns the key into that page — `ailmentInflictMessageSpec` in
 * engine/dw3/battle-ailment-display.ts builds it.
 */
export function tryInflict(
  skill: Skill | null, defender: Combatant, defenderName: string, attacker?: Combatant,
  rng: () => number = RAND_U16,
): AilmentKey | null {
  if (!skill || defender.hp <= 0) return null;
  // AuraPlug's effective +0x1b belongs to the attacker. The status handlers double
  // the successful f9/effect_p2 magnitude; the landing formula's f8 power is unchanged.
  let effectiveSkill: Skill = skill;
  if (attacker?.aura) {
    effectiveSkill = { ...skill };
    if (skill.effect_p2 !== undefined) effectiveSkill.effect_p2 = skill.effect_p2 * 2;
  }
  // Instant death is not an ailment and has no ailment page: tryInstantDeath owns its one
  // roll. Rolling it here as well would give the skill two chances per hit.
  if (effectiveSkill.effect === "instant_death") return null;
  const ail = ailmentOfEffect(effectiveSkill.effect ?? "");
  if (!ail) return null;
  const fields = inflictionDefence(defender, ail);
  if (!defender.statusImmunities?.[ail] && statusInflictionRoll(
    effectiveSkill.effect_p1 ?? 0, attacker?.wis ?? 0, defender.wis,
    fields.element, fields.statusResistance, rng,
  )) {
    const appliedSkill = ail === "confuse"
      ? { ...effectiveSkill, confusion_recovery_mode: 1 as const }
      : effectiveSkill;
    applyAilment(defender, ail, appliedSkill, attacker, rng);
    return ail as AilmentKey;
  }
  return null;
}

/**
 * Instant death (`F0x800a0fac`) kills without an ailment: it returns the victim's name
 * when the roll lands, so the caller can keep the walker's own sentence for it (the
 * original's counterpart is a different message, not one of the four ailment words).
 */
export function tryInstantDeath(
  skill: Skill | null, defender: Combatant, defenderName: string, attacker?: Combatant,
  rng: () => number = RAND_U16,
): string {
  if (!skill || defender.hp <= 0 || skill.effect !== "instant_death") return "";
  const fields = inflictionDefence(defender, "ko");
  if (defender.statusImmunities?.ko) return "";
  if (!statusInflictionRoll(
    skill.effect_p1 ?? 0, attacker?.wis ?? 0, defender.wis,
    fields.element, fields.statusResistance, rng,
  )) return "";
  defender.hp = 0;
  return ` ${defenderName} was struck down!`;
}

export interface WeaponSecondaryResult { kind: "poison" | "frozen" | "confuse" | "ko"; magnitude: number; }

/**
 * Signature-weapon on-hit secondary — the equipment appliers of `F0x8009e0cc`
 * gated by effective `+0x2d/+0x2f/+0x31/+0x33` (claim
 * `equip-weapon-status-applier-crossref-2026-09-13`). The roll is the same
 * `statusInflictionRoll` shape as a skill: the weapon's proc byte is the power,
 * the defender's element + status resistance + WIS/2 is the defence. Returns
 * the ailment to apply (with its magnitude) or null. Drain (`+0x35`) is a damage
 * path, not an ailment, and is not returned here.
 */
export function weaponSecondaryProc(
  attacker: Combatant, defender: Combatant,
  weaponId: number | null | undefined, rng: () => number = RAND_U16,
): WeaponSecondaryResult | null {
  const sec = weaponSecondary(weaponId);
  if (!sec || sec.kind === "drain") return null;
  if (defender.statusImmunities?.[sec.kind]) return null;
  const fields = inflictionDefence(defender, sec.kind);
  if (!statusInflictionRoll(
    sec.proc, attacker.wis, defender.wis, fields.element, fields.statusResistance, rng,
  )) return null;
  return { kind: sec.kind, magnitude: sec.value };
}

/**
 * Signature-weapon drain (VampireLance / CerberusFang / SaberFang) — the
 * `F0x8009d61c` applier with its roll `F0x800a1308`: `(rand%128) < eff+0x35`,
 * then heal `floor(damage · eff+0x36 / 128)` (Aura doubles the ratio). The proc
 * is a flat check, with no defender resistance. Returns the HP to restore, or 0.
 */
export function weaponDrainHeal(
  attacker: Combatant, weaponId: number | null | undefined, damage: number,
  rng: () => number = RAND_U16,
): number {
  const sec = weaponSecondary(weaponId);
  if (!sec || sec.kind !== "drain") return 0;
  if ((rng() & 0x7f) >= sec.proc) return 0;
  return Math.max(0, drainHeal(damage, sec.value, !!attacker.aura));
}

function poisonDefenceFields(c: Combatant) {
  const eStats = c.eStats as { status_resist?: Record<string, number> } | undefined;
  const elements = combatantElements(c);
  const poisonResistance = c.statusResists?.poison
    ?? combatantStatusResist(c, "poison")
    ?? eStats?.status_resist?.poison
    ?? 0;
  return { water: elements.water ?? 0, poisonResistance };
}

/**
 * Advance the ONE thing on this timeline that is not a pooled status event: the gradual-HP
 * recovery source.
 *
 * **Poison and the three ailment recoveries are no longer here.** They are entries in the
 * battle's status-event pool (`Combatant.statusEvents`), queued by `applyAilment` through
 * the disc's own stagers and fired by `battleStatusEventAdvance` in `web/battle.js` — the
 * original's single clock. `FIGHTSTG_F0x8009ba4c` is called once per action and no frame
 * tick exists anywhere, and the poison tick re-arms itself inside its own consumer machine
 * (`sh $v0, 0x2($s1)` with `li $v0, 0x3e8` in the `j`'s delay slot, `pro/wfightmn.s:2607`-
 * `:2609`), which is why its entry survives the fire: `0x800a3800`'s word for code `0x09`
 * is `-1`.
 *
 * What is left is the regen source, a per-side actor machine of its own
 * (`pro/wfightmn.s .L0x00002480`) that is not one of the pool's staged codes. It still
 * prints its own box page — **kind 10**, `esmfight[0x27]` "HP gradually recovers."
 * (`:2428` `li $a1, 0xa`, arm `.L0x80099a28` at `fightstg.s:23651`) — and only adds the HP
 * once that page has been read (`:2446`-`:2454`). Step 0 returns without a page when the
 * Digimon is already at full HP (`slt $v0, $v1` / `beqz`, `:2394`-`:2395`), the same guard.
 */
export function advanceAilmentTimeline(
  combatants: Combatant[], elapsed: number,
): AilmentTimelineEvent[] {
  const events: AilmentTimelineEvent[] = [];
  void elapsed;
  for (const c of combatants) {
    if (c.regeneration && c.hp > 0 && c.hp < c.maxHp) {
      const amount = regenTick(c.maxHp, RAND_U16);
      c.hp = Math.min(c.maxHp, c.hp + amount);
      events.push({ combatant: c, ailment: "regen", kind: "regen", amount });
    }
  }
  return events;
}

/**
 * The names an advance cleared. Kept as an export because a caller may still ask; the pool
 * is what clears them now, so this reads the ailments the advance itself removed — which
 * is the regen source's absence, not a cure. `battleStatusEventAdvance` is the cure path.
 */
export function advanceAilmentTimers(combatants: Combatant[], elapsed: number): string[] {
  return advanceAilmentTimeline(combatants, elapsed)
    .filter((event) => event.kind === "recovery")
    .map((event) => event.ailment);
}

/**
 * The Frozen action-block roll for one combatant — `F0x800a19d8`, reached through the
 * vtable word `0x800a4660`. True means the actor LOSES the turn; the roll never clears
 * the status bit, because its whole body stores nothing outside its own stack frame
 * (`docs/research/battle/battle-formula-leaves.md` "Appliers + wake-up roll").
 *
 * The original calls it from two gates, one per side, and both use it the same way:
 * the player's own command-menu instruction `F0x800a7418` step 1 with the argument `0`
 * (the player side: `andi $a0,$s0,0xff` picks `[0x800a4468]` for 0 and `[0x800a446c]`
 * otherwise) and the enemy turn gate `F0x80088564` with `0x10`. Both branch
 * `beqz -> proceed`, so a nonzero return is the blocked turn.
 */
export function frozenGateBlocksTurn(c: Combatant, rng: () => number = RAND_U16): boolean {
  if (!c.ailments?.frozen) return false;
  // F0x800a19d8 consumes effective Thunder (+0x14) plus Paralyze resistance
  // (+0x1c). Both fields are now mapped by STATUS-C010; explicit hosts may
  // still provide the already-summed native value.
  const fields = recoveryField(c, "frozen");
  const resistance = c.frozenBlockResistance ?? fields.element + fields.statusResistance;
  return frozenBlockRoll(c.ailments.frozen.power, resistance, rng);
}

/**
 * The pre-turn gate. `frozenGate` is the switch between the original's two gates:
 * true for the side's own turn gate (which rolls Frozen), false for the action-resolve
 * guard `F0x80098600`, which tests the sleep bit only — the player-side Frozen roll has
 * already happened by then, in the command-menu instruction, and rolling it a second time
 * would be a roll the original never makes.
 *
 * Gradual HP recovery is **not** here. It is a status-event machine of its own that runs
 * on the shared timeline and prints its own box page (kind 10, `esmfight[0x27]`), so
 * `advanceAilmentTimeline` owns it — see the note there and
 * engine/dw3/battle-ailment-display.ts `regenTickMessageSpec`.
 */
export function processTurnStart(
  c: Combatant, name: string, handleConfusion = true, frozenGate = true,
): TurnStart {
  const a = c.ailments;
  // The gate itself never prefixes a sentence of its own any more: the only thing that
  // used to sit in front of an action's line was the typed regeneration sentence, and
  // that is the kind-10 status page now. Kept as the field every caller reads.
  const prefix = "";
  // The three arms of FIGHTSTG_F0x80088564 (fightstg.s:5997-6027). Each one puts up ONE
  // battle message box page through the shared tail at `.L0x80088860`: the Digimon's name
  // on line one and the bank's own line on line two (kind 2). The words are the disc's,
  // read off `web/assets/data/battlecmd/esmfight.json`; none of them is a sentence typed
  // here. See engine/dw3/battle-ailment-display.ts for the citations.
  if (frozenGate && frozenGateBlocksTurn(c, RAND_U16)) {
    return turnStartSkip(prefix, name, "frozen", 0);
  }
  if (a.sleep) {
    return turnStartSkip(prefix, name, "sleep", 0);
  }
  if (a.confuse && handleConfusion) {
    // Enemy/auto path: FIGHTSTG_F0x80088564 emits one random gag (`0x83 + acc % 8`) and
    // skips the move picker. Player outcome is rolled earlier, when the joke-menu choice
    // is confirmed. Timed recovery is handled by the original queue.
    const draw = RAND_U16() >>> 0;
    const gag = draw % ENEMY_GAG_LINES.length;
    return turnStartSkip(prefix, name, "confuse", gag);
  }
  return { skipped: false, prefix };
}

/**
 * One skipped turn as the original's gate puts it up: the box page from
 * `ailmentTurnStartMessageSpec`, plus the same words flattened for the walker-only paths.
 */
function turnStartSkip(
  prefix: string, name: string, ail: AilmentKey, gag: number,
): TurnStart {
  const spec = ailmentTurnStartMessageSpec(name, ail, gag);
  const word = spec
    ? (ail === "sleep" ? "Asleep!"
      : ail === "frozen" ? "Frozen and can't move!"
        : ENEMY_GAG_LINES[gag] ?? "")
    : "";
  const out: TurnStart = {
    skipped: true,
    prefix: `${prefix}${name} ${word}`.trim(),
    gag,
    word,
  };
  if (spec) out.spec = spec;
  if (ail === "confuse") out.confused = true;
  return out;
}

/**
 * The HUD text tag this module used to build (`[PSN]/[FRZ]/[CNF]/[SLP]`) is gone.
 *
 * It was the walker's stand-in for the original's ailment overlay, and the decode
 * (engine/dw3/battle-ailment-display.ts) shows the original has no such overlay: a
 * 3D battle draws the plate's party marker — one cel for all four ailments — and names
 * the ailment in the shared battle message box. The tag is therefore removed rather
 * than translated; `partyIconIndex` is the ailment's picture.
 */

/**
 * HUD party-icon state, exact FIGHTSTG_F0x800934f0 (decoded 2026-08-19):
 *
 *   3 when any ailment bit is set (record +0x1c != 0),
 *   else 2 when HP == 0,
 *   else 1 when HP != max,
 *   else 0.
 *
 * The drawn sprite is cel 0xC + state for the side's ACTIVE slot and
 * 0x3C + state for every other slot (PGFGTC00, the pgfgc00 pack: cels 12-15 are
 * the four 12x9 icons, cels 60-63 the 12x7 inactive ones).
 */
export function partyIconIndex(c: Pick<Combatant, "hp" | "maxHp" | "ailments">): number {
  if (Object.keys(c.ailments ?? {}).length) return 3;
  if (c.hp === 0) return 2;
  return c.hp !== c.maxHp ? 1 : 0;
}

/** The pgfgc00 cel for a party-icon state: 0xC..0xF active, 0x3C..0x3F inactive. */
export function partyIconCel(index: number, active: boolean): number {
  return (active ? 0x0c : 0x3c) + Math.max(0, Math.min(3, index | 0));
}

export function setCounterStance(skill: Skill | null, user: Combatant): boolean {
  if (skill?.effect === "counter") { user.counterStance = { uses: 3 }; return true; }
  return false;
}

export function triggerCounter(
  attacker: Combatant, defender: Combatant, dmgTaken: number, attackerName: string,
): string {
  const cs = defender.counterStance;
  if (!cs || cs.uses <= 0 || dmgTaken <= 0 || defender.hp <= 0) return "";
  const back = counterDamage(dmgTaken);
  if (back <= 0) return "";
  attacker.hp = Math.max(0, attacker.hp - back);
  if (--cs.uses <= 0) delete defender.counterStance;
  return ` ${attackerName} took ${back} counter damage!`;
}
