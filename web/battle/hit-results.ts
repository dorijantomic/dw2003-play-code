import {
  foldElemBonuses as engineFoldElemBonuses,
  effStats as engineEffStats,
  resolveAttack as engineResolveAttack,
  resolveMultiHit as engineResolveMultiHit,
  weaponSecondaryProc as engineWeaponSecondaryProc,
  applyAilment as engineApplyAilment,
  tryInflict as engineTryInflict,
  tryInstantDeath as engineTryInstantDeath,
  chooseResultPage as engineChooseResultPage,
  battleMessagePage,
  ailmentInflictMessageSpec as engineAilmentInflictMessageSpec,
  ailmentInflictWord as engineAilmentInflictWord,
  RAND_U16,
  weaponDrainHeal as engineWeaponDrainHeal,
  processTurnStart as engineProcessTurnStart,
} from "../vendor/engine.js";
import { techRecordAccuracy } from "../tech-record.js";
import { S } from "./state.js";
import { MSG, MSG_KIND } from "./messages.js";

// ── Combat resolvers (module-level so they are headless-portable + unit-testable).
// Closure-independent combat helpers. Ailment application and turn-start lifecycle delegate
// to engine/dw3/battle-combat.ts so the browser does not carry a second implementation.

export const foldElemBonuses = engineFoldElemBonuses;

export const effStats = engineEffStats;

export const noteHit = (kind: string, r) => { S.hitNote = { seq: ++S.hitSeq, kind, hit: !!r.hit, dmg: r.dmg | 0, heal: r.heal | 0, crit: !!r.crit, eff: Number.isFinite(r.eff) ? r.eff : 1 }; return r; };

export const lastHitNote = () => S.hitNote;

export const resolveAttack = (...a) => noteHit("hit", engineResolveAttack(...a));

export const resolveMultiHit = (...a) => noteHit("hit", engineResolveMultiHit(...a));

export const weaponSecondaryProc = engineWeaponSecondaryProc;

export const applyAilment = engineApplyAilment;

/**
 * Roll one attack's ailment and instant death against `defender`.
 *
 * Returns `{ text, ail }`. `ail` is the ailment key that landed, which the caller puts up
 * as the battle message box's OWN second page (`ailmentBoxPage`): in the original the
 * damage line and the ailment word are two pages with a Circle press between them, not
 * one sentence (fightstg.s:14624-14626 waits on the damage line's slot, `:14705` then
 * builds the "apply what landed" object, `:15277-15279` waits again before its next page).
 * `text` is only the walker's own fragment for instant death, which is not one of the
 * four ailments and has no ailment page.
 */
export function tryInflict(skill, defender, defenderName: string, attacker) {
  const ail = engineTryInflict(skill, defender, defenderName, attacker);
  return { text: engineTryInstantDeath(skill, defender, defenderName, attacker), ail };
}

/**
 * THE RESULT-PAGE CHOOSER, on the walker's side of it.
 *
 * `FIGHTSTG_F0x8008cb70` (`~/ddw3/asm/dw2003/pro/fightstg.s:10141-:10656`) is the one
 * routine that decides which line the battle box shows for a blow that has just landed,
 * and it is a port of it that runs here — `engine/dw3/battle-result-page.ts` holds the
 * machine and this is where the walker's own facts are handed to it. The five arms, in the
 * order the original tests them:
 *
 *   multi-hit (queue slot 9) -> kind 16, the "3 X 2 = 45 damage!" page
 *   instant death (queue slot 6) -> NO PAGE. The original zeroes the beaten member's HP,
 *     puts the page object it already allocated into its state 3 — which resets the line
 *     panel — and never asks for a kind (`:10374`-`:10379`). This arm is tested BEFORE
 *     the landed/evaded arms, so it takes the damage line down with it.
 *   Cross Slash (queue slot 35, and that slot belongs to Cross Slash alone) -> kind 4
 *   landed (header +0x30) -> kind 4, the amount the blow did
 *   missed (header +0x30 clear) -> kind 2, `esmfight[0x1d]` "Evade!"
 *
 * `record` is the acting technique's own disc record (or null for a plain attack that has
 * none), `multiHit` is the multi-hit applier having run, `instantDeath` is the
 * instant-death roll having landed (a technique or a signature weapon — both write the same
 * byte), and `landed` is whether a blow connected.
 *
 * The result is `{ choice, page }`: `page` is the message spec for the arm, and is null
 * exactly when the original prints nothing.
 */
