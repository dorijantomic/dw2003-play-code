// engine/dw3/battle-damage-terms.ts — the record machine that walks the 18-byte
// technique records and decides which page the battle message box gets.
//
// THE SHARED SYSTEM. One machine, FIGHTSTG_F0x8008f714, with its parent
// FIGHTSTG_F0x8008cb70 and its technique-announcement sibling FIGHTSTG_F0x8008ee84.
// Every citation below is `fightstg.s:<line> .L0x<address> <instruction>` out of
// ~/ddw3/asm/dw2003/pro/fightstg.s, so each one can be found with `grep -F`.
//
// It owns the action context at `0x800a43f4` (0x68 bytes), walks the record for the
// technique it was given — `0x80042bca + 18 * techniqueId`, formed at
// fightstg.s:13105 `.L0x8008f95c` sll $v1, $v0, 0x3 / fightstg.s:13106 `.L0x8008f960` addu $v1, $v0 / fightstg.s:13107 `.L0x8008f964` sll $v1, 0x1 / fightstg.s:13108 `.L0x8008f968` lui $v0, 0x8004 / fightstg.s:13109 `.L0x8008f96c` addiu $v0, 0x2bca /
// fightstg.s:13110 `.L0x8008f970` addu $s5, $v1, $v0 — reads the byte at record +0x04, and dispatches through the five-word
// table at `.L0x80083004` (:203-:207):
//
//   fightstg.s:13111 `.L0x8008f974` lbu $v0, 0x4($s5)        # record +0x04, the attack category
//   fightstg.s:13113 `.L0x8008f97c` addiu $v1, $v0, -0x2
//   fightstg.s:13114 `.L0x8008f980` sltiu $v0, $v1, 0x5      # category 2..6 only
//   fightstg.s:13115 `.L0x8008f984` beqz $v0, .L0x80090c1c   # anything else builds NO page
//   fightstg.s:13118 `.L0x8008f990` sll $v1, 0x2            # index = category - 2
//   fightstg.s:13119 `.L0x8008f994` addu $v1, $v0
//   fightstg.s:13121 `.L0x8008f99c` nop
//   fightstg.s:13122 `.L0x8008f9a0` jr $v0
//   fightstg.s:13123 `.L0x8008f9a4` nop
//
// `sltiu $v0, $v1, 0x5` is the SHORT form of `sltiu $v0, $v0, $v1`; the .s text is not
// swapped, and the bound means a category outside 2..6 falls out with no page at all.
//
// THE RECORDS ARE NOT A HAND LIST. They are the disc's technique table:
// `tools/extract_fight_tech_table.py` reads all 443 eighteen-byte rows out of
// `~/ddw3/rust/dw2003_exe_data/src/data.rs` (`D0x80042bdc: [Unknown3; 443]`, declared
// from technique index 1, so technique T lives at `0x80042bca + 18 * T`) and ships them
// as `web/assets/data/fight_tech_table.json`. The field map is
// `docs/research/fight-3d/tech-effects-decode.md` §"The full 18-byte tech record" and
// `docs/research/battle/3d-battle-complete-model-2026-08-19.md` §"The technique
// record". So the population census this module must satisfy is a real data check, not a
// list: `damageTermCategoriesIn()` reads the shipped table and every category that
// occurs in those 443 rows must have a handler here.
//
// THE FIVE HANDLERS, named by what each one does to the message box:
//
//   2 physical -> 0x8008f9a8  an ordinary attack.
//     `ctx+0x42` set   -> no page: fightstg.s:13130 `.L0x8008f9c0` lbu $v1, 0x42($s0) / fightstg.s:13132 `.L0x8008f9c8` beqz $v1, .L0x8008f9e4 run
//                         FIGHTSTG_F0x8009ce84 and write phase 3 straight back.
//     `ctx+0x41` set   -> the arithmetic identity, kind 16: fightstg.s:13139 `.L0x8008f9e4` lbu $v0, 0x41($s0) /
//                         fightstg.s:13141 `.L0x8008f9ec` beqz $v0, .L0x8008fab0.
//     `ctx+0x3e` set   -> retaliation bookkeeping, no page: fightstg.s:13190 `.L0x8008fab0` lbu $v0, 0x3e($s0) /
//                         fightstg.s:13192 `.L0x8008fab8` beqz $v0, .L0x8008fb08.
//     hit flag ctx+0x30 -> kind 4 `{1} damage!`: fightstg.s:13212 `.L0x8008fb08` lbu $v0, 0x30($s0) / fightstg.s:13221 `.L0x8008fb2c` li $a1, 0x4.
//     otherwise        -> kind 2 with `esmfight[0x1d]` "Evade!": fightstg.s:13229 `.L0x8008fb4c` li $v0, 0x1d /
//                         fightstg.s:13234 `.L0x8008fb60` li $a1, 0x2.
//   3 magical  -> 0x8008f9a8 the same body, byte for byte: `.L0x80083008` (:204) is a
//                         second copy of 0x8008f9a8. 402 of the 443 techniques land here.
//   4 restore  -> 0x8008fbec the HEAL-AND-CURE family. It compares the technique id
//                         against 0x64 (100), 0xbd (189), 0xbe..0xc5 (190..197) and
//                         0x177 (375) before anything else (fightstg.s:13272-13284),
//                         then reads the technique's own heal amount from
//                         `[0x800a4614]` (`:13516`) and CAPS it at the target's missing HP
//                         (MAXIMUM at `roster + 0x06` minus CURRENT at `roster + 0x08`,
//                         `:13568`-`:13571`, capped at `:13572`-`:13580`) before asking
//                         kind 8 `:13579`. The earlier revision of this file had those two
//                         roster offsets the wrong way round; the heal the SAME arm then
//                         applies stores into `+0x08` (`fightstg.s:13651`) after reading
//                         its cap from `+0x06` (`:13641`), which settles the order. The
//                         cure window asks kind 9 for the odd half and kind 2 (or kind 1
//                         with "No effect!") for the even half.
//   5 scripted -> 0x8009021c the hand-written techniques: the stat up/down words out of
//                         the two eight-byte tables at `.L0x800a33cc` and
//                         `.L0x800a3414`, "Saving Chi!", the two story-flag refusals,
//                         the MP transfer (kind 18) and "Generating!". 18 records.
//   6 blast    -> 0x800907cc the seven Blast finishers, one word each: kind 1 with
//                         `record[+0x07] + 0x61` at fightstg.s:14075 `.L0x80090884` lbu $v0, 0x7($s5) / fightstg.s:14077 `.L0x8009088c` addiu $v0, 0x61 /
//                         fightstg.s:14078 `.L0x80090890` sw $v0, 0x64($s4), asked for at fightstg.s:14080 `.L0x80090898` li $a1, 0x1.
//
// Decode: docs/research/battle/battle-message-page-kinds-2026-10-04.md §9 (this pass)
// for the record machine, §3 for the 22 page kinds it asks for.

import {
  battleMessagePage, type BattleMessagePage,
} from "./ui/native/battle-message-pages.ts";

/** The record's stride. fightstg.s:13105 `.L0x8008f95c` sll $v1, $v0, 0x3 / fightstg.s:13106 `.L0x8008f960` addu $v1, $v0 / fightstg.s:13107 `.L0x8008f964` sll $v1, 0x1 compute `v * 9 * 2`. */
export const DAMAGE_TERM_STRIDE = 0x12;
/** Where the table starts in RAM. fightstg.s:13108 `.L0x8008f968` lui $v0, 0x8004 / fightstg.s:13109 `.L0x8008f96c` addiu $v0, 0x2bca. */
export const DAMAGE_TERM_TABLE_BASE = 0x80042bca;
/** The table is declared from technique index 1; the record at the base is index 0. */
export const DAMAGE_TERM_FIRST_ID = 1;
/** `tools/extract_fight_tech_table.py` asserts this many rows. */
export const DAMAGE_TERM_ROW_COUNT = 443;
/** The five-word jump table, `.L0x80083004` (:203-:207). */
export const DAMAGE_TERM_HANDLER_TABLE = 0x80083004;
/** fightstg.s:13113 `.L0x8008f97c` addiu $v1, $v0, -0x2 / fightstg.s:13114 `.L0x8008f980` sltiu $v0, $v1, 0x5 — categories 2 through 6. */
export const DAMAGE_TERM_CATEGORY_MIN = 2;
export const DAMAGE_TERM_CATEGORY_MAX = 6;

/**
 * The dispatch table, indexed by `category - 2`, with the arm addresses so a census
 * test can compare this list against the `.word`s in the assembly.
 */
export const DAMAGE_TERM_HANDLERS: readonly number[] = Object.freeze([
  0x8008f9a8, // category 2, physical — :203
  0x8008f9a8, // category 3, magical  — :204, the SAME body as category 2
  0x8008fbec, // category 4, restore  — :205
  0x8009021c, // category 5, scripted — :206
  0x800907cc, // category 6, blast    — :207
]);

/** The category each handler answers for, in the same order. */
export const DAMAGE_TERM_CATEGORIES: readonly number[] = Object.freeze(
  DAMAGE_TERM_HANDLERS.map((_unused, i) => i + DAMAGE_TERM_CATEGORY_MIN),
);

/** `esmfight` word the ordinary-hit arm reaches when the technique did not land. */
export const DAMAGE_TERM_EVADE_WORD = 0x1d;
/** `li $v0, 0x2f` — the "it would not fit" refusal. */
export const DAMAGE_TERM_NO_EFFECT_WORD = 0x2f;

/**
 * The categories whose applier rolls for accuracy at all.
 *
 * The APPLIER, not the page, is what rolls. `FIGHTSTG_F0x8009e0cc` (:28399) settles the
 * record's dispatch byte `+0x0a` first, and then reads the **category** byte `+0x04`:
 *
 * ```
 * fightstg.s:28463 .L0x8009e1c8: lbu $v1, 0x4($s4)     # the attack category
 * fightstg.s:28464 .L0x8009e1cc: li $v0, 0x2
 * fightstg.s:28465 .L0x8009e1d0: beq $v1, $v0, .L0x8009e1e8   # category 2 -> accuracy
 * fightstg.s:28466 .L0x8009e1d4: li $v0, 0x3
 * fightstg.s:28467 .L0x8009e1d8: beq $v1, $v0, .L0x8009e330   # category 3 -> accuracy
 * fightstg.s:28468 .L0x8009e1dc: lui $v0, 0x800a
 * fightstg.s:28470 .L0x8009e1e0: j  .L0x8009e3c8               # EVERYTHING ELSE -> no roll
 * ```
 *
 * The two accuracy getters are `lw $v0, 0x9c($s2)` on the table at `0x800a4580`
 * (`addiu $s2, $v0, 0x4580` :28474) for category 2 and `lw $v0, 0xa0($s0)` on the same
 * table (`lui $s0, 0x800a` :28555 / `addiu $s0, 0x4580` :28556) for category 3; both store
 * the verdict at `0x30` of the `0x800a43f4` context (`sb $v0, 0x30($s1)` :28484 and
 * :28566). `.L0x8009e3c8` (:28591) makes no roll at all.
 *
 * So a heal or a cure **cannot miss**, and the walker's own accuracy roll must not stand
 * in front of one.
 */
export const DAMAGE_TERM_ROLLED_CATEGORIES: readonly number[] = Object.freeze([2, 3]);

/** Whether the original's applier rolls for accuracy on a record of this category. */
export function damageTermCategoryRolls(category: number): boolean {
  return DAMAGE_TERM_ROLLED_CATEGORIES.includes(Math.trunc(Number(category)) | 0);
}
/** `li $v0, 0x1f` — the dispatch byte that takes the repeat pass. */
export const DAMAGE_TERM_REPEAT_WORD = 0x1f;
/** `addiu $v0, 0x61` — the Blast finisher's word base. */
export const DAMAGE_TERM_BLAST_WORD_BASE = 0x61;
/** `slti $v0, 0x2710` / `li $v0, 0x270f` — the damage clamp on the repeat pass. */
export const DAMAGE_TERM_DAMAGE_CAP = 0x270f;
/**
 * The three category-5 arms that ROLL before they speak, by the technique id their
 * `li $a1` names.
 *
 * **These are NOT story flags** (the 2026-10-04 revision of this file called them
 * `DAMAGE_TERM_FLAG_*` and read them through "the runtime flag getter"). The three
 * words the arms load at `0x800a4648` / `0x800a464c` / `0x800a4640` are function
 * POINTERS — `fightstg.s:35038-.L0x800a4648: .word 0x800a1508`,
 * `:35039 .L0x800a464c: .word 0x800a1558` and `:35036 .L0x800a464c`/`0x800a4640:
 * .word 0x800a13c0` — and all three bodies are the same seven-instruction roll:
 *
 * ```
 * fightstg.s:31841 .L0x800a1508: sll $v1, $a1, 0x3
 * fightstg.s:31842 .L0x800a150c: addu $v1, $a1      # $a1 * 18 = the record stride
 * fightstg.s:31843 .L0x800a1510: sll $v1, 0x1
 * fightstg.s:31845 .L0x800a1518: addiu $v0, 0x2bca
 * fightstg.s:31846 .L0x800a151c: addu $v1, $v0      # $s1 = the record at 0x80042bca + 18*$a1
 * fightstg.s:31855 .L0x800a152c: lbu $s0, 0xb($v1)  # the threshold is record +0x0B (f8)
 * fightstg.s:31861 .L0x800a1538: jalr $v0           # rand()
 * fightstg.s:31864 .L0x800a1540: andi $v0, 0x7f
 * fightstg.s:31865 .L0x800a1544: slt $v0, $s0      # (rand & 0x7f) < f8
 * ```
 *
 * So `$a1` is the TECHNIQUE ID the arm names in its delay slot (`li $a1, 0xd3` at
 * `:13887`, `li $a1, 0xd4` at `:13905`, `li $a1, 0x187` at `:13922`) and the roll
 * succeeds 80/128 for 211 and 212 (their `f8` is 80) and 96/128 for 391.
 */
export const DAMAGE_TERM_ROLL_FLEE = 0xd3;
export const DAMAGE_TERM_ROLL_DIGIVOLVE = 0xd4;
export const DAMAGE_TERM_ROLL_STATUS = 0x187;

/** One row of the shipped table, in the extractor's field names. */
export interface DamageTermRecord {
  /** +0x00 the MP cost. */
  mp: number;
  /** +0x02 the power. */
  power: number;
  /** +0x04 the attack category, 2..6. `sltiu` rejects anything else. */
  category: number;
  /** +0x05 the target byte (1..4). */
  f3: number;
  /** +0x06 the low half of the target halfword. */
  elemCtx: number;
  /** +0x07 element 1. The Blast finisher prints `elem1 + 0x61`. */
  elem1: number;
  /** +0x08 the per-skill scalar. */
  scalar: number;
  /** +0x09 element 2. */
  elem2: number;
  /** +0x0a the special-op / dispatch code, 1..36. */
  dispatch: number;
  /** +0x0b a 7-bit mask. */
  f8: number;
  /** +0x0c effect parameter 2 / the crit bonus. */
  crit: number;
  /** +0x0d the signature-effect slot. */
  sigEffect: number;
  /** +0x0e the effect type. */
  effect: number;
  /** +0x0f the attack motion id. */
  motion: number;
  /** +0x10 the action-script clip. */
  clip: number;
  /** +0x11 the hit count. */
  f14: number;
}

/** The state of the action context (`0x800a43f4`) and of the machine (`self`) it reads. */
export interface DamageTermContext {
  /** `self+0x54`, the technique id, which indexes the record. */
  techniqueId: number;
  /** `self+0x50`, the acting side: 0 the player's partner, 1 the enemy. */
  side: number;
  /** The Digimon the page names; the original derives it from the payload's side test. */
  name: string;
  /** `ctx+0x28`, the resolved damage (or the heal amount) for one application. */
  damage: number;
  /** `ctx+0x34`, the number of applications. */
  hitCount: number;
  /**
   * `ctx+0x60 + ctx+0x64`, the damage the earlier applications have already added up.
   * Only the repeat pass with dispatch byte 0x1f shows it (fightstg.s:13154 `.L0x8008fa20`
   * lw $v0, 0x60($s0) / fightstg.s:13155 `.L0x8008fa24` lw $v1, 0x64($s0) / fightstg.s:13157
   * `.L0x8008fa2c` addu $v0, $v1), so it defaults to this pass's own damage.
   */
  accumulatedTotal?: number;
  /** `ctx+0x30`, the hit flag the accuracy leaves write. */
  landed: boolean;
  /** `ctx+0x41`, set once the applier has run. */
  applied: boolean;
  /** `ctx+0x3e`, the retaliation flag. */
  retaliated: boolean;
  /** `ctx+0x42`, set when this pass must not build a page. */
  suppressed: boolean;
  /**
   * `[0x800a4460 + 8 + side * 4]`, the side's ACTIVE combatant index in `0..2` — the
   * record `lui $v0, 0x800a / addiu $v1, 0x4460 / lw $a1, 0x8($v0)` reads (fightstg.s:13560
   * `.L0x80090078` / :13564 `.L0x80090088`, and again at :13379 `.L0x800fd9c` /
   * :13380 `.L0x800fda0` on the cure window). It is the slot the heal and the single cure
   * act on, and the slot the even half of the cure window tests. Defaults to 0, which is
   * what the word is on a battle nobody has switched a partner in.
   */
  activeSlot?: number;
}

/** The words and runtime reads the category-4 and category-5 arms take from elsewhere. */
export interface DamageTermOptions {
  /**
   * The acting Digimon's WISDOM — the effective stat block's fourth core stat,
   * `lh $v0, 0x4588($a0)` at fightstg.s:30540 `.L0x800a0164` — which the heal getter
   * `FIGHTSTG_F0x800a0108` multiplies by the record's power. Only the heal arms read it.
   */
  wisdom?: number;
  /**
   * For a heal: `max_hp - cur_hp` at the target (fightstg.s:13624 `.L0x80090178` addiu $a3, 0x1 / fightstg.s:13625 `.L0x8009017c` slti $v0, $a3, 0x3 /
   * fightstg.s:13627 `.L0x80090184` addiu $a0, 0x20, in the party apply loop; the
   * single-record apply at :13671 `subu $v1, $v0` reads the same pair). The original
   * compares the technique's own heal amount against it, and
   * that comparison is the whole arm.
   */
  missingHp?: number;
  /**
   * The three arms that ROLL before they speak (211, 212 and 391). True is the roll
   * landing: `(rand & 0x7f) < record[+0x0B]` (see {@link DAMAGE_TERM_ROLL_FLEE}), and
   * the threshold byte is `record.f8`.
   */
  rollLanded?: boolean;
  /** The same roll for 391, whose getter `FIGHTSTG_F0x800a13c0` first compares the
   * acting fighter's `+0x10` against the eight halfwords at `0x8003ef5c` and answers
   * zero without rolling when one of them matches (fightstg.s:31780-:31808). */
  rollStatusLanded?: boolean;
  /** The side the stat arm lands on, when the caller's `ctx.side` is the ACTING side and
   * the arm inverts it (every `dir < 0` row of the stat table). */
  targetSide?: number;
  /** The slot the arm names in payload word 2 — the target side's own active index. */
  activeSlot?: number;
  /**
   * The one-stat arm's per-encounter gate refused it, so the page is the refusal
   * (`li $v0, 0x2f` at fightstg.s:13748 through kind 1) instead of the stat word.
   */
  refused?: boolean;
  /**
   * For technique 392, the MP transfer: how much MP actually moved. The original
   * computes it at fightstg.s:13949 `.L0x8009068c` lbu $v0, 0xc($s5) / fightstg.s:13951 `.L0x80090694` mult $v1, $v0 / fightstg.s:13954 `.L0x800906a0` sra $a3, $v1, 0x7 and caps it at
   * fightstg.s:13957 `.L0x800906ac` slt $v0, $a2, $a3.
   */
  mpMoved?: number;
  /**
   * The target's ailment bitmask, the byte at `roster + 0x1c` the cure window tests
   * against `.L0x800a3434[slot]` (fightstg.s:13385 `.L0x8008fdbc` lbu $v1, 0x1c($v1) /
   * fightstg.s:13387 `.L0x8008fdc4` and $v1, $v0 / fightstg.s:13388 `.L0x8008fdc8` beqz $v1,
   * .L0x8008fe20). Zero means nothing to cure, which is what turns the even half of the
   * window into the "No effect!" refusal.
   */
  ailmentMask?: number;
  /**
   * For techniques 187 and 188, the largest amount by which any of the three slots is
   * already over full — `subu $v1, $v0, $v1` over `roster + 0x06` minus `roster + 0x08`
   * (fightstg.s:13538 `.L0x80090020` / fightstg.s:13551 `.L0x80090054` slt $v0, $v1, $a2).
   * Zero means nobody is over full, and `beqz $a2` (fightstg.s:13547 `.L0x80090044`) builds
   * no page at all.
   */
  overhealGap?: number;
}

