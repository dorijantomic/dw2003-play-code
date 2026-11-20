import { startProgram, stepVm, type VmChoice, resolveVmChoice } from "../card-effect-vm.ts";
import { type CardColour, type EnergyColour, strengthRank } from "./types.ts";
import {
  type DuelSide,
  type DuelState,
  type FieldSlot,
  opposing,
  takeFromHand,
  trashFromHand,
} from "./duel-state.ts";

// ---------------------------------------------------------------------------
// Program cards
// ---------------------------------------------------------------------------

/** A Program card's decoded targeting, as tools/extract_card_effects.py emits
 *  it from F0x800a36e4 / F0x8008eec8 / F0x8008ec44. */
export interface EffectTargeting {
  zone: "none" | "field" | "hand" | "deck" | "trash" | "played-this-phase";
  sides?: ("own" | "opponent")[];
  colours?: CardColour[];
  kinds?: ("digimon" | "program")[];
  requiresCategory?: number;
}

export interface EffectRecord {
  id: number;
  name: string;
  targetKind: number;
  effectVisual: number;
  effectAsset: number;
  playKind: number;
  messages: number[];
  fieldMask?: number;
  targeting: EffectTargeting;
}

export interface EffectTable {
  count: number;
  effects: EffectRecord[];
}

export function indexEffects(table: EffectTable): Map<number, EffectRecord> {
  const m = new Map<number, EffectRecord>();
  for (const e of table.effects) m.set(e.id, e);
  return m;
}

/** What a Program card does, once a target has been picked.
 *
 *  PROVENANCE CORRECTED 2026-08-08. The previous note here said the byte list at
 *  effect record +0x04 was "a message list, not a VM", and that the amounts
 *  "genuinely live in the card text and nowhere else". Both are false — the
 *  ledger claim `cardduel-effect-record-message-list-is-not-a-bytecode` is
 *  recorded as CONTRADICTED. The byte list IS an opcode program, run by the
 *  two-phase interpreter F0x80084320, and the amounts are opcode immediates.
 *
 *  Every entry below has now been checked against that code, and the
 *  correspondence is locked by `tests/card-battle.test.js`
 *  ("Program-card effects match the opcodes the game runs"), which re-derives it
 *  from the extracted programs in web/assets/data/card_effects.json rather than
 *  trusting this comment:
 *
 *  - STAT CHANGES, opcodes 0x5E..0x69 — the twelve packed immediates handed to
 *    F0x8008DEF8 (high halfword to AP, low to HP): +10/+10, 0/+30, +50/+50,
 *    +20/+20, +30/+30, 0/+10, +10/0, 0/-60, 0/-15, 0/-30, +10/-10, -99/0.
 *    All twelve match the amounts here. Damage is HP-only; buffs raise both.
 *  - S-ENERGY, opcodes 0x1E..0x28 — the interpreter passes the amount directly
 *    (+1 for 0x1E/0x1F/0x20/0x22/0x23, +2 for 0x21, -2 for 0x24..0x28), and
 *    F0x8008423c maps opcode to colour index: 0x1E/0x24 -> 0 white, 0x1F/0x25
 *    -> 1 blue, 0x20/0x21/0x26 -> 2 green, 0x22/0x27 -> 3 red, 0x23/0x28 -> 4
 *    black. The same routine picks the side: gains hit the acting side, drains
 *    hit `side ^ 1`, i.e. the opponent. All eleven match.
 *  - ONE TARGET vs ALL — opcode 0x5B selects a single target and 0x5C selects
 *    every match. Checked across all 60 records with zero mismatches. NOTE this
 *    corrects card-battle-complete-model §G.0, which lists 0x5B/0x5C as
 *    "combo-highlight flags" on the strength of the functions they call.
 *
 *  STILL TEXT-DERIVED, not yet read from code:
 *  - The summon-target card ids. Traced 2026-08-08 and it does NOT resolve
 *    statically: opcodes 0x4F..0x55 call F0x80091858 with `opcode + 1`, and that
 *    routine uses the value to index the duel's own instance table at
 *    `duel+0x50` (`(duel + arg3*2)->unk50`) before writing the slot. Per §E.3
 *    those tables hold INSTANCE indices, not card ids, so the summoned Digimon
 *    depends on runtime duel state and cannot be read off the opcode. Taking
 *    `opcode + 1` as a card id gives Dinohumon for "Summon Angemon", which is
 *    plainly wrong — do not "fix" the table that way. Needs a runtime read of
 *    the instance table while one of these cards resolves.
 *  Now ALSO read from code (2026-08-08):
 *  - DRAW counts. F0x80090A6C is the draw routine and the interpreter hands it
 *    the count: opcode 0x45 -> 2, 0x47 -> 6, 0x46 -> `3 - handCount` floored at
 *    0, i.e. a fill-to-three. Chrono Balance runs 0x46 twice, once per side,
 *    which is exactly its "both players' Hands" text. All match.
 *  - SEARCH kinds, from the zone selector each program runs: 0x32 own deck mask
 *    0xFF (any), 0x34 mask 0xFD (Digimon only), 0x35 mask 0xFE (Program only).
 *    All three match.
 *  - Trade Charge was WRONG and is corrected — see entry 45.
 *
 *  STILL unverified: the bounce / trash amounts. */
