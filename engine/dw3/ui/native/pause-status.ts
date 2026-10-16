// The STATUS pause page (one partner's card, forms, equipment and stats), translated
// from the original pro/ststatus bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-status.test.js runs each original through engine/native.
//
//   F0x8008E8F8 statusFactory     build the page object (0x14C bytes, 0x110 extra).
//   F0x8008E744 statusRoot        count the party, open the card folds, build, tick, draw.
//   F0x8008B520 statusCtor        the card rows, prompt lines, cursor and stat widgets.
//   F0x8008BB88 statusHeaderFill  the selected partner's name and five headline stats.
//   F0x8008BD70 statusPromptFill  the two prompt lines.
//   F0x8008BE34 statusFormsFill   the three form names and the current-form mark.
//   F0x8008C02C statusEquipFill   the six equipment names.
//   F0x8008C1C0 statusStatsFill   the thirteen stat numbers and the TP pair.
//   F0x8008C460 statusEquipPreview try an equipment change and show the stat deltas.
//   F0x8008C954 statusDraw        cards, portraits, panels and the cursor.
//   F0x8008D684 statusDetailTick  the partner's detail view (forms/equipment choice).
//   F0x8008DDB0 statusTick        open, pick a partner, hand over to a child, close.
//
// Object fields: +0x10 page sub-state; +0x14 detail sub-state; +0x18 detail returned
// flag; +0x24 widget block; +0x5C party size; +0x60.. portrait frames; +0x6C portrait
// timer; +0x74 detail choice (0 forms, 1 equipment); +0x78 pick cursor showing; +0x7C
// chosen partner; +0x80/+0x84 pick cursor frame and timer; +0x88.. card folds (0x10
// bytes each, the scale at +8); +0x148 the equipment preview method.
// Widget block: +0 header; +4 three 0x2C card rows; +0x88/+0x8C the pick prompts;
// +0x90 two prompt lines; +0x98 the detail cursor; +0x9C/+0xA0 the detail labels;
// +0xA4/+0xA8 forms; +0xB4/+0xB8 equipment; +0xD0.. thirteen stats; +0x104 the
// TP value and +0x108 its "TP" label (esstatus 0x4E; the value is the record's
// own TP halfword at +0x26, block+2); +0x10C the child page object.
import { isDiscRosterSlot, rosterSlotDigimonId } from "../../roster.ts";
import { PAUSE_CTX, PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { partyPositionToRosterSlot, rosterContextBase } from "../../party-context.ts";
import { itemIconClip, itemRecord } from "../../item-record.ts";
import { partyCardRows, ROWS_STATUS } from "./party-card-rows.ts";
import { advanceDigimonPictures, digimonPictureAt, DIGIMON_PICTURE_ROW_WORDS } from "../digimon-picture.ts";
import { fillStatPanel, greyStatPanel } from "../stat-panel.ts";
import type { PartyCardFillHost } from "../party-card-fill.ts";

export const STATUS_HANDLER = 0x8008e744;
export const STATUS_SIZE = 0x14c;
export const STATUS_EXTRA = 0x110;
export const STATUS_PREVIEW_METHOD = 0x8008c460;
const LAYOUT = 0x8009af6c;
const FRAMES = 0x8009af68;
const HEAD_STATS = 0x8009a830;
const LEFT_STATS = 0x8009a844;
const RIGHT_STATS = 0x8009a85c;
const EQUIP_EMPTY = 0x8009a878;
/**
 * The Digimon profile table, the one disc table every screen that shows a Digimon
 * reads. It lives in the resident executable image, so it is cut out of it once
 * (assets/data/digimon_profiles.bin) and every screen loads that one file
 * (web/resident-data.js `loadProfileRecords`). Its address and stride are here so
 * there is one copy of the geometry rather than one per screen.
 */
export const PROFILE_TABLE_BASE = 0x8003ef5c;
export const PROFILE_STRIDE = 0x58;
/**
 * The table holds 55 records: 0x8003EF5C + 55*0x58 = 0x80040244, where the shop's
 * descriptor table starts (engine/dw3/ui/shop-catalog.ts:40). The walker's own id
 * bridge below (`profileRowFormId`, `gameFormId`, `walkerIdOf`) walks all 55,
 * because it is a walker convenience with no original counterpart.
 */
const PROFILE_COUNT = 0x37;
/**
 * The ORIGINAL's lookup does not walk all 55. F0x800134E8 ([0x8005CCA0], the
 * species getter every screen calls; the cell's word in the resident image is
 * 0x800134E8) asks f1 (0x800134AC) for the row, and f1 stops at
 * `slti cur_idx, 0x34` (exe/f1.s:26): rows 0..51 only. So the last three rows
 * (form ids 468, 469, 470: Agunimon, BladeGarurumon, AncientGreymon) answer -1,
 * f0 answers 0, and every screen that `beqz`-guards the getter leaves the name
 * blank. .bunny-scratch/rowlimit-report.md lists every caller.
 */
export const PROFILE_SCAN_ROWS = 0x34;

/**
 * Species the disc only ever used as enemies, made available as player forms
 * (tools/build_extra_species.py -> assets/data/extra_profiles.bin). They are NOT in the
 * 55-row table, which the translated screens address by literal constants and which the
 * shop's descriptor table follows. Each is a 0x58-byte record of the same layout, held
 * in its own window of every screen's memory, and the species getter answers its address
 * exactly as it answers a base row's. The walker numbers them 56.., each row's first
 * halfword is the game form id (the species' model number, unique across both tables),
 * and byte +0x55 is the species' entry in the disc's own name bank 0x4E, which already
 * names every enemy. Nothing is registered unless the page loads the extra data, so every
 * screen without it behaves exactly as before.
 */
export const EXTRA_PROFILE_BASE = 0x801f4000;
export const EXTRA_FIRST_ID = PROFILE_COUNT + 1;
let extraRows: Uint8Array | null = null;
const extraInstalled = new WeakSet<object>();

/** Register the extra species' profile records (a multiple of 0x58 bytes), or clear them with null. */
export function registerExtraProfiles(bytes: Uint8Array | null): void {
    if (bytes && (bytes.length === 0 || bytes.length % 0x58 !== 0)) throw new Error("Invalid extra profile table");
    extraRows = bytes && bytes.length ? bytes : null;
}

/** How many extra species are registered. */
export function extraProfileCount(): number {
    return extraRows ? extraRows.length / 0x58 : 0;
}

/** The 0x58-byte profile record of the extra species with walker id `id` (56..), or null. */
export function extraProfileRow(id: number): Uint8Array | null {
    const row = (Number(id) | 0) - EXTRA_FIRST_ID;
    if (!extraRows || row < 0 || row >= extraRows.length / 0x58) return null;
    return extraRows.subarray(row * 0x58, (row + 1) * 0x58);
}

/** The game form id (value0) of extra species row `row` (0-based), or 0. */
export function extraRowFormId(row: number): number {
    if (!extraRows || !Number.isInteger(row) || row < 0 || row >= extraRows.length / 0x58) return 0;
    return (extraRows[row * 0x58]! | (extraRows[row * 0x58 + 1]! << 8)) & 0xffff;
}

/** Put the extra rows into this screen's memory once, wherever the screen reads species records from. */
function installExtraProfiles(mem: object): void {
    if (!extraRows || extraInstalled.has(mem)) return;
    const m = mem as { load?: (data: Uint8Array, at: number) => void; write8?: (a: number, v: number) => void };
    if (typeof m.load === "function") m.load(extraRows, EXTRA_PROFILE_BASE);
    else for (let i = 0; i < extraRows.length; i++) m.write8!(EXTRA_PROFILE_BASE + i, extraRows[i]!);
    extraInstalled.add(mem);
}

/** The record address of the extra species whose game form id is `form`, else 0. */
function extraProfileAddress(mem: object, form: number): number {
    if (!extraRows) return 0;
    const count = extraRows.length / 0x58;
    for (let row = 0; row < count; row++) {
        if (extraRowFormId(row) === (form >>> 0)) {
            installExtraProfiles(mem);
            return (EXTRA_PROFILE_BASE + row * 0x58) >>> 0;
        }
    }
    return 0;
}

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;

export interface StatusHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    cards: PartyCardFillHost;
    /** 0x60 scratch bytes: the stat copy, the preview copy, the equipment save. */
    scratch(): number;
    /** [0x80048D34+0x2738](slot, out): the partner's three form ids. */
    copyForms(slot: number, out: number): void;
    /** F0x8008B4CC(obj): build the DIGIVOLVE child page. */
    digivolveFactory(obj: number): number;
    /** F0x800882C8(obj): build the EQUIPMENT child page. */
    equipFactory(obj: number): number;
}

