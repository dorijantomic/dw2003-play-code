// Frame owner for the inn (hotel) rest screen: the resident class the innkeeper opens
// (constructor F0x80011DAC, handler F0x800119A8, update F0x800110E0). It composes the translated
// routine into one task and supplies the services it calls. No PlayStation instruction is executed.
//
// The routine: engine/dw3/ui/native/inn-screen.ts, proved by tests/lane-b/inn-screen.test.js.
// The fade object: engine/dw3/ui/native/resident-fade.ts (F0x8001206C / F0x80011DEC / F0x80011FB8).
//
// Service map (wired as yesno-session.ts does):
//   object factory F0x80014504        -> TranslatedTaskTree.allocate(F0x800119A8, 0xA0, 0x20)
//   obj+0x38                          -> TranslatedTaskTree default (advance0)
//   text widgets F0x8001AE38 + slots  -> ShopWidgetServices / dispatchWidgetMethod (+0x114/+0x118/+0x144/+0x148)
//   cursor F0x8001B364 + +0x80/+0x84  -> ShopWidgetServices.spawnUiIcon, ticked by tickCursors
//   fold pair f13 / F0x80010FE0       -> window-fold.ts, plus the 0x40019 / 0x4001A fold SFX
//   inn table D0x8003EDCC             -> written from INN_RECORDS (engine/dw3/inn.ts, the data.rs table)
//   screen id [0x8004B438]            -> the matched record's screen id
//   party probe [0x8004B44C]          -> slots 0..partyCount-1 answer 0, the rest -1
//   text bank [0x80044F4C](lang+0x5C) -> the shipped eshtlnam bank, loaded at INN_BANK_BASE
//   BIT D0x80048DA0                   -> seeded; read back with bits()
//   exclusive sound register 0x80055C34 -> seeded with the caller's current exclusive id
//   clock [0x8004DE10+0x188]          -> the display tick the caller passes
//   fade F0x8001206C                  -> the translated resident fade task; its draw is fadeIntent()
//   rest effect F0x8001104C           -> NOT run here: handed to the host (onRest)
//   picture service F0x8001F648       -> ShopDrawIntents (ctx+0x98 ignored, as yesno-session does)
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ShopDrawIntents, type ShopDrawCall } from "./shop-draw-intents.ts";
import { textRevealTick, type TextRevealHost } from "./text-window.ts";
import {
  callTaskOrWidget, createResidentTextServices, createResidentWidgets, loadResidentResources,
  type ResidentTextResources,
} from "./resident-text-host.ts";
import { windowFoldStart, windowFoldTick, WINDOW_FOLD_CLOSE_SFX, WINDOW_FOLD_OPEN_SFX } from "./window-fold.ts";
import {
  INN_BIT_TOTAL, INN_MUSIC_CURRENT, INN_REST_MUSIC, INN_SCREEN_EXTRA, INN_SCREEN_HANDLER, INN_SCREEN_SIZE,
  INN_TABLE, INN_TEXT_BANK_BASE, INN_TEXT_GLOBAL, INN_WINDOW_PACK, innScreenCreate, innScreenHandler,
  type InnScreenHost,
} from "./native/inn-screen.ts";
import { registerResidentFade, residentFadeCreate, type ResidentFadeDraw } from "./native/resident-fade.ts";
import { INN_RECORDS, type InnRecord } from "../inn.ts";

export type { ResidentFadeDraw };

/** Where the eshtlnam bank is loaded. */
export const INN_BANK_BASE = 0x801e0000;
export const INN_BANK_LIMIT = 0x10000;
/** The layer the innkeeper's launcher passes to F0x80011DAC (D0x8008C000). */
export const INN_LAYER = 0x1002;
/** Pad bits (identity logical-button map): Up 4, Down 6, Confirm 13, Cancel 14. */
export const INN_PAD_UP = 1 << 4;
export const INN_PAD_DOWN = 1 << 6;
export const INN_PAD_CONFIRM = 1 << 13;
export const INN_PAD_CANCEL = 1 << 14;
const DRAW_CTX = 0x7ff00000;

/** The shipped eshtlnam bank id for a language byte (0..6). */
export function innBankId(language: number): number {
  if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Inn: invalid language");
  return INN_TEXT_BANK_BASE + language;
}

