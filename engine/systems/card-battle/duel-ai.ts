import { type DuelSide, type DuelState, canSummon, handClass, opposing, phase } from "./duel-state.ts";
import {
  type EffectRecord,
  type FieldTarget,
  aiPickBySelectionRank,
  canPlayProgram,
  fieldTargets,
  handTargets,
} from "./effects.ts";
import { comboBonus, comboRuns } from "./combo-damage.ts";
import { handCardSelectable, strengthRank } from "./types.ts";

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface DuelAgent {
  /** 0 picks Calumon and acts first, 1 picks Impmon and lets the other side. */
  chooseStart?(duel: DuelState, s: DuelSide): 0 | 1;
  /** hand slot of a Program card to play, or -1 to pass. `effects` lets the
   *  policy apply F0x800A36E4's targeting gate; omitted by older callers. */
  chooseProgram?(duel: DuelState, s: DuelSide, effects?: Map<number, EffectRecord>): number;
  /** hand slot of a Digimon to summon, or -1 to stop summoning. */
  chooseSummon?(duel: DuelState, s: DuelSide): number;
  /** which of the legal field targets an effect should use. */
  chooseTarget?(duel: DuelState, s: DuelSide, targets: FieldTarget[]): number;
  /** Which hand slot to throw away when an effect parks on that choice.
   *  Return -1 to leave it outstanding for someone else to resolve. */
  chooseHandDiscard?(duel: DuelState, s: DuelSide, slots: number[]): number;
}

export interface DuelAgents {
  player: DuelAgent;
  opponent: DuelAgent;
}

/** The AI play class the summon pass skips outright: class-5 Digimon are held,
 *  never played (F0x8008c5f0). */
export const AI_CLASS_NEVER_SUMMON = 5;

/** Which sides' HAND arrays the disc physically sorts — **the opponent's only.**
 *
 *  The shared system is one routine, `F0x8009D8FC` (`cardgame.s:27418-27475`),
 *  and it takes no side argument: `move_ $t4, $a0` at `:27418` keeps the duel
 *  pointer and the outer loop's `addiu $t6, $t3, 0x2` at `:27473` walks
 *  halfwords at `+0x6C8` from it, so the array it reorders is side 1's hand
 *  (`duel+0x6C8`, the +0x64 field of the block at `duel+0x664`) and there is no
 *  path by which it can reach `duel+0x600`. Both of its call sites are inside
 *  the OPPONENT's own turn: `:29949` after the board-view hand-count push and
 *  before `F0x800A4978`, the AI's legality scan, and `:30688` at the Summon
 *  phase kickoff.
 *
 *  The sort is in place — it swaps two halfwords of the array, not a list of
 *  positions — so every later reader of `duel+0x6C8` sees class order: the draw
 *  that reads the head of the array at `:14502`-`:14504`, the AI's scans, and the
 *  hand row on screen. This is the member list the census test reads.
 *  — CARD-DUEL-VERIFIED.md §34 */
export const SORTED_HAND_ARRAYS = ["opponent"] as const;

/** The one ordering rule: ascending by the AI class byte, then by deck entry.
 *
 *  `F0x8009D8FC` compares the byte at `duel+0x35C + 4 * (index - 0x28)` — the
 *  raw AI class — and only on a tie the halfword at `+0x35E` of the same 4-byte
 *  record (`slt $a0, $a1, $a2` at `:27446`, then `bne $a2, $a1` at `:27449`).
 *  `index - 0x28` is `cardIndex - 40`, i.e. the opponent's own folder entry, and
 *  the +0x35E weight is a per-tier constant plus that entry number, so a tie
 *  reduces to deck order. Strictly less swaps (`:27454` `beqz $t2` skips the
 *  swap when neither test fires). The exchange sort is not stable, but no two
 *  entries share a key, so the order is fully determined.
 *
 *  `handClass` is that same +0x35C byte; the sort is written through it so the
 *  one table has one reader.
 *  — cardnpc-deck-entry-byte-03-is-the-ai-play-class-with-5-never-summoned,
 *    cardgame-ai-play-classes-split-program-cards-from-digimon */