/**
 * The category-4 arms.
 *
 * `0x8008fbec` reads the SIDE into payload word 0 (fightstg.s:13269 `.L0x8008fbec: lbu $v0,
 * 0x50($s4)` / :13271 `sw $v0, 0x64($s4)`), loads the technique id at :13270, and then tests
 * that id FIVE ways before it looks at anything else. Every category-4 technique on the disc
 * falls through exactly one of them, and these are the only five comparisons in the routine:
 *
 * ```
 * fightstg.s:13272 .L0x8008fbf8: slti $v0, $v1, 0xc6      # is the id >= 198?
 * fightstg.s:13273 .L0x8008fbfc: beqz $v0, .L0x8008fc24  #   yes -> the 375 test
 * fightstg.s:13274 .L0x8008fc00: slti $v0, $v1, 0xbe      # is it >= 190?
 * fightstg.s:13275 .L0x8008fc04: beqz $v0, .L0x8008fca8  #   yes -> the cure window
 * fightstg.s:13276 .L0x8008fc08: li $v0, 0x64             # 100
 * fightstg.s:13277 .L0x8008fc0c: beq $v1, $v0, .L0x8008fe94
 * fightstg.s:13278 .L0x8008fc10: li $v0, 0xbd             # 189
 * fightstg.s:13279 .L0x8008fc14: beq $v1, $v0, .L0x8008fc38
 * fightstg.s:13280 .L0x8008fc18: lui $v0, 0x800a
 * fightstg.s:13281 .L0x8008fc1c: j  .L0x8008ff90           # 184..188 and every other id
 * fightstg.s:13283 .L0x8008fc24: li $v0, 0x177            # 375, on the >= 198 path
 * fightstg.s:13284 .L0x8008fc28: beq $v1, $v0, .L0x8008ff10
 * fightstg.s:13286 .L0x8008fc30: j  .L0x8008ff90
 * ```
 *
 * This is the whole classifier, and `lui $v0, 0x800a` at :13280 and :13285 is what makes
 * `$s1` come out right on the heal arm's enemy path (:13505 reads `$v0`). `damageTermPage`
 * and `category4RestorePlan` both read `damageTermCategory4Arm`, so the page and the effect
 * can never pick different arms for the same id.
 */
export type DamageTermCategory4ArmName =
  /** `.L0x8008fe94` — technique 100, a fallen party member brought back to full HP. */
  | "restoreFallen"
  /** `.L0x8008fc38` — technique 189, the gradual-HP-recovery status. */
  | "regen"
  /** `.L0x8008fca8` — 190..197, the cure window. */
  | "cureWindow"
  /** `.L0x8008ff10` — technique 375, full HP and every ailment cleared. */
  | "bestCondition"
  /** `.L0x8008ff90` -> `.L0x80090070` — 184..186, the acting Digimon's own heal. */
  | "healActive"
  /** `.L0x8008ff90` -> `.L0x8008fff8` — 187..188, the three-slot party heal. */
  | "healParty";

export interface DamageTermCategory4Arm {
  /** The arm's address in the overlay. */
  arm: number;
  /** Which of the six arms this id lands on. */
  name: DamageTermCategory4ArmName;
  /**
   * For the cure window, the table slot `0..3` the eight-word table at `.L0x8008301c`
   * gives for `id - 190`: `0x8008fcdc` twice, `0x8008fce4` twice, `0x8008fcec` twice and
   * `0x8008fcf4` twice, so the pairs (190,191) (192,193) (194,195) (196,197) share it.
   * `null` for the other arms.
   */
  cureSlot: number | null;
  /**
   * `andi $v0, 0x1` over the technique id (fightstg.s:13353 `.L0x8008fd3c`), the odd half
   * of the cure window. Its page is kind 9 with a scan index in word 1; the even half's
   * page is kind 2 (or kind 1).
   */
  oddHalf: boolean;
  /**
   * `slti $v1, 0xbb` (fightstg.s:13523 `.L0x8008ffe4`): the three-slot party heal. Only
   * 187 and 188 have it true.
   */
  partyHeal: boolean;
  /**
   * Which side's records the arm acts on. `0` for 100 and 375 because those two arms
   * write `sw $zr, 0x64($s4)` into payload word 0 (fightstg.s:13448 `.L0x8008ff38` /
   * :13457 `.L0x8008ff40`) and walk `0x800a4470` directly
   * (fightstg.s:13443 `.L0x8008fea4` `addiu $a0, $v0, 0x4470`), so they restore the
   * PLAYER's party whichever side cast them.
   */
  side: number;
}

/**
 * The one classifier for the category-4 handler's arms.
 *
 * Returns null for a technique that is not a category-4 member, so a caller can use it as
 * the gate.
 */
export function damageTermCategory4Arm(
  techniqueId: number,
  side = 0,
): DamageTermCategory4Arm | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  const acting = (Math.trunc(Number(side)) | 0) < 1 ? 0 : 1;
  if (id === 100) {
    return { arm: 0x8008fe94, name: "restoreFallen", cureSlot: null, oddHalf: false, partyHeal: false, side: 0 };
  }
  if (id === 189) {
    return { arm: 0x8008fc38, name: "regen", cureSlot: null, oddHalf: false, partyHeal: false, side: acting };
  }
  if (id >= 190 && id <= 197) {
    return {
      arm: 0x8008fca8, name: "cureWindow", cureSlot: ((id - 190) / 2) | 0,
      oddHalf: (id % 2) === 1, partyHeal: false, side: acting,
    };
  }
  if (id === 375) {
    return { arm: 0x8008ff10, name: "bestCondition", cureSlot: null, oddHalf: false, partyHeal: false, side: 0 };
  }
  const partyHeal = id === 187 || id === 188;
  return {
    arm: 0x8008ff90, name: partyHeal ? "healParty" : "healActive",
    cureSlot: null, oddHalf: false, partyHeal, side: acting,
  };
}

/**
 * The ten-page table `FIGHTSTG_F0x80099140` dispatches on (`.L0x80083164`, :291-:300):
 * the `esmfight` word it writes into LINE TWO for payload word 1 = 0..9.
 *
 * Read at `li $a2, 0x22` (fightstg.s:23212) for 0, `li $a2, 0x28` (:23242) for 1,
 * `li $a2, 0x29` (:23254) for 2, `li $a2, 0x2a` (:23266) for 3, `li $a2, 0x2c` (:23278)
 * for 4, `li $a2, 0x2d` (:23290) for 5, `li $a2, 0x2e` (:23302) for 6, `li $a2, 0x30`
 * (:23314) for 7, `li $a2, 0x31` (:23326) for 8 and `li $a2, 0x32` (:23336) for 9.
 */
export const DAMAGE_TERM_KIND9_EFFECT_WORDS: readonly number[] = Object.freeze([
  0x22, 0x28, 0x29, 0x2a, 0x2c, 0x2d, 0x2e, 0x30, 0x31, 0x32,
]);

/**
 * One of the side's three combatant records — `0x800a4470 + side * 0x60 + index * 0x20` in
 * the original, and one party member in the walker.
 *
 * The offsets are read all over the category-4 handler and its cure helper:
 * `lh 0x00` is "this slot holds a Digimon", `lh 0x06` is the MAXIMUM HP, `lh 0x08` is the
 * CURRENT HP and `lbu 0x1c` is the ailment bitmask (0x01 poison, 0x02 frozen, 0x04
 * confused, 0x08 asleep). `+0x06` as the maximum is settled by the heal the arm then
 * applies: fightstg.s:13645 `.L0x800901cc` `lhu $v0, 0x6($a1)` (the maximum, held at by
 * `slt $v1, $v0` :13643 / `bnez $v1, .L0x800901e4` :13646) and :13652 `.L0x800901e8`
 * `sh $v0, 0x8($a1)`.
 */
export interface Category4Slot {
  /** `lh 0x00` — the slot holds a Digimon. */
  present: boolean;
  /** `lh 0x08` — current HP. Zero means unconscious. */
  hp: number;
  /** `lh 0x06` — maximum HP. */
  maxHp: number;
  /** `lbu 0x1c` — the ailment bitmask. */
  ailments: number;
}

/**
 * The ten-row CANDIDATE SCAN table `.L0x8008313c` (:281-:290) that
 * `FIGHTSTG_F0x80098de0` dispatches on. Every row walks the side's three 0x20-stride
 * combatant records and records payload word 1 into `self+0x9c[count]` for each record
 * that passes; the apply pass then visits that list.
 *
 * **`payload[1] < 10` takes the table; `>= 10` takes the plain walk.**
 * fightstg.s:22848 `.L0x80098e08` `sltiu $v0, $a1, 0xa` is the ordinary three-operand form
 * (`$a1 < 10`), and :22849 `.L0x80098e0c` `beqz $v0, .L0x80098e30` jumps on `0`, i.e. on
 * `$a1 >= 10`. So index 0 — which is what 187 and 188 write into word 1 — is
 * `.L0x8008313c: .word 0x80098e30` (:281), the same plain walk, reached through the table
 * rather than by falling into it.
 *
 * Every row skips a record whose first halfword (`lh $v0, ($a2)`) is 0 — the slot holds
 * no Digimon — and the rows that want a living fighter also skip `lh 0x8($a2) == 0`.
 */
export const DAMAGE_TERM_KIND9_SCAN_TESTS: ReadonlyArray<(slot: Category4Slot) => boolean> =
  Object.freeze([
    // 0 — `.L0x80098e30`: present, alive, and hurt (:22859 `lh $v0, ($a2)` /
    // :22863 `lh $v1, 0x8($a2)` / :22867 `lh $v0, 0x6($a2)` / :22869 `slt $v0, $v1, $v0`
    // — the ordinary three-operand form, `current < maximum`).
    (s) => s.present && s.hp !== 0 && s.hp < s.maxHp,
    // 1 — `.L0x80098e9c`: present (:22889/:22891), alive (:22893/:22895) and poisoned
    // (:22897 `lbu $v0, 0x1c($a2)` / :22899 `andi $v0, 0x1` / :22900 `beqz`).
    (s) => s.present && s.hp !== 0 && (s.ailments & 0x01) !== 0,
    // 2 — `.L0x80098f08`: present (:22919/:22921), alive (:22923/:22925) and frozen
    // (:22927 `lbu $v0, 0x1c($a2)` / :22929 `andi $v0, 0x2` / :22930 `beqz`).
    (s) => s.present && s.hp !== 0 && (s.ailments & 0x02) !== 0,
    // 3 — `.L0x80098f74`: present (:22949/:22951), alive (:22953/:22955) and confused
    // (:22957 `lbu $v0, 0x1c($a2)` / :22959 `andi $v0, 0x4` / :22960 `beqz`).
    (s) => s.present && s.hp !== 0 && (s.ailments & 0x04) !== 0,
    // 4 — `.L0x80098fe0`: present (:22979/:22981), alive (:22983/:22985) and carrying ANY
    // ailment (:22987 `lbu $v0, 0x1c($a2)` / :22989 `beqz $v0`), so the whole byte, not a bit.
    (s) => s.present && s.hp !== 0 && s.ailments !== 0,
    // 5 — `.L0x80099048`: present (:23008/:23010) and NOT alive — `bnez $v0` :23014 SKIPS a
    // record whose current HP is non-zero (:23012 `lh $v0, 0x8($a2)`), so this is the fallen scan.
    (s) => s.present && s.hp === 0,
    // 6 — `.L0x800990a0`: present (:23033/:23035) and nothing else — not even current HP.
    (s) => s.present,
    // 7, 8 and 9 — `.L0x800990e8`: present (:23054/:23056) and alive (:23058/:23060).
    (s) => s.present && s.hp !== 0,
    (s) => s.present && s.hp !== 0,
    (s) => s.present && s.hp !== 0,
  ] as ReadonlyArray<(slot: Category4Slot) => boolean>);

/** What one category-4 arm does, per slot, and the page it asks for. */
export interface Category4Restore {
  /** The arm the original's own id tests selected. */
  arm: DamageTermCategory4Arm;
  /** Whose records the plan acts on — `arm.side`. */
  side: number;
  /** HP added to each slot index. 0 means the arm does not touch that slot's HP. */
  heal: number[];
  /** Ailment bits CLEARED from each slot index. 0 means none. */
  cure: number[];
  /** True where the arm SETS the slot's HP to its maximum. */
  fullRestore: boolean[];
  /** True where the arm turns the gradual-HP-recovery status on (technique 189). */
  regen: boolean;
  /**
   * True where the arm found at least one record to act on. The odd half of the cure
   * window and 187/188 build NO page when this is false.
   */
  acted: boolean;
  /** The page the record machine asks for, or null when it asks for none. */
  page: BattleMessagePage | null;
}

/**
 * Build the kind-9 page the restore arms ask for, carrying the ring words the original
 * wrote. fightstg.s:23642 `.L0x80099a04` hands `$a2` — the three payload words — to
 * `FIGHTSTG_F0x80098de0` (:23643, the candidate scan) and to `FIGHTSTG_F0x80099140`
 * (:23647, the apply pass), so the words ARE the page's payload and the walker's page
 * carries them verbatim.
 *
 * WHAT THE BOX DRAWS IS NOT SETTLED HERE, and is deliberately not changed by this port.
 * `FIGHTSTG_F0x80099140`'s last act is a ten-row dispatch on payload word 1
 * (fightstg.s:23186 `sltiu $v0, $s7, 0xa` / :23189-23190 the table at `.L0x80083164`
 * (:291-:300)) whose rows set LINE TWO's own text to `esmfight[0x22]`, `[0x28]`, `[0x29]`,
 * `[0x2a]`, `[0x2c]`, `[0x2d]`, `[0x2e]`, `[0x30]`, `[0x31]`, `[0x32]` (:23208, :23225,
 * :23237, :23249, :23261, :23273, :23285, :23297, :23309, :23320) — index 0 alone also
 * writes payload word 2 into it as a number (:23210 `lw $a2, 0x8($s8)`). But the arm then
 * lands on `.L0x8009a204` (:23649), which calls the same line method at `+0x144` with
 * `$a1 = 0` on BOTH line objects (:24156/:24159 and :24162/:24165). Whether that method
 * clears the lines or merely commits them is the message-page system's own question, and
 * `docs/research/battle/battle-message-page-kinds-2026-10-04.md` §3 and §9.4 have already
 * read it as hiding both lines. This port therefore changes nothing about what the walker
 * draws for kind 9; it only makes the payload carry the words the original wrote.
 */
function category4Kind9Page(side: number, index: number, amount: number): BattleMessagePage | null {
  return battleMessagePage(9, { name: null, words: [side, index, amount] });
}

/** Three empty slots, so a caller with no party still gets a well-formed plan. */
function category4EmptySlots(n: number): Category4Slot[] {
  return Array.from({ length: n }, () => ({ present: false, hp: 0, maxHp: 0, ailments: 0 }));
}

/**
 * What one category-4 technique does to a side's party, and the page the record machine
 * asks for. This is the port of the whole handler `0x8008fbec`, not of one arm.
 *
 * `sides` is keyed by side: `sides[0]` is the player's three records in the original's
 * `0x800a4470` order and `sides[1]` the enemy's `0x800a44d0` order. A side the caller does
 * not model reads as three empty slots, which is exactly what the original's walk does
 * when a slot holds no Digimon.
 */
