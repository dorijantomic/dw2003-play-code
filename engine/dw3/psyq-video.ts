// Psy-Q vblank and libgs 3D-context helpers, translated from the resident EXE
// (exe/fns).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Source (assembly, authority 2): ~/ddw3/asm/dw2003/exe/fns.s
//   0x80027D6C set_alarm         (lines 26085-26098)
//   0x8002977C updateViewAnchor  (lines 27946-28007, GsSetDrawBuffOffset)
//   0x8002990C GsInit3D          (lines 28047-28075)
// Oracle: tests/psyq-video-oracle.test.js runs the original addresses through
// engine/native with PutDrawEnv/SetGeomOffset/VSync stubbed on both sides and
// compares every cell each body touches (and the call arguments the two
// boundaries receive).
//
// These three are the display-init chain the screen roots run: GsInit3D writes
// the view anchor from the 3D view size, calls updateViewAnchor, then arms the
// 3D globals; updateViewAnchor either fills the DRAWENV's two offsets (double
// buffered) or sets the GTE geometry offset from the anchor plus the per-buffer
// table entry; set_alarm is the GPU drain's vblank deadline.
//
// None of the four is bridgeable yet: updateViewAnchor (and GsInit3D through
// it) calls PutDrawEnv 0x80025ECC, whose resident body runs real GPU work, and
// set_alarm/gpuQueueStallCheck read the vblank counter the runtime's VSync stub
// owns, so a bridge stub could not reproduce them without re-entering the
// interpreter.

// engine/dw3/byte-ops.ts provides memcpyBytes (F0x8002514C), the 0x5C-byte
// env cache copy PutDrawEnv performs after submission.
import { memcpyBytes } from "./byte-ops.ts";
import { buildDrawEnvPacket } from "./psx-env.ts";

