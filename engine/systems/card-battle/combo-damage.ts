import {
  type ComboRun,
  type DuelSide,
  type DuelState,
  type FieldSlot,
  cardIsInDuel,
  clampStat,
  reapDead,
  recomputeTotals,
} from "./duel-state.ts";
import {
  COMBO_FOUR_BONUS,
  COMBO_MIN,
  COMBO_SUBSTITUTE_CARD_ID,
  SETS_TO_WIN,
  STAT_CAP,
  comboInto,
} from "./types.ts";
import { endSet } from "./set-end.ts";
import { finishDuel } from "./ceremony-ops.ts";

/** The runs F0x800a0cd4 finds: sort the field by card id, then take every run
 *  of three or more identical ids whose CARDPAK +0x0a combo target is non-zero. */
export function comboRuns(duel: DuelState, s: DuelSide): ComboRun[] {
  const sorted = s.field.slice().sort((a, b) => a.id - b.id);
  const runs: ComboRun[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.id === sorted[i]!.id) j++;
    const count = j - i;
    const into = comboInto(duel.byId.get(sorted[i]!.id));
    if (count >= COMBO_MIN && into !== 0) {
      let ap = 0;
      let hp = 0;
      for (let k = i; k < j; k++) {
        // F0x8009403C sums `slot->unk734` / `unk736` — the DISPLAYED pair, as
        // the side totals and evaluateBoard do. A run scored mid-ramp is worth
        // what the screen shows, not what the stat is settling towards.
        ap += sorted[k]!.shownAp;
        hp += sorted[k]!.shownHp;
      }
      const present = cardIsInDuel(duel, into);
      runs.push({
        id: sorted[i]!.id,
        count,
        into,
        displayId: present ? into : COMBO_SUBSTITUTE_CARD_ID,
        substituted: !present,
        ap,
        hp,
      });
    }
    i = j;
  }
  return runs;
}

// ---- the combo-target picker (F0x8008AD98 / F0x8008C8D8) --------------------

/** Which of a side's field slots belong to a qualifying combo run.
 *
 *  This is the walker's `+0x446`: the detector F0x800A0CD4 clears the flag
 *  across the side's live slot count and then sets it on each slot index it
 *  collected for the run, so the array is per side and indexed by field slot.
 *  — cardgame-combo-target-is-resolved-to-a-real-card-and-displayed */
export function comboSlotFlags(duel: DuelState, s: DuelSide): boolean[] {
  const flags = s.field.map(() => false);
  for (const run of comboRuns(duel, s)) {
    s.field.forEach((slot, i) => { if (slot.id === run.id) flags[i] = true; });
  }
  return flags;
}

/** The picker dims every slot that is not part of a run.
 *
 *  F0x8008AD98 case 1 walks twelve view sprites and writes the dim byte as the
 *  inverse of the slot's `+0x446`: flagged slots are lit, everything else is
 *  dimmed. It does this through one of two fields — `+0x49E` when a combo
 *  target id is already resolved into `+0x438`, `+0x151` on the view record
 *  otherwise — but the rule written is identical in both branches, so the
 *  walker keeps one. */
export function comboPickerDimmed(duel: DuelState, s: DuelSide): boolean[] {
  return comboSlotFlags(duel, s).map((lit) => !lit);
}

/** Where the picker's cursor opens, per F0x8008C8D8.
 *
 *  Two passes. First scan FORWARD from `start` up to `available` (the per-set
 *  availability count at duel+0x41B) and stop on the first flagged entry. Only
 *  if that finds nothing scan BACKWARD from 0x27, and — reading the branch at
 *  .L0x00009ca8, which is `bnez` — skip entries that are NOT flagged, stopping
 *  on the first flagged one, or on `start` if the scan runs out. Either way the
 *  landing entry gets the legal-target flag +0x46F.
 *
 *  NOTE the recorded claim describes the backward pass as looking for an entry
 *  WITHOUT the flag. The assembly is the other way round; see
 *  cardgame-8008c8d8-backward-pass-seeks-a-flagged-entry.
 *
 *  The forward pass reads the flag at `+0x446 + (i - start)` while writing the
 *  cursor as the absolute `i` — the index is relative to where the scan began,
 *  not to the array. That is reproduced here rather than silently corrected; it
 *  is invisible whenever the scan starts at 0, which is the normal case. */
