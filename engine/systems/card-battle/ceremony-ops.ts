import { latchDynamic } from "../card-ceremony.ts";
import type { DuelAgents } from "./duel-ai.ts";
import type { EffectRecord } from "./effects.ts";
import { DRAW_COUNT, DUEL_PHASES, SETS_TO_WIN } from "./types.ts";
import {
  type BattleWalk,
  battleAward,
  battleDrainSide,
  battleOpen,
  battleSweepWinner,
  battleTotals,
  battleTransfer,
  exchangeTotals,
} from "./combo-damage.ts";
import { type DuelSide, type DuelState, drawOne, recomputeTotals, shuffleDuelPiles } from "./duel-state.ts";
import { beginProgramTurns, runProgramTurns } from "./program-turns.ts";
import { beginSummonTurns, summonAutoPick, summonOpen, summonSweep } from "./summon-turns.ts";

/** State carried from one ceremony opcode to the next inside a single phase —
 *  the disc keeps the equivalent in the duel object's own accumulators. */
export interface CeremonyRun {
  agents: DuelAgents;
  rng: () => number;
  effects: Map<number, EffectRecord>;
  phase: (typeof DUEL_PHASES)[number];
  battle: BattleWalk | null;
  summonOrder: DuelSide[] | null;
  /** this call opened the phase's turns */
  began: boolean;
  /** this call found a turn-driven phase already finished */
  resumed: boolean;
  /** the phase is waiting on whoever is driving it; do not advance */
  parked: boolean;
  /** the duel ended inside this phase */
  ended: boolean;
}

/** Carry out one ceremony opcode. This is the duel's phase implementation:
 *  `stepPhase` issues the stream and this performs it, exactly as the disc
 *  latches `duel+0x421` and lets the interpreter carry it out. */
