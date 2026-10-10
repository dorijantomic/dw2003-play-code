// What the original's 3D battle actually shows for an ailment, decoded 2026-10-04.
//
// There is NO 2D status icon over a fighter in a DW3 3D battle. The whole overlay
// loads exactly two sprite packs and the census below is exhaustive, so this is a
// positive finding and not a gap:
//
//   * pro/fightstg.s issues exactly two sprite-pack ids, in every one of their sites:
//       0x00045500 -> PGFGTC00, the battle chrome pack, in 13 routines
//       0x00028600 -> CMFONT,   the shared font/icon pack, in 7 routines
//     (`grep -nE 'lui \$a[0-3], 0x(1|2|3|4)[0-9a-f][0-9a-f]'` over the overlay: the
//     only ids in the 0x100..0x4ff pack range are those two.)
//   * PGFGTC00 holds 48 cels in all (web/assets/ui/pgfgc00_sheet.json). Rendered,
//     they are the two plate pictures, the face-box bezel, the gauge frames, the
//     message window, the list plates and the eight party markers. No ailment icon.
//   * The battle reads a combatant's ailment byte (record +0x1c) in 79 places. Exactly
//     ONE of them is inside a routine that loads a sprite pack: the plate draw's
//     marker test, `.L0x800939a0` (fightstg.s:17305). The other 78 are appliers, the
//     turn gates, the command-menu grey-out (`.L0x80093db8`, which paints the six
//     command rows colour 7 when the sleep bit 0x08 or the abort bit 0x20 is set) and
//     the arithmetic.
//   * pro/wfightmn.s, the battle controller, allocates one screen object
//     (`jal F0x80014504` at file 0x648) and draws no 2D at all.
//
// So the ailment picture a player sees in a 3D battle is the PARTY MARKER under the
// HP bar: one cel for all four ailments, not one per ailment, with no animation, no
// timing and no position tied to the fighter's projected head. It sits in a fixed
// slot, one per party member, at that member's own x out of the halfword table at
// 0x800A34C0 and at the literal y 0x30 = 48.
//
//   FIGHTSTG_F0x800934f0, the plate draw, .L0x80093950-.L0x80093a44 (fightstg.s:17294-17364)
//     .L0x800939a0  lbu $v0, 0x1c($s1)      the record's ailment byte
//     .L0x800939a8  bnez $v0, .L0x800939d0  set -> state 3
//     .L0x800939ac  li $a1, 0x3             the "afflicted" marker
//     .L0x800939e8  addiu $a1, 0xc / .L0x800939f0 addiu $a1, 0x3c
//     .L0x80093a0c  lh $a2, ($v0)           x out of the table at 0x800A34C0
//     .L0x80093a1c  li $a3, 0x30            y = 48, always
//
// Two ailments set therefore still draw ONE marker: the test is `ailment != 0`, not
// one cel per bit. That is the original's whole answer to "what shows when two
// ailments are set", and it is why the walker must not draw a row of icons.
//
// The ailment's NAME reaches the player through the shared battle message box, and
// the game says one word:
//
//   FIGHTSTG_F0x80091534, the apply-what-landed state machine, walks one effect slot
//   per step (0..0x24) and for each landed ailment calls its own applier, writes the
//   message id into self+0x54 and then calls the panel's `+0xac` with kind 2
//   (`li $a1, 0x2` at fightstg.s:15257, `jalr` at :15260) — line 1 the Digimon's name,
//   line 2 that one word:
//
//     poison  .L0x8009c7d4 -> li $v0, 0x1e   "Poisoned!"  (fightstg.s:15198-15200)
//     frozen  .L0x8009c8b0 -> li $v0, 0x1f   "Frozen!"    (fightstg.s:15208-15210)
//     confuse .L0x8009c9c0 -> li $v0, 0x20   "Confused!"  (fightstg.s:15218-15220)
//     sleep   .L0x8009cb10 -> li $v0, 0x21   "Sleep!"     (fightstg.s:15228-15230)
//
// The four ids are indices into message bank 0x7f, esmfight, and their words are the
// disc's own English entries 0x1e..0x21 (web/assets/data/battlecmd/esmfight.json,
// byte-identical to ~/ddw3/lang_file/dw2003/eng/esmfight.toml lines 32-35). The four
// cures are the same shape at 0x28 "Cured!", 0x29 "Defrost!", 0x2a "Conscious!" and
// 0x2b "Awake!".
//
// This module is the single shared source for both facts. `web/battle.js` asks it for
// the message id to hand the translated panel; the plate marker itself stays in
// engine/dw3/ui/native/battle-hud.ts, which already ports the draw, and is re-exported
// here so a caller never has to know which of the two files owns a number.