/** The AI class of one authored deck entry. `handClass` is this through the
 *  hand's own slot table, which is what the +0x35C record is indexed by. */
function slotClass(s: DuelSide, slot: number): number {
  return slot < 0 ? 0 : (s.deckClass[slot] ?? 0);
}

/** True when authored deck entry `aSlot` sorts before `bSlot` on the disc's
 *  key: ascending AI class (`duel+0x35C + 4i`), then the `+0x35E` halfword,
 *  which is `weight(class) + i`, so on a class tie the lower entry number wins.
 *  `F0x8009D8FC` is an exchange sort that swaps on a STRICTLY smaller key
 *  (`slt $a0, $a1, $a2` at `cardgame.s:27446`; on a class tie, the `slt` in the
 *  delay slot at `:27449`). It is not stable, but no two entries share a key,
 *  so any correct sort on this key gives its order. */
function handOrderLess(s: DuelSide, aSlot: number, bSlot: number): boolean {
  const ca = slotClass(s, aSlot);
  const cb = slotClass(s, bSlot);
  if (ca !== cb) return ca < cb;
  return aSlot < bSlot;
}

/** `F0x8009D8FC` — sort one side's hand array in place, ascending.
 *
 *  An insertion sort; the disc uses an exchange sort, and the two agree because
 *  every key is unique (see `handOrderLess`). `handSlots` moves
 *  with `hand` because every positional reader resolves a card's AI class and
 *  folder entry through it. */
export function sortHandArray(s: DuelSide): void {
  for (let i = 1; i < s.hand.length; i++) {
    const id = s.hand[i]!;
    const slot = s.handSlots[i] ?? -1;
    let j = i;
    while (j > 0 && handOrderLess(s, slot, s.handSlots[j - 1] ?? -1)) {
      s.hand[j] = s.hand[j - 1]!;
      s.handSlots[j] = s.handSlots[j - 1] ?? -1;
      j--;
    }
    s.hand[j] = id;
    s.handSlots[j] = slot;
  }
}

/** Sort every hand array the decoded member list names. The one place a hand
 *  array gets reordered, so neither phase can grow its own idea of which sides
 *  the disc sorts. */
export function sortDuelHands(duel: DuelState): void {
  for (const which of SORTED_HAND_ARRAYS) {
    sortHandArray(which === "opponent" ? duel.opponent : duel.player);
  }
}

/** Hand slots in the order the AI considers them.
 *
 *  On the disc there is no list: `F0x8009D8FC` reorders the array and the AI
 *  then walks it front to back, so this now sorts in place and hands back the
 *  straight order. Every caller is on the opponent's side, and every key is
 *  unique, so a hand the disc has already sorted comes back unchanged.
 *  — CARD-DUEL-VERIFIED.md §34 */
export function aiHandOrder(s: DuelSide): number[] {
  sortHandArray(s);
  return s.hand.map((_, i) => i);
}

/** `F0x800A3934`, the AI's board scorer, installed at `duel+0x820`.
 *
 *  Its return is `sp88 + sp8C + var_a3 + var_s8`: the plain field sum of slot
 *  `+0x734` and `+0x736` — the **DISPLAYED** pair, not the true one — plus the
 *  combo runs counted a second time, with a further `0x14` on each once a run
 *  reaches four. That is exactly `comboBonus`.
 *
 *  Read 2026-08-25 from `exe-decomp/cardgame_c/F0x800a3934.c`. */
export function evaluateBoard(duel: DuelState, s: DuelSide): number {
  const bonus = comboBonus(comboRuns(duel, s));
  const plain = s.field.reduce((t, f) => t + f.shownAp + f.shownHp, 0);
  return plain + bonus.ap + bonus.hp;
}

/** The AI play classes `F0x800A4978` searches for, by phase and play count. */
export const AI_CLASS_LOAD = 1;

export const AI_CLASS_COMPILE = 3;

export const AI_CLASS_RESPONSE = 4;

/** The record `+0x03` kinds that invite a second class-3 answer. */
export const AI_ANSWERABLE_KINDS = [3, 9] as const;

