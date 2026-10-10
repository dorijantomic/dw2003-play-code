// The card duel's board-view method bodies and its three browse passes,
// translated from pro/cardgame. These are the duel's own screen methods, so
// they are installed through the view constructor (F0x8009D310) rather than
// listed as ordinary function starts — the m2c bodies for the three plate/slot
// writers are wrong (they mis-scale the index and mis-read the tail), so each
// was re-read from the overlay assembly:
//   F0x8009C898 scaleSlotCore  — the slot tween's field writer (view+0xF24's callee)
//   F0x8009C938 scaleSlot      — view+0xF24: forwards to the core with the
//                                6th argument 0
//   F0x8009BE40 openPlate      — view+0xEA4: open a centre plate
//   F0x8009BE78 closePlate     — view+0xEA8: close a centre plate
//   F0x8009DF68 primeAiPileBrowseCounts — the browse's row/limit setup, no portraits
//   F0x8009DBE8 startAiPileBrowse       — the browse's row/limit setup AND the
//                                        portrait reveal walk
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x8009c898 @.L0x00019be8, F0x8009c938 @.L0x00019c88, F0x8009be40
//   @.L0x00019190, F0x8009be78 @.L0x000191c8, F0x8009df68 @.L0x0001b2b8,
//   F0x8009dbe8 @.L0x0001af38.
//
// What the player sees. Moving the cursor over the board calls the view's
// slot-tween writer (scaleSlot) to slide one card slot; opening a played-card
// plate calls openPlate, closing it calls closePlate. When the duel lays out a
// pile browse, primeAiPileBrowseCounts sizes the request (one reveal every four
// frames, `count*4 + 10`) without touching the board, and startAiPileBrowse does
// the same sizing and then reveals the portraits: for every board slot it
// positions the card, writes its badge value, and copies the derived layout byte
// into the slot record — up to the pile's count, hiding the rest.
//
// The view's own method slots that these bodies call (ED8/F14/F18/F3C/F40) are
// host edges in this port, exactly as the view queue treats its three method
// slots: their bodies are separate un-ported view methods, not this routine's.
//
// The queue's D0x800A5D2C records pick the (row, kind) an arm hands to
// startAiPileBrowse / primeAiPileBrowseCounts. The pile's per-row record has
// stride 0xC8; the count for kind 0 lives at +0x5A6, kind 1 at +0x5A2 and
// kind 2 at +0x5A4 of that record (the branch delay slots load `2 * row` before
// the body's add/shift chain, which is what makes the stride 0xC8 rather than
// 0x48 — the assembly's `sll` sits in the delay slot, not the body). The loop's
// per-card badge value reads the same 0xC8-stride record: kind 0 -> +0x600,
// kind 1 -> +0x614, kind 2 -> the count-indexed +0x5B0 table.

import { zeroFill } from "../zero-fill.ts";
import { CURRENT_VIEW_CELL } from "../globals.ts";
import { constructCardView, resolveCardRecord, type CardViewHost } from "./card-view.ts";

export interface DuelBoardMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

// The four view method bodies the browse reveal walk dispatches through. They
// are constructor-installed (not ordinary function starts), so the m2c bodies
// mis-scale the index; each was re-read from the overlay assembly:
//   F0x80098864 cardFanOut      — view+0xED8: x offset of card i in a row of n
//   F0x8009C510 placeCardResetVisual — view+0xF14: place a slot at rest, full size
//   F0x8009CDFC hide_card_sprite     — view+0xF18: take a slot off the board
//   F0x8009CFBC bind_slot_to_card    — view+0xF3C: the slot starts showing a card
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x80098864 @.L0x00015bb4, F0x8009c510 @.L0x00019860,
//   F0x8009cdfc @.L0x0001a14c, F0x8009cfbc @.L0x0001a30c.

/** The card-id table the slot binder reads (a pointer stored in the view). */
export const BOARD_CARD_TABLE = 0x50;

/** F0x80098864(count, index): card `index`'s x offset in a row of `count`.
 * Up to six cards the pitch is a flat 0x2900 (41.0 px); from seven the row is
 * squeezed into a fixed 0xF600 (246.0 px) total. (Same body as the card
 * animation system's `cardFanOut`; this is the view-slot's own entry point.) */
