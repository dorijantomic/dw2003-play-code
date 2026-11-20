import {
  type DuelSide,
  type DuelState,
  applyDynamicStatMegas,
  canSummon,
  payEnergy,
  putOnField,
  recomputeTotals,
  summonFromHand,
  takeFromHand,
} from "./duel-state.ts";
import { type DuelAgents, agentFor, sortDuelHands, turnOrder } from "./duel-ai.ts";
import { ENERGY_COLOURS, FIELD_LIMIT, HAND_LIMIT, energyIndex, summonCost } from "./types.ts";

/** The Summon Phase: each side puts Digimon out until it stops, runs out of
 *  field slots or cannot pay. */
/**
 * The Summon Phase, played a turn at a time.
 *
 * WHY THIS EXISTS. `summonPhase` below resolves the whole phase in one call:
 * each side's agent is asked for slot after slot until it declines. For the
 * opponent that is right, but for the player it means the Summon Phase is not a
 * phase at all — the field just fills. Measured 2026-08-24: eight confirms took
 * the walker from the coin toss to the Compile Phase with five Digimon already
 * placed, and no Summon Phase was ever played.
 *
 * On the disc it is played. Mode 6 latches effect opcode 0x9A, whose enter
 * F0x80086D78 marks every hand entry usable or not and opens the card browser
 * over your hand, and the phase's own on-screen legend is escardgm 0x24:
 *
 *        "[cross] Select [square] Summon"
 *
 * so cross moves the selection and SQUARE is what places a Digimon. You summon
 * as many as you can afford and the field will hold, then the turn passes.
 *
 * Unlike the Load and Compile phases this is NOT a two-pass negotiation: the
 * side keeps the turn until it says it is done, which is the shape `summonPhase`
 * already had and which this preserves.
 */
export interface SummonTurns {
  /** the two sides, in this set's turn order */
  order: DuelSide[];
  /** whose turn it is, an index into `order` */
  turn: number;
  /** true once both sides have finished */
  done: boolean;
  /** F0x80087458: hand-slot marks and their already-paid energy, for this turn. */
  marks?: Set<number>;
  /** The per-side commit runs once, after the picker returns. */
  committed?: boolean;
}

export function beginSummonTurns(duel: DuelState): SummonTurns {
  // The second of the two F0x8009D8FC call sites, cardgame.s:30688, at the
  // Summon Phase kickoff. Same array, same order, run once per phase.
  sortDuelHands(duel);
  const t: SummonTurns = { order: turnOrder(duel), turn: 0, done: false };
  duel.summonTurns = t;
  return t;
}

/** Whose turn it is, or null when the phase is over or is not being driven. */
export function summonTurnSide(duel: DuelState): DuelSide | null {
  const t = duel.summonTurns;
  if (!t || t.done) return null;
  return t.order[t.turn] ?? null;
}

/** Place one Digimon. The turn does NOT pass — you may summon again. */
export function takeSummonTurn(duel: DuelState, side: DuelSide, slot: number): boolean {
  const t = duel.summonTurns;
  if (!t || summonTurnSide(duel) !== side) return false;
  if (!summonFromHand(duel, side, slot)) return false;
  recomputeTotals(side);
  return true;
}

/** F0x80087458 / F0x8008735C: toggle a hand mark, paying or refunding now.
 * Returns 0 for refusal, 1 for a new mark, and 2 for an unmark. The refund
 * precedes affordability checks: an already-paid card can always be unmarked.
 * CARD-DUEL-VERIFIED.md §25; selection capacity is six marks, independent of
 * the old field that F0x800A0754 will replace. */
export function toggleSummonMark(duel: DuelState, side: DuelSide, slot: number): 0 | 1 | 2 {
  const t = duel.summonTurns;
  if (!t || t.committed || summonTurnSide(duel) !== side || !Number.isInteger(slot)) return 0;
  const id = side.hand[slot];
  const rec = id === undefined ? undefined : duel.byId.get(id);
  if (!rec || rec.kind !== "digimon") return 0;
  const marks = t.marks ??= new Set<number>();
  const ei = energyIndex(rec.colour);
  if (marks.has(slot)) {
    if (ei >= 0) side.energy[ENERGY_COLOURS[ei]!] += summonCost(rec);
    marks.delete(slot);
    return 2;
  }
  if (marks.size >= FIELD_LIMIT) return 0;
  if (ei >= 0 && side.energy[ENERGY_COLOURS[ei]!] < summonCost(rec)) return 0;
  payEnergy(duel, side, id!);
  marks.add(slot);
  return 1;
}