export type EffectOp =
  | { op: "energyGain"; colour: EnergyColour; amount: number }
  | { op: "energyDrain"; colour: EnergyColour; amount: number }
  | { op: "energyZeroAll" }
  | { op: "buff"; ap: number; hp: number; all: boolean }
  | { op: "damage"; amount: number; all: boolean }
  | { op: "trashField"; all: boolean }
  | { op: "bounceToHand"; all: boolean }
  | { op: "stealDigimon" }
  | { op: "summonCard"; card: number; count: number }
  | { op: "summonFromHand" }
  | { op: "drawCards"; count: number }
  | { op: "searchDeck"; kind: "any" | "digimon" | "program" }
  | { op: "recoverFromTrash" }
  | { op: "trashToDeck" }
  | { op: "discardHandThenDraw"; count: number }
  | { op: "handSizeTo"; count: number }
  | { op: "deckPickThenDiscard" }
  | { op: "deckToTrash"; count: number }
  | { op: "handToTrash"; all: boolean }
  | { op: "swapTotals" }
  | { op: "zeroOpponentAp" }
  | { op: "cancelDrawnProgram" };

/** The seven summon opcodes and the Digimon each brings out — DECODED
 *  2026-08-08, statically, from the game's own data. No runtime read needed;
 *  the earlier "this cannot be resolved without the rig" note was wrong.
 *
 *  `F0x80091858` (cardgame.s file `0x0EBA8`) reads a halfword at
 *  `duel + 0x50 + a3*2` and adds 1 before the catalog getter:
 *      sll $v0, $s7, 0x1  /  addu $v0, $s6, $v0  /  lh $a0, 0x50($v0)
 *      lw $v0, 0x44($sp)  /  jalr $v0  /  addiu $a0, 0x1     (delay slot)
 *  `a3` is `opcode + 1`, so opcodes 0x4F..0x55 read instance slots 80..86 —
 *  past the 80 instances the two 40-card decks occupy, i.e. seven reserved
 *  slots. Those slots' contents are authored: the halfwords at `0x800A5BDC`
 *  (file `0x22F2C`) are exactly `80, 99, 140, 184, 229, 251, 313`, which the
 *  `+1` turns into the card ids below. The order matches `a3` 80..86 one to one.
 *
 *  A literal search for the table address returns nothing across 590074 lines
 *  because MIPS builds it with lui/addiu, so it was found by scanning the
 *  overlay's data words for the id run instead. */
export const SUMMON_OPCODE_CARDS: Readonly<Record<number, number>> = Object.freeze({
  0x4f: 81,    // Angemon
  0x50: 100,   // Patamon
  0x51: 141,   // Gomamon
  0x52: 185,   // Palmon
  0x53: 230,   // Goburimon
  0x54: 252,   // Devimon
  0x55: 314,   // Hagurumon
});

/** The raw halfwords behind it, so a test can re-derive the ids rather than
 *  trust the table above: card id = entry + 1. */
export const SUMMON_TABLE_HALFWORDS: readonly number[] =
  Object.freeze([80, 99, 140, 184, 229, 251, 313]);

/** card id -> what it does, one line per card, each quoting the card's own
 *  effect string. RETIRED AS THE RUNTIME PATH on 2026-08-22: the duel runs each
 *  card's own opcode program through `card-effect-vm.ts` instead. This table is
 *  kept as a readable summary and as the tests' cross-check; 56 of its 60 rows
 *  reproduce exactly what the program does, and the four that do not are the
 *  picks a table cannot express (see the module note in card-effect-vm.ts). */
