// Production composition of the Card Folder editor (pro/stcrddek). The
// already-oracled folder-list controllers run as registered translated tasks:
// folder-screen (create + chrome draw), folder-lifecycle, folder-picker-tick,
// folder-banks, folder-list-create, folder-list-row, folder-list-colours,
// folder-selection (the picker's hand-off builders and closing popup), and --
// the two surfaces this file used to name as untranslated stubs -- the editor
// card grid (folder-card-grid) and the rename keyboard (folder-name-keyboard).
// The shared services are the shop's: ShopWidgetServices (text widgets, font,
// cursor), ShopDrawIntents (the picture context), window-fold (the fold pairs)
// and the resident font.
//
// The surface this composes is the whole editor: "Choose a folder." over three
// folders; choosing one opens Edit Folder / Change name; Edit Folder runs the
// 40-slot card grid (nine across, a swap list, a bubble sort, the four-copy
// gate); Change name runs the NAMEDT name keyboard. Triangle closes the chooser
// through the ported popup fade.
//
// Object identity, settled from the overlay: the picker's second argument is
// the screen's children block (obj+0x24, factory F0x80014504), so the label
// slots (ctx+0x04 label, ctx+0x1C*t row base, ctx+0x5C/0x60 submenu, ctx+0x64
// cursor) live in that block. Only ctx+0x00 (the handed-off child) and ctx+0x68
// (the popup) are task pointers, so the tree walks exactly those two.
//
// No instruction decoder or executable image is reachable from this module; the
// interpreted reference is web/carddeck-native.js behind ?nativeFolder=1.
import { NativeMemory } from "../../native/memory.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopPadInput } from "./shop-pad-input.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { installShopFont } from "./shop-font.ts";
import { fetchTableEntry } from "./fetch-table.ts";
import {
  uiIconSetUnk60, uiIconSetUnk7c,
} from "./spawn-ui-icon.ts";
import {
  set_unk_0x58_fns_8001a448, set_unk_0xbf_fns_8001a450,
} from "./text-element-setters.ts";
import { dispatchWidgetMethod } from "./screen-services.ts";
import { folderScreenCreate, folderDrawChrome, FOLDER_SCREEN_HANDLER, FOLDER_SCREEN_SIZE, FOLDER_SCREEN_EXTRA } from "./native/folder-screen.ts";
import { folderScreenLifecycle } from "./native/folder-lifecycle.ts";
import { folderPickerTick } from "./native/folder-picker-tick.ts";
import { folderRequestTextBanks, folderTextBanksPending, PACK_FOLDER_TEXT, type FolderBanksHost } from "./native/folder-banks.ts";
import { folderListCreateLabels } from "./folder-list-create.ts";
import { folderListFillRow } from "./folder-list-row.ts";
import { folderListCountColours } from "./folder-list-colours.ts";
import {
  folderMakePopup, folderPopupFadeStart, folderPopupTick,
  folderSelectOddCreate, folderSelectEvenCreate,
  FOLDER_POPUP_HANDLER,
  FOLDER_ODD_HANDLER, FOLDER_ODD_SIZE, FOLDER_ODD_EXTRA,
  FOLDER_EVEN_HANDLER, FOLDER_EVEN_SIZE, FOLDER_EVEN_EXTRA,
} from "./native/folder-selection.ts";
import {
  folderCardGridTick, folderGridObjectsTick, folderPagerTick,
  folderPagerCreate, pagerSetA, pagerSetB, pagerSetC, pagerSetD,
  FOLDER_GRID_OBJECT_HANDLER, FOLDER_PAGER_HANDLER,
  type FolderGridHost,
} from "./native/folder-card-grid.ts";
import {
  folderNameEntryTick, folderNameEntryReseed, folderNameEntryCommit,
} from "./native/folder-name-keyboard.ts";
import {
  CardViewTextContext, installCardRecords, installCardViewTables, cardRecordAddress,
  CARD_PAK_FILES_BASE, type CardRecord, type CardViewTextHost,
} from "./native/card-view-text.ts";

