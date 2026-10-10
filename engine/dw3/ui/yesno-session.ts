// Frame owner for the field Yes/No question box (wstag210 F0x800A680C and its seven homologues): a
// prompt line, two choice rows and a cursor in a folding CMFONT window, which starts one of two events.
// It composes the translated routine into one task and supplies the services it calls. No PlayStation
// instruction is executed.
//
// The routine: engine/dw3/ui/native/yesno-launcher.ts, proved by tests/lane-b/yesno-launcher.test.js.
// Its creator (s210 file offset 0xFE8, F0x800A6DC8) is F0x80014504(tick, 0x64, 0x14): a 0x64-byte object
// and a 0x14-byte extra block (prompt, Yes row, No row, cursor icon, started-event handle).
//
// Service map, each an existing translated provider (wired as pause-root-session / dialogue-session do):
//   object factory F0x80014504        -> TranslatedTaskTree.allocate(tick, 0x64, 0x14)
//   obj+0x38                          -> TranslatedTaskTree default (advance0)
//   text widgets F0x8001AE38 + slots  -> ShopWidgetServices / dispatchWidgetMethod (+0x114/+0x144/+0x15C)
//   cursor F0x8001B364 + +0x80/+0x84  -> ShopWidgetServices.spawnUiIcon, ticked by tickCursors (0x8001B0A4)
//   fold pair [foldStartCell/TickCell] -> window-fold.ts windowFoldStart / windowFoldTick, plus the
//                                        0x40019 / 0x4001A SFX the stage's start routine plays
//   pack getter [0x80044F5C]          -> the launcher's ESDMG entry pack loaded at YESNO_PACK_BASE for
//                                        ([0x8005CCA8] << 16) + textHandle; 0x02860000 (CMFONT) -> the handle
//   text glyph tick                   -> textRevealTick + drawTextElement, as DialogueSession runs it
//   pad +0x3F4 / +0x3FC / +0x408      -> the pressed / repeat masks the caller passes (identity button map:
//                                        Up bit 4, Down bit 6, confirm bit 13)
//   picture service F0x8001F648       -> ShopDrawIntents (ctx+0x98 is ignored, as pause-root-session does)
//   start_event F0x800853F8           -> NOT run here: recorded and handed to the host (onStartEvent)
//
// Language: [0x8005CCA8] is written 0, so the handle names entry (handle & 0xFFFF) of the shipped ESDMG
// bank (esdmg200.bin for 0x0112, esdmg270.bin for 0x0120), which is the English text.
//
// Step 4 waits for extra+0x10 (the handle start_event returned) to read 0. In the original nothing ever
// writes it again: wstag210.s 0xe34 / 0x141c are the only stores (the handle itself), and start_event
// always returns its runner object (fieldstg.s 0x28a4-0x28bc). So the original box never closes through
// step 4; it is already hidden at step 10, and the stage change (Yes) or the next unload ends it.
// The host's childDone() is a walker stand-in for "the answer ended": it shows the same picture and is
// what carries the answer's handoff (s210 Yes -> stage 212) to onClose.
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
  YESNO_LAUNCHERS, YESNO_TEXT_GLOBAL, YESNO_WINDOW_PACK, yesNoLauncherTick, type YesNoHost, type YesNoLauncher,
} from "./native/yesno-launcher.ts";

export { YESNO_LAUNCHERS, type YesNoLauncher };

/** Where the launcher's text pack (one ESDMG entry) is loaded. */
export const YESNO_PACK_BASE = 0x801e0000;
export const YESNO_PACK_LIMIT = 0x10000;
/** F0x80014504 arguments of the launcher's creator (s210 F0x800A6DC8). */
export const YESNO_OBJECT_SIZE = 0x64;
export const YESNO_EXTRA_SIZE = 0x14;
/** The started-event handle extra+0x10 holds while the host runs the event (any nonzero word). */
export const YESNO_EVENT_PENDING = 0x80160000;
/** Pad bits (identity logical-button map). */
export const YESNO_PAD_UP = 1 << 4;
export const YESNO_PAD_DOWN = 1 << 6;
export const YESNO_PAD_CONFIRM = 1 << 13;
const DRAW_CTX = 0x7ff00000;

