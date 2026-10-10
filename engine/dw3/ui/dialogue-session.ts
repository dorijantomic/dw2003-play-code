// Frame owner for the field conversation box (fieldstg talk and cutscene SAY): the controller, the
// plain bottom window with its band, and the four-quadrant balloon with its marker, outline/fill and
// opening-frame tails. It composes the translated ports into one task tree and supplies the services
// they call. No PlayStation instruction is executed.
//
// The routines, each proved against the original by a lane-b oracle (tests/lane-b/dialogue-*.test.js):
// controller 80088ca0 / 80088d38 / 80088b84 / 80088a84 (native/dialogue-controller.ts), plain window
// 8001be00 / 8001bbe8 (dialogue-plain-window.ts), band 8001bb88 / 8001ba2c / 8001b814 / 8001b930
// (dialogue-band.ts), balloon 8001ce44 / 8001cab0 / 8001c948 (dialogue-balloon.ts), marker 8001c4b4 /
// 8001c448 / 8001beec (dialogue-marker.ts), outline + fill 8001c050 (dialogue-frame.ts), opening-frame
// tail 8001c85c / 8001c7d8 / 8001c4ec (dialogue-tail.ts), widget slot +0x14C 8001a2ac (text-line-metrics.ts).
//
// Service map, each an existing translated provider or a documented platform one:
//   object factory F0x80014504       -> TranslatedTaskTree.allocate (the third argument is the child block)
//   default methods +0x28..+0x44     -> TranslatedTaskTree defaults
//   text widgets F0x8001AE38 + slots -> ShopWidgetServices / dispatchWidgetMethod, plus the slots the box
//                                       adds (+0x128 rescan, +0x130 scroll, +0x14C line metrics, +0x168 /
//                                       +0x16C / +0x170 getters) exactly as fight-report-session maps them
//   text pack getters [0x80044F5C/4C]-> the pack bytes the caller hands in, loaded at DIALOGUE_PACK_BASE
//   fetcher entries 8001F744/F770    -> fetch-table.ts fetchTableEntry / text-measure.ts measureLine
//   text glyph tick                  -> textRevealTick + drawTextElement (glyphs painted by the browser)
//   pad service +0x3F4 / +0x408      -> the pressed / held masks the caller passes (identity button map)
//   picture service F0x8001F648      -> ShopDrawIntents (recorded, painted by the browser)
//   ordering table / primitive slots -> a bump arena in memory; the typed FrameFillIntent / TailLineIntent
//                                       are recorded next to the draw calls (`at` = the call index)
//   world-to-screen projector        -> the `project` function the caller passes
//   F0x8002529C                      -> strncpy (copy up to n bytes, stop at NUL, zero-pad): the only
//                                       unported routine the box needs; implemented here from fns.s L23193
//   heap / arena                     -> platform: ShopWidgetArena
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ShopDrawIntents, type ShopDrawCall } from "./shop-draw-intents.ts";
import { dispatchWidgetMethod } from "./screen-services.ts";
import { rescanVisibleWindow, textRevealTick, type TextRevealHost } from "./text-window.ts";
import { createResidentTextServices, createResidentWidgets, loadResidentResources } from "./resident-text-host.ts";
import { getUnkC1, getUnkC3, isState1, setTextScroll } from "./text-element-setters.ts";
import { textLineMetrics } from "./text-line-metrics.ts";
import { measureLine } from "./text-measure.ts";
import { fetchTableEntry, FETCHER_MEASURE_ENTRY, FETCHER_TABLE_ENTRY } from "./fetch-table.ts";
import {
  CONTROLLER_TICK, SAY_PACK_HANDLE_CELL, TALK_PACK_HANDLE_CELL, dialogueControllerTick, dialogueSayCreate,
  dialogueTalkCreate, type ControllerHost,
} from "./native/dialogue-controller.ts";
import {
  PLAIN_WINDOW_TICK, dialoguePlainWindowBuild, dialoguePlainWindowTick, type PlainWindowHost,
} from "./native/dialogue-plain-window.ts";
import { BAND_TICK, dialogueBandCreate, dialogueBandTick, type BandHost } from "./native/dialogue-band.ts";
import {
  BALLOON_SCRATCH_SIZE, BALLOON_TICK, dialogueBalloonBuild, dialogueBalloonReposition, dialogueBalloonTick,
  type BalloonHost,
} from "./native/dialogue-balloon.ts";
import { MARKER_TICK, dialogueMarkerSpawn, dialogueMarkerTick, type MarkerHost } from "./native/dialogue-marker.ts";
import { dialogueFrameDraw, type FrameFillIntent, type FrameHost } from "./native/dialogue-frame.ts";
import {
  TAIL_HANDLER, dialogueTailCreate, dialogueTailTick, type TailHost, type TailLineIntent,
} from "./native/dialogue-tail.ts";

