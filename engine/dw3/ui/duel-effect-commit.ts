// The duel's effect/commit boundaries — the layer between "a card is selected"
// and "the board shows what it may hit". Two routines, one mechanism: a card is
// parked on the played stack (a stride-8 record keyed by the played hand slot),
// and from that record's own filter class the board marks which slots the
// pending effect may legally reach.
//
// Translated from pro/cardgame (assembly, authority 2):
//   F0x8009F998 commitSelectedHandCard — take the marked hand card onto the
//     played stack, then close the gap it left in the hand
//   F0x8009FB18 markLegalFieldTargets — mark the legal board/hand slots for the
//     pending effect: a 10-arm jump table on the played card's filter class
//
// Source (assembly): exe-decomp/cardgame.norm.s
//   F0x8009f998 @.L0x0001cce8, F0x8009fb18 @.L0x0001ce68; its switch table
//   D0x800838e8 (ten arms, read from pro_cardgame.bin) and the arm bodies
//   F0x8009fbac/fc08/fc30/fc58/fc98/fcd8/fd0c/fd4c/fd84/fd88. The m2c body for
//   0x8009fb18 renders the ten arms as a switch with a shared `block_38`; the
//   jump table plus the arms were read from the binary to settle which arm is
//   which kind.
//
// What the player sees. When you confirm a Program or Digimon card in your hand
// (commitSelectedHandCard) the card you marked is copied onto the played stack
// with the side and hand index that produced it, the card's filter class is
// read from its record and stored beside it, and the hand closes up so the row
// no longer shows the gap. markLegalFieldTargets then lights the board: it
// clears all twelve slot marks and, from that filter class, marks each board or
// hand slot the pending effect may legally hit — the simple classes by side and
// by a colour/class byte, the rest by asking the board view (view+0xF40) which
// kind of card a slot holds. The lit slots are exactly the ones the cursor will
// accept as targets.
//
// The two helpers this family calls are host edges: F0x80083E34 is the card
// record field getter (its +0x03 field is the filter class 0..8 the switch
// reads) and view+0xF40 is a board-view method that classifies a slot. Both are
// shared services elsewhere, not this routine's own body.
//
// CITED in docs/research/card/CARD-DUEL-VERIFIED.md: the routine table's
// `commitSelectedHandCard` and `markLegalFieldTargets` rows, and the
// `0x800A4DF4`/F0x80083E34 note ("+0x03 the field-filter class 0..8 that
// F0x8009FB18 switches on").

export interface DuelEffectMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
}

/** The shared record helpers this family dispatches through. */
export interface DuelEffectHost {
    /**
     * F0x80083E34(cardEntry, selector, extra): one field of a card's 0x2C-stride
     * Program-effect record, addressed by the duel's own card-table entry.
     * selector 3 is the field-filter class the mark switch reads; selector 0
     * is the record's first byte (the targeting kind).
     */
    cardField(cardEntry: number, selector: number, extra: number): number;
    /** `view+0xF40(view, cardId)`: the board view's own slot classification. */
    queryTarget(view: number, cardId: number): number;
}

/** The twelve per-slot mark bytes, relative to `duel` (+0x46F..+0x47A). */
export const DUEL_HAND_MARK = 0x46f;
/** The played hand slot the marker stack record is keyed by (s8). */
export const DUEL_PLAYED_SLOT = 0x575;
/** The acting side byte (u8). */
export const DUEL_PLAYED_SIDE = 0x579;
/** The played-stack record base and stride (a hand slot's own 8-byte record). */
export const DUEL_PLAYED_STACK = 0x580;
export const DUEL_PLAYED_STRIDE = 8;
/** The played-stack record's fields, relative to `duel + slot*8 + 0x580`. */
export const DUEL_PLAYED = {
    /** The played card's id in the side's hand (u16). */
    id: 0x0,
    /** The side that played it (u8). */
    side: 0x4,
    /** The filter class the mark switch reads (u8). */
    kind: 0x5,
    /** The colour/class byte kind 0 compares a slot against (u8). */
    filter: 0x6,
} as const;
/** The duel's card-table entry array base (indexed by a hand card's id). */
export const DUEL_CARD_TABLE = 0x50;
/** A side's block stride; its hand lives at `+0x600` (stride 2) with count +0x5A6. */
const DUEL_SIDE_STRIDE = 0xc8;
export const DUEL_HAND_ARRAY = 0x600;
const DUEL_HAND_COUNT = 0x5a6;
/** A side's field row stride (`duel + side*0x72`) and per-slot record stride. */
const DUEL_ROW_STRIDE = 0x72;
const DUEL_SLOT_STRIDE = 0xe;
/** The row's card count, relative to `duel + side*0x72 + 0x72C`. */
const DUEL_ROW_COUNT = 0x72c;
/** The near row's per-slot record base (`row + 2`); the far row's (`+0x74C`). */
export const DUEL_NEAR_RECORD = 0x72e;
export const DUEL_FAR_RECORD = 0x74c;
/** The slot record field kind 0 compares (its colour/class byte). */
export const DUEL_SLOT_FILTER = 0xc;
/** The board/hand slot count the mark walk covers. */
export const DUEL_MARK_SLOTS = 0xc;
/** The hand slots the commit scan covers (the mark walk covers twelve). */
export const DUEL_HAND_MARK_SLOTS = 0xa;

