// THE field item applier: one decision, one place. Ported from the original's
// pause ITEMS routine F0x8008F584 (`~/ddw3/asm/dw2003/pro/ststatus.s` file
// 0xC8D4, lines 12860-13070).
//
// WHY THIS IS ITS OWN MODULE. The walker had two appliers: the memory-backed one
// inside the ported pause page (engine/dw3/ui/native/pause-bag.ts) and a second,
// hand-written one in engine/dw3/items.ts that re-typed the same rules in walker
// state and disagreed with the original on fifteen effect codes at their cap. Two
// appliers for one system is the "converted copy with hand rows" the repository
// rules forbid, so the DECISION now lives here and each caller supplies only a
// view of "the stat block the item writes into".
//
// The block is addressed the way the original addresses it: `$a0` is the roster
// record's stats block, and every index below is a halfword step from `$a0 + 0x1C`
// (`pro/ststatus.s:12966` `addiu $s1, $a0, 0x1c`). Read it as
// `statsBlock + 0x1C + 2 * index`, i.e. record + 0x24 + 2 * index.
//
// | what | block offset | record offset | index |
// |---|---|---|---|
// | TP | +0x1E | +0x26 | 1 |
// | HP | +0x20 | +0x28 | 2 |
// | max HP | +0x22 | +0x2A | 3 |
// | MP | +0x24 | +0x2C | 4 |
// | max MP | +0x26 | +0x2E | 5 |
// | the six core stats | +0x28..+0x32 | +0x30..+0x3A | 6..11 |
// | the seven element tolerances | +0x34..+0x40 | +0x3C..+0x48 | 12..18 |
//
// WHAT THE ORIGINAL DOES, per effect code (the selector is the effect record's
// byte +1; its value is the halfword at +2 - `pro/ststatus.s:12888`, `:12910`):
//
//   0x00  nothing. `:12895` `beqz $v1, .L0x0000cb30` -> `$a1` is still 0 -> the
//         refusal line, and the consume at `:13039` is on the applied path only,
//         so the copy stays in the bag.
//   0x01  HP += value. Refused when HP is not below max HP (`:12894` `beqz`,
//         the compare at `:12898` is `slt $v0, $v0, $v1` = HP < maxHP). The copy
//         is spent on success either way; a heal the max clipped prints the
//         constant message id 0x52 and NO amount (`:12935`-`:12936` `li $a1, 2`).
//   0x11  TP += value, refused at 99 (`:12939` `slti $v0, $v0, 0x63`), clipped at
//         99 (`:12941` `slti $v0, $v0, 0x64` then `li $v0, 0x63`).
//   0x02..0x10, everything else  its own table below; refused at the cap, the rise
//         is `rand() % value + 1` (`:12976`-`:12989`), clipped at the cap, and the
//         MESSAGE reports the ROLLED amount even when the clip made the real rise
//         smaller - `$s3` is the roll and the clamp at `:12960`/`:12963` never
//         touches it.
//   anything with no table entry  the walk ends on the `-1` terminator
//         (`:12960`/`:12964`), so it refuses exactly like 0x00.
//
// The consumable band 43..91 and the boosters 361..394 point at the 12-byte pair
// table 0x8005cb54 (`{u16 code, u16 value}`), so the shipped item table uses
// effect codes 0x00..0x11 and nothing else; equipment 92..291, accessories
// 292..359 and the 51 key items all read 0 at byte +1 and land on the no-effect
// arm. Read out of the disc by tests/item-effect-codes.test.js.

/** Effect codes the original dispatches on, by name. Byte +1 of the effect record. */
export const EFFECT_NONE = 0x00;
export const EFFECT_HP_CHARGE = 0x01;
export const EFFECT_HP_CHIP = 0x02;
export const EFFECT_MP_CHIP = 0x03;
export const EFFECT_TP_CHIP = 0x11;

/** Halfword steps from `$a0 + 0x1C` for the fields the applier can touch. */
export const IDX_TP = 1;
export const IDX_HP = 2;
export const IDX_MAX_HP = 3;
export const IDX_MAX_MP = 5;
/** The six core stats, in record +0x30..+0x3A order. */
export const IDX_CORE_BASE = 6;
/** The seven element tolerances, in record +0x3C..+0x48 order. */
export const IDX_ELEMENT_BASE = 12;

/** The hard ceiling on trainer points (`:12943` `li $v0, 0x63`). */
export const TP_CAP = 99;

/**
 * The stat-boost table the default arm walks: six-byte entries
 * `{selector: i16, index: i16, cap: i16}` at `pro/ststatus.s` file 0x17C2C
 * (RAM 0x8009A8DC), a `-1` selector terminating it (`:12955` `lh $v1, -0x5724($a2)`
 * where `$a2` is 0x800A0000).
 *
 * It deliberately omits 0x11, which is why the dispatch sends 0x11 to the TP arm
 * instead, and it omits 0x00 and 0x01, which have their own arms.
 */