export type { FrameFillIntent, TailLineIntent };

/** Where the open line's text pack is loaded (the stage pack the two handle cells name). */
export const DIALOGUE_PACK_BASE = 0x801e0000;
export const DIALOGUE_PACK_LIMIT = 0x10000;
const PRIM_BASE = 0x801f0000;
const PRIM_LIMIT = 0x801f8000;
const OT_HEAD = 0x801f8000;
const LAYER_OBJECT = 0x801f8100;
/** The pad bit the confirm button reads (logical button 0xD, identity map). */
export const DIALOGUE_CONFIRM_MASK = 1 << 13;

/** One resident range the box reads, with what reads it. */
export interface DialogueResidentRange { role: string; base: number; size: number }
/**
 * The resident ranges the session needs, as addresses in the resident image (load base 0x80010000):
 * everything else is the font block (shop_font.bin at 0x8004DD74) the other screens already ship.
 */
export const DIALOGUE_RESIDENT_RANGES: readonly DialogueResidentRange[] = [
  { role: "literals + tail quad order (0x800101a4/c8/fc/234, 0x80010288)", base: 0x800101a0, size: 0xf8 },
  { role: "logical button table + balloon layout/outline/fill/marker tables (0x8004dccc..0x8004dd74)", base: 0x8004dccc, size: 0xa8 },
  { role: "name literals (0x80048d88: unknown-name string)", base: 0x80048d88, size: 0x20 },
  { role: "trig table of the tail's rotation matrix (0x80056a28)", base: 0x80056a28, size: 0x4000 },
];
export interface DialogueResources {
  /** shop_font.bin (0x3492 bytes at 0x8004DD74). */
  font: Uint8Array;
  /** One entry per DIALOGUE_RESIDENT_RANGES row (same base, `size` bytes). */
  ranges: ReadonlyArray<{ base: number; bytes: Uint8Array }>;
}

/** Slice the ranges out of a resident image (tests and the extractor; the runtime takes the slices). */
export function dialogueRangesFromResident(resident: Uint8Array, residentBase = 0x80010000): DialogueResources["ranges"] {
  return DIALOGUE_RESIDENT_RANGES.map((r) => ({
    base: r.base, bytes: resident.slice(r.base - residentBase, r.base - residentBase + r.size),
  }));
}

/** Rebuild the ranges from web/assets/data/dialogue-box/resident-ranges.bin (the four ranges, back to back, in DIALOGUE_RESIDENT_RANGES order). */
export function dialogueRangesFromFile(blob: Uint8Array): DialogueResources["ranges"] {
  let at = 0;
  const out = DIALOGUE_RESIDENT_RANGES.map((r) => {
    const bytes = blob.slice(at, at + r.size);
    at += r.size;
    return { base: r.base, bytes };
  });
  if (at !== blob.length) throw new Error(`dialogue resident-ranges.bin is ${blob.length} bytes, expected ${at}`);
  return out;
}

export interface DialogueNpc { x: number; y: number; facing: number; actorId: number }
export interface DialogueActor { x: number; y: number; actorId: number }
export type DialogueProjector = (x: number, y: number) => { sx: number; sy: number };
export interface DialoguePad { pressed: number; held: number }
export type DialogueIntent =
  | { at: number; kind: "frameFill"; intent: FrameFillIntent }
  | { at: number; kind: "tailLine"; intent: TailLineIntent };
export interface DialogueDrawIntents {
  /** Picture-service calls in order (setLayer / setOrigin / setScale / setPos / m_0x88 / drawSprite). */
  calls: ShopDrawCall[];
  /** Indices into `calls` where a fresh draw context starts. */
  contextMarkers: number[];
  /** Typed raw-primitive intents; `at` is calls.length when the packet was queued. */
  raw: DialogueIntent[];
}