/**
 * The starter profile row of a roster slot: `0x8003EF5C + slot*0x58` for the disc's
 * eight (profile rows 0..7 ARE the starters), and the new partner's own extra row for a
 * slot after them (engine/dw3/roster.ts). Every screen that indexed the table by roster
 * slot asks this instead.
 */
export function rosterSlotProfileAddress(mem: object, slot: number): number {
    const s = slot | 0;
    if (!isDiscRosterSlot(s)) {
        const row = rosterSlotDigimonId(s) - EXTRA_FIRST_ID;
        if (extraRows && row >= 0 && row < extraRows.length / 0x58) {
            installExtraProfiles(mem);
            return (EXTRA_PROFILE_BASE + row * 0x58) >>> 0;
        }
    }
    return (PROFILE_TABLE_BASE + Math.imul(s, PROFILE_STRIDE)) >>> 0;
}

/** F0x800134AC(form): the profile index for a form id, else -1. */
export function profileIndex(mem: PauseMemory, form: number): number {
    for (let i = 0; i < PROFILE_SCAN_ROWS; i++) {
        if (mem.read16(PROFILE_TABLE_BASE + i * PROFILE_STRIDE) === (form >>> 0)) return i;
    }
    return -1;
}

/** F0x800134E8(form): the profile record for a form id, else 0. */
export function profileRecord(mem: PauseMemory, form: number): number {
    const index = profileIndex(mem, form);
    if (index >= 0) return (PROFILE_TABLE_BASE + Math.imul(index, PROFILE_STRIDE)) >>> 0;
    return extraProfileAddress(mem, form);
}

/** The species getter needs nothing but halfword reads, and so does this. */
export interface ProfileTableMemory {
    read16(addr: number): number;
}

/** The table's whole length (55). The original's lookup walks only 52: PROFILE_SCAN_ROWS. */
export const PROFILE_ROWS = PROFILE_COUNT;

/**
 * The game's own form id for one row: that row's first halfword, its `value0`.
 * F0x800134E8 finds a record BY this halfword (profileIndex below), so reading it
 * the other way round is the same table and the same service, not a second rule.
 */