export const PROGRAM_EFFECTS: Record<number, EffectOp> = {
  1: { op: "trashField", all: true },                                  // "Put all non-white Digimon into trash can."
  2: { op: "summonCard", card: 81, count: 2 },                          // "Bring 2 Angemon to the field in the Compile Phase."
  3: { op: "buff", ap: 10, hp: 10, all: true },                         // "Add +10 to all own Digimon's AP & HP."
  4: { op: "buff", ap: 0, hp: 30, all: false },                         // "Increase one Digimon's HP by +30."
  5: { op: "energyGain", colour: "white", amount: 1 },                  // "Get 1 point of White S-Energy."
  6: { op: "summonCard", card: 100, count: 1 },                         // "Bring Patamon to the field in Compile Phase."
  7: { op: "bounceToHand", all: true },                                 // "Return all non-blue Digimon back to each Hand."
  8: { op: "stealDigimon" },                                            // "Get 1 of your opponent's Digimon from the field."
  9: { op: "cancelDrawnProgram" },                                      // "Put a just drawn PG Card into trash can."
  10: { op: "bounceToHand", all: false },                               // "Return 1 Digimon back to its Hand."
  11: { op: "energyGain", colour: "blue", amount: 1 },                  // "Get 1 point of Blue S-Energy."
  12: { op: "summonCard", card: 141, count: 1 },                        // "Bring Gomamon to the field in Compile Phase."
  13: { op: "buff", ap: 50, hp: 50, all: true },                        // " +50 to all own Green Digimon Card's AP & HP."
  14: { op: "recoverFromTrash" },                                       // "Pick 1 Card from trash can to Hand. One time use."
  15: { op: "energyGain", colour: "green", amount: 2 },                 // "Get 2 points of Green S-Energy."
  16: { op: "buff", ap: 20, hp: 20, all: false },                       // " +20 to one Digimon's AP & HP."
  17: { op: "energyGain", colour: "green", amount: 1 },                 // "Get 1 point of Green S-Energy."
  18: { op: "summonCard", card: 185, count: 1 },                        // "Bring Palmon to the field in Compile Phase."
  19: { op: "damage", amount: 60, all: true },                          // "60 damage points to all non-red Digimon."
  20: { op: "trashField", all: true },                                  // "Put all brown Digimon into trash can."
  21: { op: "damage", amount: 15, all: true },                          // "15 damage points to all Digimon."
  22: { op: "damage", amount: 30, all: false },                         // "30 damage points to an opponent's Digimon."
  23: { op: "energyGain", colour: "red", amount: 1 },                   // "Get 1 point of Red S-Energy."
  24: { op: "summonCard", card: 230, count: 1 },                        // "Bring Goburimon to the field in Compile Phase."
  25: { op: "handToTrash", all: true },                                 // "Put all non-black Cards in opponent's Hand to trash."
  26: { op: "searchDeck", kind: "any" },                                // "Pick 1 Card from Deck, add it to Hand."
  27: { op: "trashField", all: false },                                 // "Put one non-black Digimon into trash can."
  28: { op: "handToTrash", all: false },                                // "Put one Card from opponent's Hand into trash can."
  29: { op: "energyGain", colour: "black", amount: 1 },                 // "Get 1 point of Black S-Energy."
  30: { op: "summonCard", card: 252, count: 1 },                        // "Bring out Devimon to the field in Compile Phase."
  31: { op: "trashField", all: true },                                  // "Put all Digimon into trash can."
  32: { op: "swapTotals" },                                             // "Exchange the total AP and HP of both players."
  33: { op: "deckToTrash", count: 3 },                                  // "Pick 3 Cards from opponent's Deck to trash can."
  34: { op: "discardHandThenDraw", count: 6 },                          // "Put whole Hand in trash and draw 6 from the Deck."
  35: { op: "energyZeroAll" },                                          // "Reduce all S-Energy to zero."
  36: { op: "trashToDeck" },                                            // "Return all Cards in trash back to the Deck."
  37: { op: "handSizeTo", count: 3 },                                   // "Make both players' Hands have 3 Cards."
  38: { op: "deckToTrash", count: 5 },                                  // "Put 5 Cards from opponent's Deck into trash can."
  39: { op: "zeroOpponentAp" },                                         // "Reduce opponent's AP to zero."
  40: { op: "summonFromHand" },                                         // "Bring a Digimon from Hand to the field in Compile Phase."
  41: { op: "buff", ap: 30, hp: 30, all: false },                       // " +30 to one of Brown Digimon's AP & HP."
  42: { op: "drawCards", count: 2 },                                    // "Draw 2 Cards from Deck and add to Hand."
  43: { op: "searchDeck", kind: "digimon" },                            // "Choose a Digimon from Deck and add to Hand."
  44: { op: "searchDeck", kind: "program" },                            // "Choose a PG Card from Deck and add to Hand."
  // CORRECTED 2026-08-08 from the opcode program. This card runs the SAME
  // deck-picker opcode as the three "Charge" search cards (zone selector 0x32 =
  // own deck, mask 0xFF), not a blind draw — so it must not generate S-Energy
  // the way a real draw does. It was implemented with drawOne, which does.
  45: { op: "deckPickThenDiscard" },                                    // "Draw a Card from Deck and put 1 from Hand in trash."
  46: { op: "deckToTrash", count: 2 },                                  // "Put 2 Cards from opponent's Deck into trash can."
  47: { op: "damage", amount: 30, all: false },                         // "30 damage points to 1 Brown Digimon of opponent."
  48: { op: "cancelDrawnProgram" },                                     // "Put a just drawn Brown PG Card into trash can."
  49: { op: "handToTrash", all: false },                                // "Put 1 Brown Digimon from opponent's Hand into trash."
  50: { op: "summonCard", card: 314, count: 2 },                        // "Bring 2 Hagurumon to the field in Compile Phase."
  51: { op: "energyDrain", colour: "white", amount: 2 },                // "Subtract 2 points from opponent's White S-Energy."
  52: { op: "energyDrain", colour: "blue", amount: 2 },                 // "Subtract 2 points from opponent's Blue S-Energy."
  53: { op: "energyDrain", colour: "green", amount: 2 },                // "Subtract 2 points from opponent's Green S-Energy."
  54: { op: "energyDrain", colour: "red", amount: 2 },                  // "Subtract 2 points from opponent's Red S-Energy."
  55: { op: "energyDrain", colour: "black", amount: 2 },                // "Subtract 2 points from opponent's Black S-Energy."
  56: { op: "bounceToHand", all: false },                               // "Return a Brown Digimon to Hand."
  57: { op: "buff", ap: 10, hp: -10, all: false },                      // "AP +10 and HP -10 to 1 Digimon."
  58: { op: "trashField", all: false },                                 // "Put a Brown Digimon from field into trash can."
  59: { op: "buff", ap: 0, hp: 10, all: false },                        // "HP +10 to Digimon."
  60: { op: "buff", ap: 10, hp: 0, all: false },                        // "AP +10 to Digimon."
};

