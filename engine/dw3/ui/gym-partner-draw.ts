// The training gym's partner/pod panel draw, translated from pro/stgtrain
// F0x80084838 (gym_partner_hud_draw).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/gym-partner-draw-oracle.test.js runs the original through
// engine/native's draw-intent recorder and the port through an equivalent
// recorder, comparing the ordered intent list and every counter it updates.
//
// DECODED: exe-decomp/stgtrain_c/_asm/F0x80084838.s (authority 2, 1191 lines,
// sha256 f6d8b176e0942e1da90f00040c5aed117a9fa848251aaa3a4c66dbf77cdbb929) and
// the accepted gym-partner-draw answer. Claim
// UI-C-FOLD-STGTRAIN-VALUE-IS-SCALE-2026-08-13 (partially_verified) fixes the
// ctx base: F0x8001F648 builds the 0xA0-byte draw context at sp+0x10, so a
// stack slot sp+0xNN is ctx offset +0x(NN-0x10). The engine vocabulary names:
//   sp+0x84 = ctx+0x74 = setOrigin    (0x140/0x240, 0x100 = centres)
//   sp+0x8C = ctx+0x7C = setLayer     (target, bucket)
//   sp+0x94 = ctx+0x84 = drawSprite   (dirPtr, clip, x, y)
//   sp+0x98 = ctx+0x88 = paletteShift (CLUT row 0..3)
//   sp+0x9C = ctx+0x8C = setScale     (*, 0x1000, 0x1000)
//   sp+0xA4 = ctx+0x94 = setPos       (x, y)
//
// Ordered intents. Two state-update passes run first and emit nothing: the
// per-pod portrait cycle (record stride 8 at screen + i*8, frame +0x80, timer
// +0x84) and the selected-pod cycle (frame +0x98, timer +0x9C). Both advance
// the frame every 13 ticks and wrap to 0 at frame 7 or when the animation row
// returns -1. Then:
//   initDrawContext; setLayer(screen+0x50, screen+0x54)
//   A: +0xA8 != 0 -> (partial: setScale/setPos(0,0x2B)) else never;
//      == 0x1000 -> setOrigin(0x240,0x100), drawSprite(STTRNG3,
//        anim[selSlot*7+frame+0x98], 0x10, 0x16); then the CMFONT 0x0E /
//        STTRNG3 0x1F pair at origin 0x140,0 then 0x240,0x100
//   B: +0xB8 != 0 -> (partial scale/pos(0,0x7F)); setOrigin(0x140,0), CMFONT
//      0x0F at (0,0x4B); setOrigin(0x240,0x100), STTRNG3 0x20 at (0,0x4B)
//   C: +0xC8 != 0 -> (partial scale/pos(0,0xC1)); STTRNG3 0x21 at (0,0xB6)
//   D: +0xF8 != 0 -> per pod i < +0x64: (partial scale/pos(0xB4+i*0x30,0x8A)),
//      drawSprite(STTRNG3, anim[slot(i)*7 + pod_i+0x80], 0xA4+i*0x30, 0x81)
//   E: +0x6C != 0 -> every 11 ticks bump +0x70 & 3; setLayer(target,+0x54-2),
//      setOrigin(0x140,0), paletteShift(+0x70), drawSprite(CMFONT, 0x0D,
//      +0x68*0x30+0xA4, 0x65), paletteShift(0)
//   F: +0x108 != 0 -> (scale/pos(0x140,0x8A) or scale 1); setLayer(+0x54-1),
//      setOrigin(0x140,0), CMFONT 0x10 at (0x8F,0x5F), setLayer(+0x54),
//      CMFONT 0x11 at (0x8F,0x5F), setOrigin(0x240,0x100), STTRNG3 0x24
//   G: +0xD8 != 0 -> (scale/pos(0x140,0x1D) or scale 1); STTRNG3 0x27
//   H: +0xE8 != 0 -> (scale/pos(0x140,0x4E) unless 0x1000); STTRNG3 0x22
//   initDrawContext reset; setLayer(target, 7); setOrigin(0x240,0x100)
//   blink: +0x60 -> phase = (+0x5C+1 < 0x60 ? +1 : 0), +0x60 = 0; else +0x60 = 1
//   drawSprite(STTRNG3, screen+0x58, screen+0x5C, screen+0x5C)
//
// The pack resolver cell [0x80044F5C] (F0x800140D8), the party-slot resolver
// cell [0x8004B44C] (F0x80016D94), the free-running frame tick
// ([0x8004DF98] -> F0x8001D6F4 -> [0x8004DE20]) and the draw-context methods
// are host boundaries, exactly as in shop-actor-draw/item-list-draw.

