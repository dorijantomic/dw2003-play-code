// Shared platform wiring for a session that shows resident text widgets: the resident ranges and the
// UI font in memory, the widget services, and the two hosts the per-frame glyph tick needs. Each
// helper is a function, not a base class, so a session composes only the parts it uses. No
// PlayStation instruction is executed.
//
// The routines it serves, each already translated:
//   text element F0x8001AE38           -> ShopWidgetServices.createTextElement (create-text-element.ts)
//   widget frame callback F0x8001AC14  -> text-window.ts textRevealTick, through `revealHost`
//   text drawer F0x800197A4            -> text-drawer.ts drawTextElement, through `drawerHost`
//   fetcher entry F0x8001F744          -> fetch-table.ts fetchTableEntry (the stringById bank)
//   task / widget method call          -> TranslatedTaskTree.callMethod or dispatchWidgetMethod
//
// Platform services, as the sessions wired them before this module:
//   resident ranges, font, cursor glyphs -> NativeMemory loads (shop_font.bin at 0x8004DD74; the cursor
//                                           string table 0x8004DCE0 and its strings 0x8005CCD0)
//   draw scratch / ordering table / packets -> 0x48 / 8 / 0x4000 bytes from the widget arena, in that
//                                           order; the caller decides WHEN, so its addresses do not move
//   rotated / scaled / transformed text  -> not translated: each throws, named by the session label
//   logical button map                   -> identity
import { NativeMemory } from "../../native/memory.ts";
import type { TranslatedTaskTree } from "./translated-task-tree.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { installShopFont } from "./shop-font.ts";
import { dispatchWidgetMethod } from "./screen-services.ts";
import type { TextRevealHost } from "./text-window.ts";
import { drawTextElement, type TextDrawerStepperHost } from "./text-drawer.ts";
import { fetchTableEntry } from "./fetch-table.ts";
import { getUnkC1, getUnkC3, isState1 } from "./text-element-setters.ts";

/** The resident cursor string table (0x8004DCE0, five pointers) and its strings (0x8005CCD0). */
export interface CursorGlyphTable { tableBase: number; tableBytes: number[]; stringsBase: number; stringBytes: number[] }

export interface ResidentTextResources {
  /** shop_font.bin (0x3492 bytes at 0x8004DD74). */
  font: Uint8Array;
  /** Resident ranges, each loaded at its base. */
  ranges?: ReadonlyArray<{ base: number; bytes: Uint8Array }>;
  /** Without it the cursor child (F0x8001B0A4) gets a null string and draws nothing. */
  cursorGlyphs?: CursorGlyphTable;
}

/**
 * The resident cursor glyph table (0x8004DCE0) and its strings (0x8005CCD0), as one shared default.
 *
 * Every screen that shows a selection cursor needs this table, and the table is the same resident
 * data for all of them. A screen that hands its resources to `loadResidentResources` must therefore
 * not have to remember to forward it: the one place that has the decoded table (web/resident-data.js,
 * from shop_catalog.json) installs it here once, and every later load supplies it by default. A
 * caller that passes `resources.cursorGlyphs` still wins over this default.
 */
let defaultCursorGlyphs: CursorGlyphTable | undefined;

/** Install (or clear) the cursor glyph table that `loadResidentResources` uses when a caller omits it. */
export function setDefaultCursorGlyphs(glyphs: CursorGlyphTable | undefined): void {
  defaultCursorGlyphs = glyphs;
}

/** Load the ranges, then the font, then the cursor glyph table and strings. */
export function loadResidentResources(mem: NativeMemory, resources: ResidentTextResources): void {
  for (const range of resources.ranges ?? []) mem.load(range.bytes, range.base);
  installShopFont(mem, resources.font);
  const glyphs = resources.cursorGlyphs ?? defaultCursorGlyphs;
  if (glyphs) {
    mem.load(Uint8Array.from(glyphs.tableBytes), glyphs.tableBase);
    mem.load(Uint8Array.from(glyphs.stringBytes), glyphs.stringsBase);
  }
}