export function chooseResultLine({ record = null, multiHit = false, instantDeath = false,
  landed = true, name = null, damage = 0 }) {
  const choice = engineChooseResultPage({
    dispatch: record?.dispatch ?? null,
    multiHit: !!multiHit,
    instantDeath: !!instantDeath,
    landed: !!landed,
  });
  if (choice.silent) return { choice, page: null };
  if (choice.arm === "evade") {
    return { choice, page: evadePageSpec(name) };
  }
  return { choice, page: battleMessagePage(choice.kind, { name, numbers: [damage | 0] }) };
}

/** The evasion page: the defender's name on line one, `esmfight[0x1d]` "Evade!" on line two. */
export function evadePageSpec(name) {
  return battleMessagePage(MSG_KIND.OUTCOME, { index: MSG.EVADE, name });
}

/**
 * The attack-announcement plate: the acting fighter's name on line one and
 * `esmfight[0x08]` "Attack!" on line two (kind 2, payload `[0x08]`).
 *
 * It is the SHARED plate both sides announce through. `FIGHTSTG_F0x80090e84`, the
 * attack-resolution sequencer, builds it for whichever fighter swings
 * (`pro/fightstg.s:14548`-`:14556` writes payload word 0 = 0x08 and asks for kind 2);
 * the walker reached it only from the player's own command confirm, so an enemy's
 * ordinary attack had no plate. Naming is the caller's: the player's confirm passes
 * the player's name, the enemy's action passes the enemy's.
 */
export function attackPageSpec(name) {
  return battleMessagePage(MSG_KIND.OUTCOME, { index: MSG.ATTACK, name });
}

/**
 * The page a landed ailment is put up as, or null when nothing landed.
 *
 * `text` is the walker's own flat sentence for `peek()`;
 * `spec` is the original's own `unkAC(line, 2, payload)` call — line 1 the afflicted
 * Digimon's name, line 2 the game's one word ("Poisoned!" / "Frozen!" / "Confused!" /
 * "Sleep!", `esmfight` 0x1e..0x21, written by FIGHTSTG_F0x80091534's applier arms).
 */
export function ailmentBoxPage(name: string, ail: string | null) {
  if (!ail) return null;
  const spec = engineAilmentInflictMessageSpec(name, ail);
  return spec ? { text: `${name} ${engineAilmentInflictWord(ail)}`, spec } : null;
}

/**
 * Apply a signature weapon's on-hit secondary (decoded 2026-09-13). Runs once
 * per plain attack, after the damage, the way the equipment appliers in
 * F0x8009e0cc run. Returns `{ text, ail }`: `text` is the walker's own flat fragment
 * for the legacy box, and `ail` is the ailment key that landed, which the caller puts up
 * as its own page the way a skill's ailment is (`ailmentBoxPage`).
 */
export function applyWeaponSecondary(attacker, defender: { hp: number; }, defenderName: string, damage = 0, attackerName = "") {
  const sec = engineWeaponSecondaryProc(attacker, defender, attacker.rightWeapon, RAND_U16);
  const drain = sec ? 0 : engineWeaponDrainHeal(attacker, attacker.rightWeapon, damage, RAND_U16);
  if (drain > 0) {
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + drain);
    const recovered = attacker.hp - before;
    // The original prints the weapon's HP drain as its own page: FIGHTSTG_F0x80091534's
    // opcode 12 arm caps the amount at the defender's own remaining pool
    // (fightstg.s:15008-15026) and asks for **kind 18** (`:15055`), whose arm
    // `.L0x80099f00` is line one `esmfight[0x16]` the name, line two `esmfight[0x22]`
    // `{1}HP healed!` (`:23988 li $a2, 0x22`) and the amount in slot 1. `payload[2]` is
    // zero on this arm, so the alternate `esmfight[0x8f]` `{1} MP absorbed!`
    // (`:23997 li $a2, 0x8f`) is NOT taken — that is the opcode-32 MP drain, which the
    // walker has no event for.
    return {
      text: recovered > 0 ? ` Drained ${recovered} HP!` : "",
      ail: null,
      ko: false,
      page: recovered > 0
        ? battleMessagePage(18, { name: attackerName, numbers: [recovered] })
        : null,
    };
  }
  if (!sec) return { text: "", ail: null, ko: false, page: null };
  if (sec.kind === "ko") {
    defender.hp = 0;
    // The walker's own words. The original's box prints NOTHING for an instant-death
    // KO — the result-page chooser's second arm — and `ko: true` is how the caller
    // learns that so it can ask the chooser instead of reading these words.
    return { text: ` ${defenderName} was struck down!`, ail: null, ko: true, page: null };
  }
  engineApplyAilment(defender, sec.kind, { effect_p2: sec.magnitude }, attacker, RAND_U16);
  // The original names the ailment with the game's own word (esmfight 0x1e/0x1f/0x20,
  // FIGHTSTG_F0x80091534's applier arms), as a page of its own.
  return { text: ` ${engineAilmentInflictWord(sec.kind)}`, ail: sec.kind, ko: false, page: null };
}

