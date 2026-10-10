// The duel's effect-layer picker helpers, translated from pro/cardgame. The
// effect VM's opcode 0x98 opens the player's own field picker; its enter arm and
// the two "is this hand card usable" predicates it (and the other pickers) call
// are here. Read from the overlay ASSEMBLY (exe-decomp/cardgame.norm.s), never
// the m2c C.
//
//   F0x80086330 effectOp98OpenOwnFieldPicker @.L0x00003680 (cardgame.norm.s 4116)
//   F0x80085FD0 handUsableCheck               @.L0x00003320
//   F0x80085F38 cardUsableKind                @.L0x00003288
//
// What the player sees. When a Card effect makes you choose one of your own
// hand cards, the two half-panels slide in, the picker's cursor arms on your
// hand, and the field waits for you to confirm. If no hand card can pay the
// effect, the field stores a different "nothing to pick" state so the effect
// resolves immediately instead of stalling.
//
// The two predicates answer "can this hand card pay the effect": cardUsableKind
// resolves the card's own record kind word and checks it against the duel's
// mode byte; handUsableCheck is the mode-6 special case that compares the
// card's energy byte against the effect's cost parameter.

import { CURRENT_VIEW_CELL } from "../globals.ts";
import { constructCardView, resolveCardRecord, currentViewTableWord, type CardViewHost } from "./card-view.ts";

export interface PickerMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The board-view method the opcode-0x98 enter reaches. */
export interface OwnFieldPickerHost {
    /** `view+0xEC8(view)` = F0x8009C2D0: slide both half-panels in. */
    slidePanelsIn(view: number): void;
    /** F0x80085FD0(duel, param, cardId): can this hand card pay the effect? */
    handUsable(duel: number, param: number, cardId: number): number;
}

/** The duel's mode byte and the near hand's count/array/param block. */
export const DUEL_MODE_BYTE = 0x2f8;
export const DUEL_HAND_COUNT = 0x5a6;
export const DUEL_HAND_ARRAY = 0x600;
export const DUEL_PARAM = 0x5a8;
/** The duel's card-id table entry array (indexed by a hand card's id). */
export const DUEL_CARD_TABLE = 0x50;
/** The record-kind byte that marks a Digimon (kind 0x10). */
export const CARD_RECORD_DIGIMON = 0x10;
/** The picker's view fields and the duel's picker state fields. */
export const PICKER_VIEW_FLAG = 0xdf4;
export const PICKER_VIEW_ARG = 0xde8;
export const PICKER_VIEW_ZERO = 0xde4;
export const DUEL_PICKER_STATE = 0x438;
export const DUEL_PICKER_CANCEL = 0x440;
export const DUEL_QUEUE_FLAG_A = 0x49d;
export const DUEL_QUEUE_FLAG_B = 0x499;
export const DUEL_TIMER = 0x424;
export const DUEL_TICK_STATE = 0x422;

/**
 * F0x80085F38(duel, cardId): resolve the hand card's record and return 1 when
 * the duel may act on it. The record's kind word (the card-view class's +0x50
 * slot) must be nonzero; then a mode-7 duel accepts anything nonzero, and a
 * mode-5 duel accepts only kind 2. Every other mode returns 0.
 */
export function cardUsableKind(
    mem: PickerMemory, cardHost: CardViewHost, scratch: number, duel: number, cardId: number,
): number {
    constructCardView(mem, scratch);
    const id = (mem.read16s(duel + DUEL_CARD_TABLE + cardId * 2) + 1) | 0;
    resolveCardRecord(mem, cardHost, id);
    const kind = currentViewTableWord(mem) | 0;
    if (kind === 0) return 0;
    const mode = mem.read8(duel + DUEL_MODE_BYTE) & 0xff;
    if (mode === 7) return 1;
    if (mode !== 5) return 0;
    return kind === 2 ? 1 : 0;
}

/**
 * F0x80085FD0(duel, param, cardId): the picker's "can this card pay it" test.
 * Outside mode 6 it defers to cardUsableKind. In mode 6 the record must be a
 * Digimon (its +0x03 byte 0x10); then the effect's cost byte at the record's
 * +0x05 must not exceed the card's energy byte read from the duel's parameter
 * block at `param + record[0] - 1`, and the predicate is true when it does not.
 */
export function handUsableCheck(
    mem: PickerMemory, cardHost: CardViewHost, scratch: number, duel: number, param: number, cardId: number,
): number {
    if ((mem.read8(duel + DUEL_MODE_BYTE) & 0xff) !== 6) {
        return cardUsableKind(mem, cardHost, scratch, duel, cardId);
    }
    constructCardView(mem, scratch);
    const id = (mem.read16s(duel + DUEL_CARD_TABLE + cardId * 2) + 1) | 0;
    resolveCardRecord(mem, cardHost, id);
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const record = mem.read32(ctx) | 0;
    if ((mem.read8(record + 0x3) & 0xff) !== CARD_RECORD_DIGIMON) return 0;
    const energy = mem.read8(param + (mem.read8(record + 0x0) & 0xff) - 1) & 0xff;
    const cost = mem.read8(record + 0x5) & 0xff;
    return energy < cost ? 0 : 1;
}

/**
 * F0x80086330(duel, view, arg): open the player's own-field picker. Clears two
 * duel fields, slides the panels in when the board's slide flag is still clear,
 * seeds the picker state and the view's picker argument, then scans the near
 * hand: the first card `handUsable` accepts stores the "something to pick"
 * state (2); if none does, the "nothing to pick" state (3) is stored instead.
 */
export function effectOp98OpenOwnFieldPicker(
    mem: PickerMemory, host: OwnFieldPickerHost, duel: number, view: number, arg: number,
): void {
    mem.write32(duel + DUEL_PICKER_CANCEL, 0);
    mem.write8(duel + DUEL_TICK_STATE, 0);
    if ((mem.read16s(view + 0x64) | 0) === 0) {
        mem.write8(duel + DUEL_QUEUE_FLAG_A, 1);
        mem.write8(duel + DUEL_QUEUE_FLAG_B, 1);
        host.slidePanelsIn(view);
    }
    mem.write32(duel + DUEL_TIMER, 0);
    mem.write32(view + PICKER_VIEW_ARG, arg | 0);
    mem.write32(view + PICKER_VIEW_ZERO, 0);

    let found = false;
    const count = mem.read16s(duel + DUEL_HAND_COUNT) | 0;
    for (let i = 0; i < count; i++) {
        const cardId = mem.read16s(duel + DUEL_HAND_ARRAY + i * 2) | 0;
        if ((host.handUsable(duel, duel + DUEL_PARAM, cardId) | 0) !== 0) {
            found = true;
            break;
        }
    }
    if (found) {
        mem.write16(view + PICKER_VIEW_FLAG, 0);
        mem.write32(duel + DUEL_PICKER_CANCEL, 0);
        mem.write32(duel + DUEL_PICKER_STATE, 2);
    } else {
        mem.write16(view + PICKER_VIEW_FLAG, 1);
        mem.write32(duel + DUEL_PICKER_CANCEL, 1);
        mem.write32(duel + DUEL_PICKER_STATE, 3);
    }
}