/** The lowest `strengthRank` the AI will call a hand card worth playing:
 *  `F0x800A4328` starts its incumbent at 0x1F4 (500) and only accepts a card
 *  whose record `+0x08` is strictly below it. */
export const AI_WORTH_HAND_RANK = 500;

/** `F0x800A44F0` — the AI's own "is this card worth playing?" simulation.
 *
 *  Read 2026-09-14 from `exe-decomp/cardgame_c/_asm/F0x800a44f0.s` (authority
 *  2), correcting the card numbering used in the 2026-08-06 model doc: the
 *  switch is on `duel+0x50[instance]`, the **0-based** instance value the
 *  record reader adds 1 to, so a switch arm `n` is about the catalog card
 *  `n + 1`.
 *
 *  The function returns 1 by default, so most cards are always worth playing.
 *  Only these arms can decline:
 *
 *  | 0-based arm | catalog card | requires |
 *  |---|---|---|
 *  | 0x07,0x09,0x1A,0x37,0x39 | Control Parts, Eclipse Undo, Chaos Virus, Summon Cancel, Disturb Gear | a legal **foe** field target survives the pick/commit |
 *  | 0x15,0x2E | Fire Cannon, Break Launcher | a legal foe field target with **displayed HP <= 30** |
 *  | 0x38 | Berserk Energy | a legal foe field target with **displayed HP <= 10** |
 *  | 0x27 | Scramble Up | a legal **hand** target with `strengthRank < 500` |
 *  | 0x28 | Power Super Metal | a legal **own** field target survives the commit |
 *  | 0x03,0x0F,0x3A,0x3B | Protect Aura, Beast Energy, Protect Armor, Assault Armor | the AI's **own field is non-empty** (`duel+0x79E != 0`) |
 *  | anything else | — | nothing; always worth it |
 *
 *  `F0x800A3D90`/`F0x800A3E9C` are the pick/commit pair over the mark array the
 *  target gate set, so "survives the pick/commit" is exactly "has a legal
 *  target under the card's own targeting mask" here. */
export function aiWorthPlaying(
  duel: DuelState, s: DuelSide, id: number, eff: EffectRecord | undefined,
): boolean {
  const arm = id - 1;                       // duel+0x50 stores a 0-based value
  const foe = opposing(duel, s);
  const fieldOn = (side: DuelSide): FieldTarget[] =>
    eff
      ? fieldTargets(duel, s, eff.targeting).filter((t) => t.side === side)
      : side.field.map((_, slot) => ({ side, slot }));
  switch (arm) {
    // Own-field buffs: legal only while the AI has a Digimon out.
    case 0x03: case 0x0F: case 0x3A: case 0x3B:
      return s.field.length > 0;
    // Field control: a foe target must survive the best-target pick and commit.
    case 0x07: case 0x09: case 0x1A: case 0x37: case 0x39:
      return fieldOn(foe).length > 0;
    // Finish-off cards: 30 first, then the 10 the HP-10 card can take.
    case 0x15: case 0x2E:
      return fieldOn(foe).some((t) => (foe.field[t.slot]?.shownHp ?? Infinity) <= 30);
    case 0x38:
      return fieldOn(foe).some((t) => (foe.field[t.slot]?.shownHp ?? Infinity) <= 10);
    // A hand target the AI is willing to spend (rank below the 500 incumbent).
    case 0x27: {
      const owner = eff?.targeting.sides?.includes("own") ? s : foe;
      return handTargets(duel, owner).some((slot) => {
        const rec = duel.byId.get(owner.hand[slot] ?? -1);
        if (!rec) return false;
        if (eff?.targeting.kinds && !eff.targeting.kinds.includes(rec.kind)) return false;
        return strengthRank(rec) < AI_WORTH_HAND_RANK;
      });
    }
    // An own-field card that must land on something.
    case 0x28:
      return fieldOn(s).length > 0;
    default:
      return true;
  }
}

