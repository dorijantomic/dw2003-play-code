// Frame owner for the translated training gym (pro/stgtrain): the screen where a partner
// trains its statistics. It composes the registered ports into one task tree and supplies the
// services they call. No PlayStation instruction is executed.
//
// The screen's own routines, all translated and each proved against the original by a lane-b
// oracle: boot chain and closing panel (native/gym-boot.ts), the screen root and its flow machine
// (gym-screen.ts, gym-flow.ts), the HUD fills and the partner pods (gym-hud.ts,
// gym-partner-draw.ts, native/gym-hud-delta.ts), the drill picker (native/gym-picker.ts), the
// confirm panel (native/gym-confirm.ts), the training session (native/gym-training.ts), the rep
// actor and the two sprite actors that play the TRANIN scripts (native/gym-rep-actor.ts,
// native/gym-actor.ts), the stat rolls (native/gym-rolls.ts), the TRANIN pack services
// (native/gym-packs.ts) and the window fold pair (window-fold.ts).
//
// Service map, each an existing translated provider or a documented platform one:
//   object factory F0x80014504       -> TranslatedTaskTree.allocate (zeroing, registers the class)
//   default methods +0x28..+0x44     -> TranslatedTaskTree defaults
//   text widgets F0x8001AE38 + slots -> ShopWidgetServices / dispatchWidgetMethod
//   cursor icon F0x8001B364          -> ShopWidgetServices.spawnUiIcon
//   text glyph tick                  -> textRevealTick + drawTextElement (glyphs painted by the browser)
//   text bank [0x80044F4C](lang+0x10B) -> ScreenTextBanks (data-only indexed text)
//   pad service [0x8004B7D0+0x3F4/3F8/3FC/408] -> ScreenPad pressed / held / repeated; identity map
//   window fold [0x8008D2B0/B4]      -> window-fold.ts (start also plays 0x40019 / 0x4001A)
//   party ctx+0x2718 / +0x2750       -> party-context.ts; ctx+0x2734 -> effective-stats.ts
//                                       buildEffectiveStats (equipment through item-record.ts)
//   rank group [0x8004B43C]          -> the word at 0x8004B404 (F0x80016B78), seeded by the adapter
//   previous screen [0x8004B448]     -> the word at 0x8004B400 (F0x80016B58): the map the player left
//   screen return ctx+0x270C         -> party-context.ts requestScreenTransition
//   resource cache [0x80044F44], [0x80044F3C], [0x80044B38+0x414] -> resource-service.ts
//        cacheAcquire / cachePoll / resourceGetBase over the shipped TRANIN files
//   upload context F0x8001FFA8 and its +0x20/+0x24/+0x28 slots -> card-view.ts cardViewHelper*
//   LoadImage F0x80025B14            -> platform GPU: recorded in a VramMap (the browser samples it)
//   heap [0x8004B5F4] / [0x8004B5EC] / zero-fill [0x8004B600] -> platform: ShopWidgetArena
//   picture service F0x8001F648      -> ShopDrawIntents (recorded, painted by the browser)
//   sprite-actor primitives          -> platform GPU: recorded as gymMode / gymSprite / gymQuad draw
//                                       calls in the same list; the browser rasterises them from VRAM
//   frame counter [0x8004DE10+0x188] -> the display clock's tick
//   packed sound [0x80055C48/50]     -> platform: host.playSound / host.stopSound
//   display service +0x150/154/174/16C/180 -> platform: recorded in `displayCalls`
//   audio archive request/poll [0x80055C54] [0x80055C60] -> platform: the archive is always resident
//   RAND_U16 [0x8004DC0C]            -> platform: host.rand (the walker's engine RAND_U16). The
//        loss roll's [0x8004DC04 + 8] is the same cell, not a second generator.
//   fade primitive F0x80085F7C       -> platform: recorded as `dim`, painted by the browser
//
// Authority (who commits the result). The session changes only the partner's private roster
// record (the TP cost, the six stats, the seven element points, max HP and max MP, and the
// remembered Ultra drill byte). The walker reads them back ONCE, after the screen has closed
// (record()), and commits the difference to its own model.
import { MAX_ROSTER_SLOTS } from "../roster.ts";
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import { VramMap } from "../../native/vram.ts";
import type { PadButton } from "../../systems/input-map.ts";
import {
  PARTY_CONTEXT, PARTY_MAP, ROSTER_EQUIP_OFFSETS_LIST, ROSTER_RECORDS, ROSTER_STRIDE,
  partyPositionToRosterSlot, persistentRosterSlot,
  requestScreenTransition, rosterRecordAddress
} from "../party-context.ts";
import { buildEffectiveStats } from "../effective-stats.ts";
import { itemRecord } from "../item-record.ts";
import {
  cacheAcquire, cachePoll, cacheServicePending, freeCacheSlotBlock, resourceGetBase, FRAME_CLOCK_CELL,
  LBA_LEN_SECTORS, type CacheServiceHost,
} from "../resource-service.ts";
import { installItemTables, type ShopCatalogData } from "./shop-catalog.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { LOGICAL_BUTTON_TABLE, rescanVisibleWindow, textRevealTick } from "./text-window.ts";
import { createResidentTextServices, loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { getUnkC3, isState1, setTextScroll } from "./text-element-setters.ts";
import {
  cardViewHelperInit, cardViewHelperSetPairA, cardViewHelperSetPairB, cardViewHelperUpload,
  type CardViewHost,
} from "./card-view.ts";
import { reportFadeStart, reportFadeTick, type ReportFadeHost } from "./native/fight-report-fade.ts";
import { PROFILE_ROWS, PROFILE_TABLE_BASE } from "./native/pause-status.ts";
import { gymScreenConstruct, gymScreenTick, GYM_SCREEN_HANDLER, type GymScreenTickHost } from "./gym-screen.ts";
import { gymFlowTick, type GymFlowHost } from "./gym-flow.ts";
import { gymHudConstruct, type GymHudHost } from "./gym-hud.ts";
import { gymPartnerHudDraw, type GymPartnerDrawHost } from "./gym-partner-draw.ts";
import { gymBindRankPack } from "./gym-rank-pack.ts";
import {
  GYM_BOOT_HANDLER, GYM_PANEL_HANDLER, GYM_PANEL_START_SLOT, gymBootTick, gymEntryCreate, gymPanelCreate,
  type GymBootHost,
} from "./native/gym-boot.ts";
import { gymHudDeltaFill } from "./native/gym-hud-delta.ts";
import {
  GYM_PICKER_HANDLER, gymPickerClose, gymPickerCreate, gymPickerDrillText, gymPickerOpen, gymPickerTick,
} from "./native/gym-picker.ts";
import { GYM_CONFIRM_HANDLER, gymConfirmCreate, gymConfirmDismiss, gymConfirmTick } from "./native/gym-confirm.ts";
import {
  GYM_TRAINING_HANDLER, gymTrainingCreate, gymTrainingTick, type GymTrainingHost,
} from "./native/gym-training.ts";
import {
  GYM_REP_HANDLER, gymRepClosingPose, gymRepCreate, gymRepGrowIn, gymRepHoldBoth, gymRepResult, gymRepResume,
  gymRepSetClutOrigin, gymRepSetHitPercent, gymRepSetPageOrigin, gymRepSetScale, gymRepShrinkOut, gymRepTick,
} from "./native/gym-rep-actor.ts";
import {
  GYM_ACTOR_HANDLER, gymActorCreate, gymActorHold, gymActorIsDone, gymActorSetClut, gymActorSetData,
  gymActorSetLayer, gymActorSetOrigin, gymActorSetPage, gymActorSetPivot, gymActorSetRotation,
  gymActorSetScale, gymActorSetScript, gymActorTick, type GymActorHost,
} from "./native/gym-actor.ts";
import { applyMatrixXY, rotMatrixZero, scaleMatrix } from "./native/gym-gte.ts";
import {
  GYM_PACKS, gymPackBase, gymPackClips, gymPackDataOffset, gymPackFile, gymPackOrigin, gymPackParse,
  gymPackPreload, gymPackPropsFlag, gymPackScript, gymPackUpload, type GymPackHost,
} from "./native/gym-packs.ts";
import { GYM_PACK_STTRNG3, type GymDrawHost, type GymUiHost } from "./native/gym-host.ts";

export const GYM_TABLES_BASE = 0x8008c224;
export const GYM_SPECIES_BASE = PROFILE_TABLE_BASE;
export const GYM_TEXT_BANK = 0x10b;
export const GYM_LANGUAGE_CELL = 0x8005cca8;
/** The resident cells the gym's two transition getters read (F0x80016B78, F0x80016B58). */
export const GYM_RANK_GROUP_CELL = 0x8004b404;
export const GYM_PREVIOUS_SCREEN_CELL = 0x8004b400;
export const GYM_PARTY_SLOTS = 3;
/** The six equip halfwords of a roster record, in the original's order. */
const RECORD_EQUIPMENT = ROSTER_EQUIP_OFFSETS_LIST;
/** The remembered Ultra Training drill: byte at stats block + 0x3CC (record + 0x3D4). */
export const GYM_ULTRA_BYTE = 0x3d4;

export interface GymPackResource { id: number; sectors: number; data: Uint8Array }

export interface GymResources {
  /** The overlay's data tail from 0x8008C224 (routine slots zeroed). */
  tables: Uint8Array;
  /**
   * The Digimon profile records from 0x8003EF5C: the ONE cut every screen showing a
   * Digimon loads (assets/data/digimon_profiles.bin). All PROFILE_ROWS of them, because
   * that is the table's length; the gym's own readers walk the original's 52.
   */
  profiles: Uint8Array;
  /** The resident signature-set tables: the set ids from 0x8004B53C then the bonuses. */
  signature: Uint8Array;
  signatureBase: number;
  textButtons: Uint8Array;
  font: Uint8Array;
  /**
   * The resident cursor glyph table (0x8004DCE0) and its strings (0x8005CCD0). Optional: the
   * shared resident load supplies the decoded table by default, so a caller need not forward
   * it. Without it the cursor child builds a null string and draws nothing.
   */
  cursorGlyphs?: CursorGlyphTable;
  /** Text banks by id: language + 0x10B. */
  banks: ReadonlyMap<number, Uint8Array>;
  /** The TRANIN files by disc index. */
  packs: ReadonlyMap<number, GymPackResource>;
  catalog: ShopCatalogData;
  itemRecords: Uint8Array;
  descriptors: readonly Uint8Array[];
}

export interface GymMember {
  /** The party position 0..2 (contiguous from 0). */
  position: number;
  /** The roster slot (also the TRANIN trainee category 0..7). */
  rosterSlot: number;
  starterSlot?: number;
  nameBytes: readonly number[];
  level: number;
  tp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  core: readonly number[];
  elements: readonly number[];
  equipment?: { head?: number; body?: number; right?: number; left?: number; acc0?: number; acc1?: number };
  /** The drill the last won Ultra Training Chance trained; 0 for none. */
  lastUltraDrill: number;
}

export interface GymSeed {
  language: number;
  /** The rank group the gym's greeter asked for (0..13). */
  group: number;
  /** The map the player came from (F0x80016B58); selects the gym's scene plate. */
  previousScreen: number;
  members: readonly GymMember[];
}

export interface GymHost {
  playSound(id: number): void;
  stopSound?(id: number, channel: number): void;
  /** F0x8001933C RAND_U16: a 16-bit random value. */
  rand(): number;
}

export interface GymDim { layer: number; bucket: number; level: number }
export interface GymDisplayCall { call: string; args: number[] }

/** A partner's private record as the screen left it. */
export interface GymRecord {
  level: number; tp: number; hp: number; maxHp: number; mp: number; maxMp: number;
  core: number[]; elements: number[]; lastUltraDrill: number;
}

const SCRATCH_BYTES = 0x40;
const PACK_ARENA = { first: 0x80130000, limit: 0x801e0000 } as const;

/**
 * Platform heap for the TRANIN files and their decode scratch (the resident heap
 * [0x8004B5F4] / [0x8004B5EC]): first fit from a free list, else a bump pointer. The widget
 * arena caps a block at 0x10000 bytes; a TRANIN file is up to 0x3A800.
 */
class PackHeap {
  private next: number;
  private readonly sizes = new Map<number, number>();
  private readonly freed: Array<{ address: number; size: number }> = [];
  private readonly mem: NativeMemory;
  private readonly limit: number;
  constructor(mem: NativeMemory, limit: number, first: number) { this.mem = mem; this.limit = limit; this.next = first; }
  alloc(size: number, align = 4): number {
    const length = (size + 3) & ~3;
    const reused = this.freed.findIndex((block) => block.size >= length && block.address % align === 0);
    let address: number;
    if (reused >= 0) address = this.freed.splice(reused, 1)[0]!.address;
    else {
      address = ((this.next + align - 1) & ~(align - 1)) >>> 0;
      this.next = address + length;
      if (this.next > this.limit) throw new Error("Gym pack storage exhausted");
    }
    this.mem.bytes.fill(0, address & 0x1fffff, (address & 0x1fffff) + length);
    this.sizes.set(address, length);
    return address;
  }
  free(address: number): void {
    const size = this.sizes.get(address >>> 0);
    if (size === undefined) throw new Error(`Unknown gym pack buffer ${address.toString(16)}`);
    this.sizes.delete(address >>> 0);
    this.freed.push({ address: address >>> 0, size });
  }
}
const PANEL_FRAMES = 0x1e;

export class GymSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  readonly vram = new VramMap();
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  /** The ids this screen asked the shared queue for. */
  get sounds(): number[] { return this.audio.sounds; }
  readonly displayCalls: GymDisplayCall[] = [];
  readonly loadedBanks: number[] = [];
  readonly uploads: Array<{ x: number; y: number; w: number; h: number }> = [];
  readonly language: number;
  /** The boot task: the tree's root. The gym screen itself is its child. */
  readonly bootTask: number;
  private root = 0;
  private dim: GymDim | null = null;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly seed: GymSeed;
  private readonly playHost: GymHost;
  private readonly revealHost: Parameters<typeof textRevealTick>[1];
  private readonly packArena: PackHeap;
  private readonly cacheHost: CacheServiceHost & { clock(): number; busyGate(): number };
  private readonly packs: ReadonlyMap<number, GymPackResource>;
  private readonly methods = new Map<number, Map<number, (object: number, args: number[]) => number>>();
  private readonly proj: number;
  private readonly projScratch: number;
  private readonly uploadContext: number;
  private requestedFile = 0;
  private frame = 0;
  private channel = 0;
  private exitAnnounced = false;
  private readonly arenaScratch: number;

  constructor(seed: GymSeed, resources: GymResources, host: GymHost) {
    const language = seed.language;
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid gym language");
    if (!Number.isInteger(seed.group) || seed.group < 0 || seed.group > 13) throw new Error("Invalid gym rank group");
    if (seed.members.length === 0 || seed.members.length > GYM_PARTY_SLOTS) throw new Error("Invalid gym party size");
    seed.members.forEach((member, i) => {
      if (member.position !== i) throw new Error("Gym party positions must be contiguous from 0");
      if (!Number.isInteger(member.rosterSlot) || member.rosterSlot < 0 || member.rosterSlot >= MAX_ROSTER_SLOTS) {
        throw new Error("Invalid gym roster slot");
      }
    });
    this.language = language;
    this.seed = seed;
    this.playHost = host;
    this.packs = resources.packs;
    const mem = this.mem;

    // Data-only installation.
    if (resources.textButtons.length !== 20) throw new Error("Invalid gym wait-button table");
    if (resources.profiles.length !== PROFILE_ROWS * 0x58) throw new Error("Invalid Digimon profile table");
    loadResidentResources(mem, { font: resources.font,
      ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
      { base: GYM_TABLES_BASE, bytes: resources.tables },
      { base: GYM_SPECIES_BASE, bytes: resources.profiles },
      { base: resources.signatureBase, bytes: resources.signature },
      { base: LOGICAL_BUTTON_TABLE, bytes: resources.textButtons },
    ] });
    installItemTables(mem, resources.catalog, resources.itemRecords, resources.descriptors);
    this.banks = new ScreenTextBanks(mem, language, [GYM_TEXT_BANK], resources.banks, "gym");
    this.widgets = new ShopWidgetServices(mem, this.banks as never);
    mem.write32(GYM_LANGUAGE_CELL, language);
    this.seedSave(seed);
    this.packArena = new PackHeap(mem, PACK_ARENA.limit, PACK_ARENA.first);
    for (const pack of resources.packs.values()) mem.write16(LBA_LEN_SECTORS + pack.id * 2, pack.sectors);
    this.cacheHost = {
      alloc: (size) => this.packArena.alloc(size, 4),
      startTransfer: (id, buffer) => {
        const pack = this.packs.get(id & 0xffff);
        if (!pack) throw new Error(`Unknown gym resource ${id.toString(16)}`);
        mem.load(pack.data.subarray(0, Math.min(pack.data.length, pack.sectors << 11)), buffer);
      },
      clock: () => this.frame,
      busyGate: () => 0, // Platform: the disc service is never mid-command between display ticks.
    };
    this.arenaScratch = this.widgets.arena.alloc(SCRATCH_BYTES, 4);
    this.proj = this.widgets.arena.alloc(0x40, 4);
    this.projScratch = this.widgets.arena.alloc(0x40, 4);
    this.uploadContext = this.widgets.arena.alloc(0x34, 4);

    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Gym", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed(),
      stringById: (bank, id) => this.banks.stringById(mem, bank, id),
    }).revealHost;

    const alloc = (handler: number, size: number, extra: number): number => this.tree.allocate(handler, size, extra);
    const classes = new Map<number, TranslatedTaskClass>();
    const bootHost = this.bootHost();
    const ui = this.uiHost();
    const drawHost = this.drawHost();
    const trainingHost = this.trainingHost(ui, alloc);
    const fadeHost = this.fadeHost();
    classes.set(GYM_BOOT_HANDLER, {
      name: "gym boot", childSlots: [0], terminalTick: true,
      tick: (task, children) => gymBootTick(mem, task, children, bootHost),
    });
    classes.set(GYM_SCREEN_HANDLER, {
      name: "gym screen", childSlots: [0x70, 0x74, 0x78, 0x7c], terminalTick: true,
      tick: (screen, hud) => gymScreenTick(mem, screen, hud, this.screenHost(screen, hud, ui, drawHost, alloc)),
    });
    classes.set(GYM_PANEL_HANDLER, {
      name: "gym panel", childSlots: [], terminalTick: true,
      tick: (panel) => reportFadeTick(mem, panel, fadeHost),
    });
    classes.set(GYM_PICKER_HANDLER, {
      name: "gym picker", childSlots: [],
      tick: (picker, children) => gymPickerTick(mem, picker, children, { ...ui, ...drawHost, advance: (o) => this.tree.callMethod(o, 0x38) }),
    });
    classes.set(GYM_CONFIRM_HANDLER, {
      name: "gym confirm", childSlots: [],
      tick: (confirm, children) => gymConfirmTick(mem, confirm, children, { ...ui, ...drawHost, advance: (o) => this.tree.callMethod(o, 0x38) }),
    });
    classes.set(GYM_TRAINING_HANDLER, {
      name: "gym training", childSlots: [0x18],
      tick: (window, children) => gymTrainingTick(mem, window, children, { ...trainingHost, ...drawHost }),
    });
    classes.set(GYM_REP_HANDLER, {
      name: "gym rep", childSlots: [0, 4],
      tick: (rep, children) => gymRepTick(mem, rep, children, this.repHost(ui, alloc)),
    });
    classes.set(GYM_ACTOR_HANDLER, {
      name: "gym sprite actor", childSlots: [],
      tick: (actor) => gymActorTick(mem, actor, this.actorHost()),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.registerMethods(ui, drawHost, fadeHost);
    this.bootTask = gymEntryCreate({ alloc });
  }

  // ── seeding ────────────────────────────────────────────────────────────────

  private seedSave(seed: GymSeed): void {
    const mem = this.mem;
    for (let i = 0; i < GYM_PARTY_SLOTS; i++) {
      const member = seed.members[i];
      mem.write32(PARTY_MAP + i * 4, member ? member.rosterSlot >>> 0 : 0xffffffff);
    }
    mem.write32(GYM_RANK_GROUP_CELL, seed.group >>> 0);
    mem.write32(GYM_PREVIOUS_SCREEN_CELL, seed.previousScreen >>> 0);
    for (const member of seed.members) {
      const record = rosterRecordAddress(member.rosterSlot);
      mem.write32(record, ((member.starterSlot ?? member.rosterSlot) + 3) >>> 0);
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
      mem.write8(record + GYM_ULTRA_BYTE, member.lastUltraDrill & 0xff);
      member.nameBytes.slice(0, 23).forEach((byte, i) => mem.write8(record + 0x08 + i, byte & 0xff));
      mem.write8(record + 0x08 + Math.min(23, member.nameBytes.length), 0);
    }
  }

  // ── platform services ─────────────────────────────────────────────────────

  private playSound(id: number): number {
    this.audio.play(id);
    this.playHost.playSound(id);
    this.channel = (this.channel + 1) & 0x7fff;
    return this.channel;
  }

  private text(offset: number): number { return this.banks.source(this.language + offset); }

  private note(call: string, ...args: number[]): void { this.displayCalls.push({ call, args }); }

  private bootHost(): GymBootHost {
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
      displayLink: (id, parent, flag) => this.note("displayLink", id, parent, flag),
      createRoot: () => {
        this.root = gymScreenConstruct(this.mem, {
          allocScreen: (handler, size, extra) => this.tree.allocate(handler, size, extra),
          currentMapId: () => this.mem.read32(GYM_PREVIOUS_SCREEN_CELL) | 0,
        });
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

  /** The draw context: every picture call is recorded and painted by the browser. */
  private drawHost(): GymDrawHost {
    return {
      initDrawContext: this.draw.initDrawContext,
      setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin,
      setScale: this.draw.setScale,
      setPos: this.draw.setPos,
      paletteShift: this.draw.paletteShift,
      drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
      frameTick: () => this.frame,
    };
  }

  private fileHost(): Pick<GymPackHost, "zeroFill" | "requestFile" | "fileLoading" | "fileBase"> {
    const mem = this.mem;
    return {
      zeroFill: (dest, bytes) => mem.bytes.fill(0, dest & 0x1fffff, (dest & 0x1fffff) + bytes),
      requestFile: (id) => {
        // Platform: the resident cache reuses its buffers; the browser's one arena gives the
        // previous drill's file back before the next is requested.
        if (this.requestedFile !== 0 && this.requestedFile !== id) {
          freeCacheSlotBlock(mem, this.requestedFile, { freeBlock: (buffer) => this.packArena.free(buffer) });
        }
        this.requestedFile = id;
        cacheAcquire(mem, id, this.cacheHost);
      },
      fileLoading: (id) => cachePoll(mem, id, this.cacheHost),
      fileBase: (id) => resourceGetBase(mem, id, this.cacheHost),
    };
  }

  private packHost(): GymPackHost {
    const mem = this.mem;
    const cardHost: CardViewHost = {
      resourceGetBase: (id) => resourceGetBase(mem, id, this.cacheHost),
      loadImage: (x, y, w, h, data) => {
        this.uploads.push({ x, y, w, h });
        this.vram.upload(x, y, w, h, data, 16, false, (a) => mem.read8(a),
          (a, dest) => dest.set(mem.bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + dest.length)));
      },
      findRegisteredHandleByKey: () => { throw new Error("Gym: registered views are not used"); },
      callViewMethod: () => { throw new Error("Gym: view methods are not used"); },
    };
    return {
      ...this.fileHost(),
      contextInit: () => cardViewHelperInit(mem, this.uploadContext),
      setImageDestination: (x, y) => cardViewHelperSetPairA(mem, x, y),
      setClutDestination: (x, y) => cardViewHelperSetPairB(mem, x, y),
      upload: (tim) => cardViewHelperUpload(mem, cardHost, tim),
      alloc: (size) => this.packArena.alloc(size, 2),
      free: (ptr) => this.packArena.free(ptr),
    };
  }

  private uiHost(): GymUiHost {
    const mem = this.mem;
    const foldStart = (fold: number, open: number): void => {
      windowFoldStart(mem, fold, open);
      this.playSound(open ? 0x40019 : 0x4001a);
    };
    return {
      textSource: () => this.text(GYM_TEXT_BANK),
      createText: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
      createCursor: (target, order, x, y) => this.widgets.spawnUiIcon(target, order, x, y),
      textSet: (widget, source, id) => this.widgets.textSet(widget, source, id),
      textNumber: (widget, line, value) => this.widgets.textNumber(widget, line, value),
      textFormat: (widget, source, id, line) => this.widgets.textFormat(widget, source, id, line),
      textRescan: (widget) => rescanVisibleWindow(mem, widget),
      textOrigin: (widget, x, y) => dispatchWidgetMethod(mem, this.widgets, widget, 0x134, [x, y]),
      textScroll: (widget, mode) => setTextScroll(mem, widget, mode),
      textColour: (widget, code) => this.widgets.textColour(widget, code),
      textShow: (widget, visible) => this.widgets.textShow(widget, visible),
      textFlag: (widget, value) => this.widgets.textFlagBF(widget, value),
      textDone: (widget) => getUnkC3(mem, widget),
      textWaiting: (widget) => isState1(mem, widget),
      cursorShow: (cursor, visible) => this.widgets.cursorShow(cursor, visible),
      cursorPlace: (cursor, x, y) => this.widgets.cursorPlace(cursor, x, y),
      padPressed: () => this.pad.pressed(),
      padHeld: () => this.pad.held(),
      padRepeat: () => this.pad.repeated(),
      padBit: (logical) => logical,
      playSound: (id) => this.playSound(id),
      stopSound: (id, channel) => this.playHost.stopSound?.(id, channel),
      foldStart,
      foldTick: (fold) => windowFoldTick(mem, fold),
      rosterSlot: (position) => partyPositionToRosterSlot(mem, position),
      recordBlock: (slot) => persistentRosterSlot(slot),
      projectionScratch: () => this.projScratch,
      copyProjection: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
      rankGroup: () => mem.read32(GYM_RANK_GROUP_CELL) | 0,
      setState0: (target, value) => this.tree.callMethod(target, 0x28, [value]),
    };
  }

  private trainingHost(ui: GymUiHost, alloc: (h: number, s: number, e: number) => number): GymTrainingHost {
    const mem = this.mem;
    return {
      ...ui,
      alloc,
      rand: () => this.playHost.rand() & 0xffff,
      call: (target, slot, args) => this.call(target, slot, args),
      createRepActor: (category, drill, layer, bucket) => gymRepCreate(mem, { alloc }, category, drill, layer, bucket),
    };
  }

  private repHost(ui: GymUiHost, alloc: (h: number, s: number, e: number) => number) {
    const mem = this.mem;
    const packHost = this.packHost();
    return {
      rand: () => this.playHost.rand() & 0xffff,
      filePending: (file: number) => cachePoll(mem, file, this.cacheHost),
      createActor: () => gymActorCreate(mem, { alloc }),
      actor: (actor: number, slot: number, args: number[]) => this.call(actor, slot, args),
      advance: (self: number) => this.tree.callMethod(self, 0x38),
      advanceState1: (self: number) => this.tree.callMethod(self, 0x3c),
      setState1: (self: number, value: number) => this.tree.callMethod(self, 0x2c, [value]),
      setState0: (target: number, value: number) => this.tree.callMethod(target, 0x28, [value]),
      packFile: (drill: number) => gymPackFile(mem, drill),
      packOrigin: (drill: number) => gymPackOrigin(mem, drill),
      packPropsFlag: (drill: number) => gymPackPropsFlag(mem, drill),
      packParse: (category: number) => gymPackParse(mem, category),
      packUpload: (category: number, params: number) => gymPackUpload(mem, category, params, packHost),
      packClips: (category: number) => gymPackClips(mem, category),
      packDataOffset: (category: number) => gymPackDataOffset(mem, category),
      packScript: (category: number, index: number) => gymPackScript(mem, category, index),
      ui,
    };
  }

  private actorHost(): GymActorHost {
    const mem = this.mem;
    return {
      frameTick: () => this.frame,
      advance: (actor) => this.tree.callMethod(actor, 0x38),
      orderingSlot: (target, bucket) => {
        this.draw.setLayer(target, bucket);
        return { view: target, slot: bucket };
      },
      drawMode: (tpage) => { this.draw.calls.push({ method: "gymMode", args: [tpage] }); },
      sprite: (p) => { this.draw.calls.push({ method: "gymSprite", args: [p.x, p.y, p.u, p.v, p.w, p.h, p.clut, p.code] }); },
      quad: (q) => {
        this.draw.calls.push({ method: "gymQuad", args: [...q.x, ...q.y, ...q.u, ...q.v, q.clut, q.tpage, q.code] });
      },
      flush: () => {},
      rotMatrix: (angles, matrix) => rotMatrixZero(mem, angles, matrix),
      scaleMatrix: (matrix, scale) => scaleMatrix(mem, matrix, scale),
      applyMatrix: (matrix, x, y) => applyMatrixXY(mem, matrix, x, y),
    };
  }

  /** The object methods whose translated bodies return a value or take arguments. */
  private registerMethods(ui: GymUiHost, drawHost: GymDrawHost, fadeHost: ReportFadeHost): void {
    const mem = this.mem;
    const alloc = (handler: number, size: number, extra: number): number => this.tree.allocate(handler, size, extra);
    const put = (handler: number, table: Array<[number, (object: number, args: number[]) => number]>): void => {
      this.methods.set(handler, new Map(table));
    };
    const repHost = this.repHost(ui, alloc);
    put(GYM_SCREEN_HANDLER, [[0x110, (screen, args) => {
      gymHudDeltaFill(mem, screen, args[0] ?? 0, this.hudHost(ui), this.proj);
      return 0;
    }]]);
    put(GYM_PANEL_HANDLER, [[GYM_PANEL_START_SLOT, (panel, args) => { reportFadeStart(mem, panel, args[0]!, args[1]!, fadeHost); return 0; }]]);
    put(GYM_PICKER_HANDLER, [
      [0x108, (p) => { gymPickerOpen(mem, p); return 0; }],
      [0x10c, (p) => { gymPickerClose(mem, p); return 0; }],
      [0x110, (p) => { gymPickerDrillText(mem, p, this.tree.tasks.get(p)!.children, 1, ui); return 0; }],
    ]);
    put(GYM_CONFIRM_HANDLER, [[0xf8, (c) => { gymConfirmDismiss(mem, c); return 0; }]]);
    put(GYM_REP_HANDLER, [
      [0xa4, (a, args) => { gymRepSetPageOrigin(mem, a, args[0]!, args[1]!); return 0; }],
      [0xa8, (a, args) => { gymRepSetClutOrigin(mem, a, args[0]!, args[1]!); return 0; }],
      [0xac, (a, args) => { gymRepSetHitPercent(mem, a, args[0]!); return 0; }],
      [0xb0, (a) => { gymRepGrowIn(mem, a); return 0; }],
      [0xb4, (a) => { gymRepShrinkOut(mem, a); return 0; }],
      [0xb8, (a) => { gymRepResume(mem, a, repHost); return 0; }],
      [0xbc, (a) => { gymRepHoldBoth(mem, a, repHost); return 0; }],
      [0xc0, (a, args) => { gymRepSetScale(mem, a, args[0]!); return 0; }],
      [0xc4, (a) => gymRepResult(mem, a)],
      [0xc8, (a) => { gymRepClosingPose(mem, a); return 0; }],
    ]);
    put(GYM_ACTOR_HANDLER, [
      [0xe0, (a, args) => gymActorSetData(mem, a, args[0]!, args[1]!)],
      [0xe4, (a, args) => { gymActorSetScript(mem, a, args[0]!); return 0; }],
      [0xe8, (a, args) => { gymActorSetOrigin(mem, a, args[0]!, args[1]!); return 0; }],
      [0xec, (a, args) => { gymActorSetPage(mem, a, args[0]!, args[1]!); return 0; }],
      [0xf0, (a, args) => { gymActorSetLayer(mem, a, args[0]!, args[1]!); return 0; }],
      [0xf4, (a, args) => { gymActorSetClut(mem, a, args[0]!, args[1]!); return 0; }],
      [0xf8, (a, args) => { gymActorSetScale(mem, a, args[0]!, args[1]!, args[2]!); return 0; }],
      [0xfc, (a, args) => { gymActorSetPivot(mem, a, args[0]!, args[1]!); return 0; }],
      [0x100, (a, args) => { gymActorSetRotation(mem, a, args[0]!, args[1]!, args[2]!); return 0; }],
      [0x104, (a) => gymActorIsDone(mem, a)],
      [0x108, (a, args) => gymActorHold(mem, a, args[0]!)],
    ]);
    void drawHost;
  }

  /** One method call on a task: a registered translated method, else the base state methods. */
  private call = (target: number, slot: number, args: number[]): number => {
    target >>>= 0;
    const task = this.tree.tasks.get(target);
    if (!task) throw new Error(`Gym: method ${slot.toString(16)} on a missing task ${target.toString(16)}`);
    const method = this.methods.get(task.classId)?.get(slot);
    if (method) return method(target, args) | 0;
    this.tree.callMethod(target, slot, args);
    return 0;
  };

  private hudHost(ui: GymUiHost): GymHudHost {
    const mem = this.mem;
    return {
      createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
      resolveText: (offset) => this.text(offset),
      rosterSlot: (position) => partyPositionToRosterSlot(mem, position),
      rosterHandle: (slot) => persistentRosterSlot(slot),
      copyProjection: (slot, dest) => ui.copyProjection(slot, dest),
      widgetSetLine0: (widget, source, index) => this.widgets.textSet(widget, source, index),
      widgetSetLineNumber: (widget, line, value) => this.widgets.textNumber(widget, line, value),
      widgetSetC0: (widget, code) => this.widgets.textColour(widget, code),
      widgetSetFlagC1: (widget, value) => this.widgets.textShow(widget, value),
      widgetMeasure: (widget, value) => { this.widgets.textMeasure(widget, value); },
    };
  }

  private screenHost(
    screen: number, hud: number, ui: GymUiHost, drawHost: GymDrawHost, alloc: (h: number, s: number, e: number) => number,
  ): GymScreenTickHost {
    const mem = this.mem;
    const hudHost = this.hudHost(ui);
    const packHost = this.packHost();
    const flowHost: GymFlowHost = {
      ...hudHost,
      padPressed: () => this.pad.pressed(),
      padRepeat: () => this.pad.repeated(),
      padBit: (logical) => logical,
      playSound: (id) => { this.playSound(id); },
      drillPicker: (s) => gymPickerCreate(mem, { alloc }, s),
      confirmScreen: (s) => gymConfirmCreate(mem, { alloc }, s),
      trainingSession: (s, slot, drill) => gymTrainingCreate(mem, { alloc, rankGroup: ui.rankGroup }, s, slot, drill),
      panel: () => gymPanelCreate(mem, { alloc }),
      closeConfirm: (child) => { this.call(child, 0xf8, []); },
      panelRun: (child, a1, a2) => { this.call(child, GYM_PANEL_START_SLOT, [a1, a2]); },
      preloadGym: (index) => { gymPackPreload(mem, index, packHost); },
      trainingOfferReady: () => ((gymPackBase(mem, packHost) | 0) !== 0 ? 1 : 0),
    };
    const partnerHost: GymPartnerDrawHost = {
      ...drawHost,
      rosterSlot: (position) => partyPositionToRosterSlot(mem, position),
    };
    return {
      backgroundPlate: () => gymBindRankPack({
        bindRect: (slot, x, y) => this.note("artworkRect", slot, x, y),
        bindPack: (slot, pack, a1) => this.note("artworkPack", slot, pack, a1),
        packResolve: this.draw.packResolve,
      }),
      requestTextBank: (id) => { this.loadedBanks.push(id); this.banks.source(id); },
      requestSoundArchive: (id) => this.note("soundArchive", id),
      textBankPending: (id) => { this.banks.source(id); return 0; },
      advancePhase: (s) => this.tree.callMethod(s, 0x38),
      gymHudConstruct: (s, h) => gymHudConstruct(mem, s, h, hudHost),
      rosterSlot: (position) => partyPositionToRosterSlot(mem, position),
      audioPending: () => 0, // Platform: the gym's sound archive is resident from the start.
      playSound: (id) => { this.playSound(id); },
      setPhase: (s, phase) => this.tree.callMethod(s, 0x28, [phase]),
      playSoundPhaseExit: (id) => { if (!this.exitAnnounced) this.playSound(id); this.exitAnnounced = true; },
      transitionSelector: () => mem.read32(PARTY_CONTEXT + 0x34),
      requestScreenTransition: (selector, arg) => requestScreenTransition(mem, selector, arg),
      languageIndex: () => mem.read32(GYM_LANGUAGE_CELL) | 0,
      flowTick: (s, h) => gymFlowTick(mem, s, h, flowHost, this.proj),
      partnerDraw: (s) => gymPartnerHudDraw(mem, s, partnerHost),
    };
    void screen; void hud;
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  /** One display tick. */
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.mem.write32(FRAME_CLOCK_CELL, this.frame);
    this.draw.beginFrame(this.frame);
    this.dim = null;
    this.pad.update(buttons, this.frame);
    cacheServicePending(this.mem, this.cacheHost);
    this.tree.tick(this.bootTask);
    // Advance every resident selection cursor after its owner ticked: the per-frame handler
    // F0x8001B0A4 is what builds the cursor's glyph child and plays the arrow. Without this
    // tick the cursor object exists but draws nothing (the same shared widget the shop, pause,
    // lab and memory-card screens run).
    this.widgets.tickCursors(this.frame);
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
  }

  /** True once the screen asked to leave (its root reached the closing state and left the tree). */
  finished(): boolean { return this.root !== 0 && !this.tree.tasks.has(this.root); }

  currentDim(): GymDim | null { return this.dim; }
  fadeLevel(): number { return this.dim?.level ?? 0; }

  /** The screen-return request the closing root wrote (ctx+0x26C8 / +0x26D0). */
  transition(): [number, number] {
    return [this.mem.read32(PARTY_CONTEXT + 0x26c8) | 0, this.mem.read32(PARTY_CONTEXT + 0x26d0) | 0];
  }

  /** The screen's own state words while it is alive, for diagnostics. */
  state(): { lifecycle: number; flow: number; pod: number; drill: number; tpChoice: number; picker: number; confirm: number; session: number } | null {
    if (this.root === 0 || !this.tree.tasks.has(this.root)) return null;
    const mem = this.mem;
    const hud = this.tree.tasks.get(this.root)!.children;
    return {
      lifecycle: mem.read32(this.root + 0x0c), flow: mem.read32(this.root + 0x10), pod: mem.read32(this.root + 0x68),
      drill: mem.read32(this.root + 0x78) | 0, tpChoice: mem.read32(this.root + 0x7c),
      picker: mem.read32(hud + 0x70) >>> 0, confirm: mem.read32(hud + 0x74) >>> 0, session: mem.read32(hud + 0x78) >>> 0,
    };
  }

  /** The training window's live counters while a session runs, else null. */
  training(): { step: number; rep: number; last: number; results: number[]; gains: number[]; losses: number[]; drill: number } | null {
    const hud = this.root !== 0 && this.tree.tasks.has(this.root) ? this.tree.tasks.get(this.root)!.children : 0;
    const window = hud === 0 ? 0 : this.mem.read32(hud + 0x78) >>> 0;
    if (window === 0 || !this.tree.tasks.has(window)) return null;
    const mem = this.mem;
    const words = (at: number): number[] => Array.from({ length: 5 }, (_, i) => mem.read32(window + at + i * 4) | 0);
    return {
      step: mem.read32(window + 0x10), rep: mem.read32(window + 0x14) | 0, last: mem.read32(window + 0x18) | 0,
      results: words(0x64), gains: words(0x78), losses: words(0x8c), drill: mem.read32(window + 0x60) | 0,
    };
  }

  /** The trained record as the screen left it (read once, after it closed). */
  record(position: number): GymRecord {
    const mem = this.mem;
    const slot = partyPositionToRosterSlot(mem, position);
    if (slot < 0) throw new Error("No partner at that gym position");
    const record = rosterRecordAddress(slot);
    const s16 = (v: number): number => (v << 16) >> 16;
    return {
      level: s16(mem.read16(record + 0x24)), tp: s16(mem.read16(record + 0x26)), hp: s16(mem.read16(record + 0x28)),
      maxHp: s16(mem.read16(record + 0x2a)), mp: s16(mem.read16(record + 0x2c)), maxMp: s16(mem.read16(record + 0x2e)),
      core: Array.from({ length: 6 }, (_, i) => s16(mem.read16(record + 0x30 + i * 2))),
      elements: Array.from({ length: 7 }, (_, i) => s16(mem.read16(record + 0x3c + i * 2))),
      lastUltraDrill: mem.read8(record + GYM_ULTRA_BYTE),
    };
  }

  /** Dispose of every task (the player left another way). */
  dispose(): void { this.tree.dispose(this.bootTask); }

  /** A draw-intent painter's view of the pack sheets the gym binds (for diagnostics). */
  static readonly ARTWORK_HANDLE = GYM_PACK_STTRNG3;
  static readonly PACKS_BASE = GYM_PACKS;
}
