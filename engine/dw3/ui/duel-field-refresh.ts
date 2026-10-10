// The duel board view's browse refresh and its slot-colour query, translated
// from pro/cardgame. Both are the duel screen object's own methods, so they are
// constructor-installed rather than ordinary function starts and are read from
// the overlay ASSEMBLY (exe-decomp/cardgame.norm.s), never the m2c C (the
// cardgame_c/F0x8009E024.c for this routine is empty: the m2c blob drops the
// whole constructor-installed screen-object method table).
//
//   F0x8009E024 refreshFieldCardViews @.L0x0001b374 (cardgame.norm.s 29435-29791)
//     - rebuild both hand rows' portraits (six player, six opponent), then
//     - walk the played-card row, placing each played card and lighting the
//       board slots the pending effect matches.
//   F0x8009CF60 field_slot_colour (view+0xF40) @.L0x0001a2b0 (swallowed into the
//     preceding .global F0x8009cc28 in the entry list — §23's card-view method
//     table entry `+0xF40` = 0x8009cf60) — resolve the slot's card and return
//     the record's colour/class byte.
//
// What the player sees. The board's hand rows are repainted from the duel's own
// card records, and — as each card is played — the slots the pending effect may
// legally hit light up. The lit set is exactly the slots the cursor will accept
// as targets, so the player sees which cards the effect can touch.
//
// Reused decoded explanations (navigation only; the assembly above decides):
//   - `[0x8005CCB0]` is the 50 Hz layout selector (player-hud.ts ROW_HZ_FLAG /
//     duel-effect-ops.ts DEAL_SLOT_RECORD_CELL); `D0x800A5958` is the 16-byte
//     row-layout record table it indexes (x0,y0 = the player row, x1,y1 = the
//     opponent row).
//   - The played stack record is `duel + slot*8 + 0x580` (duel-effect-commit.ts
//     DUEL_PLAYED_STACK): +0 id, +2 flag, +4 side, +5 filter class, +6 filter
//     byte. The near/far hand-row records are stride 0xE (DUEL_NEAR_RECORD
//     0x72E / DUEL_FAR_RECORD 0x74C) with the colour/class byte at +0xC.
//   - The mark arms are the view-slot twin of markLegalFieldTargets
//     (duel-effect-commit.ts): same filter classes, same view-classification
//     dispatch (view+0xF40), written onto the view slot record's +0x146 byte
//     instead of the duel's hand-mark bytes.

import { CURRENT_VIEW_CELL } from "../globals.ts";
import { constructCardView, resolveCardRecord, type CardViewHost } from "./card-view.ts";

export interface FieldRefreshMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The board-view method slots the refresh dispatches through. */
export interface FieldRefreshHost {
    /** `view+0xF14(view, index, x, y)` = F0x8009C510: place a slot, full size. */
    positionSlot(view: number, index: number, x: number, y: number): void;
    /** `view+0xF3C(view, index, value)` = F0x8009CFBC: the slot shows a card. */
    writeSlotValue(view: number, index: number, value: number): void;
    /** `view+0xF40(view, cardId)` = F0x8009CF60: the slot's colour/class byte. */
    slotColour(view: number, cardId: number): number;
}

/** `D0x800A5958`: the 16-byte row-layout record table. */
export const BOARD_ROW_LAYOUT_TABLE = 0x800a5958;
/** `[0x8005CCB0]`: the 50 Hz layout selector the table is indexed by. */
export const BOARD_LAYOUT_SELECTOR = 0x8005ccb0;
/** The scene context's board-view pointer. */
export const BOARD_SCENE_VIEW = 0x18;

/** The board view's card-id table pointer (bindSlotToCard's own +0x50). */
export const BOARD_CARD_TABLE = 0x50;

