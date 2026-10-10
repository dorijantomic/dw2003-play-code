// The in-battle message line, translated from the original pro/fightstg message
// panel: the window picture, the two text lines, the reveal cadence, the blinking
// "press Circle" prompt and the close rule.
//
//   FIGHTSTG_F0x8009a298  the controller. Allocates 0xb4 bytes through F0x80014504 with
//                         its step routine 0x80098C9C as the class, installs the VM at
//                         +0xac and 0x8009A254 (the timed-close switch) at +0xb0.
//   FIGHTSTG_F0x80098c9c  the step routine: state 0 advances itself to state 1, state 1
//                         draws and runs the reveal machine.
//   FIGHTSTG_F0x80098924  the draw: the window picture, and the blinking prompt while
//                         `self+0x98` is set.
//   FIGHTSTG_F0x80098a84  the reveal machine: five phases off the table at 0x80083124.
//   FIGHTSTG_F0x80099588  the message-panel VM. Builds the two text elements and
//                         fills them from text bank 0x7f by a 22-entry jump table.
//   F0x8001A23C           the element's +0x144 method — set_visible, all or nothing.
//
// Decode: .bunny-scratch/battlemsg-fix2-report.md (2026-10-02), which re-read
// ~/ddw3/asm/dw2003/pro/fightstg.s from F0x8009a298 outward and cites every line behind
// each constant below. The first decode, .bunny-scratch/battlemsg-report.md, read the
// wrong object (F0x8009a898's, a seven-child controller built by F0x8009ab78 for the
// confused-Digimon gags) and is superseded on which routine does what; its numbers and its
// 22-arm table survive. Oracle: tests/lane-b/battle-message-line.test.js runs the original
// VM through engine/native and compares the ordered element calls.
//
// Player-visible result: while a battle line is up, the panel is the battle chrome
// pack's own window picture at native (11, 188) — 296 wide, 38 tall — instead of a
// painted rectangle; the first line sits at native (20, 194) and the second at
// (20, 208), the second arriving once four display ticks have passed; and a small glyph
// blinks at (291, 208) *only while the line is waiting to be read*, until the player
// presses Circle, which is what closes the line.

// ---------------------------------------------------------------- addresses
/** FIGHTSTG_F0x80099588 — the message-panel VM. */
export const BATTLE_MESSAGE_VM = 0x80099588;
/**
 * FIGHTSTG_F0x80098c9c — the controller's step routine. `F0x8009a298` passes its address
 * to `F0x80014504` (`fightstg.s:24198-24203`), which stores the class at `+0x48`
 * (`exe/fns.s:4914`); the generic stepper calls `self+0x48(self, self+0x24)`
 * (`.L0x800181a8`-`.L0x800181b4`).
 */
export const BATTLE_MESSAGE_TICK = 0x80098c9c;
/** FIGHTSTG_F0x80098924 — the draw (window picture + the gated blinking prompt). */
export const BATTLE_MESSAGE_DRAW = 0x80098924;
/**
 * FIGHTSTG_F0x80098a84 — the reveal machine: show one line, wait, repeat, then wait for
 * Circle. Phase table `.L0x80083124` (`fightstg.s:275-279`), indexed `self+0x10`.
 */
export const BATTLE_MESSAGE_REVEAL = 0x80098a84;
/** FIGHTSTG_F0x8009a298 — the controller that installs the VM as method +0xac. */
export const BATTLE_MESSAGE_OBJECT = 0x8009a298;
/**
 * FIGHTSTG_F0x8009a254 — installed at `+0xb0` (`fightstg.s:24207-24209`). The only
 * writer of phase 4: `self+0x10 = 4`, `self+0x98 = 0`, `self+0x14 = tick()`. **No
 * instruction in the decoded corpus calls through `+0xb0`**, so nothing reaches the timed
 * close; it is kept because the switch is real and its constant is decoded.
 */
export const BATTLE_MESSAGE_AUTO_CLOSE = 0x8009a254;
/** F0x8001a23c — the element's +0x144 method, `set_visible`. */
export const BATTLE_MESSAGE_SET_VISIBLE = 0x8001a23c;
/** `.L0x8008318c` — the VM's kind jump table, indexed (kind - 1). */
export const BATTLE_MESSAGE_KIND_TABLE = 0x8008318c;
/** `.L0x80083124` — the reveal machine's five-phase table, indexed `self+0x10`. */
export const BATTLE_MESSAGE_PHASE_TABLE = 0x80083124;
/**
 * .L0x800995c8 and .L0x800995f0: `F0x8001ae38(0x1005, 1, 0x14, 0xc2)` and the same
 * with 0xd0 — the two text elements. 0x14 = 20, 0xc2 = 194, 0xd0 = 208.
 */
export const BATTLE_MESSAGE_LINE1 = { x: 0x14, y: 0xc2 } as const;
export const BATTLE_MESSAGE_LINE2 = { x: 0x14, y: 0xd0 } as const;
/** The `0x1005` draw layer both elements are built on (.L0x800995c8, .L0x800995f0). */
export const BATTLE_MESSAGE_LAYER = 0x1005;
/** The `1` argument both calls pass: the font kind, the second slot of the font block. */
export const BATTLE_MESSAGE_FONT_KIND = 1;
/**
 * F0x8001ae38 `.L0x8001afe4` — `sh $v1, 0xac($v0)` with $v1 = 0x140. The element's
 * maximum line width in pixels: 320.
 */
export const BATTLE_MESSAGE_LINE_MAX_WIDTH = 0x140;
/**
 * F0x8001ae38 `.L0x8001b01c`-`.L0x8001b020` — three words set to 0x1000, the 12.4
 * fixed-point text scale. 0x1000 is 1.0, so the message line is never scaled.
 */
export const BATTLE_MESSAGE_TEXT_SCALE = 0x1000;

