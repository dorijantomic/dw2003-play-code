// Frame owner for the stage-entry location title card (fieldstg F0x80087D68 / F0x80087974): the
// area name and place name typed into coloured bars when the player walks into a field stage. It
// composes the translated card into one task and supplies the services it calls. No PlayStation
// instruction is executed.
//
// The routine: engine/dw3/ui/native/place-card.ts, proved by tests/lane-b/place-card.test.js.
// Reference: docs/research/ui/field-location-title-card-2026-08-16.md.
//
// Service map (wired as the oracle wires them):
//   task factory F0x800143DC          -> TranslatedTaskTree.allocate(F0x80087974, 0x1C0, 8), key 9 at +0x00
//   task +0x28/+0x2C/+0x38/+0x3C      -> TranslatedTaskTree defaults (setState0/1, advance0/1)
//   scheduler F0x80018140             -> TranslatedTaskTree.tick; terminalTick: the callback runs once
//                                        in state 3 (it clears the busy flag), then the task is freed
//   text widgets F0x8001AE38          -> ShopWidgetServices.createTextElement
//   widget +0x114 / +0x130 / +0x168   -> textSet / setTextScroll / getUnkC3
//   widget frame callback F0x8001AC14 -> textRevealTick after the card, drawing through drawTextElement
//   scene id [0x8004B438]             -> the scene passed to begin()
//   text bank [0x80044F4C]            -> the shipped area (0xA9 + language) and place (0xB7 + language)
//                                        banks, as web/assets/data/place-banks/ carries them
//   view [0x8004DF8C](0x1003)         -> one view record: +0x110 / +0x114 store the slit, +0x138 returns
//                                        its ordering-table entry (F0x8001DFA8, one buffer)
//   frame delta [0x8004DF9C]          -> the delta passed to tick()
//   packet cursor [0x8004DF68/6C]     -> a packet area; the bar quads are read back by walking the
//                                        ordering-table entry, which is the order the GPU paints them
//   name table 0x80097098, bars 0x80097458 -> the shipped fieldstg tables (place-banks/*.bin)
//   field release F0x8008AA10 case 4  -> tick(delta, stageReady): the first frame the stage is ready
//                                        and the card is in state 2, +0x2C(1) once
import { NativeMemory } from "../../native/memory.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { installShopFont } from "./shop-font.ts";
import { textRevealTick, type TextRevealHost } from "./text-window.ts";
import { createResidentTextServices, createResidentWidgets } from "./resident-text-host.ts";
import { setTextScroll, getUnkC3 } from "./text-element-setters.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
  PLACE_CARD_AREA_BANK_BASE, PLACE_CARD_BAR_COUNT, PLACE_CARD_BAR_SIZE, PLACE_CARD_BAR_TEMPLATES,
  PLACE_CARD_BUSY, PLACE_CARD_EXTRA, PLACE_CARD_LAYER, PLACE_CARD_NAME_TABLE, PLACE_CARD_PLACE_BANK_BASE,
  PLACE_CARD_SIZE, PLACE_CARD_TASK_KEY, PLACE_CARD_TEXT_GLOBAL, PLACE_CARD_TICK,
  placeCardCreate, placeCardTick, type PlaceCardHost,
} from "./native/place-card.ts";

/** Where the two text banks are loaded. */
export const PLACE_CARD_AREA_BANK_ADDR = 0x801e0000;
export const PLACE_CARD_PLACE_BANK_ADDR = 0x801e8000;
export const PLACE_CARD_BANK_LIMIT = 0x8000;
/** The full-screen rectangle the field gives view 0x1003 on entry (F0x8008AA10: sp18..sp1E). */
export const PLACE_CARD_FULL_SLIT = Object.freeze({ x: 0, y: 0, w: 0x140, h: 0xf0 });
/** The ordering-table entry the bar quads are linked into (+0x138(1)). */
export const PLACE_CARD_BAR_BUCKET = 1;
const OT_TERMINATOR = 0x00ffffff;

/** The shipped bank ids for a language byte (0..6): area names and place names. */
export function placeCardBankIds(language: number): { area: number; place: number } {
  if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Place card: invalid language");
  return { area: PLACE_CARD_AREA_BANK_BASE + language, place: PLACE_CARD_PLACE_BANK_BASE + language };
}

