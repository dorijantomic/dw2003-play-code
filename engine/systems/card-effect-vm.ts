// engine/systems/card-effect-vm.ts — the Program card effect interpreter.
//
// A Program card's behaviour is a program: the byte string in the effect
// record from +0x04, extracted per card into web/assets/data/card_effects.json
// as `messages` (a name the ledger records as CONTRADICTED — it is a program,
// not a message list). The original runs it in F0x80084320, a two-phase
// interpreter over a program counter at duel+0x4E0.
//
// The reading this file implements is
// docs/research/card/card-effect-programs-2026-08-22.md — 100 of 100 opcodes
// across all 60 shipped programs — with the mechanism in
// docs/research/card/card-battle-complete-model-2026-08-06.md §A.3, §G.0,
// §G.3, §G.3.a, §G.6, §G.9, §G.11, §G.15 and §G.20, and the selection model
// read from the handler bodies on 2026-08-22 (see below).
//
// THE MACHINE
//
//   pc        duel+0x4E0, a byte index. The fetch reads the opcode AND
//             advances, so a branch's delta is applied to the position of the
//             NEXT opcode. §G.20 confirms that convention five separate times.
//   mark      duel+0x4E4, the loop top, written by 0x03/0x04/0x05.
//   repeat    duel+0x4E2, the repeat count those three set; 0x06 counts it off.
//   colour    duel+0x306, 1..6, set by 0x6A..0x6F.
//   eligible  duel+0x446, WHAT MAY BE CHOSEN — the array every selector writes.
//   chosen    duel+0x46F, WHAT AN ACTION ACTS ON.
//   cursor    duel+0x440, the committed selection inside a pile.
//   quota     duel+0x444, how many cards a pick may take.
//
// TWO ARRAYS, NOT ONE — read 2026-08-22 from the handler bodies, and it is the
// heart of the machine:
//
//   * the board selector F0x8008EEC8 (opcodes 0x3B/0x3C/0x3D) and the pile
//     sweep F0x8008EC44 (0x32..0x3A) both write **+0x446**, marking everything
//     that passes their filter. Neither picks;
//   * the pickers read +0x446 to decide what is lit and what is dimmed
//     (+0x49E), run a cursor over it (+0x43C) and commit ONE entry —
//     F0x8008AD98 case 14 clears all fifteen +0x46F bytes and sets the one the
//     cursor is on; F0x8008C044 writes the pile index into +0x440 and marks it;
//   * the removal sweep F0x800915D4 (0x4D/0x4E) and the stat applicator
//     F0x8008DEF8 read **+0x46F**.
//
// So a program that marks and then acts without a picker in between acts on
// nothing. This replaces an earlier "target breadth" register, which was a
// guess: 0x5B and 0x5C do not set a mode, they write +0x46F directly —
// F0x800840F0 marks the one slot whose record +0x0C matches the target this
// play recorded, and F0x8008E398 marks every slot passing the play's filter
// class. The pick a player makes is therefore made when the card is PLAYED,
// and the pickers inside a program are the extra questions a program asks.
//
// WHERE A PICK HAPPENS. Six opcodes open a picker: 0xAE over the board and
// 0xA9..0xAD over a pile (the opponent's hand, your hand, your trash, your
// deck, the opponent's deck, in that order). Each stops the duel until it is
// answered when the player is acting; each dispatch block branches on the
// acting side, so the AI answers its own with its own policy.
//
// NOT CHECKED AGAINST THE RUNNING GAME. Everything here is read from code.

import {
  ENERGY_COLOURS,
  FIELD_LIMIT,
  STAT_CAP,
  SUMMON_OPCODE_CARDS,
  aiPickBySelectionRank,
  drawOne,
  fieldTargets,
  opposing,
  putOnField,
  queueSlotStats,
  recomputeTotals,
  settleStats,
  shuffleDeck,
  strengthRank,
  toDeck,
  toHand,
  takeFromDeck,
  takeFromHand,
  browserRowLegal,
  applyBattleDamage,
  canSummon,
  summonFromHand,
  DRAW_COUNT,
} from "./card-battle.ts";
import { latchDynamic, latchProgramBeat } from "./card-ceremony.ts";
import { OPCODE_FAMILY } from "./card-opcode-families.ts";
import type {
  DuelSide,
  DuelState,
  EffectRecord,
  EnergyColour,
  FieldTarget,
} from "./card-battle.ts";

/** A pile a sweep or a picker can run over — §G.15's zone codes 2, 3 and 4. */
export type PileZone = "hand" | "deck" | "trash";

/** duel+0x446, the eligible set. It is one array, so a pile sweep and a board
 *  sweep cannot both be live: the later one overwrites the earlier. */
export type Eligible =
  | { kind: "board"; targets: FieldTarget[] }
  | { kind: "pile"; side: DuelSide; zone: PileZone; slots: number[] }
  | null;

/** What the machine is waiting for. `options` is what may be picked. */
/** Something the duel is PERFORMING on screen, which holds the interpreter.
 *
 *  On the disc every opcode is a pair: an enter phase that runs once and sets
 *  the sub-step counter `duel+0x422` to 1, and an update phase polled every
 *  frame that returns non-zero when it is finished. The interpreter does not
 *  advance the program counter until it does.
 *
 *  That is not a detail of presentation. Measured on the rig 2026-08-24 over
 *  5,776 traced duel frames, the effect interpreter held the frame 4,768 times
 *  and the phase/round driver 717, and NEVER both in one frame — so for most of
 *  a duel the interpreter IS the frame. See
 *  docs/research/card/cardduel-runtime-calltrace-2026-08-24.md.
 *
 *  Our interpreter had no way to be a frame: `runProgram` ran a whole program
 *  to completion. This type is that missing state. It deliberately carries no
 *  artwork and no duration — what each family draws, and for how long, is the
 *  open work in cardduel-effect-opcode-queue-2026-08-24.md. Holding the frame
 *  and knowing what to draw in it are separate problems, and this is the first.
 */
export interface VmPerformance {
  /** the opcode that started it */
  op: number;
  /** the handler-pair family name, from OPCODE_FAMILY (registry-derived) */
  family: string;
  /** the disc's own sub-step counter `duel+0x422`, which starts at 1 */
  step: number;
  /** frames this performance has been held for */
  frames: number;
  /** false while nothing models what this family actually shows — true only
   *  once a family has been decoded and given real steps. Nothing sets this
   *  yet; it exists so a host can tell "a real screen" from "a gap we are
   *  honest about". */
  modelled: boolean;
  /** For `0x9F`..`0xA6` only: which of `F0x800894E4`'s banner messages this
   *  opcode asks for. The interpreter passes it as the third argument and the
   *  callee indexes its own table of text id + sound with it. WHICH message
   *  each index names is not decoded — only that the index is this. */
  bannerId?: number;
  /** Frames the disc holds before the update phase can finish, when that
   *  number is a literal rather than an animation length. Only `0x01` has one. */
  holdFrames?: number;
}

export type VmChoice =
  | { kind: "board"; side: DuelSide; targets: FieldTarget[] }
  | { kind: "pile"; side: DuelSide; zone: PileZone; slots: number[] };