export function profileRowFormId(mem: ProfileTableMemory, row: number): number {
    if (!Number.isInteger(row) || row < 0 || row >= PROFILE_COUNT) return 0;
    return mem.read16(PROFILE_TABLE_BASE + row * PROFILE_STRIDE) & 0xffff;
}

/**
 * THE mapping between the two id spaces, used by every caller that hands a
 * Digimon id to a translated screen. The walker's own digimon.json numbers its
 * profiles 1..55 and the disc numbers the same 55 forms by their own `value0`
 * (row 12 is "Greymon" in digimon.json and form 5 in the game; `~/ddw3/data/
 * digimon_profiles.toml` has the 55 `value0` values in that row order), and the
 * translated screens read the GAME's table — the profile records at 0x8003EF5C,
 * whose rows carry the pairing bytes and whose `+0x55` byte is the row's own
 * 1-based index, which is what the name bank 0x4E is indexed by. So an id handed
 * to a native screen must be a `value0`, and a walker id must be turned into one
 * here. 0 is the original's "no such form" answer (F0x800134E8's).
 */
export function gameFormId(mem: ProfileTableMemory, walkerId: number): number {
    const id = Number(walkerId) | 0;
    if (id >= EXTRA_FIRST_ID) return extraRowFormId(id - EXTRA_FIRST_ID);
    return profileRowFormId(mem, id - 1);
}

/** The game's form id back to the walker's own id, or 0 when it has no row. */
export function walkerIdOf(mem: ProfileTableMemory, form: number): number {
    for (let row = 0; row < PROFILE_COUNT; row++) {
        if (profileRowFormId(mem, row) === (form >>> 0)) return row + 1;
    }
    for (let row = 0; row < extraProfileCount(); row++) {
        if (extraRowFormId(row) === (form >>> 0)) return EXTRA_FIRST_ID + row;
    }
    return 0;
}

/**
 * The profile ROW the walker's own Digimon id sits in, or -1. Both id spaces in
 * one step, asked of the same table the species getter scans: id 12 is digimon.
 * json's "Greymon", the game's form 5, and row 11 of 0x8003EF5C.
 */
export function walkerProfileRow(mem: ProfileTableMemory, walkerId: number): number {
    const form = gameFormId(mem, walkerId);
    return form === 0 ? -1 : profileIndex(mem as PauseMemory, form);
}

/** F0x8008E8F8(parent): build the page object. */
export function statusFactory(mem: PauseMemory, parent: number, host: StatusHost): number {
    const obj = host.alloc(STATUS_HANDLER, STATUS_SIZE, STATUS_EXTRA);
    mem.write32(obj + 0x148, STATUS_PREVIEW_METHOD);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, parent);
    return obj;
}

/** F0x8008B520(obj, ui): the page's widgets. */
export function statusCtor(mem: PauseMemory, obj: number, ui: number, host: StatusHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const order = () => (mem.read32(obj + 0x58) | 0) - 1;
    const layout = () => mem.read32(LAYOUT) | 0;
    const text = (kind: number, x: number, y: number) => host.createText(layer(), kind, s16(x), s16(y));
    const put = (off: number, widget: number) => mem.write32(ui + off, widget);
    const a = layout() + 0x84;
    put(0, text(1, mem.read16(a + 4), mem.read16(a + 8)));
    for (let row = 0; row < 3; row++) {
        const yoff = row * 0x2e;
        const l = layout();
        put(row * 0x2c + 4, text(1, mem.read16(l + 4), mem.read16(l + 8) + yoff));
        for (let k = 0; k < 5; k++) {
            const e = layout() + 0x14 + k * 0xc;
            put(row * 0x2c + 8 + k * 4, text(3, mem.read16(e - 4), mem.read16(e) + yoff));
        }
        for (let k = 0; k < 5; k++) {
            const e = layout() + 0x50 + k * 0xc;
            put(row * 0x2c + 0x1c + k * 4, text(3, mem.read16(e - 4), mem.read16(e) + yoff));
        }
    }
    const b = layout() + 0x90;
    const head = text(1, mem.read16(b + 4), mem.read16(b + 8));
    put(0x88, head);
    host.callMethod(head, 0x160, [2]);
    put(0x8c, text(1, mem.read16(b + 4), mem.read16(b + 8) + 0xe));
    for (let i = 0; i < 2; i++) put(0x90 + i * 4, text(1, 0xac, 0x13 + i * 0xe));
    const cursor = host.createIcon(layer(), order(), 0x98, s16((mem.read32(obj + 0x74) | 0) * 0xe + 0x13));
    put(0x98, cursor);
    host.callMethod(cursor, 0x80, [0]);
    put(0x9c, text(3, 0x42, 0x45));
    put(0xa0, text(3, 0x46, 0x45));
    put(0xa4, text(1, 0xa7, 0x37));
    for (let i = 0; i < 3; i++) put(0xa8 + i * 4, text(1, 0xb2, 0x47 + i * 0xe));
    put(0xb4, text(1, 0xa7, 0x79));
    for (let i = 0; i < 6; i++) put(0xb8 + i * 4, text(1, 0xc0, 0x89 + i * 0xe));
    for (let i = 0; i < 6; i++) put(0xd0 + i * 4, text(1, 0x32, 0x5b + i * 0xe));
    for (let i = 0; i < 7; i++) put(0xe8 + i * 4, text(1, 0x5b, 0x5b + i * 0xe));
    const tpLabel = text(1, 0x10, 0xcb);
    put(0x108, tpLabel);
    host.callMethod(tpLabel, 0x15c, [order()]);
    const tpValue = text(1, 0x2d, 0xcb);
    put(0x104, tpValue);
    host.callMethod(tpValue, 0x15c, [order()]);
}