// ------------------------------------------------------------ the window art
/**
 * FIGHTSTG_F0x80098924 `.L0x80098a38`-`.L0x80098a6c`: the builder's region call carries
 * `lui $a0, 0x455` — handle `0x04550000`, PGFGTC00, the battle chrome pack the ported HP
 * plate uses — and then cel 0x31 at (0xb, 0xbc). 0x04550000 corroborates; the pack the
 * painter actually submits is the one the builder resolved for layer `0x1005`, entry 1
 * (`.L0x80098940`/`.L0x80098950`).
 */
export const BATTLE_MESSAGE_PANEL_PACK = 0x04550000;
export const BATTLE_MESSAGE_PANEL_CEL = 0x31;
/** The window picture's place on the 320-wide screen: native (11, 188). */
export const BATTLE_MESSAGE_PANEL_X = 0x0b;
export const BATTLE_MESSAGE_PANEL_Y = 0xbc;
/**
 * The window picture's size, measured out of the extracted pack
 * (web/assets/ui/pgfgc00_sheet.json, cel 49): six layers at in-cel offsets 0, 8, 72,
 * 136, 200 and 264 with widths 8, 64, 64, 64, 64 and 32. Drawn at (11, 188) it spans
 * x 11..307 and y 188..226 — which is exactly wide enough to hold both text lines and
 * the prompt glyph.
 */
export const BATTLE_MESSAGE_PANEL_W = 296;
export const BATTLE_MESSAGE_PANEL_H = 38;

// -------------------------------------------------------- the blinking prompt
/**
 * FIGHTSTG_F0x80098924 `.L0x800989f8`-`.L0x80098a14`: the builder's resolver call carries
 * `lui $a0, 0x286` — handle `0x02860000`, CMFONT (web/dialogue-translated.js:15 carries
 * the same handle mapping) — and then cel 0xa at (0x123, 0xd0).
 */
export const BATTLE_MESSAGE_PROMPT_PACK = 0x02860000;
export const BATTLE_MESSAGE_PROMPT_CEL = 0x0a;
/**
 * The same cel as the extracted pack names it. `web/assets/ui/cmfont_sheet.json` keys
 * the base frame `10` and its four extra frames `10#1` .. `10#4`.
 */
export const BATTLE_MESSAGE_PROMPT_CLIP = "10";
/** The prompt glyph's place: native (291, 208), beside the second line. */
export const BATTLE_MESSAGE_PROMPT_X = 0x123;
export const BATTLE_MESSAGE_PROMPT_Y = 0xd0;
/** Measured from web/assets/ui/cmfont_sheet.json, cels `10` and `10#1`..`10#4`. */
export const BATTLE_MESSAGE_PROMPT_SIZE = 12;
/**
 * .L0x800989b0 — `slti $v1, 0x5` with a zero store at `.L0x800989bc`: five frames,
 * wrapping. The extracted pack names them `10`, `10#1` .. `10#4`.
 */
export const BATTLE_MESSAGE_PROMPT_FRAMES = 5;
/**
 * .L0x80098980 / .L0x80098984 — `subu $v0, $v1` then `slti $v0, 0x4`: the prompt only
 * steps forward once four ticks have passed since the last sample.
 */
export const BATTLE_MESSAGE_PROMPT_TICKS = 4;
/**
 * .L0x80098954 / .L0x8009895c — `lw $v0, 0x98($s0)` / `beqz $v0, .L0x80098a28`: the glyph
 * is drawn only while `self+0x98` is set, and the only writer of `1` is
 * .L0x80098b8c, the moment the last line has arrived and the machine enters phase 3. It
 * is cleared again at .L0x80098c34 and by F0x8009a254. **So the glyph blinks only while
 * the line is waiting to be read.**
 */
export const BATTLE_MESSAGE_PROMPT_GATE = 0x98;

// ----------------------------------------------------------- reveal and close
/**
 * .L0x80098b00 — `li $v1, 0x3; sw $v1, 0x80($s0)`, compared at .L0x80098b5c as
 * `slt $v1, $v0` over `tick() - stamped_at`. The next line appears once the elapsed tick
 * count is strictly greater than this — that is, on the fourth tick. **Ticks**, the
 * original's own unit: `[0x8004DF98]()`, the display tick the repo has already decoded
 * (engine/dw3/ui/pad-words.ts:9-24, claim UI-DISPLAY-TICK-CHAIN-2026-08-21) — the feeder
 * adds `0x133` per PAL field tick and yields a tick per `0x100`, so a tick is 256/307 of
 * 50 Hz, about 60.4 Hz on PAL. The session is driven by the caller, so the rate stays the
 * caller's decision.
 */
export const BATTLE_MESSAGE_LINE_DELAY_TICKS = 3;
/**
 * .L0x80098bb8 / .L0x80098bc0 — `andi $v0, 0x2000`. CONFIRMED Circle by
 * docs/research/ui/exclamation-indicator-decoded-2026-07-02.md:131
 * ("pad mask 0x2000 (Circle)"), and `web/dialogue-translated.js:20`
 * `const CONFIRM_BIT = 1 << 13`.
 */
export const BATTLE_MESSAGE_CLOSE_BIT = 0x2000;
/**
 * There is no timeout on the path the game takes. .L0x80098bbc — `beqz $v0, .L0x80098c88`
 * — returns out of phase 3 with the line still up until the close bit is held, and phase 4
 * (the timed close) has no caller.
 */
export const BATTLE_MESSAGE_HOLD_TICKS = Infinity;
/**
 * .L0x80098c58 — `slti $v0, 0x15` over `tick() - self+0x14`: phase 4 closes after 21
 * ticks, about 0.35 s at 60.4 Hz. Reachable only through `+0xb0` (F0x8009a254), which no
 * decoded instruction calls; kept so the switch's number is not lost.
 */
export const BATTLE_MESSAGE_AUTO_CLOSE_TICKS = 0x15;