export function cardFanOut(count: number, index: number): number {
    const pitch = count < 7 ? 0x2900 : Math.trunc(0xf600 / count);
    return pitch * index;
}

/** F0x8009C510(view, index, x, y): place a slot at (x, y) and reset its whole
 * visual state to the default resting card — zero the 0x4C-byte sprite, mark it
 * visible and idle, arm both scale pairs to 0x1000 and clear the badge/stat
 * fields. */
export function placeCardResetVisual(
    mem: DuelBoardMemory, view: number, index: number, x: number, y: number,
): void {
    const r = view + index * BOARD_SLOT_STRIDE;
    zeroFill(mem, r + 0x108, BOARD_SLOT_STRIDE);
    mem.write8(r + 0x14d, 1);
    mem.write8(r + 0x14a, 1);
    mem.write32(r + 0x108, x | 0);
    mem.write32(r + 0x10c, y | 0);
    mem.write16(r + 0x124, 0x1000);
    mem.write16(r + 0x120, 0x1000);
    mem.write16(r + 0x126, 0x1000);
    mem.write16(r + 0x122, 0x1000);
    mem.write16(r + 0x142, 0);
    mem.write16(r + 0x140, 0);
    mem.write16(r + 0x12c, index & 0xffff);
    mem.write8(r + 0x14b, 0);
    mem.write8(r + 0x14c, 0);
    mem.write8(r + 0x14f, 0);
    mem.write8(r + 0x151, 0);
    mem.write16(r + 0x12e, 0);
}

/** F0x8009CDFC(view, index): the slot leaves the board — hidden, not placed,
 * never statted. */
export function hideCardSprite(mem: DuelBoardMemory, view: number, index: number): void {
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write8(r + 0x14a, 0);
    mem.write8(r + 0x14d, 0);
    mem.write16(r + 0x142, 0);
}

// ── set_hud_counter (F0x8009CAE0) ────────────────────────────────────────────
// The view slot +0xEA0 the counter/stat family (F0x8009EDCC refreshAllCounters
// and the dynamic-stat Megas) pushes every HUD number through. It does NOT lift
// — m2c cannot resolve its jump table at D0x80083778 — so it is read from the
// binary directly. It was the named blocker on family C.
//
// Source (assembly): the arm bodies 0x8009CB08..0x8009CC48, table
// D0x80083778 (10 entries), read word by word from pro_cardgame.bin.

/** The ten readouts' struct offsets inside a player's 0x54-byte HUD record:
 * six byte counters (0x78..0x7E), then a word, then two halfwords. */
export const HUD_COUNTER_OFFSETS: readonly number[] = [
    0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x88, 0x70, 0x72,
];

/**
 * F0x8009CAE0(view, side, index, value): one number on a player's strip changes.
 * `index` (unsigned) selects the readout 0..9 and `side` the 0x54-stride player
 * record; the value is written as a byte for indices 0..6, a word for index 7
 * and a halfword for indices 8 and 9. An index outside 0..9 writes nothing.
 */
export function setHudCounter(
    mem: DuelBoardMemory, view: number, side: number, index: number, value: number,
): void {
    if ((index >>> 0) >= HUD_COUNTER_OFFSETS.length) return;
    const r = view + side * 0x54;
    const off = HUD_COUNTER_OFFSETS[index] as number;
    if (index === 7) mem.write32(r + off, value | 0);
    else if (index >= 8) mem.write16(r + off, value & 0xffff);
    else mem.write8(r + off, value & 0xff);
}

/** The host the slot binder needs (the resident card-view class's own host). */
export type SlotCardHost = CardViewHost;

/**
 * F0x8009CFBC(view, index, cardId): the slot starts showing that card. The
 * routine builds the resident card-view class on `scratch`, asks it to resolve
 * the card record (the id comes from the view's own card table, made 1-based),
 * then copies the record's fields onto the slot: the frame colour (colour − 1),
 * the two printed numbers, the summon cost, and a flag that says this is a
 * Digimon rather than a Program card.
 */