export interface EffectVm {
  cardId: number;
  record: EffectRecord | null;
  /** the side that played the card */
  owner: DuelSide;
  /** 0x11 flips which side the last play counts as; every side-relative
   *  opcode after it runs for the other player. */
  flipped: boolean;
  program: readonly number[];
  pc: number;
  mark: number;
  repeat: number;
  /** 1..6 = white blue green red black brown, 0 = none chosen */
  colour: number;
  eligible: Eligible;
  /** duel+0x46F — the board slots an action opcode acts on */
  chosen: FieldTarget[];
  /** duel+0x440 — the committed selection inside the eligible pile */
  cursor: number;
  quota: number;
  /** The board slot this play recorded as its target (history +0x586), chosen
   *  when the card was played. 0x5B marks exactly it. */
  playTarget: FieldTarget | null;
  /** True while the machine is holding at pc 0 for that play-time target.
   *
   *  On the disc the target is settled BEFORE the interpreter runs: the play
   *  negotiation writes `history[+0x575].+0x586` (F0x800A3E9C for a side that
   *  plays for itself), and the effect interpreter does not start until
   *  Load/Compile state 0xC. So the question cannot be asked at the 0x5B step:
   *  Control Parts is `10 31 3D AE 4D 4C 5B 57 4C`, and asking at its 0x5B
   *  would ask only after the make-room block had already destroyed cards. */
  awaitingPlayTarget: boolean;
  /** 0x2B/0x2D save the play history, 0x2C/0x2E put it back. */
  savedHistory: number[][];
  choice: VmChoice | null;
  done: boolean;
  /** true when the machine may stop and ask; false makes every pick automatic */
  interactive: boolean;
  /** Program counter of the step that PARKED for a pick, or -1.
   *
   *  A step that stops to ask re-runs from the same pc once it is answered. The
   *  disc latches such a step ONCE and lets its update phase poll, so the
   *  re-entry must not queue a second beat. A loop that legitimately runs the
   *  same step again is a different thing and does show twice, which is why
   *  this records the park rather than the last latch. */
  parkedAt: number;
  /** non-null while a screen is playing out and the interpreter is held */
  performing: VmPerformance | null;
  /** `duel+0x57A` — where the prompt family leaves its answer.
   *
   *  READ FROM THE ASSEMBLY 2026-08-24, ~/ddw3/asm/dw2003/pro/cardgame.s
   *  L2940-L2943 (file offsets 0x2DD4/0x2DDC, RAM 0x80085A84/0x80085A8C).
   *  Opcode 0x98's update calls the two-option prompt F0x8008642C and branches
   *  on its return: 1 jumps to 0x80085DC4 with `sb $v1, 0x57a($s1)` in the
   *  DELAY SLOT, and 2 jumps to the SAME address with `sb $zr, 0x57a($s1)` in
   *  its delay slot; a return below 2 (i.e. 0) is the still-waiting path.
   *
   *  Both outcomes converge on one address, so the jump target cannot tell them
   *  apart — the delay slots can, and a MIPS delay slot runs even when its
   *  branch is taken. Reading the target alone would have made these identical.
   *
   *  So: prompt answer 1 writes 1 here, answer 2 writes 0. The prompt returns 1
   *  with the cursor on answer 0 and 2 otherwise, and cancel forces the cursor
   *  to 1 — so 1 means the player accepted and 0 means they passed or cancelled.
   *  Opcode 0x99 writes the picked row into the same byte, so this is a shared
   *  last-answer register, not a yes/no flag. */
  promptAnswer: number | null;
  /** true when the host drives performances frame by frame. Default false, so
   *  every existing caller — the AI, `runProgram`, every test — behaves exactly
   *  as it did: a performance completes the instant it starts. */
  performances: boolean;
  steps: number;
  log: string[];
  /** opcodes that reached the machine with nothing to do to the model — the
   *  presentation family. */
  inert: number[];
}

const MAX_STEPS = 4000;

/** The side every side-relative opcode acts for, after any 0x11 flip. */
export function actingSide(duel: DuelState, vm: EffectVm): DuelSide {
  return vm.flipped ? opposing(duel, vm.owner) : vm.owner;
}

const otherSide = (duel: DuelState, vm: EffectVm): DuelSide =>
  opposing(duel, actingSide(duel, vm));

const pileOf = (s: DuelSide, zone: PileZone): number[] =>
  zone === "hand" ? s.hand : zone === "deck" ? s.deck : s.trash;

/** §G.15's kind-and-colour mask: bit 0 admits Digimon, bit 1 every other kind,
 *  bits 2..7 admit colours 1..6 (white blue green red black brown). */
const COLOUR_BITS: Record<string, number> = {
  white: 0x04, blue: 0x08, green: 0x10, red: 0x20, black: 0x40, brown: 0x80,
};

function passesMask(duel: DuelState, id: number | undefined, mask: number): boolean {
  if (id === undefined) return false;
  const rec = duel.byId.get(id);
  if (!rec) return false;
  const kindBit = rec.kind === "digimon" ? 0x01 : 0x02;
  if (!(mask & kindBit)) return false;
  const colourBit = COLOUR_BITS[rec.colour] ?? 0;
  return (mask & colourBit) !== 0;
}

/** The ten pile sweeps of §G.15: side, zone and mask. `0x96` is not in the 60
 *  shipped programs and is left out. */
const PILE_SWEEPS: Record<number, { side: "acting" | "other"; zone: PileZone; mask: number }> = {
  0x32: { side: "acting", zone: "deck", mask: 0xff },
  0x33: { side: "other", zone: "deck", mask: 0xff },
  0x34: { side: "acting", zone: "deck", mask: 0xfd },
  0x35: { side: "acting", zone: "deck", mask: 0xfe },
  0x36: { side: "other", zone: "hand", mask: 0xff },
  0x37: { side: "acting", zone: "hand", mask: 0xff },
  0x38: { side: "other", zone: "hand", mask: 0x81 },
  0x39: { side: "other", zone: "hand", mask: 0xbf },
  0x3a: { side: "acting", zone: "trash", mask: 0xff },
  // `0x96`, read from F0x80084320 case 0x96: `F0x8008ec44(arg0, arg1, temp_s3,
  // 2, 0xFD)`. Zone 2 is the hand (the same argument that makes 0x38/0x39 hand
  // sweeps), and 0xFD is 0xFF without bit 1 — Digimon only, every colour.
  //
  // Side base is `temp_s3`, the top of the resolution stack, as for
  // 0x85..0x8C; at the one depth we model that is the acting side.
  //
  // Its update sets `+0x421 = 0x97`, so the pile picker fixed to kind 0 opens
  // behind it. 0x97 is a picker, not a selector, and is left to the
  // performance path — this opcode's own job is the sweep.
  0x96: { side: "acting", zone: "hand", mask: 0xfd },
};

/** The board selectors, F0x8008EEC8's three shipped masks. Bit 8 admits the
 *  acting side's board and bit 9 the opponent's, resolved against the side
 *  argument inside the callee; bits 2..7 admit the colours, and all three
 *  shipped values carry all six. */
/** `0x8E`..`0x95` — THE BOARD FILTER SWEEP, `F0x8008D274`.
 *
 *  Decoded 2026-08-09 (model §G.9) from the assembly, because m2c cannot lift
 *  this one: it opens on a `jr` jump table. The table is eight words at
 *  `0x800834FC` indexed `(sel - 1) * 4`.
 *
 *  The enter phase walks all twelve slots, clears each slot's mark, and sets it
 *  on every LIVE slot that passes the selector's test. It damages nothing —
 *  it chooses the board's targets, and a later opcode acts on the marks.
 *
 *  **The polarity is genuinely mixed and that is not a transcription slip.**
 *  `0x91`/`0x92`/`0x94` reach a `beq` that SKIPS the mark on a colour match;
 *  `0x93`/`0x95` reach the shared `bne` that marks ONLY on a match. Colour 5,
 *  black, is tested by none of the eight.
 *
 *  Independently corroborated: the targeting in `card_effects.json` is
 *  extracted from a different function, the legality gate `F0x800A36E4`, and
 *  all eight kinds agree with zero mismatches. */
const BOARD_SWEEPS: Record<number, { sides: ("acting" | "other")[]; colour?: string; not?: string }> = {
  0x8e: { sides: ["acting"] },
  0x8f: { sides: ["other"] },
  0x90: { sides: ["acting", "other"] },
  0x91: { sides: ["acting", "other"], not: "white" },
  0x92: { sides: ["acting", "other"], not: "blue" },
  0x93: { sides: ["acting", "other"], colour: "green" },
  0x94: { sides: ["acting", "other"], not: "red" },
  0x95: { sides: ["acting", "other"], colour: "brown" },
};

