// Production composition of the Card Album (pro/stcrdabm). The already-oracled
// screen controllers (album-lifecycle, album-tick, album-grid-object,
// album-grid, album-panel, album-cells-draw, album-banks, album-leaves,
// album-residue) run as registered translated tasks. The shared services are the
// shop's: ShopWidgetServices (text widgets, font, cursor), ShopDrawIntents (the
// picture context), window-fold (both fold pairs F0x8008B838/F0x8008B83C) and
// the card-view class (the resident text context F0x8001EBF8 and its record
// selector F0x8001E7EC). No instruction decoder or executable image is
// reachable from this module; the interpreted reference is web/cardalbum-native.js
// behind ?nativeAlbum=1.
//
// Object-identity question, settled from the overlay: the page mask F0x80084BC8
// runs on the SCREEN object. Both call sites of F0x80084C38's body pass $s1 (the
// screen's own a0), so the mask reads the screen's page +0x60 and writes the
// screen's slot flags +0x80 / any-flag +0x7C. The grid object carries its own
// +0x60 (prevPage) for its begin-page swap, but the mask never runs on it. This
// module therefore drives engine/dw3/ui/native/album-leaves.ts#albumPageMask.
//
// The card-record VRAM upload (F0x8008304C -> commitCardView -> LoadImage) is
// called in order but its LoadImage boundary is a no-op: the browser renderer
// paints from the extracted stalbm sheet and card atlas, not from VRAM. The
// record reads the text context exposes (badge, colour, AP/HP, summon) come from
// the extracted card catalog installed as an 8-byte-per-card table at
// ALBUM_CARD_TABLE_BASE; the full 1580-byte record stride is not materialised
// because only its leading eight bytes are ever read.
import { NativeMemory } from "../../native/memory.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopPadInput } from "./shop-pad-input.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { installShopFont } from "./shop-font.ts";
import type { CursorGlyphTable } from "./resident-text-host.ts";
import { set_unk_0x58_fns_8001a448 } from "./text-element-setters.ts";
import { fetchTableEntry } from "./fetch-table.ts";
import { setCurrentObject4_8, setCurrentObjectC_10, setCurrentViewSize_14_18, CARD_RECORD_STRIDE } from "./card-view.ts";
import {
  CardViewTextContext, installCardRecords, installCardViewTables, cardPakFileBase,
  CARD_PAK_FILES_BASE, type CardRecord, type CardViewTextHost,
} from "./native/card-view-text.ts";
import {
  albumScreenCreate, albumScreenLifecycle, ALBUM_SCREEN_HANDLER,
  ALBUM_SCREEN_SIZE, ALBUM_SCREEN_EXTRA,
} from "./native/album-lifecycle.ts";
import { albumScreenTick, ALBUM_TICK_FIELDS } from "./native/album-tick.ts";
import { albumGridCreate, albumGridTick, GRID_HANDLER, GRID_SIZE } from "./native/album-grid-object.ts";
import { albumGridDrawSilhouettes, albumGridBeginPage, ALBUM_CARD_MAX, type AlbumGridHost } from "./native/album-grid.ts";
import { albumGridDrawCells } from "./native/album-cells-draw.ts";
import { albumPanelCreateLabels, albumPanelFillHeadings } from "./native/album-panel.ts";
import {
  albumCellPaint, albumMakePopup, albumPageMask, albumPopupFadeStart, albumPopupFadeTick,
  ALBUM_POPUP_HANDLER, ALBUM_POPUP_SIZE,
} from "./native/album-leaves.ts";
import { albumPageHasCollected, albumGridDrawFaces } from "./album-residue.ts";
import { albumRequestTextBanks, albumTextBanksPending } from "./native/album-banks.ts";

/** The album's own text banks are loaded here; the five record files are data. */
export const ALBUM_TEXT_BANK_BASE = 0x801e0000;
/**
 * The CARDPAK record store the shared card-view text context reads. Named for
 * the screen, but the same store the folder session uses: it is the module that
 * carries the records (engine/dw3/ui/native/card-view-text.ts).
 */