export function bindSlotToCard(
    mem: DuelBoardMemory, host: SlotCardHost, scratch: number,
    view: number, index: number, cardId: number,
): void {
    constructCardView(mem, scratch);
    const table = mem.read32(view + BOARD_CARD_TABLE) | 0;
    const id = (mem.read16s(table + cardId * 2) + 1) | 0;
    resolveCardRecord(mem, host, id);
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const record = mem.read32(ctx) | 0;
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write16(r + 0x142, cardId & 0xffff);
    mem.write8(r + 0x14b, mem.read8(record + 0x1) & 0xff);
    mem.write8(r + 0x14c, mem.read8(record + 0x2) & 0xff);
    mem.write8(r + 0x149, mem.read8(record + 0x5) & 0xff);
    mem.write16(r + 0x140, (mem.read8(record + 0x0) - 1) & 0xffff);
    mem.write16(r + 0x144, (mem.read8(record + 0x3) & 0xff) === 0x10 ? 1 : 0);
}

/** The view method slots these bodies dispatch through (they are host edges). */
export interface DuelBoardHost {
    /** `view+0xF14(view, index, x, y)` = F0x8009C510: position one board slot. */
    positionSlot(view: number, index: number, x: number, y: number): void;
    /** `view+0xF3C(view, index, value)` = F0x8009CFBC: the slot's badge value. */
    writeSlotValue(view: number, index: number, value: number): void;
    /** `view+0xF18(view, index)` = F0x8009CDFC: hide one board slot. */
    hideSlot(view: number, index: number): void;
    /** `view+0xED8(count, index)` = F0x80098864: the staggered reveal x offset. */
    slotRevealOffset(count: number, index: number): number;
}

/** The centre-plate record array the two plate writers index (stride 0x0C). */
export const BOARD_PLATE_STRIDE = 0x0c;
export const BOARD_PLATE_BASE = 0x0dc0;
/** The board slot record stride (F0x8009C898's own `index * 0x4C`). */
export const BOARD_SLOT_STRIDE = 0x4c;
/** The first board slot of the centre played-card row (slots 0..0xB are the hands). */
export const BOARD_CENTRE_SLOT = 0xc;
/** The duel's board-view request fields (`duel + 0x498`). */
export const BOARD_QUEUE = {
    /** The 0x49C flag the browse passes read per slot and clear when they run. */
    flag: 0x49c,
    /** The 40 per-slot layout bytes the reveal walk copies into the view. */
    slotBytes: 0x49e,
    /** Ticks elapsed / slot cursor / four-tick cadence budget (s32). */
    acc: 0x4c8,
    cursor: 0x4cc,
    budget: 0x4d0,
    /** The current request's row count / length in ticks (s32). */
    rows: 0x4d4,
    limit: 0x4d8,
    /** The view's slot record layout byte. */
    layout: 0x151,
} as const;
/** The hand-row and played-card counts and the per-slot layout source. */
export const BOARD_PLAYER_HAND_COUNT = 0x72c;
export const BOARD_OPPONENT_HAND_COUNT = 0x79e;
export const BOARD_PLAY_COUNT = 0x575;
/** The pile's per-row record stride the browse counts live under. */
export const BOARD_PILE_STRIDE = 0xc8;
/** The slot scale the reveal walk pins its destination to. */
export const BOARD_SLOT_SCALE = 0x1000;
/** The centre plate's open and close field values. */
export const BOARD_PLATE_OPEN_VALUE = 0x1000;
export const BOARD_PLATE_OPEN_KIND = 1;
export const BOARD_PLATE_CLOSE_KIND = 3;

/** F0x8009BE40(view, index, value): open the centre plate at `index`. */
export function openPlate(mem: DuelBoardMemory, view: number, index: number, value: number): void {
    const r = view + index * BOARD_PLATE_STRIDE;
    mem.write16(r + BOARD_PLATE_BASE + 0x0, BOARD_PLATE_OPEN_VALUE);
    mem.write16(r + BOARD_PLATE_BASE + 0x8, BOARD_PLATE_OPEN_KIND);
    mem.write16(r + BOARD_PLATE_BASE + 0x2, 0);
    mem.write16(r + BOARD_PLATE_BASE + 0xa, value & 0xffff);
    mem.write16(r + BOARD_PLATE_BASE + 0x6, 0xa);
    mem.write16(r + BOARD_PLATE_BASE + 0x4, 0xa);
}

