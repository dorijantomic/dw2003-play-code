// Frame owner for the END card (pro/stdwtitl F0x80082E9C -> F0x80082D70 ->
// F0x80084628, drawn by F0x8008453C): the END / DIGIMON WORLD 3 card the title
// overlay raises before handing the machine to the first opening movie. It
// composes the translated card into one task tree and supplies the services the
// card calls. No PlayStation instruction is executed.
//
// The routines: engine/dw3/ui/native/end-card.ts, proved by
// tests/lane-b/end-card.test.js. The display service, the display view and the
// four shared screen-lifecycle methods are the existing translations
// (engine/dw3/display-service.ts, engine/dw3/display-view.ts,
// engine/dw3/ui/translated-task-tree.ts), called directly as the original calls
// them.
//
// Service map (wired as the oracle wires them):
//   task factory F0x80014504          -> TranslatedTaskTree.allocate(0x80082D70, 0x50, 4)
//                                         and (0x80084628, 0x54, 0); key 4 at the root's +0x00
//   task +0x28/+0x2C/+0x38/+0x3C      -> TranslatedTaskTree defaults (setState0/1, advance0/1)
//   scheduler F0x80018140             -> TranslatedTaskTree.tick, root then its one extra slot
//   display service +0x150/+0x154/+0x174/+0x16C -> resetDisplayService / setDisplayPacketIndex /
//                                         setDisplayRegion / registerDisplayView
//   view +0x12C                       -> setRectColour (the card asks for (0x1F,0x1F,0x1F))
//   layout context F0x8001FFA8 +0x24  -> the 0x34-byte context this session owns, with the
//                                         card's (0x280, 0) pair at +0x8/+0xC (F0x8001FD28)
//   layout context +0x2C              -> the pack layout pass (F0x8001FE38), a texture upload:
//                                         the walker already ships the composed frames as
//                                         web/assets/ui/endall_sheet.{png,json}, so the upload is
//                                         recorded as the boundary it is and nothing is re-run
//   pack resolver [0x80044F5C]        -> the two end__all handles (0x08A60001 the texture half,
//                                         0x08A60000 the sprite half the draw names)
//   2-D draw context F0x8001F648      -> ShopDrawIntents; +0x7C setLayer, +0x74 setOrigin,
//                                         +0x88 the CLUT row offset (the card's level),
//                                         +0x84 the sprite draw
//   frame delta [0x8004DF9C]          -> the delta passed to tick()
//   pad service (PAD_CELL_PRESSED / PAD_CELL_BUTTON_MAP) -> the held pad word and the bit of logical button 3
//                                         (the pad's Start bit), read EVERY frame while the card
//                                         waits: the original samples the held word, so a button
//                                         already down when the wait begins ends it at once
//   D0x80055C64 (stop every sound)    -> onStopAllSound, fired on the card's first callback
//   [0x8004B440](0xE01, 0)            -> onLaunch: the first opening movie. Nothing here plays
//                                         it — the walker ships no FMV for 0xE01 (the same gap as
//                                         the title's idle-timeout movie), so the request is
//                                         recorded and the lab closes the card as before
import { NativeMemory } from "../../native/memory.ts";
import { PAD_BLOCK } from "../../systems/pad-block.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
  DISPLAY_SERVICE, DISPLAY_SERVICE_FIELDS, VIEW_POOL_TABLE,
  type DisplayRegionHost, type DisplayViewHost,
} from "../display-service.ts";
import { ScreenPad } from "./screen-services.ts";
import type { ShopDrawCall } from "./shop-draw-intents.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { createResidentWidgets } from "./resident-text-host.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import {
  END_CARD_CLIP_BY_LANGUAGE, END_CARD_DRAW, END_CARD_LANGUAGE, END_CARD_LEVEL, END_CARD_ROOT_TICK,
  END_CARD_SEQUENCE_EXTRA, END_CARD_SEQUENCE_SIZE, END_CARD_SEQUENCE_SLOT, END_CARD_SEQUENCE_TICK,
  END_CARD_STATE, END_CARD_SUB, END_CARD_TIMER,
  endCardCreate, endCardDraw, endCardRootTick, endCardTick, type EndCardHost,
} from "./native/end-card.ts";

/**
 * The shipped ordering-table bucket sizes D0x8004DFA0: 2, 4, 8, ... 4096, which
 * F0x8001E5BC indexes by view type minus one. The card registers with type 2, so
 * its view's ordering tables hold four words each. Read from the executable's
 * static data (ledger `UI-DISPLAY-EXTENT-001`; data.rs D0x8004DFA0..D0x8004DFB4).
 */
