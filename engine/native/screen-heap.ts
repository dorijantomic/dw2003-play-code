// The screen runtime's allocation services, as TypeScript.
//
// Two console allocators are in play on a screen, and a bridged port must
// borrow the same one its original body used:
//
//   1. The object factory. F0x80014504/F0x800143dc (the pair every widget/task
//      creator calls) is a core stub on this runtime (engine/native/stubs.ts
//      `StubWorld.alloc`): it carves zeroed memory from the object heap at
//      0x800b0000, writes the default state-machine table +0x28..+0x4C with the
//      caller's handler at +0x48, and registers the object so the screen tick
//      walk reaches it. `allocObject` and `carve` are that allocator.
//   2. The buffer arena. The low-level allocator F0x80017d2c is stubbed to a
//      bump arena over [HEAP_BASE, HEAP_LIMIT) (ScreenHeap); `alloc`/`free` are
//      that one (widget line buffers, resource buffers).
//
// Ports whose host interface says `alloc(size, align)` allocate objects through
// the factory and buffers through the arena; the bridge entry declares which by
// the host adapter it passes. The differential gate proves the mapping over the
// whole run.

import type { NativeMemory } from "./memory.ts";

export const HEAP_BASE = 0x80100000;
// The console heap's payload ends at its terminal sentinel (0x801FEFF4: the
// shipped block list, accepted allocator-family-contract). The buffer arena is
// a stand-in over the same span's upper part, and it must NOT wrap inside a
// session: the old 0x8017F000 limit wrapped after ~0x7F000 bytes and handed a
// live file-cache buffer out again, zeroing it (turn 258's trace: the write
// into CARDPAK0's slot buffer came from the alloc stub at 0x80017D2C with
// ra=0x80017EB4). Ending at the console's own sentinel keeps every shipped
// root's allocations clear of the cache buffers the screens read back.
export const HEAP_LIMIT = 0x801feff4;

/** Host contract the translated allocating ports consume. */
export interface HeapServices {
    /** Screen buffer arena (F0x80017d2c): `size` zeroed bytes. */
    alloc(size: number, align?: number): number;
    /** Console free is a no-op for a screen's buffers. */
    free(ptr: number): void;
    /** The same synchronous bank-transfer adapter used by the native cache. */
    startTransfer?(id: number, buffer: number): void;
    /** Same packed-sound boundary used by the screen's original calls. */
    playPackedSound?(id: number): void;
    /** Object-heap carve: `size` zeroed bytes, no table and no registration. */
    carve(size: number): number;
    /** The widget/task factory with its table and object registration. */
    allocObject(cb: number, size: number, extraSize: number, id: number): number;
}

export class ScreenHeap {
    private readonly mem: NativeMemory;
    private readonly base: number;
    private readonly limit: number;
    private next: number;

    constructor(mem: NativeMemory, base: number = HEAP_BASE, limit: number = HEAP_LIMIT) {
        this.mem = mem;
        this.base = base >>> 0;
        this.limit = limit >>> 0;
        this.next = this.base;
    }

    /** The low-level allocator stubbed at F0x80017D2C. */
    allocLowLevel(size: number): number {
        const bytes = (((size >>> 0) + 0xf) & ~0xf) >>> 0;
        if (this.next + bytes > this.limit) this.next = this.base;
        const p = this.next;
        this.next = (p + bytes) >>> 0;
        for (let a = p; a < p + bytes; a += 4) this.mem.write32(a, 0);
        return p | 0;
    }

    /** The port-facing allocation; the arena is already suitably aligned. */
    alloc(size: number, align?: number): number {
        void align;
        return this.allocLowLevel(size);
    }

    free(_ptr: number): void {
        // Buffers live until the screen closes (console free is a no-op here).
    }
}