import {
  BATTLE_HUD_PIP_X, BATTLE_HUD_PIP_XS, BATTLE_HUD_PIP_Y,
  BATTLE_HUD_PIP_CEL_ACTIVE, BATTLE_HUD_PIP_CEL_INACTIVE,
  BATTLE_HUD_PIP_STATE_AFFLICTED, BATTLE_HUD_RECORD_AILMENT,
} from "./ui/native/battle-hud.ts";

/** The ailment keys DW3 has: the four bits of the combatant record's `+0x1c`. */
export type AilmentKey = "poison" | "frozen" | "confuse" | "sleep";

/**
 * The four inflict words, each with the `esmfight` index the original writes for it.
 *
 * One word per ailment, in the original's own order — the applier arms run poison,
 * frozen, confuse, sleep, matching bit 0x01, 0x02, 0x04, 0x08 on record `+0x1c`.
 */
export const AILMENT_INFLICT: Readonly<Record<AilmentKey, { messageId: number; word: string }>> =
  Object.freeze({
    poison:  Object.freeze({ messageId: 0x1e, word: "Poisoned!" }),
    frozen:  Object.freeze({ messageId: 0x1f, word: "Frozen!" }),
    confuse: Object.freeze({ messageId: 0x20, word: "Confused!" }),
    sleep:   Object.freeze({ messageId: 0x21, word: "Sleep!" }),
  });

/** The four cure words, esmfight 0x28..0x2b, from the same apply machine. */
export const AILMENT_CURE: Readonly<Record<AilmentKey, { messageId: number; word: string }>> =
  Object.freeze({
    poison:  Object.freeze({ messageId: 0x28, word: "Cured!" }),
    frozen:  Object.freeze({ messageId: 0x29, word: "Defrost!" }),
    confuse: Object.freeze({ messageId: 0x2a, word: "Conscious!" }),
    sleep:   Object.freeze({ messageId: 0x2b, word: "Awake!" }),
  });

function asAilmentKey(ail: string | null | undefined): AilmentKey | null {
  return ail != null && Object.prototype.hasOwnProperty.call(AILMENT_INFLICT, ail)
    ? (ail as AilmentKey)
    : null;
}

/** The `esmfight` index the original writes when `ail` goes on, or `null`. */
export function ailmentInflictMessageId(ail: string | null | undefined): number | null {
  const key = asAilmentKey(ail);
  return key === null ? null : AILMENT_INFLICT[key].messageId;
}

/**
 * The word the original puts on the second line of the battle message box when `ail`
 * goes on — the disc's own entry, character for character.
 */
export function ailmentInflictWord(ail: string | null | undefined): string {
  const key = asAilmentKey(ail);
  return key === null ? "" : AILMENT_INFLICT[key].word;
}

/** The message bank both the words and the name line come from: `esmfight`, 0x7f. */
export const AILMENT_MESSAGE_BANK = 0x7f;
/** The shared battle-message arm: line 1 the name, line 2 the caller's own index. */
export const AILMENT_MESSAGE_KIND = 2;
/** `esmfight[0x16]` is the bare `{1}` the shared tail fills with the name. */
export const AILMENT_NAME_MESSAGE_ID = 0x16;