/** The folder chrome / rows draw from this pack handle (directory 0x063E). */
/** The CARDPAK record store the colour census and the detail panels read. */
export const FOLDER_CARD_TABLE_BASE = CARD_PAK_FILES_BASE;
/** The folder record block: three 0x66-byte records (name + 40 cards). */
export const FOLDER_RECORD_BASE = 0x8004935c;
export const FOLDER_NAME_MAX = 10;
export const FOLDER_CARDS_OFF = 0x16;
export const FOLDER_CARDS_PER_FOLDER = 40;
/** Three folders; stride and count also named in folder-list-row/colours. */
const FOLDER_COUNT = 3;
const FOLDER_RECORD_STRIDE = 0x66;
/** Per-card copy / ever-obtained arrays the picker's row values read. */
const CARD_COUNTS = 0x80048d34 + 0x3a2;
const CARD_SEEN = 0x80048d34 + 0x4df;
const CARD_MAX_ID = 0x13b;
/** The language/save cell the bank ids derive from (also the resource cell). */
const SAVE_PTR = 0x8005cca8;
/** The keyboard's character tables the pack's text banks ship beside. */
const PACK_NAMEDT = 0x07700000;

/** One card as the colour census and the detail panels read it: the CARDPAK record. */
export type FolderCardRecord = CardRecord;
export interface FolderFolderRecord { name: string; cards: readonly number[] }
/** A static data slab loaded into the session's flat memory. */
export interface FolderTable { base: number; bytes: Uint8Array }

export interface FolderResources {
  banks: ReadonlyMap<number, Uint8Array>;
  cards: readonly FolderCardRecord[];
  font: Uint8Array;
  /** The folder records the walker's collection holds, seeded on entry. */
  folders: readonly FolderFolderRecord[];
  /** Cards the walker owns / has ever seen, for the row counters and bank reads. */
  owned?: ReadonlyMap<number, number>;
  seen?: Iterable<number>;
  /**
   * The editor's static tables: the keyboard's character pages, glyph and hint
   * tables, the cursor frames and the resident glyph code table (see
   * tools/extract_stcrddek_tables.py). Data only.
   */
  tables?: readonly FolderTable[];
}

export interface FolderSessionHost {
  playSound(id: number): void;
}

/** The folder's own text banks: arbitrary ids installed at a fixed base. */
export class FolderTextBanks {
  readonly sources = new Map<number, number>();
  constructor(mem: NativeMemory, language: number, banks: ReadonlyMap<number, Uint8Array>) {
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid folder language");
    let address = 0x801e0000;
    for (const [id, data] of banks) {
      if (!data || data.length < 8) throw new Error(`Missing folder text bank ${id}`);
      if (address + data.length > 0x80200000) throw new Error(`Folder text bank ${id} overflows RAM`);
      mem.load(data, address);
      this.sources.set(id, address);
      address = ((address + data.length + 7) & ~7) >>> 0;
    }
  }
  source(id: number): number {
    const address = this.sources.get(id);
    if (address === undefined) throw new Error(`Unloaded folder text bank ${id}`);
    return address;
  }
  stringById(mem: NativeMemory, source: number, index: number): number {
    return fetchTableEntry(mem, source, index);
  }
}

export class FolderSession {
  readonly mem = new NativeMemory();
  readonly pad = new ShopPadInput();
  readonly draw = new ShopDrawIntents(this.mem);
  readonly widgets: ShopWidgetServices;
  readonly banks: FolderTextBanks;
  readonly tree: TranslatedTaskTree;
  readonly root: number;
  context = 0;
  private readonly bankIds: Set<number>;
  private cardView!: CardViewTextContext;
  private primitiveScratch = 0;
  private frame = 0;
  private closed = false;
  private popup = 0;
  private child = 0;
  private readonly language: number;
  private readonly host: FolderSessionHost;

