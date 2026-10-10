// engine/dw3/battle-finale.ts
//
// THE GALACTICMON FINALE'S PHASE MACHINERY — the kind word's 4 -> 5 -> 6 advance,
// its two writers, its trigger chain and its three consumers, as a pure port.
//
// The last battle (Galacticmon; battle id `0x144`) is three fights in one. You first
// fight the TAIL. When the tail falls the game says "What! The body?!" and the body
// fires its cannon, which drops your current Digimon to 1 HP. Then the HEAD takes
// over as the enemy, attacking with a technique it copied from you ("Galacticmon
// learned a technique!"), and from that point on your own attacks roll the fixed
// `(rand & 0x7f) >= 0x2b` (~2-in-3) whatever the stats say.
//
// All citations are `pro/wfightmn.s` (sha256 49dcd28b…) and `pro/fightstg.s`
// (sha256 a0c285c4…) unless said otherwise; the decode and its evidence anchors are
// ledger claim `wfightmn-finale-kinds-2026-10-10` and section 14 of
// `docs/research/battle/3d-battle-complete-model-2026-08-19.md`. This module is the
// implementation half: the browser host (`web/battle.js`) consumes it.
//
// THE KIND WORD is the workspace halfword `0x800a4460 + 0xd6` (RAM `0x800a4536`).
// Setup writes 4 for battle `0x144` and clears `+0xd8/+0xda/+0xdb`
// (`wfightmn.s:1061-1072`). Two action arms of the 24-entry sequencer table move it:
//
//   * kind 5 — arm 18, sequencer phase 21 (`F0x800a8f88`, table index 18). Its
//     default sub-state (0, and the >= 6 fall-through, `wfightmn.s:3219-3234`) reads
//     the picked queue entry: when its `+4` is nonzero and the kind is 4 it plays
//     presentation id `0x8B` and hands sub-state 5 to `ctx->m30` = `F0x80014298`
//     (`exe/fns.s:4755-4760` writes `ctx+0x14` and clears `ctx+0x18`). Sub-state 5's
//     inner 0 then writes kind 5 (`wfightmn.s:3490-3494`) and spawns the body.
//   * kind 6 — arm 22, phase 25 (`F0x800a988c`). Its sub-state 0 (and the >= 5
//     fall-through, `wfightmn.s:3781-3793`) writes kind 6 and spawns the head; state
//     2 rebuilds the head's attack record from the technique row latched at
//     `0x800a4538` (`wfightmn.s:3843-3966`).
//
// THE TRIGGERS are queue events: the tail's KO stages kind `0x14` (=20; stager
// `F0x8009cf54`, `fightstg.s:27202-27226`, called by the KO arm `F0x800a84d0`), and
// the sequencer's phase-1 switch maps action opcode 20 -> `m2c(0x15=21)`
// (`wfightmn.s:4205`). The kind-5 body object `F0x80090c8c` then applies the body's
// attack enemy-side (`F0x800aa1f0(0x10, …)`, `fightstg.s:14400-14401`), sets the
// player's current Digimon to 1 HP (`fightstg.s:14416-14425`) and stages kind `0x17`
// (=23; stager `F0x8009d038`, `fightstg.s:27268-27282`, at `fightstg.s:14443`), which
// maps to `m2c(0x19=25)` (`wfightmn.s:4217`).
//
// THE THREE CONSUMERS of the kind:
//   * the accuracy leaves' player-side kind-6 short-circuit (`fightstg.s:30932-30943`
//     and `:31069-31081`) — already ported in `battle-formulas.ts` as
//     `rollHit`/`rollMagicHit`;
//   * the sequencer's action-opcode-3 thunk, which spawns the kind-5 object
//     `0x80090e58` or the kind-6 object `0x800914ec` by the kind word
//     (`wfightmn.s:4117-4153`);
//   * the kind-6 damage wrapper `F0x800aab10` (`wfightmn.s:4947-4982`), which counts
//     the player's nonzero damage applications while the kind is 6 and, on the third,
//     calls `F0x8009d06c` — kind `0x18` enqueued, battle effect `0x1d3` spawned, and
//     workspace `+0xdb := 1` (`fightstg.s:27284-27317`, closing BATTLE-C009's "who
//     writes a nonzero +0xdb").
//
// THE RECORDED TECHNIQUE: `F0x800aa06c` (`wfightmn.s:4266-4306`) latches a technique
// index into `0x800a4538` while the kind is 4, for the player side only, when the
// technique row passes its own filter (below). Its caller (`wfightmn.s:4830-4842`)
// reaches it from the damage applier for category-2/3 rows only. Arm 22 state 2 then
// rebuilds the head's own attack record — technique 440 (`0x80044aba =
// 0x80042bca + 18 * 440`; enemies.json `attack` 440, shipped name "?????") — from the
// recorded row: `+0x07` elem1, `+0x08` scalar, `+0x0a` dispatch, `+0x0b` f8, `+0x0c`
// crit and the id-keyed `+0x0d/+0x0e/+0x0f` lookups (`wfightmn.s:3869-3947`), skipping
// rows whose `+0x10` clip is 5 or 12. The attack keeps its own id and name: the
// record has no name and the id stays 440.