/** F0x8009BE78(view, index): close the centre plate at `index`. */
export function closePlate(mem: DuelBoardMemory, view: number, index: number): void {
    const r = view + index * BOARD_PLATE_STRIDE;
    mem.write16(r + BOARD_PLATE_BASE + 0x0, BOARD_PLATE_OPEN_VALUE);
    mem.write16(r + BOARD_PLATE_BASE + 0x2, BOARD_PLATE_OPEN_VALUE);
    mem.write16(r + BOARD_PLATE_BASE + 0x8, BOARD_PLATE_CLOSE_KIND);
    mem.write16(r + BOARD_PLATE_BASE + 0x6, 5);
    mem.write16(r + BOARD_PLATE_BASE + 0x4, 5);
}

/**
 * F0x8009C898(view, index, span, from, to, skip): the slot tween's field writer.
 * `skip` (the wrapper always passes 0) suppresses the destination stores.
 */
export function scaleSlotCore(
    mem: DuelBoardMemory, view: number, index: number, span: number, from: number, to: number, skip: number,
): number {
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write16(r + 0x124, from & 0xffff);
    mem.write16(r + 0x126, to & 0xffff);
    mem.write16(r + 0x128, mem.read16s(r + 0x120) & 0xffff);
    mem.write16(r + 0x12a, mem.read16s(r + 0x122) & 0xffff);
    if ((skip | 0) !== 1) {
        mem.write32(r + 0x134, span | 0);
        mem.write32(r + 0x130, span | 0);
        mem.write8(r + 0x14a, 2);
        mem.write16(r + 0x12e, 1);
        mem.write32(r + 0x110, mem.read32(r + 0x108) | 0);
        mem.write32(r + 0x114, mem.read32(r + 0x10c) | 0);
    }
    return 0;
}

/** F0x8009C938(view, index, span, from, to): view+0xF24's wrapper over the core. */
export function scaleSlot(
    mem: DuelBoardMemory, view: number, index: number, span: number, from: number, to: number,
): void {
    scaleSlotCore(mem, view, index, span, from, to, 0);
}

/**
 * F0x8009C960(view, index, span, destX, destY): the silent card-move tween's
 * field writer. It snapshots the slot's current position as the tween's start
 * (`+0x118` / `+0x11C` = current x / y), writes the destination pair (`+0x110` /
 * `+0x114` = destX / destY) and the span (`+0x130` / `+0x134`). It does NOT set
 * the mode byte or the scales — the caller (`cardStartMoveSilent`) does. Read
 * from exe-decomp/cardgame.norm.s .L0x00019cb0 (the body right below, at
 * .L0x00019dd0, is the sibling `card_start_move` F0x8009CA80 which sets mode 5
 * and the scales before calling this; do not confuse them).
 */
export function cardMoveCore(
    mem: DuelBoardMemory, view: number, index: number, span: number, destX: number, destY: number,
): void {
    const r = view + index * BOARD_SLOT_STRIDE;
    const startX = mem.read32(r + 0x108) | 0;
    const startY = mem.read32(r + 0x10c) | 0;
    mem.write32(r + 0x110, destX | 0);
    mem.write32(r + 0x134, span | 0);
    mem.write32(r + 0x130, span | 0);
    mem.write32(r + 0x114, destY | 0);
    mem.write32(r + 0x118, startX);
    mem.write32(r + 0x11c, startY);
}

/**
 * F0x8009CA3C `card_start_move_silent` — view+0xF0C: slide a card slot silently
 * to (destX, destY) over `span` frames. Sets the slot's mode byte to 3 and then
 * hands the tween to the field writer above. Read from
 * exe-decomp/cardgame.norm.s .L0x00019d8c.
 */