/** The opponent's policy, as far as it is decoded.
 *
 *  The hand is walked in AI-class order, and both of the overlay's choosers
 *  (F0x800a4328, misleadingly named aiPickCheapestHandCard in older research,
 *  and F0x8008c988) MINIMISE the CARDPAK +0x08 strength rank — which is
 *  ordered from the strongest card down, so the opponent reaches for its best
 *  card and never economises. That is why it needs a separate affordability
 *  gate at all: the chooser itself does not look at cost, so canSummon is a
 *  filter applied around the choice rather than a term inside it.
 *  — cardgame-cardpak-0x08-is-a-card-strength-rank-and-the-ai-plays-its-best
 *
 *  The per-class weights 400/300/500/200/600/100/700 at 0x800837a0 are
 *  functionally dead — same-class cards share a weight, so the tie-break always
 *  reduces to deck index — and are deliberately not implemented. */
export const discAgent: DuelAgent = {
  chooseStart: () => 0,
  /**
   * `F0x800A4978`, the AI's card-play scan. DECODED 2026-08-25; the walker used
   * to take the first merely-selectable slot.
   *
   * It switches on the turn's play count `+0x575` and the phase `+0x2F8`:
   *
   *   - **Load, first play** — look for a deck entry of AI class 1.
   *   - **Compile, first play** — class 3, but only after comparing board
   *     scores. `if (temp_s1 < temp_v0) return 0`, with `temp_s1` =
   *     `evaluateBoard(side 0)` and `temp_v0` = `evaluateBoard(side 1)`. Side 1
   *     is the AI, so **it declines to play when it is already ahead**.
   *   - **Answering, and the response list holds the card just played** —
   *     class 4. The list is CARD_NPC `+0xA0`.
   *   - **Answering a card whose record `+0x03` is 3 or 9** — class 3 again.
   *
   * Every candidate then passes the same three gates the scan uses:
   * `F0x80085F38` (usable in this phase), `F0x800A36E4` (has a legal target)
   * and `F0x800A44F0`, the AI's own worth-it simulation.
   *
   * `F0x800A44F0` IS MODELLED since 2026-09-14 (`aiWorthPlaying`), read from
   * its own assembly. It is a per-card verdict, not a damage comparison: most
   * cards pass with no test at all, and only fourteen can be declined (a
   * finish-off card that cannot kill, a self-buff with no own Digimon out, a
   * hand or own-field card with nothing to land on). The earlier note here
   * claimed its inputs were `F0x800A4440`/`F0x800A4494`; the assembly shows
   * those two are called only by the response-path simulator `F0x800A45F8`,
   * not by `F0x800A44F0`.
   */
  chooseProgram(duel, s, effects) {
    const mode = phase(duel).mode;
    const plays = duel.programTurns?.plays ?? 0;
    const legal = (i: number) => {
      const id = s.hand[i];
      if (id === undefined) return false;
      if (!handCardSelectable(duel, duel.byId.get(id))) return false;
      const eff = effects?.get(id);
      // the targeting gate, when the caller supplied the effect table
      if (eff && !canPlayProgram(duel, s, eff)) return false;
      // F0x800A44F0, the AI's own worth-it simulation
      return aiWorthPlaying(duel, s, id, eff);
    };
    const firstOfClass = (want: number) => {
      for (const i of aiHandOrder(s)) if (handClass(s, i) === want && legal(i)) return i;
      return -1;
    };

    if (plays === 0) {
      if (mode === 5) return firstOfClass(AI_CLASS_LOAD);
      // Compile: hold when already ahead on board score.
      if (evaluateBoard(duel, duel.player) < evaluateBoard(duel, duel.opponent)) return -1;
      return firstOfClass(AI_CLASS_COMPILE);
    }

    // Answering. What did the other side just play?
    const last = duel.playedThisPhase[duel.playedThisPhase.length - 1];
    if (last !== undefined && s.aiResponses.includes(last)) {
      const i = firstOfClass(AI_CLASS_RESPONSE);
      if (i >= 0) return i;
    }
    const kind = last === undefined ? undefined : duel.byId.get(last)?.programCategory;
    if (kind !== undefined && (AI_ANSWERABLE_KINDS as readonly number[]).includes(kind)) {
      return firstOfClass(AI_CLASS_COMPILE);
    }
    return -1;
  },
  chooseSummon(duel, s) {
    // Effect opcode 0x9D — the opponent's summon choice, and it does NOT
    // choose. F0x8008C5F0 is a single greedy pass: it walks the hand in
    // priority-sorted order and takes every entry that is still affordable
    // once the earlier ones have been paid for, until the field holds six.
    // Class 5 is held back and never summoned.
    //   — cardgame-ai-summons-greedily-until-field-full (partially_verified)
    //   — cardnpc-deck-entry-byte-03-is-the-ai-play-class-with-5-never-summoned
    //
    // CORRECTED 2026-08-24. This used to score the eligible set by
    // `strengthRank` and take the minimum — reaching for the best card first.
    // That is opcode 0xAA's rule (F0x8008C6E0, the HAND pick), not 0x9D's, and
    // it had been imported into the wrong job. The claim is explicit that the
    // summon pass has "no evaluation, no comparison against the player's board,
    // and no randomness".
    //
    // It matters whenever S-Energy is short. Both rules summon the same set
    // when everything is affordable; with a tight pool the disc pays for
    // whatever comes first in class-then-deck order, while ranking pays for the
    // strongest and can then afford a different, smaller set.
    //
    // The caller summons in a loop until this returns -1, and `summonFromHand`
    // spends the energy, so returning the FIRST eligible slot each time
    // reproduces the disc's single pass — affordability is re-tested against
    // what is left, exactly as the handler re-tests it per entry.
    for (const i of aiHandOrder(s)) {
      const id = s.hand[i]!;
      const rec = duel.byId.get(id);
      if (rec?.kind !== "digimon") continue;
      if (handClass(s, i) === AI_CLASS_NEVER_SUMMON) continue;
      if (!canSummon(duel, s, id)) continue;
      return i;
    }
    return -1;
  },
  chooseTarget: () => 0,
  /** DECODED 2026-08-08 — this is the disc's own rule, not a walker policy.
   *  The AI branch of opcode 0xAA calls F0x8008C6E0 in mode 0, which keeps the
   *  MAXIMUM strengthRank over the flagged slots. Low rank means strong, so the
   *  AI throws away its WEAKEST card. A tie goes to the later slot. See
   *  aiPickBySelectionRank for the assembly this mirrors.
   *
   *  The earlier note here guessed "the last card in its own play order" and
   *  warned the strongest-card routine must not be copied. Both halves are now
   *  superseded: the real routine IS rank-based, and the direction is simply
   *  the opposite one for a discard. */
  chooseHandDiscard(duel, s, slots) {
    return aiPickBySelectionRank(duel, s, slots, 0);
  },
};