export interface InnPad { pressed: number; repeat: number }
export interface InnDrawIntents { calls: ShopDrawCall[]; contextMarkers: number[] }
export interface InnOpenOptions {
  /** The inn record the current map names (innForStage), or its screen id. */
  inn: InnRecord | number;
  /** Party slots present, 0..3 (the probe over slots 0..2). */
  partyCount: number;
  /** Current BIT (D0x80048DA0). */
  bits: number;
  /** Language byte [0x8005CCA8]; the bank is eshtlnam language + 0x5C. */
  language: number;
  /** The eshtlnam bank for that language, as shipped in web/assets/data/inn-banks/. */
  bank: Uint8Array;
  /** The exclusive sound register 0x80055C34 at open (0 when nothing holds it). */
  exclusiveSound?: number;
}
export interface InnCallbacks {
  /** F0x8001104C: the rest effect (full HP/MP, three roster halfwords cleared). BIT is already charged. */
  onRest?: (() => void) | null;
  /** The inn's rest jingle (0x4004000D) and the restore of the saved exclusive sound. */
  onMusic?: ((id: number, kind: "rest" | "restore") => void) | null;
  /** Called once when the screen reaches task state 3. */
  onClose?: (() => void) | null;
}

export class InnSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  onRest: (() => void) | null = null;
  onMusic: ((id: number, kind: "rest" | "restore") => void) | null = null;
  onClose: (() => void) | null = null;
  /** Times the rest effect ran since open. */
  rests = 0;
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  private readonly revealHost: TextRevealHost;
  private readonly host: InnScreenHost;
  private obj = 0;
  private fade = 0;
  private fadeDraw: ResidentFadeDraw | null = null;
  private closed = true;
  private frame = 0;
  private clockValue = 0;
  private screen = 0;
  private partyCount = 0;
  private pad: InnPad = { pressed: 0, repeat: 0 };

  /** `cursorGlyphs`: the resident cursor string table, as shop_catalog.json carries it. */
  constructor(resources: ResidentTextResources) {
    const mem = this.mem;
    loadResidentResources(mem, resources);
    // D0x8003EDCC: { s32 screen, u16 eshtlnam index, u16 price } per inn, zero-screen terminated.
    INN_RECORDS.forEach((r, i) => {
      mem.write32(INN_TABLE + 8 * i, r.screen);
      mem.write32(INN_TABLE + 8 * i + 4, ((r.pricePerDigimon & 0xffff) << 16 | (r.nameIndex & 0xffff)) >>> 0);
    });
    mem.write32(INN_TABLE + 8 * INN_RECORDS.length, 0);
    mem.write32(INN_TABLE + 8 * INN_RECORDS.length + 4, 0);

    this.widgets = createResidentWidgets(mem);
    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Inn", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed,
    }).revealHost;
    this.host = this.screenHost();
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(INN_SCREEN_HANDLER, {
      name: "inn screen", childSlots: [],
      tick: (task, extra) => innScreenHandler(mem, task, extra, this.host),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    registerResidentFade(mem, this.tree, classes, (draw) => { this.fadeDraw = draw; });
  }

  private playSound(id: number): void {
    id >>>= 0;
    this.audio.play(id);
    if (id === INN_REST_MUSIC) this.onMusic?.(id, "rest");
    else if (this.obj && (this.mem.read32(this.obj + 0x10) | 0) === 23) this.onMusic?.(id, "restore");
  }

  private call = (target: number, slot: number, args: number[] = []): number =>
    callTaskOrWidget(this.mem, this.tree, this.widgets, target, slot, args);

  private screenHost(): InnScreenHost {
    const mem = this.mem;
    const d = this.draw;
    return {
      callMethod: this.call,
      allocObject: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      createText: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      spawnIcon: (layer, kind, x, y) => this.widgets.spawnUiIcon(layer, kind, x, y),
      screenId: () => this.screen,
      partyProbe: (slot) => (slot >= 0 && slot < this.partyCount ? 0 : -1),
      textBank: (bank) => {
        const want = ((mem.read32(INN_TEXT_GLOBAL) + INN_TEXT_BANK_BASE) >>> 0);
        if ((bank >>> 0) !== want) throw new Error(`Inn: unloaded text bank ${bank}`);
        return INN_BANK_BASE;
      },
      lookup: (handle) => {
        if ((handle >>> 0) !== INN_WINDOW_PACK) throw new Error(`Inn: no pack for handle ${(handle >>> 0).toString(16)}`);
        return d.packResolve(handle);
      },
      foldStart: (fold, direction) => {
        windowFoldStart(mem, fold, direction);
        this.playSound(direction ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
      },
      foldTick: (fold) => windowFoldTick(mem, fold),
      padRead: () => this.pad.pressed,
      padAlt: () => this.pad.repeat,
      padShift: (_port, button) => button,
      playSound: (id) => this.playSound(id),
      clock: () => this.clockValue,
      createFade: (layer) => (this.fade = residentFadeCreate(mem, this.tree, layer)),
      rest: () => { this.rests++; this.onRest?.(); },
      drawInit: () => { d.initDrawContext(); return DRAW_CTX; },
      drawCall: (_ctx, slot, args) => d.callSlot(slot, args, "Inn"),
    };
  }

  /** F0x80011DAC(0x1002): create the screen. The first tick builds the widgets. */
  open(options: InnOpenOptions, callbacks: InnCallbacks = {}): void {
    const { bank } = options;
    if (bank.length < 8 || bank.length > INN_BANK_LIMIT) throw new Error("Inn: invalid text bank");
    innBankId(options.language);
    if (!Number.isInteger(options.partyCount) || options.partyCount < 0) throw new Error("Inn: invalid party count");
    this.dispose();
    const mem = this.mem;
    mem.bytes.fill(0, INN_BANK_BASE & 0x1fffff, (INN_BANK_BASE & 0x1fffff) + INN_BANK_LIMIT);
    mem.load(bank, INN_BANK_BASE);
    mem.write32(INN_TEXT_GLOBAL, options.language);
    mem.write32(INN_BIT_TOTAL, options.bits >>> 0);
    mem.write32(INN_MUSIC_CURRENT, (options.exclusiveSound ?? 0) >>> 0);
    this.screen = typeof options.inn === "number" ? options.inn : options.inn.screen;
    this.partyCount = options.partyCount;
    if (callbacks.onRest !== undefined) this.onRest = callbacks.onRest;
    if (callbacks.onMusic !== undefined) this.onMusic = callbacks.onMusic;
    if (callbacks.onClose !== undefined) this.onClose = callbacks.onClose;
    this.rests = 0;
    this.fadeDraw = null;
    this.obj = innScreenCreate(mem, INN_LAYER, this.host);
    this.closed = false;
  }

  /**
   * One display tick. `pressed` is +0x3F4, `repeat` is +0x3FC (Up bit 4, Down bit 6, Confirm 13,
   * Cancel 14). `clock` is the frame clock [0x8004DE10+0x188]; it defaults to the tick count.
   */
  tick(pad: Partial<InnPad> = {}, clock?: number): void {
    if (this.closed) return;
    this.frame++;
    this.clockValue = (clock ?? this.frame) | 0;
    this.pad = { pressed: (pad.pressed ?? 0) >>> 0, repeat: (pad.repeat ?? 0) >>> 0 };
    this.draw.beginFrame(this.frame);
    this.fadeDraw = null;
    this.tree.tick(this.obj);
    // GUESS: the fade is a sibling in the scheduler; it runs after the screen in the same frame.
    if (this.fade && this.tree.tasks.has(this.fade)) this.tree.tick(this.fade);
    this.widgets.tickCursors(this.frame);
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
    if (!this.tree.tasks.has(this.obj) || (this.mem.read32(this.obj + 0x0c) | 0) === 3) {
      this.dispose();
      this.onClose?.();
    }
  }

  isOpen(): boolean { return !this.closed; }

  /** BIT after the screen's own charge (D0x80048DA0). */
  bits(): number { return this.mem.read32(INN_BIT_TOTAL) | 0; }

  /** The window picture calls of the last tick (CMFONT clips 0x41-0x44). */
  drawIntents(): InnDrawIntents { return { calls: this.draw.calls, contextMarkers: this.draw.contextMarkers }; }

  /** The fade quad of the last tick, or null when none was drawn. */
  fadeIntent(): ResidentFadeDraw | null { return this.fadeDraw; }

  /** Live text widgets for the native UI-font painter. */
  textWidgets(): ReturnType<ShopWidgetServices["textWidgets"]> { return this.widgets.textWidgets(); }

  /** Packed sound ids since the last call. */
  takeSounds(): number[] { return this.audio.take(); }

  /** Diagnostics: task state, step, selection, refused flag, party count, fade; null when closed. */
  state(): { state: number; step: number; selection: number; refused: number; party: number;
             folds: number[]; fadeState: number; fadeLevel: number } | null {
    if (this.closed || !this.tree.tasks.has(this.obj)) return null;
    const m = this.mem;
    const o = this.obj;
    const fadeLive = this.fade && this.tree.tasks.has(this.fade);
    return {
      state: m.read32(o + 0x0c) | 0, step: m.read32(o + 0x10) | 0, selection: m.read32(o + 0x5c) | 0,
      refused: m.read32(o + 0x14) | 0, party: m.read32(o + 0x60) | 0,
      folds: [m.read32(o + 0x74) | 0, m.read32(o + 0x84) | 0, m.read32(o + 0x94) | 0],
      fadeState: fadeLive ? m.read32(this.fade + 0x0c) | 0 : -1,
      fadeLevel: fadeLive ? ((m.read32(this.fade + 0x5c) | 0) >> 8) & 0xff : 0,
    };
  }

  /** Dispose of the screen (the field left another way); onClose is not called. */
  dispose(): void {
    if (this.obj !== 0) this.tree.dispose(this.obj);
    if (this.fade !== 0) this.tree.dispose(this.fade);
    this.obj = 0;
    this.fade = 0;
    this.closed = true;
  }
}