export function applyCeremonyOp(duel: DuelState, op: number, run: CeremonyRun): void {
  const { agents: a, rng, effects, phase: p } = run;
  switch (op) {
    // ---- the six phase announcements, 0xA0..0xA5 -------------------------
    case 0xa0:
      // Only the set banner reaches the log today; the other five announce
      // without a log line, which is what the walker already did.
      duel.log.push(`Set ${duel.set}: ${p.banner}`);
      return;
    case 0xa1: case 0xa2: case 0xa3: case 0xa4:
      return;
    case 0xa5:
      // The reveal queue was read when this phase's stream was built, so clear
      // it here: the beats now carry it and a second Battle Phase must not
      // re-issue them.
      duel.revealBeats = 0;
      // THE BATTLE PHASE'S BOARD IS TAKEN HERE, not on 0x19.
      //
      // On the disc the combo announcements are pure presentation: the machine
      // scans a side, and for EACH run it finds it latches a beat and comes
      // back for the next (`cardgame.s:30960-30968` for side 0's 0x19,
      // `:30974-30978` for side 1's 0x1A). The scan can find none, in which
      // case no beat is issued at all — so a rule hung on 0x19 would simply not
      // run. The board is taken once, when the phase opens.
      run.battle = battleOpen(duel);
      duel.combos = run.battle.combos;
      for (const [who, runs] of
           [["You", run.battle.combos.player], [duel.opponent.name, run.battle.combos.opponent]] as const) {
        for (const r of runs) {
          const into = duel.byId.get(r.into)?.name ?? `#${r.into}`;
          duel.log.push(`${who}: combo x${r.count} -> ${into}`);
        }
      }
      return;

    // ---- Start ----------------------------------------------------------
    case 0xa7: {
      // ONE shuffle, of the player's pile only. `SHUFFLED_PILES` is the decoded
      // member list: duel method +0x810 hardcodes the side-0 block as its array
      // base (`cardgame.s:28916`), so nothing the disc does can mix the
      // opponent's forty cards. Before 2026-10-05 this line also shuffled the
      // opponent, which gave the opponent a deck order the disc never produces.
      shuffleDuelPiles(duel, rng);
      // Two face-down cards, Calumon and Impmon; drawing Calumon means acting
      // first. The walker lets the player pick a side of the coin and settles
      // it with the RNG when the agent expresses no preference.
      //
      // CORRECTED 2026-08-24, reversing a change made earlier the SAME DAY that
      // was wrong. The toss is re-run at the start of EVERY set.
      //
      // Mode 3 is the coin toss, not mode 2. The mode dispatcher F0x800A1B48
      // sends mode 2 to the folder chooser F0x8009F110 and mode 3 to
      // F0x8009F8C0, and F0x8009F8C0 is the ceremony: on its first pass it
      // latches effect opcode 0xA7 and on its second it derives the turn seed
      // duel+0x2F5 from the result. The mode-transition table at 0x800A5D5C,
      // four bytes per entry indexed by the PREVIOUS mode, sends BOTH mode 8
      // (the Battle Phase) and mode 9 (the set change) to next mode 3. So the
      // loop is 1 2 3 4 5 6 7 8 3 4 ... and the ceremony re-runs each set —
      // the dispatcher clears the sub-state on entry, so nothing suppresses it.
      //
      // A previous revision made this once-per-duel on the strength of a
      // divergence-queue note that placed the Calumon draw in mode 2. That note
      // was wrong about the mode, and the conclusion drawn from it inverted the
      // truth: re-rolling every set is what the disc does.
      const want = a.player.chooseStart ? a.player.chooseStart(duel, duel.player) : 0;
      const gotCalumon = rng() < 0.5;
      // Drawing Calumon means you act first. Traced end to end: the ceremony
      // sets duel+0x440 to 1 only when your pick matches the random bit, and
      // that bit indexes the card holding the OTHER face, so a Calumon pick
      // leaves +0x440 at 0; mode 3 then writes seed 0; the play machine's reset
      // copies the seed into the turn registers; and seed 0 is side 0, which is
      // the player.
      duel.coinToss = (want === 0 ? (gotCalumon ? 0 : 1) : (gotCalumon ? 1 : 0)) as 0 | 1;
      duel.firstPlayer = duel.coinToss;
      duel.combos = { player: [], opponent: [] };
      duel.log.push(duel.firstPlayer === 0 ? "You go first." : "Opponent goes first.");
      return;
    }

    // ---- Draw -----------------------------------------------------------
    case 0x14: {
      let okP = true;
      let okO = true;
      for (let i = 0; i < DRAW_COUNT; i++) {
        if (!drawOne(duel, duel.player)) { okP = false; break; }
      }
      for (let i = 0; i < DRAW_COUNT; i++) {
        if (!drawOne(duel, duel.opponent)) { okO = false; break; }
      }
      if (!okP || !okO) {
        // escardgm.toml: "You cannot draw 6 cards, so you lose this set." and
        // its mirror. F0x8009f910 turns the result code +0x440 into 2 (the
        // player loses) or 3 (the player wins) and the mode-4 handler reports
        // the duel finished in both cases, so this ends the whole duel.
        duel.log.push(okP
          ? "Your opponent can't draw 6 cards, so you win this set."
          : "You cannot draw 6 cards, so you lose this set.");
        if (!okP) duel.opponent.score = SETS_TO_WIN;
        else duel.player.score = SETS_TO_WIN;
        finishDuel(duel);
        run.ended = true;
      }
      return;
    }

    // ---- Load and Compile: the play negotiation -------------------------
    case 0x98: {
      // The two-answer box. When something is driving the phase a turn at a
      // time, this is where the phase waits for it.
      const t = duel.programTurns;
      if (t) {
        if (!t.done) { run.parked = true; return; }
        run.resumed = true;
        return;
      }
      beginProgramTurns(duel);
      run.began = true;
      return;
    }
    case 0x99:
      // The hand selector, and the plays it produces. When a screen is driving
      // a side, the turns it opened above are its to take: the beat waits here
      // instead of letting the agent play them out.
      if (duel.human !== null) {
        if (duel.programTurns && !duel.programTurns.done) { run.parked = true; return; }
        return;
      }
      if (run.began) runProgramTurns(duel, a, effects, null, rng);
      return;
    case 0x12:
      // Clear the played row at the end of the turn.
      if (run.began || run.resumed) duel.programTurns = null;
      return;

    // ---- Summon ---------------------------------------------------------
    case 0x9a: {
      const t = duel.summonTurns;
      if (t) {
        if (!t.done) { run.parked = true; return; }
        duel.summonTurns = null;
        run.resumed = true;
        return;
      }
      if (duel.human !== null) {
        // Played, the phase is a sequence of turns rather than an auto-fill:
        // 0x9A's enter (F0x80086D78) marks every hand entry usable or not and
        // opens the browser over the hand, and the phase does not move on until
        // both sides have finished placing. So it opens the turns and waits;
        // 0x9D, the auto-pick, is skipped and 0x9E still sweeps.
        beginSummonTurns(duel);
        run.parked = true;
        return;
      }
      run.summonOrder = summonOpen(duel);
      run.began = true;
      return;
    }
    case 0x9d:
      if (run.began && run.summonOrder) summonAutoPick(duel, a, run.summonOrder);
      return;
    case 0x9e:
      // The board sweep settles the phase for BOTH entry paths — the turn-driven
      // one reaches the end of the phase here too.
      if (run.began || run.resumed) summonSweep(duel);
      return;

    // ---- Battle ---------------------------------------------------------
    // 0x19, 0x1A and 0x1B are SCREEN BEATS. The board was taken on the phase
    // banner; these only put what happened on screen, one beat per thing.
    case 0x19: case 0x1a:
      return;
    case 0x1b:
      // THE CARD REVEAL. Its update ramps both sides' shown AP and HP toward
      // each other over fifteen frames and then exchanges the stored totals --
      // AP between the two SIDES and HP between the two SIDES, never a side's
      // own AP with its own HP. The screen drives the ramp; the exchange is
      // the rule, and it belongs to each beat rather than to the phase.
      exchangeTotals(duel);
      return;
    case 0x15:
      // The combo fold still happens here, ahead of the first drain. WHERE the
      // disc folds a combo bonus into the totals is NOT established — 0x15 is a
      // drain there, so it is somewhere earlier, most likely the battle open or
      // the reveal beat. Running it on the first drain beat is equivalent for
      // the result and is the smallest assumption; it is not a decoded claim.
      if (run.battle) { battleTotals(duel, run.battle); battleDrainSide(duel, run.battle, 0); }
      return;
    case 0x16: {
      const w = run.battle;
      if (!w) return;
      battleDrainSide(duel, w, 1);

// Both drains are done, so the exchange is settled and the disc's battle
      // machine now compares the two sides' field HP. State 0x0A fixes
      // `duel+0x301` and latches 0x18 or 0x17 — the same routine aimed at each
      // side, one card at a time from the last slot back — for the LOSER's
      // board. It only reaches state 0x0A when the loser still has something
      // standing: state 9 tests the per-side byte at `duel+0x72C` for the side
      // that won and the same byte for the other, and goes to 0x0A only when the
      // first is zero and the second is not (`cardgame.s:31015-31031`). The
      // walker is already here, so it makes that test where it has the board.
      battleTransfer(duel, w);
      duel.log.push(
        `${p.banner}: ${w.playerAp}/${w.playerHp} vs ${w.opponentAp}/${w.opponentHp}` +
        ` -> ${w.playerLeft} vs ${w.opponentLeft}`,
      );
      battleAward(duel, w);
      const loser = w.winner === 0 ? duel.opponent : duel.player;
      // Which of the pair is shown cannot be known when the phase is announced,
      // so it is latched here rather than listed in PHASE_CEREMONY.
      if (!loser.field.length) return;
      latchDynamic(duel, w.winner === 0 ? 0x18 : 0x17);
      for (const f of loser.field) loser.trash.push(f.id);
      loser.field = [];
      recomputeTotals(loser);
      return;
    }
    // 0x1C / 0x1D — state 0x12. Latched by the beat lane only when the duel
    // survives the set, so a screen plays it after the result windows are down;
    // `stepPhase` latches the same opcode here at the same point, and
    // `resolveBattle` calls `battleSweepWinner` directly.
    case 0x1c: case 0x1d:
      battleSweepWinner(duel, rng);
      return;
  }
}

export function finishDuel(duel: DuelState): void {
  duel.outcome = duel.player.score > duel.opponent.score ? "win" : "loss";
  duel.log.push(duel.outcome === "win" ? "You won this battle!" : "You lost this battle!");
}
