// Pure party/form selection rules used by the browser battle host.
//
// Runtime + static evidence establishes that Tag skips the active and KO'd
// records, and that its form submenu is rookie + the equipped triple filtered
// through the member's acquired-form ledger.  Keep these rules in the engine;
// presentation and mutable browser save orchestration stay in web/battle.js.

export interface BattleFormLedgerRecord {
  id: number;
}

export interface BattlePartyStats {
  hp?: number;
  equippedForms?: number[];
  formLedger?: BattleFormLedgerRecord[];
}

export interface BattlePartyMember {
  stats?: BattlePartyStats | null;
}

export type ActiveKoResolution =
  | { outcome: "tag"; candidates: number[] }
  | { outcome: "defeat"; candidates: [] };

export interface DnaEvolution {
  type: "dna";
  from1: string;
  level1: number;
  from2: string;
  level2: number;
  to: string;
}

export interface DnaMatch {
  evolution: DnaEvolution;
  activeRequirement: number;
  partnerRequirement: number;
}

/** Rookie followed by valid equipped forms, stable and duplicate-free. */
export function battleFormIds(
  rookieId: number,
  stats: BattlePartyStats | null | undefined,
): number[] {
  const acquired = new Set((stats?.formLedger ?? []).map((record) => Number(record.id)));
  const out: number[] = [];
  const add = (id: number) => {
    id = Number(id);
    if (id > 0 && !out.includes(id)) out.push(id);
  };
  add(rookieId);
  for (const rawId of stats?.equippedForms ?? []) {
    const id = Number(rawId);
    if (acquired.has(id)) add(id);
  }
  return out;
}

/** Indices Tag may target: present, non-active, and alive. */
export function tagCandidateIndices(
  members: BattlePartyMember[] | null | undefined,
  activeIndex: number,
): number[] {
  if (!members) return [];
  const out: number[] = [];
  for (let i = 0; i < members.length; i++) {
    if (i === activeIndex) continue;
    const hp = Number(members[i]?.stats?.hp ?? 0);
    if (hp > 0) out.push(i);
  }
  return out;
}

/** A KO only ends the battle when no other resident party record is alive. */
export function activeKoResolution(
  members: BattlePartyMember[] | null | undefined,
  activeIndex: number,
): ActiveKoResolution {
  const candidates = tagCandidateIndices(members, activeIndex);
  return candidates.length
    ? { outcome: "tag", candidates }
    : { outcome: "defeat", candidates: [] };
}

/** Resolve the reciprocal DNA route exposed after choosing a Tag form. */
export function findDnaEvolution(
  evolutions: DnaEvolution[] | null | undefined,
  activeForm: string,
  activeFormLevel: number,
  partnerForm: string,
  partnerFormLevel: number,
): DnaMatch | null {
  for (const evolution of evolutions ?? []) {
    const forward = evolution.from1 === activeForm && evolution.from2 === partnerForm;
    const reverse = evolution.from2 === activeForm && evolution.from1 === partnerForm;
    if (!forward && !reverse) continue;
    const activeRequirement = forward ? evolution.level1 : evolution.level2;
    const partnerRequirement = forward ? evolution.level2 : evolution.level1;
    if (activeFormLevel < activeRequirement || partnerFormLevel < partnerRequirement) continue;
    return { evolution, activeRequirement, partnerRequirement };
  }
  return null;
}

/** Native DNA commit charges the full result-tech MP cost to both participants. */
export function canPayDnaCost(activeMp: number, partnerMp: number, cost: number): boolean {
  return activeMp >= cost && partnerMp >= cost;
}

/** Combatant fields the DNA DV eligibility tests read, both participants. */
export interface DnaParticipants {
  activeMp: number;      // record +0x0c
  partnerMp: number;
  activeHp: number;      // record +0x08
  partnerHp: number;
  activeStatus: number;  // record +0x1c
  partnerStatus: number;
}

/** Which decoded test rejected the DNA DV confirm, or `null` when accepted. */
export type DnaRejection =
  | "active-mp" | "partner-mp"
  | "active-status-20" | "partner-status-20" | "active-status-08"
  | "active-hp" | "partner-hp";

/**
 * The seven DNA DV eligibility tests, in the native's exact execution order.
 *
 * Authority: original SLES-03936 assembly, ~/ddw3/asm/dw2003/pro/fightstg.s,
 * FIGHTSTG_F0x800980e4 page `ctx+0x10 == 1` substate `ctx+0x14 == 1`, block
 * 0x800984dc..0x800986f4. Ledger: DNA-C005 (branch set), DNA-C006 (silent
 * rejection), DNA-C009 (player-reachability), all `partially_verified` — decoded
 * statically; no controlled runtime capture exists yet.
 *
 *   1 acting  cur_mp  < cost    0x800985e0
 *   2 partner cur_mp  < cost    0x800985f4
 *   3 acting  +0x1c & 0x20      0x80098608
 *   4 partner +0x1c & 0x20      0x8009861c
 *   5 acting  +0x1c & 0x08      0x80098624
 *   6 acting  cur_hp <= 0       0x80098638
 *   7 partner cur_hp <= 0       0x80098648
 *
 * Every failing test jumps to the same convergence point 0x80098790, which only
 * redraws the pane: **rejection is silent**. The confirm feedback
 * (`D0x80055c48(0x0004001c)`) already fired at 0x80098530, BEFORE the first test,
 * so an invalid confirm gives the normal beep and then nothing at all — no error
 * message, no state change, cursor still on DNA DV. Callers must not add a
 * message or a second sound.
 *
 * Two asymmetries are load-bearing and deliberate: the partner is NOT tested for
 * bit 0x08, and neither side is tested for 0x10 on this row (the pane's first,
 * no-cost row uses a disjoint two-test set on 0x10 instead).
 *
 * `cur_mp == cost` is ACCEPTED — the compare rejects only on strictly-less-than.
 */
export function dnaRejection(p: DnaParticipants, cost: number): DnaRejection | null {
  if (p.activeMp < cost) return "active-mp";
  if (p.partnerMp < cost) return "partner-mp";
  if (p.activeStatus & 0x20) return "active-status-20";
  if (p.partnerStatus & 0x20) return "partner-status-20";
  if (p.activeStatus & 0x08) return "active-status-08";
  if (p.activeHp <= 0) return "active-hp";
  if (p.partnerHp <= 0) return "partner-hp";
  return null;
}