export interface FieldTarget {
  side: DuelSide;
  slot: number;
}

/** Every field slot a card may point at, per its decoded side and colour mask. */
export function fieldTargets(
  duel: DuelState,
  actor: DuelSide,
  targeting: EffectTargeting,
): FieldTarget[] {
  if (targeting.zone !== "field") return [];
  const out: FieldTarget[] = [];
  const foe = opposing(duel, actor);
  const sides: [DuelSide, "own" | "opponent"][] = [[actor, "own"], [foe, "opponent"]];
  for (const [s, key] of sides) {
    if (!targeting.sides?.includes(key)) continue;
    s.field.forEach((f, i) => {
      const rec = duel.byId.get(f.id);
      if (rec && targeting.colours?.includes(rec.colour)) out.push({ side: s, slot: i });
    });
  }
  return out;
}

/** The AI's card choice over a flagged selection — `F0x8008C6E0`, DECODED
 *  2026-08-08 from `cardgame.s` file `0x09A30`. This is the routine the update
 *  phase of opcodes `0xA9`/`0xAA` calls when the acting side is the AI, exactly
 *  where the player gets the interactive picker (`F0x8008C044`). It ends
 *  `sw $s4, 0x440($s5)` — the same committed-selection field the human picker
 *  writes, which is what makes the two paths interchangeable.
 *
 *  It is invisible to every C-level search because m2c cannot lift it: it opens
 *  with a `jr $v0` jump table on `duel+0x438` picking which zone/side to scan.
 *  That is why earlier passes kept concluding the choice was "absent".
 *
 *  The comparison is on card record `+0x08` = `strengthRank`, where LOWER is
 *  STRONGER, and the direction flips on the mode argument:
 *
 *  - mode 0 (`0xAA`, the acting side's OWN hand) — `slt` then `bnez` skips a
 *    candidate that ranks below the incumbent, so the survivor is the MAXIMUM
 *    rank, i.e. the AI throws away its WEAKEST card. Equal ranks fall through
 *    to the take, so a later slot wins a tie.
 *  - mode 1 (`0xA9`, the OPPONENT's hand) — the same compare with `beqz`
 *    inverts it, keeping the MINIMUM rank, i.e. it takes the opponent's
 *    STRONGEST card. Equal ranks are skipped, so an earlier slot wins a tie.
 *
 *  The first eligible slot is always taken (`$s4` starts at -1). */