// ---------------------------------------------------------- the element methods
/** F0x8001ae38 `.L0x8001ae94` — `+0x114`, set the element's text from a bank index. */
export const BATTLE_MESSAGE_EL_SET_STRING = 0x114;
/** F0x8001ae38 `.L0x8001ae9c` — `+0x118`, write a number into a numbered slot. */
export const BATTLE_MESSAGE_EL_SET_NUMBER = 0x118;
/** F0x8001ae38 `.L0x8001aeb4` — `+0x120`, write a string into a numbered slot. */
export const BATTLE_MESSAGE_EL_SET_SLOT = 0x120;
/** F0x8001ae38 `.L0x8001a24c` — `+0x144`, set_visible. All or nothing. */
export const BATTLE_MESSAGE_EL_VISIBLE = 0x144;
/**
 * .L0x800995ac — `lw $s3, 0x24($s4)`. The object holds a two-word widget block; word 0
 * is the first line and word 1 the second.
 */
export const BATTLE_MESSAGE_WIDGET_BLOCK = 0x24;
/** .L0x800995b4 — `sw $v0, 0x74($s4)` with $v0 = 1. The VM's own "a line is up" flag. */
export const BATTLE_MESSAGE_UP_FLAG = 0x74;
/** .L0x8009a794 — `addiu $v1, $a2, -0x49`. Kinds 7 and 19 add 0x49 to the caller's index. */
export const BATTLE_MESSAGE_CURSE_INDEX = 0x49;
/** .L0x8009a214 — `sltiu $v0, $v1, 0x16` over `kind - 1`. Kinds 1..22 have an arm. */
export const BATTLE_MESSAGE_KIND_MAX = 0x16;

/**
 * Bank `0x7f` is the message bank. Every arm loads it through the language object's
 * getter at `0x80044b38 + 0x414` with `addiu $a0, 0x7f`, and
 * engine/dw3/ui/native/wfight-menu.ts:35 waits on `0x7F, 0x4E, 0xA2, 0x9B, 0x6A, 0x63`
 * before the fight draws. It is the English file
 * `~/ddw3/lang_file/dw2003/eng/esmfight.toml`.
 */
export const BATTLE_MESSAGE_BANK = 0x7f;
/** `esmfight[0x16]` — the bare `{1}` the actor's name is written into. */
export const BATTLE_MESSAGE_NAME = 0x16;
/** Bank `0x4e`, the party-name bank the digestivolution and next-out arms read. */
export const BATTLE_MESSAGE_BANK_PARTY = 0x4e;
/** Bank `0xa2`, read by kinds 3, 5 and 22 for their second slot. */
export const BATTLE_MESSAGE_BANK_ITEM = 0xa2;
/** Bank `0x6a`, read by kinds 14 and 17. */
export const BATTLE_MESSAGE_BANK_FIELD = 0x6a;

/**
 * One VM arm: which string index each line takes, and which numbered slots the
 * payload's words fill. `line` 0 is the widget at (20, 194) and line 1 the one at
 * (20, 208); an index of `null` means the arm leaves that line's index to the caller.
 * `slots` lists the payload words that land in element slots, in slot order.
 *
 * Read arm by arm out of `FIGHTSTG_F0x80099588`'s jump table
 * (`.L0x8008318c` .. `.L0x800831e4`). A `null` `bank` on a slot means the number goes
 * in through `+0x118`; a bank id means a string goes in through `+0x120`.
 */
export interface BattleMessageArm {
    /** The arm's address in the jump table, for the oracle. */
    at: number;
    /** `esmfight` index for line 1 (native 20,194); null = the caller's payload word. */
    line1: number | null;
    /** `esmfight` index for line 2 (native 20,208); null = the caller's payload word. */
    line2: number | null;
    /** Which payload word supplies line 1's index when `line1` is null; null = untouched. */
    line1From: number | null;
    /** Which payload word supplies line 2's index when `line2` is null; null = untouched. */
    line2From: number | null;
    /**
     * The payload words written into element slots 1..n, in order. `payload` is the
     * payload word, `bank` the bank to read it from (null = write the number itself),
     * and `mul` a pair of payload words whose product goes in (kind 16's slot 3).
     */
    slots: Array<{ payload?: number; bank: number | null; mul?: [number, number] }>;
    /** Kind 20 re-enters the VM with kind 4. */
    reenter?: number;
    /**
     * Whether the shared tail `FIGHTSTG_F0x80098d14` fills slot 1 of line 1 with the
     * acting Digimon's name. `false` for the three arms that skip it (kinds 1, 9 and,
     * through kind 4, 20); `true` — the default — for every other arm.
     */
    nameLine?: false;
    /** `.L0x8009a00c addiu $a2, 0x49` — the caller's word plus 0x49 (kinds 7 and 19). */
    curse?: boolean;
    /** The second string index, chosen by a payload test (kind 18). */
    alternate?: { when(payload: readonly number[]): boolean; index: number };
}

const SLOT_NUM = (payload: number) => ({ payload, bank: null });
const SLOT_BANK = (payload: number, bank: number) => ({ payload, bank });
/** `.L0x80099e44 mult $a2, $v0` / `.L0x80099e88 move_ $a2, $s0`: the product of two
 *  payload words, written into the slot the third `+0x118` call fills. */
const SLOT_MUL = (a: number, b: number) => ({ bank: null, mul: [a, b] as [number, number] });

/**
 * All 22 arms. `null` line indices are the ones `.L0x80099638` / `lw $a2, ($s2)` /
 * `lw $a2, 0x4($s2)` read straight out of the payload.
 */
