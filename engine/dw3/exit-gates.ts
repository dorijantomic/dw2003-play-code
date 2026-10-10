import { flagConditionPasses } from '../systems/story-command-banks.ts';
// Flag-gated field exits. The scene extractor carries the original step-table
// predicate onto each exit as `{flag,eq[,flag_b,eq_b]}`. Predicate evaluation
// itself stays in the host's banked flag adapter; this helper only applies the
// decoded AND/polarity semantics and keeps unmodelled predicates dormant.

export interface ExitGate {
  flag: number;
  eq: number;
  flag_b?: number;
  eq_b?: number;
}

export interface GatedExit {
  gate?: ExitGate;
}

export type FlagConditionReader = (id: number) => 0 | 1 | null;

export function exitGatePasses(
  exit: GatedExit,
  getCondition: FlagConditionReader,
): boolean {
  const gate = exit.gate;
  if (!gate) return true;

  if (!flagConditionPasses(getCondition, gate.flag, gate.eq)) return false;

  if (gate.flag_b == null) return true;
  return flagConditionPasses(getCondition, gate.flag_b, gate.eq_b ?? 1);
}