const bankOf = (mem: PauseMemory, host: StatusHost, offset: number): number =>
    host.languageBank(lang(mem) + offset);

/** F0x8008BB88(obj, ui, member, show): the chosen partner's headline block. */
export function statusHeaderFill(mem: PauseMemory, ui: number, member: number, show: number, host: StatusHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    const stats = host.scratch();
    if (show !== 0) {
        const slot = host.cards.rosterSlot(member) | 0;
        const record = host.cards.cardRecord(slot) >>> 0;
        host.cards.copyStats(slot, stats);
        host.cards.widgetSetLine0(w(4), record, -1);
        const table = mem.read32(0x8009af6c) >>> 0;
        for (let i = 0; i < 5; i++) {
            const id = mem.read32(table + 0xc + i * 0xc) | 0;
            host.cards.widgetSetLine0(w(8 + i * 4), host.cards.resolveText(0xb0), id);
        }
        for (let i = 0; i < 5; i++) {
            const statId = mem.read32(HEAD_STATS + i * 4) | 0;
            host.cards.widgetSetLineNumber(w(0x1c + i * 4), 0, mem.read16s(stats + statId * 2));
            host.cards.widgetMeasure(w(0x1c + i * 4), 1);
        }
        return;
    }
    host.cards.widgetSetFlagC1(w(4), 0);
    for (let i = 0; i < 5; i++) host.cards.widgetSetFlagC1(w(8 + i * 4), 0);
    for (let i = 0; i < 5; i++) host.cards.widgetSetFlagC1(w(0x1c + i * 4), 0);
}

/** F0x8008BD70(obj, ui, show): the two prompt lines. */
export function statusPromptFill(mem: PauseMemory, ui: number, show: number, host: StatusHost): void {
    for (let i = 0; i < 2; i++) {
        const widget = mem.read32(ui + 0x90 + i * 4) | 0;
        if (show !== 0) host.callMethod(widget, 0x114, [bankOf(mem, host, 0xb0), i + 0x2d]);
        else host.callMethod(widget, 0x144, [0]);
    }
}

/** F0x8008BE34(obj, ui, show): the three form names and the current-form mark. */
export function statusFormsFill(mem: PauseMemory, obj: number, ui: number, show: number, host: StatusHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        host.callMethod(w(0xa4), 0x144, [0]);
        for (let i = 0; i < 3; i++) host.callMethod(w(0xa8 + i * 4), 0x144, [0]);
        return;
    }
    const slot = host.cards.rosterSlot(mem.read32(obj + 0x7c) | 0) | 0;
    const forms = host.scratch();
    host.copyForms(slot, forms);
    host.callMethod(w(0xa4), 0x114, [bankOf(mem, host, 0xb0), 0x34]);
    for (let i = 0; i < 3; i++) {
        const form = mem.read16s(forms + i * 2);
        const widget = w(0xa8 + i * 4);
        if (form >= 4) {
            const record = profileRecord(mem, form);
            host.callMethod(widget, 0x114, [bankOf(mem, host, 0x4e), mem.read8(record + 0x55)]);
            const current = mem.read32(rosterContextBase(slot) + 0x75c + 8) | 0;
            host.callMethod(widget, 0x138, [current === form ? 1 : 0]);
        } else {
            host.callMethod(widget, 0x144, [0]);
        }
    }
}

/** F0x8008C02C(obj, ui, show): the six equipment names. */
export function statusEquipFill(mem: PauseMemory, obj: number, ui: number, show: number, host: StatusHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        host.callMethod(w(0xb4), 0x144, [0]);
        for (let i = 0; i < 6; i++) host.callMethod(w(0xb8 + i * 4), 0x144, [0]);
        return;
    }
    const slot = host.cards.rosterSlot(mem.read32(obj + 0x7c) | 0) | 0;
    const card = host.cards.cardRecord(slot) >>> 0;
    host.callMethod(w(0xb4), 0x114, [bankOf(mem, host, 0xb0), 0x20]);
    for (let i = 0; i < 6; i++) {
        const item = mem.read16s(card + 0x3c0 + i * 2);
        if (item !== 0) host.callMethod(w(0xb8 + i * 4), 0x114, [bankOf(mem, host, 0x6a), item]);
        else host.callMethod(w(0xb8 + i * 4), 0x114, [bankOf(mem, host, 0xb0), s16(mem.read32(EQUIP_EMPTY + i * 4))]);
    }
}

const clamp = (v: number): number => (v >= 0x3e8 ? 0x3e7 : v);

/** The thirteen stat widgets at +0xD0, walked by the shared panel (F0x8008C1C0). */
function statusStatPanel(mem: PauseMemory, ui: number, host: StatusHost) {
    return {
        widget: (index: number): number => mem.read32(ui + 0xd0 + index * 4) | 0,
        setNumber: (widget: number, value: number): void => { host.callMethod(widget, 0x118, [0, value]); },
        setEnabled: (widget: number, on: number): void => { host.callMethod(widget, 0x148, [on]); },
        setMark: (widget: number, code: number): void => { host.callMethod(widget, 0x138, [code]); },
    };
}

