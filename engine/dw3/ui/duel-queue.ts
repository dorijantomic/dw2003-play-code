// The duel tick's two announce/flag queue services, translated from pro/cardgame:
//   F0x8009E62C applyQueuedGreyFlags — fan the queued grey-flags byte across the
//                                     view-queue state block
//   F0x8009E560 runQueuedAnnounce    — spawn the queued screen-wash object and
//                                     start its ramp
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-queue-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x8009e62c @.L0x0001b97c, F0x8009e560 @.L0x0001b8b0.
// Existing contract reused: `cardgame-announcement-spawn-from-table-800a5d14`
// (candidate) names the announce table.
//
// Both are the first two calls of cardDuelTick (already ported): the tick passes
// (duel, scene) and the flag service reads only the duel. The announce service
// builds a fade-wash task through the creator and the two method slots already
// ported in engine/dw3/ui/fade-wash.ts, so those are called directly - exactly
// what the original does through the object's own slots +0x68/+0x6C.

import {
    createFadeWash,
    fadeWashSetColours,
    fadeWashStart,
    type FadeWashCreateHost,
} from "./fade-wash.ts";

export interface DuelQueueMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export type DuelQueueHost = FadeWashCreateHost;

/** The queued grey-flags byte (u8); its state block starts at +0x49D. */
export const QUEUE_GREY_FLAGS = 0x49d;
/** The block the flags fan out over: +0x49E .. +0x4AC inclusive (15 bytes). */
export const QUEUE_GREY_BLOCK = 0x49e;
export const QUEUE_GREY_COUNT = 15;
/** The queued announce kind (u8). */
export const QUEUE_ANNOUNCE = 0x306;
/** The announce table: four-byte records, byte 3 is the fade kind. */
export const QUEUE_ANNOUNCE_TABLE = 0x800a5d14;
/** The announce object slot on the scene/view context. */
export const QUEUE_ANNOUNCE_SLOT = 0x4;
/** The two ramp lengths: the kind-2 records hold 15 frames, everything else 10. */
export const QUEUE_ANNOUNCE_FRAMES = 0xa;
export const QUEUE_ANNOUNCE_FRAMES_HOLD = 0xf;
export const QUEUE_ANNOUNCE_HOLD_KIND = 2;

/**
 * F0x8009E62C(duel): when a grey-flags value is queued, write `1` into all 15
 * bytes of the state block when it is 2 and `0` otherwise, then clear the queue
 * byte. The original walks the block backwards from +0x4AC; the writes are
 * independent, so the port keeps the same values and extent.
 */
export function applyQueuedGreyFlags(mem: DuelQueueMemory, duel: number): void {
    const queued = mem.read8(duel + QUEUE_GREY_FLAGS) & 0xff;
    if (queued === 0) return;
    const value = queued === 2 ? 1 : 0;
    for (let i = 0; i < QUEUE_GREY_COUNT; i++) mem.write8(duel + QUEUE_GREY_BLOCK + i, value);
    mem.write8(duel + QUEUE_GREY_FLAGS, 0);
}

/**
 * F0x8009E560(duel, ctx): when an announce kind is queued, read its four-byte
 * record, build the fade-wash task with the record's kind byte as its mode,
 * store it at ctx+4, set its colour from the record's first three bytes, start
 * the ramp to black over 15 frames for a kind-2 record or 10 otherwise (hold
 * set), then clear the queue byte.
 */
export function runQueuedAnnounce(
    mem: DuelQueueMemory,
    host: DuelQueueHost,
    duel: number,
    ctx: number,
): void {
    const kind = mem.read8(duel + QUEUE_ANNOUNCE) & 0xff;
    if (kind === 0) return;
    const record = ((kind - 1) * 4 + QUEUE_ANNOUNCE_TABLE) >>> 0;
    const mode = mem.read8(record + 3) & 0xff;
    const obj = createFadeWash(mem, host, mode);
    mem.write32(ctx + QUEUE_ANNOUNCE_SLOT, obj);
    fadeWashSetColours(mem, obj, mem.read8(record) & 0xff, mem.read8(record + 1) & 0xff, mem.read8(record + 2) & 0xff);
    const frames = mode === QUEUE_ANNOUNCE_HOLD_KIND ? QUEUE_ANNOUNCE_FRAMES_HOLD : QUEUE_ANNOUNCE_FRAMES;
    fadeWashStart(mem, obj, 0, 0, 0, frames, 1);
    mem.write8(duel + QUEUE_ANNOUNCE, 0);
}
