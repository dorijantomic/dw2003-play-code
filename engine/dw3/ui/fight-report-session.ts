// Frame owner for the translated fight report (pro/stfgtrep): the results screen
// after a won battle, one row per partner with the EXP count-up, level-ups, DV form
// levels, learned techniques, a newly unlocked form, then the BIT and item payout.
//
// The screen's own routines are the registered ports in native/fight-report-*.ts
// (boot chain, root tick, state machine, row constructor and widgets, chrome,
// fade, the reward services) and ui/report-row.ts (row lifecycle, row state
// machine, count-up, flourish) and ui/fight-report-row.ts (row fill). This file
// composes them into one task tree and supplies the services they call. No
// PlayStation instruction is executed.
//
// Service map, each an existing translated provider or a documented platform one:
//   object factory F0x80014504       -> TranslatedTaskTree.allocate (zeroing, registers the class)
//   default methods +0x28..+0x44     -> TranslatedTaskTree defaults
//   text widgets F0x8001AE38 + slots -> ShopWidgetServices / dispatchWidgetMethod, plus the
//        message-window slots +0x120 (textFormat), +0x128 (rescanVisibleWindow),
//        +0x130 (setTextScroll), +0x168 (getUnkC3), +0x170 (isState1)
//   text glyph tick                  -> textRevealTick + drawTextElement (glyphs painted by the browser)
//   text banks lang+0x55/0x4E/0x6A/0xA2 -> ScreenTextBanks (data-only indexed text)
//   pad service [0x8004B7D0+0x3F4]   -> ScreenPad pressed; [+0x408] is the identity map
//   window fold [0x80089144/48]      -> window-fold.ts (start also plays 0x40019 / 0x4001A)
//   party services ctx+0x2718/0x2750 -> party-context.ts; +0x2738 validateEquippedForm; +0x2748
//        formEntryCopy; +0x273C setEquippedForms, +0x2740 acquiredForms, +0x2744 addForm,
//        +0x274C writeFormEntry (form-ledger-edit.ts); [0x8005CCA0] profileRecord
//   screen return ctx+0x270C         -> party-context.ts requestScreenTransition
//   reward slots [0x80089154..68]    -> native/fight-report-rewards.ts
//   picture service F0x8001F648      -> ShopDrawIntents (recorded, painted by the browser)
//   frame counter [0x8004DE10+0x188] -> the display clock's tick
//   packed sound [0x80055C48/50]     -> platform: host.playSound / host.stopSound (below)
//   display service +0x150/154/174/16C and view +0x12C -> platform: recorded in `displayCalls`
//   RAND_U16 [0x8004DC0C]            -> platform: host.rand (the walker's engine RAND_U16)
//   fade primitive F0x80083020       -> platform: recorded as `dim`, painted by the browser
//
// Platform contracts.
//   Sound: `playSound(id)` starts a one-shot cue and returns a channel token (any
//     non-negative 16-bit value); `stopSound(id, channel)` is best-effort, since the
//     browser cannot cancel a one-shot. The row keeps the token only to stop it later.
//   Display: the boot task asks the display service for a 320x240 screen, one view of kind
//     3 at priority 0x1000, and clears its colour to black. The browser canvas and the
//     recorded picture calls replace the GPU packet buffers, so the calls are recorded.
//   Dim: the fade object paints a flat subtractive quad at grey level [fade+0x5C] >> 8 over
//     the whole screen; the browser paints it after every picture call (fadeLevel()).
//   RAND_U16: the level-up stat rolls use it. The screen works on a private copy of the
//     record that is never read back into the walker (see below), so any source is valid.
//
// Authority (the "maths done twice" decision). The WALKER stays the authority for EXP,
// levels, form ledger, stats and techniques: web/battle.js applyParticipantProgress
// applies them exactly once, BEFORE the screen opens, on the walker's own data model
// (formLedger, dvexpByForm, stored stats, availableEvos, TP cap) which the roster record
// cannot represent in full. The screen is seeded with each partner's PRE-battle snapshot
// and replays the disc's own rules on its private roster record, so it DISPLAYS the same
// outcome (EXP count-up, "Level up!", form levels, new techniques) without writing any of
// it back. The only state it changes for the walker is what the disc's screen itself
// pays: the BIT (money) and the dropped item (held count), read back by result(). The
// verifier proves the two computations agree (final EXP and level equal the walker's).
import { MAX_ROSTER_SLOTS } from "../roster.ts";
import { NativeMemory } from "../../native/memory.ts";
import { PackedSoundCursor } from "../../systems/packed-sound.ts";
import type { PadButton } from "../../systems/input-map.ts";
import { frameDelta } from "../../systems/frame-clock.ts";
import {
  PARTY_MAP, ROSTER_EQUIP_OFFSETS_LIST, ROSTER_RECORDS, ROSTER_STRIDE,
  partyPositionToRosterSlot, persistentRosterSlot,
  requestScreenTransition, rosterRecordAddress
} from "../party-context.ts";
import { validateEquippedForm } from "../form-ledger.ts";
import { acquiredForms } from "../form-ledger-edit.ts";
import {
  SAVE_BLOCK_BASE, ITEM_ID_MAX, HELD_MAX,
  heldArrayAddress, wornArrayAddress, writeItemArrays, readHeldByte, readItemArrays, type ItemCountEntry,
} from "../item-store.ts";
import { seedRosterForms, type RosterFormState } from "./roster-form-state.ts";
import { ScreenTextBanks } from "./screen-text-banks.ts";
import { ShopDrawIntents } from "./shop-draw-intents.ts";
import { ShopWidgetServices } from "./shop-widget-services.ts";
import { ScreenPad, dispatchWidgetMethod } from "./screen-services.ts";
import { TranslatedTaskTree, type TranslatedTaskClass } from "./translated-task-tree.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";
import { LOGICAL_BUTTON_TABLE, rescanVisibleWindow, textRevealTick } from "./text-window.ts";
import { createResidentTextServices, loadResidentResources, type CursorGlyphTable } from "./resident-text-host.ts";
import { getUnkC3, isState1, setTextScroll, setVectorAndActiveFlag } from "./text-element-setters.ts";
import { reportRowFill, type FightRowHost } from "./fight-report-row.ts";
import { reportRowLifecycle, type ReportRowLifecycleHost } from "./report-row.ts";
import {
  reportRowComputeScore, reportRowCreate, reportLevelWidgetsCreate, reportRowWidgetsCreate,
  reportRowMethod08, reportRowMethod14, reportRowMethod20, reportRowMethodE0,
  REPORT_ROW_EXTRA, REPORT_ROW_HANDLER, type ReportRowWidgetHost,
} from "./native/fight-report-row.ts";
import { reportChromeDraw, type ReportChromeHost } from "./native/fight-report-chrome.ts";
import { reportScreenOpen, type ReportOpenHost } from "./native/fight-report-open.ts";
import { reportScreenTick, type ReportScreenHost } from "./native/fight-report-screen.ts";
import { reportTick, type ReportTickHost } from "./native/fight-report-tick.ts";
import {
  REPORT_BOOT_HANDLER, REPORT_LANGUAGE_CELL, REPORT_ROOT_HANDLER, reportBanksReady, reportBootTick, reportEntryCreate,
  reportRootCreate, type ReportBootHost,
} from "./native/fight-report-boot.ts";
import {
  REPORT_FADE_HANDLER, REPORT_FADE_START_SLOT, reportFadeCreate, reportFadeStart,
  reportFadeTick, type ReportFadeHost,
} from "./native/fight-report-fade.ts";
import {
  reportAddExperience, reportDvGain, reportDvLadder, reportLearnTechnique, reportMakeLoadable,
  reportUnlockForm, type RewardHost,
} from "./native/fight-report-rewards.ts";
import { formEntryCopy } from "./native/pause-techniques.ts";
import { PROFILE_TABLE_BASE, PROFILE_ROWS, profileRecord } from "./native/pause-status.ts";