/** F0x8008C1C0(obj, ui, show): the thirteen stat numbers and the TP pair. */
export function statusStatsFill(mem: PauseMemory, obj: number, ui: number, show: number, host: StatusHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        for (let i = 0; i < 13; i++) host.callMethod(w(0xd0 + i * 4), 0x144, [0]);
        host.callMethod(w(0x108), 0x144, [0]);
        host.callMethod(w(0x104), 0x144, [0]);
        return;
    }
    const stats = host.scratch();
    const slot = host.cards.rosterSlot(mem.read32(obj + 0x7c) | 0) | 0;
    host.cards.copyStats(slot, stats);
    const panel = statusStatPanel(mem, ui, host);
    fillStatPanel(mem, panel, stats, { cap: true, marks: "caller", pass: "after-clear" });
    host.callMethod(w(0x108), 0x114, [host.languageBank(lang(mem) + 0xb0), 0x4e]);
    // Block+2 is the record's TP halfword (record +0x26); the copied block starts
    // at record +0x24, so halfword index 1 IS the TP.
    host.callMethod(w(0x104), 0x118, [0, mem.read16s(stats + 2)]);
    host.callMethod(w(0x104), 0x148, [1]);
    greyStatPanel(mem, panel, stats);
}

const itemKind = (mem: PauseMemory, id: number): number => mem.read8((mem.read32(itemRecord(id)) | 0) + 2);
const itemSub = (mem: PauseMemory, id: number): number => mem.read8((mem.read32(itemRecord(id)) | 0) + 3);

/** F0x8008C460(obj, index, item): try an equipment change and show the stat deltas. */
export function statusEquipPreview(mem: PauseMemory, obj: number, index: number, item: number, host: StatusHost): void {
    const ui = mem.read32(obj + 0x24) | 0;
    if (index === -1) {
        statusStatsFill(mem, obj, ui, 1, host);
        return;
    }
    const slot = host.cards.rosterSlot(mem.read32(obj + 0x7c) | 0) | 0;
    const card = host.cards.cardRecord(slot) >>> 0;
    const stats = host.scratch();
    const preview = stats + 0x30;
    const saved = stats + 0x60;
    host.cards.copyStats(slot, stats);
    for (let i = 0; i < 12; i++) mem.write8(saved + i, mem.read8(card + 0x3c0 + i));
    const own = card + 0x3c0 + index * 2;
    const held = mem.read16s(own);
    if (held !== 0) {
        if (itemKind(mem, held) === 7) {
            mem.write16(card + 0x3c4, 0);
            mem.write16(card + 0x3c6, 0);
        } else {
            mem.write16(own, 0);
        }
    }
    item = s16(item);
    if (item > 0) {
        const kind = itemKind(mem, item);
        if (kind === 7) {
            let at = card + 0x3c4;
            if (mem.read16s(card + 0x3c4) === 0) at = mem.read16s(card + 0x3c6) !== 0 ? card + 0x3c6 : 0;
            if (at !== 0) mem.write16(at, 0);
        } else if (kind === 8) {
            const sub = itemSub(mem, item);
            for (let i = 0; i < 2; i++) {
                const p = card + 0x3c8 + i * 2;
                const other = mem.read16s(p);
                if (other !== 0 && itemSub(mem, other) === sub) mem.write16(p, 0);
            }
        }
        if (itemKind(mem, item) === 7) {
            mem.write16(card + 0x3c4, item);
            mem.write16(card + 0x3c6, item);
        } else {
            mem.write16(own, item);
        }
    }
    host.cards.copyStats(slot, preview);
    for (let i = 0; i < 12; i++) mem.write8(card + 0x3c0 + i, mem.read8(saved + i));
    const mark = (base: number, stat: number, widget: number) => {
        const before = mem.read16s(stats + stat * 2);
        const after = mem.read16s(preview + stat * 2);
        host.callMethod(widget, 0x118, [0, clamp(after)]);
        return { before, after };
    };
    let cellOf = (i: number) => mem.read32(ui + 0xd0 + i * 4) | 0;
    for (let i = 0; i < 6; i++) {
        const { before, after } = mark(0, mem.read32(LEFT_STATS + i * 4) | 0, cellOf(i));
        if (before < after) {
            host.callMethod(cellOf(i), 0x138, [1]);
        } else if (after < before) {
            host.callMethod(cellOf(i), 0x138, [5]);
        } else {
            host.callMethod(cellOf(i), 0x138, [0]);
            const flag = i === 0 ? 0x26 : i === 1 ? 0x28 : i === 4 ? 0x2a : -1;
            if (flag >= 0 && mem.read16s(stats + flag) !== 0) {
                const target = i === 0 ? cellOf(0) : i === 1 ? cellOf(1) : mem.read32(ui + 0xe0) | 0;
                host.callMethod(target, 0x138, [6]);
            }
        }
    }
    cellOf = (i: number) => mem.read32(ui + 0xe8 + i * 4) | 0;
    for (let i = 0; i < 7; i++) {
        const { before, after } = mark(0, mem.read32(RIGHT_STATS + i * 4) | 0, cellOf(i));
        host.callMethod(cellOf(i), 0x138, [before < after ? 1 : after < before ? 5 : 0]);
    }
    for (let i = 0; i < 13; i++) host.callMethod(mem.read32(ui + 0xd0 + i * 4) | 0, 0x148, [1]);
}

