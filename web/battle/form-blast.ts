import { learnOneTechnique, markOneLoadable } from "../form-tech-slots.js";
import { clampFighterScale } from "../battle3d.js";
import {
  finaleBattleKind,
  blastTargetId,
  markEquippedFormFlags as engineMarkEquippedFormFlags,
  isFormDigimonId,
  commitManualDigivolve as engineCommitManualDigivolve,
  statPenaltyOf,
} from "../vendor/engine.js";
import { normalizeDvGauge } from "./layout.js";
import type { BattlePartyEntry } from "./core/types.js";

import type { DigimonRecord, BattleState, PlayerRecord } from "../types/battle.js";
import type { FormLedgerEntry } from "../game/types.js";
interface FormChangeView {
  activeSlot: () => number;
  liveFormId: (slot: number) => number;
  writeLiveFormId: (slot: number, id: string | number) => void;
  reservedSecondForm: (slot: number) => number;
  reservedFormId: (slot: number) => number;
  clearReservedSecondForm: () => void;
  setFormFlag: (slot: number, k: number, value: number) => void;
  clearFormGauge: (rosterKey: number) => void;
  findTimelineIndex: () => number;
  clearTimelineCounter: () => void;
  rosterKey: (slot: number) => number;
  equippedForms: (slot: number, dest: (number | undefined)[]) => number;
  rosterSpecies: (slot: number) => number;
}

/**
 * The disc's per-form learn/load pass, one battle's worth: F0x8008670C until it
 * answers 0, then F0x80086844 until it answers 0. Each service fills ONE slot,
 * and the report's state machine re-enters their states after every message page
 * (state 0x19 selector 1 -> state 0x16, selector 2 -> state 0x17; the selector
 * table at 0x80082d80), so a single battle teaches EVERY technique whose gate the
 * new form level has passed and then marks every learned ordinary technique whose
 * load gate it has passed — one message page each, in slot order.
 *
 * Returns the ids learned and the ids that became loadable, in call order. The
 * guards bound the loops at the slot counts the services can fill (6 and 5).
 */
export function applyFormLearnPass(record: FormLedgerEntry, formProfile: DigimonRecord) {
  const learned: number[] = [];
  const loadable: number[] = [];
  for (let guard = 0; guard < 6; guard++) {
    const tech = learnOneTechnique(record, formProfile);
    if (!tech) break;
    learned.push(tech);
  }
  for (let guard = 0; guard < 5; guard++) {
    const tech = markOneLoadable(record, formProfile);
    if (!tech) break;
    loadable.push(tech);
  }
  return { learned, loadable };
}

// Sequential boss party: after the member at `index` is defeated, decide whether the next
// member steps in (gauntlet) or the whole party is down. Pure.
export function gauntletNext(party: BattlePartyEntry[] | null | undefined, index: number): { done: boolean; index?: number; entry?: BattlePartyEntry | undefined; } {
  const next = index + 1;
  if (!party || next >= party.length) return { done: true };
  return { done: false, index: next, entry: party[next] };
}

// ── Giant mode part 1 (F2 -> Extras -> "Giant mode", off by default) ─────────
// A boss-party entry may carry `size`: a multiplier on the fighter's shipped body size. The
// field is read ONLY when the toggle is on; with it off the entries come back with no `size`
// key at all and the renderer is never called, so every battle draws exactly as before.
export function partyEntriesWithSize(entries: BattlePartyEntry[], fxOn: boolean, k = 1): BattlePartyEntry[] {
  const mul = Number.isFinite(k) && k > 0 ? k : 1;
  return (entries || []).map((entry) => {
    const { size, ...rest } = entry;
    return fxOn ? { ...rest, size: clampFighterScale((Number(size) || 1) * mul) } : rest;
  });
}

/**
 * Hand the giant-mode sizes to the renderer. OFF: nothing is called, so both sides keep the
 * shipped MODEL_SCALE. ON: our side takes `playerK` (part 2's slider; 1 until it exists) and
 * the enemy takes the current party entry's `size` (1 when it carries none).
 */
export function applyGiantScales(renderer: { setFighterScale: (arg0: string, arg1: number) => void; }, entry: BattlePartyEntry | undefined, fxOn: boolean, playerK = 1) {
  if (!renderer || typeof renderer.setFighterScale !== "function") return false;
  if (!fxOn) return false;
  renderer.setFighterScale("player", clampFighterScale(playerK));
  renderer.setFighterScale("enemy", clampFighterScale(entry?.size ?? 1));
  return true;
}

