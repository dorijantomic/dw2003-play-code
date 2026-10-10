// The duel's per-frame board-view queue, translated from pro/cardgame:
//   F0x8009E668 dispatchDuelViewQueue — run one queued board-view request
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-view-queue-oracle.test.js runs the original through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the three
// far duel routines and the view's three method slots stubbed on both sides.
//
// Source (assembly, authority 2): exe-decomp/cardgame_c/_asm/F0x8009e668.s.
// The m2c listing renders the two jump tables as an irregular C switch and does
// not recover which case is which request, so both tables were read from the
// shipped image instead and the port carries them verbatim in state order.
//
// What the player sees. The duel asks the board view for one thing at a time by
// writing a request number into `duel+0x499`. Each frame this routine:
//   1. runs the queued request's setup arm — rebuild the board portraits, arm a
//      scale reveal over the two hand rows, wipe the centre played-card plates,
//      or lay out a pile browse — then
//   2. promotes the request: `duel+0x498` = the old request, `duel+0x499` = 0,
//      `duel+0x49B` = old request + 1, and
//   3. ticks the now-current request: while a four-tick cadence (`+0x4D0`)
//      allows it, one more slot is revealed on the board view, and the frame
//      delta is added twice (once to the elapsed counter `+0x4C8`, once to the
//      cadence). When the elapsed counter passes the request's window `+0x4D8`
//      the request either chains the next one into `+0x499` or clears `+0x498`.
//
// Reused decoded explanations (navigation only; the assembly above decides):
//   - `pile-fan-reveals-one-card-every-four-frames-2026-09-14`: the pile arms use
//     the `count*4 + 10` window in `+0x4D8` and the four-tick cadence in `+0x4D0`
//     to reveal one card at a time.
//   - `centre-plate-modes-are-open-close-plates-on-the-played-slots-2026-09-14`:
//     the view's `+0xEA4`/`+0xEA8` slots are the centre plate's open (10-frame
//     wipe) and close (5 units) writers.
//   - docs/research/card/cardduel-animation-atlas-2026-08-26.md names the slot
//     map: `+0xF24` = 0x8009C938 `scaleSlot`, `+0xEA4` = 0x8009BE40,
//     `+0xEA8` = 0x8009BE78.
//
// Not called from this port: the setup arms hand work to duel routines that
// still run as MIPS (startAiPileBrowse 0x8009DBE8, primeAiPileBrowseCounts
// 0x8009DF68, refreshFieldCardViews 0x8009E024); they are host edges, exactly
// as the view's three method slots are.

export interface DuelViewQueueMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface DuelViewQueueHost {
    /**
     * `[0x8004DF9C]()` = F0x80027DA0 `getFrameDelta`: the frame's elapsed time.
     * A request tick calls it once per accumulator, so twice per frame.
     */
    frameDelta(): number;
    /** F0x8009DBE8(duel, scene, row, kind): lay out a pile browse and start it. */
    startAiPileBrowse(duel: number, scene: number, row: number, kind: number): void;
    /** F0x8009DF68(duel, scene, row, kind): the same counts, without portraits. */
    primeAiPileBrowseCounts(duel: number, scene: number, row: number, kind: number): void;
    /** F0x8009E024(duel, scene): rebuild both rows of board portraits. */
    refreshFieldCardViews(duel: number, scene: number): void;
    /**
     * `[view+0xF24](view, index, span, from, to)` = F0x8009C938, the wrapper over
     * F0x8009C898 `scaleSlot`: a move-state tween over `span` frames from `from`
     * to `to`, pinning the slot's destination to where the card already is.
     */
    scaleSlot(view: number, index: number, span: number, from: number, to: number): void;
    /** `[view+0xEA4](view, index, value)` = F0x8009BE40: open a centre plate. */
    openPlate(view: number, index: number, value: number): void;
    /** `[view+0xEA8](view, index)` = F0x8009BE78: close a centre plate. */
    closePlate(view: number, index: number): void;
}

