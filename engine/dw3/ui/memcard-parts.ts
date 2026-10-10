// The memory-card screen's small routines that the disassembler's function list
// missed (each was swallowed by the routine before it; they were found through
// the constructors' method-pointer blocks, see AGENTS.md "A screen's own methods
// are not in the decompiled C"), translated from pro/stgmcard.
//
// Oracle: tests/lane-b/memcard-parts.test.js runs every original through
// engine/native on the shipped overlay and compares the ordered calls and the
// object fields. Sources: exe-decomp/stgmcard_c/F0x800830b8..F0x80084ca8.c and
// _asm/ (and the lifted copies of the missed ones).
//
// What each routine is, from the method block that installs it:
//   slot transition object (ctor F0x80084058, handler F0x80083C50, size 0xD8):
//     +0xC4 reset F0x80083BD8 (ported in memcard-save-card.ts, registered there),
//     +0xC8 play F0x80083C0C, +0xCC colour A F0x80083C1C, +0xD0 colour B
//     F0x80083C30, +0xD4 position F0x80083C44.
//   block grid methods (installed by F0x800849F0): +0xE0 F0x8008410C slide the
//     label in, +0xE4 F0x80084194 choose a block, +0xE8 F0x800841FC slide the
//     label out, +0xEC F0x800842A0 open the columns, +0xF0 F0x800842E4 close them.
//   save-file card methods (installed by F0x80083B6C): +0x84 F0x800830B8 show,
//     +0x88 F0x800830E0 hide the record text (fill is F0x8008316C, memcard-fill.ts).
//   message window methods: +0x2854 F0x80084C70 refresh the card, +0x2858
//     F0x80084CA8 dismiss the chrome.
//   state-machine helpers: F0x80084A80 slot caption, F0x80084B20 teardown,
//     F0x80084BF8 between-steps hide.
//   root: F0x80087E78 free the two staging buffers.
//   entry actor F0x80082CD0: display set-up, then the root.
//   fade object (ctor F0x80083074): the start method F0x80082DF4, the tick
//     F0x80082FC0 and the dim draw F0x80082E7C are the same bodies as the fight
//     report's fade (native/fight-report-fade.ts); only the constructor differs.
//
// The slot transition's per-frame routine F0x80083C50 draws the rotating-quad wipe
// (see memcardTransitionTick): the arithmetic is translated, the GTE matrix helpers
// and the GPU primitive are host boundaries, and the renderer paints the quad.

export interface PartsMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** target+slot(target, ...args): one object or widget method. */
export type CallMethod = (target: number, slot: number, args: number[]) => void;

/** The shared module block at 0x80088768 (owned per session, see memcard-session.ts). */
export const PARTS_SHARED = 0x80088768;

// ── the slot transition object ──────────────────────────────────────────────

export const MEMCARD_TRANSITION_HANDLER = 0x80083c50;
export const MEMCARD_TRANSITION_SIZE = 0xd8;
export const MEMCARD_TRANSITION_PACK = 0x029d0000;
export const MEMCARD_TRANSITION_CLIP = 0x26;

export interface MemcardTransitionCreateHost {
    /** F0x80014504(handler, size, extra). */
    alloc(handler: number, size: number, extra: number): number;
}

/** F0x80084058(x, y, w, h): build the slot transition with its rectangle. */
export function memcardTransitionCreate(
    mem: PartsMemory, host: MemcardTransitionCreateHost, x: number, y: number, w: number, h: number,
): number {
    const obj = host.alloc(MEMCARD_TRANSITION_HANDLER, MEMCARD_TRANSITION_SIZE, 0) >>> 0;
    mem.write32(obj + 0xc4, 0x80083bd8);
    mem.write32(obj + 0xc8, 0x80083c0c);
    mem.write32(obj + 0xcc, 0x80083c1c);
    mem.write32(obj + 0xd0, 0x80083c30);
    mem.write32(obj + 0xd4, 0x80083c44);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 1);
    mem.write32(obj + 0x58, x);
    mem.write32(obj + 0x5c, y);
    mem.write32(obj + 0x60, w);
    mem.write32(obj + 0x64, h);
    return obj;
}