export const ALBUM_CARD_TABLE_BASE = CARD_PAK_FILES_BASE;
/** The card-record field offsets the album's text context exposes. */
export const ALBUM_CARD_RECORD = { colour: 0, ap: 1, hp: 2, kind: 3, programCost: 4, summonCost: 5, level: 6, stride: CARD_RECORD_STRIDE } as const;
/** The three text families, each language + offset (album-banks.ts). */
export const ALBUM_TEXT_OFFSETS = [0x16, 0x1d, 0x24] as const;
/** The album text pack handle the preload resolves (album-banks.ts). */
const PACK_ALBUM_TEXT = 0x06060000;

/** One card as the album reads it: the disc record's leading fields. */
export type AlbumCardRecord = CardRecord;

export interface AlbumResources {
  banks: ReadonlyMap<number, Uint8Array>;
  cards: readonly AlbumCardRecord[];
  font: Uint8Array;
  cursorGlyphs?: CursorGlyphTable;
  ranges?: ReadonlyArray<{ base: number; bytes: Uint8Array }>;
}

export interface AlbumSessionHost {
  playSound(id: number): void;
  /** The resident save/global block the banks read their language offsets from. */
  saveBlock?: number;
}

/** The album's text banks: arbitrary ids installed at ALBUM_TEXT_BANK_BASE. */
export class AlbumTextBanks {
  readonly sources = new Map<number, number>();
  constructor(mem: NativeMemory, language: number, banks: ReadonlyMap<number, Uint8Array>) {
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid album language");
    let address = ALBUM_TEXT_BANK_BASE;
    for (const offset of ALBUM_TEXT_OFFSETS) {
      const id = offset + language;
      const data = banks.get(id);
      if (!data || data.length < 8) throw new Error(`Missing album text bank ${id}`);
      if (address + data.length > 0x80200000) throw new Error(`Album text bank ${id} overflows RAM`);
      mem.load(data, address);
      this.sources.set(id, address);
      address = ((address + data.length + 7) & ~7) >>> 0;
    }
  }
  source(id: number): number {
    const address = this.sources.get(id);
    if (address === undefined) throw new Error(`Unloaded album text bank ${id}`);
    return address;
  }
  stringById(mem: NativeMemory, source: number, index: number): number {
    return fetchTableEntry(mem, source, index);
  }
}

export class AlbumSession {
  readonly mem = new NativeMemory();
  readonly pad = new ShopPadInput();
  readonly draw = new ShopDrawIntents(this.mem);
  readonly widgets: ShopWidgetServices;
  readonly banks: AlbumTextBanks;
  readonly tree: TranslatedTaskTree;
  readonly root: number;
  readonly context: number;
  private cardTableBase: number;
  private cardView!: CardViewTextContext;
  private primitiveScratch = 0;
  private frame = 0;
  private closed = false;
  private gridTask = 0;
  private popupTask = 0;
  private popup = 0;
  private readonly language: number;

  private readonly host: AlbumSessionHost;

