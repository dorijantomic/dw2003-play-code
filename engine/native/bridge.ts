// Mixed-mode bridge: run oracle-proven engine/dw3 translations in place of the
// original MIPS body when the interpreter reaches a bridged address.
//
// A bridge entry is installed as a CPU stub at the function's entry address.
// The interpreter transfers control there exactly as at any host stub; this
// module calls the TypeScript port with the interpreter's live memory, puts the
// port's return value in $v0, and the interpreter returns to the caller's $ra.
// The stub never re-enters the interpreter (no recursive R3000.call), so a
// bridged callee is a real substitution: the original body at that address is
// never fetched.
//
// Scope rule: only ports whose entire contract is satisfiable in TypeScript are
// listed. A port with a `host` parameter (allocator, display service, child
// object methods) is composable only once every host method it calls is itself
// bridged or available as a pure TS service; until then it stays native and the
// probe reports it as translated-but-not-bridgeable. `BRIDGE_BLOCKERS` records
// the reason per address so the fallback is explicit, not silent.
//
// Coverage report integration: tools/native_screen_probe.ts marks an entry
// `replaced` when the bridge is installed for its module, and carries the
// invocation counts in the run record.

import type { R3000 } from "./mips.ts";
import type { NativeMemory } from "./memory.ts";
import type { HeapServices } from "./screen-heap.ts";
import { zeroFill } from "../dw3/zero-fill.ts";
import { memcpyBytes, strlenBytes, strcpyBytes } from "../dw3/byte-ops.ts";
import { intToDecimalAscii } from "../dw3/ui/int-to-decimal.ts";
import { decodeTextToken } from "../dw3/ui/text-decode.ts";
import { fetchTableEntry } from "../dw3/ui/fetch-table.ts";
import { loadPtrB3F8, loadPtrB400, setCurrentView } from "../dw3/globals.ts";
import { findDisplayViewCell } from "../dw3/display-service.ts";
import { queueInterPhaseBanner } from "../dw3/ui/phase-banner.ts";
import { applyQueuedGreyFlags, runQueuedAnnounce } from "../dw3/ui/duel-queue.ts";
import { openBannerSlot, openPromptSlot, resetViewPanels } from "../dw3/ui/view-openers.ts";
import { measureLine, measureTextWidth } from "../dw3/ui/text-measure.ts";
import { convertTextEncoding, initFetcherTable } from "../dw3/ui/fetch-table.ts";
import { stepToken, textHandlerEntry0, textHandlerNoop, textHandlerPageScan, textHandlerPlayerName, textHandlerSetLine, textHandlerSetText, textHandlerWait, textNextGlyph } from "../dw3/ui/text-window.ts";
import { findCacheSlotById, findFreeCacheSlot, isResourceServiceReady, resourceGetBase, cachePoll, cacheAcquire, cacheServicePending, freeCacheSlotBlock } from "../dw3/resource-service.ts";
import { wizardPackListCreate, wizardConfirmCreate } from "../dw3/ui/wizard-panels.ts";
import { createFadeWash } from "../dw3/ui/fade-wash.ts";
import { getLbaSectorLength } from "../dw3/disc-tables.ts";
import { itemRecord, itemIconClip, itemClassEquals } from "../dw3/item-record.ts";
import {
    getCurrentShopId,
    getFollowerRosterSlot,
    getPadButtons4A,
    partyPositionToRosterSlot,
    persistentRosterSlot,
    requestScreenTransition,
} from "../dw3/party-context.ts";
import {
    displayModeWord,
    drawAreaEndCommand,
    drawAreaStartCommand,
    drawOffsetCommand,
    drawTexPageCommand,
    setDefDispEnv,
    setDefDrawEnv,
    setDrawTPage,
    setIntrMask,
    texWindowCommand,
} from "../dw3/psx-env.ts";
import { setRectColour } from "../dw3/display-view.ts";
import {
    getUnkC1,
    getUnkC3,
    isState1,
    setCurrentFetcherTable,
    setTextElementFlagC1,
    setTextScroll,
    setTextWidgetOrigin,
    setVectorAndActiveFlag,
    set_unk_0x58_fns_8001a448,
    set_unk_0xbf_fns_8001a450,
    set_unk_0xc0_fns_8001a1f4,
    set_unk_0xc8_fns_8001a418,
} from "../dw3/ui/text-element-setters.ts";
import {
    UI_ICON_HANDLER,
    spawnUiIcon,
    uiIconSetCycleTicks,
    uiIconSetPos,
    uiIconSetRestTicks,
    uiIconSetUnk60,
    uiIconSetUnk7c,
    uiIconSetVisible,
} from "../dw3/ui/spawn-ui-icon.ts";
import { flushStdout, putchar, STDOUT_COUNT, type PsxStdioHost } from "../dw3/psx-stdio.ts";
import { shopListActivate, shopListMoveCursor, shopListReset, shopListSelectedId, shopListSetCursorVisible } from "../dw3/ui/shop-list-slots.ts";
import { shopActorBuyBuild } from "../dw3/ui/shop-actor-build.ts";
import { shopListBuild } from "../dw3/ui/shop-list-build.ts";
import { bandLabelBuild } from "../dw3/ui/band-label-build.ts";
import { shopReadout } from "../dw3/ui/shop-readout.ts";
import { SHOP_LIST_TICK, shopListCreate } from "../dw3/ui/shop-list-create.ts";
import { shopLoad } from "../dw3/ui/shop-stock.ts";
import { windowFoldStart, windowFoldTick, WINDOW_FOLD_OPEN_SFX, WINDOW_FOLD_CLOSE_SFX } from "../dw3/ui/window-fold.ts";
import { soundTestScrollList } from "../dw3/ui/sound-test.ts";
import { titleMenuOutcome } from "../dw3/ui/title-tasks.ts";
import { titleTwinkleStepper } from "../dw3/ui/title-draw.ts";
import { albumPageCollectedMask } from "../dw3/ui/native/album-grid.ts";
import { albumPageHasCollected } from "../dw3/ui/album-residue.ts";
import { tweenLinearStart, tweenLinearTick } from "../dw3/ui/tween-linear.ts";
import { paletteElementSetFrame } from "../dw3/ui/country-palette.ts";
import { decorBottomProgress, decorLeftProgress, decorRightProgress } from "../dw3/ui/native/cnty-decor.ts";
import { labRootCountAndPackParty } from "../dw3/ui/lab-root.ts";
import { REPORT_ROW_HANDLER, reportRowCreate, reportRowMethod08, reportRowMethod14, reportRowMethod20, reportRowMethodE0 } from "../dw3/ui/native/fight-report-row.ts";
import { titleFadeFinished } from "../dw3/ui/title-fade.ts";
import { countrySelectFadeCurve } from "../dw3/ui/native/cnty-fade.ts";
import { wizardNameFieldBox } from "../dw3/ui/wizard-name-field.ts";
import { wizardNameEntryState, wizardConfirmAccept } from "../dw3/ui/wizard-methods.ts";
import { memcardSaveCardReset } from "../dw3/ui/memcard-save-card.ts";
import { findFormLedgerIndex, validateEquippedForm } from "../dw3/form-ledger.ts";
import { setCurrentObject4_8, setCurrentObjectC_10, setCurrentViewSize_14_18, cardViewHelperSetPairA, cardViewHelperSetPairB, cardViewHelperSetScratchSize } from "../dw3/ui/card-view.ts";
import { fadeWashSetColours, fadeWashStart, fadeWashIsIdle, fadeWashStop } from "../dw3/ui/fade-wash.ts";
import { mapServerFromStage } from "../dw3/ui/native/map-server.ts";
import { memcardBlockGridCreate } from "../dw3/ui/memcard-block-grid.ts";
import { createCardBattleContext } from "../dw3/ui/card-battle-context.ts";
import { GRID_HANDLER, albumGridCreate } from "../dw3/ui/native/album-grid-object.ts";
import { SHOP_ACTOR_BUY_HANDLER, SHOP_ACTOR_SELL_HANDLER, shopActorBuy, shopActorSell } from "../dw3/ui/shop-actor.ts";
import { selectActionConstruct } from "../dw3/ui/native/select-action.ts";
import { memcardSaveCardCreate } from "../dw3/ui/memcard-save-card.ts";
import { memcardMessageWindowCreate } from "../dw3/ui/memcard-message-window.ts";
import { labRootConstruct } from "../dw3/ui/lab-root.ts";
import { titleBackgroundCreate, titleDecoLayerCreate, titleGlowCreate, titleLogoCreate,
    titleMenuCreate, titleSequenceCreate, titleWordmarkCreate } from "../dw3/ui/title-tasks.ts";
import { TEXT_ELEMENT_HANDLER, createTextElement } from "../dw3/ui/create-text-element.ts";
import { setWidgetStringIndexed, widgetSetLineNumber, widgetSetLineString } from "../dw3/ui/text-widget-line.ts";
import { BAND_HANDLER, bandCreate } from "../dw3/ui/band-highlight.ts";
import { SHOP_ROOT_HANDLER, shopRootBitRefresh, shopRootCreate, shopRootLabels } from "../dw3/ui/shop-root.ts";
import { wizardIntroSetLayer } from "../dw3/ui/wizard-anim.ts";
import { commandMenuActorConstruct, commandMenuCreate } from "../dw3/ui/native/fight-command-menu.ts";
import type { CommandMenuHost } from "../dw3/ui/native/fight-command-menu.ts";
import { gymHudConstruct } from "../dw3/ui/gym-hud.ts";
import type { GymHudHost } from "../dw3/ui/gym-hud.ts";
import { wfightPanelCreate } from "../dw3/ui/native/wfight-panel.ts";
import type { WfightHost } from "../dw3/ui/native/wfight-panel.ts";
import type { WizardAnimHost, WizardChromeHost } from "../dw3/ui/wizard-anim.ts";
import { PAUSE_ITEMS_ROOT_EXTRA, PAUSE_ITEMS_ROOT_HANDLER, PAUSE_ITEMS_ROOT_SIZE, pauseItemsRootFactory } from "../dw3/ui/native/pause-items.ts";
import type { PauseItemsHost } from "../dw3/ui/native/pause-items.ts";
import { FOLDER_SCREEN_HANDLER, folderScreenCreate } from "../dw3/ui/native/folder-screen.ts";
import {
    WIZARD_CHROME_EXTRA,
    WIZARD_CHROME_HANDLER,
    WIZARD_CHROME_SIZE,
    WIZARD_FRAME_STEP_EXTRA,
    WIZARD_FRAME_STEP_HANDLER,
    WIZARD_FRAME_STEP_SIZE,
    WIZARD_INTRO_EXTRA,
    WIZARD_INTRO_HANDLER,
    WIZARD_INTRO_SIZE,
    WIZARD_TABLE_DWELL_EXTRA,
    WIZARD_TABLE_DWELL_HANDLER,
    WIZARD_TABLE_DWELL_SIZE,
    wizardChromeCreate,
    wizardFrameStepCreate,
    wizardIntroCreate,
    wizardTableDwellCreate,
} from "../dw3/ui/wizard-anim.ts";
import { WIZARD_ROOT_EXTRA, WIZARD_ROOT_SIZE, wizardRootCreate } from "../dw3/ui/wizard-root.ts";
import { ALBUM_SCREEN_EXTRA, ALBUM_SCREEN_HANDLER, ALBUM_SCREEN_SIZE, albumScreenCreate } from "../dw3/ui/native/album-lifecycle.ts";
import { NAME_SCREEN_HANDLER, NAME_SCREEN_SIZE, nameScreenCreate } from "../dw3/ui/native/name-screen.ts";
import { PARTNER_SELECT_EXTRA, PARTNER_SELECT_HANDLER, PARTNER_SELECT_SIZE, partnerSelectCreate } from "../dw3/ui/native/name-sequence.ts";
import type { NameSequenceHost } from "../dw3/ui/native/name-sequence.ts";
import { WFIGHT_MENU_HANDLER, WFIGHT_MENU_SIZE, wfightMenuFactory } from "../dw3/ui/native/wfight-menu.ts";
import type { WfightMenuHost } from "../dw3/ui/native/wfight-menu.ts";
import { COUNTRY_PALETTE_ELEMENT_HANDLER, COUNTRY_PALETTE_ELEMENT_SIZE, createPaletteElement } from "../dw3/ui/country-palette.ts";
import { shockTestCreate, soundTestCreate, stageSelectMenuCreate, SHOCK_TEST_TASK, SOUND_TEST_TASK, STAGE_SELECT_MENU_TASK } from "../dw3/ui/task-registration.ts";
import {
    CNTY_BOTTOM_BREATHE_TICK,
    CNTY_FADE_TICK,
    CNTY_LEFT_BREATHE_TICK,
    CNTY_RIGHT_BREATHE_TICK,
    CNTY_ROOT_TICK,
    countrySelectBottomCreate,
    countrySelectFadeCreate,
    countrySelectLeftCreate,
    countrySelectRightCreate,
    countrySelectRootCreate,
} from "../dw3/ui/native/cnty-creators.ts";

