import { type DuelSide, type DuelState, takeFromHand } from "./duel-state.ts";
import { type DuelAgents, agentFor, sortDuelHands, turnOrder } from "./duel-ai.ts";
import { type EffectRecord, applyProgramEffect, awaitingCardChoice, canPlayProgram } from "./effects.ts";
import { HAND_LIMIT } from "./types.ts";

/** Load and Compile share one routine in the original (both dispatch tables
 *  point modes 5 and 7 at F0x8009fdd8), so they share one here.
 *
 *  A TURN IS AN EXCHANGE, NOT A SINGLE ACTION.
 *  — `cardduel-load-compile-turn-rules-2026-08-21` (**verified**), §D.4 states
 *    1, 2/3, 0xA, 0xB, 0xC and 0xE.
 *
 *  State 1 dispatches on the turn's play count `duel+0x575`:
 *
 *      count 0 → the side selected by `duel+0x578` (the turn's lead)
 *      count 1 → the other side (the answer)
 *      count 2 → the lead again
 *      count > 2 → state 0xC, the resolve — three plays cap a turn
 *
 *  so one turn is up to three plays that ping-pong between the sides. State 0xA
 *  raises the count after each play; state 0xE then flips `+0x578`, raises the
 *  turn counter `+0x576` and ends the phase only when `+0x577` has reached 2.
 *
 *  ONLY AN EMPTY TURN IS A PASS. The pass branches of states 2 and 3 test the
 *  play count first: a side that declines with nothing played this turn loads
 *  the delay counter `+0x57C` with twenty ticks, plays packed sound 0x00040019
 *  (SYSTEM03, the shared window-open sound) and raises `+0x577`; a side that
 *  declines after a play has been made goes straight to the resolve and never
 *  touches `+0x577`. A phase in which both sides keep playing cannot end by
 *  passing at all — it ends when both stop having something to play.
 *
 *  THE TURN'S EFFECTS RESOLVE AT ITS END, NEWEST FIRST.
 *  — `cardduel-effects-resolve-after-the-turn-2026-08-21` for the batch. For
 *    the ORDER, which that claim leaves open, read 2026-08-25 out of
 *    ~/ddw3/asm/dw2003/pro/cardgame.s: the effect driver F0x800A2180 fetches
 *    the program of `history[+0x575 - 1]` (L32163-32172: `lb $v0, 0x575($s1)`,
 *    `addiu $v0, -0x1`, `lh $v0, 0x580($v0)`) — always the LAST play — and when
 *    that program ends it drops the count by one, or **by two when `+0x4dd` is
 *    set** (L32299-32304). `+0x4dd` has exactly one writer in the overlay: the
 *    update phase of effect opcode 0x41, the cancel (registry target
 *    0x800855a8), and the driver clears it before each program (L32124). So a
 *    card printed as a cancel resolves BEFORE the card it cancels and takes
 *    that card's program off the queue unrun.
 *
 *  `duel.programTurns` is null unless someone is driving the phase this way. */
export interface TurnPlay {
  /** who played it */
  side: DuelSide;
  /** the card, waiting in the played row until the turn resolves it */
  cardId: number;
}

export interface ProgramTurns {
  /** the two sides, the coin toss's side first */
  order: DuelSide[];
  /** `duel+0x578`: 0 while `order[0]` leads the turn, 1 after a flip */
  lead: number;
  /** `duel+0x575`: plays made this turn, 0..3 */
  plays: number;
  /** `duel+0x577`: consecutive turns in which nothing was played */
  passes: number;
  /** `duel+0x576`: turns taken this phase */
  turn: number;
  /** `duel+0x57C`: ticks left of a pass delay */
  passDelay: number;
  /** the turn's plays in the order they were made; resolved last-first */
  history: TurnPlay[];
  /** the play whose program is running, while it runs */
  resolving: TurnPlay | null;
  /** which beat the turn is on: taking plays, sitting out a pass, resolving */
  state: "play" | "pass" | "resolve";
  /** true once the phase is over (state 0xF) */
  done: boolean;
  /** a play whose program has not finished asking */
  pending: boolean;
}

/** State 0xB's counter: `+0x57C` is loaded with 0x14 and counted down one a
 *  frame before the turn moves on. */
export const PASS_DELAY_TICKS = 0x14;