export const COMBO_CURSOR_LAST = 0x27;

export function defaultComboCursor(
  flags: readonly boolean[], start = 0, available = flags.length,
): number {
  for (let i = start; i < available; i++) {
    if (flags[i - start]) return i;
  }
  let j = COMBO_CURSOR_LAST;
  if (start < COMBO_CURSOR_LAST) {
    while (j > start && !flags[j - start]) j--;
  }
  return j;
}

/** What a side's combos are worth.
 *
 *  A combo does NOT replace the run with the CARDPAK +0x0a Digimon: all three
 *  writers of the per-slot stat fields were enumerated and none consults the
 *  combo-run flag +0x446, so no code path rewrites a slot from the target
 *  card. The +0x0a card is a display identity (see ComboRun.displayId).
 *
 *  What the combo does is score the run twice. Opcodes 0x19/0x1a
 *  (F0x8009403c) sum the true AP and HP of every flagged slot into
 *  duel+0x42c/+0x430, each capped at 99, and add a further 0x14 to both once
 *  four or more slots are flagged — capped again.
 *
 *  IT IS PER RUN, NOT PER SIDE — corrected 2026-08-25, and it changes numbers.
 *  This function used to pool every run of a side, cap the pool once and test
 *  the pooled count against four, on the strength of a note calling the flag
 *  array "per side". The flag array IS per side, but the SCAN clears it on
 *  every call: F0x800A0CD4 walks the sorted field from the index it was given,
 *  stops at the first qualifying run, clears +0x446 across the side's whole
 *  slot count, sets it on that run's slots alone and returns the next scan
 *  index. The Battle Phase re-enters it until it returns -1, and the
 *  announcement opcode is issued once per run, so each run is summed, capped
 *  and tested on its own. Two runs of three used to be worth the four-card
 *  bonus between them, which no run had earned; and a side whose runs summed
 *  past 99 used to lose the excess that the disc keeps, because each run
 *  saturates separately before being added to the side's total.
 *  — cardgame-combo-adds-the-run-again-and-does-not-digivolve-2026-08-24
 *    ("adds a further 0x14 to each when the run holds four or more"),
 *    cardduel-combo-is-three-of-a-kind-gated-on-card-record-0x0a,
 *    cardgame-combo-does-not-replace-the-run-with-the-target-digimon */
export function comboRunScore(run: ComboRun): { ap: number; hp: number } {
  // The disc saturates after every slot it adds; with no negative stats that is
  // the same ceiling as capping the run's sum once.
  let ap = Math.min(run.ap, STAT_CAP);
  let hp = Math.min(run.hp, STAT_CAP);
  if (run.count >= COMBO_MIN + 1) {
    ap = Math.min(ap + COMBO_FOUR_BONUS, STAT_CAP);
    hp = Math.min(hp + COMBO_FOUR_BONUS, STAT_CAP);
  }
  return { ap, hp };
}

export function comboBonus(runs: ComboRun[]): { ap: number; hp: number } {
  let ap = 0;
  let hp = 0;
  for (const r of runs) {
    const score = comboRunScore(r);
    ap += score.ap;
    hp += score.hp;
  }
  return { ap, hp };
}

// ---------------------------------------------------------------------------
// Battle resolution
// ---------------------------------------------------------------------------

export interface BattleResult {
  playerAp: number;
  playerHp: number;
  opponentAp: number;
  opponentHp: number;
  playerLeft: number;
  opponentLeft: number;
  /** 0 = the player took the set, 1 = the opponent did. A tie is 1. */
  winner: 0 | 1;
  combos: { player: ComboRun[]; opponent: ComboRun[] };
}