export interface FieldItemBoostEntry {
    selector: number;
    index: number;
    cap: number;
}
export const FIELD_ITEM_BOOST_TABLE: readonly FieldItemBoostEntry[] = Object.freeze([
    { selector: 0x02, index: IDX_MAX_HP, cap: 9999 },   // record +0x2A max HP
    { selector: 0x03, index: IDX_MAX_MP, cap: 9999 },   // record +0x2E max MP
    { selector: 0x04, index: 6, cap: 999 },             // +0x30 STR
    { selector: 0x05, index: 7, cap: 999 },             // +0x2A DEF -> record +0x32
    { selector: 0x06, index: 8, cap: 999 },             // record +0x34 SPT
    { selector: 0x07, index: 9, cap: 999 },             // record +0x36 WIS
    { selector: 0x08, index: 10, cap: 999 },            // record +0x38 SPD
    { selector: 0x09, index: 11, cap: 999 },            // record +0x3A CHR
    { selector: 0x0a, index: 12, cap: 999 },            // record +0x3C fire
    { selector: 0x0b, index: 13, cap: 999 },            // +0x3E water
    { selector: 0x0c, index: 14, cap: 999 },            // +0x40 ice
    { selector: 0x0d, index: 15, cap: 999 },            // +0x42 wind
    { selector: 0x0e, index: 16, cap: 999 },            // +0x44 thunder
    { selector: 0x0f, index: 17, cap: 999 },            // +0x46 machine
    { selector: 0x10, index: 18, cap: 999 },            // +0x48 dark
].map((e) => Object.freeze(e)) as readonly FieldItemBoostEntry[]);

/** The message id the original prints when an item does nothing (`:13063` `li $a2, 0x6a`). */
export const MESSAGE_NO_EFFECT = 0x6a;
/** The message id for a success (`:13023`/`:13027`: the selector plus 0x52). */
export const MESSAGE_SUCCESS_BASE = 0x52;
/** The sound on the refusal path (`:13064`+`:13067`: `lui 0x4` / `ori 0x1c`). */
export const SOUND_NO_EFFECT = 0x4001c;
/** The sound on the applied path (`:12946`+`:12950`: `lui 0x4` / `ori 0x14`). */
export const SOUND_APPLIED = 0x40014;

/** The stat block an item writes into, as indexable halfwords. */
export interface FieldItemTarget {
    /** The signed halfword at `$a0 + 0x1C + 2 * index`. */
    read(index: number): number;
    write(index: number, value: number): void;
}

/**
 * What the applier did.
 *
 * `flag` is the original's `$a1`: 0 nothing applied (the refusal line, and NO
 * consume), 1 applied (consume, message `selector + 0x52`, amount `used`), 2
 * applied but clipped by max HP (consume, the constant message 0x52, no amount).
 */
export interface FieldItemOutcome {
    flag: 0 | 1 | 2;
    /** The amount the original reports: the roll for a chip, `value` for a charge. */
    used: number;
    /** The block index that moved, or -1 when nothing did. */
    index: number;
    /** How much the field actually rose, after the cap clipped it. */
    delta: number;
}

const REFUSED: FieldItemOutcome = Object.freeze({ flag: 0, used: 0, index: -1, delta: 0 });

/**
 * F0x8008F584's decision, for one item use.
 *
 * @param target   the stat block the effect writes into
 * @param selector the effect record's byte +1 (0x00..0x11 in the shipped table)
 * @param amount   the effect record's halfword at +2: the divisor of the roll for
 *                 the chip arms, the grant itself for the HP and TP arms
 * @param rand     the original's `rand()` - a non-negative integer. The roll is
 *                 `rand() % amount + 1` (`:12982` `div`, `:12983` `mfhi`,
 *                 `:12989` `addiu $s3, $a0, 0x1`).
 */
export function applyFieldItemEffect(
    target: FieldItemTarget,
    selector: number,
    amount: number,
    rand: () => number,
    table: readonly FieldItemBoostEntry[] = FIELD_ITEM_BOOST_TABLE,
): FieldItemOutcome {
    if (selector === EFFECT_HP_CHARGE) {
        const hp = target.read(IDX_HP);
        const maxHp = target.read(IDX_MAX_HP);
        if (!(hp < maxHp)) return REFUSED;
        const v = hp + amount;
        target.write(IDX_HP, v);
        if (maxHp < v) {
            // The clipped arm (`:12922`-`:12936`): the message is the constant
            // 0x52 and no amount call follows it.
            target.write(IDX_HP, maxHp);
            return { flag: 2, used: amount, index: IDX_HP, delta: maxHp - hp };
        }
        return { flag: 1, used: amount, index: IDX_HP, delta: amount };
    }
    if (selector === EFFECT_TP_CHIP) {
        const tp = target.read(IDX_TP);
        if (!(tp < TP_CAP)) return REFUSED;
        const v = tp + amount;
        target.write(IDX_TP, v);
        const kept = v < TP_CAP + 1 ? v : TP_CAP;
        if (kept !== v) target.write(IDX_TP, kept);
        return { flag: 1, used: amount, index: IDX_TP, delta: kept - tp };
    }
    // 0x00 and every code with no table entry stop here: the original's walk ends
    // on the `-1` terminator with `$a1` still 0.
    for (const entry of table) {
        if (entry.selector !== selector) continue;
        const before = target.read(entry.index);
        if (!(before < entry.cap)) return REFUSED;
        const used = (rand() % amount) + 1;
        const after = before + used;
        target.write(entry.index, after);
        if (entry.cap < after) target.write(entry.index, entry.cap);
        return { flag: 1, used, index: entry.index, delta: target.read(entry.index) - before };
    }
    return REFUSED;
}

/** The message id the original prints for an applied item (`:13027` `addiu $a2, 0x52`). */
export function fieldItemMessageId(selector: number): number {
    return (MESSAGE_SUCCESS_BASE + (selector & 0xff)) & 0xffff;
}