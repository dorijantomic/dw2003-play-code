// The item-shop info band's handler, translated from pro/stitshop F0x8008AF68.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/band-tick-oracle.test.js runs the original through
// engine/native (draw-intent stubs + boundary stubs) and the port through the
// same recorders, comparing the ordered event stream and the band field writes.
//
// DECODED: exe-decomp/stitshop_c/F0x8008af68.c and the raw body at
// exe-decomp/stitshop_c/_asm/F0x8008af68.s, plus the accepted draw-context
// answer (2026-09-14, U4) for the slot names. The band is the object whose
// factory is F0x8008B484 (engine/dw3/ui/band-highlight.ts bandCreate); the
// handler is the object's +0x48 slot.
//
//   state = band+0x0C
//   state == 1 (draw): BUY -> F0x8008A758 + F0x8008A450, SELL -> F0x8008ADEC,
//     then the stack draw context F0x8001F648 and sp8C/sp84/sp9C/spA4/sp94:
//     setLayer(band+0x50, band+0x54-1); setOrigin(0x280,0x100)
//     if band+0x1FC != 0:
//       != 0x1000: setScale(band+0x1FC,0x1000,0x1000); setPos(0x140, 0x28*mode+0x81)
//       == 0x1000: setOrigin(0x140,0); drawSprite(CMFONT, f6(band+0x1E4), 0x16,
//                                         0x28*mode + 2*mode + 0x73)
//       setOrigin(0x280,0x100); drawSprite(STSHOP, 0x0E, 0x0F, 0x28*mode+2*mode+0x6C)
//     if band+0x21C != 0:
//       != 0x1000: setScale(0x1000, band+0x21C, 0x1000); setPos(0xA0, 0x28*mode+0xAE)
//       == 0x1000: setScale(0x1000,0x1000,0x1000)
//       drawSprite(STSHOP, 3, 0, 0x28*mode+0x9C)
//   state == 0 or >= 4 (setup): band+0x38(band); for i in 0..2: if
//     (*[ctx+0x2718])(i) >= 0 then band+0x60 += 1; F0x80089A44(band, ctx);
//     band+0x1F4/+0x204/+0x214/+0x224 = 0xA; if mode == 0 and the item is
//     usable by class 3/4/5 then band+0x1EC = 1.
//   state == 2 or 3: nothing.
//
// The setup branch's +0x38 base method, the roster-slot accessor cell, the item
// usability getter and the three BUY/SELL window routines are host boundaries
// here; F0x80089A44 is the already-translated bandLabelBuild.

import { bandLabelBuild } from "./band-label-build.ts";

export interface BandTickMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface BandTickHost {
    /** band+0x38(self), the shared base-object method (0x800142AC). */
    baseMethod38(band: number): void;
    /** (*[ctx+0x2718])(position) — party position -> roster slot, -1 if none. */
    rosterSlot(position: number): number;
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** A text widget's +0x160 method (F0x8001A450). */
    setWidgetFlagBF(widget: number, value: number): void;
    /** (*[0x80042B98+8])(itemId, class) — the item usability getter. */
    itemUsableClass(itemId: number, klass: number): number;
    /** F0x8008A758(band, ctx): the BUY cards window state machine. */
    call8a758(band: number, ctx: number): void;
    /** F0x8008A450(band, ctx): the BUY effects cards draw. */
    call8a450(band: number, ctx: number): void;
    /** F0x8008ADEC(band, ctx): the SELL window routine. */
    call8adec(band: number, ctx: number): void;
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
    iconClip(id: number): number;
}

/** Band object fields touched by the handler. */
export const BAND_TICK_FIELDS = {
    state: 0x0c,
    layer: 0x50,
    bucketSeed: 0x54,
    mode: 0x58,
    memberCount: 0x60,
    foldMain: 0x1fc,
    foldCards: 0x21c,
    itemId: 0x1e4,
    hasEffects: 0x1ec,
    cardsWindow: 0x1f4,
    cardA: 0x204,
    cardB: 0x214,
    cardC: 0x224,
} as const;