/**
 * The resident save context: money +0x6C, party map +0x70, and the two item
 * count arrays at +0x7C and +0x20F (engine/dw3/item-store.ts).
 *
 * Driver case 0x15 pays the dropped item by addressing the array with the FULL
 * id — `lh $v1, 0x2($s4)` / `addu $v1, $v1, $a0` / `lbu $v0, 0x7c($v1)` /
 * `sb` / `lb` / `slti 0x64` / `li 0x63` (stfgtrep.s:2844-2884) — so an id in the
 * 256..402 band (OverLoad 330, Goggles 332, …) is a real byte and not a masked
 * alias of a low id. Nothing in the original clips or wraps the id.
 */
export const REPORT_SAVE = SAVE_BLOCK_BASE;
export const REPORT_MONEY = REPORT_SAVE + 0x6c;
export const REPORT_HELD = heldArrayAddress(0, REPORT_SAVE);
export const REPORT_WORN = wornArrayAddress(0, REPORT_SAVE);
/** The report workspace the battle overlay fills (F0x800A7C00 / F0x800A69F0 / F0x800A6B18). */
export const REPORT_WORKSPACE = 0x80042b84;
export const REPORT_MONEY_CAP = 9_999_999;
export const REPORT_HELD_CAP = HELD_MAX;
export const REPORT_PARTY_SLOTS = 3;
export const REPORT_TABLES_BASE = 0x80086a88;
export const REPORT_TEXT_BANKS = [0x55, 0x4e, 0x6a, 0xa2] as const;
/** The six equip halfwords of a roster record (head, body, right, left, acc0, acc1). */
const RECORD_EQUIPMENT = ROSTER_EQUIP_OFFSETS_LIST;