export function category4RestorePlan(
  record: Partial<DamageTermRecord> | null | undefined,
  techniqueId: number,
  ctx: {
    side?: number; wisdom?: number; activeSlot?: number; name?: string | null;
    /** `FIGHTSTG_F0x800a0108`'s return value, for the two heal arms. */
    healAmount?: number;
  } = {},
  sides: Readonly<Record<number, readonly Category4Slot[]>> = {},
): Category4Restore | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  // The gate is the record's own category byte, exactly the byte the five-word table at
  // `.L0x80083004` is indexed by (fightstg.s:13111 `.L0x8008f974` `lbu $v0, 0x4($s5)`).
  if ((Math.trunc(Number(record?.category ?? 0)) | 0) !== 4) return null;
  const arm = damageTermCategory4Arm(id, ctx.side ?? 0);
  if (!arm) return null;
  const active = Math.max(0, Math.trunc(Number(ctx.activeSlot ?? 0)) | 0);
  const raw = sides[arm.side];
  const slots = raw && raw.length ? raw : category4EmptySlots(3);
  const n = Math.max(3, slots.length);
  const plan: Category4Restore = {
    arm, side: arm.side,
    heal: Array.from({ length: n }, () => 0),
    cure: Array.from({ length: n }, () => 0),
    fullRestore: Array.from({ length: n }, () => false),
    regen: false, acted: false, page: null,
  };
  const empty: Category4Slot = { present: false, hp: 0, maxHp: 0, ailments: 0 };
  const at = (i: number): Category4Slot => slots[i] ?? empty;
  const missing = (s: Category4Slot) => Math.max(0, (s.maxHp | 0) - (s.hp | 0));

  switch (arm.name) {
    case "restoreFallen": {
      // `.L0x8008fe94` step 0 builds the page — `j .L0x8008ff38` :13450 with `li $v0, 0x5`
      // in its delay slot (:13451 `.L0x8008fec4`), then `sw $zr, 0x64($s4)` :13480 /
      // `sw $v0, 0x68($s4)` :13481 / `li $a1, 0x9` :13483 — and step 1 (:13452
      // `.L0x8008fec8`) walks the three SIDE-0 records (`addiu $a0, $v0, 0x4470` :13443 is
      // the delay slot that makes it side 0 whatever cast it): an empty slot is skipped
      // (`lh $v0, ($s0)` :13453 / `beqz` :13455), one already at non-zero current HP is
      // skipped (`lh $v0, 0x8($s0)` :13457 / `bnez` :13459), and the rest get the maximum
      // from `+0x06` (`lhu` :13461) into `+0x08` (`sh` :13463, that store is the delay slot
      // of the `jal 0x800a6920` at :13462).
      for (let i = 0; i < n; i++) {
        const s = at(i);
        if (s.present && s.hp === 0) { plan.fullRestore[i] = true; plan.acted = true; }
      }
      plan.page = category4Kind9Page(0, 5, 0);
      break;
    }
    case "bestCondition": {
      // `.L0x8008ff10` step 0 builds the page — `li $v0, 0x6` :13479 `.L0x8008ff34`, then
      // `sw $zr, 0x64($s4)` :13480 / `sw $v0, 0x68($s4)` :13481 / `li $a1, 0x9` :13483 —
      // and step 1 (:13474 `beq $v1, $v0, .L0x8008ff6c`) is `FIGHTSTG_F0x8008f5d4` called
      // three times with slot index 0, 1, 2 (`li $a0, 0x177` :13493 / `jal` :13494 with
      // `move_ $a1, $s0` :13495 in its delay slot / `addiu $s0, 0x1` :13496 /
      // `slti $v0, $s0, 0x3` :13497). That helper skips an empty slot (`lh $v0, ($v0)`
      // :12896 / `beqz` :12898), zeroes the whole ailment byte (`sb $zr, 0x1c($s0)` :12933)
      // and sets `+0x08` from `+0x06` (`lhu $v0, 0x6($s0)` :12931 / `sh $v0, 0x8($s0)`
      // :12934). Its six status-event cancellations read `.L0x800a3438` = [9, 10, 11, 12,
      // 16, 17] a WORD at a time (`addiu $s0, 0x3438` :12904 / `lw $a0, ($s0)` :12906 /
      // `addiu $s0, 0x4` :12921 / `slti $v0, $s1, 0x6` :12919) and touch no party field.
      for (let i = 0; i < n; i++) {
        const s = at(i);
        if (!s.present) continue;
        plan.fullRestore[i] = true;
        plan.cure[i] = 0xff;
        plan.acted = true;
      }
      plan.page = category4Kind9Page(0, 6, 0);
      break;
    }
    case "regen": {
      // `.L0x8008fc38`: `FIGHTSTG_F0x8009c5e8(side)` (:13288 `lbu $a0, 0x50($s4)` /
      // :13289 `jal`) stages a status event carrying the technique id 189
      // (`li $v0, 0xbd` :26602 / `sw $v0, 0x10($a0)` :26603) aimed at the ACTIVE slot
      // (`lw $v1, 0x8($v0)` :26601 / `sw $v1, 0xc($a0)` :26605), and
      // `FIGHTSTG_F0x8009c6a4(roster, 189)` (:13299 `jal`) stages event code 6
      // (`li $a0, 0x6` :26622), so the HP itself arrives on the status-event queue rather
      // than in this arm. The page is `li $v0, 0x27` into word 0 (:13305) and the SIDE into
      // word 1 (:13307), kind 2 (:13309 `.L0x8008fc8c`).
      if (at(active).present) plan.regen = true;
      plan.page = battleMessagePage(2, {
        name: ctx.name ?? null, index: DAMAGE_TERM_REGEN_WORD,
      });
      break;
    }
    case "cureWindow": {
      const slot = arm.cureSlot ?? 0;
      const mask = DAMAGE_TERM_CURE_MASKS[slot] ?? 0;
      const bit = DAMAGE_TERM_CURE_BITS[slot] ?? 0;
      if (arm.oddHalf) {
        // The odd half (`andi $v0, 0x1` :13353 `.L0x8008fd3c` / `beqz` :13354): payload
        // word 0 is the SIDE (`lbu $v0, 0x50($s4)` :13356 / `sw $v0, 0x64($s4)` :13358) and
        // word 1 is `.L0x800a3450[slot]` = [1, 2, 3, 4] (:33888-:33891, addressed at
        // :13357-:13363), and the page is **kind 9** (`li $a1, 0x9` :13365 `.L0x8008fd6c`).
        // It then writes step 1 (`li $v0, 0x1` :13370 / `sw $v0, 0x14($s4)` :13371) and
        // phase 3 (`li $v0, 0x3` :13372 / `sw $v0, 0x18($s4)` :13374) and leaves through
        // `.L0x80090c1c`, which is this routine's epilogue — so the cure NEVER runs
        // `FIGHTSTG_F0x8009c330`. It is the kind-9 page's own scan instead: payload word 1
        // picks row `slot + 1` of `.L0x8008313c` (DAMAGE_TERM_KIND9_SCAN_TESTS) and its
        // apply pass visits that list.
        const test = DAMAGE_TERM_KIND9_SCAN_TESTS[slot + 1];
        for (let i = 0; i < n; i++) {
          if (test && test(at(i))) { plan.cure[i] = bit; plan.acted = true; }
        }
        plan.page = category4Kind9Page(arm.side, slot + 1, 0);
        break;
      }
      // The even half (.L0x8008fd94 :13375): the PAGE tests the ACTIVE record's ailment
      // byte against `.L0x800a3434[slot]` (the active index is `lw $v1, 0x8($v0)` :13378;
      // the mask is `lbu $v0, ($v0)` :13382, the byte `lbu $v1, 0x1c($v1)` :13385, and
      // `and $v1, $v0` :13387) — a match asks kind 2 with `.L0x800a3460[slot]`
      // (:33892-:33895, read at :13390-:13393, `li $a1, 0x2` :13401), a miss falls to
      // `beqz $v1, .L0x8008fe20` :13388 and asks kind 1 with `li $v0, 0x2f` :13410 /
      // `li $a1, 0x1` :13413.
      //
      // THE CURE RUNS WHATEVER THE PAGE SAID. Step 1 (.L0x8008fe48 :13420) is a separate
      // step from the page — the arm returns through `.L0x80090c1c` (:13408/:13418) and is
      // re-entered with `lw $v1, 0x14($s4)` == 1 to reach :13446 `beq $v1, $v0,
      // .L0x8008fe48` — so a page that refuses for the ACTIVE record still cures every
      // other member of the side. `FIGHTSTG_F0x8009c330` runs on slot indices 0, 1 and 2
      // (:13433 `addiu $s0, 0x1` / :13434 `slt $v0, $s0, $v0` / :13430 `jalr $v0`) and skips
      // only a record whose first halfword is 0 (fightstg.s:26413 `lh $v0, ($a2)` /
      // :26415 `beqz $v0, .L0x8009c49c`) — it does NOT test current HP, unlike the odd
      // half's page scan — and its `nor $v0, $zr, $v0` :26421 / `and $v1, $v0` :26422 makes
      // clearing an absent bit a no-op, so only the records that carry it are listed here.
      for (let i = 0; i < n; i++) {
        const s = at(i);
        if (s.present && (s.ailments & bit) !== 0) { plan.cure[i] = bit; plan.acted = true; }
      }
      if ((at(active).ailments & mask) !== 0) {
        plan.page = battleMessagePage(2, {
          name: ctx.name ?? null, index: DAMAGE_TERM_CURE_WORDS[slot] ?? 0,
        });
      } else {
        // `beqz $v1, .L0x8008fe20` :13388 writes `li $v0, 0x2f` into word 0 (:13410)
        // and asks kind 1 (`li $a1, 0x1` :13413) — the page alone, never the cure.
        plan.page = battleMessagePage(1, { index: DAMAGE_TERM_NO_EFFECT_WORD });
      }
      break;
    }
    default: {
      // `.L0x8008ff90`: `[0x800a4614](side, id)` (fightstg.s:13513-13518) gives the amount,
      // `sw $a0, 0x5c($s4)` stores it (:13525 `.L0x8008ffec`) and `slti $v1, 0xbb`
      // (:13523 `.L0x8008ffe4`) splits the arm.
      const amount = ctx.healAmount !== undefined
        ? (Math.trunc(Number(ctx.healAmount)) | 0)
        : damageTermHealAmount(Number(record?.power ?? 0), Number(ctx.wisdom ?? 0));
      if (arm.partyHeal) {
        // 187/188: `.L0x8008fff8` walks the side's three records (skipping an empty slot,
        // `beqz $v0, .L0x80090034` :13530, and a fallen one, `beqz $v1, .L0x80090034`
        // :13534) and keeps the LARGEST `max - current` (`lh 0x6` :13536 / `subu` :13538 /
        // `slt $v0, $a2, $v1` :13539 / `move_ $a2, $v1` :13542); word 1 is zeroed (:13555) and
        // word 2 takes the capped amount (:13557), with kind 9 (`li $s0, 0x9` :13553).
        // `$a2` accumulates the GAP (`subu $v1, $v0, $v1` :13538, guarded by `slt $v0, $a2,
        // $v1` :13539 so only a slot that is actually missing something can raise it), and
        // never the amount that will be added. So the walker must keep the gap and the
        // addition apart.
        let largestGap = 0;
        for (let i = 0; i < n; i++) {
          const s = at(i);
          if (!s.present || s.hp === 0) continue;
          const gap = missing(s);
          plan.heal[i] = Math.min(amount, gap);
          if (gap > largestGap) largestGap = gap;
        }
        // `beqz $a2, .L0x800900d4` (:13547) tests the LARGEST GAP, not how many records.
        plan.acted = largestGap > 0;
        // A DELAY SLOT RUNS WHATEVER THE BRANCH DOES. `li $s0, 0x9` (:13553 `.L0x8009005c`)
        // is the delay slot of `beqz $v0, .L0x80090064` (:13552), so the kind-9 page is
        // asked for whenever a gap exists; what the branch at :13552 decides is only
        // `move_ $a2, $v1` (:13554), which puts the RAW amount (`lw $v1, 0x5c($s4)` :13549)
        // into `$a2` when it is strictly below the largest gap (`slt $v0, $v1, $a2` :13551)
        // and leaves the GAP there otherwise. Word 2 is that `$a2` either way — the
        // `sw $a2, 0x6c($s4)` (:13557) is the delay slot of the shared `j .L0x800900d4`
        // (:13556) — so the page's number is min(raw amount, largest gap), never the raw
        // amount on its own. With NO gap at all the arm jumps straight past the page build
        // and `$s0` keeps the -1 its own delay slot loaded (:13519 `li $s0, -0x1`), so the
        // shared tail asks kind 2 with `esmfight[0x2f]` (:13654 / :13658) — "No effect!".
        if (largestGap <= 0) {
          plan.page = battleMessagePage(2, { name: ctx.name ?? null, index: DAMAGE_TERM_NO_EFFECT_WORD });
        } else {
          plan.page = category4Kind9Page(arm.side, 0, Math.min(amount, largestGap));
        }
        break;
      }
      // 184..186: `.L0x80090070` reads the ACTIVE record (`0x800a4460 + 4*side`'s word 8
      // :13564, `sll $v0, $a1, 0x5` :13566) and caps the amount at its `max - current`
      // (`lh 0x6` :13568 / `lh 0x8` :13569 / `subu` :13571 / `slt $v0, $a2, $v1` :13572 /
      // `move_ $a2, $v1` :13575), then caps it again at the amount (`slt $v0, $a0, $a2`
      // :13577 / `move_ $a2, $a0` :13580); word 1 takes the capped amount (:13582) and the
      // page is **kind 8** (`li $s0, 0x8` :13579).
      //
      // THE SAME DELAY-SLOT RULE. `li $s0, 0x8` (:13579 `.L0x800900c4`) is the delay slot
      // of `beqz $v0, .L0x800900cc` (:13578), so it RUNS UNCONDITIONALLY: a heal at least
      // as big as the missing HP still asks kind 8, and what `slt $v0, $a0, $a2` (:13577)
      // decides is only `move_ $a2, $a0` (:13580) — the RAW amount into `$a2` when it is
      // strictly below the missing HP, the missing HP otherwise. Both land in
      // `sw $a2, 0x5c($s4)` (:13581, the amount the apply adds) and `sw $a2, 0x68($s4)`
      // (:13582, the page's number), so the page shows min(raw amount, missing HP). A
      // 2026-10-04 reading of this arm claimed `li $s0, 0x8` could be "skipped" by its
      // branch and that a big heal answers "No effect!"; a MIPS delay slot is executed
      // whether or not the branch is taken, so that reading is wrong.
      //
      // The only way this arm reaches the kind-2 "No effect!" page is
      // `beqz $a2, .L0x800900d4` (:13576) — nothing missing at all. The apply at
      // :13630-:13652 always runs and adds `0x5c($s4)` (`:13637 lw $a0, 0x5c($s4)` /
      // :13648 `lhu $v0, 0x5c($s4)`), holding the result at the maximum from `+0x06`
      // (:13645 / :13646), so a full Digimon stays full whatever word the page carries.
      const target = at(active);
      const gap = target.present ? Math.max(0, missing(target)) : 0;
      const capped = Math.min(amount, gap);
      if (capped > 0) { plan.heal[active] = capped; plan.acted = true; }
      if (gap <= 0) {
        plan.page = battleMessagePage(2, { name: ctx.name ?? null, index: DAMAGE_TERM_NO_EFFECT_WORD });
        break;
      }
      // The heal's word 0 is the raw SIDE (`lbu $v0, 0x50($s4)` :13586 / `sw $v0, 0x64($s4)`
      // :13588), not the 0/16 selector, so the shared tail names the healer on both sides.
      plan.page = withPayloadWord(
        battleMessagePage(8, { name: ctx.name ?? null, numbers: [capped] }),
        0, arm.side,
      );
      break;
    }
  }
  return plan;
}

/**
 * One arm of the category-4 or category-5 handler: which technique ids land on it,
 * where it lives, and what page it can put up.
 */
export interface DamageTermArm {
  /** The arm's address in the overlay. */
  arm: number;
  /** The technique ids whose comparison reaches this arm. */
  ids: readonly number[];
  /** The page kind this arm can ask for, or null when it asks for none. */
  kind: number | null;
  /** What a player reads, in the words of the shipped English bank. */
  reads: string;
}

/**
 * The category-4 arms. `0x8008fbec` tests the technique id five ways before it looks at
 * anything else (fightstg.s:13272 `.L0x8008fbf8` slti $v0, $v1, 0xc6 / :13274 `.L0x8008fc00`
 * slti $v0, $v1, 0xbe / :13276 `.L0x8008fc08` li $v0, 0x64 / :13278 `.L0x8008fc10` li $v0, 0xbd /
 * :13283 `.L0x8008fc24` li $v0, 0x177), and the 190..197 window goes through the eight-word
 * table at `.L0x8008301c` (:209-:216).
 */
export const DAMAGE_TERM_ARMS_CATEGORY4: readonly DamageTermArm[] = Object.freeze([
  {
    arm: 0x8008fe94, ids: [100], kind: 9,
    reads: "nothing in the box — kind 9, word 0 = 0 (`sw $zr, 0x64($s4)` at :13480 " +
      "`.L0x8008ff38`) and word 1 = 5 (`li $v0, 0x5` at :13451 `.L0x8008fec4`, asked for at " +
      ":13483 `.L0x8008ff44`), whose LINE TWO is `esmfight[0x2d]` 'Restored!' (:23273). " +
      "Step 1 (:13452 `.L0x8008fec8`) gives every SIDE-0 record whose current HP is 0 its " +
      "own maximum back — `addiu $a0, $v0, 0x4470` :13443 is what hard-codes the side — " +
      "`lh $v0, ($s0)` :13453 skips an empty slot, `bnez $v0, .L0x8008fef8` :13459 skips " +
      "one already standing, `lhu $v0, 0x6($s0)` :13461 / `sh $v0, 0x8($s0)` :13463 store " +
      "it, and `slti $v0, $s1, 0x3` :13465 / `addiu $s0, 0x20` :13467 walk three slots",
  },
  {
    arm: 0x8008fc38, ids: [189], kind: 2,
    reads: '"HP gradually recovers." — esmfight[0x27] (`li $v0, 0x27` at :13305 ' +
      "`.L0x8008fc7c`, kind 2 at :13309 `.L0x8008fc8c`). The HP itself arrives on the " +
      "status-event queue, not in this arm: `FIGHTSTG_F0x8009c5e8(side)` :13289 stages an " +
      "event whose technique field is 189 (`li $v0, 0xbd` :26602 / `sw $v0, 0x10($a0)` " +
      ":26603) aimed at the ACTIVE slot (`lw $v1, 0x8($v0)` :26601), and " +
      "`FIGHTSTG_F0x8009c6a4(roster, 189)` :13299 stages event code 6 (`li $a0, 0x6` :26622)",
  },
  {
    arm: 0x8008fca8, ids: [191, 193, 195, 197], kind: 9,
    reads: "nothing in the box — kind 9 (`li $a1, 0x9` at :13365 `.L0x8008fd6c`), word 0 = " +
      "the side (`lbu $v0, 0x50($s4)` :13356 / `sw $v0, 0x64($s4)` :13358) and word 1 = " +
      "`.L0x800a3450[slot]` = [1, 2, 3, 4] (:33888-:33891, read at :13359-:13363), so LINE " +
      "TWO reads 'Cured!' / 'Defrost!' / 'Conscious!' / 'All status cured!' " +
      "(:23225/:23237/:23249/:23261). `andi $v0, 0x1` :13353 is the odd half; the cure is " +
      "the page's own scan over every party record of the side (see " +
      "`DAMAGE_TERM_KIND9_SCAN_TESTS`)",
  },
  {
    arm: 0x8008fca8, ids: [190, 192, 194, 196], kind: 2,
    reads: '"Cured!" / "Defrost!" / "Conscious!" / "All status cured!" — `.L0x800a3460` ' +
      "= [0x28, 0x29, 0x2a, 0x2c] (:33892-:33895, read at :13390-:13393), when the ACTIVE " +
      "record's ailment byte matches `.L0x800a3434` = [0x01, 0x02, 0x04, 0x3f] (:33881; " +
      "`lbu $v0, ($v0)` :13382 / `lbu $v1, 0x1c($v1)` :13385 / `and $v1, $v0` :13387); a " +
      "mismatch asks kind 1 with `esmfight[0x2f]` (`li $v0, 0x2f` :13410 `.L0x8008fe20` / " +
      "`li $a1, 0x1` :13413). Step 1 (:13420 `.L0x8008fe48`) is a SEPARATE step from the " +
      "page, so a page that refuses still cures every record of the side: " +
      "`FIGHTSTG_F0x8009c330` runs on slot indices 0, 1 and 2 (:13433 `addiu $s0, 0x1` / " +
      ":13434 `slt $v0, $s0, $v0`)",
  },
  {
    arm: 0x8008ff10, ids: [375], kind: 9,
    reads: "nothing in the box — kind 9 (`li $a1, 0x9` at :13483 `.L0x8008ff44`), word 0 = 0 " +
      "(`sw $zr, 0x64($s4)` :13480) and word 1 = 6 (`li $v0, 0x6` :13479 `.L0x8008ff34`), " +
      "whose LINE TWO is `esmfight[0x2e]` 'Best condition!' (:23285). Step 1 is " +
      "`FIGHTSTG_F0x8008f5d4` run on slot indices 0, 1 and 2 (:13494-:13498): it skips an " +
      "empty slot (`lh $v0, ($v0)` :12896 / `beqz` :12898), zeroes the whole ailment byte " +
      "(`sb $zr, 0x1c($s0)` :12933) and fills HP from the maximum " +
      "(`lhu $v0, 0x6($s0)` :12931 / `sh $v0, 0x8($s0)` :12934). It also cancels SIX " +
      "pending status events read a word at a time from `.L0x800a3438` (:33882-:33887, " +
      "`lw $a0, ($s0)` :12906 / `slti $v0, $s1, 0x6` :12919), which touch no party field",
  },
  {
    arm: 0x80090070, ids: [184, 185, 186], kind: 8,
    reads: '"<n>HP healed!" — esmfight[0x22], with the number CAPPED at the ACTIVE ' +
      "record's missing HP. The gap is read at :13568 `lh $v1, 0x6($v0)` (maximum) / " +
      ":13569 `lh $v0, 0x8($v0)` (current) / :13571 `subu $v1, $v0`, and `slt $v0, $a0, $a2` " +
      ":13577 puts the RAW amount into `$a2` only when it is strictly below that gap " +
      "(`move_ $a2, $a0` :13580); either way `sw $a2, 0x5c($s4)` :13581 stores the amount " +
      "the apply adds and `sw $a2, 0x68($s4)` :13582 the number the page shows, so the page " +
      "reads min(raw amount, missing HP). `li $s0, 0x8` :13579 is the DELAY SLOT of the " +
      "`beqz` at :13578, so it RUNS UNCONDITIONALLY — a 2026-10-04 reading that took it for " +
      "a conditional load, and answered 'No effect!' for a heal at least as big as the gap, " +
      "was wrong about the delay slot. The kind-2 'No effect!' page " +
      "(`li $v0, 0x2f` :13654 `.L0x800901ec` / `li $a1, 0x2` :13658) is reached only by " +
      "`beqz $a2, .L0x800900d4` :13576 — nothing missing at all",
  },
  {
    arm: 0x8008fff8, ids: [187, 188], kind: 9,
    reads: "nothing in the box — kind 9 (`li $s0, 0x9` at :13553 `.L0x8009005c`, which is the " +
      "`beqz` at :13552's delay slot and so RUNS UNCONDITIONALLY whenever a gap exists), " +
      "word 0 = the side (`sw $v0, 0x64($s4)` :13588), word 1 = 0 (`sw $zr, 0x68($s4)` " +
      ":13555) and word 2 = min(raw amount, LARGEST `max - current` over the three records), " +
      "because `slt $v0, $v1, $a2` :13551 / `move_ $a2, $v1` :13554 only chooses between the " +
      "raw amount (`lw $v1, 0x5c($s4)` :13549) and the gap before `sw $a2, 0x6c($s4)` " +
      ":13557. With nothing missing anywhere (`beqz $a2, .L0x800900d4` :13547) `$s0` keeps " +
      "the -1 loaded at :13519 and the shared tail answers kind 2 with `esmfight[0x2f]`. " +
      "The same three records are then healed (:13602-:13629), skipping an empty slot " +
      "(:13607) and a fallen one (:13611)",
  },
]);

/**
 * ONE row of the two eight-byte stat tables the category-5 handler walks.
 *
 * Each row is four halfwords and the reader uses all four:
 *
 * ```
 * fightstg.s:13720 lh $v0, 0x2($s3)     # +0x2 the DIRECTION, +1 up / -1 down
 * fightstg.s:13740 lh $v1, 0x4($s3)     # +0x4 the STAT index 0..2
 * fightstg.s:13778 lh $v0, 0x6($s3)     # +0x6 the esmfight word the page prints
 * fightstg.s:13714 bne $v0, $a0, .L0x800902fc   # +0x0 the technique id, -1 ends the walk
 * ```
 */
export interface DamageTermStatRow {
  /** The technique id in `+0x0` — the row the walk stops on. */
  id: number;
  /** `+0x2`: +1 raises the stat, -1 lowers it. It is also the sign of the magnitude. */
  direction: 1 | -1;
  /** `+0x4`: 0 attack, 1 defense, 2 speed — the three words the disc's own bank uses. */
  stat: number;
  /** `+0x6`: the `esmfight` word, 0x30..0x35. */
  word: number;
}

/**
 * `.L0x800a33cc` (:33855-:33872), the arm `.L0x800902dc`'s table: one fighter, eight rows.
 *
 * ```
 * 0x800a33cc: .word 0x000100c6   0x800a33d0: .word 0x00300000   # 198  +1  0  0x30
 * 0x800a33d4: .word 0x000100c8   0x800a33d8: .word 0x00310001   # 200  +1  1  0x31
 * 0x800a33dc: .word 0x000100ca   0x800a33e0: .word 0x00320002   # 202  +1  2  0x32
 * 0x800a33e4: .word 0xffff00cc   0x800a33e8: .word 0x00330000   # 204  -1  0  0x33
 * 0x800a33ec: .word 0xffff00cd   0x800a33f0: .word 0x00340001   # 205  -1  1  0x34
 * 0x800a33f4: .word 0xffff00ce   0x800a33f8: .word 0x00340001   # 206  -1  1  0x34
 * 0x800a33fc: .word 0xffff00cf   0x800a3400: .word 0x00350002   # 207  -1  2  0x35
 * 0x800a3404: .word 0xffff00d0   0x800a3408: .word 0x00350002   # 208  -1  2  0x35
 * 0x800a340c: .word 0x0000ffff                                  # the -1 terminator
 * ```
 */
export const DAMAGE_TERM_STAT_TABLE_ONE: readonly DamageTermStatRow[] = Object.freeze([
  { id: 198, direction: 1, stat: 0, word: 0x30 },
  { id: 200, direction: 1, stat: 1, word: 0x31 },
  { id: 202, direction: 1, stat: 2, word: 0x32 },
  { id: 204, direction: -1, stat: 0, word: 0x33 },
  { id: 205, direction: -1, stat: 1, word: 0x34 },
  { id: 206, direction: -1, stat: 1, word: 0x34 },
  { id: 207, direction: -1, stat: 2, word: 0x35 },
  { id: 208, direction: -1, stat: 2, word: 0x35 },
]);

/**
 * `.L0x800a3414` (:33873-:33882), the arm `.L0x800903f4`'s table: the acting side's whole
 * party, three rows, all `+1`.
 *
 * ```
 * 0x800a3414: .word 0x000100c7   0x800a3418: .word 0x00300000   # 199  +1  0  0x30
 * 0x800a341c: .word 0x000100c9   0x800a3420: .word 0x00310001   # 201  +1  1  0x31
 * 0x800a3424: .word 0x000100cb   0x800a3428: .word 0x00320002   # 203  +1  2  0x32
 * 0x800a342c: .word 0x0000ffff                                  # the -1 terminator
 * ```
 */
export const DAMAGE_TERM_STAT_TABLE_PARTY: readonly DamageTermStatRow[] = Object.freeze([
  { id: 199, direction: 1, stat: 0, word: 0x30 },
  { id: 201, direction: 1, stat: 1, word: 0x31 },
  { id: 203, direction: 1, stat: 2, word: 0x32 },
]);