/** `F0x8008EEC8`'s masks. Bit 8 admits the acting side's board and bit 9 the
 *  opponent's; bits 2..7 admit colours 1..6 (white blue green red black brown),
 *  the same encoding `passesMask` already uses.
 *
 *  `0x3B`..`0x3D` and `0x85`..`0x8C` are the SAME call — the interpreter's arms
 *  differ only in the immediate, read from `F0x80084320` (`var_a3`, block_282)
 *  and cross-checked against the registry's update blocks. Nothing here is
 *  inferred: every mask below is a literal in the switch.
 *
 *  The one real difference is the side base. `0x3B`..`0x3D` pass `temp_s2` =
 *  `stack[depth-1].ownerSide`; `0x85`..`0x8C` pass `temp_s3` =
 *  `stack[depth].ownerSide` — the effect ON TOP of the resolution stack rather
 *  than the one under it. Our machine resolves one program at a time and has no
 *  response stack, so at the only depth we model the two are the same side, and
 *  `acting` is correct for both. If a response stack is ever built, `0x85`..
 *  `0x8C` must re-base onto the top entry; that is the whole of the difference.
 *
 *  `0x85`..`0x8C` all set `+0x421 = 0x8D`, so the two-hand compare pick runs
 *  behind them. That chain is not modelled here — this opcode only marks. */
const BOARD_SELECTORS: Record<number, { sides: ("acting" | "other")[]; mask: number }> = {
  0x3b: { sides: ["acting", "other"], mask: 0x3fc },
  0x3c: { sides: ["other"], mask: 0x2fc },
  0x3d: { sides: ["acting"], mask: 0x1fc },
  // 0x1FC / 0x2FC / 0x3FC — every colour, on one side or both.
  0x85: { sides: ["acting"], mask: 0x1fc },
  0x88: { sides: ["other"], mask: 0x2fc },
  0x8b: { sides: ["acting", "other"], mask: 0x3fc },
  // 0xBC drops bit 6 — every colour BUT black.
  0x86: { sides: ["acting"], mask: 0x1bc },
  0x89: { sides: ["other"], mask: 0x2bc },
  // 0x80 keeps only bit 7 — brown alone.
  0x87: { sides: ["acting"], mask: 0x180 },
  0x8a: { sides: ["other"], mask: 0x280 },
  0x8c: { sides: ["acting", "other"], mask: 0x380 },
};

/** The five pile pickers. F0x8008BAA4's third argument picks the zone (0 hand,
 *  1 and 2 deck, 3 trash) and its second the side, and the two arguments are
 *  what separates these five opcodes. */
/** `0x70`..`0x82` — THE TARGETING PROMPT, `F0x8008CA4C`. Model §G.17 / §3114.
 *
 *  Nineteen opcodes that differ ONLY in a mask. The handler **opens a prompt and
 *  selects nothing**: it clears the cursor `duel+0x440`, latches the mask into
 *  `duel+0x438`, clears fifteen bytes of the mark array and drives six view
 *  methods. The update half `F0x8008CB5C` waits for confirm or cancel.
 *
 *  WHICH MASK MEANS WHICH PILE is settled by the confirm gate in
 *  `F0x8008CB5C`, which switches on the whole latched mask and refuses confirm
 *  unless one named count is non-zero. Read against `PlayerBlock` those are:
 *
 *      0x0400 -> player  +0x06 discardCount   own trash
 *      0x1400 -> player  +0x06 discardCount   own trash AND own folder
 *      0x1000 -> player  +0x08 deckRemaining  own folder
 *      0x2000 -> opp     +0x08 deckRemaining  opposing folder
 *      0x4000 -> player  +0x0A handCount      own hand
 *      0x8000 -> opp     +0x0A handCount      opposing hand
 *
 *  Every other mask takes the gate's unguarded arm and confirms always. That
 *  is itself a finding: the ten low bits used by `0x73`..`0x7C` (one bit each),
 *  `0x7D` (`0x3FF`, all ten) and `0x7E` (`0x000F0000`, built with `lui`, so an
 *  extractor reading the immediate alone reports `0xF`) CANNOT be piles — a
 *  pile bit always brings a count to guard it. With `F0x8008CA4C` clearing
 *  exactly fifteen mark bytes they are board/mark slots.
 *
 *  STILL NOT IMPLEMENTED, and still for the original reason: the ten bits pair
 *  up, which SUGGESTS five things across two sides, but the field is six slots
 *  per side and nothing demonstrates the mapping. Those twelve fall through to
 *  the performance declaration, which says which family they are without
 *  inventing steps.
 *
 *  `0x70` passes no bits at all, so it opens a prompt over nothing. */
const TARGET_PROMPTS: Record<number, { side: "acting" | "other"; zone: PileZone }> = {
  0x71: { side: "acting", zone: "hand" },   // 0x4000, own hand
  0x7f: { side: "other",  zone: "hand" },   // 0x8000, opposing hand
  0x81: { side: "acting", zone: "trash" },  // 0x0400, own trash
  0x82: { side: "acting", zone: "deck" },   // 0x1000, own folder
  0x72: { side: "other",  zone: "deck" },   // 0x2000, opposing folder
  // 0x1400 lights own trash AND own folder, but the gate reads only the trash
  // count, so the trash is the pile a confirm can actually land on. Modelled as
  // the trash for that reason, not because the folder bit was ignored.
  0x80: { side: "acting", zone: "trash" },
};

/** `0x9F`..`0xA6` — the phase banner, `F0x800894E4`. The interpreter's eight
 *  arms differ only in the third argument, and `F0x80089580` behind them just
 *  holds until confirm or cancel. Read from the registry's enter blocks:
 *  `0x9F` and `0xA0` both pass 0, then 1..6 in opcode order. Eight opcodes,
 *  seven distinct banners. */
const PHASE_BANNERS: Record<number, number> = {
  0x9f: 0, 0xa0: 0, 0xa1: 1, 0xa2: 2, 0xa3: 3, 0xa4: 4, 0xa5: 5, 0xa6: 6,
};

/** `0x99`..`0x9C` — THE CARD PICKER, the busiest screen in the duel: its driver
 *  `F0x80087EDC` is entered 1607 times in one traced duel, more than any other
 *  function in the overlay. Two openers feed it, and the four opcodes differ
 *  only in which pile and whether the rows are tested. Read from the registry's
 *  enter blocks, 2026-08-25:
 *
 *    0x99  F0x80086D78(duel, view, duel + 0x59C + 0xC8 * duel[+0x579])
 *    0x9A  F0x80086D78(duel, view, duel + 0x59C)
 *    0x9B  F0x80086EB0(duel, view, duel[+0x5A6], 5)
 *    0x9C  F0x80086EB0(duel, view, duel[+0x5A2], 9)
 *
 *  `F0x80086D78` is the LEGALITY-TESTED opener: it walks all forty folder
 *  entries, tests each with `F0x80085FD0` — our `browserRowLegal` — and writes
 *  the grey flag `+0x49E` on the ones that fail. `F0x80086EB0` is the
 *  browse-only one: every row legal, used for lists you read rather than pick
 *  from. Both take the pile through the per-player block, so the zone follows
 *  the offset: `+0x0A` (`0x5A6`) is `handCount` and `+0x06` (`0x5A2`) is
 *  `discardCount`.
 *
 *  `0x99` takes its side from `duel+0x579`; the other three name side 0's block
 *  outright. We have no `+0x579`, so `0x99` uses the acting side — the closest
 *  thing our machine has, and the same side at the one depth it models. The
 *  other three are the player, as the disc writes them. */
/** `0x73`..`0x7D` — the targeting prompt's BOARD-SLOT masks, decoded 2026-08-25
 *  from `F0x8009CC4C`, the view method the mask is handed to (`view+0xEB8`, set
 *  by `F0x8009D310`). That function is not among the 268 decompiled bodies,
 *  which is why this sat recorded as unknowable; the assembly at
 *  `.L0x00019F9C` is a flat, entirely regular bit-to-flag mapping:
 *
 *      slot n on side A -> bit 2n     into view+0x90+n
 *      slot n on side B -> bit 2n+1   into view+0xE4+n
 *
 *  So the bits pair up BY SIDE. Which side is which comes from `F0x8008CB5C`'s
 *  confirm guards, read independently and earlier: A[5]/A[6]/A[7] are guarded
 *  by the PLAYER block's discardCount/deckRemaining/handCount and B[6]/B[7] by
 *  the OPPONENT's. So **A is side 0 and B is side 1** — absolute sides, not
 *  acting-relative, which is why these name `duel.player` rather than `acting`.
 *
 *  Slots 0..4 are board positions, 5 the trash, 6 the deck, 7 the hand.
 *
 *  NOT here, deliberately: `0x7E` is `0x000F0000`, slots 8 and 9 on both sides,
 *  and what slots 8 and 9 ARE is the one thing that reading did not settle. It
 *  stays on the performance path rather than being given an invented meaning. */