/**
 * The ESDMG file (as shipped in web/assets/data/dialogue-box/) a text handle's high half names.
 * 0x0158 is the Amaterasu bank the eight-topic help menus read (entries 1, 2, 8 and 9); the five
 * Family A controllers pass the same resolver as the Yes/No boxes.
 */
export function yesNoTextFile(textHandle: number): string {
  const bank = (textHandle >>> 16) & 0xffff;
  if (bank === 0x0112) return "esdmg200";
  if (bank === 0x0120) return "esdmg270";
  if (bank === 0x0158) return "esdmg900";
  throw new Error(`YesNo: unknown text bank ${bank.toString(16)}`);
}

/** Find a launcher row by stage module (or number) and launch label. */
export function yesNoLauncherFor(stage: string | number, label: number): YesNoLauncher | null {
  const module = typeof stage === "number" ? `pro/wstag${stage}` : stage.includes("/") ? stage : `pro/${stage}`;
  return YESNO_LAUNCHERS.find((l) => l.module === module && l.label === label) ?? null;
}

export interface YesNoPad { pressed: number; repeat: number }
export interface YesNoDrawIntents { calls: ShopDrawCall[]; contextMarkers: number[] }
export interface YesNoCallbacks {
  /** Called when the routine calls start_event(id); the host runs the event, then calls childDone(). */
  onStartEvent?: ((id: number) => void) | null;
  /** Called once when the routine reaches task state 3. */
  onClose?: (() => void) | null;
}

