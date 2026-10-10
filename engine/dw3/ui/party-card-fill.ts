// The pause menu's party-card row fill, translated from pro/ststatus
// F0x8008ED04 (party_card_fill_items).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/party-card-fill-oracle.test.js runs the original through
// engine/native on the shipped pro_ststatus.bin + resident.bin with the card
// services and every widget method stubbed, and compares the ordered calls.
//
// DECODED: authority-2 `exe-decomp/ststatus_c/_asm/F0x8008ed04.s`, with the
// label-loop count corrected from the m2c C by the accepted
// lane-b-hosted-bodies-contract answer (U1). The m2c C renders the label loop
// as a 4-iteration do-while because it moves the increment before the test; the
// assembly keeps `addiu $s2, 0x1` in the branch delay slot, so the test sees the
// pre-increment counter and the loop runs FIVE times, string ids 1,2,4,3,4.
//
// The function's real parameters are $a1 = the row block, $a2 = the row index
// and $a3 = the show flag; $a0 is never read. Each row is a 0x2C-byte struct of
// widget pointers:
//   +0x04 name, +0x08/+0x0C/+0x10/+0x14/+0x18 five labels,
//   +0x1C/+0x20/+0x24/+0x28/+0x2C five number fields.
// Show fills them (name from the member record, labels from the string table the
// holder 0x8009AF6C points at, numbers from the 0x2734 stat copy indexed by the
// table at 0x8009A8A4); hide switches all eleven widgets off. The card services
// ([0x80048D34]+0x2718/+0x2734/+0x2750), the text resolver and the four widget
// methods (+0x114/+0x118/+0x144/+0x148, already translated in the
// text-widget-*.ts family) are host boundaries here.

export interface PartyCardFillMemory {
    read32(addr: number): number;
    read16s(addr: number): number;
}

export interface PartyCardFillHost {
    /** [0x80048D34+0x2718](row): party row -> roster slot. */
    rosterSlot(row: number): number;
    /** [0x80048D34+0x2734](slot, dest): copy the member's 0x2C-byte projection. */
    copyStats(slot: number, dest: number): void;
    /** [0x80048D34+0x2750](slot): the member record base. */
    cardRecord(slot: number): number;
    /** [0x80044B38+0x414] = F0x80013E5C(languageIndex + offset). */
    resolveText(offset: number): number;
    /** Widget +0x114 (F0x800194E8): install line 0 from a source/index. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** Widget +0x118 (F0x800195B0): render a number on a line. */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, value: number): void;
    /** Widget +0x148 (F0x8001A25C): measure and store the width. */
    widgetMeasure(widget: number, value: number): void;
}

/** The per-row struct stride. */
export const PARTY_CARD_ROW_STRIDE = 0x2c;
/** The row widget slots the fill touches. */
export const PARTY_CARD_NAME_SLOT = 0x04;
export const PARTY_CARD_LABEL_SLOT = 0x08;
export const PARTY_CARD_NUMBER_SLOT = 0x1c;
/** Five labels and five numbers per row (the corrected loop count). */
export const PARTY_CARD_FIELDS = 5;
/** The holder whose value is the label-record table (records start at +0xC). */
export const PARTY_CARD_LABEL_HOLDER = 0x8009af6c;
export const PARTY_CARD_LABEL_FIRST = 0x0c;
export const PARTY_CARD_LABEL_STRIDE = 0x0c;
/** The stat-index table the number loop reads. */
export const PARTY_CARD_STAT_INDEX_TABLE = 0x8009a8a4;
/** The text bank offset for the labels, in the shared language object. */
export const PARTY_CARD_TEXT_OFFSET = 0xb0;

/**
 * F0x8008ED04(rows, row, show, stats): fill or clear one party-card row of the
 * pause menu. `stats` is the caller's scratch buffer (the original's sp+0x10)
 * that the +0x2734 stat copy writes and the number loop reads.
 */
export function partyCardFillItems(
    mem: PartyCardFillMemory,
    rows: number,
    row: number,
    show: number,
    stats: number,
    host: PartyCardFillHost,
): void {
    const base = (rows + Math.imul(row, PARTY_CARD_ROW_STRIDE)) | 0;
    const w = (off: number): number => mem.read32(base + off) >>> 0;
    if (show !== 0) {
        const slot = host.rosterSlot(row) | 0;
        host.copyStats(slot, stats);
        const record = host.cardRecord(slot) >>> 0;
        host.widgetSetLine0(w(PARTY_CARD_NAME_SLOT), record, -1);
        const table = mem.read32(PARTY_CARD_LABEL_HOLDER) >>> 0;
        for (let i = 0; i < PARTY_CARD_FIELDS; i++) {
            // The original re-resolves the bank inside the loop, before it reads
            // the record's string id.
            const text = host.resolveText(PARTY_CARD_TEXT_OFFSET);
            const id = mem.read32(
                (table + PARTY_CARD_LABEL_FIRST + Math.imul(i, PARTY_CARD_LABEL_STRIDE)) >>> 0,
            ) | 0;
            host.widgetSetLine0(w(PARTY_CARD_LABEL_SLOT + Math.imul(i, 4)), text, id);
        }
        for (let i = 0; i < PARTY_CARD_FIELDS; i++) {
            const statId = mem.read32((PARTY_CARD_STAT_INDEX_TABLE + Math.imul(i, 4)) >>> 0) | 0;
            const off = PARTY_CARD_NUMBER_SLOT + Math.imul(i, 4);
            host.widgetSetLineNumber(w(off), 0, mem.read16s((stats + Math.imul(statId, 2)) | 0));
            // The original re-reads the widget pointer for the measure call.
            host.widgetMeasure(w(off), 1);
        }
        return;
    }
    host.widgetSetFlagC1(w(PARTY_CARD_NAME_SLOT), 0);
    for (let i = 0; i < PARTY_CARD_FIELDS; i++) {
        host.widgetSetFlagC1(w(PARTY_CARD_LABEL_SLOT + Math.imul(i, 4)), 0);
    }
    for (let i = 0; i < PARTY_CARD_FIELDS; i++) {
        host.widgetSetFlagC1(w(PARTY_CARD_NUMBER_SLOT + Math.imul(i, 4)), 0);
    }
}