/** The duel's board-view queue fields (`s1 = duel + 0x498` in the original). */
export const DUEL_VIEW_QUEUE = {
    /** The request being ticked (u8). */
    current: 0x498,
    /** The request queued for this frame (u8); 0 = nothing queued. */
    pending: 0x499,
    /** The request number that follows the promoted one (u8). */
    next: 0x49b,
    /** Ticks elapsed in the current request (s32). */
    acc: 0x4c8,
    /** How far the request's slot cursor has walked (s32). */
    cursor: 0x4cc,
    /** The four-tick cadence: one step is allowed while it is >= 4 (s32). */
    budget: 0x4d0,
    /** The current request's row count (s32). */
    rows: 0x4d4,
    /** The current request's length in ticks (s32). */
    limit: 0x4d8,
    /** The 40 per-slot bytes the first setup arm copies into the view layout. */
    slotBytes: 0x49e,
    slotByteCount: 0x28,
    /** The view's slot records: base +0x151, stride 0x4C. */
    layout: 0x151,
    layoutStride: 0x4c,
    /** The two hand row counts (u8): the player's, then the opponent's. */
    handCount: 0x72c,
    opponentHandCount: 0x79e,
    /** How many cards are on the centre row this phase (s8). */
    playCount: 0x575,
    /** The play-history records' card id byte, stride 8. */
    playCardId: 0x584,
    playRecordStride: 8,
} as const;

/** The scene context's board-view pointer. */
export const DUEL_SCENE_VIEW = 0x18;
/** The (row, kind) records the browse arms pick from: two s16 each. */
export const DUEL_BROWSE_TABLE = 0x800a5d2c;
/** The scale slot's stack argument, which the queue always leaves at 0x1000. */
export const DUEL_SLOT_TWEEN_SCALE = 0x1000;
/** The four-tick cadence step a request spends per slot. */
export const DUEL_VIEW_QUEUE_CADENCE = 4;
/** The two scale spans the arms use: the long reveal, and the short settle. */
export const DUEL_SLOT_SPAN_LONG = 0xa;
export const DUEL_SLOT_SPAN_SHORT = 5;
/** The centre row's first view slot (the two hand rows hold 0..5 and 6..11). */
export const DUEL_CENTRE_ROW_SLOT = 0xc;
/** The six-the-six hand rows' second-row offset. */
export const DUEL_OPPONENT_ROW_OFFSET = 6;
/** The requests the two report arms chain into `+0x49B`. */
export const DUEL_VIEW_NEXT_AFTER_17 = 6;
export const DUEL_VIEW_NEXT_AFTER_18 = 0xc;

/**
 * The queued-request jump table D0x80083800 verbatim: entry `state - 1` is the
 * setup arm for request `state` (1..18). Several requests share an arm — 5 and
 * 17, 11 and 18 — because the arm walks a shared tail of `addiu $a1, 0x1`, and
 * the entry point decides how much of that tail runs (and so which browse
 * record is picked).
 */
export const PENDING_VIEW_ARMS: readonly number[] = [
    0x8009e6c8, 0x8009e774, 0x8009e744, 0x8009e7b8, 0x8009e7e8, 0x8009e82c,
    0x8009e7ec, 0x8009e850, 0x8009e7f0, 0x8009e83c, 0x8009e7f4, 0x8009e88c,
    0x8009e7f8, 0x8009e878, 0x8009e7fc, 0x8009e864, 0x8009e7e8, 0x8009e7f4,
];

/** The current-request jump table D0x80083848 verbatim: entry `state - 1`. */
export const CURRENT_VIEW_ARMS: readonly number[] = [
    0x8009e8f4, 0x8009ea8c, 0x8009e9f8, 0x8009eb90, 0x8009ec6c, 0x8009ecc4,
    0x8009ec6c, 0x8009ecc4, 0x8009ec6c, 0x8009ecc4, 0x8009ec6c, 0x8009ecc4,
    0x8009ec6c, 0x8009ecc4, 0x8009ec6c, 0x8009ecc4, 0x8009ed9c, 0x8009eda4,
];

const s8 = (mem: DuelViewQueueMemory, addr: number): number => mem.read8s(addr) | 0;
const w32 = (mem: DuelViewQueueMemory, addr: number): number => mem.read32(addr) | 0;
const s32 = (v: number): number => v | 0;
const maxHandCount = (mem: DuelViewQueueMemory, duel: number): number =>
    Math.max(mem.read8(duel + DUEL_VIEW_QUEUE.handCount), mem.read8(duel + DUEL_VIEW_QUEUE.opponentHandCount));

/**
 * F0x8009E668(duel, scene): run the queued board-view request's setup arm, then
 * tick the promoted current request. A request number outside 1..18 has no
 * setup arm but is still promoted.
 */
