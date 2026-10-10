// engine/dw3/ui/native/battle-message-pages.ts — one pure builder per PAGE KIND of the
// in-battle message box, so the walker can ask for the original's own page instead of
// typing its own sentence.
//
// The shared system this is: FIGHTSTG_F0x80099588 (`~/ddw3/asm/dw2003/pro/fightstg.s`
// `:23353`-`:24157`), the VM the battle message panel installs at its method `+0xac`
// (`FIGHTSTG_F0x8009a298 :24195`-`:24212`). It takes a KIND in `$a1` and a payload
// pointer in `$a2`, and builds the box's two text lines out of message bank `0x7f`
// (`esmfight`) plus three other banks. `.L0x8009960c` bounds the kind with
// `sltiu $v0, $v1, 0x16` over `kind - 1` (`:23388`-`:23391`), so kinds 1..22 have an arm
// in the 22-word jump table at `.L0x8008318c` (`:301`-`:322`) and everything else falls
// to `.L0x8009a204`, which writes no text and hides both lines.
//
// `engine/dw3/ui/native/battle-message-line.ts` already holds the arm TABLE (which
// index each line takes and which numbered slots the payload fills). This module holds
// the other half: for each kind, the payload words and the slot strings the original's
// own CALL SITE writes, so a caller supplies a name, an index or a number and gets the
// spec the original would have passed. `battleMessagePage()` is the one entry point;
// every kind is a pure function of its arguments.
//
// Decode: docs/research/battle/battle-message-page-kinds-2026-10-04.md, which reads the
// switch, all 22 arms and every `+0xac` call site in `pro/fightstg.s` and `pro/wfightmn.s`
// (the only two overlays that build a panel: 65 and 23 `jal FIGHTSTG_F0x8009a298` sites,
// and `pro/wfightts.s` has none).

import {
    BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_CURSE_INDEX, BATTLE_MESSAGE_KIND_MAX,
    type BattleMessageArm, battleMessageArm, battleMessageNamesLineOne,
} from "./battle-message-line.ts";

/**
 * One page the original's own call site would put up: the shared panel's
 * `unkAC(line, kind, payload)` call.
 *
 * It is the same shape as the `BattleMessageSpec` the session already opens, and it
 * carries the parts the original's call site supplies by hand:
 *
 *   `name`   the Digimon the shared tail FIGHTSTG_F0x80098d14 puts on line one. The
 *            original derives it from the workspace (`payload[0]`'s side test, `:24035`
 *            `lw $a2, ($s2)` / `:24037` `sltu $v0, $zr, $a2`; the tail's own test is
 *            FIGHTSTG_F0x80098d14 `:22789` `bnez $a2`); the browser reads the same record and names it.
 *   `index`  the `esmfight` index arms 1, 2 and 7 read straight out of the payload
 *            (`:23408 lw $a2, ($s2)`, `:23436 lw $a2, ($s2)`,
 *            `:23600 lw $a2, ($s2)`).
 *   `value`  the payload word arms 11, 15, 18 and 21 copy into the number slot.
 *   `numbers` the two (kind 16: three) numbers arms 4, 8, 11, 15, 16, 18 and 21 write
 *            through the element's `+0x118`.
 *   `slot`   the string arms 3, 5, 12, 13, 14, 17 and 22 write through `+0x120` — a
 *            technique name out of bank `0xa2`, an item name out of `0x6a`, a partner
 *            name out of `0x4e`.
 *   `mp`     kind 18's own test on the THIRD payload word (`:23975 lw $v0, 0x8($s2)` /
 *            `:23977 bnez`): nonzero picks `esmfight[0x8f]` `{1} MP absorbed!` over
 *            `esmfight[0x22]` `{1}HP healed!`.
 *   `stat`   kind 19's payload word, added to `esmfight` base `0x49` (`:24028 addiu $a2, 0x49`): 0 `Strength cursed!`, 1 `Defense cursed!`, 2 `Speed cursed!`.
 */
export interface BattleMessagePageArgs {
    name?: string | null;
    index?: number;
    value?: number;
    numbers?: readonly number[];
    slot?: string;
    mp?: boolean;
    stat?: number;
    /**
     * Kind 9's own payload words. `.L0x80099a04` copies `$a2` into the step ring
     * (`.L0x80099ae0`-`:80099af0` rebuild `$s2` as `self + 0x54 + 4*step`) and then runs
     * two helpers on it: `FIGHTSTG_F0x80098de0` reads word 0 as the side and word 1 as a
     * ten-row scan index (`.L0x8008313c`), and `FIGHTSTG_F0x80099140` reads word 1 again
     * as a ten-row page index (`.L0x80083164`). So kind 9 is the only arm whose text is
     * chosen by its payload and not by a fixed index, and the walker's callers hand it
     * those words.
     */
    words?: readonly number[];
}