export function cardStartMoveSilent(
    mem: DuelBoardMemory, view: number, index: number, span: number, destX: number, destY: number,
): void {
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write8(r + 0x14a, 3);
    cardMoveCore(mem, view, index, span, destX, destY);
}

/**
 * F0x8009C5D8 `card_start_flip` — view+0xF28: flip a card slot over (plays
 * sfx 0x8004613E, sets the slot's mode byte `+0x14A` = 4, resets the two scale
 * accumulators `+0x130`/`+0x134` to 0, both scale pairs to full and the tick
 * flag `+0x12E` to 0). Read from exe-decomp/cardgame.norm.s .L0x00019928.
 */
export function cardStartFlip(
    mem: DuelBoardMemory, host: { playPackedSound(id: number): void }, view: number, index: number,
): void {
    host.playPackedSound(0x8004613e | 0);
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write8(r + 0x14a, 4);
    mem.write32(r + 0x130, 0);
    mem.write32(r + 0x134, 0);
    mem.write16(r + 0x120, 0x1000);
    mem.write16(r + 0x122, 0x1000);
    mem.write16(r + 0x12e, 0);
}

/**
 * F0x8009C904(view, index, from, to) — view+0xF20: set a slot's scale endpoints
 * without starting a tween. It forwards to the field writer with span 0 and the
 * destination stores suppressed (`skip` = 1), so only the two endpoint halfwords
 * (`+0x124`/`+0x126`) and the current-scale snapshot (`+0x128`/`+0x12A`) change.
 * Read from exe-decomp/cardgame.norm.s .L0x00019c54.
 */
export function setCardScaleEndpoints(
    mem: DuelBoardMemory, view: number, index: number, from: number, to: number,
): void {
    scaleSlotCore(mem, view, index, 0, from, to, 1);
}

/**
 * F0x8009C9A0(view, index, span, destX, destY) — view+0xF08: slide a card slot
 * to (destX, destY) over `span` frames, announcing it with sfx 0x8004603C. Sets
 * the slot's mode byte `+0x14A` to 2 (the audible move, where the silent one at
 * .L0x00019d8c uses 3) then hands the tween to the field writer. Read from
 * exe-decomp/cardgame.norm.s .L0x00019cf0.
 */
export function cardStartMoveWithSfx(
    mem: DuelBoardMemory, host: { playPackedSound(id: number): void },
    view: number, index: number, span: number, destX: number, destY: number,
): void {
    host.playPackedSound(0x8004603c | 0);
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write8(r + 0x14a, 2);
    cardMoveCore(mem, view, index, span, destX, destY);
}

/**
 * F0x8009CE28(view, index) — view+0xF1C: a slot settles. Plays sfx 0x4001C,
 * sets the slot's mode byte `+0x14A` to 0xB and zeroes the two span accumulators
 * `+0x130`/`+0x134`. Read from exe-decomp/cardgame.norm.s .L0x0001a178.
 */
export function cardStartSettle(
    mem: DuelBoardMemory, host: { playPackedSound(id: number): void }, view: number, index: number,
): void {
    host.playPackedSound(0x4001c | 0);
    const r = view + index * BOARD_SLOT_STRIDE;
    mem.write8(r + 0x14a, 0xb);
    mem.write32(r + 0x134, 0);
    mem.write32(r + 0x130, 0);
}

/**
 * F0x8009DF68(duel, scene, row, kind): size a pile-browse request without
 * touching the board — write the pile's count into the request's row field, zero
 * the elapsed/cursor/budget accumulators, and set the `count*4 + 10` window.
 * A kind outside 0..2 leaves the row field unchanged (the original skips the
 * count store) but still zeroes the accumulators and rescales the window from
 * the existing row value.
 */