export function aiPickBySelectionRank(
  duel: DuelState, side: DuelSide, slots: number[], mode: 0 | 1,
): number {
  let bestSlot = -1;
  let bestRank = 0;
  for (const slot of slots) {
    const id = side.hand[slot];
    if (id === undefined) continue;
    const rank = strengthRank(duel.byId.get(id));
    if (bestSlot < 0) { bestSlot = slot; bestRank = rank; continue; }
    if (mode === 0) {
      if (rank < bestRank) continue;          // bnez -> skip the weaker rank
    } else if (!(rank < bestRank)) continue;  // beqz -> keep the minimum
    bestSlot = slot;
    bestRank = rank;
  }
  return bestSlot;
}

/** The hand slots the own-hand selector `0x37` offers.
 *
 *  `F0x8008EC44(duel, view, side, zone, kindMask)` with zone 2 = hand and mask
 *  `0xFF`, i.e. EVERY card in the side's own hand is a legal choice — the mask
 *  narrows nothing, unlike the deck selectors `0x34`/`0x35`. Returned as slot
 *  indices so the caller can drive a cursor over the real hand row. */
export function handTargets(_duel: DuelState, side: DuelSide): number[] {
  return side.hand.map((_, i) => i);
}

/** Resolve a parked hand-discard choice. Returns false if there is nothing
 *  pending or the slot is not one the selector offers — it never falls back to
 *  a slot of its own. */
export function resolveHandDiscard(duel: DuelState, slot: number): boolean {
  const pending = duel.pendingHandDiscard;
  if (!pending) return false;
  if (!handTargets(duel, pending.side).includes(slot)) return false;
  trashFromHand(pending.side, slot);
  duel.pendingHandDiscard = null;
  return true;
}

/** True while an effect is waiting on a hand choice. Callers must not advance
 *  the phase until this clears. */
export function awaitingHandDiscard(duel: DuelState): boolean {
  return duel.pendingHandDiscard !== null;
}

/** Whether a Program card in hand can legally be played at all — the question
 *  F0x800a36e4 answers before offering the card. */
export function canPlayProgram(
  duel: DuelState,
  actor: DuelSide,
  eff: EffectRecord | undefined,
): boolean {
  if (!eff) return false;
  const t = eff.targeting;
  const foe = opposing(duel, actor);
  switch (t.zone) {
    case "none":
      return true;
    case "field":
      return fieldTargets(duel, actor, t).length > 0;
    case "played-this-phase":
      return duel.playedThisPhase.length > 0;
    case "hand":
    case "deck":
    case "trash": {
      const owner = t.sides?.includes("own") ? actor : foe;
      const pile = t.zone === "hand" ? owner.hand : t.zone === "deck" ? owner.deck : owner.trash;
      return pile.some((id) => {
        const rec = duel.byId.get(id);
        if (!rec) return false;
        return t.kinds ? t.kinds.includes(rec.kind) : true;
      });
    }
    default:
      return false;
  }
}

/** The play's settled target instance — the port's `duel+0x586` (`history
 *  +0x586`), which `F0x800A3E9C` writes from a field slot's `+0xC` and
 *  `F0x800A4328`/`F0x80084320` from a hand entry. `checkEffectLegality` arms 9
 *  and 11 re-check it. `zone` names which identity space `instance` is in: the
 *  field's placement serial, or a hand entry. */
export interface NamedTarget {
  zone: "field" | "hand";
  instance: number;
}

/** The instance of the Digimon in `s.field[slot]`, or null when the slot is
 *  empty. This is `F0x800A3E9C`'s read (`lbu 0x73a`), the value it stores at
 *  `history+0x586`. */
export function fieldInstanceAt(s: DuelSide, slot: number): number | null {
  const f = s.field[slot];
  return f ? f.instance : null;
}

/** The identity of the card in `s`'s hand slot, or null when it carries none.
 *  The disc's hand entry is its card-table index; the port's is the per-entry
 *  pile slot `handSlots` (see `checkEffectLegality` arm 11). */
export function handInstanceAt(s: DuelSide, slot: number): number | null {
  const v = s.handSlots[slot];
  return v === undefined || v < 0 ? null : v;
}

/** The play's settled target in `checkEffectLegality`'s terms, or undefined
 *  when the model has none.
 *
 *  The disc stores the settled target's placement serial at `history+0x586`
 *  (`F0x800A3E9C` writes it from the field slot's `+0xC`), and arms 9 and 11
 *  re-check THAT value. The model's equivalent is a live field slot's
 *  `instance`. A `FieldTarget` names a slot, not an instance, so a target
 *  whose slot has since emptied cannot be named; arms 9 and 11 then cannot
 *  refuse, which is the same "no settled target" state the browse-time caller
 *  has and is recorded as a residual gap (the disc settles the target
 *  immediately before it asks, so the window is one beat wide). */
