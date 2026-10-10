// The resident display service object (D0x8004DE10), translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/display-service-oracle.test.js runs the original addresses
// through engine/native and compares the service fields.
//
// DECODED: F0x8001D714 resetDisplayService and F0x8001D7C4
// setDisplayPacketIndex, from fns.norm.s and the accepted display-service
// answer. The service is a fixed global object: +0x20 the current packet
// cursor, +0x24/+0x28 the two packet buffers, +0x2C their size, +0x30/+0x34 the
// init/double-buffer words, +0x60+0x4*i the thirty view slots (each view's
// +0xD8 is the handle the release method frees), +0x170 the release method.

import { zeroFill } from "./zero-fill.ts";
import { setDefDispEnv, setDefDrawEnv } from "./psx-env.ts";
import { BOOT_GP } from "./ui/text-element-setters.ts";

const s16 = (v: number): number => (v << 16) >> 16;

export interface DisplayServiceMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write8(addr: number, value: number): void;
}

export interface DisplayServiceHost {
    /** [service+0x170](handle): release a registered view. */
    releaseView(handle: number): void;
    /** [D0x8004B5DC+0x1C](size, tag): the heap allocator. */
    alloc(size: number, tag: number): number;
}

/** The service object's base address. */
export const DISPLAY_SERVICE = 0x8004de10;
/** `[gp+0x190]`: 1 once the service has been initialised. */
export const DISPLAY_SERVICE_INIT_FLAG = (BOOT_GP + 0x190) >>> 0;
export const DISPLAY_SERVICE_FIELDS = {
    packet: 0x20,
    packetA: 0x24,
    packetB: 0x28,
    packetSize: 0x2c,
    init30: 0x30,
    packetIndex: 0x34,
    viewBase: 0x60,
    viewCount: 0x1e,
    viewHandle: 0xd8,
    releaseMethod: 0x170,
} as const;

/**
 * F0x8001D714: first call marks the service initialised (+0x34 = 1, +0x30 = 0);
 * later calls release every registered view (the original retries the same slot
 * until the release clears its +0x60) and zero the 0x18-byte packet header.
 */
export function resetDisplayService(mem: DisplayServiceMemory, host: DisplayServiceHost): void {
    if ((mem.read32(DISPLAY_SERVICE_INIT_FLAG) | 0) === 0) {
        mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packetIndex, 1);
        mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.init30, 0);
        mem.write32(DISPLAY_SERVICE_INIT_FLAG, 1);
        return;
    }
    let i = 0;
    while (i < DISPLAY_SERVICE_FIELDS.viewCount) {
        const slot = DISPLAY_SERVICE + i * 4;
        if ((mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) | 0) !== 0) {
            host.releaseView(mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewHandle) >>> 0);
            // The original decrements i in the call's delay slot and increments
            // it after: the same slot is retried until the release clears it.
        } else {
            i += 1;
        }
    }
    zeroFill(mem, DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packet, 0x18);
}

/**
 * F0x8001D7C4(index): stores the packet size at +0x2C, allocates the two
 * packet buffers (+0x24, +0x28) and points the cursor +0x20 at the one the
 * double-buffer word +0x34 selects.
 */
export function setDisplayPacketIndex(
    mem: DisplayServiceMemory,
    host: DisplayServiceHost,
    index: number,
): void {
    const size = index | 0;
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packetSize, size);
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packetA, host.alloc(size >>> 0, 2) | 0);
    mem.write32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packetB, host.alloc(size >>> 0, 2) | 0);
    const which = mem.read32(DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packetIndex) | 0;
    mem.write32(
        DISPLAY_SERVICE + DISPLAY_SERVICE_FIELDS.packet,
        mem.read32(DISPLAY_SERVICE + which * 4 + DISPLAY_SERVICE_FIELDS.packetA) | 0,
    );
}

/**
 * F0x8001DAD0(key): walks the thirty view slots. With key 0 it returns the index
 * of the first slot whose +0x60 is clear (the free slot); with a non-zero key it
 * returns the index whose +0xD8 matches, or -1 when none does.
 */
export function findDisplayViewCell(mem: DisplayServiceMemory, key: number): number {
    const want = key | 0;
    for (let i = 0; i < DISPLAY_SERVICE_FIELDS.viewCount; i++) {
        const slot = DISPLAY_SERVICE + i * 4;
        const registered = mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) | 0;
        if (want === 0) {
            if (registered === 0) return i;
            continue;
        }
        if (registered !== 0 && (mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewHandle) | 0) === want) return i;
    }
    return -1;
}

/**
 * F0x8001DA84(key): the registered view whose handle matches `key`, or 0. The
 * body walks the same thirty slots: a slot whose +0x60 is clear is skipped, a
 * slot whose +0xD8 equals the key returns its +0x60 object.
 */
