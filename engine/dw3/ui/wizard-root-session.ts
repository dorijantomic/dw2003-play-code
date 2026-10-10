// Frame owner for the translated registration wizard (pro/stplnmet): the Online
// Center clerk's account-name keyboard, starter-pack list and "Register
// account?" panel.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Every
// routine the wizard runs is a registered port (engine/dw3/ui/wizard-*.ts and
// engine/dw3/ui/native/wizard-*.ts, and the keyboard bodies in
// engine/dw3/ui/native/name-keyboard.ts with the wizard's layout); this file
// composes them into one task tree and supplies the shared services they call.
// No instruction is executed.
//
// Data-only inputs: the overlay's data tail (portrait frames, pack membership,
// keyboard grids and labels, animation tables), the resident font and cursor
// glyph blocks, the starter membership table, and the three text families the
// wizard reads.
import { NativeMemory } from "../../native/memory.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { PARTY_MAP, requestScreenTransition } from "../party-context.ts";
import { strlenBytes } from "../byte-ops.ts";
import { convertTextEncoding } from "./fetch-table.ts";
import { installShopFont } from "./shop-font.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { textRevealTick, rescanVisibleWindow } from "./text-window.ts";
import { drawTextElement, type TextDrawerStepperHost } from "./text-drawer.ts";
import {
  getUnkC1, getUnkC3, isState1, set_unk_0xc8_fns_8001a418, setTextScroll, setTextWidgetOrigin,
} from "./text-element-setters.ts";
import {
  wizardFrameStepCreate, wizardFrameStepTick, wizardIntroCreate, wizardIntroSetLayer,
  wizardIntroSetup, wizardIntroTick, wizardPortraitDraw, wizardTableDwellCreate,
  wizardTableDwellTick, wizardChromeCreate, wizardChromeTick,
  WIZARD_CHROME_HANDLER, WIZARD_FRAME_STEP_HANDLER, WIZARD_INTRO_HANDLER,
  WIZARD_TABLE_DWELL_HANDLER,
  type WizardChromeHost, type WizardIntroHost, type WizardPortraitHost,
} from "./wizard-anim.ts";
import { wizardHeaderBuild, wizardHeaderSelect, type WizardHeaderHost } from "./wizard-headers.ts";
import {
  wizardConfirmAccept, wizardConfirmShow, wizardNameEntryState, wizardPackListShow,
} from "./wizard-methods.ts";
import { wizardNameFieldInit } from "./wizard-name-init.ts";
import { wizardNameEntryShow, wizardNameFieldBox } from "./wizard-name-field.ts";
import { wizardNameFieldSave } from "./wizard-name-save.ts";
import {
  wizardConfirmCreate, wizardFoldStart, wizardFoldTick, wizardNameEntryCreate,
  wizardPackListCreate, WIZARD_CONFIRM, WIZARD_NAME_ENTRY, WIZARD_PACK_LIST,
  type WizardPanelHost,
} from "./wizard-panels.ts";
import {
  wizardRootCreate, wizardRootTick, WIZARD_ROOT_BANK_OFFSETS, WIZARD_ROOT_HANDLER,
  type WizardRootTickHost,
} from "./wizard-root.ts";
import { wizardSequenceTick, WIZARD_SAVE_CONTEXT, type WizardSequenceHost } from "./wizard-sequence.ts";
import {
  nameEntryTick, nameEntryWidgetsBind, WIZARD_KEYBOARD_LAYOUT, type NameKeyboardHost,
} from "./native/name-keyboard.ts";
import { confirmPanelTick, confirmWidgetsBind, type ConfirmHost } from "./native/wizard-confirm.ts";
import { packListTextBind, packListTick, type PackListHost } from "./native/wizard-pack-list.ts";
import { commitStarterPack, STARTER_MEMBERS, STARTER_PACK_ID } from "./native/wizard-commit.ts";
import { scaleMatrix } from "./native/wizard-misc.ts";

/** The overlay's data tail, loaded where the original placed it. */
export const WIZARD_TABLES_BASE = 0x800885e4;
export const WIZARD_TABLES_SIZE = 0x16cc;
export const WIZARD_LANGUAGE_CELL = 0x8005cca8;
/** The registered-name buffer (game byte encoding, NUL-terminated). */
export const WIZARD_REGISTERED_NAME = WIZARD_SAVE_CONTEXT;
export const WIZARD_NAME_BYTES = 8 * 2 + 1;