export function beginProgramTurns(duel: DuelState): ProgramTurns {
  duel.playedThisPhase = [];
  // F0x8009D8FC, called at cardgame.s:29949 in the opponent's Program Phase
  // immediately before the AI's legality scan F0x800A4978. The array it sorts
  // is the opponent's hand, so the screen shows class order from here on.
  sortDuelHands(duel);
  const t: ProgramTurns = {
    order: turnOrder(duel),
    lead: 0,
    plays: 0,
    passes: 0,
    turn: 0,
    passDelay: 0,
    history: [],
    resolving: null,
    state: "play",
    done: false,
    pending: false,
  };
  duel.programTurns = t;
  return t;
}

/** Whose turn it is, or null when the phase is over, is resolving, is sitting
 *  out a pass delay, or is not being driven a turn at a time. */
export function programTurnSide(duel: DuelState): DuelSide | null {
  const t = duel.programTurns;
  if (!t || t.done || t.state !== "play") return null;
  // State 1: counts 0 and 2 go to the lead, count 1 to the other side.
  const answering = t.plays === 1 ? 1 : 0;
  return t.order[(t.lead + answering) % t.order.length] ?? null;
}

/** True while the turn's plays are resolving, so nothing may ask for a card. */
export function programTurnResolving(duel: DuelState): boolean {
  return duel.programTurns?.state === "resolve";
}

/** State 0xE. The turn is over: clear the play count and the history, flip the
 *  lead, raise the turn counter, and end the phase on the second empty turn. */
function nextProgramTurn(duel: DuelState): void {
  const t = duel.programTurns;
  if (!t) return;
  t.plays = 0;
  t.history = [];
  t.resolving = null;
  t.lead = (t.lead + 1) % t.order.length;
  t.turn += 1;
  t.state = "play";
  if (t.passes >= 2) t.done = true;
}

/** Give up the turn.
 *
 *  With nothing played this turn that is a pass: twenty ticks, the sound and
 *  the pass counter. With a play already made it is only the end of the turn —
 *  the plays resolve and `+0x577` is not touched. */
export function passProgramTurn(duel: DuelState, side: DuelSide): boolean {
  const t = duel.programTurns;
  if (!t || programTurnSide(duel) !== side) return false;
  if (t.plays === 0) {
    t.passes += 1;
    t.passDelay = PASS_DELAY_TICKS;
    t.state = "pass";
    return true;
  }
  t.state = "resolve";
  return true;
}

/** Count a pass delay down. A screen calls this once a frame; a driver without
 *  one passes the whole delay at once. */
export function tickProgramTurns(duel: DuelState, ticks = 1): void {
  const t = duel.programTurns;
  if (!t || t.state !== "pass") return;
  t.passDelay = Math.max(0, t.passDelay - ticks);
  if (t.passDelay === 0) nextProgramTurn(duel);
}

/** Play a card on this side's turn.
 *
 *  The card leaves the hand for the played row here — state 6 is what commits
 *  it — and its program does NOT run yet. State 1 then either hands the turn to
 *  the other side or, at the third play, sends the turn to the resolve. */
export function playProgramTurn(
  duel: DuelState,
  side: DuelSide,
  slot: number,
  effects: Map<number, EffectRecord>,
  _rng: () => number = Math.random,
  _opts: { interactive?: boolean } = {},
): boolean {
  const t = duel.programTurns;
  if (!t || programTurnSide(duel) !== side) return false;
  const id = side.hand[slot];
  if (id === undefined) return false;
  const rec = duel.byId.get(id);
  if (!rec || rec.kind !== "program") return false;
  const eff = effects.get(id);
  if (!canPlayProgram(duel, side, eff)) return false;
  takeFromHand(side, slot);
  duel.playedThisPhase.push(id);
  t.history.push({ side, cardId: id });
  duel.log.push(`${side.name}: ${rec.name}`);
  // State 1 clears the pass counter as soon as a play has been made.
  t.passes = 0;
  t.plays += 1;
  // State 1 again: a count above two is the three-play cap.
  t.state = t.plays > 2 ? "resolve" : "play";
  return true;
}

/** Send a played card to its owner's discard, which is where the turn leaves
 *  it. The disc's own mover for the cancelled case is F0x8008F790 — "the card
 *  flies out, lands in its owner's discard". */