// ------------------------------------------------------- the pages the player reads
//
// Both halves below are the SHARED battle message box: `FIGHTSTG_F0x80099588`'s
// 22-arm table (`.L0x8008318c`, indexed `kind - 1`), whose kind 2 and kind 15 arms are
// already ported in engine/dw3/ui/native/battle-message-line.ts. This module only says
// which arm each moment of a battle's life asks for, and with which index.
//
// 1. THE LANDED AILMENT IS ITS OWN BOX PAGE, and it comes after the damage page.
//
//    The damage page: `fightstg.s:14628`-`:14658` makes a message line, puts the amount
//    in the payload's second word and calls the panel with **kind 4** (`li $a1, 0x4`,
//    :14654). Kind 4's arm (`.L0x80099794`, fightstg.s:23466-23482) is line 1
//    `esmfight[0x16]` (the name) and line 2 `esmfight[0x0b]` `{1} damage!` with the
//    number in slot 1.
//
//    What waits between the two pages: the action's own state machine reads the damage
//    line's slot and RETURNS while it is occupied (`lw $v0, ($s2); bnez $v0, .L0x800914cc`,
//    fightstg.s:14624-14626), and only a later step builds the "apply what landed" object
//    (`jal FIGHTSTG_F0x80091b54`, fightstg.s:14705) which prints the ailment word
//    (`.L0x800919a8`-`:15232`, kind 2 at :15257). That object in turn returns without
//    doing anything while the caller's line slot is non-zero
//    (`lw $v0, ($s8); bnez $v0, .L0x80091b24`, fightstg.s:15277-15279) and only then
//    `setState(0)` starts the next page. **So: the player presses Circle on the damage
//    page, and only then does the ailment word arrive as a second page.**

/** The page an ailment's name is: line 1 the Digimon, line 2 the game's one word. */
export function ailmentInflictMessageSpec(
  name: string, ail: string | null | undefined,
): { kind: number; payload: number[]; name: string } | null {
  const id = ailmentInflictMessageId(ail);
  return id === null ? null : { kind: AILMENT_MESSAGE_KIND, payload: [id], name };
}

// 2. THE TURN-START GATE. One routine, `FIGHTSTG_F0x80088564` (fightstg.s:5829), whose
//    ailment arms share one tail at `.L0x80088860` (fightstg.s:6017-6025): store the id
//    at payload+0x00, store 0x10 at payload+0x04, call the panel through `+0xac` with
//    **kind 2**, then `setState(3)`. So all three are "the name" / "the bank's own line".
//
//    * sleep   — record `+0x1c` bit 0x08 (fightstg.s:5997), id `0x90` (`.L0x800887d0`,
//               the `li` in the delay slot of the `j` to the shared tail) = "Asleep!".
//    * frozen  — bit 0x02 (fightstg.s:6009-6010), id `0x56` = "Frozen and can't move!".
//               Only when the block roll `[0x800a4660](0x10)` is nonzero.
//    * confuse — bit 0x04 (fightstg.s:6021), id `0x83 + (acc % 8)` (`.L0x8008882c`-`:8885c`)
//               = one of the eight joke one-liners 0x83..0x8a, the same eight the confused
//               gag draws from.

/** `esmfight` index the turn gate prints for sleep: "Asleep!". */
export const AILMENT_TURN_START_ASLEEP = 0x90;
/** `esmfight` index the turn gate prints for a blocked frozen turn. */
export const AILMENT_TURN_START_FROZEN = 0x56;
/** The first of the eight confuse one-liners the turn gate draws from (`0x83 + n`). */
export const AILMENT_TURN_START_CONFUSE_BASE = 0x83;
/** How many confuse one-liners the gate can print (`sll $v0, 0x3; subu $v0, $v1, $v0`). */
export const AILMENT_TURN_START_CONFUSE_COUNT = 8;