/** F0x8008C954(obj): cards, portraits, panels, cursor. */
export function statusDraw(mem: PauseMemory, obj: number, host: StatusHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const pack = (id: number) => host.packHandle(id);
    const size = r(0x5c);
    host.drawInit();
    host.draw7C(r(0x54), r(0x58));
    advanceDigimonPictures({
        mem,
        tableCell: FRAMES,
        timer: obj + 0x6c,
        cadence: 0xd,
        frame: () => host.frameCount(),
        groups: [{
            counterBase: obj + 0x60,
            count: size,
            rowAt: (i) => partyPositionToRosterSlot(mem, i),
            skipNegativeRow: false,
            wrapAt: DIGIMON_PICTURE_ROW_WORDS,
        }],
    });
    host.draw74(0x280, 0x100);
    let y = 0x13;
    let py = 0x27;
    for (let i = 0; i < size; i++) {
        const fold = r(0x90 + i * 0x10);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, fold, 0x1000);
                host.draw94(0x7c, py);
            } else {
                host.draw8C(0x1000, 0x1000, 0x1000);
            }
            host.drawSprite(pack(0x04040000),
                digimonPictureAt(mem, FRAMES, partyPositionToRosterSlot(mem, i), r(0x60 + i * 4)), 0x6b, y);
        }
        y += 0x2e;
        py += 0x2e;
    }
    host.draw74(0x140, 0);
    let a = 0x13;
    let b = 0x11;
    let c = 0x27;
    let d = 0x25;
    for (let i = 0; i < size; i++) {
        const fold = r(0x90 + i * 0x10);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, 0x1000, 0x1000);
                host.draw94(0, d);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.draw8C(r(0x90 + i * 0x10), r(0x90 + i * 0x10), 0x1000);
                host.draw94(0x7c, c);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
                host.draw8C(r(0x90 + i * 0x10), 0x1000, 0x1000);
                host.draw94(0, d);
            } else {
                host.draw8C(0x1000, 0x1000, 0x1000);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
            }
            host.drawSprite(pack(0x02860000), 0x17, 0, b);
        }
        a += 0x2e;
        b += 0x2e;
        c += 0x2e;
        d += 0x2e;
    }
    if (r(0xe0) !== 0) {
        host.draw74(0x280, 0x100);
        const fold = r(0xe0);
        if (fold !== 0x1000) {
            host.draw8C(fold, fold, 0x1000);
            host.draw94(0x7c, 0x27);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        const slot = partyPositionToRosterSlot(mem, r(0x7c));
        host.drawSprite(pack(0x04040000),
            digimonPictureAt(mem, FRAMES, slot, r(0x60 + r(0x7c) * 4)), 0x6b, 0x13);
        host.draw74(0x140, 0);
        if (r(0xe0) !== 0x1000) {
            host.draw8C(r(0xe0), 0x1000, 0x1000);
            host.draw94(0, 0x25);
            host.drawSprite(pack(0x02860000), 0x15, 0, 0x11);
            host.draw8C(r(0xe0), r(0xe0), 0x1000);
            host.draw94(0x7c, 0x27);
            host.drawSprite(pack(0x02860000), 0x16, 0x67, 0x13);
            host.draw8C(r(0xe0), 0x1000, 0x1000);
            host.draw94(0, 0x25);
        } else {
            host.drawSprite(pack(0x02860000), 0x15, 0, 0x11);
            host.drawSprite(pack(0x02860000), 0x16, 0x67, 0x13);
        }
        host.drawSprite(pack(0x02860000), 0x17, 0, 0x11);
    }
    const panel = (off: number, x: number, y: number, sprite: number, sx: number, sy: number, sheet: number) => {
        const fold = r(off);
        if (fold === 0) return;
        if (fold !== 0x1000) {
            host.draw8C(fold, 0x1000, 0x1000);
            host.draw94(x, y);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(pack(sheet), sprite, sx, sy);
    };
    panel(0xc0, 0x140, 0x19, 0x18, 0x22, 0xd, 0x02860000);
    panel(0x130, 0, 0x47, 0x1a, 0, 0x3d, 0x02860000);
    host.draw74(0x280, 0x100);
    panel(0xd0, 0, 0xd3, 0x20, 0, 0xc2, 0x04040000);
    if (r(0x100) !== 0) {
        const fold = r(0x100);
        if (fold !== 0x1000) {
            host.draw8C(fold, 0x1000, 0x1000);
            host.draw94(0, 0x88);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x140, 0);
        host.drawSprite(pack(0x02860000), 0xf, 0, 0x57);
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x21, 0, 0x54);
        if (r(0x100) !== 0x1000) host.draw94(0, 0xd0);
        host.drawSprite(pack(0x04040000), 0x3c, 0, 0xc4);
    }
    panel(0x110, 0x140, 0x55, 0x22, 0xa0, 0x35, 0x04040000);
    if (r(0x120) !== 0) {
        const fold = r(0x120);
        if (fold !== 0x1000) {
            host.draw8C(fold, 0x1000, 0x1000);
            host.draw94(0x140, 0xac);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
            const slot = partyPositionToRosterSlot(mem, r(0x7c));
            const card = host.cards.cardRecord(slot) >>> 0;
            let iy = 0x89;
            for (let i = 0; i < 6; i++) {
                const item = mem.read16s(card + 0x3c0 + i * 2);
                if (item > 0) {
                    host.draw74(0x140, 0);
                    const sheet = pack(0x02860000);
                    host.drawSprite(sheet, itemIconClip(mem, item), 0xb2, iy);
                }
                iy += 0xe;
            }
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x23, 0xa0, 0x77);
    }
    panel(0xf0, 0x140, 0x20, 0x1f, 0x14, 0xd, 0x04040000);
    if (r(0x78) !== 0) {
        if (host.frameCount() - r(0x84) >= 9) {
            w(0x84, host.frameCount());
            const v = r(0x80) + 1;
            w(0x80, v);
            if (v >= 8) w(0x80, 0);
        }
        host.drawInit();
        host.draw7C(r(0x54), r(0x58) - 1);
        host.draw74(0x280, 0x100);
        host.draw88(r(0x80));
        host.drawSprite(pack(0x04040000), 0x1e, 0, r(0x7c) * 0x2e + 0x11);
    }
}

