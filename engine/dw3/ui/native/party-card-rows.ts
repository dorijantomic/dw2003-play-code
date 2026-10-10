// The party-card row fill every pause page shares, translated from the original
// pro/ststatus bodies. The ITEMS page's copy (F0x8008ED04) is the earlier port
// (engine/dw3/ui/party-card-fill.ts); the other pages carry the same body with a
// different stat-index table, and the card-folder and demo pages a row block
// whose widget slots sit four bytes lower.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/party-card-rows.test.js runs each original through engine/native.
//
//   F0x80094144 techniques   F0x80096744 sort   F0x8008B944 status
//   F0x80083914 card folders F0x8008519C demo setup
//
// Row block: 0x2C bytes a party member; the name widget, five label widgets and
// five number widgets. Show fills them (name from the member record, labels from
// the layout holder at 0x8009AF6C, numbers from the effective-stat copy indexed
// by the page's table); hide switches all eleven off.
import type { PartyCardFillHost, PartyCardFillMemory } from "../party-card-fill.ts";
import { PARTY_CARD_LABEL_FIRST, PARTY_CARD_LABEL_HOLDER, PARTY_CARD_LABEL_STRIDE, PARTY_CARD_ROW_STRIDE,
    PARTY_CARD_TEXT_OFFSET } from "../party-card-fill.ts";

export interface PartyCardRowLayout {
    /** The page's stat-index table (five words). */
    statTable: number;
    nameSlot: number;
    labelSlot: number;
    numberSlot: number;
}

export const ROWS_TECHNIQUES: PartyCardRowLayout = { statTable: 0x8009a93c, nameSlot: 4, labelSlot: 8, numberSlot: 0x1c };
export const ROWS_SORT: PartyCardRowLayout = { statTable: 0x8009a964, nameSlot: 4, labelSlot: 8, numberSlot: 0x1c };
export const ROWS_STATUS: PartyCardRowLayout = { statTable: 0x8009a830, nameSlot: 4, labelSlot: 8, numberSlot: 0x1c };
export const ROWS_CARD_FOLDERS: PartyCardRowLayout = { statTable: 0x8009a784, nameSlot: 0, labelSlot: 4, numberSlot: 0x18 };

const FIELDS = 5;

/** The shared body: fill or hide one row of a page's card block. */
export function partyCardRows(
    mem: PartyCardFillMemory, rows: number, row: number, show: number, stats: number,
    layout: PartyCardRowLayout, host: PartyCardFillHost,
): void {
    const base = (rows + Math.imul(row, PARTY_CARD_ROW_STRIDE)) | 0;
    const w = (off: number): number => mem.read32(base + off) >>> 0;
    if (show !== 0) {
        const slot = host.rosterSlot(row) | 0;
        host.copyStats(slot, stats);
        const record = host.cardRecord(slot) >>> 0;
        host.widgetSetLine0(w(layout.nameSlot), record, -1);
        const table = mem.read32(PARTY_CARD_LABEL_HOLDER) >>> 0;
        for (let i = 0; i < FIELDS; i++) {
            const text = host.resolveText(PARTY_CARD_TEXT_OFFSET);
            const id = mem.read32((table + PARTY_CARD_LABEL_FIRST + Math.imul(i, PARTY_CARD_LABEL_STRIDE)) >>> 0) | 0;
            host.widgetSetLine0(w(layout.labelSlot + Math.imul(i, 4)), text, id);
        }
        for (let i = 0; i < FIELDS; i++) {
            const statId = mem.read32((layout.statTable + Math.imul(i, 4)) >>> 0) | 0;
            const off = layout.numberSlot + Math.imul(i, 4);
            host.widgetSetLineNumber(w(off), 0, mem.read16s((stats + Math.imul(statId, 2)) | 0));
            host.widgetMeasure(w(off), 1);
        }
        return;
    }
    host.widgetSetFlagC1(w(layout.nameSlot), 0);
    for (let i = 0; i < FIELDS; i++) host.widgetSetFlagC1(w(layout.labelSlot + Math.imul(i, 4)), 0);
    for (let i = 0; i < FIELDS; i++) host.widgetSetFlagC1(w(layout.numberSlot + Math.imul(i, 4)), 0);
}
