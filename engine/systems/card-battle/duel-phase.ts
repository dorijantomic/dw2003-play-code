import {
  PHASE_CEREMONY,
  issueCeremony,
  BANNER_OPCODE,
  latch,
  beatFrames,
  beatWaitsForButton,
} from "../card-ceremony.ts";
import { type DuelBeatQueue, type DuelSide, type DuelState, phase } from "./duel-state.ts";
import { type DuelAgent, type DuelAgents, normaliseAgents } from "./duel-ai.ts";
import type { EffectRecord } from "./effects.ts";
import { battleCeremony, battleSettleSet } from "./combo-damage.ts";
import { DUEL_PHASES, type DuelPhaseKey, SETS_TO_WIN } from "./types.ts";
import { type CeremonyRun, applyCeremonyOp, finishDuel } from "./ceremony-ops.ts";

/**
 * Advance one phase.
 *
 * `agents` may be a {player, opponent} pair, a single agent used for both, or —
 * for older callers — a bare summon chooser function.
 */
export function stepPhase(
  duel: DuelState,
  agents?: DuelAgents | DuelAgent | ((duel: DuelState, s: DuelSide) => number),
  rng: () => number = Math.random,
  effects: Map<number, EffectRecord> = new Map(),
): void {
  if (duel.outcome) return;
  const a = normaliseAgents(agents);
  const p = phase(duel);

  // The disc announces the phase and then latches its ceremony opcodes before
  // the phase does any work — the banner is queued by the phase and put up by
  // the interpreter. Issue it once per phase entry: `load`, `compile` and
  // `summon` re-enter this function on every turn when something is driving
  // them a turn at a time, and the ceremony belongs to the phase, not the turn.
  duel.ceremonyPhaseKey = p.key;
  const stream = p.key === "battle" ? battleCeremony(duel) : PHASE_CEREMONY[p.key];
  const token = duel.set * DUEL_PHASES.length + duel.phaseIndex;
  if (duel.ceremonyToken !== token) {
    duel.ceremonyToken = token;
    issueCeremony(duel, p.key, stream);
  }

  // The phase is now DRIVEN by the opcodes it issues, in the captured order.
  // Every phase body below lives in `applyCeremonyOp`; nothing does the work
  // twice, because there is no other implementation left to do it.
  const run: CeremonyRun = {
    agents: a, rng, effects, phase: p,
    battle: null, summonOrder: null,
    began: false, resumed: false, parked: false, ended: false,
  };
  // The BANNER is applied too, not just listed. The Battle Phase's banner is
  // where the board is taken (see case 0xA5), so a drain that skipped it would
  // reach the attack with no combos scored -- which is exactly what it did
  // until 2026-08-28.
  for (const op of [BANNER_OPCODE[p.key], ...stream]) {
    applyCeremonyOp(duel, op, run);
    if (run.parked || run.ended) break;
  }
  if (run.parked || run.ended) return;

  // Battle-Phase states 0xA and 0xB latch no opcode, so they are settled here.
  // State 0x12's sweep IS one, and it goes on the same beat path this function
  // runs every other opcode through, so both drivers latch the same stream —
  // `cardgame.s:31444-31454` writes 0x1C or 0x1D into duel+0x421 whatever is
  // driving. State 0x11 gets there first and decides the duel, so no sweep is
  // latched for a duel that has ended.
  if (p.key === "battle") {
    battleSettleSet(duel, run.battle);
    if (duel.player.score >= SETS_TO_WIN || duel.opponent.score >= SETS_TO_WIN) {
      finishDuel(duel);
      run.ended = true;
    } else if (duel.setAward !== null) {
      const sweep = duel.setAward === 0 ? 0x1c : 0x1d;
      latch(duel, p.key, sweep);
      applyCeremonyOp(duel, sweep, run);
    }
  }

  duel.phaseIndex = (duel.phaseIndex + 1) % DUEL_PHASES.length;
}