/** F0x80083C0C(obj, mode, frames): choose the wipe (1 opens, 2 closes) and its length. */
export function memcardTransitionPlay(mem: PartsMemory, obj: number, mode: number, frames: number): void {
    mem.write32(obj + 0x10, mode);
    mem.write32(obj + 0x74, frames);
    mem.write32(obj + 0x78, 0);
}

/** F0x80083C1C(obj, r, g, b): the left-edge colour (the fourth byte is cleared). */
export function memcardTransitionColourA(mem: PartsMemory, obj: number, r: number, g: number, b: number): void {
    mem.write8(obj + 0x6c, r & 0xff);
    mem.write8(obj + 0x6d, g & 0xff);
    mem.write8(obj + 0x6e, b & 0xff);
    mem.write8(obj + 0x6f, 0);
}

/** F0x80083C30(obj, r, g, b): the right-edge colour. */
export function memcardTransitionColourB(mem: PartsMemory, obj: number, r: number, g: number, b: number): void {
    mem.write8(obj + 0x70, r & 0xff);
    mem.write8(obj + 0x71, g & 0xff);
    mem.write8(obj + 0x72, b & 0xff);
    mem.write8(obj + 0x73, 0);
}

/** F0x80083C44(obj, x, y): move the wipe. */
export function memcardTransitionPosition(mem: PartsMemory, obj: number, x: number, y: number): void {
    mem.write32(obj + 0x58, x);
    mem.write32(obj + 0x5c, y);
}

export interface MemcardTransitionHost {
    /** obj+0x38 (F0x800142AC): advance the object's phase. */
    advance(obj: number): void;
    /** F0x80083BD8(obj): the transition's reset (memcardSaveCardReset). */
    reset(obj: number): void;
    /** [0x8004DE10+0x17C](layer) then its +0x138(bucket): the ordering-table slot. */
    otSlot(layer: number, bucket: number): number;
    /** F0x8002B65C(rotation, matrix): libgte RotMatrix. */
    rotMatrix(rotation: number, matrix: number): void;
    /** F0x8002B23C(matrix, scale): libgte ScaleMatrix. */
    scaleMatrix(matrix: number, scale: number): void;
    /** F0x8002B1DC(matrix, in, out): libgte ApplyMatrixSV. */
    applyMatrix(matrix: number, input: number, output: number): void;
    /** [0x8004DE10+0x158](): a fresh GPU primitive block. */
    allocPrim(): number;
    /** [0x8004DF6C](end, 0xFF000000): submit the primitive whose end is `end` (prim + 0x24). */
    commitPrim(end: number): void;
    /** 0x40 bytes of local workspace: output vertices at +0, input vertices at +0x20. */
    scratch(): number;
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
}

/**
 * F0x80083C50(obj): one frame of the slot transition, the wipe that covers the
 * card while a file is read or written.
 *
 * +0x10 is the mode: 1 grows the wipe to 0xF33/0x1000 of its width and holds (it
 * stays on screen while the card works), 2 finishes it to 0x1000 and raises the
 * done flag +0x68. +0x8C is the horizontal scale word (0..0x1000) the wipe is drawn
 * at; +0x74 is the frame count and +0x78 the per-frame step (0x1000 / frames,
 * computed once). While +0x8C is nonzero the frame builds the flat-shaded quad:
 * four corners (x - centre, y - centre), multiplied by the matrix RotMatrix(+0x9C)
 * then ScaleMatrix(+0x8C, 0x1000, 0x1000), moved back by the centre (+0x84, +0x88),
 * coloured A on the left corners and B on the right, and linked into the ordering
 * table; then the tab picture 0x26 is drawn at (0xCC, 0xC0).
 *
 * The rotation vector +0x9C is never written by any routine of the overlay (the
 * constructor's object is zeroed and the reset does not touch it), so RotMatrix is
 * always the identity and the quad only scales horizontally about its left edge.
 * A fourth-corner quirk is original behaviour: vertex 3's y is read from vertex 2
 * (the asm stores sp22 twice, lhu 0x22($sp) at 0x12D8).
 */
