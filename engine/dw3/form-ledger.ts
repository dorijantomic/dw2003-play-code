// The equipped-form ledger (the status screen's form triple), translated from
// the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/form-ledger-oracle.test.js runs both original addresses through
// engine/native over the same seeded save context and compares the emitted
// buffer and the returned count.
//
// DECODED: the accepted `stats-save-loaders-contract` answer (researcher A) and
// `~/ddw3/asm/dw2003/exe/fns.s` L8055-L8125. The save context is D0x80048D34;
// each roster slot is 0x3DC bytes. A slot's three equipped form ids sit at
// +0x7B0 (three s16), and the form ledger is 0x2C entries of 0x14 bytes from
// +0x7B8, each entry's own id at its +0x00. Entries with an id below 3 are
// empty; the matcher returns the entry index or -1.

export interface FormLedgerMemory {
    read16(addr: number): number;
    write16(addr: number, value: number): void;
}

/** The save context base (DIGIMON_CUR_STATS). */
export const SAVE_CONTEXT = 0x80048d34;
/** One roster slot. */
export const ROSTER_SLOT_STRIDE = 0x3dc;
/** The three equipped form ids, s16 each. */
export const EQUIPPED_FORM_BASE = 0x7b0;
export const EQUIPPED_FORM_COUNT = 3;
/** The form ledger's first entry and its stride/count. */
export const FORM_ENTRY_BASE = 0x7b8;
export const FORM_ENTRY_STRIDE = 0x14;
export const FORM_ENTRY_COUNT = 0x2c;
/** Entries whose id is below this are empty. */
export const FORM_MIN_ID = 3;

/** Sign-extend a 16-bit value. Exported for the sibling stat modules. */
export const s16 = (v: number): number => (v << 16) >> 16;

/**
 * F0x8001764C(slot, form): the ledger index whose entry id equals `form`, or -1.
 * Entries with an id below 3 are skipped without a comparison.
 */
export function findFormLedgerIndex(mem: FormLedgerMemory, slot: number, form: number): number {
    const base = (SAVE_CONTEXT + (slot | 0) * ROSTER_SLOT_STRIDE) >>> 0;
    const want = form | 0;
    for (let i = 0; i < FORM_ENTRY_COUNT; i++) {
        const id = s16(mem.read16(base + FORM_ENTRY_BASE + i * FORM_ENTRY_STRIDE));
        if (id < FORM_MIN_ID) continue;
        if (id === want) return i;
    }
    return -1;
}

/**
 * F0x800176AC(slot, out): validate a slot's three equipped forms. A form below 3
 * is skipped, one that does not resolve to a ledger entry with an id of at least
 * 3 is skipped, and every accepted entry's own (unsigned) id is emitted into the
 * caller's buffer in order. Unused slots are padded with 0xFFFF. Returns the
 * number of accepted forms.
 */
export function validateEquippedForm(mem: FormLedgerMemory, slot: number, out: number): number {
    const base = (SAVE_CONTEXT + (slot | 0) * ROSTER_SLOT_STRIDE) >>> 0;
    let count = 0;
    for (let i = 0; i < EQUIPPED_FORM_COUNT; i++) {
        const form = s16(mem.read16(base + EQUIPPED_FORM_BASE + i * 2));
        if (form < FORM_MIN_ID) continue;
        const index = findFormLedgerIndex(mem, slot, form);
        if (index < 0) continue;
        const entry = (base + FORM_ENTRY_BASE + index * FORM_ENTRY_STRIDE) >>> 0;
        if (s16(mem.read16(entry)) < FORM_MIN_ID) continue;
        mem.write16(out + count * 2, mem.read16(entry));
        count++;
    }
    for (let k = count; k < EQUIPPED_FORM_COUNT; k++) mem.write16(out + k * 2, 0xffff);
    return count;
}