export function namedTargetFor(target: FieldTarget | undefined | null): NamedTarget | undefined {
  if (!target) return undefined;
  const instance = fieldInstanceAt(target.side, target.slot);
  return instance === null ? undefined : { zone: "field", instance };
}

/** The eleven board/hand/deck conditions the disc asks before a committed
 *  Program card either fires or shows its own authored no-effect line.
 *  `F0x800954f8 checkEffectLegality`, read whole at
 *  `exe-decomp/cardgame_c/F0x800954f8.c` (307 lines, asm `_asm/F0x800954f8.s`).
 *  Its only caller is `F0x800a2180` case 6 (`:71-80`): a non-zero return shows
 *  the record's `+0x02` line (`openPrompt`, view `+0xEE4`) and waits for a
 *  button; a zero runs the effect program.
 *
 *  THIS IS A DIFFERENT QUESTION FROM `canPlayProgram`, AT A DIFFERENT POINT.
 *  `canPlayProgram` ports `F0x800a36e4` (the record's `+0x00` targeting kind)
 *  and is the SELECTION gate: whether the hand browser offers the card at all
 *  (`F0x80085FD0`'s grey-out) and which card the AI picks (`F0x800A4978`).
 *  This ports `F0x800954f8` (the record's `+0x01`, the extractor's
 *  `effectVisual`) and is asked only at RESOLUTION, after the card is committed
 *  and its target settled. The disc does not consult them together and they are
 *  not meant to agree; for every shipped card that authors a no-effect line
 *  (`+0x02 != 0`, i.e. effectVisual 1..11) the selection gate's refusal is a
 *  subset of this one's, so this gate only ever refuses in MORE states.
 *
 *  Returns `true` when the disc returns 0 (the effect fires) and `false` when
 *  it returns 1 (the disc refuses and shows the record's own line). Arms 9 and
 *  11 are the two target RE-CHECKS: each compares the play's settled target
 *  instance (`history+0x586` — a field slot's serial, or a hand entry) against
 *  the board or the acting hand, so they take that instance as the optional
 *  `named` argument. A caller with no settled target — the hand browser, which
 *  draws the reason line while the card is still only browsed — gets `true`
 *  from those two arms: the disc settles a target BEFORE it asks
 *  (`F0x800a2180` case 6 runs after the targeting step), so it never refuses
 *  without one.
 *
 *  The arms, each beside its own citation in `F0x800954f8.c` (the acting side
 *  is `history[+0x575-1].+0x584`; the other side its XOR 1):
 *
 *  - 1 `.c:54-64` — refuse when the OPPONENT's hand is empty.
 *  - 2 `.c:65-87` — refuse unless the opponent's hand holds a brown (colour 6)
 *    Digimon (kind `0x10`).
 *  - 3 `.c:88-107` — refuse when the opponent's hand is non-empty and every
 *    card in it is black (colour 5).
 *  - 4 `.c:108-110` — refuse when the ACTING side's trash is empty.
 *  - 5 `.c:111-115` — refuse when the acting side's deck is empty.
 *  - 6 `.c:116-118` — refuse when the OPPONENT's deck is empty.
 *  - 7 `.c:119-138` — refuse unless the acting side's deck holds a Digimon.
 *  - 8 `.c:139-158` — refuse unless the acting side's deck holds a Program
 *    card.
 *  - 9 `.c:159-187` — refuse unless a field slot holds the play's named card.
 *    The named card is the settled target: the arm reads each slot's record
 *    `+0xC` (the placement serial) and compares it to `history+0x586`, which
 *    `F0x800A3E9C` wrote from that same `+0xC` (`lbu 0x73a`). So it asks "is
 *    the Digimon I targeted still on the board". `F0x800840F0` is its marking
 *    twin. The port's `named.instance` is `FieldSlot.instance`; with no settled
 *    target the arm cannot refuse and returns `true`.
 *  - 10 `.c:188-287` — the field-filter class (`playKind`, record `+0x03`,
 *    stored at history `+0x585`): refuse unless some slot satisfies the class.
 *    Classes 1..8 are `fieldFilterLegal` below. Class 0 (a `+0x586` instance
 *    match) and 9+ never reach this arm in shipped data — every effectVisual-10
 *    record carries playKind 1..8 — so no instance data is needed here.
 *  - 11 `.c:288-306` — refuse unless the acting side's hand holds the play's
 *    named card. The named card is the settled target's hand entry; the arm
 *    compares `history+0x586` (written from a hand entry by `F0x800A4328`,
 *    `lbu 0x6c8`) against every entry of `+0x600`. So it asks "is the card I
 *    targeted still in my hand". The port's hand-entry identity is the existing
 *    per-entry pile slot `handSlots` (assigned when the side's pile is built,
 *    carried draw→hand); an entry that carries no authored slot has no
 *    instance. With no settled target the arm returns `true`.
 *
 *  Any other value (notably 0 — 46 of the 60 records author no condition) falls
 *  outside the disc's `1..0xB` switch (`sltiu …, 0xb` at `_asm:45`) and is
 *  legal: the effect always fires.
 *
 *  Durable record: `.dw3-research/card-legality-gate-2026-10-07/worker-r.md`.
 */