/** F0x8008D684(obj, ui): the partner's detail view. */
export function statusDetailTick(mem: PauseMemory, obj: number, ui: number, host: StatusHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    const start = (fold: number, open: number) => host.foldStart(obj + fold, open);
    const tick = (fold: number) => host.foldTick(obj + fold) !== 0;
    const advance = () => w(0x14, r(0x14) + 1);
    const cursorY = () => r(0x74) * 0xe + 0x13;
    switch (r(0x14)) {
        default:
            if (r(0x18) === 0) start(0xd8, 1);
            start(0xe8, 1);
            advance();
            return;
        case 1:
            if (r(0x18) === 0) host.foldTick(obj + 0xd8);
            if (tick(0xe8)) {
                if (r(0x130) === 0) start(0x128, 1);
                start(0x108, 1);
                statusHeaderFill(mem, ui, r(0x7c), 1, host);
                statusPromptFill(mem, ui, 1, host);
                advance();
            }
            return;
        case 2:
            host.foldTick(obj + 0x128);
            if (tick(0x108)) {
                if (r(0x100) === 0) start(0xf8, 1);
                start(0x118, 1);
                statusFormsFill(mem, obj, ui, 1, host);
                const card = host.cards.cardRecord(host.cards.rosterSlot(r(0x7c)) | 0) >>> 0;
                host.callMethod(at(0x9c), 0x118, [0, mem.read32(card + 0x18) | 0]);
                host.callMethod(at(0x9c), 0x148, [1]);
                host.callMethod(at(0xa0), 0x114, [bankOf(mem, host, 0xb0), 0x35]);
                host.callMethod(at(0x98), 0x84, [0x98, cursorY()]);
                host.callMethod(at(0x98), 0x80, [1]);
                advance();
            }
            return;
        case 3:
            host.foldTick(obj + 0xf8);
            if (tick(0x118)) {
                statusEquipFill(mem, obj, ui, 1, host);
                statusStatsFill(mem, obj, ui, 1, host);
                w(0x14, 5);
            }
            return;
        case 5: {
            const before = r(0x74);
            if (pressedOrRepeat(4)) w(0x74, 0);
            else if (pressedOrRepeat(6)) w(0x74, 1);
            if (before !== r(0x74)) {
                host.playSound(0x8004513e);
                host.callMethod(at(0x98), 0x84, [0x98, cursorY()]);
                return;
            }
            if (pressed(0xd)) {
                host.playSound(0x8004503c);
                w(0x14, 0xa);
                w(0x18, 0);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x14, 0xa);
                w(0x74, 0);
                w(0x18, 1);
            }
            return;
        }
        case 0xa:
            if (r(0x18) !== 0) {
                start(0xd8, 0);
                statusHeaderFill(mem, ui, 0, 0, host);
            }
            start(0xe8, 0);
            start(0x108, 0);
            start(0x118, 0);
            statusPromptFill(mem, ui, 0, host);
            statusFormsFill(mem, obj, ui, 0, host);
            statusEquipFill(mem, obj, ui, 0, host);
            if (r(0x74) === 0) {
                start(0x128, 0);
                start(0xf8, 0);
                statusStatsFill(mem, obj, ui, 0, host);
                host.callMethod(at(0x9c), 0x144, [0]);
                host.callMethod(at(0xa0), 0x144, [0]);
            }
            host.callMethod(at(0x98), 0x80, [0]);
            advance();
            return;
        case 0xb:
            if (r(0x18) !== 0) host.foldTick(obj + 0xd8);
            host.foldTick(obj + 0xe8);
            host.foldTick(obj + 0x108);
            if (r(0x74) === 0) {
                host.foldTick(obj + 0xf8);
                host.foldTick(obj + 0x128);
            }
            if (tick(0x118)) advance();
            return;
        case 0xc:
            host.callMethod(obj, 0x2c, [r(0x18) !== 0 ? 0 : 0x14]);
            return;
    }
}

