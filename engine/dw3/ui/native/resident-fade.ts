// The resident full-screen fade object, translated from the resident EXE
// (asm ~/ddw3/asm/dw2003/exe/fns.s):
//   F0x8001206C  create  (fns.s L2603-2622): F0x80014504(F0x80011FB8, 0x68, 0),
//                         +0x64 = F0x80011DEC, +0x50 = layer, +0x54 = 0
//   F0x80011DEC  start   (fns.s L2432-2469): obj+0x28(1); +0x10 = 1; +0x58 = dir;
//                         dir 0: +0x5C = 0, +0x60 = 0xFF00 / frames
//                         else : +0x5C = 0xFF00, +0x60 = -(0xFF00 / frames)
//   F0x80011FB8  handler (fns.s L2554-2602): state 1 with +0x10 set ramps +0x5C by
//                         +0x60, clamps at 0xFF00 (dir 0) or 0 (dir 1) and sets state 2;
//                         states 1 (ramping) and 2 draw; state 3 does nothing; any other
//                         state calls obj+0x38.
//   F0x80011E74  draw    (fns.s L2470-2553): one POLY_F4 (code 0x2A, semi-transparent)
//                         at (0,0)-(0x140,0x100), colour (L, L, L) with L = (+0x5C >> 8)
//                         as a byte, plus a DR_MODE word 0xE1000245 linked after it so it
//                         runs first: draw-mode semi-transparency bits 5-6 = 2, which is
//                         the PlayStation "background minus foreground" blend. So the
//                         screen is darkened by L on every channel: a fade to black.
// The OT bucket is [view(+0x50)+0x138](view, +0x54): the object's layer, depth 0.
//
// Used by the inn's rest (F0x800110E0 steps 20-23) and the dive-demo transition.
import type { NativeMemory } from "../../../native/memory.ts";
import type { TranslatedTaskClass, TranslatedTaskTree } from "../translated-task-tree.ts";

export const RESIDENT_FADE_CREATE = 0x8001206c;
export const RESIDENT_FADE_HANDLER = 0x80011fb8;
export const RESIDENT_FADE_START = 0x80011dec;
export const RESIDENT_FADE_SIZE = 0x68;
/** The DR_MODE word the draw links ahead of the quad: blend mode 2 (subtract). */
export const RESIDENT_FADE_DRAW_MODE = 0xe1000245;

/** What F0x80011E74 submitted this frame. */
export interface ResidentFadeDraw {
    /** The quad colour byte: the screen is darkened by this much per channel. */
    level: number;
    layer: number;
    depth: number;
    x: number; y: number; width: number; height: number;
    /** 2: background minus foreground. */
    blend: number;
}

const s32 = (v: number): number => v | 0;

/** Register the fade handler and its +0x64 start method with a task tree. */
export function registerResidentFade(mem: NativeMemory, tree: TranslatedTaskTree,
                                     classes: Map<number, TranslatedTaskClass>,
                                     onDraw: (draw: ResidentFadeDraw) => void): void {
    const draw = (fade: number): void => onDraw({
        level: (s32(mem.read32(fade + 0x5c)) >> 8) & 0xff,
        layer: s32(mem.read32(fade + 0x50)), depth: s32(mem.read32(fade + 0x54)),
        x: 0, y: 0, width: 0x140, height: 0x100,
        blend: (RESIDENT_FADE_DRAW_MODE >>> 5) & 3,
    });
    classes.set(RESIDENT_FADE_HANDLER, {
        name: "resident fade",
        childSlots: [],
        methods: new Map([[0x64, (fade, args) => residentFadeStart(mem, tree, fade, args[0]!, args[1]!)]]),
        tick: (fade) => {
            const state = s32(mem.read32(fade + 0x0c));
            if (state === 1) {
                if (mem.read32(fade + 0x10) === 0) return;
                const level = s32(mem.read32(fade + 0x5c) + mem.read32(fade + 0x60));
                mem.write32(fade + 0x5c, level >>> 0);
                if (mem.read32(fade + 0x58) === 0) {
                    if (level > 0xff00) {
                        mem.write32(fade + 0x5c, 0xff00);
                        mem.write32(fade + 0x0c, 2);
                    }
                } else if (level < 0) {
                    mem.write32(fade + 0x5c, 0);
                    mem.write32(fade + 0x0c, 2);
                }
                draw(fade);
                return;
            }
            if (state === 2) { draw(fade); return; }
            if (state === 3) return;
            tree.callMethod(fade, 0x38);
        },
    });
}

/** F0x8001206C(layer): create the fade object. */
export function residentFadeCreate(mem: NativeMemory, tree: TranslatedTaskTree, layer: number): number {
    const fade = tree.allocate(RESIDENT_FADE_HANDLER, RESIDENT_FADE_SIZE, 0);
    mem.write32(fade + 0x64, RESIDENT_FADE_START);
    mem.write32(fade + 0x50, layer >>> 0);
    mem.write32(fade + 0x54, 0);
    return fade;
}

/** F0x80011DEC(fade, direction, frames): 0 fades to black, nonzero fades back. */
export function residentFadeStart(mem: NativeMemory, tree: TranslatedTaskTree,
                                  fade: number, direction: number, frames: number): void {
    if (s32(frames) === 0) throw new Error("Resident fade: zero-frame duration (div by zero in the original)");
    tree.callMethod(fade, 0x28, [1]);
    mem.write32(fade + 0x10, 1);
    mem.write32(fade + 0x58, direction >>> 0);
    const step = Math.trunc(0xff00 / s32(frames));
    if (direction === 0) {
        mem.write32(fade + 0x5c, 0);
        mem.write32(fade + 0x60, step >>> 0);
    } else {
        mem.write32(fade + 0x5c, 0xff00);
        mem.write32(fade + 0x60, (-step) >>> 0);
    }
}