/** The {area, place} string indices the name table gives a scene, or null (F0x800875AC's scan). */
export function placeCardRecord(nameTable: Uint8Array, scene: number): { area: number; place: number } | null {
  const want = (scene << 16) >> 16;
  for (let off = 0; off + 4 <= nameTable.length; off += 4) {
    const id = ((nameTable[off + 2]! | nameTable[off + 3]! << 8) << 16) >> 16;
    if (id === 0) return null;
    if (id === want) return { area: nameTable[off]!, place: nameTable[off + 1]! };
  }
  return null;
}

export interface PlaceCardResources {
  /** The resident UI font (web/assets/data/shop_font.bin). */
  font: Uint8Array;
  /** fieldstg 0x80097098: {u8 area, u8 place, s16 scene} records, zero-scene terminated. */
  nameTable: Uint8Array;
  /** fieldstg 0x80097458: ten 0x24-byte bar templates. */
  barTemplates: Uint8Array;
}
export interface PlaceCardBeginOptions {
  /** The scene id [0x8004B438] (the name table's s16 key). */
  scene: number;
  /** Language byte [0x8005CCA8]. */
  language: number;
  /** Bank 0xA9 + language and bank 0xB7 + language, as shipped in web/assets/data/place-banks/. */
  areaBank: Uint8Array;
  placeBank: Uint8Array;
  /** The create argument; the field's one call site passes 1 (F0x8008AA10). */
  show?: number;
}
/** One GP0 0x28 flat quad, in the order the GPU paints it. */
export interface PlaceCardQuad { x: number; y: number; w: number; h: number; colour: [number, number, number] }
export interface PlaceCardSlit { x: number; y: number; w: number; h: number }