/** Every category-5 row of both tables, in table order. */
export const DAMAGE_TERM_STAT_ROWS: readonly DamageTermStatRow[] = Object.freeze([
  ...DAMAGE_TERM_STAT_TABLE_ONE, ...DAMAGE_TERM_STAT_TABLE_PARTY,
]);

/**
 * `.L0x800a4694` — the stat index the record's `+0x10 + 2*index` reaches in the
 * effective block, read as a signed HALFWORD (`lh $v1, ($v0)` at fightstg.s:32265
 * `.L0x800a1b54`) and doubled before the `+0x2` the block's core stats start at:
 * `lhu $v0, 0x2($v1)` (:32269 `.L0x800a1b64`).
 *
 * The two words are `0x00010000` (:35080) and `0x00000004` (:35081), so the halfwords
 * are `[0, 1, 4, 0]` and the three indices the disc's tables use land on
 * `+0x02` attack, `+0x04` defense and `+0x0a` speed. The fifth halfword would read a
 * function pointer, so the table has no entry past index 3.
 */
export const DAMAGE_TERM_STAT_BLOCK_BASE: readonly number[] = Object.freeze([0, 1, 4]);

/** The record halfword the stat arms write, per stat index: `+0x10`, `+0x12`, `+0x14`. */
export const DAMAGE_TERM_STAT_RECORD_OFFSETS: readonly number[] = Object.freeze([0x10, 0x12, 0x14]);

/** The three stats the category-5 tables address, in player words. */
export const DAMAGE_TERM_STAT_NAMES: readonly string[] = Object.freeze(["str", "def", "spd"]);

/** The row a technique id reads out of the two tables, or null when it is in neither. */
export function damageTermStatRow(techniqueId: number): DamageTermStatRow | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  return DAMAGE_TERM_STAT_ROWS.find((r) => r.id === id) ?? null;
}

/**
 * The `payload[1]` the party arm writes, which is NOT the stat index.
 *
 * `.L0x800904d0` reads the row's `+0x4` and answers 8 for 1, 9 for 2, 2 for 0 and 7
 * for anything else (`li $v0, 0x8` :13849, `li $v0, 0x2` :13853, `li $v0, 0x9`
 * :13860, `li $v0, 0x7` :13859) before `sw $v0, 0x68($s4)` at :13883 `.L0x80090518`.
 */
export function damageTermPartyWord(statIndex: number): number {
  const s = Math.trunc(Number(statIndex)) | 0;
  return s === 1 ? 8 : s === 2 ? 9 : s === 0 ? 2 : 7;
}

/**
 * What one category-5 arm does, in the words a player meets.
 *
 * `target` is the rule the original applies to `lbu $v0, 0x50($s4) / srl $v0, 0x4`, the
 * acting side's own byte: `"acting"` reads it straight (the stat-UP rows and the Chi
 * arms), `"opposite"` XORs it with 1 in a branch delay slot (`xor $s2, $a0` at
 * fightstg.s:13738 `.L0x80090334`, `$a0 = 1` from :13731) and lands on the other side —
 * which is every stat-DOWN row, since a debuff's target is the far side.
 */
export type DamageTermCategory5Effect =
  /** `.L0x800902dc` — one stat, one fighter. */
  | "statOne"
  /** `.L0x800903f4` — one stat, every living slot of the acting side. */
  | "statParty"
  /** `.L0x80090528` — the charge byte in the target's record `+0x0E`. */
  | "affinity"
  /** `.L0x80090584` — the no-flee lock, after its `f8` roll. */
  | "lockFlee"
  /** `.L0x800905c8` — the no-digivolve lock, after its `f8` roll. */
  | "lockDigivolve"
  /** `.L0x80090610` — a status event on the player and NO page. */
  | "statusOnly"
  /** `.L0x80090654` — MP moved off the player's active fighter onto the enemy's. */
  | "mpDrain"
  /** `.L0x80090734` — HP restored on the enemy's active fighter, plus its charge byte. */
  | "healCharge";

/** Which side an arm's write lands on. */
export type DamageTermCategory5Target =
  /** The acting side, its own active slot. */
  | "acting"
  /** The other side, its own active slot. */
  | "opposite"
  /** The enemy's active slot whichever side cast it. */
  | "enemy"
  /** The PLAYER's active slot whichever side cast it (`lw $s1, 0x4468($v0)`). */
  | "playerActive";

/** One category-5 arm, with the write it makes and the page it asks for. */
export interface DamageTermCategory5Arm extends DamageTermArm {
  /** What the arm does to the battle's state. */
  effect: DamageTermCategory5Effect;
  /** Which side the write lands on. */
  target: DamageTermCategory5Target;
  /**
   * The side the arm's instruction stream names OUTRIGHT, for the three arms that do:
   * 391 stages its status on `0x800a4468` (`FIGHTSTG_F0x8009cff4` :27256), and 392 and
   * 400 read `0x800a446c` for the record they write (:13938, :13993). No arm tests who
   * is acting. See {@link damageTermCategory5Side} for what the walker does with a
   * side-0 caster.
   */
  fixedSide?: 0 | 1;
  /** The `esmfight` word the landing page prints, when it prints one. */
  word?: number;
  /** The page kind the arm asks for when its roll or its gate says "nothing happened". */
  blankKind?: number;
  /** The status-event code the arm stages through `FIGHTSTG_F0x8009bc94`. */
  eventCode?: number;
}

/**
 * THE CATEGORY-5 FAMILY — all eight arms of `0x8009021c`, every member of the shipped
 * 443-row table with `record +0x04 == 5`.
 *
 * The classifier is a chain of NINE comparisons on the technique id and nothing else
 * (fightstg.s:13670-:13712). Every one of them, in order:
 *
 * ```
 * 13670 .L0x80090230: slti $v0, $v1, 0xd1   # id < 209 ?
 * 13671 .L0x80090234: beqz $v0, .L0x80090280
 * 13672 .L0x80090238: slti $v0, $v1, 0xcc   # id < 204 ?
 * 13673 .L0x8009023c: beqz $v0, .L0x800902dc   #   -> the one-stat arm
 * 13674 .L0x80090240: li  $v0, 0xc8        # 200
 * 13675 .L0x80090244: beq $v1, $v0, .L0x800902dc
 * 13676 .L0x80090248: slti $v0, $v1, 0xc9
 * 13677 .L0x8009024c: beqz $v0, .L0x8009026c
 * 13678 .L0x80090250: li  $v0, 0xc6        # 198
 * 13679 .L0x80090254: beq $v1, $v0, .L0x800902dc
 * 13680 .L0x80090258: li  $v0, 0xc7        # 199
 * 13681 .L0x8009025c: beq $v1, $v0, .L0x800903f4   #   -> the party arm
 * 13683 .L0x80090264: j   .L0x8009096c     #   -> no page at all
 * 13685 .L0x8009026c: li  $v0, 0xca        # 202
 * 13686 .L0x80090270: beq $v1, $v0, .L0x800902dc
 * 13688 .L0x80090278: j   .L0x800903f8     #   -> the party arm, same body
 * 13690 .L0x80090280: li  $v0, 0xd4        # 212
 * 13691 .L0x80090284: beq $v1, $v0, .L0x800905c8
 * 13692 .L0x80090288: slti $v0, $v1, 0xd5
 * 13693 .L0x8009028c: beqz $v0, .L0x800902a4
 * 13694 .L0x80090290: slti $v0, $v1, 0xd3
 * 13695 .L0x80090294: bnez $v0, .L0x80090528  #   -> the Chi arm
 * 13696 .L0x80090298: li  $a1, 0x2
 * 13697 .L0x8009029c: j   .L0x80090584        #   -> the no-flee arm
 * 13699 .L0x800902a4: li  $v0, 0x188        # 392
 * 13700 .L0x800902a8: beq $v1, $v0, .L0x80090654
 * 13701 .L0x800902ac: slti $v0, $v1, 0x189
 * 13702 .L0x800902b0: beqz $v0, .L0x800902c8
 * 13703 .L0x800902b4: li  $v0, 0x187        # 391
 * 13704 .L0x800902b8: beq $v1, $v0, .L0x80090610
 * 13706 .L0x800902c0: j   .L0x8009096c       #   -> no page at all
 * 13708 .L0x800902c8: li  $v0, 0x190        # 400
 * 13709 .L0x800902cc: beq $v1, $v0, .L0x80090734
 * 13710 .L0x800902d0: li  $a1, 0x190
 * 13711 .L0x800902d4: j   .L0x8009096c       #   -> no page at all
 * ```
 *
 * so 198..208 fall out of the ranges and the three explicit compares into the two stat
 * tables, 209/210 into `.L0x80090528`, 211 into `.L0x80090584`, 212 into
 * `.L0x800905c8`, 391 into `.L0x80090610`, 392 into `.L0x80090654` and 400 into
 * `.L0x80090734`. The census test checks exactly that, id by id, against the shipped
 * table's own `category` byte.
 */
export const DAMAGE_TERM_ARMS_CATEGORY5: readonly DamageTermCategory5Arm[] = Object.freeze([
  {
    arm: 0x800902dc, ids: [198, 200, 202, 204, 205, 206, 207, 208], kind: 2,
    effect: "statOne", target: "acting", blankKind: 1,
    eventCode: 0x0d,
    reads: "one stat on one fighter. The table at `.L0x800a33cc` gives the direction " +
      "(`+0x2`), the stat (`+0x4`) and the word (`+0x6`); the magnitude is " +
      "`direction * record[+0x0C]` (`mult $v0, $a3` :13759, `mflo $a3` :13770). It " +
      "writes the TARGET's own record halfword at `+0x10 + 2*stat` through " +
      "`FIGHTSTG_F0x800a1aa8` (`lw $v0, 0x4664($v0)` :13768 / `jalr $v0` :13771) and " +
      "stages the stat event (`jal FIGHTSTG_F0x8009cc20` :13776, whose code comes " +
      "from `.L0x800a43e0[stat]` = 0x0d/0x0e/0x0f). A direction of -1 also XORs the " +
      "side with 1 (`xor $s2, $a0` :13738) and asks the per-encounter gate byte " +
      "`0x80042b1c + stat + 0x46` (:13743), answering \"No effect!\" through kind 1 " +
      "(`li $v0, 0x2f` :13748) when it is set",
  },
  {
    arm: 0x800903f4, ids: [199, 201, 203], kind: 9,
    effect: "statParty", target: "acting",
    eventCode: 0x0d,
    reads: "one stat on every living slot of the acting side. The table at " +
      "`.L0x800a3414` is the same shape with all three rows `+1`. The walk reads " +
      "each record 0x10 BELOW its own base (`sll $v1, 0x5` over `3*side + slot` " +
      ":13848), which puts its two gates on record `+0x00` (a species, so the slot " +
      "holds a Digimon) and record `+0x08` (current HP, so it is alive) — the same " +
      "two fields `FIGHTSTG_F0x800a1aa8` tests itself (:13825/:13829). The page is " +
      "kind 9 (`li $a1, 0x9` :13886) with word 1 = 2 / 8 / 9 for attack / defense / " +
      "speed and nothing in word 0",
  },
  {
    arm: 0x80090528, ids: [209, 210], kind: 2,
    effect: "affinity", target: "acting", word: 0x36,
    reads: '"Saving Chi!" — esmfight[0x36] (`li $v0, 0x36` :13877). It writes the ' +
      "target's record `+0x0E` with the technique record's own `+0x0C` " +
      "(`lbu $a0, 0xc($s5)` :13873 / `sh $a0, 0xe($v1)` :13875)",
  },
  {
    arm: 0x80090584, ids: [211], kind: 2,
    effect: "lockFlee", target: "playerActive", word: 0x44, blankKind: 1, eventCode: 0x10,
    reads: '"Can\'t run away!" — esmfight[0x44] (`li $v0, 0x44` :13892), after the ' +
      "`f8` roll `(rand & 0x7f) < 80`. It stages status event 0x10 on the player's " +
      "active fighter through `FIGHTSTG_F0x8009cd1c` (`jal` :13890 / `li $a0, 0xd3` " +
      ":13891), which reads its code from `.L0x800a43ec` — the index is " +
      "`record[+0x0A] == 14`, and 211's dispatch byte is 13, so it takes slot 0 = " +
      "0x10. A LOST ROLL SAYS \"No effect!\" ON LINE ONE: `beqz $v0, .L0x800905b8` " +
      ":13888 carries `li $v0, 0x2f` :13889 in its DELAY slot, so the branch target " +
      "stores 0x2f (`sw $v0, 0x64($s4)` :13896) and asks kind 1 (`li $a1, 0x1` " +
      ":13899). The previous revision of this file read that store as the getter's own " +
      "zero and called the box blank",
  },
  {
    arm: 0x800905c8, ids: [212], kind: 2,
    effect: "lockDigivolve", target: "playerActive", word: 0x45, blankKind: 1,
    eventCode: 0x11,
    reads: '"Can\'t digivolve!" — esmfight[0x45] (`li $v0, 0x45` :13910), after the ' +
      "same `f8` roll. Its dispatch byte IS 14, so `FIGHTSTG_F0x8009cd1c` takes " +
      "`.L0x800a43ec[1]` = 0x11 and stages that on the player's active fighter. Its " +
      "lost roll is the same kind-1 \"No effect!\" (`beqz` :13906 / `li $v0, 0x2f` " +
      ":13907 / `sw` :13914 / `li $a1, 0x1` :13917)",
  },
  {
    arm: 0x80090610, ids: [391], kind: 1,
    effect: "statusOnly", target: "playerActive", fixedSide: 0, blankKind: 1, eventCode: 0x16,
    reads: "NO page at all when the roll lands: the arm runs " +
      "`FIGHTSTG_F0x8009cff4`, which stages status event 0x16 on the player's active " +
      "fighter (`li $v0, 0x16` fightstg.s:27251), writes 3 into the panel's own `+0xc` " +
      "(:13930) and jumps to the machine's finish. A LOST ROLL says \"No effect!\" " +
      "through kind 1 (`li $v0, 0x2f` :13924 in `beqz`'s DELAY slot, stored at :13931, " +
      "`li $a1, 0x1` :13934). ITS ROLL FUNCTION IS NOT 211/212's: `[0x800a4640]` is " +
      "`FIGHTSTG_F0x800a13c0`, which first walks eight `DIGIMON_PROFILES` rows against " +
      "the player's active record `+0x10` and answers zero on a match without drawing " +
      "anything — see {@link damageTermStatusRollBlocked}",
  },
  {
    arm: 0x80090654, ids: [392], kind: 18,
    effect: "mpDrain", target: "enemy", fixedSide: 1, word: 0x8f, blankKind: 1,
    reads: '"<n> MP absorbed!" — esmfight[0x8f], through kind 18 (`li $a1, 0x12` ' +
      ":13998 in the `j`'s delay slot) with word 2 = 1 (:13995). It moves MP OFF the " +
      "PLAYER's active fighter (`lh $a2, 0xc($t0)` :13944) ONTO the enemy's " +
      "(`sh $v0, 0xc($a0)` :13964): the amount is " +
      "`maxMP * record[+0x0C] / 128` (:13951-:13960) capped at what the source has " +
      "(:13957-:13960) and the receiver's own MP is clamped to ITS maximum " +
      "(:13972-:13976). A source with no MP (`beqz $a2, .L0x8009072c` :13946) jumps to " +
      "the landed arm's own tail with `li $v0, 0x2f` :13990, so its refusal is KIND 2 " +
      "with `esmfight[0x2f]` on LINE TWO and 0x10 in word 1 (`li $a1, 0x2` :14022) — " +
      "not kind 1",
  },
  {
    arm: 0x80090734, ids: [400], kind: 2,
    effect: "healCharge", target: "enemy", fixedSide: 1, word: 0x46,
    reads: '"Generating!" — esmfight[0x46] (`li $v0, 0x46` :14017). It adds the ' +
      "heal getter's amount to the ENEMY's active record `+0x08` (`sh $v0, 0x8($s0)` " +
      ":14006) and caps it at `+0x06` (:14010-:14014), then writes the literal 0x20 " +
      "into that record's `+0x0E` (:14015-:14016). The getter's power term is RECORD " +
      "400's own `+0x02`, because the branch that reaches this arm leaves `$a1` at 400 " +
      "(`li $a1, 0x190` :13710, the `beq`'s delay slot) — see " +
      "{@link DAMAGE_TERM_HEAL_POWER_ID}",
  },
]);

/** The arm one technique id lands on, or null when the chain reaches no arm. */
export function damageTermCategory5Arm(techniqueId: number): DamageTermCategory5Arm | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  return DAMAGE_TERM_ARMS_CATEGORY5.find((a) => a.ids.includes(id)) ?? null;
}

/**
 * The side one arm's write lands on, given the acting side and — for the two stat arms —
 * the row it addressed.
 *
 * The inversion is the ROW's, not the arm's: `.L0x800902dc` reads the direction into
 * `$v0` (`lh $v0, 0x2($s3)` :13756) and `bgtz $v0, .L0x80090380` (:13735) takes a `+1`
 * row straight to the acting side, while the `A <= 0` branch reaches a delay slot that
 * XORs the side with 1 (`xor $s2, $a0` :13738, `$a0 = 1` from :13731) and so lands on the
 * OTHER side — which is what a debuff does. The party arm has no such branch: its three
 * rows are all `+1`, and it reads the side straight (`srl $v0, 0x4` :13815).
 *
 * THE THREE FIXED-SIDE ARMS (391, 392, 400) ARE NOT ROLE-TARGETED AT ALL. Their streams
 * name a side outright — 391 writes its status event's word 3 as `lw $v1, 0x4468($v0)`
 * (`FIGHTSTG_F0x8009cff4` :27256), and 392/400 read `0x800a4468`/`0x800a446c` for the two
 * records they move MP between or heal (:13938-:13939, :13993) — with no test on who is
 * acting. For the enemy caster that fixed side IS the opponent, which is why the disc can
 * write it that way: the shipped table gives 391 to Persiamon's row and 392/400 to no
 * player row at all. The walker's extra rows can put 391 in a player's hands (its `techs`
 * list carries `[390, 391, ...]`), and the literal disc answer there is a self-write: the
 * status would be staged on the caster. That unreachable-on-retail behaviour is not what
 * the arm means, so {@link DamageTermCategory5Arm.fixedSide} names the side and this
 * function flips it for a side-0 caster: a fixed side of 1 is the caster's own side and
 * 0 the opponent, exactly as when an enemy casts. Documented as a walker repair, not as
 * disc emulation.
 */
export function damageTermCategory5Side(
  arm: DamageTermCategory5Arm | null, actingSide: number, row?: DamageTermStatRow | null,
): number {
  const acting = (Math.trunc(Number(actingSide)) | 0) < 1 ? 0 : 1;
  if (arm?.fixedSide !== undefined) return acting < 1 ? (arm.fixedSide ^ 1) : arm.fixedSide;
  if (arm?.target === "acting" && row && row.direction < 0) return acting < 1 ? 1 : 0;
  switch (arm?.target) {
    case "acting": return acting;
    case "opposite": return acting < 1 ? 1 : 0;
    case "enemy": return 1;
    case "playerActive": return 0;
    default: return acting;
  }
}

/**
 * Technique 400's heal reads **record 400's own** power, because the branch's delay slot
 * puts 400 into `$a1`.
 *
 * ```
 * fightstg.s:13708 .L0x800902c8: li  $v0, 0x190
 * fightstg.s:13709 .L0x800902cc: beq $v1, $v0, .L0x80090734
 * fightstg.s:13710 .L0x800902d0: li  $a1, 0x190       # DELAY SLOT: runs on BOTH sides
 * fightstg.s:13991 .L0x80090734: lui $v1, 0x800a      # the arm
 * fightstg.s:13996 .L0x80090748: lbu $a0, 0x50($s4)   # the acting side, into $a0 only
 * fightstg.s:13997 .L0x8009074c: lw  $v0, 0x4614($v0) # [0x800a4614] = FIGHTSTG_F0x800a0108
 * fightstg.s:13999 .L0x80090754: jalr $v0             # nothing in between writes $a1
 * fightstg.s:30519 .L0x800a0110: move_ $s0, $a1       # ... the getter reads $a1
 * fightstg.s:30539 .L0x800a0160: lhu $v1, 0x2($v0)    # that record's own +0x02 POWER
 * ```
 *
 * The arm at `.L0x80090734`-`:80090758` loads `$a0` with the acting side
 * (`lbu $a0, 0x50($s4)` `:13996`) and never writes `$a1` again, so the getter reads
 * `0x80042bca + 18 * $a1` = **record 400** — the very record the arm belongs to, which is
 * why `category5Plan` can take the power straight off `record.power` and needs no
 * hand-fed constant. An earlier revision of this file read the heal's power as record
 * **2**'s (60), on the theory that the caller leaves `$a1` at 2; that was the `li $a1,
 * 0x2` at fightstg.s:13696 (`.L0x80090298`), which is the delay slot of the **209/210**
 * branch `bnez $v0, .L0x80090528` at `:13695` and is consumed inside the Chi arm's
 * `sllv $v0, $v0, $a1` (`:13866`). It never reaches the 400 arm, because the 400 arm is
 * reached through its own branch, whose delay slot is the 400 above.
 */
export const DAMAGE_TERM_HEAL_POWER_ID = 400;

/**
 * The `(rand & 0x7f) < record[+0x0B]` roll the three arms share
 * (`andi $v0, 0x7f` / `slt $v0, $s0` at fightstg.s:31864-.L0x800a1540).
 */
export function damageTermRoll(threshold: number, roll7: number): boolean {
  return ((Math.trunc(Number(roll7)) | 0) & 0x7f) < (Math.trunc(Number(threshold)) | 0);
}