const BOARD_SLOT_PROMPTS: Record<number, { sides: ("player" | "opponent")[]; slots: number[] }> = {
  0x73: { sides: ["player"], slots: [0] },
  0x74: { sides: ["player"], slots: [1] },
  0x75: { sides: ["player"], slots: [2] },
  0x76: { sides: ["player"], slots: [3] },
  0x77: { sides: ["player"], slots: [4] },
  0x78: { sides: ["opponent"], slots: [0] },
  0x79: { sides: ["opponent"], slots: [1] },
  0x7a: { sides: ["opponent"], slots: [2] },
  0x7b: { sides: ["opponent"], slots: [3] },
  0x7c: { sides: ["opponent"], slots: [4] },
  // 0x3FF — every one of the ten low bits: both sides, all five positions.
  0x7d: { sides: ["player", "opponent"], slots: [0, 1, 2, 3, 4] },
};

const CARD_PICKERS: Record<number, {
  side: "acting" | "player"; zone: PileZone; tested: boolean;
}> = {
  0x99: { side: "acting", zone: "hand", tested: true },
  0x9a: { side: "player", zone: "hand", tested: true },
  0x9b: { side: "player", zone: "hand", tested: false },
  0x9c: { side: "player", zone: "trash", tested: false },
};

const PILE_PICKERS: Record<number, { side: "acting" | "other"; zone: PileZone; aiMode: 0 | 1 }> = {
  // `0x97` — `F0x8008BC6C`, which is `F0x8008BAA4(duel, view, side, 0)`: the
  // same opener as the five below, fixed to zone 0, the hand. m2c renders the
  // wrapper as `F0x8008bc6c(void) { F0x8008baa4(0); }` because the other three
  // arguments are passed straight through in registers; the registry's enter
  // block shows `move $a2, $s3` before the call, so the side is the top of the
  // resolution stack — the acting side at the one depth we model, as for 0x96,
  // which chains into this one via `+0x421 = 0x97`.
  //
  // aiMode 1 matches every other picker that is not the opponent-hand throw;
  // the driver's own second argument is a different thing and is not modelled.
  0x97: { side: "acting", zone: "hand", aiMode: 1 },
  0xa9: { side: "other", zone: "hand", aiMode: 1 },
  0xaa: { side: "acting", zone: "hand", aiMode: 0 },
  0xab: { side: "acting", zone: "trash", aiMode: 1 },
  0xac: { side: "acting", zone: "deck", aiMode: 1 },
  0xad: { side: "other", zone: "deck", aiMode: 1 },
};

/** §G.3's twelve stat immediates, as AP and HP deltas. 0x69's mode 2 drives AP
 *  to zero rather than adding -99. */
const STAT_OPS: Record<number, { ap: number; hp: number; mode: 0 | 1 | 2 }> = {
  0x5e: { ap: 10, hp: 10, mode: 1 },
  0x5f: { ap: 0, hp: 30, mode: 1 },
  0x60: { ap: 50, hp: 50, mode: 1 },
  0x61: { ap: 20, hp: 20, mode: 1 },
  0x62: { ap: 30, hp: 30, mode: 1 },
  0x63: { ap: 0, hp: 10, mode: 1 },
  0x64: { ap: 10, hp: 0, mode: 1 },
  0x65: { ap: 0, hp: -60, mode: 0 },
  0x66: { ap: 0, hp: -15, mode: 0 },
  0x67: { ap: 0, hp: -30, mode: 0 },
  0x68: { ap: 10, hp: -10, mode: 0 },
  0x69: { ap: -99, hp: 0, mode: 2 },
};

/** §G.3.a: opcode -> S-Energy colour index and amount. 0x1E..0x23 change the
 *  acting side's pool, 0x24..0x28 the opponent's. */
const ENERGY_OPS: Record<number, { colour: number; amount: number; foe: boolean }> = {
  0x1e: { colour: 0, amount: 1, foe: false },
  0x1f: { colour: 1, amount: 1, foe: false },
  0x20: { colour: 2, amount: 1, foe: false },
  0x21: { colour: 2, amount: 2, foe: false },
  0x22: { colour: 3, amount: 1, foe: false },
  0x23: { colour: 4, amount: 1, foe: false },
  0x24: { colour: 0, amount: -2, foe: true },
  0x25: { colour: 1, amount: -2, foe: true },
  0x26: { colour: 2, amount: -2, foe: true },
  0x27: { colour: 3, amount: -2, foe: true },
  0x28: { colour: 4, amount: -2, foe: true },
};

export interface VmOptions {
  /** false makes every pick automatic — the AI path, and every test that wants
   *  a program to run to the end in one call. */
  interactive?: boolean;
  /** the board slot the play recorded as its target */
  target?: FieldTarget;
  /** true when the caller will drive performances with `tickPerformance` /
   *  `completePerformance`. Default false: performances complete instantly, so
   *  nothing that exists today changes behaviour. */
  performances?: boolean;
}

/** Start a card's program. Nothing runs until `stepVm`. */
export function startProgram(
  duel: DuelState,
  owner: DuelSide,
  record: EffectRecord,
  opts: VmOptions = {},
): EffectVm {
  const vm: EffectVm = {
    cardId: record.id,
    record,
    owner,
    flipped: false,
    program: record.messages.slice(),
    pc: 0,
    mark: 0,
    repeat: 0,
    colour: 0,
    eligible: null,
    chosen: [],
    cursor: 0,
    quota: 0,
    playTarget: opts.target ?? null,
    awaitingPlayTarget: false,
    savedHistory: [],
    choice: null,
    done: false,
    interactive: opts.interactive ?? false,
    parkedAt: -1,
    steps: 0,
    log: [],
    inert: [],
    performing: null,
    performances: opts.performances ?? false,
    promptAnswer: null,
  };
  // The card you played rises into the centre of the board. On the disc the
  // play machine latches this the moment the card is committed, before the
  // interpreter runs a single step.
  latchProgramBeat(duel, 0x13);
  raisePlayTarget(duel, vm);
  return vm;
}

/** Ceremony opcode `0x70` — the targeting prompt.
 *
 *  The play-time target question, asked before the first opcode runs. Only a
 *  program that carries `0x5B` consumes `+0x586`, and only a live question has
 *  more than one answer.
 *
 *  This is a BEAT, not a branch of `startProgram`. The disc latches `0x70` when
 *  the play machine reaches the targeting step — it is not on a fixed schedule,
 *  which is why it does not appear in `PHASE_CEREMONY` and is recorded on the
 *  duel's stream at the moment it is actually asked. Returns true when a
 *  question was put up. */
export function raisePlayTarget(duel: DuelState, vm: EffectVm): boolean {
  if (!vm.interactive || vm.playTarget || !vm.record) return false;
  if (!vm.program.includes(0x5b)) return false;
  const legal = fieldTargets(duel, vm.owner, vm.record.targeting);
  if (legal.length <= 1) return false;
  vm.awaitingPlayTarget = true;
  vm.choice = { kind: "board", side: vm.owner, targets: legal };
  // The play is held centre stage and the slots it may hit light up, and only
  // then is the question asked.
  latchProgramBeat(duel, 0x8d);
  latchDynamic(duel, 0x70);
  return true;
}

/** The board slots an action opcode acts on right now. */
export const chosenTargets = (vm: EffectVm): FieldTarget[] =>
  vm.chosen.filter((t) => t.slot < t.side.field.length);

/** The disc's own selection ranking, F0x8008C6E0, over a pile. Mode 1 keeps the
 *  strongest (the minimum rank), mode 0 the weakest. Which policy each of the
 *  five pickers hands the AI is NOT established: 0xAB, 0xAC and 0xAD dispatch
 *  to three separate routines that have not been read, so the rank is used for
 *  all of them and only 0xA9/0xAA rest on a decoded policy. */