  constructor(language: number, resources: FolderResources, host: FolderSessionHost) {
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid folder language");
    this.language = language;
    this.host = host;
    installShopFont(this.mem, resources.font);
    for (const table of resources.tables ?? []) this.mem.load(table.bytes, table.base);
    this.mem.write32(SAVE_PTR, language);

    // The shared card-view text context: the CARDPAK records at the real 0x62C
    // stride plus the record-count arrays the census reads.
    installCardViewTables(this.mem);
    installCardRecords(this.mem, resources.cards);
    for (const [id, count] of resources.owned ?? []) {
      const card = Number(id);
      if (Number.isInteger(card) && card >= 1 && card < CARD_MAX_ID) {
        this.mem.write8(CARD_COUNTS + card, count & 0xff);
        this.mem.write8(CARD_SEEN + card, 1);
      }
    }
    for (const id of resources.seen ?? []) {
      const card = Number(id);
      if (Number.isInteger(card) && card >= 1 && card < CARD_MAX_ID) this.mem.write8(CARD_SEEN + card, 1);
    }
    this.seedFolders(resources.folders);

    // The editor's text banks are all materialised: the card-shop bank
    // (save+0x32, and the card-name / card-text banks save+0x16 / save+0x1D) and
    // the NAMEDT keyboard bank (save+0x86).
    this.bankIds = new Set<number>();
    const loaded = new Map<number, Uint8Array>();
    for (const [id, data] of resources.banks) {
      loaded.set(id, data);
      this.bankIds.add(id);
    }
    if (!loaded.has(0x32 + language)) throw new Error(`Missing card-shop text bank ${0x32 + language}`);
    this.banks = new FolderTextBanks(this.mem, language, loaded);
    for (const offset of [0x16, 0x1d, 0x86]) this.bankIds.add(offset + language);
    for (let id = 0x7f6; id <= 0x7fa; id++) this.bankIds.add(id);
    this.bankIds.add(0x771);

    this.widgets = new ShopWidgetServices(this.mem, this.banks as never);
    this.cardView = new CardViewTextContext(this.mem, this.sharedViewHost());
    this.tree = this.buildTree();
    this.root = this.tree.allocate(FOLDER_SCREEN_HANDLER, FOLDER_SCREEN_SIZE, FOLDER_SCREEN_EXTRA);
    this.context = this.tree.tasks.get(this.root)!.children >>> 0;
    let requests = 0;
    const created = folderScreenCreate(this.mem, { alloc: (size: number): number => {
      const expected = requests === 0 ? FOLDER_SCREEN_SIZE : requests === 1 ? FOLDER_SCREEN_EXTRA : -1;
      if (size !== expected) throw new Error(`Unexpected folder allocation ${size}, wanted ${expected}`);
      return requests++ === 0 ? this.root : this.context;
    } });
    if (created !== this.root || this.mem.read32(this.root + 0x20) !== FOLDER_SCREEN_EXTRA / 4) {
      throw new Error("Folder constructor did not install its registered task block");
    }
  }

  private buildTree(): TranslatedTaskTree {
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(FOLDER_SCREEN_HANDLER, {
      name: "folder screen", childSlots: [0x0, 0x68], terminalTick: true,
      methods: new Map([[0x11c, (obj: number) =>
        folderListCountColours(this.mem, obj, this.cardRecordOf)]]),
      tick: (obj, ctx) => folderScreenLifecycle(this.mem, obj, ctx, this.lifecycleHost()),
    });
    classes.set(FOLDER_POPUP_HANDLER, {
      name: "folder popup",
      methods: new Map([[0x64, (obj, args) =>
        folderPopupFadeStart(this.mem, this.popupHost(), obj, args[0]!, args[1]!)]]),
      tick: (obj) => folderPopupTick(this.mem, this.popupHost(), obj),
    });
    // The picker's two hand-off surfaces now run our own translated bodies.
    classes.set(FOLDER_ODD_HANDLER, {
      name: "folder card grid",
      childSlots: [0xcc, 0xd0],
      tick: (obj, ctx) => folderCardGridTick(this.mem, obj, ctx, this.gridHost()),
    });
    classes.set(FOLDER_GRID_OBJECT_HANDLER, {
      name: "folder grid object",
      tick: (obj) => folderGridObjectsTick(this.mem, obj, this.gridHost()),
    });
    classes.set(FOLDER_PAGER_HANDLER, {
      name: "folder pager",
      childSlots: [],
      methods: new Map([
        [0x8c, (obj, args) => pagerSetA(this.mem, obj, args[0]!, args[1]!)],
        [0x90, (obj, args) => pagerSetB(this.mem, obj, args[0]!, args[1]!)],
        [0x94, (obj, args) => pagerSetC(this.mem, obj, args[0]!, args[1]!)],
        [0x98, (obj, args) => pagerSetD(this.mem, obj, args[0]!)],
      ]),
      tick: (obj) => folderPagerTick(this.mem, obj, this.gridHost()),
    });
    classes.set(FOLDER_EVEN_HANDLER, {
      name: "folder name keyboard",
      childSlots: [],
      methods: new Map([
        [0xec, (obj, args) => folderNameEntryReseed(this.mem, obj, args[0]!, this.keyboardHost())],
        [0xf0, (obj) => folderNameEntryCommit(this.mem, obj)],
      ]),
      tick: (obj, ctx) => folderNameEntryTick(this.mem, obj, ctx, this.keyboardHost()),
    });
    const tree = new TranslatedTaskTree(this.mem, classes,
      (task) => { if (this.widgets.arena.has(task.address)) this.widgets.retireTask(task); });
    return tree;
  }

