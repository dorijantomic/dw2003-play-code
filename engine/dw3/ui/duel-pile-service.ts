// The duel's pile/hand bookkeeping — the layer *beneath* the nine mode updates.
//
// The mode updates (the draw, load, battle and set-end phases) do not do this
// work themselves: every one of them calls into a further layer of duel
// routines, and this module ports the family that keeps the opponent's hand and
// deck records honest. Four routines, one mechanism — a pile record of two
// counts, a run counter, an order array and a source array, plus the per-slot
// group byte that says whether a slot may still be drawn. The mode updates then
// become thin drivers over these services.
//
// Translated from pro/cardgame (assembly, authority 2):
//   F0x8009D9E4 scanDeckAvailability        — where the opponent's draw cursor is
//   F0x8009D8FC sortAiHandByPriority        — order the opponent's hand in place
//   F0x8009DA68 recycleOpponentHandIntoDeck — leftover hand back to deck, restamp
//   F0x800A19F8 returnHandToDeck            — push every remaining hand card back
//
// Source (assembly): exe-decomp/cardgame.norm.s
//   F0x8009d8fc @.L0x0001ac4c, F0x8009d9e4 @.L0x0001ad34, F0x8009da68
//   @.L0x0001adb8, F0x800a19f8 @.L0x0001ed48.
//
// The m2c C for F0x8009DA68 is WRONG at one store: it re-reads
// `block[0x14 + a2*2]` *after* the gap-closing shift has already overwritten
// that slot, instead of using the value it loaded before the shift (the
// assembly keeps it in $t2). This port reads the value before shifting, from
// the assembly, not from the C.
//
// What the player sees. Between sets and after the opponent's turn the leftover
// hand cards walk back onto that side's deck (returnHandToDeck), the opponent's
// hand is sorted so higher-priority cards sit first (sortAiHandByPriority), the
// draw cursor is advanced past the slots this set may no longer draw
// (scanDeckAvailability), and the recycled opponent pile is restamped so the
// next set can draw from it again (recycleOpponentHandIntoDeck).
//
// CITED in docs/research/card/CARD-DUEL-VERIFIED.md: §14 row 14 (side 1's
// F0x8009DA68 has no call instruction — the opponent pile is never reshuffled,
// only restamped), §33.3 (F0x8009D9E4, cursor and group byte), §34.3-§34.4
// (the `duel+0x678`/`duel+0x6C8` arrays and the two hand arrays). The card doc
// calls F0x8009D9E4 "nothing to port" because the browser models it as its own
// deckSlots pair; this module ports the disc mechanism itself so the mode
// updates can run it directly.

export interface DuelPileMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
}

/** The pile/hand record layout shared by the deck-side bookkeeping routines. */
export const DUEL_PILE = {
    /** The opponent's draw cursor into the identity array (s16). */
    cursor: 0x668,
    /** The group base this set may draw up to (`2*base + 2` is the window). */
    groupBase: 0x300,
    /** The per-slot group byte, stride 2 (the high byte of the identity array). */
    groupBytes: 0x30b,
    /** The identity array, stride 2; part 4 refills its low byte with the slot. */
    identity: 0x30a,
    /** The first still-available slot for this set (u8). */
    firstAvailable: 0x41b,
    /** The first retired slot, or 40 when none is retired (u8). */
    firstRetired: 0x41c,
    /** The opponent's hand-order array, stride 2 (s16 entries). */
    handArray: 0x6c8,
    /** Per-slot card class byte, stride 4; slot = (entry - 40). */
    cardClass: 0x35c,
    /** Per-slot card weight s16, stride 4. */
    cardWeight: 0x35e,
    /** The opponent's hand/deck record base (`duel+0x664`). */
    opponentRecord: 0x664,
    /** Record fields, relative to a record base. */
    recCount: 0x4,   // s16: cards still in the record
    recRun: 0x8,     // u16: running count of cards moved
    recRemain: 0xa,  // s16: cards still to move this pass
    recOrder: 0x14,  // u16 array, stride 2
    recSource: 0x64, // u16 array, stride 2
    /** Slots in a pile (the identity arrays hold 0..39). */
    slots: 0x28,
    /** The group byte the retired slots carry. */
    groupRetired: 7,
} as const;

/** Sign-extend a 16-bit value (the assembly's `sll 0x10 / sra 0xF` scale). */
function s16(v: number): number {
    return (v << 16) >> 16;
}

/**
 * F0x8009D9E4(duel): move the opponent's draw cursor past the slots this set may
 * no longer draw, then record the first still-available slot (duel+0x41B) and
 * the first retired slot (duel+0x41C). Pure bookkeeping over the group bytes;
 * the browser used to carry this as its own `deckSlots` pair.
 */
export function scanDeckAvailability(mem: DuelPileMemory, duel: number): void {
    let cursor = mem.read16s(duel + DUEL_PILE.cursor);
    if (cursor < DUEL_PILE.slots) {
        let p = duel + cursor * 2;
        const window = ((mem.read8(duel + DUEL_PILE.groupBase) & 0xff) * 2) + 2;
        while (true) {
            if (window < (mem.read8(p + DUEL_PILE.groupBytes) & 0xff)) break;
            cursor += 1;
            p += 2;
            if (cursor >= DUEL_PILE.slots) break;
        }
    }
    mem.write8(duel + DUEL_PILE.firstAvailable, cursor & 0xff);

    let a: number = DUEL_PILE.slots;
    let v: number = DUEL_PILE.slots - 1;
    while (true) {
        if ((mem.read8(duel + v * 2 + DUEL_PILE.groupBytes) & 0xff) !== DUEL_PILE.groupRetired) break;
        a = v;
        v = a - 1;
        if (a <= 0) break;
    }
    mem.write8(duel + DUEL_PILE.firstRetired, a & 0xff);
}