export class YesNoSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  onStartEvent: ((id: number) => void) | null = null;
  onClose: (() => void) | null = null;
  /** Every start_event id the routine asked for, in order. */
  readonly startedEvents: number[] = [];
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  private readonly revealHost: TextRevealHost;
  private readonly host: YesNoHost;
  private launcher: YesNoLauncher | null = null;
  private obj = 0;
  private closed = true;
  private frame = 0;
  private pad: YesNoPad = { pressed: 0, repeat: 0 };
  private doneDuringStart = false;
  private starting = false;

  /**
   * `cursorGlyphs` is the resident cursor string table (0x8004DCE0, five pointers) and its
   * strings (0x8005CCD0), as shop_catalog.json carries them. Without it the cursor child
   * (cursorHandler, F0x8001B0A4) gets a null string and draws nothing.
   */
  constructor(resources: ResidentTextResources) {
    const mem = this.mem;
    loadResidentResources(mem, resources);
    this.widgets = createResidentWidgets(mem);
    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "YesNo", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed,
    }).revealHost;
    this.host = this.launcherHost();
    const classes = new Map<number, TranslatedTaskClass>();
    for (const l of YESNO_LAUNCHERS) {
      if (classes.has(l.address)) continue;
      classes.set(l.address, {
        name: "yes/no launcher", childSlots: [],
        tick: (task, extra) => yesNoLauncherTick(mem, task, extra, this.host, this.launcher!),
      });
    }
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
  }

  private playSound(id: number): void { this.audio.play(id); }

  private call = (target: number, slot: number, args: number[] = []): number =>
    callTaskOrWidget(this.mem, this.tree, this.widgets, target, slot, args);

  private launcherHost(): YesNoHost {
    const mem = this.mem;
    const d = this.draw;
    return {
      callMethod: this.call,
      createText: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      spawnIcon: (layer, kind, x, y) => this.widgets.spawnUiIcon(layer, kind, x, y),
      lookup: (handle) => {
        handle >>>= 0;
        if (handle === YESNO_WINDOW_PACK) return d.packResolve(handle);
        const want = ((mem.read32(YESNO_TEXT_GLOBAL) << 16) + this.launcher!.textHandle) >>> 0;
        if (handle !== want) throw new Error(`YesNo: no pack for handle ${handle.toString(16)}`);
        return YESNO_PACK_BASE;
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
      startEvent: (id) => {
        this.startedEvents.push(id | 0);
        this.starting = true;
        this.doneDuringStart = false;
        try { this.onStartEvent?.(id | 0); } finally { this.starting = false; }
        return this.doneDuringStart ? 0 : YESNO_EVENT_PENDING;
      },
      drawInit: () => { d.initDrawContext(); return DRAW_CTX; },
      drawCall: (_ctx, slot, args) => d.callSlot(slot, args, "YesNo"),
    };
  }

  /**
   * Create the launcher (F0x800A6DC8): `launcher` is a YESNO_LAUNCHERS row, `pack` the ESDMG entry
   * (handle & 0xFFFF) of yesNoTextFile(textHandle). The first tick builds the widgets.
   */
  open(row: Pick<YesNoLauncher, "module" | "address">, pack: Uint8Array, callbacks: YesNoCallbacks = {}): void {
    const launcher = YESNO_LAUNCHERS.find((l) => l.module === row.module && l.address === row.address);
    if (!launcher) throw new Error("YesNo: not a YESNO_LAUNCHERS row");
    if (pack.length < 8 || pack.length > YESNO_PACK_LIMIT) throw new Error("YesNo: invalid text pack");
    this.dispose();
    this.mem.bytes.fill(0, YESNO_PACK_BASE & 0x1fffff, (YESNO_PACK_BASE & 0x1fffff) + YESNO_PACK_LIMIT);
    this.mem.load(pack, YESNO_PACK_BASE);
    this.mem.write32(YESNO_TEXT_GLOBAL, 0);
    this.launcher = launcher;
    if (callbacks.onStartEvent !== undefined) this.onStartEvent = callbacks.onStartEvent;
    if (callbacks.onClose !== undefined) this.onClose = callbacks.onClose;
    this.startedEvents.length = 0;
    this.obj = this.tree.allocate(launcher.address, YESNO_OBJECT_SIZE, YESNO_EXTRA_SIZE);
    this.closed = false;
  }

  /** One display tick. `pressed` is +0x3F4, `repeat` is +0x3FC (Up bit 4, Down bit 6, confirm bit 13). */
  tick(pad: Partial<YesNoPad> = {}): void {
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

  /** The started event has finished: extra+0x10 reads 0, so the routine reaches state 3 next tick. */
  childDone(): void {
    if (this.starting) { this.doneDuringStart = true; return; }
    if (this.closed || !this.tree.tasks.has(this.obj)) return;
    const extra = this.tree.tasks.get(this.obj)!.children;
    this.mem.write32(extra + 0x10, 0);
  }

  isOpen(): boolean { return !this.closed; }

  /** The last tick's picture calls (CMFONT clip 0x45 window, scaled about (0, 0xC3) while folding). */
  drawIntents(): YesNoDrawIntents { return { calls: this.draw.calls, contextMarkers: this.draw.contextMarkers }; }

  /** Live text widgets for the native UI-font painter (prompt and the two rows). */
  textWidgets(): ReturnType<ShopWidgetServices["textWidgets"]> { return this.widgets.textWidgets(); }

  /** Packed sound ids since the last call (0x40019 open, 0x4001A close, 0x8004513E move, 0x8004503C confirm). */
  takeSounds(): number[] { return this.audio.take(); }

  /** Diagnostics: task state, step, selection, fold value; null when closed. */
  state(): { state: number; step: number; selection: number; fold: number; event: number } | null {
    if (this.closed || !this.tree.tasks.has(this.obj)) return null;
    const m = this.mem;
    const extra = this.tree.tasks.get(this.obj)!.children;
    return {
      state: m.read32(this.obj + 0x0c) | 0, step: m.read32(this.obj + 0x10) | 0,
      selection: m.read32(this.obj + 0x50) | 0, fold: m.read32(this.obj + 0x5c) | 0,
      event: m.read32(extra + 0x10) >>> 0,
    };
  }

  /** Dispose of the launcher (the field left another way); onClose is not called. */
  dispose(): void {
    if (this.obj !== 0) this.tree.dispose(this.obj);
    this.obj = 0;
    this.closed = true;
  }
}