  private seedFolders(folders: readonly FolderFolderRecord[]): void {
    const encode = (name: string): number[] => {
      const bytes: number[] = [];
      for (const ch of String(name ?? "")) {
        const code = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") bytes.push(4 + code - 48);
        else if (ch >= "A" && ch <= "Z") bytes.push(14 + code - 65);
        else if (ch >= "a" && ch <= "z") bytes.push(40 + code - 97);
        else bytes.push(1, 1);
        if (bytes.length >= FOLDER_NAME_MAX * 2) break;
      }
      return bytes;
    };
    for (let f = 0; f < FOLDER_COUNT; f++) {
      const rec = FOLDER_RECORD_BASE + f * FOLDER_RECORD_STRIDE;
      const folder = folders[f];
      const bytes = encode(folder?.name ?? "");
      for (let i = 0; i < FOLDER_NAME_MAX * 2; i++) this.mem.write8(rec + i, bytes[i] ?? 0);
      const list = folder?.cards ?? [];
      for (let i = 0; i < FOLDER_CARDS_PER_FOLDER; i++) {
        this.mem.write16(rec + FOLDER_CARDS_OFF + i * 2, (Number(list[i]) || 0) & 0xffff);
      }
    }
  }

  /** A signed card id to its record in the shared store (file 0 for id <= 0). */
  private cardRecordOf = (id: number): number => cardRecordAddress(id);

  // ── the shared card-view text context (F0x8001EBF8 / F0x8001E7EC) ─────────
  private sharedViewHost(): CardViewTextHost {
    return {
      allocate: (size: number) => this.widgets.arena.alloc(size, 4),
      loadImage: () => { /* the extracted atlas paints the card art; VRAM is not modelled. */ },
      findRegisteredHandleByKey: () => 0,
      callViewMethod: () => 0,
      newPrimitive: () => this.primitiveBuffer(),
      emitPrimitive: () => { /* the extracted atlas paints the cell; the primitive is emitted for parity. */ },
    };
  }
  private primitiveBuffer(): number {
    if (!this.primitiveScratch) this.primitiveScratch = this.widgets.arena.alloc(0x40, 4);
    return this.primitiveScratch;
  }

  private drawHost() {
    return {
      initDrawContext: this.draw.initDrawContext, setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin, setScale: this.draw.setScale, setPos: this.draw.setPos,
      m_0x88: this.draw.paletteShift, drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve, now: () => this.frame,
    };
  }

  private banksHost(): FolderBanksHost {
    return {
      beginRequestContext: () => {}, requestContextOrigin: () => {}, requestContextPack: () => {},
      packResolve: () => PACK_FOLDER_TEXT,
      requestBank: (id: number) => {
        if (this.banks.sources.has(id)) return;
        if (this.bankIds.has(id)) return; // the packs' data ids, not text banks.
        throw new Error(`Folder asked for an unloaded text bank ${id}`);
      },
      pollBank: () => 0,
    };
  }