export function dispatchDuelViewQueue(
    mem: DuelViewQueueMemory,
    host: DuelViewQueueHost,
    duel: number,
    scene: number,
): void {
    const view = w32(mem, scene + DUEL_SCENE_VIEW);
    const pending = mem.read8(duel + DUEL_VIEW_QUEUE.pending) & 0xff;
    if (pending !== 0) {
        runPendingArm(mem, host, duel, scene, view, pending);
        mem.write8(duel + DUEL_VIEW_QUEUE.pending, 0);
        mem.write8(duel + DUEL_VIEW_QUEUE.next, (pending + 1) & 0xff);
        mem.write8(duel + DUEL_VIEW_QUEUE.current, pending);
    }
    const current = mem.read8(duel + DUEL_VIEW_QUEUE.current) & 0xff;
    if (current === 0 || current > CURRENT_VIEW_ARMS.length) return;
    runCurrentArm(mem, host, duel, view, CURRENT_VIEW_ARMS[current - 1]!);
}

/** The setup arm for a queued request number; every arm ends in the promotion. */
function runPendingArm(
    mem: DuelViewQueueMemory,
    host: DuelViewQueueHost,
    duel: number,
    scene: number,
    view: number,
    state: number,
): void {
    const arm = state <= PENDING_VIEW_ARMS.length ? PENDING_VIEW_ARMS[state - 1] : 0;
    switch (arm) {
        case 0x8009e6c8:
            // Request 1: rebuild the portraits, seed all 40 view slots, then arm
            // an eight-tick-per-row reveal over both hand rows.
            host.refreshFieldCardViews(duel, scene);
            mem.write32(duel + DUEL_VIEW_QUEUE.acc, 3);
            mem.write32(duel + DUEL_VIEW_QUEUE.cursor, 0);
            mem.write32(duel + DUEL_VIEW_QUEUE.budget, 4);
            mem.write32(duel + DUEL_VIEW_QUEUE.limit, s32(maxHandCount(mem, duel) * 8));
            for (let i = 0; i < DUEL_VIEW_QUEUE.slotByteCount; i++) {
                mem.write8(
                    view + DUEL_VIEW_QUEUE.layout + i * DUEL_VIEW_QUEUE.layoutStride,
                    mem.read8(duel + DUEL_VIEW_QUEUE.slotBytes + i),
                );
            }
            return;
        case 0x8009e774:
            // Request 2: the same reveal, five ticks per row.
            mem.write32(duel + DUEL_VIEW_QUEUE.acc, 3);
            mem.write32(duel + DUEL_VIEW_QUEUE.cursor, 0);
            mem.write32(duel + DUEL_VIEW_QUEUE.budget, 4);
            mem.write32(duel + DUEL_VIEW_QUEUE.limit, s32(maxHandCount(mem, duel) * 5));
            return;
        case 0x8009e744:
            // Request 3: wipe the centre plates in, ten ticks per played card.
            mem.write32(duel + DUEL_VIEW_QUEUE.acc, 3);
            mem.write32(duel + DUEL_VIEW_QUEUE.cursor, 0);
            mem.write32(duel + DUEL_VIEW_QUEUE.budget, 4);
            mem.write32(duel + DUEL_VIEW_QUEUE.limit, s32(s8(mem, duel + DUEL_VIEW_QUEUE.playCount) * 10));
            return;
        case 0x8009e7b8:
            // Request 4: close the centre plates, five ticks per played card,
            // after a fixed twenty-two tick lead-in.
            mem.write32(duel + DUEL_VIEW_QUEUE.acc, 3);
            mem.write32(duel + DUEL_VIEW_QUEUE.cursor, 0);
            mem.write32(duel + DUEL_VIEW_QUEUE.budget, 4);
            mem.write32(duel + DUEL_VIEW_QUEUE.limit, s32(s8(mem, duel + DUEL_VIEW_QUEUE.playCount) * 5 + 0x16));
            return;
        case 0x8009e7e8:
            runBrowseSetup(mem, host, duel, scene, 6);
            return;
        case 0x8009e7ec:
            runBrowseSetup(mem, host, duel, scene, 5);
            return;
        case 0x8009e7f0:
            runBrowseSetup(mem, host, duel, scene, 4);
            return;
        case 0x8009e7f4:
            runBrowseSetup(mem, host, duel, scene, 3);
            return;
        case 0x8009e7f8:
            runBrowseSetup(mem, host, duel, scene, 2);
            return;
        case 0x8009e7fc:
            runBrowseSetup(mem, host, duel, scene, 1);
            return;
        case 0x8009e82c:
            host.primeAiPileBrowseCounts(duel, scene, 0, 0);
            return;
        case 0x8009e850:
            host.primeAiPileBrowseCounts(duel, scene, 0, 2);
            return;
        case 0x8009e83c:
            host.primeAiPileBrowseCounts(duel, scene, 0, 1);
            return;
        case 0x8009e88c:
            host.primeAiPileBrowseCounts(duel, scene, 1, 0);
            return;
        case 0x8009e878:
            host.primeAiPileBrowseCounts(duel, scene, 1, 2);
            return;
        case 0x8009e864:
            host.primeAiPileBrowseCounts(duel, scene, 1, 1);
            return;
        default:
            // A request number the table does not cover: no setup, promotion only.
            return;
    }
}

