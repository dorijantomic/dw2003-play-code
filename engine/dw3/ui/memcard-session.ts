// Frame owner for the translated memory-card screen (pro/stgmcard): the SAVE / LOAD
// screen with the slot chooser, the file card, the confirm prompts, the progress bar
// and the result strip. Every routine it runs is a registered port; no PlayStation
// instruction is executed.
//
// Composition (registered ports):
//   entry actor F0x80082CD0, fade ctor F0x80083074, the small methods, fill, slot
//   transition                       -> memcard-parts.ts, memcard-fill.ts
//   root F0x80087B08/C18/DF0/7F0     -> memcard-root.ts
//   window F0x80087798/534/368       -> memcard-message-window.ts
//   state machine F0x80084DCC        -> memcard-machine.ts
//   block grid, save card            -> memcard-block-grid.ts, memcard-save-card.ts
//   fade start/tick (same bodies)    -> native/fight-report-fade.ts
//   tween F0x80087FDC/801C, fold F0x80087EDC/F70 -> tween-linear.ts, window-fold.ts
//   checksum F0x80015564             -> memcard-platform.ts
//
// Service map (each an existing translated provider or a documented platform one):
//   object factory F0x80014504       -> TranslatedTaskTree.allocate
//   text widgets F0x8001AE38 + slots -> ShopWidgetServices / dispatchWidgetMethod
//   cursor F0x8001B364               -> ShopWidgetServices.spawnUiIcon
//   text banks lang+0x78/0xA9/0x94   -> ScreenTextBanks (data-only indexed text)
//   pad [0x8004B7D0+0x3F4/3FC/408]   -> ScreenPad (+0x408 is the identity map)
//   picture service F0x8001F648 ...  -> ShopDrawIntents (recorded, painted by the browser)
//   frame counter                    -> the display clock's tick
//   packed sound                     -> platform: host.playSound
//   display service +0x150/154/174/16C, view +0x12C -> platform: recorded in `displayCalls`
//   audio archive 0x20 request       -> platform: recorded in `soundArchives`; never pending
//   GPU dim quad F0x80082E7C         -> platform: the fade level (fadeLevel()), painted by the browser
//   GPU progress-bar primitive       -> platform: a "gouraudQuad" draw call (see memcardTransitionTick)
//   card manager slots               -> memcard-platform.ts (MemcardServices over host.card)
//   card file header icon/title (F0x80087C18 -> F0x80014930): platform. The PS1 BIOS
//       shows them in its own card manager; the virtual card has no BIOS file header,
//       so the request (title string, three icon frames) is recorded in
//       `fileHeaderRequests` and the 0x80-byte block is built with an empty title.
//   launcher F0x8004B440 (creates the entry actor, reads the exit request) -> platform:
//       the session allocates the actor; the exit request words are `transition()`.
//
// The driver copies the resident image verbatim. The save adapter seeds the party
// and owned reserves, stats, forms, gear, bag, cards and stored flag slices. On load
// the mapped fields come from this image; unexplained bytes remain in the retained
// residentSaveImage and browser-only state stays in the companion snapshot.
// See docs/research/systems/save-block-layout.md.
//
// The shared block 0x80088768 (selected slot, staging pointers, tween/fold method
// words) is mutable: each session builds a fresh NativeMemory and loads its own copy
// of the data tail, with the routine-pointer words zeroed (ports bind by name).
import { MAX_ROSTER_SLOTS } from "../roster.ts";
import { writeSaveBlock, seedSaveCards, seedSaveFlags, type ResidentCards } from "../save-block.ts";
import { ROSTER_EQUIP_ENTRIES, type RosterEquipment, rosterRecordAddress } from "../party-context.ts";
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { PARTY_MAP, ROSTER_RECORDS, ROSTER_STRIDE, partyPositionToRosterSlot, requestScreenTransition } from "../party-context.ts";
import { loadPtrB400 } from "../globals.ts";
import { saveBuildHeader } from "../save-header.ts";
import { writeItemArrays, readItemArrays, heldArrayAddress, wornArrayAddress, HELD_MAX, type ItemCountEntry } from "../item-store.ts";
import { zeroFill } from "../zero-fill.ts";
import { fetchTableEntry } from "./fetch-table.ts";
import { seedRosterForms, type RosterFormState } from "./roster-form-state.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { tweenLinearStart, tweenLinearTick } from "./tween-linear.ts";
import { LOGICAL_BUTTON_TABLE, textRevealTick } from "./text-window.ts";
import { callTaskOrWidget, createResidentTextServices, loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { setTextWidgetOrigin } from "./text-element-setters.ts";
import { reportFadeStart, reportFadeTick } from "./native/fight-report-fade.ts";
import { scaleMatrix } from "./native/wizard-misc.ts";
import {
  MEMCARD_ENTRY_EXTRA, MEMCARD_ENTRY_HANDLER, MEMCARD_ENTRY_SIZE, MEMCARD_FADE_HANDLER, MEMCARD_FADE_START_SLOT,
  MEMCARD_TRANSITION_HANDLER, memcardCardHide, memcardCardShow, memcardEntryTick, memcardFadeCreate,
  memcardFreeStaging, memcardGridChoose, memcardGridClose, memcardGridOpen, memcardGridSlideIn,
  memcardGridSlideOut, memcardHideStep, memcardSlotCaption, memcardTeardownScreen, memcardTransitionColourA,
  memcardTransitionColourB, memcardTransitionCreate, memcardTransitionPlay, memcardTransitionPosition,
  memcardTransitionTick, memcardWindowDismiss, memcardWindowRefresh,
} from "./memcard-parts.ts";
import { memcardFillCard } from "./memcard-fill.ts";
import {
  MEMCARD_ROOT_HANDLER, MEMCARD_ROOT_SIZE, memcardRootBanksReady, memcardRootCreate, memcardRootIdentity,
  memcardRootTick, MEMCARD_SAVE_HEADER_RECORD,
} from "./memcard-root.ts";
import {
  MEMCARD_WINDOW_HANDLER, memcardMessageWindowCreate, memcardMessageWindowTick,
} from "./memcard-message-window.ts";
import {
  MEMCARD_GRID_HANDLER, memcardBlockGridReset, memcardBlockGridTick,
} from "./memcard-block-grid.ts";
import {
  MEMCARD_CARD_HANDLER, memcardSaveCardCreate, memcardSaveCardReset, memcardSaveCardTick,
} from "./memcard-save-card.ts";
import { memcardStateMachine, type MemcardHost, MEMCARD_CARD_STRUCT } from "./memcard-machine.ts";
import { MemcardServices, cardChecksum, type VirtualCard } from "./memcard-platform.ts";

/** The resident save context (0x26C4 bytes). */
export const MEMCARD_SAVE = 0x80048d34;
export const MEMCARD_MONEY = MEMCARD_SAVE + 0x6c;
export const MEMCARD_HELD = heldArrayAddress(0, MEMCARD_SAVE);
export const MEMCARD_WORN = wornArrayAddress(0, MEMCARD_SAVE);
export const MEMCARD_HELD_CAP = HELD_MAX;
/** ctx+0x26D0: the launcher's mode word (bit 31 set = SAVE); ctx+0x26C4 the code word. */
export const MEMCARD_MODE_WORD = MEMCARD_SAVE + 0x26d0;
export const MEMCARD_CODE_WORD = MEMCARD_SAVE + 0x26c4;
export const MEMCARD_TABLES_BASE = 0x80088088;
export const MEMCARD_TEXT_BANKS = [0x78, 0xa9, 0x94] as const;
const LANGUAGE_CELL = 0x8005cca8;
const SHARED = 0x80088768;

export interface MemcardResources {
  /** The overlay's data tail from 0x80088088 (routine pointer words zeroed). */
  tables: Uint8Array;
  profiles?: Uint8Array;
  /** The text engine's wait-for-button table at 0x8004DCCC. */
  textButtons: Uint8Array;
  font: Uint8Array;
  /** Banks by id: language + each of MEMCARD_TEXT_BANKS. */
  banks: ReadonlyMap<number, Uint8Array>;
  /**
   * The resident cursor glyph table (0x8004DCE0) and its strings (0x8005CCD0) —
   * the same resident data every translated screen with a selection cursor loads
   * through loadResidentResources. Without it the cursor object (F0x8001B364)
   * builds its glyph child with a null string, so F0x8001B0A4 draws nothing and
   * the YES/NO confirm prompt shows no highlight on the chosen row.
   */
  cursorGlyphs?: CursorGlyphTable;
}

export interface MemcardMember {
  /** The party position 0..2 (contiguous from 0). */
  position: number;
  rosterSlot: number;
  starterSlot?: number;
  nameBytes: readonly number[];
  exp: number;
  level: number;
  tp?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  forms?: RosterFormState;
  lastUltraDrill?: number | null;
  core?: readonly number[];
  elements?: readonly number[];
  equipment?: RosterEquipment;
}

export interface MemcardSeed {
  language: number;
  mode: "save" | "load";
  /** The save point's slot (1..25) for a save; the launch code is 0xC00 | slot. */
  savePointSlot?: number;
  /**
   * The slot the card's directory block describes (0..2) — the block's +1 byte
   * the writer stamps at save time (stgmcard.s .L0x00003840-.L0x00003848) and
   * every card open reads back as `stage` (state 0x16, .L0x00002BE4), so the
   * chooser opens on the last-saved file (state 0x1F mode 2, `blockDir(stage)`).
   * The browser's card has no stored block; the platform's card-check read
   * (file 1) resolves to `this slot + 2` (memcard-platform.ts fileOf), so this
   * seeds the shared index the read is derived from.
   */
  lastSlot?: number;
  bits: number;
  /**
   * The bag as the block's two arrays: `ctx+0x7C+id` carried, `ctx+0x20F+id` worn,
   * for every id 1..402. `writeItemArrays` fills the whole range, so an id the
   * player does not have writes 0 — which is what copying the block whole did.
   */
  bag: readonly ItemCountEntry[];
  playSeconds: number;
  /** The player name in the screen text codec (ctx+0x54). */
  playerNameBytes: readonly number[];
  members: readonly MemcardMember[];
  /** Owned reserves, addressed by species slot rather than deployed position. */
  reserves?: readonly MemcardMember[];
  /** Previously loaded block: retain data with no walker representation. */
  residentImage?: ArrayLike<number>;
  cards?: ResidentCards;
  storedFlags?: Record<string, string>;
  progressOrdinal?: number;
  packId?: number;
}

export interface MemcardHostServices {
  playSound(id: number): void;
  card: VirtualCard;
}

export interface MemcardDisplayCall { call: string; args: number[] }

export class MemcardSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  readonly services: MemcardServices;
  readonly bootTask: number;
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  /** The ids this screen asked the shared queue for. */
  get sounds(): number[] { return this.audio.sounds; }
  readonly displayCalls: MemcardDisplayCall[] = [];
  readonly soundArchives: number[] = [];
  readonly fileHeaderRequests: { titleBytes: number[]; frames: number }[] = [];
  readonly language: number;
  readonly mode: "save" | "load";
  private root = 0;
  private dimLevel = 0;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly host: MemcardHostServices;
  private readonly revealHost: Parameters<typeof textRevealTick>[1];
  private readonly otAddress: number;
  private readonly primAddress: number;
  private readonly scratchAddress: number;
  private quadLayer = 0;
  private quadBucket = 0;
  private frame = 0;

  constructor(seed: MemcardSeed, resources: MemcardResources, host: MemcardHostServices) {
    if (!Number.isInteger(seed.language) || seed.language < 0 || seed.language > 6) throw new Error("Invalid memory card language");
    if (seed.members.length > 3) throw new Error("Invalid memory card party size");
    seed.members.forEach((m, i) => {
      if (m.position !== i) throw new Error("Memory card party positions must be contiguous from 0");
      if (!Number.isInteger(m.rosterSlot) || m.rosterSlot < 0 || m.rosterSlot >= MAX_ROSTER_SLOTS) throw new Error("Invalid memory card roster slot");
    });
    this.language = seed.language;
    this.mode = seed.mode;
    this.host = host;
    const mem = this.mem;
    if (resources.textButtons.length !== 20) throw new Error("Invalid memory card wait-button table");
    loadResidentResources(mem, { font: resources.font,
      ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}),
      ranges: [
      { base: MEMCARD_TABLES_BASE, bytes: resources.tables },
      { base: LOGICAL_BUTTON_TABLE, bytes: resources.textButtons },
    ] });
    this.banks = new ScreenTextBanks(mem, seed.language, MEMCARD_TEXT_BANKS, resources.banks, "memory card");
    this.widgets = new ShopWidgetServices(mem, this.banks as never);
    mem.write32(LANGUAGE_CELL, seed.language);
    if (resources.profiles) mem.load(resources.profiles, 0x8003ef5c);
    this.seedSave(seed);
    this.services = new MemcardServices(mem, host.card);
    this.primAddress = this.widgets.arena.alloc(0x30, 4);
    this.otAddress = this.widgets.arena.alloc(8, 4);
    this.scratchAddress = this.widgets.arena.alloc(0x40, 4);

    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Memory card", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed(),
      stringById: (bank, id) => this.banks.stringById(mem, bank, id),
      scaleMatrix: (dst, scale) => scaleMatrix(mem, dst, scale),
    }).revealHost;

    const tree = (): TranslatedTaskTree => this.tree;
    const classes = new Map<number, TranslatedTaskClass>();
    const call = this.callMethod;
    const tweenHost = { tweenStart: (t: number, f: number, to: number, n: number) => tweenLinearStart(mem, t, f, to, n) };
    classes.set(MEMCARD_ENTRY_HANDLER, {
      name: "memory card entry", childSlots: [0], terminalTick: true,
      tick: (task, children) => memcardEntryTick(mem, task, children, this.entryHost()),
    });
    classes.set(MEMCARD_ROOT_HANDLER, {
      name: "memory card root", childSlots: [0, 4], terminalTick: true,
      tick: (root, children) => memcardRootTick(mem, root, children, this.rootHost()),
    });
    classes.set(MEMCARD_WINDOW_HANDLER, {
      name: "memory card window", childSlots: [0x1c, 0x20, 0x24], terminalTick: false,
      tick: (win, children) => memcardMessageWindowTick(mem, win, children, this.windowHost()),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [0x2854, (win) => memcardWindowRefresh(mem, win, call)],
        [0x2858, (win) => memcardWindowDismiss(mem, win, call, (w, v) => tree().callMethod(w, 0x28, [v]))],
      ]),
    });
    classes.set(MEMCARD_GRID_HANDLER, {
      name: "memory card block grid", childSlots: [],
      tick: (grid, children) => memcardBlockGridTick(mem, grid, children, this.gridHost()),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [0xdc, (g) => memcardBlockGridReset(mem, g, { ...tweenHost, allocGrid: this.alloc })],
        [0xe0, (g) => memcardGridSlideIn(mem, g, { ...tweenHost, callMethod: call })],
        [0xe4, (g, a) => memcardGridChoose(mem, g, a[0]!, tweenHost)],
        [0xe8, (g) => memcardGridSlideOut(mem, g, tweenHost)],
        [0xec, (g) => memcardGridOpen(mem, g, tweenHost)],
        [0xf0, (g) => memcardGridClose(mem, g, tweenHost)],
      ]),
    });
    const setSubstate = (card: number, v: number): void => tree().callMethod(card, 0x2c, [v]);
    classes.set(MEMCARD_CARD_HANDLER, {
      name: "memory card file card", childSlots: [],
      tick: (card) => memcardSaveCardTick(mem, card, this.cardHost()),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [0x84, (c) => memcardCardShow(c, setSubstate)],
        [0x88, (c) => memcardCardHide(mem, c, setSubstate, call)],
        [0x8c, (c) => memcardFillCard(mem, c, this.fillHost())],
      ]),
    });
    classes.set(MEMCARD_TRANSITION_HANDLER, {
      name: "memory card slot transition", childSlots: [],
      tick: (t) => memcardTransitionTick(mem, t, this.transitionHost()),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [0xc4, (t) => memcardSaveCardReset(mem, t)],
        [0xc8, (t, a) => memcardTransitionPlay(mem, t, a[0]!, a[1]!)],
        [0xcc, (t, a) => memcardTransitionColourA(mem, t, a[0]!, a[1]!, a[2]!)],
        [0xd0, (t, a) => memcardTransitionColourB(mem, t, a[0]!, a[1]!, a[2]!)],
        [0xd4, (t, a) => memcardTransitionPosition(mem, t, a[0]!, a[1]!)],
      ]),
    });
    const fadeHost = {
      alloc: (h: number, s: number, e: number) => this.tree.allocate(h, s, e),
      callMethod: (t: number, slot: number, args: number[]) => { this.callMethod(t, slot, args); },
      dimQuad: (fade: number) => {
        this.dimLevel = Math.max(0, Math.min(255, (mem.read32(fade + 0x5c) | 0) >> 8));
      },
    };
    classes.set(MEMCARD_FADE_HANDLER, {
      name: "memory card fade", childSlots: [], terminalTick: true,
      tick: (fade) => reportFadeTick(mem, fade, fadeHost),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [MEMCARD_FADE_START_SLOT, (fade, a) => reportFadeStart(mem, fade, a[0]!, a[1]!, fadeHost)],
      ]),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.bootTask = this.tree.allocate(MEMCARD_ENTRY_HANDLER, MEMCARD_ENTRY_SIZE, MEMCARD_ENTRY_EXTRA);
  }

  // ── seeding ──────────────────────────────────────────────────────────────

  /** What the launcher and the game state hand the screen: mode, code, BIT, items, clock, name, party. */
  private seedSave(seed: MemcardSeed): void {
    const mem = this.mem;
    if (seed.residentImage) writeSaveBlock(mem, seed.residentImage);
    // The card's block describes the last-saved slot; the platform's card-check
    // read (file 1) derives from this shared index, so the chooser opens on it
    // (state 0x16 -> 0x1F mode 2 `blockDir(stage)`), as the disc does.
    if (Number.isInteger(seed.lastSlot) && seed.lastSlot! >= 0 && seed.lastSlot! <= 2) {
      mem.write32(SHARED + 4, seed.lastSlot! >>> 0);
    }
    mem.write32(MEMCARD_MODE_WORD, seed.mode === "save" ? 0x80000000 : 0);
    const sp = seed.savePointSlot;
    mem.write32(MEMCARD_CODE_WORD,
      (seed.mode === "save" && Number.isInteger(sp) && sp! >= 1 ? 0xc00 | (sp! & 0xff) : 0xc00) >>> 0);
    mem.write32(MEMCARD_MONEY, seed.bits >>> 0);
    writeItemArrays(mem, seed.bag, MEMCARD_SAVE);
    if (seed.cards) seedSaveCards(mem, seed.cards);
    if (seed.storedFlags) seedSaveFlags(mem, seed.storedFlags);
    if (seed.progressOrdinal !== undefined) mem.write32(MEMCARD_SAVE + 0x263c, seed.progressOrdinal);
    if (seed.packId !== undefined) mem.write32(MEMCARD_SAVE + 0x2640, seed.packId);
    const seconds = Math.max(0, Math.floor(seed.playSeconds || 0));
    mem.write32(MEMCARD_SAVE + 0x4c, ((Math.floor(seconds / 3600) & 0xffff) | ((Math.floor(seconds / 60) % 60) << 16)) >>> 0);
    mem.write16(MEMCARD_SAVE + 0x50, seconds % 60);
    seed.playerNameBytes.slice(0, 0x17).forEach((b, i) => mem.write8(MEMCARD_SAVE + 0x54 + i, b & 0xff));
    mem.write8(MEMCARD_SAVE + 0x54 + Math.min(seed.playerNameBytes.length, 0x17), 0);
    for (let i = 0; i < 3; i++) {
      const m = seed.members[i];
      mem.write32(PARTY_MAP + i * 4, m ? m.rosterSlot >>> 0 : 0xffffffff);
    }
    for (const m of [...(seed.reserves ?? []), ...seed.members]) {
      const record = rosterRecordAddress(m.rosterSlot);
      mem.write32(record, ((m.starterSlot ?? m.rosterSlot) + 3) >>> 0);
      if (m.lastUltraDrill !== undefined) mem.write8(record + 0x3d4, m.lastUltraDrill ?? 0);
      if (m.forms) seedRosterForms(mem, record, m.forms);
      mem.write32(record + 0x20, m.exp >>> 0);
      mem.write16(record + 0x24, m.level & 0xffff);
      mem.write16(record + 0x26, (m.tp ?? 0) & 0xffff);
      mem.write16(record + 0x28, (m.hp ?? 0) & 0xffff);
      mem.write16(record + 0x2a, (m.maxHp ?? 0) & 0xffff);
      mem.write16(record + 0x2c, (m.mp ?? 0) & 0xffff);
      mem.write16(record + 0x2e, (m.maxMp ?? 0) & 0xffff);
      (m.core ?? []).forEach((v, i) => { if (i < 6) mem.write16(record + 0x30 + i * 2, v); });
      (m.elements ?? []).forEach((v, i) => { if (i < 7) mem.write16(record + 0x3c + i * 2, v); });
      if (m.equipment) for (const [key, offset] of ROSTER_EQUIP_ENTRIES) mem.write16(record + offset, m.equipment[key] ?? 0);
      m.nameBytes.slice(0, 23).forEach((b, i) => mem.write8(record + 0x08 + i, b & 0xff));
      mem.write8(record + 0x08 + Math.min(23, m.nameBytes.length), 0);
    }
  }

  // ── platform services ────────────────────────────────────────────────────

  private playSound(id: number): number {
    this.audio.play(id);
    this.host.playSound(id);
    return 0;
  }

  /** Every method call on a task, text widget or cursor. */
  private callMethod = (target: number, slot: number, args: number[]): number =>
    callTaskOrWidget(this.mem, this.tree, this.widgets, target, slot, args);

  private alloc = (h: number, s: number, e: number): number => this.tree.allocate(h, s, e);
  private advance = (obj: number): void => this.tree.callMethod(obj, 0x38);
  private free = (ptr: number): void => { if (this.widgets.arena.has(ptr)) this.widgets.arena.free(ptr); };
  private bank = (id: number): number => this.banks.source(id);

  private foldStart = (window: number, opening: number): void => {
    windowFoldStart(this.mem, window, opening);
    this.playSound(opening ? 0x40019 : 0x4001a);
  };

  // ── hosts ────────────────────────────────────────────────────────────────

  private entryHost() {
    const record = (call: string, ...args: number[]): void => { this.displayCalls.push({ call, args }); };
    return {
      displayReset: () => record("displayReset"),
      displayPacketSize: (b: number) => record("displayPacketSize", b),
      displayRegion: (w: number, h: number, a: number, b: number) => record("displayRegion", w, h, a, b),
      displayView: (r: { x: number; y: number; w: number; h: number }, kind: number, priority: number) => {
        record("displayView", r.x, r.y, r.w, r.h, kind, priority);
        return 1;
      },
      viewColour: (_v: number, r: number, g: number, b: number) => record("viewColour", r, g, b),
      createRoot: () => {
        this.root = memcardRootCreate(this.mem, this.rootCreateHost());
        return this.root;
      },
      advance: this.advance,
    };
  }

  private rootCreateHost() {
    return {
      allocRoot: this.alloc,
      selectorCategory: () => this.mem.read32(MEMCARD_CODE_WORD) | 0,
      sideBit: () => this.mem.read32(MEMCARD_MODE_WORD) | 0,
      previousSelector: () => loadPtrB400(this.mem),
      requestSoundArchive: (id: number) => { this.soundArchives.push(id); },
    };
  }

  private identityHost() {
    const mem = this.mem;
    return {
      ...this.rootCreateHost(),
      installStandardContext: () => this.widgets.arena.alloc(0xa8, 4),
      contextSetOrigin: () => {},
      packResolve: this.draw.packResolve,
      contextBindSheet: () => {},
      initStateContext: () => this.widgets.arena.alloc(0x60, 4),
      initFetcher: () => {},
      resourceGetBase: this.bank,
      fetchTableEntry: (base: number, index: number) => fetchTableEntry(mem, base, index),
      contextPush: (_ctx: number, value: number) => {
        const bytes: number[] = [];
        for (let a = value >>> 0; bytes.length < 0x80 && mem.read8(a) !== 0; a++) bytes.push(mem.read8(a));
        this.fileHeaderRequests.push({ titleBytes: bytes, frames: 3 });
      },
      saveBuildHeader: (ctx: number, struct: number, count: number, r0: number, r1: number, r2: number) => {
        // F0x80014930(name, struct, count, table): the table is the three icon frame pointers.
        const table = this.widgets.arena.alloc(0x0c, 4);
        [r0, r1, r2].forEach((v, i) => mem.write32(table + i * 4, v >>> 0));
        saveBuildHeader(mem, ctx, struct, count, table);
      },
      freeBuffer: this.free,
      allocBuffer: (size: number) => this.widgets.arena.alloc(size, 4),
      requestBank: (id: number) => { this.bank(id); },
      bankPending: (id: number) => { this.bank(id); return 0; },
    };
  }

  private rootHost() {
    const mem = this.mem;
    const identity = this.identityHost();
    return {
      advancePhase: (s: number) => this.tree.callMethod(s, 0x38),
      advanceSubstate: (s: number) => this.tree.callMethod(s, 0x3c),
      buildIdentity: () => memcardRootIdentity(mem, identity),
      banksReady: () => memcardRootBanksReady(mem, identity),
      audioPending: () => 0, // Platform: the sound archive is served at once.
      playSound: (id: number) => { this.playSound(id); },
      playSoundExit: (id: number) => { this.playSound(id); },
      createMessageWindow: (screen: number) => memcardMessageWindowCreate(mem, screen, { allocMessageWindow: this.alloc }),
      fadeCtor: () => memcardFadeCreate(mem, { alloc: this.alloc }),
      fadeStart: (fade: number, a1: number, a2: number) => this.tree.callMethod(fade, MEMCARD_FADE_START_SLOT, [a1, a2]),
      requestTransition: (selector: number, arg: number) => requestScreenTransition(mem, selector, arg),
      selectorMethod: () => loadPtrB400(mem),
      saveSelector: () => mem.read32(MEMCARD_SAVE + 0x34) | 0,
      freeIconTitle: () => memcardFreeStaging(mem, this.free),
      initDrawContext: this.draw.initDrawContext,
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
    };
  }

  private windowHost() {
    const mem = this.mem;
    return {
      allocMessageWindow: this.alloc,
      allocGrid: this.alloc,
      tweenStart: (t: number, f: number, to: number, n: number) => tweenLinearStart(mem, t, f, to, n),
      advancePhase: (s: number) => this.tree.callMethod(s, 0x38),
      createTextElement: this.widgets.createTextElement,
      widgetSet160: (w: number, v: number) => this.widgets.textFlagBF(w, v),
      widgetSet15C: (w: number, v: number) => { dispatchWidgetMethod(mem, this.widgets, w, 0x15c, [v]); },
      widgetClear: (w: number, v: number) => this.widgets.textShow(w, v),
      spawnUiIcon: this.widgets.spawnUiIcon,
      iconShow: (icon: number, v: number) => this.widgets.cursorShow(icon, v),
      stateMachine: (screen: number, child: number) => memcardStateMachine(mem, screen, child, 0, this.machineHost()),
      initDrawContext: this.draw.initDrawContext,
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      paletteShift: this.draw.paletteShift,
      drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
      frameTick: this.draw.frameTick,
    };
  }

  private gridHost() {
    const mem = this.mem;
    return {
      ...this.windowHost(),
      tweenTick: (t: number) => tweenLinearTick(mem, t),
      resourceGetBase: this.bank,
      widgetSetLine0: (w: number, source: number, index: number) => this.widgets.textSet(w, source, index),
      widgetSetNumber: (w: number, a1: number, v: number) => this.widgets.textNumber(w, a1, v),
      widgetSetPosition: (w: number, x: number, y: number) => setTextWidgetOrigin(mem, w, x, y),
      refreshCard: (parent: number) => this.tree.callMethod(parent, 0x2854),
      playSound: (id: number) => { this.playSound(id); },
      padPressed: () => this.pad.pressed(),
      padRepeat: () => this.pad.repeated(),
      padBit: (_port: number, code: number) => code,
      languageIndex: () => mem.read32(LANGUAGE_CELL) | 0,
    };
  }

  private cardHost() {
    const mem = this.mem;
    return {
      advancePhase: (c: number) => this.tree.callMethod(c, 0x38),
      createTextElement: this.widgets.createTextElement,
      widgetSetC0: (w: number, v: number) => this.widgets.textColour(w, v),
      foldStart: this.foldStart,
      foldTick: (fold: number) => windowFoldTick(mem, fold),
      setSubstate: (c: number, v: number) => this.tree.callMethod(c, 0x2c, [v]),
      fill: (c: number) => memcardFillCard(mem, c, this.fillHost()),
      initDrawContext: this.draw.initDrawContext,
      setOrigin: this.draw.setOrigin,
      setLayer: this.draw.setLayer,
      setScale: this.draw.setScale,
      setPos: this.draw.setPos,
      drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
      frameTick: this.draw.frameTick,
      selectedSlotIndex: () => mem.read32(SHARED + 4) | 0,
      languageIndex: () => mem.read32(LANGUAGE_CELL) | 0,
    };
  }

  private fillHost() {
    return { callMethod: (t: number, s: number, a: number[]) => { this.callMethod(t, s, a); }, resourceGetBase: this.bank };
  }

  private transitionHost() {
    const mem = this.mem;
    return {
      advance: this.advance,
      reset: (t: number) => memcardSaveCardReset(mem, t),
      otSlot: (layer: number, bucket: number) => { this.quadLayer = layer; this.quadBucket = bucket; return this.otAddress; },
      rotMatrix: (rotation: number, matrix: number) => {
        // The rotation vector is never written (see memcardTransitionTick): identity only.
        for (const off of [0, 2, 4]) {
          if (mem.read16(rotation + off) !== 0) throw new Error("RotMatrix with a nonzero angle is not translated");
        }
        mem.write32(matrix + 0x0, 0x1000);
        mem.write32(matrix + 0x4, 0);
        mem.write32(matrix + 0x8, 0x1000);
        mem.write32(matrix + 0xc, 0);
        mem.write32(matrix + 0x10, 0x1000);
      },
      scaleMatrix: (matrix: number, scale: number) => scaleMatrix(mem, matrix, scale),
      applyMatrix: (matrix: number, input: number, output: number) => this.applyMatrix(matrix, input, output),
      allocPrim: () => this.primAddress,
      commitPrim: (end: number) => this.commitPrim(end - 0x24),
      scratch: () => this.scratchAddress,
      initDrawContext: this.draw.initDrawContext,
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
    };
  }

  /** F0x8002B1DC(matrix, in, out): libgte ApplyMatrixSV, the GTE rotation multiply. */
  private applyMatrix(matrix: number, input: number, output: number): void {
    const s16 = (v: number): number => (v << 16) >> 16;
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

  /** The progress bar's Gouraud quad, handed to the renderer as one picture call in its own bucket. */
  private commitPrim(prim: number): void {
    const s16 = (v: number): number => (v << 16) >> 16;
    const b = (off: number) => this.mem.read8(prim + off);
    const vertex = (off: number): number[] => [s16(this.mem.read16(prim + off)), s16(this.mem.read16(prim + off + 2))];
    const colour = (off: number): number[] => [b(off), b(off + 1), b(off + 2)];
    this.draw.setLayer(this.quadLayer, this.quadBucket);
    this.draw.calls.push({
      method: "gouraudQuad",
      args: [...vertex(8), ...vertex(0x10), ...vertex(0x18), ...vertex(0x20),
             ...colour(4), ...colour(0xc), ...colour(0x14), ...colour(0x1c)],
    });
  }

  private machineHost(): MemcardHost {
    const mem = this.mem;
    const call = this.callMethod;
    const svc = this.services;
    return {
      tweenTick: (obj) => tweenLinearTick(mem, obj),
      bankGet: this.bank,
      playSound: (id) => { this.playSound(id); },
      padPressed: () => this.pad.pressed(),
      padRepeat: () => this.pad.repeated(),
      padKey: (_port, code) => code,
      widgetCall: (w, slot, args) => call(w, slot, args),
      screenCall: (s, slot, args) => call(s, slot, args),
      createSaveCard: (screen) => memcardSaveCardCreate(mem, screen, { allocCard: this.alloc }),
      createSlotTransition: (a, b, c, d) => memcardTransitionCreate(mem, { alloc: this.alloc }, a, b, c, d),
      messageSlotCaption: (screen, widgets, flag) =>
        memcardSlotCaption(mem, screen, widgets, flag, { callMethod: (t, s, a) => { call(t, s, a); }, resourceGetBase: this.bank }),
      memcardTeardown: (screen, widgets) => memcardTeardownScreen(mem, screen, widgets, (t, s, a) => { call(t, s, a); }),
      memcardHideStep: (screen, widgets) => memcardHideStep(mem, screen, widgets, (t, s, a) => { call(t, s, a); }),
      memZero: (dst, bytes) => zeroFill(mem, dst, bytes),
      cardStatusList: (h) => svc.status(h),
      cardStatusA: (h) => svc.status(h),
      cardStatusB: (h) => svc.status(h),
      cardStatusC: (h) => svc.status(h),
      cardStatusD: (h) => svc.status(h),
      cardService33c: (h, buf, len, arg) => svc.read(h, buf, len, arg),
      cardService340: (h, buf, len, arg) => svc.write(h, buf, len, arg),
      checksum: (buf, len) => cardChecksum(mem, buf, len),
      cardFileCount: () => mem.read32(MEMCARD_CARD_STRUCT + 0x314) | 0,
      cardFileTable: () => (MEMCARD_CARD_STRUCT + 0x318) >>> 0,
      cardFileIndex: () => mem.read32(MEMCARD_CARD_STRUCT + 0x324) | 0,
      setCardFileIndex: (v) => mem.write32(MEMCARD_CARD_STRUCT + 0x324, v),
      cardEnumerate: () => { throw new Error("Memory card file enumeration is not part of the virtual card contract"); },
      cardFreeBlocks: () => mem.read32(MEMCARD_CARD_STRUCT + 0xc0) | 0,
      rosterSlot: (i) => partyPositionToRosterSlot(mem, i),
    };
  }

  // ── frame ────────────────────────────────────────────────────────────────

  /** One display tick. */
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.dimLevel = 0;
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.bootTask);
    this.widgets.tickCursors(this.frame);
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
  }

  /** True once the root reached state 3, ran its exit path and left the tree. */
  finished(): boolean { return this.root !== 0 && !this.tree.tasks.has(this.root); }

  /** The fade level (0..255) of the closing dim on the latest tick, 0 when none. */
  fadeLevel(): number { return this.dimLevel; }

  /** The screen's state words while it is alive, for diagnostics. */
  state(): { root: number; window: number; step: number } | null {
    if (this.root === 0 || !this.tree.tasks.has(this.root)) return null;
    const win = this.mem.read32(this.tree.tasks.get(this.root)!.children) >>> 0;
    return {
      root: this.mem.read32(this.root + 0x0c) | 0,
      window: win ? this.mem.read32(win + 0x10) | 0 : -1,
      step: win ? this.mem.read32(win + 0x0c) | 0 : -1,
    };
  }

  /** The exit request words the closing screen wrote (ctx+0x26C8 / +0x26D0). */
  transition(): [number, number] {
    return [this.mem.read32(MEMCARD_SAVE + 0x26c8) | 0, this.mem.read32(MEMCARD_SAVE + 0x26d0) | 0];
  }

  /** The last result code the machine stored (screen +0x68 of the window), for diagnostics. */
  header(): number { return this.mem.read32(SHARED + 0x0c) >>> 0; }

  /**
   * Both item count arrays as the save context holds them right now — the state
   * a load has just copied a 0x26C4-byte image over, so this is what the card
   * gave back for every one of the 402 ids.
   */
  bagEntries(): ItemCountEntry[] { return readItemArrays(this.mem, MEMCARD_SAVE); }

  /** The BIT word the context carries (state 0x33's image has just put it there). */
  bits(): number { return this.mem.read32(MEMCARD_MONEY) >>> 0; }

  dispose(): void { this.tree.dispose(this.bootTask); }
}

export { MEMCARD_SAVE_HEADER_RECORD };