function retirePlayedCard(duel: DuelState, play: TurnPlay): void {
  const at = duel.playedThisPhase.lastIndexOf(play.cardId);
  if (at >= 0) duel.playedThisPhase.splice(at, 1);
  play.side.trash.push(play.cardId);
}

/** Drive the turn's resolve, and its turn changes, as far as they will go
 *  without a question only the player can answer. */
export function pumpProgramTurns(
  duel: DuelState,
  effects: Map<number, EffectRecord>,
  rng: () => number = Math.random,
  human?: DuelSide | null,
): void {
  const t = duel.programTurns;
  if (!t) return;
  let guard = 0;
  while (guard++ < 8 * HAND_LIMIT) {
    if (awaitingCardChoice(duel)) return;
    if (t.state !== "resolve") return;
    if (t.resolving) {
      // The program that was running has finished.
      const done = t.resolving;
      t.resolving = null;
      if (duel.cancelPrevious) {
        // `+0x4dd`: the driver drops TWO history entries, so the play before
        // this one never runs its program at all.
        duel.cancelPrevious = false;
        const cancelled = t.history.pop();
        if (cancelled) {
          const rec = duel.byId.get(cancelled.cardId);
          duel.log.push(`${cancelled.side.name}: ${rec?.name ?? "card"} — cancelled`);
          retirePlayedCard(duel, cancelled);
        }
      }
      retirePlayedCard(duel, done);
      continue;
    }
    const play = t.history[t.history.length - 1];
    if (!play) { nextProgramTurn(duel); return; }
    t.resolving = play;
    t.history.pop();
    duel.cancelPrevious = false;                 // the driver's own clear
    const eff = effects.get(play.cardId);
    const interactive = !!human && play.side === human;
    const ran = applyProgramEffect(
      duel, play.side, play.cardId, eff, undefined, rng, { interactive },
    );
    if (!ran && !awaitingCardChoice(duel)) {
      // escardgm.toml has a line for this: "The card has no effect".
      const rec = duel.byId.get(play.cardId);
      if (rec) duel.log.push(`${play.side.name}: ${rec.name} — the card has no effect`);
    }
  }
}

/** Hand the turn on once the card that was played has finished asking. */
export function settleProgramTurn(
  duel: DuelState,
  effects?: Map<number, EffectRecord>,
  rng: () => number = Math.random,
  human?: DuelSide | null,
): void {
  const t = duel.programTurns;
  if (!t) return;
  if (awaitingCardChoice(duel)) return;
  t.pending = false;
  if (effects) pumpProgramTurns(duel, effects, rng, human);
}

/** Run every turn that belongs to a side playing for itself, stopping when the
 *  phase ends or `human`'s turn comes round.
 *
 *  `hold` keeps the twenty-tick pass delay for a caller that has a screen and a
 *  frame clock; a caller without one flushes it so the phase still advances. */
export function runProgramTurns(
  duel: DuelState,
  agents: DuelAgents,
  effects: Map<number, EffectRecord>,
  human: DuelSide | null,
  rng: () => number = Math.random,
  opts: { hold?: boolean } = {},
): void {
  let guard = 0;
  while (guard++ < 16 * HAND_LIMIT) {
    const t = duel.programTurns;
    if (!t || t.done) return;
    if (awaitingCardChoice(duel)) return;
    if (t.state === "resolve") {
      pumpProgramTurns(duel, effects, rng, human);
      if (awaitingCardChoice(duel)) return;
      continue;
    }
    if (t.state === "pass") {
      if (opts.hold) return;
      tickProgramTurns(duel, t.passDelay);
      continue;
    }
    const side = programTurnSide(duel);
    if (!side || side === human) return;
    const agent = agentFor(duel, agents, side);
    const slot = agent.chooseProgram ? agent.chooseProgram(duel, side, effects) : -1;
    if (slot < 0 || slot >= side.hand.length) { passProgramTurn(duel, side); continue; }
    if (!playProgramTurn(duel, side, slot, effects, rng)) passProgramTurn(duel, side);
  }
}

/** The phase with nobody watching: the same machine, both sides played by their
 *  agents. `stepPhase` takes this path when no screen is driving the turns. */
function programPhase(
  duel: DuelState,
  agents: DuelAgents,
  effects: Map<number, EffectRecord>,
  rng: () => number,
): void {
  beginProgramTurns(duel);
  runProgramTurns(duel, agents, effects, null, rng);
  duel.programTurns = null;
}
