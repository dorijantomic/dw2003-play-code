// The merchant's shared thirty-frame fade task, translated from the object
// constructor, start method and tick in pro/stitshop.
import type { NativeMemory } from "../../native/memory.ts";
import type { TranslatedTaskClass, TranslatedTaskTree } from "./translated-task-tree.ts";

export const SHOP_FADE_HANDLER = 0x80083510;
export const SHOP_FADE_SIZE = 0x68;

export function registerShopFade(mem: NativeMemory, tree: TranslatedTaskTree,
                                 classes: Map<number, TranslatedTaskClass>): void {
  classes.set(SHOP_FADE_HANDLER, {
    name: "merchant fade", childSlots: [],
    tick: (fade) => {
      const state = mem.read32(fade + 0x0c) | 0;
      if (state === 0) { tree.callMethod(fade, 0x38); return; }
      if (state !== 1 || mem.read32(fade + 0x10) === 0) return;
      const next = (mem.read32(fade + 0x5c) + mem.read32(fade + 0x60)) | 0;
      mem.write32(fade + 0x5c, next);
      if (mem.read32(fade + 0x58) === 0 && next > 0xff00) {
        mem.write32(fade + 0x5c, 0xff00);
        mem.write32(fade + 0x0c, 2);
      } else if (mem.read32(fade + 0x58) !== 0 && next < 0) {
        mem.write32(fade + 0x5c, 0);
        mem.write32(fade + 0x0c, 2);
      }
    },
  });
}

export function createShopFade(mem: NativeMemory, tree: TranslatedTaskTree): number {
  const fade = tree.allocate(SHOP_FADE_HANDLER, SHOP_FADE_SIZE, 0);
  mem.write32(fade + 0x50, 0x1000);
  mem.write32(fade + 0x54, 6);
  return fade;
}

export function startShopFade(mem: NativeMemory, tree: TranslatedTaskTree,
                              fade: number, direction: number, frames: number): void {
  if (!Number.isInteger(frames) || frames <= 0) throw new Error("Invalid merchant fade duration");
  tree.callMethod(fade, 0x28, [1]);
  mem.write32(fade + 0x10, 1);
  mem.write32(fade + 0x58, direction);
  mem.write32(fade + 0x5c, direction === 0 ? 0 : 0xff00);
  mem.write32(fade + 0x60, Math.trunc(0xff00 / frames) * (direction === 0 ? 1 : -1));
}
