// The duel object's constructor, translated from pro/cardgame:
//   F0x800A3240 createCardDuel — the factory object plus its five method slots
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-create-oracle.test.js runs the original through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the factory
// and the audio-archive device boundaries stubbed on both sides.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s @.L0x00020590.
//   v0 = F0x80014504(0x800A2F00, 0x824, 0x1C)   [the scene handler, size, extra]
//   [obj+0x810] = 0x8009F04C   [obj+0x814] = 0x8009EEFC
//   [obj+0x818] = 0x800A0754   [obj+0x81C] = 0x800A0708
//   [obj+0x820] = 0x800A3934
//   [obj+0x2E8] = a0 (byte)
//   [0x80055C54]() with a0 = 0x27   -> F0x80020574 ensureSoundArchiveLoaded
//   return the object
// Existing contract reused: `cardduel-object-is-0x824-with-five-methods`
// (verified). The last call reaches the already-ported audio-archive request
// pair, so the port calls that module directly rather than through a host slot;
// the resident data pointer 0x80055C54 holds 0x80020574 in the shipped image.

import { ensureSoundArchiveLoaded, type AudioArchiveHost } from "../audio-archive.ts";

export interface DuelCreateMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface DuelCreateHost extends AudioArchiveHost {
    /** F0x80014504(handler, size, extra) -> the new duel object. */
    allocate(handler: number, size: number, extra: number): number;
}

/** The scene handler the factory installs as the duel's callback. */
export const DUEL_SCENE_HANDLER = 0x800a2f00;
/** The factory's size and extra-block arguments. */
export const DUEL_OBJECT_SIZE = 0x824;
export const DUEL_OBJECT_EXTRA = 0x1c;
/** The five method-slot pointers, exactly the addresses the original stores. */
export const DUEL_METHOD_810 = 0x8009f04c;
export const DUEL_METHOD_814 = 0x8009eefc;
export const DUEL_METHOD_818 = 0x800a0754;
export const DUEL_METHOD_81C = 0x800a0708;
export const DUEL_METHOD_820 = 0x800a3934;
/** The slot bytes the five pointers occupy. */
export const DUEL_METHOD_SLOTS: readonly (readonly [number, number])[] = [
    [0x810, DUEL_METHOD_810], [0x814, DUEL_METHOD_814], [0x818, DUEL_METHOD_818],
    [0x81c, DUEL_METHOD_81C], [0x820, DUEL_METHOD_820],
];
/** The byte the caller stores (the duel's own selector). */
export const DUEL_SELECTOR = 0x2e8;
/** The archive the constructor requests through F0x80020574. */
export const DUEL_START_ARCHIVE = 0x27;
/** The resident data pointer the original calls through. */
export const DUEL_START_ARCHIVE_PTR = 0x80055c54;

/**
 * F0x800A3240(selector): build the 0x824-byte duel object, install the five
 * method pointers in order, store the selector byte and request the duel's
 * start archive. Returns the object.
 */
export function createCardDuel(mem: DuelCreateMemory, host: DuelCreateHost, selector: number): number {
    const obj = host.allocate(DUEL_SCENE_HANDLER, DUEL_OBJECT_SIZE, DUEL_OBJECT_EXTRA) >>> 0;
    for (const [offset, target] of DUEL_METHOD_SLOTS) mem.write32(obj + offset, target);
    mem.write8(obj + DUEL_SELECTOR, selector & 0xff);
    ensureSoundArchiveLoaded(mem, host, DUEL_START_ARCHIVE);
    return obj;
}