/** The near/opponent hand-row per-slot record bases and stride. */
export const BOARD_NEAR_RECORD = 0x72e;
export const BOARD_FAR_RECORD = 0x74c;
export const BOARD_SLOT_RECORD_STRIDE = 0xe;
/** The player/opponent hand counts (u8) and the row stride between them. */
export const BOARD_ROW_COUNT = 0x72c;
export const BOARD_ROW_STRIDE = 0x72;
/** The hand-row card-position pitch and the played-row card pitch. */
export const BOARD_HAND_PITCH = 0x2900;
export const BOARD_PLAY_PITCH = 0x3200;
/** The played-row card's fixed y and its starting x. */
export const BOARD_PLAY_Y = 0x6100;
export const BOARD_PLAY_X0 = 0x5100;
/** The played-stack record base and stride (duel-effect-commit.ts DUEL_PLAYED_STACK). */
export const BOARD_PLAY_STACK = 0x580;
export const BOARD_PLAY_STRIDE = 8;
export const BOARD_PLAY = {
    id: 0x0,
    flag: 0x2,
    side: 0x4,
    kind: 0x5,
    filter: 0x6,
} as const;
/** The played-card count (s8) and the browse flag (u8) the refresh reads/clears. */
export const BOARD_PLAY_COUNT = 0x575;
export const BOARD_REFRESH_FLAG = 0x49c;
/** The view slot record stride and the first played-row slot (0xC). */
export const BOARD_SLOT_STRIDE = 0x4c;
export const BOARD_CENTRE_SLOT = 0xc;
/** The hand-slot fields the two hand loops write (relative to a slot record). */
export const BOARD_SLOT_FIELD = {
    /** The two printed card numbers (u8), overridden from the duel record. */
    numA: 0x14b,
    numB: 0x14c,
    /** The scale accumulator the loops clear (u16). */
    scale: 0x120,
    /** The browse flag sets this to 2 on opponent slots. */
    flag: 0x14d,
} as const;
/** The played-slot fields the play loop writes (relative to a slot record). */
export const BOARD_PLAY_SLOT_FIELD = {
    scale: 0x120,
    /** The card's ordinal in the played row ((index+1) & 0xff). */
    ordinal: 0x14e,
    /** The scaled tick flag the loop clears (u16). */
    tick: 0x12e,
    /** The match/highlight bytes the play loop clears, then lights. */
    mark: 0x146,
    mark2: 0x147,
    mark3: 0x148,
} as const;

/** The view-classification arms' four target results (classes 4..8). */
export const BOARD_CLASS_TARGET: readonly number[] = [1, 2, 3, 4, 6];

/**
 * F0x8009E024(duel, scene): rebuild both hand rows and the played row.
 *
 * Hand rows: for each of the six player slots and six opponent slots inside its
 * row count, place the slot from the row-layout record (x = record x + slot
 * pitch, y = record y), bind it to the hand card, then copy the two printed
 * numbers from the duel's per-slot record and clear the scale. The opponent
 * slots additionally take the browse flag: when `duel+0x49C` is set, the slot is
 * marked (record +0x14D = 2).
 *
 * Played row: `duel+0x575` cards. Each is placed at its slot (0xC+index) and
 * bound, gets its ordinal and cleared mark/tick bytes; a nonzero per-record flag
 * lights its own mark byte; then the row walk dispatches on the record's filter
 * class (duel + index*8 + 0x585) exactly as markLegalFieldTargets does, writing
 * the matching hand/board slots' mark byte. The walk ends by clearing the browse
 * flag.
 */
