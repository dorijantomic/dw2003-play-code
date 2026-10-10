// Frame owner for the translated partner-naming screen (pro/stdgname).
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. The
// screen's own routines are the registered ports in engine/dw3/ui/native/
// (root, sequence, chooser, keyboard) and engine/dw3/ui/ (folds, widgets); this
// file composes them into one task tree and supplies the shared services they
// call: object allocation, text widgets, string conversion, the party records,
// pad words, sound and the picture-call collector. No instruction is executed.
//
// Data-only inputs: the overlay's data tail (grid, glyph and label tables), the
// resident font block, and the two indexed text families the screen reads.
import { NativeMemory } from "../../native/memory.ts";
import type { PadButton } from "../../systems/input-map.ts";
import {
  PARTY_MAP, ROSTER_RECORDS, ROSTER_STRIDE, getFollowerRosterSlot,
  partyPositionToRosterSlot, persistentRosterSlot, requestScreenTransition,
} from "../party-context.ts";
import { convertTextEncoding } from "./fetch-table.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { strlenBytes } from "../byte-ops.ts";
import { installShopFont } from "./shop-font.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import {
  nameScreenCreate, nameScreenIdleShimmer, NAME_SCREEN_EXTRA, NAME_SCREEN_HANDLER,
  NAME_SCREEN_SIZE,
} from "./native/name-screen.ts";
import {
  nameScreenTick, PARTNER_SELECT_EXTRA, PARTNER_SELECT_HANDLER, PARTNER_SELECT_SIZE,
  type NameSequenceHost,
} from "./native/name-sequence.ts";
import {
  partnerSelectTick, PARTNER_SELECT_INPUT_SUB, PARTNER_SELECTION_CELL, type PartnerHost,
} from "./native/partner-select.ts";
import { partnerSelectMove } from "./partner-select-move.ts";
import { partnerGridDraw } from "./native/partner-grid-draw.ts";
import {
  nameEntryCommit, nameEntryCreate, nameEntryReseed, nameEntryTick,
  NAME_ENTRY_HANDLER, type NameKeyboardHost,
} from "./native/name-keyboard.ts";
import { constructShopTask } from "./shop-task-allocation.ts";
import {
  nameFadeCreate, nameFadeStart, nameFadeTick, nameScreenOpenFade,
  NAME_FADE_HANDLER, NAME_FADE_SIZE, NAME_FADE_START_SLOT,
  type NameFadeHost,
} from "./native/name-fade.ts";

/** The overlay's data tail, loaded where the original placed it. */
export const NAME_TABLES_BASE = 0x80086830;
export const NAME_TABLES_SIZE = 0x2c80;
export const NAME_TEXT_BANK_OFFSETS = [0x40, 0x86] as const;
/** The language cell the screen reads (0 = Japanese layout). */
export const NAME_LANGUAGE_CELL = 0x8005cca8;
/** The chooser's index cell: which party position is being named. */
export const NAME_SELECTED_CELL = 0x80087f3c;

export interface NameResources {
  tables: Uint8Array;
  font: Uint8Array;
  banks: ReadonlyMap<number, Uint8Array>;
}

export interface NamePartySeed {
  rosterSlot: number;
  /** The game's own byte encoding, without the terminator. */
  nameBytes: Uint8Array;
}

export interface NameSessionHost {
  playSound(id: number): void;
}

export interface NameCommit {
  position: number;
  rosterSlot: number;
  nameBytes: Uint8Array;
}