  private pickerHost() {
    return {
      resetRows: (obj: number) => folderListCountColours(this.mem, obj, this.cardRecordOf),
      fillRow: (obj: number, ctx: number, row: number, flag: number) =>
        folderListFillRow(this.mem, obj, ctx, row, flag, {
          widgetSetResourceLine: (w, base, line) => this.widgets.textSet(w, base, line),
          widgetSetNumber: (w, f, value) => this.widgets.textNumber(w, f, value),
          widgetSetVisible: (w, on) => this.widgets.textShow(w, on),
          widgetHide: (w, f) => this.widgets.textShow(w, f),
        }),
      selectOdd: (obj: number, index: number) => {
        this.child = folderSelectOddCreate(this.mem, this.allocateHost(), obj, index);
        return this.child;
      },
      selectEven: (record: number) => {
        this.child = folderSelectEvenCreate(this.mem, {
          allocate: (handler, size, extra) => this.tree.allocate(handler, size, extra),
          copyString: (dst, src) => this.copyName(dst, src),
          stringLength: (ptr) => this.nameLength(ptr),
        }, record);
        return this.child;
      },
      makePopup: () => {
        this.popup = folderMakePopup(this.mem, {
          allocate: (handler, size, extra) => this.tree.allocate(handler, size, extra),
        });
        return this.popup;
      },
      resourceGet: (id: number) => this.banks.source(id),
      baseMethod28: (obj: number, value: number) => this.tree.callMethod(obj, 0x28, [value]),
      baseMethod2C: (obj: number, value: number) => this.tree.callMethod(obj, 0x2c, [value]),
      padPressed: (_port: number) => this.pad.pressed(),
      padRepeat: (_port: number) => this.pad.repeated(),
      padKey: (_port: number, code: number) => code,
      playSound: (id: number) => this.host.playSound(id),
      foldStart: (sub: number, direction: number) => {
        windowFoldStart(this.mem, sub, direction);
        this.host.playSound(direction ? 0x40019 : 0x4001a);
      },
      foldTick: (sub: number) => windowFoldTick(this.mem, sub),
      widget114: (w: number, source: number, index: number) => this.widgets.textSet(w, source, index),
      widget144: (w: number, value: number) => this.widgets.textShow(w, value),
      widget84: (w: number, x: number, y: number) => this.widgets.cursorPlace(w, x, y),
      widget80: (w: number, value: number) => this.widgets.cursorShow(w, value),
      widget94: (w: number, value: number) => uiIconSetUnk7c(this.mem, w, value),
      widget88: (w: number, value: number) => uiIconSetUnk60(this.mem, w, value),
      widget64: (w: number, a: number, b: number) => this.tree.callMethod(w, 0x64, [a, b]),
    };
  }

  // ── the card grid's host ───────────────────────────────────────────────────
  /** A widget method by slot, or a task method through the tree (the naming
   *  screen's own `call`, reused so the keyboard's widget slots resolve). */
  private call = (target: number, slot: number, args: number[]): void => {
    target >>>= 0;
    if (this.tree.tasks.has(target)) { this.tree.callMethod(target, slot, args); return; }
    dispatchWidgetMethod(this.mem, this.widgets, target, slot, args);
  };

  private cardByte = (offset: number): number => this.cardView.byte(offset);

