// Shared text/cursor services for the translated merchant task tree.
// Each method delegates to the resident widget's understood TypeScript port.
import type { NativeMemory } from "../../native/memory.ts";
import { createTextElement, FONT_TABLE_CELL } from "./create-text-element.ts";
import { spawnUiIcon, uiIconSetPos, uiIconSetVisible } from "./spawn-ui-icon.ts";
import { widgetSetLine0FromSource, widgetSetLineFromSource } from "./text-widget-resource.ts";
import { widgetSetLineNumber } from "./text-widget-line.ts";
import { measureTextWidth } from "./text-measure.ts";
import { setTextElementFlagC1, set_unk_0xbf_fns_8001a450,
         set_unk_0xc0_fns_8001a1f4 } from "./text-element-setters.ts";
import type { ShopTextBanks } from "./shop-text-banks.ts";
import { cursorHandler } from "./cursor-handler.ts";
import { advance0 } from "./task-object.ts";
import { UI_ICON_FIELDS } from "./spawn-ui-icon.ts";
import type { TranslatedTask } from "./translated-task-tree.ts";

const ARENA_FIRST = 0x800a0000;
const ARENA_LIMIT = 0x80100000;

/** Screen-local allocation for widget objects, line buffers and call scratch. */
/** A screen whose own data lives in the default window passes another one. */
export interface WidgetArenaRange { first: number; limit: number }

export class ShopWidgetArena {
  private next: number;
  private readonly limit: number;
  private sizes = new Map<number, number>();
  private freeBlocks: Array<{ address: number; size: number }> = [];
  private readonly mem: NativeMemory;
  constructor(mem: NativeMemory, range: WidgetArenaRange = { first: ARENA_FIRST, limit: ARENA_LIMIT }) {
    this.mem = mem;
    this.next = range.first >>> 0;
    this.limit = range.limit >>> 0;
  }

  alloc = (size: number, align = 4): number => {
    if (!Number.isInteger(size) || size <= 0 || size > 0x10000 ||
        !Number.isInteger(align) || align < 1 || align > 16 || (align & (align - 1)) !== 0) {
      throw new Error("Invalid shop widget allocation");
    }
    const length = (size + 3) & ~3;
    const reused = this.freeBlocks.findIndex((block) => block.size === length && block.address % align === 0);
    let address: number;
    if (reused >= 0) {
      address = this.freeBlocks.splice(reused, 1)[0]!.address;
    } else {
      address = ((this.next + align - 1) & ~(align - 1)) >>> 0;
      this.next = address + length;
      if (this.next > this.limit) throw new Error("Shop widget storage exhausted");
    }
    this.mem.bytes.fill(0, address & 0x1fffff, (address & 0x1fffff) + length);
    this.sizes.set(address >>> 0, length);
    return address >>> 0;
  };

  free = (address: number): void => {
    const size = this.sizes.get(address >>> 0);
    if (size === undefined) throw new Error(`Unknown shop widget buffer ${address.toString(16)}`);
    this.sizes.delete(address >>> 0);
    this.freeBlocks.push({ address: address >>> 0, size });
  };

  has(address: number): boolean { return this.sizes.has(address >>> 0); }
}

export class ShopWidgetServices {
  readonly arena: ShopWidgetArena;
  private readonly scratchAddress: number;
  private readonly textAddresses = new Set<number>();
  private readonly iconAddresses = new Set<number>();
  private frame = 0;
  readonly mem: NativeMemory;
  readonly banks: ShopTextBanks;
  constructor(mem: NativeMemory, banks: ShopTextBanks, range?: WidgetArenaRange) {
    this.mem = mem;
    this.banks = banks;
    this.arena = new ShopWidgetArena(mem, range);
    this.scratchAddress = this.arena.alloc(16, 4);
  }

  createTextElement = (target: number, kind: number, x: number, y: number): number => {
    if ((this.mem.read32(FONT_TABLE_CELL) >>> 0) === 0) {
      throw new Error("Merchant font data has not been installed");
    }
    const widget = createTextElement(this.mem, this.arena, target, kind, x, y);
    this.textAddresses.add(widget);
    return widget;
  };

  spawnUiIcon = (target: number, order: number, x: number, y: number): number => {
    const icon = spawnUiIcon(this.mem, this.arena, target, order, x, y);
    this.iconAddresses.add(icon);
    return icon;
  };

  cursorShow = (cursor: number, visible: number): void =>
    uiIconSetVisible(this.mem, cursor, visible);

  cursorPlace = (cursor: number, x: number, y: number): void =>
    uiIconSetPos(this.mem, cursor, x, y);

  textSet = (widget: number, source: number, index: number): void =>
    widgetSetLine0FromSource(this.mem, {
      alloc: this.arena.alloc, free: this.arena.free,
      stringById: (bank, id) => this.banks.stringById(this.mem, bank, id),
    }, widget, source, index);

  textFormat = (widget: number, source: number, index: number, line: number): void =>
    widgetSetLineFromSource(this.mem, {
      alloc: this.arena.alloc, free: this.arena.free,
      stringById: (bank, id) => this.banks.stringById(this.mem, bank, id),
    }, widget, source, index, line);

  textNumber = (widget: number, line: number, value: number): void =>
    widgetSetLineNumber(this.mem, this.arena, widget, line, value, this.scratchAddress);