/** The turn-start page `ail` prints: line 1 the Digimon's name, line 2 the bank's line. */
export function ailmentTurnStartMessageSpec(
  name: string, ail: AilmentKey | null | undefined, gagIndex = 0,
): { kind: number; payload: number[]; name: string } | null {
  if (ail === "sleep") {
    return { kind: AILMENT_MESSAGE_KIND, payload: [AILMENT_TURN_START_ASLEEP], name };
  }
  if (ail === "frozen") {
    return { kind: AILMENT_MESSAGE_KIND, payload: [AILMENT_TURN_START_FROZEN], name };
  }
  if (ail === "confuse") {
    const n = (((gagIndex | 0) % AILMENT_TURN_START_CONFUSE_COUNT)
      + AILMENT_TURN_START_CONFUSE_COUNT) % AILMENT_TURN_START_CONFUSE_COUNT;
    return { kind: AILMENT_MESSAGE_KIND, payload: [AILMENT_TURN_START_CONFUSE_BASE + n], name };
  }
  return null;
}

// 3. THE POISON TICK. `esmfight[0x55]` is `Poisoned: {1}`, and it is reached through
//    **kind 15** (`.L0x80099d3c`, fightstg.s:23848-23878: line 1 `esmfight[0x16]`, line 2
//    `esmfight[0x55]`, and `lw $a2, 0x8($s2)` -> `+0x118(line2, 1, amount)`).
//
//    Its only writer is the poison status-event step machine in the battle controller,
//    pro/wfightmn.s `.L0x000026f0`: step 0 asks the vtable's poison/regen tick
//    (`[0x800a460c]`, `FIGHTSTG_F0x800a01ac`) for the amount and keeps it at `self+0x58`
//    (wfightmn.s:2530-2540), step 1 waits for the line slot to clear and takes the HP off
//    (wfightmn.s:2610-2629), step 2 makes the line and asks for **kind 15**
//    (wfightmn.s:2637-2650). So the poison damage is a box page of its own too, and it is
//    the name on line one and `Poisoned: <n>` on line two.

/** `esmfight` index the poison tick prints: "Poisoned: {1}". */
export const POISON_TICK_MESSAGE_ID = 0x55;
/** The shared battle-message arm that page is reached through (`.L0x80099d3c`). */
export const POISON_TICK_MESSAGE_KIND = 15;

/** The poison tick's page: line 1 the Digimon, line 2 the disc's `Poisoned: {1}`. */
export function poisonTickMessageSpec(
  name: string, amount: number,
): { kind: number; payload: number[]; name: string; slots: string[] } {
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  // The arm reads payload word 2 for the number (`.L0x80099da4 lw $a2, 0x8($s2)`); word 0
  // is the side test the shared tail uses and word 1 the party-record index, neither of
  // which the browser has to choose: the session fills line one from `name`.
  return {
    kind: POISON_TICK_MESSAGE_KIND,
    payload: [0, 0, n],
    name,
    slots: [String(n)],
  };
}

// 4. THE REGENERATION TICK. The gradual-HP-recovery status runs as a status-event step
//    machine of its own, the sibling of the poison tick: pro/wfightmn.s `.L0x00002480`,
//    which reads the same effect record the poison machine reads
//    (`lw $v0, 0x4618($v0)` at wfightmn.s:2386, against the poison machine's
//    `[0x800a460c]`), asks the same vtable for the amount and keeps it at `self+0x18`
//    (wfightmn.s:2390), and reloads the record's 1000-tick timer (wfightmn.s:2381):
//
//      step 1  builds the line and asks for **kind 10** — `li $a1, 0xa` at
//              wfightmn.s:2428, the payload words at :2422/:2425/:2426 (word 0 the
//              record's side test, word 1 the record's index, word 2 the amount) and
//              the `+0xac` call's payload pointer at :2432.
//      step 2  waits for the line to clear, then ADDS the amount to the combatant's
//              current HP and clamps it at max HP (wfightmn.s:2446-2454, the
//              `addu $v0, $v1` + `sh $v0, 0x8($s1)` and the `slt $v1, $v0` at :2450).
//
//    Step 0 also bails out when the Digimon is already at full HP, so a full-HP
//    Digimon wearing the Recover Crest gets no page at all (wfightmn.s:2393-2399).
//
//    Kind 10's arm is `.L0x80099a28` (fightstg.s:23651-23681): line 1
//    `esmfight[0x16]` (the name), line 2 `esmfight[0x27]` "HP gradually recovers.",
//    the shared tail, and then the payload copied into the step ring. **There is no
//    `+0x118` call in that arm**, so the amount is never printed: the game says the
//    sentence and leaves the number to the HP plate. The walker used to type
//    "<name> recovers N HP." into the line it shared with the action's own result.