  private gridHost(): FolderGridHost {
    return {
      allocate: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      baseMethod38: (obj: number) => this.tree.callMethod(obj, 0x38),
      baseMethod2C: (obj: number, value: number) => this.tree.callMethod(obj, 0x2c, [value]),
      folderRecount: (list: number) => this.tree.callMethod(list, 0x11c),
      createWidget: this.widgets.createTextElement,
      spawnUiIcon: this.widgets.spawnUiIcon,
      widget58: (w, value) => set_unk_0x58_fns_8001a448(this.mem, w, value),
      widgetBF: (w, value) => set_unk_0xbf_fns_8001a450(this.mem, w, value),
      widgetLine: (w, source, index) => this.widgets.textSet(w, source, index),
      widgetNumber: (w, flag, value) => this.widgets.textNumber(w, flag, value),
      widgetHide: (w, flag) => this.widgets.textShow(w, flag),
      widgetShow: (w, flag) => this.widgets.textShow(w, flag),
      widget84: (w, x, y) => this.widgets.cursorPlace(w, x, y),
      widget80: (w, value) => this.widgets.cursorShow(w, value),
      widget88: (w, value) => uiIconSetUnk60(this.mem, w, value),
      widget94: (w, value) => uiIconSetUnk7c(this.mem, w, value),
      initDrawContext: this.draw.initDrawContext,
      draw74: this.draw.setOrigin, draw7C: this.draw.setLayer, draw88: this.draw.paletteShift,
      draw8C: this.draw.setScale, draw94: this.draw.setPos,
      drawSprite: this.draw.drawSprite, packResolve: this.draw.packResolve,
      initCardView: () => this.cardView.init(),
      cardResolve: (id: number) => this.cardView.select(id),
      cardBadge: () => this.cardView.kind(),
      cardByte: (offset: number) => this.cardView.byte(offset),
      cardSetPairA: (x: number, y: number) => this.cardView.setPairA(x, y),
      cardSetPairB: (x: number, y: number) => this.cardView.setPairB(x, y),
      cardSetSize: (col: number, row: number) => this.cardView.setSize(col, row),
      cardDispatch: (layer: number, bucket: number) => { this.cardView.dispatch(layer, bucket); },
      cardDrawCell: (x: number, y: number) => this.cardView.drawCell(x, y),
      cardCommit: () => this.cardView.commit(),
      foldStart: (sub: number, direction: number) => windowFoldStart(this.mem, sub, direction),
      foldTick: (sub: number) => windowFoldTick(this.mem, sub),
      pagerLayerSlot: () => 0,
      pagerNewPrimitive: () => 0,
      pagerEmit: () => {},
      pagerSet: (bar: number, slot: number, a: number, b?: number) => this.tree.callMethod(bar, slot, b === undefined ? [a] : [a, b]),
      padPressed: () => this.pad.pressed(), padRepeat: () => this.pad.repeated(),
      padHeld: () => this.pad.held(), padKey: (_port, code) => code,
      playSound: (id: number) => this.host.playSound(id),
      resourceGet: (id: number) => this.banks.source(id),
      frameCount: () => this.frame,
      timeDelta: () => 1,
    };
  }

  // ── the rename keyboard's host ─────────────────────────────────────────────
  private keyboardHost() {
    return {
      alloc: (handler: number, size: number, extra: number): number => this.tree.allocate(handler, size, extra),
      createWidget: (layer: number, x: number, y: number): number => this.widgets.createTextElement(layer, 1, x, y),
      callMethod: (target: number, slot: number, args: number[]): void => this.call(target, slot, args),
      copyString: (dst: number, src: number, _mode: number): void => this.copyName(dst, src),
      stringLength: (ptr: number): number => this.nameLength(ptr),
      foldStart: (fold: number, direction: number): void => {
        windowFoldStart(this.mem, fold, direction);
        this.host.playSound(direction ? 0x40019 : 0x4001a);
      },
      foldTick: (fold: number): number => windowFoldTick(this.mem, fold),
      padPressed: (_n: number): number => this.pad.pressed(),
      padHeld: (_n: number): number => this.pad.held(),
      padRepeat: (_n: number): number => this.pad.repeated(),
      padBit: (_pad: number, code: number): number => code,
      playSound: (id: number): void => this.host.playSound(id),
      packHandle: (_id: number): number => this.draw.packResolve(PACK_NAMEDT),
      languageBank: (id: number): number => this.banks.source(id),
      frameCount: (): number => this.frame,
      drawInit: this.draw.initDrawContext,
      draw74: this.draw.setOrigin, draw7C: this.draw.setLayer, draw88: this.draw.paletteShift,
      draw8C: this.draw.setScale, draw94: this.draw.setPos,
      drawSprite: this.draw.drawSprite,
      gpuInit: () => {}, gpu24: () => {}, gpu2C: () => {},
    };
  }

  private allocateHost() {
    return { allocate: (handler: number, size: number, extra: number): number =>
      this.tree.allocate(handler, size, extra) };
  }

  /** The resident string copy / length the name field uses (host boundaries). */
  private copyName(dst: number, src: number): void {
    for (let i = 0; ; i++) {
      const b = this.mem.read8(src + i);
      this.mem.write8(dst + i, b);
      if (b === 0) break;
      if (i > 0x40) break;
    }
  }
  private nameLength(ptr: number): number {
    // F0x8002525C(exe-decomp/c/F0x8002525c.c): count bytes after the first
    // until the terminator, exactly as F0x80088634 reads it.
    let n = 0;
    let at = ptr;
    for (;;) {
      at += 1;
      if (this.mem.read8(at) === 0 || n > 0x40) break;
      n += 1;
    }
    return n;
  }

