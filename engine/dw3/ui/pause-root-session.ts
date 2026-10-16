// Frame owner for the translated pause screens (pro/ststatus).
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. The screen's own
// routines are the registered ports in engine/dw3/ui/native/ (the pause host, the
// ITEMS root, bag and tick, SORT, MAP, TECHNIQUES, STATUS with EQUIPMENT and
// DIGIVOLVE, CARD FOLDERS and the scroll-bar and fade objects); this file composes
// them into one task tree and supplies the shared services they call: object
// allocation, text and cursor widgets, the party records, pad words, sound, folds
// and the picture-call collector. No instruction is executed.
//
// Data-only inputs: the overlay's data tail (layout, label, table and dispatch data),
// the resident tables the pages read (partner profiles, technique records, signature
// sets, item records, descriptors and directories), the resident font block, and the
// seven text families the host loads.
import { MAX_ROSTER_SLOTS, ROSTER_SLOT_COUNT } from "../roster.ts";
import { NativeMemory } from "../../native/memory.ts";
import type { PadButton } from "../../systems/input-map.ts";
import {
  PARTY_MAP, RECORD_FIELDS, ROSTER_RECORDS, ROSTER_STRIDE, ROSTER_EQUIP_ENTRIES,
  partyPositionToRosterSlot, persistentRosterSlot,
  requestScreenTransition, SCREEN_TRANSITION_A, SCREEN_TRANSITION_B, rosterRecordAddress
} from "../party-context.ts";
import { buildEffectiveStats } from "../effective-stats.ts";
import { itemIconClip, itemRecord } from "../item-record.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { installItemTables, type ShopCatalogData } from "./shop-catalog.ts";
import { validateEquippedForm } from "../form-ledger.ts";
import { seedRosterForms, type RosterFormState } from "./roster-form-state.ts";
import { partyCardFillItems, type PartyCardFillHost } from "./party-card-fill.ts";
import { pauseBackdropDraw, pauseHostFactory, pauseHostTick, type PauseHost } from "./native/pause-host.ts";
import {
  PAUSE_ITEMS_ROOT_EXTRA, PAUSE_ITEMS_ROOT_HANDLER, PAUSE_ITEMS_ROOT_SIZE, pauseItemsDraw,
  pauseItemsRootFactory, pauseItemsRootTick,
} from "./native/pause-items.ts";
import { pauseItemsTick } from "./native/pause-items-tick.ts";
import {
  BAG_HANDLER, itemsApplyEffect, itemsDescPanelFold, itemsWindowReady,
  pauseBagFactory, pauseBagRoot, type BagHost,
} from "./native/pause-bag.ts";
import { inventoryCopy } from "./native/pause-inventory.ts";
import { SORT_HANDLER, sortFactory, sortRoot } from "./native/pause-sort.ts";
import { MAP_HANDLER, mapFactory, mapRoot } from "./native/pause-map.ts";
import { TECH_HANDLER, techniquesFactory, techniquesRoot } from "./native/pause-techniques.ts";
import {
  PROFILE_TABLE_BASE, PROFILE_ROWS, STATUS_HANDLER, statusEquipPreview, statusFactory, statusRoot,
} from "./native/pause-status.ts";
import { EQUIP_HANDLER, SCROLL_BAR_HANDLER, equipFactory, equipRoot,
  scrollBarFactory, scrollBarList, scrollBarPlace, scrollBarRun, scrollBarStep, scrollBarTick } from "./native/pause-equipment.ts";
import {
  DIGIVOLVE_HANDLER, digivolveFactory, digivolveRoot,
} from "./native/pause-digivolve.ts";
import {
  CARD_FOLDERS_HANDLER, DIM_QUAD_HANDLER, cardFoldersFactory,
  cardFoldersRoot, dimQuadFactory, dimQuadStart, dimQuadTick,
} from "./native/pause-card-folders.ts";
import { pauseGridWord, pauseSeenScan, pauseStageByte } from "./native/pause-misc.ts";
import { pauseListBuild, pauseListTick } from "./native/pause-list.ts";
import { buildTextBankImage } from "./native/game-text.ts";
import { QUESTS_HANDLER, questsFactory, questsRoot } from "./native/pause-quests.ts"; // EXTRA: the QUESTS page
import { mapServerFromStage } from "./native/map-server.ts";
import type { PauseServices } from "./native/pause-services.ts";

/** The overlay's data tail, loaded where the original placed it. */
export const PAUSE_TABLES_BASE = 0x8009a784;
export const PAUSE_TABLES_SIZE = 0x152c;
/** The text families the pause host loads, in its own order, then the map's two. */
/** The map page adds its zone names: 8..14 on the first server, 1..7 on the second. */
export const PAUSE_TEXT_BANK_OFFSETS = [0xb0, 0x6a, 0x63, 0x4e, 0x47, 0xa2, 0x9b, 0x08, 0x01] as const;
export const PAUSE_LANGUAGE_CELL = 0x8005cca8;
/** The two cells the resident pause home fills before the host spawns its page. */
export const PAUSE_ROW_CELL = 0x8005ccf0;
export const PAUSE_VARIANT_CELL = 0x8005ccf4;
const PAUSE_HOST_HANDLER = 0x80099894;
const PAUSE_HOST_SIZE = 0x78;
const PAUSE_HOST_EXTRA = 8;

