// Frame owner for the field eight-topic help menu (wstag210 F0x800A5E74 and its four copies): the
// counter says its line, then this takes the screen — eight titles down the right, a cursor beside
// them, and a page of help text in a folding CMFONT window. It composes the translated routine into
// one task and supplies the services it calls. No PlayStation instruction is executed.
//
// The routine: engine/dw3/ui/native/help-menu-launcher.ts, proved by
// tests/lane-b/help-menu-launcher.test.js. Its creator is the eleven-instruction trampoline
// F0x80014504(tick, 0x84, 0x28): a 0x84-byte object and a 0x28-byte extra block (the eight rows,
// the cursor icon, the page text). The menu starts no event, so nothing is handed back to the host.
//
// Service map, each an existing translated provider (wired as yesno-session / dialogue-session do):
//   object factory F0x80014504        -> TranslatedTaskTree.allocate(tick, 0x84, 0x28)
//   obj+0x38                          -> TranslatedTaskTree default (advance0)
//   text widgets F0x8001AE38 + slots  -> ShopWidgetServices / dispatchWidgetMethod (+0x114/+0x144/
//                                        +0x15C/+0x160), and for the page also +0x128 (the
//                                        visible-window rescan), +0x130 (the typewriter),
//                                        +0x168/+0x170 (still typing / waiting for a page turn)
//   cursor F0x8001B364 + +0x80/+0x84  -> ShopWidgetServices.spawnUiIcon, ticked by tickCursors
//   cursor +0x88 / +0x94              -> uiIconSetUnk60 / uiIconSetUnk7c (the window's page mode)
//   fold pair [foldStartCell/TickCell] -> window-fold.ts windowFoldStart / windowFoldTick, plus the
//                                        0x40019 / 0x4001A SFX the stage's start routine plays
//   pack getter [0x80044F5C]          -> the menu's ESDMG entry pack loaded at HELP_PACK_BASE for
//                                        ([0x8005CCA8] << 16) + textHandle; 0x02860000 (CMFONT) -> the
//                                        handle. The rows and the page share that one cell.
//   text glyph tick                   -> textRevealTick + drawTextElement, as DialogueSession runs it
//   pad +0x3F4 / +0x3FC / +0x408      -> the pressed / repeat masks the caller passes (identity button
//                                        map: Up bit 4, Down bit 6, confirm bit 13, Cancel bit 14)
//   tick counter [0x8005DE10 + 0x188] -> the same display-tick service tickCursors is given, which is
//                                        how the cursor handler's resident counter is served
//   picture service F0x8001F648       -> ShopDrawIntents (ctx+0xA8 is ignored, as yesno-session does)
//
// Language: [0x8005CCA8] is written 0, so the handle names entry (handle & 0xFFFF) of the shipped
// ESDMG bank (esdmg200.bin for 0x0112, esdmg900.bin for 0x0158), which is the English text.
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ShopDrawIntents, type ShopDrawCall } from "./shop-draw-intents.ts";
import { rescanVisibleWindow, textRevealTick, type TextRevealHost } from "./text-window.ts";
import { dispatchWidgetMethod } from "./screen-services.ts";
import { getUnkC3, isState1, setTextScroll } from "./text-element-setters.ts";
import {
  callTaskOrWidget, createResidentTextServices, createResidentWidgets, loadResidentResources,
  type ResidentTextResources,
} from "./resident-text-host.ts";
import { windowFoldStart, windowFoldTick, WINDOW_FOLD_CLOSE_SFX, WINDOW_FOLD_OPEN_SFX } from "./window-fold.ts";
import {
  HELP_MENUS, HELP_WINDOW_PACK, helpMenuTick, type HelpMenu, type HelpMenuHost,
} from "./native/help-menu-launcher.ts";
import { YESNO_TEXT_GLOBAL } from "./native/yesno-launcher.ts";

export { HELP_MENUS, type HelpMenu };