/** Queue `damage` against a side's field as per-slot TARGETS. Nothing moves
 *  here; tickStats does the moving, one point per frame.
 *
 *  Battle damage lands on the SIDE TOTAL, never on a slot. Runtime capture
 *  2026-08-08 (`cardgame_s5_run2_modes6plus.txt`, GUI slot 5 duel, Battle Phase
 *  frames 3189-3902): across the whole phase not one field slot's AP or HP word
 *  changed, while the two block totals each took a single write —
 *  frame 3249 opponent total HP 10 -> 0 against a player field AP of 29
 *  (floored), frame 3389 player total HP 19 -> 15 against an opponent field AP
 *  of 4. Positive control in the same log: the slot words DO move at frames
 *  2049/2052 (summons) and 2680 (a Program card setting a slot's true AP to 10
 *  with the displayed value rolling behind it), so the null result is real and
 *  not an artifact of the logged range.
 *
 *  This agrees with the static side: `F0x8008DEF8`, the only routine that adds
 *  to a slot's `+0x2`/`+0x4`, is reached from three call sites and all three are
 *  inside the Program-card effect interpreter `F0x80084320`. No Battle-Phase
 *  code path writes a slot stat. The earlier "spread the total across the slots
 *  in order" WALKER RULE is therefore not merely unproven — it is wrong, and it
 *  is removed.
 *
 *  LIMIT: one sampled duel, one board, and the sampled path was a win. The
 *  arithmetic matched exactly on both sides, but a lopsided board and a losing
 *  path have not been captured. */
export function applyBattleDamage(s: DuelSide, incomingAp: number): void {
  s.totalHp = Math.max(0, s.totalHp - incomingAp);
}

/** Write a slot's TRUE stats. This is F0x8008DEF8: it loads `+0x2`/`+0x4`,
 *  adds the effect's packed delta, and stores straight back. There is no ramp
 *  and no queue — the true pair moves at once, and only the DISPLAYED pair
 *  (`shownAp`/`shownHp`) animates afterwards.
 *
 *  The name is historical; it used to write a separate target tier that the
 *  disc does not have. */
export function queueSlotStats(f: FieldSlot, ap: number, hp: number): void {
  // NOT clamped. F0x8008DEF8 is `lhu` / `addu` / `sh` with no `slti` anywhere:
  // the true pair is plain halfword arithmetic and may sit outside [0, 99].
  // Only the DISPLAY ramp clamps (`slti ..., 0x63` up, `blez` down), so a slot
  // pushed to 150 shows 99 but still has 150 to spend on the next subtraction.
  f.ap = ap;
  f.hp = hp;
}

const stepToward = (v: number, target: number) =>
  v < target ? v + 1 : v > target ? v - 1 : v;

/** One frame of F0x8008E08C.
 *
 *  The TRUE stats do not move here — F0x8008DEF8 already wrote them. This
 *  function only walks the DISPLAYED pair one point per frame toward the true
 *  pair, capping the rise with `slti ..., 0x63` and flooring the fall with
 *  `blez`, exactly as the two ramp blocks do.
 *
 *  THE REMOVAL PASS RUNS ONLY WHEN BOTH RAMPS ARE DONE. In the original that is
 *  the `$t1` guard: `$t1` is set to 1 only on the branches that SKIP a ramp, and
 *  is zeroed by either ramp actually running, so the tail's
 *  `beqz $t1, <return>` lets the removal pass execute on the first frame where
 *  neither the AP nor the HP ramp had anything left to do. A slot whose display
 *  is still falling is therefore not reaped mid-fall.
 *
 *  Returns true while anything is still moving — the original's own return
 *  value is `$t1`, i.e. the inverse: 1 once settled. */
