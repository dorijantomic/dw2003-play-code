// The "repeat a callback on a delay" family, translated from the original
// overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/repeat-callback-oracle.test.js runs both original addresses
// through engine/native and compares the field writes and the ordered calls.
//
//   pro/stcrdabm:F0x80083780  repeatCallbackWithDelay_stcrdabm (album grid)
//   pro/stcrdshp:F0x80085cd8  repeatCallbackWithDelay_stcrdshp (exact copy)
//
// The body dispatches on obj+0x10:
//   1, counter obj+0x64 != 0 -> decrement the counter, call obj->+0x3C(obj),
//                               then stamp obj+0x18 with the free-running tick.
//   1, counter == 0          -> obj+0x0C = 3 (move the grid on; no stamp).
//   2                        -> when now - obj+0x18 >= 2, obj+0x10 = 1.
//   0 and everything else    -> returns having written nothing.
// Every write is inside its branch; the two state-1 calls are ordered.

export interface RepeatCallbackMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface RepeatCallbackHost {
    /** obj->0x3C(obj): the object's own redraw/step method. */
    callSlot3C(obj: number): void;
    /** [0x8004DF98](): the free-running tick word (F0x8001D6F4). */
    now(): number;
}

export const REPEAT_CALLBACK_FIELDS = {
    state: 0x10,
    stamp: 0x18,
    next: 0x0c,
    counter: 0x64,
} as const;

/** Delay in tick words the state-2 wait compares against (the original slti 2). */
export const REPEAT_CALLBACK_DELAY = 2;

/** F0x80083780 / F0x80085CD8: one step of the repeat-with-delay pace. */
export function repeatCallbackWithDelay(
    mem: RepeatCallbackMemory,
    obj: number,
    host: RepeatCallbackHost,
): void {
    const state = mem.read32(obj + REPEAT_CALLBACK_FIELDS.state) | 0;

    if (state === 1) {
        const counter = mem.read32(obj + REPEAT_CALLBACK_FIELDS.counter) | 0;
        if (counter !== 0) {
            mem.write32(obj + REPEAT_CALLBACK_FIELDS.counter, (counter - 1) | 0);
            host.callSlot3C(obj);
            mem.write32(obj + REPEAT_CALLBACK_FIELDS.stamp, host.now() >>> 0);
        } else {
            mem.write32(obj + REPEAT_CALLBACK_FIELDS.next, 3);
        }
        return;
    }

    if (state === 2) {
        const stamp = mem.read32(obj + REPEAT_CALLBACK_FIELDS.stamp) | 0;
        // The original computes `subu v0, now - stamp` then `slti v0, 2`, so the
        // comparison is signed over the difference.
        if (((host.now() | 0) - stamp) >= REPEAT_CALLBACK_DELAY) {
            mem.write32(obj + REPEAT_CALLBACK_FIELDS.state, 1);
        }
    }
}