function pickByRank(
  duel: DuelState,
  side: DuelSide,
  zone: PileZone,
  slots: number[],
  mode: 0 | 1,
): number {
  if (zone === "hand") {
    const slot = aiPickBySelectionRank(duel, side, slots, mode);
    return slot < 0 ? (slots[0] ?? 0) : slot;
  }
  const cards = pileOf(side, zone);
  let best = -1;
  let bestRank = 0;
  for (const i of slots) {
    const rank = strengthRank(duel.byId.get(cards[i] ?? -1));
    if (best < 0) { best = i; bestRank = rank; continue; }
    if (mode === 0) { if (rank < bestRank) continue; } else if (!(rank < bestRank)) continue;
    best = i;
    bestRank = rank;
  }
  return best < 0 ? (slots[0] ?? 0) : best;
}

/** Remove the marked field slots, sending each to the pile its owner keeps.
 *  §G.6: one handler, one argument apart — 0x4D to the owner's trash, 0x4E to
 *  the owner's hand. The owner comes from the slot, so both work either side. */
function removeMarked(targets: FieldTarget[], toOwnerHand: boolean): void {
  const bySide = new Map<DuelSide, number[]>();
  for (const t of targets) {
    const list = bySide.get(t.side) ?? [];
    list.push(t.slot);
    bySide.set(t.side, list);
  }
  for (const [s, slots] of bySide) {
    for (const slot of slots.slice().sort((a, b) => b - a)) {
      const f = s.field.splice(slot, 1)[0];
      if (!f) continue;
      if (toOwnerHand) toHand(s, f.id);
      else s.trash.push(f.id);
    }
    recomputeTotals(s);
  }
}

function grantEnergy(side: DuelSide, colour: number, amount: number): void {
  const key = ENERGY_COLOURS[colour];
  if (!key) return;
  side.energy[key] = Math.max(0, Math.min(STAT_CAP, side.energy[key] + amount));
}

/** Run until the machine finishes or stops for a pick. */
export function stepVm(duel: DuelState, vm: EffectVm, rng: () => number = Math.random): EffectVm {
  while (!vm.done && !vm.choice && !vm.performing) {
    if (vm.steps++ > MAX_STEPS) {
      vm.log.push(`program for card ${vm.cardId} did not terminate`);
      vm.done = true;
      break;
    }
    if (vm.pc < 0 || vm.pc >= vm.program.length) {
      vm.done = true;
      break;
    }
    const op = vm.program[vm.pc]!;
    const at = vm.pc;
    vm.pc += 1; // the fetch advances before the opcode runs — §A.3
    execute(duel, vm, op, at, rng);
    // The step stopped to ask. Its re-entry is the same beat, not a new one.
    if (vm.choice || vm.performing) vm.parkedAt = at;
  }
  if (vm.done) finish(duel);
  return vm;
}

function finish(duel: DuelState): void {
  // The model has no frame clock, so a queued stat change is settled here; the
  // duel screen ticks instead and sees the ramp.
  settleStats(duel.player);
  settleStats(duel.opponent);
  recomputeTotals(duel.player);
  recomputeTotals(duel.opponent);
}