export function findRegisteredHandleByKey(mem: DisplayServiceMemory, key: number): number {
    const want = key | 0;
    for (let i = 0; i < DISPLAY_SERVICE_FIELDS.viewCount; i++) {
        const slot = DISPLAY_SERVICE + i * 4;
        const obj = mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) | 0;
        if (obj === 0) continue;
        if ((mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewHandle) | 0) === want) return obj;
    }
    return 0;
}

// ── the view constructor ────────────────────────────────────────────────────
//
// F0x8001E5BC initDisplayView(drawEnv, poolIndex): allocates the 0x16C-byte
// view, copies the caller's 0x5C-byte draw env into it, sizes the two
// double-buffered ordering tables from the D0x8004DFA0 pool table, clears them
// and installs the view's method table (the addresses are data, kept verbatim).

/** The zeroed allocator cell [0x8004B5FC] and the heap allocator [+0x18]. */
export const DISPLAY_ALLOC_ZEROED = 0x8004b5fc;
export const DISPLAY_HEAP_ALLOC = 0x8004b5dc + 0x18;
/** The per-pool OT size table F0x8001E5BC reads. */
export const VIEW_POOL_TABLE = 0x8004dfa0;
/** The allocated view size. */
export const VIEW_SIZE = 0x16c;
/** The bytes copied from the caller's draw env. */
export const VIEW_ENV_COPY = 0x5c;

/** The view's method table, exactly the addresses the original stores. */
export const VIEW_METHODS: readonly (readonly [number, number])[] = [
    [0x110, 0x8001e0b0], [0x114, 0x8001e0bc], [0x118, 0x8001e058], [0x11c, 0x8001e064],
    [0x120, 0x8001e088], [0x124, 0x8001e094], [0x128, 0x8001e0c8], [0x12c, 0x8001e028],
    [0x130, 0x8001de68], [0x134, 0x8001dda0], [0x138, 0x8001dfa8], [0x13c, 0x8001dfcc],
    [0x140, 0x8001dffc], [0x144, 0x8001e01c], [0x148, 0x8001e1e8], [0x14c, 0x8001e240],
    [0x150, 0x8001e324], [0x154, 0x8001e38c], [0x158, 0x8001e470], [0x15c, 0x8001e404],
    [0x160, 0x8001e55c], [0x164, 0x8001e4f4], [0x168, 0x8001e118],
];

export interface DisplayViewHost extends DisplayServiceHost {
    /** [D0x8004B5FC](size, tag): the zeroed allocator. */
    allocZeroed(size: number, tag: number): number;
    /** F0x80025D54(base, entries): the ordering-table clear. */
    clearOTag(base: number, entries: number): void;
}

/**
 * F0x8001E5BC(drawEnv, poolIndex): builds the view object. `drawEnv` is the
 * caller's 0x5C-byte source (the original's own stack struct); the port takes it
 * as a pointer so the caller controls it.
 */
export function initDisplayView(
    mem: DisplayServiceMemory,
    host: DisplayViewHost,
    drawEnv: number,
    poolIndex: number,
): number {
    const view = host.allocZeroed(VIEW_SIZE, 2) | 0;
    for (let i = 0; i < VIEW_ENV_COPY; i += 4) {
        mem.write32(view + i, mem.read32(drawEnv + i) | 0);
    }
    mem.write32(view + 0x68, poolIndex | 0);
    const entries = s16(mem.read16(VIEW_POOL_TABLE + (poolIndex - 1) * 2));
    mem.write32(view + 0x64, entries | 0);
    mem.write32(view + 0x5c, host.alloc((entries * 4) >>> 0, 2) | 0);
    mem.write32(view + 0x60, host.alloc((entries * 4) >>> 0, 2) | 0);
    host.clearOTag(mem.read32(view + 0x5c) >>> 0, entries | 0);
    host.clearOTag(mem.read32(view + 0x60) >>> 0, entries | 0);
    for (const [off, addr] of VIEW_METHODS) mem.write32(view + off, addr);
    return view;
}

// ── the display region and the view registry ────────────────────────────────
//
// F0x8001D8CC setDisplayRegion(a0, a1, a2, a3) rebuilds the display service's
// two Psy-Q DISPENV structs, sets `isinter`/`isrgb24` on the interlaced pair,
// and finishes with the GPU driver's 3D init and a (0, 0) geometry offset. The
// two tails are device calls: `GsInit3D` (F0x8002990C) writes the GPU driver's
// display-mode words and `setGeomOffset` (F0x8002B3EC) is a cop2 control
// write, both host-served boundaries here.