/**
 * **391's roll getter is NOT the body 211 and 212 share.** `[0x800a4640]`
 * (fightstg.s:35036 `.word 0x800a13c0`) is `FIGHTSTG_F0x800a13c0`, and before it rolls it
 * walks EIGHT rows of the disc's own profile table against one halfword of the PLAYER's
 * active combatant record:
 *
 * ```
 * fightstg.s:31753 FIGHTSTG_F0x800a13c0:
 * fightstg.s:31755 .L0x800a13c4: move_ $a2, $zr        # the row counter, 0
 * fightstg.s:31761 .L0x800a13dc: lw   $v0, 0x8($v1)    # [0x800a4468] = the PLAYER's active index
 * fightstg.s:31762 .L0x800a13e0: addiu $a0, -0x10a4   # $a0 = 0x8003ef5c, DIGIMON_PROFILES
 * fightstg.s:31763 .L0x800a13e4: sll  $v0, 0x5        # the record, 0x20 stride
 * fightstg.s:31764 .L0x800a13e8: addu $v0, $v1
 * fightstg.s:31765 .L0x800a13ec: lh   $v1, 0x10($v0) # the halfword: record + 0x10
 * fightstg.s:31766 .L0x800a13f0: lhu  $v0, ($a0)      # the row's OWN first halfword
 * fightstg.s:31768 .L0x800a13f8: bne  $v0, $v1, .L0x800a1408
 * fightstg.s:31769 .L0x800a13fc: addiu $a2, 0x1       # DELAY SLOT: the counter always runs
 * fightstg.s:31770 .L0x800a1400: j    .L0x800a1448
 * fightstg.s:31771 .L0x800a1404: move_ $v0, $zr      # DELAY SLOT: a match returns ZERO
 * fightstg.s:31772 .L0x800a1408: slti $v0, $a2, 0x8   # at most EIGHT rows
 * fightstg.s:31773 .L0x800a140c: bnez $v0, .L0x800a13f0
 * fightstg.s:31774 .L0x800a1410: addiu $a0, 0x58      # the 0x58 profile stride
 * ```
 *
 * The base is `lui $a0, 0x8004` + `addiu $a0, -0x10a4` = **0x8003ef5c**, which is the
 * `DIGIMON_PROFILES` table (55 rows, stride 0x58 — the same table `FIGHTSTG_F0x8009ec94`
 * indexes by profile byte `sll $v0, 0x1 / addu / sll 0x2 / subu / sll 0x3`
 * fightstg.s:29226-:29231, and the same one `tools/verify_dna.mjs` reads out of the
 * committed resident image at `0x8003ef5c - 0x80010000`). Its **first halfword is the row's
 * own profile/form id** — `FIGHTSTG_F0x8009ec94` scans for the row whose first halfword
 * equals the record's own `+0x00` (`lhu $v0, ($s0)` :29247 / `lh $a0, ($s3)` :29248 /
 * `beq $v0, $a0` :29250), and the Blast writer puts a profile id there too
 * (`docs/research/evidence/ledger.json` EV-DIGIMON-PROFILES-0x8003ef5c-2026-09-13).
 *
 * The halfword compared against them is `lh $v1, 0x10($v0)` over a record base of
 * `0x800a4460 + index*0x20`, i.e. `0x800a4470 + index*0x20 + 0x10` = the player record's
 * **`+0x10`, the ATTACK MODIFIER** — the same halfword `FIGHTSTG_F0x800a1aa8` writes
 * (`sh $v0, 0x10($a1)` fightstg.s:32296) and `FIGHTSTG_F0x8009ec94` folds into the
 * effective block (`lh $v0, 0x10($s3)` :29291). **Not** the profile id at `+0x00`. The
 * previous revision of this file had no such check at all; this is the port of what the
 * assembly says, and the walk of eight rows is the walk it says.
 *
 * Rows 0..7 carry profile ids 383, 385, 384, 3, 145, 366, 373 and 31 — the first eight
 * Digimon of the disc's own roster order (Kotemon, Kumamon, Monmon, Agumon, Veemon,
 * Guilmon, Renamon, Patamon). GUESS, not established: the eight ids look like a profile-id
 * set, and the author may have meant the record's `+0x00`; the instruction says `0x10`, so
 * `0x10` is what ships.
 */
export const DAMAGE_TERM_STATUS_ROLL_PROFILES: readonly number[] = Object.freeze([
  0x17f, 0x181, 0x180, 0x003, 0x091, 0x16e, 0x175, 0x01f,
]);

/**
 * `FIGHTSTG_F0x800a13c0`'s pre-roll gate: true when the PLAYER's active record `+0x10`
 * equals one of the eight profile ids the getter walks, which makes it return zero
 * **without drawing a number at all** (`j .L0x800a1448` / `move_ $v0, $zr` in the `bne`'s
 * two delay slots), so a caller must not spend a random draw on it.
 */
export function damageTermStatusRollBlocked(attackModifier: number): boolean {
  return DAMAGE_TERM_STATUS_ROLL_PROFILES.includes(
    (Math.trunc(Number(attackModifier)) | 0) & 0xffff);
}

/**
 * `FIGHTSTG_F0x800a1aa8`'s own arithmetic: the new value of one record's stat modifier.
 *
 * ```
 * fightstg.s:32260 lh  $v0, 0x10($a1)    # the CURRENT modifier, signed
 * fightstg.s:32261 lhu $a0, 0x10($a1)    # ... and unsigned
 * fightstg.s:32262 beqz $v0, .L0x800a1b74  # a nonzero modifier is taken OFF the block first
 * fightstg.s:32266 lh  $v1, ($v0)        # .L0x800a4694[stat]
 * fightstg.s:32268 sll $v1, 0x1 / :32269 addu $v1, $a3
 * fightstg.s:32270 lhu $v0, 0x2($v1)     # the effective stat
 * fightstg.s:32272 subu $v0, $a0 / :32273 sh $v0, 0x2($v1)
 * fightstg.s:32281 lhu $v0, 0x2($v0)     # read back: the CLEAN value
 * fightstg.s:32283 sll $v0, 0x10 / :32284 sra $a0, $v0, 0x10   # $a0 = that value, signed
 * fightstg.s:32285 mult $a0, $s2         # x the magnitude
 * fightstg.s:32286 srl $v0, 0x1f         # SHORT FORM: bit 31 of $v0 = the sign of $a0
 * fightstg.s:32288 sra $v0, 0x1          # $v0 = trunc(eff/2) -- NOT the product
 * fightstg.s:32289 mflo $v1              # $v1 = the product, for its sign
 * fightstg.s:32291 negu $a2, $v0         # DELAY SLOT: the lower bound -trunc(eff/2)
 * fightstg.s:32292 addiu $v1, 0x7f       # ... and the shift rounds toward zero
 * fightstg.s:32294 sra $v1, 0x7          # delta = trunc(eff * magnitude / 128)
 * fightstg.s:32296 sh  $v0, 0x10($a1)    # modifier = current + delta
 * fightstg.s:32297 sll $v0, 0x1 / :32298 sra $v0, 0x10   # the STORED value, signed
 * fightstg.s:32299 slt $v0, $a2 / :32302 sh $a2, 0x10($a1)   # SHORT: value < low -> low
 * fightstg.s:32303 lh  $v0, 0x10($a1)
 * fightstg.s:32305 slt $v0, $a0, $v0 / :32308 sh $a0, 0x10($a1)   # eff < value -> eff
 * ```
 *
 * The `srl $v0, 0x1f` at :32286 is short-form, so it shifts the register it names —
 * `$v0`, still the effective stat shifted left by sixteen — and NOT the product's high
 * word. That is what makes the lower bound NEGATIVE for a positive stat and lets a
 * `[arrow-down]` row keep a negative modifier, which the effective fold then adds
 * modularly (fightstg.s:29298 `lh` / :29299 `lhu` / :29306 `addu`, so a negative
 * modifier subtracts as long as the sum stays inside the halfword).
 *
 * **The lower clamp reads the value it just stored, not the delta.** `slt $v0, $a2`
 * (:32299) is the SHORT form of `slt $v0, $v0, $a2` — the `.s` prints two operands and
 * the one it omits is the `$v0` the first one names, which carries `current + delta`
 * reloaded from the record halfword — so the bound is tested against the NEW modifier. A
 * second debuff on a fighter that already holds a negative modifier is therefore floored
 * where the previous revision of this function let it through (that revision compared the
 * DELTA, which no shipped record's magnitude can push below the bound on its own).
 */
export function damageTermStatModifier(
  effective: number, current: number, magnitude: number,
): number {
  const eff = (Math.trunc(Number(effective)) | 0) << 16 >> 16;
  const cur = (Math.trunc(Number(current)) | 0) << 16 >> 16;
  const mag = Math.trunc(Number(magnitude)) | 0;
  // `srl $v0, 0x1f` on `eff << 16` is bit 15 of `eff`.
  const halving = (eff + ((eff >> 15) & 1)) >> 1;
  const product = Math.imul(eff, mag);
  const delta = (product < 0 ? product + 0x7f : product) >> 7;
  let value = cur + delta;
  const low = -halving;
  if (value < low) value = low;
  if (value > eff) value = eff;
  return (value << 16) >> 16;
}

/**
 * `FIGHTSTG_F0x800a1aa8`'s two entry gates: an empty slot (record `+0x00`) and a fallen
 * one (record `+0x08`) are both skipped before any arithmetic
 * (fightstg.s:32250 `lh $v0, ($v1)` / :32252 `beqz` and :32254 `lh $v0, 0x8($v1)` /
 * :32256 `beqz`).
 */
export function damageTermStatApplies(species: number, currentHp: number): boolean {
  return (Math.trunc(Number(species) | 0) !== 0) && (Math.trunc(Number(currentHp) | 0) !== 0);
}

/** One fighter a stat arm touches. */
export interface Category5StatTarget {
  /** The side's own active index, the slot the record machine names. */
  slot: number;
  /** Record `+0x00`, the species. Zero means the slot is empty. */
  species: number;
  /** Record `+0x08`, current HP. Zero means the slot has fallen. */
  hp: number;
  /** The effective block's own value for the stat the arm addresses. */
  effective: number;
  /** Record `+0x10 + 2*stat`, the modifier the arm changes. */
  modifier: number;
}

/** One slot's planned change, before the caller writes it onto its own record. */
export interface Category5StatChange {
  slot: number;
  /** Which stat: 0 attack, 1 defense, 2 speed. */
  stat: number;
  /** The value the modifier becomes. */
  modifier: number;
  /** The value it held before the arm ran. */
  before: number;
  /** `magnitude / 128`, the fraction of the effective stat the arm adds. */
  fraction: number;
}

/** What one category-5 technique does, decided from its record and the arms. */
export interface Category5Plan {
  techniqueId: number;
  arm: DamageTermCategory5Arm;
  effect: DamageTermCategory5Effect;
  /** The side the arm's write lands on. */
  side: number;
  /** The stat changes the arm makes, one row per slot it touches. */
  stats: Category5StatChange[];
  /** The `record[+0x0C]` byte the charge arms write, or null when the arm writes none. */
  affinity: number | null;
  /** The charge byte the target already held, read AFTER the per-action clear. */
  affinityBefore: number;
  /** The plain damage multiplier the charge byte buys: `1 + byte / 64`. */
  multiplier: number;
  /** True when the arm's gate refused it (the per-encounter byte on a debuff). */
  refused: boolean;
  /** True when the arm's roll landed (211, 212, 391). */
  rollLanded: boolean;
  /**
   * True when 391's own getter answered zero WITHOUT rolling, because the player's active
   * record `+0x10` matched one of the eight profile ids it walks
   * ({@link damageTermStatusRollBlocked}). A blocked cast spends no random draw.
   */
  rollBlocked: boolean;
  /** Technique 400's heal amount, from the shared quantity getter. Zero otherwise. */
  healAmount: number;
  /** Technique 392's MP transfer, as the amount that actually moves. Zero otherwise. */
  mpMoved: number;
  /** The page the arm puts up, or null when it puts up none. */
  page: BattleMessagePage | null;
}

/** The inputs one category-5 arm reads. */
export interface Category5Options {
  /** The acting side: 0 the player's partner, 1 the enemy. */
  side: number;
  /** The Digimon the page names. */
  name?: string | null;
  /** The seven-bit roll `(RAND_U16 & 0x7f)` for the three arms that roll. */
  roll7?: number;
  /** The roll landed, for 211 and 212. */
  rollLanded?: boolean;
  /** The roll landed, for 391 — whose getter may answer zero without rolling. */
  rollStatusLanded?: boolean;
  /**
   * 391 only: the PLAYER's active record `+0x10`, the ATTACK MODIFIER. `FIGHTSTG_F0x800a13c0`
   * walks the first eight `DIGIMON_PROFILES` rows against it and returns zero on a match,
   * before it ever calls `rand` — see {@link damageTermStatusRollBlocked}.
   */
  playerActiveAttackModifier?: number;
  /** The stat targets for the two stat arms, in slot order. */
  targets?: readonly Category5StatTarget[];
  /** The three per-encounter gate bytes `0x80042b62..0x80042b64`, index 0 = `0x62`. */
  gateBytes?: readonly number[];
  /** The player's active fighter's MP and maximum MP, for 392. */
  sourceMp?: number;
  sourceMaxMp?: number;
  /** The enemy's active fighter's MP and maximum MP, for 392. */
  destMp?: number;
  destMaxMp?: number;
  /** The enemy's active fighter's HP and maximum HP, for 400's heal. */
  targetHp?: number;
  targetMaxHp?: number;
  /**
   * Technique 400's other operand, `FIGHTSTG_F0x800a0108`'s second one: the ACTING side's
   * active fighter's WIS (`lh $v0, 0x4588($a0)` fightstg.s:30540, the effective stat
   * block's `+0x08`, which the getter builds from `$a0` at :30527-:30539). The heal's
   * POWER term is not an option: it is `record.power`, because the branch's delay slot
   * leaves `$a1` at 400 and the getter indexes the record by `$a1`
   * ({@link DAMAGE_TERM_HEAL_POWER_ID}).
   */
  healWisdom?: number;
  /** The charge byte the target held before the arm ran. */
  affinityBefore?: number;
}

/**
 * THE WHOLE CATEGORY-5 FAMILY, one call per technique, both sides.
 *
 * The arm is decided by {@link damageTermCategory5Arm} and nothing else — there is no
 * per-technique branch anywhere below — and the page comes from the same
 * {@link damageTermPage} the rest of the record machine uses, so the words and the
 * writes can never come from different arms.
 */
export function category5Plan(
  record: Partial<DamageTermRecord> | null | undefined,
  techniqueId: number,
  options: Category5Options,
): Category5Plan | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  const arm = damageTermCategory5Arm(id);
  if (!arm || !record) return null;
  if ((Math.trunc(Number(record.category ?? 0)) | 0) !== 5) return null;
  const row = damageTermStatRow(id);
  const acting = (Math.trunc(Number(options.side)) | 0) < 1 ? 0 : 1;
  const side = damageTermCategory5Side(arm, acting, row);
  const magnitude = row
    ? row.direction * (Math.trunc(Number(record.crit ?? 0)) | 0)
    : 0;
  // 391's getter answers zero without drawing a number when the player's active record
  // `+0x10` is one of the eight profile ids it walks (FIGHTSTG_F0x800a13c0 :31765-:31771).
  const rollBlocked = arm.effect === "statusOnly"
    && damageTermStatusRollBlocked(options.playerActiveAttackModifier ?? 0);
  const rollLanded = arm.effect === "statusOnly"
    ? !rollBlocked && (options.rollStatusLanded ?? false)
    : options.rollLanded ?? false;
  const gate = ((options.gateBytes ?? [])[row ? row.stat : 0] ?? 0) | 0;
  // `:13735 bgtz $v0` skips the gate for an UP row, and the gate byte is only read on
  // the `A <= 0` path at all, so a stat-UP row can never be refused by it.
  const refused = !!row && row.direction < 0 && (gate & 0xff) !== 0;
  const stats: Category5StatChange[] = [];
  if (row && !refused && (arm.effect === "statOne" || arm.effect === "statParty")) {
    for (const target of options.targets ?? []) {
      if (!damageTermStatApplies(target.species, target.hp)) continue;
      const before = Math.trunc(Number(target.modifier) | 0) << 16 >> 16;
      stats.push({
        slot: Math.trunc(Number(target.slot) | 0),
        stat: row.stat,
        modifier: damageTermStatModifier(target.effective, before, magnitude),
        before,
        fraction: magnitude / DAMAGE_TERM_AFFINITY_DIVISOR,
      });
    }
  }
  const affinityBefore = Math.trunc(Number(options.affinityBefore ?? 0)) & 0xff;
  const affinity = arm.effect === "affinity"
    ? (Math.trunc(Number(record.crit ?? 0)) | 0) & 0xff
    : arm.effect === "healCharge" ? 0x20 : null;
  const page = damageTermPage(record, {
    techniqueId: id, side: acting, name: options.name ?? "",
    damage: 0, hitCount: 1, landed: true, applied: false, retaliated: false,
    suppressed: false, activeSlot: options.targets?.[0]?.slot ?? 0,
  }, {
    rollLanded, rollStatusLanded: rollLanded, targetSide: side, activeSlot: 0,
    refused,
    mpMoved: arm.effect === "mpDrain" ? damageTermMpMoved(record, options) : 0,
    missingHp: Math.max(0, (options.targetMaxHp ?? 0) - (options.targetHp ?? 0)),
  });
  return {
    techniqueId: id, arm, effect: arm.effect, side, stats,
    affinity,
    affinityBefore,
    multiplier: 1 + damageTermAffinityMultiplier(affinity),
    refused,
    rollLanded,
    rollBlocked,
    // `FIGHTSTG_F0x800a0108` reads `0x80042bca + 18 * $a1` and the 400 arm's branch leaves
    // `$a1` at 400 (fightstg.s:13710), so the power term is THIS record's own `+0x02`.
    healAmount: arm.effect === "healCharge"
      ? damageTermHealAmount(record.power ?? 0, options.healWisdom ?? 0) : 0,
    mpMoved: arm.effect === "mpDrain" ? damageTermMpMoved(record, options) : 0,
    page,
  };
}

/**
 * How much MP technique 392 moves: `maxMP * record[+0x0C] / 128`, capped at what the
 * source has (fightstg.s:13951-:13964). Zero when the source has none, which is the arm's
 * own "No effect!" test at :13947.
 *
 * The receiver's maximum does NOT reduce the amount: the arm adds the whole amount and
 * then clamps the receiver on its own (`lhu $v0, 0xc($a0)` / `addu $v0, $a3` / `sh $v0,
 * 0xc($a0)` :13961-:13964, and `lh $v1, 0xc($a0)` / `lh $v0, 0xa($a0)` / `slt $v0, $v1` /
 * `sh $v1, 0xc($a0)` :13969-:13976), so the source is debited the full amount and word 1
 * of the page reports it.
 */
export function damageTermMpMoved(
  record: Partial<DamageTermRecord> | null | undefined,
  options: Category5Options,
): number {
  const source = Math.trunc(Number(options.sourceMp ?? 0)) | 0;
  if (source <= 0) return 0;
  const sourceMax = Math.trunc(Number(options.sourceMaxMp ?? 0)) | 0;
  const product = Math.imul(sourceMax, Math.trunc(Number(record?.crit ?? 0)) | 0);
  let moved = (product < 0 ? product + 0x7f : product) >> 7;
  if (source < moved) moved = source;
  return moved;
}

/** `.L0x800a3460` — the four cure words, read at fightstg.s:13391 `.L0x8008fdd4` sll $v0, $s0, 0x2 / fightstg.s:13396 `.L0x8008fde8` sw $v1, 0x68($s4). */
export const DAMAGE_TERM_CURE_WORDS: readonly number[] = Object.freeze([0x28, 0x29, 0x2a, 0x2c]);
/** `.L0x800a3450` — the four silent words the odd half of the cure window carries. */
export const DAMAGE_TERM_CURE_QUIET_WORDS: readonly number[] = Object.freeze([1, 2, 3, 4]);
/**
 * `.L0x800a3434` — the four ailment BYTES the even half of the cure window tests the
 * target's own ailment byte against (`lbu $v0, ($v0)` at fightstg.s:13382 `.L0x8008fdb0`).
 * The first word is `0x3f040201`, so the bytes are 0x01, 0x02, 0x04 and 0x3f.
 */
export const DAMAGE_TERM_CURE_MASKS: readonly number[] = Object.freeze([0x01, 0x02, 0x04, 0x3f]);
/**
 * `.L0x800a43dc` — the four ailment BITS the cure helper `FIGHTSTG_F0x8009c330` clears,
 * read at fightstg.s:26417 `.L0x8009c3d0` `addiu $v0, 0x43dc` / :26418 `addu $v0, $a0, $v0`
 * / :26419 `lbu $v0, ($v0)` and applied as `lbu $v1, 0x1c($a2)` :26420 /
 * `nor $v0, $zr, $v0` :26421 / `and $v1, $v0` :26422 / `sb $v1, 0x1c($a2)` :26425. The one
 * word is `0x3f040201` (:34883), the same bytes as `.L0x800a3434` (:33881): 0x01 poison,
 * 0x02 frozen, 0x04 confused, 0x3f every bit the walker knows.
 *
 * Its sibling `.L0x800a43d4` holds the status-event CODES the same helper cancels. The
 * first three slots read ONE byte each — `addiu $v0, 0x43d4` :26427 / `addu $v0, $a0, $v0`
 * :26428 / `lbu $a0, ($v0)` :26429, then `lw $v0, 0xb0c($s0)` :26432 / `jalr $v0` :26434 and
 * `sh $zr, ($v0)` :26443 to cancel the event the code names. Slot 3 — the "all ailments"
 * cure, `li $v0, 0x3` :26423 / `beq $a0, $v0, .L0x8009c440` :26424 — walks SIX bytes
 * instead (:26444-:26465, `slti $v0, $s0, 0x6` :26464), and those six bytes are
 * `.L0x800a43d4` = `0x0c0b0a09` (:34881) plus the low half of `.L0x800a43d8` =
 * `0x00001110` (:34882), i.e. [9, 10, 11, 12, 16, 17] — the same six codes technique 375
 * reads a WORD at a time out of `.L0x800a3438` (:33882-:33887).
 */