export interface BattleMessagePage {
    kind: number;
    payload: number[];
    name: string | null;
    slots: string[];
}

/** The side-test word the original's sites write for "name the acting Digimon". */
const NAME_ACTOR = 0;
/** `payload[0] = 0x10` — the sites that name the other side of the fight (`:12776` etc.). */
const NAME_OTHER = 0x10;

function page(
    kind: number,
    payload: readonly number[],
    args: BattleMessagePageArgs,
    slots: readonly string[] = [],
): BattleMessagePage {
    const name = args.name ?? null;
    return {
        kind,
        payload: payload.slice(),
        // Arms 1, 9 and 20 never reach the shared tail, so nothing is named for them.
        name: battleMessageNamesLineOne(kind) ? name : null,
        slots: slots.slice(),
    };
}

const num = (n: number | undefined): string => String(Math.trunc(Number(n ?? 0)) | 0);

/**
 * The page for a kind, built the way the original's own call site builds it.
 *
 * Returns null for a kind the bound check rejects, exactly as `.L0x8009960c` does — so
 * a caller that passes an unported kind gets the original's empty arm rather than a
 * guess.
 */
export function battleMessagePage(
    kind: number,
    args: BattleMessagePageArgs = {},
): BattleMessagePage | null {
    const k = Math.trunc(Number(kind)) | 0;
    if (!battleMessageArm(k)) return null;
    const name = args.name ?? null;
    const index = Math.trunc(Number(args.index ?? 0)) | 0;
    const numbers = (args.numbers ?? []).map((n) => Math.trunc(Number(n) || 0));
    const value = Math.trunc(Number(args.value ?? 0)) | 0;
    const slot = args.slot ?? "";
    switch (k) {
        // `.L0x80099638`: line one is the caller's own index and NO name reaches either
        // line — the arm jumps straight to `.L0x8009a200`, skipping the shared tail.
        case 1: return page(k, [index], args);
        // `.L0x80099678`: the name, then the caller's index. "Attack!", "Evade!",
        // "Confused!" — the arm every outcome word goes through.
        case 2: return page(k, [index], args);
        // `.L0x800996f8`: `{1}!` with the technique name out of bank 0xa2 in slot 1
        // (`:23476 addiu $a0, 0xa2` / `:23479 lw $a2, 0x4($s2)`).
        case 3: return page(k, [NAME_OTHER, 0], args, [slot]);
        // `.L0x80099794`: `{1} damage!`, payload[1] into slot 1 (`:23512 lw $a2, 0x4($s2)`).
        case 4: return page(k, [NAME_ACTOR, numbers[0] ?? 0], args, [num(numbers[0])]);
        // `.L0x8009980c`: `Counter! {1}!` — the technique announcement, the technique
        // name out of bank 0xa2 by payload[1] (`:23545 addiu $a0, 0xa2` / `:23548 lw $a2, 0x4($s2)`).
        case 5: return page(k, [NAME_ACTOR, 0], args, [slot]);
        // `.L0x800998a8`: `Counter!` and nothing else on the elements.
        case 6: return page(k, [NAME_ACTOR], args);
        // `.L0x80099908`: line two is the caller's index (`:23600 lw $a2, ($s2)`).
        case 7: return page(k, [index], args);
        // `.L0x8009998c`: `{1}HP healed!`, payload[1] into slot 1.
        case 8: return page(k, [NAME_ACTOR, numbers[0] ?? 0], args, [num(numbers[0])]);
        // `.L0x80099a04`: the arm itself writes no text. It copies the payload into the
        // step ring (`:23657`-`:23659`), runs FIGHTSTG_F0x80098de0 (the candidate scan)
        // and FIGHTSTG_F0x80099140 (the apply pass, which fills LINE TWO through the
        // ten-row table at `.L0x80083164` and then lands on `.L0x8009a204`), which hides
        // both lines. `words` carries the ring words the caller wrote, so the payload a
        // census reads is the original's.
        case 9: return page(k, (args.words ?? []).map((w) => Math.trunc(Number(w) || 0)), args);
        // `.L0x80099a28`: `HP gradually recovers.` — the original writes NO slot, so the
        // amount stays on the HP plate.
        case 10: return page(k, [NAME_ACTOR, 0], args);
        // `.L0x80099ad4`: `{1}HP healed!` with the THIRD payload word
        // (`:23724 lw $a2, 0x8($s2)`).
        case 11: return page(k, [NAME_ACTOR, 0, value], args, [num(value)]);
        // `.L0x80099b90`: `Digivolved! {1}!` — the new form's name out of bank 0x4e by
        // payload[1] (`:23770 addiu $a0, 0x4e` / `:23773 lw $a2, 0x4($s2)`).
        case 12: return page(k, [NAME_ACTOR, 0], args, [slot]);
        // `.L0x80099c2c`: `Next Digimon out!` / `{1}!` — the partner name out of bank
        // 0x4e by payload[0] (`:23808 addiu $a0, 0x4e`; the shared tail `.L0x8009a1d8` reads payload[0] at `:24147`).
        case 13: return page(k, [index], args, [slot]);
        // `.L0x80099ca0`: the item announcement — `{1}!` with the item name out of bank
        // 0x6a by payload[1] (`:23838 addiu $a0, 0x6a` / `:23841 lw $a2, 0x4($s2)`; `FIGHTSTG_F0x8008dac0` step 0 asks for it at `:11161`).
        case 14: return page(k, [NAME_ACTOR, index], args, [slot]);
        // `.L0x80099d3c`: `Poisoned: {1}` with payload[2] (`:23874 lw $a2, 0x8($s2)`).
        case 15: return page(k, [0, 0, value], args, [num(value)]);
        // `.L0x80099dd4`: `{1} X {2} = {3}!` — slots 1 and 2 are payload[1] and
        // payload[2], and slot 3 is their product (`:23911`/`:23912` read the two,
        // `:23914 mult $a2, $v0` multiplies them and `:23931 move_ $a2, $s0`
        // carries the product into the third `+0x118`).
        case 16: {
            const a = numbers[0] ?? 0;
            const b = numbers[1] ?? 0;
            return page(k, [NAME_OTHER, a, b], args, [num(a), num(b), num(a * b)]);
        }
        // `.L0x80099e8c`: `Stole` / `{1}!` — the item name out of bank 0x6a by
        // payload[0] (`:23960 addiu $a0, 0x6a`; `FIGHTSTG_F0x80091534` asks for it at `:15005`).
        case 17: return page(k, [index], args, [slot]);
        // `.L0x80099f00`: `{1}HP healed!`, or `{1} MP absorbed!` when payload[2] is set
        // (`:23975 lw $v0, 0x8($s2)` / `:23977 bnez`).
        case 18: return page(k, [NAME_ACTOR, numbers[0] ?? 0, args.mp ? 1 : 0], args,
            [num(numbers[0])]);
        // `.L0x80099fb0`: the caller's index plus 0x49 (`:24008 addiu $a2, 0x49`).
        case 19: return page(k, [NAME_ACTOR, Math.trunc(Number(args.stat ?? 0)) | 0], args);
        // `.L0x8009a050`: the arm re-enters the VM with KIND 4 and the same payload, so
        // the page a player reads is `{1} damage!`; it then writes 21 into the step ring
        // and hides both lines.
        case 20: return battleMessagePage(4, args);
        // `.L0x8009a088`: `{1}HP healed!` with ring word 1 (`:24093 lw $a2, 0x50($v0)`
        // over `self+0x88 + 2`).
        case 21: return page(k, [NAME_ACTOR, numbers[0] ?? 0], args, [num(numbers[0])]);
        // `.L0x8009a168`: `Galacticmon learned a technique!` / `{1}!` — the technique name
        // out of bank 0xa2 by payload[0] (`:24142 addiu $a0, 0xa2`; `wfightmn.s:3957` asks for it).
        case 22: return page(k, [index], args, [slot]);
        default: return null;
    }
}

/** The curse words kind 19 reaches, as their `esmfight` indices. */
export const BATTLE_MESSAGE_CURSE_WORDS = Object.freeze([
    BATTLE_MESSAGE_CURSE_INDEX + 0, BATTLE_MESSAGE_CURSE_INDEX + 1, BATTLE_MESSAGE_CURSE_INDEX + 2,
]);

/**
 * Every kind the jump table holds: `BATTLE_MESSAGE_KIND_MAX` (0x16 = 22) arms, so kinds
 * 1..22. The census test compares it against the arm table and against the table in
 * docs/research/battle/battle-message-page-kinds-2026-10-04.md.
 */
export const BATTLE_MESSAGE_PAGE_KINDS: readonly number[] = Object.freeze(
    Array.from({ length: BATTLE_MESSAGE_KIND_MAX }, (_unused, i) => i + 1),
);

/** The arm a kind names, or null when the bound check rejects it. */
export function battleMessagePageArm(kind: number): BattleMessageArm | null {
    return battleMessageArm(kind);
}

/** The arm table, re-exported so a caller needs one import for the whole page system. */
export const BATTLE_MESSAGE_PAGE_ARMS = BATTLE_MESSAGE_ARMS;