// The F2 toggle's live value (ambience.js owns `window.__fx`). Read when a battle starts or a
// gauntlet member steps in, so switching it takes effect on the next fight.
export function giantModeOn() { return !!window.__fx?.giantmode; }

/**
 * The battle's LIVE kind word (0x800a4536): the finale's phase once it has advanced,
 * else setup's own value (`specialMode`). Stamped onto both combatant records so the
 * accuracy leaves read it; the phase writer is runFinaleBeat.
 */
export function battleKindOf(b: { specialMode?: number; _finaleKind?: number | null; [k: string]: unknown; } | null | undefined) {
  return finaleBattleKind(b?.specialMode ?? 0, b?._finaleKind);
}

/**
 * The final boss's mid-battle track switch, gated exactly as the original arms it.
 *
 * WFIGHTMN zeroes the transition counters only for battle 0x144, the Galacticmon
 * sequence (.L0x00001090-.L0x0000109c: mode 4, then `sb 0, +0xdb` / `sb 0, +0xda`),
 * and the damage-apply wrapper fires on the third counted application
 * (.L0x00004d90: `slti $v0, 0x3` / `bnez`) — BUT the wrapper's own gates come
 * first (.L0x00004d48-.L0x00004d70): the kind word must be 6 (the head phase; the
 * counter `+0xda` runs only while it is), the acting side must be the player's,
 * `+0xdb` must still be clear, and the applied delta must be nonzero. Pure so the
 * cue test can walk the boundary; the battle closure counts and calls it (see
 * noteFinalBossPhaseDamage).
 */
export function finalBossPhaseSwitchesTrack(specialMode: number, battleKind: number, landedCount: number) {
  return specialMode === 4 && battleKind === 6 && landedCount >= 3;
}

// Pick an enemy's vitals: prefer the REAL per-encounter hp/mp (extracted from ROM into
// field_encounters, e.g. boss screens carry boss-specific hp / 9999 mp) over the walker's
// computed fallback. A non-positive/absent real value (0 or undefined) means "not in the
// data" → use the fallback. Pure.
export function enemyVitals(real: { hp: number | undefined; mp: number | undefined; }, fallback: { hp: number; mp: number; }) {
  return {
    hp: real?.hp! > 0 ? real.hp : fallback.hp,
    mp: real?.mp! > 0 ? real.mp : fallback.mp,
  };
}

/** Native Manual-DV/Tag form commit: identity changes; the live stat body does not. */
export function setLiveBattleForm(record: PlayerRecord | BattleState, profile: DigimonRecord) {
  record.profile = profile;
  return record;
}

/**
 * The Blast target profile for one battle record: the record's ROOKIE profile's
 * `blasts[]` (profile +0x50+tier) read by the event-0x12 ladder
 * (engine/dw3/battle-formulas.ts::blastTargetId), or null when it has no Blast.
 *
 * One body for both fights: the one-on-one battle's own pick and the online
 * fight's `mpKit.blastForm` both call it. The profile table is handed in, since
 * the page's `digimonDB` is a closure of its own.
 */
export function blastTargetProfile(rec: PlayerRecord, db: { [k: string]: DigimonRecord; }) {
  const rookie = db?.[rec?.rookieId];
  const id = blastTargetId(rookie?.blasts, rec?.level ?? 1);
  return id ? (db?.[id] ?? null) : null;
}

/**
 * END OF BLAST — the one place a Blast stops, whatever ended it (its own
 * countdown, the revert program 0x62, a Tag commit, or the fight ending).
 *
 * The state write is the disc's shared release 0x800A7328 (wfightmn
 * .L0x00002174): the standing reserved second form (+0x1A) is dropped with it,
 * and the DV/Blast gauge at the roster record's +0x58 goes to zero. The zeroed
 * gauge reaches the card only through `persist`, which the arms that save supply
 * (the one-on-one loss arm writes nothing). `form` puts the record back into the
 * profile the Blast borrowed; it is off by default because the one-on-one battle
 * restores the form itself before it calls this (revertBlast, so the model is
 * back before the effect plays) and the online death arm has no form to go back
 * to. A Blast does not outlive its Digimon either way.
 *
 * `holder` is where the standing Blast lives — the battle in the one-on-one
 * fight (`b.blast`), the record itself online (`r.blast`, `{active, saved,
 * turns}`) — and `rec` is the record whose gauge it spent; they are the same
 * object online, so the online call is plain `endBlast(r)`. Returns true when a
 * Blast was ended.
 */