const MODE_LIMIT = 4;

export class DialogueSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  /** Called once when the controller reaches state 3 (the child window has gone). */
  onClose: (() => void) | null;
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  private readonly raw: DialogueIntent[] = [];
  private readonly revealHost: TextRevealHost;
  private readonly scratch: number;
  private controller = 0;
  private closed = true;
  private frame = 0;
  private padPressed = 0;
  private padHeld = 0;
  private primCursor = PRIM_BASE;
  private project: DialogueProjector = (x, y) => ({ sx: x, sy: y });

  constructor(resources: DialogueResources, onClose: (() => void) | null = null) {
    this.onClose = onClose;
    const mem = this.mem;
    loadResidentResources(mem, resources);
    this.widgets = createResidentWidgets(mem);
    this.scratch = this.widgets.arena.alloc(BALLOON_SCRATCH_SIZE, 4);
    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Dialogue", playSound: (id) => this.playSound(id), padWord: () => this.padPressed,
    }).revealHost;

    const controllerHost = this.controllerHost();
    const plainHost = this.plainHost();
    const bandHost = this.bandHost();
    const balloonHost = this.balloonHost();
    const markerHost = this.markerHost();
    const tailHost = this.tailHost();
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(CONTROLLER_TICK, {
      name: "dialogue controller", childSlots: [0],
      tick: (task, children) => dialogueControllerTick(mem, controllerHost, task, children),
    });
    classes.set(PLAIN_WINDOW_TICK, {
      name: "dialogue plain window", childSlots: [4],
      tick: (task, children) => dialoguePlainWindowTick(mem, task, children, plainHost),
    });
    classes.set(BAND_TICK, {
      name: "dialogue band", childSlots: [],
      tick: (task) => dialogueBandTick(mem, task, bandHost),
    });
    classes.set(BALLOON_TICK, {
      name: "dialogue balloon", childSlots: [0, 4, 8, 0x14],
      methods: new Map([[0x68, (task, args) => dialogueBalloonReposition(mem, balloonHost, task, args[0]!, args[1]!)]]),
      tick: (task, children) => dialogueBalloonTick(mem, balloonHost, task, children),
    });
    classes.set(MARKER_TICK, {
      name: "dialogue marker", childSlots: [],
      tick: (task) => dialogueMarkerTick(mem, markerHost, task),
    });
    classes.set(TAIL_HANDLER, {
      name: "dialogue tail", childSlots: [],
      tick: (task) => dialogueTailTick(mem, tailHost, task),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
  }

  // ── platform services ─────────────────────────────────────────────────────

  private playSound(id: number): void { this.audio.play(id); }

  /** One method call: a task's base/registered method, or a text widget method with its return value. */
  private call = (target: number, slot: number, args: number[] = []): number => {
    target >>>= 0;
    const mem = this.mem;
    if (this.tree.tasks.has(target)) { this.tree.callMethod(target, slot, args); return 0; }
    switch (slot) {
      case 0x120: this.widgets.textFormat(target, args[0]!, args[1]!, args[2]!); return 0;
      case 0x128: return rescanVisibleWindow(mem, target);
      case 0x130: setTextScroll(mem, target, args[0]!); return 0;
      case 0x14c:
        textLineMetrics(mem, { alloc: this.widgets.arena.alloc, free: this.widgets.arena.free }, target);
        return 0;
      case 0x168: return getUnkC3(mem, target);
      case 0x16c: return getUnkC1(mem, target);
      case 0x170: return isState1(mem, target);
      default: dispatchWidgetMethod(mem, this.widgets, target, slot, args); return 0;
    }
  };

  private alloc = (handler: number, size: number, extra: number): number => this.tree.allocate(handler, size, extra);

  private controllerHost(): ControllerHost {
    return {
      createTask: this.alloc,
      sayPack: () => DIALOGUE_PACK_BASE,
      talkPack: () => DIALOGUE_PACK_BASE,
      project: (x, y) => { const p = this.project(x, y); return [p.sx | 0, p.sy | 0]; },
      buildBalloon: (kind, x, y, pack, line, mode) =>
        dialogueBalloonBuild(this.mem, this.balloonHost(), this.scratch, kind, x, y, pack, line, mode),
      buildPlain: (kind, pack, line) => dialoguePlainWindowBuild(this.mem, this.plainHost(), kind, pack, line),
      callMethod: (obj, slot, args) => { this.call(obj, slot, args); },
    };
  }

  private plainHost(): PlainWindowHost {
    return {
      createTask: this.alloc,
      createText: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
      createBand: (h) => dialogueBandCreate(this.mem, this.bandHost(), h),
      callMethod: this.call,
      padRead: () => this.padPressed,
      padShift: (_port, button) => button,
      playSound: (id) => this.playSound(id),
    };
  }

  private bandHost(): BandHost {
    const d = this.draw;
    return {
      createTask: this.alloc,
      playSound: (id) => this.playSound(id),
      callMethod: (obj, slot, args) => { this.call(obj, slot, args); },
      frameCounter: () => this.frame,
      initDrawContext: d.initDrawContext, setLayer: d.setLayer, setOrigin: d.setOrigin,
      setScale: d.setScale, setPos: d.setPos, setFrame: d.paletteShift, drawSprite: d.drawSprite,
      packResolve: d.packResolve,
    };
  }

  private balloonHost(): BalloonHost {
    const mem = this.mem;
    return {
      createTask: this.alloc,
      createText: (kind, font, x, y) => this.widgets.createTextElement(kind, font, x, y),
      createTail: (layer, x, y, width, height, mode) =>
        dialogueTailCreate(mem, this.tailHost(), layer, x, y, width, height, mode),
      createMarker: (task) => dialogueMarkerSpawn(mem, this.markerHost(), task),
      // F0x8002529C: strncpy(dest, src, n).
      copyBounded: (dest, src, n) => {
        let ended = false;
        for (let i = 0; i < n; i++) {
          const b = ended ? 0 : mem.read8(src + i);
          mem.write8(dest + i, b);
          if (b === 0) ended = true;
        }
      },
      callMethod: this.call,
      callFetcher: (fn, args) => {
        if (fn === FETCHER_TABLE_ENTRY) return fetchTableEntry(mem, args[0]!, args[1]!);
        if (fn === FETCHER_MEASURE_ENTRY) return measureLine(mem, args[0]!, args[1]!, args[2]!);
        throw new Error(`Dialogue: untranslated fetcher entry ${fn.toString(16)}`);
      },
      padRead: () => this.padPressed,
      padShift: (_port, button) => button,
      playSound: (id) => this.playSound(id),
    };
  }

  private markerHost(): MarkerHost {
    const d = this.draw;
    return {
      createTask: this.alloc,
      callMethod: (obj, slot, args) => { this.call(obj, slot, args); },
      drawBalloon: (task) => dialogueFrameDraw(this.mem, this.frameHost(), task),
      frameCounter: () => this.frame,
      initDrawContext: d.initDrawContext, setLayer: d.setLayer, setOrigin: d.setOrigin,
      setFrame: d.paletteShift, drawSprite: d.drawSprite, packResolve: d.packResolve,
    };
  }

  private frameHost(): FrameHost {
    const d = this.draw;
    return {
      initDrawContext: d.initDrawContext, setLayer: d.setLayer, setOrigin: d.setOrigin,
      drawSprite: d.drawSprite, packResolve: d.packResolve,
      layerObject: () => LAYER_OBJECT,
      orderingHead: () => OT_HEAD,
      allocPrim: () => this.primCursor,
      commitPrim: (next, _link, _mask, intent) => {
        this.primCursor = next >>> 0;
        if (this.primCursor > PRIM_LIMIT) throw new Error("Dialogue: primitive arena exhausted");
        this.raw.push({ at: d.calls.length, kind: "frameFill", intent });
      },
    };
  }

  private tailHost(): TailHost {
    return {
      createObject: (handler, size, flags) => this.alloc(handler, size, flags),
      layerObject: () => LAYER_OBJECT,
      orderingHead: () => OT_HEAD,
      allocPrim: () => this.primCursor,
      commitPrim: (next, lines) => {
        this.primCursor = next >>> 0;
        if (this.primCursor > PRIM_LIMIT) throw new Error("Dialogue: primitive arena exhausted");
        for (const intent of lines) this.raw.push({ at: this.draw.calls.length, kind: "tailLine", intent });
      },
      setState: (obj, state) => this.tree.callMethod(obj, 0x28, [state]),
      onReset: (obj) => this.tree.callMethod(obj, 0x38),
    };
  }

  // ── opening ───────────────────────────────────────────────────────────────

  private begin(pack: Uint8Array, project: DialogueProjector | undefined): void {
    if (pack.length < 8 || pack.length > DIALOGUE_PACK_LIMIT) throw new Error("Dialogue: invalid text pack");
    if (this.controller !== 0) { this.tree.dispose(this.controller); this.controller = 0; }
    this.mem.load(pack, DIALOGUE_PACK_BASE);
    if (project) this.project = project;
    this.closed = false;
  }

  private record(fields: Array<[number, number]>): number {
    const at = this.widgets.arena.alloc(0x80, 4);
    for (const [offset, value] of fields) this.mem.write32(at + offset, value >>> 0);
    return at;
  }

  /** Field talk (F0x80088D38): the NPC's screen position and facing pick the balloon quadrant. */
  openTalk(pack: Uint8Array, line: number, npc: DialogueNpc, project: DialogueProjector): void {
    this.begin(pack, project);
    this.mem.write32(TALK_PACK_HANDLE_CELL, 1);
    const obj = this.record([[4, npc.actorId], [0x58, npc.x], [0x5c, npc.y], [0x60, npc.facing]]);
    this.controller = dialogueTalkCreate(this.mem, this.controllerHost(), obj, line);
  }

  /**
   * Cutscene SAY (F0x80088CA0): `mode` 0..3 is the balloon quadrant, `plain` selects the bottom window
   * (then `actor` may be null). A balloon needs an actor and a projector (default: identity).
   */
  openSay(pack: Uint8Array, line: number, actor: DialogueActor | null, mode: number, plain: boolean,
    project?: DialogueProjector): void {
    if (!plain && !actor) throw new Error("Dialogue: a balloon needs an actor");
    if (!plain && !(mode >= 0 && mode < MODE_LIMIT)) throw new Error("Dialogue: invalid balloon mode");
    this.begin(pack, project);
    this.mem.write32(SAY_PACK_HANDLE_CELL, 1);
    const obj = this.record([[4, actor?.actorId ?? 0], [0x58, actor?.x ?? 0], [0x5c, actor?.y ?? 0]]);
    this.controller = dialogueSayCreate(this.mem, this.controllerHost(), obj, line, mode, plain ? 1 : 0);
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  /** One display tick. `pressed` / `held` are pad masks (the confirm button is bit 13). */
  tick(pad: DialoguePad = { pressed: 0, held: 0 }): void {
    if (this.closed) return;
    this.frame++;
    this.padPressed = pad.pressed >>> 0;
    this.padHeld = pad.held >>> 0;
    this.draw.beginFrame(this.frame);
    this.raw.length = 0;
    this.primCursor = PRIM_BASE;
    this.tree.tick(this.controller);
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
    if (!this.tree.tasks.has(this.controller) || (this.mem.read32(this.controller + 0x0c) | 0) === 3) {
      this.dispose();
      this.onClose?.();
    }
  }

  isOpen(): boolean { return !this.closed; }

  /** The last tick's picture calls and typed raw-primitive intents, in order. */
  drawIntents(): DialogueDrawIntents {
    return { calls: this.draw.calls, contextMarkers: this.draw.contextMarkers, raw: this.raw };
  }

  /** Live text widgets for the native UI-font painter. */
  textWidgets(): ReturnType<ShopWidgetServices["textWidgets"]> { return this.widgets.textWidgets(); }

  /** The sound ids played since the last call (0x40019 open, 0x4001A close, ...). */
  takeSounds(): number[] { return this.audio.take(); }

  /** The controller's task state words for diagnostics, or null when closed. */
  state(): { controller: number; child: string | null } | null {
    if (this.controller === 0) return null;
    const cell = this.tree.tasks.get(this.controller)?.children ?? 0;
    const child = cell ? this.mem.read32(cell) >>> 0 : 0;
    const task = child ? this.tree.tasks.get(child) : undefined;
    return {
      controller: this.mem.read32(this.controller + 0x0c) | 0,
      child: task ? this.tree.classes.get(task.classId)!.name : null,
    };
  }

  /** Dispose of every task (the field left another way). */
  dispose(): void {
    if (this.controller !== 0) this.tree.dispose(this.controller);
    this.controller = 0;
    this.closed = true;
  }
}