/** Alias for callers that still name the old highest-AP stand-in. That policy
 *  is gone: it now resolves to discAgent. */
export const simpleAgent: DuelAgent = discAgent;

/** Kept for callers that only want a summon policy. */
export function greedyChoice(duel: DuelState, s: DuelSide): number {
  return discAgent.chooseSummon!(duel, s);
}

export function normaliseAgents(
  a: DuelAgents | DuelAgent | ((duel: DuelState, s: DuelSide) => number) | undefined,
): DuelAgents {
  if (!a) return { player: discAgent, opponent: discAgent };
  if (typeof a === "function") {
    const wrapped: DuelAgent = { ...discAgent, chooseSummon: a };
    return { player: wrapped, opponent: wrapped };
  }
  if ("player" in a && "opponent" in a) return a as DuelAgents;
  return { player: a as DuelAgent, opponent: a as DuelAgent };
}

// ---------------------------------------------------------------------------
// The round driver
// ---------------------------------------------------------------------------

/** Order of play within a phase: the side that drew Calumon acts first. */
export function turnOrder(duel: DuelState): DuelSide[] {
  return duel.firstPlayer === 0
    ? [duel.player, duel.opponent]
    : [duel.opponent, duel.player];
}

export function agentFor(duel: DuelState, agents: DuelAgents, s: DuelSide): DuelAgent {
  return s === duel.player ? agents.player : agents.opponent;
}