/**
 * Advance the duel by ONE FRAME.
 *
 * WHY THIS EXISTS. `stepPhase` runs a whole phase per call, which is the one
 * thing about our duel that could never look like the disc's: on the disc a
 * single beat OWNS the frame while it plays out — the banner holds, the coin
 * toss turns over, the board sweep runs — and the duel advances only when that
 * beat's own timer expires. Nothing in our duel owned a frame, so the pacing
 * was structurally unreproducible however correct the logic was.
 *
 * This is the same implementation, drained differently. `applyCeremonyOp` is
 * still the only place a phase's work happens; `stepPhase` drains the phase's
 * beats immediately and this drains them one beat at a time, each holding the
 * screen for the frames measured off the disc (`BEAT_FRAMES`). There is no
 * second duel in here.
 *
 * A beat that waits on the player (`beatIsInputGated`) holds the frame until
 * whoever is driving answers it, exactly as a prompt does on the disc.
 */
export function tickDuel(
  duel: DuelState,
  agents?: DuelAgents | DuelAgent | ((duel: DuelState, s: DuelSide) => number),
  rng: () => number = Math.random,
  effects: Map<number, EffectRecord> = new Map(),
): void {
  if (duel.outcome) return;
  const b = duel.beat;

  // A beat that already owns the frame keeps it until its timer runs out.
  if (b.current !== null) {
    if (b.hold > 0) { b.hold -= 1; return; }
    if (b.gated) return;
    b.current = null;
  }

  // A card program's own steps play out before the phase moves on, and they
  // only animate: the interpreter already applied them. See `replay`.
  if (b.replay.length) {
    const shown = b.replay.shift()!;
    b.current = shown;
    b.hold = beatFrames(shown);
    b.gated = false;
    return;
  }

  const p = phase(duel);
  duel.ceremonyPhaseKey = p.key;

  // Out of beats: announce the phase and queue its ceremony. The lane is filled
  // ONCE per phase — the token is the phase's own — and the phase moves on at
  // the bottom of this function when its last beat has been issued. A lane that
  // is empty with the token already spent is a phase whose beats are all issued
  // and whose index has not moved yet, which happens only while the Battle
  // Phase's banner is still up: that wait is states 0x03 to 0x05
  // (`cardgame.s:31045-31096`) and nothing is issued again until the player
  // takes the banner down. Re-filling the lane here instead would put the
  // banner up a second time and wait for the player twice.
  if (!b.pending.length) {
    const token = duel.set * DUEL_PHASES.length + duel.phaseIndex;
    if (duel.ceremonyToken === token) {
      // Every beat this phase issues is issued, and the lane is empty. The
      // phase settles and moves on — unless the beat it ended on is still
      // waiting for a button, which is states 0x03 to 0x05 waiting for the
      // Battle banner (`cardgame.s:31045-31096`). The banner has to come down
      // first: the attack that decides the set runs after it, and if the award
      // landed on the banner's own frame the award's windows would take the
      // presses meant for the banner and each would wait for the other.
      if (b.gated) return;
      endDuelPhase(duel, b, p);
      return;
    }
    const stream = p.key === "battle" ? battleCeremony(duel) : PHASE_CEREMONY[p.key];
    duel.ceremonyToken = token;
    issueCeremony(duel, p.key, stream);
    b.pending = [BANNER_OPCODE[p.key], ...stream];
    b.phaseKey = p.key;
  }

  const op = b.pending.shift()!;
  const run: CeremonyRun = {
    agents: normaliseAgents(agents), rng, effects, phase: p,
    battle: b.battle, summonOrder: b.summonOrder,
    began: b.began, resumed: b.resumed, parked: false, ended: false,
  };
  applyCeremonyOp(duel, op, run);
  // The walk and the turn flags outlive the beat that set them.
  b.battle = run.battle;
  b.summonOrder = run.summonOrder;
  b.began = run.began;
  b.resumed = run.resumed;

  if (run.ended) { b.pending = []; b.current = null; b.gated = false; return; }
  if (run.parked) {
    // Whoever is driving this phase a turn at a time has not finished. Put the
    // beat back and retry it next frame — the same thing `stepPhase` does by
    // returning without advancing. `beatIsInputGated` describes the DISC; on
    // our side a beat waits only when a real driver has not answered, which is
    // what parking means. Under agents nothing waits, so the prompts pass
    // straight through.
    b.pending.unshift(op);
    b.current = null;
    b.gated = false;
    return;
  }

  b.current = op;
  b.serial = (b.serial ?? 0) + 1;
  b.hold = beatFrames(op);
  b.gated = false;

  // A banner does not run a timer: its update polls the pad and advances on
  // Circle or Cross with no timeout, so it holds the frame until whoever is
  // playing presses. See `BEAT_WAITS_FOR_BUTTON`. A headless duel has nobody to
  // press, so it keeps the measured hold instead of stopping forever.
  if (duel.human !== null && beatWaitsForButton(op)) {
    b.hold = 0;
    b.gated = true;
  }

  // The phase is over once its last beat has been issued — and not before that
  // beat has been taken down, which is the same wait as above.
  if (!b.pending.length) {
    if (b.gated) return;
    endDuelPhase(duel, b, p);
  }
}