export function tickStats(s: DuelSide): boolean {
  let moving = false;
  for (const f of s.field) {
    const ap = clampStat(f.ap);
    const hp = clampStat(f.hp);
    if (f.shownAp !== ap) { f.shownAp = stepToward(f.shownAp, ap); moving = true; }
    if (f.shownHp !== hp) { f.shownHp = stepToward(f.shownHp, hp); moving = true; }
  }
  // The tail: only once neither ramp moved this frame.
  if (!moving) reapDead(s);
  return moving;
}

/** Whether the displayed pair has caught up with the true pair everywhere. */
export function statsSettled(s: DuelSide): boolean {
  return s.field.every((f) => f.shownAp === clampStat(f.ap) && f.shownHp === clampStat(f.hp));
}

/** Run the ticker until both ramps are done. Callers that do not animate — the
 *  model-only phase driver, the tests — use this; the duel screen instead ticks
 *  one frame at a time so the ramp IS the animation. The bound is the stat cap
 *  plus one, since no single ramp can be longer than that. */
export function settleStats(s: DuelSide): void {
  for (let i = 0; i <= STAT_CAP * 2 + 2 && tickStats(s); i++) { /* one point per frame */ }
}

/** Battle-Phase state 8, the reveal beat — model §D.5 and effect opcode 0x2A.
 *
 *  0x2A (F0x8008F948) only counts: it raises the reveal counter `duel+0x305`
 *  and puts the played card's face index in `duel+0x304`. State 8 then latches
 *  opcode 0x1B once per count, and 0x1B's update phase (F0x80093CAC) exchanges
 *  the STORED totals at the head of each per-player block — `+0x59C <-> +0x664`
 *  (AP) and `+0x59E <-> +0x666` (HP), §E.3.
 *
 *  Read that assignment block closely, because the printed card text invites the
 *  wrong reading: it swaps AP between the two SIDES and HP between the two
 *  SIDES. It does NOT swap a side's own AP with its own HP. Fortune Gate is
 *  printed "The Fortune Gate exchanges the AP and HP" and the English is
 *  ambiguous; the code is not.
 *
 *  State order puts this before the comparison that uses it — 2 -> 8 -> 9 ->
 *  0xA, and state 0xA decides the set on `+0x666 < +0x59E`, the stored totals.
 *  Two reveals in one Battle Phase therefore swap back to where they started.
 *
 *  BOUNDARY RESOLVED 2026-08-25 — it DOES overwrite the cache. F0x80094848's
 *  step 2, at the end of its fifteen-frame tween:
 *
 *      arg0->unk59C = arg0->unk428;   // player AP  <- summed from +0x734
 *      arg0->unk59E = arg0->unk42C;   // player HP  <- summed from +0x736
 *      arg0->unk664 = arg0->unk430;   // opponent AP
 *      arg0->unk666 = arg0->unk434;   // opponent HP
 *
 *  So THE EXCHANGE IS TRANSIENT: the next recount restores both sides' totals
 *  to their fields' own displayed sums and the swap is gone. What makes Fortune
 *  Gate work at all is ORDER — no recount sits between state 8 and state 0xA,
 *  so the set is decided on the swapped values, and only afterwards does a
 *  recount put them back.
 *
 *  resolveBattle reproduces that order exactly: recomputeTotals both sides,
 *  THEN this, THEN read the totals for the winner. A recomputeTotals inserted
 *  between the exchange and the decision would silently disable the card, which
 *  is why tests/card-battle.test.js pins the ordering. */
export function exchangeTotals(duel: DuelState): void {
  const ap = duel.player.totalAp;
  const hp = duel.player.totalHp;
  duel.player.totalAp = duel.opponent.totalAp;
  duel.player.totalHp = duel.opponent.totalHp;
  duel.opponent.totalAp = ap;
  duel.opponent.totalHp = hp;
}

/** The Battle Phase. Both sides' totals are taken at once, both attacks land at
 *  once, and the side with more HP left takes the set — with a tie going to
 *  side 1, per F0x800a0f94 cases 9 and 10. */
/** The Battle Phase's working state, carried from one ceremony opcode to the
 *  next exactly as the disc carries it in the duel object's accumulators. */