const SAVE_CONTEXT = 0x80048d34;
export const PAUSE_MONEY = SAVE_CONTEXT + 0x6c;
export const PAUSE_HELD_COUNTS = SAVE_CONTEXT + 0x7c;
export const PAUSE_WORN_COUNTS = SAVE_CONTEXT + 0x20f;
export const PAUSE_STAGE_CELL = 0x80048d68;
export const PAUSE_ITEM_MAX_ID = 402;
/**
 * Worn-slot halfword offsets (record relative), the order the STATUS sheet reads
 * them. The numbers live once, in `party-context`: the pause EQUIP page edits the
 * SAME six halfwords the merchant edits, so the two must not drift apart.
 */
export const PAUSE_EQUIP_OFFSETS = ROSTER_EQUIP_ENTRIES;

export type PausePage = "items" | "sort" | "map" | "techniques" | "status" | "cardfolders" | "quests";
export type PauseEntry = PausePage | "home";
const PAGE_ROWS: Record<PausePage, { row: number; variant: number }> = {
  items: { row: 0, variant: 0 }, sort: { row: 1, variant: 0 }, map: { row: 2, variant: 0 },
  techniques: { row: 3, variant: 0 }, status: { row: 4, variant: 0 }, cardfolders: { row: 5, variant: 1 },
  quests: { row: 6, variant: 1 }, // EXTRA: placeholder, seedState takes the real row and variant from the home list that opened it
};

export interface PauseResidentRange { role: string; base: number; offset: number; size: number }

export interface PauseResources {
  tables: Uint8Array;
  resident: Uint8Array;
  residentRanges: readonly PauseResidentRange[];
  /**
   * The Digimon profile table: the ONE cut every screen that shows a Digimon loads
   * (assets/data/digimon_profiles.bin, web/resident-data.js loadProfileRecords). All 55
   * records, because the table is 55 records long; the pages' own reader walks the
   * original's 52 (PROFILE_SCAN_ROWS), so no page can see more here than it could there.
   */
  profiles: Uint8Array;
  font: Uint8Array;
  /**
   * The resident cursor glyph table (0x8004DCE0) and its strings (0x8005CCD0). Optional: the
   * shared resident load supplies the decoded table by default, so a caller need not forward
   * it. Without it a page's selection cursor builds a null string and draws nothing.
   */
  cursorGlyphs?: CursorGlyphTable;
  catalog: ShopCatalogData;
  itemRecords: Uint8Array;
  descriptors: readonly Uint8Array[];
  banks: ReadonlyMap<number, Uint8Array>;
  homeData?: Uint8Array;
}

export interface PauseMember {
  rosterSlot: number;
  starterSlot?: number;
  /** The game's own byte encoding, without the terminator. */
  nameBytes?: Uint8Array;
  forms?: RosterFormState;
  level?: number; tp?: number; hp?: number; maxHp?: number; mp?: number; maxMp?: number;
  exp?: number; core?: number[]; elements?: number[];
  equipment?: Partial<Record<(typeof PAUSE_EQUIP_OFFSETS)[number][0], number>>;
}

export interface PauseSeed {
  page: PauseEntry;
  homeOverlay?: boolean;
  homeRow?: number;
  cardFoldersUnlocked?: boolean;
  money: number;
  /** Bag counts by item id (worn items are not in the bag). */
  inventory: ReadonlyArray<{ id: number; qty: number }>;
  /**
   * WORN counts by item id — the original's second count array at
   * `D0x80048D34 + 0x20F`, which the ITEMS page's detail band reads for its
   * "Equip" number (ststatus 0x8008F16C). The walker's stored worn byte, so the
   * figure on screen is that byte and not a count of the wearer record.
   */
  worn?: ReadonlyArray<{ id: number; qty: number }>;
  /** One entry per party position; null is an empty pedestal. */
  party: ReadonlyArray<PauseMember | null>;
  /** The stage the map page reads; 0 when the field has not set one. */
  stage?: number;
  /** Whether a map cell has been seen (the page's flag reader). */
  mapSeen?: (flagId: number) => boolean;
  /**
   * EXTRA (not on the disc): one more row at the end of the pause home list, with this label (letters, digits and spaces).
   * Choosing it opens the QUESTS page (`page: "quests"`), the builder the disc's own table names for that slot.
   */
  extraRow?: { label: string };
  /** EXTRA (not on the disc): what the QUESTS page lists. Each entry's `lines` are the three description lines shown under the list. */
  quests?: {
    prompt: string; readPrompt: string;
    /** `pages`: the quest's full text, three lines to a page. */
    entries: ReadonlyArray<{ title: string; lines: readonly [string, string, string]; pages: ReadonlyArray<readonly [string, string, string]> }>;
  };
}

export interface PauseQuad {
  x: number; y: number; w: number; h: number; r: number; g: number; b: number; semiTransparent: boolean;
}

export interface PauseSessionHost {
  playSound(id: number): void;
}

export interface PauseSnapshot {
  money: number;
  inventory: Array<{ id: number; qty: number }>;
  /** The party map's three roster slots after any formation change (-1 = empty). */
  partyMap: number[];
  records: Array<{
    rosterSlot: number; formValue: number; level: number; tp: number; hp: number; maxHp: number;
    mp: number; maxMp: number; exp: number; core: number[]; elements: number[];
    equipment: Record<string, number>;
  }>;
}