export function memcardTransitionTick(mem: PartsMemory, obj: number, host: MemcardTransitionHost): void {
    const state = s32(mem.read32(obj + 0x0c));
    if (state !== 1) {
        if (state < 2 || state >= 4) {
            host.advance(obj);
            host.reset(obj);
        }
        return;
    }
    const frames = s32(mem.read32(obj + 0x74));
    if (frames === 0) return;
    const mode = s32(mem.read32(obj + 0x10));
    if (mode === 1) {
        if (mem.read32(obj + 0x78) === 0) mem.write32(obj + 0x78, Math.trunc(0x1000 / frames));
        const scale = (s32(mem.read32(obj + 0x8c)) + s32(mem.read32(obj + 0x78))) | 0;
        mem.write32(obj + 0x8c, scale);
        if (scale >= 0xf34) mem.write32(obj + 0x8c, 0xf33);
    } else if (mode === 2) {
        if (mem.read32(obj + 0x78) === 0) mem.write32(obj + 0x78, Math.trunc(0x1000 / frames));
        const scale = (s32(mem.read32(obj + 0x8c)) + s32(mem.read32(obj + 0x78))) | 0;
        mem.write32(obj + 0x8c, scale);
        if (scale >= 0x1001) {
            mem.write32(obj + 0x8c, 0x1000);
            mem.write32(obj + 0x68, 1);
        }
    } else {
        return;
    }
    if (s32(mem.read32(obj + 0x8c)) === 0) return;

    const matrix = obj + 0xa4;
    const slot = host.otSlot(mem.read32(obj + 0x50), mem.read32(obj + 0x54));
    host.rotMatrix(obj + 0x9c, matrix);
    host.scaleMatrix(matrix, obj + 0x8c);
    const prim = host.allocPrim();
    mem.write8(prim + 3, 8);
    mem.write8(prim + 7, 0x38);
    for (let i = 0; i < 3; i++) {
        mem.write8(prim + 4 + i, mem.read8(obj + 0x6c + i));
        mem.write8(prim + 0xc + i, mem.read8(obj + 0x70 + i));
        mem.write8(prim + 0x14 + i, mem.read8(obj + 0x6c + i));
        mem.write8(prim + 0x1c + i, mem.read8(obj + 0x70 + i));
    }
    const u16 = (v: number): number => v & 0xffff;
    const centreX = mem.read16(obj + 0x84);
    const centreY = mem.read16(obj + 0x88);
    const scratch = host.scratch();
    const out = scratch;
    const vin = scratch + 0x20;
    const x0 = u16(mem.read16(obj + 0x58) - centreX);
    const x1 = u16(x0 + mem.read16(obj + 0x60));
    const y0 = u16(mem.read16(obj + 0x5c) - centreY);
    const y1 = u16(y0 + mem.read16(obj + 0x64));
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const;
    corners.forEach(([x, y], i) => {
        mem.write16(vin + i * 8, x);
        mem.write16(vin + i * 8 + 2, y);
        mem.write16(vin + i * 8 + 4, 0);
    });
    for (let i = 0; i < 4; i++) {
        host.applyMatrix(matrix, vin + i * 8, out + i * 8);
        mem.write16(out + i * 8, u16(mem.read16(out + i * 8) + centreX));
        mem.write16(out + i * 8 + 2, u16(mem.read16(out + i * 8 + 2) + centreY));
    }
    mem.write16(prim + 0x08, mem.read16(out));
    mem.write16(prim + 0x0a, mem.read16(out + 2));
    mem.write16(prim + 0x10, mem.read16(out + 8));
    mem.write16(prim + 0x12, mem.read16(out + 10));
    mem.write16(prim + 0x18, mem.read16(out + 16));
    mem.write16(prim + 0x1a, mem.read16(out + 18));
    mem.write16(prim + 0x20, mem.read16(out + 24));
    mem.write16(prim + 0x22, mem.read16(out + 18));
    mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(slot) & 0xffffff)) | 0);
    mem.write32(slot, ((mem.read32(slot) & 0xff000000) | (prim & 0xffffff)) | 0);
    host.commitPrim(prim + 0x24);
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x50), mem.read32(obj + 0x54));
    host.setOrigin(0x280, 0);
    host.drawSprite(host.packResolve(MEMCARD_TRANSITION_PACK) >>> 0, MEMCARD_TRANSITION_CLIP, 0xcc, 0xc0);
}