/**
 * F0x8009D8FC(duel): insertion-sort the opponent's hand-order array in place,
 * ascending by the per-slot card class and then by the stored weight. The array
 * holds folder slots (40..79); the card's class and weight live at a 4-byte
 * stride off the entry.
 */
export function sortAiHandByPriority(mem: DuelPileMemory, duel: number): void {
    const count = mem.read16s(duel + 0x66e);
    for (let i = 0; i < count - 1; i++) {
        for (let j = i + 1; j < count; j++) {
            const ei = mem.read16s(duel + DUEL_PILE.handArray + i * 2);
            const ej = mem.read16s(duel + DUEL_PILE.handArray + j * 2);
            const ci = mem.read8(duel + DUEL_PILE.cardClass + (ei - DUEL_PILE.slots) * 4);
            const cj = mem.read8(duel + DUEL_PILE.cardClass + (ej - DUEL_PILE.slots) * 4);
            const wi = mem.read16s(duel + DUEL_PILE.cardWeight + (ei - DUEL_PILE.slots) * 4);
            const wj = mem.read16s(duel + DUEL_PILE.cardWeight + (ej - DUEL_PILE.slots) * 4);
            if ((cj < ci) || (ci === cj && wj < wi)) {
                mem.write16(duel + DUEL_PILE.handArray + i * 2, ej & 0xffff);
                mem.write16(duel + DUEL_PILE.handArray + j * 2, ei & 0xffff);
            }
        }
    }
}

/**
 * F0x800A19F8(block): push every card still in the record back onto its deck,
 * one at a time — `count` and `remain` walk down together, each moved card is
 * appended at `order[count]` from `source[remain]`, and the run counter ticks up.
 * Operates on any pile record passed in (the opponent's `duel+0x664`, or a
 * side's `duel+0x59C` during the set transition).
 */
export function returnHandToDeck(mem: DuelPileMemory, block: number): void {
    if (mem.read16s(block + DUEL_PILE.recRemain) > 0) {
        do {
            const a = (mem.read16(block + DUEL_PILE.recCount) - 1) & 0xffff;
            const b = (mem.read16(block + DUEL_PILE.recRemain) - 1) & 0xffff;
            mem.write16(block + DUEL_PILE.recCount, a);
            mem.write16(block + DUEL_PILE.recRemain, b);
            mem.write16(
                block + s16(a) * 2 + DUEL_PILE.recOrder,
                mem.read16(block + s16(b) * 2 + DUEL_PILE.recSource),
            );
            mem.write16(block + DUEL_PILE.recRun, (mem.read16(block + DUEL_PILE.recRun) + 1) & 0xffff);
        } while (mem.read16s(block + DUEL_PILE.recRemain) > 0);
    }
}

/**
 * F0x8009DA68(duel): the opponent's leftover hand goes back into its own deck —
 * returnHandToDeck on the `duel+0x664` record — then restamp which cards this set
 * may still draw. The cards that left come out of the availability window: every
 * slot that was retired by the move is stamped group `2*base + 1`; then, while
 * the slot at the new count is inside the window, the order/group arrays close
 * the gap up to the retired boundary; finally the identity array is refilled with
 * the slot indices and the retired slots are reset to group 7.
 */
export function recycleOpponentHandIntoDeck(mem: DuelPileMemory, duel: number): void {
    const block = duel + DUEL_PILE.opponentRecord;
    const origCount = mem.read16s(block + DUEL_PILE.recCount);
    returnHandToDeck(mem, block);

    // The cards that left the hand come out of the window.
    const newCount = mem.read16s(block + DUEL_PILE.recCount);
    if (origCount !== newCount && newCount < origCount) {
        let idx = newCount;
        let p = duel + idx * 2;
        do {
            idx += 1;
            mem.write8(p + DUEL_PILE.groupBytes, (((mem.read8(duel + DUEL_PILE.groupBase) & 0xff) * 2) + 1) & 0xff);
            p += 2;
        } while (idx < origCount);
    }

    // Close the gap in the order/group arrays up to the retired boundary.
    let moved = 0;
    const guard = DUEL_PILE.slots;
    while (moved < guard) {
        const start = mem.read16s(block + DUEL_PILE.recCount);
        if (((mem.read8(duel + DUEL_PILE.groupBase) & 0xff) * 2) + 2 < (mem.read8(duel + start * 2 + DUEL_PILE.groupBytes) & 0xff)) {
            break;
        }
        const saved = mem.read16(block + start * 2 + DUEL_PILE.recOrder);
        let a = start;
        let last = (mem.read8(duel + DUEL_PILE.firstRetired) & 0xff) - 1;
        while (a < last) {
            a += 1;
            mem.write16(block + (a - 1) * 2 + DUEL_PILE.recOrder, mem.read16(block + a * 2 + DUEL_PILE.recOrder));
            mem.write8(duel + (a - 1) * 2 + DUEL_PILE.groupBytes, mem.read8(duel + a * 2 + DUEL_PILE.groupBytes));
            last = (mem.read8(duel + DUEL_PILE.firstRetired) & 0xff) - 1;
        }
        mem.write16(block + last * 2 + DUEL_PILE.recOrder, saved);
        moved += 1;
        mem.write8(duel + last * 2 + DUEL_PILE.groupBytes, DUEL_PILE.groupRetired);
    }

    // Refill the identity array: low byte = slot.
    for (let k = 0; k < DUEL_PILE.slots; k++) mem.write8(duel + DUEL_PILE.identity + k * 2, k & 0xff);
}