/** The widget services with the one text bank the resident fetcher answers (fetchTableEntry). */
export function createResidentWidgets(mem: NativeMemory): ShopWidgetServices {
  const banks = { stringById: (m: NativeMemory, source: number, index: number) => fetchTableEntry(m, source, index) };
  return new ShopWidgetServices(mem, banks as never);
}

export interface ResidentTextOptions {
  /** Names the session in the "not translated" errors. */
  label: string;
  /** The reveal sound (+0xC8) of a widget. */
  playSound: (id: number) => void;
  /** The pad word the reveal reads for skip (+0x3F4). */
  padWord: () => number;
  /** The drawer's text fetch; the resident fetcher (fetchTableEntry) when omitted. */
  stringById?: TextDrawerStepperHost["stringById"];
  /** The drawer's ScaleMatrix; throws "scaled text is not translated" when omitted. */
  scaleMatrix?: TextDrawerStepperHost["scaleMatrix"];
}

export interface ResidentTextServices {
  revealHost: TextRevealHost;
  drawerHost: TextDrawerStepperHost;
  drawScratch: number;
}

/**
 * Allocate the text drawer's scratch (0x48), ordering table (8) and packet area (0x4000) from the
 * widget arena, in that order, and build the two hosts F0x8001AC14 and F0x800197A4 call.
 */
export function createResidentTextServices(mem: NativeMemory, widgets: ShopWidgetServices,
  options: ResidentTextOptions): ResidentTextServices {
  const { label, playSound, padWord, stringById, scaleMatrix } = options;
  const drawScratch = widgets.arena.alloc(0x48, 4);
  const otAddress = widgets.arena.alloc(8, 4);
  const packetArea = widgets.arena.alloc(0x4000, 4);
  const drawerHost: TextDrawerStepperHost = {
    viewForKey: () => 1,
    bucketFor: () => otAddress,
    packetCursor: () => packetArea,
    flushPacketCursor: () => {},
    rotMatrixYXZ: () => { throw new Error(`${label}: rotated text is not translated`); },
    scaleMatrix: scaleMatrix ?? (() => { throw new Error(`${label}: scaled text is not translated`); }),
    applyMatrixSV: () => { throw new Error(`${label}: transformed text is not translated`); },
    alloc: widgets.arena.alloc,
    free: widgets.arena.free,
    stringById: stringById ?? ((bank, id) => fetchTableEntry(mem, bank, id)),
  };
  const revealHost: TextRevealHost = {
    draw: (self) => drawTextElement(mem, drawerHost, self, drawScratch),
    playPackedSound: (id) => playSound(id),
    padButtonWord: () => padWord(),
    logicalButtonBit: (code) => code,
    free: (ptr) => { if (widgets.arena.has(ptr)) widgets.arena.free(ptr); },
  };
  return { revealHost, drawerHost, drawScratch };
}

/**
 * One method call: a live task's base/registered method, else a text widget or
 * icon method.
 *
 * The three text-widget getters answer a value the caller branches on, as
 * install order puts them (exe/fns.s:12088-12102, create-text-element.ts):
 * `+0x168` is F0x8001A460 `lbu $v0, 0xC3($a0)`, `+0x16C` is F0x8001A46C
 * `lbu $v0, 0xC1($a0)`, and `+0x170` is F0x8001A478, which answers whether the
 * word at +0x10 is 1. The dialogue box maps them the same way. And
 * `widgetSetLineString` sets +0xC1 to 1 for a non-empty string
 * (F0x80019370, exe/fns.s:10151-10156), so the battle TAG's message screen
 * (:21470-:21486) sets its word exactly once and then only redraws the pane and
 * the hand. Every other slot answers nothing, as the original's void methods do.
 */
export function callTaskOrWidget(mem: NativeMemory, tree: TranslatedTaskTree, widgets: ShopWidgetServices,
  target: number, slot: number, args: number[] = []): number {
  target >>>= 0;
  if (tree.tasks.has(target)) { tree.callMethod(target, slot, args); return 0; }
  if (slot === 0x168) return getUnkC3(mem, target);
  if (slot === 0x16c) return getUnkC1(mem, target);
  if (slot === 0x170) return isState1(mem, target);
  dispatchWidgetMethod(mem, widgets, target, slot, args);
  return 0;
}