/** Where the menu's text pack (one ESDMG entry) is loaded. */
export const HELP_PACK_BASE = 0x801e0000;
export const HELP_PACK_LIMIT = 0x10000;
/** F0x80014504 arguments of the menu's creator. */
export const HELP_OBJECT_SIZE = 0x84;
export const HELP_EXTRA_SIZE = 0x28;
/** Pad bits (identity logical-button map). */
export const HELP_PAD_UP = 1 << 4;
export const HELP_PAD_DOWN = 1 << 6;
export const HELP_PAD_CONFIRM = 1 << 13;
export const HELP_PAD_CANCEL = 1 << 14;
const DRAW_CTX = 0x7ff00000;

/** Find a menu row by stage module (or number) and launch label. */
export function helpMenuFor(stage: string | number, label: number): HelpMenu | null {
  const module = typeof stage === "number" ? `pro/wstag${stage}` : stage.includes("/") ? stage : `pro/${stage}`;
  return HELP_MENUS.find((m) => m.module === module && m.label === label) ?? null;
}

export interface HelpMenuPad { pressed: number; repeat: number }
export interface HelpMenuDrawIntents { calls: ShopDrawCall[]; contextMarkers: number[] }

export class HelpMenuSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  onClose: (() => void) | null = null;
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  private readonly revealHost: TextRevealHost;
  private readonly host: HelpMenuHost;
  private menu: HelpMenu | null = null;
  private obj = 0;
  private closed = true;
  private frame = 0;
  private pad: HelpMenuPad = { pressed: 0, repeat: 0 };

  /** `cursorGlyphs` is the resident cursor string table (0x8004DCE0) and its strings (0x8005CCD0). */
  constructor(resources: ResidentTextResources) {
    const mem = this.mem;
    loadResidentResources(mem, resources);
    this.widgets = createResidentWidgets(mem);
    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "HelpMenu", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed,
    }).revealHost;
    this.host = this.menuHost();
    const classes = new Map<number, TranslatedTaskClass>();
    for (const m of HELP_MENUS) {
      if (classes.has(m.address)) continue;
      classes.set(m.address, {
        name: "help menu", childSlots: [],
        tick: (task, extra) => helpMenuTick(mem, task, extra, this.host, this.menu!),
      });
    }
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
  }

  private playSound(id: number): void { this.audio.play(id); }

  /** One method call with its return value: a task's base method, else a widget method. */
  private call = (target: number, slot: number, args: number[] = []): number => {
    target >>>= 0;
    const mem = this.mem;
    if (this.tree.tasks.has(target)) {
      callTaskOrWidget(mem, this.tree, this.widgets, target, slot, args);
      return 0;
    }
    switch (slot) {
      case 0x128: return rescanVisibleWindow(mem, target);
      case 0x130: setTextScroll(mem, target, args[0]!); return 0;
      case 0x168: return getUnkC3(mem, target);
      case 0x170: return isState1(mem, target);
      default:
        callTaskOrWidget(mem, this.tree, this.widgets, target, slot, args);
        return 0;
    }
  };

  private menuHost(): HelpMenuHost {
    const mem = this.mem;
    const d = this.draw;
    const pack = (handle: number): number => {
      handle >>>= 0;
      if (handle === HELP_WINDOW_PACK) return d.packResolve(handle);
      const want = ((mem.read32(YESNO_TEXT_GLOBAL) << 16) + this.menu!.textHandle) >>> 0;
      if (handle !== want) throw new Error(`HelpMenu: no pack for handle ${handle.toString(16)}`);
      return HELP_PACK_BASE;
    };
    return {
      callMethod: this.call,
      createText: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      spawnIcon: (layer, kind, x, y) => this.widgets.spawnUiIcon(layer, kind, x, y),
      lookup: pack,
      foldStart: (fold, direction) => {
        windowFoldStart(mem, fold, direction);
        this.playSound(direction ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
      },
      foldTick: (fold) => windowFoldTick(mem, fold),
      padRead: () => this.pad.pressed,
      padAlt: () => this.pad.repeat,
      padShift: (_port, button) => button,
      playSound: (id) => this.playSound(id),
      tickCount: () => this.frame,
      drawInit: () => { d.initDrawContext(); return DRAW_CTX; },
      drawCall: (_ctx, slot, args) => d.callSlot(slot, args, "HelpMenu"),
    };
  }

  /**
   * Create the menu: `menu` is a HELP_MENUS row, `pack` the ESDMG entry
   * (handle & 0xFFFF) of yesNoTextFile(textHandle). The first tick builds the widgets.
   */
  open(row: Pick<HelpMenu, "module" | "address">, pack: Uint8Array, callbacks: { onClose?: (() => void) | null } = {}): void {
    const menu = HELP_MENUS.find((m) => m.module === row.module && m.address === row.address);
    if (!menu) throw new Error("HelpMenu: not a HELP_MENUS row");
    if (pack.length < 8 || pack.length > HELP_PACK_LIMIT) throw new Error("HelpMenu: invalid text pack");
    this.dispose();
    this.mem.bytes.fill(0, HELP_PACK_BASE & 0x1fffff, (HELP_PACK_BASE & 0x1fffff) + HELP_PACK_LIMIT);
    this.mem.load(pack, HELP_PACK_BASE);
    this.mem.write32(YESNO_TEXT_GLOBAL, 0);
    this.menu = menu;
    if (callbacks.onClose !== undefined) this.onClose = callbacks.onClose;
    this.obj = this.tree.allocate(menu.address, HELP_OBJECT_SIZE, HELP_EXTRA_SIZE);
    this.closed = false;
  }

  /** One display tick. `pressed` is +0x3F4, `repeat` is +0x3FC (Up 4, Down 6, confirm 13, Cancel 14). */
  tick(pad: Partial<HelpMenuPad> = {}): void {
    if (this.closed) return;
    this.frame++;
    this.pad = { pressed: (pad.pressed ?? 0) >>> 0, repeat: (pad.repeat ?? 0) >>> 0 };
    this.draw.beginFrame(this.frame);
    this.tree.tick(this.obj);
    this.widgets.tickCursors(this.frame);
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
    if (!this.tree.tasks.has(this.obj) || (this.mem.read32(this.obj + 0x0c) | 0) === 3) {
      this.dispose();
      this.onClose?.();
    }
  }

  isOpen(): boolean { return !this.closed; }

  /** The last tick's picture calls (CMFONT markers, scaled about (0x140, 0x56) while folding). */
  drawIntents(): HelpMenuDrawIntents { return { calls: this.draw.calls, contextMarkers: this.draw.contextMarkers }; }

  /** Live text widgets for the native UI-font painter (the eight rows and the page). */
  textWidgets(): ReturnType<ShopWidgetServices["textWidgets"]> { return this.widgets.textWidgets(); }

  /**
   * The page text widget (extra+0x24), 0 when closed. It is the one the routine types out
   * letter by letter (page +0x130), so the painter reveals only its revealed run; the eight row
   * titles are set whole and paint their whole line.
   */
  pageAddress(): number {
    if (this.closed || !this.tree.tasks.has(this.obj)) return 0;
    return this.mem.read32(this.tree.tasks.get(this.obj)!.children + 0x24) >>> 0;
  }

  /** Packed sound ids since the last call (0x40019 open, 0x4001A close, 0x8004513E move,
   *  0x8004503C confirm, 0x800450BD cancel, 0x4001C page turn). */
  takeSounds(): number[] { return this.audio.take(); }

  /** Diagnostics: task state, step, selection, row count, both fold values, prompt phase. */
  state(): {
    state: number; step: number; selection: number; rows: number;
    listFold: number; pageFold: number; promptPhase: number; pendingPage: number;
  } | null {
    if (this.closed || !this.tree.tasks.has(this.obj)) return null;
    const m = this.mem;
    return {
      state: m.read32(this.obj + 0x0c) | 0, step: m.read32(this.obj + 0x10) | 0,
      selection: m.read32(this.obj + 0x54) | 0, rows: m.read32(this.obj + 0x50) | 0,
      listFold: m.read32(this.obj + 0x6c) | 0, pageFold: m.read32(this.obj + 0x7c) | 0,
      promptPhase: m.read32(this.obj + 0x5c) | 0, pendingPage: m.read32(this.obj + 0x58) | 0,
    };
  }

  /** Dispose of the menu (the field left another way); onClose is not called. */
  dispose(): void {
    if (this.obj !== 0) this.tree.dispose(this.obj);
    this.obj = 0;
    this.closed = true;
  }
}