function execute(duel: DuelState, vm: EffectVm, op: number, at: number, rng: () => number): void {
  // TRIGGER AUDIT HOOK, same contract as uifont's: a headless run arms
  // globalThis.__vmOpTrace with a Set and every opcode the duel actually
  // executes lands in it. A decoded opcode that no real duel ever reaches is
  // then measurable rather than assumed. Inert — one undefined check — in play.
  (globalThis as { __vmOpTrace?: Set<number> }).__vmOpTrace?.add(op);

  // Each visible step of a card program is its own beat on the disc. Queue it
  // for the screen before it runs; the rules are applied here as before. The
  // one step not queued is the re-entry of a park — see `parkedAt`.
  const reentry = at === vm.parkedAt;
  vm.parkedAt = -1;
  if (!reentry) latchProgramBeat(duel, op);

  const acting = actingSide(duel, vm);
  const other = otherSide(duel, vm);

  // --- control flow --------------------------------------------------------
  if (op === 0x02) { vm.pc += 2; return; }              // §G.0: +0x4E0 += 2
  if (op === 0x03) { vm.mark = vm.pc; vm.repeat = 2; return; }
  if (op === 0x04) { vm.mark = vm.pc; vm.repeat = 3; return; }
  if (op === 0x05) { vm.mark = vm.pc; vm.repeat = 5; return; }
  if (op === 0x06) { vm.repeat -= 1; if (vm.repeat > 0) vm.pc = vm.mark; return; }
  if (op === 0x07) { if (vm.flipped) vm.pc += 1; return; }
  if (op === 0x08) { if (vm.flipped) vm.pc += 2; return; }
  if (op === 0x09) { if (acting.hand.length <= 10) vm.pc += 9; return; }
  if (op === 0x0a) { if (acting.hand.length > 10) vm.pc -= 9; return; }
  if (op === 0x0b) { if (acting.hand.length <= 3) vm.pc += 9; return; }
  if (op === 0x0c) { if (acting.hand.length > 3) vm.pc -= 9; return; }
  if (op === 0x0d) { if (acting.hand.length > 2) vm.pc += 4; return; }
  if (op === 0x0e) { if (other.deck.length > 0) vm.pc += 2; return; }
  if (op === 0x0f) {
    // The colour compared is the hard-coded 5 (black), not the colour selected.
    const nonBlack = other.hand.some((id) => duel.byId.get(id)?.colour !== "black");
    if (nonBlack) vm.pc -= 4;
    return;
  }
  if (op === 0x10) { if (acting.field.length < FIELD_LIMIT) vm.pc += 5; return; }
  if (op === 0x11) { vm.flipped = !vm.flipped; return; }

  // --- start a fresh target-and-amount group -------------------------------
  // Model G.10, opcodes 0x1C, 0x1D and 0x5A. `F0x80094828` (0x5A) and
  // `F0x80094B78` (0x1C/0x1D) are not board operations: each zeroes the
  // pending-amount words at duel+0x424, +0x428, +0x42C, +0x430 and +0x434, and
  // 0x1C/0x1D also zero +0x438 in their `jr` delay slot. They are how one
  // effect program starts a SECOND target-and-amount group without the first
  // group's marks leaking into it.
  //
  // Our machine has no pending-amount accumulator — `STAT_OPS` applies a change
  // the moment it runs — so the amount half of this opcode has no counterpart
  // and is deliberately not modelled. The half that DOES matter here is the
  // marks: `vm.chosen` is our duel+0x46F, and without this reset a program that
  // resets and then acts without re-running a selector would act on the
  // PREVIOUS group's slots. Every selector (0x5B, 0x5C) reassigns `vm.chosen`,
  // so this only changes behaviour for a reset that is not followed by one —
  // which is exactly the case the disc's opcode exists to handle.
  //
  // NOT modelled, and not guessed: the disc distinguishes 0x1C/0x1D from 0x5A
  // only by that extra +0x438 write.
  //
  // CORRECTED 2026-08-25: +0x438 is not CONTRADICTED, it is OVERLOADED — one
  // struct field carrying several unrelated meanings, which is a documented
  // trap in this codebase rather than a decode conflict. The combo scan writes
  // a CARD ID into it (F0x800A0CD4, and F0x8009403C reads it back to pick the
  // fusion artwork); the pile-prompt setup writes a PILE SELECTOR (5, 7, 9,
  // 0xB, 0xD, 0xF — F0x8008C6E0 subtracts 5 and indexes D0x8008349C). Both
  // readings are correct for their own writer, which is why the two decoded
  // sections disagreed.
  //
  // Treating 0x1C/0x1D/0x5A alike is still the right call, and now for a stated
  // reason rather than an unresolved one: what they share is the mark reset,
  // and which of +0x438's meanings is live depends on whether a prompt is open
  // — which is not knowable from the opcode alone.
  if (op === 0x1c || op === 0x1d || op === 0x5a) { vm.chosen = []; return; }

  // --- S-Energy ------------------------------------------------------------
  const energy = ENERGY_OPS[op];
  if (energy) {
    grantEnergy(energy.foe ? other : acting, energy.colour, energy.amount);
    return;
  }
  if (op === 0x29) {
    for (const s of [duel.player, duel.opponent]) {
      for (const c of ENERGY_COLOURS) s.energy[c as EnergyColour] = 0;
    }
    return;
  }

  // --- play history and presentation --------------------------------------
  if (op === 0x2a) {
    // F0x8008F948, the whole of 0x2A's update phase and its only phase (the
    // enter slot is the shared dispatch tail): `+0x305 += 1` and
    // `+0x304 = history[playCount-1].+0x580 + 1`. So it queues ONE reveal of
    // the card just played, and nothing else — it touches no stat.
    //
    // The beat it queues is Battle-Phase state 8 (model §D.5): while
    // `+0x304 != 0` the state latches opcode 0x1B and counts `+0x305` down,
    // leaving state 8 only when the counter reaches zero. 0x1B's update phase
    // is F0x80093CAC, which ramps both sides' displayed AP and HP toward each
    // other over fifteen frames and then EXCHANGES the stored totals —
    // `+0x59C <-> +0x664` and `+0x59E <-> +0x666`. That is the exchange
    // Fortune Gate is printed for, and it lands in the Battle Phase rather
    // than when the card is played. resolveBattle() applies it.
    duel.revealBeats = (duel.revealBeats ?? 0) + 1;
    return;
  }
  if (op === 0x2b || op === 0x2d) { vm.savedHistory.push(duel.playedThisPhase.slice()); duel.playedThisPhase.pop(); return; }
  if (op === 0x2c || op === 0x2e) {
    const saved = vm.savedHistory.pop();
    if (saved) duel.playedThisPhase = saved;
    return;
  }
  if (op === 0x2f || op === 0x30 || op === 0x31 || op === 0x58 || op === 0x59) {
    // 0x2F, 0x30 and 0x31 are MESSAGE WINDOWS, not flourishes — see DUEL_MESSAGE
    // in card-ceremony.ts. They change no rule, so they stay inert here; what
    // they do is put a sentence on screen and wait, which the beat lane carries.
    vm.inert.push(op);
    return;
  }

  // --- selectors: they mark what MAY be chosen, and pick nothing -----------
  const sweep = PILE_SWEEPS[op];
  if (sweep) {
    const side = sweep.side === "acting" ? acting : other;
    const cards = pileOf(side, sweep.zone);
    const slots: number[] = [];
    cards.forEach((id, i) => { if (passesMask(duel, id, sweep.mask)) slots.push(i); });
    vm.eligible = { kind: "pile", side, zone: sweep.zone, slots };
    vm.cursor = slots[0] ?? 0;
    return;
  }
  const sweep8 = BOARD_SWEEPS[op];
  if (sweep8) {
    // The sweep writes `chosen` directly. On the disc it writes duel+0x46F,
    // which IS the chosen array (§G.9: "the shared selection array the
    // applicator later reads"), not the eligibility array +0x446 the pile
    // sweeps use — so unlike 0x32..0x3D these need no picker behind them.
    const marked: FieldTarget[] = [];
    for (const which of sweep8.sides) {
      const side = which === "acting" ? acting : other;
      side.field.forEach((f, i) => {
        const c = duel.byId.get(f.id)?.colour;
        if (sweep8.colour && c !== sweep8.colour) return;
        if (sweep8.not && c === sweep8.not) return;
        marked.push({ side, slot: i });
      });
    }
    vm.chosen = marked;
    return;
  }
  const board = BOARD_SELECTORS[op];
  if (board) {
    const targets: FieldTarget[] = [];
    for (const which of board.sides) {
      const s = which === "acting" ? acting : other;
      s.field.forEach((f, i) => {
        const rec = duel.byId.get(f.id);
        if (rec && (board.mask & (COLOUR_BITS[rec.colour] ?? 0))) targets.push({ side: s, slot: i });
      });
    }
    vm.eligible = { kind: "board", targets };
    return;
  }

  // --- pickers: they choose ONE of what a selector marked ------------------
  if (op === 0xae) {
    const eligible = vm.eligible?.kind === "board" ? vm.eligible.targets : [];
    if (!eligible.length) { vm.chosen = []; return; }
    if (eligible.length === 1 || !vm.interactive) {
      vm.chosen = [eligible[0]!];
      return;
    }
    vm.choice = { kind: "board", side: acting, targets: eligible };
    vm.pc = at;
    return;
  }
  // --- the phase machine's own opcodes -------------------------------------
  //
  // Twelve opcodes whose BEHAVIOUR our engine already implements under other
  // names, because the walker drives its phases directly rather than by
  // issuing this instruction stream. Wiring them here does not change the
  // running game — measured: `tools/audit_duel_triggers.mjs` reports 0 of 74
  // ceremony opcodes executed in a full duel, because nothing issues them.
  //
  // ⚠ THE HAZARD, stated once and loudly. If the walker ever DOES drive its
  // phases by issuing these — the architectural change the audit's zero
  // poses — then `stepPhase` and these handlers would both run and every one
  // of these effects would apply TWICE. Whoever makes that change has to
  // remove the direct calls in the same commit. Nothing here guards against
  // it, because a guard would be dead code until that day.
  if (op === 0x14) {
    // F0x80092E60, the deal / turn start: a side short of six takes the refill
    // path, one card per seven frames.
    for (const side of [duel.player, duel.opponent]) {
      while (side.hand.length < DRAW_COUNT) if (!drawOne(duel, side)) break;
    }
    return;
  }
  if (op === 0x15 || op === 0x16) {
    // F0x80093624 sets the transfer up: the defender's total less the
    // attacker's, floored at zero. Its third argument picks the attacker, and
    // 0x15/0x16 are that argument 0 and 1 — so side 0 attacks, then side 1.
    //
    // ⚠ TRANSIENT BY CONSTRUCTION, exactly as on the disc. This writes the side
    // TOTAL, and any recount rebuilds that total from the field — `finish()`
    // below does precisely that at the end of every program, so the damage does
    // not outlive the run. `F0x80094848` has the same relationship to
    // `F0x80093710` on the disc: the totals it writes survive only until the
    // next recount, and the set is decided in between. See exchangeQueuedTotals
    // in card-battle.ts, which is the same hazard in a different guise, and is
    // why 0x1B below QUEUES a beat rather than swapping inline.
    //
    // So a test for this opcode has to observe it with stepVm, at the point it
    // acts. runProgram cannot see it, and a test written that way would report
    // the opcode broken when it is faithful.
    const attacker = op === 0x15 ? duel.player : duel.opponent;
    const defender = op === 0x15 ? duel.opponent : duel.player;
    applyBattleDamage(defender, attacker.totalAp);
    return;
  }
  if (op === 0x17 || op === 0x18) {
    // F0x80093B10: one card leaves the played row per step, and the count is
    // zeroed when it empties. Our played row is not per-side, so both arms
    // clear the one row — noted rather than faked into two.
    duel.playedThisPhase = [];
    return;
  }
  if (op === 0x1b) {
    // F0x80093CAC: both sides' two numbers slide across each other over fifteen
    // frames and are then exchanged. This is Fortune Gate, and the exchange is
    // transient — see exchangeQueuedTotals in card-battle.ts for why order is
    // what makes it work.
    duel.revealBeats = (duel.revealBeats ?? 0) + 1;
    return;
  }
  if (op === 0x5d) {
    // F0x8009535C, the settle step: every card's two displayed numbers walk one
    // step toward their true value per frame, and a card whose second number
    // reaches zero is marked. Its update returns 2 in that case and the
    // interpreter chains `+0x421 = 0x4D`, the destroy — which our reap does
    // inside the settle, so the chain has no separate step here.
    for (const side of [duel.player, duel.opponent]) settleStats(side);
    return;
  }
  if (op === 0x9d) {
    // F0x8008C5F0 walks a pile ticking every legal card until the six-card
    // limit, adding each cost to the running total; its enter phase clears
    // `+0x444`, the count. Cards of one type are skipped — the same legality
    // test the pickers use.
    while (acting.field.length < FIELD_LIMIT) {
      const slot = acting.hand.findIndex((id) => canSummon(duel, acting, id));
      if (slot < 0) break;
      if (!summonFromHand(duel, acting, slot)) break;
    }
    return;
  }

  const slotPrompt = BOARD_SLOT_PROMPTS[op];
  if (slotPrompt) {
    const targets: FieldTarget[] = [];
    for (const which of slotPrompt.sides) {
      const side = which === "player" ? duel.player : duel.opponent;
      for (const slot of slotPrompt.slots) {
        if (slot < side.field.length) targets.push({ side, slot });
      }
    }
    vm.eligible = { kind: "board", targets };
    vm.chosen = [];
    return;
  }
  if (op === 0x98) {
    // `F0x80086330(duel, view, 0xE)` — the two-answer box. 0xE is the message
    // id it stores in `view+0xDE8`: escardgm 14, "Use a Program Card?".
    //
    // Before it opens, it walks the PLAYER's hand — `+0x5A6` is that block's
    // handCount and `+0x600` its hand array — testing each entry with
    // `F0x80085FD0(duel, duel+0x5A8, id)`, where `+0x5A8` is the block's energy
    // pool. That is `browserRowLegal`, the same per-row test the browser greys
    // with. If nothing passes it opens in the no-choice state rather than
    // letting a cursor move.
    //
    // The answer itself lands in `duel+0x57A` and reaches us through
    // `completePerformance(vm, answer)`; this opcode's own job is the scan.
    const slots: number[] = [];
    duel.player.hand.forEach((id, i) => {
      if (browserRowLegal(duel, duel.player, id)) slots.push(i);
    });
    vm.eligible = { kind: "pile", side: duel.player, zone: "hand", slots };
    vm.cursor = slots[0] ?? 0;
    vm.chosen = [];
    // DELIBERATELY NO RETURN. The scan is only half of it: the box then holds
    // the frame until someone answers, so 0x98 must still reach the
    // performance declaration at the tail. Returning here made the opcode
    // instantaneous and broke the test that pins the hold — which is the whole
    // reason that test exists.
  }
  const cardPicker = CARD_PICKERS[op];
  if (cardPicker) {
    const side = cardPicker.side === "acting" ? acting : duel.player;
    const cards = pileOf(side, cardPicker.zone);
    // The tested opener greys what cannot be played and leaves it unpickable;
    // the browse-only one offers every row. browserRowLegal IS F0x80085FD0,
    // the very function F0x80086D78 calls per row.
    const slots: number[] = [];
    cards.forEach((id, i) => {
      if (!cardPicker.tested || browserRowLegal(duel, side, id)) slots.push(i);
    });
    vm.eligible = { kind: "pile", side, zone: cardPicker.zone, slots };
    // F0x80086D78 ends `+0x440 = -1`: the picker opens with NO row chosen.
    vm.cursor = slots[0] ?? 0;
    vm.chosen = [];
    return;
  }
  const prompt = TARGET_PROMPTS[op];
  if (prompt) {
    // The prompt OPENS; it does not choose. Everything in the named pile becomes
    // eligible, the cursor resets, and the marks are cleared — which is the
    // fifteen-byte clear. A picker opcode behind it is what commits.
    const side = prompt.side === "acting" ? acting : other;
    const cards = pileOf(side, prompt.zone);
    vm.eligible = { kind: "pile", side, zone: prompt.zone, slots: cards.map((_, i) => i) };
    vm.cursor = 0;
    vm.chosen = [];
    return;
  }
  if (op === 0x70) {
    // No bits at all: a prompt over nothing. It still clears the marks.
    vm.chosen = [];
    return;
  }
  const picker = PILE_PICKERS[op];
  if (picker) {
    const side = picker.side === "acting" ? acting : other;
    const zone = picker.zone;
    const marks = vm.eligible?.kind === "pile" && vm.eligible.side === side && vm.eligible.zone === zone
      ? vm.eligible.slots
      : [];
    if (!marks.length) return;
    if (marks.length === 1) { vm.cursor = marks[0]!; return; }
    if (!vm.interactive) {
      vm.cursor = pickByRank(duel, side, zone, marks, picker.aiMode);
      return;
    }
    vm.choice = { kind: "pile", side, zone, slots: marks.slice() };
    vm.pc = at;
    return;
  }

  // --- the two opcodes that write the chosen set from the play -------------
  if (op === 0x5b) {
    // F0x800840F0: mark the one slot whose record +0x0C is this play's target.
    const legal = vm.record ? fieldTargets(duel, acting, vm.record.targeting) : [];
    // A side that plays for itself has already committed +0x586 through
    // F0x800A3E9C (aiCommitFieldTarget), which takes the FIRST still-flagged
    // slot. The narrowing passes that run before it are card-specific and are
    // NOT enumerated, so the first legal slot is the commit rule only.
    const pick = vm.playTarget ?? legal[0];
    vm.chosen = pick ? [pick] : [];
    return;
  }
  if (op === 0x5c) {
    // F0x8008E398: mark every slot passing this play's filter class.
    vm.chosen = vm.record ? fieldTargets(duel, acting, vm.record.targeting) : [];
    return;
  }
  if (op >= 0x6a && op <= 0x6f) { vm.colour = op - 0x69; return; }
  if (op === 0x4a) {
    // Take the first card the previous step marked as the one to act on.
    const first = vm.eligible?.kind === "pile" ? vm.eligible.slots[0] : undefined;
    if (first !== undefined) vm.cursor = first;
    return;
  }
  if (op === 0x4b) { vm.cursor = 0; return; } // read from the top of the pile

  // --- quotas --------------------------------------------------------------
  if (op === 0x45) { vm.quota = 2; return; }
  if (op === 0x47) { vm.quota = 6; return; }
  if (op === 0x46) { vm.quota = Math.max(0, 3 - acting.hand.length); return; }

  // --- card movement -------------------------------------------------------
  if (op === 0x3e || op === 0x3f) {
    // The one-card hand discards: throw away the card the selection cursor
    // holds, from the opponent's hand (0x3E) or your own (0x3F).
    const side = op === 0x3e ? other : acting;
    const eligible = vm.eligible;
    const slot = eligible?.kind === "pile" && eligible.zone === "hand" ? vm.cursor : -1;
    if (slot < 0 || slot >= side.hand.length) return;
    const taken = takeFromHand(side, slot);
    if (taken) side.trash.push(taken.id);
    if (eligible?.kind === "pile") {
      eligible.slots = eligible.slots.filter((i) => i !== slot).map((i) => (i > slot ? i - 1 : i));
    }
    return;
  }
  if (op === 0x40) {
    // Reveal one card from the chosen pile and put it in the trash. Its update
    // is what removes the card: it appends to the trash and advances the cursor.
    const eligible = vm.eligible;
    if (eligible?.kind !== "pile") return;
    const side = eligible.side;
    const index = Math.min(vm.cursor, Math.max(0, pileOf(side, eligible.zone).length - 1));
    if (eligible.zone === "deck") {
      const taken = takeFromDeck(side, index);
      if (taken) side.trash.push(taken.id);
    } else if (eligible.zone === "hand") {
      const taken = takeFromHand(side, index);
      if (taken) side.trash.push(taken.id);
    } else {
      const id = side.trash.splice(index, 1)[0];
      if (id !== undefined) side.trash.push(id);
    }
    return;
  }
  if (op === 0x41) {
    // THE CANCEL. Its update phase is the overlay's ONLY writer of `duel+0x4dd`
    // (registry target 0x800855a8), and that byte makes the effect driver drop
    // two plays off the turn's resolve queue rather than one — this card, and
    // the play before it, whose program therefore never runs. The turn driver
    // in `card-battle.ts` acts on the flag and sends the cancelled card to its
    // owner's discard, which is what F0x8008F790 does on screen.
    //
    // Read 2026-08-25 from ~/ddw3/asm/dw2003/pro/cardgame.s L32299-32304.
    duel.cancelPrevious = true;
    return;
  }
  if (op === 0x42 || op === 0x43) {
    // Take the selected card out of the chosen pile into the hand: zone 3 is
    // the deck, zone 4 the trash. With nothing swept this is a plain draw.
    const eligible = vm.eligible;
    if (eligible?.kind !== "pile") { drawOne(duel, acting); return; }
    const side = eligible.side;
    if (eligible.zone === "deck") {
      const taken = takeFromDeck(side, Math.min(vm.cursor, Math.max(0, side.deck.length - 1)));
      if (taken) toHand(side, taken.id, taken.slot);
    } else if (eligible.zone === "trash") {
      const index = Math.min(vm.cursor, Math.max(0, side.trash.length - 1));
      const id = side.trash.splice(index, 1)[0];
      if (id !== undefined) toHand(side, id);
    } else {
      const taken = takeFromHand(side, Math.min(vm.cursor, Math.max(0, side.hand.length - 1)));
      if (taken) toHand(side, taken.id, taken.slot);
    }
    vm.eligible = null;
    return;
  }
  if (op === 0x44) {
    // Shuffle the trash back into the deck.
    for (const id of acting.trash) toDeck(acting, id);
    acting.trash = [];
    shuffleDeck(acting, rng);
    return;
  }
  if (op === 0x48) {
    // Move what you picked out of the deck into your hand. Every shipped use
    // reaches it with a quota and no pile sweep, so it takes from the top.
    const eligible = vm.eligible;
    if (eligible?.kind === "pile" && eligible.zone === "deck" && eligible.slots.length) {
      for (const i of eligible.slots.slice(0, Math.max(0, vm.quota)).sort((a, b) => b - a)) {
        const taken = takeFromDeck(eligible.side, i);
        if (taken) toHand(eligible.side, taken.id, taken.slot);
      }
      vm.eligible = null;
      return;
    }
    for (let i = 0; i < vm.quota; i++) if (!drawOne(duel, acting)) break;
    return;
  }
  if (op === 0x49) {
    acting.trash.push(...acting.hand);
    acting.hand = [];
    acting.handSlots = [];
    return;
  }
  if (op === 0x4c) { vm.inert.push(op); return; } // the board closes up: splice already did

  if (op === 0x4d || op === 0x4e) {
    removeMarked(chosenTargets(vm), op === 0x4e);
    vm.chosen = [];
    return;
  }
  const summon = SUMMON_OPCODE_CARDS[op];
  if (summon !== undefined) { putOnField(duel, acting, summon); return; }
  if (op === 0x56) {
    // F0x800919FC: take the Digimon this play chose out of your hand and put it
    // on the board through duel+0x81C = F0x800A0708, placeCardInFieldSlot. Its
    // only user is Scramble Up, printed "Bring a Digimon from Hand to the field
    // in Compile Phase" — which agrees, and was not used to reach the reading.
    const slot = acting.hand.findIndex((id) => duel.byId.get(id)?.kind === "digimon");
    if (slot < 0 || acting.field.length >= FIELD_LIMIT) return;
    const taken = takeFromHand(acting, slot);
    if (taken) putOnField(duel, acting, taken.id);
    return;
  }
  if (op === 0x57) {
    // Copy the marked card into a new board slot — the steal.
    const target = chosenTargets(vm)[0];
    if (!target || acting.field.length >= FIELD_LIMIT) return;
    const f = target.side.field.splice(target.slot, 1)[0];
    if (!f) return;
    acting.field.push(f);
    recomputeTotals(target.side);
    recomputeTotals(acting);
    vm.chosen = [];
    return;
  }

  // --- stat changes --------------------------------------------------------
  const stat = STAT_OPS[op];
  if (stat) {
    const targets = chosenTargets(vm);
    for (const t of targets) {
      const f = t.side.field[t.slot];
      if (!f) continue;
      if (stat.mode === 2) queueSlotStats(f, 0, f.hp);
      else queueSlotStats(f, f.ap + stat.ap, f.hp + stat.hp);
    }
    // The applicator consumes the marks; a 0x4D behind a damage opcode is left
    // holding only the slots the change emptied, so it buries what the damage
    // killed rather than the whole selection. Volcanic Cannon is
    // `6D 5C 58 65 4D 4C`, and "destroy everything marked" there would make its
    // sixty points meaningless.
    vm.chosen = targets.filter((t) => (t.side.field[t.slot]?.hp ?? 1) <= 0);
    return;
  }

  // Nothing above changed the model. On the disc this opcode still costs
  // frames — it is one of the 23 handler families that put something on screen
  // and hold the interpreter until it finishes. Declaring the performance is
  // strictly more faithful than treating it as a no-op, and it makes the gap
  // visible to a host instead of silent.
  //
  // `modelled: false` is the honest part: we know WHICH family this is (the
  // registry pairs both phases at authority 2) and roughly what it shows, but
  // not its steps or its duration. Do not invent either.
  const family = OPCODE_FAMILY[op];
  if (family && vm.performances) {
    const banner = PHASE_BANNERS[op];
    vm.performing = banner !== undefined
      ? { op, family, step: 1, frames: 0, modelled: true, bannerId: banner }
      : op === 0x01
        // The enter phase IS the whole of 0x01: `+0x424 = 0x2D`, and its update
        // is the generic `F0x80084090` countdown that every timed step shares.
        // So this opcode is a 45-frame hold and nothing else.
        ? { op, family, step: 1, frames: 0, modelled: true, holdFrames: 0x2d }
        : { op, family, step: 1, frames: 0, modelled: false };
    vm.log.push(`card ${vm.cardId}: opcode 0x${op.toString(16)} performs ${family}`);
    return;
  }

  vm.inert.push(op);
  vm.log.push(`card ${vm.cardId}: opcode 0x${op.toString(16)} has no model effect`);
}