export function refreshFieldCardViews(
    mem: FieldRefreshMemory,
    host: FieldRefreshHost,
    duel: number,
    scene: number,
): void {
    const view = mem.read32(scene + BOARD_SCENE_VIEW) | 0;
    const layout = BOARD_ROW_LAYOUT_TABLE + ((mem.read32(BOARD_LAYOUT_SELECTOR) | 0) << 4);
    const playerX = mem.read32(layout + 0x0) | 0;
    const playerY = mem.read32(layout + 0x4) | 0;
    const opponentX = mem.read32(layout + 0x8) | 0;
    const opponentY = mem.read32(layout + 0xc) | 0;

    for (let i = 0; i < 6 && i < (mem.read8(duel + BOARD_ROW_COUNT) & 0xff); i++) {
        host.positionSlot(view, i, (playerX + Math.imul(i, BOARD_HAND_PITCH)) | 0, playerY);
        host.writeSlotValue(view, i, mem.read16s(duel + i * BOARD_SLOT_RECORD_STRIDE + BOARD_NEAR_RECORD) | 0);
        const r = view + i * BOARD_SLOT_STRIDE;
        mem.write8(r + BOARD_SLOT_FIELD.numA, mem.read8(duel + i * BOARD_SLOT_RECORD_STRIDE + 0x734) & 0xff);
        mem.write8(r + BOARD_SLOT_FIELD.numB, mem.read8(duel + i * BOARD_SLOT_RECORD_STRIDE + 0x736) & 0xff);
        mem.write16(r + BOARD_SLOT_FIELD.scale, 0);
    }

    for (let i = 0; i < 6 && i < (mem.read8(duel + BOARD_ROW_STRIDE + BOARD_ROW_COUNT) & 0xff); i++) {
        host.positionSlot(view, i + 6, (opponentX + Math.imul(i, BOARD_HAND_PITCH)) | 0, opponentY);
        host.writeSlotValue(view, i + 6, mem.read16s(duel + i * BOARD_SLOT_RECORD_STRIDE + 0x7a0) | 0);
        const r = view + (i + 6) * BOARD_SLOT_STRIDE;
        mem.write8(r + BOARD_SLOT_FIELD.numA, mem.read8(duel + i * BOARD_SLOT_RECORD_STRIDE + 0x7a6) & 0xff);
        mem.write16(r + BOARD_SLOT_FIELD.scale, 0);
        mem.write8(r + BOARD_SLOT_FIELD.numB, mem.read8(duel + i * BOARD_SLOT_RECORD_STRIDE + 0x7a8) & 0xff);
        if ((mem.read8(duel + BOARD_REFRESH_FLAG) & 0xff) !== 0) mem.write8(r + BOARD_SLOT_FIELD.flag, 2);
    }

    // The `blez`'s delay slot clears the browse flag regardless of the count.
    const playCount = mem.read8s(duel + BOARD_PLAY_COUNT) | 0;
    mem.write8(duel + BOARD_REFRESH_FLAG, 0);
    if (playCount <= 0) return;

    for (let i = 0; i < playCount; i++) {
        const slot = i + BOARD_CENTRE_SLOT;
        host.positionSlot(view, slot, (BOARD_PLAY_X0 + Math.imul(i, BOARD_PLAY_PITCH)) | 0, BOARD_PLAY_Y);
        host.writeSlotValue(view, slot, mem.read16s(duel + i * BOARD_PLAY_STRIDE + BOARD_PLAY_STACK + BOARD_PLAY.id) | 0);
        const r = view + slot * BOARD_SLOT_STRIDE;
        mem.write16(r + BOARD_PLAY_SLOT_FIELD.scale, 0);
        mem.write8(r + BOARD_PLAY_SLOT_FIELD.ordinal, (i + 1) & 0xff);
        mem.write8(r + BOARD_PLAY_SLOT_FIELD.mark, 0);
        mem.write8(r + BOARD_PLAY_SLOT_FIELD.mark2, 0);
        mem.write8(r + BOARD_PLAY_SLOT_FIELD.mark3, 0);
        mem.write16(r + BOARD_PLAY_SLOT_FIELD.tick, 0);
        const rec = duel + i * BOARD_PLAY_STRIDE + BOARD_PLAY_STACK;
        // The `beqz`'s delay slot (`addu $v0, $v0, $t0`) folds the record's +2
        // flag value into the address, so the mark lands at 0x146 + flag, not
        // 0x146 (a real original quirk, reproduced here).
        const flag = mem.read16s(rec + BOARD_PLAY.flag) | 0;
        if (flag !== 0) mem.write8(r + BOARD_PLAY_SLOT_FIELD.mark + flag, 1);
        const kind = mem.read8(rec + BOARD_PLAY.kind) & 0xff;
        // The jump table's index 9 and everything above it land on the shared
        // tail (no arm), so only classes 0..8 mark anything.
        if (kind < 9) applyRefreshArm(mem, host, duel, view, i, kind);
    }
}