export const BATTLE_MESSAGE_ARMS: readonly BattleMessageArm[] = Object.freeze([
    // kind 1 — .L0x80099638: line 1 is the caller's payload[0] and line 2 is untouched,
    // and the arm jumps straight to .L0x8009a200, so no name reaches slot 1.
    { at: 0x80099638, line1: null, line2: null, line1From: 0, line2From: null, slots: [],
        nameLine: false },
    // kind 2 — .L0x80099678: the name, then the caller's payload[0]. `Evade!` lands here.
    { at: 0x80099678, line1: BATTLE_MESSAGE_NAME, line2: null,
        line1From: null, line2From: 0, slots: [] },
    // kind 3 — .L0x800996f8: `{1}!` plus bank 0xa2 in slot 1 (payload[1]).
    { at: 0x800996f8, line1: BATTLE_MESSAGE_NAME, line2: 0x09,
        line1From: null, line2From: null, slots: [SLOT_BANK(1, BATTLE_MESSAGE_BANK_ITEM)] },
    // kind 4 — .L0x80099794: `{1} damage!` with payload[1] in slot 1.
    { at: 0x80099794, line1: BATTLE_MESSAGE_NAME, line2: 0x0b,
        line1From: null, line2From: null, slots: [SLOT_NUM(1)] },
    // kind 5 — .L0x8009980c: `Counter! {1}!` plus bank 0xa2 in slot 1.
    { at: 0x8009980c, line1: BATTLE_MESSAGE_NAME, line2: 0x0a,
        line1From: null, line2From: null, slots: [SLOT_BANK(1, BATTLE_MESSAGE_BANK_ITEM)] },
    // kind 6 — .L0x800998a8: `Counter!`, and nothing else on the elements.
    { at: 0x800998a8, line1: BATTLE_MESSAGE_NAME, line2: 0x25,
        line1From: null, line2From: null, slots: [] },
    // kind 7 — .L0x80099908: line 2 is the caller's payload[0]; no extra index.
    { at: 0x80099908, line1: BATTLE_MESSAGE_NAME, line2: null,
        line1From: null, line2From: 0, slots: [] },
    // kind 8 — .L0x8009998c: `{1}HP healed!`, payload[1] in slot 1.
    { at: 0x8009998c, line1: BATTLE_MESSAGE_NAME, line2: 0x22,
        line1From: null, line2From: null, slots: [SLOT_NUM(1)] },
    // kind 9 — .L0x80099a04: no text at all; it only copies the payload into the step
    // ring and jumps to .L0x8009a204, so neither line is filled here.
    { at: 0x80099a04, line1: null, line2: null, line1From: null, line2From: null, slots: [],
        nameLine: false },
    // kind 10 — .L0x80099a28: `HP gradually recovers.`
    { at: 0x80099a28, line1: BATTLE_MESSAGE_NAME, line2: 0x27,
        line1From: null, line2From: null, slots: [] },
    // kind 11 — .L0x80099ad4: `{1}HP healed!`. The number is the *third* word of the
    // step ring: `.L0x80099ae0`-`.L0x80099af0` rebuild `$s2` as `self + 0x54 + 4*step`
    // and `.L0x80099b4c` reads `0x8($s2)`, i.e. ring word 2.
    { at: 0x80099ad4, line1: BATTLE_MESSAGE_NAME, line2: 0x22,
        line1From: null, line2From: null, slots: [SLOT_NUM(2)] },
    // kind 12 — .L0x80099b90: `Digivolved! {1}!`, bank 0x4e name in slot 1.
    { at: 0x80099b90, line1: BATTLE_MESSAGE_NAME, line2: 0x37,
        line1From: null, line2From: null, slots: [SLOT_BANK(1, BATTLE_MESSAGE_BANK_PARTY)] },
    // kind 13 — .L0x80099c2c: `Next Digimon out!` / `{1}!`, bank 0x4e in slot 1.
    { at: 0x80099c2c, line1: 0x4e, line2: 0x4f,
        line1From: null, line2From: null, slots: [SLOT_BANK(0, BATTLE_MESSAGE_BANK_PARTY)] },
    // kind 14 — .L0x80099ca0: `{1}!` plus bank 0x6a in slot 1.
    { at: 0x80099ca0, line1: BATTLE_MESSAGE_NAME, line2: 0x09,
        line1From: null, line2From: null, slots: [SLOT_BANK(1, BATTLE_MESSAGE_BANK_FIELD)] },
    // kind 15 — .L0x80099d3c: `Poisoned: {1}`, payload[2] in slot 1.
    { at: 0x80099d3c, line1: BATTLE_MESSAGE_NAME, line2: 0x55,
        line1From: null, line2From: null, slots: [SLOT_NUM(2)] },
    // kind 16 — .L0x80099dd4: `{1} X {2} = {3}!`. Slots 1 and 2 are payload[1] and
    // payload[2]; slot 3 is their product (.L0x80099e44 `mult $a2, $v0`, then
    // .L0x80099e88 `move_ $a2, $s0`).
    { at: 0x80099dd4, line1: BATTLE_MESSAGE_NAME, line2: 0x23,
        line1From: null, line2From: null,
        slots: [SLOT_NUM(1), SLOT_NUM(2), SLOT_MUL(1, 2)] },
    // kind 17 — .L0x80099e8c: `Stole` / `{1}!`, bank 0x6a in slot 1.
    { at: 0x80099e8c, line1: 0x26, line2: 0x09,
        line1From: null, line2From: null, slots: [SLOT_BANK(0, BATTLE_MESSAGE_BANK_FIELD)] },
    // kind 18 — .L0x80099f00: `{1}HP healed!`, or `{1} MP absorbed!` when the
    // THIRD payload word is set: `.L0x80099f38 lw $v0, 0x8($s2)` / `bnez`.
    { at: 0x80099f00, line1: BATTLE_MESSAGE_NAME, line2: 0x22,
        line1From: null, line2From: null, slots: [SLOT_NUM(1)],
        alternate: { when: (payload) => ((payload[2] ?? 0) | 0) !== 0, index: 0x8f } },
    // kind 19 — .L0x80099fb0: the caller's payload[1] plus 0x49 (`Strength cursed!`).
    { at: 0x80099fb0, line1: BATTLE_MESSAGE_NAME, line2: null,
        line1From: null, line2From: 1, slots: [], curse: true },
    // kind 20 — .L0x8009a050: re-enters the VM with kind 4.
    { at: 0x8009a050, line1: null, line2: null, line1From: null, line2From: null,
        slots: [], reenter: 4, nameLine: false },
    // kind 21 — .L0x8009a088: `{1}HP healed!`. `.L0x8009a0fc`-.L0x8009a110 walk
    // `self+0x88` forward two entries and then read `+0x50`, i.e. ring word 1.
    { at: 0x8009a088, line1: BATTLE_MESSAGE_NAME, line2: 0x22,
        line1From: null, line2From: null, slots: [SLOT_NUM(1)] },
    // kind 22 — .L0x8009a168: `Galacticmon learned a technique!` / `{1}!`, with the
    // technique name out of bank 0xa2 at payload[0] (.L0x8009a1e4 `lw $a2, ($s2)`).
    { at: 0x8009a168, line1: 0x8c, line2: 0x09,
        line1From: null, line2From: null, slots: [SLOT_BANK(0, BATTLE_MESSAGE_BANK_ITEM)] },
] as BattleMessageArm[]);