export function endBlast(holder: BattleState, { rec = holder, form = false, persist = null }: { rec?: BattleState | PlayerRecord; form?: boolean; persist?: (() => void) | null; } = {}) {
  const blast = holder?.blast;
  if (!blast?.active) return false;
  if (form && blast.saved) setLiveBattleForm(rec, blast.saved);
  holder.blast = null;
  rec.gauge = 0;
  if (persist) persist();
  return true;
}

/**
 * The member's equipped triple as F0x800176AC (get_equipped) presents it: the
 * valid entries in slot order, then `-1` for each empty position. The disc's
 * reader "emits only ids of 3 or above and fills the unused positions of the
 * three with -1" (claim auto-equip-full-triple-is-never-reduced-2026-10-03), so
 * a padded position reads back as 0xffff and is not below 3.
 */
export function equippedTriple(forms: readonly (number | string)[] | null | undefined) {
  const valid = (Array.isArray(forms) ? forms : []).map(Number).filter((id) => id >= 3);
  return Array.from({ length: 3 }, (_, i) => (valid[i] ?? -1));
}

/**
 * The engine's FormChangeView over one live battle record
 * (engine/dw3/battle-form-change.ts). `position` is the party position the call
 * acts on: F0x800A69F0's flag stores are indexed by it, and its lookups resolve
 * that position to the member's own equipped triple.
 */
function formChangeView(b: BattleState, position: number, profile: DigimonRecord | null = null): FormChangeView {
  return {
    activeSlot: () => position,
    liveFormId: (slot: number) => Number(b.playerRecords[slot]?.profile?.id ?? -1),
    // record +0x00: the form id, which the caller has already resolved to the
    // profile object the Digimon is taking.
    writeLiveFormId: (slot: number, id: string | number) => {
      const target = b.playerRecords[slot];
      if (!target || !profile || Number(id) !== Number(profile?.id)) return;
      setLiveBattleForm(target, profile);
    },
    // record +0x1A: the reserved second form is Blast's own writer (ledger
    // BLAST-9767), and the walker keeps Blast's state where the flag lives.
    reservedSecondForm: (slot: number) => (Number(slot) === position && b.blast?.active ? 1 : 0),
    reservedFormId: (slot: number) => Number(b.playerRecords[slot]?.rosterSpeciesId ?? 0),
    clearReservedSecondForm: () => releaseReservedSecondForm(b),
    // 0x80042B84 + position*4 + k. The original sets byte 6 on every form change
    // and byte 7 + the equipped row for the form just taken; the reader is the
    // report's DVEXP scan (stfgtrep.s state 0x14 arm, file 0x12C0), which pays
    // the gain and the form-level ladder for every marked row.
    setFormFlag: (slot: number, k: number, value: number) => {
      b.formFlags ??= [];
      const flags = b.formFlags[slot] ?? (b.formFlags[slot] = new Array(10).fill(0));
      flags[k] = value & 0xff;
    },
    // [0x80042B1C + rosterKey*2 + 0x58] is the roster slot's DV gauge; the
    // walker's per-record gauge is the same value.
    clearFormGauge: (rosterKey: number) => {
      const target = b.playerRecords[rosterKey] ?? b.player;
      if (!target) return;
      target.gauge = 0;
      persistPlayerGauge(b);
    },
    // [0x800A4374] is the resident timeline index the release clears counters
    // through; the walker models no timeline records, so it answers "none".
    findTimelineIndex: () => -1,
    clearTimelineCounter: () => {},
    rosterKey: (slot: number) => Number(b.playerRecords[slot]?.rosterIndex ?? slot),
    // get_equipped's contract: fill `dest` with the three rows and return the
    // count of valid entries (F0x800A69F0 scans dest and leaves on the first
    // match).
    equippedForms: (slot: number, dest: (number | undefined)[]) => {
      const triple = equippedTriple(b.playerRecords[slot]?.statsRecord?.equippedForms);
      for (let i = 0; i < 3; i++) dest[i] = triple[i];
      return triple.filter((id) => id !== -1).length;
    },
    // 0x8003EF5C + 0x58*rosterKey, halfword 0: the species row of the member's
    // own ROSTER SLOT — the starter it was born as. F0x800A69F0's short-circuit
    // is `rosterSpecies == live form` (wfightmn.s .L0x00000CA8), so the
    // comparison is against that rookie, never against the form the member is
    // configured to stand in.
    rosterSpecies: (slot: number) => Number(b.playerRecords[slot]?.rookieId ?? -1),
  };
}