export interface GymPartnerDrawMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The draw boundary. Each call is one ctx method invocation. */
export interface GymPartnerDrawHost {
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    /** ctx+0x88, F0x8001ECEC: CLUT row offset. */
    paletteShift(value: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DF98] = F0x8001D6F4: free-running frame tick. */
    frameTick(): number;
    /** [0x8004B44C] = F0x80016D94: party position -> roster slot. */
    rosterSlot(position: number): number;
}

export const GYM_PACK_CMFONT = 0x02860000; // CMFONTCS, LBA 646
export const GYM_PACK_STTRNG3 = 0x028c0003; // STTRNGCS sub-dir 3, LBA 0x28c

/** The 8-way animation table at 0x8008C224 (7 u32 per slot). */
export const GYM_ANIM_TABLE = 0x8008c224;
export const GYM_ANIM_STRIDE = 7;
/** Frame advance cadence, shared by both cycles. */
export const GYM_FRAME_PERIOD = 13;
/** Strip phase cadence and modulo (E1). */
export const GYM_STRIP_PERIOD = 11;
export const GYM_STRIP_MOD = 4;

/** Screen/record fields the draw reads or writes. */
export const GYM_PARTNER_DRAW = {
    layer: 0x50,
    bucket: 0x54,
    clip: 0x58,
    blinkPhase: 0x5c,
    blinkOn: 0x60,
    podCount: 0x64,
    selectedPod: 0x68,
    stripOn: 0x6c,
    stripPhase: 0x70,
    stripTimer: 0x74,
    podFrame: 0x80,
    podTimer: 0x84,
    selFrame: 0x98,
    selTimer: 0x9c,
    foldA: 0xa8,
    foldB: 0xb8,
    foldC: 0xc8,
    foldG: 0xd8,
    foldH: 0xe8,
    foldD: 0xf8,
    foldF: 0x108,
} as const;

const s32 = (v: number): number => v | 0;

function animFrame(mem: GymPartnerDrawMemory, slot: number, frame: number): number {
    return s32(mem.read32(GYM_ANIM_TABLE + (slot * GYM_ANIM_STRIDE + frame) * 4));
}

/**
 * F0x80084838(screen): advance the portrait cycles and emit the panel draw.
 */