/**
 * The stdout pair's fwrite boundary. In the mixed-mode runtime the native
 * printf core (still MIPS) reaches the pair's original fwrite through the
 * runtime's return-zero BIOS stub (runtime.ts BIOS_FWRITE), so the bridged
 * port's host mirrors that stub as a no-op — identical observable behaviour,
 * and never a re-entry into the interpreter.
 */
const STDIO_NOOP_HOST: PsxStdioHost = { fwrite: () => {} };

/** One translated function that runs instead of its original MIPS body. */
export interface BridgeEntry {
    address: number;
    module: string;
    name: string;
    /** Execute the TS port; the return value lands in $v0. */
    run(cpu: R3000, mem: NativeMemory, services: HeapServices | null): number;
    /**
     * Set when the port's host contract includes the runtime allocator
     * (engine/native/screen-heap.ts). Such an entry installs only when the
     * runtime supplies services, so a stage runtime never runs it against a
     * different memory arena.
     */
    requiresServices?: true;
    /**
     * Replay the register side-effects the original body would have left after
     * the call (the stub path does not execute the body, so t-register values
     * callers may read would otherwise stay at caller values). Derived from the
     * disassembly of the original; the differential check fails if an entry
     * needs this and does not have it.
     */
    regs?(cpu: R3000, mem: NativeMemory): void;
}

const num = (v: unknown): number => (typeof v === "number" ? v | 0 : 0);
const a = (cpu: R3000, n: number): number => cpu.reg(4 + n) | 0;
const u = (cpu: R3000, n: number): number => cpu.reg(4 + n) >>> 0;
const u64 = (v: number): number => v >>> 0;

function shopListCursorRegisters(c: R3000, m: NativeMemory): void {
    const self = u(c, 0);
    const selected = m.read32(self + 0x6bc) | 0;
    const pageSize = m.read32(self + 0x6d4) | 0;
    const row = Math.trunc((selected % pageSize) / 2);
    const secondary = m.read32(self + 0x24) >>> 0;
    c.setReg(4, m.read32(secondary + 0x4c));
    c.setReg(6, Math.imul(row, 14) + 36);
    c.setReg(7, row);
}

// The decor callers retain these temporary registers for the subsequent draw.
// Original leaf listings: cnty_sel_c/_asm/F0x800835cc.s (and its two siblings).
function decorProgressRegisters(c: R3000, m: NativeMemory, table: number, stride: number): void {
    const progress = m.read16s(u(c, 0) + 0x52);
    const entry = (table + Math.imul(a(c, 1), stride)) >>> 0;
    const duration = m.read32(entry);
    c.setReg(4, progress);
    c.setReg(5, entry);
    c.setReg(6, duration);
    if (progress < duration) {
        const start = m.read16s(entry + 6);
        c.setReg(3, start);
        c.setReg(8, Math.imul(m.read16s(entry + 4) - start, progress));
    } else if (stride === 12) {
        c.setReg(3, Math.imul(entry - table, 1));
    }
}

/**
 * Host adapter for a port that builds its object through the console's factory
 * (F0x80014504), whose runtime here is the core stub StubWorld.alloc: the first
 * `alloc(size)` carves the zeroed object, writes the default state-machine
 * table and registers it for the tick walk; a second `alloc(extra)` carves the
 * extra block from the same heap (the port writes +0x20/+0x24 itself).
 */
function factoryHost(
    services: HeapServices,
    handler: number,
): { alloc(size: number, align?: number): number } {
    let first = true;
    return {
        alloc(size: number, align?: number): number {
            void align;
            if (first) {
                first = false;
                return services.allocObject(handler, size, 0, 0);
            }
            return services.carve(size);
        },
    };
}

/**
 * Host adapter for the gym HUD constructor (pro/stgtrain F0x80083AEC): its only
 * host call is the text factory, which the bridge already replaces. The other
 * GymHudHost members belong to the fill functions, which still run as MIPS, so
 * they refuse loudly instead of silently guessing if a later bridge reaches one.
 */
function gymHudHost(mem: NativeMemory, services: HeapServices): GymHudHost {
    const unused = (name: string) => (): never => {
        throw new Error(`gymHudHost.${name} reached; bridge the fill that calls it first`);
    };
    return {
        // A fresh factory per widget: the factory's first alloc is the object
        // (allocObject registers it for the tick walk), a second is its carve.
        createTextElement: (target, kind, x, y) =>
            createTextElement(mem, factoryHost(services, TEXT_ELEMENT_HANDLER), target, kind, x, y) >>> 0,
        resolveText: unused("resolveText"),
        rosterSlot: unused("rosterSlot"),
        rosterHandle: unused("rosterHandle"),
        copyProjection: unused("copyProjection"),
        widgetSetLine0: unused("widgetSetLine0"),
        widgetSetLineNumber: unused("widgetSetLineNumber"),
        widgetSetC0: unused("widgetSetC0"),
        widgetSetFlagC1: unused("widgetSetFlagC1"),
        widgetMeasure: unused("widgetMeasure"),
    };
}

/**
 * Host adapter for the battle command menu's two constructors
 * (pro/fightstg F0x8009B0C8 and F0x80093F9C). Both only allocate through the
 * factory; the remaining CommandMenuHost members belong to the menu's own tick,
 * name-build and draw routines, which still run as MIPS, so they refuse loudly.
 */
function commandMenuHost(services: HeapServices): CommandMenuHost {
    const unused = (name: string) => (): never => {
        throw new Error(`commandMenuHost.${name} reached; bridge the function that calls it first`);
    };
    return {
        allocateActor: () => services.allocObject(0x80093e44, 0x58, 0x1c, 0),
        allocateJokeActor: () => services.allocObject(0x8009a898, 0xc4, 0x1c, 0),
        allocateMenu: () => services.allocObject(0x8009af4c, 0xa8, 0, 0),
        createTextElement: unused("createTextElement"),
        resourceBase: unused("resourceBase"),
        packResolve: unused("packResolve"),
        padReadA: unused("padReadA"),
        padReadB: unused("padReadB"),
        playSound: unused("playSound"),
        frameDelta: unused("frameDelta"),
        initDrawContext: unused("initDrawContext"),
        setLayer: unused("setLayer"),
        setOrigin: unused("setOrigin"),
        setPaletteRow: unused("setPaletteRow"),
        drawSprite: unused("drawSprite"),
        callMethod: unused("callMethod"),
    };
}

/**
 * Host adapter for the world fight menu factory (pro/wfightmn F0x800A6414).
 * Its only host call is the actor factory; the WfightMenuHost members belong to
 * the menu tick, which still runs as MIPS.
 */
function wfightMenuHost(services: HeapServices): WfightMenuHost {
    const unused = (name: string) => (): never => {
        throw new Error(`wfightMenuHost.${name} reached; bridge wfightMenuTick that calls it first`);
    };
    return {
        allocateActor: () => services.allocObject(WFIGHT_MENU_HANDLER, WFIGHT_MENU_SIZE, 0, 0),
        resourceLoaded: unused("resourceLoaded"),
        loadResource: unused("loadResource"),
        releaseResource: unused("releaseResource"),
        resourceBase: unused("resourceBase"),
        packResolve: unused("packResolve"),
        initMenuContext: unused("initMenuContext"),
        contextMethod: unused("contextMethod"),
        callMethod: unused("callMethod"),
    };
}

/**
 * Host adapter for the partner-select creator (pro/stdgname F0x80086144). Its
 * only host call is the factory; the NameSequenceHost members belong to the
 * naming sequence and ticks, which still run as MIPS.
 */
function nameSequenceHost(services: HeapServices): NameSequenceHost {
    const unused = (name: string) => (): never => {
        throw new Error(`nameSequenceHost.${name} reached; bridge the name sequence that calls it first`);
    };
    return {
        allocatePartnerSelect: () => services.allocObject(PARTNER_SELECT_HANDLER, PARTNER_SELECT_SIZE, PARTNER_SELECT_EXTRA, 0),
        cardIndexOf: unused("cardIndexOf"),
        cardRecord: unused("cardRecord"),
        makeCharacterModel: unused("makeCharacterModel"),
        requestBanks: unused("requestBanks"),
        banksReady: unused("banksReady"),
        idleShimmer: unused("idleShimmer"),
        releaseService: unused("releaseService"),
        callMethod: unused("callMethod"),
    };
}

/**
 * Host adapter for the wizard animation creators (pro/stplnmet F0x800833A4,
 * F0x80083748, F0x800835C4). Their only host call is the factory; the remaining
 * WizardAnimHost members belong to the animation ticks, which still run as MIPS.
 */
function wizardAnimHost(services: HeapServices): WizardAnimHost {
    const unused = (name: string) => (): never => {
        throw new Error(`wizardAnimHost.${name} reached; bridge the wizard tick that calls it first`);
    };
    return {
        allocAnim: (handler, size, extra) => services.allocObject(handler, size, extra, 0),
        advance: unused("advance"),
        initDrawContext: unused("initDrawContext"),
        setOrigin: unused("setOrigin"),
        setLayer: unused("setLayer"),
        drawSprite: unused("drawSprite"),
        packResolve: unused("packResolve"),
        frameTick: unused("frameTick"),
    };
}

/**
 * Host adapter for the wizard chrome creator (pro/stplnmet F0x80083D38). Its
 * only host call is the factory; the WizardChromeHost members belong to the
 * chrome tick, which still runs as MIPS.
 */
function wizardChromeHost(services: HeapServices): WizardChromeHost {
    const unused = (name: string) => (): never => {
        throw new Error(`wizardChromeHost.${name} reached; bridge the chrome tick that calls it first`);
    };
    return {
        allocChrome: (handler, size, extra) => services.allocObject(handler, size, extra, 0),
        advance: unused("advance"),
        setState0: unused("setState0"),
        setSubstate: unused("setSubstate"),
        resourceGetBase: unused("resourceGetBase"),
        createWidget: unused("createWidget"),
        widgetSetPageLines: unused("widgetSetPageLines"),
        widgetSetResourceLine: unused("widgetSetResourceLine"),
        widgetSetColourRow: unused("widgetSetColourRow"),
        widgetSetTypewriter: unused("widgetSetTypewriter"),
        widgetSetCallback: unused("widgetSetCallback"),
        widgetSetTypewriterSpeed: unused("widgetSetTypewriterSpeed"),
        widgetSetPos: unused("widgetSetPos"),
        widgetBusy: unused("widgetBusy"),
        widgetState: unused("widgetState"),
        widgetFlag: unused("widgetFlag"),
        widgetReveal: unused("widgetReveal"),
        padPressed: unused("padPressed"),
        padShift: unused("padShift"),
        frameTick: unused("frameTick"),
        initDrawContext: unused("initDrawContext"),
        setOrigin: unused("setOrigin"),
        setLayer: unused("setLayer"),
        setClutRow: unused("setClutRow"),
        drawSprite: unused("drawSprite"),
        packResolve: unused("packResolve"),
    };
}

/**
 * Host adapter for the battle test harness's panel constructor
 * (pro/wfightts F0x800A931C). Its only host call is the factory
 * (F0x800143DC(handler, 0x100, 0x70, 0xFFFF)); the remaining WfightHost
 * members belong to the panel tick, which still runs as MIPS.
 */
function wfightHost(services: HeapServices): WfightHost {
    const unused = (name: string) => (): never => {
        throw new Error(`wfightHost.${name} reached; bridge wfightPanelTick that calls it first`);
    };
    return {
        createPanel: (handler, size, extra, tag) => services.allocObject(handler, size, extra, tag | 0),
        openService: unused("openService"),
        serviceCategory: unused("serviceCategory"),
        setEntryCategory: unused("setEntryCategory"),
        resolveList: unused("resolveList"),
        createWidget: unused("createWidget"),
        padButtons3F4: unused("padButtons3F4"),
        padButtons3FC: unused("padButtons3FC"),
        padButtons3F8: unused("padButtons3F8"),
        frameCounter: unused("frameCounter"),
        callMethod: unused("callMethod"),
    };
}

/**
 * Host adapter for the pause screen's items-root factory (pro/ststatus
 * F0x80091E4C). Its only host call is the factory
 * (F0x80014504(handler, 0x45C, 0xD4)); the remaining PauseItemsHost members
 * belong to the items root tick / constructor, which still run as MIPS.
 */
function pauseItemsHost(services: HeapServices): PauseItemsHost {
    const unused = (name: string) => (): never => {
        throw new Error(`pauseItemsHost.${name} reached; bridge the items root tick that calls it first`);
    };
    return {
        allocateRoot: () => services.allocObject(PAUSE_ITEMS_ROOT_HANDLER, PAUSE_ITEMS_ROOT_SIZE, PAUSE_ITEMS_ROOT_EXTRA, 0),
        cardIndexOf: unused("cardIndexOf"),
        createTextElement: unused("createTextElement"),
        createFrameElement: unused("createFrameElement"),
        callMethod: unused("callMethod"),
        itemsTick: unused("itemsTick"),
        itemsDraw: unused("itemsDraw"),
    };
}

