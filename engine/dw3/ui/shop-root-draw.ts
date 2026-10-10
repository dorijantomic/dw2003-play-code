// The merchant screen's plates and moving wall, from pro/stitshop F0x8008B60C.
// Geometry and clip ids are also recorded in shop_ui.json and the canonical
// shop-system-decompiled document; the browser renderer consumes these intents.

export interface ShopRootDrawMemory {
  read32(address: number): number;
  write32(address: number, value: number): void;
}

export interface ShopRootDrawHost {
  initDrawContext(): void;
  setLayer(target: number, bucket: number): void;
  setOrigin(x: number, y: number): void;
  setScale(x: number, y: number, z: number): void;
  setPos(x: number, y: number): void;
  drawSprite(pack: number, clip: number, x: number, y: number): void;
  packResolve(handle: number): number;
}

const PACK_STSHOP = 0x04020000;

/** One draw pass; the final wall also advances its half-speed scroll counter. */
export function shopRootDraw(mem: ShopRootDrawMemory, root: number, host: ShopRootDrawHost): void {
  const read = (offset: number): number => mem.read32(root + offset) | 0;
  const write = (offset: number, value: number): void => mem.write32(root + offset, value >>> 0);
  const draw = (clip: number, x: number, y: number): void =>
    host.drawSprite(host.packResolve(PACK_STSHOP), clip, x, y);

  host.initDrawContext();
  host.setLayer(read(0x50), 1);
  host.setOrigin(0x280, 0x100);
  for (const [offset, clip, x, y, pivotX, pivotY] of [
    [0x70, 1, 0x16, 0x12, 0x57, 0x19],
    [0x80, 2, 0xd6, 0x0f, 0x140, 0x18],
    [0x90, 5, 0xa9, 0x26, 0x140, 0x3b],
    [0xa0, 0, 0xc6, 0xc4, 0x140, 0xd2],
  ]) {
    const scale = read(offset!);
    if (!scale) continue;
    if (scale !== 0x1000) {
      host.setScale(scale, 0x1000, 0x1000);
      host.setPos(pivotX!, pivotY!);
    } else if (offset !== 0x70) {
      host.setScale(0x1000, 0x1000, 0x1000);
    }
    draw(clip!, x!, y!);
  }

  host.setLayer(read(0x50), 7);
  if (read(0x5c) !== 0) {
    const next = read(0x58) + 1;
    write(0x58, next < 0x60 ? next : 0);
    write(0x5c, 0);
  } else {
    write(0x5c, 1);
  }
  host.setScale(0x1000, 0x1000, 0x1000);
  const scroll = read(0x58);
  draw(0x14, scroll, scroll);
}