export function checkEffectLegality(
  duel: DuelState,
  actor: DuelSide,
  eff: EffectRecord | undefined,
  named?: NamedTarget,
): boolean {
  const foe = opposing(duel, actor);
  const kindOf = (id: number) => duel.byId.get(id)?.kind;
  const isBrownDigimon = (id: number) =>
    duel.byId.get(id)?.colour === "brown" && duel.byId.get(id)?.kind === "digimon";
  const isNotBlack = (id: number) => duel.byId.get(id)?.colour !== "black";
  const isProgram = (id: number) => { const k = kindOf(id); return k !== undefined && k !== "digimon"; };
  switch (eff?.effectVisual ?? 0) {
    case 1:
      return foe.hand.length > 0;
    case 2:
      return foe.hand.some(isBrownDigimon);
    case 3:
      return foe.hand.length > 0 && foe.hand.some(isNotBlack);
    case 4:
      return actor.trash.length > 0;
    case 5:
      return actor.deck.length > 0;
    case 6:
      return foe.deck.length > 0;
    case 7:
      return actor.deck.some((id) => kindOf(id) === "digimon");
    case 8:
      return actor.deck.some(isProgram);
    case 9: {
      // Refuse unless a field slot still holds the play's named instance.
      // With no settled target the disc has not asked yet (its only caller is
      // F0x800a2180 case 6, after the target is settled); the browse-time
      // preview has no target, so there is nothing here to refuse.
      if (named?.zone !== "field") return true;
      return [...actor.field, ...foe.field].some((f) => f.instance === named.instance);
    }
    case 10:
      return fieldFilterLegal(duel, actor, eff?.playKind ?? -1);
    case 11: {
      // Refuse unless the acting side's hand still holds the play's named
      // entry. `handSlots` is the port's per-entry hand identity; an entry
      // carrying no authored pile slot has none, so it cannot match.
      if (named?.zone !== "hand") return true;
      return actor.handSlots
        .slice(0, actor.hand.length)
        .some((v) => v >= 0 && v === named.instance);
    }
    default:
      return true;   // outside the disc's 1..0xB switch: the effect always fires
  }
}

/** `F0x800954f8` case 10's inner switch — the field-filter class carried at
 *  record `+0x03` (written to the play history at `+0x585` by `F0x8009F998`).
 *  The same eight rules `F0x8009FB18 markLegalFieldTargets` marks eligible slots
 *  with (`card-battle-complete-model-2026-08-06.md:900-921`), class → rule:
 *
 *  1 a Digimon on the acting side · 2 one on the opponent's side · 3 either ·
 *  4 a slot that is not white · 5 not blue · 6 green only · 7 not red ·
 *  8 brown only.
 *
 *  The two side classes are relative to the ACTING side — `F0x800954f8` case 10
 *  tests `history[+0x575-1].+0x584` — which the shipped data pins: Gold Aura
 *  (#3, class 1) buffs its own field and Absolute Barrier (#39, class 2) acts on
 *  the opponent's. The five colour classes are the same cards' `.targeting`
 *  colours read the other way. Classes 0 and 9+ have no arm: class 0 would need
 *  the `+0x586` instance, and in shipped data it never pairs with effectVisual
 *  10 (playKind 0 ships only on the effectVisual-9 records), so it refuses. */
function fieldFilterLegal(duel: DuelState, actor: DuelSide, playKind: number): boolean {
  const foe = opposing(duel, actor);
  const slots = [...actor.field, ...foe.field];
  const colour = (f: FieldSlot) => duel.byId.get(f.id)?.colour;
  switch (playKind) {
    case 1:
      return actor.field.length > 0;
    case 2:
      return foe.field.length > 0;
    case 3:
      return slots.length > 0;
    case 4:
      return slots.some((f) => colour(f) !== undefined && colour(f) !== "white");
    case 5:
      return slots.some((f) => colour(f) !== undefined && colour(f) !== "blue");
    case 6:
      return slots.some((f) => colour(f) === "green");
    case 7:
      return slots.some((f) => colour(f) !== undefined && colour(f) !== "red");
    case 8:
      return slots.some((f) => colour(f) === "brown");
    default:
      return false;
  }
}