// ── block grid methods ──────────────────────────────────────────────────────

export interface MemcardGridMethodHost {
    /** [0x80088768+0x30] (F0x80087FDC): start a tween on the record at `tween`. */
    tweenStart(tween: number, from: number, to: number, steps: number): void;
    callMethod: CallMethod;
}

/** F0x8008410C(grid) (+0xE0): slide the label in, number it with the slot and show it. */
export function memcardGridSlideIn(mem: PartsMemory, grid: number, host: MemcardGridMethodHost): void {
    const label = mem.read32(mem.read32(grid + 0x24));
    host.tweenStart(grid + 0x78, -0x55, 0, 0x0a);
    host.callMethod(label, 0x118, [1, (mem.read32(mem.read32(grid + 0x50) + 0x64) + 1) | 0]);
    host.callMethod(mem.read32(mem.read32(grid + 0x24)), 0x144, [0]);
    mem.write32(grid + 0x10, 1);
}

/** F0x80084194(grid, index) (+0xE4): choose the block and start the cursor slide. */
export function memcardGridChoose(
    mem: PartsMemory, grid: number, index: number, host: Pick<MemcardGridMethodHost, "tweenStart">,
): void {
    host.tweenStart(grid + 0x94, 0, 0x2f, 8);
    mem.write32(grid + 0x10, 5);
    mem.write32(PARTS_SHARED + 4, index);
    mem.write32(PARTS_SHARED + 8, 0);
}

/** F0x800841FC(grid) (+0xE8): slide the label out. */
export function memcardGridSlideOut(mem: PartsMemory, grid: number, host: Pick<MemcardGridMethodHost, "tweenStart">): void {
    host.tweenStart(grid + 0x78, 0, -0x55, 5);
    mem.write32(grid + 0x10, 4);
}

/** F0x800842A0(grid) (+0xEC): open the block columns. */
export function memcardGridOpen(mem: PartsMemory, grid: number, host: Pick<MemcardGridMethodHost, "tweenStart">): void {
    host.tweenStart(grid + 0x5c, 0xde, 0, 0x0a);
    mem.write32(grid + 0x10, 2);
}

/** F0x800842E4(grid) (+0xF0): close the block columns. */
export function memcardGridClose(mem: PartsMemory, grid: number, host: Pick<MemcardGridMethodHost, "tweenStart">): void {
    host.tweenStart(grid + 0x5c, 0, 0xde, 5);
    mem.write32(grid + 0x10, 3);
}

// ── save-file card methods ──────────────────────────────────────────────────

/** F0x800830B8(card) (+0x84): substate 1 (the card folds open). */
export function memcardCardShow(card: number, setSubstate: (card: number, value: number) => void): void {
    setSubstate(card, 1);
}