  private popupHost() {
    return {
      baseMethod28: (obj: number, value: number) => this.tree.callMethod(obj, 0x28, [value]),
      baseMethod38: (obj: number) => this.tree.callMethod(obj, 0x38),
      commitFade: (obj: number) => { this.mem.write32(obj + 0x68, this.mem.read32(obj + 0x5c)); },
    };
  }

  private lifecycleHost() {
    return {
      ...this.drawHost(),
      call89354: (obj: number, ctx: number) => folderPickerTick(this.mem, obj, ctx, this.pickerHost()),
      call88b34: (obj: number, ctx: number) => folderListCreateLabels(this.mem, obj, ctx, {
        createTextElement: this.widgets.createTextElement,
        spawnUiIcon: this.widgets.spawnUiIcon,
        cursorActivate: (cursor: number) => this.widgets.cursorShow(cursor, 0),
      }),
      wait8330: () => folderRequestTextBanks(this.mem, this.banksHost()),
      ready8334: () => folderTextBanksPending(this.mem, this.banksHost()),
      baseMethod28: (obj: number, value: number) => this.tree.callMethod(obj, 0x28, [value]),
      baseMethod38: (obj: number) => this.tree.callMethod(obj, 0x38),
      childEC: (child: number, arg: number) => this.tree.callMethod(child, 0xec, [arg]),
      childF0: (child: number) => this.tree.callMethod(child, 0xf0, []),
      svc2714: () => { this.closed = true; return 0; },
      svc2708: () => 0,
      svc270c: () => {},
    };
  }

  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    if (this.closed) return;
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.root);
    this.widgets.tickCursors(this.frame);
  }

  finished(): boolean { return this.closed || !this.tree.tasks.has(this.root); }
  /** The visible dim the popup fade drives (popup +0x5C, 0..0xFF00). */
  fadeLevel(): number {
    if (this.popup === 0) return 0;
    const value = this.mem.read32(this.popup + 0x5c) | 0;
    return Math.max(0, Math.min(255, value >> 8));
  }
  /** Read the three folder records back, exactly as the walker commits them. */
  result(): Array<{ nameBytes: number[]; cards: number[] }> {
    const out = [];
    for (let f = 0; f < FOLDER_COUNT; f++) {
      const rec = FOLDER_RECORD_BASE + f * FOLDER_RECORD_STRIDE;
      const nameBytes: number[] = [];
      for (let i = 0; i < FOLDER_NAME_MAX; i++) {
        const b = this.mem.read8(rec + i) & 0xff;
        if (b === 0) break;
        nameBytes.push(b);
      }
      const cards: number[] = [];
      for (let i = 0; i < FOLDER_CARDS_PER_FOLDER; i++) {
        cards.push(this.mem.read16(rec + FOLDER_CARDS_OFF + i * 2) & 0xffff);
      }
      out.push({ nameBytes, cards });
    }
    return out;
  }
  /**
   * The disc record bytes the shared card-view context resolves for a card id.
   * Selecting through the context proves the editor's detail panel reads the
   * real CARDPAK record (AP/HP/kind/cost), not a colour-only table.
   */
  cardDetail(id: number): Record<string, number> {
    this.cardView.select(id);
    return {
      colour: this.cardView.byte(0), ap: this.cardView.byte(1), hp: this.cardView.byte(2),
      kind: this.cardView.byte(3), programCost: this.cardView.byte(4),
      summonCost: this.cardView.byte(5), level: this.cardView.byte(6),
      kindWord: this.cardView.kind(),
    };
  }
  diagnostics(): Record<string, unknown> {
    return {
      language: this.language,
      state: this.mem.read32(this.root + 0x0c) | 0,
      picker: this.mem.read32(this.root + 0x10) | 0,
      cursor: this.mem.read32(this.root + 0x60) | 0,
      mode: this.mem.read32(this.root + 0x0c) | 0,
      popup: this.popup,
      child: this.child,
      tasks: this.tree.tasks.size,
    };
  }
}