/** The arm for a kind, or null when `.L0x8009960c` rejects it (`kind - 1 >= 0x16`). */
export function battleMessageArm(kind: number): BattleMessageArm | null {
    const index = (kind | 0) - 1;
    if (index < 0 || index >= BATTLE_MESSAGE_ARMS.length) return null;
    return BATTLE_MESSAGE_ARMS[index] as BattleMessageArm;
}

/** The `esmfight` index an arm puts on one of the two lines. */
export function battleMessageLineIndex(
    kind: number,
    line: number,
    payload: readonly number[],
): number | null {
    const arm = battleMessageArm(kind);
    if (!arm) return null;
    const index = line === 0 ? arm.line1 : arm.line2;
    if (index !== null && index !== undefined) {
        const alternate = arm.alternate;
        if (alternate && line === 1 && alternate.when(payload)) return alternate.index;
        return index;
    }
    // The arm leaves this line's index to the payload -- or leaves the line alone.
    const from = line === 0 ? arm.line1From : arm.line2From;
    if (from === null || from === undefined) return null;
    const word = (payload[from] ?? 0) | 0;
    return arm.curse ? word + BATTLE_MESSAGE_CURSE_INDEX : word;
}

/**
 * FIGHTSTG_F0x80098d14 — the shared tail every arm but three falls into: it writes the
 * acting Digimon's name into slot 1 of the **line 1** element, the one whose template is
 * `esmfight[0x16]` = `{1}`. `.L0x8009a028`-`.L0x8009a040` reads the payload's first word
 * as the side test (0 -> the current actor, which is how the enemy and the in-battle
 * digivolution reach it) and a runtime table at `0x800a4468 + 4*word` as the party-record
 * index; `F0x80098d14` then takes the name out of bank `0x4e`.
 *
 * Three arms never reach it: kind 1 jumps straight to `.L0x8009a200`, kind 9 to
 * `.L0x8009a204`, and kind 20 re-enters the VM with kind 4 and takes kind 4's tail.
 */
export function battleMessageNamesLineOne(kind: number): boolean {
    const arm = battleMessageArm(kind);
    if (!arm) return false;
    if (arm.reenter !== undefined) return battleMessageNamesLineOne(arm.reenter);
    return arm.nameLine !== false;
}

/**
 * The kind a caller asks for, given the walker's own two halves. The browser already
 * produces its lines as strings; this is the mapping the report's porting note calls
 * for — the original's shapes, not the walker's invented wording.
 */
export function battleMessageKindFor(lines: readonly string[]): number {
    if (lines.length === 0) return 1;
    if (lines.length === 1) return 1;
    if (/\bdamage!\s*$/i.test(lines[1] ?? "")) return 4;
    if (/\bevaded?\b|\bEvade!/i.test(lines[1] ?? "")) return 2;
    if (/\bcounter/i.test(lines[1] ?? "")) return 6;
    if (/digivolved/i.test(lines[1] ?? "")) return 12;
    if (/poisoned/i.test(lines[1] ?? "")) return 15;
    if (/healed|restored/i.test(lines[1] ?? "")) return 8;
    if (/next digimon/i.test(lines[0] ?? "")) return 13;
    return 2;
}

// -------------------------------------------------------------------- hosts
export interface BattleMessageHost {
    /** `F0x8001AE38(target, kind, x, y)`: build a text element. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** `[0x80044F4C](0x7f)`: the message bank's string table. */
    bankGet(bank: number): number;
    /** `element + slot(args)`: an object method, e.g. +0x114 / +0x118 / +0x120 / +0x144. */
    callMethod(element: number, slot: number, args: number[]): void;
    /** `[0x80044F5C](handle)`: resolve a pack to something the painter can name. */
    packResolve(handle: number): number;
    /** The window picture and the prompt: `drawSprite(pack, cel, frame, x, y)`. */
    drawSprite(pack: number, cel: number, frame: number, x: number, y: number): void;
}

/** The two widget handles the VM holds, in the object's own block order. */
export interface BattleMessageWidgets {
    /** Word 0 of `self+0x24` — the element at native (20, 194). */
    line1: number;
    /** Word 1 of `self+0x24` — the element at native (20, 208). */
    line2: number;
}

/**
 * FIGHTSTG_F0x80099588's preamble — `.L0x800995c8`-`.L0x80099604`. Build each line once,
 * in order, and hide nothing yet: the original only reaches `+0x144(0)` on its way out.
 */
export function battleMessageBuildWidgets(host: BattleMessageHost): BattleMessageWidgets {
    const line1 = host.createTextElement(
        BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
        BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE1.y);
    const line2 = host.createTextElement(
        BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
        BATTLE_MESSAGE_LINE2.x, BATTLE_MESSAGE_LINE2.y);
    return { line1, line2 };
}