export interface PsyqVideoMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    /** Signed halfword read (the original's `lh`), if the memory provides it. */
    read16s?(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The host boundaries the three helpers reach. */
export interface PsyqVideoHost {
    /** libetc VSync(-1) 0x8002E7FC: advance one vblank, return the counter. */
    vsync(): number;
    /** libgpu PutDrawEnv(DRAWENV*) 0x80025ECC. */
    putDrawEnv(drawEnv: number): void;
    /** libgs SetGeomOffset(x, y) 0x8002B3EC (GTE control registers). */
    setGeomOffset(x: number, y: number): void;
}

/** Boundaries of the GPU queue watchdog at F0x80027DA0. */
export interface GpuWatchdogHost {
    vsync(): number;
    report(format: number, backlog: number, gpu: number, dma: number, status: number): void;
    setIntrMask(mask: number): number;
}

/**
 * fns.s:26103-26181; existing partially_verified claim
 * core-q001-80027da0-gpu-queue-stall-recovery. Preserve the signed comparisons,
 * the short-circuit counter increment and the ordered hardware accesses.
 */
export function gpuQueueStallCheck(mem: PsyqVideoMemory, host: GpuWatchdogHost): number {
    const frame = host.vsync() | 0;
    let expired = (mem.read32(VBLANK_DEADLINE) | 0) < frame;
    if (!expired) {
        const iteration = mem.read32(VBLANK_ITERATION) | 0;
        mem.write32(VBLANK_ITERATION, (iteration + 1) >>> 0);
        expired = iteration > 0xf0000;
    }
    if (!expired) return 0;

    const gpu = mem.read32(0x80056000);
    mem.read32(gpu); // The original also performs this discarded device read.
    const head = mem.read32(0x80056020);
    const statusPort = mem.read32(0x80056004);
    const tail = mem.read32(0x80056024);
    const status = mem.read32(statusPort);
    const dmaPort = mem.read32(0x8005600c);
    const gpuValue = mem.read32(gpu);
    const dmaValue = mem.read32(dmaPort);
    host.report(0x800104b8, (head - tail) & 0x3f, gpuValue, dmaValue, status);
    const mask = host.setIntrMask(0);
    mem.write32(0x80056024, 0);
    const clearedTail = mem.read32(0x80056024);
    mem.write32(0x80056030, mask);
    mem.write32(0x80056020, clearedTail);
    mem.write32(mem.read32(0x8005600c), 0x401);
    const control = mem.read32(0x8005601c);
    mem.write32(control, mem.read32(control) | 0x800);
    mem.write32(mem.read32(0x80056000), 0x02000000);
    mem.write32(mem.read32(0x80056000), 0x01000000);
    host.setIntrMask(mem.read32(0x80056030));
    return -1;
}

/** Callee boundaries of F0x80027C30; never re-enter R3000.call from a bridge. */
export interface GpuQueuePollHost {
    setAlarm(): void;
    drain(): void;
    watchdog(): number;
}

/**
 * F0x80027C30, fns.s:26003-26081. Nonblocking mode returns the backlog
 * snapshot even if draining made the device ready. Blocking mode checks the
 * watchdog after every drain, including the pass that empties the queue.
 */
export function gpuQueuePoll(mem: PsyqVideoMemory, mode: number, host: GpuQueuePollHost): number {
    const ready = (): boolean =>
        (mem.read32(mem.read32(0x8005600c)) & 0x01000000) === 0 &&
        (mem.read32(mem.read32(0x80056000)) & 0x04000000) !== 0;
    if ((mode | 0) !== 0) {
        const backlog = (mem.read32(0x80056020) - mem.read32(0x80056024)) & 0x3f;
        if (backlog !== 0) host.drain();
        return ready() ? backlog : (backlog || 1);
    }
    host.setAlarm();
    while (mem.read32(0x80056020) !== mem.read32(0x80056024)) {
        host.drain();
        if ((host.watchdog() | 0) !== 0) return -1;
    }
    while (!ready()) {
        if ((host.watchdog() | 0) !== 0) return -1;
    }
    return 0;
}

/** Indirect calls of F0x80027894; adapters must not re-enter the interpreter. */
export interface GpuQueueDrainHost {
    setIntrMask(mask: number): number;
    dmaCallback(channel: number, callback: number): void;
    command(target: number, arg0: number, arg1: number): void;
    complete(target: number, arg0: number): void;
}

/**
 * F0x80027894, fns.s:25763-25916; existing partially_verified contract
 * core-q002-gpu-80027894-queuedrain. Reload the tail after dispatch and
 * the backlog after completion: callbacks may change the queue state.
 */
export function gpuQueueDrain(mem: PsyqVideoMemory, host: GpuQueueDrainHost): number {
    const busy = (): boolean => (mem.read32(mem.read32(0x8005600c)) & 0x01000000) !== 0;
    const empty = (): boolean => mem.read32(0x80056020) === mem.read32(0x80056024);
    if (busy()) return 1;
    const mask = host.setIntrMask(0);
    const wasEmpty = empty();
    mem.write32(0x8005602c, mask);
    if (!wasEmpty && !busy()) {
        do {
            if (((mem.read32(0x80056024) + 1) & 0x3f) === mem.read32(0x80056020)
                && mem.read32(0x80055f04) === 0) host.dmaCallback(2, 0);
            const gpu = mem.read32(0x80056000);
            while ((mem.read32(gpu) & 0x04000000) === 0) { /* GPU readiness polling */ }
            const fnSlot = mem.read32(0x80056024) * 0x60;
            const arg0Slot = mem.read32(0x80056024) * 0x60;
            const arg0 = mem.read32(0x8007fa04 + arg0Slot);
            const arg1Slot = mem.read32(0x80056024) * 0x60;
            const arg1 = mem.read32(0x8007fa08 + arg1Slot);
            host.command(mem.read32(0x8007fa00 + fnSlot), arg0, arg1);
            mem.write32(0x80056024, (mem.read32(0x80056024) + 1) & 0x3f);
        } while (!empty() && !busy());
    }
    host.setIntrMask(mem.read32(0x8005602c));
    if (empty() && !busy() && mem.read32(0x80055f00) !== 0) {
        const callback = mem.read32(0x80055f04);
        if (callback !== 0) {
            mem.write32(0x80055f00, 0);
            host.complete(callback, callback);
        }
    }
    return (mem.read32(0x80056020) - mem.read32(0x80056024)) & 0x3f;
}

/** Boundaries of F0x800275e4; adapters must not re-enter the interpreter. */
export interface GpuQueueSendHost {
    setAlarm(): void;
    watchdog(): number;
    drain(): number;
    setIntrMask(mask: number): number;
    dmaCallback(channel: number, callback: number): void;
    command(target: number, arg0: number, arg1: number): void;
}

const GPU_RING_HEAD = 0x80056020;
const GPU_RING_TAIL = 0x80056024;
const GPU_SEND_MASK = 0x80056028;
const GPU_STAT_PTR = 0x80056000;
const GPU_DMA_PTR = 0x8005600c;
const GPU_QUEUE_FLAG = 0x80055ef8;
const GPU_QUEUE_DRAIN = 0x80027894;

function gpuRingSlot(head: number): number {
    return Math.imul(head & 0x3f, 0x60);
}

function signedWordCount(byteCount: number): number {
    let words = byteCount | 0;
    if (words < 0) words += 3;
    return words >> 2;
}

/**
 * F0x800275e4, fns.s:25594-25761. Covered by partially_verified
 * core-q001-80027da0-gpu-queue-stall-recovery (sender as representative caller);
 * not independently promoted. Immediate mode dispatches the caller-supplied
 * worker; the queue path copies trunc_toward_zero(arg2/4) words, publishes the
 * slot, then drains.
 */
export function gpuQueueSend(
    mem: PsyqVideoMemory,
    callback: number,
    buffer: number,
    byteCount: number,
    extra: number,
    host: GpuQueueSendHost,
): number {
    host.setAlarm();
    for (;;) {
        if (((mem.read32(GPU_RING_HEAD) + 1) & 0x3f) === (mem.read32(GPU_RING_TAIL) & 0x3f)) {
            if ((host.watchdog() | 0) !== 0) return -1;
            host.drain();
            continue;
        }
        const saved = host.setIntrMask(0);
        mem.write32(GPU_SEND_MASK, saved);
        mem.write32(GPU_QUEUE_FLAG + 8, 1);
        const immediate = (mem.read8(GPU_QUEUE_FLAG + 1) & 0xff) === 0
            || (mem.read32(GPU_RING_HEAD) === mem.read32(GPU_RING_TAIL)
                && (mem.read32(mem.read32(GPU_DMA_PTR)) & 0x01000000) === 0
                && mem.read32(GPU_QUEUE_FLAG + 0xc) === 0);
        if (immediate) {
            const gpu = mem.read32(GPU_STAT_PTR);
            while ((mem.read32(gpu) & 0x04000000) === 0) { /* GPU readiness polling */ }
            host.command(callback, buffer, extra);
            host.setIntrMask(mem.read32(GPU_SEND_MASK));
            return 0;
        }
        host.dmaCallback(2, GPU_QUEUE_DRAIN);
        const slot = gpuRingSlot(mem.read32(GPU_RING_HEAD) >>> 0);
        if ((byteCount | 0) !== 0) {
            const dest = (0x8007fa0c + slot) >>> 0;
            const count = signedWordCount(byteCount);
            let src = buffer >>> 0;
            for (let i = 0; i < count; i++) {
                mem.write32((dest + i * 4) >>> 0, mem.read32(src));
                src = (src + 4) >>> 0;
            }
            mem.write32((0x8007fa04 + slot) >>> 0, dest);
        } else {
            mem.write32((0x8007fa04 + slot) >>> 0, buffer >>> 0);
        }
        mem.write32((0x8007fa08 + slot) >>> 0, extra | 0);
        mem.write32((0x8007fa00 + slot) >>> 0, callback >>> 0);
        mem.write32(GPU_RING_HEAD, (mem.read32(GPU_RING_HEAD) + 1) & 0x3f);
        host.setIntrMask(mem.read32(GPU_SEND_MASK));
        host.drain();
        return (mem.read32(GPU_RING_HEAD) - mem.read32(GPU_RING_TAIL)) & 0x3f;
    }
}

/** Boundaries of F0x80025868 DrawSync: the logger and the driver slot. */
export interface DrawSyncHost {
    /** [0x80055ef4], called only when [0x80055efa] >= 2, args (0x800103b4, mode). */
    debugLog(tag: number, mode: number): void;
    /** Target stored at [0x80055ef0]+0x3c; called with mode, returning v0. */
    driverSync(target: number, mode: number): number;
}

/** The fixed first argument DrawSync hands the debug logger. */
export const GPU_DRAWSYNC_LOG_ARG = 0x800103b4;

/**
 * F0x80025868 DrawSync(mode), fns.s:23587-23614. The unsigned debug byte at
 * 0x80055efa is read BEFORE the driver base (the logger may mutate the
 * table); >= 2 calls the logger at [0x80055ef4] with (0x800103b4, mode) and
 * ignores its return. Both arms then load the driver base fresh from
 * [0x80055ef0], call the target stored at base+0x3c with the original mode, and propagate the
 * callee's v0 unchanged (the decompiler's void annotation is wrong).
 */
export function drawSync(mem: PsyqVideoMemory, mode: number, host: DrawSyncHost): number {
    if (mem.read8(GPU_DEBUG_LEVEL) >= 2) {
        host.debugLog(GPU_DRAWSYNC_LOG_ARG, mode);
    }
    const base = mem.read32(GPU_FUNCTION_TABLE);
    return host.driverSync(mem.read32(base + 0x3c), mode) | 0;
}

const s16 = (v: number): number => (v << 16) >> 16;

/** The GPU drain's vblank deadline (set_alarm writes it). */
export const VBLANK_DEADLINE = 0x80056034;
/** The GPU drain's iteration counter (set_alarm zeroes it). */
export const VBLANK_ITERATION = 0x80056038;

/** View anchor: u16 x at +0, u16 y at +2 (GsInit3D writes the halved size). */
export const VIEW_ANCHOR = 0x80081250;
/** Per-buffer X offsets, two s16 entries indexed by the buffer byte. */
export const BUFFER_X_OFFSETS = 0x80081240;
/** Per-buffer Y offsets, two s16 entries indexed by the buffer byte. */
export const BUFFER_Y_OFFSETS = 0x80081244;
/** The DRAWENV whose two ofs[] halves arm A fills (its +8). */
export const VIEW_DRAW_ENV = 0x80081258;
/** DRAWENV+8: the two s16 offsets arm A writes. */
export const VIEW_DRAW_OFFSETS = 0x80081260;
/** The last (x, y) arm B handed to SetGeomOffset: u16 x at +0, u16 y at +2. */
export const VIEW_OFFSET_STORE = 0x800812cc;
/** Display-buffer byte the offset tables are indexed by (s16). */
export const BUFFER_INDEX = 0x800812dc;
/** Non-zero when the display is double buffered (s16). */
export const DOUBLE_BUFFER_FLAG = 0x800812de;
/** 3D view width (s32) whose half becomes the anchor x. */
export const GS_3D_VIEW_WIDTH = 0x800812e0;
/** 3D view height (s32) whose half becomes the anchor y. */
export const GS_3D_VIEW_HEIGHT = 0x800812e4;
/** GsInit3D's three globals: mode 10, flag 0, limit 0x3FFF. */
export const GS_3D_MODE = 0x800812f0;
export const GS_3D_FLAG = 0x800812ec;
export const GS_3D_MAX = 0x800812e8;
/** The value GsInit3D returns (also stored at GS_3D_MAX). */
export const GS_3D_MAX_VALUE = 0x3fff;

/** Address encoded in the fixed tag ClearOTagR writes (not a write target). */
export const GPU_QUEUE_TAIL = 0x80055fa4;
/** The DMA chain head word ClearOTagR rewrites through the caller's OT. */
export const CLEAR_OTAG_HEAD = 0x80055fb8;
/** libgpu's debug level; >=2 additionally calls the debug dispatch hook. */
export const GPU_DEBUG_LEVEL = 0x80055efa;
/** Optional debug dispatch (ClearImage/ClearOTagR call it with 0x80010440). */
export const GPU_DEBUG_DISPATCH = 0x80055ef4;
/** The libgpu function table whose +0x2C callback ClearOTagR invokes. */
export const GPU_FUNCTION_TABLE = 0x80055ef0;
/** The fixed first argument the debug dispatch receives (a string/bank). */
export const GPU_DEBUG_ARG0 = 0x80010440;
/** PutDrawEnv's fixed first debug argument and env cache destination. */
export const GPU_PUTDRAWENV_LOG_ARG = 0x8001046c;
export const GPU_ENV_CACHE = 0x80055f08;
/** Packet tag OR word, submission size, and cache copy length. */
export const GPU_PACKET_TAG_MASK = 0xffffff;
export const GPU_PACKET_SIZE = 0x40;
export const GPU_ENV_CACHE_BYTES = 0x5c;

/** Boundaries of F0x80025ecc; adapters must not re-enter the interpreter. */
export interface PutDrawEnvHost {
    /** [GPU_DEBUG_DISPATCH] resolved at call time; only called at level >=2. */
    debugLog(tag: number, env: number): void;
    /** The driver's send method [GPU_FUNCTION_TABLE]+8: (arg0, packet, 0x40, 0). */
    submit(arg0: number, packet: number, size: number, flags: number): void;
}

/**
 * F0x80025ECC PutDrawEnv(env), fns.s:24025-24071; existing partially_verified
 * contract core-q002-gpu-80025ecc-putdrawenv. At debug level >=2 the logger
 * [GPU_DEBUG_DISPATCH] runs first with (0x8001046c, env) and may mutate the
 * driver table, so the driver base is reloaded AFTER it (mirroring DrawSync's
 * ordering rule). The packet is built at env+0x1C by F0x800268ac
 * (buildDrawEnvPacket's original), its tag word ORs 0xFFFFFF, and it is
 * submitted through [driver+8] with size 0x40. Then 0x5C bytes of the env are
 * forward-copied to GPU_ENV_CACHE and the env pointer is returned.
 */
export function putDrawEnv(mem: PsyqVideoMemory, env: number, host: PutDrawEnvHost): number {
    env = env >>> 0;
    if (mem.read8(GPU_DEBUG_LEVEL) >= 2) {
        host.debugLog(GPU_PUTDRAWENV_LOG_ARG, env);
    }
    const packet = (env + 0x1c) >>> 0;
    buildDrawEnvPacket(mem, packet, env, false);
    mem.write32(packet, (mem.read32(packet) | GPU_PACKET_TAG_MASK) >>> 0);
    const base = mem.read32(GPU_FUNCTION_TABLE);
    host.submit(mem.read32(base + 0x18), packet, GPU_PACKET_SIZE, 0);
    memcpyBytes(mem, GPU_ENV_CACHE, env, GPU_ENV_CACHE_BYTES);
    return env;
}

/** ClearOTagR's two boundaries, as the port sees them. */
export interface ClearOtagHost {
    /** Resolve [GPU_DEBUG_DISPATCH] at call time; only called at level >=2. */
    debugDispatch(arg0: number, otag: number, count: number): void;
    /** Resolve [GPU_FUNCTION_TABLE]+0x2C after debugDispatch returns. */
    reset(otag: number, count: number): void;
}

/**
 * F0x80025D54 ClearOTagR(otag, count): with the unsigned byte at 0x80055efa
 * >= 2 it additionally calls the debug dispatch pointer at 0x80055ef4 with
 * (0x80010440, otag, count). Both arms then call the pointer at 0x80055ef0's
 * +0x2C callback with the same pair, set v0 = otag, store the terminator word
 * 0x04055fa4 at 0x80055fb8, and store 0x00055fb8 through otag. The callback's
 * return value is discarded; v0 = otag (assembly 0x80025dc0).
 */
export function clearOtagR(mem: PsyqVideoMemory, otag: number, count: number, host: ClearOtagHost): number {
    if (mem.read8(GPU_DEBUG_LEVEL) >= 2) {
        host.debugDispatch(GPU_DEBUG_ARG0, otag, count);
    }
    host.reset(otag, count);
    mem.write32(CLEAR_OTAG_HEAD, 0x04055fa4);
    mem.write32(otag, 0x00055fb8);
    return otag | 0;
}

/**
 * F0x80027D6C set_alarm(): v0 = VSync(-1) + 0xF0; [0x80056034] = deadline (w32);
 * [0x80056038] = 0 (w32); returns the deadline.
 */
export function setAlarm(mem: PsyqVideoMemory, host: PsyqVideoHost): number {
    const deadline = (host.vsync() + 0xf0) >>> 0;
    mem.write32(VBLANK_DEADLINE, deadline);
    mem.write32(VBLANK_ITERATION, 0);
    return deadline | 0;
}

/**
 * F0x8002977C GsSetDrawBuffOffset(): two arms on the s16 double-buffer flag.
 * de != 0 fills the DRAWENV's ofs[0]/ofs[1] from the anchor plus the buffer's
 * table entry and calls PutDrawEnv; de == 0 computes the same sums for the
 * buffer index `dc == 0 ? 1 : 0`, calls SetGeomOffset and records them at
 * [0x800812CC]/[0x800812CE]. No return value is used.
 */
export function updateViewAnchor(mem: PsyqVideoMemory, host: PsyqVideoHost): void {
    const dc = s16(mem.read16(BUFFER_INDEX));
    const de = s16(mem.read16(DOUBLE_BUFFER_FLAG));
    if (de !== 0) {
        // arm A: double-buffered display. Both sums are u16 (lhu) truncated by sh.
        const off = (dc << 1) >>> 0;
        const x = mem.read16(VIEW_ANCHOR) & 0xffff;
        const y = mem.read16(VIEW_ANCHOR + 2) & 0xffff;
        const ox = mem.read16(BUFFER_X_OFFSETS + off) & 0xffff;
        const oy = mem.read16(BUFFER_Y_OFFSETS + off) & 0xffff;
        mem.write16(VIEW_OFFSET_STORE + 2, 0);
        mem.write16(VIEW_OFFSET_STORE, 0);
        mem.write16(VIEW_DRAW_OFFSETS, (x + ox) & 0xffff);
        mem.write16(VIEW_DRAW_OFFSETS + 2, (y + oy) & 0xffff);
        host.putDrawEnv(VIEW_DRAW_ENV);
    } else {
        // arm B: the single-buffered arm. Both the anchor and the table entry
        // are read signed (lh); the sums are recorded truncated by sh.
        const idx = dc === 0 ? 1 : 0;
        const x = (mem.read16s?.(VIEW_ANCHOR) ?? s16(mem.read16(VIEW_ANCHOR))) + s16(mem.read16(BUFFER_X_OFFSETS + idx * 2));
        const y = (mem.read16s?.(VIEW_ANCHOR + 2) ?? s16(mem.read16(VIEW_ANCHOR + 2))) + s16(mem.read16(BUFFER_Y_OFFSETS + idx * 2));
        host.setGeomOffset(x, y);
        mem.write16(VIEW_OFFSET_STORE, x & 0xffff);
        mem.write16(VIEW_OFFSET_STORE + 2, y & 0xffff);
    }
}

/** Saved draw-env template GsInitGraph fills and GsSetDrawBuffClip re-applies. */
export const DRAW_ENV_TEMPLATE = 0x800812d0;
/** Double-buffer selector GsSetDrawBuffClip reads (s16, doubled for the tables). */
export const GS_BUFFER_INDEX = 0x800812dc;

/**
 * F0x8002988C GsSetDrawBuffClip(), fns.s:28013-28041 (libgs "positionDrawEnv").
 * The DRAWENV at VIEW_DRAW_ENV is refreshed from the saved template at
 * 0x800812D0: w/h (+4/+6) are re-read unsigned, x/y (+0/+2) re-read signed and
 * added to the buffer's X/Y offset (index = s16 at 0x800812DC, doubled; lh on
 * all three), then PutDrawEnv runs on the refreshed env. No return value.
 */
export function positionDrawEnv(mem: PsyqVideoMemory, host: PsyqVideoHost): void {
    const index = s16(mem.read16(GS_BUFFER_INDEX)) << 1;
    const offX = s16(mem.read16(BUFFER_X_OFFSETS + index));
    const offY = s16(mem.read16(BUFFER_Y_OFFSETS + index));
    mem.write16(VIEW_DRAW_ENV + 6, mem.read16(DRAW_ENV_TEMPLATE + 6));
    mem.write16(VIEW_DRAW_ENV + 4, mem.read16(DRAW_ENV_TEMPLATE + 4));
    mem.write16(VIEW_DRAW_ENV, (s16(mem.read16(DRAW_ENV_TEMPLATE)) + offX) & 0xffff);
    mem.write16(VIEW_DRAW_ENV + 2, (s16(mem.read16(DRAW_ENV_TEMPLATE + 2)) + offY) & 0xffff);
    host.putDrawEnv(VIEW_DRAW_ENV);
}

/**
 * F0x8002990C GsInit3D(): the half of the two s32 3D-view dimensions becomes the
 * anchor (rounded toward zero, exactly the original's `(v + (v>>>31)) >> 1`),
 * then updateViewAnchor runs, then mode 10 / 0 / 0x3FFF are stored. Returns
 * 0x3FFF.
 */
export function gsInit3D(mem: PsyqVideoMemory, host: PsyqVideoHost): number {
    const w = mem.read32(GS_3D_VIEW_WIDTH) | 0;
    const h = mem.read32(GS_3D_VIEW_HEIGHT) | 0;
    mem.write16(VIEW_ANCHOR, ((w + (w >>> 31)) >> 1) & 0xffff);
    mem.write16(VIEW_ANCHOR + 2, ((h + (h >>> 31)) >> 1) & 0xffff);
    updateViewAnchor(mem, host);
    mem.write32(GS_3D_MODE, 10);
    mem.write32(GS_3D_FLAG, 0);
    mem.write32(GS_3D_MAX, GS_3D_MAX_VALUE);
    return GS_3D_MAX_VALUE;
}

/**
 * F0x80025C8C ClearOTag(ot, count), fns.s L0x80025c8c..0x80025d50 (claim
 * core-fns-80025c8c-role-2026-09-12). With the debug level byte >= 2 the debug
 * dispatch [0x80055EF4] runs first with (0x80010428, ot, count). Entries
 * 0..count-2 get a zero length byte and link forward to the next entry (only
 * the low 24 bits of the tag are replaced); the last entry links to the libgpu
 * terminator node 0x80055FB8, whose own tag becomes 0x04000000 | 0x055FA4.
 */
export function clearOtag(
    mem: PsyqVideoMemory, ot: number, count: number,
    host: { debugDispatch(arg0: number, ot: number, count: number): void },
): number {
    if (mem.read8(GPU_DEBUG_LEVEL) >= 2) host.debugDispatch(0x80010428, ot, count);
    let node = ot >>> 0;
    for (let left = (count - 1) | 0; left !== 0; left = (left - 1) | 0) {
        const next = (node + 4) >>> 0;
        mem.write8(node + 3, 0);
        mem.write32(node, ((mem.read32(node) & 0xff000000) | (next & 0xffffff)) >>> 0);
        node = next;
    }
    mem.write32(CLEAR_OTAG_HEAD, ((GPU_QUEUE_TAIL & 0xffffff) | 0x04000000) >>> 0);
    mem.write32(node, CLEAR_OTAG_HEAD & 0xffffff);
    return node | 0;
}

/**
 * F0x8002918C SetDrawMove(packet, rect, x, y), fns.s L0x8002918c..0x800291e8.
 * The packet is a DR_MOVE: length byte 5 (0 when rect w or h is zero), GP0
 * 0x01 (flush the texture cache), GP0 0x80 (VRAM to VRAM copy), the source
 * x/y word copied from rect+0, the destination (y << 16) | (x & 0xFFFF), and
 * the size word copied from rect+4.
 */
export function setDrawMove(mem: PsyqVideoMemory, packet: number, rect: number, x: number, y: number): void {
    const w = s16(mem.read16(rect + 4));
    const h = s16(mem.read16(rect + 6));
    const length = w === 0 || h === 0 ? 0 : 5;
    mem.write32(packet + 4, 0x01000000);
    mem.write32(packet + 8, 0x80000000);
    mem.write8(packet + 3, length);
    mem.write32(packet + 0x10, (((y << 16) | (x & 0xffff)) >>> 0));
    mem.write32(packet + 0xc, mem.read32(rect) >>> 0);
    mem.write32(packet + 0x14, mem.read32(rect + 4) >>> 0);
}
