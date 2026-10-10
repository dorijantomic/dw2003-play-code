// Renderer-neutral picture calls emitted by the translated merchant tasks.
// The browser paints these with extracted screen packs and decoded layout data.
import type { NativeMemory } from "../../native/memory.ts";
import { SHOP_ITEM_ICON_CLIPS, SHOP_ITEM_RECORD_BASE, SHOP_ITEM_RECORD_STRIDE } from "./shop-catalog.ts";

export interface ShopDrawCall { method: string; args: number[] }

export class ShopDrawIntents {
  readonly calls: ShopDrawCall[] = [];
  readonly contextMarkers: number[] = [];
  private tick = 0;
  private readonly mem: NativeMemory;
  constructor(mem: NativeMemory) { this.mem = mem; }

  beginFrame(tick: number): void {
    this.tick = tick | 0;
    this.calls.length = 0;
    this.contextMarkers.length = 0;
  }

  // Coordinates are recorded as signed words, the way the picture service reads its
  // registers: a port that passes a wrapped unsigned value still draws in place.
  private record(method: string, args: number[]): void {
    this.calls.push({ method, args: args.map((value) => value | 0) });
  }

  initDrawContext = (): void => { this.contextMarkers.push(this.calls.length); };
  setLayer = (target: number, bucket: number): void => { this.record("setLayer", [target, bucket]); };
  setOrigin = (x: number, y: number): void => { this.record("setOrigin", [x, y]); };
  /** ctx+0x78 (F0x8001ECD8): the reference records it as "setDepth"; the painter ignores it. */
  setDepth = (x: number, y: number): void => { this.record("setDepth", [x, y]); };
  setScale = (x: number, y: number, z: number): void => { this.record("setScale", [x, y, z]); };
  setPos = (x: number, y: number): void => { this.record("setPos", [x, y]); };
  paletteShift = (value: number): void => { this.record("m_0x88", [value]); };
  drawSprite = (pack: number, clip: number, x: number, y: number): void => {
    this.record("drawSprite", [pack, clip, x, y]);
  };
  /**
   * A call through the picture context's method table (F0x8001F648) by slot, for ports whose host
   * passes the raw slot. ctx+0x98 is ignored, as pause-root-session's context98 does.
   */
  callSlot = (slot: number, args: number[], label: string): void => {
    switch (slot) {
      case 0x7c: this.setLayer(args[0]!, args[1]!); return;
      case 0x74: this.setOrigin(args[0]!, args[1]!); return;
      case 0x98: return;
      case 0x8c: this.setScale(args[0]!, args[1]!, args[2]!); return;
      case 0x94: this.setPos(args[0]!, args[1]!); return;
      case 0x84: this.drawSprite(args[0]!, args[1]!, args[2]!, args[3]!); return;
      // ctx+0x88 = F0x8001ECEC, the CLUT row offset (UI-DRAWCTX-VTABLE-001): the
      // END card walks it 15..0 as its fade, so a by-slot port reaches the same
      // recorded intent the paletteShift method already names.
      case 0x88: this.paletteShift(args[0]!); return;
      default: throw new Error(`${label}: untranslated draw slot ${slot.toString(16)}`);
    }
  };
  packResolve = (handle: number): number => handle >>> 0;
  frameTick = (): number => this.tick;
  iconClip = (itemId: number): number => {
    if (!Number.isInteger(itemId) || itemId < 1 || itemId > 402) throw new Error("Invalid merchant icon item");
    const family = this.mem.read8(SHOP_ITEM_RECORD_BASE + itemId * SHOP_ITEM_RECORD_STRIDE + 9);
    return this.mem.read8(SHOP_ITEM_ICON_CLIPS + family);
  };
}
