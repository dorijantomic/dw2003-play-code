// The duel's opponent-deck loader, translated from pro/cardgame:
//   F0x8009D6E0 loadOpponentDeck — copy the AI class's deck record into the duel
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/opponent-deck-oracle.test.js runs the original through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s @.L0x0001aa30; the
// jump table at 0x800837A0 (its seventh slot, 0x8009D7E4, is the arm the
// corrected root executes) and the halfword id table at 0x800A5C2C.
//
// Frame the function: the AI class byte `duel+0x2E8` selects a 0xD0-byte record
// inside the CARD_NPC pack (F0x80013E5C(0x7A4), whose base is stored at
// duel+0x2F0) at `base + 0xD0*(class-1)` - the listing's shorthand hid that the
// last shift targets the value register, so the class stride is 0xD0 and class 1
// sits at the pack base (the oracle caught this: class 1 -> base+0, class 2 ->
// base+0xD0, class 0 -> base-0xD0). The loader then, in order:
//   duel+0x2E9 = record+0xC8 (a byte)
//   duel+0x2EC = s16 idTable[[record+0xCC] * 2]  (the save-block index the
//                 scene handler's outcome step later increments)
//   for i in 0..39, from the record's i-th four-byte entry:
//     duel+0x30A + 2i = i
//     duel+0x30B + 2i = entry+2 (a byte)
//     duel+0x35C + 4i = entry+3 (the type byte that picks the arm below)
//     duel+0x35D + 4i = (s16 entry+0) >>> 15  (the entry's sign bit)
//     duel+0x35E + 4i = i + typeOffset[type] for type 1..7, left untouched
//                       otherwise (the arm is a jump table, not a value table)
//   phase 1 over the record's halfword area at +0xA0: while the halfword is
//     non-zero, write (its low byte - 1) at duel+0x400+i, stepping two bytes and
//     one slot, up to 27 slots; if it stops on a zero halfword, write the
//     fifteen-byte terminator table at duel+0x400+i, else stop there
//   phase 2: for i in 0..39, duel+0x248 + 2i = (u16 entry+0 & 0xFFF) - 1
// Existing contract reused: `cardduel-pack-is-carddata-bin` names the pack and
// `cardgame-bank-loader-table-ids-2026-09-16` the 0x7A4 request.

export interface OpponentDeckMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface OpponentDeckHost {
    /** F0x80013E5C(discId) via [0x80044F4C]: the pack's RAM base. */
    resourceGetBase(discId: number): number;
}

/** The pack the deck records live in. */
export const OPPONENT_DECK_PACK_ID = 0x7a4;
/** The record area's geometry: a 0xD0 stride, with class 1 at the pack base. */
export const OPPONENT_DECK_STRIDE = 0xd0;
export const OPPONENT_DECK_BIAS = 0xd0;
/** Duel fields the loader fills. */
export const OPPONENT_DECK_FIELDS = {
    packBase: 0x2f0,
    /** The class record's +0xC8 byte. */
    byte2e9: 0x2e9,
    /** The save-block index from the id table. */
    saveIndex: 0x2ec,
    /** The 40-entry index pairs. */
    indexBase: 0x30a,
    /** The 40-entry (type, sign, value) triples and their leading type byte. */
    typeBase: 0x35c,
    /** The 40 halfword card codes. */
    codeBase: 0x248,
    /** The phase-1 slot array. */
    slotBase: 0x400,
} as const;
/** Offsets inside a record. */
export const OPPONENT_DECK_RECORD = {
    code: 0x0,
    byte2: 0x2,
    type: 0x3,
    tail: 0xa0,
    byteC8: 0xc8,
    indexCC: 0xcc,
} as const;
/** The arm's per-class added value, indexed by the record's type byte. */
export const OPPONENT_DECK_TYPE_OFFSET: readonly number[] = [
    0, 0x190, 0x12c, 0x1f4, 0xc8, 0x258, 0x64, 0x2bc,
];
/** The jump table the arms come from (0x800837A0 slots 1..7). */
export const OPPONENT_DECK_ARM_TABLE = 0x800837a0;
export const OPPONENT_DECK_ARM_ADDRESSES: readonly number[] = [
    0x8009d7b4, 0x8009d7bc, 0x8009d7c4, 0x8009d7cc, 0x8009d7d4, 0x8009d7dc, 0x8009d7e4,
];
/** The 40-entry card-code id table. */
export const OPPONENT_DECK_ID_TABLE = 0x800a5c2c;
/** The phase-1 slot cap and its fifteen-byte terminator table. */
export const OPPONENT_DECK_SLOT_LIMIT = 0x1b;
export const OPPONENT_DECK_SLOT_TABLE: readonly number[] = [
    7, 8, 0x18, 0x1f, 0x20, 0, 6, 0xc, 0x12, 0x1b, 0x1e, 0x21, 0x25, 0x26, 0xff,
];
/** The 40-entry count both loops use. */
export const OPPONENT_DECK_ENTRIES = 0x28;