export class PlaceCardSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  private readonly host: PlaceCardHost;
  private readonly revealHost: TextRevealHost;
  private readonly view: number;
  private readonly ot: number;
  private readonly packets: number;
  private obj = 0;
  private scene = 0;
  private cursor = 0;
  private released = false;
  private quads: PlaceCardQuad[] = [];
  /** Callbacks run since begin(). */
  frames = 0;

  constructor(resources: PlaceCardResources) {
    const mem = this.mem;
    if (resources.barTemplates.length !== PLACE_CARD_BAR_COUNT * PLACE_CARD_BAR_SIZE) {
      throw new Error("Place card: invalid bar templates");
    }
    if (resources.nameTable.length < 4 || resources.nameTable.length % 4) throw new Error("Place card: invalid name table");
    installShopFont(mem, resources.font);
    mem.load(resources.nameTable, PLACE_CARD_NAME_TABLE);
    mem.load(resources.barTemplates, PLACE_CARD_BAR_TEMPLATES);

    this.widgets = createResidentWidgets(mem);
    this.view = this.widgets.arena.alloc(0x80, 4);
    this.ot = this.widgets.arena.alloc(8, 4);
    this.packets = this.widgets.arena.alloc(PLACE_CARD_BAR_COUNT * 0x18, 4);
    mem.write32(this.view + 0x5c, this.ot);
    // The card's widgets carry no reveal sound (+0xC8 stays 0) and no skip.
    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Place card", playSound: () => {}, padWord: () => 0,
    }).revealHost;
    this.host = this.cardHost();
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(PLACE_CARD_TICK, {
      name: "place card", childSlots: [], terminalTick: true,
      tick: (task, extra) => placeCardTick(mem, this.host, task, extra),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
  }

  private cardHost(): PlaceCardHost {
    const mem = this.mem;
    return {
      callMethod: (target, slot, args) => {
        target >>>= 0;
        if (this.tree.tasks.has(target)) { this.tree.callMethod(target, slot, args); return 0; }
        if (target === this.view) {
          switch (slot) {
            case 0x110: mem.write16(target, args[0]! & 0xffff); mem.write16(target + 2, args[1]! & 0xffff); return 0;
            case 0x114: mem.write16(target + 4, args[0]! & 0xffff); mem.write16(target + 6, args[1]! & 0xffff); return 0;
            case 0x138: return (mem.read32(target + 0x5c) + (args[0]! | 0) * 4) >>> 0;
          }
          throw new Error(`Place card: untranslated view method ${slot.toString(16)}`);
        }
        // A scene with no name record leaves both widget words 0, and sub-state 4 calls +0x168
        // through them. On the console that jumps through the kernel-area word at 0x00000168;
        // the session answers "not finished" (see begin()).
        if (target === 0 && slot === 0x168) return 0;
        switch (slot) {
          case 0x114: this.widgets.textSet(target, args[0]! >>> 0, args[1]! | 0); return 0;
          case 0x130: setTextScroll(mem, target, args[0]! | 0); return 0;
          case 0x168: return getUnkC3(mem, target);
        }
        throw new Error(`Place card: untranslated widget method ${slot.toString(16)}`);
      },
      createTask: (handler, size, extra, key) => {
        if ((handler >>> 0) !== PLACE_CARD_TICK || size !== PLACE_CARD_SIZE || extra !== PLACE_CARD_EXTRA
            || key !== PLACE_CARD_TASK_KEY) {
          throw new Error("Place card: unexpected task allocation");
        }
        const task = this.tree.allocate(handler >>> 0, size, extra);
        mem.write32(task, key >>> 0);
        return task;
      },
      createText: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      sceneId: () => this.scene,
      textBank: (bank) => {
        const lang = mem.read32(PLACE_CARD_TEXT_GLOBAL);
        if ((bank >>> 0) === ((lang + PLACE_CARD_AREA_BANK_BASE) >>> 0)) return PLACE_CARD_AREA_BANK_ADDR;
        if ((bank >>> 0) === ((lang + PLACE_CARD_PLACE_BANK_BASE) >>> 0)) return PLACE_CARD_PLACE_BANK_ADDR;
        throw new Error(`Place card: unloaded text bank ${bank}`);
      },
      viewForKey: (key) => {
        if (key !== PLACE_CARD_LAYER) throw new Error(`Place card: no view for ${key.toString(16)}`);
        return this.view;
      },
        frameDelta,
      packetCursor: () => this.cursor,
      flushPacketCursor: (cursor) => { this.cursor = cursor >>> 0; },
    };
  }

  /**
   * F0x80087D68(show): build the card for a stage entry. The first tick builds the bars and
   * the two names.
   *
   * A scene the name table does not list (none of the shipped scenes; only a hand-made id)
   * runs exactly as the original's code runs: no text widgets, the bars still slide in, and
   * sub-state 4 then waits on two null widgets. The original reads that answer from the
   * kernel word at 0x00000168, which this session cannot know, so it answers "not finished":
   * the bars stay up in state 1, the card never parks, and busy stays raised. The session
   * neither invents a release nor hides the bars.
   */
  begin(options: PlaceCardBeginOptions): void {
    placeCardBankIds(options.language);
    for (const bank of [options.areaBank, options.placeBank]) {
      if (bank.length < 8 || bank.length > PLACE_CARD_BANK_LIMIT) throw new Error("Place card: invalid text bank");
    }
    this.dispose();
    const mem = this.mem;
    for (const [addr, bank] of [[PLACE_CARD_AREA_BANK_ADDR, options.areaBank], [PLACE_CARD_PLACE_BANK_ADDR, options.placeBank]] as const) {
      mem.bytes.fill(0, addr & 0x1fffff, (addr & 0x1fffff) + PLACE_CARD_BANK_LIMIT);
      mem.load(bank, addr);
    }
    mem.write32(PLACE_CARD_TEXT_GLOBAL, options.language);
    const full = PLACE_CARD_FULL_SLIT;
    mem.write16(this.view, full.x); mem.write16(this.view + 2, full.y);
    mem.write16(this.view + 4, full.w); mem.write16(this.view + 6, full.h);
    this.scene = options.scene | 0;
    this.released = false;
    this.quads = [];
    this.frames = 0;
    this.obj = placeCardCreate(mem, this.host, options.show ?? 1);
  }

  /**
   * One card callback. `delta` is the frame delta [0x8004DF9C] the hold accumulates.
   * `stageReady` is the field's own entry sequence having finished: the first tick it is true
   * while the card is parked in state 2, the field calls +0x2C(1) on it, once
   * (F0x8008AA10 case 4).
   */
  tick(stageReady = true): void {
    const obj = this.obj;
    if (!obj || !this.tree.tasks.has(obj)) return;
    const mem = this.mem;
    // GUESS: the field's entry task runs before the card's callback in the same frame.
    if (stageReady && !this.released && (mem.read32(obj + 0x0c) | 0) === 2) {
      this.tree.callMethod(obj, 0x2c, [1]);
      this.released = true;
    }
    this.cursor = this.packets;
    mem.write32(this.ot + PLACE_CARD_BAR_BUCKET * 4, OT_TERMINATOR);
    this.tree.tick(obj);
    this.frames++;
    // GUESS: the widgets are scheduled after the card (the oracle's order).
    this.widgets.forEachText((widget) => textRevealTick(mem, this.revealHost, widget));
    this.quads = this.readBucket();
    if (!this.tree.tasks.has(obj)) this.obj = 0;
  }

  /** The bar quads the last tick linked, in the order the GPU paints them (first is bottom). */
  private readBucket(): PlaceCardQuad[] {
    const mem = this.mem;
    const out: PlaceCardQuad[] = [];
    const s16 = (a: number): number => (mem.read16(a) << 16) >> 16;
    let link = mem.read32(this.ot + PLACE_CARD_BAR_BUCKET * 4) & 0xffffff;
    while (link !== OT_TERMINATOR) {
      const pkt = (0x80000000 | link) >>> 0;
      const colour = mem.read32(pkt + 4);
      const x = s16(pkt + 8), y = s16(pkt + 0x0a);
      out.push({ x, y, w: s16(pkt + 0x0c) - x, h: s16(pkt + 0x12) - y,
        colour: [colour & 0xff, (colour >>> 8) & 0xff, (colour >>> 16) & 0xff] });
      link = mem.read32(pkt) & 0xffffff;
      if (out.length > PLACE_CARD_BAR_COUNT) throw new Error("Place card: ordering-table chain does not end");
    }
    return out;
  }

  /** The task is alive (it is freed the tick after the slit closes). */
  isActive(): boolean { return this.obj !== 0 && this.tree.tasks.has(this.obj); }

  /** The busy flag [0x80099DD4]: raised on create, cleared by the card's last callback. */
  busy(): boolean { return this.mem.read32(PLACE_CARD_BUSY) !== 0; }

  /** The flat quads of the last tick, in paint order. */
  drawIntents(): PlaceCardQuad[] { return this.quads; }

  /** View 0x1003's clip rectangle: the bars and both names draw inside it. */
  slit(): PlaceCardSlit {
    const m = this.mem, v = this.view;
    const s16 = (a: number): number => (m.read16(a) << 16) >> 16;
    return { x: s16(v), y: s16(v + 2), w: s16(v + 4), h: s16(v + 6) };
  }

  /** Live text widgets for the native UI-font painter (both draw at ordering-table entry 0). */
  textWidgets(): ReturnType<ShopWidgetServices["textWidgets"]> { return this.widgets.textWidgets(); }

  /** Diagnostics; null when no card is alive. */
  state(): { state: number; step: number; hold: number; released: boolean; busy: boolean;
             bars: Array<{ enabled: boolean; x: number; y: number; w: number; h: number; axis: number }>;
             names: Array<{ revealed: number; total: number; ended: boolean } | null> } | null {
    if (!this.isActive()) return null;
    const m = this.mem, o = this.obj;
    const s16 = (a: number): number => (m.read16(a) << 16) >> 16;
    const bars = [];
    for (let i = 0; i < PLACE_CARD_BAR_COUNT; i++) {
      const r = o + 0x50 + i * PLACE_CARD_BAR_SIZE;
      bars.push({ enabled: m.read32(r) !== 0, x: s16(r + 4), y: s16(r + 6), w: s16(r + 8), h: s16(r + 0x0a),
        axis: m.read32(r + 0x10) | 0 });
    }
    const extra = m.read32(o + 0x24) >>> 0;
    const names = [0, 4].map((k) => {
      const w = m.read32(extra + k) >>> 0;
      return w ? { revealed: m.read16(w + 0xa4), total: m.read16(w + 0x62), ended: m.read8(w + 0xc3) !== 0 } : null;
    });
    return { state: m.read32(o + 0x0c) | 0, step: m.read32(o + 0x10) | 0, hold: m.read32(o + 0x14) | 0,
      released: this.released, busy: this.busy(), bars, names };
  }

  /** Drop the card (the field left another way). The busy flag is lowered with it. */
  dispose(): void {
    if (this.obj !== 0 && this.tree.tasks.has(this.obj)) this.tree.dispose(this.obj);
    this.obj = 0;
    this.quads = [];
    this.mem.write32(PLACE_CARD_BUSY, 0);
  }
}