/** F0x800830E0(card) (+0x88): substate 2 (the card folds shut) and hide every record widget. */
export function memcardCardHide(
    mem: PartsMemory, card: number, setSubstate: (card: number, value: number) => void, callMethod: CallMethod,
): void {
    setSubstate(card, 2);
    const array = mem.read32(card + 0x24);
    const count = s32(mem.read32(card + 0x20));
    for (let i = 0; i < count; i++) {
        const widget = mem.read32(array + i * 4);
        if (widget !== 0) callMethod(widget, 0x144, [0]);
    }
}

// ── message window methods ──────────────────────────────────────────────────

/** F0x80084C70(window) (+0x2854): refill the save-file card from the block under the cursor. */
export function memcardWindowRefresh(mem: PartsMemory, window: number, callMethod: CallMethod): void {
    const card = mem.read32(mem.read32(window + 0x24) + 0x24);
    callMethod(card, 0x8c, []);
}

/** F0x80084CA8(window) (+0x2858): hide the window's chrome and close the window. */
export function memcardWindowDismiss(
    mem: PartsMemory, window: number, callMethod: CallMethod,
    setState0: (window: number, value: number) => void,
): void {
    const block = mem.read32(window + 0x24);
    for (const slot of [0x04, 0x14, 0x08, 0x0c, 0x10]) {
        const widget = mem.read32(block + slot);
        if (widget !== 0) callMethod(widget, 0x144, [0]);
    }
    const icon = mem.read32(block + 0x18);
    if (icon !== 0) callMethod(icon, 0x80, [0]);
    const transition = mem.read32(block + 0x1c);
    if (transition !== 0) callMethod(transition, 0xc4, []);
    setState0(window, 2);
}

// ── state-machine helpers ───────────────────────────────────────────────────

export interface MemcardHelperHost {
    callMethod: CallMethod;
    /** [0x80044F4C](id) (F0x80013E5C): text bank id -> RAM base. */
    resourceGetBase(id: number): number;
}

/** F0x80084A80(screen, widgets, show): caption the slot ("Slot n") or hide the caption. */
export function memcardSlotCaption(
    mem: PartsMemory, screen: number, widgets: number, show: number, host: MemcardHelperHost,
): void {
    const caption = mem.read32(widgets + 0x14);
    if (show !== 0) {
        host.callMethod(caption, 0x114, [host.resourceGetBase((s32(mem.read32(0x8005cca8)) + 0x78) | 0), 0x28]);
        host.callMethod(mem.read32(widgets + 0x14), 0x118, [1, (mem.read32(screen + 0x64) + 1) | 0]);
        return;
    }
    host.callMethod(caption, 0x144, [0]);
}

/** F0x80084B20(screen, widgets): the full teardown after a card failure. */
export function memcardTeardownScreen(mem: PartsMemory, screen: number, widgets: number, callMethod: CallMethod): void {
    mem.write32(screen + 0x10, 0x64);
    mem.write32(screen + 0x2804, 0);
    mem.write32(screen + 0x68, (mem.read32(screen + 0x68) - 1) | 0);
    for (const slot of [0x08, 0x0c, 0x10]) {
        const widget = mem.read32(widgets + slot);
        if (widget !== 0) callMethod(widget, 0x144, [0]);
    }
    const icon = mem.read32(widgets + 0x18);
    if (icon !== 0) callMethod(icon, 0x80, [0]);
    const transition = mem.read32(widgets + 0x1c);
    if (transition !== 0) callMethod(transition, 0xc4, []);
}

/** F0x80084BF8(screen, widgets): hide the strip and the transition, return to the chooser step. */
export function memcardHideStep(mem: PartsMemory, screen: number, widgets: number, callMethod: CallMethod): void {
    callMethod(mem.read32(widgets + 0x08), 0x144, [0]);
    callMethod(mem.read32(widgets + 0x1c), 0xc4, []);
    mem.write32(screen + 0x10, 0x5a);
    mem.write32(screen + 0x14, 0x64);
    mem.write32(mem.read32(widgets + 0x20) + 0x10, 0);
}

// ── root ────────────────────────────────────────────────────────────────────