/** One played card's mark arm, keyed by the record's filter class (kind). */
function applyRefreshArm(
    mem: FieldRefreshMemory,
    host: FieldRefreshHost,
    duel: number,
    view: number,
    index: number,
    kind: number,
): void {
    // The played record's filter/side bytes drive the class-0/1/2 arms.
    const rec = duel + index * BOARD_PLAY_STRIDE + BOARD_PLAY_STACK;
    const activeFilter = mem.read8(rec + BOARD_PLAY.filter) & 0xff;
    const activeSide = mem.read8(rec + BOARD_PLAY.side) & 0xff;

    if (kind === 0) {
        // A hand slot whose colour/class byte (+0xC of its record) equals the
        // played card's filter byte.
        for (let s0 = 0; s0 < 12; s0++) {
            let slotRec;
            if (s0 < 6) {
                if (!(s0 < (mem.read8(duel + BOARD_ROW_COUNT) & 0xff))) continue;
                slotRec = duel + BOARD_NEAR_RECORD + s0 * BOARD_SLOT_RECORD_STRIDE;
            } else {
                if (!((s0 - 6) < (mem.read8(duel + BOARD_ROW_STRIDE + BOARD_ROW_COUNT) & 0xff))) continue;
                slotRec = duel + BOARD_FAR_RECORD + s0 * BOARD_SLOT_RECORD_STRIDE;
            }
            if ((mem.read8(slotRec + 0xc) & 0xff) === activeFilter) {
                mem.write8(view + index + s0 * BOARD_SLOT_STRIDE + BOARD_PLAY_SLOT_FIELD.mark, 1);
            }
        }
        return;
    }

    if (kind === 1 || kind === 2) {
        // All six slots of one hand row: kind 1 lights the far row (side byte
        // nonzero), kind 2 the near row — the same side byte 0x584 selects.
        const far = kind === 1 ? activeSide !== 0 : activeSide === 0;
        const base = view + (far ? 6 : 0) * BOARD_SLOT_STRIDE + 0x108 + index;
        for (let s0 = 0; s0 < 6; s0++) mem.write8(base + s0 * BOARD_SLOT_STRIDE + 0x3e, 1);
        return;
    }

    if (kind === 3) {
        for (let s0 = 0; s0 < 12; s0++) {
            mem.write8(view + index + s0 * BOARD_SLOT_STRIDE + BOARD_PLAY_SLOT_FIELD.mark, 1);
        }
        return;
    }

    // Classes 4..8: ask the board view what kind of card each slot holds, then
    // compare against the class's target result.
    const target = BOARD_CLASS_TARGET[kind - 4] as number;
    const negate = kind === 4 || kind === 5 || kind === 7;
    for (let s0 = 0; s0 < 12; s0++) {
        const cardId = s0 < 6
            ? mem.read16s(duel + BOARD_NEAR_RECORD + s0 * BOARD_SLOT_RECORD_STRIDE) | 0
            : mem.read16s(duel + 0x7a0 + (s0 - 6) * BOARD_SLOT_RECORD_STRIDE) | 0;
        const result = host.slotColour(view, cardId) | 0;
        const mark = negate ? result !== target : result === target;
        if (mark) mem.write8(view + index + s0 * BOARD_SLOT_STRIDE + BOARD_PLAY_SLOT_FIELD.mark, 1);
    }
}

/**
 * F0x8009CF60(view, cardId) — view+0xF40 `field_slot_colour`: resolve the slot's
 * card off the view's own card table (the id is made 1-based) and return the
 * card record's colour/class byte (record +0x00). The construction and record
 * resolution are the resident card-view class's own (card-view.ts).
 */
export function fieldSlotColour(
    mem: FieldRefreshMemory,
    cardHost: CardViewHost,
    scratch: number,
    view: number,
    cardId: number,
): number {
    constructCardView(mem, scratch);
    const table = mem.read32(view + BOARD_CARD_TABLE) | 0;
    const id = (mem.read16s(table + cardId * 2) + 1) | 0;
    resolveCardRecord(mem, cardHost, id);
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const record = mem.read32(ctx) | 0;
    return mem.read8(record) & 0xff;
}
