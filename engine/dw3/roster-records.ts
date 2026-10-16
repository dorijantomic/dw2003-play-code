// Where a roster slot's 0x3DC-byte record lives in a screen's memory.
//
// The disc keeps eight records at 0x80049494 (stride 0x3DC), ending at the party
// context's tail (0x80049494 + 8*0x3DC = 0x8004B374, the starter-pack word), so the
// slots after them (the new partners, engine/dw3/roster.ts) cannot follow the array.
// Their records live in their own window of every screen's memory, beside the extra
// species' profile records (0x801F4000, ui/native/pause-status.ts), with the same layout.
// No imports: party-context.ts, form-ledger.ts and effective-stats.ts all use this.

export const ROSTER_RECORDS = 0x80049494;
export const ROSTER_STRIDE = 0x3dc;
export const EXTRA_ROSTER_RECORDS = 0x801f8000;
/** The disc's eight slots; slots 8..15 use EXTRA_ROSTER_RECORDS. */
const DISC_RECORDS = 8;
const MAX_RECORDS = 16;

/** One roster slot's record. Every reader that held `ROSTER_RECORDS + slot * ROSTER_STRIDE` uses this. */
export function rosterRecordAddress(slot: number): number {
    const s = slot | 0;
    // anything that is not a new partner's slot keeps the original's arithmetic, wrap and all
    if (s < DISC_RECORDS || s >= MAX_RECORDS) return (ROSTER_RECORDS + Math.imul(s, ROSTER_STRIDE)) >>> 0;
    return (EXTRA_ROSTER_RECORDS + (s - DISC_RECORDS) * ROSTER_STRIDE) >>> 0;
}

/**
 * The original's other spelling of the same record: `PARTY_CONTEXT + slot*0x3DC`, which
 * the decoded screens add their 0x760.. field offsets to. For a disc slot it is exactly
 * that; for a new partner it is the extra record less 0x760, so `+0x760` lands on it.
 */
export function rosterContextBase(slot: number): number {
    return (rosterRecordAddress(slot) - 0x760) >>> 0;
}