  constructor(language: number, resources: AlbumResources, host: AlbumSessionHost) {
    this.host = host;
    this.language = language;
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid album language");
    installShopFont(this.mem, resources.font);
    for (const range of resources.ranges ?? []) this.mem.load(range.bytes, range.base);
    const glyphs = resources.cursorGlyphs;
    if (glyphs) {
      this.mem.load(Uint8Array.from(glyphs.tableBytes), glyphs.tableBase);
      this.mem.load(Uint8Array.from(glyphs.stringBytes), glyphs.stringsBase);
    }
    this.banks = new AlbumTextBanks(this.mem, language, resources.banks);
    this.widgets = new ShopWidgetServices(this.mem, this.banks as never);
    this.mem.write32(0x8005cca8, language);
    if (host.saveBlock !== undefined) this.mem.write32(0x8005cca8, host.saveBlock);

    // The shared card-view text context: the CARDPAK records at the real
    // 0x62C stride, the five file ids and the record-kind table, all installed
    // by the one module both card screens read.
    this.cardTableBase = ALBUM_CARD_TABLE_BASE;
    installCardViewTables(this.mem);
    installCardRecords(this.mem, resources.cards);
    this.cardView = new CardViewTextContext(this.mem, this.sharedViewHost());

    // Registered classes: the screen lifecycle, the grid object and the popup.
    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(ALBUM_SCREEN_HANDLER, {
      name: "album screen", childSlots: [0x44, 0x48], terminalTick: true,
      tick: (obj, ctx) => albumScreenLifecycle(this.mem, obj, ctx, this.lifecycleHost()),
    });
    classes.set(GRID_HANDLER, {
      name: "album grid", tick: (obj) => albumGridTick(this.mem, obj, this.gridHost()),
    });
    classes.set(ALBUM_POPUP_HANDLER, {
      name: "album popup",
      methods: new Map([[0x64, (obj, args) => this.popupFadeStart(obj, args[0]!, args[1]!)]]),
      tick: (obj) => this.popupTick(obj),
    });
    this.tree = new TranslatedTaskTree(this.mem, classes,
      (task) => { if (this.widgets.arena.has(task.address)) this.widgets.retireTask(task); });
    const root = this.tree.allocate(ALBUM_SCREEN_HANDLER, ALBUM_SCREEN_SIZE, ALBUM_SCREEN_EXTRA);
    const context = this.tree.tasks.get(root)!.children;
    this.root = root;
    this.context = context;
    let requests = 0;
    const allocHost = { alloc: (size: number): number => {
      const expected = requests === 0 ? ALBUM_SCREEN_SIZE : requests === 1 ? ALBUM_SCREEN_EXTRA : -1;
      if (size !== expected) throw new Error(`Unexpected album allocation ${size}, wanted ${expected}`);
      return requests++ === 0 ? root : context;
    } };
    const created = albumScreenCreate(this.mem, allocHost);
    if (created !== root || this.mem.read32(root + 0x20) !== ALBUM_SCREEN_EXTRA / 4) {
      throw new Error("Album constructor did not install its registered task block");
    }
  }