/** `esmfight` index the regeneration tick prints: "HP gradually recovers." */
export const REGEN_TICK_MESSAGE_ID = 0x27;
/** The shared battle-message arm that page is reached through (`.L0x80099a28`). */
export const REGEN_TICK_MESSAGE_KIND = 10;

/**
 * The regeneration tick's page: line 1 the Digimon, line 2 the disc's fixed sentence.
 *
 * `amount` is the HP the tick restored and is carried for the walker's own fallback
 * line only. The original's kind-10 arm writes no numbered slot
 * (fightstg.s:23651-23681), so the box never shows it and `slots` is left empty.
 */
export function regenTickMessageSpec(
  name: string, amount: number,
): { kind: number; payload: number[]; name: string; amount: number; slots?: string[] } {
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  return {
    kind: REGEN_TICK_MESSAGE_KIND,
    payload: [0, 0, n],
    name,
    amount: n,
  };
}

// ------------------------------------------------------------------ the picture
//
// The ailment picture, which is the plate's party marker and not an icon. Re-exported
// from the HUD port so there is one number per fact in this repository.

/** The record offset the marker test reads: the four-bit ailment field. */
export const AILMENT_RECORD_BYTE = BATTLE_HUD_RECORD_AILMENT;
/** Marker state 3: any ailment bit set. One state for all four ailments. */
export const AILMENT_MARKER_STATE = BATTLE_HUD_PIP_STATE_AFFLICTED;
/** PGFGTC00 cel `0x0f` — the afflicted marker on the side's acting member. */
export const AILMENT_MARKER_CEL_ACTIVE =
  BATTLE_HUD_PIP_CEL_ACTIVE + AILMENT_MARKER_STATE;
/** PGFGTC00 cel `0x3f` — the same marker on any other member. */
export const AILMENT_MARKER_CEL_INACTIVE =
  BATTLE_HUD_PIP_CEL_INACTIVE + AILMENT_MARKER_STATE;
/** The marker's y, a literal in the draw: 0x30 = 48, under the plate. */
export const AILMENT_MARKER_Y = BATTLE_HUD_PIP_Y;
/** The halfword table the marker's x comes from. */
export const AILMENT_MARKER_X_TABLE = BATTLE_HUD_PIP_X;
/** Its six entries: the player's three slots then the enemy's, left to right. */
export const AILMENT_MARKER_XS: readonly number[] = BATTLE_HUD_PIP_XS;

/**
 * The cel the marker draws for `active`, straight out of the decoded draw
 * (`state + 0x0c` for the acting slot, `state + 0x3c` for the rest).
 */
export function ailmentMarkerCel(active: boolean): number {
  return active ? AILMENT_MARKER_CEL_ACTIVE : AILMENT_MARKER_CEL_INACTIVE;
}

/**
 * How many markers one fighter with `ailmentBits` set draws. Always 1: the original
 * tests `record +0x1c != 0` once and draws one cel, so two ailments are still one
 * orange marker and there is no icon row to lay out.
 */
export function ailmentMarkerCount(_ailmentBits: number): number {
  return 1;
}