/** Place every MARKED hand entry at once — the disc's commit.
 *
 * The Summon Phase is a mark-set, not a single cursor: F0x80086D78 opens the
 * browser, F0x800878B4 (`pickerPadPickSeveral`) toggles marks, Square raises
 * "Put in Field?", and the commit (F0x800A0754, duel method +0x818) walks the
 * marked entries.
 *
 * F0x800A0754 is a REBUILD, not an append. Read from the decompiled C: it
 * stores `*fieldCount = 0` at `+0x72C`, then walks the hand's marked `+0x46F`
 * entries in ascending slot order, calling F0x800A0708 to place each while the
 * count is under the running mark count `+0x444` (capped at six — §17 item 7 of
 * CARD-DUEL-VERIFIED.md), and finally compacts the hand with F0x800A0590. A
 * card on the field that is not among the marks is therefore dropped; the
 * Summon Phase resolver (F0x800A0B80) calls it once per side (F0x800A0BE8 for
 * side 0, F0x800A0C38 for side 1), so the rebuild begins from the fresh round
 * field. The old code appended and never zeroed — C9 of the fix list.
 *
 * Placement walks the original hand order. Only afterwards does F0x800A0590
 * compact the hand; removing from the end here preserves that same result.
 * Costs were paid by the mark toggle, and must not be charged again.
 *
 * Observed live, agent-driven, PAL, 2026-09-12: two marked Rookies committed
 * with Square put both on the field (capture
 * docs/research/card/captures/cardduel-entry-2026-09-12.md). */
export function commitMarkedSummons(duel: DuelState, side: DuelSide): number {
  const t = duel.summonTurns;
  if (!t || t.committed || summonTurnSide(duel) !== side) return 0;
  // F0x800A0754: `*fieldCount = 0` before the placement loop.
  side.field = [];
  const slots = [...(t.marks ?? [])].sort((a, b) => a - b);
  let placed = 0;
  for (const slot of slots) {
    const id = side.hand[slot];
    if (id !== undefined && putOnField(duel, side, id)) placed += 1;
  }
  for (let i = slots.length - 1; i >= 0; i--) takeFromHand(side, slots[i]!);
  t.marks?.clear();
  t.committed = true;
  recomputeTotals(side);
  return placed;
}

/** Batch adapter for callers that already chose hand slots. Uses the same
 * reserve/refund/commit path as the interactive picker, in hand order. */
export function commitSummons(duel: DuelState, side: DuelSide, slots: readonly number[]): number {
  const t = duel.summonTurns;
  if (!t || t.committed || summonTurnSide(duel) !== side) return 0;
  const wanted = new Set(slots.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < side.hand.length));
  for (const slot of [...(t.marks ?? [])]) {
    if (!wanted.has(slot)) toggleSummonMark(duel, side, slot);
  }
  for (const slot of [...wanted].sort((a, b) => a - b)) {
    if (!t.marks?.has(slot)) toggleSummonMark(duel, side, slot);
  }
  return commitMarkedSummons(duel, side);
}

/** Done summoning. The turn moves on; after the last side the phase is over. */
export function endSummonTurn(duel: DuelState, side: DuelSide): boolean {
  const t = duel.summonTurns;
  if (!t || summonTurnSide(duel) !== side) return false;
  recomputeTotals(side);
  // A caller ending an uncommitted picker releases its reservations. Normal
  // confirmation has already consumed the marks in commitMarkedSummons.
  for (const slot of [...(t.marks ?? [])]) toggleSummonMark(duel, side, slot);
  delete t.marks;
  t.committed = false;
  t.turn += 1;
  if (t.turn >= t.order.length) t.done = true;
  return true;
}

/** True when this side has a Digimon it could still place. */
export function canSummonAny(duel: DuelState, side: DuelSide): boolean {
  if (side.field.length >= FIELD_LIMIT) return false;
  return side.hand.some((id) => id != null && canSummon(duel, side, id));
}

/** Run every turn that belongs to a side playing for itself, stopping when the
 *  phase ends or `human`'s turn comes round. */
export function runSummonTurns(
  duel: DuelState,
  agents: DuelAgents,
  human: DuelSide,
): void {
  let guard = 0;
  while (guard++ < 4 * HAND_LIMIT) {
    const side = summonTurnSide(duel);
    if (!side || side === human) return;
    const agent = agentFor(duel, agents, side);
    const slot = agent.chooseSummon ? agent.chooseSummon(duel, side) : -1;
    if (slot < 0 || slot >= side.hand.length || !takeSummonTurn(duel, side, slot)) {
      endSummonTurn(duel, side);
    }
  }
}

/** `0x9A` — the summon browser opens over each side's hand, in turn order. */
export function summonOpen(duel: DuelState): DuelSide[] {
  return turnOrder(duel);
}

/** `0x9D` — auto-pick the affordable summons: each side places until it
 *  declines, runs out of field slots or cannot pay. */
export function summonAutoPick(duel: DuelState, agents: DuelAgents, order: DuelSide[]): void {
  for (const s of order) {
    const agent = agentFor(duel, agents, s);
    let guard = 0;
    while (s.field.length < FIELD_LIMIT && guard++ < HAND_LIMIT) {
      const slot = agent.chooseSummon ? agent.chooseSummon(duel, s) : -1;
      if (slot < 0 || slot >= s.hand.length) break;
      if (!summonFromHand(duel, s, slot)) break;
    }
    recomputeTotals(s);
  }
}

/** `0x9E` — the board sweep that settles the phase: the five dynamic Megas
 *  recompute. It runs after BOTH sides have placed, because two of the five
 *  formulas count the other side's board and trash. */
export function summonSweep(duel: DuelState): void {
  applyDynamicStatMegas(duel);
}

function summonPhase(duel: DuelState, agents: DuelAgents): void {
  summonAutoPick(duel, agents, summonOpen(duel));
  summonSweep(duel);
}