export class NameRootSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  readonly root: number;
  readonly commits: NameCommit[] = [];
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly positions: number;
  private frame = 0;

  constructor(language: number, party: readonly NamePartySeed[], resources: NameResources,
              host: NameSessionHost) {
    if (party.length < 1 || party.length > 3) throw new Error("Naming needs one to three partners");
    if (resources.tables.length !== NAME_TABLES_SIZE) throw new Error("Invalid naming data tail");
    this.mem.load(resources.tables, NAME_TABLES_BASE);
    installShopFont(this.mem, resources.font);
    this.banks = new ScreenTextBanks(this.mem, language, NAME_TEXT_BANK_OFFSETS, resources.banks, "naming");
    this.widgets = new ShopWidgetServices(this.mem, this.banks as never);
    this.mem.write32(NAME_LANGUAGE_CELL, language);
    this.mem.write32(NAME_SELECTED_CELL, 0);
    this.positions = party.length;
    this.seedParty(party);
    const mem = this.mem;

    const classes = new Map<number, TranslatedTaskClass>();
    const kbHost = this.keyboardHost(host);
    const partnerHost = this.partnerHost(host);
    const sequenceHost = this.sequenceHost(kbHost);
    const fadeHost: NameFadeHost = {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      callMethod: (target, slot, args) => this.tree.callMethod(target, slot, args),
      dimQuad: () => {}, // The browser paints the dim from fadeLevel().
    };
    classes.set(NAME_SCREEN_HANDLER, {
      name: "naming root", childSlots: [0, 4, 8], terminalTick: true,
      tick: (root, children) => nameScreenTick(mem, root, children, sequenceHost),
      methods: new Map([[0x68, (root) => nameScreenOpenFade(mem, root, fadeHost)]]),
    });
    classes.set(PARTNER_SELECT_HANDLER, {
      name: "partner chooser", childSlots: [],
      tick: (object, rows) => partnerSelectTick(mem, object, rows, partnerHost),
    });
    classes.set(NAME_ENTRY_HANDLER, {
      name: "name keyboard", childSlots: [],
      tick: (object, ui) => nameEntryTick(mem, object, ui, kbHost),
      methods: new Map([
        [0xf0, (object, args) => nameEntryReseed(mem, object, args[0]!, kbHost)],
        [0xf4, (object) => nameEntryCommit(mem, object)],
      ]),
    });
    classes.set(NAME_FADE_HANDLER, {
      name: "naming fade", childSlots: [],
      tick: (fade) => nameFadeTick(mem, fade, fadeHost),
      methods: new Map([[NAME_FADE_START_SLOT,
        (fade, args) => nameFadeStart(mem, fade, args[0]!, args[1]!, fadeHost)]]),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.root = constructShopTask(this.tree, NAME_SCREEN_HANDLER, NAME_SCREEN_SIZE,
      NAME_SCREEN_EXTRA, (allocation) => nameScreenCreate(mem, allocation));
  }

  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.root);
    this.widgets.tickCursors(this.frame);
  }

  finished(): boolean { return !this.tree.tasks.has(this.root); }

  /** 0..255: how far the closing fade has darkened the screen. */
  fadeLevel(): number {
    if (this.finished()) return 255;
    const children = this.mem.read32(this.root + 0x24) >>> 0;
    const fade = this.mem.read32(children + 8) >>> 0;
    return fade ? Math.max(0, Math.min(255, (this.mem.read32(fade + 0x5c) | 0) >> 8)) : 0;
  }

  /** The party position the chooser currently points at. */
  selectedPosition(): number { return this.mem.read32(NAME_SELECTED_CELL) | 0; }

  /** The partner chooser's sub-state, or null when it is not on screen. */
  chooserSubState(): number | null {
    for (const task of this.tree.tasks.values()) {
      if (task.classId === PARTNER_SELECT_HANDLER) return this.mem.read32(task.address + 0x10) | 0;
    }
    return null;
  }

  /**
   * True only while the chooser sits on F0x8008601C, the single sub-state of
   * F0x80085DE4 that calls F0x80085B70 and so reads the pad. Every earlier
   * sub-state walks the rows forward a step per ready widget and never looks at
   * a button, so Back pressed there is dropped by the screen itself.
   */
  chooserReadingPad(): boolean { return this.chooserSubState() === PARTNER_SELECT_INPUT_SUB; }

  /** Every party position's stored name bytes (the game's own encoding). */
  names(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let position = 0; position < this.positions; position++) {
      out.push(this.nameBytesAt(this.mem.read32(PARTY_MAP + position * 4) | 0));
    }
    return out;
  }

  private nameBytesAt(rosterSlot: number): Uint8Array {
    const base = persistentRosterSlot(rosterSlot);
    const bytes: number[] = [];
    for (let i = 0; i < 24; i++) {
      const b = this.mem.read8(base + i);
      if (b === 0) break;
      bytes.push(b);
    }
    return new Uint8Array(bytes);
  }

  private seedParty(party: readonly NamePartySeed[]): void {
    const seen = new Set<number>();
    for (let position = 0; position < 3; position++) {
      const member = party[position];
      if (!member) { this.mem.write32(PARTY_MAP + position * 4, 0xffffffff); continue; }
      if (!Number.isInteger(member.rosterSlot) || member.rosterSlot < 0 || member.rosterSlot > 8 ||
          seen.has(member.rosterSlot)) throw new Error("Invalid naming roster slot");
      seen.add(member.rosterSlot);
      if (member.nameBytes.length > 23 || member.nameBytes.includes(0)) throw new Error("Invalid naming name bytes");
      this.mem.write32(PARTY_MAP + position * 4, member.rosterSlot);
      const base = ROSTER_RECORDS + member.rosterSlot * ROSTER_STRIDE;
      this.mem.write32(base, member.rosterSlot + 3);
      this.mem.load(member.nameBytes, base + 8);
      this.mem.write8(base + 8 + member.nameBytes.length, 0);
    }
  }

  /** A widget method by slot, or a task method through the tree. */
  private call = (target: number, slot: number, args: number[]): void => {
    target >>>= 0;
    const task = this.tree.tasks.get(target);
    if (task) {
      this.tree.callMethod(target, slot, args);
      if (task.classId === NAME_ENTRY_HANDLER && slot === 0xf0) this.recordCommit();
      return;
    }
    dispatchWidgetMethod(this.mem, this.widgets, target, slot, args);
  };

  private sequenceHost(kb: NameKeyboardHost): NameSequenceHost {
    return {
      allocatePartnerSelect: () =>
        this.tree.allocate(PARTNER_SELECT_HANDLER, PARTNER_SELECT_SIZE, PARTNER_SELECT_EXTRA),
      cardIndexOf: (id) => partyPositionToRosterSlot(this.mem, id),
      cardRecord: (index) => persistentRosterSlot(index),
      makeCharacterModel: (record, index) => nameEntryCreate(this.mem, record, index, kb),
      requestBanks: () => {},
      banksReady: () => 0, // Both text families were loaded before the screen was made.
      idleShimmer: (object) => nameScreenIdleShimmer(this.mem, object, this.draw),
      releaseService: (a, b) => requestScreenTransition(this.mem, a, b),
      callMethod: this.call,
    };
  }

  private partnerHost(host: NameSessionHost): PartnerHost {
    const mem = this.mem;
    return {
      createRowObject: (scale, kind, x, y) => this.widgets.createTextElement(scale, kind, x, y),
      recordHelper: (bank) => this.banks.source(bank),
      cardIndexOf: (id) => partyPositionToRosterSlot(mem, id),
      cardRecord: (index) => persistentRosterSlot(index),
      cardPresent: (index) => getFollowerRosterSlot(mem, index),
      setWidgetFlag: (fold, flag) => {
        windowFoldStart(mem, fold, flag);
        host.playSound(flag ? 0x40019 : 0x4001a);
      },
      widgetStatus: (fold) => windowFoldTick(mem, fold),
      callMethod: this.call,
      gridDraw: (object) => partnerGridDraw(mem, object, {
        setOrigin: this.draw.setOrigin, setLayer: this.draw.setLayer,
        drawSprite: this.draw.drawSprite, paletteShift: this.draw.paletteShift,
        setScale: this.draw.setScale, setPos: this.draw.setPos,
        packResolve: this.draw.packResolve, frameTick: this.draw.frameTick,
        cardPresent: (index) => getFollowerRosterSlot(mem, index),
      }),
      inputHandler: (object) => partnerSelectMove(mem, object, {
        padA: this.pad.pressed, padB: this.pad.repeated,
        padBit: (code) => code, playSound: host.playSound,
        parentCancel: (parent) => this.call(parent, 0x68, []),
      }),
    };
  }

  private keyboardHost(host: NameSessionHost): NameKeyboardHost {
    const mem = this.mem;
    const draw = this.draw;
    return {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      createWidget: (layer, x, y) => this.widgets.createTextElement(layer, 1, x, y),
      callMethod: this.call,
      copyString: (dst, src, mode) => convertTextEncoding(mem, dst, src, mode),
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
  }

  /** The keyboard just exported a confirmed name to the chosen partner's record. */
  private recordCommit(): void {
    const position = this.mem.read32(NAME_SELECTED_CELL) | 0;
    const rosterSlot = partyPositionToRosterSlot(this.mem, position);
    if (rosterSlot < 0) return;
    this.commits.push({ position, rosterSlot, nameBytes: this.nameBytesAt(rosterSlot) });
  }
}
