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
import { s16 } from "../../gte-math.ts";

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

/** The row pitch every pause page draws its three rows at. */
export const PARTY_CARD_ROW_PITCH = 0x2e;

export interface PartyCardGridMemory {
    read16(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PartyCardGridHost {
    createText(layer: number, kind: number, x: number, y: number): number;
}

/**
 * The row loop the page constructors run before their own widgets: three rows of
 * a name, five labels and five numbers, each row a pitch lower. `slotBase` is the
 * name slot, read from the page's layout table.
 */
export function partyCardWidgetGrid(
    mem: PartyCardGridMemory, ui: number, layer: () => number, layout: () => number,
    slotBase: number, host: PartyCardGridHost,
): void {
    for (let row = 0; row < 3; row++) {
        const yoff = row * PARTY_CARD_ROW_PITCH;
        const base = row * PARTY_CARD_ROW_STRIDE;
        const l = layout();
        mem.write32(ui + base + slotBase,
            host.createText(layer(), 1, s16(mem.read16(l + 4)), s16(mem.read16(l + 8) + yoff)));
        for (let i = 0; i < FIELDS; i++) {
            const e = layout() + 0x14 + i * 0xc;
            mem.write32(ui + base + slotBase + 4 + i * 4,
                host.createText(layer(), 3, s16(mem.read16(e - 4)), s16(mem.read16(e) + yoff)));
        }
        for (let i = 0; i < FIELDS; i++) {
            const e = layout() + 0x50 + i * 0xc;
            mem.write32(ui + base + slotBase + 0x18 + i * 4,
                host.createText(layer(), 3, s16(mem.read16(e - 4)), s16(mem.read16(e) + yoff)));
        }
    }
}

export interface PartyCardFoldMemory {
    read32(addr: number): number;
}

export interface PartyCardFoldHost {
    draw8C(a: number, b: number, c: number): void;
    draw94(x: number, y: number): void;
    drawSprite(pack: number, sprite: number, arg: number, y: number): void;
    packHandle(id: number): number;
}

/**
 * The card-and-fold loop of the page draws: each member's fold curve, its three
 * sprites and the 0x17 bar, one pitch lower each row. `foldBase` is the page
 * object plus the offset of member 0's fold word (0x19c techniques, 0x90 status,
 * 0x7c card folders).
 */
export function partyCardFoldRows(
    mem: PartyCardFoldMemory, size: number, foldBase: number, host: PartyCardFoldHost,
): void {
    const foldAt = (i: number): number => mem.read32(foldBase + Math.imul(i, 0x10)) | 0;
    let a = 0x13;
    let b = 0x11;
    let c = 0x27;
    let d = 0x25;
    for (let i = 0; i < size; i++) {
        const fold = foldAt(i);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, 0x1000, 0x1000);
                host.draw94(0, d);
                host.drawSprite(host.packHandle(0x02860000), 0x15, 0, b);
                host.draw8C(foldAt(i), foldAt(i), 0x1000);
                host.draw94(0x7c, c);
                host.drawSprite(host.packHandle(0x02860000), 0x16, 0x67, a);
                host.draw8C(foldAt(i), 0x1000, 0x1000);
                host.draw94(0, d);
            } else {
                host.draw8C(0x1000, 0x1000, 0x1000);
                host.drawSprite(host.packHandle(0x02860000), 0x15, 0, b);
                host.drawSprite(host.packHandle(0x02860000), 0x16, 0x67, a);
            }
            host.drawSprite(host.packHandle(0x02860000), 0x17, 0, b);
        }
        a += PARTY_CARD_ROW_PITCH;
        b += PARTY_CARD_ROW_PITCH;
        c += PARTY_CARD_ROW_PITCH;
        d += PARTY_CARD_ROW_PITCH;
    }
}