export class PauseRootSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  readonly root: number;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly language: number;
  private readonly scratchBlock: number;
  private readonly primPool: number;
  private readonly primBucket: number;
  private primCursorAt = 0;
  /** The flat quads the scroll bar and the fade submitted this frame. */
  readonly quads: PauseQuad[] = [];
  private readonly seed: PauseSeed;
  private rng = 0x2545f491;
  private frame = 0;
  private sawPage = false;
  private closed = false;
  private homeResultValue: { kind: "page"; page: PausePage; row: number } | { kind: "exit" } | null = null;
  private homeBackdrop = 0;

  constructor(language: number, seed: PauseSeed, resources: PauseResources, host: PauseSessionHost) {
    if (seed.page !== "home" && !PAGE_ROWS[seed.page]) throw new Error(`Unknown pause page ${String(seed.page)}`);
    if (resources.tables.length !== PAUSE_TABLES_SIZE) throw new Error("Invalid pause data tail");
    if (seed.party.length > 3) throw new Error("The pause pages show at most three partners");
    this.language = language;
    this.seed = seed;
    const mem = this.mem;
    mem.load(resources.tables, PAUSE_TABLES_BASE);
    if (seed.page === "home") {
      if (!resources.homeData || resources.homeData.length !== 0xc8) throw new Error("Missing pause home data");
      mem.load(resources.homeData, 0x8003ee7c);
    }
    if (resources.profiles.length !== PROFILE_ROWS * 0x58) throw new Error("Invalid Digimon profile table");
    mem.load(resources.profiles, PROFILE_TABLE_BASE);
    // The resident ranges and font through the one shared load; it also installs the resident
    // cursor glyph table (from resources.cursorGlyphs, else the shared default the browser sets
    // once) so every page's selection cursor can draw its arrow.
    loadResidentResources(mem, {
      font: resources.font,
      ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}),
      ranges: resources.residentRanges.map((range) => ({
        base: range.base, bytes: resources.resident.subarray(range.offset, range.offset + range.size),
      })),
    });
    installItemTables(mem, resources.catalog, resources.itemRecords, resources.descriptors);
    this.banks = new ScreenTextBanks(mem, language, PAUSE_TEXT_BANK_OFFSETS, resources.banks, "pause");
    this.widgets = new ShopWidgetServices(mem, this.banks as never);
    this.scratchBlock = this.widgets.arena.alloc(0x200, 8);
    this.primPool = this.widgets.arena.alloc(0x400, 8);
    this.primBucket = this.widgets.arena.alloc(8, 4);
    this.primCursorAt = this.primPool;
    mem.write32(PAUSE_LANGUAGE_CELL, language);
    this.seedState(seed);

    const classes = new Map<number, TranslatedTaskClass>();
    const services = this.services(host);
    const cards = this.cards();
    const itemsTickHost = this.itemsTickHost(services);
    const bagHost = this.bagHost(services, cards);
    const itemsHost = {
      allocateRoot: () => this.tree.allocate(PAUSE_ITEMS_ROOT_HANDLER, PAUSE_ITEMS_ROOT_SIZE, PAUSE_ITEMS_ROOT_EXTRA),
      cardIndexOf: (i: number) => partyPositionToRosterSlot(mem, i),
      createTextElement: this.widgets.createTextElement,
      createFrameElement: this.widgets.spawnUiIcon,
      callMethod: this.call,
      itemsTick: (obj: number, ui: number) => pauseItemsTick(mem, obj, ui, itemsTickHost),
      itemsDraw: (obj: number) => pauseItemsDraw(mem, obj, this.itemsDrawHost()),
    };
    const sortHost = { ...services, alloc: this.allocTask, cards, scratch: () => this.scratchBlock };
    const techHost = { ...services, alloc: this.allocTask, cards, scratch: () => this.scratchBlock };
    const mapHost = {
      ...services, alloc: this.allocTask,
      menuVariant: () => mapServerFromStage(mem),
      mapLevel: () => pauseStageByte(mem),
      mapFillZones: (dest: number) => pauseSeenScan(mem, dest, (id) => (seed.mapSeen?.(id) ? 1 : 0)),
      requestBank: () => {},
      bankPending: () => 0, // Every text family was loaded before the screen was made.
      markerList: (variant: number, tier: number) => pauseGridWord(mem, variant, tier),
    };
    const statusHost = {
      ...services, alloc: this.allocTask, cards, scratch: () => this.scratchBlock,
      copyForms: (slot: number, out: number) => services.copyForms(slot, out),
      digivolveFactory: (obj: number) => digivolveFactory(mem, obj, digiHost),
      equipFactory: (obj: number) => equipFactory(mem, obj, equipHost),
    };
    const digiHost = {
      ...services, alloc: this.allocTask, scratch: () => this.scratchBlock,
      copyStats: cards.copyStats,
    };
    const equipHost = {
      ...services, alloc: this.allocTask, cards,
      scrollBarFactory: () => scrollBarFactory(mem, { alloc: this.allocTask }),
    };
    const foldersHost = {
      ...services, alloc: this.allocTask, cards, scratch: () => this.scratchBlock,
      dimQuadFactory: () => dimQuadFactory(mem, { alloc: this.allocTask }),
      changeScreen: (id: number, arg: number) => requestScreenTransition(mem, id, arg),
    };
    const barHost = { ...services, otBucket: this.otBucket, cursor: this.primCursor, setCursor: this.setPrimCursor };
    // EXTRA: the QUESTS page's strings, one bank: titles, three description lines each, the prompt and the "none" strings.
    const quests = seed.quests;
    const questStrings = quests ? [
      ...quests.entries.map((e) => e.title),
      ...quests.entries.flatMap((e) => [...e.lines]),
      quests.prompt, "None right now", "Talk to people and explore. New quests unlock as you play.", quests.readPrompt,
      ...quests.entries.flatMap((e) => e.pages.flatMap((p) => [...p])),
    ] : [];
    const detailStart: number[] = [];                       // where each quest's full text starts in that bank
    if (quests) { let at = quests.entries.length * 4 + 4; for (const e of quests.entries) { detailStart.push(at); at += e.pages.length * 3; } }
    const questsBank = quests ? this.loadBank(questStrings, 0x7f01) : 0;
    const questsHost = {
      ...services, alloc: this.allocTask, bank: () => questsBank, count: () => quests?.entries.length ?? 0,
      detail: (i: number) => ({ start: detailStart[i] ?? 0, pages: quests?.entries[i]?.pages.length ?? 0 }),
    };
    const pauseHost = this.pauseHost(services, {
      itemsFactory: (obj) => pauseItemsRootFactory(mem, obj, itemsHost),
      sortFactory: (obj) => sortFactory(mem, obj, sortHost),
      mapFactory: (obj) => mapFactory(mem, obj, mapHost),
      techniquesFactory: (obj) => techniquesFactory(mem, obj, techHost),
      statusFactory: (obj) => statusFactory(mem, obj, statusHost),
      cardFoldersFactory: (obj) => cardFoldersFactory(mem, obj, foldersHost),
      questsFactory: (obj) => questsFactory(mem, obj, questsHost),
    });
    const extraBank = seed.page === "home" && seed.extraRow ? this.loadBank([seed.extraRow.label], 0x7f00) : 0;
    const homeHost = {
      extraRow: () => (extraBank ? { bank: extraBank } : null),
      sfx: host.playSound,
      callMethod: (target: number, slot: number, args: number[]) => { this.call(target, slot, args); return 0; },
      textBank: (id: number) => this.banks.source(id),
      packResolve: (id: number) => id >>> 0,
      padPressed: () => this.pad.pressed(),
      padRepeat: () => this.pad.repeated(),
      padBit: (id: number) => id,
      now: () => this.frame,
      sceneId: () => seed.homeOverlay ? 0x1000 : (seed.stage ?? 0),
      changeScene: (id: number) => {
        if (id === 0x1000) this.selectHomePage();
        else this.homeResultValue = { kind: "exit" };
      },
      partySlot: (i: number) => partyPositionToRosterSlot(mem, i),
      slotName: (i: number) => persistentRosterSlot(i),
      slotStats: (i: number) => {
        buildEffectiveStats(mem, { definitionRecord: (k: number) => itemRecord(k) }, i, this.scratchBlock);
        return (index: number) => mem.read16s(this.scratchBlock + index * 2);
      },
      createText: this.widgets.createTextElement,
      createCursor: this.widgets.spawnUiIcon,
      initDrawContext: this.draw.initDrawContext,
      setOrigin: this.draw.setOrigin,
      setLayer: this.draw.setLayer,
      context98: (_value: number) => {},
      paletteShift: this.draw.paletteShift,
      setScale: this.draw.setScale,
      setPivot: this.draw.setPos,
      drawSprite: this.draw.drawSprite,
    };
    const HOME_HANDLER = 0x8001270c;
    classes.set(HOME_HANDLER, {
      name: "pause home", childSlots: [],
      tick: (obj, slots) => pauseListTick(mem, obj, slots, homeHost),
    });

    classes.set(PAUSE_HOST_HANDLER, {
      name: "pause host", childSlots: [0, 4],
      tick: (obj, children) => pauseHostTick(mem, obj, children, pauseHost),
    });
    classes.set(PAUSE_ITEMS_ROOT_HANDLER, {
      name: "pause items", childSlots: [0xd0],
      tick: (obj, ui) => pauseItemsRootTick(mem, obj, ui, itemsHost),
    });
    classes.set(BAG_HANDLER, {
      name: "pause bag", childSlots: [],
      tick: (obj, ui) => pauseBagRoot(mem, obj, ui, bagHost),
    });
    classes.set(QUESTS_HANDLER, {
      name: "pause quests", childSlots: [], tick: (obj, ui) => questsRoot(mem, obj, ui, questsHost),
    });
    classes.set(SORT_HANDLER, {
      name: "pause sort", childSlots: [], tick: (obj, ui) => sortRoot(mem, obj, ui, sortHost),
    });
    classes.set(MAP_HANDLER, {
      name: "pause map", childSlots: [], tick: (obj, ui) => mapRoot(mem, obj, ui, mapHost),
    });
    classes.set(TECH_HANDLER, {
      name: "pause techniques", childSlots: [], tick: (obj, ui) => techniquesRoot(mem, obj, ui, techHost),
    });
    classes.set(STATUS_HANDLER, {
      name: "pause status", childSlots: [0x10c],
      tick: (obj, ui) => statusRoot(mem, obj, ui, statusHost),
      methods: new Map([[0x148, (obj, args) => statusEquipPreview(mem, obj, args[0]!, args[1]!, statusHost)]]),
    });
    classes.set(EQUIP_HANDLER, {
      name: "pause equipment", childSlots: [0x98], tick: (obj, ui) => equipRoot(mem, obj, ui, equipHost),
    });
    classes.set(DIGIVOLVE_HANDLER, {
      name: "pause digivolve", childSlots: [], tick: (obj, ui) => digivolveRoot(mem, obj, ui, digiHost),
    });
    classes.set(CARD_FOLDERS_HANDLER, {
      name: "pause card folders", childSlots: [0x9c],
      tick: (obj, ui) => cardFoldersRoot(mem, obj, ui, foldersHost),
    });
    classes.set(SCROLL_BAR_HANDLER, {
      name: "pause scroll bar", childSlots: [],
      tick: (obj) => scrollBarTick(mem, obj, 0, barHost),
      methods: new Map([
        [0x8c, (obj, args) => scrollBarPlace(mem, obj, args[0]!, args[1]!)],
        [0x90, (obj, args) => scrollBarRun(mem, obj, args[0]!, args[1]!)],
        [0x94, (obj, args) => scrollBarList(mem, obj, args[0]!, args[1]!)],
        [0x98, (obj, args) => scrollBarStep(mem, obj, args[0]!)],
      ]),
    });
    classes.set(DIM_QUAD_HANDLER, {
      name: "pause fade", childSlots: [],
      tick: (obj) => dimQuadTickWith(mem, obj, barHost),
      methods: new Map([[0x64, (obj, args) => dimQuadStart(mem, obj, args[0]!, args[1]!, services)]]),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    if (seed.page === "home") {
      this.root = this.tree.allocate(HOME_HANDLER, 0xac, seed.extraRow ? 0xb4 : 0x84); // 0xb4: room for the cursor's slot, which moves past the seventh row
      pauseListBuild(mem, this.root, 0x1002, seed.homeRow ?? 0);
      if (seed.homeOverlay) {
        this.homeBackdrop = this.widgets.arena.alloc(0x60);
        mem.write32(this.homeBackdrop + 0x50, 0x1000);
      }
    } else this.root = pauseHostFactory(mem, pauseHost);
  }

  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.quads.length = 0;
    this.primCursorAt = this.primPool;
    this.pad.update(buttons, this.frame);
    if (this.transition() || this.closed) return;
    if (this.homeBackdrop) pauseBackdropDraw(this.mem, this.homeBackdrop, {
      initDrawContext: this.draw.initDrawContext, setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin, drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
    } as PauseHost);
    this.tree.tick(this.root);
    this.widgets.tickCursors(this.frame);
    if (this.seed.page === "home") {
      // State 3 is the list HANDING OVER, and it is the only way into that
      // state: F0x8001270c's step 6 calls its own +0x28 with 3, which the
      // confirm arm reaches only when the list is in the pause scene (the list
      // wrote +0x14 = 1), and the back arm reaches only from the field's scene
      // (where +0x14 = 1 means "leave"). Who is watching decides what handing
      // over means: the pause scene reads the remembered row out of D0x8005CCF0
      // and opens that page, the field's scene just sees the list go.
      //
      // +0x14 CANNOT be re-read here. +0x28 is setState0 (engine/dw3/ui/
      // task-object.ts): setting the main step zeroes every deeper level, and
      // +0x14 is one of them, so the value the list wrote is already gone by
      // the time the state reads 3. Reading it anyway made CONFIRM on the list
      // that came back from a page look like a Back: the pause closed instead
      // of opening the row (proved from the field by
      // tools/verify_pause_walk.mjs, pinned by
      // tests/pause-button-table.test.js "the list that comes back").
      if (!this.homeResultValue && this.tree.tasks.has(this.root) && this.mem.read32(this.root + 0xc) === 3) {
        if (this.seed.homeOverlay) this.selectHomePage();
        else this.homeResultValue = { kind: "exit" };
      }
      return;
    }
    const page = this.pageObject();
    if (page) this.sawPage = true;
    else if (this.sawPage) this.closed = true;
  }

  /** The page left the host's child slot (the resident home's close signal), or a launch was asked for. */
  finished(): boolean { return this.homeResultValue !== null || this.closed || this.transition() !== null || !this.tree.tasks.has(this.root); }

  homeResult(): typeof this.homeResultValue { return this.homeResultValue; }

  /** Load a text bank of these strings into the session and register it as a text source (the widgets accept only registered sources). */
  private loadBank(strings: readonly string[], sourceId: number): number {
    const image = buildTextBankImage(strings);
    const at = this.widgets.arena.alloc(image.length + 4, 4);
    this.mem.load(image, at);
    this.banks.sources.set(sourceId, at);
    return at;
  }

  private selectHomePage(): void {
    const row = this.mem.read32(PAUSE_ROW_CELL) | 0;
    if (this.seed.extraRow && row === (this.mem.read32(this.root + 0x5c) | 0) - 1) {
      this.homeResultValue = { kind: "page", page: "quests", row }; // EXTRA: the row after the disc's own
      return;
    }
    const page = (["items", "sort", "map", "techniques", "status", "cardfolders"] as PausePage[])[row];
    if (!page) throw new Error(`Invalid pause home row ${row}`);
    this.homeResultValue = { kind: "page", page, row };
  }

  /** A page asked the resident launcher for another screen (CARD FOLDERS hands off this way). */
  transition(): { id: number; arg: number } | null {
    const id = this.mem.read32(SCREEN_TRANSITION_A) | 0;
    return id ? { id: id >>> 0, arg: this.mem.read32(SCREEN_TRANSITION_B) >>> 0 } : null;
  }

  /** The page object the host spawned, or 0 before its first tick and after it has closed. */
  pageObject(): number {
    if (!this.tree.tasks.has(this.root)) return 0;
    const children = this.mem.read32(this.root + 0x24) >>> 0;
    return this.mem.read32(children + 4) >>> 0;
  }

  /** Everything the pages may have written that the walker models, read back once on close. */
  snapshot(): PauseSnapshot {
    const mem = this.mem;
    const inventory: Array<{ id: number; qty: number }> = [];
    for (let id = 1; id <= PAUSE_ITEM_MAX_ID; id++) {
      const qty = mem.read8(PAUSE_HELD_COUNTS + id);
      if (qty > 0) inventory.push({ id, qty });
    }
    const partyMap = [0, 1, 2].map((i) => mem.read32(PARTY_MAP + i * 4) | 0);
    const records = [];
    for (let rosterSlot = 0; rosterSlot < Math.max(9, ROSTER_SLOT_COUNT); rosterSlot++) {
      const base = rosterRecordAddress(rosterSlot);
      const equipment: Record<string, number> = {};
      for (const [name, off] of PAUSE_EQUIP_OFFSETS) equipment[name] = mem.read16(base + off);
      records.push({
        rosterSlot, formValue: mem.read32(base + 4) >>> 0,
        level: mem.read16(base + RECORD_FIELDS.level), tp: mem.read16(base + RECORD_FIELDS.tp),
        hp: mem.read16(base + RECORD_FIELDS.hp), maxHp: mem.read16(base + RECORD_FIELDS.maxHp),
        mp: mem.read16(base + RECORD_FIELDS.mp), maxMp: mem.read16(base + RECORD_FIELDS.maxMp),
        exp: mem.read32(base + RECORD_FIELDS.exp) >>> 0,
        core: Array.from({ length: 6 }, (_, i) => mem.read16(base + RECORD_FIELDS.core + i * 2)),
        elements: Array.from({ length: 7 }, (_, i) => mem.read16(base + RECORD_FIELDS.elements + i * 2)),
        equipment,
      });
    }
    return { money: mem.read32(PAUSE_MONEY) >>> 0, inventory, partyMap, records };
  }

  private seedState(seed: PauseSeed): void {
    const mem = this.mem;
    const page = seed.page === "home" ? null
      : seed.page === "quests" ? { row: seed.homeRow ?? 6, variant: seed.cardFoldersUnlocked ? 1 : 0 } // EXTRA: the slot after the disc's rows, in the table's own variant
      : PAGE_ROWS[seed.page];
    mem.write32(PAUSE_ROW_CELL, page?.row ?? seed.homeRow ?? 0);
    mem.write32(PAUSE_VARIANT_CELL, page?.variant ?? 0);
    mem.write32(0x80048d34 + 0x34, seed.stage ?? 0);
    mem.write8(0x80048f42, seed.cardFoldersUnlocked ? 1 : 0);
    mem.write32(PAUSE_MONEY, Math.max(0, Math.min(0x98967f, Math.trunc(seed.money) || 0)));
    mem.write32(PAUSE_STAGE_CELL, seed.stage ?? 0);
    for (const slot of seed.inventory) {
      if (Number.isInteger(slot.id) && slot.id > 0 && slot.id <= PAUSE_ITEM_MAX_ID) {
        mem.write8(PAUSE_HELD_COUNTS + slot.id, Math.max(0, Math.min(99, Math.trunc(slot.qty) || 0)));
      }
    }
    for (const slot of seed.worn ?? []) {
      if (Number.isInteger(slot.id) && slot.id > 0 && slot.id <= PAUSE_ITEM_MAX_ID) {
        mem.write8(PAUSE_WORN_COUNTS + slot.id, Math.max(0, Math.min(255, Math.trunc(slot.qty) || 0)));
      }
    }
    const seen = new Set<number>();
    for (let position = 0; position < 3; position++) {
      const member = seed.party[position];
      if (!member) { mem.write32(PARTY_MAP + position * 4, 0xffffffff); continue; }
      // The party map (ctx+0x70) holds each member's ROSTER SLOT — the number the
      // original's F0x80016DC0 writes there and every reader resolves the member by:
      // the stats producer at ctx+0x2734, the picture row (F0x80016D94 ->
      // pro/ststatus.s:10074-10077), the Lab tubes. The adapter names it `starterSlot`
      // (web/status-translated.js: the member's own slot by char id);
      // `rosterSlot` is the page's PEDESTAL key. Seating the pedestal here made the
      // picture row the pedestal index, so a card drew whichever starter owned that
      // row and a SORT swap permuted those wrong sprites. Seat the identity.
      const slot = member.starterSlot ?? member.rosterSlot;
      if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ROSTER_SLOTS || seen.has(slot)) throw new Error("Invalid pause roster slot");
      seen.add(slot);
      mem.write32(PARTY_MAP + position * 4, slot);
      const base = rosterRecordAddress(slot);
      mem.write32(base, slot + 3);
      if (member.forms) seedRosterForms(mem, base, member.forms);
      if (member.exp !== undefined) mem.write32(base + RECORD_FIELDS.exp, member.exp >>> 0);
      const put = (off: number, v: number | undefined) => { if (v !== undefined) mem.write16(base + off, v & 0xffff); };
      put(RECORD_FIELDS.level, member.level); put(RECORD_FIELDS.tp, member.tp);
      put(RECORD_FIELDS.hp, member.hp); put(RECORD_FIELDS.maxHp, member.maxHp);
      put(RECORD_FIELDS.mp, member.mp); put(RECORD_FIELDS.maxMp, member.maxMp);
      (member.core ?? []).forEach((v, i) => put(RECORD_FIELDS.core + i * 2, v));
      (member.elements ?? []).forEach((v, i) => put(RECORD_FIELDS.elements + i * 2, v));
      for (const [name, off] of PAUSE_EQUIP_OFFSETS) {
        const id = Number(member.equipment?.[name]);
        const worn = Number.isInteger(id) && id > 0 && id <= PAUSE_ITEM_MAX_ID ? id : 0;
        mem.write16(base + off, worn);
        // The original's own rule — one worn byte per equip halfword — is the
        // fallback. When the caller supplies the stored worn array it is
        // authoritative and already carries those bytes (plus the switched-out
        // partners' gear, whose halfwords this page does not seed), so counting
        // the halfwords again here would read "Equip 2" beside one sword.
        if (worn && !seed.worn) {
          mem.write8(PAUSE_WORN_COUNTS + worn, (mem.read8(PAUSE_WORN_COUNTS + worn) + 1) & 0xff);
        }
      }
      if (member.nameBytes) {
        if (member.nameBytes.length > 23 || member.nameBytes.includes(0)) throw new Error("Invalid pause name bytes");
        mem.load(member.nameBytes, base + 8);
        mem.write8(base + 8 + member.nameBytes.length, 0);
      }
    }
  }

  private allocTask = (handler: number, size: number, extra: number): number =>
    this.tree.allocate(handler, size, extra);

  /** A widget method by slot, or a task method through the tree. */
  private call = (target: number, slot: number, args: number[]): void => {
    target >>>= 0;
    if (this.tree.tasks.has(target)) { this.tree.callMethod(target, slot, args); return; }
    dispatchWidgetMethod(this.mem, this.widgets, target, slot, args);
  };

  /** The ordering-table bucket the quads link into (a cell nothing else reads). */
  private otBucket = (): number => this.primBucket;
  private primCursor = (): number => this.primCursorAt;
  /** The quad the caller just wrote ends where the cursor moves to: record it for the painter. */
  private setPrimCursor = (next: number): void => {
    const at = this.primCursorAt;
    const mem = this.mem;
    if (next - at >= 0x18 && this.quads.length < 32) {
      const code = mem.read8(at + 7);
      if ((code & 0xe0) === 0x20 && (code & 0x08) !== 0) {
        const xs = [0xc, 0x14].map((o) => mem.read16s(at + o));
        const ys = [0xa, 0x12].map((o) => mem.read16s(at + o));
        this.quads.push({
          x: mem.read16s(at + 8), y: mem.read16s(at + 0xa), w: xs[0]! - mem.read16s(at + 8),
          h: ys[1]! - mem.read16s(at + 0xa), r: mem.read8(at + 4), g: mem.read8(at + 5), b: mem.read8(at + 6),
          semiTransparent: (code & 2) !== 0,
        });
        void xs; void ys;
      }
    }
    this.primCursorAt = next >>> 0;
    if (this.primCursorAt + 0x40 > this.primPool + 0x400) this.primCursorAt = this.primPool;
  };

  private cards(): PartyCardFillHost {
    const mem = this.mem;
    return {
      rosterSlot: (row) => partyPositionToRosterSlot(mem, row),
      copyStats: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
      cardRecord: (slot) => persistentRosterSlot(slot),
      resolveText: (offset) => this.banks.source(this.language + offset),
      widgetSetLine0: (w, src, i) => this.call(w, 0x114, [src, i]),
      widgetSetLineNumber: (w, l, v) => this.call(w, 0x118, [l, v]),
      widgetSetFlagC1: (w, v) => this.call(w, 0x144, [v]),
      widgetMeasure: (w, v) => this.call(w, 0x148, [v]),
    };
  }

  private services(host: PauseSessionHost): PauseServices & { copyForms(slot: number, out: number): void } {
    const mem = this.mem;
    const draw = this.draw;
    return {
      createText: (layer, kind, x, y) => this.widgets.createTextElement(layer, kind, x, y),
      createIcon: (layer, order, x, y) => this.widgets.spawnUiIcon(layer, order, x, y),
      callMethod: this.call,
      languageBank: (id) => this.banks.source(id),
      padPressed: () => this.pad.pressed(),
      padHeld: () => this.pad.held(),
      padRepeat: () => this.pad.repeated(),
      padBit: (_pad, code) => code,
      playSound: host.playSound,
      packHandle: (id) => id >>> 0,
      frameCount: () => draw.frameTick(),
      foldStart: (fold, open) => {
        windowFoldStart(mem, fold, open);
        host.playSound(open ? 0x40019 : 0x4001a);
      },
      foldTick: (fold) => windowFoldTick(mem, fold),
      rand: () => {
        this.rng = (Math.imul(this.rng, 1103515245) + 12345) >>> 0;
        return (this.rng >>> 8) & 0x7fff;
      },
      drawInit: () => draw.initDrawContext(),
      draw74: draw.setOrigin,
      draw78: draw.setDepth,
      draw7C: draw.setLayer,
      drawSprite: draw.drawSprite,
      draw88: draw.paletteShift,
      draw8C: draw.setScale,
      draw94: draw.setPos,
      copyForms: (slot, out) => copyEquippedForms(mem, slot, out),
    };
  }

  private itemsDrawHost() {
    const draw = this.draw;
    return {
      frameCounter: () => draw.frameTick(),
      cardIndexOf: (i: number) => partyPositionToRosterSlot(this.mem, i),
      cardName: (item: number) => itemIconClip(this.mem, item),
      packResolve: draw.packResolve,
      initDrawContext: () => draw.initDrawContext(),
      setLayer: draw.setLayer, setOrigin: draw.setOrigin, setScale: draw.setScale, setPos: draw.setPos,
      setPaletteRow: draw.paletteShift, drawSprite: draw.drawSprite,
    };
  }

  private bagHost(services: PauseServices, cards: PartyCardFillHost): BagHost {
    return {
      ...services, alloc: this.allocTask,
      rowFill: (_obj, ui, row, show) => partyCardFillItems(this.mem, ui, row, show, this.scratchBlock, cards),
    };
  }

  private itemsTickHost(services: PauseServices) {
    const mem = this.mem;
    const cards = this.cards();
    const bagHost = this.bagHost(services, cards);
    return {
      rowFill: (_obj: number, ui: number, index: number, flag: number) =>
        partyCardFillItems(mem, ui, index, flag, this.scratchBlock, cards),
      animStart: (obj: number, flag: number) => itemsDescPanelFold(mem, obj, flag, bagHost),
      animFinish: (obj: number, ui: number) => itemsApplyEffect(mem, obj, ui, bagHost),
      animActive: (obj: number) => itemsWindowReady(mem, obj, bagHost),
      openItem: (obj: number, index: number, sub: number) => pauseBagFactory(mem, obj, index, sub, bagHost),
      ability: (record: number, arg: number) => inventoryCopy(mem, record, arg),
      widgetAct: (ptr: number, flag: number) => services.foldStart(ptr, flag),
      widgetReady: (ptr: number) => services.foldTick(ptr),
      resourceBase: (id: number) => this.banks.source(id),
      playSound: services.playSound,
      padReadA: () => this.pad.pressed(),
      padReadB: () => this.pad.repeated(),
      padButton: (_port: number, code: number) => code,
      callMethod: this.call,
    };
  }

  private pauseHost(services: PauseServices, factories: {
    itemsFactory(obj: number): number; sortFactory(obj: number): number; mapFactory(obj: number): number;
    techniquesFactory(obj: number): number; statusFactory(obj: number): number; cardFoldersFactory(obj: number): number;
    questsFactory(obj: number): number;
  }): PauseHost {
    const table = new Map<number, (obj: number) => number>([
      [0x80091e4c, factories.itemsFactory], [0x8009824c, factories.sortFactory],
      [0x80099324, factories.mapFactory], [0x80096548, factories.techniquesFactory],
      [0x8008e8f8, factories.statusFactory], [0x80084c48, factories.cardFoldersFactory],
      // EXTRA: the disc's table names a builder (0x80086450) for the slot after CARD FOLDERS; it is not translated, and the QUESTS page takes the slot
      [0x80086450, factories.questsFactory],
    ]);
    return {
      resourceLoaded: () => 0, // Every text family and pack was loaded before the screen was made.
      loadResource: () => {},
      packResolve: (handle) => handle >>> 0,
      requestBanks: () => {},
      banksReady: () => 0,
      initMenuContext: () => {},
      contextMethod: () => {},
      createHostObject: () => this.tree.allocate(PAUSE_HOST_HANDLER, PAUSE_HOST_SIZE, PAUSE_HOST_EXTRA),
      menuVariant: () => mapServerFromStage(this.mem),
      initDrawContext: () => this.draw.initDrawContext(),
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      drawSprite: this.draw.drawSprite,
      callFunction: (fn, obj) => {
        const factory = table.get(fn >>> 0);
        if (!factory) throw new Error(`The pause page factory ${(fn >>> 0).toString(16)} is not translated`);
        return factory(obj);
      },
      fallback: (obj) => factories.itemsFactory(obj),
      // The resident pause home is not part of this overlay; closing the page ends the session.
      openSubScreen: () => { this.closed = true; return 0; },
      callMethod: services.callMethod,
    };
  }
}

/** [0x80048D34+0x2738](slot, out): validate a partner's three equipped forms into `out`. */
function copyEquippedForms(mem: NativeMemory, slot: number, out: number): void {
  validateEquippedForm(mem, slot, out);
}

function dimQuadTickWith(mem: NativeMemory, obj: number, host: {
  otBucket(view: number, depth: number): number; cursor(): number; setCursor(p: number): void;
  callMethod(target: number, slot: number, args: number[]): void;
}): void {
  dimQuadTick(mem, obj, host);
}