export interface BattleWalk {
  combos: BattleResult["combos"];
  playerAp: number; playerHp: number;
  opponentAp: number; opponentHp: number;
  playerLeft: number; opponentLeft: number;
  winner: 0 | 1;
  /** State 0xA and state 0xB have already been settled for this walk. The walk
   *  is the Battle Phase's own, so the flag is per set: it is what stops a
   *  driver from settling the same set twice while it waits for state 0x12's
   *  sweep beat. */
  settled: boolean;
}

/** The Battle Phase's beat stream, built when the phase opens — straight out of
 *  the decoded state table in `card-ceremony.ts`, state by state.
 *
 *    state 1  scans YOUR board and latches `0x19` for each combo run it finds,
 *             coming back for the next until the scan returns -1
 *             (`cardgame.s:30946-30956`);
 *    state 2  does the same for the opponent with `0x1A`, which is the same
 *             routine aimed at side 1 (`cardgame.s:30957-30964`);
 *    state 8  latches `0x1B` once per queued card reveal, counting the queue
 *             down and leaving only at zero (`cardgame.s:30969-30988`);
 *    states 6 and 7 latch `0x15` and `0x16` (`cardgame.s:31097` and `:31104`)
 *             — and ONLY when BOTH fields hold a card, because state 9 reaches
 *             them through a banner it opens only in that case
 *             (`cardgame.s:30989-30995`: state 9 tests `duel+0x72C` and then
 *             `duel+0x79E`, and takes the banner arm only when both are
 *             non-zero; otherwise it decides the set itself at `:30997`).
 *
 *  A scan that finds nothing issues nothing, so no rule may hang on these; the
 *  board is taken on the phase banner instead.
 *
 *  NOTHING IS LATCHED FOR STATE 0x12 — the set-change sweep, the boards
 *  emptying and both hands walking back into their decks. That state only runs
 *  when the duel SURVIVES the set (state 0x11's duel-over test,
 *  `cardgame.s:31418-31443`), which cannot be known when the phase opens, and it
 *  runs after both result windows. `battleSweepWinner` is what performs it and a
 *  screen latches 0x1C/0x1D for it through the same pending lane once the
 *  windows are down, so the walker used to empty the board and deal the next hand
 *  BEFORE the player had even read "You win!".  `cardgame.s:31422-31443` is
 *  state 0x11's duel-over test: it reads the two set counters, and when NEITHER
 *  has reached two it falls into state 0x12 — through the delay slot
 *  `li $v0, 0x12` at `cardgame.s:31426`, which runs whether or not the branch
 *  above it is taken, so the number stored at `cardgame.s:31443` is 0x12 and not
 *  the `sltiu` result above it. */
export function battleCeremony(duel: DuelState): number[] {
  const out: number[] = [];
  for (let i = comboRuns(duel, duel.player).length; i > 0; i--) out.push(0x19);
  for (let i = comboRuns(duel, duel.opponent).length; i > 0; i--) out.push(0x1a);
  for (let i = duel.revealBeats ?? 0; i > 0; i--) out.push(0x1b);
  // States 6 and 7 are behind the Battle banner, and the banner is behind
  // "both fields hold a card". An empty side never drains.
  if (duel.player.field.length && duel.opponent.field.length) out.push(0x15, 0x16);
  return out;
}

/** `0x19` — open the phase and take the board: score the combo runs, refresh
 *  both sides' totals and settle any queued exchange. */
export function battleOpen(duel: DuelState): BattleWalk {
  const combos = {
    player: comboRuns(duel, duel.player),
    opponent: comboRuns(duel, duel.opponent),
  };
  recomputeTotals(duel.player);
  recomputeTotals(duel.opponent);
  // The exchange is NOT done here. Each 0x1B beat performs its own, which is
  // what the disc does -- two reveals in one Battle Phase swap back to where
  // they started because the machine ran the swap twice, not because anything
  // counted the parity. Moved off this function 2026-08-28, when the reveal
  // became a beat with a screen instead of a number the rules folded in.
  return {
    combos,
    playerAp: 0, playerHp: 0, opponentAp: 0, opponentHp: 0,
    playerLeft: 0, opponentLeft: 0, winner: 1, settled: false,
  };
}