/** Run a Program card's effect by executing the card's own program.
 *
 *  Until 2026-08-22 this was a hand-written table of per-card outcomes
 *  (`PROGRAM_EFFECTS`, kept below only as a per-card summary that the tests
 *  read; nothing in the duel runs off it any more).
 *  The card's real behaviour is the opcode program in its effect record, and
 *  `card-effect-vm.ts` runs it. Checked card by card: with every pick made
 *  automatically, 56 of the 60 programs land on exactly the state the old table
 *  produced. The four that differ are the four the table could not express —
 *  which card a search takes out of a pile (Ecoly Cycle, Program Charge,
 *  Misery Gate) and Trade Charge throwing away the hand's weakest card, which
 *  its program does with opcode 0xAA rather than by asking.
 *
 *  `target` pre-picks a board slot, as the older callers pass it. With
 *  `interactive` the machine stops instead, and the duel asks the player.
 *
 *  THE RESOLUTION GATE. F0x800954f8 (`checkEffectLegality`) is asked once the
 *  card is committed and its target settled — F0x800a2180 case 6 — and a
 *  non-zero answer shows the record's own +0x02 line and STOPS: the effect
 *  program never runs. `canPlayProgram` (F0x800a36e4) is a different question
 *  asked earlier, and for every shipped card that authors a no-effect line
 *  its refusal is a SUBSET of this one's, so this gate refuses in MORE states.
 *  Without this check the walker ran programs the disc refuses — Digimon
 *  Charge with a deck of only Programs moved the top deck card into the hand
 *  where the disc shows "No Digimon Cards in Deck." (claim
 *  cardgame-effect-legality-gate-2026-10-10, verified; §46.4's delay-slot
 *  note is the pile-count arms' return). The line itself is the record's
 *  +0x02 id (`eff.effectAsset`); the web owns the bank and shows it in the
 *  browser pre-commit, so the model logs the refusal rather than inventing
 *  text.
 */
export function applyProgramEffect(
  duel: DuelState,
  actor: DuelSide,
  cardId: number,
  eff: EffectRecord | undefined,
  target?: FieldTarget,
  rng: () => number = Math.random,
  opts: { interactive?: boolean } = {},
): boolean {
  if (!eff) return false;
  if (!checkEffectLegality(duel, actor, eff, namedTargetFor(target))) {
    duel.log.push(`${actor.name}: ${eff.name} — no effect (condition ${eff.effectVisual} refuses; escardgm line ${eff.effectAsset})`);
    return false;
  }
  const vm = startProgram(duel, actor, eff, {
    interactive: opts.interactive ?? false,
    ...(target ? { target } : {}),
  });
  stepVm(duel, vm, rng);
  duel.effectVm = vm.done ? null : vm;
  // "The card has no effect" — every opcode the program ran was presentation.
  return vm.steps > vm.inert.length;
}

/** What the running program is waiting for, or null. */
export function duelChoice(duel: DuelState): VmChoice | null {
  return duel.effectVm?.choice ?? null;
}

/** True while a card's program is parked on a choice. Callers must not advance
 *  the phase until this clears. */
export function awaitingCardChoice(duel: DuelState): boolean {
  return duelChoice(duel) !== null;
}

/** Answer the running program's question and let it carry on. `index` is a
 *  position in the offered list. Returns false for a pick that was not offered. */
export function resolveCardChoice(
  duel: DuelState,
  index: number,
  rng: () => number = Math.random,
): boolean {
  const vm = duel.effectVm;
  if (!vm || !resolveVmChoice(duel, vm, index)) return false;
  stepVm(duel, vm, rng);
  if (vm.done) duel.effectVm = null;
  return true;
}

/** Play a Program card out of a side's hand. */
export function playProgram(
  duel: DuelState,
  actor: DuelSide,
  slot: number,
  effects: Map<number, EffectRecord>,
  target?: FieldTarget,
  rng: () => number = Math.random,
  opts: { interactive?: boolean } = {},
): boolean {
  const id = actor.hand[slot];
  if (id === undefined) return false;
  const rec = duel.byId.get(id);
  if (!rec || rec.kind !== "program") return false;
  const eff = effects.get(id);
  if (!canPlayProgram(duel, actor, eff)) return false;
  takeFromHand(actor, slot);
  const ran = applyProgramEffect(duel, actor, id, eff, target, rng, opts);
  actor.trash.push(id);
  // escardgm.toml has a line for this: "The card has no effect".
  duel.log.push(ran ? `${actor.name}: ${rec.name}` : `${actor.name}: ${rec.name} — the card has no effect`);
  duel.playedThisPhase.push(id);
  return true;
}