/** True while a screen is playing out and the interpreter is held. */
export const awaitingPerformance = (vm: EffectVm | null | undefined): boolean =>
  !!vm && vm.performing !== null && !vm.done;

/** One frame of the held performance. Returns the performance while it is
 *  still running, null once it has finished.
 *
 *  Nothing here decides WHEN a performance finishes, because nothing has
 *  decoded any family's duration. It counts frames and hands the decision to
 *  the host, which is the only thing that can see the screen. A host that just
 *  wants the model to move on calls `completePerformance`. */
export function tickPerformance(vm: EffectVm): VmPerformance | null {
  if (!vm.performing) return null;
  vm.performing.frames += 1;
  return vm.performing;
}

/** The host reports that the screen has finished; the interpreter resumes.
 *  Mirrors `resolveVmChoice`. Returns false when nothing was being performed.
 *
 *  `answer` is the prompt family's result — `duel+0x57A`. Pass it for a screen
 *  that asks something; omit it for one that only plays out. */
export function completePerformance(vm: EffectVm, answer?: number): boolean {
  if (!vm.performing) return false;
  if (answer !== undefined) vm.promptAnswer = answer;
  vm.performing = null;
  return true;
}

/** Answer the machine's pending question. `index` is a position in the offered
 *  list for a board pick, and a pile slot for a pile pick. Returns false for a
 *  pick the machine did not offer — it never falls back to one of its own. */