export function gymPartnerHudDraw(
    mem: GymPartnerDrawMemory,
    screen: number,
    host: GymPartnerDrawHost,
): void {
    const r = (off: number): number => mem.read32(screen + off);
    const s = (off: number): number => s32(mem.read32(screen + off));

    // --- state updates: per-pod portrait cycle (0x1bb8..0x1c84) ---
    const podCount = s(GYM_PARTNER_DRAW.podCount);
    if (podCount > 0) {
        for (let i = 0; i < podCount; i++) {
            const rec = screen + i * 8;
            const first = host.frameTick();
            if (s32(first - (mem.read32(rec + GYM_PARTNER_DRAW.podTimer) | 0)) < GYM_FRAME_PERIOD) continue;
            const now = host.frameTick();
            mem.write32(rec + GYM_PARTNER_DRAW.podTimer, now >>> 0);
            let frame = (mem.read32(rec + GYM_PARTNER_DRAW.podFrame) | 0) + 1;
            mem.write32(rec + GYM_PARTNER_DRAW.podFrame, frame >>> 0);
            if (frame >= GYM_ANIM_STRIDE) {
                mem.write32(rec + GYM_PARTNER_DRAW.podFrame, 0);
                continue;
            }
            if (animFrame(mem, host.rosterSlot(i) | 0, frame) === -1) {
                mem.write32(rec + GYM_PARTNER_DRAW.podFrame, 0);
            }
        }
    }

    // --- state updates: selected-pod cycle (0x1c88..0x1d24) ---
    const selSlot = host.rosterSlot(s(GYM_PARTNER_DRAW.selectedPod)) | 0;
    const selFirst = host.frameTick();
    if (s32(selFirst - s(GYM_PARTNER_DRAW.selTimer)) >= GYM_FRAME_PERIOD) {
        const now = host.frameTick();
        mem.write32(screen + GYM_PARTNER_DRAW.selTimer, now >>> 0);
        const frame = s(GYM_PARTNER_DRAW.selFrame) + 1;
        if (frame >= GYM_ANIM_STRIDE || animFrame(mem, selSlot, frame) === -1) {
            mem.write32(screen + GYM_PARTNER_DRAW.selFrame, 0);
        } else {
            mem.write32(screen + GYM_PARTNER_DRAW.selFrame, frame >>> 0);
        }
    }

    // --- draw context and first layer bind (0x1d28..0x1d44) ---
    host.initDrawContext();
    host.setLayer(r(GYM_PARTNER_DRAW.layer), r(GYM_PARTNER_DRAW.bucket));

    // --- block A (0x1d48..0x1e80) ---
    const foldA = s(GYM_PARTNER_DRAW.foldA);
    if (foldA !== 0) {
        if (foldA !== 0x1000) {
            host.setScale(foldA >>> 0, 0x1000, 0x1000);
            host.setPos(0, 0x2b);
        } else {
            host.setOrigin(0x240, 0x100);
            host.drawSprite(
                host.packResolve(GYM_PACK_STTRNG3) >>> 0,
                animFrame(mem, selSlot, r(GYM_PARTNER_DRAW.selFrame) | 0) >>> 0,
                0x10,
                0x16,
            );
        }
        host.setOrigin(0x140, 0);
        host.drawSprite(host.packResolve(GYM_PACK_CMFONT) >>> 0, 0x0e, 0, 0x0f);
        host.setOrigin(0x240, 0x100);
        host.drawSprite(host.packResolve(GYM_PACK_STTRNG3) >>> 0, 0x1f, 0, 0x0f);
    }

    // --- block B (0x1e84..0x1f4c) ---
    const foldB = s(GYM_PARTNER_DRAW.foldB);
    if (foldB !== 0) {
        if (foldB !== 0x1000) {
            host.setScale(foldB >>> 0, 0x1000, 0x1000);
            host.setPos(0, 0x7f);
        }
        host.setOrigin(0x140, 0);
        host.drawSprite(host.packResolve(GYM_PACK_CMFONT) >>> 0, 0x0f, 0, 0x4b);
        host.setOrigin(0x240, 0x100);
        host.drawSprite(host.packResolve(GYM_PACK_STTRNG3) >>> 0, 0x20, 0, 0x4b);
    }

    // --- block C (0x1f50..0x1fbc) ---
    const foldC = s(GYM_PARTNER_DRAW.foldC);
    if (foldC !== 0) {
        if (foldC !== 0x1000) {
            host.setScale(foldC >>> 0, 0x1000, 0x1000);
            host.setPos(0, 0xc1);
        }
        host.drawSprite(host.packResolve(GYM_PACK_STTRNG3) >>> 0, 0x21, 0, 0xb6);
    }

    // --- block D (0x1fc0..0x20b0) ---
    const foldD = s(GYM_PARTNER_DRAW.foldD);
    if (foldD !== 0 && podCount > 0) {
        for (let i = 0; i < podCount; i++) {
            if (foldD !== 0x1000) {
                host.setScale(foldD >>> 0, 0x1000, 0x1000);
                host.setPos((0xb4 + i * 0x30) >>> 0, 0x8a);
            }
            const rec = screen + i * 8;
            host.drawSprite(
                host.packResolve(GYM_PACK_STTRNG3) >>> 0,
                animFrame(mem, host.rosterSlot(i) | 0, mem.read32(rec + GYM_PARTNER_DRAW.podFrame) | 0) >>> 0,
                (0xa4 + i * 0x30) >>> 0,
                0x81,
            );
        }
    }

    // --- block E (0x20b4..0x21ac) ---
    if (s(GYM_PARTNER_DRAW.stripOn) !== 0) {
        const first = host.frameTick();
        if (s32(first - s(GYM_PARTNER_DRAW.stripTimer)) >= GYM_STRIP_PERIOD) {
            const now = host.frameTick();
            mem.write32(screen + GYM_PARTNER_DRAW.stripTimer, now >>> 0);
            let phase = (r(GYM_PARTNER_DRAW.stripPhase) | 0) + 1;
            if (phase >= GYM_STRIP_MOD) phase = 0;
            mem.write32(screen + GYM_PARTNER_DRAW.stripPhase, phase >>> 0);
        }
        host.setLayer(r(GYM_PARTNER_DRAW.layer), (r(GYM_PARTNER_DRAW.bucket) - 2) >>> 0);
        host.setOrigin(0x140, 0);
        host.paletteShift(r(GYM_PARTNER_DRAW.stripPhase));
        host.drawSprite(
            host.packResolve(GYM_PACK_CMFONT) >>> 0,
            0x0d,
            ((r(GYM_PARTNER_DRAW.selectedPod) | 0) * 0x30 + 0xa4) >>> 0,
            0x65,
        );
        host.paletteShift(0);
    }

    // --- block F (0x21b0..0x22f4) ---
    const foldF = s(GYM_PARTNER_DRAW.foldF);
    if (foldF !== 0) {
        if (foldF !== 0x1000) {
            host.setScale(foldF >>> 0, 0x1000, 0x1000);
            host.setPos(0x140, 0x8a);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.setLayer(r(GYM_PARTNER_DRAW.layer), (r(GYM_PARTNER_DRAW.bucket) - 1) >>> 0);
        host.setOrigin(0x140, 0);
        host.drawSprite(host.packResolve(GYM_PACK_CMFONT) >>> 0, 0x10, 0x8f, 0x5f);
        host.setLayer(r(GYM_PARTNER_DRAW.layer), r(GYM_PARTNER_DRAW.bucket));
        host.drawSprite(host.packResolve(GYM_PACK_CMFONT) >>> 0, 0x11, 0x8f, 0x5f);
        host.setOrigin(0x240, 0x100);
        host.drawSprite(host.packResolve(GYM_PACK_STTRNG3) >>> 0, 0x24, 0x8f, 0x5f);
    }

    // --- block G (0x22f8..0x2384) ---
    const foldG = s(GYM_PARTNER_DRAW.foldG);
    if (foldG !== 0) {
        if (foldG !== 0x1000) {
            host.setScale(foldG >>> 0, 0x1000, 0x1000);
            host.setPos(0x140, 0x1d);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(GYM_PACK_STTRNG3) >>> 0, 0x27, 0x8f, 0x0f);
    }

    // --- block H (0x2388..0x23f8) ---
    const foldH = s(GYM_PARTNER_DRAW.foldH);
    if (foldH !== 0) {
        if (foldH !== 0x1000) {
            host.setScale(foldH >>> 0, 0x1000, 0x1000);
            host.setPos(0x140, 0x4e);
        }
        host.drawSprite(host.packResolve(GYM_PACK_STTRNG3) >>> 0, 0x22, 0x92, 0x43);
    }

    // --- reset, fixed chrome and the blinking per-map clip (0x23fc..0x2498) ---
    host.initDrawContext();
    host.setLayer(r(GYM_PARTNER_DRAW.layer), 7);
    host.setOrigin(0x240, 0x100);
    if (s(GYM_PARTNER_DRAW.blinkOn) !== 0) {
        const next = (r(GYM_PARTNER_DRAW.blinkPhase) | 0) + 1;
        mem.write32(screen + GYM_PARTNER_DRAW.blinkPhase, (next < 0x60 ? next : 0) >>> 0);
        mem.write32(screen + GYM_PARTNER_DRAW.blinkOn, 0);
    } else {
        mem.write32(screen + GYM_PARTNER_DRAW.blinkOn, 1);
    }
    host.drawSprite(
        host.packResolve(GYM_PACK_STTRNG3) >>> 0,
        r(GYM_PARTNER_DRAW.clip),
        r(GYM_PARTNER_DRAW.blinkPhase),
        r(GYM_PARTNER_DRAW.blinkPhase),
    );
}