/** `0x15` — apply the damage to the block totals: fold each side's combo bonus
 *  into the total that takes the hit, so the stored total and the reported
 *  remainder cannot disagree. */
export function battleTotals(duel: DuelState, w: BattleWalk): void {
  const pBonus = comboBonus(w.combos.player);
  const oBonus = comboBonus(w.combos.opponent);
  w.playerAp = duel.player.totalAp + pBonus.ap;
  w.playerHp = duel.player.totalHp + pBonus.hp;
  w.opponentAp = duel.opponent.totalAp + oBonus.ap;
  w.opponentHp = duel.opponent.totalHp + oBonus.hp;
  duel.player.totalHp = w.playerHp;
  duel.opponent.totalHp = w.opponentHp;
}

/** `0x16` — drain the attack across the row. Both attacks land on the block
 *  totals, one write per side, and the field slots are left exactly as they
 *  stand: see `applyBattleDamage` for the capture and the static call-graph
 *  closure behind that. */
/** ONE side's attack landing — the disc's 0x15 (side 0) and 0x16 (side 1).
 *
 *  DECODED 2026-08-27. F0x80084320 dispatches BOTH opcodes to the same enter,
 *  `F0x80093624(duel, view, 0)` for 0x15 and `(..., 1)` for 0x16, and that enter
 *  reads side `arg2`'s AP total (+0x59C) against the OTHER side's HP (+0x59E).
 *  So they are two drains, one per side, not two different steps — which is how
 *  this used to be modelled, with 0x15 folding the combo bonuses and 0x16
 *  landing both attacks at once. Both sides' damage arriving on one beat is why
 *  the totals used to jump in a single frame partway through the phase.
 *
 *  Side 0 is the player: `UI.players[0]` is the "you" strip.
 *
 *  Order does not matter between the two. Each reads its damage off the WALK,
 *  which holds the pre-drain totals, so draining side 0 first cannot change what
 *  side 1 deals — and `battleTransfer` derives its remainders from the same walk
 *  for the same reason. */
export function battleDrainSide(duel: DuelState, w: BattleWalk, side: 0 | 1): void {
  const attacker = side === 0 ? duel.player : duel.opponent;
  const defender = side === 0 ? duel.opponent : duel.player;
  const ap = side === 0 ? w.playerAp : w.opponentAp;
  const hpBefore = defender.totalHp;
  // Published BEFORE the subtraction: afterwards the clamp has eaten it.
  duel.drain = {
    side, ap, hpBefore,
    // `field` holds only live slots -- reapDead removes a slot the frame its
    // DISPLAYED hp reaches zero -- so its length is the attacking card count
    // the disc reads out of +0x72C.
    cards: attacker.field.length,
  };
  applyBattleDamage(defender, ap);
}

export function battleDrain(duel: DuelState, w: BattleWalk): void {
  applyBattleDamage(duel.player, w.opponentAp);
  applyBattleDamage(duel.opponent, w.playerAp);
}

/** `0x17` — transfer the damage: what each side has left. Derived from the
 *  pre-drain totals held in the walk, so it does not matter that `0x16` has
 *  already run. */
export function battleTransfer(_duel: DuelState, w: BattleWalk): void {
  w.playerLeft = Math.max(0, w.playerHp - w.opponentAp);
  w.opponentLeft = Math.max(0, w.opponentHp - w.playerAp);
}