/** F0x80087E78(): free the main image buffer, then the side block (pointers are left as they were). */
export function memcardFreeStaging(mem: PartsMemory, freeBuffer: (ptr: number) => void): void {
    const main = mem.read32(PARTS_SHARED + 0x10);
    if (main !== 0) freeBuffer(main);
    const side = mem.read32(PARTS_SHARED + 0x0c);
    if (side !== 0) freeBuffer(side);
}

// ── entry actor ─────────────────────────────────────────────────────────────

export const MEMCARD_ENTRY_HANDLER = 0x80082cd0;
export const MEMCARD_ENTRY_SIZE = 0x50;
export const MEMCARD_ENTRY_EXTRA = 4;
export const MEMCARD_PACKET_BYTES = 0x5000;
export const MEMCARD_VIEW_KIND = 2;
export const MEMCARD_VIEW_PRIORITY = 0x1000;
export const MEMCARD_SCREEN = { width: 0x140, height: 0xf0 } as const;

export interface MemcardEntryHost {
    /** [0x8004DE10+0x150](): reset the display service. */
    displayReset(): void;
    /** [0x8004DE10+0x154](bytes): size the packet buffers. */
    displayPacketSize(bytes: number): void;
    /** [0x8004DE10+0x174](width, height, a2, a3): set the display region. */
    displayRegion(width: number, height: number, a2: number, a3: number): void;
    /** [0x8004DE10+0x16C](rect, kind, priority): register the screen's view; returns it. */
    displayView(rect: { x: number; y: number; w: number; h: number }, kind: number, priority: number): number;
    /** view+0x12C(view, r, g, b): set the view's clear colour. */
    viewColour(view: number, r: number, g: number, b: number): void;
    /** F0x80087B08(): the root constructor. */
    createRoot(): number;
    /** self+0x38(self): the task's advance method. */
    advance(self: number): void;
}

/**
 * F0x80082CD0(self, children): the overlay's entry actor. On its first tick (state 0,
 * negative or 4 and above) it sets the display up for a 320x240 screen with one view
 * of kind 2, clears the view to black, builds the root into the first child word and
 * advances; states 1..3 do nothing. The launcher F0x8004B440 that creates this actor
 * is not part of the overlay: the session allocates it.
 */
export function memcardEntryTick(mem: PartsMemory, self: number, children: number, host: MemcardEntryHost): void {
    const state = s32(mem.read32(self + 0x0c));
    if (state !== 0 && state >= 0 && state < 4) return;
    host.displayReset();
    host.displayPacketSize(MEMCARD_PACKET_BYTES);
    host.displayRegion(MEMCARD_SCREEN.width, MEMCARD_SCREEN.height, 0, 0);
    const view = host.displayView({ x: 0, y: 0, w: MEMCARD_SCREEN.width, h: MEMCARD_SCREEN.height },
        MEMCARD_VIEW_KIND, MEMCARD_VIEW_PRIORITY);
    host.viewColour(view, 0, 0, 0);
    mem.write32(children, host.createRoot());
    host.advance(self);
}

// ── fade object ─────────────────────────────────────────────────────────────

export const MEMCARD_FADE_HANDLER = 0x80082fc0;
export const MEMCARD_FADE_SIZE = 0x68;
export const MEMCARD_FADE_START_ENTRY = 0x80082df4;
export const MEMCARD_FADE_START_SLOT = 0x64;

/** F0x80083074(): build the fade object (layer +0x50 = 0x1000, bucket +0x54 = 0). */
export function memcardFadeCreate(
    mem: Pick<PartsMemory, "write32">, host: { alloc(handler: number, size: number, extra: number): number },
): number {
    const obj = host.alloc(MEMCARD_FADE_HANDLER, MEMCARD_FADE_SIZE, 0) >>> 0;
    mem.write32(obj + MEMCARD_FADE_START_SLOT, MEMCARD_FADE_START_ENTRY);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 0);
    return obj;
}