/**
 * The battle-kind word `0x800a4460+0xd6` (RAM `0x800a4536`). Setup writes 4 for
 * battle `0x144` (`wfightmn.s:1067-1068`).
 */
export const FINALE_KIND_TAIL = 4;
/** Arm 18's sub-state 5 write (`wfightmn.s:3491-3492`). */
export const FINALE_KIND_BODY = 5;
/** Arm 22's entry write (`wfightmn.s:3786-3787`). */
export const FINALE_KIND_HEAD = 6;

/** The esmfight bank index arm 18's default sub-state plays ("What! The body?!"). */
export const FINALE_MSG_BODY = 0x8b;
/** The esmfight bank index arm 22's state 2 plays ("Galacticmon learned a technique!"). */
export const FINALE_MSG_LEARNED = 0x8c;

/**
 * The head's own attack technique, the record arm 22 rebuilds: `0x80044aba` is
 * `0x80042bca + 18 * 440`, the row for technique 440 — enemies.json's `attack` for
 * Galacticmon3, shipped name "?????".
 */
export const FINALE_HEAD_ATTACK_ID = 440;

/**
 * The ordinary win's exit cue: `0x1400` = STFRPT, the battle-result screen
 * (`data/stagslct_catalog.json`; the same screen the walker's report hand-off
 * opens). Arm 4's phase-2 exit launches this for every win whose kind is not 6
 * (`wfightmn.s:2165-2174`).
 */
export const BATTLE_WIN_RESULT_SCREEN = 0x1400;

/**
 * The kind-6 win's exit cue: `0xE0B` = STTITL mode 11, which the title overlay's
 * screen setup sends to the movie object with row index `mode - 1` = 10
 * (`exe-decomp/stdwtitl_c/F0x80082ec8.c`; `pro/stdwtitl.s:161-167` is the mode
 * dispatch — mode 0 the title, mode 13 the END card, every other mode to
 * `0x80082fe0` — and `:212-218` computes the row as the launch code's low byte
 * minus one). Row 10 is `MOVIEE01_STR` (`engine/dw3/movie-destinations.ts`), the
 * ending movie, whose own return selector is `0xE0C`.
 */
export const FINALE_WIN_ENDING_MOVIE = 0xe0b;

/**
 * The launch cue a won battle exits with, read from arm 4's phase-2 exit
 * (`F0x800a7c00`, `wfightmn.s:2165-2174`; exe-decomp/wfightmn_c/F0x800a7c00.c
 * case 2): the exit reads the result byte `0x800a435c` — `1` is the win, written
 * by the stager `F0x8009c534(1)` (`fightstg.s:26513-26524`, `sb $a0, 0x435c` —
 * and note the same stager is called with `1` from the win arm) — and the
 * resident launcher `[0x8004b440]` gets `0xE0B` when the battle-kind word is 6,
 * `0x1400` otherwise. So winning the finale goes straight into the ending movie
 * instead of the battle-result screen.
 */
export function battleWinLaunchCode(battleKind: number): number {
    return ((battleKind | 0) === FINALE_KIND_HEAD) ? FINALE_WIN_ENDING_MOVIE : BATTLE_WIN_RESULT_SCREEN;
}

/**
 * The win jingle `0x6004001E` — played through `[0x80055c48]` right after the
 * result byte is written 1 — is suppressed when the kind is 6
 * (`wfightmn.s:3376-3384`: the `lh $v1, 0x4536` / `li $v0, 6` / `beq` gate in
 * front of the play call; the finale's win skips it). Every other kind
 * celebrates.
 */
export function battleWinJinglePlays(battleKind: number): boolean {
    return ((battleKind | 0) !== FINALE_KIND_HEAD);
}

/**
 * The live kind word for a battle whose finale has advanced: the phase once the tail
 * has fallen, else setup's own value (`specialMode`; the accuracy leaves read the
 * stamped record, this is the one place the value is chosen).
 */
export function finaleBattleKind(specialMode: number, finaleKind: number | null | undefined): number {
    return ((finaleKind ?? specialMode) | 0) || 0;
}

/**
 * One beat of the scripted sequence between the tail's fall and the head's first turn.
 *
 * The disc runs it inside WFIGHTMN's own flow (the header comment's chain); the
 * walker's battle is a three-member gauntlet standing in for the disc's one battle
 * with three spawned phases, so each beat names the member that takes the field:
 * member 1 is the body (it fires the cannon once and is never fought), member 2 is
 * the head.
 */
export interface FinaleBeat {
    /** The kind word while the beat plays. */
    kind: number;
    /** The gauntlet member on the field during the beat. */
    member: number;
    /** The esmfight index the beat prints (through message kind 1), or null. */
    message: number | null;
    /**
     * True on the cannon beat: the body's one attack, which sets the player's current
     * Digimon to 1 HP (`fightstg.s:14416-14425`).
     */
    cannon: boolean;
    /**
     * True when the head takes the field: kind 6 is written, the head is spawned, and
     * its attack record is rebuilt from the recorded technique row (arm 22).
     */
    head: boolean;
}