/** Battle-Phase state 0xA — WHO TOOK THE SET.
 *
 *  Strict comparison on what each side has left, and a tie goes to the
 *  opponent. `cardgame.s:31110-31126`, read in full:
 *
 *    31110  lh $v1, 0x59e($s1)     side 0's total — the player's
 *    31111  lh $v0, 0x666($s1)     side 1's total — the opponent's
 *    31113  slt $v0, $v1          the short form: $v0 < $v1
 *    31114  beqz $v0, .L0x0001e620
 *    31115  li $v0, 0x18          THE DELAY SLOT, so it runs either way
 *    31116  sb $v0, 0x421($s1)    only when $v0 != 0: latch 0x18
 *    31118  sb $zr, 0x301($s1)    award = 0
 *    31119  li $v0, 0x17          the branch-taken arm
 *    31120  sb $v0, 0x421($s1)    latch 0x17
 *    31122  sb $v0, 0x301($s1)    award = 1
 *
 *  So the branch is taken when the two totals are NOT strictly ordered, and the
 *  delay slot's `0x18` is thrown away there: an equal total awards the set to
 *  side 1, the opponent. `duel+0x301` is what every later state reads — the
 *  counter roll (0xB), which side's board empties (0x12), and the duel-over
 *  test's branch at `cardgame.s:31494`.
 *
 *  0x17 and 0x18 are the same routine aimed at each side (the effect table's
 *  update arms at `cardgame.s:221` and `:222` both call F0x80093B10), so the
 *  opcode names the side whose Digimon leave the field: 0x18 when you took the
 *  set, 0x17 when the opponent did. State 0xA latches it once and moves to 0xB
 *  (`cardgame.s:31125-31126`), with `duel+0x2FC` — the roll accumulator —
 *  cleared in the delay slot at `:31128`.
 *
 *  SIDE 0 IS THE PLAYER. The per-side set counters sit at `duel+0x5AE` and
 *  `duel+0x676` (`cardgame.s:31398` and `:31422`, stride 0xC8), and it is the
 *  FIRST of them whose reaching two plays the win sound 0x6004001E
 *  (`cardgame.s:31402-31407`). */
export function battleAward(duel: DuelState, w: BattleWalk): void {
  w.winner = w.opponentLeft < w.playerLeft ? 0 : 1;
  duel.setAward = w.winner;
  // State 0xB reads the two totals a second time and compares them with `beq`
  // (`cardgame.s:31245-31261`), and on an equal pair it opens window 0x12 — the
  // draw line — instead of 0x11. The draw is therefore reachable exactly when
  // the award is the opponent's, which an equal total always is.
  duel.setDraw = w.playerLeft === w.opponentLeft;
}

/** Battle-Phase state 0xB — the counter roll's own commit.
 *
 *  After fifty-one ticks of the resident frame delta the winner's set counter
 *  moves by one and only then. `cardgame.s:31202-31228`:
 *
 *    31202  lw $v1, 0x2fc($s1)     the roll accumulator
 *    31205  sw $v1, 0x2fc($s1)     += the frame delta returned at :31197
 *    31206  slti $v1, 0x33         wait while it is under 0x33 = 51
 *    31228  sb $v0, 0x5ae($v1)     the winner's counter, +1, at duel+0xC8*side
 *
 *  `slti $v1, 0x33` is the short form, so it is the accumulator just stored, not
 *  the frame delta.
 *
 *  BEFORE the roll is over the plate already flickers: the same state writes
 *  the winner's counter into the view twice a tick, once with one added and once
 *  without, on the low bit of the accumulator (`andi $v0, 0x1` at
 *  `cardgame.s:31131`, the two arms at `:31133-31149` and `:31150-31164`). The
 *  counter the player reads is the view's, so it alternates between the old and
 *  the new value for all fifty-one ticks. `setEnd`'s roll step draws that.
 *
 *  This is deliberately NOT the same moment as `battleAward`: the disc fixes the
 *  winner in state 0xA and moves the counter in state 0xB, one state later, and
 *  the result window only opens after that (`cardgame.s:31229-31265`). */