/** The service's first DISPENV (`D0x8004DE10 + 0x38`). */
export const DISP_ENV_A = DISPLAY_SERVICE + 0x38;
/** The service's second DISPENV (`DISP_ENV_A + 0x14`). */
export const DISP_ENV_B = DISP_ENV_A + 0x14;
/** `D0x8005CCB0`: nonzero makes both DISPENVs' screen Y 0x18. */
export const DISP_MODE_FLAG = 0x8005ccb0;
/** DISPENV screen-Y halfword offsets set when `DISP_MODE_FLAG` is nonzero. */
export const DISP_REGION_SCREEN_Y = [0x42, 0x56] as const;

export interface DisplayRegionHost {
    /** F0x8002990C GsInit3D(): the GPU driver's 3D initialisation (device). */
    gsInit3D(): void;
    /** F0x8002B3EC setGeomOffset(x, y): the GTE OFX/OFY write (device). */
    setGeomOffset(x: number, y: number): void;
}

/**
 * F0x8001D8CC(a0, a1, a2, a3): three shapes chosen by the last two arguments.
 * a2 != 0 and a3 != 0: the fixed 0x140x0x1E0 pair, interlaced, the second at
 * x = 0x1E0. a2 != 0 and a3 == 0: the pair sized a0 x a1, the second at
 * x = a0. a2 == 0: the pair sized a0 x a1, the second at y = 0x100.
 *
 * Note on the a3 == 0 arm: `exe-decomp/c/F0x8001d8cc.c` renders its base as
 * `&D0x8004de10 - 0x21B8`, which would land in the shipped RAND_TABLE. The
 * listing's `lui $s0, 0x8005` sits in the `beqz $a3` delay slot, so on that
 * path `addiu $s0, $s0, 0xDE48` (= -0x21B8 sign-extended) yields DISP_ENV_A;
 * the interpreter oracle pinned this against the decompiler (turn 257).
 */
export function setDisplayRegion(
    mem: DisplayServiceMemory,
    host: DisplayRegionHost,
    a0: number,
    a1: number,
    a2: number,
    a3: number,
): void {
    if ((a2 | 0) !== 0) {
        if ((a3 | 0) !== 0) {
            setDefDispEnv(mem, DISP_ENV_A, 0, 0, 0x140, 0x1e0);
            mem.write8(DISP_ENV_A + 0x10, 1);
            mem.write8(DISP_ENV_A + 0x11, 1);
            setDefDispEnv(mem, DISP_ENV_B, 0x1e0, 0, 0x140, 0x1e0);
            mem.write8(DISP_ENV_B + 0x10, 1);
            mem.write8(DISP_ENV_B + 0x11, 1);
        } else {
            setDefDispEnv(mem, DISP_ENV_A, 0, 0, a0, a1);
            setDefDispEnv(mem, DISP_ENV_B, a0, 0, a0, a1);
        }
    } else {
        setDefDispEnv(mem, DISP_ENV_A, 0, 0, a0, a1);
        setDefDispEnv(mem, DISP_ENV_B, 0, 0x100, a0, a1);
    }
    if ((mem.read32(DISP_MODE_FLAG) | 0) !== 0) {
        for (const off of DISP_REGION_SCREEN_Y) mem.write16(DISPLAY_SERVICE + off, 0x18);
    }
    host.gsInit3D();
    host.setGeomOffset(0, 0);
}

/**
 * F0x8001DBE0(rect, poolIndex, handle): the view registration. It takes the
 * first free service slot, builds a 0x5C-byte DRAWENV from the caller's four
 * s16 rect fields on a scratch the caller owns (the original's own stack), then
 * publishes the handle to the slot's +0xD8 and the constructor's view to +0x60.
 * With no free slot it returns 0 and writes nothing.
 */
export function registerDisplayView(
    mem: DisplayServiceMemory,
    host: DisplayViewHost,
    envScratch: number,
    rect: number,
    poolIndex: number,
    handle: number,
): number {
    const idx = findDisplayViewCell(mem, 0);
    if (idx === -1) return 0;
    setDefDrawEnv(
        mem,
        envScratch,
        s16(mem.read16(rect + 0x0)),
        s16(mem.read16(rect + 0x2)),
        s16(mem.read16(rect + 0x4)),
        s16(mem.read16(rect + 0x6)),
    );
    const slot = DISPLAY_SERVICE + idx * 4;
    mem.write32(slot + DISPLAY_SERVICE_FIELDS.viewHandle, handle | 0);
    const view = initDisplayView(mem, host, envScratch, poolIndex);
    mem.write32(slot + DISPLAY_SERVICE_FIELDS.viewBase, view | 0);
    return view;
}