/** The six browse arms: pick record `index` of D0x800A5D2C and lay the pile out. */
function runBrowseSetup(
    mem: DuelViewQueueMemory,
    host: DuelViewQueueHost,
    duel: number,
    scene: number,
    index: number,
): void {
    const record = DUEL_BROWSE_TABLE + index * 4;
    host.startAiPileBrowse(duel, scene, mem.read16s(record) | 0, mem.read16s(record + 2) | 0);
}

/** The tick of the promoted request. */
function runCurrentArm(
    mem: DuelViewQueueMemory,
    host: DuelViewQueueHost,
    duel: number,
    view: number,
    arm: number,
): void {
    switch (arm) {
        // Request 1: reveal both hand rows in place, chaining request 3.
        case 0x8009e8f4:
            handRowStep(mem, host, duel, view, DUEL_SLOT_SPAN_LONG, DUEL_SLOT_TWEEN_SCALE);
            advance(mem, host, duel);
            if (w32(mem, duel + DUEL_VIEW_QUEUE.limit) < w32(mem, duel + DUEL_VIEW_QUEUE.acc)) {
                mem.write8(duel + DUEL_VIEW_QUEUE.pending, 3);
            }
            return;
        // Request 2: settle both hand rows in from nothing, chaining request 4.
        case 0x8009ea8c:
            handRowStep(mem, host, duel, view, DUEL_SLOT_SPAN_SHORT, 0);
            advance(mem, host, duel);
            if (w32(mem, duel + DUEL_VIEW_QUEUE.limit) < w32(mem, duel + DUEL_VIEW_QUEUE.acc)) {
                mem.write8(duel + DUEL_VIEW_QUEUE.pending, 4);
            }
            return;
        // Request 3: walk the centre row, opening one plate per played card.
        case 0x8009e9f8: {
            const cursor = w32(mem, duel + DUEL_VIEW_QUEUE.cursor);
            const rows = s8(mem, duel + DUEL_VIEW_QUEUE.playCount);
            if (w32(mem, duel + DUEL_VIEW_QUEUE.budget) >= DUEL_VIEW_QUEUE_CADENCE) {
                if (cursor < rows) {
                    host.scaleSlot(view, cursor + DUEL_CENTRE_ROW_SLOT, DUEL_SLOT_SPAN_LONG,
                        DUEL_SLOT_TWEEN_SCALE, DUEL_SLOT_TWEEN_SCALE);
                }
                const plate = cursor - 1;
                if (plate < rows && plate >= 0) {
                    host.openPlate(view, plate, mem.read8(
                        duel + DUEL_VIEW_QUEUE.playCardId + plate * DUEL_VIEW_QUEUE.playRecordStride));
                }
                spendCadence(mem, duel, cursor);
            }
            advance(mem, host, duel);
            if (w32(mem, duel + DUEL_VIEW_QUEUE.limit) < w32(mem, duel + DUEL_VIEW_QUEUE.acc)) {
                mem.write8(duel + DUEL_VIEW_QUEUE.current, 0);
            }
            return;
        }
        // Request 4: walk the centre row, closing one plate per played card.
        case 0x8009eb90: {
            const cursor = w32(mem, duel + DUEL_VIEW_QUEUE.cursor);
            const rows = s8(mem, duel + DUEL_VIEW_QUEUE.playCount);
            if (w32(mem, duel + DUEL_VIEW_QUEUE.budget) >= DUEL_VIEW_QUEUE_CADENCE) {
                if (cursor < rows) {
                    host.scaleSlot(view, cursor + DUEL_CENTRE_ROW_SLOT, DUEL_SLOT_SPAN_SHORT, 0, DUEL_SLOT_TWEEN_SCALE);
                    host.closePlate(view, cursor);
                }
                spendCadence(mem, duel, cursor);
            }
            advance(mem, host, duel);
            if (w32(mem, duel + DUEL_VIEW_QUEUE.limit) < w32(mem, duel + DUEL_VIEW_QUEUE.acc)) {
                mem.write8(duel + DUEL_VIEW_QUEUE.current, 0);
            }
            return;
        }
        // Requests 5..16: the pile browse's reveal walk — one slot per cadence.
        case 0x8009ec6c:
            browseStep(mem, host, duel, view, DUEL_SLOT_SPAN_LONG, DUEL_SLOT_TWEEN_SCALE);
            return;
        case 0x8009ecc4:
            browseStep(mem, host, duel, view, DUEL_SLOT_SPAN_SHORT, 0);
            return;
        // Requests 17 and 18: finish the request and chain the next one.
        case 0x8009ed9c:
            mem.write8(duel + DUEL_VIEW_QUEUE.current, 0);
            mem.write8(duel + DUEL_VIEW_QUEUE.next, DUEL_VIEW_NEXT_AFTER_17);
            return;
        case 0x8009eda4:
            mem.write8(duel + DUEL_VIEW_QUEUE.current, 0);
            mem.write8(duel + DUEL_VIEW_QUEUE.next, DUEL_VIEW_NEXT_AFTER_18);
            return;
        default:
            return;
    }
}

