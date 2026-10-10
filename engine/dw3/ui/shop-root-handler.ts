// The merchant root object's lifecycle, from pro/stitshop F0x8008BFB0.
// The per-frame menu machine and draw pass are separate translated providers.

export interface ShopRootHandlerMemory {
  read32(address: number): number;
  write32(address: number, value: number): void;
}

export interface ShopRootHandlerHost {
  loadRequest(id: number): void;
  /** Nonzero while the resource is still loading. */
  loadBusy(id: number): number;
  buildLabels(root: number, context: number): void;
  advance0(root: number): void;
  menuTick(root: number, context: number): void;
  draw(root: number, context: number): void;
  closeSave(save: number, result: number): void;
}

/** Create labels and folds, run the merchant menu, or release its save context. */
export function shopRootHandler(
  mem: ShopRootHandlerMemory,
  root: number,
  context: number,
  host: ShopRootHandlerHost,
): void {
  switch (mem.read32(root + 0x0c) | 0) {
    case 1:
      host.menuTick(root, context);
      host.draw(root, context);
      return;
    case 2:
      return;
    case 3:
      host.closeSave(mem.read32(0x80048d68) >>> 0, 0);
      return;
    default:
      if ((mem.read32(root + 0x10) | 0) !== 1) {
        host.loadRequest(1);
        mem.write32(root + 0x10, ((mem.read32(root + 0x10) | 0) + 1) >>> 0);
        return;
      }
      if (host.loadBusy(1) === 0) {
        host.buildLabels(root, context);
        for (const offset of [0x68, 0x78, 0x88, 0x98]) mem.write32(root + offset, 10);
        host.advance0(root);
      }
  }
}