  // ── the shared card-view text context (F0x8001EBF8 / F0x8001E7EC) ─────────
  private sharedViewHost(): CardViewTextHost {
    return {
      allocate: (size: number) => this.widgets.arena.alloc(size, 4),
      loadImage: () => { /* VRAM card-art upload is replaced by the extracted atlas. */ },
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
  private initTextContext = (): void => { this.cardView.init(); };
  private textSetCard = (card: number): void => { this.cardView.select(card); };
  private cardByte = (offset: number): number => this.cardView.byte(offset);
  private textStatus = (): number => this.cardView.kind();
  private textPage = (): number => this.cardView.byte(ALBUM_CARD_RECORD.colour);
  private textBadge = (): number => this.cardView.kind();
  private commitCurrentView = (): void => { this.cardView.commit(); };

  // ── shared draw host ──────────────────────────────────────────────────────
  private drawHost() {
    return {
      initDrawContext: this.draw.initDrawContext, setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin, setScale: this.draw.setScale, setPos: this.draw.setPos,
      m_0x88: this.draw.paletteShift, drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
    };
  }

  // ── the screen lifecycle host ─────────────────────────────────────────────
  private chromeHost() {
    return {
      ...this.drawHost(),
      initTextContext: this.initTextContext, textSetPos: this.textSetCard,
      textStatus: this.textStatus, textPage: this.textPage, frame: () => this.frame,
    };
  }
  private lifecycleHost() {
    return {
      ...this.chromeHost(),
      call84c38: (obj: number, ctx: number) => albumScreenTick(this.mem, obj, ctx, this.tickHost()),
      call83bfc: (obj: number, ctx: number) => albumPanelCreateLabels(this.mem, obj, ctx, this.panelHost()),
      startBanks: (_value: number) => albumRequestTextBanks(this.mem, this.banksHost()),
      banksPending: (_value: number) => albumTextBanksPending(this.mem, this.banksHost()),
      baseMethod38: (obj: number) => this.tree.callMethod(obj, 0x38),
      resourceCall: (_a: number, _b: number) => { this.closed = true; },
      resource2714: (_flag: number) => 0,
    };
  }
  private banksHost() {
    return {
      beginRequestContext: () => {},
      requestContextOrigin: () => {}, requestContextPack: () => {},
      packResolve: () => PACK_ALBUM_TEXT,
      requestBank: (id: number) => {
        if (id >= 0x7f6 && id <= 0x7fa) return; // the record data is already installed.
        if (this.banks.sources.has(id)) return; // the text banks were loaded before the root.
        throw new Error(`Album asked for an unloaded text bank ${id}`);
      },
      pollBank: () => 0,
    };
  }

  // ── the tick host ────────────────────────────────────────────────────────
  private tickHost() {
    return {
      baseMethod28: (obj: number, value: number) => this.tree.callMethod(obj, 0x28, [value]),
      baseMethod3C: (obj: number) => this.tree.callMethod(obj, 0x3c),
      pageMask: (obj: number) => albumPageMask(this.mem, obj),
      gridObject: (obj: number) => this.buildGrid(obj),
      fillHeadings: (obj: number, ctx: number, show: number) =>
        albumPanelFillHeadings(this.mem, obj, ctx, show, this.panelHost()),
      cellPaint: (obj: number, ctx: number, show: number) =>
        albumCellPaint(this.mem, obj, ctx, show, this.cellPaintHost()),
      makePopup: () => this.buildPopup(),
      resourceGet: (id: number) => this.bankAddress(id),
      resourceLine: (id: number) => this.bankAddress(id),
      padPressed: (_port: number) => this.pad.pressed(),
      padHeld: (_port: number) => this.pad.held(),
      padRepeat: (_port: number) => this.pad.repeated(),
      padKey: (_port: number, code: number) => code,
      playSound: (id: number) => this.host.playSound(id),
      foldStart: (sub: number, direction: number) => {
        windowFoldStart(this.mem, sub, direction);
        this.host.playSound(direction ? 0x40019 : 0x4001a);
      },
      foldTick: (sub: number) => windowFoldTick(this.mem, sub),
      widget114: (widget: number, source: number, index: number) => this.widgets.textSet(widget, source, index),
      widget118: (widget: number, line: number, value: number) => this.widgets.textNumber(widget, line, value),
      widget144: (widget: number, value: number) => this.widgets.textShow(widget, value),
      widget148: (widget: number, value: number) => this.widgets.textMeasure(widget, value),
      // The screen tick's page change calls the GRID's +0x84 with page*12|1
      // (stcrdabm F0x80084C38 0x80084FA8-0x80084FC8 / 0x80084FD4-0x80084FF4;
      // a0 = [ctx+0x44], the grid object). +0x84 is the grid's begin-page
      // (F0x80083114), not a cursor position setter: it stores the page's first
      // card id in the grid's +0x5C, keeps the old window in +0x60, clears
      // +0x68/+0x70 and restarts the reveal. Mapping it to cursorPlace left the
      // grid window at 0 after every page turn (audit 2026-10-14).
      widget84: (widget: number, x: number, _y: number) => albumGridBeginPage(this.mem, widget, x, this.gridHost()),
      widget64: (widget: number, a: number, b: number) => this.tree.callMethod(widget, 0x64, [a, b]),
    };
  }

  private bankAddress(id: number): number {
    if (this.banks.sources.has(id)) return this.banks.source(id);
    if (id >= 0x7f6 && id <= 0x7fa) return cardPakFileBase(id);
    throw new Error(`Album resource ${id} is not loaded`);
  }

  // ── the grid object child ────────────────────────────────────────────────
  private buildGrid(parent: number): number {
    let requests = 0;
    const object = this.tree.allocate(GRID_HANDLER, GRID_SIZE, 0);
    const created = albumGridCreate(this.mem, { alloc: (size: number): number => {
      if (size !== GRID_SIZE || requests++ !== 0) throw new Error(`Unexpected grid allocation ${size}`);
      return object;
    } }, parent);
    if (created !== object) throw new Error("Grid constructor did not install its task block");
    this.gridTask = object;
    return object;
  }
  private gridHost() {
    return {
      ...this.drawHost(),
      initDrawContext: this.draw.initDrawContext,
      pageMethod28: (obj: number, value: number) => this.tree.callMethod(obj, 0x28, [value]),
      baseMethod38: (obj: number) => this.tree.callMethod(obj, 0x38),
      baseMethod3C: (obj: number) => this.tree.callMethod(obj, 0x3c),
      call83780: (obj: number) => this.gridPre(obj),
      call8304c: (obj: number) => albumGridDrawFaces(this.mem, obj, this.residueHost()),
      call83734: (obj: number) => albumPageHasCollected(this.mem, obj),
      drawCells: (obj: number, flag: number) => albumGridDrawCells(this.mem, obj, flag, this.cellsHost()),
      now: () => this.frame,
      displayTime: () => this.frame,
      playSound: (id: number) => this.host.playSound(id),
    };
  }
  /** F0x80083780: the grid's reveal countdown before faces are drawn. */
  private gridPre(obj: number): void {
    const sub = this.mem.read32(obj + 0x10) | 0;
    if (sub === 1) {
      const count = this.mem.read32(obj + 0x64) | 0;
      if (count !== 0) {
        this.mem.write32(obj + 0x64, count - 1);
        this.tree.callMethod(obj, 0x3c);
        this.mem.write32(obj + 0x18, this.frame);
        return;
      }
      this.mem.write32(obj + 0x0c, 3);
      return;
    }
    if (sub === 2) {
      if ((this.frame - (this.mem.read32(obj + 0x18) | 0)) >= 2) this.mem.write32(obj + 0x10, 1);
    }
  }
  private residueHost() {
    return {
      initTextContext: this.initTextContext,
      setCurrentObject4_8: (x: number, y: number) => setCurrentObject4_8(this.mem, x, y),
      setCurrentObjectC_10: (x: number, y: number) => setCurrentObjectC_10(this.mem, x, y),
      resolveCardRecord: (card: number) => this.cardView.select(card),
      setCurrentViewSize: (col: number, row: number) => setCurrentViewSize_14_18(this.mem, col, row),
      commitCurrentView: () => this.commitCurrentView(),
    };
  }
  private cellsHost() {
    return {
      ...this.drawHost(),
      initTextContext: this.initTextContext,
      textSetCard: this.textSetCard,
      textSetPos: (x: number, y: number) => setCurrentViewSize_14_18(this.mem, x, y),
      textSetScale: () => {}, textSetOrigin: () => {}, textSetClip: () => {}, textCell: () => {},
      textBadge: this.textBadge,
      textNameByte: () => this.cardByte(ALBUM_CARD_RECORD.colour),
      textLevel1: () => this.cardByte(ALBUM_CARD_RECORD.ap),
      textLevel2: () => this.cardByte(ALBUM_CARD_RECORD.hp),
    };
  }

  // ── the panel and cell widgets ───────────────────────────────────────────
  private panelHost() {
    return {
      createTextElement: this.widgets.createTextElement,
      setWidgetUnk15C: (widget: number, value: number) => set_unk_0x58_fns_8001a448(this.mem, widget, value),
      setWidgetLine0: this.widgets.textSet,
      setWidgetLineNumber: this.widgets.textNumber,
      setWidgetFlag144: this.widgets.textShow,
      setWidgetFlag148: this.widgets.textMeasure,
      resourceGet: (id: number) => this.bankAddress(id),
    };
  }
  private cellPaintHost() {
    return {
      initTextContext: this.initTextContext,
      textSetCard: this.textSetCard,
      textBadge: this.textBadge,
      textByte1: () => this.cardByte(ALBUM_CARD_RECORD.ap),
      textByte2: () => this.cardByte(ALBUM_CARD_RECORD.hp),
      textByte5: () => this.cardByte(ALBUM_CARD_RECORD.summonCost),
      resourceGet: (id: number) => this.bankAddress(id),
      setWidgetLine: this.widgets.textSet,
      setWidgetNumber: this.widgets.textNumber,
      setWidgetFlag144: this.widgets.textShow,
      setWidgetFlag148: this.widgets.textMeasure,
    };
  }

  // ── the popup (F0x80083008 / F0x80082F54 / F0x80082D88) ──────────────────
  private buildPopup(): number {
    const object = albumMakePopup(this.mem, {
      allocate: (handler: number, size: number, extra: number): number => {
        if (handler !== ALBUM_POPUP_HANDLER || size !== ALBUM_POPUP_SIZE || extra !== 0) {
          throw new Error("Unexpected album popup allocation");
        }
        return this.tree.allocate(handler, size, extra);
      },
    });
    this.popupTask = object;
    this.popup = object;
    return object;
  }
  /** F0x80082D88(popup, direction, frames): start the popup's fade tween.
   *  Translated in native/album-leaves.ts and proved against the original by
   *  tests/lane-b/album-popup-fade.test.js. */
  private popupFadeStart(popup: number, direction: number, frames: number): void {
    albumPopupFadeStart(this.mem, popup, direction, frames,
      { callMethod: (t, slot, args) => this.tree.callMethod(t, slot, args) });
  }
  /** F0x80082F54(popup): advance the fade; state 2 means it has finished.
   *  The fade quad the tick submits is painted by the browser from
   *  `fadeLevel()` (paintNativeSession), so the draw boundary is a no-op here —
   *  the same substitution the naming screen's fade uses. */
  private popupTick(popup: number): void {
    albumPopupFadeTick(this.mem, popup, {
      baseMethod38: (obj) => { this.tree.callMethod(obj, 0x38, [obj]); },
      drawFade: () => {},
      callMethod: (t, slot, args) => this.tree.callMethod(t, slot, args),
    });
  }
  private popupDone(): boolean { return this.popup !== 0 && (this.mem.read32(this.popup + 0x0c) | 0) === 2; }

  // ── seeding and per-frame ────────────────────────────────────────────────
  /** Mark the cards the walker has ever obtained, and their copy counts. */
  seedCollection(seen: Iterable<number>, owned: ReadonlyMap<number, number>): void {
    for (const id of seen) {
      const card = Number(id);
      if (Number.isInteger(card) && card >= 1 && card < ALBUM_CARD_MAX) {
        this.mem.write8(0x80048d34 + 0x4df + card, 1);
      }
    }
    for (const [id, count] of owned) {
      const card = Number(id);
      if (Number.isInteger(card) && card >= 1 && card < ALBUM_CARD_MAX) {
        this.mem.write8(0x80048d34 + 0x4df + card, 1);
        this.mem.write8(0x80048d34 + 0x3a2 + card, count & 0xff);
      }
    }
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
  /**
   * The disc record bytes the shared card-view context resolves for a card id.
   * Selecting through the context proves the screen reads the real CARDPAK
   * record (AP/HP/kind/cost), not a colour-only table.
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
  /** Diagnostics for the browser check and the lab. */
  diagnostics(): Record<string, unknown> {
    return {
      language: this.language,
      page: this.mem.read32(this.root + ALBUM_TICK_FIELDS.page) | 0,
      pageCount: this.mem.read32(this.root + ALBUM_TICK_FIELDS.pageCount) | 0,
      cell: this.mem.read32(this.root + ALBUM_TICK_FIELDS.cell) | 0,
      state: this.mem.read32(this.root + 0x10) | 0,
      taskState: this.mem.read32(this.root + 0x0c) | 0,
      anyCollected: this.mem.read32(this.root + ALBUM_TICK_FIELDS.anyFlag) | 0,
      grid: this.mem.read32(this.context + 0x44) >>> 0,
      tasks: this.tree.tasks.size,
    };
  }
}