/**
 * FIGHTSTG_F0x80099588 — one `unkAC(task, kind, payload)` call.
 *
 * `textOf(bank, index)` resolves an `esmfight` index to the string the element is given;
 * it is the boundary where the browser substitutes its own English, because the original
 * carries the string table in the disc language file rather than in code. `numberOf(n)`
 * resolves the words that go in through `+0x118`.
 *
 * `.L0x8009a204` — the tail every arm shares: hide both lines again.
 */
export function battleMessageShow(
    host: BattleMessageHost,
    widgets: BattleMessageWidgets,
    kind: number,
    payload: readonly number[],
    textOf: (bank: number, index: number) => string,
    numberOf: (value: number) => string,
): BattleMessageKindResult {
    const bank = host.bankGet(BATTLE_MESSAGE_BANK);
    const arm = battleMessageArm(kind);
    const calls: BattleMessageCall[] = [];
    if (!arm) {
        hideLines(host, widgets, calls);
        return { kind, accepted: false, calls };
    }
    const index1 = battleMessageLineIndex(kind, 0, payload);
    const index2 = battleMessageLineIndex(kind, 1, payload);
    if (index1 !== null) {
        calls.push(["set", 0, BATTLE_MESSAGE_EL_SET_STRING, bank, index1]);
        host.callMethod(widgets.line1, BATTLE_MESSAGE_EL_SET_STRING, [bank, index1]);
    }
    if (index2 !== null) {
        calls.push(["set", 1, BATTLE_MESSAGE_EL_SET_STRING, bank, index2]);
        host.callMethod(widgets.line2, BATTLE_MESSAGE_EL_SET_STRING, [bank, index2]);
    }
    for (const slot of arm.slots) {
        const value = slot.mul
            ? (((payload[slot.mul[0]] ?? 0) | 0) * ((payload[slot.mul[1]] ?? 0) | 0)) | 0
            : ((payload[slot.payload ?? 0] ?? 0) | 0);
        const slotIndex = arm.slots.indexOf(slot) + 1;
        if (slot.bank === null) {
            // `.L0x80099808 li $a1, 0x1` in the delay slot of the +0x118 call, with
            // the payload word in $a2: the slot index comes first, then the value.
            calls.push(["num", slotIndex, BATTLE_MESSAGE_EL_SET_NUMBER, slotIndex, value]);
            host.callMethod(widgets.line2, BATTLE_MESSAGE_EL_SET_NUMBER, [slotIndex, value]);
        } else {
            const other = host.bankGet(slot.bank);
            calls.push(["slot", slotIndex, BATTLE_MESSAGE_EL_SET_SLOT, other, value, slotIndex]);
            host.callMethod(widgets.line2, BATTLE_MESSAGE_EL_SET_SLOT,
                [other, value, slotIndex]);
        }
    }
    if (arm.reenter !== undefined) {
        // .L0x8009a050 `jal FIGHTSTG_F0x80099588` with $a1 = 4: the inner call runs the
        // kind-4 arm and hides both lines at its own tail, then the outer frame falls
        // through to `.L0x8009a204` and hides them a second time. Both pairs are real.
        const inner = battleMessageShow(host, widgets, arm.reenter, payload, textOf, numberOf);
        hideLines(host, widgets, calls);
        return { ...inner, calls, kind };
    }
    hideLines(host, widgets, calls);
    return { kind, accepted: true, calls, text1: textOf(BATTLE_MESSAGE_BANK, index1 ?? 0),
        text2: index2 === null ? "" : textOf(BATTLE_MESSAGE_BANK, index2) };
}

/** `.L0x8009a204`-`.L0x8009a230`: `+0x144(0)` on line 1 then on line 2. */
function hideLines(host: BattleMessageHost, widgets: BattleMessageWidgets,
    calls: BattleMessageCall[]): void {
    calls.push(["vis", 0, BATTLE_MESSAGE_EL_VISIBLE, 0]);
    host.callMethod(widgets.line1, BATTLE_MESSAGE_EL_VISIBLE, [0]);
    calls.push(["vis", 1, BATTLE_MESSAGE_EL_VISIBLE, 0]);
    host.callMethod(widgets.line2, BATTLE_MESSAGE_EL_VISIBLE, [0]);
}

export type BattleMessageCall =
    | ["set", number, number, number, number]
    | ["num", number, number, number, number]
    | ["slot", number, number, number, number, number]
    | ["vis", number, number, number];

export interface BattleMessageKindResult {
    kind: number;
    accepted: boolean;
    calls: BattleMessageCall[];
    text1?: string;
    text2?: string;
}

// ------------------------------------------------------------ reveal / close
/**
 * FIGHTSTG_F0x80098a84 — the reveal machine, in the original's own order and under its own
 * names: the object's **state** at `self+0x0c` and its **phase** at `self+0x10`, dispatched
 * through the five-word table at `0x80083124` after `.L0x80098aa0 sltiu $v0, $v1, 0x5`.
 *
 * phase 0 (`.L0x80098acc`)  wait until the VM has built a message (`self+0x74`), then on.
 * phase 1 (`.L0x80098ae4`)  stamp `self+0x84`, set the gap to 3, SHOW one whole line.
 * phase 2 (`.L0x80098b3c`)  wait out the gap; more lines left -> phase 1, none -> phase 3
 *                           and the prompt gate `self+0x98` on.
 * phase 3 (`.L0x80098ba4`)  wait for Circle. On the press: step the page, and if the page
 *                           list at `self+0x50` still has an entry run the VM on it and go
 *                           back to phase 0 with the gate off; if it is empty, the object
 *                           reaches state 3 and the line is over.
 * phase 4 (`.L0x80098c38`)  the timed close — 21 ticks, or Circle. Only reachable through
 *                           `+0xb0` (`F0x8009a254`), which nothing in the decoded corpus
 *                           calls, so the game never runs it.
 *
 * The message is on screen from phase 1 onward and there is no timeout on the path the
 * game takes, which is why `BATTLE_MESSAGE_HOLD_TICKS` is `Infinity`.
 */
