// The duel's counter/stat presentation services — the layer that keeps the
// numbers on both players' strips and the two totals honest. Five routines,
// one mechanism: a side's stat block (stride 0xC8) and its field row (stride
// 0x72) are read, summed, and pushed to the board view's HUD slot (+0xEA0).
//
// Translated from pro/cardgame (assembly, authority 2):
//   F0x8009EDCC refreshAllCounters     — push ten numbers per side to view+0xEA0
//   F0x800A0ACC recomputeSideTotals    — a side's attack/health = sum of its row
//   F0x800A09FC applyDynamicStatMegas  — walk both rows, once per colour
//   F0x800A0844 applyDynamicStatMega   — a colour's named mega gets its bonus
//   (0x800A0844's jump table D0x80083960 did not lift; read from the binary)
//
// Source (assembly): exe-decomp/cardgame.norm.s
//   F0x8009edcc @.L0x0001c11c, F0x800a0acc @.L0x0001de1c, F0x800a09fc
//   @.L0x0001dd4c, F0x800a0844 @.L0x0001db94; D0x800A0844's five arms
//   F0x800a08f8/0914/092c/0950/0974 read word-by-word from pro_cardgame.bin
//   (table D0x80083960, six entries incl. the null).
//
// What the player sees. After a card resolves or a phase turns over, every
// number on both HUD strips is repainted from the duel's own state
// (refreshAllCounters): the five colour pools, then the deck, hand and discard
// counts, then the two big totals. recomputeSideTotals rebuilds a side's attack
// and health as the sum of the cards actually in its row. The five
// dynamic-stat Megas — the named cards whose printed numbers mean nothing
// because theirs are computed from the board — get their real value through
// applyDynamicStatMega: each colour's mega is found in the row and its bonus
// (20 per own field card, 10 per hand card, 20 per trash card, and two
// both-sides variants) is clamped to 0..99 and written onto the slot's own
// stat pair. applyDynamicStatMegas runs that for all five colours on both
// sides, and reports whether either row held anything.
//
// The view slot +0xEA0 (setHudCounter F0x8009CAE0) is a host edge here, exactly
// as duel-board-view.ts ports it: its body is a separate constructor-installed
// view method, not this family's. CITED in docs/research/card/CARD-DUEL-VERIFIED.md
// §19.3 (the five formulas, re-derived here from the binary), §22 (the mega id
// table 0x800A5C20 = DUEL_DYNAMIC_STAT_MEGAS), §33.4 (F0x8009EDCC's ten reads).

export interface DuelCounterMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

/** The view's own HUD slot this family pushes every number through. */
export interface DuelCounterHost {
    /** `view+0xEA0(view, side, index, value)` = F0x8009CAE0 setHudCounter. */
    setHudCounter(view: number, side: number, index: number, value: number): void;
}

/** The per-side block stride (a side's stat block is 0xC8 apart). */
const DUEL_SIDE_STRIDE = 0xc8;
/** The stat block's fields, relative to `duel + side*0xC8`. */
export const DUEL_STAT = {
    /** The five S-Energy bytes: `+0x5A8 + colour`, pushed as HUD slots 0..4. */
    energy: 0x5a8,
    /** Total attack (u16), pushed as HUD slot 8. */
    totalAp: 0x59c,
    /** Total health (u16), pushed as HUD slot 9. */
    totalHp: 0x59e,
    /** Discard/trash count (s16), pushed as HUD slot 7. */
    trash: 0x5a2,
    /** Deck count (s16), pushed as HUD slot 5. */
    deck: 0x5a4,
    /** Hand count (s16), pushed as HUD slot 6. */
    hand: 0x5a6,
} as const;
/** The side's field row stride and its per-slot record stride. */
const DUEL_ROW_STRIDE = 0x72;
const DUEL_SLOT_STRIDE = 0xe;
/** The field row's card count, relative to `duel + side*0x72 + 0x72C`. */
const DUEL_ROW_COUNT = 0x72c;
/** The slot record's fields, relative to the row's own base. */
export const DUEL_SLOT = {
    /** The card id (s16). */
    id: 0x0,
    /** The slot's displayed stat base (s16), read as the mega formula's base. */
    base: 0x2,
    /** The computed attack the megas write (u16). */
    attack: 0x6,
    /** The computed health the megas write (u16). */
    health: 0x8,
    /** attack/health recomputeSideTotals sums, at the slot record + 0x734. */
    sumAp: 0x734,
    sumHp: 0x736,
} as const;
/** The five-card dynamic-stat Mega id list (overlay table D0x800A5C20). */
export const DUEL_DYNAMIC_STAT_MEGAS: readonly number[] = [68, 111, 154, 197, 240];

/**
 * F0x8009EDCC(duel, ctx): repaint every number on both HUD strips. For side 0
 * then side 1 it pushes ten values to the board view (found at `ctx+0x18`)
 * through slot +0xEA0: the five S-Energy bytes (slots 0..4), then deck, hand and
 * discard counts (5, 6, 7), then the two totals (8, 9).
 */