/**
 * The beats the tail's defeat starts, in order. Beat 0 is arm 18's default sub-state
 * (kind 5 + "What! The body?!" + the body on the field); beat 1 is the kind-5 body
 * object's cannon; beat 2 is arm 22 (kind 6 + the head + "Galacticmon learned a
 * technique!" when a technique was recorded — arm 22 state 2 skips that message and
 * the record build when the latched index is zero, `wfightmn.s:3869` -> `.L0x00003dd4`
 * at `:3964-3966`).
 */
export const FINALE_TAIL_DEFEAT_BEATS: readonly FinaleBeat[] = Object.freeze([
    { kind: FINALE_KIND_BODY, member: 1, message: FINALE_MSG_BODY, cannon: false, head: false },
    { kind: FINALE_KIND_BODY, member: 1, message: null, cannon: true, head: false },
    { kind: FINALE_KIND_HEAD, member: 2, message: FINALE_MSG_LEARNED, cannon: false, head: true },
]);

/**
 * The technique-record fields `F0x800aa06c` reads, as `web/assets/data/fight_tech_table.json`
 * names them (the 18-byte rows at `0x80042bca`).
 */
export interface FinaleTechniqueRow {
    /** `+0x04` — the row's category; the latch's caller admits 2 and 3 only. */
    category?: number;
    /** `+0x07` — elem1; `>= 2` qualifies on its own. */
    elem1?: number;
    /** `+0x0a` — the special-op dispatch byte. */
    dispatch?: number;
    /** `+0x10` — the action-script clip; 5 and 12 are excluded. */
    clip?: number;
}

/**
 * `F0x800aa06c` — does this technique row get latched as the head's copied technique?
 *
 * The latch (`wfightmn.s:4266-4306`), in order: the player side only (`:4271-4272`),
 * the kind word at 4 (`:4274-4277`), the clip byte at `+0x10` not 5 and not 12
 * (`:4278-4285`), then `+0x07 >= 2` qualifies on its own (`:4304-4318`), else `+0x0a
 * >= 2` and not 9, 10 or 12 (`:4286-4302`). The category test is the caller's
 * (`:4831-4835`: `(category - 2) <u 2`), kept here so one predicate carries the whole
 * gate the applier applies.
 */
export function finaleRecordsTechnique(
    kind: number,
    side: number,
    row: FinaleTechniqueRow | null | undefined,
): boolean {
    if ((side | 0) !== 0) return false;
    if ((kind | 0) !== FINALE_KIND_TAIL) return false;
    if (!row) return false;
    const clip = (row.clip ?? 0) | 0;
    if (clip === 5 || clip === 12) return false;
    const category = (row.category ?? 0) | 0;
    if (category !== 2 && category !== 3) return false;
    const elem1 = (row.elem1 ?? 0) | 0;
    if (elem1 >= 2) return true;
    const dispatch = (row.dispatch ?? 0) | 0;
    return dispatch >= 2 && dispatch !== 9 && dispatch !== 10 && dispatch !== 12;
}

/**
 * The record fields arm 22 copies into the head's attack record, as the walker's
 * skill rows carry them (the extracted table's names in the comment on each field).
 */
export interface FinaleCopiedRow {
    /** `+0x10` — the clip byte arm 22 skips rows on. */
    clip?: number;
    /** `+0x07` elem1, shipped as the element name. */
    element?: string;
    /** `+0x08` scalar. */
    damage_scalar?: number;
    /** `+0x0a` dispatch. */
    effect_id?: number;
    /** `+0x0c` crit. */
    effect_power?: number;
}

/**
 * Arm 22 state 2's record build: the head's attack record takes the recorded row's
 * `+0x07` (element), `+0x08` (damage scalar), `+0x0a` (effect id) and `+0x0c` (effect
 * power) — the fields the walker's skill model carries; the copied `+0x0b` f8 and the
 * id-keyed `+0x0d/+0x0e/+0x0f` lookups have no skill-row home and are the named gap.
 * The attack keeps its own id and name ("?????"): the record carries no name and the
 * id stays 440 (`wfightmn.s:3869-3947`).
 *
 * A row whose clip is 5 or 12 is not copied at all (`wfightmn.s:3869-3880`); a null
 * row (nothing was recorded) leaves the head's own attack untouched, which is arm
 * 22's zero-index path (`wfightmn.s:3869` `beqz $a0` -> sub-state 4).
 */
export function finaleCopiedAttackSkill<T extends FinaleCopiedRow>(
    base: T,
    recorded: FinaleCopiedRow | null | undefined,
): T {
    if (!recorded) return base;
    const clip = (recorded.clip ?? 0) | 0;
    if (clip === 5 || clip === 12) return base;
    return {
        ...base,
        element: recorded.element,
        damage_scalar: recorded.damage_scalar,
        effect_id: recorded.effect_id,
        effect_power: recorded.effect_power,
    };
}