export class BattleMessageReveal {
    /** `self+0x0c` — the controller's own state. 0 fresh, 1 up, 3 finished. */
    private objState: number;
    /** `self+0x10` — the reveal phase, one of `BATTLE_MESSAGE_PHASE_*`. */
    private phaseIndex: number;
    /** `self+0x78` — how many lines have been shown. */
    private shown = 0;
    /** `self+0x7c` — how many lines the VM built. */
    private lineCount: number;
    /** `self+0x98` — the prompt's gate. Set only when phase 3 starts. */
    private promptGate = false;
    /** `self+0x74` — the VM's "a message was built" flag. */
    private built = false;
    /** `self+0x84` — the tick the current line was stamped on. */
    private stampedAt = 0;
    /** `self+0x14` — the tick phase 4 counts its 21 from. */
    private autoCloseAt = 0;
    /** `self+0x80` — the gap constant, 3. */
    private readonly delay = BATTLE_MESSAGE_LINE_DELAY_TICKS;

    /** The message's lines; the machine shows at most the first two. */
    readonly lines: readonly string[];

    constructor(lines: readonly string[]) {
        this.lines = lines;
        this.lineCount = Math.max(1, Math.min(2, lines.length));
        // `.L0x80099614 sw $zr, 0x78($s4)` and `.L0x8009a200 sw $v0, 0x7c($s4)`: the VM
        // rewinds the cursor and sets the count on every arm, so a fresh line is
        // count = 1 for kind 1 and 2 for every other arm.
        this.objState = BATTLE_MESSAGE_STATE_FRESH;
        this.phaseIndex = BATTLE_MESSAGE_PHASE_READY;
        // Constructing the machine *is* the VM having run: `self+0x74` is already 1, so
        // phase 0 passes on its first pass. A caller that runs the ported VM afterwards
        // calls `builtByVm`, which is where the VM's line count comes from.
        this.built = true;
    }

    /**
     * The ported VM's effect on the machine: `self+0x74 = 1`, the cursor rewound and the
     * count set. `count` defaults to the number of lines the caller handed in.
     */
    builtByVm(count = this.lineCount): void {
        this.built = true;
        this.shown = 0;
        this.lineCount = Math.max(1, Math.min(2, count));
    }

    /** `self+0x7c` — how many lines the message has. */
    get total(): number {
        return this.lineCount;
    }

    /** Whether every line is on screen. `.L0x80098b78 slt $v0, $v1`. */
    get complete(): boolean {
        return this.shown >= this.total;
    }

    /** `self+0x0c` — the controller's state: 0 fresh, 1 up, 3 finished. */
    get state(): number {
        return this.objState;
    }

    /** `self+0x10` — the reveal phase, for a caller that wants to watch the machine. */
    get phase(): number {
        return this.phaseIndex;
    }

    /**
     * `+0xb0`, FIGHTSTG_F0x8009a254: switch the live line to the timed close — phase 4,
     * prompt gate off, and the 21 counted from this tick. Nothing in the decoded corpus
     * calls it, so the battle never reaches phase 4; the port exposes it so the switch is
     * not lost, and `BATTLE_MESSAGE_AUTO_CLOSE_TICKS` is its decoded length.
     */
    autoClose(tick: number): void {
        this.phaseIndex = BATTLE_MESSAGE_PHASE_AUTO;
        this.promptGate = false;
        this.autoCloseAt = tick;
    }

    /**
     * One step, in the original's order. `buttons` is the pad word it reads through
     * `[0x8004BBC4](0)`; only bit `BATTLE_MESSAGE_CLOSE_BIT` matters.
     * @returns whether the controller reached state 3 and should be taken down.
     */
    tick(tick: number, buttons: number): boolean {
        if (this.done) return true;
        // FIGHTSTG_F0x80098c9c `.L0x80098cd4`: a fresh controller only steps itself to
        // state 1 on its first pass; the draw and the reveal start on the next one.
        if (this.objState === BATTLE_MESSAGE_STATE_FRESH) {
            this.objState = BATTLE_MESSAGE_STATE_OPEN;
            this.phaseIndex = BATTLE_MESSAGE_PHASE_READY;
            return false;
        }
        // `.L0x80098cc8 slti $v0, $v1, 0x4` / `bnez` — states 2 and 3 do nothing at all.
        if (this.objState !== BATTLE_MESSAGE_STATE_OPEN) return false;
        // FIGHTSTG_F0x80098c9c `.L0x80098cec`: state 1 draws, then runs the machine.
        this.phaseIndex = this.step(tick, buttons | 0);
        return this.done;
    }

    /** `self+0x0c === 3` — the controller is finished and its owner may take it down. */
    private get done(): boolean {
        return this.objState === BATTLE_MESSAGE_STATE_DONE;
    }