/** F0x8008DDB0(obj, ui): open, pick a partner, hand over to a child page, close. */
export function statusTick(mem: PauseMemory, obj: number, ui: number, host: StatusHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    const start = (fold: number, open: number) => host.foldStart(obj + fold, open);
    const tick = (fold: number) => host.foldTick(obj + fold) !== 0;
    const rows = (row: number, show: number) => partyCardRows(mem, ui, row, show, host.scratch(), ROWS_STATUS, host.cards);
    const say = (target: number, id: number) => host.callMethod(at(target), 0x114, [bankOf(mem, host, 0xb0), id]);
    const hide = (target: number) => host.callMethod(at(target), 0x144, [0]);
    const advance = () => w(0x10, r(0x10) + 1);
    const prompts = () => {
        say(0x88, 0x30);
        say(0x8c, 0x15);
        w(0x10, 0xa);
    };
    switch (r(0x10)) {
        default:
            start(0x88, 1);
            start(0xb8, 1);
            if (r(0x5c) === 1) start(0xc8, 1);
            w(0x10, r(0x5c));
            return;
        case 1:
            host.foldTick(obj + 0x88);
            host.foldTick(obj + 0xb8);
            if (tick(0xc8)) {
                rows(0, 1);
                say(0, 0x27);
                prompts();
            }
            return;
        case 2:
            host.foldTick(obj + 0x88);
            if (tick(0xb8)) {
                start(0x98, 1);
                start(0xc8, 1);
                rows(0, 1);
                say(0, 0x27);
                w(0x10, 4);
            }
            return;
        case 4:
            host.foldTick(obj + 0x98);
            if (tick(0xc8)) {
                rows(1, 1);
                prompts();
            }
            return;
        case 3:
            host.foldTick(obj + 0x88);
            if (tick(0xb8)) {
                start(0x98, 1);
                rows(0, 1);
                say(0, 0x27);
                w(0x10, 5);
            }
            return;
        case 5:
            if (tick(0x98)) {
                start(0xa8, 1);
                start(0xc8, 1);
                rows(1, 1);
                advance();
            }
            return;
        case 6:
            host.foldTick(obj + 0xa8);
            if (tick(0xc8)) {
                rows(2, 1);
                prompts();
            }
            return;
        case 0xa:
            w(0x78, 1);
            advance();
            return;
        case 0xb: {
            const before = r(0x7c);
            if (pressedOrRepeat(4)) {
                const v = r(0x7c) - 1;
                w(0x7c, v);
                if (v < 0) w(0x7c, 0);
            } else if (pressedOrRepeat(6)) {
                const v = r(0x7c) + 1;
                const limit = r(0x5c) - 1;
                w(0x7c, v);
                if (limit < v) w(0x7c, limit);
            }
            if (before !== r(0x7c)) {
                host.playSound(0x4001b);
                return;
            }
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                w(0x78, 0);
                w(0x74, 0);
                host.callMethod(obj, 0x2c, [0x32]);
                w(0x14, 1);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x78, 0);
                host.callMethod(obj, 0x2c, [0x32]);
            }
            return;
        }
        case 0xf:
            statusDetailTick(mem, obj, ui, host);
            return;
        case 0x14:
            if (r(0x74) === 0) {
                if (at(0x10c) === 0) mem.write32(ui + 0x10c, host.digivolveFactory(obj));
            } else if (at(0x10c) === 0) {
                mem.write32(ui + 0x10c, host.equipFactory(obj));
            }
            advance();
            return;
        case 0x15:
            if (at(0x10c) === 0) {
                host.callMethod(obj, 0x2c, [0xf]);
                w(0x18, 1);
            }
            return;
        case 0x32:
            start(r(0x5c) * 0x10 + 0x78, 0);
            rows(r(0x5c) - 1, 0);
            start(0xc8, 0);
            hide(0x88);
            hide(0x8c);
            if (r(0x5c) === 1) {
                start(0xb8, 0);
                hide(0);
            }
            w(0x10, r(0x5c) + 0x32);
            return;
        case 0x33:
            host.foldTick(obj + 0x88);
            host.foldTick(obj + 0xb8);
            if (tick(0xc8)) w(0x10, 0x39);
            return;
        case 0x34:
            host.foldTick(obj + 0x98);
            if (tick(0xc8)) {
                start(0x88, 0);
                start(0xb8, 0);
                rows(0, 0);
                hide(0);
                w(0x10, 0x36);
            }
            return;
        case 0x35:
            host.foldTick(obj + 0xa8);
            if (tick(0xc8)) {
                start(0x98, 0);
                rows(1, 0);
                w(0x10, 0x37);
            }
            return;
        case 0x37:
            if (tick(0x98)) {
                start(0x88, 0);
                start(0xb8, 0);
                rows(0, 0);
                hide(0);
                advance();
            }
            return;
        case 0x36:
        case 0x38:
            host.foldTick(obj + 0x88);
            if (tick(0xb8)) w(0x10, 0x39);
            return;
        case 0x39:
            if (r(0x14) !== 0) {
                host.callMethod(obj, 0x2c, [0xf]);
                return;
            }
            w(0xc, 3);
            return;
    }
}

/** F0x8008E744(obj, ui): the page's lifecycle. */
export function statusRoot(mem: PauseMemory, obj: number, ui: number, host: StatusHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        statusTick(mem, obj, ui, host);
        statusDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    for (let i = 0; i < 3; i++) {
        if (partyPositionToRosterSlot(mem, i) >= 0) mem.write32(obj + 0x5c, (mem.read32(obj + 0x5c) | 0) + 1);
    }
    const size = mem.read32(obj + 0x5c) | 0;
    for (let i = 0; i < size; i++) {
        mem.write32(obj + 0x88 + i * 0x10, 0xa);
        host.foldStart(obj + 0x88 + i * 0x10, 1);
    }
    for (let i = 0; i < 2; i++) {
        mem.write32(obj + 0xb8 + i * 0x10, 0xa);
        host.foldStart(obj + 0xb8 + i * 0x10, 1);
    }
    for (const off of [0xd8, 0xe8, 0xf8, 0x118, 0x108, 0x128]) mem.write32(obj + off, 0xa);
    mem.write32(obj + 0x138, 8);
    statusCtor(mem, obj, ui, host);
}