export const DAMAGE_TERM_CURE_BITS: readonly number[] = Object.freeze([0x01, 0x02, 0x04, 0x3f]);
/** The six status-event codes technique 375 and the all-ailments cure cancel. */
export const DAMAGE_TERM_CLEARED_EVENT_CODES: readonly number[] =
  Object.freeze([9, 10, 11, 12, 16, 17]);
/** `li $v0, 0x27` at fightstg.s:13305 `.L0x8008fc7c` — technique 189's word. */
export const DAMAGE_TERM_REGEN_WORD = 0x27;
/** `li $v0, 0x36` at fightstg.s:13877 `.L0x8009056c` — techniques 209/210's word. */
export const DAMAGE_TERM_CHI_WORD = 0x36;
/** `li $v0, 0x46` at fightstg.s:14017 `.L0x8009079c` — technique 400's word. */
export const DAMAGE_TERM_GENERATE_WORD = 0x46;
/** `li $v0, 0x44` (fightstg.s:13892 `.L0x800905a8`) — technique 211 with flag 0xd3 set. */
export const DAMAGE_TERM_CANNOT_RUN_WORD = 0x44;
/** `li $v0, 0x45` (fightstg.s:13910 `.L0x800905f0`) — technique 212 with flag 0xd4 set. */
export const DAMAGE_TERM_CANNOT_DIGIVOLVE_WORD = 0x45;

/**
 * THE AFFINITY BYTE — the combatant record's `+0x0E`, the operand the damage tail's
 * stage 3 multiplies by.
 *
 * `F0x8009ec94` copies it into the effective block's `+0x26`
 * (fightstg.s:29409 `.L0x8009f00c` `lbu $v0, 0xe($s3)` / :29411 `.L0x8009f014`
 * `sb $v0, 0x26($s2)`), reading a 0x20-stride party record formed at :29216
 * `.L0x8009ed08` / :29217 `.L0x8009ed0c` (`0x800a4470 + index*0x20`, the enemy half at
 * :29704 `.L0x8009f4a8` / :29705 `.L0x8009f4ac` = `0x800a44d0`). `F0x8009f6dc` then reads the ACTING side's byte
 * (:29904 `.L0x8009f7b0` `lbu $v0, 0x26($s2)`), skips when it is zero
 * (:29906 `.L0x8009f7b8` `beqz $v0, .L0x8009f7d8`), and otherwise adds `running * byte / 64`
 * (:29907 `mult $s0, $v0` / :29908 `mflo $v0` / :29912 `sra $v0, 0x6` /
 * :29913 `addu $s0, $v0`). Nothing masks the byte.
 *
 * WHO WRITES IT is NOT the display-list packer. `FIGHTSTG_F0x80084bc0`
 * (:2084 `.L0x80084ca0` `sh $v0, 0xe($v1)`) and `FIGHTSTG_F0x80084e0c`
 * (:2215 `.L0x80084e94`) do store a halfword at displacement `0x0e`, but their base is
 * `*(arg0+0x54)` (:2081 `.L0x80084c94` `lw $v1, 0x54($a3)`), and inside the display-list
 * interpreter `FIGHTSTG_F0x80085110` that slot holds the global at `0x8004DE30`:
 * :2520 `.L0x80085334` loads the engine service `0x8004DF68`, which is `F0x8001d844`
 * (`exe/fns.s:14840-14842`: `lui $v0, 0x8004` / `lw $v0, 0xde30($v0)` / `jr $ra`), and
 * :2903 `.L0x80085930` writes it back through `F0x8001d854`. Those two arms write a GPU
 * polygon record — the same routines put the command byte `0x3c` at `+0x07`
 * (:2097 `li $v0, 0x3c` / :2098 `sb $v0, 0x7($v1)`), the `0xc` layer byte at `+0x03`
 * (:2092 / :2095), and the texture-page word at `+0x1a` (:2088).
 *
 * THE THREE REAL WRITERS are category-5 arms of the same record machine, selected by the
 * technique id (:13668 `.L0x80090228` `lw $v1, 0x54($s4)`):
 *
 *   `.L0x80090528`  ids 209 (Soul Charge) and 210 (Misshukikou) —
 *     `lbu $a0, 0xc($s5)` at :13873 `.L0x8009055c` and `sh $a0, 0xe($v1)` at :13875
 *     `.L0x80090564`, where `$s5` is the technique's OWN 18-byte record (:13109
 *     `.L0x8008f96c` / :13110 `.L0x8008f970`), so the value is record `+0x0C`. Reached
 *     from :13694 `.L0x80090290` `slti $v0, $v1, 0xd3` / :13695 `.L0x80090294`
 *     `bnez $v0, .L0x80090528`.
 *   `.L0x80090734`  id 400 (Gilead Plant) — `li $v0, 0x20` at :14015 `.L0x80090794`
 *     and `sh $v0, 0xe($s0)` at :14016 `.L0x80090798`. Its record base is
 *     `0x800a4460 + 0x70 = 0x800a44d0` (:13992 `.L0x80090738` / :13994
 *     `.L0x80090740`) plus `index*0x20` (:13998 / :14000) — the ENEMY array.
 *
 * FIVE SITES CLEAR IT BACK TO ZERO, each after building the record from the side byte the
 * event carries, on the path where the battle message box has nothing outstanding
 * (:10288 `lw $v0, ($s2)` / :10290 `bnez $v0, .L0x8008d35c` for `F0x8008cb70`:
 * :10312 `sh $zr, 0xe($v0)`; `F0x8008ee84`: :12760 (in the `j` delay slot at :12759);
 * `F0x8008f714`: :13092; `pro/wfightmn.s`: :3275 and :3653, both in a `jalr`/`jal` delay
 * slot). So the byte lives until that side's presentation is over — the game's own
 * wording for 209/210 is "Save Chi to power up next blow."
 *
 * MEASURED, not assumed: `tools/measure_battle_affinity.py` reads the disc's own
 * `+0x0C` column out of `~/ddw3/rust/dw2003_exe_data/src/data.rs` and reports 209 → 80
 * (x2.25), 210 → 127 (x2.98) and 400 → the literal 32 (x1.5). GrapLeomon owns 209 and
 * Marsmon — one of the eight starters — owns 210, so the operand is nonzero in ordinary
 * play.
 */
export interface DamageTermAffinityArm {
  /** The label the record machine dispatches to. */
  arm: number;
  /** Every technique id the arm answers for. */
  ids: readonly number[];
  /** Where the byte comes from: the technique record's `+0x0C`, or the arm's own literal. */
  source: "record+0x0c" | "literal";
  /** The literal the arm writes, when `source` is `"literal"`. */
  literal?: number;
}

/** The record byte the stage-3 operand lives in. */
export const DAMAGE_TERM_AFFINITY_RECORD_OFFSET = 0x0e;
/** The technique-record byte two of the three arms copy from. */
export const DAMAGE_TERM_AFFINITY_TECH_OFFSET = 0x0c;
/** `sra $v0, 0x6` at fightstg.s:29912 `.L0x8009f7d0`. */
export const DAMAGE_TERM_AFFINITY_DIVISOR = 64;

export const DAMAGE_TERM_AFFINITY_ARMS: readonly DamageTermAffinityArm[] = Object.freeze([
  {
    arm: 0x80090528, ids: Object.freeze([209, 210]),
    source: "record+0x0c",
  },
  {
    arm: 0x80090734, ids: Object.freeze([400]),
    source: "literal", literal: 0x20,
  },
]);

/** The arm that writes the byte for one technique id, or null when none does. */
export function damageTermAffinityArm(techniqueId: number): DamageTermAffinityArm | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  return DAMAGE_TERM_AFFINITY_ARMS.find((a) => a.ids.includes(id)) ?? null;
}

/**
 * The byte one technique writes into its target's record `+0x0E`, or null when the
 * technique is not one of the three arms.
 *
 * `row` is that technique's own record out of the shipped extract of the disc's 18-byte
 * table (`web/assets/data/fight_tech_table.json`, produced by
 * `tools/extract_fight_tech_table.py` from `~/ddw3/rust/dw2003_exe_data/src/data.rs`).
 * The field read is `crit`, which is that extractor's name for record `+0x0C` — the byte
 * `lbu $a0, 0xc($s5)` loads at fightstg.s:13873. `tools/measure_battle_affinity.py`
 * reports 209 -> 80 and 210 -> 127 from this column.
 */
export function damageTermAffinityByte(
  techniqueId: number,
  row?: { crit?: number } | null,
): number | null {
  const arm = damageTermAffinityArm(techniqueId);
  if (!arm) return null;
  if (arm.source === "literal") return (arm.literal ?? 0) & 0xff;
  return Math.trunc(Number(row?.crit ?? 0)) & 0xff;
}

/** Every technique id any affinity arm answers for, ascending. */
export function damageTermAffinityIds(): number[] {
  return [...new Set(DAMAGE_TERM_AFFINITY_ARMS.flatMap((a) => [...a.ids]))]
    .sort((a, b) => a - b);
}

/**
 * The byte the tail's stage 3 turns into a damage multiplier, i.e. `byte / 64`, or 0 for
 * a record that carries none. Kept beside the arms so no caller re-derives the divisor.
 */
export function damageTermAffinityMultiplier(byte: number | null | undefined): number {
  return ((Math.trunc(Number(byte ?? 0)) | 0) & 0xff) / DAMAGE_TERM_AFFINITY_DIVISOR;
}

/**
 * The record machine's per-action clear of the charge byte, and the byte it cleared.
 *
 * READ FIRST, THEN CLEAR — settled from the assembly, not from the technique's wording.
 * `FIGHTSTG_F0x8008f714` is the record machine for all five attack categories: its
 * **state 0** resolves the technique at `$s4+0x54` and, for categories 2 and 3, calls the
 * damage resolver through the pointer at `0x800a445c` (`pro/fightstg.s:12985` `lbu $v0,
 * 0x4($s0)` / `:12991` `lbu $a0, 0x50($s4)` / `:12992` `lw $v0, 0x445c($v0)` /
 * `:13000 jalr $v0`), which is `FIGHTSTG_F0x8009e0cc` (`.L0x800a445c: .word
 * 0x8009e0cc`) and builds the effective block that reads `record+0x0E`. Its **state 1,
 * sub-state 0** — the first row of its own sub-state table, `pro/fightstg.s:193
 * .L0x80082fdc: .word 0x8008f8b4` — puts up the announcement page and then stores
 * `sh $zr, 0xe($v0)` at `:13092`, in the delay slot of the `j`, so it always runs once the
 * message box is free (`:13063 lw $v0, ($s6)` / `:13065 bnez $v0, .L0x80090c1c`).
 * Sub-state 1 is the category handler (`pro/fightstg.s:13103`-`:13124` through the table
 * at `.L0x80083004`), and the charge arms write their byte in there (`:13875`, `:14016`).
 *
 * So the order inside ONE action is **damage (state 0) → clear (state 1, sub 0) →
 * category handler (state 1, sub 1)**, which settles all three questions the technique's
 * own wording could not:
 *
 *   * the action that SETS the byte does not spend it — its damage (if it has any) was
 *     already computed in state 0, and a category-5 technique computes none at all;
 *   * the acting fighter's NEXT action spends it, and it does not matter whether that
 *     next action is a technique or a plain attack, because categories 2 and 3 share
 *     state 0;
 *   * an action that computes no damage — a heal, a cure, a stat change, a field
 *     technique — never reads the byte, and the clear at sub-state 0 runs anyway, so such
 *     an action still throws the charge away.
 *
 * `0x800a4436` (`ctx+0x42`, `pro/fightstg.s:13067 lbu $v0, 0x4436($v0)` /
 * `:13069 bnez $v0, .L0x8008f92c`) can skip that clear, and nothing in the disc ever sets
 * it: the only store to that byte in any overlay is the zeroing at `:14929 sb $zr, 0x42($v0)`
 * inside `FIGHTSTG_F0x80091534`'s state 0, and the 0x68-byte context zero-fill
 * at `:12996`-`:13000`. So the branch is not taken by any code the game ships.
 *
 * The other four sites are the same rule seen from other machines, and none of them is a
 * revive or a battle-start reset: `FIGHTSTG_F0x8008cb70` `:10312` and `FIGHTSTG_F0x8008ee84`
 * `:12760` (the counter-damage arm) both clear in their state 1 after computing damage in
 * their state 0, `pro/wfightmn.s:3275` is the **defeat** handler (it prints
 * `esmfight[0x51]` "Defeated!" at `:3265`-`:3271` and wipes `+0x1c..+0x1f` beside the byte),
 * and `pro/wfightmn.s:3653` is the **Tag switch** (it restores the incoming fighter's
 * species into `record+0x00` at `:3650` and runs the shared Tag/Blast cleanup
 * `F0x800a7328` at `:3652`). Sweeping every store at displacement `0x0e` across every
 * overlay gives thirteen sites; the other four are GPU polygon records (`:2084`, `:2215`,
 * `:7865`, `:16595`) and the two `sb` sites in `cardgame.s` are that overlay's own object.
 *
 * One helper, so the single-hit path and the multi-hit applier cannot drift apart: the
 * multi-hit arm (`F0x8009d4b8`) computes its damage value ONCE and re-rolls only accuracy
 * on it, so the charge is spent once there too. The no-damage categories call this same
 * helper from their own gate — see `clearActionAffinity` in `web/battle.js`.
 */
export function consumeAffinity(attacker: { affinity?: number } | null | undefined): number {
  const spent = (Math.trunc(Number(attacker?.affinity ?? 0)) | 0) & 0xff;
  if (attacker && spent) attacker.affinity = 0;
  return spent;
}

/** `sltiu $s1, $v0, 0x1` over `side` — the original's own name selector. */
export function damageTermNameSelector(side: number): number {
  return (Math.trunc(Number(side)) | 0) < 1 ? 0x10 : 0;
}

/**
 * Write one payload word the original's arm writes and the page builder does not model.
 *
 * The arms below put the 0/16 side selector (or the raw side) into a payload word of their
 * own; `battleMessagePage` composes the two LINES, and its name always comes from the
 * caller's `name`, which is the fighter the original's own side test selects. This keeps
 * the payload faithful as well, so a census can compare it against the assembly.
 */
function withPayloadWord(
  page: BattleMessagePage | null,
  word: number,
  value: number,
): BattleMessagePage | null {
  if (!page) return null;
  while (page.payload.length <= word) page.payload.push(0);
  page.payload[word] = Math.trunc(Number(value)) | 0;
  return page;
}

/** `mult` / `mflo` then `slti $v0, 0x2710` / `li $v0, 0x270f`. */
export function damageTermClamp(value: number): number {
  const v = Math.trunc(Number(value)) | 0;
  return v < 0x2710 ? v : DAMAGE_TERM_DAMAGE_CAP;
}

/** `sll $v1, 0x6` — the power term of the heal amount, in `FIGHTSTG_F0x800a0108`. */
export const DAMAGE_TERM_HEAL_POWER_SHIFT = 6;
/** `sra $v0, 0x3` — the wisdom term is the product shifted down three. */
export const DAMAGE_TERM_HEAL_WISDOM_SHIFT = 3;

/**
 * A category-4 heal's own amount: `FIGHTSTG_F0x800a0108(side, techniqueId)`.
 *
 * **[0x800a4614] is NOT a table.** The word at `fightstg.s:35025 .L0x800a4614: .word
 * 0x800a0108` is ONE function pointer, entry 5 of the quantity-getter table that starts at
 * `fightstg.s:35020 .L0x800a4600: .word 0x8009ec94`. The category-4 arm calls through it:
 *
 * ```
 * fightstg.s:13513 .L0x8008ffbc: lui $v0, 0x800a
 * fightstg.s:13514 .L0x8008ffc0: lbu $a0, 0x50($s4)      # side
 * fightstg.s:13515 .L0x8008ffc4: lw $a1, 0x54($s4)       # technique id
 * fightstg.s:13516 .L0x8008ffc8: lw $v0, 0x4614($v0)     # the getter
 * fightstg.s:13518 .L0x8008ffd0: jalr $v0
 * fightstg.s:13519 .L0x8008ffd4: li $s0, -0x1
 * ```
 *
 * and the getter is (`fightstg.s:30517`-`:30540`):
 *
 * ```
 * fightstg.s:30519 .L0x800a0110: move_ $s0, $a1           # the technique id
 * fightstg.s:30527 .L0x800a0130: li $a0, 0x10            # side != 0
 * fightstg.s:30529 .L0x800a0138: lw $a2, 0x446c($v0)     # its roster pointer
 * fightstg.s:30530 .L0x800a013c: jal FIGHTSTG_F0x8009ec94
 * fightstg.s:30533 .L0x800a0148: sll $v0, $s0, 0x3      # id * 8
 * fightstg.s:30534 .L0x800a014c: addu $v0, $s0          # + id  = id * 9
 * fightstg.s:30535 .L0x800a0150: sll $v0, 0x1           # * 2   = id * 18
 * fightstg.s:30536 .L0x800a0154: lui $v1, 0x8004
 * fightstg.s:30537 .L0x800a0158: addiu $v1, 0x2bca      # 0x80042bca
 * fightstg.s:30538 .L0x800a015c: addu $v0, $v1          # the record
 * fightstg.s:30539 .L0x800a0160: lhu $v1, 0x2($v0)      # record +0x02, the POWER
 * fightstg.s:30540 .L0x800a0164: lh $v0, 0x4588($a0)    # effective stat block +0x08
 * fightstg.s:30542 .L0x800a016c: mult $v0, $v1          # wisdom * power
 * fightstg.s:30543 .L0x800a0170: mflo $v0
 * fightstg.s:30544 .L0x800a0174: bgez $v0, .L0x800a0180
 * fightstg.s:30545 .L0x800a0178: sll $v1, 0x6           # DELAY SLOT: power * 64
 * fightstg.s:30546 .L0x800a017c: addiu $v0, 0x7         # + 7 only when negative (bgez skips it)
 * fightstg.s:30547 .L0x800a0180: sra $v0, 0x3            # / 8
 * fightstg.s:30548 .L0x800a0184: addu $v1, $v0          # the amount
 * fightstg.s:30549 .L0x800a0188: slti $v0, $v1, 0x2710
 * fightstg.s:30550 .L0x800a018c: bnez $v0, .L0x800a0198
 * fightstg.s:30552 .L0x800a0194: li $v1, 0x270f          # otherwise 9999
 * ```
 *
 * `sll $v1, 0x6` sits in the delay slot of `bgez`, so the power term is added on BOTH
 * sides of the branch. `effective stat block +0x08` is the FOURTH of the five core stats
 * the block carries at `+0x02 .. +0x0a` (`FIGHTSTG_F0x8009ec94` writes them at
 * fightstg.s:29325 `.L0x8009eebc` sh $v1, 0x2($a0) and five iterations to
 * fightstg.s:29330 `.L0x8009eed0` slti $v0, $s1, 0x5), and `+0x0a` is independently
 * confirmed to be SPEED, which puts `+0x08` as WISDOM.
 */
export function damageTermHealAmount(power: number, wisdom: number): number {
  const p = Math.trunc(Number(power)) | 0;
  const w = Math.trunc(Number(wisdom)) | 0;
  const scaled = Math.imul(w, p);
  // `sll $v1, 0x6` for the power term. The wisdom term adds 7 ONLY when the product is
  // negative: `bgez $v0, .L0x800a0180` jumps over `addiu $v0, 0x7`, so it is a signed
  // divide by 8 that truncates toward zero, not a round-up.
  const wisdomTerm = (scaled < 0 ? scaled + 7 : scaled) >> DAMAGE_TERM_HEAL_WISDOM_SHIFT;
  const amount = (p << DAMAGE_TERM_HEAL_POWER_SHIFT) + wisdomTerm;
  return damageTermClamp(amount);
}

/**
 * The handler address for a record's category, or null when `sltiu` rejects it.
 *
 * A category of 0, 1 or 7+ returns null, which is the original's own fall-through at
 * fightstg.s:13115 `.L0x8008f984` beqz $v0, .L0x80090c1c: no page is built and the machine finishes.
 */
export function damageTermHandler(category: number): number | null {
  const c = Math.trunc(Number(category)) | 0;
  if (c < DAMAGE_TERM_CATEGORY_MIN || c > DAMAGE_TERM_CATEGORY_MAX) return null;
  return DAMAGE_TERM_HANDLERS[c - DAMAGE_TERM_CATEGORY_MIN] ?? null;
}

/**
 * Every category that occurs in a shipped technique table.
 *
 * This is the census the port is held to: a category with no handler is a technique in
 * the disc's own data whose line the walker would have had to invent.
 */