export interface WizardResources {
  tables: Uint8Array;
  font: Uint8Array;
  banks: ReadonlyMap<number, Uint8Array>;
  /** The nine starter-pack membership bytes (three packs of three roster slots). */
  members: readonly number[];
  cursorGlyphs: { tableBase: number; tableBytes: number[]; stringsBase: number; stringBytes: number[] };
  /** The text engine's wait-for-button table (logical ids by wait operand). */
  textButtons: { address: number; bytes: number[] };
}

export interface WizardSessionHost {
  playSound(id: number): void;
}

export interface WizardRegistration {
  /** The typed account name, in the game's own byte encoding. */
  accountName: Uint8Array;
  pack: number;
  /** The three roster slots the pack granted, in party order. */
  members: number[];
}

const s16 = (v: number): number => (v << 16) >> 16;

export class WizardRootSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  readonly root: number;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly primAddress: number;
  private readonly otAddress: number;
  private readonly scratchAddress: number;
  private readonly packetArea: number;
  private readonly drawScratch: number;
  private readonly revealHost: Parameters<typeof textRevealTick>[1];
  private frame = 0;
  private committed = false;

  constructor(language: number, accountName: Uint8Array, resources: WizardResources,
              host: WizardSessionHost) {
    if (resources.tables.length !== WIZARD_TABLES_SIZE) throw new Error("Invalid wizard data tail");
    if (resources.members.length !== 9) throw new Error("Invalid starter membership table");
    if (accountName.length > WIZARD_NAME_BYTES - 1 || accountName.includes(0)) {
      throw new Error("Invalid registered account name");
    }
    const mem = this.mem;
    mem.load(resources.tables, WIZARD_TABLES_BASE);
    installShopFont(mem, resources.font);
    const glyphs = resources.cursorGlyphs;
    mem.load(Uint8Array.from(glyphs.tableBytes), glyphs.tableBase);
    mem.load(Uint8Array.from(glyphs.stringBytes), glyphs.stringsBase);
    mem.load(Uint8Array.from(resources.members), STARTER_MEMBERS);
    mem.load(Uint8Array.from(resources.textButtons.bytes), resources.textButtons.address);
    this.banks = new ScreenTextBanks(mem, language, WIZARD_ROOT_BANK_OFFSETS, resources.banks, "wizard");
    this.widgets = new ShopWidgetServices(mem, this.banks as never);
    mem.write32(WIZARD_LANGUAGE_CELL, language);
    mem.load(accountName, WIZARD_REGISTERED_NAME);
    mem.write8(WIZARD_REGISTERED_NAME + accountName.length, 0);
    for (let i = 0; i < 3; i++) mem.write32(PARTY_MAP + i * 4, 0xffffffff);
    this.primAddress = this.widgets.arena.alloc(0x30, 4);
    this.otAddress = this.widgets.arena.alloc(8, 4);
    this.scratchAddress = this.widgets.arena.alloc(0x40, 4);
    this.packetArea = this.widgets.arena.alloc(0x4000, 4);
    this.drawScratch = this.widgets.arena.alloc(0x48, 4);
    const drawerHost: TextDrawerStepperHost = {
      // Text is painted by the browser from the widgets' own fields; the drawer still
      // runs each frame because it steps the typewriter, waits and page breaks.
      viewForKey: () => 1,
      bucketFor: () => this.otAddress,
      packetCursor: () => this.packetArea,
      flushPacketCursor: () => {},
      rotMatrixYXZ: () => { throw new Error("Rotated text is not translated"); },
      scaleMatrix: (dst, scale) => scaleMatrix(mem, dst, scale),
      applyMatrixSV: (matrix, vector, out) => this.applyMatrix(matrix, vector, out),
      alloc: this.widgets.arena.alloc,
      free: this.widgets.arena.free,
      stringById: (bank, id) => this.banks.stringById(mem, bank, id),
    };
    this.revealHost = {
      draw: (self) => drawTextElement(mem, drawerHost, self, this.drawScratch),
      playPackedSound: (id) => host.playSound(id),
      padButtonWord: () => this.pad.pressed(),
      logicalButtonBit: (code) => code,
      free: (ptr) => { if (this.widgets.arena.has(ptr)) this.widgets.arena.free(ptr); },
    };

    const draw = this.draw;
    const alloc = (handler: number, size: number, extra: number) => this.tree.allocate(handler, size, extra);
    const advance = (obj: number) => this.tree.callMethod(obj, 0x38);
    const playFoldSound = (id: number) => host.playSound(id);
    const animHost = {
      allocAnim: alloc, advance, initDrawContext: () => draw.initDrawContext(),
      setOrigin: draw.setOrigin, setLayer: draw.setLayer, drawSprite: draw.drawSprite,
      packResolve: draw.packResolve, frameTick: draw.frameTick,
    };
    const introHost: WizardIntroHost = { ...animHost, installStandardContext: () => {}, contextCall: () => {} };
    const portraitHost: WizardPortraitHost = { ...animHost, setScale: draw.setScale, setPos: draw.setPos };
    const headerHost: WizardHeaderHost = {
      createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
      resourceGetBase: (id) => this.banks.source(id),
      widgetSetLine0: (w, source, index) => this.widgets.textSet(w, source, index),
      widgetSet138: (w, v) => this.widgets.textColour(w, v),
      widgetClear: (w, v) => this.widgets.textShow(w, v),
    };
    const chromeHost: WizardChromeHost = {
      allocChrome: alloc, advance,
      setState0: (obj, state) => this.tree.callMethod(obj, 0x28, [state]),
      setSubstate: (obj, sub) => this.tree.callMethod(obj, 0x2c, [sub]),
      resourceGetBase: (id) => this.banks.source(id),
      createWidget: (view, font, x, y) => this.widgets.createTextElement(view, font, x, y),
      widgetSetPageLines: (w, n) => this.widgets.textFlagBF(w, n),
      widgetSetResourceLine: (w, base, line) => this.widgets.textSet(w, base, line),
      widgetSetColourRow: (w, row) => this.widgets.textColour(w, row),
      widgetSetTypewriter: (w, run) => this.widgets.textShow(w, run),
      widgetSetCallback: (w, cue) => set_unk_0xc8_fns_8001a418(mem, w, cue),
      widgetSetTypewriterSpeed: (w, speed) => setTextScroll(mem, w, speed),
      widgetSetPos: (w, x, y) => setTextWidgetOrigin(mem, w, x, y),
      widgetBusy: (w) => getUnkC3(mem, w),
      widgetState: (w) => isState1(mem, w),
      widgetFlag: (w) => getUnkC1(mem, w),
      widgetReveal: (w) => { rescanVisibleWindow(mem, w); },
      padPressed: () => this.pad.pressed(),
      padShift: (_port, logical) => logical,
      frameTick: draw.frameTick,
      initDrawContext: () => draw.initDrawContext(),
      setOrigin: draw.setOrigin, setLayer: draw.setLayer, setClutRow: draw.paletteShift,
      drawSprite: draw.drawSprite, packResolve: draw.packResolve,
    };
    const panelHost: WizardPanelHost = {
      playSound: playFoldSound,
      allocWizardPanel: alloc,
      initNameField: (obj, saveCtx) => wizardNameFieldInit(mem, obj, saveCtx, {
        initTextContext: () => {},
        textContextSource: (buffer, ctx, mode) => { convertTextEncoding(mem, buffer, ctx, mode); },
        measureText: (buffer) => strlenBytes(mem, buffer),
      }),
      setNameFieldBox: (obj, w, h) => wizardNameFieldBox(mem, obj, w, h),
    };
    const kbHost: NameKeyboardHost = {
      alloc,
      createWidget: (layer, x, y) => this.widgets.createTextElement(layer, 1, x, y),
      callMethod: this.call,
      copyString: (dst, src, mode) => { convertTextEncoding(mem, dst, src, mode); },
      stringLength: (ptr) => strlenBytes(mem, ptr),
      foldStart: (fold, direction) => {
        windowFoldStart(mem, fold, direction);
        host.playSound(direction ? 0x40019 : 0x4001a);
      },
      foldTick: (fold) => windowFoldTick(mem, fold),
      padPressed: () => this.pad.pressed(),
      padHeld: () => this.pad.held(),
      padRepeat: () => this.pad.repeated(),
      padBit: (_pad, code) => code,
      playSound: host.playSound,
      packHandle: (id) => id >>> 0,
      languageBank: (id) => this.banks.source(id),
      frameCount: () => draw.frameTick(),
      drawInit: () => draw.initDrawContext(),
      draw74: draw.setOrigin, draw7C: draw.setLayer, drawSprite: draw.drawSprite,
      draw88: draw.paletteShift, draw8C: draw.setScale, draw94: draw.setPos,
      gpuInit: () => {}, gpu24: () => {}, gpu2C: () => {},
    };
    const plHost: PackListHost = {
      createWidget: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      callMethod: this.call,
      languageBank: (id) => this.banks.source(id),
      padPressed: () => this.pad.pressed(),
      padRepeat: () => this.pad.repeated(),
      padBit: (_pad, code) => code,
      playSound: host.playSound,
      packHandle: (id) => id >>> 0,
      frameCount: () => draw.frameTick(),
      show: (obj, on) => this.tree.callMethod(obj, 0x88, [on]),
      drawInit: () => draw.initDrawContext(),
      draw74: draw.setOrigin, draw7C: draw.setLayer, drawSprite: draw.drawSprite,
      draw88: draw.paletteShift,
    };
    const cfHost: ConfirmHost = {
      createWidget: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      createIcon: (layer, order, x, y) => this.widgets.spawnUiIcon(layer, order, x, y),
      callMethod: this.call,
      languageBank: (id) => this.banks.source(id),
      padPressed: () => this.pad.pressed(),
      padBit: (_pad, code) => code,
      playSound: host.playSound,
      packHandle: (id) => id >>> 0,
      frameCount: () => draw.frameTick(),
      foldStart: (fold, open) => { wizardFoldStart(mem, fold, open, { playSound: playFoldSound }); },
      foldTick: (fold) => wizardFoldTick(mem, fold),
      show: (obj, on) => this.tree.callMethod(obj, 0xdc, [on]),
      drawInit: () => draw.initDrawContext(),
      draw74: draw.setOrigin, draw7C: draw.setLayer, drawSprite: draw.drawSprite,
      draw88: draw.paletteShift, draw8C: draw.setScale, draw94: draw.setPos,
      rotMatrix: (rotation, matrix) => this.rotMatrix(rotation, matrix),
      scaleMatrix: (matrix, scale) => scaleMatrix(mem, matrix, scale),
      applyMatrix: (matrix, input, output) => this.applyMatrix(matrix, input, output),
      otSlot: () => this.otAddress,
      allocPrim: () => this.primAddress,
      commitPrim: (end) => this.commitPrim(end - 0x24),
      scratch: () => this.scratchAddress,
    };
    const sequenceHost: WizardSequenceHost = {
      foldStart: (ctx, open) => { wizardFoldStart(mem, ctx, open, { playSound: playFoldSound }); },
      foldTick: (ctx) => wizardFoldTick(mem, ctx),
      createIntro: () => wizardIntroCreate(mem, animHost),
      introSetBox: (intro, w, h) => this.tree.callMethod(intro, 0x7c, [w, h]),
      introBind: (intro, value, n) => this.tree.callMethod(intro, 0x80, [value, n]),
      createFrameStep: () => wizardFrameStepCreate(mem, animHost),
      createTableDwell: () => wizardTableDwellCreate(mem, animHost),
      createChrome: (root) => wizardChromeCreate(mem, root, chromeHost),
      createNameEntry: (saveCtx) => wizardNameEntryCreate(mem, saveCtx, panelHost),
      createPackList: (root) => wizardPackListCreate(mem, root, panelHost),
      createConfirm: (root) => wizardConfirmCreate(mem, root, panelHost),
      selectHeader: (root, block, mode) => wizardHeaderSelect(mem, root, block, mode, headerHost),
      nameEntryShow: (ne, on) => this.tree.callMethod(ne, 0xf0, [on]),
      packListShow: (pl, on) => this.tree.callMethod(pl, 0x88, [on]),
      confirmAccept: (cf) => this.tree.callMethod(cf, 0xe0, []),
      confirmShow: (cf, on) => this.tree.callMethod(cf, 0xdc, [on]),
      nameEntryLoad: (ne, saveCtx) => this.tree.callMethod(ne, 0xec, [saveCtx]),
      commitStarterName: (pack) => { commitStarterPack(mem, pack); this.committed = true; },
      advanceSubstate: (obj) => this.tree.callMethod(obj, 0x3c),
    };
    const rootHost: WizardRootTickHost = {
      allocWizardRoot: alloc,
      installStandardContext: () => 0,
      contextCall: () => {},
      packResolve: (handle) => handle >>> 0,
      requestBank: () => {},
      bankPending: () => 0, // Every text family was loaded before the screen was made.
      ensureSoundArchiveLoaded: () => {},
      buildHeaders: (obj, block) => wizardHeaderBuild(mem, obj, block, headerHost),
      runSequence: (obj, block) => wizardSequenceTick(mem, obj, block, sequenceHost),
      drawPortrait: (obj) => wizardPortraitDraw(mem, obj, portraitHost),
      setState: (obj, phase) => this.tree.callMethod(obj, 0x28, [phase]),
      audioPending: () => 0,
      playSound: host.playSound,
      playSoundExit: host.playSound,
      requestTransition: (selector, arg) => requestScreenTransition(mem, selector, arg),
    };
    const saveHost = {
      initTextContext: () => {},
      textContextCopy: (saveCtx: number, field: number, mode: number) => {
        convertTextEncoding(mem, saveCtx, field, mode);
      },
    };
    const showKeyboard = (obj: number, on: number) => wizardNameEntryShow(mem, obj, on, {
      nameEntryChildCall: (o, child, mode) =>
        nameEntryWidgetsBind(mem, o, child, mode, kbHost, WIZARD_KEYBOARD_LAYOUT),
    });

    const classes = new Map<number, TranslatedTaskClass>();
    classes.set(WIZARD_ROOT_HANDLER, {
      name: "wizard root", terminalTick: true,
      childSlots: [0x0, 0x4, 0x8, 0xc, 0x10, 0x14, 0x18],
      tick: (root, children) => wizardRootTick(mem, root, children, rootHost),
    });
    classes.set(WIZARD_INTRO_HANDLER, {
      name: "wizard intro", childSlots: [],
      tick: (obj) => wizardIntroTick(mem, obj, animHost),
      methods: new Map([
        [0x7c, (obj, args) => wizardIntroSetup(mem, obj, args[0]!, args[1]!, introHost)],
        [0x80, (obj, args) => wizardIntroSetLayer(mem, obj, args[0]!, args[1]!)],
      ]),
    });
    classes.set(WIZARD_FRAME_STEP_HANDLER, {
      name: "wizard frame step", childSlots: [], tick: (obj) => wizardFrameStepTick(mem, obj, animHost),
    });
    classes.set(WIZARD_TABLE_DWELL_HANDLER, {
      name: "wizard table dwell", childSlots: [], tick: (obj) => wizardTableDwellTick(mem, obj, animHost),
    });
    classes.set(WIZARD_CHROME_HANDLER, {
      name: "wizard chrome", childSlots: [],
      tick: (obj, block) => wizardChromeTick(mem, obj, block, chromeHost),
    });
    classes.set(WIZARD_NAME_ENTRY.handler, {
      name: "wizard name keyboard", childSlots: [],
      tick: (obj, ui) => nameEntryTick(mem, obj, ui, kbHost, WIZARD_KEYBOARD_LAYOUT),
      methods: new Map([
        [0xec, (obj, args) => wizardNameFieldSave(mem, obj, args[0]!, saveHost)],
        [0xf0, (obj, args) => showKeyboard(obj, args[0]!)],
        [0xf4, (obj) => wizardNameEntryState(mem, obj)],
      ]),
    });
    classes.set(WIZARD_PACK_LIST.handler, {
      name: "wizard pack list", childSlots: [],
      tick: (obj, ui) => packListTick(mem, obj, ui, plHost),
      methods: new Map([[0x88, (obj, args) => wizardPackListShow(mem, obj, args[0]!, {
        packChildCall: (o, child, mode) => packListTextBind(mem, o, child, mode, plHost),
        confirmChildCall: () => { throw new Error("The pack list has no confirm child"); },
      })]]),
    });
    classes.set(WIZARD_CONFIRM.handler, {
      name: "wizard confirm", childSlots: [],
      tick: (obj, ui) => confirmPanelTick(mem, obj, ui, cfHost),
      methods: new Map([
        [0xdc, (obj, args) => wizardConfirmShow(mem, obj, args[0]!, {
          confirmChildCall: (o, child, mode) => confirmWidgetsBind(mem, o, child, mode, cfHost),
          packChildCall: () => { throw new Error("The confirm panel has no pack child"); },
        })],
        [0xe0, (obj) => wizardConfirmAccept(mem, obj)],
      ]),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.root = wizardRootCreate(mem, { allocWizardRoot: alloc });
  }

  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.root);
    // Each text widget is its own scheduled object in the original: advance the
    // typewriter reveal once a frame. The browser paints the glyphs it reveals.
    this.widgets.forEachText((w) => textRevealTick(this.mem, this.revealHost, w));
    this.widgets.tickCursors(this.frame);
  }

  finished(): boolean { return !this.tree.tasks.has(this.root); }

  /** The chosen pack and account name once the player answered YES. */
  registration(): WizardRegistration | null {
    if (!this.committed) return null;
    const bytes: number[] = [];
    for (let i = 0; i < WIZARD_NAME_BYTES; i++) {
      const b = this.mem.read8(WIZARD_REGISTERED_NAME + i);
      if (b === 0) break;
      bytes.push(b);
    }
    return {
      accountName: new Uint8Array(bytes),
      pack: this.mem.read32(STARTER_PACK_ID) | 0,
      members: [0, 1, 2].map((i) => this.mem.read32(PARTY_MAP + i * 4) | 0),
    };
  }

  /** A widget or cursor method by slot, or a task method through the tree. */
  private call = (target: number, slot: number, args: number[]): void => {
    target >>>= 0;
    if (this.tree.tasks.has(target)) { this.tree.callMethod(target, slot, args); return; }
    dispatchWidgetMethod(this.mem, this.widgets, target, slot, args);
  };

  /**
   * F0x8002B65C(rotation, matrix): libgte RotMatrix. The confirm panel's rotation
   * vector is never written (nothing in the overlay stores to it), so every call
   * is the identity rotation; a nonzero angle is refused, not guessed.
   */
  private rotMatrix(rotation: number, matrix: number): void {
    for (const off of [0, 2, 4]) {
      if (this.mem.read16(rotation + off) !== 0) throw new Error("RotMatrix with a nonzero angle is not translated");
    }
    this.mem.write32(matrix + 0x0, 0x1000);
    this.mem.write32(matrix + 0x4, 0);
    this.mem.write32(matrix + 0x8, 0x1000);
    this.mem.write32(matrix + 0xc, 0);
    this.mem.write32(matrix + 0x10, 0x1000);
  }

  /** F0x8002B1DC(matrix, in, out): libgte ApplyMatrixSV, the GTE rotation multiply. */
  private applyMatrix(matrix: number, input: number, output: number): void {
    const m = [0, 1, 2, 3, 4].map((i) => this.mem.read32(matrix + i * 4) | 0);
    const rows = [
      [s16(m[0]!), s16(m[0]! >> 16), s16(m[1]!)],
      [s16(m[1]! >> 16), s16(m[2]!), s16(m[2]! >> 16)],
      [s16(m[3]!), s16(m[3]! >> 16), s16(m[4]!)],
    ];
    const v = [s16(this.mem.read16(input)), s16(this.mem.read16(input + 2)), s16(this.mem.read16(input + 4))];
    rows.forEach((row, i) => {
      const sum = row[0]! * v[0]! + row[1]! * v[1]! + row[2]! * v[2]!;
      const shifted = Math.floor(sum / 4096);
      this.mem.write16(output + i * 2, Math.max(-0x8000, Math.min(0x7fff, shifted)) & 0xffff);
    });
  }

  /** The confirm panel's Gouraud quad, handed to the renderer as one picture call. */
  private commitPrim(prim: number): void {
    const b = (off: number) => this.mem.read8(prim + off);
    const vertex = (off: number): number[] => [s16(this.mem.read16(prim + off)), s16(this.mem.read16(prim + off + 2))];
    const colour = (off: number): number[] => [b(off), b(off + 1), b(off + 2)];
    this.draw.calls.push({
      method: "gouraudQuad",
      args: [...vertex(8), ...vertex(0x10), ...vertex(0x18), ...vertex(0x20),
             ...colour(4), ...colour(0xc), ...colour(0x14), ...colour(0x1c)],
    });
  }
}