/**
 * Requests 1 and 2's body: while the cadence allows, reveal the player's slot
 * `cursor` and the opponent's slot `cursor + 6`, each only while its own hand
 * still holds that slot, then spend one cadence step.
 */
function handRowStep(
    mem: DuelViewQueueMemory,
    host: DuelViewQueueHost,
    duel: number,
    view: number,
    span: number,
    from: number,
): void {
    const cursor = w32(mem, duel + DUEL_VIEW_QUEUE.cursor);
    if (w32(mem, duel + DUEL_VIEW_QUEUE.budget) < DUEL_VIEW_QUEUE_CADENCE) return;
    if (cursor < mem.read8(duel + DUEL_VIEW_QUEUE.handCount)) {
        host.scaleSlot(view, cursor, span, from, DUEL_SLOT_TWEEN_SCALE);
    }
    if (cursor < mem.read8(duel + DUEL_VIEW_QUEUE.opponentHandCount)) {
        host.scaleSlot(view, cursor + DUEL_OPPONENT_ROW_OFFSET, span, from, DUEL_SLOT_TWEEN_SCALE);
    }
    spendCadence(mem, duel, cursor);
}

/** Requests 5..16's body: the browse reveal walk, then the report. */
function browseStep(
    mem: DuelViewQueueMemory,
    host: DuelViewQueueHost,
    duel: number,
    view: number,
    span: number,
    from: number,
): void {
    const cursor = w32(mem, duel + DUEL_VIEW_QUEUE.cursor);
    const rows = w32(mem, duel + DUEL_VIEW_QUEUE.rows);
    const bound = rows === 0 ? 1 : rows;
    if (cursor < bound && w32(mem, duel + DUEL_VIEW_QUEUE.budget) >= DUEL_VIEW_QUEUE_CADENCE) {
        host.scaleSlot(view, cursor, span, from, DUEL_SLOT_TWEEN_SCALE);
        spendCadence(mem, duel, cursor);
    }
    if (w32(mem, duel + DUEL_VIEW_QUEUE.limit) < w32(mem, duel + DUEL_VIEW_QUEUE.acc)) {
        mem.write8(duel + DUEL_VIEW_QUEUE.current, 0);
    }
    advance(mem, host, duel);
}

/** One cadence step: move the cursor on and spend four ticks from the budget. */
function spendCadence(mem: DuelViewQueueMemory, duel: number, cursor: number): void {
    mem.write32(duel + DUEL_VIEW_QUEUE.cursor, s32(cursor + 1));
    mem.write32(duel + DUEL_VIEW_QUEUE.budget, s32(w32(mem, duel + DUEL_VIEW_QUEUE.budget) - DUEL_VIEW_QUEUE_CADENCE));
}

/** The two frame-delta accumulations every request tick ends with. */
function advance(mem: DuelViewQueueMemory, host: DuelViewQueueHost, duel: number): void {
    mem.write32(duel + DUEL_VIEW_QUEUE.acc, s32(w32(mem, duel + DUEL_VIEW_QUEUE.acc) + host.frameDelta()));
    mem.write32(duel + DUEL_VIEW_QUEUE.budget, s32(w32(mem, duel + DUEL_VIEW_QUEUE.budget) + host.frameDelta()));
}
