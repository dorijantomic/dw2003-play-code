// The merchant's shared thirty-frame fade task, translated from the object
// constructor, start method, tick and draw in pro/stitshop.
//
// Oracle: tests/shop-fade-oracle.test.js runs the originals (F0x800835C4 create,
// F0x80083344 start, F0x80083510 tick, F0x800833CC draw) through engine/native
// and compares the ordered calls, the fields and the prim words.
//
// DECODED (claim stitshop-scene-and-fader-2026-10-10, review accepted
// 2026-10-10; ~/ddw3/asm/dw2003/pro/stitshop.s L428-605):
//
//   F0x800835C4 createFader  build the 0x68-byte object: start method
//                            +0x64 = F0x80083344, layer +0x50 = 0x1000,
//                            bucket +0x54 = 6.
//   F0x80083344 startFader   (direction, frames): +0x28(1); +0x10 = 1;
//                            +0x58 = direction; dir 0 rises 0 -> 0xFF00, any
//                            other direction falls 0xFF00 -> 0, by
//                            0xFF00 / frames (MIPS signed div).
//   F0x80083510 updateFader  state 1 (armed) steps +0x5C by +0x60, clamps at
//                            0xFF00 (dir 0) or 0 and lands in state 2, then
//                            paints; state 2 paints; state 3 idles; every other
//                            state calls +0x38 (the base advance).
//   F0x800833CC drawFader    the GPU primitive: a fill quad over
//                            (0,0)-(0x140,0x100) in layer [+0x50] = 0x1000,
//                            bucket [+0x54] = 6, grey level [+0x5C] >> 8 in
//                            colour bytes 4-6, type bytes 3 = 5 and 7 = 0x2A,
//                            plus a linked type-1 primitive whose draw-mode word
//                            is 0xE1000245 (semi-transparency 2, background
//                            minus foreground). A host boundary; the browser
//                            paints the dim over the frame.
import type { NativeMemory } from "../../native/memory.ts";
import type { TranslatedTaskClass, TranslatedTaskTree } from "./translated-task-tree.ts";

export const SHOP_FADE_HANDLER = 0x80083510;
export const SHOP_FADE_SIZE = 0x68;
export const SHOP_FADE_START_ENTRY = 0x80083344;
export const SHOP_FADE_START_SLOT = 0x64;
/** The draw-mode word the linked primitive carries (blend mode 2). */
export const SHOP_FADE_DRAW_MODE = 0xe1000245;
const FADE_FULL = 0xff00;

/** What F0x800833CC submitted this frame. */
export interface ShopFadeDraw {
  /** The quad colour byte: the screen is darkened by this much per channel. */
  level: number;
  /** The layer the quad rides (+0x50) and its bucket (+0x54). */
  layer: number;
  depth: number;
  x: number; y: number; width: number; height: number;
  /** 2: background minus foreground. */
  blend: number;
}

export type ShopFadeDrawSink = (draw: ShopFadeDraw) => void;

/** F0x800835C4(window): build the fade object. */
export function createShopFade(mem: NativeMemory, tree: TranslatedTaskTree): number {
  const fade = tree.allocate(SHOP_FADE_HANDLER, SHOP_FADE_SIZE, 0);
  mem.write32(fade + SHOP_FADE_START_SLOT, SHOP_FADE_START_ENTRY);
  mem.write32(fade + 0x50, 0x1000);
  mem.write32(fade + 0x54, 6);
  return fade;
}

/** F0x80083344(fade, direction, frames): start the ramp. */
export function startShopFade(mem: NativeMemory, tree: TranslatedTaskTree,
                              fade: number, direction: number, frames: number): void {
  tree.callMethod(fade, 0x28, [1]);
  mem.write32(fade + 0x10, 1);
  mem.write32(fade + 0x58, direction | 0);
  // MIPS signed div: a zero divisor yields -1 for a positive dividend.
  const step = frames === 0 ? -1 : Math.trunc(FADE_FULL / (frames | 0));
  mem.write32(fade + 0x5c, (direction | 0) === 0 ? 0 : FADE_FULL);
  mem.write32(fade + 0x60, (direction | 0) === 0 ? step | 0 : -step | 0);
}

/** F0x80083510(fade): one frame of the fade. */
export function shopFadeTick(mem: NativeMemory, tree: TranslatedTaskTree,
                             fade: number, onDraw: ShopFadeDrawSink): void {
  const state = mem.read32(fade + 0x0c) | 0;
  if (state !== 1 && state !== 2 && state !== 3) {
    tree.callMethod(fade, 0x38);
    return;
  }
  if (state === 3) return;
  if (state === 1) {
    if ((mem.read32(fade + 0x10) | 0) === 0) return;
    const next = ((mem.read32(fade + 0x5c) | 0) + (mem.read32(fade + 0x60) | 0)) | 0;
    mem.write32(fade + 0x5c, next);
    if ((mem.read32(fade + 0x58) | 0) === 0) {
      if (next > FADE_FULL) {
        mem.write32(fade + 0x5c, FADE_FULL);
        mem.write32(fade + 0x0c, 2);
      }
    } else if (next < 0) {
      mem.write32(fade + 0x5c, 0);
      mem.write32(fade + 0x0c, 2);
    }
  }
  // F0x800833CC: the full-screen dim quad (a host boundary).
  onDraw({
    level: ((mem.read32(fade + 0x5c) | 0) >> 8) & 0xff,
    layer: mem.read32(fade + 0x50) | 0,
    depth: mem.read32(fade + 0x54) | 0,
    x: 0, y: 0, width: 0x140, height: 0x100,
    blend: (SHOP_FADE_DRAW_MODE >>> 5) & 3,
  });
}

export function registerShopFade(mem: NativeMemory, tree: TranslatedTaskTree,
                                 classes: Map<number, TranslatedTaskClass>,
                                 onDraw: ShopFadeDrawSink = () => {}): void {
  classes.set(SHOP_FADE_HANDLER, {
    name: "merchant fade", childSlots: [],
    methods: new Map([[SHOP_FADE_START_SLOT,
      (fade, args) => startShopFade(mem, tree, fade, args[0]!, args[1]!)]]),
    tick: (fade) => shopFadeTick(mem, tree, fade, onDraw),
  });
}
