/** The in-duel inspect menu — Hand, Field, Trash, Cancel, Surrender.
 *
 *  WHAT IT IS. While the duel has a card picker up, Triangle opens a five-row
 *  menu over it. Three of the rows are read-only look-throughs: your hand, the
 *  boards, your discard pile. The fourth puts the duel back where it was. The
 *  fifth gives up.
 *
 *  HOW IT IS REACHED, which was the missing half until 2026-08-27. It is not a
 *  menu of its own and it cannot be opened from open play: the pickers' pad arm
 *  polls logical button 0xC — Triangle — and writes a pending step, that step
 *  puts the duel's interpreter into state 3, and state 3 is this machine.
 *  `cardgame.s:4741-4750` (the poll and the store) and `:32883` / `:32900` (the
 *  state-3 dispatch into `F0x800A2608`).
 *
 *  Ledger:
 *    cardduel-inspect-menu-hand-field-trash-arms-2026-08-27
 *    cardduel-inspect-menu-opens-on-triangle-from-a-picker-2026-08-27
 *    cardduel-surrender-ends-the-duel-without-the-set-winner-byte-2026-08-27
 *
 *  CLOSED 2026-08-28 (this was the "what is not decoded" block).
 *    - A look-through shows the WHOLE pile: the opener clears the forty
 *      per-slot flags, the driver is handed the pile's own count, and the
 *      cursor walks one card at a time with no paging
 *      (`exe-decomp/cardgame_c/F0x80086eb0.c`, `F0x80087b80.c`).
 *    - The trash list is filled during play: its count is read-modify-written
 *      by the discard paths (`cardgame.s:11137-11141`, `:12666-12671`,
 *      `:13043-13046`, `:13267-13271` among others). The earlier note that it
 *      had no writer was wrong.
 */

import type { DuelState, DuelSide } from "./card-battle.ts";

/** The five rows, in the order the confirm table at `0x80083AF0` puts them.
 *
 *  DECODED, TEXT INCLUDED, 2026-08-28 — this was a labelled guess until then.
 *  Window B carries no message id of its own: its open method takes only the
 *  cursor row (`cardgame.s:25912-25928`). The row text is baked into the
 *  window's own painter, which fetches the duel's text bank and draws entry
 *  0x20 from it — `cardgame.s:22123-22135`, the same bank and the same setter
 *  the message windows use for their ids. `escardgm` entry 0x20 is
 *  `Hand\nField\nTrash\nCancel\nSurrender`, one line per row, in the order
 *  of the five actions. */
export const INSPECT_ROWS = Object.freeze([
  Object.freeze({ key: "hand" as const, label: "Hand", op: 0x9b }),
  Object.freeze({ key: "field" as const, label: "Field", op: 0xa8 }),
  Object.freeze({ key: "trash" as const, label: "Trash", op: 0x9c }),
  Object.freeze({ key: "cancel" as const, label: "Cancel", op: null }),
  Object.freeze({ key: "surrender" as const, label: "Surrender", op: null }),
]);

export type InspectRowKey = (typeof INSPECT_ROWS)[number]["key"];

export const INSPECT_ROW_COUNT = INSPECT_ROWS.length;

/** The row cursor WRAPS, unlike the card browsers' cursors, which clamp.
 *
 *  Up decrements and steps from the first row to the last; Down increments
 *  modulo five. The confirm reads the byte through an `sltiu` against 5 before
 *  it indexes the table, so five is the bound in the code as well as in the
 *  table (`cardgame.s:32577-32587`). */
export function moveInspectCursor(row: number, delta: number): number {
  const n = INSPECT_ROW_COUNT;
  return ((row + delta) % n + n) % n;
}

/** The heading each look-through opens under, as an `escardgm` index.
 *
 *  Both list arms are the same driver with a different banner id, stored by the
 *  opcode that latched it (`cardgame.s:5312-5321`, and
 *  `exe-decomp/cardgame_c/F0x80087edc.c:58-77` for the whole switch: 0x9A and
 *  0x9B take 25, 0x9C takes 27, 0x9D takes 28). The field arm has no heading
 *  of its own.
 *
 *  The look-through opened from THIS menu also skips the per-card legality
 *  pass: the pass runs only for opcodes below 0x9B and for 0x9D
 *  (`F0x80087edc.c:170-172`), so a card is never greyed out here. That is what
 *  makes it a look and not a choice. */
export const INSPECT_HEADING: Readonly<Record<number, number>> = {
  0x9b: 25, // "Your Hand"
  0x9c: 27, // "Your Trash"
};