/** The line-setter host the text stepper's handlers need: the allocator plus
 *  the service slot +0 string lookup (F0x8001F744). */
const textResourceHost = (m: NativeMemory, s: HeapServices) => ({
    alloc: (size: number, align: number) => s.alloc(size, align),
    free: (ptr: number) => s.free(ptr),
    stringById: (base: number, index: number) => fetchTableEntry(m, base, index),
});


export const BRIDGE_ENTRIES: readonly BridgeEntry[] = [
    // Resident file loading uses the same arena and transfer service as MIPS.
    { address: 0x80013a6c, module: "exe/fns", name: "cachePoll", requiresServices: true,
        run: (c, m, s) => cachePoll(m, a(c, 0), { alloc: s!.alloc, startTransfer: s!.startTransfer! }) },
    { address: 0x80013c30, module: "exe/fns", name: "cacheAcquire", requiresServices: true,
        run: (c, m, s) => { cacheAcquire(m, a(c, 0), { alloc: s!.alloc, startTransfer: s!.startTransfer! }); return c.reg(2); } },
    { address: 0x80013cdc, module: "exe/fns", name: "cacheServicePending", requiresServices: true,
        run: (c, m, s) => { cacheServicePending(m, { alloc: s!.alloc, startTransfer: s!.startTransfer! }); return c.reg(2); } },
    { address: 0x80013efc, module: "exe/fns", name: "freeCacheSlotBlock", requiresServices: true,
        run: (c, m, s) => { freeCacheSlotBlock(m, a(c, 0), { freeBlock: s!.free }); return c.reg(2); } },
    { address: 0x80087ac0, module: "pro/stplnmet", name: "wizardPackListCreate", requiresServices: true,
        run: (c, m, s) => wizardPackListCreate(m, u(c, 0), { allocWizardPanel: (h, size, extra) => s!.allocObject(h, size, extra, 0), playSound: s!.playPackedSound!, initNameField: () => { throw new Error("unexpected name initialization"); }, setNameFieldBox: () => { throw new Error("unexpected name box"); } }) },
    { address: 0x80086f60, module: "pro/stplnmet", name: "wizardConfirmCreate", requiresServices: true,
        run: (c, m, s) => wizardConfirmCreate(m, u(c, 0), { allocWizardPanel: (h, size, extra) => s!.allocObject(h, size, extra, 0), playSound: s!.playPackedSound!, initNameField: () => { throw new Error("unexpected name initialization"); }, setNameFieldBox: () => { throw new Error("unexpected name box"); } }) },
    { address: 0x800a367c, module: "pro/cardgame", name: "createFadeWash", requiresServices: true,
        run: (c, m, s) => createFadeWash(m, { allocate: (h, size, extra) => s!.allocObject(h, size, extra, 0) }, a(c, 0)) },
    // ── resident EXE helpers: memory-only leaves, executed on every screen ──
    { address: 0x80017cb0, module: "exe/fns", name: "zeroFill", run: (c, m) => num(zeroFill(m, u(c, 0), a(c, 1))) },
    { address: 0x8002514c, module: "exe/fns", name: "memcpyBytes", run: (c, m) => num(memcpyBytes(m, u(c, 0), u(c, 1), a(c, 2))), regs: (c) => {
        // Original F0x8002514C register effects: dest != 0 leaves v1=dest;
        // n > 0 additionally advances a0 to dest+n, a1 to src+n and a2 to 0.
        // (v0 comes from run(); the dest==0 path leaves the pointers alone.)
        const dest = u(c, 0), src = u(c, 1), n = a(c, 2);
        if (dest === 0) return;
        c.setReg(1, dest);
        if (n > 0) {
            c.setReg(4, (dest + n) >>> 0);
            c.setReg(5, (src + n) >>> 0);
            c.setReg(6, 0);
        }
    } },
    { address: 0x8002525c, module: "exe/fns", name: "strlenBytes", run: (c, m) => num(strlenBytes(m, u(c, 0))) },
    { address: 0x8002518c, module: "exe/fns", name: "strcpyBytes", run: (c, m) => num(strcpyBytes(m, u(c, 0), u(c, 1))) },
    // resident global leaves and the view-slot search
    { address: 0x80016b58, module: "exe/fns", name: "loadPtrB400", run: (c, m) => num(loadPtrB400(m)) },
    { address: 0x80016b68, module: "exe/fns", name: "loadPtrB3F8", run: (c, m) => num(loadPtrB3F8(m)) },
    { address: 0x8001e7e0, module: "exe/fns", name: "setCurrentView", run: (c, m) => {
        setCurrentView(m, u(c, 0));
        return c.reg(2);
    } },
    { address: 0x8001dad0, module: "exe/fns", name: "findDisplayViewCell", run: (c, m) => num(findDisplayViewCell(m, a(c, 0))),
        regs: (c, m) => {
            // The original leaves a1 at the slot it stopped on (0x1E when the
            // walk ran out); a caller can read it.
            const r = findDisplayViewCell(m, a(c, 0)) | 0;
            c.setReg(5, r === -1 ? 0x1e : r);
        } },
    { address: 0x80019508, module: "exe/fns", name: "intToDecimalAscii", run: (c, m) => num(intToDecimalAscii(m, u(c, 0), a(c, 1))) },
    { address: 0x8001d264, module: "exe/fns", name: "decodeTextToken", run: (c, m) => num(decodeTextToken(m, u(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x8001f744, module: "exe/fns", name: "fetchTableEntry", run: (c, m) => num(fetchTableEntry(m, u(c, 0), a(c, 1))) },
    // the fetcher service builder and its code converter. F0x8001FCC0 sets no
    // v0 (the original leaves it), so the entry preserves it.
    { address: 0x8001fcc0, module: "exe/fns", name: "initFetcherTable", run: (c, m) => {
        initFetcherTable(m, u(c, 0));
        return c.reg(2);
    } },
    { address: 0x8001fa20, module: "exe/fns", name: "convertTextEncoding", run: (c, m) => num(convertTextEncoding(m, u(c, 0), u(c, 1), a(c, 2))) },

    // the text measure service: the loop and its wrapper. F0x8001A25C returns
    // the measure value in v0, except on the enable==0 path where it leaves v0
    // untouched (the entry preserves it).
    { address: 0x8001a25c, module: "exe/fns", name: "measureTextWidth", run: (c, m) => {
        const self = u(c, 0);
        const enable = a(c, 1) & 0xff;
        c.setReg(5, enable);
        if (enable === 0) {
            measureTextWidth(m, self, 0);
            return c.reg(2);
        }
        // F0x8001a25c.s: frame -0x28, fetcher block at frame+0x10.
        // The caller's real stack is available at interception; retaining its
        // address preserves the published fetcher pointer outside the frame.
        initFetcherTable(m, (c.reg(29) - 0x18) >>> 0);
        const font = m.read32(self + 0x50);
        const result = measureTextWidth(m, self, enable);
        c.setReg(4, self + 0x5c);
        c.setReg(5, font);
        c.setReg(6, font);
        return result;
    } },
    { address: 0x8001f770, module: "exe/fns", name: "measureLine", run: (c, m) => num(measureLine(m, u(c, 0), u(c, 1), a(c, 2))),
        regs: (c) => {
            // The original's exit path leaves the font pointer in a2 (it is
            // reloaded into a2 before every decode call and not overwritten
            // by the epilogue); a native overlay caller reads it.
            c.setReg(6, u(c, 1));
        } },
    { address: 0x800138a8, module: "exe/fns", name: "isResourceServiceReady", run: (c, m) => num(isResourceServiceReady(m)) },
    { address: 0x80013a34, module: "exe/fns", name: "findFreeCacheSlot", run: (c, m) => num(findFreeCacheSlot(m)) },
    {
        address: 0x80013e5c,
        module: "exe/fns",
        name: "resourceGetBase",
        requiresServices: true,
        // Both execution modes share the runtime's synchronous disc adapter.
        // The readiness cell is a FUNCTION POINTER, not the busy word.
        run: (c, m, services) => num(resourceGetBase(m, a(c, 0), {
            alloc: (size, tag) => services!.alloc(size, tag),
            startTransfer: (id, buffer) => {
                if (!services!.startTransfer) throw new Error("resourceGetBase needs the bank-transfer service");
                services!.startTransfer(id, buffer);
            },
            clock: () => m.read32(0x8004de20) | 0,
            busyGate: () => isResourceServiceReady(m),
        })),
    },
    // exe/f5-f7 share f5's v1 residue: its first shift is in the guard delay
    // slot; positive ids then complete id*12. Consumers preserve that v1.
    { address: 0x8001355c, module: "exe/fns", name: "itemRecord", run: c => num(itemRecord(a(c, 0))),
        regs: c => c.setReg(3, Math.imul(a(c, 0), a(c, 0) <= 0 ? 2 : 12)) },
    { address: 0x80013584, module: "exe/fns", name: "itemIconClip", run: (c, m) => itemIconClip(m, a(c, 0)),
        regs: c => c.setReg(3, Math.imul(a(c, 0), a(c, 0) <= 0 ? 2 : 12)) },
    { address: 0x800135b8, module: "exe/fns", name: "itemClassEquals", run: (c, m) => itemClassEquals(m, a(c, 0), a(c, 1)),
        regs: c => c.setReg(3, Math.imul(a(c, 0), a(c, 0) <= 0 ? 2 : 12)) },
    { address: 0x80014200, module: "exe/fns", name: "getLbaSectorLength", run: (c, m) => num(getLbaSectorLength(m, a(c, 0))) },
    { address: 0x8001889c, module: "exe/fns", name: "getPadButtons4A", run: (c, m) => num(getPadButtons4A(m, a(c, 0))) },
    { address: 0x80016d94, module: "exe/fns", name: "partyPositionToRosterSlot", run: (c, m) => num(partyPositionToRosterSlot(m, a(c, 0))) },
    { address: 0x80016fd8, module: "exe/fns", name: "getFollowerRosterSlot", run: (c, m) => num(getFollowerRosterSlot(m, a(c, 0))) },
    { address: 0x80016b78, module: "exe/fns", name: "getCurrentShopId", run: (c, m) => num(getCurrentShopId(m)) },
    { address: 0x80016b88, module: "exe/fns", name: "requestScreenTransition", run: (c, m) => num(requestScreenTransition(m, a(c, 0), a(c, 1))) },
    { address: 0x8002915c, module: "exe/fns", name: "setDrawTPage", run: (c, m) => num(setDrawTPage(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
    { address: 0x80026b1c, module: "exe/fns", name: "drawTexPageCommand", run: (c) => num(drawTexPageCommand(a(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x80026b3c, module: "exe/fns", name: "drawAreaStartCommand", run: (c, m) => num(drawAreaStartCommand(m, a(c, 0), a(c, 1))) },
    { address: 0x80026bd4, module: "exe/fns", name: "drawAreaEndCommand", run: (c, m) => num(drawAreaEndCommand(m, a(c, 0), a(c, 1))) },
    { address: 0x80026c6c, module: "exe/fns", name: "drawOffsetCommand", run: (c) => num(drawOffsetCommand(a(c, 0), a(c, 1))) },
    { address: 0x80026c88, module: "exe/fns", name: "texWindowCommand", run: (c, m) => num(texWindowCommand(m, u(c, 0))) },
    { address: 0x8002eb98, module: "exe/fns", name: "setIntrMask", run: (c, m) => num(setIntrMask(m, a(c, 0))) },
    // ── the Psy-Q stdout byte/flush pair (oracle tests/psx-stdio-oracle.test.js) ──
    // The native callers are the printf core 0x8002843C and its wrapper, which
    // stay MIPS; the pair's own fwrite boundary is the runtime's return-zero
    // BIOS stub (runtime.ts BIOS_FWRITE), so the port's host is a no-op with
    // identical observables and never re-enters the interpreter.
    { address: 0x80028b2c, module: "exe/fns", name: "putchar", run: (c, m) => {
        const ch = a(c, 0);
        putchar(m, ch, STDIO_NOOP_HOST);
        // Original v0 (fns.s:27098-27159): the tab arm exits through the
        // column&7 branch with v0 = 0; every other arm falls into the shared
        // tail whose lw/addiu leaves v0 = the post-increment count.
        return (ch << 24) >> 24 === 9 ? 0 : m.read32(STDOUT_COUNT) | 0;
    } },
    { address: 0x80028c28, module: "exe/fns", name: "flushStdout", run: (c, m) => {
        if ((m.read32(STDOUT_COUNT) | 0) > 0) {
            flushStdout(m, STDIO_NOOP_HOST);
            return 0; // the fwrite stub's v0
        }
        return c.reg(2); // count <= 0: the original epilogue leaves v0 untouched
    } },
    // FINAL DECISION (turn 352): printfFormat 0x8002843c stays NATIVE in mixed
    // mode. The single-entry experiment failed the differential gate
    // (memHash native=44cd208f vs bridge=7d8f9a3 on pro/cardgame,
    // logs/turn352-gate-formatter.log); the revert restores the baseline
    // (logs/turn352-gate-restored.log, turn352-gate-final.log). Cause not
    // isolated (see BRIDGE_BLOCKERS); the port remains oracle-proven and the
    // native body keeps executing in mixed mode. Do not re-install without a
    // passing gate run.
    { address: 0x8001e028, module: "exe/fns", name: "setRectColour", run: (c, m) => num(setRectColour(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
    // text-element setters (the resident widget field writers)
    { address: 0x8001a1b8, module: "exe/fns", name: "setTextScroll", run: (c, m) => num(setTextScroll(m, u(c, 0), a(c, 1))) },
    { address: 0x8001a1e8, module: "exe/fns", name: "setTextWidgetOrigin", run: (c, m) => num(setTextWidgetOrigin(m, u(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x8001a1f4, module: "exe/fns", name: "set_unk_0xc0_fns_8001a1f4", run: (c, m) => num(set_unk_0xc0_fns_8001a1f4(m, u(c, 0), a(c, 1))) },
    { address: 0x8001a204, module: "exe/fns", name: "setVectorAndActiveFlag", run: (c, m) => num(setVectorAndActiveFlag(m, u(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x8001a23c, module: "exe/fns", name: "setTextElementFlagC1", run: (c, m) => num(setTextElementFlagC1(m, u(c, 0), a(c, 1))) },
    { address: 0x8001a418, module: "exe/fns", name: "set_unk_0xc8_fns_8001a418", run: (c, m) => num(set_unk_0xc8_fns_8001a418(m, u(c, 0), a(c, 1))) },
    { address: 0x8001a448, module: "exe/fns", name: "set_unk_0x58_fns_8001a448", run: (c, m) => num(set_unk_0x58_fns_8001a448(m, u(c, 0), a(c, 1))) },
    { address: 0x8001a450, module: "exe/fns", name: "set_unk_0xbf_fns_8001a450", run: (c, m) => num(set_unk_0xbf_fns_8001a450(m, u(c, 0), a(c, 1))) },
    // text-element getters/state leaf (read-only) and the fetcher-table store.
    // F0x8001F738 touches no register, so the entry must preserve v0; callers
    // read it (the initFetcherTable caller's delay slot stores it at a0+8).
    { address: 0x8001a460, module: "exe/fns", name: "getUnkC3", run: (c, m) => num(getUnkC3(m, u(c, 0))) },
    { address: 0x8001a46c, module: "exe/fns", name: "getUnkC1", run: (c, m) => num(getUnkC1(m, u(c, 0))) },
    { address: 0x8001a478, module: "exe/fns", name: "isState1", run: (c, m) => num(isState1(m, u(c, 0))) },
    // the text widget's visible-window rescan and the first control handlers.
    // rescanVisibleWindow (0x80019fb0) stays native: see BRIDGE_BLOCKERS.
    { address: 0x8001a6e8, module: "exe/fns", name: "textHandlerEntry0", run: (c, m) => num(textHandlerEntry0(m, u(c, 0), u(c, 1))) },
    { address: 0x8001a73c, module: "exe/fns", name: "textHandlerWait", run: (c, m) => num(textHandlerWait(m, u(c, 0), u(c, 1), u(c, 2))) },
    { address: 0x8001a82c, module: "exe/fns", name: "textHandlerSetText", run: (c, m) => num(textHandlerSetText(m, u(c, 0), u(c, 1))) },
    { address: 0x8001a8b4, module: "exe/fns", name: "textHandlerPageScan", run: (c, m) => num(textHandlerPageScan(m, u(c, 0), u(c, 1))) },
    { address: 0x8001aa08, module: "exe/fns", name: "textHandlerNoop", run: () => 0x8003 },
    { address: 0x8001ab30, module: "exe/fns", name: "textHandlerSetLine", run: (c, m) => num(textHandlerSetLine(m, u(c, 0), u(c, 1))) },
    { address: 0x8001f738, module: "exe/fns", name: "setCurrentFetcherTable", run: (c, m) => {
        setCurrentFetcherTable(m, u(c, 0));
        return c.reg(2);
    } },
    // ui-icon setters (the cursor/marker widgets)
    { address: 0x8001b04c, module: "exe/fns", name: "uiIconSetVisible", run: (c, m) => num(uiIconSetVisible(m, u(c, 0), a(c, 1))) },
    { address: 0x8001b068, module: "exe/fns", name: "uiIconSetPos", run: (c, m) => num(uiIconSetPos(m, u(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x8001b07c, module: "exe/fns", name: "uiIconSetUnk60", run: (c, m) => num(uiIconSetUnk60(m, u(c, 0), a(c, 1))) },
    { address: 0x8001b08c, module: "exe/fns", name: "uiIconSetRestTicks", run: (c, m) => num(uiIconSetRestTicks(m, u(c, 0), a(c, 1))) },
    { address: 0x8001b094, module: "exe/fns", name: "uiIconSetCycleTicks", run: (c, m) => num(uiIconSetCycleTicks(m, u(c, 0), a(c, 1))) },
    { address: 0x8001b09c, module: "exe/fns", name: "uiIconSetUnk7c", run: (c, m) => num(uiIconSetUnk7c(m, u(c, 0), a(c, 1))) },

    // ── overlay leaves on the item-shop path ──
    { address: 0x8008360c, module: "pro/stitshop", name: "shopActorBuyBuild", requiresServices: true,
      run: (c, m, s) => num(shopActorBuyBuild(m, u(c, 0), u(c, 1), {
        createTextElement: (target, kind, x, y) => createTextElement(m, factoryHost(s!, TEXT_ELEMENT_HANDLER), target, kind, x, y),
        spawnUiIcon: (target, order, x, y) => spawnUiIcon(m, factoryHost(s!, UI_ICON_HANDLER), target, order, x, y),
        cursorActivate: (cursor) => uiIconSetVisible(m, cursor, 0),
      })) },
    { address: 0x80088670, module: "pro/stitshop", name: "shopListSetCursorVisible", run: (c, m) => num(shopListSetCursorVisible(m, u(c, 0), a(c, 1))) },
    { address: 0x80088714, module: "pro/stitshop", name: "shopListMoveCursor",
      run: (c, m) => num(shopListMoveCursor(m, u(c, 0), a(c, 1))),
      // The caller reuses the cursor setter's argument registers for this
      // frame's draw; the body leaves these values after its last jalr.
      regs: shopListCursorRegisters },
    { address: 0x800887c4, module: "pro/stitshop", name: "shopListActivate", run: (c, m) => num(shopListActivate(m, { setState: (obj, v) => {
        m.write32(obj + 0xc, v); m.write32(obj + 0x10, 0); m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
      } }, u(c, 0))) },
    { address: 0x800887ec, module: "pro/stitshop", name: "shopListReset", run: (c, m) => num(shopListReset(m, { setState: (obj, v) => {
        m.write32(obj + 0xc, v); m.write32(obj + 0x10, 0); m.write32(obj + 0x14, 0); m.write32(obj + 0x18, 0);
      } }, u(c, 0))), regs: (c, m) => {
        shopListCursorRegisters(c, m);
        c.setReg(5, 0);
      } },
    { address: 0x80087428, module: "pro/stitshop", name: "shopListBuild", requiresServices: true,
      run: (c, m, s) => num(shopListBuild(m, u(c, 0), u(c, 1), {
        createTextElement: (target, kind, x, y) => createTextElement(m, factoryHost(s!, TEXT_ELEMENT_HANDLER), target, kind, x, y),
        spawnUiIcon: (target, order, x, y) => spawnUiIcon(m, factoryHost(s!, UI_ICON_HANDLER), target, order, x, y),
        cursorActivate: (cursor) => uiIconSetVisible(m, cursor, 0),
      })) },
    { address: 0x800875e0, module: "pro/stitshop", name: "shopReadout", requiresServices: true,
      run: (c, m, s) => num(shopReadout(m, u(c, 0), u(c, 1), a(c, 2), {
        ...textResourceHost(m, s!),
        resourceSource: (id) => resourceGetBase(m, id, {
          alloc: (size, tag) => s!.alloc(size, tag),
          startTransfer: (bank, buffer) => s!.startTransfer!(bank, buffer),
          clock: () => m.read32(0x8004de20) | 0,
          busyGate: () => isResourceServiceReady(m),
        }),
        measureTextWidth: (widget, enable) => { measureTextWidth(m, widget, enable); },
        scratch: () => (c.reg(29) - 0x40) >>> 0,
      })), regs: (c) => c.setReg(6, 0) },
    { address: 0x80089a44, module: "pro/stitshop", name: "bandLabelBuild", requiresServices: true,
      run: (c, m, s) => num(bandLabelBuild(m, u(c, 0), u(c, 1), {
        createTextElement: (target, kind, x, y) => createTextElement(m, factoryHost(s!, TEXT_ELEMENT_HANDLER), target, kind, x, y),
        setWidgetFlagBF: (widget, value) => set_unk_0xbf_fns_8001a450(m, widget, value),
      })) },
    { address: 0x80088830, module: "pro/stitshop", name: "shopListSelectedId", run: (c, m) => num(shopListSelectedId(m, u(c, 0))) },
    { address: 0x8008c488, module: "pro/stitshop", name: "shopLoad", run: (c, m) => num(shopLoad(m, a(c, 0))) },

    // ── overlay leaves exercised by the interaction phase (sound test) ──
    { address: 0x8008443c, module: "pro/soundtst", name: "soundTestScrollList", run: (c, m) => num(soundTestScrollList(m, a(c, 1), u(c, 2), u(c, 3), m.read32((c.reg(29) >>> 0) + 0x10) | 0)) },

    // ── resident roster accessor ──
    { address: 0x80017b4c, module: "exe/fns", name: "persistentRosterSlot", run: (c) => num(persistentRosterSlot(a(c, 0))) },

    // ── the shared window-fold family, every executed module instance ──
    { address: 0x800867e8, module: "pro/stcrddek", name: "windowFoldStart_stcrddek_primary", requiresServices: true, run: (c, m, s) => { s!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX); windowFoldStart(m, u(c, 0), a(c, 1)); return 0; } },
    { address: 0x8008687c, module: "pro/stcrddek", name: "windowFoldTick_stcrddek_primary", run: (c, m) => windowFoldTick(m, u(c, 0)) },
    { address: 0x80083378, module: "pro/stdgname", name: "windowFoldStart_stdgname_primary", requiresServices: true, run: (c, m, s) => { s!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX); windowFoldStart(m, u(c, 0), a(c, 1)); return 0; } },
    { address: 0x8008340c, module: "pro/stdgname", name: "windowFoldTick_stdgname_primary", run: (c, m) => windowFoldTick(m, u(c, 0)) },
    { address: 0x80086fa0, module: "pro/stdwtitl", name: "windowFoldStart_stdwtitl", requiresServices: true, run: (c, m, s) => { s!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX); windowFoldStart(m, u(c, 0), a(c, 1)); return 0; } },
    { address: 0x80087034, module: "pro/stdwtitl", name: "windowFoldTick_stdwtitl", run: (c, m) => windowFoldTick(m, u(c, 0)) },
    { address: 0x80083d70, module: "pro/stplnmet", name: "windowFoldStart_stplnmet_primary", requiresServices: true, run: (c, m, s) => { s!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX); windowFoldStart(m, u(c, 0), a(c, 1)); return 0; } },
    { address: 0x80083e04, module: "pro/stplnmet", name: "windowFoldTick_stplnmet_primary", run: (c, m) => windowFoldTick(m, u(c, 0)) },
    { address: 0x8008c2dc, module: "pro/stitshop", name: "windowFoldStart_stitshop", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x8008c370, module: "pro/stitshop", name: "windowFoldTick_stitshop", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x800858a0, module: "pro/stcrdabm", name: "windowFoldStart_stcrdabm", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x80085934, module: "pro/stcrdabm", name: "windowFoldTick_stcrdabm", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x8008a2d8, module: "pro/stcrddek", name: "windowFoldStart_stcrddek_secondary", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x8008a36c, module: "pro/stcrddek", name: "windowFoldTick_stcrddek_secondary", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x80088fb4, module: "pro/stcrdshp", name: "windowFoldStart_stcrdshp", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x80089048, module: "pro/stcrdshp", name: "windowFoldTick_stcrdshp", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x80086730, module: "pro/stdgname", name: "windowFoldStart_stdgname_secondary", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x800867c4, module: "pro/stdgname", name: "windowFoldTick_stdgname_secondary", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x80085c90, module: "pro/stfgtrep", name: "windowFoldStart_stfgtrep", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x80085d24, module: "pro/stfgtrep", name: "windowFoldTick_stfgtrep", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x8008f22c, module: "pro/stgdglab", name: "windowFoldStart_stgdglab", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x8008f2c0, module: "pro/stgdglab", name: "windowFoldTick_stgdglab", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x8008b8fc, module: "pro/stgtrain", name: "windowFoldStart_stgtrain", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x8008b990, module: "pro/stgtrain", name: "windowFoldTick_stgtrain", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x80099d5c, module: "pro/ststatus", name: "windowFoldStart_ststatus", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x80099df0, module: "pro/ststatus", name: "windowFoldTick_ststatus", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },

    // ── the duel's inter-phase banner queue (pro/cardgame) ──
    // the duel's inter-phase banner queue: pure field writes (the two widget
    // slots belong to showPhaseBanner/tickPhaseBanner, which stay native)
    { address: 0x800a1af8, module: "pro/cardgame", name: "queueInterPhaseBanner", run: (c, m) => num(queueInterPhaseBanner(m, u(c, 0))) },
    // the tick's two queue services: the flag fan is pure memory; the announce
    // spawns the fade-wash task through the same factory the native path uses,
    // with the fade-wash slots called as ports (exactly what the original does
    // through the object's own slots)
    { address: 0x8009e62c, module: "pro/cardgame", name: "applyQueuedGreyFlags", run: (c, m) => {
        applyQueuedGreyFlags(m, u(c, 0));
        return c.reg(2);
    } },
    { address: 0x8009e560, module: "pro/cardgame", name: "runQueuedAnnounce", requiresServices: true, run: (c, m, services) => {
        runQueuedAnnounce(m, {
            // the same call the native ALLOC stub makes: world.alloc(cb, size, extra, 0)
            allocate: (handler, size, extra) => (services as HeapServices).allocObject(handler, size, extra, 0),
        }, u(c, 0), u(c, 1));
        return c.reg(2);
    } },
    // ── the duel's centre-plate queue (pro/cardgame) ──
    // The two slot openers play the packed UI sound through HeapServices.
    { address: 0x8009beac, module: "pro/cardgame", name: "openBannerSlot", requiresServices: true,
        run: (c, m, s) => {
            openBannerSlot(m, { playPackedSound: s!.playPackedSound! }, u(c, 0), a(c, 1), a(c, 2), a(c, 3),
                m.read32((c.reg(29) + 0x10) >>> 0), m.read32((c.reg(29) + 0x14) >>> 0));
            c.setReg(4, 0x40019);
            return 12;
        } },
    { address: 0x8009c054, module: "pro/cardgame", name: "openPromptSlot", requiresServices: true,
        run: (c, m, s) => {
            openPromptSlot(m, { playPackedSound: s!.playPackedSound! }, u(c, 0), a(c, 1), a(c, 2), a(c, 3),
                m.read32((c.reg(29) + 0x10) >>> 0));
            c.setReg(4, 0x40019);
            return 1;
        } },
    { address: 0x8009c264, module: "pro/cardgame", name: "resetViewPanels", run: (c, m) => {
        resetViewPanels(m, u(c, 0));
        return c.reg(2);
    } },
    // ── album leaves (card album/folder) ──
    { address: 0x80083734, module: "pro/stcrdabm", name: "albumPageHasCollected", run: (c, m) => albumPageHasCollected(m, u(c, 0)), regs: (c, m) => {
        // F0x80083734.s: the increment is the range branch's delay slot;
        // the loop's last addition also runs on the twelve-cell exit.
        const page = m.read32(u(c, 0) + 0x5c);
        let count = 0, card = page;
        while (m.read8(0x80048d34 + 0x4df + card) === 0) {
            count++;
            if (card >= 0x13b) break;
            card = (page + count) | 0;
            if (count >= 12) break;
        }
        c.setReg(4, page); c.setReg(5, count);
        c.setReg(6, 0x80048d34); c.setReg(3, card);
    } },
    { address: 0x80084a08, module: "pro/stfgtrep", name: "reportRowMethod08", run: (c, m) => num(reportRowMethod08(m, u(c, 0))) },

    // ── title leaves (logo/wordmark/menu twinkle and exit) ──
    { address: 0x80085f38, module: "pro/stdwtitl", name: "titleFadeFinished", run: (c, m) => titleFadeFinished(m, u(c, 0)) },
    { address: 0x80085c5c, module: "pro/stdwtitl", name: "titleMenuOutcome", run: (c, m) => num(titleMenuOutcome(m, u(c, 0))) },
    { address: 0x8008605c, module: "pro/stdwtitl", name: "titleTwinkleStepper", run: (c, m) => num(titleTwinkleStepper(m, u(c, 0), u(c, 1), a(c, 2))) },

    // ── country-select decor/palette leaves ──
    { address: 0x800835cc, module: "pro/cnty_sel", name: "decorLeftProgress", run: (c, m) => decorLeftProgress(m, u(c, 0), a(c, 1)), regs: (c, m) => decorProgressRegisters(c, m, 0x800843ec, 8) },
    { address: 0x80083830, module: "pro/cnty_sel", name: "decorRightProgress", run: (c, m) => decorRightProgress(m, u(c, 0), a(c, 1)), regs: (c, m) => decorProgressRegisters(c, m, 0x800843fc, 8) },
    { address: 0x80083a94, module: "pro/cnty_sel", name: "decorBottomProgress", run: (c, m) => decorBottomProgress(m, u(c, 0), a(c, 1)), regs: (c, m) => decorProgressRegisters(c, m, 0x8008440c, 12) },
    { address: 0x80082fc4, module: "pro/cnty_sel", name: "countrySelectFadeCurve", run: (c) => countrySelectFadeCurve(a(c, 0)) },
    { address: 0x80083474, module: "pro/cnty_sel", name: "paletteElementSetFrame", run: (c, m) => num(paletteElementSetFrame(m, a(c, 0), a(c, 1))) },

    // ── memory-card / lab / wizard leaves ──
    { address: 0x80084a14, module: "pro/stfgtrep", name: "reportRowMethod14", run: (c, m) => reportRowMethod14(m, u(c, 0)) },
    { address: 0x80084a20, module: "pro/stfgtrep", name: "reportRowMethod20", run: (c, m) => reportRowMethod20(m, u(c, 0)) },
    { address: 0x80084ae0, module: "pro/stfgtrep", name: "reportRowMethodE0", run: (c, m) => reportRowMethodE0(m, u(c, 0)) },
    { address: 0x80083bd8, module: "pro/stgmcard", name: "memcardSaveCardReset", run: (c, m) => { memcardSaveCardReset(m, u(c, 0)); return c.reg(2); } },
    { address: 0x80087edc, module: "pro/stgmcard", name: "windowFoldStart_stgmcard", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x80087f70, module: "pro/stgmcard", name: "windowFoldTick_stgmcard", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x80088438, module: "pro/stplnmet", name: "wizardFoldStart", requiresServices: true, run: (c, m, services) => {
        services!.playPackedSound!(a(c, 1) !== 0 ? WINDOW_FOLD_OPEN_SFX : WINDOW_FOLD_CLOSE_SFX);
        windowFoldStart(m, u(c, 0), a(c, 1));
        return 0;
    } },
    { address: 0x800884cc, module: "pro/stplnmet", name: "wizardFoldTick", run: (c, m) => num(windowFoldTick(m, u(c, 0))) },
    { address: 0x80085bb0, module: "pro/stplnmet", name: "wizardNameFieldBox", run: (c, m) => { wizardNameFieldBox(m, u(c, 0), a(c, 1), a(c, 2)); return c.reg(2); } },
    { address: 0x80085d50, module: "pro/stplnmet", name: "wizardNameEntryState", run: (c, m) => { wizardNameEntryState(m, u(c, 0)); return 0xa; } },
    { address: 0x80086eac, module: "pro/stplnmet", name: "wizardConfirmAccept", run: (c, m) => { wizardConfirmAccept(m, u(c, 0)); return 0x32; } },
    { address: 0x8008f32c, module: "pro/stgdglab", name: "tweenLinearStart_stgdglab", run: (c, m) => num(tweenLinearStart(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
    { address: 0x8008f36c, module: "pro/stgdglab", name: "tweenLinearTick_stgdglab", run: (c, m) => num(tweenLinearTick(m, u(c, 0))) },
    { address: 0x8001764c, module: "exe/fns", name: "findFormLedgerIndex", run: (c, m) => findFormLedgerIndex(m, a(c, 0), a(c, 1)) },
    { address: 0x800176ac, module: "exe/fns", name: "validateEquippedForm", run: (c, m) => validateEquippedForm(m, a(c, 0), u(c, 1)) },
    { address: 0x8001e98c, module: "exe/fns", name: "setCurrentObject4_8", run: (c, m) => { setCurrentObject4_8(m, a(c, 0), a(c, 1)); return c.reg(2); } },
    { address: 0x8001e9a0, module: "exe/fns", name: "setCurrentObjectC_10", run: (c, m) => { setCurrentObjectC_10(m, a(c, 0), a(c, 1)); return c.reg(2); } },
    { address: 0x8001e9b4, module: "exe/fns", name: "setCurrentViewSize_14_18", run: (c, m) => { setCurrentViewSize_14_18(m, a(c, 0), a(c, 1)); return c.reg(2); } },
    { address: 0x8001fd28, module: "exe/fns", name: "cardViewHelperSetPairA", run: (c, m) => { cardViewHelperSetPairA(m, a(c, 0), a(c, 1)); return c.reg(2); } },
    { address: 0x8001fd3c, module: "exe/fns", name: "cardViewHelperSetPairB", run: (c, m) => { cardViewHelperSetPairB(m, a(c, 0), a(c, 1)); return c.reg(2); } },
    { address: 0x8001ff9c, module: "exe/fns", name: "cardViewHelperSetScratchSize", run: (c, m) => { cardViewHelperSetScratchSize(m, a(c, 0)); return c.reg(2); } },
    { address: 0x800a3548, module: "pro/cardgame", name: "fadeWashSetColours", run: (c, m) => { fadeWashSetColours(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3)); return c.reg(2); } },
    { address: 0x800a3558, module: "pro/cardgame", name: "fadeWashStart", run: (c, m) => { fadeWashStart(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3), m.read32(c.reg(29) + 0x10), m.read32(c.reg(29) + 0x14)); return 1; } },
    { address: 0x800a35a4, module: "pro/cardgame", name: "fadeWashIsIdle", run: (c, m) => fadeWashIsIdle(m, u(c, 0)) },
    { address: 0x800a35b0, module: "pro/cardgame", name: "fadeWashStop", run: (c, m) => { fadeWashStop(m, u(c, 0)); return 2; } },
    { address: 0x80087fdc, module: "pro/stgmcard", name: "tweenLinearStart_stgmcard", run: (c, m) => num(tweenLinearStart(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
    { address: 0x8008801c, module: "pro/stgmcard", name: "tweenLinearTick_stgmcard", run: (c, m) => num(tweenLinearTick(m, u(c, 0))) },
    { address: 0x8008ec50, module: "pro/stgdglab", name: "labRootCountAndPackParty", run: (c, m) => num(labRootCountAndPackParty(m, u(c, 0))) },
    { address: 0x80083398, module: "pro/stplnmet", name: "wizardIntroSetLayer", run: (c, m) => num(wizardIntroSetLayer(m, u(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x8009a670, module: "pro/ststatus", name: "mapServerFromStage", run: (c, m) => num(mapServerFromStage(m)) },

    { address: 0x800849f0, module: "pro/stgmcard", name: "memcardBlockGridCreate", requiresServices: true,
        run: (c, m, s) => num(memcardBlockGridCreate(m, u(c, 0), {
            allocGrid: (handler, size, extra) => s!.allocObject(handler, size, extra, 0),
            tweenStart: (obj, from, to, steps) => tweenLinearStart(m, u64(obj), from, to, steps),
        })) },
    { address: 0x8009d310, module: "pro/cardgame", name: "createCardBattleContext", requiresServices: true,
        run: (c, m, s) => num(createCardBattleContext(m, u(c, 0), {
            allocateView: (handler, size, slot) => s!.allocObject(handler, size, slot, 0),
        })) },

    // ── factory constructors whose host already names the factory args ──
    { address: 0x80083a78, module: "pro/stcrdabm", name: "albumGridCreate", requiresServices: true,
        run: (c, m, s) => num(albumGridCreate(m, factoryHost(s!, GRID_HANDLER), a(c, 0))),
        regs: (c) => {
            // Original F0x80083A78: a0 = GRID_HANDLER, a1 = 0x8C, a2 = 0
            // (delay slot), v1 = 6.
            c.setReg(4, 0x80083848);
            c.setReg(5, 0x8c);
            c.setReg(6, 0);
            c.setReg(3, 6);
        } },
    { address: 0x8008596c, module: "pro/stitshop", name: "shopActorBuy", requiresServices: true,
        run: (c, m, s) => num(shopActorBuy(m, factoryHost(s!, SHOP_ACTOR_BUY_HANDLER), a(c, 0))) },
    { address: 0x800873d4, module: "pro/stitshop", name: "shopActorSell", requiresServices: true,
        run: (c, m, s) => num(shopActorSell(m, factoryHost(s!, SHOP_ACTOR_SELL_HANDLER), a(c, 0))) },
    { address: 0x8008a610, module: "pro/stgdglab", name: "selectActionConstruct", requiresServices: true,
        run: (c, m, s) => num(selectActionConstruct(m, { alloc: (h, size, extra) => s!.allocObject(h, size, extra, 0) }, a(c, 0))),
        regs: (c) => {
            // Original F0x8008A610: a0 = 0x8008A51C (lifecycle), a1 = 0x11C,
            // a2 = 0x4C, v1 = 2.
            c.setReg(4, 0x8008a51c);
            c.setReg(5, 0x11c);
            c.setReg(6, 0x4c);
            c.setReg(3, 2);
        } },
    { address: 0x80083b6c, module: "pro/stgmcard", name: "memcardSaveCardCreate", requiresServices: true,
        run: (c, m, s) => num(memcardSaveCardCreate(m, a(c, 0), { allocCard: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x80087798, module: "pro/stgmcard", name: "memcardMessageWindowCreate", requiresServices: true,
        run: (c, m, s) => num(memcardMessageWindowCreate(m, a(c, 0), { allocMessageWindow: (h, size, extra) => s!.allocObject(h, size, extra, 0) })),
        regs: (c) => {
            // Original F0x80087798: a0 = 0x80087534 (window handler),
            // a1 = 0x285C, a2 = 0x28, v1 = 0x1000.
            c.setReg(4, 0x80087534);
            c.setReg(5, 0x285c);
            c.setReg(6, 0x28);
            c.setReg(3, 0x1000);
        } },
    { address: 0x8008efd0, module: "pro/stgdglab", name: "labRootConstruct", requiresServices: true,
        run: (c, m, s) => num(labRootConstruct(m, { allocLabRoot: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x8008529c, module: "pro/stdwtitl", name: "titleLogoCreate", requiresServices: true,
        run: (c, m, s) => num(titleLogoCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x800867e0, module: "pro/stdwtitl", name: "titleBackgroundCreate", requiresServices: true,
        run: (c, m, s) => num(titleBackgroundCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x800833e4, module: "pro/stdwtitl", name: "titleDecoLayerCreate", requiresServices: true,
        run: (c, m, s) => num(titleDecoLayerCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x800844e8, module: "pro/stdwtitl", name: "titleGlowCreate", requiresServices: true,
        run: (c, m, s) => num(titleGlowCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x80084df0, module: "pro/stdwtitl", name: "titleWordmarkCreate", requiresServices: true,
        run: (c, m, s) => num(titleWordmarkCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x80085c68, module: "pro/stdwtitl", name: "titleMenuCreate", requiresServices: true,
        run: (c, m, s) => num(titleMenuCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x80086db0, module: "pro/stdwtitl", name: "titleSequenceCreate", requiresServices: true,
        run: (c, m, s) => num(titleSequenceCreate(m, a(c, 0), { allocTitleTask: (h, size, extra) => s!.allocObject(h, size, extra, 0) })) },
    { address: 0x80083aec, module: "pro/stgtrain", name: "gymHudConstruct", requiresServices: true,
        run: (c, m, s) => num(gymHudConstruct(m, u(c, 0), u(c, 1), gymHudHost(m, s!))) },
    { address: 0x8009b0c8, module: "pro/fightstg", name: "commandMenuCreate", requiresServices: true,
        run: (c, m, s) => num(commandMenuCreate(m, u(c, 0), commandMenuHost(s!))) },
    { address: 0x80093f9c, module: "pro/fightstg", name: "commandMenuActorConstruct", requiresServices: true,
        run: (c, m, s) => num(commandMenuActorConstruct(m, u(c, 0), u(c, 1), commandMenuHost(s!))) },
    { address: 0x800a931c, module: "pro/wfightts", name: "wfightPanelCreate", requiresServices: true,
        run: (c, m, s) => num(wfightPanelCreate(m, u(c, 0), a(c, 1), wfightHost(s!))),
        regs: (c, m) => {
            // Original F0x800A931C sets up the F0x800143DC call and never
            // reloads: a0 = 0x800A8D34 (handler), a1 = 0x100, a2 = 0x70,
            // a3 = 0xFFFF (its delay slot).
            c.setReg(4, 0x800a8d34);
            c.setReg(5, 0x100);
            c.setReg(6, 0x70);
            c.setReg(7, 0xffff);
            void m;
        } },
    { address: 0x80091e4c, module: "pro/ststatus", name: "pauseItemsRootFactory", requiresServices: true,
        run: (c, m, s) => num(pauseItemsRootFactory(m, u(c, 0), pauseItemsHost(s!))),
        regs: (c, m) => {
            // Original F0x80091E4C leaves the factory call's registers and the
            // last immediate in v1: a0 = handler, a1 = 0x45C, a2 = 0xD4, v1 = 6.
            // The draw stream diverges without v1 (a caller reads it).
            c.setReg(4, 0x80091d18);
            c.setReg(5, 0x45c);
            c.setReg(6, 0xd4);
            c.setReg(3, 6);
            void m;
        } },
    { address: 0x800139fc, module: "exe/fns", name: "findCacheSlotById",
        run: (c, m) => num(findCacheSlotById(m, a(c, 0))),
        regs: (c, m) => {
            // Original F0x800139FC leaves v1 = the slot address it stopped at
            // (on failure, one stride past the table) and a1 = the 1-based
            // comparison counter. A caller on pro/wfightmn reads v1.
            const id = a(c, 0);
            let v1 = 0x80044b3c;
            let a1 = 0;
            for (let i = 0; i < 0x40; i++) {
                a1 = i + 1;
                if ((m.read32(v1 + 4) | 0) === id) {
                    c.setReg(3, v1 >>> 0);
                    c.setReg(5, a1);
                    return;
                }
                v1 = (v1 + 0x10) >>> 0;
            }
            c.setReg(3, v1 >>> 0);
            c.setReg(5, a1);
        } },
    // ── Psy-Q display env leaves: pure struct writes, fifth argument on the stack ──
    { address: 0x8002906c, module: "exe/fns", name: "setDefDispEnv",
        run: (c, m) => num(setDefDispEnv(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3), m.read32((c.reg(29) + 0x10) >>> 0) | 0)) },
    { address: 0x80028fac, module: "exe/fns", name: "setDefDrawEnv",
        run: (c, m) => num(setDefDrawEnv(m, u(c, 0), a(c, 1), a(c, 2), a(c, 3), m.read32((c.reg(29) + 0x10) >>> 0) | 0)) },
    { address: 0x8002f580, module: "exe/fns", name: "displayModeWord",
        run: (c, m) => num(displayModeWord(m)) },

    // ── remaining screen/task creators from the factory inventory ──
    { address: 0x8008566c, module: "pro/stcrdabm", name: "albumScreenCreate", requiresServices: true,
        run: (c, m, s) => {
            const fh = factoryHost(s!, ALBUM_SCREEN_HANDLER);
            return num(albumScreenCreate(m, { alloc: (size: number) => fh.alloc(size) }));
        } },
    { address: 0x800865b0, module: "pro/stdgname", name: "nameScreenCreate", requiresServices: true,
        run: (c, m, s) => {
            const fh = factoryHost(s!, NAME_SCREEN_HANDLER);
            return num(nameScreenCreate(m, { alloc: (size: number) => fh.alloc(size) }));
        } },
    { address: 0x80086144, module: "pro/stdgname", name: "partnerSelectCreate", requiresServices: true,
        run: (c, m, s) => num(partnerSelectCreate(m, u(c, 0), nameSequenceHost(s!))),
        regs: (c) => {
            // F0x80086144: the factory call's registers, then +0x54 = 0x1000.
            c.setReg(4, PARTNER_SELECT_HANDLER); c.setReg(5, PARTNER_SELECT_SIZE); c.setReg(6, PARTNER_SELECT_EXTRA);
            c.setReg(3, 0x1000);
        } },
    { address: 0x800a6414, module: "pro/wfightmn", name: "wfightMenuFactory", requiresServices: true,
        run: (c, m, s) => num(wfightMenuFactory(wfightMenuHost(s!))),
        regs: (c) => { c.setReg(4, WFIGHT_MENU_HANDLER); c.setReg(5, WFIGHT_MENU_SIZE); c.setReg(6, 0); } },
    { address: 0x80083594, module: "pro/cnty_sel", name: "createPaletteElement", requiresServices: true,
        run: (c, m, s) => num(createPaletteElement(m, { allocate: (h, size, slot) => s!.allocObject(h, size, slot, 0) })),
        regs: (c) => { c.setReg(4, COUNTRY_PALETTE_ELEMENT_HANDLER); c.setReg(5, COUNTRY_PALETTE_ELEMENT_SIZE); c.setReg(6, 0); } },
    { address: 0x80085ea4, module: "pro/stagslct", name: "stageSelectMenuCreate", requiresServices: true,
        run: (c, m, s) => num(stageSelectMenuCreate({ allocTask: (h, size, widget) => s!.allocObject(h, size, widget, 0) })),
        regs: (c) => { c.setReg(4, STAGE_SELECT_MENU_TASK.handler); c.setReg(5, STAGE_SELECT_MENU_TASK.size); c.setReg(6, STAGE_SELECT_MENU_TASK.widget); } },
    { address: 0x8008499c, module: "pro/shocktst", name: "shockTestCreate", requiresServices: true,
        run: (c, m, s) => num(shockTestCreate({ allocTask: (h, size, widget) => s!.allocObject(h, size, widget, 0) })),
        regs: (c) => { c.setReg(4, SHOCK_TEST_TASK.handler); c.setReg(5, SHOCK_TEST_TASK.size); c.setReg(6, SHOCK_TEST_TASK.widget); } },
    { address: 0x80084d48, module: "pro/soundtst", name: "soundTestCreate", requiresServices: true,
        run: (c, m, s) => num(soundTestCreate({ allocTask: (h, size, widget) => s!.allocObject(h, size, widget, 0) })),
        regs: (c) => { c.setReg(4, SOUND_TEST_TASK.handler); c.setReg(5, SOUND_TEST_TASK.size); c.setReg(6, SOUND_TEST_TASK.widget); } },

    // ── wizard (pro/stplnmet): the five object creators ──
    // Each body is F0x80014504(handler, size, extra) plus inline field writes;
    // the residue is the factory call's registers and the last immediate.
    { address: 0x800833a4, module: "pro/stplnmet", name: "wizardIntroCreate", requiresServices: true,
        run: (c, m, s) => {
            const host = wizardAnimHost(s!);
            return num(wizardIntroCreate(m, host));
        },
        regs: (c) => {
            // F0x800833A4: a0 = 0x80083144, a1 = 0x84, a2 = 0, v1 = 0x80083398.
            c.setReg(4, WIZARD_INTRO_HANDLER); c.setReg(5, WIZARD_INTRO_SIZE); c.setReg(6, 0);
            c.setReg(3, 0x80083398);
        } },
    { address: 0x80083748, module: "pro/stplnmet", name: "wizardTableDwellCreate", requiresServices: true,
        run: (c, m, s) => num(wizardTableDwellCreate(m, wizardAnimHost(s!))),
        regs: (c) => { c.setReg(4, WIZARD_TABLE_DWELL_HANDLER); c.setReg(5, WIZARD_TABLE_DWELL_SIZE); c.setReg(6, 0); } },
    { address: 0x800835c4, module: "pro/stplnmet", name: "wizardFrameStepCreate", requiresServices: true,
        run: (c, m, s) => num(wizardFrameStepCreate(m, wizardAnimHost(s!))),
        regs: (c) => { c.setReg(4, WIZARD_FRAME_STEP_HANDLER); c.setReg(5, WIZARD_FRAME_STEP_SIZE); c.setReg(6, 0); } },
    { address: 0x80083d38, module: "pro/stplnmet", name: "wizardChromeCreate", requiresServices: true,
        run: (c, m, s) => num(wizardChromeCreate(m, u(c, 0), wizardChromeHost(s!))),
        regs: (c) => { c.setReg(4, WIZARD_CHROME_HANDLER); c.setReg(5, WIZARD_CHROME_SIZE); c.setReg(6, WIZARD_CHROME_EXTRA); } },
    { address: 0x800882a4, module: "pro/stplnmet", name: "wizardRootCreate", requiresServices: true,
        run: (c, m, s) => num(wizardRootCreate(m, { allocWizardRoot: (h, size, extra) => s!.allocObject(h, size, extra, 0) })),
        regs: (c) => {
            // F0x800882A4: a0 = 0x80088138, a1 = 0x6C, a2 = 0x28, v1 = 5.
            c.setReg(4, 0x80088138); c.setReg(5, WIZARD_ROOT_SIZE); c.setReg(6, WIZARD_ROOT_EXTRA);
            c.setReg(3, 5);
        } },

    // ── country select: five argument-less factory thunks (pro/cnty_sel) ──
    // Each body is F0x80014504(cb, size, extra) and returns the object; the
    // residue is the factory call's registers (the callback, size and extra).
    { address: 0x80084394, module: "pro/cnty_sel", name: "countrySelectRootCreate", requiresServices: true,
        run: (c, m, s) => num(countrySelectRootCreate({ alloc: (cb, size, extra) => s!.allocObject(cb, size, extra, 0) })),
        regs: (c) => { c.setReg(4, CNTY_ROOT_TICK); c.setReg(5, 0x54); c.setReg(6, 0x14); } },
    { address: 0x800832d8, module: "pro/cnty_sel", name: "countrySelectFadeCreate", requiresServices: true,
        run: (c, m, s) => num(countrySelectFadeCreate({ alloc: (cb, size, extra) => s!.allocObject(cb, size, extra, 0) })),
        regs: (c) => { c.setReg(4, CNTY_FADE_TICK); c.setReg(5, 0x54); c.setReg(6, 0); } },
    { address: 0x80083804, module: "pro/cnty_sel", name: "countrySelectLeftCreate", requiresServices: true,
        run: (c, m, s) => num(countrySelectLeftCreate({ alloc: (cb, size, extra) => s!.allocObject(cb, size, extra, 0) })),
        regs: (c) => { c.setReg(4, CNTY_LEFT_BREATHE_TICK); c.setReg(5, 0x58); c.setReg(6, 0); } },
    { address: 0x80083a68, module: "pro/cnty_sel", name: "countrySelectRightCreate", requiresServices: true,
        run: (c, m, s) => num(countrySelectRightCreate({ alloc: (cb, size, extra) => s!.allocObject(cb, size, extra, 0) })),
        regs: (c) => { c.setReg(4, CNTY_RIGHT_BREATHE_TICK); c.setReg(5, 0x58); c.setReg(6, 0); } },
    { address: 0x80083cec, module: "pro/cnty_sel", name: "countrySelectBottomCreate", requiresServices: true,
        run: (c, m, s) => num(countrySelectBottomCreate({ alloc: (cb, size, extra) => s!.allocObject(cb, size, extra, 0) })),
        regs: (c) => { c.setReg(4, CNTY_BOTTOM_BREATHE_TICK); c.setReg(5, 0x58); c.setReg(6, 0); } },

    { address: 0x8008a0b8, module: "pro/stcrddek", name: "folderScreenCreate", requiresServices: true,
        run: (c, m, s) => {
            // One factory per invocation: its first alloc carves the object
            // (allocObject registers it for the tick walk), the second its extra.
            const fh = factoryHost(s!, FOLDER_SCREEN_HANDLER);
            return num(folderScreenCreate(m, { alloc: (size: number) => fh.alloc(size) }));
        },
        regs: (c, m) => {
            // Original F0x8008A0B8 leaves the F0x80014504 call's registers and
            // the last immediate in v1: a0 = 0x80089E98, a1 = 0x120, a2 = 0x6C,
            // v1 = 7.
            c.setReg(4, 0x80089e98);
            c.setReg(5, 0x120);
            c.setReg(6, 0x6c);
            c.setReg(3, 7);
            void m;
        } },

    // ── allocating constructors on the screen paths (need the heap service) ──
    { address: 0x8001ae38, module: "exe/fns", name: "createTextElement", requiresServices: true,
        run: (c, m, s) => num(createTextElement(m, factoryHost(s!, TEXT_ELEMENT_HANDLER), u(c, 0), a(c, 1), a(c, 2), a(c, 3))) },
    { address: 0x80019370, module: "exe/fns", name: "widgetSetLineString", requiresServices: true,
        run: (c, m, s) => {
            widgetSetLineString(m, s!, u(c, 0), u(c, 1), a(c, 2));
            // Original tail: v0 = 1 on the empty line, else (s16) arg0+0xAA.
            const len = m.read16(u(c, 1) + 0x06) | 0;
            return len === 0 ? 1 : (m.read16(u(c, 0) + 0xaa) << 16) >> 16;
        }, regs: (c, m) => {
            // Original F0x80019370 leaves: a0 = arg0; a1 = 0 when the unkAA==0
            // setter ran, else memcpy's src+n; a2 = 0 after a non-empty memcpy
            // (or the caller's cString for an empty line); v1 = the buffer.
            // Native callers read a2 in particular (stale draw-stub captures).
            const self = u(c, 0), line = u(c, 1), cstr = u(c, 2);
            const len = m.read16(line + 0x06) | 0;
            if (len === 0) return; // early return: registers are strlen's/caller's
            c.setReg(4, self);
            c.setReg(6, 0);
            c.setReg(3, m.read32(line + 0x00) >>> 0);
            if (m.read16(self + 0xaa) === 0) c.setReg(5, 0);
            else c.setReg(5, (cstr + len) >>> 0);
        } },
    // the token stepper and the two handlers that complete its table
    { address: 0x8001a48c, module: "exe/fns", name: "stepToken", requiresServices: true,
        run: (c, m, s) => num(stepToken(m, textResourceHost(m, s!), u(c, 0), u(c, 1), u(c, 2), u(c, 3))) },
    { address: 0x8001aa10, module: "exe/fns", name: "textNextGlyph", requiresServices: true,
        run: (c, m, s) => num(textNextGlyph(m, textResourceHost(m, s!), u(c, 0), u(c, 1), u(c, 2))) },
    { address: 0x8001aba4, module: "exe/fns", name: "textHandlerPlayerName", requiresServices: true,
        run: (c, m, s) => num(textHandlerPlayerName(m, textResourceHost(m, s!), u(c, 0), u(c, 1))) },
    { address: 0x8001968c, module: "exe/fns", name: "setWidgetStringIndexed", requiresServices: true,
        run: (c, m, s) => {
            const self = u(c, 0);
            const index = a(c, 2);
            setWidgetStringIndexed(m, s!, self, u(c, 1), index);
            // Both original branches end in F0x80019370, whose v0 is 1 for an
            // empty line and (s16)self+0xAA otherwise.
            const line = (((index - 1) >>> 0) < 5 ? self + 0x5c + index * 0xc : self + 0x5c) >>> 0;
            const len = m.read16(line + 0x06) | 0;
            return len === 0 ? 1 : (m.read16(self + 0xaa) << 16) >> 16;
        } },
    { address: 0x80084aec, module: "pro/stfgtrep", name: "reportRowCreate", requiresServices: true,
        run: (c, m, s) => num(reportRowCreate(m, factoryHost(s!, REPORT_ROW_HANDLER), u(c, 0), a(c, 1), a(c, 2))) },
    { address: 0x8001b364, module: "exe/fns", name: "spawnUiIcon", requiresServices: true,
        run: (c, m, s) => num(spawnUiIcon(m, factoryHost(s!, UI_ICON_HANDLER), u(c, 0), a(c, 1), a(c, 2), a(c, 3))),
        regs: (c) => {
            // Original F0x8001B364 sets up the factory call (a0 = handler,
            // a1 = 0x98, a2 = 4) and never reloads; its last method write
            // leaves v1 = the final slot address.
            c.setReg(4, 0x8001b0a4);
            c.setReg(5, 0x98);
            c.setReg(6, 4);
            c.setReg(3, 0x8001b09c);
        } },
    { address: 0x800889a8, module: "pro/stitshop", name: "shopListCreate", requiresServices: true,
        run: (c, m, s) => num(shopListCreate(m, factoryHost(s!, SHOP_LIST_TICK), u(c, 0), a(c, 1), a(c, 2))),
        regs: (c) => {
            // Original F0x800889A8 sets up the factory call and never reloads:
            // a0 = 0x80087EC0 (handler), a1 = 0x704, a2 = 0x50, v1 = 4.
            c.setReg(4, 0x80087ec0);
            c.setReg(5, 0x704);
            c.setReg(6, 0x50);
            c.setReg(3, 4);
        } },
    { address: 0x8008c118, module: "pro/stitshop", name: "shopRootCreate", requiresServices: true,
        run: (c, m, s) => num(shopRootCreate(m, factoryHost(s!, SHOP_ROOT_HANDLER))) },
    { address: 0x8008b524, module: "pro/stitshop", name: "shopRootLabels", requiresServices: true,
        run: (c, m, s) => {
            let icon = 0;
            shopRootLabels(m, {
                createTextElement: (target, kind, x, y) =>
                    createTextElement(m, factoryHost(s!, TEXT_ELEMENT_HANDLER), target, kind, x, y),
                spawnUiIcon: (target, order, x, y) => {
                    icon = spawnUiIcon(m, factoryHost(s!, UI_ICON_HANDLER), target, order, x, y);
                    return icon;
                },
                uiIconSetVisible: (self, visible) => { uiIconSetVisible(m, self, visible); },
            }, u(c, 0), u(c, 1));
            c.setReg(4, icon);
            c.setReg(5, 0);
            c.setReg(6, 4);
            c.setReg(7, 0x2f);
            c.setReg(3, 0x8001b09c);
            return 1;
        } },
    { address: 0x8008c0c4, module: "pro/stitshop", name: "shopRootBitRefresh", requiresServices: true,
        run: (c, m, s) => {
            const owner = u(c, 0);
            const widget = m.read32((m.read32(owner + 0x24) >>> 0) + 8) >>> 0;
            let width = 0;
            shopRootBitRefresh(m, {
                widgetSetLineNumber: (self, line, value) =>
                    widgetSetLineNumber(m, s!, self, line, value, (c.reg(29) - 0x38) >>> 0),
                measureTextWidth: (self, enable) => {
                    initFetcherTable(m, (c.reg(29) - 0x30) >>> 0);
                    width = measureTextWidth(m, self, enable);
                },
            }, owner);
            // The last method call leaves the text-measure arguments visible
            // to callers, and returns its measured width in v0.
            const font = m.read32(widget + 0x50);
            c.setReg(4, m.read32(font + 4));
            c.setReg(5, 0);
            c.setReg(6, font);
            c.setReg(3, 1);
            return width;
        } },
    { address: 0x8008b484, module: "pro/stitshop", name: "bandCreate", requiresServices: true,
        run: (c, m, s) => num(bandCreate(m, factoryHost(s!, BAND_HANDLER), a(c, 0), a(c, 1))),
        regs: (c) => {
            // Original F0x8008B484 sets up the factory call and never reloads
            // these: a0 = handler, a1 = 0x248, a2 = 0xac (delay slot), v1 = 1.
            c.setReg(4, 0x8008af68);
            c.setReg(5, 0x248);
            c.setReg(6, 0xac);
            c.setReg(3, 1);
        } },
];

/**
 * Translated functions that cannot be bridged yet, with the exact reason. The
 * probe subtracts these from the bridgeable set so the fallback count is
 * explicit. A shared reason (allocator/display host) is a family-level blocker,
 * not a per-function mystery.
 */
export const BRIDGE_BLOCKERS: ReadonlyMap<string, string> = new Map([
    ["exe/fns:0x80027d6c", "set_alarm reads the vblank counter through libetc VSync 0x8002E7FC, which the screen runtime serves as a host stub advancing its own counter; a bridge stub cannot re-enter the interpreter to read it, so the oracle-proven port (tests/psyq-video-oracle.test.js) stays native."],
    ["exe/fns:0x800275e4", "gpuQueueSend immediate-mode jalr's the caller-supplied worker and the queue path calls drain/alarm/watchdog; a bridge stub cannot re-enter the interpreter to run those, so the oracle-proven port (tests/psyq-video-oracle.test.js) stays native."],
    ["exe/fns:0x80027894", "gpuQueueDrain jalr's each queued command and the optional completion callback; a bridge stub cannot re-enter the interpreter to run them, so the oracle-proven port (tests/psyq-video-oracle.test.js) stays native."],
    ["exe/fns:0x80027c30", "gpuQueuePoll calls drain and the watchdog through a host; blocked with the drain/sender family (oracle: tests/psyq-video-oracle.test.js)."],
    ["exe/fns:0x80027da0", "gpuQueueStallCheck reads the vblank counter through the same VSync host as set_alarm and then talks to the GPU/DMA ports; a bridge stub cannot re-enter the interpreter, so the oracle-proven port (tests/psyq-video-oracle.test.js) stays native."],
    ["exe/fns:0x8002977c", "updateViewAnchor calls PutDrawEnv 0x80025ECC, whose resident body runs real GPU work (a bridge stub cannot invoke it), so the oracle-proven port (tests/psyq-video-oracle.test.js) stays native."],
    ["exe/fns:0x80025ecc", "putDrawEnv (oracle-proven in tests/psyq-video-oracle.test.js) submits through jalr [driver+8] = the GPU sender 0x800275e4, which is itself native (its own blocker), and at debug level >=2 calls the runtime-served dispatch stub [0x80055ef4]; a bridge stub can do neither, so the port stays native."],
    ["exe/fns:0x800266b4", "setDrawEnvPacket only calls translated helpers, but its only executed caller is PutDrawEnv 0x80025ecc (native); bridging it alone would not replace any MIPS execution path (oracle: tests/psx-env-oracle.test.js)."],
    ["exe/fns:0x800268ac", "buildDrawEnvPacket, same caller situation as setDrawEnvPacket (oracle: tests/psx-env-oracle.test.js)."],
    ["exe/fns:0x8002990c", "GsInit3D calls updateViewAnchor 0x8002977C, which reaches PutDrawEnv; blocked for the same reason (oracle: tests/psyq-video-oracle.test.js)."],
    ["pro/cardgame:0x800a32d8", "fadeWashDraw publishes the prim cursor through the data-initialised service setter 0x8001D854; the screen runtime serves that address as its SET_DE30 stub, which captures the frame's quads and card prims. A bridge stub cannot invoke a runtime stub, so the port stays native (oracle: tests/fade-wash-oracle.test.js)."],
    ["pro/cardgame:0x800a35bc", "fadeWashHandler reaches fadeWashDraw, blocked for the same reason (oracle: tests/fade-wash-oracle.test.js)."],
    ["pro/cardgame:0x800894e4", "showPhaseBanner calls the duel view's widget slots +0xEE4/+0xEAC, which are real method-table entries the bridge cannot invoke; the port stays native (oracle: tests/phase-banner-oracle.test.js)."],
    ["pro/cardgame:0x80089580", "tickPhaseBanner calls the view's +0xEB0/+0xEE8 widget slots, blocked for the same reason (oracle: tests/phase-banner-oracle.test.js)."],
    ["pro/cardgame:0x800a1b48", "runModeMachine dispatches through two jump tables with `jr`, which a bridge stub cannot do: the entry would have to call the original arm bodies (or the arms' own ports) with the parent's callee-saved registers. The oracle-proven port stays native (oracle: tests/duel-mode-machine-oracle.test.js)."],
    ["pro/cardgame:0x800a1b2c", "initDuelModeState is pure stores and could be bridged, but it is listed with its machine for one family note: the bridge installs per address, and keeping the pair together makes the coverage report read as one unit (oracle: tests/duel-mode-machine-oracle.test.js)."],
    ["pro/cardgame:0x800a1bdc", "The four executed arms are entered by `jr` from the mode tables and read the parent's s0/s1/s2; a bridge stub receives only a0-a3, so the arms stay native (oracle: tests/duel-mode-machine-oracle.test.js)."],
    ["pro/cardgame:0x800a1c30", "Arm of runModeMachine entered by `jr`; reads the parent's s-registers (oracle: tests/duel-mode-machine-oracle.test.js)."],
    ["pro/cardgame:0x800a1d84", "Arm of runModeMachine entered by `jr`; reads the parent's s-registers (oracle: tests/duel-mode-machine-oracle.test.js)."],
    ["pro/cardgame:0x800a1d90", "Arm of runModeMachine entered by `jr`; reads the parent's s-registers (oracle: tests/duel-mode-machine-oracle.test.js)."],
    ["pro/cardgame:0x80084320", "runEffectOpcode enters every arm by `jr $v0` through the two shipped jump tables at 0x80082CF8/0x80082FB0 and the arms read the parent's callee-saved s0-s4 (the play-history bytes); the 92 far duel routines it calls plus opcode 0x0F's resident card-record cursor (F0x8001EBF8/F0x8001E7EC) are not reachable from a bridge stub, so the oracle-proven port stays native (oracle: tests/effect-vm-oracle.test.js)."],
    ["pro/cardgame:0x80084af8", "Enter arm of runEffectOpcode (opcode 0xA6's phase banner), entered by `jr`; reads the parent's s-registers (oracle: tests/effect-vm-oracle.test.js)."],
    ["pro/cardgame:0x80084ebc", "The latch arm of runEffectOpcode: 42 opcodes jump straight to it, and it falls through into the update dispatch with the parent's frame (oracle: tests/effect-vm-oracle.test.js)."],
    ["pro/cardgame:0x80085b74", "Update arm of runEffectOpcode (the banner tick for opcodes 0x9F..0xA6), entered by `jr`; reads the parent's s-registers (oracle: tests/effect-vm-oracle.test.js)."],
    ["pro/cardgame:0x80085dc8", "The epilogue arm of runEffectOpcode: every update arm jumps to it to unwind the parent's frame (oracle: tests/effect-vm-oracle.test.js)."],
    ["pro/cardgame:0x800a2df8", "cardDuelTick calls six far duel routines (the three queue services, the effect VM and the two arm handlers) as well as the mode machine; a bridge stub can only reach TS ports, so the oracle-proven port stays native (oracle: tests/duel-tick-oracle.test.js)."],
    ["pro/cardgame:0x800a3240", "createCardDuel's last step requests the start archive through the audio-archive host edge (releaseVoice/closeProgram/releaseVabSlot/acquire), which is itself translated but not bridgeable; the constructor stays native with it (oracle: tests/duel-create-oracle.test.js)."],
    ["pro/cardgame:0x800a2f00", "cardDuelSceneHandler drives the screen object's method slots (the loader gate, the pack resolver, the view setup, the packed sound), builds the card-view helper on a caller-owned buffer and calls six far duel routines; none of those edges can be reproduced from a bridge stub, so the oracle-proven port stays native (oracle: tests/duel-scene-handler-oracle.test.js)."],
    ["pro/cardgame:0x8009d540", "introVoiceCueTick acquires each cue through the resident cache pointer [0x80044F44] and polls through [0x80044F3C], and the object's +0x28 set-state is the factory's; the oracle-proven port stays native (oracle: tests/intro-cue-oracle.test.js)."],
    ["pro/cardgame:0x8009d6b4", "The intro-voice thunk is a two-instruction factory wrapper whose port lives with the cue tick it builds; registered together (oracle: tests/intro-cue-oracle.test.js)."],
    ["pro/cardgame:0x80095bfc", "cardBattleSceneTick drives the resident display service (resetDisplayService/setDisplayPacketIndex/setDisplayRegion/registerDisplayView), the upload helper, the pack resolver cell, the screen object's own +0x28/+0x38/+0x3C method slots, createCardDuel (itself not bridgeable) and the two party-service cells [0x80048D34+0x2704/0x270C]; none of those can be invoked from a bridge stub, so the oracle-proven port stays native (oracle: tests/card-battle-scene-oracle.test.js)."],
    ["pro/cardgame:0x80095e2c", "The screen factory thunk's port lives with the tick it builds; registered together (oracle: tests/card-battle-scene-oracle.test.js)."],
    ["pro/cardgame:0x8009d6e0", "loadOpponentDeck reaches the pack base through [0x80044F4C] (F0x80013E5C), which the bridge cannot call as a stub; the oracle-proven port (its class stride corrected to 0xD0 by that oracle) stays native (oracle: tests/opponent-deck-oracle.test.js)."],
    ["pro/cardgame:0x8009e668", "dispatchDuelViewQueue dispatches through the two shipped jump tables D0x80083800/D0x80083848 with `jr`, so a bridge stub would have to run the original arms with the parent's callee-saved registers; the arms also call three far duel routines (0x8009DBE8/0x8009DF68/0x8009E024) and the view's three method slots, none of which a bridge stub can reach. The oracle-proven port stays native (oracle: tests/duel-view-queue-oracle.test.js)."],
    ["exe/fns:0x800197a4", "drawTextElement publishes its glyph prims through the resident cell pair F0x8001D844 (read the packet cursor) and F0x8001D854 (publish it), which the screen runtime serves as interpreter stubs that capture this frame's quads and card prims; a bridge stub cannot invoke a runtime stub, so a bridged drawer would drop that capture. The oracle-proven port stays native (oracle: tests/text-drawer-oracle.test.js)."],
    ["exe/fns:0x80019994", "Arm 1 of drawTextElement (count the glyph, then emit): entered by the parent's dispatch and reading its frame; listed with the routine (oracle: tests/text-drawer-oracle.test.js)."],
    ["exe/fns:0x8001999c", "Arm 4 of drawTextElement (count a consumed token, then re-test the reveal window); listed with the routine (oracle: tests/text-drawer-oracle.test.js)."],
    ["exe/fns:0x800199a4", "Arm 2 of drawTextElement (the glyph emitter and its AddPrim), reached by the parent's dispatch and by arm 1's jump; listed with the routine (oracle: tests/text-drawer-oracle.test.js)."],
    ["exe/fns:0x80019ed0", "Arm 3 of drawTextElement (the reveal-window loop check); listed with the routine (oracle: tests/text-drawer-oracle.test.js)."],
    ["exe/fns:0x80019f68", "Arm 0 of drawTextElement (flush the packet cursor and return); listed with the routine (oracle: tests/text-drawer-oracle.test.js)."],
    ["exe/fns:0x8002843c", "printfFormat's bridge entry was gated out by experiment: with the single entry installed, tools/verify_native_bridge.ts failed pro/cardgame (memHash native=44cd208f vs bridge=7d8f9a3, logs/turn352-gate-formatter.log); removing it restores the baseline (OK, logs/turn352-gate-restored.log). Cause NOT yet isolated: the frame scratch sits in the gate's excluded stack region (0x801f0000..0x801ffcf0), so the divergence is something else - candidate causes are the unreplayed caller-visible register residue (t/v1/a0-a3 after the epilogue) or a stdout-state divergence on a boot-time format the oracle ladder does not cover. The oracle-proven port stays native in mixed mode pending that isolation (oracle: tests/psx-stdio-oracle.test.js); the stdout pair it calls IS bridged."],
    ["exe/fns:0x800283fc", "printfWrap's contract copies its register arguments onto its own frame and passes the cursor (a2 = sp+0x1c); a bridge stub cannot write that block without touching observable stack memory, and the formatter it calls is itself gated out (see 0x8002843c), so there is no replacement to gain. The port stays oracle-proven (oracle: tests/psx-stdio-oracle.test.js)."],
    ["exe/fns:0x80019fb0", "rescanVisibleWindow is installed and idle-clean, but once real input reveals text it is the single entry that breaks the differential gate on two roots: with only this address bridged, tools/verify_native_bridge.ts --module pro/stplnmet --frames 60 fails drawHash (native=cd5d4329 vs bridge=917fb8a5) and --module pro/stfgtrep fails the same way (native=27000f95 vs bridge=cc13e36d); a leave-one-out over the failing resident subset isolates this entry (every other exercised resident text-service entry passes alone). The oracle-proven port stays native in mixed mode until the divergence is isolated (oracle: tests/text-window-oracle.test.js)."],
    ["pro/stagslct:0x80084b70", "bios_date_caption calls through MIPS method pointers stored in the text widget (+0x134 for position, +0x110 for string); a bridge stub cannot invoke function pointers from the interpreter. The TS port (engine/dw3/ui/native/stage-select.ts#biosDateCaption) is oracle-proven but the bridge cannot replace the MIPS body (oracle: tests/bios-date-caption-oracle.test.js)."],
]);

const key = (module: string, address: number): string => `${module}:0x${(address >>> 0).toString(16)}`;

const byModule = new Map<string, BridgeEntry[]>();
for (const entry of BRIDGE_ENTRIES) {
    const list = byModule.get(entry.module) ?? [];
    list.push(entry);
    byModule.set(entry.module, list);
}

/** Invocation counter per bridge entry, keyed `module:0xaddress`. */
const invocations = new Map<string, number>();

/** Optional per-invocation observer (diagnostics); never affects execution. */
export type BridgeProbe = (entry: BridgeEntry, cpu: R3000, ret: number) => void;
let bridgeProbe: BridgeProbe | null = null;
export function setBridgeProbe(fn: BridgeProbe | null): void {
    bridgeProbe = fn;
}

export function bridgeInvocations(): ReadonlyMap<string, number> {
    return invocations;
}

/** Entries installed for one or more modules (plus the always-resident `exe/fns`). */
export function bridgeEntriesFor(modules: readonly string[]): BridgeEntry[] {
    const want = new Set(["exe/fns", ...modules]);
    return BRIDGE_ENTRIES.filter((e) => want.has(e.module));
}

export function isBridged(module: string, address: number): boolean {
    const list = byModule.get(module);
    return list !== undefined && list.some((e) => e.address === (address >>> 0));
}

/**
 * Install the bridge entries as CPU stubs. `modules` names the overlay(s) loaded
 * in this runtime; resident `exe/fns` entries are always installed. `only`
 * restricts the install to a set of addresses (used to bisect a divergence in
 * the differential check). Returns the number of stubs installed.
 */
export function installTranslationBridge(
    cpu: R3000,
    mem: NativeMemory,
    modules: readonly string[],
    only?: ReadonlySet<number> | null,
    services?: HeapServices | null,
): number {
    let installed = 0;
    for (const entry of bridgeEntriesFor(modules)) {
        if (only !== undefined && only !== null && !only.has(entry.address)) continue;
        if (entry.requiresServices === true && (services === undefined || services === null)) continue;
        const entryKey = key(entry.module, entry.address);
        cpu.setStub(entry.address, (c) => {
            invocations.set(entryKey, (invocations.get(entryKey) ?? 0) + 1);
            const ret = entry.run(c, mem, services ?? null);
            entry.regs?.(c, mem);
            bridgeProbe?.(entry, c, ret);
            return ret;
        });
        installed += 1;
    }
    return installed;
}

export function bridgeAddresses(modules: readonly string[]): number[] {
    return bridgeEntriesFor(modules).map((e) => e.address);
}