export const END_CARD_OT_POOL_SIZES: readonly number[] = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

const DRAW_CTX = 0x7ff00000;
/** The pad service: PAD_CELL_PRESSED reads a port, PAD_CELL_BUTTON_MAP a bit. */
export { PAD_BLOCK as END_CARD_PAD_SERVICE };

export interface EndCardCallbacks {
  /** D0x80055C64 (F0x80020204): every sound stops when the card appears. */
  onStopAllSound?: () => void;
  /** [0x8004B440](code, 0): the card's last callback asks for the opening movie. */
  onLaunch?: (code: number) => void;
}

export interface EndCardBeginOptions {
  /** The language byte [0x8005CCA8]; the `eng` pack the walker ships is 2. */
  language?: number;
}

/**
 * The card's data input: the language table the extracted UI manifest carries
 * (`stdwtitl_ui.json` -> `end_screen.language_table.clip_by_language`). The four
 * pictures themselves ship as the screen pack `endall`, which the browser
 * painter loads; the card names only a clip index.
 */
export interface EndCardResources {
  clipByLanguage: readonly number[] | Record<string, number>;
}

export interface EndCardView {
  address: number;
  colour: [number, number, number];
  valid: boolean;
  entries: number;
}

export class EndCardSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  /** Times D0x80055C64 was called since the last take. */
  private stopCalls = 0;
  /** The launch codes the card asked for, oldest first. */
  readonly launches: number[] = [];
  private readonly host: EndCardHost;
  private readonly pad = new ScreenPad();
  private readonly onStopAllSound: (() => void) | undefined;
  private readonly onLaunch: ((code: number) => void) | undefined;
  private root = 0;
  private frame = 0;
  private closed = true;
  private context = 0;
  private drawEnv = 0;
  private packArea = 0;

  constructor(resources: EndCardResources, callbacks: EndCardCallbacks = {}) {
    const mem = this.mem;
    const shipped = typeof resources.clipByLanguage === "object" && !Array.isArray(resources.clipByLanguage)
      ? Object.entries(resources.clipByLanguage as Record<string, number>)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([, clip]) => clip)
      : [...(resources.clipByLanguage as readonly number[])];
    // The overlay's own table is seven words at file offset 0; the extracted
    // manifest is the same table. A drift between them would make the card draw
    // a different picture in the walker than on the console, so it fails loudly.
    if (shipped.length !== END_CARD_CLIP_BY_LANGUAGE.length
        || shipped.some((clip, i) => clip !== END_CARD_CLIP_BY_LANGUAGE[i])) {
      throw new Error("END card: the shipped language table differs from the overlay's");
    }
    for (let i = 0; i < END_CARD_OT_POOL_SIZES.length; i++) {
      mem.write16(VIEW_POOL_TABLE + i * 2, END_CARD_OT_POOL_SIZES[i]!);
    }
    this.widgets = createResidentWidgets(mem);
    this.context = this.widgets.arena.alloc(0x34, 4);
    this.drawEnv = this.widgets.arena.alloc(0x5c, 4);
    this.packArea = this.widgets.arena.alloc(0x200, 4);
    this.onStopAllSound = callbacks.onStopAllSound;
    this.onLaunch = callbacks.onLaunch;
    this.host = this.cardHost();
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(END_CARD_ROOT_TICK, {
      name: "END card screen", childSlots: [END_CARD_SEQUENCE_SLOT],
      tick: (task, extra) => endCardRootTick(mem, this.host, task, extra),
    });
    classes.set(END_CARD_SEQUENCE_TICK, {
      name: "END card sequence", childSlots: [],
      tick: (task) => endCardTick(mem, this.host, task),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
  }

  // ── the display-service edges (D0x8004DE10's own allocator and device calls) ──

  private bump(size: number, zeroed: boolean): number {
    const length = Math.max(4, (size >>> 0) + 3 & ~3);
    const address = this.widgets.arena.alloc(length, 4);
    if (zeroed) this.mem.bytes.fill(0, address & 0x1fffff, (address & 0x1fffff) + length);
    return address;
  }

  private displayHost(): DisplayViewHost & DisplayRegionHost {
    const mem = this.mem;
    return {
      // F0x8001D714's release is the service's own +0x170: it frees the view and
      // clears the slot, which is what ends resetDisplayService's retry loop.
      releaseView: (handle: number) => {
        for (let i = 0; i < DISPLAY_SERVICE_FIELDS.viewCount; i++) {
          const slot = DISPLAY_SERVICE + i * 4;
          if ((mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) | 0) === 0) continue;
          if ((mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewHandle) >>> 0) !== (handle >>> 0)) continue;
          mem.write32(slot + DISPLAY_SERVICE_FIELDS.viewBase, 0);
          mem.write32(slot + DISPLAY_SERVICE_FIELDS.viewHandle, 0);
          return;
        }
      },
      alloc: (size: number, _tag: number) => this.bump(size, false),
      allocZeroed: (size: number, _tag: number) => this.bump(size, true),
      // F0x80025D54: fill the ordering table with the libgpu terminator.
      clearOTag: (base: number, entries: number) => {
        for (let i = 0; i < (entries | 0); i++) mem.write32((base >>> 0) + i * 4, 0x00ffffff);
      },
      gsInit3D: () => {}, // the GPU driver's display-mode write; a device edge
      setGeomOffset: () => {}, // cop2 GTE OFX/OFY; a device edge
    };
  }

  private cardHost(): EndCardHost {
    const mem = this.mem;
    const d = this.draw;
    return {
      ...this.displayHost(),
      callMethod: (target, slot, args) => {
        target >>>= 0;
        if (this.tree.tasks.has(target)) { this.tree.callMethod(target, slot, args); return 0; }
        throw new Error(`END card: untranslated method ${slot.toString(16)}`);
      },
      createTask: (handler, size, extra, key) => {
        if (handler === END_CARD_ROOT_TICK || handler === END_CARD_SEQUENCE_TICK) {
          if (size !== (handler === END_CARD_ROOT_TICK ? 0x50 : END_CARD_SEQUENCE_SIZE)
              || extra !== (handler === END_CARD_ROOT_TICK ? 4 : END_CARD_SEQUENCE_EXTRA)) {
            throw new Error("END card: unexpected task allocation");
          }
          const task = this.tree.allocate(handler, size, extra);
          if (key !== 0) mem.write32(task, key >>> 0);
          return task;
        }
        throw new Error(`END card: unexpected task class ${handler.toString(16)}`);
      },
      layoutBuffer: () => this.context,
      drawEnvScratch: () => this.drawEnv,
      // F0x8001FFA8 clears the 0x34-byte context, installs its six slots, makes
      // itself the active instance and defaults +0x18 to 0xA800; +0x24 stores the
      // pair the card passes (UI-TEXTCTX-FFA8-001). The card calls no other slot.
      layoutContext: (ctx, pairX, pairY) => {
        mem.bytes.fill(0, ctx & 0x1fffff, (ctx & 0x1fffff) + 0x34);
        mem.write32(ctx + 0x08, pairX | 0);
        mem.write32(ctx + 0x0c, pairY | 0);
        mem.write32(ctx + 0x18, 0xa800);
      },
      // F0x8001FE38 walks the pack's records, expands the RLEN ones into a scratch
      // buffer and LoadImages them into VRAM at the +0x24 pair. The walker's copy
      // of that product is the extracted endall sheet, so the upload is not re-run;
      // the handle is kept in the context's own cell so the boundary is visible.
      layoutPackTexture: (ctx, pack) => { mem.write32(ctx + 0x00, pack >>> 0); },
      // [0x80044F5C](handle): the two halves of the end__all archive are the same
      // picture data, so both resolve to the one pack this session hands the painter.
      resolvePack: (handle) => this.packArea,
      drawInit: () => { d.initDrawContext(); return DRAW_CTX; },
      drawCall: (_ctx, slot, args) => d.callSlot(slot, args, "END card"),
        frameDelta,
      padRead: () => this.pad.held(),
      // The reference pad map: a logical button code IS its bit index.
      padBit: (_port, code) => code,
      stopAllSound: () => { this.stopCalls++; this.onStopAllSound?.(); },
      launchScreen: (code) => { this.launches.push(code >>> 0); this.onLaunch?.(code | 0); },
    };
  }

  /** Raise the card. The original's only entry is launch mode 13 (0x0E0D) on the title screen. */
  begin(options: EndCardBeginOptions = {}): void {
    this.dispose();
    const language = options.language ?? 2;
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("END card: invalid language");
    this.mem.write32(END_CARD_LANGUAGE, language);
    this.frame = 0;
    this.closed = false;
    this.root = endCardCreate(this.host);
    this.launches.length = 0;
    this.stopCalls = 0;
  }

  /**
   * One display tick. `buttons` is the held pad, which the waiting sub-state
   * samples every callback; `delta` is the frame delta [0x8004DF9C] the timer
   * accumulates, so a slow frame slows the fade and the holds by exactly as much
   * as it did on the console.
   */
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    if (this.closed) return;
    this.frame = displayTick ?? this.frame + 1;
    this.pad.update(buttons, this.frame);
    this.draw.beginFrame(this.frame);
    const card = this.cardAddress();
    this.tree.tick(this.root);
    // The card's last callback asks for the opening movie and leaves state 3
    // (F0x80014274). The resident scheduler destroys a task whose state reads 3 at
    // the top of its turn (F0x80018140), which is what the translated tree does, so
    // the card is gone on the next tick and draws nothing again. The screen root
    // has nothing left to do, so the card is down from here.
    if (card !== 0 && !this.tree.tasks.has(card)) this.close();
  }

  /** The sequence object the screen root created, or 0 once the tree retired it. */
  private cardAddress(): number {
    if (this.root === 0) return 0;
    return this.mem.read32(this.mem.read32(this.root + 0x24) + END_CARD_SEQUENCE_SLOT) >>> 0;
  }

  private close(): void {
    if (!this.closed) {
      this.dispose();
      this.closed = true;
    }
  }

  /** The card is up (the screen root is still scheduled). */
  isActive(): boolean { return !this.closed && this.root !== 0; }

  /** The card has handed on: its last callback asked for the movie and parked. */
  finished(): boolean { return this.closed; }

  /**
   * 0: the card's fade is a CLUT row offset inside the sprite draw (the level the
   * draw passes through +0x88), not a screen dim, so there is nothing to wash.
   */
  fadeLevel(): number { return 0; }

  /** The card's own picture calls, for the extracted-pack painter. */
  drawIntents(): { calls: ShopDrawCall[]; contextMarkers: number[] } {
    return { calls: this.draw.calls, contextMarkers: this.draw.contextMarkers };
  }

  /** The card has no text: the pack's four pictures carry every word it shows. */
  textWidgets(): ReturnType<ShopWidgetServices["textWidgets"]> { return this.widgets.textWidgets(); }

  /** How many times D0x80055C64 ran since begin(). */
  timesStoppedSound(): number { return this.stopCalls; }

  /** Take the launch codes the card asked for. */
  takeLaunches(): number[] { return this.launches.splice(0); }

  /** The view the root registered, and the colour the card asked it for. */
  view(): EndCardView | null {
    const mem = this.mem;
    for (let i = 0; i < DISPLAY_SERVICE_FIELDS.viewCount; i++) {
      const slot = DISPLAY_SERVICE + i * 4;
      const address = mem.read32(slot + DISPLAY_SERVICE_FIELDS.viewBase) >>> 0;
      if (address === 0) continue;
      return {
        address,
        colour: [mem.read8(address + 0x19), mem.read8(address + 0x1a), mem.read8(address + 0x1b)],
        valid: mem.read8(address + 0x18) !== 0,
        entries: mem.read32(address + 0x64) | 0,
      };
    }
    return null;
  }

  /**
   * Live state for the tests, the lab and the verifier; null once the card is
   * down. `state` is the card object's own task state (3 is the park the last
   * callback leaves) and `rootState` the screen root's.
   */
  state(): { rootState: number; state: number; sub: number; level: number; timer: number; tasks: number } | null {
    const card = this.cardAddress();
    if (!this.isActive() || card === 0) return null;
    const mem = this.mem;
    return {
      rootState: mem.read32(this.root + END_CARD_STATE) | 0,
      state: mem.read32(card + END_CARD_STATE) | 0,
      sub: mem.read32(card + END_CARD_SUB) | 0,
      level: (mem.read16(card + END_CARD_LEVEL) << 16) >> 16,
      timer: (mem.read16(card + END_CARD_TIMER) << 16) >> 16,
      tasks: this.tree.tasks.size,
    };
  }

  /** Drop the card (the lab closed it another way). */
  dispose(): void {
    if (this.root !== 0 && this.tree.tasks.has(this.root)) this.tree.dispose(this.root);
    this.root = 0;
    this.closed = true;
  }
}