export function damageTermCategoriesIn(
  table: Readonly<Record<string, Partial<DamageTermRecord>>>,
): number[] {
  const seen = new Set<number>();
  for (const row of Object.values(table ?? {})) {
    const c = Math.trunc(Number(row?.category ?? 0)) | 0;
    if (c >= DAMAGE_TERM_CATEGORY_MIN && c <= DAMAGE_TERM_CATEGORY_MAX) seen.add(c);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * How ONE technique's result reaches the box, decided by its own record.
 *
 * This is the whole-system question the port answers for all 443 rows at once: which of
 * the record machine's five arms a technique lands on, what page that arm asks for when
 * the technique's own effect lands, and what it asks for when nothing lands. `clip` is
 * record byte `+0x10`, the animation the technique plays — carried here so a census can
 * group the rows by it, and marked `presentationOnly` because the record machine never
 * reads it: its apply arm is entered from the technique-execution object's own step and
 * its only gate is the record's category byte (`fightstg.s:13114`).
 */
export interface TechniqueResultPath {
  /** `self+0x54`, the technique id, which indexes the record. */
  techniqueId: number;
  /** record `+0x04`, the attack category the five-word table is indexed by. */
  category: number;
  /** The arm's address, or null when `sltiu` rejects the category (no page at all). */
  handler: number | null;
  /** The page kind when the technique's effect lands, or null when the arm builds none. */
  landed: number | null;
  /** The page kind when nothing lands, or null. */
  missed: number | null;
  /** record `+0x10`, the action clip. Presentation only. */
  clip: number;
}

/** The result path of one technique id in a shipped table. */
export function techniqueResultPath(
  table: Readonly<Record<string, Partial<DamageTermRecord>>>,
  techniqueId: number,
): TechniqueResultPath {
  const id = Math.trunc(Number(techniqueId)) | 0;
  const record = table?.[String(id)] ?? null;
  const category = Math.trunc(Number(record?.category ?? 0)) | 0;
  const base = {
    techniqueId: id,
    category,
    handler: damageTermHandler(category),
    clip: Math.trunc(Number(record?.clip ?? 0)) | 0,
  };
  // A context whose only decided inputs are the record itself: a heal arm reads the
  // amount and the missing HP, and both are supplied by the caller, so a technique whose
  // page depends on them is reported as asking for a page (never as "no page").
  const page = damageTermPage(record, {
    techniqueId: id, side: 0, name: "", damage: 1, hitCount: 1,
    landed: true, applied: false, retaliated: false, suppressed: false,
  }, { missingHp: 1, overhealGap: 1 });
  const miss = damageTermPage(record, {
    techniqueId: id, side: 0, name: "", damage: 0, hitCount: 1,
    landed: false, applied: false, retaliated: false, suppressed: false,
  }, { missingHp: 1, overhealGap: 1 });
  return { ...base, landed: page?.kind ?? null, missed: miss?.kind ?? null };
}

/**
 * Every row of a shipped table's result path, ascending by technique id.
 *
 * The census the port is held to: one entry per disc record, each with its arm decided
 * and both of its page outcomes decided (a `null` is the original's own "builds no page",
 * which is a decision, not a gap).
 */
export function techniqueResultPaths(
  table: Readonly<Record<string, Partial<DamageTermRecord>>>,
): TechniqueResultPath[] {
  return Object.keys(table ?? {})
    .map((key) => techniqueResultPath(table, Number(key)))
    .sort((a, b) => a.techniqueId - b.techniqueId);
}

/** The technique ids of one category in a shipped table, ascending. */
export function damageTermTechniqueIds(
  table: Readonly<Record<string, Partial<DamageTermRecord>>>,
  category: number,
): number[] {
  const c = Math.trunc(Number(category)) | 0;
  const ids: number[] = [];
  for (const [key, row] of Object.entries(table ?? {})) {
    if ((Math.trunc(Number(row?.category ?? 0)) | 0) !== c) continue;
    ids.push(Math.trunc(Number(key)) | 0);
  }
  return ids.sort((a, b) => a - b);
}

/**
 * The page the record machine asks for, or null when it asks for none.
 *
 * Every branch is one arm of one handler, with the assembly that selects it.
 */
export function damageTermPage(
  record: Partial<DamageTermRecord> | null | undefined,
  ctx: DamageTermContext,
  options: DamageTermOptions = {},
): BattleMessagePage | null {
  const handler = damageTermHandler(record?.category ?? 0);
  if (handler === null || !record) return null;
  const id = Math.trunc(Number(ctx.techniqueId)) | 0;
  switch (handler) {
    // 0x8008f9a8 — categories 2 and 3 share this body, so one implementation serves 402
    // of the 443 techniques. The order of the tests is the original's.
    case 0x8008f9a8: {
      // `lbu $v0, 0x42($s0)` / `beqz $v0, .L0x8008f9e4` — flagged, and the arm instead
      // runs FIGHTSTG_F0x8009ce84(techniqueId) and writes phase 3 straight back
      // (`j .L0x80090b24` / `li $v0, 0x3`), so NO page is built.
      if (ctx.suppressed) return null;
      // `lbu $v0, 0x41($s0)` / `beqz $v0, .L0x8008fab0` — the applier has already run
      // once, so this is a later application of the same technique.
      if (ctx.applied) {
        // `lui $a0, 0x8004` / `addiu $a0, 0x2bdc` / `addiu $v1, -0x1` then
        // `lbu $v1, 0xa($v0)`: the record's dispatch byte at
        // `0x80042bca + 18 * (techniqueId - 1)`.
        if ((Math.trunc(Number(record.dispatch ?? 0)) | 0) === DAMAGE_TERM_REPEAT_WORD) {
          // The running total is `ctx+0x60 + ctx+0x64` (`:13154`/`:13155`/`:13157`), and the
          // page is **kind 4** — `li $a1, 0x4` at fightstg.s:13156 `.L0x8008fa28` — reached
          // through `j .L0x8008fb64` (`:13164`), the shared `jalr` the evasion arm also
          // lands on. Word 0 comes from `sllv $v0, $s1, $a1` with `$a1` = 4 and `$s1` =
          // `sltiu $s1, $v0, 0x1` over the side, so it is 16 for the player's partner and 0
          // for the enemy; word 1 is that total (`:13162 sw $v1, 0x68($s4)`). So the player
          // reads `<name>` / `<total> damage!` on this arm too.
          return withPayloadWord(battleMessagePage(4, {
            name: ctx.name,
            numbers: [Math.trunc(Number(ctx.accumulatedTotal ?? ctx.damage)) | 0],
          }), 0, damageTermNameSelector(ctx.side));
        }
        // `li $v0, 0x1f` with `bne $v1, $v0, .L0x8008fa50` NOT taken, so the fall-through
        // writes the CONSTANT 31 into word 0 — not the record's byte. Word 1 is
        // `ctx+0x28`, word 2 `ctx+0x34`, and the kind-16 arm fills slots 1 and 2 from
        // words 1 and 2 with slot 3 their product, so the player reads
        // "<damage> X <hits> = <total>!". `self+0x58` is then the product clamped to 9999.
        return battleMessagePage(16, {
          name: ctx.name,
          numbers: [ctx.damage, ctx.hitCount],
        });
      }
      // `lbu $v0, 0x3e($s0)` / `beqz $v0, .L0x8008fb08`. The arm it skips is the
      // retaliation bookkeeping (`jal FIGHTSTG_F0x8009cf54`), which ends by writing
      // phase 3 — no page of its own.
      if (ctx.retaliated) return null;
      // `lbu $v0, 0x30($s4)` — the hit flag the accuracy leaves write
      // (`docs/research/battle/battle-formula-leaves.md` §2: `sb v0, +0x30`).
      if (ctx.landed) {
        // Word 0 is `sll $v0, $s1, 0x4` (:13215 / :13216) and word 1 `ctx+0x28` (:13217 /
        // :13219), then `li $a1, 0x4` (:13221).
        return withPayloadWord(battleMessagePage(4, { name: ctx.name, numbers: [ctx.damage] }),
          0, damageTermNameSelector(ctx.side));
      }
      // `li $v0, 0x1d` into word 0 (:13229 / :13230) with the same `sll` word in word 1
      // (:13231 / :13232), then `li $a1, 0x2` (:13234).
      return withPayloadWord(
        battleMessagePage(2, { name: ctx.name, index: DAMAGE_TERM_EVADE_WORD }),
        1, damageTermNameSelector(ctx.side));
    }
    // 0x8008fbec — the heal-and-cure family. `lbu $v0, 0x50($s4)` / `sw $v0, 0x64($s4)`
    // (fightstg.s:13271 `.L0x8008fbec` / :13273) puts the SIDE in payload word 0, and the
    // technique-id tests come first.
    //
    // The whole branch now runs `category4RestorePlan`, so the page and the HEAL it
    // describes come off the SAME arm classifier (damageTermCategory4Arm) and cannot drift.
    // The slot table is built from the summary options: `missingHp` is the ACTIVE slot's
    // `max - current`, `ailmentMask` the ACTIVE slot's `+0x1c` byte and `overhealGap` the
    // missing HP the other two slots carry. Every slot is `present` and alive at hp 1,
    // which is what the original's three walks test before they touch HP.
    case 0x8008fbec: {
      const active = Math.max(0, Math.trunc(Number(ctx.activeSlot ?? 0)) | 0);
      const side = Math.trunc(Number(ctx.side)) | 0;
      const missingHp = Math.max(0, Math.trunc(Number(options.missingHp ?? 0)) | 0);
      const overhealGap = Math.max(0, Math.trunc(Number(options.overhealGap ?? 0)) | 0);
      const ailments = Math.trunc(Number(options.ailmentMask ?? 0)) | 0;
      const party: Category4Slot[] = [0, 1, 2].map((i) => ({
        present: true,
        hp: 1,
        maxHp: 1 + (i === active ? missingHp : overhealGap),
        ailments: i === active ? ailments : 0,
      }));
      const plan = category4RestorePlan(record, id, {
        side, wisdom: Number(options.wisdom ?? 0), activeSlot: active,
        name: ctx.name, healAmount: Math.trunc(Number(ctx.damage)) | 0,
      }, { [side]: party });
      return plan ? plan.page : null;
    }
    // 0x8009021c — the hand-written techniques. `lw $v1, 0x54($s4)` (:13668) is the
    // technique id and the nine comparisons that follow (:13670-:13712) are the whole
    // classifier, so every branch below asks the ARM TABLE which arm the id lands on
    // (`damageTermCategory5Arm`) instead of repeating an id test of its own.
    case 0x8009021c: {
      const arm = damageTermCategory5Arm(id);
      if (!arm) {
        // Every other id falls through the comparisons to `j .L0x8009096c`, the machine's
        // own finish, with no page (:13683 / :13706 / :13711).
        return null;
      }
      const row = damageTermStatRow(id);
      const acting = Math.trunc(Number(ctx.side)) | 0;
      const targetSide = options.targetSide ?? damageTermCategory5Side(arm, acting, row);
      if (arm.effect === "statOne" && row) {
        // `.L0x800902dc`: kind 2 (`li $a1, 0x2` :14022) with word 0 = the row's `+0x6`
        // word (`lh $v0, 0x6($s3)` :13777 / `sw $v0, 0x64($s4)` :13779), word 1 =
        // `$s2 << 4` over the side this arm picked (`sll $s2, 0x4` :13760 over
        // `srl $s2, $v1, 0x4` :13734, stored by `sw $s2, 0x68($s4)` :13778) and word 2
        // = that side's active index (`lw $v0, 0x8($s0)` :13780 / `sw $v0, 0x6c($s4)`
        // :13782). The gate refusal is its own page: `li $v0, 0x2f` into word 0 :13745
        // with kind 1 in the `move_ $a1, $a0` delay slot :13744.
        const refused = options.refused === true;
        if (refused) return battleMessagePage(1, { index: DAMAGE_TERM_NO_EFFECT_WORD });
        // Word 1 is `$s2 << 4` where `$s2` is the side this arm picked (`sll $s2, 0x4`
        // :13760 over the `srl $s2, $v1, 0x4` at :13734, so 0 for the player and 16 for the
        // enemy). That is the TARGET side, not `damageTermNameSelector`'s `sltiu` shape,
        // which the category-2/3 arms use (:13133) and which reads 16 for the player --
        // this arm's word is the other way round, and the census compares it literally.
        return withPayloadWord(
          withPayloadWord(
            battleMessagePage(2, { name: ctx.name, index: row.word }),
            1, targetSide < 1 ? 0 : 0x10),
          2, options.activeSlot ?? 0);
      }
      if (arm.effect === "statParty" && row) {
        // `.L0x800903f4`: kind 9 (`li $a1, 0x9` :13859) whose word 1 is the stat's own
        // code (:13847/:13852/:13855/:13848) and whose word 0 is the RAW acting-side byte
        // `lbu $v0, 0x50($s4)` :13803 / `sw $v0, 0x64($s4)` :13840. Kind 9 reads word 0 as
        // the side its ten-row scan walks (`.L0x80098de0`), so 0 is the player's party and
        // 0x10 the enemy's.
        return battleMessagePage(9, {
          name: ctx.name, words: [acting < 1 ? 0 : 0x10, damageTermPartyWord(row.stat)],
        });
      }
      if (arm.effect === "affinity") {
        // `.L0x80090528`: the Chi save. `li $v0, 0x36` (:13877) / `sw $v0, 0x64($s4)`
        // (:13878) / `sw $v1, 0x68($s4)` (:13874) with the RAW side byte
        // `lbu $v1, 0x50($s4)` (:13861) in word 1, then kind 2 (:13883).
        return withPayloadWord(
          battleMessagePage(2, { name: ctx.name, index: DAMAGE_TERM_CHI_WORD }),
          1, acting < 1 ? 0 : 0x10);
      }
      if (arm.effect === "lockFlee" || arm.effect === "lockDigivolve") {
        // `.L0x80090584` / `.L0x800905c8`: the ROLL. A lost roll reads `esmfight[0x2f]`
        // "No effect!" on LINE ONE through kind 1: `beqz $v0, .L0x800905b8` :13888 has
        // `li $v0, 0x2f` :13889 in its DELAY slot, so `$v0` is 0x2f whichever way the
        // branch goes, and the branch's own target stores it -- `sw $v0, 0x64($s4)`
        // :13896 (212: :13906 / :13907 / :13914) -- before asking kind 1 (`li $a1, 0x1`
        // :13899 / :13917, the `j`'s delay slot).
        // The previous revision of this file called that store "the getter's own zero
        // return" and read a BLANK box; the delay slot is what puts 0x2f in `$v0`.
        if (!options.rollLanded) {
          return battleMessagePage(1, { index: DAMAGE_TERM_NO_EFFECT_WORD });
        }
        // A landed roll asks kind 2 with the word and word 1 = 0 (`sw $zr, 0x68($s4)`
        // in the `j`'s delay slot, :13895 / :13913).
        return withPayloadWord(
          battleMessagePage(2, {
            name: ctx.name,
            index: arm.effect === "lockFlee"
              ? DAMAGE_TERM_CANNOT_RUN_WORD : DAMAGE_TERM_CANNOT_DIGIVOLVE_WORD,
          }), 1, 0);
      }
      if (arm.effect === "statusOnly") {
        // `.L0x80090610`: a lost roll asks kind 1 with `esmfight[0x2f]` "No effect!" on line
        // one -- `beqz $v0, .L0x80090644` :13914 carries `li $v0, 0x2f` :13915 in its
        // DELAY slot and the branch target stores it (`sw $v0, 0x64($s4)` :13931) before
        // `li $a1, 0x1` :13937. A landed roll runs `FIGHTSTG_F0x8009cff4`, writes 3 into
        // the panel's `+0xc` (:13930) and jumps to the machine's finish, so it builds NO
        // page at all.
        return options.rollStatusLanded
          ? null
          : battleMessagePage(1, { index: DAMAGE_TERM_NO_EFFECT_WORD });
      }
      if (arm.effect === "mpDrain") {
        // `.L0x80090654` — the MP transfer off the player's active fighter onto the
        // enemy's: word 0 = the source's remaining MP (:13992), word 1 = the amount moved
        // (:13994), word 2 = 1 (:13995), and kind 18 — `li $a1, 0x12` at :13998 is the
        // delay slot of `j .L0x800907b4` at :13997. Word 2 being non-zero is what makes
        // the arm print `esmfight[0x8f]` "{1} MP absorbed!" over `esmfight[0x22]`.
        const moved = Math.trunc(Number(options.mpMoved ?? 0)) | 0;
        if (moved <= 0) {
          // `beqz $a2, .L0x8009072c` :13946 jumps to `j .L0x800907a0` :13989, whose delay
          // slot `li $v0, 0x2f` :13990 loads the refusal. That lands ON the landed arm's
          // own tail: `sw $v0, 0x64($s4)` :14018 / `li $v0, 0x10` :14019 /
          // `sw $v0, 0x68($s4)` :14020, then `li $a1, 0x2` :14022 -- so the refusal is
          // KIND 2 with `esmfight[0x2f]` "No effect!" on LINE TWO and 0x10 in word 1,
          // the same kind and word 1 the landed page uses.
          return withPayloadWord(
            battleMessagePage(2, { name: ctx.name, index: DAMAGE_TERM_NO_EFFECT_WORD }),
            1, 0x10);
        }
        return battleMessagePage(18, { name: ctx.name, numbers: [moved], mp: true });
      }
      if (arm.effect === "healCharge") {
        // `.L0x80090734`: restores the target (`sh $v0, 0x8($s0)` :14006), then
        // `li $v0, 0x46` :14017 into word 0 (`sw $v0, 0x64($s4)` :14018) and 0x10
        // (:14019) into word 1 (:14020), then kind 2 (`li $a1, 0x2` :14022).
        return withPayloadWord(
          battleMessagePage(2, { name: ctx.name, index: DAMAGE_TERM_GENERATE_WORD }),
          1, 0x10);
      }
      return null;
    }
    // 0x800907cc — the Blast finishers. `lbu $v0, 0x7($s5)` / `addiu $v0, 0x61` /
    // `sw $v0, 0x64($s4)` then `li $a1, 0x1`.
    case 0x800907cc:
      return battleMessagePage(1, {
        index: (Math.trunc(Number(record.elem1 ?? 0)) | 0) + DAMAGE_TERM_BLAST_WORD_BASE,
      });
    default:
      return null;
  }
}

/**
 * The `esmfight` word each category-5 stat technique prints, from the two eight-byte
 * tables at `.L0x800a33cc` (:33855-:33872) and `.L0x800a3414` (:33873-:33882).
 *
 * Each record is `{i16 techniqueId, i16 singleTarget, i16 guardSlot, i16 esmfightWord}`
 * and the reader uses the fourth halfword (`lh $v0, 0x6($s3)`).
 */
export const DAMAGE_TERM_STAT_WORDS: Readonly<Record<number, number>> = Object.freeze({
  198: 0x30, 200: 0x31, 202: 0x32, // Strength / Defense / Speed [arrow-up]!
  199: 0x30, 201: 0x31, 203: 0x32, // the f3=4 pair of the same three
  204: 0x33, 205: 0x34, 206: 0x34, 207: 0x35, 208: 0x35, // and the [arrow-down] words
});

/** The word a category-5 stat technique prints, or null when its id is not in the tables. */
export function damageTermStatWord(techniqueId: number): number | null {
  const id = Math.trunc(Number(techniqueId)) | 0;
  const word = DAMAGE_TERM_STAT_WORDS[id];
  return word === undefined ? null : word;
}

// ── The post-hit secondary-effect dispatcher — FIGHTSTG_F0x8009df78 ────────────────────
//
// A DIFFERENT machine from the record walker above. Where F0x8008f714 picks the *page*
// a technique prints, F0x8009df78 runs the technique's own secondary effect on the
// fighter it hit. It is the shared dispatcher every secondary-effect applier hangs from
// (the poison/frozen/confuse/sleep/KO/drain family named in
// docs/research/battle/battle-formula-leaves.md) plus the three arms that write the
// **persistent stat penalty** the inn later rests away — a producer this engine had
// modelled only as a *consumer* (engine/dw3/equipment.ts subtracts the penalty halfwords;
// engine/dw3/ui/native/inn-screen.ts clears them) and never as a writer.
//
//   fightstg.s:28101 `.L0x8009df78` lui  $v0, 0x800a
//   fightstg.s:28102 `.L0x8009df7c` lw   $v1, 0x4418($v0)   # the action's technique id (ctx)
//   fightstg.s:28105 `.L0x8009df88` sll  $v0, $v1, 0x3      # v*18 == the 0x12 stride
//   fightstg.s:28106 `.L0x8009df8c` addu $v0, $v1
//   fightstg.s:28107 `.L0x8009df90` sll  $v0, 0x1
//   fightstg.s:28108 `.L0x8009df94` lui  $v1, 0x8004
//   fightstg.s:28109 `.L0x8009df98` addiu $v1, 0x2bca        # 0x80042bca + 18*id
//   fightstg.s:28112 `.L0x8009dfa0` lbu  $v0, 0xa($v0)       # record +0x0a, the effect byte
//   fightstg.s:28114 `.L0x8009dfa8` addiu $v1, $v0, -0x2     # index = dispatch - 2
//   fightstg.s:28115 `.L0x8009dfac` sltiu $v0, $v1, 0x21     # 33 arms, dispatch 2..34
//   fightstg.s:28119 `.L0x8009dfb8` addiu $v0, 0x3234
//   fightstg.s:28123 `.L0x8009dfc4` lw   $v0, ($v1)
//   fightstg.s:28124 `.L0x8009dfc8` jr   $v0
//
// The 33 words live at `.L0x80083234` (fightstg.s:343-:375). A word of `0x8009e0bc` is the
// dispatcher's own `lw $ra, 0x10($sp)` epilogue — an arm that does NOTHING. The rest are
// the `jal` targets in the dispatcher body (fightstg.s:28130-28199).

/** The 33-word arm table, `.L0x80083234` (fightstg.s:343). */
export const DAMAGE_TERM_POST_HIT_TABLE = 0x80083234;
/** The first dispatch byte the table answers for (`addiu $v1, $v0, -0x2`). */
export const DAMAGE_TERM_POST_HIT_FIRST = 2;
/** `sltiu $v0, $v1, 0x21` — dispatch 2..34. */
export const DAMAGE_TERM_POST_HIT_COUNT = 33;
/** An arm word equal to this is the dispatcher's bare-return epilogue: nothing runs. */
export const DAMAGE_TERM_POST_HIT_RETURN = 0x8009e0bc;

export interface DamageTermPostHitArm {
  /** record +0x0a, the effect/dispatch byte. */
  dispatch: number;
  /** the arm's entry address in fightstg.s, or `DAMAGE_TERM_POST_HIT_RETURN`. */
  arm: number;
  /** the effect the arm applies, where a canonical document establishes it; else null. */
  role: string | null;
  /**
   * The ported body for a dispatch whose applier has been read off the disc, or
   * absent when only the arm address (or nothing) is established. The penalty
   * family (32/33/34) is applied by `applyDamageTermPenalty`, which takes a
   * different input, and is not carried here.
   */
  applier?: (input: DamageTermApplierInput) => DamageTermApplierResult;
}

/**
 * Every word of `.L0x80083234`, in index order, as `dispatch = index + 2`. The applier
 * roles for dispatches 2/3/4/5/6/8 are the f7 table of
 * docs/research/battle/battle-formula-leaves.md ("Skill effect-TYPE table"); the three
 * `stat-penalty` arms at 32/33/34 are docs/research/ui/inn-rest-service-decoded-2026-08-13.md
 * §8 (claim `EQUIP-C026`), corrected here from its mis-cited "26/27/28" to the dispatch
 * bytes the table actually carries.
 */
export const DAMAGE_TERM_POST_HIT_ARMS: readonly DamageTermPostHitArm[] = Object.freeze([
  { dispatch: 2, arm: 0x8009d140, role: "poison", applier: applyDamageTermPoison },
  { dispatch: 3, arm: 0x8009d1dc, role: "frozen" },
  { dispatch: 4, arm: 0x8009d2c4, role: "confusion" },
  { dispatch: 5, arm: 0x8009d3ac, role: "sleep", applier: applyDamageTermSleep },
  { dispatch: 6, arm: 0x8009d470, role: "instant-death" },
  { dispatch: 7, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 8, arm: 0x8009d61c, role: "drain" },
  { dispatch: 9, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 10, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 11, arm: 0x8009d768, role: "party-stat-read" },
  { dispatch: 12, arm: 0x8009d7a4, role: "weapon-roll-arm" },
  { dispatch: 13, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 14, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 15, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 16, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 17, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 18, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 19, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 20, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 21, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 22, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 23, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 24, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 25, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 26, arm: 0x8009d858, role: null },
  { dispatch: 27, arm: 0x8009d944, role: null },
  { dispatch: 28, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 29, arm: 0x8009da0c, role: null },
  { dispatch: 30, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 31, arm: DAMAGE_TERM_POST_HIT_RETURN, role: null },
  { dispatch: 32, arm: 0x8009daac, role: "stat-penalty" },
  { dispatch: 33, arm: 0x8009db94, role: "stat-penalty" },
  { dispatch: 34, arm: 0x8009dc8c, role: "stat-penalty" },
]);

/** The arm for a record's `+0x0a` effect byte, or null when the table does not answer. */
export function damageTermPostHitArm(dispatch: number): DamageTermPostHitArm | null {
  const d = Math.trunc(Number(dispatch)) | 0;
  if (d < DAMAGE_TERM_POST_HIT_FIRST || d >= DAMAGE_TERM_POST_HIT_FIRST + DAMAGE_TERM_POST_HIT_COUNT) {
    return null;
  }
  return DAMAGE_TERM_POST_HIT_ARMS[d - DAMAGE_TERM_POST_HIT_FIRST] ?? null;
}

/** Whether a dispatch's arm actually runs, as opposed to falling to the bare return. */
export function damageTermPostHitArmRuns(dispatch: number): boolean {
  const arm = damageTermPostHitArm(dispatch);
  return arm !== null && arm.arm !== DAMAGE_TERM_POST_HIT_RETURN;
}

// ── The persistent stat-penalty producer — dispatches 32 / 33 / 34 ─────────────────────
//
// The arm addresses the dispatcher routes these three to, and what each one writes:
//
//   F0x8009daac (dispatch 32): one landing roll, then adds the technique's `+0x0c`
//     magnitude to a SINGLE penalty slot chosen by a fresh random draw's low bit
//     (fightstg.s:281xx `.L0x8009dad0` srl $v1, $v0, 0x1f … `.L0x8009db48` sll $v1, $s2, 0x1).
//   F0x8009db94 (dispatch 33): THREE rolls, one per slot; each success adds the magnitude
//     to that slot (fightstg.s:281xx `.L0x8009dc10`-`.L0x8009dc64` loop `slti $v0, $s1, 0x3`).
//   F0x8009dc8c (dispatch 34): ONE roll, then adds the magnitude to ALL THREE slots
//     (fightstg.s:281xx `.L0x8009dd14`-`.L0x8009dd30` `addiu $a0, 0x2`).
//
// The slots are the three consecutive halfwords at roster `+0x42`/`+0x44`/`+0x46` of the
// member reached through `[0x80048d34]->0x2718(player index)->0x2750(...)` (F0x80017b4c
// returns `&DIGIMON_CUR_STATS + slot*0x3dc`). WHICH stat each slot is, and the target-member
// rule, are the mapping shipped alongside this producer (`DAMAGE_TERM_PENALTY_SLOT_STATS`,
// `damageTermPenaltyByStat`). The engine's persistent fighter model stores them —
// `Combatant.statPenalty` (engine/dw3/battle-combat.ts), written by `addStatPenalty` and
// subtracted in `effStats`; the disc clears them only at the party rest F0x8001104c
// (`clearStatPenalty`).

/** record `+0x0a` values whose arm writes the persistent penalty. */
export const DAMAGE_TERM_PENALTY_DISPATCHES: readonly number[] = Object.freeze([32, 33, 34]);
/** The three penalty halfwords, roster `+0x42` stride 2 (`.L0x8009dd30` addiu $a0, 0x2). */
export const DAMAGE_TERM_PENALTY_SLOT_COUNT = 3;
/** Where the first penalty halfword sits inside the persistent member record. */
export const DAMAGE_TERM_PENALTY_BASE_OFFSET = 0x42;
/** The landing roll the three arms share — `.L0x800a4644: .word 0x800a1458` (fightstg.s:35037). */
export const DAMAGE_TERM_PENALTY_ROLL = 0x800a1458;

/** How a penalty arm spreads one landing roll over the three slots. */
export type DamageTermPenaltyMode = "one" | "per-slot" | "all";

/** The slot-spread mode for a dispatch, or null when the dispatch is not a penalty arm. */
export function damageTermPenaltyMode(dispatch: number): DamageTermPenaltyMode | null {
  const d = Math.trunc(Number(dispatch)) | 0;
  if (d === 32) return "one";
  if (d === 33) return "per-slot";
  if (d === 34) return "all";
  return null;
}

/**
 * `FIGHTSTG_F0x800a1458` — the stat-penalty landing roll. Chance is the technique's
 * `+0x0b` byte plus `trunc((wisHigh − wisLow) / 8)`; success is `(rand & 0x7f) < chance`.
 *
 *   fightstg.s:31900 `.L0x800a149c` lh  $v1, 0x8($v0)   # eff block 0x800a4580 +0x08 (WIS)
 *   fightstg.s:31901 `.L0x800a14a0` lh  $v0, 0x48($v0)  # eff block 0x800a45c0 +0x08 (WIS)
 *   fightstg.s:31903 `.L0x800a14a8` subu $s0, $v1, $v0
 *   fightstg.s:31911 `.L0x800a14c4` lbu $v1, 0xb($v0)   # record +0x0b, effect_p1
 *   fightstg.s:31912 `.L0x800a14c8` bgez $s0, …          # the +7 is the divide's sign fix
 *   fightstg.s:31916 `.L0x800a14d4` sra $s0, 0x3
 *   fightstg.s:31921 `.L0x800a14e8` addu $s0, $v1, $s0
 *   fightstg.s:31922 `.L0x800a14ec` andi $v0, 0x7f
 *   fightstg.s:31923 `.L0x800a14f0` slt  $v0, $s0       # returns (rand&0x7f) < chance
 */
export function damageTermPenaltyRoll(
  effectP1: number,
  wisHigh: number,
  wisLow: number,
  rng: () => number,
): boolean {
  const diff = (Math.trunc(Number(wisHigh)) | 0) - (Math.trunc(Number(wisLow)) | 0);
  const chance = (Math.trunc(Number(effectP1)) | 0) + Math.trunc(diff / 8);
  return (rng() & 0x7f) < chance;
}

export interface DamageTermPenaltyInput {
  /** record +0x0b, the arm's landing threshold. */
  effectP1: number;
  /** effective block `0x800a4580 + 0x08` (the acting side's WIS). */
  wisHigh: number;
  /** effective block `0x800a45c0 + 0x08` (the other side's WIS). */
  wisLow: number;
  /** record +0x0c, the amount added to a slot. */
  magnitude: number;
  /** record +0x0a, selecting 32 / 33 / 34. */
  dispatch: number;
  rng: () => number;
}

export interface DamageTermPenaltyResult {
  /** the three slots after the arm ran. */
  slots: number[];
  /** `ctx + 0x38 + dispatch`: the result-queue slot the arm leaves behind. */
  queueWord: number;
}

/**
 * The three penalty arms, ported. The roll order is the original's: dispatch 32 draws the
 * slot bit first, dispatch 33 rolls once per slot, dispatch 34 rolls once for all three.
 * The result-queue word is `1 << slot` (32), the OR of `1 << i` (33) or the literal 7 (34).
 */
export function applyDamageTermPenalty(
  slots: readonly number[],
  input: DamageTermPenaltyInput,
): DamageTermPenaltyResult {
  const out: number[] = [];
  for (let i = 0; i < DAMAGE_TERM_PENALTY_SLOT_COUNT; i += 1) {
    out.push(Math.trunc(Number(slots[i] ?? 0)) | 0);
  }
  const mag = Math.trunc(Number(input.magnitude)) | 0;
  const roll = () => damageTermPenaltyRoll(input.effectP1, input.wisHigh, input.wisLow, input.rng);
  const mode = damageTermPenaltyMode(input.dispatch);
  if (mode === "all") {
    // F0x8009dc8c: one roll, then all three slots.
    if (roll()) {
      for (let i = 0; i < out.length; i += 1) out[i] = ((out[i] ?? 0) + mag) | 0;
      return { slots: out, queueWord: 0x7 };
    }
    return { slots: out, queueWord: 0 };
  }
  if (mode === "per-slot") {
    // F0x8009db94: one roll inside the three-iteration loop.
    let queueWord = 0;
    for (let i = 0; i < out.length; i += 1) {
      if (roll()) {
        out[i] = ((out[i] ?? 0) + mag) | 0;
        queueWord |= 1 << i;
      }
    }
    return { slots: out, queueWord };
  }
  if (mode === "one") {
    // F0x8009daac: the slot bit is drawn BEFORE the roll.
    const slot = input.rng() & 1;
    if (roll()) {
      out[slot] = ((out[slot] ?? 0) + mag) | 0;
      return { slots: out, queueWord: 1 << slot };
    }
    return { slots: out, queueWord: 0 };
  }
  return { slots: out, queueWord: 0 };
}

// ── WHICH STAT each penalty halfword carries — the per-slot mapping ───────────────────
//
// The three slots are the three halfwords `+0x42`/`+0x44`/`+0x46` of the persistent
// roster member (`&DIGIMON_CUR_STATS + slot*0x3dc + 0x42`, from F0x80017b4c). They are
// the SAME three halfwords the shared effective-stat builder F0x80017174 reads as
// `+0x26`/`+0x28`/`+0x2a` of its 0x2C-byte copy of the member's stat block — the copy
// starts at `D0x80048d34 + 0x784 == DIGIMON_CUR_STATS + 0x1C`, so copy `+0x26` is
// member `+0x42` exactly (0x8004949c + 0x42 == 0x800494b8 + 0x26 == 0x800494DE). That
// builder subtracts each halfword from one core stat and floors at 0 (`sh $zr` on the
// sign test):
//
//   exe/fns.s:7919-7927  lhu $v0, 0xc($s3)  / lhu $v1, 0x26($s3) / subu / sh $v0, 0xc($s3)
//   exe/fns.s:7928-7936  lhu $v0, 0xe($s3)  / lhu $v1, 0x28($s3) / subu / sh $v0, 0xe($s3)
//   exe/fns.s:7937-7945  lhu $v0, 0x14($s3) / lhu $v1, 0x2a($s3) / subu / sh $v0, 0x14($s3)
//
// The copy's six core halfwords are `+0x0c..+0x16` = STR(POW), DEF, SPT, WIS, SPD, CHR
// (engine/dw3/effective-stats.ts `EFFECTIVE_SRC_OFFSET` and the family-2..14 / 15..20
// folds that write `buf + 0xc` / `buf + 0xe`; the status sheet prints the same six in
// the order POW, DEF, SPT, WIS, SPD, CHR). So:
//
//   member +0x42  ->  STR / POW   (copy +0x0c)   exe/fns.s:7919-7927
//   member +0x44  ->  DEF         (copy +0x0e)   exe/fns.s:7928-7936
//   member +0x46  ->  SPD         (copy +0x14)   exe/fns.s:7937-7945
//
// The status sheet's own reader agrees, and is a SECOND, independent consumer with the
// same three pairs: F0x80088a64's tail is `arg1->unkC -= arg1->unk26`, `unkE -= unk28`,
// `unk14 -= unk2a`, then floor at 0 (exe-decomp/stitshop_c/F0x80088a64.c:112-126; the
// display buffer's +0xC/+0xE/+0x14 are POW/DEF/SPD of the same six stats). Two routines
// naming the same three pairs is why this is a mapping, not one routine's convention.
//
// The appliers write `slot` = the offset index (`sh ...,0x42($base)` with `$base += 2`
// per iteration), so the SLOT order is the halfword order: slot 0 -> STR, 1 -> DEF,
// 2 -> SPD.

/** The stat each penalty slot lands on, in slot order (slot 0 = member `+0x42`). */
export const DAMAGE_TERM_PENALTY_SLOT_STATS = Object.freeze(["str", "def", "spd"] as const);

/** The core stat a penalty slot lands on. */
export type DamageTermPenaltyStat = (typeof DAMAGE_TERM_PENALTY_SLOT_STATS)[number];

/** The stat a penalty slot lands on, or null for a slot outside 0..2. */
export function damageTermPenaltySlotStat(slot: number): DamageTermPenaltyStat | null {
  const i = Math.trunc(Number(slot)) | 0;
  return DAMAGE_TERM_PENALTY_SLOT_STATS[i] ?? null;
}

/**
 * A penalty arm's three slots, keyed by the stat each one means — the form the battle's
 * stat path reads (`applyStatPenalty`, engine/dw3/battle-formulas.ts). A slot the arm did
 * not touch is reported as 0, so a caller always gets the whole record.
 */
export function damageTermPenaltyByStat(
  result: DamageTermPenaltyResult,
): Record<DamageTermPenaltyStat, number> {
  const out: Record<DamageTermPenaltyStat, number> = { str: 0, def: 0, spd: 0 };
  DAMAGE_TERM_PENALTY_SLOT_STATS.forEach((stat, i) => {
    out[stat] = Math.trunc(Number(result.slots[i] ?? 0)) | 0;
  });
  return out;
}

// ── The poison and sleep applier BODIES — dispatches 2 and 5 ───────────────────────────
//
// Each secondary-ailment arm runs the same three steps:
//
//   1. resolve the target record, `0x800a4470 + activeIndex*0x20` (the party block,
//      `activeIndex = *(0x800a4460 + (side!=0)*4 + 8)`), then add `side*0x60` to reach
//      the enemy block's copy for side 1;
//   2. call the arm's own landing roll through its method-table slot — poison
//      `obj+0xa4` (`0x800a4624` -> `0x800a0a18`), sleep `obj+0xb0` (`0x800a4630` ->
//      `0x800a0e68`), both called with `(side, techniqueId, record, side*0x60)`; the roll
//      returns `record+0x0c` on a landing and 0 on a miss;
//   3. on a landing, store the byte at `ctx + 0x38 + dispatch`, DOUBLED when the target's
//      record `+0x1b` tail byte is set, and leave a value in `v0`.
//
// The arms differ only in which byte they store:
//
//   F0x8009d140 (dispatch 2, poison): stores the ROLL'S OWN return, so `ctx+0x3a`
//     (`0x38 + 2`) carries the technique's magnitude. Returns the target's `+0x1b` byte
//     (0 on a miss). Bounded at its `jr $ra` + delay slot, `fightstg.s:27345`-`:27383`.
//   F0x8009d3ac (dispatch 5, sleep): stores the technique record's `+0x0c` magnitude
//     (`lbu $a0, 0xc($v1)`, `fightstg.s:27545`), doubled by the same `+0x1b` test, at
//     `ctx+0x3d` (`0x38 + dispatch`). Returns nothing. Bounded `fightstg.s:27509`-`:27557`.
//
// The stores are consecutive bytes: poison `ctx+0x3a`, frozen `0x442f` = `ctx+0x3b`
// (`fightstg.s:27438`), confusion `0x4430` = `ctx+0x3c` (`:27499`), sleep `ctx+0x3d`; the
// penalty arm at dispatch 34 writes the same `ctx + 0x38 + dispatch` form
// (`sb $v0, 0x38($v1)`, `fightstg.s:28168`). The landing roll is ported as
// `statusInflictionRoll` (engine/dw3/battle-formulas.ts) and the stager as
// `stageStatusEventAilment` (engine/dw3/battle-status-events.ts); these two bodies are
// the piece between them.

/** One post-hit applier's inputs — every field is a byte the disc body reads. */
export interface DamageTermApplierInput {
  /** `ctx+0x20`, the acting side byte (0 = player, non-zero = enemy). */
  side: number;
  /** `ctx+0x24`, the action's technique id. */
  techniqueId: number;
  /** record `+0x0a`, the dispatch byte that selected this arm. */
  dispatch: number;
  /** record `+0x0c`, the magnitude the sleep body stores (poison stores the roll itself). */
  magnitude: number;
  /** the target's `+0x1b` tail: `record + side*0x60 + 0x1b`. */
  tailByte: number;
  /**
   * The arm's landing-roll return byte: 0 = miss, else `record+0x0c`. The disc roll
   * (`F0x800a0a18` / `F0x800a0e68`) IS what `statusInflictionRoll` ports, so a caller
   * that uses the ported roll passes `landed ? magnitude : 0`.
   */
  rollValue: number;
}

/** What one post-hit applier body did. */
export interface DamageTermApplierResult {
  /** true when the roll returned a non-zero byte. */
  landed: boolean;
  /** the ctx-relative offset written (`0x38 + dispatch`), or null on a miss. */
  writeOffset: number | null;
  /** the byte written (masked to 8 bits, as `sb` does), or null on a miss. */
  value: number | null;
  /** the value left in `v0` — poison returns the target's `+0x1b`; sleep returns 0. */
  returns: number;
}

/**
 * `FIGHTSTG_F0x8009d140` (dispatch 2, poison). Stores the ROLL'S returned byte, doubled
 * by the target's `+0x1b`, at `ctx+0x3a`; returns the target's `+0x1b` (0 on a miss).
 */
export function applyDamageTermPoison(input: DamageTermApplierInput): DamageTermApplierResult {
  const rollValue = Math.trunc(Number(input.rollValue)) | 0;
  if (rollValue === 0) return { landed: false, writeOffset: null, value: null, returns: 0 };
  const tail = Math.trunc(Number(input.tailByte)) | 0;
  const value = tail !== 0 ? rollValue * 2 : rollValue;
  return { landed: true, writeOffset: 0x3a, value: value & 0xff, returns: tail & 0xff };
}

/**
 * `FIGHTSTG_F0x8009d3ac` (dispatch 5, sleep). Stores the technique record's `+0x0c`
 * magnitude, doubled by the target's `+0x1b`, at `ctx + 0x38 + dispatch`.
 */
export function applyDamageTermSleep(input: DamageTermApplierInput): DamageTermApplierResult {
  const rollValue = Math.trunc(Number(input.rollValue)) | 0;
  if (rollValue === 0) return { landed: false, writeOffset: null, value: null, returns: 0 };
  const magnitude = Math.trunc(Number(input.magnitude)) | 0;
  const tail = Math.trunc(Number(input.tailByte)) | 0;
  const value = tail !== 0 ? magnitude * 2 : magnitude;
  const dispatch = Math.trunc(Number(input.dispatch)) | 0;
  return { landed: true, writeOffset: 0x38 + dispatch, value: value & 0xff, returns: 0 };
}

/** The ported applier body for a dispatch, or null when the arm carries no body yet. */
export function damageTermPostHitApplier(
  dispatch: number,
): ((input: DamageTermApplierInput) => DamageTermApplierResult) | null {
  return damageTermPostHitArm(dispatch)?.applier ?? null;
}