export function primeAiPileBrowseCounts(
    mem: DuelBoardMemory, duel: number, row: number, kind: number,
): void {
    const q = duel + 0x498;
    if (kind === 0) mem.write32(q + 0x3c, mem.read16s(duel + row * BOARD_PILE_STRIDE + 0x5a6) | 0);
    else if (kind === 1) mem.write32(q + 0x3c, mem.read16s(duel + row * BOARD_PILE_STRIDE + 0x5a2) | 0);
    else if (kind === 2) mem.write32(q + 0x3c, mem.read16s(duel + row * BOARD_PILE_STRIDE + 0x5a4) | 0);
    const rows = mem.read32(q + 0x3c) | 0;
    mem.write32(q + 0x30, 0);
    mem.write32(q + 0x34, 0);
    mem.write32(q + 0x38, 0);
    mem.write32(q + 0x40, ((rows * 4) + 0xa) | 0);
}

/** The pile count a browse pass reads for `(row, kind)`, or null for kind > 2. */
function browseCount(mem: DuelBoardMemory, duel: number, row: number, kind: number): number | null {
    if (kind === 0) return mem.read16s(duel + row * BOARD_PILE_STRIDE + 0x5a6) | 0;
    if (kind === 1) return mem.read16s(duel + row * BOARD_PILE_STRIDE + 0x5a2) | 0;
    if (kind === 2) return mem.read16s(duel + row * BOARD_PILE_STRIDE + 0x5a4) | 0;
    return null;
}

/** The per-card badge value the reveal walk writes for `(row, kind, index)`. */
function browseBadge(mem: DuelBoardMemory, duel: number, row: number, kind: number, index: number): number {
    const base = duel + row * BOARD_PILE_STRIDE;
    if (kind === 0) return mem.read16s(base + 0x600 + index * 2) | 0;
    if (kind === 1) return mem.read16s(base + 0x614 + index * 2) | 0;
    const count = mem.read16s(base + 0x5a0) | 0;
    return mem.read16s(base + (count + index) * 2 + 0x5b0) | 0;
}

/**
 * F0x8009DBE8(duel, scene, row, kind): lay out a pile browse and reveal its
 * portraits. Same sizing as `primeAiPileBrowseCounts`, then for all 40 board
 * slots: while the slot is inside the pile, position it, write its badge and (if
 * the browse flag is set) mark it, copying the derived layout byte into the slot
 * record; otherwise hide it. Clears the browse flag at the end.
 */
export function startAiPileBrowse(
    mem: DuelBoardMemory, host: DuelBoardHost, duel: number, scene: number, row: number, kind: number,
): void {
    const view = mem.read32(scene + 0x18) | 0;
    const q = duel + 0x498;
    const count = browseCount(mem, duel, row, kind);
    if (count !== null) mem.write32(q + 0x3c, count);
    const rows = mem.read32(q + 0x3c) | 0;
    mem.write32(q + 0x30, 0);
    mem.write32(q + 0x34, 0);
    mem.write32(q + 0x38, 0);
    mem.write32(q + 0x40, ((rows * 4) + 0xa) | 0);
    if (rows === 0) {
        // The empty pile: position the first slot and hide the other 39.
        mem.write8(duel + BOARD_QUEUE.flag, 0);
        host.positionSlot(view, 0, ((host.slotRevealOffset(0, 0) | 0) + 0x1800) | 0, 0x6100);
        mem.write8(view + 0x14d, 3);
        mem.write16(view + 0x120, 0);
        for (let i = 1; i < 0x28; i++) host.hideSlot(view, i);
        return;
    }
    for (let i = 0; i < 0x28; i++) {
        if (i < rows) {
            host.positionSlot(view, i, ((host.slotRevealOffset(rows, i) | 0) + 0x1800) | 0, 0x6100);
            if (kind <= 2) host.writeSlotValue(view, i, browseBadge(mem, duel, row, kind, i));
            if (mem.read8(duel + BOARD_QUEUE.flag) !== 0) mem.write8(view + i * BOARD_SLOT_STRIDE + 0x14d, 2);
            mem.write16(view + i * BOARD_SLOT_STRIDE + 0x120, 0);
            mem.write8(view + i * BOARD_SLOT_STRIDE + BOARD_QUEUE.layout, mem.read8(duel + BOARD_QUEUE.slotBytes + i));
        } else {
            host.hideSlot(view, i);
        }
    }
    mem.write8(duel + BOARD_QUEUE.flag, 0);
}