const PACK_CMFONT = 0x02860000;
const PACK_STSHOP = 0x04020000;

/** F0x8008AF68(band, ctx): the info band's per-state handler. */
export function bandTick(
    mem: BandTickMemory,
    band: number,
    ctx: number,
    host: BandTickHost,
): void {
    const state = mem.read32(band + BAND_TICK_FIELDS.state) | 0;
    if (state === 1) {
        draw(mem, band, ctx, host);
        return;
    }
    // The original does nothing for states 2 and 3.
    if (!(state < 2 || state >= 4)) return;
    setup(mem, band, ctx, host);
}

function setup(
    mem: BandTickMemory,
    band: number,
    ctx: number,
    host: BandTickHost,
): void {
    host.baseMethod38(band);
    for (let i = 0; i < 3; i++) {
        if ((host.rosterSlot(i) | 0) >= 0) {
            mem.write32(band + BAND_TICK_FIELDS.memberCount, ((mem.read32(band + BAND_TICK_FIELDS.memberCount) | 0) + 1) >>> 0);
        }
    }
    const labelHost = {
        createTextElement: host.createTextElement,
        setWidgetFlagBF: host.setWidgetFlagBF,
    };
    // F0x80089A44 is already translated; call it directly rather than through a
    // boundary so the two translations stay connected.
    bandLabelBuild(mem, band, ctx, labelHost);
    mem.write32(band + BAND_TICK_FIELDS.cardsWindow, 0xa);
    mem.write32(band + BAND_TICK_FIELDS.cardA, 0xa);
    mem.write32(band + BAND_TICK_FIELDS.cardB, 0xa);
    mem.write32(band + BAND_TICK_FIELDS.cardC, 0xa);
    if ((mem.read32(band + BAND_TICK_FIELDS.mode) | 0) !== 0) return;
    const id = mem.read32(band + BAND_TICK_FIELDS.itemId) | 0;
    if (
        (host.itemUsableClass(id, 3) | 0) !== 0 ||
        (host.itemUsableClass(id, 4) | 0) !== 0 ||
        (host.itemUsableClass(id, 5) | 0) !== 0
    ) {
        mem.write32(band + BAND_TICK_FIELDS.hasEffects, 1);
    }
}

function draw(
    mem: BandTickMemory,
    band: number,
    ctx: number,
    host: BandTickHost,
): void {
    const mode = mem.read32(band + BAND_TICK_FIELDS.mode) | 0;
    if (mode === 0) {
        host.call8a758(band, ctx);
        host.call8a450(band, ctx);
    } else {
        host.call8adec(band, ctx);
    }
    const s2 = Math.imul(mode, 0x28);
    host.initDrawContext();
    host.setLayer(mem.read32(band + BAND_TICK_FIELDS.layer) | 0, (mem.read32(band + BAND_TICK_FIELDS.bucketSeed) | 0) - 1);
    host.setOrigin(0x280, 0x100);

    const foldMain = mem.read32(band + BAND_TICK_FIELDS.foldMain) | 0;
    if (foldMain !== 0) {
        if (foldMain !== 0x1000) {
            host.setScale(foldMain, 0x1000, 0x1000);
            host.setPos(0x140, s2 + 0x81);
        } else {
            host.setOrigin(0x140, 0);
            host.drawSprite(
                host.packResolve(PACK_CMFONT),
                host.iconClip(mem.read32(band + BAND_TICK_FIELDS.itemId) | 0),
                0x16,
                s2 + Math.imul(mode, 2) + 0x73,
            );
        }
        host.setOrigin(0x280, 0x100);
        host.drawSprite(
            host.packResolve(PACK_STSHOP),
            0x0e,
            0x0f,
            s2 + Math.imul(mode, 2) + 0x6c,
        );
    }

    const foldCards = mem.read32(band + BAND_TICK_FIELDS.foldCards) | 0;
    if (foldCards !== 0) {
        if (foldCards !== 0x1000) {
            host.setScale(0x1000, foldCards, 0x1000);
            host.setPos(0xa0, s2 + 0xae);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(PACK_STSHOP), 3, 0, s2 + 0x9c);
    }
}
