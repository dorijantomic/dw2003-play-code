// Frame owner for the translated Digimon lab (pro/stgdglab): the desk where a player switches the
// standing partner, changes a partner's form and loaded techniques, and reads the Digivolve Chart.
// It composes the registered ports into one task tree and supplies the services they call. No
// PlayStation instruction is executed.
//
// The screen's own routines, all translated and each proved against the original by a lane-b oracle:
// boot chain, closing fade and the root's pane methods (native/lab-boot.ts), the root and its action
// machine (lab-root.ts), Select Action (native/select-action.ts, select-action-tick.ts,
// select-labels), Switch Digimon (native/lab-switch.ts), the Digivolve screen (native/lab-detail.ts),
// the form grid (native/lab-grid.ts), the technique chooser (native/lab-chooser.ts), the roster picker
// and the scroll bar (native/lab-roster.ts, lab-capsule.ts), the Digivolve Chart (native/lab-chart.ts),
// the species lookups (native/lab-tables.ts) and the window fold and tween pairs (window-fold.ts).
//
// Service map, each an existing translated provider or a documented platform one:
//   object factory F0x80014504       -> TranslatedTaskTree.allocate (zeroing, registers the class)
//   default methods +0x28..+0x44     -> TranslatedTaskTree defaults
//   text widgets F0x8001AE38 + slots -> ShopWidgetServices / dispatchWidgetMethod (+0x120 -> textFormat)
//   cursor icon F0x8001B364          -> ShopWidgetServices.spawnUiIcon; ticked by tickCursors
//   text glyph tick                  -> textRevealTick + drawTextElement (glyphs painted by the browser)
//   text bank [0x80044F4C](lang+id)  -> ScreenTextBanks (data-only indexed text)
//   pad service [0x8004B7D0+0x3F4/3F8/3FC/408] -> ScreenPad pressed / held / repeated; identity map
//   window fold [0x8008FD98/9C]      -> window-fold.ts (start also plays 0x40019 / 0x4001A)
//   party ctx+0x2718 / +0x2728       -> party-context.ts partyPositionToRosterSlot / getFollowerRosterSlot
//   ctx+0x2734 / 0x2738 / 0x273C     -> effective-stats.ts / form-ledger.ts validateEquippedForm /
//                                       form-ledger-edit.ts setEquippedForms
//   ctx+0x2740 / 0x2748 / 0x274C     -> form-ledger-edit.ts acquiredForms / pause-techniques.ts formEntryCopy /
//                                       form-ledger-edit.ts writeFormEntry; ctx+0x2750 persistentRosterSlot
//   profile getter [0x8005CCA0]      -> pause-status.ts profileRecord
//   screen return ctx+0x270C         -> party-context.ts requestScreenTransition
//   picture service F0x8001F648      -> ShopDrawIntents (recorded, painted by the browser)
//   TIM page upload (root's pages bind) and the display services -> platform: recorded in `displayCalls`
//   scroll bar quad primitive        -> platform GPU: recorded as a flat white `gouraudQuad` draw call
//   fade primitive F0x800830F4       -> platform: recorded as `dim`, painted by the browser
//   heap / arena                     -> platform: ShopWidgetArena
//
// Authority (who commits the result). The session changes only four kinds of save cell: the party map
// word of the position the player switched (ctx+0x70..), the partner's current form (record+0x04), the
// equipped-form triple (record+0x50) and one form-ledger entry (record+0x58+i*0x14: the loaded flag of
// a technique). The walker reads them back ONCE, after the screen has closed, and commits them.
import { MAX_ROSTER_SLOTS } from "../roster.ts";
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import type { PadButton } from "../../systems/input-map.ts";
import {
  PARTY_CONTEXT, PARTY_MAP, ROSTER_EQUIP_OFFSETS_LIST, ROSTER_RECORDS, ROSTER_STRIDE,
  getFollowerRosterSlot, partyPositionToRosterSlot,
  persistentRosterSlot, requestScreenTransition, rosterRecordAddress
} from "../party-context.ts";
import { buildEffectiveStats } from "../effective-stats.ts";
import { itemRecord } from "../item-record.ts";
import { validateEquippedForm } from "../form-ledger.ts";
import { acquiredForms, setEquippedForms, writeFormEntry } from "../form-ledger-edit.ts";
import { installItemTables, type ShopCatalogData } from "./shop-catalog.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { LOGICAL_BUTTON_TABLE, textRevealTick } from "./text-window.ts";
import { createResidentTextServices, loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { reportFadeStart, reportFadeTick, type ReportFadeHost } from "./native/fight-report-fade.ts";
import {
  labRootConstruct, labRootCountAndPackParty, labRootTick, LAB_ROOT_HANDLER, LAB_ROOT_SIZE,
  LAB_ROOT_EXTRA, type LabRootTickHost,
} from "./lab-root.ts";
import {
  LAB_BOOT_HANDLER, LAB_FADE_HANDLER, LAB_FADE_START_SLOT, labBootTick, labEntryCreate, labFadeCreate,
  labRootHidePane, labRootPaneLive, labRootShowPane, labRootStartFade, type LabBootHost,
} from "./native/lab-boot.ts";
import {
  SELECT_ACTION_LIFECYCLE, selectActionConstruct, selectActionDraw,
  selectActionLifecycle,
} from "./native/select-action.ts";
import { selectActionTick, type SelectTickHost } from "./native/select-action-tick.ts";
import { labSelectHide, labSelectLabels, labSelectShow } from "./native/lab-select-labels.ts";
import { LAB_SWITCH_HANDLER, labSwitchCreate, labSwitchLifecycle } from "./native/lab-switch.ts";
import { LAB_DETAIL_HANDLER, labDetailCreate, labDetailLifecycle } from "./native/lab-detail.ts";
import { LAB_CHART_HANDLER, labChartCreate, labChartTick } from "./native/lab-chart.ts";
import { LAB_GRID_HANDLER, labGridCreate, labGridTick } from "./native/lab-grid.ts";
import { LAB_CHOOSER_HANDLER, labChooserCreate, labChooserTick } from "./native/lab-chooser.ts";
import {
  LAB_ROSTER_HANDLER, labRosterCreate, labRosterHide, labRosterLifecycle,
} from "./native/lab-roster.ts";
import {
  LAB_CAPSULE_HANDLER, labCapsuleSetBar, labCapsuleSetCounts, labCapsuleSetTop, labCapsuleSetTrack, labCapsuleTick,
} from "./native/lab-capsule.ts";
import { formEntryCopy } from "./native/pause-techniques.ts";
import { PROFILE_ROWS, PROFILE_TABLE_BASE, profileRecord } from "./native/pause-status.ts";
import type { LabChartHost } from "./native/lab-chart.ts";
import type { LabDetailHost } from "./native/lab-detail.ts";
import type { LabGridHost } from "./native/lab-grid.ts";
import type { LabChooserHost } from "./native/lab-chooser.ts";
import type { LabSwitchHost } from "./native/lab-switch.ts";
import type { LabRosterHost } from "./native/lab-roster.ts";
import type { LabSelectLabelsHost } from "./native/lab-select-labels.ts";

export const LAB_TABLES_BASE = 0x8008f470;
export const LAB_LANGUAGE_CELL = 0x8005cca8;
export const LAB_TEXT_BANKS = [0x39, 0x4e, 0x47, 0xa2, 0x9b] as const;
/** The save context cell the root reads the saved field id from (ctx+0x34). */
export const LAB_SAVED_SELECTOR_CELL = PARTY_CONTEXT + 0x34;
export const LAB_PARTY_SLOTS = 3;
export const LAB_ROSTER_SLOTS = MAX_ROSTER_SLOTS;
export const LAB_LEDGER_ENTRIES = 0x2c;
export const LAB_LEDGER_STRIDE = 0x14;
/** The six equip halfwords of a roster record, in the original's order. */
const RECORD_EQUIPMENT = ROSTER_EQUIP_OFFSETS_LIST;
const RECORD_LEDGER = 0x58;
const RECORD_EQUIPPED = 0x50;
const RECORD_CURRENT_FORM = 0x04;
const SCRATCH_BUFFERS = 5;
const SCRATCH_BYTES = 0x100;
/** The three picker rows of the Select Action choice table 0x8008F4B8: Switch, Digivolve, Chart. */
const CHOICE_CREATE = [labSwitchCreate, labDetailCreate, labChartCreate] as const;

/**
 * One resident table range the lab reads (technique records, signature sets). The profile
 * table is not one of them: it is the one shared cut, loaded as `profiles` below.
 */
export interface LabResidentRange { role: string; base: number; offset: number; size: number }

export interface LabResources {
  /** The overlay's data tail from 0x8008F470 (routine slots zeroed). */
  tables: Uint8Array;
  /** The lab's own resident ranges, concatenated as `ranges` describes. */
  resident: Uint8Array;
  ranges: readonly LabResidentRange[];
  /**
   * The Digimon profile records from 0x8003EF5C: the ONE cut every screen showing a
   * Digimon loads (assets/data/digimon_profiles.bin). All PROFILE_ROWS of them, because
   * the lab reads every row's own id (profileRowFormId), not just the getter's 52.
   */
  profiles: Uint8Array;
  textButtons: Uint8Array;
  font: Uint8Array;
  /**
   * The resident cursor glyph table (0x8004DCE0) and its strings (0x8005CCD0), which every
   * translated screen with a selection cursor loads through loadResidentResources. Optional:
   * the shared resident load supplies the decoded table by default, so a caller need not
   * forward it. Without it the cursor child builds a null string and draws nothing.
   */
  cursorGlyphs?: CursorGlyphTable;
  /** Text banks by id: language + offset, for the five families the lab asks for. */
  banks: ReadonlyMap<number, Uint8Array>;
  catalog: ShopCatalogData;
  itemRecords: Uint8Array;
  descriptors: readonly Uint8Array[];
}

/** One ledger entry in the form the save stores it. */
export interface LabLedgerEntry { value: number; formLevel: number; present: number; dvexp: number; techniques: readonly number[] }

export interface LabMember {
  /** The roster slot 0..7 (the starter species' slot). */
  slot: number;
  nameBytes: readonly number[];
  exp: number;
  level: number;
  tp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  core: readonly number[];
  elements: readonly number[];
  equipment?: { head?: number; body?: number; right?: number; left?: number; acc0?: number; acc1?: number };
  /** The save's current form (a profile value0 id; 0 = the starter's own form). */
  currentForm: number;
  /** The three equipped forms (profile value0 ids; 0xFFFF = empty). */
  equipped: readonly number[];
  /** The 44 ledger entries (null = an empty entry). */
  ledger: ReadonlyArray<LabLedgerEntry | null>;
}

export interface LabSeed {
  language: number;
  /** The roster slot standing at each party position (-1 = empty). */
  party: readonly number[];
  members: readonly LabMember[];
  /** The field the player came from (ctx+0x34); the closing screen hands it back. */
  returnSelector: number;
}

export interface LabHost {
  playSound(id: number): void;
  stopSound?(id: number, channel: number): void;
}

export interface LabDim { layer: number; bucket: number; level: number }
export interface LabDisplayCall { call: string; args: number[] }

/** One roster record as the screen left it: the cells the lab may have changed. */
export interface LabRecord {
  currentForm: number;
  equipped: number[];
  ledger: Array<{ value: number; formLevel: number; present: number; dvexp: number; techniques: number[] } | null>;
}

export class LabSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  /** The ids this screen asked the shared queue for. */
  get sounds(): number[] { return this.audio.sounds; }
  readonly displayCalls: LabDisplayCall[] = [];
  readonly loadedBanks: number[] = [];
  readonly language: number;
  /** The boot task: the tree's root. The lab root is its child. */
  readonly bootTask: number;
  private root = 0;
  private dim: LabDim | null = null;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly seed: LabSeed;
  private readonly playHost: LabHost;
  private readonly revealHost: Parameters<typeof textRevealTick>[1];
  private readonly methods = new Map<number, Map<number, (object: number, args: number[]) => number>>();
  private readonly scratchBase: number;
  private frame = 0;
  private channel = 0;

  constructor(seed: LabSeed, resources: LabResources, host: LabHost) {
    const language = seed.language;
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid lab language");
    if (seed.party.length !== LAB_PARTY_SLOTS) throw new Error("Invalid lab party");
    for (const member of seed.members) {
      if (!Number.isInteger(member.slot) || member.slot < 0 || member.slot >= LAB_ROSTER_SLOTS) throw new Error("Invalid lab roster slot");
      if (member.ledger.length !== LAB_LEDGER_ENTRIES || member.equipped.length !== 3) throw new Error("Invalid lab roster record");
    }
    this.language = language;
    this.seed = seed;
    this.playHost = host;
    const mem = this.mem;

    // Data-only installation.
    if (resources.textButtons.length !== 20) throw new Error("Invalid lab wait-button table");
    if (resources.profiles.length !== PROFILE_ROWS * 0x58) throw new Error("Invalid Digimon profile table");
    loadResidentResources(mem, { font: resources.font,
      ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
      { base: LAB_TABLES_BASE, bytes: resources.tables },
      { base: PROFILE_TABLE_BASE, bytes: resources.profiles },
      ...resources.ranges.map((range) => ({
        base: range.base, bytes: resources.resident.subarray(range.offset, range.offset + range.size),
      })),
      { base: LOGICAL_BUTTON_TABLE, bytes: resources.textButtons },
    ] });
    installItemTables(mem, resources.catalog, resources.itemRecords, resources.descriptors);
    this.banks = new ScreenTextBanks(mem, language, LAB_TEXT_BANKS, resources.banks, "lab");
    this.widgets = new ShopWidgetServices(mem, this.banks as never);
    mem.write32(LAB_LANGUAGE_CELL, language);
    this.seedSave(seed);
    this.scratchBase = this.widgets.arena.alloc(SCRATCH_BYTES * SCRATCH_BUFFERS, 4);

    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Lab", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed(),
      stringById: (bank, id) => this.banks.stringById(mem, bank, id),
    }).revealHost;

    const alloc = (handler: number, size: number, extra: number): number => this.tree.allocate(handler, size, extra);
    const classes = new Map<number, TranslatedTaskClass>();
    const bootHost = this.bootHost();
    const labHost = this.labHost();
    const fadeHost = this.fadeHost();
    classes.set(LAB_BOOT_HANDLER, {
      name: "lab boot", childSlots: [0], terminalTick: true,
      tick: (task, children) => labBootTick(mem, task, children, bootHost),
    });
    classes.set(LAB_ROOT_HANDLER, {
      name: "lab root", childSlots: [0, 4, 8], terminalTick: true,
      tick: (root, children) => labRootTick(mem, root, children, this.rootHost(labHost)),
    });
    classes.set(LAB_FADE_HANDLER, {
      name: "lab fade", childSlots: [], terminalTick: true,
      tick: (panel) => reportFadeTick(mem, panel, fadeHost),
    });
    classes.set(SELECT_ACTION_LIFECYCLE, {
      name: "lab select action", childSlots: [],
      tick: (pane, children) => selectActionLifecycle(mem, pane, children, {
        selectTick: (o, a) => selectActionTick(mem, o, a, this.selectTickHost(labHost)),
        selectDraw: (o) => selectActionDraw(mem, o, labHost),
        buildLists: (o, a) => labSelectLabels(mem, o, a, labHost),
        callMethod: (t, s, a) => { labHost.callMethod(t, s, a); },
        foldStatus: (t) => labHost.foldTick(t),
      }),
    });
    classes.set(LAB_SWITCH_HANDLER, {
      name: "lab switch", childSlots: [0x34],
      tick: (screen, children) => labSwitchLifecycle(mem, screen, children, labHost),
    });
    classes.set(LAB_DETAIL_HANDLER, {
      name: "lab detail", childSlots: [0x54, 0x58, 0x5c],
      tick: (screen, children) => labDetailLifecycle(mem, screen, children, labHost),
    });
    classes.set(LAB_CHART_HANDLER, {
      name: "lab chart", childSlots: [],
      tick: (chart, children) => labChartTick(mem, chart, children, labHost),
    });
    classes.set(LAB_GRID_HANDLER, {
      name: "lab grid", childSlots: [],
      tick: (grid, children) => labGridTick(mem, grid, children, labHost),
    });
    classes.set(LAB_CHOOSER_HANDLER, {
      name: "lab chooser", childSlots: [],
      tick: (chooser, children) => labChooserTick(mem, chooser, children, labHost),
    });
    classes.set(LAB_ROSTER_HANDLER, {
      name: "lab roster", childSlots: [0x6c],
      tick: (roster, children) => labRosterLifecycle(mem, roster, children, labHost),
    });
    classes.set(LAB_CAPSULE_HANDLER, {
      name: "lab scroll bar", childSlots: [], terminalTick: false,
      tick: (bar) => labCapsuleTick(mem, bar, labHost),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.registerMethods(labHost);
    this.bootTask = labEntryCreate({ alloc });
  }

  // ── seeding ────────────────────────────────────────────────────────────────

  private seedSave(seed: LabSeed): void {
    const mem = this.mem;
    for (let i = 0; i < LAB_PARTY_SLOTS; i++) {
      const slot = seed.party[i]!;
      mem.write32(PARTY_MAP + i * 4, slot >= 0 ? slot >>> 0 : 0xffffffff);
    }
    mem.write32(LAB_SAVED_SELECTOR_CELL, seed.returnSelector >>> 0);
    for (const member of seed.members) {
      const record = rosterRecordAddress(member.slot);
      mem.write32(record, (member.slot + 3) >>> 0);
      mem.write32(record + RECORD_CURRENT_FORM, member.currentForm >>> 0);
      member.nameBytes.slice(0, 23).forEach((byte, i) => mem.write8(record + 0x08 + i, byte & 0xff));
      mem.write8(record + 0x08 + Math.min(23, member.nameBytes.length), 0);
      mem.write32(record + 0x20, member.exp >>> 0);
      mem.write16(record + 0x24, member.level & 0xffff);
      mem.write16(record + 0x26, member.tp & 0xffff);
      mem.write16(record + 0x28, member.hp & 0xffff);
      mem.write16(record + 0x2a, member.maxHp & 0xffff);
      mem.write16(record + 0x2c, member.mp & 0xffff);
      mem.write16(record + 0x2e, member.maxMp & 0xffff);
      member.core.forEach((value, i) => mem.write16(record + 0x30 + i * 2, value & 0xffff));
      member.elements.forEach((value, i) => mem.write16(record + 0x3c + i * 2, value & 0xffff));
      const worn = member.equipment ?? {};
      [worn.head, worn.body, worn.right, worn.left, worn.acc0, worn.acc1].forEach((id, i) => {
        mem.write16(record + RECORD_EQUIPMENT[i]!, Number.isInteger(id) && id! > 0 && id! <= 0xffff ? id! : 0);
      });
      member.equipped.forEach((value, i) => mem.write16(record + RECORD_EQUIPPED + i * 2, value & 0xffff));
      member.ledger.forEach((entry, i) => {
        const at = record + RECORD_LEDGER + i * LAB_LEDGER_STRIDE;
        for (let o = 0; o < LAB_LEDGER_STRIDE; o += 4) mem.write32(at + o, 0);
        if (!entry) return;
        mem.write16(at, entry.value & 0xffff);
        mem.write8(at + 2, entry.formLevel & 0xff);
        mem.write8(at + 3, entry.present & 0xff);
        mem.write32(at + 4, entry.dvexp >>> 0);
        entry.techniques.forEach((t, j) => mem.write16(at + 8 + j * 2, t & 0xffff));
      });
    }
  }

  // ── platform services ─────────────────────────────────────────────────────

  private playSound(id: number): number {
    this.audio.play(id);
    this.playHost.playSound(id);
    this.channel = (this.channel + 1) & 0x7fff;
    return this.channel;
  }

  private note(call: string, ...args: number[]): void { this.displayCalls.push({ call, args }); }

  private bootHost(): LabBootHost {
    return {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      displayReset: () => this.note("displayReset"),
      displayPacketSize: (bytes) => this.note("displayPacketSize", bytes),
      displayRegion: (w, h, a, b) => this.note("displayRegion", w, h, a, b),
      displayView: (rect, kind, priority) => {
        this.note("displayView", rect.x, rect.y, rect.w, rect.h, kind, priority);
        return priority;
      },
      viewColour: (_view, r, g, b) => this.note("viewColour", r, g, b),
      createRoot: () => {
        this.root = labRootConstruct(this.mem, { allocLabRoot: (handler, size, extra) => this.tree.allocate(handler, size, extra) });
        return this.root;
      },
      advance: () => this.tree.callMethod(this.bootTask, 0x38),
    };
  }

  private fadeHost(): ReportFadeHost {
    return {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      callMethod: (target, slot, args) => { this.call(target, slot, args); },
      dimQuad: (fade) => {
        this.dim = {
          layer: this.mem.read32(fade + 0x50) | 0, bucket: this.mem.read32(fade + 0x54) | 0,
          level: Math.max(0, Math.min(255, (this.mem.read32(fade + 0x5c) | 0) >> 8)),
        };
      },
    };
  }

  /** The root's boundary services (see LabRootTickHost). */
  private rootHost(labHost: LabAllHost): LabRootTickHost {
    const mem = this.mem;
    return {
      allocLabRoot: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      advancePhase: (screen) => this.tree.callMethod(screen, 0x38),
      setState: (screen, phase) => this.tree.callMethod(screen, 0x28, [phase]),
      requestTransition: (selector, arg) => requestScreenTransition(mem, selector, arg),
      saveSelector: () => mem.read32(LAB_SAVED_SELECTOR_CELL) | 0,
      spawnSelectAction: (root) => selectActionConstruct(mem, { alloc: (h, s, e) => this.tree.allocate(h, s, e) }, root),
      choiceChild: (root, cursor) => {
        const create = CHOICE_CREATE[cursor];
        if (!create) throw new Error(`Lab: no Select Action choice ${cursor}`);
        return create(mem, labHost, root);
      },
      installStandardContext: () => { this.note("installStandardContext"); return 0; },
      contextCall: (slot, a, b) => this.note("contextCall", slot, a, b),
      packResolve: (handle) => this.draw.packResolve(handle),
      requestBank: (id) => { this.loadedBanks.push(id); this.banks.source(id); },
      bankPending: (id) => { this.banks.source(id); return 0; },
      initDrawContext: this.draw.initDrawContext,
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      drawSprite: this.draw.drawSprite,
    };
  }

  private selectTickHost(labHost: LabAllHost): SelectTickHost {
    const mem = this.mem;
    return {
      foldStart: (target, value) => labHost.foldStart(target, value),
      foldStatus: (target) => labHost.foldTick(target),
      padRead: () => this.pad.pressed(),
      padHeld: () => this.pad.repeated(),
      padShift: (_port, button) => button,
      playSound: (id) => { this.playSound(id); },
      partySlot: (position) => partyPositionToRosterSlot(mem, position),
      speciesHelper: (slot, a, b) => labRosterCreate(mem, labHost, slot, a, b),
      widgetFactory: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      widgetFactory2: (layer, kind, x, y) => this.widgets.spawnUiIcon(layer, kind, x, y),
      recordHelper: (id) => this.banks.source(id),
      buildLists: (obj, arg1) => labSelectLabels(mem, obj, arg1, labHost),
      callMethod: (target, slot, args) => { labHost.callMethod(target, slot, args); },
    };
  }

  /** One host serving every translated lab screen (each port names the part it uses). */
  private labHost(): LabAllHost {
    const mem = this.mem;
    const host: LabAllHost = {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      callMethod: (target, slot, args) => this.call(target, slot, args),
      createText: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      createCursor: (layer, order, x, y) => this.widgets.spawnUiIcon(layer, order, x, y),
      foldStart: (fold, open) => {
        windowFoldStart(mem, fold, open);
        this.playSound(open ? 0x40019 : 0x4001a);
      },
      foldTick: (fold) => windowFoldTick(mem, fold),
      padPressed: () => this.pad.pressed(),
      padHeld: () => this.pad.held(),
      padRepeat: () => this.pad.repeated(),
      padBit: (logical) => logical,
      playSound: (id) => { this.playSound(id); },
      textBank: (id) => this.banks.source(id),
      packResolve: this.draw.packResolve,
      frameTick: () => this.frame,
      initDrawContext: this.draw.initDrawContext,
      setOrigin: this.draw.setOrigin,
      setDepth: this.draw.setDepth,
      setLayer: this.draw.setLayer,
      setScale: this.draw.setScale,
      setPos: this.draw.setPos,
      paletteShift: this.draw.paletteShift,
      drawSprite: this.draw.drawSprite,
      partnerSlot: (position) => partyPositionToRosterSlot(mem, position),
      followerSlot: (position) => getFollowerRosterSlot(mem, position),
      rosterSlot: (position) => getFollowerRosterSlot(mem, position),
      effectiveStats: (slot, out) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, out),
      equippedForms: (slot, out) => { validateEquippedForm(mem, slot, out); },
      setEquipped: (slot, input) => setEquippedForms(mem, slot, input),
      acquiredForms: (slot, out) => acquiredForms(mem, slot, out),
      formEntryCopy: (slot, form, out) => { formEntryCopy(mem as never, slot, form, out); },
      writeFormEntry: (slot, form, input) => writeFormEntry(mem, slot, form, input),
      recordPointer: (slot) => persistentRosterSlot(slot),
      profileRecord: (form) => profileRecord(mem as never, form),
      scratch: (index) => (this.scratchBase + index * SCRATCH_BYTES) >>> 0,
      fillQuad: (layer, bucket, x0, y0, x1, y1) => {
        this.draw.setLayer(layer, bucket);
        const white = [255, 255, 255];
        this.draw.calls.push({ method: "gouraudQuad", args: [x0, y0, x1, y0, x0, y1, x1, y1, ...white, ...white, ...white, ...white] });
      },
      createGrid: (slot, row) => labGridCreate(mem, host, slot, row),
      createChooser: (slot, row) => labChooserCreate(mem, host, slot, row),
    };
    return host;
  }

  /** The object methods whose translated bodies return a value or take arguments. */
  private registerMethods(host: LabAllHost): void {
    const mem = this.mem;
    const put = (handler: number, table: Array<[number, (object: number, args: number[]) => number]>): void => {
      this.methods.set(handler, new Map(table));
    };
    put(LAB_ROOT_HANDLER, [
      [0x68, (root) => labRootShowPane(mem, root, host)],
      [0x6c, (root) => labRootHidePane(mem, root, host)],
      [0x70, (root) => labRootPaneLive(mem, root)],
      [0x74, (root) => { labRootCountAndPackParty(mem, root); return 0; }],
      [0x78, (root) => { labRootStartFade(mem, root, { callMethod: host.callMethod, createFade: () => labFadeCreate(mem, host) }); return 0; }],
    ]);
    put(LAB_FADE_HANDLER, [[LAB_FADE_START_SLOT, (panel, args) => {
      reportFadeStart(mem, panel, args[0]!, args[1]!, this.fadeHost());
      return 0;
    }]]);
    put(SELECT_ACTION_LIFECYCLE, [
      [0x114, (pane) => { labSelectShow(mem, pane, host); return 0; }],
      [0x118, (pane) => { labSelectHide(mem, pane, host); return 0; }],
    ]);
    put(LAB_ROSTER_HANDLER, [[0x170, (roster) => { labRosterHide(mem, roster, host); return 0; }]]);
    put(LAB_CAPSULE_HANDLER, [
      [0x8c, (bar, args) => { labCapsuleSetBar(mem, bar, args[0]!, args[1]!); return 0; }],
      [0x90, (bar, args) => { labCapsuleSetTrack(mem, bar, args[0]!, args[1]!); return 0; }],
      [0x94, (bar, args) => { labCapsuleSetCounts(mem, bar, args[0]!, args[1]!); return 0; }],
      [0x98, (bar, args) => { labCapsuleSetTop(mem, bar, args[0]!); return 0; }],
    ]);
  }

  /** One method call: a registered translated method, a base task method, or a text / cursor widget method. */
  private call = (target: number, slot: number, args: number[]): number => {
    target >>>= 0;
    const task = this.tree.tasks.get(target);
    if (!task) {
      if (slot === 0x120) { this.widgets.textFormat(target, args[0]!, args[1]!, args[2]!); return 0; }
      dispatchWidgetMethod(this.mem, this.widgets, target, slot, args);
      return 0;
    }
    const method = this.methods.get(task.classId)?.get(slot);
    if (method) return method(target, args) | 0;
    this.tree.callMethod(target, slot, args);
    return 0;
  };

  // ── frame ─────────────────────────────────────────────────────────────────

  /** One display tick. */
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.dim = null;
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.bootTask);
    this.widgets.tickCursors(this.frame);
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
  }

  /** True once the lab root left the tree (it reached state 3 and ran its exit path). */
  finished(): boolean { return this.root !== 0 && !this.tree.tasks.has(this.root); }

  currentDim(): LabDim | null { return this.dim; }
  fadeLevel(): number { return this.dim?.level ?? 0; }

  /** The screen-return request the closing root wrote (ctx+0x26C8 / +0x26D0). */
  transition(): [number, number] {
    return [this.mem.read32(PARTY_CONTEXT + 0x26c8) | 0, this.mem.read32(PARTY_CONTEXT + 0x26d0) | 0];
  }

  /** The party map as the screen left it (the roster slot at each position, -1 = empty). */
  partyMap(): number[] {
    return Array.from({ length: LAB_PARTY_SLOTS }, (_, i) => {
      const value = this.mem.read32(PARTY_MAP + i * 4) | 0;
      return value >= 0 && value < LAB_ROSTER_SLOTS ? value : -1;
    });
  }

  /** The cells the screen may have changed in one roster record (read once, after it closed). */
  record(slot: number): LabRecord {
    const mem = this.mem;
    const record = rosterRecordAddress(slot);
    return {
      currentForm: mem.read32(record + RECORD_CURRENT_FORM) >>> 0,
      equipped: Array.from({ length: 3 }, (_, i) => mem.read16(record + RECORD_EQUIPPED + i * 2)),
      ledger: Array.from({ length: LAB_LEDGER_ENTRIES }, (_, i) => {
        const at = record + RECORD_LEDGER + i * LAB_LEDGER_STRIDE;
        const value = mem.read16(at);
        if (value === 0) return null;
        return {
          value, formLevel: mem.read8(at + 2), present: mem.read8(at + 3), dvexp: mem.read32(at + 4) >>> 0,
          techniques: Array.from({ length: 6 }, (_, j) => mem.read16(at + 8 + j * 2)),
        };
      }),
    };
  }

  /** The screen's own state words while it is alive, for diagnostics. */
  state(): { root: number; phase: number; choice: number; child: number } | null {
    if (this.root === 0 || !this.tree.tasks.has(this.root)) return null;
    const mem = this.mem;
    const aux = this.tree.tasks.get(this.root)!.children;
    const pane = mem.read32(aux) >>> 0;
    return {
      root: mem.read32(this.root + 0x0c) | 0, phase: mem.read32(this.root + 0x10) | 0,
      choice: pane && this.tree.tasks.has(pane) ? mem.read32(pane + 0x60) | 0 : -1,
      child: mem.read32(aux + 4) >>> 0,
    };
  }

  /** The class name of the child screen the root runs, or null (for diagnostics). */
  childScreen(): string | null {
    const aux = this.root !== 0 && this.tree.tasks.has(this.root) ? this.tree.tasks.get(this.root)!.children : 0;
    const child = aux ? this.mem.read32(aux + 4) >>> 0 : 0;
    const task = child ? this.tree.tasks.get(child) : undefined;
    return task ? this.tree.classes.get(task.classId)!.name : null;
  }

  /** The class names of every live task below the boot task (for diagnostics): the screens that are open. */
  taskNames(): string[] {
    return [...this.tree.tasks.values()].map((t) => this.tree.classes.get(t.classId)!.name);
  }

  /** The Select Action pane's phase word (+0x10), or -1 when the pane is not in the tree. */
  panePhase(): number {
    const aux = this.root !== 0 && this.tree.tasks.has(this.root) ? this.tree.tasks.get(this.root)!.children : 0;
    const pane = aux ? this.mem.read32(aux) >>> 0 : 0;
    return pane && this.tree.tasks.has(pane) ? this.mem.read32(pane + 0x10) | 0 : -1;
  }

  /** The child screen's phase word (+0x10), or -1 when no child screen runs. */
  childPhase(): number {
    const aux = this.root !== 0 && this.tree.tasks.has(this.root) ? this.tree.tasks.get(this.root)!.children : 0;
    const child = aux ? this.mem.read32(aux + 4) >>> 0 : 0;
    return child && this.tree.tasks.has(child) ? this.mem.read32(child + 0x10) | 0 : -1;
  }

  /** The child screen's lifecycle word (+0x0C), or -1 when no child screen runs. */
  childLifecycle(): number {
    const aux = this.root !== 0 && this.tree.tasks.has(this.root) ? this.tree.tasks.get(this.root)!.children : 0;
    const child = aux ? this.mem.read32(aux + 4) >>> 0 : 0;
    return child && this.tree.tasks.has(child) ? this.mem.read32(child + 0x0c) | 0 : -1;
  }

  /** Dispose of every task (the player left another way). */
  dispose(): void { this.tree.dispose(this.bootTask); }
}

type LabAllHost = LabChartHost & LabDetailHost & LabGridHost & LabChooserHost & LabSwitchHost & LabRosterHost &
  LabSelectLabelsHost & { setDepth(x: number, y: number): void };