/**
 * F0x800A69F0's mark alone, without the commit: byte 6 of the position's word
 * and byte 7 + the equipped row carrying the form just taken. The disc calls it
 * for the lead at battle setup (F0x800a66b0) and again on every Manual DV and
 * Tag commit; the report then pays DVEXP and the form-level ladder, and tries
 * one learn and one loadable, per marked row.
 */
export function markFormTaken(b: BattleState, position: number, speciesId: number) {
  if (!b?.playerRecords?.[position]) return;
  engineMarkEquippedFormFlags(formChangeView(b, position), Number(speciesId));
}

/**
 * The report's own DVEXP target scan for one participant (stfgtrep.s state-0x14
 * arm, file 0x12C0): for every equipped row whose mark byte at
 * `0x80042B84 + position*4 + 7 + formIndex` is set, the form that row holds —
 * and the disc's `form >= 4` guard drops anything that is not an acquired form.
 * In the walker's id space the rookies are 1..8, so `> 8` is the same guard.
 */
export function markedEquippedForms(flags: readonly number[] | null | undefined, equipped: readonly (number | string)[] | null | undefined) {
  const out: (number | undefined)[] = [];
  const triple = equippedTriple(equipped);
  for (let i = 0; i < 3; i++) {
    if (!Number(flags?.[7 + i] ?? 0)) continue;
    const id = triple[i];
    if (isFormDigimonId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The one form change, shared by every path that changes a battle form
 * (engine/dw3/battle-form-change.ts, the port of pro/wfightmn's 0x800A69F0,
 * 0x800A7328 and the commit at wfightmn.s:1680-1692).
 *
 * What the original writes, and nothing else: the live form id in the combatant
 * record, the equipped-form flag bytes at 0x80042B84, and — only while a
 * reserved second form is standing — the release of that reservation. No HP, MP,
 * stat, technique or ailment value is written, so the walker's record keeps the
 * numbers it had; `savedSpeciesId` is what makes effStats add the new form's own
 * base stats on the next read, exactly as F0x8009EC94 does.
 *
 * @param b the live battle
 * @param profile the profile the Digimon takes (its id is what the record carries)
 * @param position the party position that changes (the acting one for a Digivolve)
 */
export function commitBattleFormChange(b: BattleState, profile: DigimonRecord, position = b?.activePlayerIndex ?? 0) {
  const record = b?.playerRecords?.[position];
  if (!record) return null;
  engineCommitManualDigivolve(formChangeView(b, position, profile), Number(profile?.id));
  return record;
}

/**
 * Battle-end F0x800a7c00 writes every resident record back, not merely the
 * Digimon left on screen. A KO is returned to the field at 1 HP; its MP is
 * not overwritten on that branch. Module scope, because the gauge save below
 * and the release above are called from here as well as from inside the battle.
 */
export function syncPlayerRoster(b: BattleState | null | undefined) {
  for (const player of b?.playerRecords ?? []) writeBackBattleVitals(player);
}

/**
 * Write the party's stored stats back to disk, so a gauge spent (or earned)
 * mid-battle is still spent when the fight is over.
 *
 * `b.getState` is the field state accessor the running battle was built with;
 * it lives on the record because every caller of this is shared code, not the
 * factory: the reserved-second-form release is the original's own routine and
 * is reached from the Digivolve commit, the Tag commit and the Blast revert.
 */
export function persistPlayerGauge(b: BattleState | null | undefined) {
  if (!b?.player) return;
  syncPlayerRoster(b);
  const state = b.getState?.();
  if (!state) return;
  localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
  localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
}

/**
 * The reserved-second-form release (0x800A7328): the DV/Blast gauge goes to zero
 * and the standing reservation goes with it. Shared by the Digivolve commit, the
 * Tag commit, the Blast revert and the battle-outcome path (wfightmn .L0x00002174),
 * which is why none of them repeats the gauge write.
 *
 * `persist` is off only on the loss exit: the disc runs this release there too, but
 * the loss arm writes nothing to the card, so the walker must leave its stored
 * party untouched while still clearing the live gauge.
 */
export function releaseReservedSecondForm(b: BattleState | null | undefined, persist = true) {
  if (!b?.blast?.active) return false;
  b._blastPending = false;
  b._blastRevertPending = false;
  // The one-on-one arm of endBlast: the standing reservation lives on the battle
  // (`b.blast`), the gauge it spent on the partner record (`b.player.gauge`), and
  // the form is already back before this runs (revertBlast restores it first).
  return endBlast(b, { rec: b.player, persist: persist ? () => persistPlayerGauge(b) : null });
}

/**
 * The battle-outcome arm of the shared release (wfightmn .L0x00002174, file
 * 0x2174). The disc runs `0x800A7328` on EVERY exit arm — win, loss, enemy fled —
 * BEFORE the result byte is read: while the acting combatant's `+0x1A` reservation
 * is standing it clears it and zeroes the DV/Blast gauge at
 * `0x80042B1C + rosterKey*2 + 0x58` (wfightmn.s:1393-1421). A Blast that ends
 * because the FIGHT ended therefore resets the gauge exactly as a normal revert
 * does — confirmed live in `captures/blast-presentation-2026-07-14/README.md`
 * (blast_run3: "Woodmon died while Blast active -> b0 01->00, gauge->0").
 *
 * The SAVED exits (win, enemy-fled) persist the zeroed gauge through the same
 * write-back the report uses. The loss arm writes nothing to the card at all, so
 * its zero is left in RAM only (`persist` off) and the stored party is untouched.
 *
 * Exported so a headless check can pin the rule with the very call `endBattle`
 * makes. Returns true when the release ran.
 */
export function battleOutcomeRelease(b: BattleState, result: string) {
  if (!b?.blast?.active) return false;
  return releaseReservedSecondForm(b, result !== "lose");
}

/** Native battle-outcome write-back for one resident player record. */
export function writeBackBattleVitals(player: PlayerRecord) {
  if (!player?.statsRecord) return;
  if (player.hp <= 0) player.statsRecord.hp = 1;
  else {
    player.statsRecord.hp = player.hp;
    player.statsRecord.mp = player.mp;
  }
  player.statsRecord.dvGauge = normalizeDvGauge(player.gauge);
  // The three persistent penalty halfwords (roster +0x42/+0x44/+0x46) the post-hit arms
  // write: they live on the roster member, so a penalty landed this battle survives to the
  // field and only the inn's rest clears it (F0x8001104c). `statPenaltyOf` normalizes a
  // record that never took one to three zeros.
  player.statsRecord.statPenalty = statPenaltyOf(player);
}

// ── The shared loss exit ────────────────────────────────────────────────────
// One rule for every battle kind, because the original has one: wfightmn's mode-2
// tick (`F0x800a7c00`, mode word at object+0x14 == 2) is entered on the loss, not on
// a battle kind. It waits for the defeat effect's phase 2, builds the fade object
// `F0x8008aaac` (tick 0x8008aa08) and calls `F0x8008a83c(obj, 0, 10)`; the quad's
// grey level rises 0 -> 0xFF00 over 10 ticks and then holds, so the screen is black
// and STAYS black. Nothing else happens here. `F0x800a7328` (called at
// pro/wfightmn.s .L0x00002174, before the result byte is even read) takes two
// records from `[0x800a4374]` and clears three things, read at pro/wfightmn.s
// .L0x00001548-.L0x00001630: the byte at `0x800a4470 + group*0x20` + 0x1A (the
// group's reserved form), the halfword at `0x80042b1c + group*0x40` + 0x58, and the
// halfword at `0x800a3868 + i*0x1C` on each of the two records. Every store in that
// routine is one of those three; it writes no memory-card record, no money and no
// story flag. Then result byte 2 alone asks the launcher for 0xE00, the title screen.
// See docs/research/battle/battle-loss-decoded-2026-10-02.md, whose step 4 left this
// routine unread; the reads above are from the assembly.
/**
 * The Blast-on landing heal, decoded from wfightmn F0x800a8bf4 (state 2):
 *
 *   temp_s0->unk8 = temp_s0->unk6;            // hp = maxHP, unconditional
 *   if (temp_s0->unk1C & 4) { ...; temp_s0->unk1C &= 0xFB; }   // clear CONFUSE only
 *
 * The full heal is unconditional; the pending confusion recovery event is
 * cancelled and ONLY the 0x04 bit is cleared. Poison (0x01), Frozen (0x02) and
 * Sleep (0x08) survive a Blast.
 */
export function blastLandingHeal(player: PlayerRecord | null | undefined) {
  if (!player) return { healed: false, curedConfuse: false };
  const wasHp = player.hp;
  player.hp = player.maxHp;
  let curedConfuse = false;
  if (player.ailments?.confuse) {
    delete player.ailments.confuse;
    curedConfuse = true;
  }
  return { healed: player.hp !== wasHp, curedConfuse };
}