/**
 * One newly learned form per partner per report.
 *
 * The report's record holds 44 ledger cells and is seeded with a PAGE of the partner's real
 * ledger (roster-form-state.ts seedRosterForms). A partner owning more than a page is normal
 * here — the extra roster adds species the disc's 44-row table never had — and when that page is
 * full addForm has nowhere to write the grant (F0x80017924 returns 0 on a full ledger), while the
 * row re-enters state 41 after every learned message: the same grant would be announced again and
 * again inside one report. The walker itself grants ONE form per battle (battle.js
 * nextUnlockedEvolution) and this screen replays that outcome, so the report must grant at most
 * one form per partner as well. The routine below stays byte-faithful to F0x8008634C; the rule
 * that the record is only a page lives here, at the report's own boundary.
 */
export function unlockOncePerReport(unlock: (slot: number) => number): (slot: number) => number {
  const granted = new Set<number>();
  return (slot) => {
    const at = slot | 0;
    if (granted.has(at)) return 0;
    const form = unlock(at) | 0;
    if (form !== 0) granted.add(at);
    return form;
  };
}

export interface FightReportResources {
  /** The overlay's data tail from 0x80086A88 (routine slots zeroed). */
  tables: Uint8Array;
  /**
   * The Digimon profile records from 0x8003EF5C: the ONE cut every screen showing a
   * Digimon loads (assets/data/digimon_profiles.bin). All PROFILE_ROWS of them, because
   * that is the table's length; this screen's own reader walks the original's 52
   * (PROFILE_SCAN_ROWS), so it reads no row the report could not read on the disc.
   */
  profiles: Uint8Array;
  /** The text engine's wait-for-button table at 0x8004DCCC. */
  textButtons: Uint8Array;
  font: Uint8Array;
  /** Banks by id: language + each of REPORT_TEXT_BANKS. */
  banks: ReadonlyMap<number, Uint8Array>;
  /** The resident cursor glyph table (0x8004DCE0); forwarded or the shared default. */
  cursorGlyphs?: CursorGlyphTable;
}

export interface FightReportMember {
  /** The party position 0..2 (positions must be contiguous from 0). */
  position: number;
  /** The roster slot of this partner (the species record index). */
  rosterSlot: number;
  starterSlot?: number;
  /** The record's raw name string (text codec bytes, no terminator). */
  nameBytes: readonly number[];
  exp: number;
  level: number;
  tp?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  core?: readonly number[];
  elements?: readonly number[];
  /** Worn equipment item ids: EXP Adapter 321 / BIT Adapter 322 are read from acc0 / acc1. */
  equipment?: { head?: number; body?: number; right?: number; left?: number; acc0?: number; acc1?: number };
  forms?: RosterFormState;
  /** Whether this partner took part in the battle (workspace +6 + position * 4). */
  participated: boolean;
  /** Which of the three equipped forms fought (workspace +7 + position * 4 + v). */
  formFlags?: readonly number[];
}

export interface FightReportSeed {
  language: number;
  /** Index into the overlay's reward table (12-byte records [dvexp, exp, bits]). */
  battleId: number;
  /** The dropped item id, 0 for none. */
  dropItemId: number;
  /** The party position the BIT payout is read for (workspace +4). */
  activePosition: number;
  bits: number;
  /**
   * The bag as the block's two arrays (`ctx+0x7C+id` carried, `ctx+0x20F+id`
   * worn) for every id 1..402. The payout only moves the carried byte of
   * `dropItemId`, but it reads it first, so the whole array has to be right.
   */
  bag: readonly ItemCountEntry[];
  members: readonly FightReportMember[];
}

export interface FightReportHost {
  playSound(id: number): void;
  stopSound?(id: number, channel: number): void;
  /** F0x8001933C RAND_U16: a 16-bit random value. */
  rand(): number;
}

/** One picture-service dim the fade object painted this tick. */
export interface FightReportDim { layer: number; bucket: number; level: number }
export interface FightReportDisplayCall { call: string; args: number[] }

/** A partner's private roster record as the screen left it (for proof, never read back). */
export interface FightReportRecord {
  exp: number; level: number; tp: number; maxHp: number; maxMp: number;
  core: number[]; elements: number[]; equipped: number[];
  ledger: { form: number; level: number; dvexp: number; tech: number[] }[];
}

const SCRATCH_BYTES = 0x40;