export function resolveVmChoice(duel: DuelState, vm: EffectVm, index: number): boolean {
  const choice = vm.choice;
  if (!choice) return false;
  if (vm.awaitingPlayTarget) {
    if (choice.kind !== "board") return false;
    const pick = choice.targets.find((t) => t.slot === index);
    if (!pick) return false;
    // This answer is the play's +0x586, not a mark: 0x5B is what marks it.
    vm.playTarget = pick;
    vm.awaitingPlayTarget = false;
    vm.choice = null;
    return true;
  }
  if (choice.kind === "board") {
    // A board answer is addressed by FIELD SLOT, not by a position in the
    // offered list: +0x46F is indexed by slot, and F0x8008AD98 case 14 sets the
    // one byte the cursor is on.
    const pick = choice.targets.find((t) => t.slot === index);
    if (!pick) return false;
    vm.chosen = [pick];
    // The picker commits one slot and the eligible set it ran over is spent.
    vm.eligible = null;
  } else {
    if (!choice.slots.includes(index)) return false;
    vm.cursor = index;
    if (vm.eligible?.kind === "pile") vm.eligible.slots = [index];
  }
  vm.choice = null;
  return true;
}

/** True while the machine is waiting for a card to be chosen. */
export const awaitingChoice = (vm: EffectVm | null | undefined): boolean =>
  !!vm && vm.choice !== null && !vm.done;

/** Run a whole program with every pick made automatically.
 *
 *  This is the model-only driver: it starts the machine and steps it, WITHOUT
 *  the resolution gate `checkEffectLegality` that `applyProgramEffect` asks
 *  (F0x800a2180 case 6). Tests that want the disc's resolution behaviour go
 *  through `applyProgramEffect` / `playProgramTurn` + `pumpProgramTurns`. */
export function runProgram(
  duel: DuelState,
  owner: DuelSide,
  record: EffectRecord,
  rng: () => number = Math.random,
  opts: VmOptions = {},
): EffectVm {
  return stepVm(duel, startProgram(duel, owner, record, { ...opts, interactive: false }), rng);
}