/**
 * `tickDuel`'s phase hand-over, and — for the Battle Phase — the two states
 * that latch no opcode at all.
 *
 *  States 0xA and 0xB are settled as the phase's own beats run out, which is
 *  the same place the disc's state 9 falls through to state 0xA.
 */
function endDuelPhase(duel: DuelState, b: DuelBeatQueue, p: { readonly key: DuelPhaseKey }): void {
    // Battle-Phase states 0xA and 0xB latch no opcode, so they are settled as
    // the phase's own beats run out — the same place the disc's state 9 falls
    // through to state 0xA. State 0x12 is then queued, and only when the duel
    // survives the set, because only state 0x11's fall-through reaches it. It
    // goes on the ordinary pending lane, so the screen plays the winner's board
    // emptying through the same `beatStarted` case it always used — and because
    // a screen holds the lane while the result windows are up, it cannot land
    // before the player has read them.
    if (p.key === "battle") {
      battleSettleSet(duel, b.battle);
      if (duel.player.score >= SETS_TO_WIN || duel.opponent.score >= SETS_TO_WIN) {
        // State 0x11 is the duel-over test, and it writes the outcome byte
        // `duel+0x302` as it goes: 0 on the >= 2 arm at `cardgame.s:31418-31421`
        // (which also plays the win sound) and 1 on the mirrored arm at
        // `:31437-31441`. Its fall-through — the delay slot's `li $v0, 0x12` at
        // `:31426` — is the ONLY path that reaches state 0x12, so a duel that
        // survives the set never latches 0x1C / 0x1D. Here that is
        // `finishDuel` instead, and no sweep is queued.
        finishDuel(duel);
      } else if (duel.setAward !== null) {
        // State 0x12, aimed at one side: 0x1C at side 0 when you took the set,
        // 0x1D at side 1 when the opponent did (`cardgame.s:31444-31451`, where
        // the delay slot's 0x1D is overridden by the fall-through's 0x1C).
        const sweep = duel.setAward === 0 ? 0x1c : 0x1d;
        latch(duel, p.key, sweep);
        b.pending.push(sweep);
      }
    }
    // State 0x12's sweep is the LAST thing the Battle Phase does — it goes
    // straight to state 0x1A, the machine's return (`cardgame.s:31452-31454`) —
    // so the next set's phases must not begin until that beat has been issued.
    // The pending lane now holds it, so the phase is held here and moves on once
    // the beat has run, which is the order `stepPhase` settles it in too.
    if (b.pending.length) return;
    duel.phaseIndex = (duel.phaseIndex + 1) % DUEL_PHASES.length;
    b.began = false;
    b.resumed = false;
    b.battle = null;
    b.summonOrder = null;
}

/** Frames remaining before the duel will accept the next beat — what a screen
 *  would use to know the board is busy. */
export const duelBeatBusy = (duel: DuelState): boolean =>
  duel.beat.current !== null && (duel.beat.hold > 0 || duel.beat.gated);

/** True while a beat is waiting for the player to press Circle or Cross. */
export const duelBeatAwaitsButton = (duel: DuelState): boolean =>
  duel.beat.current !== null && duel.beat.gated && beatWaitsForButton(duel.beat.current);

/** The press. Releases a beat that is waiting on the pad — the disc's step 2.
 *
 *  Returns true when a beat was actually released, so a screen can tell a press
 *  that dismissed a banner from one that has to fall through to the phase. */
export function dismissBeat(duel: DuelState): boolean {
  if (!duelBeatAwaitsButton(duel)) return false;
  duel.beat.gated = false;
  duel.beat.hold = 0;
  return true;
}
