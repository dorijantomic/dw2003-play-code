// The card duel's duel-object method family (S14), one representative:
//   F0x8009D15C build_duel_card_table — view+0xF44, "gather every card this
//              duel can show into one list so the board can preload it".
//
// §33.2 read this end to end at authority 2 and §24.5 named the slot. It is a
// constructor-installed board-view method (no disassembler entry-list start),
// so the m2c C is not the source; it was re-read from the overlay assembly at
//   F0x8009D15C @ exe-decomp/cardgame.norm.s .L0x0001a4ac
// alongside its two overlay helpers, both ordinary `.global` routines:
//   F0x8009D0B0 cardTableRecord @ .L0x0001a400  (writes one entry through the
//              list context's +0x20/+0x24/+0x28 method slots)
//   F0x8009D140 cardIdByIndex   @ .L0x0001a490  (lh of the table 0x800A5B14)
//
// What the body does. It copies the player's forty card ids into duel+0x50 and
// the opponent's forty into duel+0xA0, appends nine ids from a fixed table
// (0x800A5BDC) at duel+0xF0, and finally one hundred ids from F0x8009D140 at
// duel+0x102, recording each resolved card through the list context. The
// return is the last write cursor (0x95 = 149 on the shipped tables) which the
// caller stores at duel+0x244. Nothing a player sees directly.
//
// The resident card-cursor service (F0x8001EBF8 / F0x8001FFA8 and the
// [sp+0x74] resolver) stays a host edge, the way the element panel's cursor
// does; the id tables are shipped data (0x800A5BDC baked here, 0x800A5B14 read
// through the host so a session without the overlay image still runs).

export interface CardTableMemory {
    read16s(addr: number): number;
    write16(addr: number, value: number): void;
    write8(addr: number, value: number): void;
}

export interface CardTableHost {
    /** F0x8001EBF8(buf): open the card cursor. Returns its context handle. */
    openCardTableCursor(): number;
    /** F0x8001FFA8(buf): open the second list context. Returns its handle. */
    openCardList(): number;
    /** the [sp+0x74] callback: resolve a 1-based card id into the cursor. */
    resolveCardInto(cursor: number, id: number): void;
    /** F0x8009D0B0(listCtx, cursorCtx+0xC, tag): record one resolved entry. */
    cardTableRecord(listCtx: number, cursorCtx: number, tag: number): void;
    /** F0x8009D140(index): lh of the shipped id table 0x800A5B14. */
    cardIdByIndex(index: number): number;
    /** `(*0x8004DC0C)()`: the resident random word the pile shuffle draws. */
    randU16(): number;
}

/** The nine fixed ids the third loop appends (table 0x800A5BDC). */
export const CARD_TABLE_FIXED_IDS: readonly number[] = [80, 99, 140, 184, 229, 251, 313, 314, 315];
/** The id-table the fourth loop walks and its entry count. */
export const CARD_TABLE_ID_TABLE = 0x800a5b14;
export const CARD_TABLE_ID_COUNT = 100;

/**
 * F0x8009D15C(playerList, opponentList, playerOut): gather the duel's card
 * table. `playerList`/`opponentList` are the forty-entry id arrays; `out` is
 * the board view's own table (duel+0x50). Returns the final write cursor.
 */
export function buildDuelCardTable(
    mem: CardTableMemory, host: CardTableHost,
    out: number, playerList: number, opponentList: number,
): number {
    const cursor = host.openCardTableCursor() | 0;
    const list = host.openCardList() | 0;
    let count = 0x28;
    // Loop A: the player's forty ids -> out[0..39].
    for (let i = 0; i < 0x28; i++) {
        const id = mem.read16s(playerList + i * 2) | 0;
        host.resolveCardInto(cursor, (id + 1) | 0);
        host.cardTableRecord(list, (cursor + 0xc) | 0, i);
        mem.write16(out + i * 2, id & 0xffff);
    }
    // Loop B: the opponent's forty ids -> out+0x50 [0..39].
    for (let i = 0; i < 0x28; i++) {
        const id = mem.read16s(opponentList + i * 2) | 0;
        host.resolveCardInto(cursor, (id + 1) | 0);
        host.cardTableRecord(list, (cursor + 0xc) | 0, (i + 0x28) | 0);
        mem.write16(out + 0x50 + i * 2, id & 0xffff);
    }
    // Loop C: nine fixed ids -> out+0xA0.
    for (let i = 0; i < CARD_TABLE_FIXED_IDS.length; i++) {
        count++;
        const id = CARD_TABLE_FIXED_IDS[i] as number;
        host.resolveCardInto(cursor, (id + 1) | 0);
        host.cardTableRecord(list, (cursor + 0xc) | 0, (i + 0x50) | 0);
        mem.write16(out + 0xa0 + i * 2, id & 0xffff);
    }
    // Loop D: one hundred ids from the shipped table -> out+0xB2; each also
    // stores its own index at out+0x62.
    for (let i = 0; i < CARD_TABLE_ID_COUNT; i++) {
        const id = host.cardIdByIndex(i) | 0;
        host.resolveCardInto(cursor, (id + 1) | 0);
        host.cardTableRecord(list, (cursor + 0xc) | 0, (i + 0x59) | 0);
        count++;
        mem.write16(out + 0xb2 + i * 2, host.cardIdByIndex(i) & 0xffff);
    }
    return count | 0;
}

/** The pile block and the field the shuffle swaps (duel object method +0x810). */
export const PILE_SHUFFLE_BASE = 0x59c;
export const PILE_SHUFFLE_FIELD = 0x14;
export const PILE_SHUFFLE_SWAPS = 0x28;

/**
 * F0x8009F04C(duel, offset, count): shuffle `count` halfwords of `duel`'s pile
 * block — the "randomised pile shuffle" the duel object installs at +0x810.
 * Draws two random indices in [0, count) per swap, forty swaps, over the words
 * at `duel + 0x59C + 0x14 + (offset + r)*2`. A count below 2 does nothing. Read
 * from the overlay assembly at .L0x0001c39c (the duel object's constructor
 * installs the pointer, so it has no disassembler entry-list start).
 */
export function shufflePile(
    mem: CardTableMemory, host: CardTableHost, duel: number, offset: number, count: number,
): void {
    if ((count | 0) < 2) return;
    const base = (duel + PILE_SHUFFLE_BASE + PILE_SHUFFLE_FIELD) | 0;
    for (let i = 0; i < PILE_SHUFFLE_SWAPS; i++) {
        const r0 = (host.randU16() | 0) % (count | 0);
        const r1 = (host.randU16() | 0) % (count | 0);
        const a = ((offset | 0) + r0) | 0;
        const b = ((offset | 0) + r1) | 0;
        const va = mem.read16s(base + a * 2) | 0;
        const vb = mem.read16s(base + b * 2) | 0;
        mem.write16(base + a * 2, vb & 0xffff);
        mem.write16(base + b * 2, va & 0xffff);
    }
}