export class FightReportSession {
  readonly mem = new NativeMemory();
  readonly tree: TranslatedTaskTree;
  readonly widgets: ShopWidgetServices;
  readonly draw = new ShopDrawIntents(this.mem);
  /** The boot task: the tree's root. The report screen itself is its child. */
  readonly bootTask: number;
  /** The one shared packed-sound queue (F0x8002006C through [0x80055C48]). */
  private readonly audio = new PackedSoundCursor();
  /** The ids this screen asked the shared queue for. */
  get sounds(): number[] { return this.audio.sounds; }
  readonly displayCalls: FightReportDisplayCall[] = [];
  readonly loadedBanks: number[] = [];
  readonly language: number;
  private reportRoot = 0;
  private dim: FightReportDim | null = null;
  private readonly banks: ScreenTextBanks;
  private readonly pad = new ScreenPad();
  private readonly seed: FightReportSeed;
  private readonly playHost: FightReportHost;
  private readonly revealHost: Parameters<typeof textRevealTick>[1];
  private readonly rewardHost: RewardHost;
  private frame = 0;
  private channel = 0;

  constructor(seed: FightReportSeed, resources: FightReportResources, host: FightReportHost) {
    const language = seed.language;
    if (!Number.isInteger(language) || language < 0 || language > 6) throw new Error("Invalid fight report language");
    if (!Number.isInteger(seed.battleId) || seed.battleId < 0) throw new Error("Invalid fight report battle id");
    if (!Number.isInteger(seed.dropItemId) || seed.dropItemId < 0 || seed.dropItemId > ITEM_ID_MAX) {
      throw new Error("Invalid fight report item id");
    }
    if (seed.members.length === 0 || seed.members.length > REPORT_PARTY_SLOTS) {
      throw new Error("Invalid fight report party size");
    }
    seed.members.forEach((member, i) => {
      if (member.position !== i) throw new Error("Fight report party positions must be contiguous from 0");
      if (!Number.isInteger(member.rosterSlot) || member.rosterSlot < 0 || member.rosterSlot >= MAX_ROSTER_SLOTS) {
        throw new Error("Invalid fight report roster slot");
      }
    });
    this.language = language;
    this.seed = seed;
    this.playHost = host;
    const mem = this.mem;

    // Data-only installation: the overlay's tables, the species records, the wait table and font.
    if (resources.textButtons.length !== 20) throw new Error("Invalid fight report wait-button table");
    if (resources.profiles.length !== PROFILE_ROWS * 0x58) throw new Error("Invalid Digimon profile table");
    loadResidentResources(mem, { font: resources.font,
      ...(resources.cursorGlyphs ? { cursorGlyphs: resources.cursorGlyphs } : {}), ranges: [
      { base: REPORT_TABLES_BASE, bytes: resources.tables },
      { base: PROFILE_TABLE_BASE, bytes: resources.profiles },
      { base: LOGICAL_BUTTON_TABLE, bytes: resources.textButtons },
    ] });
    this.banks = new ScreenTextBanks(mem, language, REPORT_TEXT_BANKS, resources.banks, "fight report");
    this.widgets = new ShopWidgetServices(mem, this.banks as never);
    mem.write32(REPORT_LANGUAGE_CELL, language);
    this.seedSave(seed);
    this.rewardHost = {
      rand: () => host.rand() & 0xffff,
      scratch: this.widgets.arena.alloc(SCRATCH_BYTES, 4),
    };

    this.revealHost = createResidentTextServices(mem, this.widgets, {
      label: "Fight report", playSound: (id) => this.playSound(id), padWord: () => this.pad.pressed(),
      stringById: (bank, id) => this.banks.stringById(mem, bank, id),
    }).revealHost;

    const classes = new Map<number, TranslatedTaskClass>();
    const bootHost = this.bootHost();
    classes.set(REPORT_BOOT_HANDLER, {
      name: "fight report boot", childSlots: [0], terminalTick: true,
      tick: (task, children) => reportBootTick(mem, task, children, bootHost),
    });
    classes.set(REPORT_ROOT_HANDLER, {
      name: "fight report root", childSlots: [0x0c, 0x10, 0x14, 0x18], terminalTick: true,
      tick: (root, children) => reportScreenTick(mem, root, children, this.screenHost(root, children)),
    });
    const rowHost = this.rowHost();
    classes.set(REPORT_ROW_HANDLER, {
      name: "fight report row", childSlots: [], terminalTick: true,
      tick: (row, widgets) => reportRowLifecycle(mem, row, widgets, rowHost),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [0x160, (row) => { reportRowMethod08(mem, row); }],
        [0x164, (row) => { reportRowMethod14(mem, row); }],
        [0x168, (row) => { reportRowMethod20(mem, row); }],
        [0x16c, (row) => { reportRowComputeScore(mem, row, this.scoreHost()); }],
        [0x170, (row) => { reportRowMethodE0(mem, row); }],
      ]),
    });
    const fadeHost = this.fadeHost();
    classes.set(REPORT_FADE_HANDLER, {
      name: "fight report fade", childSlots: [], terminalTick: true,
      tick: (fade) => reportFadeTick(mem, fade, fadeHost),
      methods: new Map<number, (object: number, args: number[]) => void>([
        [REPORT_FADE_START_SLOT, (fade, args) => reportFadeStart(mem, fade, args[0]!, args[1]!, fadeHost)],
      ]),
    });
    this.tree = new TranslatedTaskTree(mem, classes, (task) => this.widgets.retireTask(task));
    this.bootTask = reportEntryCreate({ alloc: (handler: number, size: number, extra: number) => this.tree.allocate(handler, size, extra) });
  }

  // ── seeding ────────────────────────────────────────────────────────────────

  private seedSave(seed: FightReportSeed): void {
    const mem = this.mem;
    for (let i = 0; i < REPORT_PARTY_SLOTS; i++) {
      const member = seed.members[i];
      mem.write32(PARTY_MAP + i * 4, member ? member.rosterSlot >>> 0 : 0xffffffff);
    }
    for (const member of seed.members) {
      const record = rosterRecordAddress(member.rosterSlot);
      mem.write32(record, ((member.starterSlot ?? member.rosterSlot) + 3) >>> 0);
      if (member.forms) seedRosterForms(mem, record, member.forms);
      mem.write32(record + 0x20, member.exp >>> 0);
      mem.write16(record + 0x24, member.level & 0xffff);
      mem.write16(record + 0x26, (member.tp ?? 0) & 0xffff);
      mem.write16(record + 0x28, (member.hp ?? 0) & 0xffff);
      mem.write16(record + 0x2a, (member.maxHp ?? 0) & 0xffff);
      mem.write16(record + 0x2c, (member.mp ?? 0) & 0xffff);
      mem.write16(record + 0x2e, (member.maxMp ?? 0) & 0xffff);
      (member.core ?? []).forEach((value, i) => mem.write16(record + 0x30 + i * 2, value & 0xffff));
      (member.elements ?? []).forEach((value, i) => mem.write16(record + 0x3c + i * 2, value & 0xffff));
      const worn = member.equipment ?? {};
      [worn.head, worn.body, worn.right, worn.left, worn.acc0, worn.acc1].forEach((id, i) => {
        mem.write16(record + RECORD_EQUIPMENT[i]!, Number.isInteger(id) && id! > 0 && id! <= 0xffff ? id! : 0);
      });
      // The record's raw name string, terminated so a shorter name cannot inherit stale glyphs.
      member.nameBytes.slice(0, 23).forEach((byte, i) => mem.write8(record + 0x08 + i, byte & 0xff));
      mem.write8(record + 0x08 + Math.min(23, member.nameBytes.length), 0);
    }
    mem.write32(REPORT_MONEY, seed.bits >>> 0);
    writeItemArrays(mem, seed.bag, REPORT_SAVE);
    mem.write16(REPORT_WORKSPACE, seed.battleId & 0xffff);
    mem.write16(REPORT_WORKSPACE + 2, seed.dropItemId & 0xffff);
    mem.write32(REPORT_WORKSPACE + 4, seed.activePosition >>> 0);
    for (const member of seed.members) {
      mem.write8(REPORT_WORKSPACE + 6 + member.position * 4, member.participated ? 1 : 0);
      for (let v = 0; v < 3; v++) {
        mem.write8(REPORT_WORKSPACE + 7 + member.position * 4 + v, member.formFlags?.[v] ? 1 : 0);
      }
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

  // ── hosts ───────────────────────────────────────────────────────────────────

  private bootHost(): ReportBootHost & { createRoot(): number } {
    const record = (call: string, ...args: number[]): void => { this.displayCalls.push({ call, args }); };
    return {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      displayReset: () => record("displayReset"),
      displayPacketSize: (bytes) => record("displayPacketSize", bytes),
      displayRegion: (w, h, a, b) => record("displayRegion", w, h, a, b),
      displayView: (rect, kind, priority) => {
        record("displayView", rect.x, rect.y, rect.w, rect.h, kind, priority);
        return 1; // the screen's single view; the browser canvas is the only surface
      },
      viewColour: (_view, r, g, b) => record("viewColour", r, g, b),
      advance: () => this.tree.callMethod(this.bootTask, 0x38),
      createRoot: () => {
        this.reportRoot = reportRootCreate(this.mem, { alloc: (handler: number, size: number, extra: number) => this.tree.allocate(handler, size, extra) });
        return this.reportRoot;
      },
    };
  }

  private scoreHost() {
    return {
      cardIndexOf: (row: number) => partyPositionToRosterSlot(this.mem, row),
      cardRecord: (index: number) => persistentRosterSlot(index),
    };
  }

  private widgetHost(): ReportRowWidgetHost {
    return {
      createTextElement: (target, kind, x, y) => this.widgets.createTextElement(target, kind, x, y),
      setWidget160: (widget, value) => this.widgets.textFlagBF(widget, value),
    };
  }

  /** Every method call on a task, text widget or row/fade object, with the return value it has. */
  private callMethod = (target: number, slot: number, args: number[]): number => {
    target >>>= 0;
    const mem = this.mem;
    if (this.tree.tasks.has(target)) {
      this.tree.callMethod(target, slot, args);
      return 0;
    }
    switch (slot) {
      case 0x120: this.widgets.textFormat(target, args[0]!, args[1]!, args[2]!); return 0;
      case 0x128: return rescanVisibleWindow(mem, target);
      case 0x130: setTextScroll(mem, target, args[0]!); return 0;
      case 0x168: return getUnkC3(mem, target);
      case 0x170: return isState1(mem, target);
      default:
        dispatchWidgetMethod(mem, this.widgets, target, slot, args);
        return 0;
    }
  };

  private screenHost(root: number, children: number): ReportScreenHost {
    const mem = this.mem;
    const openHost: ReportOpenHost = {
      initContext: () => {}, // Platform: the picture context is the recorded draw intents.
      contextMethod: () => {},
      packResolve: this.draw.packResolve,
      loadAudio: (id) => { this.loadedBanks.push(id); this.banks.source(id); }, // throws if not shipped
    };
    return {
      requestBanks: () => reportScreenOpen(mem, openHost),
      // Every text bank was installed before the screen was made, so none is ever pending.
      banksReady: () => reportBanksReady(mem, { pending: (id) => { this.banks.source(id); return 0; } }),
      baseAdvance: () => this.tree.callMethod(root, 0x38),
      buildLevelWidgets: (arr) => reportLevelWidgetsCreate(mem, root, arr, this.widgetHost()),
      cardIndexOf: (i) => partyPositionToRosterSlot(mem, i),
      createRow: (index, score) => {
        // The factory's allocation is the task tree's (zeroed, class-registered); the port's own
        // repeat of the extra-block words and base table writes stores the same values.
        let row = 0;
        let calls = 0;
        const alloc = (size: number): number => {
          if (calls++ === 0) { row = this.tree.allocate(REPORT_ROW_HANDLER, size, REPORT_ROW_EXTRA); return row; }
          return this.tree.tasks.get(row)!.children;
        };
        return reportRowCreate(mem, { alloc }, root, index, score);
      },
      rowMethod16C: (row) => reportRowComputeScore(mem, row, this.scoreHost()),
      releaseService: (id) => requestScreenTransition(mem, id, 0),
      reportTick: () => reportTick(mem, root, children, this.tickHost(root)),
      drawChrome: () => reportChromeDraw(mem, root, this.chromeHost()),
    };
  }

  private chromeHost(): ReportChromeHost {
    return {
      timebase: () => this.frame,
      initDrawContext: this.draw.initDrawContext,
      setOrigin: this.draw.setOrigin,
      setLayer: this.draw.setLayer,
      m_0x88: this.draw.paletteShift,
      drawSprite: this.draw.drawSprite,
      setScale: this.draw.setScale,
      setPos: this.draw.setPos,
      packResolve: this.draw.packResolve,
    };
  }

  private foldStart = (window: number, opening: number): void => {
    windowFoldStart(this.mem, window, opening);
    this.playSound(opening ? 0x40019 : 0x4001a);
  };

  private tickHost(root: number): ReportTickHost {
    const mem = this.mem;
    return {
      foldStart: this.foldStart,
      foldBusy: (ptr) => windowFoldTick(mem, ptr),
      playSound: (id) => { this.playSound(id); },
      padRead: () => this.pad.pressed(),
      padButton: (_port, code) => code,
      resourceBase: (id) => this.banks.source(id),
      cardIndexOf: (id) => partyPositionToRosterSlot(mem, id),
      cardRecord: (index) => persistentRosterSlot(index),
      createFade: () => reportFadeCreate(mem, { alloc: (handler: number, size: number, extra: number) => this.tree.allocate(handler, size, extra) }),
      setState: (value) => this.tree.callMethod(root, 0x2c, [value]),
      callMethod: this.callMethod,
    };
  }

  private fadeHost(): ReportFadeHost {
    return {
      alloc: (handler, size, extra) => this.tree.allocate(handler, size, extra),
      callMethod: (target, slot, args) => { this.callMethod(target, slot, args); },
      dimQuad: (fade) => {
        this.dim = {
          layer: this.mem.read32(fade + 0x50) | 0, bucket: this.mem.read32(fade + 0x54) | 0,
          level: Math.max(0, Math.min(255, (this.mem.read32(fade + 0x5c) | 0) >> 8)),
        };
      },
    };
  }

  private rowHost(): ReportRowLifecycleHost {
    const mem = this.mem;
    const rewards = this.rewardHost;
    const fillHost: FightRowHost = {
      rosterSlot: (position) => partyPositionToRosterSlot(mem, position),
      rosterHandle: (slot) => persistentRosterSlot(slot),
      copyRowStats: (slot, dest) => { validateEquippedForm(mem, slot, dest); },
      copyStatValue: (slot, statId, dest) => { formEntryCopy(mem, slot, statId, dest); },
      resolveText: (offset) => this.text(offset),
      statTable: (statId) => profileRecord(mem, statId),
      widgetSetLine0: (widget, source, index) => this.widgets.textSet(widget, source, index),
      widgetSetLineNumber: (widget, line, value) => this.widgets.textNumber(widget, line, value),
      widgetSetGlyphCell: (widget, a1, a2) => setVectorAndActiveFlag(mem, widget, a1, a2),
      widgetSetFlagC1: (widget, value) => this.widgets.textShow(widget, value),
      widgetMeasure: (widget, value) => { this.widgets.textMeasure(widget, value); },
    };
    return {
      setOrigin: this.draw.setOrigin,
      setLayer: this.draw.setLayer,
      setFrame: this.draw.paletteShift,
      setPos: this.draw.setPos,
      setScale: this.draw.setScale,
      drawSprite: this.draw.drawSprite,
      packResolve: this.draw.packResolve,
        frameDelta,
      frameCounter: () => this.frame,
      rosterSlot: (position) => partyPositionToRosterSlot(mem, position),
      rosterHandle: (slot) => persistentRosterSlot(slot),
      advanceRowPhase: (_fn, row) => this.tree.callMethod(row, 0x38),
      computeRowScore: (_fn, row) => { reportRowComputeScore(mem, row, this.scoreHost()); },
      buildRowWidgets: (row, widgets) => reportRowWidgetsCreate(mem, row, widgets, this.widgetHost()),
      rowFoldStart: this.foldStart,
      rowFoldTick: (window) => windowFoldTick(mem, window),
      levelUpApply: (slot, gain) => reportAddExperience(mem, slot, gain, rewards),
      digivolutionUnlock: unlockOncePerReport((slot) => reportUnlockForm(mem, slot, rewards)),
      dvLadder: (slot, form, gain) => reportDvLadder(mem, slot, form, gain, rewards),
      learnTech: (slot, form) => reportLearnTechnique(mem, slot, form, rewards),
      makeLoadable: (slot, form) => reportMakeLoadable(mem, slot, form, rewards),
      dvGain: (slot, form, score, count) => reportDvGain(mem, slot, form, score, count, rewards),
      copyRowForms: (slot, out) => { validateEquippedForm(mem, slot, out); },
      enumerateAcquired: (slot, out) => acquiredForms(mem, slot, out),
      bankGet: (id) => this.banks.source(id),
      profileRecord: (form) => profileRecord(mem, form),
      playSound: (id) => this.playSound(id),
      stopSound: (id, channel) => this.playHost.stopSound?.(id, channel),
      padPressed: () => this.pad.pressed(),
      padKey: (_port, code) => code,
      messageSet: (widget, source, id) => this.widgets.textSet(widget, source, id),
      messageNumber: (widget, line, value) => this.widgets.textNumber(widget, line, value),
      messageInsert: (widget, source, value, flag) => this.widgets.textFormat(widget, source, value, flag),
      messageSkip: (widget) => { rescanVisibleWindow(mem, widget); },
      messageStart: (widget, mode) => setTextScroll(mem, widget, mode),
      messageVisible: (widget, value) => this.widgets.textShow(widget, value),
      messageDone: (widget) => getUnkC3(mem, widget),
      messageWaiting: (widget) => isState1(mem, widget),
      fillCard: (row, widgets, flag) => reportRowFill(mem, row, widgets, flag, fillHost),
    };
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  /** One display tick. */
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    this.frame = displayTick ?? this.frame + 1;
    this.draw.beginFrame(this.frame);
    this.dim = null;
    this.pad.update(buttons, this.frame);
    this.tree.tick(this.bootTask);
    // Each text box is its own scheduled object in the original; it ticks after its owner.
    this.widgets.forEachText((widget) => textRevealTick(this.mem, this.revealHost, widget));
  }

  /** True once the report screen has left the tree (it reached state 3 and released itself). */
  finished(): boolean { return this.reportRoot !== 0 && !this.tree.tasks.has(this.reportRoot); }

  /** The dim the fade painted on the latest tick (level 0..255), else null. */
  currentDim(): FightReportDim | null { return this.dim; }

  /** The fade level for the browser's dim painter: 0 when no fade is running. */
  fadeLevel(): number { return this.dim?.level ?? 0; }

  /** The screen's own state words while it is alive, for diagnostics. */
  state(): { screen: number; step: number; rows: number } | null {
    if (this.reportRoot === 0 || !this.tree.tasks.has(this.reportRoot)) return null;
    return {
      screen: this.mem.read32(this.reportRoot + 0x0c), step: this.mem.read32(this.reportRoot + 0x10),
      rows: this.mem.read32(this.reportRoot + 0x60),
    };
  }

  /** Each live row's counters, for diagnostics: its state, the EXP shown and its target, the score. */
  rows(): { state: number; shown: number; target: number; gain: number; levelUp: boolean; formUps: boolean[] }[] {
    if (this.reportRoot === 0 || !this.tree.tasks.has(this.reportRoot)) return [];
    const mem = this.mem;
    const children = this.tree.tasks.get(this.reportRoot)!.children;
    const out = [];
    for (let i = 0; i < REPORT_PARTY_SLOTS; i++) {
      const row = mem.read32(children + 0x0c + i * 4) >>> 0;
      if (row === 0 || !this.tree.tasks.has(row)) continue;
      out.push({
        state: mem.read32(row + 0x10) | 0, shown: mem.read32(row + 0x138) | 0, target: mem.read32(row + 0x13c) | 0,
        gain: mem.read32(row + 0x60) | 0, levelUp: (mem.read32(row + 0xf0) | 0) !== 0,
        formUps: [0, 1, 2].map((v) => (mem.read32(row + 0x100 + v * 0x10) | 0) !== 0),
      });
    }
    return out;
  }

  /** The BIT total the screen paid into the save context, clamped as the screen clamps it. */
  bits(): number { return Math.min(REPORT_MONEY_CAP, this.mem.read32(REPORT_MONEY) >>> 0); }

  /** The held count of one item after the screen paid its drop. */
  /** `base + 0x7C + id`, unmasked, as the original's payout reads it. */
  heldCount(itemId: number): number { return readHeldByte(this.mem, itemId, REPORT_SAVE); }

  /** `base + 0x20F + id`, unmasked. */
  wornCount(itemId: number): number { return this.mem.read8(REPORT_WORN + itemId); }

  /** Both arrays as the block holds them right now (ids 1..402, in id order). */
  bagEntries(): ItemCountEntry[] {
    return readItemArrays(this.mem, REPORT_SAVE);
  }

  /** The screen-return request words the closing screen wrote (ctx+0x26C8 / +0x26D0). */
  transition(): [number, number] {
    return [this.mem.read32(REPORT_SAVE + 0x26c8) | 0, this.mem.read32(REPORT_SAVE + 0x26d0) | 0];
  }

  /** A partner's private record as the screen computed it (proof only; the walker never reads it). */
  record(position: number): FightReportRecord {
    const mem = this.mem;
    const slot = partyPositionToRosterSlot(mem, position);
    if (slot < 0) throw new Error("No partner at that fight report position");
    const record = rosterRecordAddress(slot);
    const ledger = [];
    for (let i = 0; i < 0x2c; i++) {
      const at = record + 0x58 + i * 0x14;
      const form = mem.read16(at);
      if (((form << 16) >> 16) < 3) continue;
      ledger.push({
        form, level: mem.read8(at + 2) << 24 >> 24, dvexp: mem.read32(at + 4) | 0,
        tech: Array.from({ length: 6 }, (_, t) => mem.read16(at + 8 + t * 2)),
      });
    }
    return {
      exp: mem.read32(record + 0x20) | 0, level: (mem.read16(record + 0x24) << 16) >> 16,
      tp: (mem.read16(record + 0x26) << 16) >> 16, maxHp: (mem.read16(record + 0x2a) << 16) >> 16,
      maxMp: (mem.read16(record + 0x2e) << 16) >> 16,
      core: Array.from({ length: 6 }, (_, i) => (mem.read16(record + 0x30 + i * 2) << 16) >> 16),
      elements: Array.from({ length: 7 }, (_, i) => (mem.read16(record + 0x3c + i * 2) << 16) >> 16),
      equipped: Array.from({ length: 3 }, (_, i) => mem.read16(record + 0x50 + i * 2)),
      ledger,
    };
  }

  /** Dispose of every task (the player left another way). */
  dispose(): void { this.tree.dispose(this.bootTask); }
}