  textMeasure = (widget: number, enabled: number): number =>
    measureTextWidth(this.mem, widget, enabled);

  textShow = (widget: number, visible: number): void =>
    setTextElementFlagC1(this.mem, widget, visible);

  textFlagBF = (widget: number, value: number): void =>
    set_unk_0xbf_fns_8001a450(this.mem, widget, value);

  textColour = (widget: number, value: number): void =>
    set_unk_0xc0_fns_8001a1f4(this.mem, widget, value);

  scratch = (): number => this.scratchAddress;

  isIcon(address: number): boolean { return this.iconAddresses.has(address >>> 0); }

  /** Visit every live text widget (the per-frame reveal tick runs over these). */
  forEachText(visit: (widget: number) => void): void {
    for (const widget of [...this.textAddresses]) visit(widget);
  }
  stringById = (source: number, index: number): number =>
    this.banks.stringById(this.mem, source, index);

  /** Remove widgets in a task's context when its list, panel or actor closes. */
  retireTask(task: TranslatedTask): void {
    const retireText = (address: number): void => {
      if (!this.textAddresses.delete(address)) return;
      for (let line = 0; line < 6; line++) {
        const buffer = this.mem.read32(address + 0x5c + line * 0x0c) >>> 0;
        if (this.arena.has(buffer)) this.arena.free(buffer);
      }
      if (this.arena.has(address)) this.arena.free(address);
    };
    const words = this.mem.read32(task.address + 0x20) | 0;
    for (let i = 0; i < words; i++) {
      const pointer = this.mem.read32(task.children + i * 4) >>> 0;
      retireText(pointer);
      if (this.iconAddresses.delete(pointer)) {
        const extra = this.mem.read32(pointer + UI_ICON_FIELDS.secondaryPtr) >>> 0;
        retireText(this.mem.read32(extra) >>> 0);
        if (this.arena.has(extra)) this.arena.free(extra);
        if (this.arena.has(pointer)) this.arena.free(pointer);
      }
    }
  }

  /** Advance each resident cursor object after its owner task has ticked. */
  tickCursors(displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    for (const icon of this.iconAddresses) {
      const block = this.mem.read32(icon + UI_ICON_FIELDS.secondaryPtr) >>> 0;
      cursorHandler(this.mem, {
        alloc: this.arena.alloc, free: this.arena.free,
        service: () => this.frame,
        advanceState: (self) => {
          const state = {
            state0: this.mem.read32(self + 0x0c), state1: this.mem.read32(self + 0x10),
            state2: this.mem.read32(self + 0x14), state3: this.mem.read32(self + 0x18),
          };
          advance0(state);
          [state.state0, state.state1, state.state2, state.state3]
            .forEach((value, i) => this.mem.write32(self + 0x0c + i * 4, value));
        },
      }, icon, block);
      const child = this.mem.read32(block) >>> 0;
      if (child) this.textAddresses.add(child);
    }
  }

  /** Renderer-neutral descriptors for the existing native UI-font painter. */
  textWidgets(): Array<{
    addr: number; font: number; penX: number; penY: number; fixedPitch: boolean;
    cellWidth: number; lineHeight: number; total: number; revealFirst: number;
    revealEnd: number; colour: number; alignWidth: number; paletteAdd: number;
    visible: number; read8: (addr: number) => number; read16: (addr: number) => number;
    read16s: (addr: number) => number; read32: (addr: number) => number;
    lines: Array<{ ptr: number; capacity: number; len: number; index: number;
                    flag: number; bytes: number[] | null }>;
  }> {
    const out = [];
    for (const addr of this.textAddresses) {
      const lines = [];
      for (let i = 0; i < 6; i++) {
        const rec = addr + 0x5c + i * 0x0c;
        const ptr = this.mem.read32(rec) >>> 0;
        const capacity = this.mem.read16(rec + 4);
        const len = this.mem.read16(rec + 6);
        const index = this.mem.read16(rec + 8);
        const flag = this.mem.read16(rec + 0x0a);
        const bytes = ptr >= 0x80000000 && len > 0 && len < 512
          ? Array.from({ length: len }, (_, k) => this.mem.read8(ptr + k)) : null;
        lines.push({ ptr, capacity, len, index, flag, bytes });
      }
      const font = this.mem.read32(addr + 0x50) >>> 0;
      const fixedPitch = this.mem.read8(addr + 0xc2) !== 0;
      out.push({
        addr, font,
        penX: this.mem.read16s(addr + 0xb0), penY: this.mem.read16s(addr + 0xb2),
        fixedPitch, cellWidth: this.mem.read16(addr + 0xb4),
        lineHeight: fixedPitch ? this.mem.read16(addr + 0xb6) : this.mem.read8(font + 1),
        total: this.mem.read16(addr + 0x62),
        revealFirst: this.mem.read16s(addr + 0xa6), revealEnd: this.mem.read16s(addr + 0xa4),
        colour: this.mem.read8(addr + 0xc0), alignWidth: this.mem.read16(addr + 0xbc),
        paletteAdd: this.mem.read8(addr + 0xae), visible: this.mem.read8(addr + 0xc1),
        read8: (a: number) => this.mem.read8(a),
        read16: (a: number) => this.mem.read16(a),
        read16s: (a: number) => this.mem.read16s(a),
        read32: (a: number) => this.mem.read32(a),
        lines,
      });
    }
    return out;
  }
}