/**
 * F0x8009D6E0(duel): load the AI class's deck record into the duel object. The
 * class byte is read from duel+0x2E8 (the scene constructor's selector).
 */
export function loadOpponentDeck(mem: OpponentDeckMemory, host: OpponentDeckHost, duel: number): void {
    const pack = host.resourceGetBase(OPPONENT_DECK_PACK_ID) | 0;
    mem.write32(duel + OPPONENT_DECK_FIELDS.packBase, pack);
    const cls = mem.read8(duel + 0x2e8) & 0xff;
    const record = (pack + cls * OPPONENT_DECK_STRIDE - OPPONENT_DECK_BIAS) | 0;

    mem.write8(duel + OPPONENT_DECK_FIELDS.byte2e9, mem.read8(record + OPPONENT_DECK_RECORD.byteC8) & 0xff);
    const idIndex = mem.read32(record + OPPONENT_DECK_RECORD.indexCC) | 0;
    mem.write32(duel + OPPONENT_DECK_FIELDS.saveIndex, mem.read16(OPPONENT_DECK_ID_TABLE + idIndex * 2) << 16 >> 16);
    mem.write8(duel + 0x30a, 0);

    for (let i = 0; i < OPPONENT_DECK_ENTRIES; i++) {
        const entry = (record + i * 4) | 0;
        mem.write8(duel + OPPONENT_DECK_FIELDS.indexBase + i * 2, i);
        mem.write8(duel + OPPONENT_DECK_FIELDS.indexBase + i * 2 + 1, mem.read8(entry + OPPONENT_DECK_RECORD.byte2) & 0xff);
        const type = mem.read8(entry + OPPONENT_DECK_RECORD.type) & 0xff;
        mem.write8(duel + OPPONENT_DECK_FIELDS.typeBase + i * 4, type);
        mem.write8(duel + OPPONENT_DECK_FIELDS.typeBase + i * 4 + 1,
            ((mem.read16(entry + OPPONENT_DECK_RECORD.code) << 16) >> 31) & 1);
        if (type >= 1 && type <= 7) {
            mem.write16(duel + OPPONENT_DECK_FIELDS.typeBase + i * 4 + 2,
                (i + (OPPONENT_DECK_TYPE_OFFSET[type] ?? 0)) & 0xffff);
        }
    }

    // phase 1: the record's halfword area, two bytes and one slot per step
    let slot = 0;
    let tail = (record + OPPONENT_DECK_RECORD.tail) | 0;
    for (;;) {
        if (((mem.read16(tail) << 16) >> 16) === 0) {
            for (let k = 0; k < OPPONENT_DECK_SLOT_TABLE.length; k++) {
                mem.write8(duel + OPPONENT_DECK_FIELDS.slotBase + slot + k, OPPONENT_DECK_SLOT_TABLE[k] ?? 0);
            }
            break;
        }
        mem.write8(duel + OPPONENT_DECK_FIELDS.slotBase + slot, (mem.read8(tail) - 1) & 0xff);
        tail = (tail + 2) | 0;
        slot += 1;
        if (slot >= OPPONENT_DECK_SLOT_LIMIT) break;
    }

    // phase 2: the 40 card codes
    for (let i = 0; i < OPPONENT_DECK_ENTRIES; i++) {
        const code = (mem.read16(record + i * 4) & 0xfff) - 1;
        mem.write16(duel + OPPONENT_DECK_FIELDS.codeBase + i * 2, code & 0xffff);
    }
}