    /** FIGHTSTG_F0x80098a84 — one pass through the phase table. */
    private step(tick: number, buttons: number): number {
        const close = (buttons & BATTLE_MESSAGE_CLOSE_BIT) !== 0;
        switch (this.phaseIndex) {
            // .L0x80098acc — the default arm, and phase 0: wait for the VM.
            case BATTLE_MESSAGE_PHASE_READY:
                if (this.built) this.phaseIndex = BATTLE_MESSAGE_PHASE_SHOW;
                return this.phaseIndex;
            // .L0x80098ae4 — stamp the tick, set the gap, show one whole line.
            case BATTLE_MESSAGE_PHASE_SHOW:
                this.stampedAt = tick;
                this.shown += 1;
                return BATTLE_MESSAGE_PHASE_GAP;
            // .L0x80098b3c — wait out the gap, then the next line or the prompt.
            case BATTLE_MESSAGE_PHASE_GAP:
                if (BATTLE_MESSAGE_LINE_DELAY_TICKS >= tick - this.stampedAt) {
                    return BATTLE_MESSAGE_PHASE_GAP;
                }
                this.shown += 1;
                if (this.shown < this.total) return BATTLE_MESSAGE_PHASE_SHOW;
                // .L0x80098b88 — nothing left to show, so the glyph comes on.
                this.promptGate = true;
                return BATTLE_MESSAGE_PHASE_WAIT;
            // .L0x80098ba4 — wait for Circle. The game never opens a second page: the
            // page list at `self+0x50` is empty on a single-page line, so the press ends it.
            case BATTLE_MESSAGE_PHASE_WAIT:
                if (!close) return BATTLE_MESSAGE_PHASE_WAIT;
                this.promptGate = false;
                this.objState = BATTLE_MESSAGE_STATE_DONE;
                return BATTLE_MESSAGE_PHASE_WAIT;
            // .L0x80098c38 — the timed close: 21 ticks, or Circle.
            case BATTLE_MESSAGE_PHASE_AUTO: {
                const elapsed = tick - this.autoCloseAt;
                if (elapsed < BATTLE_MESSAGE_AUTO_CLOSE_TICKS && !close) {
                    return BATTLE_MESSAGE_PHASE_AUTO;
                }
                this.objState = BATTLE_MESSAGE_STATE_DONE;
                return BATTLE_MESSAGE_PHASE_AUTO;
            }
            default:
                // `.L0x80098acc` for a phase past the table: `self+0x10 + 1` and out.
                if (this.built) this.phaseIndex += 1;
                return this.phaseIndex;
        }
    }

    /**
     * Which line is on screen right now — 1 or 2; 0 before the first one. `self+0x78` is
     * incremented past the count before the compare at `.L0x80098b78`, so the cursor is
     * capped here: a one-line message still shows one line.
     */
    get visibleLines(): number {
        return Math.min(this.shown, this.total);
    }

    /**
     * Whether the advance prompt belongs on screen: `self+0x98 != 0`, so only while phase 3
     * is waiting for the player. It is **not** "a line is up" — the glyph appears once the
     * last line has arrived.
     */
    get promptVisible(): boolean {
        return this.promptGate && !this.done;
    }
}

/** `self+0x10` — the reveal machine's phases, off the table at `0x80083124`. */
export const BATTLE_MESSAGE_PHASE_READY = 0;
export const BATTLE_MESSAGE_PHASE_SHOW = 1;
export const BATTLE_MESSAGE_PHASE_GAP = 2;
export const BATTLE_MESSAGE_PHASE_WAIT = 3;
export const BATTLE_MESSAGE_PHASE_AUTO = 4;

/** `self+0x0c` — the controller's states. Only 0, 1 and 3 are ever written. */
export const BATTLE_MESSAGE_STATE_FRESH = 0;
export const BATTLE_MESSAGE_STATE_OPEN = 1;
export const BATTLE_MESSAGE_STATE_DONE = 3;

/**
 * FIGHTSTG_F0x80098924 — the draw. `.L0x80098a38` the window picture, drawn on every step
 * in state 1 with no hide path; `.L0x800989f8` the prompt, whose frame is `self+0x90`,
 * advanced once every `BATTLE_MESSAGE_PROMPT_TICKS` and wrapping after
 * `BATTLE_MESSAGE_PROMPT_FRAMES`, and reached only while `self+0x98` is set.
 */
export function battleMessagePromptFrame(tick: number): number {
    return Math.trunc(Math.max(0, tick) / BATTLE_MESSAGE_PROMPT_TICKS)
        % BATTLE_MESSAGE_PROMPT_FRAMES;
}

/**
 * The prompt glyph's name in the extracted pack, where the five frames are `10`,
 * `10#1` .. `10#4` (web/assets/ui/cmfont_sheet.json).
 */
export function battleMessagePromptClipId(tick: number): string {
    const frame = battleMessagePromptFrame(tick);
    return frame === 0 ? BATTLE_MESSAGE_PROMPT_CLIP : `${BATTLE_MESSAGE_PROMPT_CLIP}#${frame}`;
}

/**
 * Draw one frame: the window picture, then the prompt when the line is waiting to be read.
 * The original draws the prompt on top of the panel (`.L0x800989f8` sits before the panel
 * call at `.L0x80098a38`, which is the tail every path falls into), and reaches it only
 * while `self+0x98` is set (`.L0x8009895c beqz $v0, .L0x80098a28`).
 */
export function battleMessageDraw(
    host: BattleMessageHost,
    tick: number,
    promptVisible: boolean,
): { panel: number; prompt: number } {
    const panelPack = host.packResolve(BATTLE_MESSAGE_PANEL_PACK);
    host.drawSprite(panelPack, BATTLE_MESSAGE_PANEL_CEL, 0,
        BATTLE_MESSAGE_PANEL_X, BATTLE_MESSAGE_PANEL_Y);
    let prompt = 0;
    if (promptVisible) {
        const promptPack = host.packResolve(BATTLE_MESSAGE_PROMPT_PACK);
        host.drawSprite(promptPack, BATTLE_MESSAGE_PROMPT_CEL,
            battleMessagePromptFrame(tick), BATTLE_MESSAGE_PROMPT_X, BATTLE_MESSAGE_PROMPT_Y);
        prompt = promptPack;
    }
    return { panel: panelPack, prompt };
}

/**
 * The measured box the panel occupies on the 320-wide screen: native (11, 188) plus the
 * pack's own 296 × 38, so x 11..307 and y 188..226. The walker's reserved slot
 * (`message {x:20, y:194, w:288, h:32}` in web/battle.js) was never used and is wrong
 * on both counts.
 */
export const BATTLE_MESSAGE_PANEL_BOX = Object.freeze({
    x: BATTLE_MESSAGE_PANEL_X,
    y: BATTLE_MESSAGE_PANEL_Y,
    w: BATTLE_MESSAGE_PANEL_W,
    h: BATTLE_MESSAGE_PANEL_H,
});