export const processTurnStart = engineProcessTurnStart;

// ---------------------------------------------------------------------------
// The category-4 arm of the technique record machine, on both sides of a battle.
//
// THE SHARED SYSTEM. `FIGHTSTG_F0x8008f714`'s category-4 handler is one routine,
// `0x8008fbec` (~/ddw3/asm/dw2003/pro/fightstg.s:13269-:13664), with six arms picked by
// its own five id comparisons (:13272-:13290). It is NOT a converted copy with hand
// rows: `engine/dw3/battle-damage-terms.ts` holds the port, and everything below calls it.
//
// THE PARTY SLOTS. The original keeps three 0x20-stride combatant records per side. The
// player's base is `0x800a4470` and the enemy's is `0x800a44d0`: `FIGHTSTG_F0x8008f5d4`
// builds the player base outright (`addiu $s6, $v0, 0x4470` at pro/fightstg.s:12883), the
// cure window builds it into `$s3` (:13340) and then walks `side * 0x60` off it (:13336-:
//13338, :13630), technique 100 hard-codes it (`addiu $a0, $v0, 0x4470` :13443), and the
// heal arm's ENEMY base is built on the spot (`addiu $s1, $v0, 0x4470` :13505 / `addiu $s1,
// 0x60` :13506). Inside one record: `+0x00` "this slot holds a Digimon" (`lh $v0, ($a0)`
// :13528), `+0x06` maximum HP (`lhu $v0, 0x6($a0)` :13536), `+0x08` current HP
// (`lh $v1, 0x8($a0)` :13532) and `+0x1c` the ailment bitmask (`lbu $v1, 0x1c($a2)` :13385
// on the cure window). The walker maps the player's three to `b.playerRecords[0..2]` — the
// same order `partyPipCels` reads for the plate's three party pips — and the enemy's side
// to its single active fighter, which is record 0. THE ENEMY SIDE IS A KNOWN LIMIT: the
// walker has no two more enemy records to fill slots 1 and 2, so a party-wide enemy-side
// heal touches the one fighter it models, and 100 / 375 restore the PLAYER's party
// because that arm hard-codes side 0.
//
// A CAVEAT I DID NOT RESOLVE: on the heal arm the enemy base is rebuilt for side 1 but
// NOT for side 0 — `beqz $v1, .L0x8008ffa4` :13504 skips :13505-:13506, so the side-0 walk
// uses whatever `$s1` the caller left (this routine's own prologue at :12958-:12968 only
// SAVES `$s1`, it never sets it). Every other arm in the handler walks `0x800a4470`
// explicitly, so the port uses the player base for side 0; that is an inference from the
// other arms, not something the instruction stream states for this one.
//
// NO ACCURACY ROLL. The applier `FIGHTSTG_F0x8009e0cc` reads the record's category byte
// at :28463 `lbu $v1, 0x4($s4)` and branches to the accuracy getters for categories 2 and 3
// only (:28465 / :28467), sending EVERY other category — category 4 included — to
// `.L0x8009e3c8` (:28468-:28470), which makes no roll. So a heal or a cure cannot miss and
// nothing here calls `resolveAttack`.

/** One side's three original combatant records, as the walker's own party members. */
/**
 * The attack a DNA result technique makes, straight from its disc record: category,
 * power, element, accuracy byte (+0x06), family and scalar. Category 4 (375, full restore
 * + cure all) is a heal, so `restore` is true and the resolver is never entered.
 */
export function dnaResultAttack(resultId: number, rec, fallbackTech, elementName: string) {
  const category = rec?.category ?? fallbackTech?.category;
  return {
    restore: (category | 0) === 4,
    skill: {
      id: resultId | 0,
      power: Number(rec?.power ?? fallbackTech?.power),
      attack_category: (category | 0) === 2 ? "physical" : "magical",
      element: elementName,
      base_acc: techRecordAccuracy(rec),
      target_family: rec?.elem2,
      damage_scalar: rec?.scalar,
      crit_bonus: 0,
    },
  };
}