/**
 * F0x8009F998(duel): take the first marked hand slot onto the played stack and
 * close the gap it left. The played stack record (`duel + slot*8 + 0x580`) gets
 * the actor's id and side from the hand array, the played card's filter class is
 * read from its record through the field getter and stored at +0x585, the hand
 * entries after the taken one shift down, and the hand count drops by one.
 */
export function commitSelectedHandCard(
    mem: DuelEffectMemory, host: DuelEffectHost, duel: number,
): number {
    let taken = 0;
    while (true) {
        if ((mem.read8(duel + DUEL_HAND_MARK + taken) & 0xff) !== 0) break;
        taken += 1;
        if (taken >= DUEL_HAND_MARK_SLOTS) break;
    }
    const side = mem.read8(duel + DUEL_PLAYED_SIDE) & 0xff;
    const playedSlot = mem.read8s(duel + DUEL_PLAYED_SLOT);
    const hand = duel + side * DUEL_SIDE_STRIDE;
    const cardId = mem.read16s(hand + DUEL_HAND_ARRAY + taken * 2);
    const entry = mem.read16s(duel + DUEL_CARD_TABLE + cardId * 2);
    const stack = duel + playedSlot * DUEL_PLAYED_STRIDE + DUEL_PLAYED_STACK;
    mem.write8(stack + DUEL_PLAYED.side, side);
    mem.write16(stack + DUEL_PLAYED.id, cardId & 0xffff);
    mem.write8(stack + DUEL_PLAYED.kind, host.cardField(entry, 3, 0) & 0xff);
    const count = mem.read16s(hand + DUEL_HAND_COUNT);
    for (let i = taken; i < count - 1; i++) {
        mem.write16(
            hand + DUEL_HAND_ARRAY + i * 2,
            mem.read16(hand + DUEL_HAND_ARRAY + (i + 1) * 2),
        );
    }
    mem.write16(hand + DUEL_HAND_COUNT, (count - 1) & 0xffff);
    // The original leaves the last card-field read (selector 0 = the record's
    // first byte) in v0: the mode-5/7 arm compares it against 0x83/0x84 to tell
    // a Program/Digimon commit. Return it so the caller can branch on it.
    return host.cardField(entry, 0, 0) | 0;
}

/**
 * F0x8009FB18(duel, view): mark the board/hand slots the pending effect may
 * legally hit. Clears all twelve mark bytes, then for each slot dispatches on
 * the played card's filter class (duel + playedSlot*8 + 0x585):
 *   0  a slot on the acting side whose colour/class byte (+0xC) equals the
 *      played card's own filter byte (+0x586)
 *   1  every slot on that side (the far row)
 *   2  every occupied slot on the near row
 *   3  every slot, unconditionally
 *   4/5/7  every slot the board view does NOT classify as 1 / 2 / 4
 *   6/8  every slot the board view classifies as 3 / 6
 *   9  nothing
 * A class outside 0..9 marks nothing.
 */
export function markLegalFieldTargets(
    mem: DuelEffectMemory, host: DuelEffectHost, duel: number, view: number,
): void {
    const playedSlot = mem.read8s(duel + DUEL_PLAYED_SLOT);
    const kind = mem.read8(duel + playedSlot * DUEL_PLAYED_STRIDE + DUEL_PLAYED_STACK + DUEL_PLAYED.kind) & 0xff;
    const filter = mem.read8(duel + playedSlot * DUEL_PLAYED_STRIDE + DUEL_PLAYED_STACK + DUEL_PLAYED.filter) & 0xff;
    for (let slot = 0; slot < DUEL_MARK_SLOTS; slot++) {
        mem.write8(duel + DUEL_HAND_MARK + slot, 0);
        const near = slot < 6;
        const rec = duel + slot * DUEL_SLOT_STRIDE + (near ? DUEL_NEAR_RECORD : DUEL_FAR_RECORD);
        let mark = false;
        if (kind === 0) {
            const count = near
                ? mem.read8(duel + DUEL_ROW_COUNT) & 0xff
                : mem.read8(duel + DUEL_ROW_COUNT + DUEL_ROW_STRIDE) & 0xff;
            const index = near ? slot : slot - 6;
            if (index < count) mark = (mem.read8(rec + DUEL_SLOT_FILTER) & 0xff) === filter;
        } else if (kind === 1) {
            if (!near && (slot - 6) < (mem.read8(duel + DUEL_ROW_COUNT + DUEL_ROW_STRIDE) & 0xff)) mark = true;
        } else if (kind === 2) {
            if (near && slot < (mem.read8(duel + DUEL_ROW_COUNT) & 0xff)) mark = true;
        } else if (kind === 3) {
            mark = true;
        } else if (kind >= 4 && kind <= 8) {
            mark = dispatchViewKind(host, view, kind, mem.read16s(rec));
        }
        if (mark) mem.write8(duel + DUEL_HAND_MARK + slot, 1);
    }
}

/** The view-query arms (classes 4..8) decide by the view's own classification. */
function dispatchViewKind(host: DuelEffectHost, view: number, kind: number, cardId: number): boolean {
    const result = host.queryTarget(view, cardId) | 0;
    if (kind === 4) return result !== 1;
    if (kind === 5) return result !== 2;
    if (kind === 6) return result === 3;
    if (kind === 7) return result !== 4;
    return result === 6; // kind 8
}