export function commitSetCounter(duel: DuelState): void {
  const who = duel.setAward;
  if (who === null || duel.setCounted) return;
  duel.setCounted = true;
  if (who === 0) duel.player.score += 1;
  else duel.opponent.score += 1;
  duel.log.push(who === 0 ? "You win!" : "You lose!");
}

/** Battle-Phase state 0xA plus 0xB, in the order the disc runs them.
 *
 *  Neither latches an effect opcode, so neither can be a beat: the original
 *  reaches them through state 9's tail and state 0xA, and on a board where
 *  neither field holds a card, where no combo ran and no card was queued for
 *  reveal, the Battle Phase issues no beat at all between its banner and the
 *  counter roll. The beat lane therefore settles both when the phase's own
 *  beats run out, which is the same place the disc's state 9 falls through to
 *  state 0xA. */
export function battleSettleSet(duel: DuelState, w: BattleWalk | null): void {
  if (!w || w.settled) return;
  w.settled = true;
  if (duel.setAward === null) battleAward(duel, w);
  commitSetCounter(duel);
}

/** Battle-Phase state 0x12 — the last thing the Battle Phase does.
 *
 *  `cardgame.s:31444-31454`: it reads the award, latches 0x1C when YOU took the
 *  set and 0x1D when the opponent did — the delay slot's `li $v0, 0x1d` at
 *  `:31447` is overridden by the fall-through `li $v0, 0x1c` at `:31448` when
 *  the award is 0 — writes the run count 1, and goes straight to state 0x1A,
 *  which is the machine's return to the mode handler. There is no wait here at
 *  all: the sweep is the last effect the phase issues, and the next set's
 *  dealing follows it.
 *
 *  In this model that sweep is `endSet`: the boards empty and both hands walk
 *  back into their decks, which is the decoded set-change behaviour it has
 *  always been given. The beat is issued only when the duel SURVIVES the set —
 *  state 0x12 is reached only through state 0x11's fall-through
 *  (`cardgame.s:31422-31443`) — and only after both result windows, because a
 *  screen holds the beat lane while they are up.
 *
 *  Returns true when the duel goes on; when a side has taken its second set the
 *  duel is over instead, which is the branch at `cardgame.s:31398-31407` and
 *  `:31422-31436` — and the mode machine reads this routine's return value to
 *  know the duel ended (`cardgame.s:31563-31566` writes 0x19 and
 *  `:31565-31567` returns 2). */
export function battleSweepWinner(duel: DuelState, rng: () => number): boolean {
  if (duel.setAward === null || duel.setCounted === false) return false;
  endSet(duel, rng);
  // The next set starts with nothing awarded and nothing counted.
  duel.setAward = null;
  duel.setDraw = false;
  duel.setCounted = false;
  if (duel.player.score >= SETS_TO_WIN || duel.opponent.score >= SETS_TO_WIN) {
    finishDuel(duel);
    return false;
  }
  duel.set += 1;
  duel.log.push("Next set.");
  return true;
}

/** The whole Battle Phase in one call, for every caller that does not want to
 *  drive it opcode by opcode. It IS the ceremony steps, in the order the disc
 *  issues them — there is no second implementation. */
export function resolveBattle(duel: DuelState): BattleResult {
  const w = battleOpen(duel);
  // State 8 in one go. The beat-driven screen issues one 0x1B per queued
  // reveal and each performs its own exchange; this shortcut runs the whole
  // phase in a single call, so it has to do the same here -- before the
  // comparison, which is the order that makes Fortune Gate work at all.
  for (let i = duel.revealBeats ?? 0; i > 0; i--) exchangeTotals(duel);
  duel.revealBeats = 0;
  battleTotals(duel, w);
  battleDrain(duel, w);
  battleTransfer(duel, w);
  battleSettleSet(duel, w);
  return {
    playerAp: w.playerAp, playerHp: w.playerHp,
    opponentAp: w.opponentAp, opponentHp: w.opponentHp,
    playerLeft: w.playerLeft, opponentLeft: w.opponentLeft,
    winner: w.winner, combos: w.combos,
  };
}