/** The three lists the field look-through walks.
 *
 *  TWO ORDERS, and they are not the same one (`F0x8008A068`, decoded
 *  2026-08-28 from `exe-decomp/cardgame_c/F0x8008a068.c`).
 *
 *  On opening (its step 1) it tries YOUR board first, then the opponent's,
 *  then the played stack, and opens on the first that is not empty. If all
 *  three are empty it puts up "No Cards in the Field." (`escardgm` 23) and
 *  waits for a button. THAT EMPTY GUARD EXISTS ONLY HERE: neither the hand nor
 *  the trash arm has one, and the bank's "No Cards in Hand." and "No Cards in
 *  trash." are not loaded by these handlers.
 *
 *  Once open, Up and Down walk the board the way it is DRAWN, top to bottom:
 *  the opponent's row, the played stack, then your row. Up from your row goes
 *  to the played stack when it has anything and otherwise to the opponent's
 *  row; Down from the opponent's row does the mirror; and the two ends do NOT
 *  wrap — Down on your own row and Up on the opponent's are refused. */
export const FIELD_SECTION_TRY_ORDER = Object.freeze(["you", "opp", "played"] as const);
export const FIELD_SECTIONS = Object.freeze(["opp", "played", "you"] as const);
export type FieldSection = (typeof FIELD_SECTIONS)[number];

/** `escardgm` 23, the field look-through's empty message. */
export const NO_CARDS_IN_FIELD = 23;

/** How many slots a field section shows: six, one row of the board. */
export const FIELD_SECTION_SLOTS = 6;

/** The cards in one section of the field look-through. The played stack is the
 *  centre row — what has been played this phase, newest last. */
export function fieldSectionCards(duel: DuelState, section: FieldSection): readonly unknown[] {
  if (section === "you") return duel.player.field;
  if (section === "opp") return duel.opponent.field;
  return duel.playedThisPhase;
}

/** The first section with anything in it, or null when the board is bare. */
export function firstFieldSection(duel: DuelState): FieldSection | null {
  for (const s of FIELD_SECTION_TRY_ORDER) if (fieldSectionCards(duel, s).length) return s;
  return null;
}

/** Up and Down jump to another section, skipping any that is empty, and STOP
 *  at the two ends rather than wrapping. Returns the section unchanged when
 *  there is nowhere to go. */
export function stepFieldSection(
  duel: DuelState, from: FieldSection, delta: number,
): FieldSection {
  let i = FIELD_SECTIONS.indexOf(from);
  for (i += delta; i >= 0 && i < FIELD_SECTIONS.length; i += delta) {
    const s = FIELD_SECTIONS[i]!;
    if (fieldSectionCards(duel, s).length) return s;
  }
  return from;
}

/** A look-through's cursor CLAMPS at both ends and never wraps — the browse pad
 *  refuses the move rather than rolling round (`F0x80087b80`). */
export function clampBrowseCursor(cursor: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(cursor, 0), count - 1);
}

/** `escardgm` 44, the surrender confirm. */
export const ARE_YOU_SURE = 44;

/** Give up.
 *
 *  Surrender does NOT go through the set-award machine. On Yes the inspect
 *  machine returns 2, the duel's tick treats a 2 as end-of-duel, and the
 *  teardown stores 1 into the duel's own end byte before the fade
 *  (`cardgame.s:33057`). It never writes the byte the set machine uses to
 *  record who took a set, so the scores are left exactly as they stand.
 *
 *  IT IS STILL RECORDED AS A LOSS, though — settled 2026-08-28, and this was
 *  the last open question about the menu. The end byte the teardown writes is
 *  read once by the duel's outer loop, which then runs the SAME end-of-battle
 *  recording a decided duel runs (`cardgame.s:33076-33103`): it looks at the
 *  duel's own lost flag and, because that flag is raised when the duel is set
 *  up and only ever cleared at the moment the player WINS the whole match
 *  (`cardgame.s:31658` for the setup, `:31775` for the only clear, off a match
 *  decision that returns 3 for a win), a surrender always reads as lost. The
 *  saved "the player won" word is cleared and the saved win count — capped at
 *  99 — is not incremented. There is no separate loss counter to increase.
 *
 *  So the walker's loss is the disc's loss. The scores still stand untouched,
 *  because the SET machine is what awards a set and it is never reached. */
export function surrenderDuel(duel: DuelState, side: DuelSide): void {
  if (duel.outcome) return;
  duel.outcome = side === duel.player ? "loss" : "win";
  duel.log.push(side === duel.player ? "You gave up." : "Your opponent gave up.");
}