export function refreshAllCounters(
    mem: DuelCounterMemory, host: DuelCounterHost, duel: number, ctx: number,
): void {
    const view = mem.read32(ctx + 0x18) | 0;
    for (let side = 0; side < 2; side++) {
        const block = duel + side * DUEL_SIDE_STRIDE;
        for (let colour = 0; colour < 5; colour++) {
            host.setHudCounter(view, side, colour, mem.read8(block + DUEL_STAT.energy + colour) & 0xff);
        }
        host.setHudCounter(view, side, 5, mem.read16s(block + DUEL_STAT.deck));
        host.setHudCounter(view, side, 6, mem.read16s(block + DUEL_STAT.hand));
        host.setHudCounter(view, side, 7, mem.read16s(block + DUEL_STAT.trash));
        host.setHudCounter(view, side, 8, mem.read16s(block + DUEL_STAT.totalAp));
        host.setHudCounter(view, side, 9, mem.read16s(block + DUEL_STAT.totalHp));
    }
}

/**
 * F0x800A0ACC(duel, side): a side's attack and health are rebuilt as the sum of
 * the cards in that side's row. Both totals are cleared, then every slot up to
 * the row's own count adds its stat pair (+0x734 / +0x736).
 */
export function recomputeSideTotals(mem: DuelCounterMemory, duel: number, side: number): void {
    const block = duel + side * DUEL_SIDE_STRIDE;
    mem.write16(block + DUEL_STAT.totalAp, 0);
    mem.write16(block + DUEL_STAT.totalHp, 0);
    const row = duel + side * DUEL_ROW_STRIDE;
    const count = mem.read8(row + DUEL_ROW_COUNT) & 0xff;
    for (let i = 0; i < count; i++) {
        const rec = row + i * DUEL_SLOT_STRIDE;
        mem.write16(block + DUEL_STAT.totalAp, (mem.read16(block + DUEL_STAT.totalAp) + mem.read16(rec + DUEL_SLOT.sumAp)) & 0xffff);
        mem.write16(block + DUEL_STAT.totalHp, (mem.read16(block + DUEL_STAT.totalHp) + mem.read16(rec + DUEL_SLOT.sumHp)) & 0xffff);
    }
}

/**
 * F0x800A0844(duel, slot, side, colour): if this slot's card is the named mega
 * for `colour`, apply that colour's bonus to the slot's stat pair. `slot` is the
 * row's own record pointer (`row + 2 + i*0xE`). The five arms, read from the
 * binary because the jump table D0x80083960 did not lift:
 *   colour 0: base + 20 × own field count
 *   colour 1: base + 10 + 10 × own hand count
 *   colour 2: base + 10 + 20 × own trash count
 *   colour 3: base + 10 × (both sides' field counts)
 *   colour 4: base + 10 + 10 × (both sides' trash counts)
 * The result is clamped to 0..99 and written as the slot's attack and health.
 */
export function applyDynamicStatMega(
    mem: DuelCounterMemory, duel: number, slot: number, side: number, colour: number,
): void {
    if (colour < 0 || colour >= DUEL_DYNAMIC_STAT_MEGAS.length) return;
    const block = duel + side * DUEL_SIDE_STRIDE;
    const cardId = mem.read16s(slot + DUEL_SLOT.id);
    const entry = mem.read16s(duel + 0x50 + cardId * 2);
    if (entry !== DUEL_DYNAMIC_STAT_MEGAS[colour]) return;
    const base = mem.read16s(slot + DUEL_SLOT.base);
    let value: number;
    switch (colour) {
        case 0:
            value = base + 20 * (mem.read8(duel + side * DUEL_ROW_STRIDE + DUEL_ROW_COUNT) & 0xff);
            break;
        case 1:
            value = base + 10 + 10 * mem.read16s(block + DUEL_STAT.hand);
            break;
        case 2:
            value = base + 10 + 20 * mem.read16s(block + DUEL_STAT.trash);
            break;
        case 3:
            value = base + 10 * ((mem.read8(duel + DUEL_ROW_COUNT) & 0xff)
                + (mem.read8(duel + DUEL_ROW_COUNT + DUEL_ROW_STRIDE) & 0xff));
            break;
        default:
            value = base + 10 + 10 * (mem.read16s(duel + DUEL_STAT.trash)
                + mem.read16s(duel + DUEL_STAT.trash + DUEL_SIDE_STRIDE));
            break;
    }
    if (value >= 99) value = 99;
    if (value <= 0) value = 0;
    mem.write16(slot + DUEL_SLOT.attack, value & 0xffff);
    mem.write16(slot + DUEL_SLOT.health, value & 0xffff);
}

/**
 * F0x800A09FC(duel): run every colour's mega bonus across both rows. The outer
 * loop is the colour (0..4), the inner the side (0..1); a side with an empty row
 * is skipped. Returns 1 if either row held any card across the walk, else 0.
 */
export function applyDynamicStatMegas(mem: DuelCounterMemory, duel: number): number {
    let found = 0;
    for (let colour = 0; colour < 5; colour++) {
        for (let side = 0; side < 2; side++) {
            const row = duel + side * DUEL_ROW_STRIDE;
            const count = mem.read8(row + DUEL_ROW_COUNT) & 0xff;
            if (count === 0) continue;
            found = 1;
            for (let i = 0; i < count; i++) {
                applyDynamicStatMega(mem, duel, row + 2 + i * DUEL_SLOT_STRIDE, side, colour);
            }
        }
    }
    return found;
}
